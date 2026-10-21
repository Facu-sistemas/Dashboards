import { fmtGap, fmtMoney, fmtNumber, fmtPct } from '@/lib/rentabilidad/format';
import Etiqueta from './Etiqueta';
import type { Metricas } from '@/lib/rentabilidad/types';
import SemaforoBadge from './SemaforoBadge';

const TD = 'py-2 pr-4 text-right tabular-nums';

/** Encabezados de las columnas de métricas (van después de las columnas de identidad de cada tabla). */
export function EncabezadosMetricas() {
  return (
    <>
      <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="venta">Venta</Etiqueta></th>
      <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="cantidad">Cantidad</Etiqueta></th>
      <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="contribucion">Contribución $</Etiqueta></th>
      <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="contribucionPct">% Contrib.</Etiqueta></th>
      <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="gap">Gap vs objetivo</Etiqueta></th>
      <th className="py-2 pr-4 text-right font-medium"><Etiqueta clave="margenPerdido">Margen perdido</Etiqueta></th>
      <th className="py-2 font-medium"><Etiqueta clave="estado">Estado</Etiqueta></th>
    </>
  );
}

/** Celdas de métricas de una fila. Todo lo que depende de costos muestra "—" si no hay costo (nunca un valor inventado). */
export function CeldasMetricas({ m, omitirVenta = false }: { m: Metricas; omitirVenta?: boolean }) {
  const color =
    m.estado === 'verde' ? 'text-status-green' : m.estado === 'amarillo' ? 'text-status-yellow' : m.estado === 'rojo' ? 'text-status-red' : 'text-slate-500';
  return (
    <>
      {!omitirVenta && <td className={`${TD} text-slate-200`}>{fmtMoney(m.venta)}</td>}
      <td className={`${TD} text-slate-300`}>{fmtNumber(m.cantidad)}</td>
      <td className={`${TD} text-slate-300`}>{fmtMoney(m.contribucion)}</td>
      <td className={`${TD} font-medium ${color}`}>{fmtPct(m.contribucionPct)}</td>
      <td className={`${TD} text-slate-300`}>{fmtGap(m.gapPct)}</td>
      <td className={`${TD} text-slate-300`}>{fmtMoney(m.margenPerdido)}</td>
      <td className="py-2">
        <SemaforoBadge estado={m.estado} />
      </td>
    </>
  );
}
