-- RRHH > Planilla: parámetros de la quincena (Total hs, Feriados, Viático) y ajustes por persona.
-- Correr una vez en el SQL editor de Supabase. Ver src/lib/supabase/rrhh-planilla-parametros.ts.
create table if not exists public.rrhh_planilla_parametros (
  desde date not null,
  hasta date not null,
  empleado_id integer not null default 0,     -- 0 = toda la columna; si no, hr.employee.id
  campo text not null check (campo in ('totalHs', 'feriadosHs', 'viaticoDias')),
  valor numeric not null check (valor >= 0),
  cargado_por text not null,
  cargado_en timestamptz not null default now(),
  primary key (desde, hasta, empleado_id, campo)
);
alter table public.rrhh_planilla_parametros enable row level security;
revoke all on public.rrhh_planilla_parametros from anon, authenticated;
grant all on public.rrhh_planilla_parametros to service_role;
