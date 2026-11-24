import { getSupabaseAdminClient } from './admin';

/**
 * Parámetros de costeo editables (rentabilidad_parametros_costeo: clave -> valor). Claves usadas:
 * valor_hora_productivo, valor_hora_YYYY_MM, coef_indirecta_no_colchon. Sin tabla = {} (defaults en contribucion.ts).
 */
export async function getParametrosCosteo(): Promise<Record<string, number>> {
  try {
    const { data, error } = await getSupabaseAdminClient().from('rentabilidad_parametros_costeo').select('clave, valor');
    if (error) return {};
    return Object.fromEntries((data ?? []).map((r) => [r.clave as string, Number(r.valor)]));
  } catch {
    return {};
  }
}
