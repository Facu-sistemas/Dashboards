import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import type { ApiEnvelope } from '@/components/dashboard/types';

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
  disponible: boolean;
  filas: EmbalajeFila[];
  totalOdoo: number;
  totalEscaneado: number;
}

interface Aviso {
  ok: boolean;
  texto: string;
}

const REFRESH_MS = 30 * 1000;
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const hora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });

function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

async function enviar(accion: 'escanear' | 'deshacer', codigo: string, fecha: string): Promise<Aviso> {
  try {
    const res = await fetch('/api/embalaje-escaneos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ accion, codigo, fecha }),
    });
    const body = (await res.json()) as ApiEnvelope<{ producto: string }>;
    if (!res.ok || !body.ok || !body.data) return { ok: false, texto: body.error ?? 'No se pudo registrar el escaneo.' };
    return { ok: true, texto: `${accion === 'escanear' ? '+1' : '−1'} ${body.data.producto}` };
  } catch {
    return { ok: false, texto: 'Sin conexión con el servidor. Reintentá el escaneo.' };
  }
}

function Inner() {
  const [fecha, setFecha] = useState(hoyArgentina);
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

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

  const accionar = async (accion: 'escanear' | 'deshacer', cod: string) => {
    const limpio = cod.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    setAviso(await enviar(accion, limpio, fecha));
    await qc.invalidateQueries({ queryKey: ['embalaje', fecha] });
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

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-[16rem] flex-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Escanear código de barras del producto</span>
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
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-3 text-lg text-slate-100 focus:border-status-green focus:outline-none"
            />
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Día</span>
            <input
              type="date"
              value={fecha}
              max={hoyArgentina()}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              onBlur={(e) => e.stopPropagation()}
              className="mt-1 block rounded-md border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100"
            />
          </label>
        </div>
        <p
          aria-live="polite"
          className={`mt-3 min-h-[1.5rem] text-lg font-semibold ${aviso ? (aviso.ok ? 'text-status-green' : 'text-status-red') : 'text-slate-500'}`}
        >
          {aviso ? aviso.texto : 'Esperando escaneo…'}
        </p>
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
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi label="Cerrado en Odoo" valor={n0.format(d.totalOdoo)} />
            <Kpi label="Escaneado en embalaje" valor={n0.format(d.totalEscaneado)} />
            <Kpi
              label="Diferencia"
              valor={`${d.totalEscaneado - d.totalOdoo > 0 ? '+' : ''}${n0.format(d.totalEscaneado - d.totalOdoo)}`}
              color={d.totalEscaneado === d.totalOdoo ? 'text-status-green' : 'text-status-red'}
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
                {d.filas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Sin órdenes cerradas ni escaneos en este día.
                    </td>
                  </tr>
                )}
                {d.filas.map((f) => (
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
            Odoo: unidades producidas en órdenes de fabricación en estado Hecho, por fecha de finalización. «+» = embalaje contó de más; «−» = faltan por
            embalar o por escanear.
          </p>
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </>
      )}
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
