// @ts-nocheck
// Lectura de la hoja oculta "Para Finanzas" del libro Presupuesto_Compras_MP y armado del estado del tablero
// (congela los meses cerrados y suma la foto de indicadores al historial). Corre en el navegador de quien sube el libro.
/* Lee la hoja oculta "Para Finanzas" del libro (array de filas) y arma el estado del tablero. */
export function parseParaFinanzas(aoa){
  const meta = {}; let h = -1;
  for (let i = 0; i < aoa.length; i++){
    const a = aoa[i] || [];
    if (a[0] === 'SKU'){ h = i; break; }
    if (typeof a[0] === 'string' && a[0].trim() && i > 0) meta[a[0].trim()] = a[1] === undefined ? null : a[1];
  }
  if (h < 0) throw {code:'formato', message:'No encontré la tabla de SKUs en la hoja "Para Finanzas".'};
  const cols = aoa[h].map(x => String(x == null ? '' : x).trim());
  const need = ['SKU','Categoría','Origen','ABC','Costo presup','Aprob $ 1','Real u 1','Vig $ 1'];
  for (const n of need) if (cols.indexOf(n) < 0) throw {code:'formato', message:'Falta la columna "' + n + '" en la hoja "Para Finanzas".'};
  const TXT = ['Reemplazado por', 'Método', 'Estado', 'Origen respaldo'];
  const rows = [];
  let numeric = 0;
  for (let i = h + 1; i < aoa.length; i++){
    const a = aoa[i] || [];
    const sku = a[0] == null ? '' : String(a[0]).trim();
    if (!sku) continue;
    const r = cols.map((c, j) => {
      const v = a[j];
      if (j < 5 || TXT.indexOf(c) >= 0) return v == null ? '' : String(v);
      const n = typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v));
      if (typeof v === 'number') numeric++;
      return isFinite(n) ? Math.round(n * 100) / 100 : 0;
    });
    rows.push(r);
  }
  if (!rows.length) throw {code:'vacio', message:'La hoja "Para Finanzas" no tiene SKUs con valores.'};
  if (!numeric) throw {code:'sin_valores', message:'El libro no tiene valores calculados. Abrilo en Excel o Google Sheets, dejá que calcule, guardalo y volvé a subirlo.'};
  const des = {}; for (const k in meta) if (k.indexOf('des_') === 0) des[k.slice(4)] = Number(meta[k]) || 0;
  const aprob = [1,2,3,4].map(i => ({clave: meta['aprob_clave_' + i] || '', mes: meta['aprob_mes_' + i] || '', cerrado: Number(meta['aprob_cerrado_' + i] || 0) === 1}));
  const vig = [1,2,3,4].map(i => ({clave: meta['vig_clave_' + i] || '', mes: meta['vig_mes_' + i] || ''}));
  return {meta: {version: String(meta.version || ''), aprobado: String(meta.aprobado || ''), corte: String(meta.corte || ''),
                 stock: String(meta.stock_ultimo_cierre || ''), fuera: Number(meta.aprob_fuera_base || 0) || 0, des, aprob, vig}, cols, rows};
}
/* Foto de los indicadores de una versión (para el historial). */
export function kpiSnap(st){
  const ci = n => st.cols.indexOf(n), has = n => ci(n) >= 0;
  const S = n => has(n) ? st.rows.reduce((a,r)=>a+(Number(r[ci(n)])||0),0) : null;
  const m = st.meta || {}, D = m.des || {}, A = m.aprob || [];
  const sumK = p => [1,2,3,4].reduce((a,k)=>a+(S(p+k)||0),0);
  const closed = A.map((a,i)=>({a,k:i+1})).filter(o=>o.a.cerrado);
  const apC = closed.reduce((s,o)=>s+(S('Aprob $ '+o.k)||0)+(S('Entr aprob $ '+o.k)||0),0), rlC = closed.reduce((s,o)=>s+(S('Real $ '+o.k)||0),0);
  const des = ('p_pr_1' in D) ? [1,2,3,4].reduce((a,j)=>a+['fa','oc','rs','pr','gi'].reduce((b,k)=>b+(D['p_'+k+'_'+j]||0),0),0) : null;
  const ce = ci('Estado'), cabc = ci('ABC');
  let n = 0, ok = 0;
  if (ce >= 0) for (const r of st.rows){ if (['A','B','C'].indexOf(r[cabc]) < 0) continue;
    const e = r[ce]; if (['Debajo del stock de seguridad','Debajo del objetivo','En rango','Exceso'].indexOf(e) < 0) continue; n++; if (e === 'Debajo del objetivo' || e === 'En rango') ok++; }
  const inv = S('Disponible $'), stv = S('Stock prom $');
  const apm = S('Aprob mes curso $'), rpr = S('Proy cierre mes $');
  return {version: String(m.version || ''), publicado: String(m.actualizado || ''),
    aprobado: sumK('Aprob $ ') + (Number(m.fuera) || 0), vigente: sumK('Vig $ '),
    cumplimiento: apC > 0 ? rlC/apC : ((st.cerrados || []).length ? (c => { const t = c.rows.reduce((a,r)=>(a[0]+=r[8], a[1]+=r[9], a), [0,0]); return t[0] > 0 ? t[1]/t[0] : null; })(st.cerrados[st.cerrados.length - 1]) : null), cumpl_proy: apm ? rpr/apm : null,
    urgencia: (S('Compra $')||0) + (S('Faltante $')||0) > 0 ? ((S('Respaldo $')||0) + (S('Faltante $')||0)) / ((S('Compra $')||0) + (S('Faltante $')||0)) : null,
    desembolso: des, inventario: inv, inmovilizado: S('Inmovilizado $'), en_politica: n ? ok/n : null,
    rotacion: stv ? (S('Consumo anual $')||0)/stv : null, sin_mov: inv ? (S('Sin mov $')||0)/inv : null,
    inm: has('Inmovilizado $') ? st.rows.reduce((o,r)=>{ const x = Number(r[ci('Inmovilizado $')])||0; if (x > 0) o[r[0]] = Math.round(x); return o; }, {}) : undefined};
}
/* Congela el detalle por SKU de los meses cerrados de la versión vigente, para que no se pierda al aprobar una versión nueva.
   Cada mes: {clave, mes, version, medido, rows:[[sku, cat, abc, ori, costo, consumo u, aprobado u, real u, aprobado+entrante $, real $]]} */
export function freezeClosed(st, prev){
  const out = (prev || []).slice(), ci = n => st.cols.indexOf(n), A = (st.meta && st.meta.aprob) || [];
  const g = (r, n) => { const i = ci(n); return i >= 0 ? (Number(r[i]) || 0) : 0; };
  A.forEach((a, i) => { if (!a.cerrado || !a.clave) return; const k = i + 1, rows = [];
    for (const r of st.rows){
      const mv = g(r,'Aprob $ ' + k) + g(r,'Entr aprob $ ' + k), rv = g(r,'Real $ ' + k), cu = g(r,'Consumo u ' + k);
      if (!(mv || rv || cu)) continue;
      rows.push([r[ci('SKU')], r[ci('Categoría')], r[ci('ABC')], r[ci('Origen')], g(r,'Costo presup'), cu, g(r,'Aprob u ' + k), g(r,'Real u ' + k), Math.round(mv), Math.round(rv)]);
    }
    const j = out.findIndex(x => Number(x.clave) === Number(a.clave)), o = {clave:Number(a.clave), mes:a.mes, version:st.meta.aprobado, medido:st.meta.version, rows};
    if (j >= 0) out[j] = o; else out.push(o); });
  return out.sort((x, y) => x.clave - y.clave);
}
export function mergeHist(prev, snap){
  const h = (prev || []).filter(x => x.version !== snap.version); h.push(snap);
  return h.sort((a,b)=> a.version < b.version ? -1 : (a.version > b.version ? 1 : 0));
}
