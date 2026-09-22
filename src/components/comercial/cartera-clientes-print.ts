import { LOGO_GRIS_PNG_BASE64 } from '../../lib/logos';
import type { ClienteStat, Estado, Movimiento } from './cartera-clientes-calc';
import { formatCompactCurrency } from '../gerencia/format';

/** Mirrors src/components/produccion/bandas-print.ts's pattern: a standalone printable
 * window (plain inline CSS, no Tailwind there) that triggers window.print() on load, so
 * "Guardar como PDF" is the browser's own dialog — no PDF library needed. Every exported
 * doc carries the Frontera Living logo (gris, per house rule) and the exact date/time it
 * was generated, same as every other printable report in this app. */

const BASE_STYLE = `
  body { font-family: Arial, sans-serif; padding: 2rem; font-size: 13px; color: #1a1a1a; }
  .print-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 4px; border-bottom: 2px solid #1D9E75; padding-bottom: 8px; }
  .print-header img { height: 40px; width: auto; }
  h2 { font-size: 19px; font-weight: 700; color: #1D9E75; margin: 0; }
  .subtitle { font-size: 12px; color: #555; margin-top: 2px; }
  .meta { font-size: 11px; color: #888; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f5f5f3; padding: 8px 10px; text-align: left; font-weight: 700; font-size: 10.5px; color: #555; text-transform: uppercase; border-bottom: 2px solid #ddd; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; }
  .table-wrap { border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10.5px; font-weight: 700; }
  .pill-activo { background: #dcf5e4; color: #16794a; }
  .pill-dormido { background: #fdf0d5; color: #92660f; }
  .pill-perdido { background: #fbdfdb; color: #a13324; }
  .pill-nuevo { background: #dde8f6; color: #2a5f9e; }
  .foot { margin-top: 16px; font-size: 10.5px; color: #999; }
  @media print { body { padding: 1rem; } }
`;

const ESTADO_PILL_CLASS: Record<Estado, string> = {
  Activo: 'pill-activo',
  Dormido: 'pill-dormido',
  Perdido: 'pill-perdido',
  Nuevo: 'pill-nuevo',
};

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

export interface PrintRow {
  c: ClienteStat;
  movimiento: Movimiento;
}

/** Prints exactly what's on screen in the (filtered, sorted) client table — every row, not just the current page. */
export function imprimirCarteraClientes(rows: PrintRow[], clients: string[], vendors: string[], filtrosLabel: string) {
  const win = window.open('', '_blank');
  if (!win) return;

  const filas = rows
    .map(
      ({ c, movimiento }) => `<tr>
        <td>${clients[c.ci]}</td>
        <td><span class="pill" style="background:#e5e5e5;color:#444">${c.cat}</span></td>
        <td><span class="pill ${ESTADO_PILL_CLASS[c.estado]}">${c.estado}</span></td>
        <td>${movimiento}</td>
        <td>${c.lastDate}</td>
        <td class="num">${c.daysSince}</td>
        <td class="num">${formatCompactCurrency(c.paretoTotal)}</td>
        <td class="num">${c.nOrdersTotal}</td>
        <td>${vendors[c.vendor] ?? 'Sin asignar'}</td>
      </tr>`
    )
    .join('');

  const tabla = `<div class="table-wrap"><table><thead><tr>
      <th>Cliente</th><th>Cat.</th><th>Estado</th><th>Movimiento</th><th>Última compra</th>
      <th class="num">Días s/compra</th><th class="num">Monto (ventana)</th><th class="num">Órdenes</th><th>Vendedor</th>
    </tr></thead><tbody>${filas || '<tr><td colspan="9" style="text-align:center;color:#999;padding:24px">Sin clientes para estos filtros.</td></tr>'}</tbody></table></div>`;

  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Salud de la Cartera — Frontera Living</title><style>${BASE_STYLE}</style></head>
<body>
  <div class="print-header">
    <div><h2>Salud de la Cartera</h2><div class="subtitle">${filtrosLabel}</div></div>
    <img src="data:image/png;base64,${LOGO_GRIS_PNG_BASE64}" alt="Frontera Living" />
  </div>
  <div class="meta">Generado el ${fechaHoraGeneracion()} · ${rows.length} cliente${rows.length === 1 ? '' : 's'}</div>
  ${tabla}
  <div class="foot">Frontera Living S.A. — Tablero de Cartera de Clientes.</div>
  <script>window.onload=()=>{ window.print(); }<\/script>
</body></html>`);
  win.document.close();
}
