import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { analizarSobrantes, type Bloque } from '../../lib/multicorte-calc';
import { ApiValidationError } from '../../lib/api-helpers';
import { OdooError } from '../../lib/odoo/types';

export const prerender = false;

function fmtNum(v: number): number {
  return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
}

function blockGroupLabel(b: Bloque): string {
  return `${b.colorBloque.toUpperCase()} ${fmtNum(b.anchoBloqueCm)}x${fmtNum(b.largoBloqueCm)}`;
}

/** Builds the same 2-sheet "plan de corte" the Python tool exported: `Plan_Produccion` (what to cut, per block group) and `Analisis_Sobrantes` (leftover classification + global efficiency). */
async function buildWorkbook(bloques: Bloque[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();

  // --- Plan_Produccion ---
  const planSheet = workbook.addWorksheet('Plan_Produccion');
  planSheet.columns = [
    { header: 'Producto', key: 'producto', width: 40 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Block', key: 'block', width: 30 },
  ];

  const groups = new Map<string, { bloques: Bloque[]; productos: Map<string, number> }>();
  for (const b of bloques) {
    const label = blockGroupLabel(b);
    const group = groups.get(label) ?? { bloques: [], productos: new Map<string, number>() };
    group.bloques.push(b);
    for (const detalle of b.placasDetalle) {
      const match = /^(.*): (\d+) placas$/.exec(detalle);
      if (!match) continue;
      const [, producto, cantStr] = match;
      group.productos.set(producto!, (group.productos.get(producto!) ?? 0) + Number(cantStr));
    }
    groups.set(label, group);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [label, group] of sortedGroups) {
    const productos = [...group.productos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [producto, cantidad] of productos) {
      planSheet.addRow({ producto, cantidad, block: `${group.bloques.length} ${label}` });
    }
  }

  planSheet.addRow({});
  const sideHeaderRow = planSheet.addRow({ producto: '', cantidad: '', block: '' });
  planSheet.getCell(`H1`).value = 'Color';
  planSheet.getCell(`I1`).value = 'Medidas';
  planSheet.getCell(`J1`).value = 'Cantidad de Blocks';
  let sideRow = 2;
  for (const [, group] of sortedGroups) {
    const first = group.bloques[0]!;
    planSheet.getCell(`H${sideRow}`).value = first.colorBloque.toUpperCase();
    planSheet.getCell(`I${sideRow}`).value = `${fmtNum(first.anchoBloqueCm)}x${fmtNum(first.largoBloqueCm)}x${fmtNum(first.altoBloqueCm)}`;
    planSheet.getCell(`J${sideRow}`).value = group.bloques.length;
    sideRow++;
  }
  void sideHeaderRow;

  // --- Analisis_Sobrantes ---
  const scrapSheet = workbook.addWorksheet('Analisis_Sobrantes');
  scrapSheet.columns = [
    { header: 'Color Bloque', key: 'color', width: 16 },
    { header: 'Ancho (cm)', key: 'ancho', width: 12 },
    { header: 'Largo (cm)', key: 'largo', width: 12 },
    { header: 'Espesor (cm)', key: 'espesor', width: 12 },
    { header: 'Parte del block', key: 'eje', width: 16 },
    { header: 'Clasificación', key: 'clasificacion', width: 14 },
    { header: 'Repetidos', key: 'repetidos', width: 12 },
  ];

  let totalUtil = 0;
  let totalVol = 0;
  for (const b of bloques) {
    const { disponibles, scrap } = analizarSobrantes(b);
    for (const entry of disponibles) {
      scrapSheet.addRow({
        color: b.colorBloque.toUpperCase(),
        ancho: entry.anchoCm,
        largo: entry.largoCm,
        espesor: entry.espesorCm,
        eje: entry.eje,
        clasificacion: 'Disponible',
        repetidos: entry.cantidad,
      });
    }
    for (const entry of scrap) {
      scrapSheet.addRow({
        color: b.colorBloque.toUpperCase(),
        ancho: entry.anchoCm,
        largo: entry.largoCm,
        espesor: entry.espesorCm,
        eje: entry.eje,
        clasificacion: 'Scrap',
        repetidos: entry.cantidad,
      });
    }

    const volTotal = b.anchoBloqueCm * b.largoBloqueCm * b.altoBloqueCm;
    totalVol += volTotal;
    totalUtil += (b.eficiencia / 100) * volTotal;
  }

  scrapSheet.addRow({});
  scrapSheet.getCell(`I1`).value = 'Aprovechamiento Global';
  scrapSheet.getCell(`I2`).value = totalVol > 0 ? `${((totalUtil / totalVol) * 100).toFixed(1)}%` : '—';
  scrapSheet.getCell(`I3`).value = 'Volumen útil / Volumen total de bloques seleccionados';

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
