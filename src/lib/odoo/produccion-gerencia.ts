import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS, getArgentinaTodayIso } from './oee';
import { getObjetivosGerencia } from './gerencia-objetivos';
import { getDiasHabiles } from './business-calendar';
import { getEquivalenteByTemplate } from './producto-equivalente';

/**
 * "Producción" (Gerencia General) — real figures come from `mrp.production`
 * (bucketed by `planning_date`), reusing the exact category id sets
 * `oee.ts` already confirmed live against Planificación's own saved Odoo
 * filters ("PLAN+CUMPL COLC"/"PLAN+CUMPL LIVING") — same source of truth
 * as the OEE tab, not a second guess at the categories. Objetivo comes
 * from the same manually-typed Odoo dashboard as Ventas (see
 * gerencia-objetivos.ts, "PRODUCCION CONSENSUADO" block) — no separate
 * Google Sheet objetivo like Producción's own "Plan de Producción" tab
 * uses (plan-produccion-objetivo.ts is a different tab's data source, not
 * reused here).
 *
 * Colchones: raw `qty_produced` (units). Sillones: `qty_produced`
 * ponderado por Unidad Equivalente (`x_studio_equivalente_produccion`,
 * ver producto-equivalente.ts) — mismo campo, mismo criterio que ya
 * confirmamos exacto contra la referencia histórica para Ventas
 * (ver ventas-gerencia.ts). Colchones no tiene este campo, Sillones sí.
 */

export interface ProduccionGerenciaResult {
  year: number;
  months: string[];
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: { sillones: number[]; colchones: number[] };
  objetivo: { sillones: number[]; colchones: number[] };
}

type Row = { planning_date: string; qty_produced: number; product_tmpl_id?: [number, string] };

async function fetchMonthlyRows(categIds: number[], companyId: number, start: string, endExclusive: string, withTemplate: boolean): Promise<Row[]> {
  return searchReadAll<Row>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['planning_date', '>=', start],
      ['planning_date', '<', endExclusive],
    ],
    fields: withTemplate ? ['planning_date', 'qty_produced', 'product_tmpl_id'] : ['planning_date', 'qty_produced'],
  });
}

function bucketByMonth(rows: Row[], valueOf: (r: Row) => number): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const month = r.planning_date.slice(0, 7);
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
    fetchMonthlyRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive, false),
    getObjetivosGerencia(),
    getDiasHabiles(year),
  ]);

  const templateIds = [...new Set(livingRows.map((r) => r.product_tmpl_id?.[0]).filter((id): id is number => id !== undefined))];
  const ueByTemplate = await getEquivalenteByTemplate(templateIds);
  const ueOf = (r: Row) => r.qty_produced * (ueByTemplate.get(r.product_tmpl_id?.[0] ?? -1) ?? 0);

  const sillonesByMonth = bucketByMonth(livingRows, ueOf);
  const colchonesByMonth = bucketByMonth(colchonesRows, (r) => r.qty_produced);

  return {
    year,
    months,
    mesesConDatos,
    diasTranscurridos: diasHabiles.diasTranscurridos,
    diasTotal: diasHabiles.diasTotal,
    real: {
      sillones: toMonthlyArray(sillonesByMonth, months),
      colchones: toMonthlyArray(colchonesByMonth, months),
    },
    objetivo: {
      sillones: objetivos.produccion.sillones,
      colchones: objetivos.produccion.colchones,
    },
  };
}
