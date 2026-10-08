// Conector de solo lectura: consumo mensual de MP por producto (reemplaza el "Historial de consumo").
//
// Definición validada contra la exportación de Compras (IN_Consumo): líneas de movimiento (stock.move.line)
// hechas que consumen en una orden de producción, en la unidad de medida del PRODUCTO (quantity_product_uom),
// por la fecha de la línea. Con esa definición coinciden producto por producto en mayo 2025 y agosto 2026.
// (Con stock.move.product_uom_qty o con stock.move.product_qty hay diferencias por unidades y fechas.)
import { readGroup } from '../../odoo/client';
import { getFronteraCompany } from '../../odoo/reference';
import type { OdooReadGroupResult } from '../../odoo/types';
import { listarProductosMp } from './base';
import type { ConsumoTabla } from '../motor';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export interface ConsumoMensual {
  /** AAAA-MM, de más viejo a más nuevo. */
  meses: string[];
  filas: { productId: number; sku: string; vals: number[] }[];
}

export function etiquetaMes(clave: string): string {
  const [y, m] = clave.split('-').map(Number);
  return `${MESES[(m ?? 1) - 1]} ${y}`;
}

/** `desde` = primer día del primer mes (AAAA-MM-DD). El mes en curso viene parcial. */
export async function getConsumoMensual(desde = '2025-05-01', hoy = new Date().toISOString().slice(0, 10)): Promise<ConsumoMensual> {
  const { companyId } = await getFronteraCompany();
  const productos = await listarProductosMp();   // incluye archivados: filtrar por categoría en la consulta los excluiría
  const ids = productos.map((p) => p.id);
  const nombre = new Map(productos.map((p) => [p.id, p.name.trim()]));

  type Grupo = OdooReadGroupResult & {
    product_id: [number, string] | false;
    quantity_product_uom: number;
    __range?: Record<string, { from: string | false }>;
  };
  const porProducto = new Map<number, Map<string, number>>();
  const mesesVistos = new Set<string>();
  for (let i = 0; i < ids.length; i += 400) {
    const grupos = (await readGroup({
      model: 'stock.move.line',
      domain: [
        ['state', '=', 'done'],
        ['company_id', '=', companyId],
        ['move_id.raw_material_production_id', '!=', false],
        ['product_id', 'in', ids.slice(i, i + 400)],
        ['date', '>=', desde],
        // Hay líneas pre-creadas con fecha placeholder en 2100: no son consumo real.
        ['date', '<=', `${hoy} 23:59:59`],
      ],
      fields: ['quantity_product_uom:sum'],
      groupBy: ['product_id', 'date:month'],
      lazy: false,
    })) as Grupo[];
    for (const g of grupos) {
      const from = g.__range?.['date:month']?.from;
      if (!g.product_id || !from) continue;
      const mes = from.slice(0, 7);
      mesesVistos.add(mes);
      const m = porProducto.get(g.product_id[0]) ?? new Map<string, number>();
      m.set(mes, (m.get(mes) ?? 0) + g.quantity_product_uom);
      porProducto.set(g.product_id[0], m);
    }
  }
  const meses = [...mesesVistos].sort();
  const filas = [...porProducto].map(([productId, m]) => ({
    productId, sku: nombre.get(productId) ?? String(productId), vals: meses.map((x) => m.get(x) ?? 0),
  }));
  return { meses, filas };
}

/** Al formato de tabla que lee el motor (columna 0 = nombre; las demás, un mes cada una). */
export function aConsumoTabla(c: ConsumoMensual): ConsumoTabla {
  return {
    headers: [null, ...c.meses.map(etiquetaMes)],
    filas: c.filas.map((f) => ({ nombre: f.sku, productId: f.productId, vals: [null, ...f.vals] })),
  };
}
