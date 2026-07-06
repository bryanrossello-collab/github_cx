"""FastAPI application entry point.

Startup is deliberately non-blocking on the database. The HTTP listener
binds immediately, ``/healthz`` is 200 from the first second, and
``/readyz`` stays 503 until the DB pool is open + schema applied +
(optionally) the seed completes. If Postgres isn't reachable when the
container boots, we retry with exponential backoff for up to
``DB_STARTUP_TIMEOUT_S`` (default 5 min).

Shape mirrors the Signal CX app's lifespan so the same App Foundry /
Vibe infrastructure can host this without any custom wiring.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware

from app.config import get_settings
from app.database import Database, DatabaseUnavailable
from app.logging_setup import configure_logging
from app.routes import admin, auth_api, health, renewals
from app.auth import resolve_user

logger = logging.getLogger("renewals_studio")

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"

# Background startup tuning — overridable via env vars (no Pydantic wrapper
# because these only matter during boot and are easier to tweak at the
# platform layer than in code).
DB_STARTUP_TIMEOUT_S = float(os.environ.get("DB_STARTUP_TIMEOUT_S", "300"))
DB_BACKOFF_INITIAL_S = float(os.environ.get("DB_BACKOFF_INITIAL_S", "1.0"))
DB_BACKOFF_MAX_S = float(os.environ.get("DB_BACKOFF_MAX_S", "20.0"))


# ---------------------------------------------------------------------------
# Security headers — cheap, applies to every response.
# ---------------------------------------------------------------------------

class AttachUserMiddleware(BaseHTTPMiddleware):
    """Resolve proxy identity on every request → request.state.user."""

    async def dispatch(self, request: Request, call_next):
        request.state.user = await resolve_user(request)
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "interest-cohort=()")
        return response


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

async def _bring_db_online(app: FastAPI, db: Database) -> None:
    """Connect with retry, apply schema, optionally seed.

    Runs as a background task so the HTTP server isn't blocked. Updates
    ``app.state.db_status`` so /readyz and /admin/db-status can surface
    progress + the cause of any failure.
    """
    settings = get_settings()
    started_at = asyncio.get_event_loop().time()
    delay = DB_BACKOFF_INITIAL_S
    app.state.db_status = "connecting"
    app.state.db_last_error = None
    app.state.connect_attempts = 0

    while True:
        app.state.connect_attempts += 1
        try:
            await db.connect()
            break
        except Exception as exc:
            elapsed = asyncio.get_event_loop().time() - started_at
            remaining = DB_STARTUP_TIMEOUT_S - elapsed
            app.state.db_last_error = f"{type(exc).__name__}: {exc}"
            if remaining <= 0:
                logger.error("Giving up on database after %.0fs: %s", elapsed, exc)
                app.state.db_status = "unreachable"
                return
            logger.warning(
                "Database not reachable yet (%s); retrying in %.1fs (%.0fs left)",
                exc, delay, remaining,
            )
            await asyncio.sleep(min(delay, remaining))
            delay = min(delay * 2, DB_BACKOFF_MAX_S)

    app.state.db = db
    app.state.db_status = "ready"
    app.state.db_last_error = None
    logger.info("Database connected after %d attempt(s)", app.state.connect_attempts)

    try:
        await db.ensure_schema()
    except Exception:
        logger.exception("Schema setup failed")
        app.state.db_status = "schema-error"
        return

    try:
        await db.migrate_identity_keys()
    except Exception:
        logger.exception("Identity-key migration failed")
        app.state.db_status = "schema-error"
        return

    try:
        await db.migrate_account_call_events()
    except Exception:
        logger.exception("Account call events migration failed")
        app.state.db_status = "schema-error"
        return

    try:
        profiles = settings.bootstrap_admin_profiles()
        if profiles:
            n = await db.seed_bootstrap_admins(profiles)
            logger.info("Bootstrap admins seeded (%d)", n)
        owner_profiles = settings.bootstrap_owner_profiles()
        if owner_profiles:
            n_own = await db.seed_bootstrap_owners(owner_profiles)
            logger.info("Bootstrap owners seeded (%d)", n_own)
    except Exception:
        logger.exception("Bootstrap admin seed failed")
        app.state.db_status = "schema-error"
        return

    seeded = False
    if settings.seed_on_startup:
        try:
            already_initialised = await db.is_seeded()
            if not already_initialised:
                logger.info(
                    "Database has never been initialised — seeding bundled CSVs "
                    "from /app/seeds (idempotent; tracked by renewals_meta.initialized)"
                )
                n = await db.seed_csv_uploads_if_empty()
                await db.set_meta(
                    "initialized",
                    f"{datetime.now(timezone.utc).isoformat()} csvs={n}",
                )
                seeded = True
            else:
                logger.info("Skipping auto-seed — renewals_meta.initialized exists")
                seeded = True
        except Exception:
            logger.exception("Seed failed")
            app.state.db_status = "seed-error"
            return

    app.state.seeded = seeded
    app.state.started_at = datetime.now(timezone.utc).isoformat()
    logger.info("Startup complete: DB online, seeded=%s", seeded)


def _begin_drain(app: FastAPI) -> None:
    if not app.state.shutting_down:
        logger.info("Received termination signal; marking not-ready and draining")
        app.state.shutting_down = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info(
        "Starting %s v3.1.0 in %s — %s",
        settings.app_name, settings.environment, settings.banner(),
    )

    app.state.settings = settings
    app.state.db = None
    app.state.seeded = False
    app.state.shutting_down = False
    app.state.db_status = "pending"
    app.state.db_last_error = None
    app.state.connect_attempts = 0

    # No credentials path — straight from env vars (DATABASE_URL or DB_*).
    db = Database(
        database_url=settings.database_url_normalised,
        host=settings.pg_host,
        port=settings.pg_port,
        user=settings.pg_user,
        password=settings.pg_password,
        database=settings.pg_database,
        ssl=settings.ssl_param,
        pool_max=settings.db_pool_max,
    )
    db_task = asyncio.create_task(_bring_db_online(app, db))

    # Cooperative SIGTERM drain — flip /readyz to 503 immediately so the
    # platform stops sending us new requests while we let in-flight ones
    # finish.
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _begin_drain, app)
        except (NotImplementedError, RuntimeError):
            # NotImplementedError on non-Unix, RuntimeError when not on the
            # main thread (TestClient).
            pass

    try:
        yield
    finally:
        logger.info("Shutting down: draining for %.1fs", settings.shutdown_drain_seconds)
        app.state.shutting_down = True
        try:
            await asyncio.sleep(min(settings.shutdown_drain_seconds, 30.0))
        except asyncio.CancelledError:
            pass
        if not db_task.done():
            db_task.cancel()
            try:
                await db_task
            except (asyncio.CancelledError, Exception):
                pass
        if app.state.db is not None:
            try:
                await app.state.db.close()
            except Exception:
                logger.exception("Pool close failed")
        logger.info("Shutdown complete")


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    app = FastAPI(
        title="Renewals Studio",
        version="3.2.0",
        description=(
            "Renewals Intelligence Studio container — FastAPI + asyncpg + "
            "Cloud SQL Postgres. Modelled on the Signal CX deployment pattern."
        ),
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AttachUserMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

    app.include_router(health.router)
    app.include_router(auth_api.router)
    app.include_router(admin.router)
    app.include_router(renewals.router)
    app.include_router(renewals.legacy_router)

    # ----- Static frontend -------------------------------------------------
    if (PUBLIC_DIR / "vendor").exists():
        app.mount(
            "/vendor",
            StaticFiles(directory=PUBLIC_DIR / "vendor"),
            name="vendor",
        )

    @app.get("/", include_in_schema=False)
    async def root() -> FileResponse:
        return FileResponse(PUBLIC_DIR / "index.html", media_type="text/html")

    @app.get("/admin", include_in_schema=False)
    async def admin_root() -> FileResponse:
        return FileResponse(PUBLIC_DIR / "admin.html", media_type="text/html")

    @app.get("/admin.html", include_in_schema=False)
    async def admin_root_html() -> FileResponse:
        return FileResponse(PUBLIC_DIR / "admin.html", media_type="text/html")

    @app.get("/index.html", include_in_schema=False)
    async def index_html() -> FileResponse:
        return FileResponse(PUBLIC_DIR / "index.html", media_type="text/html")

    # 503 for "DB is down" — every endpoint that uses `db.acquire()` gets
    # the right status code for free via this handler.
    @app.exception_handler(DatabaseUnavailable)
    async def db_unavailable(request: Request, exc: DatabaseUnavailable):
        logger.warning(
            "db_unavailable path=%s db_status=%s",
            request.url.path, getattr(request.app.state, "db_status", "unknown"),
        )
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "5"},
            content={
                "ok": False,
                "error": "database unavailable",
                "db_status": getattr(request.app.state, "db_status", "unknown"),
                "db_last_error": getattr(request.app.state, "db_last_error", None),
                "connect_attempts": getattr(request.app.state, "connect_attempts", 0),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        logger.error(
            "unhandled_exception path=%s error_type=%s error=%s",
            request.url.path, type(exc).__name__, exc,
        )
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": "internal server error"},
        )

    return app


app = create_app()
