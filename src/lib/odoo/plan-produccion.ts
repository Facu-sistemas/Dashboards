import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { monthBounds, addDaysIso, periodBounds, type PeriodKind } from '../date';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { getPlanProduccionSheetData, objetivoForPeriod, objetivoPerDay } from '../plan-produccion-objetivo';

export type { PeriodKind };

/**
 * Colchones works in raw units (`product_qty`). Living works in UE
 * (Unidad Equivalente) = `product_qty × x_studio_equivalente_produccion`
 * (the per-product multiplier on `product.template`) — confirmed live
 * this is the RIGHT field: `mrp.production.x_studio_ue_x_cant_1` (used
 * previously) reads 0 on ~64% of Living's orders, but every one of those
 * orders' products has a proper non-zero multiplier on `product.template`.
 * `x_studio_ue_x_cant_1` is just a stale/unsynced computed field — this
 * multiplies the raw multiplier directly instead of trusting it.
 *
 * `objetivo` still comes from the external Google Sheet
 * (plan-produccion-objetivo.ts) for both categories — Odoo has no
 * "Tiempo disponible" × "Personal" data at all.
 */
export interface PlanProduccionGauge {
  /** Raw value — UE for Living, units for Colchones. */
  planificado: number;
  /** Same unit — the part of `planificado` ALSO closed the same calendar day it was planned for (see `sameDayGauge`). */
  producido: number;
  cerrado: number;
  /** From the external sheet — 0 if that period/day isn't in it yet. */
  objetivo: number;
  /** planificado / objetivo. */
  planificadoPct: number;
  /** producido / planificado. */
  cumplimientoPct: number;
  /** cerrado / objetivo. */
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

/** `date_finished` is `false`/unset for orders that haven't closed yet. */
type PlannedRow = { planning_date: string; date_finished: string | false; state: string; product_qty: number; product_tmpl_id?: [number, string] };
type ClosedRow = { date_finished: string; product_qty: number; product_tmpl_id?: [number, string] };

async function fetchPlannedRows(categIds: number[], companyId: number, start: string, endExclusive: string, withTemplate: boolean): Promise<PlannedRow[]> {
  return searchReadAll<PlannedRow>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['planning_date', '>=', start],
      ['planning_date', '<', endExclusive],
    ],
    fields: withTemplate
      ? ['planning_date', 'date_finished', 'state', 'product_qty', 'product_tmpl_id']
      : ['planning_date', 'date_finished', 'state', 'product_qty'],
  });
}

async function fetchClosedRows(categIds: number[], companyId: number, start: string, endExclusive: string, withTemplate: boolean): Promise<ClosedRow[]> {
  return searchReadAll<ClosedRow>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['date_finished', '>=', start],
      ['date_finished', '<', endExclusive],
    ],
    fields: withTemplate ? ['date_finished', 'product_qty', 'product_tmpl_id'] : ['date_finished', 'product_qty'],
  });
}

/** UE multiplier (`x_studio_equivalente_produccion`) per `product.template` id, for the templates actually referenced by a batch of rows. */
async function multiplierByTemplate(rows: (PlannedRow | ClosedRow)[]): Promise<Map<number, number>> {
  const tmplIds = [...new Set(rows.map((r) => r.product_tmpl_id?.[0]).filter((id): id is number => id !== undefined))];
  if (tmplIds.length === 0) return new Map();
  const templates = await searchReadAll<{ id: number; x_studio_equivalente_produccion: number }>({
    model: 'product.template',
    domain: [['id', 'in', tmplIds]],
    fields: ['x_studio_equivalente_produccion'],
  });
  return new Map(templates.map((t) => [t.id, t.x_studio_equivalente_produccion]));
}

function everyDay(start: string, endExclusive: string): string[] {
  const days: string[] = [];
  for (let d = start; d < endExclusive; d = addDaysIso(d, 1)) days.push(d);
  return days;
}

function buildGauge(planificado: number, producido: number, cerrado: number, objetivo: number): PlanProduccionGauge {
  return {
    planificado,
    producido,
    cerrado,
    objetivo,
    planificadoPct: objetivo > 0 ? (planificado / objetivo) * 100 : 0,
    cumplimientoPct: planificado > 0 ? (producido / planificado) * 100 : 0,
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
  let planificado = 0;
  let producido = 0;
  for (const r of plannedRows) {
    const val = valueOf(r);
    planificado += val;
    if (r.state === 'done' && r.date_finished && r.date_finished.slice(0, 10) === r.planning_date) {
      producido += val;
    }
  }
  let cerrado = 0;
  for (const r of closedRows) cerrado += valueOf(r);

  return buildGauge(planificado, producido, cerrado, objetivo);
}

/** Planificado / Cumplimiento / Cerrado para Colchones y Living (ambas en vivo desde Odoo), para un período puntual (día/semana/mes/año) anclado en una fecha. */
export async function getPlanProduccion(periodKind: PeriodKind, anchorIso: string): Promise<PlanProduccionResult> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = periodBounds(periodKind, anchorIso);

  const [colchonesPlanned, colchonesClosed, livingPlanned, livingClosed, sheet] = await Promise.all([
    fetchPlannedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive, false),
    fetchClosedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive, false),
    fetchPlannedRows(LIVING_CATEG_IDS, companyId, start, endExclusive, true),
    fetchClosedRows(LIVING_CATEG_IDS, companyId, start, endExclusive, true),
    getPlanProduccionSheetData(),
  ]);
  const multiplier = await multiplierByTemplate([...livingPlanned, ...livingClosed]);
  const ueOf = (r: PlannedRow | ClosedRow) => r.product_qty * (multiplier.get(r.product_tmpl_id?.[0] ?? -1) ?? 0);

  return {
    period: { kind: periodKind, date: anchorIso, start, endExclusive },
    colchones: sameDayGauge(colchonesPlanned, colchonesClosed, objetivoForPeriod(sheet.colchones, start, endExclusive), (r) => r.product_qty),
    living: sameDayGauge(livingPlanned, livingClosed, objetivoForPeriod(sheet.living, start, endExclusive), ueOf),
  };
}

/** Same 3 gauges, one row per calendar day of the month the anchor date falls in — for the "Tendencia" chart. */
export async function getPlanProduccionDiaria(anchorIso: string): Promise<PlanProduccionDailyRow[]> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = monthBounds(anchorIso.slice(0, 7));

  const [colchonesPlanned, colchonesClosed, livingPlanned, livingClosed, sheet] = await Promise.all([
    fetchPlannedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive, false),
    fetchClosedRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive, false),
    fetchPlannedRows(LIVING_CATEG_IDS, companyId, start, endExclusive, true),
    fetchClosedRows(LIVING_CATEG_IDS, companyId, start, endExclusive, true),
    getPlanProduccionSheetData(),
  ]);
  const multiplier = await multiplierByTemplate([...livingPlanned, ...livingClosed]);
  const ueOf = (r: PlannedRow | ClosedRow) => r.product_qty * (multiplier.get(r.product_tmpl_id?.[0] ?? -1) ?? 0);

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
  const colchonesObjetivoByDay = objetivoPerDay(sheet.colchones, start, endExclusive);
  const livingObjetivoByDay = objetivoPerDay(sheet.living, start, endExclusive);

  return everyDay(start, endExclusive).map((date) => ({
    date,
    colchones: sameDayGauge(colchonesPlannedByDay.get(date) ?? [], colchonesClosedByDay.get(date) ?? [], colchonesObjetivoByDay.get(date) ?? 0, (r) => r.product_qty),
    living: sameDayGauge(livingPlannedByDay.get(date) ?? [], livingClosedByDay.get(date) ?? [], livingObjetivoByDay.get(date) ?? 0, ueOf),
  }));
}
