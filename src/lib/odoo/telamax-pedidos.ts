import { searchReadAll } from './client';
import type { OdooDomain } from './types';
import type { PedidoOdoo } from '@/lib/telamax/pedidos';

/**
 * Órdenes de corte de tela que alimentan a Telamax: el filtro guardado
 * "SILLON CORTE DE TELA" de Fabricación (mrp.production), confirmado en vivo
 * 2026-10-19 — 328 órdenes. Las columnas de la plantilla de exportación
 * APP_TENDIDO salen de: Origen=`origin`, Producto Origen=`origin_product_id`,
 * Tela=`cloth_id`, Cantidad a producir=`product_qty`, Linea=`x_studio_linea`.
 * Solo lectura.
 */
const TELAMAX_DOMAIN: OdooDomain = [
  '&',
  ['state', 'in', ['draft', 'confirmed', 'progress', 'to_close']],
  '|',
  '|',
  '|',
  ['product_id', 'ilike', 'TAP FUNDA'],
  ['product_id', 'ilike', 'CTEL'],
  ['product_id', 'in', [1, 15655, 15656, 16295]],
  ['product_id.barcode', 'ilike', 'BDBOLIM'],
];

/** Marcador de Odoo para "sin planificar" (misma convención que odoo/bandas.ts y odoo/multicorte.ts). */
const SIN_AGENDAR_DATE = '2100-01-01';

/** El nombre de un many2one de producto viene como `[referencia] Nombre`: se saca la referencia para que coincida con los nombres de la base. */
const sinReferencia = (display: string): string => {
  const m = display.match(/^\[[^\]]*\]\s*(.*)$/);
  return m ? m[1]! : display;
};

type Many2one = [number, string] | false;

interface MoRow extends Record<string, unknown> {
  id: number;
  origin: string | false;
  origin_product_id: Many2one;
  cloth_id: Many2one;
  product_qty: number;
  x_studio_linea: string | false;
  planning_date: string | false;
}

export interface TelamaxPedidosResponse {
  pedidos: PedidoOdoo[];
  /** Órdenes del filtro sin fecha real (2100-01-01 o vacía): no se planifican. */
  sinFecha: number;
}

export async function getTelamaxPedidos(): Promise<TelamaxPedidosResponse> {
  const rows = await searchReadAll<MoRow>({
    model: 'mrp.production',
    domain: TELAMAX_DOMAIN,
    fields: ['origin', 'origin_product_id', 'cloth_id', 'product_qty', 'x_studio_linea', 'planning_date'],
    order: 'planning_date asc, id asc',
  });

  const pedidos: PedidoOdoo[] = [];
  let sinFecha = 0;
  for (const r of rows) {
    if (!r.planning_date || r.planning_date === SIN_AGENDAR_DATE) {
      sinFecha += 1;
      continue;
    }
    pedidos.push({
      id: r.id,
      origen: r.origin || '',
      fecha: r.planning_date.slice(0, 10),
      productoOrigen: r.origin_product_id ? sinReferencia(r.origin_product_id[1]) : '',
      tela: r.cloth_id ? sinReferencia(r.cloth_id[1]) : '',
      cantidad: r.product_qty,
      linea: r.x_studio_linea || '',
    });
  }
  return { pedidos, sinFecha };
}
