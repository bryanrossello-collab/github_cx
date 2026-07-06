"""Liveness and readiness probes for Cloud Run / Vibe.

Pattern matches the Signal CX app: `/healthz` is always 200, `/readyz`
reads ``app.state.db_status`` to decide.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request, Response, status

from app.config import get_settings

router = APIRouter(tags=["health"])

_BOOT_TIME = time.monotonic()


@router.get("/healthz")
async def healthz() -> dict:
    """Liveness probe — 200 whenever the process is alive."""
    return {"status": "ok", "uptime_sec": int(time.monotonic() - _BOOT_TIME)}


# Legacy alias: the bundled dashboard probes /api/health (not /healthz) to
# decide whether it's running in "server mode" and should fetch notes /
# CSVs from the API. If this 404s, the dashboard falls back to offline-
# only mode. Returning the same shape as /healthz plus `apps: []` keeps
# the dashboard in server mode while silencing the (deprecated) "Ask
# Claude" probe.
@router.get("/api/health", include_in_schema=False)
async def api_health(request: Request) -> dict:
    """Dashboard probes this to stay in server mode. Extra keys are for
    operators; the bundled React app only checks ``ok``."""
    state = request.app.state
    db_status = getattr(state, "db_status", "unknown")
    settings = get_settings()
    return {
        "ok": True,
        "app": "renewals-studio",
        "version": "3.2.0",
        "uptime_sec": int(time.monotonic() - _BOOT_TIME),
        "apps": [],
        "db_configured": getattr(state, "db", None) is not None,
        "db_status": db_status,
        "schema_ready": db_status == "ready",
        "strict_auth": settings.effective_strict_auth,
        "auto_provision_users": settings.auto_provision_users,
    }


@router.get("/readyz")
async def readyz(request: Request, response: Response) -> dict:
    """Readiness probe — gates traffic on the database.

    Returns 503 (with a structured body) any time the server is not yet
    ready to serve real traffic — during draining, while the DB pool is
    still being established at startup, or if the DB has gone unhealthy.
    """
    state = request.app.state
    db_status = getattr(state, "db_status", "unknown")
    seeded = getattr(state, "seeded", False)
    last_error = getattr(state, "db_last_error", None)
    attempts = getattr(state, "connect_attempts", 0)

    payload_base = {
        "uptime_sec": int(time.monotonic() - _BOOT_TIME),
        "db_status": db_status,
        "db_last_error": last_error,
        "connect_attempts": attempts,
        "seeded": seeded,
    }

    if getattr(state, "shutting_down", False):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "draining", "ready": False, **payload_base}

    db = getattr(state, "db", None)
    if db is None or db_status != "ready":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "starting", "ready": False, **payload_base}

    db_ok = await db.healthcheck()
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unhealthy", "ready": False, "db": False, **payload_base}

    return {"status": "ok", "ready": True, "db": True, **payload_base}
