import { searchReadAll } from './client';
import type { OdooDomain } from './types';

/**
 * Órdenes de fabricación que alimentan el Planificador de Líneas: el filtro de Lean
 * (categorías de producto 3 y 16, estados abiertos). La línea sale de `x_studio_linea`.
 * Solo lectura.
 */
const LINEAS_DOMAIN: OdooDomain = [
  '&',
  ['state', 'in', ['draft', 'confirmed', 'progress', 'to_close']],
  ['product_id.categ_id', 'in', [3, 16]],
];

/** Marcador de Odoo para "sin planificar" (misma convención que odoo/telamax-pedidos.ts). */
const SIN_AGENDAR_DATE = '2100-01-01';

interface MoRow extends Record<string, unknown> {
  id: number;
  name: string;
  origin: string | false;
  product_id: [number, string] | false;
  product_qty: number;
  x_studio_linea: string | false;
  planning_date: string | false;
}

export interface OrdenSillon {
  id: number;
  nombre: string;
  origen: string;
  /** Nombre de Odoo tal cual (con tela). */
  producto: string;
  cantidad: number;
  /** Línea 1..8, o null si la orden no tiene una línea válida ('nt', vacío…). */
  linea: number | null;
  /** YYYY-MM-DD, o '' si no está agendada. */
  fecha: string;
}

export async function getOrdenesSillon(): Promise<OrdenSillon[]> {
  const rows = await searchReadAll<MoRow>({
    model: 'mrp.production',
    domain: LINEAS_DOMAIN,
    fields: ['name', 'origin', 'product_id', 'product_qty', 'x_studio_linea', 'planning_date'],
    order: 'planning_date asc, id asc',
  });
  return rows
    .filter((r) => r.product_id)
    .map((r) => {
      const n = Number(r.x_studio_linea);
      return {
        id: r.id,
        nombre: r.name,
        origen: r.origin || '',
        producto: r.product_id ? r.product_id[1] : '',
        cantidad: r.product_qty,
        linea: Number.isInteger(n) && n >= 1 && n <= 8 ? n : null,
        fecha: !r.planning_date || r.planning_date === SIN_AGENDAR_DATE ? '' : r.planning_date.slice(0, 10),
      };
    });
}
