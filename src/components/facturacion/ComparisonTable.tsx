import { useMemo, useState } from 'react';
import type { FacturacionLine } from './types';

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — `l.date` is a "YYYY-MM-DD" string, which
// the Date constructor parses as UTC midnight; without pinning the
// formatter to UTC too, Argentina's UTC-3 offset would print the previous
// day.
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

interface Props {
  lines: FacturacionLine[];
  isLoading: boolean;
}

type SortKey = 'date' | 'partnerName' | 'amount' | 'matchingNumber' | 'moveName';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Fecha' },
  { key: 'partnerName', label: 'Contacto' },
  { key: 'amount', label: 'Monto' },
  { key: 'matchingNumber', label: 'Conciliación' },
  { key: 'moveName', label: 'Asiento' },
];

/** Nulls always sort last regardless of direction — an empty contact/conciliación isn't "smaller", it's unknown. */
function compareLines(a: FacturacionLine, b: FacturacionLine, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;

  const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
  return dir === 'asc' ? cmp : -cmp;
}

export default function ComparisonTable({ lines, isLoading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sortedLines = useMemo(
    () => [...lines].sort((a, b) => compareLines(a, b, sortKey, sortDir)),
    [lines, sortKey, sortDir]
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  if (isLoading) {
    return <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />;
  }

  if (lines.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin movimientos registrados para este período.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            {COLUMNS.map((col) => (
              <th key={col.key} className="py-2 pr-4 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className="inline-flex items-center gap-1 hover:text-slate-300"
                >
                  {col.label}
                  <span className="text-slate-600">{sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedLines.map((l) => (
            <tr key={l.id} className="border-b border-slate-800/60 last:border-0">
              <td className="py-2 pr-4 text-slate-300">{dateFmt.format(new Date(l.date))}</td>
              <td className="py-2 pr-4 text-slate-200">{l.partnerName ?? <span className="text-slate-600">—</span>}</td>
              <td className="py-2 pr-4 text-slate-300">{money.format(l.amount)}</td>
              <td className="py-2 pr-4 text-slate-300">{l.matchingNumber ?? <span className="text-slate-600">—</span>}</td>
              <td className="py-2 text-slate-400">{l.moveName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
