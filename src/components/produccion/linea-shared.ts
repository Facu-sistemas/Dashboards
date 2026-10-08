import type { ReglaTap } from '../../lib/linea-config';
import type { FamiliaDetectada } from '../../lib/odoo/linea-resorte';
import type { OrigenLinea } from '../../lib/linea-calc';

export interface ConfigLineaDto {
  disponible: boolean;
  mesasInactivas: string[];
  reglas: ReglaTap[];
  reglasDefault: ReglaTap[];
  familias: FamiliaDetectada[];
}

export async function postConfigLinea(body: unknown): Promise<void> {
  const res = await fetch('/api/linea-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'No se pudo guardar');
  }
}

// Clases completas (no armadas en runtime) para que el JIT de Tailwind las genere.
const PALETA = [
  'bg-sky-500/70 border-sky-300/60',
  'bg-amber-500/70 border-amber-300/60',
  'bg-emerald-500/70 border-emerald-300/60',
  'bg-violet-500/70 border-violet-300/60',
  'bg-rose-500/70 border-rose-300/60',
  'bg-teal-500/70 border-teal-300/60',
  'bg-orange-500/70 border-orange-300/60',
  'bg-indigo-500/70 border-indigo-300/60',
  'bg-lime-500/70 border-lime-300/60',
  'bg-fuchsia-500/70 border-fuchsia-300/60',
];

/** Color estable por familia (mismo TAP = mismo color en todas las mesas). */
export function colorFamilia(familia: string): string {
  let h = 0;
  for (const ch of familia) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length]!;
}

export const MODO_LABEL: Record<string, string> = {
  paralelo: 'Paralelo (se reparte)',
  serie: 'Serie (circuito completo)',
  excluido: 'No se trabaja en la línea',
};

export const ORIGEN_LABEL: Record<OrigenLinea, string> = {
  atrasado: 'atrasado',
  dia: 'del día',
  adelantado: 'adelantado',
};

/** Borde de la barra según origen: atrasado punteado largo, adelantado punteado corto. */
export const ORIGEN_BORDE: Record<OrigenLinea, string> = {
  atrasado: 'border-dashed',
  dia: '',
  adelantado: 'border-dotted',
};

/** Cantidad de una orden partida entre días: "≈12 de 33". */
export function formatCantidad(cantidad: number, fraccion: number): string {
  return fraccion < 0.999 ? `≈${Math.max(1, Math.round(cantidad * fraccion))} de ${cantidad}` : `${cantidad}`;
}

/** Ocupación de la jornada por mesa activa con trabajo, ej. "M1 100% · Costurero 76%". */
export function formatOcupacion(mesas: { nombre: string; activa: boolean; ocupadoMin: number }[], capacidadMin: number): string {
  return mesas
    .filter((m) => m.activa)
    .map((m) => `${m.nombre} ${Math.round((m.ocupadoMin / capacidadMin) * 100)}%`)
    .join(' · ');
}

/** Unidades de un tramo; pueden ser fraccionarias (paralelo, partido por el desayuno): "≈6 u" / "12 u". */
export function formatUnidades(unidades: number): string {
  const r = Math.round(unidades);
  return `${Math.abs(unidades - r) < 0.05 ? '' : '≈'}${Math.max(unidades > 0 ? 1 : 0, r)} u`;
}

/** Nombre corto de lo que se hace en un tramo/item: "BASE NEGRO 140 x 190". */
export function etiquetaTap(familia: string, medida: string): string {
  return `${familia.replace(/^TAP-/, '')}${medida ? ` ${medida.replace('X', ' x ')}` : ''}`;
}

export function formatMin(min: number): string {
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
