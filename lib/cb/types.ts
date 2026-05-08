/**
 * API response types for /api/cb/overview.
 * Every field maps to a real DB column or a derivation explicitly documented here.
 *
 * Date fields: every TIMESTAMPTZ from the DB is serialized as an ISO 8601 string
 * by the pg driver — frontend formats to IST for display.
 */

import type { FailureCategory } from './classify';

export type ScraperKey = {
  client_id: string;
  processor: string;
  gateway_id: string;
};

export type LastRunSummary = {
  started_utc: string | null;
  ended_utc: string | null;
  distinct_scrapers: number;
  success: number;
  no_data: number;
  failed: number;
  rows_total: number;
  avg_duration_seconds: number;
};

export type CredentialHealth = {
  valid: number;
  invalid: number;
  unchecked: number;
  total: number;
  last_checked_utc: string | null;
};

export type Kpis = {
  clients: { count: number; ids: string[] };
  scrapers: { enabled: number; total: number; unmapped: number };
  last_run: LastRunSummary;
  creds: CredentialHealth;
  production: ProductionFreshness;
};

// One row in the End-to-end status table — the centerpiece of the Health Overview.
// Answers all 5 of the user's questions in a single line per scraper.
export type E2eStatusRow = {
  client_id: string;
  processor: string | null;
  gateway_id: string;             // effective_gw — what scraper_run_log uses
  lender_name: string | null;
  // Cron health
  last_run_utc: string | null;
  last_status: ScraperStatus | null;
  // Login health
  credentials_status: string | null;
  // Production data
  last_loaded_at_utc: string | null;
  last_chargeback_date: string | null;
  rows_loaded_last_24h: number;
  prod_data_age_days: number | null;
  // Single canonical label
  e2e_status: E2eStatus;
};

export type RunGridCell = {
  batch_id: number;
  started_utc: string;
  ended_utc: string;
  scrapers: number;
  success: number;
  no_data: number;
  failed: number;
};

// Per-batch per-scraper outcome — one row per (batch, client, processor,
// gateway). The Health Overview's 30-day cron history card uses this to
// re-aggregate cells client-side when client / processor / gateway filters
// are applied, so filters never need a server round-trip.
export type RunGridDetailRow = {
  batch_id: number;
  started_utc: string;
  ended_utc: string;
  client_id: string;
  processor: string;
  gateway_id: string;
  status: ScraperStatus;
};

export type DailyTrendPoint = {
  day_ist: string; // 'YYYY-MM-DD' wall-clock IST date
  success: number;
  no_data: number;
  failed: number;
};

// Per-day per-client healthy-run count for the line chart on Health Overview.
// Pivoted client-side into the wide format Tremor's LineChart expects:
//     [{ date: '2026-04-15', 'Client 10057': 18, 'Client 10067': 7, ... }, …]
export type PerClientDailyPoint = {
  day_ist: string;
  client_id: string;
  healthy: number;
  failed: number;
  total: number;
};

export type FailureCategoryCount = {
  category: FailureCategory;
  label: string;
  count: number;
};

export type HealthByGroup = {
  key: string;     // client_id or lender_name
  total: number;
  healthy: number; // credentials_status='Valid'
  failing: number; // credentials_status='Invalid'
  unchecked: number;
};

// Production-data summary returned to the overview KPIs.
export type ProductionFreshness = {
  scrapers_with_prod_data: number;        // # of scrapers with rows_total_in_prod > 0
  scrapers_silent_failure: number;        // # of scrapers flagged is_silent_failure
  rows_loaded_last_24h: number;           // total rows loaded across all scrapers in last 24h
  rows_loaded_last_7d: number;
  oldest_prod_data_days: number | null;   // worst-case scraper age (max prod_data_age_days)
  last_loaded_at_utc: string | null;      // most recent loaded_at across all rows
};

// One actionable issue card on the overview page.
export type IssueItem = ScraperKey & {
  mid: string | null;
  lender_name: string | null;
  portal_url: string | null;
  portal_username: string | null;
  last_status: 'success' | 'no_data' | 'failed' | null;
  last_error: string | null;
  last_run_utc: string | null;
  consecutive_failures: number;
  category: FailureCategory | null;       // for "failed" categories
  credentials_status: string | null;
  credentials_message: string | null;
  credentials_checked_utc: string | null;
};

// 4-bucket issue queue (merged from the prior 6 buckets).
// Each scraper appears in at most ONE bucket — the most actionable one,
// determined by severity order: login_broken > regressed > silent_failure > stale_or_unmapped.
export type IssuesQueue = {
  login_broken: IssueItem[];        // cred_rejected ∪ ip_blocked ∪ persistent_failure  (action: fix creds / portal)
  regressed: IssueItem[];           // ✅/⚪ yesterday → ❌ today  (action: investigate what changed)
  silent_failure: IssueItem[];      // scraper green BUT no recent rows in chargebacks_raw  (action: check load step / blob)
  stale_or_unmapped: IssueItem[];   // hasn't run in >24h or never ran  (action: cron / orchestrator)
};

// =============================================================================
// Scrapers page
// =============================================================================
export type ScraperStatus = 'success' | 'no_data' | 'failed';

export type ScraperRow = {
  id: number;                          // mid_manager.id
  client_id: string;
  gateway_id: string | null;           // mid_manager.gateway_id (raw — may be null for client 20019)
  mid: string | null;                  // mid_manager.mid
  effective_gw: string;                // gateway_id or mid — the value that appears in scraper_run_log
  lender_name: string | null;
  processor: string | null;            // from scraper_run_log; null if scraper has never run
  portal_url: string | null;
  portal_username: string | null;
  mid_status: string | null;
  credentials_status: string | null;
  credentials_message: string | null;
  credentials_checked_utc: string | null;
  // Latest run derived from scraper_run_log (last 14 days)
  last_status: ScraperStatus | null;
  last_error: string | null;
  last_run_utc: string | null;
  last_rows_exported: number | null;
  last_duration_seconds: number | null;
  consecutive_failures: number;        // # of leading 'failed' in last_7_pattern
  pattern_7d: (ScraperStatus | null)[]; // most recent first; null = no run for that slot
  // Production data — public.chargebacks_raw
  last_loaded_at_utc: string | null;   // when did any row most recently land in chargebacks_raw
  last_chargeback_date: string | null; // most recent chargeback_date for this scraper (YYYY-MM-DD)
  rows_loaded_last_24h: number;        // count of chargebacks_raw rows loaded in last 24h
  rows_loaded_last_7d: number;
  rows_total_in_prod: number;          // lifetime count of rows in chargebacks_raw
  prod_data_age_days: number | null;   // (today - last_chargeback_date) in IST days; null if never produced
  // Derived flags
  is_stale: boolean;                   // last_run_utc older than 24h (or never ran)
  is_unmapped: boolean;                // never logged any run
  is_regressed: boolean;               // failed AND prior was success/no_data
  is_silent_failure: boolean;          // scraper green BUT prod data is stale or missing
  // End-to-end overall status — the single canonical health label
  e2e_status: E2eStatus;
};

// Single canonical status per scraper — drives the End-to-end status table
// on the Health Overview page. Ordered by severity for sorting.
export type E2eStatus =
  | 'login_broken'      // last cron failed with login-related error
  | 'silent_failure'    // last cron succeeded but production data is stale/missing
  | 'regressed'         // last cron failed; previous succeeded
  | 'stale_no_run'      // hasn't run in >24h or never ran
  | 'post_login_fail'   // last cron failed but it's not login-related
  | 'healthy';          // green end-to-end

export type ScraperFilters = {
  clients: string[];
  processors: string[];
  lenders: string[];
};

export type ScrapersResponse = {
  generated_at_utc: string;
  rows: ScraperRow[];
  filters: ScraperFilters;
};

// =============================================================================
// Run History page
// =============================================================================
export type RunRow = {
  batch_id: number;
  started_utc: string;
  ended_utc: string;
  duration_seconds: number;
  scrapers: number;
  success: number;
  no_data: number;
  failed: number;
  rows_total: number;
};

export type RunDetailRow = {
  client_id: string;
  processor: string;
  gateway_id: string;
  status: ScraperStatus;
  error_message: string | null;
  rows_exported: number | null;
  duration_seconds: number | null;
  ts_utc: string;
};

export type RunsResponse = {
  generated_at_utc: string;
  runs: RunRow[];                      // last 60 days, newest first
  detail?: {
    batch_id: number;
    started_utc: string;
    ended_utc: string;
    rows: RunDetailRow[];
  };                                   // populated when ?batch=N is passed
};

export type OverviewResponse = {
  generated_at_utc: string;     // server time; UI re-formats to IST
  kpis: Kpis;
  run_grid: RunGridCell[];
  run_grid_detail: RunGridDetailRow[];      // per-(batch, scraper) for client-side filtering
  e2e_rows: E2eStatusRow[];     // the centerpiece end-to-end status table
  issues: IssuesQueue;
  health_by_client: HealthByGroup[];
  per_client_daily: PerClientDailyPoint[];  // last 30 days, one row per (day, client)
  banner: { severity: 'critical' | 'warning'; text: string } | null;
};
