// Limpieza de corridas viejas. Cada corrida guarda varios MB (fotos crudas de Odoo + resultados por SKU y mes): con una corrida diaria
// la base crecería sin parar. Se conservan las recientes, las últimas N y TODAS las que respaldan una versión aprobada, un cierre mensual
// o el origen (fotos crudas) de otra corrida que se conserva.
import { getSupabaseAdminClient } from '../supabase/admin';

export interface ResultadoLimpieza {
  borradas: number;
  conservadas: number;
  /** Ids que se borrarían (en modo simulación). */
  aBorrar: string[];
}

export async function limpiarCorridasViejas(opts: { diasConservar?: number; minimas?: number; simular?: boolean } = {}): Promise<ResultadoLimpieza> {
  const diasConservar = opts.diasConservar ?? 14;
  const minimas = opts.minimas ?? 5;
  const supabase = getSupabaseAdminClient();

  const { data: corridas, error } = await supabase.from('compras_corridas').select('id, creada_en, params').order('creada_en', { ascending: false });
  if (error) throw new Error(`compras_corridas: ${error.message}`);
  const [versiones, cierres] = await Promise.all([
    supabase.from('version_presupuesto').select('corrida_id'),
    supabase.from('cierre_mensual').select('corrida_id'),
  ]);
  if (versiones.error) throw new Error(versiones.error.message);
  if (cierres.error) throw new Error(cierres.error.message);

  const conservar = new Set<string>();
  for (const v of versiones.data ?? []) if (v.corrida_id) conservar.add(v.corrida_id as string);
  for (const c of cierres.data ?? []) if (c.corrida_id) conservar.add(c.corrida_id as string);
  const limite = Date.now() - diasConservar * 86_400_000;
  (corridas ?? []).forEach((c, i) => {
    if (i < minimas || new Date(c.creada_en as string).getTime() >= limite) conservar.add(c.id as string);
  });
  // Una corrida recalculada necesita las fotos de su origen: si se conserva la derivada, se conserva el origen.
  const origenDe = new Map((corridas ?? []).map((c) => [c.id as string, (c.params as { recalculoDe?: string } | null)?.recalculoDe]));
  for (const id of [...conservar]) {
    let actual = origenDe.get(id);
    for (let profundidad = 0; actual && profundidad < 20; profundidad++) {
      conservar.add(actual);
      actual = origenDe.get(actual);
    }
  }

  const aBorrar = (corridas ?? []).map((c) => c.id as string).filter((id) => !conservar.has(id));
  let borradas = 0;
  if (!opts.simular) {
    for (let i = 0; i < aBorrar.length; i += 20) {
      const tanda = aBorrar.slice(i, i + 20);
      const { error: e } = await supabase.from('compras_corridas').delete().in('id', tanda);
      if (!e) borradas += tanda.length;
    }
  }
  return { borradas, conservadas: conservar.size, aBorrar };
}
