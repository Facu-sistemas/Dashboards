import type { EmpleadoVacacionesRow } from '../../lib/odoo/rrhh-vacaciones';
import { formatAntiguedad, formatDias, formatHoras } from './format';
import { convenioDe, cumplimiento, cumplimientoColor, horasEsperadas30d, iniciales, type CONVENIO_PALETTE } from './resumen-utils';

interface Props {
  row: EmpleadoVacacionesRow;
  today: string;
  color: (typeof CONVENIO_PALETTE)[number];
  /** Mayor |saldo| entre todos los empleados — escala común para que las barras sean comparables entre tarjetas. */
  maxAbsBanco: number;
}

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

function CumplimientoRing({ row }: { row: EmpleadoVacacionesRow }) {
  const ratio = cumplimiento(row);
  if (ratio === null) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center text-[10px] text-slate-600" title="Sin jornada definida">
        s/jornada
      </div>
    );
  }
  const { stroke, text } = cumplimientoColor(ratio);
  const filled = Math.min(ratio, 1) * RING_C;
  const esperadas = horasEsperadas30d(row);
  return (
    <div
      className="relative h-14 w-14 shrink-0"
      title={`${formatHoras(row.horasCargadas30d)} cargadas de ${formatHoras(esperadas ?? 0)} esperadas (últimos 30 días)`}
    >
      <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90">
        <circle cx="28" cy="28" r={RING_R} fill="none" strokeWidth="5" className="stroke-slate-800" />
        <circle
          cx="28"
          cy="28"
          r={RING_R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${RING_C}`}
          className={stroke}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${text}`}>
        {Math.round(ratio * 100)}%
      </span>
    </div>
  );
}

/** Barra divergente centrada: a la derecha (verde) horas a favor, a la izquierda (rojo) horas en contra. */
function BancoBar({ saldo, maxAbs }: { saldo: number; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.min(Math.abs(saldo) / maxAbs, 1) * 50 : 0;
  const positivo = saldo >= 0;
  return (
    <div className="relative h-2 w-full rounded-full bg-slate-800">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600" />
      <div
        className={`absolute inset-y-0 rounded-full ${positivo ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-rose-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function EmpleadoCard({ row, today, color, maxAbsBanco }: Props) {
  const saldo = row.bancoHorasSaldo;
  const saldoColor = saldo > 0 ? 'text-emerald-400' : saldo < 0 ? 'text-rose-400' : 'text-slate-300';
  const vacColor = row.anomalia === 'negativo' ? 'text-rose-400' : row.anomalia === 'alto' ? 'text-amber-400' : 'text-slate-200';

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700">
      <header className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ${color.avatar}`}
        >
          {iniciales(row.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100" title={row.nombre}>
            {row.nombre}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.puesto ?? row.departamento ?? '—'} · {formatAntiguedad(row.fechaIngreso, today)}
          </p>
        </div>
        <CumplimientoRing row={row} />
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${color.chip}`}>{convenioDe(row)}</span>
        {row.horasSemanales ? (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{row.horasSemanales} hs/sem</span>
        ) : null}
        {row.enLicenciaActualmente && (
          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-400">de licencia</span>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Banco de horas</span>
          <span className={`text-lg font-semibold leading-none ${saldoColor}`}>
            {saldo > 0 ? '+' : ''}
            {formatHoras(saldo)}
          </span>
        </div>
        <BancoBar saldo={saldo} maxAbs={maxAbsBanco} />
      </div>

      <dl className="grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Hs 30 días</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-200">{formatDias(row.horasCargadas30d)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Hs totales</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-200">{formatDias(row.horasCargadasTotal)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Vac. saldo</dt>
          <dd className={`mt-0.5 text-sm font-medium ${vacColor}`}>{formatDias(row.vacacionesSaldo)} d</dd>
        </div>
      </dl>
    </article>
  );
}
