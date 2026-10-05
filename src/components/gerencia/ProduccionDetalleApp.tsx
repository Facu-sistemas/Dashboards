import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import PeriodPicker, { idxsForPeriodo } from './PeriodPicker';
import ProduccionDetalleChart, { type SerieProducto } from './ProduccionDetalleChart';
import ProduccionDetalleTable, { type FilaDetalle } from './ProduccionDetalleTable';
import { DESTACADOS_DEFAULT, DESTACADOS_MAX } from './produccion-detalle-palette';

interface Props {
  dehydratedState?: DehydratedState;
}

interface ProduccionDetalleProducto {
  nombre: string;
  modelo: string;
  familia: string;
  categoria: 'sillones' | 'colchones';
  categOdoo: string;
  cant: number[];
  ue: number[];
}

interface ProduccionDetalleResult {
  year: number;
  mesesConDatos: number;
  productos: ProduccionDetalleProducto[];
}

type Sector = 'sillones' | 'colchones' | 'ambos';
type Vista = 'producto' | 'familia' | 'categoria';

const CLAVE_POR_VISTA = { producto: 'modelo', familia: 'familia', categoria: 'categOdoo' } as const;
const NOMBRE_VISTA: Record<Vista, string> = { producto: 'producto', familia: 'familia', categoria: 'categoría' };
type Medida = 'cant' | 'ue';

function sumArrays(arrs: number[][], nMeses: number): number[] {
  return Array.from({ length: nMeses }, (_, i) => arrs.reduce((s, a) => s + (a[i] ?? 0), 0));
}

function sumPorIdxs(arr: number[], idxs: number[]): number {
  return idxs.reduce((s, i) => s + (arr[i] ?? 0), 0);
}

/**
 * Agrupa por "modelo" (ej. "Stella Sofá Eléctrico 2/3 Cpo", sumando todas
 * sus telas/colores — eso es lo que la pestaña llama "Producto": la
 * variante de tela sola no tenía sentido como fila propia) o por
 * "familia" (un nivel más arriba: Stella/Movex/Sirius/Onix) o por
 * categoría de Odoo ("Sillon / Deliveries", "Sillon / Accesorio"...) según
 * la vista elegida.
 */
function agrupar(productos: ProduccionDetalleProducto[], vista: Vista, nMeses: number): { nombre: string; cant: number[]; ue: number[] }[] {
  const clave = CLAVE_POR_VISTA[vista];
  const porClave = new Map<string, ProduccionDetalleProducto[]>();
  for (const p of productos) {
    const grupo = porClave.get(p[clave]) ?? [];
    grupo.push(p);
    porClave.set(p[clave], grupo);
  }
  return [...porClave.entries()].map(([nombre, items]) => ({
    nombre,
    cant: sumArrays(items.map((i) => i.cant), nMeses),
    ue: sumArrays(items.map((i) => i.ue), nMeses),
  }));
}

function ToggleGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ProduccionDetalleInner() {
  const query = useApiQuery<ProduccionDetalleResult>(['produccion-detalle'], '/api/produccion-detalle');
  const data = query.data;
  const nMeses = data?.mesesConDatos ?? 12;
  const [sector, setSector] = useState<Sector>('sillones');
  const [vista, setVista] = useState<Vista>('familia');
  const [medida, setMedida] = useState<Medida>('ue');
  const [periodo, setPeriodo] = useState('ACU');
  const [destacados, setDestacados] = useState(DESTACADOS_DEFAULT);
  // Se guardan las apagadas (no las prendidas) para que una categoría nueva aparezca prendida por defecto.
  const [categsExcluidas, setCategsExcluidas] = useState<Set<string>>(new Set());

  const idxs = useMemo(() => idxsForPeriodo(periodo, nMeses), [periodo, nMeses]);

  const productosSector = useMemo(() => {
    if (!data) return [];
    return sector === 'ambos' ? data.productos : data.productos.filter((p) => p.categoria === sector);
  }, [data, sector]);

  const categsDisponibles = useMemo(() => [...new Set(productosSector.map((p) => p.categOdoo))].sort(), [productosSector]);

  const grupos = useMemo(() => {
    if (!data) return [];
    const filtrados = productosSector.filter((p) => !categsExcluidas.has(p.categOdoo));
    return agrupar(filtrados, vista, data.mesesConDatos);
  }, [data, productosSector, categsExcluidas, vista]);

  const toggleCateg = (c: string) =>
    setCategsExcluidas((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            {data?.year ?? ''} · quiénes componen los totales de Producción — mismas órdenes de fabricación (Odoo, mrp.production) desglosadas por producto.
          </p>
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
        {data && <PeriodPicker nMeses={nMeses} periodo={periodo} onChange={setPeriodo} />}
        <div className="flex flex-wrap items-center gap-4">
          <ToggleGroup
            label="Sector"
            value={sector}
            onChange={setSector}
            options={[
              { value: 'sillones', label: 'Living' },
              { value: 'colchones', label: 'Colchones' },
              { value: 'ambos', label: 'Ambos' },
            ]}
          />
          <ToggleGroup
            label="Ver por"
            value={vista}
            onChange={setVista}
            options={[
              { value: 'familia', label: 'Familia' },
              { value: 'producto', label: 'Producto' },
              { value: 'categoria', label: 'Categoría' },
            ]}
          />
          <ToggleGroup
            label="Medida"
            value={medida}
            onChange={setMedida}
            options={[
              { value: 'cant', label: 'Cantidad' },
              { value: 'ue', label: 'Unidad equivalente' },
            ]}
          />
          <label className="flex items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mostrar</span>
            <input
              type="number"
              min={1}
              max={DESTACADOS_MAX}
              value={destacados}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n)) setDestacados(Math.min(DESTACADOS_MAX, Math.max(1, n)));
              }}
              className="w-16 rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-200 focus:border-brand-500 focus:outline-none"
            />
            <span className="text-xs text-slate-400">+ Otros</span>
          </label>
        </div>
        {categsDisponibles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Categorías</span>
            {categsDisponibles.map((c) => {
              const activa = !categsExcluidas.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCateg(c)}
                  aria-pressed={activa}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    activa ? 'border-brand-500 bg-brand-500/20 text-brand-300' : 'border-slate-700 bg-slate-950 text-slate-500 line-through hover:border-brand-500/50'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        (() => {
          // Sin producción en el período elegido — no aporta nada mostrar la fila en 0. Se mira cantidad O UE (no solo la
          // medida elegida): si en UE se ocultaran las filas con 0 UE (almohadones), el total de Cantidad de la tabla dejaría
          // de coincidir con la pestaña Producción (sept 2026: 2.155 en vez de 2.222).
          const conDatos = grupos.filter((g) => sumPorIdxs(g.cant, idxs) > 0 || sumPorIdxs(g.ue, idxs) > 0);
          const series: SerieProducto[] = conDatos.map((g) => ({ nombre: g.nombre, valores: g[medida] }));
          const filas: FilaDetalle[] = conDatos.map((g) => ({ nombre: g.nombre, cant: sumPorIdxs(g.cant, idxs), ue: sumPorIdxs(g.ue, idxs) }));
          const tituloSector = sector === 'sillones' ? 'Living' : sector === 'colchones' ? 'Colchones' : 'Living + Colchones';

          return (
            <>
              <ProduccionDetalleChart
                key={`${sector}-${vista}-${medida}-${periodo}-${[...categsExcluidas].join('|')}`}
                title={`${tituloSector} por ${NOMBRE_VISTA[vista]} —${medida === 'ue' ? 'unidad equivalente' : 'cantidad'}`}
                series={series}
                idxs={idxs}
                unidad={medida === 'ue' ? 'u eq.' : 'u'}
                destacados={destacados}
              />
              <ProduccionDetalleTable rows={filas} ordenarPor={medida} destacados={destacados} />
            </>
          );
        })()
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as el resto de Gerencia General. */
export default function ProduccionDetalleApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ProduccionDetalleInner />
    </QueryProvider>
  );
}
