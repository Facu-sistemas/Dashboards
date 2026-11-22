import { getSupabaseAdminClient } from './admin';

/**
 * Suscripciones push de RRHH (una por dispositivo). Tabla `rrhh_push_suscripciones` — SQL en docs/rrhh-solicitudes-retiro.sql.
 * RLS default-deny: solo se accede desde el servidor (mismo patrón que fichaje-caras.ts).
 */
export interface SuscripcionPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function guardarSuscripcion(s: SuscripcionPush, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('rrhh_push_suscripciones')
    .upsert({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, usuario }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
}

export async function borrarSuscripcion(endpoint: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().from('rrhh_push_suscripciones').delete().eq('endpoint', endpoint);
  if (error) throw new Error(error.message);
}

export async function listSuscripciones(): Promise<SuscripcionPush[]> {
  const { data, error } = await getSupabaseAdminClient().from('rrhh_push_suscripciones').select('endpoint, p256dh, auth');
  if (error) throw new Error(error.message);
  return (data ?? []) as SuscripcionPush[];
}
