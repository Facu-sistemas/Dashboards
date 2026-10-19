import { searchRead, searchReadAll } from './client';
import { withTtlCache } from '@/lib/cache';
import { addDaysIso } from '@/lib/date';

/**
 * Lo que Odoo tiene como "cerrado" en un día, por producto: órdenes de
 * fabricación en estado Hecho (`mrp.production`) con `date_finished` dentro del
 * día calendario argentino, sumando `qty_produced`. Se agrupa por el código de
 * barras del producto (`product.product.barcode`), que es lo que escanea
 * embalaje. Solo lectura.
 */

const ARG_UTC_OFFSET_H = 3; // Argentina = UTC-3, sin horario de verano
const TTL_MS = 30 * 1000;

export interface OdooCerradoProducto {
  barcode: string | null;
  producto: string;
  productoId: number;
  unidades: number;
  ordenes: number;
}

interface MoRow extends Record<string, unknown> {
  product_id: [number, string] | false;
  qty_produced: number;
}

interface ProductRow extends Record<string, unknown> {
  id: number;
  barcode: string | false;
}

/**
 * Límites UTC (formato Odoo) del día argentino `fecha` (YYYY-MM-DD). `desde`
 * (HH:MM, hora argentina) recorta el inicio: sirve para empezar a contar a
 * partir de un momento del día, ignorando lo que Odoo ya había cerrado antes.
 */
function limitesDiaUtc(fecha: string, desde = '00:00'): [string, string] {
  const hh = String(ARG_UTC_OFFSET_H).padStart(2, '0');
  const inicio = new Date(`${fecha}T${desde}:00-0${ARG_UTC_OFFSET_H}:00`).toISOString().slice(0, 19).replace('T', ' ');
  return [inicio, `${addDaysIso(fecha, 1)} ${hh}:00:00`];
}

export async function getOdooCerradoDia(fecha: string, desdeHora = '00:00'): Promise<OdooCerradoProducto[]> {
  return withTtlCache(`embalaje-cerrado:${fecha}:${desdeHora}`, TTL_MS, async () => {
    const [desde, hasta] = limitesDiaUtc(fecha, desdeHora);
    const mos = await searchReadAll<MoRow>({
      model: 'mrp.production',
      domain: [
        ['state', '=', 'done'],
        ['date_finished', '>=', desde],
        ['date_finished', '<', hasta],
      ],
      fields: ['product_id', 'qty_produced'],
    });
    const porProducto = new Map<number, { producto: string; unidades: number; ordenes: number }>();
    for (const mo of mos) {
      if (!mo.product_id) continue;
      const [id, nombre] = mo.product_id;
      const acc = porProducto.get(id) ?? { producto: nombre, unidades: 0, ordenes: 0 };
      acc.unidades += Number(mo.qty_produced) || 0;
      acc.ordenes += 1;
      porProducto.set(id, acc);
    }
    const ids = [...porProducto.keys()];
    const barcodes = new Map<number, string>();
    if (ids.length) {
      const prods = await searchReadAll<ProductRow>({
        model: 'product.product',
        domain: [['id', 'in', ids]],
        fields: ['barcode'],
        context: { active_test: false },
      });
      for (const p of prods) if (p.barcode) barcodes.set(p.id, p.barcode);
    }
    return [...porProducto.entries()].map(([productoId, v]) => ({
      productoId,
      producto: v.producto,
      barcode: barcodes.get(productoId) ?? null,
      unidades: v.unidades,
      ordenes: v.ordenes,
    }));
  });
}

export interface ProductoPorCodigo {
  productoId: number;
  producto: string;
  barcode: string;
}

/** Busca un producto por código de barras exacto (sin distinguir mayúsculas). */
export async function buscarProductoPorBarcode(codigo: string): Promise<ProductoPorCodigo | null> {
  const rows = await searchRead<{ id: number; name: string; barcode: string } & Record<string, unknown>>({
    model: 'product.product',
    domain: [['barcode', 'ilike', codigo]],
    fields: ['name', 'barcode'],
    limit: 20,
  });
  // `ilike` es por substring: nos quedamos solo con la coincidencia exacta (sin distinguir mayúsculas).
  const r = rows.find((x) => x.barcode && x.barcode.toUpperCase() === codigo.toUpperCase());
  return r ? { productoId: r.id, producto: r.name, barcode: r.barcode } : null;
}
