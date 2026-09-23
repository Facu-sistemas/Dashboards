import { getSupabaseAdminClient } from './admin';
import type { SobranteDisponible, BlockCargado } from '../vertical-calc';

/**
 * Sobrante ("saldo") de block que quedó sin cortar al cerrar el día — se
 * guarda para que el día siguiente el Optimizador Vertical lo descuente
 * automáticamente antes de pedir cargar un block nuevo. Primeras tablas de
 * este feature — no existen migraciones en el repo, se crean a mano en el
 * dashboard de Supabase (ver plan). RLS default-deny: único acceso vía
 * estas funciones desde /api routes, mismo patrón que presupuesto-inputs.ts.
 */

export async function getSobrantesDisponibles(colorBlock?: string): Promise<SobranteDisponible[]> {
  const admin = getSupabaseAdminClient();
  let query = admin
    .from('vertical_sobrantes')
    .select('id, color_block, ancho_block_cm, largo_block_cm, alto_disponible_cm, origen_fecha')
    .eq('consumido', false)
    .order('origen_fecha', { ascending: true });
  if (colorBlock) query = query.eq('color_block', colorBlock);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    colorBlock: r.color_block,
    anchoBlockCm: Number(r.ancho_block_cm),
    largoBlockCm: Number(r.largo_block_cm),
    altoDisponibleCm: Number(r.alto_disponible_cm),
    origenFecha: r.origen_fecha,
  }));
}

export async function marcarSobrantesConsumidos(ids: string[], fechaConsumo: string): Promise<void> {
  if (ids.length === 0) return;
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('vertical_sobrantes').update({ consumido: true, consumido_fecha: fechaConsumo }).in('id', ids);
  if (error) throw new Error(error.message);
}

export interface NuevoSobrante {
  colorBlock: string;
  anchoBlockCm: number;
  largoBlockCm: number;
  altoDisponibleCm: number;
  origenFecha: string;
  origenProducto?: string;
}

export async function crearSobrante(sobrante: NuevoSobrante): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('vertical_sobrantes').insert({
    color_block: sobrante.colorBlock,
    ancho_block_cm: sobrante.anchoBlockCm,
    largo_block_cm: sobrante.largoBlockCm,
    alto_disponible_cm: sobrante.altoDisponibleCm,
    origen_fecha: sobrante.origenFecha,
    origen_producto: sobrante.origenProducto ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Borra el sobrante (todavía sin consumir) que ESTE mismo día/color haya generado en un guardado anterior — para que re-guardar el mismo color no duplique filas de sobrante. Nunca toca sobrantes de otros días (esos son historial real de stock). */
export async function borrarSobranteDelDia(fecha: string, colorBlock: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('vertical_sobrantes').delete().eq('origen_fecha', fecha).eq('color_block', colorBlock).eq('consumido', false);
  if (error) throw new Error(error.message);
}

export interface SesionVerticalColor {
  colorBlock: string;
  bloquesCargados: BlockCargado[];
  sobranteResultanteCm: number | null;
}

/** Lo que ya se guardó para un día dado, por color — para que al reabrir la pantalla (otra persona, u horas después) se vea lo que ya se cargó/cortó en vez de arrancar de cero. */
export async function getSesionesVertical(fecha: string): Promise<SesionVerticalColor[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.from('vertical_cortes_sesiones').select('color_block, bloques_cargados, sobrante_resultante_cm').eq('fecha', fecha);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    colorBlock: r.color_block,
    bloquesCargados: (r.bloques_cargados ?? []) as BlockCargado[],
    sobranteResultanteCm: r.sobrante_resultante_cm === null ? null : Number(r.sobrante_resultante_cm),
  }));
}

/** Upsert por (fecha, color_block) — re-guardar el mismo día/color actualiza en vez de duplicar, así dos personas trabajando la misma fecha no pisan entradas separadas sino que la última guardada gana. */
export async function upsertSesionVertical(userId: string, fecha: string, colorBlock: string, bloquesCargados: BlockCargado[], sobranteResultanteCm: number | null): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('vertical_cortes_sesiones').upsert(
    {
      fecha,
      color_block: colorBlock,
      bloques_cargados: bloquesCargados,
      sobrante_resultante_cm: sobranteResultanteCm,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'fecha,color_block' }
  );
  if (error) throw new Error(error.message);
}
