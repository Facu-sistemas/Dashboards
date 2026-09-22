import { useApiQuery } from '../dashboard/useApiQuery';
import TendenciaMensualChart from './TendenciaMensualChart';
import TendenciaMensualTable from './TendenciaMensualTable';
import type { ClientesActivosFuente, TendenciaMensualRow } from '../../lib/odoo/clientes-activos';

interface Props {
  /** Mismo checkbox "Traer todas las NC" del resto del tab — si está tildado, la columna de notas de crédito suma todas, no solo las que no tienen categoría. Solo aplica en fuente 'facturas'. */
  todasNC: boolean;
  /** Mismo filtro de Empresa del resto del tab, coma-separado — vacío = todas. */
  companiesParam: string;
  fuente: ClientesActivosFuente;
}

/** Un solo fetch compartido por el gráfico (forma de la tendencia) y la tabla (números exactos, incluidas las notas de crédito). */
export default function TendenciaMensualSection({ todasNC, companiesParam, fuente }: Props) {
  const query = useApiQuery<TendenciaMensualRow[]>(
    ['clientes-activos-tendencia', todasNC, companiesParam, fuente],
    `/api/clientes-activos-tendencia?todasNC=${todasNC}&companies=${companiesParam}&fuente=${fuente}`
  );

  if (query.isLoading) {
    return <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />;
  }
  if (query.isError) {
    return <p className="text-sm text-red-400">No se pudo cargar la tendencia mensual.</p>;
  }

  const rows = query.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <TendenciaMensualChart rows={rows} fuente={fuente} />
      <TendenciaMensualTable rows={rows} fuente={fuente} />
    </div>
  );
}
