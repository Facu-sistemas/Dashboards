import { getSupabaseAdminClient } from './admin';

/**
 * Tarifas con las que se costean las devoluciones, guardadas mes a mes (el
 * flete y el costo por hora cambian y cada resumen mensual tiene que
 * conservar los valores con los que se calculó). Tabla creada a mano en
 * Supabase (no hay migraciones en el repo):
 *
 *   create table costo_devoluciones_tarifas (
 *     mes text primary key check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
 *     costo_hora numeric not null default 0,
 *     viajes numeric not null default 2,
 *     fletes jsonb not null default '{}',   -- { "Córdoba": 45000, ... } por viaje
 *     actualizado_por text,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table costo_devoluciones_tarifas enable row level security;  -- default-deny, acceso solo vía /api
 *   grant select, insert, update, delete on public.costo_devoluciones_tarifas to service_role;  -- sin esto, "permission denied"
 *
 * Si la tabla no existe, las lecturas devuelven `disponible: false` y la
 * pantalla avisa que los valores no se están guardando.
 */

export interface TarifasMes {
  costoHora: number;
  viajes: number;
  /** Costo por viaje de flete, por provincia. */
  fletes: Record<string, number>;
}

export interface TarifasGuardada extends TarifasMes {
  actualizadoPor: string | null;
  updatedAt: string;
}

export interface TarifasGuardadas {
  disponible: boolean;
  porMes: Record<string, TarifasGuardada>;
}

export async function getTarifasGuardadas(): Promise<TarifasGuardadas> {
  const { data, error } = await getSupabaseAdminClient()
    .from('costo_devoluciones_tarifas')
    .select('mes, costo_hora, viajes, fletes, actualizado_por, updated_at');
  if (error) {
    console.error('[costo-devoluciones-tarifas]', error.message);
    return { disponible: false, porMes: {} };
  }
  const porMes: Record<string, TarifasGuardada> = {};
  for (const r of data ?? []) {
    porMes[r.mes as string] = {
      costoHora: Number(r.costo_hora),
      viajes: Number(r.viajes),
      fletes: (r.fletes ?? {}) as Record<string, number>,
      actualizadoPor: (r.actualizado_por as string | null) ?? null,
      updatedAt: r.updated_at as string,
    };
  }
  return { disponible: true, porMes };
}

export async function setTarifasMes(mes: string, tarifas: TarifasMes, usuario: string): Promise<TarifasGuardada> {
  const updatedAt = new Date().toISOString();
  const { error } = await getSupabaseAdminClient()
    .from('costo_devoluciones_tarifas')
    .upsert({
      mes,
      costo_hora: tarifas.costoHora,
      viajes: tarifas.viajes,
      fletes: tarifas.fletes,
      actualizado_por: usuario,
      updated_at: updatedAt,
    });
  if (error) throw new Error(error.message);
  return { ...tarifas, actualizadoPor: usuario, updatedAt };
}
