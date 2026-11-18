// @ts-nocheck
// Port del artifact "Presupuesto y cumplimiento MP" (docs/). Render vanilla sobre `root` con el estado que
// entrega /api/presupuesto-mp. Solo lectura: no escribe en Odoo ni en ninguna base.
export function montarPresupuestoMp(root, STATE, opts = {}){

/* ---------- formatos ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fM = v => (v/1e6).toLocaleString('es-AR',{minimumFractionDigits:1,maximumFractionDigits:1});
const fK = v => Math.round(v/1e3).toLocaleString('es-AR');
const fU = v => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v*10)/10).toLocaleString('es-AR');
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function pill(r,m){
  if (m <= 0 && r <= 0) return '<span class="pill p-none">sin movimiento</span>';
  if (m <= 0) return '<span class="pill p-over">sin presupuesto</span>';
  const p = r/m, cls = p < 0.8 ? 'p-warn' : (p > 1.2 ? 'p-over' : 'p-ok');
  return '<span class="pill ' + cls + '">' + Math.round(p*100) + '%</span>';
}
const LEGEND = '<div class="legend"><span class="pill p-warn">Menos de 80%</span> compró menos de lo indicado <span class="pill p-ok">80% a 120%</span> en línea <span class="pill p-over">Más de 120%</span> compró más</div>';

/* ---------- datos ---------- */
const C = n => STATE.cols.indexOf(n);
const SK = STATE.rows.map(r => ({sku:r[C('SKU')], cat:r[C('Categoría')], ori:r[C('Origen')], abc:r[C('ABC')], cp:r[C('Costo presup')], r}));
const v = (s, n) => s.r[C(n)] || 0;
const vb = (s, k) => v(s,'Aprob $ ' + k) + v(s,'Entr aprob $ ' + k);   /* base del cumplimiento: compra aprobada + entrante comprometido al aprobar */
const A = STATE.meta.aprob, VG = STATE.meta.vig;

/* filas genéricas para la vista de cumplimiento: {m, sku, cat, abc, ori, c, cu, mu, ru, mv, rv, cv, fa} */
function rowsCumplimiento(){
  const out = [];
  A.forEach((a, i) => { if (!a.cerrado) return; const k = i + 1;
    for (const s of SK){
      const mv = vb(s, k), ru = v(s,'Real u ' + k), rv = v(s,'Real $ ' + k), cu = v(s,'Consumo u ' + k), fa = v(s,'Facturado $ ' + k), mu = v(s,'Aprob u ' + k);
      if (mv || rv || cu || fa) out.push({m:k, sku:s.sku, cat:s.cat, abc:s.abc, ori:s.ori, c:s.cp, cu, mu, ru, mv, rv, cv:cu*s.cp, fa});
    }});
  return out;
}
const CERR = (STATE.cerrados || []).slice().sort((a,b)=>a.clave-b.clave);
const CROWS = []; CERR.forEach(c => c.rows.forEach(r => CROWS.push({m:c.clave, sku:r[0], cat:r[1], abc:r[2], ori:r[3], c:r[4], cu:r[5], mu:r[6], ru:r[7], mv:r[8], rv:r[9], cv:r[5]*r[4], fa:0})));
const cTot = c => c.rows.reduce((a,r)=>(a.mv+=r[8], a.rv+=r[9], a), {mv:0, rv:0});
const verCorta = t => { const m = String(t || '').match(/\((v\d+)\)/), d = String(t || '').match(/\d{2}\/\d{2}\/\d{4}/); return (m ? m[1] : 'versión') + (d ? ' del ' + d[0] : ''); };
function motivoSku(x){   /* por qué se desvió un SKU en un mes cerrado (texto corto) */
  const d = x.rv - x.mv;
  if (Math.abs(d) < 1e5 || (x.mv > 0 && x.rv >= 0.8*x.mv && x.rv <= 1.2*x.mv)) return 'En línea';
  if (x.mv <= 0) return x.ori === 'China' ? 'Llegó sin presupuesto: contenedor de China adelantado' : 'Llegó sin presupuesto: OC anterior o adelantada';
  if (x.rv <= 0) return x.ori === 'China' ? 'No llegó: contenedor de China corrido de mes' : 'No llegó: OC atrasada o compra no emitida';
  if (x.ori === 'China') return d > 0 ? 'Contenedor de China: llegó más de lo previsto en el mes' : 'Contenedor de China: llegó parte en otro mes';
  if (x.cu > 0 && x.mu > 0 && x.ru > x.mu && x.cu > x.mu) return 'Llegó más: el consumo real superó lo previsto';
  return d > 0 ? 'Llegó más de lo previsto' : 'Llegó menos de lo previsto';
}
const RETRO = (STATE.retro || []).map(r => ({m:r[0], sku:r[1], cat:r[2], abc:r[3], ori:r[4], c:r[5], cu:r[6], mu:r[7], ru:r[8], fa:r[9], cv:r[6]*r[5], mv:r[7]*r[5], rv:r[8]*r[5]}));

/* ---------- vista de cumplimiento (se usa en dos pestañas) ---------- */
function makeView(root, id, rows, months, opts){
  let MES = 0, CAT = null;
  const segs = '<button type="button" data-m="0" aria-pressed="true">' + opts.allLabel + '</button>' + months.map(mm => '<button type="button" data-m="' + mm.v + '" aria-pressed="false">' + esc(mm.label) + '</button>').join('');
  root.innerHTML =
    '<section class="read">' + opts.read + '</section>' +
    '<div class="bar"><div class="seg" role="group" aria-label="Período">' + segs + '</div>' + LEGEND + '</div>' +
    '<section class="kpis" id="' + id + '-k"></section>' +
    '<section class="card"><div class="hd"><h2>Por categoría</h2><span class="hint">Clic en una fila para ver sus SKUs</span></div><div class="tw"><table id="' + id + '-cat"></table></div></section>' +
    '<section class="card small"><div class="hd"><h2>Por origen</h2></div><div class="tw"><table id="' + id + '-ori"></table></div></section>' +
    '<section class="card"><div class="hd"><h2 id="' + id + '-th">Detalle por SKU</h2><div class="filters">' +
      '<input id="' + id + '-q" type="search" placeholder="Buscar SKU" aria-label="Buscar SKU">' +
      '<select id="' + id + '-fo" aria-label="Origen"><option value="">Todos los orígenes</option><option>Local</option><option>Brasil</option><option>China</option></select>' +
      '<select id="' + id + '-fs" aria-label="Mostrar"><option value="all">Todos los SKUs con movimiento</option><option value="dev">Solo con desvío mayor a $1M</option></select>' +
    '</div></div><div class="tw"><table id="' + id + '-sku"></table></div></section>' +
    (opts.notes ? '<section class="notes"><div class="eyebrow">Para tener en cuenta</div><ol>' + opts.notes.map(n => '<li>' + n + '</li>').join('') + '</ol></section>' : '');
  const $ = s => document.getElementById(id + '-' + s);
  const sel = () => rows.filter(r => MES === 0 || r.m === MES);
  function group(list, key){
    const g = new Map();
    for (const r of list){ const k = r[key]; if (!g.has(k)) g.set(k,{k, mv:0, rv:0, cv:0, fa:0}); const o = g.get(k); o.mv += r.mv; o.rv += r.rv; o.cv += r.cv; o.fa += r.fa; }
    return [...g.values()];
  }
  const tot = L => L.reduce((a,r)=>{a.mv+=r.mv;a.rv+=r.rv;a.cv+=r.cv;a.fa+=r.fa;return a},{mv:0,rv:0,cv:0,fa:0});
  function kpis(L){
    const t = tot(L), p = t.mv > 0 ? t.rv/t.mv : null;
    const k = [[opts.mLabel, '$ ' + fM(t.mv) + ' M', opts.mNote], ['Compra real', '$ ' + fM(t.rv) + ' M', 'Llegadas físicas, ' + opts.costNote],
      ['Cumplimiento', p===null ? '–' : Math.round(p*100) + '%', 'Desvío: $ ' + fM(t.rv - t.mv) + ' M'],
      ['Consumo real', '$ ' + fM(t.cv) + ' M', 'Compra real / consumo: ' + (t.cv>0 ? Math.round(t.rv/t.cv*100) + '%' : '–')],
      ['Facturado (referencia)', '$ ' + fM(t.fa) + ' M', 'ARS nominales; importaciones incompletas']].filter(x => !(opts.noFa && x[0].indexOf('Facturado') === 0));
    $('k').innerHTML = k.map(x => '<div class="kpi"><div class="eyebrow">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="n">' + x[2] + '</div></div>').join('');
  }
  function catTable(L){
    const g = group(L,'cat').sort((a,b)=>b.mv-a.mv || b.rv-a.rv), t = tot(L);
    const max = Math.max(1, ...g.map(x=>Math.max(x.mv,x.rv)));
    let h = '<thead><tr><th>Categoría</th><th>' + opts.mShort + ' $M</th><th>Real $M</th><th>Desvío $M</th><th>Cumplimiento</th><th>Consumo $M</th>' + (opts.noFa ? '' : '<th>Facturado $M</th>') + '</tr></thead><tbody>';
    for (const x of g){ const d = x.rv - x.mv;
      h += '<tr tabindex="0" data-cat="' + esc(x.k) + '"' + (x.k===CAT?' class="sel"':'') + '><td>' + esc(x.k) + '</td><td class="num"><span class="meter" aria-hidden="true"><i style="width:' + (x.mv/max*100).toFixed(1) + '%"></i></span>' + fM(x.mv) + '</td><td class="num">' + fM(x.rv) + '</td><td class="num ' + (d<0?'neg':'pos') + '">' + fM(d) + '</td><td>' + pill(x.rv,x.mv) + '</td><td class="num">' + fM(x.cv) + '</td>' + (opts.noFa ? '' : '<td class="num">' + fM(x.fa) + '</td>') + '</tr>'; }
    h += '</tbody><tfoot><tr><td>Total</td><td class="num">' + fM(t.mv) + '</td><td class="num">' + fM(t.rv) + '</td><td class="num ' + (t.rv-t.mv<0?'neg':'pos') + '">' + fM(t.rv-t.mv) + '</td><td>' + pill(t.rv,t.mv) + '</td><td class="num">' + fM(t.cv) + '</td>' + (opts.noFa ? '' : '<td class="num">' + fM(t.fa) + '</td>') + '</tr></tfoot>';
    $('cat').innerHTML = h;
    $('cat').querySelectorAll('tbody tr').forEach(tr => {
      const go = () => { CAT = tr.dataset.cat; render(); $('th').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start'}); };
      tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
  function oriTable(L){
    const o = {Local:0, Brasil:1, China:2}, g = group(L,'ori').sort((a,b)=>(o[a.k]??9)-(o[b.k]??9));
    $('ori').innerHTML = '<thead><tr><th>Origen</th><th>' + opts.mShort + ' $M</th><th>Real $M</th><th>Cumpl.</th></tr></thead><tbody>' +
      g.map(x => '<tr><td>' + esc(x.k) + '</td><td class="num">' + fM(x.mv) + '</td><td class="num">' + fM(x.rv) + '</td><td>' + pill(x.rv,x.mv) + '</td></tr>').join('') + '</tbody>';
  }
  function skuTable(L){
    const q = $('q').value.trim().toUpperCase(), fo = $('fo').value, fs = $('fs').value, g = new Map();
    for (const r of L){
      if (CAT && r.cat !== CAT) continue; if (fo && r.ori !== fo) continue; if (q && !r.sku.toUpperCase().includes(q)) continue;
      if (!g.has(r.sku)) g.set(r.sku,{sku:r.sku, abc:r.abc, ori:r.ori, c:r.c, cu:0, mu:0, ru:0, mv:0, rv:0});
      const o = g.get(r.sku); o.cu+=r.cu; o.mu+=r.mu; o.ru+=r.ru; o.mv+=r.mv; o.rv+=r.rv;
    }
    let S = [...g.values()].filter(x => x.mv>0 || x.rv>0);
    if (fs === 'dev') S = S.filter(x => Math.abs(x.rv-x.mv) >= 1e6);
    S.sort((a,b)=>Math.abs(b.rv-b.mv)-Math.abs(a.rv-a.mv));
    $('th').textContent = 'Detalle por SKU · ' + (CAT || 'todas las categorías') + ' (' + S.length + ')';
    let h = '<thead><tr><th>SKU</th><th>ABC</th><th>Origen</th><th>Costo $</th><th>Consumo u</th><th>' + opts.mShort + ' u</th><th>Real u</th><th>' + opts.mShort + ' $ miles</th><th>Real $ miles</th><th>Desvío $ miles</th><th>Cumplimiento</th>' + (opts.motivo ? '<th class="l">Motivo</th>' : '') + '</tr></thead><tbody>';
    if (!S.length) h += '<tr><td colspan="12" class="l">No hay SKUs con presupuesto o compra para este filtro.</td></tr>';
    for (const x of S){ const d = x.rv - x.mv;
      h += '<tr><td>' + esc(x.sku) + '</td><td class="l">' + esc(x.abc||'') + '</td><td class="l">' + esc(x.ori) + '</td><td class="num">' + Math.round(x.c).toLocaleString('es-AR') + '</td><td class="num">' + fU(x.cu) + '</td><td class="num">' + fU(x.mu) + '</td><td class="num">' + fU(x.ru) + '</td><td class="num">' + fK(x.mv) + '</td><td class="num">' + fK(x.rv) + '</td><td class="num ' + (d<0?'neg':'pos') + '">' + fK(d) + '</td><td>' + pill(x.rv,x.mv) + '</td>' + (opts.motivo ? '<td class="l">' + esc(motivoSku(x)) + '</td>' : '') + '</tr>'; }
    $('sku').innerHTML = h + '</tbody>';
  }
  function render(){ const L = sel(); kpis(L); catTable(L); oriTable(L); skuTable(L); }
  root.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    MES = +b.dataset.m; root.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x===b ? 'true' : 'false')); render(); }));
  ['q','fo','fs'].forEach(s => $(s).addEventListener('input', () => skuTable(sel())));
  const g0 = group(rows,'cat').sort((a,b)=>b.mv-a.mv)[0]; CAT = g0 ? g0.k : null;
  render();
}

/* ---------- pestaña: rendición de cuentas (panel ejecutivo con los KPIs de la gerencia) ---------- */
const EST = [
  {k:'Debajo del stock de seguridad', l:'Bajo seguridad', c:'st-ss'},
  {k:'Debajo del objetivo', l:'Bajo punto de pedido', c:'st-rop'},
  {k:'En rango', l:'En rango', c:'st-ok'},
  {k:'Exceso', l:'Exceso', c:'st-ex'}];
const isABC = x => ['A','B','C'].indexOf(x.abc) >= 0, est_ = x => x.r[C('Estado')] || '';
const conStock = x => C('Disponible u') >= 0 ? v(x,'Disponible u') > 0 : v(x,'Disponible $') > 0;
const GR = [
  {k:'ss', l:'Bajo seguridad', c:'st-ss', pol:'Sí · fuera', f:x => isABC(x) && est_(x) === 'Debajo del stock de seguridad'},
  {k:'rop', l:'Bajo punto de pedido', c:'st-rop', pol:'Sí · dentro', f:x => isABC(x) && est_(x) === 'Debajo del objetivo'},
  {k:'ok', l:'En rango', c:'st-ok', pol:'Sí · dentro', f:x => isABC(x) && est_(x) === 'En rango'},
  {k:'ex', l:'Exceso', c:'st-ex', pol:'Sí · fuera', f:x => isABC(x) && est_(x) === 'Exceso'},
  {k:'ag', l:'Agotándose (no se repone)', c:'st-ag', pol:'No', f:x => isABC(x) && EST.every(e => e.k !== est_(x))},
  {k:'scs', l:'Sin consumo, con stock', c:'st-sc', pol:'No', f:x => !isABC(x) && conStock(x)},
  {k:'scn', l:'Sin consumo ni stock', c:'st-no', pol:'No', f:x => !isABC(x) && !conStock(x)}];
const pct = (x, d) => x === null || !isFinite(x) ? '–' : (x*100).toLocaleString('es-AR',{minimumFractionDigits:d||0, maximumFractionDigits:d||0}) + '%';
const f1 = x => x === null || !isFinite(x) ? '–' : x.toLocaleString('es-AR',{minimumFractionDigits:1, maximumFractionDigits:1});
function tile(code, name, val, note, cls){
  return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kcode">' + code + '</div><div class="eyebrow">' + name + '</div><div class="v">' + val + '</div><div class="n">' + note + '</div></div>';
}
/* ---------- detalle del inventario (rendición: qué insumo, cuánto y por qué) ---------- */
const mot = x => v(x,'Inmovilizado $') <= 0 ? '' : (v(x,'Sin mov $') > 0 ? 'sm' : (x.r[C('Método')] === 'Discontinuado' ? 'disc' :
  (C('Cobertura sem') >= 0 && (v(x,'Consumo sem') <= 0 || v(x,'Cobertura sem') - v(x,'Máximo sem') > 52) ? 'exl' : 'ex')));
const MOTL = {sm:'Sin movimiento', disc:'Línea discontinuada', exl:'Exceso que no se absorbe en un año', ex:'Exceso que se absorbe'};
const MC_ = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function consMeses(){   /* nombres de los 4 meses de consumo real (Cons real u 1..4), el 4 = mes de corte */
  const c = String(STATE.meta.corte || '').split(' ')[0].toLowerCase(), i = MC_.indexOf(c);
  return i < 0 ? ['mes -3','mes -2','mes -1','mes de corte'] : [3,2,1,0].map(d => MC_[(i - d + 12) % 12]);
}
const f1s = x => (Math.round(x*10)/10).toLocaleString('es-AR');
const semT = w => w > 104 ? 'más de 2 años' : (w > 52 ? 'más de un año' : (Math.round(w*10)/10 === 1 ? '1 semana' : f1s(w) + ' semanas'));
function porQue(x){   /* {c: etiqueta corta (HTML), l: explicación completa (texto, va en el tooltip)} */
  const m = mot(x), du = v(x,'Disponible u'), w = v(x,'Consumo sem'), cob = v(x,'Cobertura sem'), mx = v(x,'Máximo sem'), ss = v(x,'Seguridad sem'), ob = v(x,'Objetivo sem');
  const hasU = C('Disponible u') >= 0, sw = z => z > 104 ? '+2 años' : (z > 52 ? '+1 año' : f1s(z) + ' sem');
  if (m === 'sm'){ const cm = consMeses(), last = [4,3,2,1].find(j => v(x,'Cons real u ' + j) > 0), d_ = x.r[C('Método')] === 'Discontinuado';
    return {c:'<b>Sin movimiento</b> · ' + (last ? 'último consumo ' + cm[last-1] : 'sin consumo desde antes de ' + cm[0]),
            l:'No se consumió en ' + cm[1] + '–' + cm[3] + '. ' + (last ? 'Último consumo en ' + cm[last-1] + '. ' : '') + (hasU ? 'Quedan ' + fU(du) + ' u.' : '') + (d_ ? ' Línea discontinuada.' : '')}; }
  if (m === 'disc') return {c:'<b>Discontinuado</b> · quedan ' + fU(du) + ' u', l:'Línea discontinuada: se consume y no se recompra. Quedan ' + fU(du) + ' u' + (w > 0 ? ', ' + semT(du/w) + ' de consumo.' : '.')};
  if (m === 'ex' || m === 'exl') return hasU && w > 0
    ? {c:'<b>Exceso</b> · ' + sw(cob) + ' vs máx. ' + f1s(mx), l:'Cubre ' + semT(cob) + ' y el máximo es ' + semT(mx) + '. Sobran unas ' + fU((cob-mx)*w) + ' u' + (cob - mx > 52 ? '; al consumo proyectado no se absorbe en un año.' : '; se absorbe en ' + semT(cob-mx) + ' si no se compra.')}
    : {c:'<b>Exceso</b>', l:'Stock por encima del máximo de la política.'};
  const e = x.r[C('Estado')] || '';
  if (hasU && e === 'Debajo del stock de seguridad') return {c:'Bajo seguridad · ' + sw(cob) + ' vs ' + f1s(ss), l:'Cubre ' + semT(cob) + '; la seguridad es ' + semT(ss) + '.'};
  if (hasU && e === 'Debajo del objetivo') return {c:'Bajo punto de pedido · ' + sw(cob) + ' vs ' + f1s(ob), l:'Cubre ' + semT(cob) + '; el punto de pedido es ' + semT(ob) + ': toca emitir la orden.'};
  if (hasU && e === 'En rango') return {c:'En rango · ' + sw(cob), l:'Cubre ' + semT(cob) + ', entre el punto de pedido (' + f1s(ob) + ') y el máximo (' + f1s(mx) + ').'};
  return {c:esc(e), l:e};
}
function prevInm(){   /* inmovilizado por insumo de la versión publicada anterior (si se guardó) */
  const cur = String(STATE.meta.version || ''), H = (STATE.hist || []).filter(h => h.inm && String(h.version) < cur);
  return H.length ? H[H.length - 1] : null;
}
function wireInv(root){
  let det = document.getElementById('pn-det');
  if (!det){ det = document.createElement('section'); det.className = 'card det'; det.id = 'pn-det'; det.hidden = true; }
  const P = prevInm();
  function show(after, title, list, opts){
    opts = opts || {};
    const L = list.slice().sort((a,b)=>v(b,'Inmovilizado $')-v(a,'Inmovilizado $') || v(b,'Disponible $')-v(a,'Disponible $'));
    const tot = L.reduce((a,x)=>(a.va+=v(x,'Disponible $'), a.ob+=v(x,'Objetivo $'), a.mx+=v(x,'Máximo $'), a.cp+=v(x,'Inmovilizado $'), a.cu+=v(x,'Entrante $')+v(x,'Compra $'), a), {va:0, ob:0, mx:0, cp:0, cu:0});
    const bm = {sm:0, disc:0, exl:0, ex:0}; L.forEach(x => { const m = mot(x); if (m) bm[m] += v(x,'Inmovilizado $'); });
    const res = Object.keys(bm).filter(k => bm[k] > 0).map(k => MOTL[k] + ' $ ' + fM(bm[k]) + ' M').join(' · ');
    const hasMx = C('Máximo $') >= 0, d = x => v(x,'Objetivo $') > 0;
    let acc = 0; const LIM = 25, full = !!opts.full;
    const rows = L.map((x, i) => { const cp = v(x,'Inmovilizado $'); acc += cp; const cu = v(x,'Entrante $') + v(x,'Compra $');
      const dv = P ? cp - ((P.inm || {})[x.sku] || 0) : 0;
      return '<tr><td class="sk">' + esc(x.sku) + '<span class="sub2">' + esc(x.cat) + ' · ' + esc(x.abc) + '</span></td><td class="num"><b>' + fK(cp) + '</b></td>' + (q => '<td class="l why2" title="' + esc(q.l) + '">' + q.c + '</td>')(porQue(x)) +
        '<td class="num">' + (cu > 0 ? (cp > 0 ? '<span class="pill p-warn">' + fK(cu) + '</span>' : fK(cu)) : '–') + '</td>' +
        (P ? '<td class="num ' + (dv > 5e4 ? 'pos' : (dv < -5e4 ? 'neg' : '')) + '">' + (Math.abs(dv) < 5e4 ? '=' : (dv > 0 ? '+' : '') + fK(dv)) + '</td>' : '') +
        '<td class="num">' + fK(v(x,'Disponible $')) + '</td><td class="num">' + (d(x) ? fK(v(x,'Objetivo $')) : '–') + '</td>' +
        (hasMx ? '<td class="num">' + (d(x) ? fK(v(x,'Máximo $')) : '–') + '</td>' : '') + '<td class="num">' + (tot.cp > 0 && cp > 0 ? pct(acc/tot.cp) : '–') + '</td></tr>'; }).filter((r, i) => full || i < LIM).join('') +
      (!full && L.length > LIM ? '<tr><td colspan="9" class="l"><button type="button" class="lnk" id="pn-detm">Ver los ' + (L.length - LIM) + ' insumos restantes (el total de abajo ya los incluye)</button></td></tr>' : '');
    det.innerHTML = '<div class="hd"><h2>' + esc(title) + ' · ' + L.length + ' insumos' + (tot.cp > 0 ? ' · $ ' + fM(tot.cp) + ' M inmovilizados' : '') + '</h2><button type="button" class="btn sm" id="pn-detx">Cerrar</button></div>' +
      (res ? '<p class="hint pad">' + res + (opts.nota ? ' · ' + opts.nota : '') + '</p>' : (opts.nota ? '<p class="hint pad">' + opts.nota + '</p>' : '')) +
      '<div class="tw"><table><thead><tr><th>Insumo</th><th>Inmovilizado $ mil</th><th class="l">Motivo</th><th>Compras en curso $ mil</th>' + (P ? '<th>vs ' + esc(P.version) + ' $ mil</th>' : '') +
      '<th>Disponible $ mil</th><th>Objetivo $ mil</th>' + (hasMx ? '<th>Máximo $ mil</th>' : '') + '<th>% acum.</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9" class="l">No hay insumos para esta selección.</td></tr>') + '</tbody><tfoot><tr><td>Total</td><td class="num">' + fK(tot.cp) + '</td><td></td><td class="num">' + fK(tot.cu) + '</td>' + (P ? '<td></td>' : '') +
      '<td class="num">' + fK(tot.va) + '</td><td class="num">' + fK(tot.ob) + '</td>' + (hasMx ? '<td class="num">' + fK(tot.mx) + '</td>' : '') + '<td></td></tr></tfoot></table></div>' +
      '<p class="hint pad">Pasá el mouse por el motivo para ver la explicación. Inmovilizado: sin movimiento y discontinuado → todo el disponible; exceso → disponible − máximo. Compras en curso = OC ya emitidas que llegan en el horizonte + compra del presupuesto.</p>';
    after.after(det); det.hidden = false;
    const more = document.getElementById('pn-detm'); if (more) more.addEventListener('click', () => show(after, title, list, Object.assign({}, opts, {full:true})));
    document.getElementById('pn-detx').addEventListener('click', () => { det.hidden = true; root.querySelectorAll('.sel').forEach(e => e.classList.remove('sel')); });
    det.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
  const mark = el => { root.querySelectorAll('.sel').forEach(e => e.classList.remove('sel')); el.classList.add('sel'); };
  const act = (el, fn) => { el.addEventListener('click', e => { e.stopPropagation(); fn(); }); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); e.stopPropagation(); fn(); } }); };
  const IM = SK.filter(x => v(x,'Inmovilizado $') > 0);
  const comp = document.getElementById('pn-comp'), abc = document.getElementById('pn-abc'), icc = document.getElementById('pn-icc');
  if (comp) comp.querySelectorAll('[data-mot]').forEach(el => act(el, () => { mark(el); const k = el.dataset.mot;
    if (k === 'top') return show(comp, 'Los 20 insumos con más capital inmovilizado', IM.slice().sort((a,b)=>v(b,'Inmovilizado $')-v(a,'Inmovilizado $')).slice(0,20));
    if (k === 'curso') return show(comp, 'Insumos inmovilizados con compras en curso', IM.filter(x => v(x,'Entrante $') + v(x,'Compra $') > 0), {nota:'No siempre es un error: puede sobrar hoy y hacer falta en los próximos meses, pero conviene revisar cada orden'});
    const L = k === 'all' ? IM : (k === 'dec' ? IM.filter(x => ['sm','disc','exl'].indexOf(mot(x)) >= 0) : IM.filter(x => mot(x) === k));
    show(comp, {all:'Capital inmovilizado', dec:'Inmovilizado que requiere una decisión', sm:'Inmovilizado sin movimiento', disc:'Inmovilizado de líneas discontinuadas', exl:'Exceso que no se absorbe en un año', ex:'Exceso que se absorbe consumiendo'}[k], L); }));
  if (abc){
    abc.querySelectorAll('tr[data-abc]').forEach(el => act(el, () => { mark(el); show(abc, 'Clase ' + el.dataset.abc + ' · capital inmovilizado', IM.filter(x => x.abc === el.dataset.abc)); }));
    abc.querySelectorAll('i[data-st]').forEach(el => act(el, () => { mark(el.closest('tr')); const e = EST.find(z => z.k === el.dataset.st);
      show(abc, 'Clase ' + el.dataset.abc + ' · ' + (e ? e.l : el.dataset.st), SK.filter(x => x.abc === el.dataset.abc && x.r[C('Estado')] === el.dataset.st)); }));
  }
  const allc = document.getElementById('pn-all');
  if (allc) allc.querySelectorAll('[data-grp]').forEach(el => act(el, () => { const gq = GR.find(z => z.k === el.dataset.grp); mark(el.tagName === 'TR' ? el : allc.querySelector('tr[data-grp="' + gq.k + '"]')); show(allc, gq.l, SK.filter(gq.f)); }));
  if (icc) icc.querySelectorAll('tr[data-cat]').forEach(el => act(el, () => { mark(el); show(icc, el.dataset.cat + ' · capital inmovilizado', IM.filter(x => x.cat === el.dataset.cat)); }));
}
function viewPanel(root){
  const has = C('Estado') >= 0;
  const S = n => SK.reduce((a,x)=>a+v(x,n),0);
  const closed = A.map((a,i)=>({a, k:i+1})).filter(o => o.a.cerrado);
  const FU = Math.abs(STATE.meta.fuera || 0) >= 1 ? STATE.meta.fuera : 0;
  const apT = [1,2,3,4].reduce((s,k)=>s+S('Aprob $ '+k),0) + FU, vgT = [1,2,3,4].reduce((s,k)=>s+S('Vig $ '+k),0);
  const SB = k => SK.reduce((a,x)=>a+vb(x,k),0);
  const apC = closed.reduce((s,o)=>s+SB(o.k),0), rlC = closed.reduce((s,o)=>s+S('Real $ '+o.k),0);
  const rt = RETRO.reduce((a,r)=>(a.mv+=r.mv, a.rv+=r.rv, a), {mv:0, rv:0});
  const mon = A.map(a => cap(a.mes || '–'));
  const sm = t => String(t || '').split(' ')[0].slice(0,3).toLowerCase();
  const rango = sm(A[0].mes) + '–' + sm(A[3].mes);
  const D = STATE.meta.des || {}, hasD = false;   // v21: N2.5 Desembolsos sale del tablero (Finanzas usa la hoja Compras y plazos del libro)
  const desMes = j => ['fa','oc','rs','pr','gi'].reduce((a,k)=>a+(D['p_'+k+'_'+j]||0),0);
  const hasC = n => C(n) >= 0;
  const vs_ = String(STATE.meta.version || ''), curKey = D.anio ? D.anio * 100 + (D.mes_actual || 0) : (Number(vs_.slice(0,4)) * 100 + Number(vs_.slice(5,7)) || 0);
  const curIdx = A.findIndex(a => Number(a.clave) === curKey);   // mes aprobado que está en curso (0..3) o -1
  const cm = curIdx >= 0 ? curIdx + 1 : 0, cmU = cm || 1;          // mes en curso (1..4); 0 = la versión no está en el horizonte
  // v22: el horizonte vigente (VG) puede estar corrido respecto del aprobado (A): se alinean por año-mes
  const viOf = k => { if (!A[k-1]) return 0; const i = VG.findIndex(g => Number(g.clave) === Number(A[k-1].clave)); return i >= 0 ? i + 1 : 0; };
  const SV = (p, k) => { const i = viOf(k); return i ? S(p + i) : 0; }, vv = (x, p, k) => { const i = viOf(k); return i ? v(x, p + i) : 0; };
  const FUT = [1,2,3,4].filter(k => k !== cm && viOf(k) > 0 && !A[k-1].cerrado);   // meses aprobados que todavía no empezaron
  const rangoF = FUT.length ? sm(A[FUT[0]-1].mes) + '–' + sm(A[FUT[FUT.length-1]-1].mes) : '';
  const noCompra = k => k === cm && SV('Vig $ ', k) < 5e4;           // mes en curso sin compras nuevas posibles (fin de mes)
  const desTot = hasD ? [1,2,3,4].reduce((a,j)=>a+desMes(j),0) : 0;
  let h = '<section class="read"><p><b>Rendición de cuentas de Compras de materias primas.</b> Indicadores con los mismos códigos del tablero de KPIs (N1, N2.x). ' +
    'Datos del libro: corte ' + esc(STATE.meta.corte) + ', exportación del ' + esc(STATE.meta.version) + '. Presupuesto aprobado: ' + esc(STATE.meta.aprobado) + '.</p></section>';

  /* ----- compras (un solo selector de período para todo el bloque) ----- */
  const segN = '<button type="button" data-m="0" aria-pressed="true">Horizonte ' + esc(rango) + '</button>' + A.map((a,i) => '<button type="button" data-m="' + (i+1) + '" aria-pressed="false">' + esc(cap(sm(a.mes))) + '</button>').join('');
  h += '<div class="blkhd"><h2 class="blk">Compras</h2><div class="seg" role="group" aria-label="Período del bloque Compras" id="pn-seg">' + segN + '</div></div>' +
    '<section class="kpis" id="pn-kc"></section>';
  {
    const MR = [7,8,9].map(m => { const L = RETRO.filter(r => r.m === m); return {lab:cap(MC_[m-1]) + ' 2026', mv:L.reduce((a,r)=>a+r.mv,0), rv:L.reduce((a,r)=>a+r.rv,0), tag:'Prueba retrospectiva', go:'retro:' + m}; }).filter(o => o.mv > 0 || o.rv > 0);
    const MCx = MR.concat(CERR.map(c => { const t = cTot(c); return {lab:cap(c.mes), mv:t.mv, rv:t.rv, tag:'vs ' + verCorta(c.version), go:'cumplimiento:' + c.clave}; }));
    if (MCx.length) h += '<section class="card" id="pn-mc"><div class="hd"><h2>N1 · Resultado de los meses cerrados</h2><span class="hint">Clic en un mes para ver el detalle por categoría y por SKU</span></div><div class="mtiles">' +
      MCx.map(o => { const d = o.rv - o.mv; return '<button type="button" class="mt mtb" data-go="' + o.go + '"><b>' + esc(o.lab) + '</b><span>' + pill(o.rv, o.mv) + '</span><span>Real <span class="num">' + fM(o.rv) + '</span> vs <span class="num">' + fM(o.mv) + '</span></span><span>Desvío <span class="num ' + (d < 0 ? 'neg' : 'pos') + '">' + (d >= 0 ? '+' : '−') + fM(Math.abs(d)) + '</span> $M</span><span class="hint">' + esc(o.tag) + '</span></button>'; }).join('') +
      '</div><p class="hint pad">Julio a septiembre: prueba retrospectiva, sin presupuesto aprobado (lo que el modelo habría indicado). Desde octubre: contra la versión aprobada vigente en ese mes, más el entrante comprometido al aprobar. El detalle de cada mes queda congelado al cerrar.</p></section>';
  }
  h += '<section class="card"><div class="hd"><h2 id="pn-cch">N2.1 · Presupuesto y cumplimiento por categoría ($M)</h2></div>' +
    '<div class="mtiles" id="pn-mt"></div><p class="hint pad" id="pn-hint"></p><div class="tw"><table id="pn-cc"></table></div></section>';
  if (has) h += '<section class="card"><div class="hd"><h2 id="pn-urh">N2.2 · Compras de urgencia</h2><span class="hint">Clic en un motivo para ver los insumos</span></div><div class="tw small-t"><table id="pn-urg"></table></div><p class="hint pad" id="pn-urn"></p><div id="pn-urd" class="subdet" hidden></div></section>';
  if (hasD) h += '<section class="card"><div class="hd"><h2>N2.5 · Desembolsos: pagado y proyectado ($M, con IVA y percepciones)</h2><div class="legend">' +
    '<span class="sw d1" aria-hidden="true"></span>Materia prima neta <span class="sw d2" aria-hidden="true"></span>IVA y percepciones <span class="sw d3" aria-hidden="true"></span>Gastos de importación <span class="sw pjs" aria-hidden="true"></span>Claro = proyectado</div></div>' +
    '<div class="dchart" id="pn-dc"></div><div class="tw"><table id="pn-dt"></table></div><div class="tw"><table id="pn-ds"></table></div>' +
    '<p class="hint pad">Pagado = pagos a proveedores de MP y gastos de importación registrados en Odoo. Proyectado = facturas abiertas por vencimiento + OC emitidas que faltan recibir + recepciones sin facturar (descontando pagos sin factura recientes del mismo proveedor) + compras del presupuesto con el plazo de cada proveedor + gastos de importación (promedio de los 3 últimos meses). China: anticipo al emitir y saldo al embarque o a 60/75 días del BL según el insumo. USD a $ ' + Math.round(D.tc).toLocaleString('es-AR') + ' (cotización del día de Odoo).</p></section>';

  /* ----- inventario ----- */
  const fv = String(STATE.meta.version || ''), fvd = /^\d{4}-\d{2}-\d{2}/.test(fv) ? fv.slice(8,10) + '/' + fv.slice(5,7) + '/' + fv.slice(0,4) : fv;
  const VV = STATE.vivo, vh = VV ? new Date(VV.generado).toLocaleString('es-AR', {timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : '';
  h += '<h2 class="blk">Inventario</h2><p class="foto">' + (VV ? 'Stock y costo en vivo de Odoo (' + esc(vh) + ', se refresca cada 10 min) en ' + VV.cruzados + ' de ' + VV.total + ' SKUs; los otros ' + (VV.total - VV.cruzados) + ' quedan con el valor del libro (exportación del ' + esc(fvd) + '). Los umbrales de la política y el consumo proyectado son los del libro' : 'Foto al ' + esc(fvd) + ' (exportación de Odoo)') + ' · stock disponible, sin lo reservado para fabricación · la rotación usa los últimos 5 cierres de mes.</p>';
  if (!has){
    h += '<section class="empty"><b>Faltan los datos de inventario.</b><p>Esta versión del tablero se publicó desde un libro anterior a la v11. Subí el libro v11 o posterior con "Actualizar desde el libro".</p></section>';
  } else {
    const va = S('Disponible $'), vi = S('Ideal $'), capT = S('Inmovilizado $'), sm = S('Sin mov $'), stv = S('Stock prom $'), ca = S('Consumo anual $');
    const cls = ['A','B','C'].map(c => {
      const L = SK.filter(x => x.abc === c), o = {c, n: EST.map(e => L.filter(x => x.r[C('Estado')] === e.k).length)};
      o.obj = L.reduce((a,x)=>a+v(x,'Objetivo $'),0); o.st = L.filter(x => v(x,'Objetivo $') > 0).reduce((a,x)=>a+v(x,'Disponible $'),0);
      o.dev = o.obj > 0 ? (o.st - o.obj)/o.obj : null; o.cap = L.reduce((a,x)=>a+v(x,'Inmovilizado $'),0); o.tot = o.n.reduce((a,b)=>a+b,0); return o; });
    const nT = EST.map((e,i) => cls.reduce((a,o)=>a+o.n[i],0)), tot = nT.reduce((a,b)=>a+b,0);
    const objT = cls.reduce((a,o)=>a+o.obj,0), stT = cls.reduce((a,o)=>a+o.st,0);
    h += '<section class="kpis">' +
      tile('Inventario · N2.1', 'Valor del inventario', '$ ' + fM(va) + ' M', 'Ideal según la política: $ ' + fM(vi) + ' M') +
      tile('Inventario · N1', 'Capital inmovilizado', '$ ' + fM(capT) + ' M', pct(va > 0 ? capT/va : null) + ' del valor: sin movimiento + líneas discontinuadas + exceso sobre el máximo') +
      tile('Inventario · N1', 'SKUs dentro de la política', pct(tot > 0 ? (nT[1]+nT[2])/tot : null), (nT[1]+nT[2]) + ' de ' + tot + ' SKUs con política (A, B y C con consumo). Los otros ' + (SK.length - tot) + ' de los ' + SK.length + ' SKUs del libro no tienen política: sin consumo o agotándose (ver abajo)') +
      tile('Inventario · N2.2', 'Desviación vs punto de pedido', (objT > 0 && stT >= objT ? '+' : '') + pct(objT > 0 ? (stT-objT)/objT : null), cls.map(o => o.c + ' ' + (o.dev !== null && o.dev >= 0 ? '+' : '') + pct(o.dev)).join(' · ')) +
      tile('Inventario · N2.3', 'Rotación real', f1(stv > 0 ? ca/stv : null) + ' <small>veces/año</small>', 'Consumo anualizado / stock promedio de los últimos 5 cierres') +
      tile('Inventario · N2.4', 'Sin movimiento 3+ meses', pct(va > 0 ? sm/va : null, 1), '$ ' + fM(sm) + ' M sin consumo en los 3 últimos meses cerrados') +
      '</section>';
    {
      const G = GR.map(gq => { const L = SK.filter(gq.f); return Object.assign({}, gq, {n:L.length, va:L.reduce((a,x)=>a+v(x,'Disponible $'),0)}); }), NT = SK.length;
      h += '<section class="card" id="pn-all"><div class="hd"><h2>N1 · Los ' + NT + ' SKUs del libro</h2><span class="hint">Clic en un grupo o en un color de la barra para ver los insumos</span></div>' +
        '<div class="pad"><div class="stack wide" role="group" aria-label="' + G.map(o => o.l + ' ' + o.n).join(', ') + '">' +
        G.map(o => o.n ? '<i class="' + o.c + '" style="flex:' + o.n + '" role="button" tabindex="0" data-grp="' + o.k + '" title="' + esc(o.l) + ': ' + o.n + ' SKUs" aria-label="Ver ' + esc(o.l) + '"></i>' : '').join('') + '</div></div>' +
        '<div class="tw small-t"><table><thead><tr><th>Grupo</th><th>SKUs</th><th>% de los SKUs</th><th>Stock disponible $M</th><th class="l">Cuenta en "dentro de la política"</th></tr></thead><tbody>' +
        G.map(o => '<tr tabindex="0" data-grp="' + o.k + '"><td><span class="sw ' + o.c + '" aria-hidden="true" style="margin:0 8px 0 0"></span>' + esc(o.l) + '</td><td class="num">' + o.n + '</td><td class="num">' + pct(NT ? o.n/NT : null) + '</td><td class="num">' + fM(o.va) + '</td><td class="l">' + o.pol + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td>Total</td><td class="num">' + NT + '</td><td class="num">100%</td><td class="num">' + fM(G.reduce((a,o)=>a+o.va,0)) + '</td><td class="l">' + (nT[1]+nT[2]) + ' dentro de ' + tot + ' con política = ' + pct(tot > 0 ? (nT[1]+nT[2])/tot : null) + '</td></tr></tfoot></table></div>' +
        '<p class="hint pad">Con política = SKUs A, B o C con consumo proyectado: tienen stock de seguridad, punto de pedido y máximo. Sin consumo = no se usan en el horizonte (líneas discontinuadas, sin movimiento, consignados): no tienen política, y su stock es capital inmovilizado.</p></section>';
    }
    const leg = '<div class="legend">' + EST.map(e => '<span class="sw ' + e.c + '" aria-hidden="true"></span>' + e.l).join(' ') + '</div>';
    const scL = SK.filter(x => x.abc === 'Sin consumo');
    const scO = {c:'Sin consumo', n:EST.map(()=>0), tot:scL.length, dev:null, cap:scL.reduce((a,x)=>a+v(x,'Inmovilizado $'),0), sc:true};
    let t = '<thead><tr><th>Clase</th><th class="l">Distribución</th>' + EST.map(e => '<th>' + e.l + '</th>').join('') + '<th>Desviación</th><th>Inmovilizado $M</th></tr></thead><tbody>';
    for (const o of cls.concat([scO, {c:'Total', n:nT, tot:tot + scL.length, dev: objT > 0 ? (stT-objT)/objT : null, cap: cls.reduce((a,x)=>a+x.cap,0) + scO.cap}])){
      const isT = o.c === 'Total';
      const bar = o.sc ? '<span class="hint">' + o.tot + ' SKUs sin consumo proyectado: fuera de la política</span>' :
        '<div class="stack" role="group" aria-label="' + EST.map((e,i)=>e.l + ' ' + o.n[i]).join(', ') + '">' +
        EST.map((e,i) => o.n[i] ? '<i class="' + e.c + '" style="flex:' + o.n[i] + '" title="' + e.l + ': ' + o.n[i] + ' SKUs (' + pct(o.n[i]/o.tot) + ')' + (isT ? '' : ' · clic para ver cuáles') + '"' +
          (isT ? '' : ' role="button" tabindex="0" data-abc="' + o.c + '" data-st="' + esc(e.k) + '" aria-label="Ver ' + e.l + ' de la clase ' + o.c + '"') + '></i>' : '').join('') + '</div>';
      t += '<tr' + (isT ? ' class="tot"' : ' tabindex="0" data-abc="' + o.c + '"') + '><td><b>' + o.c + '</b></td><td class="l dist">' + bar + '</td>' + o.n.map(x => '<td class="num">' + (o.sc ? '–' : x) + '</td>').join('') +
        '<td class="num ' + (o.dev !== null && o.dev < 0 ? 'neg' : 'pos') + '">' + (o.dev !== null && o.dev >= 0 ? '+' : '') + pct(o.dev) + '</td><td class="num">' + fM(o.cap) + '</td></tr>';
    }
    /* composición del capital inmovilizado: un motivo por insumo, en el mismo orden que el libro */
    const IM = SK.filter(x => v(x,'Inmovilizado $') > 0), capAll = IM.reduce((a,x)=>a+v(x,'Inmovilizado $'),0);
    const curso = x => v(x,'Entrante $') + v(x,'Compra $');
    const grp = (f) => { const L = IM.filter(x => mot(x) === f); return {n:L.length, cap:L.reduce((a,x)=>a+v(x,'Inmovilizado $'),0), cn:L.filter(x=>curso(x)>0).length, cc:L.filter(x=>curso(x)>0).reduce((a,x)=>a+v(x,'Inmovilizado $'),0)}; };
    const gS = grp('sm'), gD = grp('disc'), gL = grp('exl'), gE = grp('ex');
    const add = (a,b) => ({n:a.n+b.n, cap:a.cap+b.cap, cn:a.cn+b.cn, cc:a.cc+b.cc});
    const gDec = add(add(gS, gD), gL), gTot = add(gDec, gE);
    const top20 = IM.slice().sort((a,b)=>v(b,'Inmovilizado $')-v(a,'Inmovilizado $')).slice(0,20).reduce((a,x)=>a+v(x,'Inmovilizado $'),0);
    const enCurso = IM.filter(x => curso(x) > 0), ecIn = enCurso.reduce((a,x)=>a+curso(x),0);
    const crow = (lab, g, key, cls_) => '<tr' + (key ? ' tabindex="0" data-mot="' + key + '"' : '') + (cls_ ? ' class="' + cls_ + '"' : '') + '><td>' + lab + '</td><td class="num">' + g.n + '</td><td class="num">' + fM(g.cap) + '</td><td class="num">' + pct(capAll > 0 ? g.cap/capAll : null) + '</td><td class="num">' + (g.cn ? g.cn + ' · $ ' + fM(g.cc) + ' M' : '–') + '</td></tr>';
    h += '<section class="card" id="pn-comp"><div class="hd"><h2>N1 · Capital inmovilizado: de qué está hecho</h2><span class="hint">Clic en una fila para ver los insumos</span></div><div class="tw"><table>' +
      '<thead><tr><th>Motivo</th><th>Insumos</th><th>$M</th><th>% del inmovilizado</th><th>con compras en curso</th></tr></thead><tbody>' +
      crow('<b>Requiere una decisión</b> <span class="hint">(no baja solo)</span>', gDec, 'dec', 'grp') +
      crow('<span class="ind">Sin movimiento 3+ meses</span>', gS, 'sm') + crow('<span class="ind">Línea discontinuada</span>', gD, 'disc') + crow('<span class="ind">Exceso que no se absorbe en un año de consumo</span>', gL, 'exl') +
      crow('<b>Se absorbe consumiendo</b> <span class="hint">(exceso que baja en menos de un año si no se compra)</span>', gE, 'ex', 'grp') +
      '</tbody><tfoot>' + crow('Total', gTot, 'all') + '</tfoot></table></div>' +
      '<div class="flags pad"><button type="button" class="lnk" data-mot="top">Los 20 insumos con más inmovilizado explican el ' + pct(capAll > 0 ? top20/capAll : null) + ' del total</button>' +
      '<button type="button" class="lnk warn" data-mot="curso">' + enCurso.length + ' insumos inmovilizados tienen compras en curso: $ ' + fM(ecIn) + ' M entrando o en el presupuesto</button></div></section>';
    h += '<section class="card" id="pn-abc"><div class="hd"><h2>N1 · N2.2 · Ajuste a la política por clase ABC</h2>' + leg + '</div><div class="tw"><table>' + t + '</tbody></table></div>' +
      '<p class="hint pad">Clic en una clase para ver su capital inmovilizado, o en un color de la barra para ver los insumos en ese estado. Bajo punto de pedido = toca emitir la orden; sigue dentro de la política. Desviación = (stock actual − punto de pedido) ÷ punto de pedido, valorizado. Una clase A negativa indica poca cobertura en los insumos que más pesan.</p></section>';
    h += '<section class="card" id="pn-icc"><div class="hd"><h2>N2.1 · N2.3 · N2.4 · Inventario por categoría ($M)</h2><span class="hint">Ordenado por valor · clic en una categoría para ver su capital inmovilizado</span></div><div class="tw"><table id="pn-ic"></table></div></section>';
  }
  const HI = STATE.hist || [];
  if (HI.length) h += '<section class="card"><div class="hd"><h2>Historial de los indicadores</h2><span class="hint">Una fila por versión publicada: así queda la evidencia de la evolución</span></div><div class="tw"><table id="pn-hist"></table></div></section>';
  h += '<section class="notes"><div class="eyebrow">Para tener en cuenta</div><ol>' +
    '<li>Compra real = llegadas físicas del mes (stock al cierre − stock al inicio + consumo) a costo presupuestado. Se compara contra la compra aprobada más el entrante comprometido al aprobar, porque las llegadas incluyen órdenes emitidas antes de la aprobación. El gasto facturado no se usa porque no trae todas las importaciones.</li>' +
    '<li>Compras de urgencia: se calcula sobre el presupuesto (lo que el modelo prevé comprar de apuro), no sobre las órdenes emitidas. Para medirlo sobre órdenes reales hace falta marcar las OC urgentes en Odoo.</li>' +
    '<li>Capital inmovilizado: stock sin consumo en 3 meses, stock de líneas discontinuadas (se consume y no se recompra) y exceso sobre el máximo de la política, sin contar dos veces.</li>' +
    '<li>Desvío proyectado vs aprobado: compara la versión aprobada con el recálculo de hoy, solo para los meses que todavía no empezaron. El mes en curso se mide con el cumplimiento proyectado (lo llegado y lo que falta llegar), porque a esta altura ya no admite compras nuevas.</li>' +
    '<li>Mes en curso: es una proyección (llegado a la fecha + OC con fecha en el mes + compras nuevas que llegan en el mes), comparada con la compra aprobada más el entrante comprometido al aprobar. Lo que llegó en el mes antes de congelar la versión se suma al comprometido, para no inflar el mes de la aprobación.</li>' +
    '<li>Resultado de los meses cerrados: cada mes se congela al cerrar, con la versión contra la que se midió. Aprobar una versión nueva no lo borra.</li>' +
    '<li>Fuera de esta herramienta: indicadores de proveedores (cumplimiento de entregas, precios).</li></ol></section>';
  root.innerHTML = h;
  root.querySelectorAll('#pn-mc [data-go]').forEach(b => b.addEventListener('click', () => { const [t, m] = b.dataset.go.split(':'); showTab(t);
    const btn = document.querySelector('#p-' + t + ' .seg button[data-m="' + m + '"]'); if (btn) btn.click(); document.getElementById('p-' + t).scrollIntoView({block:'start'}); }));

  /* N2.1: tarjetas por mes y tabla por categoría con selector de período */
  const dif = (a, b) => '<td class="num ' + (b-a < -5e4 ? 'neg' : (b-a > 5e4 ? 'pos' : '')) + '">' + fM(Math.abs(b-a) < 5e4 ? 0 : b-a) + '</td>';
  document.getElementById('pn-mt').innerHTML = A.map((a,i) => { const k = i+1, cur = k === cm && hasC('Proy cierre mes $'), rl = S('Real $ '+k);
    const ap = cur ? S('Aprob mes curso $') : S('Aprob $ '+k), vg = cur ? S('Proy cierre mes $') : SV('Vig $ ', k);
    return '<div class="mt"><b>' + esc(cap(a.mes)) + (cur ? ' (en curso)' : '') + '</b><span>' + (cur ? 'Aprobado + entrante' : 'Aprobado') + ' <span class="num">' + fM(ap) + '</span></span>' + (a.cerrado ? '' : '<span>' + (cur ? 'Proyectado al cierre' : 'Recalculado hoy') + ' <span class="num">' + fM(vg) + '</span></span>') +
      (a.cerrado ? '<span>Real <span class="num">' + fM(rl) + '</span> ' + pill(rl, ap) + '</span>' : '<span><span class="pill p-none">abierto</span></span>') + '</div>'; }).join('');
  function renderCur(M){
    const g = new Map();
    for (const x of SK){ if (!g.has(x.cat)) g.set(x.cat, {k:x.cat, ap:0, vg:0, de:0, dc:0});
      const o = g.get(x.cat), comp = v(x,'Entr aprob $ ' + M), apc = v(x,'Aprob $ ' + M);
      o.ap += v(x,'Aprob mes curso $'); o.vg += v(x,'Proy cierre mes $'); o.de += v(x,'Llegado mes $') + v(x,'Entrante mes $') - comp; o.dc += v(x,'Compras mes $') - apc; }
    const LC = [...g.values()].filter(o => o.ap > 0 || o.vg > 0).sort((a,b)=>Math.abs(b.vg-b.ap)-Math.abs(a.vg-a.ap));
    const tc = LC.reduce((a,o)=>(a.ap+=o.ap, a.vg+=o.vg, a.de+=o.de, a.dc+=o.dc, a), {ap:0, vg:0, de:0, dc:0});
    const sg = x => '<td class="num ' + (x < -5e4 ? 'neg' : (x > 5e4 ? 'pos' : '')) + '">' + (Math.abs(x) < 5e4 ? '0,0' : (x > 0 ? '+' : '') + fM(x)) + '</td>';
    const row = (o, lab) => '<td>' + lab + '</td><td class="num">' + fM(o.ap) + '</td><td class="num">' + fM(o.vg) + '</td>' + sg(o.vg - o.ap) + sg(o.de) + sg(o.dc);
    const per = sm(A[M-1].mes);
    document.getElementById('pn-cc').innerHTML = '<thead><tr><th>Categoría</th><th>Aprobado + entrante ' + esc(per) + '</th><th>Proyectado al cierre</th><th>Diferencia</th><th>Por OC y llegadas</th><th>Por compras nuevas</th></tr></thead><tbody>' +
      LC.map(o => '<tr>' + row(o, esc(o.k)) + '</tr>').join('') + '</tbody><tfoot><tr>' + row(tc, 'Total') + '</tr></tfoot>';
    document.getElementById('pn-hint').textContent = 'Mes en curso, ordenado por diferencia. Por OC y llegadas = (lo que ya llegó + OC con fecha en el mes) − entrante comprometido al aprobar: negativo = OC atrasadas que pasan al mes siguiente. Por compras nuevas = compras que el libro pide hoy para el mes − compra aprobada: positivo = hay que comprar más (por ejemplo, para cubrir una OC atrasada). Lo que llegó en el mes antes de congelar la versión se suma al aprobado, así el mes se compara completo contra completo.';
  }
  function renderCC(M){
    if (M > 0 && M === cm && hasC('Proy cierre mes $') && hasC('Llegado mes $')) return renderCur(M);
    const ks = M === 0 ? FUT : [M], cl = M === 0 ? closed.map(o=>o.k) : (A[M-1].cerrado ? [M] : []), curM = M > 0 && M === cm && hasC('Proy cierre mes $'), closedM = M > 0 && !!A[M-1].cerrado;
    const g = new Map();
    for (const x of SK){ if (!g.has(x.cat)) g.set(x.cat, {k:x.cat, ap:0, vg:0, apc:0, rl:0});
      const o = g.get(x.cat); if (curM){ o.ap += v(x,'Aprob mes curso $'); o.vg += v(x,'Proy cierre mes $'); } else for (const k of ks){ o.ap += v(x,'Aprob $ '+k); o.vg += vv(x,'Vig $ ',k); }
      for (const k of cl){ o.apc += vb(x,k); o.rl += v(x,'Real $ '+k); } }
    const LC = [...g.values()].filter(o => o.ap > 0 || o.vg > 0 || o.rl > 0).sort((a,b)=>b.ap-a.ap);
    if (FU && M === 0) LC.push({k:'SKUs que ya no están en la base', ap:FU, vg:0, apc:0, rl:0});
    const tc = LC.reduce((a,o)=>(a.ap+=o.ap, a.vg+=o.vg, a.apc+=o.apc, a.rl+=o.rl, a), {ap:0, vg:0, apc:0, rl:0});
    const per = M === 0 ? rangoF : sm(A[M-1].mes);
    const row = (o, lab) => '<td>' + lab + '</td><td class="num">' + fM(o.ap) + '</td>' + (closedM ? '<td class="num">–</td><td class="num">–</td>' : '<td class="num">' + fM(o.vg) + '</td>' + dif(o.ap, o.vg)) +
      (cl.length ? (M === 0 ? '<td class="num">' + fM(o.apc) + '</td>' : '') + '<td class="num">' + fM(o.rl) + '</td><td>' + pill(o.rl, o.apc) + '</td>' : '');
    document.getElementById('pn-cc').innerHTML = '<thead><tr><th>Categoría</th><th>' + (curM ? 'Aprobado + entrante ' : 'Aprobado ') + esc(per) + '</th><th>' + (curM ? 'Proyectado al cierre ' : 'Recalculado hoy ') + esc(per) + '</th><th>' + (curM ? 'Diferencia' : 'Desvío') + '</th>' +
      (cl.length ? (M === 0 ? '<th>Aprobado meses cerrados</th>' : '') + '<th>Real' + (M === 0 ? '' : ' ' + esc(per)) + '</th><th>Cumplimiento</th>' : '') + '</tr></thead><tbody>' +
      LC.map(o => '<tr>' + row(o, esc(o.k)) + '</tr>').join('') + '</tbody><tfoot><tr>' + row(tc, 'Total') + '</tr></tfoot>';
    document.getElementById('pn-hint').textContent = M === 0
      ? (closed.length ? 'Cumplimiento acumulado de los meses cerrados de esta versión: ' + closed.map(o=>cap(o.a.mes)).join(', ') + '. El acumulado no castiga los corrimientos de fecha (China llega por contenedor).' : 'Esta versión todavía no tiene meses cerrados: el primero es ' + cap(A[0].mes) + '. Los meses ya cerrados están arriba, en "Resultado de los meses cerrados".')
      : (A[M-1].cerrado ? 'Mes cerrado.' : 'Mes abierto: el real se mide al cierre.') + (M === 1 ? ' Lo que llegó en el mes antes de congelar la versión se suma al aprobado, así el mes de la aprobación se compara completo contra completo.' : '') + (curM ? ' Mes en curso: aprobado + entrante comprometido vs proyectado al cierre (llegado + entrante del mes + compras nuevas).' : '')
      + (M === 0 && cm ? ' Aprobado vs recalculado: meses ' + rangoF + ' (el mes en curso se ve en su pestaña).' : '');
  }
  /* tarjetas del bloque Compras según el período elegido */
  function renderKC(M){
    const per = M === 0 ? 'horizonte ' + rango : cap(A[M-1].mes);
    const cl = M === 0 ? closed : (A[M-1].cerrado ? [{a:A[M-1], k:M}] : []);
    const apc = cl.reduce((s,o)=>s+SB(o.k),0), rlc = cl.reduce((s,o)=>s+S('Real $ '+o.k),0);
    const lastC = CERR.length ? CERR[CERR.length - 1] : null;
    const cumT = lastC ? (() => { const t = cTot(lastC), dv = t.rv - t.mv, acc = CERR.reduce((a,c)=>{ const q = cTot(c); a.mv += q.mv; a.rv += q.rv; return a; }, {mv:0, rv:0});
        return tile('Compras · N1', 'Cumplimiento del presupuesto · ' + esc(cap(lastC.mes)) + ' (último mes cerrado)', pct(t.mv > 0 ? t.rv/t.mv : null, 1),
          'Real $ ' + fM(t.rv) + ' M vs aprobado + entrante comprometido $ ' + fM(t.mv) + ' M · desvío ' + (dv >= 0 ? '+' : '−') + '$ ' + fM(Math.abs(dv)) + ' M · medido contra la ' + esc(verCorta(lastC.version)) +
          (CERR.length > 1 ? ' · acumulado de ' + CERR.length + ' meses cerrados: ' + pct(acc.mv > 0 ? acc.rv/acc.mv : null, 1) : '') + ' · detalle en "Resultado de los meses cerrados"'); })()
      : cl.length
      ? tile('Compras · N1', 'Cumplimiento del presupuesto', pct(apc > 0 ? rlc/apc : null), 'Real $ ' + fM(rlc) + ' M vs aprobado + entrante comprometido $ ' + fM(apc) + ' M · ' + cl.map(o=>esc(cap(o.a.mes))).join(', '))
      : tile('Compras · N1', 'Cumplimiento del presupuesto', 'Pendiente', (M === 0 ? esc(mon[0]) : esc(per)) + ' se mide al cierre del mes (stock de fin de mes). Referencia julio–septiembre: ' + pct(rt.mv > 0 ? rt.rv/rt.mv : null) + ' (prueba retrospectiva)', 'muted');
    let proyT = '';
    if (hasC('Proy cierre mes $') && curIdx >= 0 && (M === 0 || M === curIdx + 1)){
      const apm = S('Aprob mes curso $'), rpr = S('Proy cierre mes $');
      const dvp = rpr - apm;
      proyT = tile('Compras · N1', 'Mes en curso · ' + esc(cap(A[curIdx].mes)) + ' (proyección al cierre)', (dvp >= 0 ? '+' : '−') + '$ ' + fM(Math.abs(dvp)) + ' M',
        'Proyectado $ ' + fM(rpr) + ' M vs aprobado + entrante comprometido $ ' + fM(apm) + ' M (' + pct(apm > 0 ? rpr/apm : null) + '). Proyectado = llegado a la fecha $ ' + fM(S('Llegado mes $')) + ' M + OC que llegan en el mes $ ' + fM(S('Entrante mes $')) + ' M + compras nuevas $ ' + fM(S('Compras mes $')) + ' M. Se confirma al cierre');
    }
    let apTile = '';
    if (!(M > 0 && (M === cm || A[M-1].cerrado))){
      const kk = M === 0 ? FUT : [M], apX = kk.reduce((a,k)=>a+S('Aprob $ '+k),0), vgX = kk.reduce((a,k)=>a+SV('Vig $ ',k),0), dv = vgX - apX;
      const perD = M === 0 ? rangoF : sm(A[M-1].mes);
      apTile = tile('Compras · N1', 'Desvío proyectado vs aprobado · ' + esc(perD), (dv >= 0 ? '+' : '−') + '$ ' + fM(Math.abs(dv)) + ' M',
        'Aprobado $ ' + fM(apX) + ' M → recalculado hoy $ ' + fM(vgX) + ' M' + (apX > 0 ? ' (' + (dv >= 0 ? '+' : '') + pct(dv/apX) + ')' : '') +
        (M === 0 ? ' · aprobado del horizonte completo $ ' + fM(apT) + ' M' + (cm ? '; el mes en curso se mide con el cumplimiento proyectado' : '') : ''));
    }
    let urT = '';
    if (has && !(M > 0 && A[M-1].cerrado)){
      const byM = M > 0 && hasC('Resp $ 1');
      const un = byM ? SV('Resp $ ',M) + (M === cmU ? S('Faltante $') : 0) : S('Respaldo $') + S('Faltante $');
      const ud = byM ? SV('Vig $ ',M) + (M === cmU ? S('Faltante $') : 0) : S('Compra $') + S('Faltante $');
      const nF = SK.filter(x => v(x,'Faltante $') >= 1).length;
      if (M > 0 && noCompra(M)) urT = tile('Compras · N2.2', 'Compras de urgencia · ' + esc(per), 'No aplica (fin de mes)',
        'No hay compras nuevas que lleguen este mes. Alerta: faltante sin compra posible $ ' + fM(S('Faltante $')) + ' M en ' + nF + ' insumos (detalle abajo)', 'muted');
      else urT = tile('Compras · N2.2', 'Compras de urgencia · ' + esc(per), pct(ud > 0 ? un/ud : null, 1), '$ ' + fM(un) + ' M de $ ' + fM(ud) + ' M' + (M > 0 && !byM ? ' (sin dato por mes en este libro: se muestra el horizonte)' : ''));
    }
    let deT = '';
    if (hasD){
      const dx = M === 0 ? desTot : desMes(M);
      const apr = M === 0 ? [1,2,3,4].reduce((a,j)=>a+(D['aprob_'+j]||0),0) : (D['aprob_'+M]||0);
      deT = tile('Compras · N2.5', 'Desembolso proyectado · ' + esc(per), '$ ' + fM(dx) + ' M', (M === 0 || M === 1 ? 'Mes en curso: pagado $ ' + fM(D.cur_pagado) + ' M + resto $ ' + fM(desMes(1)) + ' M · ' : '') + 'promedio pagado $ ' + fM(D.prom3) + ' M por mes' + (apr > 0 ? ' · aprobado $ ' + fM(apr) + ' M' : ' · sin desembolso aprobado (se congela con la próxima aprobación)'));
    } else deT = tile('Compras · N2.5', 'Desembolsos proyectados vs reales', 'Sin datos', 'Subí el libro v12 o posterior, con el archivo de desembolsos cargado', 'muted');
    document.getElementById('pn-kc').innerHTML = cumT + proyT + apTile;
    document.getElementById('pn-cch').textContent = 'N2.1 · Presupuesto y cumplimiento por categoría · ' + per + ' ($M)';
    document.getElementById('pn-mt').querySelectorAll('.mt').forEach((el, i) => el.classList.toggle('on', M === i + 1));
  }
  /* lista de compras de urgencia del período */
  let URG = null;
  function renderUrg(M){
    if (!has) return;
    if (M > 0 && A[M-1].cerrado){ document.getElementById('pn-urh').textContent = 'N2.2 · Compras de urgencia · ' + cap(A[M-1].mes);
      document.getElementById('pn-urg').innerHTML = '<tbody><tr><td class="l">Mes cerrado: las urgencias se miden sobre lo que falta comprar (ver los meses abiertos).</td></tr></tbody>';
      document.getElementById('pn-urn').textContent = ''; document.getElementById('pn-urd').hidden = true; return; }
    const byM = M > 0 && hasC('Resp $ 1'), hasU = hasC('Resp u 1'), ks = M === 0 ? [1,2,3,4] : [M];
    const L = SK.map(x => { const r = byM ? vv(x,'Resp $ ',M) : v(x,'Respaldo $'), f = (M === 0 || M === cmU) ? v(x,'Faltante $') : 0;
      const ru = hasU ? ks.reduce((a,k)=>a+(M === 0 ? v(x,'Resp u '+k) : vv(x,'Resp u ',k)),0) : 0, fu = (M === 0 || M === cmU) && hasU ? v(x,'Faltante u') : 0; return {x, r, f, ru, fu}; })
      .filter(o => o.r + o.f >= 1);
    const per = M === 0 ? 'horizonte ' + rango : cap(A[M-1].mes);
    const ud = (M > 0 && noCompra(M)) ? 0 : (byM ? SV('Vig $ ',M) + (M === cmU ? S('Faltante $') : 0) : S('Compra $') + S('Faltante $'));
    const mesV = i => VG[i] ? sm(VG[i].mes) : ('mes ' + (i+1));
    const sobre = o => { const cb = v(o.x,'Costo respaldo'), co = v(o.x,'Costo actual'); return hasU && o.r > 0 && cb > co ? (cb - co) * o.ru : 0; };
    const R = L.filter(o => o.r >= 1), F = L.filter(o => o.f >= 1);
    const sR = R.reduce((a,o)=>a+o.r,0), sF = F.reduce((a,o)=>a+o.f,0), sob = L.reduce((a,o)=>a+sobre(o),0);
    document.getElementById('pn-urh').textContent = 'N2.2 · Compras de urgencia · ' + per;
    const row = (k, lab, n, val) => '<tr tabindex="0" data-u="' + k + '"' + (URG === k ? ' class="sel"' : '') + '><td>' + lab + '</td><td class="num">' + n + '</td><td class="num">' + fM(val) + '</td><td class="num">' + pct(ud > 0 ? val/ud : null, 1) + '</td></tr>';
    document.getElementById('pn-urg').innerHTML = '<thead><tr><th>Motivo</th><th>Insumos</th><th>$M</th><th>% de la compra</th></tr></thead><tbody>' +
      (L.length ? (R.length ? row('r', 'Respaldo por atraso de China', R.length, sR) : '') + (F.length ? row('f', 'Faltante: ninguna compra llega a tiempo', F.length, sF) : '') : '<tr><td colspan="4" class="l">No hay compras de urgencia en este período.</td></tr>') +
      '</tbody><tfoot><tr><td>Total urgencias</td><td class="num">' + L.length + '</td><td class="num">' + fM(sR + sF) + '</td><td class="num">' + pct(ud > 0 ? (sR+sF)/ud : null, 1) + '</td></tr></tfoot>';
    const so = L.filter(o => sobre(o) > 0);
    document.getElementById('pn-urn').textContent = (so.length ? 'Sobrecosto conocido: $ ' + fM(sob) + ' M (' + so.map(o => o.x.sku).join(', ') + '). ' : '') +
      (M > 0 && noCompra(M) ? 'Mes en curso: ninguna compra nueva llega antes de fin de mes, así que el faltante es una alerta para gestionar con el proveedor o Producción (no se calcula %). ' : '') +
      'Un insumo puede estar en los dos motivos. El sobrecosto se calcula solo para los respaldos con precio cargado en Parámetros ("Costo del respaldo").';
    const det = document.getElementById('pn-urd');
    const URGV = (STATE.vivo && STATE.vivo.urgencias) || {};
    const huecoCelda = sku => { const u = URGV[sku]; if (!u) return '<td class="num">–</td>';
      const tip = 'Hasta la ' + u.oc + ' (llega el ' + u.llega + ', en ' + f1s(u.semanas) + ' semanas) hacen falta ' + fU(u.necesidad) + ' u; hay ' + fU(u.stock) + ' u en stock y entran ' + fU(u.entra) + ' u con otras OC antes de esa fecha.' + (u.vencidasU > 0 ? ' No se cuentan ' + fU(u.vencidasU) + ' u de OC vencidas (no se sabe cuándo llegan).' : '') + ' El libro (16/11) pedía ' + fU(u.libroU) + ' u.';
      return '<td class="num" title="' + esc(tip) + '"><span class="pill ' + (u.huecoU <= 0 ? 'p-ok' : 'p-warn') + '">' + (u.huecoU <= 0 ? 'cubierto' : fU(u.huecoU)) + '</span></td>'; };
    const huecoResumen = LL => { const L2 = LL.filter(o => URGV[o.x.sku]); if (!L2.length) return '';
      const hp = L2.reduce((a,o)=>a+URGV[o.x.sku].huecoPesos,0), lp = L2.reduce((a,o)=>a+URGV[o.x.sku].libroPesos,0);
      return '<p class="hint pad"><span class="pill p-ok">en vivo</span> Con el stock y las órdenes de compra de Odoo de hoy, en ' + L2.length + ' de estos ' + LL.length + ' insumos el hueco hasta que llegue su compra grande es de <b>$ ' + fM(hp) + ' M</b>, contra $ ' + fM(lp) + ' M que decía el libro. Es una cuenta simple (consumo semanal del libro por las semanas que faltan, menos stock y OC que entran antes): no reemplaza el cálculo del modelo, sirve para ver si la urgencia ya se cubrió. Pasá el mouse por cada celda para ver de dónde sale.</p>'; };
    function showU(k){
      URG = k; const LL = (k === 'r' ? R : F).slice().sort((a,b)=>(k === 'r' ? b.r - a.r : b.f - a.f));
      const em = o => { if (k === 'f') return 'ya'; const lmb = Math.round(v(o.x,'Meses lead resp')), out = [];
        ks.forEach(j0 => { const j = M === 0 ? j0 : viOf(j0); if (j && v(o.x,'Resp u '+j) > 0){ const e = j - lmb, t_ = e < 1 ? 'ya' : mesV(e - 1); if (out.indexOf(t_) < 0) out.push(t_); } }); return out.join(', ') || '–'; };
      const tip = o => { const x = o.x; if (k === 'r'){ const ro = x.r[C('Origen respaldo')] === 'Brasil' ? 'a Brasil' : 'local', sb = sobre(o);
          return 'China no llega a tiempo: compra de respaldo ' + ro + ' hasta el próximo contenedor' + (sb > 0 ? '. Sobrecosto vs China: $ ' + fK(sb) + ' miles.' : '.'); }
        const lm = Math.round(v(x,'Meses sin llegada'));
        return 'Ninguna compra nueva llega a tiempo (' + x.ori + ', ' + f1s(v(x,'Lead sem')) + ' semanas de lead time): falta para la seguridad hasta ' + (lm >= 1 && lm < 4 && VG[lm] ? VG[lm].mes : 'después del horizonte') + '. Se gestiona con el proveedor o Producción.'; };
      const tot = LL.reduce((a,o)=>a+(k === 'r' ? o.r : o.f),0);
      det.innerHTML = '<div class="hd"><h2>' + (k === 'r' ? 'Respaldo por atraso de China' : 'Faltante: ninguna compra llega a tiempo') + ' · ' + LL.length + ' insumos · $ ' + fM(tot) + ' M</h2><button type="button" class="btn sm" id="pn-urx">Cerrar</button></div>' +
        '<div class="tw"><table><thead><tr><th>Insumo</th><th>$ miles</th><th>Cantidad (u)</th><th title="Con el stock y las OC de Odoo de hoy: lo que sigue faltando hasta que llegue la compra grande">Hueco en vivo (u)</th><th class="l">Emitir</th>' + (k === 'r' ? '<th class="l">Respaldo</th>' : '<th class="l">Origen</th>') + '<th class="l">Quiebre</th></tr></thead><tbody>' +
        LL.map(o => { const qm = v(o.x,'Quiebre mes'), sb = sobre(o); return '<tr><td title="' + esc(tip(o)) + '">' + esc(o.x.sku) + (sb > 0 ? ' <span class="pill p-warn">+$ ' + fM(sb) + ' M sobrecosto</span>' : '') + '</td><td class="num"><b>' + fK(k === 'r' ? o.r : o.f) + '</b></td><td class="num">' + (hasU ? fU(k === 'r' ? o.ru : o.fu) : '–') + '</td>' + huecoCelda(o.x.sku) + '<td class="l">' + (hasU ? em(o) : '–') + '</td>' +
          '<td class="l">' + esc(k === 'r' ? (o.x.r[C('Origen respaldo')] || 'Local') : o.x.ori) + '</td><td class="l">' + (qm > 0 ? '<span class="pill p-warn">' + esc(cap(VG[qm-1] ? VG[qm-1].mes : 'mes ' + qm)) + '</span>' : '') + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td>Total</td><td class="num">' + fK(tot) + '</td><td></td><td></td><td></td><td></td><td></td></tr></tfoot></table></div>' + huecoResumen(LL) +
        '<p class="hint pad">Pasá el mouse por el insumo para ver qué pasa. Emitir = mes en que hay que emitir la orden ("ya" = este mes).</p>';
      det.hidden = false;
      document.getElementById('pn-urx').addEventListener('click', () => { URG = null; det.hidden = true; document.querySelectorAll('#pn-urg tr.sel').forEach(e => e.classList.remove('sel')); });
      document.querySelectorAll('#pn-urg tr[data-u]').forEach(e => e.classList.toggle('sel', e.dataset.u === k));
    }
    document.querySelectorAll('#pn-urg tr[data-u]').forEach(el => { const go = () => showU(el.dataset.u);
      el.addEventListener('click', go); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } }); });
    if (URG && (URG === 'r' ? R : F).length) showU(URG); else { URG = null; det.hidden = true; }
  }
  function renderCompras(M){ renderKC(M); renderCC(M); renderUrg(M); }
  root.querySelectorAll('#pn-seg button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('#pn-seg button').forEach(x => x.setAttribute('aria-pressed', x===b ? 'true' : 'false')); renderCompras(+b.dataset.m); }));
  renderCompras(0);

  /* N2.5: desembolsos */
  if (hasD){
    const MC = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'], cur = D.mes_actual || 1;
    const bars = [];
    for (let m = 1; m < cur && m <= 12; m++) bars.push({lab: MC[m-1], kind:'Pagado', s:[[D['r_neto_'+m]||0,'d1',0],[(D['r_iva_'+m]||0)+(D['r_perc_'+m]||0),'d2',0],[D['r_gi_'+m]||0,'d3',0]],
      det:[D['r_neto_'+m]||0, D['r_iva_'+m]||0, D['r_perc_'+m]||0, D['r_gi_'+m]||0]});
    for (let j = 1; j <= 4; j++){
      const p = [D['p_neto_'+j]||0, D['p_iva_'+j]||0, D['p_perc_'+j]||0, D['p_gi_'+j]||0];
      if (j === 1 && cur <= 12){
        const r = [D['r_neto_'+cur]||0, D['r_iva_'+cur]||0, D['r_perc_'+cur]||0, D['r_gi_'+cur]||0];
        bars.push({lab: MC[cur-1], kind:'Pagado + proyectado', s:[[r[0],'d1',0],[r[1]+r[2],'d2',0],[r[3],'d3',0],[p[0],'d1',1],[p[1]+p[2],'d2',1],[p[3],'d3',1]], det:r.map((x,i)=>x+p[i]), paid:r.reduce((a,b)=>a+b,0)});
      } else bars.push({lab: sm(VG[j-1].mes), kind:'Proyectado', s:[[p[0],'d1',1],[p[1]+p[2],'d2',1],[p[3],'d3',1]], det:p});
    }
    bars.forEach(b => b.tot = b.s.reduce((a,x)=>a+x[0],0));
    const W = 1000, H = 250, top = 22, bot = 26, left = 8, n = bars.length, bw = (W - left*2)/n, mx = Math.max(1, ...bars.map(b=>b.tot));
    const y = v => (H - bot) - v/mx*(H - bot - top);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Desembolsos por mes, pagado y proyectado"><line class="ax" x1="0" x2="' + W + '" y1="' + (H-bot) + '" y2="' + (H-bot) + '"/>';
    bars.forEach((b, i) => { let acc = 0; const x = left + i*bw + bw*0.18, w = bw*0.64;
      svg += '<g data-i="' + i + '" tabindex="0">';
      b.s.forEach(sg => { if (sg[0] <= 0) return; const y1 = y(acc + sg[0]), h0 = y(acc) - y1; svg += '<rect class="' + sg[1] + (sg[2] ? ' pj' : '') + '" x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0, h0 - 2).toFixed(1) + '" rx="2"/>'; acc += sg[0]; });
      svg += '<rect x="' + (left + i*bw).toFixed(1) + '" y="' + top + '" width="' + bw.toFixed(1) + '" height="' + (H-bot-top) + '" fill="transparent"/>';
      svg += '<text class="vl" x="' + (x + w/2).toFixed(1) + '" y="' + (y(b.tot) - 5).toFixed(1) + '" text-anchor="middle">' + Math.round(b.tot/1e6).toLocaleString('es-AR') + '</text>';
      svg += '<text x="' + (x + w/2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(b.lab) + '</text></g>'; });
    svg += '</svg>';
    const dc = document.getElementById('pn-dc'); dc.innerHTML = svg;
    let tip = document.getElementById('pn-tip'); if (!tip){ tip = document.createElement('div'); tip.id = 'pn-tip'; tip.className = 'dtip'; tip.hidden = true; root.appendChild(tip); }
    dc.querySelectorAll('g[data-i]').forEach(gg => { const b = bars[+gg.dataset.i];
      const show = e => { tip.innerHTML = '<b>' + esc(cap(b.lab)) + '</b> · ' + b.kind + '<br>Total $ ' + fM(b.tot) + ' M' + (b.paid !== undefined ? ' (pagado $ ' + fM(b.paid) + ' M)' : '') + '<br>MP neta ' + fM(b.det[0]) + ' · IVA ' + fM(b.det[1]) + ' · Percep. ' + fM(b.det[2]) + ' · Importación ' + fM(b.det[3]);
        tip.hidden = false; const q = gg.getBoundingClientRect(); const px = e && e.clientX ? e.clientX : q.left + q.width/2, py = e && e.clientY ? e.clientY : q.top;
        tip.style.left = Math.max(8, Math.min(window.innerWidth - 270, px + 12)) + 'px'; tip.style.top = (py + 12) + 'px'; };
      gg.addEventListener('mousemove', show); gg.addEventListener('focus', show); gg.addEventListener('mouseleave', () => tip.hidden = true); gg.addEventListener('blur', () => tip.hidden = true); });
    document.getElementById('pn-dt').innerHTML = '<thead><tr><th>Mes</th><th class="l">Tipo</th><th>MP neta</th><th>IVA</th><th>Percepciones</th><th>Gastos de importación</th><th>Total</th></tr></thead><tbody>' +
      bars.map(b => '<tr><td>' + esc(cap(b.lab)) + '</td><td class="l">' + b.kind + '</td>' + b.det.map(x => '<td class="num">' + fM(x) + '</td>').join('') + '<td class="num"><b>' + fM(b.tot) + '</b></td></tr>').join('') + '</tbody>';
    const srcs = [['fa','Facturas abiertas'],['oc','OC emitidas que faltan recibir'],['rs','Recepciones sin facturar'],['pr','Compras del presupuesto'],['gi','Gastos de importación']].filter(([k]) => k !== 'rs' || ('p_rs_1' in D));
    const aprD = [1,2,3,4].map(j => D['aprob_'+j]||0), hasA = aprD.some(x => x > 0);
    document.getElementById('pn-ds').innerHTML = '<thead><tr><th>Proyectado: de dónde sale</th>' + [1,2,3,4].map(j => '<th>' + esc(cap(sm(VG[j-1].mes))) + (j === 1 ? ' (resto)' : '') + '</th>').join('') + '<th>Total</th></tr></thead><tbody>' +
      srcs.map(([k,l]) => { const xs = [1,2,3,4].map(j => D['p_'+k+'_'+j]||0); return '<tr><td>' + l + '</td>' + xs.map(x => '<td class="num">' + fM(x) + '</td>').join('') + '<td class="num">' + fM(xs.reduce((a,b)=>a+b,0)) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total</td>' + [1,2,3,4].map(j => '<td class="num">' + fM(desMes(j)) + '</td>').join('') + '<td class="num">' + fM(desTot) + '</td></tr>' +
      (hasA ? '<tr><td>Desembolso aprobado</td>' + aprD.map(x => '<td class="num">' + fM(x) + '</td>').join('') + '<td class="num">' + fM(aprD.reduce((a,b)=>a+b,0)) + '</td></tr>' : '') + '</tfoot>';
  }

  /* historial de indicadores */
  if (HI.length){
    const p0 = x => x === null || x === undefined ? '–' : pct(x, 1), m0 = x => x === null || x === undefined ? '–' : fM(x);
    document.getElementById('pn-hist').innerHTML = '<thead><tr><th class="l">Versión (exportación)</th><th class="l">Publicada</th><th>Aprobado $M</th><th>Recalculado $M</th><th>Cumplimiento</th><th>Cumpl. proyectado</th><th>Urgencia</th><th>Inventario $M</th><th>Inmovilizado $M</th><th>SKUs en política</th><th>Rotación</th><th>Sin mov.</th></tr></thead><tbody>' +
      HI.slice().reverse().map(x => '<tr><td class="l">' + esc(x.version) + '</td><td class="l">' + esc(x.publicado || '') + '</td><td class="num">' + m0(x.aprobado) + '</td><td class="num">' + m0(x.vigente) + '</td><td class="num">' + p0(x.cumplimiento) + '</td><td class="num">' + p0(x.cumpl_proy) + '</td><td class="num">' + p0(x.urgencia) + '</td><td class="num">' + m0(x.inventario) + '</td><td class="num">' + m0(x.inmovilizado) + '</td><td class="num">' + p0(x.en_politica) + '</td><td class="num">' + f1(x.rotacion) + '</td><td class="num">' + p0(x.sin_mov) + '</td></tr>').join('') + '</tbody>';
  }

  /* tabla de inventario por categoría */
  if (has){
    const gi = new Map();
    for (const x of SK){ if (!gi.has(x.cat)) gi.set(x.cat, {k:x.cat, va:0, vi:0, cp:0, sm:0, stv:0, ca:0});
      const o = gi.get(x.cat); o.va += v(x,'Disponible $'); o.vi += v(x,'Ideal $'); o.cp += v(x,'Inmovilizado $'); o.sm += v(x,'Sin mov $'); o.stv += v(x,'Stock prom $'); o.ca += v(x,'Consumo anual $'); }
    const LI = [...gi.values()].filter(o => o.va > 0 || o.stv > 0).sort((a,b)=>b.va-a.va);
    const ti = LI.reduce((a,o)=>{ for (const k of ['va','vi','cp','sm','stv','ca']) a[k]+=o[k]; return a; }, {va:0, vi:0, cp:0, sm:0, stv:0, ca:0});
    const mx = Math.max(1, ...LI.map(o=>o.va));
    const ri = (o, lab, bar) => '<td>' + lab + '</td><td class="num">' + (bar ? '<span class="meter" aria-hidden="true"><i style="width:' + (o.va/mx*100).toFixed(1) + '%"></i></span>' : '') + fM(o.va) + '</td><td class="num">' + fM(o.vi) + '</td><td class="num">' + fM(o.cp) + '</td><td class="num">' + pct(o.va > 0 ? o.cp/o.va : null) + '</td><td class="num">' + pct(o.va > 0 ? o.sm/o.va : null) + '</td><td class="num">' + f1(o.stv > 0 ? o.ca/o.stv : null) + '</td>';
    document.getElementById('pn-ic').innerHTML = '<thead><tr><th>Categoría</th><th>Valor actual</th><th>Ideal según política</th><th>Inmovilizado</th><th>% inmovilizado</th><th>% sin movimiento</th><th>Rotación real</th></tr></thead><tbody>' +
      LI.map(o => '<tr tabindex="0" data-cat="' + esc(o.k) + '">' + ri(o, esc(o.k), true) + '</tr>').join('') + '</tbody><tfoot><tr>' + ri(ti, 'Total', false) + '</tr></tfoot>';
    wireInv(root);
  }
}

/* ---------- pestaña: presupuesto aprobado ---------- */
function viewAprobado(root){
  let CAT = null;
  const mon = A.map(a => cap(a.mes || '–'));
  const tAp = [1,2,3,4].map(k => SK.reduce((s,x)=>s+v(x,'Aprob $ '+k),0));
  const FUa = Math.abs(STATE.meta.fuera || 0) >= 1 ? STATE.meta.fuera : 0;
  const tVg = [1,2,3,4].map(k => SK.reduce((s,x)=>s+v(x,'Vig $ '+k),0));
  const sum = n => SK.reduce((s,x)=>s+v(x,n),0);
  const quiebres = SK.filter(x => v(x,'Quiebre mes') > 0);
  const vigLab = VG.map(x => cap(x.mes)).join(', ');
  const same = A.every((a,i) => String(a.clave) === String(VG[i].clave));
  root.innerHTML =
    '<section class="read"><p><b>Presupuesto aprobado:</b> la versión congelada que se usa para medir el cumplimiento (' + esc(STATE.meta.aprobado) + '). Compras por mes de llegada, a costo de esa versión.</p>' +
    '<p><b>Situación actual:</b> lo que dice el libro con los últimos datos (corte ' + esc(STATE.meta.corte) + ', exportación del ' + esc(STATE.meta.version) + '): proyección vigente, órdenes a emitir y riesgos.</p></section>' +
    '<section class="kpis">' +
      '<div class="kpi"><div class="eyebrow">Presupuesto aprobado</div><div class="v">$ ' + fM(tAp.reduce((a,b)=>a+b,0) + FUa) + ' M</div><div class="n">' + esc(mon[0]) + ' a ' + esc(mon[3]) + (FUa ? ' · incluye $ ' + fM(FUa) + ' M de SKUs que ya no están en la base' : '') + '</div></div>' +
      tAp.map((x,i) => '<div class="kpi"><div class="eyebrow">' + esc(mon[i]) + '</div><div class="v">$ ' + fM(x) + ' M</div><div class="n">' + (A[i].cerrado ? 'Mes cerrado' : 'Mes abierto') + '</div></div>').join('') +
    '</section>' +
    '<section class="card"><div class="hd"><h2>Presupuesto aprobado por categoría ($M)</h2><span class="hint">Clic en una fila para ver sus SKUs</span></div><div class="tw"><table id="ap-cat"></table></div></section>' +
    '<section class="card"><div class="hd"><h2 id="ap-th">Detalle por SKU</h2><div class="filters"><input id="ap-q" type="search" placeholder="Buscar SKU" aria-label="Buscar SKU">' +
      '<select id="ap-fo" aria-label="Origen"><option value="">Todos los orígenes</option><option>Local</option><option>Brasil</option><option>China</option></select></div></div><div class="tw"><table id="ap-sku"></table></div></section>' +
    '<div class="eyebrow">Situación actual · versión ' + esc(STATE.meta.version) + '</div>' +
    '<section class="kpis">' +
      '<div class="kpi"><div class="eyebrow">Proyección vigente</div><div class="v">$ ' + fM(tVg.reduce((a,b)=>a+b,0)) + ' M</div><div class="n">' + esc(vigLab) + (same ? '' : ' (horizonte distinto del aprobado)') + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Órdenes a emitir ya</div><div class="v">$ ' + fM(sum('Emitir $ 1')) + ' M</div><div class="n">Emisión en ' + esc(cap(VG[0].mes)) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Faltante antes de poder recibir</div><div class="v">$ ' + fM(sum('Faltante $')) + ' M</div><div class="n">Bajo stock de seguridad: ninguna compra llega a tiempo</div></div>' +
      '<div class="kpi"><div class="eyebrow">Insumos con quiebre</div><div class="v">' + quiebres.length + '</div><div class="n">' + (quiebres.slice(0,3).map(x => esc(x.sku)).join(', ') || 'Ninguno') + (quiebres.length > 3 ? '…' : '') + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Entrante vencido</div><div class="v">$ ' + fM(sum('Entrante vencido $')) + ' M</div><div class="n">OC con fecha pasada, contadas en el mes siguiente</div></div>' +
    '</section>';
  const $ = s => document.getElementById('ap-' + s);
  function cat(){
    const g = new Map();
    for (const x of SK){ if (!g.has(x.cat)) g.set(x.cat,{k:x.cat, a:[0,0,0,0], vg:0});
      const o = g.get(x.cat); for (let k=1;k<=4;k++){ o.a[k-1]+=v(x,'Aprob $ '+k); o.vg+=v(x,'Vig $ '+k); } }
    const L = [...g.values()].map(o => (o.t = o.a.reduce((a,b)=>a+b,0), o)).filter(o => o.t > 0 || o.vg > 0).sort((a,b)=>b.t-a.t);
    let h = '<thead><tr><th>Categoría</th>' + mon.map(m => '<th>' + esc(m) + '</th>').join('') + '<th>Total aprobado</th><th>Proyección vigente</th></tr></thead><tbody>';
    for (const o of L) h += '<tr tabindex="0" data-cat="' + esc(o.k) + '"' + (o.k===CAT?' class="sel"':'') + '><td>' + esc(o.k) + '</td>' + o.a.map(x => '<td class="num">' + fM(x) + '</td>').join('') + '<td class="num"><b>' + fM(o.t) + '</b></td><td class="num">' + fM(o.vg) + '</td></tr>';
    h += '</tbody><tfoot><tr><td>Total</td>' + tAp.map(x => '<td class="num">' + fM(x) + '</td>').join('') + '<td class="num">' + fM(tAp.reduce((a,b)=>a+b,0)) + '</td><td class="num">' + fM(tVg.reduce((a,b)=>a+b,0)) + '</td></tr></tfoot>';
    $('cat').innerHTML = h;
    $('cat').querySelectorAll('tbody tr').forEach(tr => { const go = () => { CAT = tr.dataset.cat; cat(); sku(); };
      tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); });
  }
  function sku(){
    const q = $('q').value.trim().toUpperCase(), fo = $('fo').value;
    const L = SK.filter(x => (!CAT || x.cat === CAT) && (!fo || x.ori === fo) && (!q || x.sku.toUpperCase().includes(q)))
      .map(x => ({x, t:[1,2,3,4].reduce((s,k)=>s+v(x,'Aprob $ '+k),0), vg:[1,2,3,4].reduce((s,k)=>s+v(x,'Vig $ '+k),0)}))
      .filter(o => o.t > 0 || o.vg > 0).sort((a,b)=>b.t-a.t);
    $('th').textContent = 'Detalle por SKU · ' + (CAT || 'todas las categorías') + ' (' + L.length + ')';
    let h = '<thead><tr><th>SKU</th><th>ABC</th><th>Origen</th><th>Costo $</th>' + mon.map(m => '<th>' + esc(m) + ' u</th>').join('') + '<th>Total $ miles</th><th>Vigente $ miles</th><th>Quiebre</th></tr></thead><tbody>';
    if (!L.length) h += '<tr><td colspan="11" class="l">No hay SKUs para este filtro.</td></tr>';
    for (const o of L){ const x = o.x, qm = v(x,'Quiebre mes');
      h += '<tr><td>' + esc(x.sku) + '</td><td class="l">' + esc(x.abc) + '</td><td class="l">' + esc(x.ori) + '</td><td class="num">' + Math.round(x.cp).toLocaleString('es-AR') + '</td>' +
        [1,2,3,4].map(k => '<td class="num">' + fU(v(x,'Aprob u '+k)) + '</td>').join('') + '<td class="num">' + fK(o.t) + '</td><td class="num">' + fK(o.vg) + '</td><td>' +
        (qm > 0 ? '<span class="pill p-warn">' + esc(cap(VG[qm-1] ? VG[qm-1].mes : 'mes ' + qm)) + '</span>' : '') + '</td></tr>'; }
    $('sku').innerHTML = h + '</tbody>';
  }
  ['q','fo'].forEach(s => $(s).addEventListener('input', sku));
  const top = SK.slice().sort((a,b)=>[1,2,3,4].reduce((s,k)=>s+v(b,'Aprob $ '+k)-v(a,'Aprob $ '+k),0))[0]; CAT = top ? top.cat : null;
  cat(); sku();
}

/* ---------- pestaña: cumplimiento ---------- */
function viewCumplimiento(root){
  if (!CERR.length){
    const first = A[0] ? cap(A[0].mes) : 'el primer mes';
    root.innerHTML = '<section class="empty"><b>Todavía no cerró ningún mes con presupuesto aprobado.</b><p>' + esc(first) + ' se mide cuando el libro tenga el stock de fin de ese mes y el corte pase a ese mes.</p></section>';
    return;
  }
  makeView(root, 'cu', CROWS, CERR.map(c => ({v:c.clave, label:cap(c.mes)})), {allLabel:'Acumulado', mLabel:'Aprobado + entrante', mShort:'Aprobado', mNote:'Compra aprobada + entrante comprometido al aprobar', costNote:'a costo presupuestado', noFa:true, motivo:true,
    read:'<p><b>Meses cerrados con presupuesto aprobado</b>, cada uno contra la versión vigente en ese mes (' + CERR.map(c => esc(cap(c.mes)) + ': ' + esc(verCorta(c.version))).join(' · ') + '). <b>Aprobado:</b> compra aprobada más el entrante comprometido al aprobar (OC ya emitidas que debían llegar ese mes), así se comparan llegadas contra llegadas. <b>Compra real:</b> lo que llegó físicamente en el mes (stock al cierre − stock al inicio + consumo), a costo presupuestado. El detalle queda congelado al cerrar el mes: aprobar una versión nueva no lo borra.</p>',
    notes:['Motivo: lectura automática del desvío de cada SKU (llegada adelantada o atrasada, contenedor de China corrido de mes, consumo mayor al previsto). Los reemplazos de código (por ejemplo nylon 2200 → 2580) aparecen como un SKU que llegó sin presupuesto y otro que no llegó.',
           'Lo que viene de China se compra por contenedor: un corrimiento de fecha mueve el desvío de un mes al otro. Por eso conviene mirar también el acumulado.',
           'Las llegadas negativas (ajustes de inventario mayores que las compras del mes) se toman como cero.']});
}

/* ---------- pestaña: julio a septiembre ---------- */
function viewRetro(root){
  makeView(root, 're', RETRO, [{v:7,label:'Julio'},{v:8,label:'Agosto'},{v:9,label:'Septiembre'}], {allLabel:'3 meses', motivo:true, mLabel:'Presupuesto (modelo)', mShort:'Presupuesto', mNote:'Lo que el modelo indicaba que llegara', costNote:'a costo actual',
    read:'<p><b>Prueba retrospectiva.</b> En estos meses no había presupuesto aprobado. El presupuesto es lo que el modelo habría indicado al cierre de cada mes anterior, con el stock real a esa fecha, el plan vigente y la política de inventario. <b>Compra real:</b> llegadas físicas del mes. Todo a costo actual.</p>',
    notes:['En julio y agosto el pronóstico de consumo del modelo quedó alrededor de 20% por encima del consumo real, porque la producción real fue menor al plan. En septiembre acertó (−0,9%).',
           'Lo que viene de China se compra por contenedor: el modelo hace llegar cuatro meses de consumo juntos, lo que exagera el desvío mes a mes en telas de colchón y algunos insumos de mercería.',
           'El modelo repone hasta la política de inventario de cada SKU y no compra lo que ya está en exceso.',
           'Las llegadas negativas (ajustes de inventario) se toman como cero.']});
}

/* ---------- armado ---------- */
root.innerHTML =
  '<div class="wrap">' +
  '<header class="top"><div><div class="eyebrow">Frontera Living · Materias primas</div>' +
  '<p class="sub">Rendición de cuentas ante la Gerencia, presupuesto aprobado y su cumplimiento. <span class="vtag">' + (STATE.vivo ? 'Inventario en vivo de Odoo · el resto, ' : '') + 'datos del libro: exportación ' + esc(STATE.meta.version) + (STATE.meta.actualizado ? ' · publicado ' + esc(STATE.meta.actualizado) : '') + '</span></p></div>' +
  '<div class="filters"><button type="button" class="btn" id="eqv-open"' + (opts.puedeEditar && STATE.vivo && STATE.vivo.equivalencias ? '' : ' hidden') + '>Equivalencias' + (STATE.vivo && STATE.vivo.equivalencias ? ' (' + STATE.vivo.equivalencias.pendientes.length + ' pendientes)' : '') + '</button>' +
  '<button type="button" class="btn" id="sync-btn" title="Vuelve a leer el stock y el costo directo de Odoo, sin esperar la actualización automática">Forzar sincronización</button></div></header>' +
  '<section class="upd" id="eqv" hidden aria-label="Equivalencias de SKU"></section>' +
  '<p class="vtag" id="sync-msg" role="status">' + (STATE.vivo ? 'Última lectura de Odoo: ' + new Date(STATE.vivo.generado).toLocaleTimeString('es-AR', {timeZone:'America/Argentina/Buenos_Aires', hour:'2-digit', minute:'2-digit', second:'2-digit'}) + ' · se refresca sola cada 10 min' : 'No se pudo leer Odoo: se muestra la foto del libro') + '</p>' +
  '<div class="tabs" role="tablist">' +
    '<button type="button" role="tab" id="tab-panel" aria-selected="true" aria-controls="p-panel">Rendición de cuentas</button>' +
    '<button type="button" role="tab" id="tab-aprobado" aria-selected="false" aria-controls="p-aprobado">Presupuesto aprobado</button>' +
    '<button type="button" role="tab" id="tab-cumplimiento" aria-selected="false" aria-controls="p-cumplimiento">Meses cerrados</button>' +
    '<button type="button" role="tab" id="tab-retro" aria-selected="false" aria-controls="p-retro">Julio a septiembre</button></div>' +
  '<div role="tabpanel" id="p-panel" aria-labelledby="tab-panel" style="display:grid;gap:22px"></div>' +
  '<div role="tabpanel" id="p-aprobado" aria-labelledby="tab-aprobado" style="display:grid;gap:22px" hidden></div>' +
  '<div role="tabpanel" id="p-cumplimiento" aria-labelledby="tab-cumplimiento" style="display:grid;gap:22px" hidden></div>' +
  '<div role="tabpanel" id="p-retro" aria-labelledby="tab-retro" style="display:grid;gap:22px" hidden></div>' +
  '</div>';
viewPanel(document.getElementById('p-panel'));
viewAprobado(document.getElementById('p-aprobado'));
viewCumplimiento(document.getElementById('p-cumplimiento'));
viewRetro(document.getElementById('p-retro'));
const TABS = ['panel','aprobado','cumplimiento','retro'];
function showTab(t){
  TABS.forEach(x => { document.getElementById('tab-' + x).setAttribute('aria-selected', x===t ? 'true' : 'false'); document.getElementById('p-' + x).hidden = x !== t; });
  try { sessionStorage.setItem('pmp-tab', t); } catch(e) {}
}
TABS.forEach(t => document.getElementById('tab-' + t).addEventListener('click', () => showTab(t)));
let t0 = (location.hash || '').slice(1); if (TABS.indexOf(t0) < 0) { try { t0 = sessionStorage.getItem('pmp-tab') || 'panel'; } catch(e) { t0 = 'panel'; } }
showTab(TABS.indexOf(t0) >= 0 ? t0 : 'panel');


/* ---------- forzar sincronización con Odoo ---------- */
{
  const btn = document.getElementById('sync-btn'), msg = document.getElementById('sync-msg');
  if (!opts.sincronizar) btn.hidden = true;
  else btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Sincronizando…';
    try { await opts.sincronizar(); }
    catch (e) { btn.disabled = false; btn.textContent = 'Forzar sincronización'; msg.textContent = 'No se pudo sincronizar con Odoo. Probá de nuevo en un momento.'; msg.classList.add('msg-err'); }
  });
}

/* ---------- equivalencias SKU del libro -> producto de Odoo (solo editores) ---------- */
if (opts.puedeEditar && STATE.vivo && STATE.vivo.equivalencias){
  const EQ = STATE.vivo.equivalencias, box = document.getElementById('eqv');
  let cambios = false;
  const guardar = async (sku, productId) => {
    const r = await fetch('/api/presupuesto-mp-equivalencias', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({sku, productId})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'No se pudo guardar');
    cambios = true;
  };
  let vista = 'pend';
  function dibujar(msg){ return vista === 'todos' ? dibujarTodos(msg) : dibujarPend(msg); }
  const tabsEq = () => '<div class="filters" role="group" aria-label="Vista"><button type="button" class="btn sm" data-vista="pend" aria-pressed="' + (vista === 'pend') + '">Pendientes (' + EQ.pendientes.length + ')</button><button type="button" class="btn sm" data-vista="todos" aria-pressed="' + (vista === 'todos') + '">Revisar todos los cruces (' + EQ.cruces.length + ', ' + EQ.cruces.filter(c => c.dudoso).length + ' con costo distinto)</button></div>';
  const cablearTabs = () => box.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => { vista = b.dataset.vista; dibujar(); }));
  function dibujarPend(msg){
    const pend = EQ.pendientes, conf = EQ.confirmadas;
    const op = c => '<option value="' + c.productId + '">' + esc(c.nombre) + ' · stock ' + fU(c.disponible) + ' · $ ' + Math.round(c.costo).toLocaleString('es-AR') + '</option>';
    box.innerHTML = '<p><b>Equivalencias de SKU</b></p>' + tabsEq() +
      '<div class="expl"><p>Estos SKU del libro <b>no se encuentran en Odoo con el mismo nombre</b> (por ejemplo, porque el producto se renombró o se reemplazó por otro código). Mientras no se confirmen, se muestran con el stock del libro y no en vivo.</p>' +
      '<p>Para cada uno, elegí de la lista el producto de Odoo que corresponde y tocá <b>Confirmar</b>. Si ya no existe en Odoo, elegí <b>"Ya no existe / sin equivalente"</b>. Se muestran primero los de más consumo anual. Lo confirmado queda guardado y se aplica enseguida a todos.</p>' +
      '<p class="hint">Los candidatos se sugieren por parecido de nombre y pueden estar equivocados: fijate el stock y el costo antes de confirmar. Un SKU del libro que junta varios productos de Odoo (por ejemplo, un tipo de poliol) todavía no se puede cargar acá.</p></div>' +
      (EQ.disponible ? '' : '<p class="msg-err" role="status">Falta crear la tabla de equivalencias en Supabase (docs/presupuesto-mp-equivalencias.sql): por ahora no se puede guardar.</p>') +
      (msg ? '<p class="' + (msg.err ? 'msg-err' : '') + '" role="status">' + esc(msg.t) + '</p>' : '') +
      '<div class="tw"><table><thead><tr><th class="l">SKU del libro</th><th class="l">Categoría</th><th>Consumo anual $M</th><th class="l">Producto de Odoo</th><th></th></tr></thead><tbody>' +
      (pend.length ? pend.map((p, i) => '<tr><td class="l" style="white-space:normal;min-width:220px">' + esc(p.sku) + '</td><td class="l">' + esc(p.categoria) + '</td><td class="num">' + fM(p.consumoAnual) + '</td><td class="l"><select data-i="' + i + '" aria-label="Producto de Odoo para ' + esc(p.sku) + '"><option value="">Elegir…</option>' + p.candidatos.map(op).join('') + '<option value="0">Ya no existe / sin equivalente</option></select></td><td><button type="button" class="btn sm" data-ok="' + i + '">Confirmar</button></td></tr>').join('') : '<tr><td colspan="5" class="l">No quedan SKU pendientes.</td></tr>') +
      '</tbody></table></div>' +
      (conf.length ? '<details><summary class="hint">Ya confirmados (' + conf.length + ')</summary><div class="tw"><table><tbody>' + conf.map((c, i) => '<tr><td class="l">' + esc(c.sku) + '</td><td class="l">' + (c.productId === 0 ? 'Ya no existe en Odoo' : esc(c.nombre || ('producto ' + c.productId))) + '</td><td><button type="button" class="btn sm" data-undo="' + i + '">Deshacer</button></td></tr>').join('') + '</tbody></table></div></details>' : '') +
      '<div class="filters"><button type="button" class="btn primary" id="eqv-fin">' + (cambios ? 'Cerrar y actualizar el tablero' : 'Cerrar') + '</button></div>';
    box.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', async () => {
      const i = +b.dataset.ok, sel = box.querySelector('select[data-i="' + i + '"]'), v = sel.value, p = pend[i];
      if (v === '') return dibujar({t:'Elegí un producto para ' + p.sku + ' (o "Ya no existe").', err:true});
      b.disabled = true; b.textContent = 'Guardando…';
      try { await guardar(p.sku, +v); const c = p.candidatos.find(x => x.productId === +v);
        EQ.pendientes = pend.filter((_, k) => k !== i); EQ.confirmadas = conf.concat([{sku:p.sku, productId:+v, nombre: c ? c.nombre : null}]); dibujar({t:'Guardado: ' + p.sku}); }
      catch (e) { dibujar({t: e.message || 'No se pudo guardar', err:true}); }
    }));
    box.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => {
      const c = conf[+b.dataset.undo]; b.disabled = true;
      try { await guardar(c.sku, null); EQ.confirmadas = conf.filter(x => x !== c); location.reload(); }
      catch (e) { dibujar({t: e.message || 'No se pudo deshacer', err:true}); }
    }));
    document.getElementById('eqv-fin').addEventListener('click', () => { if (cambios) location.reload(); else box.hidden = true; });
    cablearTabs();
  }

  /* Revisar todos los cruces: cada SKU del libro con el producto de Odoo con el que cruzó (por nombre o por equivalencia), para corregir los que estén mal */
  const fold = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/^\[[^\]]*\]\s*/, '').replace(/[^A-Z0-9]+/g, ' ').trim();
  const tok = t => new Set(fold(t).split(' ').filter(Boolean));
  const parecido = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
  const VIA = {nombre:'por nombre', equivalencia:'por equivalencia', 'ya no existe':'ya no existe', 'sin cruce':'sin cruce'};
  let filtroEq = '', dudososEq = false, editando = null;
  function dibujarTodos(msg){
    box.innerHTML = '<p><b>Equivalencias de SKU</b></p>' + tabsEq() +
      '<div class="expl"><p>Acá ves <b>con qué producto de Odoo se cruzó cada SKU del libro</b>, tanto los que cruzaron solos por nombre como los que confirmaste. Si alguno está mal, tocá <b>Cambiar</b>, buscá el producto correcto y confirmá: eso pisa el cruce automático y se aplica enseguida a todos.</p>' +
      '<p class="hint"><b>Costo distinto</b> marca los SKU cuyo costo en Odoo difiere más de 10 % del que tenía el libro: es la pista más común de un cruce equivocado. "Volver al automático" borra tu equivalencia y vuelve a cruzar por nombre.</p></div>' +
      (EQ.disponible ? '' : '<p class="msg-err" role="status">Falta crear la tabla de equivalencias en Supabase (docs/presupuesto-mp-equivalencias.sql): por ahora no se puede guardar.</p>') +
      (msg ? '<p class="' + (msg.err ? 'msg-err' : '') + '" role="status">' + esc(msg.t) + '</p>' : '') +
      '<div class="filters"><input type="search" id="eqv-q" placeholder="Buscar SKU o producto de Odoo" aria-label="Buscar" value="' + esc(filtroEq) + '"><label><input type="checkbox" id="eqv-dud"' + (dudososChecked() ? ' checked' : '') + '> Solo con costo distinto</label></div>' +
      '<div id="eqv-tabla"></div>' +
      '<div class="filters"><button type="button" class="btn primary" id="eqv-fin">' + (cambios ? 'Cerrar y actualizar el tablero' : 'Cerrar') + '</button></div>';
    cablearTabs();
    document.getElementById('eqv-q').addEventListener('input', e => { filtroEq = e.target.value; pintarTabla(); });
    document.getElementById('eqv-dud').addEventListener('change', e => { setDudosos(e.target.checked); pintarTabla(); });
    document.getElementById('eqv-fin').addEventListener('click', () => { if (cambios) location.reload(); else box.hidden = true; });
    pintarTabla();
  }
  function dudososChecked(){ return dudososEq; }
  function setDudosos(v){ dudososEq = v; }
  function opcionesProducto(sku, texto, actual){
    const q = tok(texto || sku), cat = (EQ.cruces.find(c => c.sku === sku) || {}).categoria || '';
    return EQ.productos.map(p => ({p, s: parecido(q, tok(p.nombre)) + (fold(p.categoria).endsWith(fold(cat)) && cat ? 0.05 : 0)})).filter(x => x.s > 0 || x.p.productId === actual).sort((a, b) => b.s - a.s).slice(0, 25).map(x => x.p);
  }
  function pintarTabla(){
    const cont = document.getElementById('eqv-tabla'), q = fold(filtroEq);
    let L = EQ.cruces.filter(c => (!dudososEq || c.dudoso) && (!q || fold(c.sku).includes(q) || fold(c.nombre || '').includes(q)));
    L = L.slice().sort((a, b) => (b.dudoso - a.dudoso) || (a.via === 'sin cruce') - (b.via === 'sin cruce') || a.sku.localeCompare(b.sku, 'es'));
    const total = L.length; L = L.slice(0, 60);
    const money = n => n == null ? '–' : '$ ' + Math.round(n).toLocaleString('es-AR');
    const filas = L.map(c => {
      let h = '<tr><td class="l" style="white-space:normal;min-width:200px">' + esc(c.sku) + '</td><td class="l" style="white-space:normal;min-width:220px"><span class="pill ' + (c.via === 'nombre' ? 'p-ok' : (c.via === 'equivalencia' ? 'p-over' : 'p-none')) + '">' + VIA[c.via] + '</span> ' + (c.nombre ? esc(c.nombre) : '') + '</td>' +
        '<td class="num' + (c.dudoso ? ' neg' : '') + '">' + money(c.costoLibro) + ' → ' + money(c.costoOdoo) + (c.dudoso ? ' <span class="pill p-warn">costo distinto</span>' : '') + '</td>' +
        '<td class="num">' + fU(c.dispLibro) + ' → ' + (c.dispOdoo == null ? '–' : fU(c.dispOdoo)) + '</td><td><button type="button" class="btn sm" data-ed="' + esc(c.sku) + '">Cambiar</button></td></tr>';
      if (editando === c.sku){
        h += '<tr><td colspan="5" class="l" style="white-space:normal"><div class="filters"><input type="search" id="eqv-b" placeholder="Buscar producto de Odoo…" aria-label="Buscar producto de Odoo" style="width:260px"><select id="eqv-sel" aria-label="Producto de Odoo"></select>' +
          '<button type="button" class="btn sm primary" id="eqv-ok">Confirmar</button><button type="button" class="btn sm" id="eqv-no">Ya no existe</button>' +
          (c.via === 'equivalencia' || c.via === 'ya no existe' ? '<button type="button" class="btn sm" id="eqv-auto">Volver al automático</button>' : '') +
          '<button type="button" class="btn sm" id="eqv-cancel">Cancelar</button></div></td></tr>';
      }
      return h;
    }).join('');
    cont.innerHTML = '<div class="tw"><table><thead><tr><th class="l">SKU del libro</th><th class="l">Cruzado con (Odoo)</th><th>Costo libro → Odoo</th><th>Stock libro → Odoo</th><th></th></tr></thead><tbody>' +
      (filas || '<tr><td colspan="5" class="l">No hay SKU con ese filtro.</td></tr>') + '</tbody></table></div>' + (total > 60 ? '<p class="hint">Mostrando 60 de ' + total + ': afiná la búsqueda para ver el resto.</p>' : '');
    cont.querySelectorAll('[data-ed]').forEach(b => b.addEventListener('click', () => { editando = b.dataset.ed; pintarTabla(); }));
    if (editando){
      const c = EQ.cruces.find(x => x.sku === editando), sel = document.getElementById('eqv-sel'), inp = document.getElementById('eqv-b');
      if (!sel){ editando = null; return; }
      const llenar = () => { const ops = opcionesProducto(editando, inp.value, c.productId); sel.innerHTML = '<option value="">Elegir…</option>' + ops.map(p => '<option value="' + p.productId + '"' + (p.productId === c.productId ? ' selected' : '') + '>' + esc(p.nombre) + ' · stock ' + fU(p.disponible) + ' · $ ' + Math.round(p.costo).toLocaleString('es-AR') + '</option>').join(''); };
      llenar(); inp.addEventListener('input', llenar);
      const hecho = async (id, t) => { try { await guardar(c.sku, id);
          if (id === null){ location.reload(); return; }
          const p = EQ.productos.find(x => x.productId === id);
          c.via = id === 0 ? 'ya no existe' : 'equivalencia'; c.productId = id || null; c.nombre = p ? p.nombre : null; c.dispOdoo = p ? Math.max(0, p.disponible) : null; c.costoOdoo = p ? p.costo : null;
          c.dudoso = !!p && c.costoLibro > 0 && Math.abs(p.costo - c.costoLibro) / c.costoLibro > 0.1; editando = null; dibujarTodos({t: t + ': ' + c.sku}); }
        catch (e) { dibujarTodos({t: e.message || 'No se pudo guardar', err:true}); } };
      document.getElementById('eqv-ok').addEventListener('click', () => { if (!sel.value) return dibujarTodos({t:'Elegí un producto de la lista.', err:true}); hecho(+sel.value, 'Guardado'); });
      document.getElementById('eqv-no').addEventListener('click', () => hecho(0, 'Marcado como "ya no existe"'));
      const au = document.getElementById('eqv-auto'); if (au) au.addEventListener('click', () => hecho(null, ''));
      document.getElementById('eqv-cancel').addEventListener('click', () => { editando = null; pintarTabla(); });
    }
  }
  document.getElementById('eqv-open').addEventListener('click', () => { box.hidden = false; dibujar(); box.scrollIntoView({block:'nearest'}); });
}
}
