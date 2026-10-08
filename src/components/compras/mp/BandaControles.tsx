// Banda de controles de calidad de datos: resumen por estado y detalle de cada control.
import { useState } from 'react';
import type { Control, EstadoControl } from '../../../lib/compras-mp/controles';
import { Etiqueta } from './ui';

const ORDEN: EstadoControl[] = ['REVISAR', 'AVISO', 'PENDIENTE', 'OK'];

export default function BandaControles({ controles }: { controles: Control[] }) {
  const [abierta, setAbierta] = useState(false);
  const cuenta = (e: EstadoControl) => controles.filter((c) => c.estado === e).length;
  const peor = ORDEN.find((e) => cuenta(e) > 0) ?? 'OK';
  const borde = peor === 'REVISAR' ? 'border-status-red/50' : peor === 'AVISO' ? 'border-status-yellow/50' : 'border-slate-800';
  const ordenados = [...controles].sort((a, b) => ORDEN.indexOf(a.estado) - ORDEN.indexOf(b.estado));

  return (
    <div className={`rounded-lg border ${borde} bg-slate-900`}>
      <button type="button" onClick={() => setAbierta(!abierta)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left" aria-expanded={abierta}>
        <span className="text-sm font-medium text-slate-200">Controles de calidad de los datos</span>
        <span className="flex flex-wrap items-center gap-2">
          {ORDEN.filter((e) => cuenta(e) > 0).map((e) => (
            <span key={e} className="flex items-center gap-1.5">
              <Etiqueta texto={e} />
              <span className="text-xs tabular-nums text-slate-400">{cuenta(e)}</span>
            </span>
          ))}
          <span className="text-xs text-slate-500">{abierta ? 'Ocultar' : 'Ver detalle'}</span>
        </span>
      </button>
      {abierta && (
        <ul className="divide-y divide-slate-800 border-t border-slate-800">
          {ordenados.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="w-24 shrink-0"><Etiqueta texto={c.estado} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200">{c.nombre}</p>
                <p className="text-sm tabular-nums text-slate-400">{c.valor}</p>
                {c.estado !== 'OK' && <p className="mt-1 text-xs text-slate-500">Qué hacer: {c.queHacer}</p>}
                {c.detalle && c.detalle.length > 0 && <p className="mt-1 text-xs text-slate-500">{c.detalle.join(' · ')}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
