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
 *   alter table embalaje_escaneos enable row level security;  -- default-deny, acceso solo vía /api
 *   grant select, insert, update, delete on public.embalaje_escaneos to service_role;
 *
 * Si la tabla no existe, la lectura devuelve `disponible: false` y la pantalla
 * avisa que los escaneos no se están guardando.
 */

const ARG_UTC_OFFSET_H = 3;
const TABLA = 'embalaje_escaneos';

function limitesDiaIso(fecha: string): [string, string] {
  const hh = String(ARG_UTC_OFFSET_H).padStart(2, '0');
  return [`${fecha}T${hh}:00:00Z`, `${addDaysIso(fecha, 1)}T${hh}:00:00Z`];
}

export interface EscaneoProducto {
  barcode: string;
  producto: string | null;
  cantidad: number;
  ultimo: string;
}

export interface EscaneosDia {
  disponible: boolean;
  porProducto: EscaneoProducto[];
}

export async function getEscaneosDia(fecha: string): Promise<EscaneosDia> {
  const [desde, hasta] = limitesDiaIso(fecha);
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLA)
    .select('barcode, producto, created_at')
    .eq('anulado', false)
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: true })
    .limit(20000);
  if (error) {
    console.error('[embalaje-escaneos]', error.message);
    return { disponible: false, porProducto: [] };
  }
  const acc = new Map<string, EscaneoProducto>();
  for (const r of data ?? []) {
    const barcode = r.barcode as string;
    const prev = acc.get(barcode);
    acc.set(barcode, {
      barcode,
      producto: (r.producto as string | null) ?? prev?.producto ?? null,
      cantidad: (prev?.cantidad ?? 0) + 1,
      ultimo: r.created_at as string,
    });
  }
  return { disponible: true, porProducto: [...acc.values()] };
}

export async function registrarEscaneo(barcode: string, producto: string, usuario: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().from(TABLA).insert({ barcode, producto, usuario });
  if (error) throw new Error(error.message);
}

/** Anula el último escaneo vigente de ese código en el día (el "-1"). Devuelve false si no había ninguno. */
export async function deshacerEscaneo(barcode: string, fecha: string): Promise<boolean> {
  const db = getSupabaseAdminClient();
  const [desde, hasta] = limitesDiaIso(fecha);
  const { data, error } = await db
    .from(TABLA)
    .select('id')
    .eq('barcode', barcode)
    .eq('anulado', false)
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const id = data?.[0]?.id;
  if (id === undefined) return false;
  const { error: e2 } = await db.from(TABLA).update({ anulado: true }).eq('id', id);
  if (e2) throw new Error(e2.message);
  return true;
}
