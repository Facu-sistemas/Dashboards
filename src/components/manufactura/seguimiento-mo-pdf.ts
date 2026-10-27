import { jsPDF } from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';
import { LOGO_GRIS_PNG_BASE64 } from '@/lib/logos';
import type { SeguimientoGrupo, SeguimientoMoResult, SeguimientoSemaforo } from '@/lib/odoo/seguimiento-mo';

const GRIS_LOGO_ASPECT = 389 / 116; // ancho/alto reales del PNG embebido (mismo logo que linea-pdf)
const LOGO_WIDTH_PT = 90;
const LOGO_HEIGHT_PT = LOGO_WIDTH_PT / GRIS_LOGO_ASPECT;
const MARGEN = 40;

const TEXTO: [number, number, number] = [15, 23, 42];
const SUAVE: [number, number, number] = [100, 116, 139];
const FILL: Record<SeguimientoSemaforo, [number, number, number]> = {
  verde: [209, 250, 229],
  amarillo: [254, 243, 199],
  rojo: [254, 202, 202],
};

const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const pct = (n: number, total: number) => `${dec.format(total > 0 ? (n / total) * 100 : 0)}%`;
const fechaAr = (iso: string) => iso.split('-').reverse().join('/');

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

export function nombreArchivoSeguimiento(today: string): string {
  return `seguimiento-mo-${today}.pdf`;
}

/** Foto del día: umbrales usados, cuántas MO hay en cada color por rubro y sector, y el detalle de las que están en rojo. */
export function generarPdfSeguimientoMo(data: SeguimientoMoResult): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const finY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const pageH = doc.internal.pageSize.getHeight();

  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN, LOGO_WIDTH_PT, LOGO_HEIGHT_PT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...TEXTO);
  doc.text('Seguimiento de Órdenes de Fabricación', MARGEN, MARGEN + LOGO_HEIGHT_PT + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...SUAVE);
  doc.text(`Fecha de corte: ${fechaAr(data.today)}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 38);
  doc.text(
    'Días corridos desde la creación de cada MO abierta (borrador, confirmada, en progreso o por cerrar). El sector es la categoría del producto.',
    MARGEN,
    MARGEN + LOGO_HEIGHT_PT + 52,
    { maxWidth: 515 }
  );
  doc.text(generadoLabel(), MARGEN, MARGEN + LOGO_HEIGHT_PT + 76);

  let y = MARGEN + LOGO_HEIGHT_PT + 96;

  const grupos: [string, SeguimientoGrupo][] = [
    ['Colchones', data.colchones],
    ['Living', data.living],
  ];

  grupos.forEach(([titulo, g], idx) => {
    if (idx > 0 || y > pageH - 220) {
      doc.addPage();
      y = MARGEN;
    }
    const { amarilloDesde, rojoDesde } = g.umbrales;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...TEXTO);
    doc.text(titulo, MARGEN, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...SUAVE);
    doc.text(
      `Parámetro: verde menos de ${amarilloDesde} días · amarillo de ${amarilloDesde} a ${rojoDesde - 1} días · rojo ${rojoDesde} días o más`,
      MARGEN,
      y + 15
    );
    doc.text(
      `${num.format(g.total)} MO abiertas · antigüedad promedio ${dec.format(g.avgDays)} días · la más vieja ${num.format(g.maxDays)} días`,
      MARGEN,
      y + 29
    );

    const baseStyles = { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: TEXTO } as const;
    const head = { fillColor: [30, 41, 59] as [number, number, number], textColor: 255 };

    autoTable(doc, {
      startY: y + 40,
      margin: { left: MARGEN, right: MARGEN },
      head: [['Semáforo', 'Rango', 'MO', '% del total']],
      body: [
        ['Verde · en tiempo', `menos de ${amarilloDesde} días`, num.format(g.verde), pct(g.verde, g.total)],
        ['Amarillo · atención', `${amarilloDesde} a ${rojoDesde - 1} días`, num.format(g.amarillo), pct(g.amarillo, g.total)],
        ['Rojo · demorada (atraso)', `${rojoDesde} días o más`, num.format(g.rojo), pct(g.rojo, g.total)],
        ['Total', '', num.format(g.total), '100%'],
      ],
      styles: baseStyles,
      headStyles: head,
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      didParseCell: (h: CellHookData) => {
        if (h.section !== 'body') return;
        const color: SeguimientoSemaforo | null = h.row.index === 0 ? 'verde' : h.row.index === 1 ? 'amarillo' : h.row.index === 2 ? 'rojo' : null;
        if (color) h.cell.styles.fillColor = FILL[color];
        else h.cell.styles.fontStyle = 'bold';
      },
    });

    autoTable(doc, {
      startY: finY() + 14,
      margin: { left: MARGEN, right: MARGEN },
      head: [['Sector', 'MO', 'Verde', 'Amarillo', 'Rojo', '% en rojo', 'Prom. días']],
      body: g.sectores.map((s) => [s.sector, num.format(s.total), num.format(s.verde), num.format(s.amarillo), num.format(s.rojo), pct(s.rojo, s.total), dec.format(s.avgDays)]),
      styles: baseStyles,
      headStyles: head,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    });

    const SECCIONES: [SeguimientoSemaforo, string][] = [
      ['rojo', 'en atraso (rojo)'],
      ['amarillo', 'en atención (amarillo)'],
    ];
    for (const [color, etiqueta] of SECCIONES) {
      const ordenes = g.ordenes.filter((o) => o.semaforo === color).sort((a, b) => b.ageDays - a.ageDays);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...TEXTO);
      const tituloY = finY() + 24;
      if (tituloY > pageH - 100) {
        doc.addPage();
        y = MARGEN;
      } else {
        y = tituloY;
      }
      doc.text(`${titulo} · MO ${etiqueta}: ${num.format(ordenes.length)}`, MARGEN, y);

      if (ordenes.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...SUAVE);
        doc.text('No hay órdenes en este estado.', MARGEN, y + 15);
        // Sin tabla, finY() seguiría apuntando a la anterior: se fuerza una referencia propia.
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable = { finalY: y + 15 };
        continue;
      }
      autoTable(doc, {
        startY: y + 8,
        margin: { left: MARGEN, right: MARGEN },
        head: [['MO', 'Producto', 'Sector', 'Creada', 'Planificada', 'Días']],
        body: ordenes.map((o) => [o.reference, o.productName, o.sector, fechaAr(o.createdDate), o.plannedDate ? fechaAr(o.plannedDate) : '—', String(o.ageDays)]),
        styles: { ...baseStyles, fontSize: 8, cellPadding: 3 },
        headStyles: head,
        columnStyles: { 1: { cellWidth: 230 }, 5: { halign: 'right' } },
        didParseCell: (h: CellHookData) => {
          if (h.section === 'body' && h.column.index === 5) h.cell.styles.fillColor = FILL[color];
        },
      });
    }
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
