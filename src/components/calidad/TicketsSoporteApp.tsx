import { useState, type ReactNode } from 'react';
import { useQueryClient, type DehydratedState } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import Tip from '@/components/shared/Tip';
import TicketsPorMotivoChart from './TicketsPorMotivoChart';
import ReparacionesFlujoChart from './ReparacionesFlujoChart';
import type { TicketsSoporteResult } from './types';

interface Props {
  /** Hoy en Argentina, "YYYY-MM-DD" — arma el default (año, mes y día actuales). */
  hoy: string;
  dehydratedState?: DehydratedState;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const QUARTERS = [1, 2, 3, 4];
const pad = (n: number) => String(n).padStart(2, '0');
const diasDelMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const fechaCorta = (iso: string) => iso.split('-').reverse().join('/');

const selectClass =
  'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

const T = {
  motivo:
    'Tickets de soporte CREADOS dentro del período, agrupados por el campo "Motivo" del ticket en Odoo (Post-Venta, Calidad, Transporte, Devolución).\n"Sin motivo" = tickets que no lo tienen cargado.\nFuente: helpdesk.ticket (x_studio_motivo).',
  flujo:
    'Órdenes de reparación (repair.order, sin canceladas).\nCreadas: las que se abrieron ese día.\nCerradas: las que pasaron a "Reparado" ese día. Odoo no guarda la fecha de cierre de la orden, así que se toma la fecha del movimiento de stock con que se terminó.\nSi elegís un solo día se muestra el mes entero y se resalta el día.',
  gasto:
    'Costo de las reparaciones CREADAS en el período:\nHoras × valor hora + valor de la tela/piezas agregadas.\nHoras: campo "Horas de reparación" de la orden.\nValor hora: precio de venta del producto SERVICIO DE REPARACION en Odoo (el mismo que usa Calidad CNC).\nTela y piezas: costo del producto (costo estándar) × cantidad de cada pieza "Agregar" de la orden.',
  horas: 'Suma de "Horas de reparación" de las órdenes del período.',
  horasMonto: 'Horas × valor hora (precio de SERVICIO DE REPARACION en Odoo).',
  materiales: 'Costo estándar de cada producto agregado a la orden (tela, piezas) × cantidad usada. No incluye el servicio de horas.',
  total: 'Horas $ + Tela y piezas $.',
  tickets:
    'Tickets creados en el período, con la descripción que se cargó en Odoo. Hacé clic en una fila para leerla completa.',
  creadas: 'Órdenes de reparación creadas dentro del período elegido.',
  cerradas: 'Órdenes de reparación terminadas ("Reparado") dentro del período elegido.',
  ticketsTotal: 'Tickets de soporte creados dentro del período elegido.',
};

function Titulo({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <h3 className="text-sm font-medium text-slate-300">
      <Tip text={tip} className="cursor-help border-b border-dotted border-slate-500">
        {children}
      </Tip>
    </h3>
  );
}

function Kpi({ label, value, tip, sub }: { label: string; value: string; tip: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <Tip text={tip} className="cursor-help text-xs uppercase tracking-wide text-slate-400">
        <span className="border-b border-dotted border-slate-500">{label}</span>
      </Tip>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Cargando({ h }: { h: number }) {
  return <div className="w-full animate-pulse-slow rounded-lg bg-slate-800/60" style={{ height: h }} />;
}

function SyncButton() {
  const queryClient = useQueryClient();
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sincronizar() {
    setSincronizando(true);
    setError(null);
    try {
      // Descarta el cache de lecturas de Odoo del server y vuelve a pedir los datos del tab.
      const res = await fetch('/api/gerencia-sync?refresh=1', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('No se pudo sincronizar con Odoo.');
      await queryClient.invalidateQueries({ queryKey: ['tickets-soporte'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar con Odoo.');
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="button"
        onClick={sincronizar}
        disabled={sincronizando}
        className="whitespace-nowrap rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-500 hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sincronizando ? 'Sincronizando…' : 'Forzar sincronización'}
      </button>
    </div>
  );
}

function TicketsSoporteInner({ hoy }: { hoy: string }) {
  const [hy, hm, hd] = hoy.split('-').map(Number) as [number, number, number];
  const [year, setYear] = useState(hy);
  const [month, setMonth] = useState(hm); // 0 = todo el año
  const [day, setDay] = useState(hd); // 0 = todo el mes
  const [quarter, setQuarter] = useState(0); // 0 = sin trimestre
  const [custDesde, setCustDesde] = useState('');
  const [custHasta, setCustHasta] = useState('');
  const [abierto, setAbierto] = useState<number | null>(null);

  // Prioridad: desde/hasta manual > trimestre > año/mes/día.
  let desde: string;
  let hasta: string;
  let titulo: string;
  if (custDesde && custHasta) {
    [desde, hasta] = custDesde <= custHasta ? [custDesde, custHasta] : [custHasta, custDesde];
    titulo = `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`;
  } else if (quarter) {
    desde = `${year}-${pad((quarter - 1) * 3 + 1)}-01`;
    const mFin = quarter * 3;
    hasta = `${year}-${pad(mFin)}-${pad(diasDelMes(year, mFin))}`;
    titulo = `Q${quarter} ${year}`;
  } else if (month === 0) {
    desde = `${year}-01-01`;
    hasta = `${year}-12-31`;
    titulo = `año ${year}`;
  } else if (day === 0) {
    desde = `${year}-${pad(month)}-01`;
    hasta = `${year}-${pad(month)}-${pad(diasDelMes(year, month))}`;
    titulo = `${MESES[month - 1]!.toLowerCase()} ${year}`;
  } else {
    desde = hasta = `${year}-${pad(month)}-${pad(day)}`;
    titulo = fechaCorta(desde);
  }

  const query = useApiQuery<TicketsSoporteResult>(['tickets-soporte', desde, hasta], `/api/tickets-soporte?${new URLSearchParams({ desde, hasta })}`);
  const data = query.data;
  const cargando = query.isLoading;

  const limpiarAtajos = () => {
    setQuarter(0);
    setCustDesde('');
    setCustHasta('');
  };
  const maxDia = month === 0 ? 31 : diasDelMes(year, month);
  const years = [hy - 2, hy - 1, hy, hy + 1, hy + 2];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4 text-sm text-slate-300">
          <label className="flex flex-col gap-1">
            Año
            <select
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                limpiarAtajos();
                setDay((d) => Math.min(d, 28));
              }}
              className={selectClass}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Mes
            <select
              value={month}
              onChange={(e) => {
                const m = Number(e.target.value);
                setMonth(m);
                if (m === 0) setDay(0);
                else setDay((d) => Math.min(d, diasDelMes(year, m)));
                limpiarAtajos();
              }}
              className={selectClass}
            >
              <option value={0}>Todo el año</option>
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Día
            <select
              value={day}
              disabled={month === 0}
              onChange={(e) => {
                setDay(Number(e.target.value));
                limpiarAtajos();
              }}
              className={`${selectClass} disabled:opacity-50`}
            >
              <option value={0}>Todo el mes</option>
              {Array.from({ length: maxDia }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Trimestre
            <select
              value={quarter}
              onChange={(e) => {
                setQuarter(Number(e.target.value));
                setCustDesde('');
                setCustHasta('');
              }}
              className={selectClass}
            >
              <option value={0}>—</option>
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" value={custDesde} onChange={(e) => setCustDesde(e.target.value)} className={selectClass} />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" value={custHasta} onChange={(e) => setCustHasta(e.target.value)} className={selectClass} />
          </label>
          {(custDesde || custHasta) && (
            <button type="button" onClick={() => { setCustDesde(''); setCustHasta(''); }} className="pb-1.5 text-xs text-slate-400 underline hover:text-brand-400">
              Borrar fechas
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <SyncButton />
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
      </div>

      <p className="-mt-3 text-sm text-slate-400">
        Mostrando <span className="font-medium text-slate-200">{titulo}</span>
        {custDesde && !custHasta && ' — completá "Hasta" para usar el rango manual.'}
      </p>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Tickets creados" value={data ? String(data.total) : '—'} tip={T.ticketsTotal} />
        <Kpi label="Reparaciones creadas" value={data ? String(data.reparacionesCreadas) : '—'} tip={T.creadas} />
        <Kpi label="Reparaciones cerradas" value={data ? String(data.reparacionesCerradas) : '—'} tip={T.cerradas} />
        <Kpi
          label="Gasto en reparar"
          value={data ? money.format(data.gasto.total) : '—'}
          tip={T.gasto}
          sub={data ? `${num.format(data.gasto.horas)} h + tela y piezas` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <Titulo tip={T.motivo}>Tickets por Motivo</Titulo>
          {cargando ? <Cargando h={240} /> : <TicketsPorMotivoChart rows={data?.porMotivo ?? []} />}
        </section>

        <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <Titulo tip={T.flujo}>
            Reparaciones: creadas vs. cerradas {data?.granularidad === 'mes' ? '(por mes)' : '(por día)'}
          </Titulo>
          {cargando || !data ? (
            <Cargando h={300} />
          ) : (
            <>
              <ReparacionesFlujoChart points={data.flujo} granularidad={data.granularidad} desde={data.desde} hasta={data.hasta} />
              {data.desde === data.hasta && (
                <p className="text-xs text-slate-500">
                  Día elegido: {fechaCorta(data.desde)} — {data.reparacionesCreadas} creadas y {data.reparacionesCerradas} cerradas. Se muestra el mes entero para dar contexto.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <Titulo tip={T.gasto}>Cuánto se gastó reparando</Titulo>
        {cargando || !data ? (
          <Cargando h={200} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi label="Horas" value={num.format(data.gasto.horas)} tip={T.horas} sub={`${data.gasto.cantidad} reparaciones`} />
              <Kpi label="Horas $" value={money.format(data.gasto.horasMonto)} tip={T.horasMonto} sub={`a ${money.format(data.gasto.valorHora)} la hora`} />
              <Kpi label="Tela y piezas $" value={money.format(data.gasto.materiales)} tip={T.materiales} />
              <Kpi label="Total" value={money.format(data.gasto.total)} tip={T.total} />
            </div>
            {data.gasto.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Sin reparaciones creadas en este período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Reparación</th>
                      <th className="px-3 py-2">Ticket</th>
                      <th className="px-3 py-2">Creada</th>
                      <th className="px-3 py-2">Cerrada</th>
                      <th className="px-3 py-2 text-right">Horas</th>
                      <th className="px-3 py-2 text-right">Horas $</th>
                      <th className="px-3 py-2">Tela / piezas</th>
                      <th className="px-3 py-2 text-right">Tela y piezas $</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {data.gasto.items.map((i) => (
                      <tr key={i.ref}>
                        <td className="px-3 py-1.5 font-medium text-slate-200">{i.ref}</td>
                        <td className="max-w-[16rem] truncate px-3 py-1.5" title={i.ticket ?? ''}>{i.ticket ?? '—'}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fechaCorta(i.creada)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{i.cerrada ? fechaCorta(i.cerrada) : 'En curso'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{num.format(i.horas)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money.format(i.horasMonto)}</td>
                        <td className="max-w-[16rem] truncate px-3 py-1.5 text-slate-400" title={i.materialesDetalle}>{i.materialesDetalle || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money.format(i.materiales)}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-100">{money.format(i.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <Titulo tip={T.tickets}>Tickets del período</Titulo>
        {cargando || !data ? (
          <Cargando h={160} />
        ) : data.tickets.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Sin tickets creados en este período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Creado</th>
                  <th className="px-3 py-2">Ticket</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Motivo</th>
                  <th className="px-3 py-2">Etapa</th>
                  <th className="px-3 py-2">Descripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {data.tickets.map((t) => {
                  const open = abierto === t.id;
                  return (
                    <tr key={t.id} className="cursor-pointer align-top hover:bg-slate-800/40" onClick={() => setAbierto(open ? null : t.id)}>
                      <td className="px-3 py-1.5 tabular-nums">{fechaCorta(t.creado)}</td>
                      <td className="max-w-[18rem] px-3 py-1.5 font-medium text-slate-200">{t.ref}</td>
                      <td className="px-3 py-1.5">{t.cliente}</td>
                      <td className="px-3 py-1.5">{t.motivo}</td>
                      <td className="px-3 py-1.5">{t.etapa}</td>
                      <td className={`max-w-[28rem] px-3 py-1.5 text-slate-400 ${open ? 'whitespace-pre-line' : 'truncate'}`}>{t.descripcion || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function TicketsSoporteApp({ dehydratedState, hoy }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <TicketsSoporteInner hoy={hoy} />
    </QueryProvider>
  );
}
