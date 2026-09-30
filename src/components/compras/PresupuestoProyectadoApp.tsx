import { Fragment, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import KpiCard from '../shared/KpiCard';
import PresupuestoChart from './PresupuestoChart';
import { dec, int, money, monthShort, qty } from './format';
import type { Linea, PresupuestoProyectadoResult, PresupuestoProyectadoRow } from '../../lib/odoo/presupuesto-proyectado';

const LINEA_LABEL: Record<Linea, string> = { colchones: 'Colchones', living: 'Living', ambos: 'Ambos' };
const SELECT_CLASS = 'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

/** Suma de un arreglo mensual entre el mes en curso y el mes elegido (inclusive). */
function sumRange(values: number[], from: number, to: number): number {
  let s = 0;
  for (let i = from; i <= to; i++) s += values[i] ?? 0;
  return s;
}

function Inner() {
  const queryClient = useQueryClient();
  const query = useApiQuery<PresupuestoProyectadoResult>(['presupuesto-proyectado'], '/api/presupuesto-proyectado');
  const data = query.data;

  const [hasta, setHasta] = useState<number | null>(null);
  const [lineaFilter, setLineaFilter] = useState<Linea | ''>('');
  const [categoria, setCategoria] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [search, setSearch] = useState('');
  const [soloCompra, setSoloCompra] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mesActual = data?.mesActual ?? 0;
  const hastaMes = hasta ?? 11;

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.rows
      .map((r) => ({
        r,
        consumo: sumRange(r.consumoProyectado, mesActual, hastaMes),
        compra: sumRange(r.compraMensual, mesActual, hastaMes),
        presupuesto: sumRange(r.presupuestoMensual, mesActual, hastaMes),
      }))
      .filter(
        ({ r, compra }) =>
          (!lineaFilter || r.linea === lineaFilter) &&
          (!categoria || r.categoria === categoria) &&
          (!proveedor || r.proveedor === proveedor) &&
          (!needle || r.nombre.toLowerCase().includes(needle)) &&
          (!soloCompra || compra > 0)
      )
      .sort((a, b) => b.presupuesto - a.presupuesto);
  }, [data, mesActual, hastaMes, lineaFilter, categoria, proveedor, search, soloCompra]);

  const chartPoints = useMemo(() => {
    if (!data) return [];
    return data.months.map((month, i) => {
      const acc = { month, colchones: 0, living: 0, ambos: 0 };
      for (const r of data.rows) {
        if (lineaFilter && r.linea !== lineaFilter) continue;
        if (categoria && r.categoria !== categoria) continue;
        if (proveedor && r.proveedor !== proveedor) continue;
        acc[r.linea] += r.presupuestoMensual[i] ?? 0;
      }
      return acc;
    });
  }, [data, lineaFilter, categoria, proveedor]);

  const totalPresupuesto = rows.reduce((s, x) => s + x.presupuesto, 0);
  const insumosACOmprar = rows.filter((x) => x.compra > 0).length;
  const ventasPeriodo = data ? sumRange(data.ventasProyectadas.total, mesActual, hastaMes) : 0;

  async function cambiarLinea(row: PresupuestoProyectadoRow, value: string) {
    setSaveError(null);
    const linea = value === '' ? null : (value as Linea);
    try {
      const res = await fetch('/api/presupuesto-proyectado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: row.productId, linea }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'No se pudo guardar');
      await queryClient.invalidateQueries({ queryKey: ['presupuesto-proyectado'] });
    } catch (err) {
      setSaveError(
        `${err instanceof Error ? err.message : 'Error'} — ¿existe la tabla presupuesto_mp_linea en Supabase? (SQL en src/lib/supabase/presupuesto-mp-linea.ts)`
      );
    }
  }

  if (query.isError && !data) {
    return <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">No se pudo cargar: {(query.error as Error).message}</p>;
  }

  const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500';
  const thR = `${th} text-right`;
  const td = 'px-3 py-2 text-slate-300';
  const tdR = `${td} text-right tabular-nums`;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
        <p>
          <span className="text-slate-200">Coeficiente</span> = consumo histórico del insumo ({data?.historicoMeses.length ?? 6} meses cerrados) ÷ unidades
          producidas de su línea &nbsp;→&nbsp; <span className="text-slate-200">Consumo proyectado</span> = coeficiente × ventas proyectadas del mes
          &nbsp;→&nbsp; <span className="text-slate-200">Necesidad</span> = consumo proyectado + stock de seguridad − disponible − entrante &nbsp;→&nbsp;{' '}
          <span className="text-slate-200">Presupuesto</span> = necesidad × costo.
        </p>
        {data && (
          <p className="mt-2 text-xs text-slate-500">
            Producción histórica de la ventana: Colchones {int.format(data.produccionHistorica.colchones)} u · Living {int.format(data.produccionHistorica.living)} UE.
            Ventas proyectadas {data.year}: Colchones {int.format(data.ventasProyectadas.colchones.reduce((a, b) => a + b, 0))} u · Living{' '}
            {int.format(data.ventasProyectadas.living.reduce((a, b) => a + b, 0))} UE. El mes en curso se prorratea por días hábiles restantes.
          </p>
        )}
      </div>

      {data && !data.etiquetasManualesDisponibles && (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          No se pudo leer la tabla de etiquetas manuales (presupuesto_mp_linea) en Supabase: se usan las líneas sugeridas automáticamente.
        </p>
      )}
      {saveError && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{saveError}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={`Presupuesto hasta ${data ? monthShort(data.months[hastaMes]!) : '…'}`} value={totalPresupuesto} format="currency" isLoading={!data} />
        <KpiCard label="Insumos a comprar" value={insumosACOmprar} isLoading={!data} />
        <KpiCard label="Ventas proyectadas del período (u/UE)" value={ventasPeriodo} isLoading={!data} />
        <KpiCard label="Insumos analizados" value={data?.rows.length} isLoading={!data} />
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
        <label className="flex flex-col gap-1">
          Acumular hasta
          <select value={hastaMes} onChange={(e) => setHasta(Number(e.target.value))} className={SELECT_CLASS}>
            {(data?.months ?? []).map((m, i) =>
              i >= mesActual ? (
                <option key={m} value={i}>
                  {monthShort(m)}
                </option>
              ) : null
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Línea
          <select value={lineaFilter} onChange={(e) => setLineaFilter(e.target.value as Linea | '')} className={SELECT_CLASS}>
            <option value="">Todas</option>
            {(Object.keys(LINEA_LABEL) as Linea[]).map((l) => (
              <option key={l} value={l}>
                {LINEA_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Categoría
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={SELECT_CLASS}>
            <option value="">Todas</option>
            {(data?.categorias ?? []).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Proveedor
          <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={`${SELECT_CLASS} max-w-[16rem]`}>
            <option value="">Todos</option>
            {(data?.proveedores ?? []).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Buscar insumo
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre…" className={SELECT_CLASS} />
        </label>
        <label className="flex items-center gap-2 pb-1.5">
          <input type="checkbox" checked={soloCompra} onChange={(e) => setSoloCompra(e.target.checked)} />
          Solo con compra necesaria
        </label>
        <div className="ml-auto flex items-center gap-3">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800"
          >
            {query.isFetching ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-2 text-sm font-medium text-slate-200">Presupuesto de compra por mes</h3>
        {data ? (
          <PresupuestoChart points={chartPoints.map((p, i) => (i < mesActual ? { ...p, colchones: 0, living: 0, ambos: 0 } : p))} selectedMonth={hastaMes} onSelectMonth={(i) => i >= mesActual && setHasta(i)} />
        ) : (
          <div className="h-72 animate-pulse-slow rounded bg-slate-800" />
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-slate-800">
            <tr>
              <th className={th}>Insumo</th>
              <th className={th}>Categoría</th>
              <th className={th}>Proveedor</th>
              <th className={th}>Línea</th>
              <th className={thR}>Disponible</th>
              <th className={thR}>Entrante</th>
              <th className={thR}>Seguridad</th>
              <th className={thR}>Coef.</th>
              <th className={thR}>Consumo proy.</th>
              <th className={thR}>Compra</th>
              <th className={thR}>Costo</th>
              <th className={thR}>Presupuesto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {!data && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  Cargando desde Odoo… (la primera vez puede tardar unos segundos)
                </td>
              </tr>
            )}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  Sin insumos para estos filtros.
                </td>
              </tr>
            )}
            {rows.map(({ r, consumo, compra, presupuesto }) => (
              <Fragment key={r.productId}>
                <tr className="cursor-pointer hover:bg-slate-800/50" onClick={() => setExpanded(expanded === r.productId ? null : r.productId)}>
                  <td className={`${td} text-slate-100`}>{r.nombre}</td>
                  <td className={td}>{r.categoria}</td>
                  <td className={td}>{r.proveedor ?? '—'}</td>
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <select
                      value={r.lineaManual ? r.linea : ''}
                      onChange={(e) => void cambiarLinea(r, e.target.value)}
                      className={`${SELECT_CLASS} py-0.5 text-xs`}
                      title={r.lineaManual ? 'Etiqueta manual' : `Sugerida automáticamente: ${LINEA_LABEL[r.lineaSugerida]}`}
                    >
                      <option value="">Auto ({LINEA_LABEL[r.lineaSugerida]})</option>
                      {(Object.keys(LINEA_LABEL) as Linea[]).map((l) => (
                        <option key={l} value={l}>
                          {LINEA_LABEL[l]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdR}>{qty(r.disponible)}</td>
                  <td className={tdR}>{qty(r.entrante)}</td>
                  <td className={tdR}>{qty(r.stockSeguridad)}</td>
                  <td className={tdR}>{dec.format(r.coeficiente)}</td>
                  <td className={tdR}>{qty(consumo)}</td>
                  <td className={`${tdR} ${compra > 0 ? 'font-medium text-slate-100' : ''}`}>{qty(compra)}</td>
                  <td className={tdR}>{money.format(r.costo)}</td>
                  <td className={`${tdR} font-medium text-slate-100`}>{money.format(presupuesto)}</td>
                </tr>
                {expanded === r.productId && data && (
                  <tr className="bg-slate-950/60">
                    <td colSpan={12} className="px-3 py-3">
                      <DetalleMensual row={r} data={data} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          {data && rows.length > 0 && (
            <tfoot className="border-t border-slate-700">
              <tr>
                <td colSpan={11} className={`${td} font-medium text-slate-100`}>
                  Total ({rows.length} insumos)
                </td>
                <td className={`${tdR} font-semibold text-slate-100`}>{money.format(totalPresupuesto)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** Drill-down: consumo real de la ventana histórica vs. consumo proyectado y compra por mes, para un insumo. */
function DetalleMensual({ row, data }: { row: PresupuestoProyectadoRow; data: PresupuestoProyectadoResult }) {
  const cell = 'px-2 py-1 text-right tabular-nums';
  return (
    <div className="flex flex-col gap-3 text-xs text-slate-400">
      <div>
        <p className="mb-1 text-slate-500">Consumo histórico (real)</p>
        <table>
          <thead>
            <tr>
              {data.historicoMeses.map((m) => (
                <th key={m} className={`${cell} font-medium text-slate-500`}>
                  {monthShort(m)}
                </th>
              ))}
              <th className={`${cell} font-medium text-slate-300`}>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {row.consumoHistorico.map((v, i) => (
                <td key={i} className={cell}>
                  {qty(v)}
                </td>
              ))}
              <td className={`${cell} text-slate-200`}>{qty(row.consumoHistoricoTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div>
        <p className="mb-1 text-slate-500">Proyección {data.year}</p>
        <table>
          <thead>
            <tr>
              <th />
              {data.months.map((m, i) =>
                i >= data.mesActual ? (
                  <th key={m} className={`${cell} font-medium text-slate-500`}>
                    {monthShort(m)}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {[
              ['Consumo proyectado', row.consumoProyectado, qty],
              ['Compra (u)', row.compraMensual, qty],
              ['Presupuesto', row.presupuestoMensual, (v: number) => money.format(v)],
            ].map(([label, values, fmt]) => (
              <tr key={label as string}>
                <td className="pr-3 text-slate-500">{label as string}</td>
                {(values as number[]).map((v, i) =>
                  i >= data.mesActual ? (
                    <td key={i} className={cell}>
                      {(fmt as (n: number) => string)(v)}
                    </td>
                  ) : null
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PresupuestoProyectadoApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
