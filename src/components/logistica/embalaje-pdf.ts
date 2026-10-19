import { jsPDF } from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';
import { LOGO_GRIS_PNG_BASE64 } from '@/lib/logos';
import type { EmbalajeResult } from '@/lib/embalaje';

const GRIS_LOGO_ASPECT = 389 / 116; // ancho/alto reales del PNG embebido (mismo logo que los otros reportes)
const LOGO_WIDTH_PT = 90;
const LOGO_HEIGHT_PT = LOGO_WIDTH_PT / GRIS_LOGO_ASPECT;
const MARGEN = 40;

const TEXTO: [number, number, number] = [15, 23, 42];
const SUAVE: [number, number, number] = [100, 116, 139];
const VERDE: [number, number, number] = [209, 250, 229];
const ROJO: [number, number, number] = [254, 202, 202];
const HEAD = { fillColor: [30, 41, 59] as [number, number, number], textColor: 255 };
const BASE = { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: TEXTO } as const;

const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const signo = (n: number) => (n > 0 ? `+${num.format(n)}` : num.format(n));
const fechaAr = (iso: string) => iso.split('-').reverse().join('/');
const hora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });

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

export function nombreArchivoEmbalaje(fecha: string): string {
  return `embalaje-${fecha}.pdf`;
}

/** Resumen del día: cerrado en Odoo vs escaneado en embalaje, diferencia por producto y el detalle de cada lista. */
export function generarPdfEmbalaje(data: EmbalajeResult): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const finY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const pageH = doc.internal.pageSize.getHeight();

  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN, LOGO_WIDTH_PT, LOGO_HEIGHT_PT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...TEXTO);
  doc.text('Embalaje: escaneado vs. cerrado en Odoo', MARGEN, MARGEN + LOGO_HEIGHT_PT + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...SUAVE);
  doc.text(`Día: ${fechaAr(data.fecha)} · Odoo contado desde las ${data.desdeHora}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 38);
  doc.text(
    'Odoo: unidades producidas en órdenes de fabricación en estado Hecho, por fecha de finalización. Escaneado: lectura del código de barras del producto en embalaje.',
    MARGEN,
    MARGEN + LOGO_HEIGHT_PT + 52,
    { maxWidth: 515 }
  );
  doc.text(generadoLabel(), MARGEN, MARGEN + LOGO_HEIGHT_PT + 76);

  const dif = data.totalEscaneado - data.totalOdoo;
  autoTable(doc, {
    startY: MARGEN + LOGO_HEIGHT_PT + 90,
    margin: { left: MARGEN, right: MARGEN },
    head: [['Cerrado en Odoo', 'Escaneado en embalaje', 'Diferencia']],
    body: [[num.format(data.totalOdoo), num.format(data.totalEscaneado), dif === 0 ? 'OK' : signo(dif)]],
    styles: { ...BASE, fontSize: 12, halign: 'center', cellPadding: 6 },
    headStyles: { ...HEAD, fontSize: 9 },
    didParseCell: (h: CellHookData) => {
      if (h.section === 'body' && h.column.index === 2) h.cell.styles.fillColor = dif === 0 ? VERDE : ROJO;
    },
  });

  const titulo = (texto: string) => {
    let y = finY() + 26;
    if (y > pageH - 100) {
      doc.addPage();
      y = MARGEN;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEXTO);
    doc.text(texto, MARGEN, y);
    return y + 8;
  };

  autoTable(doc, {
    startY: titulo('Diferencia por producto'),
    margin: { left: MARGEN, right: MARGEN },
    head: [['Producto', 'Código', 'Odoo', 'Escaneado', 'Diferencia']],
    body: data.filas.map((f) => [f.producto, f.barcode ?? 'sin código', num.format(f.odoo), num.format(f.escaneado), f.diferencia === 0 ? 'OK' : signo(f.diferencia)]),
    styles: BASE,
    headStyles: HEAD,
    columnStyles: { 1: { font: 'courier', fontSize: 8 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    didParseCell: (h: CellHookData) => {
      if (h.section === 'body' && h.column.index === 4) h.cell.styles.fillColor = data.filas[h.row.index]?.diferencia === 0 ? VERDE : ROJO;
    },
  });

  autoTable(doc, {
    startY: titulo(`Escaneos registrados (${num.format(data.escaneos.length)})`),
    margin: { left: MARGEN, right: MARGEN },
    head: [['Hora', 'Producto', 'Código', 'Usuario']],
    body: data.escaneos.length
      ? data.escaneos.map((e) => [hora.format(new Date(e.creado)), e.producto ?? e.barcode, e.barcode, e.usuario ?? ''])
      : [['', 'Sin escaneos en este día.', '', '']],
    styles: { ...BASE, fontSize: 8, cellPadding: 3 },
    headStyles: HEAD,
    columnStyles: { 2: { font: 'courier' } },
  });

  autoTable(doc, {
    startY: titulo(`Cerrado en Odoo (${num.format(data.ordenesCerradas.length)} órdenes)`),
    margin: { left: MARGEN, right: MARGEN },
    head: [['Hora', 'Producto', 'Orden', 'Unidades']],
    body: data.ordenesCerradas.length
      ? data.ordenesCerradas.map((o) => [hora.format(new Date(o.cerrada)), o.producto, o.orden, num.format(o.unidades)])
      : [['', 'No se cerró ninguna orden desde esa hora.', '', '']],
    styles: { ...BASE, fontSize: 8, cellPadding: 3 },
    headStyles: HEAD,
    columnStyles: { 3: { halign: 'right' } },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...SUAVE);
    doc.text(`Página ${i} de ${pages}`, doc.internal.pageSize.getWidth() - MARGEN, pageH - 20, { align: 'right' });
  }

  return doc;
}
