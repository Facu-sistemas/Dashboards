// Superpone el stock y el costo en vivo de Odoo (solo lectura) al estado del tablero "Presupuesto y cumplimiento MP".
// Lo proyectado (aprobado, meses cerrados, compras a emitir, umbrales de la política) sigue siendo el del libro: acá solo se
// recalcula lo que depende directamente del stock y del costo de hoy.
import { getBaseInsumos, type InsumoBase } from './base-insumos';
import { ocsPendientes } from './aviso-quiebre-vivo';

export interface EstadoMp {
  cols: string[];
  rows: (string | number)[][];
  [k: string]: unknown;
}

export interface Candidato {
  productId: number;
  nombre: string;
  disponible: number;
  costo: number;
  categoria: string;
}

/** Hueco de cobertura en vivo de un insumo con urgencia en el libro: lo que falta hasta que llegue su compra grande. */
export interface UrgenciaVivo {
  /** OC grande en la que se apoya el cálculo y su llegada prevista (AAAA-MM-DD). */
  oc: string;
  llega: string;
  semanas: number;
  /** Lo que se consume hasta esa fecha, lo que hay hoy y lo que entra antes con otras OC (en unidades). */
  necesidad: number;
  stock: number;
  entra: number;
  /** Unidades de OC vencidas que NO se cuentan como entrada (no se sabe cuándo llegan). */
  vencidasU: number;
  /** Lo que sigue faltando (u) y su valor ($) a costo de respaldo. */
  huecoU: number;
  huecoPesos: number;
  /** Lo que decía el libro para el mismo insumo (urgencia total: respaldo + faltante). */
  libroU: number;
  libroPesos: number;
}

export interface InfoVivo {
  generado: string;
  cruzados: number;
  total: number;
  /** SKU del libro que no se encontraron en Odoo (por nombre ni por equivalencia): quedan con el valor del libro. */
  sinCruce: string[];
  /** Hueco de cobertura en vivo por SKU (solo insumos con urgencia en el libro y una compra grande en camino). */
  urgencias?: Record<string, UrgenciaVivo>;
  /** Solo para editores: lo que falta confirmar y lo ya confirmado. */
  equivalencias?: {
    disponible: boolean;
    pendientes: { sku: string; categoria: string; consumoAnual: number; candidatos: Candidato[] }[];
    confirmadas: { sku: string; productId: number; nombre: string | null }[];
    /** Cómo cruza hoy cada SKU del libro (para revisar los que cruzaron solos por nombre y pueden estar mal). */
    cruces: Cruce[];
    /** Todos los productos de Odoo, para buscar a mano el que corresponde. */
    productos: Candidato[];
  };
}

export interface Cruce {
  sku: string;
  categoria: string;
  via: 'nombre' | 'equivalencia' | 'ya no existe' | 'sin cruce';
  productId: number | null;
  nombre: string | null;
  /** Stock y costo en Odoo hoy, y lo que decía el libro, para detectar cruces dudosos. */
  dispOdoo: number | null;
  costoOdoo: number | null;
  dispLibro: number;
  costoLibro: number;
  /** Costo de Odoo distinto del del libro por más de 10 %: sospechoso. */
  dudoso: boolean;
}

export interface OpcionesVivo {
  /** SKU del libro -> product_id de Odoo confirmado por Compras (0 = ya no existe). */
  equivalencias?: Map<string, number>;
  equivalenciasDisponibles?: boolean;
  /** Arma las listas para confirmar equivalencias (solo editores). */
  paraEditar?: boolean;
}

const ESTADOS = ['Debajo del stock de seguridad', 'Debajo del objetivo', 'En rango', 'Exceso'];

const sinCodigo = (s: string) => s.replace(/^\[[^\]]*\]\s*/, '').trim().toUpperCase();
const plano = (s: string) =>
  sinCodigo(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

function indexar(insumos: InsumoBase[]) {
  const porClave = (f: (n: string) => string) => {
    const m = new Map<string, InsumoBase[]>();
    for (const i of insumos) {
      const k = f(i.nombre);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return m;
  };
  const exacto = porClave((n) => n), sc = porClave(sinCodigo), pl = porClave(plano);
  const unico = (m: Map<string, InsumoBase[]>, k: string) => {
    const l = m.get(k);
    return l && l.length === 1 ? l[0] : undefined;
  };
  return (sku: string) => unico(exacto, sku) ?? unico(sc, sinCodigo(sku)) ?? unico(pl, plano(sku));
}

const tokens = (s: string) => new Set(plano(s).split(' ').filter(Boolean));
const parecido = (a: Set<string>, b: Set<string>) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i || 1);
};

/** Devuelve una copia del estado con el inventario en vivo, o el mismo estado si Odoo no responde. */
export async function conInventarioVivo<T extends EstadoMp>(estado: T, op: OpcionesVivo = {}): Promise<T & { vivo?: InfoVivo }> {
  let insumos: InsumoBase[];
  let leidoEn = new Date().toISOString();
  try {
    const base = await getBaseInsumos();
    insumos = base.insumos;
    leidoEn = base.leidoEn;
  } catch (e) {
    console.error('[presupuesto-mp-vivo] no se pudo leer Odoo; se muestra la foto del libro', e);
    return estado;
  }
  const porNombre = indexar(insumos);
  const porId = new Map(insumos.map((i) => [i.productId, i]));
  const eq = op.equivalencias ?? new Map<string, number>();
  const buscar = (sku: string) => {
    const e = eq.get(sku);
    if (e !== undefined) return e > 0 ? porId.get(e) : undefined;   // confirmado por Compras; 0 = ya no existe
    return porNombre(sku);
  };
  const ci = (n: string) => estado.cols.indexOf(n);
  const I = {
    sku: ci('SKU'), du: ci('Disponible u'), d: ci('Disponible $'), costo: ci('Costo actual'), est: ci('Estado'), cob: ci('Cobertura sem'),
    inm: ci('Inmovilizado $'), mx: ci('Máximo $'), ob: ci('Objetivo $'), ideal: ci('Ideal $'), sm: ci('Sin mov $'), met: ci('Método'),
    cons: ci('Consumo sem'), seg: ci('Seguridad sem'), objS: ci('Objetivo sem'), mxS: ci('Máximo sem'),
  };
  if ([I.sku, I.du, I.d, I.costo].some((x) => x < 0)) return estado;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
  const r2 = (x: number) => Math.round(x * 100) / 100;

  const sinCruce: string[] = [];
  let cruzados = 0;
  const rows = estado.rows.map((fila) => {
    const r = fila.slice();
    const sku = String(r[I.sku]);
    const p = buscar(sku);
    if (!p) {
      sinCruce.push(sku);
      return r;
    }
    cruzados++;
    const costoViejo = num(r[I.costo]);
    const costo = p.costo > 0 ? p.costo : costoViejo;
    const du = Math.max(0, p.disponible);
    const d = r2(du * costo);
    const k = costoViejo > 0 ? costo / costoViejo : 1;   // los valores en $ de la política se reescalan con el costo de hoy
    const escalar = (i: number) => { if (i >= 0) r[i] = r2(num(r[i]) * k); };
    escalar(I.mx); escalar(I.ob); escalar(I.ideal);
    const sinMov = I.sm >= 0 && num(r[I.sm]) > 0;
    r[I.du] = r2(du);
    r[I.d] = d;
    r[I.costo] = r2(costo);
    if (I.sm >= 0 && sinMov) r[I.sm] = d;
    // Estado de la política: cobertura contra los umbrales (en semanas) del libro.
    const cons = I.cons >= 0 ? num(r[I.cons]) : 0;
    let estado_ = I.est >= 0 ? String(r[I.est]) : '';
    if (ESTADOS.includes(estado_) && cons > 0) {
      const cob = du / cons;
      estado_ = (cob < num(r[I.seg]) ? ESTADOS[0] : cob < num(r[I.objS]) ? ESTADOS[1] : cob <= num(r[I.mxS]) ? ESTADOS[2] : ESTADOS[3]) as string;
      r[I.est] = estado_;
    }
    if (I.cob >= 0 && cons > 0) r[I.cob] = r2(du / cons);
    // Capital inmovilizado: sin movimiento y discontinuado = todo el stock; con política = lo que pasa del máximo.
    if (I.inm >= 0) {
      const disc = I.met >= 0 && r[I.met] === 'Discontinuado';
      r[I.inm] = sinMov || disc ? d : ESTADOS.includes(estado_) && I.mx >= 0 ? r2(Math.max(0, d - num(r[I.mx]))) : 0;
    }
    return r;
  });
  // Urgencias en vivo: hueco hasta que llegue la compra grande (OC de Odoo con más unidades pendientes).
  const urgencias: Record<string, UrgenciaVivo> = {};
  try {
    const cand: { sku: string; p: InsumoBase; fila: (string | number)[] }[] = [];
    for (const fila of estado.rows) {
      const sku = String(fila[I.sku]);
      const hay = num(fila[ci('Respaldo $')]) >= 1 || num(fila[ci('Faltante $')]) >= 1;
      const p = hay ? buscar(sku) : undefined;
      if (p) cand.push({ sku, p, fila });
    }
    if (cand.length) {
      const ocs = await ocsPendientes(cand.map((c) => c.p.productId));
      const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const dias = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
      for (const { sku, p, fila } of cand) {
        const lista = ocs.get(p.productId) ?? [];
        const cons = num(fila[ci('Consumo sem')]);
        if (!lista.length || cons <= 0) continue;
        // Solo cuentan las OC con fecha de hoy en adelante: una vencida no dice cuándo llega, así que no se la toma como entrada.
        const vigentes = lista.filter((o) => o.fecha && o.fecha >= hoy);
        const vencidasU = lista.filter((o) => o.fecha && o.fecha < hoy).reduce((a, o) => a + o.u, 0);
        const grande = vigentes.sort((a, b) => b.u - a.u)[0];
        if (!grande || grande.u < 4 * cons) continue;   // sin una compra grande en camino no hay con qué comparar
        const semanas = Math.max(0, dias(grande.fecha!, hoy)) / 7;
        const stock = Math.max(0, p.disponible);
        const entra = vigentes.filter((o) => o !== grande && o.fecha! < grande.fecha!).reduce((a, o) => a + o.u, 0);
        const necesidad = cons * semanas;
        const huecoU = Math.max(0, necesidad - stock - entra);
        const costoResp = num(fila[ci('Costo respaldo')]) || p.costo || num(fila[I.costo]);
        const libroU = [1, 2, 3, 4].reduce((a, k) => a + num(fila[ci('Resp u ' + k)]), 0) + num(fila[ci('Faltante u')]);
        urgencias[sku] = {
          oc: grande.orden, llega: grande.fecha!, semanas: r2(semanas), necesidad: Math.round(necesidad), stock: Math.round(stock), entra: Math.round(entra),
          vencidasU: Math.round(vencidasU), huecoU: Math.round(huecoU), huecoPesos: Math.round(huecoU * costoResp), libroU: Math.round(libroU), libroPesos: Math.round(num(fila[ci('Respaldo $')]) + num(fila[ci('Faltante $')])),
        };
      }
    }
  } catch (e) {
    console.error('[presupuesto-mp-vivo] no se pudo calcular el hueco en vivo de las urgencias', e);
  }
  const vivo: InfoVivo = { generado: leidoEn, cruzados, total: estado.rows.length, sinCruce, urgencias };
  if (op.paraEditar) {
    const ci2 = (n: string) => estado.cols.indexOf(n);
    const fila = new Map(estado.rows.map((r) => [String(r[I.sku]), r]));
    const pendientes = sinCruce
      .filter((sku) => !eq.has(sku))
      .map((sku) => {
        const r = fila.get(sku)!;
        const categoria = String(r[ci2('Categoría')] ?? '');
        const t = tokens(sku);
        const candidatos = insumos
          .map((i) => ({ i, p: parecido(t, tokens(i.nombre)) + (plano(i.categoria).endsWith(plano(categoria)) && categoria ? 0.1 : 0) }))
          .filter((x) => x.p >= 0.25)
          .sort((a, b) => b.p - a.p)
          .slice(0, 6)
          .map(({ i }) => ({ productId: i.productId, nombre: i.nombre, disponible: Math.round(i.disponible * 100) / 100, costo: i.costo, categoria: i.categoria }));
        return { sku, categoria, consumoAnual: num(r[ci2('Consumo anual $')]), candidatos };
      })
      .sort((a, b) => b.consumoAnual - a.consumoAnual);
    const confirmadas = [...eq.entries()]
      .filter(([sku]) => fila.has(sku))
      .map(([sku, productId]) => ({ sku, productId, nombre: productId > 0 ? porId.get(productId)?.nombre ?? null : null }));
    const cruces: Cruce[] = estado.rows.map((r) => {
      const sku = String(r[I.sku]);
      const p = buscar(sku);
      const e = eq.get(sku);
      const via: Cruce['via'] = e !== undefined ? (e > 0 ? (p ? 'equivalencia' : 'sin cruce') : 'ya no existe') : p ? 'nombre' : 'sin cruce';
      const costoLibro = num(r[I.costo]);
      const costoOdoo = p ? p.costo : null;
      return {
        sku, categoria: String(r[ci2('Categoría')] ?? ''), via, productId: p ? p.productId : null, nombre: p ? p.nombre : null,
        dispOdoo: p ? Math.round(Math.max(0, p.disponible) * 100) / 100 : null, costoOdoo, dispLibro: num(r[I.du]), costoLibro,
        dudoso: !!p && costoLibro > 0 && Math.abs((costoOdoo ?? 0) - costoLibro) / costoLibro > 0.1,
      };
    });
    const productos = insumos.map((i) => ({ productId: i.productId, nombre: i.nombre, disponible: Math.round(i.disponible * 100) / 100, costo: i.costo, categoria: i.categoria }));
    vivo.equivalencias = { disponible: op.equivalenciasDisponibles !== false, pendientes, confirmadas, cruces, productos };
  }
  return { ...estado, rows, vivo };
}
