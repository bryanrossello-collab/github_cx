-- Cached distinct-account + ATR totals for /admin Snapshot History.
-- Additive; never DROP. list_snapshots must not scan account_snapshots.

ALTER TABLE csv_uploads ADD COLUMN IF NOT EXISTS snapshot_distinct_accounts INTEGER;
ALTER TABLE csv_uploads ADD COLUMN IF NOT EXISTS snapshot_atr_total NUMERIC(18,2);
