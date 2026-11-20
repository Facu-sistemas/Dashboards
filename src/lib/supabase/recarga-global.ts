import { getSupabaseAdminClient } from './admin';

/** Tabla `recarga_global` (una fila, ver docs/recarga-global-schema.sql). RLS default-deny: acceso solo vía estas funciones. */

/** Marca de la última recarga pedida. null si la tabla todavía no existe (las páginas simplemente no se enteran de nada). */
export async function leerMarcaRecarga(): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient().from('recarga_global').select('recargar_en').eq('id', 1).maybeSingle();
  if (error) return null;
  return data?.recargar_en ?? null;
}

/** Admin: pide que todas las páginas abiertas se recarguen (lo notan en su próxima consulta, máx. ~1 minuto). */
export async function pedirRecargaGlobal(): Promise<string> {
  const ahora = new Date().toISOString();
  const { error } = await getSupabaseAdminClient().from('recarga_global').upsert({ id: 1, recargar_en: ahora });
  if (error) throw new Error(error.message);
  return ahora;
}
