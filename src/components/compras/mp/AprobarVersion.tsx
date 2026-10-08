// Aprobar versión: congela el presupuesto y el desembolso proyectado del horizonte (solo Compras). Las versiones son inmutables.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CabeceraVersion } from '../../../lib/compras-mp/versiones';
import { postJson } from './acciones';
import { ErrorCaja, Seccion, fechaCorta, fechaHora, mesCorto, mm } from './ui';

interface Props {
  puedeEditar: boolean;
  version: CabeceraVersion | null;
  horizonte: string[];
  total: number;
  fechaDatos: string;
}

export default function AprobarVersion({ puedeEditar, version, horizonte, total, fechaDatos }: Props) {
  const [nombre, setNombre] = useState('');
  const cliente = useQueryClient();
  const aprobar = useMutation({
    mutationFn: () => postJson('/api/compras-mp/version', { nombre: nombre.trim() || undefined }),
    onSuccess: () => { setNombre(''); return cliente.invalidateQueries({ queryKey: ['cmp'] }); },
  });
  const periodo = `${mesCorto(horizonte[0] ?? '')} – ${mesCorto(horizonte[horizonte.length - 1] ?? '')}`;

  return (
    <Seccion titulo="Versión aprobada del presupuesto" nota="Es la referencia con la que se mide el cumplimiento. Aprobar congela el presupuesto y el desembolso proyectado; no se puede modificar después.">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        {version ? (
          <p className="text-sm text-slate-300">
            Vigente: <span className="font-medium text-slate-100">{version.nombre}</span> — aprobada por {version.aprobadaPor} el {fechaHora(version.aprobadaEn)} · {mm(version.totalCompra)} · datos de Odoo del{' '}
            {fechaCorta(String(version.params.fechaDatos ?? ''))}
          </p>
        ) : (
          <p className="text-sm text-slate-300">Todavía no hay una versión aprobada: el cumplimiento se empieza a medir cuando se apruebe la primera.</p>
        )}
        {puedeEditar ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Nombre (opcional)
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={`${periodo} (datos del ${fechaCorta(fechaDatos)})`} maxLength={120} className="w-80 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600" />
            </label>
            <button
              type="button"
              disabled={aprobar.isPending}
              className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-brand-400 disabled:opacity-60"
              onClick={() => {
                if (window.confirm(`Se va a congelar el presupuesto de ${periodo} (${mm(total)}) y el desembolso proyectado, calculados con los datos de Odoo del ${fechaCorta(fechaDatos)}.\n\nNo se puede modificar después y reemplaza a la versión vigente como referencia. ¿Aprobar?`)) aprobar.mutate();
              }}
            >
              {aprobar.isPending ? 'Aprobando…' : 'Aprobar este presupuesto'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Solo Compras puede aprobar una versión.</p>
        )}
        {aprobar.isError && <ErrorCaja mensaje={(aprobar.error as Error).message} />}
        {aprobar.isSuccess && <p className="text-sm text-status-green">Versión aprobada. El cumplimiento se mide desde ahora contra esta versión.</p>}
      </div>
    </Seccion>
  );
}
