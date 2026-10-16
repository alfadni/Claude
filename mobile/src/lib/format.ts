const DAY_MS = 86_400_000;

/** Daily closes older than this many days mean the feed has stopped updating. */
export const STALE_AFTER_DAYS = 2;

export function formatUsd(v: number): string {
  // Sub-dollar prices need more precision to be meaningful.
  const digits = v < 1 ? 4 : v < 100 ? 3 : 2;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatPct(v: number, signed = false): string {
  const s = `${Math.abs(v) < 0.05 ? '0.0' : Math.abs(v).toFixed(1)}%`;
  if (!signed || s === '0.0%') return s;
  return v > 0 ? `+${s}` : `−${s}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-15" -> "15 Oct 2026" (no locale/timezone dependence). */
export function formatDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

/** Whole calendar days (UTC) from an ISO date to now. */
export function ageInDays(isoDate: string, now: Date = new Date()): number {
  const then = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - then) / DAY_MS);
}

export function formatAge(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
