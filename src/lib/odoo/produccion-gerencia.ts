import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { getObjetivosGerencia } from './gerencia-objetivos';

/**
 * "Producción" (Gerencia General) — real figures come from `mrp.production`
 * (`qty_produced`, bucketed by `planning_date`), reusing the exact category
 * id sets `oee.ts` already confirmed live against Planificación's own saved
 * Odoo filters ("PLAN+CUMPL COLC"/"PLAN+CUMPL LIVING") — same source of
 * truth as the OEE tab, not a second guess at the categories. Objetivo
 * comes from the same manually-typed Odoo dashboard as Ventas (see
 * gerencia-objetivos.ts, "PRODUCCION CONSENSUADO" block) — no separate
 * Google Sheet objetivo like Producción's own "Plan de Producción" tab
 * uses (plan-produccion-objetivo.ts is a different tab's data source, not
 * reused here).
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

type Row = { planning_date: string; qty_produced: number };

async function monthlyProducedByCategory(categIds: number[], companyId: number, start: string, endExclusive: string): Promise<Map<string, number>> {
  const rows = await searchReadAll<Row>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['planning_date', '>=', start],
      ['planning_date', '<', endExclusive],
    ],
    fields: ['planning_date', 'qty_produced'],
  });
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const month = r.planning_date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + r.qty_produced);
  }
  return byMonth;
}

function toMonthlyArray(byMonth: Map<string, number>, months: string[]): number[] {
  return months.map((m) => byMonth.get(m) ?? 0);
}

export async function getProduccionGerencia(): Promise<ProduccionGerenciaResult> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const start = `${year}-01-01`;
  const endExclusive = `${year + 1}-01-01`;
  const mesesConDatos = now.getUTCMonth() + 1;

  const { companyId } = await getFronteraCompany();

  const [sillonesByMonth, colchonesByMonth, objetivos] = await Promise.all([
    monthlyProducedByCategory(LIVING_CATEG_IDS, companyId, start, endExclusive),
    monthlyProducedByCategory(COLCHONES_CATEG_IDS, companyId, start, endExclusive),
    getObjetivosGerencia(),
  ]);

  return {
    year,
    months,
    mesesConDatos,
    diasTranscurridos: objetivos.diasTranscurridos,
    diasTotal: objetivos.diasTotal,
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
