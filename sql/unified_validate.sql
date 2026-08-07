-- =============================================================================
-- Renewals Studio - UNIFIED source query (LOCAL VALIDATION COPY)
-- Generated from unified_dynamic.sql with the 4 binds replaced by their default
-- literals so it runs standalone in a Snowflake worksheet. Do NOT ship; the app
-- uses unified_dynamic.sql with binds.
-- =============================================================================

WITH params AS (
    -- LOCAL-VALIDATION LITERALS (replace the app's binds so this runs
    -- standalone in a Snowflake worksheet). These are the app's defaults.
    SELECT
        8::INT         AS n_past,
        4::INT         AS n_future,
        10000::NUMBER  AS min_arr,
        100000::NUMBER AS band_cutoff
),

current_dt AS (
    SELECT service_date AS current_snapshot_date
    FROM FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD
    WHERE is_most_recent = TRUE
    QUALIFY ROW_NUMBER() OVER (ORDER BY service_date DESC) = 1
),

current_rev_dt AS (
    SELECT MAX(service_date) AS rev_snapshot_date
    FROM FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED
    WHERE is_most_recent = TRUE
),


current_anchor AS (
    SELECT
        c.current_snapshot_date,
        r.rev_snapshot_date,
        CASE
            WHEN MONTH(c.current_snapshot_date) IN (2,3,4)  THEN DATE_FROM_PARTS(YEAR(c.current_snapshot_date), 4, 30)
            WHEN MONTH(c.current_snapshot_date) IN (5,6,7)  THEN DATE_FROM_PARTS(YEAR(c.current_snapshot_date), 7, 31)
            WHEN MONTH(c.current_snapshot_date) IN (8,9,10) THEN DATE_FROM_PARTS(YEAR(c.current_snapshot_date), 10, 31)
            WHEN MONTH(c.current_snapshot_date) = 1         THEN DATE_FROM_PARTS(YEAR(c.current_snapshot_date), 1, 31)
            ELSE DATE_FROM_PARTS(YEAR(c.current_snapshot_date) + 1, 1, 31)
        END AS current_q_end
    FROM current_dt c
    CROSS JOIN current_rev_dt r
),


offsets AS (
    SELECT p.n_past, p.n_future, seq.value AS q_offset
    FROM params p,
         LATERAL (
             SELECT ROW_NUMBER() OVER (ORDER BY NULL) - 1 - p.n_past AS value
             FROM TABLE(GENERATOR(ROWCOUNT => 32))
             QUALIFY value <= p.n_future
         ) seq
),

future_dates AS (
    SELECT
        o.q_offset,
        
        LAST_DAY(DATEADD('month', 3,
            DATEADD('quarter', o.q_offset,
                DATE_TRUNC('quarter', DATEADD('month', -1, a.current_q_end)))
        )) AS dates_q_end
    FROM offsets o
    CROSS JOIN current_anchor a
),

structure AS (
    SELECT
        f.dates_q_end                       AS dates,
        a.current_snapshot_date              AS service_date,
        a.rev_snapshot_date,
        f.dates_q_end,
        f.q_offset                           AS quarter_diff,
        CASE MONTH(f.dates_q_end) WHEN 4 THEN 1 WHEN 7 THEN 2 WHEN 10 THEN 3 WHEN 1 THEN 4 END AS dates_qnum,
        CASE WHEN MONTH(f.dates_q_end) = 1 THEN YEAR(f.dates_q_end) - 1 ELSE YEAR(f.dates_q_end) END AS dates_fy,
        
        CONCAT('Q',
               CASE MONTH(f.dates_q_end) WHEN 4 THEN 1 WHEN 7 THEN 2 WHEN 10 THEN 3 WHEN 1 THEN 4 END,
               '`',
               RIGHT(TO_VARCHAR(
                   CASE WHEN MONTH(f.dates_q_end) = 1 THEN YEAR(f.dates_q_end)
                        ELSE YEAR(f.dates_q_end) + 1 END), 2)
        ) AS year_quarter,
       
        CASE WHEN f.q_offset < 0 THEN f.dates_q_end ELSE a.current_snapshot_date END AS snapshot_date,
        CASE WHEN f.q_offset < 0 THEN f.dates_q_end ELSE a.rev_snapshot_date      END AS rev_join_date
    FROM future_dates f
    CROSS JOIN current_anchor a
),


rev_dates AS (
    SELECT DISTINCT rev_join_date FROM structure
),

customer AS (
    SELECT
        id,
        name,
        CASE WHEN LOWER(TARGET_LIST_C) LIKE '%top 3000%' THEN 'Y' ELSE 'N' END AS flag_3k,
        TERRITORY_INDUSTRY_C,
        TERRITORY_SUB_INDUSTRY_C,
        BILLING_COUNTRY,
        ACCOUNT_HEALTH_RISK_TYPE_C
    FROM cleansed.salesforce.SALESFORCE_ACCOUNT_BCV
    GROUP BY 1,2,3,4,5,6,7
),


GSdata AS (
    SELECT
        SFDC_ACCOUNT_ID,
        REGION_GC,
        DAYS_SINCE_LAST_CS_ENGAGED_GC,
        LAST_CS_ENGAGEMENT_DATE_GC,
        PARTNER_MANAGED_ACCOUNT_GC AS partner_managed
    FROM cleansed.gainsight.GAINSIGHT_COMPANY_BCV
),

prod AS (
    SELECT
        service_date,
        CRM_ACCOUNT_ID,
        DATE_TRUNC('quarter', DATEADD('month', -1, SUBSCRIPTION_TERM_END_DATE)) AS fiscal_quarter_group,
        MIN(SUBSCRIPTION_TERM_END_DATE) AS renewal_date,
        SUM(NET_ARR_USD)                AS quarter_arr,
        LISTAGG(DISTINCT PRODUCT_LINE, ', ') WITHIN GROUP (ORDER BY PRODUCT_LINE) AS PRODUCT_LINES
    FROM FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED
    WHERE service_date IN (SELECT rev_join_date FROM rev_dates)
    GROUP BY 1, 2, 3
),


atr AS (
    SELECT
        service_date,
        crm_account_id,
        DATE_TRUNC('quarter', DATEADD('month', -1, SUBSCRIPTION_TERM_END_DATE)) AS fiscal_quarter_group,
        SUM(NET_ARR_USD) AS atr_arr_usd_starting_calc
    FROM FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED
    WHERE service_date IN (SELECT rev_join_date FROM rev_dates)
    GROUP BY 1, 2, 3
),

proddate AS (
    SELECT
        service_date,
        crm_account_id,
        ANY_VALUE(largest_renewal_date) AS largest_renewal_date
    FROM (
        SELECT
            service_date,
            a.crm_account_id,
            FIRST_VALUE(SUBSCRIPTION_TERM_END_DATE_PRIOR_QUARTER_END)
                OVER (PARTITION BY a.service_date, a.crm_account_id ORDER BY a.net_arr_usd DESC) AS largest_renewal_date
        FROM FOUNDATIONAL.FINANCE.FACT_QTD_RECURRING_REVENUE_DAILY_SNAPSHOT_ENRICHED a
        WHERE a.service_date IN (SELECT rev_join_date FROM rev_dates)
    )
    GROUP BY 1, 2
),

acct_scd AS (
    SELECT
        d.snapshot_date AS as_of_date,
        a.id,
        a.name,
        a.primary_resale_partner_c,
        a.PARTNER_TYPE_C
    FROM (SELECT DISTINCT snapshot_date FROM structure) d
    JOIN cleansed.salesforce.salesforce_account_scd2 a
        ON a.VALID_FROM_TIMESTAMP <  DATEADD('day', 1, d.snapshot_date)
       AND a.VALID_TO_TIMESTAMP   >= DATEADD('day', 1, d.snapshot_date)
    WHERE a.VALID_TO_TIMESTAMP >= (SELECT MIN(snapshot_date) FROM structure)
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY d.snapshot_date, a.id
        ORDER BY a.VALID_FROM_TIMESTAMP DESC) = 1
),


contract AS (
    SELECT
        a.as_of_date,
        a.id                              AS ACCOUNT_ID,
        a.primary_resale_partner_c,
        CASE WHEN a.primary_resale_partner_c IS NOT NULL THEN 'Y' ELSE 'N' END AS managed_by_partner_flag,
        b.name                            AS partner_name,
        b.PARTNER_TYPE_C
    FROM acct_scd a
    LEFT JOIN acct_scd b
        ON a.primary_resale_partner_c = b.id
       AND a.as_of_date = b.as_of_date
),

main_data AS (
    SELECT
        s.dates,
        s.service_date,
        s.quarter_diff,
        s.year_quarter,
        s.snapshot_date,
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
        c6.CTC_RAMP_DEAL_C AS ramp_deal,
        c6.CTC_AUTO_RENEW_C AS auto_renew,
        pr.renewal_date AS NEXT_RENEWAL_DATE,
        pp.largest_renewal_date,
        c.flag_3k,
        c.TERRITORY_INDUSTRY_C,
        c.TERRITORY_SUB_INDUSTRY_C,
        c.BILLING_COUNTRY,
        c.ACCOUNT_HEALTH_RISK_TYPE_C AS cc_reason,
        pr.product_lines,
        CASE
            WHEN s.quarter_diff <= 0 THEN (CASE WHEN c6.net_arr_usd_prior_quarter_end >= pm.band_cutoff THEN '100k+' ELSE '<100k' END)
            ELSE (CASE WHEN c6.net_arr_usd >= pm.band_cutoff THEN '100k+' ELSE '<100k' END)
        END AS band,
        gs.DAYS_SINCE_LAST_CS_ENGAGED_GC AS days_since_last_CS_touch,
        CASE WHEN s.quarter_diff = 0 THEN c6.RENEWAL_DONE_DEAL_C ELSE NULL END AS done_deal,
        CASE
            WHEN s.quarter_diff <= 0 THEN c6.FC_DICTATED_BY
            WHEN s.quarter_diff = 1 THEN c6.FC_DICTATED_BY_PLUS1
            WHEN s.quarter_diff = 2 THEN c6.FC_DICTATED_BY_PLUS2
            WHEN s.quarter_diff = 3 THEN c6.FC_DICTATED_BY_PLUS3
            WHEN s.quarter_diff = 4 THEN c6.FC_DICTATED_BY_PLUS4
            ELSE NULL
        END AS Dictated_by,

        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.NET_ARR_USD_PRIOR_QUARTER_END ELSE c6.net_arr_usd END) AS net_arr_usd_prior_qtr_end,
        SUM(c6.NET_ARR_USD) AS net_arr_usd,
        SUM(c6.EXP_ARR) AS expansion,

       
        SUM(COALESCE(
            CASE
                WHEN s.quarter_diff <= 0 THEN c6.ATR_ARR_USD_STARTING
                WHEN s.quarter_diff = 1 THEN c6.ATR_ARR_USD_STARTING_PLUS1
                WHEN s.quarter_diff = 2 THEN c6.ATR_ARR_USD_STARTING_PLUS2
                WHEN s.quarter_diff = 3 THEN c6.ATR_ARR_USD_STARTING_PLUS3
                WHEN s.quarter_diff = 4 THEN c6.ATR_ARR_USD_STARTING_PLUS4
                ELSE NULL
            END,
            atr.atr_arr_usd_starting_calc)) AS atr_arr_usd_starting,

        SUM(CASE
            WHEN s.quarter_diff < 0 THEN c6.qtd_cc
            WHEN s.quarter_diff = 0 THEN c6.BU_FC
            WHEN s.quarter_diff = 1 THEN c6.BU_FC_PLUS1
            WHEN s.quarter_diff = 2 THEN c6.BU_FC_PLUS2
            WHEN s.quarter_diff = 3 THEN c6.BU_FC_PLUS3
            WHEN s.quarter_diff = 4 THEN c6.BU_FC_PLUS4
            ELSE NULL
        END) AS BU_FC,
        SUM(CASE WHEN s.quarter_diff = 0 THEN c6.ATR_ARR_USD_LTG ELSE NULL END) AS ATR_ARR_USD_LTG,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.qtd_cc ELSE NULL END) AS qtd_cc,
        SUM(CASE WHEN s.quarter_diff <= 0 THEN c6.CC_OFFCYCLE_ARR ELSE NULL END) AS CC_OFFCYCLE_ARR,
        SUM(CASE WHEN s.quarter_diff = 0 THEN c6.FC_REMAINING ELSE NULL END) AS FC_REMAINING,
        SUM(CASE
            WHEN s.quarter_diff < 0 THEN c6.on_cycle_churn_contraction_arr_usd
            WHEN s.quarter_diff = 0 THEN c6.BU_FC_ONCYCLE
            WHEN s.quarter_diff = 1 THEN c6.bu_fc_oncycle_plus1
            WHEN s.quarter_diff = 2 THEN c6.bu_fc_oncycle_plus2
            WHEN s.quarter_diff = 3 THEN c6.bu_fc_oncycle_plus3
            WHEN s.quarter_diff = 4 THEN c6.bu_fc_oncycle_plus4
            ELSE NULL
        END) AS FC_ONCYCLE,
        SUM(CASE
            WHEN s.quarter_diff < 0 THEN (c6.off_cycle_churn_arr_usd + c6.off_cycle_contraction_arr_usd)
            WHEN s.quarter_diff = 0 THEN c6.BU_FC_OFFCYCLE
            WHEN s.quarter_diff = 1 THEN c6.bu_fc_offcycle_plus1
            WHEN s.quarter_diff = 2 THEN c6.bu_fc_offcycle_plus2
            WHEN s.quarter_diff = 3 THEN c6.bu_fc_offcycle_plus3
            WHEN s.quarter_diff = 4 THEN c6.bu_fc_offcycle_plus4
            ELSE NULL
        END) AS FC_OFFCYCLE,
        
        SUM(CASE
            WHEN s.quarter_diff <= 0 THEN c6.FC_UPSIDE
            WHEN s.quarter_diff = 1 THEN c6.BU_BC_PLUS1 - c6.BU_FC_PLUS1
            WHEN s.quarter_diff = 2 THEN c6.BU_BC_PLUS2 - c6.BU_FC_PLUS2
            WHEN s.quarter_diff = 3 THEN c6.BU_BC_PLUS3 - c6.BU_FC_PLUS3
            WHEN s.quarter_diff = 4 THEN c6.BU_BC_PLUS4 - c6.BU_FC_PLUS4
            ELSE NULL
        END) AS Upside,
        SUM(CASE
            WHEN s.quarter_diff <= 0 THEN c6.FC_DOWNSIDE
            WHEN s.quarter_diff = 1 THEN c6.BU_WC_PLUS1 - c6.BU_FC_PLUS1
            WHEN s.quarter_diff = 2 THEN c6.BU_WC_PLUS2 - c6.BU_FC_PLUS2
            WHEN s.quarter_diff = 3 THEN c6.BU_WC_PLUS3 - c6.BU_FC_PLUS3
            WHEN s.quarter_diff = 4 THEN c6.BU_WC_PLUS4 - c6.BU_FC_PLUS4
            ELSE NULL
        END) AS Downside,

        CASE
            WHEN s.quarter_diff <= 0 THEN c6.RENEWAL_FORECAST_SUMMARIES
            WHEN s.quarter_diff = 1 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS1
            WHEN s.quarter_diff = 2 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS2
            WHEN s.quarter_diff = 3 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS3
            WHEN s.quarter_diff = 4 THEN c6.RENEWAL_FORECAST_SUMMARIES_PLUS4
            ELSE NULL
        END AS forecast_summary,

        con.partner_name AS partner,
        con.PARTNER_TYPE_C,
        COALESCE(con.managed_by_partner_flag, 'N') AS managed_by_partner_flag
    FROM structure s
    CROSS JOIN params pm
    LEFT JOIN FUNCTIONAL.GTM_SALES_OPS.OPS_FINANCE_ENRICHED_CC_DASHBOARD c6
        ON c6.service_date = s.snapshot_date
    LEFT JOIN customer c ON c6.crm_account_id = c.id
    LEFT JOIN GSdata gs  ON c6.crm_account_id = gs.SFDC_ACCOUNT_ID
    -- Revenue-side CTEs join on rev_join_date, NOT the dashboard snapshot_date.
    LEFT JOIN atr
        ON c6.crm_account_id = atr.crm_account_id
        AND atr.service_date = s.rev_join_date
        AND atr.fiscal_quarter_group = DATE_TRUNC('quarter', DATEADD('month', -1, s.dates))
    LEFT JOIN proddate pp
        ON c6.crm_account_id = pp.crm_account_id
        AND pp.service_date = s.rev_join_date
    LEFT JOIN prod pr
        ON c6.crm_account_id = pr.crm_account_id
        AND pr.service_date = s.rev_join_date
        AND pr.fiscal_quarter_group = DATE_TRUNC('quarter', DATEADD('month', -1, s.dates))
   
    LEFT JOIN contract con
        ON c6.crm_account_id = con.ACCOUNT_ID
        AND con.as_of_date = s.snapshot_date
    
    WHERE
        
        NOT (COALESCE(c6.net_arr_usd, 0) = 0 AND COALESCE(c6.net_arr_usd_prior_quarter_end, 0) = 0)
        
        AND c6.NET_ARR_USD_PRIOR_QUARTER_END >= pm.min_arr
    GROUP BY ALL
)

SELECT
    year_quarter,
    quarter_diff,
    crm_account_id,
    crm_account_name,
    band,
    Dictated_by,
    net_arr_usd_prior_qtr_end,
    net_arr_usd,
    expansion,
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
    ramp_deal,
    auto_renew,
    NEXT_RENEWAL_DATE,
    largest_renewal_date,
    done_deal,
    flag_3k,
    TERRITORY_INDUSTRY_C,
    TERRITORY_SUB_INDUSTRY_C,
    BILLING_COUNTRY,
    cc_reason,
    days_since_last_CS_touch,
    product_lines,
    forecast_summary,
    partner,
    PARTNER_TYPE_C,
    managed_by_partner_flag
FROM main_data
ORDER BY crm_account_id, quarter_diff
;
