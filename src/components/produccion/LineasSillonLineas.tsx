import { useState } from 'react';
import type { LineaConfig, Slot } from '@/lib/supabase/lineas-sillon';
import { SLOTS_UI, guardarSillon, type LineasSillonResponse } from './lineas-sillon-shared';

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

type Asignados = LineaConfig['asignados'];

interface EditorProps {
  inicial: LineaConfig;
  data: LineasSillonResponse;
  /** Asignaciones en edición de esta línea (el borrador vive en el padre para que las demás líneas lo vean). */
  asignados: Asignados;
  onAsignar: (slot: Slot, id: string | null) => void;
  /** Personas que ya están en otra línea habilitada: una persona no puede trabajar en dos lugares a la vez. */
  ocupadasEnOtras: Set<string>;
  onSaved: () => void;
}

function LineaEditor({ inicial, data, asignados, onAsignar, ocupadasEnOtras, onSaved }: EditorProps) {
  const [activa, setActiva] = useState(inicial.activa);
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
            {s.label}
            <select className={inputCls} value={asignados[s.slot] ?? ''} onChange={(e) => onAsignar(s.slot, e.target.value || null)}>
              <option value="">— sin asignar —</option>
              {data.config.personas
                .filter((p) => p.activa && p.puesto === s.puesto)
                // Se oculta a quien ya está en otro puesto de esta línea o en otra línea; la persona elegida en este puesto sigue visible.
                .filter((p) => p.id === asignados[s.slot] || (!ocupadasEnOtras.has(p.id) && !SLOTS_UI.some((o) => o.slot !== s.slot && asignados[o.slot] === p.id)))
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
  const [borradores, setBorradores] = useState<Record<number, Asignados>>({});
  const asignadosDe = (l: LineaConfig): Asignados => borradores[l.linea] ?? l.asignados;
  const asignar = (l: LineaConfig, slot: Slot, id: string | null) =>
    setBorradores((b) => ({ ...b, [l.linea]: { ...asignadosDe(l), [slot]: id } }));

  // Solo cuentan las líneas habilitadas (según lo guardado): apagar una línea libera a su gente.
  const ocupadasPorOtras = (linea: number) => {
    const ids = new Set<string>();
    for (const o of data.config.lineas) {
      if (o.linea === linea || !o.activa) continue;
      for (const id of Object.values(asignadosDe(o))) if (id) ids.add(id);
    }
    return ids;
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Habilitá o apagá cada línea (la 8 no siempre trabaja) y asigná las personas de cada puesto. Una persona elegida en una línea ya no se
        ofrece en las demás, porque no puede trabajar en dos lugares a la vez; para pasarla a otra línea, sacala de la primera. El{' '}
        <strong>adelanto</strong> es el trabajo que ya viene hecho de la estación de arriba: con un número alto (200, el valor inicial) las tres
        estaciones arrancan a las 06:00 en paralelo, igual que la planilla; con 0, tapicería espera a que carpintería termine cada unidad; con
        3, las tres primeras ya están listas para tapicería desde las 06:00.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.config.lineas.map((l) => (
          <LineaEditor
            key={`${l.linea}-${JSON.stringify(l)}`}
            inicial={l}
            data={data}
            asignados={asignadosDe(l)}
            onAsignar={(slot, id) => asignar(l, slot, id)}
            ocupadasEnOtras={ocupadasPorOtras(l.linea)}
            onSaved={onSaved}
          />
        ))}
      </div>
    </div>
  );
}
