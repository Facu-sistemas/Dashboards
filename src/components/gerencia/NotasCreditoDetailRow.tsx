import { useApiQuery } from '../dashboard/useApiQuery';
import { formatCompactCurrency } from './format';
import type { ClientesActivosMeses, NotaCreditoRow } from '../../lib/odoo/clientes-activos';

interface Props {
  partnerId: number;
  meses: ClientesActivosMeses;
  colSpan: number;
}

/** "YYYY-MM-DD" -> "DD/MM/AAAA", sin pasar por Date/Intl (misma razón que format.ts). */
function formatFecha(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** Sub-fila expandible con el detalle de notas de crédito de un cliente, cargada bajo demanda al abrirla. */
export default function NotasCreditoDetailRow({ partnerId, meses, colSpan }: Props) {
  const query = useApiQuery<NotaCreditoRow[]>(
    ['notas-credito-cliente', partnerId, meses],
    `/api/clientes-activos-notas-credito?partnerId=${partnerId}&meses=${meses}`
  );

  return (
    <tr className="border-b border-slate-800/60 bg-slate-950/40 last:border-0">
      <td colSpan={colSpan} className="px-4 py-3">
        {query.isLoading ? (
          <div className="h-8 w-full animate-pulse-slow rounded bg-slate-800/60" />
        ) : query.isError ? (
          <p className="text-sm text-red-400">No se pudo cargar el detalle de notas de crédito.</p>
        ) : (query.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">Sin notas de crédito en este período.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-800/60">
            {query.data!.map((nc) => {
              const esAcuerdoComercial = nc.productos.some((p) => p.toUpperCase().includes('ACUERDO COMERCIAL'));
              return (
                <li key={nc.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-baseline gap-4 text-sm">
                    <span className="w-24 shrink-0 text-slate-500">{formatFecha(nc.invoiceDate)}</span>
                    <span className="text-slate-300">{nc.name}</span>
                    {esAcuerdoComercial && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                        Acuerdo comercial
                      </span>
                    )}
                    <span
                      className={`ml-auto font-medium ${esAcuerdoComercial ? 'text-emerald-400' : 'text-amber-400'}`}
                    >
                      {formatCompactCurrency(nc.amount)}
                    </span>
                  </div>
                  {nc.productos.length > 0 && (
                    <p className="pl-24 text-xs text-slate-500">{nc.productos.join(' · ')}</p>
                  )}
                  <p className="pl-24 text-xs italic text-slate-600">
                    {nc.motivo ?? 'Sin motivo especificado en Odoo'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </td>
    </tr>
  );
}
