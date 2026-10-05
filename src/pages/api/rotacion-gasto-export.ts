import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { getGastoLineas, getOcPendientes, getStockDetalle } from '../../lib/odoo/rotacion-gasto-detalle';
import { ApiValidationError, jsonResponse } from '../../lib/api-helpers';
import { OdooError } from '../../lib/odoo/types';
import { LOGO_GRIS_PNG_BASE64 } from '../../lib/logos';

export const prerender = false;

// reglas-agente-odoo.md #5: todo reporte exportado lleva el logo gris y la fecha/hora de generación, en todas las hojas.
const HEADER_ROWS = 3;
const HEADER_ROW = HEADER_ROWS + 2;
const LOGO_WIDTH_PX = 150;
const LOGO_HEIGHT_PX = LOGO_WIDTH_PX / (389 / 116);
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const NUM_FMT = '#,##0.00';

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

function addReportHeader(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet) {
  for (let r = 1; r <= HEADER_ROWS; r++) sheet.getRow(r).height = LOGO_HEIGHT_PX / HEADER_ROWS + 6;
  const imageId = workbook.addImage({ base64: `data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, extension: 'png' });
  sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: LOGO_WIDTH_PX, height: LOGO_HEIGHT_PX } });
  const cell = sheet.getCell(`D${HEADER_ROWS}`);
  cell.value = generadoLabel();
  cell.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
}

function styleBand(row: ExcelJS.Row, colCount: number) {
  row.font = { bold: true };
  for (let c = 1; c <= colCount; c++) row.getCell(c).fill = HEADER_FILL;
}

/** Fila de totales con SUM de las columnas `cols` (1-based) sobre las filas `first`..`last`. */
function addTotalRow(sheet: ExcelJS.Worksheet, colCount: number, labelCol: number, cols: number[], first: number, last: number) {
  const row = sheet.addRow([]);
  row.getCell(labelCol).value = 'TOTAL';
  for (const c of cols) {
    const letter = sheet.getColumn(c).letter;
    row.getCell(c).value = { formula: `SUM(${letter}${first}:${letter}${last})` };
    row.getCell(c).numFmt = NUM_FMT;
  }
  styleBand(row, colCount);
}

async function gastoWorkbook(empresas?: number[]): Promise<ExcelJS.Workbook> {
  const lineas = await getGastoLineas(empresas);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Gasto real MP');
  addReportHeader(wb, ws);
  const headers = ['Producto', 'ID producto', 'Nombre en pantalla', 'Ref. interna', 'Fecha contable', 'Cantidad', 'Importe ARS (con signo)', 'Proveedor', 'Comprobante', 'Categoría'];
  ws.getRow(HEADER_ROW).values = headers;
  styleBand(ws.getRow(HEADER_ROW), headers.length);
  ws.columns = [38, 12, 38, 14, 14, 14, 22, 34, 24, 34].map((width) => ({ width }));
  for (const l of lineas) ws.addRow([l.producto, l.productId, l.nombrePantalla, l.refInterna, l.fecha, l.cantidad, l.importe, l.proveedor, l.comprobante, l.categoria]);
  ws.getColumn(6).numFmt = NUM_FMT;
  ws.getColumn(7).numFmt = NUM_FMT;
  if (lineas.length > 0) addTotalRow(ws, headers.length, 1, [7], HEADER_ROW + 1, HEADER_ROW + lineas.length);
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
  return wb;
}

async function ocPendientesWorkbook(empresas?: number[]): Promise<ExcelJS.Workbook> {
  const lineas = await getOcPendientes(empresas);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('OC pendientes');
  addReportHeader(wb, ws);
  const headers = ['ID producto', 'Nombre en pantalla', 'Categoría', 'Orden', 'Proveedor', 'Fecha orden', 'Fecha prevista entrega', 'Cantidad pedida (u producto)', 'Cantidad recibida (u producto)', 'Cantidad pendiente (u producto)', 'Precio unitario', 'Moneda'];
  ws.getRow(HEADER_ROW).values = headers;
  styleBand(ws.getRow(HEADER_ROW), headers.length);
  ws.columns = [12, 38, 30, 14, 34, 14, 20, 20, 20, 20, 16, 10].map((width) => ({ width }));
  for (const l of lineas) ws.addRow([l.productId, l.nombrePantalla, l.categoria, l.orden, l.proveedor, l.fechaOrden, l.fechaPrevista, l.pedida, l.recibida, l.pendiente, l.precioUnitario, l.moneda]);
  for (const c of [8, 9, 10, 11]) ws.getColumn(c).numFmt = NUM_FMT;
  if (lineas.length > 0) addTotalRow(ws, headers.length, 1, [8, 9, 10], HEADER_ROW + 1, HEADER_ROW + lineas.length);
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
  return wb;
}

async function stockWorkbook(empresas?: number[]): Promise<ExcelJS.Workbook> {
  const { cortes, productos } = await getStockDetalle(empresas);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stock fin de mes');
  addReportHeader(wb, ws);
  const fixed = ['Código', 'ID producto', 'Producto', 'Nombre en pantalla', 'Categoría', 'Unidad'];
  const headers = [...fixed, ...cortes.flatMap((c) => [`${c} - Cant.`, `${c} - Valor ($)`])];
  ws.getRow(HEADER_ROW).values = headers;
  styleBand(ws.getRow(HEADER_ROW), headers.length);
  ws.columns = [12, 12, 38, 38, 24, 10, ...cortes.flatMap(() => [14, 18])].map((width) => ({ width }));

  const porCategoria = new Map<string, number[]>();
  for (const p of productos) {
    ws.addRow([p.codigo, p.productId, p.producto, p.nombrePantalla, p.categoria, p.unidad, ...p.cortes.flatMap((c) => [c.cantidad, c.valor])]);
    const acc = porCategoria.get(p.categoria) ?? new Array<number>(cortes.length * 2).fill(0);
    p.cortes.forEach((c, i) => {
      acc[2 * i]! += c.cantidad;
      acc[2 * i + 1]! += c.valor;
    });
    porCategoria.set(p.categoria, acc);
  }
  const numCols = Array.from({ length: cortes.length * 2 }, (_, i) => fixed.length + 1 + i);
  for (const c of numCols) ws.getColumn(c).numFmt = NUM_FMT;
  if (productos.length > 0) addTotalRow(ws, headers.length, 1, numCols, HEADER_ROW + 1, HEADER_ROW + productos.length);
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 4 }];

  const wt = wb.addWorksheet('Totales por categoría');
  addReportHeader(wb, wt);
  const headersCat = ['Categoría', ...cortes.flatMap((c) => [`${c} - Cant.`, `${c} - Valor`])];
  wt.getRow(HEADER_ROW).values = headersCat;
  styleBand(wt.getRow(HEADER_ROW), headersCat.length);
  wt.getColumn(1).width = 32;
  const cats = [...porCategoria.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  for (const [cat, vals] of cats) wt.addRow([cat, ...vals]);
  const catNumCols = Array.from({ length: cortes.length * 2 }, (_, i) => i + 2);
  for (const c of catNumCols) {
    wt.getColumn(c).width = 16;
    wt.getColumn(c).numFmt = NUM_FMT;
  }
  if (cats.length > 0) addTotalRow(wt, headersCat.length, 1, catNumCols, HEADER_ROW + 1, HEADER_ROW + cats.length);
  return wb;
}

const querySchema = z.object({
  tipo: z.enum(['gasto', 'stock', 'oc']),
  empresas: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined)),
});

// GET /api/rotacion-gasto-export?tipo=gasto|stock|oc&empresas=1,2 — Excel de detalle por producto, con ID y nombre en pantalla.
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.usuario?.areasPermitidas.includes('finanzas')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const { tipo, empresas } = parsed.data;
    const wb = tipo === 'gasto' ? await gastoWorkbook(empresas) : tipo === 'oc' ? await ocPendientesWorkbook(empresas) : await stockWorkbook(empresas);
    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${{ gasto: 'gasto_real_mp', stock: 'stock_fin_de_mes', oc: 'oc_pendientes_mp' }[tipo]}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof ApiValidationError) return jsonResponse({ ok: false, error: err.message }, { status: 400 });
    if (err instanceof OdooError) return jsonResponse({ ok: false, error: 'Upstream Odoo request failed' }, { status: 502 });
    console.error('[api] rotacion-gasto-export error', err);
    return jsonResponse({ ok: false, error: 'No se pudo generar el Excel' }, { status: 500 });
  }
};
