// Lectura de lo que dejó una corrida en Supabase (calc_*). Las pantallas solo leen: nunca calculan.
import { getSupabaseAdminClient } from '../supabase/admin';
import type { FilaCompleta } from './indicadores';
import type { FilaControlOc } from './control-oc';
import { ultimaCorrida, type CorridaGuardada } from './corrida';

export interface FilaDesembolso {
  mes: string;
  tipo: 'pagado' | 'proyectado';
  concepto: string;
  valor: number;
}

/** Corrida pedida por id, o la última terminada bien. */
export async function resolverCorrida(id?: string | null): Promise<CorridaGuardada | null> {
  if (!id) return ultimaCorrida(true);
  const { data, error } = await getSupabaseAdminClient()
    .from('compras_corridas')
    .select('id, creada_en, origen, disparada_por, fecha_datos, estado, error, resumen, controles')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id, creadaEn: data.creada_en, origen: data.origen, disparadaPor: data.disparada_por, fechaDatos: data.fecha_datos, estado: data.estado,
    error: data.error, resumen: data.resumen && Object.keys(data.resumen).length ? data.resumen : null, controles: data.controles ?? [],
  };
}

/** Lee todas las páginas de una consulta (Supabase corta en 1000 filas por request). */
async function leerTodo<T>(tabla: string, columnas: string, corridaId: string, orden?: string): Promise<T[]> {
  const supabase = getSupabaseAdminClient();
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = supabase.from(tabla).select(columnas).eq('corrida_id', corridaId).range(desde, desde + 999);
    if (orden) q = q.order(orden, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function leerFilas(corridaId: string): Promise<FilaCompleta[]> {
  const rows = await leerTodo<{ datos: FilaCompleta }>('calc_sku', 'datos', corridaId, 'sku');
  return rows.map((r) => r.datos);
}

export async function leerDesembolsos(corridaId: string): Promise<FilaDesembolso[]> {
  const rows = await leerTodo<{ mes: string; tipo: 'pagado' | 'proyectado'; concepto: string; valor: number }>('calc_desembolsos', 'mes, tipo, concepto, valor', corridaId);
  return rows.map((r) => ({ ...r, valor: Number(r.valor) }));
}

export async function leerControlOc(corridaId: string): Promise<FilaControlOc[]> {
  const rows = await leerTodo<{ datos: FilaControlOc }>('calc_control_oc', 'datos', corridaId);
  return rows.map((r) => r.datos).sort((a, b) => b.valor - a.valor);
}
