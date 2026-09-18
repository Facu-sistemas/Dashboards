import { fetchLatestDashboardShareSnapshot, colLetterToIndex, type SheetDoc } from './spreadsheet-snapshot';
import { OdooError } from './types';

/**
 * "Objetivos" — the ONE manually-typed table this whole area is allowed to
 * depend on (per explicit instruction: everything else must be computed
 * from Odoo's real transactional data or in code, not hand-loaded). Lives
 * in Odoo as `spreadsheet.dashboard` id 40 ("Reunión de equipo de
 * gestión") — the same dashboard the team's own share link
 * (grupofrontera.odoo.com/dashboard/share/74/...) points at. Confirmed
 * live (2026-09-18): 18 fixed rows, no formulas, columns C..N = Ene..Dic,
 * O = Total. Row labels below are matched by normalized text (accents/case
 * stripped) rather than hardcoded row numbers — same defensive pattern
 * tabla.gs (the Google Sheets version of this dashboard, see public/data/)
 * uses, so inserting/reordering a row in Odoo doesn't silently break this.
 */

const DASHBOARD_ID = 40;
const DASHBOARD_LABEL = 'Reunión de equipo de gestión';
const MONTH_COL_START = 2; // column C (0-indexed) = Enero
const MONTH_COL_END = 13; // column N = Diciembre

export interface ObjetivosGerencia {
  /** 12 entries, Ene..Dic. */
  diasTranscurridos: number[];
  diasTotal: number[];
  ventas: { sillones: number[]; colchones: number[]; block: number[]; reventa: number[] };
  produccion: { sillones: number[]; colchones: number[] };
  facturacionUnidades: { sillones: number[]; colchones: number[]; block: number[] };
  facturacionPesos: { total: number[] };
}

function normalize(s: string | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumberEsAr(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.trim();
  if (s.startsWith('#')) return 0; // #DIV/0!, #REF!, etc.
  s = s.replace(/[^0-9,.\-]/g, '');
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

interface Row {
  label: string;
  values: number[];
}

function readRows(doc: SheetDoc): Row[] {
  const sheet = doc.sheets[0];
  if (!sheet?.cells) throw new OdooError(`No se pudo leer "${DASHBOARD_LABEL}" (hoja vacía)`);
  const cells = sheet.cells;

  const byRow = new Map<number, Map<number, string>>();
  let maxRow = 0;
  for (const key of Object.keys(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(key);
    if (!match) continue;
    const col = colLetterToIndex(match[1]!);
    const row = Number(match[2]);
    maxRow = Math.max(maxRow, row);
    const content = cells[key]?.content;
    if (content === undefined) continue;
    if (!byRow.has(row)) byRow.set(row, new Map());
    byRow.get(row)!.set(col, content);
  }

  const rows: Row[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const rowCells = byRow.get(r);
    const label = rowCells?.get(0) ?? '';
    const values: number[] = [];
    for (let c = MONTH_COL_START; c <= MONTH_COL_END; c++) {
      values.push(parseNumberEsAr(rowCells?.get(c)));
    }
    rows.push({ label, values });
  }
  return rows;
}

function find(rows: Row[], from: number, to: number, ...labels: string[]): Row | undefined {
  const normLabels = labels.map(normalize);
  for (let i = Math.max(0, from); i < Math.min(rows.length, to); i++) {
    if (normLabels.includes(normalize(rows[i]!.label))) return rows[i];
  }
  return undefined;
}

function sectionStart(rows: Row[], ...labels: string[]): number {
  const normLabels = labels.map(normalize);
  const idx = rows.findIndex((r) => normLabels.includes(normalize(r.label)));
  return idx === -1 ? rows.length : idx;
}

function values(row: Row | undefined): number[] {
  return row?.values ?? new Array(12).fill(0);
}

export async function getObjetivosGerencia(): Promise<ObjetivosGerencia> {
  const doc = await fetchLatestDashboardShareSnapshot(DASHBOARD_ID, DASHBOARD_LABEL);
  const rows = readRows(doc);

  const produccionStart = sectionStart(rows, 'produccion consensuado');
  const facturacionStart = sectionStart(rows, 'facturacion consensuado');

  const diasTranscurridos = values(find(rows, 0, rows.length, 'dias habil trascurrido en el mes'));
  const diasTotal = values(find(rows, 0, rows.length, 'dias habil del mes'));

  // VENTAS CONSENSUADO block: from the top (no header row precedes it in
  // this dashboard) up to "PRODUCCION CONSENSUADO".
  const ventasSillones = values(find(rows, 0, produccionStart, 'consensuado sillones equivalente'));
  const ventasColchones = values(find(rows, 0, produccionStart, 'consensuado colchones unidad'));
  const ventasBlock = values(find(rows, 0, produccionStart, 'plande venta block', 'plan de venta block'));
  const ventasReventa = values(find(rows, 0, produccionStart, 'consensuado reventa en $', 'concensuado reventa en $'));

  // PRODUCCION CONSENSUADO block: up to "FACTURACION CONSENSUADO".
  const produccionSillones = values(find(rows, produccionStart, facturacionStart, 'consensuado sillones equivalente'));
  const produccionColchones = values(find(rows, produccionStart, facturacionStart, 'consensuado colchones unidad'));

  // FACTURACION CONSENSUADO block: to the end.
  const facturacionSillones = values(find(rows, facturacionStart, rows.length, 'consensuado sillones equivalente'));
  const facturacionColchones = values(find(rows, facturacionStart, rows.length, 'consensuado colchones unidad'));
  const facturacionBlock = values(find(rows, facturacionStart, rows.length, 'consensuado block equivalente'));
  const facturacionPesos = values(find(rows, facturacionStart, rows.length, 'concensuado en $', 'consensuado en $'));

  return {
    diasTranscurridos,
    diasTotal,
    ventas: { sillones: ventasSillones, colchones: ventasColchones, block: ventasBlock, reventa: ventasReventa },
    produccion: { sillones: produccionSillones, colchones: produccionColchones },
    facturacionUnidades: { sillones: facturacionSillones, colchones: facturacionColchones, block: facturacionBlock },
    facturacionPesos: { total: facturacionPesos },
  };
}
