import { LOGO_GRIS_PNG_BASE64 } from '@/lib/logos';
import type { EmpleadoVacacionesRow } from '@/lib/odoo/rrhh-vacaciones';
import { formatDias, formatFechaHora } from './format';

/** Mismo patrón que cartera-clientes-print.ts: ventana imprimible con CSS inline y window.print(), así que "Guardar como PDF" es el diálogo del navegador (sin librería). Logo gris, fecha de generación en horario de Argentina y pie, como el resto de los reportes. */

const BASE_STYLE = `
  body { font-family: Arial, sans-serif; padding: 2rem; font-size: 13px; color: #1a1a1a; }
  .print-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 4px; border-bottom: 2px solid #1D9E75; padding-bottom: 8px; }
  .print-header img { height: 40px; width: auto; }
  h2 { font-size: 19px; font-weight: 700; color: #1D9E75; margin: 0; }
  .subtitle { font-size: 12px; color: #555; margin-top: 2px; }
  .meta { font-size: 11px; color: #888; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f5f5f3; padding: 8px 10px; text-align: left; font-weight: 700; font-size: 10.5px; color: #555; text-transform: uppercase; border-bottom: 2px solid #ddd; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; }
  .table-wrap { border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; }
  .sin { color: #a13324; font-weight: 700; }
  .periodo { white-space: nowrap; }
  .foot { margin-top: 16px; font-size: 10.5px; color: #999; }
  @media print { body { padding: 1rem; } }
`;

function esc(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fechaHoraGeneracion(): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

/** Licencias de vacaciones validadas del año indicado (por fecha de inicio), de la más antigua a la más reciente. */
function licenciasDelAnio(row: EmpleadoVacacionesRow, anio: number) {
  return row.licenciasTomadas.filter((l) => l.dateFrom.startsWith(String(anio))).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}

/** Imprime las filas recibidas (las que están en pantalla con los filtros actuales) con las vacaciones tomadas en `anio`. */
export function imprimirVacacionesAnio(rows: EmpleadoVacacionesRow[], anio: number, filtrosLabel: string) {
  const win = window.open('', '_blank');
  if (!win) return;

  const ordenadas = [...rows].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  let conTomadas = 0;
  let diasTotales = 0;

  const filas = ordenadas
    .map((row) => {
      const licencias = licenciasDelAnio(row, anio);
      const dias = licencias.reduce((acc, l) => acc + l.numberOfDays, 0);
      if (licencias.length > 0) conTomadas += 1;
      diasTotales += dias;
      const periodos =
        licencias.length === 0
          ? '<span class="sin">Sin vacaciones tomadas</span>'
          : licencias
              .map((l) => `<div class="periodo">${formatFechaHora(l.dateFrom)} → ${formatFechaHora(l.dateTo)} (${formatDias(l.numberOfDays)} d)</div>`)
              .join('');
      return `<tr>
        <td>${esc(row.nombre)}</td>
        <td>${esc(row.departamento ?? '—')}</td>
        <td>${periodos}</td>
        <td class="num">${licencias.length === 0 ? '—' : formatDias(dias)}</td>
      </tr>`;
    })
    .join('');

  const tabla = `<div class="table-wrap"><table><thead><tr>
      <th>Empleado</th><th>Departamento</th><th>Período tomado en ${anio}</th><th class="num">Días</th>
    </tr></thead><tbody>${filas || '<tr><td colspan="4" style="text-align:center;color:#999;padding:24px">Sin empleados para estos filtros.</td></tr>'}</tbody></table></div>`;

  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Vacaciones ${anio} — Frontera Living</title><style>${BASE_STYLE}</style></head>
<body>
  <div class="print-header">
    <div><h2>Vacaciones tomadas en ${anio}</h2><div class="subtitle">${esc(filtrosLabel)}</div></div>
    <img src="data:image/png;base64,${LOGO_GRIS_PNG_BASE64}" alt="Frontera Living" />
  </div>
  <div class="meta">Generado el ${fechaHoraGeneracion()} · ${ordenadas.length} empleado${ordenadas.length === 1 ? '' : 's'} · ${conTomadas} con vacaciones tomadas · ${formatDias(diasTotales)} días en total</div>
  ${tabla}
  <div class="foot">Frontera Living S.A. — Tablero de RRHH, vacaciones. Datos de Odoo (hr.leave validadas), solo lectura.</div>
  <script>window.onload=()=>{ window.print(); }<\/script>
</body></html>`);
  win.document.close();
}
