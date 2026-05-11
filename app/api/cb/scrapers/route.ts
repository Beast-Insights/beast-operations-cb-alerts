import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  Q_SCRAPERS_MID_LIST,
  Q_SCRAPERS_LAST_7_RUNS,
  Q_PROD_FRESHNESS_PER_SCRAPER,
} from '@/lib/cb/queries';
import {
  computeE2eStatus,
  computeProdDataAgeDays,
  isSilentFailure,
} from '@/lib/cb/e2e';
import type { ScraperRow, ScrapersResponse, ScraperStatus } from '@/lib/cb/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CacheEntry = { at: number; payload: ScrapersResponse };
const CACHE_TTL_MS = 55_000;
let cache: CacheEntry | null = null;

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type MidRow = {
  id: number;
  client_id: string;
  gateway_id: string | null;
  mid: string | null;
  lender_name: string | null;
  portal_url: string | null;
  portal_username: string | null;
  enabled: boolean;
  mid_status: string | null;
  credentials_status: string | null;
  credentials_message: string | null;
  credentials_checked_at: Date | null;
  updated_at: Date | null;
  updated_by: string | null;
  effective_gw: string;
};

type RunRow = {
  client_id: string;
  processor: string;
  gateway_id: string;
  status: ScraperStatus;
  error_message: string | null;
  rows_exported: number | null;
  duration_seconds: number | null;
  ts_utc: Date;
  rn: number;
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
    const [midRes, runsRes, freshnessRes] = await Promise.all([
      pool.query<MidRow>(Q_SCRAPERS_MID_LIST),
      pool.query<RunRow>(Q_SCRAPERS_LAST_7_RUNS),
      pool.query<{
        client_id: string;
        gateway_id: string;
        last_loaded_at_utc: Date | null;
        last_chargeback_date: Date | null;
        rows_loaded_last_24h: number;
        rows_loaded_last_7d: number;
        rows_total: string | number;
      }>(Q_PROD_FRESHNESS_PER_SCRAPER),
    ]);

    // Index freshness by (client_id, gateway_id)
    const freshByKey = new Map<string, (typeof freshnessRes.rows)[number]>();
    for (const f of freshnessRes.rows) {
      freshByKey.set(`${f.client_id}|${f.gateway_id}`, f);
    }

    // Group runs by (client_id, gateway_id) — we don't filter on processor here
    // because one scraper_run_log row in our system has one processor per gateway.
    type Aggregate = {
      processor: string;
      runs: RunRow[];
    };
    const byKey = new Map<string, Aggregate>();
    for (const r of runsRes.rows) {
      const k = `${r.client_id}|${r.gateway_id}`;
      let agg = byKey.get(k);
      if (!agg) {
        agg = { processor: r.processor, runs: [] };
        byKey.set(k, agg);
      }
      agg.runs.push(r);
    }
    Array.from(byKey.values()).forEach((a) => {
      a.runs.sort((x, y) => x.rn - y.rn);
    });

    const nowMs = Date.now();
    const rows: ScraperRow[] = midRes.rows.map((m) => {
      const k = `${m.client_id}|${m.effective_gw}`;
      const agg = byKey.get(k);
      const sortedRuns = agg?.runs ?? [];
      const latest = sortedRuns[0];

      let consecutive_failures = 0;
      for (const r of sortedRuns) {
        if (r.status === 'failed') consecutive_failures++;
        else break;
      }

      // 7-slot pattern (most recent first); pad with nulls when there are fewer runs
      const pattern_7d: (ScraperStatus | null)[] = Array.from({ length: 7 }, (_, i) => {
        const r = sortedRuns[i];
        return r ? r.status : null;
      });

      const last_run_ms = latest ? new Date(latest.ts_utc).getTime() : null;
      const is_unmapped = sortedRuns.length === 0;
      const is_stale = !latest || (last_run_ms !== null && nowMs - last_run_ms > STALE_THRESHOLD_MS);
      const is_regressed =
        latest?.status === 'failed' &&
        sortedRuns.length >= 2 &&
        (sortedRuns[1].status === 'success' || sortedRuns[1].status === 'no_data');

      // Production data — chargebacks_raw freshness for this scraper
      const fresh = freshByKey.get(k);
      const last_loaded_at_utc = fresh?.last_loaded_at_utc instanceof Date
        ? fresh.last_loaded_at_utc.toISOString()
        : null;
      const last_chargeback_date = fresh?.last_chargeback_date instanceof Date
        ? fresh.last_chargeback_date.toISOString().slice(0, 10)
        : null;
      const rows_total_in_prod = fresh ? Number(fresh.rows_total) : 0;
      const rows_loaded_last_24h = fresh ? Number(fresh.rows_loaded_last_24h) : 0;
      const rows_loaded_last_7d = fresh ? Number(fresh.rows_loaded_last_7d) : 0;
      const prod_data_age_days = computeProdDataAgeDays(
        fresh?.last_chargeback_date ?? null, rows_total_in_prod,
      );
      const is_silent_failure = isSilentFailure(
        latest?.status ?? null, rows_loaded_last_7d, rows_total_in_prod,
      );
      const e2e_status = computeE2eStatus({
        last_status: latest?.status ?? null,
        last_error: latest?.error_message ?? null,
        last_run_utc: latest ? new Date(latest.ts_utc).toISOString() : null,
        prev_status: sortedRuns[1]?.status ?? null,
        credentials_status: m.credentials_status,
        rows_loaded_last_7d,
        rows_total_in_prod,
        consecutive_failures,
      });

      return {
        id: Number(m.id),
        client_id: m.client_id,
        gateway_id: m.gateway_id,
        mid: m.mid,
        effective_gw: m.effective_gw,
        lender_name: m.lender_name,
        processor: agg?.processor ?? null,
        portal_url: m.portal_url,
        portal_username: m.portal_username,
        mid_status: m.mid_status,
        credentials_status: m.credentials_status,
        credentials_message: m.credentials_message,
        credentials_checked_utc: m.credentials_checked_at
          ? m.credentials_checked_at.toISOString()
          : null,
        last_status: latest?.status ?? null,
        last_error: latest?.error_message ?? null,
        last_run_utc: latest ? new Date(latest.ts_utc).toISOString() : null,
        last_rows_exported:
          latest?.rows_exported === null || latest?.rows_exported === undefined
            ? null
            : Number(latest.rows_exported),
        last_duration_seconds:
          latest?.duration_seconds === null || latest?.duration_seconds === undefined
            ? null
            : Number(latest.duration_seconds),
        consecutive_failures,
        pattern_7d,
        last_loaded_at_utc,
        last_chargeback_date,
        rows_loaded_last_24h,
        rows_loaded_last_7d,
        rows_total_in_prod,
        prod_data_age_days,
        is_stale,
        is_unmapped,
        is_regressed,
        is_silent_failure,
        e2e_status,
      };
    });

    const filters = {
      clients: Array.from(new Set(rows.map((r) => r.client_id))).sort(),
      processors: Array.from(
        new Set(rows.map((r) => r.processor).filter((p): p is string => Boolean(p))),
      ).sort(),
      lenders: Array.from(
        new Set(rows.map((r) => r.lender_name).filter((p): p is string => Boolean(p))),
      ).sort(),
    };

    const payload: ScrapersResponse = {
      generated_at_utc: new Date().toISOString(),
      rows,
      filters,
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/cb/scrapers] failed:', message);
    return NextResponse.json(
      { error: 'scrapers_query_failed', message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
