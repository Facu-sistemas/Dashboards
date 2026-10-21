import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { exigirAreaRentabilidad } from '@/lib/rentabilidad/auth';
import { ApiValidationError, jsonResponse } from '@/lib/api-helpers';
import { MESES } from '@/lib/rentabilidad/format';
import { LOGO_GRIS_PNG_BASE64 } from '@/lib/logos';
import { getCategorias, getClientes, parseFiltros } from '@/lib/odoo/rentabilidad/consultas';
import { OdooError } from '@/lib/odoo/types';
import type { FiltrosRentabilidad, Metricas } from '@/lib/rentabilidad/types';

export const prerender = false;

// reglas-agente-odoo.md #5: todo reporte exportado lleva el logo gris y la fecha/hora de generación, en todas las hojas.
const HEADER_ROWS = 3;
const FILTROS_ROW = HEADER_ROWS + 1;
const HEADER_ROW = HEADER_ROWS + 3;
const LOGO_WIDTH_PX = 150;
const LOGO_HEIGHT_PX = LOGO_WIDTH_PX / (389 / 116);
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const MONEY_FMT = '#,##0';
const PCT_FMT = '0.0';

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

function periodoLabel(f: FiltrosRentabilidad): string {
  const meses =
    f.mesIni === null && f.mesFin === null
      ? 'todo el año'
      : f.mesIni === f.mesFin
        ? MESES[(f.mesIni ?? 1) - 1]
        : `${MESES[(f.mesIni ?? 1) - 1]} a ${MESES[(f.mesFin ?? 12) - 1]}`;
  return `Año ${f.anio} · ${meses}${f.categoria ? ` · Categoría: ${f.categoria}` : ''}`;
}

function addReportHeader(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, titulo: string, f: FiltrosRentabilidad, extra: string) {
  for (let r = 1; r <= HEADER_ROWS; r++) sheet.getRow(r).height = LOGO_HEIGHT_PX / HEADER_ROWS + 6;
  const imageId = workbook.addImage({ base64: `data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, extension: 'png' });
  sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: LOGO_WIDTH_PX, height: LOGO_HEIGHT_PX } });
  const titleCell = sheet.getCell('D1');
  titleCell.value = titulo;
  titleCell.font = { bold: true, size: 14 };
  const cell = sheet.getCell(`D${HEADER_ROWS}`);
  cell.value = generadoLabel();
  cell.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  const filtros = sheet.getCell(`A${FILTROS_ROW}`);
  filtros.value = `${periodoLabel(f)}${extra}`;
  filtros.font = { size: 10, color: { argb: 'FF475569' } };
}

/** Empresa y modo de costos activos, para el encabezado de cada hoja. */
function contextoLabel(f: FiltrosRentabilidad, empresas: { id: number; nombre: string }[]): string {
  const empresa = f.empresaId === null ? 'Ambas empresas' : (empresas.find((e) => e.id === f.empresaId)?.nombre ?? `Empresa ${f.empresaId}`);
  return ` · Empresa: ${empresa} · Costos: ${f.costos === 'planilla' ? 'Planilla (coincide con el Excel)' : 'Odoo (dinámico)'}`;
}

const COLUMNAS_METRICAS = ['Venta s/flete ($)', 'Subtotal facturado ($)', 'Cantidad', 'Costo total ($)', 'Contribución ($)', '% Contribución', 'Objetivo %', 'Gap (pp)', 'Margen perdido ($)', 'Cobertura de costo %', 'Semáforo'];
const ESTADO_LABEL = { verde: 'OK', amarillo: 'Alerta', rojo: 'Crítico', sin_costo: 'Sin costo' } as const;

function valoresMetricas(m: Metricas): (number | string | null)[] {
  return [
    m.venta,
    m.subtotal,
    m.cantidad,
    m.costoTotal,
    m.contribucion,
    m.contribucionPct,
    m.objetivoPct,
    m.gapPct,
    m.margenPerdido,
    m.cobertura * 100,
    ESTADO_LABEL[m.estado],
  ];
}

function formatearFila(row: ExcelJS.Row, primerColNum: number) {
  // índices relativos a la primera columna de métricas: $ = venta, subtotal, costo, contribución, margen perdido; % = %contrib, objetivo, gap, cobertura
  const moneda = [0, 1, 3, 4, 8];
  const pct = [5, 6, 7, 9];
  moneda.forEach((i) => (row.getCell(primerColNum + i).numFmt = MONEY_FMT));
  pct.forEach((i) => (row.getCell(primerColNum + i).numFmt = PCT_FMT));
  row.getCell(primerColNum + 2).numFmt = '#,##0.##';
}

function styleBand(row: ExcelJS.Row, colCount: number) {
  row.font = { bold: true };
  for (let c = 1; c <= colCount; c++) row.getCell(c).fill = HEADER_FILL;
}

async function clientesWorkbook(f: FiltrosRentabilidad): Promise<ExcelJS.Workbook> {
  const data = await getClientes(f);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clientes');
  addReportHeader(wb, ws, 'Rentabilidad · Clientes', f, contextoLabel(f, data.opciones.empresas) + (data.costos.activo ? '' : ' · Sin costos cargados: contribución no calculada'));
  const headers = ['Cliente', ...COLUMNAS_METRICAS];
  ws.getRow(HEADER_ROW).values = headers;
  styleBand(ws.getRow(HEADER_ROW), headers.length);
  ws.getColumn(1).width = 42;
  for (let c = 2; c <= headers.length; c++) ws.getColumn(c).width = 18;
  for (const fila of data.filas) {
    const row = ws.addRow([fila.cliente, ...valoresMetricas(fila)]);
    formatearFila(row, 2);
  }
  const total = ws.addRow(['TOTAL', ...valoresMetricas(data.totales)]);
  formatearFila(total, 2);
  styleBand(total, headers.length);
  return wb;
}

async function categoriasWorkbook(f: FiltrosRentabilidad): Promise<ExcelJS.Workbook> {
  const data = await getCategorias(f);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Categorías');
  const cliente = f.clienteId !== null ? data.clientes.find((c) => c.id === f.clienteId)?.nombre : null;
  addReportHeader(
    wb,
    ws,
    'Rentabilidad · Categorías',
    f,
    `${contextoLabel(f, data.opciones.empresas)}${cliente ? ` · Cliente: ${cliente}` : ''}${data.costos.activo ? '' : ' · Sin costos cargados: contribución no calculada'}`
  );
  const headers = ['Categoría', 'Subcategoría', ...COLUMNAS_METRICAS];
  ws.getRow(HEADER_ROW).values = headers;
  styleBand(ws.getRow(HEADER_ROW), headers.length);
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 26;
  for (let c = 3; c <= headers.length; c++) ws.getColumn(c).width = 18;
  for (const cat of data.filas) {
    const row = ws.addRow([cat.categoria, '(total)', ...valoresMetricas(cat)]);
    formatearFila(row, 3);
    row.font = { bold: true };
    for (const sub of cat.subcategorias) {
      const r = ws.addRow(['', sub.subcategoria, ...valoresMetricas(sub)]);
      formatearFila(r, 3);
    }
  }
  const total = ws.addRow(['TOTAL', '', ...valoresMetricas(data.totales)]);
  formatearFila(total, 3);
  styleBand(total, headers.length);
  return wb;
}

// GET /api/rentabilidad/export?vista=clientes|categorias&anio=&mesIni=&mesFin=&categoria=&cliente= — Excel con logo gris y fecha/hora.
export const GET: APIRoute = async ({ url, locals }) => {
  const denegado = exigirAreaRentabilidad(locals);
  if (denegado) return denegado;

  try {
    const vista = url.searchParams.get('vista');
    if (vista !== 'clientes' && vista !== 'categorias') throw new ApiValidationError('vista debe ser clientes o categorias');
    const filtros = parseFiltros(url.searchParams);
    const wb = vista === 'clientes' ? await clientesWorkbook(filtros) : await categoriasWorkbook(filtros);
    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="rentabilidad_${vista}_${filtros.anio}_${filtros.costos}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof ApiValidationError) return jsonResponse({ ok: false, error: err.message }, { status: 400 });
    if (err instanceof OdooError) return jsonResponse({ ok: false, error: 'Upstream Odoo request failed' }, { status: 502 });
    console.error('[rentabilidad-export]', err);
    return jsonResponse({ ok: false, error: 'No se pudo generar el Excel' }, { status: 500 });
  }
};
