import { MINUTOS_TURNO } from './engine';
import type { Procedencia, Registro } from './types';

/**
 * Fechas de las hojas de ruta de Telamax. Misma lógica que el Python:
 * solo feriados nacionales fijos, y las fechas parten de HOY (hora Argentina).
 * Las fechas se manejan como Date a mediodía UTC para no correrse de día.
 */

const FERIADOS_FIJOS = new Set(['1-1', '24-3', '2-4', '1-5', '25-5', '20-6', '9-7', '8-12', '25-12']); // día-mes

export function hoyArgentina(): Date {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = partes.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function esFinDeSemana(f: Date): boolean {
  const dow = f.getUTCDay(); // 0 domingo, 6 sábado
  return dow === 0 || dow === 6;
}

export function esFeriado(f: Date): boolean {
  return FERIADOS_FIJOS.has(`${f.getUTCDate()}-${f.getUTCMonth() + 1}`);
}

function masDias(f: Date, n: number): Date {
  return new Date(f.getTime() + n * 86_400_000);
}

export function sumarDiasHabiles(base: Date, dias: number): Date {
  let curr = base;
  let sumados = 0;
  while (sumados < dias) {
    curr = masDias(curr, 1);
    if (esFinDeSemana(curr) || esFeriado(curr)) continue;
    sumados += 1;
  }
  return curr;
}

export function fechaCorteEfectiva(hoy: Date): Date {
  let curr = hoy;
  while (esFinDeSemana(curr) || esFeriado(curr)) curr = masDias(curr, 1);
  return curr;
}

/** "YYYY-MM-DD" → Date a mediodía UTC (mismo criterio que el resto del módulo). */
export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function toISO(f: Date): string {
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`;
}

export function formatFecha(f: Date): string {
  return `${String(f.getUTCDate()).padStart(2, '0')}/${String(f.getUTCMonth() + 1).padStart(2, '0')}/${f.getUTCFullYear()}`;
}

/** "D2 07:35": minuto absoluto del plan → día de producción y hora real (la jornada arranca a las 06:00). */
export function formatTablaH(x: number): string {
  const d = Math.floor(Math.trunc(x) / MINUTOS_TURNO) + 1;
  const m = (Math.trunc(x) % MINUTOS_TURNO) + 360;
  return `D${d} ${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Solo la hora ("07:35") para el eje de los Gantt. */
export function formatHoraGantt(x: number): string {
  const m = (Math.trunc(x) % MINUTOS_TURNO) + 360;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function diaDe(inicio: number): number {
  return Math.floor(inicio / MINUTOS_TURNO) + 1;
}

export interface FechasRegistro {
  corte: string;
  planificacion: string;
}

/** FECHA CORTE / FECHA PLANIF. de una fila según su procedencia (SIGUIENTE corta mañana y planifica en 2 días hábiles). */
export function fechasDe(procedencia: Procedencia | Registro['procedencia'], hoy: Date): FechasRegistro {
  const efectiva = fechaCorteEfectiva(hoy);
  const corte = procedencia === 'SIGUIENTE' ? sumarDiasHabiles(hoy, 1) : efectiva;
  const planif = procedencia === 'SIGUIENTE' ? sumarDiasHabiles(hoy, 2) : sumarDiasHabiles(efectiva, 1);
  return { corte: formatFecha(corte), planificacion: formatFecha(planif) };
}
