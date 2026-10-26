import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import type { LineaPlan } from '@/lib/lineas-sillon/plan';
import LineasSillonLineas from './LineasSillonLineas';
import LineasSillonPersonas from './LineasSillonPersonas';
import LineasSillonEquivalencias from './LineasSillonEquivalencias';
import { SLOTS_UI, fechaLarga, porcentaje, tonoEficiencia, type LineasSillonResponse } from './lineas-sillon-shared';

type Vista = 'reporte' | 'lineas' | 'personas' | 'equivalencias';

/** Cuántas unidades de hoy se listan por línea antes de plegar el resto. */
const FILAS_VISIBLES = 60;

function LineaCard({ lp, nombres }: { lp: LineaPlan; nombres: Map<string, string> }) {
  const [carp, tap, ens] = lp.estaciones;
  const hoy = carp!.tramos.filter((t) => t.dia === 0);
  const filas = hoy.slice(0, FILAS_VISIBLES);
  const asignados = SLOTS_UI.map((s) => ({ ...s, nombre: lp.config.asignados[s.slot] ? nombres.get(lp.config.asignados[s.slot]!) : undefined }));

  return (
    <section className="break-inside-avoid rounded-lg border border-slate-800 bg-slate-900/60">
      <header className="border-b border-slate-800 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Línea {lp.linea}</h3>
          <span className="text-xs text-slate-500">
            {hoy.length} hoy{carp!.pendientes > 0 ? ` · ${carp!.pendientes} para después` : ''}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
          {asignados.map((a) => (
            <span key={a.slot}>
              <span className="text-slate-500">{a.slot}</span> {a.nombre ?? <span className="text-slate-600">—</span>}
            </span>
          ))}
        </div>
      </header>

      {hoy.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-slate-500">Sin órdenes asignadas a esta línea.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-1.5 font-medium">#</th>
              <th className="py-1.5 font-medium">Producto</th>
              <th className="py-1.5 text-right font-medium">C</th>
              <th className="py-1.5 text-right font-medium">T</th>
              <th className="px-3 py-1.5 text-right font-medium">E</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((t, i) => (
              <tr key={t.idx} className="border-t border-slate-800/60" title={t.origen}>
                <td className="px-3 py-1 tabular-nums text-slate-500">{t.idx}</td>
                <td className="py-1 text-slate-200">
                  {t.producto}
                  {t.manual && <span className="ml-1.5 rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">manual</span>}
                </td>
                <td className="py-1 text-right tabular-nums text-slate-400">{t.finReloj}</td>
                <td className="py-1 text-right tabular-nums text-slate-400">{tap!.tramos[i]!.finReloj}</td>
                <td className="px-3 py-1 text-right tabular-nums text-slate-400">{ens!.tramos[i]!.finReloj}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 text-[11px]">
              <td colSpan={2} className="px-3 py-1.5 text-slate-500">
                {hoy.length > filas.length ? `+${hoy.length - filas.length} más · ` : ''}Eficiencia
              </td>
              {lp.estaciones.map((e, i) => (
                <td key={e.id} className={`py-1.5 text-right font-semibold tabular-nums ${i === 2 ? 'px-3' : ''} ${tonoEficiencia(e.eficiencia)}`}>
                  {porcentaje(e.eficiencia)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

function Reporte({ data, repartir, setRepartir }: { data: LineasSillonResponse; repartir: boolean; setRepartir: (v: boolean) => void }) {
  const { plan, config } = data;
  const nombres = new Map(config.personas.map((p) => [p.id, p.nombre]));
  const activas = plan.lineas.filter((l) => l.config.activa);
  const apagadas = plan.lineas.filter((l) => !l.config.activa).map((l) => l.linea);
  const sinResolverUnidades = plan.sinResolver.reduce((a, r) => a + r.unidades, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
        <label className="inline-flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={repartir} onChange={(e) => setRepartir(e.target.checked)} />
          Repartir las órdenes sin línea entre las líneas habilitadas
        </label>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          Imprimir reporte
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {sinResolverUnidades > 0 && (
          <span className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-amber-300">
            {sinResolverUnidades} unidades sin tiempo o sin equivalencia — se completan en "Equivalencias"
          </span>
        )}
        {plan.sinLinea.unidades > 0 && (
          <span className="rounded border border-slate-700 px-2.5 py-1 text-slate-400">
            {plan.sinLinea.unidades} unidades sin línea en Odoo{repartir ? ' (repartidas)' : ' (fuera del reporte)'}
          </span>
        )}
        {plan.enLineaApagada.unidades > 0 && (
          <span className="rounded border border-slate-700 px-2.5 py-1 text-slate-400">
            {plan.enLineaApagada.unidades} unidades en líneas apagadas ({apagadas.join(', ')})
          </span>
        )}
        {!config.disponible && (
          <span className="rounded border border-rose-500/30 bg-rose-500/5 px-2.5 py-1 text-rose-300">
            Las tablas de configuración no existen en Supabase: se usan valores por defecto y no se puede guardar.
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {activas.map((lp) => (
          <LineaCard key={lp.linea} lp={lp} nombres={nombres} />
        ))}
      </div>
      {activas.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No hay líneas habilitadas.</p>}
    </div>
  );
}

function Inner() {
  const [vista, setVista] = useState<Vista>('reporte');
  const [repartir, setRepartir] = useState(false);
  const queryClient = useQueryClient();
  const query = useApiQuery<LineasSillonResponse>(['lineas-sillon', repartir], `/api/lineas-sillon${repartir ? '?repartir=1' : ''}`);
  const data = query.data;
  const refrescar = () => void queryClient.invalidateQueries({ queryKey: ['lineas-sillon'] });

  const tabs: { id: Vista; label: string }[] = [
    { id: 'reporte', label: 'Reporte de hoy' },
    { id: 'lineas', label: 'Líneas' },
    { id: 'personas', label: 'Personas' },
    { id: 'equivalencias', label: `Equivalencias${data && data.plan.sinResolver.length ? ` (${data.plan.sinResolver.length})` : ''}` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="inline-flex w-fit rounded-lg border border-slate-800 bg-slate-900/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setVista(t.id)}
              className={`rounded px-3 py-1.5 text-xs ${vista === t.id ? 'bg-brand-500/15 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            {query.isFetching ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      {data && vista === 'reporte' && (
        <h3 className="text-base font-semibold capitalize text-slate-100">Producción — {fechaLarga(data.plan.hoy)}</h3>
      )}

      {query.isLoading && <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}
      {query.isError && !data && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">{(query.error as Error).message}</p>
      )}

      {data && vista === 'reporte' && <Reporte data={data} repartir={repartir} setRepartir={setRepartir} />}
      {data && vista === 'lineas' && <LineasSillonLineas data={data} onSaved={refrescar} />}
      {data && vista === 'personas' && <LineasSillonPersonas data={data} onSaved={refrescar} />}
      {data && vista === 'equivalencias' && <LineasSillonEquivalencias data={data} onSaved={refrescar} />}
    </div>
  );
}

export default function LineasSillonApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
