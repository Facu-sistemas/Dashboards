import { withTtlCache } from '@/lib/cache';
import { parseCsv } from '@/lib/rrhh-sheet';

/**
 * Lectura (solo lectura) de la planilla de rentabilidad en Google Sheets. Es pública ("cualquiera con el enlace"), así que se
 * baja pestaña por pestaña con el export CSV, sin credenciales. Sirve para dos cosas en los tabs "(test)" de Finanzas:
 *  1. Contrastar lo que calculamos desde Odoo contra lo que dice la planilla (la planilla es la referencia).
 *  2. Traer los parámetros que NO están en Odoo (tiempos de colchones, grupos de tela, valor hora, pozos de fijos, plazos).
 *
 * OJO: el CSV de Google trae los números tal como se VEN en la celda (redondeados al formato de la planilla): sirve para
 * montos en pesos (2 decimales) pero no para tiempos o coeficientes con muchos decimales.
 */

export const PLANILLA_ID = '1dCOn-aGdQZPijiPHAtbgX5aph1PmL9IQC5QQz3yljP4';

/** gid de cada pestaña (estables mientras no se borre y recree la pestaña). */
export const PESTANAS = {
  facturacion: '1039460593',
  costos: '1640031491',
  costosProductos: '104036528',
  capacidadLiving: '308688704',
  costoFinanciero: '1384989506',
  plazoPagoMes: '1248292039',
  valorHora: '1236838122',
  gruposTelas: '1035287973',
  telas: '1932707702',
  tiemposColchones: '1048694528',
} as const;
export type Pestana = keyof typeof PESTANAS;

const TTL_MS = 5 * 60_000;

/** Pestaña completa como matriz de texto (la primera fila son los encabezados). */
export async function leerPestana(pestana: Pestana): Promise<string[][]> {
  return withTtlCache(`planilla-google:${pestana}`, TTL_MS, async () => {
    const url = `https://docs.google.com/spreadsheets/d/${PLANILLA_ID}/export?format=csv&gid=${PESTANAS[pestana]}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`No se pudo leer la planilla (Google respondió ${res.status}). ¿Sigue compartida con "cualquiera con el enlace"?`);
    }
    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
      throw new Error(`Google no devolvió datos de la pestaña "${pestana}": revisá que la planilla siga compartida con "cualquiera con el enlace".`);
    }
    return parseCsv(text);
  });
}

/** "$1.234,56" / " $  -   " / "1,5" / "-$3.000,00" -> número. Vacío, "#N/A" y similares -> null. */
export function numeroAR(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = v.replace(/[$\s]/g, '');
  if (s === '' || s === '-' || s.startsWith('#')) return s === '-' ? 0 : null;
  const pct = s.endsWith('%');
  if (pct) s = s.slice(0, -1);
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\.(?=\d{3}(\D|$))/g, ''));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** "0:20:15" -> horas (0,3375). null si no es un tiempo. */
export function horasDeTexto(v: string | undefined): number | null {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec((v ?? '').trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3] ?? 0) / 3600 : null;
}

/** Texto comparable entre Odoo y la planilla: sin tildes, sin símbolos, mayúsculas, espacios colapsados. */
export function claveTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
