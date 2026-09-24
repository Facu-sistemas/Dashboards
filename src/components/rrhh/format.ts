const plainNumber = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export function formatDias(v: number): string {
  return plainNumber.format(v);
}

export function formatHoras(v: number): string {
  return `${plainNumber.format(v)} hs`;
}

export function formatWage(v: number): string {
  return currency.format(v);
}

/** "YYYY-MM-DD" -> "DD/MM/AAAA", sin pasar por Date/Intl (evita diferencias SSR/cliente, mismo criterio que el resto del dashboard). */
export function formatFechaIso(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** "YYYY-MM-DD HH:mm:ss" (como vienen los Datetime de Odoo) -> "DD/MM/AAAA". */
export function formatFechaHora(datetime: string): string {
  return formatFechaIso(datetime.slice(0, 10));
}

/** Antigüedad en años y meses a partir de una fecha de ingreso ISO, calculada contra `today` (ISO, calculado en el servidor) para no depender de la zona horaria del navegador. */
export function formatAntiguedad(fechaIngresoIso: string | null, todayIso: string): string {
  if (!fechaIngresoIso) return '—';
  const [iy, im] = fechaIngresoIso.split('-').map(Number);
  const [ty, tm] = todayIso.split('-').map(Number);
  let months = (ty! - iy!) * 12 + (tm! - im!);
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0) return `${remMonths} m`;
  if (remMonths === 0) return `${years} a`;
  return `${years} a ${remMonths} m`;
}
