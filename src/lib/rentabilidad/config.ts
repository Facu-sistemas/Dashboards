import type { RentabilidadConfig, UmbralesRentabilidad } from '@/lib/rentabilidad/types';

/**
 * Valores por defecto del semáforo — los de `configuracion` del proyecto de
 * referencia (adaptame): objetivo 48%, verde >= 48, amarillo >= 42. Se usan
 * cuando las tablas rentabilidad_* (ver schema.sql) no existen o están vacías.
 */
export const UMBRALES_DEFECTO: UmbralesRentabilidad = { objetivo: 48, verde: 48, amarillo: 42 };

export function configPorDefecto(): RentabilidadConfig {
  return { disponible: false, global: { ...UMBRALES_DEFECTO }, categorias: {} };
}

export function umbralesDeCategoria(config: RentabilidadConfig, categoria: string | null | undefined): UmbralesRentabilidad {
  return (categoria && config.categorias[categoria]) || config.global;
}
