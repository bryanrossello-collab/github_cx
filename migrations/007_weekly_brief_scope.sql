-- Weekly Brief filter indexes: region + renewal-date scope on large uploads.
-- Additive; never DROP.

CREATE INDEX IF NOT EXISTS idx_snapshots_upload_region
    ON account_snapshots (csv_upload_id, region);

CREATE INDEX IF NOT EXISTS idx_snapshots_upload_renewal
    ON account_snapshots (csv_upload_id, next_renewal);
