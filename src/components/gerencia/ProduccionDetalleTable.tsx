import { useEffect, useState } from 'react';
import { useChartTheme } from '../shared/useChartTheme';
import { colorPorRanking } from './produccion-detalle-palette';
import { formatNumber } from './format';

export interface FilaDetalle {
  nombre: string;
  cant: number;
  ue: number;
}

interface Props {
  rows: FilaDetalle[];
  ordenarPor: 'cant' | 'ue';
  /** Mismo "Mostrar" que el gráfico — cuántas filas llevan color propio antes de caer en el color de "Otros". */
  destacados: number;
}

type SortKey = 'nombre' | 'cant' | 'ue';
type SortDir = 'asc' | 'desc';

function SortableHeader({ label, active, dir, align, onClick }: { label: string; active: boolean; dir: SortDir; align: 'left' | 'right'; onClick: () => void }) {
  return (
    <th className={`py-2 pr-4 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 ${active ? 'text-brand-400' : ''}`}>
        {label}
        {active && <span className="text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

export default function ProduccionDetalleTable({ rows, ordenarPor, destacados }: Props) {
  const chartTheme = useChartTheme();
  const [sortKey, setSortKey] = useState<SortKey>(ordenarPor);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // La medida (cantidad/UE) cambió desde afuera — arrancar de nuevo ordenado por esa medida, de mayor a menor.
  useEffect(() => {
    setSortKey(ordenarPor);
    setSortDir('desc');
  }, [ordenarPor]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'nombre' ? 'asc' : 'desc');
    }
  };

  // El puntito de color sigue siempre el ranking por la medida elegida (cant/ue), sea cual sea el orden visible de la tabla —
  // mismo criterio y mismos colores que el gráfico de arriba (top destacados + "Otros").
  const rankByNombre = new Map([...rows].sort((a, b) => b[ordenarPor] - a[ordenarPor]).map((r, i) => [r.nombre, i]));

  const ordenadas = [...rows].sort((a, b) => {
    const cmp = sortKey === 'nombre' ? a.nombre.localeCompare(b.nombre) : a[sortKey] - b[sortKey];
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (ordenadas.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin producción en este período.</p>;
  }

  return (
    <div className="max-h-[420px] overflow-y-auto overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pl-4 pr-3 font-medium">#</th>
            <SortableHeader label="Nombre" active={sortKey === 'nombre'} dir={sortDir} align="left" onClick={() => toggleSort('nombre')} />
            <SortableHeader label="Cantidad" active={sortKey === 'cant'} dir={sortDir} align="right" onClick={() => toggleSort('cant')} />
            <SortableHeader label="Unidad equiv." active={sortKey === 'ue'} dir={sortDir} align="right" onClick={() => toggleSort('ue')} />
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((r, i) => (
            <tr key={r.nombre} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40">
              <td className="py-2 pl-4 pr-3 text-slate-500">{i + 1}</td>
              <td className="py-2 pr-4 text-slate-200">
                <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colorPorRanking(chartTheme, rankByNombre.get(r.nombre) ?? 0, destacados) }} />
                {r.nombre}
              </td>
              <td className={`py-2 pr-4 text-right ${sortKey === 'cant' ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{formatNumber(r.cant)}</td>
              <td className={`py-2 pr-4 text-right ${sortKey === 'ue' ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{formatNumber(r.ue)}</td>
            </tr>
          ))}
        </tbody>
        {/* Total del período — el mismo número que la pestaña Producción, para poder cruzarlo. */}
        <tfoot className="sticky bottom-0 bg-slate-900">
          <tr className="border-t border-slate-700 font-semibold text-slate-100">
            <td className="py-2 pl-4 pr-3" />
            <td className="py-2 pr-4">Total</td>
            <td className="py-2 pr-4 text-right">{formatNumber(ordenadas.reduce((s, r) => s + r.cant, 0))}</td>
            <td className="py-2 pr-4 text-right">{formatNumber(ordenadas.reduce((s, r) => s + r.ue, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
