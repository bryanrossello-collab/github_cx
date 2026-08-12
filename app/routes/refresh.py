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
# Admin-editable Snowflake connection overrides (persisted so they survive
# restarts and don't require a code/env change). Merged over the env/config
# defaults by warehouse.effective_conn().
_CONFIG_META_KEY = "snowflake_config"
_CONFIG_FIELDS = ("account", "warehouse", "database", "schema", "role")
# Admin-editable query binds for unified_dynamic.sql (numbers), stored in the
# same `snowflake_config` meta dict alongside the connection fields.
_QUERY_FIELDS = ("n_past", "n_future", "min_arr", "band_cutoff")

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


async def _read_sf_overrides(db) -> dict:
    """Load the admin-editable Snowflake connection overrides (or {})."""
    if db is None:
        return {}
    try:
        raw = await db.get_meta(_CONFIG_META_KEY)
    except Exception:
        return {}
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


async def _run_job(db, token: Optional[str], settings, job_id: str) -> None:
    try:
        overrides = await _read_sf_overrides(db)
        result = await warehouse.refresh_all(db, token, settings, overrides=overrides)
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

    _status_overrides = await _read_sf_overrides(db)
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
        # Effective connection + query settings = env/config defaults with any
        # admin-UI overrides applied, so the card shows what will actually run.
        "settings": {
            "mode": "simulated" if settings.snowflake_simulated else "real",
            **warehouse.effective_conn(settings, _status_overrides),
            **warehouse.effective_params_dict(_status_overrides),
        },
    }


@router.get("/snowflake-config")
async def get_snowflake_config(
    request: Request,
    _owner: ResolvedUser = Depends(require_owner),
):
    """Return the EFFECTIVE Snowflake connection settings (env/config defaults
    with any admin overrides applied), the raw overrides, and the defaults."""
    settings = get_settings()
    db = getattr(request.app.state, "db", None)
    overrides = await _read_sf_overrides(db)
    return {
        "ok": True,
        "config": warehouse.effective_conn(settings, overrides),
        "query": warehouse.effective_params_dict(overrides),
        "overrides": overrides,
        "defaults": {
            "account": settings.snowflake_account,
            "warehouse": settings.snowflake_warehouse,
            "database": settings.snowflake_database,
            "schema": settings.snowflake_schema,
            "role": settings.snowflake_role,
        },
        "query_defaults": dict(warehouse.DEFAULT_QUERY_PARAMS),
        "mode": "simulated" if settings.snowflake_simulated else "real",
    }


@router.put("/snowflake-config")
async def put_snowflake_config(
    request: Request,
    _owner: ResolvedUser = Depends(require_owner),
):
    """Persist admin-editable Snowflake overrides. Connection fields (account/
    warehouse/database/schema/role) are strings; query fields (n_past/n_future/
    min_arr/band_cutoff) are numbers. Any field omitted (or null) keeps its
    prior value; blank/invalid query numbers fall back to the code default.
    Fields are MERGED over the existing overrides so the connection and query
    forms can be saved independently without clobbering each other."""
    db = _db(request)
    body = await request.json()
    if not isinstance(body, dict):
        return JSONResponse(status_code=400, content={"ok": False, "error": "body must be an object"})
    clean: dict[str, Any] = dict(await _read_sf_overrides(db))
    for k in _CONFIG_FIELDS:
        if k in body and body[k] is not None:
            v = body[k]
            if not isinstance(v, str):
                return JSONResponse(
                    status_code=400,
                    content={"ok": False, "error": f"{k} must be a string"},
                )
            clean[k] = v.strip()
    for k in _QUERY_FIELDS:
        if k in body and body[k] is not None and not (isinstance(body[k], str) and not body[k].strip()):
            num = warehouse.coerce_query_value(k, body[k])
            if num is None:
                return JSONResponse(
                    status_code=400,
                    content={"ok": False, "error": f"{k} must be a number"},
                )
            clean[k] = num
    await db.set_meta(_CONFIG_META_KEY, json.dumps(clean))
    settings = get_settings()
    return {
        "ok": True,
        "overrides": clean,
        "config": warehouse.effective_conn(settings, clean),
        "query": warehouse.effective_params_dict(clean),
    }


def _safe_token_claims(token: Optional[str]) -> dict:
    """Decode a JWT's NON-SECRET claims for diagnosis. Never returns the raw
    token; `sub` is truncated. Used only by the owner-gated /oauth-debug."""
    if not token:
        return {"present": False}
    try:
        import base64
        import json

        parts = token.split(".")
        if len(parts) < 2:
            return {"present": True, "opaque": True, "len": len(token)}
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        c = json.loads(base64.urlsafe_b64decode(payload.encode()))
        sub = c.get("sub")
        return {
            "present": True,
            "len": len(token),
            "aud": c.get("aud"),
            "iss": c.get("iss"),
            "scope": c.get("scp") or c.get("scope"),
            "email": c.get("email"),
            "sub_prefix": (str(sub)[:8] + "\u2026") if sub else None,
            "exp": c.get("exp"),
            # Any claim mentioning role — this is what drives Snowflake's role auth.
            "role_claims": {k: v for k, v in c.items() if "role" in str(k).lower()},
        }
    except Exception as e:  # noqa: BLE001
        return {"present": True, "decode_error": type(e).__name__}


@router.get("/oauth-debug")
async def oauth_debug(
    request: Request,
    _owner: ResolvedUser = Depends(require_owner),
):
    """Owner-only. Shows the NON-SECRET claims of the OAuth token(s) this app
    actually receives from Pomerium on a normal request, so we can compare to a
    known-working app (e.g. the ZDP reference). Never logs or returns the raw
    token. Use to diagnose why Snowflake filters a role: check `aud`, `scope`,
    and `role_claims` on the access token."""
    settings = get_settings()
    return {
        "access_token": _safe_token_claims(request.headers.get(_TOKEN_HEADER)),
        "id_token": _safe_token_claims(request.headers.get("x-pomerium-idp-id-token")),
        "has_jwt_assertion": bool(request.headers.get("x-pomerium-jwt-assertion")),
        "configured_role": settings.snowflake_role or "(empty \u2192 Snowflake default role)",
        "configured_account": settings.snowflake_account,
    }
