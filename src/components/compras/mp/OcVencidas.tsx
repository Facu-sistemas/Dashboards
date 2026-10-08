// Control de OC vencidas: líneas con fecha prevista pasada y entrante pendiente, con la sugerencia y la decisión de Compras.
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '../../dashboard/useApiQuery';
import { DECISIONES } from '../../../lib/compras-mp/constantes';
import type { FilaOcVista, VistaOc } from '../../../lib/compras-mp/vistas';
import { postJson } from './acciones';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Grilla, Seccion, Selector, Tabla, Tarjeta, Vacio, fechaCorta, fechaHora, mm, num, pct, td, tdR, th, thR, unidades } from './ui';

function Editor({ fila, onListo }: { fila: FilaOcVista; onListo: () => void }) {
  const [decision, setDecision] = useState<string>(fila.decision?.decision ?? 'Reclamar');
  const [fecha, setFecha] = useState(fila.decision?.nuevaFecha ?? '');
  const [comentario, setComentario] = useState(fila.decision?.comentario ?? '');
  const cliente = useQueryClient();
  const guardar = useMutation({
    mutationFn: () => postJson('/api/compras-mp/oc-decision', { ocId: fila.ordenId, productId: fila.productId, decision, nuevaFecha: fecha || null, comentario: comentario || null }),
    onSuccess: async () => { await cliente.invalidateQueries({ queryKey: ['cmp', 'oc'] }); onListo(); },
  });
  return (
    <div className="flex flex-wrap items-end gap-3 bg-slate-900/60 px-3 py-3">
      <Selector valor={decision} onChange={setDecision} etiqueta="Decisión" opciones={DECISIONES.map((d) => ({ valor: d, texto: d }))} />
      <label className="flex items-center gap-2 text-sm text-slate-400">
        Nueva fecha
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
      </label>
      <label className="flex flex-1 items-center gap-2 text-sm text-slate-400">
        Comentario
        <input value={comentario} maxLength={300} onChange={(e) => setComentario(e.target.value)} className="min-w-48 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200" />
      </label>
      <button type="button" disabled={guardar.isPending} onClick={() => guardar.mutate()} className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-brand-400 disabled:opacity-50">
        {guardar.isPending ? 'Guardando…' : 'Guardar decisión'}
      </button>
      <button type="button" onClick={onListo} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Cancelar</button>
      {guardar.isError && <p className="w-full text-sm text-status-red">{(guardar.error as Error).message}</p>}
    </div>
  );
}

export default function OcVencidas({ onSku, puedeEditar }: { onSku: (clave: string) => void; puedeEditar: boolean }) {
  const q = useApiQuery<VistaOc | { vacio: true }>(['cmp', 'oc'], '/api/compras-mp/datos?vista=oc');
  const [sug, setSug] = useState('todas');
  const [dec, setDec] = useState('todas');
  const [busca, setBusca] = useState('');
  const [abierta, setAbierta] = useState<number | null>(null);
  const v = q.data && !('vacio' in q.data) ? q.data : null;

  const filas = useMemo(() => {
    if (!v) return [];
    const t = busca.trim().toLowerCase();
    return v.filas
      .filter((f) => sug === 'todas' || f.sugerencia === sug)
      .filter((f) => dec === 'todas' || (dec === 'sin' ? !f.decision : f.decision?.decision === dec))
      .filter((f) => !t || `${f.insumo} ${f.proveedor} ${f.oc}`.toLowerCase().includes(t));
  }, [v, sug, dec, busca]);

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>Todavía no hay datos. Apretá “Actualizar ahora” para calcular el control de OC.</Vacio>;

  const sugerencias = [...new Set(v.filas.map((f) => f.sugerencia))];
  const porSug = (s: string) => v.filas.filter((f) => f.sugerencia === s);
  const decididas = v.filas.filter((f) => f.decision).length;

  return (
    <div className="flex flex-col gap-8">
      <Grilla>
        <Tarjeta codigo="" titulo="Total vencido" valor={mm(v.total)} tono="aviso" detalle={`${v.filas.length} líneas de OC · ${decididas} con decisión`} />
        {sugerencias.map((s) => (
          <Tarjeta key={s} codigo="" titulo={s} valor={String(porSug(s).length)} detalle={mm(porSug(s).reduce((a, f) => a + f.valor, 0))} />
        ))}
      </Grilla>

      <Seccion titulo="OC vencidas" nota="Ordenadas por valor. Decidí línea por línea si se espera, se reclama o se cierra el saldo en Odoo; la decisión queda con quién y cuándo y se mantiene al actualizar.">
        <div className="flex flex-wrap items-center gap-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar OC, insumo o proveedor" className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500" />
          <Selector valor={sug} onChange={setSug} etiqueta="Sugerencia" opciones={[{ valor: 'todas', texto: 'Todas' }, ...sugerencias.map((s) => ({ valor: s, texto: s }))]} />
          <Selector valor={dec} onChange={setDec} etiqueta="Decisión" opciones={[{ valor: 'todas', texto: 'Todas' }, { valor: 'sin', texto: 'Sin decidir' }, ...DECISIONES.map((d) => ({ valor: d as string, texto: d }))]} />
          <span className="text-sm text-slate-500">{filas.length} líneas</span>
        </div>
        <Tabla maxAlto="max-h-[40rem]">
          <Cabeza>
            <tr>
              <th className={th}>OC</th>
              <th className={th}>Proveedor</th>
              <th className={th}>Insumo</th>
              <th className={th}>Prevista</th>
              <th className={thR}>Días de atraso</th>
              <th className={thR}>% recibido</th>
              <th className={thR}>Pendiente</th>
              <th className={thR}>Valor</th>
              <th className={th}>Última recepción</th>
              <th className={th}>Recepción programada</th>
              <th className={th}>OC más nueva</th>
              <th className={thR}>Cobertura sin esta OC (sem)</th>
              <th className={th}>Sugerencia</th>
              <th className={th}>Decisión</th>
            </tr>
          </Cabeza>
          <Cuerpo>
            {filas.map((f) => {
              const id = f.lineaId ?? f.fila;
              return (
                <Fragment key={id}>
                  <tr className={f.productId ? 'cursor-pointer hover:bg-slate-900/60' : ''} onClick={() => f.productId && onSku(`#${f.productId}`)}>
                    <td className={td}>{f.oc}</td>
                    <td className={td}>{f.proveedor}</td>
                    <td className={td}>{f.insumo}</td>
                    <td className={td}>{fechaCorta(f.fechaPrevista)}</td>
                    <td className={tdR}>{num(f.diasAtraso)}</td>
                    <td className={tdR}>{pct(f.pctRecibido, 0)}</td>
                    <td className={tdR}>{unidades(f.asignado)}</td>
                    <td className={tdR}>{mm(f.valor)}</td>
                    <td className={td}>{fechaCorta(f.ultimaRecepcion)}</td>
                    <td className={td}>{fechaCorta(f.recepcionProgramada)}</td>
                    <td className={td}>{f.hayOcMasNueva ? 'Sí' : 'No'}</td>
                    <td className={tdR}>{num(f.coberturaSinOc, 1)}</td>
                    <td className={td}>{f.sugerencia}</td>
                    <td className={td} onClick={(e) => e.stopPropagation()}>
                      {f.decision ? (
                        <div className="text-xs">
                          <p className="font-medium text-slate-200">{f.decision.decision}{f.decision.nuevaFecha ? ` → ${fechaCorta(f.decision.nuevaFecha)}` : ''}</p>
                          <p className="text-slate-500" title={f.decision.comentario ?? ''}>{f.decision.usuario} · {fechaHora(f.decision.creadoEn)}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Sin decidir</span>
                      )}
                      {puedeEditar && f.ordenId !== null && f.productId !== null && (
                        <button type="button" onClick={() => setAbierta(abierta === id ? null : id)} className="mt-1 block text-xs text-brand-400 hover:underline">
                          {f.decision ? 'Cambiar' : 'Decidir'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {abierta === id && (
                    <tr>
                      <td colSpan={14} className="p-0">
                        <Editor fila={f} onListo={() => setAbierta(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Cuerpo>
        </Tabla>
      </Seccion>
    </div>
  );
}
