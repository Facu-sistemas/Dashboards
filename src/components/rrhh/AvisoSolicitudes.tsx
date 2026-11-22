import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activarAudio, sonidoPreferido, timbre } from './solicitudes-avisos';

/**
 * Aviso en vivo de solicitudes de retiro nuevas para RRHH: se monta en la barra de pestañas de RRHH, así funciona en
 * cualquier pestaña del área. Cada 30 s consulta cuántas hay pendientes; si subió, suena un timbre, muestra un cartel y
 * pone el número en el título de la pestaña del navegador. También actualiza el globito de la pestaña "Solicitudes".
 * No dibuja controles: el timbre y las notificaciones se configuran en la pestaña Solicitudes (AvisosPanel).
 */
const CADA_MS = 30_000;
const TOAST_MS = 12_000;

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

export default function AvisoSolicitudes({ inicial }: { inicial: number }) {
  const ultimo = useRef(inicial);
  const [nuevas, setNuevas] = useState<number | null>(null);

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

  if (nuevas === null) return null;
  // Va al <body>: la cabecera de pestañas es translúcida (backdrop-filter) y ahí un cartel "fixed" quedaría pegado a la cabecera.
  return createPortal(
    <a
      href="/rrhh/solicitudes"
      className="fixed bottom-4 right-4 z-[150] flex max-w-sm items-center gap-3 rounded-xl border border-amber-500/60 bg-slate-900 px-4 py-3 shadow-xl hover:bg-slate-800"
    >
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
      <span className="text-sm text-slate-100">
        <span className="block font-semibold">{nuevas === 1 ? 'Nueva solicitud de retiro' : `${nuevas} solicitudes nuevas de retiro`}</span>
        <span className="text-xs text-slate-400">Tocá para verla en RRHH &gt; Solicitudes</span>
      </span>
    </a>,
    document.body
  );
}
