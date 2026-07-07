"""/api/renewals/* — the contract the bundled React dashboard speaks.

Wire shapes are FROZEN. The dashboard expects:

  GET  /api/renewals/notes
       -> { "notes": { "<noteKey>": <payload>, ... },
            "noteDeletes": { "<noteKey>": <unix-ms>, ... },
            "savedAt": "<ISO-8601> | null" }

  PUT  /api/renewals/notes
       body: { "notes": {...}, "noteDeletes": {...} }
       -> { ok, savedAt, noteCount, deleteCount }

  GET  /api/renewals/csv-list
       -> { "files": [ { name, size, mtime (unix-ms) }, ... ] }

  GET  /api/renewals/data-source/info?match=<substring>
       -> { ok, found, directory?, filename?, size?, mtime (ISO),
            mtimeMs, format } for the newest matching upload

  GET  /api/renewals/data-source/file?match=<substring>
       streams text/csv; charset=utf-8 with X-Source-* headers

  POST /api/renewals/upload-csv?name=<filename>&slot=<active|historical>
       Admin-only — requires SSO identity with role=admin (same as /admin).
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from app.auth import require_admin, require_owner, require_signed_in, get_current_user, ResolvedUser
from app.call_keys import build_call_key, parse_call_key
from app.database import DatabaseUnavailable
from app.ingest import resolve_effective_date

router = APIRouter(prefix="/api/renewals", tags=["renewals"])

# Legacy compatibility router for the macOS-app URL pattern that the
# compiled dashboard falls back to when /api/renewals/data-source/info
# returns found=false. The original app served CSVs out of an
# /apps/renewals/<filename> filesystem mount; we serve them out of
# Postgres but keep the URL working so the dashboard's secondary
# fallback path doesn't 404.
legacy_router = APIRouter(tags=["renewals-legacy"])


# ---------------------------------------------------------------------------
# DB helper
# ---------------------------------------------------------------------------

def _db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    return db


# ---------------------------------------------------------------------------
# Notes: DB row <-> wire shape translation
# ---------------------------------------------------------------------------

COLUMN_TO_WIRE = {
    "note_text":     "note",
    "dj_forecast":   "djForecast",  # wire key preserved; UI label is "ELT Forecast"
    "archived":      "archived",
    "account_id":    "accountId",
    "account_name":  "accountName",
    "owner":         "owner",
    "renewal_date":  "renewalDate",
    "fq":            "fq",
    "atr":           "atr",
    "account_label": "accountLabel",
    "history":       "history",
    "updated_at":    "updatedAt",
    "owner_email":   "ownerEmail",
    "last_edited_by": "editedBy",
    "last_edited_display": "editedByDisplay",
}


def _row_to_wire(row: dict) -> dict:
    out: dict = {}
    for col, wire in COLUMN_TO_WIRE.items():
        v = row.get(col)
        if v is None:
            continue
        if col == "dj_forecast":
            try:
                out[wire] = float(v)
            except (TypeError, ValueError):
                out[wire] = None
        elif col == "updated_at":
            out[wire] = int(v.timestamp() * 1000)
        elif col == "atr":
            try:
                out[wire] = float(v)
            except (TypeError, ValueError):
                out[wire] = 0
        elif col == "history":
            out[wire] = v if isinstance(v, list) else []
        else:
            out[wire] = v
    return out


def _ms_to_aware_dt(ms) -> Optional[datetime]:
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000.0, tz=timezone.utc)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Notes endpoints
# ---------------------------------------------------------------------------

@router.get("/notes")
async def get_notes(request: Request) -> dict:
    db = _db(request)
    async with db.acquire() as conn:
        note_rows = await conn.fetch(
            "SELECT note_key, note_text, dj_forecast, archived, account_id, "
            "       account_name, owner, renewal_date, fq, atr, account_label, "
            "       history, updated_at, owner_email, last_edited_by, "
            "       last_edited_display FROM notes"
        )
        tomb_rows = await conn.fetch(
            "SELECT note_key, deleted_at FROM note_tombstones"
        )
        saved_at_row = await conn.fetchrow(
            "SELECT value FROM renewals_meta WHERE key = 'notes_saved_at'"
        )

    notes_obj = {row["note_key"]: _row_to_wire(dict(row)) for row in note_rows}
    deletes_obj = {
        row["note_key"]: int(row["deleted_at"].timestamp() * 1000)
        for row in tomb_rows
    }
    saved_at = saved_at_row["value"] if saved_at_row else None
    return {"notes": notes_obj, "noteDeletes": deletes_obj, "savedAt": saved_at}


@router.put("/notes")
async def put_notes(
    request: Request,
    user: ResolvedUser = Depends(require_signed_in),
) -> dict:
    db = _db(request)
    body = await request.json()
    notes = body.get("notes") if isinstance(body, dict) else None
    note_deletes = body.get("noteDeletes") if isinstance(body, dict) else None
    if not isinstance(notes, dict):
        raise HTTPException(status_code=400, detail="body.notes must be an object")
    if not isinstance(note_deletes, dict):
        note_deletes = {}

    saved_at = datetime.now(timezone.utc)
    editor_email = (user.email or "").lower()
    editor_display = user.display_name or editor_email or "unknown"
    denied_keys: list[str] = []

    async with db.acquire() as conn:
        async with conn.transaction():
            for key, payload in notes.items():
                if not isinstance(payload, dict):
                    continue
                existing = await conn.fetchrow(
                    "SELECT owner_email, note_text, dj_forecast, history "
                    "FROM notes WHERE note_key = $1",
                    key,
                )
                owner = (existing["owner_email"] or "").lower() if existing else ""
                if owner and owner != editor_email and not user.is_admin:
                    denied_keys.append(key)
                    continue

                updated_at = _ms_to_aware_dt(payload.get("updatedAt")) or saved_at
                history = payload.get("history") or []
                if not isinstance(history, list):
                    history = []

                # Enrich history when the server detects a content change.
                if existing:
                    old_note = existing["note_text"] or ""
                    new_note = str(payload.get("note", ""))
                    old_dj = existing["dj_forecast"]
                    new_dj = payload.get("djForecast")
                    changed = (old_note != new_note) or (old_dj != new_dj)
                    if changed:
                        prev_ts = existing["updated_at"]
                        ts_ms = (
                            int(prev_ts.timestamp() * 1000)
                            if prev_ts is not None
                            else int(updated_at.timestamp() * 1000)
                        )
                        entry = {
                            "note": old_note,
                            "djForecast": float(old_dj) if old_dj is not None else None,
                            "timestamp": ts_ms,
                            "editedBy": editor_email,
                            "editedByDisplay": editor_display,
                        }
                        history = [entry, *history][:20]

                owner_email = owner or editor_email
                await conn.execute(
                    """
                    INSERT INTO notes
                        (note_key, note_text, dj_forecast, archived, account_id,
                         account_name, owner, renewal_date, fq, atr, account_label,
                         history, updated_at, owner_email, last_edited_by,
                         last_edited_display)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                            $14, $15, $16)
                    ON CONFLICT (note_key) DO UPDATE SET
                        note_text     = EXCLUDED.note_text,
                        dj_forecast   = EXCLUDED.dj_forecast,
                        archived      = EXCLUDED.archived,
                        account_id    = EXCLUDED.account_id,
                        account_name  = EXCLUDED.account_name,
                        owner         = EXCLUDED.owner,
                        renewal_date  = EXCLUDED.renewal_date,
                        fq            = EXCLUDED.fq,
                        atr           = EXCLUDED.atr,
                        account_label = EXCLUDED.account_label,
                        history       = EXCLUDED.history,
                        updated_at    = EXCLUDED.updated_at,
                        owner_email   = COALESCE(notes.owner_email, EXCLUDED.owner_email),
                        last_edited_by = EXCLUDED.last_edited_by,
                        last_edited_display = EXCLUDED.last_edited_display
                    WHERE notes.updated_at <= EXCLUDED.updated_at
                    """,
                    key,
                    str(payload.get("note", "")),
                    payload.get("djForecast"),
                    bool(payload.get("archived", False)),
                    payload.get("accountId"),
                    payload.get("accountName"),
                    payload.get("owner"),
                    payload.get("renewalDate"),
                    payload.get("fq"),
                    payload.get("atr"),
                    payload.get("accountLabel"),
                    json.dumps(history),
                    updated_at,
                    owner_email,
                    editor_email,
                    editor_display,
                )

            for key, when in note_deletes.items():
                deleted_at = _ms_to_aware_dt(when) or saved_at
                await conn.execute(
                    "INSERT INTO note_tombstones (note_key, deleted_at) "
                    "VALUES ($1, $2) "
                    "ON CONFLICT (note_key) DO UPDATE SET "
                    "  deleted_at = GREATEST(note_tombstones.deleted_at, EXCLUDED.deleted_at)",
                    key, deleted_at,
                )
                await conn.execute("DELETE FROM notes WHERE note_key = $1", key)

            await conn.execute(
                "INSERT INTO renewals_meta (key, value, updated_at) "
                "VALUES ('notes_saved_at', $1, NOW()) "
                "ON CONFLICT (key) DO UPDATE SET "
                "  value = EXCLUDED.value, updated_at = NOW()",
                saved_at.isoformat(),
            )

            note_count = await conn.fetchval("SELECT COUNT(*) FROM notes")
            delete_count = await conn.fetchval("SELECT COUNT(*) FROM note_tombstones")

    return {
        "ok": True,
        "savedAt": saved_at.isoformat(),
        "noteCount": int(note_count or 0),
        "deleteCount": int(delete_count or 0),
        "deniedKeys": denied_keys,
    }


# ---------------------------------------------------------------------------
# CSV list / data-source endpoints
# ---------------------------------------------------------------------------

@router.get("/csv-list")
async def csv_list(request: Request) -> dict:
    db = _db(request)
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT ON (slot) slot, filename, size_bytes, uploaded_at "
            "FROM csv_uploads ORDER BY slot, uploaded_at DESC"
        )
    files = [
        {
            "name": r["filename"],
            "size": int(r["size_bytes"]),
            "mtime": int(r["uploaded_at"].timestamp() * 1000),
        }
        for r in rows
    ]
    files.sort(key=lambda f: f["mtime"], reverse=True)
    return {"files": files}


async def _resolve_latest(conn, match: str) -> Optional[dict]:
    """Resolve the latest CSV upload for a dashboard query.

    The compiled React dashboard queries with two well-known sentinels:
      * match="2026 data"      → it means "the active slot"
      * match="historical fy27" → it means "the historical slot"
    Those sentinels were originally filename substrings on the macOS
    app's filesystem layout. Here we treat them as *slot* selectors so
    that a user-uploaded CSV with ANY filename (e.g.
    'renewal_Studio_upload_20260603 - Sheet1.csv') is still found as
    long as the upload was tagged with the right slot.

    Anything else is treated as a literal filename substring so callers
    can still drill into a specific file by name.
    """
    normalised = (match or "").strip().lower()
    slot_alias = {
        "2026 data": "active",
        "active": "active",
        "historical fy27": "historical",
        "historical": "historical",
    }.get(normalised)

    if slot_alias:
        row = await conn.fetchrow(
            "SELECT id, slot, filename, size_bytes, content_type, uploaded_at "
            "FROM csv_uploads WHERE slot = $1 "
            "ORDER BY uploaded_at DESC LIMIT 1",
            slot_alias,
        )
        if row is not None:
            return dict(row)
        # No row in that slot — fall through to substring match so a
        # caller passing the literal text still has a chance.
    if normalised:
        row = await conn.fetchrow(
            "SELECT id, slot, filename, size_bytes, content_type, uploaded_at "
            "FROM csv_uploads "
            "WHERE LOWER(filename) LIKE '%' || LOWER($1) || '%' "
            "ORDER BY uploaded_at DESC LIMIT 1",
            match,
        )
    else:
        row = await conn.fetchrow(
            "SELECT id, slot, filename, size_bytes, content_type, uploaded_at "
            "FROM csv_uploads ORDER BY uploaded_at DESC LIMIT 1"
        )
    return dict(row) if row else None


@router.get("/data-source/info")
async def data_source_info(request: Request, match: str = "") -> dict:
    db = _db(request)
    async with db.acquire() as conn:
        latest = await _resolve_latest(conn, match)
    if latest is None:
        return {"ok": True, "found": False, "configured": True, "match": match or None}
    return {
        "ok": True,
        "found": True,
        "directory": "postgres:csv_uploads",
        "filename": latest["filename"],
        "size": int(latest["size_bytes"]),
        "mtime": latest["uploaded_at"].isoformat(),
        "mtimeMs": int(latest["uploaded_at"].timestamp() * 1000),
        "format": "csv",
        "slot": latest["slot"],
    }


    return dict(row) if row else None


async def _resolve_latest_for_slot(conn, slot: str) -> Optional[dict]:
    """Newest upload for a slot ranked by snapshot effective_date."""
    row = await conn.fetchrow(
        """
        SELECT u.id, u.slot, u.filename, u.size_bytes, u.content_type, u.uploaded_at,
               COALESCE(MAX(s.effective_date), u.uploaded_at) AS effective_date
        FROM csv_uploads u
        LEFT JOIN account_snapshots s ON s.csv_upload_id = u.id
        WHERE u.slot = $1
        GROUP BY u.id, u.slot, u.filename, u.size_bytes, u.content_type, u.uploaded_at
        ORDER BY COALESCE(MAX(s.effective_date), u.uploaded_at) DESC, u.uploaded_at DESC
        LIMIT 1
        """,
        slot,
    )
    return dict(row) if row else None


def _parse_csv_header_row(raw_bytes: bytes) -> list[str]:
    text = raw_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    try:
        return next(reader)
    except StopIteration:
        return []


def _raw_row_to_dict(value) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _row_dedupe_key(row: dict) -> tuple[str, str]:
    acct = (
        row.get("CRM_ACCOUNT_ID")
        or row.get("crm_account_id")
        or row.get("ACCOUNT_ID")
        or row.get("account_id")
        or row.get("CRM_ACCOUNT_NAME")
        or row.get("account_name")
        or ""
    )
    quarter = (
        row.get("YEAR_QUARTER")
        or row.get("year_quarter")
        or row.get("FISCAL_QUARTER")
        or row.get("fiscal_quarter")
        or ""
    )
    return (str(acct).strip().lower(), str(quarter).strip().upper())


def _dedupe_raw_rows(rows: list[dict]) -> list[dict]:
    """One row per account+quarter — last row in file wins."""
    seen: dict[tuple[str, str], dict] = {}
    order: list[tuple[str, str]] = []
    for row in rows:
        key = _row_dedupe_key(row)
        if not key[0]:
            continue
        if key not in seen:
            order.append(key)
        seen[key] = row
    return [seen[k] for k in order]


@router.get("/parsed-data")
async def parsed_data(request: Request, slot: str = Query(default="active")) -> dict:
    """Return pre-parsed dashboard rows from Postgres (``account_snapshots``).

    The bundled React app normally downloads the raw CSV and parses it
    client-side with Papaparse (~12 MB, several seconds). This endpoint
    serves the same row objects the parser would produce, sourced from
    ``raw_row`` JSONB captured at upload time. The dashboard injection
    layer in ``index.html`` hijacks CSV fetches to use this instead.

    If snapshots are missing for the latest upload (legacy rows uploaded
    before server-side ingest existed), we parse on demand and backfill.
    """
    normalised_slot = (slot or "active").strip().lower()
    if normalised_slot not in ("active", "historical"):
        raise HTTPException(status_code=400, detail="slot must be active or historical")

    db = _db(request)
    async with db.acquire() as conn:
        latest = await _resolve_latest_for_slot(conn, normalised_slot)
        if latest is None:
            raise HTTPException(
                status_code=404,
                detail=f"no csv upload found for slot={normalised_slot}",
            )

        upload_id = int(latest["id"])
        snap_count = await conn.fetchval(
            "SELECT COUNT(*) FROM account_snapshots WHERE csv_upload_id = $1",
            upload_id,
        )

        content_row = await conn.fetchrow(
            "SELECT content FROM csv_uploads WHERE id = $1", upload_id,
        )
        raw_bytes = bytes(content_row["content"]) if content_row else b""
        headers = _parse_csv_header_row(raw_bytes)

        eff = latest.get("effective_date") or latest["uploaded_at"]
        if not snap_count:
            try:
                await db.ingest_snapshot(
                    csv_upload_id=upload_id,
                    slot=normalised_slot,
                    effective_date=eff,
                    raw_bytes=raw_bytes,
                )
            except Exception as exc:
                raise HTTPException(
                    status_code=503,
                    detail=f"snapshot ingest failed: {type(exc).__name__}: {exc}",
                ) from exc

        snap_rows = await conn.fetch(
            "SELECT raw_row FROM account_snapshots "
            "WHERE csv_upload_id = $1 ORDER BY id",
            upload_id,
        )

    rows = _dedupe_raw_rows([_raw_row_to_dict(r["raw_row"]) for r in snap_rows])
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="upload exists but produced zero parsed rows",
        )
    if not headers and rows:
        headers = list(rows[0].keys())

    eff = latest.get("effective_date") or latest["uploaded_at"]
    return {
        "ok": True,
        "slot": normalised_slot,
        "filename": latest["filename"],
        "mtime": eff.isoformat() if hasattr(eff, "isoformat") else str(eff),
        "mtimeMs": int(eff.timestamp() * 1000) if hasattr(eff, "timestamp") else int(latest["uploaded_at"].timestamp() * 1000),
        "effective_date": eff.isoformat() if hasattr(eff, "isoformat") else str(eff),
        "uploaded_at": latest["uploaded_at"].isoformat(),
        "headers": headers,
        "rows": rows,
        "rowCount": len(rows),
        "source": "postgres:account_snapshots",
        "csv_upload_id": upload_id,
    }


@router.get("/data-source/file")
async def data_source_file(request: Request, match: str = ""):
    db = _db(request)
    async with db.acquire() as conn:
        latest = await _resolve_latest(conn, match)
        if latest is None:
            raise HTTPException(status_code=404, detail="no matching source file found")
        row = await conn.fetchrow(
            "SELECT content FROM csv_uploads WHERE id = $1", latest["id"]
        )

    headers = {
        "Cache-Control": "no-store",
        "X-Source-Path": f"postgres:csv_uploads/{latest['id']}",
        "X-Source-Mtime": latest["uploaded_at"].isoformat(),
        "X-Source-Format": "csv",
        "X-Source-Slot": latest["slot"],
    }
    return Response(
        content=bytes(row["content"]),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )


@legacy_router.get("/apps/renewals/{filename:path}")
async def legacy_apps_renewals(request: Request, filename: str):
    """Legacy URL the dashboard falls back to from /csv-list.

    Looks up the most recent upload whose filename matches exactly,
    then by case-insensitive substring. We unquote the URL path
    ourselves because filenames frequently contain spaces and dashes
    (e.g. 'renewal_Studio_upload_20260603 - Sheet1.csv').
    """
    from urllib.parse import unquote

    name = unquote(filename or "").strip()
    if not name:
        raise HTTPException(status_code=404, detail="missing filename")

    db = _db(request)
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, slot, filename, size_bytes, uploaded_at, content "
            "FROM csv_uploads WHERE filename = $1 "
            "ORDER BY uploaded_at DESC LIMIT 1",
            name,
        )
        if row is None:
            row = await conn.fetchrow(
                "SELECT id, slot, filename, size_bytes, uploaded_at, content "
                "FROM csv_uploads WHERE LOWER(filename) = LOWER($1) "
                "ORDER BY uploaded_at DESC LIMIT 1",
                name,
            )
        if row is None:
            row = await conn.fetchrow(
                "SELECT id, slot, filename, size_bytes, uploaded_at, content "
                "FROM csv_uploads "
                "WHERE LOWER(filename) LIKE '%' || LOWER($1) || '%' "
                "ORDER BY uploaded_at DESC LIMIT 1",
                name,
            )
        if row is None:
            raise HTTPException(
                status_code=404,
                detail=f"no upload matches filename '{name}'",
            )

    headers = {
        "Cache-Control": "no-store",
        "X-Source-Path": f"postgres:csv_uploads/{row['id']}",
        "X-Source-Mtime": row["uploaded_at"].isoformat(),
        "X-Source-Format": "csv",
        "X-Source-Slot": row["slot"],
    }
    return Response(
        content=bytes(row["content"]),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Upload — admin SSO only
# ---------------------------------------------------------------------------

# Upfront cap on a single decompressed CSV pulled out of a zip. Guards
# against zip-bombs while staying well above any realistic renewals book.
_MAX_UNZIPPED_CSV_BYTES = 300 * 1024 * 1024  # 300 MB


def _looks_like_zip(content: bytes, filename: str, content_type: str) -> bool:
    if content[:4] == b"PK\x03\x04":
        return True
    if filename.lower().endswith(".zip"):
        return True
    if "zip" in (content_type or "").lower():
        return True
    return False


def _extract_csv_from_zip(content: bytes) -> tuple[bytes, str]:
    """Pull the CSV out of an uploaded zip.

    Returns (csv_bytes, inner_filename). Picks the single .csv entry, or the
    largest one when several are present (ignoring macOS resource forks and
    directories). Raises HTTPException(400) with a clear message on failure.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid .zip archive.")

    csv_entries = [
        info
        for info in zf.infolist()
        if not info.is_dir()
        and info.filename.lower().endswith(".csv")
        and not info.filename.startswith("__MACOSX/")
        and "/." not in info.filename
        and not info.filename.startswith(".")
    ]
    if not csv_entries:
        raise HTTPException(
            status_code=400,
            detail="No .csv file found inside the .zip archive.",
        )

    # Largest CSV = the data file when several are bundled.
    chosen = max(csv_entries, key=lambda i: i.file_size)
    if chosen.file_size > _MAX_UNZIPPED_CSV_BYTES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"CSV inside the zip is too large "
                f"({chosen.file_size // (1024 * 1024)} MB, limit "
                f"{_MAX_UNZIPPED_CSV_BYTES // (1024 * 1024)} MB)."
            ),
        )
    try:
        with zf.open(chosen) as fh:
            csv_bytes = fh.read()
    except Exception as exc:  # noqa: BLE001 — surface any decompression error
        raise HTTPException(
            status_code=400,
            detail=f"Could not read the CSV inside the zip: {type(exc).__name__}",
        )
    inner_name = chosen.filename.split("/")[-1]
    return csv_bytes, inner_name


@router.post("/upload-csv")
async def upload_csv(
    request: Request,
    name: str = Query(default=""),
    slot: str = Query(default=""),
    note: str = Query(default=""),
    _owner: ResolvedUser = Depends(require_owner),
):
    """Accept a CSV upload (text/csv, octet-stream, or multipart/form-data).

    Slot is inferred from filename if not supplied:
      * filename contains '2026 data'      -> slot='active'
      * filename contains 'historical fy27' -> slot='historical'
      * otherwise: caller must pass ?slot=
    """
    db = _db(request)

    content: bytes = b""
    filename: str = name.strip()
    explicit_slot: str = slot.strip().lower()
    upload_note: Optional[str] = note.strip() or None

    ct = (request.headers.get("content-type") or "").lower()
    if ct.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "filename"):
            raise HTTPException(status_code=400, detail="missing 'file' part in multipart body")
        content = await upload.read()
        if not filename:
            filename = upload.filename or ""
        explicit_slot = (form.get("slot") or explicit_slot or "").strip().lower()
        if not upload_note:
            upload_note = (form.get("note") or "").strip() or None
    elif (
        ct.startswith("text/csv")
        or ct.startswith("text/plain")
        or ct.startswith("application/octet-stream")
        or ct.startswith("application/zip")
        or ct.startswith("application/x-zip-compressed")
    ):
        content = await request.body()
    else:
        raise HTTPException(
            status_code=415,
            detail=(
                "Content-Type must be text/csv, application/zip, "
                "application/octet-stream, or multipart/form-data"
            ),
        )

    if not content:
        raise HTTPException(status_code=400, detail="empty CSV body")

    # Accept a .zip that houses the CSV — a common workaround for the 32 MB
    # request-size limit on Cloud Run. Unzip server-side and continue exactly
    # as if the CSV had been uploaded directly (we store the decompressed
    # bytes, so serving and ingest are unchanged).
    if _looks_like_zip(content, filename, ct):
        content, inner_name = _extract_csv_from_zip(content)
        if not filename or filename.lower().endswith(".zip"):
            filename = inner_name

    if not filename:
        filename = f"upload-{int(datetime.now(timezone.utc).timestamp())}.csv"
    filename = filename.replace("\\", "_").split("/")[-1].lstrip(".")
    if not filename.lower().endswith(".csv"):
        filename = f"{filename}.csv"

    if explicit_slot in ("active", "historical"):
        resolved_slot = explicit_slot
    else:
        low = filename.lower()
        if "2026 data" in low:
            resolved_slot = "active"
        elif "historical fy27" in low:
            resolved_slot = "historical"
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Cannot infer slot from filename. Choose Active or Historical "
                    "in admin, pass ?slot=active or ?slot=historical, or include "
                    "'2026 data' / 'historical fy27' in the filename."
                ),
            )

    sha = hashlib.sha256(content).hexdigest()
    uploaded_by = _owner.email or _owner.display_name or "owner"

    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO csv_uploads
                (slot, filename, content_type, size_bytes, sha256, content,
                 uploaded_by, note)
            VALUES ($1, $2, 'text/csv', $3, $4, $5, $6, $7)
            RETURNING id, uploaded_at
            """,
            resolved_slot, filename, len(content), sha, content, uploaded_by, upload_note,
        )

    eff = resolve_effective_date(filename, row["uploaded_at"])
    parsed_rows = 0
    parse_error: Optional[str] = None
    try:
        parsed_rows = await db.ingest_snapshot(
            csv_upload_id=row["id"],
            slot=resolved_slot,
            effective_date=eff,
            raw_bytes=content,
        )
    except Exception as exc:
        parse_error = f"{type(exc).__name__}: {exc}"

    return {
        "ok": True,
        "id": row["id"],
        "slot": resolved_slot,
        "filename": filename,
        "size": len(content),
        "sha256": sha,
        "uploaded_at": row["uploaded_at"].isoformat(),
        "effective_date": eff.isoformat(),
        "parsed_rows": parsed_rows,
        "parse_error": parse_error,
    }


# ---------------------------------------------------------------------------
# Account Calls — per renewal row (account + quarter + rounded ATR).
#
# Append-only history in account_call_events; reads use max effective_date
# per call_key. ELT = CS + Renewals. Commits timestamp on server (Done).
# ---------------------------------------------------------------------------

_LATEST_CALLS_CTE = """
WITH latest AS (
    SELECT DISTINCT ON (call_key)
        call_key, account_id, account_name, year_quarter, rounded_atr,
        cs_forecast, renewals_forecast, effective_date,
        edited_by_email, edited_by_display, source, id
    FROM account_call_events
    ORDER BY call_key, effective_date DESC, id DESC
)
"""


def _call_event_to_dict(row) -> dict:
    cs = float(row["cs_forecast"]) if row["cs_forecast"] is not None else None
    rn = float(row["renewals_forecast"]) if row["renewals_forecast"] is not None else None
    elt = None
    if cs is not None or rn is not None:
        elt = (cs or 0) + (rn or 0)
    variance = None
    if cs is not None and rn is not None:
        variance = cs - rn
    editor = row.get("edited_by_display") or row.get("edited_by_email") or row.get("updated_by")
    eff = row.get("effective_date") or row.get("updated_at")
    eff_iso = eff.isoformat() if eff is not None and hasattr(eff, "isoformat") else None
    return {
        "call_key": row["call_key"],
        "account_id": row.get("account_id") or row.get("account_name"),
        "account_name": row.get("account_name") or "",
        "year_quarter": row.get("year_quarter") or "",
        "rounded_atr": int(row.get("rounded_atr") or 0),
        "cs_forecast": cs,
        "renewals_forecast": rn,
        "elt_forecast": elt,
        "variance": variance,
        "effective_date": eff_iso,
        "updated_at": eff_iso,
        "updated_by": editor,
        "cs_updated_at": eff_iso if cs is not None else None,
        "cs_updated_by": editor if cs is not None else None,
        "rn_updated_at": eff_iso if rn is not None else None,
        "rn_updated_by": editor if rn is not None else None,
        "edited_by_email": row.get("edited_by_email"),
        "edited_by_display": row.get("edited_by_display"),
    }


def _coerce_optional_float(body: dict, name: str):
    if name not in body:
        return None, False
    v = body[name]
    if v is None or v == "":
        return None, True
    try:
        return float(v), True
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{name} must be a number or null")


async def _insert_call_event(
    conn,
    *,
    call_key: str,
    account_id: str,
    account_name: str,
    year_quarter: str,
    rounded_atr: int,
    cs_forecast,
    renewals_forecast,
    user: ResolvedUser,
    source: str,
) -> dict:
    editor_email = (user.email or "").strip() or None
    editor_display = (user.display_name or user.email or "unknown").strip()
    row = await conn.fetchrow(
        """
        INSERT INTO account_call_events (
            call_key, account_id, account_name, year_quarter, rounded_atr,
            cs_forecast, renewals_forecast, effective_date,
            edited_by_email, edited_by_display, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10)
        RETURNING call_key, account_id, account_name, year_quarter, rounded_atr,
                  cs_forecast, renewals_forecast, effective_date,
                  edited_by_email, edited_by_display, source
        """,
        call_key,
        account_id,
        account_name,
        year_quarter,
        rounded_atr,
        cs_forecast,
        renewals_forecast,
        editor_email,
        editor_display,
        source,
    )
    return _call_event_to_dict(row)


async def _fetch_latest_call(conn, call_key: str):
    return await conn.fetchrow(
        f"""
        {_LATEST_CALLS_CTE}
        SELECT * FROM latest WHERE call_key = $1
        """,
        call_key,
    )


def _totals_from_row(row) -> dict:
    cs_total = float(row["cs_total"]) if row["cs_total"] is not None else 0
    rn_total = float(row["rn_total"]) if row["rn_total"] is not None else 0
    return {
        "ok": True,
        "cs_total": cs_total,
        "renewals_total": rn_total,
        "elt_total": cs_total + rn_total,
        "variance": cs_total - rn_total,
        "cs_count": int(row["cs_count"] or 0),
        "renewals_count": int(row["rn_count"] or 0),
        "total_accounts": int(row["total_accounts"] or 0),
    }


@router.get("/account-forecasts")
async def list_account_forecasts(request: Request) -> dict:
    """Latest CS / Renewals call per renewal row (max effective_date)."""
    db = _db(request)
    async with db.acquire() as conn:
        rows = await conn.fetch(
            f"""
            {_LATEST_CALLS_CTE}
            SELECT * FROM latest
            WHERE cs_forecast IS NOT NULL OR renewals_forecast IS NOT NULL
            ORDER BY account_name ASC, year_quarter ASC
            """
        )
    return {"ok": True, "items": [_call_event_to_dict(r) for r in rows]}


@router.post("/account-forecasts/totals")
async def account_forecasts_totals_filtered(request: Request) -> dict:
    """Roll up CS / Renewals / ELT for scoped renewal rows."""
    db = _db(request)
    body = await request.json()
    if not isinstance(body, dict):
        body = {}
    call_keys = body.get("call_keys")
    cleaned_keys = (
        [str(k).strip() for k in call_keys if str(k).strip()]
        if isinstance(call_keys, list) else []
    )
    ids = body.get("account_ids") if isinstance(body.get("account_ids"), list) else []
    cleaned_ids = [str(n).strip() for n in ids if str(n).strip()]
    names = body.get("account_names") if isinstance(body.get("account_names"), list) else []
    cleaned_names = [str(n).strip() for n in names if str(n).strip()]

    async with db.acquire() as conn:
        if cleaned_keys:
            row = await conn.fetchrow(
                f"""
                {_LATEST_CALLS_CTE}
                SELECT
                  COALESCE(SUM(cs_forecast), 0)       AS cs_total,
                  COALESCE(SUM(renewals_forecast), 0) AS rn_total,
                  COUNT(*) FILTER (WHERE cs_forecast IS NOT NULL)        AS cs_count,
                  COUNT(*) FILTER (WHERE renewals_forecast IS NOT NULL) AS rn_count,
                  COUNT(*) AS total_accounts
                FROM latest
                WHERE call_key = ANY($1::text[])
                  AND (cs_forecast IS NOT NULL OR renewals_forecast IS NOT NULL)
                """,
                cleaned_keys,
            )
        elif cleaned_ids:
            row = await conn.fetchrow(
                f"""
                {_LATEST_CALLS_CTE}
                SELECT
                  COALESCE(SUM(cs_forecast), 0)       AS cs_total,
                  COALESCE(SUM(renewals_forecast), 0) AS rn_total,
                  COUNT(*) FILTER (WHERE cs_forecast IS NOT NULL)        AS cs_count,
                  COUNT(*) FILTER (WHERE renewals_forecast IS NOT NULL) AS rn_count,
                  COUNT(*) AS total_accounts
                FROM latest
                WHERE account_id = ANY($1::text[])
                  AND (cs_forecast IS NOT NULL OR renewals_forecast IS NOT NULL)
                """,
                cleaned_ids,
            )
        elif cleaned_names:
            row = await conn.fetchrow(
                f"""
                {_LATEST_CALLS_CTE}
                SELECT
                  COALESCE(SUM(cs_forecast), 0)       AS cs_total,
                  COALESCE(SUM(renewals_forecast), 0) AS rn_total,
                  COUNT(*) FILTER (WHERE cs_forecast IS NOT NULL)        AS cs_count,
                  COUNT(*) FILTER (WHERE renewals_forecast IS NOT NULL) AS rn_count,
                  COUNT(*) AS total_accounts
                FROM latest
                WHERE account_name = ANY($1::text[])
                  AND (cs_forecast IS NOT NULL OR renewals_forecast IS NOT NULL)
                """,
                cleaned_names,
            )
        else:
            row = await conn.fetchrow(
                f"""
                {_LATEST_CALLS_CTE}
                SELECT
                  COALESCE(SUM(cs_forecast), 0)       AS cs_total,
                  COALESCE(SUM(renewals_forecast), 0) AS rn_total,
                  COUNT(*) FILTER (WHERE cs_forecast IS NOT NULL)        AS cs_count,
                  COUNT(*) FILTER (WHERE renewals_forecast IS NOT NULL) AS rn_count,
                  COUNT(*) AS total_accounts
                FROM latest
                WHERE cs_forecast IS NOT NULL OR renewals_forecast IS NOT NULL
                """
            )
    return _totals_from_row(row)


@router.get("/account-forecasts/totals")
async def account_forecasts_totals(request: Request) -> dict:
    """Global rollup of latest calls."""
    db = _db(request)
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            {_LATEST_CALLS_CTE}
            SELECT
              COALESCE(SUM(cs_forecast), 0)       AS cs_total,
              COALESCE(SUM(renewals_forecast), 0) AS rn_total,
              COUNT(*) FILTER (WHERE cs_forecast IS NOT NULL)        AS cs_count,
              COUNT(*) FILTER (WHERE renewals_forecast IS NOT NULL) AS rn_count,
              COUNT(*) AS total_accounts
            FROM latest
            WHERE cs_forecast IS NOT NULL OR renewals_forecast IS NOT NULL
            """
        )
    return _totals_from_row(row)


@router.get("/account-forecasts/{account_id}")
async def get_account_forecast(
    request: Request,
    account_id: str,
    year_quarter: Optional[str] = Query(default=None),
    rounded_atr: Optional[int] = Query(default=None),
    call_key: Optional[str] = Query(default=None),
) -> dict:
    db = _db(request)
    key = (call_key or "").strip()
    if not key:
        if year_quarter is None or rounded_atr is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "call_key_required",
                    "detail": "Provide call_key or year_quarter + rounded_atr.",
                },
            )
        try:
            key = build_call_key(
                account_id=account_id,
                year_quarter=year_quarter,
                rounded_atr=int(rounded_atr),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    async with db.acquire() as conn:
        row = await _fetch_latest_call(conn, key)
    if row is None:
        return {
            "ok": True,
            "call_key": key,
            "account_id": account_id,
            "account_name": None,
            "year_quarter": year_quarter or "",
            "rounded_atr": int(rounded_atr or 0),
            "cs_forecast": None,
            "renewals_forecast": None,
            "elt_forecast": None,
            "variance": None,
            "effective_date": None,
            "updated_at": None,
            "updated_by": None,
            "cs_updated_at": None,
            "cs_updated_by": None,
            "rn_updated_at": None,
            "rn_updated_by": None,
        }
    return {"ok": True, **_call_event_to_dict(row)}


@router.put("/account-forecasts/{account_id}")
async def upsert_account_forecast(
    request: Request,
    account_id: str,
    user: ResolvedUser = Depends(require_signed_in),
):
    """Append a call commit for one renewal row (account + quarter + ATR)."""
    db = _db(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")

    account_name = body.get("account_name") if isinstance(body.get("account_name"), str) else ""
    year_quarter = str(body.get("year_quarter") or body.get("fq") or "").strip()
    rounded_atr_raw = body.get("rounded_atr")
    if rounded_atr_raw is None and body.get("atr") is not None:
        rounded_atr_raw = body.get("atr")
    if year_quarter == "" or rounded_atr_raw is None:
        ck = str(body.get("call_key") or "").strip()
        if ck:
            try:
                _, year_quarter, rounded_atr = parse_call_key(ck)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        else:
            raise HTTPException(
                status_code=400,
                detail="year_quarter and rounded_atr (or call_key) required",
            )
    else:
        try:
            rounded_atr = int(round(float(rounded_atr_raw)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="rounded_atr must be a number")

    try:
        call_key = build_call_key(
            account_id=account_id,
            account_name=account_name,
            year_quarter=year_quarter,
            rounded_atr=rounded_atr,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cs, touch_cs = _coerce_optional_float(body, "cs_forecast")
    rn, touch_rn = _coerce_optional_float(body, "renewals_forecast")
    if not touch_cs and not touch_rn:
        raise HTTPException(
            status_code=400,
            detail="Provide cs_forecast and/or renewals_forecast",
        )

    async with db.acquire() as conn:
        latest = await _fetch_latest_call(conn, call_key)
        if latest is not None:
            if not touch_cs:
                cs = float(latest["cs_forecast"]) if latest["cs_forecast"] is not None else None
            if not touch_rn:
                rn = float(latest["renewals_forecast"]) if latest["renewals_forecast"] is not None else None

        source = str(body.get("source") or "modal_done").strip() or "modal_done"
        result = await _insert_call_event(
            conn,
            call_key=call_key,
            account_id=account_id,
            account_name=account_name,
            year_quarter=year_quarter,
            rounded_atr=rounded_atr,
            cs_forecast=cs,
            renewals_forecast=rn,
            user=user,
            source=source,
        )
    return {"ok": True, **result}


@router.delete("/account-forecasts/{account_id}")
async def delete_account_forecast(
    request: Request,
    account_id: str,
    year_quarter: Optional[str] = Query(default=None),
    rounded_atr: Optional[int] = Query(default=None),
    call_key: Optional[str] = Query(default=None),
    user: ResolvedUser = Depends(require_signed_in),
) -> dict:
    """Clear calls for one renewal row (append null event for audit trail)."""
    db = _db(request)
    key = (call_key or "").strip()
    yq = (year_quarter or "").strip()
    atr = int(rounded_atr or 0)
    if not key:
        if not yq or rounded_atr is None:
            raise HTTPException(
                status_code=400,
                detail="call_key or year_quarter + rounded_atr required",
            )
        key = build_call_key(
            account_id=account_id,
            year_quarter=yq,
            rounded_atr=atr,
        )
    else:
        _, yq, atr = parse_call_key(key)

    async with db.acquire() as conn:
        latest = await _fetch_latest_call(conn, key)
        account_name = latest["account_name"] if latest else ""
        result = await _insert_call_event(
            conn,
            call_key=key,
            account_id=account_id,
            account_name=account_name,
            year_quarter=yq,
            rounded_atr=atr,
            cs_forecast=None,
            renewals_forecast=None,
            user=user,
            source="clear",
        )
    return {"ok": True, **result}


@router.get("/calls/history")
async def call_history(
    request: Request,
    account_id: Optional[str] = Query(default=None),
    call_key: Optional[str] = Query(default=None),
    _admin: ResolvedUser = Depends(require_admin),
) -> dict:
    """Full call revision history for admin/owner."""
    db = _db(request)
    aid = (account_id or "").strip()
    ck = (call_key or "").strip()
    if not aid and not ck:
        raise HTTPException(status_code=400, detail="account_id or call_key required")

    async with db.acquire() as conn:
        if ck:
            rows = await conn.fetch(
                """
                SELECT call_key, account_id, account_name, year_quarter, rounded_atr,
                       cs_forecast, renewals_forecast, effective_date,
                       edited_by_email, edited_by_display, source
                FROM account_call_events
                WHERE call_key = $1
                ORDER BY effective_date DESC, id DESC
                LIMIT 200
                """,
                ck,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT call_key, account_id, account_name, year_quarter, rounded_atr,
                       cs_forecast, renewals_forecast, effective_date,
                       edited_by_email, edited_by_display, source
                FROM account_call_events
                WHERE account_id = $1
                ORDER BY effective_date DESC, id DESC
                LIMIT 500
                """,
                aid,
            )
    history = []
    for r in rows:
        cs = float(r["cs_forecast"]) if r["cs_forecast"] is not None else None
        rn = float(r["renewals_forecast"]) if r["renewals_forecast"] is not None else None
        elt = (cs or 0) + (rn or 0) if cs is not None or rn is not None else None
        history.append({
            "call_key": r["call_key"],
            "account_id": r["account_id"],
            "account_name": r["account_name"],
            "year_quarter": r["year_quarter"],
            "rounded_atr": int(r["rounded_atr"] or 0),
            "cs_forecast": cs,
            "renewals_forecast": rn,
            "elt_forecast": elt,
            "effective_date": r["effective_date"].isoformat(),
            "edited_by_email": r["edited_by_email"],
            "edited_by_display": r["edited_by_display"],
            "source": r["source"],
        })
    return {"ok": True, "history": history, "count": len(history)}


# ---------------------------------------------------------------------------
# Tab access — owner configures which dashboard tabs each role may see.
# Owner role always receives every tab regardless of stored config.
# ---------------------------------------------------------------------------

TAB_ACCESS_META_KEY = "tab_access"
ALL_DASHBOARD_TABS = (
    "region", "trending", "partner", "accounts", "notes", "historical", "targets"
)


def _default_tab_access_matrix() -> dict[str, list[str]]:
    return {
        "owner": list(ALL_DASHBOARD_TABS),
        "admin": ["region", "partner", "accounts", "notes", "historical", "targets"],
        "standard": ["region", "partner", "accounts", "notes", "targets"],
    }


def _sanitize_tab_list(tabs) -> list[str]:
    if not isinstance(tabs, list):
        return []
    allowed = set(ALL_DASHBOARD_TABS)
    out: list[str] = []
    for t in tabs:
        s = str(t).strip()
        if s in allowed and s not in out:
            out.append(s)
    return out


async def _load_tab_access_matrix(conn) -> dict[str, list[str]]:
    row = await conn.fetchrow(
        "SELECT value FROM renewals_meta WHERE key = $1",
        TAB_ACCESS_META_KEY,
    )
    base = _default_tab_access_matrix()
    if row is None:
        return base
    try:
        raw = json.loads(row["value"])
    except json.JSONDecodeError:
        return base
    if not isinstance(raw, dict):
        return base
    for role in ("owner", "admin", "standard"):
        cleaned = _sanitize_tab_list(raw.get(role))
        if cleaned:
            base[role] = cleaned
    return base


@router.get("/tab-access")
async def tab_access_for_user(
    request: Request,
    user: ResolvedUser = Depends(get_current_user),
) -> dict:
    """Tabs the signed-in user may open."""
    role = user.role if user.role in ("owner", "admin", "standard") else "standard"
    db = _db(request)
    async with db.acquire() as conn:
        matrix = await _load_tab_access_matrix(conn)
    if role == "owner":
        tabs = list(ALL_DASHBOARD_TABS)
    else:
        tabs = matrix.get(role) or matrix["standard"]
    return {"ok": True, "role": role, "tabs": tabs, "all_tabs": list(ALL_DASHBOARD_TABS)}


@router.get("/tab-access/config")
async def tab_access_config_get(
    request: Request,
    _owner: ResolvedUser = Depends(require_owner),
) -> dict:
    db = _db(request)
    async with db.acquire() as conn:
        matrix = await _load_tab_access_matrix(conn)
    return {
        "ok": True,
        "matrix": matrix,
        "all_tabs": list(ALL_DASHBOARD_TABS),
    }


@router.put("/tab-access/config")
async def tab_access_config_put(
    request: Request,
    user: ResolvedUser = Depends(require_owner),
) -> dict:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    matrix_in = body.get("matrix")
    if not isinstance(matrix_in, dict):
        raise HTTPException(status_code=400, detail="matrix object required")
    matrix = _default_tab_access_matrix()
    for role in ("owner", "admin", "standard"):
        matrix[role] = _sanitize_tab_list(matrix_in.get(role)) or matrix[role]
    db = _db(request)
    async with db.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO renewals_meta (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """,
            TAB_ACCESS_META_KEY,
            json.dumps(matrix),
        )
    return {
        "ok": True,
        "matrix": matrix,
        "updated_by": user.email,
    }


# Stored as one JSON blob in renewals_meta so the dashboard's four local
# state slices persist across devices without touching vendor/app.js.
# ---------------------------------------------------------------------------

PLANNING_META_KEY = "planning_data"


def _empty_planning_response() -> dict:
    return {
        "ok": True,
        "targets": {},
        "rateTargets": {},
        "ccData": {},
        "expansionTargets": {},
        "savedAt": None,
        "updatedBy": None,
    }


def _coerce_planning_dict(body: dict, name: str) -> dict:
    val = body.get(name)
    if val is None:
        return {}
    if not isinstance(val, dict):
        raise HTTPException(status_code=400, detail=f"{name} must be an object")
    return val


@router.get("/planning-data")
async def get_planning_data(request: Request) -> dict:
    """Quarterly ATR targets, renewal-rate targets, budget/call inputs,
    and expansion targets — the Targets tab planning fields."""
    db = _db(request)
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT value FROM renewals_meta WHERE key = $1",
            PLANNING_META_KEY,
        )
    if row is None:
        return _empty_planning_response()
    try:
        payload = json.loads(row["value"])
    except json.JSONDecodeError:
        return _empty_planning_response()
    if not isinstance(payload, dict):
        return _empty_planning_response()
    return {
        "ok": True,
        "targets": payload.get("targets") if isinstance(payload.get("targets"), dict) else {},
        "rateTargets": payload.get("rateTargets") if isinstance(payload.get("rateTargets"), dict) else {},
        "ccData": payload.get("ccData") if isinstance(payload.get("ccData"), dict) else {},
        "expansionTargets": payload.get("expansionTargets") if isinstance(payload.get("expansionTargets"), dict) else {},
        "savedAt": payload.get("savedAt"),
        "updatedBy": payload.get("updatedBy"),
    }


@router.put("/planning-data")
async def put_planning_data(
    request: Request,
    user: ResolvedUser = Depends(require_signed_in),
) -> dict:
    """Persist Targets-tab planning fields. Signed-in users only."""
    db = _db(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")

    saved_at = datetime.now(timezone.utc)
    payload = {
        "targets": _coerce_planning_dict(body, "targets"),
        "rateTargets": _coerce_planning_dict(body, "rateTargets"),
        "ccData": _coerce_planning_dict(body, "ccData"),
        "expansionTargets": _coerce_planning_dict(body, "expansionTargets"),
        "savedAt": saved_at.isoformat(),
        "updatedBy": user.email,
    }
    async with db.acquire() as conn:
        await conn.execute(
            "INSERT INTO renewals_meta (key, value, updated_at) "
            "VALUES ($1, $2, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET "
            "  value = EXCLUDED.value, updated_at = NOW()",
            PLANNING_META_KEY,
            json.dumps(payload),
        )
    return {"ok": True, "savedAt": payload["savedAt"]}


# ---------------------------------------------------------------------------
# Quarter Calls — the CS Call + Renewals Call decomposition of ELT Call.
#
#   ELT Call = CS Call + Renewals Call
#
# CS Call is owned by Customer Success; Renewals Call is owned by the
# Renewals team. Both are entered per fiscal quarter via /admin. The
# difference between them is the "alignment" signal — small diffs mean
# the two functions are on the same page, large diffs mean a conversation.
# ---------------------------------------------------------------------------

def _quarter_row_to_dict(row) -> dict:
    cs = float(row["cs_call"]) if row["cs_call"] is not None else None
    rn = float(row["renewals_call"]) if row["renewals_call"] is not None else None
    elt = None
    if cs is not None or rn is not None:
        elt = (cs or 0) + (rn or 0)
    variance = None
    if cs is not None and rn is not None:
        variance = cs - rn
    return {
        "quarter": row["quarter"],
        "cs_call": cs,
        "renewals_call": rn,
        "elt_call": elt,
        "variance": variance,
        "notes": row["notes"],
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        "updated_by": row["updated_by"],
    }


@router.get("/quarter-calls")
async def list_quarter_calls(request: Request) -> dict:
    """Read every quarter's CS Call + Renewals Call. Open endpoint —
    the dashboard widget polls this to render KPI tiles."""
    db = _db(request)
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT quarter, cs_call, renewals_call, notes, updated_at, updated_by "
            "FROM quarter_calls ORDER BY quarter ASC"
        )
    return {"ok": True, "items": [_quarter_row_to_dict(r) for r in rows]}


@router.get("/quarter-calls/{quarter}")
async def get_quarter_call(request: Request, quarter: str) -> dict:
    db = _db(request)
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT quarter, cs_call, renewals_call, notes, updated_at, updated_by "
            "FROM quarter_calls WHERE quarter = $1",
            quarter,
        )
    if row is None:
        return {
            "ok": True,
            "quarter": quarter,
            "cs_call": None,
            "renewals_call": None,
            "elt_call": None,
            "variance": None,
            "notes": None,
            "updated_at": None,
            "updated_by": None,
        }
    return {"ok": True, **_quarter_row_to_dict(row)}


@router.put("/quarter-calls/{quarter}")
async def upsert_quarter_call(
    request: Request,
    quarter: str,
    admin: ResolvedUser = Depends(require_admin),
):
    """UPSERT a CS Call / Renewals Call pair for one fiscal quarter.
    Admin-protected. Pass null in either field to clear it (and recompute
    the ELT Call sum accordingly)."""
    db = _db(request)

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")

    def _coerce(name: str):
        if name not in body:
            return None  # treat missing as "leave unchanged"  (handled below)
        v = body[name]
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"{name} must be a number or null")

    cs = _coerce("cs_call") if "cs_call" in body else None
    rn = _coerce("renewals_call") if "renewals_call" in body else None
    notes = body.get("notes") if isinstance(body.get("notes"), str) else None
    updated_by = admin.display_name or admin.email or "admin"

    # If a field is omitted, preserve the existing value. UPSERT with
    # COALESCE EXCLUDED.col preserves the prior value when the caller
    # didn't pass it explicitly.
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO quarter_calls (quarter, cs_call, renewals_call, notes, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (quarter) DO UPDATE SET
                cs_call       = CASE WHEN $6::bool THEN EXCLUDED.cs_call       ELSE quarter_calls.cs_call       END,
                renewals_call = CASE WHEN $7::bool THEN EXCLUDED.renewals_call ELSE quarter_calls.renewals_call END,
                notes         = COALESCE(EXCLUDED.notes, quarter_calls.notes),
                updated_at    = NOW(),
                updated_by    = EXCLUDED.updated_by
            RETURNING quarter, cs_call, renewals_call, notes, updated_at, updated_by
            """,
            quarter, cs, rn, notes, updated_by,
            "cs_call" in body, "renewals_call" in body,
        )
    return {"ok": True, **_quarter_row_to_dict(row)}


@router.delete("/quarter-calls/{quarter}")
async def delete_quarter_call(
    request: Request,
    quarter: str,
    _admin=Depends(require_admin),
) -> dict:
    """Remove the CS / Renewals overrides for one quarter. Admin-protected."""
    db = _db(request)
    async with db.acquire() as conn:
        res = await conn.execute(
            "DELETE FROM quarter_calls WHERE quarter = $1", quarter,
        )
    return {"ok": True, "quarter": quarter, "result": res}


# ---------------------------------------------------------------------------
# Snapshot history — versioned per-account view used by reporting / admin.
# ---------------------------------------------------------------------------

@router.get("/snapshots")
async def list_snapshots(request: Request, limit: int = 50) -> dict:
    """List every CSV upload with a row count for its parsed rows.

    Sorted newest-first. Used by the /admin Snapshot History viewer and
    eventually by any WoW / MoM reporting view."""
    db = _db(request)
    limit = max(1, min(int(limit), 500))
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                u.id,
                u.slot,
                u.filename,
                u.size_bytes,
                u.uploaded_at,
                u.uploaded_by,
                u.note,
                COALESCE(s.row_count, 0) AS row_count,
                s.distinct_accounts,
                s.atr_total,
                s.effective_date
            FROM csv_uploads u
            LEFT JOIN (
                SELECT
                    csv_upload_id,
                    COUNT(*) AS row_count,
                    COUNT(DISTINCT account_id) AS distinct_accounts,
                    SUM(atr) AS atr_total,
                    MAX(effective_date) AS effective_date
                FROM account_snapshots
                GROUP BY csv_upload_id
            ) s ON s.csv_upload_id = u.id
            ORDER BY COALESCE(s.effective_date, u.uploaded_at) DESC
            LIMIT $1
            """,
            limit,
        )
    items = [
        {
            "id": r["id"],
            "slot": r["slot"],
            "filename": r["filename"],
            "size_bytes": r["size_bytes"],
            "uploaded_at": r["uploaded_at"].isoformat(),
            "effective_date": (
                r["effective_date"].isoformat()
                if r.get("effective_date") else r["uploaded_at"].isoformat()
            ),
            "uploaded_by": r["uploaded_by"],
            "note": r["note"],
            "row_count": int(r["row_count"]),
            "distinct_accounts": int(r["distinct_accounts"] or 0),
            "atr_total": float(r["atr_total"]) if r["atr_total"] is not None else None,
        }
        for r in rows
    ]
    return {"ok": True, "count": len(items), "items": items}


@router.get("/snapshots/{upload_id}/summary")
async def snapshot_summary(request: Request, upload_id: int) -> dict:
    """Aggregate stats for one snapshot: row count, ATR total,
    health-status breakdown, region breakdown. Cheap (one query each)."""
    db = _db(request)
    async with db.acquire() as conn:
        meta = await conn.fetchrow(
            "SELECT id, slot, filename, uploaded_at, uploaded_by "
            "FROM csv_uploads WHERE id = $1",
            upload_id,
        )
        if meta is None:
            raise HTTPException(status_code=404, detail="snapshot not found")
        totals = await conn.fetchrow(
            "SELECT COUNT(*) AS rows, "
            "       COUNT(DISTINCT account_id) AS accounts, "
            "       SUM(atr) AS atr_total, "
            "       SUM(bu_fc) AS bu_fc_total, "
            "       SUM(cc) AS cc_total "
            "FROM account_snapshots WHERE csv_upload_id = $1",
            upload_id,
        )
        health_rows = await conn.fetch(
            "SELECT health_status, COUNT(*) AS n, SUM(atr) AS atr "
            "FROM account_snapshots WHERE csv_upload_id = $1 "
            "GROUP BY health_status ORDER BY n DESC",
            upload_id,
        )
        region_rows = await conn.fetch(
            "SELECT region, COUNT(*) AS n, SUM(atr) AS atr "
            "FROM account_snapshots WHERE csv_upload_id = $1 "
            "GROUP BY region ORDER BY n DESC",
            upload_id,
        )
    return {
        "ok": True,
        "snapshot": {
            "id": meta["id"],
            "slot": meta["slot"],
            "filename": meta["filename"],
            "uploaded_at": meta["uploaded_at"].isoformat(),
            "uploaded_by": meta["uploaded_by"],
        },
        "totals": {
            "rows": int(totals["rows"] or 0),
            "accounts": int(totals["accounts"] or 0),
            "atr_total": float(totals["atr_total"]) if totals["atr_total"] else 0,
            "bu_fc_total": float(totals["bu_fc_total"]) if totals["bu_fc_total"] else 0,
            "cc_total": float(totals["cc_total"]) if totals["cc_total"] else 0,
        },
        "by_health": [
            {"health_status": r["health_status"],
             "count": int(r["n"]),
             "atr": float(r["atr"]) if r["atr"] else 0}
            for r in health_rows
        ],
        "by_region": [
            {"region": r["region"],
             "count": int(r["n"]),
             "atr": float(r["atr"]) if r["atr"] else 0}
            for r in region_rows
        ],
    }


@router.get("/account-history/{account_id}")
async def account_history(request: Request, account_id: str) -> dict:
    """Timeline of one account across every snapshot it appears in.

    Useful for WoW / MoM analysis: returns the per-snapshot health, ATR,
    forecast, and key ownership fields so a reporting view can chart
    risk changes over time."""
    db = _db(request)
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                csv_upload_id, slot, effective_date,
                account_name, year_quarter,
                atr, bu_fc, cc, expansion,
                region, market_segment, country,
                health_status, auto_renew, next_renewal,
                csm_owner, csm_manager, renewal_owner, partner
            FROM account_snapshots
            WHERE account_id = $1
            ORDER BY effective_date ASC, year_quarter ASC
            """,
            account_id,
        )
    if not rows:
        raise HTTPException(status_code=404, detail="no snapshots found for that account")
    return {
        "ok": True,
        "account_id": account_id,
        "history": [
            {
                "csv_upload_id": r["csv_upload_id"],
                "slot": r["slot"],
                "effective_date": r["effective_date"].isoformat(),
                "account_name": r["account_name"],
                "year_quarter": r["year_quarter"],
                "atr": float(r["atr"]) if r["atr"] is not None else None,
                "bu_fc": float(r["bu_fc"]) if r["bu_fc"] is not None else None,
                "cc": float(r["cc"]) if r["cc"] is not None else None,
                "expansion": float(r["expansion"]) if r["expansion"] is not None else None,
                "region": r["region"],
                "market_segment": r["market_segment"],
                "country": r["country"],
                "health_status": r["health_status"],
                "auto_renew": r["auto_renew"],
                "next_renewal": r["next_renewal"].isoformat() if r["next_renewal"] else None,
                "csm_owner": r["csm_owner"],
                "csm_manager": r["csm_manager"],
                "renewal_owner": r["renewal_owner"],
                "partner": r["partner"],
            }
            for r in rows
        ],
    }


@router.get("/trending")
async def trending_metrics(
    request: Request,
    slot: str = Query(default="active"),
    region: str = Query(default=""),
    quarter: str = Query(default=""),
    band: str = Query(default=""),
) -> dict:
    """Time series of book KPIs across every CSV snapshot (by effective_date).

    Used by the Trending tab: ATR, remaining C/C (open BU FC), expected C/C
    (booked CC + remaining BU), account counts, and WoW deltas."""
    normalised_slot = (slot or "active").strip().lower()
    if normalised_slot not in ("active", "historical"):
        raise HTTPException(status_code=400, detail="slot must be active or historical")

    region_f = region.strip()
    quarter_f = quarter.strip().upper()
    band_f = band.strip().lower()

    db = _db(request)
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                u.id AS upload_id,
                u.filename,
                u.uploaded_at,
                COALESCE(MAX(s.effective_date), u.uploaded_at) AS effective_date,
                COUNT(*) AS row_count,
                COUNT(DISTINCT s.account_id) AS account_count,
                COALESCE(SUM(s.atr), 0) AS total_atr,
                COALESCE(SUM(s.bu_fc), 0) AS total_bu_fc,
                COALESCE(SUM(s.cc), 0) AS total_cc,
                COALESCE(SUM(
                    CASE WHEN COALESCE(s.done_deal, FALSE) THEN 0 ELSE COALESCE(s.bu_fc, 0) END
                ), 0) AS remaining_cc
            FROM csv_uploads u
            INNER JOIN account_snapshots s ON s.csv_upload_id = u.id
            WHERE u.slot = $1
              AND ($2 = '' OR s.region = $2)
              AND ($3 = '' OR UPPER(s.year_quarter) = $3)
              AND ($4 = '' OR LOWER(COALESCE(s.band, '')) LIKE '%' || $4 || '%')
            GROUP BY u.id, u.filename, u.uploaded_at
            ORDER BY COALESCE(MAX(s.effective_date), u.uploaded_at) ASC
            """,
            normalised_slot,
            region_f,
            quarter_f,
            band_f,
        )

    points = []
    prev = None
    for r in rows:
        atr = float(r["total_atr"] or 0)
        remaining = float(r["remaining_cc"] or 0)
        booked = float(r["total_cc"] or 0)
        expected = booked + remaining
        eff = r["effective_date"]
        point = {
            "upload_id": int(r["upload_id"]),
            "filename": r["filename"],
            "uploaded_at": r["uploaded_at"].isoformat(),
            "effective_date": eff.isoformat(),
            "effective_ms": int(eff.timestamp() * 1000),
            "row_count": int(r["row_count"] or 0),
            "account_count": int(r["account_count"] or 0),
            "total_atr": atr,
            "remaining_cc": remaining,
            "expected_cc": expected,
            "total_bu_fc": float(r["total_bu_fc"] or 0),
            "booked_cc": booked,
        }
        if prev:
            point["atr_delta"] = atr - prev["total_atr"]
            point["atr_delta_pct"] = (
                (atr - prev["total_atr"]) / prev["total_atr"] * 100
                if prev["total_atr"] else None
            )
            point["remaining_cc_delta"] = remaining - prev["remaining_cc"]
            point["expected_cc_delta"] = expected - prev["expected_cc"]
        else:
            point["atr_delta"] = None
            point["atr_delta_pct"] = None
            point["remaining_cc_delta"] = None
            point["expected_cc_delta"] = None
        points.append(point)
        prev = point

    latest_eff = points[-1]["effective_date"] if points else None
    return {
        "ok": True,
        "slot": normalised_slot,
        "filters": {"region": region_f or None, "quarter": quarter_f or None, "band": band_f or None},
        "point_count": len(points),
        "latest_effective_date": latest_eff,
        "points": points,
    }


@router.get("/notes/export")
async def export_notes(request: Request) -> dict:
    """Plain GET endpoint that returns notes in the import-friendly shape.
    The dashboard's own "Export Notes" button hits this; the /admin UI
    also offers a download-as-file affordance backed by the same data."""
    return await get_notes(request)  # type: ignore  # delegate


@router.post("/notes/import")
async def import_notes(
    request: Request,
    admin: ResolvedUser = Depends(require_owner),
) -> dict:
    """Bulk import notes from a JSON payload. Same shape as the dashboard's
    own Export Notes output (`{notes, noteDeletes, savedAt}`) so a file
    exported from one deployment can be replayed into another."""
    return await put_notes(request, admin)


# ---------------------------------------------------------------------------
# Legacy macOS-only probes — explicit status codes so the bundled dashboard
# doesn't treat these as transient network failures.
# ---------------------------------------------------------------------------

@router.post("/mobile-snapshot")
async def mobile_snapshot_removed():
    raise HTTPException(status_code=404, detail="mobile-snapshot removed")


@router.post("/reveal")
async def reveal(response: Response) -> dict:
    response.status_code = 501
    return {"ok": False, "error": "reveal is macOS only"}


