export const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const int = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
export const dec = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' });
export function monthShort(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const label = monthFmt.format(new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1))).replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Cantidades: enteras si son grandes, con decimales si son chicas (consumos por unidad, kilos, etc.). */
export function qty(n: number): string {
  return Math.abs(n) >= 100 ? int.format(n) : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n);
}
