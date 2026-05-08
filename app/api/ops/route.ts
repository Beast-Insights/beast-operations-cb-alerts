import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const timeRange = searchParams.get('range') || '24h' // 24h, 7d, 30d

    // Calculate date range based on parameter
    let intervalClause = "INTERVAL '24 hours'"
    let groupByFormat = 'YYYY-MM-DD HH24:00' // Hourly for 24h
    if (timeRange === '7d') {
      intervalClause = "INTERVAL '7 days'"
      groupByFormat = 'YYYY-MM-DD' // Daily for 7d
    } else if (timeRange === '30d') {
      intervalClause = "INTERVAL '30 days'"
      groupByFormat = 'YYYY-MM-DD' // Daily for 30d
    }

    // Run all queries in parallel
    const [
      volumeByHourResult,
      volumeByTypeResult,
      pipelineStatusResult,
      slaRiskResult,
      recentAlertsResult,
      effectivenessResult,
      processingTimeResult
    ] = await Promise.all([
      // 1. Alert Volume by Hour/Day (for trends)
      pool.query(`
        SELECT
          TO_CHAR(alert_timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', '${groupByFormat}') as time_bucket,
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE 'Other'
          END as alert_category,
          COUNT(*) as received,
          SUM(CASE WHEN post_alert_status::text = 'effective' THEN 1 ELSE 0 END) as processed_effective
        FROM data.alerts_raw
        WHERE alert_timestamp >= NOW() - ${intervalClause}
        GROUP BY time_bucket, alert_category
        ORDER BY time_bucket ASC
      `),

      // 2. Current Volume by Alert Type (summary)
      pool.query(`
        SELECT
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE 'Other'
          END as alert_category,
          COUNT(*) as total,
          SUM(CASE WHEN alert_timestamp >= NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END) as last_hour,
          SUM(CASE WHEN alert_timestamp >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as last_24h,
          SUM(CASE WHEN alert_timestamp >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) as last_7d,
          MAX(alert_timestamp) as last_alert_time,
          SUM(alert_cost) as total_cost
        FROM data.alerts_raw
        WHERE alert_timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY alert_category
        ORDER BY total DESC
      `),

      // 3. Pipeline Status - Alerts at each stage
      pool.query(`
        SELECT
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE 'Other'
          END as alert_category,
          COUNT(*) as total_received,
          -- Order matching stage
          SUM(CASE WHEN is_order_id_valid = true THEN 1 ELSE 0 END) as valid_order,
          SUM(CASE WHEN is_order_id_valid = false THEN 1 ELSE 0 END) as invalid_order,
          SUM(CASE WHEN is_order_id_valid IS NULL THEN 1 ELSE 0 END) as missing_order,
          -- Refund stage
          SUM(CASE WHEN is_already_refunded = true THEN 1 ELSE 0 END) as already_refunded,
          SUM(CASE WHEN is_refund_init = true THEN 1 ELSE 0 END) as refund_initiated,
          SUM(CASE WHEN is_refund_crm = true THEN 1 ELSE 0 END) as refund_confirmed,
          -- Ethoca specific
          SUM(CASE WHEN data_source = 'ethoca_api' AND is_acknowledged = true THEN 1 ELSE 0 END) as acknowledged,
          SUM(CASE WHEN data_source = 'ethoca_api' AND is_closed = true THEN 1 ELSE 0 END) as closed,
          -- Outcomes
          SUM(CASE WHEN post_alert_status::text = 'effective' THEN 1 ELSE 0 END) as effective,
          SUM(CASE WHEN post_alert_status::text = 'invalid_order' THEN 1 ELSE 0 END) as status_invalid,
          SUM(CASE WHEN post_alert_status::text = 'unable_to_refund' THEN 1 ELSE 0 END) as status_unable,
          SUM(CASE WHEN post_alert_status::text = 'alert_already_refunded' THEN 1 ELSE 0 END) as status_already_refunded,
          SUM(CASE WHEN post_alert_status::text = 'alert_got_chargeback' THEN 1 ELSE 0 END) as status_chargeback
        FROM data.alerts_raw
        WHERE alert_timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY alert_category
      `),

      // 4. SLA Risk Monitor - Ethoca 24h, CDRN 72h
      pool.query(`
        SELECT
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE 'Other'
          END as alert_category,
          -- Ethoca SLA (24h for acknowledgment)
          SUM(CASE
            WHEN data_source = 'ethoca_api'
              AND (is_acknowledged = false OR is_acknowledged IS NULL)
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 > 24
            THEN 1 ELSE 0
          END) as ethoca_sla_breached,
          SUM(CASE
            WHEN data_source = 'ethoca_api'
              AND (is_acknowledged = false OR is_acknowledged IS NULL)
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 BETWEEN 12 AND 24
            THEN 1 ELSE 0
          END) as ethoca_sla_warning,
          SUM(CASE
            WHEN data_source = 'ethoca_api'
              AND (is_acknowledged = false OR is_acknowledged IS NULL)
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 < 12
            THEN 1 ELSE 0
          END) as ethoca_sla_healthy,
          -- CDRN SLA (72h)
          SUM(CASE
            WHEN alert_type = 'CDRN'
              AND post_alert_status::text NOT IN ('effective')
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 > 72
            THEN 1 ELSE 0
          END) as cdrn_sla_breached,
          SUM(CASE
            WHEN alert_type = 'CDRN'
              AND post_alert_status::text NOT IN ('effective')
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 BETWEEN 36 AND 72
            THEN 1 ELSE 0
          END) as cdrn_sla_warning,
          SUM(CASE
            WHEN alert_type = 'CDRN'
              AND post_alert_status::text NOT IN ('effective')
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 < 36
            THEN 1 ELSE 0
          END) as cdrn_sla_healthy,
          -- Credit at risk (alert_cost for SLA breached)
          COALESCE(SUM(CASE
            WHEN data_source = 'ethoca_api'
              AND (is_acknowledged = false OR is_acknowledged IS NULL)
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 > 24
            THEN alert_cost ELSE 0
          END), 0) as ethoca_credit_at_risk,
          COALESCE(SUM(CASE
            WHEN alert_type = 'CDRN'
              AND post_alert_status::text NOT IN ('effective')
              AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 > 72
            THEN alert_cost ELSE 0
          END), 0) as cdrn_credit_at_risk
        FROM data.alerts_raw
        WHERE alert_timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY alert_category
      `),

      // 5. Recent Alerts needing attention (SLA at risk)
      pool.query(`
        SELECT
          alert_id,
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE 'Other'
          END as alert_category,
          alert_timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as alert_timestamp_est,
          ROUND(EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600, 1) as age_hours,
          CASE
            WHEN data_source = 'ethoca_api' THEN 24 - ROUND(EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600, 1)
            WHEN alert_type = 'CDRN' THEN 72 - ROUND(EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600, 1)
            ELSE NULL
          END as hours_remaining,
          merchant_descriptor,
          transaction_amount,
          alert_cost,
          post_alert_status::text as status,
          is_order_id_valid,
          is_refund_init,
          is_refund_crm,
          is_acknowledged,
          is_closed
        FROM data.alerts_raw
        WHERE alert_timestamp >= NOW() - INTERVAL '7 days'
          AND (
            -- Ethoca not acknowledged within warning window
            (data_source = 'ethoca_api' AND (is_acknowledged = false OR is_acknowledged IS NULL) AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 > 12)
            OR
            -- CDRN not effective within warning window
            (alert_type = 'CDRN' AND post_alert_status::text != 'effective' AND EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 > 36)
          )
        ORDER BY
          CASE WHEN data_source = 'ethoca_api' THEN EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 - 24
               WHEN alert_type = 'CDRN' THEN (EXTRACT(EPOCH FROM (NOW() - alert_timestamp))/3600 - 72) / 3
               ELSE 0 END DESC
        LIMIT 50
      `),

      // 6. Effectiveness Rate by Type
      pool.query(`
        SELECT
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE 'Other'
          END as alert_category,
          COUNT(*) as total,
          SUM(CASE WHEN post_alert_status::text = 'effective' THEN 1 ELSE 0 END) as effective,
          ROUND(100.0 * SUM(CASE WHEN post_alert_status::text = 'effective' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) as effectiveness_rate
        FROM data.alerts_raw
        WHERE alert_timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY alert_category
      `),

      // 7. Processing Time Analysis
      pool.query(`
        SELECT
          CASE
            WHEN data_source = 'ethoca_api' THEN 'Ethoca'
            WHEN alert_type = 'CDRN' THEN 'CDRN'
            WHEN alert_type = 'RDR' THEN 'RDR'
            ELSE 'Other'
          END as alert_category,
          ROUND(AVG(EXTRACT(EPOCH FROM (refund_timestamp_init - alert_timestamp))/3600)::numeric, 2) as avg_hours_to_refund_init,
          ROUND(AVG(EXTRACT(EPOCH FROM (refund_timestamp_crm - refund_timestamp_init))/3600)::numeric, 2) as avg_hours_refund_to_crm,
          ROUND(AVG(CASE WHEN is_refund_init = true THEN EXTRACT(EPOCH FROM (refund_timestamp_init - alert_timestamp))/3600 END)::numeric, 2) as avg_processing_time
        FROM data.alerts_raw
        WHERE alert_timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY alert_category
      `)
    ])

    // Process volume by hour/day data for chart
    const volumeTrend: Record<string, { time: string; Ethoca: number; CDRN: number; RDR: number; Ethoca_Processed: number; CDRN_Processed: number; RDR_Processed: number }> = {}
    volumeByHourResult.rows.forEach(row => {
      if (!volumeTrend[row.time_bucket]) {
        volumeTrend[row.time_bucket] = {
          time: row.time_bucket,
          Ethoca: 0, CDRN: 0, RDR: 0,
          Ethoca_Processed: 0, CDRN_Processed: 0, RDR_Processed: 0
        }
      }
      volumeTrend[row.time_bucket][row.alert_category as 'Ethoca' | 'CDRN' | 'RDR'] = parseInt(row.received)
      volumeTrend[row.time_bucket][`${row.alert_category}_Processed` as 'Ethoca_Processed' | 'CDRN_Processed' | 'RDR_Processed'] = parseInt(row.processed_effective)
    })

    // Process volume by type summary
    const volumeByType = volumeByTypeResult.rows.map(row => ({
      type: row.alert_category,
      total: parseInt(row.total),
      lastHour: parseInt(row.last_hour),
      last24h: parseInt(row.last_24h),
      last7d: parseInt(row.last_7d),
      lastAlertTime: row.last_alert_time,
      totalCost: parseFloat(row.total_cost) || 0
    }))

    // Process pipeline status
    const pipelineStatus = pipelineStatusResult.rows.map(row => ({
      type: row.alert_category,
      totalReceived: parseInt(row.total_received),
      validOrder: parseInt(row.valid_order),
      invalidOrder: parseInt(row.invalid_order),
      missingOrder: parseInt(row.missing_order),
      alreadyRefunded: parseInt(row.already_refunded),
      refundInitiated: parseInt(row.refund_initiated),
      refundConfirmed: parseInt(row.refund_confirmed),
      acknowledged: parseInt(row.acknowledged),
      closed: parseInt(row.closed),
      effective: parseInt(row.effective),
      statusInvalid: parseInt(row.status_invalid),
      statusUnable: parseInt(row.status_unable),
      statusAlreadyRefunded: parseInt(row.status_already_refunded),
      statusChargeback: parseInt(row.status_chargeback)
    }))

    // Process SLA risk
    const slaRisk = {
      ethoca: {
        breached: 0,
        warning: 0,
        healthy: 0,
        creditAtRisk: 0
      },
      cdrn: {
        breached: 0,
        warning: 0,
        healthy: 0,
        creditAtRisk: 0
      }
    }
    slaRiskResult.rows.forEach(row => {
      if (row.alert_category === 'Ethoca') {
        slaRisk.ethoca.breached = parseInt(row.ethoca_sla_breached) || 0
        slaRisk.ethoca.warning = parseInt(row.ethoca_sla_warning) || 0
        slaRisk.ethoca.healthy = parseInt(row.ethoca_sla_healthy) || 0
        slaRisk.ethoca.creditAtRisk = parseFloat(row.ethoca_credit_at_risk) || 0
      }
      if (row.alert_category === 'CDRN') {
        slaRisk.cdrn.breached = parseInt(row.cdrn_sla_breached) || 0
        slaRisk.cdrn.warning = parseInt(row.cdrn_sla_warning) || 0
        slaRisk.cdrn.healthy = parseInt(row.cdrn_sla_healthy) || 0
        slaRisk.cdrn.creditAtRisk = parseFloat(row.cdrn_credit_at_risk) || 0
      }
    })

    // Process recent alerts needing attention
    const alertsNeedingAttention = recentAlertsResult.rows.map(row => ({
      alertId: row.alert_id,
      type: row.alert_category,
      timestamp: row.alert_timestamp_est,
      ageHours: parseFloat(row.age_hours),
      hoursRemaining: row.hours_remaining ? parseFloat(row.hours_remaining) : null,
      descriptor: row.merchant_descriptor,
      amount: parseFloat(row.transaction_amount) || 0,
      cost: parseFloat(row.alert_cost) || 0,
      status: row.status,
      isOrderValid: row.is_order_id_valid,
      isRefundInit: row.is_refund_init,
      isRefundCrm: row.is_refund_crm,
      isAcknowledged: row.is_acknowledged,
      isClosed: row.is_closed
    }))

    // Process effectiveness
    const effectiveness = effectivenessResult.rows.map(row => ({
      type: row.alert_category,
      total: parseInt(row.total),
      effective: parseInt(row.effective),
      rate: parseFloat(row.effectiveness_rate) || 0
    }))

    // Process processing times
    const processingTimes = processingTimeResult.rows.map(row => ({
      type: row.alert_category,
      avgHoursToRefundInit: parseFloat(row.avg_hours_to_refund_init) || null,
      avgHoursRefundToCrm: parseFloat(row.avg_hours_refund_to_crm) || null,
      avgProcessingTime: parseFloat(row.avg_processing_time) || null
    }))

    // Calculate system health status
    const totalSlaBreached = slaRisk.ethoca.breached + slaRisk.cdrn.breached
    const totalSlaWarning = slaRisk.ethoca.warning + slaRisk.cdrn.warning

    const systemHealth = {
      overall: totalSlaBreached > 0 ? 'critical' : totalSlaWarning > 0 ? 'warning' : 'healthy',
      sla: totalSlaBreached > 0 ? 'critical' : totalSlaWarning > 0 ? 'warning' : 'healthy',
      processing: 'healthy', // Could add logic to detect processing issues
      ingestion: 'placeholder' // N8n integration placeholder
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      timeRange,
      systemHealth,
      volumeTrend: Object.values(volumeTrend),
      volumeByType,
      pipelineStatus,
      slaRisk,
      alertsNeedingAttention,
      effectiveness,
      processingTimes
    })

  } catch (error) {
    console.error('Operations API error:', error)
    return NextResponse.json({ error: 'Failed to fetch operations data' }, { status: 500 })
  }
}
