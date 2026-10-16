import { getSupabaseAdminClient } from './admin';

/**
 * Parámetros editables del indicador CNC por nota de N/C (¿cuenta?, flete extra,
 * horas por caso, % del importe). Valen para todos los usuarios y para todos los
 * meses. Tabla creada a mano en Supabase (no hay migraciones en el repo):
 *
 *   create table cnc_parametros (
 *     nota text primary key,
 *     cuenta boolean not null,
 *     flete boolean not null,
 *     horas numeric not null default 0,
 *     pct numeric not null default 0,
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table cnc_parametros enable row level security;  -- default-deny, acceso solo vía /api
 *   grant select, insert, update, delete on public.cnc_parametros to service_role;  -- sin esto, "permission denied"
 *
 * Si la tabla no existe, la lectura devuelve `disponible: false` y la pantalla
 * avisa que los cambios no se están guardando.
 */

export interface CncParametro {
  cuenta: boolean;
  flete: boolean;
  horas: number;
  pct: number;
}

export interface CncParametrosGuardados {
  disponible: boolean;
  params: Record<string, CncParametro>;
}

export async function getCncParametros(): Promise<CncParametrosGuardados> {
  const { data, error } = await getSupabaseAdminClient().from('cnc_parametros').select('nota, cuenta, flete, horas, pct');
  if (error) {
    console.error('[cnc-parametros]', error.message);
    return { disponible: false, params: {} };
  }
  const params: Record<string, CncParametro> = {};
  for (const r of data ?? []) {
    params[r.nota as string] = {
      cuenta: !!r.cuenta,
      flete: !!r.flete,
      horas: Number(r.horas),
      pct: Number(r.pct),
    };
  }
  return { disponible: true, params };
}

export async function setCncParametro(nota: string, p: CncParametro, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('cnc_parametros')
    .upsert({ nota, ...p, actualizado_por: usuario, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
