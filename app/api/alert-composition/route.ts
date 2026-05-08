import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function GET() {
  try {
    // alert_timestamp is in EST per column comments
    // Group by EST date (no conversion needed since alert_timestamp is already EST)
    const result = await pool.query(`
      SELECT
        to_char((alert_timestamp)::date, 'YYYY-MM-DD') as alert_date,
        COALESCE(SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') THEN 1 ELSE 0 END), 0) as ethoca,
        COALESCE(SUM(CASE WHEN alert_type = 'CDRN' THEN 1 ELSE 0 END), 0) as cdrn,
        COALESCE(SUM(CASE WHEN alert_type = 'RDR' THEN 1 ELSE 0 END), 0) as rdr,
        COALESCE(SUM(CASE WHEN alert_type IN ('issuer_alert', 'customerdispute_alert') AND post_alert_status = 'effective' THEN 1 ELSE 0 END), 0) as ethoca_effective,
        COALESCE(SUM(CASE WHEN alert_type = 'CDRN' AND post_alert_status = 'effective' THEN 1 ELSE 0 END), 0) as cdrn_effective,
        COALESCE(SUM(CASE WHEN alert_type = 'RDR' AND post_alert_status = 'effective' THEN 1 ELSE 0 END), 0) as rdr_effective
      FROM data.alerts_raw
      WHERE alert_timestamp IS NOT NULL
        AND alert_type IN ('issuer_alert', 'customerdispute_alert', 'CDRN', 'RDR')
      GROUP BY (alert_timestamp)::date
      ORDER BY alert_date
    `)

    const data = result.rows.map(row => ({
      date: row.alert_date,
      ethoca: parseInt(row.ethoca) || 0,
      cdrn: parseInt(row.cdrn) || 0,
      rdr: parseInt(row.rdr) || 0,
      ethocaEffective: parseInt(row.ethoca_effective) || 0,
      cdrnEffective: parseInt(row.cdrn_effective) || 0,
      rdrEffective: parseInt(row.rdr_effective) || 0,
    }))

    return NextResponse.json(data)
  } catch (error) {
    console.error('Alert composition error:', error)
    return NextResponse.json({ error: 'Failed to fetch alert composition data' }, { status: 500 })
  }
}
