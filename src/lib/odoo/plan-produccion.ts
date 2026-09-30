import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { monthBounds, addDaysIso, periodBounds, type PeriodKind } from '../date';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS, getArgentinaTodayIso } from './oee';
import { getObjetivosGerencia } from './gerencia-objetivos';
import { getBusinessDayChecker, getDiasHabiles } from './business-calendar';

export type { PeriodKind };

/**
 * Living trabaja en `x_studio_unidades_eq` (columna "Unidades equivalentes"
 * de Órdenes de fabricación — confirmado 2026-09-30: 1528,43 cerrados en
 * septiembre); ya no se usa `product_qty × multiplicador`. Colchones queda
 * en cantidad cruda (`product_qty`).
 *
 * `objetivo` es el "PRODUCCION CONSENSUADO" de Gerencia General (tabla
 * "Equipo de gestión", ver gerencia-objetivos.ts): Colchones = fila
 * "colchones unidad", Living = fila "sillones equivalente". Es mensual, así
 * que se reparte en partes iguales entre los días hábiles del mes (0 en
 * fines de semana/feriados) para poder armar día/semana/mes/año.
 */
export interface PlanProduccionGauge {
  /** UE (x_studio_unidades_eq) para Living, unidades para Colchones. */
  planificado: number;
  /** Same unit — the part of `planificado` ALSO closed the same calendar day it was planned for (numerador de `cumplimientoPct`). */
  producido: number;
  cerrado: number;
  /** Consensuado de Gerencia prorrateado por día hábil — 0 si no hay objetivo cargado para ese período/día. */
  objetivo: number;
  /** Parte de `planificado` con fecha planificada hasta hoy inclusive (denominador de `cumplimientoPct`). */
  planificadoAHoy: number;
  /** planificado / objetivo. */
  planificadoPct: number;
  /** producido / planificadoAHoy — confirmado por el usuario (2026-09-30). */
  cumplimientoPct: number;
  /** cerrado / objetivo. */
  cerradoPct: number;
}

export interface PlanProduccionResult {
  period: { kind: PeriodKind; date: string; start: string; endExclusive: string };
  colchones: PlanProduccionGauge;
  living: PlanProduccionGauge;
  /** Columna "Total" del año completo de la misma tabla de objetivos de Gerencia — para mostrar "consensuado año" junto al objetivo del período. */
  objetivoAnual: { colchones: number; living: number };
}

export interface PlanProduccionDailyRow {
  date: string; // YYYY-MM-DD
  colchones: PlanProduccionGauge;
  living: PlanProduccionGauge;
}

/** `date_finished` is `false`/unset for orders that haven't closed yet. */
type PlannedRow = { planning_date: string; date_finished: string | false; state: string; product_qty: number; x_studio_unidades_eq: number };
type ClosedRow = { date_finished: string; product_qty: number; x_studio_unidades_eq: number };

async function fetchPlannedRows(categIds: number[], companyId: number, start: string, endExclusive: string): Promise<PlannedRow[]> {
  return searchReadAll<PlannedRow>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['planning_date', '>=', start],
      ['planning_date', '<', endExclusive],
    ],
    fields: ['planning_date', 'date_finished', 'state', 'product_qty', 'x_studio_unidades_eq'],
  });
}

async function fetchClosedRows(categIds: number[], companyId: number, start: string, endExclusive: string): Promise<ClosedRow[]> {
  return searchReadAll<ClosedRow>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['date_finished', '>=', start],
      ['date_finished', '<', endExclusive],
    ],
    fields: ['date_finished', 'product_qty', 'x_studio_unidades_eq'],
  });
}

function everyDay(start: string, endExclusive: string): string[] {
  const days: string[] = [];
  for (let d = start; d < endExclusive; d = addDaysIso(d, 1)) days.push(d);
  return days;
}

type ObjetivoPorDia = { colchones: Map<string, number>; living: Map<string, number>; totalAnual: { colchones: number; living: number } };

/** Consensuado mensual de Gerencia repartido en partes iguales entre los días hábiles de cada mes (los no hábiles quedan en 0). */
async function getObjetivoPorDia(start: string, endExclusive: string): Promise<ObjetivoPorDia> {
  const lastDay = addDaysIso(endExclusive, -1);
  const years = [...new Set([start.slice(0, 4), lastDay.slice(0, 4)])].map(Number);
  const [objetivos, esHabil, diasPorAnio] = await Promise.all([
    getObjetivosGerencia(),
    getBusinessDayChecker(),
    Promise.all(years.map((y) => getDiasHabiles(y))),
  ]);
  const diasTotal = new Map(years.map((y, i) => [y, diasPorAnio[i]!.diasTotal]));

  const colchones = new Map<string, number>();
  const living = new Map<string, number>();
  for (const day of everyDay(start, endExclusive)) {
    const month = Number(day.slice(5, 7)) - 1;
    const habiles = diasTotal.get(Number(day.slice(0, 4)))?.[month] ?? 0;
    const habil = habiles > 0 && esHabil(day);
    colchones.set(day, habil ? (objetivos.produccion.colchones[month] ?? 0) / habiles : 0);
    living.set(day, habil ? (objetivos.produccion.sillones[month] ?? 0) / habiles : 0);
  }
  return { colchones, living, totalAnual: { colchones: objetivos.totales.produccion.colchones, living: objetivos.totales.produccion.sillones } };
}

function sumObjetivo(map: Map<string, number>, start: string, endExclusive: string): number {
  let total = 0;
  for (const [day, value] of map) if (day >= start && day < endExclusive) total += value;
  return total;
}

function buildGauge(planificado: number, planificadoAHoy: number, producido: number, cerrado: number, objetivo: number): PlanProduccionGauge {
  return {
    planificado,
    planificadoAHoy,
    producido,
    cerrado,
    objetivo,
    planificadoPct: objetivo > 0 ? (planificado / objetivo) * 100 : 0,
    // Confirmado por el usuario (2026-09-30): cumplimiento = lo producido en
    // tiempo y forma (planificado y cerrado el mismo día) sobre lo planificado
    // hasta hoy; lo que se arrastra al día siguiente no cuenta como cumplido.
    cumplimientoPct: planificadoAHoy > 0 ? (producido / planificadoAHoy) * 100 : 0,
    cerradoPct: objetivo > 0 ? (cerrado / objetivo) * 100 : 0,
  };
}

/**
 * "Cumplimiento" is NOT produced-vs-planned in general — confirmed live
 * against a real day-by-day reference (matched exactly, to the unit): it
 * only counts orders that were BOTH planned for a day AND actually closed
 * (`state=done`) that SAME day. An order planned today but closed
 * tomorrow (or closed today but planned last week — that's `cerrado`'s
 * job) doesn't count here. That's the "lo que se cumplió del día" the
 * sheet's owner meant.
 */
function sameDayGauge(plannedRows: PlannedRow[], closedRows: ClosedRow[], objetivo: number, valueOf: (r: PlannedRow | ClosedRow) => number): PlanProduccionGauge {
  const today = getArgentinaTodayIso();
  let planificado = 0;
  let planificadoAHoy = 0;
  let producido = 0;
  for (const r of plannedRows) {
    const val = valueOf(r);
    planificado += val;
    if (r.planning_date.slice(0, 10) <= today) planificadoAHoy += val;
    if (r.state === 'done' && r.date_finished && r.date_finished.slice(0, 10) === r.planning_date) {
      producido += val;
    }
  }
  let cerrado = 0;
  for (const r of closedRows) cerrado += valueOf(r);

  return buildGauge(planificado, planificadoAHoy, producido, cerrado, objetivo);
}

/** Planificado / Cumplimiento / Cerrado para Colchones y Living (ambas en vivo desde Odoo), para un período puntual (día/semana/mes/año) anclado en una fecha. */
export async function getPlanProduccion(periodKind: PeriodKind, anchorIso: string): Promise<PlanProduccionResult> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = periodBounds(periodKind, anchorIso);

  const [colchonesPlanned, colchonesClosed, livingPlanned, livingClosed, objetivoDia] = await Promise.all([
    fetchPlannedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchPlannedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
    getObjetivoPorDia(start, endExclusive),
  ]);
  const unidadesEqOf = (r: PlannedRow | ClosedRow) => r.x_studio_unidades_eq;
  const cantOf = (r: PlannedRow | ClosedRow) => r.product_qty;

  // Vista anual: el objetivo es la suma de los consensuados mensuales hasta el
  // mes en curso inclusive (no el total del año) — así % = cerrado / acumulado.
  let objetivoEnd = endExclusive;
  if (periodKind === 'year') {
    const currentMonthEnd = monthBounds(getArgentinaTodayIso().slice(0, 7)).endExclusive;
    if (currentMonthEnd > start && currentMonthEnd < endExclusive) objetivoEnd = currentMonthEnd;
  }

  return {
    period: { kind: periodKind, date: anchorIso, start, endExclusive },
    colchones: sameDayGauge(colchonesPlanned, colchonesClosed, sumObjetivo(objetivoDia.colchones, start, objetivoEnd), cantOf),
    living: sameDayGauge(livingPlanned, livingClosed, sumObjetivo(objetivoDia.living, start, objetivoEnd), unidadesEqOf),
    objetivoAnual: objetivoDia.totalAnual,
  };
}

function sumGauges(gauges: PlanProduccionGauge[], objetivo: number): PlanProduccionGauge {
  let planificado = 0;
  let planificadoAHoy = 0;
  let producido = 0;
  let cerrado = 0;
  for (const g of gauges) {
    planificado += g.planificado;
    planificadoAHoy += g.planificadoAHoy;
    producido += g.producido;
    cerrado += g.cerrado;
  }
  return buildGauge(planificado, planificadoAHoy, producido, cerrado, objetivo);
}

/**
 * Date range the "Tendencia" chart covers for a given period selection —
 * kept in sync with what the gauges above show for that same period, so
 * the chart is never showing a different span than what's selected:
 * day/week both zoom to the ISO week (a single day's trend alone isn't
 * useful), month shows its own days, year aggregates by month.
 */
function trendBounds(periodKind: PeriodKind, anchorIso: string): { start: string; endExclusive: string } {
  if (periodKind === 'year') return periodBounds('year', anchorIso);
  if (periodKind === 'month') return monthBounds(anchorIso.slice(0, 7));
  return periodBounds('week', anchorIso);
}

/**
 * Rows for the "Tendencia" chart, scoped to the selected period: daily
 * rows for day/week/month, one row per month (aggregated) for year — see
 * `trendBounds`.
 */
export async function getPlanProduccionDiaria(periodKind: PeriodKind, anchorIso: string): Promise<PlanProduccionDailyRow[]> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = trendBounds(periodKind, anchorIso);

  const [colchonesPlanned, colchonesClosed, livingPlanned, livingClosed, objetivoDia] = await Promise.all([
    fetchPlannedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchPlannedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
    getObjetivoPorDia(start, endExclusive),
  ]);
  const unidadesEqOf = (r: PlannedRow | ClosedRow) => r.x_studio_unidades_eq;
  const cantOf = (r: PlannedRow | ClosedRow) => r.product_qty;

  function bucket<T extends { planning_date?: string; date_finished?: string | false }>(rows: T[], field: 'planning_date' | 'date_finished'): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const raw = r[field];
      if (!raw) continue;
      const day = raw.slice(0, 10);
      const list = map.get(day);
      if (list) list.push(r);
      else map.set(day, [r]);
    }
    return map;
  }

  const colchonesPlannedByDay = bucket(colchonesPlanned, 'planning_date');
  const colchonesClosedByDay = bucket(colchonesClosed, 'date_finished');
  const livingPlannedByDay = bucket(livingPlanned, 'planning_date');
  const livingClosedByDay = bucket(livingClosed, 'date_finished');
  const colchonesObjetivoByDay = objetivoDia.colchones;
  const livingObjetivoByDay = objetivoDia.living;

  const dailyRows = everyDay(start, endExclusive).map((date) => ({
    date,
    colchones: sameDayGauge(colchonesPlannedByDay.get(date) ?? [], colchonesClosedByDay.get(date) ?? [], colchonesObjetivoByDay.get(date) ?? 0, cantOf),
    living: sameDayGauge(livingPlannedByDay.get(date) ?? [], livingClosedByDay.get(date) ?? [], livingObjetivoByDay.get(date) ?? 0, unidadesEqOf),
  }));

  if (periodKind !== 'year') return dailyRows;

  const year = Number(start.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).map((monthKey) => {
    const { start: mStart, endExclusive: mEnd } = monthBounds(monthKey);
    const rowsInMonth = dailyRows.filter((r) => r.date >= mStart && r.date < mEnd);
    return {
      date: mStart,
      colchones: sumGauges(rowsInMonth.map((r) => r.colchones), sumObjetivo(objetivoDia.colchones, mStart, mEnd)),
      living: sumGauges(rowsInMonth.map((r) => r.living), sumObjetivo(objetivoDia.living, mStart, mEnd)),
    };
  });
}
