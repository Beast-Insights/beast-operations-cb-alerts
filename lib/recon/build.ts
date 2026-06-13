/**
 * Server-side snapshot builder. One query against
 * reconciliation.beast_recon_v2_agent_logs, rolled up into:
 *   - per-gateway "agents" (the Scrapers table)
 *   - overview aggregates (KPIs, 30-day run grid, 7-day strip, per-client trend)
 *
 * Cached in-memory for 55s so the overview + scrapers routes share one DB hit.
 */
import { queryWithRetry } from '@/lib/db';
import {
  buildSteps, isSkipArtifact, openAlertsOf, phaseLabel,
  reconciledDays, runStatus, type RawEvent,
} from './status';
import type {
  AgentRow, AgentStatus, ClientHealth, Day7, DayStatus, OverviewResponse,
  RunError, RunGridDay, RunStatus, RunSummary, ScrapersResponse, TrendPoint, WeekDay,
} from './types';

const RUNS_PER_AGENT = 12;
const STALE_HOURS = 36;
const GRID_DAYS = 30;
const CACHE_TTL_MS = 55_000;

interface LogRow {
  run_id: string;
  logged_at: Date;
  level: string;
  phase: string | null;
  client_id: string | null;
  gateway_id: string | null;
  mid: string | null;
  lender: string | null;
  processor: string | null;
  bank: string | null;
  message: string;
  error_type: string | null;
  duration_seconds: string | number | null;
  detail: unknown;
}

export interface Snapshot {
  scrapers: ScrapersResponse;
  overview: OverviewResponse;
}

let cache: { at: number; snap: Snapshot } | null = null;

export async function getSnapshot(refresh = false): Promise<Snapshot> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snap;
  const rows = await fetchRows();
  const snap = buildSnapshot(rows, new Date());
  cache = { at: Date.now(), snap };
  return snap;
}

async function fetchRows(): Promise<LogRow[]> {
  const res = await queryWithRetry<LogRow>(`
    SELECT run_id, logged_at, level, phase, client_id, gateway_id, mid, lender,
           processor, bank, message, error_type, duration_seconds, detail
    FROM reconciliation.beast_recon_v2_agent_logs
    WHERE logged_at >= now() - interval '45 days'
    ORDER BY logged_at ASC
  `);
  return res.rows;
}

// ---- IST day helpers (IST has no DST, so 24h steps keep the clock stable) ----
function istKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}
function istLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit' });
}
function lastNDays(now: Date, n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    out.push({ key: istKey(d), label: istLabel(d) });
  }
  return out;
}

const DAY_RANK: Record<DayStatus, number> = { none: -1, healthy: 0, stale: 0, warning: 1, error: 2 };

interface InternalRun extends RunSummary {
  _started: Date;
  _client: string;
  _gw: string;
}

function buildSnapshot(rows: LogRow[], now: Date): Snapshot {
  // 1) group rows by run_id
  const byRun = new Map<string, LogRow[]>();
  for (const r of rows) {
    let a = byRun.get(r.run_id);
    if (!a) { a = []; byRun.set(r.run_id, a); }
    a.push(r);
  }

  // 2) one run summary per run, attributed to its gateway
  type Agent = {
    client_id: string; gateway_id: string;
    processor: string | null; bank: string | null; mid: string | null;
    runs: InternalRun[];
  };
  const agents = new Map<string, Agent>();

  for (const evs of Array.from(byRun.values())) {
    evs.sort((a, b) => a.logged_at.getTime() - b.logged_at.getTime());
    const gw = evs.find((e) => e.gateway_id)?.gateway_id ?? null;
    const client = evs.find((e) => e.client_id != null)?.client_id ?? null;
    if (!gw || client == null) continue;

    const raw: RawEvent[] = evs.map((e) => ({
      level: e.level, phase: e.phase, message: e.message, error_type: e.error_type,
      duration_seconds: e.duration_seconds == null ? null : Number(e.duration_seconds),
      detail: e.detail,
    }));

    const processor = evs.find((e) => e.processor)?.processor ?? null;
    const bank = evs.find((e) => e.bank)?.bank ?? null;
    const mid = evs.find((e) => e.mid)?.mid ?? null;

    const status = runStatus(raw);
    const started = evs[0].logged_at;
    const ended = evs[evs.length - 1].logged_at;
    let duration: number | null = null;
    for (const e of evs) if (e.phase === 'run' && e.duration_seconds != null) duration = Number(e.duration_seconds);
    if (duration == null) duration = (ended.getTime() - started.getTime()) / 1000;

    const finalEv =
      [...evs].reverse().find((e) => e.phase === 'run' && (e.level === 'SUCCESS' || e.level === 'ERROR')) ??
      evs[evs.length - 1];

    const steps = buildSteps(raw);

    // root-cause error
    const realErrs = raw.filter((e) => e.level === 'ERROR' && !isSkipArtifact(e));
    let root: RawEvent | null = null;
    if (realErrs.length) {
      const typed = realErrs.filter((e) => e.error_type);
      root = typed.length ? typed[typed.length - 1] : realErrs[realErrs.length - 1];
    } else if (status === 'error') {
      const all = raw.filter((e) => e.level === 'ERROR');
      root = all.length ? all[all.length - 1] : null;
    }
    const error: RunError | null = root
      ? { phase: phaseLabel(root.phase), error_type: root.error_type, message: root.message, fatal: status === 'error' }
      : null;

    const run: InternalRun = {
      run_id: evs[0].run_id,
      status,
      started_utc: started.toISOString(),
      ended_utc: ended.toISOString(),
      duration_seconds: duration == null ? null : Math.round(duration * 10) / 10,
      open_alerts: openAlertsOf(raw),
      reconciled: reconciledDays(finalEv.message),
      final_message: finalEv.message,
      n_errors: raw.filter((e) => e.level === 'ERROR').length,
      n_warnings: raw.filter((e) => e.level === 'WARNING').length,
      steps,
      error,
      _started: started,
      _client: String(client),
      _gw: String(gw),
    };

    const key = `${client}|${gw}`;
    let ag = agents.get(key);
    if (!ag) {
      ag = { client_id: String(client), gateway_id: String(gw), processor, bank, mid, runs: [] };
      agents.set(key, ag);
    }
    ag.processor = processor ?? ag.processor;
    ag.bank = bank ?? ag.bank;
    ag.mid = mid ?? ag.mid;
    ag.runs.push(run);
  }

  // 3) finalize agents
  const week = lastNDays(now, 7);
  const grid = lastNDays(now, GRID_DAYS);
  const allRuns: InternalRun[] = [];

  const rows_out: AgentRow[] = [];
  for (const ag of Array.from(agents.values())) {
    ag.runs.sort((a, b) => b._started.getTime() - a._started.getTime());
    allRuns.push(...ag.runs);
    const latest = ag.runs[0];
    const ageH = (now.getTime() - new Date(latest.ended_utc).getTime()) / 3_600_000;
    let status: AgentStatus = latest.status;
    if (status === 'healthy' && ageH > STALE_HOURS) status = 'stale';

    // 7-day strip (worst run status per IST day)
    const dayWorst = new Map<string, DayStatus>();
    const dayCount = new Map<string, number>();
    for (const r of ag.runs) {
      const k = istKey(r._started);
      dayCount.set(k, (dayCount.get(k) ?? 0) + 1);
      const cur = dayWorst.get(k) ?? 'none';
      if (DAY_RANK[r.status] > DAY_RANK[cur]) dayWorst.set(k, r.status);
    }
    const days7: Day7[] = week.map((w) => ({
      d: w.label, status: dayWorst.get(w.key) ?? 'none', n: dayCount.get(w.key) ?? 0,
    }));

    rows_out.push({
      client_id: ag.client_id,
      gateway_id: ag.gateway_id,
      processor: ag.processor,
      bank: ag.bank,
      mid: ag.mid,
      status,
      last_run_utc: latest.ended_utc,
      last_duration: latest.duration_seconds,
      open_alerts: latest.open_alerts,
      reconciled: latest.reconciled,
      last_message: latest.final_message,
      last_error: latest.error,
      age_hours: Math.round(ageH * 10) / 10,
      total_runs: ag.runs.length,
      days7,
      runs: ag.runs.slice(0, RUNS_PER_AGENT).map(stripInternal),
    });
  }

  const order: Record<AgentStatus, number> = { error: 0, warning: 1, stale: 2, healthy: 3 };
  rows_out.sort((a, b) =>
    (order[a.status] - order[b.status]) ||
    String(a.processor).localeCompare(String(b.processor)) ||
    a.gateway_id.localeCompare(b.gateway_id, undefined, { numeric: true }));

  const scrapers: ScrapersResponse = {
    generated_at_utc: now.toISOString(),
    rows: rows_out,
    filters: {
      clients: Array.from(new Set(rows_out.map((r) => r.client_id))).sort(),
      processors: Array.from(new Set(rows_out.map((r) => r.processor).filter(Boolean) as string[])).sort(),
      banks: Array.from(new Set(rows_out.map((r) => r.bank).filter(Boolean) as string[])).sort(),
    },
  };

  const overview = buildOverview(rows_out, allRuns, week, grid, now);
  return { scrapers, overview };
}

function stripInternal(r: InternalRun): RunSummary {
  const { _started, _client, _gw, ...rest } = r;
  return rest;
}

function buildOverview(
  agentsArr: AgentRow[],
  allRuns: InternalRun[],
  week: { key: string; label: string }[],
  grid: { key: string; label: string }[],
  now: Date,
): OverviewResponse {
  const counts = { healthy: 0, warning: 0, error: 0, stale: 0 };
  for (const a of agentsArr) counts[a.status]++;
  const clients = Array.from(new Set(agentsArr.map((a) => a.client_id))).sort();
  const openAlerts = agentsArr.reduce((s, a) => s + (a.open_alerts ?? 0), 0);
  const gatewaysWithAlerts = agentsArr.filter((a) => a.open_alerts).length;
  const lastRun = agentsArr.reduce<string | null>((acc, a) =>
    !acc || a.last_run_utc > acc ? a.last_run_utc : acc, null);

  const by_client: ClientHealth[] = clients.map((cl) => {
    const list = agentsArr.filter((a) => a.client_id === cl);
    return {
      client_id: cl,
      healthy: list.filter((a) => a.status === 'healthy').length,
      warning: list.filter((a) => a.status === 'warning').length,
      error: list.filter((a) => a.status === 'error').length,
      stale: list.filter((a) => a.status === 'stale').length,
      total: list.length,
    };
  }).sort((a, b) => (a.healthy / Math.max(1, a.total)) - (b.healthy / Math.max(1, b.total))
    || a.client_id.localeCompare(b.client_id));

  // 30-day run grid (per IST day, across all runs)
  const gridMap = new Map<string, RunGridDay>();
  for (const g of grid) gridMap.set(g.key, { d: g.label, date_key: g.key, healthy: 0, warning: 0, error: 0, runs: 0 });
  // per-client daily healthy trend
  const trendMap = new Map<string, Map<string, number>>(); // dayKey -> client -> healthy
  for (const r of allRuns) {
    const k = istKey(r._started);
    const cell = gridMap.get(k);
    if (cell) { cell.runs++; cell[r.status]++; }
    if (r.status === 'healthy') {
      let m = trendMap.get(k);
      if (!m) { m = new Map(); trendMap.set(k, m); }
      m.set(r._client, (m.get(r._client) ?? 0) + 1);
    }
  }
  const run_grid = grid.map((g) => gridMap.get(g.key)!);
  const per_client_daily: TrendPoint[] = [];
  for (const g of grid) {
    const m = trendMap.get(g.key);
    for (const cl of clients) per_client_daily.push({ day: g.label, client_id: cl, healthy: m?.get(cl) ?? 0 });
  }

  // 7-day stacked (sum agents' worst-status-per-day)
  const weekDays: WeekDay[] = week.map((w) => ({ d: w.label, healthy: 0, warning: 0, error: 0, stale: 0, none: 0 }));
  for (const a of agentsArr) {
    a.days7.forEach((d, i) => { weekDays[i][d.status]++; });
  }

  const issues = counts.warning + counts.error + counts.stale;
  let banner: OverviewResponse['banner'] = null;
  if (counts.error > 0) {
    banner = { severity: 'critical', text: `${counts.error} gateway${counts.error === 1 ? '' : 's'} failed in the latest run${counts.warning ? ` and ${counts.warning} completed with warnings` : ''}.` };
  } else if (issues > 0) {
    banner = { severity: 'warning', text: `${counts.warning} gateway${counts.warning === 1 ? '' : 's'} completed with warnings${counts.stale ? ` · ${counts.stale} stale` : ''}.` };
  }

  return {
    generated_at_utc: now.toISOString(),
    last_run_utc: lastRun,
    kpis: {
      total: agentsArr.length, ...counts, clients,
      open_alerts: openAlerts, gateways_with_alerts: gatewaysWithAlerts,
    },
    banner,
    by_client,
    run_grid,
    week: weekDays,
    per_client_daily,
  };
}
