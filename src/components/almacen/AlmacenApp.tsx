import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import WarehouseOverview from './WarehouseOverview';
import WarehouseRackDetail from './WarehouseRackDetail';
import UbicacionDetail from './UbicacionDetail';
import MovimientosCarousel from './MovimientosCarousel';
import { ALMACEN_2_CODIGO, DESK_CELL } from './warehouseLayout';
import type { MovimientoRow, UbicacionStockResult, WarehouseLayout } from './types';

interface Props {
  dehydratedState?: DehydratedState;
}

function AlmacenInner() {
  const [selectedRack, setSelectedRack] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const layoutQuery = useApiQuery<WarehouseLayout>(['almacen-layout'], '/api/almacen-layout');
  const movimientosQuery = useApiQuery<MovimientoRow[]>(['almacen-movimientos'], '/api/almacen-movimientos');

  const ubicacionQuery = useApiQuery<UbicacionStockResult>(
    ['almacen-ubicacion', selectedCode],
    selectedCode ? `/api/almacen/ubicacion/${encodeURIComponent(selectedCode)}` : '',
    { enabled: selectedCode !== null && selectedCode !== DESK_CELL.codigo }
  );

  function handleSelectRack(rack: string) {
    setSelectedRack(rack);
    setSelectedCode(null);
  }

  function handleSelectAlmacen2() {
    setSelectedRack(null);
    setSelectedCode(ALMACEN_2_CODIGO);
  }

  function handleBack() {
    setSelectedRack(null);
    setSelectedCode(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <LastUpdated dataUpdatedAt={layoutQuery.dataUpdatedAt} />
      </div>

      {layoutQuery.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudo cargar el layout del depósito: {(layoutQuery.error as Error).message}
        </p>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        {layoutQuery.isLoading ? (
          <div className="h-[480px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : selectedRack ? (
          <WarehouseRackDetail
            layout={layoutQuery.data ?? { racks: [], occupiedCodes: [] }}
            rack={selectedRack}
            selectedCode={selectedCode}
            onSelectCell={setSelectedCode}
            onBack={handleBack}
          />
        ) : (
          <WarehouseOverview onSelectRack={handleSelectRack} onSelectAlmacen2={handleSelectAlmacen2} />
        )}
      </section>

      {selectedCode && <UbicacionDetail selectedCode={selectedCode} query={ubicacionQuery} />}

      <MovimientosCarousel query={movimientosQuery} />
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function AlmacenApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <AlmacenInner />
    </QueryProvider>
  );
}
