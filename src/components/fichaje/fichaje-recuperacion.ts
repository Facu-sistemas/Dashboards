/**
 * Recuperación automática del celular de quiosco: si el servidor contesta algo que no es JSON (típico de un deploy en
 * curso), se recarga la página sola. Con tope, para no quedar en un bucle de recargas si el problema es real.
 */
const CLAVE = 'fichaje-recargas';
const MAX_RECARGAS = 3;
const VENTANA_MS = 10 * 60_000;
const ESPERA_MS = 4000;

let programada = false;

function leer(): number[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as unknown;
    return Array.isArray(crudo) ? crudo.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * Programa una recarga en unos segundos. Devuelve false si ya se recargó demasiadas veces en los últimos minutos
 * (el problema persiste: hay que mostrar el aviso en pantalla y no seguir recargando).
 */
export function recargarConTope(): boolean {
  if (programada) return true;
  const ahora = Date.now();
  const recientes = leer().filter((t) => ahora - t < VENTANA_MS);
  if (recientes.length >= MAX_RECARGAS) return false;
  try {
    localStorage.setItem(CLAVE, JSON.stringify([...recientes, ahora]));
  } catch {
    // Sin localStorage no hay tope posible: se recarga una sola vez y se avisa si vuelve a fallar.
    if (recientes.length > 0) return false;
  }
  programada = true;
  setTimeout(() => location.reload(), ESPERA_MS);
  return true;
}
