// Cierres mensuales de indicadores (N1/N2 de compras e inventario). Son inmutables: una corrección es una revisión nueva.
import { getSupabaseAdminClient } from '../supabase/admin';
import { kpisCompras, kpisInventario, type KpisCompras, type KpisInventario } from './indicadores';
import { leerDesembolsos, leerFilas, resolverCorrida } from './lectura';
import { construirSeguimiento } from './seguimiento-datos';

export class CierreError extends Error {}

export interface IndicadoresCierre {
  compras: KpisCompras;
  inventario: KpisInventario;
  /** Cumplimiento medido a esa fecha contra la versión vigente (null si no hay versión o ningún mes cerrado). */
  cumplimiento: { aprobado: number; real: number; pct: number | null; versionId: string; versionNombre: string } | null;
  /** Pagado a proveedores y gastos de importación en el mes ($, con IVA y percepciones). */
  desembolsoPagado: number | null;
  corridaId: string;
}

export interface Cierre {
  id: string;
  mes: string;
  revision: number;
  indicadores: IndicadoresCierre;
  fechaDatos: string;
  usuario: string;
  creadoEn: string;
}

function mapear(r: Record<string, unknown>): Cierre {
  return { id: r.id as string, mes: r.mes as string, revision: r.revision as number, indicadores: r.indicadores as IndicadoresCierre, fechaDatos: r.fecha_datos as string, usuario: r.usuario as string, creadoEn: r.creado_en as string };
}

/** Todos los cierres (con sus revisiones), del más viejo al más nuevo. */
export async function listarCierres(): Promise<Cierre[]> {
  const { data, error } = await getSupabaseAdminClient().from('cierre_mensual').select('*').order('mes', { ascending: true }).order('revision', { ascending: true });
  if (error) throw new Error(`cierre_mensual: ${error.message}`);
  return (data ?? []).map(mapear);
}

/**
 * Registra el cierre del último mes cerrado de una corrida (por defecto, la última terminada bien).
 * Si ya había un cierre de ese mes, se guarda como revisión nueva sin tocar la anterior.
 */
export async function registrarCierre(opts: { corridaId?: string | null; usuario: string }): Promise<Cierre> {
  const corrida = await resolverCorrida(opts.corridaId);
  if (!corrida || !corrida.resumen || corrida.estado !== 'ok') throw new CierreError('No hay una corrida terminada para registrar el cierre');
  const mes = corrida.resumen.corte;
  const [filas, desembolsos] = await Promise.all([leerFilas(corrida.id), leerDesembolsos(corrida.id)]);

  const seg = await construirSeguimiento(corrida, filas);
  const cumplimiento = seg && seg.resultado.mesesCerrados.length
    ? { aprobado: seg.resultado.total.aprobadoCerrado, real: seg.resultado.total.real, pct: seg.resultado.total.cumplimiento, versionId: seg.version.id, versionNombre: seg.version.nombre }
    : null;
  const pagado = desembolsos.filter((d) => d.tipo === 'pagado' && d.mes === mes && ['neto', 'iva', 'percepciones', 'gastos_importacion'].includes(d.concepto)).reduce((s, d) => s + d.valor, 0);

  const supabase = getSupabaseAdminClient();
  const { data: prev, error: ePrev } = await supabase.from('cierre_mensual').select('revision').eq('mes', mes).order('revision', { ascending: false }).limit(1);
  if (ePrev) throw new Error(`cierre_mensual: ${ePrev.message}`);
  const revision = (prev?.[0]?.revision ?? 0) + 1;

  const indicadores: IndicadoresCierre = { compras: kpisCompras(filas), inventario: kpisInventario(filas), cumplimiento, desembolsoPagado: pagado || null, corridaId: corrida.id };
  const { data, error } = await supabase
    .from('cierre_mensual')
    .insert({ mes, revision, indicadores, fecha_datos: corrida.fechaDatos, corrida_id: corrida.id, usuario: opts.usuario })
    .select('*')
    .single();
  if (error || !data) throw new Error(`No se pudo registrar el cierre: ${error?.message}`);
  return mapear(data);
}
