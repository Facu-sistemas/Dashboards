import { parseHeaderedSheet, type SheetDoc } from '@/lib/odoo/spreadsheet-snapshot';
import { OdooError } from '@/lib/odoo/types';
import { safeFloat } from './engine';
import type { ArmadoRow, BasesTelamax, ConsInsumoRow, RestInsumoRow } from './types';

const LABEL = 'Telamax';

/** Como `.str.upper().str.strip()` del Python: los nombres de producto/insumo se comparan siempre así. */
const norm = (s: string | undefined): string => (s ?? '').toUpperCase().trim();

function columna(rows: Record<string, string>[], hoja: string, ...cols: string[]): void {
  const first = rows[0];
  if (!first) throw new OdooError(`La hoja "${hoja}" del tablero ${LABEL} está vacía`);
  for (const c of cols) {
    if (!(c in first)) throw new OdooError(`Falta la columna "${c}" en la hoja "${hoja}" del tablero ${LABEL}`);
  }
}

function hoja(doc: SheetDoc, nombre: string, ...cols: string[]): Record<string, string>[] {
  const rows = parseHeaderedSheet(doc, nombre, LABEL);
  columna(rows, nombre, ...cols);
  return rows;
}

/**
 * Convierte las 10 hojas del tablero "Telamax" de Odoo en las bases del motor.
 * Los tiempos (CNC, armado y tendido) están en SEGUNDOS en el tablero.
 */
export function construirBases(doc: SheetDoc): BasesTelamax {
  const tendidoRows = hoja(doc, 'tiempos_tendido', 'operacion_tendido', 'tiempo_op_tendido');
  const tendido: Record<string, number> = {};
  for (const r of tendidoRows) tendido[r['operacion_tendido']!] = safeFloat(r['tiempo_op_tendido']);

  const cnc = hoja(doc, 'bd_tiempos_cnc', 'nombre_sillon', 'categoria_del_producto', 'tiempo_seg_tela', 'tiempo_seg_guata', 'tiempo_seg_lienzo').map((r) => ({
    nombre: norm(r['nombre_sillon']),
    categoria: r['categoria_del_producto'] ?? '',
    segTela: safeFloat(r['tiempo_seg_tela']),
    segGuata: safeFloat(r['tiempo_seg_guata']),
    segLienzo: safeFloat(r['tiempo_seg_lienzo']),
  }));

  const armadoRows = hoja(doc, 'tiempos_armado', 'nombre_sillon', 'tiempo_seg_est1');
  const armado: ArmadoRow[] = armadoRows.map((r) => ({
    nombre: norm(r['nombre_sillon']),
    segEst: Array.from({ length: 9 }, (_, i) => safeFloat(r[`tiempo_seg_est${i + 1}`])),
  }));

  const famTelas = hoja(doc, 'familias_de_telas', 'nombre_tela', 'max_capas_tela').map((r) => ({
    nombre: r['nombre_tela']!,
    maxCapas: safeFloat(r['max_capas_tela']),
  }));

  const consTela = hoja(doc, 'consumo_tela_por_producto', 'producto', 'forma_de_tendida_tela', 'metros_consumo_tela').map((r) => ({
    producto: norm(r['producto']),
    forma: r['forma_de_tendida_tela'] ?? '',
    metros: safeFloat(r['metros_consumo_tela']),
  }));

  const insumo = (nombreHoja: string, campo: 'guata' | 'lienzo'): ConsInsumoRow[] =>
    hoja(doc, nombreHoja, 'producto', `nombre_${campo}`, `metros_consumo_${campo}`, `salidas_por_corte_${campo}`).map((r) => ({
      producto: norm(r['producto']),
      nombre: norm(r[`nombre_${campo}`]),
      metros: safeFloat(r[`metros_consumo_${campo}`]),
      salidas: safeFloat(r[`salidas_por_corte_${campo}`]),
    }));

  const restricciones = (nombreHoja: string, campo: 'guata' | 'lienzo'): RestInsumoRow[] =>
    hoja(doc, nombreHoja, `nombre_${campo}`, `max_capas_${campo}`).map((r) => ({
      nombre: norm(r[`nombre_${campo}`]),
      maxCapas: safeFloat(r[`max_capas_${campo}`]),
    }));

  return {
    famTelas,
    consTela,
    consGuata: insumo('consumo_guata_por_producto', 'guata'),
    restGuata: restricciones('restricciones_guata', 'guata'),
    consLienzo: insumo('consumo_lienzo_por_producto', 'lienzo'),
    restLienzo: restricciones('restricciones_lienzo', 'lienzo'),
    cnc,
    armado,
    tendido,
  };
}
