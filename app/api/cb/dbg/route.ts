import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const queries: Record<string, string> = {
    summary: `
      SELECT client_id, gateway_id,
             COUNT(*) AS rows,
             MIN(chargeback_date)::text AS first_cb,
             MAX(chargeback_date)::text AS last_cb,
             MAX(loaded_at)::text AS last_loaded,
             COUNT(DISTINCT blob_file_path) AS distinct_blobs,
             COUNT(DISTINCT source_file) AS distinct_sources
      FROM public.chargebacks_raw
      WHERE processor = 'kurvpay'
      GROUP BY client_id, gateway_id
      ORDER BY client_id, gateway_id
    `,
    sample_blobs: `
      SELECT client_id, gateway_id,
             COUNT(*) AS rows,
             blob_file_path
      FROM public.chargebacks_raw
      WHERE processor = 'kurvpay'
      GROUP BY client_id, gateway_id, blob_file_path
      ORDER BY client_id, gateway_id, MAX(loaded_at) DESC
    `,
    recent_loads: `
      SELECT client_id, gateway_id, blob_file_path,
             COUNT(*) AS rows_in_blob,
             MAX(loaded_at)::text AS loaded
      FROM public.chargebacks_raw
      WHERE processor = 'kurvpay'
        AND loaded_at >= NOW() - INTERVAL '30 days'
      GROUP BY client_id, gateway_id, blob_file_path
      ORDER BY MAX(loaded_at) DESC
      LIMIT 60
    `,
    by_client_gw_loadbucket: `
      SELECT client_id, gateway_id,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '24 hours') AS r24h,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '3 days')   AS r3d,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '7 days')   AS r7d,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '30 days')  AS r30d,
             COUNT(*) AS total
      FROM public.chargebacks_raw
      WHERE processor = 'kurvpay'
      GROUP BY client_id, gateway_id
      ORDER BY client_id, gateway_id
    `,
    log_kurvpay_recent: `
      SELECT (run_date + run_time)::text AS ts,
             client_id, processor, gateway_id, status, rows_exported,
             blob_file_path,
             error_message
      FROM public.scraper_run_log
      WHERE processor = 'kurvpay'
        AND run_date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY run_date DESC, run_time DESC
      LIMIT 40
    `,
    loader_activity_all_processors: `
      SELECT processor,
             COUNT(*)                                                              AS rows,
             MAX(loaded_at)::text                                                  AS last_loaded,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '24 hours')::int AS r24h,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '7 days')::int   AS r7d,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '14 days')::int  AS r14d
      FROM public.chargebacks_raw
      GROUP BY processor
      ORDER BY processor
    `,
    loader_activity_per_day: `
      SELECT (loaded_at AT TIME ZONE 'UTC')::date AS day,
             COUNT(*) AS rows,
             COUNT(DISTINCT processor) AS processors,
             COUNT(DISTINCT (client_id || '/' || gateway_id)) AS scrapers,
             array_agg(DISTINCT processor ORDER BY processor) AS procs
      FROM public.chargebacks_raw
      WHERE loaded_at >= NOW() - INTERVAL '21 days'
      GROUP BY day
      ORDER BY day DESC
    `,
    paycompass_10067_21_summary: `
      SELECT processor, client_id, gateway_id,
             COUNT(*) AS rows,
             MAX(loaded_at)::text AS last_loaded,
             MIN(chargeback_date)::text AS first_cb,
             MAX(chargeback_date)::text AS last_cb,
             COUNT(DISTINCT chargeback_id) AS distinct_cb_ids,
             COUNT(DISTINCT blob_file_path) AS distinct_blobs
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor IN ('paycompass', 'paycosmos')
      GROUP BY processor, client_id, gateway_id
      ORDER BY processor, gateway_id
    `,
    paycompass_10067_21_dup_check: `
      SELECT chargeback_id, chargeback_date::text, transaction_date::text,
             transaction_amount, status, dispute_type,
             COUNT(*) AS dup_count,
             array_agg(DISTINCT blob_file_path ORDER BY blob_file_path) AS in_blobs
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor = 'paycompass'
        AND gateway_id = '21'
      GROUP BY chargeback_id, chargeback_date, transaction_date,
               transaction_amount, status, dispute_type
      HAVING COUNT(*) > 1
      ORDER BY dup_count DESC
      LIMIT 20
    `,
    sanity_latest_batch: `
      WITH ordered AS (
        SELECT id, run_date, run_time, client_id, processor, gateway_id, status,
               ((run_date + run_time) AT TIME ZONE 'UTC') AS ts
        FROM public.scraper_run_log
        WHERE mode='daily' AND processor <> 'blob_to_db'
          AND run_date >= CURRENT_DATE - INTERVAL '5 days'
      ),
      gapped AS (SELECT *, ts - LAG(ts) OVER (ORDER BY ts) AS gap FROM ordered),
      batched AS (SELECT *, SUM(CASE WHEN gap IS NULL OR gap > INTERVAL '2 hours' THEN 1 ELSE 0 END) OVER (ORDER BY ts) AS batch_id FROM gapped),
      latest_batch AS (
        SELECT batch_id FROM batched
        GROUP BY batch_id
        ORDER BY MAX(ts) DESC LIMIT 1
      ),
      latest_per_scraper AS (
        SELECT DISTINCT ON (client_id, processor, gateway_id)
          client_id, processor, gateway_id, status
        FROM batched
        WHERE batch_id = (SELECT batch_id FROM latest_batch)
        ORDER BY client_id, processor, gateway_id, ts DESC
      )
      SELECT status, COUNT(*)::int AS cnt
      FROM latest_per_scraper
      GROUP BY status
      ORDER BY status
    `,
    sanity_batch_meta: `
      WITH ordered AS (
        SELECT id, run_date, run_time, client_id, processor, gateway_id, status,
               ((run_date + run_time) AT TIME ZONE 'UTC') AS ts
        FROM public.scraper_run_log
        WHERE mode='daily' AND processor <> 'blob_to_db'
          AND run_date >= CURRENT_DATE - INTERVAL '5 days'
      ),
      gapped AS (SELECT *, ts - LAG(ts) OVER (ORDER BY ts) AS gap FROM ordered),
      batched AS (SELECT *, SUM(CASE WHEN gap IS NULL OR gap > INTERVAL '2 hours' THEN 1 ELSE 0 END) OVER (ORDER BY ts) AS batch_id FROM gapped),
      latest_batch AS (SELECT batch_id FROM batched GROUP BY batch_id ORDER BY MAX(ts) DESC LIMIT 1)
      SELECT MIN(ts)::text AS started, MAX(ts)::text AS ended,
             COUNT(*)::int AS rows_in_batch,
             COUNT(DISTINCT (client_id, processor, gateway_id))::int AS distinct_invocations
      FROM batched
      WHERE batch_id = (SELECT batch_id FROM latest_batch)
    `,
    enabled_gateways: `
      SELECT
        COUNT(*)::int AS enabled_total,
        COUNT(DISTINCT (client_id, lender_name, portal_username))::int AS distinct_login_groups,
        COUNT(*) FILTER (WHERE lender_name IN ('FlexFactor'))::int AS unmapped_lenders
      FROM beast_insights_v2.mid_manager
      WHERE cb_reporting_enabled = TRUE
    `,
    missionvalley_full_err: `
      SELECT (run_date + run_time)::text AS ts, error_message
      FROM public.scraper_run_log
      WHERE processor = 'missionvalley'
        AND status = 'failed'
        AND run_date >= CURRENT_DATE - INTERVAL '1 day'
      ORDER BY run_date DESC, run_time DESC
      LIMIT 3
    `,
    paycompass_after_deploy: `
      WITH bl AS (
        SELECT (run_date + run_time)::text AS ts, status, rows_exported
        FROM public.scraper_run_log
        WHERE processor = 'paycompass'
          AND run_date >= CURRENT_DATE - INTERVAL '1 day'
        ORDER BY run_date DESC, run_time DESC
        LIMIT 4
      )
      SELECT * FROM bl
    `,
    latest_runs: `
      SELECT (run_date + run_time)::text AS ts,
             client_id, processor, gateway_id, status, rows_exported,
             SUBSTRING(COALESCE(error_message, ''), 1, 120) AS err
      FROM public.scraper_run_log
      WHERE mode = 'daily'
        AND processor <> 'blob_to_db'
        AND run_date >= CURRENT_DATE - INTERVAL '1 day'
      ORDER BY run_date DESC, run_time DESC
      LIMIT 60
    `,
    fix_verification: `
      SELECT
        'paycompass-10067-21'                                     AS scraper,
        COUNT(*)::int                                              AS rows_in_db,
        MAX(loaded_at)::text                                       AS latest_load,
        COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '12 hours')::int AS rows_loaded_12h,
        MAX(chargeback_date)::text                                 AS latest_cb
      FROM public.chargebacks_raw
      WHERE client_id::text='10067' AND processor='paycompass' AND gateway_id='21'
      UNION ALL
      SELECT 'kurvpay-10067-19',
             COUNT(*)::int, MAX(loaded_at)::text,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '12 hours')::int,
             MAX(chargeback_date)::text
      FROM public.chargebacks_raw
      WHERE client_id::text='10067' AND processor='kurvpay' AND gateway_id='19'
      UNION ALL
      SELECT 'kurvpay-20019-093034',
             COUNT(*)::int, MAX(loaded_at)::text,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '12 hours')::int,
             MAX(chargeback_date)::text
      FROM public.chargebacks_raw
      WHERE client_id::text='20019' AND processor='kurvpay' AND gateway_id='565500001093034'
      UNION ALL
      SELECT 'paycosmos-10057-14',
             COUNT(*)::int, MAX(loaded_at)::text,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '12 hours')::int,
             MAX(chargeback_date)::text
      FROM public.chargebacks_raw
      WHERE client_id::text='10057' AND processor='paycosmos' AND gateway_id='14'
      UNION ALL
      SELECT 'kurvpay-10057-29',
             COUNT(*)::int, MAX(loaded_at)::text,
             COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '12 hours')::int,
             MAX(chargeback_date)::text
      FROM public.chargebacks_raw
      WHERE client_id::text='10057' AND processor='kurvpay' AND gateway_id='29'
    `,
    phoenixpay_summary: `
      SELECT client_id, gateway_id,
             COUNT(*) AS rows,
             COUNT(DISTINCT chargeback_id) AS distinct_cb_ids,
             MIN(chargeback_date)::text AS first_cb,
             MAX(chargeback_date)::text AS last_cb,
             MAX(loaded_at)::text AS last_loaded,
             COUNT(*) FILTER (WHERE chargeback_date >= CURRENT_DATE - INTERVAL '30 days') AS rows_last_30d,
             COUNT(*) FILTER (WHERE chargeback_date >= CURRENT_DATE - INTERVAL '180 days') AS rows_last_180d
      FROM public.chargebacks_raw
      WHERE processor = 'phoenixpay'
      GROUP BY client_id, gateway_id
      ORDER BY client_id, gateway_id
    `,
    phoenixpay_status_breakdown: `
      WITH latest_per_cb AS (
        SELECT DISTINCT ON (client_id, gateway_id, chargeback_id)
               client_id, gateway_id, chargeback_id, status, dispute_type
        FROM public.chargebacks_raw
        WHERE processor = 'phoenixpay'
        ORDER BY client_id, gateway_id, chargeback_id, loaded_at DESC
      )
      SELECT client_id, gateway_id, COUNT(*) AS distinct_cbs,
             COUNT(DISTINCT status) AS distinct_statuses
      FROM latest_per_cb
      GROUP BY client_id, gateway_id
    `,
    paycompass_21_distribution: `
      SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT chargeback_id) AS distinct_cb_ids,
        COUNT(*) FILTER (WHERE chargeback_date >= '2026-04-07') AS rows_last_30d,
        COUNT(DISTINCT chargeback_id) FILTER (WHERE chargeback_date >= '2026-04-07') AS distinct_cb_last_30d,
        COUNT(*) FILTER (WHERE chargeback_date >= '2026-04-15') AS rows_last_22d,
        COUNT(DISTINCT chargeback_id) FILTER (WHERE chargeback_date >= '2026-04-15') AS distinct_cb_last_22d,
        MIN(chargeback_date)::text AS earliest_cb,
        MAX(chargeback_date)::text AS latest_cb
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor = 'paycompass'
        AND gateway_id = '21'
    `,
    paycompass_21_status_breakdown: `
      WITH latest_per_cb AS (
        SELECT DISTINCT ON (chargeback_id)
               chargeback_id, chargeback_date, status, dispute_type
        FROM public.chargebacks_raw
        WHERE client_id::text = '10067'
          AND processor = 'paycompass'
          AND gateway_id = '21'
        ORDER BY chargeback_id, loaded_at DESC
      )
      SELECT status, dispute_type, COUNT(*) AS cnt
      FROM latest_per_cb
      GROUP BY status, dispute_type
      ORDER BY cnt DESC
    `,
    paycompass_21_today_blob_ids: `
      SELECT chargeback_id, chargeback_date::text, status, dispute_type, transaction_amount
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor = 'paycompass'
        AND gateway_id = '21'
        AND blob_file_path LIKE '%daily_20260507%'
      ORDER BY chargeback_date DESC, chargeback_id
    `,
    paycompass_21_today_blob: `
      WITH latest_blob AS (
        SELECT MAX(blob_file_path) AS path
        FROM public.chargebacks_raw
        WHERE client_id::text = '10067'
          AND processor = 'paycompass'
          AND gateway_id = '21'
          AND blob_file_path LIKE '%daily_20260507%'
      )
      SELECT
        (SELECT path FROM latest_blob) AS blob_path,
        COUNT(*) AS rows_from_today_blob,
        COUNT(DISTINCT chargeback_id) AS distinct_cbs_today,
        MIN(chargeback_date)::text AS earliest_cb_in_today,
        MAX(chargeback_date)::text AS latest_cb_in_today
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor = 'paycompass'
        AND gateway_id = '21'
        AND blob_file_path = (SELECT path FROM latest_blob)
    `,
    paycompass_21_by_month: `
      SELECT
        TO_CHAR(chargeback_date, 'YYYY-MM') AS month,
        COUNT(*) AS rows,
        COUNT(DISTINCT chargeback_id) AS distinct_cbs,
        MIN(chargeback_date)::text AS month_first,
        MAX(chargeback_date)::text AS month_last
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor = 'paycompass'
        AND gateway_id = '21'
      GROUP BY TO_CHAR(chargeback_date, 'YYYY-MM')
      ORDER BY month
    `,
    paycompass_21_dup_full: `
      SELECT chargeback_id, COUNT(*) AS cnt,
             array_agg(DISTINCT status) AS statuses,
             array_agg(DISTINCT dispute_type) AS dispute_types,
             array_agg(DISTINCT transaction_amount::text) AS amounts,
             array_agg(DISTINCT transaction_date::text) AS trx_dates,
             array_agg(DISTINCT chargeback_date::text) AS cb_dates
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor = 'paycompass'
        AND gateway_id = '21'
      GROUP BY chargeback_id
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
    `,
    paycompass_10067_21_dup_by_cb_id: `
      WITH dup_ids AS (
        SELECT chargeback_id
        FROM public.chargebacks_raw
        WHERE client_id::text = '10067'
          AND processor = 'paycompass'
          AND gateway_id = '21'
        GROUP BY chargeback_id
        HAVING COUNT(*) > 1
      )
      SELECT cr.chargeback_id, cr.chargeback_date::text, cr.transaction_date::text,
             cr.transaction_amount,
             cr.status, cr.dispute_type,
             cr.loaded_at::text,
             cr.blob_file_path
      FROM public.chargebacks_raw cr
      JOIN dup_ids USING (chargeback_id)
      WHERE cr.client_id::text = '10067'
        AND cr.processor = 'paycompass'
        AND cr.gateway_id = '21'
      ORDER BY cr.chargeback_id, cr.loaded_at
      LIMIT 50
    `,
    paycompass_10067_21_recent: `
      SELECT chargeback_id, chargeback_date::text, transaction_date::text,
             transaction_amount, loaded_at::text, blob_file_path
      FROM public.chargebacks_raw
      WHERE client_id::text = '10067'
        AND processor = 'paycompass'
        AND gateway_id = '21'
      ORDER BY chargeback_date DESC, loaded_at DESC
      LIMIT 10
    `,
    micamp_history: `
      SELECT (run_date + run_time)::text AS ts,
             gateway_id, status, rows_exported, error_message
      FROM public.scraper_run_log
      WHERE processor = 'micamp'
        AND run_date >= CURRENT_DATE - INTERVAL '21 days'
      ORDER BY run_date DESC, run_time DESC
    `,
    blob_to_db_runs: `
      SELECT (run_date + run_time)::text AS ts,
             status, rows_exported, duration_seconds, error_message
      FROM public.scraper_run_log
      WHERE processor = 'blob_to_db'
        AND run_date >= CURRENT_DATE - INTERVAL '21 days'
      ORDER BY run_date DESC, run_time DESC
    `,
    daily_pipeline_summary: `
      WITH bl AS (
        SELECT (run_date + run_time)::date AS day,
               COUNT(*) AS bl_runs,
               COUNT(*) FILTER (WHERE status = 'success') AS bl_success
        FROM public.scraper_run_log
        WHERE processor = 'blob_to_db'
          AND run_date >= CURRENT_DATE - INTERVAL '21 days'
        GROUP BY day
      ),
      cb AS (
        SELECT (loaded_at AT TIME ZONE 'UTC')::date AS day,
               COUNT(*) FILTER (WHERE client_id = '10067' AND gateway_id = '19') AS r_10067_19,
               COUNT(*) FILTER (WHERE client_id = '10057' AND gateway_id = '29') AS r_10057_29,
               COUNT(*) FILTER (WHERE client_id = '10057' AND gateway_id = '31') AS r_10057_31,
               COUNT(*) AS r_kurvpay_all,
               array_agg(DISTINCT (client_id || '/' || gateway_id) ORDER BY (client_id || '/' || gateway_id)) AS scrapers_loaded
        FROM public.chargebacks_raw
        WHERE processor = 'kurvpay'
          AND loaded_at >= NOW() - INTERVAL '21 days'
        GROUP BY day
      )
      SELECT
        COALESCE(bl.day, cb.day)::text AS day,
        COALESCE(bl.bl_runs, 0) AS blob_runs,
        COALESCE(bl.bl_success, 0) AS blob_success,
        COALESCE(cb.r_10067_19, 0) AS r_10067_19,
        COALESCE(cb.r_10057_29, 0) AS r_10057_29,
        COALESCE(cb.r_10057_31, 0) AS r_10057_31,
        COALESCE(cb.r_kurvpay_all, 0) AS r_kurvpay_all,
        cb.scrapers_loaded
      FROM bl FULL OUTER JOIN cb USING (day)
      ORDER BY day DESC
    `,
  };

  const out: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(queries)) {
    try {
      const r = await pool.query(q);
      out[k] = r.rows;
    } catch (e) {
      out[k] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json(out);
}
