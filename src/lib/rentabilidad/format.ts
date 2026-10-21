/** Formateadores es-AR del módulo Rentabilidad. Determinísticos (sin notation:'compact') para no desalinear SSR e hidratación. */

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const num0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const vacio = (n: number | null | undefined): n is null | undefined => n == null || Number.isNaN(Number(n));

export const fmtMoney = (n: number | null | undefined): string => (vacio(n) ? '—' : money.format(Number(n)));
export const fmtNumber = (n: number | null | undefined): string => (vacio(n) ? '—' : num0.format(Number(n)));
export const fmtPct = (n: number | null | undefined): string => (vacio(n) ? '—' : `${num1.format(Number(n))}%`);
/** Con signo explícito: +3,2 pp / -1,0 pp. */
export const fmtGap = (n: number | null | undefined): string =>
  vacio(n) ? '—' : `${Number(n) > 0 ? '+' : ''}${num1.format(Number(n))} pp`;

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Texto de generación para pantalla y exports: "dd/mm/aaaa hh:mm" en hora de Buenos Aires. */
export function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
