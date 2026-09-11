import { searchReadAll, readGroup } from './client';
import { addDaysIso } from '../date';
import type { OdooDomain } from './types';

/**
 * Mirrors Odoo's own saved "COLCHON BANDA" filter exactly (Fabricación >
 * Órdenes de fabricación, `ir.filters` id 138/492 — confirmed live, same
 * per-day counts as that filter's grouped list view). Category ids: 21 "PI
 * / Bases", 22 "PI / Colchones Eps", 18 "PI / Colchones Espuma", 19 "PI /
 * Colchones Resorte" — the barcode pattern (contains "BD", excludes
 * "BDBOLIM") is what that filter actually uses to isolate banda orders
 * within those categories, not the "BANDA-" product-name prefix.
 */
const BANDA_CATEG_IDS = [21, 22, 18, 19];
const BANDA_STATES = ['draft', 'confirmed', 'progress', 'to_close'];

const BANDA_DOMAIN: OdooDomain = [
  ['state', 'in', BANDA_STATES],
  ['product_id.categ_id', 'in', BANDA_CATEG_IDS],
  ['product_id.barcode', 'ilike', 'BD'],
  ['product_id.barcode', 'not ilike', 'BDBOLIM'],
];

/** Odoo's placeholder for "not scheduled yet" — not a real date. */
const SIN_AGENDAR_DATE = '2100-01-01';

export interface BandaDiaOption {
  /** ISO date, or the `SIN_AGENDAR_DATE` sentinel when `sinAgendar` is true. */
  date: string;
  label: string;
  count: number;
  sinAgendar: boolean;
}

function formatLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const label = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Every planning day with pending banda orders, grouped exactly like Odoo's own "COLCHON BANDA" list view — including the "sin agendar" bucket. */
export async function getBandasDias(): Promise<BandaDiaOption[]> {
  type DayGroup = { __count: number; __range?: Record<string, { from: string | false; to: string | false }> };
  const groups = await readGroup({
    model: 'mrp.production',
    domain: BANDA_DOMAIN,
    fields: ['id'],
    groupBy: ['planning_date:day'],
  });

  const options: BandaDiaOption[] = [];
  for (const g of groups as unknown as DayGroup[]) {
    const from = g.__range?.['planning_date:day']?.from;
    if (!from) continue;
    const date = from.slice(0, 10);
    const sinAgendar = date === SIN_AGENDAR_DATE;
    options.push({ date, label: sinAgendar ? 'Sin agendar' : formatLabel(date), count: g.__count, sinAgendar });
  }

  return options.sort((a, b) => {
    if (a.sinAgendar !== b.sinAgendar) return a.sinAgendar ? 1 : -1;
    return a.date.localeCompare(b.date);
  });
}

export interface BandaPlanRow {
  fecha: string;
  producto: string;
  cantidad: number;
}

/**
 * Odoo's many2one display label is `[referencia interna] Nombre` whenever the
 * product has an internal reference set. That reference can go stale (product
 * renamed, reference left untouched) — parsing the raw label then picks up
 * whatever height/code is in the outdated reference instead of the current
 * name. Stripping the bracketed prefix keeps every downstream regex
 * (extractAlto, extractMedida, extractCodigo) anchored to the actual name.
 */
function stripReferencePrefix(display: string): string {
  const m = display.match(/^\[[^\]]*\]\s*(.*)$/);
  return m ? m[1]! : display;
}

/** Raw (fecha, producto, cantidad) rows for one planning day — the same 3 columns the manual Excel export used, now straight from Odoo. */
export async function getBandasPlanificacion(dateIso: string): Promise<BandaPlanRow[]> {
  const nextDay = addDaysIso(dateIso, 1);
  const rows = await searchReadAll<{ product_id: [number, string]; product_qty: number }>({
    model: 'mrp.production',
    domain: [...BANDA_DOMAIN, ['planning_date', '>=', dateIso], ['planning_date', '<', nextDay]],
    fields: ['product_id', 'product_qty'],
  });

  const fecha = dateIso === SIN_AGENDAR_DATE ? 'Sin agendar' : formatLabel(dateIso);
  return rows.map((r) => ({ fecha, producto: stripReferencePrefix(r.product_id[1]), cantidad: r.product_qty }));
}
