-- Tabla propia de los costeos de Finanzas (tabs "(test)": Costos productos / Facturación productos).
-- Parámetros de costeo editables. Claves que lee src/lib/odoo/rentabilidad/contribucion.ts y costos-productos-test.ts:
--   coef_indirecta_no_colchon (1.55; si falta, se usa ese default), valor_hora_productivo, valor_hora_YYYY_MM.
-- Funciona sin la tabla (defaults en el código). RLS activado sin policies (default-deny); acceso solo desde el servidor con service_role.
-- Las pestañas "Rentabilidad clientes" y "Rentabilidad categorías" se eliminaron: sus tablas (rentabilidad_configuracion y
-- rentabilidad_contribucion_objetivos) ya no se usan y se borran con el SQL de limpieza.

create table if not exists public.rentabilidad_parametros_costeo (
  clave text primary key,
  valor numeric not null,
  descripcion text,
  actualizado_por text,
  updated_at timestamptz not null default now()
);

alter table public.rentabilidad_parametros_costeo enable row level security;
grant select, insert, update, delete on public.rentabilidad_parametros_costeo to service_role;
