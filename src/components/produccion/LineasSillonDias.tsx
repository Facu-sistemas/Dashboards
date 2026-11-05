import type { LineaPlan } from '@/lib/lineas-sillon/plan';
import { SLOTS_UI, cantidadDias, fechaCorta, fechaDia, porcentaje, tonoEficiencia } from './lineas-sillon-shared';
import { CIERRE_SEG } from '@/lib/lineas-sillon/engine';

/** Unidades consecutivas del mismo producto, juntas: "8× TULIO, S1C(STD)  6:27 → 9:46". */
function agrupar(lp: LineaPlan, dia: number) {
  const tramos = lp.estaciones[0]!.tramos.filter((t) => t.dia === dia);
  const grupos: { producto: string; n: number; desde: string; hasta: string }[] = [];
  for (const t of tramos) {
    const g = grupos.at(-1);
    if (g && g.producto === t.producto) {
      g.n += 1;
      g.hasta = t.finReloj;
    } else grupos.push({ producto: t.producto, n: 1, desde: t.finReloj, hasta: t.finReloj });
  }
  const ultimo = tramos.at(-1);
  return { grupos, unidades: tramos.length, eficiencia: ultimo ? ultimo.finRelojSeg / CIERRE_SEG : 0 };
}

/** Grilla de planificación: una fila por línea y una columna por día planificado. */
export default function LineasSillonDias({
  lineas,
  hoy,
  nombres,
  onElegirDia,
}: {
  lineas: LineaPlan[];
  hoy: string;
  nombres: Map<string, string>;
  onElegirDia: (dia: number) => void;
}) {
  const dias = cantidadDias(lineas);
  const columnas = Array.from({ length: dias }, (_, d) => d);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-900/80 text-left">
            <th className="sticky left-0 z-10 min-w-[9rem] bg-slate-900 px-3 py-2 font-medium text-slate-400">Línea</th>
            {columnas.map((d) => (
              <th key={d} className="min-w-[15rem] border-l border-slate-800 px-3 py-2 font-medium capitalize text-slate-200">
                <button type="button" onClick={() => onElegirDia(d)} className="hover:text-brand-400 hover:underline" title="Ver este día completo">
                  {fechaCorta(fechaDia(hoy, d))}
                </button>
                {d === 0 && <span className="ml-1.5 text-[10px] font-normal text-brand-400">hoy</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineas.map((lp) => {
            const personas = SLOTS_UI.map((s) => (lp.config.asignados[s.slot] ? nombres.get(lp.config.asignados[s.slot]!) : undefined)).filter(Boolean);
            return (
              <tr key={lp.linea} className="border-t border-slate-800 align-top">
                <th className="sticky left-0 z-10 bg-slate-950 px-3 py-2 text-left align-top">
                  <div className="text-sm font-semibold text-slate-100">Línea {lp.linea}</div>
                  <div className="mt-0.5 max-w-[9rem] text-[10px] font-normal leading-snug text-slate-500">{personas.join(' · ') || '—'}</div>
                </th>
                {columnas.map((d) => {
                  const { grupos, unidades, eficiencia } = agrupar(lp, d);
                  return (
                    <td key={d} className="border-l border-slate-800 px-3 py-2">
                      {unidades === 0 ? (
                        <span className="text-slate-700">—</span>
                      ) : (
                        <>
                          <ul className="space-y-0.5">
                            {grupos.map((g, i) => (
                              <li key={i} className="flex items-baseline justify-between gap-2">
                                <span className="text-slate-200">
                                  <span className="tabular-nums text-slate-500">{g.n}× </span>
                                  {g.producto}
                                </span>
                                <span className="whitespace-nowrap tabular-nums text-slate-500">
                                  {g.n > 1 ? `${g.desde} → ${g.hasta}` : g.hasta}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-1.5 flex justify-between border-t border-slate-800/60 pt-1 text-[10px] text-slate-500">
                            <span>{unidades} unid.</span>
                            <span className={`font-semibold tabular-nums ${tonoEficiencia(eficiencia)}`}>{porcentaje(eficiencia)}</span>
                          </div>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
