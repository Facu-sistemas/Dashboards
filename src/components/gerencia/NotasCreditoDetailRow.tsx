import { useApiQuery } from '../dashboard/useApiQuery';
import { formatCompactCurrency } from './format';
import type { ClientesActivosPeriodo, NotaCreditoCategoria, NotaCreditoRow } from '../../lib/odoo/clientes-activos';

interface Props {
  partnerId: number;
  periodo: ClientesActivosPeriodo;
  colSpan: number;
}

/** "YYYY-MM-DD" -> "DD/MM/AAAA", sin pasar por Date/Intl (misma razón que format.ts). */
function formatFecha(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** Notas de crédito que no son una devolución real — mismo criterio que categoriaDeProductos() en clientes-activos.ts, un color distinto por categoría para distinguirlas de un vistazo. */
const CATEGORIA_INFO: Record<Exclude<NotaCreditoCategoria, null>, { label: string; badge: string; amount: string }> = {
  acuerdo_comercial: { label: 'Acuerdo comercial', badge: 'bg-emerald-500/10 text-emerald-400', amount: 'text-emerald-400' },
  descuento: { label: 'Descuento', badge: 'bg-sky-500/10 text-sky-400', amount: 'text-sky-400' },
  publicidad: { label: 'Publicidad', badge: 'bg-violet-500/10 text-violet-400', amount: 'text-violet-400' },
};

/** Sub-fila expandible con el detalle de notas de crédito de un cliente, cargada bajo demanda al abrirla. */
export default function NotasCreditoDetailRow({ partnerId, periodo, colSpan }: Props) {
  const query = useApiQuery<NotaCreditoRow[]>(
    ['notas-credito-cliente', partnerId, periodo],
    `/api/clientes-activos-notas-credito?partnerId=${partnerId}&periodo=${periodo}`
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
              const info = nc.categoria ? CATEGORIA_INFO[nc.categoria] : null;
              return (
                <li key={nc.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-baseline gap-4 text-sm">
                    <span className="w-24 shrink-0 text-slate-500">{formatFecha(nc.invoiceDate)}</span>
                    <span className="text-slate-300">{nc.name}</span>
                    {info && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.badge}`}>{info.label}</span>
                    )}
                    <span className={`ml-auto font-medium ${info?.amount ?? 'text-amber-400'}`}>
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
