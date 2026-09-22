import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import CarteraControls from './CarteraControls';
import CarteraObjetivos from './CarteraObjetivos';
import CarteraKpiGrid from './CarteraKpiGrid';
import CarteraMatrix from './CarteraMatrix';
import CarteraCharts from './CarteraCharts';
import CarteraClientTable from './CarteraClientTable';
import {
  CONTROLES_DEFAULT,
  compareCutoff,
  computeSnapshot,
  filterRecordsByCompanies,
  groupByClient,
  minMaxDate,
  objetivoMonthlySeries,
  trailingSnapshots,
  type Controles,
} from './cartera-clientes-calc';
import type { CarteraClientesData } from '../../lib/odoo/cartera-clientes';

interface Props {
  dehydratedState?: DehydratedState;
}

function CarteraClientesInner() {
  const query = useApiQuery<CarteraClientesData>(['cartera-clientes'], '/api/cartera-clientes');
  const data = query.data;

  // Empty selection = "unset" (mirrors cutoffStr below) — falls back to every company until the user touches a checkbox.
  const [selectedCompaniesRaw, setSelectedCompanies] = useState<Set<number>>(() => new Set());
  const allCompanyIdxs = useMemo(() => new Set((data?.companies ?? []).map((_, idx) => idx)), [data]);
  const selectedCompanies = selectedCompaniesRaw.size > 0 ? selectedCompaniesRaw : allCompanyIdxs;

  const filteredRecords = useMemo(
    () => filterRecordsByCompanies(data?.records ?? [], selectedCompanies),
    [data, selectedCompanies]
  );
  const { minDate, maxDate } = useMemo(() => minMaxDate(filteredRecords), [filteredRecords]);
  const byClient = useMemo(() => groupByClient(filteredRecords), [filteredRecords]);

  // cutoffStr starts empty (real maxDate isn't known until the query lands) — every read below falls
  // back to maxDate, so an unset control transparently behaves as "today" without a render-time state sync.
  const [controlesRaw, setControles] = useState<Controles>(() => ({ ...CONTROLES_DEFAULT, cutoffStr: '' }));
  const controles: Controles = { ...controlesRaw, cutoffStr: controlesRaw.cutoffStr || maxDate };

  const compareCutoffStr = compareCutoff(controles.cutoffStr, controles.compareDays);

  const snap = useMemo(
    () => computeSnapshot(byClient, minDate, controles.cutoffStr, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode),
    [byClient, minDate, controles.cutoffStr, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode]
  );
  const snapPrev = useMemo(
    () => computeSnapshot(byClient, minDate, compareCutoffStr, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode),
    [byClient, minDate, compareCutoffStr, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode]
  );
  const trail = useMemo(() => trailingSnapshots(byClient, minDate, controles), [byClient, minDate, controles.cutoffStr, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode]);
  const objetivoSerie = useMemo(
    () => objetivoMonthlySeries(byClient, minDate, maxDate, controles),
    [byClient, minDate, maxDate, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode]
  );

  const defaults: Controles = { ...CONTROLES_DEFAULT, cutoffStr: maxDate };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {filteredRecords.length.toLocaleString('es-AR')} registros · {byClient.size.toLocaleString('es-AR')} clientes históricos
        </p>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <CarteraControls
            controles={controles}
            onChange={setControles}
            minDate={minDate}
            maxDate={maxDate}
            defaults={defaults}
            companies={data.companies}
            selectedCompanies={selectedCompanies}
            onCompaniesChange={setSelectedCompanies}
          />

          <CarteraObjetivos
            snap={snap}
            cutoffStr={controles.cutoffStr}
            trailIsc={trail}
            objetivoSerie={objetivoSerie}
            periodoActivo={controles.periodoActivo}
            montoMinimo={controles.montoMinimo}
          />

          <section>
            <h3 className="mb-3 text-sm font-medium text-slate-200">Indicadores principales</h3>
            <p className="mb-3 text-xs text-slate-500">Ventana Pareto y período activo definidos arriba. Comparación vs. {compareCutoffStr}.</p>
            <CarteraKpiGrid
              snap={snap}
              snapPrev={snapPrev}
              byClient={byClient}
              cutoffStr={controles.cutoffStr}
              compareCutoffStr={compareCutoffStr}
              periodoActivo={controles.periodoActivo}
              montoMinimo={controles.montoMinimo}
            />
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium text-slate-200">Matriz Estado × Categoría</h3>
            <p className="mb-3 text-xs text-slate-500">Cruce entre recencia/monto (Activo, Dormido, Perdido, Nuevo) e importancia Pareto (A/B/C). Define prioridades de gestión.</p>
            <CarteraMatrix snap={snap} clients={data.clients} />
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-slate-200">Composición e Índice de Salud</h3>
            <CarteraCharts snap={snap} trail={trail} records={filteredRecords} />
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium text-slate-200">Cartera de clientes</h3>
            <p className="mb-3 text-xs text-slate-500">Detalle por cliente. Click en columnas para ordenar.</p>
            <CarteraClientTable snap={snap} snapPrev={snapPrev} clients={data.clients} vendors={data.vendors} />
          </section>
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other Comercial/Gerencia tabs. */
export default function CarteraClientesApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <CarteraClientesInner />
    </QueryProvider>
  );
}
