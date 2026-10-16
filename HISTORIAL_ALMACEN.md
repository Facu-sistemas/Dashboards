# Almacén · Historial de movimientos

Tab nuevo en **Almacén → Historial**. Muestra todo lo que entró, salió o se movió dentro del depósito (`WH/Existencias`) en el período elegido. Solo lectura sobre Odoo.

## Qué muestra

| Bloque | Descripción |
|---|---|
| Selector de rango | Hoy / 7 días / 30 días / 12 meses |
| Resumen | Total de movimientos (con count-up), variación vs. el período anterior de igual largo, barra proporcional entradas / salidas / internos, productos y ubicaciones distintas |
| Pulso del depósito | Gráfico de áreas apiladas por tipo. Eje por hora (Hoy), día (7d/30d) o mes (12m) |
| Heatmap día × hora | Cuándo se mueve el depósito; marca la hora pico y detalla al pasar el mouse |
| Rankings | Productos más movidos, ubicaciones más activas y actividad por rack |
| Línea de tiempo | Movimientos agrupados por día, con filtro por tipo y por rack (tocar un rack en "Actividad por rack") |
| Vista completa | Botón "Ver línea de tiempo completa": ventana a pantalla grande con buscador (producto / ubicación), filtros y paginado de a 100. Se cierra con Esc, ✕ o clic afuera |

## Criterios

- **Clasificación:** *entrada* si el origen está fuera de `WH/Existencias`, *salida* si el destino está fuera, *interno* si ambos están dentro (rack ↔ rack).
- **Se cuentan movimientos, no cantidades**, porque las unidades se mezclan (kg, m, u).
- **Fuente:** `stock.move.line` con `state = done` que tocan `WH/Existencias/%`.
- **Hora:** todo en hora Argentina (UTC-3 fijo, sin horario de verano).
- **Topes:** se leen hasta 30.000 filas por período (si se alcanza, se avisa que los números son un piso) y la línea de tiempo carga los 2.000 más recientes. Totales, gráfico, heatmap y rankings usan todas las filas leídas, no solo esas 2.000.
- **Caché:** 2 minutos por rango en el servidor.

## Archivos

- `src/lib/odoo/almacen.ts` — `getHistorialMovimientos(rango)`: agregación en el servidor.
- `src/pages/api/almacen-historial.ts` — `GET /api/almacen-historial?rango=hoy|7d|30d|12m`.
- `src/components/almacen/HistorialApp.tsx` — UI completa (React + Recharts).
- `src/components/almacen/HistorialTab.astro` — wrapper del tab.
- `src/components/almacen/types.ts` — tipos del historial.
- `src/lib/areas.config.ts` y `src/pages/[area]/[tab].astro` — alta del tab `historial` en el área `almacen`.

## Detalles técnicos a recordar

- Respeta el tema claro/oscuro: colores por variables CSS (`--brand-500`, `--status-*`) y `useChartTheme()` para Recharts.
- La vista completa se renderiza con un portal en `document.body`: dentro de la tarjeta (que tiene animaciones/transform) un `fixed` se centraba respecto al botón y no a la pantalla.
- Respeta `prefers-reduced-motion` (las animaciones se desactivan).

## Posibles mejoras

- Exportar a Excel el período completo (hoy la lista está limitada a 2.000 movimientos).
- Mostrar el documento de origen (picking / orden) y el usuario que hizo el movimiento.
