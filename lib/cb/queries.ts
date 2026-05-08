/**
 * SQL queries for the Chargeback Reporting dashboard.
 *
 * Schema (confirmed from cb-reporting/scripts/log_run.py and update_mid_cred_status.py):
 *
 *   public.scraper_run_log:
 *     id, run_date (DATE), run_time (TIME),
 *     client_id, processor, gateway_id, mode,
 *     status ('success' | 'failed' | 'no_data'),
 *     rows_exported (int), blob_file_path (text),
 *     duration_seconds (float), error_message (text)
 *
 *   beast_insights_v2.mid_manager:
 *     id, client_id, gateway_id, mid, lender_name,
 *     portal_url, portal_username,
 *     cb_reporting_enabled (bool), status (text),
 *     credentials_status ('Valid' | 'Invalid' | 'Unchecked'),
 *     credentials_message, credentials_checked_at (TIMESTAMPTZ),
 *     updated_at, updated_by
 *
 * Conventions:
 *   - All scraper_run_log queries filter mode='daily' AND processor<>'blob_to_db'
 *   - run_date + run_time is treated as UTC (postgres CURRENT_DATE/CURRENT_TIME at insert time)
 *     → '(run_date + run_time) AT TIME ZONE ''UTC''' returns TIMESTAMPTZ for proper IST conversion
 *   - "Latest batch" uses gap-based detection: rows separated by >2 hours start a new batch
 *   - "Latest per scraper in batch" uses DISTINCT ON to collapse retries within a batch
 *   - All timestamps returned to the frontend are TIMESTAMPTZ; frontend formats to IST
 */

/**
 * The 35-day batched scraper_run_log CTE is reused everywhere.
 * Buffer beyond 30 days so batch boundary detection at the edge is correct.
 */
const BATCHED_CTE = `
  WITH ordered AS (
    SELECT
      id, run_date, run_time, client_id, processor, gateway_id,
      status, error_message, rows_exported, duration_seconds,
      ((run_date + run_time) AT TIME ZONE 'UTC') AS ts
    FROM public.scraper_run_log
    WHERE mode = 'daily'
      AND processor <> 'blob_to_db'
      AND run_date >= CURRENT_DATE - INTERVAL '35 days'
  ),
  gapped AS (
    SELECT *, ts - LAG(ts) OVER (ORDER BY ts) AS gap FROM ordered
  ),
  batched AS (
    SELECT *,
      SUM(CASE WHEN gap IS NULL OR gap > INTERVAL '2 hours' THEN 1 ELSE 0 END)
        OVER (ORDER BY ts) AS batch_id
    FROM gapped
  ),
  batch_stats AS (
    SELECT
      batch_id,
      MIN(ts) AS started,
      MAX(ts) AS ended
    FROM batched
    GROUP BY batch_id
  ),
  latest_per_scraper_in_batch AS (
    SELECT DISTINCT ON (batch_id, client_id, processor, gateway_id)
      batch_id, client_id, processor, gateway_id, status, error_message,
      rows_exported, duration_seconds, ts
    FROM batched
    ORDER BY batch_id, client_id, processor, gateway_id, ts DESC
  )
`;

// =============================================================================
// KPI 1 — Active clients
// =============================================================================
export const Q_ACTIVE_CLIENTS = `
  SELECT
    COUNT(DISTINCT client_id::text) AS clients,
    array_agg(DISTINCT client_id::text ORDER BY client_id::text) AS client_ids
  FROM beast_insights_v2.mid_manager
  WHERE cb_reporting_enabled = TRUE
`;

// =============================================================================
// KPI 2 — Active scrapers (enabled / total / unmapped)
// "unmapped" = enabled in mid_manager but no scraper_run_log row in last 30 days
// =============================================================================
export const Q_SCRAPER_COUNTS = `
  WITH enabled AS (
    SELECT id, client_id, gateway_id, mid
    FROM beast_insights_v2.mid_manager
    WHERE cb_reporting_enabled = TRUE
  ),
  total AS (
    SELECT COUNT(*) AS total FROM beast_insights_v2.mid_manager
  ),
  recent_log AS (
    SELECT DISTINCT client_id, gateway_id
    FROM public.scraper_run_log
    WHERE mode = 'daily' AND processor <> 'blob_to_db'
      AND run_date >= CURRENT_DATE - INTERVAL '30 days'
  ),
  unmapped AS (
    SELECT e.id
    FROM enabled e
    WHERE NOT EXISTS (
      SELECT 1 FROM recent_log r
      WHERE r.client_id::text = e.client_id::text
        AND (
          (e.gateway_id IS NOT NULL AND r.gateway_id = e.gateway_id::text)
          OR
          (e.gateway_id IS NULL AND r.gateway_id = e.mid)
        )
    )
  )
  SELECT
    (SELECT COUNT(*) FROM enabled)::int   AS enabled,
    (SELECT total FROM total)::int        AS total,
    (SELECT COUNT(*) FROM unmapped)::int  AS unmapped
`;

// =============================================================================
// KPI 3 — Last run summary (started/ended/outcomes/rows)
// =============================================================================
export const Q_LAST_RUN = `
  ${BATCHED_CTE},
  latest_batch AS (
    SELECT batch_id FROM batch_stats ORDER BY ended DESC LIMIT 1
  )
  SELECT
    (SELECT started FROM batch_stats WHERE batch_id = (SELECT batch_id FROM latest_batch)) AS started_utc,
    (SELECT ended   FROM batch_stats WHERE batch_id = (SELECT batch_id FROM latest_batch)) AS ended_utc,
    COUNT(*)::int                                                   AS distinct_scrapers,
    COUNT(*) FILTER (WHERE status = 'success')::int                 AS success,
    COUNT(*) FILTER (WHERE status = 'no_data')::int                 AS no_data,
    COUNT(*) FILTER (WHERE status = 'failed')::int                  AS failed,
    COALESCE(SUM(rows_exported), 0)::bigint                         AS rows_total,
    COALESCE(AVG(duration_seconds), 0)::float                       AS avg_duration_seconds
  FROM latest_per_scraper_in_batch
  WHERE batch_id = (SELECT batch_id FROM latest_batch)
`;

// =============================================================================
// KPI 4 — Credentials health (mid_manager.credentials_status)
// =============================================================================
export const Q_CREDENTIAL_HEALTH = `
  SELECT
    COUNT(*) FILTER (WHERE credentials_status = 'Valid')::int                                          AS valid,
    COUNT(*) FILTER (WHERE credentials_status = 'Invalid')::int                                        AS invalid,
    COUNT(*) FILTER (WHERE credentials_status NOT IN ('Valid','Invalid') OR credentials_status IS NULL)::int AS unchecked,
    COUNT(*)::int                                                                                       AS total,
    MAX(credentials_checked_at) AS last_checked_utc
  FROM beast_insights_v2.mid_manager
  WHERE cb_reporting_enabled = TRUE
`;

// =============================================================================
// 30-day run grid: one row per cron batch in the last 30 days
// =============================================================================
export const Q_RUN_GRID_30D = `
  ${BATCHED_CTE}
  SELECT
    bs.batch_id::int                                                  AS batch_id,
    bs.started                                                        AS started_utc,
    bs.ended                                                          AS ended_utc,
    COUNT(*)::int                                                     AS scrapers,
    COUNT(*) FILTER (WHERE lps.status = 'success')::int               AS success,
    COUNT(*) FILTER (WHERE lps.status = 'no_data')::int               AS no_data,
    COUNT(*) FILTER (WHERE lps.status = 'failed')::int                AS failed
  FROM latest_per_scraper_in_batch lps
  JOIN batch_stats bs ON bs.batch_id = lps.batch_id
  WHERE bs.started >= NOW() - INTERVAL '30 days'
  GROUP BY bs.batch_id, bs.started, bs.ended
  ORDER BY bs.started ASC
`;

// =============================================================================
// 30-day run grid DETAIL — one row per (batch, client, processor, gateway)
// in the last 30 days. Used by the Health Overview's 30-day cron history
// card so client / processor / gateway filters can re-aggregate cells
// client-side without a round-trip.
//
// We do NOT join mid_manager here — the user's filter is over the rows
// that actually appear in scraper_run_log (effective_gw values). This
// matches what the run grid header already shows.
// =============================================================================
export const Q_RUN_GRID_DETAIL_30D = `
  ${BATCHED_CTE}
  SELECT
    bs.batch_id::int            AS batch_id,
    bs.started                  AS started_utc,
    bs.ended                    AS ended_utc,
    lps.client_id::text         AS client_id,
    lps.processor               AS processor,
    lps.gateway_id              AS gateway_id,
    lps.status                  AS status
  FROM latest_per_scraper_in_batch lps
  JOIN batch_stats bs ON bs.batch_id = lps.batch_id
  WHERE bs.started >= NOW() - INTERVAL '30 days'
  ORDER BY bs.started ASC, lps.client_id, lps.processor, lps.gateway_id
`;

// =============================================================================
// 30-day per-client daily trend — used by the line chart on Health Overview.
//
// IMPORTANT: per-day per-scraper LATEST RUN ONLY. With 3 cron runs/day,
// summing across runs would inflate the line: a scraper that ran 3 times
// today (1 fail + 2 success) would contribute 2 to "healthy". That's
// meaningless. The right signal is "of the scrapers that ran today for
// this client, how many ended up healthy in their LAST run today".
//
// We use DISTINCT ON (day, client, processor, gateway) ORDER BY day,
// client, processor, gateway, ts DESC to pick the most-recent outcome
// per scraper per day. Then group by (day, client) and count.
// =============================================================================
export const Q_PER_CLIENT_DAILY_TREND_30D = `
  WITH ordered AS (
    SELECT
      id, run_date, run_time, client_id, processor, gateway_id, status,
      ((run_date + run_time) AT TIME ZONE 'UTC') AS ts
    FROM public.scraper_run_log
    WHERE mode = 'daily'
      AND processor <> 'blob_to_db'
      AND run_date >= CURRENT_DATE - INTERVAL '32 days'
  ),
  latest_per_scraper_per_day AS (
    SELECT DISTINCT ON (
      (ts AT TIME ZONE 'Asia/Kolkata')::date,
      client_id, processor, gateway_id
    )
      (ts AT TIME ZONE 'Asia/Kolkata')::date  AS day_ist,
      client_id::text                          AS client_id,
      processor,
      gateway_id,
      status
    FROM ordered
    WHERE ts >= NOW() - INTERVAL '30 days'
    ORDER BY
      (ts AT TIME ZONE 'Asia/Kolkata')::date,
      client_id, processor, gateway_id,
      ts DESC
  )
  SELECT
    day_ist::text                                                    AS day_ist,
    client_id,
    COUNT(*) FILTER (WHERE status IN ('success','no_data'))::int    AS healthy,
    COUNT(*) FILTER (WHERE status = 'failed')::int                  AS failed,
    COUNT(*)::int                                                    AS total
  FROM latest_per_scraper_per_day
  GROUP BY day_ist, client_id
  ORDER BY day_ist ASC, client_id ASC
`;

// =============================================================================
// 30-day daily trend: stacked area chart of success/no_data/failed by IST date
// =============================================================================
export const Q_DAILY_TREND_30D = `
  ${BATCHED_CTE}
  SELECT
    (bs.ended AT TIME ZONE 'Asia/Kolkata')::date                       AS day_ist,
    COUNT(*) FILTER (WHERE lps.status = 'success')::int                AS success,
    COUNT(*) FILTER (WHERE lps.status = 'no_data')::int                AS no_data,
    COUNT(*) FILTER (WHERE lps.status = 'failed')::int                 AS failed
  FROM latest_per_scraper_in_batch lps
  JOIN batch_stats bs ON bs.batch_id = lps.batch_id
  WHERE bs.started >= NOW() - INTERVAL '30 days'
  GROUP BY day_ist
  ORDER BY day_ist ASC
`;

// =============================================================================
// Latest batch — per scraper outcome (used to derive failure categories)
// =============================================================================
export const Q_LATEST_BATCH_DETAIL = `
  ${BATCHED_CTE},
  latest_batch AS (
    SELECT batch_id FROM batch_stats ORDER BY ended DESC LIMIT 1
  )
  SELECT
    client_id::text   AS client_id,
    processor,
    gateway_id,
    status,
    error_message,
    ts                AS ts_utc,
    rows_exported,
    duration_seconds
  FROM latest_per_scraper_in_batch
  WHERE batch_id = (SELECT batch_id FROM latest_batch)
  ORDER BY status DESC, client_id, processor, gateway_id
`;

// =============================================================================
// Per-scraper recent history (last 14 days, last 7 runs).
// Used in the API to compute: persistent failures, regressions, stale, last status.
// =============================================================================
export const Q_PER_SCRAPER_RECENT = `
  WITH ranked AS (
    SELECT
      client_id::text   AS client_id,
      processor,
      gateway_id,
      status,
      error_message,
      rows_exported,
      duration_seconds,
      ((run_date + run_time) AT TIME ZONE 'UTC') AS ts,
      ROW_NUMBER() OVER (
        PARTITION BY client_id, processor, gateway_id
        ORDER BY run_date DESC, run_time DESC
      ) AS rn
    FROM public.scraper_run_log
    WHERE mode = 'daily'
      AND processor <> 'blob_to_db'
      AND run_date >= CURRENT_DATE - INTERVAL '14 days'
  )
  SELECT
    client_id, processor, gateway_id,
    status, error_message, rows_exported, duration_seconds,
    ts AS ts_utc,
    rn::int AS rn
  FROM ranked
  WHERE rn <= 7
  ORDER BY client_id, processor, gateway_id, rn ASC
`;

// =============================================================================
// Issues: cred_rejected (mid_manager.credentials_status = 'Invalid')
// =============================================================================
export const Q_ISSUES_CRED_REJECTED = `
  SELECT
    m.id::int                AS id,
    m.client_id::text        AS client_id,
    m.gateway_id,
    m.mid,
    m.lender_name,
    m.portal_url,
    m.portal_username,
    m.credentials_status,
    m.credentials_message,
    m.credentials_checked_at AS checked_at_utc,
    m.updated_at             AS updated_at_utc,
    m.updated_by
  FROM beast_insights_v2.mid_manager m
  WHERE m.cb_reporting_enabled = TRUE
    AND m.credentials_status = 'Invalid'
  ORDER BY m.credentials_checked_at DESC NULLS LAST, m.client_id, m.lender_name
`;

// =============================================================================
// Issues: unmapped (enabled in mid_manager but no scraper_run_log row in 30 days)
// =============================================================================
export const Q_ISSUES_UNMAPPED = `
  SELECT
    m.id::int            AS id,
    m.client_id::text    AS client_id,
    m.gateway_id,
    m.mid,
    m.lender_name,
    m.portal_url,
    m.credentials_status,
    m.updated_at         AS updated_at_utc
  FROM beast_insights_v2.mid_manager m
  WHERE m.cb_reporting_enabled = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.scraper_run_log s
      WHERE s.mode = 'daily'
        AND s.processor <> 'blob_to_db'
        AND s.run_date >= CURRENT_DATE - INTERVAL '30 days'
        AND s.client_id::text = m.client_id::text
        AND (
          (m.gateway_id IS NOT NULL AND s.gateway_id = m.gateway_id::text)
          OR
          (m.gateway_id IS NULL AND s.gateway_id = m.mid)
        )
    )
  ORDER BY m.client_id, m.lender_name
`;

// =============================================================================
// Health by client (using credentials_status as proxy — already propagates
// across shared-login peers via update_mid_cred_status.py)
// =============================================================================
export const Q_HEALTH_BY_CLIENT = `
  SELECT
    client_id::text    AS client_id,
    COUNT(*)::int      AS total,
    COUNT(*) FILTER (WHERE credentials_status = 'Valid')::int   AS healthy,
    COUNT(*) FILTER (WHERE credentials_status = 'Invalid')::int AS failing,
    COUNT(*) FILTER (
      WHERE credentials_status NOT IN ('Valid','Invalid') OR credentials_status IS NULL
    )::int AS unchecked
  FROM beast_insights_v2.mid_manager
  WHERE cb_reporting_enabled = TRUE
  GROUP BY client_id
  ORDER BY (COUNT(*) FILTER (WHERE credentials_status = 'Valid'))::float
           / NULLIF(COUNT(*), 0) ASC,
           client_id ASC
`;

// =============================================================================
// Scrapers page — master inventory: every enabled mid_manager row.
// Returned as a flat list; the API layer enriches with run history.
// =============================================================================
export const Q_SCRAPERS_MID_LIST = `
  SELECT
    id::int                                                AS id,
    client_id::text                                        AS client_id,
    gateway_id                                             AS gateway_id,
    mid                                                    AS mid,
    lender_name                                            AS lender_name,
    portal_url                                             AS portal_url,
    portal_username                                        AS portal_username,
    cb_reporting_enabled                                   AS enabled,
    status                                                 AS mid_status,
    credentials_status                                     AS credentials_status,
    credentials_message                                    AS credentials_message,
    credentials_checked_at                                 AS credentials_checked_at,
    updated_at                                             AS updated_at,
    updated_by                                             AS updated_by,
    -- The identifier scraper_run_log uses for this row
    COALESCE(NULLIF(gateway_id::text, ''), mid)            AS effective_gw
  FROM beast_insights_v2.mid_manager
  WHERE cb_reporting_enabled = TRUE
  ORDER BY client_id, lender_name NULLS LAST, gateway_id, mid
`;

// =============================================================================
// Scrapers page — last 7 daily runs per (client, processor, gateway_id).
// Used to render the 7-day sparkline column and derive last_status / last_error
// / consecutive failures. 14-day window so we always have ≥7 runs available.
// =============================================================================
export const Q_SCRAPERS_LAST_7_RUNS = `
  WITH ranked AS (
    SELECT
      client_id::text   AS client_id,
      processor,
      gateway_id,
      status,
      error_message,
      rows_exported,
      duration_seconds,
      ((run_date + run_time) AT TIME ZONE 'UTC') AS ts,
      ROW_NUMBER() OVER (
        PARTITION BY client_id, processor, gateway_id
        ORDER BY run_date DESC, run_time DESC
      ) AS rn
    FROM public.scraper_run_log
    WHERE mode = 'daily'
      AND processor <> 'blob_to_db'
      AND run_date >= CURRENT_DATE - INTERVAL '14 days'
  )
  SELECT
    client_id, processor, gateway_id,
    status, error_message, rows_exported, duration_seconds,
    ts AS ts_utc,
    rn::int AS rn
  FROM ranked
  WHERE rn <= 7
  ORDER BY client_id, processor, gateway_id, rn ASC
`;

// =============================================================================
// Run history — list of batches in the last 60 days (extends Q_RUN_GRID_30D).
// =============================================================================
export const Q_RUN_HISTORY_LIST = `
  ${BATCHED_CTE}
  SELECT
    bs.batch_id::int                                                  AS batch_id,
    bs.started                                                        AS started_utc,
    bs.ended                                                          AS ended_utc,
    EXTRACT(EPOCH FROM (bs.ended - bs.started))::int                  AS duration_seconds,
    COUNT(*)::int                                                     AS scrapers,
    COUNT(*) FILTER (WHERE lps.status = 'success')::int               AS success,
    COUNT(*) FILTER (WHERE lps.status = 'no_data')::int               AS no_data,
    COUNT(*) FILTER (WHERE lps.status = 'failed')::int                AS failed,
    COALESCE(SUM(lps.rows_exported), 0)::bigint                       AS rows_total
  FROM latest_per_scraper_in_batch lps
  JOIN batch_stats bs ON bs.batch_id = lps.batch_id
  WHERE bs.started >= NOW() - INTERVAL '60 days'
  GROUP BY bs.batch_id, bs.started, bs.ended
  ORDER BY bs.started DESC
`;

// =============================================================================
// Run history — full per-scraper detail for one batch_id ($1).
// =============================================================================
export const Q_RUN_BATCH_DETAIL = `
  ${BATCHED_CTE}
  SELECT
    client_id::text   AS client_id,
    processor,
    gateway_id,
    status,
    error_message,
    rows_exported,
    duration_seconds,
    ts                AS ts_utc
  FROM latest_per_scraper_in_batch
  WHERE batch_id = $1::int
  ORDER BY
    CASE status WHEN 'failed' THEN 0 WHEN 'no_data' THEN 1 ELSE 2 END,
    client_id, processor, gateway_id
`;

// =============================================================================
// Production freshness — per (client_id, gateway_id) latest chargeback row.
//
// This query is the foundation for "silent failure" detection: a scraper can
// report status='success' but no row may have made it through the load step
// into public.chargebacks_raw. Without this query the dashboard cannot tell
// the difference between "everything is fine" and "scraper green but no
// reporting data landed."
//
// chargebacks_raw matching keys (per scripts/load_blob_to_db.py):
//   - client_id         (text)  — same as mid_manager.client_id::text
//   - gateway_id        (text)  — for client 20019 the loader writes mid here,
//                                 so we match against mid_manager's
//                                 COALESCE(gateway_id::text, mid)
// =============================================================================
export const Q_PROD_FRESHNESS_PER_SCRAPER = `
  SELECT
    client_id::text                                                            AS client_id,
    gateway_id                                                                  AS gateway_id,
    MAX(loaded_at)                                                              AS last_loaded_at_utc,
    MAX(chargeback_date)                                                        AS last_chargeback_date,
    COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '24 hours')::int       AS rows_loaded_last_24h,
    COUNT(*) FILTER (WHERE loaded_at >= NOW() - INTERVAL '7 days')::int         AS rows_loaded_last_7d,
    COUNT(*)::bigint                                                            AS rows_total
  FROM public.chargebacks_raw
  WHERE client_id IS NOT NULL
    AND gateway_id IS NOT NULL
    AND length(btrim(gateway_id)) > 0
  GROUP BY client_id, gateway_id
`;

// =============================================================================
// Health by lender_name (raw mid_manager.lender_name — same proxy)
// =============================================================================
export const Q_HEALTH_BY_LENDER = `
  SELECT
    COALESCE(lender_name, '(none)') AS lender_name,
    COUNT(*)::int                   AS total,
    COUNT(*) FILTER (WHERE credentials_status = 'Valid')::int   AS healthy,
    COUNT(*) FILTER (WHERE credentials_status = 'Invalid')::int AS failing,
    COUNT(*) FILTER (
      WHERE credentials_status NOT IN ('Valid','Invalid') OR credentials_status IS NULL
    )::int AS unchecked
  FROM beast_insights_v2.mid_manager
  WHERE cb_reporting_enabled = TRUE
  GROUP BY COALESCE(lender_name, '(none)')
  ORDER BY (COUNT(*) FILTER (WHERE credentials_status = 'Valid'))::float
           / NULLIF(COUNT(*), 0) ASC,
           total DESC
`;
