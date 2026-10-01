import { useState } from 'react';
import { MESAS, type MesaDef } from '../../lib/linea-config';
import { postConfigLinea } from './linea-shared';

interface Props {
  mesasInactivas: string[];
  disponible: boolean;
  onChanged: () => void;
}

function MesaShape({ mesa, activa, guardando, onClick }: { mesa: MesaDef; activa: boolean; guardando: boolean; onClick: () => void }) {
  const stroke = activa ? (mesa.sector === 'resorte' ? '#38bdf8' : '#a78bfa') : '#64748b';
  const fill = activa ? (mesa.sector === 'resorte' ? 'rgba(56,189,248,0.15)' : 'rgba(167,139,250,0.15)') : 'rgba(100,116,139,0.08)';
  const props = {
    fill,
    stroke,
    strokeWidth: 3,
    strokeDasharray: activa ? undefined : '6 5',
  };
  const cx = mesa.x + mesa.w / 2;
  const cy = mesa.y + mesa.h / 2;
  // Las mesas de la línea resorte tienen el nombre al costado en el croquis; el resto, adentro.
  const labelAlLado = mesa.codigo === 'COSTURA' || mesa.codigo === 'EMBOLSADO' || mesa.codigo === 'EMBALADORA';

  return (
    <g onClick={onClick} className={`cursor-pointer ${guardando ? 'opacity-50' : 'hover:opacity-80'}`} role="button" aria-label={`${mesa.nombre}: ${activa ? 'activa' : 'inactiva'}`}>
      {mesa.forma === 'circulo' ? (
        <ellipse cx={cx} cy={cy} rx={mesa.w / 2} ry={mesa.h / 2} {...props} />
      ) : (
        <rect x={mesa.x} y={mesa.y} width={mesa.w} height={mesa.h} rx={6} {...props} />
      )}
      {labelAlLado ? (
        <text
          x={mesa.codigo === 'EMBALADORA' ? mesa.x - 10 : mesa.x + mesa.w + 8}
          y={cy + 5}
          textAnchor={mesa.codigo === 'EMBALADORA' ? 'end' : 'start'}
          className="fill-slate-200 text-[15px]"
        >
          {mesa.nombre}
        </text>
      ) : (
        <text x={cx} y={cy + 5} textAnchor="middle" className="fill-slate-100 text-[15px] font-semibold">
          {mesa.nombre}
        </text>
      )}
      {!activa && (
        <text x={cx} y={mesa.y + mesa.h + 16} textAnchor="middle" className="fill-slate-500 text-[11px]">
          inactiva
        </text>
      )}
    </g>
  );
}

/** Plano de la planta (calcado del croquis del usuario). Click en una mesa = activar / desactivar. Una mesa inactiva no se usa al planificar. */
export default function LineaMesasPlano({ mesasInactivas, disponible, onChanged }: Props) {
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(codigo: string) {
    if (!disponible || guardando) return;
    setGuardando(codigo);
    setError(null);
    try {
      await postConfigLinea({ tipo: 'mesa', codigo, activa: mesasInactivas.includes(codigo) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-400">
        Click en una mesa para activarla o desactivarla. Las inactivas (punteadas) no se toman para la planificación: una tarea en paralelo se reparte
        entre las que quedan y un circuito en serie sigue solo con las activas.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="w-full overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/60 p-2">
        <svg viewBox="-110 -40 1160 700" className="mx-auto w-full min-w-[640px] max-w-5xl">
          <text x={470} y={-14} textAnchor="middle" className="fill-slate-500 text-[14px]">Sur</text>
          <text x={470} y={650} textAnchor="middle" className="fill-slate-500 text-[14px]">Norte</text>
          <text x={-60} y={310} textAnchor="middle" className="fill-slate-500 text-[14px]">Este</text>
          <text x={1000} y={310} textAnchor="middle" className="fill-slate-500 text-[14px]">Oeste</text>

          <rect x={0} y={0} width={925} height={612} fill="none" stroke="#94a3b8" strokeWidth={4} />
          <line x1={315} y1={80} x2={315} y2={480} stroke="#94a3b8" strokeWidth={3} />
          <text x={60} y={38} className="fill-sky-300 text-[16px] font-semibold">Línea Resorte</text>
          <text x={530} y={50} className="fill-violet-300 text-[16px] font-semibold">Espuma</text>

          {MESAS.map((m) => (
            <MesaShape key={m.codigo} mesa={m} activa={!mesasInactivas.includes(m.codigo)} guardando={guardando === m.codigo} onClick={() => void toggle(m.codigo)} />
          ))}
        </svg>
      </div>
    </div>
  );
}
