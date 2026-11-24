import { useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { fmtFechaHora, MESES } from '@/lib/rentabilidad/format';
import type { CampoFac, FacturaFila, FacturacionResultado, TotalesFac } from '@/lib/odoo/rentabilidad/facturacion-test';
import type { FuenteCostos } from '@/lib/odoo/rentabilidad/costos-productos-test';
import type { ClaveGlosarioTest } from './glosario';
import { CLASE_INPUT, Etq, Kpi, Panel, Pildora, descargarCsv, fmtDec, fmtEntero, fmtPesos, fmtProc } from './ui';

type Filtro = 'todos' | 'difiere' | 'solo-odoo' | 'ok' | 'sin-costo';
const PASO = 200;

type Formato = 'pesos' | 'proc' | 'dec' | 'entero';
interface Col {
  clave: keyof FacturaFila;
  titulo: string;
  tip: ClaveGlosarioTest;
  formato: Formato;
  /** Campo comparable contra la planilla (para resaltar diferencias). */
  campo?: CampoFac;
}
const COLS: Col[] = [
  { clave: 'subtotal', titulo: 'Subtotal', tip: 'faSubtotal', formato: 'pesos', campo: 'subtotal' },
  { clave: 'cantidad', titulo: 'Cantidad', tip: 'faCantidad', formato: 'dec', campo: 'cantidad' },
  { clave: 'ticket', titulo: 'Ticket', tip: 'faTicket', formato: 'pesos' },
  { clave: 'volumen', titulo: 'Volumen', tip: 'faVolumen', formato: 'dec' },
  { clave: 'recargoPct', titulo: '% Recargo', tip: 'faRecargoPct', formato: 'proc', campo: 'recargoPct' },
  { clave: 'recargo', titulo: '$ Recargo', tip: 'faRecargo', formato: 'pesos', campo: 'recargo' },
  { clave: 'costoEntrega', titulo: 'Costo entrega', tip: 'faCostoEntrega', formato: 'pesos', campo: 'costoEntrega' },
  { clave: 'montoSinFlete', titulo: 'Monto s/flete', tip: 'faMontoSinFlete', formato: 'pesos', campo: 'montoSinFlete' },
  { clave: 'ticketSinFlete', titulo: 'Ticket s/flete', tip: 'faTicketSinFlete', formato: 'pesos' },
  { clave: 'costoMp', titulo: 'Costo MP', tip: 'faCostoMp', formato: 'pesos', campo: 'costoMp' },
  { clave: 'costoMod', titulo: 'MOD + indirecta', tip: 'faCostoMod', formato: 'pesos', campo: 'costoMod' },
  { clave: 'costoNoProd', titulo: 'MO no productiva', tip: 'faCostoNoProd', formato: 'pesos', campo: 'costoNoProd' },
  { clave: 'costosFijos', titulo: 'Costos fijos', tip: 'faCostosFijos', formato: 'pesos', campo: 'costosFijos' },
  { clave: 'costoUn', titulo: 'Costo x un.', tip: 'faCostoUn', formato: 'pesos' },
  { clave: 'cmv', titulo: 'Costo CMV', tip: 'faCmv', formato: 'pesos', campo: 'cmv' },
  { clave: 'costoContrib', titulo: 'Costo p/ contribución', tip: 'faCostoContrib', formato: 'pesos', campo: 'costoContrib' },
  { clave: 'pctCf', titulo: '% Costo financiero', tip: 'faPctCf', formato: 'proc', campo: 'pctCf' },
  { clave: 'cf', titulo: '$ Costo financiero', tip: 'faCf', formato: 'pesos', campo: 'cf' },
  { clave: 'costoTotal', titulo: 'Costo total', tip: 'faCostoTotal', formato: 'pesos', campo: 'costoTotal' },
  { clave: 'pctContrib', titulo: '% Contribución', tip: 'faPctContrib', formato: 'proc' },
  { clave: 'contrib', titulo: '$ Contribución', tip: 'faContrib', formato: 'pesos', campo: 'contrib' },
  { clave: 'pctRent', titulo: '% Rentabilidad', tip: 'faPctRent', formato: 'proc' },
  { clave: 'rent', titulo: '$ Rentabilidad', tip: 'faRent', formato: 'pesos', campo: 'rent' },
  { clave: 'unidadEq', titulo: 'Unidad eq.', tip: 'faUnidadEq', formato: 'dec' },
];

function formatear(v: number | null | undefined, f: Formato): string {
  return f === 'pesos' ? fmtPesos(v) : f === 'proc' ? fmtProc(v, 2) : f === 'dec' ? fmtDec(v) : fmtEntero(v);
}

function Celda({ fila, col }: { fila: FacturaFila; col: Col }) {
  const dif = col.campo ? fila.difs.includes(col.campo) : false;
  const pl = col.campo ? fila.planilla?.[col.campo] : undefined;
  return (
    <td className={`py-1.5 pr-4 text-right tabular-nums ${dif ? 'text-amber-300' : 'text-slate-300'}`}>
      {formatear(fila[col.clave] as number | null, col.formato)}
      {dif && <div className="text-[11px] text-slate-500">planilla: {formatear(pl, col.formato)}</div>}
    </td>
  );
}

const pct = (a: number, b: number) => (b === 0 ? null : a / b);

function nombreMes(periodo: string): string {
  const [a, m] = periodo.split('-');
  return `${MESES[Number(m) - 1] ?? m} ${a}`;
}

function Delta({ odoo, planilla }: { odoo: number; planilla: number }) {
  const d = odoo - planilla;
  const chico = Math.abs(d) < 1;
  return <span className={chico ? 'text-slate-500' : d > 0 ? 'text-emerald-400' : 'text-rose-400'}>{chico ? '—' : `${d > 0 ? '+' : ''}${fmtPesos(d)}`}</span>;
}

function FacturacionInner() {
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [fuente, setFuente] = useState<FuenteCostos>('odoo');
  const q = `fuente=${fuente}${periodo ? `&mes=${periodo}` : ''}`;
  const query = useApiQuery<FacturacionResultado>(['finanzas-test-facturacion', q], `/api/finanzas-test/facturacion?${q}`);
  const data = query.data;
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [limite, setLimite] = useState(PASO);
  const reiniciar = () => setLimite(PASO);

  const filas = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return (data?.filas ?? []).filter((f) => {
      if (filtro === 'sin-costo') {
        if (f.costoUn !== null) return false;
      } else if (filtro !== 'todos' && f.estado !== filtro) return false;
      if (categoria && f.categoria !== categoria) return false;
      return !t || f.contacto.toLowerCase().includes(t) || f.codigo.toLowerCase().includes(t) || f.producto.toLowerCase().includes(t);
    });
  }, [data, busqueda, categoria, filtro]);

  const r = data?.resumen;
  const o = data?.totalOdoo;
  const pl = data?.totalPlanilla;
  const periodoActual = data?.periodo ?? periodo ?? '';
  // Meses para elegir: los de la planilla (se pueden comparar) + el mes actual de Odoo.
  const opcionesMes = useMemo(() => {
    const set = new Set(data?.mesesPlanilla ?? []);
    if (periodoActual) set.add(periodoActual);
    return [...set].sort().reverse();
  }, [data, periodoActual]);
  const sinPlanilla = data && !data.mesesPlanilla.includes(data.periodo);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            <Etq clave="faPeriodo">Mes</Etq>
            <select
              className={`${CLASE_INPUT} min-w-[11rem]`}
              value={periodoActual}
              onChange={(e) => {
                setPeriodo(e.target.value);
                reiniciar();
              }}
            >
              {(opcionesMes.length > 0 ? opcionesMes : [periodoActual]).filter(Boolean).map((m) => (
                <option key={m} value={m}>
                  {nombreMes(m)}
                </option>
              ))}
            </select>
          </label>
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
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{(query.error as Error).message}</p>}
      {sinPlanilla && <p className="rounded border border-sky-900 bg-sky-950/40 p-3 text-sm text-sky-200">La planilla no tiene datos de {nombreMes(data!.periodo)}: se muestra lo armado desde Odoo, sin comparación.</p>}

      {r && o && pl ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi tip="faKpiLineas" label="Líneas de factura" value={fmtEntero(r.lineasOdoo)} hint={sinPlanilla ? undefined : `planilla: ${fmtEntero(r.lineasPlanilla)}`} />
          <Kpi tip="faKpiSubtotal" label="Subtotal" value={fmtPesos(o.subtotal)} hint={sinPlanilla ? undefined : `planilla: ${fmtPesos(pl.subtotal)}`} />
          <Kpi tip="faKpiContribucion" label="Contribución" value={fmtPesos(o.contrib)} hint={`${fmtProc(pct(o.contrib, o.montoSinFlete), 1)} s/ monto s/flete${sinPlanilla ? '' : ` · planilla ${fmtProc(pct(pl.contrib, pl.montoSinFlete), 1)}`}`} />
          <Kpi tip="faKpiRentabilidad" label="Rentabilidad" value={fmtPesos(o.rent)} hint={`${fmtProc(pct(o.rent, o.subtotal), 1)} s/ subtotal${sinPlanilla ? '' : ` · planilla ${fmtProc(pct(pl.rent, pl.subtotal), 1)}`}`} />
          {!sinPlanilla && (
            <>
              <Kpi tip="faKpiCoinciden" label="Coinciden con la planilla" value={fmtEntero(r.coinciden)} tono="ok" hint={`${fmtProc(pct(r.coinciden, r.coinciden + r.difieren), 1)} de las que están en las dos`} />
              <Kpi tip="faKpiDifieren" label="Difieren" value={fmtEntero(r.difieren)} tono={r.difieren > 0 ? 'warn' : undefined} />
              <Kpi tip="faKpiSoloOdoo" label="Solo en Odoo" value={fmtEntero(r.soloOdoo)} tono="info" />
              <Kpi tip="faKpiSoloPlanilla" label="Solo en la planilla" value={fmtEntero(r.soloPlanilla)} />
            </>
          )}
          <Kpi tip="faKpiSinCosto" label="Sin costo completo" value={fmtEntero(r.sinCosto)} tono={r.sinCosto > 0 ? 'warn' : undefined} hint="no se inventa el dato" />
        </div>
      ) : (
        !query.error && <p className="text-sm text-slate-500">Armando la facturación desde Odoo (puede tardar unos segundos)…</p>
      )}

      {data && data.porCategoria.length > 0 && (
        <Panel titulo="Por categoría: Odoo vs planilla">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium"><Etq clave="faCategoriaTabla">Categoría</Etq></th>
                  <th className="py-2 pr-4 text-right font-medium">Líneas</th>
                  <th className="py-2 pr-4 text-right font-medium"><Etq clave="faSubtotal">Subtotal Odoo</Etq></th>
                  {!sinPlanilla && <th className="py-2 pr-4 text-right font-medium">Subtotal planilla</th>}
                  {!sinPlanilla && <th className="py-2 pr-4 text-right font-medium">Diferencia</th>}
                  <th className="py-2 pr-4 text-right font-medium"><Etq clave="faContrib">$ Contribución</Etq></th>
                  <th className="py-2 pr-4 text-right font-medium"><Etq clave="faPctContrib">% Contrib.</Etq></th>
                  <th className="py-2 pr-4 text-right font-medium"><Etq clave="faRent">$ Rentabilidad</Etq></th>
                  <th className="py-2 text-right font-medium"><Etq clave="faPctRent">% Rent.</Etq></th>
                </tr>
              </thead>
              <tbody>
                {data.porCategoria.map((c) => (
                  <tr key={c.categoria} className="border-b border-slate-800/60 text-slate-300">
                    <td className="py-1.5 pr-4">{c.categoria}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtEntero(c.odoo.lineas)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPesos(c.odoo.subtotal)}</td>
                    {!sinPlanilla && <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">{fmtPesos(c.planilla.subtotal)}</td>}
                    {!sinPlanilla && (
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        <Delta odoo={c.odoo.subtotal} planilla={c.planilla.subtotal} />
                      </td>
                    )}
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPesos(c.odoo.contrib)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtProc(pct(c.odoo.contrib, c.odoo.montoSinFlete), 1)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPesos(c.odoo.rent)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtProc(pct(c.odoo.rent, c.odoo.subtotal), 1)}</td>
                  </tr>
                ))}
                {o && pl && (
                  <tr className="border-t border-slate-700 font-medium text-slate-100">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtEntero(o.lineas)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtPesos(o.subtotal)}</td>
                    {!sinPlanilla && <td className="py-2 pr-4 text-right tabular-nums">{fmtPesos(pl.subtotal)}</td>}
                    {!sinPlanilla && (
                      <td className="py-2 pr-4 text-right tabular-nums">
                        <Delta odoo={o.subtotal} planilla={pl.subtotal} />
                      </td>
                    )}
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtPesos(o.contrib)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtProc(pct(o.contrib, o.montoSinFlete), 1)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtPesos(o.rent)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtProc(pct(o.rent, o.subtotal), 1)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        titulo="Líneas de factura"
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                reiniciar();
              }}
              placeholder="Buscar cliente, código o producto…"
              className={`${CLASE_INPUT} w-64`}
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
              <option value="todos">Todas</option>
              <option value="difiere">Difieren de la planilla</option>
              <option value="solo-odoo">Solo en Odoo</option>
              <option value="ok">Coinciden</option>
              <option value="sin-costo">Sin costo completo</option>
            </select>
            <button
              type="button"
              disabled={filas.length === 0}
              onClick={() =>
                descargarCsv(
                  `facturacion-productos-${periodoActual}.csv`,
                  ['Fecha de factura', 'Contacto', 'Producto/Código de barras', 'Producto', 'Producto s/opcional', 'Categoría', 'Grupo tela', ...COLS.map((c) => c.titulo), 'Estado vs planilla'],
                  filas.map((f) => [
                    f.fecha,
                    f.contacto,
                    f.codigo,
                    f.producto,
                    f.productoSinOpcional,
                    f.categoria,
                    f.grupoTela,
                    ...COLS.map((c) => f[c.clave] as number | null),
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
          <table className="w-full min-w-[3000px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium"><Etq clave="faFecha">Fecha</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="faContacto">Contacto</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="faCodigo">Código</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="faProducto">Producto</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="faCategoria">Categoría</Etq></th>
                <th className="py-2 pr-4 font-medium"><Etq clave="faGrupoTela">Grupo tela</Etq></th>
                {COLS.map((c) => (
                  <th key={c.clave} className="py-2 pr-4 text-right font-medium">
                    <Etq clave={c.tip}>{c.titulo}</Etq>
                  </th>
                ))}
                <th className="py-2 font-medium"><Etq clave="estado">vs planilla</Etq></th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, limite).map((f) => (
                <tr key={f.clave} className="border-b border-slate-800/60">
                  <td className="py-1.5 pr-4 whitespace-nowrap text-slate-400">{f.fecha.split('-').reverse().join('/')}</td>
                  <td className="py-1.5 pr-4 text-slate-300">{f.contacto}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs text-slate-400">{f.codigo || '—'}</td>
                  <td className="py-1.5 pr-4 text-slate-300">
                    {f.producto}
                    {f.avisos.length > 0 && (
                      <span className="ml-1 cursor-help text-amber-400" title={f.avisos.join('\n')}>
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-400">{f.categoria}</td>
                  <td className="py-1.5 pr-4 text-slate-400">{f.grupoTela || '—'}</td>
                  {COLS.map((c) => (
                    <Celda key={c.clave} fila={f} col={c} />
                  ))}
                  <td className="py-1.5">
                    {f.estado === 'ok' ? <Pildora tono="ok">coincide</Pildora> : f.estado === 'solo-odoo' ? <Pildora tono={sinPlanilla ? 'mute' : 'info'}>{sinPlanilla ? '—' : 'solo Odoo'}</Pildora> : <Pildora tono="warn">difiere</Pildora>}
                  </td>
                </tr>
              ))}
              {data && filas.length === 0 && (
                <tr>
                  <td colSpan={31} className="py-6 text-center text-slate-500">
                    Sin líneas para estos filtros.
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
              Mostrar todas
            </button>
          </div>
        )}
        {data && (
          <p className="mt-3 text-xs text-slate-500">
            Datos de Odoo al {fmtFechaHora(data.generado)}. Los costos son los vigentes en Odoo (no el histórico del mes), igual que la planilla. Pasá el mouse por cada encabezado para ver de
            dónde sale el dato. Los valores en ámbar difieren de la planilla (abajo se ve lo que ella dice). El ⚠ indica que a esa fila le falta un dato.
          </p>
        )}
      </Panel>
    </div>
  );
}

export default function FacturacionTestApp() {
  return (
    <QueryProvider>
      <FacturacionInner />
    </QueryProvider>
  );
}
