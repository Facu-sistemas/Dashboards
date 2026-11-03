import { getSupabaseAdminClient } from './admin';

/**
 * Última señal de vida de cada celular de quiosco (cuenta de Fichaje). Tabla `fichaje_kioscos` — se crea a mano en
 * Supabase. RLS default-deny: único acceso vía estas funciones.
 *
 *   create table public.fichaje_kioscos (
 *     kiosco text primary key,
 *     ultimo_latido timestamptz not null default now(),
 *     camara_activa boolean not null default true,
 *     problema text
 *   );
 *   alter table public.fichaje_kioscos enable row level security;
 *   grant select, insert, update on public.fichaje_kioscos to service_role;
 */

export interface KioscoLatido {
  kiosco: string;
  ultimoLatido: string;
  camaraActiva: boolean;
  problema: string | null;
}

export async function registrarLatido(latido: { kiosco: string; camaraActiva: boolean; problema: string | null }): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('fichaje_kioscos').upsert({
    kiosco: latido.kiosco,
    ultimo_latido: new Date().toISOString(),
    camara_activa: latido.camaraActiva,
    problema: latido.problema,
  });
  if (error) throw new Error(error.message);
}

export async function listKioscos(): Promise<KioscoLatido[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.from('fichaje_kioscos').select('kiosco, ultimo_latido, camara_activa, problema').order('kiosco');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ kiosco: r.kiosco, ultimoLatido: r.ultimo_latido, camaraActiva: r.camara_activa, problema: r.problema }));
}
