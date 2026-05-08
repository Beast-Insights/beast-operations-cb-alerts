import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function GET() {
  try {
    // Get table columns
    const columnsResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'beast_insights_v2' AND table_name = 'alert_logs'
      ORDER BY ordinal_position
    `)

    // Get last 10 entries
    // NOTE: alert_logs timestamps are stored in EST (UTC-5), converting to IST (UTC+5:30) = +10h 30m
    const sampleResult = await pool.query(`
      SELECT *,
        created_at as created_at_est,
        (created_at + INTERVAL '10 hours 30 minutes') as created_at_ist
      FROM beast_insights_v2.alert_logs
      ORDER BY created_at DESC
      LIMIT 10
    `)

    // Get summary stats
    const summaryResult = await pool.query(`
      SELECT
        COUNT(*) as total_logs,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM beast_insights_v2.alert_logs
    `)

    // Get counts by date (IST) - EST + 10h30m = IST
    const dailyResult = await pool.query(`
      SELECT
        (created_at + INTERVAL '10 hours 30 minutes')::date as date_ist,
        COUNT(*) as count
      FROM beast_insights_v2.alert_logs
      GROUP BY (created_at + INTERVAL '10 hours 30 minutes')::date
      ORDER BY date_ist DESC
    `)

    // Get counts by workflow
    const workflowResult = await pool.query(`
      SELECT
        workflow_name,
        COUNT(*) as total,
        SUM(CASE WHEN is_success THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN NOT is_success THEN 1 ELSE 0 END) as failed
      FROM beast_insights_v2.alert_logs
      GROUP BY workflow_name
      ORDER BY total DESC
    `)

    // Get hourly breakdown for today (IST) - EST + 10h30m = IST
    const hourlyResult = await pool.query(`
      SELECT
        date_trunc('hour', created_at + INTERVAL '10 hours 30 minutes') as hour_ist,
        workflow_name,
        COUNT(*) as count,
        SUM(CASE WHEN is_success THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN NOT is_success THEN 1 ELSE 0 END) as failed
      FROM beast_insights_v2.alert_logs
      WHERE (created_at + INTERVAL '10 hours 30 minutes')::date = '2026-02-16'
      GROUP BY date_trunc('hour', created_at + INTERVAL '10 hours 30 minutes'), workflow_name
      ORDER BY hour_ist DESC
    `)

    // Get failed logs
    const failedResult = await pool.query(`
      SELECT *
      FROM beast_insights_v2.alert_logs
      WHERE is_success = false
      ORDER BY created_at DESC
      LIMIT 10
    `)

    // Get workflow runs by date for last 2 days (Feb 14-15 IST)
    const workflowByDateResult = await pool.query(`
      SELECT
        (created_at + INTERVAL '10 hours 30 minutes')::date as date_ist,
        workflow_name,
        COUNT(*) as runs,
        SUM(CASE WHEN is_success THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN NOT is_success THEN 1 ELSE 0 END) as failed
      FROM beast_insights_v2.alert_logs
      WHERE (created_at + INTERVAL '10 hours 30 minutes')::date >= CURRENT_DATE - INTERVAL '2 days'
      GROUP BY (created_at + INTERVAL '10 hours 30 minutes')::date, workflow_name
      ORDER BY date_ist DESC, workflow_name
    `)

    // Get hourly breakdown by workflow for last 2 days
    const hourlyByWorkflowResult = await pool.query(`
      SELECT
        (created_at + INTERVAL '10 hours 30 minutes')::date as date_ist,
        EXTRACT(HOUR FROM created_at + INTERVAL '10 hours 30 minutes') as hour,
        workflow_name,
        COUNT(*) as runs
      FROM beast_insights_v2.alert_logs
      WHERE (created_at + INTERVAL '10 hours 30 minutes')::date >= CURRENT_DATE - INTERVAL '2 days'
      GROUP BY (created_at + INTERVAL '10 hours 30 minutes')::date,
               EXTRACT(HOUR FROM created_at + INTERVAL '10 hours 30 minutes'),
               workflow_name
      ORDER BY date_ist DESC, hour DESC, workflow_name
    `)

    // BILLING QUERY: Alert counts by type for Feb 9-15, 2026 in EST timezone
    // alert_timestamp is stored in UTC, converting to EST = UTC - 5 hours
    const billingResult = await pool.query(`
      SELECT
        CASE
          WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 'Ethoca'
          WHEN alert_type = 'CDRN' THEN 'CDRN'
          WHEN alert_type = 'RDR' THEN 'RDR'
          ELSE 'Other'
        END as alert_category,
        COUNT(*) as count,
        to_char((alert_timestamp - INTERVAL '5 hours')::date, 'YYYY-MM-DD') as date_est
      FROM data.alerts_raw
      WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        AND (alert_timestamp - INTERVAL '5 hours')::date >= '2026-02-09'
        AND (alert_timestamp - INTERVAL '5 hours')::date <= '2026-02-15'
      GROUP BY
        CASE
          WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 'Ethoca'
          WHEN alert_type = 'CDRN' THEN 'CDRN'
          WHEN alert_type = 'RDR' THEN 'RDR'
          ELSE 'Other'
        END,
        (alert_timestamp - INTERVAL '5 hours')::date
      ORDER BY date_est, alert_category
    `)

    // Billing summary totals
    const billingSummaryResult = await pool.query(`
      SELECT
        SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END) as ethoca,
        SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END) as cdrn,
        SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END) as rdr,
        COUNT(*) as total
      FROM data.alerts_raw
      WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        AND (alert_timestamp - INTERVAL '5 hours')::date >= '2026-02-09'
        AND (alert_timestamp - INTERVAL '5 hours')::date <= '2026-02-15'
    `)

    // Billing by day (pivoted) - shows Ethoca, CDRN, RDR columns per day
    const billingByDayResult = await pool.query(`
      SELECT
        to_char((alert_timestamp - INTERVAL '5 hours')::date, 'YYYY-MM-DD') as date_est,
        SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END) as ethoca,
        SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END) as cdrn,
        SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END) as rdr,
        COUNT(*) as daily_total
      FROM data.alerts_raw
      WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        AND (alert_timestamp - INTERVAL '5 hours')::date >= '2026-02-09'
        AND (alert_timestamp - INTERVAL '5 hours')::date <= '2026-02-15'
      GROUP BY (alert_timestamp - INTERVAL '5 hours')::date
      ORDER BY date_est
    `)

    return NextResponse.json({
      columns: columnsResult.rows,
      sample: sampleResult.rows,
      summary: summaryResult.rows[0],
      byDate: dailyResult.rows,
      byWorkflow: workflowResult.rows,
      hourlyToday: hourlyResult.rows,
      failedLogs: failedResult.rows,
      workflowByDate: workflowByDateResult.rows,
      hourlyByWorkflow: hourlyByWorkflowResult.rows,
      billing: {
        period: 'Feb 9-15, 2026 (EST timezone)',
        timezone: 'EST (UTC-5)',
        byDay: billingByDayResult.rows,
        byDateAndType: billingResult.rows,
        summary: billingSummaryResult.rows[0]
      },
      billingVerification: await (async () => {
        // Verification 1: Date range boundaries
        const rangeCheck = await pool.query(`
          SELECT
            COUNT(*) as total_in_range,
            MIN(alert_timestamp) as earliest_alert_utc,
            MAX(alert_timestamp) as latest_alert_utc,
            to_char(MIN(alert_timestamp - INTERVAL '5 hours'), 'YYYY-MM-DD HH24:MI:SS') as earliest_alert_est,
            to_char(MAX(alert_timestamp - INTERVAL '5 hours'), 'YYYY-MM-DD HH24:MI:SS') as latest_alert_est
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            AND (alert_timestamp - INTERVAL '5 hours')::date >= '2026-02-09'
            AND (alert_timestamp - INTERVAL '5 hours')::date <= '2026-02-15'
        `)

        // Verification 2: Check Feb 8 EST (should NOT be included)
        const feb8Check = await pool.query(`
          SELECT COUNT(*) as count
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            AND (alert_timestamp - INTERVAL '5 hours')::date = '2026-02-08'
        `)

        // Verification 3: Check Feb 16 EST (should NOT be included)
        const feb16Check = await pool.query(`
          SELECT COUNT(*) as count
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            AND (alert_timestamp - INTERVAL '5 hours')::date = '2026-02-16'
        `)

        // Verification 4: First and last alert of each boundary day
        const boundaryAlerts = await pool.query(`
          SELECT
            to_char((alert_timestamp - INTERVAL '5 hours')::date, 'YYYY-MM-DD') as date_est,
            to_char(MIN(alert_timestamp - INTERVAL '5 hours'), 'HH24:MI:SS') as first_alert_time_est,
            to_char(MAX(alert_timestamp - INTERVAL '5 hours'), 'HH24:MI:SS') as last_alert_time_est,
            COUNT(*) as count
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            AND (alert_timestamp - INTERVAL '5 hours')::date IN ('2026-02-09', '2026-02-15')
          GROUP BY (alert_timestamp - INTERVAL '5 hours')::date
          ORDER BY date_est
        `)

        // Verification 5: Cross-check totals
        const crossCheck = await pool.query(`
          SELECT
            SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END) as ethoca,
            SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END) as cdrn,
            SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END) as rdr,
            COUNT(*) as total,
            COUNT(DISTINCT alert_id) as unique_alert_ids
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            AND (alert_timestamp - INTERVAL '5 hours')::date >= '2026-02-09'
            AND (alert_timestamp - INTERVAL '5 hours')::date <= '2026-02-15'
        `)

        // Verification 6: Latest alert by type (to check if data is still being ingested)
        const latestByType = await pool.query(`
          SELECT
            CASE
              WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 'Ethoca'
              WHEN alert_type = 'CDRN' THEN 'CDRN'
              WHEN alert_type = 'RDR' THEN 'RDR'
            END as alert_category,
            to_char(MAX(alert_timestamp - INTERVAL '5 hours'), 'YYYY-MM-DD HH24:MI:SS') as latest_alert_est,
            to_char(MAX(alert_timestamp), 'YYYY-MM-DD HH24:MI:SS') as latest_alert_utc
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
          GROUP BY 1
          ORDER BY 1
        `)

        // Verification 7: Processing tab verification (alert_timestamp in IST)
        const processingTabCheck = await pool.query(`
          SELECT
            '2026-02-14' as date_ist,
            SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END) as ethoca,
            SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END) as cdrn,
            SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END) as rdr,
            COUNT(*) as total
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            AND (alert_timestamp + INTERVAL '5 hours 30 minutes')::date = '2026-02-14'
        `)

        // Verification 8: Processing Time deep dive - CORRECTED (excludes "already refunded" cases)
        const processingTimeCheck = await pool.query(`
          SELECT
            -- CDRN refund time analysis (only counting refunds AFTER alert)
            COUNT(*) FILTER (WHERE alert_type = 'CDRN') as cdrn_total,
            COUNT(*) FILTER (WHERE alert_type = 'CDRN' AND is_refund_crm = true AND refund_timestamp_crm > alert_timestamp) as cdrn_refunded_after_alert,
            COUNT(*) FILTER (WHERE alert_type = 'CDRN' AND is_refund_crm = true AND refund_timestamp_crm <= alert_timestamp) as cdrn_already_refunded,

            -- CDRN avg time (only positive - refund happened after alert)
            AVG(CASE
              WHEN alert_type = 'CDRN' AND is_refund_crm = true AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm > alert_timestamp
              THEN EXTRACT(EPOCH FROM (refund_timestamp_crm - alert_timestamp)) / 3600
              ELSE NULL
            END) as cdrn_avg_refund_hours,
            MIN(CASE
              WHEN alert_type = 'CDRN' AND is_refund_crm = true AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm > alert_timestamp
              THEN EXTRACT(EPOCH FROM (refund_timestamp_crm - alert_timestamp)) / 3600
              ELSE NULL
            END) as cdrn_min_refund_hours,
            MAX(CASE
              WHEN alert_type = 'CDRN' AND is_refund_crm = true AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm > alert_timestamp
              THEN EXTRACT(EPOCH FROM (refund_timestamp_crm - alert_timestamp)) / 3600
              ELSE NULL
            END) as cdrn_max_refund_hours,

            -- Ethoca refund time analysis (only counting refunds AFTER alert)
            COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert')) as ethoca_total,
            COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert') AND is_refund_crm = true AND refund_timestamp_crm > alert_timestamp) as ethoca_refunded_after_alert,
            COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert') AND is_refund_crm = true AND refund_timestamp_crm <= alert_timestamp) as ethoca_already_refunded,
            AVG(CASE
              WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') AND is_refund_crm = true AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm > alert_timestamp
              THEN EXTRACT(EPOCH FROM (refund_timestamp_crm - alert_timestamp)) / 3600
              ELSE NULL
            END) as ethoca_avg_refund_hours,

            -- Ethoca acknowledge time analysis (only counting acknowledgements AFTER alert)
            COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert') AND is_acknowledged = true AND acknowledgement_timestamp > alert_timestamp) as ethoca_acknowledged_after_alert,
            AVG(CASE
              WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') AND is_acknowledged = true AND acknowledgement_timestamp IS NOT NULL AND acknowledgement_timestamp > alert_timestamp
              THEN EXTRACT(EPOCH FROM (acknowledgement_timestamp - alert_timestamp)) / 3600
              ELSE NULL
            END) as ethoca_avg_ack_hours

          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            AND (alert_timestamp + INTERVAL '5 hours 30 minutes')::date >= '2026-02-08'
            AND (alert_timestamp + INTERVAL '5 hours 30 minutes')::date <= '2026-02-14'
        `)

        return {
          dateRangeInfo: rangeCheck.rows[0],
          alertsOnFeb8EST: parseInt(feb8Check.rows[0].count),
          alertsOnFeb16EST: parseInt(feb16Check.rows[0].count),
          boundaryDays: boundaryAlerts.rows,
          crossCheckTotals: crossCheck.rows[0],
          latestAlertByType: latestByType.rows,
          processingTabFeb14IST: processingTabCheck.rows[0],
          processingTimeDeepDive: processingTimeCheck.rows[0],

          // Full table analysis - refund timestamp issues
          refundTimestampAnalysis: await (async () => {
            const analysis = await pool.query(`
              SELECT
                -- Ethoca analysis
                COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert')) as ethoca_total,
                COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert') AND refund_timestamp_crm IS NULL) as ethoca_no_refund_timestamp,
                COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert') AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm < alert_timestamp) as ethoca_refund_before_alert,
                COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert') AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm >= alert_timestamp) as ethoca_refund_after_alert,

                -- CDRN analysis
                COUNT(*) FILTER (WHERE alert_type = 'CDRN') as cdrn_total,
                COUNT(*) FILTER (WHERE alert_type = 'CDRN' AND refund_timestamp_crm IS NULL) as cdrn_no_refund_timestamp,
                COUNT(*) FILTER (WHERE alert_type = 'CDRN' AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm < alert_timestamp) as cdrn_refund_before_alert,
                COUNT(*) FILTER (WHERE alert_type = 'CDRN' AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm >= alert_timestamp) as cdrn_refund_after_alert,

                -- RDR analysis
                COUNT(*) FILTER (WHERE alert_type = 'RDR') as rdr_total,
                COUNT(*) FILTER (WHERE alert_type = 'RDR' AND refund_timestamp_crm IS NULL) as rdr_no_refund_timestamp,
                COUNT(*) FILTER (WHERE alert_type = 'RDR' AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm < alert_timestamp) as rdr_refund_before_alert,
                COUNT(*) FILTER (WHERE alert_type = 'RDR' AND refund_timestamp_crm IS NOT NULL AND refund_timestamp_crm >= alert_timestamp) as rdr_refund_after_alert

              FROM data.alerts_raw
              WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
            `)
            return analysis.rows[0]
          })(),

          // Status analysis by refund timestamp scenario
          statusByRefundScenario: await (async () => {
            const statusAnalysis = await pool.query(`
              SELECT
                CASE
                  WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 'Ethoca'
                  WHEN alert_type = 'CDRN' THEN 'CDRN'
                  WHEN alert_type = 'RDR' THEN 'RDR'
                END as alert_category,
                CASE
                  WHEN refund_timestamp_crm IS NULL THEN 'no_refund_timestamp'
                  WHEN refund_timestamp_crm < alert_timestamp THEN 'refund_before_alert'
                  ELSE 'refund_after_alert'
                END as refund_scenario,
                COALESCE(post_alert_status::text, 'NULL_or_empty') as status,
                COUNT(*) as count
              FROM data.alerts_raw
              WHERE alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
              GROUP BY 1, 2, 3
              ORDER BY 1, 2, count DESC
            `)
            return statusAnalysis.rows
          })(),

          sampleBadRecords: await (async () => {
            const badRecords = await pool.query(`
              SELECT
                alert_id,
                alert_type,
                alert_timestamp,
                refund_timestamp_crm,
                EXTRACT(EPOCH FROM (refund_timestamp_crm - alert_timestamp)) / 3600 as diff_hours
              FROM data.alerts_raw
              WHERE alert_type IN ('CDRN', 'issuer_alert', 'customerdispute_alert')
                AND is_refund_crm = true
                AND refund_timestamp_crm IS NOT NULL
                AND refund_timestamp_crm < alert_timestamp
              ORDER BY diff_hours ASC
              LIMIT 5
            `)
            return badRecords.rows
          })(),

          // Latest 10 RDR alerts with raw timestamps
          latestRdrAlerts: await (async () => {
            const rdrAlerts = await pool.query(`
              SELECT
                alert_id,
                alert_timestamp as alert_timestamp_raw,
                created_at as created_at_raw,
                (alert_timestamp + INTERVAL '5 hours 30 minutes') as alert_timestamp_ist,
                (created_at + INTERVAL '5 hours 30 minutes') as created_at_ist,
                post_alert_status,
                transaction_amount
              FROM data.alerts_raw
              WHERE alert_type = 'RDR'
              ORDER BY created_at DESC
              LIMIT 10
            `)
            return rdrAlerts.rows
          })()
        }
      })()
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
