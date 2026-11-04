import { useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import type { EspumadoControlTipo, EspumadoStockFila } from '@/lib/espumado-stock';

interface StockResult {
  fecha: string;
  disponible: boolean;
  filas: EspumadoStockFila[];
  control: EspumadoControlTipo[];
}

type CampoMov = 'produccion' | 'colchones' | 'living' | 'venta' | 'noConforme';

interface Borrador {
  /** '' = sin conteo manual, arrastra el final del día anterior. */
  inicial: string;
  produccion: string;
  colchones: string;
  living: string;
  venta: string;
  noConforme: string;
}

const CAMPOS: { id: CampoMov; label: string }[] = [
  { id: 'produccion', label: 'Producción' },
  { id: 'colchones', label: 'Colchones' },
  { id: 'living', label: 'Living' },
  { id: 'venta', label: 'Venta' },
  { id: 'noConforme', label: 'No conforme' },
];

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function hoyLocal(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 3);
  return d.toISOString().slice(0, 10);
}

function sumarDia(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const key = (f: { tipo: string; medida: string }) => `${f.tipo}|${f.medida}`;
const num = (s: string) => (s.trim() === '' ? 0 : Math.max(0, Math.trunc(Number(s)) || 0));

function aBorrador(f: EspumadoStockFila): Borrador {
  const z = (n: number) => (n ? String(n) : '');
  return {
    inicial: f.inicialManual ? String(f.inicial) : '',
    produccion: z(f.produccion),
    colchones: z(f.colchones),
    living: z(f.living),
    venta: z(f.venta),
    noConforme: z(f.noConforme),
  };
}

function Dif({ manual, odoo }: { manual: number; odoo: number | null }) {
  if (odoo === null) return <span className="text-slate-600">—</span>;
  const d = manual - odoo;
  const cls = Math.abs(d) < 1 ? 'text-slate-500' : d > 0 ? 'text-status-yellow' : 'text-status-red';
  return <span className={`tabular-nums ${cls}`}>{d > 0 ? '+' : ''}{nf.format(d)}</span>;
}

export default function EspumadoStockPanel() {
  const [fecha, setFecha] = useState(hoyLocal);
  const [borrador, setBorrador] = useState<Record<string, Borrador>>({});
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const query = useApiQuery<StockResult>(['espumado-stock', fecha], `/api/espumado-stock?fecha=${fecha}`);
  const data = query.data;

  // Cada vez que llegan datos del servidor (cambio de día o guardado) el borrador vuelve a lo persistido.
  useEffect(() => {
    if (!data || data.fecha !== fecha) return;
    setBorrador(Object.fromEntries(data.filas.map((f) => [key(f), aBorrador(f)])));
    setSucio(false);
  }, [data, fecha]);

  const filas = useMemo(() => {
    if (!data) return [];
    return data.filas.map((f) => {
      const b = borrador[key(f)] ?? aBorrador(f);
      const inicial = b.inicial.trim() === '' ? f.inicialAuto : num(b.inicial);
      const mov = Object.fromEntries(CAMPOS.map((c) => [c.id, num(b[c.id])])) as Record<CampoMov, number>;
      return { f, b, inicial, final: inicial + mov.produccion - mov.colchones - mov.living - mov.venta - mov.noConforme };
    });
  }, [data, borrador]);

  function editar(f: EspumadoStockFila, campo: keyof Borrador, valor: string) {
    if (!/^\d*$/.test(valor)) return;
    // Un «Inicial» igual al final del día anterior no es un conteo: vuelve a arrastrar solo.
    const v = campo === 'inicial' && valor !== '' && Number(valor) === f.inicialAuto ? '' : valor;
    setBorrador((prev) => ({ ...prev, [key(f)]: { ...(prev[key(f)] ?? aBorrador(f)), [campo]: v } }));
    setSucio(true);
    setAviso(null);
  }

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      const body = {
        fecha,
        filas: filas.map(({ f, b }) => ({
          tipo: f.tipo,
          medida: f.medida,
          stockInicial: b.inicial.trim() === '' ? null : num(b.inicial),
          produccion: num(b.produccion),
          colchones: num(b.colchones),
          living: num(b.living),
          venta: num(b.venta),
          noConforme: num(b.noConforme),
        })),
      };
      const res = await fetch('/api/espumado-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo guardar');
      setAviso({ ok: true, texto: 'Día guardado.' });
      await query.refetch();
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  }

  const totalFinalKg = data?.control.reduce((a, c) => a + c.finalKg, 0) ?? 0;
  const totalOdooKg = data?.control.reduce((a, c) => a + (c.odooStockKg ?? 0), 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          Día
          <input
            type="date"
            value={fecha}
            max={hoyLocal()}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-3">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            onClick={() => setFecha((d) => sumarDia(d, 1))}
            disabled={sucio || fecha >= hoyLocal()}
            title={sucio ? 'Guardá el día antes de pasar al siguiente' : 'El final de este día es el inicial del siguiente'}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Día siguiente →
          </button>
          <button
            onClick={guardar}
            disabled={!sucio || guardando || !data?.disponible}
            className="rounded bg-brand-500 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {guardando ? 'Guardando…' : 'Guardar día'}
          </button>
        </div>
      </div>

      {aviso && (
        <p className={`rounded border p-3 text-sm ${aviso.ok ? 'border-emerald-900 bg-emerald-950/40 text-status-green' : 'border-red-900 bg-red-950/50 text-red-300'}`}>
          {aviso.texto}
        </p>
      )}
      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}
      {data && !data.disponible && (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          Falta crear la tabla <code>espumado_dia</code> en Supabase (el SQL está en <code>src/lib/supabase/espumado-dia.ts</code>). Mientras tanto no se
          puede guardar.
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 p-4">
              <h3 className="text-sm font-semibold text-slate-200">Stock y movimientos por medida (unidades)</h3>
              <p className="text-xs text-slate-500">
                El inicial de cada día es el final del día anterior (se arrastra solo, también entre días sin carga). Si escribís otro número en
                «Inicial» (queda en amarillo), se toma como conteo físico y corrige el arrastre desde ese día. Final = inicial + producción − colchones − living − venta − no conforme.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950/50 text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Medida</th>
                    <th className="px-3 py-2 text-right">Inicial</th>
                    {CAMPOS.map((c) => (
                      <th key={c.id} className="px-3 py-2 text-right">{c.label}</th>
                    ))}
                    <th className="px-3 py-2 text-right">Final</th>
                    <th className="px-3 py-2 text-right">Kg final</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {filas.map(({ f, b, final }, i) => {
                    const primera = i === 0 || filas[i - 1]!.f.tipo !== f.tipo;
                    return (
                      <tr key={key(f)} className={`border-slate-800 ${primera ? 'border-t' : ''}`}>
                        <td className="px-3 py-1.5 font-medium">{primera ? f.tipo : ''}</td>
                        <td className="px-3 py-1.5 text-slate-400">{f.medida}</td>
                        <td className="px-3 py-1.5 text-right">
                          <input
                            inputMode="numeric"
                            value={b.inicial !== '' ? b.inicial : String(f.inicialAuto)}
                            onChange={(e) => editar(f, 'inicial', e.target.value)}
                            title={
                              b.inicial !== ''
                                ? `Conteo manual (el final del día anterior es ${f.inicialAuto})`
                                : 'Final del día anterior'
                            }
                            className={`w-16 rounded border bg-slate-950 px-1.5 py-1 text-right tabular-nums focus:border-brand-500 focus:outline-none ${b.inicial !== '' ? 'border-status-yellow/70 text-status-yellow' : 'border-slate-800 text-slate-300'}`}
                          />
                        </td>
                        {CAMPOS.map((c) => (
                          <td key={c.id} className="px-3 py-1.5 text-right">
                            <input
                              inputMode="numeric"
                              value={b[c.id]}
                              placeholder="0"
                              onChange={(e) => editar(f, c.id, e.target.value)}
                              className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-right tabular-nums text-slate-100 focus:border-brand-500 focus:outline-none"
                            />
                          </td>
                        ))}
                        <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${final < 0 ? 'text-status-red' : ''}`}>{final}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{nf.format(final * f.kgUnidad)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 p-4">
              <h3 className="text-sm font-semibold text-slate-200">Control contra Odoo (kg)</h3>
              <p className="text-xs text-slate-500">
                Lo guardado para el día × kg por unidad de la tabla de medidas, contra los movimientos de Odoo del mismo día y su stock al cierre
                (espumado + pre-producción). La diferencia es lo guardado menos Odoo: positiva = en planilla hay más kg que en Odoo.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950/50 text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2 text-right">Stock planilla</th>
                    <th className="px-3 py-2 text-right">Stock Odoo</th>
                    <th className="px-3 py-2 text-right">Dif.</th>
                    <th className="px-3 py-2 text-right">Prod. planilla</th>
                    <th className="px-3 py-2 text-right">Prod. Odoo</th>
                    <th className="px-3 py-2 text-right">Dif.</th>
                    <th className="px-3 py-2 text-right">Consumo planilla</th>
                    <th className="px-3 py-2 text-right">Consumo Odoo</th>
                    <th className="px-3 py-2 text-right">Dif.</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {data.control.map((c) => (
                    <tr key={c.tipo} className="border-t border-slate-800">
                      <td className="px-3 py-1.5 font-medium">{c.tipo}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{nf.format(c.finalKg)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{c.odooStockKg === null ? '—' : nf.format(c.odooStockKg)}</td>
                      <td className="px-3 py-1.5 text-right"><Dif manual={c.finalKg} odoo={c.odooStockKg} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{nf.format(c.produccionKg)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{c.odooProduccionKg === null ? '—' : nf.format(c.odooProduccionKg)}</td>
                      <td className="px-3 py-1.5 text-right"><Dif manual={c.produccionKg} odoo={c.odooProduccionKg} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{nf.format(c.consumoKg)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{c.odooConsumoKg === null ? '—' : nf.format(c.odooConsumoKg)}</td>
                      <td className="px-3 py-1.5 text-right"><Dif manual={c.consumoKg} odoo={c.odooConsumoKg} /></td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-700 bg-slate-950/40 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf.format(totalFinalKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">{nf.format(totalOdooKg)}</td>
                    <td className="px-3 py-2 text-right"><Dif manual={totalFinalKg} odoo={totalOdooKg} /></td>
                    <td colSpan={6} />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
