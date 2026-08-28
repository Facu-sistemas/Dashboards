import { AISLE_AFTER, INACTIVE_RACKS, RACK_ROW_ORDER } from './warehouseLayout';

interface Props {
  onSelectRack: (rack: string) => void;
  onSelectAlmacen2: () => void;
}

function RackBlock({ rack, active, onSelectRack }: { rack: string; active: boolean; onSelectRack: (rack: string) => void }) {
  return (
    <button
      type="button"
      disabled={!active}
      onClick={() => onSelectRack(rack)}
      title={active ? `Rack ${rack}` : 'Próximamente'}
      className={`flex h-16 flex-1 items-center justify-center rounded border text-sm font-medium uppercase tracking-wide transition-colors ${
        active
          ? 'border-slate-600 bg-slate-800/60 text-slate-200 hover:border-brand-400 hover:bg-slate-800'
          : 'cursor-default border-dashed border-slate-700 text-slate-600'
      }`}
    >
      {rack}
    </button>
  );
}

/** Macro floor-plan overview — each rack/side is one block (referencia: sketch "almacen 1"). Click drills into the columns×niveles detail grid for that whole rack (both sides). */
export default function WarehouseOverview({ onSelectRack, onSelectAlmacen2 }: Props) {
  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-300">Almacén 1</span>
        <div className="relative w-[30rem] rounded border-2 border-slate-600 p-3">
          <div className="flex flex-col gap-2">
            {RACK_ROW_ORDER.map((rack) => (
              <div key={rack} className="flex flex-col gap-2">
                <div className="flex items-stretch gap-6">
                  <RackBlock rack={rack} active={!INACTIVE_RACKS.has(rack)} onSelectRack={onSelectRack} />
                  {rack === 'F' && (
                    <div className="flex h-16 w-16 flex-none items-center justify-center rounded border border-slate-700 bg-slate-900/40 text-[10px] uppercase tracking-wide text-slate-600">
                      Oficina
                    </div>
                  )}
                  <RackBlock rack={rack} active={!INACTIVE_RACKS.has(rack)} onSelectRack={onSelectRack} />
                </div>
                {AISLE_AFTER.has(rack) && <div className="h-3" aria-hidden="true" />}
              </div>
            ))}
          </div>
          <div className="absolute -bottom-[3px] left-1/2 h-[3px] w-10 -translate-x-1/2 bg-slate-950" aria-hidden="true" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-300">Almacén 2</span>
        <button
          type="button"
          onClick={onSelectAlmacen2}
          title="Almacén 2 — productos no vendibles"
          className="flex h-40 w-28 items-center justify-center rounded border-2 border-slate-600 bg-slate-800/60 text-center text-xs text-slate-400 transition-colors hover:border-brand-400 hover:bg-slate-800"
        >
          Ver stock
        </button>
      </div>
    </div>
  );
}
