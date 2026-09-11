import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import {
  parseRows,
  calcCorte,
  calcMatel,
  optimizarCorte,
  calcEnvivado,
  fmtTiempo,
  stockKey,
  SEG_ROLLO_CHICO,
  MIN_ROLLO_GRANDE,
  type StockMap,
} from '../../lib/bandas-calc';
import BandasStockPanel, { type StockRowInput } from './BandasStockPanel';
import BandasOptimizacion from './BandasOptimizacion';
import { telaBadgeClasses } from './bandas-ui';
import { imprimirCorte, imprimirEnvivado, imprimirMatelaseadora, imprimirOptimizacion } from './bandas-print';

interface Props {
  dehydratedState?: DehydratedState;
}

interface BandaDiaOption {
  date: string;
  label: string;
  count: number;
  sinAgendar: boolean;
}

interface BandaPlanRow {
  fecha: string;
  producto: string;
  cantidad: number;
}

type TabId = 'corte' | 'matelaseadora' | 'optimizacion' | 'envivado' | 'detalle';

const TABS: { id: TabId; label: string }[] = [
  { id: 'corte', label: 'Corte de bandas' },
  { id: 'matelaseadora', label: 'Matelaseadora' },
  { id: 'optimizacion', label: 'Optimización de corte' },
  { id: 'envivado', label: 'Envivado' },
  { id: 'detalle', label: 'Detalle planificación' },
];

const STOCK_STORAGE_KEY = 'bandas-stock-rows-v1';

function loadStockRows(): StockRowInput[] {
  try {
    const raw = window.localStorage.getItem(STOCK_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StockRowInput[]) : [];
  } catch {
    return [];
  }
}

function newRowId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function StatCard({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${danger && value > 0 ? 'text-red-400' : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function TiempoBox({ titulo, valor, calculo, variant }: { titulo: string; valor: string; calculo: string; variant?: 'green' | 'blue' }) {
  const isBlue = variant === 'blue';
  return (
    <div className={`rounded-lg border p-5 ${isBlue ? 'border-blue-500/30 bg-blue-500/5' : 'border-brand-600/30 bg-brand-500/5'}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${isBlue ? 'text-blue-400' : 'text-brand-400'}`}>{titulo}</div>
      <div className={`text-3xl font-bold ${isBlue ? 'text-blue-400' : 'text-brand-400'}`}>{valor}</div>
      <div className={`mt-1 text-xs opacity-80 ${isBlue ? 'text-blue-400' : 'text-brand-400'}`}>{calculo}</div>
    </div>
  );
}

function PrintButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
    >
      🖨️ {label}
    </button>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full min-w-[480px] border-collapse text-sm">{children}</table>
    </div>
  );
}

function Th({ children, num }: { children: ReactNode; num?: boolean }) {
  return <th className={`bg-slate-900 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 ${num ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function Td({ children, num, className }: { children: ReactNode; num?: boolean; className?: string }) {
  return <td className={`px-3 py-2 text-slate-200 ${num ? 'text-right' : 'text-left'} ${className ?? ''}`}>{children}</td>;
}

function FechaTag({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-xs text-slate-400">{children}</span>;
}

function BandasInner() {
  const [activeTab, setActiveTab] = useState<TabId>('corte');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [stockRows, setStockRows] = useState<StockRowInput[]>([]);

  useEffect(() => {
    setStockRows(loadStockRows());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockRows));
    } catch {
      // localStorage unavailable (private mode, quota) — stock just won't persist across reloads.
    }
  }, [stockRows]);

  const diasQuery = useApiQuery<BandaDiaOption[]>(['bandas-dias'], '/api/bandas-dias');
  const dias = diasQuery.data ?? [];

  const effectiveDate = selectedDate ?? dias.find((d) => !d.sinAgendar)?.date ?? dias[0]?.date ?? null;

  const planQuery = useApiQuery<BandaPlanRow[]>(
    ['bandas-planificacion', effectiveDate],
    effectiveDate ? `/api/bandas-planificacion?date=${effectiveDate}` : '',
    { enabled: effectiveDate !== null },
  );

  const { rows, warns } = useMemo(() => parseRows(planQuery.data ?? []), [planQuery.data]);

  const stockMap: StockMap = useMemo(() => {
    const map: StockMap = {};
    for (const r of stockRows) {
      const alto = parseInt(r.alto, 10);
      const cantidad = parseInt(r.cantidad, 10) || 1;
      if (r.tela && alto > 0) {
        const k = stockKey(r.tela, alto);
        map[k] = (map[k] ?? 0) + cantidad;
      }
    }
    return map;
  }, [stockRows]);

  const corte = useMemo(() => calcCorte(rows, stockMap), [rows, stockMap]);
  const matel = useMemo(() => calcMatel(corte), [corte]);
  const optData = useMemo(() => optimizarCorte(corte), [corte]);
  const { envRows, totalSeg: totalSegEnv } = useMemo(() => calcEnvivado(rows), [rows]);

  const totalCorte = corte.reduce((s, r) => s + r.rollos, 0);
  const totalGrandes = matel.reduce((s, r) => s + r.rollosGrandes, 0);
  const sinMedida = rows.filter((r) => !r.largo).length;

  const porTela = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of corte) {
      const t = r.tela || 'Sin tela';
      map.set(t, (map.get(t) ?? 0) + r.rollos);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [corte]);

  const corteOrdenado = useMemo(
    () => [...corte].sort((a, b) => (a.tela || '').localeCompare(b.tela || '') || (a.alto || 0) - (b.alto || 0)),
    [corte],
  );

  const segCorte = totalCorte * SEG_ROLLO_CHICO;
  const segMatel = totalGrandes * MIN_ROLLO_GRANDE * 60;

  function addStockRow(tela = '', alto?: number, cantidad?: number) {
    setStockRows((prev) => [...prev, { id: newRowId(), tela, alto: alto ? String(alto) : '', cantidad: String(cantidad ?? 1) }]);
  }
  function updateStockRow(id: string, patch: Partial<Omit<StockRowInput, 'id'>>) {
    setStockRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeStockRow(id: string) {
    setStockRows((prev) => prev.filter((r) => r.id !== id));
  }
  function importStock(parsed: { tela: string; alto: number; cantidad: number }[]) {
    setStockRows(parsed.map((p) => ({ id: newRowId(), tela: p.tela, alto: String(p.alto), cantidad: String(p.cantidad) })));
  }
  function clearStock() {
    setStockRows([]);
  }
  function agregarSobrantesAlStock(tiras: { tela: string; alto: number; cantidad: number }[]) {
    setStockRows((prev) => [...prev, ...tiras.map((t) => ({ id: newRowId(), tela: t.tela, alto: String(t.alto), cantidad: String(t.cantidad) }))]);
  }

  const isLoading = diasQuery.isLoading || (effectiveDate !== null && planQuery.isLoading);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-400" htmlFor="bandas-dia-select">
            Día de planificación:
          </label>
          <select
            id="bandas-dia-select"
            value={effectiveDate ?? ''}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {dias.map((d) => (
              <option key={d.date} value={d.date}>
                {d.label} ({d.count})
              </option>
            ))}
          </select>
        </div>
        <LastUpdated dataUpdatedAt={planQuery.dataUpdatedAt} />
      </div>

      {diasQuery.isError && <p className="text-sm text-red-400">No se pudo cargar la lista de días desde Odoo.</p>}
      {planQuery.isError && <p className="text-sm text-red-400">No se pudo cargar la planificación de ese día.</p>}

      {!diasQuery.isLoading && !diasQuery.isError && dias.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
          No hay órdenes de bandas pendientes en Odoo ahora mismo.
        </p>
      )}

      {isLoading && <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}

      {!isLoading && effectiveDate && (
        <>
          {warns.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
              <strong>{warns.length} producto(s) sin largo definido:</strong>
              <ul className="ml-4 mt-1 list-disc text-xs">
                {warns.slice(0, 5).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {warns.length > 5 && <li>...y {warns.length - 5} más</li>}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Líneas cargadas" value={rows.length} />
            <StatCard label="Rollos corte" value={totalCorte} />
            <StatCard label="Rollos grandes" value={totalGrandes} />
            <StatCard label="Sin medida" value={sinMedida} danger />
          </div>

          <BandasStockPanel
            rows={stockRows}
            onAddRow={addStockRow}
            onUpdateRow={updateStockRow}
            onRemoveRow={removeStockRow}
            onImport={importStock}
            onClear={clearStock}
          />

          <div className="flex flex-wrap gap-1 border-b border-slate-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                  activeTab === t.id ? 'border-brand-500 font-semibold text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'corte' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {porTela.map(([tela, v]) => (
                  <div key={tela} className="rounded-lg border border-slate-800 bg-slate-900 p-3.5">
                    <div className="text-[11px] text-slate-500">Tela</div>
                    <div className="mb-1.5 truncate text-sm font-semibold text-slate-100">{tela}</div>
                    <div className="text-3xl font-bold text-brand-400">{v}</div>
                    <div className="text-xs text-slate-500">rollos para corte</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TiempoBox
                  titulo="Tiempo estimado de corte"
                  valor={fmtTiempo(segCorte)}
                  calculo={`${totalCorte} rollos × 1 min 46 seg = ${(segCorte / 3600).toFixed(1)} hs`}
                />
                <TiempoBox
                  titulo="Tiempo de envivado"
                  valor={totalSegEnv > 0 ? fmtTiempo(totalSegEnv) : '—'}
                  calculo={totalSegEnv > 0 ? `${(totalSegEnv / 3600).toFixed(1)} hs totales` : 'Sin envivado'}
                  variant="blue"
                />
              </div>
              <PrintButton onClick={() => imprimirCorte(corte, totalCorte)} label="Imprimir corte de bandas" />
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Tela</Th>
                    <Th num>Alto</Th>
                    <Th num>Rollos</Th>
                  </tr>
                </thead>
                <tbody>
                  {corteOrdenado.map((r, i) => (
                    <tr key={i} className="border-b border-slate-800/60 last:border-0">
                      <Td>
                        <FechaTag>{r.fecha}</FechaTag>
                      </Td>
                      <Td>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${telaBadgeClasses(r.tela)}`}>{r.tela ?? '?'}</span>
                      </Td>
                      <Td num>{r.alto ?? '-'}</Td>
                      <Td num>
                        <strong>{r.rollos}</strong>
                        {r.rollosDescontados > 0 && (
                          <span className="ml-1.5 rounded bg-brand-500/10 px-1.5 py-0.5 text-[11px] text-brand-400">−{r.rollosDescontados} stock</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {activeTab === 'matelaseadora' && (
            <div className="flex flex-col gap-4">
              <TiempoBox
                titulo="Tiempo estimado matelaseadora"
                valor={fmtTiempo(segMatel)}
                calculo={`${totalGrandes} rollos × 40 min = ${(segMatel / 3600).toFixed(1)} hs`}
              />
              <PrintButton onClick={() => imprimirMatelaseadora(matel, totalGrandes)} label="Imprimir matelaseadora" />
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Tela</Th>
                    <Th num>Rollos grandes</Th>
                  </tr>
                </thead>
                <tbody>
                  {matel.map((r, i) => (
                    <tr key={i} className="border-b border-slate-800/60 last:border-0">
                      <Td>
                        <FechaTag>{r.fecha}</FechaTag>
                      </Td>
                      <Td>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${telaBadgeClasses(r.tela)}`}>{r.tela ?? '?'}</span>
                      </Td>
                      <Td num>
                        <strong>{r.rollosGrandes}</strong>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {activeTab === 'optimizacion' && (
            <div className="flex flex-col gap-4">
              <PrintButton onClick={() => imprimirOptimizacion(optData)} label="Imprimir optimización de corte" />
              <BandasOptimizacion optData={optData} corteRows={corte} onAgregarSobrantesAlStock={agregarSobrantesAlStock} />
            </div>
          )}

          {activeTab === 'envivado' && (
            <div className="flex flex-col gap-4">
              <PrintButton onClick={() => imprimirEnvivado(envRows, totalSegEnv)} label="Imprimir envivado" />
              <TiempoBox
                titulo="Tiempo total de envivado"
                valor={totalSegEnv > 0 ? fmtTiempo(totalSegEnv) : '—'}
                calculo={totalSegEnv > 0 ? `${(totalSegEnv / 3600).toFixed(1)} hs totales` : 'Sin envivado'}
                variant="blue"
              />
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Producto</Th>
                    <Th num>Alto</Th>
                    <Th num>Cantidad</Th>
                    <Th>Tipo</Th>
                    <Th num>T. unitario</Th>
                    <Th num>T. total</Th>
                  </tr>
                </thead>
                <tbody>
                  {envRows.map((r, i) => {
                    const mins = Math.floor(r.seg / 60);
                    const segs = r.seg % 60;
                    const unitStr = r.seg === 0 ? '—' : `${mins}:${String(segs).padStart(2, '0')}`;
                    const totalMins = Math.floor(r.totalSeg / 60);
                    const totalSegs = r.totalSeg % 60;
                    const totalStr = r.totalSeg === 0 ? '—' : `${totalMins}:${String(totalSegs).padStart(2, '0')}`;
                    return (
                      <tr key={i} className="border-b border-slate-800/60 last:border-0">
                        <Td>
                          <FechaTag>{r.fecha}</FechaTag>
                        </Td>
                        <Td className="text-xs">{r.producto}</Td>
                        <Td num>{r.alto ?? '-'}</Td>
                        <Td num>{r.cantidad}</Td>
                        <Td className="text-xs">{r.tipo}</Td>
                        <Td num>{unitStr}</Td>
                        <Td num>
                          <strong>{totalStr}</strong>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </div>
          )}

          {activeTab === 'detalle' && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Producto</Th>
                  <Th num>Cant</Th>
                  <Th>Tela</Th>
                  <Th>Medida</Th>
                  <Th num>Alto</Th>
                  <Th num>Largo</Th>
                  <Th num>Metros</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <FechaTag>{r.fecha}</FechaTag>
                    </Td>
                    <Td className="text-xs">{r.producto}</Td>
                    <Td num>{r.cantidad}</Td>
                    <Td>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${telaBadgeClasses(r.tela)}`}>{r.tela ?? '?'}</span>
                    </Td>
                    <Td className="text-xs">{r.medida ?? <span className="italic text-red-400">?</span>}</Td>
                    <Td num>{r.alto ?? '-'}</Td>
                    <Td num>{r.largo ? r.largo.toFixed(2) : '-'}</Td>
                    <Td num>{r.metros.toFixed(2)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island, same pattern as the other Producción tabs. */
export default function BandasApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <BandasInner />
    </QueryProvider>
  );
}
