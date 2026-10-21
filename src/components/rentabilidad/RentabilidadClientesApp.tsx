import { Fragment, useMemo, useState } from 'react';
import Etiqueta, { GlosarioProvider } from './Etiqueta';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { useChartTheme } from '@/components/shared/useChartTheme';
import { fmtMoney, fmtNumber, fmtPct, fmtFechaHora } from '@/lib/rentabilidad/format';
import type { ClienteDetalleResultado, ClienteFila, ClientesResultado, FiltrosRentabilidad } from '@/lib/rentabilidad/types';
import RentabilidadFiltros from './RentabilidadFiltros';
import AvisosRentabilidad from './AvisosRentabilidad';
import KpiRentabilidad from './KpiRentabilidad';
import { CeldasMetricas, EncabezadosMetricas } from './CeldasMetricas';
import { filtrosQuery } from './query';
import { type ClaveGlosario } from '@/lib/rentabilidad/glosario';

type OrdenClave = 'venta' | 'cantidad' | 'contribucionPct' | 'margenPerdido' | 'cliente';

function compacto(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return fmtMoney(v);
}

function Detalle({ filtros, clienteId }: { filtros: FiltrosRentabilidad; clienteId: number }) {
  const q = filtrosQuery(filtros, { detalle: clienteId });
  const query = useApiQuery<ClienteDetalleResultado>(['rentabilidad-cliente-detalle', q], `/api/rentabilidad/clientes?${q}`);
  if (query.isLoading) return <p className="px-4 py-3 text-sm text-slate-500">Cargando productos…</p>;
  if (query.error) return <p className="px-4 py-3 text-sm text-red-300">{(query.error as Error).message}</p>;
  const productos = query.data?.productos ?? [];
  if (productos.length === 0) return <p className="px-4 py-3 text-sm text-slate-500">Sin productos en el período.</p>;
  return (
    <div className="overflow-x-auto px-4 py-3">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium"><Etiqueta clave="producto">Producto</Etiqueta></th>
            <th className="py-2 pr-4 font-medium"><Etiqueta clave="categoria">Categoría</Etiqueta></th>
            <EncabezadosMetricas />
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.templateId} className="border-b border-slate-800/60">
              <td className="py-2 pr-4 text-slate-200">{p.producto}</td>
              <td className="py-2 pr-4 text-slate-400">
                {p.categoria}
                {p.subcategoria !== '(sin subcategoría)' ? ` / ${p.subcategoria}` : ''}
              </td>
              <CeldasMetricas m={p} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientesInner({ initialAnio }: { initialAnio: number }) {
  const [filtros, setFiltros] = useState<FiltrosRentabilidad>({ anio: initialAnio, mesIni: null, mesFin: null, categoria: null, clienteId: null, empresaId: null, costos: 'planilla' });
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<{ clave: OrdenClave; desc: boolean }>({ clave: 'venta', desc: true });
  const [abierto, setAbierto] = useState<number | null>(null);
  const chartTheme = useChartTheme();

  const q = filtrosQuery(filtros);
  const query = useApiQuery<ClientesResultado>(['rentabilidad-clientes', q], `/api/rentabilidad/clientes?${q}`);
  const data = query.data;
  const nombreEmpresa = filtros.empresaId === null ? 'Ambas empresas' : (data?.opciones.empresas.find((e) => e.id === filtros.empresaId)?.nombre ?? `Empresa ${filtros.empresaId}`);

  const filas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    const base = (data?.filas ?? []).filter((f) => !texto || f.cliente.toLowerCase().includes(texto));
    const valor = (f: ClienteFila): number | string => {
      switch (orden.clave) {
        case 'cliente':
          return f.cliente.toLowerCase();
        case 'contribucionPct':
          return f.contribucionPct ?? Number.NEGATIVE_INFINITY;
        case 'margenPerdido':
          return f.margenPerdido ?? Number.NEGATIVE_INFINITY;
        default:
          return f[orden.clave];
      }
    };
    return [...base].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string, 'es') : (va as number) - (vb as number);
      return orden.desc ? -cmp : cmp;
    });
  }, [data, busqueda, orden]);

  const top10 = useMemo(() => (data?.filas ?? []).slice(0, 10).map((f) => ({ cliente: f.cliente.length > 22 ? `${f.cliente.slice(0, 21)}…` : f.cliente, venta: f.venta })), [data]);
  const totalVenta = data?.totales.venta ?? 0;

  function Th({ clave, label, tip, className = '' }: { clave: OrdenClave; label: string; tip: ClaveGlosario; className?: string }) {
    const activo = orden.clave === clave;
    return (
      <th className={`py-2 pr-4 font-medium ${className}`}>
        <button
          type="button"
          onClick={() => setOrden((o) => ({ clave, desc: o.clave === clave ? !o.desc : clave !== 'cliente' }))}
          className={`inline-flex items-center gap-1 hover:text-slate-300 ${activo ? 'text-brand-400' : ''}`}
        >
          <Etiqueta clave={tip}>{label}</Etiqueta>
          {activo && <span aria-hidden>{orden.desc ? '▾' : '▴'}</span>}
        </button>
      </th>
    );
  }

  return (
    <GlosarioProvider value={{ costos: filtros.costos, empresa: nombreEmpresa }}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <RentabilidadFiltros
          value={filtros}
          onChange={(f) => {
            setFiltros(f);
            setAbierto(null);
          }}
          anios={data?.opciones.anios ?? [initialAnio]}
          empresas={data?.opciones.empresas ?? []}
          categorias={data?.opciones.categorias ?? []}
        />
        <div className="flex flex-col items-end gap-2">
          <a
            href={`/api/rentabilidad/export?vista=clientes&${q}`}
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
        <KpiRentabilidad totales={data.totales} extra={[{ label: 'Clientes con ventas', value: fmtNumber(data.filas.length), tip: 'kpiClientes' as const }]} />
      ) : (
        !query.error && <p className="text-sm text-slate-500">Cargando ventas desde Odoo…</p>
      )}

      {top10.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Top 10 clientes por venta</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
              <XAxis type="number" stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => compacto(Number(v))} />
              <YAxis type="category" dataKey="cliente" stroke={chartTheme.axis} fontSize={11} width={150} />
              <Tooltip
                contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
                labelStyle={{ color: chartTheme.tooltipText }}
                itemStyle={{ color: chartTheme.tooltipText }}
                formatter={(value: number) => fmtMoney(value)}
              />
              <Bar dataKey="venta" name="Venta" fill={chartTheme.primary} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-300">Ranking de clientes</h3>
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente…"
            className="w-64 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">#</th>
                <Th clave="cliente" label="Cliente" tip="cliente" />
                <th className="py-2 pr-4 text-right font-medium">
                  <button type="button" onClick={() => setOrden({ clave: 'venta', desc: true })} className={orden.clave === 'venta' ? 'text-brand-400' : ''}>
                    <Etiqueta clave="venta">Venta</Etiqueta> {orden.clave === 'venta' && (orden.desc ? '▾' : '▴')}
                  </button>
                </th>
                <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="pctTotal">% del total</Etiqueta></th>
                <Th clave="cantidad" label="Cantidad" tip="cantidad" className="text-right" />
                <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="contribucion">Contribución $</Etiqueta></th>
                <Th clave="contribucionPct" label="% Contrib." tip="contribucionPct" className="text-right" />
                <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="gap">Gap vs objetivo</Etiqueta></th>
                <Th clave="margenPerdido" label="Margen perdido" tip="margenPerdido" className="text-right" />
                <th className="py-2 font-medium"><Etiqueta clave="estado">Estado</Etiqueta></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <Fragment key={f.clienteId}>
                  <tr
                    onClick={() => setAbierto((a) => (a === f.clienteId ? null : f.clienteId))}
                    className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/40"
                  >
                    <td className="py-2 pr-3 text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-4 text-slate-200">
                      <span className="mr-1 text-slate-500" aria-hidden>
                        {abierto === f.clienteId ? '▾' : '▸'}
                      </span>
                      {f.cliente}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-slate-200">{fmtMoney(f.venta)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-slate-400">{totalVenta !== 0 ? fmtPct((f.venta / totalVenta) * 100) : '—'}</td>
                    <CeldasMetricas m={f} omitirVenta />
                  </tr>
                  {abierto === f.clienteId && (
                    <tr className="border-b border-slate-800 bg-slate-950/40">
                      <td colSpan={10}>
                        <Detalle filtros={filtros} clienteId={f.clienteId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {data && filas.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    Sin ventas para estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <p className="mt-3 text-xs text-slate-500">Datos de Odoo al {fmtFechaHora(data.generado)}. Monto s/flete (sin el recargo regional), neto de notas de crédito.</p>}
      </div>
    </div>
    </GlosarioProvider>
  );
}

interface Props {
  initialAnio: number;
}

export default function RentabilidadClientesApp({ initialAnio }: Props) {
  return (
    <QueryProvider>
      <ClientesInner initialAnio={initialAnio} />
    </QueryProvider>
  );
}
