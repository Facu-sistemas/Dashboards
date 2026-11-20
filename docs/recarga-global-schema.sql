-- Recarga remota de todas las páginas abiertas (botón en Admin). Una sola fila: cuándo se pidió la última recarga.
-- RLS default-deny: el acceso es solo vía service_role desde el servidor.
create table if not exists public.recarga_global (
  id int primary key default 1 check (id = 1),
  recargar_en timestamptz not null default now()
);
insert into public.recarga_global (id) values (1) on conflict do nothing;
alter table public.recarga_global enable row level security;
grant select, insert, update on public.recarga_global to service_role;
