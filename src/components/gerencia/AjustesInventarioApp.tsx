import { Fragment, useState, type ReactNode } from 'react';
import { Bar, BarChart, Cell, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import KpiCard from '@/components/shared/KpiCard';
import Tip from '@/components/shared/Tip';
import { useChartTheme } from '@/components/shared/useChartTheme';
import { formatCompactCurrency, formatNumber } from './format';
import type { AjusteMes, AjustesInventarioResult } from '@/lib/odoo/ajustes-inventario';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function signClass(v: number): string {
  return v < 0 ? 'text-red-400' : v > 0 ? 'text-emerald-400' : 'text-slate-400';
}

type Modo = 'mes' | 'acumulado';

function sumarMeses(meses: AjusteMes[]): Omit<AjusteMes, 'mes'> {
  const z = { capas: 0, ingresoCantidad: 0, ingresoValor: 0, egresoCantidad: 0, egresoValor: 0, netoCantidad: 0, netoValor: 0, difCantidad: 0, movimientosConDiferencia: 0, movimientos: 0 };
  for (const m of meses) {
    z.capas += m.capas;
    z.ingresoCantidad += m.ingresoCantidad;
    z.ingresoValor += m.ingresoValor;
    z.egresoCantidad += m.egresoCantidad;
    z.egresoValor += m.egresoValor;
    z.netoCantidad += m.netoCantidad;
    z.netoValor += m.netoValor;
    z.difCantidad += m.difCantidad;
    z.movimientosConDiferencia += m.movimientosConDiferencia;
    z.movimientos += m.movimientos;
  }
  return z;
}

function MesChart({ title, tip, data, format, desde, hasta }: { title: string; tip: string; data: { mes: string; v: number }[]; format: 'currency' | 'number'; desde: number; hasta: number }) {
  const t = useChartTheme();
  const fmt = (v: number) => (format === 'currency' ? formatCompactCurrency(v) : formatNumber(v));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300"><Tip text={tip} className="cursor-help border-b border-dotted border-slate-500">{title}</Tip></h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={t.axis} fontSize={11} />
          <YAxis stroke={t.axis} fontSize={11} tickFormatter={(v) => fmt(Number(v))} width={64} />
          <ReferenceLine y={0} stroke={t.axis} />
          <Tooltip
            contentStyle={{ background: t.tooltipBg, border: `1px solid ${t.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: t.tooltipText }}
            itemStyle={{ color: t.tooltipText }}
            formatter={(value: number) => (format === 'currency' ? money.format(value) : qtyFmt.format(value))}
          />
          <Bar dataKey="v" name="Neto" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.v < 0 ? t.danger : t.secondary} fillOpacity={i >= desde && i <= hasta ? 1 : 0.3} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const pctNum = (v: number, base: number) => (base > 0 ? (v / base) * 100 : null);
const pctFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const OBJETIVO_COLOR = '#f59e0b';

/** Cumple si el desvío (en valor absoluto, sobrante o faltante) no pasa el objetivo. Sin objetivo o sin base → sin semáforo. */
function cumple(p: number | null, objetivo: number | null | undefined): boolean | null {
  return p === null || objetivo === null || objetivo === undefined ? null : Math.abs(p) <= objetivo;
}
function semaforoClass(ok: boolean | null, fallback: string): string {
  return ok === null ? fallback : ok ? 'text-emerald-400' : 'text-red-400';
}

function DesvioChart({ data, desde, hasta }: { data: { mes: string; desvio: number | null; objetivo: number | null }[]; desde: number; hasta: number }) {
  const t = useChartTheme();
  const rows = data.map((d) => ({ ...d, abs: d.desvio === null ? null : Math.abs(d.desvio) }));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">
        <Tip text={"Toma: $ neto de los ajustes de inventario (Odoo stock.valuation.layer, is_inventory) de cada mes ÷ $ de materia prima consumida en producción ese mes. Sigue el filtro de categoría y producto.\nObjetivo: hoja «Objetivos Inventario» del dashboard Equipo de gestión de Odoo (un valor por mes).\nCalcula: la barra es el desvío en valor absoluto (sobrante o faltante); verde si no pasa el objetivo, rojo si lo pasa. Las opacas son el período elegido."} className="cursor-help border-b border-dotted border-slate-500">
          Desvío % s/ materia prima vs objetivo
        </Tip>
      </h3>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={t.axis} fontSize={11} />
          <YAxis stroke={t.axis} fontSize={11} tickFormatter={(v) => `${pctFmt.format(Number(v))}%`} width={48} />
          <Tooltip
            contentStyle={{ background: t.tooltipBg, border: `1px solid ${t.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: t.tooltipText }}
            itemStyle={{ color: t.tooltipText }}
            formatter={(value: number, name: string, item) => [
              name === 'abs' ? `${pctFmt.format(item.payload.desvio)}% (absoluto ${pctFmt.format(value)}%)` : `${pctFmt.format(value)}%`,
              name === 'abs' ? 'Desvío' : 'Objetivo',
            ]}
          />
          <Bar dataKey="abs" name="abs" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((d, i) => (
              <Cell key={i} fill={cumple(d.desvio, d.objetivo) === false ? t.danger : t.secondary} fillOpacity={i >= desde && i <= hasta ? 1 : 0.3} />
            ))}
          </Bar>
          <Line dataKey="objetivo" name="objetivo" type="stepAfter" stroke={OBJETIVO_COLOR} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-slate-500">Línea punteada: objetivo del mes.</p>
    </div>
  );
}

function ProductosMes({ data, mes }: { data: AjustesInventarioResult; mes: string }) {
  const rows = data.productosPorMes[mes] ?? [];
  const omitidos = data.productosOmitidos[mes] ?? 0;
  return (
    <div className="overflow-x-auto bg-slate-950/40 p-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <Th tip={"Odoo: producto de la capa de valoración (product.product)."} className="py-1 pr-3 font-medium">Producto</Th>
            <Th tip={"Odoo: categoría del producto (product.category)."} className="py-1 pr-3 font-medium">Categoría</Th>
            <Th tip={"Odoo: unidad de medida del producto (uom_id)."} className="py-1 pr-3 font-medium">UdM</Th>
            <Th tip={"Toma: capas de valoración de ajuste del producto en el mes.\nCalcula: ingresos + egresos, en la UdM del producto."} className="py-1 pr-3 text-right font-medium">Cant. neta</Th>
            <Th tip={"Calcula: $ (+) + $ (−). Es lo que el ajuste suma o resta al inventario valorizado."} className="py-1 pr-3 text-right font-medium">$ neto</Th>
            <Th tip={"Toma: Odoo stock.move.line (Inventario > Reportes > Historial de movimientos).\nCalcula: unidades en que la suma de las capas de un movimiento no coincide con la cantidad del historial."} className="py-1 pr-3 text-right font-medium">Dif. vs historial</Th>
            <Th tip={"Calcula: movimientos de ajuste cuya cantidad en Valoración no coincide con el Historial ÷ total de movimientos del mes.\nSe compara contra todas las capas del movimiento, no solo las del mes."} className="py-1 text-right font-medium">Mov. con dif.</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.productId} className="border-t border-slate-800">
              <td className="py-1 pr-3 text-slate-200">{p.producto}</td>
              <td className="py-1 pr-3 text-slate-400">{p.categoria}</td>
              <td className="py-1 pr-3 text-slate-400">{p.uom}</td>
              <td className={`py-1 pr-3 text-right tabular-nums ${signClass(p.netoCantidad)}`}>{qtyFmt.format(p.netoCantidad)}</td>
              <td className={`py-1 pr-3 text-right tabular-nums ${signClass(p.netoValor)}`}>{money.format(p.netoValor)}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-slate-300">{qtyFmt.format(p.difCantidad)}</td>
              <td className={`py-1 text-right tabular-nums ${p.movimientosConDiferencia ? 'text-amber-400' : 'text-slate-500'}`}>{p.movimientosConDiferencia}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {omitidos > 0 && <p className="mt-2 text-[10px] text-slate-500">Se muestran los {rows.length} productos de mayor $ neto; {omitidos} más quedan fuera.</p>}
    </div>
  );
}

function Th({ tip, className = '', children }: { tip: string; className?: string; children: ReactNode }) {
  return (
    <th className={className}>
      <Tip text={tip} className="cursor-help border-b border-dotted border-slate-500">
        {children}
      </Tip>
    </th>
  );
}

function CategoriasMulti({ opciones, sel, onChange }: { opciones: string[]; sel: string[]; onChange: (next: string[]) => void }) {
  const label = sel.length === 0 ? 'Todas las categorías' : sel.length === 1 ? sel[0]! : `${sel.length} categorías`;
  const toggle = (c: string) => onChange(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]);
  return (
    <details className="relative shrink-0">
      <summary
        aria-label="Categorías de producto"
        title={sel.length > 0 ? sel.join(', ') : 'Podés marcar varias categorías'}
        className="w-52 cursor-pointer list-none truncate rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
      >
        {label} ▾
      </summary>
      <div className="absolute z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded border border-slate-700 bg-slate-950 p-1 shadow-lg">
        <button type="button" onClick={() => onChange([])} className="w-full rounded px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100">
          Todas las categorías (quitar selección)
        </button>
        {opciones.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800">
            <input type="checkbox" checked={sel.includes(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </div>
    </details>
  );
}

const pct = (v: number, base: number) => (base > 0 ? `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format((v / base) * 100)}%` : '—');

function PctCard({ label, text, valor, ok = null, sub }: { label: string; text: string; valor: number; ok?: boolean | null; sub?: string }) {
  return (
    <div className="h-full rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${semaforoClass(ok, signClass(valor))}`}>{text}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function AjustesInner() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('mes');
  // Sin selección = resumen de todo el año.
  const [mesSel, setMesSel] = useState<number | null>(null);
  const [desdeSel, setDesdeSel] = useState<number | null>(null);
  const [hastaSel, setHastaSel] = useState<number | null>(null);
  // Filtros de producto: vacíos = se muestra todo.
  const [categorias, setCategorias] = useState<string[]>([]);
  const [productoTxt, setProductoTxt] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const qs = new URLSearchParams({ year: String(year) });
  for (const c of categorias) qs.append('categoria', c);
  if (productId !== null) qs.set('productId', String(productId));
  const query = useApiQuery<AjustesInventarioResult>(['ajustes-inventario', year, categorias, productId], `/api/ajustes-inventario?${qs.toString()}`);
  const data = query.data;
  const productosOpc = (data?.opciones.productos ?? []).filter((p) => categorias.length === 0 || categorias.includes(p.categoria));
  const hayFiltroProducto = categorias.length > 0 || productoTxt !== '' || productId !== null;
  const limpiarProducto = () => {
    setCategorias([]);
    setProductoTxt('');
    setProductId(null);
  };
  const desde = modo === 'mes' ? (mesSel ?? 0) : (desdeSel ?? 0);
  const hasta = modo === 'mes' ? (mesSel ?? 11) : (hastaSel ?? 11);
  const hayFiltro = modo === 'mes' ? mesSel !== null : desdeSel !== null || hastaSel !== null;
  const periodo = !hayFiltro ? `Año ${year}` : desde === hasta ? `${MESES[desde]} ${year}` : `${MESES[desde]}–${MESES[hasta]} ${year}`;
  const limpiar = () => {
    setMesSel(null);
    setDesdeSel(null);
    setHastaSel(null);
  };
  const sel = data ? sumarMeses(data.mensual.slice(desde, hasta + 1)) : undefined;
  const enRango = (i: number) => i >= desde && i <= hasta;
  const baseMp = data ? data.base.materiaPrima.slice(desde, hasta + 1).reduce((a, v) => a + v, 0) : 0;
  const baseFact = data ? data.base.facturacion.slice(desde, hasta + 1).reduce((a, v) => a + v, 0) : 0;
  const objetivosSel = data ? data.base.objetivo.slice(desde, hasta + 1).filter((o): o is number => o !== null) : [];
  const objetivoSel = objetivosSel.length ? objetivosSel.reduce((a, v) => a + v, 0) / objetivosSel.length : null;
  const categoriasSel = (data?.categorias ?? [])
    .map((c) => ({ ...c, totalSel: c.netoValor.slice(desde, hasta + 1).reduce((a, v) => a + v, 0) }))
    .sort((a, b) => Math.abs(b.totalSel) - Math.abs(a.totalSel));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400" htmlFor="aj-year">Año</label>
          <select
            id="aj-year"
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value);
              setYear(y);
              setAbierto(null);

            }}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
          >
            {[thisYear + 1, thisYear, thisYear - 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded border border-slate-700 text-xs">
            {(['mes', 'acumulado'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setModo(m);
                  limpiar();
                }}
                className={`px-3 py-1 ${modo === m ? 'bg-slate-700 text-slate-100' : 'bg-slate-950 text-slate-400 hover:text-slate-200'}`}
              >
                {m === 'mes' ? 'Mes' : 'Acumulado'}
              </button>
            ))}
          </div>
          {modo === 'mes' ? (
            <select aria-label="Mes" value={mesSel ?? ''} onChange={(e) => setMesSel(e.target.value === '' ? null : Number(e.target.value))} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200">
              <option value="">Todo el año</option>
              {MESES.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
            </select>
          ) : (
            <>
              <span className="text-xs text-slate-400">de</span>
              <select
                aria-label="Desde"
                value={desdeSel ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setDesdeSel(v);
                  if (v !== null && hastaSel !== null && v > hastaSel) setHastaSel(v);
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
              >
                <option value="">Inicio</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <span className="text-xs text-slate-400">a</span>
              <select
                aria-label="Hasta"
                value={hastaSel ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setHastaSel(v);
                  if (v !== null && desdeSel !== null && v < desdeSel) setDesdeSel(v);
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
              >
                <option value="">Fin</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
            </>
          )}
                      <button
              disabled={!hayFiltro}
              type="button"
              onClick={limpiar}
              aria-label="Quitar selección y ver todo el año"
              title="Quitar selección y ver todo el año"
              className={`rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-400 hover:text-slate-100 ${hayFiltro ? '' : 'invisible'}`}
            >
              ✕
            </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CategoriasMulti
            opciones={data?.opciones.categorias ?? []}
            sel={categorias}
            onChange={(next) => {
              setCategorias(next);
              // Si el producto elegido no es de las categorías elegidas, se descarta.
              const actual = data?.opciones.productos.find((p) => p.id === productId);
              if (next.length > 0 && actual && !next.includes(actual.categoria)) {
                setProductId(null);
                setProductoTxt('');
              }
            }}
          />
          <input
            aria-label="Producto"
            list="aj-productos"
            value={productoTxt}
            placeholder="Todos los productos (escribí para buscar)"
            onChange={(e) => {
              const v = e.target.value;
              setProductoTxt(v);
              const match = productosOpc.find((p) => p.nombre === v);
              setProductId(match ? match.id : null);
            }}
            className="w-64 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <datalist id="aj-productos">
            {productosOpc.map((p) => (
              <option key={p.id} value={p.nombre} />
            ))}
          </datalist>
                      <button
              disabled={!hayFiltroProducto}
              type="button"
              onClick={limpiarProducto}
              aria-label="Quitar filtros de categoría y producto"
              title="Quitar filtros de categoría y producto"
              className={`rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-400 hover:text-slate-100 ${hayFiltroProducto ? '' : 'invisible'}`}
            >
              ✕
            </button>
        </div>
        <div className="ml-auto"><LastUpdated dataUpdatedAt={query.dataUpdatedAt} /></div>
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tip
              text={`Calcula: $ neto ajustado de ${periodo} ÷ $ de materia prima consumida en producción en el mismo período (${money.format(baseMp)}).
Base: Odoo stock.valuation.layer de movimientos de consumo de órdenes de fabricación (raw_material_production_id), productos de Materia Prima.
Objetivo: hoja «Objetivos Inventario» del dashboard Equipo de gestión de Odoo (promedio de los meses del período). Verde si el desvío, en valor absoluto, no lo pasa.
La base no cambia con el filtro de categoría o producto.`}
              className="block h-full cursor-help"
            >
              <PctCard label={`Desvío s/ materia prima producida · ${periodo}`} text={pct(sel!.netoValor, baseMp)} valor={sel!.netoValor} ok={cumple(pctNum(sel!.netoValor, baseMp), objetivoSel)} sub={objetivoSel === null ? undefined : `Objetivo: ${pctFmt.format(objetivoSel)}%`} />
            </Tip>
            <Tip
              text={`Calcula: $ neto ajustado de ${periodo} ÷ facturación total del mismo período (${money.format(baseFact)}).
Base: la misma de Gerencia > Facturación (Odoo account.move.line de facturas y NC posteadas, sin IVA; las NC reales restan).
No cambia con el filtro de categoría o producto.`}
              className="block h-full cursor-help"
            >
              <PctCard label={`Desvío s/ facturación · ${periodo}`} text={pct(sel!.netoValor, baseFact)} valor={sel!.netoValor} />
            </Tip>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tip text={`Toma: Odoo: stock.valuation.layer (Inventario > Reportes > Valoración) de movimientos con is_inventory = true (ajustes de inventario) de ${periodo}, por create_date.\nCalcula: suma del valor ($) de todas las capas del período (ingresos + egresos).`} className="block cursor-help"><KpiCard label={`$ neto ajustado · ${periodo}`} value={sel!.netoValor} format="currency" /></Tip>
            <Tip text={`Toma: las mismas capas de ajuste de Valoración.\nCalcula: suma de cantidades del período. Mezcla kg, unidades y metros: mirá la UdM en el detalle por producto.`} className="block cursor-help"><KpiCard label="Unidades netas ajustadas" value={sel!.netoCantidad} /></Tip>
            <Tip text={`Toma: capas de ajuste de Valoración que ingresan stock.\nCalcula: suma del valor ($) del período.`} className="block cursor-help"><KpiCard label="$ ingresos (+)" value={sel!.ingresoValor} format="currency" /></Tip>
            <Tip text={`Toma: capas de ajuste de Valoración que sacan stock.\nCalcula: suma del valor ($) del período.`} className="block cursor-help"><KpiCard label="$ egresos (−)" value={sel!.egresoValor} format="currency" /></Tip>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MesChart title="$ neto por mes" tip={"Toma: Odoo stock.valuation.layer de ajustes de inventario (is_inventory = true), por mes de create_date.\nCalcula: suma del valor ($) de las capas del mes (ingresos + egresos). Las barras opacas son el período elegido."} data={data.mensual.map((m, i) => ({ mes: MESES[i]!, v: m.netoValor }))} format="currency" desde={desde} hasta={hasta} />
            <MesChart title="Unidades netas por mes" tip={"Toma: las mismas capas de ajuste de Valoración.\nCalcula: suma de cantidades del mes (ingresos + egresos). Mezcla kg, unidades y metros."} data={data.mensual.map((m, i) => ({ mes: MESES[i]!, v: m.netoCantidad }))} format="number" desde={desde} hasta={hasta} />
          </div>

          <DesvioChart data={data.mensual.map((m, i) => ({ mes: MESES[i]!, desvio: pctNum(m.netoValor, data.base.materiaPrima[i]!), objetivo: data.base.objetivo[i] ?? null }))} desde={desde} hasta={hasta} />

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <Th tip={"Mes de la capa de valoración (create_date), igual que el reporte Inventario > Reportes > Valoración."} className="p-3 font-medium">Mes</Th>
                  <Th tip={"Toma: Odoo: stock.valuation.layer (Inventario > Reportes > Valoración) de movimientos con is_inventory = true (ajustes de inventario), por mes de create_date.\nCalcula: suma de las cantidades positivas (ingresos de stock)."} className="p-3 text-right font-medium">Unid. (+)</Th>
                  <Th tip={"Toma: Odoo: stock.valuation.layer (Inventario > Reportes > Valoración) de movimientos con is_inventory = true (ajustes de inventario), por mes de create_date.\nCalcula: suma del valor ($) de las capas que ingresan stock."} className="p-3 text-right font-medium">$ (+)</Th>
                  <Th tip={"Toma: Odoo: stock.valuation.layer (Inventario > Reportes > Valoración) de movimientos con is_inventory = true (ajustes de inventario), por mes de create_date.\nCalcula: suma de las cantidades negativas (egresos de stock)."} className="p-3 text-right font-medium">Unid. (−)</Th>
                  <Th tip={"Toma: Odoo: stock.valuation.layer (Inventario > Reportes > Valoración) de movimientos con is_inventory = true (ajustes de inventario), por mes de create_date.\nCalcula: suma del valor ($) de las capas que sacan stock."} className="p-3 text-right font-medium">$ (−)</Th>
                  <Th tip={"Calcula: Unid. (+) + Unid. (−). Es el saldo del ajuste del mes. Mezcla kg, unidades y metros."} className="p-3 text-right font-medium">Unid. netas</Th>
                  <Th tip={"Calcula: $ (+) + $ (−). Es lo que el ajuste suma o resta al inventario valorizado."} className="p-3 text-right font-medium">$ neto</Th>
                  <Th tip={"Calcula: $ neto del mes ÷ $ de materia prima consumida en producción ese mes.\nBase: Odoo stock.valuation.layer de movimientos de consumo de órdenes de fabricación (raw_material_production_id), productos de Materia Prima, en valor absoluto."} className="p-3 text-right font-medium">% s/ MP</Th>
                  <Th tip={"Objetivo de desvío del mes: hoja «Objetivos Inventario» del dashboard Equipo de gestión de Odoo.\nSe compara contra el valor absoluto del % s/ MP: verde si no lo pasa, rojo si lo pasa."} className="p-3 text-right font-medium">Objetivo</Th>
                  <Th tip={"Calcula: $ neto del mes ÷ facturación total del mes.\nBase: la misma de Gerencia > Facturación (account.move.line de facturas y NC posteadas, sin IVA; las NC reales restan)."} className="p-3 text-right font-medium">% s/ fact.</Th>
                  <Th tip={"Toma: Odoo stock.move.line (Inventario > Reportes > Historial de movimientos).\nCalcula: unidades en que la suma de las capas de un movimiento no coincide con la cantidad del historial."} className="p-3 text-right font-medium">Dif. vs historial</Th>
                  <Th tip={"Calcula: movimientos de ajuste cuya cantidad en Valoración no coincide con el Historial ÷ total de movimientos del mes.\nSe compara contra todas las capas del movimiento, no solo las del mes."} className="p-3 text-right font-medium">Mov. con dif.</Th>
                </tr>
              </thead>
              <tbody>
                {data.mensual.map((m, i) => (
                  <Fragment key={m.mes}>
                    <tr
                      className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/40 ${m.capas === 0 ? 'text-slate-600' : enRango(i) ? '' : 'opacity-40'}`}
                      onClick={() => m.capas > 0 && setAbierto(abierto === m.mes ? null : m.mes)}
                    >
                      <td className="p-3 font-medium text-slate-200">{abierto === m.mes ? '▾' : '▸'} {MESES[i]}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-400">{qtyFmt.format(m.ingresoCantidad)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-400">{money.format(m.ingresoValor)}</td>
                      <td className="p-3 text-right tabular-nums text-red-400">{qtyFmt.format(m.egresoCantidad)}</td>
                      <td className="p-3 text-right tabular-nums text-red-400">{money.format(m.egresoValor)}</td>
                      <td className={`p-3 text-right tabular-nums font-medium ${signClass(m.netoCantidad)}`}>{qtyFmt.format(m.netoCantidad)}</td>
                      <td className={`p-3 text-right tabular-nums font-medium ${signClass(m.netoValor)}`}>{money.format(m.netoValor)}</td>
                      <td className={`p-3 text-right tabular-nums ${semaforoClass(cumple(pctNum(m.netoValor, data.base.materiaPrima[i]!), data.base.objetivo[i]), signClass(m.netoValor))}`}>{pct(m.netoValor, data.base.materiaPrima[i]!)}</td>
                      <td className="p-3 text-right tabular-nums text-amber-400">{data.base.objetivo[i] === null ? '—' : `${pctFmt.format(data.base.objetivo[i]!)}%`}</td>
                      <td className={`p-3 text-right tabular-nums ${signClass(m.netoValor)}`}>{pct(m.netoValor, data.base.facturacion[i]!)}</td>
                      <td className="p-3 text-right tabular-nums text-slate-300">{qtyFmt.format(m.difCantidad)}</td>
                      <td className={`p-3 text-right tabular-nums ${m.movimientosConDiferencia ? 'text-amber-400' : 'text-slate-500'}`}>
                        {m.movimientosConDiferencia} / {m.movimientos}
                      </td>
                    </tr>
                    {abierto === m.mes && (
                      <tr>
                        <td colSpan={12} className="p-0">
                          <ProductosMes data={data} mes={m.mes} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="border-t-2 border-slate-700 font-semibold">
                  <td className="p-3 text-slate-200">Total {periodo}</td>
                  <td className="p-3 text-right tabular-nums text-emerald-400">{qtyFmt.format(sel!.ingresoCantidad)}</td>
                  <td className="p-3 text-right tabular-nums text-emerald-400">{money.format(sel!.ingresoValor)}</td>
                  <td className="p-3 text-right tabular-nums text-red-400">{qtyFmt.format(sel!.egresoCantidad)}</td>
                  <td className="p-3 text-right tabular-nums text-red-400">{money.format(sel!.egresoValor)}</td>
                  <td className={`p-3 text-right tabular-nums ${signClass(sel!.netoCantidad)}`}>{qtyFmt.format(sel!.netoCantidad)}</td>
                  <td className={`p-3 text-right tabular-nums ${signClass(sel!.netoValor)}`}>{money.format(sel!.netoValor)}</td>
                  <td className={`p-3 text-right tabular-nums ${semaforoClass(cumple(pctNum(sel!.netoValor, baseMp), objetivoSel), signClass(sel!.netoValor))}`}>{pct(sel!.netoValor, baseMp)}</td>
                  <td className="p-3 text-right tabular-nums text-amber-400">{objetivoSel === null ? '—' : `${pctFmt.format(objetivoSel)}%`}</td>
                  <td className={`p-3 text-right tabular-nums ${signClass(sel!.netoValor)}`}>{pct(sel!.netoValor, baseFact)}</td>
                  <td className="p-3 text-right tabular-nums text-slate-300">{qtyFmt.format(sel!.difCantidad)}</td>
                  <td className="p-3 text-right tabular-nums text-slate-300">{sel!.movimientosConDiferencia} / {sel!.movimientos}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="-mt-3 text-[10px] text-slate-500">
            Tocá un mes para ver el detalle por producto. «Mov. con dif.» cuenta los movimientos donde el total de Valoración no coincide con la cantidad del
            Historial de movimientos (se compara contra todas las capas del movimiento, porque Odoo genera capas nuevas al editar un movimiento hecho);
            «Dif. vs historial» son las unidades de esa diferencia. Las unidades suman distintas UdM (kg, unidades, metros):
            mirá la UdM en el detalle por producto.
          </p>

          <div>
            <h3 className="mb-3 border-b border-slate-800 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500"><Tip text={"Toma: Odoo stock.valuation.layer de ajustes de inventario, agrupado por la categoría del producto (product.category).\nCalcula: suma del valor ($) por categoría y mes. El total es la suma de los meses del período elegido."} className="cursor-help border-b border-dotted border-slate-500">$ neto por categoría</Tip></h3>
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <Th tip={"Odoo: categoría del producto (product.category)."} className="p-2 font-medium">Categoría</Th>
                    {MESES.map((m) => (
                      <th key={m} className="p-2 text-right font-medium">{m}</th>
                    ))}
                    <Th tip={"Calcula: suma de los meses del período elegido."} className="p-2 text-right font-medium">Total {periodo}</Th>
                  </tr>
                </thead>
                <tbody>
                  {categoriasSel.map((c) => (
                    <tr key={c.categoria} className="border-t border-slate-800">
                      <td className="p-2 text-slate-200">{c.categoria}</td>
                      {c.netoValor.map((v, i) => (
                        <td key={i} className={`p-2 text-right tabular-nums ${v === 0 ? 'text-slate-600' : signClass(v)} ${enRango(i) ? '' : 'opacity-40'}`}>{v === 0 ? '·' : formatCompactCurrency(v)}</td>
                      ))}
                      <td className={`p-2 text-right font-medium tabular-nums ${signClass(c.totalSel)}`}>{formatCompactCurrency(c.totalSel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.anomalos.length > 0 && (
            <details className="rounded-lg border border-amber-900 bg-amber-950/30 p-4">
              <summary className="cursor-pointer text-sm font-medium text-amber-300">
                Capas con valores imposibles (excluidas de los totales) · {data.anomalos.length}
              </summary>
              <p className="mt-2 text-xs text-slate-400">
                Cantidades o importes absurdos que quedaron en Odoo (error viejo del sistema) y que romperían cualquier suma.
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-300">
                {data.anomalos.map((a, i) => (
                  <li key={i}>
                    {a.fecha.slice(0, 10)} · {a.producto} · {a.movimiento} · cant. {a.cantidad.toExponential(2)} · $ {a.valor.toExponential(2)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export default function AjustesInventarioApp() {
  return (
    <QueryProvider>
      <AjustesInner />
    </QueryProvider>
  );
}
