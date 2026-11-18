/**
 * Snapshot builder for the Disputeless scrapers. Source: public.disputeless_scrapper_logs
 * (one row per MID per scrape attempt). Rolled up into the SAME response shapes the
 * Deposit Recon board uses, so the UI is shared.
 *
 *   scraper = processor + login + MID
 *   status  : success / no_data → healthy · skipped → warning · failed → error
 *             (healthy but last run > 36h ago → stale)
 */
import { disputelessQuery } from './db';
import {
  GRID_DAYS, IDLE_DROP_HOURS, RUNS_PER_AGENT, STALE_HOURS,
  buildOverview, istKey, lastNDays, stripInternal, type InternalRun,
} from '@/lib/recon/build';
import type { DisputelessAgentRow, DisputelessScrapersResponse } from './types';
import type {
  AgentStatus, Day7, DayStatus, Level, OverviewResponse,
  RunError, RunStatus, Step,
} from '@/lib/recon/types';

const CACHE_TTL_MS = 55_000;

interface LogRow {
  id: string;
  run_id: string;
  executed_at: Date;
  attempt: number | null;
  org_id: string | null;
  org_name: string | null;
  beast_client_id: string | null;
  login_id: string | null;
  processor: string | null;
  mid_id: string | null;
  processor_mid: string | null;
  mid_name: string | null;
  status: string;
  login_outcome: string | null;
  login_detail: string | null;
  skip_reason: string | null;
  error_message: string | null;
  rows_exported: number | null;
  duration_seconds: string | number | null;
}

export type DisputelessOverview = OverviewResponse & { rows_exported: number };

export interface DisputelessSnapshot {
  scrapers: DisputelessScrapersResponse;
  overview: DisputelessOverview;
}

let cache: { at: number; snap: DisputelessSnapshot } | null = null;

export async function getDisputelessSnapshot(refresh = false): Promise<DisputelessSnapshot> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snap;
  const res = await disputelessQuery<LogRow>(`
    SELECT id, run_id, executed_at, attempt, org_id, org_name, beast_client_id, login_id,
           processor, mid_id, processor_mid, mid_name, status, login_outcome, login_detail,
           skip_reason, error_message, rows_exported, duration_seconds
    FROM public.disputeless_scrapper_logs
    WHERE executed_at >= now() - interval '45 days'
    ORDER BY executed_at ASC, id ASC
  `);
  const ref = await fetchReference();
  const snap = build(res.rows, new Date(), ref);
  cache = { at: Date.now(), snap };
  return snap;
}

interface Reference {
  orgs: Map<string, string>;
  mids: Map<string, { mid_number: string | null; processor_mid: string | null; descriptor: string | null; acquirer: string | null; status: string | null }>;
  logins: Map<string, { portal_url: string | null; username: string | null; outcome: string | null; detail: string | null; checked: Date | null }>;
  cbs: Map<string, { n: number; max_cb: string | null; last_load: Date | null; l24: number; l7: number }>;
}

// Lookup tables. Each query is best-effort — if one fails the board still renders.
// NEVER select the *_enc secret columns of processor_login.
async function fetchReference(): Promise<Reference> {
  const ref: Reference = { orgs: new Map(), mids: new Map(), logins: new Map(), cbs: new Map() };
  const safe = async <T extends object>(sql: string): Promise<T[]> => {
    try { return (await disputelessQuery<T & Record<string, unknown>>(sql)).rows as T[]; }
    catch (e) { console.error('[disputeless] lookup failed:', e instanceof Error ? e.message : e); return []; }
  };
  for (const o of await safe<{ id: string; name: string }>(`SELECT id::text, name FROM public.org`)) ref.orgs.set(o.id, o.name);
  for (const m of await safe<{ id: string; mid_number: string | null; processor_mid: string | null; descriptor: string | null; acquirer: string | null; status: string | null }>(
    `SELECT id::text, mid_number, processor_mid, descriptor, acquirer, status FROM public.mid`))
    ref.mids.set(m.id, m);
  for (const l of await safe<{ id: string; portal_url: string | null; username: string | null; outcome: string | null; detail: string | null; checked: Date | null }>(
    `SELECT id::text, portal_url, username, login_check_outcome AS outcome, login_check_detail AS detail, login_checked_at AS checked FROM public.processor_login`))
    ref.logins.set(l.id, l);
  for (const c of await safe<{ mid_id: string; n: string; max_cb: string | null; last_load: Date | null; l24: string; l7: string }>(
    `SELECT mid_id::text, count(*) AS n, to_char(max(chargeback_date), 'YYYY-MM-DD') AS max_cb, max(loaded_at) AS last_load,
            count(*) FILTER (WHERE loaded_at > now() - interval '24 hours') AS l24,
            count(*) FILTER (WHERE loaded_at > now() - interval '7 days') AS l7
     FROM public.raw_chargeback GROUP BY mid_id`))
    ref.cbs.set(c.mid_id, { n: Number(c.n), max_cb: c.max_cb, last_load: c.last_load, l24: Number(c.l24), l7: Number(c.l7) });
  return ref;
}

const short = (s: string | null) => (s ? s.slice(0, 8) : null);

function errorType(msg: string | null): string | null {
  if (!msg) return null;
  const m = msg.match(/([A-Za-z_]*(?:Error|Exception))\b/);
  return m ? m[1] : null;
}

function runStatusOf(status: string): RunStatus {
  if (status === 'failed') return 'error';
  if (status === 'skipped') return 'warning';
  return 'healthy'; // success, no_data
}

function stepsOf(r: LogRow): Step[] {
  const steps: Step[] = [];
  const dur = r.duration_seconds == null ? null : Number(r.duration_seconds);
  const errMsg = (r.error_message ?? '').slice(0, 400);

  if (r.status === 'skipped') {
    steps.push({
      phase: 'skipped', label: 'Skipped', level: 'WARNING',
      message: r.skip_reason ?? 'Skipped', error_type: null, duration: null,
    });
    return steps;
  }

  // Login
  let loginLevel: Level = 'SUCCESS';
  if (r.login_outcome === 'invalid') loginLevel = 'ERROR';
  else if (r.login_outcome === 'unchecked') loginLevel = r.status === 'failed' ? 'ERROR' : 'WARNING';
  const loginFailed = loginLevel === 'ERROR' && !(r.login_detail ?? '').startsWith('Login successful');
  steps.push({
    phase: 'login', label: 'Portal login', level: loginLevel,
    message: r.login_detail ?? (r.login_outcome ?? 'Login'),
    error_type: loginFailed ? errorType(r.error_message) : null,
    duration: null,
  });
  if (loginFailed) return steps;

  // Export
  if (r.status === 'failed') {
    steps.push({
      phase: 'export', label: 'Export chargebacks', level: 'ERROR',
      message: errMsg || 'Export failed', error_type: errorType(r.error_message), duration: dur,
    });
  } else {
    steps.push({
      phase: 'export', label: 'Export chargebacks', level: 'SUCCESS',
      message: r.status === 'no_data' ? 'No data to export' : `${r.rows_exported ?? 0} rows exported`,
      error_type: null, duration: dur,
    });
  }
  return steps;
}

function build(rows: LogRow[], now: Date, ref: Reference): DisputelessSnapshot {
  type Agent = {
    client_id: string; gateway_id: string; processor: string | null;
    login: string | null; mid: string | null; runs: InternalRun[]; last: LogRow;
  };
  const agents = new Map<string, Agent>();

  for (const r of rows) {
    if (!r.mid_id && !r.processor_mid) continue;
    const client = (r.org_id ? ref.orgs.get(r.org_id) : undefined) ?? r.org_name ?? r.beast_client_id ?? short(r.org_id) ?? 'unknown';
    const gw = r.processor_mid ?? r.mid_name ?? short(r.mid_id) ?? 'unknown';
    const key = `${r.processor}|${r.login_id}|${r.mid_id ?? r.processor_mid}`;

    const started = r.executed_at;
    const dur = r.duration_seconds == null ? null : Number(r.duration_seconds);
    const ended = new Date(started.getTime() + (dur ?? 0) * 1000);
    const status = runStatusOf(r.status);
    const steps = stepsOf(r);
    const failedStep = steps.find((s) => s.level === 'ERROR');

    const finalMessage =
      r.status === 'success' ? `${r.rows_exported ?? 0} rows exported`
      : r.status === 'no_data' ? 'No data to export'
      : r.status === 'skipped' ? `Skipped — ${r.skip_reason ?? 'no reason logged'}`
      : `Failed — ${(failedStep?.message ?? r.error_message ?? 'error').slice(0, 140)}`;

    const error: RunError | null = status === 'healthy' ? null
      : status === 'warning'
        ? { phase: 'Skipped', error_type: null, message: r.skip_reason ?? 'Skipped', fatal: false }
        : {
            phase: failedStep?.label ?? 'Run',
            error_type: failedStep?.error_type ?? errorType(r.error_message),
            message: (r.error_message ?? r.login_detail ?? 'Failed').slice(0, 400),
            fatal: true,
          };

    const run: InternalRun = {
      run_id: String(r.id),
      status,
      started_utc: started.toISOString(),
      ended_utc: ended.toISOString(),
      duration_seconds: dur == null ? null : Math.round(dur * 10) / 10,
      open_alerts: null,
      reconciled: r.rows_exported,
      final_message: finalMessage,
      n_errors: steps.filter((s) => s.level === 'ERROR').length,
      n_warnings: steps.filter((s) => s.level === 'WARNING').length,
      steps,
      error,
      _started: started,
      _client: client,
      _gw: gw,
    };

    let ag = agents.get(key);
    if (!ag) {
      ag = { client_id: client, gateway_id: gw, processor: r.processor, login: r.login_outcome, mid: r.mid_name ?? short(r.mid_id), runs: [], last: r };
      agents.set(key, ag);
    }
    ag.login = r.login_outcome ?? ag.login;
    ag.last = r; // rows are ascending, so this ends as the latest
    ag.runs.push(run);
  }

  const week = lastNDays(now, 7);
  const grid = lastNDays(now, GRID_DAYS);
  const allRuns: InternalRun[] = [];
  const out: DisputelessAgentRow[] = [];

  for (const ag of Array.from(agents.values())) {
    ag.runs.sort((a, b) => b._started.getTime() - a._started.getTime());
    allRuns.push(...ag.runs);
    const latest = ag.runs[0];
    const ageH = (now.getTime() - new Date(latest.ended_utc).getTime()) / 3_600_000;
    if (ageH > IDLE_DROP_HOURS) continue;
    let status: AgentStatus = latest.status;
    if (status === 'healthy' && ageH > STALE_HOURS) status = 'stale';

    const dayWorst = new Map<string, DayStatus>();
    const dayCount = new Map<string, number>();
    for (const r of ag.runs) {
      const k = istKey(r._started);
      dayCount.set(k, (dayCount.get(k) ?? 0) + 1);
      // Day status = the day's latest SUCCESSFUL run if there is one (a retry that
      // succeeds means the scraper recovered). Otherwise fall back to the day's
      // latest run (runs are newest-first, so the first one seen).
      const cur = dayWorst.get(k);
      if (cur === undefined || (cur !== 'healthy' && r.status === 'healthy')) dayWorst.set(k, r.status);
    }
    const days7: Day7[] = week.map((w) => ({
      d: w.label, status: dayWorst.get(w.key) ?? 'none', n: dayCount.get(w.key) ?? 0,
    }));

    const l = ag.last;
    const midRec = l.mid_id ? ref.mids.get(l.mid_id) : undefined;
    const login = l.login_id ? ref.logins.get(l.login_id) : undefined;
    const cb = l.mid_id ? ref.cbs.get(l.mid_id) : undefined;
    let consecutive = 0;
    for (const r of ag.runs) { if (r.status === 'error') consecutive++; else break; }
    const credRaw = login?.outcome ?? l.login_outcome;
    const cbAge = cb?.max_cb ? Math.floor((now.getTime() - new Date(cb.max_cb + 'T00:00:00Z').getTime()) / 86_400_000) : null;

    out.push({
      detail: {
        org_name: (l.org_id ? ref.orgs.get(l.org_id) : undefined) ?? l.org_name,
        descriptor: midRec?.descriptor ?? null,
        acquirer: midRec?.acquirer ?? null,
        last_status: l.status,
        last_rows_exported: l.rows_exported,
        last_error_message: l.error_message,
        skip_reason: l.skip_reason,
        consecutive_failures: consecutive,
        last_chargeback_date: cb?.max_cb ?? null,
        chargeback_age_days: cbAge,
        last_loaded_at_utc: cb?.last_load ? new Date(cb.last_load).toISOString() : null,
        rows_loaded_24h: cb?.l24 ?? 0,
        rows_loaded_7d: cb?.l7 ?? 0,
        rows_total: cb?.n ?? 0,
        cred_status: credRaw ? credRaw.charAt(0).toUpperCase() + credRaw.slice(1) : null,
        cred_checked_utc: login?.checked ? new Date(login.checked).toISOString() : null,
        cred_message: login?.detail ?? l.login_detail,
        portal_url: login?.portal_url ?? null,
        portal_username: login?.username ?? null,
        mid_id: l.mid_id,
        mid_number: midRec?.mid_number ?? midRec?.processor_mid ?? l.processor_mid,
        mid_status: midRec?.status ?? null,
      },
      client_id: ag.client_id,
      gateway_id: ag.gateway_id,
      processor: ag.processor,
      bank: ag.login, // repurposed: latest login outcome (valid / invalid / unchecked)
      mid: ag.mid,
      status,
      last_run_utc: latest.ended_utc,
      last_duration: latest.duration_seconds,
      open_alerts: null,
      reconciled: latest.reconciled, // rows exported on the latest run
      last_message: latest.final_message,
      last_error: latest.error,
      age_hours: Math.round(ageH * 10) / 10,
      total_runs: ag.runs.length,
      days7,
      runs: ag.runs.slice(0, RUNS_PER_AGENT).map(stripInternal),
    });
  }

  const order: Record<AgentStatus, number> = { error: 0, warning: 1, stale: 2, healthy: 3 };
  out.sort((a, b) =>
    (order[a.status] - order[b.status]) ||
    String(a.processor).localeCompare(String(b.processor)) ||
    a.gateway_id.localeCompare(b.gateway_id, undefined, { numeric: true }));

  const scrapers: DisputelessScrapersResponse = {
    generated_at_utc: now.toISOString(),
    rows: out,
    filters: {
      clients: Array.from(new Set(out.map((r) => r.client_id))).sort(),
      processors: Array.from(new Set(out.map((r) => r.processor).filter(Boolean) as string[])).sort(),
      banks: [],
    },
  };
  const base = buildOverview(out, allRuns, week, grid, now);
  if (base.banner) base.banner = { ...base.banner, text: base.banner.text.replace(/gateways?/g, (m) => (m === 'gateways' ? 'scrapers' : 'scraper')) };
  const rows_exported = out.reduce((s, r) => s + (r.reconciled ?? 0), 0);
  return { scrapers, overview: { ...base, rows_exported } };
}
