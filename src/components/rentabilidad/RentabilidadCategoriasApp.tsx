import { Fragment, useState } from 'react';
import Etiqueta, { GlosarioProvider } from './Etiqueta';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { useChartTheme } from '@/components/shared/useChartTheme';
import { fmtFechaHora, fmtMoney, fmtNumber, fmtPct, MESES_CORTO } from '@/lib/rentabilidad/format';
import type { CategoriasResultado, EvolucionResultado, FiltrosRentabilidad, ProductosResultado } from '@/lib/rentabilidad/types';
import RentabilidadFiltros from './RentabilidadFiltros';
import AvisosRentabilidad from './AvisosRentabilidad';
import KpiRentabilidad from './KpiRentabilidad';
import { CeldasMetricas, EncabezadosMetricas } from './CeldasMetricas';
import { filtrosQuery } from './query';

function compacto(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return fmtMoney(v);
}

function Evolucion({ filtros, templateId }: { filtros: FiltrosRentabilidad; templateId: number }) {
  const chartTheme = useChartTheme();
  const q = filtrosQuery(filtros, { evolucion: templateId });
  const query = useApiQuery<EvolucionResultado>(['rentabilidad-evolucion', q], `/api/rentabilidad/categorias?${q}`);
  if (query.isLoading) return <p className="text-sm text-slate-500">Cargando evolución…</p>;
  if (query.error) return <p className="text-sm text-red-300">{(query.error as Error).message}</p>;
  const d = query.data;
  if (!d) return null;
  const hayCosto = d.meses.some((m) => m.costoUnitario !== null);
  const datos = d.meses.map((m) => ({
    mes: MESES_CORTO[m.mes - 1],
    venta: m.venta,
    precio: m.precioUnitario,
    costo: m.costoUnitario,
  }));
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div>
        <h3 className="text-sm font-medium text-slate-200">{d.producto}</h3>
        <p className="text-xs text-slate-500">
          {d.categoria}
          {d.subcategoria !== '(sin subcategoría)' ? ` / ${d.subcategoria}` : ''} · evolución mensual {filtros.anio}
          {hayCosto ? '' : ' · precio unitario real facturado (sin costo disponible)'}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={datos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={11} />
          <YAxis yAxisId="venta" stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => compacto(Number(v))} width={64} />
          <YAxis yAxisId="precio" orientation="right" stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => compacto(Number(v))} width={64} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number) => fmtMoney(value)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="venta" dataKey="venta" name="Venta" fill={chartTheme.mutedBar} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="precio" dataKey="precio" name="Precio unitario" stroke={chartTheme.secondary} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          {hayCosto && <Line yAxisId="precio" dataKey="costo" name="Costo unitario" stroke={chartTheme.danger} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4 font-medium"><Etiqueta clave="mes">Mes</Etiqueta></th>
              <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="venta">Venta</Etiqueta></th>
              <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="cantidad">Cantidad</Etiqueta></th>
              <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="precioUnitario">Precio unitario</Etiqueta></th>
              <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="costoUnitario">Costo unitario</Etiqueta></th>
              <th className="py-2 text-right font-medium"><Etiqueta clave="contribucionPct">% Contrib.</Etiqueta></th>
            </tr>
          </thead>
          <tbody>
            {d.meses
              .filter((m) => m.venta !== 0 || m.cantidad !== 0)
              .map((m) => (
                <tr key={m.mes} className="border-b border-slate-800/60 text-slate-300">
                  <td className="py-2 pr-4">{MESES_CORTO[m.mes - 1]}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtMoney(m.venta)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(m.cantidad)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtMoney(m.precioUnitario)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtMoney(m.costoUnitario)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtPct(m.contribucionPct)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Productos({ filtros, categoria, subcategoria, onElegir }: { filtros: FiltrosRentabilidad; categoria: string; subcategoria: string | null; onElegir: (id: number) => void }) {
  const q = filtrosQuery(filtros, { productos: categoria, sub: subcategoria });
  const query = useApiQuery<ProductosResultado>(['rentabilidad-productos', q], `/api/rentabilidad/categorias?${q}`);
  if (query.isLoading) return <p className="px-4 py-3 text-sm text-slate-500">Cargando productos…</p>;
  if (query.error) return <p className="px-4 py-3 text-sm text-red-300">{(query.error as Error).message}</p>;
  const productos = query.data?.productos ?? [];
  if (productos.length === 0) return <p className="px-4 py-3 text-sm text-slate-500">Sin productos.</p>;
  return (
    <div className="max-h-[420px] overflow-auto px-4 py-3">
      <p className="mb-2 text-xs text-slate-500">Hacé click en un producto para ver su evolución mensual.</p>
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium"><Etiqueta clave="producto">Producto</Etiqueta></th>
            <EncabezadosMetricas />
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.templateId} onClick={() => onElegir(p.templateId)} className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/40">
              <td className="py-2 pr-4 text-slate-200">{p.producto}</td>
              <CeldasMetricas m={p} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Seleccion {
  categoria: string;
  subcategoria: string | null;
}

function CategoriasInner({ initialAnio }: { initialAnio: number }) {
  const [filtros, setFiltros] = useState<FiltrosRentabilidad>({ anio: initialAnio, mesIni: null, mesFin: null, categoria: null, clienteId: null, empresaId: null, costos: 'planilla' });
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [producto, setProducto] = useState<number | null>(null);
  const chartTheme = useChartTheme();

  const q = filtrosQuery(filtros);
  const query = useApiQuery<CategoriasResultado>(['rentabilidad-categorias', q], `/api/rentabilidad/categorias?${q}`);
  const data = query.data;
  const nombreEmpresa = filtros.empresaId === null ? 'Ambas empresas' : (data?.opciones.empresas.find((e) => e.id === filtros.empresaId)?.nombre ?? `Empresa ${filtros.empresaId}`);

  const reset = () => {
    setSeleccion(null);
    setProducto(null);
  };
  const alternar = (categoria: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(categoria)) next.delete(categoria);
      else next.add(categoria);
      return next;
    });
  const elegir = (s: Seleccion) => {
    setProducto(null);
    setSeleccion((actual) => (actual && actual.categoria === s.categoria && actual.subcategoria === s.subcategoria ? null : s));
  };
  const esSeleccion = (categoria: string, sub: string | null) => seleccion?.categoria === categoria && seleccion.subcategoria === sub;

  const datosGrafico = (data?.filas ?? []).map((f) => ({ categoria: f.categoria, venta: f.venta }));

  return (
    <GlosarioProvider value={{ costos: filtros.costos, empresa: nombreEmpresa }}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <RentabilidadFiltros
          value={filtros}
          onChange={(f) => {
            setFiltros(f);
            reset();
          }}
          anios={data?.opciones.anios ?? [initialAnio]}
          empresas={data?.opciones.empresas ?? []}
          clientes={data?.clientes ?? []}
        />
        <div className="flex flex-col items-end gap-2">
          <a
            href={`/api/rentabilidad/export?vista=categorias&${q}`}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500"
          >
            Exportar Excel
          </a>
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
      </div>

      {query.error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{(query.error as Error).message}</p>}

      {data && <AvisosRentabilidad costos={data.costos} config={data.config} empresa={nombreEmpresa} />}

      {data ? (
        <KpiRentabilidad totales={data.totales} extra={[{ label: 'Categorías con ventas', value: fmtNumber(data.filas.length), tip: 'kpiCategorias' as const }]} />
      ) : (
        !query.error && <p className="text-sm text-slate-500">Cargando ventas desde Odoo…</p>
      )}

      {datosGrafico.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Venta por categoría</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={datosGrafico} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
              <XAxis dataKey="categoria" stroke={chartTheme.axis} fontSize={11} />
              <YAxis stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => compacto(Number(v))} width={64} />
              <Tooltip
                contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
                labelStyle={{ color: chartTheme.tooltipText }}
                itemStyle={{ color: chartTheme.tooltipText }}
                formatter={(value: number) => fmtMoney(value)}
              />
              <Bar dataKey="venta" name="Venta" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">Categorías y subcategorías</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium"><Etiqueta clave="categoria">Categoría / Subcategoría</Etiqueta></th>
                <EncabezadosMetricas />
              </tr>
            </thead>
            <tbody>
              {(data?.filas ?? []).map((c) => (
                <Fragment key={c.categoria}>
                  <tr className="border-b border-slate-800/60 bg-slate-800/20 font-medium">
                    <td className="py-2 pr-4 text-slate-100">
                      <button type="button" onClick={() => alternar(c.categoria)} className="mr-2 text-slate-500 hover:text-slate-300" aria-label="Expandir subcategorías">
                        {abiertas.has(c.categoria) ? '▾' : '▸'}
                      </button>
                      <button
                        type="button"
                        onClick={() => elegir({ categoria: c.categoria, subcategoria: null })}
                        className={`hover:text-brand-400 ${esSeleccion(c.categoria, null) ? 'text-brand-400' : ''}`}
                      >
                        {c.categoria}
                      </button>
                    </td>
                    <CeldasMetricas m={c} />
                  </tr>
                  {esSeleccion(c.categoria, null) && (
                    <tr className="border-b border-slate-800 bg-slate-950/40">
                      <td colSpan={8}>
                        <Productos filtros={filtros} categoria={c.categoria} subcategoria={null} onElegir={setProducto} />
                      </td>
                    </tr>
                  )}
                  {abiertas.has(c.categoria) &&
                    c.subcategorias.map((s) => (
                      <Fragment key={s.subcategoria}>
                        <tr className="border-b border-slate-800/60">
                          <td className="py-2 pl-8 pr-4 text-slate-300">
                            <button
                              type="button"
                              onClick={() => elegir({ categoria: c.categoria, subcategoria: s.subcategoria })}
                              className={`hover:text-brand-400 ${esSeleccion(c.categoria, s.subcategoria) ? 'text-brand-400' : ''}`}
                            >
                              {s.subcategoria}
                            </button>
                          </td>
                          <CeldasMetricas m={s} />
                        </tr>
                        {esSeleccion(c.categoria, s.subcategoria) && (
                          <tr className="border-b border-slate-800 bg-slate-950/40">
                            <td colSpan={8}>
                              <Productos filtros={filtros} categoria={c.categoria} subcategoria={s.subcategoria} onElegir={setProducto} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                </Fragment>
              ))}
              {data && data.filas.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Sin ventas para estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <p className="mt-3 text-xs text-slate-500">Datos de Odoo al {fmtFechaHora(data.generado)}. Monto s/flete (sin el recargo regional), neto de notas de crédito.</p>}
      </div>

      {producto !== null && <Evolucion filtros={filtros} templateId={producto} />}
    </div>
    </GlosarioProvider>
  );
}

export default function RentabilidadCategoriasApp({ initialAnio }: { initialAnio: number }) {
  return (
    <QueryProvider>
      <CategoriasInner initialAnio={initialAnio} />
    </QueryProvider>
  );
}
