// Ficha de un insumo: el cálculo del presupuesto paso a paso (método, coeficiente, proyección, política, compra y órdenes).
import type { ReactNode } from 'react';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { VistaSku } from '../../../lib/compras-mp/vistas';
import type { FilaCompleta } from '../../../lib/compras-mp/indicadores';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Etiqueta, Seccion, Tabla, Vacio, mesCorto, num, pesos, td, tdR, th, thR, unidades } from './ui';

const MESES = [1, 2, 3, 4] as const;
const g = (f: FilaCompleta, pre: string, j: number): number => (f as unknown as Record<string, number>)[`${pre}${j}`] ?? 0;

function Dato({ titulo, valor, nota }: { titulo: string; valor: ReactNode; nota?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-slate-100">{valor}</p>
      {nota && <p className="mt-0.5 text-xs text-slate-400">{nota}</p>}
    </div>
  );
}

function Grupo({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

export default function FichaSku({ clave, onElegir }: { clave: string | null; onElegir: (clave: string) => void }) {
  const url = `/api/compras-mp/datos?vista=sku${clave ? `&clave=${encodeURIComponent(clave)}` : ''}`;
  const q = useApiQuery<VistaSku | { vacio: true }>(['cmp', 'sku', clave ?? ''], url);
  const v = q.data && !('vacio' in q.data) ? q.data : null;

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para calcular el presupuesto.</Vacio>;

  const f = v.fila;
  const meses = v.meses;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-400">
          Insumo
          <input
            list="cmp-skus"
            defaultValue={f?.sku ?? ''}
            key={f?.clave ?? 'vacio'}
            placeholder="Escribí para buscar"
            className="w-80 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
            onChange={(e) => {
              const m = v.lista.find((x) => x.sku === e.target.value);
              if (m) onElegir(m.clave);
            }}
          />
        </label>
        <datalist id="cmp-skus">
          {v.lista.map((x) => (
            <option key={x.clave} value={x.sku}>{x.cat}</option>
          ))}
        </datalist>
      </div>

      {!f && <Vacio>Elegí un insumo para ver cómo se calculó su compra, o hacé clic en una fila de Presupuesto, Inventario u OC vencidas.</Vacio>}

      {f && (
        <>
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{f.sku}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              {f.cat} · línea {f.lin} · {f.prov || 'sin proveedor'} · origen {f.ori}
              {f.resp ? ` (respaldo: ${f.resp})` : ''}
              {f.abc !== 'Sin consumo' && <Etiqueta texto={`Clase ${f.abc}`} />}
            </p>
          </div>

          <Seccion titulo="1 · Punto de partida" nota="Datos de Odoo a la fecha de la corrida.">
            <Grupo>
              <Dato titulo="Disponible" valor={unidades(f.disp)} />
              <Dato titulo="Entrante" valor={unidades(f.ent)} nota={f.ev > 0 ? `${unidades(f.ev)} vencido pasa al mes 2` : undefined} />
              <Dato titulo="Costo unitario" valor={pesos(f.costo)} nota={f.costo === 0 ? 'Costo 0: se trata como consignado' : undefined} />
              <Dato titulo="Método" valor={f.met} nota={`Driver: ${f.drv}`} />
            </Grupo>
          </Seccion>

          <Seccion titulo="2 · Consumo y coeficiente" nota="Consumo real de los 4 meses cerrados dividido por el driver (lo que se produjo en esos meses).">
            <Grupo>
              <Dato titulo="Consumo de los 4 meses cerrados" valor={[f.c1, f.c2, f.c3, f.c4].map((x) => unidades(x)).join(' · ')} nota={`Total ${unidades(f.c4t)}`} />
              <Dato titulo="Coeficiente promedio" valor={num(f.coefb, 6)} />
              <Dato titulo="Tendencia" valor={f.tend || '—'} nota={f.tend === 'Creciente' ? 'Se usa el coeficiente del último mes' : undefined} />
              <Dato titulo="Coeficiente usado" valor={num(f.coef, 6)} nota={f.forz > 0 ? `Consumo mensual forzado: ${unidades(f.forz)}` : undefined} />
            </Grupo>
          </Seccion>

          <Seccion titulo="3 · Política de inventario" nota="Stock objetivo al cierre = (lead time + seguridad) × consumo semanal del mes siguiente.">
            <Grupo>
              <Dato titulo="Lead time" valor={`${num(f.lt, 1)} sem`} nota={f.ltb ? `Respaldo: ${num(f.ltb, 1)} sem` : undefined} />
              <Dato titulo="Stock de seguridad" valor={`${num(f.ss, 1)} sem`} nota={f.crit ? 'Insumo crítico' : undefined} />
              <Dato titulo="Objetivo / máximo" valor={`${num(f.obs, 1)} / ${num(f.mxs, 1)} sem`} />
              <Dato titulo="Ciclo de compra" valor={f.cic > 1 ? `${f.cic} meses (importación)` : 'Mensual'} />
            </Grupo>
          </Seccion>

          <Seccion titulo="4 · Mes a mes" nota="Proyección de consumo, lo que llega, la compra que hace falta y el stock con que cierra cada mes.">
            <Tabla>
              <Cabeza>
                <tr>
                  <th className={th}>Concepto</th>
                  {meses.map((m) => <th key={m} className={thR}>{mesCorto(m)}</th>)}
                  <th className={thR}>Total</th>
                </tr>
              </Cabeza>
              <Cuerpo>
                {(
                  [
                    ['Consumo proyectado (u)', 'p', false],
                    ['Entrante que llega (u)', 'e', false],
                    ['Compra regular (u)', 'rg', true],
                    ['Importación de China (u)', 'ch', true],
                    ['Respaldo (u)', 'bk', true],
                    ['Compra total que llega (u)', 'r', true],
                    ['Compra total que llega ($)', 'rd', true],
                    ['Stock al cierre del mes (u)', 'en', false],
                    ['Déficit sin respaldo (u)', 'fal', true],
                    ['Orden a emitir (u)', 'o', false],
                  ] as const
                ).map(([texto, pre, suma]) => {
                  const valores = pre === 'o' ? [f.o1u, f.o2u, f.o3u, f.o4u] : MESES.map((j) => g(f, pre, j));
                  const fmt = (x: number) => (pre === 'rd' ? pesos(x) : unidades(x));
                  return (
                    <tr key={texto}>
                      <td className={td}>{texto}</td>
                      {valores.map((x, i) => <td key={i} className={tdR}>{fmt(x)}</td>)}
                      <td className={tdR}>{suma || pre === 'o' ? fmt(valores.reduce((a, x) => a + x, 0)) : '—'}</td>
                    </tr>
                  );
                })}
              </Cuerpo>
            </Tabla>
          </Seccion>

          <Seccion titulo="5 · Alertas y estado de hoy">
            <Grupo>
              <Dato titulo="Faltante antes de poder recibir" valor={unidades(f.o0u)} nota={f.o0u > 0 ? 'Bajo seguridad: emitir ya' : 'Sin faltante'} />
              <Dato titulo="Quiebre proyectado" valor={f.qm ? `Mes ${f.qm}` : 'No'} nota={f.qm ? 'Ninguna compra llega a tiempo' : undefined} />
              <Dato titulo="Estado frente a la política" valor={f.estado ? <Etiqueta texto={f.estado} /> : '—'} nota={f.el !== null ? `Cobertura ${num(f.el, 1)} sem` : undefined} />
              <Dato titulo="Capital inmovilizado" valor={pesos(f.es)} nota={`Valor actual ${pesos(f.eh)} · ideal ${pesos(f.ej)}`} />
            </Grupo>
          </Seccion>
        </>
      )}
    </div>
  );
}
