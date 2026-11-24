import { withTtlCache } from '@/lib/cache';
import { getParametrosCosteo } from '@/lib/supabase/rentabilidad-config';
import { codigoTela, tiempoColchonHs } from '@/lib/odoo/rentabilidad/contribucion';
import { categoriaFueraDeCostos, getProductosOdoo, type CostoProducto } from '@/lib/odoo/rentabilidad/costos-test';
import { claveTexto, horasDeTexto, leerPestana, numeroAR } from '@/lib/odoo/rentabilidad/planilla-google';

/**
 * Tab "Costos productos (test)": la pestaña `COSTOS PRODUCTOS` de la planilla (costo unitario completo de cada producto:
 * materia prima, tela, tiempo de línea, mano de obra, no productiva, fijos, precio, contribución y rentabilidad) calculada
 * con las fórmulas de la planilla (LOGICA-EXCEL.md, sección 2.2) pero tomando de Odoo todo lo que está en Odoo:
 *
 *   Odoo:     costo MP (standard_price), largo de tela, precio de venta, tiempo de línea de sillones, precio de la tela
 *             (modo "odoo"), categoría, volumen.
 *   Planilla: lo que NO está en Odoo -> grupo de tela (Grupos de telas), precio de tela (modo "planilla"), tiempos de
 *             colchones (Tiempos colchones), valor hora y pozos de no productiva (VALOR HORA), pozos de costos fijos
 *             (COSTOS PRODUCTOS Z1/AB1) y constantes de capacidad (Capacidad living).
 *
 * Después cada fila se contrasta contra la fila equivalente de la planilla (por código de barras).
 */

export type FuenteCostos = 'planilla' | 'odoo';

/** Categorías sin mano de obra, no productiva ni fijos (COUNTIF con comodines de la planilla, sin distinguir mayúsculas). */
const SIN_MO = ['reventa', 'bonificacion', 'scrap', 'materia prima', 'servicio', 'financiero', 'garantia'];
const sinMO = (cat: string) => SIN_MO.some((s) => cat.toLowerCase().includes(s));
const esColchon = (cat: string) => cat.toLowerCase().includes('colchones');
const esSillon = (cat: string) => cat.toLowerCase().startsWith('sillon');
const esDeliveries = (cat: string) => cat.toLowerCase().includes('deliveries');
const esAccesorio = (cat: string) => cat.toLowerCase().includes('accesorio');

export interface ParametrosPlanilla {
  valorHora: number;
  noProductivoColchones: number;
  noProductivoSillones: number;
  fijosColchones: number;
  fijosSillones: number;
  coefIndirecta: number;
  /** Capacidad mensual = capacidadSillon / horas (sillones y resto) o capacidadColchon / horas (colchones). */
  capacidadSillon: number;
  capacidadColchon: number;
  /** Horas de un sillón "unidad equivalente" (244 min). */
  horasUnidadEq: number;
  minutosDiarios: number;
  diasHabiles: number;
  operariosColchones: number;
}

interface TablasPlanilla {
  parametros: ParametrosPlanilla;
  /** Nombre de tela (normalizado) -> grupo y precio por metro de la planilla. */
  telas: Map<string, { grupo: string; precio: number | null }>;
  /** `categoria|grupoDeMedida|detalle` (grupo "FALSE" = cuna) -> horas. */
  tiemposColchon: Map<string, number>;
}

async function leerTablas(): Promise<TablasPlanilla> {
  return withTtlCache('costos-productos-test:tablas', 60_000, async () => {
    const [vh, cp, cap, gt, tcol, params] = await Promise.all([
      leerPestana('valorHora'),
      leerPestana('costosProductos'),
      leerPestana('capacidadLiving'),
      leerPestana('gruposTelas'),
      leerPestana('tiemposColchones'),
      getParametrosCosteo(),
    ]);

    // VALOR HORA: columna T = rótulos, columna U = valores (U2 valor hora productivo, U6/U7 no productiva colchones/sillones).
    const u = (fila: number) => numeroAR(vh[fila]?.[20]);
    // COSTOS PRODUCTOS fila 1: Z1 = costo fijo sillones, AB1 = costo fijo colchones.
    const fijosSillones = numeroAR(cp[0]?.[25]);
    const fijosColchones = numeroAR(cp[0]?.[27]);
    // Capacidad living: rótulos en G, valores en H (filas 1-5).
    const cte = (rotulo: string) => cap.slice(0, 8).find((f) => (f[6] ?? '').toLowerCase().startsWith(rotulo))?.[7];
    const minutosDiarios = numeroAR(cte('minutos')) ?? 488;
    const diasHabiles = numeroAR(cte('d')) ?? 20;
    const operarios = numeroAR(cte('operarios')) ?? 19;
    const horasDiarias = horasDeTexto(cte('horas diarias')) ?? 8 + 8 / 60;

    const faltan = [
      u(1) === null && 'valor hora (VALOR HORA!U2)',
      u(5) === null && 'no productiva colchones (VALOR HORA!U6)',
      u(6) === null && 'no productiva sillones (VALOR HORA!U7)',
      fijosSillones === null && 'costo fijo sillones (COSTOS PRODUCTOS!Z1)',
      fijosColchones === null && 'costo fijo colchones (COSTOS PRODUCTOS!AB1)',
    ].filter(Boolean);
    if (faltan.length > 0) throw new Error(`No pude leer de la planilla: ${faltan.join(', ')}. ¿Cambió la estructura de la pestaña?`);

    const parametros: ParametrosPlanilla = {
      valorHora: u(1)!,
      noProductivoColchones: u(5)!,
      noProductivoSillones: u(6)!,
      fijosColchones: fijosColchones!,
      fijosSillones: fijosSillones!,
      coefIndirecta: params['coef_indirecta_no_colchon'] ?? 1.55,
      // Sillón: (minutos/60 x 5 líneas) x días hábiles x 7.  Colchón: días hábiles x horas diarias x operarios.
      capacidadSillon: (minutosDiarios / 60) * 5 * diasHabiles * 7,
      capacidadColchon: diasHabiles * horasDiarias * operarios,
      horasUnidadEq: minutosDiarios / 2 / 60,
      minutosDiarios,
      diasHabiles,
      operariosColchones: operarios,
    };

    const telas = new Map<string, { grupo: string; precio: number | null }>();
    for (const f of gt.slice(1)) {
      const nombre = claveTexto(f[0] ?? '');
      if (nombre) telas.set(nombre, { grupo: (f[3] ?? '').trim(), precio: numeroAR(f[2]) });
    }

    const tiemposColchon = new Map<string, number>();
    for (const f of tcol.slice(1)) {
      const hs = horasDeTexto(f[4]);
      if (hs !== null && f[0]) tiemposColchon.set(`${f[0].trim()}|${(f[1] ?? '').trim()}|${(f[2] ?? '').trim()}`, hs);
    }
    return { parametros, telas, tiemposColchon };
  });
}

/** Tiempo de un colchón según la hoja "Tiempos colchones" leída en vivo; si el modelo no calza, cae a la regla embebida. */
function tiempoColchon(categoria: string, nombre: string, tabla: Map<string, number>): number | null {
  const n = nombre.toUpperCase();
  const m = /(\d{2,3})X(\d{2,3})/.exec(n);
  if (m) {
    const cuna = categoria === 'Colchones / Espuma' && n.includes('CUNA');
    const ancho = Number(m[1]);
    const grupo = cuna ? 'FALSE' : ancho <= 120 ? 'Grupo 1' : ancho <= 150 ? 'Grupo 2' : 'Grupo 3';
    let detalle = '';
    if (/OLIMPO/.test(n)) detalle = 'Olimpo';
    else if (/ESPUMA (SELECT|SENSE)/.test(n)) detalle = 'Remallado';
    else if (/ESPUMA ZAFIRO/.test(n)) detalle = 'Manija/aireador';
    const hs = tabla.get(`${categoria}|${grupo}|${detalle}`);
    if (hs !== undefined) return hs;
  }
  return tiempoColchonHs(categoria, nombre);
}

export interface CostoProductoFila {
  codigo: string;
  nombre: string;
  producto: string;
  descTelaPata: string;
  descPata: string;
  descTela: string;
  grupoTela: string;
  categoria: string;
  precioTela: number | null;
  costoMp: number;
  tela: number | null;
  costoTotalMp: number | null;
  tiempoHs: number | null;
  costoMod: number | null;
  costoModInd: number | null;
  costoNoProductiva: number | null;
  costosFijos: number | null;
  costoParaContribucion: number | null;
  costoTotal: number | null;
  precioVenta: number | null;
  contribucion: number | null;
  rentabilidad: number | null;
  rentabilidadPesos: number | null;
  unidadEq: number | null;
  /** Observaciones del cálculo (tela sin precio, sin tiempo, etc.). */
  avisos: string[];
  estado: 'ok' | 'difiere' | 'solo-odoo';
  difs: CampoCP[];
  /** Valor de la planilla para los campos que difieren. */
  planilla: Partial<Record<CampoCP, number | null>> | null;
}

export type CampoCP =
  | 'precioTela'
  | 'costoMp'
  | 'tela'
  | 'costoTotalMp'
  | 'tiempoHs'
  | 'costoMod'
  | 'costoModInd'
  | 'costoNoProductiva'
  | 'costosFijos'
  | 'costoParaContribucion'
  | 'costoTotal'
  | 'precioVenta'
  | 'contribucion'
  | 'rentabilidad'
  | 'rentabilidadPesos';

export const CAMPOS_CP: CampoCP[] = [
  'precioTela',
  'costoMp',
  'tela',
  'costoTotalMp',
  'tiempoHs',
  'costoMod',
  'costoModInd',
  'costoNoProductiva',
  'costosFijos',
  'costoParaContribucion',
  'costoTotal',
  'precioVenta',
  'contribucion',
  'rentabilidad',
  'rentabilidadPesos',
];

/** Índice de columna de cada campo en la pestaña COSTOS PRODUCTOS de la planilla. */
const COLUMNA_PLANILLA: Record<CampoCP, number> = {
  precioTela: 8,
  costoMp: 9,
  tela: 10,
  costoTotalMp: 11,
  tiempoHs: 12,
  costoMod: 13,
  costoModInd: 14,
  costoNoProductiva: 15,
  costosFijos: 16,
  costoParaContribucion: 17,
  costoTotal: 18,
  precioVenta: 19,
  contribucion: 20,
  rentabilidad: 21,
  rentabilidadPesos: 22,
};

export interface CostosProductosResultado {
  fuente: FuenteCostos;
  parametros: ParametrosPlanilla;
  filas: CostoProductoFila[];
  categorias: string[];
  resumen: {
    productos: number;
    conPlanilla: number;
    coinciden: number;
    difieren: number;
    soloOdoo: number;
    porCampo: Record<CampoCP, number>;
  };
  generado: string;
}

const dividir = (a: number, b: number | null): number | null => (b !== null && b !== 0 ? a / b : null);

function aCero(n: number | null): number {
  return n ?? 0;
}

/** Tolerancia: la planilla muestra los montos redondeados a 2 decimales y el resto a 2-4. */
function coincide(campo: CampoCP, propio: number | null, planilla: number | null): boolean {
  if (propio === null && planilla === null) return true;
  const a = propio ?? 0;
  const b = planilla ?? 0;
  if (campo === 'contribucion' || campo === 'rentabilidad') return Math.abs(a - b) <= Math.max(0.0005, Math.abs(b) * 1e-4);
  if (campo === 'tiempoHs') return Math.abs(a - b) <= 0.0051;
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.0005);
}

export async function getCostosProductosTest(fuente: FuenteCostos): Promise<CostosProductosResultado> {
  const [odoo, tablas, hojaCp] = await Promise.all([getProductosOdoo(), leerTablas(), leerPestana('costosProductos')]);
  const { parametros: P, telas, tiemposColchon } = tablas;

  const porCodigo = new Map<string, CostoProducto>(odoo.map((p) => [p.codigo, p]));
  const codigosTela = odoo.filter((p) => p.categoria === 'Materia Prima / Tela Living').map((p) => p.codigo);
  const precioTelaOdoo = new Map(odoo.filter((p) => p.categoria === 'Materia Prima / Tela Living').map((p) => [p.codigo, p.costo]));

  const planilla = new Map<string, string[]>();
  for (const f of hojaCp.slice(1)) if ((f[0] ?? '').trim() !== '') planilla.set(f[0]!.trim(), f);

  const porCampo = Object.fromEntries(CAMPOS_CP.map((c) => [c, 0])) as Record<CampoCP, number>;
  let coinciden = 0;
  let difieren = 0;
  let soloOdoo = 0;

  const filas: CostoProductoFila[] = odoo
    .filter((p) => !categoriaFueraDeCostos(p.categoria))
    .map((p) => {
      const avisos: string[] = [];
      const excluida = sinMO(p.categoria);
      const colchon = esColchon(p.categoria);
      const deliveries = esDeliveries(p.categoria);
      const base = p.codigo.split('MP')[0]!;

      // C-F: partes del nombre ("PRODUCTO - TELA - PATA").
      const nombre = p.nombre;
      const suma = nombre.toUpperCase().includes('SUMA');
      const corte = suma ? -1 : nombre.indexOf(' - ');
      const producto = corte >= 0 ? nombre.slice(0, corte) : nombre;
      const descTelaPata = corte >= 0 ? nombre.slice(corte + 3) : '';
      const iPata = descTelaPata.indexOf(' - ');
      const descTela = iPata >= 0 ? descTelaPata.slice(0, iPata) : descTelaPata;
      const descPata = iPata >= 0 ? descTelaPata.slice(iPata + 3) : '';

      // G / I: grupo y precio de la tela. La planilla los lleva a mano ("Grupos de telas"); Odoo tiene el precio de la tela
      // como costo del producto de la categoría Materia Prima / Tela Living.
      const infoTela = descTela ? telas.get(claveTexto(descTela)) : undefined;
      const grupoTela = infoTela?.grupo ?? '';
      let precioTela: number | null = infoTela?.precio ?? null;
      if (fuente === 'odoo') {
        const cod = codigoTela(p.codigo, codigosTela);
        const enOdoo = cod ? precioTelaOdoo.get(cod) : undefined;
        if (enOdoo !== undefined) precioTela = enOdoo;
      }

      // K: tela = largo de tela del modelo x precio de la tela (colchones: 0).
      const modelo = esAccesorio(p.categoria) ? porCodigo.get(p.codigo.slice(0, 9)) : porCodigo.get(base);
      const largo = modelo?.largoTela ?? 0;
      let tela: number | null = 0;
      if (!colchon && largo > 0) {
        if (precioTela === null || precioTela === 0) {
          tela = precioTela === 0 ? 0 : null;
          if (precioTela === null) avisos.push('La tela no tiene precio: el costo de materia prima no incluye la tela.');
        } else tela = largo * precioTela;
      }
      const costoTotalMp = tela === null ? p.costo : p.costo + tela;

      // M: tiempo de línea (hs).
      //  - Modo "planilla": el de la propia fila de la planilla (mano de obra / valor hora), para validar que las fórmulas reproducen la hoja.
      //  - Modo "odoo": sillones = x_studio_tiempo_estimado de la variante (si está en 0, el del modelo base); colchones = hoja
      //    "Tiempos colchones" (categoría + grupo de medida por ancho + detalle del modelo).
      const filaPlanilla = planilla.get(p.codigo);
      let tiempoHs: number | null = null;
      if (!excluida) {
        const modMes = filaPlanilla ? numeroAR(filaPlanilla[COLUMNA_PLANILLA.costoMod]) : null;
        if (fuente === 'planilla' && modMes !== null && modMes > 0) tiempoHs = modMes / P.valorHora;
        else if (colchon) tiempoHs = tiempoColchon(p.categoria, p.nombre, tiemposColchon);
        else if (esSillon(p.categoria) || p.categoria === 'PI / Block Espuma') {
          const delBase = porCodigo.get(base)?.tiempoHs ?? 0;
          tiempoHs = p.tiempoHs > 0 ? p.tiempoHs : delBase > 0 ? delBase : null;
        }
        if (tiempoHs === null) avisos.push('Sin tiempo de línea: no se pudo calcular mano de obra, no productiva ni fijos.');
      }

      // N-Q: mano de obra y pozos.
      const costoMod = excluida ? 0 : tiempoHs === null ? null : tiempoHs * P.valorHora;
      const costoModInd = costoMod === null ? null : colchon ? costoMod : costoMod * P.coefIndirecta;
      const capacidad = excluida || !tiempoHs ? null : (colchon ? P.capacidadColchon : P.capacidadSillon) / tiempoHs;
      const sillon = esSillon(p.categoria);
      const costoNoProductiva = excluida ? 0 : dividir(sillon ? P.noProductivoSillones : P.noProductivoColchones, capacidad);
      const costosFijos = excluida ? 0 : dividir(sillon ? P.fijosSillones : P.fijosColchones, capacidad);

      // R-S: costos totales.
      const costoParaContribucion = costoModInd === null ? null : costoTotalMp + costoModInd;
      const costoTotal = costoParaContribucion === null || costoNoProductiva === null || costosFijos === null ? null : costoParaContribucion + costoNoProductiva + costosFijos;

      // T: precio de venta (accesorios Deliveries: el suyo; resto: el del modelo base, +9% grupo 3, +9%² grupo 4).
      // Si el código no tiene un modelo base (materias primas: "MP0612"), la planilla deja el precio en blanco.
      const precioModelo = deliveries ? p.precioVenta : base === '' ? null : (porCodigo.get(base)?.precioVenta ?? p.precioVenta);
      const precioVenta = precioModelo === null ? null : deliveries ? precioModelo : precioModelo * (grupoTela === 'Grupo 3' ? 1.09 : grupoTela === 'Grupo 4' ? 1.09 * 1.09 : 1);

      const contribucion = costoParaContribucion === null || precioVenta === null ? null : dividir(precioVenta - costoParaContribucion, precioVenta);
      const rentabilidad = costoTotal === null || precioVenta === null ? null : dividir(precioVenta - costoTotal, precioVenta);
      const rentabilidadPesos = rentabilidad === null || precioVenta === null ? null : precioVenta * rentabilidad;
      const unidadEq = excluida || colchon || !tiempoHs ? null : tiempoHs / P.horasUnidadEq;

      const fila: CostoProductoFila = {
        codigo: p.codigo,
        nombre,
        producto,
        descTelaPata,
        descPata,
        descTela,
        grupoTela,
        categoria: p.categoria,
        precioTela,
        costoMp: p.costo,
        tela,
        costoTotalMp,
        tiempoHs,
        costoMod,
        costoModInd,
        costoNoProductiva,
        costosFijos,
        costoParaContribucion,
        costoTotal,
        precioVenta,
        contribucion,
        rentabilidad,
        rentabilidadPesos,
        unidadEq,
        avisos,
        estado: 'solo-odoo',
        difs: [],
        planilla: null,
      };

      // Contraste contra la fila de la planilla.
      const pl = filaPlanilla;
      if (!pl) {
        soloOdoo++;
        return fila;
      }
      const difs: CampoCP[] = [];
      const valores: Partial<Record<CampoCP, number | null>> = {};
      for (const c of CAMPOS_CP) {
        const v = numeroAR(pl[COLUMNA_PLANILLA[c]]);
        const propio = fila[c] as number | null;
        // La planilla deja vacío (no cero) donde no aplica; para comparar, vacío = 0.
        if (!coincide(c, propio === null ? null : propio, v === null ? null : v) && !(aCero(propio) === 0 && aCero(v) === 0)) {
          difs.push(c);
          valores[c] = v;
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
      return fila;
    });

  return {
    fuente,
    parametros: P,
    filas,
    categorias: [...new Set(filas.map((f) => f.categoria))].sort((a, b) => a.localeCompare(b, 'es')),
    resumen: { productos: filas.length, conPlanilla: filas.length - soloOdoo, coinciden, difieren, soloOdoo, porCampo },
    generado: new Date().toISOString(),
  };
}
