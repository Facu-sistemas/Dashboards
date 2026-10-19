import { fetchDashboardSnapshotOrLatestShare, getDashboardWriteDate } from './spreadsheet-snapshot';
import { construirBases } from '@/lib/telamax/bases';
import type { BasesTelamax } from '@/lib/telamax/types';

/**
 * Bases fijas del planificador Telamax (flujo de telas): el tablero "Telamax"
 * de Odoo (`spreadsheet.dashboard` id 44, confirmado en vivo 2026-10-19) con 10
 * hojas — tiempos de tendido/CNC/armado, familias de telas y consumos de
 * tela/guata/lienzo por producto. Se edita directamente en Odoo; sin caché a
 * propósito (ver spreadsheet-snapshot.ts): cada lectura refleja la última edición.
 * Los tiempos están en SEGUNDOS.
 */
const TELAMAX_DASHBOARD_ID = 44;
const TELAMAX_DASHBOARD_LABEL = 'Telamax';

export interface TelamaxBasesResponse {
  bases: BasesTelamax;
  /** Última edición del tablero en Odoo (UTC "YYYY-MM-DD HH:mm:ss"). */
  actualizado: string | null;
}

export async function getTelamaxBases(): Promise<TelamaxBasesResponse> {
  const [doc, actualizado] = await Promise.all([
    fetchDashboardSnapshotOrLatestShare(TELAMAX_DASHBOARD_ID, TELAMAX_DASHBOARD_LABEL),
    getDashboardWriteDate(TELAMAX_DASHBOARD_ID),
  ]);
  return { bases: construirBases(doc), actualizado };
}
