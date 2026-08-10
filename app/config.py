"""Runtime configuration sourced from environment variables.

Mirrors the Signal CX deployment pattern so the same App Foundry / Vibe
infrastructure can host this app without surprises:

* `DATABASE_URL` wins when present (a full DSN — Vibe sometimes injects
  this for managed Postgres instances).
* Otherwise we use discrete `DB_*` env vars (the Vibe convention) and
  fall back to `PG*` (libpq names) so local Postgres.app / docker-compose
  also works.
* `db_ssl` defaults to `disable` because Vibe's shared Postgres lives on
  a private VPC where SSL isn't used. Set `DB_SSL=require` if you put
  the app in front of a public Postgres.
* Admin gating uses a single shared password (`ADMIN_TOKEN`, default
  `signal`) and the `X-Signal-Password` request header. No credentials
  UI, no on-disk persistence of secrets.
"""

from __future__ import annotations

import os
import ssl as _ssl
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import AliasChoices, Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    # ------ Process / HTTP --------------------------------------------------
    app_name: str = "Renewals Studio"
    environment: str = Field(default="production", alias="ENVIRONMENT")
    port: int = Field(default=8080, alias="PORT")
    host: str = Field(default="0.0.0.0", alias="HOST")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # ------ Database connection --------------------------------------------
    # DATABASE_URL wins when set. Vibe / Cloud SQL sometimes injects this
    # for managed Postgres; accepting it means we never have to chase the
    # right combination of DB_HOST / DB_PORT for a given platform variant.
    database_url: Optional[str] = Field(default=None, alias="DATABASE_URL")

    # DB_* (Vibe convention) takes precedence over PG* (libpq). Both
    # share the same field — AliasChoices order is load-bearing.
    pg_host: str = Field(
        default="localhost",
        validation_alias=AliasChoices("DB_HOST", "PGHOST"),
    )
    pg_port: int = Field(
        default=5432,
        validation_alias=AliasChoices("DB_PORT", "PGPORT"),
    )
    pg_user: str = Field(
        default="postgres",
        validation_alias=AliasChoices("DB_USER", "PGUSER"),
    )
    pg_password: str = Field(
        default="signal",
        validation_alias=AliasChoices("DB_PASSWORD", "PGPASSWORD"),
    )
    pg_database: str = Field(
        default="renewals",
        validation_alias=AliasChoices("DB_NAME", "PGDATABASE"),
    )
    # `disable` is the correct default for Vibe's shared Postgres (private
    # VPC, no SSL). Use `require` for any TCP Postgres exposed publicly.
    db_ssl: str = Field(
        default="disable",
        validation_alias=AliasChoices("DB_SSL", "PGSSLMODE"),
    )

    # ------ Startup behaviour -----------------------------------------------
    # Auto-seed is OFF by default. Production-style deployments expect the
    # admin to upload the first CSV via /admin; we do not push bundled data
    # without an explicit opt-in. Set SEED_ON_STARTUP=true if you want a
    # fresh database to auto-load the bundled F1 Sheets from /app/seeds.
    seed_on_startup: bool = Field(default=False, alias="SEED_ON_STARTUP")
    shutdown_drain_seconds: float = Field(default=10.0, alias="SHUTDOWN_DRAIN_SECONDS")

    # ------ Admin gating (legacy password — kept for local dev fallback) --
    # Single shared password protecting /admin/* when IDP headers are absent.
    # In production behind Pomerium, admin routes accept role=admin from the
    # identity middleware instead. OVERRIDE THIS IN PRODUCTION via secret mgr.
    admin_token: str = Field(default="signal", alias="ADMIN_TOKEN")

    # ------ Header-based SSO (Pomerium / oauth2-proxy / Cloud IAP) ---------
    # When STRICT_AUTH=true and no identity header is present, requests get
    # an ephemeral Guest user (read-only). When false (local dev), impersonate
    # AUTH_DEV_USER as admin so the app works without a proxy.
    strict_auth: bool = Field(default=True, alias="STRICT_AUTH")
    auto_provision_users: bool = Field(default=True, alias="AUTO_PROVISION_USERS")
    bootstrap_admins: str = Field(
        default="bryan.rossello@zendesk.com",
        alias="BOOTSTRAP_ADMINS",
    )
    # Optional display names for bootstrap admins, seeded into the users
    # table on every boot. Format: email:Full Name,email2:Name2
    bootstrap_admin_names: str = Field(
        default="bryan.rossello@zendesk.com:Bryan Rossello",
        alias="BOOTSTRAP_ADMIN_NAMES",
    )
    # Owner = platform super-user (CSV upload, snapshot history, notes import,
    # raw note editing). Comma-separated emails; seeded as role=owner on boot.
    bootstrap_owners: str = Field(
        default="bryan.rossello@zendesk.com",
        alias="BOOTSTRAP_OWNERS",
    )
    auth_dev_user: Optional[str] = Field(default=None, alias="AUTH_DEV_USER")
    db_pool_max: int = Field(default=10, alias="DB_POOL_MAX")

    # ------ Snowflake source (on-demand "Run now" refresh) ----------------
    # Connection identifiers only — mirrors the DB_* pattern via AliasChoices.
    # There is NEVER a token or secret here: the OAuth token is read per
    # request from the `x-pomerium-idp-access-token` header, used in memory
    # only, and never logged/persisted (see app/warehouse.py).
    #
    # SNOWFLAKE_MODE:
    #   * "real" — connect to Snowflake with authenticator='oauth' + the
    #     per-request forwarded token.
    #   * "simulated" — no Snowflake connection; the refresh reads the
    #     bundled seeds/*.csv so local dev at :8765 works with no token,
    #     no package, and no warehouse access.
    #
    # When NOT explicitly set, the mode is auto-selected by environment
    # (see `effective_snowflake_mode`): **real in production, simulated in
    # development**. This mirrors how `effective_strict_auth` keys off the
    # `environment` field, so a prod deploy uses real Snowflake with zero
    # env toggling while local dev stays offline. An explicit
    # `SNOWFLAKE_MODE=real|simulated` env var always overrides.
    snowflake_mode: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("SNOWFLAKE_MODE", "SNOWFLAKE_SIMULATE_MODE"),
    )
    snowflake_account: str = Field(
        default="ZENDESK-GLOBAL",
        validation_alias=AliasChoices("SNOWFLAKE_ACCOUNT"),
    )
    snowflake_warehouse: str = Field(
        default="PUBLIC_ZENDESK_L",
        validation_alias=AliasChoices("SNOWFLAKE_WAREHOUSE"),
    )
    snowflake_database: str = Field(
        default="FOUNDATIONAL",
        validation_alias=AliasChoices("SNOWFLAKE_DATABASE"),
    )
    snowflake_schema: str = Field(
        default="CUSTOMER",
        validation_alias=AliasChoices("SNOWFLAKE_SCHEMA"),
    )
    # Empty by default: the External OAuth integration runs with
    # ANY_ROLE_MODE=ENABLE, so we let Snowflake use the token user's DEFAULT
    # role (matching the platform's reference sample) rather than forcing one.
    # Forcing 'PUBLIC' was rejected ("role not listed in the Access Token / was
    # filtered"). Set SNOWFLAKE_ROLE only if you must pin a specific granted role.
    snowflake_role: str = Field(
        default="",
        validation_alias=AliasChoices("SNOWFLAKE_ROLE"),
    )
    # Bounded connector timeouts (seconds). The active query legitimately
    # runs ~2 min; login/network are kept short so a stuck warehouse fails
    # cleanly rather than hanging a worker thread.
    snowflake_login_timeout_s: int = Field(default=30, alias="SNOWFLAKE_LOGIN_TIMEOUT_S")
    snowflake_network_timeout_s: int = Field(default=45, alias="SNOWFLAKE_NETWORK_TIMEOUT_S")
    snowflake_statement_timeout_s: int = Field(default=600, alias="SNOWFLAKE_STATEMENT_TIMEOUT_S")

    @computed_field  # type: ignore[misc]
    @property
    def effective_snowflake_mode(self) -> str:
        """Resolved source mode — 'real' or 'simulated'.

        An explicit ``SNOWFLAKE_MODE`` env var wins. Otherwise the mode is
        derived from the environment (same signal ``effective_strict_auth``
        uses): **simulated in development/dev/local, real everywhere else**
        (production). This makes a prod deploy use real Snowflake with no
        manual toggle while local dev stays offline with no token/package.
        """
        raw = (self.snowflake_mode or "").strip().lower()
        if raw in ("real", "simulated"):
            return raw
        if self.environment.strip().lower() in ("development", "dev", "local"):
            return "simulated"
        return "real"

    @computed_field  # type: ignore[misc]
    @property
    def snowflake_simulated(self) -> bool:
        """True when the refresh should use the bundled seeds instead of a
        live Snowflake connection."""
        return self.effective_snowflake_mode != "real"

    def snowflake_public_dict(self) -> dict:
        """Read-only, non-secret Snowflake connection summary for the admin
        page + status endpoint. Never contains a token or any secret."""
        return {
            "mode": "simulated" if self.snowflake_simulated else "real",
            "account": self.snowflake_account,
            "warehouse": self.snowflake_warehouse,
            "database": self.snowflake_database,
            "schema": self.snowflake_schema,
            "role": self.snowflake_role,
        }

    # ---- Helpers used by the rest of the app -----------------------------
    @computed_field  # type: ignore[misc]
    @property
    def database_url_normalised(self) -> Optional[str]:
        """Return DATABASE_URL with the SQLAlchemy-style scheme stripped."""
        if not self.database_url:
            return None
        url = self.database_url.strip()
        if not url:
            return None
        if url.startswith("postgresql+"):
            url = "postgresql://" + url.split("://", 1)[1]
        return url

    @computed_field  # type: ignore[misc]
    @property
    def ssl_param(self) -> object:
        """Translate `db_ssl` into the asyncpg `ssl=` argument.

        Returns:
          * ``False`` for "disable" (the default; matches Vibe's private VPC).
          * ``True`` for "require" / "prefer" / etc — asyncpg uses SSL but
            accepts any certificate. Good for public Postgres without
            verification.
          * An ``ssl.SSLContext`` for "verify-ca" / "verify-full".
        """
        mode = (self.db_ssl or "").strip().lower()
        if mode in {"disable", "false", "off", "no", ""}:
            return False
        if mode in {"require", "true", "on", "yes", "prefer", "allow"}:
            return True
        if mode in {"verify", "verify-ca", "verify-full"}:
            return _ssl.create_default_context()
        return False

    @property
    def is_unix_socket(self) -> bool:
        """Cloud SQL connector injects DB_HOST as `/cloudsql/<...>` — a unix
        socket directory. asyncpg figures this out from the leading slash,
        but we surface it for diagnostics."""
        return self.pg_host.startswith("/")

    def banner(self) -> str:
        """One-line startup summary. No password ever leaves this function."""
        return (
            f"DB target: via={'DATABASE_URL' if self.database_url else 'discrete'} "
            f"host={self.pg_host} port={self.pg_port} "
            f"db={self.pg_database} user={self.pg_user} ssl={self.db_ssl} "
            f"socket={self.is_unix_socket}"
        )

    def public_dict(self) -> dict:
        """Diagnostic view used by /readyz and /admin/db-status. Never
        includes the password."""
        return {
            "via": "DATABASE_URL" if self.database_url else "discrete",
            "host": self.pg_host,
            "port": self.pg_port,
            "user": self.pg_user,
            "database": self.pg_database,
            "ssl": self.db_ssl,
            "is_unix_socket": self.is_unix_socket,
            "seed_on_startup": self.seed_on_startup,
            "admin_token_set": bool(self.admin_token),
            "strict_auth": self.effective_strict_auth,
            "auto_provision_users": self.auto_provision_users,
        }

    @computed_field  # type: ignore[misc]
    @property
    def effective_strict_auth(self) -> bool:
        """STRICT_AUTH defaults to true in production, false otherwise."""
        raw = self.strict_auth
        if self.environment.strip().lower() in ("development", "dev", "local"):
            return raw if os.environ.get("STRICT_AUTH") is not None else False
        return raw

    def bootstrap_admin_emails(self) -> list[str]:
        emails = [
            e.strip().lower()
            for e in (self.bootstrap_admins or "").split(",")
            if e.strip()
        ]
        return emails

    def bootstrap_owner_emails(self) -> list[str]:
        return [
            e.strip().lower()
            for e in (self.bootstrap_owners or "").split(",")
            if e.strip()
        ]

    def bootstrap_admin_profiles(self) -> list[tuple[str, str]]:
        """(email, display_name) pairs for idempotent admin seeding."""
        name_map: dict[str, str] = {}
        for part in (self.bootstrap_admin_names or "").split(","):
            part = part.strip()
            if not part or ":" not in part:
                continue
            email, name = part.split(":", 1)
            email = email.strip().lower()
            name = name.strip()
            if email and name:
                name_map[email] = name
        profiles: list[tuple[str, str]] = []
        for email in self.bootstrap_admin_emails():
            local = email.split("@")[0].replace(".", " ").title()
            profiles.append((email, name_map.get(email, local)))
        return profiles

    def bootstrap_owner_profiles(self) -> list[tuple[str, str]]:
        """(email, display_name) pairs for idempotent owner seeding."""
        name_map: dict[str, str] = {}
        for part in (self.bootstrap_admin_names or "").split(","):
            part = part.strip()
            if not part or ":" not in part:
                continue
            email, name = part.split(":", 1)
            email = email.strip().lower()
            name = name.strip()
            if email and name:
                name_map[email] = name
        profiles: list[tuple[str, str]] = []
        for email in self.bootstrap_owner_emails():
            local = email.split("@")[0].replace(".", " ").title()
            profiles.append((email, name_map.get(email, local)))
        return profiles

    def effective_dev_user_email(self) -> str:
        if self.auth_dev_user and self.auth_dev_user.strip():
            return self.auth_dev_user.strip().lower()
        admins = self.bootstrap_admin_emails()
        return admins[0] if admins else "dev@local"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
