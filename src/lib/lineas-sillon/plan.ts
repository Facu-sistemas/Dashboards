import {
  NUM_LINEAS,
  armarCatalogo,
  baseDeOdoo,
  planearLinea,
  resolverProducto,
  sugerencias,
  type EstacionPlan,
  type ProductoDato,
  type UnidadPlan,
} from './engine';
import { DATOS_SEED } from './datos';
import type { ConfigSillon, LineaConfig, PersonaSillon } from '@/lib/supabase/lineas-sillon';
import type { OrdenSillon } from '@/lib/odoo/lineas-sillon';

const MAX_UNIDADES_POR_ORDEN = 100;

export interface LineaPlan {
  linea: number;
  config: LineaConfig;
  estaciones: EstacionPlan[];
  unidades: number;
  /** Minutos de una estación para fabricar todo lo asignado (sirve para comparar carga entre líneas). */
  minutosTotales: number;
}

export interface ProductoSinResolver {
  /** Nombre de Odoo sin la tela: es la clave del alias. */
  base: string;
  motivo: 'sin-equivalencia' | 'sin-tiempo';
  /** Producto de DATOS al que apunta el alias cuando el problema es que no tiene tiempo. */
  producto: string | null;
  unidades: number;
  ordenes: number;
  sugeridos: string[];
}

export interface PlanSillon {
  hoy: string;
  lineas: LineaPlan[];
  sinResolver: ProductoSinResolver[];
  sinLinea: { ordenes: number; unidades: number };
  enLineaApagada: { ordenes: number; unidades: number };
  sinFecha: number;
  productos: ProductoDato[];
  /** Por persona activa: unidades de hoy en las líneas habilitadas que coinciden con sus productos preferidos. */
  coincidencias: Record<string, { producto: string; linea: number; unidades: number }[]>;
}

export function catalogoDe(config: ConfigSillon): ProductoDato[] {
  return DATOS_SEED.map(([nombre, minutos, personas]) => ({
    nombre,
    minutos: config.tiempos[nombre] ?? minutos,
    personas,
  }));
}

const unidadesDe = (o: OrdenSillon) => Math.min(MAX_UNIDADES_POR_ORDEN, Math.max(1, Math.round(o.cantidad)));

/** Orden de planificación: lo más viejo primero (el atrasado se arrastra), lo que no tiene fecha al final. */
const porFecha = (a: OrdenSillon, b: OrdenSillon) =>
  (a.fecha || '9999').localeCompare(b.fecha || '9999') || a.id - b.id;

export function armarPlan(ordenes: OrdenSillon[], config: ConfigSillon, hoy: string, repartirSinLinea: boolean): PlanSillon {
  const productos = catalogoDe(config);
  const cat = armarCatalogo(productos, config.alias);
  const activas = new Set(config.lineas.filter((l) => l.activa).map((l) => l.linea));

  const porLinea = new Map<number, UnidadPlan[]>();
  for (let n = 1; n <= NUM_LINEAS; n++) porLinea.set(n, []);
  const carga = new Map<number, number>([...porLinea.keys()].map((n) => [n, 0]));

  // Primero lo cargado a mano (productos que no están en Odoo): se planifica antes.
  for (const m of config.manuales) {
    const dato = productos.find((p) => p.nombre === m.producto);
    if (!dato?.minutos || !porLinea.has(m.linea)) continue;
    for (let i = 0; i < m.cantidad; i++) {
      porLinea.get(m.linea)!.push({ producto: dato.nombre, origen: m.nota || 'Manual', minutos: dato.minutos, personas: dato.personas ?? 5, manual: true });
      carga.set(m.linea, carga.get(m.linea)! + dato.minutos);
    }
  }

  const sinResolverMap = new Map<string, ProductoSinResolver>();
  const sinLinea = { ordenes: 0, unidades: 0 };
  const enLineaApagada = { ordenes: 0, unidades: 0 };
  let sinFecha = 0;
  const hoyPorProducto = new Map<string, { linea: number; unidades: number }>();

  for (const o of [...ordenes].sort(porFecha)) {
    if (!o.fecha) sinFecha += 1;
    const n = unidadesDe(o);
    const dato = resolverProducto(o.producto, cat);
    if (!dato || !dato.minutos) {
      const base = baseDeOdoo(o.producto);
      const previo = sinResolverMap.get(base);
      const fila: ProductoSinResolver = previo ?? {
        base,
        motivo: dato ? 'sin-tiempo' : 'sin-equivalencia',
        producto: dato?.nombre ?? null,
        unidades: 0,
        ordenes: 0,
        sugeridos: dato ? [] : sugerencias(base, productos).map((p) => p.nombre),
      };
      fila.unidades += n;
      fila.ordenes += 1;
      sinResolverMap.set(base, fila);
      continue;
    }

    let linea = o.linea;
    if (linea === null) {
      sinLinea.ordenes += 1;
      sinLinea.unidades += n;
      if (!repartirSinLinea) continue;
      const candidatas = [...activas];
      if (candidatas.length === 0) continue;
      linea = candidatas.reduce((mejor, c) => (carga.get(c)! < carga.get(mejor)! ? c : mejor));
    }
    if (!activas.has(linea)) {
      enLineaApagada.ordenes += 1;
      enLineaApagada.unidades += n;
      continue;
    }
    const lista = porLinea.get(linea)!;
    for (let i = 0; i < n; i++) {
      lista.push({ producto: dato.nombre, origen: o.nombre, minutos: dato.minutos, personas: dato.personas ?? 5, manual: false });
    }
    carga.set(linea, carga.get(linea)! + dato.minutos * n);
  }

  const lineas: LineaPlan[] = config.lineas.map((c) => {
    const unidades = c.activa ? porLinea.get(c.linea)! : [];
    const estaciones = planearLinea(unidades, c.adelanto);
    for (const t of estaciones[0]!.tramos) {
      if (t.dia !== 0) continue;
      const k = `${c.linea}|${t.producto}`;
      const previo = hoyPorProducto.get(k);
      hoyPorProducto.set(k, { linea: c.linea, unidades: (previo?.unidades ?? 0) + 1 });
    }
    return { linea: c.linea, config: c, estaciones, unidades: unidades.length, minutosTotales: carga.get(c.linea) ?? 0 };
  });

  const coincidencias: PlanSillon['coincidencias'] = {};
  for (const p of config.personas.filter((x: PersonaSillon) => x.activa && x.productos.length > 0)) {
    const mias = new Set(p.productos);
    coincidencias[p.id] = [...hoyPorProducto.entries()]
      .map(([k, v]) => ({ producto: k.split('|')[1]!, ...v }))
      .filter((x) => mias.has(x.producto));
  }

  return {
    hoy,
    lineas,
    sinResolver: [...sinResolverMap.values()].sort((a, b) => b.unidades - a.unidades),
    sinLinea,
    enLineaApagada,
    sinFecha,
    productos,
    coincidencias,
  };
}
