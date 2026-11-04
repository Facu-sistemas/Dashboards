# Líneas de Sillones (Test)

Fecha: 26/10/2026 · Commits: `589793e`, `584dc6f`, `7e51889`

Planificador de líneas que reemplaza la planilla LEAN TIEMPOS. Solo lectura sobre Odoo.

## Qué hace
- Reporte de hoy por línea (carpintería, tapicería, ensamble) desde las órdenes de Odoo.
- Tiempos tomados de la hoja DATOS, con segundos exactos.
- Personas por puesto, con preferencias de producto.
- Equivalencias Odoo→DATOS y productos manuales.
- Adelanto por defecto en paralelo, como la planilla.

## PDF
- Idéntico a la planilla HORARIOS: 3 bloques por línea, 45 filas, U.E. y eficiencia sobre 14:08. Una hoja por línea.
- Encabezado con el logo de Frontera Living y la fecha completa.

## Plan del día
- Se guarda en `lineas_sillon_planes`.
- Se fija solo si se abre antes de las 9, o a mano.
- Se puede alternar con "En vivo".

## Personas
- Buscador de empleados de Odoo (`empleado_id`).
- Botón Borrar en cada tarjeta.

## Archivos
`src/components/test/LineasSillon*`, `src/components/test/lineas-sillon-pdf.ts`, `src/lib/lineas-sillon/*`, `src/lib/odoo/lineas-sillon.ts`, `src/lib/supabase/lineas-sillon.ts`, `src/pages/api/lineas-sillon.ts`
