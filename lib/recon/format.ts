/**
 * Display helpers. All wall-clock times are shown in IST (Asia/Kolkata).
 */
const IST = 'Asia/Kolkata';

export function formatIst(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: IST, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatIstTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', {
    timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' IST';
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const day = Math.floor(h / 24);
  return day === 1 ? '1 day ago' : `${day} days ago`;
}

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

export function formatInt(n: number | string | null | undefined): string {
  const v = toFiniteNumber(n);
  if (v === null) return '—';
  return new Intl.NumberFormat('en-IN').format(v);
}

export function formatSeconds(n: number | string | null | undefined): string {
  const v = toFiniteNumber(n);
  if (v === null || v <= 0) return '—';
  if (v < 60) return `${v.toFixed(0)}s`;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
