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
