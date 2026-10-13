-- Bounded as-of lookup for Weekly Brief adjusted trend.
-- Replaces the per-row LATERAL (account_id + ROUND(atr) + regexp quarter)
-- with a Python as-of over events fetched by account_id. This index makes
-- that fetch + any remaining SQL as-of lookups cheap.

CREATE INDEX IF NOT EXISTS idx_call_events_account_atr_eff
    ON account_call_events (account_id, rounded_atr, effective_date DESC);
