import { useMemo } from 'react';
import { ANCHO_ROLLO, calcularSobrantes, type CorteRow, type OptimizacionTela } from '../../lib/bandas-calc';
import { createColorForAlto, desperdicioClasses, telaBadgeClasses } from './bandas-ui';

interface Props {
  optData: OptimizacionTela[];
  corteRows: CorteRow[];
  onAgregarSobrantesAlStock: (tiras: { tela: string; alto: number; cantidad: number }[]) => void;
}

export default function BandasOptimizacion({ optData, corteRows, onAgregarSobrantesAlStock }: Props) {
  const sobrantes = useMemo(() => calcularSobrantes(optData, corteRows), [optData, corteRows]);

  const { totalRollos, totalDesp, eficienciaTotal } = useMemo(() => {
    let rollos = 0;
    let desp = 0;
    let capacidad = 0;
    for (const d of optData) {
      rollos += d.totalRollos;
      desp += d.totalDesp;
      capacidad += d.totalRollos * ANCHO_ROLLO;
    }
    const eficiencia = capacidad > 0 ? (((capacidad - desp) / capacidad) * 100).toFixed(1) : '100';
    return { totalRollos: rollos, totalDesp: desp, eficienciaTotal: eficiencia };
  }, [optData]);

  function exportarSobrantes() {
    const out: Record<string, number> = {};
    for (const s of sobrantes) {
      for (const t of s.tiras) {
        const k = `${s.tela}||${t.alto}`;
        out[k] = (out[k] ?? 0) + t.cantidad;
      }
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stock_rollos_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function agregarAlStock() {
    const tiras = sobrantes.flatMap((s) => s.tiras.map((t) => ({ tela: s.tela, alto: t.alto, cantidad: t.cantidad })));
    onAgregarSobrantesAlStock(tiras);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-brand-600/30 bg-brand-500/5 p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-400">
          Resumen optimización — rollo grande = {ANCHO_ROLLO} cm
        </div>
        <div className="flex flex-wrap gap-8">
          <div>
            <div className="text-2xl font-bold text-brand-400">{totalRollos}</div>
            <div className="text-xs text-brand-400/80">rollos grandes necesarios</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-brand-400">{totalDesp} cm</div>
            <div className="text-xs text-brand-400/80">cm desperdiciados en total</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-brand-400">{eficienciaTotal}%</div>
            <div className="text-xs text-brand-400/80">eficiencia de corte</div>
          </div>
        </div>
      </div>

      {sobrantes.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">
              ✂️ Cómo cortar los rollos sobrantes
            </span>
          </div>
          <p className="mb-3 text-xs text-amber-400/80">Guardá estas tiras como stock para la próxima planificación.</p>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sobrantes.map((s) => (
              <div key={`${s.tela}-${s.rolloId}`} className="rounded-md border border-amber-500/20 bg-slate-950/40 p-3">
                <div className="mb-1.5 text-xs text-slate-400">
                  Rollo grande #{s.rolloId} — {s.tela} ({s.desperdicio} cm sobrantes)
                </div>
                {s.tiras.map((t) => (
                  <div key={t.alto} className="text-sm font-semibold text-slate-100">
                    <span className="text-base font-bold text-brand-400">
                      {t.cantidad} × {t.alto} cm
                    </span>
                  </div>
                ))}
                {s.descarte > 0 && <div className="mt-1 text-xs text-slate-600">Descarte: {s.descarte} cm</div>}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportarSobrantes}
              className="rounded border border-brand-600/50 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/10"
            >
              ↓ Exportar stock sobrante
            </button>
            <button
              type="button"
              onClick={agregarAlStock}
              className="rounded border border-brand-600/50 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/10"
            >
              + Agregar al stock
            </button>
          </div>
        </div>
      )}

      {optData.map((d) => {
        const colorForAlto = createColorForAlto();
        const altosUnicos = [...new Set(d.rollones.flatMap((r) => r.tiras))].sort((a, b) => b - a);
        altosUnicos.forEach((a) => colorForAlto(a));

        return (
          <div key={d.tela}>
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${telaBadgeClasses(d.tela)}`}>
                {d.tela}
              </span>
              <span className="text-base font-semibold text-slate-100">{d.tela}</span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2.5">
              <div className="min-w-[110px] rounded-md bg-slate-900 px-3.5 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Rollos grandes</div>
                <div className="text-lg font-bold text-brand-400">{d.totalRollos}</div>
              </div>
              <div className="min-w-[110px] rounded-md bg-slate-900 px-3.5 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Desperdicio total</div>
                <div className={`text-lg font-bold ${d.totalDesp === 0 ? 'text-brand-400' : d.totalDesp < 50 ? 'text-slate-100' : 'text-amber-400'}`}>
                  {d.totalDesp} cm
                </div>
              </div>
              <div className="min-w-[110px] rounded-md bg-slate-900 px-3.5 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Eficiencia</div>
                <div className="text-lg font-bold text-brand-400">{d.eficiencia}%</div>
              </div>
            </div>

            <div className="mb-2.5 flex flex-wrap gap-3">
              {altosUnicos.map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colorForAlto(a) }} />
                  Alto {a} cm
                </span>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {d.rollones.map((r) => {
                const conteo = new Map<number, number>();
                for (const t of r.tiras) conteo.set(t, (conteo.get(t) ?? 0) + 1);

                return (
                  <div key={r.id} className="overflow-hidden rounded-lg border border-slate-800">
                    <div className="flex justify-between bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-400">
                      <span>Rollo grande #{r.id}</span>
                      <span>
                        {r.usado} / {ANCHO_ROLLO} cm
                      </span>
                    </div>
                    <div className="p-2.5">
                      <div className="mb-2 flex h-7 overflow-hidden rounded border border-slate-800">
                        {r.tiras.map((t, i) => (
                          <div
                            key={i}
                            title={`Alto ${t}cm`}
                            className="flex min-w-[12px] items-center justify-center text-[10px] font-bold text-white"
                            style={{ width: `${(t / ANCHO_ROLLO) * 100}%`, background: colorForAlto(t) }}
                          >
                            {t >= 20 ? t : ''}
                          </div>
                        ))}
                        {r.desp > 0 && (
                          <div
                            title={`Desperdicio ${r.desp}cm`}
                            className="flex min-w-[12px] items-center justify-center bg-slate-800 text-[10px] font-bold text-slate-500"
                            style={{ width: `${(r.desp / ANCHO_ROLLO) * 100}%` }}
                          >
                            {r.desp >= 15 ? r.desp : ''}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {[...conteo.entries()]
                          .sort((a, b) => b[0] - a[0])
                          .map(([alto, cant]) => (
                            <span key={alto} className="mb-1 mr-1.5 inline-block rounded bg-slate-800 px-1.5 py-0.5 font-semibold">
                              {cant} × {alto}cm
                            </span>
                          ))}
                      </div>
                      <div className={`mt-1.5 text-xs ${desperdicioClasses(r.desp)}`}>
                        {r.desp === 0 ? '✓ Sin desperdicio' : `Desperdicio: ${r.desp} cm`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
