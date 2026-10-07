import bwipjs from 'bwip-js/browser';

/** Labels are physical 100 x 100 mm stickers, so everything here is plain black-on-white inline CSS in mm — independent of the dashboard theme (the same markup is used for the on-screen preview and for the print window). */

export interface EtiquetaData {
  codigo: string;
  descripcion: string;
  color: string;
  ancho: string;
  composicion: string;
  origen: string;
  fecha: string;
  empresa: string;
  importador: string;
  lote: string;
  mRollo: number;
  kgRollo: number;
  rollosCaja: number;
  kgCaja: number;
  medidasCaja: string;
  bcCaja: string;
  bcRollo: string;
}

const fmt = (n: number, d = 0) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const X_MM = 0.33; // narrowest bar, GS1 nominal
const MAX_MM = 88;

/** Code 128 barcode as inline SVG, sized in mm (bars stretch only horizontally so the module width stays at X_MM). */
function barcodeHtml(text: string, heightMm: number): string {
  let svg: string;
  try {
    svg = bwipjs.toSVG({ bcid: 'code128', text, scale: 1, height: 10, includetext: false, paddingwidth: 0, paddingheight: 0 });
  } catch (e) {
    return `<div class="bc-err">Código inválido: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
  }
  const modules = Number(/viewBox="0 0 (\d+(?:\.\d+)?)/.exec(svg)?.[1] ?? 0);
  const widthMm = Math.min(modules * X_MM, MAX_MM);
  svg = svg.replace('<svg ', `<svg preserveAspectRatio="none" style="display:block;width:${widthMm}mm;height:${heightMm}mm" `);
  return `<div class="bc">${svg}<div class="hri">${esc(text)}</div></div>`;
}

const cell = (k: string, v: string) => `<div class="cell"><small>${k}</small><strong>${v}</strong></div>`;

export function etiquetaCajaHtml(d: EtiquetaData): string {
  const mCaja = d.mRollo * d.rollosCaja;
  return `<div class="label">
    <div class="band"><span>${esc(d.empresa)}</span><b>CAJA MASTER <small>· MASTER CARTON</small></b></div>
    <div class="idrow"><div><div class="code">${esc(d.codigo)}</div><div class="desc">${esc(d.descripcion)} · ${d.rollosCaja} × ${fmt(d.mRollo)} m</div></div></div>
    <div class="grid g2">
      ${cell('Lote / Lot', esc(d.lote))}
      ${cell('Contenido / Qty', `${d.rollosCaja} rollos`)}
      ${cell('Metros totales / Total length', `${fmt(mCaja)} m`)}
      ${cell('Peso bruto / Gross weight', `${fmt(d.kgCaja, 1)} kg`)}
    </div>
    <div class="fine">${esc(d.color)} · ${esc(d.ancho)} · Medidas: ${esc(d.medidasCaja)} · Origen: ${esc(d.origen)}<br>${esc(d.importador)}</div>
    <div class="spacer"></div>
    ${barcodeHtml(d.bcCaja, 16)}
  </div>`;
}

export function etiquetaRolloHtml(d: EtiquetaData): string {
  return `<div class="label">
    <div class="band"><span>${esc(d.empresa)}</span><b>ROLLO · ROLL</b></div>
    <div class="idrow"><div><div class="code">${esc(d.codigo)}</div><div class="desc">${esc(d.descripcion)} · ${esc(d.color)}</div></div></div>
    <div class="grid g3">
      ${cell('Lote / Lot', esc(d.lote))}
      ${cell('Cantidad / Qty', `${fmt(d.mRollo)} m`)}
      ${cell('Peso neto / Net', `${fmt(d.kgRollo, 1)} kg`)}
      ${cell('Ancho / Width', esc(d.ancho))}
      ${cell('Origen / Origin', esc(d.origen))}
      ${cell('Fecha / Date', esc(d.fecha))}
    </div>
    <div class="fine">Composición / Composition: ${esc(d.composicion)}<br>${esc(d.importador)}</div>
    <div class="spacer"></div>
    ${barcodeHtml(d.bcRollo, 16)}
  </div>`;
}

/** Shared by the on-screen preview (scoped under .etq-preview) and the print window. */
export const ETIQUETA_CSS = `
  .label { width: 100mm; height: 100mm; background: #fff; color: #000; padding: 4mm; display: flex; flex-direction: column; gap: 2.2mm; font-family: Arial, Helvetica, sans-serif; overflow: hidden; box-sizing: border-box; }
  .label * { box-sizing: border-box; }
  .band { display: flex; justify-content: space-between; align-items: center; background: #000; color: #fff; padding: 1.4mm 2.5mm; font-weight: 700; font-size: 3.2mm; letter-spacing: .04em; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .band b { font-size: 4.2mm; white-space: nowrap; }
  .band b small { font-size: 2.8mm; }
  .idrow { display: flex; align-items: center; justify-content: space-between; gap: 3mm; border-bottom: .4mm solid #000; padding-bottom: 1.2mm; }
  .code { font-size: 9.5mm; font-weight: 800; line-height: 1; letter-spacing: -.02em; }
  .desc { font-size: 3.2mm; margin-top: .8mm; }
  .grid { display: grid; border: .3mm solid #000; }
  .g2 { grid-template-columns: 1fr 1fr; }
  .g3 { grid-template-columns: 1fr 1fr 1fr; }
  .cell { padding: 1mm 2mm; border-right: .3mm solid #000; border-bottom: .3mm solid #000; }
  .g2 > .cell:nth-child(2n), .g3 > .cell:nth-child(3n) { border-right: 0; }
  .g2 > .cell:nth-last-child(-n+2), .g3 > .cell:nth-last-child(-n+3) { border-bottom: 0; }
  .cell small { display: block; font-size: 2.3mm; text-transform: uppercase; letter-spacing: .03em; }
  .cell strong { font-size: 4.2mm; font-variant-numeric: tabular-nums; }
  .fine { font-size: 2.4mm; line-height: 1.3; }
  .spacer { flex: 1; }
  .bc { display: flex; flex-direction: column; align-items: center; gap: .6mm; }
  .hri { font-family: Consolas, "Courier New", monospace; font-size: 2.8mm; letter-spacing: .02em; }
  .bc-err { font-size: 3mm; color: #b91c1c; text-align: center; }
`;

/** Opens a print window with one 100 x 100 mm page per label (caja first, then rollo). */
export function imprimirEtiquetas(d: EtiquetaData, cuales: { caja: boolean; rollo: boolean }): void {
  const pages: string[] = [];
  if (cuales.caja) pages.push(etiquetaCajaHtml(d));
  if (cuales.rollo) pages.push(etiquetaRolloHtml(d));
  if (pages.length === 0) return;
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas ${esc(d.codigo)} lote ${esc(d.lote)}</title><style>
    @page { size: 100mm 100mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    ${ETIQUETA_CSS}
    .label { break-after: page; page-break-after: always; }
    .label:last-child { break-after: auto; page-break-after: auto; }
  </style></head><body>${pages.join('')}<script>window.onload=()=>{ window.print(); }<\/script></body></html>`);
  win.document.close();
}
