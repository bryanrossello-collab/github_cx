-- 001_init.sql
-- Initial schema for Renewals Studio.
--
-- Conventions:
--   * Every CREATE statement is idempotent (IF NOT EXISTS) so this same
--     file is safe to apply on cold-start AND as the first numbered
--     migration. The schema_migrations table records that 001 has run.
--   * Identifiers are snake_case. Composite natural keys (e.g. note_key)
--     are TEXT, not generated UUIDs — they're meaningful to the dashboard.
--   * Persistence-layer column names use 'dj_forecast' even though the UI
--     label was renamed to 'ELT Forecast'. Renaming the column would
--     require migrating any existing JSON-serialized notes; the API layer
--     translates between the on-disk name and the wire name (djForecast).

BEGIN;

-- ---------------------------------------------------------------------------
-- Migration ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Generic key/value metadata. The 'initialized' marker is informational
-- only — never used to gate destructive operations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Per-renewal notes. One row per note, keyed by the composite noteKey the
-- dashboard generates client-side (accountBase::period::roundedATR).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
    note_key      TEXT PRIMARY KEY,
    note_text     TEXT NOT NULL DEFAULT '',
    -- UI label: "ELT Forecast". Column name preserves the historic wire
    -- key ('djForecast') for serialization continuity.
    dj_forecast   NUMERIC,
    archived      BOOLEAN NOT NULL DEFAULT FALSE,
    -- Cached row context so a note can survive its source row changing.
    account_id    TEXT,
    account_name  TEXT,
    owner         TEXT,
    renewal_date  TEXT,
    fq            TEXT,
    atr           NUMERIC,
    account_label TEXT,
    -- Edit history kept as a JSONB array, newest-first, capped at 20 entries
    -- by the API layer. Kept here (not in a child table) because the
    -- dashboard reads/writes it as an opaque blob.
    history       JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_account_id    ON notes (account_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at    ON notes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_archived      ON notes (archived);

-- ---------------------------------------------------------------------------
-- Tombstones for deleted notes. Prevents an older export from resurrecting a
-- deleted noteKey on re-import.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS note_tombstones (
    note_key   TEXT PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- CSV uploads — one row per upload, full version history retained. The
-- dashboard's data-source endpoint serves the latest row per slot (matched
-- by filename substring or the explicit slot column).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS csv_uploads (
    id           BIGSERIAL PRIMARY KEY,
    -- Logical slot the dashboard expects: 'active' (2026 data) or
    -- 'historical' (historical fy27). The slot is also encoded in the
    -- filename for backwards compatibility with the file-based contract.
    slot         TEXT NOT NULL CHECK (slot IN ('active', 'historical')),
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text/csv',
    size_bytes   BIGINT NOT NULL,
    sha256       TEXT NOT NULL,
    -- Raw CSV bytes. Postgres handles BYTEA up to 1 GB per value; our
    -- production sizes are 3–15 MB which is well within healthy range.
    content      BYTEA NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 'system' for boot-time seeding, 'admin' for UI/API uploads, or the
    -- caller's identity if they supply one in the upload metadata.
    uploaded_by  TEXT NOT NULL DEFAULT 'admin',
    note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_csv_uploads_slot_latest
    ON csv_uploads (slot, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_csv_uploads_filename
    ON csv_uploads (filename);

COMMIT;
