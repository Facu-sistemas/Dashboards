import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_GRIS_PNG_BASE64 } from '@/lib/logos';
import { MINUTOS_TURNO } from '@/lib/telamax/engine';
import { formatFecha, formatTablaH } from '@/lib/telamax/fechas';
import type { Proceso, Registro, ResultadoTelamax } from '@/lib/telamax/types';
import { dibujarHojaRuta } from './telamax-pdf';
import { diasDelPlan } from './telamax-ui';

const MARGEN = 28;
const LOGO_ASPECT = 389 / 116; // ancho/alto reales del PNG embebido (mismo logo que el resto de los PDFs)
const LOGO_ANCHO = 90;
const AZUL: [number, number, number] = [44, 62, 80];
const TEXTO: [number, number, number] = [15, 23, 42];
const GRIS: [number, number, number] = [100, 116, 139];

export interface DatosReporte {
  resultado: ResultadoTelamax;
  operarios: number;
  /** Día de producción del que parten FECHA CORTE / FECHA PLANIF. */
  fechaBase: Date;
  /** De dónde salieron las órdenes (se imprime en el encabezado). */
  origenTexto: string;
  filtro: string;
}

const finY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

const generado = () =>
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());

/** El log trae emojis (⏱️ 📦 ⚠️ ℹ️) que la tipografía del PDF no dibuja: se sacan y queda el texto. */
const EMOJI = /[\u{1F000}-\u{1FFFF}\u2139\u2190-\u2BFF\uFE0F]/gu;
const sinEmojis = (t: string) => {
  const limpio = t.replace(EMOJI, '');
  return /^[\u{1F000}-\u{1FFFF}\u2139\u2190-\u2BFF]/u.test(t) ? limpio.trim() : limpio.trimEnd();
};

const n1 = (x: number) => x.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function encabezadoPagina(doc: jsPDF, titulo: string): number {
  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN - 6, LOGO_ANCHO, LOGO_ANCHO / LOGO_ASPECT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...TEXTO);
  doc.text(titulo, doc.internal.pageSize.getWidth() - MARGEN, MARGEN + 8, { align: 'right' });
  return MARGEN + LOGO_ANCHO / LOGO_ASPECT + 8;
}

function tarjeta(doc: jsPDF, x: number, y: number, w: number, etiqueta: string, valor: string): void {
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, 40, 3, 3, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text(etiqueta, x + 8, y + 13);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...TEXTO);
  doc.text(valor, x + 8, y + 31);
}

/** Metros de tendido por material e insumo: tendidas × largo de cada capa. */
function materialesAPreparar(plan: Registro[]): { tipo: string; insumo: string; tendidas: number; metros: number }[] {
  const m = new Map<string, { tipo: string; insumo: string; tendidas: number; metros: number }>();
  for (const r of plan) {
    if (r.proceso !== 'T' || typeof r.capas !== 'number' || typeof r.metros !== 'number') continue;
    const k = `${r.tipoMaterial}\u0000${r.insumo}`;
    const e = m.get(k) ?? { tipo: r.tipoMaterial, insumo: r.insumo, tendidas: 0, metros: 0 };
    e.tendidas += r.capas;
    e.metros += r.capas * r.metros;
    m.set(k, e);
  }
  const orden: Record<string, number> = { Tela: 0, Guata: 1, Lienzo: 2 };
  return [...m.values()].sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9) || a.insumo.localeCompare(b.insumo));
}

function resumenPorModelo(plan: Registro[]): { modelo: string; tendidas: number; metros: number; finCnc: number; finArmado: number | null }[] {
  const m = new Map<string, { modelo: string; tendidas: number; metros: number; finCnc: number; finArmado: number | null }>();
  for (const r of plan) {
    const e = m.get(r.modelo) ?? { modelo: r.modelo, tendidas: 0, metros: 0, finCnc: 0, finArmado: null };
    if (r.proceso === 'T' && r.tipoMaterial === 'Tela' && typeof r.capas === 'number' && typeof r.metros === 'number') {
      e.tendidas += r.capas;
      e.metros += r.capas * r.metros;
    }
    if (r.proceso === 'C') e.finCnc = Math.max(e.finCnc, r.fin);
    if (r.proceso === 'A') e.finArmado = Math.max(e.finArmado ?? 0, r.fin);
    m.set(r.modelo, e);
  }
  return [...m.values()].sort((a, b) => a.modelo.localeCompare(b.modelo));
}

function paginaResumen(doc: jsPDF, d: DatosReporte): void {
  const { resultado: r } = d;
  const ancho = doc.internal.pageSize.getWidth();
  let y = encabezadoPagina(doc, 'Plan de producción de telas — Telamax') + 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  doc.text(`Día de producción: ${formatFecha(d.fechaBase)}  ·  Operarios de armado: ${d.operarios}${d.filtro !== 'Todos' ? `  ·  Modelo: ${d.filtro}` : ''}`, MARGEN, y);
  y += 12;
  doc.text(`Origen: ${d.origenTexto}`, MARGEN, y);
  y += 12;
  doc.text(`Generado: ${generado()}`, MARGEN, y);
  y += 14;

  const util = ancho - MARGEN * 2;
  const w = (util - 3 * 10) / 4;
  const kpis: [string, string][] = [
    ['Días de producción', String(diasDelPlan(r.plan))],
    ['Fin del Tendido', formatTablaH(r.tTendido)],
    ['Fin del CNC', formatTablaH(r.tCnc)],
    ['Fin del Armado', formatTablaH(Math.max(0, ...r.tArmadores))],
  ];
  kpis.forEach(([e, v], i) => tarjeta(doc, MARGEN + i * (w + 10), y, w, e, v));
  y += 54;

  const modelos = resumenPorModelo(r.plan);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN, bottom: MARGEN + 12 },
    head: [['Modelo', 'Tendidas de tela', 'Metros de tela', 'Termina CNC', 'Termina armado']],
    body: modelos.map((m) => [m.modelo, String(m.tendidas), n1(m.metros), formatTablaH(m.finCnc), m.finArmado === null ? '-' : formatTablaH(m.finArmado)]),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: TEXTO },
    headStyles: { fillColor: AZUL, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'center' }, 4: { halign: 'center' } },
  });

  const mats = materialesAPreparar(r.plan);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXTO);
  let yMat = finY(doc) + 22;
  if (yMat > doc.internal.pageSize.getHeight() - 90) {
    doc.addPage();
    yMat = MARGEN + 10;
  }
  doc.text('Materiales a preparar (tendidas × largo de cada capa)', MARGEN, yMat);
  autoTable(doc, {
    startY: yMat + 6,
    margin: { left: MARGEN, right: MARGEN, bottom: MARGEN + 12 },
    head: [['Material', 'Insumo', 'Tendidas', 'Metros']],
    body: mats.map((m) => [m.tipo, m.insumo, String(m.tendidas), n1(m.metros)]),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: TEXTO },
    headStyles: { fillColor: AZUL, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  const alertas = [...new Set(r.alertasPlanillas)];
  if (alertas.length > 0) {
    let yA = finY(doc) + 22;
    if (yA > doc.internal.pageSize.getHeight() - 70) {
      doc.addPage();
      yA = MARGEN + 10;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(180, 83, 9);
    doc.text('Productos que NO se pudieron planificar', MARGEN, yA);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXTO);
    let yy = yA + 14;
    for (const a of alertas) {
      for (const linea of doc.splitTextToSize(`- ${sinEmojis(a)}`, util) as string[]) {
        if (yy > doc.internal.pageSize.getHeight() - MARGEN - 14) {
          doc.addPage();
          yy = MARGEN + 10;
        }
        doc.text(linea, MARGEN, yy);
        yy += 11;
      }
    }
  }
}

/** Una hoja por operario de armado, para entregársela impresa. */
function paginasArmadoPorOperario(doc: jsPDF, d: DatosReporte): void {
  const { resultado: r } = d;
  for (let op = 1; op <= d.operarios; op++) {
    doc.addPage();
    const y0 = encabezadoPagina(doc, `Armado — Operario ${op}`) + 4;
    const filas = r.plan.filter((x) => x.proceso === 'A' && x.parte === `OP ${op}` && (d.filtro === 'Todos' || x.modelo === d.filtro)).sort((a, b) => a.inicio - b.inicio);
    const minutos = filas.reduce((t, x) => t + (x.fin - x.inicio), 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS);
    doc.text(`Día de producción: ${formatFecha(d.fechaBase)}  ·  ${filas.length} tareas  ·  ${Math.round(minutos)} min de armado`, MARGEN, y0 + 10);

    const body: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = [];
    let dia: number | null = null;
    for (const x of filas) {
      const dx = Math.floor(x.inicio / MINUTOS_TURNO) + 1;
      if (dx !== dia) {
        dia = dx;
        body.push([{ content: `--- DÍA ${dx} ---`, colSpan: 5, styles: { halign: 'center', fontStyle: 'bold', fillColor: [52, 73, 94], textColor: [245, 245, 245] } }]);
      }
      body.push([formatTablaH(x.inicio), formatTablaH(x.fin), x.modelo, String(x.sillones), '']);
    }
    autoTable(doc, {
      startY: y0 + 20,
      rowPageBreak: 'avoid',
      margin: { left: MARGEN, right: MARGEN, bottom: MARGEN + 12 },
      head: [['INICIO', 'FIN', 'MODELO', 'UNIDADES', 'HECHO']],
      body: body.length > 0 ? body : [[{ content: 'Sin tareas asignadas.', colSpan: 5, styles: { halign: 'center' } }]],
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, halign: 'center', lineColor: [0, 0, 0], lineWidth: 0.4, textColor: TEXTO },
      headStyles: { fillColor: AZUL, textColor: [245, 245, 245] },
      alternateRowStyles: { fillColor: [240, 240, 240] },
      columnStyles: { 2: { halign: 'left', cellWidth: 300 }, 4: { cellWidth: 60 } },
    });
  }
}

function paginasLog(doc: jsPDF, r: ResultadoTelamax): void {
  doc.addPage();
  let y = encabezadoPagina(doc, 'Log de planta') + 6;
  const util = doc.internal.pageSize.getWidth() - MARGEN * 2;
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXTO);
  const lineas = r.bitacora.length > 0 ? r.bitacora : ['Flujo continuo perfecto. Sin eventos de ocio ni desbordes detectados.'];
  for (const l of lineas) {
    const texto = sinEmojis(l);
    for (const parte of doc.splitTextToSize(texto || ' ', util) as string[]) {
      if (y > doc.internal.pageSize.getHeight() - MARGEN - 16) {
        doc.addPage();
        y = MARGEN + 6;
      }
      doc.text(parte, MARGEN, y);
      y += 9.5;
    }
  }
}

function numerarPaginas(doc: jsPDF): void {
  const total = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text('Telamax · Frontera Living', MARGEN, h - 14);
    doc.text(`Página ${i} de ${total}`, w - MARGEN, h - 14, { align: 'right' });
  }
}

/** Reporte completo para imprimir: resumen, hojas de ruta, armado por operario y log de planta (A4 apaisado). */
export function generarPdfReporte(d: DatosReporte): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  paginaResumen(doc, d);
  const procesos: Proceso[] = ['T', 'C', 'A'];
  for (const proc of procesos) {
    doc.addPage();
    dibujarHojaRuta(doc, d.resultado.plan, proc, d.filtro, d.fechaBase);
  }
  paginasArmadoPorOperario(doc, d);
  paginasLog(doc, d.resultado);
  numerarPaginas(doc);
  return doc;
}

/** Abre el PDF en una pestaña nueva y dispara el diálogo de impresión del navegador. */
export function imprimirPdf(doc: jsPDF): void {
  doc.autoPrint();
  const url = String(doc.output('bloburl'));
  window.open(url, '_blank');
}
