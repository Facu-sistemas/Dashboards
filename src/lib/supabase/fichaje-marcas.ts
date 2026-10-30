import { getSupabaseAdminClient } from './admin';

/**
 * Registro de cada fichada hecha desde un kiosco (cuenta de celular): quién fichó, qué se registró y en qué cuenta.
 * Tabla `fichaje_marcas` — se crea a mano en Supabase. RLS default-deny: único acceso vía estas funciones desde
 * /api routes y páginas del servidor.
 *
 *   create table public.fichaje_marcas (
 *     id uuid primary key default gen_random_uuid(),
 *     empleado_id int not null,
 *     empleado_nombre text not null,
 *     accion text not null check (accion in ('entrada','salida')),
 *     kiosco text not null,
 *     marcado_en timestamptz not null default now()
 *   );
 *   create index fichaje_marcas_marcado_en_idx on public.fichaje_marcas (marcado_en desc);
 *   create index fichaje_marcas_kiosco_idx on public.fichaje_marcas (kiosco, marcado_en desc);
 *   alter table public.fichaje_marcas enable row level security;
 *   grant select, insert on public.fichaje_marcas to service_role;
 */

export interface MarcaFichaje {
  id: string;
  empleadoId: number;
  empleadoNombre: string;
  accion: 'entrada' | 'salida';
  kiosco: string;
  marcadoEn: string;
}

export async function registrarMarca(marca: { empleadoId: number; empleadoNombre: string; accion: 'entrada' | 'salida'; kiosco: string }): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('fichaje_marcas').insert({
    empleado_id: marca.empleadoId,
    empleado_nombre: marca.empleadoNombre,
    accion: marca.accion,
    kiosco: marca.kiosco,
  });
  if (error) throw new Error(error.message);
}

/** Últimas fichadas, las más nuevas primero. */
export async function listMarcasRecientes(limite = 300): Promise<MarcaFichaje[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('fichaje_marcas')
    .select('id, empleado_id, empleado_nombre, accion, kiosco, marcado_en')
    .order('marcado_en', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    empleadoId: r.empleado_id,
    empleadoNombre: r.empleado_nombre,
    accion: r.accion,
    kiosco: r.kiosco,
    marcadoEn: r.marcado_en,
  }));
}

export interface UltimaMarca {
  kiosco: string;
  marcadoEn: string;
}

export interface UltimasDePersona {
  empleadoId: number;
  empleadoNombre: string;
  entrada: UltimaMarca | null;
  salida: UltimaMarca | null;
}

const PAGINA = 1000;
const MAX_FILAS_ULTIMAS = 10000;

/**
 * Por cada persona, dónde y cuándo fue su última entrada y su última salida. Se arma leyendo las marcas más nuevas
 * (PostgREST no ofrece "distinct on"): alguien sin fichadas dentro de esa ventana figura sin datos.
 */
export async function listUltimasPorEmpleado(): Promise<UltimasDePersona[]> {
  const admin = getSupabaseAdminClient();
  const porEmpleado = new Map<number, UltimasDePersona>();
  for (let desde = 0; desde < MAX_FILAS_ULTIMAS; desde += PAGINA) {
    const { data, error } = await admin
      .from('fichaje_marcas')
      .select('empleado_id, empleado_nombre, accion, kiosco, marcado_en')
      .order('marcado_en', { ascending: false })
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const persona = porEmpleado.get(r.empleado_id) ?? { empleadoId: r.empleado_id, empleadoNombre: r.empleado_nombre, entrada: null, salida: null };
      // Vienen de la más nueva a la más vieja: la primera de cada tipo es la última.
      if (r.accion === 'entrada' && !persona.entrada) persona.entrada = { kiosco: r.kiosco, marcadoEn: r.marcado_en };
      if (r.accion === 'salida' && !persona.salida) persona.salida = { kiosco: r.kiosco, marcadoEn: r.marcado_en };
      porEmpleado.set(r.empleado_id, persona);
    }
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return [...porEmpleado.values()].sort((a, b) => a.empleadoNombre.localeCompare(b.empleadoNombre, 'es'));
}
