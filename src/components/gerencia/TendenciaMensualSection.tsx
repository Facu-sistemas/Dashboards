import { useApiQuery } from '../dashboard/useApiQuery';
import TendenciaMensualChart from './TendenciaMensualChart';
import TendenciaMensualTable from './TendenciaMensualTable';
import type { TendenciaMensualRow } from '../../lib/odoo/clientes-activos';

/** Un solo fetch compartido por el gráfico (forma de la tendencia) y la tabla (números exactos, incluidas las notas de crédito). */
export default function TendenciaMensualSection() {
  const query = useApiQuery<TendenciaMensualRow[]>(['clientes-activos-tendencia'], '/api/clientes-activos-tendencia');

  if (query.isLoading) {
    return <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />;
  }
  if (query.isError) {
    return <p className="text-sm text-red-400">No se pudo cargar la tendencia mensual.</p>;
  }

  const rows = query.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <TendenciaMensualChart rows={rows} />
      <TendenciaMensualTable rows={rows} />
    </div>
  );
}
