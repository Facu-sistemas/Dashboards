import { fetchDashboardSnapshotOrLatestShare, getDashboardWriteDate, colLetterToIndex, type SheetDoc } from './spreadsheet-snapshot';
import { OdooError } from './types';

/**
 * Ingresos por rotura (reclamos por roturas de sofá), cargados a mano mes a mes en el
 * tablero "Devoluciones" de Odoo (`spreadsheet.dashboard` id 45, grupo Calidad,
 * confirmado en vivo 2026-10-28). Se edita en Odoo; sin caché (ver spreadsheet-snapshot.ts).
 *
 * Forma de la hoja: columna A = etiqueta de fila ("Transporte 26", "Calidad 26´",
 * "Transporte 25´", "Calidad´25´"…), columnas B..M = enero..diciembre. Las filas se
 * reconocen por la etiqueta (tipo + año de 2 dígitos), no por posición, así que se
 * pueden sumar años nuevos arriba/abajo. La sección "comparativa" repite filas de
 * Transporte y se ignora: se toma la primera aparición de cada tipo+año.
 */
const DEVOLUCIONES_DASHBOARD_ID = 45;
const LABEL = 'Devoluciones';

export interface RoturasAnio {
  /** 12 valores (enero..diciembre); null = mes sin cargar todavía. */
  transporte: (number | null)[];
  calidad: (number | null)[];
}

export interface RoturasResponse {
  /** Clave = año de 4 dígitos. */
  anios: Record<string, RoturasAnio>;
  /** Última edición del tablero en Odoo (UTC "YYYY-MM-DD HH:mm:ss"). */
  actualizado: string | null;
}

function celdaNumero(content: string | undefined): number | null {
  if (content === undefined || content.trim() === '') return null;
  const n = Number(content.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseRoturas(doc: SheetDoc): Record<string, RoturasAnio> {
  const sheet = doc.sheets[0];
  if (!sheet?.cells) throw new OdooError(`La hoja del tablero "${LABEL}" está vacía`);
  const cells = sheet.cells;

  const anios: Record<string, RoturasAnio> = {};
  const colB = colLetterToIndex('B');
  for (const key of Object.keys(cells)) {
    const m = /^A(\d+)$/.exec(key);
    if (!m) continue;
    const etiqueta = (cells[key]?.content ?? '').trim();
    const tipo = /^transporte/i.test(etiqueta) ? 'transporte' : /^calidad/i.test(etiqueta) ? 'calidad' : null;
    const yy = /(\d{2})\D*$/.exec(etiqueta)?.[1];
    if (!tipo || !yy) continue;
    const anio = String(2000 + Number(yy));
    const fila = Number(m[1]);
    const grupo = (anios[anio] ??= { transporte: Array(12).fill(null), calidad: Array(12).fill(null) });
    // Primera aparición gana (la sección "comparativa" más abajo repite Transporte).
    if (grupo[tipo].some((v) => v !== null)) continue;
    const valores: (number | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const letra = String.fromCharCode(65 + colB + i);
      valores.push(celdaNumero(cells[`${letra}${fila}`]?.content));
    }
    grupo[tipo] = valores;
  }
  if (Object.keys(anios).length === 0) {
    throw new OdooError(`No se encontraron filas "Transporte NN" / "Calidad NN" en el tablero "${LABEL}"`);
  }
  return anios;
}

export async function getRoturas(): Promise<RoturasResponse> {
  const [doc, actualizado] = await Promise.all([
    fetchDashboardSnapshotOrLatestShare(DEVOLUCIONES_DASHBOARD_ID, LABEL),
    getDashboardWriteDate(DEVOLUCIONES_DASHBOARD_ID),
  ]);
  return { anios: parseRoturas(doc), actualizado };
}
