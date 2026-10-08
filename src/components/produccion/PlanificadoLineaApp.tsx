import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import LineaMesasPlano from './LineaMesasPlano';
import LineaReglasTaps from './LineaReglasTaps';
import { MODO_LABEL, ORIGEN_BORDE, ORIGEN_LABEL, colorFamilia, etiquetaTap, formatCantidad, formatMin, formatOcupacion, formatUnidades, type ConfigLineaDto } from './linea-shared';
import { generarPdfLinea } from './linea-pdf';
import { MESAS } from '../../lib/linea-config';
import type { DiaSimulado, ItemLinea, MesaPlan, PlanLinea } from '../../lib/linea-calc';

interface DiaOption {
  date: string;
  label: string;
  count: number;
  sinAgendar: boolean;
}

export type PlanResponse = PlanLinea & { configDisponible: boolean; diasSimulados: DiaSimulado[]; completar: boolean };

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

const fechaCorta = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
};

/** Hasta dónde se dibuja el diagrama pasada la jornada — lo demás se resume en la tarjeta "No entra en el día". */
const MARGEN_EXCEDENTE_MIN = 90;

type Vista = 'plan' | 'mesas' | 'taps';

const nombreMesa = (codigo: string) => MESAS.find((m) => m.codigo === codigo)?.nombre ?? codigo;

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M20 11a8 8 0 0 0-14.6-4.6M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.6 4.6M20 20v-5h-5" />
    </svg>
  );
}

/** Minuto de trabajo de cada hora en punto (06:00 = 0), salteando el desayuno, para las marcas del eje. */
function marcasHora(maxMin: number, pausaEnTrabajoMin: number): { label: string; min: number }[] {
  const out: { label: string; min: number }[] = [];
  for (let h = 6; h <= 22; h++) {
    const reloj = h * 60 - 360;
    const min = reloj > pausaEnTrabajoMin ? reloj - 10 : reloj;
    if (min > maxMin) break;
    out.push({ label: `${String(h).padStart(2, '0')}:00`, min });
  }
  return out;
}

function Gantt({ plan }: { plan: PlanResponse }) {
  const { capacidadMin, pausaEnTrabajoMin, pausaDesde, pausaHasta } = plan.jornada;
  const maxFin = Math.max(0, ...plan.mesas.flatMap((m) => m.tramos.map((t) => t.finMin)));
  const maxMin = Math.min(Math.max(capacidadMin, maxFin), capacidadMin + MARGEN_EXCEDENTE_MIN);
  const pct = (min: number) => `${(Math.min(min, maxMin) / maxMin) * 100}%`;
  const marcas = marcasHora(maxMin, pausaEnTrabajoMin);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="min-w-[720px]">
        <div className="relative ml-28 h-5 text-[10px] text-slate-500">
          {marcas.map((m) => (
            <span key={m.label} className="absolute -translate-x-1/2" style={{ left: pct(m.min) }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {plan.mesas.map((mesa) => (
            <div key={mesa.codigo} className="flex items-center gap-2">
              <div className={`shrink-0 text-xs ${mesa.activa ? 'text-slate-200' : 'text-slate-500 line-through'}`} style={{ width: '6.5rem' }}>
                {mesa.nombre}
                <div className="text-[10px] text-slate-500 no-underline">{mesa.activa ? `libre ${formatMin(mesa.libreMin)}` : 'inactiva'}</div>
              </div>
              <div className="relative h-10 flex-1 rounded bg-slate-800/50">
                {maxMin > capacidadMin && (
                  <div className="absolute inset-y-0 bg-red-500/10" style={{ left: pct(capacidadMin), right: 0 }} title="Fuera de la jornada" />
                )}
                {mesa.tramos.filter((t) => t.inicioMin < maxMin).map((t, i) => (
                  <div
                    key={i}
                    className={`absolute inset-y-1 overflow-hidden rounded border px-1 text-[10px] leading-tight text-white ${colorFamilia(t.familia)} ${
                      t.excede ? 'opacity-50 ring-1 ring-red-400' : ''
                    } ${ORIGEN_BORDE[t.origen]}`}
                    style={{ left: pct(t.inicioMin), width: `calc(${pct(t.finMin)} - ${pct(t.inicioMin)})` }}
                    title={`${etiquetaTap(t.familia, t.medida)} · ${formatUnidades(t.unidades)} (${ORIGEN_LABEL[t.origen]}) — ${t.excede ? 'fuera de jornada' : `${t.desde} a ${t.hasta}`} (${formatMin(t.minutos)})`}
                  >
                    <div className="truncate font-semibold">{etiquetaTap(t.familia, t.medida)}</div>
                    <div className="truncate opacity-90">
                      {formatUnidades(t.unidades)} · {t.excede ? 'no entra' : `${t.desde}–${t.hasta}`}
                    </div>
                  </div>
                ))}
                <div className="absolute inset-y-0 w-0.5 bg-amber-400/80" style={{ left: pct(pausaEnTrabajoMin) }} title={`Desayuno ${pausaDesde}–${pausaHasta}`} />
                <div className="absolute inset-y-0 w-0.5 bg-red-400/80" style={{ left: pct(capacidadMin) }} title="Fin de jornada" />
              </div>
            </div>
          ))}
        </div>
        <div className="ml-28 mt-3 flex flex-wrap gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-0.5 bg-amber-400" /> Desayuno {pausaDesde}–{pausaHasta}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-0.5 bg-red-400" /> Fin de jornada {plan.jornada.fin} ({capacidadMin} min)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-4 rounded border border-dashed border-slate-400" /> Atrasado de días anteriores
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-4 rounded border border-dotted border-slate-400" /> Adelantado de días siguientes
          </span>
        </div>
      </div>
    </div>
  );
}

function SecuenciaMesa({ mesa }: { mesa: MesaPlan }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-sm">
        <span className="font-semibold text-slate-100">{mesa.nombre}</span>
        <span className="text-xs text-slate-500">
          ocupada {formatMin(mesa.ocupadoMin)} · libre {formatMin(mesa.libreMin)}
        </span>
      </div>
      {mesa.tramos.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-500">{mesa.activa ? 'Sin trabajo asignado.' : 'Mesa inactiva.'}</p>
      ) : (
        <ul className="divide-y divide-slate-800/60 text-xs">
          {mesa.tramos.map((t, i) => (
            <li key={i} className={`flex items-center gap-2 px-3 py-1.5 ${t.excede ? 'text-red-300' : 'text-slate-300'}`}>
              <span className="w-24 shrink-0 font-mono">{t.excede ? 'no entra' : `${t.desde}–${t.hasta}`}</span>
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm border ${colorFamilia(t.familia)}`} />
              <span className="flex-1 truncate">
                {etiquetaTap(t.familia, t.medida)} <span className="text-slate-500">· {formatUnidades(t.unidades)}</span>
                {t.origen === 'atrasado' && <span className="ml-1 text-amber-400">(atrasado)</span>}
                {t.origen === 'adelantado' && <span className="ml-1 text-sky-400">(adelantado)</span>}
              </span>
              <span className="shrink-0 text-slate-500">{formatMin(t.minutos)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TablaItems({ titulo, items, nota, tono }: { titulo: string; items: ItemLinea[]; nota?: string; tono?: 'amber' | 'slate' }) {
  if (items.length === 0) return null;
  return (
    <div className={`rounded-lg border ${tono === 'amber' ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60'}`}>
      <div className="border-b border-slate-800 px-3 py-2">
        <h4 className={`text-sm font-semibold ${tono === 'amber' ? 'text-amber-300' : 'text-slate-100'}`}>{titulo}</h4>
        {nota && <p className="mt-0.5 text-xs text-slate-500">{nota}</p>}
      </div>
      <div className="flex flex-col">
        {items.map((it) => (
          <details key={`${it.origen}|${it.familia}|${it.medida}|${it.ordenes[0]?.fecha ?? ''}`} className="border-t border-slate-800/60 first:border-t-0">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs text-slate-300">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${colorFamilia(it.familia)}`} />
              <span className="font-semibold text-slate-100">{etiquetaTap(it.familia, it.medida)}</span>
              <span className="text-slate-400">{Math.round(it.unidades)} u</span>
              {it.origen === 'atrasado' && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">ATRASADO</span>}
              {it.origen === 'adelantado' && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">ADELANTADO</span>}
              {it.modo && it.modo !== 'excluido' && <span className="text-slate-500">{MODO_LABEL[it.modo]}</span>}
              {it.mesas.length > 0 && <span className="text-slate-500">{it.mesas.map(nombreMesa).join(it.modo === 'serie' ? ' → ' : ' + ')}</span>}
              <span className="ml-auto text-slate-200">
                {formatMin(it.totalMin)}
                {it.modo === 'paralelo' && it.mesas.length > 1 && <span className="text-slate-500"> ({formatMin(it.porMesaMin)} c/u)</span>}
              </span>
            </summary>
            <table className="mb-2 ml-8 text-[11px] text-slate-400">
              <tbody>
                {it.ordenes.map((o) => (
                  <tr key={o.name}>
                    <td className="py-0.5 pr-4 font-mono">{o.name}</td>
                    <td className="py-0.5 pr-4 text-slate-300">{o.producto}</td>
                    <td className="py-0.5 pr-4 text-right">{formatCantidad(o.cantidad, o.fraccion)} u.</td>
                    <td className="py-0.5 pr-4 text-right">{formatMin(o.horas * 60 * o.fraccion)}</td>
                    <td className="py-0.5 pr-4">
                      {o.origen === 'atrasado' && <span className="text-amber-400">del {fechaCorta(o.fecha)}</span>}
                      {o.origen === 'adelantado' && <span className="text-sky-400">del {fechaCorta(o.fecha)}</span>}
                    </td>
                    <td className="py-0.5">{o.estado === 'to_close' ? <span className="text-sky-400">para cerrar</span> : o.estado === 'progress' ? 'en proceso' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
    </div>
  );
}

function VistaPlan({ dias, diasError }: { dias: DiaOption[]; diasError: boolean }) {
  const [dia, setDia] = useState('');
  const [completar, setCompletar] = useState(true);
  const planQuery = useApiQuery<PlanResponse>(['linea-plan', dia, completar], dia ? `/api/linea-plan?date=${dia}&completar=${completar ? 1 : 0}` : '', {
    enabled: dia !== '',
  });
  const plan = planQuery.data;
  const diaLabel = dias.find((d) => d.date === dia)?.label ?? dia;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Día planificado:
            <select
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="">Elegí un día...</option>
              {dias.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.label} ({d.count})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void planQuery.refetch()}
            disabled={!dia}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            <RefreshIcon /> Recalcular
          </button>
          <button
            type="button"
            onClick={() => plan && generarPdfLinea(plan, diaLabel).save(`planificado-linea-${dia}.pdf`)}
            disabled={!plan || planQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            <DownloadIcon /> Descargar PDF
          </button>
          <label className="flex items-center gap-2 text-xs text-slate-400" title="Si sobra jornada, adelanta trabajo de los días siguientes (por fecha) hasta llenar los 488 min.">
            <input type="checkbox" checked={completar} onChange={(e) => setCompletar(e.target.checked)} className="accent-brand-500" />
            Completar hasta 488 min con lo de los próximos días
          </label>
        </div>
        <LastUpdated dataUpdatedAt={planQuery.dataUpdatedAt} />
      </div>

      {diasError && <p className="text-sm text-red-400">No se pudo cargar los días de planificación desde Odoo.</p>}
      {planQuery.isError && <p className="text-sm text-red-400">No se pudo armar el plan desde Odoo.</p>}
      {!dia && (
        <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
          Elegí un día para ver cómo se reparte el trabajo en las mesas.
        </p>
      )}
      {dia && planQuery.isLoading && <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}

      {dia && plan && (
        <>
          {!plan.configDisponible && (
            <p className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              No se pudo leer la configuración guardada de mesas y taps — el plan usa todas las mesas activas y las reglas por defecto.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs text-slate-500">Jornada</div>
              <div className="text-sm font-semibold text-slate-100">
                {plan.jornada.inicio} – {plan.jornada.fin}
              </div>
              <div className="text-[11px] text-slate-500">{plan.jornada.capacidadMin} min por mesa</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs text-slate-500">Ocupación de la jornada</div>
              <div className="text-sm font-semibold text-slate-100">
                {Math.round((Math.max(0, ...plan.mesas.filter((m) => m.activa).map((m) => m.ocupadoMin)) / plan.jornada.capacidadMin) * 100)}%
                <span className="ml-1 text-[11px] font-normal text-slate-500">la más cargada</span>
              </div>
              <div className="text-[11px] text-slate-500">{formatOcupacion(plan.mesas, plan.jornada.capacidadMin)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${plan.atrasadoMin > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60'}`}>
              <div className="text-xs text-slate-500">Arrastre de días anteriores</div>
              <div className={`text-sm font-semibold ${plan.atrasadoMin > 0 ? 'text-amber-300' : 'text-slate-100'}`}>{formatMin(plan.atrasadoMin)}</div>
              <div className="text-[11px] text-slate-500">vencido + lo que no entró antes · va primero</div>
            </div>
            <div className={`rounded-lg border p-3 ${plan.adelantadoMin > 0 ? 'border-sky-500/30 bg-sky-500/5' : 'border-slate-800 bg-slate-900/60'}`}>
              <div className="text-xs text-slate-500">Adelantado de días siguientes</div>
              <div className={`text-sm font-semibold ${plan.adelantadoMin > 0 ? 'text-sky-300' : 'text-slate-100'}`}>{formatMin(plan.adelantadoMin)}</div>
              <div className="text-[11px] text-slate-500">{plan.completar ? 'para completar la jornada' : 'completar desactivado'}</div>
            </div>
            <div className={`rounded-lg border p-3 ${plan.excedenteMin > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
              <div className="text-xs text-slate-500">{plan.excedenteMin > 0 ? 'No entra en el día' : 'Entra en el día'}</div>
              <div className={`text-sm font-semibold ${plan.excedenteMin > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                {plan.excedenteMin > 0 ? `+${formatMin(plan.excedenteMin)}` : 'Sí'}
              </div>
              <div className="text-[11px] text-slate-500">{plan.excedenteMin > 0 ? 'queda para el día siguiente' : 'sobra capacidad'}</div>
            </div>
          </div>

          {plan.diasSimulados.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
              <span className="text-slate-300">Simulado desde hoy:</span>{' '}
              {plan.diasSimulados.map((d, i) => (
                <span key={d.fecha}>
                  {i > 0 && ' → '}
                  {fechaCorta(d.fecha)}
                  {d.pasaMin === 0 && d.adelantadoMin === 0 && <span className="text-emerald-400"> (entra todo)</span>}
                  {d.pasaMin > 0 && <span className="text-amber-300"> (pasan {formatMin(d.pasaMin)})</span>}
                  {d.adelantadoMin > 0 && <span className="text-sky-400"> (adelanta {formatMin(d.adelantadoMin)})</span>}
                </span>
              ))}
              {' → '}
              <span className="text-slate-200">este día</span>
            </div>
          )}

          {plan.planificados.length > 0 ? (
            <>
              <Gantt plan={plan} />
              <div className="grid gap-3 md:grid-cols-2">
                {plan.mesas.map((m) => (
                  <SecuenciaMesa key={m.codigo} mesa={m} />
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
              No hay trabajo para planificar en la línea este día.
            </p>
          )}

          <TablaItems titulo="Orden de planificación" items={plan.planificados} />
          <TablaItems
            titulo="Sin regla asignada"
            items={plan.sinRegla}
            tono="amber"
            nota='No se planificaron — asignales mesas en la pestaña "Taps".'
          />
          <TablaItems titulo="Sin mesas activas" items={plan.sinMesa} tono="amber" nota="Todas las mesas de su regla están inactivas." />
          <TablaItems titulo="No se trabajan en la línea" items={plan.excluidos} tono="slate" nota="TAP-E y otros marcados como excluidos (van por Espuma)." />
        </>
      )}
    </div>
  );
}

function PlanificadoLineaInner() {
  const [vista, setVista] = useState<Vista>('plan');
  const queryClient = useQueryClient();
  const diasQuery = useApiQuery<DiaOption[]>(['linea-dias'], '/api/linea-dias');
  const configQuery = useApiQuery<ConfigLineaDto>(['linea-config'], '/api/linea-config', { enabled: vista !== 'plan' });

  function onConfigChanged() {
    void configQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ['linea-plan'] });
  }

  const tabs: { id: Vista; label: string }[] = [
    { id: 'plan', label: 'Planificación' },
    { id: 'mesas', label: 'Mesas' },
    { id: 'taps', label: 'Taps' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex w-fit rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setVista(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${vista === t.id ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {vista === 'plan' && <VistaPlan dias={diasQuery.data ?? []} diasError={diasQuery.isError} />}

      {vista !== 'plan' && (
        <>
          {configQuery.isLoading && <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}
          {configQuery.isError && <p className="text-sm text-red-400">No se pudo cargar la configuración.</p>}
          {configQuery.data && !configQuery.data.disponible && (
            <p className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              Las tablas de configuración (linea_mesas / linea_tap_reglas) no existen todavía en Supabase — se muestran los valores por defecto y no se
              puede guardar hasta crearlas.
            </p>
          )}
          {configQuery.data && vista === 'mesas' && (
            <LineaMesasPlano mesasInactivas={configQuery.data.mesasInactivas} disponible={configQuery.data.disponible} onChanged={onConfigChanged} />
          )}
          {configQuery.data && vista === 'taps' && <LineaReglasTaps config={configQuery.data} onChanged={onConfigChanged} />}
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island, same pattern as el resto de Producción. */
export default function PlanificadoLineaApp() {
  return (
    <QueryProvider>
      <PlanificadoLineaInner />
    </QueryProvider>
  );
}
