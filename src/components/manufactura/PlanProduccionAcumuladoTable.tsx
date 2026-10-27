import type { PlanProduccionDailyRow, PlanProduccionGauge } from './types';

interface Props {
  title: string;
  rows: PlanProduccionDailyRow[];
  pick: (row: PlanProduccionDailyRow) => PlanProduccionGauge;
  /** Rows are one-per-month (year view) instead of one-per-día — mismo criterio que PlanProduccionTrendChart. */
  monthly?: boolean;
  unit: string;
  /** Fecha (YYYY-MM-DD) hasta la que se corta el acumulado — la elige el padre según el período/fecha seleccionados, nunca "hoy" a secas (ver PlanProduccionApp.tsx). */
  cutoff: string;
}

// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const dayLabelFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', weekday: 'short', timeZone: 'UTC' });
const monthLabelFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' });
const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function rowLabel(dateIso: string, monthly: boolean): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y!, m! - 1, d!));
  return monthly ? monthLabelFmt.format(utcDate) : dayLabelFmt.format(utcDate);
}

/**
 * Acumulado corrido (suma simple, sin prorrateo) de Planificado y Cerrado,
 * cortado en `cutoff` — a propósito no se listan los días hábiles
 * posteriores a esa fecha (confirmado por el usuario: mostrarlos "parece
 * predecir el futuro" de cuánto falta cerrar). El resumen grande de arriba
 * es lo que se lee de un vistazo; la tabla de abajo (más reciente primero)
 * es el detalle día a día para quien quiera abrirla.
 */
export default function PlanProduccionAcumuladoTable({ title, rows, pick, monthly = false, unit, cutoff }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const hastaHoy = cutoff === today;
  // Días hábiles + cualquier día con movimiento: lo cerrado en un fin de semana/feriado
  // también cuenta en el "Cerrado" de arriba, así que no puede quedar fuera del acumulado.
  const habiles = (monthly ? rows : rows.filter((r) => { const g = pick(r); return g.objetivo > 0 || g.planificado > 0 || g.cerrado > 0; })).filter((r) => r.date <= cutoff);

  let acumPlanificado = 0;
  let acumCerrado = 0;
  const data = habiles.map((r) => {
    const g = pick(r);
    acumPlanificado += g.planificado;
    acumCerrado += g.cerrado;
    return { date: r.date, planificado: g.planificado, cerrado: g.cerrado, acumPlanificado, acumCerrado };
  });
  const masReciente = [...data].reverse();
  const etiquetaCorte = hastaHoy ? 'a hoy' : `al ${rowLabel(cutoff, monthly)}`;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">{title}</h3>

      {data.length === 0 ? (
        <p className="text-sm text-slate-500">Todavía no transcurrió ningún día hábil en este período.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Planificado {etiquetaCorte}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-100">
                {units.format(acumPlanificado)} <span className="text-sm font-normal text-slate-500">{unit}</span>
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Cerrado {etiquetaCorte}</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-400">
                {units.format(acumCerrado)} <span className="text-sm font-normal text-slate-500">{unit}</span>
              </p>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-500">
                <tr>
                  <th className="pb-2 text-left font-medium capitalize">{monthly ? 'Mes' : 'Día'}</th>
                  <th className="pb-2 font-medium">Planificado</th>
                  <th className="pb-2 font-medium">Acum.</th>
                  <th className="pb-2 font-medium">Cerrado</th>
                  <th className="pb-2 font-medium">Acum.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {masReciente.map((r) => (
                  <tr key={r.date} className={r.date === cutoff ? 'bg-brand-500/5' : undefined}>
                    <td className="py-1.5 text-left capitalize">{rowLabel(r.date, monthly)}</td>
                    <td className="py-1.5 tabular-nums">{units.format(r.planificado)}</td>
                    <td className="py-1.5 tabular-nums text-slate-100">{units.format(r.acumPlanificado)}</td>
                    <td className="py-1.5 tabular-nums">{units.format(r.cerrado)}</td>
                    <td className="py-1.5 tabular-nums text-slate-100">{units.format(r.acumCerrado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] text-slate-600">{unit} · acumulado corrido {etiquetaCorte} (suma simple, sin prorratear) · detalle ordenado del día más reciente al más antiguo</p>
    </div>
  );
}
