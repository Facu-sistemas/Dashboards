import { getSupabaseAdminClient } from './admin';

/**
 * Aviso de quiebre de insumos (Compras). Tablas creadas a mano con docs/aviso-quiebre-schema.sql, RLS default-deny,
 * acceso solo vía /api. Si no existen, las lecturas devuelven vacío (la pantalla usa la foto del código) y avisan.
 */
export interface EstadoGuardado {
  datos: unknown;
  actualizadoPor: string | null;
  actualizadoEn: string;
}

export interface Visto {
  sku: string;
  usuario: string;
  nota: string;
  en: string;
}

export async function leerEstadoAviso(): Promise<EstadoGuardado | null> {
  const { data, error } = await getSupabaseAdminClient().from('aviso_quiebre_estado').select('datos, actualizado_por, updated_at').eq('id', 1).maybeSingle();
  if (error) {
    console.error('[aviso-quiebre-estado]', error.message);
    return null;
  }
  return data ? { datos: data.datos, actualizadoPor: data.actualizado_por, actualizadoEn: data.updated_at } : null;
}

export async function guardarEstadoAviso(datos: unknown, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('aviso_quiebre_estado')
    .upsert({ id: 1, datos, actualizado_por: usuario, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

/** `disponible` es false si la tabla todavía no existe: la pantalla deshabilita el botón "Visto". */
export async function leerVistos(version: string): Promise<{ disponible: boolean; vistos: Visto[] }> {
  const { data, error } = await getSupabaseAdminClient().from('aviso_quiebre_vistos').select('sku, usuario, nota, visto_en').eq('version', version);
  if (error) {
    console.error('[aviso-quiebre-vistos]', error.message);
    return { disponible: false, vistos: [] };
  }
  return { disponible: true, vistos: (data ?? []).map((r) => ({ sku: r.sku, usuario: r.usuario, nota: r.nota ?? '', en: r.visto_en })) };
}

export async function marcarVisto(version: string, sku: string, usuario: string, nota: string): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('aviso_quiebre_vistos')
    .upsert({ version, sku, usuario, nota, visto_en: new Date().toISOString() }, { onConflict: 'version,sku,usuario' });
  if (error) throw new Error(error.message);
}

export async function quitarVisto(version: string, sku: string, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().from('aviso_quiebre_vistos').delete().eq('version', version).eq('sku', sku).eq('usuario', usuario);
  if (error) throw new Error(error.message);
}

/** Equivalencias SKU del aviso -> product.product de Odoo (0 = ya no existe). Tabla: docs/aviso-quiebre-equivalencias.sql. */
export async function leerEquivalenciasAviso(): Promise<{ disponible: boolean; mapa: Map<string, number> }> {
  const { data, error } = await getSupabaseAdminClient().from('aviso_quiebre_equivalencias').select('sku, product_id').limit(5000);
  if (error) {
    console.error('[aviso-quiebre-equivalencias]', error.message);
    return { disponible: false, mapa: new Map() };
  }
  return { disponible: true, mapa: new Map((data ?? []).map((r) => [String(r.sku), Number(r.product_id)])) };
}

/** productId null = borrar la equivalencia (vuelve a "pendiente"). */
export async function guardarEquivalenciaAviso(sku: string, productId: number | null, usuario: string): Promise<void> {
  const db = getSupabaseAdminClient();
  const { error } =
    productId === null
      ? await db.from('aviso_quiebre_equivalencias').delete().eq('sku', sku)
      : await db.from('aviso_quiebre_equivalencias').upsert({ sku, product_id: productId, actualizado_por: usuario, updated_at: new Date().toISOString() }, { onConflict: 'sku' });
  if (error) throw new Error(error.message);
}
