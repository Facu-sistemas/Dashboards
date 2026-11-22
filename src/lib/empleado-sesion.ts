import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sesión del portal de empleados (/empleados). Es independiente de las cuentas de Supabase: el empleado entra con la
 * cara y la sesión es una cookie firmada (HMAC) con su id de Odoo. Solo servidor.
 */

export const EMPLEADO_COOKIE = 'empleado_sesion';
/** El portal es para mirar datos propios: la sesión es corta, y se vuelve a entrar con la cara. */
export const EMPLEADO_SESION_MINUTOS = 60;

export interface SesionEmpleado {
  empleadoId: number;
  nombre: string;
  /** Epoch ms de vencimiento. */
  exp: number;
}

function secreto(): string {
  // Se puede fijar uno propio con EMPLEADOS_SESSION_SECRET; si no, se deriva de la clave de servicio de Supabase (nunca llega al navegador).
  const s = import.meta.env.EMPLEADOS_SESSION_SECRET || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('Falta EMPLEADOS_SESSION_SECRET (o SUPABASE_SERVICE_ROLE_KEY) para firmar la sesión de empleados');
  return `empleados-portal:${s}`;
}

function firmar(payload: string): string {
  return createHmac('sha256', secreto()).update(payload).digest('base64url');
}

export function crearToken(empleadoId: number, nombre: string): string {
  const sesion: SesionEmpleado = { empleadoId, nombre, exp: Date.now() + EMPLEADO_SESION_MINUTOS * 60_000 };
  const payload = Buffer.from(JSON.stringify(sesion)).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

export function leerToken(token: string | undefined): SesionEmpleado | null {
  if (!token) return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = Buffer.from(firmar(payload));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SesionEmpleado;
    if (typeof s.empleadoId !== 'number' || typeof s.exp !== 'number' || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}
