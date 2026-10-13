"""GET /api/renewals/weekly-brief — Weekly 100K+ Regional Brief.

Kept in its own module so a deploy that copies an older renewals.py
(github_cx, or a tree from before Session 2) still serves the route.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from asyncpg.exceptions import QueryCanceledError, UndefinedColumnError
from fastapi import APIRouter, HTTPException, Query, Request

from app.database import (
    OFFICIAL_BAND_PREDICATE,
    SNAPSHOT_KEEP_ALL_DAYS,
    DatabaseUnavailable,
)

logger = logging.getLogger("renewals_studio.weekly_brief")

router = APIRouter(prefix="/api/renewals", tags=["weekly-brief"])


def _db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database_unavailable")
    return db


# ---------------------------------------------------------------------------
# Weekly 100K+ Regional Brief — CCO-requested week-over-week (WoW) bottoms-up
# forecast movement report.
#
# Compares the latest active-slot snapshot vs a prior one (default: the
# immediately-preceding snapshot; a specific pair can be pinned via
# ?current=<id>&prior=<id>). Scope is FROZEN to the 100K+ band for the
# current quarter, broken out by region.
#
# Sign convention (mirrors the dashboard): BU_FC is the forecasted amount of
# churn/contraction (a positive loss number). CC% = BU_FC / ATR. Therefore
# "worse WoW" == BU_FC INCREASED (more expected churn/contraction). The
# adverse swing for an account is (current BU_FC - prior BU_FC) when > 0.
#
# All queries are bounded: every per-snapshot read is filtered to band +
# quarter in SQL (~hundreds of rows), and we only extract the single UPSIDE
# key out of raw_row (never the whole JSONB blob), heeding the DB-timeout
# lessons for ~50k-row snapshots.
# ---------------------------------------------------------------------------

WEEKLY_BRIEF_BAND_DEFAULT = "100k+"
WEEKLY_BRIEF_LARGE_SWING_DEFAULT = 50000.0  # tunable "large mover" threshold ($)
WEEKLY_BRIEF_TREND_LIMIT = 12               # weekly points in the "over time" series
WEEKLY_BRIEF_PICKER_LIMIT = 60              # snapshots offered in the week dropdowns
WEEKLY_BRIEF_LIST_CAP = 100                 # max rows returned per mover list
WEEKLY_BRIEF_DUE_SOON_DAYS = 7              # calendar days from latest snapshot
WEEKLY_BRIEF_DUE_SOON_CAP = 20              # max coming-due rows returned
_EXPLANATION_MAX_CHARS = 600
_WB_BU_ZERO_EPS = 0.005                     # treat remaining BU as cleared
# Pool command_timeout is 30s. Brief queries override it; keep this under
# Cloud Run's request budget so a stuck plan fails as 504 instead of hanging.
_WB_QUERY_TIMEOUT_S = 45.0


def _wb_parse_date(v) -> Optional[date]:
    """Coerce asyncpg / ISO values to a calendar date."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _wb_parse_iso_dt(s: str) -> datetime:
    """Parse snapshot ISO timestamps without crashing on Z / space / naive."""
    raw = str(s).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        dt = datetime.fromisoformat(raw.replace(" ", "T", 1))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _wb_aware(dt) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    return _wb_parse_iso_dt(str(dt))


def _wb_round_atr(atr) -> int:
    """Match Postgres ROUND(numeric) half-away-from-zero (and Math.round on +ATR)."""
    if atr is None:
        return 0
    try:
        d = atr if isinstance(atr, Decimal) else Decimal(str(atr))
    except (ArithmeticError, TypeError, ValueError):
        return 0
    return int(d.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _wb_quarter_spellings(norm: tuple) -> list[str]:
    """Known CSV / app spellings for one fiscal quarter — avoids DISTINCT across 12 uploads."""
    fy2, q = norm
    fy4 = 2000 + (fy2 % 100)
    yy = f"{fy2 % 100:02d}"
    return [
        f"FY{yy}Q{q}",
        f"FY{yy}-Q{q}",
        f"FY{yy} Q{q}",
        f"{fy4}Q{q}",
        f"FY{fy4}Q{q}",
        f"FY{fy4}-Q{q}",
        f"{yy}Q{q}",
        f"Q{q}`{yy}",
        f"Q{q}'{yy}",
        f"Q{q} {yy}",
        f"Q{q}-{yy}",
        f"QQ{q}`{yy}",
        f"QQ{q}'{yy}",
    ]


def _wb_quarter_match(snap_q, event_q) -> bool:
    """True when snapshot + call event refer to the same fiscal quarter."""
    sn = _wb_normalize_quarter(snap_q)
    en = _wb_normalize_quarter(event_q)
    if sn is not None and en is not None:
        return sn == en
    return (snap_q or "").strip().upper() == (event_q or "").strip().upper()


def _wb_meta_as_of(meta: Optional[dict]) -> Optional[date]:
    if not meta:
        return None
    return _wb_parse_date(meta.get("effective_date")) or _wb_parse_date(meta.get("uploaded_at"))


def _wb_is_truthy_done(v) -> bool:
    if v is True:
        return True
    if v is False or v is None:
        return False
    return str(v).strip().lower() in ("true", "1", "yes", "y", "t")


def _wb_parse_ltg(raw) -> Optional[float]:
    """None when LTG is absent so a blank does not count as closed."""
    if raw is None:
        return None
    if isinstance(raw, str) and not raw.strip():
        return None
    return _wb_to_number(raw)


def _wb_is_done(entry: Optional[dict]) -> bool:
    """Same signals as Historical / Pacing: LTG <= 0 or DONE_DEAL.

    Missing LTG does not close the row; only an explicit 0 (or negative)
    or a true done_deal flag does.
    """
    if not entry:
        return False
    ltg = entry.get("ltg")
    if ltg is not None and ltg <= 0:
        return True
    return bool(entry.get("done_deal"))


def _wb_to_number(x) -> float:
    """Mirror the dashboard's toNumber(): strip $ , ( ) % and whitespace.

    Note the client removes parentheses rather than treating them as a
    negative sign, so we match that exactly for UPSIDE parity."""
    if x is None:
        return 0.0
    if isinstance(x, (int, float)):
        return float(x) if math.isfinite(x) else 0.0
    s = re.sub(r"[$,()%\s]", "", str(x)).replace("--", "")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _wb_normalize_quarter(label) -> Optional[tuple]:
    """Return (fy_two_digit, quarter_num) for a well-formed quarter label.

    Accepts the known spellings (anchored, whole-string match):
      'Q3`27', "Q3'27", 'Q3 27', 'Q3-27', 'FY27Q3', 'FY27-Q3', '2027Q3', '27Q3'.

    Anchoring (``fullmatch``) is deliberate: the previous unanchored
    ``re.search`` was over-eager and would treat a malformed value like
    'QQ3`27' as Q3 by matching a substring, silently conflating labels. We
    still collapse a single leading duplicate 'Q' (a common CSV artifact,
    e.g. 'QQ3`27' -> 'Q3`27') so genuine Q3 rows aren't dropped, but random
    garbage no longer matches."""
    if not label:
        return None
    s = str(label).strip().upper()
    # Collapse a redundant leading 'Q' immediately followed by 'Q<1-4>'.
    s = re.sub(r"^Q(?=Q[1-4])", "", s)
    m = re.fullmatch(r"FY(\d{2})[- ]?Q([1-4])", s)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"(\d{2,4})Q([1-4])", s)
    if m:
        return (int(m.group(1)) % 100, int(m.group(2)))
    m = re.fullmatch(r"Q([1-4])[`'\-\s]?(\d{2,4})", s)
    if m:
        return (int(m.group(2)) % 100, int(m.group(1)))
    return None


def _wb_current_fiscal_quarter(dt: datetime) -> tuple:
    """Zendesk fiscal quarter for a date (FY ends Jan; FY27 = Feb26-Jan27).

    Mirrors mapFiscal() in the bundled dashboard so the auto-detected
    'current quarter' matches what a user would pick in the UI."""
    y = dt.year
    m0 = dt.month - 1
    if y == 2026 and m0 == 0:
        return (26, 1)
    fy_num = y if m0 == 0 else y + 1
    offset = (m0 + 11) % 12
    q = offset // 3 + 1
    return (fy_num % 100, q)


# Reusable band predicate. Mirrors the client's matchesBand("100k_official"):
# uppercase, strip spaces/$/commas, then substring-match the band token.
_WB_BAND_PREDICATE = (
    "UPPER(REGEXP_REPLACE(COALESCE(s.band, ''), '[ $,]', '', 'g')) "
    "LIKE '%' || UPPER($BAND$) || '%'"
)

# Exact Pacing 100K+ Official matcher (BAND column, not ATR ≥ $100K). Must
# stay byte-identical to the partial index predicate or the planner falls
# back to scanning whole uploads.
_WB_OFFICIAL_BAND_SQL = " AND " + OFFICIAL_BAND_PREDICATE.format(col="s.band")


def _wb_is_official_band(band: str) -> bool:
    s = (band or "").strip().lower().replace(" ", "").replace("_", "")
    return s in ("100k+", "100kofficial", ">100k")


# Client BAND_OPTIONS that are ATR cutoffs, not the Official BAND column.
_WB_ATR_BAND_SQL = {
    "gt100k": " AND COALESCE(s.atr, 0) > 100000",
    "gt75k": " AND COALESCE(s.atr, 0) > 75000",
    "gt12k": " AND COALESCE(s.atr, 0) > 12000",
    "range0_12k": " AND COALESCE(s.atr, 0) > 0 AND COALESCE(s.atr, 0) <= 12000",
    "range12_75k": " AND COALESCE(s.atr, 0) > 12000 AND COALESCE(s.atr, 0) <= 75000",
    "range75_100k": " AND COALESCE(s.atr, 0) > 75000 AND COALESCE(s.atr, 0) <= 100000",
    "lt100k": " AND COALESCE(s.atr, 0) > 0 AND COALESCE(s.atr, 0) < 100000",
}

_WB_SEGMENT_BAND_SQL = {
    "smb": " AND LOWER(COALESCE(s.market_segment, '')) LIKE '%smb%'",
    "digital": " AND LOWER(COALESCE(s.market_segment, '')) LIKE '%digital%'",
    "commercial": (
        " AND LOWER(COALESCE(s.market_segment, '')) LIKE '%commercial%'"
    ),
    "enterprise": (
        " AND LOWER(COALESCE(s.market_segment, '')) LIKE '%enterprise%'"
    ),
    "comm_ent": (
        " AND (LOWER(COALESCE(s.market_segment, '')) LIKE '%commercial%'"
        " OR LOWER(COALESCE(s.market_segment, '')) LIKE '%enterprise%')"
    ),
}

# Canonical region expression — blank/NULL collapses to 'Unknown' so the SQL
# filter, the available-region list, and the Python-side region label all
# agree (a user can select "Unknown" and match rows with no region).
_WB_REGION_EXPR = "COALESCE(NULLIF(TRIM(s.region), ''), 'Unknown')"

# Shared filter dimensions the Weekly Brief supports beyond band + quarter.
# Each maps a filter key -> the canonical SQL expression on account_snapshots.
# Blank/NULL collapses to 'Unknown' so the equality filter, the available-*
# option list, and the label the user sees all agree. These mirror the
# dimensions the rest of the dashboard filters on (region / sub-region / CS
# manager / segment / owner) so the brief uses the same mechanism.
_WB_FILTER_EXPRS = {
    "region": _WB_REGION_EXPR,
    "sub_region": "COALESCE(NULLIF(TRIM(s.subregion), ''), 'Unknown')",
    "cs_manager": "COALESCE(NULLIF(TRIM(s.csm_manager), ''), 'Unknown')",
    "segment": "COALESCE(NULLIF(TRIM(s.market_segment), ''), 'Unknown')",
    "owner": "COALESCE(NULLIF(TRIM(s.csm_owner), ''), 'Unknown')",
    "country": "COALESCE(NULLIF(TRIM(s.country), ''), 'Unknown')",
    "industry": "COALESCE(NULLIF(TRIM(s.industry), ''), 'Unknown')",
    "health": "COALESCE(NULLIF(TRIM(s.health_status), ''), 'Unknown')",
    "partner": "COALESCE(NULLIF(TRIM(s.partner), ''), 'Unknown')",
    "partner_type": "COALESCE(NULLIF(TRIM(s.partner_type), ''), 'Unknown')",
}


def _wb_as_list(val) -> list[str]:
    """Comma-separated or list filter values. Empty / __ALL__ => no filter."""
    if val is None or val == "":
        return []
    if isinstance(val, (list, tuple)):
        raw = [str(x).strip() for x in val]
    else:
        raw = [p.strip() for p in str(val).split(",")]
    out: list[str] = []
    for p in raw:
        if p and p.upper() not in ("__ALL__", "ALL"):
            out.append(p)
    return out


def _wb_json_num_sql(key: str) -> str:
    """Safe numeric extract from raw_row JSONB (UPSIDE / DOWNSIDE).

    Mirrors ``_wb_to_number``: strip ``$ , ( ) %`` whitespace, then parse.
    Parentheses are stripped (not treated as a negative), matching the client.
    """
    raw = (
        f"regexp_replace(COALESCE(s.raw_row->>'{key}', ''), "
        f"'[$,()%\\s]', '', 'g')"
    )
    return (
        f"CASE WHEN ({raw}) ~ '^-?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' "
        f"THEN ({raw})::numeric ELSE 0 END"
    )


def _wb_echo_val(val) -> str:
    if isinstance(val, (list, tuple)):
        vals = [str(x).strip() for x in val if str(x).strip()]
        return ",".join(vals) if vals else "__ALL__"
    s = "" if val is None else str(val).strip()
    if not s or s.upper() in ("__ALL__", "ALL"):
        return "__ALL__"
    return s


def _wb_filters_echo(filters: dict) -> dict:
    f = filters or {}
    return {
        "region": _wb_echo_val(f.get("region")),
        "sub_region": _wb_echo_val(f.get("sub_region")),
        "cs_manager": _wb_echo_val(f.get("cs_manager")),
        "segment": _wb_echo_val(f.get("segment")),
        "owner": _wb_echo_val(f.get("owner")),
        "country": _wb_echo_val(f.get("country")),
        "industry": _wb_echo_val(f.get("industry")),
        "health": _wb_echo_val(f.get("health")),
        "partner": _wb_echo_val(f.get("partner")),
        "partner_type": _wb_echo_val(f.get("partner_type")),
        "arr_min": f.get("arr_min"),
        "arr_max": f.get("arr_max"),
        "date_from": f.get("date_from") or None,
        "date_to": f.get("date_to") or None,
        "search": f.get("search") or None,
    }


def _wb_filter_sql(filters: dict, start_index: int) -> tuple[str, list]:
    """Shared-filter WHERE fragment. Each dimension accepts one value or a
    list (``ANY``). Empty / '__ALL__' means all for that dimension."""
    clauses: list[str] = []
    params: list = []
    idx = start_index
    for key, expr in _WB_FILTER_EXPRS.items():
        vals = _wb_as_list(filters.get(key) if filters else None)
        if not vals:
            continue
        if len(vals) == 1:
            clauses.append(f" AND {expr} = ${idx}")
            params.append(vals[0])
        else:
            clauses.append(f" AND {expr} = ANY(${idx}::text[])")
            params.append(vals)
        idx += 1
    arr_min = (filters or {}).get("arr_min")
    if arr_min is not None:
        clauses.append(f" AND COALESCE(s.atr, 0) >= ${idx}")
        params.append(float(arr_min))
        idx += 1
    arr_max = (filters or {}).get("arr_max")
    if arr_max is not None:
        clauses.append(f" AND COALESCE(s.atr, 0) <= ${idx}")
        params.append(float(arr_max))
        idx += 1
    # asyncpg binds a ``::date`` parameter with the date codec, which rejects
    # a str — pass real ``datetime.date`` objects.
    date_from = _wb_parse_date((filters or {}).get("date_from"))
    if date_from is not None:
        clauses.append(f" AND s.next_renewal >= ${idx}::date")
        params.append(date_from)
        idx += 1
    date_to = _wb_parse_date((filters or {}).get("date_to"))
    if date_to is not None:
        clauses.append(f" AND s.next_renewal <= ${idx}::date")
        params.append(date_to)
        idx += 1
    search = ((filters or {}).get("search") or "").strip()
    if search:
        clauses.append(
            f" AND (COALESCE(s.account_name, '') ILIKE ${idx} "
            f"OR COALESCE(s.csm_owner, '') ILIKE ${idx} "
            f"OR COALESCE(s.partner, '') ILIKE ${idx} "
            f"OR COALESCE(s.account_id, '') ILIKE ${idx})"
        )
        params.append("%" + search + "%")
        idx += 1
    return ("".join(clauses), params)


def _wb_band_and_filters(band: str, filters: Optional[dict],
                         start_index: int) -> tuple[str, list]:
    """Official / band predicate + shared-filter fragment."""
    params: list = []
    sql = ""
    idx = start_index
    band_sql, band_params = _wb_band_clause(band, idx)
    sql += band_sql
    params.extend(band_params)
    idx += len(band_params)
    filter_sql, filter_params = _wb_filter_sql(filters or {}, idx)
    sql += filter_sql
    params.extend(filter_params)
    return sql, params


def _wb_meta_dict(row) -> Optional[dict]:
    if row is None:
        return None
    eff = row["eff"]
    return {
        "id": int(row["id"]),
        "slot": row["slot"],
        "filename": row["filename"],
        "uploaded_at": row["uploaded_at"].isoformat(),
        "effective_date": eff.isoformat() if hasattr(eff, "isoformat") else str(eff),
        "row_count": int(row["rc"] or 0),
    }


async def _wb_snapshot_meta(conn, upload_id: int) -> Optional[dict]:
    sql_cached = """
        SELECT u.id, u.slot, u.filename, u.uploaded_at,
               COALESCE(u.snapshot_effective_date, u.uploaded_at) AS eff,
               COALESCE(u.snapshot_row_count, 0) AS rc
        FROM csv_uploads u
        WHERE u.id = $1
        """
    sql_base = """
        SELECT u.id, u.slot, u.filename, u.uploaded_at,
               u.uploaded_at AS eff,
               0 AS rc
        FROM csv_uploads u
        WHERE u.id = $1
        """
    try:
        row = await conn.fetchrow(sql_cached, upload_id, timeout=_WB_QUERY_TIMEOUT_S)
    except UndefinedColumnError:
        row = await conn.fetchrow(sql_base, upload_id, timeout=_WB_QUERY_TIMEOUT_S)
    return _wb_meta_dict(row)


_WB_SNAP_LIST_SQL = """
        SELECT u.id, u.slot, u.filename, u.uploaded_at,
               COALESCE(u.snapshot_effective_date, u.uploaded_at) AS eff,
               COALESCE(u.snapshot_row_count, 0) AS rc
        FROM csv_uploads u
"""

_WB_SNAP_LIST_SQL_BASE = """
        SELECT u.id, u.slot, u.filename, u.uploaded_at,
               u.uploaded_at AS eff,
               0 AS rc
        FROM csv_uploads u
"""


async def _wb_recent_snapshots(conn, slot: str, limit: int) -> list[dict]:
    """Recent uploads for a slot that actually have parsed snapshot rows,
    newest-first by effective_date. Uses cached counts so we never
    COUNT(*) / EXISTS-scan a 280k-row upload just to fill the week selector."""
    try:
        rows = await conn.fetch(
            _WB_SNAP_LIST_SQL
            + """
            WHERE u.slot = $1
              AND COALESCE(u.snapshot_row_count, 0) > 0
            ORDER BY COALESCE(u.snapshot_effective_date, u.uploaded_at) DESC,
                     u.uploaded_at DESC
            LIMIT $2
            """,
            slot,
            limit,
            timeout=_WB_QUERY_TIMEOUT_S,
        )
        if rows:
            return [_wb_meta_dict(r) for r in rows]
        rows = await conn.fetch(
            _WB_SNAP_LIST_SQL
            + """
            WHERE u.slot = $1
              AND EXISTS (
                  SELECT 1 FROM account_snapshots s WHERE s.csv_upload_id = u.id
              )
            ORDER BY COALESCE(u.snapshot_effective_date, u.uploaded_at) DESC,
                     u.uploaded_at DESC
            LIMIT $2
            """,
            slot,
            limit,
            timeout=_WB_QUERY_TIMEOUT_S,
        )
        return [_wb_meta_dict(r) for r in rows]
    except UndefinedColumnError:
        rows = await conn.fetch(
            _WB_SNAP_LIST_SQL_BASE
            + """
            WHERE u.slot = $1
              AND EXISTS (
                  SELECT 1 FROM account_snapshots s WHERE s.csv_upload_id = u.id
              )
            ORDER BY u.uploaded_at DESC
            LIMIT $2
            """,
            slot,
            limit,
            timeout=_WB_QUERY_TIMEOUT_S,
        )
        return [_wb_meta_dict(r) for r in rows]


def _wb_week_cutoff(current_eff: datetime, weeks_back: int) -> datetime:
    """Snapshots older than this count as ``weeks_back`` weeks behind current.
    One day of slack, so last week's run landing a few hours later in the day
    still counts as a week back."""
    return current_eff - timedelta(days=7 * weeks_back - 1)


async def _wb_prior_snapshot(conn, slot: str, current_id: int,
                             current_eff: datetime) -> Optional[dict]:
    """Default comparison: about a week before current, else the snapshot
    right before it (e.g. while there is under a week of history)."""
    weekly = await _wb_snapshot_before(
        conn, slot, current_id, _wb_week_cutoff(current_eff, 1)
    )
    return weekly or await _wb_snapshot_before(conn, slot, current_id, current_eff)


def _wb_weekly_points(current_meta: dict, current_eff: datetime,
                      candidates: list, weeks: int) -> list[dict]:
    """One snapshot per week walking back from current: point k is the newest
    candidate older than ``_wb_week_cutoff(current, k)``, so point 1 is the
    default prior. ``candidates`` is newest-first."""
    dated = [(c, _wb_parse_iso_dt(c["effective_date"])) for c in candidates]
    points = [current_meta]
    seen = {current_meta["id"]}
    for k in range(1, weeks):
        cutoff = _wb_week_cutoff(current_eff, k)
        pick = next((c for c, eff in dated if eff < cutoff), None)
        if pick is None:
            break
        if pick["id"] not in seen:
            seen.add(pick["id"])
            points.append(pick)
    return points


async def _wb_trend_snapshots(conn, slot: str, current_meta: dict,
                              current_eff: datetime, weeks: int) -> list[dict]:
    try:
        rows = await conn.fetch(
            _WB_SNAP_LIST_SQL
            + """
            WHERE u.slot = $1
              AND COALESCE(u.snapshot_row_count, 0) > 0
              AND COALESCE(u.snapshot_effective_date, u.uploaded_at) < $2
              AND COALESCE(u.snapshot_effective_date, u.uploaded_at) >= $3
            ORDER BY COALESCE(u.snapshot_effective_date, u.uploaded_at) DESC,
                     u.uploaded_at DESC
            """,
            slot,
            current_eff,
            current_eff - timedelta(weeks=weeks),
            timeout=_WB_QUERY_TIMEOUT_S,
        )
    except UndefinedColumnError:
        return [current_meta]
    return _wb_weekly_points(
        current_meta, current_eff, [_wb_meta_dict(r) for r in rows], weeks
    )


async def _wb_snapshot_before(conn, slot: str, current_id: int,
                              before: datetime) -> Optional[dict]:
    """Most recent snapshot (with rows) strictly older than ``before``."""
    try:
        row = await conn.fetchrow(
            _WB_SNAP_LIST_SQL
            + """
            WHERE u.slot = $1 AND u.id <> $2
              AND COALESCE(u.snapshot_row_count, 0) > 0
              AND COALESCE(u.snapshot_effective_date, u.uploaded_at) < $3
            ORDER BY COALESCE(u.snapshot_effective_date, u.uploaded_at) DESC,
                     u.uploaded_at DESC
            LIMIT 1
            """,
            slot,
            current_id,
            before,
            timeout=_WB_QUERY_TIMEOUT_S,
        )
        if row:
            return _wb_meta_dict(row)
        row = await conn.fetchrow(
            _WB_SNAP_LIST_SQL
            + """
            WHERE u.slot = $1 AND u.id <> $2
              AND EXISTS (
                  SELECT 1 FROM account_snapshots s WHERE s.csv_upload_id = u.id
              )
              AND COALESCE(u.snapshot_effective_date, u.uploaded_at) < $3
            ORDER BY COALESCE(u.snapshot_effective_date, u.uploaded_at) DESC,
                     u.uploaded_at DESC
            LIMIT 1
            """,
            slot,
            current_id,
            before,
            timeout=_WB_QUERY_TIMEOUT_S,
        )
        return _wb_meta_dict(row)
    except UndefinedColumnError:
        row = await conn.fetchrow(
            _WB_SNAP_LIST_SQL_BASE
            + """
            WHERE u.slot = $1 AND u.id <> $2
              AND EXISTS (
                  SELECT 1 FROM account_snapshots s WHERE s.csv_upload_id = u.id
              )
              AND u.uploaded_at < $3
            ORDER BY u.uploaded_at DESC
            LIMIT 1
            """,
            slot,
            current_id,
            before,
            timeout=_WB_QUERY_TIMEOUT_S,
        )
        return _wb_meta_dict(row)


def _wb_fiscal_quarter_ranges(norm: tuple) -> list[tuple[date, date]]:
    """Inclusive next_renewal bounds for a Zendesk fiscal quarter.

    FY ends January: FY27 = Feb 2026–Jan 2027. Jan 2026 is FY26Q1 (legacy
    one-month exception), so FY26Q4 is Nov–Dec 2025 only.
    """
    fy2, q = int(norm[0]), int(norm[1])
    fy4 = 2000 + (fy2 % 100)
    cal_y = fy4 - 1
    if q == 1:
        out = [(date(cal_y, 2, 1), date(cal_y, 4, 30))]
        if fy2 == 26:
            out.append((date(2026, 1, 1), date(2026, 1, 31)))
        return out
    if q == 2:
        return [(date(cal_y, 5, 1), date(cal_y, 7, 31))]
    if q == 3:
        return [(date(cal_y, 8, 1), date(cal_y, 10, 31))]
    end = date(fy4, 1, 31)
    if fy2 == 26:
        end = date(2025, 12, 31)
    return [(date(cal_y, 11, 1), end)]


def _wb_quarter_clause(labels: list[str], param_index: int) -> tuple[str, list]:
    """Scope by renewal-date fiscal quarter (Zendesk FY), not CSV year_quarter.

    Parsed FY labels become inclusive ``next_renewal`` ranges so a row whose
    CSV quarter label disagrees with its renewal date still matches the
    Filters bar. Unparsed leftover labels keep an index-friendly
    ``year_quarter`` equality.
    """
    labels = [str(x) for x in (labels or []) if x]
    if not labels:
        return ("", [])
    ranges: list[tuple[date, date]] = []
    leftover: list[str] = []
    seen_range: set[tuple[date, date]] = set()
    for lab in labels:
        pair = _wb_normalize_quarter(lab)
        if pair is None:
            leftover.append(lab)
            continue
        for rng in _wb_fiscal_quarter_ranges(pair):
            if rng not in seen_range:
                seen_range.add(rng)
                ranges.append(rng)
    bits: list[str] = []
    params: list = []
    idx = param_index
    for start, end in ranges:
        bits.append(
            f"(s.next_renewal >= ${idx}::date AND s.next_renewal <= ${idx + 1}::date)"
        )
        params.extend([start, end])
        idx += 2
    if leftover:
        if len(leftover) == 1:
            bits.append(f"s.year_quarter = ${idx}")
            params.append(leftover[0])
        else:
            bits.append(f"s.year_quarter = ANY(${idx}::text[])")
            params.append(leftover)
    if not bits:
        return ("", [])
    return (" AND (" + " OR ".join(bits) + ")", params)


async def _wb_probe_quarter_labels(conn, upload_ids: list, requested: list[str]) -> list[str]:
    """Find year_quarter values that actually exist (LIMIT 1 per candidate).

    Never ``DISTINCT year_quarter`` across a 279k-row upload. Exact labels
    first; other spellings only for fiscal quarters that missed.
    """
    ids = [int(x) for x in (upload_ids or []) if x]
    if not ids:
        return []
    found: list[str] = []
    seen: set[str] = set()
    found_norms: set[tuple] = set()

    async def _hit(label: str) -> bool:
        return bool(await conn.fetchval(
            "SELECT 1 FROM account_snapshots "
            "WHERE csv_upload_id = ANY($1::bigint[]) "
            "AND year_quarter = $2 LIMIT 1",
            ids,
            label,
            timeout=8.0,
        ))

    for q in requested or []:
        q = str(q).strip()
        if not q or q in seen:
            continue
        if await _hit(q):
            seen.add(q)
            found.append(q)
            norm = _wb_normalize_quarter(q)
            if norm:
                found_norms.add(norm)

    for q in requested or []:
        pair = _wb_normalize_quarter(q)
        if pair is None or pair in found_norms:
            continue
        for cand in _wb_quarter_spellings(pair):
            if cand in seen:
                continue
            if await _hit(cand):
                seen.add(cand)
                found.append(cand)
                found_norms.add(pair)
    return found


async def _wb_resolve_quarter_labels(
    conn,
    upload_ids: list,
    quarter_param: str,
    date_from,
    date_to,
) -> tuple[list[str], bool, Optional[str]]:
    """Return (sql_labels, auto_selected, display_quarter).

    Labels are passed to ``_wb_quarter_clause``, which turns parsed FY
    tokens into ``next_renewal`` date ranges. Empty sql_labels means no
    quarter predicate. Auto-current-fiscal only when the caller sent
    neither quarters nor dates. No 279k DISTINCT / probe needed.
    """
    requested = _wb_as_list(quarter_param)
    if requested:
        display = ",".join(requested) if len(requested) > 1 else requested[0]
        return (list(requested), False, display)
    if date_from or date_to:
        return ([], False, None)
    fy2, qn = _wb_current_fiscal_quarter(datetime.now(timezone.utc))
    resolved = f"FY{fy2:02d}Q{qn}"
    return ([resolved], True, resolved)


async def _wb_load_region_rollup(conn, upload_id, band: str,
                                 quarter_labels: list[str],
                                 filters: Optional[dict]) -> list:
    """KPI rollup in SQL — one GROUP BY, no per-account dump."""
    if not upload_id:
        return []
    qsql, qparams = _wb_quarter_clause(quarter_labels, 2)
    scope_sql, scope_params = _wb_band_and_filters(
        band, filters, 2 + len(qparams)
    )
    upside = _wb_json_num_sql("UPSIDE")
    downside = _wb_json_num_sql("DOWNSIDE")
    sql = (
        f"SELECT {_WB_REGION_EXPR} AS region, "
        "       COALESCE(SUM(s.bu_fc), 0) AS bu, "
        "       COALESCE(SUM(s.cc), 0) AS cc, "
        f"       COALESCE(SUM(s.bu_fc + ({upside})), 0) AS best, "
        f"       COALESCE(SUM(s.bu_fc + ({downside})), 0) AS worst, "
        "       COUNT(*)::int AS accounts "
        "FROM account_snapshots s "
        "WHERE s.csv_upload_id = $1 "
        + qsql + scope_sql +
        " GROUP BY 1"
    )
    return await conn.fetch(
        sql, upload_id, *qparams, *scope_params,
        timeout=_WB_QUERY_TIMEOUT_S,
    )


def _wb_trend_series(recent: list, trend_rows: list) -> list[dict]:
    trend_by_uid = {int(r["uid"]): r for r in (trend_rows or [])}
    out = []
    for s in sorted(recent or [], key=lambda x: x["effective_date"]):
        tr = trend_by_uid.get(s["id"])
        if tr is None:
            continue
        bu_total = round(float(tr["total_bu"] or 0), 2)
        cc_total = round(float(tr.get("total_cc") or 0), 2)
        cs_total = round(float(tr.get("total_cs") or 0), 2)
        adj_total = round(float(tr["total_adj"] or 0), 2)
        out.append({
            "upload_id": s["id"],
            "effective_date": s["effective_date"],
            "filename": s["filename"],
            "total_bu_fc": bu_total,
            "total_booked_cc": cc_total,
            "total_cs_call": cs_total,
            "total_adjusted_fc": adj_total,
            "gap": round(adj_total - bu_total, 2),
        })
    return out


def _wb_build_summary_sections(cur_rows, pri_rows, trend_rows, trend_meta,
                               current_meta) -> dict:
    by: dict = {}
    for r in cur_rows or []:
        region = (r["region"] or "").strip() or "Unknown"
        by[region] = {
            "region": region,
            "current": float(r["bu"] or 0),
            "prior": 0.0,
            "accounts": int(r["accounts"] or 0),
            "booked": float(r["cc"] or 0),
            "booked_prior": 0.0,
            "best": float(r["best"] or 0),
            "best_prior": 0.0,
            "worst": float(r["worst"] or 0),
            "worst_prior": 0.0,
        }
    for r in pri_rows or []:
        region = (r["region"] or "").strip() or "Unknown"
        rg = by.setdefault(region, {
            "region": region, "current": 0.0, "prior": 0.0, "accounts": 0,
            "booked": 0.0, "booked_prior": 0.0,
            "best": 0.0, "best_prior": 0.0, "worst": 0.0, "worst_prior": 0.0,
        })
        rg["prior"] = float(r["bu"] or 0)
        rg["booked_prior"] = float(r["cc"] or 0)
        rg["best_prior"] = float(r["best"] or 0)
        rg["worst_prior"] = float(r["worst"] or 0)
        if rg["accounts"] == 0:
            rg["accounts"] = int(r["accounts"] or 0)
    regions_out = []
    for rg in by.values():
        delta = rg["current"] - rg["prior"]
        regions_out.append({
            "region": rg["region"],
            "current": round(rg["current"], 2),
            "prior": round(rg["prior"], 2),
            "delta": round(delta, 2),
            "delta_pct": _wb_delta_pct(rg["current"], rg["prior"]),
            "accounts": rg["accounts"],
        })
    regions_out.sort(key=lambda r: r["current"], reverse=True)
    roll_cur = sum(r["current"] for r in regions_out)
    roll_pri = sum(r["prior"] for r in regions_out)
    booked_cur = sum(rg["booked"] for rg in by.values())
    booked_pri = sum(rg["booked_prior"] for rg in by.values())
    best_cur = sum(rg["best"] for rg in by.values())
    best_pri = sum(rg["best_prior"] for rg in by.values())
    worst_cur = sum(rg["worst"] for rg in by.values())
    worst_pri = sum(rg["worst_prior"] for rg in by.values())
    rollup = {
        "current": round(roll_cur, 2),
        "prior": round(roll_pri, 2),
        "delta": round(roll_cur - roll_pri, 2),
        "delta_pct": _wb_delta_pct(roll_cur, roll_pri),
        "accounts": sum(r["accounts"] for r in regions_out),
        "booked": round(booked_cur, 2),
        "booked_prior": round(booked_pri, 2),
        "booked_delta": round(booked_cur - booked_pri, 2),
        "booked_delta_pct": _wb_delta_pct(booked_cur, booked_pri),
        "expected": round(booked_cur + roll_cur, 2),
        "expected_prior": round(booked_pri + roll_pri, 2),
        "expected_delta": round((booked_cur + roll_cur) - (booked_pri + roll_pri), 2),
    }

    def _case(cur: float, pri: float) -> dict:
        return {
            "current_total": round(cur, 2),
            "prior_total": round(pri, 2),
            "delta": round(cur - pri, 2),
            "delta_pct": _wb_delta_pct(cur, pri),
            "top_increase": [],
            "top_decrease": [],
        }

    as_of = _wb_meta_as_of(current_meta)
    days = WEEKLY_BRIEF_DUE_SOON_DAYS
    return {
        "bu_movement": {
            "regions": regions_out,
            "rollup": rollup,
            "trend": _wb_trend_series(trend_meta, trend_rows),
        },
        "worsened": [],
        "worsened_total": 0,
        "worsened_large_total": 0,
        "new_forecast": [],
        "new_forecast_total": 0,
        "new_forecast_large_total": 0,
        "best_case": _case(best_cur, best_pri),
        "worst_case": _case(worst_cur, worst_pri),
        "closed_since_prior": {
            "rows": [], "total": 0, "booked_cc": 0.0, "prior_bu_fc": 0.0,
            "residual_bu": 0.0, "atr": 0.0, "atr_renewed": 0.0,
            "cleared_count": 0, "residual_count": 0, "left_scope_count": 0,
        },
        "due_soon": {
            "from": as_of.isoformat() if as_of else None,
            "to": (as_of + timedelta(days=days)).isoformat() if as_of else None,
            "days": days,
            "rows": [], "total": 0, "atr": 0.0, "bu_fc": 0.0, "booked_cc": 0.0,
        },
    }


def _wb_band_clause(band: str, param_index: int) -> tuple[str, list]:
    """Empty band means 'all'. Official 100K+ uses the Pacing BAND matcher
    (no bound param). Other tokens stay a LIKE on ``s.band``."""
    if not band:
        return ("", [])
    if _wb_is_official_band(band):
        return (_WB_OFFICIAL_BAND_SQL, [])
    key = (band or "").strip().lower()
    if key in _WB_ATR_BAND_SQL:
        return (_WB_ATR_BAND_SQL[key], [])
    if key in _WB_SEGMENT_BAND_SQL:
        return (_WB_SEGMENT_BAND_SQL[key], [])
    return (
        " AND " + _WB_BAND_PREDICATE.replace("$BAND$", f"${param_index}"),
        [band],
    )


def _wb_asof_event(events: list, rounded_atr: int, year_quarter, snap_eff):
    """Latest call event as-of snap_eff matching rounded ATR + normalized quarter."""
    for ev in events:
        ev_eff = ev["effective_date"]
        if snap_eff is not None and ev_eff is not None and ev_eff > snap_eff:
            continue
        if ev["rounded_atr"] != rounded_atr:
            continue
        if not _wb_quarter_match(year_quarter, ev["year_quarter"]):
            continue
        return ev
    return None


async def _wb_on_pool(db, factory):
    """Run ``factory(conn)`` on a fresh pool connection with SET LOCAL 45s.

    Weekly Brief used to hold ONE connection and run current / prior / trend
    back-to-back. Each statement may take tens of seconds; the client aborted
    at 50s while those queries were still queued. Parallel acquires keep wall
    clock near the slowest query, not the sum.
    """
    async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SET LOCAL statement_timeout = '45s'")
            return await factory(conn)


async def _wb_load_trend(conn, trend_ids: list, quarter_labels: list[str],
                         band: str, filters: dict,
                         seed_upload_id: int,
                         include_cs: bool = True) -> list[dict]:
    """BU + booked C/C = cheap SUM GROUP BY. CS-call total = as-of in Python.

    Caller set is taken from the CURRENT snapshot only (not a 12-upload scan),
    then as-of CS is applied across the trend window for those accounts.
    Summary requests skip CS so KPIs land even when the as-of scan is slow.
    """
    qsql, qparams = _wb_quarter_clause(quarter_labels, 2)
    scope_sql, scope_params = _wb_band_and_filters(
        band, filters, 2 + len(qparams)
    )
    bu_sql = (
        "SELECT s.csv_upload_id AS uid, "
        "       COALESCE(SUM(s.bu_fc), 0) AS total_bu, "
        "       COALESCE(SUM(s.cc), 0) AS total_cc "
        "FROM account_snapshots s "
        "WHERE s.csv_upload_id = ANY($1::bigint[]) "
        + qsql
        + scope_sql
        + " GROUP BY s.csv_upload_id"
    )
    bu_rows = await conn.fetch(
        bu_sql, trend_ids, *qparams, *scope_params,
        timeout=_WB_QUERY_TIMEOUT_S,
    )
    if not bu_rows:
        return []

    def _base_row(r, total_cs=0.0):
        total_bu = float(r["total_bu"] or 0)
        return {
            "uid": int(r["uid"]),
            "total_bu": total_bu,
            "total_cc": float(r["total_cc"] or 0),
            "total_cs": total_cs,
            "total_adj": total_bu,
        }

    if not include_cs:
        return [_base_row(r) for r in bu_rows]

    seed_qsql, seed_qparams = _wb_quarter_clause(quarter_labels, 2)
    seed_scope_sql, seed_scope_params = _wb_band_and_filters(
        band, filters, 2 + len(seed_qparams)
    )
    caller_rows = await conn.fetch(
        "SELECT DISTINCT s.account_id AS account_id "
        "FROM account_snapshots s "
        "WHERE s.csv_upload_id = $1 "
        + seed_qsql
        + " AND COALESCE(s.account_id, '') <> '' "
        + seed_scope_sql
        + " AND EXISTS ("
        "    SELECT 1 FROM account_call_events e"
        "    WHERE e.account_id = s.account_id"
        ")",
        seed_upload_id,
        *seed_qparams,
        *seed_scope_params,
        timeout=_WB_QUERY_TIMEOUT_S,
    )
    caller_ids = [r["account_id"] for r in caller_rows if r["account_id"]]
    if not caller_ids:
        return [_base_row(r) for r in bu_rows]

    event_rows = await conn.fetch(
        """
        SELECT account_id, rounded_atr, year_quarter,
               COALESCE(cs_forecast, 0) AS cs,
               effective_date, id
        FROM account_call_events
        WHERE account_id = ANY($1::text[])
        ORDER BY account_id, effective_date DESC, id DESC
        """,
        caller_ids,
        timeout=_WB_QUERY_TIMEOUT_S,
    )
    events_by_acct: dict[str, list] = {}
    for r in event_rows:
        events_by_acct.setdefault(r["account_id"], []).append({
            "rounded_atr": int(r["rounded_atr"] or 0),
            "year_quarter": r["year_quarter"],
            "cs": float(r["cs"] or 0),
            "effective_date": _wb_aware(r["effective_date"]),
        })

    snap_qsql, snap_qparams = _wb_quarter_clause(quarter_labels, 2)
    acct_idx = 2 + len(snap_qparams)
    caller_scope_sql, caller_scope_params = _wb_band_and_filters(
        band, filters, acct_idx + 1
    )
    snap_sql = (
        "SELECT s.csv_upload_id AS uid, s.account_id, s.atr, s.year_quarter, "
        "       s.effective_date "
        "FROM account_snapshots s "
        "WHERE s.csv_upload_id = ANY($1::bigint[]) "
        + snap_qsql
        + f" AND s.account_id = ANY(${acct_idx}::text[]) "
        + caller_scope_sql
    )
    snap_rows = await conn.fetch(
        snap_sql, trend_ids, *snap_qparams, caller_ids, *caller_scope_params,
        timeout=_WB_QUERY_TIMEOUT_S,
    )

    cs_by_uid: dict[int, float] = {}
    for r in snap_rows:
        evs = events_by_acct.get(r["account_id"])
        if not evs:
            continue
        ev = _wb_asof_event(
            evs,
            _wb_round_atr(r["atr"]),
            r["year_quarter"],
            _wb_aware(r["effective_date"]),
        )
        if ev is None:
            continue
        uid = int(r["uid"])
        cs_by_uid[uid] = cs_by_uid.get(uid, 0.0) + ev["cs"]

    return [_base_row(r, total_cs=cs_by_uid.get(int(r["uid"]), 0.0)) for r in bu_rows]


async def _wb_load_accounts(conn, upload_id: int, band: str,
                            quarter_labels: list[str],
                            filters: Optional[dict] = None) -> dict:
    """One aggregated record per account for a snapshot, scoped to band +
    quarter (+ the shared filters). Uses the structured bu_fc/forecast_summary
    columns and extracts only the UPSIDE / DOWNSIDE keys from raw_row (bounded,
    no blob transfer). An empty ``filters`` means all rows (the rollup)."""
    params: list = [upload_id]
    qsql, qparams = _wb_quarter_clause(quarter_labels, 2)
    params.extend(qparams)
    scope_sql, scope_params = _wb_band_and_filters(
        band, filters, 2 + len(qparams)
    )
    params.extend(scope_params)
    sql = (
        """
        SELECT s.account_id, s.account_name, s.region, s.bu_fc,
               s.atr, s.cc, s.done_deal, s.next_renewal, s.forecast_summary,
               s.raw_row->>'UPSIDE' AS upside_raw,
               s.raw_row->>'DOWNSIDE' AS downside_raw,
               COALESCE(s.raw_row->>'ATR_ARR_USD_LTG',
                        s.raw_row->>'atr_arr_usd_ltg') AS ltg_raw
        FROM account_snapshots s
        WHERE s.csv_upload_id = $1
        """
        + qsql
        + scope_sql
    )
    rows = await conn.fetch(sql, *params, timeout=_WB_QUERY_TIMEOUT_S)
    out: dict = {}
    for r in rows:
        acct_id = (r["account_id"] or "").strip()
        name = (r["account_name"] or "").strip()
        key = acct_id or ("name:" + name.lower())
        if not key or key == "name:":
            continue
        entry = out.get(key)
        if entry is None:
            entry = {
                "key": key,
                "account_id": acct_id or None,
                "account_name": name or acct_id or "(unknown)",
                "region": (r["region"] or "").strip() or "Unknown",
                "bu_fc": 0.0,
                "atr": 0.0,
                "cc": 0.0,
                "upside": 0.0,
                "downside": 0.0,
                "done_deal": False,
                "ltg": None,
                "next_renewal": None,
                "forecast_summary": None,
            }
            out[key] = entry
        entry["bu_fc"] += float(r["bu_fc"] or 0)
        entry["atr"] += float(r["atr"] or 0)
        entry["cc"] += float(r["cc"] or 0)
        entry["upside"] += _wb_to_number(r["upside_raw"])
        entry["downside"] += _wb_to_number(r["downside_raw"])
        if _wb_is_truthy_done(r["done_deal"]):
            entry["done_deal"] = True
        ltg = _wb_parse_ltg(r["ltg_raw"])
        if ltg is not None:
            entry["ltg"] = (entry["ltg"] or 0.0) + ltg
        nr = _wb_parse_date(r["next_renewal"])
        if nr is not None and (entry["next_renewal"] is None or nr < entry["next_renewal"]):
            entry["next_renewal"] = nr
        fs = (r["forecast_summary"] or "").strip()
        if fs and not entry["forecast_summary"]:
            entry["forecast_summary"] = fs[:_EXPLANATION_MAX_CHARS]
    return out


def _wb_closed_since_prior(current_map: dict, prior_map: dict) -> dict:
    """Accounts open on the prior snapshot that are closed (or gone) now."""
    rows = []
    for key, pri in prior_map.items():
        if _wb_is_done(pri):
            continue
        cur = current_map.get(key)
        left_scope = cur is None
        if not left_scope and not _wb_is_done(cur):
            continue
        base = cur or pri
        prior_bu = float(pri.get("bu_fc") or 0)
        current_bu = float(cur.get("bu_fc") or 0) if cur else 0.0
        booked = float((cur or pri).get("cc") or 0)
        atr = float((cur or pri).get("atr") or 0)
        atr_renewed = atr - booked
        residual = current_bu
        if left_scope:
            transfer = "left_scope"
        elif residual <= _WB_BU_ZERO_EPS:
            transfer = "cleared"
        elif residual < booked:
            transfer = "residual_below_booked"
        else:
            transfer = "residual_at_or_above_booked"
        nr = (cur or pri).get("next_renewal")
        rows.append({
            "account_id": base.get("account_id"),
            "account_name": base.get("account_name"),
            "region": base.get("region") or "Unknown",
            "prior_bu_fc": round(prior_bu, 2),
            "current_bu_fc": round(current_bu, 2),
            "booked_cc": round(booked, 2),
            "atr": round(atr, 2),
            "atr_renewed": round(atr_renewed, 2),
            "residual_bu": round(residual, 2),
            "bu_cleared": residual <= _WB_BU_ZERO_EPS,
            "left_scope": left_scope,
            "transfer": transfer,
            "next_renewal": nr.isoformat() if isinstance(nr, date) else None,
        })
    rows.sort(key=lambda r: (r["booked_cc"], r["prior_bu_fc"]), reverse=True)
    total = len(rows)
    capped = rows[:WEEKLY_BRIEF_LIST_CAP]
    return {
        "rows": capped,
        "total": total,
        "booked_cc": round(sum(r["booked_cc"] for r in rows), 2),
        "prior_bu_fc": round(sum(r["prior_bu_fc"] for r in rows), 2),
        "residual_bu": round(sum(r["residual_bu"] for r in rows), 2),
        "atr": round(sum(r["atr"] for r in rows), 2),
        "atr_renewed": round(sum(r["atr_renewed"] for r in rows), 2),
        "cleared_count": sum(1 for r in rows if r["transfer"] == "cleared"),
        "residual_count": sum(1 for r in rows if r["transfer"] not in ("cleared", "left_scope")),
        "left_scope_count": sum(1 for r in rows if r["left_scope"]),
    }


def _wb_due_soon(current_map: dict, as_of: Optional[date],
                 days: int = WEEKLY_BRIEF_DUE_SOON_DAYS) -> dict:
    """Open renewals with NEXT_RENEWAL_DATE in [as_of, as_of + days]."""
    empty = {
        "from": as_of.isoformat() if as_of else None,
        "to": (as_of + timedelta(days=days)).isoformat() if as_of else None,
        "days": days,
        "rows": [],
        "total": 0,
        "atr": 0.0,
        "bu_fc": 0.0,
        "booked_cc": 0.0,
    }
    if as_of is None:
        return empty
    until = as_of + timedelta(days=days)
    rows = []
    for entry in current_map.values():
        if _wb_is_done(entry):
            continue
        nr = entry.get("next_renewal")
        if not isinstance(nr, date) or nr < as_of or nr > until:
            continue
        bu = float(entry.get("bu_fc") or 0)
        atr = float(entry.get("atr") or 0)
        booked = float(entry.get("cc") or 0)
        rows.append({
            "account_id": entry.get("account_id"),
            "account_name": entry.get("account_name"),
            "region": entry.get("region") or "Unknown",
            "next_renewal": nr.isoformat(),
            "days_until": (nr - as_of).days,
            "atr": round(atr, 2),
            "bu_fc": round(bu, 2),
            "booked_cc": round(booked, 2),
        })
    rows.sort(key=lambda r: (r["next_renewal"] or "9999", -(r["atr"] or 0)))
    total = len(rows)
    capped = rows[:WEEKLY_BRIEF_DUE_SOON_CAP]
    return {
        "from": as_of.isoformat(),
        "to": until.isoformat(),
        "days": days,
        "rows": capped,
        "total": total,
        "atr": round(sum(r["atr"] for r in rows), 2),
        "bu_fc": round(sum(r["bu_fc"] for r in rows), 2),
        "booked_cc": round(sum(r["booked_cc"] for r in rows), 2),
    }


def _wb_delta_pct(current: float, prior: float):
    if prior == 0:
        return None
    return (current - prior) / abs(prior) * 100.0


@router.get("/weekly-brief")
@router.get("/weekly-brief/weeks")
async def weekly_brief(
    request: Request,
    slot: str = Query(default="active"),
    current: Optional[int] = Query(default=None),
    prior: Optional[int] = Query(default=None),
    quarter: str = Query(default=""),
    band: str = Query(default=WEEKLY_BRIEF_BAND_DEFAULT),
    threshold: float = Query(default=WEEKLY_BRIEF_LARGE_SWING_DEFAULT),
    region: str = Query(default=""),
    sub_region: str = Query(default=""),
    cs_manager: str = Query(default=""),
    segment: str = Query(default=""),
    owner: str = Query(default=""),
    country: str = Query(default=""),
    industry: str = Query(default=""),
    health: str = Query(default=""),
    partner: str = Query(default=""),
    partner_type: str = Query(default=""),
    search: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    arr_min: Optional[float] = Query(default=None),
    arr_max: Optional[float] = Query(default=None),
    meta: bool = Query(default=False),
    part: str = Query(default="full"),
) -> dict:
    """Weekly 100K+ Regional Brief: WoW bottoms-up forecast movement.

    ``part=summary`` is SQL GROUP BY KPIs (always the first paint).
    ``part=lists`` is account-level movers / closed / due-soon.
    ``part=full`` is both (legacy clients). Dimensions accept comma lists.
    Dates are inclusive on ``next_renewal``. Quarters are probed with
    LIMIT 1 — never DISTINCT across a 279k-row upload.
    """
    normalised_slot = (slot or "active").strip().lower()
    if normalised_slot not in ("active", "historical"):
        raise HTTPException(status_code=400, detail="slot must be active or historical")

    part_key = (part or "full").strip().lower()
    part_header = (request.headers.get("x-renewals-brief-part") or "").strip().lower()
    path_l = (request.url.path or "").rstrip("/").lower()
    if path_l.endswith("/weekly-brief/weeks") or part_header == "meta" or part_key == "meta":
        meta = True
        part_key = "meta"
    elif part_header in ("summary", "lists", "full"):
        part_key = part_header
    if part_key not in ("summary", "lists", "full", "meta"):
        part_key = "full"

    # Pacing lens: default 100K+ Official (BAND column), not ATR ≥ $100K.
    # band=all only when the caller is intentionally unscoped AND sent an ARR
    # range; otherwise Official so Brief booked C/C matches Pacing.
    _raw_band = (band or "").strip()
    _raw_l = _raw_band.lower()
    if _raw_l in ("all", "__all__"):
        band_param = "" if (arr_min is not None or arr_max is not None) else WEEKLY_BRIEF_BAND_DEFAULT
    elif _raw_l in ("100k_official", "100kofficial"):
        band_param = WEEKLY_BRIEF_BAND_DEFAULT
    else:
        band_param = _raw_band or WEEKLY_BRIEF_BAND_DEFAULT

    date_from_s = (date_from or "").strip()[:10] or None
    date_to_s = (date_to or "").strip()[:10] or None
    search_s = (search or "").strip() or None
    filters = {
        "region": _wb_as_list(region),
        "sub_region": _wb_as_list(sub_region),
        "cs_manager": _wb_as_list(cs_manager),
        "segment": _wb_as_list(segment),
        "owner": _wb_as_list(owner),
        "country": _wb_as_list(country),
        "industry": _wb_as_list(industry),
        "health": _wb_as_list(health),
        "partner": _wb_as_list(partner),
        "partner_type": _wb_as_list(partner_type),
        "arr_min": arr_min,
        "arr_max": arr_max,
        "date_from": date_from_s,
        "date_to": date_to_s,
        "search": search_s,
    }
    region_vals = filters["region"]
    region_f = region_vals[0] if len(region_vals) == 1 else ""
    try:
        threshold_val = float(threshold)
    except (TypeError, ValueError):
        threshold_val = WEEKLY_BRIEF_LARGE_SWING_DEFAULT

    available: dict[str, list] = {dim: [] for dim in _WB_FILTER_EXPRS}
    available_regions = available["region"]

    def _wire(*, current_meta, prior_meta, warning, recent,
              resolved_quarter, quarter_auto, quarter_labels,
              sections, lists_pending, meta_only=False):
        echo = _wb_filters_echo(filters)
        return {
            "ok": True,
            "slot": normalised_slot,
            "band": band_param,
            "threshold": threshold_val,
            "region": region_f or "__ALL__",
            "filters": echo,
            "available_regions": available_regions,
            "available_sub_regions": available["sub_region"],
            "available_cs_managers": available["cs_manager"],
            "available_segments": available["segment"],
            "available_owners": available["owner"],
            "quarter": resolved_quarter,
            "quarter_auto_selected": quarter_auto,
            "quarter_labels": quarter_labels or [],
            "current": current_meta,
            "prior": prior_meta,
            "warning": warning,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "snapshots": recent,
            "sections": sections,
            "meta_only": meta_only,
            "lists_pending": lists_pending,
            "part": "meta" if meta_only else part_key,
        }

    db = _db(request)
    want_lists = False
    want_summary = True
    current_map: dict = {}
    prior_map: dict = {}
    note_map: dict = {}
    trend_rows: list = []
    cur_roll: list = []
    pri_roll: list = []
    try:
      header = None
      async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SET LOCAL statement_timeout = '20s'")
            recent = await _wb_recent_snapshots(
                conn, normalised_slot, WEEKLY_BRIEF_PICKER_LIMIT
            )

            # Retention can delete a pinned snapshot while the tab is open;
            # fall back to the default pick for that side.
            replaced: list[str] = []
            if current is not None:
                current_meta = await _wb_snapshot_meta(conn, int(current))
                if current_meta is None and recent:
                    replaced.append(f"Current (#{int(current)}) now shows the latest snapshot")
                    current_meta = recent[0]
            else:
                current_meta = recent[0] if recent else None

            if current_meta is None:
                return _wire(
                    current_meta=None, prior_meta=None,
                    warning="No snapshots with parsed rows are available yet.",
                    recent=recent, resolved_quarter=None, quarter_auto=False,
                    quarter_labels=[], sections=None, lists_pending=False,
                    meta_only=True,
                )

            current_id = current_meta["id"]
            try:
                current_eff = _wb_parse_iso_dt(current_meta["effective_date"])
            except (TypeError, ValueError):
                current_eff = _wb_parse_iso_dt(current_meta["uploaded_at"])

            prior_meta = None
            if prior is not None:
                prior_meta = await _wb_snapshot_meta(conn, int(prior))
                if prior_meta is None:
                    replaced.append(
                        f"Prior (#{int(prior)}) now shows the snapshot about a week before Current"
                    )
            if prior_meta is None or (replaced and prior_meta["id"] == current_id):
                prior_meta = await _wb_prior_snapshot(
                    conn, normalised_slot, current_id, current_eff
                )

            notes: list[str] = []
            if replaced:
                notes.append(
                    "A selected snapshot is no longer kept (after "
                    f"{SNAPSHOT_KEEP_ALL_DAYS} days only one per week is retained). "
                    + "; ".join(replaced) + "."
                )
            if prior_meta is None:
                notes.append(
                    "Only one snapshot is available — WoW comparison needs at "
                    "least two. Showing current values with no prior baseline."
                )
            warning = " ".join(notes) or None

            probe_ids = [current_id]
            if prior_meta:
                probe_ids.append(prior_meta["id"])

            # Week picker: any request without an explicit current id is
            # meta-only. Do not dump 279k rows just to fill two dropdowns,
            # and do not require the client to send ?meta=true (unknown
            # query params 404 on some App Foundry gateways).
            if meta or current is None or part_key == "meta":
                return _wire(
                    current_meta=current_meta, prior_meta=prior_meta,
                    warning=warning, recent=recent,
                    resolved_quarter=None, quarter_auto=False,
                    quarter_labels=[], sections=None, lists_pending=False,
                    meta_only=True,
                )

            trend_meta = await _wb_trend_snapshots(
                conn, normalised_slot, current_meta, current_eff,
                WEEKLY_BRIEF_TREND_LIMIT,
            )
            if prior_meta and all(s["id"] != prior_meta["id"] for s in trend_meta):
                trend_meta.append(prior_meta)

            qlabels, quarter_auto, resolved_quarter = await _wb_resolve_quarter_labels(
                conn, probe_ids, quarter, date_from_s, date_to_s,
            )

            header = {
                "recent": recent,
                "trend_meta": trend_meta,
                "current_meta": current_meta,
                "prior_meta": prior_meta,
                "warning": warning,
                "current_id": current_id,
                "trend_ids": [s["id"] for s in trend_meta],
                "quarter_labels": qlabels,
                "resolved_quarter": resolved_quarter,
                "quarter_auto": quarter_auto,
            }

      prior_id = header["prior_meta"]["id"] if header["prior_meta"] else None
      qlabels = header["quarter_labels"]
      want_summary = part_key in ("summary", "full")
      want_lists = part_key in ("lists", "full")

      async def _load_acct(upload_id):
          if not upload_id:
              return {}
          return await _wb_on_pool(
              db,
              lambda c, uid=upload_id: _wb_load_accounts(
                  c, uid, band_param, qlabels, filters
              ),
          )

      async def _load_trend(include_cs: bool):
          return await _wb_on_pool(
              db,
              lambda c, cs=include_cs: _wb_load_trend(
                  c, header["trend_ids"], qlabels, band_param, filters,
                  header["current_id"], cs,
              ),
          )

      async def _load_rollup(upload_id):
          if not upload_id:
              return []
          return await _wb_on_pool(
              db,
              lambda c, uid=upload_id: _wb_load_region_rollup(
                  c, uid, band_param, qlabels, filters
              ),
          )

      current_map: dict = {}
      prior_map: dict = {}
      note_map: dict = {}
      trend_rows: list = []
      cur_roll: list = []
      pri_roll: list = []

      if want_summary and not want_lists:
          cur_roll, pri_roll, trend_rows = await asyncio.gather(
              _load_rollup(header["current_id"]),
              _load_rollup(prior_id),
              _load_trend(False),
          )
      elif want_lists and not want_summary:
          current_map, prior_map, trend_rows = await asyncio.gather(
              _load_acct(header["current_id"]),
              _load_acct(prior_id),
              _load_trend(True),
          )
      else:
          current_map, prior_map, trend_rows = await asyncio.gather(
              _load_acct(header["current_id"]),
              _load_acct(prior_id),
              _load_trend(True),
          )

      if want_lists:
          acct_ids = sorted({
              e["account_id"] for e in current_map.values() if e["account_id"]
          })
          if acct_ids:
              async def _load_notes(c):
                  return await c.fetch(
                      """
                      SELECT DISTINCT ON (account_id) account_id, note_text
                      FROM notes
                      WHERE account_id = ANY($1::text[])
                        AND archived = FALSE AND COALESCE(note_text, '') <> ''
                      ORDER BY account_id, updated_at DESC
                      """,
                      acct_ids,
                      timeout=_WB_QUERY_TIMEOUT_S,
                  )
              note_rows = await _wb_on_pool(db, _load_notes)
              note_map = {
                  r["account_id"]: (r["note_text"] or "").strip()
                  for r in note_rows
              }

      recent = header["recent"]
      trend_meta = header["trend_meta"]
      current_meta = header["current_meta"]
      prior_meta = header["prior_meta"]
      warning = header["warning"]
      resolved_quarter = header["resolved_quarter"]
      quarter_auto = header["quarter_auto"]
      quarter_labels = header["quarter_labels"]
    except (QueryCanceledError, TimeoutError, asyncio.TimeoutError):
        raise HTTPException(
            status_code=504,
            detail="Weekly brief timed out. Try a narrower quarter or ARR filter.",
        )
    except UndefinedColumnError:
        logger.exception("weekly-brief missing column")
        raise HTTPException(
            status_code=500,
            detail="Weekly brief is missing a database column. Restart the service so schema updates apply.",
        )
    except Exception:
        logger.exception("weekly-brief query failed")
        raise HTTPException(
            status_code=500,
            detail="Weekly brief failed to load. Try again, or narrow Filters.",
        )

    try:
        if want_lists:
            payload = _wb_build_payload(
                normalised_slot=normalised_slot,
                band_param=band_param,
                threshold_val=threshold_val,
                filters=filters,
                region_f=region_f,
                available=available,
                available_regions=available_regions,
                resolved_quarter=resolved_quarter,
                quarter_auto=quarter_auto,
                quarter_labels=quarter_labels,
                current_meta=current_meta,
                prior_meta=prior_meta,
                warning=warning,
                recent=recent,
                trend_meta=trend_meta,
                current_map=current_map,
                prior_map=prior_map,
                note_map=note_map,
                trend_rows=trend_rows,
            )
            payload["lists_pending"] = False
            payload["part"] = part_key
            payload["filters"] = _wb_filters_echo(filters)
            return payload
        sections = _wb_build_summary_sections(
            cur_roll, pri_roll, trend_rows, trend_meta, current_meta,
        )
        return _wire(
            current_meta=current_meta, prior_meta=prior_meta,
            warning=warning, recent=recent,
            resolved_quarter=resolved_quarter, quarter_auto=quarter_auto,
            quarter_labels=quarter_labels, sections=sections,
            lists_pending=True,
        )
    except Exception:
        logger.exception("weekly-brief section build failed")
        raise HTTPException(
            status_code=500,
            detail="Weekly brief failed to assemble. Try again, or narrow Filters.",
        )


def _wb_build_payload(
    *,
    normalised_slot,
    band_param,
    threshold_val,
    filters,
    region_f,
    available,
    available_regions,
    resolved_quarter,
    quarter_auto,
    quarter_labels,
    current_meta,
    prior_meta,
    warning,
    recent,
    trend_meta,
    current_map,
    prior_map,
    note_map,
    trend_rows,
) -> dict:
    def _explain(entry: dict):
        # Legacy single-source fallback, kept for back-compat on the
        # explanation/explanation_source fields (UI now uses the pair below).
        fs = entry.get("forecast_summary")
        if fs:
            return fs, "forecast_summary"
        note = note_map.get(entry["account_id"]) if entry.get("account_id") else None
        if note:
            return note[:_EXPLANATION_MAX_CHARS], "note"
        return None, None

    def _explain_fields(entry: dict):
        # Two separate, clearly-labeled sources for the "what happened" area.
        # Each is nullable (present only when it has content) and truncated to
        # _EXPLANATION_MAX_CHARS. forecast_summary is already truncated on the
        # entry when it was loaded; the note is truncated here.
        fs = entry.get("forecast_summary") or None
        note = note_map.get(entry["account_id"]) if entry.get("account_id") else None
        note = note[:_EXPLANATION_MAX_CHARS] if note else None
        return fs, note

    all_keys = set(current_map) | set(prior_map)

    # Section 1 — BU movement per region + rollup
    region_agg: dict = {}
    for key in all_keys:
        cur = current_map.get(key)
        pri = prior_map.get(key)
        base = cur or pri
        region = base["region"]
        c_bu = cur["bu_fc"] if cur else 0.0
        p_bu = pri["bu_fc"] if pri else 0.0
        rg = region_agg.setdefault(
            region, {"region": region, "current": 0.0, "prior": 0.0, "accounts": 0}
        )
        rg["current"] += c_bu
        rg["prior"] += p_bu
        rg["accounts"] += 1
    regions_out = []
    for rg in region_agg.values():
        delta = rg["current"] - rg["prior"]
        regions_out.append({
            "region": rg["region"],
            "current": round(rg["current"], 2),
            "prior": round(rg["prior"], 2),
            "delta": round(delta, 2),
            "delta_pct": _wb_delta_pct(rg["current"], rg["prior"]),
            "accounts": rg["accounts"],
        })
    regions_out.sort(key=lambda r: r["current"], reverse=True)
    roll_cur = sum(r["current"] for r in regions_out)
    roll_pri = sum(r["prior"] for r in regions_out)
    booked_cur = sum(float(e.get("cc") or 0) for e in current_map.values())
    booked_pri = sum(float(e.get("cc") or 0) for e in prior_map.values())
    rollup = {
        "current": round(roll_cur, 2),
        "prior": round(roll_pri, 2),
        "delta": round(roll_cur - roll_pri, 2),
        "delta_pct": _wb_delta_pct(roll_cur, roll_pri),
        "accounts": sum(r["accounts"] for r in regions_out),
        "booked": round(booked_cur, 2),
        "booked_prior": round(booked_pri, 2),
        "booked_delta": round(booked_cur - booked_pri, 2),
        "booked_delta_pct": _wb_delta_pct(booked_cur, booked_pri),
        "expected": round(booked_cur + roll_cur, 2),
        "expected_prior": round(booked_pri + roll_pri, 2),
        "expected_delta": round((booked_cur + roll_cur) - (booked_pri + roll_pri), 2),
    }
    trend_series = _wb_trend_series(trend_meta, trend_rows)

    # Section 2 — worsened WoW (BU_FC increased == more churn/contraction)
    worsened = []
    for key in all_keys:
        cur = current_map.get(key)
        pri = prior_map.get(key)
        base = cur or pri
        c_bu = cur["bu_fc"] if cur else 0.0
        p_bu = pri["bu_fc"] if pri else 0.0
        swing = c_bu - p_bu
        # Require a real PRIOR forecast (p_bu > 0). Brand-new forecasts
        # ($0 prior -> FC now) are reported only in the "New $0->FC" section,
        # so the two lists are mutually exclusive (no double-listing).
        if p_bu > 0 and swing > 0:
            rec = {
                "account_id": base["account_id"],
                "account_name": base["account_name"],
                "region": base["region"],
                "current_bu_fc": round(c_bu, 2),
                "prior_bu_fc": round(p_bu, 2),
                "swing": round(swing, 2),
                "is_large": swing >= threshold_val,
            }
            if rec["is_large"]:
                exp, src = _explain(base)
                rec["explanation"] = exp
                rec["explanation_source"] = src
                fs, note = _explain_fields(base)
                rec["forecast_summary"] = fs
                rec["renewals_studio_note"] = note
            worsened.append(rec)
    worsened.sort(key=lambda r: r["swing"], reverse=True)
    # True totals BEFORE truncation, so the KPI tiles show the real count
    # (not the 100-row list cap). The table still returns only the top N.
    worsened_total = len(worsened)
    worsened_large_total = sum(1 for r in worsened if r["is_large"])
    worsened = worsened[:WEEKLY_BRIEF_LIST_CAP]

    # Section 3 — new in-quarter forecast ($0 prior -> forecast now)
    new_forecast = []
    for key in all_keys:
        cur = current_map.get(key)
        pri = prior_map.get(key)
        p_bu = pri["bu_fc"] if pri else 0.0
        c_bu = cur["bu_fc"] if cur else 0.0
        if p_bu == 0 and c_bu > 0 and cur is not None:
            rec = {
                "account_id": cur["account_id"],
                "account_name": cur["account_name"],
                "region": cur["region"],
                "current_bu_fc": round(c_bu, 2),
                "prior_bu_fc": round(p_bu, 2),
                "is_large": c_bu >= threshold_val,
            }
            if rec["is_large"]:
                exp, src = _explain(cur)
                rec["explanation"] = exp
                rec["explanation_source"] = src
                fs, note = _explain_fields(cur)
                rec["forecast_summary"] = fs
                rec["renewals_studio_note"] = note
            new_forecast.append(rec)
    new_forecast.sort(key=lambda r: r["current_bu_fc"], reverse=True)
    new_forecast_total = len(new_forecast)
    new_forecast_large_total = sum(1 for r in new_forecast if r["is_large"])
    new_forecast = new_forecast[:WEEKLY_BRIEF_LIST_CAP]

    # Section 4 — Best Case / Worst Case movement + top-5 up/down drivers.
    # These are absolute forecasted-C/C totals matching the app's existing
    # Best/Worst Case columns:
    #   best_case  = bu_fc + UPSIDE   (UPSIDE arrives negative -> least churn)
    #   worst_case = bu_fc + DOWNSIDE (DOWNSIDE arrives positive -> most churn)
    # so best_case <= bu <= worst_case. value_fn maps an account entry to its
    # per-account value; movers rank by per-account WoW change in that value.
    def _movement_section(value_fn) -> dict:
        cur_total = sum(value_fn(e) for e in current_map.values())
        pri_total = sum(value_fn(e) for e in prior_map.values())
        movers = []
        for key in all_keys:
            cur = current_map.get(key)
            pri = prior_map.get(key)
            base = cur or pri
            c_v = value_fn(cur) if cur else 0.0
            p_v = value_fn(pri) if pri else 0.0
            d = c_v - p_v
            if d == 0:
                continue
            movers.append({
                "account_id": base["account_id"],
                "account_name": base["account_name"],
                "region": base["region"],
                "current_value": round(c_v, 2),
                "prior_value": round(p_v, 2),
                "delta": round(d, 2),
            })
        top_increase = sorted(
            [m for m in movers if m["delta"] > 0],
            key=lambda m: m["delta"], reverse=True,
        )[:5]
        top_decrease = sorted(
            [m for m in movers if m["delta"] < 0],
            key=lambda m: m["delta"],
        )[:5]
        return {
            "current_total": round(cur_total, 2),
            "prior_total": round(pri_total, 2),
            "delta": round(cur_total - pri_total, 2),
            "delta_pct": _wb_delta_pct(cur_total, pri_total),
            "top_increase": top_increase,
            "top_decrease": top_decrease,
        }

    best_case_section = _movement_section(
        lambda e: (e["bu_fc"] or 0.0) + (e["upside"] or 0.0)
    )
    worst_case_section = _movement_section(
        lambda e: (e["bu_fc"] or 0.0) + (e["downside"] or 0.0)
    )

    closed_section = _wb_closed_since_prior(current_map, prior_map)
    due_soon_section = _wb_due_soon(
        current_map, _wb_meta_as_of(current_meta), WEEKLY_BRIEF_DUE_SOON_DAYS
    )

    return {
        "ok": True,
        "slot": normalised_slot,
        "band": band_param,
        "threshold": threshold_val,
        "region": region_f or "__ALL__",
        "filters": _wb_filters_echo(filters),
        "available_regions": available_regions,
        "available_sub_regions": available["sub_region"],
        "available_cs_managers": available["cs_manager"],
        "available_segments": available["segment"],
        "available_owners": available["owner"],
        "quarter": resolved_quarter,
        "quarter_auto_selected": quarter_auto,
        "quarter_labels": quarter_labels,
        "current": current_meta,
        "prior": prior_meta,
        "warning": warning,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshots": recent,
        "lists_pending": False,
        "part": "lists",
        "sections": {
            "bu_movement": {
                "regions": regions_out,
                "rollup": rollup,
                "trend": trend_series,
            },
            "worsened": worsened,
            "worsened_total": worsened_total,
            "worsened_large_total": worsened_large_total,
            "new_forecast": new_forecast,
            "new_forecast_total": new_forecast_total,
            "new_forecast_large_total": new_forecast_large_total,
            "best_case": best_case_section,
            "worst_case": worst_case_section,
            "closed_since_prior": closed_section,
            "due_soon": due_soon_section,
        },
    }
