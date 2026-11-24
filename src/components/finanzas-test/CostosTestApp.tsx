import { useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { fmtFechaHora } from '@/lib/rentabilidad/format';
import type { CampoCosto, CostoFila, CostosResultado } from '@/lib/odoo/rentabilidad/costos-test';
import { CLASE_INPUT, Etq, Kpi, Panel, Pildora, descargarCsv, fmtDec, fmtEntero, fmtPesos } from './ui';

type Filtro = 'todos' | 'difiere' | 'solo-odoo' | 'ok';
const PASO = 300;

const ETIQUETA_CAMPO: Record<CampoCosto, string> = {
  nombre: 'Nombre',
  costo: 'Costo',
  categoria: 'Categoría',
  volumen: 'Volumen',
  patas: 'Patas',
  largoTela: 'Largo de tela',
  precioVenta: 'Precio de venta',
};

function Celda({ fila, campo, children, alinear = 'right' }: { fila: CostoFila; campo: CampoCosto; children: string; alinear?: 'left' | 'right' }) {
  const dif = fila.difs.includes(campo);
  const pl = fila.planilla?.[campo];
  const planilla =
    pl === undefined || pl === null ? '—' : typeof pl === 'number' ? (campo === 'costo' || campo === 'precioVenta' ? fmtPesos(pl) : fmtDec(pl)) : String(pl);
  return (
    <td className={`py-1.5 pr-4 ${alinear === 'right' ? 'text-right tabular-nums' : ''} ${dif ? 'text-amber-300' : 'text-slate-300'}`}>
      {children}
      {dif && <div className="text-[11px] text-slate-500">planilla: {planilla}</div>}
    </td>
  );
}

function CostosInner() {
  const query = useApiQuery<CostosResultado>(['finanzas-test-costos'], '/api/finanzas-test/costos');
  const data = query.data;
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [verSoloPlanilla, setVerSoloPlanilla] = useState(false);
  const [limite, setLimite] = useState(PASO);

  const filas = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return (data?.filas ?? []).filter((f) => {
      if (filtro === 'difiere' && f.estado !== 'difiere') return false;
      if (filtro === 'solo-odoo' && f.estado !== 'solo-odoo') return false;
      if (filtro === 'ok' && f.estado !== 'ok') return false;
      if (categoria && f.categoria !== categoria) return false;
      return !t || f.codigo.toLowerCase().includes(t) || f.nombre.toLowerCase().includes(t);
    });
  }, [data, busqueda, categoria, filtro]);

  const r = data?.resumen;
  const pctOk = r && r.enOdoo - r.soloOdoo > 0 ? r.coinciden / (r.enOdoo - r.soloOdoo) : null;

  return (
    <div className="flex flex-col gap-6">
      {query.error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{(query.error as Error).message}</p>}

      {r ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <Kpi tip="kpiEnOdoo" label="Productos en Odoo" value={fmtEntero(r.enOdoo)} hint="con código de barras" />
          <Kpi tip="kpiEnPlanilla" label="Productos en la planilla" value={fmtEntero(r.enPlanilla)} />
          <Kpi tip="kpiCoinciden" label="Coinciden" value={fmtEntero(r.coinciden)} tono="ok" hint={pctOk === null ? undefined : `${(pctOk * 100).toFixed(1).replace('.', ',')}% de los que están en las dos`} />
          <Kpi tip="kpiDifieren" label="Difieren" value={fmtEntero(r.difieren)} tono={r.difieren > 0 ? 'warn' : undefined} hint="algún campo distinto" />
          <Kpi tip="kpiSoloOdoo" label="Solo en Odoo" value={fmtEntero(r.soloOdoo)} tono="info" hint="productos nuevos o no exportados" />
          <Kpi tip="kpiSoloPlanilla" label="Solo en la planilla" value={fmtEntero(r.soloPlanilla)} hint="ya no están en Odoo" />
        </div>
      ) : (
        !query.error && <p className="text-sm text-slate-500">Leyendo productos de Odoo y la planilla…</p>
      )}

      {r && r.difieren > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Diferencias por campo:</span>
          {(Object.keys(ETIQUETA_CAMPO) as CampoCosto[])
            .filter((c) => r.porCampo[c] > 0)
            .map((c) => (
              <Pildora key={c} tono="warn">
                {ETIQUETA_CAMPO[c]}: {fmtEntero(r.porCampo[c])}
              </Pildora>
            ))}
        </div>
      )}

      <Panel
        titulo="Costos de productos (Odoo en vivo)"
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setLimite(PASO);
              }}
              placeholder="Buscar código o nombre…"
              className={`${CLASE_INPUT} w-60`}
            />
            <select
              className={CLASE_INPUT}
              value={categoria}
              onChange={(e) => {
                setCategoria(e.target.value);
                setLimite(PASO);
              }}
            >
              <option value="">Todas las categorías</option>
              {(data?.categorias ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className={CLASE_INPUT}
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value as Filtro);
                setLimite(PASO);
              }}
            >
              <option value="todos">Todos</option>
              <option value="difiere">Difieren de la planilla</option>
              <option value="solo-odoo">Solo en Odoo</option>
              <option value="ok">Coinciden</option>
            </select>
            <button
              type="button"
              disabled={filas.length === 0}
              onClick={() =>
                descargarCsv(
                  'costos-odoo.csv',
                  ['Código de barras', 'Nombre', 'Costo', 'Categoría del producto', 'Volumen', 'Cantidad de patas', 'Largo de tela', 'Precio de venta', 'Estado vs planilla'],
                  filas.map((f) => [f.codigo, f.nombre, f.costo, f.categoria, f.volumen, f.patas, f.largoTela, f.precioVenta, f.estado === 'ok' ? 'coincide' : f.estado === 'solo-odoo' ? 'solo en Odoo' : `difiere: ${f.difs.map((d) => ETIQUETA_CAMPO[d]).join(', ')}`])
                )
              }
              className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-40"
            >
              Exportar CSV
            </button>
            <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium"><Etq clave="codigo">Código de barras</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="nombre">Nombre</Etq></th>
                <th className="py-2 pr-4 text-right font-medium"><Etq clave="costo">Costo</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="categoria">Categoría</Etq></th>
                <th className="py-2 pr-4 text-right font-medium"><Etq clave="volumen">Volumen</Etq></th>
                <th className="py-2 pr-4 text-right font-medium"><Etq clave="patas">Patas</Etq></th>
                <th className="py-2 pr-4 text-right font-medium"><Etq clave="largoTela">Largo de tela</Etq></th>
                <th className="py-2 pr-4 text-right font-medium"><Etq clave="precioVenta">Precio de venta</Etq></th>
                <th className="py-2 font-medium"><Etq clave="estado">vs planilla</Etq></th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, limite).map((f) => (
                <tr key={f.varianteId} className="border-b border-slate-800/60">
                  <td className="py-1.5 pr-4 font-mono text-xs text-slate-400">{f.codigo}</td>
                  <Celda fila={f} campo="nombre" alinear="left">
                    {f.nombre}
                  </Celda>
                  <Celda fila={f} campo="costo">
                    {fmtPesos(f.costo)}
                  </Celda>
                  <Celda fila={f} campo="categoria" alinear="left">
                    {f.categoria}
                  </Celda>
                  <Celda fila={f} campo="volumen">
                    {fmtDec(f.volumen)}
                  </Celda>
                  <Celda fila={f} campo="patas">
                    {fmtEntero(f.patas)}
                  </Celda>
                  <Celda fila={f} campo="largoTela">
                    {fmtDec(f.largoTela)}
                  </Celda>
                  <Celda fila={f} campo="precioVenta">
                    {fmtPesos(f.precioVenta)}
                  </Celda>
                  <td className="py-1.5">
                    {f.estado === 'ok' ? <Pildora tono="ok">coincide</Pildora> : f.estado === 'solo-odoo' ? <Pildora tono="info">solo Odoo</Pildora> : <Pildora tono="warn">difiere</Pildora>}
                  </td>
                </tr>
              ))}
              {data && filas.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-500">
                    Sin productos para estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filas.length > limite && (
          <div className="mt-3 flex items-center gap-3 text-sm text-slate-400">
            <span>
              Mostrando {fmtEntero(limite)} de {fmtEntero(filas.length)}
            </span>
            <button type="button" onClick={() => setLimite((l) => l + PASO)} className="rounded border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200 hover:border-brand-500">
              Mostrar más
            </button>
            <button type="button" onClick={() => setLimite(filas.length)} className="text-slate-500 underline hover:text-slate-300">
              Mostrar todos
            </button>
          </div>
        )}
        {data && (
          <p className="mt-3 text-xs text-slate-500">
            Datos de Odoo al {fmtFechaHora(data.generado)} (costo de la compañía 1, como la planilla). Los valores en ámbar son los que difieren; abajo de cada uno se ve lo que dice la planilla.
            Las patas son un dato cargado a mano en la planilla (no entran en ningún cálculo de costo).
          </p>
        )}
      </Panel>

      {data && data.soloPlanilla.length > 0 && (
        <Panel
          titulo={`Solo en la planilla (${data.soloPlanilla.length})`}
          acciones={
            <button type="button" onClick={() => setVerSoloPlanilla((v) => !v)} className="text-sm text-slate-400 underline hover:text-slate-200">
              {verSoloPlanilla ? 'Ocultar' : 'Ver'}
            </button>
          }
        >
          {verSoloPlanilla ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Código</th>
                  <th className="py-2 pr-4 font-medium">Nombre</th>
                  <th className="py-2 pr-4 text-right font-medium">Costo</th>
                  <th className="py-2 font-medium">Categoría</th>
                </tr>
              </thead>
              <tbody>
                {data.soloPlanilla.map((p) => (
                  <tr key={p.codigo} className="border-b border-slate-800/60 text-slate-300">
                    <td className="py-1.5 pr-4 font-mono text-xs text-slate-400">{p.codigo}</td>
                    <td className="py-1.5 pr-4">{p.nombre}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPesos(p.costo)}</td>
                    <td className="py-1.5">{p.categoria}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">Productos que la planilla todavía lista y que Odoo ya no devuelve (archivados, sin código de barras o con otro código).</p>
          )}
        </Panel>
      )}
    </div>
  );
}

export default function CostosTestApp() {
  return (
    <QueryProvider>
      <CostosInner />
    </QueryProvider>
  );
}
