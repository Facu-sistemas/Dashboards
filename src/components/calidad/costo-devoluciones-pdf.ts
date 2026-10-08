import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_GRIS_PNG_BASE64 } from '../../lib/logos';
import type { TarifasMes } from '../../lib/supabase/costo-devoluciones-tarifas';
import {
  CAUSAS,
  CAUSA_LABEL,
  SECTOR_LABEL,
  armarResumen,
  fmt,
  fmtHoras,
  fmtMil,
  fmtMonto,
  fmtPct,
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

const monto = (n: number) => (n === 0 ? '—' : fmtMonto(n));

/** Resumen mensual del costo de no calidad, para guardar. A4 apaisado (las tablas tienen muchas columnas). */
export function generarPdfCostoDevoluciones(r: Resultado, f: Filtros, t: TarifasMes, empresaNombre: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const anchoUtil = doc.internal.pageSize.getWidth() - MARGEN * 2;
  const finY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const tabla = { margin: { left: MARGEN, right: MARGEN }, headStyles: { fillColor: [30, 41, 59] as [number, number, number] } };
  const derecha = (desde: number, hasta: number) =>
    Object.fromEntries(Array.from({ length: hasta - desde + 1 }, (_, i) => [desde + i, { halign: 'right' as const }]));

  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN, LOGO_WIDTH_PT, LOGO_HEIGHT_PT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`Costo de no calidad — ${mesLabel(f.mes)}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 24);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Sector: ${SECTOR_LABEL[f.sector]}  ·  Empresa: ${empresaNombre}  ·  ${generado()}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 40);

  doc.setFontSize(10.5);
  doc.setTextColor(30, 41, 59);
  const lineas = doc.splitTextToSize(armarResumen(r, f), anchoUtil);
  doc.text(lineas, MARGEN, MARGEN + LOGO_HEIGHT_PT + 62);
  let y = MARGEN + LOGO_HEIGHT_PT + 62 + lineas.length * 14 + 8;

  // Índice de devoluciones.
  const indices: string[][] = [];
  if (f.sector !== 'colchon') indices.push(['Living', fmt(r.living.devoluciones), fmt(r.living.unidades), fmtMil(r.living.porMil)]);
  if (f.sector !== 'living') indices.push(['Colchón', fmt(r.colchon.devoluciones), fmt(r.colchon.unidades), fmtMil(r.colchon.porMil)]);
  autoTable(doc, {
    ...tabla,
    startY: y,
    head: [['Sector', 'Devoluciones', 'Unidades fabricadas', 'Cada 1.000 fabricadas']],
    body: indices,
    styles: { fontSize: 9 },
    columnStyles: derecha(1, 3),
    tableWidth: 420,
  });
  y = finY() + 14;

  // Por motivo.
  autoTable(doc, {
    ...tabla,
    startY: y,
    head: [['Motivo', 'Casos', 'Flete', 'Mano de obra', 'Material', 'Costo bruto', 'Facturado', 'Costo neto']],
    body: CAUSAS.filter((c) => r.porCausa[c].casos > 0).map((c) => {
      const m = r.porCausa[c];
      return [CAUSA_LABEL[c], fmt(m.casos), monto(m.flete), monto(m.manoObra), monto(m.material), monto(m.bruto), monto(m.facturado), monto(m.neto)];
    }),
    foot: [
      [
        'Total',
        fmt(r.totales.casos),
        monto(r.totales.flete),
        monto(r.totales.manoObra),
        monto(r.totales.material),
        monto(r.totales.bruto),
        monto(r.totales.facturado),
        monto(r.totales.neto),
      ],
    ],
    styles: { fontSize: 8.5 },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    columnStyles: derecha(1, 7),
  });
  y = finY() + 14;

  // Por provincia.
  autoTable(doc, {
    ...tabla,
    startY: y,
    head: [['Provincia', 'Living', 'Colchón', 'Recargo región', 'Flete', 'Mano de obra', 'Horas', 'Material', 'Facturado', 'Costo neto']],
    body: r.filas.map((x) => [
      x.provincia,
      fmt(x.living),
      fmt(x.colchon),
      fmtPct(x.recargoPct),
      monto(x.flete),
      monto(x.manoObra),
      fmtHoras(x.horas),
      monto(x.material),
      monto(x.facturado),
      monto(x.neto),
    ]),
    foot: [
      [
        'Total',
        fmt(r.totales.living),
        fmt(r.totales.colchon),
        '',
        monto(r.totales.flete),
        monto(r.totales.manoObra),
        fmtHoras(r.totales.horas),
        monto(r.totales.material),
        monto(r.totales.facturado),
        monto(r.totales.neto),
      ],
    ],
    styles: { fontSize: 8.5 },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    columnStyles: derecha(1, 9),
  });
  y = finY() + 14;

  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  const notas = doc.splitTextToSize(
    `Tarifas usadas: hora de reparación ${fmtMonto(positivo(t.costoHora))}; ${fmt(positivo(t.viajes))} viajes de flete por devolución, a la tarifa de cada provincia o, si no hay, al recargo de la región del cliente sobre el valor del producto. ` +
      'Material = costo del producto menos lo recuperado al desarmarlo (Living) o costo del colchón devuelto (Colchón). ' +
      'Facturado = importe de la nota de venta vinculada al ticket (transportista o cliente). Costo neto = flete + mano de obra + material − facturado. ' +
      'Los descuentos y acuerdos comerciales no se cuentan como devoluciones.',
    anchoUtil
  );
  doc.text(notas, MARGEN, y);

  return doc;
}
