// Alerta de reposición: insumos cuyo pronóstico en Odoo quedó bajo el mínimo y cuánto pedir (máximo − pronóstico).
import { useMemo, useState } from 'react';
import QueryProvider from '../../QueryProvider';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { ResultadoAlerta } from '../../../lib/compras-mp/alerta-reposicion';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Grilla, Seccion, Tabla, Tarjeta, Vacio, fechaHora, num, td, tdR, th, thR } from './ui';

function Inner() {
  const q = useApiQuery<ResultadoAlerta>(['cmp', 'alerta-reposicion'], '/api/compras-mp/alerta-reposicion');
  const [busca, setBusca] = useState('');
  const v = q.data ?? null;
  const filas = useMemo(() => {
    if (!v) return [];
    const t = busca.trim().toLowerCase();
    return v.filas.filter((f) => !t || f.sku.toLowerCase().includes(t));
  }, [v, busca]);

  if (q.isLoading) return <Cargando texto="Leyendo reglas de reposición en Odoo…" />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  if (!v) return <Vacio>No hay datos.</Vacio>;

  const negativos = v.filas.filter((f) => f.pronostico < 0).length;
  const manuales = v.filas.filter((f) => f.trigger === 'manual').length;

  return (
    <div className="flex flex-col gap-8">
      <Grilla>
        <Tarjeta codigo="" titulo="Para reponer" valor={num(v.filas.length)} tono={v.filas.length ? 'aviso' : 'normal'} detalle={`de ${num(v.totalReglas)} reglas con mínimo`} />
        <Tarjeta codigo="" titulo="Pronóstico negativo" valor={num(negativos)} tono={negativos ? 'aviso' : 'normal'} detalle="Falta material para lo ya comprometido" />
        <Tarjeta codigo="" titulo="Disparador manual" valor={num(manuales)} detalle="Odoo no los compra ni avisa solo" />
      </Grilla>

      <Seccion
        titulo="Insumos para reponer"
        nota={`Pronóstico = disponible + entrante − saliente (lo que calcula Odoo). A pedir = máximo − pronóstico, redondeado al múltiplo. Leído de Odoo el ${fechaHora(v.leidoEn)}.`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo" className="w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500" />
          <span className="text-sm text-slate-500">{filas.length} insumos</span>
        </div>
        {filas.length === 0 ? (
          <Vacio>Ninguna regla está por debajo de su mínimo.</Vacio>
        ) : (
          <Tabla maxAlto="max-h-[40rem]">
            <Cabeza>
              <tr>
                <th className={th}>Insumo</th>
                <th className={th}>Ubicación</th>
                <th className={thR}>Disponible</th>
                <th className={thR}>Pronóstico</th>
                <th className={thR}>Mínimo</th>
                <th className={thR}>Máximo</th>
                <th className={thR}>A pedir</th>
                <th className={thR}>Odoo muestra</th>
                <th className={thR}>En RFQ</th>
                <th className={th}>Disparador</th>
              </tr>
            </Cabeza>
            <Cuerpo>
              {filas.map((f) => (
                <tr key={f.reglaId}>
                  <td className={td}>{f.sku}</td>
                  <td className={td}>{f.ubicacion}</td>
                  <td className={tdR}>{num(f.disponible, 2)}</td>
                  <td className={`${tdR} ${f.pronostico < 0 ? 'text-status-red' : ''}`}>{num(f.pronostico, 2)}</td>
                  <td className={tdR}>{num(f.min)}</td>
                  <td className={tdR}>{num(f.max)}</td>
                  <td className={`${tdR} font-medium text-slate-100`}>{num(f.aPedir)} {f.unidad}</td>
                  <td className={`${tdR} ${Math.abs(f.aPedirOdoo - f.aPedir) > 1 ? 'text-status-yellow' : ''}`}>{num(f.aPedirOdoo)}</td>
                  <td className={tdR}>{f.enRfq ? num(f.enRfq) : '—'}</td>
                  <td className={td}>{f.trigger === 'manual' ? 'Manual' : 'Automático'}</td>
                </tr>
              ))}
            </Cuerpo>
          </Tabla>
        )}
      </Seccion>
    </div>
  );
}

export default function AlertaReposicion() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
