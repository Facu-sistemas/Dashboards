-- Tabla para el tab Test > Fichaje (reconocimiento facial). Correr en el SQL editor de Supabase.
create table if not exists public.fichaje_caras (
  id uuid primary key default gen_random_uuid(),
  empleado_id integer not null,          -- hr.employee.id en Odoo
  empleado_nombre text not null,
  descriptor jsonb not null,             -- vector de 128 floats, no es una foto
  creado_en timestamptz not null default now()
);
create index if not exists fichaje_caras_empleado_idx on public.fichaje_caras (empleado_id);
-- RLS default-deny: solo accede el service-role desde las /api routes.
alter table public.fichaje_caras enable row level security;
