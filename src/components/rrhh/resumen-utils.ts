import type { EmpleadoVacacionesRow } from '@/lib/odoo/rrhh-vacaciones';

/**
 * Paleta por convenio. Cada entrada son clases Tailwind completas (no armadas
 * en runtime) para que el JIT las detecte, mismo criterio que ACCENT_CLASSES.
 */
export const CONVENIO_PALETTE = [
  { chip: 'bg-sky-500/10 text-sky-400', bar: 'bg-sky-500', avatar: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  { chip: 'bg-violet-500/10 text-violet-400', bar: 'bg-violet-500', avatar: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' },
  { chip: 'bg-amber-500/10 text-amber-400', bar: 'bg-amber-500', avatar: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  { chip: 'bg-teal-500/10 text-teal-400', bar: 'bg-teal-500', avatar: 'bg-teal-500/15 text-teal-300 ring-teal-500/30' },
  { chip: 'bg-pink-500/10 text-pink-400', bar: 'bg-pink-500', avatar: 'bg-pink-500/15 text-pink-300 ring-pink-500/30' },
  { chip: 'bg-orange-500/10 text-orange-400', bar: 'bg-orange-500', avatar: 'bg-orange-500/15 text-orange-300 ring-orange-500/30' },
] as const;

export const SIN_CONVENIO = 'Sin convenio';

export function convenioDe(row: EmpleadoVacacionesRow): string {
  return row.categoriaConvenio ?? SIN_CONVENIO;
}

/** Mapa convenio -> color, estable según el orden alfabético de los convenios presentes. */
export function buildConvenioColors(rows: EmpleadoVacacionesRow[]): Map<string, (typeof CONVENIO_PALETTE)[number]> {
  const names = [...new Set(rows.map(convenioDe))].sort((a, b) => a.localeCompare(b, 'es'));
  return new Map(names.map((n, i) => [n, CONVENIO_PALETTE[i % CONVENIO_PALETTE.length]!]));
}

export function iniciales(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** Horas que debería haber cargado en lo que va del mes según su jornada; null si no hay jornada. */
export function horasEsperadasMes(row: EmpleadoVacacionesRow): number | null {
  return row.horasEsperadasMes;
}

/** Cumplimiento 0..n (1 = 100%) de las horas cargadas contra las esperadas; null si no se puede calcular. */
export function cumplimiento(row: EmpleadoVacacionesRow): number | null {
  const esperadas = horasEsperadasMes(row);
  if (!esperadas) return null;
  return row.horasCargadasMes / esperadas;
}

export function cumplimientoColor(ratio: number): { stroke: string; text: string } {
  if (ratio >= 0.9) return { stroke: 'stroke-emerald-500', text: 'text-emerald-400' };
  if (ratio >= 0.6) return { stroke: 'stroke-amber-500', text: 'text-amber-400' };
  return { stroke: 'stroke-rose-500', text: 'text-rose-400' };
}

export interface ConvenioResumen {
  nombre: string;
  empleados: number;
  bancoTotal: number;
  horasMesPromedio: number;
}

export function resumirPorConvenio(rows: EmpleadoVacacionesRow[]): ConvenioResumen[] {
  const map = new Map<string, { n: number; banco: number; horas: number }>();
  for (const r of rows) {
    const key = convenioDe(r);
    const acc = map.get(key) ?? { n: 0, banco: 0, horas: 0 };
    acc.n += 1;
    acc.banco += r.bancoHorasSaldo;
    acc.horas += r.horasCargadasMes;
    map.set(key, acc);
  }
  return [...map.entries()]
    .map(([nombre, a]) => ({
      nombre,
      empleados: a.n,
      bancoTotal: Math.round(a.banco * 10) / 10,
      horasMesPromedio: Math.round((a.horas / a.n) * 10) / 10,
    }))
    .sort((a, b) => b.empleados - a.empleados);
}
