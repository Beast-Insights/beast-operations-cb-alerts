import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// Map groupBy parameter to database column
const groupByColumnMap: Record<string, string> = {
  'bin': 'card_bin',
  'gateway': 'gateway_name',
  'acquirer': 'alert_processor',
  'bank': 'issuer',
  'pricePoint': 'transaction_amount',
  'alertStatus': 'post_alert_status',
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    let startDate = searchParams.get('startDate')
    let endDate = searchParams.get('endDate')
    const alertType = searchParams.get('alertType')

    // Default to last 7 days if no dates provided (consistent with workflow API)
    if (!startDate || !endDate) {
      const today = new Date()
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(today.getDate() - 7)

      // Use local date formatting to avoid timezone shift issues
      const formatDate = (d: Date) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }

      endDate = formatDate(today)
      startDate = formatDate(sevenDaysAgo)
    }
    const outcomeStatus = searchParams.get('outcomeStatus')
    const groupBy = searchParams.get('groupBy')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')
    // dateColumn: 'created_at' (default) or 'alert_timestamp'
    const dateColumnParam = searchParams.get('dateColumn')
    const useAlertTimestamp = dateColumnParam === 'alert_timestamp'

    // timezone: 'IST' (default) or 'EST'
    const timezone = searchParams.get('timezone') || 'IST'

    // Timezone conversion reference:
    // - alert_timestamp is stored in EST
    // - created_at is stored in UTC
    //
    // For IST: EST + 10h30m = IST, UTC + 5h30m = IST
    // For EST: EST = EST (no change), UTC - 5h = EST
    let dateExpression: string
    if (useAlertTimestamp) {
      // alert_timestamp is in EST
      dateExpression = timezone === 'IST'
        ? `(alert_timestamp + INTERVAL '10 hours 30 minutes')::date`
        : `alert_timestamp::date`
    } else {
      // created_at is in UTC
      dateExpression = timezone === 'IST'
        ? `(created_at + INTERVAL '5 hours 30 minutes')::date`
        : `(created_at - INTERVAL '5 hours')::date`
    }

    // Base where condition
    let whereConditions = [`alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')`]
    const params: (string | number)[] = []
    let paramIndex = 1

    if (startDate) {
      whereConditions.push(`${dateExpression} >= $${paramIndex}`)
      params.push(startDate)
      paramIndex++
    }

    if (endDate) {
      whereConditions.push(`${dateExpression} <= $${paramIndex}`)
      params.push(endDate)
      paramIndex++
    }

    if (alertType && alertType !== 'all') {
      if (alertType === 'ethoca') {
        whereConditions.push(`alert_type IN ('issuer_alert', 'customerdispute_alert')`)
      } else if (alertType === 'cdrn') {
        whereConditions.push(`alert_type = 'CDRN'`)
      } else if (alertType === 'rdr') {
        whereConditions.push(`alert_type = 'RDR'`)
      }
    }

    if (outcomeStatus && outcomeStatus !== 'all') {
      if (outcomeStatus === 'effective') {
        whereConditions.push(`post_alert_status = 'effective'`)
      } else if (outcomeStatus === 'chargeback') {
        whereConditions.push(`post_alert_status = 'alert_got_chargeback'`)
      } else if (outcomeStatus === 'invalid_order') {
        whereConditions.push(`post_alert_status = 'invalid_order'`)
      } else if (outcomeStatus === 'unable_to_refund') {
        whereConditions.push(`post_alert_status = 'unable_to_refund'`)
      } else if (outcomeStatus === 'already_refunded') {
        whereConditions.push(`post_alert_status = 'alert_already_refunded'`)
      } else if (outcomeStatus === 'pending') {
        whereConditions.push(`(post_alert_status IS NULL OR post_alert_status = '')`)
      }
    }

    const whereClause = whereConditions.join(' AND ')

    // If groupBy parameter is provided, return aggregated dashboard data
    if (groupBy) {
      return await handleDashboardRequest(whereClause, params, groupBy, startDate, endDate, timezone)
    }

    // Otherwise, return paginated alerts list
    const alertsResult = await pool.query(`
      SELECT
        id, alert_id, alert_type, alert_category, alert_timestamp, created_at, alert_age_hours,
        merchant_descriptor, transaction_amount, transaction_currency, card_bin, card_last_four,
        card_number_masked, card_type, order_id, order_id_source, is_order_id_valid,
        is_already_refunded, is_refund_init, refund_timestamp_init, is_refund_crm, refund_timestamp_crm,
        is_acknowledged, acknowledgement_status, acknowledgement_timestamp, acknowledgement_refund_status,
        is_closed, is_blacklisted, is_fraud, post_alert_status, status, transaction_id,
        transaction_timestamp, transaction_type, arn, auth_code, merchant_member_name, member_id,
        mcc, gateway_name, crm, platform, source, issuer, is_3d_secure, case_type, case_amount,
        reason_code, reason_code_description, alert_provider, alert_processor, alert_cost, alert_price, data_source
      FROM data.alerts_raw
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset])

    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM data.alerts_raw WHERE ${whereClause}
    `, params)

    const alerts = alertsResult.rows.map(row => ({
      id: row.id,
      alertId: row.alert_id,
      alertType: row.alert_type,
      alertCategory: row.alert_category,
      alertTimestamp: row.alert_timestamp,
      createdAt: row.created_at,
      alertAgeHours: row.alert_age_hours,
      merchantDescriptor: row.merchant_descriptor,
      merchantMemberName: row.merchant_member_name,
      memberId: row.member_id,
      mcc: row.mcc,
      gatewayName: row.gateway_name,
      transactionAmount: parseFloat(row.transaction_amount) || 0,
      transactionCurrency: row.transaction_currency,
      transactionId: row.transaction_id,
      transactionTimestamp: row.transaction_timestamp,
      transactionType: row.transaction_type,
      arn: row.arn,
      authCode: row.auth_code,
      cardBin: row.card_bin,
      cardLastFour: row.card_last_four,
      cardNumberMasked: row.card_number_masked,
      cardType: row.card_type,
      orderId: row.order_id,
      orderIdSource: row.order_id_source,
      isOrderIdValid: row.is_order_id_valid,
      crm: row.crm,
      isAlreadyRefunded: row.is_already_refunded,
      isRefundInit: row.is_refund_init,
      refundTimestampInit: row.refund_timestamp_init,
      isRefundCrm: row.is_refund_crm,
      refundTimestampCrm: row.refund_timestamp_crm,
      isAcknowledged: row.is_acknowledged,
      acknowledgementStatus: row.acknowledgement_status,
      acknowledgementTimestamp: row.acknowledgement_timestamp,
      acknowledgementRefundStatus: row.acknowledgement_refund_status,
      isClosed: row.is_closed,
      isBlacklisted: row.is_blacklisted,
      isFraud: row.is_fraud,
      postAlertStatus: row.post_alert_status,
      status: row.status,
      platform: row.platform,
      source: row.source,
      issuer: row.issuer,
      is3dSecure: row.is_3d_secure,
      caseType: row.case_type,
      caseAmount: parseFloat(row.case_amount) || null,
      reasonCode: row.reason_code,
      reasonCodeDescription: row.reason_code_description,
      alertProvider: row.alert_provider,
      alertProcessor: row.alert_processor,
      alertCost: parseFloat(row.alert_cost) || 0,
      alertPrice: parseFloat(row.alert_price) || 0,
      dataSource: row.data_source
    }))

    return NextResponse.json({
      alerts,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
        hasMore: offset + alerts.length < parseInt(countResult.rows[0].total)
      }
    })

  } catch (error) {
    console.error('Error fetching alerts:', error)
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
  }
}

// Helper to format date as YYYY-MM-DD using local timezone
const formatDateLocalHelper = (d: Date) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Handle dashboard aggregation requests
async function handleDashboardRequest(
  baseWhereClause: string,
  baseParams: (string | number)[],
  groupBy: string,
  startDate: string | null,
  endDate: string | null,
  timezone: string = 'IST'
) {
  try {
    // Get date range (default to last 7 days if not provided)
    const today = new Date()
    const defaultStart = new Date(today)
    defaultStart.setDate(today.getDate() - 7)

    const effectiveStartDate = startDate || formatDateLocalHelper(defaultStart)
    const effectiveEndDate = endDate || formatDateLocalHelper(today)

    // 1. Alerts by Type
    const alertsByTypeResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert')) as ethoca,
        COUNT(*) FILTER (WHERE alert_type = 'CDRN') as cdrn,
        COUNT(*) FILTER (WHERE alert_type = 'RDR') as rdr,
        COUNT(*) as total
      FROM data.alerts_raw
      WHERE ${baseWhereClause}
    `, baseParams)

    const alertsByType = {
      ethoca: parseInt(alertsByTypeResult.rows[0]?.ethoca || '0'),
      cdrn: parseInt(alertsByTypeResult.rows[0]?.cdrn || '0'),
      rdr: parseInt(alertsByTypeResult.rows[0]?.rdr || '0'),
      total: parseInt(alertsByTypeResult.rows[0]?.total || '0')
    }

    // 2. Alerts by Outcome
    const alertsByOutcomeResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE post_alert_status = 'effective') as effective,
        COUNT(*) FILTER (WHERE post_alert_status = 'invalid_order') as invalid_order,
        COUNT(*) FILTER (WHERE post_alert_status = 'alert_already_refunded') as already_refunded,
        COUNT(*) FILTER (WHERE post_alert_status = 'unable_to_refund') as not_refunded,
        COUNT(*) FILTER (WHERE post_alert_status = 'alert_got_chargeback') as turned_into_cb,
        COUNT(*) as total
      FROM data.alerts_raw
      WHERE ${baseWhereClause}
    `, baseParams)

    const alertsByOutcome = {
      effective: parseInt(alertsByOutcomeResult.rows[0]?.effective || '0'),
      invalidOrder: parseInt(alertsByOutcomeResult.rows[0]?.invalid_order || '0'),
      alreadyRefunded: parseInt(alertsByOutcomeResult.rows[0]?.already_refunded || '0'),
      notRefunded: parseInt(alertsByOutcomeResult.rows[0]?.not_refunded || '0'),
      turnedIntoCB: parseInt(alertsByOutcomeResult.rows[0]?.turned_into_cb || '0'),
      total: parseInt(alertsByOutcomeResult.rows[0]?.total || '0')
    }

    // 3. Today vs Yesterday trend data (hourly)
    // created_at is stored in UTC
    // For IST: UTC + 5h30m, For EST: UTC - 5h
    const tzInterval = timezone === 'IST' ? `+ INTERVAL '5 hours 30 minutes'` : `- INTERVAL '5 hours'`
    const trendResult = await pool.query(`
      WITH hours AS (
        SELECT generate_series(0, 23) as hour
      ),
      today_data AS (
        SELECT
          EXTRACT(HOUR FROM created_at ${tzInterval}) as hour,
          COUNT(*) as count
        FROM data.alerts_raw
        WHERE ${baseWhereClause}
          AND (created_at ${tzInterval})::date = (NOW() ${tzInterval})::date
        GROUP BY EXTRACT(HOUR FROM created_at ${tzInterval})
      ),
      yesterday_data AS (
        SELECT
          EXTRACT(HOUR FROM created_at ${tzInterval}) as hour,
          COUNT(*) as count
        FROM data.alerts_raw
        WHERE ${baseWhereClause}
          AND (created_at ${tzInterval})::date = (NOW() ${tzInterval})::date - INTERVAL '1 day'
        GROUP BY EXTRACT(HOUR FROM created_at ${tzInterval})
      )
      SELECT
        h.hour,
        COALESCE(t.count, 0) as today,
        COALESCE(y.count, 0) as yesterday
      FROM hours h
      LEFT JOIN today_data t ON h.hour = t.hour
      LEFT JOIN yesterday_data y ON h.hour = y.hour
      ORDER BY h.hour
    `, baseParams)

    const trendData = trendResult.rows.map(row => {
      const hour = parseInt(row.hour)
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      const ampm = hour < 12 ? 'AM' : 'PM'
      return {
        time: `${hour12}:00 ${ampm}`,
        Today: parseInt(row.today),
        Yesterday: parseInt(row.yesterday)
      }
    })

    // 4. Today and Yesterday totals
    // created_at is stored in UTC, convert based on timezone
    const todayTotalResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM data.alerts_raw
      WHERE ${baseWhereClause}
        AND (created_at ${tzInterval})::date = (NOW() ${tzInterval})::date
    `, baseParams)

    const yesterdayTotalResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM data.alerts_raw
      WHERE ${baseWhereClause}
        AND (created_at ${tzInterval})::date = (NOW() ${tzInterval})::date - INTERVAL '1 day'
    `, baseParams)

    const todayTotal = parseInt(todayTotalResult.rows[0]?.total || '0')
    const yesterdayTotal = parseInt(yesterdayTotalResult.rows[0]?.total || '0')

    // 5. Alert Analysis Data (grouped by dimension)
    const groupByColumn = groupByColumnMap[groupBy] || 'card_bin'

    const analysisResult = await pool.query(`
      SELECT
        COALESCE(${groupByColumn}::text, 'Unknown') as dimension,
        COUNT(*) as alerts,
        COALESCE(SUM(transaction_amount), 0) as amount,
        COUNT(*) FILTER (WHERE alert_type = 'RDR') as rdr,
        COUNT(*) FILTER (WHERE alert_type = 'RDR' AND post_alert_status = 'effective') as rdr_effective,
        COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert')) as ethoca,
        COUNT(*) FILTER (WHERE alert_type IN ('issuer_alert', 'customerdispute_alert') AND post_alert_status = 'effective') as ethoca_effective,
        COUNT(*) FILTER (WHERE alert_type = 'CDRN') as cdrn,
        COUNT(*) FILTER (WHERE alert_type = 'CDRN' AND post_alert_status = 'effective') as cdrn_effective,
        COUNT(*) FILTER (WHERE post_alert_status = 'alert_got_chargeback') as cb,
        COUNT(*) FILTER (WHERE is_refund_crm = true) as refund
      FROM data.alerts_raw
      WHERE ${baseWhereClause}
      GROUP BY ${groupByColumn}
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `, baseParams)

    const alertAnalysisData = analysisResult.rows.map(row => ({
      dimension: row.dimension,
      alerts: parseInt(row.alerts),
      amount: parseFloat(row.amount) || 0,
      rdr: parseInt(row.rdr),
      rdrEffective: parseInt(row.rdr_effective),
      ethoca: parseInt(row.ethoca),
      ethocaEffective: parseInt(row.ethoca_effective),
      cdrn: parseInt(row.cdrn),
      cdrnEffective: parseInt(row.cdrn_effective),
      cb: parseInt(row.cb),
      refund: parseInt(row.refund)
    }))

    // 6. Filter options (for dimension filtering)
    const filterOptionsResult = await pool.query(`
      SELECT
        ${groupByColumn}::text as value,
        COUNT(*) as count
      FROM data.alerts_raw
      WHERE ${baseWhereClause}
        AND ${groupByColumn} IS NOT NULL
      GROUP BY ${groupByColumn}
      ORDER BY COUNT(*) DESC
    `, baseParams)

    const filterOptions: Record<string, { hasData: boolean; count: number }> = {}
    filterOptionsResult.rows.forEach(row => {
      if (row.value) {
        filterOptions[row.value] = {
          hasData: true,
          count: parseInt(row.count)
        }
      }
    })

    return NextResponse.json({
      dateRange: {
        start: effectiveStartDate,
        end: effectiveEndDate
      },
      timezone,
      alertsByType,
      alertsByOutcome,
      trendData,
      todayTotal,
      yesterdayTotal,
      alertAnalysisData,
      groupBy,
      filterOptions
    })

  } catch (error) {
    console.error('Error in dashboard aggregation:', error)
    throw error
  }
}
