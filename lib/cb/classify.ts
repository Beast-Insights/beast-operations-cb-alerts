/**
 * Pure functions for categorizing scraper outcomes.
 * Mirrors the classification semantics of cb-reporting/scripts/update_mid_cred_status.py.
 */

export type RawStatus = 'success' | 'failed' | 'no_data' | string;

export type FailureCategory =
  | 'password_expired' // portal forced a password reset — actionable in portal
  | 'login_rejected'   // portal explicitly said "wrong password" / "still on login"
  | 'ip_blocked'       // wait_for_selector timeout / 403 — VM-level block
  | 'navigation'       // post-login navigation/timeout/parse errors
  | 'no_credentials'   // gateway in run plan but creds missing
  | 'other';

/**
 * Map a (status, error_message) tuple to a failure category.
 * Returns null if the row was successful.
 *
 * Order matters — we test most-specific patterns first so a generic
 * "LoginError" doesn't shadow the more actionable "PASSWORD EXPIRED".
 */
export function classifyFailure(status: RawStatus, errorMessage: string | null): FailureCategory | null {
  if (status !== 'failed') return null;
  const err = (errorMessage ?? '').trim();

  // Most-specific FIRST: "PASSWORD EXPIRED" comes from scrapers that
  // detected the portal's password-reset modal. Even though it's wrapped
  // in a LoginError exception, we want ops to see it as a distinct
  // category with a different remediation than "wrong creds".
  if (/PASSWORD EXPIRED|password has expired|password is expired/i.test(err)) {
    return 'password_expired';
  }
  if (/No credentials|credentials found/i.test(err)) return 'no_credentials';
  if (/wait_for_selector.*Timeout|Timeout 30000ms/i.test(err)) return 'ip_blocked';
  if (/LoginError/i.test(err)) {
    // Distinguish "login rejected" from a login-stage timeout (already caught above).
    return 'login_rejected';
  }
  if (/NavigationError|TimeoutError/i.test(err)) return 'navigation';
  return 'other';
}

export const FAILURE_CATEGORY_LABEL: Record<FailureCategory, string> = {
  password_expired: 'Password expired — portal reset required',
  login_rejected: 'Portal rejected credentials',
  ip_blocked: 'IP blocked / portal timeout',
  navigation: 'Navigation / post-login timeout',
  no_credentials: 'Credentials missing',
  other: 'Other failure',
};

export const FAILURE_CATEGORY_ACTION: Record<FailureCategory, string> = {
  password_expired: 'Log into portal manually, complete the password-reset dialog, then update the new password in mid_manager UI',
  login_rejected: 'Re-enter credentials in mid_manager UI',
  ip_blocked: 'Email portal support to whitelist VM IP 203.161.52.114',
  navigation: 'Inspect run logs for the post-login step that broke',
  no_credentials: 'Configure credentials in mid_manager UI',
  other: 'Open the run logs to investigate',
};

export const FAILURE_CATEGORY_BADGE: Record<FailureCategory, 'red' | 'orange' | 'amber' | 'gray'> = {
  password_expired: 'red',
  login_rejected: 'red',
  ip_blocked: 'orange',
  navigation: 'amber',
  no_credentials: 'amber',
  other: 'gray',
};

/**
 * Truncate an error message for compact display (e.g. in tables).
 */
export function truncateError(err: string | null, max = 140): string {
  const e = (err ?? '').trim();
  if (!e) return '';
  return e.length > max ? e.slice(0, max - 1) + '…' : e;
}
