import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import { useChartTheme } from '../shared/useChartTheme';
import KpiCard from '../shared/KpiCard';
import LastUpdated from '../shared/LastUpdated';
import { dec, int, money, monthShort } from './format';
import type { CriterioGasto, Empresa, GastoRealResult, RotacionResult, Valorizacion } from '../../lib/odoo/rotacion-gasto';

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500';
const thR = `${th} text-right`;
const td = 'px-3 py-2 text-slate-300';
const tdR = `${td} text-right tabular-nums`;
const compact = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
const short = (v: number) => (v === 0 ? '—' : `$${compact.format(v)}`);
const PALETTE = ['primary', 'secondary', 'warn', 'danger', 'axisSecondary', 'mutedBar'] as const;
const tooltipStyle = (t: ReturnType<typeof useChartTheme>) => ({ background: t.tooltipBg, border: `1px solid ${t.tooltipBorder}`, color: t.tooltipText });

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function ComoSeCalcula({ meses }: { meses: string[] | undefined }) {
  const n = meses?.length ?? 16;
  const p = 'text-sm text-slate-400';
  const b = 'font-medium text-slate-200';
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-200">¿Cómo se calcula? (para conciliar con tus números)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className={p}>
          <span className={b}>Alcance.</span> Solo productos de la categoría Materia Prima (ID 14) y sus subcategorías, incluidos los archivados. Las empresas
          son las tildadas arriba (por defecto, todas). Todo sale de <code>stock.valuation.layer</code> (capas de valoración), no de <code>stock.quant</code>.
        </p>
        <p className={p}>
          <span className={b}>1. Stock al cierre de cada mes.</span> Por producto, suma de cantidad y valor de <em>todas</em> las capas creadas antes del
          1° del mes siguiente (acumulado histórico desde el primer movimiento). Es el criterio del informe «Valoración a fecha» de Odoo. También se calcula
          la apertura, al 1° del primer mes. El período tiene {n} meses cerrados, así que hay {n + 1} puntos de stock (apertura + {n} cierres).
        </p>
        <p className={p}>
          <span className={b}>2. Consumo del mes.</span> Capas cuyo movimiento es una materia prima consumida por una orden de fabricación
          (<code>raw_material_production_id</code>), agrupadas por mes de creación. Cantidad y valor son negativos en Odoo, por eso se invierte el signo.
          No cuenta ventas de materia prima, ajustes de inventario ni transferencias.
        </p>
        <p className={p}>
          <span className={b}>3. Dos valorizaciones.</span> <em>Según Odoo (capas)</em> usa el valor que registró cada movimiento. <em>A costo actual</em> usa la
          cantidad de las capas × el costo estándar de hoy del producto. Para el stock de cada cierre y para el consumo se aplica el mismo criterio. Cuando una
          capa histórica tiene el costo mal cargado, las dos valorizaciones difieren mucho: ahí suele estar la diferencia con otros cálculos.
        </p>
        <p className={p}>
          <span className={b}>4. Inventario promedio</span> = promedio simple de los {n + 1} puntos de stock (apertura + cierres), no ponderado por días.
        </p>
        <p className={p}>
          <span className={b}>5. Rotación</span> = consumo total del período ÷ inventario promedio. <span className={b}>Rotación anualizada</span> = rotación × 365 ÷ días
          del período. <span className={b}>Días de inventario</span> = inventario promedio ÷ (consumo total ÷ días del período).
        </p>
        <p className={p}>
          <span className={b}>6. Totales.</span> La fila Total suma el stock y el consumo de todas las categorías mes a mes y recién después calcula el promedio y
          la rotación. No es el promedio de las rotaciones de cada categoría.
        </p>
        <p className={p}>
          <span className={b}>Causas habituales de diferencia:</span> mirar otra valorización (capas vs. costo actual), otro conjunto de empresas, incluir el mes en
          curso (acá solo hay meses cerrados), contar como consumo algo más que las órdenes de fabricación, o tomar el promedio solo de los cierres sin la apertura.
        </p>
      </div>
    </details>
  );
}

function periodLabel(meses: string[]): string {
  const f = (m: string) => `${monthShort(m)} ${m.slice(0, 4)}`;
  return `${f(meses[0]!)} – ${f(meses[meses.length - 1]!)}`;
}

/** `null` = todas las empresas (no se manda el parámetro). */
function empresasParam(seleccion: number[] | null): string {
  return seleccion ? `&empresas=${seleccion.join(',')}` : '';
}

function EmpresaSelector({ empresas, seleccion, onChange }: { empresas: Empresa[]; seleccion: number[] | null; onChange: (s: number[] | null) => void }) {
  const activa = (id: number) => seleccion === null || seleccion.includes(id);
  function toggle(id: number) {
    const actual = seleccion ?? empresas.map((e) => e.id);
    const next = actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id];
    // Nunca dejar ninguna tildada; todas tildadas vuelve a `null` (= todas).
    if (next.length === 0) return;
    onChange(next.length === empresas.length ? null : next.sort((a, b) => a - b));
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
      <span className="text-slate-400">Empresa</span>
      {empresas.length === 0 && <span className="text-slate-500">Cargando…</span>}
      {empresas.map((e) => (
        <label key={e.id} className="flex items-center gap-2">
          <input type="checkbox" checked={activa(e.id)} onChange={() => toggle(e.id)} />
          {e.name}
        </label>
      ))}
    </div>
  );
}

function Rotacion({ seleccion }: { seleccion: number[] | null }) {
  const query = useApiQuery<RotacionResult>(['rotacion-categoria', seleccion], `/api/rotacion-gasto?vista=rotacion${empresasParam(seleccion)}`);
  const theme = useChartTheme();
  const [open, setOpen] = useState<number | null>(null);
  const [valorizacion, setValorizacion] = useState<Valorizacion>('actual');
  const data = query.data;
  const total = data?.total[valorizacion];

  if (query.isError && !data) {
    return <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">No se pudo cargar la rotación: {(query.error as Error).message}</p>;
  }

  const chartData = (data?.categorias ?? [])
    .map((c) => ({ categoria: c.categoria, m: c[valorizacion] }))
    .filter(({ m }) => m.rotacionAnual !== null && m.consumoTotal > 0)
    .map(({ categoria, m }) => ({ categoria, rotacion: Number(m.rotacionAnual!.toFixed(2)) }));

  const valorizaciones = [
    { value: 'actual', label: 'A costo actual', hint: 'Cantidades × costo estándar de hoy' },
    { value: 'capas', label: 'Según Odoo (capas)', hint: 'Valor registrado en cada movimiento' },
  ] as const;

  return (
    <Section
      title="Rotación por categoría"
      subtitle={`Consumo valorizado ÷ inventario promedio. Período: ${data ? periodLabel(data.meses) : '…'}. Inventario = promedio de los cierres de mes.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {valorizaciones.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setValorizacion(v.value)}
            className={`rounded border px-3 py-1.5 text-left text-sm ${valorizacion === v.value ? 'border-brand-500 bg-slate-800 text-slate-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
          >
            <span className="block">{v.label}</span>
            <span className="block text-xs text-slate-500">{v.hint}</span>
          </button>
        ))}
        {valorizacion === 'capas' && (
          <p className="text-xs text-amber-400">
            Ojo: hay movimientos históricos con costo mal cargado en Odoo que inflan estos valores (ej. hilos de Mercería).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Inventario promedio" value={total?.inventarioPromedio} format="currency" isLoading={!data} />
        <KpiCard label="Consumo del período" value={total?.consumoTotal} format="currency" isLoading={!data} />
        <KpiCard label="Rotación anualizada (veces)" value={total?.rotacionAnual ?? undefined} isLoading={!data} />
        <KpiCard label="Días de inventario" value={total?.diasInventario ?? undefined} isLoading={!data} />
      </div>

      <ComoSeCalcula meses={data?.meses} />

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <p className="mb-2 text-sm font-medium text-slate-200">Rotación anualizada por categoría (veces por año)</p>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="categoria" stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 12 }} width={40} />
              <Tooltip formatter={(v) => `${dec.format(Number(v))} veces/año`} contentStyle={tooltipStyle(theme)} cursor={{ fill: theme.grid, opacity: 0.4 }} />
              <Bar dataKey="rotacion" name="Rotación anualizada" fill={theme.primary} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-slate-800">
            <tr>
              <th className={th}>Categoría</th>
              <th className={thR}>Inventario promedio</th>
              <th className={thR}>Consumo período</th>
              <th className={thR}>Rotación</th>
              <th className={thR}>Rotación anual</th>
              <th className={thR}>Días de inventario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {!data && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  Calculando desde las capas de valoración de Odoo… (puede tardar un rato la primera vez)
                </td>
              </tr>
            )}
            {(data?.categorias ?? []).map((cat) => {
              const c = cat[valorizacion];
              return (
              <Fragment key={cat.categoriaId}>
                <tr className="cursor-pointer hover:bg-slate-800/50" onClick={() => setOpen(open === cat.categoriaId ? null : cat.categoriaId)}>
                  <td className={`${td} text-slate-100`}>{cat.categoria}</td>
                  <td className={tdR}>{money.format(c.inventarioPromedio)}</td>
                  <td className={tdR}>{money.format(c.consumoTotal)}</td>
                  <td className={tdR}>{c.rotacion === null ? '—' : dec.format(c.rotacion)}</td>
                  <td className={`${tdR} font-medium text-slate-100`}>{c.rotacionAnual === null ? '—' : dec.format(c.rotacionAnual)}</td>
                  <td className={tdR}>{c.diasInventario === null ? '—' : int.format(c.diasInventario)}</td>
                </tr>
                {open === cat.categoriaId && data && (
                  <tr className="bg-slate-950/60">
                    <td colSpan={6} className="overflow-x-auto px-3 py-3">
                      <table className="text-xs text-slate-400">
                        <thead>
                          <tr>
                            <th />
                            {data.meses.map((m) => (
                              <th key={m} className="px-2 py-1 text-right font-medium text-slate-500">
                                {monthShort(m)} {m.slice(2, 4)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="pr-3 text-slate-500">Stock al cierre</td>
                            {c.stockCierre.map((v, i) => (
                              <td key={i} className="px-2 py-1 text-right tabular-nums">{short(v)}</td>
                            ))}
                          </tr>
                          <tr>
                            <td className="pr-3 text-slate-500">Consumo</td>
                            {c.consumo.map((v, i) => (
                              <td key={i} className="px-2 py-1 text-right tabular-nums">{short(v)}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
    </Section>
  );
}

function GastoReal({ seleccion }: { seleccion: number[] | null }) {
  const [criterio, setCriterio] = useState<CriterioGasto>('ordenes');
  const query = useApiQuery<GastoRealResult>(['gasto-real', criterio, seleccion], `/api/rotacion-gasto?vista=gasto&criterio=${criterio}${empresasParam(seleccion)}`);
  const theme = useChartTheme();
  const [open, setOpen] = useState<string | null>(null);
  const data = query.data;

  const { chartData, series } = useMemo(() => {
    if (!data) return { chartData: [], series: [] as string[] };
    const top = data.categorias.slice(0, 5).map((c) => c.categoria);
    const series = [...top, 'Otras'];
    const chartData = data.months.map((m, i) => {
      const row: Record<string, number | string> = { label: monthShort(m) };
      let otras = 0;
      for (const c of data.categorias) {
        if (top.includes(c.categoria)) row[c.categoria] = c.mensual[i]!;
        else otras += c.mensual[i]!;
      }
      row['Otras'] = otras;
      return row;
    });
    return { chartData, series };
  }, [data]);

  const criterios = [
    { value: 'ordenes', label: 'Órdenes de compra confirmadas', hint: 'Gestión de Compras' },
    { value: 'facturas', label: 'Facturas de proveedor', hint: 'Impacto financiero' },
  ] as const;

  return (
    <Section title="Gasto real por mes" subtitle="En pesos. Las órdenes en otra moneda se convierten con el tipo de cambio de la propia orden; las notas de crédito restan.">
      <div className="flex flex-wrap items-center gap-2">
        {criterios.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCriterio(c.value)}
            className={`rounded border px-3 py-1.5 text-left text-sm ${criterio === c.value ? 'border-brand-500 bg-slate-800 text-slate-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
          >
            <span className="block">{c.label}</span>
            <span className="block text-xs text-slate-500">{c.hint}</span>
          </button>
        ))}
        <div className="ml-auto">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
      </div>

      {query.isError && !data && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">No se pudo cargar el gasto: {(query.error as Error).message}</p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label={`Gasto ${data?.year ?? ''} acumulado`} value={data?.total} format="currency" isLoading={!data} />
        <KpiCard label="Categorías con gasto" value={data?.categorias.length} isLoading={!data} />
        {criterio === 'ordenes' && <KpiCard label="Órdenes en moneda extranjera" value={data?.ordenesEnMonedaExtranjera} isLoading={!data} />}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 12 }} />
              <YAxis stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 12 }} tickFormatter={(v: number) => `$${compact.format(v)}`} width={64} />
              <Tooltip formatter={(v) => money.format(Number(v))} contentStyle={tooltipStyle(theme)} cursor={{ fill: theme.grid, opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: theme.axisSecondary }} />
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} stackId="a" fill={theme[PALETTE[i % PALETTE.length]!]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {criterio === 'ordenes' && data && data.mayoresLineas.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-medium text-slate-200">Mayores líneas de compra del año</p>
          <p className="mb-2 text-xs text-slate-500">Para detectar a simple vista una orden mal cargada (ej. un precio en pesos dentro de una orden en USD).</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="px-2 py-1 text-left font-medium">Orden</th>
                  <th className="px-2 py-1 text-left font-medium">Producto</th>
                  <th className="px-2 py-1 text-left font-medium">Proveedor</th>
                  <th className="px-2 py-1 text-right font-medium">Cantidad</th>
                  <th className="px-2 py-1 text-right font-medium">Precio unit.</th>
                  <th className="px-2 py-1 text-left font-medium">Moneda</th>
                  <th className="px-2 py-1 text-right font-medium">Importe en pesos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {data.mayoresLineas.map((l, i) => (
                  <tr key={`${l.orden}-${i}`}>
                    <td className="px-2 py-1">{l.orden}</td>
                    <td className="px-2 py-1">{l.producto}</td>
                    <td className="px-2 py-1">{l.proveedor}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{int.format(l.cantidad)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{dec.format(l.precioUnitario)}</td>
                    <td className="px-2 py-1">{l.moneda}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-100">{money.format(l.importePesos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-slate-800">
            <tr>
              <th className={th}>Categoría</th>
              {(data?.months ?? []).map((m) => (
                <th key={m} className={thR}>{monthShort(m)}</th>
              ))}
              <th className={thR}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {!data && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-slate-500">Cargando desde Odoo…</td>
              </tr>
            )}
            {(data?.categorias ?? []).map((c) => (
              <Fragment key={c.categoria}>
                <tr className="cursor-pointer hover:bg-slate-800/50" onClick={() => setOpen(open === c.categoria ? null : c.categoria)}>
                  <td className={`${td} text-slate-100`}>{c.categoria}</td>
                  {c.mensual.map((v, i) => (
                    <td key={i} className={tdR}>{short(v)}</td>
                  ))}
                  <td className={`${tdR} font-medium text-slate-100`}>{money.format(c.total)}</td>
                </tr>
                {open === c.categoria &&
                  data?.productos
                    .filter((p) => p.categoria === c.categoria)
                    .slice(0, 25)
                    .map((p) => (
                      <tr key={p.productId} className="bg-slate-950/60 text-xs">
                        <td className="px-3 py-1.5 pl-8 text-slate-400">{p.producto}</td>
                        {p.mensual.map((v, i) => (
                          <td key={i} className="px-3 py-1.5 text-right tabular-nums text-slate-400">{short(v)}</td>
                        ))}
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{money.format(p.total)}</td>
                      </tr>
                    ))}
              </Fragment>
            ))}
          </tbody>
          {data && (
            <tfoot className="border-t border-slate-700">
              <tr>
                <td className={`${td} font-medium text-slate-100`}>Total</td>
                {data.totalMensual.map((v, i) => (
                  <td key={i} className={`${tdR} font-medium text-slate-100`}>{short(v)}</td>
                ))}
                <td className={`${tdR} font-semibold text-slate-100`}>{money.format(data.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-500">Click en una categoría para ver sus 25 productos con más gasto.</p>
    </Section>
  );
}

function Inner() {
  const empresasQuery = useApiQuery<Empresa[]>(['rotacion-gasto-empresas'], '/api/rotacion-gasto?vista=empresas');
  // null = todas las empresas (default).
  const [seleccion, setSeleccion] = useState<number[] | null>(null);
  return (
    <div className="flex flex-col gap-10">
      <EmpresaSelector empresas={empresasQuery.data ?? []} seleccion={seleccion} onChange={setSeleccion} />
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
        <span className="font-medium text-slate-200">Detalle por producto (Excel, con ID y nombre en pantalla)</span>
        <a
          href={`/api/rotacion-gasto-export?tipo=gasto${empresasParam(seleccion)}`}
          className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
        >
          Descargar gasto real (líneas de factura)
        </a>
        <a
          href={`/api/rotacion-gasto-export?tipo=stock${empresasParam(seleccion)}`}
          className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
        >
          Descargar stock de fin de mes
        </a>
        <a
          href={`/api/rotacion-gasto-export?tipo=oc${empresasParam(seleccion)}`}
          className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
        >
          Descargar OC pendientes de recibir
        </a>
      </div>
      <Rotacion seleccion={seleccion} />
      <GastoReal seleccion={seleccion} />
    </div>
  );
}

export default function RotacionGastoApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
