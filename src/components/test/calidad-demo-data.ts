// Datos de la demo: copiados de calidad/CNC_No_Calidad_desde_Oct2026_v3.xlsx (hojas Parametros y Registro_NC).
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

export interface NotaCredito {
  fecha: string;
  nc: string;
  cliente: string;
  nota: string;
  importe: number;
  recupero: number;
}

export const FACTURACION_NETA_OCT = 769330000;
export const PEDIDOS_OCT = 150;
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

export const NOTAS: NotaCredito[] = [{"fecha": "2026-10-14", "nc": "NC A 0050-00016568", "cliente": "PARDO S.A.", "nota": "GARANTIA REAL", "importe": 356895.0, "recupero": 0.0}, {"fecha": "2026-10-14", "nc": "NC A 0050-00016567", "cliente": "SCHIEBERT RAUL SANTIAGO", "nota": "ROTURA CAMIONERO", "importe": 446871.3, "recupero": 0.0}, {"fecha": "2026-10-14", "nc": "NC A 0050-00016566", "cliente": "MUEBLERIA SPIAZZI S.R.L.", "nota": "CAMBIO DE FACTURACION", "importe": 22400.0, "recupero": 0.0}, {"fecha": "2026-10-14", "nc": "NC A 0050-00016565", "cliente": "CIANI JORDAN SANTIAGO", "nota": "CAMBIO DE FACTURACION", "importe": 559060.14, "recupero": 0.0}, {"fecha": "2026-10-14", "nc": "NC A 0050-00016564", "cliente": "PESCIO HUGO DAMIAN", "nota": "ACUERDO COMERCIAL", "importe": 50483.31, "recupero": 0.0}, {"fecha": "2026-10-14", "nc": "NC A 0050-00016563", "cliente": "ROSALES SERGIO MANUEL", "nota": "ACUERDO COMERCIAL", "importe": 244690.39, "recupero": 0.0}, {"fecha": "2026-10-14", "nc": "NC A 0050-00016562", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 99739.24, "recupero": 0.0}, {"fecha": "2026-10-14", "nc": "NC A 0050-00016561", "cliente": "ART CARG SRL", "nota": "ACUERDO COMERCIAL", "importe": 742400.6, "recupero": 0.0}, {"fecha": "2026-10-09", "nc": "NC A 0050-00016560", "cliente": "BUCALA GUSTAVO R. Y BUCALA HORACIO S.H.", "nota": "ROTURA CAMIONERO", "importe": 673271.82, "recupero": 0.0}, {"fecha": "2026-10-09", "nc": "NC A 0050-00016559", "cliente": "RADIO PEYBO TV SACIFI", "nota": "ACUERDO COMERCIAL", "importe": 86798.69, "recupero": 0.0}, {"fecha": "2026-10-09", "nc": "NC A 0050-00016558", "cliente": "PARDO S.A.", "nota": "CAMBIO DE FACTURACION", "importe": 4528488.7, "recupero": 0.0}, {"fecha": "2026-10-09", "nc": "NC A 0050-00016557", "cliente": "GURNIAK ELENA MARIA", "nota": "ERROR DE PEDIDO", "importe": 40164.8, "recupero": 0.0}, {"fecha": "2026-10-09", "nc": "NC A 0050-00016556", "cliente": "LA FABRICA MUEBLES S.R.L.", "nota": "N/C POR DESCUENTO", "importe": 472195.79, "recupero": 0.0}, {"fecha": "2026-10-09", "nc": "NC A 0050-00016555", "cliente": "SANCHEZ MUEBLES PERGAMINO S.R.L", "nota": "N/C POR DESCUENTO", "importe": 530168.08, "recupero": 0.0}, {"fecha": "2026-10-09", "nc": "NC A 0050-00016554", "cliente": "SCHMIDT Y BAYER  S.R.L.", "nota": "N/C POR DESCUENTO", "importe": 1052119.35, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016553", "cliente": "SAN MIGUEL CENTER SRL", "nota": "N/C POR DESCUENTO", "importe": 130811.35, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016552", "cliente": "BUSCEMI DANIEL", "nota": "N/C POR DESCUENTO", "importe": 74687.55, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016551", "cliente": "BRINATTI MARIO ALBERTO", "nota": "N/C POR DESCUENTO", "importe": 72600.37, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016550", "cliente": "MARIO GASTELU", "nota": "N/C POR DESCUENTO", "importe": 424435.32, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016549", "cliente": "MUEBLES LA ESPAÑOLA SA", "nota": "N/C POR DESCUENTO", "importe": 391726.7, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016548", "cliente": "ANDREOSE MUEBLES S.R.L", "nota": "N/C POR DESCUENTO", "importe": 113370.78, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016547", "cliente": "TOLOSA VERONICA GABRIELA", "nota": "N/C POR DESCUENTO", "importe": 119870.78, "recupero": 0.0}, {"fecha": "2026-10-08", "nc": "NC A 0050-00016546", "cliente": "DENTARO AGUSTIN", "nota": "N/C POR DESCUENTO", "importe": 288292.93, "recupero": 0.0}, {"fecha": "2026-10-07", "nc": "NC A 0050-00016545", "cliente": "COOP PROV SERV ELECT RIVADAVIA LTDA", "nota": "N/C POR DESCUENTO", "importe": 259452.57, "recupero": 0.0}, {"fecha": "2026-10-07", "nc": "NC A 0050-00016544", "cliente": "GALLAY MIRTA", "nota": "ACUERDO COMERCIAL", "importe": 72029.27, "recupero": 0.0}, {"fecha": "2026-10-07", "nc": "NC A 0050-00016543", "cliente": "GALLAY MIRTA", "nota": "N/C POR DESCUENTO", "importe": 172869.79, "recupero": 0.0}, {"fecha": "2026-10-07", "nc": "NC A 0050-00016542", "cliente": "COULCHINSKY DAVID Y ADOLFO", "nota": "N/C POR DESCUENTO", "importe": 95788.8, "recupero": 0.0}, {"fecha": "2026-10-07", "nc": "NC A 0050-00016541", "cliente": "RADIO PEYBO TV SACIFI", "nota": "ACUERDO COMERCIAL", "importe": 81164.26, "recupero": 0.0}, {"fecha": "2026-10-07", "nc": "NC A 0050-00016540", "cliente": "MUEB. CARLITOS DE C Y N STERZ", "nota": "N/C POR DESCUENTO", "importe": 2292539.07, "recupero": 0.0}, {"fecha": "2026-10-07", "nc": "NC A 0050-00016539", "cliente": "CAMISASSO JULIO CESAR", "nota": "N/C POR DESCUENTO", "importe": 213320.25, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016538", "cliente": "LA FABRICA MUEBLES S.R.L.", "nota": "N/C POR DESCUENTO", "importe": 133664.19, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016537", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 156629.27, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016536", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 394978.73, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016535", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 15662.93, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016534", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 266941.15, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016533", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 611750.02, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016532", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 30424.17, "recupero": 0.0}, {"fecha": "2026-10-06", "nc": "NC A 0050-00016531", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ACUERDO COMERCIAL", "importe": 49799.72, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016530", "cliente": "KIKE CAMERA ART PARA EL HOGAR", "nota": "ERROR DE FACTURACION DE CARGA", "importe": 89215.15, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016529", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ERROR DE FACTURACION DE CARGA", "importe": 202827.52, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016528", "cliente": "ROBERTO PICCA E HIJOS S.A.S.", "nota": "ERROR DE FACTURACION DE CARGA", "importe": 290943.32, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016527", "cliente": "MARIO GASTELU", "nota": "ERROR DE PEDIDO", "importe": 500028.5, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016526", "cliente": "FIRBANK MORALES S.A.S.", "nota": "ERROR DE CARGA", "importe": 505624.88, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016525", "cliente": "FAUSTO BRANDOLIN & CIA S.R.L.", "nota": "N/C POR DESCUENTO", "importe": 2888053.07, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016524", "cliente": "FERRO OSVALDO RICARDO", "nota": "N/C POR DESCUENTO", "importe": 1497463.34, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016523", "cliente": "GREES S.R.L.", "nota": "N/C POR DESCUENTO", "importe": 191664.93, "recupero": 0.0}, {"fecha": "2026-10-05", "nc": "NC A 0050-00016522", "cliente": "PARDO S.A.", "nota": "ACUERDO COMERCIAL", "importe": 1102519.2, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016521", "cliente": "MASTRI ELIANA MARIA", "nota": "N/C POR DESCUENTO", "importe": 19042.44, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016520", "cliente": "BRINATTI MARIO ALBERTO", "nota": "N/C POR DESCUENTO", "importe": 302672.84, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016519", "cliente": "SABELLA NICOLAS AGUSTIN", "nota": "N/C POR DESCUENTO", "importe": 177048.06, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016518", "cliente": "MASHALLA S.A.S", "nota": "N/C POR DESCUENTO", "importe": 62391.28, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016517", "cliente": "MARIANI ORNELLA", "nota": "N/C POR DESCUENTO", "importe": 603539.77, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016516", "cliente": "INFINITY SAS", "nota": "N/C POR DESCUENTO", "importe": 371014.11, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016515", "cliente": "ANDREOSE MUEBLES S.R.L", "nota": "N/C POR DESCUENTO", "importe": 173047.36, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016514", "cliente": "LA FABRICA MUEBLES S.R.L.", "nota": "N/C POR DESCUENTO", "importe": 334160.48, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016513", "cliente": "MUEB. CARLITOS DE C Y N STERZ", "nota": "N/C POR DESCUENTO", "importe": 1232842.76, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016512", "cliente": "COOP LTD DE PROVIS DE SERV ELECT OBRAS Y", "nota": "N/C POR DESCUENTO", "importe": 574918.14, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016511", "cliente": "SCHMIDT Y BAYER  S.R.L.", "nota": "N/C POR DESCUENTO", "importe": 910368.73, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016510", "cliente": "MUEB. CARLITOS DE C Y N STERZ", "nota": "N/C POR DESCUENTO", "importe": 988512.25, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016509", "cliente": "PENNESI DANIEL HERNAN", "nota": "N/C POR DESCUENTO", "importe": 166245.6, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016508", "cliente": "MORALES MANUEL ALFREDO", "nota": "N/C POR DESCUENTO", "importe": 219611.22, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016507", "cliente": "BENITEZ MATIAS", "nota": "N/C POR DESCUENTO", "importe": 238709.55, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016506", "cliente": "TELECO HOGAR SACIFA", "nota": "N/C POR DESCUENTO", "importe": 79767.77, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016505", "cliente": "ANGELONI S.CAP I SECC IV", "nota": "N/C POR DESCUENTO", "importe": 188969.13, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016504", "cliente": "COULCHINSKY DAVID Y ADOLFO", "nota": "N/C POR DESCUENTO", "importe": 56854.08, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016503", "cliente": "NICOLETTI HUGO", "nota": "N/C POR DESCUENTO", "importe": 924159.56, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016502", "cliente": "LA PAMPA HOGAR S.H", "nota": "N/C POR DESCUENTO", "importe": 294334.09, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016501", "cliente": "SAAL ANIBAL MARCOS", "nota": "N/C POR DESCUENTO", "importe": 119440.05, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016500", "cliente": "FUSSINATO MARIO ANDRES", "nota": "N/C POR DESCUENTO", "importe": 72538.31, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016499", "cliente": "GUTIERREZ LUCAS DAVID", "nota": "ERROR DE PEDIDO", "importe": 192183.6, "recupero": 0.0}, {"fecha": "2026-10-02", "nc": "NC A 0050-00016498", "cliente": "MAXIMUEBLES S.R.L.", "nota": "ERROR DE CARGA", "importe": 148957.1, "recupero": 0.0}];
