import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// Alert thresholds (in hours unless specified)
const THRESHOLDS = {
  DATA_SOURCE_OFFLINE: 5, // hours - no alerts from source
  SLA_BREACH_WARNING: 2, // hours remaining before SLA breach
  ETHOCA_SLA: 24, // hours - Ethoca acknowledgement SLA
  CDRN_SLA: 72, // hours - CDRN refund SLA
  ETHOCA_ACK_WARNING: 4, // hours - warn if not acknowledged
  REFUND_PROCESSING_TARGET: 4, // hours - target refund time
  VOLUME_ANOMALY_PERCENT: 30, // ±30% from expected
  ORDER_MATCHING_DROP: 15, // % drop from baseline
  EFFECTIVENESS_WARNING: 75, // % - warning level
  EFFECTIVENESS_INFO: 85, // % - info level
  DESCRIPTOR_EFFECTIVENESS_DROP: 10, // % drop from baseline
}

export async function GET(request: Request) {
  try {
    await pool.query("SET timezone TO 'UTC'")

    const { searchParams } = new URL(request.url)
    const timezone = searchParams.get('timezone') || 'IST'

    // Timezone conversion: created_at is UTC, alert_timestamp is EST
    const utcToDisplay = timezone === 'IST' ? `+ INTERVAL '5 hours 30 minutes'` : `- INTERVAL '5 hours'`
    const estToDisplay = timezone === 'IST' ? `+ INTERVAL '10 hours 30 minutes'` : ``

    // Run all queries in parallel
    const [
      dataSourceStatusResult,
      slaBreachResult,
      ethocaAckDelayResult,
      refundDelayResult,
      volumeAnomalyResult,
      orderMatchingResult,
      overallEffectivenessResult,
      descriptorEffectivenessResult
    ] = await Promise.all([
      // 1. Data Source Status - Last alert per source
      pool.query(`
        SELECT
          source,
          last_ingested,
          last_alert_timestamp,
          minutes_ago,
          CASE
            WHEN minutes_ago < 120 THEN 'healthy'
            WHEN minutes_ago < 300 THEN 'warning'
            ELSE 'critical'
          END as status
        FROM (
          SELECT
            CASE
              WHEN alert_type = 'RDR' THEN 'RDR'
              WHEN alert_type = 'CDRN' THEN 'CDRN'
              WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 'Ethoca'
            END as source,
            MAX(created_at ${utcToDisplay}) as last_ingested,
            MAX(alert_timestamp ${estToDisplay}) as last_alert_timestamp,
            EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60 as minutes_ago
          FROM data.alerts_raw
          WHERE alert_type IN ('RDR', 'CDRN', 'issuer_alert', 'customerdispute_alert')
          GROUP BY
            CASE
              WHEN alert_type = 'RDR' THEN 'RDR'
              WHEN alert_type = 'CDRN' THEN 'CDRN'
              WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 'Ethoca'
            END
        ) subq
        ORDER BY
          CASE source
            WHEN 'RDR' THEN 1
            WHEN 'Ethoca' THEN 2
            WHEN 'CDRN' THEN 3
          END
      `),

      // 2. SLA Breach Countdown - Alerts approaching SLA deadline
      pool.query(`
        SELECT
          alert_type_group,
          count,
          total_amount,
          hours_remaining
        FROM (
          -- Ethoca: 24h SLA from alert_timestamp
          SELECT
            'Ethoca' as alert_type_group,
            COUNT(*) as count,
            COALESCE(SUM(transaction_amount), 0) as total_amount,
            MIN(${THRESHOLDS.ETHOCA_SLA} - EXTRACT(EPOCH FROM (NOW() - (alert_timestamp ${estToDisplay}))) / 3600) as hours_remaining
          FROM data.alerts_raw
          WHERE alert_type IN ('issuer_alert', 'customerdispute_alert')
            AND (is_acknowledged IS NULL OR is_acknowledged = false)
            AND alert_timestamp > NOW() - INTERVAL '${THRESHOLDS.ETHOCA_SLA} hours'
            AND EXTRACT(EPOCH FROM (NOW() - (alert_timestamp ${estToDisplay}))) / 3600 > ${THRESHOLDS.ETHOCA_SLA - THRESHOLDS.SLA_BREACH_WARNING}
          HAVING COUNT(*) > 0

          UNION ALL

          -- CDRN: 72h SLA from alert_timestamp
          SELECT
            'CDRN' as alert_type_group,
            COUNT(*) as count,
            COALESCE(SUM(transaction_amount), 0) as total_amount,
            MIN(${THRESHOLDS.CDRN_SLA} - EXTRACT(EPOCH FROM (NOW() - (alert_timestamp ${estToDisplay}))) / 3600) as hours_remaining
          FROM data.alerts_raw
          WHERE alert_type = 'CDRN'
            AND (is_refund_crm IS NULL OR is_refund_crm = false)
            AND alert_timestamp > NOW() - INTERVAL '${THRESHOLDS.CDRN_SLA} hours'
            AND EXTRACT(EPOCH FROM (NOW() - (alert_timestamp ${estToDisplay}))) / 3600 > ${THRESHOLDS.CDRN_SLA - THRESHOLDS.SLA_BREACH_WARNING}
          HAVING COUNT(*) > 0
        ) breaches
        WHERE count > 0
      `),

      // 3. Ethoca Acknowledgement Delay - >4 hours unacknowledged
      pool.query(`
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(transaction_amount), 0) as total_amount,
          MAX(EXTRACT(EPOCH FROM (NOW() - (alert_timestamp ${estToDisplay}))) / 3600) as oldest_hours
        FROM data.alerts_raw
        WHERE alert_type IN ('issuer_alert', 'customerdispute_alert')
          AND (is_acknowledged IS NULL OR is_acknowledged = false)
          AND EXTRACT(EPOCH FROM (NOW() - (alert_timestamp ${estToDisplay}))) / 3600 > ${THRESHOLDS.ETHOCA_ACK_WARNING}
          AND alert_timestamp > NOW() - INTERVAL '${THRESHOLDS.ETHOCA_SLA} hours'
      `),

      // 4. Refund Processing Delay - Avg time from ingestion to refund
      pool.query(`
        SELECT
          AVG(EXTRACT(EPOCH FROM (refund_timestamp_crm - created_at)) / 3600) as avg_refund_hours,
          COUNT(*) as refund_count,
          (SELECT COUNT(*) FROM data.alerts_raw
           WHERE is_refund_init = true
             AND (is_refund_crm IS NULL OR is_refund_crm = false)
             AND created_at > NOW() - INTERVAL '24 hours'
             AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 > ${THRESHOLDS.REFUND_PROCESSING_TARGET}
          ) as pending_count
        FROM data.alerts_raw
        WHERE is_refund_crm = true
          AND created_at > NOW() - INTERVAL '24 hours'
          AND refund_timestamp_crm IS NOT NULL
      `),

      // 5. Volume Anomaly - Compare current hour vs same hour last 4 weeks
      pool.query(`
        WITH current_hour AS (
          SELECT COUNT(*) as current_count
          FROM data.alerts_raw
          WHERE created_at > NOW() - INTERVAL '1 hour'
        ),
        historical_avg AS (
          SELECT AVG(hourly_count) as expected_count
          FROM (
            SELECT
              DATE_TRUNC('hour', created_at) as hour_bucket,
              COUNT(*) as hourly_count
            FROM data.alerts_raw
            WHERE created_at > NOW() - INTERVAL '28 days'
              AND created_at < NOW() - INTERVAL '1 hour'
              AND EXTRACT(HOUR FROM created_at) = EXTRACT(HOUR FROM NOW())
              AND EXTRACT(DOW FROM created_at) = EXTRACT(DOW FROM NOW())
            GROUP BY DATE_TRUNC('hour', created_at)
          ) hourly
        )
        SELECT
          c.current_count,
          COALESCE(h.expected_count, c.current_count) as expected_count,
          CASE
            WHEN COALESCE(h.expected_count, 0) = 0 THEN 0
            ELSE ROUND(((c.current_count - h.expected_count) / h.expected_count * 100)::numeric, 1)
          END as anomaly_percent
        FROM current_hour c, historical_avg h
      `),

      // 6. Order Matching Rate Degradation - Per descriptor
      pool.query(`
        WITH baseline AS (
          SELECT
            merchant_descriptor,
            COUNT(*) FILTER (WHERE is_order_id_valid = true)::float / NULLIF(COUNT(*), 0) * 100 as baseline_rate
          FROM data.alerts_raw
          WHERE created_at > NOW() - INTERVAL '7 days'
            AND merchant_descriptor IS NOT NULL
          GROUP BY merchant_descriptor
          HAVING COUNT(*) >= 20
        ),
        current_rate AS (
          SELECT
            merchant_descriptor,
            COUNT(*) FILTER (WHERE is_order_id_valid = true)::float / NULLIF(COUNT(*), 0) * 100 as current_rate,
            COUNT(*) as alert_count
          FROM data.alerts_raw
          WHERE created_at > NOW() - INTERVAL '24 hours'
            AND merchant_descriptor IS NOT NULL
          GROUP BY merchant_descriptor
          HAVING COUNT(*) >= 10
        )
        SELECT
          c.merchant_descriptor,
          ROUND(c.current_rate::numeric, 1) as current_rate,
          ROUND(b.baseline_rate::numeric, 1) as baseline_rate,
          c.alert_count
        FROM current_rate c
        JOIN baseline b ON c.merchant_descriptor = b.merchant_descriptor
        WHERE b.baseline_rate - c.current_rate > ${THRESHOLDS.ORDER_MATCHING_DROP}
        ORDER BY (b.baseline_rate - c.current_rate) DESC
        LIMIT 5
      `),

      // 7. Overall Effectiveness - Last 7 days
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE post_alert_status = 'effective')::float / NULLIF(COUNT(*), 0) * 100 as effectiveness_rate,
          COUNT(*) FILTER (WHERE post_alert_status = 'alert_got_chargeback') as chargeback_count,
          COUNT(*) as total_resolved
        FROM data.alerts_raw
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND post_alert_status IS NOT NULL
      `),

      // 8. Descriptor-Level Effectiveness Drop
      pool.query(`
        WITH baseline AS (
          SELECT
            merchant_descriptor,
            COUNT(*) FILTER (WHERE post_alert_status = 'effective')::float / NULLIF(COUNT(*), 0) * 100 as baseline_rate
          FROM data.alerts_raw
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND post_alert_status IS NOT NULL
            AND merchant_descriptor IS NOT NULL
          GROUP BY merchant_descriptor
          HAVING COUNT(*) >= 20
        ),
        current_rate AS (
          SELECT
            merchant_descriptor,
            COUNT(*) FILTER (WHERE post_alert_status = 'effective')::float / NULLIF(COUNT(*), 0) * 100 as current_rate,
            COUNT(*) as alert_count
          FROM data.alerts_raw
          WHERE created_at > NOW() - INTERVAL '7 days'
            AND post_alert_status IS NOT NULL
            AND merchant_descriptor IS NOT NULL
          GROUP BY merchant_descriptor
          HAVING COUNT(*) >= 10
        )
        SELECT
          c.merchant_descriptor,
          ROUND(c.current_rate::numeric, 1) as current_rate,
          ROUND(b.baseline_rate::numeric, 1) as baseline_rate,
          c.alert_count
        FROM current_rate c
        JOIN baseline b ON c.merchant_descriptor = b.merchant_descriptor
        WHERE b.baseline_rate - c.current_rate > ${THRESHOLDS.DESCRIPTOR_EFFECTIVENESS_DROP}
        ORDER BY (b.baseline_rate - c.current_rate) DESC
        LIMIT 5
      `)
    ])

    // Process Data Source Status
    type DataSourceStatusItem = {
      source: string
      lastIngested: string | null
      alertTimestamp: string | null
      minutesAgo: number | null
      status: 'healthy' | 'warning' | 'critical'
    }

    const dataSourceStatus: Record<'rdr' | 'ethoca' | 'cdrn', DataSourceStatusItem> = {
      rdr: { source: 'RDR', lastIngested: null, alertTimestamp: null, minutesAgo: null, status: 'critical' },
      ethoca: { source: 'Ethoca', lastIngested: null, alertTimestamp: null, minutesAgo: null, status: 'critical' },
      cdrn: { source: 'CDRN', lastIngested: null, alertTimestamp: null, minutesAgo: null, status: 'critical' }
    }

    for (const row of dataSourceStatusResult.rows) {
      const key = row.source.toLowerCase() as 'rdr' | 'ethoca' | 'cdrn'
      dataSourceStatus[key] = {
        source: row.source,
        lastIngested: row.last_ingested,
        alertTimestamp: row.last_alert_timestamp,
        minutesAgo: Math.round(parseFloat(row.minutes_ago)),
        status: row.status as 'healthy' | 'warning' | 'critical'
      }
    }

    // Build alerts array
    const alerts: {
      critical: any[]
      warning: any[]
      info: any[]
    } = {
      critical: [],
      warning: [],
      info: []
    }

    // Alert 1: Data Source Offline
    for (const [key, source] of Object.entries(dataSourceStatus)) {
      if (source.minutesAgo && source.minutesAgo > THRESHOLDS.DATA_SOURCE_OFFLINE * 60) {
        const hoursAgo = Math.round(source.minutesAgo / 60)
        alerts.critical.push({
          id: `data_source_offline_${key}`,
          type: 'data_source_offline',
          severity: 'critical',
          message: `No ${source.source} alerts received in ${hoursAgo} hours`,
          details: source.lastIngested
            ? `Last alert was ingested at ${new Date(source.lastIngested).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST`
            : 'No recent alerts found',
          createdAt: new Date().toISOString(),
          dismissible: false,
          actionLabel: 'Investigate',
          actionUrl: '/workflow'
        })
      }
    }

    // Alert 2: SLA Breach Countdown
    for (const row of slaBreachResult.rows) {
      const hoursRemaining = Math.round(parseFloat(row.hours_remaining) * 10) / 10
      alerts.critical.push({
        id: `sla_breach_${row.alert_type_group.toLowerCase()}`,
        type: 'sla_breach_imminent',
        severity: 'critical',
        message: `${row.count} ${row.alert_type_group} alerts breaching SLA in <${Math.ceil(hoursRemaining)}h`,
        details: `Total amount at risk: ₹${Math.round(row.total_amount).toLocaleString('en-IN')}`,
        createdAt: new Date().toISOString(),
        dismissible: false,
        actionLabel: 'View alerts',
        actionUrl: `/processing?type=${row.alert_type_group.toLowerCase()}&status=pending`,
        metadata: {
          count: parseInt(row.count),
          amount: parseFloat(row.total_amount),
          hoursRemaining
        }
      })
    }

    // Alert 3: Ethoca Acknowledgement Delay
    const ethocaAck = ethocaAckDelayResult.rows[0]
    if (ethocaAck && parseInt(ethocaAck.count) > 0) {
      const oldestHours = Math.round(parseFloat(ethocaAck.oldest_hours) * 10) / 10
      alerts.warning.push({
        id: 'ethoca_ack_delay',
        type: 'ethoca_ack_delay',
        severity: 'warning',
        message: `${ethocaAck.count} Ethoca alerts pending acknowledgement >4 hours`,
        details: `Oldest alert: ${oldestHours}h ago`,
        createdAt: new Date().toISOString(),
        dismissible: true,
        actionLabel: 'View',
        actionUrl: '/processing?type=ethoca&status=pending',
        metadata: {
          count: parseInt(ethocaAck.count),
          oldestHours
        }
      })
    }

    // Alert 4: Refund Processing Delay
    const refundDelay = refundDelayResult.rows[0]
    if (refundDelay && refundDelay.avg_refund_hours && parseFloat(refundDelay.avg_refund_hours) > THRESHOLDS.REFUND_PROCESSING_TARGET) {
      const avgHours = Math.round(parseFloat(refundDelay.avg_refund_hours) * 10) / 10
      alerts.warning.push({
        id: 'refund_processing_delay',
        type: 'refund_processing_delay',
        severity: 'warning',
        message: `Avg refund processing time at ${avgHours}h (target: ${THRESHOLDS.REFUND_PROCESSING_TARGET}h)`,
        details: `${refundDelay.pending_count} alerts currently pending >4h`,
        createdAt: new Date().toISOString(),
        dismissible: true,
        actionLabel: 'View',
        actionUrl: '/processing',
        metadata: {
          avgHours,
          pendingCount: parseInt(refundDelay.pending_count)
        }
      })
    }

    // Alert 5: Volume Anomaly
    const volumeAnomaly = volumeAnomalyResult.rows[0]
    if (volumeAnomaly) {
      const anomalyPercent = parseFloat(volumeAnomaly.anomaly_percent)
      if (Math.abs(anomalyPercent) > THRESHOLDS.VOLUME_ANOMALY_PERCENT) {
        const direction = anomalyPercent < 0 ? 'below' : 'above'
        alerts.warning.push({
          id: 'volume_anomaly',
          type: 'volume_anomaly',
          severity: 'warning',
          message: `Volume ${Math.abs(anomalyPercent)}% ${direction} expected for last hour`,
          details: `Expected: ~${Math.round(volumeAnomaly.expected_count)} alerts, Received: ${volumeAnomaly.current_count} alerts`,
          createdAt: new Date().toISOString(),
          dismissible: true,
          actionLabel: 'Acknowledge',
          metadata: {
            currentCount: parseInt(volumeAnomaly.current_count),
            expectedCount: Math.round(parseFloat(volumeAnomaly.expected_count)),
            anomalyPercent
          }
        })
      }
    }

    // Alert 6: Order Matching Degradation
    for (const row of orderMatchingResult.rows) {
      alerts.warning.push({
        id: `order_matching_${row.merchant_descriptor.replace(/\s+/g, '_').toLowerCase()}`,
        type: 'order_matching_degradation',
        severity: 'warning',
        message: `Order matching rate dropped to ${row.current_rate}% for "${row.merchant_descriptor}"`,
        details: `7-day baseline: ${row.baseline_rate}%`,
        createdAt: new Date().toISOString(),
        dismissible: true,
        actionLabel: 'Investigate',
        actionUrl: `/processing?descriptor=${encodeURIComponent(row.merchant_descriptor)}`,
        metadata: {
          descriptor: row.merchant_descriptor,
          currentRate: parseFloat(row.current_rate),
          baselineRate: parseFloat(row.baseline_rate)
        }
      })
    }

    // Alert 7: Overall Effectiveness
    const effectiveness = overallEffectivenessResult.rows[0]
    if (effectiveness && effectiveness.effectiveness_rate) {
      const rate = Math.round(parseFloat(effectiveness.effectiveness_rate) * 10) / 10
      if (rate < THRESHOLDS.EFFECTIVENESS_WARNING) {
        alerts.warning.push({
          id: 'overall_effectiveness_low',
          type: 'overall_effectiveness_low',
          severity: 'warning',
          message: `Overall effectiveness at ${rate}% (target: ${THRESHOLDS.EFFECTIVENESS_INFO}%)`,
          details: `${effectiveness.chargeback_count} alerts turned to chargeback in last 7 days`,
          createdAt: new Date().toISOString(),
          dismissible: true,
          actionLabel: 'View report',
          actionUrl: '/',
          metadata: {
            rate,
            chargebackCount: parseInt(effectiveness.chargeback_count)
          }
        })
      } else if (rate < THRESHOLDS.EFFECTIVENESS_INFO) {
        alerts.info.push({
          id: 'overall_effectiveness_low',
          type: 'overall_effectiveness_low',
          severity: 'info',
          message: `Overall effectiveness at ${rate}% (target: ${THRESHOLDS.EFFECTIVENESS_INFO}%)`,
          details: `${effectiveness.chargeback_count} alerts turned to chargeback in last 7 days`,
          createdAt: new Date().toISOString(),
          dismissible: true,
          actionLabel: 'View report',
          actionUrl: '/'
        })
      }
    }

    // Alert 8: Descriptor Effectiveness Drop
    for (const row of descriptorEffectivenessResult.rows) {
      alerts.info.push({
        id: `descriptor_effectiveness_${row.merchant_descriptor.replace(/\s+/g, '_').toLowerCase()}`,
        type: 'descriptor_effectiveness_drop',
        severity: 'info',
        message: `Effectiveness for "${row.merchant_descriptor}" dropped to ${row.current_rate}%`,
        details: `30-day baseline: ${row.baseline_rate}%`,
        createdAt: new Date().toISOString(),
        dismissible: true,
        actionLabel: 'Investigate',
        actionUrl: `/?groupBy=alertStatus`,
        metadata: {
          descriptor: row.merchant_descriptor,
          currentRate: parseFloat(row.current_rate),
          baselineRate: parseFloat(row.baseline_rate)
        }
      })
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      timezone,
      dataSourceStatus,
      alerts,
      counts: {
        critical: alerts.critical.length,
        warning: alerts.warning.length,
        info: alerts.info.length,
        total: alerts.critical.length + alerts.warning.length + alerts.info.length
      }
    })

  } catch (error) {
    console.error('Operations alerts API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch operations alerts' },
      { status: 500 }
    )
  }
}
