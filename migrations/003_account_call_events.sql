-- Append-only CS / Renewals call history keyed by account + quarter + rounded ATR.
-- Current values = latest row per call_key by effective_date (server commit time).

CREATE TABLE IF NOT EXISTS account_call_events (
    id                  BIGSERIAL PRIMARY KEY,
    call_key            TEXT NOT NULL,
    account_id          TEXT NOT NULL,
    account_name        TEXT NOT NULL DEFAULT '',
    year_quarter        TEXT NOT NULL DEFAULT '',
    rounded_atr         INTEGER NOT NULL DEFAULT 0,
    cs_forecast         NUMERIC(18,2),
    renewals_forecast   NUMERIC(18,2),
    effective_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_by_email     TEXT,
    edited_by_display   TEXT,
    source              TEXT NOT NULL DEFAULT 'commit'
);

CREATE INDEX IF NOT EXISTS idx_call_events_key_eff
    ON account_call_events (call_key, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_account_eff
    ON account_call_events (account_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_account
    ON account_call_events (account_id);
