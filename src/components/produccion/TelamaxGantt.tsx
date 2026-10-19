import { MINUTOS_TURNO } from '@/lib/telamax/engine';
import { formatHoraGantt } from '@/lib/telamax/fechas';
import { marcasEje, type BarraGantt } from './telamax-ui';

interface Props {
  titulo: string;
  filas: string[];
  barras: BarraGantt[];
  leyenda: [string, string][];
  maxT: number;
}

const PX_POR_MIN = 1.5;
const IZQ = 88;
const TOP = 30;
const FILA_ALTO = 46;

/** Gantt continuo (varios días en un mismo eje): azul = inicio de jornada, rojo punteado = fin. */
export default function TelamaxGantt({ titulo, filas, barras, leyenda, maxT }: Props) {
  const largoMin = maxT + 20;
  const ancho = IZQ + largoMin * PX_POR_MIN + 16;
  const alto = TOP + filas.length * FILA_ALTO + 22;
  const x = (t: number) => IZQ + t * PX_POR_MIN;
  const dias = Math.floor(maxT / MINUTOS_TURNO) + 1;
  const horas = marcasEje(maxT);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-100">{titulo}</h3>
      <div className="overflow-x-auto">
        <svg width={ancho} height={alto} role="img" aria-label={titulo} className="block">
          {horas.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={TOP} y2={TOP + filas.length * FILA_ALTO} className="stroke-slate-700" strokeDasharray="2 3" strokeWidth={0.6} />
              <text x={x(t)} y={TOP + filas.length * FILA_ALTO + 14} textAnchor="middle" fontSize={9} className="fill-slate-500">
                {formatHoraGantt(t)}
              </text>
            </g>
          ))}

          {filas.map((f, i) => (
            <g key={f}>
              <rect x={IZQ} y={TOP + i * FILA_ALTO} width={largoMin * PX_POR_MIN} height={FILA_ALTO} className="fill-transparent stroke-slate-800" />
              <text x={IZQ - 8} y={TOP + i * FILA_ALTO + FILA_ALTO / 2 + 4} textAnchor="end" fontSize={11} className="fill-slate-300">
                {f}
              </text>
            </g>
          ))}

          {barras.map((b, i) => (
            <rect
              key={i}
              x={x(b.inicio)}
              y={TOP + b.fila * FILA_ALTO + 6}
              width={Math.max(1, (b.fin - b.inicio) * PX_POR_MIN)}
              height={FILA_ALTO - 12}
              fill={b.color}
              stroke={b.bordeClaro ? '#fff' : '#000'}
              strokeWidth={0.5}
            >
              <title>{b.titulo}</title>
            </rect>
          ))}

          {Array.from({ length: dias }, (_, d) => (
            <g key={d}>
              <line x1={x(d * MINUTOS_TURNO)} x2={x(d * MINUTOS_TURNO)} y1={TOP - 6} y2={TOP + filas.length * FILA_ALTO} stroke="#2980b9" strokeWidth={1.4} />
              <text x={x(d * MINUTOS_TURNO) + 3} y={TOP - 10} fontSize={9} fontWeight={700} fill="#2980b9">
                D{d + 1} 06:00
              </text>
              <line x1={x((d + 1) * MINUTOS_TURNO)} x2={x((d + 1) * MINUTOS_TURNO)} y1={TOP - 6} y2={TOP + filas.length * FILA_ALTO} stroke="#c0392b" strokeWidth={1.2} strokeDasharray="5 3" />
              <text x={x((d + 1) * MINUTOS_TURNO) - 3} y={TOP - 10} fontSize={9} fontWeight={700} fill="#c0392b" textAnchor="end">
                Fin D{d + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {leyenda.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
          {leyenda.map(([nombre, color]) => (
            <span key={nombre} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-slate-600" style={{ backgroundColor: color }} />
              {nombre}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
