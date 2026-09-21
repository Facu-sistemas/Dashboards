import type { UltimaVentaRow } from '../../lib/odoo/clientes-activos';
import { formatCompactCurrency } from './format';

interface Props {
  ventas: UltimaVentaRow[];
}

/** "YYYY-MM-DD" -> "DD/MM", sin pasar por Date/Intl (misma razón que format.ts: evitar diferencias SSR/cliente). */
function formatFechaCorta(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

/**
 * Ticker horizontal continuo (derecha a izquierda) con las últimas ventas.
 * La lista se duplica una vez para que la animación pueda hacer loop sin
 * salto visible: al llegar a -50% del ancho total (el final de la primera
 * copia) se resetea a 0%, indistinguible de seguir corriendo.
 */
export default function UltimasVentasCarousel({ ventas }: Props) {
  if (ventas.length === 0) return null;

  const items = [...ventas, ...ventas];

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900 py-3">
      <div className="mb-2 px-4 text-xs uppercase tracking-wide text-slate-500">Últimas ventas</div>
      <div className="ticker-track flex w-max gap-16 px-4">
        {items.map((v, i) => (
          <div key={`${v.partnerId}-${v.invoiceDate}-${i}`} className="flex shrink-0 items-center gap-2 text-sm">
            <span className="text-slate-500">
              {formatFechaCorta(v.invoiceDate)} · {v.horaConfirmacion}
            </span>
            <span className="text-slate-200">{v.partnerName}</span>
            <span className="font-medium text-emerald-400">{formatCompactCurrency(v.amount)}</span>
          </div>
        ))}
      </div>
      <style>{`
        .ticker-track {
          animation: ticker-scroll 70s linear infinite;
        }
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-track {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
