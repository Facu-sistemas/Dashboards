import { ANCHO_ROLLO, MIN_ROLLO_GRANDE, SEG_ROLLO_CHICO, fmtTiempo, type CorteRow, type EnvivadoRow, type MatelRow, type OptimizacionTela } from '../../lib/bandas-calc';

/** Builds a standalone printable document per tab (plain inline CSS — this opens in its own window, no Tailwind available there) and triggers the print dialog. Mirrors the original tool's per-solapa print buttons. */

const BASE_STYLE = `
  body { font-family: Arial, sans-serif; padding: 2rem; font-size: 15px; color: #1a1a1a; }
  h2 { font-size: 20px; font-weight: 700; margin-bottom: 1rem; border-bottom: 2px solid #1D9E75; padding-bottom: 6px; color: #1D9E75; }
  .tiempo-box { background: #f0fdf8; border: 1px solid #9FE1CB; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
  .tiempo-box-titulo { font-size: 11px; font-weight: 700; color: #0F6E56; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .tiempo-box-valor { font-size: 28px; font-weight: 700; color: #0F6E56; }
  .tiempo-box-calculo { font-size: 12px; color: #0F6E56; opacity: 0.8; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th { background: #f5f5f3; padding: 10px 12px; text-align: left; font-weight: 700; font-size: 13px; color: #555; text-transform: uppercase; border-bottom: 2px solid #ddd; }
  td { padding: 10px 12px; border-bottom: 1px solid #eee; }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; }
  .tag-fecha { font-size: 13px; color: #555; background: #f5f5f3; padding: 2px 7px; border-radius: 4px; border: 1px solid #ddd; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; background: #cecbf6; color: #3c3489; }
  .table-wrap { border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; }
  .opt-summary-box { background: #f0fdf8; border: 1px solid #9FE1CB; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
  .opt-summary-title { font-size: 11px; font-weight: 700; color: #0F6E56; text-transform: uppercase; margin-bottom: 8px; }
  .opt-summary-grid { display: flex; gap: 2rem; flex-wrap: wrap; }
  .opt-summary-val { font-size: 26px; font-weight: 700; color: #0F6E56; }
  .opt-summary-lbl { font-size: 12px; color: #0F6E56; }
  .opt-tela-section { margin-bottom: 1.5rem; }
  .opt-tela-titulo { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
  .opt-stats-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .opt-stat { background: #f5f5f3; border-radius: 6px; padding: 8px 12px; min-width: 100px; }
  .opt-stat-label { font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
  .opt-stat-value { font-size: 18px; font-weight: 700; color: #1D9E75; }
  .opt-rollo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .opt-rollo-card { border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; }
  .opt-rollo-card-header { background: #f5f5f3; padding: 7px 10px; font-size: 11px; font-weight: 700; color: #555; display: flex; justify-content: space-between; }
  .opt-rollo-card-body { padding: 8px 10px; }
  .opt-bar-wrap { height: 24px; border-radius: 5px; overflow: hidden; display: flex; margin-bottom: 6px; border: 1px solid #e5e5e5; }
  .opt-bar-seg { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; min-width: 10px; }
  .opt-bar-waste { background: #f0f0f0; color: #bbb; }
  .opt-tiras span { display: inline-block; margin-right: 5px; background: #f0f0f0; border-radius: 4px; padding: 1px 6px; font-weight: 600; font-size: 12px; }
  .opt-desperdicio { font-size: 11px; color: #999; margin-top: 4px; }
  @media print { body { padding: 1rem; } }
`;

const BAR_PALETTE = ['#2E86AB', '#E84855', '#F4A261', '#2A9D8F', '#9B5DE5', '#F15BB5', '#3D9970', '#00BBF9', '#8338EC', '#FB5607'];

function colorForAltoFactory(): (alto: number) => string {
  const map = new Map<number, string>();
  let idx = 0;
  return (alto) => {
    let c = map.get(alto);
    if (!c) {
      c = BAR_PALETTE[idx % BAR_PALETTE.length]!;
      map.set(alto, c);
      idx++;
    }
    return c;
  };
}

function openPrintWindow(titulo: string, bodyHtml: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${titulo}</title><style>${BASE_STYLE}</style></head>
<body><h2>${titulo}</h2>${bodyHtml}<script>window.onload=()=>{ window.print(); }<\/script></body></html>`);
  win.document.close();
}

export function imprimirCorte(corte: CorteRow[], totalCorte: number) {
  const segCorte = totalCorte * SEG_ROLLO_CHICO;
  const ordenado = [...corte].sort((a, b) => (a.tela || '').localeCompare(b.tela || '') || (a.alto || 0) - (b.alto || 0));
  const tiempoBox = `<div class="tiempo-box"><div class="tiempo-box-titulo">Tiempo estimado de corte</div><div class="tiempo-box-valor">${fmtTiempo(segCorte)}</div><div class="tiempo-box-calculo">${totalCorte} rollos × 1 min 46 seg = ${(segCorte / 3600).toFixed(1)} hs</div></div>`;
  const filas = ordenado
    .map((r) => {
      const desc = r.rollosDescontados > 0 ? ` <span style="font-size:11px;color:#0F6E56;">(−${r.rollosDescontados} stock)</span>` : '';
      return `<tr><td><span class="tag-fecha">${r.fecha}</span></td><td><span class="badge">${r.tela ?? '?'}</span></td><td class="num">${r.alto ?? '-'}</td><td class="num"><strong>${r.rollos}</strong>${desc}</td></tr>`;
    })
    .join('');
  const tabla = `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tela</th><th class="num">Alto</th><th class="num">Rollos</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  openPrintWindow('Corte de Bandas', tiempoBox + tabla);
}

export function imprimirMatelaseadora(matel: MatelRow[], totalGrandes: number) {
  const segMatel = totalGrandes * MIN_ROLLO_GRANDE * 60;
  const tiempoBox = `<div class="tiempo-box"><div class="tiempo-box-titulo">Tiempo estimado matelaseadora</div><div class="tiempo-box-valor">${fmtTiempo(segMatel)}</div><div class="tiempo-box-calculo">${totalGrandes} rollos × 40 min = ${(segMatel / 3600).toFixed(1)} hs</div></div>`;
  const filas = matel
    .map((r) => `<tr><td><span class="tag-fecha">${r.fecha}</span></td><td><span class="badge">${r.tela ?? '?'}</span></td><td class="num"><strong>${r.rollosGrandes}</strong></td></tr>`)
    .join('');
  const tabla = `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tela</th><th class="num">Rollos grandes</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  openPrintWindow('Matelaseadora', tiempoBox + tabla);
}

export function imprimirOptimizacion(optData: OptimizacionTela[]) {
  let totalRollos = 0;
  let totalDesp = 0;
  let totalCapacidad = 0;
  for (const d of optData) {
    totalRollos += d.totalRollos;
    totalDesp += d.totalDesp;
    totalCapacidad += d.totalRollos * ANCHO_ROLLO;
  }
  const eficiencia = totalCapacidad > 0 ? (((totalCapacidad - totalDesp) / totalCapacidad) * 100).toFixed(1) : '100';

  const summary = `<div class="opt-summary-box"><div class="opt-summary-title">Resumen — rollo grande = ${ANCHO_ROLLO} cm</div><div class="opt-summary-grid"><div><div class="opt-summary-val">${totalRollos}</div><div class="opt-summary-lbl">rollos grandes</div></div><div><div class="opt-summary-val">${totalDesp} cm</div><div class="opt-summary-lbl">desperdicio total</div></div><div><div class="opt-summary-val">${eficiencia}%</div><div class="opt-summary-lbl">eficiencia</div></div></div></div>`;

  const secciones = optData
    .map((d) => {
      const colorForAlto = colorForAltoFactory();
      const rollones = d.rollones
        .map((r) => {
          const conteo = new Map<number, number>();
          for (const t of r.tiras) conteo.set(t, (conteo.get(t) ?? 0) + 1);
          const barra = [
            ...r.tiras.map((t) => `<div class="opt-bar-seg" style="width:${((t / ANCHO_ROLLO) * 100).toFixed(1)}%;background:${colorForAlto(t)}">${t >= 20 ? t : ''}</div>`),
            r.desp > 0 ? `<div class="opt-bar-seg opt-bar-waste" style="width:${((r.desp / ANCHO_ROLLO) * 100).toFixed(1)}%">${r.desp >= 15 ? r.desp : ''}</div>` : '',
          ].join('');
          const tiras = [...conteo.entries()]
            .sort((a, b) => b[0] - a[0])
            .map(([alto, cant]) => `<span>${cant} × ${alto}cm</span>`)
            .join('');
          return `<div class="opt-rollo-card"><div class="opt-rollo-card-header"><span>Rollo #${r.id}</span><span>${r.usado} / ${ANCHO_ROLLO} cm</span></div><div class="opt-rollo-card-body"><div class="opt-bar-wrap">${barra}</div><div class="opt-tiras">${tiras}</div><div class="opt-desperdicio">${r.desp === 0 ? '✓ Sin desperdicio' : `Desperdicio: ${r.desp} cm`}</div></div></div>`;
        })
        .join('');
      return `<div class="opt-tela-section"><div class="opt-tela-titulo">${d.tela}</div><div class="opt-stats-row"><div class="opt-stat"><div class="opt-stat-label">Rollos grandes</div><div class="opt-stat-value">${d.totalRollos}</div></div><div class="opt-stat"><div class="opt-stat-label">Desperdicio</div><div class="opt-stat-value">${d.totalDesp} cm</div></div><div class="opt-stat"><div class="opt-stat-label">Eficiencia</div><div class="opt-stat-value">${d.eficiencia}%</div></div></div><div class="opt-rollo-grid">${rollones}</div></div>`;
    })
    .join('');

  openPrintWindow('Optimización de Corte', summary + secciones);
}

export function imprimirEnvivado(envRows: EnvivadoRow[], totalSegEnv: number) {
  const envStr = totalSegEnv > 0 ? fmtTiempo(totalSegEnv) : '—';
  const envCalc = totalSegEnv > 0 ? `${(totalSegEnv / 3600).toFixed(1)} hs totales` : 'Sin envivado';
  const tiempoBox = `<div class="tiempo-box"><div class="tiempo-box-titulo">Tiempo total de envivado</div><div class="tiempo-box-valor">${envStr}</div><div class="tiempo-box-calculo">${envCalc}</div></div>`;
  const filas = envRows
    .map((r) => {
      const mins = Math.floor(r.seg / 60);
      const segs = r.seg % 60;
      const unitStr = r.seg === 0 ? '—' : `${mins}:${String(segs).padStart(2, '0')}`;
      const totalMins = Math.floor(r.totalSeg / 60);
      const totalSegs = r.totalSeg % 60;
      const totalStr = r.totalSeg === 0 ? '—' : `${totalMins}:${String(totalSegs).padStart(2, '0')}`;
      return `<tr><td><span class="tag-fecha">${r.fecha}</span></td><td style="font-size:11px;word-break:break-all">${r.producto}</td><td class="num">${r.alto ?? '-'}</td><td class="num">${r.cantidad}</td><td style="font-size:12px">${r.tipo}</td><td class="num">${unitStr}</td><td class="num"><strong>${totalStr}</strong></td></tr>`;
    })
    .join('');
  const tabla = `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th class="num">Alto</th><th class="num">Cantidad</th><th>Tipo</th><th class="num">T. unitario</th><th class="num">T. total</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  openPrintWindow('Envivado', tiempoBox + tabla);
}
