/**
 * Planificado Línea — hechos físicos y reglas por defecto que Odoo no
 * conoce. Lo único que vive en Supabase es lo que el usuario cambia desde
 * la pantalla (mesa activa/inactiva y reglas por familia de TAP, ver
 * supabase/linea-config.ts); todo lo de acá es el punto de partida.
 *
 * Compartido entre server (cálculo del plan) y cliente (plano de mesas y
 * editor de reglas) — no importar nada server-only desde acá.
 */

export type SectorMesa = 'resorte' | 'espuma';

export interface MesaDef {
  codigo: string;
  nombre: string;
  sector: SectorMesa;
  forma: 'rect' | 'circulo';
  /** Posición en el plano (viewBox 0 0 940 620), calcada del croquis del usuario. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MESAS: MesaDef[] = [
  { codigo: 'M1', nombre: 'M1', sector: 'resorte', forma: 'rect', x: 87, y: 100, w: 63, h: 62 },
  { codigo: 'M2', nombre: 'M2', sector: 'resorte', forma: 'rect', x: 87, y: 195, w: 63, h: 62 },
  { codigo: 'COSTURA', nombre: 'Costurero', sector: 'resorte', forma: 'rect', x: 87, y: 286, w: 63, h: 62 },
  { codigo: 'EMBOLSADO', nombre: 'Embolsadora', sector: 'resorte', forma: 'rect', x: 87, y: 372, w: 63, h: 62 },
  { codigo: 'P1', nombre: 'P1', sector: 'espuma', forma: 'circulo', x: 494, y: 110, w: 68, h: 64 },
  { codigo: 'P2', nombre: 'P2', sector: 'espuma', forma: 'circulo', x: 616, y: 106, w: 68, h: 64 },
  { codigo: 'P3', nombre: 'P3', sector: 'espuma', forma: 'circulo', x: 736, y: 103, w: 68, h: 64 },
  { codigo: 'C1', nombre: 'C1', sector: 'espuma', forma: 'rect', x: 378, y: 292, w: 62, h: 57 },
  { codigo: 'C2', nombre: 'C2', sector: 'espuma', forma: 'rect', x: 488, y: 292, w: 62, h: 57 },
  { codigo: 'C3', nombre: 'C3', sector: 'espuma', forma: 'rect', x: 616, y: 292, w: 62, h: 57 },
  { codigo: 'C4', nombre: 'C4', sector: 'espuma', forma: 'rect', x: 738, y: 292, w: 62, h: 57 },
  { codigo: 'EMBALADORA', nombre: 'Embaladora', sector: 'espuma', forma: 'rect', x: 750, y: 447, w: 80, h: 93 },
];

export const MESA_CODIGOS = MESAS.map((m) => m.codigo);

/** Jornada: arranca 06:00, 488 minutos de trabajo efectivo, desayuno 09:00–09:10 (no cuenta como trabajo). */
export const JORNADA = {
  inicioMin: 6 * 60,
  capacidadMin: 488,
  pausaDesdeMin: 9 * 60,
  pausaDuracionMin: 10,
} as const;

/** Minutos de trabajo transcurridos cuando arranca el desayuno (06:00 → 09:00). */
export const PAUSA_EN_TRABAJO_MIN = JORNADA.pausaDesdeMin - JORNADA.inicioMin;

/**
 * - paralelo: el tiempo total se reparte en partes iguales entre las mesas (Bases).
 * - serie: el circuito completo ocupa todas sus mesas a la vez durante el tiempo total (Pocket, Magnum).
 * - excluido: no se planifica en esta línea (TAP-E*, van por Espuma).
 */
export type ModoTap = 'paralelo' | 'serie' | 'excluido';

export interface ReglaTap {
  /** Familia exacta (ej. "TAP-BASE OLIMPO") o prefijo genérico (ej. "TAP-BASE"). */
  familia: string;
  modo: ModoTap;
  mesas: string[];
  /** Menor número = se planifica antes. */
  prioridad: number;
}

const CIRCUITO_SERIE = ['M1', 'M2', 'COSTURA', 'EMBOLSADO'];

/**
 * Punto de partida acordado con el usuario: las Bases primero (comprometen
 * solo 2 mesas) y después Pocket/Magnum en serie por las 4. TAP-R queda sin
 * regla a propósito — aparece como "sin regla" hasta que se le asigne una.
 */
export const REGLAS_DEFAULT: ReglaTap[] = [
  { familia: 'TAP-BASE', modo: 'paralelo', mesas: ['M1', 'M2'], prioridad: 1 },
  { familia: 'TAP-PO', modo: 'serie', mesas: CIRCUITO_SERIE, prioridad: 2 },
  { familia: 'TAP-TMAGN', modo: 'serie', mesas: CIRCUITO_SERIE, prioridad: 2 },
  { familia: 'TAP-E', modo: 'excluido', mesas: [], prioridad: 9 },
];

/** Odoo's many2one label is `[referencia interna] Nombre` — se saca el prefijo. */
export function stripReferencePrefix(display: string): string {
  const m = display.match(/^\[[^\]]*\]\s*(.*)$/);
  return m ? m[1]! : display;
}

/**
 * Familia de un TAP, sacando la medida:
 * "TAP-BASE OLIMPO 140X190" → "TAP-BASE OLIMPO",
 * "TAP-POSURE10019028E" → "TAP-POSURE",
 * "TAP-TMAGN-VIGGO14019028E" → "TAP-TMAGN-VIGGO".
 */
export function familiaDeProducto(nombreProducto: string): string {
  const n = stripReferencePrefix(nombreProducto).toUpperCase().trim();
  const sinMedida = n.replace(/\s+\d+\s*X\s*\d+.*$/, '');
  return sinMedida.replace(/\d.*$/, '').replace(/[-\s]+$/, '') || n;
}

/**
 * Reglas efectivas: las guardadas por el usuario pisan a las default con la
 * misma clave. Gana la clave más larga que matchee (familia exacta > prefijo),
 * así "TAP-BASE OLIMPO" puede tener su propia regla sin tocar al resto de las Bases.
 */
export function mergeReglas(guardadas: ReglaTap[]): ReglaTap[] {
  const byKey = new Map(REGLAS_DEFAULT.map((r) => [r.familia, r]));
  for (const r of guardadas) byKey.set(r.familia, r);
  return [...byKey.values()];
}

export function resolverRegla(familia: string, reglas: ReglaTap[]): ReglaTap | null {
  let best: ReglaTap | null = null;
  for (const r of reglas) {
    if (familia === r.familia || familia.startsWith(r.familia)) {
      if (!best || r.familia.length > best.familia.length) best = r;
    }
  }
  return best;
}

/** Minuto de trabajo (0..capacidad) → minuto de reloj, salteando el desayuno. `esFin` define de qué lado del corte cae un tramo que termina justo a las 09:00. */
export function relojDesdeTrabajo(trabajoMin: number, esFin: boolean): number {
  const despuesDePausa = esFin ? trabajoMin > PAUSA_EN_TRABAJO_MIN : trabajoMin >= PAUSA_EN_TRABAJO_MIN;
  return JORNADA.inicioMin + trabajoMin + (despuesDePausa ? JORNADA.pausaDuracionMin : 0);
}

export function formatHora(relojMin: number): string {
  const total = Math.round(relojMin);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
