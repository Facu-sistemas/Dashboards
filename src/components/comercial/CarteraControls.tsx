import type { Controles, ParetoMode } from './cartera-clientes-calc';

interface Props {
  controles: Controles;
  onChange: (c: Controles) => void;
  minDate: string;
  maxDate: string;
  defaults: Controles;
}

const PARETO_OPTIONS: { value: ParetoMode; label: string }[] = [
  { value: '6', label: 'Últimos 6 meses' },
  { value: '12', label: 'Últimos 12 meses' },
  { value: 'ytd', label: 'Año en curso' },
  { value: 'all', label: 'Histórico completo' },
];

const COMPARE_OPTIONS = [90, 180, 365];

export default function CarteraControls({ controles, onChange, minDate, maxDate, defaults }: Props) {
  const set = <K extends keyof Controles>(k: K, v: Controles[K]) => onChange({ ...controles, [k]: v });

  return (
    <div className="flex flex-wrap items-end gap-5 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Fecha de corte
        <input
          type="date"
          min={minDate}
          max={maxDate}
          value={controles.cutoffStr}
          onChange={(e) => set('cutoffStr', e.target.value || maxDate)}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Período activo (días)
        <input
          type="number"
          min={7}
          max={365}
          value={controles.periodoActivo}
          onChange={(e) => set('periodoActivo', Math.max(7, Number(e.target.value) || 90))}
          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Monto mínimo ($)
        <input
          type="number"
          step={500000}
          min={0}
          value={controles.montoMinimo}
          onChange={(e) => set('montoMinimo', Math.max(0, Number(e.target.value) || 0))}
          className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Umbral dormido (días)
        <input
          type="number"
          min={30}
          max={720}
          value={controles.umbralDormido}
          onChange={(e) => set('umbralDormido', Math.max(30, Number(e.target.value) || 180))}
          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Ventana Pareto
        <select
          value={controles.paretoMode}
          onChange={(e) => set('paretoMode', e.target.value as ParetoMode)}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
        >
          {PARETO_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Comparar contra
        <select
          value={controles.compareDays}
          onChange={(e) => set('compareDays', Number(e.target.value))}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
        >
          {COMPARE_OPTIONS.map((d) => (
            <option key={d} value={d}>
              Hace {d} días
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => onChange(defaults)}
        className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-brand-500/60 hover:text-slate-200"
      >
        Restablecer
      </button>
    </div>
  );
}
