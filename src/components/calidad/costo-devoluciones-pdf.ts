import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_GRIS_PNG_BASE64 } from '../../lib/logos';
import type { TarifasMes } from '../../lib/supabase/costo-devoluciones-tarifas';
import {
  SECTOR_LABEL,
  armarResumen,
  fmt,
  fmtHoras,
  fmtMil,
  fmtMonto,
  mesLabel,
  positivo,
  type Filtros,
  type Resultado,
} from './costo-devoluciones-calc';

const LOGO_ASPECT = 389 / 116; // ancho/alto reales del PNG embebido
const LOGO_WIDTH_PT = 90;
const LOGO_HEIGHT_PT = LOGO_WIDTH_PT / LOGO_ASPECT;
const MARGEN = 40;

const generado = () =>
  `Generado: ${new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())}`;

/** Resumen mensual de costo de devoluciones, para guardar. A4 apaisado (la tabla por provincia tiene 9 columnas). */
export function generarPdfCostoDevoluciones(r: Resultado, f: Filtros, t: TarifasMes, empresaNombre: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const anchoUtil = doc.internal.pageSize.getWidth() - MARGEN * 2;
  const finY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN, LOGO_WIDTH_PT, LOGO_HEIGHT_PT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`Costo de devoluciones — ${mesLabel(f.mes)}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 24);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Sector: ${SECTOR_LABEL[f.sector]}  ·  Empresa: ${empresaNombre}  ·  ${generado()}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 40);

  doc.setFontSize(10.5);
  doc.setTextColor(30, 41, 59);
  const lineas = doc.splitTextToSize(armarResumen(r, f, t), anchoUtil);
  doc.text(lineas, MARGEN, MARGEN + LOGO_HEIGHT_PT + 62);
  let y = MARGEN + LOGO_HEIGHT_PT + 62 + lineas.length * 14 + 8;

  const indices: string[][] = [];
  if (f.sector !== 'colchon') indices.push(['Living', fmt(r.living.devoluciones), fmt(r.living.unidades), fmtMil(r.living.porMil)]);
  if (f.sector !== 'living') indices.push(['Colchón', fmt(r.colchon.devoluciones), fmt(r.colchon.unidades), fmtMil(r.colchon.porMil)]);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN },
    head: [['Sector', 'Devoluciones', 'Unidades fabricadas', 'Cada 1.000 fabricadas']],
    body: indices,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    tableWidth: 420,
  });
  y = finY() + 14;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN },
    head: [['Provincia', 'Living', 'Colchón', 'Total', 'Flete por viaje', 'Flete total', 'Horas rep.', 'Reparación', 'Costo total', 'Notas de crédito']],
    body: r.filas.map((x) => [
      x.provincia,
      fmt(x.living),
      fmt(x.colchon),
      fmt(x.dev),
      fmtMonto(positivo(t.fletes[x.provincia])),
      fmtMonto(x.flete),
      fmtHoras(x.horas),
      fmtMonto(x.reparacion),
      fmtMonto(x.costo),
      fmtMonto(x.notaCredito),
    ]),
    foot: [
      [
        'Total',
        fmt(r.totales.living),
        fmt(r.totales.colchon),
        fmt(r.totales.dev),
        '',
        fmtMonto(r.totales.flete),
        fmtHoras(r.totales.horas),
        fmtMonto(r.totales.reparacion),
        fmtMonto(r.totales.costo),
        fmtMonto(r.totales.notaCredito),
      ],
    ],
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [30, 41, 59] },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [i, { halign: 'right' as const }])),
  });
  y = finY() + 14;

  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  const notas = doc.splitTextToSize(
    `Tarifas usadas: costo por hora de reparación ${fmtMonto(positivo(t.costoHora))}; ${fmt(positivo(t.viajes))} viajes de flete por devolución; flete por viaje por provincia según la tabla. ` +
      'Devoluciones: Living = órdenes de reparación; Colchón = notas de crédito de Garantía y Calidad (las horas incluyen reparaciones de Colchón). ' +
      'La provincia es la del cliente de cada nota u orden.',
    anchoUtil
  );
  doc.text(notas, MARGEN, y);

  return doc;
}
