import { useState } from 'react';
import type { JornadaPersona } from '@/lib/supabase/fichaje-marcas';

interface Props {
  jornadas: JornadaPersona[];
  error: string | null;
}

const RANGOS = [
  { dias: 7, label: '7 días' },
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
] as const;

function hora(min: number): string {
  const total = Math.round(min);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface Fila {
  id: number;
  nombre: string;
  promedio: number;
  dias: number;
}

function Ranking({ titulo, filas, color }: { titulo: string; filas: Fila[]; color: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <h3 className={`mb-2 text-sm font-medium ${color}`}>{titulo}</h3>
      {filas.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">Sin datos suficientes.</p>
      ) : (
        <ol className="flex flex-col">
          {filas.map((f, i) => (
            <li key={f.id} className="flex items-center gap-2 border-b border-slate-800/60 py-1.5 text-xs last:border-0">
              <span className="w-5 shrink-0 text-right font-mono text-slate-500">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{f.nombre}</span>
              <span className="shrink-0 text-slate-500">{f.dias} d</span>
              <span className="w-12 shrink-0 text-right font-mono text-sm text-slate-100">{hora(f.promedio)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Ranking de quién entra y sale más temprano / más tarde en promedio (primera entrada y última salida de cada día). */
export default function FichajePuntualidadAdmin({ jornadas, error }: Props) {
  const [dias, setDias] = useState<number>(30);
  const [minDias, setMinDias] = useState(3);
  const [cuantos, setCuantos] = useState(10);

  if (error) {
    return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">No se pudieron leer las fichadas: {error}</p>;
  }

  const limite = new Date(Date.now() - dias * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const porPersona = new Map<number, { nombre: string; e: number[]; s: number[] }>();
  for (const j of jornadas) {
    if (j.dia < limite) continue;
    const p = porPersona.get(j.empleadoId) ?? { nombre: j.empleadoNombre, e: [], s: [] };
    if (j.entrada !== null) p.e.push(j.entrada);
    if (j.salida !== null) p.s.push(j.salida);
    porPersona.set(j.empleadoId, p);
  }
  const prom = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const armar = (campo: 'e' | 's'): Fila[] =>
    [...porPersona.entries()]
      .filter(([, p]) => p[campo].length >= minDias)
      .map(([id, p]) => ({ id, nombre: p.nombre, promedio: prom(p[campo]), dias: p[campo].length }));
  const entradas = armar('e');
  const salidas = armar('s');
  const asc = (a: Fila, b: Fila) => a.promedio - b.promedio;
  const desc = (a: Fila, b: Fila) => b.promedio - a.promedio;
  const top = (xs: Fila[], f: (a: Fila, b: Fila) => number) => [...xs].sort(f).slice(0, cuantos);

  const sel = 'rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300';

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">Puntualidad: quién entra y sale primero / último</h2>
        <p className="mt-1 text-xs text-slate-500">
          Promedio de la hora de la <strong>primera entrada</strong> y de la <strong>última salida</strong> de cada día (hora Argentina), según las fichadas por
          kiosco. Solo cuentan personas con al menos {minDias} días registrados en el período.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-slate-700 text-xs">
          {RANGOS.map((r) => (
            <button
              key={r.dias}
              type="button"
              onClick={() => setDias(r.dias)}
              className={`px-3 py-1.5 ${dias === r.dias ? 'bg-slate-700 text-slate-100' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          Mín. días
          <select className={sel} value={minDias} onChange={(e) => setMinDias(Number(e.target.value))}>
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          Top
          <select className={sel} value={cuantos} onChange={(e) => setCuantos(Number(e.target.value))}>
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Ranking titulo="Entran más temprano" color="text-emerald-400" filas={top(entradas, asc)} />
        <Ranking titulo="Entran más tarde" color="text-amber-300" filas={top(entradas, desc)} />
        <Ranking titulo="Salen más temprano" color="text-sky-400" filas={top(salidas, asc)} />
        <Ranking titulo="Salen más tarde" color="text-red-400" filas={top(salidas, desc)} />
      </div>
    </section>
  );
}
