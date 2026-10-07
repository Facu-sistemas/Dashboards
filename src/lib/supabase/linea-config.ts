import { getSupabaseAdminClient } from './admin';
import { MESA_CODIGOS, type ModoTap, type ReglaTap } from '../linea-config';

/**
 * Configuración editable del Planificado Línea. Tablas creadas a mano en
 * Supabase (no hay migraciones en el repo):
 *
 *   create table linea_mesas (
 *     codigo text primary key,
 *     activa boolean not null default true,
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   create table linea_tap_reglas (
 *     familia text primary key,
 *     modo text not null check (modo in ('paralelo','serie','excluido')),
 *     mesas text[] not null default '{}',
 *     prioridad integer not null default 1,
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table linea_mesas enable row level security;      -- default-deny, acceso solo vía /api
 *   alter table linea_tap_reglas enable row level security;
 *
 * Una mesa sin fila = activa; una familia sin fila = usa la regla default
 * (REGLAS_DEFAULT). Si las tablas no existen, las lecturas devuelven
 * `disponible: false` y el plan se arma con los defaults.
 */

export interface ConfigLineaGuardada {
  disponible: boolean;
  mesasInactivas: string[];
  reglas: ReglaTap[];
}

export async function getConfigLinea(): Promise<ConfigLineaGuardada> {
  const admin = getSupabaseAdminClient();
  const [mesasRes, reglasRes] = await Promise.all([
    admin.from('linea_mesas').select('codigo, activa'),
    admin.from('linea_tap_reglas').select('familia, modo, mesas, prioridad'),
  ]);
  if (mesasRes.error || reglasRes.error) {
    console.error('[linea-config]', mesasRes.error?.message ?? reglasRes.error?.message);
    return { disponible: false, mesasInactivas: [], reglas: [] };
  }
  return {
    disponible: true,
    mesasInactivas: (mesasRes.data ?? []).filter((r) => r.activa === false).map((r) => r.codigo as string),
    reglas: (reglasRes.data ?? []).map((r) => ({
      familia: r.familia as string,
      modo: r.modo as ModoTap,
      mesas: ((r.mesas ?? []) as string[]).filter((m) => MESA_CODIGOS.includes(m)),
      prioridad: Number(r.prioridad),
    })),
  };
}

export async function setMesaActiva(codigo: string, activa: boolean, usuario: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from('linea_mesas')
    .upsert({ codigo, activa, actualizado_por: usuario, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** `regla = null` borra la regla propia de la familia (vuelve a la default). */
export async function setReglaTap(familia: string, regla: Omit<ReglaTap, 'familia'> | null, usuario: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } =
    regla === null
      ? await admin.from('linea_tap_reglas').delete().eq('familia', familia)
      : await admin.from('linea_tap_reglas').upsert({
          familia,
          modo: regla.modo,
          mesas: regla.mesas,
          prioridad: regla.prioridad,
          actualizado_por: usuario,
          updated_at: new Date().toISOString(),
        });
  if (error) throw new Error(error.message);
}
