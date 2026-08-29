import type { UseQueryResult } from '@tanstack/react-query';
import { DESK_CELL } from './warehouseLayout';
import type { UbicacionStockResult } from './types';

interface Props {
  selectedCode: string;
  query: UseQueryResult<UbicacionStockResult>;
}

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

export default function UbicacionDetail({ selectedCode, query }: Props) {
  if (selectedCode === DESK_CELL.codigo) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">{selectedCode}</h3>
        <p className="text-sm text-slate-500">{DESK_CELL.label}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{selectedCode}</h3>

      {query.isLoading ? (
        <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : query.isError ? (
        <p className="text-sm text-red-400">No se pudo cargar el stock de esta ubicación.</p>
      ) : query.data && query.data.productos.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Producto</th>
                <th className="py-2 font-medium">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {query.data.productos.map((p) => (
                <tr key={p.producto} className="border-b border-slate-800/60 last:border-0">
                  <td className="py-2 pr-4 text-slate-200">{p.producto}</td>
                  <td className="py-2 text-slate-300">
                    {numberFmt.format(p.cantidad)} {p.unidad}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Sin stock registrado en esta ubicación.</p>
      )}
    </section>
  );
}
