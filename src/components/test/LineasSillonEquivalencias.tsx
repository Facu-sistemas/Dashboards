import { useState } from 'react';
import type { ProductoSinResolver } from '@/lib/lineas-sillon/plan';
import { guardarSillon, type LineasSillonResponse } from './lineas-sillon-shared';

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

function FilaSinResolver({ r, nombres, onSaved }: { r: ProductoSinResolver; nombres: string[]; onSaved: () => void }) {
  const [elegido, setElegido] = useState(r.sugeridos[0] ?? '');
  const [minutos, setMinutos] = useState('');
  const [error, setError] = useState('');

  const guardar = async (body: unknown) => {
    setError('');
    try {
      await guardarSillon(body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/60 px-3 py-2 first:border-t-0">
      <div className="min-w-[14rem] flex-1">
        <p className="text-sm text-slate-100">{r.base}</p>
        <p className="text-[11px] text-slate-500">
          {r.unidades} unidades · {r.ordenes} órdenes ·{' '}
          {r.motivo === 'sin-tiempo' ? `"${r.producto}" no tiene tiempo en la planilla` : 'no se encontró en la hoja DATOS'}
        </p>
      </div>
      {r.motivo === 'sin-equivalencia' ? (
        <>
          <select className={`${inputCls} max-w-xs`} value={elegido} onChange={(e) => setElegido(e.target.value)}>
            <option value="">— elegir producto de DATOS —</option>
            {r.sugeridos.length > 0 && (
              <optgroup label="Parecidos">
                {r.sugeridos.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Todos">
              {nombres.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            type="button"
            disabled={!elegido}
            onClick={() => void guardar({ tipo: 'alias', base: r.base, producto: elegido })}
            className="rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30 disabled:opacity-50"
          >
            Vincular
          </button>
        </>
      ) : (
        <>
          <input className={`${inputCls} w-24`} type="number" min={1} placeholder="minutos" value={minutos} onChange={(e) => setMinutos(e.target.value)} />
          <button
            type="button"
            disabled={!Number(minutos)}
            onClick={() => void guardar({ tipo: 'tiempo', producto: r.producto, minutos: Number(minutos) })}
            className="rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30 disabled:opacity-50"
          >
            Guardar tiempo
          </button>
        </>
      )}
      {error && <span className="w-full text-xs text-rose-400">{error}</span>}
    </div>
  );
}

function Manuales({ data, onSaved }: { data: LineasSillonResponse; onSaved: () => void }) {
  const conTiempo = data.plan.productos.filter((p) => p.minutos).map((p) => p.nombre);
  const [linea, setLinea] = useState(1);
  const [producto, setProducto] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');

  const accion = async (body: unknown) => {
    setError('');
    try {
      await guardarSillon(body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-100">Productos que no están en Odoo</h3>
        <p className="text-[11px] text-slate-500">
          Por ejemplo el Onix dividido en horizontal y vertical. Se planifican primero en la línea elegida y se mantienen hasta que los borres.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2 px-3 py-3">
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          Línea
          <select className={inputCls} value={linea} onChange={(e) => setLinea(Number(e.target.value))}>
            {data.config.lineas.map((l) => (
              <option key={l.linea} value={l.linea}>
                {l.linea}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-[11px] text-slate-500">
          Producto
          <select className={inputCls} value={producto} onChange={(e) => setProducto(e.target.value)}>
            <option value="">— elegir —</option>
            {conTiempo.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          Cantidad
          <input className={`${inputCls} w-20`} type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          Nota
          <input className={`${inputCls} w-40`} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="opcional" />
        </label>
        <button
          type="button"
          disabled={!producto}
          onClick={() => void accion({ tipo: 'manual', linea, producto, cantidad, nota })}
          className="rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30 disabled:opacity-50"
        >
          Agregar
        </button>
      </div>
      {error && <p className="px-3 pb-2 text-xs text-rose-400">{error}</p>}
      {data.config.manuales.map((m) => (
        <div key={m.id} className="flex items-center justify-between border-t border-slate-800/60 px-3 py-1.5 text-xs text-slate-300">
          <span>
            Línea {m.linea} · {m.cantidad}× {m.producto}
            {m.nota ? ` · ${m.nota}` : ''}
          </span>
          <button type="button" onClick={() => void accion({ tipo: 'manual-borrar', id: m.id })} className="text-rose-300 hover:underline">
            Borrar
          </button>
        </div>
      ))}
    </section>
  );
}

export default function LineasSillonEquivalencias({ data, onSaved }: { data: LineasSillonResponse; onSaved: () => void }) {
  const nombres = data.plan.productos.map((p) => p.nombre);
  const aliasPropios = Object.entries(data.config.alias);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Odoo y la planilla nombran distinto a algunos productos (p. ej. "SIRIUS-1/3CPOS(STD)" vs. la hoja DATOS). Vinculalos una sola vez y
        queda guardado. Lo que no tiene equivalencia o tiempo queda fuera del reporte.
      </p>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60">
        <div className="border-b border-slate-800 px-3 py-2 text-sm font-semibold text-slate-100">Sin resolver ({data.plan.sinResolver.length})</div>
        {data.plan.sinResolver.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-slate-500">Todo lo que viene de Odoo tiene equivalencia y tiempo.</p>
        ) : (
          data.plan.sinResolver.map((r) => <FilaSinResolver key={r.base} r={r} nombres={nombres} onSaved={onSaved} />)
        )}
      </section>

      <Manuales data={data} onSaved={onSaved} />

      {aliasPropios.length > 0 && (
        <details className="rounded-lg border border-slate-800 bg-slate-900/60">
          <summary className="cursor-pointer px-3 py-2 text-sm text-slate-300">Equivalencias guardadas ({aliasPropios.length})</summary>
          {aliasPropios.map(([base, producto]) => (
            <div key={base} className="flex items-center justify-between border-t border-slate-800/60 px-3 py-1.5 text-xs text-slate-300">
              <span>
                {base} → {producto}
              </span>
              <button
                type="button"
                onClick={() => void guardarSillon({ tipo: 'alias', base, producto: null }).then(onSaved)}
                className="text-rose-300 hover:underline"
              >
                Quitar
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
