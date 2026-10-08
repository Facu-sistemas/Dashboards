import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_GRIS_PNG_BASE64 } from '../../lib/logos';
import { MESAS } from '../../lib/linea-config';
import type { PlanLinea } from '../../lib/linea-calc';
import { ORIGEN_LABEL, etiquetaTap, formatCantidad, formatMin, formatOcupacion, formatUnidades } from './linea-shared';

const GRIS_LOGO_ASPECT = 389 / 116; // ancho/alto reales del PNG embebido (mismo logo que VerticalApp)
const LOGO_WIDTH_PT = 90;
const LOGO_HEIGHT_PT = LOGO_WIDTH_PT / GRIS_LOGO_ASPECT;
const MARGEN = 40;

const nombreMesa = (codigo: string) => MESAS.find((m) => m.codigo === codigo)?.nombre ?? codigo;

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

const fechaCorta = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

/** Hoja para la línea: secuencia por mesa (para pegar en cada puesto) + detalle de órdenes del día. */
export function generarPdfLinea(plan: PlanLinea, diaLabel: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const finY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN, LOGO_WIDTH_PT, LOGO_HEIGHT_PT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('Planificado Línea Resorte', MARGEN, MARGEN + LOGO_HEIGHT_PT + 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  const { jornada } = plan;
  doc.text(`Día: ${diaLabel}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 38);
  doc.text(
    `Jornada ${jornada.inicio}–${jornada.fin} (${jornada.capacidadMin} min) · Desayuno ${jornada.pausaDesde}–${jornada.pausaHasta}`,
    MARGEN,
    MARGEN + LOGO_HEIGHT_PT + 52
  );
  const resumen = [
    `Ocupación: ${formatOcupacion(plan.mesas, jornada.capacidadMin)}`,
    plan.atrasadoMin > 0 ? `atrasado ${formatMin(plan.atrasadoMin)}` : null,
    plan.adelantadoMin > 0 ? `adelantado ${formatMin(plan.adelantadoMin)}` : null,
    plan.excedenteMin > 0 ? `NO ENTRA ${formatMin(plan.excedenteMin)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  doc.text(resumen, MARGEN, MARGEN + LOGO_HEIGHT_PT + 66);
  doc.text(generadoLabel(), MARGEN, MARGEN + LOGO_HEIGHT_PT + 80);

  autoTable(doc, {
    startY: MARGEN + LOGO_HEIGHT_PT + 94,
    margin: { left: MARGEN, right: MARGEN },
    head: [['Mesa', 'Desde', 'Hasta', 'Tap / medida', 'Cant.', 'Min', 'Origen']],
    body: plan.mesas
      .filter((m) => m.activa)
      .flatMap((m) =>
        m.tramos.length === 0
          ? [[m.nombre, '—', '—', 'Sin trabajo asignado', '', '', '']]
          : m.tramos.map((t, i) => [
              i === 0 ? m.nombre : '',
              t.excede ? 'no entra' : t.desde,
              t.excede ? '' : t.hasta,
              etiquetaTap(t.familia, t.medida),
              formatUnidades(t.unidades),
              Math.round(t.minutos).toString(),
              t.origen === 'dia' ? '' : ORIGEN_LABEL[t.origen],
            ])
      ),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    columnStyles: { 0: { fontStyle: 'bold' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    didParseCell: (data) => {
      // Línea separadora más marcada al empezar cada mesa.
      if (data.section === 'body' && data.column.index === 0 && data.cell.raw) data.cell.styles.fillColor = [241, 245, 249];
    },
  });

  autoTable(doc, {
    startY: finY() + 20,
    margin: { left: MARGEN, right: MARGEN },
    head: [['Orden', 'Producto', 'Cant.', 'Min', 'Mesas', 'Origen']],
    body: plan.planificados.flatMap((it) =>
      it.ordenes.map((o) => [
        o.name,
        o.producto,
        formatCantidad(o.cantidad, o.fraccion),
        Math.round(o.horas * 60 * o.fraccion).toString(),
        it.mesas.map(nombreMesa).join(it.modo === 'serie' ? ' > ' : ' + '),
        o.origen === 'dia' ? '' : `${ORIGEN_LABEL[o.origen]} (${fechaCorta(o.fecha)})`,
      ])
    ),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  const pendientes = [...plan.sinRegla, ...plan.sinMesa];
  if (pendientes.length > 0) {
    let y = finY() + 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(180, 83, 9);
    doc.text('Sin planificar (sin regla o sin mesas activas):', MARGEN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    for (const it of pendientes) {
      y += 13;
      doc.text(`- ${etiquetaTap(it.familia, it.medida)}: ${it.ordenes.length} orden(es), ${formatMin(it.totalMin)}`, MARGEN, y);
    }
  }

  return doc;
}
