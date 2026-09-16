import { SEMAFORO_CLASSES, SEMAFORO_LABELS, getSemaforo } from './politica-vs-real-utils';
import type { PoliticaVsRealGroupRow } from './types';

interface Props {
  rows: PoliticaVsRealGroupRow[];
  total: PoliticaVsRealGroupRow | null;
  umbralPct: number;
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

function formatPct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(0)}%`;
}

function SemaforoBadge({ desviacionPct, umbralPct }: { desviacionPct: number | null; umbralPct: number }) {
  const status = getSemaforo(desviacionPct, umbralPct);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SEMAFORO_CLASSES[status]}`}>
      {SEMAFORO_LABELS[status]}
    </span>
  );
}

export default function PoliticaVsRealTable({ rows, total, umbralPct }: Props) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin datos de materia prima disponibles.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Grupo</th>
            <th className="py-2 pr-4 font-medium">Capital Objetivo</th>
            <th className="py-2 pr-4 font-medium">Capital Real</th>
            <th className="py-2 pr-4 font-medium">Desviación ($)</th>
            <th className="py-2 pr-4 font-medium">Desviación (%)</th>
            <th className="py-2 font-medium">Semáforo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.groupKey} className="border-b border-slate-800/60 last:border-0">
              <td className="py-2 pr-4 text-slate-200">{r.groupName}</td>
              <td className="py-2 pr-4 text-slate-300">{money.format(r.capitalObjetivo)}</td>
              <td className="py-2 pr-4 text-slate-300">{money.format(r.capitalReal)}</td>
              <td className={`py-2 pr-4 ${r.desviacionAbs < 0 ? 'text-red-400' : 'text-slate-300'}`}>{money.format(r.desviacionAbs)}</td>
              <td className="py-2 pr-4 text-slate-300">{formatPct(r.desviacionPct)}</td>
              <td className="py-2">
                <SemaforoBadge desviacionPct={r.desviacionPct} umbralPct={umbralPct} />
              </td>
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="border-t border-slate-700 font-medium text-slate-100">
              <td className="pt-2 pr-4">TOTAL</td>
              <td className="pt-2 pr-4">{money.format(total.capitalObjetivo)}</td>
              <td className="pt-2 pr-4">{money.format(total.capitalReal)}</td>
              <td className={`pt-2 pr-4 ${total.desviacionAbs < 0 ? 'text-red-400' : ''}`}>{money.format(total.desviacionAbs)}</td>
              <td className="pt-2 pr-4">{formatPct(total.desviacionPct)}</td>
              <td className="pt-2">
                <SemaforoBadge desviacionPct={total.desviacionPct} umbralPct={umbralPct} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
