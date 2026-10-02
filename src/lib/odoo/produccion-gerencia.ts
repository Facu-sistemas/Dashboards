import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS, getArgentinaTodayIso } from './oee';
import { getObjetivosGerencia } from './gerencia-objetivos';
import { getDiasHabiles } from './business-calendar';
import { getEquivalenteByTemplate } from './producto-equivalente';

/**
 * "Producción" (Gerencia General) — real figures come from `mrp.production`
 * cerradas (`state=done`, bucketed by `date_finished` = "Fin: Mes" de Odoo), reusing the exact category id sets
 * `oee.ts` already confirmed live against Planificación's own saved Odoo
 * filters ("PLAN+CUMPL COLC"/"PLAN+CUMPL LIVING") — same source of truth
 * as the OEE tab, not a second guess at the categories. Objetivo comes
 * from the same manually-typed Odoo dashboard as Ventas (see
 * gerencia-objetivos.ts, "PRODUCCION CONSENSUADO" block) — no separate
 * Google Sheet objetivo like Producción's own "Plan de Producción" tab
 * uses (plan-produccion-objetivo.ts is a different tab's data source, not
 * reused here).
 *
 * `sillonesUE` sale de `x_studio_unidades_eq` (columna "Unidades
 * equivalentes" de Órdenes de fabricación, confirmada contra Odoo
 * 2026-09-30: Living 1528,43 en septiembre). Colchones queda en cantidad cruda.
 *
 * Sillones y colchones se devuelven en las dos medidas: cantidad
 * (`qty_produced` crudo) y Unidad Equivalente (`qty_produced` ×
 * `x_studio_equivalente_produccion`, ver producto-equivalente.ts) — la
 * pestaña tiene un toggle. Ambas categorías tienen el campo cargado
 * (confirmado en vivo 2026-09-29).
 */

export interface ProduccionGerenciaResult {
  year: number;
  months: string[];
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: { sillonesUE: number[]; sillonesCant: number[]; colchonesUE: number[]; colchonesCant: number[] };
  objetivo: { sillones: number[]; colchones: number[] };
  /** Columna "Total" de la planilla de objetivos — el consensuado del año completo, tal cual está cargado en Odoo. */
  objetivoTotalAnual: { sillones: number; colchones: number };
}

export type Row = { date_finished: string; qty_produced: number; x_studio_unidades_eq: number; product_tmpl_id?: [number, string] };

export async function fetchMonthlyRows(categIds: number[], companyId: number, start: string, endExclusive: string, withTemplate: boolean): Promise<Row[]> {
  return searchReadAll<Row>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['date_finished', '>=', start],
      ['date_finished', '<', endExclusive],
    ],
    fields: withTemplate
      ? ['date_finished', 'qty_produced', 'x_studio_unidades_eq', 'product_tmpl_id']
      : ['date_finished', 'qty_produced', 'x_studio_unidades_eq'],
  });
}

function bucketByMonth(rows: Row[], valueOf: (r: Row) => number): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const month = r.date_finished.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + valueOf(r));
  }
  return byMonth;
}

function toMonthlyArray(byMonth: Map<string, number>, months: string[]): number[] {
  return months.map((m) => byMonth.get(m) ?? 0);
}

export async function getProduccionGerencia(): Promise<ProduccionGerenciaResult> {
  const today = getArgentinaTodayIso();
  const year = Number(today.slice(0, 4));
  const mesesConDatos = Number(today.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const start = `${year}-01-01`;
  const endExclusive = `${year + 1}-01-01`;

  const { companyId } = await getFronteraCompany();

  const [livingRows, colchonesRows, objetivos, diasHabiles] = await Promise.all([
    fetchMonthlyRows(LIVING_CATEG_IDS, companyId, start, endExclusive, true),
    fetchMonthlyRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive, true),
    getObjetivosGerencia(),
    getDiasHabiles(year),
  ]);

  const templateIds = [
    ...new Set([...livingRows, ...colchonesRows].map((r) => r.product_tmpl_id?.[0]).filter((id): id is number => id !== undefined)),
  ];
  const ueByTemplate = await getEquivalenteByTemplate(templateIds);
  const ueOf = (r: Row) => r.qty_produced * (ueByTemplate.get(r.product_tmpl_id?.[0] ?? -1) ?? 0);
  const cantOf = (r: Row) => r.qty_produced;
  const unidadesEqOf = (r: Row) => r.x_studio_unidades_eq;

  return {
    year,
    months,
    mesesConDatos,
    diasTranscurridos: diasHabiles.diasTranscurridos,
    diasTotal: diasHabiles.diasTotal,
    real: {
      sillonesUE: toMonthlyArray(bucketByMonth(livingRows, unidadesEqOf), months),
      sillonesCant: toMonthlyArray(bucketByMonth(livingRows, cantOf), months),
      colchonesUE: toMonthlyArray(bucketByMonth(colchonesRows, ueOf), months),
      colchonesCant: toMonthlyArray(bucketByMonth(colchonesRows, cantOf), months),
    },
    objetivo: {
      sillones: objetivos.produccion.sillones,
      colchones: objetivos.produccion.colchones,
    },
    objetivoTotalAnual: objetivos.totales.produccion,
  };
}
