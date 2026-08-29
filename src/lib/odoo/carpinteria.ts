import { searchRead } from './client';
import { withTtlCache } from '../cache';

/**
 * The BOM-de-listones table ("Bom_liston" in the sidebar, under Fabricación
 * → Tableros) isn't a real Odoo model — it's a spreadsheet embedded via
 * Odoo's Documents/Dashboard feature (`spreadsheet.dashboard`, record id
 * 37, whose own `name` field is "ProduccionTest" — the "Bom_liston" label
 * only exists as the menu entry, not the record name, so search by id here
 * rather than by name). Confirmed live: `spreadsheet_data` (the live
 * collaborative-edit log) is empty — the actual content lives in
 * `spreadsheet_snapshot`, a base64-encoded but otherwise PLAIN (uncompressed)
 * JSON blob in Odoo's internal o-spreadsheet format: `{sheets: [{cells:
 * {A1: {content: "..."}, ...}}]}`. This is undocumented/internal, not a
 * stable public API — if this ever breaks after an Odoo upgrade, re-verify
 * by reading `spreadsheet_snapshot` on this record and checking the cell
 * shape hasn't changed.
 */
const DASHBOARD_ID = 37;
const DASHBOARD_TTL_MS = 5 * 60 * 1000;

// Columns confirmed live: A=MODELO_SILLON, B=MEDIDA_LISTON, C=LARGO_LISTON_CM, D=(blank spacer), E=CANTIDAD.
const COL_MODELO = 'A';
const COL_MEDIDA = 'B';
const COL_LARGO_CM = 'C';
const COL_CANTIDAD = 'E';
const HEADER_ROW = 1;

interface SheetCell {
  content?: string;
}

interface SheetDoc {
  sheets: { cells?: Record<string, SheetCell> }[];
}

export interface BomListonRow {
  modelo: string;
  medida: string;
  largoCm: number;
  cantidad: number;
}

/** Parses every data row out of the embedded spreadsheet, normalizing medida casing (the sheet has a mix of "1x2"/"1X2"). */
function parseBomListonSheet(snapshotBase64: string): BomListonRow[] {
  const doc = JSON.parse(Buffer.from(snapshotBase64, 'base64').toString('utf8')) as SheetDoc;
  const cells = doc.sheets[0]?.cells ?? {};

  let maxRow = HEADER_ROW;
  for (const key of Object.keys(cells)) {
    const match = new RegExp(`^${COL_MODELO}(\\d+)$`).exec(key);
    if (match) maxRow = Math.max(maxRow, Number(match[1]));
  }

  const rows: BomListonRow[] = [];
  for (let r = HEADER_ROW + 1; r <= maxRow; r++) {
    const modelo = cells[`${COL_MODELO}${r}`]?.content?.trim();
    if (!modelo) continue;
    const medida = cells[`${COL_MEDIDA}${r}`]?.content?.trim().toUpperCase();
    const largoCm = Number(cells[`${COL_LARGO_CM}${r}`]?.content);
    const cantidad = Number(cells[`${COL_CANTIDAD}${r}`]?.content);
    if (!medida || !Number.isFinite(largoCm) || !Number.isFinite(cantidad)) continue;
    rows.push({ modelo, medida, largoCm, cantidad });
  }
  return rows;
}

async function getBomListonRows(): Promise<BomListonRow[]> {
  return withTtlCache('carpinteria:bom-liston-sheet', DASHBOARD_TTL_MS, async () => {
    const records = await searchRead<{ spreadsheet_snapshot: string }>({
      model: 'spreadsheet.dashboard',
      domain: [['id', '=', DASHBOARD_ID]],
      fields: ['spreadsheet_snapshot'],
      limit: 1,
    });
    const snapshot = records[0]?.spreadsheet_snapshot;
    if (!snapshot) return [];
    return parseBomListonSheet(snapshot);
  });
}

export interface ModeloCarpinteriaOption {
  name: string;
}

export interface ModeloCarpinteriaPage {
  items: ModeloCarpinteriaOption[];
  total: number;
}

/** Distinct sillón model names from the sheet, optionally filtered by name, for the picker table. */
export async function searchModelosCarpinteria(query: string | undefined, limit: number, offset: number): Promise<ModeloCarpinteriaPage> {
  const rows = await getBomListonRows();
  const allModelos = [...new Set(rows.map((r) => r.modelo))].sort((a, b) => a.localeCompare(b));

  const q = query?.trim().toLowerCase();
  const filtered = q ? allModelos.filter((m) => m.toLowerCase().includes(q)) : allModelos;

  return {
    items: filtered.slice(offset, offset + limit).map((name) => ({ name })),
    total: filtered.length,
  };
}

export interface RecetaListonRow {
  medida: string;
  largoCm: number;
  piezasPorUnidad: number;
}

/** Recipe of listones for one sillón model, aggregated straight from the curated sheet — CANTIDAD is already an exact piece count, no unit math needed. */
export async function getRecetaListones(modelo: string): Promise<RecetaListonRow[]> {
  const rows = await getBomListonRows();

  const byKey = new Map<string, RecetaListonRow>();
  for (const row of rows) {
    if (row.modelo !== modelo) continue;
    const key = `${row.medida}|${row.largoCm}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.piezasPorUnidad += row.cantidad;
    } else {
      byKey.set(key, { medida: row.medida, largoCm: row.largoCm, piezasPorUnidad: row.cantidad });
    }
  }

  return [...byKey.values()].sort((a, b) => a.medida.localeCompare(b.medida) || a.largoCm - b.largoCm);
}
