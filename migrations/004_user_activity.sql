-- Per-user "last seen" + overall usage tracking.
--
-- Auth is Pomerium/Okta SSO: identity is forwarded on every request and there
-- is no discrete login event. We therefore track LAST SEEN / ACTIVE, sampled
-- on the ~45s auth-cache miss in app/auth.py:resolve_user (so "hits" is an
-- approximate activity count at the login-cache granularity, not a raw
-- per-request count).
--
-- Additive only: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, never DROP/TRUNCATE.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_activity_daily (
    email        TEXT NOT NULL,
    day          DATE NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ,
    PRIMARY KEY (email, day)
);

CREATE INDEX IF NOT EXISTS idx_user_activity_day ON user_activity_daily (day);
