import { getSupabaseAdminClient } from './admin';

/**
 * Descriptores faciales (vectores de 128 números, nunca fotos) vinculados a un
 * hr.employee de Odoo. Tabla `fichaje_caras` — se crea a mano en Supabase
 * (SQL en docs/fichaje-caras.sql). RLS default-deny: único acceso vía estas
 * funciones desde /api routes, mismo patrón que vertical-sobrantes.ts.
 */

export interface CaraRegistrada {
  id: string;
  empleadoId: number;
  empleadoNombre: string;
  descriptor: number[];
  creadoEn: string;
}

export async function listCaras(): Promise<CaraRegistrada[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('fichaje_caras')
    .select('id, empleado_id, empleado_nombre, descriptor, creado_en')
    .order('creado_en', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    empleadoId: r.empleado_id,
    empleadoNombre: r.empleado_nombre,
    descriptor: r.descriptor as number[],
    creadoEn: r.creado_en,
  }));
}

export async function crearCaras(empleadoId: number, empleadoNombre: string, descriptores: number[][]): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('fichaje_caras').insert(
    descriptores.map((descriptor) => ({ empleado_id: empleadoId, empleado_nombre: empleadoNombre, descriptor }))
  );
  if (error) throw new Error(error.message);
}

export async function borrarCarasDeEmpleado(empleadoId: number): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('fichaje_caras').delete().eq('empleado_id', empleadoId);
  if (error) throw new Error(error.message);
}
