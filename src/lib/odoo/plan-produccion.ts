import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { monthBounds, addDaysIso, periodBounds, type PeriodKind } from '../date';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';

export type { PeriodKind };

/**
 * Living is measured in UE (Unidad Equivalente), Colchones in raw units —
 * confirmed live these are NOT interchangeable (SUM(product_qty) vs.
 * SUM(x_studio_ue_x_cant_1) for Colchones differ by ~6% in a real month),
 * so each category keeps its own unit throughout.
 *
 * There's no "objetivo" (target) here on purpose — the reference sheet's
 * daily target is built from "Tiempo disponible" × "Personal", which lives
 * in an external Excel Odoo has no access to (same gap plan.md already
 * flagged for "Disponibilidad Productiva"). Once that sheet is reachable,
 * Planificado/Cerrado can go back to being a % of that target.
 */
type UnitKind = 'ue' | 'unidades';

export interface PlanProduccionGauge {
  /** Raw value — UE for Living, units for Colchones. */
  planificado: number;
  producido: number;
  cerrado: number;
  /** producido / planificado — same "PLAN+CUMPL" criterion as the OEE, in this category's own unit. */
  cumplimientoPct: number;
  /** cerrado / planificado. */
  cerradoPct: number;
}

export interface PlanProduccionResult {
  period: { kind: PeriodKind; date: string; start: string; endExclusive: string };
  colchones: PlanProduccionGauge;
  living: PlanProduccionGauge;
}

export interface PlanProduccionDailyRow {
  date: string; // YYYY-MM-DD
  colchones: PlanProduccionGauge;
  living: PlanProduccionGauge;
}

type PlannedRow = { planning_date: string; product_qty: number; qty_produced: number; x_studio_ue_x_cant_1: number };
type ClosedRow = { date_finished: string; product_qty: number; x_studio_ue_x_cant_1: number };

async function fetchPlannedRows(categIds: number[], companyId: number, start: string, endExclusive: string): Promise<PlannedRow[]> {
  return searchReadAll<PlannedRow>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['planning_date', '>=', start],
      ['planning_date', '<', endExclusive],
    ],
    fields: ['planning_date', 'product_qty', 'qty_produced', 'x_studio_ue_x_cant_1'],
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
    fields: ['date_finished', 'product_qty', 'x_studio_ue_x_cant_1'],
  });
}

function everyDay(start: string, endExclusive: string): string[] {
  const days: string[] = [];
  for (let d = start; d < endExclusive; d = addDaysIso(d, 1)) days.push(d);
  return days;
}

/**
 * `x_studio_ue_x_cant_1` (Living's UE) is the UE of the *planned* quantity
 * — there's no separate "UE producida" field, so its produced side is
 * prorated by how much of that order's planned quantity actually got
 * produced (`qty_produced / product_qty`). Colchones needs no such
 * prorating: `qty_produced` is already its produced value directly.
 */
function gaugeFromRows(plannedRows: PlannedRow[], closedRows: ClosedRow[], unit: UnitKind): PlanProduccionGauge {
  let planificado = 0;
  let producido = 0;
  for (const r of plannedRows) {
    if (unit === 'unidades') {
      planificado += r.product_qty;
      producido += r.qty_produced;
    } else {
      planificado += r.x_studio_ue_x_cant_1;
      if (r.product_qty > 0) producido += r.x_studio_ue_x_cant_1 * (r.qty_produced / r.product_qty);
    }
  }
  let cerrado = 0;
  for (const r of closedRows) cerrado += unit === 'unidades' ? r.product_qty : r.x_studio_ue_x_cant_1;

  return {
    planificado,
    producido,
    cerrado,
    cumplimientoPct: planificado > 0 ? (producido / planificado) * 100 : 0,
    cerradoPct: planificado > 0 ? (cerrado / planificado) * 100 : 0,
  };
}

/** Planificado / Cumplimiento / Cerrado para Colchones y Living, para un período puntual (día/semana/mes/año) anclado en una fecha. */
export async function getPlanProduccion(periodKind: PeriodKind, anchorIso: string): Promise<PlanProduccionResult> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = periodBounds(periodKind, anchorIso);

  const [colchonesPlanned, livingPlanned, colchonesClosed, livingClosed] = await Promise.all([
    fetchPlannedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchPlannedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
  ]);

  return {
    period: { kind: periodKind, date: anchorIso, start, endExclusive },
    colchones: gaugeFromRows(colchonesPlanned, colchonesClosed, 'unidades'),
    living: gaugeFromRows(livingPlanned, livingClosed, 'ue'),
  };
}

/** Same 3 gauges, one row per calendar day of the month the anchor date falls in — for the "Tendencia" chart. */
export async function getPlanProduccionDiaria(anchorIso: string): Promise<PlanProduccionDailyRow[]> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = monthBounds(anchorIso.slice(0, 7));

  const [colchonesPlanned, livingPlanned, colchonesClosed, livingClosed] = await Promise.all([
    fetchPlannedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchPlannedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    fetchClosedRows(LIVING_CATEG_IDS, companyId, start, endExclusive),
  ]);

  function bucket<T extends { planning_date: string } | { date_finished: string }>(rows: T[], field: 'planning_date' | 'date_finished'): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const day = (r as Record<string, string>)[field]!.slice(0, 10);
      const list = map.get(day);
      if (list) list.push(r);
      else map.set(day, [r]);
    }
    return map;
  }

  const colchonesPlannedByDay = bucket(colchonesPlanned, 'planning_date');
  const livingPlannedByDay = bucket(livingPlanned, 'planning_date');
  const colchonesClosedByDay = bucket(colchonesClosed, 'date_finished');
  const livingClosedByDay = bucket(livingClosed, 'date_finished');

  return everyDay(start, endExclusive).map((date) => ({
    date,
    colchones: gaugeFromRows(colchonesPlannedByDay.get(date) ?? [], colchonesClosedByDay.get(date) ?? [], 'unidades'),
    living: gaugeFromRows(livingPlannedByDay.get(date) ?? [], livingClosedByDay.get(date) ?? [], 'ue'),
  }));
}
