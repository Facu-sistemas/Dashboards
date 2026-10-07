import { useState } from 'react';
import { UMBRAL_PARECIDO, UMBRAL_RECONOCIMIENTO, type ParParecido } from '../../lib/fichaje-matching';

interface Props {
  pares: ParParecido[];
  totalPersonas: number;
}

const MAX_FILAS = 100;

/**
 * Reporte de empleados cuyas caras quedaron cerca unas de otras (se calcula al cargar la página, con los vectores
 * guardados). Sirve para detectar, una vez cargados todos, a quiénes el sistema podría confundir y volver a registrarlos.
 */
export default function FichajeParecidosAdmin({ pares, totalPersonas }: Props) {
  const [soloAltos, setSoloAltos] = useState(false);

  const altos = pares.filter((p) => p.distancia <= UMBRAL_RECONOCIMIENTO);
  const vigilar = pares.length - altos.length;
  const visibles = (soloAltos ? altos : pares).slice(0, MAX_FILAS);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">Pares parecidos (Fichaje)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Empleados cuyas caras quedaron cerca entre sí, medidas igual que al reconocer. Rojo (hasta {UMBRAL_RECONOCIMIENTO.toFixed(2)}): el sistema los
          puede confundir. Ámbar (hasta {UMBRAL_PARECIDO.toFixed(2)}): conviene vigilarlos. Para corregirlo, eliminá el registro de uno de los dos y
          volvé a cargarlo con mejor luz y otro ángulo. Se calcula al abrir esta página.
        </p>
      </div>

      {totalPersonas < 2 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-6 text-center text-sm text-slate-500">
          Hace falta tener al menos 2 personas registradas para comparar.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-slate-400">
              {totalPersonas} personas registradas ·{' '}
              <span className={altos.length > 0 ? 'font-medium text-red-400' : 'text-emerald-400'}>{altos.length} en riesgo alto</span> ·{' '}
              <span className={vigilar > 0 ? 'text-amber-300' : 'text-slate-400'}>{vigilar} a vigilar</span>
            </span>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-300">
              <input type="checkbox" checked={soloAltos} onChange={(e) => setSoloAltos(e.target.checked)} className="accent-brand-500" />
              Solo riesgo alto
            </label>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            {visibles.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-emerald-400">
                {soloAltos ? 'Ningún par en riesgo alto.' : 'Ningún par de empleados se parece lo suficiente como para confundirse.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {visibles.map((p) => {
                  const alto = p.distancia <= UMBRAL_RECONOCIMIENTO;
                  return (
                    <li key={`${p.aId}-${p.bId}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <p className="text-sm text-slate-100">
                        {p.aNombre} <span className="text-slate-500">↔</span> {p.bNombre}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-sm ${alto ? 'text-red-400' : 'text-amber-300'}`}>{p.distancia.toFixed(2)}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                            alto ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          {alto ? 'Se confunden' : 'Parecidos'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {(soloAltos ? altos : pares).length > MAX_FILAS && (
            <p className="text-xs text-slate-500">Se muestran los {MAX_FILAS} pares más parecidos.</p>
          )}
        </>
      )}
    </section>
  );
}
