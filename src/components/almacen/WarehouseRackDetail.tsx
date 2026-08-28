import { Fragment, useMemo } from 'react';
import { DESK_CELL, RACK_SIDE_SPLIT } from './warehouseLayout';
import type { RackSide, WarehouseLayout } from './types';

interface Props {
  layout: WarehouseLayout;
  rack: string;
  selectedCode: string | null;
  onSelectCell: (codigo: string) => void;
  onBack: () => void;
}

interface SideGrid {
  columnNumbers: number[];
  levelsTopToBottom: string[];
  columns: { column: number; levels: string[] }[];
  showDesk: boolean;
}

function cellCodigo(rack: string, column: number, level: string): string {
  return `${rack}.${column}.${level}`;
}

function buildSideGrid(layout: WarehouseLayout, rack: string, side: RackSide): SideGrid {
  const data = layout.racks.find((r) => r.rack === rack);
  const split = RACK_SIDE_SPLIT[rack] ?? Infinity;
  const cols = (data?.columns ?? []).filter((c) => (side === 'izquierdo' ? c.column <= split : c.column > split));
  const showDesk = rack === DESK_CELL.rack && side === 'derecho';

  const columnNumbers = [...new Set([...cols.map((c) => c.column), ...(showDesk ? [DESK_CELL.column] : [])])].sort((a, b) => a - b);

  const levelSet = new Set<string>();
  cols.forEach((c) => c.levels.forEach((l) => levelSet.add(l)));
  if (showDesk) levelSet.add(DESK_CELL.level);
  // Highest letter on top — como si el usuario estuviera parado mirando el rack de frente.
  const levelsTopToBottom = [...levelSet].sort().reverse();

  return { columnNumbers, levelsTopToBottom, columns: cols, showDesk };
}

function RackSideGrid({
  rack,
  side,
  grid,
  occupied,
  selectedCode,
  onSelectCell,
}: {
  rack: string;
  side: RackSide;
  grid: SideGrid;
  occupied: Set<string>;
  selectedCode: string | null;
  onSelectCell: (codigo: string) => void;
}) {
  const { columnNumbers, levelsTopToBottom, columns, showDesk } = grid;

  if (columnNumbers.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{side}</span>
        <p className="text-sm text-slate-500">Sin ubicaciones cargadas para este lado.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{side}</span>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-1"
          style={{
            gridTemplateColumns: `2.5rem repeat(${columnNumbers.length}, 3rem)`,
            gridTemplateRows: `1.5rem repeat(${levelsTopToBottom.length}, 2.5rem)`,
          }}
        >
          <div />
          {columnNumbers.map((column) => (
            <div key={column} className="flex items-center justify-center text-xs text-slate-500">
              {column}
            </div>
          ))}
          {levelsTopToBottom.map((level) => (
            <Fragment key={level}>
              <div className="flex items-center justify-center text-xs text-slate-500">{level}</div>
              {columnNumbers.map((column) => {
                const isDeskCell = showDesk && column === DESK_CELL.column && level === DESK_CELL.level;
                if (isDeskCell) {
                  const isSelected = DESK_CELL.codigo === selectedCode;
                  return (
                    <button
                      key={column}
                      type="button"
                      title={DESK_CELL.label}
                      onClick={() => onSelectCell(DESK_CELL.codigo)}
                      className={`rounded transition-colors ${
                        isSelected ? 'bg-red-500/80 ring-1 ring-inset ring-red-300' : 'bg-red-500/60 hover:bg-red-500/80'
                      }`}
                    />
                  );
                }

                const hasLevel = columns.find((c) => c.column === column)?.levels.includes(level);
                if (!hasLevel) {
                  // No real stock.location here — still render the slot so the
                  // rack's rectangle reads as complete, just visibly inert.
                  return <div key={column} className="rounded border border-dashed border-slate-800 bg-slate-900/40" />;
                }

                const codigo = cellCodigo(rack, column, level);
                const isSelected = codigo === selectedCode;
                const isOccupied = occupied.has(codigo);
                return (
                  <button
                    key={column}
                    type="button"
                    title={codigo}
                    onClick={() => onSelectCell(codigo)}
                    className={`rounded transition-colors ${
                      isSelected
                        ? 'bg-brand-500/60 ring-1 ring-inset ring-brand-400'
                        : isOccupied
                          ? 'bg-status-green/40 hover:bg-status-green/60'
                          : 'border border-slate-700 bg-slate-900/60 hover:bg-slate-800'
                    }`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Front-view detail for a whole rack — both sides shown together, separated by the aisle gap (referencia: sketch "Clean2"), columns numbered on top, levels lettered on the left. */
export default function WarehouseRackDetail({ layout, rack, selectedCode, onSelectCell, onBack }: Props) {
  const occupied = useMemo(() => new Set(layout.occupiedCodes), [layout]);
  const izquierdo = useMemo(() => buildSideGrid(layout, rack, 'izquierdo'), [layout, rack]);
  const derecho = useMemo(() => buildSideGrid(layout, rack, 'derecho'), [layout, rack]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800"
        >
          ← Volver
        </button>
        <h3 className="text-sm font-medium text-slate-200">Rack {rack}</h3>
      </div>

      <div className="flex flex-wrap items-start gap-10">
        <RackSideGrid rack={rack} side="izquierdo" grid={izquierdo} occupied={occupied} selectedCode={selectedCode} onSelectCell={onSelectCell} />
        <RackSideGrid rack={rack} side="derecho" grid={derecho} occupied={occupied} selectedCode={selectedCode} onSelectCell={onSelectCell} />
      </div>
    </div>
  );
}
