import { getSupabaseAdminClient } from './admin';

/**
 * Última señal de vida de cada celular de quiosco (cuenta de Fichaje). Tabla `fichaje_kioscos` — se crea a mano en
 * Supabase. RLS default-deny: único acceso vía estas funciones.
 *
 *   create table public.fichaje_kioscos (
 *     kiosco text primary key,
 *     ultimo_latido timestamptz not null default now(),
 *     camara_activa boolean not null default true,
 *     problema text,
 *     bateria int,
 *     cargando boolean
 *   );
 *   -- Si la tabla ya existe (batería de los celulares):
 *   alter table public.fichaje_kioscos add column if not exists bateria int, add column if not exists cargando boolean;
 *   alter table public.fichaje_kioscos enable row level security;
 *   grant select, insert, update on public.fichaje_kioscos to service_role;
 */

export interface KioscoLatido {
  kiosco: string;
  ultimoLatido: string;
  camaraActiva: boolean;
  problema: string | null;
  bateria: number | null;
  cargando: boolean | null;
}

export async function registrarLatido(latido: {
  kiosco: string;
  camaraActiva: boolean;
  problema: string | null;
  bateria: number | null;
  cargando: boolean | null;
}): Promise<void> {
  const admin = getSupabaseAdminClient();
  const base = { kiosco: latido.kiosco, ultimo_latido: new Date().toISOString(), camara_activa: latido.camaraActiva, problema: latido.problema };
  const { error } = await admin.from('fichaje_kioscos').upsert({ ...base, bateria: latido.bateria, cargando: latido.cargando });
  if (!error) return;
  // Las columnas de batería pueden no existir todavía: se reintenta sin ellas para no perder la señal de vida.
  const { error: error2 } = await admin.from('fichaje_kioscos').upsert(base);
  if (error2) throw new Error(error2.message);
}

export async function listKioscos(): Promise<KioscoLatido[]> {
  const admin = getSupabaseAdminClient();
  const completo = await admin.from('fichaje_kioscos').select('kiosco, ultimo_latido, camara_activa, problema, bateria, cargando').order('kiosco');
  if (!completo.error) {
    return (completo.data ?? []).map((r) => ({
      kiosco: r.kiosco,
      ultimoLatido: r.ultimo_latido,
      camaraActiva: r.camara_activa,
      problema: r.problema,
      bateria: r.bateria,
      cargando: r.cargando,
    }));
  }
  const { data, error } = await admin.from('fichaje_kioscos').select('kiosco, ultimo_latido, camara_activa, problema').order('kiosco');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ kiosco: r.kiosco, ultimoLatido: r.ultimo_latido, camaraActiva: r.camara_activa, problema: r.problema, bateria: null, cargando: null }));
}
