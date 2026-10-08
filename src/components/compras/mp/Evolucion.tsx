// Evolución: historial de cierres mensuales de los indicadores, con un gráfico por indicador.
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '../../dashboard/useApiQuery';
import { useChartTheme } from '../../shared/useChartTheme';
import type { VistaEvolucion } from '../../../lib/compras-mp/vistas';
import { postJson } from './acciones';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Seccion, Tabla, Vacio, fechaCorta, fechaHora, mesCorto, mm, num, pct, td, tdR, th, thR } from './ui';

interface Indicador {
  titulo: string;
  codigo: string;
  valor: (c: VistaEvolucion['cierres'][number]) => number | null;
  formato: (v: number | null) => string;
  escala?: number;
}

const INDICADORES: Indicador[] = [
  { codigo: 'N1', titulo: '% Cumplimiento del presupuesto', valor: (c) => c.indicadores.cumplimiento?.pct ?? null, formato: (v) => pct(v, 0) },
  { codigo: 'N2.2', titulo: '% Compras de urgencia', valor: (c) => c.indicadores.compras.pctUrgencia, formato: (v) => pct(v) },
  { codigo: 'N2.5', titulo: 'Pagado a proveedores en el mes (M$)', valor: (c) => (c.indicadores.desembolsoPagado === null ? null : c.indicadores.desembolsoPagado / 1e6), formato: (v) => (v === null ? '—' : `$ ${num(v, 0)} M`) },
  { codigo: 'N2.1', titulo: 'Valorización del inventario (M$)', valor: (c) => c.indicadores.inventario.valorizacion / 1e6, formato: (v) => (v === null ? '—' : `$ ${num(v, 0)} M`) },
  { codigo: 'N1', titulo: 'Capital inmovilizado (M$)', valor: (c) => c.indicadores.inventario.capitalInmovilizado / 1e6, formato: (v) => (v === null ? '—' : `$ ${num(v, 0)} M`) },
  { codigo: 'N1', titulo: '% SKUs dentro de la política', valor: (c) => c.indicadores.inventario.pctDentroPolitica, formato: (v) => pct(v) },
  { codigo: 'N2.3', titulo: 'Rotación real (veces/año)', valor: (c) => c.indicadores.inventario.rotacionReal, formato: (v) => num(v, 2) },
  { codigo: 'N2.4', titulo: '% Inventario sin movimiento', valor: (c) => c.indicadores.inventario.pctSinMovimiento, formato: (v) => pct(v) },
];

export default function Evolucion({ puedeEditar }: { puedeEditar: boolean }) {
  const q = useApiQuery<VistaEvolucion | { vacio: true }>(['cmp', 'evolucion'], '/api/compras-mp/datos?vista=evolucion');
  const tema = useChartTheme();
  const cliente = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const registrar = useMutation({
    mutationFn: () => postJson('/api/compras-mp/cierre', {}),
    onSuccess: () => { setAviso(null); return cliente.invalidateQueries({ queryKey: ['cmp', 'evolucion'] }); },
    onError: (e: Error) => setAviso(e.message),
  });

  const v = q.data && !('vacio' in q.data) ? q.data : null;
  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para calcular.</Vacio>;

  // Un punto por mes: la última revisión de cada cierre.
  const ultimos = new Map<string, VistaEvolucion['cierres'][number]>();
  for (const c of v.cierres) ultimos.set(c.mes, c);
  const serie = [...ultimos.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  const tip = { background: tema.tooltipBg, border: `1px solid ${tema.tooltipBorder}`, color: tema.tooltipText };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
        <p className="text-sm text-slate-400">
          Cada cierre guarda los indicadores del mes con su fecha, quién lo registró y la fecha de los datos de Odoo. No se modifican: una corrección se guarda como revisión nueva.
        </p>
        {v.puedeRegistrar && puedeEditar && (
          <button
            type="button"
            disabled={registrar.isPending}
            onClick={() => registrar.mutate()}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-brand-400 disabled:opacity-60"
          >
            {registrar.isPending ? 'Registrando…' : v.yaCerrado ? `Registrar revisión del cierre de ${mesCorto(v.mesParaCerrar)}` : `Registrar cierre de ${mesCorto(v.mesParaCerrar)}`}
          </button>
        )}
      </div>
      {aviso && <ErrorCaja mensaje={aviso} />}

      {serie.length === 0 ? (
        <Vacio>
          Todavía no se registró ningún cierre. Cuando se cierre un mes (con su stock de fin de mes cargado), Compras lo registra acá y empieza a armarse la evolución de los indicadores.
        </Vacio>
      ) : (
        <>
          <Seccion titulo="Indicadores por mes cerrado">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {INDICADORES.map((ind) => {
                const datos = serie.map((c) => ({ mes: mesCorto(c.mes), v: ind.valor(c) }));
                return (
                  <div key={ind.titulo} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">{ind.codigo}</span> {ind.titulo}
                    </p>
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={datos} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke={tema.grid} vertical={false} />
                          <XAxis dataKey="mes" stroke={tema.axis} tick={{ fontSize: 11 }} />
                          <YAxis stroke={tema.axis} tick={{ fontSize: 11 }} width={48} domain={['auto', 'auto']} />
                          <Tooltip contentStyle={tip} formatter={(x: number) => ind.formato(x)} />
                          <Line type="monotone" dataKey="v" stroke={tema.primary} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          </Seccion>

          <Seccion titulo="Cierres registrados">
            <Tabla>
              <Cabeza>
                <tr>
                  <th className={th}>Mes</th>
                  <th className={thR}>Revisión</th>
                  <th className={th}>Registrado</th>
                  <th className={th}>Por</th>
                  <th className={th}>Datos de Odoo del</th>
                  <th className={thR}>Cumplimiento</th>
                  <th className={thR}>Urgencia</th>
                  <th className={thR}>Valorización</th>
                  <th className={thR}>Capital inmovilizado</th>
                  <th className={thR}>Rotación</th>
                </tr>
              </Cabeza>
              <Cuerpo>
                {[...v.cierres].reverse().map((c) => (
                  <tr key={c.id}>
                    <td className={td}>{mesCorto(c.mes)}</td>
                    <td className={tdR}>{c.revision}</td>
                    <td className={td}>{fechaHora(c.creadoEn)}</td>
                    <td className={td}>{c.usuario}</td>
                    <td className={td}>{fechaCorta(c.fechaDatos)}</td>
                    <td className={tdR}>{pct(c.indicadores.cumplimiento?.pct ?? null, 0)}</td>
                    <td className={tdR}>{pct(c.indicadores.compras.pctUrgencia)}</td>
                    <td className={tdR}>{mm(c.indicadores.inventario.valorizacion)}</td>
                    <td className={tdR}>{mm(c.indicadores.inventario.capitalInmovilizado)}</td>
                    <td className={tdR}>{num(c.indicadores.inventario.rotacionReal, 2)}</td>
                  </tr>
                ))}
              </Cuerpo>
            </Tabla>
          </Seccion>
        </>
      )}
    </div>
  );
}
