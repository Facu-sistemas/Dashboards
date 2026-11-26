/**
 * Reglas de horas extra de un día, compartidas por el servidor (bandeja de novedades, historial) y las pantallas. Sin
 * imports de servidor: lo usan los cálculos de odoo/rrhh-novedades.ts (que lo reexporta) y los componentes de RRHH.
 */

/** Jornada que se ficha: de 6:00 a 14:18. Se computan 8,80 hs porque la media hora de descanso se paga (ver odoo/rrhh-quincena.ts). */
export const JORNADA_FICHADA_HS = 8.3;
/** Cierre del turno (hora argentina): las horas extra se cuentan desde acá. Venir antes de las 6:00 no suma. */
export const CIERRE_TURNO = '14:18';
/**
 * Las horas de más se marcan desde 30 min (a las 14:48 ya hay 30 min), ya redondeadas al cuarto de hora: quien sobra 29 min
 * cuenta como 30 (la pantalla muestra el tiempo exacto entre paréntesis). Lo pidió RRHH (Juan): umbral de 30 min (antes era 1 h).
 */
export const TOLERANCIA_EXTRA_HS = 0.5;

const OFFSET_ARG_MS = 3 * 3_600_000;

/** "HH:MM" (hora argentina) o datetime de Odoo en UTC ("YYYY-MM-DD HH:MM:SS") -> horas decimales desde la medianoche argentina. */
function horaDelDiaHs(salida: string): number {
  if (/^\d{1,2}:\d{2}$/.test(salida)) {
    const [h, m] = salida.split(':').map(Number) as [number, number];
    return h + m / 60;
  }
  const ms = Date.parse(`${salida.replace(' ', 'T')}Z`) - OFFSET_ARG_MS;
  if (!Number.isFinite(ms)) return Number.NaN;
  const d = new Date(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/**
 * Horas extra del día sin redondear: el mínimo entre (a) lo que se quedó después del cierre del turno (salida final − 14:18) y
 * (b) lo que fichó de más sobre la jornada (fichado − 8,3 hs). Nunca negativo.
 *  - Por (a), llegar antes de las 6:00 no suma (05:37–15:20 → 1 h 2 min, no 1 h 25 min).
 *  - Por (b), quien llegó tarde no cobra extra por "compensar" quedándose después (07:00–15:20 → 0).
 * `salida` es la última salida cerrada del día: "HH:MM" en hora argentina o el datetime UTC de Odoo. Sin salida solo cuenta (b).
 */
export function horasExtraCrudasHs(fichadoHs: number, salida?: string | null | false): number {
  const sobreJornada = fichadoHs - JORNADA_FICHADA_HS;
  const despuesDelCierre = salida ? horaDelDiaHs(salida) - horaDelDiaHs(CIERRE_TURNO) : Number.NaN;
  const extra = Number.isNaN(despuesDelCierre) ? sobreJornada : Math.min(sobreJornada, despuesDelCierre);
  return extra > 0 ? extra : 0;
}

/** Horas extra del día redondeadas al cuarto de hora más cercano; 0 si no llegan al mínimo para marcarse. Ver `horasExtraCrudasHs`. */
export function extraRedondeadaHs(fichadoHs: number, salida?: string | null | false): number {
  const redondeada = Math.round(horasExtraCrudasHs(fichadoHs, salida) * 4) / 4;
  return redondeada >= TOLERANCIA_EXTRA_HS ? redondeada : 0;
}
