import { useState } from 'react';
import type { PersonaSillon, PuestoPersona } from '@/lib/supabase/lineas-sillon';
import { PUESTO_LABEL, guardarSillon, type LineasSillonResponse } from './lineas-sillon-shared';

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';
const PUESTOS = Object.keys(PUESTO_LABEL) as PuestoPersona[];

function Preferencias({ seleccion, productos, onChange }: { seleccion: string[]; productos: string[]; onChange: (v: string[]) => void }) {
  const [filtro, setFiltro] = useState('');
  const set = new Set(seleccion);
  const visibles = productos.filter((p) => p.toLowerCase().includes(filtro.toLowerCase()));
  return (
    <div className="mt-2">
      <input className={`${inputCls} w-full`} placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      <div className="mt-1.5 max-h-48 overflow-y-auto rounded border border-slate-800 p-1.5">
        {visibles.map((p) => (
          <label key={p} className="flex items-center gap-2 px-1 py-0.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={set.has(p)}
              onChange={() => onChange(set.has(p) ? seleccion.filter((x) => x !== p) : [...seleccion, p])}
            />
            {p}
          </label>
        ))}
      </div>
    </div>
  );
}

function PersonaEditor({
  persona,
  data,
  onSaved,
  onCerrar,
}: {
  persona: Partial<PersonaSillon>;
  data: LineasSillonResponse;
  onSaved: () => void;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(persona.nombre ?? '');
  const [puesto, setPuesto] = useState<PuestoPersona>(persona.puesto ?? 'costurera');
  const [activa, setActiva] = useState(persona.activa ?? true);
  const [productos, setProductos] = useState<string[]>(persona.productos ?? []);
  const [error, setError] = useState('');

  const guardar = async () => {
    setError('');
    try {
      await guardarSillon({ tipo: 'persona', id: persona.id, nombre, puesto, activa, productos });
      onSaved();
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const borrar = async () => {
    if (!persona.id || !window.confirm(`¿Borrar a ${persona.nombre}?`)) return;
    try {
      await guardarSillon({ tipo: 'persona-borrar', id: persona.id });
      onSaved();
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="rounded-lg border border-brand-500/30 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          Nombre
          <input className={inputCls} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          Puesto
          <select className={inputCls} value={puesto} onChange={(e) => setPuesto(e.target.value as PuestoPersona)}>
            {PUESTOS.map((p) => (
              <option key={p} value={p}>
                {PUESTO_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 pb-1 text-xs text-slate-300">
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
          Activa
        </label>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">Productos que le gusta hacer ({productos.length})</p>
      <Preferencias seleccion={productos} productos={data.plan.productos.map((p) => p.nombre)} onChange={setProductos} />
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => void guardar()} disabled={!nombre.trim()} className="rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30 disabled:opacity-50">
          Guardar
        </button>
        <button type="button" onClick={onCerrar} className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300">
          Cancelar
        </button>
        {persona.id && (
          <button type="button" onClick={() => void borrar()} className="ml-auto rounded border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300">
            Borrar
          </button>
        )}
        {error && <span className="text-xs text-rose-400">{error}</span>}
      </div>
    </div>
  );
}

export default function LineasSillonPersonas({ data, onSaved }: { data: LineasSillonResponse; onSaved: () => void }) {
  const [editando, setEditando] = useState<Partial<PersonaSillon> | null>(null);
  const lineaDe = (id: string) => data.config.lineas.filter((l) => Object.values(l.asignados).includes(id)).map((l) => l.linea);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-slate-400">
          Cargá al personal de cada puesto y, para las costureras, los productos que prefieren hacer. Abajo de cada una ves qué hay hoy en las
          líneas habilitadas que le gusta.
        </p>
        <button type="button" onClick={() => setEditando({})} className="shrink-0 rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30">
          + Agregar persona
        </button>
      </div>

      {!data.config.disponible && <p className="text-xs text-rose-300">Faltan las tablas en Supabase: no se puede guardar todavía.</p>}
      {editando && <PersonaEditor key={editando.id ?? 'nueva'} persona={editando} data={data} onSaved={onSaved} onCerrar={() => setEditando(null)} />}

      {PUESTOS.map((puesto) => {
        const personas = data.config.personas.filter((p) => p.puesto === puesto);
        if (personas.length === 0) return null;
        return (
          <section key={puesto}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{PUESTO_LABEL[puesto]}</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {personas.map((p) => {
                const hoy = data.plan.coincidencias[p.id] ?? [];
                const lineas = lineaDe(p.id);
                return (
                  <div key={p.id} className={`rounded-lg border border-slate-800 bg-slate-900/60 p-3 ${p.activa ? '' : 'opacity-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-100">{p.nombre}</span>
                      <button type="button" onClick={() => setEditando(p)} className="text-xs text-brand-400 hover:underline">
                        Editar
                      </button>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {lineas.length ? `Línea ${lineas.join(', ')}` : 'Sin línea asignada'} · {p.productos.length} preferencias
                    </p>
                    {p.productos.length > 0 && (
                      <p className="mt-2 text-xs text-slate-300">
                        {hoy.length === 0
                          ? 'Hoy no hay nada de lo que le gusta.'
                          : hoy.map((h) => `${h.unidades}× ${h.producto} (L${h.linea})`).join(' · ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {data.config.personas.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Todavía no hay personas cargadas.</p>}
    </div>
  );
}
