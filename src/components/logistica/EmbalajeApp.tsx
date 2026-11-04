import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import type { ApiEnvelope } from '@/components/dashboard/types';
import { embaladoraDe } from '@/lib/embalaje-embaladora';

interface EmbalajeFila {
  barcode: string | null;
  producto: string;
  odoo: number;
  escaneado: number;
  diferencia: number;
  ultimoEscaneo: string | null;
}

interface EmbalajeResult {
  fecha: string;
  desdeHora: string;
  disponible: boolean;
  filas: EmbalajeFila[];
  totalOdoo: number;
  totalEscaneado: number;
  ordenesCerradas: { orden: string; producto: string; barcode: string | null; unidades: number; cerrada: string }[];
  escaneos: { id: number; barcode: string; producto: string | null; usuario: string | null; creado: string }[];
}

interface Aviso {
  ok: boolean;
  texto: string;
  accion?: Envio['accion'];
  producto?: string;
  barcode?: string;
  /** Totales del producto ya refrescados, para confirmar cuántos van. */
  acumulado?: { escaneado: number; odoo: number };
  /** El escaneo se contó pero hay algo para avisar (ej. el producto va por la otra embaladora). */
  advertencia?: string;
}

const REFRESH_MS = 30 * 1000;
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const hora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });

function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

type Envio = { accion: 'escanear' | 'deshacer'; codigo: string } | { accion: 'anular'; id: number };

async function enviar(envio: Envio, fecha: string): Promise<Aviso> {
  try {
    const res = await fetch('/api/embalaje-escaneos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...envio, fecha }),
    });
    const body = (await res.json()) as ApiEnvelope<{ producto: string; barcode?: string }>;
    if (!res.ok || !body.ok || !body.data) return { ok: false, texto: body.error ?? 'No se pudo registrar el escaneo.' };
    return {
      ok: true,
      accion: envio.accion,
      producto: body.data.producto,
      barcode: body.data.barcode,
      texto: `${envio.accion === 'escanear' ? '+1' : envio.accion === 'deshacer' ? '−1' : 'Borrado:'} ${body.data.producto}`.trim(),
    };
  } catch {
    return { ok: false, texto: 'Sin conexión con el servidor. Reintentá el escaneo.' };
  }
}

type Vista = 'todas' | 1 | 2;
const VISTA_KEY = 'embalaje-embaladora';
const AVISO_MS = 2500;
const AVISO_ERROR_MS = 5000;

function Inner() {
  const [fecha, setFecha] = useState(hoyArgentina);
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [vista, setVista] = useState<Vista>('todas');
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // Cada puesto recuerda su embaladora: se elige una vez y queda en ese equipo.
  useEffect(() => {
    try {
      const v = localStorage.getItem(VISTA_KEY);
      if (v === '1') setVista(1);
      else if (v === '2') setVista(2);
    } catch {
      /* sin storage: queda en "todas" */
    }
  }, []);
  const elegirVista = (v: Vista) => {
    setVista(v);
    try {
      localStorage.setItem(VISTA_KEY, String(v));
    } catch {
      /* ignorar */
    }
  };

  const query = useApiQuery<EmbalajeResult>(['embalaje', fecha], `/api/embalaje-escaneos?fecha=${fecha}`);
  const { refetch } = query;
  useEffect(() => {
    const id = setInterval(() => void refetch(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refetch]);

  // El scanner "tipea" en el campo: lo mantenemos siempre enfocado.
  useEffect(() => {
    inputRef.current?.focus();
  }, [enviando]);

  // La confirmación grande se cierra sola; un escaneo nuevo la reemplaza.
  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => setAviso(null), aviso.ok && !aviso.advertencia ? AVISO_MS : AVISO_ERROR_MS);
    return () => clearTimeout(id);
  }, [aviso]);

  const accionar = async (accion: 'escanear' | 'deshacer', cod: string) => {
    const limpio = cod.trim();
    if (!limpio || enviando) return;
    await ejecutar({ accion, codigo: limpio });
  };

  const ejecutar = async (envio: Envio) => {
    if (enviando) return;
    setEnviando(true);
    const res = await enviar(envio, fecha);
    await qc.invalidateQueries({ queryKey: ['embalaje', fecha] });
    // Con los datos ya refrescados: cuántos van de ese producto, para confirmar de un vistazo.
    if (res.ok && res.producto) {
      const datos = qc.getQueryData<EmbalajeResult>(['embalaje', fecha]);
      const fila = datos?.filas.find((f) => f.producto === res.producto || (res.barcode && f.barcode?.toUpperCase() === res.barcode.toUpperCase()));
      if (fila) res.acumulado = { escaneado: fila.escaneado, odoo: fila.odoo };
      if (envio.accion === 'escanear' && vista !== 'todas' && embaladoraDe(res.producto) !== vista) {
        res.advertencia = `Este producto va por la Embaladora ${embaladoraDe(res.producto)}`;
      }
    }
    setAviso(res);
    setEnviando(false);
  };

  // Algunos scanners no mandan Enter al final: si el código queda quieto un instante, se envía solo.
  useEffect(() => {
    if (codigo.trim().length < 4) return;
    const id = setTimeout(() => {
      setCodigo('');
      void accionar('escanear', codigo);
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  const d = query.data;
  const esHoy = fecha === hoyArgentina();

  // Vista de una embaladora: solo sus productos en tarjetas, tabla y listas.
  const visible = (producto: string | null) => vista === 'todas' || !producto || embaladoraDe(producto) === vista;
  const filas = d?.filas.filter((f) => visible(f.producto)) ?? [];
  const ordenes = d?.ordenesCerradas.filter((o) => visible(o.producto)) ?? [];
  const escaneos = d?.escaneos.filter((e) => visible(e.producto)) ?? [];
  const totalOdoo = filas.reduce((s, f) => s + f.odoo, 0);
  const totalEscaneado = filas.reduce((s, f) => s + f.escaneado, 0);

  return (
    <div className="space-y-6">
      <ConfirmacionEscaneo aviso={aviso} onCerrar={() => setAviso(null)} />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Embaladora</span>
        <div className="flex gap-1 rounded border border-slate-700 p-0.5 text-sm">
          {([1, 2, 'todas'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => elegirVista(v)}
              className={`rounded px-4 py-1.5 ${vista === v ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {v === 'todas' ? 'Todas' : `Embaladora ${v}`}
            </button>
          ))}
        </div>
        {vista !== 'todas' && (
          <span className="text-xs text-slate-500">
            {vista === 1 ? 'Bases (color y Olimpo), Pocket y EPS (Magnum, Krom, Jade).' : 'Todo lo que no es Base, Pocket ni EPS.'}
          </span>
        )}
      </div>

      {query.isError && !d && (
        <p className="rounded-lg border border-status-red/50 bg-slate-900 p-4 text-sm text-status-red">
          {query.error instanceof Error ? query.error.message : 'No se pudo cargar el comparativo.'}
        </p>
      )}

      {d && !d.disponible && (
        <p className="rounded-lg border border-status-yellow/50 bg-slate-900 p-4 text-sm text-status-yellow">
          La tabla de escaneos todavía no existe en Supabase: los escaneos no se están guardando. Avisá a sistemas.
        </p>
      )}

      {d && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900">
            <h3 className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-100">
              Cerrado en Odoo ({n0.format(ordenes.length)} órdenes)
            </h3>
            {ordenes.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Todavía no se cerró ninguna orden en este día.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-800/60 overflow-y-auto">
                {ordenes.map((o) => (
                  <li key={o.orden} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-14 shrink-0 tabular-nums text-slate-400">{hora.format(new Date(o.cerrada))}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-100">{o.producto}</span>
                    <span className="hidden font-mono text-xs text-slate-500 sm:inline">{o.orden}</span>
                    <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-slate-100">{n0.format(o.unidades)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900">
            <h3 className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-100">
              Escaneos registrados ({n0.format(escaneos.length)})
            </h3>
            {escaneos.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Todavía no hay escaneos en este día.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-800/60 overflow-y-auto">
                {escaneos.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-14 shrink-0 tabular-nums text-slate-400">{hora.format(new Date(e.creado))}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-100">{e.producto ?? e.barcode}</span>
                    <span className="hidden font-mono text-xs text-slate-500 sm:inline">{e.barcode}</span>
                    {esHoy && (
                      <button
                        type="button"
                        onClick={() => void ejecutar({ accion: 'anular', id: e.id })}
                        disabled={enviando}
                        className="rounded border border-status-red/50 px-2 py-1 text-xs text-status-red hover:bg-slate-800 disabled:opacity-50"
                      >
                        Borrar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-[16rem] flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Escanear código de barras del producto</span>
            <input
              ref={inputRef}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                // El scanner termina con Enter; sin <form> con botón el navegador no lo envía solo.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const c = codigo;
                  setCodigo('');
                  void accionar('escanear', c);
                }
              }}
              onBlur={() => setTimeout(() => inputRef.current?.focus(), 150)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={!esHoy}
              placeholder={esHoy ? 'Apuntá el scanner y disparalo…' : 'Solo se puede escanear en el día de hoy'}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-base text-slate-100 focus:border-status-green focus:outline-none"
            />
          </label>
          <label>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Día</span>
            <input
              type="date"
              value={fecha}
              max={hoyArgentina()}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              onBlur={(e) => e.stopPropagation()}
              className="mt-1 block rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
            />
          </label>
        </div>
        <p
          aria-live="polite"
          className={`mt-2 min-h-[2.5rem] text-4xl font-semibold ${aviso ? (aviso.ok ? 'text-status-green' : 'text-status-red') : 'text-slate-500'}`}
        >
          {aviso ? aviso.texto : 'Esperando escaneo…'}
        </p>
      </div>

      {d && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi label="Cerrado en Odoo" valor={n0.format(totalOdoo)} />
            <Kpi label="Escaneado en embalaje" valor={n0.format(totalEscaneado)} />
            <Kpi
              label="Diferencia"
              valor={`${totalEscaneado - totalOdoo > 0 ? '+' : ''}${n0.format(totalEscaneado - totalOdoo)}`}
              color={totalEscaneado === totalOdoo ? 'text-status-green' : 'text-status-red'}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3 text-right">Odoo</th>
                  <th className="px-4 py-3 text-right">Escaneado</th>
                  <th className="px-4 py-3 text-right">Diferencia</th>
                  <th className="px-4 py-3">Último</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Sin órdenes cerradas ni escaneos en este día.
                    </td>
                  </tr>
                )}
                {filas.map((f) => (
                  <tr key={f.barcode ?? f.producto} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-3 text-slate-100">{f.producto}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{f.barcode ?? 'sin código'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-100">{n0.format(f.odoo)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-100">{n0.format(f.escaneado)}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${f.diferencia === 0 ? 'text-status-green' : 'text-status-red'}`}
                    >
                      {f.diferencia === 0 ? 'OK' : `${f.diferencia > 0 ? '+' : ''}${n0.format(f.diferencia)}`}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{f.ultimoEscaneo ? hora.format(new Date(f.ultimoEscaneo)) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {esHoy && f.barcode && f.escaneado > 0 && (
                        <button
                          type="button"
                          onClick={() => void accionar('deshacer', f.barcode!)}
                          disabled={enviando}
                          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                        >
                          −1
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Odoo: colchones terminados en órdenes de fabricación en estado Hecho, por fecha de finalización del día elegido. «+» = embalaje contó de más; «−» = faltan por
            embalar o por escanear.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
            <DescargarPdf data={d} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Confirmación a pantalla completa para leer a un metro: "+1" gigante y el producto.
 * No bloquea nada: el campo del scanner sigue enfocado y un escaneo nuevo la reemplaza.
 */
function ConfirmacionEscaneo({ aviso, onCerrar }: { aviso: Aviso | null; onCerrar: () => void }) {
  if (!aviso) return null;
  const tono = !aviso.ok ? 'bg-status-red' : aviso.advertencia ? 'bg-status-yellow' : 'bg-status-green';
  return (
    <div
      role="status"
      aria-live="assertive"
      onClick={onCerrar}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-6 p-8 text-center text-white ${tono}`}
    >
      {aviso.ok && aviso.accion ? (
        <>
          <p className="text-[12rem] font-black leading-none tabular-nums">{aviso.accion === 'escanear' ? '+1' : aviso.accion === 'deshacer' ? '−1' : '✓'}</p>
          <p className="max-w-5xl text-5xl font-bold leading-tight">{aviso.producto}</p>
          {aviso.acumulado && (
            <p className="text-3xl font-semibold opacity-90">
              Van {n0.format(aviso.acumulado.escaneado)} escaneados · Odoo {n0.format(aviso.acumulado.odoo)}
            </p>
          )}
          {aviso.advertencia && <p className="rounded-lg bg-black/25 px-6 py-3 text-4xl font-bold">{aviso.advertencia}</p>}
        </>
      ) : (
        <>
          <p className="text-9xl font-black leading-none">✕</p>
          <p className="max-w-5xl text-4xl font-bold leading-tight">{aviso.texto}</p>
        </>
      )}
    </div>
  );
}

function DescargarPdf({ data }: { data: EmbalajeResult }) {
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function descargar() {
    setGenerando(true);
    setError(null);
    try {
      // jsPDF solo se baja cuando se pide el reporte, no pesa en la carga del tab.
      const { generarPdfEmbalaje, nombreArchivoEmbalaje } = await import('./embalaje-pdf');
      generarPdfEmbalaje(data).save(nombreArchivoEmbalaje(data.fecha));
    } catch (e) {
      console.error('[embalaje-pdf]', e);
      setError('No se pudo generar el PDF. Recargá la página e intentá de nuevo.');
    } finally {
      setGenerando(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-status-red">{error}</span>}
      <button
        type="button"
        onClick={descargar}
        disabled={generando}
        className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {generando ? 'Generando…' : 'Descargar resumen PDF'}
      </button>
    </div>
  );
}

function Kpi({ label, valor, color = 'text-slate-100' }: { label: string; valor: string; color?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${color}`}>{valor}</p>
    </div>
  );
}

export default function EmbalajeApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
