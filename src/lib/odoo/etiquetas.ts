import { searchRead } from './client';

/** Read-only lookup feeding the "Etiquetas de Proveedor" tool: stockable products with their barcode and their `product.packaging` lines (each packaging has its own barcode and a quantity in the product's UoM — scanning it in the Odoo barcode app adds that quantity in one shot). */

export interface EtiquetaPackaging {
  id: number;
  name: string;
  qty: number;
  barcode: string | null;
}

export interface EtiquetaProducto {
  id: number;
  name: string;
  barcode: string | null;
  defaultCode: string | null;
  uom: string | null;
  tracking: string;
  packagings: EtiquetaPackaging[];
}

type ProductRow = {
  id: number;
  name: string;
  barcode: string | false;
  default_code: string | false;
  uom_id: [number, string] | false;
  tracking: string;
};

type PackagingRow = {
  id: number;
  name: string;
  product_id: [number, string];
  qty: number;
  barcode: string | false;
};

export async function searchProductosEtiquetas(query: string | undefined, limit: number): Promise<EtiquetaProducto[]> {
  const q = query?.trim();
  const domain: Parameters<typeof searchRead>[0]['domain'] = [['type', '=', 'product']];
  if (q) domain.push('|', '|', ['name', 'ilike', q], ['barcode', 'ilike', q], ['default_code', 'ilike', q]);

  const products = await searchRead<ProductRow>({
    model: 'product.product',
    domain,
    fields: ['name', 'barcode', 'default_code', 'uom_id', 'tracking'],
    limit,
    order: 'name asc',
  });
  if (products.length === 0) return [];

  const packagings = await searchRead<PackagingRow>({
    model: 'product.packaging',
    domain: [['product_id', 'in', products.map((p) => p.id)]],
    fields: ['name', 'product_id', 'qty', 'barcode'],
    order: 'qty asc',
  });
  const byProduct = new Map<number, EtiquetaPackaging[]>();
  for (const pk of packagings) {
    const list = byProduct.get(pk.product_id[0]) ?? [];
    list.push({ id: pk.id, name: pk.name, qty: pk.qty, barcode: pk.barcode || null });
    byProduct.set(pk.product_id[0], list);
  }

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    barcode: p.barcode || null,
    defaultCode: p.default_code || null,
    uom: p.uom_id ? p.uom_id[1] : null,
    tracking: p.tracking,
    packagings: byProduct.get(p.id) ?? [],
  }));
}
