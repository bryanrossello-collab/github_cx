"""Database pool, schema management, and CSV seeding.

Mirrors the Signal CX `Database` class pattern:

* Accepts either a full ``DATABASE_URL`` (DSN) OR discrete asyncpg
  parameters. DSN wins. This is what makes the same image work on
  Vibe (sometimes injects DATABASE_URL) and on a private Cloud SQL
  instance (DB_HOST + DB_USER + DB_PASSWORD).
* ``ensure_schema()`` runs one big idempotent ``CREATE TABLE IF NOT
  EXISTS`` block on every boot — no migration framework, no DROP.
* ``target_summary`` exposes everything except the password so the
  ``/admin/db-status`` panel can show the operator what the app is
  actually using.
* The ``DatabaseUnavailable`` exception is raised by ``acquire()`` when
  the pool isn't connected; ``app/main.py`` maps it to HTTP 503.
"""

from __future__ import annotations

import hashlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)


SCHEMA_SQL = """
-- ---------------------------------------------------------------------------
-- Migration ledger (kept for forward compatibility; the SCHEMA_SQL block
-- itself is what bootstraps the schema today).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Generic key/value metadata. ``renewals_meta.initialized`` is the marker
-- that prevents auto-seed from overwriting user data on cold start.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS renewals_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Per-renewal notes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
    note_key      TEXT PRIMARY KEY,
    note_text     TEXT NOT NULL DEFAULT '',
    -- Persistence column name preserves the historic wire key
    -- (`djForecast`) even though the UI label is now "ELT Forecast".
    dj_forecast   NUMERIC,
    archived      BOOLEAN NOT NULL DEFAULT FALSE,
    account_id    TEXT,
    account_name  TEXT,
    owner         TEXT,
    renewal_date  TEXT,
    fq            TEXT,
    atr           NUMERIC,
    account_label TEXT,
    history       JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    owner_email   TEXT,
    last_edited_by TEXT,
    last_edited_display TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_account_id ON notes (account_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_archived   ON notes (archived);

CREATE TABLE IF NOT EXISTS note_tombstones (
    note_key   TEXT PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- CSV uploads — one row per upload, full version history retained.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS csv_uploads (
    id           BIGSERIAL PRIMARY KEY,
    slot         TEXT NOT NULL CHECK (slot IN ('active', 'historical')),
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text/csv',
    size_bytes   BIGINT NOT NULL,
    sha256       TEXT NOT NULL,
    content      BYTEA NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_by  TEXT NOT NULL DEFAULT 'admin',
    note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_csv_uploads_slot_latest
    ON csv_uploads (slot, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_csv_uploads_filename
    ON csv_uploads (filename);

-- ---------------------------------------------------------------------------
-- Parsed per-account rows, versioned by snapshot. One row per
-- (csv_upload_id, account_id, year_quarter). The dashboard never reads
-- this directly (it still parses the CSV bytes client-side via Papaparse)
-- — this table exists so historical SQL queries can compute WoW / MoM
-- deltas without re-parsing the CSV blobs.
--
-- effective_date is the "as-of" timestamp the row should be attributed to
-- when ranking snapshots: defaults to the CSV's uploaded_at, but the
-- ingest path may override it with a date parsed out of the filename if
-- the operator follows a naming convention (e.g. "...2026-06-03.csv").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    csv_upload_id   BIGINT NOT NULL REFERENCES csv_uploads(id) ON DELETE CASCADE,
    slot            TEXT NOT NULL,
    effective_date  TIMESTAMPTZ NOT NULL,

    -- Identity (raw values from the CSV — case preserved)
    account_id      TEXT,
    account_name    TEXT,
    year_quarter    TEXT,

    -- Money (NUMERIC keeps cents)
    band            TEXT,
    atr             NUMERIC(18,2),
    net_arr         NUMERIC(18,2),
    net_arr_prior   NUMERIC(18,2),
    bu_fc           NUMERIC(18,2),
    cc              NUMERIC(18,2),
    cc_offcycle     NUMERIC(18,2),
    expansion       NUMERIC(18,2),

    -- Geo / segment
    region          TEXT,
    market_segment  TEXT,
    subregion       TEXT,
    country         TEXT,
    industry        TEXT,

    -- Term / status (the columns we use for time-series risk analysis)
    term_grouped    TEXT,
    health_status   TEXT,
    auto_renew      BOOLEAN,
    next_renewal    DATE,
    done_deal       BOOLEAN,
    ramp_deal       BOOLEAN,
    days_since_touch INTEGER,

    -- Ownership (CSM organisation)
    csm_owner       TEXT,
    csm_pass_2      TEXT,
    csm_manager     TEXT,
    renewal_owner   TEXT,
    renewal_manager TEXT,

    -- Misc context
    products        TEXT,
    forecast_summary TEXT,
    cc_reason       TEXT,
    partner         TEXT,
    partner_type    TEXT,

    -- Forward-compat: full row as JSONB so columns we don't model yet
    -- still round-trip.
    raw_row         JSONB,
    loaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_account_eff
    ON account_snapshots (account_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_eff_date
    ON account_snapshots (effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_slot_eff
    ON account_snapshots (slot, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_upload
    ON account_snapshots (csv_upload_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_quarter
    ON account_snapshots (year_quarter);

-- ---------------------------------------------------------------------------
-- Per-account ELT Forecast decomposition (CS + Renewals).
--
-- The dashboard's per-account "ELT Forecast" input is actually the sum of
-- two team-level inputs:
--     ELT Forecast = CS Forecast + Renewals Forecast
--
-- CSMs enter CS Forecast in the account modal; the Renewals team enters
-- their own number. The dashboard's KPI tiles roll these up per quarter
-- so leadership can see alignment vs misalignment between Customer Success
-- and Renewals.
--
-- Keyed by CRM account id (durable across CSV refreshes and renames).
-- account_name is refreshed from the latest CSV on each save.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_forecasts (
    account_id        TEXT PRIMARY KEY,
    account_name      TEXT NOT NULL DEFAULT '',
    cs_forecast       NUMERIC(18,2),
    renewals_forecast NUMERIC(18,2),
    notes             TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by        TEXT,
    cs_updated_at     TIMESTAMPTZ,
    cs_updated_by     TEXT,
    rn_updated_at     TIMESTAMPTZ,
    rn_updated_by     TEXT
);

-- ---------------------------------------------------------------------------
-- Per-quarter ELT Call decomposition.
--
-- The dashboard's "ELT Call" tile (was "DJ Call") is actually the sum of
-- two team-level inputs:
--     ELT Call = CS Call + Renewals Call
--
-- CS Call is the Customer Success team's read on the quarter; Renewals
-- Call is the Renewals team's read. They're entered separately so
-- leadership can see whether the two functions are aligned (deltas near
-- zero) or misaligned (large CS - Renewals deltas need a conversation).
-- ELT Call itself is the rollup the executive team commits to.
--
-- One row per fiscal quarter (e.g. 'FY27Q2'). Update via the /admin UI
-- or the PUT /api/renewals/quarter-calls/{quarter} endpoint.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_calls (
    quarter        TEXT PRIMARY KEY,
    cs_call        NUMERIC(18,2),
    renewals_call  NUMERIC(18,2),
    notes          TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by     TEXT
);

-- ---------------------------------------------------------------------------
-- Identity + authorization (header-based SSO via upstream proxy).
-- Email is the durable join key — same pattern as cx-ai-roadmap.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id           SERIAL PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    role         TEXT NOT NULL DEFAULT 'standard',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Forward-compatible columns for databases bootstrapped before v3.3.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS last_edited_by TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS last_edited_display TEXT;
ALTER TABLE account_forecasts ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE account_forecasts ADD COLUMN IF NOT EXISTS cs_updated_at TIMESTAMPTZ;
ALTER TABLE account_forecasts ADD COLUMN IF NOT EXISTS cs_updated_by TEXT;
ALTER TABLE account_forecasts ADD COLUMN IF NOT EXISTS rn_updated_at TIMESTAMPTZ;
ALTER TABLE account_forecasts ADD COLUMN IF NOT EXISTS rn_updated_by TEXT;
"""


SEEDS_DIR = Path(__file__).resolve().parent.parent / "seeds"

# (seed-filename, slot, display-filename-for-the-row).
SEED_FILES = [
    ("active.csv",     "active",     "Jesse and Dave F1 Sheet - 2026 data.csv"),
    ("historical.csv", "historical", "Jesse and Dave F1 Sheet - Historical FY27.csv"),
]


class DatabaseUnavailable(RuntimeError):
    """Raised by ``Database.acquire`` when the pool isn't connected. Mapped
    to HTTP 503 by the FastAPI exception handler so callers can distinguish
    'DB temporarily unreachable' (503, retryable) from '500 server bug'."""


class Database:
    """Thin wrapper around an ``asyncpg`` connection pool.

    Connection params are passed as DISCRETE keyword arguments to asyncpg
    so passwords containing ``@ : / % +`` don't have to be URL-encoded. A
    full ``DATABASE_URL`` is still supported for platforms that inject one
    (Vibe sometimes does). The DSN path wins when both are supplied.
    """

    def __init__(
        self,
        *,
        database_url: Optional[str] = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
        database: Optional[str] = None,
        ssl: Optional[object] = None,
        pool_max: int = 10,
    ) -> None:
        self._database_url = (database_url or "").strip() or None
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._database = database
        self._ssl = ssl
        self._pool_max = max(1, int(pool_max))
        self._pool: Optional[asyncpg.Pool] = None

    # ---- diagnostic plumbing ---------------------------------------------

    @property
    def target_summary(self) -> dict:
        """Non-secret connection state surfaced to /admin/db-status."""
        return {
            "via": "DATABASE_URL" if self._database_url else "discrete",
            "host": self._host,
            "port": self._port,
            "user": self._user,
            "database": self._database,
            "ssl": (
                self._ssl if isinstance(self._ssl, (bool, str))
                else ("context" if self._ssl is not None else None)
            ),
            "is_unix_socket": bool(self._host and self._host.startswith("/")),
        }

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise DatabaseUnavailable("Database pool not initialised")
        return self._pool

    @property
    def connected(self) -> bool:
        return self._pool is not None

    # ---- lifecycle --------------------------------------------------------

    async def connect(self) -> None:
        if self._pool is not None:
            return
        logger.info(
            "Opening database pool host=%s port=%s user=%s db=%s ssl=%s via=%s",
            self._host, self._port, self._user, self._database, self._ssl,
            "DATABASE_URL" if self._database_url else "discrete",
        )
        if self._database_url:
            # Vibe-injected DSN path. SSL passed alongside even though the
            # DSN can carry sslmode= — explicit beats implicit and we want
            # the same default for both code paths.
            self._pool = await asyncpg.create_pool(
                dsn=self._database_url,
                ssl=self._ssl if self._ssl is not None else False,
                min_size=1,
                max_size=self._pool_max,
                command_timeout=30,
            )
        else:
            # Discrete-param path. Password passed raw — asyncpg never
            # URL-encodes a kwarg, so `@:/+%` in the password is safe.
            self._pool = await asyncpg.create_pool(
                host=self._host,
                port=self._port,
                user=self._user,
                password=self._password,
                database=self._database,
                ssl=self._ssl if self._ssl is not None else False,
                min_size=1,
                max_size=self._pool_max,
                command_timeout=30,
            )
        # Verify with a trivial query — create_pool can return a "pool"
        # that fails on first acquire if auth is broken.
        async with self._pool.acquire() as conn:
            await conn.fetchval("SELECT 1")

    async def close(self) -> None:
        if self._pool is not None:
            logger.info("Closing database pool")
            await self._pool.close()
            self._pool = None

    async def healthcheck(self) -> bool:
        try:
            async with self.pool.acquire() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception:
            logger.exception("Database healthcheck failed")
            return False

    # ---- schema + seed ----------------------------------------------------

    async def ensure_schema(self) -> None:
        """Run the idempotent CREATE TABLE IF NOT EXISTS block. Records
        001_init in schema_migrations so the same file can later be
        extended with numbered migration files if needed."""
        async with self.pool.acquire() as conn:
            await conn.execute(SCHEMA_SQL)
            await conn.execute(
                "INSERT INTO schema_migrations (version) VALUES ('001_init') "
                "ON CONFLICT (version) DO NOTHING"
            )

    async def seed_bootstrap_admins(self, profiles: list[tuple[str, str]]) -> int:
        """Upsert configured bootstrap admins (role=admin). Idempotent."""
        from app import users

        if not profiles:
            return 0
        async with self.pool.acquire() as conn:
            return await users.seed_bootstrap_admins(conn, profiles)

    async def seed_bootstrap_owners(self, profiles: list[tuple[str, str]]) -> int:
        """Upsert configured bootstrap owners (role=owner). Idempotent."""
        from app import users

        if not profiles:
            return 0
        async with self.pool.acquire() as conn:
            return await users.seed_bootstrap_owners(conn, profiles)

    async def migrate_identity_keys(self) -> None:
        """Idempotent migration: note keys become account::quarter (no ATR);
        account_forecasts primary key becomes account_id."""
        async with self.pool.acquire() as conn:
            done = await conn.fetchval(
                "SELECT 1 FROM schema_migrations WHERE version = $1",
                "002_account_id_keys",
            )
            if done:
                return

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await self._migrate_note_keys_v2(conn)
                await self._migrate_account_forecasts_pk(conn)
                await conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES ($1) "
                    "ON CONFLICT (version) DO NOTHING",
                    "002_account_id_keys",
                )
        logger.info("Applied identity-key migration 002_account_id_keys")

    async def migrate_account_call_events(self) -> None:
        """Create account_call_events table and backfill from legacy forecasts."""
        migration_path = (
            Path(__file__).resolve().parent.parent / "migrations" / "003_account_call_events.sql"
        )
        sql = migration_path.read_text(encoding="utf-8")
        async with self.pool.acquire() as conn:
            done = await conn.fetchval(
                "SELECT 1 FROM schema_migrations WHERE version = $1",
                "003_account_call_events",
            )
            if done:
                return

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(sql)
                n = await self._backfill_call_events_from_forecasts(conn)
                await conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES ($1) "
                    "ON CONFLICT (version) DO NOTHING",
                    "003_account_call_events",
                )
        logger.info("Applied call-events migration 003_account_call_events (%d backfilled)", n)

    async def _backfill_call_events_from_forecasts(self, conn) -> int:
        from app.call_keys import build_call_key

        existing = await conn.fetchval("SELECT COUNT(*)::int FROM account_call_events")
        if existing and existing > 0:
            return 0

        rows = await conn.fetch(
            """
            SELECT af.account_id, af.account_name,
                   af.cs_forecast, af.renewals_forecast,
                   af.updated_at, af.updated_by,
                   af.cs_updated_at, af.cs_updated_by,
                   af.rn_updated_at, af.rn_updated_by,
                   snap.year_quarter, snap.atr
            FROM account_forecasts af
            LEFT JOIN LATERAL (
                SELECT year_quarter, atr
                FROM account_snapshots
                WHERE account_id = af.account_id
                ORDER BY effective_date DESC
                LIMIT 1
            ) snap ON TRUE
            WHERE af.cs_forecast IS NOT NULL OR af.renewals_forecast IS NOT NULL
            """
        )
        count = 0
        for row in rows:
            yq = (row["year_quarter"] or "legacy").strip()
            atr = int(round(float(row["atr"] or 0)))
            try:
                call_key = build_call_key(
                    account_id=row["account_id"] or "",
                    account_name=row["account_name"] or "",
                    year_quarter=yq,
                    rounded_atr=atr,
                )
            except ValueError:
                continue
            eff = row["updated_at"]
            editor = row["updated_by"] or "backfill"
            await conn.execute(
                """
                INSERT INTO account_call_events (
                    call_key, account_id, account_name, year_quarter, rounded_atr,
                    cs_forecast, renewals_forecast, effective_date,
                    edited_by_email, edited_by_display, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, 'backfill')
                """,
                call_key,
                row["account_id"],
                row["account_name"] or "",
                yq,
                atr,
                row["cs_forecast"],
                row["renewals_forecast"],
                eff,
                editor,
            )
            count += 1
        return count

    @staticmethod
    def _note_key_v2(old_key: str) -> str:
        parts = old_key.split("::")
        if len(parts) <= 2:
            return old_key
        return f"{parts[0]}::{parts[1]}"

    async def _migrate_note_keys_v2(self, conn) -> None:
        rows = await conn.fetch(
            "SELECT note_key, note_text, dj_forecast, archived, account_id, "
            "       account_name, owner, renewal_date, fq, atr, account_label, "
            "       history, updated_at, owner_email, last_edited_by, "
            "       last_edited_display FROM notes"
        )
        winners: dict[str, asyncpg.Record] = {}
        for row in rows:
            nk = self._note_key_v2(row["note_key"])
            prev = winners.get(nk)
            if prev is None or row["updated_at"] >= prev["updated_at"]:
                winners[nk] = row

        await conn.execute("DELETE FROM notes")
        for nk, row in winners.items():
            await conn.execute(
                """
                INSERT INTO notes (
                    note_key, note_text, dj_forecast, archived, account_id,
                    account_name, owner, renewal_date, fq, atr, account_label,
                    history, updated_at, owner_email, last_edited_by,
                    last_edited_display
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16
                )
                """,
                nk,
                row["note_text"],
                row["dj_forecast"],
                row["archived"],
                row["account_id"],
                row["account_name"],
                row["owner"],
                row["renewal_date"],
                row["fq"],
                row["atr"],
                row["account_label"],
                row["history"],
                row["updated_at"],
                row["owner_email"],
                row["last_edited_by"],
                row["last_edited_display"],
            )

        tomb_rows = await conn.fetch(
            "SELECT note_key, deleted_at FROM note_tombstones"
        )
        tomb_winners: dict[str, object] = {}
        for row in tomb_rows:
            nk = self._note_key_v2(row["note_key"])
            prev = tomb_winners.get(nk)
            if prev is None or row["deleted_at"] > prev:
                tomb_winners[nk] = row["deleted_at"]

        await conn.execute("DELETE FROM note_tombstones")
        for nk, deleted_at in tomb_winners.items():
            await conn.execute(
                "INSERT INTO note_tombstones (note_key, deleted_at) "
                "VALUES ($1, $2)",
                nk,
                deleted_at,
            )

        logger.info(
            "Note-key migration: %d notes, %d tombstones",
            len(winners),
            len(tomb_winners),
        )

    async def _migrate_account_forecasts_pk(self, conn) -> None:
        pk_col = await conn.fetchval(
            """
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a
              ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = 'account_forecasts'::regclass
              AND i.indisprimary
            LIMIT 1
            """
        )
        if pk_col == "account_id":
            return

        await conn.execute(
            """
            UPDATE account_forecasts af
            SET account_id = sub.account_id
            FROM (
                SELECT DISTINCT ON (account_name)
                    account_name, account_id
                FROM account_snapshots
                WHERE account_id IS NOT NULL AND account_id <> ''
                ORDER BY account_name, effective_date DESC
            ) sub
            WHERE af.account_name = sub.account_name
              AND (af.account_id IS NULL OR af.account_id = '')
            """
        )
        await conn.execute(
            """
            UPDATE account_forecasts
            SET account_id = account_name
            WHERE account_id IS NULL OR account_id = ''
            """
        )

        rows = await conn.fetch(
            "SELECT account_id, account_name, cs_forecast, renewals_forecast, "
            "       notes, updated_at, updated_by, cs_updated_at, cs_updated_by, "
            "       rn_updated_at, rn_updated_by "
            "FROM account_forecasts ORDER BY updated_at ASC"
        )
        by_id: dict[str, asyncpg.Record] = {}
        for row in rows:
            aid = row["account_id"]
            if not aid:
                continue
            by_id[aid] = row

        await conn.execute("DELETE FROM account_forecasts")
        for row in by_id.values():
            await conn.execute(
                """
                INSERT INTO account_forecasts (
                    account_id, account_name, cs_forecast, renewals_forecast,
                    notes, updated_at, updated_by, cs_updated_at, cs_updated_by,
                    rn_updated_at, rn_updated_by
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
                )
                """,
                row["account_id"],
                row["account_name"] or "",
                row["cs_forecast"],
                row["renewals_forecast"],
                row["notes"],
                row["updated_at"],
                row["updated_by"],
                row["cs_updated_at"],
                row["cs_updated_by"],
                row["rn_updated_at"],
                row["rn_updated_by"],
            )

        if pk_col == "account_name":
            await conn.execute(
                "ALTER TABLE account_forecasts DROP CONSTRAINT account_forecasts_pkey"
            )
            await conn.execute(
                "ALTER TABLE account_forecasts ADD PRIMARY KEY (account_id)"
            )

        logger.info(
            "Account-forecast migration: %d rows, pk was %s",
            len(by_id),
            pk_col,
        )

    async def is_seeded(self) -> bool:
        """True if this DB has been initialised by Renewals Studio before.
        Drives the 'should I auto-seed?' decision so we never overwrite
        user uploads on a cold restart."""
        async with self.pool.acquire() as conn:
            v = await conn.fetchval(
                "SELECT value FROM renewals_meta WHERE key = 'initialized'"
            )
            return v is not None

    async def set_meta(self, key: str, value: str) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO renewals_meta (key, value, updated_at) "
                "VALUES ($1, $2, NOW()) "
                "ON CONFLICT (key) DO UPDATE SET "
                "  value = EXCLUDED.value, updated_at = NOW()",
                key, value,
            )

    async def seed_csv_uploads_if_empty(self) -> int:
        """For each (active / historical) slot, if the table has no rows
        for that slot, insert the bundled CSV from ``/app/seeds`` AND
        parse it into ``account_snapshots``. Used on cold start so the
        dashboard isn't blank. User uploads are never overwritten because
        we only seed when the slot is empty."""
        inserted = 0
        for seed_path, slot, display_name in SEED_FILES:
            full = SEEDS_DIR / seed_path
            if not full.exists():
                logger.warning("Seed file missing: %s", full)
                continue
            async with self.pool.acquire() as conn:
                existing = await conn.fetchval(
                    "SELECT COUNT(*) FROM csv_uploads WHERE slot = $1", slot
                )
                if existing and existing > 0:
                    logger.info("Skipping seed for slot=%s (%d rows already)",
                                slot, existing)
                    continue
                content = full.read_bytes()
                sha = hashlib.sha256(content).hexdigest()
                row = await conn.fetchrow(
                    "INSERT INTO csv_uploads "
                    "(slot, filename, content_type, size_bytes, sha256, "
                    " content, uploaded_by, note) "
                    "VALUES ($1, $2, 'text/csv', $3, $4, $5, 'system', "
                    "        'Bundled seed') "
                    "RETURNING id, uploaded_at",
                    slot, display_name, len(content), sha, content,
                )
                inserted += 1
                logger.info("Seeded slot=%s filename=%s size=%d csv_upload_id=%d",
                            slot, display_name, len(content), row["id"])

            # Parse + materialise rows into account_snapshots. Done outside
            # the previous `async with` block so the row INSERT is committed
            # before the parser starts using a new connection. Failure is
            # logged but doesn't roll back the seed insert.
            try:
                n = await self.ingest_snapshot(
                    csv_upload_id=row["id"],
                    slot=slot,
                    effective_date=row["uploaded_at"],
                    raw_bytes=content,
                )
                logger.info("Seed parsed: slot=%s rows=%d", slot, n)
            except Exception:
                logger.exception("Seed parse failed (non-fatal) for slot=%s", slot)
        return inserted

    async def ingest_snapshot(
        self,
        *,
        csv_upload_id: int,
        slot: str,
        effective_date,
        raw_bytes: bytes,
    ) -> int:
        """Parse the CSV bytes and insert one row per account into
        ``account_snapshots``. Idempotent — re-ingesting the same
        ``csv_upload_id`` first deletes its existing rows so a re-upload
        with the same id always reflects the latest parse."""
        # Local import keeps `app/ingest.py` optional for environments
        # that only need the raw-bytes endpoints.
        import json
        from app import ingest

        records = []
        for tup in ingest.parse_csv(
            raw_bytes,
            csv_upload_id=csv_upload_id,
            slot=slot,
            effective_date=effective_date,
        ):
            # Replace the last element (raw_row dict) with its JSON encoding
            # so asyncpg's COPY accepts it as JSONB.
            tup = (*tup[:-1], json.dumps(tup[-1]))
            records.append(tup)

        if not records:
            logger.warning(
                "ingest_snapshot: 0 rows parsed for csv_upload_id=%d slot=%s",
                csv_upload_id, slot,
            )
            return 0

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM account_snapshots WHERE csv_upload_id = $1",
                    csv_upload_id,
                )
                await conn.copy_records_to_table(
                    "account_snapshots",
                    records=records,
                    columns=ingest.SNAPSHOT_COLUMNS,
                )
        logger.info(
            "ingest_snapshot: csv_upload_id=%d slot=%s rows=%d",
            csv_upload_id, slot, len(records),
        )
        return len(records)

    # ---- request-time helper ---------------------------------------------

    @asynccontextmanager
    async def acquire(self):
        """Acquire a connection if the pool is up; otherwise raise
        :class:`DatabaseUnavailable` so the FastAPI handler can return 503."""
        if self._pool is None:
            raise DatabaseUnavailable("database_unavailable")
        async with self._pool.acquire() as conn:
            yield conn
