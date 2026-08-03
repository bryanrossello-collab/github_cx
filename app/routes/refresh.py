"""/api/renewals/refresh* — admin-triggered on-demand Snowflake refresh.

  POST /api/renewals/refresh
       Owner-gated. Reads the per-request OAuth token from the
       `x-pomerium-idp-access-token` header, kicks off ``refresh_all`` as a
       background task, and returns immediately (well under 30s). Guards
       against concurrent runs (module-level in-flight flag -> 409).

  GET  /api/renewals/refresh-status
       Returns the current/last refresh status, incl. per-slot results, the
       "data as of" timestamp (last successful finish), the source mode, and
       a read-only summary of the Snowflake connection settings. Reads the
       last-success record from ``renewals_meta`` so it survives restarts and
       any instance can serve it.

The OAuth token is captured at request time and handed to the background job
in memory only. It is NEVER logged, stored, or persisted anywhere.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth import require_owner, ResolvedUser
from app.config import get_settings
from app.database import DatabaseUnavailable
from app import warehouse

logger = logging.getLogger("renewals_studio.refresh")

router = APIRouter(prefix="/api/renewals", tags=["refresh"])

_TOKEN_HEADER = "x-pomerium-idp-access-token"
_META_KEY = "snowflake_last_refresh"

# Per-instance job state. The event loop is single-threaded, so plain dict
# mutation is safe without a lock. Cross-instance last-success lives in
# renewals_meta (Postgres) via _persist().
_job: dict[str, Any] = {
    "status": "idle",      # idle | running | done | error
    "job_id": None,
    "started_at": None,
    "finished_at": None,
    "mode": None,
    "slots": {},
    "error": None,
}
_job_task: Optional[asyncio.Task] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    return db


async def _read_meta(db) -> dict:
    if db is None:
        return {}
    try:
        raw = await db.get_meta(_META_KEY)
    except Exception:
        return {}
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


async def _persist(db) -> None:
    """Persist the current job outcome as the last-refresh record. Keeps the
    previous data_as_of when the current run didn't fully succeed."""
    prior = await _read_meta(db)
    data_as_of = (
        _job["finished_at"] if _job["status"] == "done" else prior.get("data_as_of")
    )
    record = {
        "status": _job["status"],
        "job_id": _job["job_id"],
        "started_at": _job["started_at"],
        "finished_at": _job["finished_at"],
        "mode": _job["mode"],
        "slots": _job["slots"],
        "error": _job["error"],
        "data_as_of": data_as_of,
    }
    try:
        await db.set_meta(_META_KEY, json.dumps(record))
    except Exception:
        logger.exception("failed to persist snowflake last-refresh record")


async def _run_job(db, token: Optional[str], settings, job_id: str) -> None:
    try:
        result = await warehouse.refresh_all(db, token, settings)
        _job["mode"] = result.get("mode")
        _job["slots"] = result.get("slots", {})
        _job["finished_at"] = _now_iso()
        if result.get("ok"):
            _job["status"] = "done"
            _job["error"] = None
        else:
            _job["status"] = "error"
            _job["error"] = "one or more slots failed"
    except Exception as exc:  # noqa: BLE001 — never leak token in the message
        _job["status"] = "error"
        _job["finished_at"] = _now_iso()
        _job["error"] = f"{type(exc).__name__}: {exc}"
        logger.exception("snowflake refresh job failed job_id=%s", job_id)
    finally:
        await _persist(db)


def _pick_latest(job: dict, persisted: dict) -> dict:
    """Choose the more authoritative record between this instance's job and
    the persisted cross-instance record (by finished_at)."""
    jf = job.get("finished_at")
    pf = persisted.get("finished_at")
    if job.get("status") == "idle" and not jf:
        return persisted or job
    if not persisted:
        return job
    if jf and pf:
        return job if jf >= pf else persisted
    return job if jf else persisted


@router.post("/refresh")
async def trigger_refresh(
    request: Request,
    _owner: ResolvedUser = Depends(require_owner),
):
    global _job_task
    db = _db(request)
    settings = get_settings()

    if _job["status"] == "running":
        return JSONResponse(
            status_code=409,
            content={
                "ok": False,
                "error": "refresh_in_progress",
                "job_id": _job["job_id"],
                "status": "running",
                "started_at": _job["started_at"],
            },
        )

    # Per-request OAuth token — in memory only, never logged/persisted.
    token = request.headers.get(_TOKEN_HEADER)
    simulated = warehouse.effective_simulated(token, settings)

    job_id = uuid.uuid4().hex
    _job.update(
        status="running",
        job_id=job_id,
        started_at=_now_iso(),
        finished_at=None,
        mode="simulated" if simulated else "real",
        slots={},
        error=None,
    )
    _job_task = asyncio.create_task(_run_job(db, token, settings, job_id))

    logger.info("snowflake refresh started job_id=%s mode=%s", job_id, _job["mode"])
    return {
        "ok": True,
        "job_id": job_id,
        "status": "running",
        "started_at": _job["started_at"],
        "mode": _job["mode"],
    }


@router.get("/refresh-status")
async def refresh_status(request: Request):
    settings = get_settings()
    db = getattr(request.app.state, "db", None)
    persisted = await _read_meta(db)

    if _job["status"] == "running":
        base = dict(_job)
        base["data_as_of"] = persisted.get("data_as_of")
    else:
        base = _pick_latest(_job, persisted)

    return {
        "status": base.get("status", "idle"),
        "job_id": base.get("job_id"),
        "started_at": base.get("started_at"),
        "finished_at": base.get("finished_at"),
        "data_as_of": base.get("data_as_of"),
        "mode": base.get("mode")
        or ("simulated" if settings.snowflake_simulated else "real"),
        "slots": base.get("slots") or {},
        "error": base.get("error"),
        "simulated": settings.snowflake_simulated,
        "settings": settings.snowflake_public_dict(),
    }
