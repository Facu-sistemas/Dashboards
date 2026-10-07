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

export interface CaraResumen {
  empleadoId: number;
  empleadoNombre: string;
  cantidad: number;
  creadoEn: string;
}

/** Una fila por empleado registrado (sin los vectores): para listar en pantalla y en el admin. */
export async function listCarasResumen(): Promise<CaraResumen[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.from('fichaje_caras').select('empleado_id, empleado_nombre, creado_en').order('creado_en', { ascending: true });
  if (error) throw new Error(error.message);
  const porEmpleado = new Map<number, CaraResumen>();
  for (const r of data ?? []) {
    const actual = porEmpleado.get(r.empleado_id);
    if (actual) actual.cantidad += 1;
    else porEmpleado.set(r.empleado_id, { empleadoId: r.empleado_id, empleadoNombre: r.empleado_nombre, cantidad: 1, creadoEn: r.creado_en });
  }
  return [...porEmpleado.values()].sort((a, b) => a.empleadoNombre.localeCompare(b.empleadoNombre));
}

export async function empleadoTieneCaras(empleadoId: number): Promise<boolean> {
  const admin = getSupabaseAdminClient();
  const { count, error } = await admin.from('fichaje_caras').select('id', { count: 'exact', head: true }).eq('empleado_id', empleadoId);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
