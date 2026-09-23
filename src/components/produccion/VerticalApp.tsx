import { useEffect, useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import { LOGO_GRIS_PNG_BASE64 } from '../../lib/logos';
import VerticalBlockVisual from './VerticalBlockVisual';
import {
  calcularCobertura,
  distribuirEnBarras,
  variantesPorColor,
  type PiezaNecesaria,
  type SobranteDisponible,
  type BlockCargado,
  type CoberturaColor,
} from '../../lib/vertical-calc';

interface Props {
  dehydratedState?: DehydratedState;
}

interface BlockSpecDto {
  colorBlock: string;
  anchoBlockCm: number;
  largoBlockCm: number;
  altoBlockCm: number;
  densidadBlock: number;
}

interface PlanResponse {
  piezasPorColor: Record<string, PiezaNecesaria[]>;
  sinMatch: string[];
  sobrantesDisponibles: SobranteDisponible[];
  blocks: BlockSpecDto[];
  bloquesCargadosGuardados: Record<string, BlockCargado[]>;
}

interface DiaOption {
  date: string;
  label: string;
  count: number;
  sinAgendar: boolean;
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M20 11a8 8 0 0 0-14.6-4.6M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.6 4.6M20 20v-5h-5" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v6h8V4" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SobranteModal({ onClose }: { onClose: () => void }) {
  const query = useApiQuery<SobranteDisponible[]>(['vertical-sobrantes-inventario'], '/api/vertical-sobrantes');
  const sobrantes = query.data ?? [];

  const porColor = useMemo(() => {
    const map = new Map<string, SobranteDisponible[]>();
    for (const s of sobrantes) {
      const arr = map.get(s.colorBlock) ?? [];
      arr.push(s);
      map.set(s.colorBlock, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sobrantes]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Inventario de sobrante</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <CloseIcon />
          </button>
        </div>

        {query.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {query.isError && <p className="text-sm text-red-400">No se pudo cargar el inventario de sobrante.</p>}
        {!query.isLoading && !query.isError && porColor.length === 0 && <p className="text-sm text-slate-500">No hay sobrante guardado por ahora.</p>}

        <div className="flex flex-col gap-4">
          {porColor.map(([color, rows]) => {
            const total = rows.reduce((sum, r) => sum + r.altoDisponibleCm, 0);
            return (
              <div key={color} className="rounded border border-slate-800">
                <div className="flex items-center justify-between bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-100">
                  <span>{color.toUpperCase()}</span>
                  <span className="text-emerald-400">{total}cm en total</span>
                </div>
                <table className="w-full text-xs text-slate-300">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-normal">Desde</th>
                      <th className="px-3 py-1.5 text-left font-normal">Cara</th>
                      <th className="px-3 py-1.5 text-right font-normal">Alto disponible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-800/60">
                        <td className="px-3 py-1.5">{r.origenFecha}</td>
                        <td className="px-3 py-1.5">
                          {r.anchoBlockCm}x{r.largoBlockCm} cm
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-slate-100">{r.altoDisponibleCm}cm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ColorGroup({
  colorBlock,
  piezas,
  sobrantesDisponibles,
  variantes,
  bloquesCargados,
  onAgregarBlock,
  onQuitarBlock,
}: {
  colorBlock: string;
  piezas: PiezaNecesaria[];
  sobrantesDisponibles: SobranteDisponible[];
  variantes: BlockSpecDto[];
  bloquesCargados: BlockCargado[];
  onAgregarBlock: (block: BlockCargado) => void;
  onQuitarBlock: (index: number) => void;
}) {
  const [variantIndex, setVariantIndex] = useState(0);
  const [cantidad, setCantidad] = useState(1);

  const cobertura: CoberturaColor = useMemo(
    () => calcularCobertura(colorBlock, piezas, sobrantesDisponibles, bloquesCargados),
    [colorBlock, piezas, sobrantesDisponibles, bloquesCargados]
  );

  const distribucion = useMemo(
    () => distribuirEnBarras(colorBlock, piezas, sobrantesDisponibles, bloquesCargados),
    [colorBlock, piezas, sobrantesDisponibles, bloquesCargados]
  );

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/60" open>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-slate-200">
        <span>
          {colorBlock.toUpperCase()} — {piezas.length} corte(s) — necesita <strong>{cobertura.espesorNecesarioCm}cm</strong>, disponible{' '}
          <strong>{cobertura.espesorDisponibleCm}cm</strong>
        </span>
        {cobertura.faltanteCm > 0 ? (
          <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">Faltan {cobertura.faltanteCm}cm</span>
        ) : (
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            Cubierto{cobertura.sobranteResultanteCm ? ` — sobran ${cobertura.sobranteResultanteCm}cm` : ''}
          </span>
        )}
      </summary>

      <div className="border-t border-slate-800 p-4">
        {distribucion.barras.length > 0 ? (
          <div className="mb-3">
            <VerticalBlockVisual colorBlock={colorBlock} barras={distribucion.barras} />
          </div>
        ) : (
          <p className="mb-3 text-xs text-slate-500">Todavía no hay sobrante ni blocks cargados para este color — cargá uno abajo.</p>
        )}

        {distribucion.piezasSinAsignar.length > 0 && (
          <p className="mb-3 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {distribucion.piezasSinAsignar.length} corte(s) sin dónde cortar todavía ({distribucion.piezasSinAsignar[0]!.ubicacion}
            {distribucion.piezasSinAsignar.length > 1 ? `, +${distribucion.piezasSinAsignar.length - 1} más` : ''}) — cargá otro block.
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Block a cargar
            <select
              value={variantIndex}
              onChange={(e) => setVariantIndex(Number(e.target.value))}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              {variantes.map((v, i) => (
                <option key={i} value={i}>
                  {v.anchoBlockCm}x{v.largoBlockCm}x{v.altoBlockCm} cm — densidad {v.densidadBlock}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Cantidad
            <input
              type="number"
              min={1}
              value={cantidad}
              onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={variantes.length === 0}
            onClick={() => {
              const v = variantes[variantIndex];
              if (!v) return;
              onAgregarBlock({
                colorBlock,
                anchoBlockCm: v.anchoBlockCm,
                largoBlockCm: v.largoBlockCm,
                altoBlockCm: v.altoBlockCm,
                densidadBlock: v.densidadBlock,
                cantidad,
              });
            }}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            + Agregar block
          </button>
        </div>

        {bloquesCargados.length > 0 && (
          <ul className="space-y-1 text-xs text-slate-300">
            {bloquesCargados.map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                {b.cantidad}x {b.anchoBlockCm}x{b.largoBlockCm}x{b.altoBlockCm} cm (densidad {b.densidadBlock})
                <button type="button" onClick={() => onQuitarBlock(i)} className="text-red-400 hover:text-red-300">
                  quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

const GRIS_LOGO_ASPECT = 389 / 116; // ancho/alto reales del PNG embebido (mismo logo que multicorte-export.ts)
const LOGO_WIDTH_PT = 90;
const LOGO_HEIGHT_PT = LOGO_WIDTH_PT / GRIS_LOGO_ASPECT;
const MARGEN = 40;

function generadoLabel(): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Generado: ${fmt.format(new Date())}`;
}

interface ResumenColorPdf {
  colorBlock: string;
  aFavorCm: number;
  cargadoAhoraCm: number;
  disponibleCm: number;
  necesarioCm: number;
  estado: string;
  sobraResultanteCm: number | null;
}

function generarPdfResumen(diaLabel: string, resumen: ResumenColorPdf[], sinMatch: string[]): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  doc.addImage(`data:image/png;base64,${LOGO_GRIS_PNG_BASE64}`, 'PNG', MARGEN, MARGEN, LOGO_WIDTH_PT, LOGO_HEIGHT_PT);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('Optimizador Vertical — Resumen de planificación', MARGEN, MARGEN + LOGO_HEIGHT_PT + 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Día planificado: ${diaLabel}`, MARGEN, MARGEN + LOGO_HEIGHT_PT + 38);
  doc.text(generadoLabel(), MARGEN, MARGEN + LOGO_HEIGHT_PT + 52);

  autoTable(doc, {
    startY: MARGEN + LOGO_HEIGHT_PT + 68,
    margin: { left: MARGEN, right: MARGEN },
    head: [['Color', 'A favor (cm)', 'Cargado ahora (cm)', 'Disponible (cm)', 'Necesario (cm)', 'Estado']],
    body: resumen.map((r) => [
      r.colorBlock.toUpperCase(),
      r.aFavorCm.toString(),
      r.cargadoAhoraCm.toString(),
      r.disponibleCm.toString(),
      r.necesarioCm.toString(),
      r.estado,
    ]),
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 5, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;

  if (sinMatch.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(180, 83, 9);
    doc.text('Productos demandados sin match en COMPLETO:', MARGEN, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    for (const p of sinMatch) {
      doc.text(`- ${p}`, MARGEN, y);
      y += 13;
    }
  }

  return doc;
}

function VerticalInner() {
  const diasQuery = useApiQuery<DiaOption[]>(['vertical-dias'], '/api/vertical-dias');
  const dias = diasQuery.data ?? [];

  const [diaFiltro, setDiaFiltro] = useState('');
  const planPath = diaFiltro ? `/api/vertical-plan?date=${diaFiltro}` : '';
  const planQuery = useApiQuery<PlanResponse>(['vertical-plan', diaFiltro], planPath, { enabled: diaFiltro !== '' });

  const piezasPorColor = planQuery.data?.piezasPorColor ?? {};
  const sinMatch = planQuery.data?.sinMatch ?? [];
  const sobrantesDisponibles = planQuery.data?.sobrantesDisponibles ?? [];
  const blocks = planQuery.data?.blocks ?? [];
  const colores = useMemo(() => Object.keys(piezasPorColor).sort(), [piezasPorColor]);

  const [bloquesPorColor, setBloquesPorColor] = useState<Record<string, BlockCargado[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [mostrarSobrante, setMostrarSobrante] = useState(false);

  // El server es la fuente de verdad de "qué se cargó hoy para este color":
  // cada vez que llega un fetch nuevo (cambio de día, Recalcular, o el
  // refetch después de Guardar) se sincroniza acá. Así, si otra persona ya
  // cubrió un color antes, al abrir la pantalla se ve reflejado en vez de
  // arrancar en blanco / en rojo.
  useEffect(() => {
    setBloquesPorColor(planQuery.data?.bloquesCargadosGuardados ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planQuery.dataUpdatedAt, diaFiltro]);

  const coberturas = useMemo(
    () => colores.map((color) => calcularCobertura(color, piezasPorColor[color] ?? [], sobrantesDisponibles, bloquesPorColor[color] ?? [])),
    [colores, piezasPorColor, sobrantesDisponibles, bloquesPorColor]
  );

  const diaLabel = dias.find((d) => d.date === diaFiltro)?.label ?? diaFiltro;

  function exportarPdf() {
    const resumen: ResumenColorPdf[] = coberturas.map((c) => {
      const aFavorCm = sobrantesDisponibles.filter((s) => s.colorBlock === c.colorBlock).reduce((sum, s) => sum + s.altoDisponibleCm, 0);
      return {
        colorBlock: c.colorBlock,
        aFavorCm,
        cargadoAhoraCm: c.espesorDisponibleCm - aFavorCm,
        disponibleCm: c.espesorDisponibleCm,
        necesarioCm: c.espesorNecesarioCm,
        estado: c.faltanteCm > 0 ? `Faltan ${c.faltanteCm}cm` : 'Cubierto',
        sobraResultanteCm: c.sobranteResultanteCm,
      };
    });
    const doc = generarPdfResumen(diaLabel || 'Todos', resumen, sinMatch);
    doc.save(`optimizador-vertical-${diaFiltro || 'resumen'}.pdf`);
  }

  function agregarBlock(color: string, block: BlockCargado) {
    setSaveOk(false);
    setBloquesPorColor((prev) => ({ ...prev, [color]: [...(prev[color] ?? []), block] }));
  }

  function quitarBlock(color: string, index: number) {
    setSaveOk(false);
    setBloquesPorColor((prev) => ({ ...prev, [color]: (prev[color] ?? []).filter((_, i) => i !== index) }));
  }

  async function guardar() {
    if (!diaFiltro) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const coberturasAGuardar = coberturas.filter((c) => c.sobrantesConsumidosIds.length > 0 || (bloquesPorColor[c.colorBlock]?.length ?? 0) > 0);

      if (coberturasAGuardar.length === 0) {
        throw new Error('Cargá al menos un block antes de guardar.');
      }

      const payloadColores = coberturasAGuardar
        .filter((c) => c.caraReferencia !== null)
        .map((c) => ({
          colorBlock: c.colorBlock,
          sobrantesConsumidosIds: c.sobrantesConsumidosIds,
          sobranteResultanteCm: c.sobranteResultanteCm,
          anchoBlockCm: c.caraReferencia!.anchoBlockCm,
          largoBlockCm: c.caraReferencia!.largoBlockCm,
          bloquesCargados: bloquesPorColor[c.colorBlock] ?? [],
        }));

      const res = await fetch('/api/vertical-guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: diaFiltro, colores: payloadColores }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'No se pudo guardar la sesión de corte');
      }
      setSaveOk(true);
      // No hace falta limpiar nada a mano acá: el refetch trae la verdad del
      // server (lo que se acaba de guardar) y el useEffect de arriba
      // sincroniza bloquesPorColor con eso.
      void planQuery.refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar la sesión de corte');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Día de planificación:
            <select
              value={diaFiltro}
              onChange={(e) => setDiaFiltro(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="">Elegí un día...</option>
              {dias.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.label} ({d.count})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void planQuery.refetch()}
            disabled={!diaFiltro}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            <RefreshIcon /> Recalcular
          </button>
          <button
            type="button"
            onClick={() => setMostrarSobrante(true)}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            <BoxIcon /> Sobrante
          </button>
        </div>
        <LastUpdated dataUpdatedAt={planQuery.dataUpdatedAt} />
      </div>

      {mostrarSobrante && <SobranteModal onClose={() => setMostrarSobrante(false)} />}

      {diasQuery.isError && <p className="text-sm text-red-400">No se pudo cargar los días de planificación desde Odoo.</p>}
      {planQuery.isError && <p className="text-sm text-red-400">No se pudo cargar el plan desde Odoo.</p>}

      {!diaFiltro && <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">Elegí un día de planificación para ver qué hay que cortar.</p>}

      {sinMatch.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
          <strong>{sinMatch.length} producto(s) con demanda sin match en COMPLETO:</strong>
          <ul className="ml-4 mt-1 list-disc text-xs">
            {sinMatch.slice(0, 8).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
            {sinMatch.length > 8 && <li>...y {sinMatch.length - 8} más</li>}
          </ul>
        </div>
      )}

      {planQuery.isLoading && <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}

      {diaFiltro && !planQuery.isLoading && !planQuery.isError && colores.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
          No hay demanda que matchee la base técnica para este día.
        </p>
      )}

      {colores.length > 0 && (
        <>
          {colores.map((color) => (
            <ColorGroup
              key={color}
              colorBlock={color}
              piezas={piezasPorColor[color] ?? []}
              sobrantesDisponibles={sobrantesDisponibles}
              variantes={variantesPorColor(
                blocks.map((b) => ({ ...b })),
                color
              )}
              bloquesCargados={bloquesPorColor[color] ?? []}
              onAgregarBlock={(b) => agregarBlock(color, b)}
              onQuitarBlock={(i) => quitarBlock(color, i)}
            />
          ))}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <SaveIcon /> {saving ? 'Guardando…' : 'Guardar sesión de corte'}
            </button>
            <button
              type="button"
              onClick={exportarPdf}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
            >
              <DownloadIcon /> Descargar PDF
            </button>
            {saveOk && <span className="text-xs text-emerald-400">Guardado.</span>}
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island, same pattern as el resto de Producción. */
export default function VerticalApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <VerticalInner />
    </QueryProvider>
  );
}
