# Dashboard Dinámico — Presupuesto de Compras vs. Real (Frontera Living)

## Contexto

Hoy este cálculo vive en Excel, armado manualmente por Facu (Compras) a partir de exports
de Odoo. El objetivo es reemplazar ese proceso manual por un flujo que lea Odoo en vivo
(la web Astro + islas React ya tiene credenciales conectadas) y muestre el mismo resultado
de forma interactiva, actualizado sin intervención manual mes a mes.

Este documento traduce toda la lógica de negocio ya validada con Marlynet (Compras) a
requerimientos técnicos. **La lógica de cálculo no se re-inventa — se traslada tal cual.**

---

## 1. Objetivo funcional

Mostrar, para el Presupuesto de Compras de Materia Prima 2026:

- **Presupuestado** (bottom-up: qué materia prima hace falta comprar según el plan de ventas)
- **Real** (lo efectivamente comprado, desde Odoo)
- **Variación** ($ y %) y **% de Cumplimiento**

Con navegación interactiva: **Categoría → Insumo**, y **Mes → Trimestre → Año**,
igual que el prototipo en Excel (filas y columnas colapsables).

---

## 2. Fuentes de datos en Odoo

| Dato necesario | Módulo/modelo Odoo probable | Notas |
|---|---|---|
| Lista de Materiales (BOM) por modelo | `mrp.bom` / `mrp.bom.line` | **Pedir a nivel de modelo padre/modulación, NO por cada variante de color/tela/pata** — si no, explota a miles de combinaciones inmanejables. Ver sección 4 sobre por qué esto genera un problema conocido. |
| Ventas por variante (12 meses) | `sale.order.line` o reporte de facturación | Se necesita por código de producto (variante), unidad de negocio, unidades y monto — usado para calcular el "mix" de qué modelo específico se vende dentro de cada familia. |
| Órdenes de Compra | `purchase.order` / `purchase.order.line` | Insumo, proveedor, cantidad, precio unitario, moneda, condición de pago, fecha de emisión, fecha de confirmación, estado. **Filtrar `state = 'purchase'`** (confirmadas) para "real ejecutado" — excluir `draft`, `sent`, `cancel`. |
| Costo por insumo | `product.template` / lista de costos | Costo unitario vigente. Ver sección 4 sobre frescura del dato. |
| Estado de producto | `product.template.active` | **Filtrar productos archivados** — no deben proyectarse en el presupuesto futuro aunque tengan venta histórica. |
| Categoría de insumo | Categoría de producto en Odoo | Para la agrupación Categoría → Insumo. |
| Compañía | `res.company` | **Filtrar siempre por `Frontera Living S.A.`** — hay una segunda compañía ("Presupuesto") en el mismo Odoo que no debe mezclarse. |

---

## 3. Lógica de cálculo (Presupuestado)

Secuencia de 4 pasos, en este orden exacto:

1. **Unidades consensuadas por mes y unidad de negocio** (Colchones / Living) — hoy viene de
   una planilla de consenso mensual (Producción/Ventas/Dirección). Si existe un módulo de
   forecast/MRP en Odoo, usarlo; si no, este dato seguirá siendo un input manual mensual
   (no se puede derivar solo de Odoo).
2. **Mix de modelos dentro de cada unidad de negocio**: % de participación de cada modelo,
   calculado con unidades vendidas reales de los últimos 12 meses, **solo sobre modelos
   activos y con BOM utilizable**.
3. **Explosión de insumos**: unidades del modelo × su BOM (recursiva si el BOM tiene
   niveles intermedios — ver sección 4).
4. **Costeo**: cantidad × costo unitario vigente del insumo.

```
Presupuestado(insumo, mes) = Σ sobre todos los modelos activos que usan ese insumo de:
    [ Unidades_consensuadas(UN, mes) × Share_modelo(modelo, UN) × Cantidad_BOM(modelo, insumo) × Costo(insumo) ]
```

## 4. Lógica de cálculo (Real)

```
Real(insumo, mes) = Σ de líneas de OC confirmadas (state='purchase') de ese insumo,
    con fecha de emisión en ese mes, convertidas a ARS si la moneda es USD (usar TC del
    día de la OC, no un tipo de cambio fijo).
```

**% Cumplimiento(mes) = Real(mes) / Presupuestado(mes)**

---

## 4. Reglas de calidad de dato — MUY IMPORTANTE, no son opcionales

Estas 5 reglas vienen de errores reales que encontramos armando esto a mano. Si el agente
no las aplica, el número va a salir mal de formas difíciles de detectar a simple vista.

### 4.1 — Nombres de insumo inconsistentes entre BOM y maestro de costos
El nombre de un insumo en la Lista de Materiales puede no ser idéntico al nombre en la
lista de precios (ej. `"VORANOL 3011 (POLIOL)"` en el BOM vs. `"VORANOL (POLIOL)"` en
costos — mismo insumo, texto distinto). Esto hace que el cruce falle en silencio y el
insumo aparezca con costo $0. **Recomendación: hacer el cruce por `product_id` de Odoo,
no por nombre de texto** — eso elimina este problema de raíz, ya que el ID interno de
Odoo es siempre el mismo aunque el nombre mostrado varíe. Si por algún motivo hay que
cruzar por texto, normalizar (trim, mayúsculas, sin espacios extra) antes de comparar.

### 4.2 — BOM contaminado con productos terminados o sub-ensambles
Al explotar el BOM de un producto hasta el final, pueden aparecer como "insumo final"
otros productos terminados o sub-ensambles intermedios (ej. un corte de tela ya armado,
o el bloque de espuma antes de su receta química) en vez de materia prima comprable.
**Solución: la explosión debe ser recursiva** — si un componente del BOM es a su vez
un producto con su propia BOM (ej. tiene `bom_ids` no vacío en Odoo), hay que seguir
bajando de nivel hasta llegar a un componente que no tenga su propia receta (ahí sí es
materia prima real).

### 4.3 — Productos archivados con venta histórica
Un modelo puede tener ventas en los últimos 12 meses pero estar archivado en Odoo hoy
(discontinuado). Si se usa el histórico de ventas sin filtrar por `active=True`, el
presupuesto proyecta demanda de productos que ya no se van a vender. **Filtrar siempre
por producto activo antes de calcular el mix de modelos.**

### 4.4 — Insumos que varían por opcional del cliente (tela, color, pata)
Este es el hallazgo más importante y menos obvio: para simplificar el pedido de BOM
(evitar miles de combinaciones de color/tela/pata), la Lista de Materiales a nivel de
"modelo padre" a veces usa un **componente genérico** para la tela (ej. `"Corte de Tela
1"`) en vez de la tela específica que compró el cliente (Floyd, Cuerotex, etc.). Ese
genérico no tiene costo — así que el gasto real en telas específicas queda invisible en
el presupuesto calculado.

**Esto NO se resuelve pidiendo el BOM por variante** (volveríamos al problema de miles
de combinaciones). La solución que usamos:
1. Identificar qué insumos actúan como "genérico compartido" (aparecen en muchísimos
   modelos distintos con cantidad siempre igual a 1, y sin costo cargado).
2. Para esos casos, **no calcular por BOM** — calcular con un **ratio empírico $/unidad**
   de la unidad de negocio, calibrado con el gasto real histórico ya confirmado (ej.
   gasto real en tela de los últimos meses cerrados ÷ unidades reales producidas en esos
   mismos meses).
3. Repartir ese monto entre los insumos específicos reales usando su **mix de consumo
   histórico** (de qué tela específica se compró más), tomado del historial de compras
   o de consumo, **filtrando antes valores atípicos aislados** (un mes donde un solo
   color se dispara sin que pase lo mismo con otros — señal de error de compra puntual,
   no de demanda real). Si el pico afecta a muchos insumos a la vez en el mismo mes,
   NO excluir — es una señal de evento de negocio real (promoción, pedido grande), no
   un error.

Este patrón (genérico sin costo + necesidad de mix real) puede repetirse en otras
familias de insumos con opcionales (ej. patas con distinto lustre/color) — el agente
debería poder detectar automáticamente estos casos (insumo con muchísimos modelos
asociados, siempre cantidad=1, sin costo) en vez de que alguien los descubra a mano.

### 4.5 — Costo desactualizado
El costo de un insumo puede haber cambiado en Odoo después de que se hizo el último
cálculo. **El cálculo dinámico debe leer el costo vigente en el momento de la consulta,
no un valor cacheado de una corrida anterior** — esta es justamente la ventaja de
hacerlo dinámico en vez de en Excel.

---

## 5. Vista esperada (UI)

Réplica de lo ya validado en Excel, en versión web:

- Tabla con dos niveles de agrupación en filas: **Categoría** (colapsable) → **Insumo**.
- Columnas: cada mes con 3 sub-columnas (Presupuestado / Real / %Cumplimiento),
  agrupadas colapsables bajo su **Trimestre**, y un total **Anual** siempre visible.
- Un resumen ejecutivo arriba: % de Cumplimiento total por mes (serie de 12 meses).
- Una vista separada de "Fuera de Alcance": categorías que aparecen en compras reales
  pero no son materia prima (servicios, indumentaria, muebles de reventa, etc.) — no
  deben mezclarse en el % de Cumplimiento del presupuesto de materia prima.
- Alertas visuales (color) cuando el % de Cumplimiento se aleja de un rango razonable
  (ej. fuera de 85%-110%).

---

## 6. Pendientes a resolver con el negocio (no son decisiones técnicas)

El agente no debe decidir esto por su cuenta — son inputs de negocio que hoy siguen
gestionándose manualmente y probablemente sigan así:

- El **consenso mensual de unidades a producir/vender** (no existe en Odoo, es un
  acuerdo humano mensual entre Producción/Ventas/Dirección).
- El **tipo de cambio a usar para el presupuesto futuro** (para OC reales ya ocurridas,
  usar el TC real de la operación; para meses futuros no hay TC real, es un supuesto
  que Finanzas define mes a mes).
- Insumos que hoy no tienen costo cargado en Odoo en absoluto (no es un problema de
  nombre ni de BOM — directamente no existe el dato). Estos deben quedar listados
  aparte como "gaps a completar", no en $0 silencioso.

---

## 7. Contacto de negocio

Marlynet (Compras) es la referente funcional para validar que los números calculados
tengan sentido de negocio antes de dar por buena cualquier versión nueva del cálculo.
