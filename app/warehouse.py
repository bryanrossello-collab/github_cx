"""Snowflake source refresh ("Run now").

Pulls the dashboard's source data from Snowflake and loads it into the SAME
place CSV uploads land (``csv_uploads`` + ``account_snapshots``), so the
dashboard read path, versioning, and the frozen endpoint contract are all
unchanged. The manual CSV upload path is left fully intact as the fallback.

Two slots mirror the two CSV upload slots:
  * ``active``     -> sql/active_dynamic.sql
  * ``historical`` -> sql/historical_dynamic.sql

Each "Run now" executes BOTH queries with their self-dynamic DEFAULT bind
params (so output tracks the current quarter automatically), serialises the
result to CSV bytes whose header names match what ingest already expects, and
feeds those bytes through the existing ingest pipeline via
``Database.persist_source_csv`` (uploaded_by='snowflake:run-now').

Security:
  * The OAuth token is the per-request user token from the
    ``x-pomerium-idp-access-token`` header (aud=api://appfoundry). It is read
    per request, passed in memory only, and NEVER logged, stored, persisted,
    or written to disk. Nothing in this module logs the token.
  * There is no secret in config — only non-secret connection identifiers.

Async:
  * ``snowflake-connector-python`` is SYNCHRONOUS. Every connector call runs
    in a worker thread via ``run_in_threadpool`` so the ~2-min query never
    blocks the asyncpg-backed event loop.

Simulated mode:
  * When ``SNOWFLAKE_MODE`` != "real" (the default), or when no token is
    present, the refresh reads the bundled ``seeds/*.csv`` instead of
    connecting — so local dev at :8765 works with no Snowflake and no token.
"""

from __future__ import annotations

import csv
import io
import logging
from pathlib import Path
from typing import Any, Optional

from starlette.concurrency import run_in_threadpool

from app.config import Settings

logger = logging.getLogger("renewals_studio.warehouse")

_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = _ROOT / "sql"
SEEDS_DIR = _ROOT / "seeds"

# Per-slot spec. Default binds are confirmed against each SQL file's top
# `params` CTE (qmark '?' order):
#   active     = [as_of_date=None, quarters_back=1, quarters_forward=4,
#                 min_arr=75000, band_cutoff=100000]
#   historical = [as_of_date=None, quarters_back=0, band_cutoff=100000]
# Filenames carry the slot markers ("2026 data" / "Historical FY27") so slot
# inference and data-source matching behave exactly like a manual upload.
SLOT_SPECS: dict[str, dict[str, Any]] = {
    "active": {
        "sql": "active_dynamic.sql",
        "seed": "active.csv",
        "params": [None, 1, 4, 75000, 100000],
        "filename": "Snowflake Run-now - 2026 data.csv",
    },
    "historical": {
        "sql": "historical_dynamic.sql",
        "seed": "historical.csv",
        "params": [None, 0, 100000],
        "filename": "Snowflake Run-now - Historical FY27.csv",
    },
}

SLOTS = ("active", "historical")


def effective_simulated(token: Optional[str], settings: Settings) -> bool:
    """Simulated when configured so, OR when no usable token is present."""
    return settings.snowflake_simulated or not (token and token.strip())


def _load_seed(slot: str) -> tuple[list[str], list[tuple]]:
    """Read a bundled seed CSV into (columns, rows). Used in simulated mode.

    The seed header already matches what the dashboard/ingest expect, so the
    round-trip through ``rows_to_csv_bytes`` reproduces a valid snapshot."""
    path = SEEDS_DIR / SLOT_SPECS[slot]["seed"]
    text = path.read_bytes().decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    all_rows = list(reader)
    if not all_rows:
        return [], []
    return all_rows[0], all_rows[1:]


def _user_from_token(token: str) -> Optional[str]:
    """Best-effort extract the mapped user (email/sub) from the OAuth JWT so we
    can pass ``user=`` to the connector — matching the ZDP reference sample and
    the account's ``EXTERNAL_OAUTH_TOKEN_USER_MAPPING_CLAIM=['sub']`` mapping.

    Decodes the JWT payload WITHOUT verifying the signature (Snowflake verifies
    it) and WITHOUT any external dependency. Never logs the token or claims."""
    try:
        import base64
        import json

        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)  # restore base64url padding
        claims = json.loads(base64.urlsafe_b64decode(payload.encode()))
        val = claims.get("email") or claims.get("sub")
        return str(val) if val else None
    except Exception:  # noqa: BLE001 — never fail the connect on a decode issue
        return None


def run_query_file(
    path: Path,
    params: list[Any],
    token: str,
    settings: Settings,
) -> tuple[list[str], list[tuple]]:
    """Execute a Snowflake SQL file with qmark binds; return (columns, rows).

    SYNCHRONOUS — must be called via ``run_in_threadpool``. The connector is
    imported lazily so the app runs (and py_compiles) without the dependency
    installed whenever the real backend isn't exercised (e.g. local dev)."""
    import snowflake.connector  # lazy: only needed in real mode

    snowflake.connector.paramstyle = "qmark"
    sql = Path(path).read_text()

    conn_kwargs: dict[str, Any] = dict(
        account=settings.snowflake_account,
        warehouse=settings.snowflake_warehouse,
        database=settings.snowflake_database,
        schema=settings.snowflake_schema,
        role=settings.snowflake_role,
        authenticator="oauth",
        token=token,
        login_timeout=int(settings.snowflake_login_timeout_s),
        network_timeout=int(settings.snowflake_network_timeout_s),
        client_session_keep_alive=False,
    )
    # Pass the token's mapped user (email/sub) like the ZDP reference does; the
    # OAuth External integration maps it to the Snowflake user's EMAIL_ADDRESS.
    _mapped_user = _user_from_token(token)
    if _mapped_user:
        conn_kwargs["user"] = _mapped_user
    conn = snowflake.connector.connect(**conn_kwargs)
    try:
        cur = conn.cursor()
        try:
            # Bound statement timeout so a stuck warehouse fails cleanly.
            cur.execute(
                "ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = %d"
                % int(settings.snowflake_statement_timeout_s)
            )
            cur.execute(sql, params)
            columns = [d[0] for d in (cur.description or [])]
            rows = cur.fetchall()
            return columns, rows
        finally:
            cur.close()
    finally:
        conn.close()


def fetch_slot(
    slot: str,
    token: Optional[str],
    settings: Settings,
    *,
    simulated: bool,
) -> tuple[list[str], list[tuple]]:
    """Return (columns, rows) for a slot — from seeds (simulated) or
    Snowflake (real). SYNCHRONOUS; call via ``run_in_threadpool``."""
    if simulated:
        return _load_seed(slot)
    spec = SLOT_SPECS[slot]
    return run_query_file(SQL_DIR / spec["sql"], spec["params"], token or "", settings)


def rows_to_csv_bytes(columns: list[str], rows: list[tuple]) -> bytes:
    """Serialise (columns, rows) to CSV bytes whose header names match what
    the dashboard/ingest expect (the SQL projections + seed headers)."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    for row in rows:
        writer.writerow(["" if v is None else v for v in row])
    return buf.getvalue().encode("utf-8")


async def refresh_all(
    db,
    token: Optional[str],
    settings: Settings,
    *,
    uploaded_by: str = "snowflake:run-now",
) -> dict:
    """Run BOTH slots: fetch -> serialise to CSV bytes -> persist through the
    existing ingest/upsert path. Records success/failure per slot.

    Returns a result dict suitable for the status endpoint. Never raises for
    a single-slot failure — the other slot still runs and the error is
    captured per slot.
    """
    simulated = effective_simulated(token, settings)
    result: dict[str, Any] = {
        "mode": "simulated" if simulated else "real",
        "slots": {},
    }

    for slot in SLOTS:
        spec = SLOT_SPECS[slot]
        slot_res: dict[str, Any] = {"ok": False, "rows": 0, "error": None}
        try:
            # Connector (or seed read) is blocking -> run off the event loop.
            columns, rows = await run_in_threadpool(
                fetch_slot, slot, token, settings, simulated=simulated
            )
            content = rows_to_csv_bytes(columns, rows)
            note = (
                "Snowflake Run-now"
                + (" (simulated)" if simulated else "")
            )
            persisted = await db.persist_source_csv(
                slot=slot,
                filename=spec["filename"],
                content=content,
                uploaded_by=uploaded_by,
                note=note,
            )
            slot_res.update(
                ok=True,
                rows=persisted["parsed_rows"],
                source_rows=len(rows),
                upload_id=persisted["id"],
                uploaded_at=persisted["uploaded_at"].isoformat(),
                effective_date=persisted["effective_date"].isoformat(),
                size=persisted["size"],
            )
            logger.info(
                "snowflake refresh slot=%s ok mode=%s source_rows=%d parsed_rows=%d",
                slot, result["mode"], len(rows), persisted["parsed_rows"],
            )
        except Exception as exc:  # noqa: BLE001 — capture per slot, never leak token
            slot_res["error"] = f"{type(exc).__name__}: {exc}"
            logger.exception("snowflake refresh failed slot=%s", slot)
        result["slots"][slot] = slot_res

    result["ok"] = bool(result["slots"]) and all(
        s.get("ok") for s in result["slots"].values()
    )
    return result
