import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/components/shared/useChartTheme';

/** Tablero del indicador CNC: dos tablas resumen (estilo planilla) y cuatro gráficos. */

export interface FilaNota {
  motivo: string;
  nota: string;
  cant: number;
  bruto: number;
  total: number;
  dueno: string;
  cuenta: boolean;
}
export interface FilaDueno {
  dueno: string;
  cant: number;
  total: number;
}
export interface PuntoMes {
  mes: string;
  /** null = mes sin datos todavía. */
  pct: number | null;
  /** Objetivo del mes, en % (0,6 = 0,6%), o null si no está cargado. */
  objetivo: number | null;
  porDueno: Record<string, number> | null;
}

const money = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const moneyCorto = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : `$${Math.round(n / 1000)} k`);
const pct = (n: number, d = 1) => `${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: d })}%`;

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const mesCorto = (k: string) => {
  const [y, m] = k.split('-').map(Number);
  return `${MESES_CORTO[m! - 1]}-${String(y).slice(2)}`;
};

const COLOR_DUENO: Record<string, string> = {
  Producción: '#1e3a8a',
  Comercial: '#2563eb',
  Logística: '#93c5fd',
  Finanzas: '#fdba74',
};

function Caja({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
      <h4 className="mb-2 text-center text-sm font-semibold text-slate-200">{titulo}</h4>
      {children}
    </div>
  );
}

export default function CncPanel({
  notas,
  duenos,
  totalCnc,
  facturacionNeta,
  historial,
  duenosOrden,
  objetivoMes,
}: {
  notas: FilaNota[];
  duenos: FilaDueno[];
  totalCnc: number;
  facturacionNeta: number;
  historial: PuntoMes[];
  duenosOrden: readonly string[];
  objetivoMes: number | null;
}) {
  const t = useChartTheme();
  const tooltip = {
    contentStyle: { background: t.tooltipBg, border: `1px solid ${t.tooltipBorder}`, borderRadius: 8 },
    labelStyle: { color: t.tooltipText },
    itemStyle: { color: t.tooltipText },
  };
  const totalNotas = notas.reduce((s, n) => s + n.total, 0);
  const totalCant = notas.reduce((s, n) => s + n.cant, 0);
  const totalBruto = notas.reduce((s, n) => s + n.bruto, 0);
  const totalDuenoCant = duenos.reduce((s, d) => s + d.cant, 0);

  const lineaMes = historial.map((h) => ({ mes: mesCorto(h.mes), pct: h.pct === null ? null : h.pct * 100, objetivo: h.objetivo }));
  const barrasMes = historial.map((h) => ({ mes: mesCorto(h.mes), ...(h.porDueno ?? {}) }));

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <div>
          <h4 className="mb-2 text-base font-semibold text-slate-200">Por nota de N/C: mes seleccionado</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 text-left">Motivo</th>
                  <th className="px-3 py-2.5 text-left">Nota de N/C</th>
                  <th className="px-3 py-2.5 text-right">Cant.</th>
                  <th className="px-3 py-2.5 text-right">NC bruta ($)</th>
                  <th className="px-3 py-2.5 text-right">Pérdida pond. ($)</th>
                  <th className="px-3 py-2.5 text-right">% del CNC</th>
                  <th className="px-3 py-2.5 text-left">Dueño</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.nota} className="border-t border-slate-800 text-slate-300">
                    <td className="px-3 py-1.5">{n.motivo}</td>
                    <td className="px-3 py-1.5 text-slate-100">{n.nota}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n.cant || '-'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n.bruto ? money(n.bruto) : '-'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n.total ? money(n.total) : '-'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n.total && totalNotas ? pct(n.total / totalNotas) : '-'}</td>
                    <td className="px-3 py-1.5">{n.cuenta ? n.dueno : '(fuera de CNC)'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-600 bg-slate-800/60 font-semibold text-slate-100">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalCant}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(totalBruto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(totalNotas)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalNotas ? '100%' : '-'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-base font-semibold text-slate-200">Por dueño: mes seleccionado</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 text-left">Dueño</th>
                  <th className="px-3 py-2.5 text-right">Cant. NC</th>
                  <th className="px-3 py-2.5 text-right">Pérdida pond. ($)</th>
                  <th className="px-3 py-2.5 text-right">% fact.</th>
                  <th className="px-3 py-2.5 text-left">Objetivo % fact.</th>
                </tr>
              </thead>
              <tbody>
                {duenos.map((d) => (
                  <tr key={d.dueno} className="border-t border-slate-800 text-slate-300">
                    <td className="px-3 py-1.5 text-slate-100">{d.dueno}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.cant}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(d.total)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{facturacionNeta > 0 ? pct(d.total / facturacionNeta, 2) : '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500">—</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-600 bg-slate-800/60 font-semibold text-slate-100">
                  <td className="px-3 py-2">Total CNC</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalDuenoCant}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(totalCnc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{facturacionNeta > 0 ? pct(totalCnc / facturacionNeta, 2) : '—'}</td>
                  <td className="px-3 py-2">{objetivoMes === null ? '—' : `${objetivoMes.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Caja titulo="Pérdida ponderada por nota ($)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={notas.map((n) => ({ nota: n.nota, total: n.total }))} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
              <XAxis type="number" stroke={t.axis} fontSize={11} tickFormatter={moneyCorto} />
              <YAxis type="category" dataKey="nota" stroke={t.axis} fontSize={10} width={150} interval={0} />
              <Tooltip {...tooltip} formatter={(v) => [money(Number(v)), 'Pérdida']} />
              <Bar dataKey="total" fill="#1e3a8a" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Caja>

        <Caja titulo="Pérdida ponderada por dueño ($)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={duenos} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
              <XAxis type="number" stroke={t.axis} fontSize={11} tickFormatter={moneyCorto} />
              <YAxis type="category" dataKey="dueno" stroke={t.axis} fontSize={11} width={90} />
              <Tooltip {...tooltip} formatter={(v) => [money(Number(v)), 'Pérdida']} />
              <Bar dataKey="total" fill="#2563eb" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Caja>

        <Caja titulo="CNC % facturación por mes">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={lineaMes} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
              <XAxis dataKey="mes" stroke={t.axis} fontSize={11} />
              <YAxis stroke={t.axis} fontSize={11} width={48} tickFormatter={(v) => `${Number(v).toLocaleString('es-AR')}%`} />
              <Tooltip {...tooltip} formatter={(v) => [`${Number(v).toLocaleString('es-AR', { maximumFractionDigits: 3 })}%`, 'CNC % facturación']} />
              <Legend />
              <Line type="monotone" dataKey="pct" name="CNC % facturación" stroke="#1e3a8a" strokeWidth={2.5} dot isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="objetivo" name="Objetivo" stroke="#dc2626" strokeWidth={2.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-1 text-center text-xs text-slate-500">El objetivo se carga en Odoo (dashboard Reunión de equipo de gestión, Hoja2).</p>
        </Caja>

        <Caja titulo="CNC ponderado mensual por dueño ($)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barrasMes} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
              <XAxis dataKey="mes" stroke={t.axis} fontSize={11} />
              <YAxis stroke={t.axis} fontSize={11} width={56} tickFormatter={moneyCorto} />
              <Tooltip {...tooltip} formatter={(v, name) => [money(Number(v)), String(name)]} />
              <Legend />
              {duenosOrden.map((d) => (
                <Bar key={d} dataKey={d} stackId="cnc" fill={COLOR_DUENO[d]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Caja>
      </div>
    </div>
  );
}
