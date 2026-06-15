/**
 * Run-status derivation from raw log rows — the single source of truth for how
 * a run is classified. Ported from the validated Python rollup.
 *
 * Key subtlety: the daily VM job's console is cp1252; printing the unicode-rich
 * success summary can raise UnicodeEncodeError and emit a spurious
 * "failed and was skipped" ERROR row AFTER the reconciliation already succeeded.
 * That is a logging artifact, not a recon failure — we ignore it when ranking.
 */
import type { Level, RunStatus, Step } from './types';

export interface RawEvent {
  level: Level | string;
  phase: string | null;
  message: string;
  error_type: string | null;
  duration_seconds: number | null;
  detail: unknown;
}

const PHASE_LABELS: Record<string, string> = {
  scrape: 'Portal scrape', scrape_login: 'Portal login',
  scrape_statements: 'Statements page', scrape_batches: 'Batches page',
  scrape_payouts: 'Payouts page', portal_scrape: 'Portal scrape',
  portal_fetch: 'Portal fetch', portal_login: 'Portal login',
  portal_browser: 'Portal browser', portal_orders: 'Portal orders',
  portal_batch: 'Portal batches', portal_settlements: 'Settlements',
  portal_statements: 'Statements', portal_statement: 'Statement',
  portal_export: 'Portal export', portal_deposit: 'Deposits',
  portal_adjustments: 'Adjustments', paycosmos_scrape: 'Paycosmos scrape',
  token_refresh: 'Token refresh', run: 'Reconciliation',
  identity: 'Identity resolve', crm_gross: 'CRM gross',
  bank_login: 'Bank login', bank_scrape: 'Bank scrape',
  bank_browser: 'Bank browser', bank_fetch: 'Bank fetch', bank_read: 'Bank read',
  gather_inputs: 'Gather inputs', attribute: 'Attribute deposits',
  attribute_bank: 'Attribute bank', compute_naa: 'Compute NAA',
  match_naa_to_bank: 'Match NAA ↔ bank', classify: 'Classify',
  reconcile: 'Reconcile', evaluate_alerts: 'Evaluate alerts',
  drift: 'Drift check', drift_check: 'Drift check',
  lifecycle_reconcile: 'Alert lifecycle', persist: 'Persist', cleanup: 'Cleanup',
};

export function phaseLabel(phase: string | null): string {
  if (!phase) return 'Run';
  return PHASE_LABELS[phase] ?? phase.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Plain-language "what this step does", keyed by raw phase. Shown under each
 * pipeline row so the drawer reads as a story, not a list of internal names.
 * Aliased phases (e.g. drift / drift_check) point at the same sentence.
 */
const PHASE_DESCRIPTIONS: Record<string, string> = {
  // --- portal / processor side: pull what the processor says happened ---
  scrape: 'Opens the processor portal and pulls the day’s raw activity.',
  portal_scrape: 'Opens the processor portal and pulls the day’s raw activity.',
  portal_fetch: 'Downloads the processor’s transaction export for the period.',
  scrape_login: 'Signs in to the processor portal.',
  portal_login: 'Signs in to the processor portal.',
  portal_browser: 'Starts the headless browser session for the portal.',
  token_refresh: 'Refreshes the processor API token before fetching.',
  scrape_statements: 'Reads the statements page — the processor’s settled totals.',
  portal_statements: 'Reads the statements page — the processor’s settled totals.',
  portal_statement: 'Reads a single statement for the period.',
  scrape_batches: 'Reads the batches page — transactions captured that day.',
  portal_batch: 'Reads the batches page — transactions captured that day.',
  scrape_payouts: 'Reads the payouts page — what the processor says it paid out.',
  portal_settlements: 'Reads settlements — amounts the processor released to the bank.',
  portal_orders: 'Pulls the order-level detail behind each batch.',
  portal_deposit: 'Reads the processor’s deposit records for the period.',
  portal_adjustments: 'Reads fee and reserve adjustments applied by the processor.',
  portal_export: 'Exports the raw processor file for parsing.',
  paycosmos_scrape: 'Pulls activity from the Paycosmos portal.',

  // --- the reconciliation itself ---
  run: 'Runs the full day-by-day reconciliation for this gateway.',
  identity: 'Resolves each record to a known client + MID so deposits can be matched to the right merchant.',
  crm_gross: 'Totals gross sales from the CRM for the period — the “expected” side.',

  // --- bank side: what actually landed in the account ---
  bank_login: 'Logs in to the bank to download the settlement deposits.',
  bank_browser: 'Starts the bank’s browser session.',
  bank_scrape: 'Downloads the bank’s deposit rows for the account.',
  bank_fetch: 'Fetches the bank’s deposit export for the period.',
  bank_read: 'Parses the downloaded bank statement.',

  // --- match expected vs actual ---
  gather_inputs: 'Collects every input — processor, CRM and bank rows — the reconcile step needs.',
  attribute: 'Attributes each bank deposit to the gateway/MID that earned it.',
  attribute_bank: 'Attributes each bank deposit to the gateway/MID that earned it.',
  compute_naa: 'Computes the net amount expected to settle (sales − refunds − fees).',
  match_naa_to_bank: 'Matches each expected net amount against the actual bank deposits.',
  classify: 'Classifies each transaction — sale, refund, chargeback or fee.',
  reconcile: 'Compares expected settlement against bank deposits to confirm the funds actually arrived.',

  // --- decide, learn, save ---
  evaluate_alerts: 'Checks the reconciled result against the alert rules (e.g. funds held).',
  drift: 'Checks whether the learned matching patterns still fit reality; flags any that need re-learning.',
  drift_check: 'Checks whether the learned matching patterns still fit reality; flags any that need re-learning.',
  lifecycle_reconcile: 'Updates open alerts — opens new ones, resolves the ones now cleared.',
  persist: 'Writes the reconciled results and alerts back to the database.',
  cleanup: 'Closes browser sessions and releases resources.',
};

export function phaseDescription(phase: string | null): string | null {
  if (!phase) return null;
  return PHASE_DESCRIPTIONS[phase] ?? null;
}

const LEVEL_RANK: Record<string, number> = { INFO: 0, SUCCESS: 1, WARNING: 2, ERROR: 3 };
const SKIP_ARTIFACT = 'failed and was skipped';

export function isSkipArtifact(e: RawEvent): boolean {
  return e.phase === 'run' && (e.message || '').includes(SKIP_ARTIFACT);
}

/**
 * Phases whose *warnings* must NOT downgrade the overall run colour. Everything
 * from `gather_inputs` onward is downstream of the data we must capture: once
 * the processor scrape, the bank cross-check and the core reconcile are in, an
 * amber here (e.g. "no bank rows attributed, funds-held checks limited") is
 * shown on its own pipeline row but leaves the run — and the 7-day strip — green.
 *
 * This forgives WARNINGS only. A hard error (✕) in ANY phase — including the
 * bank login / bank scrape — is a real failure and turns the run red. Unknown
 * phases are treated as critical on purpose, so new failure modes surface loudly.
 */
const WARNING_FORGIVEN_PHASES = new Set<string>([
  'gather_inputs', 'attribute', 'attribute_bank', 'compute_naa',
  'match_naa_to_bank', 'classify', 'reconcile', 'evaluate_alerts',
  'drift', 'drift_check', 'lifecycle_reconcile', 'persist', 'cleanup',
]);

export function isWarningForgivenPhase(phase: string | null): boolean {
  return phase != null && WARNING_FORGIVEN_PHASES.has(phase);
}

export function runStatus(events: RawEvent[]): RunStatus {
  const hasRunSuccess = events.some((e) => e.phase === 'run' && e.level === 'SUCCESS');
  const realErrors = events.filter((e) => e.level === 'ERROR' && !isSkipArtifact(e));

  // A genuine error (✕) anywhere — bank login included — is a failure: red.
  if (realErrors.length) return 'error';
  if (events.some(isSkipArtifact) && !hasRunSuccess) return 'error';

  // No errors. A warning in a mission-critical phase → amber; a warning only in
  // the downstream steps is shown per-row but keeps the run (and 7-day) green.
  const criticalWarning = events.some(
    (e) => e.level === 'WARNING' && !isWarningForgivenPhase(e.phase),
  );
  return criticalWarning ? 'warning' : 'healthy';
}

export function buildSteps(events: RawEvent[]): Step[] {
  const order: string[] = [];
  const byPhase = new Map<string, RawEvent[]>();
  for (const e of events) {
    const ph = e.phase || 'run';
    if (!byPhase.has(ph)) { byPhase.set(ph, []); order.push(ph); }
    byPhase.get(ph)!.push(e);
  }
  const steps: Step[] = [];
  for (const ph of order) {
    const evs = byPhase.get(ph)!;
    const hasSuccess = evs.some((e) => e.level === 'SUCCESS');
    const rankable = evs.filter((e) => !(hasSuccess && isSkipArtifact(e)));
    const worst = rankable.reduce((a, b) =>
      (LEVEL_RANK[b.level] ?? 0) > (LEVEL_RANK[a.level] ?? 0) ? b : a);
    const level = worst.level as Level;
    let chosen = worst;
    if (level !== 'ERROR' && level !== 'WARNING') {
      const succ = evs.filter((e) => e.level === 'SUCCESS');
      chosen = succ.length ? succ[succ.length - 1] : evs[evs.length - 1];
    }
    const durs = evs.map((e) => e.duration_seconds).filter((d): d is number => d != null);
    steps.push({
      phase: ph,
      label: phaseLabel(ph),
      level,
      message: chosen.message,
      error_type: level === 'ERROR' ? worst.error_type : null,
      duration: durs.length ? Math.round(Math.max(...durs) * 10) / 10 : null,
    });
  }
  return steps;
}

export function reconciledDays(message: string | null): number | null {
  const m = (message || '').match(/(\d+)\s+day\(s\)\s+reconciled/);
  return m ? parseInt(m[1], 10) : null;
}

export function openAlertsOf(events: RawEvent[]): number | null {
  for (const e of events) {
    const d = e.detail as Record<string, unknown> | null;
    if (d && typeof d === 'object' && 'open_alerts' in d) {
      const v = Number((d as { open_alerts: unknown }).open_alerts);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}
