# Reestructuración de módulos

Cambios de organización de módulos y pestañas. Sin commit ni push todavía.

## Módulo nuevo: Planta (`/planta/…`)

| Pestaña | URL nueva | Venía de |
|---|---|---|
| Calculadora Carpintería | `/planta/calculadora-carpinteria` | Herramientas de producción |
| Embalaje | `/planta/embalaje` | Logística |

En el Home queda a la izquierda de Test (después de Fichaje).

## Herramientas de producción (`/produccion/…`)

Sigue siendo un solo módulo. La barra de pestañas se divide en dos filas, cada una con su nombre a la izquierda.

**Colchón**

| Pestaña | URL | Nota |
|---|---|---|
| Calculadora de Bandas | `/produccion/calculadora-bandas` | sin cambios |
| Optimizador Multicorte | `/produccion/optimizador-multicorte` | sin cambios |
| Planificado Línea | `/produccion/planificado-linea` | sin cambios |
| Espumado | `/produccion/espumado` | venía de Test (`/test/espumado`) |

**Living**

| Pestaña | URL | Nota |
|---|---|---|
| Telamax | `/produccion/telamax` | sin cambios |
| Líneas de Sillones | `/produccion/lineas-sillon` | sin cambios |
| Optimizador Vertical | `/produccion/optimizador-vertical` | venía de Test (`/test/optimizador-vertical`); se le sacó "(Living)" del nombre |

La subdivisión se define con el campo `grupo` de cada pestaña en `src/lib/areas.config.ts`; `TabsNav.astro` dibuja una fila por grupo.

## Permisos de las APIs

| API | Antes | Ahora |
|---|---|---|
| `embalaje-escaneos` | `logistica` | `planta` |
| `espumado-stock` | `test` | `produccion` |
| `vertical-guardar` | `test` | `produccion` |

## Pendiente antes de subir a main

- Correr `docs/migracion-modulos-planta.sql` en Supabase: copia el permiso de Planta a quienes tenían Herramientas de producción o Logística. Sin esto, solo dev ve Planta.
- Los usuarios que accedían a Espumado y Optimizador Vertical solo por Test necesitan el módulo Herramientas de producción.
- Las URLs viejas (`/test/espumado`, `/test/optimizador-vertical`, `/logistica/embalaje`, `/produccion/calculadora-carpinteria`) devuelven 404; no hay redirecciones.

## Archivos tocados

- `src/lib/areas.config.ts`
- `src/pages/[area]/[tab].astro`
- `src/components/nav/TabsNav.astro`
- `src/pages/api/embalaje-escaneos.ts`, `espumado-stock.ts`, `vertical-guardar.ts`
