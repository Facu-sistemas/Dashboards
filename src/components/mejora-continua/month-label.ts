const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "YYYY-MM" -> "sep 2026", sin pasar por Date/Intl (mismo motivo que gerencia/format.ts: evitar mismatches de hidratación SSR/cliente). */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  return `${MESES[Number(month) - 1]} ${year}`;
}
