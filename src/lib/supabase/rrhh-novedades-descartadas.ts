import { getSupabaseAdminClient } from './admin';

/**
 * Novedades que RRHH descartó en la bandeja (Horas > Por día): "no es nada, no hay que cargar nada". Tabla
 * `rrhh_novedades_descartadas` — se crea a mano en el SQL editor de Supabase (no hay migraciones en el repo). RLS
 * default-deny: único acceso vía estas funciones desde /api routes y desde el servidor, mismo patrón que
 * rrhh-resumen-estado.ts. No toca Odoo: solo recuerda la decisión para que la novedad no vuelva a aparecer.
 *
 *   create table if not exists public.rrhh_novedades_descartadas (
 *     clave text primary key,                  -- "empleadoId|YYYY-MM-DD|tipo", la misma que arma rrhh-novedades.ts
 *     empleado_id integer not null,            -- hr.employee.id en Odoo
 *     fecha date not null,
 *     tipo text not null,
 *     motivo text,
 *     descartado_por text not null,            -- usuario de la web
 *     descartado_en timestamptz not null default now()
 *   );
 *   create index if not exists rrhh_novedades_descartadas_fecha_idx on public.rrhh_novedades_descartadas (fecha);
 *   alter table public.rrhh_novedades_descartadas enable row level security;
 *   revoke all on public.rrhh_novedades_descartadas from anon, authenticated;
 *   grant all on public.rrhh_novedades_descartadas to service_role;
 */

export interface NovedadDescartada {
  por: string;
  motivo: string | null;
  en: string;
}

/** Lectura tolerante: si la tabla todavía no existe devuelve vacío y avisa, para que la bandeja funcione igual. */
export async function listNovedadesDescartadas(desde: string, hasta: string): Promise<{ lista: boolean; map: Map<string, NovedadDescartada> }> {
  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('rrhh_novedades_descartadas')
      .select('clave, motivo, descartado_por, descartado_en')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw new Error(error.message);
    return {
      lista: true,
      map: new Map(
        (data ?? []).map((r) => [r.clave as string, { por: r.descartado_por as string, motivo: (r.motivo as string | null) ?? null, en: r.descartado_en as string }])
      ),
    };
  } catch (err) {
    console.warn('[rrhh-novedades-descartadas] no se pudieron leer, la bandeja se muestra sin descartes:', err instanceof Error ? err.message : err);
    return { lista: false, map: new Map() };
  }
}

export async function descartarNovedad(n: { clave: string; empleadoId: number; fecha: string; tipo: string; motivo?: string; usuario: string }): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('rrhh_novedades_descartadas').upsert(
    {
      clave: n.clave,
      empleado_id: n.empleadoId,
      fecha: n.fecha,
      tipo: n.tipo,
      motivo: n.motivo?.trim() || null,
      descartado_por: n.usuario,
      descartado_en: new Date().toISOString(),
    },
    { onConflict: 'clave' }
  );
  if (error) throw new Error(error.message);
}

/** Descarte masivo: un solo upsert con todas las novedades y el mismo motivo. */
export async function descartarNovedades(
  items: { clave: string; empleadoId: number; fecha: string; tipo: string }[],
  usuario: string,
  motivo?: string
): Promise<void> {
  if (items.length === 0) return;
  const admin = getSupabaseAdminClient();
  const en = new Date().toISOString();
  const { error } = await admin.from('rrhh_novedades_descartadas').upsert(
    items.map((n) => ({ clave: n.clave, empleado_id: n.empleadoId, fecha: n.fecha, tipo: n.tipo, motivo: motivo?.trim() || null, descartado_por: usuario, descartado_en: en })),
    { onConflict: 'clave' }
  );
  if (error) throw new Error(error.message);
}

export async function restaurarNovedad(clave: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('rrhh_novedades_descartadas').delete().eq('clave', clave);
  if (error) throw new Error(error.message);
}
