import { acumuladorVacio, acumular, type Acumulador, type LineaCosteada } from '@/lib/rentabilidad/calc';
import type { RentabilidadConfig } from '@/lib/rentabilidad/types';

export interface Agrupado<K> {
  clave: K;
  acum: Acumulador;
}

/** Agrupa líneas por una clave y acumula venta/cantidad/costos de cada grupo. */
export function acumulado<K>(lineas: LineaCosteada[], claveDe: (l: LineaCosteada) => K, config: RentabilidadConfig): Agrupado<K>[] {
  const mapa = new Map<K, Acumulador>();
  for (const l of lineas) {
    const k = claveDe(l);
    let a = mapa.get(k);
    if (!a) {
      a = acumuladorVacio();
      mapa.set(k, a);
    }
    acumular(a, l, config);
  }
  return [...mapa.entries()].map(([clave, acum]) => ({ clave, acum }));
}
