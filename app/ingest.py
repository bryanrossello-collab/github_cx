"""Server-side CSV parsing for the historical snapshot table.

The dashboard still parses the CSV client-side via Papaparse — this module
exists in parallel so the same upload bytes also get materialised into
``account_snapshots`` rows. Historical SQL queries (WoW risk shifts,
account-state-over-time, etc.) can then run against the parsed table
without re-parsing 12 MB CSVs on every request.

Design notes:
  * Resilient — unknown columns are dropped silently into ``raw_row``
    (JSONB) so the dashboard's authoritative parse is never blocked by a
    new column the server doesn't know about.
  * Idempotent — re-running ingest for the same csv_upload_id is a no-op
    (clears + re-inserts inside one transaction).
  * Bounded — we stop parsing after MAX_ROWS to protect against a
    runaway upload; the limit is generous and never hit in normal use.
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, timezone
import re
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

# Safety cap against a runaway upload. Sized well above the realistic unified
# pull (~86K rows at the 50000 ARR floor; ~200K+ at lower floors), so a normal
# refresh is NEVER truncated. NOTE: hitting this only truncates the
# account_snapshots load (Weekly Brief / historical SQL); the dashboard's main
# view parses the FULL CSV bytes from csv_uploads client-side and is unaffected.
MAX_ROWS = 500_000

# Lower-case canonical column → list of accepted header aliases (also
# lower-cased before lookup). Strings, not regexes — we expect exact match.
HEADER_ALIASES: dict[str, list[str]] = {
    "account_id":       ["crm_account_id", "account_id", "acct_id"],
    "account_name":     ["crm_account_name", "account_name", "account"],
    "year_quarter":     ["year_quarter_yyyyqq", "year_quarter", "fiscal_quarter", "fq"],
    "band":             ["band", "atr_band"],
    "atr":              ["atr_arr_usd_starting", "atr", "atr_usd"],
    "net_arr":          ["net_arr_usd", "net_arr"],
    "net_arr_prior":    ["net_arr_usd_prior_qtr_end"],
    "bu_fc":            ["bu_fc", "bufc"],
    "cc":               ["cc", "qtd_cc"],
    "cc_offcycle":      ["cc_offcycle_arr"],
    "expansion":        ["expansion"],
    "region":           ["region"],
    "market_segment":   ["pro_forma_market_segment", "market_segment", "segment"],
    "subregion":        ["pro_forma_subregion", "subregion"],
    "country":          ["billing_country", "country"],
    "industry":         ["territory_industry_c", "industry"],
    "term_grouped":     ["term_grouped", "term"],
    "health_status":    ["crm_health_status", "health_status", "health"],
    "auto_renew":       ["auto_renew"],
    "next_renewal":     ["next_renewal_date", "next_renewal", "renewal_date"],
    "done_deal":        ["done_deal"],
    "ramp_deal":        ["ramp_deal"],
    "days_since_touch": ["days_since_last_cs_touch", "days_since_touch"],
    "csm_owner":        ["crm_success_owner_name", "csm_owner", "csm"],
    "csm_pass_2":       ["crm_owner_name"],
    "csm_manager":      ["manager_success", "csm_manager"],
    "renewal_owner":    ["crm_renewal_owner_name", "renewal_owner"],
    "renewal_manager":  ["manager_renewal", "renewal_manager"],
    "products":         ["product_lines", "products"],
    "forecast_summary": ["forecast_summary"],
    "cc_reason":        ["cc_reason"],
    "partner":          ["partner_name", "partner"],
    "partner_type":     ["partner_type_c", "partner_type"],
}

NUMERIC_COLUMNS = {
    "atr", "net_arr", "net_arr_prior", "bu_fc", "cc", "cc_offcycle", "expansion",
}
INTEGER_COLUMNS = {"days_since_touch"}
BOOLEAN_COLUMNS = {"auto_renew", "done_deal", "ramp_deal"}
DATE_COLUMNS = {"next_renewal"}


def resolve_effective_date(filename: str, uploaded_at: datetime) -> datetime:
    """Best-effort as-of date from filename, else upload timestamp."""
    if uploaded_at.tzinfo is None:
        uploaded_at = uploaded_at.replace(tzinfo=timezone.utc)
    name = filename or ""
    patterns = (
        r"(20\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])",
        r"(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])",
    )
    for pat in patterns:
        m = re.search(pat, name)
        if not m:
            continue
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return datetime(y, mo, d, 12, 0, 0, tzinfo=timezone.utc)
        except ValueError:
            continue
    return uploaded_at


def _build_header_index(header_row: list[str]) -> dict[str, int]:
    """Map each canonical column → CSV column index. Returns empty mapping
    for columns that aren't present in the source CSV."""
    norm = [(idx, h.strip().lower().replace(" ", "_"))
            for idx, h in enumerate(header_row)]
    out: dict[str, int] = {}
    for canonical, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            for idx, name in norm:
                if name == alias:
                    out[canonical] = idx
                    break
            if canonical in out:
                break
    return out


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip()
    if not s or s in ("-", "—"):
        return None
    # Strip currency / thousands separators / scientific notation accepted
    s = s.replace("$", "").replace(",", "")
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> Optional[int]:
    n = _num(v)
    return int(n) if n is not None else None


def _bool(v: Any) -> Optional[bool]:
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("true", "t", "yes", "y", "1"):
        return True
    if s in ("false", "f", "no", "n", "0"):
        return False
    return None


def _date(v: Any) -> Optional[date]:
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.split("T")[0]).date()
    except ValueError:
        return None


def _text(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _coerce(canonical: str, raw: Any) -> Any:
    if canonical in NUMERIC_COLUMNS:
        return _num(raw)
    if canonical in INTEGER_COLUMNS:
        return _int(raw)
    if canonical in BOOLEAN_COLUMNS:
        return _bool(raw)
    if canonical in DATE_COLUMNS:
        return _date(raw)
    return _text(raw)


def parse_csv(
    raw_bytes: bytes,
    *,
    csv_upload_id: int,
    slot: str,
    effective_date: datetime,
) -> Iterable[tuple]:
    """Yield asyncpg-friendly tuples ready for COPY into account_snapshots.

    Tuples are in the same column order as ``COLUMN_ORDER`` below.
    """
    text = raw_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    try:
        header_row = next(reader)
    except StopIteration:
        return  # empty CSV

    header_idx = _build_header_index(header_row)
    if "account_id" not in header_idx and "account_name" not in header_idx:
        logger.warning(
            "parse_csv: neither account_id nor account_name column found "
            "in CSV — header=%s. Skipping ingest.",
            header_row[:10],
        )
        return

    row_count = 0
    for row in reader:
        row_count += 1
        if row_count > MAX_ROWS:
            logger.error(
                "parse_csv: hit MAX_ROWS=%d — TRUNCATING account_snapshots ingest. "
                "Source has more rows than the cap; raise MAX_ROWS or tighten the "
                "query (e.g. min_arr floor). The full CSV is still stored in "
                "csv_uploads and the dashboard view is unaffected.",
                MAX_ROWS,
            )
            break

        parsed: dict[str, Any] = {}
        for canonical, idx in header_idx.items():
            if idx >= len(row):
                continue
            parsed[canonical] = _coerce(canonical, row[idx])

        # Keep the full original row (preserving original header names) as
        # JSONB so we can roundtrip columns we don't model yet.
        raw_row = {
            header_row[i]: row[i] if i < len(row) else None
            for i in range(len(header_row))
        }

        # Skip rows that have neither an account id nor a name — almost
        # always trailing blank lines in the CSV.
        if not parsed.get("account_id") and not parsed.get("account_name"):
            continue

        yield (
            csv_upload_id,
            slot,
            effective_date,
            parsed.get("account_id"),
            parsed.get("account_name"),
            parsed.get("year_quarter"),
            parsed.get("band"),
            parsed.get("atr"),
            parsed.get("net_arr"),
            parsed.get("net_arr_prior"),
            parsed.get("bu_fc"),
            parsed.get("cc"),
            parsed.get("cc_offcycle"),
            parsed.get("expansion"),
            parsed.get("region"),
            parsed.get("market_segment"),
            parsed.get("subregion"),
            parsed.get("country"),
            parsed.get("industry"),
            parsed.get("term_grouped"),
            parsed.get("health_status"),
            parsed.get("auto_renew"),
            parsed.get("next_renewal"),
            parsed.get("done_deal"),
            parsed.get("ramp_deal"),
            parsed.get("days_since_touch"),
            parsed.get("csm_owner"),
            parsed.get("csm_pass_2"),
            parsed.get("csm_manager"),
            parsed.get("renewal_owner"),
            parsed.get("renewal_manager"),
            parsed.get("products"),
            parsed.get("forecast_summary"),
            parsed.get("cc_reason"),
            parsed.get("partner"),
            parsed.get("partner_type"),
            raw_row,
        )


# Column order matches the parse_csv tuple — used by the COPY into
# account_snapshots in app/database.py.
SNAPSHOT_COLUMNS = (
    "csv_upload_id",
    "slot",
    "effective_date",
    "account_id",
    "account_name",
    "year_quarter",
    "band",
    "atr",
    "net_arr",
    "net_arr_prior",
    "bu_fc",
    "cc",
    "cc_offcycle",
    "expansion",
    "region",
    "market_segment",
    "subregion",
    "country",
    "industry",
    "term_grouped",
    "health_status",
    "auto_renew",
    "next_renewal",
    "done_deal",
    "ramp_deal",
    "days_since_touch",
    "csm_owner",
    "csm_pass_2",
    "csm_manager",
    "renewal_owner",
    "renewal_manager",
    "products",
    "forecast_summary",
    "cc_reason",
    "partner",
    "partner_type",
    "raw_row",
)
