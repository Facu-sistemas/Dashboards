import { Fragment, useState } from 'react';
import { Bar, BarChart, Cell, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import KpiCard from '@/components/shared/KpiCard';
import { useChartTheme } from '@/components/shared/useChartTheme';
import { formatCompactCurrency, formatNumber } from './format';
import type { AjusteMes, AjustesInventarioResult } from '@/lib/odoo/ajustes-inventario';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function signClass(v: number): string {
  return v < 0 ? 'text-red-400' : v > 0 ? 'text-emerald-400' : 'text-slate-400';
}

type Modo = 'mes' | 'acumulado';

/** Mes por defecto: el actual si el año es el corriente, diciembre en años pasados, enero en años futuros. */
function mesPorDefecto(year: number): number {
  const now = new Date();
  return year === now.getFullYear() ? now.getMonth() : year < now.getFullYear() ? 11 : 0;
}

function sumarMeses(meses: AjusteMes[]): Omit<AjusteMes, 'mes'> {
  const z = { capas: 0, ingresoCantidad: 0, ingresoValor: 0, egresoCantidad: 0, egresoValor: 0, netoCantidad: 0, netoValor: 0, difCantidad: 0, movimientosConDiferencia: 0, movimientos: 0 };
  for (const m of meses) {
    z.capas += m.capas;
    z.ingresoCantidad += m.ingresoCantidad;
    z.ingresoValor += m.ingresoValor;
    z.egresoCantidad += m.egresoCantidad;
    z.egresoValor += m.egresoValor;
    z.netoCantidad += m.netoCantidad;
    z.netoValor += m.netoValor;
    z.difCantidad += m.difCantidad;
    z.movimientosConDiferencia += m.movimientosConDiferencia;
    z.movimientos += m.movimientos;
  }
  return z;
}

function MesChart({ title, data, format, desde, hasta }: { title: string; data: { mes: string; v: number }[]; format: 'currency' | 'number'; desde: number; hasta: number }) {
  const t = useChartTheme();
  const fmt = (v: number) => (format === 'currency' ? formatCompactCurrency(v) : formatNumber(v));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={t.axis} fontSize={11} />
          <YAxis stroke={t.axis} fontSize={11} tickFormatter={(v) => fmt(Number(v))} width={64} />
          <ReferenceLine y={0} stroke={t.axis} />
          <Tooltip
            contentStyle={{ background: t.tooltipBg, border: `1px solid ${t.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: t.tooltipText }}
            itemStyle={{ color: t.tooltipText }}
            formatter={(value: number) => (format === 'currency' ? money.format(value) : qtyFmt.format(value))}
          />
          <Bar dataKey="v" name="Neto" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.v < 0 ? t.danger : t.secondary} fillOpacity={i >= desde && i <= hasta ? 1 : 0.3} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProductosMes({ data, mes }: { data: AjustesInventarioResult; mes: string }) {
  const rows = data.productosPorMes[mes] ?? [];
  const omitidos = data.productosOmitidos[mes] ?? 0;
  return (
    <div className="overflow-x-auto bg-slate-950/40 p-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th title="Producto de la capa de valoración." className="py-1 pr-3 font-medium">Producto</th>
            <th title="Categoría del producto en Odoo." className="py-1 pr-3 font-medium">Categoría</th>
            <th title="Unidad de medida del producto en Odoo." className="py-1 pr-3 font-medium">UdM</th>
            <th title="Valoración: ingresos + egresos del producto en el mes, en su unidad de medida." className="py-1 pr-3 text-right font-medium">Cant. neta</th>
            <th title="Ingresos + egresos en pesos (Valoración). Es lo que el ajuste suma o resta al inventario valorizado." className="py-1 pr-3 text-right font-medium">$ neto</th>
            <th title="Cruce con Inventario > Reportes > Historial de movimientos (stock.move.line): unidades en que el total de Valoración del movimiento no coincide con la cantidad del historial." className="py-1 pr-3 text-right font-medium">Dif. vs historial</th>
            <th title="Movimientos de ajuste con diferencia / total de movimientos del mes. Se compara contra todas las capas del movimiento, no solo las del mes." className="py-1 text-right font-medium">Mov. con dif.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.productId} className="border-t border-slate-800">
              <td className="py-1 pr-3 text-slate-200">{p.producto}</td>
              <td className="py-1 pr-3 text-slate-400">{p.categoria}</td>
              <td className="py-1 pr-3 text-slate-400">{p.uom}</td>
              <td className={`py-1 pr-3 text-right tabular-nums ${signClass(p.netoCantidad)}`}>{qtyFmt.format(p.netoCantidad)}</td>
              <td className={`py-1 pr-3 text-right tabular-nums ${signClass(p.netoValor)}`}>{money.format(p.netoValor)}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-slate-300">{qtyFmt.format(p.difCantidad)}</td>
              <td className={`py-1 text-right tabular-nums ${p.movimientosConDiferencia ? 'text-amber-400' : 'text-slate-500'}`}>{p.movimientosConDiferencia}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {omitidos > 0 && <p className="mt-2 text-[10px] text-slate-500">Se muestran los {rows.length} productos de mayor $ neto; {omitidos} más quedan fuera.</p>}
    </div>
  );
}

function AjustesInner() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('mes');
  const [mesSel, setMesSel] = useState(mesPorDefecto(thisYear));
  const [desdeSel, setDesdeSel] = useState(0);
  const [hastaSel, setHastaSel] = useState(mesPorDefecto(thisYear));
  const query = useApiQuery<AjustesInventarioResult>(['ajustes-inventario', year], `/api/ajustes-inventario?year=${year}`);
  const data = query.data;
  const desde = modo === 'mes' ? mesSel : desdeSel;
  const hasta = modo === 'mes' ? mesSel : hastaSel;
  const periodo = desde === hasta ? `${MESES[desde]} ${year}` : `${MESES[desde]}–${MESES[hasta]} ${year}`;
  const sel = data ? sumarMeses(data.mensual.slice(desde, hasta + 1)) : undefined;
  const enRango = (i: number) => i >= desde && i <= hasta;
  const categoriasSel = (data?.categorias ?? [])
    .map((c) => ({ ...c, totalSel: c.netoValor.slice(desde, hasta + 1).reduce((a, v) => a + v, 0) }))
    .sort((a, b) => Math.abs(b.totalSel) - Math.abs(a.totalSel));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400" htmlFor="aj-year">Año</label>
          <select
            id="aj-year"
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value);
              setYear(y);
              setAbierto(null);
              setMesSel(mesPorDefecto(y));
              setHastaSel(mesPorDefecto(y));
            }}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
          >
            {[thisYear + 1, thisYear, thisYear - 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded border border-slate-700 text-xs">
            {(['mes', 'acumulado'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={`px-3 py-1 ${modo === m ? 'bg-slate-700 text-slate-100' : 'bg-slate-950 text-slate-400 hover:text-slate-200'}`}
              >
                {m === 'mes' ? 'Mes' : 'Acumulado'}
              </button>
            ))}
          </div>
          {modo === 'mes' ? (
            <select aria-label="Mes" value={mesSel} onChange={(e) => setMesSel(Number(e.target.value))} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200">
              {MESES.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
            </select>
          ) : (
            <>
              <span className="text-xs text-slate-400">de</span>
              <select
                aria-label="Desde"
                value={desdeSel}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDesdeSel(v);
                  if (v > hastaSel) setHastaSel(v);
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <span className="text-xs text-slate-400">a</span>
              <select
                aria-label="Hasta"
                value={hastaSel}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setHastaSel(v);
                  if (v < desdeSel) setDesdeSel(v);
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div title={`Valoración: suma del valor ($) de las capas de ajuste de inventario de ${periodo}.`}><KpiCard label={`$ neto ajustado · ${periodo}`} value={sel!.netoValor} format="currency" /></div>
            <div title={`Valoración: suma de cantidades de las capas de ajuste de ${periodo} (mezcla kg, unidades y metros).`}><KpiCard label="Unidades netas ajustadas" value={sel!.netoCantidad} /></div>
            <div title="Valoración: capas de ajuste que ingresan stock."><KpiCard label="$ ingresos (+)" value={sel!.ingresoValor} format="currency" /></div>
            <div title="Valoración: capas de ajuste que sacan stock."><KpiCard label="$ egresos (−)" value={sel!.egresoValor} format="currency" /></div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MesChart title="$ neto por mes" data={data.mensual.map((m, i) => ({ mes: MESES[i]!, v: m.netoValor }))} format="currency" desde={desde} hasta={hasta} />
            <MesChart title="Unidades netas por mes" data={data.mensual.map((m, i) => ({ mes: MESES[i]!, v: m.netoCantidad }))} format="number" desde={desde} hasta={hasta} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th title="Mes de la capa de valoración (fecha de creación), igual que el reporte Inventario > Reportes > Valoración." className="p-3 font-medium">Mes</th>
                  <th title="Valoración (stock.valuation.layer): suma de cantidades positivas de los ajustes de inventario del mes." className="p-3 text-right font-medium">Unid. (+)</th>
                  <th title="Valoración: suma del valor ($) de las capas de ajuste que ingresan stock." className="p-3 text-right font-medium">$ (+)</th>
                  <th title="Valoración: suma de cantidades negativas de los ajustes de inventario del mes." className="p-3 text-right font-medium">Unid. (−)</th>
                  <th title="Valoración: suma del valor ($) de las capas de ajuste que sacan stock." className="p-3 text-right font-medium">$ (−)</th>
                  <th title="Ingresos + egresos en unidades (Valoración). Es el saldo del ajuste del mes." className="p-3 text-right font-medium">Unid. netas</th>
                  <th title="Ingresos + egresos en pesos (Valoración). Es lo que el ajuste suma o resta al inventario valorizado." className="p-3 text-right font-medium">$ neto</th>
                  <th title="Cruce con Inventario > Reportes > Historial de movimientos (stock.move.line): unidades en que el total de Valoración del movimiento no coincide con la cantidad del historial." className="p-3 text-right font-medium">Dif. vs historial</th>
                  <th title="Movimientos de ajuste con diferencia / total de movimientos del mes. Se compara contra todas las capas del movimiento, no solo las del mes." className="p-3 text-right font-medium">Mov. con dif.</th>
                </tr>
              </thead>
              <tbody>
                {data.mensual.map((m, i) => (
                  <Fragment key={m.mes}>
                    <tr
                      className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/40 ${m.capas === 0 ? 'text-slate-600' : enRango(i) ? '' : 'opacity-40'}`}
                      onClick={() => m.capas > 0 && setAbierto(abierto === m.mes ? null : m.mes)}
                    >
                      <td className="p-3 font-medium text-slate-200">{abierto === m.mes ? '▾' : '▸'} {MESES[i]}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-400">{qtyFmt.format(m.ingresoCantidad)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-400">{money.format(m.ingresoValor)}</td>
                      <td className="p-3 text-right tabular-nums text-red-400">{qtyFmt.format(m.egresoCantidad)}</td>
                      <td className="p-3 text-right tabular-nums text-red-400">{money.format(m.egresoValor)}</td>
                      <td className={`p-3 text-right tabular-nums font-medium ${signClass(m.netoCantidad)}`}>{qtyFmt.format(m.netoCantidad)}</td>
                      <td className={`p-3 text-right tabular-nums font-medium ${signClass(m.netoValor)}`}>{money.format(m.netoValor)}</td>
                      <td className="p-3 text-right tabular-nums text-slate-300">{qtyFmt.format(m.difCantidad)}</td>
                      <td className={`p-3 text-right tabular-nums ${m.movimientosConDiferencia ? 'text-amber-400' : 'text-slate-500'}`}>
                        {m.movimientosConDiferencia} / {m.movimientos}
                      </td>
                    </tr>
                    {abierto === m.mes && (
                      <tr>
                        <td colSpan={9} className="p-0">
                          <ProductosMes data={data} mes={m.mes} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="border-t-2 border-slate-700 font-semibold">
                  <td className="p-3 text-slate-200">Total {periodo}</td>
                  <td className="p-3 text-right tabular-nums text-emerald-400">{qtyFmt.format(sel!.ingresoCantidad)}</td>
                  <td className="p-3 text-right tabular-nums text-emerald-400">{money.format(sel!.ingresoValor)}</td>
                  <td className="p-3 text-right tabular-nums text-red-400">{qtyFmt.format(sel!.egresoCantidad)}</td>
                  <td className="p-3 text-right tabular-nums text-red-400">{money.format(sel!.egresoValor)}</td>
                  <td className={`p-3 text-right tabular-nums ${signClass(sel!.netoCantidad)}`}>{qtyFmt.format(sel!.netoCantidad)}</td>
                  <td className={`p-3 text-right tabular-nums ${signClass(sel!.netoValor)}`}>{money.format(sel!.netoValor)}</td>
                  <td className="p-3 text-right tabular-nums text-slate-300">{qtyFmt.format(sel!.difCantidad)}</td>
                  <td className="p-3 text-right tabular-nums text-slate-300">{sel!.movimientosConDiferencia} / {sel!.movimientos}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="-mt-3 text-[10px] text-slate-500">
            Tocá un mes para ver el detalle por producto. «Mov. con dif.» cuenta los movimientos donde el total de Valoración no coincide con la cantidad del
            Historial de movimientos (se compara contra todas las capas del movimiento, porque Odoo genera capas nuevas al editar un movimiento hecho);
            «Dif. vs historial» son las unidades de esa diferencia. Las unidades suman distintas UdM (kg, unidades, metros):
            mirá la UdM en el detalle por producto.
          </p>

          <div>
            <h3 title="Valoración: $ neto de las capas de ajuste agrupado por la categoría del producto en Odoo." className="mb-3 border-b border-slate-800 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">$ neto por categoría</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th title="Categoría del producto en Odoo." className="p-2 font-medium">Categoría</th>
                    {MESES.map((m) => (
                      <th key={m} className="p-2 text-right font-medium">{m}</th>
                    ))}
                    <th title="Suma de los meses del período elegido." className="p-2 text-right font-medium">Total {periodo}</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriasSel.map((c) => (
                    <tr key={c.categoria} className="border-t border-slate-800">
                      <td className="p-2 text-slate-200">{c.categoria}</td>
                      {c.netoValor.map((v, i) => (
                        <td key={i} className={`p-2 text-right tabular-nums ${v === 0 ? 'text-slate-600' : signClass(v)} ${enRango(i) ? '' : 'opacity-40'}`}>{v === 0 ? '·' : formatCompactCurrency(v)}</td>
                      ))}
                      <td className={`p-2 text-right font-medium tabular-nums ${signClass(c.totalSel)}`}>{formatCompactCurrency(c.totalSel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.anomalos.length > 0 && (
            <details className="rounded-lg border border-amber-900 bg-amber-950/30 p-4">
              <summary className="cursor-pointer text-sm font-medium text-amber-300">
                Capas con valores imposibles (excluidas de los totales) · {data.anomalos.length}
              </summary>
              <p className="mt-2 text-xs text-slate-400">
                Cantidades o importes absurdos que quedaron en Odoo (error viejo del sistema) y que romperían cualquier suma.
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-300">
                {data.anomalos.map((a, i) => (
                  <li key={i}>
                    {a.fecha.slice(0, 10)} · {a.producto} · {a.movimiento} · cant. {a.cantidad.toExponential(2)} · $ {a.valor.toExponential(2)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export default function AjustesInventarioApp() {
  return (
    <QueryProvider>
      <AjustesInner />
    </QueryProvider>
  );
}
