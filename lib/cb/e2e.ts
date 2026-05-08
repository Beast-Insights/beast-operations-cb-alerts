/**
 * End-to-end status logic.
 *
 * One canonical status label per scraper, derived from:
 *   1. scraper_run_log    → last cron-run health
 *   2. mid_manager        → credential health
 *   3. chargebacks_raw    → production data freshness
 *
 * Severity order (most → least):
 *   login_broken > regressed > silent_failure > stale_no_run > post_login_fail > healthy
 *
 * The "Issues to fix" queue uses these to bucket scrapers — every scraper
 * appears in exactly ONE bucket (its most actionable issue).
 */

import { classifyFailure, type FailureCategory } from './classify';
import type { E2eStatus, ScraperStatus } from './types';

/**
 * Threshold (days) for "silent failure": if the scraper reports success but the
 * latest chargeback in production is older than this many days, treat it as a
 * silent failure. 7 days is a safe default for daily scrapers — most active
 * merchants get at least one chargeback a week.
 */
export const SILENT_FAILURE_DAYS = 7;

/**
 * Threshold (hours) for "stale": no run in this many hours = stale.
 * Daily cron at 01/09/17 UTC means a healthy scraper runs ≤ 8h ago, so 24h is
 * a forgiving bound that won't false-positive on cron-skip days.
 */
export const STALE_HOURS = 24;

export type E2eInputs = {
  /** scraper_run_log latest row — null if scraper has never run */
  last_status: ScraperStatus | null;
  last_error: string | null;
  last_run_utc: string | null;
  /** the previous run's status — used for regression detection */
  prev_status: ScraperStatus | null;
  /** mid_manager.credentials_status */
  credentials_status: string | null;
  /** chargebacks_raw freshness */
  last_chargeback_date: string | null;
  rows_total_in_prod: number;
  /** number of consecutive failed runs in scraper_run_log (most recent first) */
  consecutive_failures: number;
};

/**
 * Compute the prod_data_age_days field used by silent-failure detection.
 * Returns null when the scraper has never produced any chargeback rows.
 */
export function computeProdDataAgeDays(
  lastChargebackDate: string | Date | null,
  rowsTotalInProd: number,
): number | null {
  if (!lastChargebackDate) return null;
  if (rowsTotalInProd <= 0) return null;
  const cbMs = lastChargebackDate instanceof Date
    ? lastChargebackDate.getTime()
    : new Date(lastChargebackDate).getTime();
  if (!Number.isFinite(cbMs)) return null;
  const diff = Date.now() - cbMs;
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

/**
 * Decide whether a scraper is in "silent failure" mode:
 *   - last cron run reported success or no_data, AND
 *   - the scraper has produced rows in chargebacks_raw historically, AND
 *   - the latest chargeback is older than SILENT_FAILURE_DAYS.
 *
 * Skipping the check when rows_total_in_prod=0 avoids false-positives for
 * brand-new merchants that have legitimately never had a chargeback.
 */
export function isSilentFailure(
  last_status: ScraperStatus | null,
  prod_data_age_days: number | null,
  rows_total_in_prod: number,
): boolean {
  if (last_status !== 'success' && last_status !== 'no_data') return false;
  if (rows_total_in_prod <= 0) return false;
  if (prod_data_age_days === null) return true;  // no chargeback rows at all → silent
  return prod_data_age_days > SILENT_FAILURE_DAYS;
}

/**
 * Decide whether the latest scraper failure is login-related.
 * Login-broken bucket = login_rejected ∪ ip_blocked ∪ "consecutive failures with login pattern".
 */
export function isLoginRelated(
  last_status: ScraperStatus | null,
  last_error: string | null,
): boolean {
  if (last_status !== 'failed') return false;
  const cat = classifyFailure(last_status, last_error);
  return cat === 'login_rejected' || cat === 'ip_blocked' || cat === 'no_credentials';
}

/**
 * Compute the canonical e2e status from the inputs.
 * Severity order is honored: the highest-severity matching bucket wins.
 */
export function computeE2eStatus(inputs: E2eInputs): E2eStatus {
  const {
    last_status,
    last_error,
    last_run_utc,
    prev_status,
    credentials_status,
    last_chargeback_date,
    rows_total_in_prod,
    consecutive_failures,
  } = inputs;

  // Stale / never ran takes precedence when there's no run signal at all.
  if (!last_run_utc || !last_status) return 'stale_no_run';

  const ageMs = Date.now() - new Date(last_run_utc).getTime();
  const isStale = Number.isFinite(ageMs) && ageMs > STALE_HOURS * 60 * 60 * 1000;

  // 1. Login broken — failed today AND it's a login-class error
  if (isLoginRelated(last_status, last_error)) return 'login_broken';

  // Persistent failure with login pattern — also login_broken
  if (
    last_status === 'failed' &&
    consecutive_failures >= 3 &&
    classifyFailure(last_status, last_error) !== 'navigation'
  ) {
    return 'login_broken';
  }

  // 2. Regressed today — failed today, succeeded last time
  if (
    last_status === 'failed' &&
    (prev_status === 'success' || prev_status === 'no_data')
  ) {
    return 'regressed';
  }

  // 3. Silent failure — green cron but stale prod data
  const ageDays = computeProdDataAgeDays(last_chargeback_date, rows_total_in_prod);
  if (isSilentFailure(last_status, ageDays, rows_total_in_prod)) {
    return 'silent_failure';
  }

  // 4. Stale — last run too old (and no other signal won above)
  if (isStale) return 'stale_no_run';

  // 5. Post-login failure — failed but not login-related and not regressed
  if (last_status === 'failed') return 'post_login_fail';

  // 6. mid_manager says creds Invalid even though latest run wasn't a failure
  //    (e.g. cred-checker hasn't reconciled yet). Surface so it's actionable.
  if (credentials_status === 'Invalid') return 'login_broken';

  return 'healthy';
}

export const E2E_STATUS_LABEL: Record<E2eStatus, string> = {
  login_broken: 'Login broken',
  regressed: 'Regressed',
  silent_failure: 'Silent failure',
  stale_no_run: 'Stale',
  post_login_fail: 'Post-login fail',
  healthy: 'Healthy',
};

export const E2E_STATUS_TONE: Record<E2eStatus, 'red' | 'orange' | 'amber' | 'gray' | 'emerald'> = {
  login_broken: 'red',
  regressed: 'red',
  silent_failure: 'orange',
  stale_no_run: 'amber',
  post_login_fail: 'amber',
  healthy: 'emerald',
};

/** Severity order for sorting — higher number = more urgent. */
export const E2E_STATUS_SEVERITY: Record<E2eStatus, number> = {
  login_broken: 5,
  regressed: 4,
  silent_failure: 3,
  stale_no_run: 2,
  post_login_fail: 1,
  healthy: 0,
};
