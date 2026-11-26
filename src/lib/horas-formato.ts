/**
 * Formato de cantidades de horas para mostrarle al empleado.
 * Odoo y los cálculos trabajan con horas decimales (0,73 h), pero leído así parece "73 minutos":
 * acá se pasa a horas y minutos (base 60) solo para mostrar. No cambia ningún valor.
 */

/** Signo menos tipográfico (U+2212), se lee mejor que el guion. */
const MENOS = '\u2212';

/**
 * Horas decimales → "1 h 5 min", "44 min", "14 h", "0 min"; negativos con signo: "−2 h 30 min".
 * Redondea al minuto más cercano (0,999 → "1 h", nunca "0 h 60 min").
 */
export function horasMinTxt(hs: number): string {
  if (!Number.isFinite(hs)) return '—';
  const totalMin = Math.round(Math.abs(hs) * 60);
  if (totalMin === 0) return '0 min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const txt = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  return hs < 0 ? `${MENOS}${txt}` : txt;
}
