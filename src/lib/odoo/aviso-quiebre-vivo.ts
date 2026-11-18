// Capa en vivo del "Aviso de quiebre de insumos": para cada insumo de la foto semanal que se cruza con Odoo (por nombre o por
// equivalencia confirmada), trae stock disponible, entrante/saliente/pronosticado, costo y las órdenes de compra todavía pendientes.
// El nivel y la fecha de quiebre NO se recalculan acá: salen del plan de producción de la foto. Solo lectura (search_read).
import { searchReadAll } from './client';
import { getBaseInsumos, type InsumoBase } from './base-insumos';
import { withTtlCache } from '@/lib/cache';

export interface OcViva {
  orden: string;
  prov: string;
  /** YYYY-MM-DD (hora Argentina) o null si la OC no tiene fecha prevista. */
  fecha: string | null;
  /** Unidades que faltan recibir. */
  u: number;
}

export interface InsumoVivo {
  productId: number;
  nombre: string;
  como: 'nombre' | 'equivalencia';
  disp: number;
  entrante: number;
  saliente: number;
  pronosticada: number;
  costo: number;
  ocs: OcViva[];
}

export interface Candidato {
  productId: number;
  nombre: string;
  disponible: number;
  costo: number;
  categoria: string;
}

export interface AvisoVivo {
  /** Clave = SKU tal como viene en la foto. */
  porSku: Record<string, InsumoVivo>;
  resumen: { total: number; porNombre: number; porEquivalencia: number; sinEquivalente: number; pendientes: number };
  /** Solo para editores. */
  equivalencias?: {
    disponible: boolean;
    pendientes: { sku: string; categoria: string; candidatos: Candidato[] }[];
    confirmadas: { sku: string; productId: number; nombre: string | null }[];
  };
  leidoEn: string;
}

export interface EntradaAviso {
  sku: string;
  cat: string;
}

const sinCodigo = (s: string) => s.replace(/^\[[^\]]*\]\s*/, '').trim().toUpperCase();
const plano = (s: string) => sinCodigo(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

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

type Linea = { order_id: [number, string]; product_id: [number, string]; product_qty: number; qty_received: number; date_planned: string | false; partner_id: [number, string] | false };

const aFechaAr = (s: string | false) => {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
};
const r2 = (x: number) => Math.round(x * 100) / 100;

async function ocsPendientes(ids: number[]): Promise<Map<number, OcViva[]>> {
  return withTtlCache('aviso-quiebre-ocs:' + ids.slice().sort((a, b) => a - b).join(','), 5 * 60 * 1000, async () => {
    const lineas: Linea[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      lineas.push(
        ...(await searchReadAll<Linea>({
          model: 'purchase.order.line',
          domain: [['order_id.state', 'in', ['purchase', 'done']], ['product_id', 'in', ids.slice(i, i + 300)]],
          fields: ['order_id', 'product_id', 'product_qty', 'qty_received', 'date_planned', 'partner_id'],
        }))
      );
    }
    const ocs = new Map<number, OcViva[]>();
    for (const l of lineas) {
      const falta = l.product_qty - l.qty_received;
      if (falta <= 1e-6) continue;
      const lista = ocs.get(l.product_id[0]) ?? [];
      lista.push({ orden: l.order_id[1], prov: l.partner_id ? l.partner_id[1] : '', fecha: aFechaAr(l.date_planned), u: r2(falta) });
      ocs.set(l.product_id[0], lista);
    }
    for (const l of ocs.values()) l.sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));
    return ocs;
  });
}

export async function getAvisoQuiebreVivo(
  entradas: EntradaAviso[],
  op: { equivalencias?: Map<string, number>; equivalenciasDisponibles?: boolean; paraEditar?: boolean } = {}
): Promise<AvisoVivo> {
  const { insumos } = await getBaseInsumos();
  const porId = new Map(insumos.map((i) => [i.productId, i]));
  const porNombre = indexar(insumos);
  const eq = op.equivalencias ?? new Map<string, number>();

  const cruce = new Map<string, { i: InsumoBase; como: 'nombre' | 'equivalencia' }>();
  let sinEquivalente = 0;
  const pendientesSku: EntradaAviso[] = [];
  for (const e of entradas) {
    const c = eq.get(e.sku);
    if (c !== undefined) {
      const i = c > 0 ? porId.get(c) : undefined;
      if (i) cruce.set(e.sku, { i, como: 'equivalencia' });
      else sinEquivalente++; // 0 = confirmado "ya no existe" (o el producto confirmado ya no está en la base)
      continue;
    }
    const i = porNombre(e.sku);
    if (i) cruce.set(e.sku, { i, como: 'nombre' });
    else pendientesSku.push(e);
  }

  const ocs = await ocsPendientes([...new Set([...cruce.values()].map((c) => c.i.productId))]);
  const porSku: Record<string, InsumoVivo> = {};
  for (const [sku, { i, como }] of cruce) {
    porSku[sku] = {
      productId: i.productId, nombre: i.nombre, como,
      disp: r2(i.disponible), entrante: r2(i.entrante), saliente: r2(i.saliente), pronosticada: r2(i.pronosticada), costo: i.costo,
      ocs: ocs.get(i.productId) ?? [],
    };
  }
  const vals = [...cruce.values()];
  const out: AvisoVivo = {
    porSku,
    resumen: {
      total: entradas.length,
      porNombre: vals.filter((v) => v.como === 'nombre').length,
      porEquivalencia: vals.filter((v) => v.como === 'equivalencia').length,
      sinEquivalente,
      pendientes: pendientesSku.length,
    },
    leidoEn: new Date().toISOString(),
  };

  if (op.paraEditar) {
    const pendientes = pendientesSku.map(({ sku, cat }) => {
      const t = tokens(sku);
      const candidatos = insumos
        .map((i) => ({ i, p: parecido(t, tokens(i.nombre)) + (cat && plano(i.categoria).endsWith(plano(cat)) ? 0.1 : 0) }))
        .filter((x) => x.p >= 0.25)
        .sort((a, b) => b.p - a.p)
        .slice(0, 6)
        .map(({ i }) => ({ productId: i.productId, nombre: i.nombre, disponible: r2(i.disponible), costo: i.costo, categoria: i.categoria }));
      return { sku, categoria: cat, candidatos };
    });
    const skus = new Set(entradas.map((e) => e.sku));
    const confirmadas = [...eq.entries()]
      .filter(([sku]) => skus.has(sku))
      .map(([sku, productId]) => ({ sku, productId, nombre: productId > 0 ? porId.get(productId)?.nombre ?? null : null }));
    out.equivalencias = { disponible: op.equivalenciasDisponibles !== false, pendientes, confirmadas };
  }
  return out;
}
