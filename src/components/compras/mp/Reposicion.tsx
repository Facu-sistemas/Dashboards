// Reglas de reabastecimiento: mínimos y máximos por insumo y archivo para importar en Odoo (la web nunca escribe en Odoo).
import { useMemo, useState } from 'react';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { ResultadoReposicion } from '../../../lib/compras-mp/reposicion';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Etiqueta, Grilla, Seccion, Selector, Tabla, Tarjeta, Vacio, num, td, tdR, th, thR, unidades } from './ui';

type Datos = ResultadoReposicion & { corrida: { id: string; fechaDatos: string } };

export default function Reposicion() {
  const q = useApiQuery<Datos | { vacio: true }>(['cmp', 'reposicion'], '/api/compras-mp/reposicion');
  const [filtro, setFiltro] = useState<'con' | 'sin' | 'todas'>('con');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(100);
  const v = q.data && !('vacio' in q.data) ? q.data : null;
  const filas = useMemo(() => {
    if (!v) return [];
    const t = busca.trim().toLowerCase();
    return v.filas.filter((f) => (filtro === 'todas' || (filtro === 'con' ? f.lleva : !f.lleva)) && (!t || f.sku.toLowerCase().includes(t)));
  }, [v, filtro, busca]);

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para calcular.</Vacio>;

  const llevan = v.filas.filter((f) => f.lleva);
  const nuevas = llevan.filter((f) => !f.existe).length;
  const paraActualizar = llevan.filter((f) => f.existe && f.id).length;
  const sinId = llevan.filter((f) => f.existe && !f.id).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-status-yellow/40 bg-status-yellow/10 p-4 text-sm text-slate-200">
        <p className="font-medium">Importar primero en staging.</p>
        <p className="mt-1 text-slate-300">
          Esta pantalla solo genera el archivo: la web no escribe en Odoo. Una persona lo importa a mano en Odoo (Inventario → Reabastecimiento → Importar), probándolo antes en el entorno de pruebas.
        </p>
      </div>

      <Grilla>
        <Tarjeta codigo="" titulo="Insumos con regla" valor={num(llevan.length)} detalle={`de ${v.filas.length} (el resto: discontinuados, consignados, agotar stock o sin consumo)`} />
        <Tarjeta codigo="" titulo="Reglas nuevas" valor={num(nuevas)} detalle="Productos que todavía no tienen regla en Odoo" />
        <Tarjeta codigo="" titulo="Reglas a actualizar" valor={num(paraActualizar)} detalle="Ya existen en Odoo y se identifican por su ID externo" />
        <Tarjeta codigo="" titulo="Fuera del archivo" valor={num(sinId)} tono={sinId ? 'aviso' : 'normal'} detalle="Ya tienen regla pero sin ID externo: se excluyen para no duplicarlas" />
      </Grilla>

      {v.advertencias.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          {v.advertencias.map((a) => <li key={a}>• {a}</li>)}
        </ul>
      )}

      <Seccion
        titulo="Archivo para importar en Odoo"
        nota={`Ubicación: ${v.ubicacion} · datos de Odoo del ${v.corrida.fechaDatos.split('-').reverse().join('/')}. Mínimo = stock objetivo de hoy (punto de pedido) redondeado hacia arriba; máximo = stock máximo de hoy; China avisa pero no dispara sola.`}
        acciones={
          <a href="/api/compras-mp/reposicion?formato=csv" className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-brand-400">
            Descargar archivo para importar en Odoo
          </a>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo" className="w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500" />
          <Selector valor={filtro} onChange={setFiltro} etiqueta="Mostrar" opciones={[{ valor: 'con', texto: 'Con regla' }, { valor: 'sin', texto: 'Sin regla' }, { valor: 'todas', texto: 'Todos' }]} />
          <span className="text-sm text-slate-500">{filas.length} insumos</span>
        </div>
        <Tabla maxAlto="max-h-[32rem]">
          <Cabeza>
            <tr>
              <th className={th}>Insumo</th>
              <th className={th}>Categoría</th>
              <th className={th}>Origen</th>
              <th className={th}>Clase</th>
              <th className={thR}>Disponible</th>
              <th className={thR}>Mínimo</th>
              <th className={thR}>Máximo</th>
              <th className={th}>Disparador</th>
              <th className={th}>Estado de la política</th>
              <th className={th}>Regla en Odoo</th>
              <th className={th}>Motivo</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {filas.slice(0, limite).map((f) => (
              <tr key={`${f.productId}-${f.sku}`}>
                <td className={td}>{f.sku}</td>
                <td className={td}>{f.categoria}</td>
                <td className={td}>{f.origen}</td>
                <td className={td}>{f.abc === 'Sin consumo' ? '—' : f.abc}</td>
                <td className={tdR}>{unidades(f.disponible)}</td>
                <td className={tdR}>{f.lleva ? num(f.min) : '—'}</td>
                <td className={tdR}>{f.lleva ? num(f.max) : '—'}</td>
                <td className={td}>{f.lleva ? f.trigger : '—'}</td>
                <td className={td}>{f.estado ? <Etiqueta texto={f.estado} /> : '—'}</td>
                <td className={td}>{f.existe ? (f.id ? 'Existe (se actualiza)' : 'Existe sin ID externo') : 'Nueva'}</td>
                <td className={`${td} text-xs text-slate-400`}>{f.motivo}</td>
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
