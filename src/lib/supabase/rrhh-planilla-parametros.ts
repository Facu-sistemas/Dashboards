import { getSupabaseAdminClient } from './admin';

/**
 * Parámetros de la quincena que RRHH carga a mano en RRHH > Planilla (punto 4.8 del pipeline con RRHH): total de horas,
 * feriados y días de viático. Valen para toda la columna (empleado_id = 0) y se pueden pisar por persona (empleado_id =
 * hr.employee.id). Lo que no esté cargado sale del cálculo de Odoo. No toca Odoo.
 *
 * Tabla `rrhh_planilla_parametros`: se crea a mano en el SQL editor de Supabase (no hay migraciones en el repo). RLS
 * default-deny: único acceso vía estas funciones desde /api routes y el servidor, mismo patrón que rrhh-novedades-descartadas.ts.
 *
 *   create table if not exists public.rrhh_planilla_parametros (
 *     desde date not null,
 *     hasta date not null,
 *     empleado_id integer not null default 0,     -- 0 = toda la columna; si no, hr.employee.id
 *     campo text not null check (campo in ('totalHs', 'feriadosHs', 'viaticoDias')),
 *     valor numeric not null check (valor >= 0),
 *     cargado_por text not null,
 *     cargado_en timestamptz not null default now(),
 *     primary key (desde, hasta, empleado_id, campo)
 *   );
 *   alter table public.rrhh_planilla_parametros enable row level security;
 *   revoke all on public.rrhh_planilla_parametros from anon, authenticated;
 *   grant all on public.rrhh_planilla_parametros to service_role;
 */

export const CAMPOS_PARAMETRO = ['totalHs', 'feriadosHs', 'viaticoDias'] as const;
export type CampoParametro = (typeof CAMPOS_PARAMETRO)[number];

export interface ValorParametro {
  valor: number;
  por: string;
  en: string;
}

export interface ParametrosQuincena {
  /** `false` si falta crear la tabla en Supabase: la Planilla funciona igual, con los valores de Odoo. */
  disponible: boolean;
  /** Valores del encabezado (toda la columna). */
  generales: Partial<Record<CampoParametro, ValorParametro>>;
  /** Ajustes por persona: hr.employee.id -> campo -> valor. */
  porEmpleado: Map<number, Partial<Record<CampoParametro, ValorParametro>>>;
}

const TABLA = 'rrhh_planilla_parametros';

/** Lectura tolerante: si la tabla todavía no existe devuelve vacío y avisa, para que la Planilla funcione igual. */
export async function leerParametrosQuincena(desde: string, hasta: string): Promise<ParametrosQuincena> {
  const vacio: ParametrosQuincena = { disponible: false, generales: {}, porEmpleado: new Map() };
  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.from(TABLA).select('empleado_id, campo, valor, cargado_por, cargado_en').eq('desde', desde).eq('hasta', hasta);
    if (error) throw new Error(error.message);
    const out: ParametrosQuincena = { disponible: true, generales: {}, porEmpleado: new Map() };
    for (const r of data ?? []) {
      const campo = r.campo as CampoParametro;
      if (!CAMPOS_PARAMETRO.includes(campo)) continue;
      const v: ValorParametro = { valor: Number(r.valor), por: r.cargado_por as string, en: r.cargado_en as string };
      const id = Number(r.empleado_id);
      if (id === 0) out.generales[campo] = v;
      else out.porEmpleado.set(id, { ...(out.porEmpleado.get(id) ?? {}), [campo]: v });
    }
    return out;
  } catch (err) {
    console.warn('[rrhh-planilla-parametros] no se pudieron leer, la Planilla usa los valores de Odoo:', err instanceof Error ? err.message : err);
    return vacio;
  }
}

/** Guarda un valor (encabezado si empleadoId = 0) o lo borra si `valor` es null (vuelve al valor de Odoo / del encabezado). */
export async function guardarParametro(p: { desde: string; hasta: string; empleadoId: number; campo: CampoParametro; valor: number | null; usuario: string }): Promise<void> {
  const admin = getSupabaseAdminClient();
  if (p.valor === null) {
    const { error } = await admin.from(TABLA).delete().eq('desde', p.desde).eq('hasta', p.hasta).eq('empleado_id', p.empleadoId).eq('campo', p.campo);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin.from(TABLA).upsert(
    { desde: p.desde, hasta: p.hasta, empleado_id: p.empleadoId, campo: p.campo, valor: p.valor, cargado_por: p.usuario, cargado_en: new Date().toISOString() },
    { onConflict: 'desde,hasta,empleado_id,campo' }
  );
  if (error) throw new Error(error.message);
}
