/**
 * Reliability tab — gateway-level grouping, action queue derivation,
 * per-portal scoreboard.
 *
 * Pure functions only. They consume ScraperRow[] / RunRow[] from the
 * existing /api/cb/scrapers and /api/cb/runs endpoints and rearrange
 * the data into views that drive the Reliability tab UI.
 */

import type { ScraperRow, RunRow } from './types';
import { classifyFailure } from './classify';

// ============================================================================
// LENDER NAME → PROCESSOR CODE
// ----------------------------------------------------------------------------
// Mirrors `_LENDER_TO_PROCESSOR` in cb-reporting/src/core/credentials_db.py.
// We need this here because shared-login peers (e.g. Cliq Payments / 27
// next to cliq / 22) often appear in the API response with `processor=null`
// — they have no scraper_run_log row of their own. Without this mapping,
// the dashboard groups by `lender_name.toLowerCase()` and can't unify
// "Cliq Payments" with "cliq", placing them into different action buckets.
//
// Keep this list in sync with credentials_db.py. If a new lender is added,
// the dashboard will fall back to using the raw lender_name for grouping —
// safe but it'll show the peer as a separate group until the map is updated.
// ============================================================================
const LENDER_TO_PROCESSOR: Record<string, string> = {
  apps:               'apps',
  'brain tree':       'braintree',
  braintree:          'braintree',
  cliq:               'cliq',
  'cliq payments':    'cliq',
  'coastal pay':      'coastalpay',
  coastalpay:         'coastalpay',
  ems:                'kurvpay',
  'goat payments':    'goatpayments',
  goatpayments:       'goatpayments',
  kurvpay:            'kurvpay',
  maverick:           'maverick',
  micamp:             'micamp',
  'mission valley':   'missionvalley',
  missionvalley:      'missionvalley',
  nexio:              'nexio',
  nuvei:              'nuvei',
  payarc:             'payarc',
  paycompass:         'paycompass',
  paycosmos:          'paycosmos',
  paypal:             'paypal',
  paysafe:            'paysafe',
  'phoenix pay':      'phoenixpay',
  phoenixpay:         'phoenixpay',
  pps:                'pps',
  'quantum epay':     'quantumepay',
  quantumepay:        'quantumepay',
  'quantum pay':      'quantumpay',
  quantumpay:         'quantumpay',
};

/** Normalize a row's processor identifier so peers and primaries map identically. */
function normalizedProcessor(r: ScraperRow): string {
  if (r.processor) return r.processor.toLowerCase();
  const lender = (r.lender_name ?? '').trim().toLowerCase();
  if (lender && LENDER_TO_PROCESSOR[lender]) return LENDER_TO_PROCESSOR[lender];
  return lender || '(unmapped)';
}

// ============================================================================
// ACTION CATEGORIES — the "what to do" buckets ops works through
// ============================================================================
export type ActionCategory =
  | 'password_expired'  // PASSWORD EXPIRED in error message → portal reset
  | 'cred_invalid'      // login_rejected (not password expired) → merchant re-cred
  | 'ip_blocked'        // VM IP blocked → portal support whitelist
  | 'portal_change'     // post-login NavigationError → likely selector change
  | 'unmapped'          // lender_name not mapped → add scraper / disable
  | 'low_volume'        // success/no_data + stale prod data → just slow merchant
  | 'healthy';          // nothing to do

export const ACTION_LABEL: Record<ActionCategory, string> = {
  password_expired: 'Reset password in portal',
  cred_invalid:    'Verify credentials with merchant',
  ip_blocked:      'Whitelist VM IP at portal support',
  portal_change:   'Investigate portal change / scraper selector',
  unmapped:        'Add scraper or disable in mid_manager',
  low_volume:      'No action — low-volume merchant',
  healthy:         'Healthy',
};

export const ACTION_HOWTO: Record<ActionCategory, string> = {
  password_expired:
    'Log into portal manually with current creds → complete password-reset dialog → update new password in mid_manager UI.',
  cred_invalid:
    'Get current portal password from the merchant → update in mid_manager UI. ⚠ Do NOT re-run scraper before update if account is near lockout.',
  ip_blocked:
    'Email portal support requesting they whitelist VM outbound IP 203.161.52.114.',
  portal_change:
    'Run scraper headed locally → screenshot the failure point → diagnose whether it’s a portal UI change (fix selector) or transient flake.',
  unmapped:
    'Either add a scraper for this lender and update _LENDER_TO_PROCESSOR mapping, or set cb_reporting_enabled=false in mid_manager.',
  low_volume:
    'Confirmed no chargebacks for this merchant in the export window. Re-check in 7 days; if still no data, verify with merchant that no chargebacks were issued.',
  healthy: '—',
};

export const ACTION_SEVERITY: Record<ActionCategory, number> = {
  password_expired: 5,
  cred_invalid:     5,
  portal_change:    4,
  ip_blocked:       3,
  unmapped:         2,
  low_volume:       1,
  healthy:          0,
};

export const ACTION_TONE: Record<ActionCategory, 'red' | 'orange' | 'amber' | 'gray' | 'emerald'> = {
  password_expired: 'red',
  cred_invalid:     'red',
  portal_change:    'orange',
  ip_blocked:       'orange',
  unmapped:         'amber',
  low_volume:       'gray',
  healthy:          'emerald',
};

// ============================================================================
// Per-gateway action category — derives from the row's symptoms
// ============================================================================
export function categorizeRow(r: ScraperRow): ActionCategory {
  // Healthy first — covers the bulk of rows
  if (r.e2e_status === 'healthy') return 'healthy';

  const err = r.last_error ?? '';

  // Most-specific failure category first
  if (/PASSWORD EXPIRED|password has expired|password is expired/i.test(err)) {
    return 'password_expired';
  }

  // Persistent or fresh login failure
  if (r.last_status === 'failed') {
    const cat = classifyFailure(r.last_status, r.last_error);
    if (cat === 'login_rejected' || cat === 'no_credentials') return 'cred_invalid';
    if (cat === 'ip_blocked') return 'ip_blocked';
    if (cat === 'navigation') return 'portal_change';
    return 'cred_invalid';   // generic LoginError default
  }

  // mid_manager.credentials_status says Invalid even though run says success/no_data
  // → stale label, don't treat as actionable
  // (status='success' with cred='Invalid' just means update_mid_cred_status hasn't refreshed yet)

  // True "unmapped" lender (e.g. FlexFactor) — enabled in mid_manager but
  // no scraper exists for it. Distinguished from peers (which also have
  // is_unmapped=true because they don't have own log rows): a real unmapped
  // lender has no peer with a scraper either, so its lender_name doesn't
  // resolve through LENDER_TO_PROCESSOR. Use that as the disambiguator.
  if (r.is_unmapped) {
    const lender = (r.lender_name ?? '').trim().toLowerCase();
    if (!lender || !LENDER_TO_PROCESSOR[lender]) return 'unmapped';
    // Otherwise this is a peer of a primary; let the group-level rollup
    // overwrite this. Treat it as low_volume so it doesn't dominate the
    // queue if the rollup somehow misses it.
  }

  // Silent-failure (success/no_data with stale prod data) — only flag as
  // low-volume when prod_data_age_days is moderate. Genuine silent failures
  // (very stale despite recent loads) would have been caught above.
  if (r.e2e_status === 'silent_failure') return 'low_volume';
  if (r.e2e_status === 'stale_no_run') {
    // Could be a multi-gateway peer that doesn't have its own log row.
    // Without peer-rollup we can't tell — leave as low_volume for now.
    return 'low_volume';
  }
  if (r.e2e_status === 'post_login_fail') return 'portal_change';
  if (r.e2e_status === 'regressed') return 'cred_invalid';

  return 'low_volume';
}

// ============================================================================
// Multi-gateway peer rollup — gateways that share a portal login share fate
// ============================================================================
export type LoginGroup = {
  client_id: string;
  processor: string | null;
  lender_name: string | null;
  portal_username: string | null;
  members: ScraperRow[];        // all gateways behind this login
  primary: ScraperRow;          // the row whose scraper actually runs
  effectiveCategory: ActionCategory;  // the worst category among members
};

/**
 * Group enabled mid_manager rows by their shared portal login.
 *
 * For multi-gateway logins (same client, same lender_name, same portal_username),
 * the orchestrator dispatches one invocation that exports for all peers. So when
 * the primary gateway fails login, every peer is implicitly affected. The
 * dashboard's per-mid_manager-row e2e_status already reflects this for the
 * primary; this rollup propagates the primary's status to every peer.
 */
export function groupByLogin(rows: ScraperRow[]): LoginGroup[] {
  const groups = new Map<string, LoginGroup>();
  for (const r of rows) {
    // Use normalized processor (lender_name → processor code) so peers
    // without their own scraper_run_log entry land in the same group as
    // their primary. Without this, e.g. "Cliq Payments" (peer) would be
    // grouped separately from "cliq" (primary) even though they're the
    // same login.
    const key =
      `${r.client_id}|` +
      `${normalizedProcessor(r)}|` +
      `${r.portal_username ?? '__no_user__'}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        client_id: r.client_id,
        processor: r.processor,
        lender_name: r.lender_name,
        portal_username: r.portal_username,
        members: [],
        primary: r,
        effectiveCategory: 'healthy',
      };
      groups.set(key, g);
    }
    g.members.push(r);
    // Primary = the row most likely to actually be invoked. Heuristic:
    //  1. Pick the row whose effective_gw matches the orchestrator's
    //     min(effective_gw). The orchestrator picks the lowest-id peer.
    //  2. Tie-break: prefer rows that have a last_status (i.e. that actually
    //     appeared in scraper_run_log) over those that don't.
    if (g.primary !== r) {
      const primaryHasLog = g.primary.last_status !== null;
      const challengerHasLog = r.last_status !== null;
      if (challengerHasLog && !primaryHasLog) {
        g.primary = r;
      } else if (challengerHasLog === primaryHasLog) {
        if (r.effective_gw < g.primary.effective_gw) g.primary = r;
      }
    }
  }
  // Compute effective category from the primary row (the one with a
  // scraper_run_log entry, if any). Peers in the same login group inherit
  // the primary's status — so a "Cliq Payments / 27" peer that has
  // last_status=null should NOT be categorized as 'unmapped' just because
  // the orchestrator only logs the primary; it shares fate with cliq/22.
  for (const g of Array.from(groups.values())) {
    g.effectiveCategory = categorizeRow(g.primary);
  }
  return Array.from(groups.values());
}

// ============================================================================
// Action queue — group login-groups by their action category, ranked by impact
// ============================================================================
export type ActionGroup = {
  category: ActionCategory;
  affectedGroups: LoginGroup[];      // login groups in this category
  affectedGatewayCount: number;      // total gateways across all those groups
  affectedClientIds: Set<string>;
};

export function buildActionQueue(rows: ScraperRow[]): ActionGroup[] {
  const groups = groupByLogin(rows);
  const buckets = new Map<ActionCategory, ActionGroup>();
  for (const g of groups) {
    if (g.effectiveCategory === 'healthy') continue;
    let b = buckets.get(g.effectiveCategory);
    if (!b) {
      b = {
        category: g.effectiveCategory,
        affectedGroups: [],
        affectedGatewayCount: 0,
        affectedClientIds: new Set(),
      };
      buckets.set(g.effectiveCategory, b);
    }
    b.affectedGroups.push(g);
    b.affectedGatewayCount += g.members.length;
    b.affectedClientIds.add(g.client_id);
  }
  return Array.from(buckets.values()).sort((a, b) => {
    // Primary sort: severity desc
    const sd = ACTION_SEVERITY[b.category] - ACTION_SEVERITY[a.category];
    if (sd !== 0) return sd;
    // Tie-break: more gateways affected wins (higher leverage)
    return b.affectedGatewayCount - a.affectedGatewayCount;
  });
}

// ============================================================================
// Per-processor reliability scoreboard
// ============================================================================
export type ProcessorReliability = {
  processor: string;
  enabledGateways: number;
  healthyNow: number;
  failingNow: number;
  uptimePct: number;          // 0..100
  recentSparkline: ('success' | 'no_data' | 'failed' | null)[]; // last ~21 outcomes
  topErrorCategory: string | null;
  rowsLoaded24h: number;
};

/**
 * Build a reliability score per processor across all clients.
 *
 * The 7-day uptime is computed at the LOGIN-GROUP level: an invocation is
 * "healthy" if its latest status in the 7-day window was success or no_data.
 * Successful and no-data outcomes both count as "uptime" because both mean
 * the scraper completed cleanly.
 */
export function computeProcessorReliability(rows: ScraperRow[]): ProcessorReliability[] {
  const groups = groupByLogin(rows);
  type Bucket = ProcessorReliability & {
    successOrNoData: number;
    totalSlots: number;
    rawSpark: ('success' | 'no_data' | 'failed' | null)[];
    errorCounts: Map<string, number>;
  };
  const map = new Map<string, Bucket>();
  for (const g of groups) {
    // Use the same normalization as group-by so we don't get duplicate
    // 'cliq' / 'cliq payments' rows in the scoreboard.
    const proc = normalizedProcessor(g.primary);
    let b = map.get(proc);
    if (!b) {
      b = {
        processor: proc,
        enabledGateways: 0,
        healthyNow: 0,
        failingNow: 0,
        uptimePct: 0,
        recentSparkline: [],
        topErrorCategory: null,
        rowsLoaded24h: 0,
        successOrNoData: 0,
        totalSlots: 0,
        rawSpark: [],
        errorCounts: new Map(),
      };
      map.set(proc, b);
    }
    b.enabledGateways += g.members.length;
    if (g.primary.e2e_status === 'healthy') b.healthyNow += g.members.length;
    if (g.primary.last_status === 'failed') b.failingNow += g.members.length;
    // Use the primary's pattern_7d as the group's recent slots
    for (const slot of g.primary.pattern_7d) {
      b.rawSpark.push(slot);
      b.totalSlots += 1;
      if (slot === 'success' || slot === 'no_data') b.successOrNoData += 1;
    }
    if (g.primary.last_status === 'failed') {
      const cat = classifyFailure(g.primary.last_status, g.primary.last_error) ?? 'other';
      b.errorCounts.set(cat, (b.errorCounts.get(cat) ?? 0) + 1);
    }
    for (const m of g.members) {
      b.rowsLoaded24h += m.rows_loaded_last_24h;
    }
  }
  return Array.from(map.values())
    .map((b) => {
      // Top error category
      let top: string | null = null;
      let topN = 0;
      for (const [k, n] of Array.from(b.errorCounts.entries())) {
        if (n > topN) { topN = n; top = k; }
      }
      const uptimePct = b.totalSlots > 0
        ? Math.round((b.successOrNoData / b.totalSlots) * 100)
        : 0;
      return {
        processor: b.processor,
        enabledGateways: b.enabledGateways,
        healthyNow: b.healthyNow,
        failingNow: b.failingNow,
        uptimePct,
        recentSparkline: b.rawSpark.slice(0, 21),  // cap so the strip doesn't get huge
        topErrorCategory: top,
        rowsLoaded24h: b.rowsLoaded24h,
      };
    })
    .sort((a, b) => {
      // Worst-first: lowest uptime, then most-failing
      if (a.uptimePct !== b.uptimePct) return a.uptimePct - b.uptimePct;
      return b.failingNow - a.failingNow;
    });
}

// ============================================================================
// In-progress markers (localStorage-backed; no DB writes)
// ============================================================================
const LS_KEY = 'cb.reliability.in_progress';

export function loadInProgress(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function saveInProgress(set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage might be disabled in some browser contexts; ignore.
  }
}

export function loginGroupKey(g: LoginGroup): string {
  // Use the same normalization as the grouping itself so the keys round-trip.
  return `${g.client_id}|${normalizedProcessor(g.primary)}|${g.portal_username ?? '__no_user__'}`;
}
