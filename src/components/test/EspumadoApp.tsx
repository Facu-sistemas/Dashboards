import { Fragment, useMemo, useState } from 'react';
import { Bar, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { useChartTheme } from '@/components/shared/useChartTheme';
import EspumadoStockPanel from './EspumadoStockPanel';
import type {
  EspumadoCategoria,
  EspumadoMovimiento,
  EspumadoResult,
  EspumadoSerieDia,
  EspumadoTipo,
} from '@/lib/odoo/espumado';

const RANGOS = [7, 14, 30, 60] as const;

const CAT_LABEL: Record<EspumadoCategoria, string> = {
  produccion: 'Producción',
  transferencia: 'Transferencia a pre-producción',
  consumo: 'Consumo (placas / colchones)',
  venta: 'Venta',
  ajuste: 'Ajuste de inventario',
  otro: 'Otro',
};

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function kg(n: number): string {
  return nf.format(n);
}

function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/** Semáforo de cobertura: <1 día = quiebre inminente, <3 = bajo (la planta fabrica block cada ~2-3 días). */
function estado(t: EspumadoTipo): { label: string; cls: string } {
  if (t.coberturaDias === null) return { label: 'Sin consumo', cls: 'text-slate-500' };
  if (t.coberturaDias < 1) return { label: 'Quiebre', cls: 'font-semibold text-status-red' };
  if (t.coberturaDias < 3) return { label: 'Bajo', cls: 'font-semibold text-status-yellow' };
  return { label: 'OK', cls: 'text-status-green' };
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function FlujoChart({ serie, titulo }: { serie: EspumadoSerieDia[]; titulo: string }) {
  const theme = useChartTheme();
  const data = useMemo(
    () => serie.map((d) => ({ ...d, label: fechaCorta(d.fecha) })),
    [serie]
  );
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold text-slate-200">{titulo}</h3>
      <p className="mb-2 text-xs text-slate-500">
        Kg por día: lo que se espuma contra lo que consume la planta. Si la barra de consumo supera a la de producción
        varios días seguidos, el stock se está comiendo.
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke={theme.axis} fontSize={11} />
            <YAxis stroke={theme.axis} fontSize={11} />
            <Tooltip
              contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText }}
              formatter={(v: number) => `${kg(v)} kg`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="produccion" name="Producción" fill={theme.secondary} />
            <Bar dataKey="consumo" name="Consumo" fill={theme.primary} />
            <Line dataKey="venta" name="Venta" stroke={theme.warn} dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Movimientos({ tipo, dias }: { tipo: EspumadoTipo; dias: number }) {
  const [cat, setCat] = useState<EspumadoCategoria | 'todas'>('todas');
  const q = useApiQuery<EspumadoMovimiento[]>(['espumado-mov', tipo.id, dias], `/api/espumado?dias=${dias}&producto=${tipo.id}`);
  const filas = (q.data ?? []).filter((m) => cat === 'todas' || m.categoria === cat);
  const cats = [...new Set((q.data ?? []).map((m) => m.categoria))];

  return (
    <div className="flex flex-col gap-2 border-t border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">Movimientos de {tipo.nombre} en Odoo:</span>
        {(['todas', ...cats] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`rounded-full border px-2 py-0.5 ${cat === c ? 'border-brand-500 text-slate-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
          >
            {c === 'todas' ? 'Todos' : CAT_LABEL[c]}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <div className="h-24 animate-pulse-slow rounded bg-slate-800/60" />
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr>
                <th className="px-2 py-1">Fecha (UTC)</th>
                <th className="px-2 py-1">Referencia</th>
                <th className="px-2 py-1">Origen → Destino</th>
                <th className="px-2 py-1">Tipo</th>
                <th className="px-2 py-1 text-right">Kg</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {filas.map((m) => (
                <tr key={m.id} className="border-t border-slate-800/60">
                  <td className="whitespace-nowrap px-2 py-1">{m.fecha.slice(0, 16)}</td>
                  <td className="px-2 py-1">{m.referencia}</td>
                  <td className="px-2 py-1 text-slate-400">
                    {m.origen.replace('Virtual Locations/', '')} → {m.destino.replace('Virtual Locations/', '')}
                  </td>
                  <td className="px-2 py-1">{CAT_LABEL[m.categoria]}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${m.kg < 0 ? 'text-status-red' : ''}`}>{nf1.format(m.kg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EspumadoInner() {
  const [dias, setDias] = useState<number>(30);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [soloRiesgo, setSoloRiesgo] = useState(false);

  const query = useApiQuery<EspumadoResult>(['espumado', dias], `/api/espumado?dias=${dias}`);
  const data = query.data;

  const tipos = useMemo(() => {
    if (!data) return [];
    const base = [...data.tipos].sort((a, b) => (a.coberturaDias ?? 9999) - (b.coberturaDias ?? 9999));
    return soloRiesgo ? base.filter((t) => t.coberturaDias !== null && t.coberturaDias < 3) : base;
  }, [data, soloRiesgo]);

  const totales = useMemo(() => {
    if (!data) return null;
    const sum = (k: keyof EspumadoTipo) => data.tipos.reduce((a, t) => a + (t[k] as number), 0);
    const enRiesgo = data.tipos.filter((t) => t.coberturaDias !== null && t.coberturaDias < 3).length;
    return {
      stock: sum('stockKg'),
      produccion: sum('produccionKg'),
      consumo: sum('consumoKg'),
      balance: sum('produccionKg') - sum('consumoKg'),
      enRiesgo,
    };
  }, [data]);

  const abiertoTipo = data?.tipos.find((t) => t.id === abierto) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          Período
          {RANGOS.map((r) => (
            <button
              key={r}
              onClick={() => setDias(r)}
              className={`rounded-full border px-3 py-1 ${dias === r ? 'border-brand-500 text-slate-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              {r} días
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={soloRiesgo}
            onChange={(e) => setSoloRiesgo(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-brand-500 focus:ring-brand-500"
          />
          Solo tipos con menos de 3 días de cobertura
        </label>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data || !totales ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Stock de blocks" value={`${kg(totales.stock)} kg`} hint="Todas las ubicaciones internas" />
            <Kpi label="Producido" value={`${kg(totales.produccion)} kg`} hint={`Últimos ${data.dias} días`} />
            <Kpi label="Consumido" value={`${kg(totales.consumo)} kg`} hint={`${data.diasPlanta} días con planta`} />
            <Kpi
              label="Producción − consumo"
              value={`${totales.balance >= 0 ? '+' : ''}${kg(totales.balance)} kg`}
              hint={totales.balance >= 0 ? 'El stock está subiendo' : 'El stock está bajando'}
            />
            <Kpi label="Tipos en riesgo" value={String(totales.enRiesgo)} hint="Menos de 3 días de cobertura" />
          </div>

          <FlujoChart
            serie={abiertoTipo ? data.serieTipos[abiertoTipo.id]! : data.serie}
            titulo={abiertoTipo ? `Flujo diario — ${abiertoTipo.nombre}` : 'Flujo diario — todos los blocks'}
          />

          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 p-4">
              <h3 className="text-sm font-semibold text-slate-200">Blocks por tipo, ordenados por urgencia</h3>
              <p className="text-xs text-slate-500">
                Cobertura = stock ÷ consumo medio por día de planta. Hacé clic en un tipo para ver su gráfico y los movimientos de Odoo que
                componen cada número.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950/50 text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                    <th className="px-3 py-2 text-right">En espumado</th>
                    <th className="px-3 py-2 text-right">En pre-prod.</th>
                    <th className="px-3 py-2 text-right">Producido</th>
                    <th className="px-3 py-2 text-right">Transferido</th>
                    <th className="px-3 py-2 text-right">Consumido</th>
                    <th className="px-3 py-2 text-right">Vendido</th>
                    <th className="px-3 py-2 text-right">Ajustes</th>
                    <th className="px-3 py-2 text-right">Consumo/día</th>
                    <th className="px-3 py-2 text-right">Cobertura</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {tipos.map((t) => {
                    const e = estado(t);
                    const open = abierto === t.id;
                    return (
                      <Fragment key={t.id}>
                        <tr
                          onClick={() => setAbierto(open ? null : t.id)}
                          className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/40 ${open ? 'bg-slate-800/50' : ''}`}
                        >
                          <td className="px-3 py-2 font-medium">{t.nombre}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(t.stockKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-400">{kg(t.stockPoliesterKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-400">{kg(t.stockPreProduccionKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(t.produccionKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(t.transferenciaKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(t.consumoKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(t.ventaKg)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${t.ajusteKg < 0 ? 'text-status-red' : ''}`}>{kg(t.ajusteKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(t.consumoDiarioKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {t.coberturaDias === null ? '—' : `${nf1.format(t.coberturaDias)} d`}
                          </td>
                          <td className={`px-3 py-2 ${e.cls}`}>{e.label}</td>
                        </tr>
                        {open && (
                          <tr key={`${t.id}-det`}>
                            <td colSpan={12} className="p-0">
                              <Movimientos tipo={t} dias={dias} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-slate-500">
            Datos en vivo de Odoo (solo lectura), categoría «PI / Block Espuma». Odoo maneja los blocks en kg por tipo/color, sin medidas:
            la planilla cuenta unidades por medida, por eso acá se cruza a nivel kg. Desde {data.desde} hasta {data.hasta}.
          </p>
        </>
      )}
    </div>
  );
}

const VISTAS = [
  { id: 'stock', label: 'Stock por medida' },
  { id: 'odoo', label: 'Flujo en Odoo' },
] as const;

export default function EspumadoApp() {
  const [vista, setVista] = useState<(typeof VISTAS)[number]['id']>('stock');
  return (
    <QueryProvider>
      <div className="flex flex-col gap-6">
        <div className="flex gap-2">
          {VISTAS.map((v) => (
            <button
              key={v.id}
              onClick={() => setVista(v.id)}
              className={`rounded-full border px-4 py-1.5 text-sm ${vista === v.id ? 'border-brand-500 text-slate-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {vista === 'stock' ? <EspumadoStockPanel /> : <EspumadoInner />}
      </div>
    </QueryProvider>
  );
}
