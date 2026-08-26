import { useApiQuery } from './useApiQuery';
import type { FxRateInfo } from './types';

const arsFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });

/**
 * Informational only — this rate is never applied to convert any figure
 * shown elsewhere on the page. Purchase amounts always stay in whatever
 * currency they were loaded in (ARS or USD); this badge just gives the
 * viewer a reference point if they want to eyeball a comparison.
 */
export default function FxRateBadge() {
  const { data, isLoading, isError } = useApiQuery<FxRateInfo>(['fx-rate'], '/api/fx-rate');

  if (isLoading) {
    return <div className="h-8 w-56 animate-pulse-slow rounded-full bg-slate-800/60" />;
  }

  if (isError || !data) {
    return null;
  }

  const asOfLabel = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(`${data.asOfDate}T00:00:00`)
  );

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300"
      title="Cotización informativa — no se usa para convertir montos en este panel"
    >
      <span className="text-slate-500">USD {asOfLabel}</span>
      <span className="font-medium text-slate-100">{arsFormatter.format(data.arsPerUnit)}</span>
    </div>
  );
}
