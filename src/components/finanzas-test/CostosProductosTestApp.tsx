import { useMemo, useState, type ReactNode } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { fmtFechaHora } from '@/lib/rentabilidad/format';
import type { CampoCP, CostoProductoFila, CostosProductosResultado, FuenteCostos } from '@/lib/odoo/rentabilidad/costos-productos-test';
import type { ClaveGlosarioTest } from './glosario';
import { CLASE_INPUT, Etq, Kpi, Panel, Pildora, descargarCsv, fmtDec, fmtEntero, fmtPesos, fmtProc } from './ui';

type Filtro = 'todos' | 'difiere' | 'solo-odoo' | 'ok';
const PASO = 200;

type Formato = 'pesos' | 'proc' | 'dec';
const COLUMNAS: { campo: CampoCP; titulo: string; tip: ClaveGlosarioTest; formato: Formato }[] = [
  { campo: 'precioTela', titulo: 'Precio tela', tip: 'cpPrecioTela', formato: 'pesos' },
  { campo: 'costoMp', titulo: 'Costo MP', tip: 'cpCostoMp', formato: 'pesos' },
  { campo: 'tela', titulo: 'Tela', tip: 'cpTela', formato: 'pesos' },
  { campo: 'costoTotalMp', titulo: 'Costo total MP', tip: 'cpCostoTotalMp', formato: 'pesos' },
  { campo: 'tiempoHs', titulo: 'Tiempo de línea (hs)', tip: 'cpTiempo', formato: 'dec' },
  { campo: 'costoMod', titulo: 'MOD', tip: 'cpMod', formato: 'pesos' },
  { campo: 'costoModInd', titulo: 'MOD + indirecta', tip: 'cpModInd', formato: 'pesos' },
  { campo: 'costoNoProductiva', titulo: 'MO no productiva', tip: 'cpNoProductiva', formato: 'pesos' },
  { campo: 'costosFijos', titulo: 'Costos fijos', tip: 'cpFijos', formato: 'pesos' },
  { campo: 'costoParaContribucion', titulo: 'Costo p/ contribución', tip: 'cpCostoContribucion', formato: 'pesos' },
  { campo: 'costoTotal', titulo: 'Costo total', tip: 'cpCostoTotal', formato: 'pesos' },
  { campo: 'precioVenta', titulo: 'Precio de venta', tip: 'cpPrecioVenta', formato: 'pesos' },
  { campo: 'contribucion', titulo: 'Contribución', tip: 'cpContribucion', formato: 'proc' },
  { campo: 'rentabilidad', titulo: 'Rentabilidad', tip: 'cpRentabilidad', formato: 'proc' },
  { campo: 'rentabilidadPesos', titulo: 'Rentabilidad $', tip: 'cpRentabilidadPesos', formato: 'pesos' },
];

function formatear(v: number | null | undefined, f: Formato): string {
  return f === 'pesos' ? fmtPesos(v) : f === 'proc' ? fmtProc(v, 2) : fmtDec(v);
}

function Celda({ fila, campo, formato }: { fila: CostoProductoFila; campo: CampoCP; formato: Formato }) {
  const dif = fila.difs.includes(campo);
  const valor = fila[campo] as number | null;
  const pl = fila.planilla?.[campo];
  return (
    <td className={`py-1.5 pr-4 text-right tabular-nums ${dif ? 'text-amber-300' : 'text-slate-300'}`}>
      {formatear(valor, formato)}
      {dif && <div className="text-[11px] text-slate-500">planilla: {formatear(pl, formato)}</div>}
    </td>
  );
}

function Parametro({ etiqueta, valor, tip }: { etiqueta: string; valor: string; tip?: ReactNode }) {
  return (
    <div className="text-xs">
      <div className="text-slate-500">{tip ?? etiqueta}</div>
      <div className="font-medium tabular-nums text-slate-200">{valor}</div>
    </div>
  );
}

function CostosProductosInner() {
  const [fuente, setFuente] = useState<FuenteCostos>('odoo');
  const query = useApiQuery<CostosProductosResultado>(['finanzas-test-costos-productos', fuente], `/api/finanzas-test/costos-productos?fuente=${fuente}`);
  const data = query.data;
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [limite, setLimite] = useState(PASO);
  const [verParametros, setVerParametros] = useState(true);

  const filas = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return (data?.filas ?? []).filter((f) => {
      if (filtro !== 'todos' && f.estado !== filtro) return false;
      if (categoria && f.categoria !== categoria) return false;
      return !t || f.codigo.toLowerCase().includes(t) || f.nombre.toLowerCase().includes(t);
    });
  }, [data, busqueda, categoria, filtro]);

  const r = data?.resumen;
  const P = data?.parametros;
  const pctOk = r && r.conPlanilla > 0 ? r.coinciden / r.conPlanilla : null;
  const reiniciar = () => setLimite(PASO);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <Etq clave="cpFuente">Datos de tiempo y tela</Etq>
          <select
            className={`${CLASE_INPUT} min-w-[18rem]`}
            value={fuente}
            onChange={(e) => {
              setFuente(e.target.value === 'planilla' ? 'planilla' : 'odoo');
              reiniciar();
            }}
          >
            <option value="odoo">Odoo (dinámico)</option>
            <option value="planilla">Planilla (valida las fórmulas)</option>
          </select>
        </label>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{(query.error as Error).message}</p>}

      {r ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Kpi tip="kpiEnOdoo" label="Productos calculados" value={fmtEntero(r.productos)} hint="desde Odoo" />
          <Kpi tip="kpiCoinciden" label="Coinciden con la planilla" value={fmtEntero(r.coinciden)} tono="ok" hint={pctOk === null ? undefined : `${(pctOk * 100).toFixed(1).replace('.', ',')}% de los ${fmtEntero(r.conPlanilla)} que están en las dos`} />
          <Kpi tip="kpiDifieren" label="Difieren" value={fmtEntero(r.difieren)} tono={r.difieren > 0 ? 'warn' : undefined} hint="algún campo distinto" />
          <Kpi tip="kpiSoloOdoo" label="Solo en Odoo" value={fmtEntero(r.soloOdoo)} tono="info" hint="la planilla no los tiene" />
          <Kpi tip="kpiEnPlanilla" label="En la planilla" value={fmtEntero(r.conPlanilla)} hint="de los calculados" />
        </div>
      ) : (
        !query.error && <p className="text-sm text-slate-500">Calculando costos desde Odoo y la planilla…</p>
      )}

      {r && r.difieren > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Diferencias por campo:</span>
          {COLUMNAS.filter((c) => r.porCampo[c.campo] > 0).map((c) => (
            <Pildora key={c.campo} tono="warn">
              {c.titulo}: {fmtEntero(r.porCampo[c.campo])}
            </Pildora>
          ))}
        </div>
      )}

      {P && (
        <Panel
          titulo="Parámetros que no están en Odoo (leídos en vivo de la planilla)"
          acciones={
            <button type="button" onClick={() => setVerParametros((v) => !v)} className="text-sm text-slate-400 underline hover:text-slate-200">
              {verParametros ? 'Ocultar' : 'Ver'}
            </button>
          }
        >
          {verParametros && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                <Parametro etiqueta="Valor hora productivo" valor={fmtPesos(P.valorHora)} tip={<Etq clave="cpMod">Valor hora productivo</Etq>} />
                <Parametro etiqueta="Coef. indirecta" valor={`× ${fmtDec(P.coefIndirecta)}`} tip={<Etq clave="cpModInd">Coef. indirecta (no colchón)</Etq>} />
                <Parametro etiqueta="No productiva colchones" valor={fmtPesos(P.noProductivoColchones)} tip={<Etq clave="cpNoProductiva">No productiva colchones</Etq>} />
                <Parametro etiqueta="No productiva sillones" valor={fmtPesos(P.noProductivoSillones)} tip={<Etq clave="cpNoProductiva">No productiva sillones</Etq>} />
                <Parametro etiqueta="Fijos colchones" valor={fmtPesos(P.fijosColchones)} tip={<Etq clave="cpFijos">Costos fijos colchones</Etq>} />
                <Parametro etiqueta="Fijos sillones" valor={fmtPesos(P.fijosSillones)} tip={<Etq clave="cpFijos">Costos fijos sillones</Etq>} />
                <Parametro etiqueta="Capacidad sillón" valor={`${fmtDec(P.capacidadSillon)} / tiempo`} tip={<Etq clave="cpNoProductiva">Capacidad sillón (un/mes)</Etq>} />
                <Parametro etiqueta="Capacidad colchón" valor={`${fmtDec(P.capacidadColchon)} / tiempo`} tip={<Etq clave="cpNoProductiva">Capacidad colchón (un/mes)</Etq>} />
                <Parametro etiqueta="Hs unidad eq." valor={fmtDec(P.horasUnidadEq)} tip={<Etq clave="cpUnidadEq">Hs unidad equivalente</Etq>} />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                <Etq clave="cpParametros">¿De dónde salen?</Etq> Cambian cuando la planilla se actualiza cada mes (valor hora y pozos).
              </p>
            </>
          )}
        </Panel>
      )}

      <Panel
        titulo="Costo unitario por producto"
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                reiniciar();
              }}
              placeholder="Buscar código o nombre…"
              className={`${CLASE_INPUT} w-60`}
            />
            <select
              className={CLASE_INPUT}
              value={categoria}
              onChange={(e) => {
                setCategoria(e.target.value);
                reiniciar();
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
                reiniciar();
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
                  `costos-productos-${fuente}.csv`,
                  ['Código de barras', 'Nombre', 'PRODUCTO', 'DESCRIPCION TELA + PATA', 'DESCRIPCION PATA', 'DESCRIPCION TELA', 'GRUPO TELA', 'CATEGORÍA', ...COLUMNAS.map((c) => c.titulo), 'Unidad Eq.', 'Estado vs planilla'],
                  filas.map((f) => [
                    f.codigo,
                    f.nombre,
                    f.producto,
                    f.descTelaPata,
                    f.descPata,
                    f.descTela,
                    f.grupoTela,
                    f.categoria,
                    ...COLUMNAS.map((c) => f[c.campo] as number | null),
                    f.unidadEq,
                    f.estado === 'ok' ? 'coincide' : f.estado === 'solo-odoo' ? 'solo en Odoo' : `difiere: ${f.difs.join(', ')}`,
                  ])
                )
              }
              className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-40"
            >
              Exportar CSV
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[2000px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium"><Etq clave="cpCodigo">Código</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="cpProducto">Producto</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="cpTelaPata">Tela y pata</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="cpGrupoTela">Grupo</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="categoria">Categoría</Etq></th>
                {COLUMNAS.map((c) => (
                  <th key={c.campo} className="py-2 pr-4 text-right font-medium">
                    <Etq clave={c.tip}>{c.titulo}</Etq>
                  </th>
                ))}
                <th className="py-2 pr-4 text-right font-medium"><Etq clave="cpUnidadEq">Unidad eq.</Etq></th>
                <th className="py-2 font-medium"><Etq clave="estado">vs planilla</Etq></th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, limite).map((f) => (
                <tr key={f.codigo} className="border-b border-slate-800/60">
                  <td className="py-1.5 pr-4 font-mono text-xs text-slate-400">{f.codigo}</td>
                  <td className="py-1.5 pr-4 text-slate-300">
                    {f.producto}
                    {f.avisos.length > 0 && (
                      <span className="ml-1 cursor-help text-amber-400" title={f.avisos.join('\n')}>
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-400">{f.descTelaPata || '—'}</td>
                  <td className="py-1.5 pr-4 text-slate-400">{f.grupoTela || '—'}</td>
                  <td className="py-1.5 pr-4 text-slate-400">{f.categoria}</td>
                  {COLUMNAS.map((c) => (
                    <Celda key={c.campo} fila={f} campo={c.campo} formato={c.formato} />
                  ))}
                  <td className="py-1.5 pr-4 text-right tabular-nums text-slate-300">{fmtDec(f.unidadEq)}</td>
                  <td className="py-1.5">
                    {f.estado === 'ok' ? <Pildora tono="ok">coincide</Pildora> : f.estado === 'solo-odoo' ? <Pildora tono="info">solo Odoo</Pildora> : <Pildora tono="warn">difiere</Pildora>}
                  </td>
                </tr>
              ))}
              {data && filas.length === 0 && (
                <tr>
                  <td colSpan={22} className="py-6 text-center text-slate-500">
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
            Datos de Odoo al {fmtFechaHora(data.generado)}. Pasá el mouse por cada encabezado para ver de dónde sale el dato. Los valores en ámbar difieren de la planilla (abajo se ve lo que ella dice).
            El ⚠ indica que a esa fila le falta un dato para calcularse completa.
          </p>
        )}
      </Panel>
    </div>
  );
}

export default function CostosProductosTestApp() {
  return (
    <QueryProvider>
      <CostosProductosInner />
    </QueryProvider>
  );
}
