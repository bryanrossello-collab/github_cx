# App Foundry / Vibe Blueprint — Building a Stateless FastAPI + Cloud SQL App

> **Audience:** an AI coding agent (GPT / Codex / Claude) scaffolding a **brand-new**
> application on the **App Foundry / Vibe** platform (Google Cloud Run + Cloud SQL
> Postgres, behind a Pomerium identity-aware proxy).
>
> **What this document is:** a *product-agnostic infrastructure blueprint*. It
> distills a proven, battle-tested backend skeleton — config, auth, persistence,
> health/lifecycle, deployment, and an optional Snowflake refresh module — into a
> spec you can build from directly. It deliberately contains **no** domain/product
> logic. Everywhere you would put your own data model, endpoints, or frontend, this
> doc leaves an explicit placeholder (see [§11](#11-fill-in-for-your-app)).
>
> **How to read it:** Sections [§1](#1-overview--platform-model)–[§3](#3-tech-stack--project-layout)
> orient you. [§2](#2-non-negotiable-rules-the-battle-scars) is the contract — the
> hard rules that override your defaults. [§4](#4-configuration)–[§7](#7-health--lifecycle)
> are the reusable backend core. [§8](#8-snowflake-data-source-pattern-optional-module)
> is an optional data-source module. [§9](#9-deployment)–[§10](#10-anti-patterns) cover
> shipping and pitfalls. [§11](#11-fill-in-for-your-app) is your to-do list.

---

## 1. Overview & platform model

**App Foundry / Vibe** is a platform layer that provisions infrastructure and runs
your container. As the app author you own a thin Python service; the platform owns
the surrounding plumbing.

| Layer | Who owns it | What it is |
| --- | --- | --- |
| **Provisioning** | Platform | Creates a **Cloud SQL Postgres** instance and **injects `DB_*` env vars** (host, port, user, password, name) into your Cloud Run service. Sometimes injects a full `DATABASE_URL`. |
| **Runtime** | Platform | Runs your container on **Google Cloud Run** (stateless, autoscaling, scale-to-zero possible). |
| **Identity** | Platform | A **Pomerium identity-aware proxy (IAP)** sits in front of the service, authenticates the user, and forwards identity as **trusted request headers** (and optionally IdP tokens). |
| **App** | **You** | A container that serves a **same-origin static frontend + JSON API**, talks to Postgres, and reads identity from proxy headers. |

Key consequences that shape everything below:

- **MUST** treat Cloud Run as **stateless and ephemeral** — no durable local disk,
  cold starts wipe memory and `/tmp`.
- **MUST** get all credentials from **injected env vars**, never a UI or a checked-in file.
- **MUST** serve a **liveness probe that is green from the first second**, because
  Cloud Run's startup/liveness probes are unforgiving.
- **MUST** trust the **upstream proxy** for identity, and only the upstream proxy
  (the proxy strips client-supplied copies of the identity headers before forwarding).

---

## 2. Non-negotiable rules (the battle scars)

> These are hard-won constraints. If one conflicts with your usual defaults, **the
> rule wins.** Where the reason isn't obvious, it's given — internalize the reason,
> because it generalizes.

1. **Cloud Run is stateless — Postgres or nothing.**
   Never write **primary application data** to the filesystem, `/tmp`, or
   process/module-level memory. Cold starts and multi-instance autoscaling make any
   local write invisible or lost. If Postgres is unavailable, **return `503`** —
   don't silently buffer to disk or RAM.
   *(In-process caching of **derived, reconstructable** data with an explicit TTL is
   acceptable; see the per-request user cache in [§5](#5-authentication--identity).)*

2. **Credentials only from injected env — never a UI, never persisted.**
   No credentials form, no `/settings/credentials` endpoint, no writing secrets to
   disk or baking them into the image. Secrets arrive as env vars from the platform's
   secret manager. This applies to DB passwords, admin tokens, and any third-party
   key (e.g. a Snowflake private key).

3. **No DSN strings for the DB — build discrete connection params.**
   Prefer passing **discrete** parameters (`host`, `port`, `user`, `password`,
   `database`) to the driver. Passwords frequently contain `@ : / % +`, which
   URL-encode-bug inside a DSN at the worst possible time. Accept a full
   `DATABASE_URL` **only** because some platform variants inject one — and when you
   do, let it win but still pass SSL explicitly. (See [§4.3](#43-discrete-connection-params-no-dsn).)

4. **Open the HTTP listener BEFORE awaiting the database.**
   Bind the port and answer the liveness probe immediately. Connect to Postgres in a
   **background task** with retry/backoff. Cloud Run's startup probe times out if you
   block boot on the DB; a `200` on `/healthz` matters more than a clean state machine.
   (See [§7](#7-health--lifecycle).)

5. **`DB_*` before `PG*` — alias order is load-bearing.**
   The platform convention is `DB_HOST`/`DB_USER`/... ; libpq/local dev uses
   `PGHOST`/`PGUSER`/... . For each field, **`DB_*` must take precedence**. In
   pydantic this is the order of `AliasChoices(...)`. Getting this backwards is a
   small typo that causes a hard outage. (See [§4.2](#42-config-precedence-pattern).)

6. **Migrations are additive only.**
   Use only `CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
   `CREATE INDEX ... IF NOT EXISTS`. **Never** `DROP TABLE`, `DROP COLUMN`, or
   `TRUNCATE` in migration or startup code. Migrations run on **every boot** and must
   be idempotent. (See [§6](#6-persistence--migrations).)

7. **Return `503` when the DB is down — distinguish "unavailable" from "bug".**
   A single custom exception raised by the connection acquirer, mapped to HTTP `503`
   with a `Retry-After`, lets every data endpoint fail correctly for free.
   Reserve `500` for actual server bugs.

8. **Trust the proxy, not the client, for identity.**
   Read identity from the Pomerium-injected headers. Assume the proxy strips any
   client-supplied copies. Never accept identity from a query param or a
   client-settable header your proxy doesn't control.

9. **Graceful drain on `SIGTERM`.**
   Flip readiness to `503` immediately on `SIGTERM` so the platform stops routing new
   requests, then let in-flight requests finish before exit. `tini` as PID 1 forwards
   signals; uvicorn's graceful-shutdown timeout does the draining. (See [§7](#7-health--lifecycle) and [§9](#9-deployment).)

---

## 3. Tech stack & project layout

### 3.1 Stack (pin majors; test upgrades against real Postgres)

| Dependency | Role |
| --- | --- |
| `fastapi` | Web framework (ASGI). |
| `uvicorn[standard]` | Production ASGI server (httptools, websockets, etc.). |
| `asyncpg` | Async Postgres driver with a **discrete-param** connection API. |
| `pydantic` (v2) + `pydantic-settings` | Config validation; `AliasChoices`, `computed_field`, `model_config`. |
| `structlog` | JSON logs to stdout. |
| `python-multipart` | Only if you accept multipart form uploads. |
| `snowflake-connector-python` | **Optional** — only if you add the Snowflake module ([§8](#8-snowflake-data-source-pattern-optional-module)). Pulls in `pyarrow`/`cryptography`; materially larger image. |

- **DO NOT** add `sqlalchemy`, `alembic`, `psycopg2`, `databases`, `httpx`, or
  `requests` unless a concrete need appears. The home-rolled migration runner
  ([§6](#6-persistence--migrations)) is intentional and small.
- Keep `requirements.txt` **pinned**. Bump majors only after testing against Cloud SQL
  (asyncpg in particular has had subtle cross-version behavior changes).

### 3.2 Recommended module layout

```
your-app/
├── AGENTS.md                 # your project's handoff guide (write one)
├── Dockerfile                # python:3.12-slim, multi-stage, tini, non-root
├── .dockerignore
├── requirements.txt          # pinned
├── pyproject.toml            # package metadata + deps
├── app/
│   ├── __init__.py
│   ├── main.py               # FastAPI app factory + lifespan + middleware
│   ├── config.py             # pydantic-settings (DB_* > PG*), computed fields
│   ├── auth.py               # proxy-header identity resolution + role model
│   ├── users.py              # (optional) DB-backed user provisioning
│   ├── database.py           # asyncpg pool, retry, migration runner, acquire()
│   ├── logging_setup.py      # structlog → JSON stdout
│   ├── warehouse.py          # (optional) outbound key-pair connect + fast read (§8)
│   └── routes/
│       ├── __init__.py
│       ├── health.py         # /healthz, /readyz
│       ├── auth_api.py       # /api/whoami + user management
│       └── <your_domain>.py  # YOUR endpoints (placeholder — see §11)
├── migrations/
│   └── 001_init.sql          # additive, idempotent, ledgered
└── public/
    ├── index.html            # YOUR frontend (app-specific — see §11)
    └── vendor/               # static assets served same-origin
```

---

## 4. Configuration

Use `pydantic-settings` to read **only** from environment variables. No `.env` in
production, no secrets on disk.

### 4.1 Settings skeleton

```python
from functools import lru_cache
from typing import Optional
from pydantic import AliasChoices, Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None, case_sensitive=False, extra="ignore", populate_by_name=True,
    )

    # Process / HTTP
    app_name: str = "your-app"
    environment: str = Field(default="production", alias="ENVIRONMENT")
    port: int = Field(default=8080, alias="PORT")   # platform sets PORT; honor it
    host: str = Field(default="0.0.0.0", alias="HOST")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
```

- **MUST** honor the platform-provided **`PORT`** env var (Cloud Run injects it).
- Cache the settings object (`lru_cache`) so it's parsed once.

### 4.2 Config precedence pattern

For every DB field, **`DATABASE_URL` (if present) wins; otherwise `DB_*` beats `PG*`.**
The `AliasChoices` order encodes this and is **load-bearing** (rule #5).

```python
    # A full DSN, if the platform injects one. Highest priority.
    database_url: Optional[str] = Field(default=None, alias="DATABASE_URL")

    # Discrete params. DB_* (platform) MUST come first, PG* (libpq/local) second.
    pg_host: str = Field(default="localhost",
                         validation_alias=AliasChoices("DB_HOST", "PGHOST"))
    pg_port: int = Field(default=5432,
                         validation_alias=AliasChoices("DB_PORT", "PGPORT"))
    pg_user: str = Field(default="postgres",
                         validation_alias=AliasChoices("DB_USER", "PGUSER"))
    pg_password: str = Field(default="changeme",
                             validation_alias=AliasChoices("DB_PASSWORD", "PGPASSWORD"))
    pg_database: str = Field(default="appdb",
                             validation_alias=AliasChoices("DB_NAME", "PGDATABASE"))
    db_ssl: str = Field(default="disable",
                        validation_alias=AliasChoices("DB_SSL", "PGSSLMODE"))
```

### 4.3 Discrete connection params (no DSN)

The driver receives **discrete** params so passwords aren't URL-encoded. Accept a DSN
only as an override. Expose a computed helper for each concern:

```python
    @computed_field
    @property
    def database_url_normalised(self) -> Optional[str]:
        """Strip SQLAlchemy-style scheme (postgresql+driver://) if present."""
        if not self.database_url:
            return None
        url = self.database_url.strip()
        if url.startswith("postgresql+"):
            url = "postgresql://" + url.split("://", 1)[1]
        return url or None

    @computed_field
    @property
    def ssl_param(self):
        """Translate db_ssl into the asyncpg `ssl=` argument."""
        mode = (self.db_ssl or "").strip().lower()
        if mode in {"disable", "false", "off", "no", ""}:
            return False                       # default: platform private VPC
        if mode in {"require", "true", "on", "yes", "prefer", "allow"}:
            return True                        # SSL, accept any cert
        if mode in {"verify", "verify-ca", "verify-full"}:
            import ssl
            return ssl.create_default_context()  # SSL + cert verification
        return False
```

**SSL defaults matter:** on the platform's shared/private VPC Postgres, `disable` is
correct. Set `DB_SSL=require` only when fronting a publicly reachable Postgres.

**Unix socket note:** the Cloud SQL connector may inject `DB_HOST` as
`/cloudsql/<project:region:instance>` — a socket directory. asyncpg detects this from
the leading `/`; surface `host.startswith("/")` for diagnostics.

### 4.4 Diagnostics that never leak secrets

Provide a `banner()` (one-line startup log) and a `public_dict()` (for `/readyz` and an
admin status panel) that expose connection target and mode **but never the password or
any token**. Redaction is a rule, not a nicety.

### 4.5 Secret env vars (general shape)

Every third-party secret follows the **same pattern as `DB_PASSWORD`**: an env var read
via `AliasChoices`, with a safe default for local dev, **never** logged, **never** in
`public_dict()`/`banner()`, **never** written to disk. For the optional Snowflake module,
the vars are enumerated in [§8.2](#82-config).

---

## 5. Authentication & identity

Identity comes from the **upstream Pomerium proxy** as trusted headers (and optionally
forwarded IdP tokens). The app **provisions** users on first sight and assigns roles.

### 5.1 Reading proxy identity (header fallback chain)

Read the **first non-empty** value from an ordered list of headers, so the app works
across Pomerium / oauth2-proxy / Cloud IAP without changes:

```python
EMAIL_HEADERS = (
    "x-pomerium-claim-email", "x-pomerium-user-email",
    "x-auth-request-email", "x-forwarded-email",
    "x-goog-authenticated-user-email",
)
NAME_HEADERS = (
    "x-pomerium-claim-name", "x-pomerium-claim-given-name",
    "x-auth-request-user", "x-forwarded-user",
)
JWT_HEADERS = (   # decode payload WITHOUT verifying — proxy-trust edge case only
    "x-pomerium-jwt-assertion", "x-pomerium-jwt",
    "x-forwarded-jwt", "x-goog-iap-jwt-assertion",
)
```

- Normalize provider-prefixed emails (e.g. Google IAP sends
  `accounts.google.com:user@example.com` — strip the prefix, lowercase).
- If no email header is present, fall back to decoding a JWT header's payload for an
  `email` / `preferred_username` / `sub` claim. **Do not verify the signature** — you
  trust the proxy, which already validated it; verification would require fetching JWKS
  and is out of scope here.
- **Forwarded IdP tokens** (`x-pomerium-idp-id-token` / `x-pomerium-idp-access-token`)
  are only present when the ingress sets `pass_identity_headers` ([§9.4](#94-ingress--egress)).
  Read them only if a downstream service (e.g. Snowflake per-user OAuth) needs them.

### 5.2 Role model

A minimal, extensible ladder. Adapt names to your app, but keep the shape:

| Role | Meaning |
| --- | --- |
| `guest` | Ephemeral, **read-only**. Assigned when `STRICT_AUTH=true` and no identity header is present. |
| `standard` | Auto-provisioned signed-in user. Normal read/write. |
| `admin` | Elevated: user management, DB diagnostics. |
| `owner` | Super-user; seeded from a bootstrap env list (`BOOTSTRAP_OWNERS`). |

Model this as a `ResolvedUser` dataclass with `is_guest` / `is_signed_in` /
`is_admin` (admin **or** owner) / `is_owner` convenience properties, and expose FastAPI
dependencies `require_signed_in` / `require_admin` / `require_owner` that raise `401`
(not signed in) vs `403` (insufficient role).

### 5.3 strict vs dev mode

- **`STRICT_AUTH=true` (production default):** no identity header ⇒ **guest** (read-only).
- **`STRICT_AUTH=false` (local dev):** no proxy ⇒ impersonate a configured
  `AUTH_DEV_USER` as admin/owner, so the app is usable without a proxy in front.
- Make `STRICT_AUTH` default to **false when `environment` is dev/local** unless
  explicitly set, and **true** otherwise (a `computed_field` `effective_strict_auth`).

### 5.4 Auto-provision + bootstrap admins/owners

- **`AUTO_PROVISION_USERS=true`:** on first sign-in, insert the user into a `users`
  table with role `standard` (email is the durable join key).
- **`BOOTSTRAP_ADMINS` / `BOOTSTRAP_OWNERS`:** comma-separated email lists, seeded
  idempotently on every boot so the first humans can administer the app. Optionally
  accept display names as `email:Full Name` pairs.
- If the DB isn't ready when a request arrives, fall back to an **ephemeral** resolved
  user (role derived from the bootstrap lists) so admins aren't locked out during
  startup — but mark it `ephemeral` and don't persist.

### 5.5 Per-request user cache (a legitimate in-memory cache)

The identity middleware runs on **every** request. Hitting Postgres (pool acquire +
`users` SELECT) each time will, under load, exhaust the pool and surface as sporadic
"guest" / lag. Keep a small **in-memory cache keyed by email with a short TTL**
(e.g. 45s), and expose `invalidate_user_cache(email)` to drop an entry when an admin
changes a role. This is derived, reconstructable data with an explicit TTL — allowed
under rule #1.

```python
_USER_CACHE_TTL_S = 45.0
_user_cache: dict[str, tuple[float, ResolvedUser]] = {}
```

### 5.6 Middleware wiring + `whoami` diagnostics

Attach identity to every request via middleware, but **skip auth for static assets and
health probes** to avoid a Postgres round-trip on each one (rule #1 performance corollary):

```python
_AUTH_SKIP_PREFIXES = ("/vendor/",)
_AUTH_SKIP_EXACT = frozenset({"/favicon.ico", "/healthz", "/readyz", "/api/health"})

class AttachUserMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if path in _AUTH_SKIP_EXACT or path.startswith(_AUTH_SKIP_PREFIXES):
            request.state.user = guest_user()          # cheap, no DB
        else:
            request.state.user = await resolve_user(request)
        return await call_next(request)
```

Expose a **`GET /api/whoami`** endpoint returning the resolved user, the raw identity,
the effective auth config, and the **redacted** proxy headers received. This is the
single most useful thing when debugging "why am I a guest / why is my role wrong" in a
deployed environment. **Always redact JWTs** in that output (log length + a short hash,
never the token).

---

## 6. Persistence & migrations

A thin wrapper around an asyncpg pool. No ORM, no migration framework.

### 6.1 Pool with connect-retry

```python
class DatabaseUnavailable(RuntimeError):
    """Raised by acquire() when the pool isn't up. Mapped to HTTP 503."""

class Database:
    def __init__(self, *, database_url=None, host=None, port=None, user=None,
                 password=None, database=None, ssl=None, pool_max=10):
        self._database_url = (database_url or "").strip() or None
        # ...store discrete params...

    async def connect(self):
        if self._database_url:            # DSN path (platform-injected); DSN wins
            self._pool = await asyncpg.create_pool(
                dsn=self._database_url, ssl=self._ssl or False,
                min_size=1, max_size=self._pool_max, command_timeout=30)
        else:                             # discrete-param path; password passed RAW
            self._pool = await asyncpg.create_pool(
                host=self._host, port=self._port, user=self._user,
                password=self._password, database=self._database,
                ssl=self._ssl or False,
                min_size=1, max_size=self._pool_max, command_timeout=30)
        async with self._pool.acquire() as conn:  # verify auth eagerly
            await conn.fetchval("SELECT 1")
```

The **retry loop lives in the lifespan background task** ([§7](#7-health--lifecycle)),
not here: exponential backoff up to a startup timeout, updating `app.state.db_status`
so the probes can report progress.

### 6.2 `acquire()` → 503 when down

```python
    @asynccontextmanager
    async def acquire(self):
        if self._pool is None:
            raise DatabaseUnavailable("database_unavailable")
        async with self._pool.acquire() as conn:
            yield conn
```

Register a FastAPI exception handler mapping `DatabaseUnavailable` → `503` with a
`Retry-After` header and a structured body (`db_status`, `connect_attempts`, last error).
Every endpoint that uses `async with db.acquire()` then fails correctly for free (rule #7).

### 6.3 Idempotent migration runner (home-rolled)

The rule is **additive-only** (rule #6). Two complementary mechanisms, both idempotent:

1. **A base schema block** run on every boot — one big `CREATE TABLE IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` string.
   This bootstraps a fresh DB and safely no-ops on an existing one.
2. **A ledger table** so numbered migration files can be added later without re-running:

```python
async def ensure_schema(self):
    async with self.pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)   # idempotent CREATE ... IF NOT EXISTS block
        await conn.execute(
            "INSERT INTO schema_migrations (version) VALUES ('001_init') "
            "ON CONFLICT (version) DO NOTHING")
```

For **file-based** migrations later: read `migrations/*.sql` in **lexical order**
(`001_...`, `002_...`, `010_...`), skip any `version` already in `schema_migrations`,
run the rest inside a transaction, then record the version. Signature shape:

```python
async def apply_migration(conn, version: str, sql: str) -> None:
    done = await conn.fetchval(
        "SELECT 1 FROM schema_migrations WHERE version = $1", version)
    if done:
        return
    async with conn.transaction():
        await conn.execute(sql)
        await conn.execute(
            "INSERT INTO schema_migrations (version) VALUES ($1) "
            "ON CONFLICT (version) DO NOTHING", version)
```

**Migration conventions (put these in your `migrations/*.sql` header):**

- File names: `NNN_lower_snake_case.sql`, zero-padded, applied in lexical order.
- Only `CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX ... IF NOT EXISTS`.
- **Never** `DROP` / `TRUNCATE`. To retire a column, stop reading it; delete it in a
  much later, deliberately reviewed migration if ever.
- Natural/composite TEXT keys are fine when they're meaningful to the client; document
  the wire contract if a column name diverges from its JSON key.
- All queries use **parameter binding** (`$1`, `$2`), never string interpolation.

### 6.4 Reusable table patterns (generic)

- **Migration ledger:** `schema_migrations(version TEXT PK, applied_at TIMESTAMPTZ)`.
- **Key/value metadata (`app_meta`):** `key TEXT PK, value JSONB, updated_at TIMESTAMPTZ`.
  Use for informational markers (e.g. "initialized", "last refresh at") — **never** to
  gate destructive operations.
- **Users:** `users(id, email UNIQUE, display_name, role, created_at, updated_at)` —
  email is the durable identity join key.
- **Optional versioned-snapshot table:** when you ingest an external dataset and want
  history, keep **one row per (import version, entity)** with an `effective_date`, typed
  columns for the fields you query, and a **`raw_row JSONB`** catch-all so unmodeled
  columns still round-trip. Serving endpoints resolve the **newest version** per logical
  slot; history is retained (never overwritten in place). This gives you time-series /
  diff queries without re-parsing source blobs. *(Name and shape are yours — this is a
  pattern, not a fixed schema.)*

### 6.5 Optional seeding

If a fresh DB should be non-empty on first boot, gate seeding behind an env flag
(default **off**) and an idempotent "already initialized?" check (via `app_meta`), so a
cold restart **never overwrites** user data.

---

## 7. Health & lifecycle

### 7.1 `/healthz` (liveness) vs `/readyz` (readiness)

- **`GET /healthz` — always `200` while the process is alive.** No DB access. This is
  what lets you open the listener before the DB is up (rule #4).

  ```json
  { "status": "ok", "uptime_sec": 42 }
  ```

- **`GET /readyz` — `200` only when DB connected AND schema ready, else `503`.** Reads
  `app.state.db_status`. Returns a structured body so operators can see *why* it's not
  ready. Also returns `503` while **draining**.

  ```json
  {
    "status": "ok", "ready": true, "db": true,
    "uptime_sec": 42, "db_status": "ready",
    "db_last_error": null, "connect_attempts": 1
  }
  ```

  Not-ready shapes: `{"status":"starting","ready":false,...}` (DB pool not up yet),
  `{"status":"draining","ready":false,...}` (SIGTERM received),
  `{"status":"unhealthy","ready":false,"db":false,...}` (pool up but `SELECT 1` failed).

*(If your frontend probes a legacy path like `/api/health` to detect "server mode", add
a thin alias returning `{"ok": true, ...}` — app-specific, optional.)*

### 7.2 Lifespan: listener first, DB in the background

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    app.state.db = None
    app.state.db_status = "pending"
    app.state.shutting_down = False

    db = Database(database_url=settings.database_url_normalised,
                  host=settings.pg_host, port=settings.pg_port,
                  user=settings.pg_user, password=settings.pg_password,
                  database=settings.pg_database, ssl=settings.ssl_param)

    db_task = asyncio.create_task(_bring_db_online(app, db))  # retry/backoff here

    for sig in (signal.SIGTERM, signal.SIGINT):               # cooperative drain
        try:
            asyncio.get_running_loop().add_signal_handler(sig, _begin_drain, app)
        except (NotImplementedError, RuntimeError):
            pass  # non-Unix, or not on main thread (test client)

    try:
        yield
    finally:
        app.state.shutting_down = True                        # /readyz -> 503 now
        await asyncio.sleep(min(settings.shutdown_drain_seconds, 30.0))
        db_task.cancel()
        if app.state.db is not None:
            await app.state.db.close()
```

`_bring_db_online` connects with exponential backoff up to `DB_STARTUP_TIMEOUT_S`,
sets `app.state.db_status` (`connecting` → `ready` / `unreachable` / `schema-error`),
runs `ensure_schema()` and any migrations, seeds bootstrap admins/owners, and (optionally)
seeds data. Every failure sets a distinct status so `/readyz` explains itself.

### 7.3 Logging

Configure `structlog` to emit **JSON to stdout** (Cloud Run captures stdout). Never log
secrets or tokens. Log a one-line non-secret startup banner ([§4.4](#44-diagnostics-that-never-leak-secrets)).

### 7.4 Signals & drain

`tini` as PID 1 forwards `SIGTERM` to uvicorn; uvicorn's `--timeout-graceful-shutdown`
drains in-flight requests; the lifespan flips readiness to `503` on the signal so the
platform stops sending new traffic. Ensure the container runs as a **non-root** user
(root can bypass tini's signal setup) and the platform grace period is ≥ your drain time.

---

## 8. Snowflake data-source pattern (optional module)

Include this **only** if your app's source data lives in an external **data warehouse**
(Snowflake is used as the concrete example throughout). It describes how to keep page
loads instant when the underlying query is heavy — using a pattern that fits App
Foundry's platform constraints (see the **critical constraint** box below).

> ### ⚠️ Critical App Foundry constraint — how the schedule is triggered
>
> App Foundry has **no native job scheduler**, and **nothing outside the platform can
> trigger the app on a schedule**:
>
> - **External schedulers (Cloud Scheduler) and Kubernetes CronJobs cannot call the app.**
>   Every inbound request must pass through Pomerium, which requires a real Okta user
>   identity. A cron/scheduler has no such identity, so its calls are rejected. For the
>   **same reason, machine-to-machine (M2M) inbound calls are not supported.**
> - **An inbound request lives ~30s**, but heavy work can take minutes — so the app
>   **MUST NOT** run a multi-minute query inline in a request.
> - **In-app background jobs are unreliable:** a job kicked off from a request can be
>   **killed when the app scales to zero**, so long-running in-app background work is not
>   dependable.
>
> **The pattern that fits these constraints:** push the heavy query to **the data
> warehouse's own scheduler** (a warehouse **Task** or **Dynamic Table**) so it
> **materializes results into a warehouse table on a schedule** — no app-side scheduler
> and no identity into the platform required. The app then does only a **FAST read** of
> that pre-materialized table (which completes well within the ~30s request window) and
> writes it into the Postgres cache. **The frontend always reads the Postgres cache
> (instant); it never queries the warehouse inline.**

### 8.1 The architecture: warehouse-scheduled materialization + fast app read

Split the work in two so nothing heavy ever runs inside a request:

1. **Warehouse side (heavy, scheduled there):** a warehouse **Task** (or **Dynamic
   Table**) runs your heavy query on a schedule and writes the result into a
   **pre-materialized results table** in the warehouse. This is owned by the data team /
   your warehouse account and needs **no app involvement** to run.
2. **App side (fast, user-triggered):** when a user triggers a refresh
   ([§8.6](#86-triggering-the-refresh-user-initiated-only)), the app does a **quick
   `SELECT *` from the pre-materialized table** (seconds, not minutes), maps the rows,
   and writes them into a versioned Postgres table
   ([§6.4](#64-reusable-table-patterns-generic)).
3. **Frontend:** always reads the **Postgres cache** — instant, and never blocked on the
   warehouse.

```
Data warehouse scheduler (Task / Dynamic Table)  ── daily, warehouse-side ──┐
   runs the HEAVY query, writes a pre-materialized results table            │
                                                                            ▼
                                                    warehouse: results_table (fresh)
                                                                            │
  user action (Refresh now / refresh-if-stale) ─► POST /refresh            │
     carries a real Okta identity through Pomerium ✓                       │
                                     │                                      │
                                     ▼                                      │
        app/warehouse.py — FAST read: SELECT * FROM results_table  ◄────────┘
        (seconds; finishes inside the ~30s request window)
                                     │  map rows → dicts
                                     ▼
        ingest into a versioned snapshot table (new version per read)
                                     │
                                     ▼
        Postgres  ◄── frontend reads this, instantly, as always
```

Because the app-side step is a **fast read**, it finishes inside a single request and
**avoids the scale-to-zero background-cutoff problem** entirely — there is no
multi-minute in-app job to be killed.

### 8.2 Config

Add `SNOWFLAKE_*` fields to `Settings` with `AliasChoices` and safe dev defaults; the
**private key is a secret env var** for the app's **outbound** connection to the
warehouse ([§8.3](#83-auth-inbound-vs-outbound-a-critical-distinction)), treated exactly
like `DB_PASSWORD` ([§4.5](#45-secret-env-vars-general-shape)) — never logged, redacted in
diagnostics, never on disk, never in a UI.

```
SNOWFLAKE_ACCOUNT            # account locator / identifier
SNOWFLAKE_WAREHOUSE
SNOWFLAKE_DATABASE
SNOWFLAKE_SCHEMA
SNOWFLAKE_ROLE
SNOWFLAKE_USER               # service username (OUTBOUND credential — see §8.3)
SNOWFLAKE_AUTHENTICATOR      # "snowflake_jwt" (key-pair)
SNOWFLAKE_PRIVATE_KEY        # RSA private key (PEM) — SECRET, outbound only
SNOWFLAKE_PRIVATE_KEY_PASSPHRASE  # optional — SECRET
SNOWFLAKE_RESULTS_TABLE      # the PRE-MATERIALIZED table the app fast-reads (§8.1)
SOURCE_BACKEND               # "postgres" (default) | "snowflake"  — cutover toggle
SNOWFLAKE_SIMULATE           # "true" → canned dataset for offline dev
REFRESH_ENABLED              # gate the user-initiated refresh on/off
REFRESH_STALE_TTL_SECONDS    # for the lazy "refresh-if-stale" path (§8.6)
REFRESH_TOKEN                # shared secret for the lazy/refresh path (still a USER-scoped request)
```

### 8.3 Auth: inbound vs outbound (a critical distinction)

Keep two directions of authentication completely separate — they are governed by
different systems and only one of them is affected by the "no machine identity into the
platform" limitation.

- **INBOUND (into the app) — governed by Pomerium.** Every request that reaches the app
  must carry a real Okta user identity through Pomerium. This is why external schedulers,
  CronJobs, and M2M callers **cannot** trigger the app ([§8.6](#86-triggering-the-refresh-user-initiated-only)).
- **OUTBOUND (app → data warehouse) — a plain egress connection, independent of Pomerium.**
  The app authenticates to the warehouse with its **own service-account credential**
  (e.g. **key-pair / RSA**). Pomerium is **not** in this path, so the platform's inbound
  machine-identity restriction **does not apply** to it. This outbound credential is what
  lets the app do its fast read, and it works fine even though no machine can call the
  app inbound.

The warehouse service-account credential:

- Use the warehouse's key-pair (RSA) auth (e.g. `snowflake-connector-python` with
  `private_key=...`). You generate the keypair, hand the **public** key to the warehouse
  admin (`ALTER USER ... SET RSA_PUBLIC_KEY='...'`), and inject the **private** key as a
  **platform secret** — never a UI, never on disk. Compliant with rule #2 (same class as
  `DB_PASSWORD`).
- **Alternative (outbound M2M):** OAuth **client-credentials / machine-to-machine** with
  the IdP is an equally valid way to authenticate the **app's outbound** connection to
  the warehouse, if your platform prefers it over key-pair. (This is outbound M2M and is
  fine — it is unrelated to *inbound* M2M into the app, which is unsupported.)

### 8.4 The app read is FAST — but still run the connector in a threadpool

The app **only reads the pre-materialized results table** ([§8.1](#81-the-architecture-warehouse-scheduled-materialization--fast-app-read)),
so the query is a quick `SELECT` that completes in **seconds**, well inside the ~30s
request window. Never run the heavy source query in the app — that lives in the
warehouse Task/Dynamic Table.

`snowflake-connector-python` still uses **blocking** sockets, so calling it in an
`async def` route would block the event loop and starve asyncpg. Wrap the fast read in a
threadpool:

```python
from starlette.concurrency import run_in_threadpool

def _read_materialized_sync():
    conn = snowflake.connector.connect(
        account=cfg.account, user=cfg.user, role=cfg.role,
        warehouse=cfg.warehouse, database=cfg.database, schema=cfg.schema,
        private_key=load_private_key(cfg),  # outbound service credential (§8.3)
        login_timeout=15, network_timeout=25,   # short — this is a FAST read
    )
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT * FROM {cfg.results_table}")  # pre-materialized, no heavy work
        cols = [c[0] for c in cur.description]
        return cols, [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()

async def read_materialized():
    return await run_in_threadpool(_read_materialized_sync)
```

- Keep timeouts **short** — the read is fast, so a slow response means something is
  wrong; fail cleanly rather than blowing the request budget.
- Use a **bounded** threadpool/executor so a burst can't open unbounded sessions.
- Open → read → close per call.

### 8.5 The heavy warehouse query: parameter-free & self-dynamic

The heavy query runs **warehouse-side inside a Task/Dynamic Table**, which **do not
accept bind parameters** — a Task runs a fixed statement on a schedule. So make the query
**parameter-free and self-dynamic**:

- Derive all dates/periods from **`CURRENT_DATE()`** (or a generator series) so the query
  **rolls forward automatically** every day/quarter with no edits and no binds. This is
  exactly what a scheduled Task needs.
- Avoid hard-coded date literals or thresholds that silently go stale; compute them from
  the current date instead.
- Prefer **aliasing columns in a data-team-owned VIEW/table** over hard-coding fragile
  column names, so schema drift is absorbed in one place.

**If the app itself ever runs a *parameterized* query** (e.g. the optional per-user
live-query mode in [§8.9](#89-optional-future-per-user-live-query), or a filtered read):

- **Always bind variables — never string-interpolate** dates or thresholds into SQL.
- Set **`snowflake.connector.paramstyle = "qmark"`** once at import and use positional
  `?` binds. Rationale: the default `pyformat` (`%(name)s`) collides with literal `%` in
  `LIKE '%...%'` predicates; `qmark` sidesteps escaping entirely.
- To reference the same bind in many places without repeating it, put each bind **once**
  in a top **`params` CTE** and read it back out everywhere else.

### 8.6 Triggering the refresh: user-initiated only

**The schedule lives in the warehouse, not the app** ([§8.1](#81-the-architecture-warehouse-scheduled-materialization--fast-app-read)).
The app's job (reading the pre-materialized table into the Postgres cache) is triggered
**only by a real user action**, because only a request carrying a real Okta identity can
pass through Pomerium into the app.

**Recommended triggers (both carry a real user identity through Pomerium):**

| Trigger | How it works |
| --- | --- |
| **Admin "Refresh now" button** (recommended) | An owner/admin clicks a button → `POST /refresh`. The endpoint does the **fast read** of the pre-materialized table and writes the Postgres cache **inside the request** (finishes within ~30s). Role-gated. |
| **Lazy "refresh-if-stale" on first load** | On a normal signed-in page load, if the Postgres cache is older than a TTL, do the fast read + cache write as part of that request (or return the stale cache immediately and refresh on the same request budget). Keeps data fresh without any button. |

Both work because the fast read completes inside a single request — so there is **no
long-running in-app background job to be killed on scale-to-zero.**

**Explicitly NOT viable on App Foundry (do not use these):**

- **External schedulers (Cloud Scheduler) / Kubernetes CronJobs** — they have no Okta
  identity, so Pomerium rejects their inbound calls.
- **Machine-to-machine (M2M) inbound calls** — unsupported for the same reason (no
  identity through Pomerium).
- **In-app timers / long-running background jobs kicked off from a request** — unreliable
  because the instance can be killed on scale-to-zero mid-job. (This is *why* the heavy
  work is pushed to the warehouse and the app only does a fast read.)

**Fallback (confirm with the platform first, not the default):** if a long-running job
truly must run inside the app, it requires a **"min 1 instance" / keep-warm** setting
(no scale-to-zero) so the background job isn't killed. Treat this as a last resort to
negotiate with the platform team — the warehouse-scheduled + fast-read pattern above
avoids needing it.

The **`POST /refresh`** endpoint must be **role-gated** (owner/admin, or `REFRESH_TOKEN`
for the lazy path). Because the read is fast, it can complete and return within the
request; if you still want to decouple, return `202 Accepted` and finish the fast read
promptly (not a multi-minute job).

### 8.7 Freshness indicator + status endpoint

Because data is "as of the last refresh", surface freshness:

- At the end of each run, **stamp a last-refresh record** (timestamp, per-slot row
  counts, status) in `app_meta` or snapshot metadata.
- Expose a read-only **`GET /refresh-status`** → `{ last_refresh_at, slots: {...}, status }`.
- The frontend shows an unobtrusive **"Data as of <timestamp>"** (relative time on
  hover; a subtle warning if the last refresh failed; "Refreshing…" while a run is
  in-flight). No credentials, read-only — consistent with the rules.

### 8.8 Offline / simulated mode

When `SNOWFLAKE_SIMULATE=true` (or no key present in dev), return a **canned dataset**
shaped like the real projection so the local dev loop needs no live Snowflake and no
secret.

### 8.9 (Optional future) per-user live query

If you ever need interactive, per-user, row-governed queries, forward the user's IdP
token (`x-pomerium-idp-*`, enabled by `pass_identity_headers`) as
`authenticator='oauth'`, per request, in the threadpool — no stored secret, Snowflake
governs row access by the user's own role. This requires every user to be provisioned in
Snowflake and the token's `aud`/user-mapping claims to line up with the External OAuth
integration. It's heavier and slower, and it still must not run a multi-minute query
inline in a request (~30s budget); prefer the warehouse-materialized + fast-read pattern
([§8.1](#81-the-architecture-warehouse-scheduled-materialization--fast-app-read)) for bulk data.

---

## 9. Deployment

### 9.1 Dockerfile requirements

- **Base `python:3.12-slim`**, **multi-stage** (build deps like `build-essential` for
  asyncpg's C extension stay in stage 1 and never reach the runtime image).
- **`tini` as PID 1** (`ENTRYPOINT ["/usr/bin/tini", "--"]`) for signal forwarding.
- Run as a **non-root** user (create a system user/group; `USER app:app`).
- **Healthcheck with a generous `--start-period`** (e.g. `120s`) so Cloud Run's cold
  start (pool takes seconds; Cloud SQL may be warming) doesn't flap the container. Use a
  dependency-free check (Python `urllib` to `/healthz`) to avoid installing `curl`.
- **uvicorn command** with graceful shutdown and proxy trust:

```dockerfile
CMD ["sh", "-c", "exec uvicorn app.main:app \
     --host ${HOST:-0.0.0.0} --port ${PORT:-8080} \
     --proxy-headers --forwarded-allow-ips=* \
     --timeout-graceful-shutdown 25"]
```

- Provide **safe non-secret env defaults** in the image (`PORT`, `HOST`, `LOG_LEVEL`);
  **override all real secrets** via the platform's secret manager at deploy time.

### 9.2 `.dockerignore`

Exclude `.git`, `.venv`/`venv`, `__pycache__`, `*.pyc`, `.env*`, `*.zip`, caches, editor
dirs, `node_modules`, and large docs you don't need at runtime. Keep the build context
small and free of secrets.

### 9.3 Packaging: git deploy AND zip

- **Primary:** git-based deploy (the platform builds from the repo).
- **Also support a zip** artifact for platforms/flows that upload a bundle. Build it
  excluding `.venv`, `__pycache__`, `.git`, existing zips, and `.DS_Store`. Expect a
  small archive (a few MB) unless you bundle large seed data.
- If the platform uses a **Backstage template + GitOps/k8s manifests**, keep the
  container contract (port, healthcheck, env) stable so the same manifest works across
  redeploys.

### 9.4 Ingress & egress

- **Ingress:** to receive forwarded IdP tokens, the ingress must set
  `pass_identity_headers` and inject them, e.g.:

  ```yaml
  ingress.pomerium.io/set_request_headers: |
    x-pomerium-idp-id-token: ${pomerium.id_token}
    x-pomerium-idp-access-token: ${pomerium.access_token}
  ```

  Only needed if a downstream (e.g. Snowflake per-user OAuth, [§8.9](#89-optional-future-per-user-live-query)) consumes them.
- **No scheduled or machine inbound:** every inbound request must pass through Pomerium
  with a real Okta identity, so **external schedulers, CronJobs, and M2M callers cannot
  reach the app.** Schedule heavy work in the data warehouse and trigger app work from a
  real user request ([§8.6](#86-triggering-the-refresh-user-initiated-only)).
- **Egress:** the app's **outbound** connection to the data warehouse is a plain egress
  connection (not through Pomerium — see [§8.3](#83-auth-inbound-vs-outbound-a-critical-distinction)),
  so it must be allowlisted (e.g. `*.snowflakecomputing.com`). Confirm with the platform team.

### 9.5 The 403 / GFE gotcha

If the deployed URL returns *"Your client does not have permission to get URL /"*, that's
the **Google Front End's** standard `403`, **not your app**. Fix it in the platform:
allow the appropriate invocation/authentication for the service (e.g. Cloud Run →
Security → allow the intended callers). Don't chase it in application code.

---

## 10. Anti-patterns (ranked — things that will get you in trouble)

1. **Adding a credentials UI / form / `/credentials` endpoint.** Secrets come from
   injected env only. (rule #2)
2. **Building a DSN string** (`postgresql://user:pass@host/db`). Passwords with
   `@ : / % +` will URL-encode-bug. Use discrete params. (rule #3)
3. **Writing primary data to the filesystem / `/tmp`.** Cold start wipes it. Postgres or
   nothing. (rule #1)
4. **Caching primary data in module-level globals** as a "perf optimization." Same
   failure as #3, disguised. (Short-TTL *derived* caches like the user cache are fine.)
5. **`DROP` / `TRUNCATE` in startup or migration code.** Additive only. (rule #6)
6. **Blocking on the DB before opening the HTTP listener.** Startup probe times out.
   (rule #4)
7. **Getting the env alias order backwards** (`PG*` before `DB_*`). Silent, hard outage.
   (rule #5)
8. **Trusting client-supplied identity headers/params.** Trust the proxy only. (rule #8)
9. **Returning `500` (or worse, `200`) when the DB is down.** Return `503` so callers
   retry. (rule #7)
10. **Calling a synchronous client (e.g. Snowflake connector) directly in an async
    route.** It starves the event loop; use a bounded threadpool. ([§8.4](#84-the-app-read-is-fast--but-still-run-the-connector-in-a-threadpool))
11. **Logging secrets/tokens** (in banners, `whoami`, error messages, or diagnostics).
    Always redact. ([§4.4](#44-diagnostics-that-never-leak-secrets), [§5.6](#56-middleware-wiring--whoami-diagnostics))
12. **Dropping `--start-period` from the healthcheck.** The pool takes seconds; Cloud Run
    will flap the container without it. ([§9.1](#91-dockerfile-requirements))
13. **Running the container as root.** Breaks tini's signal forwarding and violates
    least privilege. ([§9.1](#91-dockerfile-requirements))
14. **Pydantic v1 patterns.** This is **Pydantic v2** + pydantic-settings —
    `AliasChoices`, `field_validator`, `computed_field`, `model_config` are v2-specific.
15. **Relying on an external scheduler / CronJob / M2M call to trigger the app.** App
    Foundry has no native scheduler, and these callers have no Okta identity so Pomerium
    rejects them. Push scheduling to the data warehouse and trigger app work from a real
    user request. ([§8.6](#86-triggering-the-refresh-user-initiated-only))
16. **Running multi-minute work inline in a request, or in a long in-app background job.**
    A request lives ~30s and a background job can be killed on scale-to-zero. Do heavy
    work in the warehouse; the app only does a fast read. ([§8.1](#81-the-architecture-warehouse-scheduled-materialization--fast-app-read))

---

## 11. Fill in for YOUR app

This blueprint prescribes **infrastructure**, not product. You (the building agent) must
define the following for the specific application. Treat each as a required deliverable.

- [ ] **Domain data model + migrations.** Design your tables and write
  `migrations/001_init.sql` (additive, idempotent, ledgered — [§6.3](#63-idempotent-migration-runner-home-rolled)).
  Reuse the generic patterns (`app_meta`, `users`, optional versioned-snapshot table) as
  appropriate; name everything for your domain.
- [ ] **API endpoints.** Implement your routes under `app/routes/<your_domain>.py`. Every
  data endpoint acquires the pool via `async with db.acquire()` (so it 503s when the DB
  is down), binds all SQL params (`$1`, `$2`), and is role-gated where it mutates state
  (`require_signed_in` / `require_admin` / `require_owner`). Document each endpoint's
  request/response **wire shape** — treat those shapes as a contract once a frontend
  depends on them.
- [ ] **Frontend.** The blueprint does **not** prescribe a UI. It only prescribes the
  **same-origin static-serve convention**: mount `public/vendor/` for assets, serve
  `public/index.html` at `/`, keep the API same-origin (`/api/...`), and use a
  **cache-buster** convention for versioned assets so clients pick up new builds. The
  actual UI (framework, pages, components) is entirely yours.
- [ ] **Auth specifics.** Set `BOOTSTRAP_OWNERS` / `BOOTSTRAP_ADMINS` for your org, decide
  your role names/permissions beyond the default ladder, and confirm which proxy headers
  your platform actually sends (verify via `/api/whoami` in the deployed env).
- [ ] **Snowflake source query (only if using [§8](#8-snowflake-data-source-pattern-optional-module)).**
  Write your **parameter-free, self-dynamic** heavy query to run **warehouse-side** in a
  Task/Dynamic Table that materializes a results table ([§8.5](#85-the-heavy-warehouse-query-parameter-free--self-dynamic)),
  define the `SNOWFLAKE_*` env vars (incl. `SNOWFLAKE_RESULTS_TABLE`), wire the
  user-initiated refresh triggers ([§8.6](#86-triggering-the-refresh-user-initiated-only)),
  and map the fast-read rows into your snapshot table. If you don't use a warehouse, delete
  `app/warehouse.py` and the `SNOWFLAKE_*`/`REFRESH_*` config entirely.
- [ ] **Write your own `AGENTS.md`.** Record the current state, the wire contracts, and any
  app-specific battle scars for the next agent.

---

## 12. The one sentence to take away

> **Build a thin, stateless Python service that trusts the platform for identity and
> secrets, keeps all primary state in Postgres, opens its HTTP listener before the
> database is ready, and never breaks the rules in [§2](#2-non-negotiable-rules-the-battle-scars) —
> then layer YOUR domain, endpoints, and UI on top.**
