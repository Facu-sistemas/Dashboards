import { getRentabilidadConfig } from '@/lib/supabase/rentabilidad-config';
import { acumulado as agrupar } from '@/lib/odoo/rentabilidad/agrupar';
import { costoKey, getCostoProvider, infoProveedor } from '@/lib/odoo/rentabilidad/contribucion';
import { getAniosDisponibles, getCategoriasRaiz, getEmpresas, getVentasDataset } from '@/lib/odoo/rentabilidad/ventas';
import { getArgentinaTodayIso } from '@/lib/odoo/oee';
import { acumuladorVacio, acumular, metricas, type Acumulador, type LineaCosteada } from '@/lib/rentabilidad/calc';
import { umbralesDeCategoria } from '@/lib/rentabilidad/config';
import type {
  RentabilidadConfig,
  CategoriaFila,
  CategoriasResultado,
  ClienteDetalleResultado,
  ClienteFila,
  ClientesResultado,
  EvolucionResultado,
  FiltrosRentabilidad,
  OpcionesRentabilidad,
  ProductoFila,
  ProductosResultado,
} from '@/lib/rentabilidad/types';

/**
 * Consultas del módulo Rentabilidad: combinan ventas (Odoo), costos (CostoProvider)
 * y configuración (Supabase o defaults) y devuelven filas listas para la UI
 * y los exports. Todo server-side.
 */

export function filtrosPorDefecto(): FiltrosRentabilidad {
  return { anio: Number(getArgentinaTodayIso().slice(0, 4)), mesIni: null, mesFin: null, categoria: null, clienteId: null, empresaId: null, costos: 'planilla' };
}

function entero(v: string | null, min: number, max: number): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Lee ?anio=&mes=&mesIni=&mesFin=&categoria=&cliente= (mes = mesIni = mesFin). */
export function parseFiltros(p: URLSearchParams): FiltrosRentabilidad {
  const def = filtrosPorDefecto();
  const mes = entero(p.get('mes'), 1, 12);
  const mesIni = mes ?? entero(p.get('mesIni'), 1, 12);
  const mesFin = mes ?? entero(p.get('mesFin'), 1, 12);
  return {
    anio: entero(p.get('anio'), 2000, 2100) ?? def.anio,
    mesIni: mesIni !== null && mesFin !== null && mesIni > mesFin ? mesFin : mesIni,
    mesFin: mesIni !== null && mesFin !== null && mesIni > mesFin ? mesIni : mesFin,
    categoria: p.get('categoria')?.trim() || null,
    clienteId: entero(p.get('cliente'), 0, Number.MAX_SAFE_INTEGER),
    empresaId: entero(p.get('empresa'), 1, Number.MAX_SAFE_INTEGER),
    costos: p.get('costos') === 'odoo' ? 'odoo' : 'planilla',
  };
}

export interface Contexto {
  filtros: FiltrosRentabilidad;
  config: RentabilidadConfig;
  proveedor: ReturnType<typeof getCostoProvider>;
  /** Todas las líneas del año (y de la categoría filtrada) — sin aplicar mes/cliente. */
  lineas: LineaCosteada[];
  nombreCliente: (id: number) => string;
  meta: (templateId: number) => { name: string; categoria: string; subcategoria: string };
}

export async function cargar(filtros: FiltrosRentabilidad): Promise<Contexto> {
  const proveedor = getCostoProvider();
  const [dataset, config] = await Promise.all([getVentasDataset(filtros.anio, filtros.categoria, filtros.empresaId), getRentabilidadConfig()]);
  const varianteIds = [...new Set(dataset.grano.map((g) => g.varianteId).filter((id) => id > 0))];
  const meses = [...new Set(dataset.grano.map((g) => g.mes))];
  const costos = proveedor.activo ? await proveedor.getCostosUnitarios(filtros.anio, varianteIds, meses, filtros.costos) : new Map();

  const lineas: LineaCosteada[] = dataset.grano.map((g) => {
    const meta = dataset.productos[g.templateId] ?? dataset.productos[0]!;
    const c = costos.get(costoKey(g.varianteId, g.mes));
    // Monto s/flete = subtotal / (1 + recargo regional del cliente). Sin recargo en bonificaciones ni PI / Block Espuma (LOGICA-EXCEL.md).
    const sinRecargo = /bonificacion/i.test(meta.categoria + meta.subcategoria) || meta.categoria === 'Servicio' || (meta.categoria === 'PI' && meta.subcategoria === 'Block Espuma');
    const recargo = sinRecargo ? 0 : (dataset.recargos[g.clienteId] ?? 0);
    return {
      clienteId: g.clienteId,
      templateId: g.templateId,
      varianteId: g.varianteId,
      mes: g.mes,
      venta: g.subtotal / (1 + recargo),
      subtotal: g.subtotal,
      cantidad: g.cantidad,
      categoria: meta.categoria,
      subcategoria: meta.subcategoria,
      costoMp: c && c.mp !== null ? c.mp * g.cantidad : null,
      costoMod: c && c.mod !== null ? c.mod * g.cantidad : null,
      costoFijos: c && c.fijos !== null ? c.fijos * g.cantidad : null,
    };
  });

  return {
    filtros,
    config,
    proveedor,
    lineas,
    nombreCliente: (id) => dataset.clientes[id] ?? `#${id}`,
    meta: (tid) => dataset.productos[tid] ?? dataset.productos[0]!,
  };
}

async function getOpciones(): Promise<OpcionesRentabilidad> {
  const [anios, categorias, empresas] = await Promise.all([getAniosDisponibles(), getCategoriasRaiz(), getEmpresas()]);
  return { anios, categorias, empresas };
}

function enPeriodo(l: LineaCosteada, f: FiltrosRentabilidad): boolean {
  return (f.mesIni === null || l.mes >= f.mesIni) && (f.mesFin === null || l.mes <= f.mesFin);
}

function aTotales(lineas: LineaCosteada[], config: RentabilidadConfig, categoria: string | null) {
  const a = acumuladorVacio();
  for (const l of lineas) acumular(a, l, config);
  return metricas(a, umbralesDeCategoria(config, categoria));
}

function filaProducto(ctx: Contexto, templateId: number, a: Acumulador, categoria: string | null): ProductoFila {
  const m = ctx.meta(templateId);
  return {
    templateId,
    producto: m.name,
    categoria: m.categoria,
    subcategoria: m.subcategoria,
    ...metricas(a, umbralesDeCategoria(ctx.config, categoria ?? m.categoria)),
  };
}

export async function getClientes(filtros: FiltrosRentabilidad): Promise<ClientesResultado> {
  const [ctx, opciones] = await Promise.all([cargar(filtros), getOpciones()]);
  const umbrales = umbralesDeCategoria(ctx.config, filtros.categoria);
  const delCliente = (l: LineaCosteada) => filtros.clienteId === null || l.clienteId === filtros.clienteId;
  const lineasPeriodo = ctx.lineas.filter((l) => enPeriodo(l, filtros) && delCliente(l));

  const mesesPorCliente = new Map<number, number[]>();
  for (const l of ctx.lineas) {
    if (!delCliente(l)) continue;
    const arr = mesesPorCliente.get(l.clienteId) ?? new Array<number>(12).fill(0);
    arr[l.mes - 1] = (arr[l.mes - 1] ?? 0) + l.venta;
    mesesPorCliente.set(l.clienteId, arr);
  }

  const filas: ClienteFila[] = agrupar(lineasPeriodo, (l) => l.clienteId, ctx.config)
    .filter((g) => g.acum.venta !== 0)
    .map((g) => ({
      clienteId: g.clave,
      cliente: ctx.nombreCliente(g.clave),
      meses: mesesPorCliente.get(g.clave) ?? new Array<number>(12).fill(0),
      ...metricas(g.acum, umbrales),
    }))
    .sort((a, b) => b.venta - a.venta);

  return {
    filtros,
    opciones,
    config: ctx.config,
    costos: infoProveedor(ctx.proveedor, filtros.costos),
    totales: aTotales(lineasPeriodo, ctx.config, filtros.categoria),
    filas,
    generado: new Date().toISOString(),
  };
}

export async function getClienteDetalle(filtros: FiltrosRentabilidad, clienteId: number): Promise<ClienteDetalleResultado> {
  const ctx = await cargar(filtros);
  const lineas = ctx.lineas.filter((l) => l.clienteId === clienteId && enPeriodo(l, filtros));
  const productos = agrupar(lineas, (l) => l.templateId, ctx.config)
    .filter((g) => g.acum.venta !== 0 || g.acum.cantidad !== 0)
    .map((g) => filaProducto(ctx, g.clave, g.acum, filtros.categoria))
    .sort((a, b) => b.venta - a.venta);
  return { clienteId, cliente: ctx.nombreCliente(clienteId), productos };
}

export async function getCategorias(filtros: FiltrosRentabilidad): Promise<CategoriasResultado> {
  const [ctx, opciones] = await Promise.all([cargar(filtros), getOpciones()]);
  const delCliente = (l: LineaCosteada) => filtros.clienteId === null || l.clienteId === filtros.clienteId;
  const lineas = ctx.lineas.filter((l) => enPeriodo(l, filtros) && delCliente(l));

  const clientesAnio = new Map<number, string>();
  for (const l of ctx.lineas) if (!clientesAnio.has(l.clienteId)) clientesAnio.set(l.clienteId, ctx.nombreCliente(l.clienteId));

  const filas: CategoriaFila[] = agrupar(lineas, (l) => l.categoria, ctx.config)
    .filter((g) => g.acum.venta !== 0)
    .map((g) => {
      const umbrales = umbralesDeCategoria(ctx.config, g.clave);
      const subcategorias = agrupar(
        lineas.filter((l) => l.categoria === g.clave),
        (l) => l.subcategoria,
        ctx.config
      )
        .filter((s) => s.acum.venta !== 0)
        .map((s) => ({ subcategoria: s.clave, ...metricas(s.acum, umbrales) }))
        .sort((a, b) => b.venta - a.venta);
      return { categoria: g.clave, subcategorias, ...metricas(g.acum, umbrales) };
    })
    .sort((a, b) => b.venta - a.venta);

  return {
    filtros,
    opciones,
    clientes: [...clientesAnio.entries()]
      .filter(([id]) => id !== 0)
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    config: ctx.config,
    costos: infoProveedor(ctx.proveedor, filtros.costos),
    totales: aTotales(lineas, ctx.config, null),
    filas,
    generado: new Date().toISOString(),
  };
}

export async function getProductos(filtros: FiltrosRentabilidad, categoria: string, subcategoria: string | null): Promise<ProductosResultado> {
  const ctx = await cargar(filtros);
  const lineas = ctx.lineas.filter(
    (l) =>
      enPeriodo(l, filtros) &&
      (filtros.clienteId === null || l.clienteId === filtros.clienteId) &&
      l.categoria === categoria &&
      (subcategoria === null || l.subcategoria === subcategoria)
  );
  const productos = agrupar(lineas, (l) => l.templateId, ctx.config)
    .filter((g) => g.acum.venta !== 0 || g.acum.cantidad !== 0)
    .map((g) => filaProducto(ctx, g.clave, g.acum, categoria))
    .sort((a, b) => b.venta - a.venta);
  return { categoria, subcategoria, productos };
}

export async function getEvolucion(filtros: FiltrosRentabilidad, templateId: number): Promise<EvolucionResultado> {
  const ctx = await cargar(filtros);
  const lineas = ctx.lineas.filter(
    (l) => l.templateId === templateId && (filtros.clienteId === null || l.clienteId === filtros.clienteId)
  );
  const m = ctx.meta(templateId);
  const umbrales = umbralesDeCategoria(ctx.config, m.categoria);
  const meses = Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const a = acumuladorVacio();
    for (const l of lineas) if (l.mes === mes) acumular(a, l, ctx.config);
    const met = metricas(a, umbrales);
    return {
      mes,
      venta: met.venta,
      cantidad: met.cantidad,
      precioUnitario: met.cantidad !== 0 ? met.venta / met.cantidad : null,
      costoUnitario: met.costoTotal !== null && met.cantidad !== 0 && met.cobertura === 1 ? met.costoTotal / met.cantidad : null,
      contribucionPct: met.contribucionPct,
    };
  });
  return { templateId, producto: m.name, categoria: m.categoria, subcategoria: m.subcategoria, meses };
}
