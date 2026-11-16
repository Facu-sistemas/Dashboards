# Ajustes de inventario — cambios (Gerencia General)

Fecha: 2026-11-16. Pantalla: `/gerencia-general/ajustes-inventario`.
Archivos: `src/components/gerencia/AjustesInventarioApp.tsx`, `src/lib/odoo/ajustes-inventario.ts`.
Solo lectura de Odoo (no se agregó ninguna escritura).

## 1. Detalle por categoría al elegir un trimestre (commit `ec4ce19`)

- Con **T1, T2, T3 o T4** seleccionado, la tabla mes a mes se reemplaza por una tabla **por categoría**:
  Unid. (+), $ (+), Unid. (−), $ (−), Unid. netas, $ neto, % s/ MP, % s/ fact., más una fila **Total**.
- Al tocar una categoría se despliegan sus meses del trimestre (la suma de los meses da el neto de la categoría).
- Con un mes o "Acumulado" se ve la tabla mensual de siempre.
- Las etiquetas de período dicen `T3 2026` en vez de `Jul–Sep 2026`.
- Servidor: `AjusteCategoria.meses` (ingresos y egresos por categoría y mes).

## 2. Tarjetas de desvío: Total y Filtro (commit `8a36bd9`)

- Número grande = **Total**: $ neto de todo el inventario (sin filtro) ÷ base. El semáforo contra el objetivo va sobre el Total.
- Si hay filtro de categoría/producto aparece al lado el número **Filtro**.
- Servidor: `netoValorSinFiltro` (neto mensual de todo el inventario). Los gráficos de evolución siguen el filtro, por eso no sirven para el Total.

## 3. Base del % con filtro (commit `f8aba7c`)

| Tarjeta | Total | Filtro |
|---|---|---|
| s/ materia prima | neto total ÷ MP consumida total | neto filtrado ÷ MP consumida **solo de lo filtrado** |
| s/ facturación | neto total ÷ facturación total | neto filtrado ÷ facturación total (no se abre por producto) |

- MP consumida = valor de capas de Valoración (`stock.valuation.layer`) de movimientos de consumo de órdenes de fabricación
  (`raw_material_production_id`) de productos de Materia Prima, por mes y por producto.
- Servidor: `cargarMpPorProducto` (read_group por mes y producto) → `materiaPrimaFiltrada` (12 meses). Caché `ajustes-inventario:v6`.
- Si lo filtrado no es materia prima o no se consumió en el período: no hay base y se muestra "—".
- El % del filtro puede superar el 100% si el ajuste del material fue mayor a lo consumido.
  Ejemplo visto: MDF 15MM, nov-2026: neto −$4.253.732 sobre ~$2,84 M consumidos = −149,55%.
  **Pendiente de validar en Odoo** (Valoración, MDF 15MM, noviembre, consumos de OF) que esa base esté completa.
- Los hovers de ambas tarjetas explican el cálculo.

## Rollback

- Todo lo de este documento: `git revert f8aba7c 8a36bd9 ec4ce19` (en ese orden, o los que se necesiten).
- Solo la base del filtro (volver a dividir por MP total): `git revert f8aba7c`.
- Solo las tarjetas Total/Filtro: `git revert 8a36bd9` (junto con f8aba7c, que depende de él).
- Solo el trimestre por categoría: `git revert ec4ce19`.
