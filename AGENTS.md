# AGENTS.md — Renewals Studio Handoff Guide (v3.2)

> Changes since v3.0 (see `/Users/bryan.rossello/Desktop/Renewals Studio/README.md` for full list):
>
> * **Mobile-snapshot endpoint removed entirely** (was 501, now 404). The
>   client-side mobile.html snapshot feature (auto-rebuild effect +
>   `buildMobileSnapshot` action + `MobileSnapshot` Settings UI) was also
>   removed in Session 10 — it was dead code POSTing to the 404 route.
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

```
Session 3 — 2026-08-03/04
- User asked for: (a) rebuild the Weekly Brief trend chart to be readable
  (axes, ticks, tooltips, headline, amounts table) in both the tab and the
  download; then (b) add an ADJUSTED (ELT/calls-as-of) trend series next to
  the BU trend; and (c) make the brief use the app's SHARED filters
  (region/sub-region/CS-manager/segment/owner/ARR) with a visible
  applied-filters chip strip.
- Delivered: dual-line trend (BU vs Adjusted) with legend + per-point
  tooltips (BU, Adjusted, gap) + Week·BU·Adjusted·Δ(Adj−BU) table, in tab
  and export. Backend weekly-brief now accepts sub_region/cs_manager/segment/
  owner/arr_min/arr_max (region/quarter/band already), applies them to every
  section + BOTH trend series, and returns available_* option lists + a
  filters echo. Adjusted total = per-account latest call as-of the snapshot
  date, matched on account_id + rounded_atr + NORMALIZED quarter via one
  indexed LATERAL. Frontend consumes state.filters and renders removable
  chips (reusing region-filter-chip* classes). Cache-buster → v=20260804a.
- Verified: py_compile + node --check; live against local Postgres — filters
  scope all sections + both trend series, and the adjusted line diverges from
  BU by ~$1.49M on a snapshot where FY27Q3 calls apply as-of.
- Open question / TODO: none. Residual risks — (1) accounts with no call
  as-of a snapshot fall back to BU, so the two lines coincide when no calls
  exist in scope (expected); (2) the adjusted series depends on call
  cadence + snapshot cadence (calls dated after the only snapshot holding an
  account won't show); (3) band override is a free-text token (substring
  match), not a mapped dropdown; (4) sub-region/CS-manager aren't in the
  app's GLOBAL filter state (they're Region-tab-local), so those two seed as
  "All" rather than from shared state; (5) interactive UI not rendered in the
  sandbox (SSO/data gate) — backend contract verified live instead.
```

```
Session 4 — 2026-08-04
- User asked for: drive the Weekly Brief's account scope ENTIRELY from the
  app's global Filters bar (state.filters) — remove the in-brief scope
  dropdowns, keep only the snapshot pair + threshold controls, and make the
  chip strip a read-only 3-group summary (Comparing / Scope / Large-mover
  cutoff) reflecting the global filters.
- Delivered (frontend-only, no backend change): WeeklyBriefTab now derives
  region/segment/owner/quarter/band from state.filters (removed Region /
  Sub-region / CS-manager / Segment / Owner / Quarter / Band controls +
  the filterSelect helper). Derivation rules — region/segment/owner: pass a
  value only when exactly ONE is selected globally (0 or 2+ ⇒ All);
  quarter: exactly one global quarter ⇒ use it, else auto current fiscal;
  band: unset/all/100k-family ⇒ 100k+, else global band verbatim. Dropped
  sub_region + cs_manager from the fetch (endpoint still accepts/ignores).
  Scope chips are now informational (mutedChip), state multi-selects as
  "N selected · brief shows All", and a muted hint points to the top bar.
  Effect deps include region/segment/owner/quarter/band so the brief
  re-fetches live when the global bar changes. Cache-buster → v=20260804d.
- Verified: node --check app.js clean. No Python change ⇒ NO server restart
  needed (endpoint params already existed).
- Open question / TODO: none. Residual risks — (1) global multi-select for a
  dimension collapses to "All" for the brief (single-value endpoint); (2)
  band forwarding: non-100k global band tokens (e.g. gt12k) don't map to the
  stored CSV band column the endpoint substring-matches, so a non-100k band
  would empty the brief — the 100K+ brief intentionally pins to 100k+ for the
  100K family; (3) no ARR range in global state (band encodes ranges), so
  arr_min/arr_max are not forwarded.
```

```
Session 5 — 2026-08-05 (batched, cache-buster v=20260805b)
- User asked for: (a) show BOTH explanation sources for large movers; (b) fix
  the Upside KPI tile to use compact currency like the BU tile; (c) add a
  DOWNSIDE section/tile mirroring Upside.
- Delivered (a): weekly-brief large-mover records (worsened + new_forecast)
  carry two nullable fields, `forecast_summary` + `renewals_studio_note`
  (new _explain_fields helper; each truncated to _EXPLANATION_MAX_CHARS;
  only is_large). Legacy explanation/explanation_source kept. Tab renders
  two labeled blocks ("Forecast Summary:" / "Last Renewals Studio Note:")
  via explainCell; export mirrors via explainHtml. Empty sources omitted;
  both empty => em-dash.
- Delivered (b): root cause was fmtCompact/fmtCompactDash not handling
  negatives (fell through to raw). Fixed both to sign-prefix the abs value
  (→ "-$10.5M"). The Upside tile already used fmtC, so it now matches the BU
  tile. signed() passes abs values so no double-sign regression.
- Delivered (c): _wb_load_accounts also extracts raw_row->>'DOWNSIDE'; a
  single _movement_section(field) helper builds both sections.upside and
  sections.downside (identical shape). Frontend adds a Downside KPI tile
  (kpiRow → sm:grid-cols-5) + a "5 · Downside movement" card; export adds a
  Downside KPI + Downside movement blocks (overall + per-region) via a
  generalized moverTable(up, down, label).
- Sign caveat: UPSIDE/DOWNSIDE are used as-is (no sign re-interpretation), so
  a total/delta can be negative and the tile reads e.g. -$10.5M.
- Verified: py_compile + node --check clean. Backend change ⇒ SERVER RESTART
  REQUIRED (new downside section + explanation fields).
- Open question / TODO: none. Residual risks — note text is raw saved note
  (plain-escaped + truncated, not rich text); DOWNSIDE assumed present in
  raw_row like UPSIDE (missing => 0 via _wb_to_number).
```

```
Session 6 — 2026-08-05 (cache-buster v=20260805c)
- User asked for: reframe the confusing signed Upside/Downside movement into
  intuitive Best Case / Worst Case ABSOLUTE totals, matching the app's
  existing Best/Worst Case columns.
- Delivered: sections.upside/downside REPLACED by sections.best_case /
  sections.worst_case (same shape). best_case = bu_fc + UPSIDE, worst_case =
  bu_fc + DOWNSIDE. _movement_section generalized to take a value_fn
  (lambda e: bu_fc + field); movers rank by per-account WoW change in the
  case value; mover rows now carry generic current_value/prior_value/delta.
  Frontend: KPI tiles "Best Case"/"Worst Case" (absolute compact $ + colored
  WoW using buDeltaColor) + "4 · Best Case movement" / "5 · Worst Case
  movement" cards via a shared caseCard helper. Export: matching KPI cards
  (now colored WoW via detailColor) + Best/Worst Case movement blocks
  (overall + per-region) via generalized moverTable. Delta-color convention
  = C/C: increase (more churn) = red, decrease = green (driver increase col
  is now red, decrease col green).
- Matches app's Best/Worst Case column definitions (BU_FC + UPSIDE / + DOWNSIDE).
- Verified: py_compile + node --check clean. Backend change ⇒ SERVER RESTART
  REQUIRED (section rename best_case/worst_case).
- Open question / TODO: none. Residual risk — assumes UPSIDE negative /
  DOWNSIDE positive per the data convention; if a row violates that, best/
  worst ordering for that account could invert (totals still correct).
```

```
Session 7 — 2026-08-05 (cache-buster v=20260805d)
- User asked for: fix notes export/import so the CS Call vs Renewals Call vs
  ELT split round-trips (bug: on import everything collapsed to ELT with no
  split).
- Root cause: EXPORT-only key mismatch. `confirmExport` in
  `public/vendor/app.js` (NotesIO) looked up the calls map with the 2-part
  NOTE key (`accountBase::period`) via `fcByAccount.get(k)`, but the calls
  map (`useAccountForecasts().byAccount`) is keyed by the 3-part CALL_KEY
  (`accountBase::period::roundedATR`). Every lookup missed, so every exported
  `csCall`/`renewalsCall` was null. IMPORT (`restoreCallsFromImport`) was
  already correct — it rebuilds the 3-part call_key from the matched row and
  PUTs `cs_forecast`/`renewals_forecast` SEPARATELY to the audited
  `PUT /api/renewals/account-forecasts/{account_id}` (ELT stays derived =
  cs+rn). So the "collapse to ELT" was really "export never embedded the
  split".
- Fix (frontend-only, `confirmExport`): rebuild the 3-part call_key the same
  way the inline editor/account card do — from the matched row via
  `RenewalsCallKeys.buildCallKey(row, hm, settings)`, or from the note's own
  metadata (`accountId`/`fq`/`atr`) via `buildCallKeyFromParts` when the note
  doesn't match the current dataset — then look up `fcByAccount.get(callKey)`.
  Now a note whose account has calls exports non-null `csCall`/`renewalsCall`
  and `eltCall = cs+rn`.
- Legacy `djForecast`-only notes (no cs/rn split): `csCall`/`renewalsCall`
  stay null, `djForecast` is carried verbatim (unchanged wire-key semantics),
  and `eltCall` now falls back to `djForecast` for reference only (documented
  in the export payload's `eltCallNote`). Import skips these in
  `restoreCallsFromImport` (filter requires csCall|renewalsCall non-null), so
  importing the user's legacy all-null file applies notes + the 20 djForecast
  ELT overrides WITHOUT wiping any real cs/rn call.
- Round-trip verified via a Node harness reusing the real
  `public/vendor/vibe-call-keys.js`: an account with CS+Renewals calls exports
  distinct csCall=500000/renewalsCall=250000/eltCall=750000, and import emits
  ONE PUT writing cs_forecast + renewals_forecast separately (call_key
  001ACME::FY27Q3::1320); a legacy djForecast-only note exports
  csCall/renewalsCall=null, eltCall=42000, and produces no PUT.
- Export/import JSON SHAPE unchanged (the `csCall`/`renewalsCall`/`eltCall`
  fields already existed; they're now correctly populated) and the
  `/api/renewals/*` contract is untouched. `node --check` clean. No Python
  change ⇒ NO server restart needed. Cache-buster bumped c → d.
- Open question / TODO: none. Residual notes — (1) the onboarding wizard's
  separate notes importer (`onNotesChange`, ~line 8629) still accepts only
  version 1 and does not restore calls; the primary NotesIO importer is the
  one that handles v2 + call restore. (2) Unmatched notes export/import their
  split using exported metadata parts, which round-trips only if the
  account_id/fq/atr still resolve to the same call_key.
```

```
Session 8 — 2026-08-05 (cache-buster v=20260805g)
- User asked for: fix a notes-import DATA-LOSS bug — a user bulk-deleted notes
  (tombstones with Date.now()), then re-imported the same JSON; every note was
  skipped and stayed deleted.
- Root cause: `importNotes` (`public/vendor/app.js`, ~line 2018) had a
  tombstone-skip guard `if (deleteTs && incomingTs <= deleteTs) return;`.
  Re-imported notes carry their ORIGINAL (older) updatedAt, so every key with
  a fresh tombstone was skipped → notes stayed deleted and re-synced as
  deletes.
- Fix (frontend-only, `importNotes`): (1) removed the tombstone-skip guard;
  (2) a file-import is now authoritative — for a key WITH a tombstone it always
  restores the note and clears the tombstone (`delete nextDeletes[k]`); (3) the
  restored note's top-level `updatedAt` is bumped to
  `max(incomingTs, deleteTs + 1, now)` so it STRICTLY beats both the local and
  any lingering SERVER tombstone through sync — the client merge skips a note
  when `tomb >= incomingTs`, and `migrateDeletesObject` prunes a tombstone only
  when `note.updatedAt > tombstoneTs`, so `deleteTs + 1` (not `deleteTs`) is
  load-bearing; (4) newer-wins preserved for keys with NO tombstone (guard
  `if (!hasTomb && next[k] && incomingTs < currentTs) return;`), so an import
  never downgrades a locally-newer edit. Note `history` is always preserved;
  only `updatedAt` is bumped.
- Server behavior (unchanged, confirmed): `note_tombstones` rows are never
  deleted server-side and are re-sent on every GET (`get_notes`), and the PUT
  never clears a tombstone — which is exactly why the client bump-to-beat is
  required. No Python change ⇒ NO server restart.
- Verified with a Node harness replaying the fixed reducer + the client
  server-merge + `migrateDeletesObject`: after re-import both notes are
  restored, the PUT payload's `noteDeletes` is EMPTY, updatedAt > deleteTs,
  history preserved; after a full server GET/merge with lingering server
  tombstones both notes survive and `noteDeletes` prunes to empty. Regression
  check: a plain bulk-delete (no import) still removes the note and sets its
  tombstone. `node --check` clean. Cache-buster f → g.
- localStorage backup (`STORAGE_NOTES_BACKUP_KEY`): only a fallback when the
  persisted notes object is EMPTY (~line 951); it doesn't clear tombstones, so
  it's not the recovery path here. Primary recovery = apply this fix, then
  re-import the file.
- Open question / TODO: none. Residual note — the server keeps tombstones
  forever; the client prunes them locally after a restore, but the server row
  persists (harmless, since the note's higher updatedAt always wins).
```

```
Session 9 — 2026-08-05 (cache-buster v=20260805h)
- User asked for: fix a slow main-page reload — even when the Active snapshot is
  unchanged, reload re-downloaded + re-parsed the ~9.7MB / ~50k-row Active CSV
  (15-20s) instead of hitting the IndexedDB cache.
- Root cause (evidence-based): NOT the idb-restore race. The reported
  "Downloading the latest Active from the server…" overlay is the REFRESH
  overlay, which only renders when `isRefresh` is true, i.e. cached data is
  ALREADY present (`stateRef.current.data.length > 0`, app.js ~1408) — so the
  data WAS restored from IDB and the auto-load's `idbReady` gate (app.js ~1310)
  already waited for it. The failing condition was the cache identity itself:
  the fast-path keyed off `uploaded_at` mtime (`info.mtimeMs <= cachedMs`,
  app.js ~1403; server `renewals.py` data-source/info derived mtime from
  `uploaded_at`). `uploaded_at`/`id` change on every re-materialize/re-upload
  even when the CSV BYTES are identical, so `info.mtimeMs > cachedMs` ⇒ needless
  re-download of unchanged content (suspect #3). Also hardened suspect #2
  (localStorage `meta` evicted while IDB data survives ⇒ `cachedMs` lost).
- Delivered: STABLE content-signature cache key = the upload's `sha256`.
  * Server (Python, additive): `_resolve_latest` now SELECTs `sha256`;
    `/data-source/info` returns additive `id` + `sha256` (frozen shape otherwise
    untouched).
  * Client (`public/vendor/app.js`): `importCSV`/`importHistoricalCSV` take a 4th
    `sourceSig` arg → store `meta.sourceSig` / `meta.historicalSourceSig` AND
    write a co-located `IDB_KEY_META`/`IDB_KEY_HIST_META` next to the cached rows
    so the identity can't diverge if localStorage is evicted (fixes #2). The IDB
    restore effect reads those meta keys and back-fills any missing
    uploadedAt/sig into `state.meta` (localStorage-newer value always wins, so an
    edit is never downgraded). Auto-load parses `info.sig` from data-source/info
    and passes it to import. New fast-path: if BOTH server+cache expose a sig,
    equal ⇒ cache hit (skip download) EVEN IF mtime moved; different ⇒
    re-download; if either sig is absent (old server / local file import / pre-sig
    cache) it falls back to the prior `mtimeMs <= cachedMs` tolerance. Configs
    gained `getCachedSig`.
- Guarantee: unchanged snapshot (identical bytes) always hits the cache
  regardless of a bumped `uploaded_at`; a genuinely changed snapshot has a
  different sha256 ⇒ still re-downloads (never serves stale). A stale/mismatched
  cached sig only ever causes a SAFE extra download, never stale data.
- Verified: `node --check public/vendor/app.js` + `python3 -m ast` on renewals.py
  clean; a Node harness replaying the exact predicate + the IDB-meta restore
  merge passed 9/9 scenarios (unchanged w/ bumped mtime → hit; changed sig →
  download; no-sig mtime fallback both directions; first load → download;
  localStorage-lost identity restored from IDB → hit; local-newer identity
  preserved). Untouched: idbReady gate/first-load retry, empty-state/NoDataBanner,
  "Restoring your session…" gate, Data-as-of/refresh flows, historical slot.
- Python changed ⇒ SERVER RESTART REQUIRED (new `id`/`sha256` in data-source/info;
  without it the client silently uses the mtime fallback). Cache-buster g → h.
- Open question / TODO: none. Residual notes — (1) manual local-file "Import CSV"
  has no server sha256, so it stores sig=null and uses the mtime fallback (prior
  behavior); (2) if a Snowflake "Run now" re-materializes with non-deterministic
  bytes (reordered rows / embedded run timestamp) the sha256 differs and it
  re-downloads — treated as "changed", which is the safe direction.
```

```
Session 10 — 2026-08-05 (cache-buster v=20260805j)
- User asked for: fix the in-app Settings (gear panel) Notes importer — the
  "Import Notes" button "flashed then disappeared" and "Export Notes (0)" read
  zero despite ~81 notes; the only working import was the /admin JSON page.
- Root cause of the flash: the DEAD mobile.html snapshot auto-rebuild feature.
  The removed `/api/renewals/mobile-snapshot` endpoint now 404s, but the client
  still auto-POSTed to it on EVERY data/notes change (a 4s-debounced effect),
  churning `snapshotStatus` (building→error) which was in the AppContext value,
  re-rendering the whole Settings modal and making the Import button flicker.
- Delivered (frontend-only, `public/vendor/app.js`): removed the feature
  end-to-end — the `snapshotStatus` state + `_snapshotAutoTimer`/`_lastSnapshotKey`
  refs, the auto-rebuild `useEffect`, the `buildMobileSnapshot` action, the
  `MobileSnapshot` component, the Settings "Mobile snapshot" UI block
  (Rebuild now / Show in Finder / "Auto-rebuilds mobile.html…"), and
  `snapshotStatus` from the context `value` memo (~314 lines removed). Left the
  rest of Settings (Export CSV, Export/Import Notes, Preferences, Background)
  and the generic `revealInFinder` action intact. No backend change (the route
  already 404s).
- Delivered (Export count): `NotesIO.totalNotes` was `Object.keys(notes).length`;
  now counts all `state.notes` keys MINUS tombstones
  (`Object.keys(notes).filter((k) => !noteDeletes[k])`), mirroring the
  orphan-aware `NotesHub`/`noteRows` logic, so the badge shows the real total
  (~81, including imported/orphan notes) and export includes them.
- Import button: `NotesIO`'s non-headless render (used by the Settings "Notes"
  section as `NotesIO, null`) unconditionally renders the hidden file input +
  "Import Notes" + "Export Notes (N)" buttons; it is NOT gated on note count.
  With the snapshot churn gone the panel stops re-rendering on data/notes
  changes, so the button stays put. The separate `NotesIO {headless:true}`
  mount only renders portals (background auto-match) and is unaffected.
- Verified: `node --check public/vendor/app.js` clean; grep confirms zero
  remaining `snapshotStatus`/`buildMobileSnapshot`/`MobileSnapshot`/
  `mobile-snapshot`/`mobile.html` references. Frontend-only ⇒ NO server restart.
  Cache-buster i → j.
- Open question / TODO: none. Residual note — export "all" mode still spreads
  `{ ...notes }`; since deleted notes are removed from `state.notes` on delete
  (only tombstones remain in `noteDeletes`), this already matches the new
  tombstone-excluding `totalNotes` in practice.
```

```
Session 11 — 2026-08-11
- User asked for: stop having to edit code every time a Snowflake connection
  value changes — set role back to PUBLIC AND make Account/Warehouse/Database/
  Schema/Role adjustable from the admin UI (persisted, no redeploy).
- Delivered: admin-editable Snowflake connection overrides persisted in
  `renewals_meta` under key `snowflake_config`.
  * warehouse.py: new `effective_conn(settings, overrides)` merges overrides
    over env/config defaults; `run_query_file`/`fetch_slot`/`refresh_all` take
    an `overrides` dict and connect with the effective account/warehouse/
    database/schema, pinning `role` only when non-empty (blank role => omit =>
    use the token user's default; ANY_ROLE_MODE=ENABLE).
  * routes/refresh.py: `_run_job` loads overrides via `_read_sf_overrides(db)`
    and passes them to `refresh_all`; `refresh-status.settings` now reflects
    the EFFECTIVE (merged) values; new owner-gated `GET/PUT
    /api/renewals/snowflake-config` (GET returns effective config + raw
    overrides + defaults; PUT stores a cleaned subset, role="" allowed to mean
    "omit").
  * admin.html: collapsible "Connection settings (editable — no redeploy)"
    form (5 inputs + Save) in the Run-now card; `loadSnowflakeConfig()` (GET,
    owner-init) populates it, `saveSnowflakeConfig()` PUTs then refreshes
    status. Code default `SNOWFLAKE_ROLE` stays `PUBLIC` (config.py).
- Verified: py_compile clean (warehouse/refresh/config); both new routes
  register (GET + PUT /api/renewals/snowflake-config). Python changed ⇒ SERVER
  RESTART REQUIRED (new endpoints + overrides plumbing).
- Open question / TODO: none. Residual note — App Foundry "Default role"
  preference still injects env `SNOWFLAKE_ROLE`; the DB override (admin UI)
  wins over it via `effective_conn`, so the UI is now the source of truth.
```

```
Session 12 — 2026-08-18 (cache-buster v=20260818b)
- User asked for: Pacing tab two-gauge layout (land vs full-quarter cap as
  headline; booked vs plan-to-date as realized) + concise ⓘ tooltips on
  every calc, and fix calc accuracy (headline was Expected vs linear
  plan-to-date, which painted Q3 red at ~19% elapsed).
- Delivered (frontend-only, `public/vendor/app.js` PacingTab): two KPI groups
  (Land vs cap: Expected / Full-qtr target / vs cap+Under|Near|Over cap;
  Realized so far: Booked / Plan-to-date / vs time+time-budget labels).
  Table reordered to Region | Target | Expected | vs cap | Cap pace |
  Booked | Plan-to-date | vs time | Remaining BU. Remaining BU kept as
  Expected sub-line + table column. kpi-info tips on KPIs, elapsed chip,
  100K+ header, and every calc table header (plus native title= for
  overflow-x clip). Headline Cap pace uses gapFull vs full target (Near
  cap = over by <5% of full target). Realized uses gapTime = booked −
  plan-to-date; elapsed=0 or plan-to-date=0 ⇒ "—" (no booked-vs-$0
  "behind"). Totals: Expected/Booked/Remaining still sum all 4 regions;
  vs-cap / vs-time / plan-to-date / Cap pace only include regions with a
  target; muted note lists missing targets. Other-region n>0 gets a muted
  note (not dumped into AMER). Booked 100K+ filter simplified to
  ATR >= PACING_ARR_FLOOR. Unused pctS removed. Remaining stays BU FC
  (not ELT); scope still ignores the Filters bar.
- Verified: node --check public/vendor/app.js clean. No Python change ⇒
  NO server restart. Cache-buster 20260818a → 20260818b. Zip rebuilt
  excluding github_cx, ingress.yaml, .git, .venv, __pycache__, zips,
  DS_Store.
- Open question / TODO: none. Residual risks — (1) if a region lacks a
  target, Expected KPI still includes it while vs-cap excludes it (note
  explains); (2) linear time only, no seasonality; (3) Other-region
  accounts are noted but never folded into the 4-region table.
```

```
Session 13 — 2026-08-19 (cache-buster v=20260819a)
- User asked for: (a) local Region multi-select on Pacing (next to Quarter);
  hide the global Filters bar on the Pacing tab; (b) reframe primary pacing
  as C/C Loss Budget Consumption vs calendar progress (not ATR/time or
  booked-vs-plan-to-date $).
- Delivered (frontend-only): Header hides `<Filters />` when
  `activeTab === "pacing"`. PacingTab adds `MultiSelect` region control
  (empty = all four; scopes KPIs + table). Primary row **C/C pace vs
  budget**: Budget consumed % = QTD C/C ÷ loss budget; Quarter complete
  %; Pacing gap (pp) = consumed − complete (negative = favorable);
  labels Favorable / Near pace / Unfavorable / Budget exhausted (100%+).
  Secondary row **Forward outlook (land vs cap)** (Expected / loss budget /
  vs cap). Table reordered for budget pace columns + forward outlook.
  Tooltips updated; target column renamed loss budget.
- Verified: node --check clean. No Python change ⇒ NO server restart.
  Cache-buster 20260818b → 20260819a. Zip rebuilt.
- Open question / TODO: paired forward-looking **Risk Resolution /
  Forecast Maturity** metric — discussed, not built this session.
```

```
Session 14 — 2026-08-19 (cache-buster v=20260819b)
- User asked for: (a) make realized vs outlook cohesive — don't grade
  Favorable when landing is over cap; (b) add % of ATR / book closed as a
  third clock next to budget consumed and quarter complete.
- Delivered (frontend-only, PacingTab): closed ATR now summed from
  historical 100K+ rows. **Book closed** = closed ATR ÷ (closed + pending
  ATR). Realized row: consumed / book closed / quarter complete / pacing
  gap. Projected row: Expected / projected consumption (Expected÷budget) /
  loss budget / vs cap. Compound **Status** (Favorable only if leftover BU
  also under leftover budget; else "Under-consuming · over cap"). Story
  banner + leftover BU vs leftover budget identity. Table columns match.
- Verified: node --check clean. No Python change. Cache-buster a → b.
  Zip rebuilt.
- Open question / TODO: none. Residual — current-quarter accounts in both
  active and historical CSVs would inflate book ATR if they are not a
  clean done-vs-pending split.
```

```
Session 15 — 2026-08-19 (cache-buster v=20260819c)
- User asked for: (a) collapse CS/RN/ELT on the account modal for
  non-current-quarter rows into Adjust call; (b) fix Book closed % (was
  50% because hist 100K+ ATR was treated as closed and active 100K+ as
  open — same book twice); (c) table ⓘ tooltips clipped by overflow-x.
- Delivered: AccountNoteModal keeps full call editor on current FY
  quarter; otherwise collapsed Adjust call (same fields, same Done/PUT).
  Book closed = Historical done ATR ÷ (done + open ATR) via isDoneDeal
  (LTG==0 OR DONE_DEAL), 100K+ / region / quarter — same split as
  Historical. Pacing tips portaled to document.body (kpi-info-js).
- Verified: node --check clean. Cache-buster b → c. Zip rebuilt.
- Open question / TODO: none.
```

```
Session 16 — 2026-08-19 (cache-buster v=20260819d)
- User asked for: (a) Pacing 100K+ must use the 100K+ Official band, not
  ATR ≥ $100K (Region ATR totals were not matching); (b) a Band filter on
  Pacing; (c) Region fiscal-quarter preview cards showed unfiltered
  sums/counts (4,086 / $293.8M vs 740 / $198.9M with Official on) — remove
  those preview numbers to reduce confusion.
- Delivered (frontend-only): Pacing pending + booked + book-closed now
  use matchesBand (default `100k_official` = BAND column). Local Band
  <select> next to Quarter/Region (same BAND_OPTIONS as Region). Quarter
  picker cards are FY labels only (no account chip, ATR/BU, bars, ELT).
- Verified: node --check clean. No Python change ⇒ NO server restart.
  Cache-buster c → d. Zip rebuilt.
- Open question / TODO: none.
```

```
Session 17 — 2026-08-19 (cache-buster v=20260819e)
- User asked for: Pacing loss-budget edits (e.g. AMER 1520000 → 15200000)
  revert on hard refresh / redeploy.
- Root cause: planning PUT peeked React state in the same tick as setState
  (still the old 1520000), matched the last saved payload, and skipped the
  write — Postgres kept the typo; refresh always re-applies remote.
- Delivered: schedulePlanningPut now peeks inside the 800ms flush (after
  React has committed); queue PUTs that happen before planning has loaded;
  pagehide keepalive flush. Frontend-only (`public/index.html`).
- Verified: no Python change ⇒ NO server restart. Cache-buster d → e.
- Open question / TODO: none. After deploy, re-enter 15200000 once and wait
  ~1s so the corrected value actually lands in Postgres.
```

```
Session 18 — 2026-08-19 (cache-buster v=20260819f)
- User asked for: account-modal Updates not capturing (type + Add/Enter,
  then Done) — LATAM Airlines example.
- Root cause: (1) Done saved noteDraft only, discarding text still in the
  composer; (2) Last-saved timestamp on that note is in the future
  (2029), so newer-wins on client + Postgres WHERE updated_at <=
  incoming dropped the 2026 save.
- Delivered: composer flushes into the note on Add and Done; Add is
  type=button and reads the live input; save timestamp is
  max(now, existing+1). Frontend-only.
- Verified: node --check clean. Cache-buster e → f.
- Open question / TODO: none.
```

```
Session 19 — 2026-08-19 (cache-buster v=20260819g)
- User asked for: Pacing projected landing as three replicated KPI rows
  (Best Case, BU FC, Worst Case), same glass tiles as today, not a new
  visual; missing UPSIDE/DOWNSIDE default to 0.
- Delivered: pending loop sums UPSIDE + DOWNSIDE (toNumber → 0 if blank).
  Remaining Best = BU+UPSIDE, Worst = BU+DOWNSIDE, landing = booked +
  remaining. Same 4-tile row (Expected / Projected % / Loss budget /
  vs cap) × 3. Banner + Status stay BU-based. Table replaces Expected +
  Projected % with Best Case / BU FC / Worst Case. Frontend-only.
- Verified: node --check clean. No Python change ⇒ NO server restart.
  Cache-buster f → g.
- Open question / TODO: none.
```

```
Session 20 — 2026-08-19 (cache-buster v=20260819h)
- User asked for: rename Pacing “Book closed” → “Closed renewal”.
- Delivered: KPI, table header, banner, intro, and footer copy. Math
  unchanged. Frontend-only.
- Verified: node --check clean. Cache-buster g → h.
- Open question / TODO: none.
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

**Import overrides tombstones (client-side).** A deliberate file-import via
`importNotes` (`public/vendor/app.js`) is *authoritative*: it always restores
a note even if a newer tombstone exists in `noteDeletes`, and it clears that
tombstone. Because the server keeps tombstones forever and re-sends them on
every GET, the restored note's top-level `updatedAt` is bumped to
`max(incomingTs, deleteTs + 1, now)` so it **strictly exceeds** the delete
time — that is the only way the note survives the client server-merge
(`tomb >= incomingTs` skip) AND gets its lingering tombstone pruned by
`migrateDeletesObject` (which drops a tombstone only when `note.updatedAt >
tombstoneTs`). Newer-wins is still honored for keys with NO tombstone (an
import never downgrades a locally-newer edit). Note `history` is always
preserved; only the top-level `updatedAt` is bumped. No server change is
needed for this recovery — it is purely client-side.

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
and the **shared filters** `region`, `sub_region`, `cs_manager`, `segment`,
`owner` (each `''`/`__ALL__` = all for that dimension) plus an ARR range
`arr_min`/`arr_max` (numeric, on `s.atr`). **Every filter is applied
server-side to EVERY section AND BOTH trend series** via the same
`($expr = $N)` pattern, so the whole brief is uniformly scoped. The
`available_*` option lists are computed UNfiltered (band + quarter only) so
the UI selectors stay fully populated. Each active dimension must be in the
frontend fetch params + effect deps or the sections/trend won't refresh.

**Frontend scope sourcing (as of Session 4):** the endpoint contract is
unchanged, but the Weekly Brief tab no longer has its own scope dropdowns.
It sources scope **entirely from the app's global Filters bar**
(`state.filters`): `region`/`segment`/`owner` are each passed only when
**exactly one** value is selected globally (0 or 2+ ⇒ that dimension is
"All"); `quarter` is passed only when exactly one global quarter is
selected (else the endpoint auto-picks the current fiscal quarter); `band`
is derived from `filters.band` (unset/`all`/100K-family ⇒ `100k+`, else the
global band verbatim). `sub_region` and `cs_manager` are **no longer sent**
(the global bar has no equivalent — the endpoint still accepts/ignores
them). The brief keeps only its own controls: current/prior snapshot
selectors and the large-mover threshold.

**Two trend series:** each trend point carries `total_bu_fc` (system
bottoms-up) AND `total_adjusted_fc` (the ELT / calls-adjusted total) plus
their `gap` (= adjusted − BU). The adjusted total applies, per in-scope
account, the latest call (`cs_forecast + renewals_forecast`) from
`account_call_events` whose `effective_date <= that snapshot's
effective_date` (as-of reconstruction), else falls back to `bu_fc`. Calls
are matched to snapshot accounts on `account_id` + `rounded_atr` +
**normalized quarter** (NOT the raw `call_key` string) because the stored
call_key encodes the quarter in the app's spelling (`FY27Q4`) while the
snapshot column uses another (`Q4\`27` / `QQ4\`27`). The match is one
`LEFT JOIN LATERAL` over the `(call_key, effective_date DESC)` index, bounded
by the already band+quarter+filter-scoped account set (a few hundred rows
across a handful of snapshots).

```json
{
  "ok": true, "slot": "active", "band": "100k+", "threshold": 50000.0,
  "region": "__ALL__",
  "filters": {"region": "__ALL__", "sub_region": "__ALL__", "cs_manager": "__ALL__",
              "segment": "__ALL__", "owner": "__ALL__", "arr_min": null, "arr_max": null},
  "available_regions": ["APAC"], "available_sub_regions": ["ANZ", "Asia", ...],
  "available_cs_managers": [...], "available_segments": [...], "available_owners": [...],
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
      "trend":   [{"upload_id": 1, "effective_date": "...", "total_bu_fc": 3907552.0,
                   "total_adjusted_fc": 4013050.6, "gap": 105498.6}, ...]
    },
    "worsened":     [{"account_id", "account_name", "region", "current_bu_fc",
                      "prior_bu_fc", "swing", "is_large",
                      "forecast_summary?", "renewals_studio_note?",
                      "explanation?", "explanation_source?"}],
    "new_forecast": [{... "current_bu_fc", "is_large",
                      "forecast_summary?", "renewals_studio_note?",
                      "explanation?", "explanation_source?"}],
    "best_case":  {"current_total", "prior_total", "delta", "delta_pct",
                   "top_increase": [...5], "top_decrease": [...5]},
    "worst_case": {"current_total", "prior_total", "delta", "delta_pct",
                   "top_increase": [...5], "top_decrease": [...5]}
  }
}
```

Semantics (must stay consistent with the dashboard):
* **BU_FC sign** — `bu_fc` is the forecasted churn/contraction amount
  (`CC% = BU_FC / ATR`). Higher = worse. **"Worsened WoW" = BU_FC
  increased**; `swing = current_bu_fc - prior_bu_fc`, kept when `> 0`,
  ranked descending. `new_forecast` = prior `bu_fc == 0` and current `> 0`.
* **Explanations are auto-pulled** for movers `>= threshold`, as TWO
  separate nullable fields (each truncated to `_EXPLANATION_MAX_CHARS`):
  `forecast_summary` (the account's current-snapshot forecast summary) and
  `renewals_studio_note` (the account's most recent saved app note, via
  `note_map[account_id]`). Each is present only when it has content. The UI
  and export render them as two clearly-labeled blocks ("Forecast Summary:"
  then "Last Renewals Studio Note:"), omitting any empty source; both empty
  shows nothing. The legacy single `explanation`/`explanation_source` fields
  are still emitted for back-compat (forecast_summary preferred, else note).
  No manual entry.
* **Best Case / Worst Case** are absolute forecasted-C/C totals matching the
  app's existing Best/Worst Case columns:
  `best_case = bu_fc + UPSIDE`, `worst_case = bu_fc + DOWNSIDE` (UPSIDE arrives
  negative, DOWNSIDE positive, so `best_case <= bu <= worst_case` — best case
  = least churn). UPSIDE/DOWNSIDE are read from `raw_row->>'UPSIDE'` /
  `raw_row->>'DOWNSIDE'`. Both sections share the same shape, built by one
  `_movement_section(value_fn)` helper where `value_fn(entry) = bu_fc + field`;
  `top_increase`/`top_decrease` rank accounts by per-account WoW change in the
  Best/Worst Case value (`current − prior`). **Delta-color convention (C/C):**
  an INCREASE in forecasted C/C = worse = red; a decrease = better = green —
  same as the BU/worsened coloring, applied to tiles, movement cards, and
  drivers in both the tab and the export. (The prior signed `upside`/`downside`
  movement sections were replaced by these.)

Additive and read-only — no schema change, frozen shapes untouched.
**Performance:** every per-snapshot read is filtered to band + quarter (+
shared filters) in SQL (~hundreds of rows), only the single `UPSIDE` key is
extracted from `raw_row` (never the whole JSONB blob), and the trend (BU +
adjusted) is one grouped query with a single indexed `LATERAL` per row over
the recent-snapshot window — safe for ~50k-row snapshots.

**Frontend (`WeeklyBriefTab` in `public/vendor/app.js`):** consumes the
app's shared `state.filters` (via `useApp()`) to seed region / segment /
owner / quarter defaults, exposes selectors for region / sub-region / CS
manager / segment / owner / quarter / band (populated from `available_*`),
renders an **"applied filters" removable-chip strip** reusing the Region
tab's `region-filter-chip*` classes, and draws a **dual-line trend** (BU vs
Adjusted, distinct colors + legend + per-point tooltips showing both values
and the gap) with a companion `Week · BU FC · Adjusted FC · Δ(Adj−BU)`
table. `generateWeeklyBriefHtml` mirrors the same amounts table + applied
filters in the downloadable brief. Chart/legend styles live with the other
`.wb-trend-*` rules in `public/index.html`.

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
