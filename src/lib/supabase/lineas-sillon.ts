import { getSupabaseAdminClient } from './admin';
import type { NivelesPersona } from '@/lib/lineas-sillon/polivalencia';
import { ADELANTO_PARALELO, NUM_LINEAS, type Adelanto } from '@/lib/lineas-sillon/engine';

/**
 * Configuración editable del Planificador de Líneas de sillones. Tablas creadas a
 * mano en Supabase (no hay migraciones en el repo):
 *
 *   create table lineas_sillon_lineas (
 *     linea integer primary key check (linea between 1 and 8),
 *     activa boolean not null default true,
 *     asignados jsonb not null default '{}',   -- { C1, C2, C, T, E } → id de persona
 *     adelanto jsonb not null default '{}',    -- { tapiceria, ensamble } → unidades ya adelantadas
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   create table lineas_sillon_personas (
 *     id uuid primary key default gen_random_uuid(),
 *     nombre text not null,
 *     puesto text not null check (puesto in ('costurera','carpintero','tendido','estampado')),
 *     activa boolean not null default true,
 *     productos text[] not null default '{}',  -- productos (nombre de DATOS) que le gusta hacer
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   create table lineas_sillon_alias (
 *     odoo_base text primary key,              -- nombre de Odoo sin la tela
 *     producto text not null,                  -- nombre en la hoja DATOS
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   create table lineas_sillon_tiempos (
 *     producto text primary key,
 *     minutos numeric not null check (minutos > 0),
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   create table lineas_sillon_manuales (       -- productos que no están en Odoo (p. ej. Onix dividido)
 *     id uuid primary key default gen_random_uuid(),
 *     linea integer not null check (linea between 1 and 8),
 *     producto text not null,
 *     cantidad integer not null check (cantidad > 0),
 *     nota text,
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table lineas_sillon_personas add column empleado_id integer;  -- hr.employee de Odoo
 *   create table lineas_sillon_planes (          -- foto del plan del día (la que se imprime a las 6)
 *     fecha date primary key,
 *     plan jsonb not null,
 *     creado_por text,
 *     creado_en timestamptz not null default now()
 *   );
 *   alter table lineas_sillon_planes enable row level security;
 *   grant select, insert, update, delete on lineas_sillon_planes to service_role;
 *   alter table lineas_sillon_lineas enable row level security;     -- default-deny, acceso solo vía /api
 *   alter table lineas_sillon_personas enable row level security;
 *   alter table lineas_sillon_alias enable row level security;
 *   alter table lineas_sillon_tiempos enable row level security;
 *   alter table lineas_sillon_manuales enable row level security;
 *   alter table lineas_sillon_personas add column niveles jsonb not null default '{}';  -- { COS|CAR|TAP|ENS: { producto: 1|2|3 } }
 *   create table lineas_sillon_ignoradas (       -- unidades que la línea ya cerró pero Odoo sigue abierta
 *     orden text primary key,                    -- nombre de la MO de Odoo (ej. WH/MO/01234)
 *     unidades integer not null check (unidades > 0),
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table lineas_sillon_ignoradas enable row level security;
 *   grant select, insert, update, delete on lineas_sillon_ignoradas to service_role;
 *
 * Una línea sin fila = activa (salvo la 8, que arranca apagada). Si las tablas no
 * existen, las lecturas devuelven `disponible: false` y el plan usa los defaults.
 */

export type PuestoPersona = 'costurera' | 'carpintero' | 'tendido' | 'estampado';
export const PUESTOS_PERSONA: PuestoPersona[] = ['costurera', 'carpintero', 'tendido', 'estampado'];

/** Cada puesto del croquis: C1/C2 costureras, C carpintero, T tendido, E estampado. */
export const SLOTS = ['C1', 'C2', 'C', 'T', 'E'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_PUESTO: Record<Slot, PuestoPersona> = {
  C1: 'costurera',
  C2: 'costurera',
  C: 'carpintero',
  T: 'tendido',
  E: 'estampado',
};

export interface PersonaSillon {
  id: string;
  /** hr.employee de Odoo con el que se vinculó; null en las personas cargadas a mano antes del vínculo. */
  empleadoId: number | null;
  nombre: string;
  puesto: PuestoPersona;
  activa: boolean;
  productos: string[];
  /** Polivalencia: por proceso (COS/CAR/TAP/ENS), nivel en cada producto — 1 no lo hace solo, 2 solo, 3 enseña o le gusta. */
  niveles: NivelesPersona;
}

export interface LineaConfig {
  linea: number;
  activa: boolean;
  asignados: Partial<Record<Slot, string | null>>;
  adelanto: Adelanto;
}

export interface ManualSillon {
  id: string;
  linea: number;
  producto: string;
  cantidad: number;
  nota: string;
}

export interface ConfigSillon {
  disponible: boolean;
  lineas: LineaConfig[];
  personas: PersonaSillon[];
  alias: Record<string, string>;
  tiempos: Record<string, number>;
  manuales: ManualSillon[];
  /** Unidades a descartar por orden de Odoo (MO → cantidad): ya cerradas en la línea. */
  ignoradas: Record<string, number>;
}

const lineaDefault = (linea: number): LineaConfig => ({
  linea,
  activa: linea !== NUM_LINEAS,
  asignados: {},
  adelanto: { ...ADELANTO_PARALELO },
});

export async function getConfigSillon(): Promise<ConfigSillon> {
  const admin = getSupabaseAdminClient();
  const [lineasRes, personasRes, aliasRes, tiemposRes, manualesRes, ignoradasRes] = await Promise.all([
    admin.from('lineas_sillon_lineas').select('linea, activa, asignados, adelanto'),
    admin.from('lineas_sillon_personas').select('*').order('nombre'),
    admin.from('lineas_sillon_alias').select('odoo_base, producto'),
    admin.from('lineas_sillon_tiempos').select('producto, minutos'),
    admin.from('lineas_sillon_manuales').select('id, linea, producto, cantidad, nota').order('updated_at'),
    admin.from('lineas_sillon_ignoradas').select('orden, unidades'),
  ]);
  const error = lineasRes.error ?? personasRes.error ?? aliasRes.error ?? tiemposRes.error ?? manualesRes.error ?? ignoradasRes.error;
  const lineas = Array.from({ length: NUM_LINEAS }, (_, i) => lineaDefault(i + 1));
  if (error) {
    console.error('[lineas-sillon]', error.message);
    return { disponible: false, lineas, personas: [], alias: {}, tiempos: {}, manuales: [], ignoradas: {} };
  }
  for (const r of lineasRes.data ?? []) {
    const l = lineas[Number(r.linea) - 1];
    if (!l) continue;
    l.activa = r.activa as boolean;
    l.asignados = (r.asignados ?? {}) as LineaConfig['asignados'];
    l.adelanto = { ...ADELANTO_PARALELO, ...((r.adelanto ?? {}) as Partial<Adelanto>) };
  }
  return {
    disponible: true,
    lineas,
    personas: (personasRes.data ?? []).map((r) => ({
      id: r.id as string,
      empleadoId: r.empleado_id == null ? null : Number(r.empleado_id),
      nombre: r.nombre as string,
      puesto: r.puesto as PuestoPersona,
      activa: r.activa as boolean,
      productos: (r.productos ?? []) as string[],
      niveles: (r.niveles ?? {}) as NivelesPersona,
    })),
    alias: Object.fromEntries((aliasRes.data ?? []).map((r) => [r.odoo_base as string, r.producto as string])),
    tiempos: Object.fromEntries((tiemposRes.data ?? []).map((r) => [r.producto as string, Number(r.minutos)])),
    ignoradas: Object.fromEntries((ignoradasRes.data ?? []).map((r) => [r.orden as string, Number(r.unidades)])),
    manuales: (manualesRes.data ?? []).map((r) => ({
      id: r.id as string,
      linea: Number(r.linea),
      producto: r.producto as string,
      cantidad: Number(r.cantidad),
      nota: (r.nota ?? '') as string,
    })),
  };
}

const ahora = () => new Date().toISOString();

export async function setLinea(
  linea: number,
  datos: { activa: boolean; asignados: LineaConfig['asignados']; adelanto: Adelanto },
  usuario: string,
): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('lineas_sillon_lineas')
    .upsert({ linea, ...datos, actualizado_por: usuario, updated_at: ahora() });
  if (error) throw new Error(error.message);
}

export async function guardarPersona(
  p: { id?: string; empleadoId: number | null; nombre: string; puesto: PuestoPersona; activa: boolean; productos: string[]; niveles?: NivelesPersona },
  usuario: string,
): Promise<void> {
  const fila = {
    empleado_id: p.empleadoId,
    nombre: p.nombre,
    puesto: p.puesto,
    activa: p.activa,
    productos: p.productos,
    ...(p.niveles ? { niveles: p.niveles } : {}),
    actualizado_por: usuario,
    updated_at: ahora(),
  };
  const q = getSupabaseAdminClient().from('lineas_sillon_personas');
  const { error } = p.id ? await q.update(fila).eq('id', p.id) : await q.insert(fila);
  if (error) throw new Error(error.message);
}

export async function crearPersonas(
  lista: { empleadoId: number | null; nombre: string; puesto: PuestoPersona; niveles: NivelesPersona }[],
  usuario: string,
): Promise<void> {
  if (lista.length === 0) return;
  const filas = lista.map((p) => ({
    empleado_id: p.empleadoId,
    nombre: p.nombre,
    puesto: p.puesto,
    activa: true,
    productos: [],
    niveles: p.niveles,
    actualizado_por: usuario,
    updated_at: ahora(),
  }));
  const { error } = await getSupabaseAdminClient().from('lineas_sillon_personas').insert(filas);
  if (error) throw new Error(error.message);
}

export async function borrarPersona(id: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().from('lineas_sillon_personas').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** `producto = null` borra el alias. */
export async function setAlias(odooBase: string, producto: string | null, usuario: string): Promise<void> {
  const q = getSupabaseAdminClient().from('lineas_sillon_alias');
  const { error } =
    producto === null
      ? await q.delete().eq('odoo_base', odooBase)
      : await q.upsert({ odoo_base: odooBase, producto, actualizado_por: usuario, updated_at: ahora() });
  if (error) throw new Error(error.message);
}

/** `minutos = null` borra la corrección (vuelve al tiempo de la planilla). */
export async function setTiempo(producto: string, minutos: number | null, usuario: string): Promise<void> {
  const q = getSupabaseAdminClient().from('lineas_sillon_tiempos');
  const { error } =
    minutos === null
      ? await q.delete().eq('producto', producto)
      : await q.upsert({ producto, minutos, actualizado_por: usuario, updated_at: ahora() });
  if (error) throw new Error(error.message);
}

export async function agregarManual(m: Omit<ManualSillon, 'id'>, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('lineas_sillon_manuales')
    .insert({ ...m, actualizado_por: usuario, updated_at: ahora() });
  if (error) throw new Error(error.message);
}

export async function borrarManual(id: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().from('lineas_sillon_manuales').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Suma (o resta, con delta negativo) unidades ignoradas de una orden; al llegar a 0 se borra la fila. */
export async function ajustarIgnoradas(orden: string, delta: number, usuario: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { data, error: errLeer } = await admin.from('lineas_sillon_ignoradas').select('unidades').eq('orden', orden).maybeSingle();
  if (errLeer) throw new Error(errLeer.message);
  const total = Math.max(0, Number(data?.unidades ?? 0) + delta);
  const { error } =
    total === 0
      ? await admin.from('lineas_sillon_ignoradas').delete().eq('orden', orden)
      : await admin.from('lineas_sillon_ignoradas').upsert({ orden, unidades: total, actualizado_por: usuario, updated_at: ahora() });
  if (error) throw new Error(error.message);
}

export async function limpiarIgnoradas(): Promise<void> {
  const { error } = await getSupabaseAdminClient().from('lineas_sillon_ignoradas').delete().neq('orden', '');
  if (error) throw new Error(error.message);
}

export interface PlanFijado<T> {
  fecha: string;
  creadoEn: string;
  creadoPor: string;
  plan: T;
}

/** Foto del plan de `fecha`, o null si no hay (o si la tabla todavía no existe). */
export async function getPlanFijado<T>(fecha: string): Promise<PlanFijado<T> | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from('lineas_sillon_planes')
    .select('fecha, plan, creado_por, creado_en')
    .eq('fecha', fecha)
    .maybeSingle();
  if (error) {
    console.error('[lineas-sillon] plan fijado', error.message);
    return null;
  }
  if (!data) return null;
  return { fecha: data.fecha as string, creadoEn: data.creado_en as string, creadoPor: (data.creado_por ?? '') as string, plan: data.plan as T };
}

export async function fijarPlan(fecha: string, plan: unknown, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('lineas_sillon_planes')
    .upsert({ fecha, plan, creado_por: usuario, creado_en: ahora() });
  if (error) throw new Error(error.message);
}
