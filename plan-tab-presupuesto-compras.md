# Tab "Presupuesto de Compras (BOM)" — estado real (recálculo en vivo)

**Proyecto:** dashboard-odoo-web (Astro SSR + islas React)
**Área:** Finanzas — slug `presupuesto-dinamico`, nombre visible "Presupuesto de Compras (BOM)"
(no confundir con el tab vecino `presupuesto-compras`, que es otro dashboard: % Cumplimiento
real vs. presupuestado por categoría, sin el motor BOM)
**Fuente funcional:** `INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md`

> Este documento reemplaza una versión anterior que planteaba esto como trabajo a hacer.
> Ya está implementado y en `main`. Lo que sigue es un mapa de qué se construyó, cómo
> difiere de lo originalmente planteado, y qué queda abierto.

---

## 0. Cómo se resolvió el hueco del consenso de unidades

El plan original evaluaba 3 opciones (modelo custom en Odoo Studio, upload propio, carga
manual) para tapar el hueco de "el consenso mensual vive en Excel". Se terminó resolviendo
distinto a las 3: **fallback en capas**, de más a menos autoritativo
(`src/lib/odoo/presupuesto-dinamico.ts` → `buildEffectiveConsenso`):

1. **Override manual** (Supabase, cargado a mano desde el form de Compras) — gana siempre
   que exista, para cualquier mes.
2. **`Proyección de Ventas 2026` real** (`src/lib/consenso-csv.ts`) — un CSV en `public/`
   con el plan de Producción ya consensuado (fila "Consensuado Producción
   Colchones/Sillones"). Es la fuente dominante: cargar enero real (6.480 colchones / 792
   sillones) en vez de un placeholder movió el presupuestado de TDI de 4% a 60% del
   número de referencia de Marlynet.
3. **Ventas reales** (`getMonthlyUnitsSold`) — sólo para meses ya cerrados que el CSV no
   cubre; último recurso para no dejar un hueco en datos viejos.

Deliberadamente **no** se usó `mrp.production.qty_produced` (OEE) como fuente: ese número
suma toda la categoría Colchones/Living incluyendo órdenes intermedias (espuma, bases),
no unidades terminadas — confirmado en vivo que infla el total (7.221 "unidades" en enero,
dominadas por componentes, no producto final).

**Implicancia:** el consenso sigue sin vivir "nativamente" en Odoo (Opción A del plan
original, modelo Studio, no se hizo), pero tampoco quedó 100% manual — el CSV de
Producción hace el trabajo pesado y Supabase sólo cubre la excepción/override.

---

## 1. Mapeo de cada paso del documento → estado real

| Paso del PDF | Implementación | Archivo | Diferencia vs. plan original |
|---|---|---|---|
| 1. Consenso mensual de unidades por UN | 3 capas: manual (Supabase) → CSV Producción → ventas reales (cerrados) | `consenso-csv.ts`, `supabase/presupuesto-inputs.ts`, `presupuesto-dinamico.ts::buildEffectiveConsenso` | Resuelto sin Odoo Studio (ver sección 0) |
| 2. Mix por modelo (share histórico) | Ventas reales 12 meses, sólo modelos con BOM reconocido | `src/lib/odoo/sales-mix.ts` | "Unidad de Negocio" se resolvió como Colchones/Living por categoría de producto — ver `sales-mix.ts` |
| 3. Filtro de productos vigentes | Filtro `active` sobre el universo de venta | `sales-mix.ts` | Directo, como estaba previsto |
| 4. Explosión de BOM a materia prima | **No** es explosión recursiva en vivo de `mrp.bom` — se abandonó ese camino (ver nota abajo) | `src/lib/bom-csv.ts` | Cambio de arquitectura importante — ver sección 1.1 |
| 5. Costeo | Costo vigente (`standard_price`) por insumo, conversión USD→ARS con TC histórico para reales y TC asumido/spot para meses futuros | `src/lib/odoo/insumo-costs.ts`, `src/lib/odoo/fx-historical.ts`, `src/lib/odoo/currency.ts` | Implementado según regla 4.5 (costo vigente, no cacheado) |
| Corrección — nombres que no cruzan ($0) | Cruce por `product_id`, no por texto (regla 4.1) | `insumo-costs.ts::resolveInsumoProductIds` | Resuelto de raíz |
| Corrección — reparto de telas de Living | Implementado completo: detección automática de genéricos + calibración $/unidad + mix histórico con filtro de outliers | `presupuesto-dinamico.ts` (`redistributeGenericBudgets`, `computeHistoricalMix`) | Esto era "Fase 4, dejar para después" en el plan original — **ya está hecho**, no quedó pendiente |

### 1.1 Nota importante: por qué NO se explota `mrp.bom` en vivo

El plan original asumía que el Paso 4 se resolvía recorriendo `mrp.bom`/`mrp.bom.line`
recursivamente vía API. Se probó y se abandonó: una explosión recursiva en vivo daba
números químicamente imposibles (ej. ~2.500 kg de TDI por colchón), porque sub-ensambles
ya cotizados como productos propios (ej. "POLIESTER CILINDRO CELESTE 16V") no están
pensados para explotarse más allá — Odoo no distingue eso solo desde la data cruda del BOM.

**Solución adoptada:** un CSV pre-aplanado ("BOM Crudo", fuente Sistemas) con
Modelo→Insumo→Cantidad ya resuelto a materia prima real, servido desde `public/` (leído
por HTTP desde el propio origen, no desde filesystem — Vercel serverless no garantiza ver
`public/` por fs read). Confirmado en vivo contra el ejemplo de Marlynet (VORANOL 3011 para
"ONIX, SOFA-1CPO(-76)" = 4.209,8242g, exacto).

El cruce de nombres CSV↔Odoo (`normalizeName` en `bom-csv.ts`) cierra ~72% de los modelos
exactos; el resto queda listado como `modelosSinBomReconocido` en vez de arriesgar un
match incorrecto.

**Esto es información que el negocio necesita conocer**: el BOM que alimenta el
presupuesto es un archivo estático que alguien de Sistemas debe mantener actualizado, no
una fuente 100% viva de Odoo. Si el catálogo de modelos cambia y nadie actualiza el CSV,
el dashboard empieza a mostrar más `modelosSinBomReconocido` en silencio hasta que alguien
mire el panel de Gaps.

---

## 2. Arquitectura técnica (tal como quedó)

- **Dónde corre el cálculo:** SSR, como estaba previsto — `src/pages/api/presupuesto-dinamico-resumen.ts`
  llama a `getPresupuestoDinamicoData` (server-side), la isla React (`PresupuestoDinamicoApp.tsx`)
  sólo consume el resultado agregado vía `useApiQuery`.
- **Cache:** TTL corto en memoria (`withTtlCache`, 2 min para líneas de compra reales,
  10 min para los CSVs) — no hay job programado, pero sí un botón manual de "Recalcular"
  que la fuerza a demanda (sección 4). Suficiente por ahora dado el volumen real (no llegó
  a ser el cuello de botella que el plan anticipaba).
- **Conexión a Odoo:** mismo cliente/patrón (`src/lib/odoo/client.ts`) que el resto del
  dashboard, con `lang: 'es_AR'` centralizado.
- **Inputs manuales (Supabase):** `src/lib/supabase/presupuesto-inputs.ts` +
  `src/pages/api/presupuesto-dinamico-inputs.ts` — consenso override y TC asumido por mes,
  vía `ConsensoInputsForm.tsx` en la propia UI del tab (botón "Cargar consenso / TC").

---

## 3. UI del tab (tal como quedó)

Implementado en `src/components/finanzas/`:

- `PresupuestoDinamicoApp.tsx` — shell: selector Año/Mes, botón para mostrar el form de
  inputs manuales, y las secciones de abajo.
- `ComplianceSummaryChart.tsx` — % Cumplimiento total por mes (resumen ejecutivo, como
  pedía la sección 5 del documento).
- `CategoryInsumoTree.tsx` — tabla Categoría → Insumo colapsable, con columnas Mes →
  Trimestre (colapsable) → Año, exactamente como pedía la sección 5 del documento original.
- `GapsPanel.tsx` — gaps pendientes: meses sin consenso, meses sin TC asumido, modelos
  vendidos sin BOM reconocido, e insumos con motivo (sin costo / genérico sin repartir /
  no es materia prima / no encontrado). Cubre la alerta de "$0 por mismatch" del plan
  original de forma más completa (4 motivos, no sólo nombre).
- `FueraDeAlcanceTable.tsx` — categorías de compra real que no son materia prima, separadas
  para no diluir el % de Cumplimiento (sección 5 del documento, "Fuera de Alcance").
- `InsumoBreakdownModal.tsx` (2026-09-15) — drill-down: click en el número Presupuestado de
  un insumo/mes abre el detalle de cómo se construyó (cada modelo que aporta × su cantidad
  BOM, o su share del reparto de genérico si es una tela/insumo redistribuido). Cubre lo que
  el plan original pedía en la sección 3 ("unidades del modelo × cantidad BOM × costo"),
  ver sección 3.1 abajo.

### 3.1 Drill-down por insumo (agregado 2026-09-15)

`src/lib/odoo/presupuesto-dinamico.ts::getInsumoBreakdown` reusa exactamente el mismo
cálculo que arma la tabla principal (`computeCore`, factorizado del motor original) — no
es una segunda fuente de verdad que pueda desincronizarse: el costo unitario que usa se
deriva del propio total ya mostrado en la celda (`presupuestado ÷ cantidad total`), nunca
se recalcula por separado. Expuesto en `GET /api/presupuesto-dinamico-breakdown?year=&productId=&month=`,
consumido sólo bajo demanda (no viaja en el payload del resumen — a esa escala,
~634 insumos × 12 meses × N modelos, hubiera sido demasiado peso para algo que se mira
ocasionalmente).

---

## 4. Recálculo manual (agregado 2026-09-15)

Botón "Recalcular" en el shell del tab: invalida las cachés TTL cortas de este dashboard
(`invalidatePresupuestoDinamicoCache` en `presupuesto-dinamico.ts`, vía `?force=true` en
`/api/presupuesto-dinamico-resumen`) y refetchea, en vez de esperar el TTL (2-10 min según
la sub-fuente). Cubre el pedido original de la sección 2 del plan ("botón manual
'Recalcular'"), aunque sigue sin haber un job programado — cada carga normal de página
sigue dependiendo del TTL, esto es sólo para forzarlo a demanda (ej. justo después de
confirmar una OC o corregir un costo en Odoo).

---

## 5. Qué queda genuinamente abierto

1. **Mantenimiento del CSV de BOM y de Proyección de Ventas** — son archivos estáticos en
   `public/`, no viven en Odoo. Si nadie los actualiza, el dashboard degrada en silencio
   (más gaps, consenso desactualizado) sin que haya un error visible fuera del panel de Gaps.
   El año de la Proyección de Ventas ya no está hardcodeado en código — se lee de la env var
   `PROYECCION_VENTAS_YEAR` (default 2026, ver `.env.example`) — pero el archivo CSV en sí
   sigue necesitando reemplazo manual en `public/` cada año, siguiendo el mismo nombre
   `Proyeccion ventas {año}.csv`.
2. **`modelosSinBomReconocido` (~28% de los modelos, por el matching de nombres)** — son
   ventas reales que hoy no aportan nada al presupuestado. Vale confirmar con Marlynet si
   ese 28% es material en $ o marginal. No se tocó — arreglar el matching a ciegas, sin ver
   los nombres reales que no cruzan, arriesga generar falsos positivos.

---

## 6. Contacto de negocio

Marlynet (Compras) sigue siendo la referente funcional para validar los números contra su
Excel. `deploy_mrp_fixes/` y `scripts/` (sin trackear en git todavía) parecen trabajo en
curso separado sobre `mrp` (fixes de stock moves, corte de tela) — no revisado como parte
de este documento; si está relacionado con el reparto de telas de la sección 1, conviene
cruzarlo antes de tocar `redistributeGenericBudgets`.
