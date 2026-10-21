import { getSupabaseAdminClient } from './admin';
import { configPorDefecto } from '@/lib/rentabilidad/config';
import type { RentabilidadConfig, UmbralesRentabilidad } from '@/lib/rentabilidad/types';

/**
 * Lectura (solo lectura) de la configuración editable del módulo Rentabilidad desde
 * las tablas propias `rentabilidad_configuracion` y `rentabilidad_contribucion_objetivos`
 * (propuesta en src/lib/rentabilidad/schema.sql — NO migrada todavía). Si las tablas
 * no existen o fallan, devuelve los valores por defecto con
 * `disponible: false` y el módulo sigue funcionando.
 */
export async function getRentabilidadConfig(): Promise<RentabilidadConfig> {
  const base = configPorDefecto();
  try {
    const admin = getSupabaseAdminClient();
    const [cfg, objetivos] = await Promise.all([
      admin.from('rentabilidad_configuracion').select('contribucion_objetivo, umbral_verde, umbral_amarillo').eq('id', 1).maybeSingle(),
      admin.from('rentabilidad_contribucion_objetivos').select('categoria, contribucion_objetivo, umbral_verde, umbral_amarillo'),
    ]);
    if (cfg.error || objetivos.error) {
      if (cfg.error) console.warn('[rentabilidad-config]', cfg.error.message);
      if (objetivos.error) console.warn('[rentabilidad-config]', objetivos.error.message);
      return base;
    }
    const global: UmbralesRentabilidad = cfg.data
      ? {
          objetivo: Number(cfg.data.contribucion_objetivo),
          verde: Number(cfg.data.umbral_verde),
          amarillo: Number(cfg.data.umbral_amarillo),
        }
      : base.global;
    const categorias: Record<string, UmbralesRentabilidad> = {};
    for (const o of objetivos.data ?? []) {
      categorias[o.categoria as string] = {
        objetivo: Number(o.contribucion_objetivo),
        verde: Number(o.umbral_verde),
        amarillo: Number(o.umbral_amarillo),
      };
    }
    return { disponible: true, global, categorias };
  } catch (err) {
    console.warn('[rentabilidad-config]', err instanceof Error ? err.message : err);
    return base;
  }
}

/**
 * Parámetros de costeo editables (rentabilidad_parametros_costeo: clave -> valor). Claves usadas:
 * valor_hora_productivo, valor_hora_YYYY_MM, coef_indirecta_no_colchon. Sin tabla = {} (defaults en contribucion.ts).
 */
export async function getParametrosCosteo(): Promise<Record<string, number>> {
  try {
    const { data, error } = await getSupabaseAdminClient().from('rentabilidad_parametros_costeo').select('clave, valor');
    if (error) return {};
    return Object.fromEntries((data ?? []).map((r) => [r.clave as string, Number(r.valor)]));
  } catch {
    return {};
  }
}
