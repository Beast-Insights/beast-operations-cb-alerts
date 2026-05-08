import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  Q_ACTIVE_CLIENTS,
  Q_SCRAPER_COUNTS,
  Q_LAST_RUN,
  Q_CREDENTIAL_HEALTH,
  Q_RUN_GRID_30D,
  Q_RUN_GRID_DETAIL_30D,
  Q_PER_SCRAPER_RECENT,
  Q_HEALTH_BY_CLIENT,
  Q_PROD_FRESHNESS_PER_SCRAPER,
  Q_PER_CLIENT_DAILY_TREND_30D,
} from '@/lib/cb/queries';
import {
  computeE2eStatus,
  computeProdDataAgeDays,
  isSilentFailure,
} from '@/lib/cb/e2e';
import type {
  OverviewResponse,
  IssueItem,
  IssuesQueue,
  HealthByGroup,
  E2eStatusRow,
  ScraperStatus,
  E2eStatus,
  RunGridDetailRow,
} from '@/lib/cb/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CacheEntry = { at: number; payload: OverviewResponse };
const CACHE_TTL_MS = 55_000;
let cache: CacheEntry | null = null;

type RankedRow = {
  client_id: string;
  processor: string;
  gateway_id: string;
  status: ScraperStatus;
  error_message: string | null;
  rows_exported: number | null;
  duration_seconds: number | null;
  ts_utc: Date | string;
  rn: number;
};

type Aggregate = {
  key: string;
  client_id: string;
  processor: string;
  gateway_id: string;
  runs: RankedRow[];                 // ordered by rn ASC (most recent first)
  consecutive_failures: number;
};

type FreshnessRow = {
  client_id: string;
  gateway_id: string;
  last_loaded_at_utc: Date | null;
  last_chargeback_date: Date | null;
  rows_loaded_last_24h: number;
  rows_loaded_last_7d: number;
  rows_total: string | number;
};

type MidRow = {
  id: number;
  client_id: string;
  gateway_id: string | null;
  mid: string | null;
  lender_name: string | null;
  portal_url: string | null;
  portal_username: string | null;
  cb_reporting_enabled: boolean;
  status: string | null;
  credentials_status: string | null;
  credentials_message: string | null;
  credentials_checked_at: Date | null;
  effective_gw: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const noCache = url.searchParams.get('refresh') === '1';

  if (!noCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const [
      activeClientsRes,
      scraperCountsRes,
      lastRunRes,
      credHealthRes,
      runGridRes,
      runGridDetailRes,
      perScraperRes,
      healthByClientRes,
      freshnessRes,
      perClientDailyRes,
      midRes,
    ] = await Promise.all([
      pool.query(Q_ACTIVE_CLIENTS),
      pool.query(Q_SCRAPER_COUNTS),
      pool.query(Q_LAST_RUN),
      pool.query(Q_CREDENTIAL_HEALTH),
      pool.query(Q_RUN_GRID_30D),
      pool.query<{
        batch_id: number;
        started_utc: Date | string;
        ended_utc: Date | string;
        client_id: string;
        processor: string | null;
        gateway_id: string;
        status: ScraperStatus;
      }>(Q_RUN_GRID_DETAIL_30D),
      pool.query<RankedRow>(Q_PER_SCRAPER_RECENT),
      pool.query(Q_HEALTH_BY_CLIENT),
      pool.query<FreshnessRow>(Q_PROD_FRESHNESS_PER_SCRAPER),
      pool.query<{ day_ist: string | Date; client_id: string; healthy: number; failed: number; total: number }>(
        Q_PER_CLIENT_DAILY_TREND_30D,
      ),
      pool.query<MidRow>(`
        SELECT
          id::int                                                AS id,
          client_id::text                                        AS client_id,
          gateway_id, mid, lender_name,
          portal_url, portal_username,
          cb_reporting_enabled, status,
          credentials_status, credentials_message, credentials_checked_at,
          COALESCE(NULLIF(gateway_id::text, ''), mid)            AS effective_gw
        FROM beast_insights_v2.mid_manager
        WHERE cb_reporting_enabled = TRUE
      `),
    ]);

    // ---- KPIs ----
    const cli = activeClientsRes.rows[0] ?? { clients: 0, client_ids: [] };
    const sc = scraperCountsRes.rows[0] ?? { enabled: 0, total: 0, unmapped: 0 };
    const lr = lastRunRes.rows[0] ?? {
      started_utc: null, ended_utc: null,
      distinct_scrapers: 0, success: 0, no_data: 0, failed: 0,
      rows_total: 0, avg_duration_seconds: 0,
    };
    const ch = credHealthRes.rows[0] ?? {
      valid: 0, invalid: 0, unchecked: 0, total: 0, last_checked_utc: null,
    };

    // ---- Run grid (30 days) ----
    const run_grid = runGridRes.rows.map((r) => ({
      batch_id: Number(r.batch_id),
      started_utc: r.started_utc instanceof Date ? r.started_utc.toISOString() : r.started_utc,
      ended_utc: r.ended_utc instanceof Date ? r.ended_utc.toISOString() : r.ended_utc,
      scrapers: Number(r.scrapers),
      success: Number(r.success),
      no_data: Number(r.no_data),
      failed: Number(r.failed),
    }));

    // ---- Run grid DETAIL (30 days) — one row per (batch, scraper)
    // Drives the client/processor/gateway filters on the cron-history card.
    const run_grid_detail: RunGridDetailRow[] = runGridDetailRes.rows.map((r) => ({
      batch_id: Number(r.batch_id),
      started_utc: r.started_utc instanceof Date ? r.started_utc.toISOString() : r.started_utc,
      ended_utc: r.ended_utc instanceof Date ? r.ended_utc.toISOString() : r.ended_utc,
      client_id: r.client_id,
      processor: r.processor ?? '',
      gateway_id: r.gateway_id,
      status: r.status,
    }));

    // ---- Per-scraper aggregates from scraper_run_log (14 days) ----
    const ranked = perScraperRes.rows;
    const byKey = new Map<string, Aggregate>();
    for (const r of ranked) {
      const k = `${r.client_id}|${r.processor}|${r.gateway_id}`;
      let agg = byKey.get(k);
      if (!agg) {
        agg = {
          key: k,
          client_id: r.client_id,
          processor: r.processor,
          gateway_id: r.gateway_id,
          runs: [],
          consecutive_failures: 0,
        };
        byKey.set(k, agg);
      }
      agg.runs.push(r);
    }
    Array.from(byKey.values()).forEach((a) => {
      a.runs.sort((x: RankedRow, y: RankedRow) => x.rn - y.rn);
      let n = 0;
      for (const r of a.runs) {
        if (r.status === 'failed') n++;
        else break;
      }
      a.consecutive_failures = n;
    });

    // ---- Lookup mid_manager rows for enrichment ----
    const midByEffective = new Map<string, MidRow>();
    for (const m of midRes.rows) {
      midByEffective.set(`${m.client_id}|${m.effective_gw}`, m);
    }

    // ---- Lookup chargebacks_raw freshness ----
    const freshByKey = new Map<string, FreshnessRow>();
    for (const f of freshnessRes.rows) {
      freshByKey.set(`${f.client_id}|${f.gateway_id}`, f);
    }

    // ---- Build E2eStatusRow per enabled mid_manager scraper ----
    const e2e_rows: E2eStatusRow[] = [];
    type SilentBlob = {
      e2e: E2eStatus;
      rows_loaded_last_24h: number;
      prod_data_age_days: number | null;
      last_loaded_at_utc: string | null;
      last_chargeback_date: string | null;
    };
    const silentByMid = new Map<number, SilentBlob>();

    for (const m of midRes.rows) {
      const k = `${m.client_id}|${m.effective_gw}`;
      const agg = byKey.get(k) ?? findByGateway(byKey, m.client_id, m.effective_gw);
      const latest = agg?.runs[0];
      const prev = agg?.runs[1];

      const fresh = freshByKey.get(k);
      const last_loaded_at = fresh?.last_loaded_at_utc instanceof Date
        ? fresh.last_loaded_at_utc.toISOString() : null;
      const last_cb_date = fresh?.last_chargeback_date instanceof Date
        ? fresh.last_chargeback_date.toISOString().slice(0, 10) : null;
      const rows_total = fresh ? Number(fresh.rows_total) : 0;
      const prod_data_age_days = computeProdDataAgeDays(
        fresh?.last_chargeback_date ?? null, rows_total,
      );

      const e2e = computeE2eStatus({
        last_status: latest?.status ?? null,
        last_error: latest?.error_message ?? null,
        last_run_utc: latest ? new Date(latest.ts_utc).toISOString() : null,
        prev_status: prev?.status ?? null,
        credentials_status: m.credentials_status,
        last_chargeback_date: last_cb_date,
        rows_total_in_prod: rows_total,
        consecutive_failures: agg?.consecutive_failures ?? 0,
      });

      e2e_rows.push({
        client_id: m.client_id,
        processor: agg?.processor ?? null,
        gateway_id: m.effective_gw,
        lender_name: m.lender_name,
        last_run_utc: latest ? new Date(latest.ts_utc).toISOString() : null,
        last_status: latest?.status ?? null,
        credentials_status: m.credentials_status,
        last_loaded_at_utc: last_loaded_at,
        last_chargeback_date: last_cb_date,
        rows_loaded_last_24h: fresh ? Number(fresh.rows_loaded_last_24h) : 0,
        prod_data_age_days,
        e2e_status: e2e,
      });

      silentByMid.set(m.id, {
        e2e,
        rows_loaded_last_24h: fresh ? Number(fresh.rows_loaded_last_24h) : 0,
        prod_data_age_days,
        last_loaded_at_utc: last_loaded_at,
        last_chargeback_date: last_cb_date,
      });
    }

    // ---- Production-freshness KPI summary ----
    let totalRows24h = 0;
    let totalRows7d = 0;
    let scrapersWithProd = 0;
    let oldestAgeDays = 0;
    let mostRecentLoad: number | null = null;
    for (const f of freshnessRes.rows) {
      const r24 = Number(f.rows_loaded_last_24h);
      const r7 = Number(f.rows_loaded_last_7d);
      const total = Number(f.rows_total);
      if (Number.isFinite(r24)) totalRows24h += r24;
      if (Number.isFinite(r7)) totalRows7d += r7;
      if (total > 0) scrapersWithProd++;
      if (f.last_loaded_at_utc instanceof Date) {
        const ms = f.last_loaded_at_utc.getTime();
        if (mostRecentLoad === null || ms > mostRecentLoad) mostRecentLoad = ms;
      }
      const age = computeProdDataAgeDays(f.last_chargeback_date, total);
      if (age !== null && age > oldestAgeDays) oldestAgeDays = age;
    }
    const scrapersSilent = e2e_rows.filter((r) => r.e2e_status === 'silent_failure').length;

    // ---- Build IssuesQueue (4 buckets, exclusive — most-actionable wins) ----
    const issues: IssuesQueue = {
      login_broken: [],
      regressed: [],
      silent_failure: [],
      stale_or_unmapped: [],
    };
    for (const m of midRes.rows) {
      const k = `${m.client_id}|${m.effective_gw}`;
      const agg = byKey.get(k) ?? findByGateway(byKey, m.client_id, m.effective_gw);
      const blob = silentByMid.get(m.id);
      if (!blob) continue;
      if (blob.e2e === 'healthy' || blob.e2e === 'post_login_fail') continue;

      const item: IssueItem = buildIssueItem(m, agg);
      switch (blob.e2e) {
        case 'login_broken':
          issues.login_broken.push(item);
          break;
        case 'regressed':
          issues.regressed.push(item);
          break;
        case 'silent_failure':
          issues.silent_failure.push(item);
          break;
        case 'stale_no_run':
          issues.stale_or_unmapped.push(item);
          break;
      }
    }

    // ---- Health by client ----
    const health_by_client: HealthByGroup[] = healthByClientRes.rows.map((r) => ({
      key: r.client_id,
      total: Number(r.total),
      healthy: Number(r.healthy),
      failing: Number(r.failing),
      unchecked: Number(r.unchecked),
    }));

    // ---- Per-client daily trend (30 days) ----
    // Rows come from SQL ordered by (day_ist ASC, client_id ASC). The
    // line chart on the page pivots them client-side into the wide format
    // Tremor's LineChart expects.
    const per_client_daily = perClientDailyRes.rows.map((r) => ({
      day_ist: r.day_ist instanceof Date
        ? r.day_ist.toISOString().slice(0, 10)
        : String(r.day_ist).slice(0, 10),
      client_id: r.client_id,
      healthy: Number(r.healthy),
      failed: Number(r.failed),
      total: Number(r.total),
    }));

    // ---- Banner ----
    let banner: OverviewResponse['banner'] = null;
    if (issues.regressed.length > 0) {
      const names = issues.regressed
        .slice(0, 4)
        .map((r) => `${r.client_id}/${r.processor}/${r.gateway_id}`)
        .join(', ');
      const more = issues.regressed.length > 4 ? ` +${issues.regressed.length - 4} more` : '';
      banner = {
        severity: 'critical',
        text: `${issues.regressed.length} scraper${issues.regressed.length > 1 ? 's' : ''} regressed in the latest run: ${names}${more}.`,
      };
    } else if (issues.silent_failure.length > 0) {
      const names = issues.silent_failure
        .slice(0, 3)
        .map((r) => `${r.client_id}/${r.processor || r.lender_name || ''}/${r.gateway_id}`)
        .join(', ');
      banner = {
        severity: 'critical',
        text: `${issues.silent_failure.length} silent failure${issues.silent_failure.length > 1 ? 's' : ''} — scraper green but production data is stale: ${names}.`,
      };
    } else if (lr.failed >= 4) {
      banner = {
        severity: 'warning',
        text: `${lr.failed} scrapers failed in the latest run.`,
      };
    }

    const payload: OverviewResponse = {
      generated_at_utc: new Date().toISOString(),
      kpis: {
        clients: { count: Number(cli.clients), ids: cli.client_ids ?? [] },
        scrapers: {
          enabled: Number(sc.enabled),
          total: Number(sc.total),
          unmapped: Number(sc.unmapped),
        },
        last_run: {
          started_utc: lr.started_utc instanceof Date ? lr.started_utc.toISOString() : lr.started_utc,
          ended_utc: lr.ended_utc instanceof Date ? lr.ended_utc.toISOString() : lr.ended_utc,
          distinct_scrapers: Number(lr.distinct_scrapers),
          success: Number(lr.success),
          no_data: Number(lr.no_data),
          failed: Number(lr.failed),
          rows_total: Number(lr.rows_total),
          avg_duration_seconds: Number(lr.avg_duration_seconds),
        },
        creds: {
          valid: Number(ch.valid),
          invalid: Number(ch.invalid),
          unchecked: Number(ch.unchecked),
          total: Number(ch.total),
          last_checked_utc: ch.last_checked_utc instanceof Date ? ch.last_checked_utc.toISOString() : ch.last_checked_utc,
        },
        production: {
          scrapers_with_prod_data: scrapersWithProd,
          scrapers_silent_failure: scrapersSilent,
          rows_loaded_last_24h: totalRows24h,
          rows_loaded_last_7d: totalRows7d,
          oldest_prod_data_days: oldestAgeDays || null,
          last_loaded_at_utc: mostRecentLoad ? new Date(mostRecentLoad).toISOString() : null,
        },
      },
      run_grid,
      run_grid_detail,
      e2e_rows,
      issues,
      health_by_client,
      per_client_daily,
      banner,
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/cb/overview] failed:', message);
    return NextResponse.json(
      { error: 'overview_query_failed', message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

// ---- helpers ----
function findByGateway(
  byKey: Map<string, Aggregate>,
  client_id: string,
  effective_gw: string,
): Aggregate | undefined {
  for (const a of Array.from(byKey.values())) {
    if (a.client_id === client_id && a.gateway_id === effective_gw) return a;
  }
  return undefined;
}

function buildIssueItem(m: MidRow, agg: Aggregate | undefined): IssueItem {
  const latest = agg?.runs[0];
  return {
    client_id: m.client_id,
    processor: agg?.processor ?? '',
    gateway_id: m.effective_gw,
    mid: m.mid,
    lender_name: m.lender_name,
    portal_url: m.portal_url,
    portal_username: m.portal_username,
    last_status: latest?.status ?? null,
    last_error: latest?.error_message ?? null,
    last_run_utc: latest
      ? (latest.ts_utc instanceof Date ? latest.ts_utc.toISOString() : latest.ts_utc)
      : null,
    consecutive_failures: agg?.consecutive_failures ?? 0,
    category: null,
    credentials_status: m.credentials_status,
    credentials_message: m.credentials_message,
    credentials_checked_utc: m.credentials_checked_at
      ? m.credentials_checked_at.toISOString()
      : null,
  };
}
