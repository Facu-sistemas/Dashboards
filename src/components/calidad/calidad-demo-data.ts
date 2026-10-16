// Parámetros de la empresa por nota de N/C (hoja Parametros de calidad/CNC_No_Calidad_desde_Oct2026_v3.xlsx).
// Las NC, la facturación y los pedidos salen de Odoo (src/lib/odoo/calidad-cnc.ts).
export interface ParametroNota {
  motivo: string;
  nota: string;
  cuenta: boolean;
  flete: boolean;
  horas: number;
  pct: number;
  monto: number;
  dueno: string;
  desc: string;
}

export const IMPORTE_MINIMO = 1000;

export const PARAMETROS: ParametroNota[] = [
 {
  "motivo": "CALIDAD",
  "nota": "GARANTIA REAL",
  "cuenta": true,
  "flete": false,
  "horas": 0,
  "pct": 1,
  "monto": 0,
  "dueno": "Producción",
  "desc": "Todo aquello que entra por problema de calidad y tenemos que darle una respuesta al cliente."
 },
 {
  "motivo": "CALIDAD",
  "nota": "GARANTIA NO REAL",
  "cuenta": true,
  "flete": false,
  "horas": 0,
  "pct": 1,
  "monto": 0,
  "dueno": "Comercial",
  "desc": "Se toma por garantía pero no es problema de calidad; se acepta por acuerdo comercial (ej.: el comercio vendió un colchón de baja densidad a una persona de 150 kg)."
 },
 {
  "motivo": "LOGISTICO",
  "nota": "NO ENTREGADO",
  "cuenta": true,
  "flete": true,
  "horas": 5,
  "pct": 0.1,
  "monto": 30000,
  "dueno": "Logística",
  "desc": "El transportista lo trae de vuelta, por decisión de el, sin autorizacion de logistica"
 },
 {
  "motivo": "LOGISTICO",
  "nota": "ROTURA CAMIONERO",
  "cuenta": true,
  "flete": true,
  "horas": 5,
  "pct": 0.1,
  "monto": 0,
  "dueno": "Logística",
  "desc": "Lo rompe el camionero y lo trae de vuelta (con costo al camionero: cargar lo cobrado en Recupero)."
 },
 {
  "motivo": "LOGISTICO",
  "nota": "ERROR DE FACTURACION DE CARGA",
  "cuenta": true,
  "flete": false,
  "horas": 5,
  "pct": 0,
  "monto": 30000,
  "dueno": "Logística",
  "desc": "Se factura de más o de menos, sin que haya ocupado espacio en el camión."
 },
 {
  "motivo": "LOGISTICO",
  "nota": "ERROR DE CARGA",
  "cuenta": true,
  "flete": true,
  "horas": 5,
  "pct": 0.1,
  "monto": 0,
  "dueno": "Logística",
  "desc": "Se facturó mal y sí ocupó espacio en el camión."
 },
 {
  "motivo": "COMERCIAL",
  "nota": "ERROR DE PEDIDO",
  "cuenta": true,
  "flete": true,
  "horas": 5,
  "pct": 0.1,
  "monto": 30000,
  "dueno": "Comercial",
  "desc": "Se cargó mal el pedido y el cliente recibe un producto distinto al que pidió."
 },
 {
  "motivo": "COMERCIAL",
  "nota": "SERVI POS VENTA",
  "cuenta": false,
  "flete": false,
  "horas": 0,
  "pct": 0,
  "monto": 0,
  "dueno": "Comercial",
  "desc": "Con cargo al cliente. Sin parámetro definido: no suma pérdida (se cuenta aparte)."
 },
 {
  "motivo": "FINANCIERO",
  "nota": "ACUERDO COMERCIAL",
  "cuenta": true,
  "flete": true,
  "horas": 5,
  "pct": 1,
  "monto": 0,
  "dueno": "Finanzas",
  "desc": "Descuento por error de carga de pedido, descuento no aplicado o publicidad otorgada."
 },
 {
  "motivo": "FINANCIERO",
  "nota": "CAMBIO DE FACTURACION",
  "cuenta": true,
  "flete": false,
  "horas": 5,
  "pct": 0,
  "monto": 30000,
  "dueno": "Finanzas",
  "desc": "Pedido de cambio de facturación."
 },
 {
  "motivo": "FINANCIERO",
  "nota": "N/C POR DESCUENTO",
  "cuenta": false,
  "flete": false,
  "horas": 0,
  "pct": 0,
  "monto": 0,
  "dueno": "Finanzas",
  "desc": "Descuento financiero (paga de contado en lugar de financiado). No es no calidad."
 }
];
