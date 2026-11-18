import { getSupabaseAdminClient } from './admin';

/** Equivalencias SKU del libro -> product.product de Odoo (0 = ya no existe). Tabla: docs/presupuesto-mp-equivalencias.sql. */
export async function leerEquivalencias(): Promise<{ disponible: boolean; mapa: Map<string, number> }> {
  const { data, error } = await getSupabaseAdminClient().from('presupuesto_mp_equivalencias').select('sku, product_id').limit(5000);
  if (error) {
    console.error('[presupuesto-mp-equivalencias]', error.message);
    return { disponible: false, mapa: new Map() };
  }
  return { disponible: true, mapa: new Map((data ?? []).map((r) => [String(r.sku), Number(r.product_id)])) };
}

/** productId null = borrar la equivalencia (vuelve a "pendiente"). */
export async function guardarEquivalencia(sku: string, productId: number | null, usuario: string): Promise<void> {
  const db = getSupabaseAdminClient();
  const { error } =
    productId === null
      ? await db.from('presupuesto_mp_equivalencias').delete().eq('sku', sku)
      : await db.from('presupuesto_mp_equivalencias').upsert({ sku, product_id: productId, actualizado_por: usuario, updated_at: new Date().toISOString() }, { onConflict: 'sku' });
  if (error) throw new Error(error.message);
}
