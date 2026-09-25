import { searchRead, searchReadAll, readGroup } from './client';
import { addDaysIso } from '../date';
import { BANDAS_TABLAS_FALLBACK, type BandasTablasOdoo } from '../bandas-calc';
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
  /** Resuelto por BOM contra "CODIGO DE COLORES TELAS" — null si el producto no tiene BOM cargada o su tela no está en esa tabla. */
  tela: string | null;
}

/**
 * Odoo's many2one display label is `[referencia interna] Nombre` whenever the
 * product has an internal reference set. That reference can go stale (product
 * renamed, reference left untouched) — parsing the raw label then picks up
 * whatever height/code is in the outdated reference instead of the current
 * name. Stripping the bracketed prefix keeps every downstream regex
 * (extractAlto, extractMedida) anchored to the actual name.
 */
function stripReferencePrefix(display: string): string {
  const m = display.match(/^\[[^\]]*\]\s*(.*)$/);
  return m ? m[1]! : display;
}

/**
 * Resolves each banda product's fabric color from its BOM: the first
 * component whose name matches a code in `colorPorCodigo` (e.g. "V368") wins
 * — a BOM also lists thread/backing components, but only the fabric roll's
 * code is in that table. Returns a product_id → color map; products without
 * a BOM, or whose BOM has no component in the table, are left out (render as
 * "?" downstream, same as an unmapped fabric code always did).
 */
async function resolverColorPorBom(productIds: number[], colorPorCodigo: Record<string, string>): Promise<Map<number, string>> {
  const resultado = new Map<number, string>();
  if (productIds.length === 0) return resultado;

  const productos = await searchReadAll<{ id: number; product_tmpl_id: [number, string] }>({
    model: 'product.product',
    domain: [['id', 'in', productIds]],
    fields: ['product_tmpl_id'],
  });
  const tmplIdPorProducto = new Map(productos.map((p) => [p.id, p.product_tmpl_id[0]]));
  const tmplIds = [...new Set(tmplIdPorProducto.values())];
  if (tmplIds.length === 0) return resultado;

  const boms = await searchReadAll<{ id: number; product_tmpl_id: [number, string] }>({
    model: 'mrp.bom',
    domain: [['product_tmpl_id', 'in', tmplIds]],
    fields: ['product_tmpl_id'],
  });
  if (boms.length === 0) return resultado;
  const bomIdPorTmpl = new Map(boms.map((b) => [b.product_tmpl_id[0], b.id]));

  const lineas = await searchReadAll<{ bom_id: [number, string]; product_id: [number, string] }>({
    model: 'mrp.bom.line',
    domain: [['bom_id', 'in', boms.map((b) => b.id)]],
    fields: ['bom_id', 'product_id'],
  });

  const colorPorBom = new Map<number, string>();
  for (const linea of lineas) {
    const bomId = linea.bom_id[0];
    if (colorPorBom.has(bomId)) continue;
    const color = colorPorCodigo[linea.product_id[1].toUpperCase()];
    if (color) colorPorBom.set(bomId, color);
  }

  for (const [productId, tmplId] of tmplIdPorProducto) {
    const bomId = bomIdPorTmpl.get(tmplId);
    const color = bomId !== undefined ? colorPorBom.get(bomId) : undefined;
    if (color) resultado.set(productId, color);
  }
  return resultado;
}

/** Raw (fecha, producto, cantidad, tela) rows for one planning day — the same 3 columns the manual Excel export used, now straight from Odoo, plus the color resolved from each product's BOM. */
export async function getBandasPlanificacion(dateIso: string): Promise<BandaPlanRow[]> {
  const nextDay = addDaysIso(dateIso, 1);
  const rows = await searchReadAll<{ product_id: [number, string]; product_qty: number }>({
    model: 'mrp.production',
    domain: [...BANDA_DOMAIN, ['planning_date', '>=', dateIso], ['planning_date', '<', nextDay]],
    fields: ['product_id', 'product_qty'],
  });

  const { colorPorCodigo } = await getBandasTablasOdoo();
  const productIds = [...new Set(rows.map((r) => r.product_id[0]))];
  const colorPorProducto = await resolverColorPorBom(productIds, colorPorCodigo);

  const fecha = dateIso === SIN_AGENDAR_DATE ? 'Sin agendar' : formatLabel(dateIso);
  return rows.map((r) => ({
    fecha,
    producto: stripReferencePrefix(r.product_id[1]),
    cantidad: r.product_qty,
    tela: colorPorProducto.get(r.product_id[0]) ?? null,
  }));
}

/** "Indicador_cierre" — the live Odoo dashboard whose DESPERDICIO sheet holds the alto→pillow table, the EURO/NOVOL TIEMPO table, and the CORTE ALTO DE BANDA recipe table, hand-edited on the shop floor. */
const BANDAS_DASHBOARD_ID = 38;

function colLetterToNum(letters: string): number {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function numToColLetter(num: number): string {
  let n = num;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface SpreadsheetCell {
  content?: string;
}
interface SpreadsheetSheet {
  cells?: Record<string, SpreadsheetCell>;
}
interface SpreadsheetSnapshot {
  sheets?: SpreadsheetSheet[];
}

/** Reads the numeric cells immediately to the right of `addr` (same row) until a blank/non-numeric one, e.g. the "8, 18, 8" next to "ALTO 34". */
function leerValoresConsecutivos(cells: Record<string, SpreadsheetCell>, addr: string): number[] {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  if (!m) return [];
  const valores: number[] = [];
  let col = colLetterToNum(m[1]!) + 1;
  for (;;) {
    const raw = cells[`${numToColLetter(col)}${m[2]}`]?.content;
    const text = String(raw ?? '').trim();
    if (!text) break;
    const value = Number(text);
    if (Number.isNaN(value)) break;
    valores.push(value);
    col++;
  }
  return valores;
}

/**
 * Reads the three hand-maintained tables off the Indicador_cierre dashboard
 * in one pass: any "<alto number>" cell followed (same row, next column) by
 * "si"/"no" is a pillow entry; an "EURO"/"NOVOL" label cell followed by a
 * number is a TIEMPO entry; and an "ALTO <n>" label cell followed by a run
 * of numbers is a CORTE ALTO DE BANDA recipe (the run's values, tallied by
 * how many times each repeats — e.g. "8, 18, 8" for alto 34 becomes
 * `{ 8: 2, 18: 1 }`, i.e. 2 rollos of 8cm + 1 of 18cm per rollo of 34).
 * Looked up by content rather than fixed cell addresses so the tables can be
 * edited/reordered/moved in Odoo without breaking this. The TIEMPO value is
 * stored as a day fraction, but the shop floor types it as H:MM
 * (hours:minutes) meaning what is actually a mm:ss duration, so the intended
 * seconds are `value * 24 * 60` instead of the usual `* 86400`.
 */
function parseBandasSheet(json: SpreadsheetSnapshot): Partial<BandasTablasOdoo> {
  const pillowPorAlto: Record<number, boolean> = {};
  const recetaPorAlto: Record<number, Record<number, number>> = {};
  const colorPorCodigo: Record<string, string> = {};
  let euroSeg: number | undefined;
  let novolSeg: number | undefined;

  for (const sheet of json.sheets ?? []) {
    const cells = sheet.cells ?? {};
    for (const [addr, cell] of Object.entries(cells)) {
      const content = String(cell?.content ?? '').trim();
      if (!content) continue;
      const m = addr.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const nextAddr = `${numToColLetter(colLetterToNum(m[1]!) + 1)}${m[2]}`;
      const nextContent = String(cells[nextAddr]?.content ?? '').trim();

      if (/^\d+$/.test(content) && /^(si|no)$/i.test(nextContent)) {
        pillowPorAlto[Number(content)] = nextContent.toLowerCase() === 'si';
        continue;
      }

      const altoMatch = content.match(/^ALTO\s*([\d.]+)$/i);
      if (altoMatch) {
        const valores = leerValoresConsecutivos(cells, addr);
        if (valores.length > 0) {
          const receta: Record<number, number> = {};
          for (const v of valores) receta[v] = (receta[v] ?? 0) + 1;
          recetaPorAlto[Number(altoMatch[1])] = receta;
        }
        continue;
      }

      const upper = content.toUpperCase();
      if (upper === 'EURO' || upper === 'NOVOL') {
        const value = Number(nextContent);
        if (Number.isNaN(value)) continue;
        const seg = Math.round(value * 24 * 60);
        if (upper === 'EURO') euroSeg = seg;
        else novolSeg = seg;
        continue;
      }

      // "CODIGO DE COLORES TELAS": una fila por código de tela de la BOM (ej. "V368") seguido del color.
      if (/^[A-Z]+\d+$/i.test(content) && nextContent) {
        colorPorCodigo[content.toUpperCase()] = nextContent.toUpperCase();
      }
    }
  }

  return {
    pillowPorAlto: Object.keys(pillowPorAlto).length > 0 ? pillowPorAlto : undefined,
    recetaPorAlto: Object.keys(recetaPorAlto).length > 0 ? recetaPorAlto : undefined,
    colorPorCodigo: Object.keys(colorPorCodigo).length > 0 ? colorPorCodigo : undefined,
    euroSeg,
    novolSeg,
  };
}

/** Live bandas config (alto→pillow map, EURO/NOVOL times per unit, alto→receta de corte), read straight from the Indicador_cierre dashboard — falls back to the last known-good values if a table isn't there or can't be parsed. */
export async function getBandasTablasOdoo(): Promise<BandasTablasOdoo> {
  const rows = await searchRead<{ spreadsheet_snapshot: string | false }>({
    model: 'spreadsheet.dashboard',
    domain: [['id', '=', BANDAS_DASHBOARD_ID]],
    fields: ['spreadsheet_snapshot'],
  });

  const raw = rows[0]?.spreadsheet_snapshot;
  if (!raw) return BANDAS_TABLAS_FALLBACK;

  try {
    const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as SpreadsheetSnapshot;
    const parsed = parseBandasSheet(json);
    return {
      pillowPorAlto: parsed.pillowPorAlto ?? BANDAS_TABLAS_FALLBACK.pillowPorAlto,
      euroSeg: parsed.euroSeg ?? BANDAS_TABLAS_FALLBACK.euroSeg,
      novolSeg: parsed.novolSeg ?? BANDAS_TABLAS_FALLBACK.novolSeg,
      recetaPorAlto: parsed.recetaPorAlto ?? BANDAS_TABLAS_FALLBACK.recetaPorAlto,
      colorPorCodigo: parsed.colorPorCodigo ?? BANDAS_TABLAS_FALLBACK.colorPorCodigo,
    };
  } catch {
    return BANDAS_TABLAS_FALLBACK;
  }
}
