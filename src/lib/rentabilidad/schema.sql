-- PROPUESTA — NO ejecutada. Tablas propias de las pestañas "Rentabilidad clientes" y
-- "Rentabilidad categorías" (área Finanzas, slug 'finanzas') en el Supabase de la Web.
-- Odoo es la fuente de todo lo calculable (ventas, cantidades, costos); acá solo vive lo
-- EDITABLE por el usuario. Funciona sin estas tablas (objetivo 48 / verde >= 48 / amarillo >= 42,
-- ver src/lib/rentabilidad/config.ts). RLS activado sin policies (default-deny) y acceso solo
-- desde el servidor con service_role (src/lib/supabase/rentabilidad-config.ts).
-- Las pestañas usan el permiso del área 'finanzas' que ya existe: no hace falta tocar permisos_modulo.

-- ============================================================================
-- A) Si NO existen tablas previas: crear con los nombres definitivos (bloque B más abajo).
-- C) Si ya existen las tablas con el nombre viejo (prefijo "anto_"): NO ejecutar A/B; ejecutar solo este bloque.
-- ============================================================================
-- alter table if exists public.anto_configuracion rename to rentabilidad_configuracion;
-- alter table if exists public.anto_contribucion_objetivos rename to rentabilidad_contribucion_objetivos;
-- alter table if exists public.anto_parametros_costeo rename to rentabilidad_parametros_costeo;

-- B) Creación (idempotente).
create table if not exists public.rentabilidad_configuracion (
  id integer primary key default 1 check (id = 1),
  contribucion_objetivo numeric not null default 48,
  umbral_verde numeric not null default 48,
  umbral_amarillo numeric not null default 42,
  actualizado_por text,
  updated_at timestamptz not null default now()
);
insert into public.rentabilidad_configuracion (id) values (1) on conflict (id) do nothing;

-- Objetivo de contribución y umbrales por categoría raíz de Odoo (product.category: Sillon, Colchones, ...).
create table if not exists public.rentabilidad_contribucion_objetivos (
  categoria text primary key,
  contribucion_objetivo numeric not null,
  umbral_verde numeric not null,
  umbral_amarillo numeric not null,
  actualizado_por text,
  updated_at timestamptz not null default now()
);

-- Parámetros de costeo editables (tipo de cambio de costeo, % de fijos, tarifas MOD, etc.).
-- Claves que lee src/lib/odoo/rentabilidad/contribucion.ts (defaults de septiembre 2026 si faltan):
--   valor_hora_productivo (override general), valor_hora_YYYY_MM (ej. valor_hora_2026_09 = 20869.1054),
--   coef_indirecta_no_colchon (1.55). A futuro: pozos mensuales de no productiva y fijos (hoy no entran en la contribución de fila).
create table if not exists public.rentabilidad_parametros_costeo (
  clave text primary key,
  valor numeric not null,
  descripcion text,
  actualizado_por text,
  updated_at timestamptz not null default now()
);

alter table public.rentabilidad_configuracion enable row level security;
alter table public.rentabilidad_contribucion_objetivos enable row level security;
alter table public.rentabilidad_parametros_costeo enable row level security;

grant select, insert, update, delete on public.rentabilidad_configuracion to service_role;
grant select, insert, update, delete on public.rentabilidad_contribucion_objetivos to service_role;
grant select, insert, update, delete on public.rentabilidad_parametros_costeo to service_role;
