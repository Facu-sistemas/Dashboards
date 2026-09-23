import { useEffect, useRef, useState } from 'react';
import type { BarraCorte } from '../../lib/vertical-calc';
import { ESPESOR_MINIMO_CM } from '../../lib/vertical-calc';

/**
 * Vista lateral apilada de las barras físicas (sobrantes + blocks cargados)
 * de un color — mismo lenguaje visual que MulticorteBlockVisual.tsx (capas
 * coloreadas apiladas, texto que se oculta si la franja es muy fina, mismo
 * umbral de legibilidad), pero en una sola columna por barra en vez de
 * columnas-dentro-de-un-block: acá cada barra ES un block/sobrante físico
 * completo, no una subdivisión de uno solo.
 */

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  'gris oscuro': { bg: '#475569', text: '#ffffff' },
  azul: { bg: '#1d4ed8', text: '#ffffff' },
  blanco: { bg: '#f8fafc', text: '#0f172a' },
  'gris claro': { bg: '#cbd5e1', text: '#0f172a' },
  amarillo: { bg: '#facc15', text: '#0f172a' },
  rosado: { bg: '#f472b6', text: '#ffffff' },
  naranja: { bg: '#fb923c', text: '#ffffff' },
};

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const SCALE_Y = 3.5;
const MIN_HEIGHT_FOR_TEXT_PX = 11;
const MIN_HEIGHT_FOR_FULL_LABEL_PX = 20;
const BAR_WIDTH_PX = 150;

/** Profundidad visual del box (eje "largo" del block) — no está a escala real, es solo el cue de profundidad para que se lea como un prisma parado, no una barra plana. */
const DEPTH_PX = 34;
/** Ángulo fijo de vista (isométrica-ish, front-top-right) — sin interacción, sin cámara, puro CSS 3D estático. */
const SCENE_ROTATE = 'rotateX(-18deg) rotateY(-28deg)';
const TOP_FACE_COLOR = '#e2e8f0';
const RIGHT_FACE_COLOR = '#94a3b8';
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

export default function VerticalBlockVisual({ colorBlock, barras }: { colorBlock: string; barras: BarraCorte[] }) {
  const style = COLOR_MAP[colorBlock.toLowerCase()] ?? { bg: '#e2e8f0', text: '#0f172a' };
  const maxAlturaCm = Math.max(...barras.map((b) => b.alturaCm), 1);
  const diagramHeightPx = maxAlturaCm * SCALE_Y;

  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);

  // React adjunta onWheel como passive por default (no se puede preventDefault
  // ahí sin que el navegador tire un warning e ignore el preventDefault) —
  // por eso el listener se agrega a mano con { passive: false }, solo
  // mientras el mouse está sobre el diagrama, para no robarle el scroll a la
  // página cuando el usuario simplemente está bajando por la pantalla.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (1 - e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <div className="flex items-center justify-between bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100">
        <span>BLOCK — {colorBlock.toUpperCase()}</span>
        <span className="flex items-center gap-2 font-normal text-slate-400">
          Scroll para zoom ({Math.round(zoom * 100)}%)
          {zoom !== 1 && (
            <button type="button" onClick={() => setZoom(1)} className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] hover:border-slate-400">
              Reset
            </button>
          )}
        </span>
      </div>
      <div ref={viewportRef} className="max-h-[70vh] overflow-auto" style={{ perspective: 900 }}>
        <div
          className="flex items-end gap-8 p-6"
          style={{ minHeight: diagramHeightPx + 40, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        >
        {barras.map((barra, barraIdx) => {
          const alturaBarraPx = barra.alturaCm * SCALE_Y;
          const sobranteEsAprovechable = barra.sobranteCm >= ESPESOR_MINIMO_CM;
          const sobrantePx = barra.sobranteCm * SCALE_Y;
          return (
            <div key={barra.id} className="flex flex-col items-center gap-2">
              <div
                className="relative"
                style={{
                  width: BAR_WIDTH_PX,
                  height: alturaBarraPx,
                  transformStyle: 'preserve-3d',
                  transform: SCENE_ROTATE,
                }}
              >
                {/* cara de arriba: la tapa plana del block */}
                <div
                  className="absolute border border-black/10"
                  style={{
                    width: BAR_WIDTH_PX,
                    height: DEPTH_PX,
                    top: (alturaBarraPx - DEPTH_PX) / 2,
                    left: 0,
                    background: TOP_FACE_COLOR,
                    transform: `rotateX(90deg) translateZ(${alturaBarraPx / 2}px)`,
                  }}
                />
                {/* cara lateral derecha: sombra de profundidad */}
                <div
                  className="absolute border border-black/10"
                  style={{
                    width: DEPTH_PX,
                    height: alturaBarraPx,
                    top: 0,
                    left: (BAR_WIDTH_PX - DEPTH_PX) / 2,
                    background: RIGHT_FACE_COLOR,
                    transform: `rotateY(90deg) translateZ(${BAR_WIDTH_PX / 2}px)`,
                  }}
                />
                {/* cara frontal: acá va el contenido real (capas cortadas) */}
                <div
                  className="absolute inset-0 box-border border border-slate-700"
                  style={{ transform: `translateZ(${DEPTH_PX / 2}px)`, background: '#0f172a' }}
                >
                  {barra.sobranteCm > 0 && (
                  <div
                    className="absolute left-0 right-0 top-0 flex items-center justify-center overflow-hidden text-center"
                    title={`${sobranteEsAprovechable ? 'SOBRANTE APROVECHABLE' : 'SCRAP'} (${fmtNum(barra.sobranteCm)} cm)`}
                    style={{
                      height: sobrantePx,
                      background: sobranteEsAprovechable ? '#e47c5d' : '#fef08a',
                      color: sobranteEsAprovechable ? '#ffffff' : '#854d0e',
                    }}
                  >
                    {sobrantePx >= MIN_HEIGHT_FOR_TEXT_PX && (
                      <span className="px-1 text-[10px] font-bold">
                        {sobranteEsAprovechable ? 'SOBRA' : 'SCRAP'} ({fmtNum(barra.sobranteCm)} cm)
                      </span>
                    )}
                  </div>
                )}
                {barra.capas.map((capa, capaIdx) => {
                  const topPx = sobrantePx + barra.capas.slice(0, capaIdx).reduce((s, c) => s + c.pieza.corteAnchoCm, 0) * SCALE_Y;
                  const heightPx = capa.pieza.corteAnchoCm * SCALE_Y;
                  const bg = capa.advertenciaNoEntra ? '#fecaca' : style.bg;
                  const text = capa.advertenciaNoEntra ? '#7f1d1d' : style.text;
                  const fullLabel = `${capa.pieza.ubicacion} — ${fmtNum(capa.pieza.corteAnchoCm)} cm`;
                  return (
                    <div
                      key={capaIdx}
                      title={`${capa.pieza.producto} — ${fullLabel}${capa.advertenciaNoEntra ? ' — NO ENTRA EN LA CARA DEL BLOCK' : ''}`}
                      className="absolute left-0 right-0 box-border flex items-center justify-center overflow-hidden border border-black/20 px-1 text-center"
                      style={{ top: topPx, height: heightPx, background: bg, color: text }}
                    >
                      {heightPx >= MIN_HEIGHT_FOR_FULL_LABEL_PX ? (
                        <span className="text-[9px] font-bold leading-tight">
                          {fullLabel}
                          {capa.advertenciaNoEntra ? ' ⚠️' : ''}
                        </span>
                      ) : (
                        heightPx >= MIN_HEIGHT_FOR_TEXT_PX && <span className="truncate text-[8px] font-bold leading-none">{capa.pieza.ubicacion}</span>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>
              <div className="text-[10px] text-slate-500">
                {barra.origen === 'sobrante' ? 'Sobrante anterior' : `Block #${barraIdx + 1}`} — {fmtNum(barra.alturaCm)} cm
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
