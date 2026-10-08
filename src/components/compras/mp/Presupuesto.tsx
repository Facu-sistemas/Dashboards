// Presupuesto de compras: por categoría y mes de llegada, detalle por insumo con filtros, órdenes a emitir y compras de urgencia.
import { useMemo, useState } from 'react';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { FilaPresupuesto, VistaPresupuesto } from '../../../lib/compras-mp/vistas';
import AprobarVersion from './AprobarVersion';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Grilla, Seccion, Segmentos, Selector, Tabla, Tarjeta, Vacio, mesCorto, mm, num, pesos, td, tdR, th, thR, unidades } from './ui';

type Medida = 'pesos' | 'unidades';
const MESES = [1, 2, 3, 4] as const;
const g = (f: FilaPresupuesto, pre: string, j: number): number => (f as unknown as Record<string, number>)[`${pre}${j}`] ?? 0;
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

export default function Presupuesto({ onSku, puedeEditar }: { onSku: (clave: string) => void; puedeEditar: boolean }) {
  const q = useApiQuery<VistaPresupuesto | { vacio: true }>(['cmp', 'presupuesto'], '/api/compras-mp/datos?vista=presupuesto');
  const [cat, setCat] = useState('todas');
  const [ori, setOri] = useState('todos');
  const [abc, setAbc] = useState('todas');
  const [busca, setBusca] = useState('');
  const [medida, setMedida] = useState<Medida>('pesos');
  const [soloCompra, setSoloCompra] = useState(true);
  const [limite, setLimite] = useState(100);

  const v = q.data && !('vacio' in q.data) ? q.data : null;
  const filas = useMemo(() => {
    if (!v) return [];
    const t = busca.trim().toLowerCase();
    return v.filas
      .filter((f) => (cat === 'todas' || f.cat === cat) && (ori === 'todos' || f.ori === ori) && (abc === 'todas' || f.abc === abc))
      .filter((f) => !t || f.sku.toLowerCase().includes(t) || f.prov.toLowerCase().includes(t))
      .filter((f) => !soloCompra || f.rdt > 0 || f.o0u > 0 || g(f, 'o', 1) + g(f, 'o', 2) + g(f, 'o', 3) + g(f, 'o', 4) > 0)
      .sort((a, b) => b.rdt - a.rdt);
  }, [v, cat, ori, abc, busca, soloCompra]);

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para calcular el presupuesto.</Vacio>;

  const meses = v.corrida.horizonte;
  const categorias = [...new Set(v.filas.map((f) => f.cat))].sort((a, b) => a.localeCompare(b, 'es'));
  const origenes = [...new Set(v.filas.map((f) => f.ori))].sort();
  const porOrigen = origenes.map((o) => {
    const fs = v.filas.filter((f) => f.ori === o);
    return { origen: o, skus: fs.length, meses: MESES.map((j) => sum(fs.map((f) => g(f, 'rd', j)))), total: sum(fs.map((f) => f.rdt)) };
  });
  const urgentes = v.filas
    .filter((f) => g(f, 'bk', 1) + g(f, 'bk', 2) + g(f, 'bk', 3) + g(f, 'bk', 4) > 0 || f.o0u > 0 || g(f, 'fal', 1) + g(f, 'fal', 2) + g(f, 'fal', 3) + g(f, 'fal', 4) > 0)
    .sort((a, b) => (b.o0u + sum(MESES.map((j) => g(b, 'bk', j)))) * b.costo - (a.o0u + sum(MESES.map((j) => g(a, 'bk', j)))) * a.costo);
  const totalFiltrado = sum(filas.map((f) => f.rdt));
  const emitirTotal = sum(v.porCategoria.map((c) => sum(c.emitir)));
  const fmt = (pesosV: number, uV: number) => (medida === 'pesos' ? mm(pesosV) : unidades(uV));

  return (
    <div className="flex flex-col gap-10">
      <AprobarVersion puedeEditar={puedeEditar} version={v.versionVigente} horizonte={v.corrida.horizonte} total={v.total} fechaDatos={v.corrida.fechaDatos} />
      <Grilla>
        <Tarjeta codigo="N1" titulo="Compra proyectada del horizonte" valor={mm(v.total)} detalle={`${v.filas.length} insumos · ${mesCorto(meses[0] ?? '')} – ${mesCorto(meses[3] ?? '')}`} />
        <Tarjeta codigo="N2.2" titulo="Compras de urgencia" valor={mm(v.urgencia)} tono={v.urgencia > 0 ? 'aviso' : 'normal'} detalle={`${urgentes.length} insumos con respaldo o faltante`} />
        <Tarjeta codigo="" titulo="Órdenes a emitir (4 meses)" valor={mm(emitirTotal)} detalle="Llegada menos lead time del origen" />
        <Tarjeta codigo="" titulo="Insumos con compra" valor={num(v.filas.filter((f) => f.rdt > 0).length)} detalle={`de ${v.filas.length} en la base`} />
      </Grilla>

      <Seccion titulo="Compra por categoría y mes de llegada" nota="A costo de Odoo. “Emitir” es lo que hay que ordenar en cada mes para que llegue a tiempo.">
        <Tabla>
          <Cabeza>
            <tr>
              <th className={th}>Categoría</th>
              {meses.map((m) => <th key={m} className={thR}>Llega {mesCorto(m)}</th>)}
              <th className={thR}>Total</th>
              {meses.map((m) => <th key={`e${m}`} className={thR}>Emitir {mesCorto(m)}</th>)}
            </tr>
          </Cabeza>
          <Cuerpo>
            {v.porCategoria.map((c) => (
              <tr key={c.categoria}>
                <td className={td}>{c.categoria}</td>
                {c.meses.map((x, i) => <td key={i} className={tdR}>{mm(x)}</td>)}
                <td className={`${tdR} font-medium`}>{mm(c.total)}</td>
                {c.emitir.map((x, i) => <td key={i} className={tdR}>{mm(x)}</td>)}
              </tr>
            ))}
            <tr className="bg-slate-900/60 font-medium">
              <td className={td}>Total</td>
              {MESES.map((j) => <td key={j} className={tdR}>{mm(sum(v.porCategoria.map((c) => c.meses[j - 1] ?? 0)))}</td>)}
              <td className={tdR}>{mm(v.total)}</td>
              {MESES.map((j) => <td key={j} className={tdR}>{mm(sum(v.porCategoria.map((c) => c.emitir[j - 1] ?? 0)))}</td>)}
            </tr>
          </Cuerpo>
        </Tabla>
      </Seccion>

      <Seccion titulo="Compra por origen" nota="Local: lead time 14 días · Brasil: 40 días · China: 90 días, un contenedor cada 4 meses.">
        <Tabla>
          <Cabeza>
            <tr>
              <th className={th}>Origen</th>
              <th className={thR}>Insumos</th>
              {meses.map((m) => <th key={m} className={thR}>Llega {mesCorto(m)}</th>)}
              <th className={thR}>Total</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {porOrigen.map((o) => (
              <tr key={o.origen}>
                <td className={td}>{o.origen}</td>
                <td className={tdR}>{o.skus}</td>
                {o.meses.map((x, i) => <td key={i} className={tdR}>{mm(x)}</td>)}
                <td className={`${tdR} font-medium`}>{mm(o.total)}</td>
              </tr>
            ))}
          </Cuerpo>
        </Tabla>
      </Seccion>

      {urgentes.length > 0 && (
        <Seccion titulo="Compras de urgencia" nota="China con stock que no alcanza hasta que llegue el contenedor (se compra respaldo local o de Brasil) e insumos que quedan bajo seguridad antes de poder recibir una compra nueva. Conviene emitir ya.">
          <Tabla maxAlto="max-h-96">
            <Cabeza>
              <tr>
                <th className={th}>Insumo</th>
                <th className={th}>Origen</th>
                <th className={th}>Respaldo</th>
                <th className={thR}>Stock</th>
                <th className={thR}>Faltante antes de poder recibir</th>
                <th className={thR}>Respaldo a comprar</th>
                <th className={thR}>Urgencia ($)</th>
              </tr>
            </Cabeza>
            <Cuerpo>
              {urgentes.slice(0, 40).map((f) => {
                const resp = sum(MESES.map((j) => g(f, 'bk', j)));
                return (
                  <tr key={f.clave} className="cursor-pointer hover:bg-slate-900/60" onClick={() => onSku(f.clave)}>
                    <td className={td}>{f.sku}</td>
                    <td className={td}>{f.ori}</td>
                    <td className={td}>{f.resp || '—'}</td>
                    <td className={tdR}>{unidades(f.disp)}</td>
                    <td className={tdR}>{unidades(f.o0u)}</td>
                    <td className={tdR}>{unidades(resp)}</td>
                    <td className={tdR}>{mm((resp + f.o0u) * f.costo)}</td>
                  </tr>
                );
              })}
            </Cuerpo>
          </Tabla>
          {urgentes.length > 40 && <p className="text-xs text-slate-500">Se muestran los 40 de mayor valor, de {urgentes.length}.</p>}
        </Seccion>
      )}

      <Seccion
        titulo="Detalle por insumo"
        nota="Clic en una fila para ver el cálculo paso a paso."
        acciones={<Segmentos valor={medida} onChange={setMedida} opciones={[{ valor: 'pesos', texto: 'Pesos' }, { valor: 'unidades', texto: 'Unidades' }]} />}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar insumo o proveedor"
            className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <Selector valor={cat} onChange={setCat} etiqueta="Categoría" opciones={[{ valor: 'todas', texto: 'Todas' }, ...categorias.map((c) => ({ valor: c, texto: c }))]} />
          <Selector valor={ori} onChange={setOri} etiqueta="Origen" opciones={[{ valor: 'todos', texto: 'Todos' }, ...origenes.map((o) => ({ valor: o, texto: o }))]} />
          <Selector valor={abc} onChange={setAbc} etiqueta="Clase" opciones={['todas', 'A', 'B', 'C', 'Sin consumo'].map((c) => ({ valor: c, texto: c === 'todas' ? 'Todas' : c }))} />
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={soloCompra} onChange={(e) => setSoloCompra(e.target.checked)} /> Solo con compra
          </label>
          <span className="text-sm text-slate-500">{filas.length} insumos · {mm(totalFiltrado)}</span>
        </div>
        <Tabla maxAlto="max-h-[32rem]">
          <Cabeza>
            <tr>
              <th className={th}>Insumo</th>
              <th className={th}>Categoría</th>
              <th className={th}>Origen</th>
              <th className={th}>Clase</th>
              <th className={thR}>Costo</th>
              <th className={thR}>Stock</th>
              {meses.map((m) => <th key={m} className={thR}>Llega {mesCorto(m)}</th>)}
              <th className={thR}>Total</th>
              <th className={thR}>Emitir en {mesCorto(meses[0] ?? '')}</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {filas.slice(0, limite).map((f) => (
              <tr key={f.clave} className="cursor-pointer hover:bg-slate-900/60" onClick={() => onSku(f.clave)}>
                <td className={td}>{f.sku}</td>
                <td className={td}>{f.cat}</td>
                <td className={td}>{f.ori}</td>
                <td className={td}>{f.abc === 'Sin consumo' ? '—' : f.abc}</td>
                <td className={tdR}>{pesos(f.costo)}</td>
                <td className={tdR}>{unidades(f.disp)}</td>
                {MESES.map((j) => <td key={j} className={tdR}>{fmt(g(f, 'rd', j), g(f, 'r', j))}</td>)}
                <td className={`${tdR} font-medium`}>{medida === 'pesos' ? mm(f.rdt) : unidades(f.rt)}</td>
                <td className={tdR}>{medida === 'pesos' ? mm(f.o1) : unidades(f.o1u)}</td>
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
