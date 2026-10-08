# Compras MP — presupuesto de compras de materia prima

Módulo de la web (Compras → tab **Compras MP**) que reemplaza el libro *Presupuesto_Compras_MP_v12* de Compras. Lee Odoo en **solo lectura**, calcula en la propia web (sin Python ni procesos externos) y guarda todo en Supabase.

## Cómo funciona

```
Odoo 17 (solo lectura) ──► corrida ──► Supabase (raw_compras, calc_*) ──► pantallas
   consultas JSON-RPC        motor TS      fotos crudas + resultados        solo leen
```

- **Corrida** (`src/lib/compras-mp/corrida.ts`): lee Odoo → guarda las fotos crudas con hash → calcula (motor, desembolsos, control de OC, inventario, controles) → guarda los resultados. Tarda ~45–50 s. Una sola a la vez.
- **Recálculo**: al cambiar un parámetro se recalcula con las fotos de la última corrida (sin tocar Odoo, ~8 s).
- Las pantallas **nunca calculan**: leen lo guardado (`/api/compras-mp/datos?vista=…`).
- Los insumos se identifican por **`product_id`** de Odoo (no por nombre), así sobreviven a renombres.

## Quién puede qué

| Acción | Quién |
|---|---|
| Ver las pantallas | Cualquier usuario con acceso al área Compras |
| Actualizar ahora, Parámetros, Aprobar versión, Registrar cierre, decidir sobre OC vencidas | Solo el usuario `marly` y el rol `dev` (`src/lib/compras-mp/permisos.ts`) |

Toda ruta que escribe pasa por `negarSiNoEdita`. La corrida automática (`/api/compras-mp/cron`) no usa sesión: exige el secreto `CRON_SECRET`.

## Operación

- **Corrida diaria**: job `compras-mp-corrida-diaria` de `pg_cron` en Supabase (06:00 hora Argentina) que llama a `/api/compras-mp/cron` con `Authorization: Bearer <CRON_SECRET>`. Ver `docs/compras-mp-cron.sql`. Requiere `CRON_SECRET` cargado en Vercel.
- **Límite de tiempo**: las funciones de Vercel quedaron en 60 s (`maxDuration` en `astro.config.mjs`). Si una corrida se acerca a ese límite, hay que partirla en dos pasos (leer Odoo / calcular).
- **Limpieza**: tras cada corrida se borran las viejas (se conservan 14 días, las últimas 5 y todas las que respaldan una versión aprobada o un cierre).
- **Reglas de reabastecimiento**: la web genera el archivo; **no escribe en Odoo**. Importarlo a mano, primero en staging.

## Datos que no salen de Odoo

- **Plan** (producción real y consensuada, ventas consensuadas): se carga en Parámetros → Plan mensual (`cfg_plan`). Los días hábiles salen del calendario laboral de Odoo si no se cargan.
- **Reglas, excepciones y parámetros**: `cfg_*`, con auditoría en `cfg_auditoria`.

## Cosas inmutables

Versiones aprobadas (`version_*`), cierres (`cierre_mensual`), decisiones de OC y auditoría solo aceptan INSERT: lo garantizan triggers de Supabase (valen también para el service-role). Una corrección es una versión o revisión nueva.

## Pruebas (`tests/compras-mp/`)

Se corren con el paquete de referencia (libro v12 + exportaciones de Odoo del 06/10/2026) en una carpeta:

| Prueba | Comando | Qué verifica |
|---|---|---|
| Golden | `node tests/compras-mp/golden.ts <paquete>` | Motor, desembolsos (88 cifras), control de OC, inventario y KPI contra el libro: 0 diferencias |
| Robustez | `node tests/compras-mp/robustez.ts <paquete> <escenarios>` | Motor TS vs motor Python en 4 escenarios |
| Seguimiento | `node tests/compras-mp/seguimiento.ts` | Cumplimiento con un caso armado a mano |
| Paridad con Odoo | `node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/paridad-*.ts <paquete>` | Conectores vs exportaciones de Compras |
| Corrida / Fase 5 / retención / humo de pantallas | `… ejecutar-con-odoo.mjs tests/compras-mp/prueba-corrida.ts` (y `prueba-fase5.ts`, `prueba-retencion.ts`, `ui-humo.tsx`) | De punta a punta contra Supabase y Odoo reales |

## Límites conocidos

- **Cambio de año**: una corrida en enero cruza de año y el motor solo lo avisa con un control; hay que resolverlo antes de diciembre.
- **Gasto real**: la exportación de Compras incluía las dos empresas (Frontera Living y "Presupuesto"); la corrida usa solo Frontera. El Seguimiento permite elegir empresas para el "facturado de referencia".
- **Recepciones sin facturar**: acotadas a las OC de los últimos 60 días (las facturas viejas cargadas sin vincular a la OC darían una deuda inexistente).
- **Producto con stock absurdo en Odoo** (`POLIESTER AZUL - HIPER`, un intermedio de espuma, no es MP): no afecta al presupuesto, pero conviene corregirlo en Odoo.
- Productos con el mismo nombre (`HILO VAHE COLORES FL`, `NYLON BOLSA 100X200X80 COPITO`): el cálculo los distingue por ID; el archivo de reabastecimiento los busca por nombre y puede confundirlos al importar.
