-- =============================================================================
-- Renewals Studio — HISTORICAL slot source query (self-dynamic, parameterized)
-- =============================================================================
--
-- Purpose
--   Drop-in replacement for the "historical" CSV upload. Emits the same columns
--   the dashboard consumes (see seeds/historical.csv header and app.js FIELD_KEYS).
--   The ONLY behavioral changes vs. the user's original hand-written query are:
--     * the four hardcoded '2026-02-01' anchor dates are now DERIVED from the
--       current fiscal quarter, so the query rolls forward automatically; and
--     * the '100k+' band cutoff (100000) is now a bind parameter.
--   Every column, join, and CASE is otherwise reproduced verbatim so the output
--   header names match the CSV exactly and the compiled React app is unchanged.
--
-- Fiscal calendar (Zendesk): FY ends Jan 31.
--   Q1 = Feb-Apr   Q2 = May-Jul   Q3 = Aug-Oct   Q4 = Nov-Jan
--   The Jan quarter-end belongs to the FY that STARTED the prior Feb.
--
-- Bind variables (see the `params` CTE below). Paramstyle = 'qmark' (positional
-- '?'). Each bind appears EXACTLY ONCE (in `params`); every other reference reads
-- the value back out of the CTE, so there is no need to repeat a value or to
-- escape the '%' characters in the LIKE patterns further down (which is why we
-- avoid the pyformat '%(name)s' default — it would collide with LIKE '%top 3000%').
--
--   ?  #1  as_of_date     DATE  | default = CURRENT_DATE() (pass NULL to use today,
--                                |           or the app's date-picker value)
--   ?  #2  quarters_back  INT   | default = 0  (0 = start of the CURRENT fiscal
--                                |               quarter; N = go N quarters back)
--   ?  #3  band_cutoff    NUMBER| default = 100000
--
--   The FastAPI layer runs, e.g.:
--       import snowflake.connector
--       snowflake.connector.paramstyle = 'qmark'
--       cur.execute(open('sql/historical_dynamic.sql').read(),
--                   [as_of_date, quarters_back, band_cutoff])
--   Passing [None, 0, 100000] reproduces the current-quarter default exactly.
--
-- Source tables (for the Snowflake-admin connection details):
--   FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD        (base facts)
--   CLEANSED.SALESFORCE.SALESFORCE_ACCOUNT_SCD2                       (customer SCD2)
--   CLEANSED.GAINSIGHT.GAINSIGHT_COMPANY_SCD2                         (CS engagement)
--   FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED (products)
--   CLEANSED.SALESFORCE.SALESFORCE_CONTRACT_FORMULA_BCV / _ACCOUNT_BCV (partner)
-- =============================================================================

WITH params AS (
    -- The ONLY place the bind placeholders appear. Everything else reads these.
    SELECT
        TO_DATE(?)  AS as_of_date_in,   -- #1  NULL => today
        ?::INT      AS quarters_back,   -- #2  0    => start of current fiscal quarter
        ?::NUMBER   AS band_cutoff      -- #3  100000
),
asof AS (
    SELECT
        COALESCE(as_of_date_in, CURRENT_DATE()) AS as_of_date,
        quarters_back,
        band_cutoff
    FROM params
),
anchor AS (
    -- Dynamic replacement for the hardcoded '2026-02-01'.
    -- '2026-02-01' was the start of the fiscal quarter (Q1, Feb 1) in which the
    -- query was authored. We recompute the current fiscal-quarter start from
    -- as_of_date and step back `quarters_back` quarters.
    --
    -- NOTE: Feb 1 is also the fiscal-YEAR start. If the historical slot is meant
    -- to be fiscal-year-to-date (all quarter-ends since Feb 1) rather than just
    -- the current quarter, either pass quarters_back = (# quarters elapsed this FY)
    -- or swap the CASE below for the fiscal-year-start variant:
    --   DATE_FROM_PARTS(CASE WHEN MONTH(as_of_date)=1 THEN YEAR(as_of_date)-1
    --                        ELSE YEAR(as_of_date) END, 2, 1)
    SELECT
        DATEADD('quarter', -quarters_back,
            CASE
                WHEN MONTH(as_of_date) IN (2, 3, 4)   THEN DATE_FROM_PARTS(YEAR(as_of_date),     2, 1)
                WHEN MONTH(as_of_date) IN (5, 6, 7)   THEN DATE_FROM_PARTS(YEAR(as_of_date),     5, 1)
                WHEN MONTH(as_of_date) IN (8, 9, 10)  THEN DATE_FROM_PARTS(YEAR(as_of_date),     8, 1)
                WHEN MONTH(as_of_date) IN (11, 12)    THEN DATE_FROM_PARTS(YEAR(as_of_date),    11, 1)
                WHEN MONTH(as_of_date) = 1            THEN DATE_FROM_PARTS(YEAR(as_of_date) - 1, 11, 1)
            END
        )                        AS anchor_date,
        as_of_date               AS end_date,     -- was CURRENT_DATE() in the contract CTE
        band_cutoff
    FROM asof
),

base AS (
    SELECT *
    FROM FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD
    WHERE service_date > (SELECT anchor_date FROM anchor)          -- was '2026-02-01'
      AND (is_quarter_end = TRUE OR is_most_recent = TRUE)
      AND NOT (net_arr_usd = 0 AND net_arr_usd_prior_quarter_end = 0)
      AND qtd_cc > 0
),

customer AS (
    SELECT
        TO_DATE(VALID_FROM_TIMESTAMP) AS valid_from_timestamp,
        TO_DATE(VALID_TO_TIMESTAMP)   AS valid_to_timestamp,
        id,
        CASE WHEN LOWER(TARGET_LIST_C) LIKE '%top 3000%' THEN 'Y' ELSE 'N' END AS flag_3k,
        TERRITORY_INDUSTRY_C,
        BILLING_COUNTRY,
        ACCOUNT_HEALTH_RISK_TYPE_C
    FROM cleansed.salesforce.SALESFORCE_ACCOUNT_SCD2
    WHERE VALID_TO_TIMESTAMP >= (SELECT anchor_date FROM anchor)   -- was '2026-02-01'
      AND id IN (SELECT crm_account_id FROM base)
),

gsdata AS (
    SELECT
        TO_DATE(VALID_FROM_TIMESTAMP) AS valid_from_timestamp,
        TO_DATE(VALID_TO_TIMESTAMP)   AS valid_to_timestamp,
        SFDC_ACCOUNT_ID,
        DAYS_SINCE_LAST_CS_ENGAGED_GC
    FROM cleansed.gainsight.GAINSIGHT_COMPANY_SCD2
    WHERE VALID_TO_TIMESTAMP >= (SELECT anchor_date FROM anchor)   -- was '2026-02-01'
      AND SFDC_ACCOUNT_ID IN (SELECT crm_account_id FROM base)
),

prod AS (
    SELECT
        service_date,
        CRM_ACCOUNT_ID,
        LAST_DAY(SUBSCRIPTION_TERM_END_DATE_PRIOR_QUARTER_END, 'Quarter') AS subscription_term_end_date,
        LISTAGG(DISTINCT PRODUCT_LINE, ', ') WITHIN GROUP (ORDER BY PRODUCT_LINE) AS product_lines
    FROM FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED
    WHERE service_date > (SELECT anchor_date FROM anchor)          -- was '2026-02-01'
      AND (is_quarter_end = TRUE OR is_most_recent = TRUE)
      AND CRM_ACCOUNT_ID IN (SELECT crm_account_id FROM base)
    GROUP BY 1, 2, 3
),

contract AS (
    SELECT DISTINCT
        a.ACCOUNT_ID,
        c.name,
        c.PARTNER_TYPE_C,
        LAST_DAY(a.start_date, 'quarter') AS start_date
    FROM cleansed.salesforce.salesforce_contract_formula_bcv a
    LEFT JOIN CLEANSED.SALESFORCE.SALESFORCE_ACCOUNT_BCV c
        ON a.partner_c = c.id
    WHERE a.start_date BETWEEN (SELECT anchor_date FROM anchor)     -- was '2026-02-01'
                          AND (SELECT end_date    FROM anchor)     -- was CURRENT_DATE()
      AND a.SOURCE_OPPORTUNITY_DEAL_TYPE_C IN ('Resell', 'Reverse Resell', 'BPO', 'Internal Use')
      AND a.PARTNER_C IS NOT NULL
      AND a.ACCOUNT_ID IN (SELECT crm_account_id FROM base)
)

SELECT
    c6.YEAR_QUARTER_YYYYQQ,                                          -- already YYYYQQ (e.g. '2027Q1') — the format the dashboard expects
    c6.crm_account_id,
    c6.crm_account_name,
    CASE WHEN c6.net_arr_usd_prior_quarter_end >= (SELECT band_cutoff FROM anchor)
         THEN '100k+' ELSE '<100k' END      AS band,               -- was hardcoded 100000
    c6.FC_DICTATED_BY                        AS dictated_by,
    c6.NET_ARR_USD_PRIOR_QUARTER_END         AS net_arr_usd_prior_qtr_end,
    c6.NET_ARR_USD                           AS net_arr_usd,
    c6.ATR_ARR_USD_STARTING                  AS atr_arr_usd_starting,
    c6.bu_fc                                 AS BU_FC,
    c6.qtd_cc                                AS CC,
    c6.CC_OFFCYCLE_ARR,
    c6.exp_arr                               AS Expansion,
    c6.pro_forma_region                      AS region,
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
    c6.CTC_RAMP_DEAL_C                       AS ramp_deal,
    c6.CTC_AUTO_RENEW_C                      AS auto_renew,
    c6.NEXT_RENEWAL_DATE,
    c6.RENEWAL_DONE_DEAL_C                   AS done_deal,
    c.flag_3k,
    c.TERRITORY_INDUSTRY_C,
    c.BILLING_COUNTRY,
    gs.DAYS_SINCE_LAST_CS_ENGAGED_GC         AS days_since_last_CS_touch,
    pr.product_lines,
    c6.RENEWAL_FORECAST_SUMMARIES            AS forecast_summary,
    c.ACCOUNT_HEALTH_RISK_TYPE_C             AS cc_reason,
    cc.name                                  AS Partner_name,
    cc.PARTNER_TYPE_C
FROM base c6
LEFT JOIN customer c
    ON c6.crm_account_id = c.id
   AND c6.service_date >= c.valid_from_timestamp
   AND c6.service_date <  c.valid_to_timestamp
LEFT JOIN gsdata gs
    ON c6.crm_account_id = gs.SFDC_ACCOUNT_ID
   AND c6.service_date >= gs.valid_from_timestamp
   AND c6.service_date <  gs.valid_to_timestamp
LEFT JOIN prod pr
    ON c6.crm_account_id = pr.CRM_ACCOUNT_ID
   AND c6.service_date = pr.service_date
   AND pr.subscription_term_end_date = LAST_DAY(c6.service_date, 'Quarter')
LEFT JOIN contract cc
    ON c6.crm_account_id = cc.account_id
   AND LAST_DAY(c6.service_date, 'quarter') = cc.start_date
;
