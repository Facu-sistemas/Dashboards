import type { PedidoListonRow } from './types';

interface Props {
  title: string;
  rows: PedidoListonRow[];
}

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

export default function PedidoListonesTable({ title, rows }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Todavía no hay listones de esta medida en el pedido.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Largo (cm)</th>
                <th className="py-2 font-medium">Piezas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.medida}-${r.largoCm}`} className="border-b border-slate-800/60 last:border-0">
                  <td className="py-2 pr-4 text-slate-200">{numberFmt.format(r.largoCm)}</td>
                  <td className="py-2 text-slate-300">{numberFmt.format(r.piezas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
