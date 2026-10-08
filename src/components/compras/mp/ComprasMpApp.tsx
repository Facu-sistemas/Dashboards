// Módulo Compras MP: navegación entre pantallas, estado de la última corrida y botón "Actualizar ahora".
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import QueryProvider from '../../QueryProvider';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { CorridaGuardada } from '../../../lib/compras-mp/corrida';
import BandaControles from './BandaControles';
import Evolucion from './Evolucion';
import FichaSku from './FichaSku';
import Inventario from './Inventario';
import OcVencidas from './OcVencidas';
import Parametros from './Parametros';
import Presupuesto from './Presupuesto';
import Reposicion from './Reposicion';
import Rendicion from './Rendicion';
import Seguimiento from './Seguimiento';
import { postJson } from './acciones';
import { Segmentos, fechaHora, fechaCorta } from './ui';

type Pantalla = 'rendicion' | 'evolucion' | 'presupuesto' | 'inventario' | 'sku' | 'seguimiento' | 'oc' | 'reposicion' | 'parametros';
const PANTALLAS: { valor: Pantalla; texto: string; soloCompras?: boolean }[] = [
  { valor: 'rendicion', texto: 'Rendición de cuentas' },
  { valor: 'evolucion', texto: 'Evolución' },
  { valor: 'presupuesto', texto: 'Presupuesto' },
  { valor: 'inventario', texto: 'Inventario' },
  { valor: 'sku', texto: 'Ficha SKU' },
  { valor: 'seguimiento', texto: 'Seguimiento' },
  { valor: 'oc', texto: 'OC vencidas' },
  { valor: 'reposicion', texto: 'Reglas de reabastecimiento' },
  { valor: 'parametros', texto: 'Parámetros', soloCompras: true },
];

interface Ultima {
  corrida: CorridaGuardada | null;
  ultimoIntento: { estado: string; error: string | null; creadaEn: string } | null;
  puedeActualizar: boolean;
}

function leerHash(): Pantalla {
  if (typeof window === 'undefined') return 'rendicion';
  const h = window.location.hash.replace('#', '') as Pantalla;
  return PANTALLAS.some((p) => p.valor === h) ? h : 'rendicion';
}

function Inner() {
  const [pantalla, setPantalla] = useState<Pantalla>('rendicion');
  const [clave, setClave] = useState<string | null>(null);
  const cliente = useQueryClient();
  const ultima = useApiQuery<Ultima>(['cmp', 'ultima'], '/api/compras-mp/ultima');

  useEffect(() => setPantalla(leerHash()), []);
  const ir = (p: Pantalla) => {
    setPantalla(p);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${p}`);
  };
  const verSku = (c: string) => {
    setClave(c);
    ir('sku');
  };

  const [paso, setPaso] = useState<1 | 2>(1);
  const actualizar = useMutation({
    // Dos llamadas seguidas (leer Odoo / calcular): cada una queda lejos del límite de tiempo del servidor.
    mutationFn: async () => {
      setPaso(1);
      const leida = await postJson<{ corridaId: string }>('/api/compras-mp/actualizar', { paso: 'leer' });
      setPaso(2);
      await postJson('/api/compras-mp/actualizar', { paso: 'calcular', corridaId: leida.corridaId });
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['cmp'] }),
  });

  const u = ultima.data;
  const c = u?.corrida ?? null;
  const puedeEditar = !!u?.puedeActualizar;
  const pantallas = PANTALLAS.filter((p) => !p.soloCompras || puedeEditar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
        <div className="text-sm text-slate-400">
          {c ? (
            <>
              Datos de Odoo del <span className="font-medium text-slate-200">{fechaCorta(c.fechaDatos)}</span> · calculado el {fechaHora(c.creadaEn)}
              {c.origen === 'cron' ? ' (automático)' : c.disparadaPor ? ` por ${c.disparadaPor}` : ''}
            </>
          ) : ultima.isLoading ? (
            'Buscando la última actualización…'
          ) : (
            'Todavía no hay una actualización calculada.'
          )}
          {u?.ultimoIntento && u.ultimoIntento.estado === 'error' && (
            <span className="ml-2 text-status-red">La última actualización falló: {u.ultimoIntento.error}</span>
          )}
          {u?.ultimoIntento && u.ultimoIntento.estado === 'corriendo' && <span className="ml-2 text-status-yellow">Hay una actualización en curso…</span>}
        </div>
        {u?.puedeActualizar && (
          <button
            type="button"
            disabled={actualizar.isPending}
            onClick={() => actualizar.mutate()}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-brand-400 disabled:cursor-wait disabled:opacity-60"
          >
            {actualizar.isPending ? (paso === 1 ? 'Paso 1 de 2: leyendo Odoo… (unos 40 s)' : 'Paso 2 de 2: calculando…') : 'Actualizar ahora'}
          </button>
        )}
      </div>
      {actualizar.isError && <div className="rounded-lg border border-status-red/40 bg-status-red/10 p-3 text-sm text-status-red">{(actualizar.error as Error).message}</div>}

      {c && c.controles.length > 0 && <BandaControles controles={c.controles} />}

      <nav aria-label="Pantallas de Compras MP">
        <Segmentos valor={pantalla} onChange={ir} opciones={pantallas} />
      </nav>

      {pantalla === 'rendicion' && <Rendicion />}
      {pantalla === 'evolucion' && <Evolucion puedeEditar={puedeEditar} />}
      {pantalla === 'presupuesto' && <Presupuesto onSku={verSku} puedeEditar={puedeEditar} />}
      {pantalla === 'inventario' && <Inventario onSku={verSku} />}
      {pantalla === 'sku' && <FichaSku clave={clave} onElegir={setClave} />}
      {pantalla === 'seguimiento' && <Seguimiento onSku={verSku} />}
      {pantalla === 'oc' && <OcVencidas onSku={verSku} puedeEditar={puedeEditar} />}
      {pantalla === 'reposicion' && <Reposicion />}
      {pantalla === 'parametros' && puedeEditar && <Parametros />}
    </div>
  );
}

export default function ComprasMpApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
