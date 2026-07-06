"""Stable call_key builder — must match public/vendor/vibe-call-keys.js."""

from __future__ import annotations

import re


def normalize_account_name(name: str) -> str:
    s = (name or "").lower()
    s = re.sub(r"[^a-z0-9\s]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def build_call_key(
    *,
    account_id: str = "",
    account_name: str = "",
    year_quarter: str = "",
    rounded_atr: int = 0,
) -> str:
    acct_id = (account_id or "").strip()
    acct_base = acct_id or normalize_account_name(account_name)
    if not acct_base:
        raise ValueError("account_id or account_name required for call_key")
    period = (year_quarter or "").strip() or "na"
    atr = int(rounded_atr or 0)
    return f"{acct_base}::{period}::{atr}"


def parse_call_key(call_key: str) -> tuple[str, str, int]:
    parts = (call_key or "").split("::")
    if len(parts) < 3:
        raise ValueError("invalid call_key")
    account = parts[0]
    quarter = parts[1]
    try:
        atr = int(parts[2])
    except ValueError as exc:
        raise ValueError("invalid rounded_atr in call_key") from exc
    return account, quarter, atr
