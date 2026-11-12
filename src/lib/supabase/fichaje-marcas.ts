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

export async function registrarMarca(marca: { empleadoId: number; empleadoNombre: string; accion: 'entrada' | 'salida'; kiosco: string; marcadoEn?: string }): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('fichaje_marcas').insert({
    empleado_id: marca.empleadoId,
    empleado_nombre: marca.empleadoNombre,
    accion: marca.accion,
    kiosco: marca.kiosco,
    ...(marca.marcadoEn ? { marcado_en: marca.marcadoEn } : {}),
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

export interface JornadaPersona {
  empleadoId: number;
  empleadoNombre: string;
  /** Día en Argentina, AAAA-MM-DD. */
  dia: string;
  /** Minutos desde la medianoche de la primera entrada del día (null si no hubo). */
  entrada: number | null;
  /** Minutos desde la medianoche de la última salida del día, posterior a la entrada (null si no hubo). */
  salida: number | null;
}

const PARTES_AR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Por persona y día: hora de la primera entrada y de la última salida (hora Argentina) de los últimos `dias` días.
 * Sirve para el ranking de quién entra/sale más temprano o más tarde en promedio.
 */
export async function listJornadas(dias = 90): Promise<JornadaPersona[]> {
  const admin = getSupabaseAdminClient();
  const desdeIso = new Date(Date.now() - dias * 86_400_000).toISOString();
  const mapa = new Map<string, { empleadoId: number; empleadoNombre: string; dia: string; e: number | null; s: number | null }>();
  for (let desde = 0; desde < 50_000; desde += PAGINA) {
    const { data, error } = await admin
      .from('fichaje_marcas')
      .select('empleado_id, empleado_nombre, accion, marcado_en')
      .gte('marcado_en', desdeIso)
      .order('marcado_en', { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const p = Object.fromEntries(PARTES_AR.formatToParts(new Date(r.marcado_en)).map((x) => [x.type, x.value]));
      const dia = `${p.year}-${p.month}-${p.day}`;
      const min = Number(p.hour) * 60 + Number(p.minute);
      const clave = `${r.empleado_id}|${dia}`;
      const j = mapa.get(clave) ?? { empleadoId: r.empleado_id, empleadoNombre: r.empleado_nombre, dia, e: null, s: null };
      // Vienen de la más vieja a la más nueva: la primera entrada se queda, la última salida pisa a las anteriores.
      if (r.accion === 'entrada' && j.e === null) j.e = min;
      if (r.accion === 'salida' && (j.e === null || min >= j.e)) j.s = min;
      mapa.set(clave, j);
    }
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return [...mapa.values()].map((j) => ({ empleadoId: j.empleadoId, empleadoNombre: j.empleadoNombre, dia: j.dia, entrada: j.e, salida: j.s }));
}
