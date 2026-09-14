# Plan Técnico — Dashboard Dinámico de Presupuesto de Compras vs. Real

## Contexto

Reemplazar el cálculo manual en Excel (armado hoy por Facu a partir de exports de Odoo)
por un tab dinámico dentro del dashboard Astro + islas React ya existente, que lee Odoo
en vivo. La lógica de negocio ya está validada con Marlynet (Compras) — no se re-inventa,
se traslada.

---

## 1. Capa de datos (Odoo) — qué traer y de dónde

| Query | Modelo | Filtros clave |
|---|---|---|
| BOM por modelo padre | `mrp.bom` + `mrp.bom.line` | Solo BOM de nivel modelo/modulación (no por variante de color/tela/pata) |
| Ventas 12 meses (para el mix) | `sale.order.line` | `company_id = Frontera Living S.A.`, producto `active=True` |
| Compras reales | `purchase.order.line` | `state = 'purchase'` (excluye draft/sent/cancel), agrupado por mes de `date_order` |
| Costo vigente | `product.template` (lista de costos) | Leído al momento de la consulta, nunca cacheado |
| Categoría de insumo | categ_id del producto | Para agrupar Categoría → Insumo |
| Compañía | `res.company` | Filtrar siempre `Frontera Living S.A.` (no mezclar con la compañía "Presupuesto") |

**Decisión técnica clave**: todo cruce se hace por `product_id`, nunca por nombre de texto
(evita el problema "VORANOL 3011 (POLIOL)" vs "VORANOL (POLIOL)").

---

## 2. Capa de cálculo (motor de negocio)

Módulo propio, separado de las queries a Odoo (ej. `lib/presupuesto-calc.ts`).

### 2.1 — Presupuestado (4 pasos, en orden)
1. Unidades consensuadas por mes y unidad de negocio (Colchones/Living) — input manual
   (no existe en Odoo salvo que aparezca un módulo de forecast/MRP utilizable).
2. Mix de modelos dentro de cada unidad de negocio: % de participación por modelo,
   calculado con ventas reales de los últimos 12 meses, solo modelos activos y con BOM
   utilizable.
3. Explosión de insumos: unidades del modelo × BOM, **recursiva** (si un componente
   tiene su propio `bom_ids`, seguir bajando de nivel hasta materia prima real).
4. Costeo: cantidad × costo unitario vigente.

```
Presupuestado(insumo, mes) = Σ modelos activos que usan ese insumo de:
  Unidades_consensuadas(UN, mes) × Share_modelo(modelo, UN) × Cantidad_BOM(modelo, insumo) × Costo(insumo)
```

### 2.2 — Real
```
Real(insumo, mes) = Σ líneas de OC confirmadas (state='purchase') de ese insumo,
  fecha de emisión en el mes, convertidas a ARS con TC del día de la OC (no TC fijo).
```
`% Cumplimiento(mes) = Real(mes) / Presupuestado(mes)`

### 2.3 — Reglas de calidad de dato (no opcionales)

| # | Problema | Solución |
|---|---|---|
| 4.1 | Nombres de insumo distintos entre BOM y costos | Cruzar por `product_id`, nunca por texto |
| 4.2 | BOM contaminado con productos terminados/sub-ensambles | Explosión recursiva hasta componente sin `bom_ids` propio |
| 4.3 | Productos archivados con venta histórica | Filtrar `active=True` antes de calcular el mix |
| 4.4 | Insumo "genérico compartido" (ej. tela) sin costo, cantidad=1 en muchos modelos | Detectar heurísticamente (insumo en >N modelos, cantidad=1, costo=0); no usar BOM para ese caso — usar ratio $/unidad histórico calibrado con gasto real, repartido por mix de consumo real, filtrando outliers aislados (no outliers correlacionados entre insumos, que sí son señal real) |
| 4.5 | Costo desactualizado | Leer costo vigente en el momento de la consulta |

---

## 3. Capa API (endpoints Astro)

- `GET /api/presupuesto?anio=2026&mes=SEPTIEMBRE` (o `trimestre=Q3`, o sin mes = anual)
- Respuesta: estructura Categoría → Insumo → `{presupuestado, real, variación, %cumplimiento}`
- Bloque separado `fuera_de_alcance`: categorías reales que no son materia prima (servicios,
  indumentaria, muebles de reventa, etc.) — no entran en el % de Cumplimiento.

---

## 4. Capa frontend (isla React, dentro del tab Finanzas)

- Tabla 2 niveles colapsables: Categoría → Insumo.
- Columnas por mes (Presup./Real/%Cumpl.), agrupadas colapsables bajo Trimestre, Total
  Anual siempre visible.
- Filtro de período: Mes / Trimestre / Año.
- Resumen ejecutivo arriba: serie de 12 meses de % Cumplimiento total.
- Alertas visuales (color) cuando % Cumplimiento sale de 85%-110%.
- Vista separada "Fuera de Alcance".

---

## 5. Pendientes de negocio (inputs manuales, no se resuelven con código)

- Consenso mensual de unidades a producir/vender (acuerdo humano Producción/Ventas/Dirección).
- Tipo de cambio para meses futuros (supuesto que define Finanzas mes a mes; para OC ya
  ocurridas se usa el TC real de la operación).
- Insumos sin costo cargado en Odoo: listar aparte como "gaps a completar", nunca en $0
  silencioso.

---

## 6. Próximo paso

Ver el código actual del tab de Presupuesto ya funcionando en el dashboard (localhost:4321)
para seguir su mismo patrón de conexión a Odoo (JSON-RPC/XML-RPC) y estructura de carpetas,
y a partir de ahí implementar el motor de cálculo y la nueva vista.

Contacto de negocio para validar números: Marlynet (Compras).
