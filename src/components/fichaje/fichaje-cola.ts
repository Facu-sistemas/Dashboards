import { RespuestaNoJsonError } from '@/lib/respuesta-no-json';
import { marcarEnOdoo } from './fichaje-shared';

/**
 * Cola de fichadas hechas sin internet. El celular guarda a quién fichó y a qué hora; cuando vuelve la conexión las manda
 * en orden y Odoo decide entrada o salida según el estado de cada persona, igual que con una fichada normal. La hora real
 * viaja con cada una para que la asistencia no quede registrada a la hora de llegada.
 */
const CLAVE = 'fichaje-cola';
/** Una segunda fichada de la misma persona dentro de este lapso, sin internet, se toma como un toque repetido. */
const REPETIDA_MS = 60_000;

export interface FichadaPendiente {
  empleadoId: number;
  nombre: string;
  tomadoEn: string;
}

export function leerCola(): FichadaPendiente[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as unknown;
    return Array.isArray(crudo) ? (crudo as FichadaPendiente[]) : [];
  } catch {
    return [];
  }
}

function guardar(cola: FichadaPendiente[]): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(cola));
  } catch {
    // Sin localStorage la cola no puede persistir: las fichadas quedan solo en esta sesión de la página.
  }
}

/** Red caída: fetch rechaza con TypeError (sin respuesta del servidor) o se cortó por tiempo. */
export function esFalloDeRed(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'));
}

/** Agrega una fichada a la cola. Devuelve false si era un toque repetido de la misma persona (no se agrega). */
export function encolar(f: FichadaPendiente): boolean {
  const cola = leerCola();
  const repetida = cola.some((p) => p.empleadoId === f.empleadoId && Date.parse(f.tomadoEn) - Date.parse(p.tomadoEn) < REPETIDA_MS);
  if (repetida) return false;
  guardar([...cola, f]);
  return true;
}

let enCurso = false;

export interface ResultadoSync {
  enviadas: number;
  pendientes: number;
  /** Fichadas que el servidor rechazó de forma definitiva (p. ej. empleado dado de baja): se descartan con este motivo. */
  descartadas: string[];
}

/**
 * Manda la cola en orden. Se corta en la primera que falle por red o por el servidor caído (se reintenta después); si
 * el servidor la rechaza con un mensaje, se descarta y se sigue con la siguiente.
 */
export async function sincronizarCola(): Promise<ResultadoSync> {
  const resultado: ResultadoSync = { enviadas: 0, pendientes: leerCola().length, descartadas: [] };
  if (enCurso) return resultado;
  enCurso = true;
  try {
    for (;;) {
      const [primera, ...resto] = leerCola();
      if (!primera) break;
      try {
        await marcarEnOdoo(primera.empleadoId, primera.tomadoEn);
        resultado.enviadas += 1;
      } catch (err) {
        if (esFalloDeRed(err) || err instanceof RespuestaNoJsonError) break;
        resultado.descartadas.push(`${primera.nombre}: ${(err as Error).message}`);
      }
      guardar(resto);
    }
  } finally {
    enCurso = false;
  }
  resultado.pendientes = leerCola().length;
  return resultado;
}
