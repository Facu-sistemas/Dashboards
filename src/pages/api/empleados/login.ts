import type { APIRoute } from 'astro';
import { z } from 'zod';
import { listCaras } from '@/lib/supabase/fichaje-caras';
import { agruparPersonas, rankingPersonas, MARGEN_RECONOCIMIENTO, UMBRAL_RECONOCIMIENTO } from '@/lib/fichaje-matching';
import { crearToken, EMPLEADO_COOKIE, EMPLEADO_SESION_MINUTOS } from '@/lib/empleado-sesion';
import { jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

/** Cuántos cuadros seguidos tienen que dar la misma persona (el navegador manda varios, el servidor decide). */
const CUADROS = 3;
const descriptorSchema = z.array(z.number().finite()).length(128);
const bodySchema = z.object({ descriptores: z.array(descriptorSchema).length(CUADROS) });

// Freno básico a los intentos (en memoria: alcanza para frenar a quien prueba caras/vectores a mano).
const INTENTOS_MAX = 8;
const VENTANA_MS = 60_000;
const intentos = new Map<string, number[]>();
function demasiadosIntentos(ip: string): boolean {
  const ahora = Date.now();
  const recientes = (intentos.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  recientes.push(ahora);
  intentos.set(ip, recientes);
  return recientes.length > INTENTOS_MAX;
}

// POST /api/empleados/login — el reconocimiento se REPITE en el servidor con las caras registradas (no se confía en
// que el navegador diga quién es): si los 3 cuadros dan la misma persona, bajo el umbral y sin ambigüedad, abre sesión.
export const POST: APIRoute = async (context) => {
  const ip = context.clientAddress || context.request.headers.get('x-forwarded-for') || 'desconocida';
  if (demasiadosIntentos(ip)) return jsonResponse({ ok: false, error: 'Demasiados intentos. Esperá un minuto.' }, { status: 429 });

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, error: 'Datos inválidos' }, { status: 400 });

  try {
    const personas = agruparPersonas(await listCaras());
    const elegidos = parsed.data.descriptores.map((d) => {
      const [mejor, segunda] = rankingPersonas(d, personas);
      const ambigua = !!mejor && !!segunda && segunda.distancia - mejor.distancia < MARGEN_RECONOCIMIENTO;
      return mejor && mejor.distancia <= UMBRAL_RECONOCIMIENTO && !ambigua ? mejor : null;
    });
    const primero = elegidos[0];
    if (!primero || elegidos.some((e) => e?.empleadoId !== primero.empleadoId)) {
      return jsonResponse({ ok: false, error: 'No te pude reconocer. Mirá de frente a la cámara.' }, { status: 401 });
    }

    context.cookies.set(EMPLEADO_COOKIE, crearToken(primero.empleadoId, primero.nombre), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: import.meta.env.PROD,
      maxAge: EMPLEADO_SESION_MINUTOS * 60,
    });
    return jsonResponse({ ok: true, data: { nombre: primero.nombre } });
  } catch (err) {
    console.error('[empleados/login]', err);
    return jsonResponse({ ok: false, error: 'No se pudo iniciar sesión. Probá de nuevo.' }, { status: 500 });
  }
};
