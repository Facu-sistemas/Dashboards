import { searchRead } from './client';
import { OdooError } from './types';

/**
 * Generic reader for Odoo's embedded-spreadsheet ("Tableros"/Dashboards)
 * feature. These aren't real business models — they're a `spreadsheet.dashboard`
 * record whose `spreadsheet_snapshot` field holds a base64-encoded, otherwise
 * PLAIN (uncompressed) JSON blob in Odoo's internal o-spreadsheet format:
 * `{sheets: [{name, cells: {A1: {content: "..."}, ...}}]}`. This is
 * undocumented/internal, not a stable public API — confirmed live against
 * `spreadsheet.dashboard` id 37 (see odoo/carpinteria.ts) and id 39
 * (Medidas_multicorte). If parsing ever breaks after an Odoo upgrade,
 * re-verify by reading `spreadsheet_snapshot` on the record directly and
 * checking the cell shape hasn't changed.
 */

interface SheetCell {
  content?: string;
}

interface Sheet {
  name?: string;
  cells?: Record<string, SheetCell>;
}

interface SheetDoc {
  sheets: Sheet[];
}

/**
 * No caching here on purpose (see odoo/carpinteria.ts): a page refresh must
 * always reflect the latest edits made in Odoo, and this is a single-row,
 * single-field read — cheap enough to hit Odoo fresh every time.
 */
export async function fetchSpreadsheetSnapshot(dashboardId: number, label: string): Promise<SheetDoc> {
  const records = await searchRead<{ spreadsheet_snapshot: string }>({
    model: 'spreadsheet.dashboard',
    domain: [['id', '=', dashboardId]],
    fields: ['spreadsheet_snapshot'],
    limit: 1,
  });
  const snapshot = records[0]?.spreadsheet_snapshot;
  if (!snapshot) {
    throw new OdooError(`No se encontró "${label}" en Odoo (spreadsheet.dashboard id=${dashboardId})`);
  }
  let doc: SheetDoc;
  try {
    doc = JSON.parse(Buffer.from(snapshot, 'base64').toString('utf8')) as SheetDoc;
  } catch (err) {
    throw new OdooError(`No se pudo leer "${label}" (formato inesperado) — puede haber cambiado tras una actualización de Odoo`, err);
  }
  if (!Array.isArray(doc.sheets)) {
    throw new OdooError(`No se pudo leer "${label}" (formato inesperado) — puede haber cambiado tras una actualización de Odoo`);
  }
  return doc;
}

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Parses one sheet with a header row (row 1 = column names) into an array of
 * plain objects keyed by the (lowercased, trimmed) header text — for tables
 * like `base_de_datos_colchones`/`base_de_datos_block` where columns aren't
 * fixed letters (unlike the Bom_liston sheet in odoo/carpinteria.ts, which
 * has hardcoded column letters and doesn't use this).
 */
export function parseHeaderedSheet(doc: SheetDoc, sheetName: string, label: string): Record<string, string>[] {
  const sheet = doc.sheets.find((s) => s.name === sheetName);
  if (!sheet?.cells) {
    throw new OdooError(`No se encontró la hoja "${sheetName}" en "${label}"`);
  }
  const cells = sheet.cells;

  const headerByCol = new Map<number, string>();
  let maxCol = -1;
  let maxRow = 1;
  for (const key of Object.keys(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(key);
    if (!match) continue;
    const col = colLetterToIndex(match[1]!);
    const row = Number(match[2]);
    if (row === 1) {
      const header = cells[key]?.content?.trim().toLowerCase();
      if (header) {
        headerByCol.set(col, header);
        maxCol = Math.max(maxCol, col);
      }
    }
    maxRow = Math.max(maxRow, row);
  }
  if (headerByCol.size === 0) {
    throw new OdooError(`No se pudo leer el encabezado de la hoja "${sheetName}" en "${label}"`);
  }

  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= maxRow; r++) {
    const rowObj: Record<string, string> = {};
    let hasValue = false;
    for (let c = 0; c <= maxCol; c++) {
      const header = headerByCol.get(c);
      if (!header) continue;
      const colLetters = indexToColLetter(c);
      const content = cells[`${colLetters}${r}`]?.content?.trim();
      if (content) hasValue = true;
      rowObj[header] = content ?? '';
    }
    if (hasValue) rows.push(rowObj);
  }
  return rows;
}

function indexToColLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
