import { searchReadAll } from './client';
import { getObjetivosGerencia } from './gerencia-objetivos';
import { getDiasHabiles } from './business-calendar';
import { getArgentinaTodayIso } from './oee';
import { getEquivalenteByTemplate, getTemplateIdByVariant } from './producto-equivalente';
import { getClientesActivosCompanies, getIgnoredCreditNoteMoveIds } from './clientes-activos';
import type { OdooDomain } from './types';

/**
 * "Facturación" (Gerencia General) — real figures come from posted customer
 * invoices (`account.move.line`, `move_type = 'out_invoice'`, `parent_state
 * = 'posted'`), bucketed by `invoice_date`. Same category ids and same
 * UE-weighting approach already confirmed live for Ventas (see
 * ventas-gerencia.ts) — the only difference is the source model (facturado,
 * not vendido) and that `account.move.line` uses `quantity` (not
 * `product_uom_qty`). `move_type`/`parent_state` are stored related fields
 * directly on `account.move.line` — no need to traverse `move_id.*`.
 *
 * Objetivo (unidades): "FACTURACION CONSENSUADO" block of the "Equipo de
 * gestión" dashboard (gerencia-objetivos.ts, facturacionUnidades). Objetivo
 * ($): that same dashboard only carries ONE total $ row ("Concensuado en
 * $") — confirmed live (2026-09-24, `spreadsheet.dashboard.share` id 74):
 * 18 rows total, no per-category $ objetivo (unlike the old Google Sheet's
 * "FACTURACION OBJETIVO $ CONSENSUADO" block, which doesn't exist in Odoo).
 * So the $ KPI breakdown by category (sillones/colchones/block/reventa/
 * flete) is real-only; only the $ TOTAL has an objetivo to compare against.
 *
 * Flete: no "Flete" product category exists in Odoo — freight is billed as
 * individual products under category "Servicio" (id 24). Confirmed live
 * which of those are actually invoiced to customers (2026, id 24): "FLETE
 * CLIENTES" and "NOTA DE CREDITO FLETE" (credit notes). "FLETE
 * PROVEEDORES"/"FLETE IMPORTACION" are supplier-side, not customer-billed,
 * and were excluded. IMPORTANT: `account.move.line.product_id` points at
 * `product.product` (the variant), NOT `product.template` — these ids are
 * the variant ids (confirmed live via `product.product` search on the
 * template ids), a different id space than the category ids above.
 *
 * Compañías: ambas ("Frontera Living S.A" y "Presupuesto") se incluyen a
 * propósito — confirmado en vivo (Agosto 2026, Colchones) que filtrar solo
 * "Frontera Living S.A" da 5.317u, muy por debajo del real (8.695u):
 * "Presupuesto" también factura producto real, a diferencia de
 * `sale.order` donde casi no se usa (ver el comentario grande de
 * clientes-activos.ts) — no extrapola esa exclusión acá.
 *
 * Notas de crédito: `out_refund` se NETEA (resta) contra `out_invoice`,
 * salvo las que `getIgnoredCreditNoteMoveIds` (clientes-activos.ts) marca
 * como "no es una devolución real" (acuerdo comercial pagado por fuera,
 * descuento comercial, publicidad) — esas no restan, mismo criterio que ya
 * usa Clientes Activos, una sola fuente de verdad. Confirmado en vivo
 * (Agosto 2026): ignorar TODAS las out_refund sobrecontaba Colchones en
 * ~150u (130u de notas de crédito posteadas ese mes); netear todas achicó
 * el desvío a ~0,2% contra el dashboard de referencia.
 */
const SILLONES_CATEG_IDS = [3, 2, 16]; // Lean, Tradicional, Deliveries
const COLCHONES_CATEG_ID = 5;
const BLOCK_CATEG_ID = 26;
const REVENTA_CATEG_ID = 11;
const FLETE_PRODUCT_VARIANT_IDS = [18380, 18324]; // FLETE CLIENTES, NOTA DE CREDITO FLETE

const POSTED_CUSTOMER_INVOICE_OR_REFUND: OdooDomain = [
  ['move_type', 'in', ['out_invoice', 'out_refund']],
  ['parent_state', '=', 'posted'],
];

export interface FacturacionGerenciaResult {
  year: number;
  /** 12 "YYYY-MM" keys, Ene..Dic of `year`. */
  months: string[];
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: {
    sillones: number[];
    colchones: number[];
    block: number[];
    sillonesPesos: number[];
    colchonesPesos: number[];
    blockPesos: number[];
    reventaPesos: number[];
    fletePesos: number[];
    totalPesos: number[];
  };
  objetivo: {
    sillones: number[];
    colchones: number[];
    block: number[];
    totalPesos: number[];
  };
}

type InvoiceLine = { invoice_date: string; quantity: number; price_subtotal: number; move_type: string; move_id: [number, string] };

/** `sign(line)` = -1 para notas de crédito reales (netean), +1 para facturas y para notas de crédito "no reales" (no netean, ver el comentario grande de arriba). */
function signOf(line: InvoiceLine, ignoredMoveIds: Set<number>): number {
  if (line.move_type !== 'out_refund') return 1;
  return ignoredMoveIds.has(line.move_id[0]) ? 0 : -1;
}

async function monthlyByCategory(
  domain: OdooDomain,
  start: string,
  endExclusive: string,
  ignoredMoveIds: Set<number>,
  valueOf: (l: InvoiceLine) => number
): Promise<Map<string, number>> {
  const lines = await searchReadAll<InvoiceLine>({
    model: 'account.move.line',
    domain: [...POSTED_CUSTOMER_INVOICE_OR_REFUND, ...domain, ['invoice_date', '>=', start], ['invoice_date', '<', endExclusive]],
    fields: ['invoice_date', 'quantity', 'price_subtotal', 'move_type', 'move_id'],
  });
  const byMonth = new Map<string, number>();
  for (const line of lines) {
    const sign = signOf(line, ignoredMoveIds);
    if (sign === 0) continue;
    const month = line.invoice_date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + sign * valueOf(line));
  }
  return byMonth;
}

function toMonthlyArray(byMonth: Map<string, number>, months: string[]): number[] {
  return months.map((m) => byMonth.get(m) ?? 0);
}

type SillonInvoiceLine = { invoice_date: string; product_id: [number, string]; quantity: number; move_type: string; move_id: [number, string] };

/** Sillones facturados, ponderados por Unidad Equivalente — mismo criterio que monthlySillonesUE en ventas-gerencia.ts, neteando notas de crédito reales. */
async function monthlySillonesUEFacturado(categIds: number[], start: string, endExclusive: string, ignoredMoveIds: Set<number>): Promise<Map<string, number>> {
  const lines = await searchReadAll<SillonInvoiceLine>({
    model: 'account.move.line',
    domain: [...POSTED_CUSTOMER_INVOICE_OR_REFUND, ['product_id.categ_id', 'in', categIds], ['invoice_date', '>=', start], ['invoice_date', '<', endExclusive]],
    fields: ['invoice_date', 'product_id', 'quantity', 'move_type', 'move_id'],
  });
  if (lines.length === 0) return new Map();

  const variantIds = [...new Set(lines.map((l) => l.product_id[0]))];
  const templateIdByVariant = await getTemplateIdByVariant(variantIds);
  const templateIds = [...new Set([...templateIdByVariant.values()])];
  const ueByTemplate = await getEquivalenteByTemplate(templateIds);

  const byMonth = new Map<string, number>();
  for (const line of lines) {
    const sign = signOf(line as unknown as InvoiceLine, ignoredMoveIds);
    if (sign === 0) continue;
    const templateId = templateIdByVariant.get(line.product_id[0]);
    const ue = templateId !== undefined ? (ueByTemplate.get(templateId) ?? 0) : 0;
    const month = line.invoice_date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + sign * line.quantity * ue);
  }
  return byMonth;
}

export async function getFacturacionGerencia(): Promise<FacturacionGerenciaResult> {
  const today = getArgentinaTodayIso();
  const year = Number(today.slice(0, 4));
  const mesesConDatos = Number(today.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const start = `${year}-01-01`;
  const endExclusive = `${year + 1}-01-01`;

  const companies = await getClientesActivosCompanies();
  const ignoredMoveIdsList = await getIgnoredCreditNoteMoveIds(
    companies.map((c) => c.id),
    start
  );
  const ignoredMoveIds = new Set(ignoredMoveIdsList);

  const [
    sillonesByMonth,
    colchonesByMonth,
    blockByMonth,
    sillonesPesosByMonth,
    colchonesPesosByMonth,
    blockPesosByMonth,
    reventaPesosByMonth,
    fletePesosByMonth,
    totalPesosByMonth,
    objetivos,
    diasHabiles,
  ] = await Promise.all([
    monthlySillonesUEFacturado(SILLONES_CATEG_IDS, start, endExclusive, ignoredMoveIds),
    monthlyByCategory([['product_id.categ_id', 'child_of', COLCHONES_CATEG_ID]], start, endExclusive, ignoredMoveIds, (l) => l.quantity),
    monthlyByCategory([['product_id.categ_id', 'child_of', BLOCK_CATEG_ID]], start, endExclusive, ignoredMoveIds, (l) => l.quantity),
    monthlyByCategory([['product_id.categ_id', 'in', SILLONES_CATEG_IDS]], start, endExclusive, ignoredMoveIds, (l) => l.price_subtotal),
    monthlyByCategory([['product_id.categ_id', 'child_of', COLCHONES_CATEG_ID]], start, endExclusive, ignoredMoveIds, (l) => l.price_subtotal),
    monthlyByCategory([['product_id.categ_id', 'child_of', BLOCK_CATEG_ID]], start, endExclusive, ignoredMoveIds, (l) => l.price_subtotal),
    monthlyByCategory([['product_id.categ_id', 'child_of', REVENTA_CATEG_ID]], start, endExclusive, ignoredMoveIds, (l) => l.price_subtotal),
    monthlyByCategory([['product_id', 'in', FLETE_PRODUCT_VARIANT_IDS]], start, endExclusive, ignoredMoveIds, (l) => l.price_subtotal),
    monthlyByCategory([], start, endExclusive, ignoredMoveIds, (l) => l.price_subtotal),
    getObjetivosGerencia(),
    getDiasHabiles(year),
  ]);

  return {
    year,
    months,
    mesesConDatos,
    diasTranscurridos: diasHabiles.diasTranscurridos,
    diasTotal: diasHabiles.diasTotal,
    real: {
      sillones: toMonthlyArray(sillonesByMonth, months),
      colchones: toMonthlyArray(colchonesByMonth, months),
      block: toMonthlyArray(blockByMonth, months),
      sillonesPesos: toMonthlyArray(sillonesPesosByMonth, months),
      colchonesPesos: toMonthlyArray(colchonesPesosByMonth, months),
      blockPesos: toMonthlyArray(blockPesosByMonth, months),
      reventaPesos: toMonthlyArray(reventaPesosByMonth, months),
      fletePesos: toMonthlyArray(fletePesosByMonth, months),
      totalPesos: toMonthlyArray(totalPesosByMonth, months),
    },
    objetivo: {
      sillones: objetivos.facturacionUnidades.sillones,
      colchones: objetivos.facturacionUnidades.colchones,
      block: objetivos.facturacionUnidades.block,
      totalPesos: objetivos.facturacionPesos.total,
    },
  };
}
