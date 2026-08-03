-- =============================================================================
-- Renewals Studio — ACTIVE slot source query (self-dynamic, parameterized)
-- =============================================================================
--
-- Purpose
--   Drop-in replacement for the "active" CSV upload. Emits the same columns the
--   dashboard consumes (see seeds/active.csv header and app.js FIELD_KEYS). The
--   ONLY behavioral changes vs. the user's original hand-written query are the
--   three brittle, hardcoded spots — everything else (every column, join, CASE,
--   the _PLUS1.._PLUS4 selection, Upside/Downside, band, etc.) is reproduced
--   verbatim so the output header names match the CSV exactly:
--
--     1) future_dates: the hardcoded VALUES list of 7 quarter-end dates is now a
--        GENERATED series relative to the current fiscal quarter.
--     2) year_quarter: the hardcoded relabel CASE ('Q425'->'Q4`26', ...) plus the
--        `WHERE year_quarter != 'Q425'` are replaced by computed FY arithmetic.
--     3) ARR thresholds (75000) and band cutoff (100000) are bind parameters.
--
-- Fiscal calendar (Zendesk): FY ends Jan 31.
--   Q1 = Feb-Apr (q-end Apr 30)   Q2 = May-Jul (Jul 31)
--   Q3 = Aug-Oct (Oct 31)         Q4 = Nov-Jan (Jan 31)
--   The Jan quarter-end belongs to the FY that STARTED the prior Feb, so the
--   internal fiscal-year number (`dates_fy`) uses YEAR-1 for a Jan q-end. The
--   DISPLAYED label uses the fiscal-year-END convention, i.e. dates_fy + 1
--   (verified against seeds/active.csv: labels are `Q1`27` .. `Q4`27`).
--
-- year_quarter output format  (evidence: seeds/active.csv YEAR_QUARTER column)
--   The dashboard expects  Q<qnum>`<yy>  with a BACKTICK, e.g.  Q2`27 .
--   Distinct seed values: 'Q1`27','Q2`27','Q3`27','Q4`27'. The relabel CASE in
--   the original was uniformly display = raw_fy + 1, so we emit it directly.
--
-- Bind variables (see the `params` CTE). Paramstyle = 'qmark' (positional '?').
-- Each bind appears EXACTLY ONCE (in `params`); every other reference reads the
-- value back out of the CTE — so values are never repeated and the '%' in the
-- LIKE '%top 3000%' patterns needs no escaping (which is why we avoid the
-- pyformat '%(name)s' default).
--
--   ?  #1  as_of_date       DATE  | default = NULL => use is_most_recent snapshot
--                                  |   (pass a date from the app's picker to view
--                                  |    the latest snapshot on/before that date)
--   ?  #2  quarters_back     INT   | default = 1  (how many quarters before current)
--   ?  #3  quarters_forward  INT   | default = 4  (how many quarters after current)
--   ?  #4  min_arr           NUMBER| default = 75000  (row inclusion threshold)
--   ?  #5  band_cutoff       NUMBER| default = 100000 ('100k+' vs '<100k')
--
--   The FastAPI layer runs, e.g.:
--       import snowflake.connector
--       snowflake.connector.paramstyle = 'qmark'
--       cur.execute(open('sql/active_dynamic.sql').read(),
--                   [as_of_date, quarters_back, quarters_forward, min_arr, band_cutoff])
--   Passing [None, 1, 4, 75000, 100000] reproduces TODAY's output exactly:
--   quarters -1..+4 => Q1`27, Q2`27, Q3`27, Q4`27, Q1`28, Q2`28.
--
--   The original generated an extra quarter at offset -2 (raw 'Q425' / display
--   `Q4`26`) and then discarded it via `WHERE year_quarter != 'Q425'`. Netting
--   the same 6 quarters, we simply do not generate offset -2 (quarters_back = 1),
--   so no post-filter is needed.
--
-- Source tables (for the Snowflake-admin connection details):
--   FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD        (base facts)
--   CLEANSED.SALESFORCE.SALESFORCE_ACCOUNT_BCV                        (customer)
--   CLEANSED.GAINSIGHT.GAINSIGHT_COMPANY_BCV                          (CS engagement)
--   FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED (products)
-- =============================================================================

WITH params AS (
    -- The ONLY place the bind placeholders appear. Everything else reads these.
    SELECT
        TO_DATE(?) AS as_of_date_in,      -- #1  NULL => is_most_recent
        ?::INT     AS quarters_back,      -- #2  1
        ?::INT     AS quarters_forward,   -- #3  4
        ?::NUMBER  AS min_arr,            -- #4  75000
        ?::NUMBER  AS band_cutoff         -- #5  100000
),

current_dt AS (
    -- "Current" snapshot date. Default (as_of_date NULL) == the original
    -- `WHERE is_most_recent = TRUE LIMIT 1`. If the app passes a date, we take the
    -- latest real snapshot on/before it (must be a real service_date so the join
    -- to the enriched fact table on service_date still resolves).
    SELECT MAX(service_date) AS current_date
    FROM FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD
    WHERE ( (SELECT as_of_date_in FROM params) IS NULL     AND is_most_recent = TRUE )
       OR ( (SELECT as_of_date_in FROM params) IS NOT NULL AND service_date <= (SELECT as_of_date_in FROM params) )
),

future_dates AS (
    -- Dynamic replacement for the hardcoded VALUES list of 7 quarter-ends.
    -- Generate one date per quarter for offsets -quarters_back .. +quarters_forward
    -- around the current fiscal quarter-end. The exact day does not matter: the
    -- `base` CTE below canonicalizes each date to its fiscal quarter-end via
    -- MONTH(f.dates), exactly as the original did with the literal dates.
    SELECT DATEADD('quarter', o.q_offset, cq.current_q_end) AS dates
    FROM (
        SELECT (g.n - p.quarters_back) AS q_offset
        FROM params p
        CROSS JOIN (
            SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1 AS n
            FROM TABLE(GENERATOR(ROWCOUNT => 100))       -- generous upper bound on span
        ) g
        WHERE g.n <= (p.quarters_back + p.quarters_forward)
    ) o
    CROSS JOIN (
        SELECT
            CASE
                WHEN MONTH(cd.current_date) IN (2, 3, 4)   THEN DATE_FROM_PARTS(YEAR(cd.current_date),      4, 30)
                WHEN MONTH(cd.current_date) IN (5, 6, 7)   THEN DATE_FROM_PARTS(YEAR(cd.current_date),      7, 31)
                WHEN MONTH(cd.current_date) IN (8, 9, 10)  THEN DATE_FROM_PARTS(YEAR(cd.current_date),     10, 31)
                WHEN MONTH(cd.current_date) = 1            THEN DATE_FROM_PARTS(YEAR(cd.current_date),      1, 31)
                ELSE DATE_FROM_PARTS(YEAR(cd.current_date) + 1, 1, 31)
            END AS current_q_end
        FROM current_dt cd
    ) cq
),

base AS (
    SELECT
        f.dates,
        c.current_date AS service_date,
        /* Custom Fiscal logic for Quarter Ends */
        CASE
            WHEN MONTH(f.dates) IN (2, 3, 4)  THEN DATE_FROM_PARTS(YEAR(f.dates), 4, 30)
            WHEN MONTH(f.dates) IN (5, 6, 7)  THEN DATE_FROM_PARTS(YEAR(f.dates), 7, 31)
            WHEN MONTH(f.dates) IN (8, 9, 10) THEN DATE_FROM_PARTS(YEAR(f.dates), 10, 31)
            WHEN MONTH(f.dates) = 1           THEN DATE_FROM_PARTS(YEAR(f.dates), 1, 31)
            ELSE DATE_FROM_PARTS(YEAR(f.dates) + 1, 1, 31)
        END AS dates_q_end,
        CASE
            WHEN MONTH(c.current_date) IN (2, 3, 4)  THEN DATE_FROM_PARTS(YEAR(c.current_date), 4, 30)
            WHEN MONTH(c.current_date) IN (5, 6, 7)  THEN DATE_FROM_PARTS(YEAR(c.current_date), 7, 31)
            WHEN MONTH(c.current_date) IN (8, 9, 10) THEN DATE_FROM_PARTS(YEAR(c.current_date), 10, 31)
            WHEN MONTH(c.current_date) = 1           THEN DATE_FROM_PARTS(YEAR(c.current_date), 1, 31)
            ELSE DATE_FROM_PARTS(YEAR(c.current_date) + 1, 1, 31)
        END AS current_q_end
    FROM future_dates f
    CROSS JOIN current_dt c
),

idx AS (
    SELECT
        dates,
        service_date,
        dates_q_end,
        current_q_end,
        CASE MONTH(dates_q_end)   WHEN 4 THEN 1 WHEN 7 THEN 2 WHEN 10 THEN 3 WHEN 1 THEN 4 END AS dates_qnum,
        CASE MONTH(current_q_end) WHEN 4 THEN 1 WHEN 7 THEN 2 WHEN 10 THEN 3 WHEN 1 THEN 4 END AS current_qnum,
        CASE WHEN MONTH(dates_q_end)   = 1 THEN YEAR(dates_q_end)   - 1 ELSE YEAR(dates_q_end)   END AS dates_fy,
        CASE WHEN MONTH(current_q_end) = 1 THEN YEAR(current_q_end) - 1 ELSE YEAR(current_q_end) END AS current_fy
    FROM base
),

structure AS (
    SELECT
        dates,
        service_date,
        ((dates_fy * 4 + dates_qnum) - (current_fy * 4 + current_qnum)) AS quarter_diff,
        -- Dynamic replacement for the hardcoded relabel CASE + `!= 'Q425'` filter.
        -- Displayed label uses the fiscal-year-END convention (dates_fy + 1),
        -- with a literal backtick, matching seeds/active.csv (e.g. 'Q2`27').
        CONCAT('Q', dates_qnum, '`', RIGHT(TO_VARCHAR(dates_fy + 1), 2)) AS year_quarter
    FROM idx
    ORDER BY dates
),

customer AS (
    SELECT
        id,
        name,
        CASE WHEN lower(TOP_3_000_COHORT_C) LIKE '%top 3000%' THEN 'Y' ELSE 'N' END AS flag_3k,
        TERRITORY_INDUSTRY_C,
        BILLING_COUNTRY
    FROM cleansed.salesforce.SALESFORCE_ACCOUNT_BCV
    --where lower(TARGET_LIST_C) like '%top 3000%'
    GROUP BY 1, 2, 3, 4, 5
),

GSdata AS (
    SELECT
        SFDC_ACCOUNT_ID,
        REGION_GC,
        DAYS_SINCE_LAST_CS_ENGAGED_GC,
        LAST_CS_ENGAGEMENT_DATE_GC
    FROM cleansed.gainsight.GAINSIGHT_COMPANY_BCV
    --where REGION_GC = 'APAC'
),

prod AS (
    SELECT
        service_date,
        CRM_ACCOUNT_ID,
        /* Pre-calculate the Fiscal Quarter Grouping here */
        DATE_TRUNC('quarter', DATEADD('month', -1, SUBSCRIPTION_TERM_END_DATE)) AS fiscal_quarter_group,
        MIN(SUBSCRIPTION_TERM_END_DATE) AS renewal_date,
        SUM(NET_ARR_USD) AS quarter_arr,
        LISTAGG(DISTINCT PRODUCT_LINE, ', ') WITHIN GROUP (ORDER BY PRODUCT_LINE) AS PRODUCT_LINES
    FROM FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED
    WHERE is_most_recent = true
      --AND pro_forma_region = 'APAC'
    GROUP BY 1, 2, 3
),

proddate AS (
    SELECT
        service_date,
        crm_account_id,
        any_value(largest_renewal_date) AS largest_renewal_date
    FROM (
        SELECT
            service_date,
            a.crm_account_id,
            --, b.crm_account_name
            first_value(SUBSCRIPTION_TERM_END_DATE_PRIOR_QUARTER_END)
                over(partition by a.crm_account_id order by a.net_arr_usd desc) AS largest_renewal_date
        FROM FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED a
        WHERE is_most_recent = true
    )
    GROUP BY 1, 2
),

main_data AS (
    SELECT
        s.*,
        c6.crm_account_id,
        c6.crm_account_name,
        c6.pro_forma_region AS region,
        c6.pro_forma_market_segment,
        c6.PRO_FORMA_SUBREGION,
        c6.TERM_GROUPED,
        c6.CRM_HEALTH_STATUS,
        c6.CRM_OWNER_NAME,
        c6.crm_owner_manager_name,
        c6.CRM_SUCCESS_OWNER_NAME,
        c6.MANAGER_SUCCESS,
        c6.CRM_RENEWAL_OWNER_NAME,
        c6.manager_renewal,
        c6.CTC_RAMP_DEAL_C,
        c6.CTC_AUTO_RENEW_C,
        pr.renewal_date AS NEXT_RENEWAL_DATE,
        pp.largest_renewal_date AS largest_renewal_date,
        c.flag_3k,
        c.TERRITORY_INDUSTRY_C,
        c.BILLING_COUNTRY,
        pr.product_lines,
        CASE WHEN s.quarter_diff <= 0
             THEN (CASE WHEN c6.net_arr_usd_prior_quarter_end >= pm.band_cutoff THEN '100k+' ELSE '<100k' END)
             ELSE (CASE WHEN c6.net_arr_usd                   >= pm.band_cutoff THEN '100k+' ELSE '<100k' END)
        END AS band,
        gs.DAYS_SINCE_LAST_CS_ENGAGED_GC AS days_since_last_CS_touch,
        CASE WHEN s.quarter_diff = 0 THEN c6.RENEWAL_DONE_DEAL_C ELSE NULL END AS done_deal,
        CASE WHEN s.quarter_diff <= 0 THEN c6.FC_DICTATED_BY
             WHEN s.quarter_diff = 1 THEN c6.FC_DICTATED_BY_PLUS1
             WHEN s.quarter_diff = 2 THEN c6.FC_DICTATED_BY_PLUS2
             WHEN s.quarter_diff = 3 THEN c6.FC_DICTATED_BY_PLUS3
             WHEN s.quarter_diff = 4 THEN c6.FC_DICTATED_BY_PLUS4
             ELSE NULL END AS Dictated_by,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.NET_ARR_USD_PRIOR_QUARTER_END ELSE c6.net_arr_usd END) AS net_arr_usd_prior_qtr_end,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.ATR_ARR_USD_STARTING
                 WHEN s.quarter_diff = 1 THEN c6.ATR_ARR_USD_STARTING_PLUS1
                 WHEN s.quarter_diff = 2 THEN c6.ATR_ARR_USD_STARTING_PLUS2
                 WHEN s.quarter_diff = 3 THEN c6.ATR_ARR_USD_STARTING_PLUS3
                 WHEN s.quarter_diff = 4 THEN c6.ATR_ARR_USD_STARTING_PLUS4
                 ELSE NULL END) AS atr_arr_usd_starting,
        SUM(CASE WHEN s.quarter_diff < 0 THEN c6.qtd_cc
                 WHEN s.quarter_diff = 0 THEN c6.BU_FC
                 WHEN s.quarter_diff = 1 THEN c6.BU_FC_PLUS1
                 WHEN s.quarter_diff = 2 THEN c6.BU_FC_PLUS2
                 WHEN s.quarter_diff = 3 THEN c6.BU_FC_PLUS3
                 WHEN s.quarter_diff = 4 THEN c6.BU_FC_PLUS4
                 ELSE NULL END) AS BU_FC,
        SUM(CASE WHEN s.quarter_diff = 0 THEN c6.ATR_ARR_USD_LTG ELSE NULL END) AS ATR_ARR_USD_LTG,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.qtd_cc ELSE NULL END) AS qtd_cc,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.CC_OFFCYCLE_ARR ELSE NULL END) AS CC_OFFCYCLE_ARR,
        SUM(CASE WHEN s.quarter_diff = 0 THEN c6.FC_REMAINING ELSE NULL END) AS FC_REMAINING,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.BU_FC_ONCYCLE
                 WHEN s.quarter_diff = 1 THEN (CASE WHEN c6.BU_FC_PLUS1 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS1, 0) THEN c6.ATR_ARR_USD_STARTING_PLUS1 ELSE c6.BU_FC_PLUS1 END)
                 WHEN s.quarter_diff = 2 THEN (CASE WHEN c6.BU_FC_PLUS2 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS2, 0) THEN c6.ATR_ARR_USD_STARTING_PLUS2 ELSE c6.BU_FC_PLUS2 END)
                 WHEN s.quarter_diff = 3 THEN (CASE WHEN c6.BU_FC_PLUS3 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS3, 0) THEN c6.ATR_ARR_USD_STARTING_PLUS3 ELSE c6.BU_FC_PLUS3 END)
                 WHEN s.quarter_diff = 4 THEN (CASE WHEN c6.BU_FC_PLUS4 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS4, 0) THEN c6.ATR_ARR_USD_STARTING_PLUS4 ELSE c6.BU_FC_PLUS4 END)
                 ELSE NULL END) AS FC_ONCYCLE,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.BU_FC_OFFCYCLE
                 WHEN s.quarter_diff = 1 THEN (CASE WHEN c6.BU_FC_PLUS1 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS1, 0) THEN c6.BU_FC_PLUS1 - COALESCE(c6.ATR_ARR_USD_STARTING_PLUS1, 0) ELSE 0 END)
                 WHEN s.quarter_diff = 2 THEN (CASE WHEN c6.BU_FC_PLUS2 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS2, 0) THEN c6.BU_FC_PLUS2 - COALESCE(c6.ATR_ARR_USD_STARTING_PLUS2, 0) ELSE 0 END)
                 WHEN s.quarter_diff = 3 THEN (CASE WHEN c6.BU_FC_PLUS3 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS3, 0) THEN c6.BU_FC_PLUS3 - COALESCE(c6.ATR_ARR_USD_STARTING_PLUS3, 0) ELSE 0 END)
                 WHEN s.quarter_diff = 4 THEN (CASE WHEN c6.BU_FC_PLUS4 >= COALESCE(c6.ATR_ARR_USD_STARTING_PLUS4, 0) THEN c6.BU_FC_PLUS4 - COALESCE(c6.ATR_ARR_USD_STARTING_PLUS4, 0) ELSE 0 END)
                 ELSE NULL END) AS FC_OFFCYCLE,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.FC_UPSIDE
                 WHEN s.quarter_diff = 1 THEN c6.BU_BC_PLUS1 - BU_FC_PLUS1
                 WHEN s.quarter_diff = 2 THEN c6.BU_BC_PLUS2 - BU_FC_PLUS2
                 WHEN s.quarter_diff = 3 THEN c6.BU_BC_PLUS3 - BU_FC_PLUS3
                 WHEN s.quarter_diff = 4 THEN c6.BU_BC_PLUS4 - BU_FC_PLUS4
                 ELSE NULL END) AS Upside,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.FC_DOWNSIDE
                 WHEN s.quarter_diff = 1 THEN c6.BU_WC_PLUS1 - BU_FC_PLUS1
                 WHEN s.quarter_diff = 2 THEN c6.BU_WC_PLUS2 - BU_FC_PLUS2
                 WHEN s.quarter_diff = 3 THEN c6.BU_WC_PLUS3 - BU_FC_PLUS3
                 WHEN s.quarter_diff = 4 THEN c6.BU_WC_PLUS4 - BU_FC_PLUS4
                 ELSE NULL END) AS Downside,
        CASE WHEN s.quarter_diff <= 0 THEN c6.RENEWAL_FORECAST_SUMMARIES
             WHEN s.quarter_diff = 1 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS1
             WHEN s.quarter_diff = 2 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS2
             WHEN s.quarter_diff = 3 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS3
             WHEN s.quarter_diff = 4 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS4
             ELSE NULL END AS forecast_summary
    FROM structure s
    CROSS JOIN params pm                 -- 1-row table; exposes min_arr / band_cutoff as plain columns
    LEFT JOIN FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD c6
        ON c6.service_date = s.service_date
    LEFT JOIN customer c ON c6.crm_account_id = c.id
    LEFT JOIN GSdata gs ON c6.crm_account_id = gs.SFDC_ACCOUNT_ID
    LEFT JOIN prod pr
        ON c6.crm_account_id = pr.crm_account_id
       AND pr.fiscal_quarter_group = DATE_TRUNC('quarter', DATEADD('month', -1, s.dates))
    LEFT JOIN proddate pp ON c6.crm_account_id = pp.crm_account_id
    WHERE --c6.pro_forma_region = 'APAC'
        (c6.net_arr_usd >= pm.min_arr OR c6.net_arr_usd_prior_quarter_end >= pm.min_arr)
    GROUP BY ALL
)

SELECT
    year_quarter,                       -- already the display label (e.g. 'Q2`27'); no relabel CASE needed
    crm_account_id,
    crm_account_name,
    band,
    Dictated_by,
    net_arr_usd_prior_qtr_end,
    atr_arr_usd_starting,
    ATR_ARR_USD_LTG,
    BU_FC,
    qtd_cc,
    CC_OFFCYCLE_ARR,
    FC_REMAINING,
    FC_ONCYCLE,
    FC_OFFCYCLE,
    Upside,
    Downside,
    region,
    pro_forma_market_segment,
    PRO_FORMA_SUBREGION,
    TERM_GROUPED,
    CRM_HEALTH_STATUS,
    CRM_OWNER_NAME,
    crm_owner_manager_name,
    CRM_SUCCESS_OWNER_NAME,
    MANAGER_SUCCESS,
    CRM_RENEWAL_OWNER_NAME,
    manager_renewal,
    CTC_RAMP_DEAL_C AS ramp_deal,
    CTC_AUTO_RENEW_C AS auto_renew,
    NEXT_RENEWAL_DATE,
    largest_renewal_date,
    done_deal,
    flag_3k,
    TERRITORY_INDUSTRY_C,
    BILLING_COUNTRY,
    days_since_last_CS_touch,
    product_lines,
    forecast_summary
FROM main_data
-- Original had `WHERE year_quarter != 'Q425'` to drop the extra offset -2 quarter;
-- we no longer generate it (quarters_back = 1), so no filter is required.
;
