import OeeGauge from './OeeGauge';
import type { OeeCategoryGauge } from './types';

interface Props {
  title: string;
  gauge: OeeCategoryGauge;
}

const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export default function OeeGaugeCard({ title, gauge }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      <OeeGauge pct={gauge.pctComplete} />
      <p className="text-center text-sm text-slate-400">
        {units.format(gauge.produced)} / {units.format(gauge.planned)} u.
      </p>
    </div>
  );
}
