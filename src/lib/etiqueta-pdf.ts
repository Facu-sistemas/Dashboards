import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Server-side PDF generator for the "etiqueta de corte" — printed on a
 * Zebra label printer, so the page is a fixed 10x10cm square (not a
 * regular sheet size) and every constant below is tuned for that tiny
 * canvas: small fonts, abbreviated column headers, and a header block
 * that grows/shrinks with how many models are wrapped onto it. If the
 * listones table still doesn't fit even at the minimum readable size, it
 * spills onto additional 10x10cm pages rather than clipping content.
 */

export interface EtiquetaListonRow {
  medida: string;
  largoCm: number;
  piezas: number;
}

export interface EtiquetaModelo {
  modelo: string;
  cantidad: number;
}

export interface EtiquetaInput {
  fecha: string; // "YYYY-MM-DD"
  linea: string;
  modelos: EtiquetaModelo[];
  filas1x2: EtiquetaListonRow[];
  filasOtras: EtiquetaListonRow[];
}

// Zebra label: 10x10cm square.
const CM_TO_PT = 72 / 2.54;
const PAGE_SIZE = 10 * CM_TO_PT;

const MARGIN = 10;
const COLUMN_GAP = 8;
const FOOTER_MARGIN = 6;

// 1.5x the original tuning per the user's explicit request — the factory
// floor found the first pass too small to read at a glance.
const TITLE_FONT_SIZE = 15;
const PAGE_INDEX_FONT_SIZE = 9;
const MODELOS_FONT_SIZE = 10.5;
const MODELOS_LINE_HEIGHT = 13.5;
const META_FONT_SIZE = 10.5;
const META_LINE_HEIGHT = 15;
const GAP_AFTER_TITLE = 7.5;
const GAP_AFTER_MODELOS = 4.5;
const GAP_AFTER_META = 7.5;
const GAP_BEFORE_TABLE = 21;

const MIN_ROW_HEIGHT = 12;
const MAX_ROW_HEIGHT = 19.5;
const MIN_FONT_SIZE = 8.25;
const MAX_FONT_SIZE = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function fechaLabel(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fechaFilenamePart(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function countLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').trim();
}

/** "Linea_{linea}-{fecha}.pdf" — per the factory's naming convention for these labels. */
export function buildEtiquetaFilename(linea: string, fecha: string): string {
  return `Linea_${sanitizeFilenamePart(linea)}-${fechaFilenamePart(fecha)}.pdf`;
}

/** "2xAero Rinconero, 1xMarea Soft" — aggregated quantity per model, not just the model names. */
function buildModelosLabel(modelos: EtiquetaModelo[]): string {
  if (modelos.length === 0) return '(sin modelos)';
  return modelos.map((m) => `${countLabel(m.cantidad)}x${m.modelo}`).join(', ');
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current === '' || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawHeader(
  page: PDFPage,
  font: PDFFont,
  boldFont: PDFFont,
  modelosLines: string[],
  fecha: string,
  linea: string,
  pageIndex: number,
  pageCount: number
): number {
  let y = PAGE_SIZE - MARGIN - TITLE_FONT_SIZE;
  page.drawText('FRONTERA LIVING', { x: MARGIN, y, size: TITLE_FONT_SIZE, font: boldFont, color: rgb(0.1, 0.1, 0.1) });

  if (pageCount > 1) {
    const label = `${pageIndex + 1}/${pageCount}`;
    page.drawText(label, {
      x: PAGE_SIZE - MARGIN - font.widthOfTextAtSize(label, PAGE_INDEX_FONT_SIZE),
      y,
      size: PAGE_INDEX_FONT_SIZE,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  }
  y -= GAP_AFTER_TITLE;

  for (const line of modelosLines) {
    y -= MODELOS_LINE_HEIGHT;
    page.drawText(line, { x: MARGIN, y, size: MODELOS_FONT_SIZE, font: boldFont });
  }
  y -= GAP_AFTER_MODELOS;

  y -= META_LINE_HEIGHT;
  page.drawText(`Línea: ${linea}`, { x: MARGIN, y, size: META_FONT_SIZE, font });
  const fechaText = `Fecha: ${fechaLabel(fecha)}`;
  page.drawText(fechaText, { x: PAGE_SIZE - MARGIN - font.widthOfTextAtSize(fechaText, META_FONT_SIZE), y, size: META_FONT_SIZE, font });
  y -= GAP_AFTER_META;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_SIZE - MARGIN, y }, thickness: 0.75, color: rgb(0.75, 0.75, 0.75) });
  y -= GAP_BEFORE_TABLE;

  return y;
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
  // Capped independently of fontSize — at the max body size, "OTRAS
  // MEDIDAS" would otherwise overflow past the half-page column width.
  page.drawText(title, { x, y, size: Math.min(fontSize, 15), font: boldFont });
  y -= rowHeight;

  // Two slots, not three — at the (doubled) font size this is tuned for,
  // "Medida" + "Largo(cm)" + "Cant." side by side no longer fits a
  // ~half-page column without overlapping. "Otras medidas" folds medida
  // and largo into one "1X3X700"-style value, same shape the "1x2" side
  // already used.
  const valueX = x;
  const piezasX = x + width * 0.62;

  page.drawText(showMedida ? 'Medida' : 'Largo(cm)', { x: valueX, y, size: fontSize, font: boldFont });
  page.drawText('Cant.', { x: piezasX, y, size: fontSize, font: boldFont });
  y -= rowHeight;

  if (rows.length === 0) {
    page.drawText('—', { x, y, size: fontSize, font, color: rgb(0.55, 0.55, 0.55) });
    return;
  }

  for (const row of rows) {
    const valueText = showMedida ? `${row.medida}X${row.largoCm}` : String(row.largoCm);
    page.drawText(valueText, { x: valueX, y, size: fontSize, font });
    page.drawText(countLabel(row.piezas), { x: piezasX, y, size: fontSize, font });
    y -= rowHeight;
  }
}

export async function generateEtiquetaPdf(input: EtiquetaInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const modelosLabel = buildModelosLabel(input.modelos);
  const modelosLines = wrapText(`Modelos: ${modelosLabel}`, boldFont, MODELOS_FONT_SIZE, PAGE_SIZE - MARGIN * 2);

  // Header height depends on how many lines the model list wraps to, so it
  // isn't a fixed constant like the rest of the layout — measured once here
  // and reused for every page (the model list is identical on every page).
  const headerHeight =
    TITLE_FONT_SIZE +
    GAP_AFTER_TITLE +
    modelosLines.length * MODELOS_LINE_HEIGHT +
    GAP_AFTER_MODELOS +
    META_LINE_HEIGHT +
    GAP_AFTER_META +
    GAP_BEFORE_TABLE;

  const columnWidth = (PAGE_SIZE - MARGIN * 2 - COLUMN_GAP) / 2;
  const availableHeight = PAGE_SIZE - MARGIN * 2 - headerHeight - FOOTER_MARGIN;

  const maxRows = Math.max(input.filas1x2.length, input.filasOtras.length, 1);
  // +2 for the column title row and the sub-header row above the data rows.
  const rowHeight = clamp(availableHeight / (maxRows + 2), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  const fontSize = clamp(rowHeight * 0.6, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const rowsPerPage = Math.max(1, Math.floor(availableHeight / rowHeight) - 2);

  const pageCount = Math.max(1, Math.ceil(maxRows / rowsPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = doc.addPage([PAGE_SIZE, PAGE_SIZE]);
    const tableTop = drawHeader(page, font, boldFont, modelosLines, input.fecha, input.linea, pageIndex, pageCount);

    const start = pageIndex * rowsPerPage;
    const slice1x2 = input.filas1x2.slice(start, start + rowsPerPage);
    const sliceOtras = input.filasOtras.slice(start, start + rowsPerPage);

    drawColumn(page, MARGIN, tableTop, columnWidth, 'LISTONES 1x2', slice1x2, font, boldFont, fontSize, rowHeight, false);
    drawColumn(page, MARGIN + columnWidth + COLUMN_GAP, tableTop, columnWidth, 'OTRAS MEDIDAS', sliceOtras, font, boldFont, fontSize, rowHeight, true);
  }

  return doc.save();
}
