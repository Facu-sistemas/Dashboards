/**
 * Cola local de Embalaje para trabajar sin internet: cada acción (escaneo, borrar, pallet) que no llega al
 * servidor queda guardada en el navegador de esa PC y se sube sola, en orden, cuando vuelve la conexión.
 * Cada ítem lleva un `cid` único (el servidor lo usa para no contar dos veces un escaneo que sí llegó pero
 * cuya respuesta se perdió) y la hora real en que se hizo (`ts`), para que el escaneo caiga en el pallet y el
 * horario correctos aunque se suba más tarde.
 */

export type EnvioCola =
  | { accion: 'escanear'; codigo: string; scanner?: 1 | 2; palletId?: number }
  | { accion: 'deshacer'; codigo: string; scanner?: 1 | 2 }
  | { accion: 'anular'; id: number }
  | { accion: 'pallet-iniciar' | 'pallet-terminar'; scanner: 1 | 2 };

export interface ItemCola {
  cid: string;
  ts: number;
  fecha: string;
  envio: EnvioCola;
}

export interface ItemRechazado {
  cid: string;
  ts: number;
  envio: EnvioCola;
  motivo: string;
}

const KEY_COLA = 'embalaje-cola-v1';
const KEY_RECHAZADOS = 'embalaje-rechazados-v1';

function leer<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function guardar(key: string, v: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: la cola vive solo en memoria de la pantalla */
  }
}

export const leerCola = () => leer<ItemCola>(KEY_COLA);
export const guardarCola = (c: ItemCola[]) => guardar(KEY_COLA, c);
export const leerRechazados = () => leer<ItemRechazado>(KEY_RECHAZADOS);
export const guardarRechazados = (r: ItemRechazado[]) => guardar(KEY_RECHAZADOS, r);

export function nuevoCid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Descripción corta de un ítem para mostrarlo en la lista de pendientes / rechazados. */
export function describir(e: EnvioCola): string {
  switch (e.accion) {
    case 'escanear':
      return `+1 ${e.codigo}${e.scanner ? ` (E${e.scanner})` : ''}`;
    case 'deshacer':
      return `−1 ${e.codigo}`;
    case 'anular':
      return 'Borrar un escaneo';
    case 'pallet-iniciar':
      return `Empezar pallet (E${e.scanner})`;
    case 'pallet-terminar':
      return `Terminar pallet (E${e.scanner})`;
  }
}
