import { useMemo, useState, type ReactNode } from 'react';
import {
  FACTURACION_NETA_OCT,
  IMPORTE_MINIMO,
  NOTAS,
  PARAMETROS,
  PEDIDOS_OCT,
  type ParametroNota,
} from './calidad-demo-data';

/** Parámetro editable de una nota. `pct` es el % del importe que se pierde (garantías, acuerdos). */
interface ParamEdit {
  flete: boolean;
  horas: number;
  pct: number;
}

const DUENOS = ['Producción', 'Comercial', 'Logística', 'Finanzas'] as const;

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

/** Tooltip al pasar el mouse. Posición fija para que no lo recorte el scroll de las tablas. */
function Tip({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className={className}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 340)), y: r.bottom + 6 });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          className="pointer-events-none fixed z-50 w-80 whitespace-pre-line rounded-md border border-slate-600 bg-slate-950 p-3 text-left text-xs font-normal normal-case leading-relaxed text-slate-200 shadow-xl"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </span>
      )}
    </span>
  );
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
  nc: 'Cantidad de notas de crédito del mes.\nOdoo (versión final): account.move con move_type = out_refund.\nDemo: Excel, hoja Registro_NC.',
  cuentan: 'NC cuya nota tiene "¿Cuenta en CNC?" = Sí y con importe ≥ $1.000.\nSERVI POS VENTA y N/C POR DESCUENTO no cuentan.',
  cnc: 'Suma de la pérdida de cada NC que cuenta:\nimporte × % importe + importe × % flete cliente (si lleva flete) + horas × valor hora − recupero (mínimo 0).',
  cncPct: 'CNC ponderado ÷ facturación neta del mes.\nFacturación neta: Odoo account.move.line (facturas − NC), igual que el tab Facturación de Gerencia. Demo: Excel, Resumen_Mensual.',
  inc: 'NC que cuentan ÷ pedidos entregados × 100.\nPedidos entregados: demo desde Excel (Resumen_Mensual); en Odoo saldría de despachos.',
  rec: 'Suma del recupero de las NC que cuentan (cobro al camionero, outlet, reproceso, cargo al cliente).\nDemo: Excel, Registro_NC col. G.',
  motivo: 'Motivo de la nota. Parámetro de la empresa (Excel, hoja Parametros col. A).',
  nota: 'Nota de N/C elegida al cargar la NC (Registro_NC col. E). Pendiente definir el campo de Odoo donde se carga.',
  cuenta: 'Parámetro de la empresa: si la nota suma o no al CNC.',
  flete: 'Parámetro Sí/No. Si es Sí, a la pérdida se le suma importe × % flete del cliente.\n% flete: región del cliente en Odoo (res.partner.region_id, "CORDOBA - 5%"). Demo: valor único editable.',
  horas: 'Horas que se estiman por caso de este tipo de nota (autorizadas). Pérdida por horas = horas × valor hora.\nValor hora: tarifa costoHora de Costo de devoluciones (Supabase).',
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
  recupero: 'Lo recuperado de esa NC. Demo: Excel, Registro_NC col. G. Odoo: pendiente de definir.',
};

const inputCls =
  'w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right text-sm text-slate-100';

export default function CalidadCncApp() {
  // Valor hora y % de flete: en producción vienen de las tarifas (costo-devoluciones) y de la región del cliente en Odoo.
  const [valorHora, setValorHora] = useState(8000);
  const [fletePct, setFletePct] = useState(5);
  const [params, setParams] = useState<Record<string, ParamEdit>>(() =>
    Object.fromEntries(
      PARAMETROS.map((p: ParametroNota) => [
        p.nota,
        // Solo las notas que se pierden enteras conservan %; el 10% viejo era flete.
        { flete: p.flete, horas: p.horas, pct: p.pct >= 1 ? 1 : 0 },
      ]),
    ),
  );

  const setParam = (nota: string, patch: Partial<ParamEdit>) =>
    setParams((prev) => ({ ...prev, [nota]: { ...prev[nota]!, ...patch } }));

  const calc = useMemo(() => {
    const info = new Map(PARAMETROS.map((p) => [p.nota, p]));
    const filas = NOTAS.map((n) => {
      const meta = info.get(n.nota);
      const cuenta = !!meta?.cuenta && n.importe >= IMPORTE_MINIMO;
      const p = params[n.nota];
      const r = cuenta && p ? perdida(n.importe, n.recupero, p, fletePct / 100, valorHora) : null;
      return { ...n, meta, cuenta, r };
    });
    const porNota = PARAMETROS.map((meta) => {
      const f = filas.filter((x) => x.nota === meta.nota);
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
    const total = porNota.reduce((s, x) => s + x.total, 0);
    const porDueno = DUENOS.map((d) => {
      const filasD = porNota.filter((x) => x.meta.dueno === d && x.meta.cuenta);
      return { dueno: d, cant: filasD.reduce((s, x) => s + x.cuentan, 0), total: filasD.reduce((s, x) => s + x.total, 0) };
    });
    const incidencias = porNota.reduce((s, x) => s + x.cuentan, 0);
    return {
      filas,
      porNota,
      porDueno,
      total,
      incidencias,
      brutoTotal: filas.reduce((s, x) => s + x.importe, 0),
      brutoCnc: filas.filter((x) => x.cuenta).reduce((s, x) => s + x.importe, 0),
      recupero: filas.filter((x) => x.cuenta).reduce((s, x) => s + x.recupero, 0),
    };
  }, [params, fletePct, valorHora]);

  const maxDueno = Math.max(1, ...calc.porDueno.map((d) => d.total));

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end gap-6 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
        <div className="text-sm text-slate-300">
          <div className="font-medium text-slate-100">Octubre 2026 · línea base</div>
          <div className="text-xs text-slate-500">
            Facturación neta {money(FACTURACION_NETA_OCT)} · {PEDIDOS_OCT} pedidos
          </div>
        </div>
        <label className="text-xs text-slate-400" title="Costo de una hora de reparación. Supabase: tarifa costoHora de Costo de devoluciones. Demo: valor inventado, editable.">
          Valor hora ($)
          <input
            type="number"
            min={0}
            className={`${inputCls} ml-2 w-28`}
            value={valorHora}
            onChange={(e) => setValorHora(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-xs text-slate-400" title="Recargo de flete de la región del cliente (res.partner.region_id, ej. CORDOBA - 5%). Demo: un valor único para todos.">
          % flete del cliente
          <input
            type="number"
            min={0}
            step={0.5}
            className={`${inputCls} ml-2`}
            value={fletePct}
            onChange={(e) => setFletePct(Number(e.target.value) || 0)}
          />
        </label>
        <p className="max-w-md text-xs text-slate-500">
          Demo: el valor hora y el % de flete son únicos y editables. En la versión final el % sale de la región de cada
          cliente (como en Costo de devoluciones) y el valor hora de las tarifas autorizadas.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="NC emitidas" tip={T.nc} value={String(calc.filas.length)} sub={money(calc.brutoTotal)} />
        <Kpi label="NC que cuentan en CNC" tip={T.cuentan} value={String(calc.incidencias)} sub={`${money(calc.brutoCnc)} bruto`} />
        <Kpi label="CNC ponderado" tip={T.cnc} value={money(calc.total)} sub="pérdida real estimada" />
        <Kpi label="CNC % facturación" tip={T.cncPct} value={pctFmt(calc.total / FACTURACION_NETA_OCT, 3)} />
        <Kpi
          label="Incidencias c/100 pedidos" tip={T.inc}
          value={((calc.incidencias / PEDIDOS_OCT) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}
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

      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-200">Parámetros y pérdida por nota de N/C</h3>
        <p className="mb-3 text-xs text-slate-500">
          Pérdida = importe × % + (importe × % flete cliente, si lleva flete) + horas × valor hora − recupero. Los
          campos en amarillo se editan y recalculan todo.
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
                  <tr key={meta.nota} className="border-t border-slate-800" title={meta.desc}>
                    <td className="px-3 py-1.5 text-slate-400">{meta.motivo}</td>
                    <td className="px-3 py-1.5 text-slate-100">{meta.nota}</td>
                    <td className="px-3 py-1.5 text-center text-slate-400">{meta.cuenta ? 'Sí' : 'No'}</td>
                    <td className="px-3 py-1.5 text-center">
                      <select
                        disabled={!meta.cuenta}
                        className="rounded bg-yellow-300 px-1 text-slate-900 disabled:opacity-40"
                        value={p.flete ? 'Sí' : 'No'}
                        onChange={(e) => setParam(meta.nota, { flete: e.target.value === 'Sí' })}
                      >
                        <option>Sí</option>
                        <option>No</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        disabled={!meta.cuenta}
                        className="w-16 rounded bg-yellow-300 px-1 text-right text-slate-900 disabled:opacity-40"
                        value={p.horas}
                        onChange={(e) => setParam(meta.nota, { horas: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <select
                        disabled={!meta.cuenta}
                        className="rounded bg-yellow-300 px-1 text-slate-900 disabled:opacity-40"
                        value={p.pct}
                        onChange={(e) => setParam(meta.nota, { pct: Number(e.target.value) })}
                      >
                        <option value={0}>0%</option>
                        <option value={1}>100%</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-slate-300">{meta.cuenta ? meta.dueno : '(fuera de CNC)'}</td>
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
                <td className="px-3 py-2" colSpan={11}>
                  Total CNC ponderado
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(calc.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Detalle de notas que cuentan en CNC</h3>
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
              {calc.filas
                .filter((f) => f.cuenta && f.r)
                .map((f) => (
                  <tr key={f.nc} className="border-t border-slate-800">
                    <td className="px-3 py-1.5 text-slate-400">{f.fecha}</td>
                    <td className="px-3 py-1.5 text-slate-300">{f.nc}</td>
                    <td className="px-3 py-1.5 text-slate-300">{f.cliente}</td>
                    <td className="px-3 py-1.5 text-slate-100">{f.nota}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{money(f.importe)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(f.r!.flete)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(f.r!.horas)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{money(f.recupero)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-100">{money(f.r!.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
