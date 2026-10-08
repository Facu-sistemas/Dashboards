// Conector de solo lectura: base de productos de Materia Prima (reemplaza la exportación "Base de datos").
// Siempre filtra por la compañía operativa y trae también los productos archivados que todavía tienen stock.
import { searchReadAll } from '../../odoo/client';
import { getFronteraCompany } from '../../odoo/reference';
import { MATERIA_PRIMA_CATEG_ID } from '../../odoo/raw-material-consumption';
import type { BaseRow } from '../motor';

export interface ProductoMp {
  productId: number;
  /** `name` del producto, sin la referencia interna (es lo que muestra la columna "Nombre en pantalla"). */
  sku: string;
  codigo: string;
  /** Ruta completa, ej. "Materia Prima / Patas". */
  categoria: string;
  activo: boolean;
  /** "Cantidad disponible para uso" (free_qty): a mano menos reservado. */
  disp: number;
  aMano: number;
  entrante: number;
  saliente: number;
  pronosticada: number;
  costo: number;
  /** Proveedores en el orden de la ficha del producto; el primero es el "Proveedor (1° en Odoo)". */
  proveedores: string[];
}

export interface BaseMp {
  productos: ProductoMp[];
  /** Nombres repetidos entre productos distintos: el motor hoy los distingue por nombre, así que hay que revisarlos. */
  nombresDuplicados: string[];
}

export type ProductRow = {
  id: number;
  name: string;
  default_code: string | false;
  categ_id: [number, string];
  active: boolean;
  free_qty: number;
  qty_available: number;
  incoming_qty: number;
  outgoing_qty: number;
  virtual_available: number;
  standard_price: number;
  product_tmpl_id: [number, string];
};

/** Todos los productos de MP (activos y archivados). Base de las demás consultas. */
export async function listarProductosMp(): Promise<ProductRow[]> {
  const { companyId } = await getFronteraCompany();
  return searchReadAll<ProductRow>({
    model: 'product.product',
    domain: [['categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
    fields: ['name', 'default_code', 'categ_id', 'active', 'free_qty', 'qty_available', 'incoming_qty', 'outgoing_qty', 'virtual_available', 'standard_price', 'product_tmpl_id'],
    order: 'name asc, id asc',
    context: { active_test: false, allowed_company_ids: [companyId] },
  });
}

export async function getBaseMp(): Promise<BaseMp> {
  const { companyId } = await getFronteraCompany();
  const todos = await listarProductosMp();
  // Un producto archivado solo entra si todavía tiene stock o entrante (la exportación manual los perdía).
  const rows = todos.filter((p) => p.active || p.qty_available > 0 || p.incoming_qty > 0);

  const tmplIds = [...new Set(rows.map((p) => p.product_tmpl_id[0]))];
  type Seller = { product_tmpl_id: [number, string]; product_id: [number, string] | false; partner_id: [number, string] };
  const sellers: Seller[] = [];
  for (let i = 0; i < tmplIds.length; i += 500) {
    sellers.push(
      ...(await searchReadAll<Seller>({
        model: 'product.supplierinfo',
        domain: [['product_tmpl_id', 'in', tmplIds.slice(i, i + 500)], ['company_id', 'in', [false, companyId]]],
        fields: ['product_tmpl_id', 'product_id', 'partner_id'],
      }))
    );
  }
  const porTmpl = new Map<number, Seller[]>();
  for (const s of sellers) {
    const arr = porTmpl.get(s.product_tmpl_id[0]) ?? [];
    arr.push(s);
    porTmpl.set(s.product_tmpl_id[0], arr);
  }

  const productos: ProductoMp[] = rows.map((p) => {
    const provs: string[] = [];
    for (const s of porTmpl.get(p.product_tmpl_id[0]) ?? []) {
      if (s.product_id && s.product_id[0] !== p.id) continue;   // proveedor de otra variante
      const n = s.partner_id[1].trim();
      if (n && !provs.includes(n)) provs.push(n);
    }
    return {
      productId: p.id, sku: p.name.trim(), codigo: p.default_code || '', categoria: p.categ_id[1], activo: p.active,
      disp: p.free_qty, aMano: p.qty_available, entrante: p.incoming_qty, saliente: p.outgoing_qty, pronosticada: p.virtual_available,
      costo: p.standard_price, proveedores: provs,
    };
  });

  const cuenta = new Map<string, number>();
  for (const p of productos) cuenta.set(p.sku, (cuenta.get(p.sku) ?? 0) + 1);
  return { productos, nombresDuplicados: [...cuenta].filter(([, n]) => n > 1).map(([s]) => s) };
}

/** Al formato que consume el motor (clave por nombre mientras el libro siga siendo la referencia). */
export function aBaseRows(b: BaseMp): BaseRow[] {
  return b.productos.map((p) => ({
    productId: p.productId, sku: p.sku, categoria: p.categoria, prov: p.proveedores[0] ?? '', proveedores: p.proveedores, disp: p.disp, ent: p.entrante, costo: p.costo,
  }));
}
