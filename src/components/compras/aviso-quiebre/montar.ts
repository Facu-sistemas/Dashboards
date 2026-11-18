// @ts-nocheck
// Port del artifact "Aviso de quiebre de insumos" (docs/Aviso de quiebre de insumos.html). Render vanilla sobre `root` con lo
// que entrega /api/aviso-quiebre: foto semanal (nivel y fecha de quiebre, del plan de producción) + capa en vivo de Odoo
// (stock de hoy y órdenes de compra pendientes). Los "vistos" van a Supabase vía /api/aviso-quiebre-vistos. No escribe en Odoo.
export function montarAvisoQuiebre(root, ESTADO, opts = {}){
  const V = ESTADO.version, AL = ESTADO.alertas;
  const VIVO = opts.vivo && opts.vivo.porSku ? opts.vivo.porSku : null;
  const RES = opts.vivo && opts.vivo.resumen ? opts.vivo.resumen : null;
  const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const pd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
  const fd = s => { if (!s) return '–'; const d = pd(s); return d.getDate() + ' ' + MES[d.getMonth()]; };
  const days = s => Math.round((pd(s) - pd(V)) / 864e5);
  const nf = (x, dec) => (x == null ? '–' : Number(x).toLocaleString('es-AR', {maximumFractionDigits: dec == null ? (Math.abs(x) < 10 ? 1 : 0) : dec}));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const hoyD = new Date(); const HOY = hoyD.getFullYear() + '-' + String(hoyD.getMonth()+1).padStart(2,'0') + '-' + String(hoyD.getDate()).padStart(2,'0');
  const EDAD = Math.max(0, Math.round((pd(HOY) - pd(V)) / 864e5));
  const HORA = opts.vivo && opts.vivo.leidoEn ? new Date(opts.vivo.leidoEn).toLocaleTimeString('es-AR', {timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit'}) : '';
  const vivoDe = a => (VIVO ? VIVO[a.sku] || null : null);
  const fU = x => Number(x).toLocaleString('es-AR', {maximumFractionDigits: 0});
  const NVIVO = VIVO ? AL.filter(a => vivoDe(a)).length : 0;
  const NEQ = RES ? RES.pendientes : 0;
  const LBL = {rojo: 'Va a faltar', naranja: 'Falta si se atrasa una entrega', amarillo: 'Compra a tiempo'};
  const cats = [...new Set(AL.map(a => a.cat))].sort();
  const lins = [...new Set(AL.map(a => a.lin))].sort();
  const cuenta = l => AL.filter(a => a.nivel === l).length;

  root.innerHTML =
    '<div class="wrap">' +
    '<section class="que" aria-label="Qué estás viendo">' +
      '<h2>Qué estás viendo</h2>' +
      '<div class="dos">' +
        '<div class="col"><span class="tag foto">Foto semanal</span><b>Plan de producción del ' + fd(V) + ' ' + pd(V).getFullYear() + '</b>' +
          '<span class="edad' + (EDAD > 7 ? ' vieja' : '') + '">' + (EDAD <= 0 ? 'de hoy' : 'de hace ' + EDAD + (EDAD === 1 ? ' día' : ' días')) + '</span>' +
          '<p>De acá salen el <b>nivel</b> (rojo, naranja, amarillo) y la <b>fecha de quiebre</b> de cada insumo. Es el plan de esa semana: <b>no se lee de Odoo</b> y no cambia hasta que Compras suba la versión nueva del plan.</p>' +
          (EDAD > 7 ? '<p class="aviso-vieja">Esta foto tiene más de una semana: los niveles pueden estar desactualizados. Pedí la versión nueva del plan.</p>' : '') + '</div>' +
        '<div class="col"><span class="tag">En vivo</span><b>' + (VIVO ? 'Odoo, leído hoy a las ' + HORA : 'Odoo no respondió') + '</b>' +
          '<p>Lo que se lee de Odoo <b>hoy</b>: stock disponible, entrante, costo y órdenes de compra pendientes. Se refresca solo cada 5 minutos, o ahora con el botón.</p>' +
          '<div class="filters"><button type="button" class="btn" id="avq-sync" title="Vuelve a leer Odoo ahora, sin esperar la actualización automática">Actualizar ahora</button></div></div>' +
      '</div>' +
      '<p class="live" id="avq-live"></p>' +
      '<p class="live" id="avq-sig"></p>' +
      '<details class="uso"><summary>Cómo se usa</summary><ol>' +
        '<li><b>Empezá por los rojos</b> ("Va a faltar"): se quedan sin stock antes de que pueda llegar una compra nueva. Después los naranjas y por último los amarillos.</li>' +
        '<li><b>Compará el stock de hoy con el de la foto.</b> En cada insumo, "stock hoy" es el de Odoo y entre paréntesis está el de la foto. Si subió, o aparece una orden nueva, la mercadería ya llegó o está llegando: el nivel puede estar más grave de lo que es. Las etiquetas "calculado en vivo" te lo marcan; no cambian el nivel, solo avisan.</li>' +
        '<li><b>Mirá las órdenes de compra.</b> Las marcadas "vencida" son las que conviene reclamar al proveedor; las "ya no figuran pendientes" se recibieron o se cerraron desde la foto.</li>' +
        '<li><b>Marcá "Visto"</b> cuando lo hayas revisado, así Compras sabe que el aviso llegó. Podés dejar una nota corta.</li>' +
      '</ol></details>' +
    '</section>' +
    '<div class="filters"><button type="button" class="btn" id="avq-eqopen"' + (opts.puedeEditar && opts.vivo && opts.vivo.equivalencias ? '' : ' hidden') + '>Equivalencias' + (opts.vivo && opts.vivo.equivalencias ? ' (' + opts.vivo.equivalencias.pendientes.length + ' pendientes)' : '') + '</button></div>' +
    '<section class="eqv" id="avq-eq" hidden aria-label="Equivalencias de insumos"></section>' +
    '<div id="avq-pub"></div>' +
    '<div class="levels" role="group" aria-label="Filtrar por nivel">' +
      '<button type="button" class="lv rojo" data-l="rojo" aria-pressed="false"><span class="n">' + cuenta('rojo') + '</span><span class="t">Va a faltar</span><span class="d">Se queda sin stock antes de que pueda llegar una compra nueva. Hay que ajustar la producción o buscar un sustituto.</span></button>' +
      '<button type="button" class="lv naranja" data-l="naranja" aria-pressed="false"><span class="n">' + cuenta('naranja') + '</span><span class="t">Falta si se atrasa una entrega</span><span class="d">Depende de una orden que ya está vencida o sin fecha. Si el proveedor entrega, no falta.</span></button>' +
      '<button type="button" class="lv amarillo" data-l="amarillo" aria-pressed="false"><span class="n">' + cuenta('amarillo') + '</span><span class="t">Compra a tiempo</span><span class="d">Faltaría dentro del período de aviso, pero todavía se llega comprando. Compras emite la orden antes de la fecha indicada.</span></button>' +
    '</div>' +
    '<div class="filters">' +
      '<label>Línea <select id="avq-lin"><option value="">Todas</option>' + lins.map(l => '<option>' + esc(l) + '</option>').join('') + '</select></label>' +
      '<label>Categoría <select id="avq-cat"><option value="">Todas</option>' + cats.map(c => '<option>' + esc(c) + '</option>').join('') + '</select></label>' +
      '<label>Buscar <input type="search" id="avq-q" placeholder="Insumo o proveedor"></label>' +
      '<label><input type="checkbox" id="avq-seen"> Ocultar los que ya vi</label>' +
      '<span class="count" id="avq-count"></span>' +
    '</div>' +
    '<p class="status" id="avq-status" hidden></p>' +
    '<div id="avq-groups"></div>' +
    '<section class="how"><h2>Cómo se arma este aviso</h2><ul>' +
      '<li>Fecha de quiebre = día en que el stock disponible llega a cero, descontando el consumo diario que surge del plan de producción vigente y sumando las entregas de las órdenes de compra en la fecha prevista. <b>Viene de la foto semanal</b>: el plan de producción no se lee en vivo.</li>' +
      '<li>Rojo: aun si llegaran hoy las entregas atrasadas, el stock se termina antes de que pueda llegar una compra nueva (lead time del origen).</li>' +
      '<li>Naranja: el quiebre se evita solo si el proveedor entrega lo que ya está atrasado; la fecha mostrada es la del quiebre si no entrega.</li>' +
      '<li>Amarillo: faltaría dentro del período de aviso, pero una compra emitida antes de la fecha indicada llega a tiempo.</li>' +
      '<li>Período de aviso: ' + Object.keys(ESTADO.ventanas || {}).map(k => k + ' ' + Math.round(ESTADO.ventanas[k] / 7) + ' semanas').join(', ') + '. No incluye insumos discontinuados, consignados ni los que se consumen hasta agotar.</li>' +
      '<li><b>En vivo (Odoo)</b>: stock disponible de hoy y órdenes de compra confirmadas con unidades pendientes de recibir. Los insumos que no se pudieron cruzar con Odoo por nombre se muestran con los valores de la foto.</li>' +
      '<li>"Visto" queda registrado con tu usuario para que Compras sepa que el aviso llegó. Podés dejar una nota corta (por ejemplo, el cambio de plan que se tomó).</li>' +
    '</ul></section></div>';

  const $ = id => root.querySelector('#avq-' + id);
  const statusEl = $('status');
  const status = msg => { statusEl.hidden = !msg; statusEl.textContent = msg || ''; };
  const liveEl = $('live');
  if (VIVO){
    const hora = new Date(opts.vivo.leidoEn).toLocaleTimeString('es-AR', {timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit'});
    const det = [];
    if (RES.porNombre) det.push(RES.porNombre + ' por nombre');
    if (RES.porEquivalencia) det.push(RES.porEquivalencia + ' por equivalencia');
    const resto = [];
    if (RES.sinEquivalente) resto.push(RES.sinEquivalente + ' marcados "ya no existe en Odoo"');
    if (RES.pendientes) resto.push(RES.pendientes + ' sin cruzar todavía' + (opts.puedeEditar ? ' (ver Equivalencias)' : ''));
    liveEl.innerHTML = '<span class="dot"></span> <b>En vivo con Odoo: ' + NVIVO + ' de ' + AL.length + ' insumos</b> (' + det.join(', ') + '; leído a las ' + hora + '). ' +
      (resto.length ? 'Los otros ' + (AL.length - NVIVO) + ' (' + resto.join(', ') + ') quedan con los valores de la foto del ' + fd(V) + '.' : '');
  } else {
    liveEl.innerHTML = 'No se pudo leer Odoo en este momento: se muestran los valores de la foto del ' + fd(V) + '.';
  }
  const syncBtn = $('sync');
  if (!opts.sincronizar) syncBtn.hidden = true;
  else syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true; syncBtn.textContent = 'Actualizando…';
    try { await opts.sincronizar(); }
    catch (e) { syncBtn.disabled = false; syncBtn.textContent = 'Actualizar ahora'; status('No se pudo actualizar desde Odoo. Probá de nuevo en un momento.'); }
  });
  const nRep = AL.filter(a => repuesto(a)).length, nSen = AL.filter(a => senal(a)).length;
  if (VIVO) $('sig').innerHTML = '<span class="tag">calculado en vivo</span> <b>' + nRep + '</b> con stock repuesto desde la foto · <b>' + nSen + '</b> con cobertura menor al lead time.';

  /* ---- vistos ---- */
  const habilitado = !!opts.vistosDisponibles;
  let VISTOS = (opts.vistos || []).slice();
  const yo = opts.yo;
  const de = sku => VISTOS.filter(x => x.sku === sku);
  const mio = sku => VISTOS.find(x => x.sku === sku && x.usuario === yo) || null;
  let busy = Promise.resolve();
  function guardar(sku, visto, nota){
    busy = busy.then(async () => {
      const r = await fetch('/api/aviso-quiebre-vistos', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({version: V, sku, visto, nota})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'error');
    }).catch(() => status('No se pudo guardar el visto. Probá de nuevo en un momento.'));
  }
  function toggle(sku){
    if (!habilitado) return;
    const m = mio(sku);
    if (m) VISTOS = VISTOS.filter(x => x !== m);
    else VISTOS.push({sku, usuario: yo, nota: '', en: new Date().toISOString()});
    status(''); render(); guardar(sku, !m, '');
  }
  function saveNote(sku, t){
    const m = mio(sku); if (!m || (m.nota || '') === t) return;
    m.nota = t; status(''); render(); guardar(sku, true, t);
  }

  /* ---- señales calculadas en vivo (no reemplazan el nivel del plan) ---- */
  function cobDias(a, v){ return v && a.cons_sem > 0 ? v.disp / (a.cons_sem / 7) : null; }
  /* Stock repuesto: el stock de hoy supera al de la foto en al menos una semana de consumo (o en 1 u si no hay consumo). */
  function repuesto(a){ const v = vivoDe(a); return !!v && v.disp - a.disp >= Math.max(1, a.cons_sem || 0); }
  /* Cobertura de hoy menor al lead time de una compra nueva. Es una señal simple: no mira el consumo futuro del plan ni las OC. */
  function senal(a){ const v = vivoDe(a), c = cobDias(a, v); return c !== null && a.lead_dias > 0 && c < a.lead_dias; }

  /* ---- textos de cada fila ---- */
  function why(a){
    const out = [];
    const lateTxt = a.atrasado.map(o => '<span class="oc">' + esc(o.orden) + '</span> ' + esc(o.prov || '') + (o.fecha ? ' (debía llegar el ' + fd(o.fecha) + ')' : '') + ': ' + nf(o.u) + ' u').join('; ');
    const next = a.proximas[0];
    const nextTxt = next ? '<span class="oc">' + esc(next.orden) + '</span> ' + esc(next.prov || '') + ', ' + fd(next.fecha) + ': ' + nf(next.u) + ' u' : '';
    if (a.nivel === 'rojo'){
      if (a.repone) out.push('<b>Sin stock hasta el ' + fd(a.repone) + '</b>, cuando llega ' + nextTxt + '.');
      else if (next) out.push('<b>La próxima entrega llega tarde:</b> ' + nextTxt + '.');
      else out.push('<b>No hay entregas pedidas que lleguen antes.</b> Una compra nueva llegaría recién el ' + fd(a.compra_llega) + '.');
      if (a.atrasado.length) out.push('Atrasado: ' + lateTxt + '.');
    } else if (a.nivel === 'naranja'){
      out.push('<b>Depende de:</b> ' + lateTxt + '. Si llega, no falta.');
      if (next) out.push('Después: ' + nextTxt + '.');
    } else {
      out.push('<b>Compras emite la orden antes del ' + fd(a.emitir_antes) + '</b> (' + esc(a.prov || a.ori) + ', lead time ' + a.lead_dias + ' días).');
      if (next) out.push('Ya pedido: ' + nextTxt + ' (no alcanza).');
    }
    return out.join('<br>');
  }
  /* Qué dice Odoo hoy de las órdenes de compra de este insumo, y qué cambió respecto de la foto. */
  function vivoTxt(a, v){
    if (!v) return '<div class="vv off">Sin cruce con Odoo: valores de la foto.</div>';
    const partes = [];
    if (v.como === 'equivalencia') partes.push('Cruzado por equivalencia con <b>' + esc(v.nombre) + '</b>.');
    if (!v.ocs.length) partes.push('Sin órdenes de compra pendientes de recibir.');
    else partes.push('Pendiente de recibir: ' + v.ocs.map(o => {
      const tarde = !o.fecha || o.fecha < HOY;
      return '<span class="oc">' + esc(o.orden) + '</span> ' + esc(o.prov) + ', ' + (o.fecha ? fd(o.fecha) : 'sin fecha') + (tarde ? ' <span class="tarde">(vencida)</span>' : '') + ': ' + nf(o.u) + ' u';
    }).join('; ') + '.');
    const fotoOcs = a.atrasado.concat(a.proximas).filter(o => o.orden);
    const ya = fotoOcs.filter(o => !v.ocs.some(x => x.orden === o.orden));
    if (ya.length) partes.push('<b>Ya no figuran pendientes</b> (se recibieron o se cerraron): ' + ya.map(o => '<span class="oc">' + esc(o.orden) + '</span>').join(', ') + '.');
    const nuevas = v.ocs.filter(x => !fotoOcs.some(o => o.orden === x.orden));
    if (nuevas.length) partes.push('<b>Nuevas desde la foto:</b> ' + nuevas.map(o => '<span class="oc">' + esc(o.orden) + '</span>').join(', ') + '.');
    let sen = '';
    if (repuesto(a)) sen += '<div class="sig ok"><span class="tag">calculado en vivo</span> <b>Stock repuesto desde la foto</b>: de ' + nf(a.disp) + ' a ' + nf(v.disp) + ' u. El nivel de arriba sigue siendo el del plan de la foto.</div>';
    if (senal(a)) sen += '<div class="sig mal"><span class="tag">calculado en vivo</span> <b>Cobertura de ' + nf(cobDias(a, v)) + ' días, menor al lead time de ' + a.lead_dias + ' días</b> (stock de hoy / consumo semanal de la foto). Señal adicional: no cambia el nivel.</div>';
    return '<div class="vv"><span class="tag">en vivo</span> ' + partes.join(' ') + '</div>' + sen;
  }
  function nums(a, v){
    const cons = ' · consumo ' + nf(a.cons_sem) + '/sem <span class="foto">(foto)</span>';
    if (!v) return '<div class="nums">stock ' + nf(a.disp) + ' <span class="foto">(foto)</span>' + cons + '</div>';
    const cambio = Math.abs(v.disp - a.disp) > 0.05;
    const c = cobDias(a, v);
    return '<div class="nums">stock hoy <b>' + nf(v.disp) + '</b> <span class="tag">en vivo</span>' + (cambio ? ' (foto: ' + nf(a.disp) + ')' : '') + cons + (c !== null ? ' · cubre ' + nf(c) + ' días' : '') +
      '<br>entrante ' + nf(v.entrante) + ' · saliente ' + nf(v.saliente) + ' · pronosticado ' + nf(v.pronosticada) + ' · costo $ ' + fU(v.costo) +
      (a.costo && Math.abs(v.costo - a.costo) / a.costo > 0.05 ? ' <span class="foto">(foto: $ ' + fU(a.costo) + ')</span>' : '') + '</div>';
  }
  function when(a){
    const d = days(a.quiebre);
    const rel = a.disp <= 0 ? 'sin stock en la foto' : (d <= 0 ? 'ese día' : 'a ' + d + (d === 1 ? ' día' : ' días') + ' de la foto');
    return '<div class="when"><span class="dt">' + fd(a.quiebre) + '</span><span class="rel">' + rel + (a.nivel === 'naranja' ? ', si no entregan' : '') + '</span></div>';
  }

  function render(){
    const lv = [...root.querySelectorAll('.lv[aria-pressed="true"]')].map(b => b.dataset.l);
    const lin = $('lin').value, cat = $('cat').value, q = $('q').value.trim().toUpperCase();
    const hideSeen = $('seen').checked;
    const L = AL.filter(a => (!lv.length || lv.includes(a.nivel)) && (!lin || a.lin === lin) && (!cat || a.cat === cat) &&
      (!q || a.sku.toUpperCase().includes(q) || String(a.prov || '').toUpperCase().includes(q)) && (!hideSeen || !mio(a.sku)));
    $('count').textContent = L.length + ' de ' + AL.length + ' insumos';
    const G = $('groups'); G.innerHTML = '';
    for (const l of ['rojo','naranja','amarillo']){
      const items = L.filter(a => a.nivel === l); if (!items.length) continue;
      const s = document.createElement('section'); s.className = 'grp';
      s.innerHTML = '<h2>' + LBL[l] + ' <small>' + items.length + ' insumos</small></h2><div class="list"></div>';
      const list = s.querySelector('.list');
      for (const a of items){
        const acks = de(a.sku), m = mio(a.sku), v = vivoDe(a);
        const el = document.createElement('article'); el.className = 'it ' + l + (m ? ' seen' : '');
        el.innerHTML =
          '<div><div class="sku">' + esc(a.sku) + '</div><div class="meta">' + esc(a.cat) + ' · ' + esc(a.lin) + ' · ' + esc(a.ori) + (a.abc ? ' · clase ' + esc(a.abc) : '') + '</div></div>' +
          '<div>' + when(a) + nums(a, v) + '</div>' +
          '<div class="fix">' + why(a) + vivoTxt(a, v) + '</div>' +
          '<div class="ack"><button type="button" class="btn' + (m ? ' on' : '') + '"' + (habilitado ? '' : ' disabled title="Los vistos todavía no están habilitados"') + '>' + (m ? '✓ Visto' : 'Marcar visto') + '</button>' +
          (m ? '<input class="nt" type="text" maxlength="140" placeholder="Nota (opcional)" aria-label="Nota sobre ' + esc(a.sku) + '" value="' + esc(m.nota || '') + '">' : '') +
          '<div class="who">' + acks.map(x => '<span class="chip" title="' + esc(x.en ? 'Visto el ' + fd(String(x.en).slice(0,10)) : '') + '">' + esc(x.usuario === yo ? 'Vos' : x.usuario) + '</span>').join('') + '</div>' +
          acks.filter(x => x.nota).map(x => '<div class="note">' + esc(x.usuario === yo ? 'Vos' : x.usuario) + ': ' + esc(x.nota) + '</div>').join('') + '</div>';
        el.querySelector('.btn').addEventListener('click', () => toggle(a.sku));
        const nt = el.querySelector('.nt');
        if (nt) nt.addEventListener('change', () => saveNote(a.sku, nt.value.trim()));
        list.appendChild(el);
      }
      G.appendChild(s);
    }
    if (!L.length) G.innerHTML = '<p class="empty">No hay insumos con estos filtros.</p>';
  }

  /* ---- subir la versión semanal (solo editores): acepta el JSON o el HTML del artifact ---- */
  if (opts.puedeEditar && opts.publicar){
    const pub = $('pub');
    pub.innerHTML = '<label class="btn pubbtn">Subir versión nueva <input type="file" accept=".json,.html,application/json,text/html" hidden></label> <span class="hint" id="avq-pubmsg">Aceptá el .json o el .html del aviso semanal. Reemplaza la foto para todos.</span>';
    pub.querySelector('input').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const msg = $('pubmsg');
      try {
        let t = await f.text();
        const m = t.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
        if (m) t = m[1];
        const d = JSON.parse(t);
        if (!d || !Array.isArray(d.alertas)) throw new Error('El archivo no tiene el formato del aviso.');
        if (!confirm('Se va a reemplazar el aviso por la versión del ' + d.version + ' (' + d.alertas.length + ' insumos). ¿Seguir?')) { e.target.value = ''; return; }
        msg.textContent = 'Subiendo…';
        await opts.publicar(d);
        msg.textContent = 'Listo. Recargando…';
        setTimeout(() => location.reload(), 600);
      } catch (err) { msg.textContent = 'No se pudo subir: ' + (err && err.message ? err.message : 'error'); }
      e.target.value = '';
    });
  }

  /* ---- equivalencias SKU del aviso -> producto de Odoo (solo editores) ---- */
  if (opts.puedeEditar && opts.vivo && opts.vivo.equivalencias){
    const EQ = opts.vivo.equivalencias, box = $('eq');
    let cambios = false;
    const guardarEq = async (sku, productId) => {
      const r = await fetch('/api/aviso-quiebre-equivalencias', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sku, productId})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'No se pudo guardar');
      cambios = true;
    };
    const dibujar = msg => {
      const pend = EQ.pendientes, conf = EQ.confirmadas;
      const op = c => '<option value="' + c.productId + '">' + esc(c.nombre) + ' · stock ' + fU(c.disponible) + ' · $ ' + fU(c.costo) + '</option>';
      box.innerHTML = '<p><b>Equivalencias de insumos</b></p>' +
        '<div class="expl"><p>Estos insumos del aviso <b>no se encuentran en Odoo con el mismo nombre</b> (por ejemplo, porque el producto se renombró, se archivó o se reemplazó). Mientras no se confirmen, se muestran con los valores de la foto y no en vivo.</p>' +
        '<p>Para cada uno, elegí de la lista el producto de Odoo que corresponde y tocá <b>Confirmar</b>. Si ya no existe en Odoo, elegí <b>"Ya no existe / sin equivalente"</b>: deja de figurar como pendiente y sigue con los valores de la foto. Lo confirmado queda guardado y se aplica enseguida a todos.</p>' +
        '<p class="hint">Los candidatos se sugieren por parecido de nombre y pueden estar equivocados: fijate el stock y el costo antes de confirmar.</p></div>' +
        (EQ.disponible ? '' : '<p class="msg-err" role="status">Falta crear la tabla de equivalencias en Supabase (docs/aviso-quiebre-equivalencias.sql): por ahora no se puede guardar.</p>') +
        (msg ? '<p class="' + (msg.err ? 'msg-err' : '') + '" role="status">' + esc(msg.t) + '</p>' : '') +
        '<div class="tw"><table><thead><tr><th class="l">Insumo del aviso</th><th class="l">Categoría</th><th class="l">Producto de Odoo</th><th></th></tr></thead><tbody>' +
        (pend.length ? pend.map((p, i) => '<tr><td class="l" style="white-space:normal;min-width:220px">' + esc(p.sku) + '</td><td class="l">' + esc(p.categoria) + '</td><td class="l"><select data-i="' + i + '" aria-label="Producto de Odoo para ' + esc(p.sku) + '"><option value="">Elegir…</option>' + p.candidatos.map(op).join('') + '<option value="0">Ya no existe / sin equivalente</option></select></td><td><button type="button" class="btn sm" data-ok="' + i + '">Confirmar</button></td></tr>').join('') : '<tr><td colspan="4" class="l">No quedan insumos pendientes.</td></tr>') +
        '</tbody></table></div>' +
        (conf.length ? '<details><summary class="hint">Ya confirmados (' + conf.length + ')</summary><div class="tw"><table><tbody>' + conf.map((c, i) => '<tr><td class="l">' + esc(c.sku) + '</td><td class="l">' + (c.productId === 0 ? 'Ya no existe en Odoo' : esc(c.nombre || ('producto ' + c.productId))) + '</td><td><button type="button" class="btn sm" data-undo="' + i + '">Deshacer</button></td></tr>').join('') + '</tbody></table></div></details>' : '') +
        '<div class="filters"><button type="button" class="btn" id="avq-eqfin">' + (cambios ? 'Cerrar y actualizar el aviso' : 'Cerrar') + '</button></div>';
      box.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', async () => {
        const i = +b.dataset.ok, v = box.querySelector('select[data-i="' + i + '"]').value, p = pend[i];
        if (v === '') return dibujar({t: 'Elegí un producto para ' + p.sku + ' (o "Ya no existe").', err: true});
        b.disabled = true; b.textContent = 'Guardando…';
        try { await guardarEq(p.sku, +v); const c = p.candidatos.find(x => x.productId === +v);
          EQ.pendientes = pend.filter((_, k) => k !== i); EQ.confirmadas = conf.concat([{sku: p.sku, productId: +v, nombre: c ? c.nombre : null}]); dibujar({t: 'Guardado: ' + p.sku}); }
        catch (e) { dibujar({t: e.message || 'No se pudo guardar', err: true}); }
      }));
      box.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => {
        const c = conf[+b.dataset.undo]; b.disabled = true;
        try { await guardarEq(c.sku, null); location.reload(); }
        catch (e) { dibujar({t: e.message || 'No se pudo deshacer', err: true}); }
      }));
      $('eqfin').addEventListener('click', () => { if (cambios) location.reload(); else box.hidden = true; });
    };
    $('eqopen').addEventListener('click', () => { box.hidden = false; dibujar(); box.scrollIntoView({block: 'nearest'}); });
  }

  ['lin','cat','q','seen'].forEach(id => $(id).addEventListener('input', render));
  root.querySelectorAll('.lv').forEach(b => b.addEventListener('click', () => { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); render(); }));
  if (!habilitado) status('Los vistos todavía no están habilitados (falta crear la tabla en Supabase).');
  render();
}
