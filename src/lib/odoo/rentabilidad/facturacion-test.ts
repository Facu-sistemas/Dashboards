import { searchReadAll } from '@/lib/odoo/client';
import type { OdooDomain } from '@/lib/odoo/types';
import { withTtlCache } from '@/lib/cache';
import { getArgentinaTodayIso } from '@/lib/odoo/oee';
import { COMPANIA_COSTOS } from '@/lib/odoo/rentabilidad/contribucion';
import { patronesExcluidos } from '@/lib/odoo/rentabilidad/exclusiones';
import { CATEGORIAS_EXCLUIDAS, CATEGORIAS_EXCLUIDAS_EXACTAS, recargoDeRegion } from '@/lib/odoo/rentabilidad/ventas';
import { getCostosProductosTest, type CostoProductoFila, type FuenteCostos } from '@/lib/odoo/rentabilidad/costos-productos-test';
import { getProductosOdoo } from '@/lib/odoo/rentabilidad/costos-test';
import { claveTexto, leerPestana, numeroAR } from '@/lib/odoo/rentabilidad/planilla-google';

/**
 * Tab "Facturación productos (test)": la pestaña `Facturación productos` de la planilla (una fila por línea de factura, con
 * costos, flete, costo financiero, contribución y rentabilidad) armada desde Odoo para un mes, con las fórmulas de la planilla
 * (LOGICA-EXCEL.md, sección 2.1), y contrastada línea por línea contra la planilla.
 *
 *   Odoo:     fecha, contacto, producto, subtotal y cantidad de cada línea (account.move.line), categoría, volumen,
 *             región del cliente (% de recargo) y el costo unitario de cada producto (= "Costos productos (test)").
 *   Planilla: solo el plazo de pago de cada cliente (pestañas "Plazo de pago mes" y "Costo financiero/flete").
 *   Constantes de la planilla: tasa financiera 29% anual + 25% de incobrabilidad, km por región y $ por m³ por km.
 */

const TTL_MS = 60_000;
const ID_CHUNK = 800;

/** % costo financiero = plazo de pago (días) x tasa diaria: 29% anual / 365, +25% por incobrabilidad. */
export const TASA_DIARIA = (0.29 / 365) * 1.25;
/** $ por m³ por km (ida y vuelta se multiplica por 2): 1730 / 90. */
export const PRECIO_M3_KM = 1730 / 90;
/** Km de referencia por % de recargo de la región. */
export function kmDeRecargo(recargo: number): number {
  if (recargo <= 0) return 0;
  if (Math.abs(recargo - 0.05) < 1e-6) return 400;
  if (Math.abs(recargo - 0.0875) < 1e-6) return 650;
  if (Math.abs(recargo - 0.125) < 1e-6) return 1100;
  if (Math.abs(recargo - 0.162) < 1e-6) return 1450;
  if (Math.abs(recargo - 0.2) < 1e-6) return 1700;
  return 2200;
}

const sinMO = (cat: string) => ['reventa', 'bonificacion', 'scrap', 'materia prima', 'servicio', 'financiero', 'garantia'].some((s) => cat.toLowerCase().includes(s));

export type CampoFac =
  | 'subtotal'
  | 'cantidad'
  | 'recargoPct'
  | 'recargo'
  | 'costoEntrega'
  | 'montoSinFlete'
  | 'costoMp'
  | 'costoMod'
  | 'costoNoProd'
  | 'costosFijos'
  | 'cmv'
  | 'costoContrib'
  | 'pctCf'
  | 'cf'
  | 'costoTotal'
  | 'contrib'
  | 'rent';

/** Índice de columna en la pestaña `Facturación productos` de la planilla. */
const COLUMNA: Record<CampoFac, number> = {
  subtotal: 4,
  cantidad: 5,
  recargoPct: 12,
  recargo: 13,
  costoEntrega: 14,
  montoSinFlete: 15,
  costoMp: 17,
  costoMod: 18,
  costoNoProd: 19,
  costosFijos: 20,
  cmv: 22,
  costoContrib: 23,
  pctCf: 25,
  cf: 26,
  costoTotal: 27,
  contrib: 29,
  rent: 31,
};
export const CAMPOS_FAC = Object.keys(COLUMNA) as CampoFac[];

export interface FacturaFila {
  clave: string;
  fecha: string;
  contacto: string;
  codigo: string;
  producto: string;
  subtotal: number;
  cantidad: number;
  ticket: number | null;
  productoSinOpcional: string;
  categoria: string;
  grupoTela: string;
  volumen: number;
  recargoPct: number;
  recargo: number;
  costoEntrega: number;
  montoSinFlete: number;
  ticketSinFlete: number | null;
  costoMp: number | null;
  costoMod: number | null;
  costoNoProd: number | null;
  costosFijos: number | null;
  costoUn: number | null;
  cmv: number | null;
  costoContrib: number | null;
  costoContribMp: number | null;
  pctCf: number;
  cf: number;
  costoTotal: number | null;
  pctContrib: number | null;
  contrib: number | null;
  pctRent: number | null;
  rent: number | null;
  unidadEq: number | null;
  avisos: string[];
  estado: 'ok' | 'difiere' | 'solo-odoo';
  difs: CampoFac[];
  planilla: Partial<Record<CampoFac, number | null>> | null;
}

export interface TotalesFac {
  lineas: number;
  subtotal: number;
  montoSinFlete: number;
  costoEntrega: number;
  cmv: number;
  contrib: number;
  rent: number;
}

export interface FacturacionResultado {
  periodo: string;
  mesesPlanilla: string[];
  fuente: FuenteCostos;
  filas: FacturaFila[];
  categorias: string[];
  /** Por categoría: lo armado desde Odoo y lo que dice la planilla en el mismo mes. */
  porCategoria: { categoria: string; odoo: TotalesFac; planilla: TotalesFac }[];
  totalOdoo: TotalesFac;
  totalPlanilla: TotalesFac;
  resumen: { lineasOdoo: number; lineasPlanilla: number; coinciden: number; difieren: number; soloOdoo: number; soloPlanilla: number; sinCosto: number; porCampo: Record<CampoFac, number> };
  generado: string;
}

interface LineaOdoo extends Record<string, unknown> {
  invoice_date: string;
  partner_id: [number, string] | false;
  product_id: [number, string] | false;
  price_subtotal: number;
  quantity: number;
  move_type: 'out_invoice' | 'out_refund';
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** "31/10/2026" o "1/9/2026" -> "2026-10-31". */
function fechaIso(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

interface FilaPlanilla {
  fecha: string;
  codigo: string;
  categoria: string;
  valores: Record<CampoFac, number | null>;
  usada: boolean;
}

async function getFilasPlanilla(): Promise<FilaPlanilla[]> {
  const hoja = await leerPestana('facturacion');
  const out: FilaPlanilla[] = [];
  for (const f of hoja.slice(1)) {
    const fecha = fechaIso(f[0] ?? '');
    if (!fecha) continue;
    const valores = {} as Record<CampoFac, number | null>;
    for (const c of CAMPOS_FAC) valores[c] = numeroAR(f[COLUMNA[c]]);
    out.push({ fecha, codigo: (f[2] ?? '').trim(), categoria: (f[8] ?? '').trim(), valores, usada: false });
  }
  return out;
}

interface ProductoLinea {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string;
  volumen: number;
}

const clavePartida = (fecha: string, codigo: string, subtotal: number, cantidad: number) => `${fecha}|${codigo}|${Math.round(subtotal)}|${cantidad}`;

function totales(): TotalesFac {
  return { lineas: 0, subtotal: 0, montoSinFlete: 0, costoEntrega: 0, cmv: 0, contrib: 0, rent: 0 };
}

export async function getFacturacionTest(periodoPedido: string | null, fuente: FuenteCostos): Promise<FacturacionResultado> {
  const planillaTodas = await getFilasPlanilla();
  const mesesPlanilla = [...new Set(planillaTodas.map((f) => f.fecha.slice(0, 7)))].sort().reverse();
  const hoy = getArgentinaTodayIso().slice(0, 7);
  const periodo = periodoPedido && /^\d{4}-\d{2}$/.test(periodoPedido) ? periodoPedido : (mesesPlanilla[0] ?? hoy);
  return withTtlCache(`facturacion-test:${periodo}:${fuente}`, TTL_MS, () => armar(periodo, fuente, mesesPlanilla, planillaTodas));
}

async function armar(periodo: string, fuente: FuenteCostos, mesesPlanilla: string[], planillaTodas: FilaPlanilla[]): Promise<FacturacionResultado> {
  const [anio, mes] = periodo.split('-').map(Number) as [number, number];
  const desde = `${periodo}-01`;
  const sig = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;

  const exclusionesNC: OdooDomain = patronesExcluidos().map((p) => ['product_id.name', 'not ilike', p]);
  const [lineas, cp, productosOdoo, hojaPlazos, hojaCff] = await Promise.all([
    searchReadAll<LineaOdoo>({
      model: 'account.move.line',
      domain: [
        ['parent_state', '=', 'posted'],
        ['display_type', '=', 'product'],
        ['move_type', 'in', ['out_invoice', 'out_refund']],
        ['product_id', '!=', false],
        ['invoice_date', '>=', desde],
        ['invoice_date', '<', sig],
        ...exclusionesNC,
      ],
      fields: ['invoice_date', 'partner_id', 'product_id', 'price_subtotal', 'quantity', 'move_type'],
    }),
    getCostosProductosTest(fuente),
    getProductosOdoo(),
    leerPestana('plazoPagoMes'),
    leerPestana('costoFinanciero'),
  ]);

  // Productos de las líneas: los activos ya están en memoria; los archivados se leen aparte.
  const porId = new Map<number, ProductoLinea>(productosOdoo.map((p) => [p.varianteId, { id: p.varianteId, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria, volumen: p.volumen }]));
  const faltan = [...new Set(lineas.map((l) => (l.product_id ? l.product_id[0] : 0)).filter((id) => id > 0 && !porId.has(id)))];
  type Var = { id: number; barcode: string | false; name: string; categ_id: [number, string] | false; volume: number };
  for (const ids of chunks(faltan, ID_CHUNK)) {
    const rows = await searchReadAll<Var & Record<string, unknown>>({
      model: 'product.product',
      domain: [['id', 'in', ids]],
      fields: ['barcode', 'name', 'categ_id', 'volume'],
      context: { active_test: false, allowed_company_ids: [COMPANIA_COSTOS] },
    });
    for (const r of rows) porId.set(r.id, { id: r.id, codigo: r.barcode ? String(r.barcode) : '', nombre: r.name, categoria: r.categ_id ? r.categ_id[1] : '(sin categoría)', volumen: r.volume });
  }

  // Clientes: región (% de recargo) del partner comercial.
  type Partner = { id: number; name: string; commercial_partner_id: [number, string] | false; region_id?: [number, string] | false };
  const leerPartners = (ids: number[]) =>
    Promise.all(
      chunks(ids, ID_CHUNK).map((c) => searchReadAll<Partner & Record<string, unknown>>({ model: 'res.partner', domain: [['id', 'in', c]], fields: ['name', 'commercial_partner_id', 'region_id'], context: { active_test: false } }))
    ).then((r) => r.flat());
  const partnerIds = [...new Set(lineas.map((l) => (l.partner_id ? l.partner_id[0] : 0)).filter((id) => id > 0))];
  const partners = await leerPartners(partnerIds);
  const comercialDe = new Map(partners.map((p) => [p.id, p.commercial_partner_id ? p.commercial_partner_id[0] : p.id]));
  const comerciales = await leerPartners([...new Set(comercialDe.values())]);
  const regionDe = new Map<number, { nombre: string; recargo: number | null }>(
    comerciales.map((c) => [c.id, { nombre: c.name, recargo: c.region_id ? recargoDeRegion(c.region_id[1]) : null }])
  );

  // Plazo de pago (días) por cliente: "Plazo de pago mes" y, si no está, el plazo estático de "Costo financiero/flete".
  const plazoMes = new Map<string, number>();
  for (const f of hojaPlazos.slice(1)) {
    const v = numeroAR(f[2]);
    if (f[0] && v !== null) plazoMes.set(claveTexto(f[0]), v);
  }
  const plazoFijo = new Map<string, number>();
  for (const f of hojaCff.slice(1)) {
    const v = numeroAR(f[2]);
    if (f[0] && v !== null) plazoFijo.set(claveTexto(f[0]), v);
  }

  const cpPorCodigo = new Map<string, CostoProductoFila>(cp.filas.map((f) => [f.codigo, f]));

  // Planilla del mismo mes, indexada para cruzar línea por línea.
  const planillaMes = planillaTodas.filter((f) => f.fecha.startsWith(periodo));
  const indice = new Map<string, FilaPlanilla[]>();
  for (const f of planillaMes) {
    const k = clavePartida(f.fecha, f.codigo, f.valores.subtotal ?? 0, f.valores.cantidad ?? 0);
    indice.set(k, [...(indice.get(k) ?? []), f]);
  }

  const porCampo = Object.fromEntries(CAMPOS_FAC.map((c) => [c, 0])) as Record<CampoFac, number>;
  let coinciden = 0;
  let difieren = 0;
  let soloOdoo = 0;
  let sinCosto = 0;
  const filas: FacturaFila[] = [];

  for (const l of lineas) {
    const prod = porId.get(l.product_id ? l.product_id[0] : 0);
    if (!prod) continue;
    const raiz = prod.categoria.split('/')[0]!.trim();
    if (CATEGORIAS_EXCLUIDAS.includes(raiz) || CATEGORIAS_EXCLUIDAS_EXACTAS.includes(prod.categoria)) continue;

    const signo = l.move_type === 'out_refund' ? -1 : 1;
    const subtotal = signo * l.price_subtotal;
    const cantidad = signo * l.quantity;
    const avisos: string[] = [];
    const contacto = l.partner_id ? l.partner_id[1] : '(sin cliente)';
    const comercialId = l.partner_id ? (comercialDe.get(l.partner_id[0]) ?? l.partner_id[0]) : 0;
    const region = regionDe.get(comercialId);
    const nombreComercial = region?.nombre ?? contacto;
    const bonif = prod.categoria.toLowerCase().includes('bonificacion');
    const excluida = sinMO(prod.categoria);

    const cpf = prod.codigo ? cpPorCodigo.get(prod.codigo) : undefined;
    const suma = prod.nombre.toUpperCase().includes('SUMA');
    const iCorte = prod.nombre.indexOf(' - ');
    const productoSinOpcional = suma || iCorte < 0 ? prod.nombre : prod.nombre.slice(0, iCorte);
    const grupoTela = cpf?.grupoTela ?? '';

    // Recargo regional (viene incluido dentro del subtotal) y costo de entrega estimado.
    const sinRecargo = bonif || prod.categoria === 'PI / Block Espuma';
    let recargoPct = sinRecargo ? 0 : (region?.recargo ?? 0);
    if (!sinRecargo && region?.recargo == null) avisos.push('El cliente no tiene región cargada en Odoo: sin recargo ni costo de entrega.');
    if (recargoPct < 0) recargoPct = 0;
    const recargo = (recargoPct * subtotal) / (recargoPct + 1);
    const valorM3 = kmDeRecargo(region?.recargo ?? 0) * 2 * PRECIO_M3_KM;
    const costoEntrega = subtotal < 0 ? 0 : prod.volumen * valorM3 * cantidad;
    const montoSinFlete = subtotal - recargo;

    // Costos unitarios (de Costos productos).
    let costoMp: number | null = null;
    let costoMod: number | null = null;
    let costoNoProd: number | null = null;
    let costosFijos: number | null = null;
    if (cpf) {
      costoMp = cpf.costoTotalMp;
      costoMod = excluida ? 0 : cpf.costoModInd;
      costoNoProd = excluida ? 0 : cpf.costoNoProductiva;
      costosFijos = excluida ? 0 : cpf.costosFijos;
      if (costoMp === null) avisos.push('Falta el precio de la tela: el costo de materia prima no es confiable.');
      else if (!excluida && costoMod === null) avisos.push('El producto no tiene tiempo de línea: sin mano de obra, no productiva ni fijos.');
    } else {
      avisos.push(prod.codigo ? 'El producto no está entre los de Costos (¿archivado o fuera de categoría?): sin costo.' : 'El producto no tiene código de barras: sin costo.');
    }
    const completo = costoMp !== null && costoMod !== null && costoNoProd !== null && costosFijos !== null;
    if (!completo) sinCosto++;
    const costoUn = completo ? costoMp! + costoMod! + costoNoProd! + costosFijos! : null;
    const cmv = costoUn === null ? null : costoUn * cantidad;
    const costoContrib = costoMp !== null && costoMod !== null ? (costoMp + costoMod) * cantidad : null;
    const costoContribMp = costoMp === null ? null : costoMp * cantidad;

    // Costo financiero sobre el subtotal (con recargo) según el plazo de pago del cliente.
    const kCliente = claveTexto(contacto);
    const kComercial = claveTexto(nombreComercial);
    const plazo = plazoMes.get(kCliente) ?? plazoMes.get(kComercial) ?? plazoFijo.get(kCliente) ?? plazoFijo.get(kComercial);
    if (plazo === undefined && !bonif) avisos.push('Sin plazo de pago del cliente en la planilla: costo financiero 0.');
    const pctCf = bonif ? 0 : (plazo ?? 0) * TASA_DIARIA;
    const cf = subtotal * pctCf;

    const costoTotal = cmv === null ? null : cf + cmv + costoEntrega;
    const contrib = costoContrib === null ? null : montoSinFlete - costoContrib;
    const rent = costoTotal === null ? null : subtotal - costoTotal;
    const unidadEq = cpf ? (cpf.unidadEq ?? (cpf.categoria.toLowerCase().includes('colchones') ? 1 : null)) : null;

    const fila: FacturaFila = {
      clave: `${l.invoice_date}|${prod.codigo}|${filas.length}`,
      fecha: l.invoice_date,
      contacto,
      codigo: prod.codigo,
      producto: prod.nombre,
      subtotal,
      cantidad,
      ticket: cantidad !== 0 ? subtotal / cantidad : null,
      productoSinOpcional,
      categoria: prod.categoria,
      grupoTela,
      volumen: prod.volumen,
      recargoPct,
      recargo,
      costoEntrega,
      montoSinFlete,
      ticketSinFlete: cantidad !== 0 ? montoSinFlete / cantidad : null,
      costoMp,
      costoMod,
      costoNoProd,
      costosFijos,
      costoUn,
      cmv,
      costoContrib,
      costoContribMp,
      pctCf,
      cf,
      costoTotal,
      pctContrib: contrib === null || montoSinFlete === 0 ? null : contrib / montoSinFlete,
      contrib,
      pctRent: rent === null || subtotal === 0 ? null : rent / subtotal,
      rent,
      unidadEq: unidadEq === null ? null : unidadEq * cantidad,
      avisos,
      estado: 'solo-odoo',
      difs: [],
      planilla: null,
    };

    // Cruce con la planilla.
    const candidatos = indice.get(clavePartida(l.invoice_date, prod.codigo, subtotal, cantidad));
    const pl = candidatos?.find((c) => !c.usada);
    if (!pl) {
      soloOdoo++;
    } else {
      pl.usada = true;
      const difs: CampoFac[] = [];
      const valores: Partial<Record<CampoFac, number | null>> = {};
      for (const c of CAMPOS_FAC) {
        const propio = fila[c] as number | null;
        const ref = pl.valores[c];
        const a = propio ?? 0;
        const b = ref ?? 0;
        // La planilla muestra los % redondeados (el costo financiero, a entero): se tolera ese redondeo.
        const tol = c === 'pctCf' ? 0.0051 : c === 'recargoPct' ? 0.0006 : Math.max(1, Math.abs(b) * 0.001);
        if (Math.abs(a - b) > tol) {
          difs.push(c);
          valores[c] = ref;
        }
      }
      if (difs.length === 0) {
        coinciden++;
        fila.estado = 'ok';
      } else {
        difieren++;
        for (const d of difs) porCampo[d]++;
        fila.estado = 'difiere';
        fila.difs = difs;
        fila.planilla = valores;
      }
    }
    filas.push(fila);
  }

  // Totales por categoría (Odoo vs planilla).
  const mapaCat = new Map<string, { odoo: TotalesFac; planilla: TotalesFac }>();
  const cat = (c: string) => {
    let e = mapaCat.get(c);
    if (!e) mapaCat.set(c, (e = { odoo: totales(), planilla: totales() }));
    return e;
  };
  const totalOdoo = totales();
  const totalPlanilla = totales();
  for (const f of filas) {
    for (const t of [cat(f.categoria).odoo, totalOdoo]) {
      t.lineas++;
      t.subtotal += f.subtotal;
      t.montoSinFlete += f.montoSinFlete;
      t.costoEntrega += f.costoEntrega;
      t.cmv += f.cmv ?? 0;
      t.contrib += f.contrib ?? 0;
      t.rent += f.rent ?? 0;
    }
  }
  for (const f of planillaMes) {
    for (const t of [cat(f.categoria).planilla, totalPlanilla]) {
      t.lineas++;
      t.subtotal += f.valores.subtotal ?? 0;
      t.montoSinFlete += f.valores.montoSinFlete ?? 0;
      t.costoEntrega += f.valores.costoEntrega ?? 0;
      t.cmv += f.valores.cmv ?? 0;
      t.contrib += f.valores.contrib ?? 0;
      t.rent += f.valores.rent ?? 0;
    }
  }
  const porCategoria = [...mapaCat.entries()]
    .map(([categoria, v]) => ({ categoria, ...v }))
    .sort((a, b) => Math.abs(b.odoo.subtotal) + Math.abs(b.planilla.subtotal) - (Math.abs(a.odoo.subtotal) + Math.abs(a.planilla.subtotal)));

  return {
    periodo,
    mesesPlanilla,
    fuente,
    filas: filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.contacto.localeCompare(b.contacto, 'es')),
    categorias: [...new Set(filas.map((f) => f.categoria))].sort((a, b) => a.localeCompare(b, 'es')),
    porCategoria,
    totalOdoo,
    totalPlanilla,
    resumen: {
      lineasOdoo: filas.length,
      lineasPlanilla: planillaMes.length,
      coinciden,
      difieren,
      soloOdoo,
      soloPlanilla: planillaMes.filter((f) => !f.usada).length,
      sinCosto,
      porCampo,
    },
    generado: new Date().toISOString(),
  };
}
