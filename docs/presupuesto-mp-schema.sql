-- Estado publicado del tablero "Presupuesto y cumplimiento MP" (Compras). Una sola fila: la última versión subida desde el libro.
-- Correr en el SQL editor de Supabase. Sin esta tabla el tablero muestra la foto incluida en el código (src/data/presupuesto-mp.json).
create table if not exists public.presupuesto_mp_estado (
  id int primary key check (id = 1),
  datos jsonb not null,
  actualizado_por text,
  updated_at timestamptz not null default now()
);
alter table public.presupuesto_mp_estado enable row level security;  -- default-deny, acceso solo vía /api
grant select, insert, update, delete on public.presupuesto_mp_estado to service_role;
