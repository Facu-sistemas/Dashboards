import { getSupabaseAdminClient } from './admin';
import { addDaysIso } from '@/lib/date';

/**
 * Escaneos de embalaje: cada lectura del código de barras de un producto suma
 * +1. Logística los compara con lo cerrado en Odoo. Tabla creada a mano en
 * Supabase (no hay migraciones en el repo):
 *
 *   create table embalaje_escaneos (
 *     id bigint generated always as identity primary key,
 *     barcode text not null,
 *     producto text,
 *     usuario text,
 *     anulado boolean not null default false,
 *     created_at timestamptz not null default now()
 *   );
 *   create index on embalaje_escaneos (created_at);
 *   alter table embalaje_escaneos add column anulado_at timestamptz;  -- cuándo se anuló (Borrar / −1)
 *   alter table embalaje_escaneos add column scanner smallint;  -- 1 | 2: cuál de los dos scanners lo leyó (prefijo ZZ1 / ZZ2)
 *   alter table embalaje_escaneos enable row level security;  -- default-deny, acceso solo vía /api
 *   grant select, insert, update, delete on public.embalaje_escaneos to service_role;
 *
 * Si la tabla no existe, la lectura devuelve `disponible: false` y la pantalla
 * avisa que los escaneos no se están guardando.
 */

/**
 * Pallets: cada scanner arma pallets de a uno (Empezar / Terminar). Un escaneo pertenece al pallet de su
 * scanner que estaba abierto cuando se leyó. Tabla creada a mano:
 *
 *   create table embalaje_pallets (
 *     id bigint generated always as identity primary key,
 *     scanner smallint not null,
 *     usuario text,
 *     inicio timestamptz not null default now(),
 *     fin timestamptz
 *   );
 *   create index on embalaje_pallets (inicio);
 *   alter table embalaje_pallets enable row level security;
 *   grant select, insert, update, delete on public.embalaje_pallets to service_role;
 */

const ARG_UTC_OFFSET_H = 3;
const TABLA = 'embalaje_escaneos';

function limitesDiaIso(fecha: string, desde = '00:00'): [string, string] {
  const hh = String(ARG_UTC_OFFSET_H).padStart(2, '0');
  const inicio = new Date(`${fecha}T${desde}:00-0${ARG_UTC_OFFSET_H}:00`).toISOString();
  return [inicio, `${addDaysIso(fecha, 1)}T${hh}:00:00Z`];
}

export interface EscaneoProducto {
  barcode: string;
  producto: string | null;
  cantidad: number;
  ultimo: string;
}

export interface EscaneoRegistro {
  id: number;
  barcode: string;
  producto: string | null;
  usuario: string | null;
  /** 1 | 2 según el prefijo que manda cada scanner; null si no se pudo identificar. */
  scanner: number | null;
  creado: string;
}

export interface EscaneoAnuladoRegistro extends EscaneoRegistro {
  /** Cuándo se anuló; null en los que se anularon antes de existir la columna. */
  anuladoAt: string | null;
}

export interface EscaneosDia {
  disponible: boolean;
  porProducto: EscaneoProducto[];
  /** Escaneos individuales vigentes, el más reciente primero (para poder borrar uno). */
  lista: EscaneoRegistro[];
  /** Escaneos anulados del día (no cuentan), el más reciente primero: sirven para auditar qué se borró. */
  anulados: EscaneoAnuladoRegistro[];
}

export async function getEscaneosDia(fecha: string, desdeHora = '00:00'): Promise<EscaneosDia> {
  const [desde, hasta] = limitesDiaIso(fecha, desdeHora);
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLA)
    .select('*')
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: true })
    .limit(20000);
  if (error) {
    console.error('[embalaje-escaneos]', error.message);
    return { disponible: false, porProducto: [], lista: [], anulados: [] };
  }
  const registro = (r: Record<string, unknown>): EscaneoRegistro => ({
    id: Number(r.id),
    barcode: r.barcode as string,
    producto: (r.producto as string | null) ?? null,
    usuario: (r.usuario as string | null) ?? null,
    scanner: (r.scanner as number | null | undefined) ?? null,
    creado: r.created_at as string,
  });
  const anulados = (data ?? [])
    .filter((r) => r.anulado)
    .map((r) => ({ ...registro(r), anuladoAt: (r.anulado_at as string | null | undefined) ?? null }))
    .reverse();
  const vigentes = (data ?? []).filter((r) => !r.anulado);
  const acc = new Map<string, EscaneoProducto>();
  for (const r of vigentes) {
    const barcode = r.barcode as string;
    const prev = acc.get(barcode);
    acc.set(barcode, {
      barcode,
      producto: (r.producto as string | null) ?? prev?.producto ?? null,
      cantidad: (prev?.cantidad ?? 0) + 1,
      ultimo: r.created_at as string,
    });
  }
  const lista = vigentes.map(registro).reverse();
  return { disponible: true, porProducto: [...acc.values()], lista, anulados };
}

export async function registrarEscaneo(barcode: string, producto: string, usuario: string, scanner?: number): Promise<void> {
  const db = getSupabaseAdminClient();
  const { error } = await db.from(TABLA).insert({ barcode, producto, usuario, ...(scanner ? { scanner } : {}) });
  if (!error) return;
  // Si todavía no existe la columna `scanner`, el escaneo se guarda igual (sin saber cuál scanner fue).
  if (scanner && /scanner/i.test(error.message)) {
    const { error: e2 } = await db.from(TABLA).insert({ barcode, producto, usuario });
    if (!e2) return;
    throw new Error(e2.message);
  }
  throw new Error(error.message);
}

/** Lo que se borró: sirve para avisar de qué scanner era. */
export interface EscaneoAnulado {
  scanner: number | null;
}

/** Anula el último escaneo vigente de ese código en el día (el "-1"). Devuelve null si no había ninguno. */
export async function deshacerEscaneo(barcode: string, fecha: string): Promise<EscaneoAnulado | null> {
  const db = getSupabaseAdminClient();
  const [desde, hasta] = limitesDiaIso(fecha);
  const { data, error } = await db
    .from(TABLA)
    .select('*')
    .eq('barcode', barcode)
    .eq('anulado', false)
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const id = data?.[0]?.id;
  if (id === undefined) return null;
  const { error: e2 } = await db.from(TABLA).update({ anulado: true, anulado_at: new Date().toISOString() }).eq('id', id);
  if (e2) throw new Error(e2.message);
  return { scanner: (data?.[0]?.scanner as number | null | undefined) ?? null };
}

/** Anula un escaneo puntual (el que se cargó dos veces, por ejemplo). Devuelve null si ya no estaba vigente. */
export async function anularEscaneo(id: number): Promise<(EscaneoAnulado & { producto: string | null }) | null> {
  const { data, error } = await getSupabaseAdminClient().from(TABLA).update({ anulado: true, anulado_at: new Date().toISOString() }).eq('id', id).eq('anulado', false).select('*');
  if (error) throw new Error(error.message);
  const r = data?.[0];
  if (!r) return null;
  return { scanner: (r.scanner as number | null | undefined) ?? null, producto: (r.producto as string | null) ?? null };
}

export interface PalletRegistro {
  id: number;
  scanner: number;
  inicio: string;
  /** null = abierto (se están sumando colchones). */
  fin: string | null;
}

export async function getPalletsDia(fecha: string): Promise<PalletRegistro[]> {
  const [desde, hasta] = limitesDiaIso(fecha);
  const { data, error } = await getSupabaseAdminClient()
    .from('embalaje_pallets')
    .select('*')
    .gte('inicio', desde)
    .lt('inicio', hasta)
    .order('inicio', { ascending: true })
    .limit(2000);
  if (error) {
    console.error('[embalaje-pallets]', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    scanner: Number(r.scanner),
    inicio: r.inicio as string,
    fin: (r.fin as string | null) ?? null,
  }));
}

export async function iniciarPallet(scanner: number, usuario: string): Promise<void> {
  const db = getSupabaseAdminClient();
  // Un pallet que quedó abierto de un día anterior se cierra solo al empezar el día: la numeración arranca de 1.
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const [inicioHoy] = limitesDiaIso(hoy);
  await db.from('embalaje_pallets').update({ fin: inicioHoy }).eq('scanner', scanner).is('fin', null).lt('inicio', inicioHoy);
  const { data, error } = await db.from('embalaje_pallets').select('id').eq('scanner', scanner).is('fin', null).limit(1);
  if (error) throw new Error('Falta crear la tabla embalaje_pallets en Supabase. Avisá a sistemas.');
  if (data?.length) throw new Error(`El E${scanner} ya tiene un pallet en curso.`);
  const { error: e2 } = await db.from('embalaje_pallets').insert({ scanner, usuario });
  if (e2) throw new Error(e2.message);
}

export async function terminarPallet(scanner: number): Promise<void> {
  const { data, error } = await getSupabaseAdminClient()
    .from('embalaje_pallets')
    .update({ fin: new Date().toISOString() })
    .eq('scanner', scanner)
    .is('fin', null)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(`El E${scanner} no tiene un pallet en curso.`);
}
