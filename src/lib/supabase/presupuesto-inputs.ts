import { getSupabaseAdminClient } from './admin';

/**
 * Consenso de unidades and TC asumido don't live in Odoo — per
 * INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md section 6, they're
 * monthly business inputs (Producción/Ventas/Dirección consensus; Finanzas'
 * assumed exchange rate for future months). Stored in Supabase, always
 * accessed through the admin client from server-side /api routes (never
 * exposed to the client directly) — same reasoning as
 * src/pages/api/admin/usuarios.ts, but gated on area permission
 * ('finanzas' — the "Compras" area) rather than the 'dev' role, since
 * this is a normal business input, not an admin action. RLS stays
 * default-deny on both
 * tables: no anon/authenticated policies, so there's nothing to get
 * recursion-wrong (the project's known 42P17 RLS gotcha) — the API route
 * is the only access path.
 */

export type BusinessUnit = 'colchones' | 'living';

export interface ConsensoUnidadesRow {
  mes: string; // YYYY-MM
  unidadNegocio: BusinessUnit;
  unidades: number;
}

export interface TcAsumidoRow {
  mes: string; // YYYY-MM
  tc: number;
}

export async function getConsensoUnidades(year: number): Promise<ConsensoUnidadesRow[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('presupuesto_consenso_unidades')
    .select('mes, unidad_negocio, unidades')
    .gte('mes', `${year}-01`)
    .lte('mes', `${year}-12`);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ mes: r.mes, unidadNegocio: r.unidad_negocio, unidades: Number(r.unidades) }));
}

export async function getTcAsumido(year: number): Promise<TcAsumidoRow[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('presupuesto_tc_asumido')
    .select('mes, tc')
    .gte('mes', `${year}-01`)
    .lte('mes', `${year}-12`);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ mes: r.mes, tc: Number(r.tc) }));
}

export async function upsertConsensoUnidades(userId: string, mes: string, unidadNegocio: BusinessUnit, unidades: number): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from('presupuesto_consenso_unidades')
    .upsert({ mes, unidad_negocio: unidadNegocio, unidades, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'mes,unidad_negocio' });
  if (error) throw new Error(error.message);
}

export async function upsertTcAsumido(userId: string, mes: string, tc: number): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from('presupuesto_tc_asumido')
    .upsert({ mes, tc, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'mes' });
  if (error) throw new Error(error.message);
}

export function consensoByMonthUnitMap(rows: ConsensoUnidadesRow[]): Map<string, number> {
  return new Map(rows.map((r) => [`${r.mes}|${r.unidadNegocio}`, r.unidades]));
}

export function tcByMonthMap(rows: TcAsumidoRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.mes, r.tc]));
}
