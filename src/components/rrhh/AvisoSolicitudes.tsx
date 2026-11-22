import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activarAudio, activarPush, estadoPushInicial, sonidoPreferido, timbre } from './solicitudes-avisos';

/**
 * Aviso en vivo de solicitudes de retiro nuevas para RRHH: se monta en la barra de pestañas de RRHH, así funciona en
 * cualquier pestaña del área. Cada 30 s consulta cuántas hay pendientes; si subió, suena un timbre, muestra un cartel y
 * pone el número en el título de la pestaña del navegador. También actualiza el globito de la pestaña "Solicitudes".
 * No dibuja controles: el timbre y las notificaciones se configuran en la pestaña Solicitudes (AvisosPanel).
 */
const CADA_MS = 15_000;
const TOAST_MS = 12_000;
/** Si dijo "Ahora no", no se le vuelve a ofrecer activar las notificaciones durante este tiempo. */
const OCULTAR_OFERTA_MS = 7 * 24 * 60 * 60 * 1000;
const PREF_OFERTA = 'rrhh-push-oferta-oculta';

function ofertaOculta(): boolean {
  try {
    const t = Number(localStorage.getItem(PREF_OFERTA) ?? 0);
    return Date.now() - t < OCULTAR_OFERTA_MS;
  } catch {
    return false;
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

export default function AvisoSolicitudes({ inicial, ultima }: { inicial: number; ultima: string | null }) {
  /** Creación de la solicitud más reciente que esta pantalla ya conoce: todo lo posterior es nuevo. */
  const ultimaVista = useRef<string | null>(ultima);
  const [nuevas, setNuevas] = useState<number | null>(null);
  const [ofrecerPush, setOfrecerPush] = useState(false);
  const [activando, setActivando] = useState(false);
  const [errorOferta, setErrorOferta] = useState<string | null>(null);

  // Al entrar a RRHH > Solicitudes se ofrece activar las notificaciones en este dispositivo (si todavía no lo hizo, no las bloqueó y no dijo "Ahora no" hace poco).
  // El permiso del navegador solo se puede pedir desde un toque, por eso es un cartel con botón y no un pedido automático.
  useEffect(() => {
    // Solo en la pestaña Solicitudes: es donde tiene sentido pedirlo. En las demás pestañas el aviso en vivo sigue funcionando igual.
    if (!location.pathname.startsWith('/rrhh/solicitudes') || ofertaOculta()) return;
    void estadoPushInicial().then((e) => setOfrecerPush(e === 'inactivo'));
  }, []);

  async function aceptarOferta() {
    setActivando(true);
    setErrorOferta(null);
    try {
      const estado = await activarPush();
      if (estado === 'activo' || estado === 'denegado') setOfrecerPush(false);
    } catch (err) {
      setErrorOferta(err instanceof Error ? err.message : 'No se pudo activar.');
    } finally {
      setActivando(false);
    }
  }

  function rechazarOferta() {
    try {
      localStorage.setItem(PREF_OFERTA, String(Date.now()));
    } catch {
      // Sin localStorage: se vuelve a ofrecer en la próxima carga.
    }
    setOfrecerPush(false);
  }

  useEffect(() => {
    actualizarTitulo(inicial);
  }, [inicial]);

  // El navegador no deja sonar hasta que se toca la pantalla una vez: se intenta al cargar y en el primer toque.
  useEffect(() => {
    const intentar = () => void activarAudio();
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
        const url = '/api/rrhh-solicitudes-pendientes' + (ultimaVista.current ? `?desde=${encodeURIComponent(ultimaVista.current)}` : '');
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
        const json = (await res.json()) as { ok: boolean; data?: { pendientes: number; ultima: string | null; nuevas: number } };
        if (cancelado || !json.ok || json.data === undefined) return;
        const { pendientes, ultima: ultimaServidor, nuevas: cuantas } = json.data;
        if (cuantas > 0) {
          setNuevas((previas) => (previas ?? 0) + cuantas);
          if (sonidoPreferido()) timbre();
        }
        if (ultimaServidor && (!ultimaVista.current || ultimaServidor > ultimaVista.current)) ultimaVista.current = ultimaServidor;
        actualizarGlobito(pendientes);
        actualizarTitulo(pendientes);
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

  // El cartel se apaga a los 12 s, pero contados desde que la pestaña se ve: si llegó con la pestaña en segundo plano, está esperando cuando volvés.
  useEffect(() => {
    if (nuevas === null) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const iniciar = () => {
      clearTimeout(t);
      t = setTimeout(() => setNuevas(null), TOAST_MS);
    };
    if (document.visibilityState === 'visible') iniciar();
    const alVer = () => document.visibilityState === 'visible' && iniciar();
    document.addEventListener('visibilitychange', alVer);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', alVer);
    };
  }, [nuevas]);

  if (nuevas === null && !ofrecerPush) return null;
  // Va al <body>: la cabecera de pestañas es translúcida (backdrop-filter) y ahí un cartel "fixed" quedaría pegado a la cabecera.
  return createPortal(
    <div className="fixed inset-x-4 bottom-4 z-[150] flex flex-col items-end gap-3 sm:inset-x-auto sm:right-4 sm:w-96">
      {ofrecerPush && (
        <div className="w-full rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
          <p className="text-sm font-semibold text-slate-100">¿Querés recibir avisos en este dispositivo?</p>
          <p className="mt-1 text-xs text-slate-400">Te mandamos una notificación cuando un empleado pide un retiro anticipado, aunque tengas la web cerrada.</p>
          {errorOferta && <p className="mt-2 rounded border border-red-900 bg-red-950/50 px-3 py-1.5 text-xs text-red-300">{errorOferta}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={activando}
              onClick={() => void aceptarOferta()}
              className="flex-1 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {activando ? 'Un momento...' : 'Activar'}
            </button>
            <button
              type="button"
              disabled={activando}
              onClick={rechazarOferta}
              className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
            >
              Ahora no
            </button>
          </div>
        </div>
      )}
      {nuevas !== null && (
        <a
          href="/rrhh/solicitudes"
          className="flex w-full items-center gap-3 rounded-xl border border-amber-500/60 bg-slate-900 px-4 py-3 shadow-xl hover:bg-slate-800"
        >
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="text-sm text-slate-100">
            <span className="block font-semibold">{nuevas === 1 ? 'Nueva solicitud de retiro' : `${nuevas} solicitudes nuevas de retiro`}</span>
            <span className="text-xs text-slate-400">Tocá para verla en RRHH &gt; Solicitudes</span>
          </span>
        </a>
      )}
    </div>,
    document.body
  );
}
