# Espumado (Test → Espumado)

Pestaña para llevar el stock de blocks de espuma por tipo y medida y cruzarlo con lo que Odoo registra. Solo lectura sobre Odoo.

## Por qué existe

La planilla "stock de block" cuenta **unidades por medida** (188 x 276, 198 x 316, etc.). Odoo maneja los blocks en **kg por tipo**: son 13 productos de la categoría "PI / Block Espuma" (uno por color/densidad), sin medida, sin lote y sin dimensión en las órdenes de fabricación. La medida no se puede sacar de Odoo, así que el stock por medida se carga a mano y Odoo sirve de control en kg.

## Qué tiene la pestaña

### Stock por medida (carga manual)
- Una fila por tipo y medida (14 tipos, ~45 medidas) para el día elegido.
- Columnas editables: **Inicial**, Producción, Colchones, Living, Venta, No conforme.
- **Final = inicial + producción − colchones − living − venta − no conforme**, calculado mientras se escribe, con los kg de cada fila.
- **El final de un día es el inicial del siguiente.** Se arrastra solo, también entre días sin carga, y si se corrige un día pasado se recalculan los siguientes.
- Si se escribe en **Inicial** un número distinto del final anterior (celda amarilla) se toma como **conteo físico** y corrige el arrastre desde ese día. Si coincide con el arrastre, vuelve a automático.
- Botón **Día siguiente →** (bloqueado si hay cambios sin guardar) y **Guardar día**.

### Control contra Odoo (kg)
Para el día elegido, por tipo: lo cargado × kg por unidad contra Odoo, en tres cosas:

| Control | Odoo |
|---|---|
| Stock al cierre | Stock actual menos el neto de los días posteriores (espumado + pre-producción) |
| Producción | Producción → ubicación Poliester |
| Consumo | Pre-producción → Producción (órdenes que consumen blocks), neto de devoluciones |

La diferencia es *planilla − Odoo*: positiva = en la planilla hay más kg que en Odoo.

### Flujo en Odoo
Vista solo de Odoo, últimos 7/14/30/60 días: stock por ubicación, producido, transferido a pre-producción, consumido, vendido, ajustes, consumo por día y **cobertura en días** (stock ÷ consumo medio por día de planta). Estado: Quiebre (< 1 día), Bajo (< 3), OK. Al hacer clic en un tipo se ven el gráfico diario y los movimientos de Odoo que componen cada número.

## Cómo se clasifican los movimientos de Odoo

Sobre `stock.move.line` en estado hecho, por ubicación de origen y destino:

| Origen → destino | Categoría |
|---|---|
| Producción → WH/Poliester | Producción |
| Producción → otra ubicación interna | Devolución (resta consumo) |
| Interna → Producción | Consumo |
| Interna → Clientes | Venta |
| Ajuste de inventario ↔ interna | Ajuste (con signo) |
| WH/Poliester → WH/PRE-PRODUCCION | Transferencia (no cambia el stock total) |

Los días se cuentan en hora Argentina (UTC−3).

## Datos y dónde viven

- **Tabla Supabase `espumado_dia`**: una fila por fecha/tipo/medida (`stock_inicial` nulo = arrastre, con valor = conteo manual). El SQL está en `src/lib/supabase/espumado-dia.ts`.
- **Catálogo de medidas y kg por unidad**: `src/lib/espumado-catalogo.ts`, tomado de la pestaña "KILO BLOCK ODOO" de la planilla. Si cambia un peso o aparece una medida nueva, se edita ahí. Cada tipo está mapeado a su producto de Odoo; "Cilindro ALTO" no existe en Odoo y no se controla.
- Guardar exige acceso al módulo Test.

## Archivos

- `src/lib/odoo/espumado.ts`: flujo y stock desde Odoo.
- `src/lib/espumado-stock.ts`: arrastre de saldos y control contra Odoo.
- `src/lib/espumado-catalogo.ts`, `src/lib/supabase/espumado-dia.ts`.
- `src/pages/api/espumado.ts` (Odoo) y `src/pages/api/espumado-stock.ts` (carga y control).
- `src/components/test/EspumadoApp.tsx`, `EspumadoStockPanel.tsx`, `EspumadoTab.astro`.

## Estado

- En main desde el 04/11/2026 (commits `e7d478f`, `680079d`, `cbe2eed`).
- Cargado el **02/11/26** completo desde la planilla (40 filas, stock final 174 unidades); es el punto de partida desde el que hereda el resto. El 03/11 existe en la planilla y no está cargado.
- La planilla trae dos tipos mal escritos ("25 CELESTE", "32 LILA (C)"); se cargaron como 24 CELESTE y 31 LILA (C).

## Pendientes / dudas abiertas

- Confirmar si el stock de la planilla incluye lo que está en pre-producción o solo espumado; hoy se compara contra la suma de ambos.
- Cargar el 03/11 (y el histórico, si se quiere) desde la planilla.
- Cruzar con el "stock ideal" y "block a producir" de la planilla (hoy la cobertura sale solo del consumo de Odoo).
- El umbral de 3 días de cobertura es provisorio.
