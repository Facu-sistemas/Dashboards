// Edición de la configuración de Compras MP (parámetros, reglas, excepciones y plan). Solo la usa el perfil de Compras.
// Cada cambio se valida, se guarda y queda auditado en cfg_auditoria (quién, cuándo, valor anterior y nuevo).
import { z } from 'zod';
import { getSupabaseAdminClient } from '../supabase/admin';
import { CLAVES_PARAMETROS, CLAVES_EXTRA, CONCEPTOS_PLAN, TIPOS_REGLA, cargarConfig, cargarPlan } from './config';

export class EdicionError extends Error {}

const origen = z.enum(['Local', 'Brasil', 'China']);
const noNeg = z.number().min(0);
const prop = z.number().min(0).max(1);
const planSiguiente = z.object({ prod_colchones: noNeg.nullable(), prod_sillones: noNeg.nullable(), ventas_colchones: noNeg.nullable() });
const porClase = z.object({ A: noNeg, B: noNeg, C: noNeg });

/** Forma válida de cada parámetro. */
const ESQUEMA_PARAMETRO: Record<string, z.ZodTypeAny> = {
  sommier_pct_ventas: prop,
  pocket_x18_mes: noNeg,
  eps_semana: noNeg,
  semanas_mes: z.number().gt(0).max(6),
  umbral_A: prop,
  umbral_B: prop,
  dias_por_semana: z.union([z.literal(5), z.literal(7)]),
  umbral_tendencia: prop,
  ss_critico: noNeg,
  ss_abc: porClase,
  ciclo_abc: porClase,
  origenes: z.object({ Local: z.object({ lead_dias: noNeg, ss_min: noNeg, ciclo: z.number().int().min(1) }), Brasil: z.object({ lead_dias: noNeg, ss_min: noNeg, ciclo: z.number().int().min(1) }), China: z.object({ lead_dias: noNeg, ss_min: noNeg, ciclo: z.number().int().min(1) }) }),
  plan_mes_siguiente: planSiguiente,
  plan_enero_siguiente: planSiguiente,
  cond_pago_default: z.object({ Local: z.object({ dias: noNeg, anticipado: z.boolean(), iva: prop, perc: prop }), Brasil: z.object({ dias: noNeg, anticipado: z.boolean(), iva: prop, perc: prop }), China: z.object({ dias: noNeg, anticipado: z.boolean(), iva: prop, perc: prop }) }),
  tipo_cambio_manual: z.number().gt(0),
  ubicacion_reposicion: z.string().trim().min(1).max(120),
};

const ESQUEMA_REGLA: Record<(typeof TIPOS_REGLA)[number], z.ZodTypeAny> = {
  linea_categoria: z.enum(['Colchones', 'Living', 'Ambos']),
  origen_proveedor: origen,
  quimico_principal: z.literal(true),
  coleccion: z.string().trim().min(1),
  prefijo_tela_living: z.literal(true),
  coleccion_discontinuada: z.literal(true),
};

const METODOS = ['Coeficiente', 'Promedio', 'Agotar stock', 'Discontinuado', 'Consignado', 'Sin proyeccion'] as const;
const esquemaExcepcion = z.object({
  productId: z.number().int().positive(),
  skuNombre: z.string().trim().min(1),
  metodo: z.enum(METODOS).nullable().optional(),
  critico: z.boolean().optional(),
  costo: noNeg.nullable().optional(),
  consumoMensual: noNeg.nullable().optional(),
  origen: origen.nullable().optional(),
  respaldo: z.enum(['Local', 'Brasil', 'China', 'Ninguno']).nullable().optional(),
  comentario: z.string().max(300).nullable().optional(),
});

const esquemaPlan = z.object({
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  concepto: z.enum(Object.values(CONCEPTOS_PLAN) as [string, ...string[]]),
  valor: noNeg.nullable(),
});

export type CambioConfig =
  | { tipo: 'parametro'; clave: string; valor: unknown }
  | { tipo: 'regla'; regla: (typeof TIPOS_REGLA)[number]; clave: string; valor: unknown | null }
  | { tipo: 'excepcion'; excepcion: z.infer<typeof esquemaExcepcion> | { productId: number; borrar: true } }
  | { tipo: 'plan'; anio: number; mes: number; concepto: string; valor: number | null };

async function auditar(usuario: string, tabla: string, clave: string, anterior: unknown, nuevo: unknown): Promise<void> {
  const { error } = await getSupabaseAdminClient().from('cfg_auditoria').insert({ usuario, tabla, clave, anterior: anterior ?? null, nuevo: nuevo ?? null });
  if (error) throw new Error(`cfg_auditoria: ${error.message}`);
}

/** Mensajes de validación legibles. */
function validar<T>(esquema: z.ZodType<T>, valor: unknown, que: string): T {
  const r = esquema.safeParse(valor);
  if (!r.success) throw new EdicionError(`${que}: ${r.error.issues.map((i) => `${i.path.join('.') || 'valor'} ${i.message}`).join('; ')}`);
  return r.data;
}

/** Aplica un cambio de configuración y lo deja auditado. No recalcula: lo hace quien llama. */
export async function aplicarCambio(cambio: CambioConfig, usuario: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const ahora = new Date().toISOString();

  if (cambio.tipo === 'parametro') {
    const permitidas = [...CLAVES_PARAMETROS, ...CLAVES_EXTRA] as string[];
    if (!permitidas.includes(cambio.clave)) throw new EdicionError(`El parámetro "${cambio.clave}" no existe`);
    const { data: prev } = await supabase.from('cfg_parametros').select('valor').eq('clave', cambio.clave).maybeSingle();
    // tipo de cambio manual: null/vacío = volver a usar la cotización de Odoo
    if (cambio.valor === null || cambio.valor === '') {
      if (!(CLAVES_EXTRA as readonly string[]).includes(cambio.clave)) throw new EdicionError('Este parámetro no se puede dejar vacío');
      const { error } = await supabase.from('cfg_parametros').delete().eq('clave', cambio.clave);
      if (error) throw new Error(error.message);
      await auditar(usuario, 'cfg_parametros', cambio.clave, prev?.valor, null);
      return;
    }
    const valor = validar(ESQUEMA_PARAMETRO[cambio.clave]!, cambio.valor, `Parámetro ${cambio.clave}`);
    if (cambio.clave === 'umbral_A' || cambio.clave === 'umbral_B') {
      const cfg = (await cargarConfig()).cfg;
      const a = cambio.clave === 'umbral_A' ? (valor as number) : cfg.umbral_A;
      const b = cambio.clave === 'umbral_B' ? (valor as number) : cfg.umbral_B;
      if (a >= b) throw new EdicionError('El umbral de la clase A tiene que ser menor que el de la clase B');
    }
    const { error } = await supabase.from('cfg_parametros').upsert({ clave: cambio.clave, valor, actualizado_en: ahora, actualizado_por: usuario }, { onConflict: 'clave' });
    if (error) throw new Error(error.message);
    await auditar(usuario, 'cfg_parametros', cambio.clave, prev?.valor, valor);
    return;
  }

  if (cambio.tipo === 'regla') {
    if (!(TIPOS_REGLA as readonly string[]).includes(cambio.regla)) throw new EdicionError(`Tipo de regla desconocido: ${cambio.regla}`);
    const clave = String(cambio.clave ?? '').trim();
    if (!clave) throw new EdicionError('Falta el nombre de la regla');
    const { data: prev } = await supabase.from('cfg_reglas').select('valor').eq('tipo', cambio.regla).eq('clave', clave).maybeSingle();
    if (cambio.valor === null) {
      const { error } = await supabase.from('cfg_reglas').delete().eq('tipo', cambio.regla).eq('clave', clave);
      if (error) throw new Error(error.message);
      await auditar(usuario, 'cfg_reglas', `${cambio.regla}:${clave}`, prev?.valor, null);
      return;
    }
    const valor = validar(ESQUEMA_REGLA[cambio.regla], cambio.valor, `Regla ${cambio.regla}`);
    const { error } = await supabase.from('cfg_reglas').upsert({ tipo: cambio.regla, clave, valor, actualizado_en: ahora, actualizado_por: usuario }, { onConflict: 'tipo,clave' });
    if (error) throw new Error(error.message);
    await auditar(usuario, 'cfg_reglas', `${cambio.regla}:${clave}`, prev?.valor, valor);
    return;
  }

  if (cambio.tipo === 'excepcion') {
    const e = cambio.excepcion;
    const { data: prev } = await supabase.from('cfg_excepciones').select('*').eq('product_id', e.productId).maybeSingle();
    if ('borrar' in e) {
      const { error } = await supabase.from('cfg_excepciones').delete().eq('product_id', e.productId);
      if (error) throw new Error(error.message);
      await auditar(usuario, 'cfg_excepciones', String(e.productId), prev, null);
      return;
    }
    const v = validar(esquemaExcepcion, e, 'Excepción');
    const fila = {
      product_id: v.productId, sku_nombre: v.skuNombre, metodo: v.metodo ?? null, critico: v.critico ?? false, costo: v.costo ?? null,
      consumo_mensual: v.consumoMensual ?? null, origen: v.origen ?? null, respaldo: v.respaldo ?? null, comentario: v.comentario ?? null,
      actualizado_en: ahora, actualizado_por: usuario,
    };
    const { error } = await supabase.from('cfg_excepciones').upsert(fila, { onConflict: 'product_id' });
    if (error) throw new Error(error.message);
    await auditar(usuario, 'cfg_excepciones', String(v.productId), prev, fila);
    return;
  }

  // plan
  const v = validar(esquemaPlan, cambio, 'Plan');
  const { data: prev } = await supabase.from('cfg_plan').select('valor').eq('anio', v.anio).eq('mes', v.mes).eq('concepto', v.concepto).maybeSingle();
  if (v.valor === null) {
    const { error } = await supabase.from('cfg_plan').delete().eq('anio', v.anio).eq('mes', v.mes).eq('concepto', v.concepto);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('cfg_plan').upsert({ anio: v.anio, mes: v.mes, concepto: v.concepto, valor: v.valor, actualizado_en: ahora, actualizado_por: usuario }, { onConflict: 'anio,mes,concepto' });
    if (error) throw new Error(error.message);
  }
  await auditar(usuario, 'cfg_plan', `${v.anio}-${String(v.mes).padStart(2, '0')}:${v.concepto}`, prev?.valor, v.valor);
}

export interface ConfigEditable {
  parametros: Record<string, unknown>;
  reglas: Record<string, { clave: string; valor: unknown }[]>;
  excepciones: {
    productId: number; skuNombre: string; metodo: string | null; critico: boolean; costo: number | null; consumoMensual: number | null;
    origen: string | null; respaldo: string | null; comentario: string | null; actualizadoEn: string; actualizadoPor: string | null;
  }[];
  plan: { anio: number; valores: Record<string, (number | null)[]> };
  auditoria: { id: number; creadoEn: string; usuario: string; tabla: string; clave: string; anterior: unknown; nuevo: unknown }[];
  conceptosPlan: Record<string, string>;
}

/** Todo lo que muestra la pantalla Parámetros. */
export async function leerConfigEditable(anio: number): Promise<ConfigEditable> {
  const supabase = getSupabaseAdminClient();
  const { cfg, extras } = await cargarConfig();
  const [reg, exc, aud, plan] = await Promise.all([
    supabase.from('cfg_reglas').select('tipo, clave, valor').order('clave'),
    supabase.from('cfg_excepciones').select('*').order('sku_nombre'),
    supabase.from('cfg_auditoria').select('*').order('id', { ascending: false }).limit(100),
    cargarPlan(anio),
  ]);
  for (const r of [reg, exc, aud]) if (r.error) throw new Error(r.error.message);
  const rec = cfg as unknown as Record<string, unknown>;
  const parametros: Record<string, unknown> = Object.fromEntries(CLAVES_PARAMETROS.map((k) => [k, rec[k]]));
  parametros.tipo_cambio_manual = extras.tipoCambioManual;
  parametros.ubicacion_reposicion = extras.ubicacionReposicion;
  const reglas: ConfigEditable['reglas'] = {};
  for (const t of TIPOS_REGLA) reglas[t] = [];
  for (const r of reg.data ?? []) (reglas[r.tipo as string] ??= []).push({ clave: r.clave as string, valor: r.valor });
  return {
    parametros, reglas,
    excepciones: (exc.data ?? []).map((e) => ({
      productId: e.product_id, skuNombre: e.sku_nombre, metodo: e.metodo, critico: e.critico, costo: e.costo === null ? null : Number(e.costo),
      consumoMensual: e.consumo_mensual === null ? null : Number(e.consumo_mensual), origen: e.origen, respaldo: e.respaldo, comentario: e.comentario,
      actualizadoEn: e.actualizado_en, actualizadoPor: e.actualizado_por,
    })),
    plan: { anio, valores: { dias_habiles: plan.diasHabiles, prod_real_colchones: plan.prodRealColchones, prod_real_sillones: plan.prodRealSillones, prod_consensuada_colchones: plan.prodConsColchones, prod_consensuada_sillones: plan.prodConsSillones, ventas_consensuadas: plan.ventasConsColchones } },
    auditoria: (aud.data ?? []).map((a) => ({ id: a.id, creadoEn: a.creado_en, usuario: a.usuario, tabla: a.tabla, clave: a.clave, anterior: a.anterior, nuevo: a.nuevo })),
    conceptosPlan: Object.fromEntries(Object.entries(CONCEPTOS_PLAN).map(([k, v]) => [v, k])),
  };
}
