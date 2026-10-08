// Decisiones de Compras sobre las OC vencidas (Llega / Cerrar saldo / Reclamar / Reprogramada).
// Se guardan como historial (solo insertar); vale la última de cada OC + producto.
import { getSupabaseAdminClient } from '../supabase/admin';

import { DECISIONES, type Decision } from './constantes';

export { DECISIONES, type Decision };

export interface DecisionOc {
  ocId: number;
  productId: number;
  decision: Decision;
  nuevaFecha: string | null;
  comentario: string | null;
  usuario: string;
  creadoEn: string;
}

export class DecisionError extends Error {}

export async function registrarDecisionOc(d: { ocId: number; productId: number; decision: string; nuevaFecha?: string | null; comentario?: string | null; usuario: string }): Promise<DecisionOc> {
  if (!Number.isInteger(d.ocId) || !Number.isInteger(d.productId)) throw new DecisionError('Falta la OC o el producto');
  if (!(DECISIONES as readonly string[]).includes(d.decision)) throw new DecisionError(`Decisión inválida: ${d.decision}`);
  const fecha = d.nuevaFecha?.trim() || null;
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new DecisionError('La nueva fecha tiene que ser AAAA-MM-DD');
  if (d.decision === 'Reprogramada' && !fecha) throw new DecisionError('Una OC reprogramada necesita la nueva fecha');
  const comentario = d.comentario?.trim().slice(0, 300) || null;
  const { data, error } = await getSupabaseAdminClient()
    .from('oc_decisiones')
    .insert({ oc_id: d.ocId, product_id: d.productId, decision: d.decision, nueva_fecha: fecha, comentario, usuario: d.usuario })
    .select('*')
    .single();
  if (error || !data) throw new Error(`No se pudo guardar la decisión: ${error?.message}`);
  return mapear(data);
}

function mapear(r: Record<string, unknown>): DecisionOc {
  return {
    ocId: r.oc_id as number, productId: r.product_id as number, decision: r.decision as Decision, nuevaFecha: (r.nueva_fecha as string | null) ?? null,
    comentario: (r.comentario as string | null) ?? null, usuario: r.usuario as string, creadoEn: r.creado_en as string,
  };
}

/** Última decisión de cada OC + producto, por clave `${ocId}|${productId}`. */
export async function ultimasDecisiones(): Promise<Map<string, DecisionOc>> {
  const supabase = getSupabaseAdminClient();
  const out = new Map<string, DecisionOc>();
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from('oc_decisiones').select('*').order('creado_en', { ascending: false }).range(desde, desde + 999);
    if (error) throw new Error(`oc_decisiones: ${error.message}`);
    for (const r of data ?? []) {
      const k = `${r.oc_id}|${r.product_id}`;
      if (!out.has(k)) out.set(k, mapear(r));
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function historialDecisiones(ocId: number, productId: number): Promise<DecisionOc[]> {
  const { data, error } = await getSupabaseAdminClient().from('oc_decisiones').select('*').eq('oc_id', ocId).eq('product_id', productId).order('creado_en', { ascending: false });
  if (error) throw new Error(`oc_decisiones: ${error.message}`);
  return (data ?? []).map(mapear);
}
