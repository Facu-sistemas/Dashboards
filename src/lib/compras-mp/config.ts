// Reglas editables del presupuesto de Compras MP: viven en Supabase (cfg_*) y se leen en cada corrida.
// Si una tabla está vacía se usan las reglas por defecto del libro v12 (config-default.json).
import cfgJson from './config-default.json';
import { getSupabaseAdminClient } from '../supabase/admin';
import type { Config, Excepcion, Origen, PlanMensual } from './motor';

export const CONFIG_DEFAULT = cfgJson as unknown as Config;

/** Parámetros escalares / pequeños que se guardan en cfg_parametros (una fila por clave). */
export const CLAVES_PARAMETROS = [
  'sommier_pct_ventas', 'pocket_x18_mes', 'eps_semana', 'semanas_mes', 'umbral_A', 'umbral_B', 'dias_por_semana', 'umbral_tendencia',
  'plan_mes_siguiente', 'plan_enero_siguiente', 'origenes', 'ss_abc', 'ciclo_abc', 'ss_critico', 'cond_pago_default',
] as const;

/** Preferencias que no forman parte del motor: tipo de cambio manual (vacío = cotización de Odoo) y ubicación de las reglas de reabastecimiento. */
export const CLAVES_EXTRA = ['tipo_cambio_manual', 'ubicacion_reposicion'] as const;
export const UBICACION_REPOSICION_DEFECTO = 'WH/Existencias';

/** Tipos de cfg_reglas y la parte de Config que reemplazan cuando hay filas. */
export const TIPOS_REGLA = ['linea_categoria', 'origen_proveedor', 'quimico_principal', 'coleccion', 'prefijo_tela_living', 'coleccion_discontinuada'] as const;

/** Conceptos de cfg_plan (un valor por concepto y mes). */
export const CONCEPTOS_PLAN = {
  diasHabiles: 'dias_habiles',
  prodRealColchones: 'prod_real_colchones',
  prodRealSillones: 'prod_real_sillones',
  prodConsColchones: 'prod_consensuada_colchones',
  prodConsSillones: 'prod_consensuada_sillones',
  ventasConsColchones: 'ventas_consensuadas',
} as const;

/** El libro escribe "Sin proyección"; la tabla lo guarda sin tilde. */
const METODO_A_MOTOR: Record<string, string> = { 'Sin proyeccion': 'Sin proyección' };
const METODO_A_TABLA: Record<string, string> = { 'Sin proyección': 'Sin proyeccion' };

export interface FilaExcepcionDb {
  product_id: number;
  sku_nombre: string;
  metodo: string | null;
  critico: boolean;
  costo: number | null;
  consumo_mensual: number | null;
  origen: Origen | null;
  respaldo: Origen | 'Ninguno' | null;
  comentario: string | null;
}

export interface ConfigCargada {
  cfg: Config;
  extras: { tipoCambioManual: number | null; ubicacionReposicion: string };
  /** Nombre legible de cada excepción (clave `#id` o nombre) para los avisos. */
  nombresExcepciones: Record<string, string>;
  /** Cuántas filas de cada tabla se usaron (0 = se usó el valor por defecto del libro). */
  filas: { parametros: number; reglas: number; excepciones: number };
}

const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function excepcionDeFila(f: FilaExcepcionDb): Excepcion {
  const e: Excepcion = {};
  if (f.metodo) e.metodo = METODO_A_MOTOR[f.metodo] ?? f.metodo;
  if (f.critico) e.critico = true;
  if (f.costo !== null && f.costo !== undefined) e.costo = Number(f.costo);
  if (f.consumo_mensual !== null && f.consumo_mensual !== undefined) e.consumo_forzado = Number(f.consumo_mensual);
  if (f.origen) e.origen = f.origen;
  if (f.respaldo) e.respaldo = f.respaldo;
  return e;
}

export async function cargarConfig(): Promise<ConfigCargada> {
  const supabase = getSupabaseAdminClient();
  const cfg = clonar(CONFIG_DEFAULT);
  const [par, reg, exc] = await Promise.all([
    supabase.from('cfg_parametros').select('clave, valor'),
    supabase.from('cfg_reglas').select('tipo, clave, valor'),
    supabase.from('cfg_excepciones').select('product_id, sku_nombre, metodo, critico, costo, consumo_mensual, origen, respaldo, comentario'),
  ]);
  for (const r of [par, reg, exc]) if (r.error) throw new Error(`No se pudo leer la configuración: ${r.error.message}`);

  const rec = cfg as unknown as Record<string, unknown>;
  for (const p of par.data ?? []) if ((CLAVES_PARAMETROS as readonly string[]).includes(p.clave)) rec[p.clave] = p.valor;

  const porTipo = new Map<string, { clave: string; valor: unknown }[]>();
  for (const r of reg.data ?? []) porTipo.set(r.tipo, [...(porTipo.get(r.tipo) ?? []), { clave: r.clave, valor: r.valor }]);
  const mapa = (tipo: string) => Object.fromEntries((porTipo.get(tipo) ?? []).map((r) => [r.clave, r.valor]));
  if (porTipo.has('linea_categoria')) cfg.linea_por_categoria = mapa('linea_categoria') as Record<string, string>;
  if (porTipo.has('origen_proveedor')) cfg.origen_proveedor = mapa('origen_proveedor') as Record<string, Origen>;
  if (porTipo.has('coleccion')) cfg.colecciones = mapa('coleccion') as Record<string, string>;
  if (porTipo.has('quimico_principal')) cfg.quimicos_principales = porTipo.get('quimico_principal')!.map((r) => r.clave);
  if (porTipo.has('prefijo_tela_living')) cfg.prefijos_tela_living = porTipo.get('prefijo_tela_living')!.map((r) => r.clave);
  if (porTipo.has('coleccion_discontinuada')) cfg.colecciones_discontinuadas = porTipo.get('coleccion_discontinuada')!.map((r) => r.clave);

  const nombresExcepciones: Record<string, string> = Object.fromEntries(Object.keys(cfg.excepciones).map((k) => [k, k]));
  if ((exc.data ?? []).length) {
    cfg.excepciones = {};
    for (const f of exc.data as FilaExcepcionDb[]) {
      cfg.excepciones[`#${f.product_id}`] = excepcionDeFila(f);
      nombresExcepciones[`#${f.product_id}`] = f.sku_nombre;
    }
  }
  const extra = (clave: string) => (par.data ?? []).find((p) => p.clave === clave)?.valor;
  const extras = {
    tipoCambioManual: typeof extra('tipo_cambio_manual') === 'number' ? (extra('tipo_cambio_manual') as number) : null,
    ubicacionReposicion: typeof extra('ubicacion_reposicion') === 'string' ? (extra('ubicacion_reposicion') as string) : UBICACION_REPOSICION_DEFECTO,
  };
  return { cfg, extras, nombresExcepciones, filas: { parametros: par.data?.length ?? 0, reglas: reg.data?.length ?? 0, excepciones: exc.data?.length ?? 0 } };
}

const vacio12 = (): (number | null)[] => Array(12).fill(null);

/** Plan de producción y ventas del año (cfg_plan), sin los días hábiles transcurridos (esos salen del calendario de Odoo). */
export async function cargarPlan(anio: number): Promise<Omit<PlanMensual, 'diasTranscurridos'>> {
  const { data, error } = await getSupabaseAdminClient().from('cfg_plan').select('mes, concepto, valor').eq('anio', anio);
  if (error) throw new Error(`No se pudo leer el plan: ${error.message}`);
  const plan = {
    diasHabiles: vacio12(), prodRealSillones: vacio12(), prodRealColchones: vacio12(),
    prodConsSillones: vacio12(), prodConsColchones: vacio12(), ventasConsColchones: vacio12(),
  };
  const destino: Record<string, (number | null)[]> = {
    [CONCEPTOS_PLAN.diasHabiles]: plan.diasHabiles,
    [CONCEPTOS_PLAN.prodRealColchones]: plan.prodRealColchones,
    [CONCEPTOS_PLAN.prodRealSillones]: plan.prodRealSillones,
    [CONCEPTOS_PLAN.prodConsColchones]: plan.prodConsColchones,
    [CONCEPTOS_PLAN.prodConsSillones]: plan.prodConsSillones,
    [CONCEPTOS_PLAN.ventasConsColchones]: plan.ventasConsColchones,
  };
  for (const r of data ?? []) {
    const arr = destino[r.concepto];
    if (arr && r.mes >= 1 && r.mes <= 12 && r.valor !== null) arr[r.mes - 1] = Number(r.valor);
  }
  return plan;
}

// ------------------------------------------------------------------ siembra inicial
export interface ProductoParaSembrar {
  productId: number;
  sku: string;
  activo: boolean;
}

export interface ResultadoSiembra {
  parametros: number;
  reglas: number;
  excepciones: number;
  /** Excepciones del libro cuyo nombre ya no existe en Odoo (renombradas o archivadas): hay que revisarlas a mano. */
  excepcionesSinProducto: string[];
}

/**
 * Carga por primera vez las reglas del libro v12 en cfg_*. No pisa nada: solo escribe en tablas vacías.
 * `proveedoresOrigen` = lista completa de proveedores con su origen (Local incluido), para poder avisar de los nuevos.
 */
export async function sembrarConfig(productos: ProductoParaSembrar[], opts: { usuario: string; proveedoresOrigen?: Record<string, Origen> }): Promise<ResultadoSiembra> {
  const supabase = getSupabaseAdminClient();
  const cuenta = async (tabla: string) => {
    const { count, error } = await supabase.from(tabla).select('*', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const res: ResultadoSiembra = { parametros: 0, reglas: 0, excepciones: 0, excepcionesSinProducto: [] };
  const d = CONFIG_DEFAULT as unknown as Record<string, unknown>;
  const ahora = new Date().toISOString();

  if ((await cuenta('cfg_parametros')) === 0) {
    const filas = CLAVES_PARAMETROS.map((clave) => ({ clave, valor: d[clave], actualizado_por: opts.usuario, actualizado_en: ahora }));
    const { error } = await supabase.from('cfg_parametros').insert(filas);
    if (error) throw new Error(`cfg_parametros: ${error.message}`);
    res.parametros = filas.length;
  }

  if ((await cuenta('cfg_reglas')) === 0) {
    const filas: { tipo: string; clave: string; valor: unknown; actualizado_por: string }[] = [];
    const add = (tipo: string, clave: string, valor: unknown) => filas.push({ tipo, clave, valor, actualizado_por: opts.usuario });
    for (const [k, v] of Object.entries(CONFIG_DEFAULT.linea_por_categoria)) add('linea_categoria', k, v);
    for (const [k, v] of Object.entries(opts.proveedoresOrigen ?? CONFIG_DEFAULT.origen_proveedor)) add('origen_proveedor', k, v);
    for (const [k, v] of Object.entries(CONFIG_DEFAULT.colecciones)) add('coleccion', k, v);
    for (const k of CONFIG_DEFAULT.quimicos_principales) add('quimico_principal', k, true);
    for (const k of CONFIG_DEFAULT.prefijos_tela_living) add('prefijo_tela_living', k, true);
    for (const k of CONFIG_DEFAULT.colecciones_discontinuadas) add('coleccion_discontinuada', k, true);
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await supabase.from('cfg_reglas').insert(filas.slice(i, i + 500));
      if (error) throw new Error(`cfg_reglas: ${error.message}`);
    }
    res.reglas = filas.length;
  }

  if ((await cuenta('cfg_excepciones')) === 0) {
    // Se resuelve nombre → product_id (si hay dos con el mismo nombre se prefiere el activo).
    const porNombre = new Map<string, ProductoParaSembrar>();
    for (const p of productos) {
      const prev = porNombre.get(p.sku);
      if (!prev || (!prev.activo && p.activo)) porNombre.set(p.sku, p);
    }
    const filas: (FilaExcepcionDb & { actualizado_por: string })[] = [];
    for (const [nombre, e] of Object.entries(CONFIG_DEFAULT.excepciones)) {
      const p = porNombre.get(nombre);
      if (!p) { res.excepcionesSinProducto.push(nombre); continue; }
      filas.push({
        product_id: p.productId, sku_nombre: nombre, metodo: e.metodo ? METODO_A_TABLA[e.metodo] ?? e.metodo : null, critico: !!e.critico,
        costo: e.costo ?? null, consumo_mensual: e.consumo_forzado ?? null, origen: e.origen ?? null, respaldo: e.respaldo ?? null,
        comentario: 'Cargada desde el libro v12', actualizado_por: opts.usuario,
      });
    }
    if (filas.length) {
      const { error } = await supabase.from('cfg_excepciones').insert(filas);
      if (error) throw new Error(`cfg_excepciones: ${error.message}`);
    }
    res.excepciones = filas.length;
  }

  if (res.parametros + res.reglas + res.excepciones > 0) {
    await supabase.from('cfg_auditoria').insert({
      usuario: opts.usuario, tabla: 'cfg_*', clave: 'siembra inicial', anterior: null,
      nuevo: { parametros: res.parametros, reglas: res.reglas, excepciones: res.excepciones, sinProducto: res.excepcionesSinProducto },
    });
  }
  return res;
}

/** Carga el plan de un año en cfg_plan (upsert). Los null no se guardan. */
export async function sembrarPlan(anio: number, plan: Omit<PlanMensual, 'diasTranscurridos'>, usuario: string): Promise<number> {
  const filas: { anio: number; mes: number; concepto: string; valor: number; actualizado_por: string }[] = [];
  for (const [campo, concepto] of Object.entries(CONCEPTOS_PLAN)) {
    const arr = plan[campo as keyof typeof CONCEPTOS_PLAN];
    arr.forEach((v, i) => {
      if (typeof v === 'number') filas.push({ anio, mes: i + 1, concepto, valor: v, actualizado_por: usuario });
    });
  }
  const { error } = await getSupabaseAdminClient().from('cfg_plan').upsert(filas, { onConflict: 'anio,mes,concepto' });
  if (error) throw new Error(`cfg_plan: ${error.message}`);
  return filas.length;
}
