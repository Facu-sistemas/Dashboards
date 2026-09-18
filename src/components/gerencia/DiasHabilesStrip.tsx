interface Props {
  diasTranscurridos: number[];
  diasTotal: number[];
  idxs: number[];
}

function sum(arr: number[], idxs: number[]): number {
  return idxs.reduce((a, i) => a + (arr[i] ?? 0), 0);
}

/**
 * Franja "X de Y días hábiles" — mismo elemento que el tablero original
 * (public/data/index.html, #dias-strip): para un único mes seleccionado
 * dice "... - N% del mes", para un período de varios meses dice
 * "... días hábiles del período" (sin el "% del mes", que no tendría
 * sentido sumado entre meses distintos).
 */
export default function DiasHabilesStrip({ diasTranscurridos, diasTotal, idxs }: Props) {
  const dt = sum(diasTranscurridos, idxs);
  const dm = sum(diasTotal, idxs);
  const pct = dm > 0 ? Math.round((dt / dm) * 100) : 100;
  const isSingle = idxs.length === 1;
  const label = isSingle ? `${dt} de ${dm} días hábiles - ${pct}% del mes` : `${dt} de ${dm} días hábiles del período`;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <span className="whitespace-nowrap text-xs font-medium text-slate-300">{label}</span>
      <div className="h-1.5 min-w-[6rem] flex-1 rounded-full bg-slate-800">
        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs font-semibold text-brand-400">{pct}%</span>
    </div>
  );
}
