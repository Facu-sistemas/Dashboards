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

export default function AvisoSolicitudes({ inicial }: { inicial: number }) {
  const ultimo = useRef(inicial);
  const [nuevas, setNuevas] = useState<number | null>(null);
  const [audioListo, setAudioListo] = useState(false);
  const [sonido, setSonido] = useState(true);

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
      {/* Campanita fija: prender/apagar el timbre. Si el navegador todavía bloquea el audio, avisa que hace falta un toque. */}
      <button
        type="button"
        onClick={alternarSonido}
        title={sonido ? 'Apagar el timbre de solicitudes nuevas' : 'Activar el timbre de solicitudes nuevas'}
        className="fixed bottom-4 left-4 z-[140] rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 shadow hover:border-amber-500"
      >
        {sonido ? (audioListo ? '🔔 Timbre activado' : '🔔 Tocá la pantalla para activar el timbre') : '🔕 Timbre apagado'}
      </button>
    </>
  );
}
