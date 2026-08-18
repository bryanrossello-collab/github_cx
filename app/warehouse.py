"""Snowflake source refresh ("Run now").

Pulls the dashboard's source data from Snowflake and loads it into the SAME
place CSV uploads land (``csv_uploads`` + ``account_snapshots``), so the
dashboard read path, versioning, and the frozen endpoint contract are all
unchanged. The manual CSV upload path is left fully intact as the fallback.

ONE unified query drives everything:
  * ``active`` -> sql/unified_dynamic.sql

The single pull carries every quarter plus a QUARTER_DIFF column; it lands in
the "active" slot (the app's single source) and the frontend splits it by
QUARTER_DIFF into its active (>=0) and historical (<0) views. The legacy
two-file split (active_dynamic.sql + historical_dynamic.sql) is retired.

Each "Run now" executes the unified query with its self-dynamic DEFAULT bind
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from starlette.concurrency import run_in_threadpool

from app.config import Settings

logger = logging.getLogger("renewals_studio.warehouse")

_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = _ROOT / "sql"
SEEDS_DIR = _ROOT / "seeds"

# Single unified slot. The unified query lands in the "active" slot (the app's
# one source); the frontend splits it by QUARTER_DIFF into active/historical
# views. The query binds live in DEFAULT_QUERY_PARAMS (below) and are
# admin-overridable at runtime (persisted in renewals_meta 'snowflake_config').
# The slot is persisted EXPLICITLY (slot="active"), and data-source resolution
# selects by slot — so the upload's filename is free to be a human-friendly,
# timestamped name (generated per run in refresh_all), not a magic marker.
SLOT_SPECS: dict[str, dict[str, Any]] = {
    "active": {
        "sql": "unified_dynamic.sql",
        "seed": "unified.csv",
    },
}

SLOTS = ("active",)

# Default query binds for unified_dynamic.sql's `params` CTE (qmark '?'), in
# order: [n_past, n_future, min_arr, band_cutoff]. Each is admin-overridable via
# the /admin UI (GET/PUT /api/renewals/snowflake-config). `min_arr` is the
# row-inclusion floor on NET_ARR_USD_PRIOR_QUARTER_END; the 10000 floor pulls
# the broad book (>200K rows), which is why ingest's MAX_ROWS is sized to 500K.
DEFAULT_QUERY_PARAMS: dict[str, Any] = {
    "n_past": 8,
    "n_future": 4,
    "min_arr": 10000,
    "band_cutoff": 100000,
}
QUERY_PARAM_ORDER = ("n_past", "n_future", "min_arr", "band_cutoff")
_QUERY_INT_FIELDS = {"n_past", "n_future"}


def coerce_query_value(key: str, value: Any):
    """Coerce one query param to its numeric type, or None if blank/invalid.
    n_past/n_future are ints; min_arr/band_cutoff are numbers (int when whole)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        if key in _QUERY_INT_FIELDS:
            return int(float(value))
        f = float(value)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def effective_params_dict(overrides: Optional[dict]) -> dict:
    """Merge admin overrides over DEFAULT_QUERY_PARAMS -> {name: number}."""
    o = overrides or {}
    out: dict[str, Any] = {}
    for k in QUERY_PARAM_ORDER:
        v = coerce_query_value(k, o.get(k))
        out[k] = DEFAULT_QUERY_PARAMS[k] if v is None else v
    return out


def effective_params(overrides: Optional[dict]) -> list:
    """Ordered bind list for run_query_file: [n_past, n_future, min_arr, band_cutoff]."""
    d = effective_params_dict(overrides)
    return [d[k] for k in QUERY_PARAM_ORDER]


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


def effective_conn(settings: Settings, overrides: Optional[dict]) -> dict:
    """Merge admin-UI/DB overrides over the env/config defaults for the
    Snowflake connection. A non-empty override string wins; for `role`, a
    present-but-empty override means "omit the role" (use the user's default)."""
    o = overrides or {}

    def pick(key: str, default: str) -> str:
        v = o.get(key)
        return v.strip() if isinstance(v, str) and v.strip() else default

    role = o["role"].strip() if isinstance(o.get("role"), str) else (settings.snowflake_role or "")
    return {
        "account": pick("account", settings.snowflake_account),
        "warehouse": pick("warehouse", settings.snowflake_warehouse),
        "database": pick("database", settings.snowflake_database),
        "schema": pick("schema", settings.snowflake_schema),
        "role": role,
    }


def run_query_file(
    path: Path,
    params: list[Any],
    token: str,
    settings: Settings,
    overrides: Optional[dict] = None,
) -> tuple[list[str], list[tuple]]:
    """Execute a Snowflake SQL file with qmark binds; return (columns, rows).

    SYNCHRONOUS — must be called via ``run_in_threadpool``. The connector is
    imported lazily so the app runs (and py_compiles) without the dependency
    installed whenever the real backend isn't exercised (e.g. local dev)."""
    import snowflake.connector  # lazy: only needed in real mode

    snowflake.connector.paramstyle = "qmark"
    sql = Path(path).read_text()

    eff = effective_conn(settings, overrides)
    conn_kwargs: dict[str, Any] = dict(
        account=eff["account"],
        warehouse=eff["warehouse"],
        database=eff["database"],
        schema=eff["schema"],
        authenticator="oauth",
        token=token,
        login_timeout=int(settings.snowflake_login_timeout_s),
        network_timeout=int(settings.snowflake_network_timeout_s),
        client_session_keep_alive=False,
    )
    # Pin a role only when one is set (via the admin UI override or
    # SNOWFLAKE_ROLE). The External OAuth integration allows any granted role
    # (token scope `session:role-any`), so a non-empty role like PUBLIC is
    # honored; an empty role omits it and lets Snowflake use the user's default.
    if eff["role"]:
        conn_kwargs["role"] = eff["role"]
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
    overrides: Optional[dict] = None,
) -> tuple[list[str], list[tuple]]:
    """Return (columns, rows) for a slot — from seeds (simulated) or
    Snowflake (real). SYNCHRONOUS; call via ``run_in_threadpool``."""
    if simulated:
        return _load_seed(slot)
    spec = SLOT_SPECS[slot]
    return run_query_file(
        SQL_DIR / spec["sql"], effective_params(overrides), token or "", settings, overrides
    )


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
    overrides: Optional[dict] = None,
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
                fetch_slot, slot, token, settings, simulated=simulated, overrides=overrides
            )
            content = rows_to_csv_bytes(columns, rows)
            note = (
                "Snowflake Run-now"
                + (" (simulated)" if simulated else "")
            )
            # Timestamped, sortable UTC filename for traceability in the
            # snapshot history, e.g. "Snowflake Run-Now_20260813_1206Z.csv".
            run_ts = datetime.now(timezone.utc)
            filename = f"Snowflake Run-Now_{run_ts:%Y%m%d_%H%M}Z.csv"
            persisted = await db.persist_source_csv(
                slot=slot,
                filename=filename,
                content=content,
                uploaded_by=uploaded_by,
                note=note,
                # Pass a precise effective_date so snapshot ordering stays exact
                # and the YYYYMMDD in the filename isn't parsed to noon-of-day.
                effective_date=run_ts,
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
