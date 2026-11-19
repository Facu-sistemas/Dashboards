import type { EmpleadoVacacionesRow } from '@/lib/odoo/rrhh-vacaciones';
import { formatAntiguedad, formatDias, formatHoras } from './format';
import { convenioDe, cumplimiento, cumplimientoColor, horasEsperadasMes, iniciales, type CONVENIO_PALETTE } from './resumen-utils';

interface Props {
  row: EmpleadoVacacionesRow;
  today: string;
  color: (typeof CONVENIO_PALETTE)[number];
  /** Mayor |saldo| entre todos los empleados — escala común para que las barras sean comparables entre tarjetas. */
  maxAbsBanco: number;
  /** Días hábiles (lun–vie sin feriados) del 1 del mes a hoy, ambos inclusive. */
  diasHabilesMes?: number;
}

/** Detalle del cumplimiento para el hover: horas cargadas vs esperadas y de dónde sale la cuenta (días hábiles × horas por día). */
function detalleMes(row: EmpleadoVacacionesRow, diasHabiles: number | undefined): string {
  const esperadas = horasEsperadasMes(row);
  const base = `${formatHoras(row.horasCargadasMes)} fichadas de ${formatHoras(esperadas ?? 0)} esperadas en lo que va del mes`;
  if (!diasHabiles || !row.horasSemanales) return `${base} (días hábiles, sin feriados)`;
  const porDia = row.horasSemanales / 5;
  const diasEquiv = porDia > 0 ? row.horasCargadasMes / porDia : 0;
  const completo = row.horasEsperadasMesCompleto;
  const resumen = completo
    ? `Anillo: ${formatHoras(row.horasCargadasMes)} de ${formatHoras(completo)} del mes completo (${Math.round((row.horasCargadasMes / completo) * 100)}%). Color: ${Math.round((row.horasCargadasMes / (esperadas || 1)) * 100)}% de lo que correspondía hasta ayer.\n`
    : '';
  return `${resumen}${base}.\nVan ${diasHabiles} días hábiles del mes (sin feriados, hasta ayer) × ${formatHoras(porDia)} por día (${row.horasSemanales} hs/sem ÷ 5) = ${formatHoras(esperadas ?? 0)}.\nLas horas fichadas equivalen a ${formatDias(Math.round(diasEquiv * 10) / 10)} días de jornada.`;
}

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

function CumplimientoRing({ row, diasHabiles }: { row: EmpleadoVacacionesRow; diasHabiles?: number }) {
  // Reporte perfecto: sus horas no se controlan (a fin de mes siempre cierran bien), así que no hay anillo de cumplimiento.
  if (row.estadoResumen === 'reporte_perfecto') {
    return (
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-emerald-500/60 text-xl text-emerald-400"
        title="Reporte perfecto: las horas no se controlan"
      >
        ✓
      </div>
    );
  }
  const ratio = cumplimiento(row);
  if (ratio === null) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center text-[10px] text-slate-600" title="Sin jornada definida">
        s/jornada
      </div>
    );
  }
  // El color dice si va al día (horas fichadas vs. las que correspondían hasta ayer); el anillo y el % muestran el avance sobre el mes completo.
  const { stroke, text } = cumplimientoColor(ratio);
  const completo = row.horasEsperadasMesCompleto;
  const avance = completo ? row.horasCargadasMes / completo : ratio;
  const filled = Math.min(avance, 1) * RING_C;
  return (
    <div className="relative h-14 w-14 shrink-0" title={detalleMes(row, diasHabiles)}>
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
        {Math.round(avance * 100)}%
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

/**
 * Estado de fichaje sobre el avatar: verde titilando = fichado, rojo = no fichado,
 * gris punteado = sin datos biométricos cargados (no puede fichar con la cara).
 */
function EstadoFichaje({ row }: { row: EmpleadoVacacionesRow }) {
  if (!row.tieneBiometricos) {
    return (
      <span
        title="Sin datos biométricos cargados"
        className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-dashed border-slate-500 bg-slate-900 ring-2 ring-slate-900"
      />
    );
  }
  if (row.fichado) {
    return (
      <span title="Fichado" className="absolute -right-1 -top-1 flex h-3.5 w-3.5 ring-2 ring-slate-900 rounded-full">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-full w-full rounded-full bg-emerald-500" />
      </span>
    );
  }
  return (
    <span title="No fichado" className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-rose-500 ring-2 ring-slate-900" />
  );
}

export default function EmpleadoCard({ row, today, color, maxAbsBanco, diasHabilesMes }: Props) {
  const perfecto = row.estadoResumen === 'reporte_perfecto';
  const saldo = row.bancoHorasSaldo;
  const saldoColor = saldo > 0 ? 'text-emerald-400' : saldo < 0 ? 'text-rose-400' : 'text-slate-300';
  const vacColor = row.anomalia === 'negativo' ? 'text-rose-400' : row.anomalia === 'alto' ? 'text-amber-400' : 'text-slate-200';

  return (
    // Toda la tarjeta lleva al calendario de fichadas de esa persona (Horas > Historial de fichadas).
    <a
      href={`/rrhh/horas?historial=${row.id}`}
      aria-label={`Ver el calendario de fichadas de ${row.nombre}`}
      className="flex h-full min-w-0 cursor-pointer flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-brand-500/60"
    >
      <header className="flex items-center gap-3">
        <div
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ${color.avatar}`}
        >
          {iniciales(row.nombre)}
          <EstadoFichaje row={row} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100" title={row.nombre}>
            {row.nombre}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.puesto ?? row.departamento ?? '—'} · {formatAntiguedad(row.fechaIngreso, today)}
          </p>
        </div>
        <CumplimientoRing row={row} diasHabiles={diasHabilesMes} />
      </header>

      <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
        <span title={convenioDe(row)} className={`min-w-0 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${color.chip}`}>{convenioDe(row)}</span>
        {row.horasSemanales ? (
          <span title="Horas semanales de su calendario laboral en Odoo." className="shrink-0 whitespace-nowrap rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{row.horasSemanales} hs/sem</span>
        ) : null}
        {row.enLicenciaActualmente && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-400">de licencia</span>
        )}
        {perfecto && <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Reporte perfecto</span>}
      </div>

      {perfecto ? (
        <p className="rounded-lg bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
          Las horas no se controlan: solo importa si está fichado.
        </p>
      ) : (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between" title="Saldo del banco de horas del empleado en Odoo. Positivo: a favor del empleado.">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Banco de horas</span>
            <span className={`text-lg font-semibold leading-none ${saldoColor}`}>
              {saldo > 0 ? '+' : ''}
              {formatHoras(saldo)}
            </span>
          </div>
          <BancoBar saldo={saldo} maxAbs={maxAbsBanco} />
        </div>
      )}

      <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
        <div title={`Horas fichadas en el kiosco (Odoo) del día 1 del mes a ayer; las licencias no se descuentan de lo esperado.${perfecto ? '' : `\n${detalleMes(row, diasHabilesMes)}`}`}>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Hs del mes</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-200">{perfecto ? '—' : formatDias(row.horasCargadasMes)}</dd>
        </div>
        <div title="Horas fichadas en el kiosco (Odoo) desde siempre, hasta ayer.">
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Hs totales</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-200">{perfecto ? '—' : formatDias(row.horasCargadasTotal)}</dd>
        </div>
        <div title="Días de vacaciones vigentes (las vencidas no cuentan) menos los tomados y los ya pedidos (Odoo).">
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Vac. saldo</dt>
          <dd className={`mt-0.5 text-sm font-medium ${vacColor}`}>{formatDias(row.vacacionesSaldo)} d</dd>
        </div>
      </dl>
    </a>
  );
}
