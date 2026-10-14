// Base de insumos (Materia Prima) para el libro Presupuesto de Compras MP. Reemplaza el export manual de Odoo
// (Inventario > Productos, filtro Materia Prima). Solo lectura: search_read, nunca escribe.
import { searchReadAll } from './client';
import { withTtlCache } from '@/lib/cache';

const CATEGORIA_MATERIA_PRIMA = 14;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface InsumoBase {
  productId: number;
  nombre: string;
  disponible: number;
  entrante: number;
  saliente: number;
  pronosticada: number;
  categoria: string;
  costo: number;
  activo: boolean;
  referencia: string;
  /** Proveedores en el orden de `seller_ids`; un producto sin proveedores trae la lista vacía. */
  proveedores: { nombre: string; pais: string }[];
}

export interface BaseInsumos {
  insumos: InsumoBase[];
  activos: number;
  archivadosConStock: number;
}

type Producto = {
  id: number;
  display_name: string;
  product_tmpl_id: [number, string];
  free_qty: number;
  incoming_qty: number;
  outgoing_qty: number;
  virtual_available: number;
  qty_available: number;
  categ_id: [number, string] | false;
  standard_price: number;
  active: boolean;
  default_code: string | false;
};

type Seller = { id: number; partner_id: [number, string]; product_tmpl_id: [number, string] | false; product_id: [number, string] | false; sequence: number };

export async function getBaseInsumos(): Promise<BaseInsumos> {
  return withTtlCache('base-insumos', CACHE_TTL_MS, async () => {
    const todos = await searchReadAll<Producto>({
      model: 'product.product',
      domain: [['categ_id', 'child_of', CATEGORIA_MATERIA_PRIMA], ['detailed_type', '=', 'product']],
      fields: ['display_name', 'product_tmpl_id', 'free_qty', 'incoming_qty', 'outgoing_qty', 'virtual_available', 'qty_available', 'categ_id', 'standard_price', 'active', 'default_code'],
      context: { active_test: false },
    });
    // Activos: todos. Archivados: solo los que todavía tienen stock.
    const productos = todos.filter((p) => p.active || Math.abs(p.qty_available) > 1e-9);

    const tmplIds = [...new Set(productos.map((p) => p.product_tmpl_id[0]))];
    const sellers = new Map<number, Seller[]>();
    const paises = new Map<number, string>();
    if (tmplIds.length) {
      const filas: Seller[] = [];
      for (let i = 0; i < tmplIds.length; i += 500) {
        filas.push(
          ...(await searchReadAll<Seller>({
            model: 'product.supplierinfo',
            domain: [['product_tmpl_id', 'in', tmplIds.slice(i, i + 500)]],
            fields: ['partner_id', 'product_tmpl_id', 'product_id', 'sequence'],
            order: 'sequence asc, id asc',
          }))
        );
      }
      for (const s of filas) {
        if (!s.product_tmpl_id) continue;
        const lista = sellers.get(s.product_tmpl_id[0]) ?? [];
        lista.push(s);
        sellers.set(s.product_tmpl_id[0], lista);
      }
      const partnerIds = [...new Set(filas.map((s) => s.partner_id[0]))];
      for (let i = 0; i < partnerIds.length; i += 500) {
        const ps = await searchReadAll<{ id: number; country_id: [number, string] | false }>({
          model: 'res.partner',
          domain: [['id', 'in', partnerIds.slice(i, i + 500)]],
          fields: ['country_id'],
          context: { active_test: false },
        });
        for (const p of ps) paises.set(p.id, p.country_id ? p.country_id[1] : '');
      }
    }

    const insumos: InsumoBase[] = productos
      .map((p) => ({
        productId: p.id,
        nombre: p.display_name,
        disponible: p.free_qty,
        entrante: p.incoming_qty,
        saliente: p.outgoing_qty,
        pronosticada: p.virtual_available,
        categoria: p.categ_id ? p.categ_id[1] : '',
        costo: p.standard_price,
        activo: p.active,
        referencia: p.default_code || '',
        // Un proveedor atado a otra variante no corresponde a este producto.
        proveedores: (sellers.get(p.product_tmpl_id[0]) ?? [])
          .filter((s) => !s.product_id || s.product_id[0] === p.id)
          .map((s) => ({ nombre: s.partner_id[1].trim(), pais: paises.get(s.partner_id[0]) ?? '' })),
      }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'));

    return { insumos, activos: insumos.filter((i) => i.activo).length, archivadosConStock: insumos.filter((i) => !i.activo).length };
  });
}
