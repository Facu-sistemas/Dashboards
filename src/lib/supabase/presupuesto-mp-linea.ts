import { getSupabaseAdminClient } from './admin';
import type { Linea } from '../odoo/presupuesto-proyectado';

/**
 * Etiqueta manual Colchones / Living / Ambos por materia prima (pisa la
 * sugerencia automática del Presupuesto proyectado). Tabla creada a mano
 * en Supabase (no hay migraciones en el repo):
 *
 *   create table presupuesto_mp_linea (
 *     product_id integer primary key,
 *     linea text not null check (linea in ('colchones','living','ambos')),
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table presupuesto_mp_linea enable row level security; -- default-deny, acceso solo vía /api
 */

/** Devuelve `null` si la tabla no existe / no se puede leer — el cálculo sigue con las líneas sugeridas. */
export async function getEtiquetasLinea(): Promise<Map<number, Linea> | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.from('presupuesto_mp_linea').select('product_id, linea');
  if (error) {
    console.error('[presupuesto-mp-linea]', error.message);
    return null;
  }
  return new Map((data ?? []).map((r) => [r.product_id as number, r.linea as Linea]));
}

/** `linea = null` borra la etiqueta manual (vuelve a la sugerida). */
export async function setEtiquetaLinea(productId: number, linea: Linea | null, usuario: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } =
    linea === null
      ? await admin.from('presupuesto_mp_linea').delete().eq('product_id', productId)
      : await admin
          .from('presupuesto_mp_linea')
          .upsert({ product_id: productId, linea, actualizado_por: usuario, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
