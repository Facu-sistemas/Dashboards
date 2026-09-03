import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { monthBounds, addDaysIso, periodBounds, type PeriodKind } from '../date';
import { COLCHONES_CATEG_IDS } from './oee';
import {
  getPlanProduccionSheetData,
  objetivoForPeriod,
  objetivoPerDay,
  sheetTotalsForPeriod,
  type SheetDailyData,
} from '../plan-produccion-objetivo';

export type { PeriodKind };

/**
 * Colchones is computed live from Odoo, in raw units (`product_qty`) —
 * confirmed complete data there. Living is read entirely from the
 * reference Google Sheet instead (Planificado/Cumplimiento/Cerrado AND
 * Objetivo) — confirmed live that `x_studio_ue_x_cant_1` (Living's UE
 * multiplier) is unset on 64% of its product variants in a real month,
 * undercounting Odoo's own numbers by roughly half; see
 * plan-produccion-objetivo.ts for the source and how to retire this once
 * that field gets filled in.
 */
export interface PlanProduccionGauge {
  /** Raw value — UE for Living, units for Colchones. */
  planificado: number;
  /** Same unit — for Colchones, the part of `planificado` ALSO closed the same calendar day it was planned for (see `gaugeFromRows`); for Living, the sheet's own CUMPLIMIENTO column. */
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
type PlannedRow = { planning_date: string; date_finished: string | false; state: string; product_qty: number };
type ClosedRow = { date_finished: string; product_qty: number };

async function fetchPlannedRows(companyId: number, start: string, endExclusive: string): Promise<PlannedRow[]> {
  return searchReadAll<PlannedRow>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', COLCHONES_CATEG_IDS],
      ['planning_date', '>=', start],
      ['planning_date', '<', endExclusive],
    ],
    fields: ['planning_date', 'date_finished', 'state', 'product_qty'],
  });
}

async function fetchClosedRows(companyId: number, start: string, endExclusive: string): Promise<ClosedRow[]> {
  return searchReadAll<ClosedRow>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', COLCHONES_CATEG_IDS],
      ['date_finished', '>=', start],
      ['date_finished', '<', endExclusive],
    ],
    fields: ['date_finished', 'product_qty'],
  });
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
 * against a real day-by-day reference (matched exactly, to the unit, on
 * two separate days before trusting this): it only counts orders that were
 * BOTH planned for a day AND actually closed (`state=done`) that SAME day.
 * An order planned today but closed tomorrow (or closed today but planned
 * last week — that's `cerrado`'s job) doesn't count here. That's the "lo
 * que se cumplió del día" the sheet's owner meant.
 */
function colchonesGaugeFromOdoo(plannedRows: PlannedRow[], closedRows: ClosedRow[], objetivo: number): PlanProduccionGauge {
  let planificado = 0;
  let producido = 0;
  for (const r of plannedRows) {
    planificado += r.product_qty;
    if (r.state === 'done' && r.date_finished && r.date_finished.slice(0, 10) === r.planning_date) {
      producido += r.product_qty;
    }
  }
  let cerrado = 0;
  for (const r of closedRows) cerrado += r.product_qty;

  return buildGauge(planificado, producido, cerrado, objetivo);
}

function livingGaugeFromSheet(map: SheetDailyData, start: string, endExclusive: string): PlanProduccionGauge {
  const { planificado, cumplimiento, cerrado } = sheetTotalsForPeriod(map, start, endExclusive);
  return buildGauge(planificado, cumplimiento, cerrado, objetivoForPeriod(map, start, endExclusive));
}

/** Planificado / Cumplimiento / Cerrado para Colchones (Odoo) y Living (planilla), para un período puntual (día/semana/mes/año) anclado en una fecha. */
export async function getPlanProduccion(periodKind: PeriodKind, anchorIso: string): Promise<PlanProduccionResult> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = periodBounds(periodKind, anchorIso);

  const [colchonesPlanned, colchonesClosed, sheet] = await Promise.all([
    fetchPlannedRows(companyId, start, endExclusive),
    fetchClosedRows(companyId, start, endExclusive),
    getPlanProduccionSheetData(),
  ]);

  return {
    period: { kind: periodKind, date: anchorIso, start, endExclusive },
    colchones: colchonesGaugeFromOdoo(colchonesPlanned, colchonesClosed, objetivoForPeriod(sheet.colchones, start, endExclusive)),
    living: livingGaugeFromSheet(sheet.living, start, endExclusive),
  };
}

/** Same 3 gauges, one row per calendar day of the month the anchor date falls in — for the "Tendencia" chart. */
export async function getPlanProduccionDiaria(anchorIso: string): Promise<PlanProduccionDailyRow[]> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = monthBounds(anchorIso.slice(0, 7));

  const [colchonesPlanned, colchonesClosed, sheet] = await Promise.all([
    fetchPlannedRows(companyId, start, endExclusive),
    fetchClosedRows(companyId, start, endExclusive),
    getPlanProduccionSheetData(),
  ]);

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
  const colchonesObjetivoByDay = objetivoPerDay(sheet.colchones, start, endExclusive);
  const livingObjetivoByDay = objetivoPerDay(sheet.living, start, endExclusive);

  return everyDay(start, endExclusive).map((date) => {
    const livingRow = sheet.living.get(date);
    return {
      date,
      colchones: colchonesGaugeFromOdoo(colchonesPlannedByDay.get(date) ?? [], colchonesClosedByDay.get(date) ?? [], colchonesObjetivoByDay.get(date) ?? 0),
      living: buildGauge(livingRow?.planificado ?? 0, livingRow?.cumplimiento ?? 0, livingRow?.cerrado ?? 0, livingObjetivoByDay.get(date) ?? 0),
    };
  });
}
