import { Fragment, useState } from 'react';
import type { EmpleadoVacacionesRow } from '../../lib/odoo/rrhh-vacaciones';
import EmpleadoDetalle from './EmpleadoDetalle';
import { formatDias, formatFechaIso } from './format';

interface Props {
  rows: EmpleadoVacacionesRow[];
  today: string;
}

const COLUMN_COUNT = 7;

function AnomaliaBadge({ row }: { row: EmpleadoVacacionesRow }) {
  if (row.anomalia === 'negativo') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
        Saldo negativo
      </span>
    );
  }
  if (row.anomalia === 'alto') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
        Acumulación alta
      </span>
    );
  }
  return null;
}

export default function VacacionesTable({ rows, today }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin empleados que coincidan con el filtro.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-medium">Empleado</th>
            <th className="py-2 pr-4 font-medium">Departamento</th>
            <th className="py-2 pr-4 font-medium">Ingreso</th>
            <th className="py-2 pr-4 text-right font-medium">Asignados</th>
            <th className="py-2 pr-4 text-right font-medium">Tomados</th>
            <th className="py-2 pr-4 text-right font-medium">Saldo</th>
            <th className="py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedId === row.id;
            const saldoColor = row.vacacionesSaldo < 0 ? 'text-red-400' : row.anomalia === 'alto' ? 'text-amber-400' : 'text-slate-200';
            return (
              <Fragment key={row.id}>
                <tr
                  className="cursor-pointer border-b border-slate-900 hover:bg-slate-900/60"
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                >
                  <td className="py-2 pr-3">
                    <span className="text-slate-100">{row.nombre}</span>
                    {row.enLicenciaActualmente && (
                      <span className="ml-2 inline-block rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-400">
                        de licencia
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-400">{row.departamento ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-400">{formatFechaIso(row.fechaIngreso)}</td>
                  <td className="py-2 pr-4 text-right text-slate-300">{formatDias(row.vacacionesAsignadas)}</td>
                  <td className="py-2 pr-4 text-right text-slate-300">{formatDias(row.vacacionesTomadas)}</td>
                  <td className={`py-2 pr-4 text-right font-semibold ${saldoColor}`}>{formatDias(row.vacacionesSaldo)}</td>
                  <td className="py-2">
                    <AnomaliaBadge row={row} />
                  </td>
                </tr>
                {expanded && <EmpleadoDetalle row={row} today={today} colSpan={COLUMN_COUNT} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
