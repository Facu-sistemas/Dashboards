import type ExcelJS from 'exceljs';
import type { LogisticaMovimientosResult, GrupoMensual, Macro } from '@/lib/odoo/logistica-movimientos';

/** Descargas (Excel / PDF) de Logística > Entregas. Se arman en el navegador; todas llevan logo y fecha de generación. */

const aNumero = (t: string) => Number(t.replace(/\./g, '').replace(',', '.')) || 0;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LOGO_ASPECT = 389 / 116;
const fecha = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const generadoLabel = () => `Generado: ${fecha.format(new Date())}`;
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const fmt2 = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function logoBase64() {
  return (await import('@/lib/logos')).LOGO_GRIS_PNG_BASE64;
}

/** Logo + título + fecha. Devuelve la primera fila libre. */
async function encabezadoExcel(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, titulo: string, subtitulo?: string): Promise<number> {
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 18;
  const id = wb.addImage({ base64: `data:image/png;base64,${await logoBase64()}`, extension: 'png' });
  ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 54 * LOGO_ASPECT, height: 54 } });
  ws.getCell('A4').value = titulo;
  ws.getCell('A4').font = { bold: true, size: 14 };
  ws.getCell('A5').value = [subtitulo, generadoLabel()].filter(Boolean).join(' · ');
  ws.getCell('A5').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  return 7;
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

async function guardarExcel(wb: ExcelJS.Workbook, nombre: string) {
  const buf = await wb.xlsx.writeBuffer();
  descargar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombre);
}

const banda = (row: ExcelJS.Row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  });
};

// ── Stock de una tabla (con lo filtrado) ─────────────────────────────────

export async function exportarStock(formato: 'xlsx' | 'pdf', titulo: string, head: string[], filas: string[][], nombre: string) {
  if (formato === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(titulo.slice(0, 31));
    const r0 = await encabezadoExcel(wb, ws, titulo);
    banda(ws.addRow(head));
    for (const f of filas) ws.addRow([f[0], aNumero(f[1]!), aNumero(f[2]!)]);
    const total = ws.addRow(['Total', { formula: `SUM(B${r0 + 1}:B${r0 + filas.length})` }, { formula: `SUM(C${r0 + 1}:C${r0 + filas.length})` }]);
    total.font = { bold: true };
    ws.getColumn(1).width = 46;
    ws.getColumn(2).width = 18;
    ws.getColumn(3).width = 14;
    ws.getColumn(2).numFmt = '#,##0';
    ws.getColumn(3).numFmt = '#,##0.00';
    await guardarExcel(wb, `${nombre}.xlsx`);
    return;
  }
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const w = 90;
  doc.addImage(`data:image/png;base64,${await logoBase64()}`, 'PNG', 40, 36, w, w / LOGO_ASPECT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(titulo, 40, 100);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(generadoLabel(), 40, 114);
  const totCant = filas.reduce((s, f) => s + aNumero(f[1]!), 0);
  const totMed = filas.reduce((s, f) => s + aNumero(f[2]!), 0);
  autoTable(doc, {
    startY: 126,
    head: [head],
    body: filas,
    foot: [['Total', totCant.toLocaleString('es-AR'), fmt2(totMed)]],
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    didParseCell: (d) => {
      if ((d.section === 'head' || d.section === 'foot') && d.column.index > 0) d.cell.styles.halign = 'right';
    },
  });
  doc.save(`${nombre}.pdf`);
}

// ── Excel general: stock + entregadas/fabricadas/vendidas con año → mes → día ──

function hojaMovimiento(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, r0: number, g: GrupoMensual) {
  banda(ws.addRow(['Período', 'Cant.', 'Equiv.', 'm³']));
  for (const a of g.anios) {
    const ra = ws.addRow([String(a.anio), a.cant, a.equiv, a.m3]);
    ra.font = { bold: true };
    for (const m of a.meses) {
      const rm = ws.addRow([`  ${MESES[Number(m.mes.slice(5)) - 1]}`, m.cant, m.equiv, m.m3]);
      rm.outlineLevel = 1;
      for (const d of m.dias) {
        const rd = ws.addRow([`      ${d.dia.slice(8)}/${d.dia.slice(5, 7)}/${d.dia.slice(0, 4)}`, d.cant, d.equiv, d.m3]);
        rd.outlineLevel = 2;
        rd.font = { color: { argb: 'FF64748B' } };
      }
    }
  }
  const t = ws.addRow(['Total', g.total.cant, g.total.equiv, g.total.m3]);
  t.font = { bold: true };
  ws.getColumn(1).width = 26;
  for (const c of [2, 3, 4]) ws.getColumn(c).width = 14;
  ws.getColumn(2).numFmt = '#,##0';
  ws.getColumn(3).numFmt = '#,##0.00';
  ws.getColumn(4).numFmt = '#,##0.00';
  ws.views = [{ state: 'frozen', ySplit: r0 }];
  void wb;
}

export async function descargarExcelGeneral(data: LogisticaMovimientosResult) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Frontera Living';
  wb.created = new Date();
  const macros: [Macro, string][] = [['colchones', 'Colchones'], ['sillones', 'Sillones']];

  for (const [k, nombre] of macros) {
    const s = data.stock[k];
    const ws = wb.addWorksheet(`${nombre} disponibles`);
    const r0 = await encabezadoExcel(wb, ws, `${nombre} disponibles`, 'Stock disponible (a mano − reservado)');
    banda(ws.addRow(['Producto', 'Stock disponible', k === 'colchones' ? 'm³' : 'Cant. equiv.']));
    for (const f of s.filas) ws.addRow([f.producto, f.disponible, f.medida]);
    ws.addRow(['Total', s.totalDisponible, s.totalMedida]).font = { bold: true };
    ws.getColumn(1).width = 46;
    ws.getColumn(2).width = 18;
    ws.getColumn(3).width = 14;
    ws.getColumn(2).numFmt = '#,##0';
    ws.getColumn(3).numFmt = '#,##0.00';
    ws.views = [{ state: 'frozen', ySplit: r0 }];
  }
  const tablas: [string, string, 'entregas' | 'fabricadas' | 'vendidas'][] = [
    ['Entregadas', 'Facturado − notas de crédito, por fecha de factura', 'entregas'],
    ['Fabricadas', 'Órdenes de fabricación hechas, por fecha fin', 'fabricadas'],
    ['Vendidas', 'Pedidos confirmados, por fecha de la orden', 'vendidas'],
  ];
  for (const [k, nombre] of macros) {
    for (const [t, ayuda, campo] of tablas) {
      const ws = wb.addWorksheet(`${nombre} ${t}`);
      const r0 = await encabezadoExcel(wb, ws, `${nombre}: cantidad ${t.toLowerCase()}`, ayuda);
      hojaMovimiento(wb, ws, r0, data[campo][k]);
    }
  }
  await guardarExcel(wb, `entregas-general-${hoyIso()}.xlsx`);
}

// ── PDF general ──────────────────────────────────────────────────────────

export async function descargarPdfGeneral(data: LogisticaMovimientosResult) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  const w = 90;
  const finY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const pageH = doc.internal.pageSize.getHeight();
  const HEAD = { fillColor: [30, 41, 59] as [number, number, number], textColor: 255 };
  const FOOT = { fillColor: [226, 232, 240] as [number, number, number], textColor: [15, 23, 42] as [number, number, number] };
  const BASE = { font: 'helvetica', fontSize: 8.5, cellPadding: 3 };
  const alignRight = (d: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => {
    if (d.column.index > 0) d.cell.styles.halign = 'right';
  };

  doc.addImage(`data:image/png;base64,${await logoBase64()}`, 'PNG', M, M, w, w / LOGO_ASPECT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('Logística: Entregas', M, M + w / LOGO_ASPECT + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(generadoLabel(), M, M + w / LOGO_ASPECT + 36);
  let y = M + w / LOGO_ASPECT + 52;

  const titulo = (texto: string, ayuda?: string) => {
    if (y > pageH - 120) {
      doc.addPage();
      y = M;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(texto, M, y);
    y += 12;
    if (ayuda) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(ayuda, M, y);
      y += 8;
    }
  };

  const macros: [Macro, string][] = [['colchones', 'Colchones'], ['sillones', 'Sillones']];
  for (const [k, nombre] of macros) {
    const s = data.stock[k];
    titulo(`${nombre} disponibles`);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Producto', 'Stock disponible', k === 'colchones' ? 'm³' : 'Cant. equiv.']],
      body: s.filas.map((f) => [f.producto, f.disponible.toLocaleString('es-AR'), fmt2(f.medida)]),
      foot: [['Total', s.totalDisponible.toLocaleString('es-AR'), fmt2(s.totalMedida)]],
      styles: BASE,
      headStyles: HEAD,
      footStyles: FOOT,
      didParseCell: (d) => {
        if (d.section !== 'body') alignRight(d as never);
        else if (d.column.index > 0) d.cell.styles.halign = 'right';
      },
    });
    y = finY() + 22;
  }

  const tablas: [string, string, 'entregas' | 'fabricadas' | 'vendidas'][] = [
    ['Cantidad entregada', 'Facturado − notas de crédito, por fecha de factura', 'entregas'],
    ['Cantidades fabricadas', 'Órdenes de fabricación hechas, por fecha fin', 'fabricadas'],
    ['Cantidades vendidas', 'Pedidos confirmados, por fecha de la orden', 'vendidas'],
  ];
  for (const [k, nombre] of macros) {
    for (const [t, ayuda, campo] of tablas) {
      const g = data[campo][k];
      const body: { texto: string[]; nivel: 0 | 1 | 2 }[] = [];
      const fila = (p: string, m: { cant: number; equiv: number; m3: number }, nivel: 0 | 1 | 2) =>
        body.push({ texto: [p, m.cant.toLocaleString('es-AR', { maximumFractionDigits: 0 }), fmt2(m.equiv), fmt2(m.m3)], nivel });
      for (const a of g.anios) {
        fila(String(a.anio), a, 0);
        for (const m of a.meses) {
          fila(MESES[Number(m.mes.slice(5)) - 1]!, m, 1);
          for (const d of m.dias) fila(`${d.dia.slice(8)}/${d.dia.slice(5, 7)}/${d.dia.slice(0, 4)}`, d, 2);
        }
      }
      titulo(`${nombre}: ${t}`, ayuda);
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: [['Período', 'Cant.', 'Equiv.', 'm³']],
        body: body.map((b) => b.texto),
        foot: [['Total', g.total.cant.toLocaleString('es-AR', { maximumFractionDigits: 0 }), fmt2(g.total.equiv), fmt2(g.total.m3)]],
        styles: BASE,
        headStyles: HEAD,
        footStyles: FOOT,
        didParseCell: (d) => {
          if (d.column.index > 0) d.cell.styles.halign = 'right';
          if (d.section !== 'body') return;
          const nivel = body[d.row.index]!.nivel;
          if (nivel === 0) {
            d.cell.styles.fontStyle = 'bold';
            d.cell.styles.fillColor = [241, 245, 249];
          } else if (nivel === 2) {
            d.cell.styles.textColor = [100, 116, 139];
            d.cell.styles.fontSize = 8;
          }
          if (d.column.index === 0) d.cell.styles.cellPadding = { top: 3, bottom: 3, right: 3, left: 3 + nivel * 12 };
        },
      });
      y = finY() + 22;
    }
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${i} / ${n}`, doc.internal.pageSize.getWidth() - M, pageH - 20, { align: 'right' });
  }
  doc.save(`entregas-general-${hoyIso()}.pdf`);
}
