import { searchReadAll, readGroup } from './client';
import { fetchSpreadsheetSnapshot, parseHeaderedSheet } from './spreadsheet-snapshot';
import { addDaysIso } from '../date';
import { OdooError } from './types';
import type { OdooDomain } from './types';

/**
 * "SILLON POLIESTER ALMOHADON" — el filtro guardado del usuario en Odoo:
 * categ_id 15, product_id conteniendo "PIP2". Mismos estados que
 * Multicorte/Bandas (ver odoo/multicorte.ts).
 */
const VERTICAL_CATEG_IDS = [15];
const VERTICAL_STATES = ['draft', 'confirmed', 'progress', 'to_close'];

const VERTICAL_DOMAIN: OdooDomain = [
  ['state', 'in', VERTICAL_STATES],
  ['product_id.categ_id', 'in', VERTICAL_CATEG_IDS],
  ['product_id', 'ilike', 'PIP2'],
];

/** Odoo's many2one display label is `[referencia interna] Nombre` — strip it so the name matches the plain `nombre_producto` values in COMPLETO. */
function stripReferencePrefix(display: string): string {
  const m = display.match(/^\[[^\]]*\]\s*(.*)$/);
  return m ? m[1]! : display;
}

/** Odoo's placeholder for "not scheduled yet" — not a real date (same sentinel as odoo/multicorte.ts). */
const SIN_AGENDAR_DATE = '2100-01-01';

export interface VerticalDiaOption {
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

/** Cada día de planificación con demanda pendiente de "SILLON POLIESTER ALMOHADON", para el selector de día. */
export async function getVerticalDias(): Promise<VerticalDiaOption[]> {
  type DayGroup = { __count: number; __range?: Record<string, { from: string | false; to: string | false }> };
  const groups = await readGroup({
    model: 'mrp.production',
    domain: VERTICAL_DOMAIN,
    fields: ['id'],
    groupBy: ['planning_date:day'],
  });

  const options: VerticalDiaOption[] = [];
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

export interface DemandaRow {
  producto: string;
  cantidad: number;
}

/** Demanda pendiente en vivo (suma de `product_qty` por producto) para un día de planificación puntual. */
export async function getVerticalDemanda(dateIso: string): Promise<DemandaRow[]> {
  const domain: OdooDomain = [...VERTICAL_DOMAIN, ['planning_date', '>=', dateIso], ['planning_date', '<', addDaysIso(dateIso, 1)]];

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
 * "Bom_poliester_soft" (Tableros → Fabricación) es `spreadsheet.dashboard`
 * id 42 — confirmado en vivo (2026-09), mismo mecanismo de spreadsheet
 * embebido que "Medidas_multicorte" (id 39, ver odoo/multicorte.ts) y
 * "Bom_liston" (id 37, ver odoo/carpinteria.ts). Dos hojas: COMPLETO (309
 * filas: producto → cortes que lleva) y BLOCKS (14 filas: tamaños de block
 * disponibles por color).
 */
const VERTICAL_DASHBOARD_ID = 42;
const VERTICAL_DASHBOARD_LABEL = 'Bom_poliester_soft';
const SHEET_COMPLETO = 'COMPLETO';
const SHEET_BLOCKS = 'BLOCKS';

/** Color reservado para piezas hechas de retazo/sobrante — se ignoran del cálculo de necesidad (indicación explícita del usuario). */
export const COLOR_DE_RETAZO = 'de retazo';

export interface CorteSpec {
  nombreProducto: string;
  colorBlock: string;
  corteAnchoCm: number;
  corteLargoCm: number;
  corteAltoCm: number;
  cantPlacas: number;
  ubicacion: string;
}

export interface BlockSpec {
  colorBlock: string;
  anchoBlockCm: number;
  largoBlockCm: number;
  altoBlockCm: number;
  densidadBlock: number;
}

function parseNumber(raw: string, field: string, row: Record<string, string>): number {
  const n = Number((raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) {
    throw new OdooError(`Valor numérico inválido en "${field}" (${JSON.stringify(row)}) de ${VERTICAL_DASHBOARD_LABEL}`);
  }
  return n;
}

export interface BaseTecnicaVertical {
  cortes: CorteSpec[];
  blocks: BlockSpec[];
}

export async function getVerticalBaseTecnica(): Promise<BaseTecnicaVertical> {
  const doc = await fetchSpreadsheetSnapshot(VERTICAL_DASHBOARD_ID, VERTICAL_DASHBOARD_LABEL);

  const completoRows = parseHeaderedSheet(doc, SHEET_COMPLETO, VERTICAL_DASHBOARD_LABEL);
  const cortes: CorteSpec[] = completoRows
    .filter((r) => r.nombre_producto)
    .map((r) => ({
      nombreProducto: r.nombre_producto!.trim(),
      colorBlock: (r.color_block ?? '').trim().toLowerCase(),
      corteAnchoCm: parseNumber(r.corte_ancho_cm ?? '', 'corte_ancho_cm', r),
      corteLargoCm: parseNumber(r.corte_largo_cm ?? '', 'corte_largo_cm', r),
      corteAltoCm: parseNumber(r.corte_alto_cm ?? '', 'corte_alto_cm', r),
      cantPlacas: parseNumber(r.cant_placas ?? '', 'cant_placas', r),
      // parseHeaderedSheet lowercases headers, so "UBICACIÓN" comes back as "ubicación".
      ubicacion: (r['ubicación'] ?? r.ubicacion ?? '').trim(),
    }));

  const blockRows = parseHeaderedSheet(doc, SHEET_BLOCKS, VERTICAL_DASHBOARD_LABEL);
  const blocks: BlockSpec[] = blockRows
    .filter((r) => r.color_block)
    .map((r) => ({
      colorBlock: r.color_block!.trim().toLowerCase(),
      anchoBlockCm: parseNumber(r.ancho_block_cm ?? '', 'ancho_block_cm', r),
      largoBlockCm: parseNumber(r.largo_block_cm ?? '', 'largo_block_cm', r),
      altoBlockCm: parseNumber(r.alto_block_cm ?? '', 'alto_block_cm', r),
      densidadBlock: parseNumber(r.densidad_block ?? '', 'densidad_block', r),
    }));

  return { cortes, blocks };
}
