import { useEffect, useRef, useState } from 'react';

/**
 * Aviso en vivo de solicitudes de retiro nuevas para RRHH: se monta en la barra de pestañas de RRHH, así funciona en
 * cualquier pestaña del área. Cada 30 s consulta cuántas hay pendientes; si subió, suena un timbre, muestra un cartel y
 * pone el número en el título de la pestaña del navegador. También actualiza el globito de la pestaña "Solicitudes".
 */
const CADA_MS = 30_000;
const TOAST_MS = 12_000;
const PREF_SONIDO = 'rrhh-solicitudes-sonido';

let contexto: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (contexto) return contexto;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  contexto = new Ctor();
  return contexto;
}

async function activar(): Promise<boolean> {
  const c = ctx();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => {});
  return c.state === 'running';
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
function timbre() {
  const c = contexto;
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.02;
  for (const desplazo of [0, 0.7]) {
    nota(c, 660, t + desplazo, 0.18);
    nota(c, 830, t + desplazo + 0.17, 0.18);
    nota(c, 990, t + desplazo + 0.34, 0.3);
  }
}

function sonidoPreferido(): boolean {
  try {
    return localStorage.getItem(PREF_SONIDO) !== '0';
  } catch {
    return true;
  }
}

function actualizarGlobito(n: number) {
  const el = document.getElementById('badge-solicitudes');
  if (!el) return;
  el.textContent = String(n);
  el.classList.toggle('hidden', n <= 0);
}

const TITULO_ORIGINAL = typeof document !== 'undefined' ? document.title : '';
function actualizarTitulo(n: number) {
  document.title = n > 0 ? `(${n}) ${TITULO_ORIGINAL}` : TITULO_ORIGINAL;
}

type EstadoPush = 'cargando' | 'no-soportado' | 'ios-sin-instalar' | 'denegado' | 'inactivo' | 'activo';

function aUint8(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registroPush(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw-push.js');
  await navigator.serviceWorker.ready;
  return reg;
}

export default function AvisoSolicitudes({ inicial }: { inicial: number }) {
  const ultimo = useRef(inicial);
  const [nuevas, setNuevas] = useState<number | null>(null);
  const [audioListo, setAudioListo] = useState(false);
  const [sonido, setSonido] = useState(true);
  const [push, setPush] = useState<EstadoPush>('cargando');
  const [errorPush, setErrorPush] = useState<string | null>(null);
  const [trabajandoPush, setTrabajandoPush] = useState(false);

  // Notificaciones push (llegan con la web cerrada). En iPhone solo existen si la web está instalada en la pantalla de inicio.
  useEffect(() => {
    const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPush(esIOS ? 'ios-sin-instalar' : 'no-soportado');
      return;
    }
    if (Notification.permission === 'denied') {
      setPush('denegado');
      return;
    }
    void navigator.serviceWorker
      .getRegistration('/sw-push.js')
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setPush(sub && Notification.permission === 'granted' ? 'activo' : 'inactivo'))
      .catch(() => setPush('inactivo'));
  }, []);

  async function activarPush() {
    setTrabajandoPush(true);
    setErrorPush(null);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        setPush(permiso === 'denied' ? 'denegado' : 'inactivo');
        return;
      }
      const resClave = await fetch('/api/rrhh-push', { headers: { Accept: 'application/json' } });
      const jsonClave = (await resClave.json()) as { ok: boolean; data?: { clave: string }; error?: string };
      if (!jsonClave.ok || !jsonClave.data) throw new Error(jsonClave.error ?? 'No se pudo obtener la clave de notificaciones.');
      const reg = await registroPush();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aUint8(jsonClave.data.clave) }));
      const res = await fetch('/api/rrhh-push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? 'No se pudo activar.');
      setPush('activo');
    } catch (err) {
      setErrorPush(err instanceof Error ? err.message : 'No se pudo activar.');
    } finally {
      setTrabajandoPush(false);
    }
  }

  async function desactivarPush() {
    setTrabajandoPush(true);
    setErrorPush(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/rrhh-push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
      }
      setPush('inactivo');
    } catch (err) {
      setErrorPush(err instanceof Error ? err.message : 'No se pudo desactivar.');
    } finally {
      setTrabajandoPush(false);
    }
  }

  useEffect(() => {
    setSonido(sonidoPreferido());
    actualizarTitulo(inicial);
  }, [inicial]);

  // El navegador no deja sonar hasta que se toca la pantalla una vez: se intenta al cargar y en el primer toque.
  useEffect(() => {
    const revisar = () => setAudioListo(contexto?.state === 'running');
    const intentar = () => void activar().then(revisar);
    intentar();
    document.addEventListener('pointerdown', intentar, true);
    document.addEventListener('keydown', intentar, true);
    return () => {
      document.removeEventListener('pointerdown', intentar, true);
      document.removeEventListener('keydown', intentar, true);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function consultar() {
      try {
        const res = await fetch('/api/rrhh-solicitudes-pendientes', { headers: { Accept: 'application/json' } });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
        const json = (await res.json()) as { ok: boolean; data?: { pendientes: number } };
        if (cancelado || !json.ok || json.data === undefined) return;
        const n = json.data.pendientes;
        if (n > ultimo.current) {
          setNuevas(n - ultimo.current);
          if (sonidoPreferido()) timbre();
        }
        ultimo.current = n;
        actualizarGlobito(n);
        actualizarTitulo(n);
      } catch {
        // Sin red o servidor caído: se reintenta en el próximo ciclo, sin avisar nada.
      }
    }
    const t = setInterval(() => void consultar(), CADA_MS);
    const alVolver = () => document.visibilityState === 'visible' && void consultar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      cancelado = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);

  useEffect(() => {
    if (nuevas === null) return;
    const t = setTimeout(() => setNuevas(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [nuevas]);

  function alternarSonido() {
    const nuevo = !sonido;
    setSonido(nuevo);
    try {
      localStorage.setItem(PREF_SONIDO, nuevo ? '1' : '0');
    } catch {
      // Sin localStorage: vale solo para esta carga de la página.
    }
    if (nuevo) void activar().then((ok) => ok && timbre());
  }

  return (
    <>
      {nuevas !== null && (
        <a
          href="/rrhh/solicitudes"
          className="fixed bottom-4 right-4 z-[150] flex max-w-sm items-center gap-3 rounded-xl border border-amber-500/60 bg-slate-900 px-4 py-3 shadow-xl hover:bg-slate-800"
        >
          <span className="text-2xl">🔔</span>
          <span className="text-sm text-slate-100">
            <span className="block font-semibold">{nuevas === 1 ? 'Nueva solicitud de retiro' : `${nuevas} solicitudes nuevas de retiro`}</span>
            <span className="text-xs text-slate-400">Tocá para verla en RRHH &gt; Solicitudes</span>
          </span>
        </a>
      )}
      {/* Controles fijos abajo a la izquierda: timbre en esta pestaña y notificaciones push al celular/compu. */}
      <div className="fixed bottom-4 left-4 z-[140] flex max-w-[18rem] flex-col items-start gap-1.5">
        {errorPush && <p className="rounded-lg border border-red-900 bg-red-950/90 px-3 py-1.5 text-xs text-red-300">{errorPush}</p>}
        {push === 'denegado' && (
          <p className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-300">
            Las notificaciones están bloqueadas. Habilitalas en los ajustes del navegador (candado junto a la dirección) y recargá.
          </p>
        )}
        {push === 'ios-sin-instalar' && (
          <p className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-300">
            📱 En iPhone: abrí la web en Safari, tocá Compartir → "Agregar a pantalla de inicio" y abrila desde ahí para recibir notificaciones.
          </p>
        )}
        {(push === 'inactivo' || push === 'activo') && (
          <button
            type="button"
            disabled={trabajandoPush}
            onClick={() => void (push === 'activo' ? desactivarPush() : activarPush())}
            className="rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 shadow hover:border-amber-500 disabled:opacity-60"
            title={push === 'activo' ? 'Este dispositivo recibe avisos de solicitudes nuevas' : 'Recibir un aviso en este dispositivo cuando llegue una solicitud (aunque la web esté cerrada)'}
          >
            {trabajandoPush ? 'Un momento...' : push === 'activo' ? '📲 Notificaciones activadas (tocá para apagar)' : '📲 Activar notificaciones en este dispositivo'}
          </button>
        )}
        <button
          type="button"
          onClick={alternarSonido}
          title={sonido ? 'Apagar el timbre de solicitudes nuevas' : 'Activar el timbre de solicitudes nuevas'}
          className="rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 shadow hover:border-amber-500"
        >
          {sonido ? (audioListo ? '🔔 Timbre activado' : '🔔 Tocá la pantalla para activar el timbre') : '🔕 Timbre apagado'}
        </button>
      </div>
    </>
  );
}
