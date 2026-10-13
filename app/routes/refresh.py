"""/api/renewals/refresh* — Snowflake refresh, manual and automatic.

  POST /api/renewals/refresh
       Owner-gated. Reads the per-request OAuth token from the
       `x-pomerium-idp-access-token` header, kicks off ``refresh_all`` as a
       background task, and returns immediately (well under 30s). 409 while
       another refresh holds the cross-instance lease.

  POST /api/renewals/refresh/auto
       Any signed-in user; the dashboard calls it once per page load. When the
       newest active snapshot is older than the cadence (default 48h, admin-
       editable, 0 = off), it starts the same background refresh with the
       visitor's token and returns at once; otherwise it reports "fresh". The
       page keeps serving the cached snapshot either way.

  GET  /api/renewals/refresh-status
       Returns the current/last refresh status, incl. per-slot results, the
       "data as of" timestamp (last successful finish), the source mode, and
       a read-only summary of the Snowflake connection settings. Reads the
       last-success record from ``renewals_meta`` so it survives restarts and
       any instance can serve it.

Only one refresh runs at a time across all instances: each run holds a lease
row in ``renewals_meta`` that expires on its own if the instance dies.

The OAuth token is captured at request time and handed to the background job
in memory only. It is NEVER logged, stored, or persisted anywhere.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth import require_owner, require_signed_in, ResolvedUser
from app.config import get_settings
from app.database import (
    DatabaseUnavailable,
    SNAPSHOT_KEEP_ALL_DAYS,
    SNAPSHOT_KEEP_WEEKLY_WEEKS,
)
from app import warehouse

logger = logging.getLogger("renewals_studio.refresh")

router = APIRouter(prefix="/api/renewals", tags=["refresh"])

_TOKEN_HEADER = "x-pomerium-idp-access-token"
_META_KEY = "snowflake_last_refresh"
_LEASE_KEY = "snowflake_refresh_lease"
# Outcome of the latest automatic run plus the cooldown / per-user skip list.
# Holds emails, so only owner-gated endpoints return it in full.
_AUTO_META_KEY = "snowflake_auto_refresh"
AUTO_REFRESH_DEFAULT_HOURS = 48
_AUTO_MAX_HOURS = 24 * 90
# Longer than a healthy run (Snowflake statement cap + ingest), short enough
# that an instance killed mid-run only blocks refreshes for a while.
_LEASE_TTL_S = 45 * 60
# An automatic run refuses a pull this much smaller than the newest snapshot.
# Any visitor's token can trigger it, and a visitor whose Snowflake access is
# narrower than usual would otherwise replace the book with part of it.
_AUTO_MIN_ROW_RATIO = 0.9
_AUTO_COOLDOWN = {
    "connect": timedelta(minutes=10),
    "row_guard": timedelta(hours=1),
    "error": timedelta(minutes=30),
}
_AUTO_USER_SKIP = {
    "connect": timedelta(hours=24),
    "row_guard": timedelta(days=7),
    "error": timedelta(hours=24),
}
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
    "kind": None,          # manual | auto
    "slots": {},
    "error": None,
}
_job_task: Optional[asyncio.Task] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _parse_dt(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _auto_hours(overrides: dict) -> float:
    try:
        hours = float(overrides.get("auto_refresh_hours"))
    except (TypeError, ValueError):
        return float(AUTO_REFRESH_DEFAULT_HOURS)
    if math.isnan(hours) or not 0 <= hours <= _AUTO_MAX_HOURS:
        return float(AUTO_REFRESH_DEFAULT_HOURS)
    return hours


def _db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    return db


async def _read_json_meta(db, key: str) -> dict:
    if db is None:
        return {}
    try:
        raw = await db.get_meta(key)
    except Exception:
        return {}
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


async def _read_meta(db) -> dict:
    return await _read_json_meta(db, _META_KEY)


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
        "kind": _job["kind"],
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
    return await _read_json_meta(db, _CONFIG_META_KEY)


async def _claim_lease(db, job_id: str, kind: str, email: Optional[str]) -> bool:
    return await db.try_claim_lease(
        _LEASE_KEY, {"job_id": job_id, "kind": kind, "by": email}, _LEASE_TTL_S
    )


async def _release_lease(db, job_id: str) -> None:
    try:
        await db.release_lease(_LEASE_KEY, job_id)
    except Exception:
        logger.exception("failed to release refresh lease job_id=%s", job_id)


async def _active_lease(db) -> Optional[dict]:
    """The running refresh's lease (any instance), or None."""
    if db is None:
        return None
    try:
        lease = await db.read_lease(_LEASE_KEY)
    except Exception:
        return None
    return lease if lease and lease.get("active") else None


async def _record_auto_start(db, job_id: str, email: str) -> None:
    state = await _read_json_meta(db, _AUTO_META_KEY)
    state.update(
        last_job_id=job_id,
        last_attempt_at=_now_iso(),
        last_attempt_by=email,
        last_result="running",
        last_error=None,
    )
    try:
        await db.set_meta(_AUTO_META_KEY, json.dumps(state))
    except Exception:
        logger.exception("failed to record auto-refresh start")


async def _record_auto_outcome(db, job_id: str, email: Optional[str],
                               failure_kind: Optional[str],
                               error: Optional[str]) -> None:
    """Success clears the cooldown. A failure starts a cooldown for everyone
    and skips this visitor for a while, since their token is the likely cause
    (no Snowflake user, narrower access)."""
    now = datetime.now(timezone.utc)
    state = await _read_json_meta(db, _AUTO_META_KEY)
    skip = {
        e: until for e, until in (state.get("skip") or {}).items()
        if (_parse_dt(until) or now) > now
    }
    if failure_kind is None:
        state.update(last_result="done", last_error=None, cooldown_until=None)
    else:
        kind = failure_kind if failure_kind in _AUTO_COOLDOWN else "error"
        state.update(
            last_result="rejected" if kind == "row_guard" else "error",
            last_error=error,
            cooldown_until=_iso(now + _AUTO_COOLDOWN[kind]),
        )
        if email:
            skip[email] = _iso(now + _AUTO_USER_SKIP[kind])
    state.update(skip=skip, last_job_id=job_id, last_finished_at=_iso(now))
    try:
        await db.set_meta(_AUTO_META_KEY, json.dumps(state))
    except Exception:
        logger.exception("failed to record auto-refresh outcome")


async def _prune_history(db) -> None:
    try:
        deleted = await db.prune_snapshot_history("active")
    except Exception:
        logger.exception("snapshot retention prune failed")
        return
    if deleted:
        logger.info("snapshot retention deleted %d uploads: %s", len(deleted), deleted)


def _slot_error(slots: dict) -> Optional[str]:
    return next((s.get("error") for s in (slots or {}).values() if s.get("error")), None)


async def _run_job(db, token: Optional[str], settings, job_id: str, *,
                   kind: str = "manual", email: Optional[str] = None) -> None:
    failure_kind: Optional[str] = None
    try:
        overrides = await _read_sf_overrides(db)
        min_rows = None
        if kind == "auto":
            baseline = (await db.latest_upload_state("active"))["row_count"]
            if baseline:
                min_rows = int(baseline * _AUTO_MIN_ROW_RATIO)
        result = await warehouse.refresh_all(
            db, token, settings, kind=kind, overrides=overrides, min_rows=min_rows,
        )
        _job["mode"] = result.get("mode")
        _job["slots"] = result.get("slots", {})
        _job["finished_at"] = _now_iso()
        if result.get("ok"):
            _job["status"] = "done"
            _job["error"] = None
        else:
            _job["status"] = "error"
            _job["error"] = _slot_error(_job["slots"]) or "one or more slots failed"
            failure_kind = result.get("error_kind") or "error"
    except Exception as exc:  # noqa: BLE001 — never leak token in the message
        _job["status"] = "error"
        _job["finished_at"] = _now_iso()
        _job["error"] = f"{type(exc).__name__}: {exc}"
        failure_kind = "error"
        logger.exception("snowflake refresh job failed job_id=%s", job_id)
    finally:
        succeeded = _job["status"] == "done"
        await _persist(db)
        if kind == "auto":
            await _record_auto_outcome(db, job_id, email, failure_kind, _job["error"])
        await _release_lease(db, job_id)
    if succeeded:
        await _prune_history(db)


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


def _in_progress(job_id, started_at, kind) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "ok": False,
            "error": "refresh_in_progress",
            "job_id": job_id,
            "status": "running",
            "started_at": started_at,
            "kind": kind,
        },
    )


def _start_job(db, token: Optional[str], settings, job_id: str, *,
               kind: str, email: Optional[str], simulated: bool) -> None:
    global _job_task
    _job.update(
        status="running",
        job_id=job_id,
        started_at=_now_iso(),
        finished_at=None,
        mode="simulated" if simulated else "real",
        kind=kind,
        slots={},
        error=None,
    )
    _job_task = asyncio.create_task(
        _run_job(db, token, settings, job_id, kind=kind, email=email)
    )


@router.post("/refresh")
async def trigger_refresh(
    request: Request,
    owner: ResolvedUser = Depends(require_owner),
):
    db = _db(request)
    settings = get_settings()

    if _job["status"] == "running":
        return _in_progress(_job["job_id"], _job["started_at"], _job["kind"])

    # Per-request OAuth token — in memory only, never logged/persisted.
    token = request.headers.get(_TOKEN_HEADER)
    simulated = warehouse.effective_simulated(token, settings)

    job_id = uuid.uuid4().hex
    if not await _claim_lease(db, job_id, "manual", owner.email):
        lease = await _active_lease(db) or {}
        return _in_progress(lease.get("job_id"), lease.get("started_at"), lease.get("kind"))
    _start_job(db, token, settings, job_id, kind="manual", email=owner.email,
               simulated=simulated)

    logger.info("snowflake refresh started job_id=%s mode=%s", job_id, _job["mode"])
    return {
        "ok": True,
        "job_id": job_id,
        "status": "running",
        "started_at": _job["started_at"],
        "mode": _job["mode"],
    }


@router.post("/refresh/auto")
async def trigger_auto_refresh(
    request: Request,
    user: ResolvedUser = Depends(require_signed_in),
):
    """Stale-while-revalidate: start a background refresh when the newest
    active snapshot is older than the cadence, otherwise report "fresh".
    Never blocks on Snowflake; the caller keeps the cached data either way."""
    db = _db(request)
    settings = get_settings()
    overrides = await _read_sf_overrides(db)
    hours = _auto_hours(overrides)

    def answer(status: str, synced_at: Optional[datetime], **extra) -> dict:
        due_at = synced_at + timedelta(hours=hours) if synced_at and hours else None
        return {
            "ok": True,
            "status": status,
            "hours": hours,
            "last_synced_at": _iso(synced_at),
            "due_at": _iso(due_at),
            **extra,
        }

    def is_fresh(synced_at: Optional[datetime]) -> bool:
        return bool(synced_at) and now < synced_at + timedelta(hours=hours)

    now = datetime.now(timezone.utc)
    synced_at = (await db.latest_upload_state("active"))["synced_at"]
    if hours <= 0:
        return answer("disabled", synced_at, reason="off")
    if settings.snowflake_simulated:
        return answer("disabled", synced_at, reason="simulated")
    if is_fresh(synced_at):
        return answer("fresh", synced_at)
    if _job["status"] == "running":
        return answer("running", synced_at, started_at=_job["started_at"])

    # Per-request OAuth token — in memory only, never logged/persisted.
    token = request.headers.get(_TOKEN_HEADER)
    if not (token and token.strip()):
        return answer("stale", synced_at, reason="no_token")
    state = await _read_json_meta(db, _AUTO_META_KEY)
    cooldown_until = _parse_dt(state.get("cooldown_until"))
    if cooldown_until and now < cooldown_until:
        return answer("stale", synced_at, reason="cooldown",
                      retry_after=_iso(cooldown_until))
    skip_until = _parse_dt((state.get("skip") or {}).get(user.email))
    if skip_until and now < skip_until:
        return answer("stale", synced_at, reason="not_eligible")

    job_id = uuid.uuid4().hex
    if not await _claim_lease(db, job_id, "auto", user.email):
        lease = await _active_lease(db) or {}
        return answer("running", synced_at, started_at=lease.get("started_at"))
    # A run on another instance may have landed between the check and the claim.
    synced_at = (await db.latest_upload_state("active"))["synced_at"]
    if is_fresh(synced_at):
        await _release_lease(db, job_id)
        return answer("fresh", synced_at)

    await _record_auto_start(db, job_id, user.email)
    _start_job(db, token, settings, job_id, kind="auto", email=user.email,
               simulated=False)
    logger.info(
        "snowflake auto-refresh started job_id=%s by=%s last_synced_at=%s",
        job_id, user.email, _iso(synced_at),
    )
    return answer("started", synced_at, job_id=job_id, started_at=_job["started_at"])


async def _auto_summary(db, settings, overrides: dict, *, private: bool = False) -> dict:
    hours = _auto_hours(overrides)
    synced_at = None
    if db is not None:
        try:
            synced_at = (await db.latest_upload_state("active"))["synced_at"]
        except Exception:
            synced_at = None
    state = await _read_json_meta(db, _AUTO_META_KEY)
    out = {
        "enabled": hours > 0 and not settings.snowflake_simulated,
        "hours": hours,
        "last_synced_at": _iso(synced_at),
        "due_at": _iso(synced_at + timedelta(hours=hours)) if synced_at and hours else None,
        "last_attempt_at": state.get("last_attempt_at"),
        "last_finished_at": state.get("last_finished_at"),
        "last_result": state.get("last_result"),
        "cooldown_until": state.get("cooldown_until"),
        "retention": {
            "keep_all_days": SNAPSHOT_KEEP_ALL_DAYS,
            "keep_weekly_weeks": SNAPSHOT_KEEP_WEEKLY_WEEKS,
        },
    }
    if private:
        now = datetime.now(timezone.utc)
        out["last_attempt_by"] = state.get("last_attempt_by")
        out["last_error"] = state.get("last_error")
        out["skipped_users"] = {
            e: until for e, until in (state.get("skip") or {}).items()
            if (_parse_dt(until) or now) > now
        }
    return out


@router.get("/refresh-status")
async def refresh_status(request: Request):
    settings = get_settings()
    db = getattr(request.app.state, "db", None)
    persisted = await _read_meta(db)
    lease = await _active_lease(db)

    if _job["status"] == "running":
        base = dict(_job)
        base["data_as_of"] = persisted.get("data_as_of")
    elif lease:
        # Running on another instance; its own _job holds the details.
        base = {
            **persisted,
            "status": "running",
            "job_id": lease.get("job_id"),
            "started_at": lease.get("started_at"),
            "finished_at": None,
            "kind": lease.get("kind"),
            "slots": {},
            "error": None,
        }
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
        "kind": base.get("kind"),
        "slots": base.get("slots") or {},
        "error": base.get("error"),
        "simulated": settings.snowflake_simulated,
        "auto": await _auto_summary(db, settings, _status_overrides),
        # Effective connection + query settings = env/config defaults with any
        # admin-UI overrides applied, so the card shows what will actually run.
        "settings": {
            "mode": "simulated" if settings.snowflake_simulated else "real",
            **warehouse.effective_conn(settings, _status_overrides),
            **warehouse.effective_params_dict(_status_overrides),
            "auto_refresh_hours": _auto_hours(_status_overrides),
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
        "auto": await _auto_summary(db, settings, overrides, private=True),
        "auto_defaults": {"auto_refresh_hours": AUTO_REFRESH_DEFAULT_HOURS},
        "mode": "simulated" if settings.snowflake_simulated else "real",
    }


@router.put("/snowflake-config")
async def put_snowflake_config(
    request: Request,
    _owner: ResolvedUser = Depends(require_owner),
):
    """Persist admin-editable Snowflake overrides. Connection fields (account/
    warehouse/database/schema/role) are strings; query fields (n_past/n_future/
    min_arr/band_cutoff) and auto_refresh_hours (0 = off) are numbers. Any
    field omitted (or null) keeps its prior value; blank/invalid query numbers
    fall back to the code default.
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
    raw_hours = body.get("auto_refresh_hours")
    if raw_hours is not None and not (isinstance(raw_hours, str) and not raw_hours.strip()):
        try:
            hours = float(raw_hours)
        except (TypeError, ValueError):
            hours = -1.0
        if math.isnan(hours) or not 0 <= hours <= _AUTO_MAX_HOURS:
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "error": f"auto_refresh_hours must be between 0 and {_AUTO_MAX_HOURS}",
                },
            )
        clean["auto_refresh_hours"] = int(hours) if hours.is_integer() else hours
    await db.set_meta(_CONFIG_META_KEY, json.dumps(clean))
    settings = get_settings()
    return {
        "ok": True,
        "overrides": clean,
        "config": warehouse.effective_conn(settings, clean),
        "query": warehouse.effective_params_dict(clean),
        "auto_refresh_hours": _auto_hours(clean),
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
