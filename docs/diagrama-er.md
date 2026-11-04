# Diagrama entidad-relación (Test → Diagrama ER)

Pestaña nueva en el área **Test** que muestra cómo están armadas las tablas propias de la web en Supabase y cómo se relacionan entre sí. Pensada para presentar el modelo de datos.

## Qué se hizo

- Componente [ErDiagramApp.tsx](../src/components/test/ErDiagramApp.tsx): diagrama SVG hecho a mano, sin librerías de diagramas.
- Wrapper [ErDiagramTab.astro](../src/components/test/ErDiagramTab.astro) y registro de la pestaña `diagrama-er` en `src/lib/areas.config.ts` y `src/pages/[area]/[tab].astro`.
- Solo lectura: no toca ni la base ni Odoo.

## Qué muestra

44 tablas en 11 grupos:

| Grupo | Tablas |
|---|---|
| Acceso y permisos | `auth.users`, `perfiles`, `permisos_modulo` |
| Compras MP — corridas y resultados | `compras_corridas`, `raw_compras`, `calc_sku`, `calc_sku_mes`, `calc_desembolsos`, `calc_control_oc`, `oc_decisiones` |
| Compras MP — versiones y cierres | `version_presupuesto`, `version_sku_mes`, `version_desembolso`, `cierre_mensual` |
| Compras MP — configuración | `cfg_parametros`, `cfg_reglas`, `cfg_excepciones`, `cfg_plan`, `cfg_auditoria` |
| Líneas de sillones | `lineas_sillon_lineas`, `_personas`, `_alias`, `_tiempos`, `_manuales`, `_planes`, `_ignoradas` |
| Planificado línea | `linea_mesas`, `linea_tap_reglas` |
| Fichaje y RRHH | `fichaje_caras`, `fichaje_marcas`, `rrhh_resumen_estado` |
| Logística | `embalaje_escaneos` |
| Optimizador vertical | `vertical_sobrantes`, `vertical_cortes_sesiones` |
| Producción y calidad | `espumado_dia`, `seguimiento_mo_umbrales`, `cnc_parametros`, `costo_devoluciones_tarifas`, `presupuesto_mp_linea` |
| Rentabilidad (propuesta) | `rentabilidad_configuracion`, `_contribucion_objetivos`, `_parametros_costeo` |

Cada tabla lista sus columnas con tipo y marca `PK` / `FK` / `ODOO`. Las líneas llevan cardinalidad (1, N) y el nombre de la columna que une.

## Cómo se usa

- Filtro por grupo (botones arriba).
- Zoom con − / + y volver a 100 %.
- Tocar una tabla resalta sus relaciones y atenúa el resto; tocar el fondo deselecciona.
- Respeta el tema claro/oscuro de la web.

## Convenciones del diagrama

- **Línea continua:** relación con clave foránea.
- **Línea punteada:** relación lógica; el código la usa pero no hay FK declarada (por ejemplo `lineas_sillon_manuales.linea`, o `asignados` en JSON hacia `lineas_sillon_personas`).
- **ODOO:** columna que guarda un id de Odoo (producto, empleado, orden). Odoo es solo lectura y por API, por eso sus tablas no se dibujan.

## Origen de los datos y límites

El repo no tiene migraciones. El esquema sale de:

1. Los bloques `create table` documentados en `src/lib/supabase/*.ts` y `src/lib/rentabilidad/schema.sql`.
2. Las consultas del código, para las tablas sin `create table` documentado (acceso, Compras MP, `fichaje_caras`, vertical). Sus columnas están **inferidas**, no verificadas contra Supabase.

Puntos a confirmar en la base real si hace falta exactitud:

- Tipos exactos de las tablas inferidas.
- Que `corrida_id` sea efectivamente foreign key en Compras MP (se dedujo de cómo se borran las corridas).
- Las tablas de Rentabilidad son una propuesta (`schema.sql` dice "NO ejecutada").

Todas las tablas tienen RLS activado sin políticas: solo se accede desde el servidor con la clave de servicio.

## Mantenimiento

Para agregar una tabla o relación, editar los arreglos `TABLAS` y `RELACIONES` de `ErDiagramApp.tsx`. Las coordenadas son manuales; los grupos "de abajo" se desplazan con la constante `DESPLAZAR`.
