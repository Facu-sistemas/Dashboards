/**
 * Glosario de los tabs "(test)" de Finanzas (réplicas de la planilla de rentabilidad armadas desde Odoo): un texto por dato,
 * que se muestra al pasar el mouse por encabezados y KPIs. Cada texto dice de dónde sale el dato (modelo/campo de Odoo o
 * pestaña/celda de la planilla) y la fórmula. Editar acá.
 */
export const GLOSARIO_TEST = {
  // --- Comunes ---
  planilla:
    'Planilla de rentabilidad (Google Sheets, solo lectura). Es la referencia: se compara fila por fila con lo que se arma desde Odoo. Se lee con el export CSV público, por eso los números llegan redondeados como se ven en la celda.',
  estado:
    'Resultado de comparar la fila armada desde Odoo con la fila de la planilla (se cruzan por código de barras).\n• coincide: todos los campos iguales (con tolerancia de redondeo).\n• difiere: algún campo es distinto; en ámbar se ve el valor de Odoo y debajo lo que dice la planilla.\n• solo Odoo: el producto existe en Odoo y la planilla todavía no lo tiene.',

  // --- Costos ---
  kpiEnOdoo: 'Productos activos de Odoo con código de barras (product.product), sin las categorías que la planilla no lista: PI (salvo Block Espuma), Financiero, Garantía y Materiales consumibles.',
  kpiEnPlanilla: 'Filas de la pestaña "Costos" de la planilla.',
  kpiCoinciden: 'Productos que están en Odoo y en la planilla con todos los campos iguales.',
  kpiDifieren: 'Productos que están en las dos fuentes pero con algún campo distinto. Es lo que hay que revisar: o Odoo cambió desde que se armó la planilla, o la planilla tiene un dato cargado a mano.',
  kpiSoloOdoo: 'Productos de Odoo que la planilla no tiene (productos nuevos, o que la exportación de la planilla no incluyó).',
  kpiSoloPlanilla: 'Productos que la planilla lista pero Odoo ya no devuelve (archivados, sin código de barras o con otro código).',
  codigo: 'Odoo: product.product.barcode (código de barras de la variante). Planilla: columna "Código de barras".',
  nombre: 'Odoo: product.product.name. Se compara sin tildes ni símbolos (Odoo escribe "AERO- RINCONERO" y la planilla "AERO RINCONERO").',
  costo:
    'Costo unitario del producto.\nOdoo: product.product.standard_price leído en la compañía 1 "Frontera Living S.A" (el costo es por compañía; la planilla usa esa). Es el costo VIGENTE, no el histórico.\nNo incluye la tela de los sillones: la tela se suma aparte en "Costos productos".',
  categoria: 'Odoo: product.product.categ_id → complete_name (ej. "Sillon / Lean"). Hay dos categorías escritas sin espacios ("Sillon/Bonificacion", "Colchones/bonificacion"): se comparan sin espacios.',
  volumen: 'm³ por unidad.\nOdoo: product.product.volume. Se usa para el costo de entrega (volumen × valor del m³ de la región × cantidad).',
  patas:
    'Cantidad de patas.\nOdoo: product.product.x_studio_cantidad_patas.\nEn la planilla es un dato cargado a mano (35 sillones) y en Odoo está cargado en otros productos (bases): por eso casi siempre difiere. No entra en ningún cálculo de costo.',
  largoTela: 'Metros de tela que lleva el modelo.\nOdoo: product.product.cloth_length ("Largo de tela"). Con esto se calcula la tela de un sillón: largo × precio por metro de la tela.',
  precioVenta:
    'Precio de lista.\nOdoo: product.product.lst_price.\nOjo: las variantes con tela suelen tener precio de lista 1 (placeholder); el precio real está en el modelo base, y "Costos productos" lo toma de ahí.',

  // --- Costos productos ---
  cpCodigo: 'Odoo: product.product.barcode. El "código base" del modelo es el código cortado antes de "MP" (ej. 0089R24STDRMP04… → 0089R24STDR).',
  cpProducto: 'Nombre del producto sin la parte de tela y pata: lo que está antes del primer " - " del nombre de Odoo (salvo productos "SUMA", que van enteros).',
  cpTelaPata: 'Lo que viene después del primer " - " en el nombre de Odoo: "TELA - PATA". Ej.: "SHOT LATTE - MADRID APLIQUE LUSTRE WENGUE".',
  cpGrupoTela:
    'Grupo de la tela (2, 3 o 4).\nNo está en Odoo: sale de la pestaña "Grupos de telas" de la planilla, por nombre de tela (Grupo 2 = no se vende, 3 = ~9% de las ventas, 4 = el resto). Define el sobreprecio del precio de venta: Grupo 3 × 1,09, Grupo 4 × 1,09².',
  cpPrecioTela:
    'Precio por metro de la tela.\nModo Planilla: pestaña "Grupos de telas" (columna Costo, que viene de "Telas").\nModo Odoo: standard_price del producto de la categoría "Materia Prima / Tela Living" cuyo código está dentro del de la variante (ej. …MP04C40043… → MP04C40043).',
  cpCostoMp: 'Costo de la variante sin la tela.\nOdoo: product.product.standard_price (compañía 1). Igual a la columna "Costo" de la pestaña Costos.',
  cpTela:
    'Costo de la tela del sillón = Largo de tela del modelo (cloth_length del producto base) × Precio de la tela.\nColchones: 0 (no llevan tela). Accesorios: usa los primeros 9 caracteres del código como modelo.\nSi la tela no tiene precio queda en vacío y la fila avisa.',
  cpCostoTotalMp: 'Costo total de materia prima = Costo MP + Tela.',
  cpTiempo:
    'Tiempo de línea en horas (lo que tarda producir una unidad).\nModo Odoo: sillones → product.product.x_studio_tiempo_estimado (si la variante lo tiene en 0, el del modelo base); colchones → pestaña "Tiempos colchones" de la planilla según categoría, grupo de medida (por ancho: ≤120 Grupo 1, 130-150 Grupo 2, ≥160 Grupo 3) y detalle (Olimpo, Remallado, Manija/aireador, cuna).\nModo Planilla: el de la propia fila de la planilla (mano de obra ÷ valor hora), para comprobar que las fórmulas reproducen la hoja.\nSin mano de obra: Reventa, Bonificación, Scrap, Materia Prima, Servicio, Financiero y Garantía.',
  cpMod: 'Mano de obra directa por unidad = Tiempo de línea × valor hora productivo.\nValor hora: no está en Odoo; es el parámetro "Productivo" de la pestaña "VALOR HORA" de la planilla (celda U2).',
  cpModInd: 'Mano de obra directa + indirecta por unidad.\nColchones: = Mano de obra directa.\nResto: × 1,55 (coeficiente de indirecta de la planilla; editable en rentabilidad_parametros_costeo).',
  cpNoProductiva:
    'Mano de obra no productiva por unidad = Pozo no productivo del rubro ÷ Capacidad mensual del producto.\nPozo (pestaña "VALOR HORA" de la planilla, celdas U6 colchones / U7 sillones): sueldos del personal no productivo del mes, repartidos entre colchones y sillones.\nCapacidad mensual: sillones = (minutos diarios ÷ 60 × 5 líneas) × días hábiles × 7 ÷ tiempo de línea; colchones = días hábiles × 8:08 hs × operarios ÷ tiempo de línea (constantes de la pestaña "Capacidad living").',
  cpFijos:
    'Costos fijos por unidad = Pozo de costos fijos del rubro ÷ Capacidad mensual del producto.\nPozo: no está en Odoo; son números cargados a mano en la planilla (pestaña "COSTOS PRODUCTOS", celdas Z1 sillones / AB1 colchones). La capacidad se calcula igual que en no productiva.',
  cpCostoContribucion: 'Costo para contribución = Costo total de MP + Mano de obra directa e indirecta. No incluye no productiva ni fijos.',
  cpCostoTotal: 'Costo total = Costo total de MP + MOD e indirecta + No productiva + Fijos.',
  cpPrecioVenta:
    'Precio de venta de referencia.\nOdoo: product.product.lst_price del modelo base (accesorios Deliveries: el del propio producto). Grupo de tela 3 → × 1,09; Grupo 4 → × 1,09².\nQueda en blanco si el código no tiene modelo base (materias primas), igual que la planilla.',
  cpContribucion: '% de contribución = (Precio de venta − Costo para contribución) ÷ Precio de venta.',
  cpRentabilidad: '% de rentabilidad = (Precio de venta − Costo total) ÷ Precio de venta.',
  cpRentabilidadPesos: 'Rentabilidad en $ = Precio de venta × % de rentabilidad (por unidad).',
  cpUnidadEq: 'Unidad equivalente = Tiempo de línea ÷ 4,0667 hs (un sillón "estándar"). Colchones y productos sin mano de obra: vacío (cuenta 1 por unidad).',
  cpFuente:
    'De dónde se toman los datos que NO son fijos en Odoo:\n• Planilla (valida las fórmulas): usa el tiempo de línea y los precios de tela de la planilla; si el resultado no coincide con la hoja, el problema es de fórmula.\n• Odoo (dinámico): usa el tiempo de Odoo / hoja de tiempos de colchones y el precio de la tela de Odoo; las diferencias que aparecen son datos que cambiaron en Odoo desde que se armó la planilla.',
  cpParametros:
    'Parámetros que no están en Odoo y que se leen EN VIVO de la planilla: valor hora y pozos de no productiva (pestaña VALOR HORA), pozos de costos fijos (COSTOS PRODUCTOS Z1/AB1) y constantes de capacidad (Capacidad living). Si cambian en la planilla, se actualizan acá en 5 minutos.',

  // --- Facturación productos ---
  faPeriodo: 'Mes de facturación a armar. Los meses que ofrece son los que tiene la planilla (así se puede comparar); Odoo permite cualquier mes.',
  faKpiLineas: 'Líneas de factura de cliente posteadas del mes (account.move.line de out_invoice y out_refund, ambas compañías), sin las categorías Financiero, Garantía, Materia Prima y PI suelta (la planilla no las incluye).',
  faKpiSubtotal: 'Suma del subtotal sin IVA de las líneas, con las notas de crédito restando (account.move.line.price_subtotal; las N/C van con signo negativo, igual que la planilla).',
  faKpiContribucion: 'Contribución $ = Σ (Monto s/flete − (Costo MP + Costo MOD e indirecta) × cantidad). % = contribución ÷ Monto s/flete.',
  faKpiRentabilidad: 'Rentabilidad $ = Σ (Subtotal − Costo total). Costo total = Costo CMV + Costo de entrega + Costo financiero. % = rentabilidad ÷ Subtotal.',
  faKpiCoinciden: 'Líneas de Odoo que se encontraron en la planilla (se cruzan por fecha, código de barras, subtotal y cantidad) y cuyos números coinciden.',
  faKpiDifieren: 'Líneas que están en las dos fuentes pero con algún número distinto: casi siempre es un costo que cambió en Odoo desde que se armó la planilla, o un plazo de pago distinto.',
  faKpiSoloOdoo: 'Líneas de Odoo que no están en la planilla (facturas cargadas o modificadas después de que se armó la planilla).',
  faKpiSoloPlanilla: 'Líneas de la planilla que Odoo no devuelve hoy (facturas anuladas o modificadas después).',
  faKpiSinCosto: 'Líneas a las que no se les pudo calcular el costo completo (producto sin tiempo de línea, sin precio de tela, archivado o sin código). Se muestran con "—" y un ⚠: no se inventa el dato.',
  faFecha: 'Odoo: account.move.line.invoice_date (fecha de la factura).',
  faContacto: 'Odoo: account.move.line.partner_id (el contacto de la factura).',
  faCodigo: 'Odoo: product.product.barcode del producto de la línea.',
  faProducto: 'Odoo: product.product.name del producto de la línea (incluye " - tela - pata" en los sillones).',
  faSubtotal: 'Odoo: account.move.line.price_subtotal (sin IVA), con el recargo regional adentro. Las notas de crédito (out_refund) van con signo negativo, y su cantidad también.',
  faCantidad: 'Odoo: account.move.line.quantity. Negativa en notas de crédito.',
  faTicket: 'Ticket = Subtotal ÷ Cantidad (precio unitario facturado).',
  faCategoria: 'Odoo: product.product.categ_id → complete_name.',
  faGrupoTela: 'Grupo de la tela del producto (2, 3 o 4). Sale de la pestaña "Grupos de telas" de la planilla (no está en Odoo), el mismo que usa "Costos productos".',
  faVolumen: 'm³ por unidad. Odoo: product.product.volume.',
  faRecargoPct:
    '% de recargo regional del cliente.\nOdoo: res.partner.region_id del cliente comercial (ej. "COSTA BS AS - 12,5%" = 12,5%). Es 0 en Bonificación y PI / Block Espuma. Si el cliente no tiene región cargada, queda en 0 y la fila avisa.',
  faRecargo: '$ Recargo = % recargo × Subtotal ÷ (1 + % recargo). El recargo viene incluido dentro del subtotal facturado.',
  faCostoEntrega:
    'Costo de entrega estimado (no es el flete real).\nFórmula: Volumen × Valor del m³ de la región × Cantidad; 0 si el subtotal es negativo. Valor del m³ = km de la región × 2 (ida y vuelta) × $19,22 por m³ y km (1730 ÷ 90). Km por recargo: 5% = 400, 8,75% = 650, 12,5% = 1100, 16,2% = 1450, 20% = 1700, resto = 2200. Constantes de la planilla.',
  faMontoSinFlete: 'Monto s/flete = Subtotal − $ Recargo (= Subtotal ÷ (1 + % recargo)). Es la base de la contribución.',
  faTicketSinFlete: 'Ticket s/flete = Monto s/flete ÷ Cantidad.',
  faCostoMp: 'Costo de materia prima por unidad (con tela). Es el "Costo total MP" de Costos productos (test): standard_price de Odoo + largo de tela × precio de la tela.',
  faCostoMod: 'Mano de obra directa e indirecta por unidad. Es "MOD + indirecta" de Costos productos (test). 0 en Reventa, Bonificación, Scrap, Materia Prima, Servicio, Financiero y Garantía.',
  faCostoNoProd: 'Mano de obra no productiva por unidad. Es "MO no productiva" de Costos productos (test): pozo no productivo de la planilla ÷ capacidad mensual del producto.',
  faCostosFijos: 'Costos fijos por unidad. Es "Costos fijos" de Costos productos (test): pozo de fijos de la planilla ÷ capacidad mensual del producto.',
  faCostoUn: 'Costo por unidad = Costo MP + MOD e indirecta + No productiva + Fijos.',
  faCmv: 'Costo CMV = Costo por unidad × Cantidad. Es un costo estándar teórico, no el costo contable de Odoo.',
  faCostoContrib: 'Costo para contribución = (Costo MP + MOD e indirecta) × Cantidad. No incluye no productiva, fijos, entrega ni financiero.',
  faPctCf:
    '% de costo financiero = plazo de pago del cliente (días) × 0,0993% por día (tasa 29% anual ÷ 365 + 25% de incobrabilidad). 0 en Bonificación.\nEl plazo no está en Odoo: sale de la pestaña "Plazo de pago mes" de la planilla (promedio real del mes por cliente) y, si el cliente no está, del plazo estático de "Costo financiero/flete".',
  faCf: '$ Costo financiero = Subtotal × % costo financiero (se calcula sobre el subtotal CON recargo).',
  faCostoTotal: 'Costo total del producto = $ Costo financiero + Costo CMV + Costo de entrega.',
  faPctContrib: '% Contribución = $ Contribución ÷ Monto s/flete.',
  faContrib: '$ Contribución = Monto s/flete − Costo para contribución.',
  faPctRent: '% Rentabilidad = $ Rentabilidad ÷ Subtotal.',
  faRent: '$ Rentabilidad = Subtotal − Costo total del producto.',
  faUnidadEq: 'Unidad equivalente = (Tiempo de línea ÷ 4,0667 hs) × Cantidad; colchones: 1 por unidad. Vacío si el producto no tiene tiempo de línea.',
  faCategoriaTabla: 'Comparación por categoría: lo armado desde Odoo contra lo que dice la planilla en el mismo mes. La diferencia (Odoo − planilla) viene sobre todo de facturas cargadas o modificadas después de que se armó la planilla, y de costos que cambiaron en Odoo.',
} as const;

export type ClaveGlosarioTest = keyof typeof GLOSARIO_TEST;
