-- Cached snapshot metadata + indexes for Weekly Brief.
-- Avoids COUNT(*) / REGEXP scans across ~280k-row uploads on every brief load.

ALTER TABLE csv_uploads ADD COLUMN IF NOT EXISTS snapshot_row_count INTEGER;
ALTER TABLE csv_uploads ADD COLUMN IF NOT EXISTS snapshot_effective_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_snapshots_upload_eff
    ON account_snapshots (csv_upload_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_upload_quarter_atr
    ON account_snapshots (csv_upload_id, year_quarter, atr);

UPDATE csv_uploads u
SET snapshot_row_count = c.n,
    snapshot_effective_date = c.eff
FROM (
    SELECT csv_upload_id, COUNT(*)::int AS n, MAX(effective_date) AS eff
    FROM account_snapshots
    GROUP BY csv_upload_id
) c
WHERE u.id = c.csv_upload_id
  AND (u.snapshot_row_count IS DISTINCT FROM c.n
       OR u.snapshot_effective_date IS DISTINCT FROM c.eff);
