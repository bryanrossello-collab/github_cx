# Snowflake Migration Plan — Source Data from CSV → Snowflake (Pomerium/OAuth)

**Status:** DESIGN / PLANNING ONLY. No application code, config, or dashboard
behavior is changed by this document. This is a staged implementation plan plus
a list of questions to send to the platform / Snowflake admin team.

**Author context:** Renewals Studio v3 — FastAPI backend (`app/`), an unmodified
bundled React dashboard (`public/vendor/app.js`) served with a thin JS injection
layer, Cloud SQL Postgres via asyncpg, everything behind Pomerium.

**Goal:** Stop uploading CSVs. Instead, pull the dashboard's account / renewal
**source data** by querying a **Snowflake** database, authenticating each query
with a **federated OAuth Bearer token forwarded by Pomerium** — so Snowflake
governs row access by the signed-in user's own role. Do this with minimal blast
radius: the frozen endpoint contract and the compiled React app should need
zero (or near-zero) change.

> **DECISION UPDATE (2026-07-30) — read this before the sections below.** The
> active Snowflake query takes **~2 minutes** to run, so it is **not** executed
> live on page load. The data path is now a **scheduled background refresh**:
> the query runs out-of-band and writes results into the existing
> `account_snapshots` Postgres table; the dashboard keeps reading Postgres, so
> page loads stay instant. This is **"Option A" from the freshness discussion**
> (reuse the existing fast read path; automate the front of the pipeline that
> CSV upload used to feed).
>
> **Consequence for auth:** a scheduled/background job has **no logged-in user**,
> so it **cannot** use the per-user forwarded Okta/Pomerium OAuth token (that
> only exists on interactive requests). The refresh job therefore uses a
> **Snowflake service account with key-pair (RSA) authentication** (**DECIDED /
> approved 2026-07-30**), with the private key injected as a **secret env var**
> (mirroring the `DB_*` precedence/`AliasChoices` pattern — never a credentials
> UI, honoring `AGENTS.md`). The per-user OAuth design described in §2–§4 and §0
> is **retained only as an optional future "interactive per-user live query"
> feature**, not the main data pipeline. **The current data-load design lives in
> the new
> [§2.5 Data refresh architecture (scheduled)](#25-data-refresh-architecture-scheduled--current-decision).**
>
> **FINALIZED DECISIONS (2026-07-30):**
> - **Cadence:** run **once per day, early AM** (can be shortened later if fresher
>   data is needed).
> - **Scheduler:** **external trigger** — Cloud Scheduler → token-protected
>   `POST /api/renewals/refresh` (in-process timers are unsafe on Cloud Run).
> - **Admin "Refresh now":** **yes** — background, non-blocking.
> - **"Data as of" freshness indicator on the main screen:** **yes** — show the
>   last successful refresh timestamp.
> - **Service-account key-pair auth:** **approved.**
> - See the finalized-decisions record in **[§12](#12-decisions-finalized-2026-07-30)**.

---

## 0. Questions for the platform / Snowflake admin team (answer these first)

These gate the whole design. The A-vs-B token decision and the security
integration SQL cannot be finalized until they're answered.

### 0.0 Answers received — Platform / Pomerium team (2026-07-16)
- **Q1 — `pass_identity_headers`:** Enabled platform-side. Our app must add
  this annotation to its ingress so Pomerium injects the tokens:

  ```
  ingress.pomerium.io/set_request_headers: |
      x-pomerium-idp-id-token: ${pomerium.id_token}
      x-pomerium-idp-access-token: ${pomerium.access_token}
  ```

- **Q2 — token type:** Real JWT. ✅ Snowflake can validate the signature.
- **Q3 — audience:** `aud = "api://appfoundry"` is stamped into every Foundry
  token, and the Snowflake External OAuth integration is already configured
  with that audience on the **Snowflake side**. We do NOT set `aud` anywhere in
  the app — we just forward the token.
  ⚠️ **Caveat:** the integration was reportedly only set up on the
  **`ZENDESK-GLOBAL`** Snowflake account, so the app must connect to that
  account, and the renewals data must be queryable from it.
- **Q4 — egress:** Snowflake is allowlisted on the platform egress proxy. ✅

**Impact:** Option A is confirmed; **Option B (Pomerium native JWT) is moot** —
no need to check the dev JWKS reachability. Forward the Okta token whose `aud`
is `api://appfoundry` (almost certainly the **access token**,
`X-Pomerium-Idp-Access-Token`; if Snowflake rejects it, try the ID token
`X-Pomerium-Idp-Id-Token`). Questions 1–2 in §0.1 are now resolved. Still
**blocked** on the Snowflake-admin answers in §0.3 (user mapping/provisioning)
and §0.4 (account locator / warehouse / DB / schema / table + column list +
active-vs-historical), plus §0.5 sizing — and confirming the renewals data is
in `ZENDESK-GLOBAL`.

### 0.1 Token reachability / issuer (blocking)
1. **Is the Pomerium dev JWKS URL publicly reachable from Snowflake?**
   Snowflake Cloud is external SaaS; it must fetch the JWKS over the public
   internet to verify token signatures. Can Snowflake reach
   `https://authenticate.idp.dev.zenai-apps.com/.well-known/pomerium/jwks.json`?
   If that host is only resolvable inside the corp network / cluster, **Option B
   (Pomerium native JWT) is impossible** and we must use Option A (Okta), whose
   JWKS (`https://zendesk.okta.com/oauth2/aus1bum4d0pyllBSy2p8/v1/keys`) is
   internet-reachable.
2. **Is the forwarded token a real JWT or an opaque token?** Snowflake External
   OAuth requires a **JWT** (it validates the signature against JWKS). A custom
   Okta authorization server (`aus…` in the issuer path, as in the README) issues
   JWT access tokens. The Okta **org** authorization server issues **opaque**
   access tokens that Snowflake cannot validate. Confirm the access token from
   `X-Pomerium-Idp-Access-Token` is a JWT; if not, we must use the **ID token**
   (`X-Pomerium-Idp-Id-Token`, always a JWT) or Pomerium's own JWT.

### 0.2 Audience (blocking)
3. **What is the token's actual `aud` claim?** Snowflake matches it against
   `EXTERNAL_OAUTH_AUDIENCE_LIST`. We need the exact audience value(s) for the
   chosen token (Okta access token `aud` is usually the authz server's audience
   / API identifier; ID token `aud` is the client ID; Pomerium JWT `aud` is the
   route hostname). Wrong audience = every query rejected.

### 0.3 User mapping (blocking → NOW OPTIONAL for the data-load path)
> **Note (2026-07-30):** Q4–Q5 below governed the **per-user OAuth** design. Under
> the scheduled-refresh decision (§2.5) the data load runs as a **single service
> account**, so **per-user provisioning in Snowflake is NOT required** — this
> mirrors today's CSV behavior, where one upload pulls **all** rows into Postgres
> regardless of viewer and the app's own auth / tab-access governs visibility.
> Keep Q4–Q5 only if the optional interactive per-user live-query feature is
> pursued later.

4. **Which claim identifies the user, and does it map to a real Snowflake user
   attribute?** Snowflake maps `EXTERNAL_OAUTH_TOKEN_USER_MAPPING_CLAIM`
   (e.g. `email`, `upn`, `sub`) → `EXTERNAL_OAUTH_USER_MAPPING_ATTRIBUTE`
   (`EMAIL_ADDRESS` or `LOGIN_NAME`). Confirm the chosen token carries a claim
   (`email` / `upn`) whose value equals a provisioned Snowflake user's
   `EMAIL_ADDRESS` or `LOGIN_NAME`.
5. **Are all dashboard users provisioned in Snowflake with role grants?**
   Per-user OAuth (our recommendation) requires every viewer to exist as a
   Snowflake user with a default role that can `SELECT` the renewals data. Who
   owns that provisioning, and is there an existing group/SCIM sync from Okta?

### 0.4 Data + account shape (blocking for the query layer)
6. **What are the Snowflake account locator, warehouse, database, schema, and
   the table/view name** that holds the renewals book? (These become env vars.)
7. **What is the column list of that table/view**, and does it match (or can a
   view alias it to) the header names the dashboard expects (see §3.2)? We need
   the projection to emit `CRM_ACCOUNT_ID`, `ATR_ARR_USD_STARTING`, `BU_FC`,
   `YEAR_QUARTER`, `CRM_HEALTH_STATUS`, `PRO_FORMA_MARKET_SEGMENT`, `REGION`,
   `NEXT_RENEWAL_DATE`, `CRM_SUCCESS_OWNER_NAME`, `UPSIDE`, `DOWNSIDE`,
   `DICTATED_BY`, etc.
8. **Is there an "active" vs "historical" distinction in Snowflake** (a column,
   a separate table, or a snapshot/as-of date), so we can preserve the two slots
   the dashboard requests?
9. **Row volume per query** (the current active book is ~24K rows; the client
   short-circuits >40K). Does a single tenant/role ever exceed tens of thousands
   of rows? This drives pagination vs. streaming (see §8).

### 0.5 Network / cost
10. **Egress:** can the app's pod reach `*.snowflakecomputing.com` (the README's
    manual-deploy note calls out an egress firewall allowance)?
11. **Warehouse sizing / auto-suspend:** which warehouse, what auto-suspend, and
    is per-user-per-request connection acceptable cost-wise? (For the scheduled
    refresh this is much cheaper: **once per day, early AM** — a single ~2-min
    query per day, not one per page load.)

### 0.6 Service account + key-pair auth (REQUIRED for the scheduled refresh — APPROVED 2026-07-30)
> **This is the current, primary ask for the data-load path (see §2.5).** The
> **service-account + key-pair model is DECIDED / approved** (2026-07-30); the
> items below are the concrete provisioning requests for the admin team.

12. **Create a Snowflake service user** in the **`ZENDESK-GLOBAL`** account for the
    Renewals Studio refresh job, authenticated with **key-pair (RSA)** — we will
    generate the keypair and hand you the **public** key to set on the user
    (`ALTER USER … SET RSA_PUBLIC_KEY='…'`); the **private** key is injected into
    the app as a secret env var and never leaves the platform (no credentials UI,
    per `AGENTS.md`).
13. **Grants for that service user:** a default **role** with `USAGE` on a
    **warehouse** (small, aggressive auto-suspend is fine) and `USAGE` on the
    database/schema(s) plus **`SELECT`** on the source tables/views in §8.5.1
    (`FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD`,
    `CLEANSED.SALESFORCE.*`, `CLEANSED.GAINSIGHT.*`,
    `FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED`,
    etc.). Because the job pulls the **whole book** (like today's CSV), no
    row-level per-user governance is needed on this account.
14. **Connection identifiers for the service user:** account identifier,
    warehouse, role, database, schema (these become the `SNOWFLAKE_*` env vars in
    §6). Same details as §0.4, but bound to the service account rather than a
    per-user login.
15. **Scheduler placement — DECIDED = external trigger (2026-07-30):** Cloud
    Scheduler → a **token-protected `POST /api/renewals/refresh`** endpoint,
    fired **once per day in the early AM**. (In-process timers are unsafe on
    Cloud Run — see §2.5.5.) Please **confirm the platform provides/permits Cloud
    Scheduler** (or an equivalent external cron) that can reach the service URL
    with a bearer/shared secret. (Egress to `*.snowflakecomputing.com` is already
    ✅ per §0.0 Q4.)

> **Recommendation (updated 2026-07-16 — CONFIRMED):** Use **Option A
> (forwarded Okta token)**. The platform confirmed the token is a real JWT with
> `aud=api://appfoundry`, the Snowflake integration is already configured for
> that audience, and egress is allowlisted — so **Option B is no longer under
> consideration**. Forward the token carrying `aud=api://appfoundry` (likely the
> **access token**). Keep **per-user identity passthrough** (no service account).
> Remaining blockers are Snowflake-side: user mapping/provisioning (§0.3) and
> the account/table/column details (§0.4), plus confirming the data lives in
> `ZENDESK-GLOBAL`.

> **⚠️ SUPERSEDED FOR THE DATA-LOAD PATH (2026-07-30).** The recommendation above
> (per-user forwarded OAuth) still holds **only** for a hypothetical future
> *interactive per-user live-query* feature. Because the active query takes
> **~2 minutes**, the data pipeline is now a **scheduled background refresh** with
> **no logged-in user**, which cannot forward a per-user token. The refresh job
> uses a **Snowflake service account with key-pair auth** instead — see
> **[§2.5 Data refresh architecture (scheduled)](#25-data-refresh-architecture-scheduled--current-decision)**
> and the new service-account request in **§0.6**. The user-mapping /
> per-user-provisioning questions (§0.3 Q4–Q5) and the audience/token-type
> questions (§0.1–§0.2) are **now optional for the data-load path** — they matter
> only if the interactive per-user feature is later pursued.

---

## 1. Current CSV data path (as-is) — cited

### 1.1 Ingest (upload)
- `POST /api/renewals/upload-csv` — `app/routes/renewals.py:743`. Owner-only
  (`Depends(require_owner)`, `app/routes/renewals.py:749`). Accepts
  `text/csv`, `application/octet-stream`, `application/zip`, or
  `multipart/form-data`; unzips server-side if needed
  (`app/routes/renewals.py:801`). Resolves the slot (`active` / `historical`)
  from `?slot=` or filename substrings `"2026 data"` / `"historical fy27"`
  (`app/routes/renewals.py:812`).
- Stores the raw bytes into `csv_uploads` (BYTEA `content`) —
  `INSERT` at `app/routes/renewals.py:833`.
- Immediately parses into `account_snapshots` via
  `db.ingest_snapshot(...)` — `app/routes/renewals.py:849`.

### 1.2 Server-side parse
- `app/ingest.py` — `parse_csv()` (`app/ingest.py:184`) maps CSV headers to a
  canonical set via `HEADER_ALIASES` (`app/ingest.py:36`), coerces types, and
  **also keeps the full original row as `raw_row` JSONB** so unmodeled columns
  round-trip (`app/ingest.py:226`). Column tuple order is `SNAPSHOT_COLUMNS`
  (`app/ingest.py:279`).
- `Database.ingest_snapshot()` — `app/database.py:771`. Idempotent: deletes
  existing rows for the `csv_upload_id`, then `copy_records_to_table(
  "account_snapshots", ...)` (`app/database.py:813`).

### 1.3 Storage (Postgres)
- `csv_uploads` — raw bytes + slot + sha + history, `migrations/001_init.sql:79`.
- `account_snapshots` — typed columns **plus `raw_row` JSONB**,
  `app/database.py:115` (defined in the migration embedded there). `raw_row`
  is the authoritative shape the dashboard consumes.

### 1.4 Serving
- `GET /api/renewals/parsed-data?slot=` — `app/routes/renewals.py:472`. Resolves
  the newest upload for the slot (`app/routes/renewals.py:491`), ingests on
  demand if snapshots are missing, then returns
  `{ ok, rows, headers, ... }` where `rows` = deduped `raw_row` dicts
  (`app/routes/renewals.py:565`). **Large-dataset short-circuit:** when the row
  count exceeds `MAX_PARSED_DATA_ROWS = 40000` (`app/routes/renewals.py:469`),
  it returns `rows: []` with a note, so the client falls back to raw CSV
  (`app/routes/renewals.py:546`).
- `GET /api/renewals/data-source/info?match=` — `app/routes/renewals.py:368`.
- `GET /api/renewals/data-source/file?match=` — streams BYTEA as
  `text/csv` (`app/routes/renewals.py:591`).
- `GET /api/renewals/csv-list` — `app/routes/renewals.py:298`.
- Legacy `GET /apps/renewals/{filename}` — `app/routes/renewals.py:616`.

### 1.5 Client-side consumption
- `public/vendor/vibe-server-data.js` monkeypatches `window.fetch`
  (`public/vendor/vibe-server-data.js:90`). It intercepts CSV file fetches
  (`/api/renewals/data-source/file` or `/apps/renewals/`,
  `public/vendor/vibe-server-data.js:23`), redirects to
  `/api/renewals/parsed-data?slot=…` (`public/vendor/vibe-server-data.js:101`),
  and if `rows` is non-empty, pushes them straight into the React store via
  `window.__renewalsActions.importCSV` / `importHistoricalCSV`
  (`public/vendor/vibe-server-data.js:59`). A `Papa.parse` sentinel
  (`public/vendor/vibe-server-data.js:76`) no-ops the client parse in that case.
- **If `parsed-data` returns empty rows** (the >40K short-circuit) or errors,
  the interceptor falls through to the original raw-CSV fetch
  (`public/vendor/vibe-server-data.js:103`, `:108`), and the compiled app parses
  the CSV client-side with Papaparse (`streamParseCSV`,
  `public/vendor/app.js:235`).
- The dashboard scripts load in order in `public/index.html:2413`–`:2426`
  (`vibe-server-data.js` at `public/index.html:2422`).

### 1.6 The row-shape contract (what Snowflake output MUST reproduce)
The dashboard consumes **row objects keyed by the original CSV header names**
(uppercased/underscored by `normalizeHeader`, `public/vendor/app.js:210`).
`buildHeaderMap` (`public/vendor/app.js:327`) resolves each logical field to
whichever header alias is present, using `FIELD_KEYS`
(`public/vendor/app.js:175`). So the query output columns must match one of the
accepted aliases per field. The **primary aliases** (first in each list) are the
safest target:

| Logical field | Primary header the query should emit | FIELD_KEYS ref |
| --- | --- | --- |
| Account ID | `CRM_ACCOUNT_ID` | `app/vendor/app.js:180` |
| Account name | `CRM_ACCOUNT_NAME` | `:179` |
| Year/quarter | `YEAR_QUARTER` (`YYYYQQ`) | `:176` |
| ATR (starting ARR) | `ATR_ARR_USD_STARTING` | `:181` |
| ATR LTG | `ATR_ARR_USD_LTG` | `:182` |
| FC remaining | `FC_REMAINING` | `:183` |
| BU forecast | `BU_FC` | `:185` |
| Net ARR prior qtr | `NET_ARR_USD_PRIOR_QTR_END` | `:184` |
| Region | `REGION` | `:186` |
| Country | `BILLING_COUNTRY` | `:187` |
| Market segment | `PRO_FORMA_MARKET_SEGMENT` | `:188` |
| Subregion | `PRO_FORMA_SUBREGION` | `:189` |
| Health | `CRM_HEALTH_STATUS` | `:190` |
| Next renewal date | `NEXT_RENEWAL_DATE` | `:191` |
| Largest renewal date | `LARGEST_RENEWAL_DATE` | `:192` |
| Forecast summary | `FORECAST_SUMMARY` | `:193` |
| Dictated by | `DICTATED_BY` | `:194` |
| CS owner | `CRM_SUCCESS_OWNER_NAME` | `:195` |
| CS manager | `MANAGER_SUCCESS` | `:207` |
| Partner | `PARTNER` | `:196` |
| Partner type | `PARTNER_TYPE_C` | `:197` |
| Product lines | `PRODUCT_LINES` | `:198` |
| Top-3K flag | `FLAG_3K` | `:199` |
| CC | `CC` | `:200` |
| CC offcycle | `CC_OFFCYCLE_ARR` | `:201` |
| Expansion | `EXPANSION` | `:202` |
| Done deal | `DONE_DEAL` | `:203` |
| Upside | `UPSIDE` | `:204` |
| Downside | `DOWNSIDE` | `:205` |
| Band | `BAND` | `:208` |

`DROPPED_COLUMNS` (`public/vendor/app.js:214`) are stripped client-side
regardless, so the query need not emit them (harmless if it does):
`QTD_CC, FC_ONCYCLE, FC_OFFCYCLE, TERM_GROUPED, CRM_OWNER_NAME,
CRM_RENEWAL_OWNER_NAME, MANAGER_RENEWAL, RAMP_DEAL, AUTO_RENEW`.

> **This table is the contract.** The Snowflake `SELECT` projection (see §7)
> must alias every column to the matching header above. Reproduce it exactly and
> the compiled React app and every `/api/renewals/*` shape keep working
> unchanged.

### 1.7 What must NOT move (stays in Postgres)
These are **app-generated write state**, not source data. They stay in Postgres,
untouched:
- **Notes** — `notes` table, `GET/PUT /api/renewals/notes`
  (`app/routes/renewals.py:129`, `:155`). Wire key `djForecast` preserved.
- **Tombstones** — `note_tombstones`.
- **Account call events** — `account_call_events`, the CS/Renewals/ELT forecast
  history (`app/routes/renewals.py:937`+).
- **Quarter calls, planning data, tab access, users** — all `renewals_meta` /
  `users` state.

Only the **account/renewal SOURCE data** (`csv_uploads` + `account_snapshots`
content that feeds `/parsed-data` and `/data-source/*`) is what moves to
Snowflake.

---

## 2. Target architecture (to-be)

> **⚠️ SUPERSEDED FOR THE DATA-LOAD PATH (2026-07-30).** The per-request,
> per-user Snowflake query architecture in this section applies **only** to a
> possible future *interactive per-user live-query* feature. Because the active
> query takes **~2 minutes**, the actual data pipeline is the **scheduled
> background refresh in [§2.5](#25-data-refresh-architecture-scheduled--current-decision)**,
> which writes into `account_snapshots` and keeps `/api/renewals/parsed-data`
> reading Postgres exactly as it does today. Read §2.5 as the current design; keep
> this section as reference/history.

```
Browser (unchanged React app + vibe-server-data.js)
   │  GET /api/renewals/parsed-data?slot=active   (unchanged URL & shape)
   ▼
FastAPI  app/routes/renewals.py
   │  if SOURCE_BACKEND == "snowflake": ──► app/snowflake.py
   │       query with caller's forwarded OAuth token (per request)
   │       map result rows ──► same raw_row-style dicts + headers
   │  else: existing Postgres/csv_uploads path (unchanged)
   ▼
Snowflake (External OAuth security integration; row access by user's role)
```

**New module `app/snowflake.py`:**
- Opens a **per-request** connection using the caller's forwarded token:
  `snowflake.connector.connect(authenticator='oauth', token=<jwt from header>,
  account=…, warehouse=…, database=…, schema=…, role=…)`.
- Runs the projection query (§7), fetches rows as dicts, and maps them into the
  **same header-keyed row objects** `/parsed-data` already returns (§1.6).
- Runs **in a threadpool** (§4) because the connector is synchronous.
- Never stores a token or a secret anywhere.

**Where the re-point happens (minimal edits):**
- `parsed-data` (`app/routes/renewals.py:472`) gains a branch: when the source
  backend is Snowflake, call `app/snowflake.py` instead of resolving
  `csv_uploads` / `account_snapshots`. It still returns
  `{ ok, rows, headers, slot, … }` so `vibe-server-data.js` is unchanged.
- `data-source/info` (`:368`) returns a synthetic "found" descriptor pointing at
  `directory: "snowflake:<db>.<schema>.<table>"` so the client's interceptor
  still triggers the `/parsed-data` redirect.
- `data-source/file` (`:591`): either (a) synthesize CSV bytes from the query on
  demand for the raw-fallback path, or (b) rely on `parsed-data` always
  returning rows (preferred; see §8 pagination). Decide based on Q9 row volume.
- `csv-list` (`:298`): return a single synthetic entry per slot so the UI's file
  list still renders.

**Identity model:** the token belongs to the signed-in user, so Snowflake
governs which rows they can see by their Snowflake role. This matches the app's
existing per-user identity model (`app/auth.py`).

---

## 2.5 Data refresh architecture (scheduled) — CURRENT DECISION

**This is the design we are building for the data-load path.** It supersedes the
per-user live-query model (§2–§4) for loading source data.

### 2.5.1 Why scheduled, not live

The **active** production query takes **~2 minutes** to run. Running it on page
load would make the dashboard unusable and re-introduce latency the app was
built to avoid. Instead we keep today's **fast read path** (dashboard →
`/api/renewals/parsed-data` → `account_snapshots` in Postgres) completely
unchanged, and only **automate the front of the pipeline** that a manual CSV
upload used to feed. The query runs **out-of-band**; the dashboard never waits on
Snowflake.

```
Cloud Scheduler (external, DECIDED)      ── once daily, early AM ──┐
   │  POST /api/renewals/refresh  (token-protected)               │
   ▼                                                              ▼
FastAPI  app/routes/renewals.py ──► app/snowflake.py (KEY-PAIR service acct)
   │  run active + historical queries in a THREADPOOL (~2 min each)
   │  map rows ──► same raw_row-style dicts + headers (§1.6)
   ▼
db.ingest_snapshot(...) ──► NEW version rows in csv_uploads/account_snapshots
   ▼
Postgres (account_snapshots)  ◄── dashboard reads this, instantly, as today
```

### 2.5.2 What the refresh job does

- Authenticates to Snowflake as a **service account using key-pair (RSA) auth**
  (see §2.5.4) — **no logged-in user, no forwarded OAuth token**.
- Runs **both slots**: the `active` and `historical` parameterized queries from
  §8.5 (`sql/active_dynamic.sql`, `sql/historical_dynamic.sql`) with default
  binds, so the output tracks the current quarter automatically.
- Maps each result set into the **same header-keyed row objects** `/parsed-data`
  already returns (§1.6), then writes them through the **existing ingest / upsert
  path** (`db.ingest_snapshot(...)`, `app/database.py:771`) into
  `account_snapshots`.
- **Each run creates a new snapshot version per slot**, consistent with today's
  `csv_uploads` / `account_snapshots` versioning: the serving endpoints already
  resolve the **newest** upload per slot, so the dashboard automatically picks up
  the latest refresh with **zero** endpoint/React changes.
  - *Decision to lock (see §2.6):* either (a) serialize the query rows to CSV
    bytes and reuse the full `upload-csv` → `ingest_snapshot` path verbatim (max
    reuse, keeps a raw artifact per run), or (b) call `ingest_snapshot` with the
    row dicts directly against a synthetic `csv_uploads` version row. Both keep
    the newest-per-slot semantics; (a) is closest to today's behavior.
- **Untouched:** Notes (`notes`), tombstones (`note_tombstones`), and
  `account_call_events` stay live in Postgres — they are app-generated write
  state (§1.7), never sourced from Snowflake, and this job does not touch them.

### 2.5.3 Cadence and an admin "Refresh now" trigger

- **Cadence — DECIDED = once per day, early AM.** A single ~2-min run per day on a
  small warehouse is very cheap, and the source book does not change
  minute-to-minute. *(Cadence can be shortened later — e.g. twice daily or every
  few hours — if fresher data is ever needed; the same endpoint just gets called
  more often.)*
- **Admin "Refresh now" — DECIDED = yes (include it).** A token-gated endpoint
  (owner-only, alongside the existing `/admin` affordances) that **kicks off the
  refresh in the background and returns immediately** (e.g. `202 Accepted`). It
  must **never block a user request** — enqueue the job onto the same
  threadpool/background task and report status via a lightweight "last refresh"
  record, not by holding the HTTP response for ~2 minutes.

### 2.5.4 Auth model: service account + key-pair (RSA) — DECIDED / APPROVED

- **DECIDED (2026-07-30):** the service-account + key-pair model is **approved**.
  The details below are the confirmed design, not a proposal.
- Use **`snowflake-connector-python`** with **key-pair authentication**
  (`private_key=…`), **not** `authenticator='oauth'`. A background job has no user
  token to forward.
- The **private key is injected as a secret env var** (with an optional
  passphrase), following the same `AliasChoices` / `DB_*`-precedence pattern in
  `app/config.py` — **never a credentials UI, never persisted to disk** (honors
  `AGENTS.md` anti-patterns #1–#3). The matching **public** key is set on the
  Snowflake service user by the admin team (§0.6).
- **Why this does not violate the project's "no stored creds" rules:** the key is
  an **injected platform secret**, exactly like `DB_PASSWORD` today — it is not
  entered through a UI, not written to the filesystem, and not baked into the
  image. See the reconciliation in §4.
- **Governance parity with today:** the current CSV load already pulls the
  **entire book** into Postgres regardless of who is viewing, and the app's own
  auth + tab-access rules (`app/auth.py`) govern what each user sees. A single
  service account reproduces exactly this behavior, so **per-user row governance
  in Snowflake is unnecessary** and we do **not** need to provision every
  dashboard user in Snowflake.

### 2.5.5 Scheduler placement — DECIDED = external trigger

**DECIDED (2026-07-30): external trigger via Cloud Scheduler →
`POST /api/renewals/refresh`.** Fired **once per day, early AM** with a shared
secret / bearer token injected as env.

**Rationale (kept):** **do not use an in-process timer.** Cloud Run can **scale
to zero** (no instance running when the timer should fire) and can run **multiple
instances** concurrently (duplicate/overlapping runs). The external trigger runs
regardless of user traffic, has a single well-defined caller, is easy to secure,
and Cloud Run wakes an instance to service it — keeping all mapping/ingest logic
in one place (the app).

- **Rejected alternative — Snowflake-side schedule (task):** a Snowflake `TASK`
  runs the query on a schedule and writes to a location the app polls/reads. It
  keeps compute in Snowflake but adds a hand-off surface and still needs the app
  to ingest, so it was not chosen.
- **Only platform confirmation needed:** that Cloud Scheduler (or an equivalent
  external cron) is available and permitted to call the service URL (§0.6 Q15).

### 2.5.6 Async / non-blocking (reuse §5)

The connector is **synchronous**. The refresh **must run in a threadpool**
(`run_in_threadpool` / a bounded `ThreadPoolExecutor`) so the ~2-min query does
**not** block the async event loop or starve the asyncpg-backed notes/calls
endpoints. Set connector `login_timeout` / `network_timeout` /
`statement_timeout` generously (the query legitimately runs ~2 min) but bounded,
so a stuck warehouse fails cleanly rather than hanging a worker. See §5 for the
full treatment — it applies verbatim to the refresh job.

### 2.5.7 "Data as of" freshness indicator (main screen) — DECIDED = yes

Because the dashboard now shows data as of the **last successful refresh** (not
live), the main screen displays a **freshness indicator** so users always know
how current the data is.

- **UX / verbiage (best practice):** show an absolute timestamp in the user's
  locale, e.g. **"Data as of Jul 30, 2026 5:04 AM"**, placed unobtrusively in the
  topbar/header. **On hover**, optionally show a **relative** form
  (e.g. *"Updated 3h ago"*) and/or the exact timezone. If a refresh is currently
  running, it may show *"Refreshing…"*; if the last refresh **failed**, show the
  last good timestamp plus a subtle warning (e.g. *"last refresh failed"*).
- **Data source:** read the **latest snapshot's effective/loaded timestamp** from
  the existing snapshot pipeline — i.e. the newest `account_snapshots` version's
  load time (or the corresponding `csv_uploads.uploaded_at` / an `app_meta`
  "last refresh" record, whichever the pipeline already records). The refresh job
  should **stamp a "last successful refresh" record** (timestamp, per-slot row
  counts, status) at the end of each run so this is authoritative rather than
  inferred.
- **Delivery:** surface it via a small **read-only endpoint** (e.g.
  `GET /api/renewals/refresh-status` → `{ last_refresh_at, slots: {...}, status }`)
  that the dashboard's injection layer reads and renders. No credentials, no
  writes — consistent with `AGENTS.md`. This pairs naturally with the read-only
  "Snowflake source status" panel already envisioned for the admin page (§9).

---

## 2.6 What's needed to build (scheduled refresh)

### (a) Decisions — FINALIZED 2026-07-30 (see §12)
- [x] **Service-account key-pair auth — APPROVED.** Create a Snowflake service
      user with RSA key-pair in `ZENDESK-GLOBAL`; inject the private key as a
      platform secret. (§2.5.4, §0.6)
- [x] **Cadence — once per day, early AM** (can be shortened later if needed). (§2.5.3)
- [x] **Admin "Refresh now" — yes**, token-gated, background/non-blocking. (§2.5.3)
- [x] **Scheduler placement — external trigger** (Cloud Scheduler → token-protected
      `POST /api/renewals/refresh`); only platform availability needs confirming.
      (§2.5.5, §0.6 Q15)
- [x] **"Data as of" freshness indicator — yes**, on the main screen. (§2.5.7)

**Still open (implementation-time only):**
- [ ] **Snapshot write style** — serialize query rows to CSV bytes and reuse the
      `upload-csv` → `ingest_snapshot` path, **or** ingest row dicts directly into a
      synthetic `csv_uploads` version. *Recommended default: (a) serialize to CSV
      bytes* — it reuses today's exact path verbatim and keeps a raw per-run
      artifact for audit/rollback, at the cost of a serialize/parse round-trip.
      (§2.5.2)

### (b) External prerequisites (Snowflake admin / platform)
- [ ] **Service user + key-pair** in `ZENDESK-GLOBAL` (public key set by admin;
      private key held as our secret). (§0.6 Q12)
- [ ] **Grants:** default role with `USAGE` on a warehouse + `USAGE` on
      db/schema(s) + `SELECT` on the §8.5.1 source tables/views. (§0.6 Q13)
- [ ] **Connection identifiers:** account identifier, warehouse, role, database,
      schema. (§0.6 Q14 / §0.4)
- [x] **Query runtime / parity — reported validated by the user** (the ~2-min
      runtime and row parity are confirmed). **Still pending:** a **Jan / FY-boundary
      spot-check** as a pre-launch test (run with an `:as_of_date` in January and in
      Q4) per §8.5.6, on `sql/active_dynamic.sql` + `sql/historical_dynamic.sql`.
- [ ] **Egress** to `*.snowflakecomputing.com` — already ✅ (§0.0 Q4).

### (c) Build steps (us — application code, later; NOT part of this planning doc)
- [ ] Add **`snowflake-connector-python`** to `requirements.txt` / `pyproject.toml`
      (image-size caveat in §6); run all connector calls in a **threadpool** (§5).
- [ ] **`app/snowflake.py`** — key-pair `connect()` + run active/historical
      queries (§8.5 binds) + map rows to header-keyed dicts (§1.6).
- [ ] **Refresh routine** → write both slots into `account_snapshots` via the
      existing ingest/upsert path, one new version per run (§2.5.2).
- [ ] **`SNOWFLAKE_*` config** (incl. the **private-key secret** + optional
      passphrase) on `Settings` with `AliasChoices`, safe defaults, redacted
      diagnostics (§6).
- [ ] **Triggers:** a token-protected scheduled `POST /api/renewals/refresh`
      (Cloud Scheduler, once/day early AM) **and** the admin **"Refresh now"**
      background action (§2.5.3, §2.5.5).
- [ ] **Last-refresh record:** at the end of each run, stamp a
      "last successful refresh" record (timestamp, per-slot row counts, status) —
      in `app_meta` or snapshot metadata (§2.5.7).
- [ ] **"Data as of" indicator:** a read-only `GET /api/renewals/refresh-status`
      endpoint + a small injection-layer render of "Data as of …" on the main
      screen (relative time on hover) (§2.5.7).
- [ ] **Local simulated mode** — canned dataset so the dev loop needs no live
      Snowflake and no key (§7).
- [ ] **Retire manual CSV upload** — after parity, deprecate the admin CSV upload
      UI and `upload-csv` path (keep dormant one release for rollback). (§9 Phase 5)

---

## 3. OAuth decision — Option A vs Option B

> **⚠️ Applies only to the optional interactive per-user live-query feature
> (2026-07-30).** The scheduled data-load path (§2.5) does **not** use forwarded
> OAuth at all — it uses a service account with key-pair auth. Keep this section
> as reference in case an interactive per-user live-query feature is built later.

| Dimension | **A: Forwarded Okta ID/Access token** (`X-Pomerium-Idp-*`) | **B: Pomerium native JWT** (`X-Pomerium-Jwt-Assertion`) |
| --- | --- | --- |
| Header already read by app? | **No** — must add `x-pomerium-idp-id-token` / `x-pomerium-idp-access-token` handling | **Yes** — `x-pomerium-jwt-assertion` already in `JWT_HEADERS` (`app/auth.py:64`) |
| Pomerium route change? | **Yes** — needs `pass_identity_headers: true` on the route | No |
| JWKS reachable by Snowflake (external SaaS)? | **Yes** — `zendesk.okta.com/...` is public | **Unknown/risky** — `authenticate.idp.dev.zenai-apps.com` is a dev host; may be internal-only (Q1) |
| Central authz / policy alignment | **Best** — maps to Okta authz server + central policies | Pomerium-scoped |
| Token type | Must confirm JWT (custom authz server `aus…` = JWT; org server = opaque) (Q2) | Pomerium JWT is a JWT |
| `aud` for `EXTERNAL_OAUTH_AUDIENCE_LIST` | Okta audience / client ID (Q3) | Pomerium route hostname (Q3) |
| User-mapping claim | `sub` / `email` / `upn` → `LOGIN_NAME` / `EMAIL_ADDRESS` (Q4) | `email` → `EMAIL_ADDRESS` (per README) |
| Snowflake integration SQL | `okta_external_oauth` (README §A) | `pomerium_external_oauth` (README §B) |
| App code delta | Add 1 header source + token selection | ~none (reuse existing) |

**Recommendation (provisional):** **Option A (forwarded Okta ID token)**, because
Snowflake almost certainly cannot reach a **dev** Pomerium JWKS host from the
public internet, and Okta's JWKS is public and centrally governed. Use the **ID
token** specifically if the access token turns out to be opaque. This costs us a
Pomerium route change (`pass_identity_headers: true`) and a small amount of new
header-reading code, both low-risk. **Confirm Q1–Q4 before committing** — if the
Pomerium dev JWKS is confirmed internet-reachable and its claims/audience are
acceptable, Option B is less code (reuses the header we already parse).

---

## 4. Per-user OAuth vs service account

> **⚠️ RECONCILED (2026-07-30).** The comparison below was written when the plan
> assumed a **live, interactive** query per page load, where a per-user token is
> available and a *long-lived, UI-entered/stored* credential would indeed violate
> `AGENTS.md`. Under the **scheduled-refresh decision (§2.5)** there is **no
> logged-in user**, so per-user OAuth is **not possible** for the data load. The
> chosen model is a **service account with key-pair auth whose private key is an
> injected platform secret** — which does **not** violate `AGENTS.md`: it is the
> same class of secret as `DB_PASSWORD` (env-injected, never entered in a UI,
> never written to disk, never baked into the image). The "service account =
> rule violation" note in the table below is therefore **superseded** for the
> background job; it remains true only for the (rejected) idea of a *UI-entered or
> disk-persisted* credential. Per-user OAuth stays relevant **only** for a future
> interactive live-query feature.

**Original recommendation (interactive-only): per-user OAuth (identity passthrough).**

| | Per-user OAuth (recommended) | Service account |
| --- | --- | --- |
| Stored secret | **None** — token comes from the request, per request | A long-lived credential/key must be stored → **violates AGENTS.md anti-pattern #1/#2 (no credentials in UI / no stored creds)** |
| Governance | Snowflake enforces row access by the **user's own** role | All users share one role; app must re-implement per-user filtering |
| Audit | Snowflake logs the real user | Only the service account appears |
| AGENTS.md alignment | Matches "credentials come from injected env / identity", stateless | Reintroduces the exact secret-management scars the project avoids |
| Cost / simplicity | Slightly more setup (every user provisioned in Snowflake) | Simpler to bootstrap, one identity |
| Main drawback | **Every dashboard user must be a provisioned Snowflake user with a role grant** (Q5) | Loses per-user governance; single blast-radius credential |

Per-user OAuth is the right call: no stored secret, honors the project's rules,
and delegates access control to Snowflake. The cost is provisioning — surface Q5
to the admin team. (A service account is only a fallback if per-user provisioning
is truly impossible, and it should be flagged as a rule violation if chosen.)

> **Correction for the current design (2026-07-30):** the parenthetical above is
> written for the interactive case. For the **scheduled refresh (§2.5)** a service
> account with **key-pair auth via an injected secret env var** is the **chosen,
> compliant** model — not a fallback and not a rule violation — because the job
> runs with no user and the key is a platform-injected secret (like `DB_PASSWORD`),
> not a UI-entered or disk-persisted credential.

---

## 5. Async / blocking concern

`snowflake-connector-python` is **synchronous** (blocking sockets). Calling it
directly in an `async def` route would block the event loop and starve asyncpg
(which still serves notes/calls). Approach:

- Wrap every connector call (`connect`, `cursor.execute`, `fetchall`) in
  `starlette.concurrency.run_in_threadpool(...)` (or
  `asyncio.get_running_loop().run_in_executor(pool, …)` with a bounded
  `ThreadPoolExecutor`).
- Keep a **bounded** executor (e.g. `max_workers` ~ the Snowflake statement
  concurrency you're willing to pay for) so a burst of dashboard loads can't open
  unbounded Snowflake sessions.
- Set connector timeouts (`login_timeout`, `network_timeout`,
  `statement_timeout`) so a slow warehouse returns a clean 503 rather than
  hanging a worker.
- Do **not** reuse a connection across users (each request carries a different
  user token). Open → query → close within the threadpool task.

---

## 6. Config & dependencies

**New env vars** (injected by the platform, mirroring the `DB_*` precedence
pattern in `app/config.py` with `AliasChoices`; never from a UI):

```
SNOWFLAKE_ACCOUNT      # account locator / identifier
SNOWFLAKE_WAREHOUSE
SNOWFLAKE_DATABASE
SNOWFLAKE_SCHEMA
SNOWFLAKE_ROLE         # service-account default role (or user role, interactive)
SNOWFLAKE_TABLE        # or view name for the renewals book
SOURCE_BACKEND         # "csv" (default) | "snowflake"  — the cutover toggle
SNOWFLAKE_SIMULATE     # "true" for offline dev (see §7 mode)

# --- Service-account key-pair auth (CURRENT DECISION, §2.5.4) ---
SNOWFLAKE_USER              # the Snowflake service username
SNOWFLAKE_AUTHENTICATOR     # "snowflake_jwt" (key-pair)  [interactive would use "oauth"]
SNOWFLAKE_PRIVATE_KEY       # RSA private key (PEM), injected as a SECRET env var
SNOWFLAKE_PRIVATE_KEY_PASSPHRASE  # optional; secret, only if the key is encrypted

# --- Scheduled refresh controls (§2.5.3 / §2.5.5) ---
REFRESH_ENABLED            # gate the scheduled refresh on/off
REFRESH_TOKEN              # shared secret protecting POST /api/renewals/refresh
REFRESH_CADENCE            # documentation/ops hint; real schedule lives in Cloud Scheduler
```

**Service-account / key-pair fields (current design, §2.5.4):** add `SNOWFLAKE_USER`,
`SNOWFLAKE_AUTHENTICATOR` (`snowflake_jwt`), and the **secret** `SNOWFLAKE_PRIVATE_KEY`
(+ optional `SNOWFLAKE_PRIVATE_KEY_PASSPHRASE`) as `Settings` fields with
`AliasChoices`. **Treat the private key exactly like `DB_PASSWORD`:** injected by
the platform, never logged, never in `public_dict()` / `banner()` (redact),
never persisted to disk, never entered via a UI. The `x-pomerium-idp-*` token
reading below is needed **only** for the optional interactive per-user feature —
the scheduled refresh does not read any request token.

- Add these as fields on `Settings` (`app/config.py:31`) with `AliasChoices`
  and safe defaults; extend `public_dict()` / `banner()` for diagnostics
  (never log tokens or secrets — reuse `redact_jwt`, `app/auth.py:286`).
- Token header selection (Option A): add
  `x-pomerium-idp-id-token` / `x-pomerium-idp-access-token` reading to
  `app/auth.py` (new helper alongside `JWT_HEADERS`, `app/auth.py:62`), exposed
  so the Snowflake layer can grab the raw token from the request.

**New dependency:** `snowflake-connector-python` in `requirements.txt` and
`pyproject.toml`.
- **Image-size / compat caveat:** the connector pulls in `pyarrow`, `cryptography`,
  `pyOpenSSL`, etc. — a meaningfully larger image on `python:3.12-slim`. Pin a
  version verified against Python 3.12, and rebuild/verify the Docker image size
  (§3 of AGENTS.md Dockerfile rules still apply: slim base, tini, multi-stage).
  Consider installing only what's needed and testing cold-start time.

---

## 7. Simulated / offline mode (local dev)

Mirror the README's "Simulated Mode" and today's seed behavior so
`http://127.0.0.1:8765` works with no live Snowflake and no token:

- When `SNOWFLAKE_SIMULATE=true` (or `SOURCE_BACKEND=snowflake` but no token
  present and `STRICT_AUTH` is off), `app/snowflake.py` returns a **canned
  dataset** shaped exactly like the real projection (a handful of rows using the
  primary header names from §1.6). Reuse the bundled `seeds/` CSVs as the fixture
  source if convenient, or a small static fixture.
- This keeps the dev loop identical to today (dev user is admin via
  `_dev_user`, `app/auth.py:191`) and lets us validate the mapping without
  Snowflake access.

---

## 8. Query / data mapping

**Projection query (illustrative — finalize column names per Q7):**

```sql
SELECT
    crm_account_id            AS "CRM_ACCOUNT_ID",
    crm_account_name          AS "CRM_ACCOUNT_NAME",
    year_quarter_yyyyqq       AS "YEAR_QUARTER",
    atr_arr_usd_starting      AS "ATR_ARR_USD_STARTING",
    atr_arr_usd_ltg           AS "ATR_ARR_USD_LTG",
    fc_remaining              AS "FC_REMAINING",
    bu_fc                     AS "BU_FC",
    net_arr_usd_prior_qtr_end AS "NET_ARR_USD_PRIOR_QTR_END",
    region                    AS "REGION",
    billing_country           AS "BILLING_COUNTRY",
    pro_forma_market_segment  AS "PRO_FORMA_MARKET_SEGMENT",
    pro_forma_subregion       AS "PRO_FORMA_SUBREGION",
    crm_health_status         AS "CRM_HEALTH_STATUS",
    next_renewal_date         AS "NEXT_RENEWAL_DATE",
    largest_renewal_date      AS "LARGEST_RENEWAL_DATE",
    forecast_summary          AS "FORECAST_SUMMARY",
    dictated_by               AS "DICTATED_BY",
    crm_success_owner_name    AS "CRM_SUCCESS_OWNER_NAME",
    manager_success           AS "MANAGER_SUCCESS",
    partner                   AS "PARTNER",
    partner_type_c            AS "PARTNER_TYPE_C",
    product_lines             AS "PRODUCT_LINES",
    flag_3k                   AS "FLAG_3K",
    cc                        AS "CC",
    cc_offcycle_arr           AS "CC_OFFCYCLE_ARR",
    expansion                 AS "EXPANSION",
    done_deal                 AS "DONE_DEAL",
    upside                    AS "UPSIDE",
    downside                  AS "DOWNSIDE",
    band                      AS "BAND"
FROM <db>.<schema>.<renewals_view>
WHERE (:slot = 'active'      AND <active predicate>)
   OR (:slot = 'historical'  AND <historical predicate>)
```

- The connector returns rows; build `rows = [dict(zip(col_names, row)) …]`. Those
  dicts already have the header keys the dashboard wants (§1.6). Set
  `headers = col_names`. Return the same `{ ok, rows, headers, slot, mtime… }`
  as `/parsed-data`.
- **Prefer aliasing in a Snowflake VIEW** owned by the data team (Q7) rather than
  hard-coding fragile column names in the app — one place to absorb schema drift.

**Large result sets (Q9):**
- Today the client-parses-CSV short-circuit kicks in above 40K rows
  (`app/routes/renewals.py:469`). With Snowflake there's no CSV to stream, so:
  - If per-user result sets are comfortably under ~tens of thousands, return
    them inline from `/parsed-data` (single response) — simplest, and the client
    consumes them via `importCSV` directly.
  - If they can be large, add **server-side pagination/limit** (fetch in batches
    via the cursor) and either (a) assemble server-side up to a safe cap, or
    (b) push filters down to SQL (below) to shrink the set. Streaming NDJSON is a
    later optimization if needed.
- **Filter push-down:** the dashboard already sends `quarter` / `region` / `band`
  filters to some endpoints (e.g. `/trending`, `app/routes/renewals.py:1943`).
  For the main grid, filters are currently applied **client-side** after
  `importCSV`. Keep it client-side initially (zero React change); later, push
  `year_quarter` / `region` / `band` into the `WHERE` clause to reduce payload
  if volume demands it.

---

## 8.5 Dynamic dates & query parameterization (Snowflake source queries)

The two production queries that generate the dashboard's source data (one per
slot) were hand-written with **hardcoded dates and thresholds** that silently go
stale. They are rewritten as self-dynamic, parameterized queries in
[`sql/active_dynamic.sql`](sql/active_dynamic.sql) and
[`sql/historical_dynamic.sql`](sql/historical_dynamic.sql). Run with default
params they are functionally identical **today** but roll forward automatically
every quarter with no edits.

> ⚠️ **Not executed against Snowflake.** These rewrites are logically validated
> only. The generated quarter-end series and the fiscal-year arithmetic
> (especially the Jan/FY boundary) **must be tested against the real warehouse**
> — see the caveats at the end of this section.

> **These are the exact queries the scheduled refresh runs (§2.5).** The refresh
> job executes `sql/active_dynamic.sql` and `sql/historical_dynamic.sql` with
> **default binds** (so output tracks the current quarter automatically) via the
> **service account**, then ingests the results into `account_snapshots`. The
> **~2-min runtime** of the active query is precisely why the refresh is
> out-of-band rather than on page load. Validating the runtime and the **Jan / FY
> boundary** here is a prerequisite in the §2.6 checklist.

### 8.5.1 Source tables (for the Snowflake-admin connection details, §0.4)
- `FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD` — the base
  enriched fact table (both slots; carries `is_quarter_end`, `is_most_recent`,
  `service_date`, `net_arr_usd*`, `bu_fc*`, `atr_arr_usd_starting*`, the
  `_PLUS1.._PLUS4` forward-quarter columns, `RENEWAL_FORECAST_SUMMARIES*`, etc.).
- `CLEANSED.SALESFORCE.SALESFORCE_ACCOUNT_SCD2` / `..._ACCOUNT_BCV` — account
  attributes (Top-3000 flag, industry, billing country, health risk).
- `CLEANSED.GAINSIGHT.GAINSIGHT_COMPANY_SCD2` / `..._COMPANY_BCV` — CS engagement
  (`DAYS_SINCE_LAST_CS_ENGAGED_GC`).
- `FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED` —
  product lines + renewal dates.
- `CLEANSED.SALESFORCE.SALESFORCE_CONTRACT_FORMULA_BCV` (+ `_ACCOUNT_BCV`) —
  partner name/type (historical slot only).

These belong to the `ZENDESK-GLOBAL` account per §0.0. Confirm the signed-in
user's Snowflake role can `SELECT` all of them (§0.3/§0.5).

### 8.5.2 Enumerated stale spots and how each was made dynamic

**HISTORICAL query**

| # | Stale spot (verbatim) | Risk | Dynamic replacement |
| --- | --- | --- | --- |
| H1 | `base`: `service_date > '2026-02-01'` | Anchors the whole result to a fixed quarter; from the next quarter on it pulls the wrong/extra window. | Derived `anchor_date` = start of the current fiscal quarter (computed from `as_of_date`), minus `:quarters_back` quarters. |
| H2 | `customer`: `VALID_TO_TIMESTAMP >= '2026-02-01'` | SCD2 slice frozen to Feb 2026; would drop/keep the wrong versions over time. | Same `anchor_date`. |
| H3 | `gsdata`: `VALID_TO_TIMESTAMP >= '2026-02-01'` | Same SCD2 staleness for Gainsight. | Same `anchor_date`. |
| H4 | `contract`: `start_date BETWEEN '2026-02-01' AND CURRENT_DATE()` | Lower bound stale; window keeps widening. | `BETWEEN anchor_date AND :as_of_date` (end defaults to today). |
| H5 | final `band` CASE: `>= 100000` | A business threshold baked into SQL. | `:band_cutoff` (default `100000`). |

**ACTIVE query**

| # | Stale spot (verbatim) | Risk | Dynamic replacement |
| --- | --- | --- | --- |
| A1 | `future_dates` = `VALUES ('2026-01-31'),('2026-04-30'),('2026-07-31'),('2026-10-31'),('2027-01-31'),('2027-04-30'),('2027-07-31')` | **Breaks first.** A frozen list of 7 quarter-ends; once the calendar passes them the forward window is wrong. | `GENERATOR`-driven series of quarter-ends for offsets `-:quarters_back .. +:quarters_forward` around the current fiscal quarter-end (canonicalized by the same `MONTH()` CASE the query already uses). |
| A2 | final relabel `CASE` (`'Q425'→'Q4\`26'`, `'Q126'→'Q1\`27'`, … `'Q227'→'Q2\`28'`) | Hand-maintained label map; every new quarter needs a new line or labels show `NULL`. | Computed directly in `structure`: `CONCAT('Q', dates_qnum, '\`', RIGHT(TO_VARCHAR(dates_fy + 1), 2))` — the relabel was uniformly `display_fy = raw_fy + 1`. |
| A3 | final `WHERE year_quarter != 'Q425'` | Tied to the A2 literal; drops "the extra oldest quarter" by name. | Redundant once A1 uses `:quarters_back = 1` (offset −2 is never generated). Filter removed. |
| A4 | `WHERE (net_arr_usd >= 75000 OR net_arr_usd_prior_quarter_end >= 75000)` | Inclusion threshold baked into SQL. | `:min_arr` (default `75000`). |
| A5 | band CASE: two `>= 100000` | Business threshold baked in. | `:band_cutoff` (default `100000`). |
| A6 | `current_dt`: `WHERE is_most_recent = TRUE` | Not stale, but not overridable for an as-of view. | Kept as the default; `:as_of_date` optionally selects the latest snapshot on/before a picked date. |

**Fiscal calendar used everywhere** (the query's own convention): FY ends Jan 31;
Q1 Feb–Apr (q-end Apr 30), Q2 May–Jul (Jul 31), Q3 Aug–Oct (Oct 31), Q4 Nov–Jan
(Jan 31). The internal fiscal-year number treats a **Jan** quarter-end as
`YEAR − 1` (it belongs to the FY that started the prior Feb); the **displayed**
label uses the fiscal-year-**end** convention (`+ 1`).

### 8.5.3 Bind-variable contract (what the FastAPI app passes)

Bind **variables only** — never string interpolation. Both files use Snowflake
**`qmark`** paramstyle (positional `?`). Each bind appears **exactly once** (in a
top `params` CTE) and every other reference reads it back out of the CTE, so no
value is ever repeated **and** the `LIKE '%top 3000%'` patterns need no escaping
(the connector's default `pyformat`/`%(name)s` would collide with the literal
`%`, which is why `qmark` was chosen).

| Bind (order) | Type | Default | Meaning | Active | Historical |
| --- | --- | --- | --- | :---: | :---: |
| `as_of_date` | DATE | `NULL` → today / `is_most_recent` | The "as-of" date. Powers an optional in-app date picker. | ✔ (#1) | ✔ (#1) |
| `quarters_back` | INT | active `1`, historical `0` | How many quarters before current to include/anchor. | ✔ (#2) | ✔ (#2) |
| `quarters_forward` | INT | `4` | How many quarters after current to include. | ✔ (#3) | — |
| `min_arr` | NUMBER | `75000` | Row-inclusion ARR threshold. | ✔ (#4) | — |
| `band_cutoff` | NUMBER | `100000` | `'100k+'` vs `'<100k'` split. | ✔ (#5) | ✔ (#3) |

```python
import snowflake.connector
snowflake.connector.paramstyle = "qmark"   # module-level, set once at import

# active slot — defaults reproduce today's output exactly
cur.execute(open("sql/active_dynamic.sql").read(),
            [as_of_date, quarters_back, quarters_forward, min_arr, band_cutoff])
#           [None,       1,             4,                75000,   100000]

# historical slot
cur.execute(open("sql/historical_dynamic.sql").read(),
            [as_of_date, quarters_back, band_cutoff])
#           [None,       0,             100000]
```

**Default behavior with no params = tracks the current quarter automatically.**
This satisfies both of the user's asks at once:
- **"Adjust dates dynamically in the app"** → surface a date picker that binds
  `:as_of_date` (and optionally `:quarters_back/forward`).
- **The self-updating "alternative"** → pass `None` for `:as_of_date` and the
  query rolls forward on its own from `CURRENT_DATE()` / `is_most_recent`.

### 8.5.4 `year_quarter` format reconciliation (evidence from `seeds/active.csv`)

The queries' raw internal label (`CONCAT('Q', qnum, RIGHT(fy,2))`) is **not** the
format the dashboard stores. Inspecting the seed CSVs:

- **Active** — `seeds/active.csv`, column **`YEAR_QUARTER`**, distinct values:
  `` `Q1`27` ``, `` `Q2`27` ``, `` `Q3`27` ``, `` `Q4`27` `` (plus blanks). Format
  is **`` Q<qnum>`<yy> ``** with a literal **backtick** and the fiscal-year-**end**
  two-digit year.
- **Historical** — `seeds/historical.csv`, column **`YEAR_QUARTER_YYYYQQ`**,
  distinct value `2027Q1`. Format is **`YYYYQQ`**.

`FIELD_KEYS.YEAR_QUARTER` (`public/vendor/app.js:176`) accepts **both**
(`["YEAR_QUARTER", "YEAR_QUARTER_YYYYQQ", …]`), so each slot keeps its own header
name.

Transformations applied so the output matches without any dashboard change:
- **Active:** emit the display label directly in the `structure` CTE —
  `CONCAT('Q', dates_qnum, '\`', RIGHT(TO_VARCHAR(dates_fy + 1), 2))`. This
  reproduces `` Q4`26 `` → `` Q2`28 `` style and replaces the entire hardcoded
  relabel `CASE`. Verified: with `quarters_back=1, quarters_forward=4` and a
  current quarter of Q2, it yields exactly `` Q1`27, Q2`27, Q3`27, Q4`27, Q1`28,
  Q2`28 `` — the same set the original produced today after its `!= 'Q425'` drop.
- **Historical:** no transform needed — `c6.YEAR_QUARTER_YYYYQQ` is already
  `YYYYQQ`, so the query projects the source column verbatim.

### 8.5.5 Column-mapping check (query output vs. dashboard fields)

Cross-referenced against `FIELD_KEYS` / `buildHeaderMap` (`public/vendor/app.js:175`,
`:327`) and the §1.6 contract table. Both queries project the primary header
aliases the dashboard resolves. Notes and gaps:

- **All primary fields covered by at least one slot:** `CRM_ACCOUNT_ID`,
  `CRM_ACCOUNT_NAME`, `YEAR_QUARTER`/`YEAR_QUARTER_YYYYQQ`, `ATR_ARR_USD_STARTING`,
  `BU_FC`, `NET_ARR_USD_PRIOR_QTR_END`, `region`/`REGION`,
  `PRO_FORMA_MARKET_SEGMENT`, `PRO_FORMA_SUBREGION`, `CRM_HEALTH_STATUS`,
  `NEXT_RENEWAL_DATE`, `FORECAST_SUMMARY`/`RENEWAL_FORECAST_SUMMARIES`→`forecast_summary`,
  `Dictated_by`, `CRM_SUCCESS_OWNER_NAME`, `MANAGER_SUCCESS`, `flag_3k`,
  `CC_OFFCYCLE_ARR`, `DONE_DEAL`, `BILLING_COUNTRY`, `PRODUCT_LINES`, `band`.
- **Active-only fields:** `ATR_ARR_USD_LTG`, `FC_REMAINING`, `Upside`, `Downside`,
  `largest_renewal_date`. These are present in the active projection ✔ and are
  correctly **absent** from historical (matching `seeds/historical.csv`).
- **`DROPPED_COLUMNS`** (`app.js:214`) — `QTD_CC, FC_ONCYCLE, FC_OFFCYCLE,
  TERM_GROUPED, CRM_OWNER_NAME, CRM_RENEWAL_OWNER_NAME, MANAGER_RENEWAL, RAMP_DEAL,
  AUTO_RENEW` — are stripped client-side regardless. Both queries still emit them
  (harmless), preserving byte-for-byte parity with the current CSVs.
- **Gaps / things to confirm against the warehouse (⚠️):**
  1. **Active has no `PARTNER` / `PARTNER_TYPE_C`.** The current active query does
     not project partner columns, yet the older `seeds/active.csv` header carries
     `PARTNER,PARTNER_TYPE_C`. This is a property of the user's active query, not
     something changed here — the active grid's Partner column will be blank
     unless a partner join is added (as the historical query has). Confirm this is
     intended before cutover.
  2. **Active `CC` is `QTD_CC`** (dropped client-side). The dashboard's `CC` field
     therefore resolves via substring to another `*CC*` header — this is
     pre-existing CSV behavior, unchanged here because we reproduce the same
     headers.
  3. Header **case/aliasing** relies on `normalizeHeader` (uppercased); the
     lower-case aliases (`region`, `flag_3k`, `Dictated_by`, …) normalize fine, as
     they do for today's CSVs.

### 8.5.6 Caveats — must test against the real warehouse

Because these were **not run against Snowflake**, validate:
- **The generated quarter-end series (A1).** Confirm `GENERATOR(ROWCOUNT => 100)`
  + `ROW_NUMBER()` yields exactly the intended offsets and that
  `DATEADD('quarter', k, current_q_end)` lands in the correct target month for
  every k (month-end day clamping is expected and harmless because the `base` CTE
  re-derives the quarter-end from `MONTH()`; verify empirically anyway).
- **Fiscal-year arithmetic around the Jan / FY boundary.** The `MONTH = 1 ⇒
  YEAR − 1` rule and the `dates_fy + 1` display rule are the trickiest edges —
  run the query with an `:as_of_date` in **January** and in **Q4 (Nov–Jan)** and
  confirm labels/`quarter_diff` match expectations.
- **Historical anchor semantics.** The literal `'2026-02-01'` is simultaneously
  the current-quarter start (during Q1) **and** the fiscal-year start. The rewrite
  defaults to **current-quarter start**. If the historical slot is meant to be
  **fiscal-year-to-date** (multiple quarter-ends since Feb 1), pass
  `:quarters_back` = quarters elapsed this FY, or switch to the commented
  fiscal-year-start anchor in `historical_dynamic.sql`. **Decide with the data
  owner.**
- **`is_most_recent` vs `MAX(service_date)`.** The active default uses
  `MAX(service_date) WHERE is_most_recent = TRUE`; confirm `is_most_recent` flags a
  single snapshot date so this equals the original `LIMIT 1`.
- **Row counts / parity.** Diff the row objects (keys + values, ATR/BU_FC totals,
  health & region breakdowns) against a known CSV export per §9 Phase 3.

---

## 9. Cutover / migration (phased checklist)

> **Reconciled with the scheduled-refresh decision (2026-07-30).** This phased
> checklist predates §2.5 and assumes on-request serving from Snowflake. Under the
> current design, the serving path (`/parsed-data`, etc.) **stays on Postgres**
> and only the **write side** changes: the refresh job populates `account_snapshots`
> instead of a manual CSV upload. So: **Phase 1's `x-pomerium-idp-*` token reading
> is optional** (only for the future interactive feature); Phase 2's serving-path
> branch is **not needed** (the dashboard keeps reading `account_snapshots`); and
> the concrete build steps are the **§2.6** list. Phase 0 gating shifts to §0.6
> (service account + grants). Keep this section as the deprecation/rollback plan
> for the CSV upload path (Phases 3–5 still apply).

- [ ] **Phase 0 — Confirm gating answers (§0).** Nothing merges before Q1–Q9.
- [ ] **Phase 1 — Add the Snowflake layer alongside CSV (dark).**
  - [ ] Add `app/snowflake.py` (per-request connect + query + mapping +
        threadpool + simulate mode).
  - [ ] Add config fields + `SOURCE_BACKEND` (default `csv`) to `app/config.py`.
  - [ ] Add `x-pomerium-idp-*` token reading to `app/auth.py` (Option A).
  - [ ] Add `snowflake-connector-python` to deps; rebuild + size-check image.
  - [ ] No behavior change yet (`SOURCE_BACKEND=csv`).
- [ ] **Phase 2 — Feature-flag the serving path.**
  - [ ] Branch `/parsed-data`, `/data-source/info`, `/csv-list` on
        `SOURCE_BACKEND`. `vibe-server-data.js` and `app.js` stay **unchanged**.
- [ ] **Phase 3 — Validate parity against a known CSV.**
  - [ ] Load a known CSV via the current path; capture `/parsed-data` output.
  - [ ] Point at Snowflake; diff row objects (keys + values) against the CSV
        output. Confirm ATR totals, counts, health/region breakdowns, and the
        Trending/Region/Accounts tabs render identically.
- [ ] **Phase 4 — Switch default.** Flip `SOURCE_BACKEND=snowflake` in the
      platform env for dev, then prod after sign-off.
- [ ] **Phase 5 — Deprecate CSV upload/admin bits.**
  - [ ] Hide/disable the admin CSV upload UI (`public/admin.html`) and the
        `Import CSV` affordances (already hidden in `public/index.html:2431`).
  - [ ] Keep `upload-csv` / `csv_uploads` code paths dormant for one release as
        rollback insurance, then remove.
- [ ] **Rollback:** set `SOURCE_BACKEND=csv` (env-only, no redeploy of code
      needed) to instantly revert to the CSV/Postgres path. Because notes/calls
      never moved, no data is at risk during cutover.

**What happens to the admin CSV UI:** it becomes vestigial. Short-term, leave it
behind the owner gate but unused; long-term, replace the "upload" section with a
read-only "Snowflake source status" panel (connection health, last query time,
row count) — no credentials, consistent with AGENTS.md.

---

## 10. Risks & open questions

> **Scope note (2026-07-30):** the JWKS / token-type / audience / user-provisioning
> risks below apply to the **interactive per-user OAuth** feature only. For the
> **scheduled refresh (§2.5)** the live risks are: scheduler duplication, key
> handling, data staleness, image bloat, and the blocking connector.

**Scheduled-refresh risks (current design):**
- **Scheduler reliability/duplication.** In-process timers are unreliable on Cloud
  Run (scale-to-zero, multi-instance). Use an external trigger or Snowflake task
  and make the job idempotent per run. (§2.5.5)
- **Key handling.** The RSA private key is a high-value injected secret — redact
  it everywhere, rotate via the platform secret store, never persist to disk.
  (§2.5.4)
- **Data staleness between runs.** The dashboard shows data as of the last refresh.
  Mitigated by the **decided** once-daily cadence plus the **"Data as of"
  indicator** (§2.5.7) and the **admin "Refresh now"** button (§2.5.3), so users
  always see how current the data is and can force an update. Cadence can be
  shortened later if daily proves too stale.
- **Long-running query blocking.** The ~2-min query must run in a bounded
  threadpool with sane timeouts so it never starves asyncpg. (§2.5.6 / §5)

**Interactive per-user OAuth risks (optional future feature only):**
- **Dev-vs-prod JWKS reachability (Option B killer).** A dev Pomerium hostname is
  unlikely to be internet-reachable by Snowflake. (Q1)
- **Token type.** Opaque Okta access tokens can't be validated by Snowflake; use
  the ID token or the custom-authz-server JWT. (Q2)
- **Audience mismatch.** Wrong `EXTERNAL_OAUTH_AUDIENCE_LIST` rejects every
  query. (Q3)
- **User provisioning.** Per-user OAuth requires every viewer in Snowflake with a
  role grant; unprovisioned users get auth errors. Need a clear UX for "you're
  not provisioned in Snowflake." (Q5)
- **Token expiry.** Forwarded tokens are short-lived; per-request connect means
  we always use a fresh token, so this is fine — but a token that expires
  mid-session surfaces as a 401/403 on the next query; the app should surface a
  friendly "re-authenticate" message.
- **Latency.** Snowflake warehouse spin-up + query + network per request is
  slower than today's in-memory/IndexedDB reads. Mitigate with warehouse
  auto-resume tuning, a short-lived per-user result cache (respecting row-level
  governance — cache keyed by user), and keeping filters client-side to avoid
  re-querying.
- **Warehouse cost/sizing.** Per-user-per-load queries can add up; pick a small
  warehouse with aggressive auto-suspend. (Q11)
- **Schema drift.** Snowflake column renames break the header mapping. Mitigate
  by aliasing through a **data-team-owned view** (§8) and by keeping the app's
  projection tolerant (missing columns → absent keys, which `buildHeaderMap`
  already handles via `find(...) || fallback`).
- **Egress firewall.** Pod must reach `*.snowflakecomputing.com`. (Q10)
- **Image bloat.** `snowflake-connector-python` + `pyarrow` materially increase
  image size and cold-start; verify against Cloud Run startup window.
- **Blocking connector.** Must run in a bounded threadpool (§4) or it starves the
  asyncpg-backed notes/calls endpoints.

---

## 11. One-sentence summary

> Add a **scheduled background refresh** (`app/snowflake.py`, run in a threadpool)
> that authenticates to Snowflake with a **service-account key-pair** (injected
> secret, no logged-in user), runs the ~2-min active/historical queries out-of-band,
> and writes the results into `account_snapshots` via the existing ingest/upsert
> path — so the dashboard keeps reading Postgres instantly, the frozen contract and
> compiled React app are untouched, and all app-generated write state (notes,
> calls) stays exactly as it is. *(Per-user forwarded-OAuth live querying — §2–§4 —
> is retained only as an optional future interactive feature.)*

---

## 12. Decisions (finalized 2026-07-30)

These supersede the earlier "recommended" language throughout the doc (top
banner, §0.5, §0.6, §2.5, §2.6). Where an earlier recommendation differed from
the decision, the decision wins.

| # | Decision | Value (DECIDED) | Was previously | Where documented |
| --- | --- | --- | --- | --- |
| 1 | **Refresh cadence** | **Once per day, early AM** (shortenable later if fresher data is needed) | *recommended every 4–6 h / a few times a day* | banner, §0.5, §2.5.3, §2.6(a) |
| 2 | **Scheduler placement** | **External trigger** — Cloud Scheduler → token-protected `POST /api/renewals/refresh` (Cloud Run scale-to-zero/multi-instance rationale kept) | *open; external vs Snowflake task* | §2.5.5, §0.6 Q15, §2.6(a) |
| 3 | **Admin "Refresh now"** | **Yes** — token-gated, background, non-blocking (`202 Accepted`) | *optional* | §2.5.3, §2.6 |
| 4 | **"Data as of" freshness indicator** | **Yes** — main-screen "Data as of …" from the latest snapshot's load time / a last-refresh record, via a read-only status endpoint | *not previously specified* | §2.5.7, §2.6 |
| 5 | **Service account + key-pair auth** | **Approved** | *proposed / recommended* | banner, §0.6, §2.5.4, §4 |

**Still open — implementation-time only:**

- **(a) Snapshot write style.** Serialize query rows to CSV bytes and reuse the
  `upload-csv` → `ingest_snapshot` path, **or** ingest row dicts directly into a
  synthetic `csv_uploads` version. *Recommended default: **serialize to CSV
  bytes*** — it reuses today's exact ingest path verbatim and preserves a raw
  per-run artifact for audit/rollback (small serialize/parse cost). Final call at
  build time. (§2.5.2)
- **(b) Warehouse validation.** The user reports the query is **validated** (~2-min
  runtime and row parity confirmed). **Remaining pre-launch test:** a
  **Jan / FY-boundary spot-check** — run each query with an `:as_of_date` in
  **January** and in **Q4 (Nov–Jan)** and confirm labels / `quarter_diff` per
  §8.5.6. (§2.6(b))

**Platform confirmations still needed (not decisions):** Cloud Scheduler
availability/permission to call the service URL (§0.6 Q15), and the Snowflake
service-user provisioning + grants + connection identifiers (§0.6 Q12–Q14).
