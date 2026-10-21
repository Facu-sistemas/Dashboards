# Lógica de costeo / contribución en los Excel (para reproducir desde Odoo)

Fuente analizada (solo lectura), carpeta `Frontera-Living\adaptame`:

- `RENTABILIDAD DE PRODUCTOS SEPTIEMBRE 2026.xlsx` (SEP): único archivo con **fórmulas vivas**. Es la plantilla de costeo de un mes.
- `BASE DE DATOS RENTABILIDAD CLIENTES (5).xlsx` (BD-CLI): hoja `RESUMEN CLIENTES` (27.573 filas) = apilado de las hojas mensuales OCT 2025 … OCT 2026. Todo es **valor pegado** (las hojas mensuales eran `IMPORTRANGE` de Google Sheets; el Excel guarda solo el valor cacheado).
- `BASE DE DATOS RENTABILIDAD PRODUCTOS (7).xlsx` (BD-PROD): hoja `RESUMEN PRODUCTOS` (55.145 filas) = apilado mensual de la hoja `COSTOS PRODUCTOS`, también valores pegados.

Campos esperados por la app: `adaptame/src/lib/import-schemas.ts` (`CLIENTES_FIELDS`, `PRODUCTOS_FIELDS`).

Verificación hecha: reconstruí todas las columnas de `Facturación productos` de septiembre con las fórmulas de abajo y cuadran al centavo (diferencia máx. < 0,01 salvo una fila anómala, ver sección 5). Septiembre de BD-CLI es idéntico a la hoja de SEP (subtotal 2.909.488.042,02; contribución 1.227.274.583,40).

---

## 1) Hojas y columnas

### 1.1 Hojas del libro SEP

| Hoja | Rol | Origen de los datos |
|---|---|---|
| `Facturación productos` (2.786 filas sept.) | **Una fila por línea de factura**. Cols A-F son datos crudos de Odoo; G-AG son fórmulas. Es lo que alimenta `RESUMEN CLIENTES`. | A-F pegadas desde Odoo (account.move.line) |
| `Costos` (4.750 filas) | Export de productos Odoo: Código de barras, Nombre, Costo, Categoría del producto, Volumen, Cantidad de patas, Largo de tela, Precio de venta. | Pegado desde Odoo (product.product) |
| `COSTOS PRODUCTOS` (4.738 filas) | **Costo unitario por producto** (MP, tela, tiempo, MOD, MOD+ind., no productiva, fijos, precio, contribución, rentabilidad, unidad eq.). Es lo que alimenta `RESUMEN PRODUCTOS`. Z1 y AB1 = pozos de costo fijo (valores pegados). | Fórmulas sobre `Costos`, `Capacidad living`, `VALOR HORA`, `Grupos de telas` |
| `Capacidad living` (1.169 filas) | Tiempo estimado (hs) por producto base, capacidad mensual, **Unidad eq**. Constantes: H2=488 min diarios, H3=20 días hábiles, H4=19 operarios colchones, H5=244/60 hs equivalentes, I1=11563,29. | **Pegado a mano** (tiempos estudiados) |
| `Tiempos colchones` / `Colchones capacidad` | Tiempo (min) de colchones/bases/espumas por categoría + grupo de medida (+ detalle p.ej. "Olimpo"). | **Pegado a mano** |
| `VALOR HORA` | Nómina por persona (Google Sheet externo, `IMPORTRANGE`): Total, cargas sociales, feriados 6,5%, vacaciones, aguinaldo 8,33%, ausentismo 4,2%, ineficiencia 10%, "Final", "C/incentivo". Resumen en T:U. | **Externo (Google Sheet RRHH)** |
| `Costo financieroflete` (3.931 filas) | Tabla por cliente: Región-recargo, plazo de pago, % costo financiero, recargo %, valor m3, km. Constantes: tasa anual 29%, tasa diaria+incobrabilidad, precio m3 x km. | Pegado/derivado a mano |
| `Plazo de pago mes` (430 filas) | Plazo de pago promedio real del mes por contacto (días). | **Externo/derivado** (probable cálculo sobre cobranzas) |
| `Hoja 30` | Tabla vieja de recargos/valor m3 y plazos (PPP+PRP). Referencia, no se usa en fórmulas actuales. | Histórico |
| `Grupos de telas`, `Telas`, `Patas` | Precio $/m de cada tela y su grupo (por "% de venta"). `Patas` oculta, sin uso. | **Pegado a mano** |
| `CONTRIBUCION` | Resumen por categoría (costo, contribución, rentabilidad, flete, facturación, ticket). Solo reporte. | Fórmulas SUMIFS sobre Facturación |
| `Calculador de precio`, `COLCHONES` (oculta) | Herramientas auxiliares (precio = costos × 1,15 rentabilidad × 1,11 financiero). No intervienen en el costeo. | — |

### 1.2 Columnas de `Facturación productos` (= `RESUMEN CLIENTES`, +col. "Mes" al inicio en la BD)

| Col | Campo | Tipo |
|---|---|---|
| A | Fecha de factura | dato Odoo |
| B | Contacto | dato Odoo |
| C | Producto/Código de barras | dato Odoo |
| D | Producto (nombre, incluye " - variante/tela") | dato Odoo |
| E | Subtotal | dato Odoo |
| F | Cantidad de producto | dato Odoo |
| G | Ticket | fórmula |
| H | Producto s/opcional | fórmula |
| I | Categoría | fórmula (lookup) |
| J | Grupo tela | fórmula (lookup) |
| K | Producto + grupo de tela | fórmula |
| L | Volumen | lookup |
| M | % Recargo | lookup |
| N | $ Recargo | fórmula |
| O | Costo entrega | fórmula |
| P | Monto s/flete | fórmula |
| Q | Ticket s/flete | fórmula |
| R | Costo MP | lookup |
| S | Costo MOD+Indirecta | lookup |
| T | Costo MO no productiva | lookup |
| U | Costos fijos | lookup |
| V | Costo x Un. | fórmula |
| W | Costo CMV | fórmula |
| X | Costo para contribución | fórmula |
| Y | Costo para contribución (solo MP) | fórmula |
| Z | % costo financiero | lookup |
| AA | $ Costo financiero | fórmula |
| AB | Costo total producto | fórmula |
| AC | % Contribución | fórmula |
| AD | $ Contribución | fórmula |
| AE | % Rentabilidad | fórmula |
| AF | $ Rentabilidad | fórmula |
| AG | Unidad Eq. | lookup × cantidad |

La columna "Mes" de `RESUMEN CLIENTES` es la propia fecha de factura (en BD-CLI `Mes` = `Fecha de factura` salvo 4 filas con fecha rota 1900-01). Hay 6 filas sin código, 3 sin nombre, y muchas con `#N/A` en Unidad Eq. (7.584 de 27.573).

### 1.3 Columnas de `COSTOS PRODUCTOS` (= `RESUMEN PRODUCTOS`, +col. "MES")

A Código de barras, B Nombre, C PRODUCTO, D DESCRIPCION TELA+PATA, E DESCRIPCION PATA, F DESCRIPCION TELA, G GRUPO TELA, H CATEGORÍA, I PRECIO TELA, J COSTO MATERIA PRIMA, K TELA, L COSTO TOTAL MP, M TIEMPO DE LINEA, N COSTO MOD, O COSTO MOD+IND, P COSTO MO NO PRODUCTIVA, Q COSTOS FIJOS, R COSTO TOTAL PARA CONTRIBUCIÓN, S COSTO TOTAL, T PRECIO DE VENTA, U CONTRIBUCION, V RENTABILIDAD, W RENTABILIDAD EN $, X Unidad Eq. Z1/AB1 = pozos fijos.

---

## 2) Fórmulas por columna con sus precedentes

Nomenclatura: `FP!X` = hoja `Facturación productos` col X. `CP!X` = `COSTOS PRODUCTOS`. `CL!` = `Capacidad living`. `CFF!` = `Costo financieroflete`.
"Excluidas" = categorías cuyo texto contiene **Reventa, Bonificacion, Scrap, Materia Prima, Servicio, Financiero, Garantia** (COUNTIF con comodines, no distingue mayúsculas).

### 2.1 Capa de factura (`Facturación productos`)

```
G  Ticket            = E/F
H  Producto s/opcional = si D no contiene "SUMA": parte de D antes de " - " (si no hay " - ", D entero); si contiene "SUMA": D entero
I  Categoría         = Costos!D  (por código de barras C)            -> p.ej. "Sillon / Lean", "Colchones / Espuma"
J  Grupo tela        = busca en CP!D:G el texto que sigue a " - " en D (descripción tela+pata) -> CP!G (Grupo 2/3/4); "" si no hay
K  Producto+grupo    = J="" ? H : H & " " & J
L  Volumen (m3)     = Costos!E
M  % Recargo         = (I contiene "Bonificacion" o "PI / Block Espuma") ? 0 : CFF!F  (por Contacto B)   [F = % extraído de "REGION - X%"]
N  $ Recargo         = M*E/(M+1)                   (el recargo viene incluido dentro del subtotal facturado)
O  Costo entrega     = (E<0) ? 0 : L * CFF!G(valor m3 del cliente) * F
P  Monto s/flete     = E - N                       (= E/(1+M))
Q  Ticket s/flete    = P/F
R  Costo MP          = CP!L  (costo total MP unitario)
S  Costo MOD+Ind.    = excluida ? 0 : CP!O
T  Costo MO no prod. = excluida ? 0 : CP!P
U  Costos fijos      = CP!Q                         (queda "" en excluidas)
V  Costo x Un.       = R+S+T+U                      (SUM(R:U))
W  Costo CMV         = V*F
X  Costo p/contrib.  = (R+S)*F                      <- OJO: solo MP + MOD+indirecta, SIN no productiva ni fijos
Y  Costo p/contrib. (solo MP) = R*F
Z  % costo financiero = (I contiene "Bonificacion") ? 0 : CFF!D   (por Contacto)
AA $ costo financiero = E*Z                         (sobre el SUBTOTAL, no sobre monto s/flete)
AB Costo total producto = AA + W + O                (costo fin. + CMV + costo de entrega)
AC % Contribución    = (P - X)/P
AD $ Contribución    = AC*P   (= P - X)
AE % Rentabilidad    = (E - AB)/E
AF $ Rentabilidad    = AE*E   (= E - AB)
AG Unidad Eq.        = (CP!X vacío ? 1 : CP!X) * F   ; "#N/A" si el producto no existe en Capacidad living (colchones: el valor es "" => 1*F)
```

Resumen conceptual:

- **Contribución $ = Monto s/flete − (Costo MP + Costo MOD+indirecta) × cantidad.** No resta no-productiva, fijos, flete ni costo financiero.
- **Rentabilidad $ = Subtotal − (CMV + Costo de entrega + Costo financiero)**, con CMV = (MP + MOD+ind + no prod + fijos) × cantidad.
- La hoja `CONTRIBUCION` usa otra definición agregada: contribución % = `1 − ΣY/ΣP` (solo MP). No confundir con `% Contribución` por fila (AC).
- `AH1` de la hoja = `ΣAF/ΣE` = rentabilidad global del mes (0,2104 en sept.).

### 2.2 Capa de producto (`COSTOS PRODUCTOS`), por fila (código de barras A)

```
C  PRODUCTO = nombre B sin sufijo " - ..." (salvo que contenga "SUMA")
D  DESC. TELA+PATA = texto tras " - " en B ("" si SUMA o no hay)
E  DESC. PATA  = texto tras el primer " - " dentro de D
F  DESC. TELA  = texto de D antes de " - " (o D entero)
G  GRUPO TELA  = 'Grupos de telas'!D por nombre de tela F   (Grupo 2 si "% venta"=0, Grupo 3 si 0,09, si no Grupo 4)
H  CATEGORÍA   = Costos!D
I  PRECIO TELA = 'Grupos de telas'!C (= Telas!B, $/metro) por F ; 0 si no hay
J  COSTO MATERIA PRIMA = Costos!C (costo de la variante/producto)       -> standard_price
K  TELA  = Colchones ? 0 : (Sillon / Accesorio ? Costos!G[LEFT(A,9)]*I : Costos!G[base]*I)
           donde base = A cortado antes de "MP" (código base del modelo) y Costos!G = "Largo de tela" (metros)
L  COSTO TOTAL MP = J + K
M  TIEMPO DE LINEA (hs) = excluida ? "" : CL!C[base]  ("Tiempo estimado (hs)"; para 'Sillon / Deliveries' se busca el código completo A)
N  COSTO MOD = M * 'VALOR HORA'!U2                    (U2 = valor hora productivo)
O  COSTO MOD+IND = Colchones ? N : N*1,55             (coeficiente 1,55 SOLO para sillones/otros no-colchón)
P  COSTO MO NO PRODUCTIVA = excluida ? "" : (Deliveries ? U7 / CL!D[A] : Sillon ? U7 / CL!D[base] : U6 / CL!D[base])
        U7 = pozo no productivo asignado a Sillones ; U6 = pozo asignado a Colchones ; CL!D = capacidad mensual (unidades) del producto
Q  COSTOS FIJOS = excluida ? "" : (Deliveries ? Z1 / CL!D[A] : Sillon ? Z1 / CL!D[base] : AB1 / CL!D[base])
        Z1 = costo fijo sillones (pegado) ; AB1 = costo fijo colchones (pegado)
R  COSTO TOTAL P/CONTRIB. = L + O
S  COSTO TOTAL = L + O + P + Q
T  PRECIO DE VENTA = Deliveries ? Costos!H[A] : Costos!H[base] * (Grupo 3 ? 1,09 : Grupo 4 ? 1,09*1,09 : 1)
U  CONTRIBUCION = (T - R)/T
V  RENTABILIDAD = (T - S)/T
W  RENTABILIDAD EN $ = T*V
X  Unidad Eq. = CL!F[base]  (Unidad eq = tiempo estimado hs / 4,0667 hs)
```

### 2.3 Capacidad (`Capacidad living`)

```
Sillones/otros (filas por código base):
  C  tiempo estimado (hs)                          [pegado a mano]
  E  capacidad por línea por día = (H2/60*5) / C   con H2 = 488 min  => 40,667 hs-línea/día
  D  capacidad por mes = E * H3 * 7                con H3 = 20 días   => 5.693,33 / C   (unidades/mes)
  F  Unidad eq = C / H5                            con H5 = 244/60 = 4,0667 hs
Colchones/bases/espumas (filas ~526+):
  C  tiempo (días-fracción? en realidad horas: 20 min = 0,3333 hs)   [viene de 'Tiempos colchones' / 'Colchones capacidad']
  D  capacidad por mes = H3 * (8:08 hs) * H4 / C   con H4 = 19 operarios  => 3.090,67 / C
  F  (vacío) => Unidad Eq. = 1 por unidad
```

(En la práctica, `Capacidad por mes` cuadra con: sillón 5.693,33/C ; colchón 3.090,67/C. Confirmado numéricamente, desvío < 0,02 sobre 2.879 productos sillón y 427 espumas.)

### 2.4 Tarifas del mes (`VALOR HORA`, hoja externa)

```
Valor hora "final c/incentivo" de cada persona (col S) = costo mensual total / ... (ver RRHH; incluye cargas, feriados 6,5%, vac., aguinaldo 8,33%, ausentismo 4,2%, ineficiencia 10% e incentivo)
U10  pozo productivo   = Σ(S de personas PRODUCTIVO) * 184,8 hs/mes                (316.242.074,9 sept.)
U2   valor hora prod.  = U10 / (nº productivos * 184,8)  = promedio simple de S   (20.869,1054 sept.)
U5   pozo no productivo = Σ(S de NO PRODUCTIVO) * 184,8                           (215.159.234,0 sept.; 41 personas)
U3   valor hora no prod = promedio de S no productivos                            (28.397,11)
U6   no productivo asignado a COLCHONES = 135.550.317,4   (63,0% de U5)
U7   no productivo asignado a SILLONES  =  79.608.916,6   (37,0% de U5)
```

Reproducción verificada: 82 productivos × 184,8 hs × 20.869,1054 = 316.242.074,9 y 41 no productivos × 184,8 × 28.397,11 = 215.159.234. **No se pudo deducir el criterio de reparto 63/37 de U5 entre colchones y sillones** (posiblemente columnas Y/Z de la hoja externa; ver huecos).

### 2.5 Costo financiero y flete (`Costo financieroflete`)

```
Región/recargo del cliente: texto "REGION - X%" (ej. "CORDOBA - 5%", "COSTA BS AS - 12,5%", "PARTICULARES - 25%")
  E = texto antes del guión (región)
  F = X/100 (% recargo; valores: 0, 0,05, 0,0875, 0,125, 0,162, 0,20, 0,25)
  H (KM de referencia) = F=0:0 ; 0,05:400 ; 0,0875:650 ; 0,125:1100 ; 0,162:1450 ; 0,20:1700 ; otro (0,25):2200
  G (valor del m3) = H * 2 * K10 ;  K10 = 1730/90 = 19,2222 ($ por m3 por km, ida y vuelta)
        -> 0,05: 15.377,78 ; 0,0875: 24.988,89 ; 0,125: 42.288,89 ; 0,25: 84.577,78 (aprox.)
  C = plazo de pago estático del cliente (días)
  I = plazo mensual = 'Plazo de pago mes'!C del contacto si existe, si no C
  D = % costo financiero = I * K9 ;  K9 = 0,29 / 365 * 1,25 = 0,000993151  (tasa anual 29% diaria + 25% de incobrabilidad)
```

`% Recargo` cliente y `Costo entrega` salen de la misma fila `CFF` del contacto. 95 de los 323 contactos de septiembre no están en `Plazo de pago mes` (se usa el plazo estático C).

---

## 3) Mapeo propuesto a Odoo

Certeza: **A** alta, **M** media, **B** baja.

### 3.1 Columnas base de la fila de factura

| Excel | Odoo | Cert. |
|---|---|---|
| A Fecha de factura | `account.move.invoice_date` (o `date`) de la línea | A |
| B Contacto | `account.move.partner_id` (name) | A |
| C Código de barras | `product.product.barcode` de `account.move.line.product_id` | A |
| D Producto | `product.product.display_name`/`name` (con atributos de variante: "SIRIUS SOFA 1/3 CPO (STD) - CUERO SILK / STIK #2") | M (formato exacto del nombre a validar; hay doble espacio en algunos) |
| E Subtotal | `account.move.line.price_subtotal` (sin IVA); las NC con signo negativo | A (validar si usan `balance` con signo) |
| F Cantidad | `account.move.line.quantity` (negativa en NC `out_refund`; el Excel tiene cantidad −1 y subtotal negativo) | M (validar signo en refunds) |
| G Ticket / Q Ticket s/flete | calculadas | A |
| I Categoría | `product.category.complete_name` del producto (texto "A / B", ej. `Sillon / Lean`). Ojo: existen valores sin espacios `Sillon/Bonificacion`, `Colchones/bonificacion` -> así están en Odoo | A |
| Categoría padre / sub | `split(" / ")` o `categ_id.parent_id` / `categ_id` | A |
| L Volumen | `product.product.volume` | A |
| Costos!C "Costo" | `product.product.standard_price` | M (podría ser el costo de BoM calculado; ver 5) |
| Costos!G "Largo de tela" y F "Cantidad de patas" | campos custom del producto (x_studio_*), consumo en metros de tela del modelo | M |
| Costos!H "Precio de venta" | `product.product.list_price` / `lst_price` | M |
| M % Recargo | proviene del texto "REGION - X%" del contacto. Probable: **tarifa/lista de precios** del partner (`property_product_pricelist.name`) o categoría/etiqueta (`category_id`). Buscar nombres "CORDOBA - 5%", etc. | B/M |
| Z % costo financiero | plazo de pago real del cliente (días) × 0,000993151. El plazo sale de `Plazo de pago mes` (externo). Alternativa Odoo: promedio ponderado de (fecha de pago − fecha de factura) en `account.partial.reconcile`/`account.payment`, o `property_payment_term_id` | B |

### 3.2 Costos (todos en el Excel salen de `COSTOS PRODUCTOS`, no de la factura)

| Concepto | Cómo reproducir en Odoo | Cert. |
|---|---|---|
| Costo MP unitario (R) | `standard_price` del producto (variante) + (metros de tela × precio $/m de la tela). La tela se suma aparte: `Largo de tela` del código base × precio tela. En Odoo equivale a la línea de tela de la **BoM** (`mrp.bom.line` de la tela) o `stock.move`/`product.supplierinfo` de la tela. | M (hay que decidir si `standard_price` ya incluye tela; el Excel la suma por separado y para colchones es 0) |
| Tiempo de línea (hs) (M) | `mrp.routing.workcenter.time_cycle` (operaciones de la BoM) sumado, o `mrp.workorder.duration_expected`; hoy es dato **pegado a mano** (`Capacidad living`!C, `Tiempos colchones`) | B |
| Valor hora productivo (U2) | promedio del costo hora de empleados productivos: `hr.employee`/`hr.contract` wage + cargas, o `hr.payslip` (ver memoria "Incentivos en nómina" por tema nómina) ÷ 184,8 hs. Hoy viene de Google Sheet externo | B |
| Costo MOD (N) | `tiempo_hs × valor_hora_productivo` | A (fórmula) |
| MOD+Indirecta (O) | colchones: = MOD; resto: MOD × 1,55 (coeficiente fijo) | A |
| MO no productiva (P) | pozo mensual no productivo (sueldos de personas NO PRODUCTIVO × 184,8 hs, repartido colchones/sillones) ÷ capacidad mensual del producto (`5.693,33/tiempo` sillones; `3.090,67/tiempo` colchones). En Odoo: sueldos por departamento (`hr.department`) de áreas no productivas, o líneas analíticas de esos costos | B |
| Costos fijos (Q) | pozo mensual fijo (sillones 102.382.411,51; colchones 79.590.158,85, **constantes ene-sep 2026**) ÷ capacidad mensual del producto. En Odoo: cuentas de gasto fijo / líneas analíticas por cuenta analítica Colchones/Sillones; hoy **pegado a mano** | B |
| Costo entrega (O) | `volumen × km_región × 2 × 19,2222 × cantidad` (0 si subtotal<0 o categoría Bonificación/PI-Block Espuma recargo 0). No es flete real, es estimación por región | M (fórmula A; región B) |
| Unidad Eq. (AG) | tiempo estimado ÷ 4,0667 hs × cantidad (sillones); colchones = cantidad; si no hay capacidad: `#N/A` | A para fórmula, B para tiempos |
| Costo financiero | `subtotal × plazo_días × 0,000993151` | A para fórmula |

Pozos y reparto 63/37 (U6/U7) y constantes de capacidad (488 min, 20 días, 5 líneas, ×7, 19 operarios, 184,8 hs): **no están en Odoo**, son parámetros del Excel.

---

## 4) Casos de prueba (septiembre 2026)

Verificados contra las fórmulas de la sección 2.

### Caso 1: Sillón con tela grupo 3 (fila 4 de `Facturación productos`)

- Contacto MAYER ROSA M. · código `0137S13STDRMP04C40116` · `SIRIUS SOFA 1/3 CPO (STD) - CUERO SILK / STIK #2` · fecha 2026-09-30.
- Subtotal 625.329,71 · cantidad 1 · ticket 625.329,71 · categoría `Sillon / Lean` · grupo tela `Grupo 3` · volumen 2,1.
- Cliente: región `COSTA BS AS - 12,5%` → % recargo 0,125 · plazo mensual 111,4 días.
- $ Recargo = 0,125×625.329,71/1,125 = **69.481,08** · Monto s/flete = **555.848,63**.
- Costo entrega = 2,1 × 42.288,89 × 1 = **88.806,67** (valor m3 = 1100 km×2×19,2222).
- Producto: `Costos` costo variante 123.510,48 + tela (9,12 m × 3.556 $/m = 32.430,72) = **Costo MP 155.941,20**. Tiempo línea 4,0667 hs → MOD = 4,0667×20.869,1054 = 84.867,70 → **MOD+Ind = ×1,55 = 131.544,93**. No productiva = 79.608.916,59 / 1.400 (capacidad = 5.693,33/4,0667) = **56.863,51**. Fijos = 102.382.411,51/1.400 = **73.130,29**.
- Costo x Un. = **417.479,93** · CMV = **417.479,93** · Costo p/contribución = (155.941,20+131.544,93) = **287.486,13** · solo MP = **155.941,20**.
- % costo financiero = 111,4 × 0,000993151 = **0,110637** · $ = 625.329,71×0,110637 = **69.184,59**.
- Costo total producto = 69.184,59 + 417.479,93 + 88.806,67 = **575.471,19**.
- % Contribución = (555.848,63 − 287.486,13)/555.848,63 = **0,482798** · $ Contribución = **268.362,50**.
- % Rentabilidad = (625.329,71 − 575.471,19)/625.329,71 = **0,079732** · $ Rentabilidad = **49.858,52** · Unidad Eq. = **1**.

### Caso 2: Espuma de cuna (colchón; fila 30)

- DIST. CONFORTAN S.A.C.I. · `EBABY65-97-9C` `ESPUMA CUNA 65X97X9` · subtotal 109.098,12 · cant. 3 · ticket 36.366,04 · `Colchones / Espuma` · volumen 0,06.
- Región `COSTA BS AS - 12,5%`, plazo 80,33 d → % recargo 0,125 · $ recargo **12.122,01** · monto s/flete **96.976,11**.
- Costo entrega = 0,06×42.288,89×3 = **7.612,00**.
- MP 13.129,13 (tela 0) · tiempo 0,19889 hs → MOD = **4.150,63** = MOD+Ind (colchón, sin ×1,55) · no productiva = 135.550.317,42/15.539,66 = **8.722,86** · fijos = 79.590.158,85/15.539,66 = **5.121,74**.
- Costo x Un. = **31.124,37** · CMV = **93.373,10** · p/contribución = (13.129,13+4.150,63)×3 = **51.839,29** · solo MP = **39.387,39**.
- % costo fin. = 80,33×0,000993151 = **0,079780** · $ = **8.703,83** · Costo total = 8.703,83+93.373,10+7.612 = **109.688,92**.
- % Contribución = **0,465443** · $ = **45.136,82** · % Rentabilidad = **−0,005415** · $ = **−590,80** · Unidad Eq. = **3** (vacío→1×3).

### Caso 3: Accesorio "Sillon / Deliveries" (fila 312)

- SLEEP CALM SA · `COMGANSUMA` `HERRAJE UNION "J" SUMA` · subtotal 3.186.300,00 · cant. 300 · ticket 10.621 · volumen 0,02 · región `CABA - 8,75%` (plazo 59,28).
- $ recargo = 0,0875×3.186.300/1,0875 = **256.368,97** · monto s/flete **2.929.931,03** · costo entrega = 0,02×24.988,89×300 = **149.933,33**.
- MP 2.542,50 · tiempo 0,02 hs · MOD+Ind (×1,55) **646,94** · no prod = 79.608.916,59/284.666,67 = **279,66** · fijos = 102.382.411,51/284.666,67 = **359,66**.
- Costo x Un. 3.828,76 · CMV **1.148.626,82** · p/contrib. **956.832,68** · solo MP **762.750,00**.
- % cf 0,058874 → $ **187.590,14** · costo total **1.486.150,29** · % contribución **0,673428** · $ **1.973.098,36** · % rentab. **0,533581** · $ **1.700.149,71** · Unidad Eq. **1,475410** (0,0049180×300).

### Caso 4: Reventa (fila 3)

- CHI S.H. · `REV9870000000036` `ALMOHADA PREMIUM 70X50` · subtotal 203.220 · cant. 10 · `Reventa / Almohadas` · volumen 0,07 · región `CUYO - 12,5%` (plazo 0).
- % recargo 0,125 → $ recargo **22.580,00** · monto s/flete **180.640,00** · costo entrega = 0,07×42.288,89×10 = **29.602,22**.
- MP = costo producto 9.134,69; MOD, no prod = 0 (excluida); fijos vacío → Costo x Un. **9.134,69** · CMV **91.346,90** · p/contrib. **91.346,90**.
- % cf **0** (plazo 0) · costo total = 91.346,90+29.602,22 = **120.949,12** · % contribución **0,494315** · $ **89.293,10** · % rentab. **0,404837** · $ **82.270,88** · Unidad Eq. `#N/A`.

### Caso 5: Nota de crédito comercial (fila 311)

- SLEEP CALM SA · `NCAC` `N/C ACUERDO COMERCIAL SILLONES` · subtotal −349.794,85 · cant. −1 · ticket +349.794,85 · `Sillon/Bonificacion`.
- Recargo 0 (Bonificación) · monto s/flete −349.794,85 · todos los costos 0 · % cf 0 · % contribución **1,0** · $ contribución **−349.794,85** · $ rentabilidad **−349.794,85** · Unidad Eq. `#N/A`.

### Caso 6: Resorte (fila 129)

- ANGEL MARIA ANTONIETA · `POZINU14019028E` `POCKET ZINUS 140X190X28EURO P` · subtotal 286.316,08 · cant. 1 · `Colchones / Resorte` · volumen 0,74 · región `PCIA CORTA - 5%` (plazo 7,67).
- $ recargo **13.634,10** · monto s/flete **272.681,98** · entrega = 0,74×15.377,78 = **11.379,56**.
- MP 146.609,73 · MOD = MOD+Ind **11.043,23** (0,52917 hs) · no prod **23.208,17** · fijos **13.626,98** · Costo x Un. **194.488,11** · p/contrib. **157.652,96**.
- % cf **0,0076175** → $ **2.181,00** · costo total **208.048,67** · % contribución **0,421843** · $ **115.029,02** · % rentab. **0,273360** · $ **78.267,41** · Unidad Eq. **1**.

### Fila de `COSTOS PRODUCTOS` (Producto) de control

| Código | MP | Tela | Tiempo hs | MOD | MOD+Ind | No prod | Fijos | Costo total | Precio venta | Contrib. | Rentab. | U.Eq. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `0089R24STDR` AERO RINCONERO | 100.326,34 | 0 | 2,904762 | 60.619,78 | 93.960,66 | 40.616,79 | 52.235,92 | 287.139,72 | 476.338,80 | 0,592124 | 0,397194 | 0,714286 |
| `ECOMF14019028S` ESPUMA COMFORT 140X190X28 | 105.199,97 | 0 | 0,338333 | 7.060,71 | 7.060,71 | 14.838,61 | 8.712,68 | 135.811,98 | 335.052,15 | 0,664946 | 0,594654 | (vacío) |

### Totales de septiembre 2026 por categoría (suma de la hoja; cantidades = suma de `Cantidad`)

Montos en $, columnas: cantidad · subtotal · $ recargo · monto s/flete · costo entrega · MP total · MOD+ind total · no prod. total · fijos total · CMV · costo p/contrib. · $ costo fin. · costo total prod. · $ contribución · $ rentabilidad · %contrib (s/monto s/flete) · %rentab (s/subtotal).

| Categoría | cant | subtotal | recargo | monto s/flete | entrega | MP | MOD+ind | no prod | fijos | CMV | c.contrib | c.fin | costo total | contribución | rentabilidad | %contr | %rent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Colchones / Bases | 1.395 | 139.897.943 | 14.910.943 | 124.987.000 | 25.231.723 | 53.766.667 | 11.464.095 | 24.092.636 | 14.146.310 | 103.469.708 | 65.230.763 | 8.387.006 | 137.088.437 | 59.756.237 | 2.809.506 | 47,8% | 2,0% |
| Colchones / Eps | 494 | 129.116.547 | 6.136.457 | 122.980.091 | 6.777.294 | 68.666.823 | 4.421.555 | 9.292.221 | 5.456.050 | 87.836.649 | 73.088.378 | 10.629.767 | 105.243.710 | 49.891.713 | 23.872.837 | 40,6% | 18,5% |
| Colchones / Espuma | 7.683 | 1.441.243.201 | 112.922.745 | 1.328.320.456 | 122.027.011 | 633.124.719 | 51.409.263 | 108.040.333 | 63.437.308 | 856.011.622 | 684.533.981 | 79.180.797 | 1.057.219.430 | 643.786.475 | 384.089.854 | 48,5% | 26,6% |
| Colchones / Resorte | 529 | 157.920.474 | 10.624.758 | 147.295.716 | 10.072.579 | 84.340.113 | 5.976.564 | 12.560.187 | 7.374.880 | 110.251.744 | 90.316.677 | 6.281.687 | 126.606.010 | 56.979.039 | 31.314.464 | 38,7% | 19,8% |
| Colchones/bonificacion | -14 | -19.848.094 | 0 | -19.848.094 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | -19.848.094 | -19.848.094 | n/a | n/a |
| PI / Block Espuma | 1.861 | 20.388.240 | 0 | 20.388.240 | 0 | 9.611.782 | 3.009.802 | 2.215.319 | 1.300.754 | 16.137.657 | 12.621.584 | 864.907 | 17.002.563 | 7.766.656 | 3.385.677 | 38,1% | 16,6% |
| Reventa / Almohadas | 430 | 8.371.893 | 980.254 | 7.391.639 | 724.466 | 4.023.272 | 0 | 0 | 0 | 4.023.272 | 4.023.272 | 460.044 | 5.207.782 | 3.368.367 | 3.164.110 | 45,6% | 37,8% |
| Reventa / Mesas | 31 | 6.630.648 | 164.892 | 6.465.756 | 32.120 | 4.351.019 | 0 | 0 | 0 | 4.351.019 | 4.351.019 | 198.194 | 4.581.333 | 2.114.737 | 2.049.314 | 32,7% | 30,9% |
| Reventa / Sillones | 6 | 10.933.886 | 1.214.876 | 9.719.010 | 715.951 | 7.243.055 | 0 | 0 | 0 | 7.243.055 | 7.243.055 | 844.305 | 8.803.311 | 2.475.955 | 2.130.575 | 25,5% | 19,5% |
| Scrap | 4.174 | 6.119.528 | 0 | 6.119.528 | 0 | 5.043.200 | 0 | 0 | 0 | 5.043.200 | 5.043.200 | 335.127 | 5.378.327 | 1.076.328 | 741.201 | 17,6% | 12,1% |
| Servicio | 7 | 1.871.498 | 0 | 1.871.498 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 118.370 | 118.370 | 1.871.498 | 1.753.128 | 100% | 93,7% |
| Sillon / Accesorio | 75 | 1.620.495 | 121.644 | 1.498.851 | 53.419 | 265.115 | 40.434 | 17.479 | 22.479 | 345.506 | 305.549 | 73.425 | 472.350 | 1.193.302 | 1.148.145 | 79,6% | 70,9% |
| Sillon / Deliveries | 777 | 79.514.535 | 6.397.721 | 73.116.814 | 3.638.132 | 24.333.082 | 21.815.864 | 9.430.441 | 12.128.180 | 67.707.566 | 46.148.946 | 4.681.337 | 76.027.035 | 26.967.869 | 3.487.501 | 36,9% | 4,4% |
| Sillon / Lean | 1.121 | 880.035.647 | 74.804.139 | 805.231.508 | 54.192.788 | 255.685.683 | 176.563.309 | 76.323.808 | 98.157.542 | 606.730.341 | 432.248.992 | 48.419.731 | 709.342.860 | 372.982.516 | 170.692.787 | 46,3% | 19,4% |
| Sillon / Tradicional | 66 | 48.562.278 | 4.762.252 | 43.800.026 | 4.367.846 | 10.940.144 | 13.077.219 | 5.652.948 | 7.270.070 | 36.940.381 | 24.017.363 | 3.062.841 | 44.371.068 | 19.782.663 | 4.191.210 | 45,2% | 8,6% |
| Sillon/Bonificacion | -14 | -2.890.678 | 0 | -2.890.678 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | -2.890.678 | -2.890.678 | n/a | n/a |
| **TOTAL** | 18.621 | **2.909.488.042** | 233.040.682 | **2.676.447.360** | 227.833.330 | 1.161.394.673 | 287.778.104 | 247.625.372 | 209.293.572 | 1.906.091.720 | 1.449.172.776 | 163.537.537 | **2.297.462.587** | **1.227.274.583** | **612.091.538** | 45,9% | 21,0% |

(En esta tabla: MP, MOD+ind, no prod. y fijos son totales = unitario × cantidad; MP total = "Costo para contribución (solo MP)". Suma MP + MOD+ind + no prod + fijos = CMV. Unidad Eq. total del mes = 11.765,11 sobre filas válidas; 133 filas `#N/A`.)

Por categoría padre (primer tramo de "A / B"): Colchones monto s/flete 1.703.735.168 → contribución 790.565.370 (46,4%) y rentabilidad 422.238.568 (22,8%); Sillon 920.756.520 → 418.035.672 (45,4%) y 176.628.965 (17,5%); PI/Block Espuma 20.388.240 → 7.766.656; Reventa 23.576.405 → 7.959.059; Scrap 6.119.528 → 1.076.328; Servicio 1.871.498 → 1.871.498.

Series de parámetros por mes (inferidas de `RESUMEN PRODUCTOS`, exactas al centavo):

| Mes | Valor hora prod. | Fijo sillones | No prod. sillones | Fijo colchones | No prod. colchones |
|---|---|---|---|---|---|
| oct-dic 2025 | 20.869,1054 | 76.436.125 | 79.608.916 | 65.441.365 | 135.550.317 |
| ene 2026 | 17.858,8658 | 102.382.411 | 72.733.712 | 79.590.159 | 123.843.889 |
| feb 2026 | 17.883,8939 | 102.382.411 | 74.165.158 | 79.590.159 | 126.281.215 |
| mar 2026 | 18.550,1929 | 102.382.411 | 76.901.427 | 79.590.159 | 130.940.269 |
| abr 2026 | 19.830,2540 | 102.382.411 | 76.810.836 | 79.590.159 | 130.786.019 |
| may-sep 2026 | 19.898,4493 (may) / 20.869,1054 (jun-sep) | 102.382.411 | 79.608.916 | 79.590.159 | 135.550.317 |

Totales mensuales de BD-CLI para backtest (subtotal / monto s/flete / contribución / rentabilidad): oct-25 1.759.390.520 / 1.618.127.803 / 637.748.969 / 172.051.215 · nov-25 1.473.562.110 / 1.346.310.979 / 513.359.400 / 120.901.697 · dic-25 1.354.983.706 / 1.230.375.206 / 509.334.882 / 184.897.413 · ene-26 1.384.356.807 / 1.268.029.178 / 527.040.367 / 180.835.426 · feb-26 1.538.936.461 / 1.417.292.825 / 611.715.245 / 221.455.978 · mar-26 1.954.487.301 / 1.800.862.589 / 694.055.344 / 208.457.143 · abr-26 1.965.747.363 / 1.807.189.041 / 701.569.648 / 269.619.142 · may-26 2.072.890.865 / 1.917.815.317 / 687.770.605 / 234.668.875 · jun-26 2.592.247.660 / 2.379.640.337 / 934.595.512 / 389.372.315 · jul-26 2.386.650.859 / 2.203.041.144 / 859.159.925 / 359.380.757 · ago-26 2.575.576.575 / 2.380.011.920 / 1.060.157.471 / 522.475.954 · sep-26 2.909.488.042 / 2.676.447.360 / 1.227.274.583 / 612.091.538 · oct-26 (parcial, hasta 16-oct) 840.609.712 / 773.060.499 / 357.112.298 / 191.634.455.

---

## 5) Huecos, supuestos y cosas a validar

**Insumos que NO están en Odoo (valores pegados a mano o externos):**

1. **Tarifas de mano de obra** (`VALOR HORA`): vienen de un Google Sheet externo de RRHH (IMPORTRANGE). Valor hora productivo (U2), pozos productivo/no productivo (U10/U5) y **reparto no productivo colchones/sillones (U6/U7, 63/37)**. Las horas base 184,8 hs/mes y los coeficientes (feriados 6,5%, vacaciones/aguinaldo 8,33%, ausentismo 4,2%, ineficiencia 10%, incentivo) también están en esa hoja. Se podría reconstruir desde nómina Odoo (hr.payslip/contratos) pero el criterio de reparto no se deduce del libro.
2. **Pozos de costos fijos** (`COSTOS PRODUCTOS`!Z1 y AB1): números pegados (sillones 102.382.411,51; colchones 79.590.158,85). **Idénticos de enero a septiembre 2026** (no se actualizan por mes) y distintos en oct-dic 2025 (76,4 M / 65,4 M). Origen contable externo.
3. **Tiempos estimados por modelo** (`Capacidad living`!C y `Tiempos colchones`): estudios de tiempos pegados a mano. Posible equivalente: duración de operaciones en `mrp.routing.workcenter` / `mrp.workorder` si están cargadas; no verificable.
4. **Constantes de capacidad**: 488 min diarios, 20 días hábiles, 5 (líneas), ×7, 19 operarios, 8:08 hs, 244 min = unidad equivalente (4,0667 hs). Producen `capacidad/mes = 5.693,33/tiempo` (sillón) y `3.090,67/tiempo` (colchón).
5. **Precios de tela** ($/m, hoja `Telas`) y **grupo de tela** (`% de venta` 0 / 9% / otro → Grupo 2 / 3 / 4) y sobreprecio 1,09 / 1,09² del precio de lista para grupo 3 / 4.
6. **Región/recargo por cliente** (texto "REGION - X%") y **plazo de pago** por cliente (`Plazo de pago mes` + estático `CFF`!C); tasa 29% anual +25% incobrabilidad; precio m3 por km 1730/90 y tabla recargo→km (400/650/1100/1450/1700/2200). 95 de 323 clientes de septiembre sin plazo mensual (cae al estático).
7. **Coeficiente 1,55** MOD→MOD+indirecta para no-colchones: hard-coded.

**Supuestos a validar contra Odoo:**

- Que `Costos!C` ("Costo") es `standard_price`. Para variantes de sillón (código `...MP04C...`) el Excel suma la tela aparte; verificar que el `standard_price` de la variante **no** incluya ya la tela (si no, hay doble conteo al reproducirlo desde BoM).
- Código base de un sillón = código de barras cortado antes de `"MP"` (ej. `0089R24STDRMP04001C01MP06149` → `0089R24STDR`). Para `Sillon / Accesorio` la tela usa los primeros 9 caracteres. Para `Sillon / Deliveries` se busca el código completo.
- El campo "Categoría" (`Costos!D`) con formato `Padre / Hijo`; hay dos con formato sin espacios. La app debería normalizar al comparar.
- Qué facturas entran en `Facturación productos`: parece `account.move.line` de clientes (facturas + NC, publicadas, con producto), excluyendo líneas de nota/sección, e incluyendo ítems de servicio (flete clientes, servicio post-venta) y scrap. Falta confirmar filtros (estado, diarios, fecha de factura vs fecha contable) y si el subtotal es sin IVA.
- Orden de operaciones de NC: cantidad −1 y subtotal negativo; ticket positivo.
- El CMV del Excel es **costo estándar teórico** (BoM/tiempos/pozos), **no** el costo contable de Odoo (asientos de valoración); no deben cuadrar entre sí.

**Inconsistencias / anomalías detectadas:**

- Una fila (ECORO14019026E, subtotal −146.708,88) tiene `$ Rentabilidad` = +33.041,47 pero el % da −33.041 (signo invertido): sobrescrito a mano o error de signo en negativos. El resto cuadra.
- `Unidad Eq.` es `#N/A` cuando el producto no está en `Capacidad living` (reventas, bonificaciones, servicios, scrap, algunos accesorios). En BD-CLI hay 7.584 vacíos de 27.573. En colchones el valor es 1 por unidad.
- `Costo para contribución` (col. X, MP + MOD+ind) **no** incluye no productiva ni fijos; la hoja `CONTRIBUCION` en cambio usa solo MP para la contribución por categoría. Dos definiciones coexisten; la app usa la de fila (`$ Contribución` = AD).
- Costo financiero se calcula sobre el **subtotal** (con recargo), la contribución sobre el **monto s/flete** (sin recargo).
- `Costos fijos` queda vacío (no cero) en categorías excluidas; en el costo unitario cuenta como 0.
- Los costos de BD-CLI de meses pasados (oct-dic 2025) usan pozos y valor hora distintos de los actuales; no recalcular con parámetros de septiembre al hacer backtest (la tabla de la sección 4 da los parámetros por mes). Oct-dic 2025 tienen el mismo valor hora (20.869,1054) que jun-sep 2026: probablemente fueron recalculados con tarifa vigente más adelante.
- Hay códigos de barras numéricos (p.ej. `2000000000305`, polietileno/poliéster) que Excel interpreta como fechas; tratar el código como texto.
- 4 filas de BD-CLI con fecha 1900-01 (fecha vacía/rota), 6 sin código, 3 sin nombre, 32 sin % recargo (cliente no mapeado).
- `Mes` en BD-CLI = fecha de factura (no se trunca a fin de mes); para agrupar mensualmente hay que truncar por año-mes. BD-PROD sí trae `MES` como fin de mes (ej. 2026-09-30).
- La memoria del proyecto indica que Producción (sept 2026 = 1.597 UE) es la referencia de Gerencia; **no** se debe confundir con la `Unidad Eq.` de facturación de este Excel (11.765 en sept., mide ventas, no producción).

**Pendientes para cerrar:**

- Confirmar con quien mantiene el Excel el criterio de reparto 63/37 de la mano de obra no productiva y el origen de los pozos fijos.
- Elegir fuente de tiempos de línea en Odoo (rutas/work orders) y comparar contra `Capacidad living`!C.
- Confirmar si el partner trae el texto `REGION - X%` como lista de precios, etiqueta u otro campo.
- Definir la política para clientes sin plazo mensual (fallback estático) y para productos sin capacidad (costos MOD/no prod/fijos en cero → `#N/A` en el Excel que luego queda como vacío).
