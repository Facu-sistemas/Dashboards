/**
 * Glosario de las pestañas "Rentabilidad clientes" y "Rentabilidad categorías":
 * un texto por dato, que se muestra al pasar el mouse por encabezados de tabla
 * y KPIs. Editar acá. Cada texto dice de dónde sale el dato (modelo/campo de
 * Odoo o parámetro de la planilla de rentabilidad) y la fórmula.
 */
export const GLOSARIO = {
  cliente:
    'Cliente comercial de la factura.\nOdoo: account.move.line.partner_id → res.partner.commercial_partner_id (los contactos de una empresa se suman a la empresa).',
  producto: 'Producto vendido (product.template del producto de la línea de factura).',
  categoria:
    'Categoría y subcategoría del producto.\nOdoo: product.product.categ_id → complete_name partido en "Categoría / Subcategoría". "Colchones/bonificacion" y "Sillon/Bonificacion" se toman como subcategoría Bonificación.',
  mes: 'Mes de la fecha de factura (account.move.invoice_date).',
  venta:
    'Monto sin flete.\nOdoo: account.move.line.price_subtotal (sin IVA) de facturas de cliente posteadas (out_invoice) menos notas de crédito (out_refund), ambas compañías; se excluyen las categorías Financiero, Garantía, Materia Prima y PI suelta (la planilla no las incluye).\nFórmula: Monto s/flete = Subtotal / (1 + % recargo). El % recargo sale de la región del cliente (res.partner.region_id, ej. "COSTA BS AS - 12,5%" = 12,5%). El recargo es 0 en Bonificación, Servicio y PI / Block Espuma.',
  subtotal:
    'Subtotal facturado con el recargo regional incluido.\nOdoo: suma de account.move.line.price_subtotal (facturas menos N/C incluidas).',
  notasCredito:
    'Notas de crédito: se restan TODAS las out_refund posteadas (devoluciones, acuerdos comerciales, flete, etc.), igual que la planilla de rentabilidad.\nLa lista de exclusiones posibles está en src/lib/odoo/rentabilidad/exclusiones.ts (hoy ninguna activa).',
  pctTotal: '% del total = Venta (monto s/flete) de la fila / Venta total de la tabla.',
  cantidad:
    'Unidades vendidas.\nOdoo: suma de account.move.line.quantity de las facturas menos las de las notas de crédito incluidas (las devoluciones restan).',
  costoMp:
    'Costo de materia prima por unidad × cantidad.\nOdoo: product.product.standard_price (costo vigente, no histórico) + tela.\nTela = Largo de tela del producto padre (product.template.cloth_length) × standard_price de la tela (producto de categoría Materia Prima / Tela Living cuyo código de barras está dentro del de la variante). Reventa, Scrap, Servicio y bonificaciones: solo standard_price.',
  costoMod:
    'Mano de obra directa + indirecta por unidad × cantidad.\nFórmula: tiempo de línea (hs) × valor hora productivo del mes × 1,55 (el 1,55 de indirecta solo en no-colchones).\nSillones: tiempo = product.product.x_studio_tiempo_estimado.\nColchones: tiempo de la hoja "Tiempos colchones" de la planilla (categoría + grupo de medida por ancho + detalle del modelo) × 24 hs. Para ~260 productos (algunos colchones, Deliveries, Accesorios, Block Espuma) se usa el tiempo puntual de la planilla (tiempos-planilla.ts).\nValor hora: parámetro de planilla por mes (septiembre 2026 = 20.869,11), editable en rentabilidad_parametros_costeo.',
  costoTotal: 'Costo para contribución = costo MP + costo MOD+indirecta. No incluye no productiva, fijos, costo de entrega ni financiero.',
  contribucion:
    'Contribución $ = Monto s/flete − (costo MP + costo MOD+indirecta) × cantidad, sobre la parte de la venta que tiene costo. Sin costo conocido muestra "—" (no se estima).',
  contribucionPct: '% Contribución = Contribución $ / Monto s/flete con costo × 100.',
  objetivo:
    'Objetivo de contribución (%): el de la categoría en rentabilidad_contribucion_objetivos, o el general (48% por defecto). En filas con varias categorías es el promedio ponderado por venta.',
  gap: 'Gap vs objetivo = % Contribución − Objetivo %, en puntos porcentuales (pp).',
  margenPerdido: 'Margen perdido = máx(Objetivo % × Monto s/flete con costo − Contribución $, 0). Es lo que faltó para llegar al objetivo.',
  estado:
    'Semáforo según el % Contribución: OK si ≥ umbral verde (48% por defecto), Alerta si ≥ umbral amarillo (42%), Crítico si menos. "Sin costo" si la fila no tiene costo. Umbrales por categoría en rentabilidad_contribucion_objetivos.',
  cobertura: 'Cobertura de costo = Monto s/flete de las líneas con costo conocido / Monto s/flete total. Lo que no tiene costo no entra en la contribución.',
  precioUnitario: 'Precio unitario = Monto s/flete / Cantidad del mes (real facturado).',
  costoUnitario: 'Costo unitario = (costo MP + costo MOD+indirecta) / Cantidad del mes. Solo si todo el mes tiene costo.',
  kpiClientes: 'Cantidad de clientes con ventas distintas de cero en el período filtrado.',
  kpiCategorias: 'Cantidad de categorías con ventas distintas de cero en el período filtrado.',
} as const;

export type ClaveGlosario = keyof typeof GLOSARIO;

export interface ContextoGlosario {
  costos: 'planilla' | 'odoo';
  /** Nombre de la empresa filtrada, o "Ambas empresas". */
  empresa: string;
}

export const MODO_COSTOS_TEXTO = {
  planilla:
    'Planilla (coincide con el Excel): costo MP = standard_price de Odoo + tela; tiempos de línea tomados de la planilla para ~260 productos (algunos colchones, Deliveries, Accesorios, Block Espuma; tiempos-planilla.ts) y de Odoo / regla de colchones para el resto.',
  odoo: 'Odoo (dinámico): tiempos de línea solo de Odoo (x_studio_tiempo_estimado en sillones) y la regla de colchones de la hoja "Tiempos colchones"; sin la tabla de 260 tiempos de la planilla. PI / Block Espuma queda sin costo (Odoo tiene 0 hs).',
} as const;

export const NOTA_EMPRESA =
  'Empresa: las facturas se leen de account.move.line.company_id (Frontera Living S.A id 1 y Presupuesto id 2). Los costos (standard_price, que en Odoo es por compañía) se leen siempre con la compañía 1 Frontera Living S.A, porque en Presupuesto vale 0.';

const CLAVES_COSTO: ClaveGlosario[] = ['costoMp', 'costoMod', 'costoTotal', 'contribucion', 'contribucionPct', 'objetivo', 'gap', 'margenPerdido', 'estado', 'cobertura', 'costoUnitario'];
const CLAVES_EMPRESA: ClaveGlosario[] = ['cliente', 'venta', 'subtotal', 'cantidad', 'notasCredito', 'pctTotal', 'precioUnitario'];

/** Texto del hover: el del glosario más el modo de costos / empresa activos cuando aplican. */
export function textoGlosario(clave: ClaveGlosario, ctx?: ContextoGlosario | null): string {
  let t: string = GLOSARIO[clave];
  if (!ctx) return t;
  if (CLAVES_COSTO.includes(clave)) t += `\n\nModo de costos activo: ${MODO_COSTOS_TEXTO[ctx.costos]}`;
  if (CLAVES_EMPRESA.includes(clave)) t += `\n\nEmpresa activa: ${ctx.empresa}. ${NOTA_EMPRESA}`;
  return t;
}
