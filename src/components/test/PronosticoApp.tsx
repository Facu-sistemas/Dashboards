import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import { useChartTheme } from '../shared/useChartTheme';
import KpiCard from '../shared/KpiCard';
import LastUpdated from '../shared/LastUpdated';
import { int, money, monthShort, qty } from '../compras/format';
import type { AlertaRow, PronosticoResult, SerieMensual } from '../../lib/odoo/pronostico-compras';

type Estado = 'ya' | 'pronto' | 'ok';

const ESTADO_INFO: Record<Estado, { label: string; icon: string; className: string }> = {
  ya: { label: 'Comprar ya', icon: '●', className: 'border-red-900 bg-red-950/50 text-red-300' },
  pronto: { label: 'Comprar pronto', icon: '◐', className: 'border-amber-900 bg-amber-950/40 text-amber-300' },
  ok: { label: 'OK', icon: '○', className: 'border-slate-700 bg-slate-800/40 text-slate-400' },
};
const ESTADO_ORDEN: Record<Estado, number> = { ya: 0, pronto: 1, ok: 2 };

const SELECT_CLASS = 'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';
const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500';
const thR = `${th} text-right`;
const td = 'px-3 py-2 text-slate-300';
const tdR = `${td} text-right tabular-nums`;
const compact = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 0 });

interface Calculada {
  r: AlertaRow;
  estado: Estado;
  plazo: number;
  sugerido: number;
}

/**
 * Comprar ya: debajo del mínimo (contando lo que está por entrar) o la cobertura no llega al plazo del proveedor.
 * Comprar pronto: la cobertura no llega a plazo + horizonte.
 * Sugerido: llevar el stock hasta el máximo de la regla, o hasta mínimo + consumo de (plazo + horizonte) si eso es más.
 */
function calcular(r: AlertaRow, horizonte: number, plazoDefault: number): Calculada {
  const plazo = r.plazoDias ?? plazoDefault;
  const enMano = r.disponible + r.entrante;
  let estado: Estado = 'ok';
  if (enMano < r.minimo) estado = 'ya';
  else if (r.diasCobertura !== null && r.diasCobertura <= plazo) estado = 'ya';
  else if (r.diasCobertura !== null && r.diasCobertura <= plazo + horizonte) estado = 'pronto';

  let sugerido = 0;
  if (estado !== 'ok') {
    const objetivo = Math.max(r.maximo, r.minimo + r.consumoDiario * (plazo + horizonte));
    sugerido = Math.max(objetivo - enMano, 0);
    if (sugerido > 0 && sugerido < r.minCompra) sugerido = r.minCompra;
  }
  return { r, estado, plazo, sugerido };
}

function Section({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
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

function EstadoBadge({ estado }: { estado: Estado }) {
  const info = ESTADO_INFO[estado];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-xs ${info.className}`}>
      <span aria-hidden>{info.icon}</span>
      {info.label}
    </span>
  );
}

function Inner() {
  const query = useApiQuery<PronosticoResult>(['pronostico-compras'], '/api/pronostico-compras');
  const data = query.data;

  const [horizonte, setHorizonte] = useState(30);
  const [plazoDefault, setPlazoDefault] = useState(15);
  const [estadoFilter, setEstadoFilter] = useState<Estado | 'avisos' | ''>('avisos');
  const [categoria, setCategoria] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [categoriaReporte, setCategoriaReporte] = useState('');

  const calculadas = useMemo(() => (data ? data.alertas.map((r) => calcular(r, horizonte, plazoDefault)) : []), [data, horizonte, plazoDefault]);

  const filas = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return calculadas
      .filter(
        (c) =>
          (estadoFilter === '' || (estadoFilter === 'avisos' ? c.estado !== 'ok' : c.estado === estadoFilter)) &&
          (!categoria || c.r.categoria === categoria) &&
          (!needle || c.r.nombre.toLowerCase().includes(needle) || (c.r.proveedor ?? '').toLowerCase().includes(needle))
      )
      .sort((a, b) => ESTADO_ORDEN[a.estado] - ESTADO_ORDEN[b.estado] || (a.r.diasCobertura ?? Infinity) - (b.r.diasCobertura ?? Infinity));
  }, [calculadas, estadoFilter, categoria, search]);

  const nYa = calculadas.filter((c) => c.estado === 'ya').length;
  const nPronto = calculadas.filter((c) => c.estado === 'pronto').length;
  const montoSugerido = calculadas.reduce((s, c) => s + c.sugerido * c.r.costo, 0);

  if (query.isError && !data) {
    return <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">No se pudo cargar: {(query.error as Error).message}</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        <button type="button" onClick={() => void query.refetch()} className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
          {query.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <Section
        title="Avisos de compra"
        subtitle={
          <>
            Cuántos días te alcanza cada insumo: (disponible + entrante − mínimo) ÷ consumo diario real de los últimos 3 meses. Si no llega al plazo del
            proveedor (o ya está debajo del mínimo) → <span className="text-red-300">comprar ya</span>; si no llega a plazo + horizonte →{' '}
            <span className="text-amber-300">comprar pronto</span>. Mínimo y máximo salen de las reglas de reabastecimiento de Odoo.
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Comprar ya" value={nYa} isLoading={!data} />
          <KpiCard label="Comprar pronto" value={nPronto} isLoading={!data} />
          <KpiCard label="Monto sugerido (costo estándar)" value={montoSugerido} format="currency" isLoading={!data} />
          <KpiCard label="Insumos analizados" value={data?.alertas.length} isLoading={!data} />
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          <label className="flex flex-col gap-1">
            Horizonte
            <select value={horizonte} onChange={(e) => setHorizonte(Number(e.target.value))} className={SELECT_CLASS}>
              {[15, 30, 45, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} días
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1" title="La mayoría de los proveedores en Odoo tienen el plazo de entrega en 0 o 1 día: en esos casos se usa este valor.">
            Plazo si no está cargado
            <select value={plazoDefault} onChange={(e) => setPlazoDefault(Number(e.target.value))} className={SELECT_CLASS}>
              {[7, 10, 15, 20, 30, 45].map((d) => (
                <option key={d} value={d}>
                  {d} días
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Mostrar
            <select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value as Estado | 'avisos' | '')} className={SELECT_CLASS}>
              <option value="avisos">Solo avisos</option>
              <option value="ya">Comprar ya</option>
              <option value="pronto">Comprar pronto</option>
              <option value="ok">OK</option>
              <option value="">Todos</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={SELECT_CLASS}>
              <option value="">Todas</option>
              {(data?.categoriasAlertas ?? []).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Buscar
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Insumo o proveedor…" className={SELECT_CLASS} />
          </label>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-slate-800">
              <tr>
                <th className={th}>Estado</th>
                <th className={th}>Insumo</th>
                <th className={th}>Proveedor</th>
                <th className={thR}>Disp. + entrante</th>
                <th className={thR}>Mínimo</th>
                <th className={thR}>Consumo / mes</th>
                <th className={thR}>Alcanza (días)</th>
                <th className={thR}>Plazo</th>
                <th className={thR}>Sugerido</th>
                <th className={thR}>Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {!data && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Cargando desde Odoo… (la primera vez puede tardar unos segundos)
                  </td>
                </tr>
              )}
              {data && filas.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Sin insumos para estos filtros.
                  </td>
                </tr>
              )}
              {filas.map((c) => (
                <Fragment key={c.r.productId}>
                  <tr className="cursor-pointer hover:bg-slate-800/50" onClick={() => setExpanded(expanded === c.r.productId ? null : c.r.productId)}>
                    <td className={td}>
                      <EstadoBadge estado={c.estado} />
                    </td>
                    <td className={`${td} text-slate-100`}>
                      {c.r.nombre}
                      <span className="block text-xs text-slate-500">{c.r.categoria}</span>
                    </td>
                    <td className={td}>{c.r.proveedor ?? '—'}</td>
                    <td className={tdR}>
                      {qty(c.r.disponible + c.r.entrante)} <span className="text-xs text-slate-500">{c.r.uom}</span>
                    </td>
                    <td className={tdR}>{c.r.minimo > 0 ? qty(c.r.minimo) : '—'}</td>
                    <td className={tdR}>{qty(c.r.consumoDiario * 30)}</td>
                    <td className={`${tdR} ${c.estado === 'ya' ? 'font-medium text-slate-100' : ''}`}>
                      {c.r.diasCobertura === null ? 'sin consumo' : c.r.diasCobertura < 0 ? 'debajo del mín.' : int.format(c.r.diasCobertura)}
                    </td>
                    <td className={tdR}>
                      {c.plazo} d{c.r.plazoDias === null && <span className="text-xs text-slate-500"> (s/cargar)</span>}
                    </td>
                    <td className={`${tdR} ${c.sugerido > 0 ? 'font-medium text-slate-100' : ''}`}>{c.sugerido > 0 ? qty(Math.ceil(c.sugerido)) : '—'}</td>
                    <td className={tdR}>{c.sugerido > 0 ? money.format(c.sugerido * c.r.costo) : '—'}</td>
                  </tr>
                  {expanded === c.r.productId && data && (
                    <tr className="bg-slate-950/60">
                      <td colSpan={10} className="px-3 py-3">
                        <DetalleInsumo c={c} meses={data.mesesDetalle} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Pronóstico vs. realidad, mes a mes"
        subtitle={
          <>
            <span className="text-slate-200">Pronóstico</span> = lo que la regla de arriba hubiera dicho a principio de mes (promedio de consumo de los 3 meses
            anteriores). <span className="text-slate-200">Consumo</span> = lo que realmente se usó en fabricación.{' '}
            <span className="text-slate-200">Compras</span> = órdenes de compra confirmadas, en pesos. Todo a costo estándar actual, para que los meses sean
            comparables.
          </>
        }
      >
        {data && <Reporte data={data} categoria={categoriaReporte} setCategoria={setCategoriaReporte} />}
        {!data && <div className="h-72 animate-pulse-slow rounded bg-slate-800" />}
      </Section>

      {data && data.lineasSospechosas.length > 0 && (
        <Section
          title="Compras para revisar en Odoo"
          subtitle="Líneas cuyo precio por unidad supera 20 veces el costo estándar y las demás compras del mismo producto. En dólares suele ser un precio en pesos cargado en una orden en USD: el reporte la toma a costo estándar. En pesos suele ser la unidad mal elegida (ej. metros en vez de bobinas): el importe está bien y el reporte lo deja como está."
        >
          <div className="overflow-x-auto rounded-lg border border-amber-900/60 bg-slate-900">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className={th}>Mes</th>
                  <th className={th}>Orden</th>
                  <th className={th}>Proveedor</th>
                  <th className={th}>Producto</th>
                  <th className={thR}>Cantidad</th>
                  <th className={thR}>Precio unit.</th>
                  <th className={thR}>Importe en Odoo</th>
                  <th className={thR}>Usado en el reporte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.lineasSospechosas.map((l, i) => (
                  <tr key={i}>
                    <td className={td}>
                      {monthShort(l.mes)} {l.mes.slice(0, 4)}
                    </td>
                    <td className={`${td} text-slate-100`}>{l.orden}</td>
                    <td className={td}>{l.proveedor}</td>
                    <td className={td}>{l.producto}</td>
                    <td className={tdR}>{qty(l.cantidad)}</td>
                    <td className={tdR}>
                      {l.moneda} {qty(l.precioUnitario)}
                    </td>
                    <td className={`${tdR} ${l.corregida ? 'text-amber-300' : ''}`}>{money.format(l.importeOdoo)}</td>
                    <td className={tdR}>
                      {money.format(l.importeCorregido)}
                      <span className="block text-xs text-slate-500">{l.corregida ? 'a costo estándar' : 'sin cambios · revisar unidad'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function DetalleInsumo({ c, meses }: { c: Calculada; meses: string[] }) {
  const cell = 'px-2 py-1 text-right tabular-nums';
  const r = c.r;
  return (
    <div className="flex flex-wrap gap-8 text-xs text-slate-400">
      <div>
        <p className="mb-1 text-slate-500">Consumo real por mes ({r.uom})</p>
        <table>
          <thead>
            <tr>
              {meses.map((m) => (
                <th key={m} className={`${cell} font-medium text-slate-500`}>
                  {monthShort(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {r.consumoMensual.map((v, i) => (
                <td key={i} className={cell}>
                  {qty(v)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt>Disponible</dt>
        <dd className="text-right tabular-nums text-slate-300">{qty(r.disponible)}</dd>
        <dt>Entrante</dt>
        <dd className="text-right tabular-nums text-slate-300">{qty(r.entrante)}</dd>
        <dt>Mínimo / máximo</dt>
        <dd className="text-right tabular-nums text-slate-300">
          {qty(r.minimo)} / {qty(r.maximo)}
        </dd>
        <dt>Consumo diario</dt>
        <dd className="text-right tabular-nums text-slate-300">{qty(r.consumoDiario)}</dd>
        <dt>Mín. de compra proveedor</dt>
        <dd className="text-right tabular-nums text-slate-300">{r.minCompra > 0 ? qty(r.minCompra) : '—'}</dd>
        <dt>Costo estándar</dt>
        <dd className="text-right tabular-nums text-slate-300">{money.format(r.costo)}</dd>
      </dl>
    </div>
  );
}

function Reporte({ data, categoria, setCategoria }: { data: PronosticoResult; categoria: string; setCategoria: (c: string) => void }) {
  const theme = useChartTheme();
  const serie: SerieMensual = (categoria && data.categorias.find((c) => c.categoria === categoria)) || data.total;
  const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

  let acumulado = 0;
  const filas = data.meses.map((m, i) => {
    const pronostico = serie.pronostico[i]!;
    const consumo = serie.consumo[i]!;
    const compras = serie.compras[i]!;
    acumulado += compras - consumo;
    return { m, pronostico, consumo, compras, acumulado, label: `${monthShort(m)} ${m.slice(2, 4)}` };
  });
  const totPron = sum(serie.pronostico);
  const totCons = sum(serie.consumo);
  const totComp = sum(serie.compras);
  const desvio = (real: number, pron: number) => (pron > 0 ? pct.format((real - pron) / pron) : '—');
  const usado = (cons: number, comp: number) => (comp > 0 ? pct.format(cons / comp) : '—');

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Pronosticado (12 meses)" value={totPron} format="currency" />
        <KpiCard label="Consumido (12 meses)" value={totCons} format="currency" />
        <KpiCard label="Comprado (12 meses)" value={totComp} format="currency" />
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">De lo comprado se usó</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{usado(totCons, totComp)}</p>
          <p className="text-xs text-slate-500">Error del pronóstico: {desvio(totCons, totPron)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
        <label className="flex flex-col gap-1">
          Categoría
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={SELECT_CLASS}>
            <option value="">Todas</option>
            {data.categorias.map((c) => (
              <option key={c.categoria}>{c.categoria}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <ComposedChart data={filas} barGap={2}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 12 }} />
              <YAxis stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 12 }} tickFormatter={(v: number) => `$${compact.format(v)}`} width={64} />
              <Tooltip
                formatter={(v) => money.format(Number(v))}
                contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText }}
                cursor={{ fill: theme.grid, opacity: 0.4 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: theme.axisSecondary }} />
              <Bar dataKey="compras" name="Compras" fill={theme.primary} radius={[4, 4, 0, 0]} />
              <Bar dataKey="consumo" name="Consumo real" fill={theme.secondary} radius={[4, 4, 0, 0]} />
              <Line dataKey="pronostico" name="Pronóstico" stroke={theme.tooltipText} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-slate-800">
            <tr>
              <th className={th}>Mes</th>
              <th className={thR}>Pronóstico</th>
              <th className={thR}>Consumo real</th>
              <th className={thR}>Error pronóstico</th>
              <th className={thR}>Compras</th>
              <th className={thR}>% de lo comprado usado</th>
              <th className={thR} title="Compras − consumo acumulado desde el primer mes: si crece, se está comprando más de lo que se usa (stock que se acumula).">
                Compras − consumo acum.
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filas.map((f) => (
              <tr key={f.m}>
                <td className={`${td} text-slate-100`}>
                  {monthShort(f.m)} {f.m.slice(0, 4)}
                </td>
                <td className={tdR}>{money.format(f.pronostico)}</td>
                <td className={tdR}>{money.format(f.consumo)}</td>
                <td className={tdR}>{desvio(f.consumo, f.pronostico)}</td>
                <td className={tdR}>{money.format(f.compras)}</td>
                <td className={tdR}>{usado(f.consumo, f.compras)}</td>
                <td className={`${tdR} ${f.acumulado > 0 ? 'text-amber-300' : ''}`}>{money.format(f.acumulado)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-700">
            <tr>
              <td className={`${td} font-medium text-slate-100`}>Total</td>
              <td className={`${tdR} font-semibold text-slate-100`}>{money.format(totPron)}</td>
              <td className={`${tdR} font-semibold text-slate-100`}>{money.format(totCons)}</td>
              <td className={tdR}>{desvio(totCons, totPron)}</td>
              <td className={`${tdR} font-semibold text-slate-100`}>{money.format(totComp)}</td>
              <td className={tdR}>{usado(totCons, totComp)}</td>
              <td className={tdR}>{money.format(totComp - totCons)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

export default function PronosticoApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
