import { searchReadAll } from './client';
import { LIVING_CONFIG } from './top-products';
import { getObjetivosGerencia } from './gerencia-objetivos';
import { getDiasHabiles } from './business-calendar';
import { getArgentinaTodayIso } from './oee';
import type { OdooDomain } from './types';

/**
 * "Ventas" (Gerencia General) — real figures come straight from Odoo
 * (`sale.order.line`, confirmed orders only), only the monthly objetivo
 * comes from the manually-typed Odoo dashboard (see gerencia-objetivos.ts).
 *
 * Sillones reuse `LIVING_CONFIG` (top-products.ts) — its excludes
 * (Accesorio/Deliveries/Bonificacion) are genuinely not "sillones vendidos"
 * and confirmed live to land close to this same dashboard's historical
 * reference total. Colchones deliberately does NOT reuse
 * `COLCHONES_CONFIG`: its excludeCategIds strips category id 6 ("Colchones
 * / Espuma"), which is tuned for the Top-Productos ranking use case but
 * turned out to be the BULK of real colchón sales (~59k of ~75k units in a
 * live 2026 Ene-Sep check) — reusing it here undercounted "Colchones" by
 * ~16x. Plain `categ_id child_of 5`, no exclusions, matched the reference
 * total within ~2%.
 *
 * Category ids confirmed live in Odoo (2026-09-18) via `product.category`.
 * Block (kg) = "PI / Block Espuma" (id 26, under "PI" id 15 — Producto
 * Intermedio, the foam block sold by weight before being cut). Reventa $ =
 * "Reventa" (id 11, root) — third-party goods (almohadas, mesas,
 * poltronas, colchones/sillones "de reventa", masajeadores) tracked only
 * in $, never in units, matching the sheet's own "Reventa en $" row —
 * confirmed live within ~1.5% of the reference total.
 */
const COLCHONES_CATEG_ID = 5;
const BLOCK_CATEG_ID = 26;
const REVENTA_CATEG_ID = 11;

export interface VentasGerenciaResult {
  year: number;
  /** 12 "YYYY-MM" keys, Ene..Dic of `year`. */
  months: string[];
  /** How many months (from Enero) actually happened already, per Argentina's wall-clock today. */
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: { sillones: number[]; colchones: number[]; block: number[]; reventa: number[] };
  objetivo: { sillones: number[]; colchones: number[]; block: number[]; reventa: number[] };
}

type Line = { order_id: [number, string]; product_uom_qty: number; price_subtotal: number };

async function monthlyQtyByCategory(domain: OdooDomain, start: string, endExclusive: string, valueField: 'product_uom_qty' | 'price_subtotal'): Promise<Map<string, number>> {
  const lines = await searchReadAll<Line>({
    model: 'sale.order.line',
    domain: [...domain, ['order_id.date_order', '>=', start], ['order_id.date_order', '<', endExclusive]],
    fields: ['order_id', 'product_uom_qty', 'price_subtotal'],
  });
  if (lines.length === 0) return new Map();

  const orderIds = [...new Set(lines.map((l) => l.order_id[0]))];
  // read_group can't combine a related-field traversal ("order_id.date_order")
  // with a date-granularity groupBy — same limitation sales-mix.ts already
  // works around (see getMonthlyUnitsSold): join order dates in memory instead.
  const orders = await searchReadAll<{ id: number; date_order: string }>({
    model: 'sale.order',
    domain: [['id', 'in', orderIds]],
    fields: ['date_order'],
  });
  const dateByOrder = new Map(orders.map((o) => [o.id, o.date_order]));

  const byMonth = new Map<string, number>();
  for (const line of lines) {
    const dateOrder = dateByOrder.get(line.order_id[0]);
    if (!dateOrder) continue;
    const month = dateOrder.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + line[valueField]);
  }
  return byMonth;
}

function toMonthlyArray(byMonth: Map<string, number>, months: string[]): number[] {
  return months.map((m) => byMonth.get(m) ?? 0);
}

export async function getVentasGerencia(): Promise<VentasGerenciaResult> {
  const today = getArgentinaTodayIso();
  const year = Number(today.slice(0, 4));
  const mesesConDatos = Number(today.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const start = `${year}-01-01`;
  const endExclusive = `${year + 1}-01-01`;

  const baseDomain: OdooDomain = [['order_id.state', '=', 'sale']];

  const [sillonesByMonth, colchonesByMonth, blockByMonth, reventaByMonth, objetivos, diasHabiles] = await Promise.all([
    monthlyQtyByCategory(
      [...baseDomain, ['product_id.categ_id', 'child_of', LIVING_CONFIG.rootCategId], ['product_id.categ_id', 'not in', LIVING_CONFIG.excludeCategIds]],
      start,
      endExclusive,
      'product_uom_qty'
    ),
    monthlyQtyByCategory(
      [...baseDomain, ['product_id.categ_id', 'child_of', COLCHONES_CATEG_ID]],
      start,
      endExclusive,
      'product_uom_qty'
    ),
    monthlyQtyByCategory([...baseDomain, ['product_id.categ_id', 'child_of', BLOCK_CATEG_ID]], start, endExclusive, 'product_uom_qty'),
    monthlyQtyByCategory([...baseDomain, ['product_id.categ_id', 'child_of', REVENTA_CATEG_ID]], start, endExclusive, 'price_subtotal'),
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
      reventa: toMonthlyArray(reventaByMonth, months),
    },
    objetivo: {
      sillones: objetivos.ventas.sillones,
      colchones: objetivos.ventas.colchones,
      block: objetivos.ventas.block,
      reventa: objetivos.ventas.reventa,
    },
  };
}
