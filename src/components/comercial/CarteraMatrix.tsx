import type { Categoria, Estado, Snapshot } from './cartera-clientes-calc';
import { formatCompactCurrency } from '../gerencia/format';

interface Props {
  snap: Snapshot;
  clients: string[];
}

const ESTADOS: Estado[] = ['Activo', 'Dormido', 'Perdido', 'Nuevo'];
const CATS: Categoria[] = ['A', 'B', 'C'];

const ESTADO_STYLE: Record<Estado, string> = {
  Activo: 'bg-status-green/10 text-status-green',
  Dormido: 'bg-status-yellow/10 text-status-yellow',
  Perdido: 'bg-status-red/10 text-status-red',
  Nuevo: 'bg-brand-500/10 text-brand-400',
};

export default function CarteraMatrix({ snap, clients }: Props) {
  const grid: Record<Estado, Record<Categoria, { n: number; m: number }>> = {
    Activo: { A: { n: 0, m: 0 }, B: { n: 0, m: 0 }, C: { n: 0, m: 0 } },
    Dormido: { A: { n: 0, m: 0 }, B: { n: 0, m: 0 }, C: { n: 0, m: 0 } },
    Perdido: { A: { n: 0, m: 0 }, B: { n: 0, m: 0 }, C: { n: 0, m: 0 } },
    Nuevo: { A: { n: 0, m: 0 }, B: { n: 0, m: 0 }, C: { n: 0, m: 0 } },
  };
  for (const c of snap.clientStats) {
    const cell = grid[c.estado][c.cat];
    cell.n += 1;
    cell.m += c.activoWindowTotal || c.paretoTotal;
  }

  const prioridad = snap.clientStats
    .filter((c) => (c.estado === 'Dormido' || c.estado === 'Perdido') && c.cat === 'A')
    .sort((a, b) => b.paretoTotal - a.paretoTotal)
    .slice(0, 10);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[380px] border-collapse text-center text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th className="border border-slate-800 bg-slate-950/60 p-2 text-left"> </th>
              {CATS.map((cat) => (
                <th key={cat} className="border border-slate-800 bg-slate-950/60 p-2">
                  Categoría {cat}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ESTADOS.map((estado) => (
              <tr key={estado}>
                <td className="border border-slate-800 bg-slate-950/60 p-2 text-left font-mono text-xs text-slate-400">{estado}</td>
                {CATS.map((cat) => {
                  const cell = grid[estado][cat];
                  return (
                    <td key={cat} className={`border border-slate-800 p-2 ${ESTADO_STYLE[estado]}`}>
                      <div className="text-lg font-semibold">{cell.n}</div>
                      <div className="text-[10px] opacity-70">{formatCompactCurrency(cell.m)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-status-red">⚠ Prioridad máxima — Dormido A / Perdido A</p>
        {prioridad.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Sin clientes A dormidos o perdidos.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-800/60">
            {prioridad.map((c) => (
              <div key={c.ci} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate text-slate-200">{clients[c.ci]}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    c.estado === 'Perdido' ? 'bg-status-red/15 text-status-red' : 'bg-status-yellow/15 text-status-yellow'
                  }`}
                >
                  {c.estado}
                </span>
                <span className="shrink-0 font-mono text-xs text-slate-400">{c.daysSince}d</span>
                <span className="shrink-0 font-mono text-xs text-slate-300">{formatCompactCurrency(c.paretoTotal)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
