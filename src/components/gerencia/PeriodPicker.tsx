const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const TRIMESTRES: [string, number[]][] = [
  ['T1', [0, 1, 2]],
  ['T2', [3, 4, 5]],
  ['T3', [6, 7, 8]],
  ['T4', [9, 10, 11]],
];

/** "ACU" (all elapsed months), "M<i>" (one month), or a TRIMESTRES key — shared across every Gerencia General tab with a period selector. */
export function idxsForPeriodo(periodo: string, nMeses: number): number[] {
  if (periodo === 'ACU') return Array.from({ length: nMeses }, (_, i) => i);
  if (periodo.startsWith('M')) {
    const i = Number(periodo.slice(1));
    return i < nMeses ? [i] : [];
  }
  const trimestre = TRIMESTRES.find(([key]) => key === periodo);
  return trimestre ? trimestre[1].filter((i) => i < nMeses) : [];
}

interface Props {
  nMeses: number;
  periodo: string;
  onChange: (p: string) => void;
}

export default function PeriodPicker({ nMeses, periodo, onChange }: Props) {
  const btnClass = (active: boolean, disabled: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      disabled
        ? 'cursor-not-allowed border-slate-800 text-slate-700'
        : active
          ? 'border-brand-500 bg-brand-500 text-white'
          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mes</span>
        {MESES.map((mes, i) => {
          const disabled = i >= nMeses;
          return (
            <button
              key={mes}
              type="button"
              disabled={disabled}
              className={btnClass(periodo === `M${i}`, disabled)}
              onClick={() => onChange(`M${i}`)}
            >
              {mes}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Período</span>
        {TRIMESTRES.map(([key, idxs]) => {
          const disabled = !idxs.some((i) => i < nMeses);
          return (
            <button key={key} type="button" disabled={disabled} className={btnClass(periodo === key, disabled)} onClick={() => onChange(key)}>
              {key}
            </button>
          );
        })}
        <button type="button" className={btnClass(periodo === 'ACU', false)} onClick={() => onChange('ACU')}>
          Acumulado
        </button>
      </div>
    </div>
  );
}
