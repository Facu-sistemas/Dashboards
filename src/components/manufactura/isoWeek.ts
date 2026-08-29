/** ISO-8601 week helpers for the `<input type="week">` picker — converts between a
 * plain anchor date ("YYYY-MM-DD") and the native input's "YYYY-Www" value. */

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO week-year and week number (1-53) for a given anchor date. */
export function isoWeekOf(dateIso: string): { isoYear: number; isoWeek: number } {
  const [y, m, d] = dateIso.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // Thursday of the same ISO week
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { isoYear, isoWeek };
}

/** `<input type="week">` value ("YYYY-Www") for a given anchor date. */
export function dateToWeekValue(dateIso: string): string {
  const { isoYear, isoWeek } = isoWeekOf(dateIso);
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

/** Monday ("YYYY-MM-DD") of the ISO week encoded in a `<input type="week">` value. */
export function weekValueToDate(weekValue: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekValue);
  if (!match) return weekValue;
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  // Jan 4th always falls in ISO week 1 — anchor off it, then step by whole weeks.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = jan4.getUTCDay() || 7;
  const week1Monday = new Date(Date.UTC(isoYear, 0, 4 - jan4DayNum + 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return toIsoDate(monday);
}
