import { useState } from 'react';
import type { LineaConfig, Slot } from '@/lib/supabase/lineas-sillon';
import { SLOTS_UI, guardarSillon, type LineasSillonResponse } from './lineas-sillon-shared';

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

function LineaEditor({ inicial, data, onSaved }: { inicial: LineaConfig; data: LineasSillonResponse; onSaved: () => void }) {
  const [activa, setActiva] = useState(inicial.activa);
  const [asignados, setAsignados] = useState<LineaConfig['asignados']>(inicial.asignados);
  const [adelanto, setAdelanto] = useState(inicial.adelanto);
  const [estado, setEstado] = useState<'idle' | 'guardando' | 'ok' | string>('idle');

  const guardar = async () => {
    setEstado('guardando');
    try {
      await guardarSillon({
        tipo: 'linea',
        linea: inicial.linea,
        activa,
        asignados: Object.fromEntries(SLOTS_UI.map((s) => [s.slot, asignados[s.slot] ?? null])),
        adelanto,
      });
      setEstado('ok');
      onSaved();
    } catch (e) {
      setEstado((e as Error).message);
    }
  };

  const asignar = (slot: Slot, id: string) => setAsignados((a) => ({ ...a, [slot]: id || null }));

  return (
    <section className={`rounded-lg border p-3 ${activa ? 'border-slate-800 bg-slate-900/60' : 'border-slate-800/60 bg-slate-900/30'}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">Línea {inicial.linea}</h3>
        <label className="inline-flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
          Habilitada
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {SLOTS_UI.map((s) => (
          <label key={s.slot} className="flex flex-col gap-1 text-[11px] text-slate-500">
            {s.slot} · {s.label}
            <select className={inputCls} value={asignados[s.slot] ?? ''} onChange={(e) => asignar(s.slot, e.target.value)}>
              <option value="">— sin asignar —</option>
              {data.config.personas
                .filter((p) => p.activa && p.puesto === s.puesto)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(['tapiceria', 'ensamble'] as const).map((e) => (
          <label key={e} className="flex flex-col gap-1 text-[11px] text-slate-500">
            Adelanto en {e === 'tapiceria' ? 'tapicería (tendido)' : 'ensamble (estampado)'} — unidades que ya vienen hechas
            <input
              type="number"
              min={0}
              className={inputCls}
              value={adelanto[e]}
              onChange={(ev) => setAdelanto((a) => ({ ...a, [e]: Math.max(0, Math.floor(Number(ev.target.value) || 0)) }))}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={estado === 'guardando'}
          className="rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30 disabled:opacity-50"
        >
          Guardar
        </button>
        {estado === 'ok' && <span className="text-xs text-emerald-400">Guardado</span>}
        {estado !== 'idle' && estado !== 'ok' && estado !== 'guardando' && <span className="text-xs text-rose-400">{estado}</span>}
      </div>
    </section>
  );
}

export default function LineasSillonLineas({ data, onSaved }: { data: LineasSillonResponse; onSaved: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Habilitá o apagá cada línea (la 8 no siempre trabaja) y asigná las personas de cada puesto. El <strong>adelanto</strong> es el trabajo
        que quedó hecho del día anterior en la estación de arriba: con 0, tapicería espera a que carpintería termine cada unidad; con 3, las tres
        primeras ya están listas para tapicería desde las 06:00.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.config.lineas.map((l) => (
          <LineaEditor key={`${l.linea}-${JSON.stringify(l)}`} inicial={l} data={data} onSaved={onSaved} />
        ))}
      </div>
    </div>
  );
}
