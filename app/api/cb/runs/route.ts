import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { Q_RUN_HISTORY_LIST, Q_RUN_BATCH_DETAIL } from '@/lib/cb/queries';
import type { RunRow, RunDetailRow, RunsResponse, ScraperStatus } from '@/lib/cb/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CacheEntry = { at: number; payload: RunsResponse };
const CACHE_TTL_MS = 55_000;
let listCache: CacheEntry | null = null;
const detailCache = new Map<number, { at: number; payload: NonNullable<RunsResponse['detail']> }>();

type DbRunRow = {
  batch_id: number;
  started_utc: Date;
  ended_utc: Date;
  duration_seconds: number;
  scrapers: number;
  success: number;
  no_data: number;
  failed: number;
  rows_total: string | number;
};

type DbDetailRow = {
  client_id: string;
  processor: string;
  gateway_id: string;
  status: ScraperStatus;
  error_message: string | null;
  rows_exported: number | null;
  duration_seconds: number | null;
  ts_utc: Date;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const noCache = url.searchParams.get('refresh') === '1';
  const batchParam = url.searchParams.get('batch');
  const batchId = batchParam ? Number.parseInt(batchParam, 10) : NaN;

  try {
    // ---- list (always returned) ----
    let runs: RunRow[];
    if (!noCache && listCache && Date.now() - listCache.at < CACHE_TTL_MS) {
      runs = listCache.payload.runs;
    } else {
      const res = await pool.query<DbRunRow>(Q_RUN_HISTORY_LIST);
      runs = res.rows.map((r) => ({
        batch_id: Number(r.batch_id),
        started_utc: r.started_utc.toISOString(),
        ended_utc: r.ended_utc.toISOString(),
        duration_seconds: Number(r.duration_seconds),
        scrapers: Number(r.scrapers),
        success: Number(r.success),
        no_data: Number(r.no_data),
        failed: Number(r.failed),
        rows_total: Number(r.rows_total),
      }));
    }

    // ---- detail (only if batch param) ----
    let detail: RunsResponse['detail'] | undefined;
    if (Number.isFinite(batchId)) {
      const cached = detailCache.get(batchId);
      if (!noCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        detail = cached.payload;
      } else {
        const res = await pool.query<DbDetailRow>(Q_RUN_BATCH_DETAIL, [batchId]);
        const detailRows: RunDetailRow[] = res.rows.map((r) => ({
          client_id: r.client_id,
          processor: r.processor,
          gateway_id: r.gateway_id,
          status: r.status,
          error_message: r.error_message,
          rows_exported: r.rows_exported === null ? null : Number(r.rows_exported),
          duration_seconds:
            r.duration_seconds === null ? null : Number(r.duration_seconds),
          ts_utc: r.ts_utc.toISOString(),
        }));
        // Pull batch boundaries from the matching run row
        const matched = runs.find((r) => r.batch_id === batchId);
        detail = {
          batch_id: batchId,
          started_utc: matched?.started_utc ?? (detailRows[0]?.ts_utc ?? new Date(0).toISOString()),
          ended_utc: matched?.ended_utc ?? (detailRows[detailRows.length - 1]?.ts_utc ?? new Date(0).toISOString()),
          rows: detailRows,
        };
        detailCache.set(batchId, { at: Date.now(), payload: detail });
      }
    }

    const payload: RunsResponse = {
      generated_at_utc: new Date().toISOString(),
      runs,
      detail,
    };

    if (!noCache) {
      listCache = { at: Date.now(), payload: { ...payload, detail: undefined } };
    }

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/cb/runs] failed:', message);
    return NextResponse.json(
      { error: 'runs_query_failed', message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
