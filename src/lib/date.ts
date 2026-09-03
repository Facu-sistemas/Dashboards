/** Start (inclusive) and end (exclusive) ISO dates for a "YYYY-MM" month key. */
export function monthBounds(monthKey: string): { start: string; endExclusive: string } {
  const parts = monthKey.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

/** Current month as a "YYYY-MM" key (UTC). */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every "YYYY-MM" key from `startMonth` to `endMonth`, inclusive, oldest first. */
export function monthsBetween(startMonth: string, endMonth: string): string[] {
  const [sy, sm] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  const months: string[] = [];
  let y = sy!;
  let m = sm!;
  while (y < ey! || (y === ey! && m <= em!)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/** Last `count` month keys ("YYYY-MM"), oldest first, ending at the given month (default: current). */
export function lastMonthKeys(count: number, endingAt?: Date): string[] {
  const base = endingAt ?? new Date();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIsoDate(new Date(Date.UTC(y!, m! - 1, d! + days)));
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

/** Start (inclusive) / end (exclusive) ISO dates for a day, ISO week (Mon-Sun), month, or year around an anchor date (plain "YYYY-MM-DD", no timezone math needed). */
export function periodBounds(kind: PeriodKind, anchorIso: string): { start: string; endExclusive: string } {
  if (kind === 'day') {
    return { start: anchorIso, endExclusive: addDaysIso(anchorIso, 1) };
  }
  if (kind === 'week') {
    const [y, m, d] = anchorIso.split('-').map(Number);
    const anchor = new Date(Date.UTC(y!, m! - 1, d!));
    const dayOfWeek = anchor.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (dayOfWeek + 6) % 7;
    const mondayIso = toIsoDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - diffToMonday)));
    return { start: mondayIso, endExclusive: addDaysIso(mondayIso, 7) };
  }
  if (kind === 'year') {
    const year = Number(anchorIso.slice(0, 4));
    return { start: `${year}-01-01`, endExclusive: `${year + 1}-01-01` };
  }
  return monthBounds(anchorIso.slice(0, 7));
}

/** Shared "period" preset shape reused by every dashboard that offers a date-range filter (Top Productos, Pareto Clientes, ...). */
export type DateRangePreset = 'all' | 'this-year' | 'last-12-months' | 'last-6-months';

/** Lower bound (inclusive) for a preset, or null for 'all' (no date filter at all). No upper bound is needed — there's never future-dated data. */
export function rangePresetStartDate(preset: DateRangePreset): string | null {
  switch (preset) {
    case 'all':
      return null;
    case 'this-year':
      return `${new Date().getUTCFullYear()}-01-01`;
    case 'last-12-months':
      return monthBounds(lastMonthKeys(12)[0]!).start;
    case 'last-6-months':
      return monthBounds(lastMonthKeys(6)[0]!).start;
  }
}
