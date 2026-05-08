import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function GET(request: Request) {
  try {
    // Set session timezone to UTC to ensure consistent timestamp handling
    await pool.query("SET timezone TO 'UTC'")

    const { searchParams } = new URL(request.url)

    let startDateStr = searchParams.get('startDate')
    let endDateStr = searchParams.get('endDate')

    // Time basis: 'ingestion' (created_at) or 'alert' (alert_timestamp)
    const timeBasis = searchParams.get('timeBasis') || 'ingestion'

    // Timezone: 'IST' (default) or 'EST'
    const timezone = searchParams.get('timezone') || 'IST'

    // Timezone conversion intervals:
    // Column timezones: alert_timestamp=EST, created_at=UTC, acknowledgement_timestamp=UTC
    //
    // For IST display: EST + 10h30m = IST, UTC + 5h30m = IST
    // For EST display: EST = EST (no change), UTC - 5h = EST
    const estToDisplay = timezone === 'IST' ? `+ INTERVAL '10 hours 30 minutes'` : ``
    const utcToDisplay = timezone === 'IST' ? `+ INTERVAL '5 hours 30 minutes'` : `- INTERVAL '5 hours'`

    // Combined conversion based on timeBasis (which column) and timezone (target display)
    // timeBasis='alert' uses alert_timestamp (EST), timeBasis='ingestion' uses created_at (UTC)
    const timeBasisToDisplay = timeBasis === 'alert' ? estToDisplay : utcToDisplay

    // Helper to format date as YYYY-MM-DD using local timezone (avoids UTC shift issues)
    const formatDateLocal = (d: Date) => {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    // Default to last 7 days
    if (!startDateStr || !endDateStr) {
      const today = new Date()
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(today.getDate() - 7)

      endDateStr = formatDateLocal(today)
      startDateStr = formatDateLocal(sevenDaysAgo)
    }

    // Calculate previous period for comparison
    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr)
    const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
    const prevEndDate = new Date(startDate)
    prevEndDate.setDate(prevEndDate.getDate() - 1)
    const prevStartDate = new Date(prevEndDate)
    prevStartDate.setDate(prevStartDate.getDate() - periodDays + 1)
    const prevStartDateStr = formatDateLocal(prevStartDate)
    const prevEndDateStr = formatDateLocal(prevEndDate)

    // Run all queries in parallel
    const [
      dataIngestionResult,
      volumeSummaryResult,
      prevVolumeSummaryResult,
      volumeTrendsResult,
      processingTimeResult,
      rdrFlowResult,
      cdrnFlowResult,
      ethocaFlowResult,
      stuckAlertsResult,
      hourlyIngestionResult,
      dailyIngestionResult,
      latestIngestionResult,
      ingestionDelayResult,
      volumeTrends24hResult,
      todayVsYesterdayResult,
      volumeTrends30dResult,
      n8nHourlyResult,
      n8nDailyResult
    ] = await Promise.all([
      // NOTE: Removed volume7dResult and volume30dBySourceResult queries
      // Now deriving all volumeByPeriod values from volumeTrends24h and volumeTrends30d for consistency
      // Data Ingestion Status - Last alert added per source using created_at (UTC)
      // Converts to display timezone (IST or EST)
      pool.query(`
        SELECT
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN data_source = 'disputifier' AND alert_type = 'RDR' THEN 'RDR'
            WHEN data_source = 'disputifier' AND alert_type = 'CDRN' THEN 'CDRN'
            ELSE COALESCE(data_source, 'unknown')
          END as source_name,
          MAX(created_at ${utcToDisplay}) as last_ingested_at
        FROM data.alerts_raw
        WHERE created_at IS NOT NULL
        GROUP BY
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN data_source = 'disputifier' AND alert_type = 'RDR' THEN 'RDR'
            WHEN data_source = 'disputifier' AND alert_type = 'CDRN' THEN 'CDRN'
            ELSE COALESCE(data_source, 'unknown')
          END
        ORDER BY source_name
      `),

      // Volume Summary - Current period, respects timeBasis and timezone
      // timeBasis='alert' uses alert_timestamp (EST), 'ingestion' uses created_at (UTC)
      pool.query(`
        SELECT
          SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END) as ethoca_count,
          SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END) as cdrn_count,
          SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END) as rdr_count
        FROM data.alerts_raw
        WHERE (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date >= $1
          AND (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date <= $2
      `, [startDateStr, endDateStr]),

      // Volume Summary - Previous period for comparison, respects timeBasis and timezone
      pool.query(`
        SELECT
          SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END) as ethoca_count,
          SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END) as cdrn_count,
          SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END) as rdr_count
        FROM data.alerts_raw
        WHERE (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date >= $1
          AND (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date <= $2
      `, [prevStartDateStr, prevEndDateStr]),

      // Volume Trends - Hourly data for the period, respects timeBasis and timezone
      // Hour buckets are aligned to display timezone
      pool.query(`
        SELECT
          date_trunc('hour', ${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay}) as time_bucket,
          SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END) as ethoca,
          SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END) as cdrn,
          SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END) as rdr
        FROM data.alerts_raw
        WHERE (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date >= $1
          AND (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date <= $2
          AND alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        GROUP BY date_trunc('hour', ${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})
        ORDER BY time_bucket
      `, [startDateStr, endDateStr]),

      // Processing Time Analysis
      // - Avg time to CRM refund (for CDRN and Ethoca only - skip RDR)
      // - Avg time to acknowledge (Ethoca only)
      // IMPORTANT: Duration calculations are timezone-independent
      // - alert_timestamp is in EST, refund_timestamp_crm is in EST (same TZ, direct comparison OK)
      // - alert_timestamp is in EST, acknowledgement_timestamp is in UTC (must convert ack to EST: UTC - 5h)
      // IMPORTANT: Only count positive time differences (refund/ack happened AFTER alert)
      // NOTE: For CDRN, is_already_refunded flag is unreliable - use timestamp comparison only
      // NOTE: For Ethoca, keep is_already_refunded check as it's accurate
      pool.query(`
        SELECT
          -- CDRN: Avg time from alert_timestamp(EST) to refund_timestamp_crm(EST)
          -- NOTE: Don't filter by is_already_refunded - flag is unreliable for CDRN
          -- Only use timestamp comparison to determine if refund was processed after alert
          AVG(CASE
            WHEN alert_type = 'CDRN'
              AND is_refund_crm = true
              AND refund_timestamp_crm IS NOT NULL
              AND refund_timestamp_crm > alert_timestamp
            THEN EXTRACT(EPOCH FROM (refund_timestamp_crm - alert_timestamp)) / 3600
            ELSE NULL
          END) as cdrn_avg_time_to_crm_refund_hours,

          -- Ethoca: Avg time from alert_timestamp(EST) to refund_timestamp_crm(EST)
          -- Excludes: already refunded (flag is accurate for Ethoca), negative/invalid time differences
          AVG(CASE
            WHEN alert_type IN ('issuer_alert', 'customerdispute_alert')
              AND is_refund_crm = true
              AND refund_timestamp_crm IS NOT NULL
              AND refund_timestamp_crm > alert_timestamp
              AND (is_already_refunded = false OR is_already_refunded IS NULL)
            THEN EXTRACT(EPOCH FROM (refund_timestamp_crm - alert_timestamp)) / 3600
            ELSE NULL
          END) as ethoca_avg_time_to_crm_refund_hours,

          -- Ethoca: Avg time from alert_timestamp(EST) to acknowledgement_timestamp(UTC->EST)
          -- Convert acknowledgement_timestamp from UTC to EST by subtracting 5 hours
          AVG(CASE
            WHEN alert_type IN ('issuer_alert', 'customerdispute_alert')
              AND is_acknowledged = true
              AND acknowledgement_timestamp IS NOT NULL
              AND (acknowledgement_timestamp - INTERVAL '5 hours') > alert_timestamp
            THEN EXTRACT(EPOCH FROM ((acknowledgement_timestamp - INTERVAL '5 hours') - alert_timestamp)) / 3600
            ELSE NULL
          END) as ethoca_avg_time_to_acknowledge_hours,

          -- Counts for context (matching the same criteria as the averages)
          SUM(CASE
            WHEN alert_type = 'CDRN'
              AND is_refund_crm = true
              AND refund_timestamp_crm IS NOT NULL
              AND refund_timestamp_crm > alert_timestamp
            THEN 1 ELSE 0
          END) as cdrn_refund_count,
          SUM(CASE
            WHEN alert_type IN ('issuer_alert', 'customerdispute_alert')
              AND is_refund_crm = true
              AND refund_timestamp_crm IS NOT NULL
              AND refund_timestamp_crm > alert_timestamp
              AND (is_already_refunded = false OR is_already_refunded IS NULL)
            THEN 1 ELSE 0
          END) as ethoca_refund_count,
          SUM(CASE
            WHEN alert_type IN ('issuer_alert', 'customerdispute_alert')
              AND is_acknowledged = true
              AND acknowledgement_timestamp IS NOT NULL
              AND (acknowledgement_timestamp - INTERVAL '5 hours') > alert_timestamp
            THEN 1 ELSE 0
          END) as ethoca_acknowledged_count
        FROM data.alerts_raw
        WHERE (alert_timestamp ${estToDisplay})::date >= $1
          AND (alert_timestamp ${estToDisplay})::date <= $2
      `, [startDateStr, endDateStr]),

      // RDR Flow - Detailed breakdown (alert_timestamp is in EST)
      pool.query(`
        SELECT
          COUNT(*) as received,
          SUM(CASE WHEN is_order_id_valid = true THEN 1 ELSE 0 END) as valid_order_id,
          SUM(CASE WHEN is_order_id_valid = false THEN 1 ELSE 0 END) as invalid_order_id,
          SUM(CASE WHEN is_order_id_valid IS NULL THEN 1 ELSE 0 END) as missing_order_id,
          SUM(CASE WHEN is_order_id_valid = true AND is_already_refunded = true THEN 1 ELSE 0 END) as valid_already_refunded,
          SUM(CASE WHEN is_order_id_valid = true AND (is_already_refunded = false OR is_already_refunded IS NULL) THEN 1 ELSE 0 END) as valid_not_refunded,
          SUM(CASE WHEN is_order_id_valid = true AND (is_already_refunded = false OR is_already_refunded IS NULL) AND is_blacklisted = true THEN 1 ELSE 0 END) as valid_blacklisted,
          SUM(CASE WHEN is_order_id_valid = true AND (is_already_refunded = false OR is_already_refunded IS NULL) AND (is_blacklisted = false OR is_blacklisted IS NULL) THEN 1 ELSE 0 END) as valid_not_blacklisted,
          SUM(CASE WHEN is_refund_init = true THEN 1 ELSE 0 END) as refund_initiated,
          SUM(CASE WHEN is_refund_crm = true THEN 1 ELSE 0 END) as refund_crm,
          COALESCE(SUM(CASE WHEN is_order_id_valid = false THEN alert_cost ELSE 0 END), 0) as cost_invalid_order,
          COALESCE(SUM(CASE WHEN is_order_id_valid IS NULL THEN alert_cost ELSE 0 END), 0) as cost_missing_order,
          COALESCE(SUM(CASE WHEN is_order_id_valid = true AND is_already_refunded = true THEN alert_cost ELSE 0 END), 0) as cost_already_refunded,
          SUM(CASE WHEN post_alert_status::text = 'effective' THEN 1 ELSE 0 END) as status_effective,
          SUM(CASE WHEN post_alert_status::text = 'alert_got_chargeback' THEN 1 ELSE 0 END) as turned_to_cb
        FROM data.alerts_raw
        WHERE alert_type = 'RDR'
          AND (alert_timestamp ${estToDisplay})::date >= $1 AND (alert_timestamp ${estToDisplay})::date <= $2
      `, [startDateStr, endDateStr]),

      // CDRN Flow - Detailed breakdown (alert_timestamp is in EST)
      // Pipeline: Total → Valid/Invalid → Already Refunded/Chargeback/Unable → Blacklisted → Effective
      pool.query(`
        SELECT
          COUNT(*) as received,
          SUM(CASE WHEN is_order_id_valid = true THEN 1 ELSE 0 END) as order_matched,
          SUM(CASE WHEN is_order_id_valid = false OR is_order_id_valid IS NULL THEN 1 ELSE 0 END) as order_not_matched,
          -- Step 3: Fallout checks (from valid orders)
          SUM(CASE WHEN post_alert_status::text = 'alert_already_refunded' THEN 1 ELSE 0 END) as already_refunded,
          SUM(CASE WHEN is_already_chargeback = true THEN 1 ELSE 0 END) as already_chargeback,
          SUM(CASE WHEN post_alert_status::text = 'unable_to_refund' THEN 1 ELSE 0 END) as unable_to_refund,
          -- Step 4: Blacklist status (from orders that passed fallout checks)
          SUM(CASE WHEN is_order_id_valid = true
                   AND post_alert_status::text NOT IN ('alert_already_refunded', 'unable_to_refund')
                   AND (is_already_chargeback = false OR is_already_chargeback IS NULL)
                   AND is_blacklisted = true THEN 1 ELSE 0 END) as valid_blacklisted,
          SUM(CASE WHEN is_order_id_valid = true
                   AND post_alert_status::text NOT IN ('alert_already_refunded', 'unable_to_refund')
                   AND (is_already_chargeback = false OR is_already_chargeback IS NULL)
                   AND (is_blacklisted = false OR is_blacklisted IS NULL) THEN 1 ELSE 0 END) as valid_not_blacklisted,
          -- Legacy fields for backwards compatibility
          SUM(CASE WHEN is_order_id_valid = true AND is_already_refunded = true THEN 1 ELSE 0 END) as matched_already_refunded,
          SUM(CASE WHEN is_order_id_valid = true AND (is_already_refunded = false OR is_already_refunded IS NULL) AND is_refund_init = true THEN 1 ELSE 0 END) as matched_refund_initiated,
          SUM(CASE WHEN is_order_id_valid = true AND (is_already_refunded = false OR is_already_refunded IS NULL) AND is_refund_crm = true THEN 1 ELSE 0 END) as matched_refund_confirmed,
          SUM(CASE WHEN is_blacklisted = true THEN 1 ELSE 0 END) as blacklisted,
          SUM(CASE WHEN post_alert_status::text = 'effective' THEN 1 ELSE 0 END) as effective,
          SUM(CASE WHEN post_alert_status::text = 'alert_got_chargeback' THEN 1 ELSE 0 END) as turned_to_cb,
          COALESCE(SUM(CASE WHEN is_order_id_valid = false OR is_order_id_valid IS NULL THEN alert_cost ELSE 0 END), 0) as cost_not_matched,
          COALESCE(SUM(CASE WHEN post_alert_status::text = 'alert_already_refunded' THEN alert_cost ELSE 0 END), 0) as cost_already_refunded
        FROM data.alerts_raw
        WHERE alert_type = 'CDRN'
          AND (alert_timestamp ${estToDisplay})::date >= $1 AND (alert_timestamp ${estToDisplay})::date <= $2
      `, [startDateStr, endDateStr]),

      // Ethoca Flow - Detailed breakdown (alert_timestamp is in EST)
      // Using post_alert_status as source of truth for pipeline flow
      pool.query(`
        SELECT
          COUNT(*) as received,
          SUM(CASE WHEN is_order_id_valid = true THEN 1 ELSE 0 END) as order_matched,
          SUM(CASE WHEN is_order_id_valid = false OR is_order_id_valid IS NULL THEN 1 ELSE 0 END) as order_not_matched,
          SUM(CASE WHEN is_order_id_valid = true AND is_already_refunded = true THEN 1 ELSE 0 END) as matched_already_refunded,
          SUM(CASE WHEN is_order_id_valid = true AND (is_already_refunded = false OR is_already_refunded IS NULL) AND is_refund_init = true THEN 1 ELSE 0 END) as matched_refund_initiated,
          SUM(CASE WHEN is_order_id_valid = true AND (is_already_refunded = false OR is_already_refunded IS NULL) AND is_refund_crm = true THEN 1 ELSE 0 END) as matched_refund_confirmed,
          SUM(CASE WHEN is_acknowledged = true THEN 1 ELSE 0 END) as acknowledged,
          SUM(CASE WHEN is_closed = true THEN 1 ELSE 0 END) as closed,
          SUM(CASE WHEN is_blacklisted = true THEN 1 ELSE 0 END) as blacklisted,
          SUM(CASE WHEN post_alert_status::text = 'effective' THEN 1 ELSE 0 END) as effective,
          SUM(CASE WHEN post_alert_status::text = 'alert_got_chargeback' THEN 1 ELSE 0 END) as turned_to_cb,
          COALESCE(SUM(CASE WHEN is_order_id_valid = false OR is_order_id_valid IS NULL THEN alert_cost ELSE 0 END), 0) as cost_not_matched,
          COALESCE(SUM(CASE WHEN is_order_id_valid = true AND is_already_refunded = true THEN alert_cost ELSE 0 END), 0) as cost_already_refunded,
          -- Pipeline flow fields (based on post_alert_status)
          SUM(CASE WHEN post_alert_status::text != 'invalid_order' THEN 1 ELSE 0 END) as valid_order,
          SUM(CASE WHEN post_alert_status::text = 'invalid_order' THEN 1 ELSE 0 END) as invalid_order,
          SUM(CASE WHEN post_alert_status::text = 'alert_already_refunded' THEN 1 ELSE 0 END) as already_refunded,
          SUM(CASE WHEN post_alert_status::text NOT IN ('invalid_order', 'alert_already_refunded') THEN 1 ELSE 0 END) as not_already_refunded,
          SUM(CASE WHEN post_alert_status::text = 'unable_to_refund' THEN 1 ELSE 0 END) as unable_to_refund
        FROM data.alerts_raw
        WHERE alert_type IN ('issuer_alert', 'customerdispute_alert')
          AND (alert_timestamp ${estToDisplay})::date >= $1 AND (alert_timestamp ${estToDisplay})::date <= $2
      `, [startDateStr, endDateStr]),

      // Stuck Alerts / Alerts Needing Attention
      // alert_timestamp is in EST, convert to display timezone
      // Note: age_hours calculation uses EST alert_timestamp vs current UTC time adjusted to EST
      pool.query(`
        SELECT
          alert_id,
          CASE
            WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE alert_type
          END as alert_type_display,
          alert_timestamp ${estToDisplay} as alert_time,
          EXTRACT(EPOCH FROM ((NOW() - INTERVAL '5 hours') - alert_timestamp)) / 3600 as age_hours,
          merchant_descriptor,
          transaction_amount,
          CASE
            WHEN alert_type IN ('issuer_alert', 'customerdispute_alert')
                 AND (is_acknowledged = false OR is_acknowledged IS NULL)
                 AND EXTRACT(EPOCH FROM ((NOW() - INTERVAL '5 hours') - alert_timestamp)) / 3600 > 20 THEN 'Approaching SLA'
            WHEN (is_order_id_valid = false OR is_order_id_valid IS NULL) THEN 'Order Not Matched'
            WHEN is_refund_init = true AND (is_refund_crm = false OR is_refund_crm IS NULL)
                 AND EXTRACT(EPOCH FROM ((NOW() - INTERVAL '5 hours') - alert_timestamp)) / 3600 > 12 THEN 'Refund Pending CRM'
            WHEN alert_type IN ('issuer_alert', 'customerdispute_alert')
                 AND (is_closed = false OR is_closed IS NULL)
                 AND EXTRACT(EPOCH FROM ((NOW() - INTERVAL '5 hours') - alert_timestamp)) / 3600 > 48 THEN 'Not Closed'
            ELSE 'Unknown'
          END as issue_type,
          is_order_id_valid,
          is_refund_init,
          is_refund_crm,
          is_acknowledged,
          is_closed
        FROM data.alerts_raw
        WHERE (alert_timestamp ${estToDisplay})::date >= $1 AND (alert_timestamp ${estToDisplay})::date <= $2
          AND (
            -- Ethoca approaching SLA (>20 hours, not acknowledged)
            (alert_type IN ('issuer_alert', 'customerdispute_alert')
             AND (is_acknowledged = false OR is_acknowledged IS NULL)
             AND EXTRACT(EPOCH FROM ((NOW() - INTERVAL '5 hours') - alert_timestamp)) / 3600 > 20)
            -- Order not matched
            OR (is_order_id_valid = false OR is_order_id_valid IS NULL)
            -- Refund pending CRM
            OR (is_refund_init = true AND (is_refund_crm = false OR is_refund_crm IS NULL)
                AND EXTRACT(EPOCH FROM ((NOW() - INTERVAL '5 hours') - alert_timestamp)) / 3600 > 12)
            -- Not closed after 48h
            OR (alert_type IN ('issuer_alert', 'customerdispute_alert')
                AND (is_closed = false OR is_closed IS NULL)
                AND EXTRACT(EPOCH FROM ((NOW() - INTERVAL '5 hours') - alert_timestamp)) / 3600 > 48)
          )
        ORDER BY age_hours DESC
        LIMIT 50
      `, [startDateStr, endDateStr]),

      // Hourly Alert Ingestion - Last 24 hours in display timezone
      // Hour buckets are aligned to display timezone
      // For IST: NOW() + 5h30m (UTC to IST), For EST: NOW() - 5h (UTC to EST)
      pool.query(`
        WITH hours AS (
          SELECT generate_series(
            date_trunc('hour', NOW() ${utcToDisplay}) - INTERVAL '23 hours',
            date_trunc('hour', NOW() ${utcToDisplay}),
            INTERVAL '1 hour'
          ) as hour_bucket
        )
        SELECT
          h.hour_bucket,
          COALESCE(COUNT(a.alert_id), 0) as alert_count
        FROM hours h
        LEFT JOIN data.alerts_raw a ON date_trunc('hour', ${timeBasis === 'alert' ? 'a.alert_timestamp' : 'a.created_at'} ${timeBasisToDisplay}) = h.hour_bucket
          AND a.alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        GROUP BY h.hour_bucket
        ORDER BY h.hour_bucket
      `),

      // Daily Alert Ingestion - Last 30 days in display timezone
      pool.query(`
        WITH days AS (
          SELECT generate_series(
            (NOW() ${utcToDisplay})::date - INTERVAL '29 days',
            (NOW() ${utcToDisplay})::date,
            INTERVAL '1 day'
          )::date as day_bucket
        )
        SELECT
          d.day_bucket,
          COALESCE(COUNT(a.alert_id), 0) as alert_count
        FROM days d
        LEFT JOIN data.alerts_raw a ON (${timeBasis === 'alert' ? 'a.alert_timestamp' : 'a.created_at'} ${timeBasisToDisplay})::date = d.day_bucket
          AND a.alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        GROUP BY d.day_bucket
        ORDER BY d.day_bucket
      `),

      // Latest ingestion timestamp - apply same timezone conversion as hourly buckets
      // Return as TEXT to prevent pg driver from applying local timezone offset
      // This ensures Last Ingested matches the latest bucket with data in the tracker
      // IMPORTANT: Must use same alert_type filter as hourly tracker for consistency
      pool.query(`
        SELECT
          to_char(MAX(created_at ${utcToDisplay}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as latest_created_at
        FROM data.alerts_raw
        WHERE created_at IS NOT NULL
          AND alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
      `),

      // Ingestion Delay - Average time between alert_timestamp(EST) and created_at(UTC)
      // This is a PIPELINE HEALTH metric - timezone-independent duration calculation
      // Convert created_at from UTC to EST for accurate comparison with alert_timestamp
      pool.query(`
        WITH utc_now AS (
          SELECT NOW() AT TIME ZONE 'UTC' as now_utc
        )
        SELECT
          -- Last 24 hours (alerts INGESTED in last 24 hours)
          -- Delay = created_at(UTC->EST) - alert_timestamp(EST)
          AVG(EXTRACT(EPOCH FROM ((created_at - INTERVAL '5 hours') - alert_timestamp)) / 60) FILTER (
            WHERE date_trunc('hour', created_at)
                  >= date_trunc('hour', (SELECT now_utc FROM utc_now)) - INTERVAL '23 hours'
              AND date_trunc('hour', created_at)
                  <= date_trunc('hour', (SELECT now_utc FROM utc_now))
          ) as avg_delay_24h_minutes,
          MIN(EXTRACT(EPOCH FROM ((created_at - INTERVAL '5 hours') - alert_timestamp)) / 60) FILTER (
            WHERE date_trunc('hour', created_at)
                  >= date_trunc('hour', (SELECT now_utc FROM utc_now)) - INTERVAL '23 hours'
              AND date_trunc('hour', created_at)
                  <= date_trunc('hour', (SELECT now_utc FROM utc_now))
          ) as min_delay_24h_minutes,
          MAX(EXTRACT(EPOCH FROM ((created_at - INTERVAL '5 hours') - alert_timestamp)) / 60) FILTER (
            WHERE date_trunc('hour', created_at)
                  >= date_trunc('hour', (SELECT now_utc FROM utc_now)) - INTERVAL '23 hours'
              AND date_trunc('hour', created_at)
                  <= date_trunc('hour', (SELECT now_utc FROM utc_now))
          ) as max_delay_24h_minutes,
          -- Last 7 days (alerts INGESTED in last 7 days)
          AVG(EXTRACT(EPOCH FROM ((created_at - INTERVAL '5 hours') - alert_timestamp)) / 60) FILTER (
            WHERE created_at::date >= (SELECT now_utc FROM utc_now)::date - INTERVAL '6 days'
              AND created_at::date <= (SELECT now_utc FROM utc_now)::date
          ) as avg_delay_7d_minutes,
          -- Last 30 days (alerts INGESTED in last 30 days)
          AVG(EXTRACT(EPOCH FROM ((created_at - INTERVAL '5 hours') - alert_timestamp)) / 60) FILTER (
            WHERE created_at::date >= (SELECT now_utc FROM utc_now)::date - INTERVAL '29 days'
              AND created_at::date <= (SELECT now_utc FROM utc_now)::date
          ) as avg_delay_30d_minutes
        FROM data.alerts_raw
        WHERE alert_timestamp IS NOT NULL
          AND created_at IS NOT NULL
          AND (created_at - INTERVAL '5 hours') >= alert_timestamp
          AND alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
      `),

      // 24h Volume Trends by alert type - Last 24 hours in IST
      // 24h Volume Trends by alert type - Last 24 hours in display timezone
      pool.query(`
        WITH hours AS (
          SELECT generate_series(
            date_trunc('hour', NOW() ${utcToDisplay}) - INTERVAL '23 hours',
            date_trunc('hour', NOW() ${utcToDisplay}),
            INTERVAL '1 hour'
          ) as hour_bucket
        )
        SELECT
          h.hour_bucket as time_bucket,
          COALESCE(SUM(CASE WHEN a.alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END), 0) as ethoca,
          COALESCE(SUM(CASE WHEN a.alert_type = 'CDRN' THEN 1 ELSE 0 END), 0) as cdrn,
          COALESCE(SUM(CASE WHEN a.alert_type = 'RDR' THEN 1 ELSE 0 END), 0) as rdr
        FROM hours h
        LEFT JOIN data.alerts_raw a ON date_trunc('hour', ${timeBasis === 'alert' ? 'a.alert_timestamp' : 'a.created_at'} ${timeBasisToDisplay}) = h.hour_bucket
          AND a.alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        GROUP BY h.hour_bucket
        ORDER BY h.hour_bucket
      `),

      // Today vs Yesterday hourly comparison in display timezone
      // Uses created_at or alert_timestamp based on timeBasis
      // IMPORTANT: Both today and yesterday are limited to the current hour for apples-to-apples comparison
      pool.query(`
        WITH
        -- Current hour in display timezone
        current_tz AS (
          SELECT
            date_trunc('hour', NOW() ${utcToDisplay}) as current_hour_tz,
            EXTRACT(HOUR FROM NOW() ${utcToDisplay}) as current_hour_num
        ),
        -- Generate hours from 0 to 23
        hours AS (
          SELECT generate_series(0, 23) as hour_num
        ),
        -- Today's data (only up to current hour)
        today_data AS (
          SELECT
            EXTRACT(HOUR FROM (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})) as hour_num,
            COUNT(*) as count
          FROM data.alerts_raw
          WHERE (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date = (NOW() ${utcToDisplay})::date
            AND alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
          GROUP BY EXTRACT(HOUR FROM (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay}))
        ),
        -- Yesterday's data (only up to current hour for apples-to-apples comparison)
        yesterday_data AS (
          SELECT
            EXTRACT(HOUR FROM (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})) as hour_num,
            COUNT(*) as count
          FROM data.alerts_raw
          WHERE (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay})::date = (NOW() ${utcToDisplay})::date - INTERVAL '1 day'
            AND alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
          GROUP BY EXTRACT(HOUR FROM (${timeBasis === 'alert' ? 'alert_timestamp' : 'created_at'} ${timeBasisToDisplay}))
        )
        SELECT
          h.hour_num,
          CASE
            WHEN h.hour_num <= c.current_hour_num THEN COALESCE(t.count, 0)
            ELSE NULL
          END as today_count,
          CASE
            WHEN h.hour_num <= c.current_hour_num THEN COALESCE(y.count, 0)
            ELSE NULL
          END as yesterday_count
        FROM hours h
        CROSS JOIN current_tz c
        LEFT JOIN today_data t ON t.hour_num = h.hour_num
        LEFT JOIN yesterday_data y ON y.hour_num = h.hour_num
        ORDER BY h.hour_num
      `),

      // 30d Volume Trends by day in display timezone
      // This ensures the chart data matches the tracker data exactly
      pool.query(`
        WITH days AS (
          SELECT generate_series(
            (NOW() ${utcToDisplay})::date - INTERVAL '29 days',
            (NOW() ${utcToDisplay})::date,
            INTERVAL '1 day'
          )::date as day_bucket
        )
        SELECT
          d.day_bucket as time_bucket,
          COALESCE(SUM(CASE WHEN a.alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END), 0) as ethoca,
          COALESCE(SUM(CASE WHEN a.alert_type = 'CDRN' THEN 1 ELSE 0 END), 0) as cdrn,
          COALESCE(SUM(CASE WHEN a.alert_type = 'RDR' THEN 1 ELSE 0 END), 0) as rdr
        FROM days d
        LEFT JOIN data.alerts_raw a ON (${timeBasis === 'alert' ? 'a.alert_timestamp' : 'a.created_at'} ${timeBasisToDisplay})::date = d.day_bucket
          AND a.alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
        GROUP BY d.day_bucket
        ORDER BY d.day_bucket
      `),

      // n8n Workflow Logs - Hourly for last 24 hours (from beast_insights_v2.alert_logs)
      // NOTE: alert_logs.created_at is stored in EST
      // For IST: EST + 10h30m = IST, For EST: no conversion
      pool.query(`
        WITH hours AS (
          SELECT generate_series(
            date_trunc('hour', NOW() ${utcToDisplay}) - INTERVAL '23 hours',
            date_trunc('hour', NOW() ${utcToDisplay}),
            INTERVAL '1 hour'
          ) as hour_bucket
        )
        SELECT
          h.hour_bucket,
          COALESCE(COUNT(a.client_id), 0) as total,
          COALESCE(SUM(CASE WHEN a.is_success THEN 1 ELSE 0 END), 0) as success,
          COALESCE(SUM(CASE WHEN NOT a.is_success THEN 1 ELSE 0 END), 0) as failed
        FROM hours h
        LEFT JOIN beast_insights_v2.alert_logs a
          ON date_trunc('hour', a.created_at ${estToDisplay}) = h.hour_bucket
        GROUP BY h.hour_bucket
        ORDER BY h.hour_bucket
      `),

      // n8n Workflow Logs - Daily for last 30 days (from beast_insights_v2.alert_logs)
      // NOTE: alert_logs.created_at is stored in EST
      pool.query(`
        WITH days AS (
          SELECT generate_series(
            (NOW() ${utcToDisplay})::date - INTERVAL '29 days',
            (NOW() ${utcToDisplay})::date,
            INTERVAL '1 day'
          )::date as day_bucket
        )
        SELECT
          d.day_bucket,
          COALESCE(COUNT(a.client_id), 0) as total,
          COALESCE(SUM(CASE WHEN a.is_success THEN 1 ELSE 0 END), 0) as success,
          COALESCE(SUM(CASE WHEN NOT a.is_success THEN 1 ELSE 0 END), 0) as failed
        FROM days d
        LEFT JOIN beast_insights_v2.alert_logs a
          ON (a.created_at ${estToDisplay})::date = d.day_bucket
        GROUP BY d.day_bucket
        ORDER BY d.day_bucket
      `)
    ])

    // Process Data Ingestion Status
    // Returns UTC timestamps - frontend converts to IST for display
    const dataIngestion = dataIngestionResult.rows.map(row => ({
      source: row.source_name,
      lastIngestedAt: row.last_ingested_at,
      minutesAgo: row.last_ingested_at
        ? Math.round((Date.now() - new Date(row.last_ingested_at).getTime()) / (1000 * 60))
        : null
    }))

    // Process Volume Summary with comparison
    const currentVol = volumeSummaryResult.rows[0]
    const prevVol = prevVolumeSummaryResult.rows[0]

    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Math.round(((current - previous) / previous) * 100)
    }

    const volumeSummary = {
      ethoca: {
        count: parseInt(currentVol?.ethoca_count) || 0,
        prevCount: parseInt(prevVol?.ethoca_count) || 0,
        change: calculateChange(
          parseInt(currentVol?.ethoca_count) || 0,
          parseInt(prevVol?.ethoca_count) || 0
        )
      },
      cdrn: {
        count: parseInt(currentVol?.cdrn_count) || 0,
        prevCount: parseInt(prevVol?.cdrn_count) || 0,
        change: calculateChange(
          parseInt(currentVol?.cdrn_count) || 0,
          parseInt(prevVol?.cdrn_count) || 0
        )
      },
      rdr: {
        count: parseInt(currentVol?.rdr_count) || 0,
        prevCount: parseInt(prevVol?.rdr_count) || 0,
        change: calculateChange(
          parseInt(currentVol?.rdr_count) || 0,
          parseInt(prevVol?.rdr_count) || 0
        )
      }
    }

    // Process Volume Trends
    const volumeTrends = volumeTrendsResult.rows.map(row => ({
      time: row.time_bucket,
      Ethoca: parseInt(row.ethoca) || 0,
      CDRN: parseInt(row.cdrn) || 0,
      RDR: parseInt(row.rdr) || 0
    }))

    // Process Processing Time Analysis
    const procTime = processingTimeResult.rows[0]
    const processingTime = {
      cdrnAvgTimeToCrmRefund: parseFloat(procTime?.cdrn_avg_time_to_crm_refund_hours) || null,
      ethocaAvgTimeToCrmRefund: parseFloat(procTime?.ethoca_avg_time_to_crm_refund_hours) || null,
      ethocaAvgTimeToAcknowledge: parseFloat(procTime?.ethoca_avg_time_to_acknowledge_hours) || null,
      cdrnRefundCount: parseInt(procTime?.cdrn_refund_count) || 0,
      ethocaRefundCount: parseInt(procTime?.ethoca_refund_count) || 0,
      ethocaAcknowledgedCount: parseInt(procTime?.ethoca_acknowledged_count) || 0
    }

    // Process RDR Flow
    const rdr = rdrFlowResult.rows[0]
    const rdrReceived = parseInt(rdr?.received) || 0
    const rdrValidOrderId = parseInt(rdr?.valid_order_id) || 0
    const rdrInvalidOrderId = parseInt(rdr?.invalid_order_id) || 0
    const rdrMissingOrderId = parseInt(rdr?.missing_order_id) || 0
    const rdrValidAlreadyRefunded = parseInt(rdr?.valid_already_refunded) || 0
    const rdrValidNotRefunded = parseInt(rdr?.valid_not_refunded) || 0
    const rdrValidBlacklisted = parseInt(rdr?.valid_blacklisted) || 0
    const rdrValidNotBlacklisted = parseInt(rdr?.valid_not_blacklisted) || 0

    const rdrCreditEligibleCount = rdrInvalidOrderId + rdrMissingOrderId + rdrValidAlreadyRefunded
    const rdrCreditEligibleAmount = (parseFloat(rdr?.cost_invalid_order) || 0) +
                                     (parseFloat(rdr?.cost_missing_order) || 0) +
                                     (parseFloat(rdr?.cost_already_refunded) || 0)

    const rdrFlow = {
      received: rdrReceived,
      validOrderId: rdrValidOrderId,
      invalidOrderId: rdrInvalidOrderId,
      missingOrderId: rdrMissingOrderId,
      validAlreadyRefunded: rdrValidAlreadyRefunded,
      validNotRefunded: rdrValidNotRefunded,
      validBlacklisted: rdrValidBlacklisted,
      validNotBlacklisted: rdrValidNotBlacklisted,
      refundInitiated: parseInt(rdr?.refund_initiated) || 0,
      refundCrm: parseInt(rdr?.refund_crm) || 0,
      effective: parseInt(rdr?.status_effective) || 0,
      turnedToCB: parseInt(rdr?.turned_to_cb) || 0,
      creditEligible: rdrCreditEligibleCount,
      creditEligibleAmount: rdrCreditEligibleAmount,
      // Effectiveness = post_alert_status = 'effective' count / total alerts
      effectivenessRate: rdrReceived > 0
        ? Math.round(((parseInt(rdr?.status_effective) || 0) / rdrReceived) * 100)
        : 0
    }

    // Process CDRN Flow
    const cdrn = cdrnFlowResult.rows[0]
    const cdrnReceived = parseInt(cdrn?.received) || 0
    const cdrnOrderMatched = parseInt(cdrn?.order_matched) || 0
    const cdrnOrderNotMatched = parseInt(cdrn?.order_not_matched) || 0
    const cdrnAlreadyRefunded = parseInt(cdrn?.already_refunded) || 0
    const cdrnAlreadyChargeback = parseInt(cdrn?.already_chargeback) || 0
    const cdrnUnableToRefund = parseInt(cdrn?.unable_to_refund) || 0
    const cdrnValidBlacklisted = parseInt(cdrn?.valid_blacklisted) || 0
    const cdrnValidNotBlacklisted = parseInt(cdrn?.valid_not_blacklisted) || 0
    const cdrnEffective = parseInt(cdrn?.effective) || 0
    // Valid orders that passed all fallout checks
    const cdrnValidNotFallout = cdrnOrderMatched - cdrnAlreadyRefunded - cdrnAlreadyChargeback - cdrnUnableToRefund
    const cdrnFlow = {
      received: cdrnReceived,
      orderMatched: cdrnOrderMatched,
      orderNotMatched: cdrnOrderNotMatched,
      // Step 3: Fallout checks
      alreadyRefunded: cdrnAlreadyRefunded,
      alreadyChargeback: cdrnAlreadyChargeback,
      unableToRefund: cdrnUnableToRefund,
      validNotFallout: cdrnValidNotFallout,
      // Step 4: Blacklist status
      validBlacklisted: cdrnValidBlacklisted,
      validNotBlacklisted: cdrnValidNotBlacklisted,
      // Legacy fields
      matchedAlreadyRefunded: parseInt(cdrn?.matched_already_refunded) || 0,
      matchedRefundInitiated: parseInt(cdrn?.matched_refund_initiated) || 0,
      matchedRefundConfirmed: parseInt(cdrn?.matched_refund_confirmed) || 0,
      blacklisted: parseInt(cdrn?.blacklisted) || 0,
      effective: cdrnEffective,
      turnedToCB: parseInt(cdrn?.turned_to_cb) || 0,
      creditEligible: (parseInt(cdrn?.order_not_matched) || 0) + (parseInt(cdrn?.matched_already_refunded) || 0),
      creditEligibleAmount: (parseFloat(cdrn?.cost_not_matched) || 0) + (parseFloat(cdrn?.cost_already_refunded) || 0),
      effectivenessRate: cdrnReceived > 0 ? Math.round(((parseInt(cdrn?.effective) || 0) / cdrnReceived) * 100) : 0
    }

    // Process Ethoca Flow
    const ethoca = ethocaFlowResult.rows[0]
    const ethocaReceived = parseInt(ethoca?.received) || 0
    const ethocaFlow = {
      received: ethocaReceived,
      orderMatched: parseInt(ethoca?.order_matched) || 0,
      orderNotMatched: parseInt(ethoca?.order_not_matched) || 0,
      matchedAlreadyRefunded: parseInt(ethoca?.matched_already_refunded) || 0,
      matchedRefundInitiated: parseInt(ethoca?.matched_refund_initiated) || 0,
      matchedRefundConfirmed: parseInt(ethoca?.matched_refund_confirmed) || 0,
      acknowledged: parseInt(ethoca?.acknowledged) || 0,
      closed: parseInt(ethoca?.closed) || 0,
      blacklisted: parseInt(ethoca?.blacklisted) || 0,
      effective: parseInt(ethoca?.effective) || 0,
      turnedToCB: parseInt(ethoca?.turned_to_cb) || 0,
      creditEligible: (parseInt(ethoca?.order_not_matched) || 0) + (parseInt(ethoca?.matched_already_refunded) || 0),
      creditEligibleAmount: (parseFloat(ethoca?.cost_not_matched) || 0) + (parseFloat(ethoca?.cost_already_refunded) || 0),
      effectivenessRate: ethocaReceived > 0 ? Math.round(((parseInt(ethoca?.effective) || 0) / ethocaReceived) * 100) : 0,
      // Pipeline flow fields
      validOrder: parseInt(ethoca?.valid_order) || 0,
      invalidOrder: parseInt(ethoca?.invalid_order) || 0,
      alreadyRefunded: parseInt(ethoca?.already_refunded) || 0,
      notAlreadyRefunded: parseInt(ethoca?.not_already_refunded) || 0,
      unableToRefund: parseInt(ethoca?.unable_to_refund) || 0
    }

    // Process Stuck Alerts (IST)
    const alertsNeedingAttention = stuckAlertsResult.rows.map(row => ({
      alertId: row.alert_id,
      alertType: row.alert_type_display,
      alertTime: row.alert_time,
      ageHours: Math.round(parseFloat(row.age_hours) || 0),
      descriptor: row.merchant_descriptor,
      amount: parseFloat(row.transaction_amount) || 0,
      issueType: row.issue_type,
      flags: {
        orderMatched: row.is_order_id_valid === true,
        refundInitiated: row.is_refund_init === true,
        refundConfirmed: row.is_refund_crm === true,
        acknowledged: row.is_acknowledged === true,
        closed: row.is_closed === true
      }
    }))

    // Process Hourly Alert Ingestion (last 24 hours)
    const hourlyIngestion = hourlyIngestionResult.rows.map(row => ({
      timeBucket: row.hour_bucket,
      count: parseInt(row.alert_count) || 0
    }))

    // Process Daily Alert Ingestion (last 30 days)
    const dailyIngestion = dailyIngestionResult.rows.map(row => ({
      timeBucket: row.day_bucket,
      count: parseInt(row.alert_count) || 0
    }))

    // Process Latest Ingestion Timestamp (IST)
    const latestIngestionTimestamp = latestIngestionResult.rows[0]?.latest_created_at || null

    // Process 24h Volume Trends (same logic as hourlyIngestion, IST timezone)
    const volumeTrends24h = volumeTrends24hResult.rows.map(row => ({
      time: row.time_bucket,
      Ethoca: parseInt(row.ethoca) || 0,
      CDRN: parseInt(row.cdrn) || 0,
      RDR: parseInt(row.rdr) || 0
    }))

    // Process 30d Volume Trends (same day buckets as dailyIngestion, IST timezone)
    const volumeTrends30d = volumeTrends30dResult.rows.map(row => ({
      time: row.time_bucket,
      Ethoca: parseInt(row.ethoca) || 0,
      CDRN: parseInt(row.cdrn) || 0,
      RDR: parseInt(row.rdr) || 0
    }))

    // Calculate volumeByPeriod from consistent sources to ensure totals match
    // For 24h: Sum from volumeTrends24h (same hour buckets as hourlyIngestion)
    const vol24hFromTrends = volumeTrends24h.reduce(
      (acc, row) => ({
        ethoca: acc.ethoca + row.Ethoca,
        cdrn: acc.cdrn + row.CDRN,
        rdr: acc.rdr + row.RDR
      }),
      { ethoca: 0, cdrn: 0, rdr: 0 }
    )

    // For 30d: Sum from volumeTrends30d (same day buckets as dailyIngestion)
    const vol30dFromTrends = volumeTrends30d.reduce(
      (acc, row) => ({
        ethoca: acc.ethoca + row.Ethoca,
        cdrn: acc.cdrn + row.CDRN,
        rdr: acc.rdr + row.RDR
      }),
      { ethoca: 0, cdrn: 0, rdr: 0 }
    )

    // For 7d: Sum from last 7 days of volumeTrends30d (consistent with chart 7d view)
    const last7DaysData = volumeTrends30d.slice(-7)
    const vol7dFromTrends = last7DaysData.reduce(
      (acc, row) => ({
        ethoca: acc.ethoca + row.Ethoca,
        cdrn: acc.cdrn + row.CDRN,
        rdr: acc.rdr + row.RDR
      }),
      { ethoca: 0, cdrn: 0, rdr: 0 }
    )

    const volumeByPeriod = {
      '24h': vol24hFromTrends,
      '7d': vol7dFromTrends,
      '30d': vol30dFromTrends
    }

    // Process Today vs Yesterday hourly data
    // Both today and yesterday are limited to current hour for apples-to-apples comparison
    const todayVsYesterday = todayVsYesterdayResult.rows.map(row => ({
      hour: parseInt(row.hour_num),
      time: `${parseInt(row.hour_num)}:00`,
      Today: row.today_count !== null ? parseInt(row.today_count) : null,
      Yesterday: row.yesterday_count !== null ? parseInt(row.yesterday_count) : null
    }))

    // Calculate totals for today and yesterday (only counting hours up to current time)
    const todayTotal = todayVsYesterday.reduce((sum, row) => sum + (row.Today || 0), 0)
    const yesterdayTotal = todayVsYesterday.reduce((sum, row) => sum + (row.Yesterday || 0), 0)

    // Process Ingestion Delay
    const delayData = ingestionDelayResult.rows[0]
    const ingestionDelay = {
      avg24h: parseFloat(delayData?.avg_delay_24h_minutes) || null,
      min24h: parseFloat(delayData?.min_delay_24h_minutes) || null,
      max24h: parseFloat(delayData?.max_delay_24h_minutes) || null,
      avg7d: parseFloat(delayData?.avg_delay_7d_minutes) || null,
      avg30d: parseFloat(delayData?.avg_delay_30d_minutes) || null
    }

    // Process n8n Workflow Logs (from beast_insights_v2.alert_logs)
    const n8nHourly = n8nHourlyResult.rows.map(row => ({
      timeBucket: row.hour_bucket,
      total: parseInt(row.total) || 0,
      success: parseInt(row.success) || 0,
      failed: parseInt(row.failed) || 0
    }))

    const n8nDaily = n8nDailyResult.rows.map(row => ({
      timeBucket: row.day_bucket,
      total: parseInt(row.total) || 0,
      success: parseInt(row.success) || 0,
      failed: parseInt(row.failed) || 0
    }))

    return NextResponse.json({
      dateRange: { start: startDateStr, end: endDateStr },
      prevDateRange: { start: prevStartDateStr, end: prevEndDateStr },
      timeBasis,
      timezone,
      dataIngestion,
      volumeSummary,
      volumeTrends,
      volumeTrends24h,
      volumeTrends30d,
      processingTime,
      rdrFlow,
      cdrnFlow,
      ethocaFlow,
      alertsNeedingAttention,
      hourlyIngestion,
      dailyIngestion,
      latestIngestionTimestamp,
      volumeByPeriod,
      ingestionDelay,
      todayVsYesterday,
      todayTotal,
      yesterdayTotal,
      n8nHourly,
      n8nDaily,
      summary: {
        totalAlerts: volumeSummary.ethoca.count + volumeSummary.cdrn.count + volumeSummary.rdr.count,
        totalPrevAlerts: volumeSummary.ethoca.prevCount + volumeSummary.cdrn.prevCount + volumeSummary.rdr.prevCount
      }
    })
  } catch (error) {
    console.error('Database error:', error)
    return NextResponse.json({ error: 'Failed to fetch operations data' }, { status: 500 })
  }
}
