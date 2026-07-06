"""Admin endpoints for DB diagnostics and CSV upload management.

Authentication: signed-in user with ``role=admin`` from header-based SSO
(Pomerium / oauth2-proxy / Cloud IAP). No shared password.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth import require_admin, require_owner
from app.config import get_settings
from app.database import DatabaseUnavailable

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# /admin/db-status — diagnostic readout
# ---------------------------------------------------------------------------

@router.get("/db-status", dependencies=[Depends(require_admin)])
async def db_status(request: Request) -> dict:
    """Diagnostic readout consumed by the /admin status panel.

    Returns a flat object with explicit, redundancy-free field names so
    the JS doesn't have to derive booleans or rename keys.
    """
    cfg = get_settings()
    state = request.app.state
    db = getattr(state, "db", None)

    db_status_str = getattr(state, "db_status", "unknown")
    is_ready = (db_status_str == "ready")

    payload: dict = {
        # Status flags (booleans the UI binds directly).
        "ok": is_ready,
        "db_connected": is_ready or db_status_str in ("ready", "schema-error", "seed-error"),
        "schema_ready": is_ready,
        "db_status": db_status_str,
        # Connection diagnostic (renamed for clarity; old names kept as
        # mirrors so callers reading either keep working).
        "via": "DATABASE_URL" if cfg.database_url else "discrete",
        "target_host": cfg.pg_host,
        "host": cfg.pg_host,
        "target_port": cfg.pg_port,
        "db_name": cfg.pg_database,
        "database": cfg.pg_database,
        "db_user": cfg.pg_user,
        "user": cfg.pg_user,
        "db_sslmode": cfg.db_ssl,
        "ssl": cfg.db_ssl,
        "is_unix_socket": cfg.is_unix_socket,
        # Retry diagnostics
        "connect_attempts": getattr(state, "connect_attempts", 0),
        "last_error": getattr(state, "db_last_error", None),       # admin.html reads this
        "db_last_error": getattr(state, "db_last_error", None),    # alternate name
        "seeded": getattr(state, "seeded", False),
        "started_at": getattr(state, "started_at", None),
        # Config toggles
        "seed_on_startup": cfg.seed_on_startup,
        "admin_token_set": bool(cfg.admin_token),
    }

    if db is None:
        return payload

    # Pull live pool stats + row counts when the pool is up.
    try:
        async with db.acquire() as conn:
            payload["db_version"] = await conn.fetchval("SHOW server_version")
            row_counts: dict = {}
            for table in (
                "notes", "note_tombstones", "csv_uploads",
                "schema_migrations", "renewals_meta", "account_snapshots",
            ):
                try:
                    c = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
                    row_counts[table] = int(c) if c is not None else 0
                except Exception as exc:
                    row_counts[table] = f"error: {type(exc).__name__}"
            payload["row_counts"] = row_counts
    except DatabaseUnavailable:
        pass
    except Exception as exc:
        payload["db_query_error"] = f"{type(exc).__name__}: {exc}"

    try:
        size = db.pool.get_size()
        idle = db.pool.get_idle_size()
        payload["pool_size"] = size
        payload["pool_idle"] = idle
        payload["pool_in_use"] = max(size - idle, 0)
    except Exception:
        payload["pool_size"] = "unknown"

    return payload


# ---------------------------------------------------------------------------
# /admin/wipe-all-uploads — clears csv_uploads + account_snapshots so the
# admin can re-start from a clean slate. Auth-protected; double-confirm via
# ?confirm=yes so a stray click can't nuke the data.
# ---------------------------------------------------------------------------

@router.post("/wipe-all-uploads", dependencies=[Depends(require_owner)])
async def wipe_all_uploads(request: Request, confirm: str = "") -> dict:
    if confirm.lower() != "yes":
        raise HTTPException(
            status_code=400,
            detail="missing ?confirm=yes — refusing to wipe without explicit confirmation",
        )
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    async with db.acquire() as conn:
        async with conn.transaction():
            # account_snapshots will be cascade-deleted by the FK on
            # csv_uploads.id, but we delete it explicitly first so the
            # row counts in the response are clean.
            n_snap = await conn.fetchval("SELECT COUNT(*) FROM account_snapshots")
            n_csv = await conn.fetchval("SELECT COUNT(*) FROM csv_uploads")
            await conn.execute("DELETE FROM account_snapshots")
            await conn.execute("DELETE FROM csv_uploads")
            # Reset the seed marker so the operator can re-trigger an
            # auto-seed if they later flip SEED_ON_STARTUP back on.
            await conn.execute(
                "DELETE FROM renewals_meta WHERE key = 'initialized'"
            )
    return {
        "ok": True,
        "deleted_snapshots": int(n_snap or 0),
        "deleted_uploads": int(n_csv or 0),
    }


# ---------------------------------------------------------------------------
# /admin/csv-uploads — list + manage upload history (token-protected)
# ---------------------------------------------------------------------------

@router.get("/csv-uploads", dependencies=[Depends(require_owner)])
async def list_uploads(
    request: Request, limit: int = 100, slot: Optional[str] = None,
) -> dict:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    limit = max(1, min(int(limit), 500))
    async with db.acquire() as conn:
        if slot in ("active", "historical"):
            rows = await conn.fetch(
                "SELECT id, slot, filename, content_type, size_bytes, sha256, "
                "       uploaded_at, uploaded_by, note "
                "FROM csv_uploads WHERE slot = $1 "
                "ORDER BY uploaded_at DESC LIMIT $2",
                slot, limit,
            )
        else:
            rows = await conn.fetch(
                "SELECT id, slot, filename, content_type, size_bytes, sha256, "
                "       uploaded_at, uploaded_by, note "
                "FROM csv_uploads ORDER BY uploaded_at DESC LIMIT $1",
                limit,
            )
    items = [
        {
            "id": r["id"],
            "slot": r["slot"],
            "filename": r["filename"],
            "content_type": r["content_type"],
            "size_bytes": r["size_bytes"],
            "sha256": r["sha256"],
            "uploaded_at": r["uploaded_at"].isoformat(),
            "uploaded_by": r["uploaded_by"],
            "note": r["note"],
        }
        for r in rows
    ]
    return {"ok": True, "count": len(items), "items": items}


@router.get(
    "/csv-uploads/{upload_id}/download",
    dependencies=[Depends(require_owner)],
)
async def download_upload(request: Request, upload_id: int) -> Response:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT filename, content_type, content FROM csv_uploads WHERE id = $1",
            upload_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail="upload not found")
    return Response(
        content=bytes(row["content"]),
        media_type=row["content_type"] or "text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{row["filename"]}"',
            "Cache-Control": "no-store",
        },
    )


@router.delete(
    "/csv-uploads/{upload_id}",
    dependencies=[Depends(require_owner)],
)
async def delete_upload(request: Request, upload_id: int) -> dict:
    """Delete a historical version. The dashboard's splash gate handles
    the empty-data state gracefully (Go to Admin), so we allow deleting
    even the last remaining upload per slot — useful for starting fresh."""
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT slot FROM csv_uploads WHERE id = $1", upload_id
        )
        if row is None:
            raise HTTPException(status_code=404, detail="upload not found")
        await conn.execute("DELETE FROM csv_uploads WHERE id = $1", upload_id)
    return {"ok": True, "deleted_id": upload_id}
