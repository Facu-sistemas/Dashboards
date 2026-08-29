import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import ParetoChart from './ParetoChart';
import ClientRankingTable from './ClientRankingTable';
import ClientMonthlyChart from './ClientMonthlyChart';
import type { ClientMonthlySeries, ParetoClientRow, ParetoClientsResult, ParetoRange } from './types';

interface Props {
  initialRange: ParetoRange;
  dehydratedState?: DehydratedState;
}

const RANGE_OPTIONS: { value: ParetoRange; label: string }[] = [
  { value: 'all', label: 'Histórico completo' },
  { value: 'this-year', label: 'Este año' },
  { value: 'last-12-months', label: 'Últimos 12 meses' },
  { value: 'last-6-months', label: 'Últimos 6 meses' },
];

/** "¿De cuántos clientes depende el 80% de la facturación?" — the headline question this chart exists to answer. */
function paretoInsight(rows: ParetoClientRow[]): string {
  if (rows.length === 0) return '';
  const cutoffIndex = rows.findIndex((r) => r.cumulativePct >= 80);
  if (cutoffIndex !== -1) {
    const rank = cutoffIndex + 1;
    return `El 80% de la facturación se concentra en los primeros ${rank} cliente${rank > 1 ? 's' : ''}.`;
  }
  const lastPct = rows[rows.length - 1]!.cumulativePct;
  return `Los ${rows.length} clientes principales representan el ${lastPct.toFixed(0)}% de la facturación total — la cartera está diversificada, no llega al 80% de concentración.`;
}

function ParetoClientsInner({ initialRange }: { initialRange: ParetoRange }) {
  const [range, setRange] = useState<ParetoRange>(initialRange);
  const [primary, setPrimary] = useState<ParetoClientRow | null>(null);
  const [secondary, setSecondary] = useState<ParetoClientRow | null>(null);
  const [compareMode, setCompareMode] = useState(false);

  const query = useApiQuery<ParetoClientsResult>(
    ['pareto-clients', range],
    `/api/pareto-clients?${new URLSearchParams({ range })}`
  );

  const rows = query.data?.rows ?? [];

  const monthlyIds = [primary?.partnerId, secondary?.partnerId].filter((id): id is number => typeof id === 'number');
  const monthlyQuery = useApiQuery<ClientMonthlySeries[]>(
    ['pareto-clients-monthly', monthlyIds.join(',')],
    `/api/pareto-clients-monthly?partner_ids=${monthlyIds.join(',')}`,
    { enabled: monthlyIds.length > 0 }
  );

  function handleSelect(row: ParetoClientRow) {
    if (primary && row.partnerId === primary.partnerId) {
      // Clicking the primary again while comparing has no obvious meaning
      // (drop primary and promote secondary? clear both?) — plan explicitly
      // leaves this as a non-blocking default, so it's a no-op here.
      if (compareMode) return;
      setPrimary(null);
      setSecondary(null);
      return;
    }
    if (!primary || !compareMode) {
      setPrimary(row);
      setSecondary(null);
      return;
    }
    // compareMode is on and a different (non-primary) client was clicked.
    setSecondary((prev) => (prev && prev.partnerId === row.partnerId ? null : row));
  }

  function handleToggleCompare(checked: boolean) {
    setCompareMode(checked);
    if (!checked) setSecondary(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Período
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as ParetoRange)}
            className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Top 10 clientes por facturación</h3>
        {query.isLoading ? (
          <div className="h-[380px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <>
            <ParetoChart rows={rows} />
            {rows.length > 0 && <p className="text-sm text-slate-400">{paretoInsight(rows)}</p>}
          </>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-300">Ranking — click en un cliente para ver el detalle mensual</h3>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={compareMode}
              onChange={(e) => handleToggleCompare(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-brand-500"
            />
            Comparar
          </label>
        </div>

        {query.isLoading ? (
          <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <ClientRankingTable
            rows={rows}
            primaryId={primary?.partnerId ?? null}
            secondaryId={secondary?.partnerId ?? null}
            onSelect={handleSelect}
          />
        )}

        {primary && (
          <div className="mt-2 flex flex-col gap-2 border-t border-slate-800 pt-4">
            <h4 className="text-sm font-medium text-slate-300">
              Facturación mensual — últimos 6 meses
              {secondary ? ` · ${primary.partnerName} vs. ${secondary.partnerName}` : ` · ${primary.partnerName}`}
            </h4>
            {monthlyQuery.isLoading ? (
              <div className="h-[300px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
            ) : monthlyQuery.isError ? (
              <p className="text-sm text-red-400">No se pudo cargar el detalle mensual.</p>
            ) : (
              <ClientMonthlyChart series={monthlyQuery.data ?? []} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function ParetoClientsApp({ dehydratedState, initialRange }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ParetoClientsInner initialRange={initialRange} />
    </QueryProvider>
  );
}
