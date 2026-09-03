import { useEffect, useRef, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { MovimientoRow } from './types';

interface Props {
  query: UseQueryResult<MovimientoRow[]>;
}

const ROTATE_MS = 3000;
const RESUME_AFTER_MS = 3500;
const TRANSITION_MS = 500;
const VISIBLE_ROWS = 5;
const ROW_HEIGHT_PX = 40;

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

// Same Buenos Aires pin as LastUpdated.tsx — avoids an SSR (Node, usually
// UTC) vs. client-hydration (browser, Argentina) mismatch on first render.
const dateFmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Vertical ticker: a fixed-height viewport shows `VISIBLE_ROWS` rows at a
 * time and slides up by one row every tick. The rendered list is the data
 * doubled back-to-back so `step` can run from 0 to `movimientos.length`
 * smoothly; once it reaches the end, the transform snaps back to 0 with
 * the CSS transition disabled for that one frame — the classic seamless
 * marquee-loop trick, so the wrap-around is invisible.
 */
export default function MovimientosCarousel({ query }: Props) {
  const movimientos = query.data ?? [];
  const [step, setStep] = useState(0);
  const [withTransition, setWithTransition] = useState(true);
  const [autoPaused, setAutoPaused] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStep(0);
    setWithTransition(true);
  }, [movimientos.length]);

  // Seamless wrap: once the slide reaches the "duplicate" copy of row 0,
  // jump back to the real row 0 with the transition off, then re-enable it
  // for the next tick.
  useEffect(() => {
    if (movimientos.length === 0 || step !== movimientos.length) return;
    const t = setTimeout(() => {
      setWithTransition(false);
      setStep(0);
    }, TRANSITION_MS);
    return () => clearTimeout(t);
  }, [step, movimientos.length]);

  useEffect(() => {
    if (withTransition) return;
    const t = setTimeout(() => setWithTransition(true), 0);
    return () => clearTimeout(t);
  }, [withTransition]);

  useEffect(() => {
    if (autoPaused || movimientos.length <= 1) return;
    const timer = setInterval(() => advance(), ROTATE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPaused, movimientos.length]);

  function advance() {
    setStep((s) => s + 1);
  }

  /** Manual speed-up: jump ahead immediately, pause the automatic rotation, and resume it on its own after a few idle seconds. */
  function handleManualAdvance() {
    advance();
    setAutoPaused(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setAutoPaused(false), RESUME_AFTER_MS);
  }

  const doubled = movimientos.length > 0 ? [...movimientos, ...movimientos] : [];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">Últimos movimientos del depósito</h3>
        <button
          type="button"
          onClick={handleManualAdvance}
          disabled={movimientos.length <= 1}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200 disabled:opacity-40"
          title="Avanzar manualmente"
        >
          Siguiente ▾
        </button>
      </div>

      {query.isLoading ? (
        <div className="h-[200px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : query.isError ? (
        <p className="text-sm text-red-400">No se pudieron cargar los últimos movimientos.</p>
      ) : movimientos.length === 0 ? (
        <p className="text-sm text-slate-500">Sin movimientos registrados.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1fr_1.4fr_auto_auto] gap-3 border-b border-slate-800 px-2 pb-2 text-xs uppercase tracking-wide text-slate-500">
              <span>Producto</span>
              <span>Origen → Destino</span>
              <span>Cantidad</span>
              <span>Fecha</span>
            </div>

            <div
              className="relative overflow-hidden"
              style={{ height: VISIBLE_ROWS * ROW_HEIGHT_PX }}
              onWheel={(e) => {
                if (Math.abs(e.deltaY) < 4) return;
                handleManualAdvance();
              }}
            >
              <div
                style={{
                  transform: `translateY(-${step * ROW_HEIGHT_PX}px)`,
                  transition: withTransition ? `transform ${TRANSITION_MS}ms ease` : 'none',
                }}
              >
                {doubled.map((m, i) => (
                  <div
                    key={`${m.id}-${i}`}
                    className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-3 px-2 text-sm"
                    style={{ height: ROW_HEIGHT_PX }}
                  >
                    <span className="truncate text-slate-200">{m.producto}</span>
                    <span className="truncate text-slate-400">
                      {m.origen} <span className="text-slate-600">→</span> {m.destino}
                    </span>
                    <span className="whitespace-nowrap text-slate-300">
                      {numberFmt.format(m.cantidad)} {m.unidad}
                    </span>
                    <span className="whitespace-nowrap text-slate-500">{dateFmt.format(new Date(m.fecha))}</span>
                  </div>
                ))}
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-slate-900 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-slate-900 to-transparent" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
