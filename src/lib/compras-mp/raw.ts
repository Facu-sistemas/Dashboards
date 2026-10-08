// Una corrida recalculada (por ejemplo, después de cambiar un parámetro) no vuelve a leer Odoo: usa las fotos crudas de la corrida
// original, que se guardan UNA sola vez. Esto resuelve de qué corrida hay que leer las fotos.
import { getSupabaseAdminClient } from '../supabase/admin';

/** Id de la corrida que tiene las fotos crudas de `corridaId` (ella misma, o la original de la que viene por recálculo). */
export async function idCorridaRaw(corridaId: string): Promise<string> {
  const supabase = getSupabaseAdminClient();
  let actual = corridaId;
  for (let profundidad = 0; profundidad < 20; profundidad++) {
    const { data: raw, error } = await supabase.from('raw_compras').select('id').eq('corrida_id', actual).limit(1);
    if (error) throw new Error(`raw_compras: ${error.message}`);
    if (raw?.length) return actual;
    const { data: c, error: e2 } = await supabase.from('compras_corridas').select('params').eq('id', actual).maybeSingle();
    if (e2) throw new Error(`compras_corridas: ${e2.message}`);
    const origen = (c?.params as { recalculoDe?: string } | null)?.recalculoDe;
    if (!origen) return corridaId;
    actual = origen;
  }
  return corridaId;
}
