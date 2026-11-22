import { borrarSuscripcion, listSuscripciones, type SuscripcionPush } from '@/lib/supabase/rrhh-push';

/**
 * Notificaciones push para RRHH (llegan al celu o la compu aunque la web esté cerrada). Necesita VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY y VAPID_SUBJECT (mailto: o https:) en el entorno; sin ellas no hace nada y no rompe lo demás.
 */
export interface PayloadPush {
  titulo: string;
  cuerpo: string;
  url?: string;
  tag?: string;
}

const ESPERA_MAX_MS = 8_000;

export function claveVapidPublica(): string | null {
  return import.meta.env.VAPID_PUBLIC_KEY || null;
}

// web-push 4 es un módulo ESM con exportaciones con nombre (sin export por defecto). Se carga recién al enviar, así un problema
// con la librería nunca afecta a las rutas que solo importan este archivo (por ejemplo, al crear una solicitud).
type WebPush = typeof import('web-push');
let webpush: WebPush | null = null;
async function configurar(): Promise<WebPush | null> {
  if (webpush) return webpush;
  const publica = import.meta.env.VAPID_PUBLIC_KEY;
  const privada = import.meta.env.VAPID_PRIVATE_KEY;
  if (!publica || !privada) return null;
  const lib = await import('web-push');
  lib.setVapidDetails(import.meta.env.VAPID_SUBJECT || 'mailto:sistemas@example.com', publica, privada);
  webpush = lib;
  return lib;
}

async function enviarA(lib: WebPush, s: SuscripcionPush, payload: PayloadPush): Promise<void> {
  try {
    await lib.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: 'high' });
  } catch (err) {
    const codigo = (err as { statusCode?: number }).statusCode;
    // 404/410: el dispositivo se dio de baja o venció la suscripción: se limpia para no insistir.
    if (codigo === 404 || codigo === 410) await borrarSuscripcion(s.endpoint).catch(() => {});
    else console.error('[push-rrhh] no se pudo enviar', codigo ?? '', err instanceof Error ? err.message : err);
  }
}

/** Manda el aviso a todos los dispositivos de RRHH suscriptos. Nunca tira: un fallo de push no puede romper la acción que lo disparó. */
export async function notificarRrhh(payload: PayloadPush): Promise<void> {
  try {
    const lib = await configurar();
    if (!lib) return;
    const suscripciones = await listSuscripciones();
    if (suscripciones.length === 0) return;
    // En un servidor sin estado (Vercel) lo que queda pendiente al responder se corta: se espera acá, con tope.
    await Promise.race([Promise.allSettled(suscripciones.map((s) => enviarA(lib, s, payload))), new Promise((r) => setTimeout(r, ESPERA_MAX_MS))]);
  } catch (err) {
    console.error('[push-rrhh]', err instanceof Error ? err.message : err);
  }
}

/** Notificación de prueba a un solo dispositivo (al activarlas). */
export async function notificarDispositivo(s: SuscripcionPush, payload: PayloadPush): Promise<void> {
  const lib = await configurar();
  if (!lib) return;
  await enviarA(lib, s, payload);
}
