// Versiones aprobadas del presupuesto: congelan el presupuesto y el desembolso proyectado del horizonte de una corrida.
// Son inmutables (triggers de Supabase): una corrección es una versión nueva, nunca una modificación.
import { getSupabaseAdminClient } from '../supabase/admin';
import { leerDesembolsos, leerFilas, resolverCorrida } from './lectura';

/** Una fila por insumo y mes del horizonte congelada al aprobar. */
export interface FilaVersion {
  productId: number;
  sku: string;
  cat: string;
  /** AAAA-MM */
  mes: string;
  /** Costo con el que se presupuestó ($). */
  costo: number;
  /** Compra que llega en el mes (u y $). */
  llegadaU: number;
  llegadaArs: number;
  /** Orden a emitir en el mes (u y $). */
  emitirU: number;
  emitirArs: number;
  /** Consumo proyectado del mes (u): sirve para medir la precisión del pronóstico. */
  consumoProyU: number;
}

export interface CabeceraVersion {
  id: string;
  nombre: string;
  horizonte: string[];
  corridaId: string;
  aprobadaPor: string;
  aprobadaEn: string;
  totalCompra: number;
  vigente: boolean;
  params: Record<string, unknown>;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function mapCabecera(r: Record<string, unknown>): CabeceraVersion {
  return {
    id: r.id as string, nombre: r.nombre as string, horizonte: r.horizonte as string[], corridaId: r.corrida_id as string,
    aprobadaPor: r.aprobada_por as string, aprobadaEn: r.aprobada_en as string, totalCompra: num(Number(r.total_compra)), vigente: r.vigente as boolean,
    params: (r.params ?? {}) as Record<string, unknown>,
  };
}

export async function listarVersiones(): Promise<CabeceraVersion[]> {
  const { data, error } = await getSupabaseAdminClient().from('version_presupuesto').select('*').order('aprobada_en', { ascending: false });
  if (error) throw new Error(`version_presupuesto: ${error.message}`);
  return (data ?? []).map(mapCabecera);
}

export async function versionVigente(): Promise<CabeceraVersion | null> {
  const { data, error } = await getSupabaseAdminClient().from('version_presupuesto').select('*').eq('vigente', true).order('aprobada_en', { ascending: false }).limit(1);
  if (error) throw new Error(`version_presupuesto: ${error.message}`);
  return data?.[0] ? mapCabecera(data[0]) : null;
}

export async function leerFilasVersion(versionId: string): Promise<FilaVersion[]> {
  const supabase = getSupabaseAdminClient();
  const out: FilaVersion[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from('version_sku_mes').select('product_id, mes, datos').eq('version_id', versionId).range(desde, desde + 999);
    if (error) throw new Error(`version_sku_mes: ${error.message}`);
    for (const r of data ?? []) out.push({ productId: r.product_id as number, mes: r.mes as string, ...(r.datos as Omit<FilaVersion, 'productId' | 'mes'>) });
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function leerDesembolsosVersion(versionId: string): Promise<{ mes: string; tipo: string; concepto: string; valor: number }[]> {
  const { data, error } = await getSupabaseAdminClient().from('version_desembolso').select('mes, tipo, concepto, valor').eq('version_id', versionId);
  if (error) throw new Error(`version_desembolso: ${error.message}`);
  return (data ?? []).map((r) => ({ mes: r.mes as string, tipo: r.tipo as string, concepto: r.concepto as string, valor: Number(r.valor) }));
}

export class AprobacionError extends Error {}

/**
 * Congela el presupuesto y el desembolso proyectado de una corrida (por defecto, la última terminada bien).
 * La versión anterior deja de estar vigente pero se conserva intacta.
 */
export async function aprobarVersion(opts: { corridaId?: string | null; nombre?: string; usuario: string }): Promise<CabeceraVersion> {
  const corrida = await resolverCorrida(opts.corridaId);
  if (!corrida || !corrida.resumen || corrida.estado !== 'ok') throw new AprobacionError('No hay una corrida terminada para aprobar');
  const resumen = corrida.resumen;
  const [filas, desembolsos] = await Promise.all([leerFilas(corrida.id), leerDesembolsos(corrida.id)]);
  const meses = resumen.horizonte;
  const supabase = getSupabaseAdminClient();

  const nombre = opts.nombre?.trim() || `${meses[0] ?? ''} a ${meses[meses.length - 1] ?? ''} (datos del ${corrida.fechaDatos})`;
  const { data: cab, error: eCab } = await supabase
    .from('version_presupuesto')
    .insert({
      nombre, horizonte: meses, corrida_id: corrida.id, aprobada_por: opts.usuario, total_compra: resumen.totalCompra, vigente: true,
      params: { fechaDatos: corrida.fechaDatos, corte: resumen.corte, tipoCambio: resumen.tipoCambio, skus: resumen.skus, estadoControles: resumen.estadoControles },
    })
    .select('*')
    .single();
  if (eCab || !cab) throw new Error(`No se pudo crear la versión: ${eCab?.message}`);
  const versionId = cab.id as string;

  try {
    const filasMes: { version_id: string; product_id: number; mes: string; datos: Omit<FilaVersion, 'productId' | 'mes'> }[] = [];
    for (const f of filas) {
      if (f.productId === null || f.productId === undefined) continue;
      const r = f as unknown as Record<string, number>;
      meses.forEach((mes, i) => {
        const j = i + 1;
        const datos = { sku: f.sku, cat: f.cat, costo: f.costo, llegadaU: r[`r${j}`] ?? 0, llegadaArs: r[`rd${j}`] ?? 0, emitirU: r[`o${j}u`] ?? 0, emitirArs: r[`o${j}`] ?? 0, consumoProyU: r[`p${j}`] ?? 0 };
        if (datos.llegadaU || datos.llegadaArs || datos.emitirU || datos.consumoProyU) filasMes.push({ version_id: versionId, product_id: f.productId as number, mes, datos });
      });
    }
    for (let i = 0; i < filasMes.length; i += 500) {
      const { error } = await supabase.from('version_sku_mes').insert(filasMes.slice(i, i + 500));
      if (error) throw new Error(`version_sku_mes: ${error.message}`);
    }
    const filasDes = desembolsos.filter((d) => d.tipo === 'proyectado').map((d) => ({ version_id: versionId, mes: d.mes, tipo: d.tipo, concepto: d.concepto, valor: d.valor }));
    for (let i = 0; i < filasDes.length; i += 500) {
      const { error } = await supabase.from('version_desembolso').insert(filasDes.slice(i, i + 500));
      if (error) throw new Error(`version_desembolso: ${error.message}`);
    }
  } catch (e) {
    // Una versión a medias no se puede borrar (es inmutable): se deja marcada como no vigente y con un aviso en el nombre.
    await supabase.from('version_presupuesto').update({ vigente: false }).eq('id', versionId);
    throw new AprobacionError(`La versión no se pudo guardar completa y quedó anulada (${e instanceof Error ? e.message : e}). Probá de nuevo.`);
  }

  // Recién con todo guardado, la versión anterior deja de estar vigente.
  const { error: eOld } = await supabase.from('version_presupuesto').update({ vigente: false }).eq('vigente', true).neq('id', versionId);
  if (eOld) throw new Error(`No se pudo retirar la versión anterior: ${eOld.message}`);
  return mapCabecera(cab);
}
