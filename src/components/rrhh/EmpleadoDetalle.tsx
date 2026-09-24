import type { EmpleadoVacacionesRow } from '../../lib/odoo/rrhh-vacaciones';
import { formatAntiguedad, formatDias, formatFechaHora, formatFechaIso, formatHoras, formatWage } from './format';

interface Props {
  row: EmpleadoVacacionesRow;
  today: string;
  colSpan: number;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-200">{value}</p>
    </div>
  );
}

export default function EmpleadoDetalle({ row, today, colSpan }: Props) {
  return (
    <tr className="bg-slate-950/60">
      <td colSpan={colSpan} className="p-4">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Contrato</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Departamento" value={row.departamento ?? '—'} />
              <Field label="Puesto" value={row.puesto ?? '—'} />
              <Field label="Fecha de ingreso" value={formatFechaIso(row.fechaIngreso)} />
              <Field label="Antigüedad" value={formatAntiguedad(row.fechaIngreso, today)} />
              <Field label="Categoría de convenio" value={row.categoriaConvenio ?? '—'} />
              <Field label="Jornada" value={row.jornada ? `${row.jornada}${row.horasSemanales ? ` (${row.horasSemanales} hs/sem)` : ''}` : '—'} />
              {row.contrato ? (
                <>
                  <Field label="Salario (hr.contract)" value={formatWage(row.contrato.wage)} />
                  <Field label="Contrato desde" value={formatFechaIso(row.contrato.dateStart)} />
                </>
              ) : (
                <div className="col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Contrato formal (hr.contract)</p>
                  <p className="mt-0.5 text-sm text-slate-500">Sin contrato cargado en Odoo para este empleado.</p>
                </div>
              )}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Horas cargadas</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Últimos 30 días (timesheet)" value={formatHoras(row.horasCargadas30d)} />
              <Field label="Total histórico (timesheet)" value={formatHoras(row.horasCargadasTotal)} />
              <Field
                label="Saldo banco de horas"
                value={
                  <span className={row.bancoHorasSaldo < 0 ? 'text-red-400' : undefined}>{formatHoras(row.bancoHorasSaldo)}</span>
                }
              />
              <Field label="En licencia ahora" value={row.enLicenciaActualmente ? 'Sí' : 'No'} />
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Vacaciones — detalle</h4>
            <div className="flex flex-col gap-3 text-xs">
              <div>
                <p className="mb-1 text-slate-500">Asignaciones validadas ({row.asignaciones.length})</p>
                {row.asignaciones.length === 0 ? (
                  <p className="text-slate-600">Sin asignaciones cargadas.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {row.asignaciones.map((a, i) => (
                      <li key={i} className="flex justify-between gap-2 text-slate-300">
                        <span className="truncate">{a.name}</span>
                        <span className="shrink-0 text-slate-400">
                          {formatDias(a.numberOfDays)} d{a.dateTo ? ` · vence ${formatFechaIso(a.dateTo)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 text-slate-500">Licencias tomadas ({row.licenciasTomadas.length})</p>
                {row.licenciasTomadas.length === 0 ? (
                  <p className="text-slate-600">Sin licencias de vacaciones tomadas.</p>
                ) : (
                  <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                    {row.licenciasTomadas.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2 text-slate-300">
                        <span>
                          {formatFechaHora(l.dateFrom)} → {formatFechaHora(l.dateTo)}
                        </span>
                        <span className="shrink-0 text-slate-400">{formatDias(l.numberOfDays)} d</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      </td>
    </tr>
  );
}
