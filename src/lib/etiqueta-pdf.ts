import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Server-side PDF generator for the "etiqueta de corte" — the old Python
 * app (reportlab) had no design reference left to port 1:1 (no screenshot,
 * no source file available), so this is a fresh reimplementation of the
 * plan's description: two columns (1x2 vs. otras medidas), font/row height
 * that shrinks as item count grows so everything fits without looking
 * cramped, and — if it STILL doesn't fit even at the minimum readable size
 * — spilling onto additional pages rather than silently clipping content
 * off the label (a real risk on a factory floor tool).
 */

export interface EtiquetaListonRow {
  medida: string;
  largoCm: number;
  piezas: number;
}

export interface EtiquetaInput {
  fecha: string; // "YYYY-MM-DD"
  linea: string;
  modelos: string[];
  filas1x2: EtiquetaListonRow[];
  filasOtras: EtiquetaListonRow[];
}

// A5 portrait — a compact "etiqueta" rather than a full A4 sheet, still
// prints fine on any standard printer (falls back to centered-on-A4 if the
// tray doesn't support A5 directly).
const PAGE_WIDTH = 420;
const PAGE_HEIGHT = 595;
const MARGIN = 28;
const COLUMN_GAP = 16;
const HEADER_HEIGHT = 128;
const FOOTER_MARGIN = 16;

const MIN_ROW_HEIGHT = 13;
const MAX_ROW_HEIGHT = 22;
const MIN_FONT_SIZE = 7;
const MAX_FONT_SIZE = 11;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function fechaLabel(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function piezasLabel(piezas: number): string {
  return Number.isInteger(piezas) ? String(piezas) : piezas.toFixed(2);
}

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').trim();
}

/** "{modelo}" if the whole pedido was one model, "VARIOS MODELOS" otherwise — per the plan's naming rule. */
export function buildEtiquetaFilename(modelos: string[], linea: string): string {
  const modeloPart = modelos.length === 1 ? modelos[0]! : 'VARIOS MODELOS';
  return `${sanitizeFilenamePart(modeloPart)} - LINEA ${sanitizeFilenamePart(linea)}.pdf`;
}

function drawHeader(
  page: PDFPage,
  font: PDFFont,
  boldFont: PDFFont,
  modeloLabel: string,
  fecha: string,
  linea: string,
  pageIndex: number,
  pageCount: number
): void {
  let y = PAGE_HEIGHT - MARGIN;
  page.drawText('FRONTERA LIVING', { x: MARGIN, y: y - 16, size: 16, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Etiqueta de Corte — Listones', { x: MARGIN, y: y - 34, size: 10, font, color: rgb(0.4, 0.4, 0.4) });

  if (pageCount > 1) {
    const label = `Página ${pageIndex + 1}/${pageCount}`;
    page.drawText(label, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(label, 9), y: y - 16, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  }

  y -= 56;
  page.drawText(`Modelo: ${modeloLabel}`, { x: MARGIN, y, size: 12, font: boldFont });
  y -= 18;
  page.drawText(`Línea: ${linea}`, { x: MARGIN, y, size: 10, font });
  page.drawText(`Fecha: ${fechaLabel(fecha)}`, { x: MARGIN + 150, y, size: 10, font });

  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.75, 0.75, 0.75) });
}

function drawColumn(
  page: PDFPage,
  x: number,
  topY: number,
  width: number,
  title: string,
  rows: EtiquetaListonRow[],
  font: PDFFont,
  boldFont: PDFFont,
  fontSize: number,
  rowHeight: number,
  showMedida: boolean
): void {
  let y = topY;
  page.drawText(title, { x, y, size: fontSize + 2, font: boldFont });
  y -= rowHeight;

  const medidaX = x;
  const largoX = x + width * (showMedida ? 0.32 : 0);
  const piezasX = x + width * (showMedida ? 0.72 : 0.6);

  if (showMedida) page.drawText('Medida', { x: medidaX, y, size: fontSize, font: boldFont });
  page.drawText('Largo (cm)', { x: largoX, y, size: fontSize, font: boldFont });
  page.drawText('Piezas', { x: piezasX, y, size: fontSize, font: boldFont });
  y -= rowHeight;

  if (rows.length === 0) {
    page.drawText('—', { x, y, size: fontSize, font, color: rgb(0.55, 0.55, 0.55) });
    return;
  }

  for (const row of rows) {
    if (showMedida) page.drawText(row.medida, { x: medidaX, y, size: fontSize, font });
    page.drawText(String(row.largoCm), { x: largoX, y, size: fontSize, font });
    page.drawText(piezasLabel(row.piezas), { x: piezasX, y, size: fontSize, font });
    y -= rowHeight;
  }
}

export async function generateEtiquetaPdf(input: EtiquetaInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const columnWidth = (PAGE_WIDTH - MARGIN * 2 - COLUMN_GAP) / 2;
  const availableHeight = PAGE_HEIGHT - MARGIN * 2 - HEADER_HEIGHT - FOOTER_MARGIN;

  const maxRows = Math.max(input.filas1x2.length, input.filasOtras.length, 1);
  // +2 for the column title row and the header row above the data rows.
  const rowHeight = clamp(availableHeight / (maxRows + 2), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  const fontSize = clamp(rowHeight * 0.55, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const rowsPerPage = Math.max(1, Math.floor(availableHeight / rowHeight) - 2);

  const modeloLabel = input.modelos.length === 0 ? '(sin modelos)' : input.modelos.length === 1 ? input.modelos[0]! : 'VARIOS MODELOS';
  const pageCount = Math.max(1, Math.ceil(maxRows / rowsPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, font, boldFont, modeloLabel, input.fecha, input.linea, pageIndex, pageCount);

    const start = pageIndex * rowsPerPage;
    const slice1x2 = input.filas1x2.slice(start, start + rowsPerPage);
    const sliceOtras = input.filasOtras.slice(start, start + rowsPerPage);
    const tableTop = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT;

    drawColumn(page, MARGIN, tableTop, columnWidth, 'LISTONES 1x2', slice1x2, font, boldFont, fontSize, rowHeight, false);
    drawColumn(page, MARGIN + columnWidth + COLUMN_GAP, tableTop, columnWidth, 'OTRAS MEDIDAS', sliceOtras, font, boldFont, fontSize, rowHeight, true);
  }

  return doc.save();
}
