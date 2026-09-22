import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import ClientesActivosTable, { type ClientesActivosSortBy } from './ClientesActivosTable';
import UltimasVentasCarousel from './UltimasVentasCarousel';
import TendenciaMensualSection from './TendenciaMensualSection';
import { formatCompactCurrency, formatNumber } from '../gerencia/format';
import type { ClientesActivosPeriodo, ClientesActivosResult, UltimaVentaRow } from '../../lib/odoo/clientes-activos';

interface Props {
  initialPeriodo: ClientesActivosPeriodo;
  dehydratedState?: DehydratedState;
}

const PERIODO_OPTIONS: { value: ClientesActivosPeriodo; label: string }[] = [
  { value: '30d', label: 'Últimos 30 días' },
  { value: '3m', label: 'Últimos 3 meses' },
  { value: '6m', label: 'Últimos 6 meses' },
  { value: '9m', label: 'Últimos 9 meses' },
];

const CONDICION_DEFAULT = 1;
const CONDICION_MIN = 1;
const MONTO_MINIMO_DEFAULT = 1_000_000;
const MONTO_MINIMO_MIN = 0;

const milesFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** Solo dígitos del texto tipeado, como número — vacío/no numérico da 0. Mismo criterio que CarteraControls.tsx. */
function parseMiles(s: string): number {
  const digits = s.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

/** "YYYY-MM-DD" -> "DD/MM/AAAA", sin pasar por Date/Intl (misma razón que format.ts: evitar diferencias SSR/cliente). */
function formatFecha(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function ClientesActivosInner({ initialPeriodo }: { initialPeriodo: ClientesActivosPeriodo }) {
  const [periodo, setPeriodo] = useState<ClientesActivosPeriodo>(initialPeriodo);
  const [condicion, setCondicion] = useState(CONDICION_DEFAULT);
  const [montoMinimo, setMontoMinimo] = useState(MONTO_MINIMO_DEFAULT);
  const [todasNC, setTodasNC] = useState(false);
  const [sortBy, setSortBy] = useState<ClientesActivosSortBy>('facturado');
  // Vacío = "todas las compañías" (mismo criterio que Salud de la Cartera) — no se puede saber
  // qué compañías existen hasta que la primera respuesta trae `companies`, así que arranca vacío
  // y el fetch inicial (sin `companies` en la URL) ya le pide a Odoo "todas" por default.
  const [selectedCompanies, setSelectedCompanies] = useState<Set<number>>(() => new Set());
  const companiesParam = [...selectedCompanies].sort((a, b) => a - b).join(',');

  const query = useApiQuery<ClientesActivosResult>(
    ['clientes-activos', periodo, todasNC, companiesParam],
    `/api/clientes-activos?periodo=${periodo}&todasNC=${todasNC}&companies=${companiesParam}`
  );
  const ultimasVentasQuery = useApiQuery<UltimaVentaRow[]>(
    ['clientes-activos-ultimas-ventas', companiesParam],
    `/api/clientes-activos-ultimas-ventas?companies=${companiesParam}`
  );

  const companies = query.data?.companies ?? [];
  function toggleCompany(idx: number) {
    setSelectedCompanies((prev) => {
      const base = prev.size > 0 ? prev : new Set(companies.map((c) => c.id));
      const next = new Set(base);
      if (next.has(idx)) {
        if (next.size === 1) return prev; // nunca destildar la última — una selección vacía no es un estado válido
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }
  const isCompanySelected = (id: number) => selectedCompanies.size === 0 || selectedCompanies.has(id);

  const rows = useMemo(() => {
    const activos = (query.data?.rows ?? []).filter((r) => r.invoiceCount >= condicion && r.amount >= montoMinimo);
    const sorted = [...activos].sort((a, b) =>
      sortBy === 'facturado' ? b.amount - a.amount : b.invoiceCount - a.invoiceCount
    );
    return sorted;
  }, [query.data, condicion, montoMinimo, sortBy]);

  const top10 = rows.slice(0, 10);
  const totalActivos = rows.length;
  const totalFacturado = rows.reduce((sum, r) => sum + r.amount, 0);
  const totalConDevoluciones = rows.filter((r) => r.creditNoteCount > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-6">
          {companies.length > 0 && (
            <div className="flex flex-col gap-1 text-sm text-slate-300">
              Empresa
              <div className="flex items-center gap-3 rounded border border-slate-700 bg-slate-950 px-2 py-1.5">
                {companies.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                    <input type="checkbox" checked={isCompanySelected(c.id)} onChange={() => toggleCompany(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Período
            <select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as ClientesActivosPeriodo)}
              className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              {PERIODO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Condición (facturas mín.)
            <input
              type="number"
              min={CONDICION_MIN}
              value={condicion}
              onChange={(e) => setCondicion(Math.max(CONDICION_MIN, Number(e.target.value) || CONDICION_MIN))}
              className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Monto mínimo facturado
            <input
              type="text"
              inputMode="numeric"
              value={milesFmt.format(montoMinimo)}
              onChange={(e) => setMontoMinimo(Math.max(MONTO_MINIMO_MIN, parseMiles(e.target.value)))}
              className="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            />
          </label>

          <label
            className="flex items-center gap-2 pb-1.5 text-sm text-slate-300"
            title="Tildado: suma todas las notas de crédito, incluidas Acuerdo comercial/Descuento/Publicidad. Destildado (default): solo las que no tienen ninguna de esas categorías."
          >
            <input
              type="checkbox"
              checked={todasNC}
              onChange={(e) => setTodasNC(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-brand-500 focus:ring-brand-500"
            />
            Traer todas las NC
          </label>

          {query.data && (
            <p className="pb-1.5 text-xs text-slate-500">
              Desde <span className="text-slate-300">{formatFecha(query.data.desde)}</span> hasta{' '}
              <span className="text-slate-300">{formatFecha(query.data.hasta)}</span>
            </p>
          )}
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Clientes activos</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{formatNumber(totalActivos)}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Facturado en el período</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{formatCompactCurrency(totalFacturado)}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Con notas de crédito</p>
            <p className="mt-1 text-2xl font-semibold text-amber-400">{formatNumber(totalConDevoluciones)}</p>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Top 10</h3>
        {query.isLoading ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <ClientesActivosTable
            rows={top10}
            periodo={periodo}
            companiesParam={companiesParam}
            sortBy={sortBy}
            onSortByChange={setSortBy}
          />
        )}
      </section>

      {!ultimasVentasQuery.isLoading && <UltimasVentasCarousel ventas={ultimasVentasQuery.data ?? []} />}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-300">Tendencia mensual</h3>
          <p className="text-xs text-slate-500">Últimos 6 meses calendario — independiente del período elegido arriba.</p>
        </div>
        <TendenciaMensualSection todasNC={todasNC} companiesParam={companiesParam} />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Todos los clientes activos ({formatNumber(totalActivos)})</h3>
        {query.isLoading ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <ClientesActivosTable
            rows={rows}
            periodo={periodo}
            companiesParam={companiesParam}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            scrollable
          />
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other Comercial/Gerencia tabs. */
export default function ClientesActivosApp({ dehydratedState, initialPeriodo }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ClientesActivosInner initialPeriodo={initialPeriodo} />
    </QueryProvider>
  );
}
