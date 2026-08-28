import type { RawMaterialRow } from './types';

interface Props {
  material: RawMaterialRow;
}

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ? 'text-red-400' : 'text-slate-100'}`}>{value}</p>
    </div>
  );
}

/**
 * Snapshot numbers (as of today), explicitly labeled with their time
 * unit — the table/chart previously mixed a weekly-feeling consumption
 * rate with monthly chart bars without saying so, which read as
 * inconsistent. These four are all "right now" figures except the
 * consumption rate, which is explicitly "/semana".
 */
export default function MaterialStatRow({ material }: Props) {
  const weeklyConsumption = material.avgDailyConsumption * 7;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatBox label="Stock actual" value={numberFmt.format(material.currentStock)} />
      <StatBox
        label="Punto de reorden"
        value={material.reorderPoint !== null ? numberFmt.format(material.reorderPoint) : '—'}
      />
      <StatBox
        label="Días hasta quiebre"
        value={material.daysUntilStockout !== null ? `${material.daysUntilStockout.toFixed(0)} días` : 'sin dato'}
        accent={material.isLow}
      />
      <StatBox label="Consumo promedio" value={`${numberFmt.format(weeklyConsumption)} / semana`} />
    </div>
  );
}
