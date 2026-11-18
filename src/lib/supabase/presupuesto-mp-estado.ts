import { getSupabaseAdminClient } from './admin';

/**
 * Última versión publicada del tablero "Presupuesto y cumplimiento MP" (una sola fila, id = 1). Tabla creada a mano en
 * Supabase con docs/presupuesto-mp-schema.sql. Ya no hay pantalla para subir el libro: el tablero se cruza con Odoo. Si no existe o está vacía, el tablero usa la foto de src/data/presupuesto-mp.json.
 */
export interface EstadoGuardado {
  datos: unknown;
  actualizadoPor: string | null;
  actualizadoEn: string;
}

export async function leerEstadoPresupuestoMp(): Promise<EstadoGuardado | null> {
  const { data, error } = await getSupabaseAdminClient().from('presupuesto_mp_estado').select('datos, actualizado_por, updated_at').eq('id', 1).maybeSingle();
  if (error) {
    console.error('[presupuesto-mp-estado]', error.message);
    return null;
  }
  return data ? { datos: data.datos, actualizadoPor: data.actualizado_por, actualizadoEn: data.updated_at } : null;
}
