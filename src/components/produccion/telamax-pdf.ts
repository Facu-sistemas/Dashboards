import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MINUTOS_TURNO } from '@/lib/telamax/engine';
import { diaDe, fechasDe, formatHoraGantt, formatTablaH, hoyArgentina } from '@/lib/telamax/fechas';
import type { Proceso, Registro } from '@/lib/telamax/types';
import { TITULO_PROCESO, marcasEje, type BarraGantt } from './telamax-ui';

const MARGEN = 22;
const AZUL_OSCURO: [number, number, number] = [44, 62, 80];

function hexARgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const generado = () =>
  `Generado: ${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())}`;

type CeldaPdf = string | { content: string; colSpan: number; styles: Record<string, unknown> };

/** Dibuja UNA hoja de ruta (Tendido / CNC / Armado) en la página actual del documento, con separador por día. */
export function dibujarHojaRuta(doc: jsPDF, plan: Registro[], proc: Proceso, filtro: string, hoy: Date): void {
  const ancho = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(TITULO_PROCESO[proc], ancho / 2, MARGEN + 8, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`${generado()}${filtro !== 'Todos' ? ` · Modelo: ${filtro}` : ''}`, ancho / 2, MARGEN + 20, { align: 'center' });

  const body: CeldaPdf[][] = [];
  let diaActual: number | null = null;
  for (const r of plan) {
    if (r.proceso !== proc || (filtro !== 'Todos' && r.modelo !== filtro)) continue;
    const dia = diaDe(r.inicio);
    if (dia !== diaActual) {
      diaActual = dia;
      body.push([{ content: `--- DÍA ${dia} ---`, colSpan: 9, styles: { halign: 'center', fontStyle: 'bold', fillColor: [52, 73, 94], textColor: [245, 245, 245] } }]);
    }
    const f = fechasDe(r.procedencia, hoy);
    body.push([
      formatTablaH(r.inicio),
      formatTablaH(r.fin),
      r.modelo,
      r.parte.slice(0, 15),
      r.insumo,
      r.capas === '-' ? '1' : String(r.capas),
      proc !== 'A' && typeof r.metros === 'number' ? r.metros.toFixed(2) : '-',
      f.corte,
      f.planificacion,
    ]);
  }

  autoTable(doc, {
    startY: MARGEN + 30,
    margin: { left: MARGEN, right: MARGEN, top: MARGEN, bottom: MARGEN + 12 },
    rowPageBreak: 'avoid',
    head: [['INICIO', 'FIN', 'MODELO', 'PARTE', 'INSUMO', 'TENDIDAS', 'METROS', 'FECHA CORTE', 'FECHA PLANIF.']],
    body,
    styles: { font: 'helvetica', fontSize: 6.5, cellPadding: 2, halign: 'center', valign: 'middle', lineColor: [0, 0, 0], lineWidth: 0.4, textColor: [15, 23, 42] },
    headStyles: { fillColor: AZUL_OSCURO, textColor: [245, 245, 245] },
    alternateRowStyles: { fillColor: [235, 235, 235] },
    columnStyles: { 0: { cellWidth: 56 }, 1: { cellWidth: 56 }, 2: { cellWidth: 118 }, 3: { cellWidth: 64 }, 5: { cellWidth: 50 }, 6: { cellWidth: 50 }, 7: { cellWidth: 68 }, 8: { cellWidth: 68 } },
  });
}

/** Hojas de ruta en A4 apaisado, una por proceso. `fechaBase`: día de producción del que parten FECHA CORTE / FECHA PLANIF. (por defecto, hoy). */
export function generarPdfRutas(plan: Registro[], procesos: Proceso[], filtro: string, fechaBase: Date = hoyArgentina()): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  procesos.forEach((proc, idx) => {
    if (idx > 0) doc.addPage();
    dibujarHojaRuta(doc, plan, proc, filtro, fechaBase);
  });
  return doc;
}

/** Gantt dibujado en vectores (A4 apaisado): filas fijas, barras por modelo, líneas de inicio/fin de jornada. */
export function generarPdfGantt(titulo: string, filas: string[], barras: BarraGantt[], leyenda: [string, string][], maxT: number): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const izq = 90;
  const der = W - MARGEN;
  const top = MARGEN + 52;
  const filaAlto = Math.min(60, (H - top - 110) / Math.max(1, filas.length));
  const alto = filaAlto * filas.length;
  const escala = (der - izq) / Math.max(1, maxT + 20);
  const x = (t: number) => izq + t * escala;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(titulo, W / 2, MARGEN + 12, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(generado(), W / 2, MARGEN + 24, { align: 'center' });

  // grilla de horas
  doc.setFontSize(6);
  doc.setLineWidth(0.2);
  const paso = maxT > MINUTOS_TURNO * 3 ? 120 : 60;
  for (const t of marcasEje(maxT, paso)) {
    doc.setDrawColor(200, 200, 200);
    doc.setLineDashPattern([1, 2], 0);
    doc.line(x(t), top, x(t), top + alto);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(100, 116, 139);
    doc.text(formatHoraGantt(t), x(t), top + alto + 9, { align: 'center' });
  }
  // filas
  doc.setFontSize(8);
  filas.forEach((f, i) => {
    doc.setDrawColor(226, 232, 240);
    doc.rect(izq, top + i * filaAlto, der - izq, filaAlto);
    doc.setTextColor(15, 23, 42);
    doc.text(f, izq - 6, top + i * filaAlto + filaAlto / 2 + 3, { align: 'right' });
  });
  // barras
  for (const b of barras) {
    const [r, g, bl] = hexARgb(b.color);
    doc.setFillColor(r, g, bl);
    if (b.bordeClaro) doc.setDrawColor(255, 255, 255);
    else doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(x(b.inicio), top + b.fila * filaAlto + filaAlto * 0.12, Math.max(0.5, (b.fin - b.inicio) * escala), filaAlto * 0.76, 'FD');
  }
  // jornadas
  doc.setFontSize(7);
  for (let d = 0; d * MINUTOS_TURNO <= maxT; d++) {
    doc.setDrawColor(41, 128, 185);
    doc.setLineWidth(0.8);
    doc.line(x(d * MINUTOS_TURNO), top - 4, x(d * MINUTOS_TURNO), top + alto);
    doc.setTextColor(41, 128, 185);
    doc.text(`D${d + 1} 06:00`, x(d * MINUTOS_TURNO) + 2, top - 6);
    doc.setDrawColor(192, 57, 43);
    doc.setLineDashPattern([4, 3], 0);
    doc.line(x((d + 1) * MINUTOS_TURNO), top, x((d + 1) * MINUTOS_TURNO), top + alto);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(192, 57, 43);
    doc.text(`Fin D${d + 1}`, x((d + 1) * MINUTOS_TURNO) - 2, top - 6, { align: 'right' });
  }
  // leyenda
  let lx = izq;
  let ly = top + alto + 26;
  doc.setFontSize(7);
  for (const [nombre, color] of leyenda) {
    const w = doc.getTextWidth(nombre) + 22;
    if (lx + w > der) {
      lx = izq;
      ly += 11;
    }
    const [r, g, b] = hexARgb(color);
    doc.setFillColor(r, g, b);
    doc.setDrawColor(0, 0, 0);
    doc.rect(lx, ly - 6, 10, 7, 'FD');
    doc.setTextColor(15, 23, 42);
    doc.text(nombre, lx + 14, ly);
    lx += w + 6;
  }
  return doc;
}
