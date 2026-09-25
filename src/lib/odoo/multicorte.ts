import { searchReadAll, readGroup } from './client';
import { fetchSpreadsheetSnapshot, parseHeaderedSheet } from './spreadsheet-snapshot';
import { addDaysIso } from '../date';
import { OdooError } from './types';
import type { OdooDomain } from './types';

/**
 * Same categ ids as the "COLCHON BANDA" filter in odoo/bandas.ts (21 "PI /
 * Bases", 22 "PI / Colchones Eps", 18 "PI / Colchones Espuma", 19 "PI /
 * Colchones Resorte") — confirmed against the user's own saved Odoo filter
 * "COLCHON PLACA POLIETER" (mrp.production, same states, `product_id ilike
 * 'plac'` instead of bandas' barcode filter).
 */
const MULTICORTE_CATEG_IDS = [21, 22, 18, 19];
const MULTICORTE_STATES = ['draft', 'confirmed', 'progress', 'to_close'];

const MULTICORTE_DOMAIN: OdooDomain = [
  ['state', 'in', MULTICORTE_STATES],
  ['product_id.categ_id', 'in', MULTICORTE_CATEG_IDS],
  ['product_id', 'ilike', 'plac'],
];

/** Odoo's many2one display label is `[referencia interna] Nombre` — strip it so the name matches the plain `nombre_producto` values in the base técnica sheet. */
function stripReferencePrefix(display: string): string {
  const m = display.match(/^\[[^\]]*\]\s*(.*)$/);
  return m ? m[1]! : display;
}

export interface DemandaRow {
  producto: string;
  cantidad: number;
}

/** Odoo's placeholder for "not scheduled yet" — not a real date (same sentinel as odoo/bandas.ts). */
const SIN_AGENDAR_DATE = '2100-01-01';

export interface MulticorteDiaOption {
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

/** Every planning day with pending demanda de multicorte, for the day selector — same pattern as odoo/bandas.ts's getBandasDias. */
export async function getMulticorteDias(): Promise<MulticorteDiaOption[]> {
  type DayGroup = { __count: number; __range?: Record<string, { from: string | false; to: string | false }> };
  const groups = await readGroup({
    model: 'mrp.production',
    domain: MULTICORTE_DOMAIN,
    fields: ['id'],
    groupBy: ['planning_date:day'],
  });

  const options: MulticorteDiaOption[] = [];
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

/** Demanda pendiente en vivo (suma de `product_qty` por producto) para un día de planificación puntual, o para todo lo pendiente si se omite `dateIso`. Reemplaza la planilla de "Planificación" que antes se subía a mano. */
export async function getMulticorteDemanda(dateIso?: string): Promise<DemandaRow[]> {
  const domain: OdooDomain = dateIso
    ? [...MULTICORTE_DOMAIN, ['planning_date', '>=', dateIso], ['planning_date', '<', addDaysIso(dateIso, 1)]]
    : MULTICORTE_DOMAIN;

  const rows = await searchReadAll<{ product_id: [number, string]; product_qty: number }>({
    model: 'mrp.production',
    domain,
    fields: ['product_id', 'product_qty'],
  });

  const byProducto = new Map<string, number>();
  for (const r of rows) {
    const nombre = stripReferencePrefix(r.product_id[1]);
    byProducto.set(nombre, (byProducto.get(nombre) ?? 0) + r.product_qty);
  }
  return [...byProducto.entries()].map(([producto, cantidad]) => ({ producto, cantidad }));
}

/**
 * "Medidas_multicorte" (Tableros → Fabricación) isn't a real Odoo model —
 * confirmed live it's `spreadsheet.dashboard` id 39 — same embedded-sheet
 * mechanism as "Bom_liston" (id 37, see odoo/carpinteria.ts). Two data
 * sheets: `base_de_datos_colchones` (745 rows) and `base_de_datos_block`
 * (36 rows), each with a header row matching the column names below.
 */
const MULTICORTE_DASHBOARD_ID = 39;
const MULTICORTE_DASHBOARD_LABEL = 'Medidas_multicorte';
const SHEET_COLCHONES = 'base_de_datos_colchones';
const SHEET_BLOCKS = 'base_de_datos_block';

/**
 * `base_de_datos_colchones` has one row per FINISHED mattress product
 * (`nombre_producto`, e.g. "POCKET SUREN 200X200X28EURO P"), but the
 * `mrp.production` demand this filter reads is for the PLACA itself
 * (`nombre_placa`, e.g. "VERDE PLACA 200X200X3") — confirmed live: none of
 * the demand product names match `nombre_producto` at all, every one
 * matches `nombre_placa` instead. Several finished-mattress rows share the
 * same `nombre_placa` (same cut dims/color, encoded in the placa's own
 * name) — dedup down to one spec per distinct placa. `cant_placas`
 * (mattress→placa multiplier) does NOT apply here: the demand is already
 * denominated in placas (the MO's own `product_qty`), not finished
 * mattresses, so there's no unit conversion to do.
 */
export interface PlacaSpec {
  nombrePlaca: string;
  colorBlock: string;
  corteAnchoCm: number;
  corteLargoCm: number;
  corteAltoCm: number;
}

export interface BlockSpec {
  colorBlock: string;
  anchoBlockCm: number;
  largoBlockCm: number;
  altoBlockCm: number;
}

function parseNumber(raw: string, field: string, row: Record<string, string>): number {
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) {
    throw new OdooError(`Valor numérico inválido en "${field}" (${JSON.stringify(row)}) de ${MULTICORTE_DASHBOARD_LABEL}`);
  }
  return n;
}

/**
 * `nombre_producto` (colchón terminado, ej. "POCKET SUREN 200X200X28EURO P")
 * → `nombre_placa` que le corresponde + `cant_placas`, el multiplicador
 * colchón→placa. Solo se usa para la carga manual (el demand feed de Odoo ya
 * viene denominado en placas, ver comentario de `getMulticorteDemanda`).
 */
export interface ProductoPlacaSpec {
  nombreProducto: string;
  nombrePlaca: string;
  cantPlacas: number;
}

export interface BaseTecnicaMulticorte {
  placas: PlacaSpec[];
  blocks: BlockSpec[];
  productos: ProductoPlacaSpec[];
}

export async function getMulticorteBaseTecnica(): Promise<BaseTecnicaMulticorte> {
  const doc = await fetchSpreadsheetSnapshot(MULTICORTE_DASHBOARD_ID, MULTICORTE_DASHBOARD_LABEL);

  const colchonRows = parseHeaderedSheet(doc, SHEET_COLCHONES, MULTICORTE_DASHBOARD_LABEL);
  const byPlaca = new Map<string, PlacaSpec>();
  const byProducto = new Map<string, ProductoPlacaSpec>();
  for (const r of colchonRows) {
    const nombrePlaca = r.nombre_placa?.trim();
    if (!nombrePlaca) continue;

    if (!byPlaca.has(nombrePlaca)) {
      byPlaca.set(nombrePlaca, {
        nombrePlaca,
        colorBlock: (r.color_block ?? '').trim().toLowerCase(),
        corteAnchoCm: parseNumber(r.corte_ancho_cm ?? '', 'corte_ancho_cm', r),
        corteLargoCm: parseNumber(r.corte_largo_cm ?? '', 'corte_largo_cm', r),
        corteAltoCm: parseNumber(r.corte_alto_cm ?? '', 'corte_alto_cm', r),
      });
    }

    // cant_placas is best-effort here (unlike the fields above, it's new to
    // this codepath and wasn't previously validated) — a row with a blank/bad
    // value just doesn't get a manual-paste mapping, it must not break the
    // live Odoo-demand plan that the rest of this function still serves.
    const nombreProducto = r.nombre_producto?.trim();
    const cantPlacasRaw = Number((r.cant_placas ?? '').replace(',', '.'));
    if (nombreProducto && Number.isFinite(cantPlacasRaw) && cantPlacasRaw > 0 && !byProducto.has(nombreProducto)) {
      byProducto.set(nombreProducto, { nombreProducto, nombrePlaca, cantPlacas: cantPlacasRaw });
    }
  }
  const placas = [...byPlaca.values()];
  const productos = [...byProducto.values()];

  const blockRows = parseHeaderedSheet(doc, SHEET_BLOCKS, MULTICORTE_DASHBOARD_LABEL);
  const blocks: BlockSpec[] = blockRows
    .filter((r) => r.color_block)
    .map((r) => ({
      colorBlock: r.color_block!.trim().toLowerCase(),
      anchoBlockCm: parseNumber(r.ancho_block_cm ?? '', 'ancho_block_cm', r),
      largoBlockCm: parseNumber(r.largo_block_cm ?? '', 'largo_block_cm', r),
      altoBlockCm: parseNumber(r.alto_block_cm ?? '', 'alto_block_cm', r),
    }));

  return { placas, blocks, productos };
}
