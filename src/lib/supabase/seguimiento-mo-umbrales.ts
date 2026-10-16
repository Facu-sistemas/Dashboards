import { getSupabaseAdminClient } from './admin';
import { UMBRALES_COLCHONES, UMBRALES_LIVING, type SeguimientoUmbrales } from '@/lib/odoo/seguimiento-mo';

/**
 * Umbrales del semáforo de Seguimiento MO (días desde la creación de la MO),
 * editables desde el tab por quien tenga acceso a Producción. Tabla creada a mano en Supabase (no hay
 * migraciones en el repo):
 *
 *   create table seguimiento_mo_umbrales (
 *     grupo text primary key check (grupo in ('colchones','living')),
 *     amarillo_desde integer not null check (amarillo_desde >= 1),
 *     rojo_desde integer not null check (rojo_desde > amarillo_desde),
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table seguimiento_mo_umbrales enable row level security;  -- default-deny, acceso solo vía /api
 *   grant select, insert, update, delete on public.seguimiento_mo_umbrales to service_role;  -- sin esto, "permission denied"
 *
 * Un grupo sin fila usa el default de seguimiento-mo.ts. Si la tabla no
 * existe, las lecturas devuelven `disponible: false` (se usan los defaults y
 * la pantalla avisa que los cambios no se pueden guardar).
 */

export type SeguimientoGrupoKey = 'colchones' | 'living';

export interface UmbralesGuardados {
  disponible: boolean;
  colchones: SeguimientoUmbrales;
  living: SeguimientoUmbrales;
}

export async function getUmbralesSeguimiento(): Promise<UmbralesGuardados> {
  const out: UmbralesGuardados = { disponible: true, colchones: UMBRALES_COLCHONES, living: UMBRALES_LIVING };
  const { data, error } = await getSupabaseAdminClient().from('seguimiento_mo_umbrales').select('grupo, amarillo_desde, rojo_desde');
  if (error) {
    console.error('[seguimiento-mo-umbrales]', error.message);
    return { ...out, disponible: false };
  }
  for (const r of data ?? []) {
    if (r.grupo === 'colchones' || r.grupo === 'living') {
      out[r.grupo as SeguimientoGrupoKey] = { amarilloDesde: Number(r.amarillo_desde), rojoDesde: Number(r.rojo_desde) };
    }
  }
  return out;
}

export async function setUmbralesSeguimiento(grupo: SeguimientoGrupoKey, umbrales: SeguimientoUmbrales, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('seguimiento_mo_umbrales')
    .upsert({
      grupo,
      amarillo_desde: umbrales.amarilloDesde,
      rojo_desde: umbrales.rojoDesde,
      actualizado_por: usuario,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(error.message);
}
