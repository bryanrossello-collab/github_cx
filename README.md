# Renewals Studio (container build, v3.0.0)

The **Renewals Intelligence Studio** dashboard packaged for **Google Cloud Run** via **App Foundry / Vibe** with **Cloud SQL Postgres** as the only durable store. The frontend (HTML + compiled React bundle) is identical to the macOS install; the backend was rewritten in **Python 3.12 + FastAPI + asyncpg** to match the rest of the Vibe fleet and to honour the platform's "no filesystem persistence" rule.

> **Cross-references**
> - [`CAPABILITIES.md`](./CAPABILITIES.md) — feature readout + visualizations (for Gemini Canvas / Notion)
> - [`AGENTS.md`](./AGENTS.md) — handoff guide for the next contributor (human or AI)

---

## What changed in this version (v3.2)

| | v2.0 (Node) | **v3.2 (Python + Postgres + snapshot history)** |
| --- | --- | --- |
| Backend | Node.js + Express | **Python 3.12 + FastAPI + asyncpg** (Signal CX pattern) |
| Persistence | `data/notes.json` + filesystem CSVs | **Cloud SQL Postgres** — notes, tombstones, raw CSV blobs, **and parsed `account_snapshots`** |
| Upload model | One-at-a-time, overwrote on disk | **Every upload is an immutable snapshot.** The dashboard reads the latest; history is retained for WoW / MoM analysis |
| Admin entry point | None | **Admin tab** in the dashboard top-strip → `/admin` (password: `signal`) |
| Notes import | macOS dialog | **`/admin` page** — drop a notes JSON file, password-gated |
| CSV import button | Settings menu | **Removed from dashboard topbar** — all imports live behind the Admin tab |
| `Mobile snapshot` endpoint | Returned 501 | **Removed entirely** (404 now) |
| Settings menu | Mixed import + export | **Export-only** — Import CSV button hidden via DOM injection |
| Health probes | Single endpoint | `/healthz` (liveness) + `/readyz` (readiness, structured JSON) |
| Startup | Sync, blocked on FS reads | **Non-blocking** — listener opens immediately, DB connects in background |
| Labels | "DJ Call" / "DJ Forecast" | **"ELT Call" / "ELT Forecast"** (state keys preserved) |
| Image | node:20-alpine, ~180 MB | python:3.12-slim, multi-stage, ~250 MB |

## The data flow

1. **Admin uploads the initial CSV** via the Admin tab (password `signal`).
2. Server stores the raw bytes in `csv_uploads` (BYTEA) **and** parses each row into `account_snapshots` (~50K rows for a typical F1 Sheet).
3. **Subsequent uploads** (weekly / a few times a week) → each becomes a new snapshot with its own `effective_date`.
4. **Dashboard reporting** reads the newest snapshot per slot — always the latest book.
5. **WoW / MoM analysis** queries `account_snapshots` ordered by `effective_date`. The /admin "Account history" lookup demonstrates this: type any account ID, see its full timeline of health / ATR / forecast changes.

---

## Deployment & DB troubleshooting

### 0. What the platform must inject

App Foundry / Vibe is expected to provision Cloud SQL Postgres and inject these env vars into the running container:

| Env var | Example | Notes |
| --- | --- | --- |
| `DB_HOST` | `/cloudsql/myproj:us-central1:renewals-db` (socket) or `10.0.0.5` (IP) | The app auto-detects unix socket vs TCP |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `renewals` | |
| `DB_USER` | `renewals` | |
| `DB_PASSWORD` | `<platform-managed>` | Special chars (`@ : / + %`) are safe — passed as a discrete asyncpg param, never URL-encoded |
| `DB_SSLMODE` | `disable` (sockets) / `require` (TCP) | Auto-detected if unset |
| `PORT` | `8080` | Cloud Run injects this |
| `ADMIN_TOKEN` | `<from secret manager>` | **Required.** If unset, all `/admin/*` endpoints and CSV uploads return 503. |

**`DB_*` always wins over `PG*`** — even when `PGHOST`/`PGPASSWORD` are inherited from the platform's environment, the app's `AliasChoices` config gives `DB_*` precedence. This was a real outage on the previous build.

### 1. Vibe `RunService` snippet

```yaml
spec:
  database:
    name: renewals-studio-db
    type: postgres
    version: "15"
  containers:
    - image: <registry>/renewals-studio:v3.0.0
      ports:
        - containerPort: 8080
      env:
        - name: PORT
          value: "8080"
        # DB_HOST / DB_USER / DB_NAME / DB_PASSWORD are injected by Vibe — do
        # NOT hand-set them here, so secret rotation works.
        - name: ADMIN_TOKEN
          valueFrom:
            secretKeyRef:
              name: renewals-studio-secrets
              key: admin-token
```

### 2. First-boot expectations

1. Cloud Run starts the container.
2. uvicorn binds `0.0.0.0:$PORT` and FastAPI's lifespan begins.
3. `/healthz` immediately returns **200**.
4. A background task starts trying to open the asyncpg pool with **exponential backoff** (1s → 2s → 4s → 8s → 16s → 30s cap, infinite retries).
5. `/readyz` returns **503** with the current state until the pool is connected AND the schema is applied.
6. Once connected, `apply_migrations()` runs every `migrations/*.sql` file whose version isn't in `schema_migrations`.
7. `seed_if_needed()` ingests `/app/seeds/*.csv` into the `csv_uploads` table if the slot is empty. UPSERT semantics — re-running is a no-op.
8. `/readyz` returns **200**, dashboard is fully operational.

### 3. Reading `/readyz`

The body always contains the same shape — even on 503:

```json
{
  "ok": false,
  "db_connected": false,
  "schema_ready": false,
  "migrations_applied": [],
  "last_error": "[Errno 110] Connection timed out",
  "last_error_type": "OSError",
  "connect_attempts": 4,
  "last_connect_at": null,
  "target_host": "/cloudsql/proj:region:instance",
  "uptime_sec": 42,
  "db_name": "renewals",
  "db_user": "renewals"
}
```

### 4. Failure modes and what they look like

| Symptom | Likely cause | What to look for |
| --- | --- | --- |
| `/readyz` returns 503 forever, `connect_attempts` keeps climbing, `last_error` mentions "Connection refused" / "timed out" | DB instance not started or VPC/Cloud SQL connector not wired | Check Vibe shows the DB attached; check Cloud SQL instance is `RUNNING`; for Cloud Run check the **Cloud SQL Connections** section names your instance |
| `/readyz` 503 with `last_error` containing "password authentication failed" | `DB_USER` / `DB_PASSWORD` mismatch | Check the platform secret in **Secret Manager**; rotate if necessary; the app never reads creds from disk so a redeploy is enough |
| `/readyz` 503 with `last_error` containing "database \"renewals\" does not exist" | Cloud SQL instance is fresh but the named DB hasn't been created | Use the Cloud SQL UI to create the database matching `DB_NAME`, or update `DB_NAME` to match what exists |
| `/readyz` 503 with `last_error` containing "schema_migrations" or "permission denied" | DB user lacks `CREATE` privilege | Grant `ALL ON SCHEMA public TO <user>` once via psql or the Cloud SQL UI |
| `/readyz` flips between 200/503 | Pool churn — likely Cloud SQL connection limit hit | Lower `DB_POOL_MAX` (default 10) or upgrade the SQL tier; check the **Connections** chart on Cloud SQL |
| Dashboard loads but shows "no data" | `csv_uploads` is empty in the DB | Visit `/admin`, sign in with `ADMIN_TOKEN`, upload the latest F1 Sheet CSV. Or check `SEED_ON_FIRST_BOOT` (default true) — if you set it to false, the seed step was skipped. |
| Cloud Run shows "Your client does not have permission to get URL /" | **Not the app** — Cloud Run service requires auth | Cloud Run console → service → Security → "Allow unauthenticated invocations" |
| Container restarts every 30 seconds | Healthcheck failing because `$PORT` was overridden but uvicorn wasn't told | Confirm `PORT` env var matches the `containerPort` in the YAML |

### 5. Admin diagnostics

`GET /admin/db-status` with `X-Admin-Token: <token>` returns the same JSON as `/readyz` plus:

- `db_version` — server version
- `pool_size`, `pool_idle`, `pool_in_use`
- `row_counts` for every main table

This is what you read first when something looks wrong.

### 6. Uploading CSVs

**Through the UI:**

1. Visit `/admin` (or `/admin.html`)
2. Enter `ADMIN_TOKEN`
3. Pick the CSV, choose slot, optionally add a note
4. Upload — the file becomes a new row in `csv_uploads`; the dashboard's auto-loader picks it up on next refresh

**Through the API:**

```bash
curl -X POST "https://<service>/api/renewals/upload-csv?slot=active" \
     -H "X-Admin-Token: $ADMIN_TOKEN" \
     -H "Content-Type: text/csv" \
     --data-binary @./Jesse\ and\ Dave\ F1\ Sheet\ -\ 2026\ data.csv
```

**Filename slot inference**: if the filename contains `2026 data`, slot defaults to `active`; if it contains `historical fy27`, slot defaults to `historical`. Otherwise `?slot=` is required.

### 7. Local development

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ADMIN_TOKEN=dev \
DB_HOST=localhost DB_PORT=5432 \
DB_NAME=renewals DB_USER=postgres DB_PASSWORD=postgres \
uvicorn app.main:app --reload --port 8080
```

Without a database the app still boots and serves `/`, `/admin`, `/healthz`, and static assets. `/readyz` returns 503 and any `/api/renewals/*` endpoint that requires the DB returns 500 — exactly the production behaviour.

### 8. What this image will NOT do

| Anti-feature | Why |
| --- | --- |
| Build credentials UI / `/admin/credentials` endpoint | Credentials come from the platform env, not from the user |
| Persist any primary state to `/tmp`, `/app/data`, in-memory dicts | Cloud Run wipes the filesystem; we lose writes silently |
| Build a DSN string and parse it back | Special chars in passwords cause real outages |
| `DROP TABLE` or `TRUNCATE` from startup code | Full stop — never |
| Block on the DB before the HTTP listener opens | Cloud Run's startup probe is unforgiving |

---

## API reference

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/healthz` | none | Liveness probe (always 200) |
| `GET`  | `/readyz` | none | Readiness probe (200 when DB+schema ready, 503 otherwise) |
| `GET`  | `/admin/db-status` | token | Full diagnostics: row counts, pool size, DB version |
| `GET`  | `/admin/csv-uploads` | token | List CSV upload history (newest first; `?slot=` to filter) |
| `GET`  | `/admin/csv-uploads/{id}/download` | token | Download a specific historical version |
| `DELETE`| `/admin/csv-uploads/{id}` | token | Delete a historical version (refuses to delete the last upload for a slot) |
| `GET`  | `/api/renewals/notes` | none | Full notes payload (`{notes, noteDeletes, savedAt}`) |
| `PUT`  | `/api/renewals/notes` | none | Persist notes (debounced by the dashboard) |
| `GET`  | `/api/renewals/csv-list` | none | List newest CSV per slot |
| `GET`  | `/api/renewals/data-source/info?match=<sub>` | none | Metadata for the newest matching CSV |
| `GET`  | `/api/renewals/data-source/file?match=<sub>` | none | Stream that CSV |
| `POST` | `/api/renewals/upload-csv` | password | Upload a new CSV (creates a new snapshot in `csv_uploads` + parses rows into `account_snapshots`) |
| `POST` | `/api/renewals/notes/import` | password | Bulk import notes from a JSON payload (same shape as `Export Notes` output) |
| `GET`  | `/api/renewals/snapshots` | none | List CSV upload history with parsed-row counts |
| `GET`  | `/api/renewals/snapshots/{id}/summary` | none | One snapshot's totals + health / region breakdown |
| `GET`  | `/api/renewals/account-history/{account_id}` | none | One account's timeline across every snapshot |
| `POST` | `/api/renewals/reveal` | none | `501` — macOS only |

---

## Environment variables (full list)

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen interface |
| `DB_HOST` | `localhost` | Postgres host or unix socket dir |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `renewals` | |
| `DB_USER` | `renewals` | |
| `DB_PASSWORD` | _empty_ | |
| `DB_SSLMODE` | _auto_ | `disable` (socket) or `require` (TCP) by default |
| `DB_POOL_MIN` | `1` | asyncpg pool low-water mark |
| `DB_POOL_MAX` | `10` | asyncpg pool high-water mark |
| `DB_COMMAND_TIMEOUT_SEC` | `30` | per-query timeout |
| `DB_CONNECT_RETRY_INITIAL_SEC` | `1.0` | backoff base |
| `DB_CONNECT_RETRY_MAX_SEC` | `30.0` | backoff cap |
| `ADMIN_TOKEN` | _empty_ | **Required in prod.** Guards `/admin/*` and CSV upload. |
| `SEED_ON_FIRST_BOOT` | `true` | If false, skip seeding bundled CSVs even when the table is empty |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
