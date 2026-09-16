import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { analizarSobrantes, type Bloque } from '../../lib/multicorte-calc';
import { ApiValidationError } from '../../lib/api-helpers';
import { OdooError } from '../../lib/odoo/types';
import { LOGO_GRIS_PNG_BASE64 } from '../../lib/logos';

export const prerender = false;

function fmtNum(v: number): number {
  return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
}

/** "{COLOR} {largo}" — matches the "2 CELESTE 312" shorthand from the plant's own historical planning sheet ("Plan. Corte Polieter"). */
function blockGroupLabel(b: Bloque): string {
  return `${b.colorBloque.toUpperCase()} ${fmtNum(b.largoBloqueCm)}`;
}

// reglas-agente-odoo.md #5: todo reporte exportado lleva el logo gris y la
// fecha/hora de generación, en todas las hojas. Reservamos las primeras
// filas de cada hoja para ese encabezado; el contenido real arranca en
// HEADER_ROWS + 1 (fila en blanco de separación incluida).
const HEADER_ROWS = 3;
const CONTENT_START_ROW = HEADER_ROWS + 2;

const GRIS_LOGO_ASPECT = 389 / 116; // ancho/alto reales del PNG embebido
const LOGO_WIDTH_PX = 150;
const LOGO_HEIGHT_PX = LOGO_WIDTH_PX / GRIS_LOGO_ASPECT;

function generadoLabel(): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Generado: ${fmt.format(new Date())}`;
}

const THIN_BLACK: ExcelJS.Border = { style: 'thin', color: { argb: 'FF000000' } };
const FULL_BORDER: Partial<ExcelJS.Borders> = { top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

/** Bolds + grays the background of a table's header row and boxes each of its `colCount` cells — same look across every sheet in the report. */
function styleHeaderRow(sheet: ExcelJS.Worksheet, rowNumber: number, colCount: number) {
  const row = sheet.getRow(rowNumber);
  row.font = { bold: true };
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.border = FULL_BORDER;
  }
}

/** Outer perimeter border only (no internal gridlines) around a rectangular range — used for the whole data table, not per-row/per-group. */
function boxOuterBorder(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, startCol: number, endCol: number) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = sheet.getCell(r, c);
      const border: Partial<ExcelJS.Borders> = { ...cell.border };
      if (r === startRow) border.top = THIN_BLACK;
      if (r === endRow) border.bottom = THIN_BLACK;
      if (c === startCol) border.left = THIN_BLACK;
      if (c === endCol) border.right = THIN_BLACK;
      cell.border = border;
    }
  }
}

function addReportHeader(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, generadoText: string) {
  for (let r = 1; r <= HEADER_ROWS; r++) sheet.getRow(r).height = LOGO_HEIGHT_PX / HEADER_ROWS + 6;

  const imageId = workbook.addImage({ base64: `data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, extension: 'png' });
  sheet.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: LOGO_WIDTH_PX, height: LOGO_HEIGHT_PX },
  });

  sheet.getCell(`D${HEADER_ROWS}`).value = generadoText;
  sheet.getCell(`D${HEADER_ROWS}`).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  sheet.getCell(`D${HEADER_ROWS}`).alignment = { vertical: 'bottom' };
}

/**
 * `Plan_Produccion` replicates the plant's own historical planning sheet
 * ("Plan. Corte Polieter"): grouped by physical block (color+largo, `Block`
 * merged vertically), with one row per placa underneath each block group —
 * `Producto | Cantidad | Block`. `Analisis_Sobrantes` (leftover
 * classification + global efficiency) is kept as a second sheet, same as
 * before; the old template doesn't have an equivalent but it's useful extra
 * info the plant didn't have access to previously.
 */
async function buildWorkbook(bloques: Bloque[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const generadoText = generadoLabel();

  // --- Plan_Produccion ---
  const planSheet = workbook.addWorksheet('Plan_Produccion');
  addReportHeader(workbook, planSheet, generadoText);
  planSheet.columns = [
    { key: 'producto', width: 40 },
    { key: 'cantidad', width: 12 },
    { key: 'block', width: 30 },
  ];

  const headerRow = planSheet.getRow(CONTENT_START_ROW);
  headerRow.getCell(1).value = 'Producto';
  headerRow.getCell(2).value = 'Cantidad';
  headerRow.getCell(3).value = 'Block';
  styleHeaderRow(planSheet, CONTENT_START_ROW, 3);

  // Agrupado por BLOQUE (color+largo), no por placa: la celda "Block" se
  // combina verticalmente y abajo van todas las placas que salen de ese
  // grupo de bloques — así es como está armada la planilla histórica
  // ("14 GRIS 276" combinada al lado de 2-3 productos distintos). El orden
  // de los grupos respeta el orden en que ya vienen los bloques (color,
  // luego eficiencia descendente).
  const grupos = new Map<string, { bloques: Bloque[]; productos: Map<string, number> }>();
  for (const b of bloques) {
    const label = blockGroupLabel(b);
    const g = grupos.get(label) ?? { bloques: [], productos: new Map<string, number>() };
    g.bloques.push(b);
    for (const detalle of b.placasDetalle) {
      const match = /^(.*): (\d+) placas$/.exec(detalle);
      if (!match) continue;
      const [, producto, cantStr] = match;
      g.productos.set(producto!, (g.productos.get(producto!) ?? 0) + Number(cantStr));
    }
    grupos.set(label, g);
  }

  let row = CONTENT_START_ROW + 1;
  for (const [label, g] of grupos) {
    const productos = [...g.productos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (productos.length === 0) continue;
    const startRow = row;
    for (const [producto, cantidad] of productos) {
      planSheet.getRow(row).getCell(1).value = producto;
      planSheet.getRow(row).getCell(2).value = cantidad;
      row++;
    }
    const endRow = row - 1;

    if (endRow > startRow) planSheet.mergeCells(startRow, 3, endRow, 3);
    const blockCell = planSheet.getCell(startRow, 3);
    blockCell.value = `${g.bloques.length} ${label}`;
    blockCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
  boxOuterBorder(planSheet, CONTENT_START_ROW, row - 1, 1, 3);

  // --- Analisis_Sobrantes ---
  const scrapSheet = workbook.addWorksheet('Analisis_Sobrantes');
  addReportHeader(workbook, scrapSheet, generadoText);
  scrapSheet.columns = [
    { key: 'color', width: 16 },
    { key: 'ancho', width: 12 },
    { key: 'largo', width: 12 },
    { key: 'espesor', width: 12 },
    { key: 'eje', width: 16 },
    { key: 'clasificacion', width: 14 },
    { key: 'repetidos', width: 12 },
  ];
  ['Color Bloque', 'Ancho (cm)', 'Largo (cm)', 'Espesor (cm)', 'Parte del block', 'Clasificación', 'Repetidos'].forEach((label, i) => {
    scrapSheet.getRow(CONTENT_START_ROW).getCell(i + 1).value = label;
  });
  styleHeaderRow(scrapSheet, CONTENT_START_ROW, 7);

  let scrapRow = CONTENT_START_ROW + 1;
  let totalUtil = 0;
  let totalVol = 0;
  for (const b of bloques) {
    const { disponibles, scrap } = analizarSobrantes(b);
    for (const entry of [...disponibles.map((e) => ({ ...e, clasificacion: 'Disponible' })), ...scrap.map((e) => ({ ...e, clasificacion: 'Scrap' }))]) {
      const r = scrapSheet.getRow(scrapRow);
      r.getCell(1).value = b.colorBloque.toUpperCase();
      r.getCell(2).value = entry.anchoCm;
      r.getCell(3).value = entry.largoCm;
      r.getCell(4).value = entry.espesorCm;
      r.getCell(5).value = entry.eje;
      r.getCell(6).value = entry.clasificacion;
      r.getCell(7).value = entry.cantidad;
      scrapRow++;
    }

    const volTotal = b.anchoBloqueCm * b.largoBloqueCm * b.altoBloqueCm;
    totalVol += volTotal;
    totalUtil += (b.eficiencia / 100) * volTotal;
  }
  boxOuterBorder(scrapSheet, CONTENT_START_ROW, scrapRow - 1, 1, 7);

  const summaryRow = CONTENT_START_ROW;
  scrapSheet.getCell(`J${summaryRow}`).value = 'Aprovechamiento Global';
  scrapSheet.getCell(`J${summaryRow}`).font = { bold: true };
  scrapSheet.getCell(`J${summaryRow + 1}`).value = totalVol > 0 ? `${((totalUtil / totalVol) * 100).toFixed(1)}%` : '—';
  scrapSheet.getCell(`J${summaryRow + 2}`).value = 'Volumen útil / Volumen total de bloques seleccionados';

  return workbook.xlsx.writeBuffer();
}

// POST /api/multicorte-export — recibe los bloques tildados por el usuario
// (no hay selección persistida en el server) y devuelve el .xlsx del plan de corte.
export const POST: APIRoute = async ({ request }) => {
  let bloques: Bloque[];
  try {
    const body = await request.json();
    if (!Array.isArray(body) || body.length === 0) {
      throw new ApiValidationError('Debe seleccionar al menos un bloque para exportar');
    }
    bloques = body as Bloque[];
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: false, error: 'Body inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const buffer = await buildWorkbook(bloques);
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="plan-multicorte.xlsx"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof OdooError) {
      return new Response(JSON.stringify({ ok: false, error: 'Upstream Odoo request failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    console.error('[api] multicorte-export error', err);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo generar el Excel' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
