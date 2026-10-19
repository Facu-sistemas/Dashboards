import { MINUTOS_TURNO } from '@/lib/telamax/engine';
import { formatHoraGantt } from '@/lib/telamax/fechas';
import type { FilaPlanilla, Proceso, Registro } from '@/lib/telamax/types';

/** Los 20 colores de `tab20` de matplotlib, que usa Telamax para distinguir modelos en los Gantt. */
const TAB20 = [
  '#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a', '#d62728', '#ff9896', '#9467bd', '#c5b0d5',
  '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7', '#bcbd22', '#dbdb8d', '#17becf', '#9edae5',
];
export const COLOR_GUATA = '#A0A0A0';
export const COLOR_LIENZO = '#333333';

export function colorModelo(indice: number, total: number): string {
  return TAB20[Math.min(TAB20.length - 1, Math.floor((indice / Math.max(1, total)) * TAB20.length))]!;
}

export function mapaColores(plan: Registro[]): Map<string, string> {
  const modelos = [...new Set(plan.map((r) => r.modelo))].sort();
  return new Map(modelos.map((m, i) => [m, colorModelo(i, modelos.length)]));
}

export const TITULO_PROCESO: Record<Proceso, string> = {
  T: 'HOJA DE RUTA - TENDIDO',
  C: 'HOJA DE RUTA - CNC TELA',
  A: 'HOJA DE RUTA - ARMADO',
};

export interface BarraGantt {
  fila: number;
  inicio: number;
  fin: number;
  color: string;
  titulo: string;
  /** Borde claro, para barras oscuras (lienzo). */
  bordeClaro?: boolean;
}

/** Barras del Gantt de Tendido + CNC (filas "1. Tendido" y "2. CNC"). */
export function barrasCnc(plan: Registro[], filtro: string, colores: Map<string, string>): { barras: BarraGantt[]; leyenda: [string, string][] } {
  const barras: BarraGantt[] = [];
  const leyenda = new Map<string, string>();
  for (const r of plan) {
    if (r.proceso === 'A' || (filtro !== 'Todos' && r.modelo !== filtro)) continue;
    const color = r.tipoMaterial === 'Guata' ? COLOR_GUATA : r.tipoMaterial === 'Lienzo' ? COLOR_LIENZO : (colores.get(r.modelo) ?? COLOR_GUATA);
    barras.push({
      fila: r.proceso === 'T' ? 0 : 1,
      inicio: r.inicio,
      fin: r.fin,
      color,
      bordeClaro: r.tipoMaterial === 'Lienzo',
      titulo: `${r.modelo} · ${r.parte} · ${r.insumo} — ${formatHoraGantt(r.inicio)} a ${formatHoraGantt(r.fin)}`,
    });
    if (r.tipoMaterial === 'Tela') leyenda.set(r.modelo, color);
    else if (r.tipoMaterial === 'Guata') leyenda.set('Guata (Insumo)', COLOR_GUATA);
    else if (r.tipoMaterial === 'Lienzo') leyenda.set('Lienzo (Insumo)', COLOR_LIENZO);
  }
  return { barras, leyenda: [...leyenda.entries()] };
}

/** Barras del Gantt de Armado, una fila por operario (OP 1..n). */
export function barrasArmado(plan: Registro[], filtro: string, colores: Map<string, string>, operarios: number): { barras: BarraGantt[]; leyenda: [string, string][] } {
  const barras: BarraGantt[] = [];
  const leyenda = new Map<string, string>();
  for (const r of plan) {
    if (r.proceso !== 'A' || (filtro !== 'Todos' && r.modelo !== filtro)) continue;
    const op = Number(r.parte.replace(/\D/g, '')) - 1;
    const color = colores.get(r.modelo) ?? COLOR_GUATA;
    barras.push({
      fila: Math.min(Math.max(op, 0), operarios - 1),
      inicio: r.inicio,
      fin: r.fin,
      color,
      titulo: `${r.modelo} · ${r.sillones} un. — ${formatHoraGantt(r.inicio)} a ${formatHoraGantt(r.fin)}`,
    });
    leyenda.set(r.modelo, color);
  }
  return { barras, leyenda: [...leyenda.entries()] };
}

export function maxTiempo(plan: Registro[]): number {
  return plan.reduce((m, r) => Math.max(m, r.fin), 0);
}

/** Marcas del eje: cada `pasoMin` desde el inicio de CADA jornada (06:00, 07:00…), porque 488 min no es múltiplo de 60. */
export function marcasEje(maxT: number, pasoMin = 60): number[] {
  const marcas: number[] = [];
  const dias = Math.floor(maxT / MINUTOS_TURNO) + 1;
  for (let d = 0; d < dias; d++) {
    for (let t = d * MINUTOS_TURNO; t < (d + 1) * MINUTOS_TURNO - 25 && t <= maxT + 20; t += pasoMin) marcas.push(t); // -25: no pisar la marca del día siguiente
  }
  return marcas;
}

export function diasDelPlan(plan: Registro[]): number {
  return Math.floor(maxTiempo(plan) / MINUTOS_TURNO) + 1;
}

/** Lee la primera hoja de un .xlsx/.xls como filas con el encabezado como clave (celda vacía = null). */
export async function leerPlanilla(file: File): Promise<FilaPlanilla[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const hoja = wb.Sheets[wb.SheetNames[0]!];
  if (!hoja) throw new Error('El archivo no tiene hojas.');
  return XLSX.utils.sheet_to_json<FilaPlanilla>(hoja, { defval: null });
}

/** Mensaje de error si la planilla no sirve para Telamax (columnas obligatorias). */
export function validarPlanilla(filas: FilaPlanilla[]): string | null {
  if (filas.length === 0) return 'La planilla está vacía.';
  const cols = new Set(filas.flatMap((f) => Object.keys(f)));
  const faltan = ['Producto Origen', 'Tela'].filter((c) => !cols.has(c));
  if (faltan.length > 0) return `Faltan las columnas: ${faltan.map((c) => `"${c}"`).join(', ')}.`;
  if (!cols.has('Cantidad a producir') && !cols.has('Cant. ordenada')) return 'Falta la columna "Cantidad a producir" (o "Cant. ordenada").';
  return null;
}
