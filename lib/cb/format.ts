/**
 * Display helpers for the Chargeback Reporting dashboard.
 * All times are presented in Asia/Kolkata (IST).
 */

const IST = 'Asia/Kolkata';

/** "04 May 2026, 14:30" — full IST date+time. */
export function formatIst(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "14:30 IST" — IST time only (compact). */
export function formatIstTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    d.toLocaleTimeString('en-IN', {
      timeZone: IST,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' IST'
  );
}

/** "04 May" — IST short date for axis labels. */
export function formatIstDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
  });
}

/** "5 hr ago" / "12 min ago" / "2 days ago". Honest about clock skew (~1m floor). */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffSec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
}

/**
 * Coerce arbitrary input to a finite number. Returns null for anything that
 * isn't safely representable (null, undefined, NaN, Infinity, malformed string).
 * The pg driver returns NUMERIC columns as strings, so any code that does math
 * or calls .toFixed() on a DB value MUST go through this guard first.
 */
export function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compact 1.2k / 3.5M number formatting. */
export function formatCompact(n: number | string | null | undefined): string {
  const v = toFiniteNumber(n);
  if (v === null) return '—';
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

/** Plain integer with thousand separators (Indian grouping). */
export function formatInt(n: number | string | null | undefined): string {
  const v = toFiniteNumber(n);
  if (v === null) return '—';
  return new Intl.NumberFormat('en-IN').format(v);
}

/**
 * Safely format a duration in seconds.
 *  - null / undefined / non-finite → '—'
 *  - < 60s → "53s"
 *  - >= 60s → "1m 33s"  (drops seconds when zero: "5m")
 */
export function formatSeconds(n: number | string | null | undefined): string {
  const v = toFiniteNumber(n);
  if (v === null || v <= 0) return '—';
  if (v < 60) return `${v.toFixed(0)}s`;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
