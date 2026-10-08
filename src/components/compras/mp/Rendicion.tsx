// Rendición de cuentas de Compras: compras (N1/N2) e inventario (N1/N2) de la última corrida, con selector de período.
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApiQuery } from '../../dashboard/useApiQuery';
import { useChartTheme } from '../../shared/useChartTheme';
import type { VistaRendicion } from '../../../lib/compras-mp/vistas';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Etiqueta, Grilla, Seccion, Segmentos, Tabla, Tarjeta, Vacio, mesCorto, mm, num, pct, td, tdMuted, tdR, th, thR, veces } from './ui';

type Periodo = 'horizonte' | '0' | '1' | '2' | '3';

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

export default function Rendicion() {
  const q = useApiQuery<VistaRendicion | { vacio: true }>(['cmp', 'rendicion'], '/api/compras-mp/datos?vista=rendicion');
  const [periodo, setPeriodo] = useState<Periodo>('horizonte');
  const tema = useChartTheme();

  const v = q.data && !('vacio' in q.data) ? q.data : null;

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para traer los datos de Odoo y calcular el presupuesto.</Vacio>;

  const mesesHoy = v.corrida.horizonte;
  const va = v.versionAprobada;
  // El período sale del horizonte de la versión aprobada (es lo que se rinde); sin versión, del horizonte de hoy.
  const mesesPeriodo = va ? va.version.horizonte : mesesHoy;
  const idx = periodo === 'horizonte' ? mesesPeriodo.map((_, i) => i) : [Number(periodo)].filter((i) => i < mesesPeriodo.length);
  const clavesPeriodo = idx.map((i) => mesesPeriodo[i] ?? '');
  // Lo recalculado hoy solo existe para los meses del horizonte actual.
  const idxHoy = clavesPeriodo.map((m) => mesesHoy.indexOf(m)).filter((i) => i >= 0);
  const etiquetaPeriodo = periodo === 'horizonte' ? `${mesCorto(mesesPeriodo[0] ?? '')} – ${mesCorto(mesesPeriodo[mesesPeriodo.length - 1] ?? '')}` : mesCorto(mesesPeriodo[Number(periodo)] ?? '');
  const compra = sum(idxHoy.map((i) => v.compraPorMes[i] ?? 0));
  const urgencia = sum(idxHoy.map((i) => v.urgenciaPorMes[i] ?? 0));
  const faltante = sum(idxHoy.map((i) => v.faltantePorMes[i] ?? 0));
  const pctUrgencia = compra + faltante > 0 ? urgencia / (compra + faltante) : null;
  const desMes = (mes: string) => v.desembolsos.find((d) => d.mes === mes);
  const desProyectado = sum(idxHoy.map((i) => desMes(mesesHoy[i] ?? '')?.proyectado?.total ?? 0));
  const mesCurso = v.corrida.corte ? mesSiguiente(v.corrida.corte) : '';
  const pagadoMesCurso = desMes(mesCurso)?.pagado?.total ?? 0;

  // Gráfico N2.5: lo pagado (real) y lo proyectado de cada mes.
  const mesesGrafico = v.desembolsos.filter((d) => d.mes !== 'posterior' && ((d.pagado?.total ?? 0) > 0 || (d.proyectado?.total ?? 0) > 0));
  const datosGrafico = mesesGrafico.map((d) => ({
    mes: mesCorto(d.mes),
    Pagado: (d.pagado?.total ?? 0) / 1e6,
    'Facturas abiertas': (d.proyectado?.facturas ?? 0) / 1e6,
    'OC emitidas': (d.proyectado?.oc ?? 0) / 1e6,
    'Compras del presupuesto': (d.proyectado?.compras ?? 0) / 1e6,
    'Gastos de importación': (d.proyectado?.gastosImportacion ?? 0) / 1e6,
  }));
  const tip = { background: tema.tooltipBg, border: `1px solid ${tema.tooltipBorder}`, color: tema.tooltipText };

  const inv = v.inventario;
  const catsOrdenadas = [...v.compraPorCategoria];

  // Versión aprobada: el período ya está alineado con sus meses.
  const idxVersion = va ? idx : [];
  const aprobadoPeriodo = va ? sum(idxVersion.map((i) => va.meses[i]?.aprobado ?? 0)) : 0;
  const cerradosPeriodo = va ? idxVersion.filter((i) => va.meses[i]?.cerrado) : [];
  const aprobadoCerrado = va ? sum(cerradosPeriodo.map((i) => va.meses[i]?.aprobado ?? 0)) : 0;
  const realCerrado = va ? sum(cerradosPeriodo.map((i) => va.meses[i]?.real ?? 0)) : 0;
  const cumplimiento = aprobadoCerrado > 0 ? realCerrado / aprobadoCerrado : null;
  const aprobadoCat = (cat: string) => (va?.categorias.find((c) => c.categoria === cat) ?? null);
  const totalCat = sum(catsOrdenadas.map((c) => sum(idxHoy.map((i) => c.meses[i] ?? 0))));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Rendición de cuentas de Compras</h3>
          <p className="text-sm text-slate-400">Presupuesto proyectado e inventario con los datos de Odoo. Último mes cerrado: {mesCorto(v.corrida.corte)}.</p>
        </div>
        <Segmentos
          valor={periodo}
          onChange={setPeriodo}
          opciones={[{ valor: 'horizonte', texto: `${va ? 'Versión aprobada' : 'Horizonte'} ${mesCorto(mesesPeriodo[0] ?? '')} – ${mesCorto(mesesPeriodo[mesesPeriodo.length - 1] ?? '')}` }, ...mesesPeriodo.map((m, i) => ({ valor: String(i) as Periodo, texto: mesCorto(m) }))]}
        />
      </div>

      <Seccion titulo="Compras" nota={`Todas las tarjetas y tablas de este bloque responden al período elegido: ${etiquetaPeriodo}.`}>
        <Grilla>
          <Tarjeta
            codigo="N1"
            titulo={`Presupuesto ${etiquetaPeriodo}: aprobado vs recalculado hoy`}
            valor={mm(compra)}
            detalle={va ? `Recalculado hoy. Aprobado: ${aprobadoPeriodo > 0 ? mm(aprobadoPeriodo) : 'no incluye este período'} (${va.version.nombre})` : 'Recalculado hoy, a costo de Odoo. Todavía no hay versión aprobada'}
          />
          <Tarjeta
            codigo="N1"
            titulo="% Cumplimiento del presupuesto"
            valor={!va ? 'Sin versión aprobada' : cumplimiento === null ? 'Sin meses cerrados' : pct(cumplimiento, 0)}
            tono={cumplimiento === null ? 'apagada' : 'normal'}
            detalle={!va ? 'Se mide contra las llegadas reales cuando Compras apruebe una versión' : cumplimiento === null ? 'El primer mes aprobado se mide al cerrar su stock de fin de mes' : `Real ${mm(realCerrado)} / aprobado ${mm(aprobadoCerrado)} (${cerradosPeriodo.length} mes/es cerrado/s)`}
          />
          <Tarjeta
            codigo="N2.2"
            titulo="% Compras de urgencia"
            valor={pct(pctUrgencia)}
            tono={pctUrgencia !== null && pctUrgencia > 0.1 ? 'aviso' : 'normal'}
            detalle={`${mm(urgencia)} de ${mm(compra + faltante)} (respaldo de China y faltante bajo seguridad)`}
          />
          <Tarjeta
            codigo="N2.5"
            titulo={`Desembolso proyectado ${etiquetaPeriodo}`}
            valor={mm(desProyectado)}
            detalle={`Con IVA y percepciones. Mes en curso: pagado ${mm(pagadoMesCurso)} a la fecha`}
          />
        </Grilla>

        <Seccion titulo={`N2.1 · Compra por categoría (${etiquetaPeriodo})`} nota="Recalculado con los datos de hoy. “Aprobado” y “Real” salen de la versión aprobada; el real solo cuenta los meses cerrados.">
          <Tabla>
            <Cabeza>
              <tr>
                <th className={th}>Categoría</th>
                <th className={thR}>Aprobado</th>
                <th className={thR}>Recalculado hoy</th>
                <th className={thR}>% del total</th>
                <th className={thR}>Real</th>
                <th className={thR}>Cumplimiento</th>
                <th className={thR}>Órdenes a emitir</th>
              </tr>
            </Cabeza>
            <Cuerpo>
              {catsOrdenadas.map((c) => {
                const valor = sum(idxHoy.map((i) => c.meses[i] ?? 0));
                const emitir = sum(idxHoy.map((i) => c.emitir[i] ?? 0));
                const vc = aprobadoCat(c.categoria);
                const aprob = vc ? sum(idxVersion.map((i) => vc.aprobadoMes[i] ?? 0)) : 0;
                const aprobCer = vc ? sum(cerradosPeriodo.map((i) => vc.aprobadoMes[i] ?? 0)) : 0;
                const realCer = vc ? sum(cerradosPeriodo.map((i) => vc.realMes[i] ?? 0)) : 0;
                if (valor === 0 && emitir === 0 && aprob === 0) return null;
                return (
                  <tr key={c.categoria}>
                    <td className={td}>{c.categoria}</td>
                    {va ? <td className={tdR}>{mm(aprob)}</td> : <td className={tdMuted}>—</td>}
                    <td className={tdR}>{mm(valor)}</td>
                    <td className={tdR}>{pct(totalCat ? valor / totalCat : null)}</td>
                    {va && cerradosPeriodo.length ? <td className={tdR}>{mm(realCer)}</td> : <td className={tdMuted}>—</td>}
                    {va && cerradosPeriodo.length && aprobCer > 0 ? <td className={tdR}>{pct(realCer / aprobCer, 0)}</td> : <td className={tdMuted}>—</td>}
                    <td className={tdR}>{mm(emitir)}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-900/60 font-medium">
                <td className={td}>Total</td>
                {va ? <td className={tdR}>{mm(aprobadoPeriodo)}</td> : <td className={tdMuted}>—</td>}
                <td className={tdR}>{mm(totalCat)}</td>
                <td className={tdR}>{pct(1)}</td>
                {va && cerradosPeriodo.length ? <td className={tdR}>{mm(realCerrado)}</td> : <td className={tdMuted}>—</td>}
                {cumplimiento !== null ? <td className={tdR}>{pct(cumplimiento, 0)}</td> : <td className={tdMuted}>—</td>}
                <td className={tdR}>{mm(sum(catsOrdenadas.map((c) => sum(idxHoy.map((i) => c.emitir[i] ?? 0)))))}</td>
              </tr>
            </Cuerpo>
          </Tabla>
        </Seccion>

        <Seccion titulo="N2.5 · Desembolsos: pagado y proyectado (M$, con IVA y percepciones)" nota="Pagado = pagos reales a proveedores de MP y gastos de importación. Proyectado = facturas abiertas, OC emitidas, compras del presupuesto y gastos de importación.">
          <div className="h-72 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={datosGrafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={tema.grid} vertical={false} />
                <XAxis dataKey="mes" stroke={tema.axis} tick={{ fontSize: 12 }} />
                <YAxis stroke={tema.axis} tick={{ fontSize: 12 }} width={56} tickFormatter={(x: number) => num(x)} />
                <Tooltip contentStyle={tip} formatter={(x: number) => `$ ${num(x, 1)} M`} cursor={{ fill: tema.grid, opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Pagado" stackId="a" fill={tema.mutedBar} />
                <Bar dataKey="Facturas abiertas" stackId="a" fill={tema.danger} />
                <Bar dataKey="OC emitidas" stackId="a" fill={tema.warn} />
                <Bar dataKey="Compras del presupuesto" stackId="a" fill={tema.primary} />
                <Bar dataKey="Gastos de importación" stackId="a" fill={tema.secondary} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Tabla>
            <Cabeza>
              <tr>
                <th className={th}>De dónde sale lo proyectado</th>
                {idxHoy.map((i) => <th key={i} className={thR}>{mesCorto(mesesHoy[i] ?? '')}</th>)}
                {idxHoy.length > 1 && <th className={thR}>Total</th>}
              </tr>
            </Cabeza>
            <Cuerpo>
              {(
                [
                  ['Facturas abiertas (las vencidas se pagan en el mes 1)', 'facturas'],
                  ['OC emitidas que faltan recibir', 'oc'],
                  ['Compras del presupuesto (llegada + plazo de pago)', 'compras'],
                  ['Gastos de importación (promedio de los 3 últimos meses)', 'gastosImportacion'],
                ] as const
              ).map(([texto, k]) => (
                <tr key={k}>
                  <td className={td}>{texto}</td>
                  {idxHoy.map((i) => <td key={i} className={tdR}>{mm(desMes(mesesHoy[i] ?? '')?.proyectado?.[k] ?? 0)}</td>)}
                  {idxHoy.length > 1 && <td className={tdR}>{mm(sum(idxHoy.map((i) => desMes(mesesHoy[i] ?? '')?.proyectado?.[k] ?? 0)))}</td>}
                </tr>
              ))}
              <tr className="bg-slate-900/60 font-medium">
                <td className={td}>Total desembolso proyectado</td>
                {idxHoy.map((i) => <td key={i} className={tdR}>{mm(desMes(mesesHoy[i] ?? '')?.proyectado?.total ?? 0)}</td>)}
                {idxHoy.length > 1 && <td className={tdR}>{mm(desProyectado)}</td>}
              </tr>
            </Cuerpo>
          </Tabla>
        </Seccion>
      </Seccion>

      <Seccion titulo="Inventario" nota="Sobre el stock disponible de hoy, frente a la política de inventario de cada origen.">
        <Grilla>
          <Tarjeta codigo="N2.1" titulo="Valorización del inventario" valor={mm(inv.kpis.valorizacion)} detalle={`Ideal según política: ${mm(inv.kpis.valorIdeal)}`} />
          <Tarjeta
            codigo="N1"
            titulo="Capital inmovilizado"
            valor={mm(inv.kpis.capitalInmovilizado)}
            tono="aviso"
            detalle={`${pct(inv.kpis.pctCapitalInmovilizado)} del valor del inventario (sin movimiento 3+ meses, discontinuados y exceso)`}
          />
          <Tarjeta
            codigo="N1"
            titulo="% SKUs dentro de la política"
            valor={pct(inv.kpis.pctDentroPolitica)}
            detalle={`${inv.kpis.skusPorEstado.bajoSeguridad} bajo seguridad · ${inv.kpis.skusPorEstado.bajoObjetivo} bajo objetivo · ${inv.kpis.skusPorEstado.enRango} en rango · ${inv.kpis.skusPorEstado.exceso} en exceso`}
          />
          <Tarjeta
            codigo="N2.2"
            titulo="Desviación vs punto de pedido"
            valor={pct(inv.kpis.desviacion.Total ?? null, 0)}
            detalle={`A ${pct(inv.kpis.desviacion.A ?? null, 0)} · B ${pct(inv.kpis.desviacion.B ?? null, 0)} · C ${pct(inv.kpis.desviacion.C ?? null, 0)}`}
          />
          <Tarjeta codigo="N2.3" titulo="Rotación real" valor={veces(inv.kpis.rotacionReal)} detalle="Consumo anualizado a costo ÷ stock promedio de los 5 últimos cierres" />
          <Tarjeta codigo="N2.4" titulo="% Inventario sin movimiento 3+ meses" valor={pct(inv.kpis.pctSinMovimiento)} detalle={mm(inv.kpis.sinMovimiento)} />
        </Grilla>

        <Seccion titulo="N1 · N2.2 · Ajuste a la política por clase ABC">
          <Tabla>
            <Cabeza>
              <tr>
                <th className={th}>Clase</th>
                <th className={thR}>Bajo seguridad</th>
                <th className={thR}>Bajo objetivo</th>
                <th className={thR}>En rango</th>
                <th className={thR}>Exceso</th>
                <th className={thR}>% en rango</th>
                <th className={thR}>Capital inmovilizado</th>
                <th className={thR}>Desviación vs objetivo</th>
              </tr>
            </Cabeza>
            <Cuerpo>
              {[...inv.porClase, inv.totalClase].map((c) => (
                <tr key={c.clase} className={c.clase === 'Total' ? 'bg-slate-900/60 font-medium' : ''}>
                  <td className={td}>{c.clase === 'Total' ? 'Total' : <Etiqueta texto={`Clase ${c.clase}`} />}</td>
                  <td className={tdR}>{c.bajoSeguridad}</td>
                  <td className={tdR}>{c.bajoObjetivo}</td>
                  <td className={tdR}>{c.enRango}</td>
                  <td className={tdR}>{c.exceso}</td>
                  <td className={tdR}>{pct(c.pctEnRango)}</td>
                  <td className={tdR}>{mm(c.capitalInmovilizado)}</td>
                  <td className={tdR}>{pct(c.desviacion, 0)}</td>
                </tr>
              ))}
            </Cuerpo>
          </Tabla>
        </Seccion>

        <Seccion titulo="N2.1 · N2.3 · N2.4 · Inventario por categoría">
          <Tabla>
            <Cabeza>
              <tr>
                <th className={th}>Categoría</th>
                <th className={thR}>Valor actual</th>
                <th className={thR}>Valor ideal</th>
                <th className={thR}>Capital inmovilizado</th>
                <th className={thR}>% sin movimiento</th>
                <th className={thR}>Rotación real</th>
              </tr>
            </Cabeza>
            <Cuerpo>
              {inv.porCategoria.map((c) => (
                <tr key={c.categoria}>
                  <td className={td}>{c.categoria}</td>
                  <td className={tdR}>{mm(c.valorActual)}</td>
                  <td className={tdR}>{mm(c.valorIdeal)}</td>
                  <td className={tdR}>{mm(c.capitalInmovilizado)}</td>
                  <td className={tdR}>{pct(c.pctSinMovimiento)}</td>
                  <td className={tdR}>{num(c.rotacionReal, 1)}</td>
                </tr>
              ))}
              <tr className="bg-slate-900/60 font-medium">
                <td className={td}>Total</td>
                <td className={tdR}>{mm(inv.total.valorActual)}</td>
                <td className={tdR}>{mm(inv.total.valorIdeal)}</td>
                <td className={tdR}>{mm(inv.total.capitalInmovilizado)}</td>
                <td className={tdR}>{pct(inv.total.pctSinMovimiento)}</td>
                <td className={tdR}>{num(inv.total.rotacionReal, 1)}</td>
              </tr>
            </Cuerpo>
          </Tabla>
        </Seccion>
      </Seccion>
    </div>
  );
}

/** "2026-09" → "2026-10". */
function mesSiguiente(clave: string): string {
  const [y, m] = clave.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
