// Inventario frente a la política: por categoría, por clase ABC y detalle por insumo.
import { useMemo, useState } from 'react';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { VistaInventario } from '../../../lib/compras-mp/vistas';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Etiqueta, Grilla, Seccion, Selector, Tabla, Tarjeta, Vacio, mm, num, pct, pesos, td, tdR, th, thR, unidades, veces } from './ui';

const ESTADOS = ['Debajo del stock de seguridad', 'Debajo del objetivo', 'En rango', 'Exceso', 'Discontinuado', 'Agotar stock', 'Consignado', 'Sin consumo proyectado', 'Sin stock ni consumo'];

export default function Inventario({ onSku }: { onSku: (clave: string) => void }) {
  const q = useApiQuery<VistaInventario | { vacio: true }>(['cmp', 'inventario'], '/api/compras-mp/datos?vista=inventario');
  const [cat, setCat] = useState('todas');
  const [abc, setAbc] = useState('todas');
  const [estado, setEstado] = useState('todos');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(100);

  const v = q.data && !('vacio' in q.data) ? q.data : null;
  const filas = useMemo(() => {
    if (!v) return [];
    const t = busca.trim().toLowerCase();
    return v.filas
      .filter((f) => (cat === 'todas' || f.cat === cat) && (abc === 'todas' || f.abc === abc) && (estado === 'todos' || f.estado === estado))
      .filter((f) => !t || f.sku.toLowerCase().includes(t))
      .sort((a, b) => b.es - a.es || b.eh - a.eh);
  }, [v, cat, abc, estado, busca]);

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para calcular el inventario.</Vacio>;

  const k = v.kpis;
  const categorias = v.porCategoria.map((c) => c.categoria);

  return (
    <div className="flex flex-col gap-10">
      <Grilla>
        <Tarjeta codigo="N2.1" titulo="Valorización del inventario" valor={mm(k.valorizacion)} detalle={`Ideal según política: ${mm(k.valorIdeal)}`} />
        <Tarjeta codigo="N1" titulo="Capital inmovilizado" valor={mm(k.capitalInmovilizado)} tono="aviso" detalle={`${pct(k.pctCapitalInmovilizado)} del valor`} />
        <Tarjeta codigo="N1" titulo="% SKUs dentro de la política" valor={pct(k.pctDentroPolitica)} detalle={`${k.skusPorEstado.enRango} en rango · ${k.skusPorEstado.exceso} en exceso`} />
        <Tarjeta codigo="N2.3" titulo="Rotación real" valor={veces(k.rotacionReal)} detalle={`Sin movimiento 3+ meses: ${pct(k.pctSinMovimiento)}`} />
      </Grilla>

      <Seccion titulo="Por clase ABC" nota="A: hasta el 80 % del consumo valorizado · B: hasta el 95 % · C: el resto.">
        <Tabla>
          <Cabeza>
            <tr>
              <th className={th}>Clase</th>
              <th className={thR}>Bajo seguridad</th>
              <th className={thR}>Bajo objetivo</th>
              <th className={thR}>En rango</th>
              <th className={thR}>Exceso</th>
              <th className={thR}>Exceso sobre máximo</th>
              <th className={thR}>Capital inmovilizado</th>
              <th className={thR}>Objetivo hoy</th>
              <th className={thR}>Stock actual</th>
              <th className={thR}>Desviación</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {[...v.porClase, v.totalClase].map((c) => (
              <tr key={c.clase} className={c.clase === 'Total' ? 'bg-slate-900/60 font-medium' : ''}>
                <td className={td}>{c.clase}</td>
                <td className={tdR}>{c.bajoSeguridad}</td>
                <td className={tdR}>{c.bajoObjetivo}</td>
                <td className={tdR}>{c.enRango}</td>
                <td className={tdR}>{c.exceso}</td>
                <td className={tdR}>{mm(c.valorExceso)}</td>
                <td className={tdR}>{mm(c.capitalInmovilizado)}</td>
                <td className={tdR}>{mm(c.objetivoHoy)}</td>
                <td className={tdR}>{mm(c.stockActual)}</td>
                <td className={tdR}>{pct(c.desviacion, 0)}</td>
              </tr>
            ))}
          </Cuerpo>
        </Tabla>
      </Seccion>

      <Seccion titulo="Por categoría">
        <Tabla>
          <Cabeza>
            <tr>
              <th className={th}>Categoría</th>
              <th className={thR}>Valor actual</th>
              <th className={thR}>Valor ideal</th>
              <th className={thR}>Variación</th>
              <th className={thR}>Exceso sobre máximo</th>
              <th className={thR}>Sin movimiento 3+ meses</th>
              <th className={thR}>Capital inmovilizado</th>
              <th className={thR}>Rotación real</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {v.porCategoria.map((c) => (
              <tr key={c.categoria} className="cursor-pointer hover:bg-slate-900/60" onClick={() => setCat(c.categoria)}>
                <td className={td}>{c.categoria}</td>
                <td className={tdR}>{mm(c.valorActual)}</td>
                <td className={tdR}>{mm(c.valorIdeal)}</td>
                <td className={tdR}>{mm(c.variacion)}</td>
                <td className={tdR}>{mm(c.excesoSobreMaximo)}</td>
                <td className={tdR}>{mm(c.sinMovimiento)}</td>
                <td className={tdR}>{mm(c.capitalInmovilizado)}</td>
                <td className={tdR}>{num(c.rotacionReal, 1)}</td>
              </tr>
            ))}
            <tr className="bg-slate-900/60 font-medium">
              <td className={td}>Total</td>
              <td className={tdR}>{mm(v.total.valorActual)}</td>
              <td className={tdR}>{mm(v.total.valorIdeal)}</td>
              <td className={tdR}>{mm(v.total.variacion)}</td>
              <td className={tdR}>{mm(v.total.excesoSobreMaximo)}</td>
              <td className={tdR}>{mm(v.total.sinMovimiento)}</td>
              <td className={tdR}>{mm(v.total.capitalInmovilizado)}</td>
              <td className={tdR}>{num(v.total.rotacionReal, 1)}</td>
            </tr>
          </Cuerpo>
        </Tabla>
        <p className="text-xs text-slate-500">Clic en una categoría para filtrar el detalle de abajo.</p>
      </Seccion>

      <Seccion titulo="Detalle por insumo" nota="Ordenado por capital inmovilizado. Clic en una fila para ver el cálculo paso a paso.">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar insumo"
            className="w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <Selector valor={cat} onChange={setCat} etiqueta="Categoría" opciones={[{ valor: 'todas', texto: 'Todas' }, ...categorias.map((c) => ({ valor: c, texto: c }))]} />
          <Selector valor={abc} onChange={setAbc} etiqueta="Clase" opciones={['todas', 'A', 'B', 'C', 'Sin consumo'].map((c) => ({ valor: c, texto: c === 'todas' ? 'Todas' : c }))} />
          <Selector valor={estado} onChange={setEstado} etiqueta="Estado" opciones={[{ valor: 'todos', texto: 'Todos' }, ...ESTADOS.map((e) => ({ valor: e, texto: e }))]} />
          <span className="text-sm text-slate-500">{filas.length} insumos</span>
        </div>
        <Tabla maxAlto="max-h-[32rem]">
          <Cabeza>
            <tr>
              <th className={th}>Insumo</th>
              <th className={th}>Categoría</th>
              <th className={th}>Clase</th>
              <th className={th}>Origen</th>
              <th className={th}>Estado</th>
              <th className={thR}>Cobertura (sem)</th>
              <th className={thR}>Seguridad / objetivo / máx. (sem)</th>
              <th className={thR}>Stock</th>
              <th className={thR}>Valor actual</th>
              <th className={thR}>Valor ideal</th>
              <th className={thR}>Capital inmovilizado</th>
              <th className={thR}>Rotación real</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {filas.slice(0, limite).map((f) => (
              <tr key={f.clave} className="cursor-pointer hover:bg-slate-900/60" onClick={() => onSku(f.clave)}>
                <td className={td}>{f.sku}</td>
                <td className={td}>{f.cat}</td>
                <td className={td}>{f.abc === 'Sin consumo' ? '—' : f.abc}</td>
                <td className={td}>{f.ori}</td>
                <td className={td}>{f.estado ? <Etiqueta texto={f.estado} /> : '—'}</td>
                <td className={tdR}>{num(f.el, 1)}</td>
                <td className={tdR}>{num(f.ss, 1)} / {num(f.obs, 1)} / {num(f.mxs, 1)}</td>
                <td className={tdR}>{unidades(f.disp)}</td>
                <td className={tdR}>{pesos(f.eh)}</td>
                <td className={tdR}>{pesos(f.ej)}</td>
                <td className={tdR}>{pesos(f.es)}</td>
                <td className={tdR}>{num(f.fj, 1)}</td>
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
    </div>
  );
}
