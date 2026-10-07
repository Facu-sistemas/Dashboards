import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { addDaysIso, periodBounds, type PeriodKind } from '../date';
import { COLCHONES_CATEG_IDS, getArgentinaTodayIso } from './oee';

export type DetalleFamilia = 'living' | 'colchones';

/**
 * Cumplimiento por línea para la pestaña "Más Detalles" del Plan de Producción.
 * Misma lógica que el gauge principal (plan-produccion.ts) pero SIN objetivo:
 * cumplimiento = producido (planificado y cerrado el mismo día) / planificado
 * hasta hoy. Se devuelven los acumulados crudos por día para que el cliente
 * pueda reagrupar por día/semana/mes sin perder exactitud (el % se recalcula
 * sobre las sumas, no se promedia).
 *
 * Series (`key`):
 *  - Living: `lean` (categ 3,16), `tradicional` (categ 2,4 SIN el herraje),
 *    `herraje-j` (HERRAJE UNION "J" SUMA, aparte) y una serie por cada valor de
 *    `x_studio_linea` dentro de cada rama (`lean:1`, `tradicional:T2`, ...).
 *  - Colchones: `colchones` (total), `E` (espuma), `B` (base) y `sin-linea`
 *    mientras planificación no cargue `x_studio_linea` en todas las órdenes.
 */
const LEAN_CATEG_IDS = [3, 16];
const TRADICIONAL_CATEG_IDS = [2, 4];
const HERRAJE_J_RE = /HERRAJE UNION\s*"?J"?/i;

export interface DetalleCounts {
  planificado: number;
  planificadoAHoy: number;
  producido: number;
  cerrado: number;
}

export interface DetalleSerie {
  key: string;
  label: string;
  /** Rama principal o total (se muestra primero) vs. línea individual. */
  tipo: 'total' | 'linea';
}

export interface PlanProduccionDetalleResult {
  familia: DetalleFamilia;
  unit: 'UE' | 'u';
  period: { kind: PeriodKind; date: string; start: string; endExclusive: string };
  series: DetalleSerie[];
  /** Un registro por día del período; `values` solo trae las series con movimiento ese día. */
  days: { date: string; values: Record<string, DetalleCounts> }[];
}

type Row = {
  planning_date: string;
  date_finished: string | false;
  state: string;
  product_qty: number;
  x_studio_unidades_eq: number;
  x_studio_linea: string | false;
  product_id: [number, string];
};

function emptyCounts(): DetalleCounts {
  return { planificado: 0, planificadoAHoy: 0, producido: 0, cerrado: 0 };
}

function lineaLabel(raw: string | false): string {
  return (raw || '').toString().trim();
}

/** Colchones: la línea nueva es "E" (espuma) y "B" (base); se aceptan las variantes ya cargadas ("ESPUMA", "BASES"). */
function colchonesLinea(raw: string | false): 'E' | 'B' | 'sin-linea' {
  const v = lineaLabel(raw).toUpperCase();
  if (v === 'E' || v === 'ESPUMA') return 'E';
  if (v === 'B' || v === 'BASE' || v === 'BASES') return 'B';
  return 'sin-linea';
}

async function fetchRows(domainExtra: unknown[], companyId: number, start: string, endExclusive: string): Promise<Row[]> {
  return searchReadAll<Row>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ...domainExtra,
      ['planning_date', '>=', start],
      ['planning_date', '<', endExclusive],
    ] as never,
    fields: ['planning_date', 'date_finished', 'state', 'product_qty', 'x_studio_unidades_eq', 'x_studio_linea', 'product_id'],
  });
}

/** Cerradas en el período aunque se hayan planificado antes (o sin fecha dentro del período). */
async function fetchClosedRows(domainExtra: unknown[], companyId: number, start: string, endExclusive: string): Promise<Row[]> {
  return searchReadAll<Row>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['company_id', '=', companyId],
      ...domainExtra,
      ['date_finished', '>=', start],
      ['date_finished', '<', endExclusive],
    ] as never,
    fields: ['planning_date', 'date_finished', 'state', 'product_qty', 'x_studio_unidades_eq', 'x_studio_linea', 'product_id'],
  });
}

/** Series a las que aporta una orden de Living (rama + línea individual). */
function livingKeys(row: Row, rama: 'lean' | 'tradicional'): string[] {
  if (rama === 'tradicional' && HERRAJE_J_RE.test(row.product_id[1])) return ['herraje-j'];
  const linea = lineaLabel(row.x_studio_linea);
  return [rama, `${rama}:${linea || 'sin-linea'}`];
}

export async function getPlanProduccionDetalle(
  familia: DetalleFamilia,
  periodKind: PeriodKind,
  anchorIso: string
): Promise<PlanProduccionDetalleResult> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = periodBounds(periodKind, anchorIso);
  const today = getArgentinaTodayIso();

  const unit = familia === 'living' ? 'UE' : 'u';
  const valueOf = (r: Row) => (familia === 'living' ? r.x_studio_unidades_eq : r.product_qty) || 0;

  // El herraje no tiene unidades equivalentes (viene en 0): se mide en piezas.
  const valueOfKey = (r: Row, key: string) => (key === 'herraje-j' ? r.product_qty || 0 : valueOf(r));

  type Source = { rows: Row[]; closed: Row[]; keysOf: (r: Row) => string[] };
  const sources: Source[] = [];

  if (familia === 'living') {
    const [leanP, leanC, tradP, tradC] = await Promise.all([
      fetchRows([['product_id.categ_id', 'in', LEAN_CATEG_IDS]], companyId, start, endExclusive),
      fetchClosedRows([['product_id.categ_id', 'in', LEAN_CATEG_IDS]], companyId, start, endExclusive),
      fetchRows([['product_id.categ_id', 'in', TRADICIONAL_CATEG_IDS]], companyId, start, endExclusive),
      fetchClosedRows([['product_id.categ_id', 'in', TRADICIONAL_CATEG_IDS]], companyId, start, endExclusive),
    ]);
    sources.push({ rows: leanP, closed: leanC, keysOf: (r) => livingKeys(r, 'lean') });
    sources.push({ rows: tradP, closed: tradC, keysOf: (r) => livingKeys(r, 'tradicional') });
  } else {
    const [p, c] = await Promise.all([
      fetchRows([['product_id.categ_id', 'in', COLCHONES_CATEG_IDS]], companyId, start, endExclusive),
      fetchClosedRows([['product_id.categ_id', 'in', COLCHONES_CATEG_IDS]], companyId, start, endExclusive),
    ]);
    sources.push({ rows: p, closed: c, keysOf: (r) => ['colchones', colchonesLinea(r.x_studio_linea)] });
  }

  const byDay = new Map<string, Record<string, DetalleCounts>>();
  const seen = new Set<string>();
  const counts = (day: string, key: string): DetalleCounts => {
    seen.add(key);
    let values = byDay.get(day);
    if (!values) byDay.set(day, (values = {}));
    return (values[key] ??= emptyCounts());
  };

  for (const { rows, closed, keysOf } of sources) {
    for (const r of rows) {
      const day = r.planning_date.slice(0, 10);
      const sameDay = r.state === 'done' && r.date_finished && r.date_finished.slice(0, 10) === day;
      for (const key of keysOf(r)) {
        const val = valueOfKey(r, key);
        const c = counts(day, key);
        c.planificado += val;
        if (day <= today) c.planificadoAHoy += val;
        if (sameDay) c.producido += val;
      }
    }
    for (const r of closed) {
      const day = (r.date_finished as string).slice(0, 10);
      for (const key of keysOf(r)) counts(day, key).cerrado += valueOfKey(r, key);
    }
  }

  const days: PlanProduccionDetalleResult['days'] = [];
  for (let d = start; d < endExclusive; d = addDaysIso(d, 1)) days.push({ date: d, values: byDay.get(d) ?? {} });

  return { familia, unit, period: { kind: periodKind, date: anchorIso, start, endExclusive }, series: buildSeries(familia, seen), days };
}

function buildSeries(familia: DetalleFamilia, seen: Set<string>): DetalleSerie[] {
  const naturalSort = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
  const series: DetalleSerie[] = [];
  const add = (key: string, label: string, tipo: DetalleSerie['tipo']) => {
    if (seen.has(key)) series.push({ key, label, tipo });
  };

  if (familia === 'colchones') {
    add('colchones', 'Colchones (total)', 'total');
    add('E', 'Línea E · Espuma', 'linea');
    add('B', 'Línea B · Base', 'linea');
    add('sin-linea', 'Sin línea cargada', 'linea');
    return series;
  }

  add('lean', 'Lean (total)', 'total');
  add('tradicional', 'Tradicional (sin herraje J)', 'total');
  add('herraje-j', 'Herraje Unión "J" Suma (piezas)', 'total');
  for (const rama of ['lean', 'tradicional'] as const) {
    const nombre = rama === 'lean' ? 'Lean' : 'Tradicional';
    const lineas = [...seen].filter((k) => k.startsWith(`${rama}:`)).sort(naturalSort);
    for (const key of lineas) {
      const linea = key.slice(rama.length + 1);
      series.push({ key, label: `${nombre} · ${linea === 'sin-linea' ? 'sin línea' : `línea ${linea}`}`, tipo: 'linea' });
    }
  }
  return series;
}
