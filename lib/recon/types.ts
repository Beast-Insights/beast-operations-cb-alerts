/**
 * Types for the recon agent status dashboard. Everything is derived from one
 * table: reconciliation.beast_recon_v2_agent_logs. Date fields are ISO 8601 UTC.
 */

export type RunStatus = 'healthy' | 'warning' | 'error';
export type AgentStatus = RunStatus | 'stale';
export type DayStatus = AgentStatus | 'none';
export type Level = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

/** One phase of a run, rolled up from its raw log rows. */
export interface Step {
  phase: string;
  label: string;
  level: Level;
  message: string;
  error_type: string | null;
  duration: number | null;
}

/** The exception that explains a run's outcome. */
export interface RunError {
  phase: string;
  error_type: string | null;
  message: string;
  fatal: boolean; // true → it stopped the run; false → handled / recovered
}

/** One reconciliation run for one gateway. */
export interface RunSummary {
  run_id: string;
  status: RunStatus;
  started_utc: string;
  ended_utc: string;
  duration_seconds: number | null;
  open_alerts: number | null;
  reconciled: number | null; // days reconciled
  final_message: string;
  n_errors: number;
  n_warnings: number;
  steps: Step[];
  error: RunError | null;
}

export interface Day7 {
  d: string; // "Jun 05"
  status: DayStatus;
  n: number; // runs that day
}

/** One "scraper" on the board = one client+gateway. */
export interface AgentRow {
  client_id: string;
  gateway_id: string;
  processor: string | null;
  bank: string | null;
  mid: string | null;
  status: AgentStatus;
  last_run_utc: string;
  last_duration: number | null;
  open_alerts: number | null;
  reconciled: number | null;
  last_message: string;
  last_error: RunError | null;
  age_hours: number;
  total_runs: number;
  days7: Day7[];
  runs: RunSummary[]; // most recent first, trimmed
}

export interface ScrapersResponse {
  generated_at_utc: string;
  rows: AgentRow[];
  filters: { clients: string[]; processors: string[]; banks: string[] };
}

export interface ClientHealth {
  client_id: string;
  healthy: number;
  warning: number;
  error: number;
  stale: number;
  total: number;
}

export interface RunGridDay {
  d: string; // "Jun 05"
  date_key: string; // IST yyyy-mm-dd
  healthy: number;
  warning: number;
  error: number;
  runs: number;
}

export interface WeekDay {
  d: string;
  healthy: number;
  warning: number;
  error: number;
  stale: number;
  none: number;
}

export interface TrendPoint {
  day: string; // "Jun 05"
  client_id: string;
  healthy: number;
}

export interface OverviewResponse {
  generated_at_utc: string;
  last_run_utc: string | null;
  kpis: {
    total: number;
    healthy: number;
    warning: number;
    error: number;
    stale: number;
    clients: string[];
    open_alerts: number;
    gateways_with_alerts: number;
  };
  banner: { severity: 'critical' | 'warning'; text: string } | null;
  by_client: ClientHealth[];
  run_grid: RunGridDay[];
  week: WeekDay[];
  per_client_daily: TrendPoint[];
}
