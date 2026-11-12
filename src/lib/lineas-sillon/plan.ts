import {
  NUM_LINEAS,
  armarCatalogo,
  baseDeOdoo,
  planearLinea,
  resolverProducto,
  sugerencias,
  type EstacionId,
  type EstacionPlan,
  type ListaEstacion,
  type ProductoDato,
  type Sobrante,
  type UnidadPlan,
  type UnidadSobrante,
} from './engine';
import { DATOS_SEED } from './datos';
import type { Nivel, ProcesoHoja } from './polivalencia';
import type { ConfigSillon, LineaConfig, PersonaSillon } from '@/lib/supabase/lineas-sillon';
import type { OrdenSillon } from '@/lib/odoo/lineas-sillon';

const MAX_UNIDADES_POR_ORDEN = 100;

export interface LineaPlan {
  linea: number;
  config: LineaConfig;
  estaciones: EstacionPlan[];
  unidades: number;
  /** Estaciones cuya lista se armó a mano (celdas elegidas o en blanco): no siguen a Odoo. */
  editadas: EstacionId[];
  /** Sobrante de ayer con el que arrancan hoy Tapicería y Ensamble (lo que la estación de arriba ya les dejó hecho). */
  sobrante: Sobrante;
  /** true = el sobrante de hoy se corrigió a mano; false = salió solo del plan fijado anterior. */
  sobranteAMano: boolean;
  /** Lo que queda sin hacer al cierre de hoy en Tapicería y Ensamble: el sobrante de mañana. */
  sobranteManana: Sobrante;
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
  /** Unidades que se sacaron del plan porque la línea ya las cerró (Odoo sigue abierta). */
  ignoradas: { orden: string; producto: string; unidades: number }[];
  productos: ProductoDato[];
  /**
   * Por persona activa: unidades de hoy en las líneas habilitadas que sabe hacer: lo que hace solo (nivel 2) o enseña
   * (nivel 3) según su matriz; si todavía no tiene niveles, sus preferencias viejas cargadas a mano (nivel null).
   */
  coincidencias: Record<string, { producto: string; linea: number; unidades: number; nivel: Nivel | null }[]>;
  /** Persona → cuántos productos hace solo y cuántos enseña en el proceso de su puesto (solo las que tienen niveles cargados). */
  resumenNiveles: Record<string, { productosSolo: number; productosEnsena: number }>;
}

const PROCESO_DE_PUESTO: Record<PersonaSillon['puesto'], ProcesoHoja> = {
  costurera: 'COS',
  carpintero: 'CAR',
  tendido: 'TAP',
  estampado: 'ENS',
};

export function catalogoDe(config: ConfigSillon): ProductoDato[] {
  return DATOS_SEED.map(([nombre, minutos, personas]) => ({
    nombre,
    minutos: config.tiempos[nombre] ?? minutos,
    personas,
  }));
}

const unidadesDe = (o: OrdenSillon) => Math.min(MAX_UNIDADES_POR_ORDEN, Math.max(1, Math.round(o.cantidad)));

/** Orden de planificación: lo más viejo primero (el atrasado se arrastra), lo que no tiene fecha al final; dentro del día, por prioridad de Odoo. */
const porFecha = (a: OrdenSillon, b: OrdenSillon) =>
  (a.fecha || '9999').localeCompare(b.fecha || '9999') ||
  (a.prioridad || Infinity) - (b.prioridad || Infinity) ||
  a.id - b.id;

const SOBRANTE_VACIO: Sobrante = { tapiceria: [], ensamble: [] };

/**
 * Sobrante con el que una línea arranca hoy: lo que Carpintería ya terminó y Tapicería no llegó a hacer, y lo mismo de
 * Tapicería a Ensamble. Sale solo del último plan fijado anterior (`previo`), que ya lo dejó calculado suponiendo que cada
 * estación cumplió todo lo que tenía hasta el cierre; si ese día no fue así, se corrige a mano y lo corregido manda por hoy.
 */
function sobranteDe(c: LineaConfig, previo: PlanSillon | null, hoy: string): { sobrante: Sobrante; aMano: boolean } {
  if (!c.activa) return { sobrante: SOBRANTE_VACIO, aMano: false };
  if (c.sobrante?.fecha === hoy) return { sobrante: { tapiceria: c.sobrante.tapiceria, ensamble: c.sobrante.ensamble }, aMano: true };
  // Los planes fijados antes del escalonado por sobrante no traen el campo: se arranca sin sobrante.
  const anterior = previo?.lineas.find((l) => l.linea === c.linea)?.sobranteManana;
  return { sobrante: anterior ?? SOBRANTE_VACIO, aMano: false };
}

export function armarPlan(ordenes: OrdenSillon[], config: ConfigSillon, hoy: string,
  repartirSinLinea: boolean,
  previo: PlanSillon | null = null,
): PlanSillon {
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

  const sobrantes = new Map<number, ReturnType<typeof sobranteDe>>();
  // Las unidades del sobrante ya pasaron por Carpintería: en Odoo la orden sigue abierta, pero no se le vuelven a pedir.
  // Se descuentan por orden (`linea|o|MO`) o, si el sobrante se cargó a mano y no tiene orden, por producto (`linea|p|PRODUCTO`).
  const yaEnLinea = new Map<string, number>();
  for (const c of config.lineas) {
    const s = sobranteDe(c, previo, hoy);
    sobrantes.set(c.linea, s);
    for (const u of [...s.sobrante.tapiceria, ...s.sobrante.ensamble]) {
      const k = u.origen ? `${c.linea}|o|${u.origen}` : `${c.linea}|p|${u.producto}`;
      yaEnLinea.set(k, (yaEnLinea.get(k) ?? 0) + 1);
    }
  }

  const sinResolverMap = new Map<string, ProductoSinResolver>();
  const sinLinea = { ordenes: 0, unidades: 0 };
  const enLineaApagada = { ordenes: 0, unidades: 0 };
  let sinFecha = 0;
  const ignoradas: PlanSillon['ignoradas'] = [];
  const hoyPorProducto = new Map<string, { linea: number; unidades: number }>();

  for (const o of [...ordenes].sort(porFecha)) {
    if (!o.fecha) sinFecha += 1;
    const total = unidadesDe(o);
    const descartadas = Math.min(total, config.ignoradas[o.nombre] ?? 0);
    if (descartadas > 0) ignoradas.push({ orden: o.nombre, producto: baseDeOdoo(o.producto), unidades: descartadas });
    const n = total - descartadas;
    if (n === 0) continue;
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
    let aCarpinteria = n;
    for (const k of [`${linea}|o|${o.nombre}`, `${linea}|p|${dato.nombre}`]) {
      const quita = Math.min(aCarpinteria, yaEnLinea.get(k) ?? 0);
      if (quita === 0) continue;
      yaEnLinea.set(k, yaEnLinea.get(k)! - quita);
      aCarpinteria -= quita;
    }
    for (let i = 0; i < aCarpinteria; i++) {
      lista.push({ producto: dato.nombre, origen: o.nombre, minutos: dato.minutos, personas: dato.personas ?? 5, manual: false });
    }
    carga.set(linea, carga.get(linea)! + dato.minutos * aCarpinteria);
  }

  const lineas: LineaPlan[] = config.lineas.map((c) => {
    const unidades = c.activa ? porLinea.get(c.linea)! : [];
    const { sobrante, aMano } = sobrantes.get(c.linea)!;
    const deAyer = (lista: UnidadSobrante[]): UnidadPlan[] =>
      lista.flatMap((s) => {
        const dato = productos.find((p) => p.nombre === s.producto);
        return dato?.minutos ? [{ producto: dato.nombre, origen: s.origen, minutos: dato.minutos, personas: dato.personas ?? 5, manual: false }] : [];
      });
    const listas: Partial<Record<EstacionId, ListaEstacion>> = {};
    const editadas: EstacionId[] = [];
    for (const id of ['carpinteria', 'tapiceria', 'ensamble'] as const) {
      const celdas = c.activa ? config.ajustes[`${c.linea}|${id}`] : undefined;
      if (!celdas) continue;
      editadas.push(id);
      listas[id] = celdas.map((nombre) => {
        const dato = nombre ? productos.find((p) => p.nombre === nombre) : null;
        return dato?.minutos ? { producto: dato.nombre, origen: 'A mano', minutos: dato.minutos, personas: dato.personas ?? 5, manual: true } : null;
      });
    }
    const { estaciones, sobranteManana } = planearLinea(unidades, { tapiceria: deAyer(sobrante.tapiceria), ensamble: deAyer(sobrante.ensamble) }, listas);
    for (const t of estaciones[0]!.tramos) {
      if (t.dia !== 0 || t.vacio) continue;
      const k = `${c.linea}|${t.producto}`;
      const previo = hoyPorProducto.get(k);
      hoyPorProducto.set(k, { linea: c.linea, unidades: (previo?.unidades ?? 0) + 1 });
    }
    return {
      linea: c.linea,
      config: c,
      estaciones,
      editadas,
      sobrante,
      sobranteAMano: aMano,
      sobranteManana,
      unidades: unidades.length,
      minutosTotales: carga.get(c.linea) ?? 0,
    };
  });

  const coincidencias: PlanSillon['coincidencias'] = {};
  const resumenNiveles: PlanSillon['resumenNiveles'] = {};
  const hoyLista = [...hoyPorProducto.entries()].map(([k, v]) => ({ producto: k.split('|')[1]!, ...v }));
  for (const p of config.personas.filter((x: PersonaSillon) => x.activa)) {
    const proceso = PROCESO_DE_PUESTO[p.puesto];
    const niveles = p.niveles[proceso] ?? {};
    if (Object.keys(niveles).length > 0) {
      const valores = Object.values(niveles);
      resumenNiveles[p.id] = { productosSolo: valores.filter((n) => n >= 2).length, productosEnsena: valores.filter((n) => n === 3).length };
      coincidencias[p.id] = hoyLista
        .map((x) => ({ ...x, nivel: niveles[x.producto] ?? null }))
        .filter((x) => x.nivel !== null && x.nivel >= 2)
        .sort((a, b) => (b.nivel ?? 0) - (a.nivel ?? 0));
    } else if (p.productos.length > 0) {
      const mias = new Set(p.productos);
      coincidencias[p.id] = hoyLista.filter((x) => mias.has(x.producto)).map((x) => ({ ...x, nivel: null }));
    }
  }

  return {
    hoy,
    lineas,
    sinResolver: [...sinResolverMap.values()].sort((a, b) => b.unidades - a.unidades),
    sinLinea,
    enLineaApagada,
    sinFecha,
    ignoradas,
    productos,
    coincidencias,
    resumenNiveles,
  };
}
