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
  desdeHora: string;
  disponible: boolean;
  filas: EmbalajeFila[];
  totalOdoo: number;
  totalEscaneado: number;
  ordenesCerradas: { orden: string; producto: string; barcode: string | null; unidades: number; cerrada: string }[];
  escaneos: { id: number; barcode: string; producto: string | null; usuario: string | null; scanner: number | null; creado: string; pallet: number | null }[];
  pallets: { id: number; scanner: number; numero: number; inicio: string; fin: string | null; cantidad: number }[];
  anulados: { id: number; barcode: string; producto: string | null; usuario: string | null; scanner: number | null; creado: string; anuladoAt: string | null }[];
}

interface Aviso {
  ok: boolean;
  texto: string;
  accion?: Envio['accion'];
  producto?: string;
  barcode?: string;
  /** Qué scanner leyó (o cuál era el escaneo borrado); null si no se pudo identificar. */
  scanner?: number | null;
  /** Totales del producto ya refrescados, para confirmar cuántos van. */
  acumulado?: { escaneado: number; odoo: number };
  /** Pallet abierto del scanner que leyó, con cuántos lleva; null si no hay pallet en curso. */
  pallet?: { numero: number; cantidad: number } | null;
  /** El escaneo se contó pero hay algo para avisar. */
  advertencia?: string;
}

const REFRESH_MS = 10 * 1000;
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const hora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });

function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

/**
 * Cada scanner se programa para mandar un prefijo antes del código ("E1 " / "E2 ", con espacio): así,
 * aunque los dos sean "teclados" iguales para la PC, sabemos cuál leyó. Se acepta también ZZ1 / ZZ2.
 * Sin prefijo, el escaneo queda sin identificar.
 */
function separarScanner(crudo: string): { codigo: string; scanner?: 1 | 2 } {
  const limpio = crudo.trim();
  const m = /^E([12])\s+(.+)$/i.exec(limpio) ?? /^ZZ([12])\s*(.+)$/i.exec(limpio);
  return m ? { codigo: m[2]!.trim(), scanner: m[1] === '1' ? 1 : 2 } : { codigo: limpio };
}

type Envio =
  | { accion: 'escanear' | 'deshacer'; codigo: string; scanner?: 1 | 2 }
  | { accion: 'anular'; id: number }
  | { accion: 'pallet-iniciar' | 'pallet-terminar'; scanner: 1 | 2 };

async function enviar(envio: Envio, fecha: string): Promise<Aviso> {
  try {
    const res = await fetch('/api/embalaje-escaneos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...envio, fecha }),
    });
    const body = (await res.json()) as ApiEnvelope<{ producto: string; barcode?: string; scanner?: number | null }>;
    if (!res.ok || !body.ok || !body.data) return { ok: false, texto: body.error ?? 'No se pudo registrar el escaneo.' };
    return {
      ok: true,
      accion: envio.accion,
      producto: body.data.producto,
      barcode: body.data.barcode,
      scanner: body.data.scanner ?? null,
      texto: `${envio.accion === 'escanear' ? '+1' : envio.accion === 'deshacer' ? '−1' : 'Borrado:'} ${body.data.producto}`.trim(),
    };
  } catch {
    return { ok: false, texto: 'Sin conexión con el servidor. Reintentá el escaneo.' };
  }
}

const AVISO_MS = 2500;
const AVISO_ERROR_MS = 5000;

function Inner() {
  const [fecha, setFecha] = useState(hoyArgentina);
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const query = useApiQuery<EmbalajeResult>(['embalaje', fecha], `/api/embalaje-escaneos?fecha=${fecha}`);
  const { refetch } = query;
  // Reloj para el "actualizado hace N s" (el refresco de datos va aparte, cada REFRESH_MS).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
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
    if (!cod.trim() || enviando) return;
    // El −1 de la tabla manda el código del producto tal cual; el prefijo solo viene de un scanner.
    const { codigo: limpio, scanner } = separarScanner(cod);
    if (!limpio) return;
    await ejecutar({ accion, codigo: limpio, ...(scanner ? { scanner } : {}) });
  };

  const ejecutar = async (envio: Envio) => {
    if (enviando) return;
    setEnviando(true);
    const res = await enviar(envio, fecha);
    await qc.invalidateQueries({ queryKey: ['embalaje', fecha] });
    // Con los datos ya refrescados: cuántos van de ese producto, para confirmar de un vistazo.
    if (res.ok && (envio.accion === 'pallet-iniciar' || envio.accion === 'pallet-terminar')) {
      setEnviando(false);
      return; // sin pantalla grande: el botón cambia solo
    }
    if (res.ok && res.producto) {
      const datos = qc.getQueryData<EmbalajeResult>(['embalaje', fecha]);
      const abierto = datos?.pallets.find((p) => p.scanner === res.scanner && !p.fin);
      res.pallet = abierto ? { numero: abierto.numero, cantidad: abierto.cantidad } : null;
      const fila = datos?.filas.find((f) => f.producto === res.producto || (res.barcode && f.barcode?.toUpperCase() === res.barcode.toUpperCase()));
      if (fila) res.acumulado = { escaneado: fila.escaneado, odoo: fila.odoo };
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

  const filas = d?.filas ?? [];
  const ordenes = d?.ordenesCerradas ?? [];
  const escaneos = d?.escaneos ?? [];
  const anulados = d?.anulados ?? [];
  const totalOdoo = d?.totalOdoo ?? 0;
  const totalEscaneado = d?.totalEscaneado ?? 0;

  // Escaneado por scanner: Odoo no distingue E1/E2, así que el corte se hace sobre los escaneos.
  const claveFila = (barcode: string | null, producto: string | null) => (barcode ? barcode.toUpperCase() : `p:${producto ?? ''}`);
  const porScanner = new Map<string, { e1: number; e2: number; sin: number }>();
  for (const e of escaneos) {
    const k = claveFila(e.barcode, e.producto);
    const c = porScanner.get(k) ?? { e1: 0, e2: 0, sin: 0 };
    if (e.scanner === 1) c.e1++;
    else if (e.scanner === 2) c.e2++;
    else c.sin++;
    porScanner.set(k, c);
  }
  const deFila = (f: EmbalajeFila) => porScanner.get(claveFila(f.barcode, f.producto)) ?? { e1: 0, e2: 0, sin: 0 };
  const totE1 = escaneos.filter((e) => e.scanner === 1).length;
  const totE2 = escaneos.filter((e) => e.scanner === 2).length;
  const totSin = escaneos.length - totE1 - totE2;

  return (
    <div className="space-y-6">
      <ConfirmacionEscaneo aviso={aviso} onCerrar={() => setAviso(null)} />

      <p className="text-right text-[11px] text-slate-500" title={`Se consulta Odoo y los escaneos cada ${REFRESH_MS / 1000} s`}>
        {query.dataUpdatedAt ? `actualizado hace ${Math.max(0, Math.round((ahora - query.dataUpdatedAt) / 1000))} s · se refresca cada ${REFRESH_MS / 1000} s` : 'esperando…'}
      </p>

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
          <EscaneosPorScanner scanner={1} pallets={d.pallets} titulo="Escaneó E1" escaneos={escaneos.filter((e) => e.scanner === 1)} esHoy={esHoy} enviando={enviando} onBorrar={(id) => void ejecutar({ accion: 'anular', id })} onPallet={(a) => void ejecutar({ accion: a, scanner: 1 })} />
          <EscaneosPorScanner scanner={2} pallets={d.pallets} titulo="Escaneó E2" escaneos={escaneos.filter((e) => e.scanner === 2)} esHoy={esHoy} enviando={enviando} onBorrar={(id) => void ejecutar({ accion: 'anular', id })} onPallet={(a) => void ejecutar({ accion: a, scanner: 2 })} />
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
          <div className={`grid gap-4 sm:grid-cols-2 ${totSin > 0 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
            <Kpi label="Cerrado en Odoo" valor={n0.format(totalOdoo)} />
            <Kpi label="Escaneó E1" valor={n0.format(totE1)} />
            <Kpi label="Escaneó E2" valor={n0.format(totE2)} />
            {totSin > 0 && <Kpi label="Sin identificar" valor={n0.format(totSin)} color="text-status-yellow" />}
            <Kpi label="Escaneado total" valor={n0.format(totalEscaneado)} />
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
                  <th className="px-4 py-3 text-right">E1</th>
                  <th className="px-4 py-3 text-right">E2</th>
                  {totSin > 0 && <th className="px-4 py-3 text-right">Sin id.</th>}
                  <th className="px-4 py-3 text-right">Escaneado</th>
                  <th className="px-4 py-3 text-right">Diferencia</th>
                  <th className="px-4 py-3">Último</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      Sin órdenes cerradas ni escaneos en este día.
                    </td>
                  </tr>
                )}
                {filas.map((f) => (
                  <tr key={f.barcode ?? f.producto} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-3 text-slate-100">{f.producto}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{f.barcode ?? 'sin código'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-100">{n0.format(f.odoo)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">{n0.format(deFila(f).e1)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">{n0.format(deFila(f).e2)}</td>
                    {totSin > 0 && <td className="px-4 py-3 text-right tabular-nums text-status-yellow">{n0.format(deFila(f).sin)}</td>}
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
                          tabIndex={-1}
                          onMouseDown={(ev) => ev.preventDefault()}
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

      {d && (
        <div className="space-y-3">
          <details className="group rounded-lg border border-slate-800 bg-slate-900">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-800/40">
              Cerrado en Odoo ({n0.format(ordenes.length)} órdenes)
            </summary>
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
          </details>
          <details className="group rounded-lg border border-slate-800 bg-slate-900">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-800/40">
              Escaneos registrados ({n0.format(escaneos.length)})
            </summary>
            {escaneos.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Todavía no hay escaneos en este día.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-800/60 overflow-y-auto">
                {escaneos.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-14 shrink-0 tabular-nums text-slate-400">{hora.format(new Date(e.creado))}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-100">{e.producto ?? e.barcode}</span>
                    {e.scanner && (
                      <span className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-xs font-semibold text-slate-300">E{e.scanner}</span>
                    )}
                    <span className="hidden font-mono text-xs text-slate-500 sm:inline">{e.barcode}</span>
                    {esHoy && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(ev) => ev.preventDefault()}
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
            {anulados.length > 0 && (
              <details className="border-t border-slate-800">
                <summary className="cursor-pointer px-4 py-2 text-xs text-slate-500 hover:text-slate-300">
                  Anulados ({n0.format(anulados.length)}) — no cuentan en el total
                </summary>
                <ul className="max-h-60 divide-y divide-slate-800/60 overflow-y-auto">
                  {anulados.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm text-slate-500">
                      <span className="w-14 shrink-0 tabular-nums">{hora.format(new Date(e.creado))}</span>
                      <span className="min-w-0 flex-1 truncate line-through">{e.producto ?? e.barcode}</span>
                      <span className="shrink-0 text-xs">{e.anuladoAt ? `anulado ${hora.format(new Date(e.anuladoAt))}` : 'anulado'}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </details>
          {escaneos.some((e) => e.scanner !== 1 && e.scanner !== 2) && (
            <details className="group rounded-lg border border-slate-800 bg-slate-900">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-800/40">
                Sin identificar ({n0.format(escaneos.filter((e) => e.scanner !== 1 && e.scanner !== 2).length)})
              </summary>
              <EscaneosPorScanner titulo="Sin identificar" escaneos={escaneos.filter((e) => e.scanner !== 1 && e.scanner !== 2)} esHoy={esHoy} enviando={enviando} onBorrar={(id) => void ejecutar({ accion: 'anular', id })} sinCabecera />
            </details>
          )}
        </div>
      )}
    </div>
  );
}

type EscaneoFila = EmbalajeResult['escaneos'][number];

const FONDO_PALLET = ['bg-sky-500/15', 'bg-emerald-500/15'];

/** Lo que cargó un scanner (E1 o E2), por pallets, con la opción de borrar cada escaneo. */
function EscaneosPorScanner({
  titulo,
  escaneos,
  esHoy,
  enviando,
  onBorrar,
  scanner,
  pallets = [],
  onPallet,
  sinCabecera,
}: {
  titulo: string;
  escaneos: EscaneoFila[];
  esHoy: boolean;
  enviando: boolean;
  onBorrar: (id: number) => void;
  scanner?: 1 | 2;
  pallets?: EmbalajeResult['pallets'];
  onPallet?: (accion: 'pallet-iniciar' | 'pallet-terminar') => void;
  /** Sin el recuadro ni el título (cuando ya va dentro de un acordeón). */
  sinCabecera?: boolean;
}) {
  const abierto = scanner ? pallets.find((p) => p.scanner === scanner && !p.fin) : undefined;
  return (
    <div className={sinCabecera ? 'border-t border-slate-800' : 'rounded-lg border border-slate-800 bg-slate-900'}>
      <div className={`${sinCabecera ? 'hidden' : 'flex'} items-center justify-between gap-3 border-b border-slate-800 px-4 py-3`}>
        <h3 className="text-sm font-semibold text-slate-100">
          {titulo} ({n0.format(escaneos.length)})
        </h3>
        {scanner && onPallet && esHoy && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPallet(abierto ? 'pallet-terminar' : 'pallet-iniciar')}
            disabled={enviando}
            className={`rounded border px-3 py-1 text-sm font-semibold disabled:opacity-50 ${
              abierto ? 'border-status-red/60 text-status-red hover:bg-slate-800' : 'border-status-green/60 text-status-green hover:bg-slate-800'
            }`}
          >
            {abierto ? `■ Terminar pallet ${abierto.numero} (${abierto.cantidad})` : '▶ Empezar pallet'}
          </button>
        )}
      </div>
      {escaneos.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">Todavía no hay escaneos.</p>
      ) : (
        <ul className="max-h-96 overflow-y-auto">
          {escaneos.map((e, i) => {
            const nuevoGrupo = i === 0 || escaneos[i - 1]!.pallet !== e.pallet;
            const p = e.pallet ? pallets.find((x) => x.scanner === e.scanner && x.numero === e.pallet) : undefined;
            return (
              <li key={e.id} className={e.pallet ? FONDO_PALLET[e.pallet % 2] : ''}>
                {nuevoGrupo && (
                  <p className="border-t border-slate-700 px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {p ? `Pallet ${p.numero} · ${n0.format(p.cantidad)}${p.fin ? '' : ' · en curso'}` : 'Sin pallet'}
                  </p>
                )}
                <div className="flex items-center gap-3 border-b border-slate-800/60 px-4 py-2 text-sm">
                  <span className="w-14 shrink-0 tabular-nums text-slate-400">{hora.format(new Date(e.creado))}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-100">{e.producto ?? e.barcode}</span>
                  <span className="hidden font-mono text-xs text-slate-500 sm:inline">{e.barcode}</span>
                  {esHoy && (
                    <button
                      type="button"
                      onClick={() => onBorrar(e.id)}
                      disabled={enviando}
                      className="rounded border border-status-red/50 px-2 py-1 text-xs text-status-red hover:bg-slate-800 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
  // Colores fijos (los del tema oscuro): en el tema claro los status-* son otros (el verde queda oliva).
  const tono = !aviso.ok ? 'bg-[rgb(248,113,113)]' : aviso.advertencia ? 'bg-[rgb(251,191,36)]' : 'bg-[rgb(52,211,153)]';
  return (
    <div
      role="status"
      aria-live="assertive"
      onClick={onCerrar}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-8 p-8 text-center text-white ${tono}`}
    >
      {aviso.ok && aviso.accion ? (
        <>
          <p className="max-w-[95vw] break-words font-black leading-none" style={{ fontSize: 'clamp(3rem, 10vw, 12rem)' }}>
            {aviso.producto}
          </p>
          <p className="font-black leading-none tabular-nums" style={{ fontSize: 'clamp(3rem, 8vw, 9rem)' }}>
            {aviso.scanner ? `E${aviso.scanner} ` : ''}
            {aviso.accion === 'escanear' ? '+1' : aviso.accion === 'deshacer' ? '−1' : '✓'}
          </p>
          {aviso.accion !== 'escanear' && !aviso.scanner && (
            <p className="rounded-lg bg-black/25 px-8 py-3 text-4xl font-black">Escaneo sin E1 / E2 identificado</p>
          )}
          {aviso.accion === 'escanear' && (
            <p className="font-bold" style={{ fontSize: 'clamp(2rem, 5vw, 6rem)' }}>
              {aviso.pallet ? `Van ${n0.format(aviso.pallet.cantidad)} del Pallet ${aviso.pallet.numero}` : 'Sin pallet iniciado'}
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
