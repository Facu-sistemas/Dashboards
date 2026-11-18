import { invalidateByPrefix } from '@/lib/cache';

let ultimo = 0;

/**
 * "Forzar sincronización": descarta las lecturas de Odoo que se guardan unos minutos en memoria para que la próxima
 * lectura vaya directo a Odoo. Se limita a una vez cada 10 s para que nadie dispare lecturas pesadas en ráfaga.
 * Devuelve true si se descartó la caché.
 */
export function forzarSincronizacion(prefijos: string[]): boolean {
  const ahora = Date.now();
  if (ahora - ultimo < 10_000) return false;
  ultimo = ahora;
  for (const p of prefijos) invalidateByPrefix(p);
  return true;
}
