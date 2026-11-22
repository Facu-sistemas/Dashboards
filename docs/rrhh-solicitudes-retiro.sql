-- Solicitudes de retiro anticipado (las crea el empleado desde /empleados, las resuelve RRHH en RRHH > Solicitudes).
-- Correr en el SQL editor de Supabase. RLS default-deny: el acceso es solo vía service_role desde el servidor.
create table if not exists public.rrhh_solicitudes_retiro (
  id uuid primary key default gen_random_uuid(),
  empleado_id integer not null,                       -- hr.employee.id en Odoo
  empleado_nombre text not null,
  fecha date not null,                                -- día del retiro
  hora_retiro text not null,                          -- "HH:MM"
  motivo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  creada_en timestamptz not null default now(),
  resuelta_por text,                                  -- usuario de la web que resolvió
  resuelta_en timestamptz,
  comentario_rrhh text,
  visto_empleado_en timestamptz                       -- cuándo el empleado vio la respuesta de RRHH (null = todavía no)
);
create index if not exists rrhh_solicitudes_retiro_empleado_idx on public.rrhh_solicitudes_retiro (empleado_id, creada_en desc);
create index if not exists rrhh_solicitudes_retiro_estado_idx on public.rrhh_solicitudes_retiro (estado, creada_en desc);
alter table public.rrhh_solicitudes_retiro enable row level security;
revoke all on public.rrhh_solicitudes_retiro from anon, authenticated;
grant all on public.rrhh_solicitudes_retiro to service_role;

-- ─── Si la tabla ya existía (primera versión): correr este bloque para sumar 'cancelada' y el "visto" del empleado. ───
alter table public.rrhh_solicitudes_retiro add column if not exists visto_empleado_en timestamptz;
alter table public.rrhh_solicitudes_retiro drop constraint if exists rrhh_solicitudes_retiro_estado_check;
alter table public.rrhh_solicitudes_retiro add constraint rrhh_solicitudes_retiro_estado_check
  check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada'));

-- ─── Notificaciones push de RRHH (celular/compu): una fila por dispositivo suscripto. ───
create table if not exists public.rrhh_push_suscripciones (
  endpoint text primary key,                          -- URL única que da el navegador para ese dispositivo
  p256dh text not null,
  auth text not null,
  usuario text not null,                              -- usuario de la web que la activó
  creada_en timestamptz not null default now()
);
alter table public.rrhh_push_suscripciones enable row level security;
revoke all on public.rrhh_push_suscripciones from anon, authenticated;
grant all on public.rrhh_push_suscripciones to service_role;
