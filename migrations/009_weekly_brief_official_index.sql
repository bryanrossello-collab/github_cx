-- Weekly Brief 100K+ Official scope: partial index over the ~1-2% of rows
-- whose BAND matches Official, so brief queries stop scanning whole uploads.
-- Applied by Database.migrate_weekly_brief_official_index, which formats the
-- predicate from OFFICIAL_BAND_PREDICATE. Additive; never DROP.

CREATE INDEX IF NOT EXISTS idx_snapshots_official_upload_renewal
    ON account_snapshots (csv_upload_id, next_renewal)
    INCLUDE (bu_fc, cc, account_id, atr, year_quarter, effective_date)
    WHERE (UPPER(REGEXP_REPLACE(COALESCE(band, ''), '[ $,]', '', 'g')) LIKE '%100K+%'
        OR UPPER(REGEXP_REPLACE(COALESCE(band, ''), '[ $,]', '', 'g')) LIKE '%>100K%'
        OR UPPER(REGEXP_REPLACE(COALESCE(band, ''), '[ $,]', '', 'g')) LIKE '%100KANDABOVE%');
