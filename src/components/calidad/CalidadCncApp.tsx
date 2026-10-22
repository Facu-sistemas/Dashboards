import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import Tip from '../shared/Tip';
import { monthsBetween } from '../../lib/date';
import type { CncData } from '../../lib/odoo/calidad-cnc';
import CncPanel, { type PuntoMes } from './CncPanel';
import { IMPORTE_MINIMO, PARAMETROS, type ParametroNota } from './calidad-demo-data';

/** Primer mes con el criterio nuevo de motivo/nota en Odoo. */
const PRIMER_MES = '2026-10';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesLabel = (k: string) => {
  const [y, m] = k.split('-').map(Number);
  return `${MESES[m! - 1]} ${y}`;
};

/** Mayúsculas y sin tildes, para cruzar la nota de Odoo ("Garantía real") con el parámetro ("GARANTIA REAL"). */
const clave = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
const ALIAS: Record<string, string> = { 'SERVICIO POST VENTA': 'SERVI POS VENTA' };
const claveNota = (t: string) => ALIAS[clave(t)] ?? clave(t);

/** Parámetro editable de una nota. `pct` es el % del importe que se pierde (garantías, acuerdos). */
interface ParamEdit {
  cuenta: boolean;
  flete: boolean;
  horas: number;
  pct: number;
}

const DUENOS = ['Producción', 'Comercial', 'Logística', 'Finanzas'] as const;
type Dueno = (typeof DUENOS)[number];

/** Sección plegable: el título es el botón que muestra u oculta el contenido. */
function Acordeon({ titulo, resumen, children }: { titulo: string; resumen?: string; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <section className="rounded-lg border border-slate-700">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-200">{titulo}</span>
        <span className="flex items-center gap-3 text-xs text-slate-400">
          {resumen && <span>{resumen}</span>}
          <span aria-hidden className={`transition-transform ${abierto ? 'rotate-180' : ''}`}>▾</span>
        </span>
      </button>
      {abierto && <div className="border-t border-slate-700 p-4">{children}</div>}
    </section>
  );
}

const money = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const pctFmt = (n: number, d = 2) => `${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: d })}%`;

/**
 * Modelo nuevo de pérdida por nota de crédito:
 *   % del importe (garantías/acuerdos) + flete extra (importe × % flete del cliente, si la nota lleva flete)
 *   + horas del caso × valor hora − recupero.
 * El "10%" viejo del parámetro era el flete: ahora es el Sí/No de flete + el % de flete del cliente.
 */
function perdida(
  importe: number,
  recupero: number,
  p: ParamEdit,
  fletePct: number,
  valorHora: number,
): { base: number; flete: number; horas: number; total: number } {
  const base = importe * p.pct;
  const flete = p.flete ? importe * fletePct : 0;
  const horas = p.horas * valorHora;
  return { base, flete, horas, total: Math.max(0, base + flete + horas - recupero) };
}

/** Parámetros de la empresa tal cual vienen del archivo. Solo las notas que se pierden enteras conservan %; el 10% viejo era flete. */
const paramsPorDefecto = (): Record<string, ParamEdit> =>
  Object.fromEntries(
    PARAMETROS.map((p: ParametroNota) => [p.nota, { cuenta: p.cuenta, flete: p.flete, horas: p.horas, pct: p.pct >= 1 ? 1 : 0 }]),
  );

interface ParametrosGuardados {
  disponible: boolean;
  params: Record<string, ParamEdit>;
}

function Th({ tip, className = '', children }: { tip: string; className?: string; children: ReactNode }) {
  return (
    <th className={`px-3 py-2 ${className}`}>
      <Tip text={tip} className="cursor-help border-b border-dotted border-slate-500">
        {children}
      </Tip>
    </th>
  );
}

function Kpi({ label, value, sub, tip }: { label: string; value: string; sub?: string; tip: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <Tip text={tip} className="cursor-help text-xs uppercase tracking-wide text-slate-400">
        <span className="border-b border-dotted border-slate-500">{label}</span>
      </Tip>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const T = {
  nc: 'Cantidad de notas de crédito del mes con motivo o nota cargados.\nOdoo: account.move, move_type = out_refund, posteadas, por invoice_date.',
  cuentan: 'NC cuya nota tiene "¿Cuenta?" = Sí y con importe ≥ $1.000.\nSERVI POS VENTA y N/C POR DESCUENTO no cuentan.',
  cnc: 'Suma de la pérdida de cada NC que cuenta:\nimporte × % importe + importe × % flete cliente (si lleva flete) + horas × valor hora − recupero (mínimo 0).',
  cncPct: 'CNC ponderado ÷ facturación neta del mes.\nFacturación neta: Odoo account.move.amount_untaxed_signed de facturas y NC posteadas del mes (las NC restan).',
  inc: 'NC que cuentan ÷ pedidos entregados × 100.\nPedidos entregados: stock.picking de salida en estado hecho (date_done) del mes.',
  rec: 'Suma del recupero de las NC que cuentan (cobro al camionero, outlet, reproceso, cargo al cliente).\nNo está en Odoo: se carga a mano en el detalle (no se guarda).',
  motivo: 'Motivo de la nota (Odoo: account.move.x_studio_motivo_1). Parámetro de la empresa.',
  nota: 'Nota de N/C cargada en la NC. Odoo: account.move.x_studio_nota.',
  cuenta: 'Si la nota suma o no al CNC (editable). Arranca con el parámetro de la empresa.',
  flete: 'Parámetro Sí/No. Si es Sí, a la pérdida se le suma importe × % flete del cliente.\n% flete: región de cada cliente en Odoo (res.partner.region_id, "CORDOBA - 5%"); si no tiene, el % de respaldo.',
  horas: 'Horas que se estiman por caso de este tipo de nota (autorizadas). Pérdida por horas = horas × valor hora.\nValor hora: precio de venta de SERVICIO DE REPARACION en Odoo (editable arriba).',
  pct: '% del importe de la NC que se considera pérdida (100% en garantías y acuerdo comercial; 0% en el resto).',
  dueno: 'Área responsable de la nota. Parámetro de la empresa (Parametros col. H).',
  cant: 'Cantidad de NC de esa nota en el mes (Registro_NC).',
  bruta: 'Suma del importe sin impuestos de las NC (valor absoluto). Odoo: account.move.amount_untaxed.',
  fleteCol: 'Importe × % flete del cliente, solo si la nota lleva flete y la NC cuenta.',
  horasCol: 'Horas por caso × valor hora, por cada NC que cuenta.',
  perdida: 'Importe × % importe + flete + horas × valor hora − recupero, con piso en 0.\nSolo para NC que cuentan en CNC.',
  fecha: 'Fecha de la NC. Odoo: account.move.invoice_date.',
  nnc: 'Número de la nota de crédito. Odoo: account.move.name.',
  cliente: 'Cliente de la NC. Odoo: account.move.partner_id.',
  importe: 'Importe sin impuestos. Odoo: account.move.amount_untaxed (valor absoluto).',
  recupero: 'Lo recuperado de esa NC (cobro al camionero, outlet, reproceso). No está en Odoo: se carga a mano acá.',
};

const inputCls =
  'w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right text-sm text-slate-100';

function Body({
  data,
  selector,
  meses,
  params,
  setParam,
  estadoGuardado,
}: {
  data: CncData;
  selector: ReactNode;
  meses: CncData[];
  params: Record<string, ParamEdit>;
  setParam: (nota: string, patch: Partial<ParamEdit>) => void;
  estadoGuardado: ReactNode;
}) {
  // Valor hora: arranca con el precio de venta de "SERVICIO DE REPARACION" en Odoo; se puede pisar para simular. % flete: el de la región de cada cliente; este es el de respaldo.
  const [valorHora, setValorHora] = useState(data.valorHora);
  const [dueno, setDueno] = useState<'Todos' | Dueno>('Todos');
  // Nota elegida en la tabla de parámetros: filtra el detalle de abajo (misma nota, a nivel de cada NC).
  const [notaSel, setNotaSel] = useState<string | null>(null);
  const [fletePct, setFletePct] = useState(5);
  // El recupero no está en Odoo todavía: se carga a mano por NC (no se guarda).
  const [recuperos, setRecuperos] = useState<Record<number, number>>({});
  const calc = useMemo(() => {
    const info = new Map(PARAMETROS.map((p) => [claveNota(p.nota), p]));
    const filas = data.notas.map((n) => {
      const meta = info.get(claveNota(n.nota));
      const p = meta ? params[meta.nota] : undefined;
      const cuenta = !!p?.cuenta && n.importe >= IMPORTE_MINIMO;
      const recupero = recuperos[n.id] ?? 0;
      const r = cuenta && p ? perdida(n.importe, recupero, p, (n.fletePct ?? fletePct) / 100, valorHora) : null;
      return { ...n, meta, cuenta, recupero, r };
    });
    const sinClasificar = filas.filter((x) => !x.meta).length;
    const delDueno = (m?: ParametroNota) => dueno === 'Todos' || m?.dueno === dueno;
    const porNotaTodas = PARAMETROS.map((meta) => {
      const f = filas.filter((x) => x.meta === meta);
      const cuentan = f.filter((x) => x.cuenta);
      const sum = (k: 'base' | 'flete' | 'horas' | 'total') => cuentan.reduce((s, x) => s + (x.r?.[k] ?? 0), 0);
      return {
        meta,
        cant: f.length,
        bruto: f.reduce((s, x) => s + x.importe, 0),
        cuentan: cuentan.length,
        base: sum('base'),
        flete: sum('flete'),
        horas: sum('horas'),
        total: sum('total'),
      };
    });
    // El filtro por dueño recorta KPIs, parámetros y detalle; las barras "Por dueño" siguen mostrando a todos.
    const porNota = porNotaTodas.filter((x) => delDueno(x.meta));
    const filasVis = filas.filter((x) => (dueno === 'Todos' ? true : !!x.meta && delDueno(x.meta)));
    const total = porNota.reduce((s, x) => s + x.total, 0);
    const porDueno = DUENOS.map((d) => {
      const filasD = porNotaTodas.filter((x) => x.meta.dueno === d && params[x.meta.nota]?.cuenta);
      return { dueno: d, cant: filasD.reduce((s, x) => s + x.cuentan, 0), total: filasD.reduce((s, x) => s + x.total, 0) };
    });
    const incidencias = porNota.reduce((s, x) => s + x.cuentan, 0);
    return {
      filas: filasVis,
      sinClasificar: dueno === 'Todos' ? sinClasificar : 0,
      porNota,
      porDueno,
      total,
      incidencias,
      brutoTotal: filasVis.reduce((s, x) => s + x.importe, 0),
      brutoCnc: filasVis.filter((x) => x.cuenta).reduce((s, x) => s + x.importe, 0),
      recupero: filasVis.filter((x) => x.cuenta).reduce((s, x) => s + x.recupero, 0),
    };
  }, [data, params, recuperos, fletePct, valorHora, dueno]);

  // Un punto por mes con datos: total por dueño y % de la facturación, con los mismos parámetros editados.
  const historial = useMemo<PuntoMes[]>(() => {
    const info = new Map(PARAMETROS.map((p) => [claveNota(p.nota), p]));
    const porMes = new Map(meses.map((m) => [m.mes, m]));
    return mesesEje().map((mes) => {
      const m = porMes.get(mes);
      const objetivo = data.objetivos[Number(mes.slice(5))] ?? null;
      if (!m) return { mes, pct: null, objetivo, porDueno: null };
      const porDueno: Record<string, number> = Object.fromEntries(DUENOS.map((d) => [d, 0]));
      for (const n of m.notas) {
        const meta = info.get(claveNota(n.nota));
        const p = meta ? params[meta.nota] : undefined;
        if (!meta || !p?.cuenta || n.importe < IMPORTE_MINIMO) continue;
        porDueno[meta.dueno] = (porDueno[meta.dueno] ?? 0) + perdida(n.importe, recuperos[n.id] ?? 0, p, (n.fletePct ?? fletePct) / 100, valorHora).total;
      }
      const total = Object.values(porDueno).reduce((s, x) => s + x, 0);
      return { mes, pct: m.facturacionNeta > 0 ? total / m.facturacionNeta : null, objetivo, porDueno };
    });
  }, [meses, params, recuperos, fletePct, valorHora, data.objetivos]);

  const detalle = calc.filas.filter((f) => f.cuenta && f.r && (!notaSel || f.meta?.nota === notaSel));
  const totalDetalle = detalle.reduce((s, f) => s + f.r!.total, 0);

  const maxDueno = Math.max(1, ...calc.porDueno.map((d) => d.total));

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
        <div className="text-sm text-slate-300">
          {selector}
          <div className="mt-1 text-xs text-slate-500">
            Facturación neta {money(data.facturacionNeta)} · {data.pedidosEntregados} pedidos entregados
          </div>
        </div>
        <label className="text-xs text-slate-400" title="Precio de venta (lst_price) del producto SERVICIO DE REPARACION en Odoo. Se puede cambiar acá para simular; no se guarda.">
          Valor hora ($)
          <input
            type="number"
            min={0}
            className={`${inputCls} ml-2 w-28`}
            value={valorHora}
            onChange={(e) => setValorHora(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-xs text-slate-400" title="Recargo de flete de la región de cada cliente (res.partner.region_id, ej. CORDOBA - 5%). Este valor se usa solo si el cliente no tiene región.">
          % flete si el cliente no tiene región
          <input
            type="number"
            min={0}
            step={0.5}
            className={`${inputCls} ml-2`}
            value={fletePct}
            onChange={(e) => setFletePct(Number(e.target.value) || 0)}
          />
        </label>
        <p className="w-full text-xs text-slate-500">
          NC, facturación, pedidos y valor hora salen de Odoo. El % de flete se toma de la región de cada cliente; el
          campo de al lado solo se usa para clientes sin región cargada. Valor hora, % de flete y recupero no se guardan.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>Dueño:</span>
        {(['Todos', ...DUENOS] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDueno(d)}
            className={`rounded-full border px-3 py-1 text-sm ${
              dueno === d ? 'border-purple-500 bg-purple-500/20 text-slate-100' : 'border-slate-600 text-slate-300 hover:border-slate-400'
            }`}
          >
            {d}
          </button>
        ))}
      </section>

      {calc.sinClasificar > 0 && (
        <p className="rounded-md border border-amber-600/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
          {calc.sinClasificar} NC del mes sin nota cargada o con una nota que no está en los parámetros: no suman al
          CNC hasta clasificarlas.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="NC emitidas" tip={T.nc} value={String(calc.filas.length)} sub={money(calc.brutoTotal)} />
        <Kpi label="NC que cuentan en CNC" tip={T.cuentan} value={String(calc.incidencias)} sub={`${money(calc.brutoCnc)} bruto`} />
        <Kpi label="CNC ponderado" tip={T.cnc} value={money(calc.total)} sub="pérdida real estimada" />
        <Kpi label="CNC % facturación" tip={T.cncPct} value={data.facturacionNeta > 0 ? pctFmt(calc.total / data.facturacionNeta, 3) : '—'} />
        <Kpi
          label="Incidencias c/100 pedidos" tip={T.inc}
          value={data.pedidosEntregados > 0 ? ((calc.incidencias / data.pedidosEntregados) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) : '—'}
        />
        <Kpi label="Recupero" tip={T.rec} value={money(calc.recupero)} />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Por dueño</h3>
        <div className="space-y-2">
          {calc.porDueno.map((d) => (
            <div key={d.dueno} className="flex items-center gap-3 text-sm">
              <div className="w-24 text-slate-300">{d.dueno}</div>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-800">
                <div className="h-full rounded bg-purple-500" style={{ width: `${(d.total / maxDueno) * 100}%` }} />
              </div>
              <div className="w-32 text-right tabular-nums text-slate-100">{money(d.total)}</div>
              <div className="w-16 text-right text-xs text-slate-500">{d.cant} NC</div>
            </div>
          ))}
        </div>
      </section>

      <CncPanel
        notas={calc.porNota.map((x) => ({
          motivo: x.meta.motivo,
          nota: x.meta.nota,
          cant: x.cuentan,
          bruto: x.bruto,
          total: x.total,
          dueno: x.meta.dueno,
          cuenta: !!params[x.meta.nota]?.cuenta,
        }))}
        duenos={calc.porDueno}
        totalCnc={calc.porDueno.reduce((s, d) => s + d.total, 0)}
        facturacionNeta={data.facturacionNeta}
        historial={historial}
        objetivoMes={data.objetivos[Number(data.mes.slice(5))] ?? null}
        duenosOrden={DUENOS}
      />

      <Acordeon titulo="Parámetros y pérdida por nota de N/C" resumen={`${calc.porNota.length} notas · ${money(calc.total)}`}>
        <p className="mb-3 text-xs text-slate-500">
          Pérdida = importe × % + (importe × % flete cliente, si lleva flete) + horas × valor hora − recupero. Los
          campos en amarillo se editan y recalculan todo, incluido el detalle. Click en una fila para ver solo sus NC en el detalle.
          Los cambios de esta tabla se guardan para todos. {estadoGuardado}
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <Th tip={T.motivo} className="text-left">Motivo</Th>
                <Th tip={T.nota} className="text-left">Nota de N/C</Th>
                <Th tip={T.cuenta} className="text-center">¿Cuenta?</Th>
                <Th tip={T.flete} className="text-center">Flete extra</Th>
                <Th tip={T.horas} className="text-right">Horas x caso</Th>
                <Th tip={T.pct} className="text-right">% importe</Th>
                <Th tip={T.dueno} className="text-left">Dueño</Th>
                <Th tip={T.cant} className="text-right">Cant.</Th>
                <Th tip={T.bruta} className="text-right">NC bruta</Th>
                <Th tip={T.fleteCol} className="text-right">Flete</Th>
                <Th tip={T.horasCol} className="text-right">Horas $</Th>
                <Th tip={T.perdida} className="text-right">Pérdida pond.</Th>
              </tr>
            </thead>
            <tbody>
              {calc.porNota.map(({ meta, cant, bruto, flete, horas, total }) => {
                const p = params[meta.nota]!;
                return (
                  <tr
                    key={meta.nota}
                    className={`cursor-pointer border-t border-slate-800 ${notaSel === meta.nota ? 'bg-purple-500/10' : ''}`}
                    title={meta.desc}
                    onClick={() => setNotaSel(notaSel === meta.nota ? null : meta.nota)}
                  >
                    <td className="px-3 py-1.5 text-slate-400">{meta.motivo}</td>
                    <td className="px-3 py-1.5 text-slate-100">{meta.nota}</td>
                    <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <select
                        className="rounded bg-yellow-300 px-1 text-black"
                        value={p.cuenta ? 'Sí' : 'No'}
                        onChange={(e) => setParam(meta.nota, { cuenta: e.target.value === 'Sí' })}
                      >
                        <option>Sí</option>
                        <option>No</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <select
                        disabled={!p.cuenta}
                        className="rounded bg-yellow-300 px-1 text-black disabled:opacity-40"
                        value={p.flete ? 'Sí' : 'No'}
                        onChange={(e) => setParam(meta.nota, { flete: e.target.value === 'Sí' })}
                      >
                        <option>Sí</option>
                        <option>No</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        disabled={!p.cuenta}
                        className="w-16 rounded bg-yellow-300 px-1 text-right text-black disabled:opacity-40"
                        value={p.horas}
                        onChange={(e) => setParam(meta.nota, { horas: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <select
                        disabled={!p.cuenta}
                        className="rounded bg-yellow-300 px-1 text-black disabled:opacity-40"
                        value={p.pct}
                        onChange={(e) => setParam(meta.nota, { pct: Number(e.target.value) })}
                      >
                        <option value={0}>0%</option>
                        <option value={1}>100%</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-slate-300">{p.cuenta ? meta.dueno : '(fuera de CNC)'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{cant}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{money(bruto)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(flete)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(horas)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-100">{money(total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-600 bg-slate-800/60 font-semibold text-slate-100">
                <td className="px-3 py-2" colSpan={7}>
                  Totales
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{calc.porNota.reduce((s, x) => s + x.cant, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(calc.porNota.reduce((s, x) => s + x.bruto, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(calc.porNota.reduce((s, x) => s + x.flete, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(calc.porNota.reduce((s, x) => s + x.horas, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(calc.total)}</td>
              </tr>
              <tr className="bg-slate-800/60 text-xs text-slate-400">
                <td className="px-3 pb-2" colSpan={12}>
                  La última columna es el total CNC ponderado (pérdida real: % del importe + flete + horas − recupero, solo notas que cuentan).
                  NC bruta, flete y horas son los totales de cada columna.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Acordeon>

      <Acordeon titulo="Detalle de notas que cuentan en CNC" resumen={`${detalle.length} NC · ${money(totalDetalle)}`}>
        {notaSel && (
          <p className="mb-3 text-xs text-slate-400">
            Filtrado por nota: <span className="text-slate-100">{notaSel}</span>{' '}
            <button type="button" className="underline" onClick={() => setNotaSel(null)}>
              quitar filtro
            </button>
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <Th tip={T.fecha} className="text-left">Fecha</Th>
                <Th tip={T.nnc} className="text-left">Nº NC</Th>
                <Th tip={T.cliente} className="text-left">Cliente</Th>
                <Th tip={T.nota} className="text-left">Nota</Th>
                <Th tip={T.importe} className="text-right">Importe</Th>
                <Th tip={T.fleteCol} className="text-right">Flete</Th>
                <Th tip={T.horasCol} className="text-right">Horas $</Th>
                <Th tip={T.recupero} className="text-right">Recupero</Th>
                <Th tip={T.perdida} className="text-right">Pérdida</Th>
              </tr>
            </thead>
            <tbody>
              {detalle.map((f) => (
                  <tr key={f.id} className="border-t border-slate-800">
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-400">{fechaAr(f.fecha)}</td>
                    <td className="px-3 py-1.5 text-slate-300">{f.nc}</td>
                    <td className="px-3 py-1.5 text-slate-300">{f.cliente}</td>
                    <td className="px-3 py-1.5 text-slate-100">{f.meta?.nota ?? f.nota}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{money(f.importe)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(f.r!.flete)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(f.r!.horas)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        className="w-24 rounded bg-yellow-300 px-1 text-right text-black"
                        value={f.recupero || ''}
                        placeholder="0"
                        onChange={(e) => setRecuperos((prev) => ({ ...prev, [f.id]: Number(e.target.value) || 0 }))}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-100">{money(f.r!.total)}</td>
                  </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-600 bg-slate-800/60 font-semibold text-slate-100">
                <td className="px-3 py-2" colSpan={4}>
                  Totales
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(detalle.reduce((s, f) => s + f.importe, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(detalle.reduce((s, f) => s + f.r!.flete, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(detalle.reduce((s, f) => s + f.r!.horas, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(detalle.reduce((s, f) => s + f.recupero, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totalDetalle)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Acordeon>
    </div>
  );
}

/** Eje de los gráficos mensuales: del primer mes del criterio nuevo a diciembre de 2027. */
function mesesEje(): string[] {
  return monthsBetween(PRIMER_MES, '2027-12');
}

// 2026-10-15 → 15/10/2026
const fechaAr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

function CalidadCncInner() {
  const hoy = new Date();
  const actual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const meses = monthsBetween(PRIMER_MES, actual < PRIMER_MES ? PRIMER_MES : actual).reverse();
  const [mes, setMes] = useState(meses[0]!);

  // Parámetros por nota: se guardan en Supabase y valen para todos. Viven acá (no en Body) para sobrevivir al cambio de mes.
  const guardados = useApiQuery<ParametrosGuardados>(['cnc-parametros'], '/api/cnc-parametros');
  const [params, setParams] = useState<Record<string, ParamEdit> | null>(null);
  const [guardado, setGuardado] = useState<'idle' | 'guardando' | 'ok' | 'error'>('idle');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    if (params || guardados.isLoading) return;
    setParams({ ...paramsPorDefecto(), ...(guardados.data?.params ?? {}) });
  }, [guardados.data, guardados.isLoading, params]);

  const setParam = (nota: string, patch: Partial<ParamEdit>) => {
    if (!params) return;
    const nuevo = { ...params[nota]!, ...patch };
    setParams({ ...params, [nota]: nuevo });
    if (guardados.data && !guardados.data.disponible) return;
    setGuardado('guardando');
    clearTimeout(timers.current[nota]);
    timers.current[nota] = setTimeout(async () => {
      try {
        const res = await fetch('/api/cnc-parametros', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nota, ...nuevo }),
        });
        const body = (await res.json()) as { ok: boolean };
        setGuardado(res.ok && body.ok ? 'ok' : 'error');
      } catch {
        setGuardado('error');
      }
    }, 500);
  };

  const estadoGuardado =
    guardados.data && !guardados.data.disponible ? (
      <span className="text-amber-400">Falta crear la tabla en Supabase: por ahora los cambios no se guardan.</span>
    ) : guardado === 'guardando' ? (
      <span>Guardando…</span>
    ) : guardado === 'ok' ? (
      <span className="text-emerald-500">Guardado.</span>
    ) : guardado === 'error' ? (
      <span className="text-red-400">No se pudo guardar el último cambio.</span>
    ) : null;
  const query = useApiQuery<CncData>(['calidad-cnc', mes], `/api/calidad-cnc?month=${mes}`);
  // Todos los meses con datos, para los gráficos mensuales (comparten caché con la query del mes elegido).
  const todos = useQueries({
    queries: meses.map((m) => ({
      queryKey: ['calidad-cnc', m],
      queryFn: async () => {
        const res = await fetch(`/api/calidad-cnc?month=${m}`, { headers: { Accept: 'application/json' } });
        const body = (await res.json()) as { ok: boolean; data?: CncData };
        if (!body.ok || !body.data) throw new Error('No se pudo leer el mes');
        return body.data;
      },
    })),
  });
  const cargados = todos.flatMap((q) => (q.data ? [q.data] : []));

  const selector = (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-100">
      Mes
      <select
        className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm capitalize text-slate-100"
        value={mes}
        onChange={(e) => setMes(e.target.value)}
      >
        {meses.map((m) => (
          <option key={m} value={m}>
            {mesLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );

  if (query.isError) {
    return <p className="rounded-md border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200">{(query.error as Error).message}</p>;
  }
  if (!query.data || !params) {
    return (
      <div>
        {selector}
        <p className="mt-4 text-sm text-slate-400">Cargando notas de crédito desde Odoo…</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      <Body key={query.data.mes} data={query.data} selector={selector} meses={cargados} params={params} setParam={setParam} estadoGuardado={estadoGuardado} />
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:only="react"`), same pattern as the other tabs. */
export default function CalidadCncApp() {
  return (
    <QueryProvider>
      <CalidadCncInner />
    </QueryProvider>
  );
}
