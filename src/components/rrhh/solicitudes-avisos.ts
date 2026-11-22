/** Utilidades compartidas del aviso de solicitudes nuevas: timbre (WebAudio) y notificaciones push. Solo navegador. */

const PREF_SONIDO = 'rrhh-solicitudes-sonido';

let contexto: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (contexto) return contexto;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  contexto = new Ctor();
  return contexto;
}

/** El navegador no deja sonar hasta que se toca la pantalla una vez: se llama al cargar y en cada toque. */
export async function activarAudio(): Promise<boolean> {
  const c = ctx();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => {});
  return c.state === 'running';
}

export function audioActivo(): boolean {
  return contexto?.state === 'running';
}

function nota(c: AudioContext, frecuencia: number, inicio: number, duracion: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frecuencia, inicio);
  g.gain.setValueAtTime(0.0001, inicio);
  g.gain.exponentialRampToValueAtTime(0.35, inicio + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  osc.connect(g).connect(c.destination);
  osc.start(inicio);
  osc.stop(inicio + duracion + 0.03);
}

/** Timbre de tres notas que suben, dos veces (se nota más que un bip suelto en una oficina). */
export function timbre() {
  const c = contexto;
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.02;
  for (const desplazo of [0, 0.7]) {
    nota(c, 660, t + desplazo, 0.18);
    nota(c, 830, t + desplazo + 0.17, 0.18);
    nota(c, 990, t + desplazo + 0.34, 0.3);
  }
}

export function sonidoPreferido(): boolean {
  try {
    return localStorage.getItem(PREF_SONIDO) !== '0';
  } catch {
    return true;
  }
}

export function guardarSonidoPreferido(valor: boolean) {
  try {
    localStorage.setItem(PREF_SONIDO, valor ? '1' : '0');
  } catch {
    // Sin localStorage: vale solo para esta carga de la página.
  }
}

// ───────────── Push ─────────────

export type EstadoPush = 'cargando' | 'no-soportado' | 'ios-sin-instalar' | 'denegado' | 'inactivo' | 'activo';

function aUint8(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Estado actual de las notificaciones push en este dispositivo. En iPhone solo existen si la web está instalada en la pantalla de inicio. */
export async function estadoPushInicial(): Promise<EstadoPush> {
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return esIOS ? 'ios-sin-instalar' : 'no-soportado';
  if (Notification.permission === 'denied') return 'denegado';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo';
  } catch {
    return 'inactivo';
  }
}

/** Pide permiso, suscribe el dispositivo y lo guarda en el servidor (que manda una notificación de bienvenida). Tiene que llamarse desde un toque. */
export async function activarPush(): Promise<EstadoPush> {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'denegado' : 'inactivo';
  const resClave = await fetch('/api/rrhh-push', { headers: { Accept: 'application/json' } });
  const jsonClave = (await resClave.json()) as { ok: boolean; data?: { clave: string }; error?: string };
  if (!jsonClave.ok || !jsonClave.data) throw new Error(jsonClave.error ?? 'No se pudo obtener la clave de notificaciones.');
  const reg = await navigator.serviceWorker.register('/sw-push.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aUint8(jsonClave.data.clave) }));
  const res = await fetch('/api/rrhh-push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(json.error ?? 'No se pudo activar.');
  return 'activo';
}

export async function desactivarPush(): Promise<EstadoPush> {
  const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/rrhh-push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }
  return 'inactivo';
}
