import { Fragment, useMemo, useState } from 'react';
import { MESAS, claveRegla, mergeReglas, resolverRegla, type ModoTap, type ReglaTap } from '../../lib/linea-config';
import { MODO_LABEL, colorFamilia, formatMin, postConfigLinea, type ConfigLineaDto } from './linea-shared';

interface Props {
  config: ConfigLineaDto;
  onChanged: () => void;
}

/** Una fila editable: una familia de TAP, o una medida de esa familia (`sub`). */
interface FilaRegla {
  /** Clave con la que se guarda la regla: "TAP-BASE NEGRO" o "TAP-BASE NEGRO 140X190". */
  clave: string;
  titulo: string;
  ejemplos: string[];
  ordenes: number;
  unidades: number;
  horas: number;
  regla: ReglaTap | null;
  /** La regla es propia de esta clave (guardada), no heredada de la familia o de un prefijo default. */
  propia: boolean;
  sub: boolean;
  /** Solo familias: cuántas medidas tienen regla propia. */
  medidasConRegla: number;
}

interface FilaFamilia extends FilaRegla {
  medidas: FilaRegla[];
}

interface FilaEditorProps {
  fila: FilaRegla;
  mesasInactivas: string[];
  disponible: boolean;
  onChanged: () => void;
  expandida?: boolean;
  onToggle?: () => void;
}

function FilaEditor({ fila, mesasInactivas, disponible, onChanged, expandida, onToggle }: FilaEditorProps) {
  const [modo, setModo] = useState<ModoTap | ''>(fila.regla?.modo ?? '');
  const [mesas, setMesas] = useState<string[]>(fila.regla?.mesas ?? []);
  const [prioridad, setPrioridad] = useState(fila.regla?.prioridad ?? 1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cambiado =
    modo !== (fila.regla?.modo ?? '') || prioridad !== (fila.regla?.prioridad ?? 1) || mesas.join(',') !== (fila.regla?.mesas ?? []).join(',');

  async function guardar(regla: Omit<ReglaTap, 'familia'> | null) {
    setGuardando(true);
    setError(null);
    try {
      await postConfigLinea({ tipo: 'regla', familia: fila.clave, regla });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  function toggleMesa(codigo: string) {
    // Se mantiene el orden del plano (M1, M2, Costurero, Embolsadora, ...), no el orden en que se tildan.
    setMesas((prev) => MESAS.map((m) => m.codigo).filter((c) => (c === codigo ? !prev.includes(c) : prev.includes(c))));
  }

  return (
    <tr className={`border-t border-slate-800 align-top ${fila.sub ? 'bg-slate-900/50' : ''}`}>
      <td className={`px-3 py-2 ${fila.sub ? 'pl-9' : ''}`}>
        <div className="flex items-center gap-2">
          {onToggle && (
            <button type="button" onClick={onToggle} className="w-4 text-slate-400 hover:text-slate-200" title={expandida ? 'Ocultar medidas' : 'Ver medidas'}>
              {expandida ? '▾' : '▸'}
            </button>
          )}
          {!fila.sub && <span className={`inline-block h-3 w-3 rounded-sm border ${colorFamilia(fila.clave)}`} />}
          <span className={fila.sub ? 'font-medium text-slate-200' : 'font-semibold text-slate-100'}>{fila.titulo}</span>
        </div>
        {fila.ejemplos.length > 0 && <div className="mt-1 text-[11px] text-slate-500">{fila.ejemplos.join(' · ')}</div>}
        <div className="mt-1 text-[11px] text-slate-500">
          {fila.ordenes > 0 ? `${fila.ordenes} orden(es) · ${Math.round(fila.unidades)} u. · ${formatMin(fila.horas * 60)}` : 'Sin órdenes pendientes'}
          {' · '}
          {fila.regla ? (
            fila.propia ? (
              'regla propia'
            ) : (
              `hereda de ${fila.regla.familia}`
            )
          ) : (
            <span className="text-amber-400">sin regla</span>
          )}
          {fila.medidasConRegla > 0 && <span className="text-brand-400"> · {fila.medidasConRegla} medida(s) con regla propia</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <select
          value={modo}
          disabled={!disponible}
          onChange={(e) => setModo(e.target.value as ModoTap)}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
        >
          <option value="" disabled>
            Elegí...
          </option>
          {(['paralelo', 'serie', 'excluido'] as ModoTap[]).map((m) => (
            <option key={m} value={m}>
              {MODO_LABEL[m]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <div className={`flex max-w-sm flex-wrap gap-1 ${modo === 'excluido' ? 'opacity-40' : ''}`}>
          {MESAS.map((m) => {
            const on = mesas.includes(m.codigo);
            const inactiva = mesasInactivas.includes(m.codigo);
            return (
              <button
                key={m.codigo}
                type="button"
                disabled={!disponible || modo === 'excluido'}
                onClick={() => toggleMesa(m.codigo)}
                title={inactiva ? 'Mesa inactiva — no se usa hasta reactivarla' : undefined}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  on ? 'border-brand-500 bg-brand-500/20 text-slate-100' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                } ${inactiva ? 'line-through' : ''}`}
              >
                {m.nombre}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={1}
          max={99}
          value={prioridad}
          disabled={!disponible || modo === 'excluido'}
          onChange={(e) => setPrioridad(Math.min(99, Math.max(1, Number(e.target.value) || 1)))}
          className="w-14 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            disabled={!disponible || guardando || !cambiado || modo === ''}
            onClick={() => void guardar({ modo: modo as ModoTap, mesas: modo === 'excluido' ? [] : mesas, prioridad })}
            className="rounded bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-40"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          {fila.propia && (
            <button type="button" disabled={!disponible || guardando} onClick={() => void guardar(null)} className="text-[11px] text-slate-400 hover:text-slate-200">
              {fila.sub ? 'Volver a la de la familia' : 'Volver a la default'}
            </button>
          )}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>
      </td>
    </tr>
  );
}

/** Familias de TAP detectadas en Odoo + la regla que les toca, y dentro de cada una sus medidas. Guardar crea una regla propia para esa familia o medida (la de la medida pisa a la de la familia). */
export default function LineaReglasTaps({ config, onChanged }: Props) {
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  const filas = useMemo<FilaFamilia[]>(() => {
    const reglas = mergeReglas(config.reglas);
    const propias = new Set(config.reglas.map((r) => r.familia));
    const byFamilia = new Map(config.familias.map((f) => [f.familia, f]));
    // También las reglas propias de familias que hoy no tienen órdenes, para poder editarlas o borrarlas
    // (las de una medida cuelgan de su familia, no van como fila aparte).
    for (const r of config.reglas) {
      if (!byFamilia.has(r.familia) && ![...byFamilia.keys()].some((k) => r.familia.startsWith(`${k} `))) {
        byFamilia.set(r.familia, { familia: r.familia, ordenes: 0, horas: 0, ejemplos: [], medidas: [] });
      }
    }
    return [...byFamilia.values()]
      .map((f) => {
        // Sin medida legible la orden usa la clave de la familia: no hay fila de medida para ella.
        const medidas: FilaRegla[] = f.medidas
          .filter((m) => m.medida !== '')
          .map((m) => {
            const clave = claveRegla(f.familia, m.medida);
            return {
              clave,
              titulo: m.medida.replace('X', ' x '),
              ejemplos: [],
              ordenes: m.ordenes,
              unidades: m.unidades,
              horas: m.horas,
              regla: resolverRegla(clave, reglas),
              propia: propias.has(clave),
              sub: true,
              medidasConRegla: 0,
            };
          });
        return {
          clave: f.familia,
          titulo: f.familia,
          ejemplos: f.ejemplos,
          ordenes: f.ordenes,
          unidades: f.medidas.reduce((s, m) => s + m.unidades, 0),
          horas: f.horas,
          regla: resolverRegla(f.familia, reglas),
          propia: propias.has(f.familia),
          sub: false,
          medidasConRegla: medidas.filter((m) => m.propia).length,
          medidas,
        };
      })
      .sort((a, b) => (a.regla?.prioridad ?? 0) - (b.regla?.prioridad ?? 0) || a.clave.localeCompare(b.clave));
  }, [config]);

  function toggle(clave: string) {
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (!next.delete(clave)) next.add(clave);
      return next;
    });
  }

  // La key incluye la regla vigente: si cambia en el server (guardado o reset), el editor se re-inicializa con los valores nuevos.
  const keyDe = (f: FilaRegla) => `${f.clave}|${f.regla?.familia}|${f.regla?.modo}|${f.regla?.mesas.join(',')}|${f.regla?.prioridad}`;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-400">
        Se detectan solas a partir de las órdenes pendientes del filtro "Colchones Línea" (todo TAP menos TAPA). <strong>Paralelo</strong>: el tiempo se
        reparte en partes iguales entre las mesas (ej. Bases en M1 y M2). <strong>Serie</strong>: ocupa todas sus mesas a la vez durante todo el tiempo
        (Pocket / Magnum por M1 → M2 → Costurero → Embolsadora). <strong>Prioridad</strong>: menor número se planifica antes. Desplegá una familia (▸)
        para darle a una <strong>medida</strong> sus propias mesas, modo o prioridad, o excluirla; si no, hereda la de la familia.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[760px] text-xs text-slate-300">
          <thead className="bg-slate-800/60 text-left text-slate-400">
            <tr>
              <th className="px-3 py-2 font-normal">Familia de TAP / medida</th>
              <th className="px-3 py-2 font-normal">Cómo se trabaja</th>
              <th className="px-3 py-2 font-normal">Mesas</th>
              <th className="px-3 py-2 font-normal">Prioridad</th>
              <th className="px-3 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const abierta = abiertas.has(f.clave);
              return (
                <Fragment key={f.clave}>
                  <FilaEditor
                    key={keyDe(f)}
                    fila={f}
                    mesasInactivas={config.mesasInactivas}
                    disponible={config.disponible}
                    onChanged={onChanged}
                    expandida={abierta}
                    onToggle={f.medidas.length > 0 ? () => toggle(f.clave) : undefined}
                  />
                  {abierta &&
                    f.medidas.map((m) => (
                      <FilaEditor key={keyDe(m)} fila={m} mesasInactivas={config.mesasInactivas} disponible={config.disponible} onChanged={onChanged} />
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
