# AGENTS.md — Renewals Studio Handoff Guide (v3.2)

> Changes since v3.0 (see `/Users/bryan.rossello/Desktop/Renewals Studio/README.md` for full list):
>
> * **Mobile-snapshot endpoint removed entirely** (was 501, now 404).
> * **Admin tab** added to the dashboard topbar via `index.html` JS injection (navigates to `/admin`).
> * **Import CSV button hidden** in the topbar via the same injection.
> * **CSV uploads now parsed server-side** into `account_snapshots` table on every upload (and on first-boot seed). Module: `app/ingest.py`.
> * **New endpoints:** `/api/renewals/snapshots`, `/api/renewals/snapshots/{id}/summary`, `/api/renewals/account-history/{account_id}`, `/api/renewals/notes/import`.
> * **`/admin` page expanded:** Notes JSON import section + Account history (WoW / MoM) lookup.
> * **Auth header switched** to `X-Signal-Password` (matches Signal CX pattern), default password is **`signal`**.
> * **Config accepts `DATABASE_URL`** as the highest-priority option (matches Signal CX).


> A deeply detailed guide for the next agent (human or AI) who picks up
> this project. Read sections **0**, **1**, and **2** first — they will
> orient you in under 10 minutes. The rest is reference material.

---

## 0. TL;DR

You are about to work on **Renewals Studio**, version 3.0.0. The project
lives at `/Users/bryan.rossello/Desktop/Renewals Studio/`. It packages the
original *Renewals Intelligence Studio* React dashboard for Cloud Run
deployment via App Foundry / Vibe, with Cloud SQL Postgres as the only
durable store.

| Layer | What it is | Owner |
| --- | --- | --- |
| **Frontend** | `public/index.html` + `public/vendor/*` — original dashboard, bundled verbatim. The compiled React app `vendor/app.js` is treated as a black box. | NOT us |
| **Backend** | `app/` — Python 3.12 + FastAPI + asyncpg + pydantic-settings, providing the exact endpoints the dashboard expects | Us |
| **Persistence** | Cloud SQL Postgres only. Schema in `migrations/*.sql`. Notes, tombstones, and CSV uploads (with full version history) live in tables. | Us |
| **Admin UI** | `public/admin.html` — password-protected (via `ADMIN_TOKEN`) page for managing CSV uploads | Us |
| **Container** | `Dockerfile` (multi-stage, python:3.12-slim, tini, non-root) | Us |
| **Deployable** | `renewals-studio.zip` at the project root | Us |

**Three rules that override everything else:**

1. **Cloud Run is stateless.** Never write primary data to the filesystem, `/tmp`, or process memory. Every write goes through Postgres. If Postgres is down, return 503 — don't silently buffer.
2. **The dashboard's endpoint contract is sacred.** The bundled React app expects specific JSON shapes (especially `{notes, noteDeletes, savedAt}`). Don't change shapes without re-reading § 5.
3. **Credentials never come from a UI.** App Foundry / Vibe injects `DB_*` env vars. Don't add a credentials form. Don't persist creds to disk. Don't build a `/admin/credentials` endpoint.

---

## 1. Architecture

### 1.1 Two layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  Renewals Studio container (python:3.12-slim)                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Frontend (immutable, bundled verbatim)                      │   │
│  │  - public/index.html    (66 KB; one surgical edit, see §6.4) │   │
│  │  - public/vendor/app.js (567 KB; ELT rename only, see §6.5)  │   │
│  │  - public/vendor/{tailwind.min.css, papaparse.min.js, …}     │   │
│  │  - public/admin.html    (standalone admin page)              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              │ HTTPS, same-origin                   │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Backend (app/, owned by us)                                 │   │
│  │  - app/main.py        FastAPI + lifespan                     │   │
│  │  - app/config.py      pydantic-settings, DB_* over PG*       │   │
│  │  - app/database.py    asyncpg pool, migrate, seed, retry     │   │
│  │  - app/logging_setup.py  structlog → JSON stdout             │   │
│  │  - app/routes/health.py    /healthz, /readyz                 │   │
│  │  - app/routes/admin.py     /admin/db-status, /admin/csv-*    │   │
│  │  - app/routes/renewals.py  /api/renewals/*                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              │ asyncpg pool, discrete params        │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Cloud SQL Postgres                                          │   │
│  │  - notes, note_tombstones, csv_uploads (BYTEA + history),    │   │
│  │    app_meta, schema_migrations                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 File map

```
Renewals Studio/
├── AGENTS.md                       ← you are here
├── README.md                       ← deployment & troubleshooting guide
├── CAPABILITIES.md                 ← feature readout for sharing
├── Dockerfile                      ← python:3.12-slim, multi-stage, tini
├── .dockerignore
├── .gitignore
├── pyproject.toml                  ← package metadata + deps
├── requirements.txt                ← pinned production deps
├── app/
│   ├── __init__.py
│   ├── main.py                     ← FastAPI app + lifespan
│   ├── config.py                   ← pydantic-settings (DB_* > PG*)
│   ├── database.py                 ← asyncpg pool, migrate, seed, retry
│   ├── logging_setup.py            ← structlog JSON config
│   └── routes/
│       ├── __init__.py
│       ├── health.py               ← /healthz, /readyz
│       ├── admin.py                ← /admin/db-status, /admin/csv-uploads
│       └── renewals.py             ← /api/renewals/*
├── migrations/
│   └── 001_init.sql                ← initial schema
├── seeds/
│   ├── active.csv                  ← 12 MB, default for active slot
│   └── historical.csv              ← 2.9 MB, default for historical slot
└── public/
    ├── index.html                  ← original dashboard HTML (verbatim)
    ├── admin.html                  ← our admin UI (standalone)
    └── vendor/
        ├── app.js                  ← compiled React (567 KB, ELT-renamed)
        ├── tailwind.min.css        ← 2.9 MB
        ├── react.production.min.js
        ├── react-dom.production.min.js
        ├── papaparse.min.js
        ├── inter-latin.woff2 / inter-latin-ext.woff2 / inter.css
        ├── icon.svg / manifest.json
```

### 1.3 The data model

```sql
schema_migrations(version PK, applied_at)
app_meta(key PK, value JSONB, updated_at)
notes(
    note_key PK,                     -- "accountBase::period::roundedATR"
    note_text, dj_forecast,          -- dj_forecast column kept for wire-key compat
    archived, account_id, account_name, owner,
    renewal_date, fq, atr, account_label,
    history JSONB,                   -- newest-first, capped at 20 by API layer
    updated_at)
note_tombstones(note_key PK, deleted_at)
csv_uploads(
    id BIGSERIAL PK,
    slot CHECK IN ('active','historical'),
    filename, content_type, size_bytes, sha256,
    content BYTEA,                   -- the actual CSV bytes
    uploaded_at, uploaded_by, note)
```

Every CSV upload creates a new row in `csv_uploads`. The data-source
endpoints serve the newest matching row per slot. **History is retained
forever** unless an admin explicitly deletes it via the admin UI.

---

## 2. Current state (handoff manifest)

> **Always update this section** at the end of a session before handing
> off. Treat it as the durable memory across conversations.

### 2.1 Last known good state

| Item | State |
| --- | --- |
| `server.js` (v2 Node) | **Deleted.** v3 is fully Python. |
| `app/` (Python backend) | **Working.** All 18 routes register, structural tests pass. |
| `migrations/001_init.sql` | **Applied idempotently** on every boot. Creates 5 tables, no DROP/TRUNCATE. |
| `seeds/active.csv` + `seeds/historical.csv` | **Bundled** in the image. Used by `seed_if_needed()` to populate `csv_uploads` on first boot when the table is empty. |
| `public/index.html` | Original HTML; one display string change (`DJ Forecast` → `ELT Forecast` in an Ask-Claude suggestion line). The 127.0.0.1:4774 redirect block is gone (was removed in v2). |
| `public/vendor/app.js` | Original compiled React + **24 display-string replacements** to rename DJ→ELT. **All 33 state-key identifiers (djForecast, djSource, djCount, etc.) preserved.** |
| `public/admin.html` | New file. Token-gated CSV upload + history UI. |
| `Dockerfile` | python:3.12-slim, multi-stage, tini, non-root, healthcheck on `/healthz`. |
| Validation | 8 structural tests pass (config precedence, SSL mode, banner-doesn't-leak, all routes, SQL schema, notes serialization, rename audit). No live Postgres validation done — that happens on the user's Cloud Run. |
| `renewals-studio.zip` | 2.3 MB. Rebuilt with v3. |

### 2.2 Outstanding items

None known. If you discover something is broken, add it here before
asking the user.

### 2.3 Conversation log summary

The v3 rewrite came from a single big session:

1. **User asked for** (a) "DJ Call" → "ELT Call" rename and (b) a Postgres integration following an extremely detailed spec (env-var-injected creds, AliasChoices, discrete asyncpg params, /healthz vs /readyz, idempotent schema, UPSERT seeding, no filesystem state, tini, structured logs, diagnostics endpoints).
2. **I disambiguated** three things before writing code: language/framework (Python or Node?), CSV storage approach (GCS/BYTEA/row-tables?), rename scope (only "DJ Call" or also "DJ Forecast"?).
3. **User answered**: Python + FastAPI; **CSV uploads in Postgres with version history + a password-protected admin tab**; rename all DJ-flavored display strings → ELT.
4. **I implemented** the full Python stack: 8 modules, 1 migration file, 1 Dockerfile, 1 admin UI, updated all 3 docs. Validated structurally (no live Postgres available locally).

```
Session 2 — 2026-08-03
- User asked for: a "Weekly 100K+ Regional Brief" — CCO weekly WoW bottoms-up
  forecast movement report (100K+ band, current quarter, by region, week
  selector), with 4 sections + a downloadable HTML brief.
- Delivered: additive read-only GET /api/renewals/weekly-brief (§5.10) that
  diffs the latest vs prior active-slot account_snapshots per account on
  BU_FC + Upside; new "Weekly Brief" React tab (WeeklyBriefTab in
  vendor/app.js) with region + week/snapshot selectors and a client-side
  "Download brief" HTML export styled like the exec-summary. No schema
  change; band+quarter-filtered SQL keeps the diff bounded. Verified live
  against a throwaway local Postgres seeded with two modified snapshots.
- Open question / TODO: none. Residual risks — needs ≥2 snapshots to compare;
  current-quarter auto-detection uses the fiscal-quarter mapping (override
  via ?quarter=); a weekly cadence depends on how often CSV/Snowflake
  snapshots land (no scheduler in-app).
```

---

## 3. Communication protocol

### 3.1 The cardinal rules from the user's spec

When the user sets boundaries up front like *"if anything conflicts with what you'd normally do, my rules win — these are battle-scars from the previous build"* — **don't second-guess them.** Examples from this build:

- "No DSN strings" — even though it'd save 5 lines, building discrete params is the safe path because passwords with `@:/+%` are common.
- "Open the HTTP listener BEFORE awaiting DB" — Cloud Run's startup probe is unforgiving; a 200 on `/healthz` matters more than a clean state machine.
- "DB_* before PG*" — small detail, hard outage. `AliasChoices` order is load-bearing.

If you're tempted to deviate, **surface the trade-off in writing** with the user before changing course.

### 3.2 When the user pastes a "spec" with constraints

The pattern from this user:

> Follow ALL of the requirements below. If anything conflicts with what
> you'd "normally" do, my rules win — these are battle-scars from the
> previous build.

Treat that prelude as the contract. Don't apologize, don't soften.
Implement to spec. Surface a question only when:

- A constraint is internally contradictory.
- A constraint conflicts with an explicit later constraint.
- The codebase's current state makes a constraint impossible without a
  bigger decision (e.g. you'd have to swap the language).

For Renewals Studio v3, the only genuinely unclear thing was **CSV storage**
("no filesystem" vs "the dashboard needs CSVs"). One question saved me from
guessing.

### 3.3 The "tell me which X you'll use, then proceed" pattern

When the user says it, they want:

1. A **decisive answer** for the X (not "I could do either")
2. A **one-line rationale**
3. **The actual unclear items**, asked once, in a single batch
4. Then go

Don't iterate, don't draft-and-revise. Pick. Justify. Ask the genuinely
hard questions. Build.

### 3.4 Layman vs. technical mode

Watch for signals:
- "Restate in layman terms" / "in plain English"
- The user asks the same question rephrased

In layman mode: number steps **1, 2, 3**, show literal keystrokes, anticipate failure modes, end with an "if X then Y" troubleshooting table.

In technical mode: lead with the answer, skip the preamble, include real curl examples, quote exact error messages.

---

## 4. Decision-making framework

### 4.1 Storage decisions

```
Is this PRIMARY application data?
├── Yes → Postgres. Always. No filesystem fallbacks.
└── No  → It depends:
         - Immutable derived data with explicit TTL? → in-process cache OK.
         - User session? → don't — make it stateless.
         - Large binary blobs (CSVs, images)? → BYTEA in Postgres or
           Cloud Storage. Currently: BYTEA. Switch to GCS only if blobs
           outgrow ~100 MB.
         - Logs? → stdout JSON. Cloud Run captures them.
```

### 4.2 When to add a dependency

The current deps are all load-bearing:

- `fastapi` — the framework
- `uvicorn[standard]` — production ASGI server with httptools, websockets, watchgod
- `asyncpg` — Postgres driver with discrete-param API
- `pydantic` + `pydantic-settings` — config validation, `AliasChoices`
- `python-multipart` — multipart form parsing for `/admin` CSV uploads
- `structlog` — JSON logs

**Don't add:** `psycopg2`, `sqlalchemy`, `alembic`, `databases`, `httpx`, `requests` — none are needed for the current scope. The home-rolled migration runner in `app/database.py` is intentional because we have one migration today and a strict no-`DROP` policy.

### 4.3 When to change the schema

Steps for any schema change:

1. Create `migrations/002_<purpose>.sql` (numbered, lower-snake_case).
2. Use only `CREATE … IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE INDEX … IF NOT EXISTS`. **Never** `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` in a migration.
3. The migration runner in `app/database.py` applies any file whose stem isn't in `schema_migrations`. Order is lexical, so `010_…` sorts after `002_…`.
4. The `notes_serialize` and `csv_uploads` shapes are referenced from `app/routes/renewals.py`. If you add columns, update the wire-translation maps too.
5. Test locally against a real Postgres before opening a PR — the in-memory tests in this codebase can't catch SQL issues.

### 4.4 Endpoint contract changes

If you change the response shape of any `/api/renewals/*` endpoint:

1. Grep the original `app.jsx` source at `/Users/bryan.rossello/Desktop/Vibe Coding - APAC/Renewals/app.jsx` for the endpoint path.
2. Trace the call site. The dashboard's React state will silently break if you change shapes it relies on.
3. The frozen shapes are documented in § 5. Don't extend them lightly.

---

## 5. The endpoint contract (FROZEN)

### 5.1 `GET /healthz`

```json
{"ok": true, "uptime_sec": 42}
```

Always 200 while the process is alive. Cloud Run's liveness probe.

### 5.2 `GET /readyz`

```json
{
  "ok": false,
  "db_connected": false,
  "schema_ready": false,
  "migrations_applied": ["001_init"],
  "last_error": "Connection refused",
  "last_error_type": "ConnectionRefusedError",
  "connect_attempts": 4,
  "last_connect_at": null,
  "target_host": "/cloudsql/proj:region:inst",
  "uptime_sec": 42,
  "db_name": "renewals",
  "db_user": "renewals"
}
```

200 only when `db_connected` AND `schema_ready`. 503 otherwise.

### 5.3 `GET /api/renewals/notes`

```json
{
  "notes": {
    "<accountBase::period::roundedATR>": {
      "note": "free text",
      "djForecast": 500000.0,
      "archived": false,
      "accountId": "001ABC",
      "accountName": "Acme",
      "owner": "Jesse",
      "renewalDate": "2026-06-30",
      "fq": "2027Q1",
      "atr": 1320.0,
      "accountLabel": null,
      "history": [...],
      "updatedAt": 1745321943210
    }
  },
  "noteDeletes": { "<key>": 1745321943210 },
  "savedAt": "2026-05-20T16:27:36.344Z"
}
```

**Critical:** the wire key is `djForecast` (NOT `eltForecast`). The user
renamed the **display label** to "ELT Forecast"; the state key stays.
Renaming the state key would invalidate every existing note and every
saved export.

### 5.4 `PUT /api/renewals/notes`

Request body: `{ notes, noteDeletes }`.
Response: `{ ok, savedAt, noteCount, deleteCount }`.

The server applies each note as an UPSERT with newer-wins (the WHERE
clause on `updated_at` enforces this). Tombstones are upserted, and any
matching row in `notes` is hard-deleted in the same transaction.

### 5.5 `GET /api/renewals/csv-list`

```json
{
  "files": [
    {"name": "...", "size": 12275670, "mtime": 1779294253128}
  ]
}
```

One file per slot, the most recent upload, sorted newest-first.

### 5.6 `GET /api/renewals/data-source/info?match=<sub>`

When found:

```json
{
  "ok": true, "found": true,
  "directory": "postgres:csv_uploads",
  "filename": "Jesse and Dave F1 Sheet - 2026 data.csv",
  "size": 12275670,
  "mtime": "2026-05-20T16:24:13.128Z",
  "mtimeMs": 1779294253128,
  "format": "csv",
  "slot": "active"
}
```

When not found:

```json
{"ok": true, "found": false, "configured": true, "match": "2026 data"}
```

### 5.7 `GET /api/renewals/data-source/file?match=<sub>`

Streams the CSV bytes with `Content-Type: text/csv; charset=utf-8`,
`X-Source-*` headers. 404 if no match.

### 5.8 `POST /api/renewals/upload-csv`

Token-required (`X-Admin-Token` or `Authorization: Bearer …`). Accepts
text/csv body or multipart/form-data with `file` part. Returns
`{ok, id, slot, filename, size, sha256, uploaded_at}`.

### 5.9 `GET /api/renewals/account-forecasts/{account_id}`

Latest CS / Renewals call for one renewal row (resolved via `call_key`, or
`year_quarter` + `rounded_atr`). In addition to the latest values, the
response now includes a **`history`** array — the full append-only audit
trail for that `call_key`, newest-first, sourced from `account_call_events`:

```json
{
  "ok": true,
  "call_key": "001ABC::2027Q1::1320",
  "cs_forecast": 500000.0,
  "renewals_forecast": 250000.0,
  "elt_forecast": 750000.0,
  "history": [
    {
      "cs_forecast": 500000.0,
      "renewals_forecast": 250000.0,
      "elt_forecast": 750000.0,
      "effective_date": "2026-07-09T14:03:11.101Z",
      "edited_by_email": "jesse@zendesk.com",
      "edited_by_display": "Jesse",
      "source": "modal_done"
    }
  ]
}
```

`history` is display-only and read by the account card's "Updates" section
to show who changed CS / Renewals forecast and when. It is additive — the
prior single-call fields are unchanged, so the frozen contract holds.

### 5.10 `GET /api/renewals/weekly-brief`

Powers the **Weekly Brief** dashboard tab (CCO's Weekly 100K+ Regional
Brief). Compares two `account_snapshots` (week-over-week), scoped to the
**100K+ band** for the **current quarter**, broken out **by region**.

Query params (all optional):
`slot` (default `active`), `current`/`prior` (pin a `csv_upload_id` pair;
default = latest active snapshot vs the immediately-preceding one),
`quarter` (any label spelling — `Q3\`27`, `FY27Q3`, `2027Q3`; default =
auto-detected current fiscal quarter), `band` (default `100k+`),
`threshold` (default `50000` — the "large mover" cutoff for explanations),
`region` (default `''`/`__ALL__` = overall rollup). **`region` is applied
server-side to EVERY section, including the trend series**, so the whole
brief is uniformly region-scoped; the response's `available_regions` list is
computed unfiltered so the UI selector stays fully populated. `region` must
be in the frontend fetch params + effect deps or the trend won't refresh.

```json
{
  "ok": true, "slot": "active", "band": "100k+", "threshold": 50000.0,
  "region": "__ALL__", "available_regions": ["AMER", "APAC", "EMEA"],
  "quarter": "Q3`27", "quarter_auto_selected": false,
  "current": {"id": 2, "effective_date": "2026-07-27T...", ...},
  "prior":   {"id": 1, "effective_date": "2026-07-20T...", ...},
  "warning": null,
  "snapshots": [ {"id": 2, "effective_date": "...", "filename": "...", "row_count": 51012}, ... ],
  "sections": {
    "bu_movement": {
      "regions": [{"region": "APAC", "current": 4462552.0, "prior": 3907552.0,
                   "delta": 555000.0, "delta_pct": 14.2, "accounts": 389}],
      "rollup":  {"current": ..., "prior": ..., "delta": ..., "delta_pct": ..., "accounts": ...},
      "trend":   [{"upload_id": 1, "effective_date": "...", "total_bu_fc": 3907552.0}, ...]
    },
    "worsened":     [{"account_id", "account_name", "region", "current_bu_fc",
                      "prior_bu_fc", "swing", "is_large", "explanation?", "explanation_source?"}],
    "new_forecast": [{... "current_bu_fc", "is_large", "explanation?", "explanation_source?"}],
    "upside": {"current_total", "prior_total", "delta", "delta_pct",
               "top_increase": [...5], "top_decrease": [...5]}
  }
}
```

Semantics (must stay consistent with the dashboard):
* **BU_FC sign** — `bu_fc` is the forecasted churn/contraction amount
  (`CC% = BU_FC / ATR`). Higher = worse. **"Worsened WoW" = BU_FC
  increased**; `swing = current_bu_fc - prior_bu_fc`, kept when `> 0`,
  ranked descending. `new_forecast` = prior `bu_fc == 0` and current `> 0`.
* **Explanations are auto-pulled** for movers `>= threshold`: current
  `forecast_summary` (source `"forecast_summary"`) else the account's saved
  note (source `"note"`). No manual entry.
* **Upside** is read from `raw_row->>'UPSIDE'` (not a modelled column);
  `top_increase`/`top_decrease` are by per-account WoW `delta`.

Additive and read-only — no schema change, frozen shapes untouched.
**Performance:** every per-snapshot read is filtered to band + quarter in
SQL (~hundreds of rows), only the single `UPSIDE` key is extracted from
`raw_row` (never the whole JSONB blob), and the trend is one grouped query
over the recent-snapshot window — safe for ~50k-row snapshots.

---

## 6. Common change patterns

### 6.1 Adding a new endpoint

```python
# in the appropriate app/routes/<area>.py
@router.get("/api/<area>/<path>")
async def my_endpoint(...) -> dict:
    async with acquire() as conn:
        ...
    return {"ok": True, ...}
```

Update § 5 (or the equivalent section if it's not a renewals contract
endpoint). Update the README's API table. Run the structural test
script in `/Users/bryan.rossello/Desktop/Renewals Studio/` (the inline
Python in the conversation history).

### 6.2 Adding a column

1. New migration: `migrations/00N_add_<column>.sql` using `ALTER TABLE notes ADD COLUMN IF NOT EXISTS <col> <type>`.
2. Update `COLUMN_TO_WIRE` in `app/routes/renewals.py`.
3. If the dashboard reads it, confirm the wire key matches what `app.jsx` expects (grep the source).
4. Run the structural tests.

### 6.3 Modifying the Dockerfile

Rules:
- Keep `python:3.12-slim` base (changing major Python versions needs a careful asyncpg compat check).
- Keep `tini` as PID 1.
- Keep the multi-stage split — build deps stay in stage 1.
- Don't remove the `--start-period=30s` from the healthcheck — Cloud Run's startup window is generous and this prevents flapping.

### 6.4 Updating `public/index.html`

There has only ever been **one** intentional edit: the 127.0.0.1:4774
redirect block was removed in v2. **Don't make any other changes** unless
the original source HTML has been updated. If you do need to touch it,
the dashboard's `<script>` tags must keep loading `vendor/{react,
react-dom, papaparse, app}.js` in that order.

### 6.5 Updating `public/vendor/app.js`

This is the compiled output of the original project's `app.jsx`. Our v3
build performed exactly **24 display-string replacements** (DJ → ELT)
without touching any state-key identifier. If you ever need to do another
rename, **use a Python script with a state-key safety check** (regex
`\bdj[A-Z][a-zA-Z]*` set before/after; they MUST be equal). The
conversation log has the script template.

If the upstream `app.jsx` changes, the right path is:

1. Get the new `app.jsx` from `/Users/bryan.rossello/Desktop/Vibe Coding - APAC/Renewals/app.jsx`.
2. Apply the same DJ → ELT substitutions to `app.jsx` (not the compiled file).
3. Run `./vendor/esbuild app.jsx --loader:.jsx=jsx --outfile=vendor/app.js` from that project to produce a fresh compiled file.
4. Copy `vendor/app.js` into `public/vendor/app.js` here.
5. Re-run the structural tests.

### 6.6 Rebuilding the deployment ZIP

```bash
cd "/Users/bryan.rossello/Desktop/Renewals Studio"
rm -rf .venv __pycache__ app/__pycache__ app/routes/__pycache__ \
       renewals-studio.zip
zip -r renewals-studio.zip . \
  -x '*.DS_Store' -x '.venv/*' -x '*/__pycache__/*' \
  -x '*.zip' -x '.git/*'
ls -lh renewals-studio.zip   # expected: ~2.3-3 MB
```

---

## 7. Common issues and resolutions

### 7.1 Cloud Run returns "Your client does not have permission to get URL /"

**Not the app.** Google Front End's standard 403 page. Fix in the platform:
Cloud Run console → service → Security → "Allow unauthenticated invocations".

### 7.2 `/readyz` 503 with `last_error: "password authentication failed"`

Mismatched `DB_USER` / `DB_PASSWORD` in the platform-injected env. Rotate
in Secret Manager, redeploy. The app never persists creds to disk so
restart is enough.

### 7.3 `/readyz` 503 with `last_error: "database 'renewals' does not exist"`

Cloud SQL instance is up but the named DB isn't created. Use the Cloud
SQL UI to create it, or update `DB_NAME` to match an existing one.

### 7.4 Dashboard loads but shows "no data"

`csv_uploads` is empty. Either:
- Visit `/admin`, sign in, upload a CSV
- Check `SEED_ON_FIRST_BOOT` — defaults true; if false, no auto-seed

### 7.5 `/admin` returns 503

`ADMIN_TOKEN` env var isn't set. Add it to the platform's secret
manager and redeploy.

### 7.6 Notes round-trip but `savedAt` is null

`app_meta('notes_saved_at')` row is missing. The first `PUT
/api/renewals/notes` creates it. If subsequent reads still see null,
check the migration ledger to confirm `001_init` was applied.

### 7.7 SIGTERM doesn't drain in-flight requests

uvicorn's `--timeout-graceful-shutdown 25` plus `tini` is the contract.
If you see hard kills, check:
- `tini` is actually PID 1 (run `docker exec <id> ps`)
- The container is running as `app` user, not `root` (root would
  bypass tini's signal-forwarding setup)
- Cloud Run's grace period (set in the service config) is ≥ 30s

---

## 8. Handoff protocol — when you're the next agent

### 8.1 Read these files in order

1. **`AGENTS.md` §0–§2** (you are here)
2. **`README.md`** (deployment & troubleshooting; ~250 lines)
3. **`app/main.py`** (lifespan logic; ~120 lines)
4. **`app/database.py`** (the heart of the persistence layer; ~270 lines)
5. **`app/config.py`** (env precedence; ~150 lines)
6. **`migrations/001_init.sql`** (the schema; ~70 lines)

You do NOT need to read `public/vendor/app.js` (567 KB of minified JS).
Treat it as a black box. § 5 is the contract.

### 8.2 Verify the environment

```bash
cd "/Users/bryan.rossello/Desktop/Renewals Studio"
ls -la
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Then run the structural test inline (the Python heredoc in the
conversation log) to confirm nothing is broken before you change
anything.

### 8.3 Verify with a no-DB smoke test

```bash
ADMIN_TOKEN=dev DB_HOST=10.255.255.1 PORT=8089 \
  DB_CONNECT_RETRY_INITIAL_SEC=0.5 DB_CONNECT_RETRY_MAX_SEC=2 \
  .venv/bin/python -m uvicorn app.main:app --port 8089 --no-access-log &
sleep 3
curl -sS http://127.0.0.1:8089/healthz                      # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" \
  http://127.0.0.1:8089/readyz                               # expect 503
curl -sS http://127.0.0.1:8089/admin/db-status              # expect 401
curl -sS -H "X-Admin-Token: dev" \
  http://127.0.0.1:8089/admin/db-status | python3 -m json.tool  # expect 200, db_connected:false
kill %1
```

### 8.4 First message to the user

Skip introductions. State the current state in one line, then ask the
specific question you need answered.

> "Picking up Renewals Studio v3. Stack is Python + FastAPI + asyncpg.
> What would you like changed?"

---

## 9. Anti-patterns — things that will get you in trouble

Ranked by severity:

1. **Adding a credentials UI.** The user has scars from this. Don't.
2. **Building a DSN string** (`postgresql://user:pass@host/db`). Passwords with `@:/+%` will URL-encode-bug at 3am.
3. **Writing primary data to the filesystem.** Cloud Run wipes it on cold start. Postgres or nothing.
4. **Caching primary data in module-level globals** disguised as "performance optimization." Same outcome.
5. **`DROP TABLE` / `TRUNCATE` in startup code.** Full stop. Use ALTER and additive migrations.
6. **Changing endpoint shapes without checking `app.jsx`.** The dashboard will silently break.
7. **Forgetting `--start-period` on the healthcheck.** The pool takes 1–8 seconds; Cloud Run will flap the container without the grace period.
8. **Blocking on the DB before opening the HTTP listener.** Cloud Run's startup probe times out.
9. **Renaming state keys** (`djForecast`, `dj`, `ccData[].dj`) in `vendor/app.js`. Renames the column from "ELT" back to nothing-works.
10. **Trying to make Pydantic v1 patterns work.** This is Pydantic v2 + pydantic-settings. The `AliasChoices` ordering, `field_validator`, `model_config` are v2-specific.

---

## 10. Templates

### 10.1 Endpoint-addition checklist

- [ ] Endpoint implemented in the right `app/routes/<area>.py`
- [ ] Acquires the pool via `async with acquire()` (so 503s on DB-down)
- [ ] All SQL uses parameter binding (`$1`, `$2`) — never string interpolation
- [ ] Token-gated if it mutates state (use the dependency in admin.py)
- [ ] Documented in § 5 of this file
- [ ] Documented in the README API table
- [ ] Structural test confirms the route registers
- [ ] Tested against a real Postgres
- [ ] ZIP rebuilt

### 10.2 Schema-migration checklist

- [ ] New file: `migrations/00N_<purpose>.sql`
- [ ] Uses only `IF NOT EXISTS` clauses; no DROP or TRUNCATE
- [ ] Tested locally against a real Postgres (cold start + warm start)
- [ ] Wire-translation maps in `app/routes/renewals.py` updated if needed
- [ ] AGENTS.md § 1.3 (data model) updated
- [ ] README updated if the new column/table is user-facing

### 10.3 Conversation-summary template (append to § 2.3 before sign-off)

```
Session <N> — <date>
- User asked for: <one line>
- Delivered: <one line>
- Open question / TODO: <one line, or "none">
```

---

## 11. Glossary

- **ATR** — Annual Target Revenue. The renewable book.
- **ELT Call** (was DJ Call) — per-quarter manual forecast override.
- **ELT Forecast** (was DJ Forecast) — per-renewal manual forecast override.
- **BU FC** — Business Unit Forecast (system forecast).
- **noteKey** — composite key tying a note to a specific renewal row:
  `accountBase::period::roundedATR`.
- **Active slot** — current-year CSV (filename contains "2026 data").
- **Historical slot** — prior-year CSV (filename contains "historical fy27").
- **App Foundry / Vibe** — the platform layer that provisions Cloud SQL and injects DB_* env vars into Cloud Run services.
- **GFE** — Google Front End. Produces the "Your client does not have permission" 403 in §7.1.

---

## 12. The single sentence to take away

> **You are maintaining a thin Python server around an unmodified copy of
> someone else's React app, backed by Cloud SQL Postgres. Your job is to
> never break the contract between the three, never write primary state
> anywhere but Postgres, and never block the HTTP listener on database work.**
