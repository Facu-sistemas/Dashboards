import type { Bloque } from '../../lib/multicorte-calc';
import { esDisponible } from '../../lib/multicorte-calc';

/**
 * Side-view (Largo x Alto) diagram of one physical block — port of
 * `draw_block_visualization` from the original Python tool. Same geometry
 * (percent-based column widths, thickness-scaled layer heights) but as
 * plain JSX instead of a generated HTML string. This is a literal geometry
 * diagram (fixed block-color palette, not a themed dashboard chart), so it
 * doesn't use useChartTheme.
 */

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  'verde oscuro': { bg: '#15803d', text: '#ffffff' },
  azul: { bg: '#1d4ed8', text: '#ffffff' },
  blanco: { bg: '#f8fafc', text: '#0f172a' },
  'gris claro': { bg: '#cbd5e1', text: '#0f172a' },
  celeste: { bg: '#38bdf8', text: '#0f172a' },
  amarillo: { bg: '#facc15', text: '#0f172a' },
  'gris oscuro': { bg: '#475569', text: '#ffffff' },
  rosado: { bg: '#f472b6', text: '#ffffff' },
  naranja: { bg: '#fb923c', text: '#ffffff' },
  lila: { bg: '#c084fc', text: '#0f172a' },
  verde: { bg: '#4ade80', text: '#0f172a' },
};

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Fixed px-per-cm (not normalized to a fixed container height) — matches the
// original Python tool's `scale_y = 3.5`. A block's diagram height grows
// with its real height instead of every block being squeezed into the same
// box, which is what made thin layers (3-5cm slices of a 120cm block)
// illegible in the first cut of this component: text was rendered
// regardless of how many pixels tall the layer actually was, producing
// overlapping unreadable labels on any block with many thin layers.
const SCALE_Y = 3.5;
/** Below this many px tall, a layer can't fit readable text at all — just the color + a tooltip. */
const MIN_HEIGHT_FOR_TEXT_PX = 11;
/** Below this many px tall, only the compact one-line label fits (mirrors Python's `is_thin`/`disp_subtitle` thresholds). */
const MIN_HEIGHT_FOR_FULL_LABEL_PX = 20;

export default function MulticorteBlockVisual({ bloque }: { bloque: Bloque }) {
  const style = COLOR_MAP[bloque.colorBloque.toLowerCase()] ?? { bg: '#e2e8f0', text: '#0f172a' };
  const largoBloqueCm = bloque.largoBloqueCm;
  const altoBloqueCm = bloque.altoBloqueCm;
  const diagramHeightPx = altoBloqueCm * SCALE_Y;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <div className="bg-slate-800 px-3 py-1.5 text-center text-xs font-semibold text-slate-100">
        VISTA LATERAL — {bloque.colorBloque.toUpperCase()} (Largo: {fmtNum(largoBloqueCm)} cm × Alto: {fmtNum(altoBloqueCm)} cm × Ancho: {fmtNum(bloque.anchoBloqueCm)} cm)
      </div>
      <div className="flex min-w-[600px]" style={{ height: diagramHeightPx }}>
        {bloque.columnas.map((col, colIdx) => {
          const totalUsedHeight = col.capas.reduce((s, c) => s + c.thicknessCm, 0);
          const scrapAltura = altoBloqueCm - totalUsedHeight;
          const scrapAlturaPx = scrapAltura * SCALE_Y;
          return (
            <div
              key={colIdx}
              className="relative box-border"
              style={{
                width: `${(col.largoColumnaCm / largoBloqueCm) * 100}%`,
                borderRight: colIdx < bloque.columnas.length - 1 ? '3px solid #ef4444' : undefined,
              }}
            >
              {scrapAltura > 0 && (
                <div
                  className="absolute left-0 right-0 top-0 flex items-center justify-center overflow-hidden text-center"
                  title={`${esDisponible(bloque.anchoBloqueCm, largoBloqueCm, scrapAltura) ? 'DISPONIBLE' : 'SCRAP'} (${fmtNum(scrapAltura)} cm)`}
                  style={{
                    height: scrapAlturaPx,
                    background: esDisponible(bloque.anchoBloqueCm, largoBloqueCm, scrapAltura) ? '#e47c5d' : '#fef08a',
                    color: esDisponible(bloque.anchoBloqueCm, largoBloqueCm, scrapAltura) ? '#ffffff' : '#854d0e',
                  }}
                >
                  {scrapAlturaPx >= MIN_HEIGHT_FOR_TEXT_PX && (
                    <span className="px-1 text-[10px] font-bold">
                      {esDisponible(bloque.anchoBloqueCm, largoBloqueCm, scrapAltura) ? 'DISPONIBLE' : 'SCRAP'} ({fmtNum(scrapAltura)} cm)
                    </span>
                  )}
                </div>
              )}
              {col.capas.map((capa, capaIdx) => {
                const topPx = scrapAlturaPx + col.capas.slice(0, capaIdx).reduce((s, c) => s + c.thicknessCm, 0) * SCALE_Y;
                const heightPx = capa.thicknessCm * SCALE_Y;
                return (
                  <div key={capaIdx} className="absolute left-0 right-0" style={{ top: topPx, height: heightPx }}>
                    {capa.packedSlots.map((slot, slotIdx) => {
                      const leftPct = (slot.y / col.largoColumnaCm) * 100;
                      const widthPct = (slot.l / col.largoColumnaCm) * 100;
                      const disponible = slot.isFiller && esDisponible(slot.w, slot.l, capa.thicknessCm);
                      const bg = slot.isFiller ? (disponible ? '#e47c5d' : '#fef08a') : style.bg;
                      const text = slot.isFiller ? (disponible ? '#ffffff' : '#854d0e') : style.text;
                      const compactLabel = slot.isFiller ? (disponible ? 'DISP.' : 'SCRAP') : slot.prod.toUpperCase();
                      const fullLabel = slot.isFiller
                        ? `${disponible ? 'DISPONIBLE' : 'SCRAP'} ${fmtNum(slot.w)}x${fmtNum(slot.l)} cm`
                        : `${slot.prod.toUpperCase()} ${fmtNum(capa.thicknessCm)}x${fmtNum(slot.l)} cm`;
                      return (
                        <div
                          key={slotIdx}
                          title={fullLabel}
                          className="absolute box-border flex items-center justify-center overflow-hidden border border-black/20 px-1 text-center"
                          style={{ left: `${leftPct}%`, top: 0, width: `${widthPct}%`, height: '100%', background: bg, color: text }}
                        >
                          {heightPx >= MIN_HEIGHT_FOR_FULL_LABEL_PX ? (
                            <span className="text-[9px] font-bold leading-tight">{fullLabel}</span>
                          ) : (
                            heightPx >= MIN_HEIGHT_FOR_TEXT_PX && <span className="truncate text-[8px] font-bold leading-none">{compactLabel}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="bg-slate-900 px-3 py-1 text-center text-[11px] text-slate-500">LARGO DEL BLOCK: {fmtNum(largoBloqueCm)} cm</div>
    </div>
  );
}
