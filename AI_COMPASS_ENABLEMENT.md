# AI Compass — Enablement & Training Guide

> **Product name for training: "AI Compass."** This document describes the **Renewals Studio** dashboard.
> If the internal name changes, search-and-replace "AI Compass" to relabel the whole deck.
>
> **Audience:** Customer Success & Renewals team members (non-technical).
> **How to use this file:** Each `##` heading is designed to become one slide. Every feature follows the same
> **What it is → How to use it → Why it matters** pattern, with literal click-paths where useful.

---

## 1. Overview — What AI Compass is

**What it is**
- A single web dashboard that turns your renewals data (Salesforce / warehouse export) into a live, filterable, annotatable view of **every account up for renewal**.
- It groups renewals by **quarter, region, segment, and partner**, and lets the team layer in **notes** and **forecast calls** that everyone sees in seconds.

**Who it's for**
- **CSMs / Renewal Managers** — daily driving view: who renews when, health, forecast, what we've committed.
- **CS & Renewals leadership / CCO** — rollups, week-over-week movement, and exec-ready briefs.

**The core value**
- **Forecasting visibility:** one place to see the system forecast (BU FC) *and* the team's own call (CS + Renewals = ELT).
- **Accountability:** every note and forecast change is date-stamped with who made it.
- **Speed:** filter to a slice, open an account, type a note, save — the team sees it live.

**One-line pitch:** *"Your renewal book, quarter by quarter, with the team's forecast and story attached to every account."*

---

## 2. Getting started — Login & roles

**What it is**
- AI Compass sits behind your company **single sign-on (SSO)** gateway. There is **no separate username/password** to remember — you're recognized by your work identity when you open the link.

**How to use it**
1. Open the AI Compass URL your team shares (the same SSO link as your other internal tools).
2. You land on the dashboard automatically — no login form.
3. Your name appears; the tabs you can see depend on your **role**.

**Roles — who can see/do what**

| Role | Can do | Typical person |
| --- | --- | --- |
| **Standard** | View the dashboard, filter, open accounts, **write notes**, **enter CS/Renewals forecast calls** | CSMs, Renewal Managers |
| **Admin** | Everything Standard can, **plus** manage users and configure which tabs each role sees | Team leads / ops |
| **Owner** | Everything Admin can, **plus** upload CSV data, run the Snowflake refresh, import notes, wipe/manage snapshots | Platform owner (super-user) |

> **Note for trainers:** Which tabs a role sees is configurable by Admin/Owner (see **Admin → Dashboard tab access**). Owners always see every tab. If a teammate is "missing a tab," it's usually the tab-access matrix, not a bug.

**Why it matters**
- No credentials to lose, and edits are automatically attributed to the right person for the audit trail.

---

## 3. The tabs at a glance

**What it is** — a sticky tab strip across the top. Depending on your role and the loaded data you'll see:

| Tab | What it's for |
| --- | --- |
| **Region** | Default landing view — the book by quarter × region, with KPIs and quick filters |
| **Trending** | How the numbers are moving snapshot-to-snapshot (uses upload history) |
| **Partner** | The same book sliced by channel partner / partner type |
| **Accounts** | The flat, sortable table of every renewal row + inline forecast editing |
| **Notes** | Every account that has a note, in one place |
| **Historical** | Prior-year comparison (only appears when historical data is loaded) |
| **Report** | Renewal targets & attainment ("Targets") |
| **Weekly Brief** | The CCO's weekly 100K+ regional week-over-week movement report |

**Why it matters** — one dataset, many lenses. You never re-load data to change the view; filters and tabs reshape the same book instantly.

---

## 4. Region tab — KPIs + quick filters

The page you'll leave open all day.

### 4a. KPI tiles (with the ⓘ tooltip explanations)

**What it is** — a strip of headline numbers at the top. Each has a small **ⓘ** you can hover for the exact definition. They respect all active filters.

| KPI tile | What it means (from the in-app tooltip) |
| --- | --- |
| **Total ATR** | Sum of ATR across renewals in the current view — pending plus already-closed. |
| **Churn Health ATR** | Total ATR of accounts with a **Churning** health status, within the current filters. |
| **Reviewed** | % of pending accounts that have **a note or an ELT Forecast override** — i.e. someone has actively reviewed them. |
| **Booked C/C** | Churn & Contraction already **booked** on renewals that have closed. |
| **Remaining C/C** | Bottoms-Up (BU) forecast of Churn & Contraction across **pending** renewals. Sub-line shows it as a % of pending ATR. |
| **Expected C/C** | Booked C/C **+** Remaining C/C — total expected churn/contraction. |
| **ELT FC** | Booked C/C **+** ELT Forecast (uses the team's per-renewal ELT Call override where set, otherwise the BU forecast). |

> **Jargon note:** "C/C" = **Churn & Contraction** (revenue you expect to *lose*). Higher C/C = worse. See the Glossary.

### 4b. Quick Filters (and how they sync)

**What it is** — a collapsible **"Quick Filters"** bar on the Region tab with:
- **Fiscal Quarters** (pick a quarter or "All quarters")
- **Sub-Regions**
- **CS Manager**
- **Bands** (ATR size buckets) and **ARR range**
- a **Reset filters** button

**How to use it**
1. Click **Quick Filters** to expand.
2. Pick a **Fiscal Quarter** first — Sub-Regions and CS Manager options appear once a quarter is selected.
3. Selections **apply across every tab at once** — the Accounts table, Notes, and other views all reshape to the same slice.
4. There is also a full **global Filters modal** (region, country, segment, industry, health, quarter, owner, partner, partner type, band) plus a **"Use ATR LTG"** toggle. The Quick Filters and the global Filters modal describe the **same** shared slice — change one and the other reflects it.

**Why it matters** — set your slice once ("APAC, this quarter, red health") and the whole app follows you.

### 4c. Quarter summary, accounts table & exec-summary download

**What it is** — below the filters: a per-quarter / per-region breakdown (sub-region rollups, C/C, RR%, red counts) and the list of accounts in the selected slice.
**How to use it** — click a quarter/region to drill in; use the **download** control to export an **exec-summary**-style brief you can paste into a doc or email.
**Why it matters** — turns "what's this quarter look like" into a shareable summary in one click.

---

## 5. Accounts tab — the working table

**What it is** — a flat, sortable, filterable table of every renewal row. This is the launchpad for deep dives and where you enter forecast **calls**.

**Key columns**

| Column | Meaning |
| --- | --- |
| **Account / Renewal / ATR** | Name, renewal date, and the renewable dollars (ATR). |
| **C/C FC** | The forecasted Churn & Contraction for that renewal. |
| **CC%** | C/C as a % of ATR. |
| **Adj CC%** | **Adjusted** CC% — the churn/contraction rate after the team's adjustments are applied. |
| **Best Case** | **BU FC + Upside** — the optimistic landing. |
| **Worst Case** | **BU FC + Downside** — the pessimistic landing. |
| **CS Call** | The CS team's forecast number for this renewal (editable inline). |
| **Renewals Call** | The Renewals team's forecast number (editable inline). |
| **ELT Call** | The combined team call — **ELT = CS Call + Renewals Call**. |
| **Renewal Dictated By** | Who/what is driving this renewal outcome (e.g. the deciding stakeholder). |
| **Health / Owner / Partner** | Health pill, CSM owner, partner. |

**How to use it**
1. **Choose your columns:** open the **column chooser** to show/hide fields (Adj CC%, Best/Worst Case, CS Call, Renewals Call, Renewal Dictated By, Partner, etc.).
2. **Edit calls inline:** type a **CS Call** and/or **Renewals Call** directly in the row — the **ELT Call** updates automatically as their sum.
3. **Clear all calls:** use the **"Clear all calls"** control on a row to reset both.
4. **Sort** by any column (including CS Call / Renewals Call).
5. **Export CSV:** download the table — columns include Account, Renewal, ATR, C/C FC, ELT Call, CC%, Adj CC%, Best Case, Worst Case, Health, Owner, Partner, Renewal Dictated By.
6. **Double-click a row** → opens the **customer card** (see §9).

**Why it matters** — this is where the *team's* forecast gets entered and reconciled against the system forecast, account by account.

---

## 6. Notes tab

**What it is** — every account that has a note attached, in one searchable list, plus notes import/export.

**How to use it**
- **Search** by account name or note text; **sort** by Updated / ATR / Renewal Date / ELT override; toggle **archived**.
- **Export** notes as a **Notes Summary (.txt)**, **Exec Summary (.md)**, or **Weekly Update (.md)** — copy to clipboard or download.
- **Unmatched notes:** notes whose account no longer appears in the current data are grouped so you can re-match, archive, or delete them in bulk.

**How notes attach to a renewal**
- Each note is tied to **one specific renewal row** via a hidden composite key (`account :: quarter :: ATR`). So an account with four renewals across four quarters has **four independent notes** — not one shared blob.

**Why it matters** — this is the "what did we commit to / what's the story" view used in weekly forecast calls.

---

## 7. Partner, Trending & Report (Targets)

### Partner tab
**What it is** — the same book sliced by **channel partner** and **partner type** (Direct / Reseller / Distributor / MSP).
**Why it matters** — for partner-led renewal teams to see their slice at a glance.

### Trending tab
**What it is** — how the numbers are moving over time using the **snapshot history** (each data upload/refresh is a snapshot).
**What you see** — KPI tiles (Total ATR, Remaining C/C, Expected C/C, Accounts) each showing the **delta vs the prior snapshot**, plus a **"Snapshot trend"** line chart by effective date.
**Why it matters** — answers "are we getting better or worse week over week?" without manual comparison.

### Report tab (Targets)
**What it is** — renewal **targets** and attainment.
**How to use it** — enter annual / quarterly / segment targets; see forecast-vs-target and attainment.
**Why it matters** — ties the operational view to the number the team is carrying.

---

## 8. Weekly Brief tab — the CCO's weekly 100K+ regional report

**What it is** — an automated **week-over-week (WoW)** movement report for the **$100K+ band**, **current quarter**, broken out **by region**. It compares the two most recent data snapshots.

**How to use it**
1. Pick a **Region** (or leave on the overall rollup) and a **Week / snapshot** pair to compare (defaults to latest vs the one before it).
2. Read the four sections:
   - **BU movement + trend** — total forecast by region now vs prior, the $ and % change, and a trend series **with amounts**.
   - **Worsened accounts** — accounts whose churn/contraction forecast got worse WoW, ranked by swing. Large movers get an **auto-pulled explanation** (from the account's forecast summary, else its note).
   - **$0 → Forecast** — accounts that went from no forecasted C/C to a forecast this week.
   - **Upside** — the total change plus the **top 5 increases and top 5 decreases** by account.
3. Click **Download brief** to export a styled HTML brief you can send out.

**Why it matters** — turns the weekly leadership question ("what moved, where, and why?") into a ready-to-send document.

> **Gotcha:** the Weekly Brief needs **at least two snapshots** to compare. If only one upload exists, there's nothing to diff yet.

---

## 9. The customer card (double-click an account)

**What it is** — the single most-used surface. Opens when you double-click any account row. Everything about one renewal in one place.

**What's inside**

| Section | What it shows |
| --- | --- |
| **Metrics** | ATR, BU FC (system forecast), ELT Call (team call) as a top strip. |
| **Renewal details** | Renewal date, days-until, term, auto-renew, **Renewal Dictated By**, and **Best / Worst Case** (BU FC ± Upside/Downside). |
| **CS / Renewals forecast inputs** | Type the **CS Forecast** and **Renewals Forecast**; the card shows the computed **ELT Forecast = CS + Renewals**. |
| **Notes / Updates timeline** | Type an update and press **Enter** — it's auto-date-stamped. The **Updates** panel also shows a **"Forecast call changes"** trail: *who* changed the CS/Renewals forecast, to what, and *when*. |
| **Edit history** | The last versions of the note are retained for reference. |
| **Other Renewals** | Every other renewal for the same account, with **Copy** / **Copy & Archive** and **Consolidate All** to merge them into one. |

**How to use it**
1. Double-click a row (from Region drill-in, Accounts, or Notes).
2. Enter/adjust **CS** and **Renewals** forecast — watch **ELT** compute automatically.
3. Add a note (Enter to add an entry).
4. **Save** with the Done/Save button (or **Cmd+S**). The change is attributed to you and shows in the audit trail.

**Why it matters** — this is where the forecast story and the numbers live together, with a full who/when audit trail behind them.

---

## 10. Data & refresh — how the book stays current

**What it is** — two ways to load data, kept as versioned snapshots.

**Two ways data gets in**
1. **CSV upload** (Admin): upload the latest F1 Sheet export.
2. **Snowflake "Run now"** (Owner): pull source data straight from Snowflake into the same snapshots a CSV upload creates — for both slots in one job (~2 min).

**Two "slots"**
- **Active** — the current-year book (the main render). Files with `2026 data` in the name auto-route here.
- **Historical** — prior-year reference (powers the Historical tab). Files with `historical fy27` auto-route here.

**Snapshots / versioning**
- **Every upload or refresh is an immutable snapshot** with its own **effective date**. The dashboard always reads the **newest** snapshot per slot; older ones power **Trending** and **Weekly Brief** WoW/MoM comparisons.

**"Data as of" freshness indicator**
- When the dashboard loads the latest source, it shows a **"Latest source loaded"** status with how long ago the data is from ("just now", "3 hours ago", or a date/time). This reflects the **last data load**, so you always know how fresh the numbers are.

**Why it matters** — the team is always looking at the latest book, and nothing is ever silently overwritten — history is retained for trend analysis.

---

## 11. Admin (Admin / Owner only)

**What it is** — a separate **Admin** page (reached from the dashboard) for managing data and access. Sections are gated by role.

| Admin feature | Role | What it does |
| --- | --- | --- |
| **Database status** | Admin | Health of the data store, row counts, last error. |
| **Snowflake — Run now** | Owner | Trigger a live data pull from Snowflake into both slots; shows per-slot rows + status while it runs. |
| **Upload a new CSV** | Owner | Upload a `.csv` (or `.zip` for large files); becomes a new snapshot. Slot auto-detected from filename or chosen manually. |
| **Snapshot history** | Owner | Every upload with effective date, slot, rows, accounts, total ATR, size — download or delete versions; "Wipe all uploads." |
| **User access** | Admin | Add colleagues, set **Standard/Admin**, remove users (Owner is env-controlled). |
| **Dashboard tab access** | Owner | Choose which tabs each role sees (e.g. hide a work-in-progress tab). Owners always see all. |
| **Notes — import JSON** | Owner | Replay a notes-export file from another deployment (merges newer-wins). |
| **Account history (WoW / MoM)** | Admin | Look up one account across every snapshot — its ATR/health/forecast timeline — **plus** its **CS/Renewals call history** (who committed what, when). |

**Why it matters** — keeps data fresh, access correct, and gives ops a full history/audit lookup per account.

---

## 12. Glossary

| Term | Plain-English meaning |
| --- | --- |
| **ATR** | *Annual Target Revenue* — the renewable book; the dollars up for renewal. The most important number. |
| **ATR LTG** | An alternate ATR view (**"Use ATR LTG"** toggle) that looks at remaining/left-to-go ARR instead of the raw starting ARR. |
| **C/C** | *Churn & Contraction* — revenue you expect to **lose** on a renewal. Higher = worse. |
| **BU FC** | *Bottoms-Up Forecast* (a.k.a. Business-Unit Forecast) — the **system/RevOps** forecast for a renewal. |
| **CS Call** | The **CS team's** forecast number for a renewal. |
| **Renewals Call** | The **Renewals team's** forecast number for a renewal. |
| **ELT Call / ELT Forecast** | The **combined team call — CS Call + Renewals Call** — used as the human override of the system forecast. ("ELT Call" = per renewal in the table; "ELT Forecast" = same idea inside the customer card.) |
| **CC%** | C/C as a percentage of ATR. |
| **Adj CC%** | **Adjusted** CC% — the rate after the team's adjustments. |
| **Upside / Downside → Best / Worst Case** | Upside/Downside are the plus/minus ranges on the forecast. **Best Case = BU FC + Upside**; **Worst Case = BU FC + Downside**. |
| **Renewal Dictated By** | Who/what is driving the renewal outcome (the deciding party/stakeholder). |
| **Band (100K+)** | ATR size bucket. The "**100K+**" band = accounts of $100K ATR and above (the focus of the Weekly Brief). |
| **Active slot** | The current-year data (main dashboard). |
| **Historical slot** | The prior-year data (Historical tab). |
| **Snapshot** | One immutable data version, stamped with an **effective date**. The newest per slot renders; older ones drive Trending/Weekly Brief. |
| **Note / noteKey** | A note tied to one specific renewal via a hidden key (`account :: quarter :: ATR`), so each quarter's renewal has its own note. |
| **Reviewed** | An account counts as "reviewed" once it has **a note or an ELT Forecast override**. |

---

## 13. Tips, FAQ & common gotchas

**What it is** — quick answers to the questions that come up in training.

- **"An account isn't counting as *Reviewed*."** It needs **a note *or* an ELT Forecast override**. Just opening it isn't enough.
- **"The Weekly Brief is empty / can't compare."** It needs **≥ 2 snapshots**. After the first upload there's nothing to diff — it fills in on the next refresh.
- **"How fresh is this data?"** Check the **"Latest source loaded" / data-as-of** indicator — it reflects the **last load**, not real-time.
- **"ELT vs BU FC — which is which?"** **BU FC** is the *system* number; **ELT** is the *team's* call (**CS + Renewals**). ELT is where your judgement goes.
- **"Higher C/C looks good, right?"** No — **C/C is churn/contraction**, so **higher is worse**. "Worsened WoW" in the Weekly Brief means C/C went up.
- **"I set a filter and it changed another tab."** That's intended — filters are **shared across all tabs**. Use **Reset filters** to clear.
- **"A teammate can't see a tab."** Check **Admin → Dashboard tab access** for their role. Owners always see everything.
- **"My edit — will others see it?"** Yes; notes and calls sync to the shared store and are attributed to you with a timestamp.
- **"Historical tab is missing."** It only appears when **historical-slot** data has been loaded.
- **"Large CSV won't upload."** Zip it and upload the `.zip` — the server unzips it automatically.

---

*End of guide. Each `##` section is slide-ready. Relabel by replacing "AI Compass" throughout.*
