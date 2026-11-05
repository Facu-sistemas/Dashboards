import { jsPDF } from 'jspdf';
import type { LineaPlan } from '@/lib/lineas-sillon/plan';
import { LOGO_GRIS_PNG_BASE64 } from '@/lib/logos';
import { CIERRE_SEG } from '@/lib/lineas-sillon/engine';
import { porcentaje } from './lineas-sillon-shared';

/**
 * PDF con el mismo diseño que la hoja HORARIOS de la planilla, que el equipo imprime,
 * pega en la pared y recorta: una hoja apaisada por línea con tres bloques lado a lado
 * (Carpintería, Tapicería, Ensamble + columna U.E.), 45 filas numeradas por hoja.
 */

const FILAS_POR_HOJA = 45;
const MARGEN = 24;
const GAP = 10;
const ANCHO_NUM = 18;
const ANCHO_HORA = 48;
const ANCHO_UE = 38;
const ALTO_TITULO = 28;
const ALTO_FILA_CAB = 14;
const ALTO_BLANCO = 10;
/** Filas de aire bajo el nombre del puesto: la persona del puesto y las costureras de la línea. */
const FILAS_GENTE = 2;
const GROSOR = 0.4;
/** Franja superior con el logo y la fecha, arriba de los tres bloques. */
const ALTO_ENCABEZADO = 26;
const LOGO_ANCHO = 72;
const LOGO_ALTO = LOGO_ANCHO / (389 / 116); // proporción real del PNG embebido
const TOP = MARGEN + ALTO_ENCABEZADO;

const ue = (x: number) => x.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fechaPlanilla = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function celda(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.rect(x, y, w, h);
}

function texto(doc: jsPDF, s: string, x: number, y: number, w: number, h: number, align: 'left' | 'center' | 'right', pad = 3) {
  const baseY = y + h / 2 + doc.getFontSize() * 0.35;
  if (align === 'left') doc.text(s, x + pad, baseY);
  else if (align === 'right') doc.text(s, x + w - pad, baseY, { align: 'right' });
  else doc.text(s, x + w / 2, baseY, { align: 'center' });
}

function bloque(
  doc: jsPDF,
  x: number,
  anchoBloque: number,
  lp: LineaPlan,
  estacion: number,
  fecha: string,
  dia: number,
  desde: number,
  altoFila: number,
  gente: [string, string],
) {
  const est = lp.estaciones[estacion]!;
  const tramos = est.tramos.filter((t) => t.dia === dia);
  // La U.E. y la eficiencia se miden dentro del día: la acumulada arranca donde terminó el día anterior.
  const ueBase = est.tramos.filter((t) => t.dia < dia).at(-1)?.ueAcum ?? 0;
  const eficiencia = tramos.length ? tramos[tramos.length - 1]!.finRelojSeg / CIERRE_SEG : 0;
  const esUltimo = estacion === 2;
  const anchoCuerpo = esUltimo ? anchoBloque - ANCHO_UE : anchoBloque;
  const anchoProd = anchoCuerpo - ANCHO_NUM - ANCHO_HORA;
  let y = TOP;

  // Título "LINEA N"
  doc.setFont('helvetica', 'normal').setFontSize(16);
  celda(doc, x, y, anchoCuerpo, ALTO_TITULO);
  texto(doc, `LINEA ${lp.linea}`, x, y, anchoCuerpo, ALTO_TITULO, 'center');
  y += ALTO_TITULO;

  // Eficiencia, alineada a la derecha como en la planilla
  doc.setFontSize(9);
  celda(doc, x, y, anchoCuerpo, ALTO_FILA_CAB);
  texto(doc, porcentaje(eficiencia), x, y, anchoCuerpo, ALTO_FILA_CAB, 'right');
  y += ALTO_FILA_CAB;

  // Fecha (y "U.E" sobre la columna de unidades equivalentes)
  celda(doc, x, y, anchoCuerpo, ALTO_FILA_CAB);
  texto(doc, fechaPlanilla(fecha), x, y, anchoCuerpo, ALTO_FILA_CAB, 'center');
  if (esUltimo) {
    celda(doc, x + anchoCuerpo, y, ANCHO_UE, ALTO_FILA_CAB);
    texto(doc, 'U.E', x + anchoCuerpo, y, ANCHO_UE, ALTO_FILA_CAB, 'center');
  }
  y += ALTO_FILA_CAB;

  // Nombre de la estación
  doc.setFont('helvetica', 'bold');
  celda(doc, x, y, ANCHO_NUM, ALTO_FILA_CAB);
  celda(doc, x + ANCHO_NUM, y, anchoProd, ALTO_FILA_CAB);
  celda(doc, x + ANCHO_NUM + anchoProd, y, ANCHO_HORA, ALTO_FILA_CAB);
  texto(doc, est.nombre.split(' ')[0]!.toUpperCase(), x + ANCHO_NUM, y, anchoProd, ALTO_FILA_CAB, 'center');
  if (esUltimo) celda(doc, x + anchoCuerpo, y, ANCHO_UE, ALTO_FILA_CAB);
  y += ALTO_FILA_CAB;

  // Filas de aire de la planilla: la persona del puesto y, abajo, las costureras que le cosen a la línea
  doc.setFont('helvetica', 'normal');
  gente.forEach((linea) => {
    if (linea) {
      let tam = 6.5;
      doc.setFontSize(tam);
      while (tam > 4 && doc.getTextWidth(linea) > anchoCuerpo - 2) doc.setFontSize((tam -= 0.25));
      texto(doc, linea, x, y, anchoCuerpo, ALTO_BLANCO, 'center', 1);
    }
    y += ALTO_BLANCO;
  });

  doc.setFont('helvetica', 'normal').setFontSize(7);
  let ueMostrado = desde > 0 ? (tramos[desde - 1]?.ueAcum ?? 0) - ueBase : 0;
  for (let i = 0; i < FILAS_POR_HOJA; i++) {
    const t = tramos[desde + i];
    celda(doc, x, y, ANCHO_NUM, altoFila);
    celda(doc, x + ANCHO_NUM, y, anchoProd, altoFila);
    celda(doc, x + ANCHO_NUM + anchoProd, y, ANCHO_HORA, altoFila);
    texto(doc, String(desde + i + 1), x, y, ANCHO_NUM, altoFila, 'right', 2);
    if (t) {
      texto(doc, t.producto, x + ANCHO_NUM, y, anchoProd, altoFila, 'left');
      texto(doc, t.finReloj, x + ANCHO_NUM + anchoProd, y, ANCHO_HORA, altoFila, 'right');
      ueMostrado = t.ueAcum - ueBase;
    }
    if (esUltimo) {
      celda(doc, x + anchoCuerpo, y, ANCHO_UE, altoFila);
      // Igual que la planilla: pasada la última unidad, la U.E. se repite.
      if (ueMostrado > 0) texto(doc, ue(ueMostrado), x + anchoCuerpo, y, ANCHO_UE, altoFila, 'right');
    }
    y += altoFila;
  }
}

const fechaCompleta = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Logo chico a la izquierda y fecha completa de la producción al centro. */
function encabezado(doc: jsPDF, hoy: string, ancho: number) {
  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN - 6, LOGO_ANCHO, LOGO_ALTO);
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0);
  doc.text(fechaCompleta(hoy).toUpperCase(), ancho / 2, MARGEN + 6, { align: 'center' });
  doc.setFont('helvetica', 'normal');
}

/** Por bloque: la persona del puesto y las costureras de la línea (las mismas en los tres bloques). */
function genteDe(lp: LineaPlan, nombres: Map<string, string>): [string, string][] {
  const a = lp.config.asignados;
  const n = (slot: 'C1' | 'C2' | 'C3' | 'C' | 'T' | 'E') => (a[slot] ? nombres.get(a[slot]!) : undefined);
  const costureras = [n('C1'), n('C2'), n('C3')].filter(Boolean).join(' / ');
  const costura = costureras ? `Costureras: ${costureras}` : '';
  return [
    [n('C') ? `Carpintería: ${n('C')}` : '', costura],
    [n('T') ? `Tapicería: ${n('T')}` : '', costura],
    [n('E') ? `Ensamble: ${n('E')}` : '', costura],
  ];
}

/** Devuelve false si no hay nada para imprimir (ninguna línea con unidades ese día). `fecha`: día impreso; `dia`: 0 = hoy, 1 = el siguiente día planificado… `nombres`: id de persona → nombre. */
export function generarPdfSillon(
  lineas: LineaPlan[],
  fecha: string,
  pie: string,
  archivo: string,
  nombres: Map<string, string> = new Map(),
  dia = 0,
): boolean {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setLineWidth(GROSOR);
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const base = (ancho - 2 * MARGEN - 2 * GAP - ANCHO_UE) / 3;
  const anchos = [base, base, base + ANCHO_UE];
  const yDatos = TOP + ALTO_TITULO + 2 * ALTO_FILA_CAB + ALTO_FILA_CAB + FILAS_GENTE * ALTO_BLANCO;
  const altoFila = (alto - MARGEN - 14 - yDatos) / FILAS_POR_HOJA;

  let primera = true;
  for (const lp of lineas) {
    const n = lp.estaciones[0]!.tramos.filter((t) => t.dia === dia).length;
    for (let desde = 0; desde < n; desde += FILAS_POR_HOJA) {
      if (!primera) doc.addPage();
      primera = false;
      encabezado(doc, fecha, ancho);
      let x = MARGEN;
      const gente = genteDe(lp, nombres);
      anchos.forEach((a, i) => {
        bloque(doc, x, a, lp, i, fecha, dia, desde, altoFila, gente[i]!);
        x += a + GAP;
      });
      doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(120);
      doc.text(pie, MARGEN, alto - 12);
      doc.setTextColor(0);
    }
  }
  if (primera) return false;
  doc.save(archivo);
  return true;
}
