// Seguimiento: cumplimiento del presupuesto aprobado contra las llegadas reales de los meses cerrados.
import { useMemo, useState } from 'react';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { VistaSeguimiento } from '../../../lib/compras-mp/vistas';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Grilla, Seccion, Selector, Tabla, Tarjeta, Vacio, fechaHora, mesCorto, mm, num, pct, pesos, td, tdMuted, tdR, th, thR, unidades } from './ui';

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

export default function Seguimiento({ onSku }: { onSku: (clave: string) => void }) {
  const [empresas, setEmpresas] = useState<number[]>([]);
  const q = useApiQuery<VistaSeguimiento | { vacio: true }>(['cmp', 'seguimiento', empresas.join(',')], `/api/compras-mp/datos?vista=seguimiento${empresas.length ? `&empresas=${empresas.join(',')}` : ''}`);
  const [cat, setCat] = useState('todas');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(100);
  const v = q.data && !('vacio' in q.data) ? q.data : null;
  const r = v?.resultado ?? null;

  const filas = useMemo(() => {
    if (!r) return [];
    const t = busca.trim().toLowerCase();
    return r.filas.filter((f) => (cat === 'todas' || f.cat === cat) && (!t || f.sku.toLowerCase().includes(t)));
  }, [r, cat, busca]);

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para calcular.</Vacio>;
  if (!v.version) {
    return (
      <Vacio>
        Todavía no hay una versión aprobada del presupuesto, así que no hay cumplimiento que medir. Cuando Compras apruebe una versión (en la pantalla Presupuesto), acá se
        compara lo aprobado contra lo que llegó realmente en cada mes cerrado.
      </Vacio>
    );
  }
  if (!r) return <ErrorCaja mensaje="No se pudo medir el cumplimiento: faltan las fotos de consumo o de stock de fin de mes de la última actualización." />;

  const meses = r.meses;
  const categorias = r.categorias.map((c) => c.categoria);
  const cerrados = r.mesesCerrados.length;
  const alternar = (id: number) => setEmpresas(empresas.includes(id) ? empresas.filter((x) => x !== id) : [...empresas, id]);

  return (
    <div className="flex flex-col gap-10">
      <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-400">
        Versión aprobada vigente: <span className="font-medium text-slate-200">{v.version.nombre}</span> · por {v.version.aprobadaPor} el {fechaHora(v.version.aprobadaEn)} · total{' '}
        {mm(v.version.totalCompra)}
      </div>

      <Grilla>
        <Tarjeta
          codigo="N1"
          titulo="% Cumplimiento del presupuesto"
          valor={cerrados ? pct(r.total.cumplimiento) : 'Sin meses cerrados'}
          tono={cerrados ? 'normal' : 'apagada'}
          detalle={cerrados ? `Real ${mm(r.total.real)} / aprobado ${mm(r.total.aprobadoCerrado)} (${cerrados} mes/es cerrado/s)` : 'El primer mes aprobado se mide al cerrar su stock de fin de mes'}
        />
        <Tarjeta codigo="" titulo="Aprobado del horizonte" valor={mm(sum(r.total.aprobadoMes))} detalle={`${meses.map((m) => mesCorto(m.mes)).join(' · ')}`} />
        <Tarjeta codigo="" titulo="Desvío (real − aprobado)" valor={cerrados ? mm(r.total.desvio) : '—'} tono={cerrados && Math.abs(r.total.desvio) > 0 ? 'aviso' : 'normal'} detalle="Solo meses cerrados" />
        <Tarjeta codigo="" titulo="Facturado de referencia" valor={cerrados ? mm(r.total.facturado) : '—'} detalle="Facturas de proveedor de MP; no incluye todas las importaciones" />
      </Grilla>

      <Seccion titulo="N2.1 · Cumplimiento por categoría" nota="Un mes queda “abierto” hasta que se cierra su stock de fin de mes; mientras tanto no cuenta para el cumplimiento.">
        <Tabla>
          <Cabeza>
            <tr>
              <th className={th}>Categoría</th>
              {meses.map((m) => (
                <th key={m.mes} className={thR} colSpan={1}>Aprob. {mesCorto(m.mes)}</th>
              ))}
              {meses.map((m) => (
                <th key={`r${m.mes}`} className={thR}>Real {mesCorto(m.mes)}{m.cerrado ? '' : ' (abierto)'}</th>
              ))}
              <th className={thR}>Aprobado cerrados</th>
              <th className={thR}>Real cerrados</th>
              <th className={thR}>Cumplimiento</th>
              <th className={thR}>Desvío</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {r.categorias.map((c) => (
              <tr key={c.categoria}>
                <td className={td}>{c.categoria}</td>
                {c.aprobadoMes.map((x, i) => <td key={i} className={tdR}>{mm(x)}</td>)}
                {c.realMes.map((x, i) => (meses[i]?.cerrado ? <td key={i} className={tdR}>{mm(x)}</td> : <td key={i} className={tdMuted}>—</td>))}
                <td className={tdR}>{mm(c.aprobadoCerrado)}</td>
                <td className={tdR}>{mm(c.real)}</td>
                <td className={tdR}>{pct(c.cumplimiento)}</td>
                <td className={tdR}>{mm(c.desvio)}</td>
              </tr>
            ))}
            <tr className="bg-slate-900/60 font-medium">
              <td className={td}>Total</td>
              {r.total.aprobadoMes.map((x, i) => <td key={i} className={tdR}>{mm(x)}</td>)}
              {r.total.realMes.map((x, i) => (meses[i]?.cerrado ? <td key={i} className={tdR}>{mm(x)}</td> : <td key={i} className={tdMuted}>—</td>))}
              <td className={tdR}>{mm(r.total.aprobadoCerrado)}</td>
              <td className={tdR}>{mm(r.total.real)}</td>
              <td className={tdR}>{pct(r.total.cumplimiento)}</td>
              <td className={tdR}>{mm(r.total.desvio)}</td>
            </tr>
          </Cuerpo>
        </Tabla>
      </Seccion>

      <Seccion titulo={`Precisión del pronóstico${r.precision.mes ? ` — ${mesCorto(r.precision.mes)}` : ''}`} nota="Consumo que se proyectó en la versión aprobada contra el consumo real del último mes cerrado, valorizado al costo presupuestado.">
        {!r.precision.mes ? (
          <Vacio>Todavía no hay un mes cerrado dentro de la versión aprobada.</Vacio>
        ) : (
          <>
            {v.produccion.length > 0 && (
              <Tabla>
                <Cabeza>
                  <tr><th className={th}>Concepto</th><th className={thR}>Plan</th><th className={thR}>Real</th><th className={thR}>Desvío</th><th className={thR}>Desvío %</th></tr>
                </Cabeza>
                <Cuerpo>
                  {v.produccion.map((p) => (
                    <tr key={p.concepto}>
                      <td className={td}>{p.concepto}</td>
                      <td className={tdR}>{num(p.plan)}</td>
                      <td className={tdR}>{num(p.real)}</td>
                      <td className={tdR}>{num(p.real - p.plan)}</td>
                      <td className={tdR}>{pct(p.plan ? (p.real - p.plan) / p.plan : null)}</td>
                    </tr>
                  ))}
                </Cuerpo>
              </Tabla>
            )}
            <Tabla maxAlto="max-h-80">
              <Cabeza>
                <tr><th className={th}>Categoría</th><th className={thR}>Pronóstico ($)</th><th className={thR}>Consumo real ($)</th><th className={thR}>Error del pronóstico</th></tr>
              </Cabeza>
              <Cuerpo>
                {[...r.precision.porCategoria, ...(r.precision.total ? [r.precision.total] : [])].map((c) => (
                  <tr key={c.categoria} className={c.categoria === 'Total' ? 'bg-slate-900/60 font-medium' : ''}>
                    <td className={td}>{c.categoria}</td>
                    <td className={tdR}>{mm(c.pronostico)}</td>
                    <td className={tdR}>{mm(c.consumoReal)}</td>
                    <td className={tdR}>{pct(c.errorPct)}</td>
                  </tr>
                ))}
              </Cuerpo>
            </Tabla>
          </>
        )}
      </Seccion>

      <Seccion titulo="Detalle por insumo" nota="Llegadas reales = stock de fin de mes − stock del mes anterior + consumo del mes. Se valorizan al costo con el que se presupuestó.">
        <div className="flex flex-wrap items-center gap-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo" className="w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500" />
          <Selector valor={cat} onChange={setCat} etiqueta="Categoría" opciones={[{ valor: 'todas', texto: 'Todas' }, ...categorias.map((c) => ({ valor: c, texto: c }))]} />
          <fieldset className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <legend className="sr-only">Empresas del facturado de referencia</legend>
            <span>Facturado de referencia de:</span>
            {v.empresas.map((e) => (
              <label key={e.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={empresas.includes(e.id)} onChange={() => alternar(e.id)} /> {e.name}
              </label>
            ))}
            {empresas.length === 0 && <span className="text-xs text-slate-500">(sin elegir: solo Frontera Living)</span>}
          </fieldset>
          <span className="text-sm text-slate-500">{filas.length} insumos</span>
        </div>
        <Tabla maxAlto="max-h-[32rem]">
          <Cabeza>
            <tr>
              <th className={th}>Insumo</th>
              <th className={th}>Categoría</th>
              <th className={thR}>Aprobado (u)</th>
              <th className={thR}>Llegadas reales (u)</th>
              <th className={thR}>Costo presup.</th>
              <th className={thR}>Aprobado</th>
              <th className={thR}>Real</th>
              <th className={thR}>Cumplimiento</th>
              <th className={thR}>Desvío</th>
              <th className={thR}>Facturado (ref.)</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {filas.slice(0, limite).map((f) => (
              <tr key={f.productId} className="cursor-pointer hover:bg-slate-900/60" onClick={() => onSku(`#${f.productId}`)}>
                <td className={td}>{f.sku}</td>
                <td className={td}>{f.cat}</td>
                <td className={tdR}>{unidades(f.aprobadoCerradoU)}</td>
                <td className={tdR}>{unidades(f.realU)}</td>
                <td className={tdR}>{pesos(f.costoPresupuesto)}</td>
                <td className={tdR}>{pesos(f.aprobadoCerrado)}</td>
                <td className={tdR}>{pesos(f.real)}</td>
                <td className={tdR}>{pct(f.cumplimiento, 0)}</td>
                <td className={tdR}>{pesos(f.desvio)}</td>
                <td className={tdR}>{pesos(f.facturado)}</td>
              </tr>
            ))}
          </Cuerpo>
        </Tabla>
        {filas.length > limite && (
          <button type="button" onClick={() => setLimite(limite + 200)} className="self-start rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Mostrar más ({filas.length - limite} restantes)
          </button>
        )}
      </Seccion>

      <Seccion titulo="Versiones aprobadas" nota="Las versiones son inmutables: aprobar una nueva no modifica las anteriores.">
        <Tabla>
          <Cabeza>
            <tr><th className={th}>Versión</th><th className={th}>Aprobada</th><th className={th}>Por</th><th className={thR}>Total</th><th className={th}>Estado</th></tr>
          </Cabeza>
          <Cuerpo>
            {v.versiones.map((x) => (
              <tr key={x.id}>
                <td className={td}>{x.nombre}</td>
                <td className={td}>{fechaHora(x.aprobadaEn)}</td>
                <td className={td}>{x.aprobadaPor}</td>
                <td className={tdR}>{mm(x.totalCompra)}</td>
                <td className={td}>{x.vigente ? 'Vigente' : 'Anterior'}</td>
              </tr>
            ))}
          </Cuerpo>
        </Tabla>
      </Seccion>
    </div>
  );
}
