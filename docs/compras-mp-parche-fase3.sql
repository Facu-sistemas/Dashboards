-- Parche de la Fase 3 del módulo Compras MP. Correr UNA vez en el SQL editor de Supabase (sobre las tablas ya creadas).
-- Es idempotente. Las tablas tocadas están vacías, así que no se pierde nada.

-- 1) Excepciones: el libro usa respaldo "Ninguno" y el método "Sin proyección".
alter table public.cfg_excepciones drop constraint if exists cfg_excepciones_metodo_check;
alter table public.cfg_excepciones drop constraint if exists cfg_excepciones_respaldo_check;
alter table public.cfg_excepciones add constraint cfg_excepciones_metodo_check
  check (metodo is null or metodo in ('Coeficiente','Promedio','Agotar stock','Discontinuado','Consignado','Sin proyeccion','Sin proyección'));
alter table public.cfg_excepciones add constraint cfg_excepciones_respaldo_check
  check (respaldo is null or respaldo in ('Local','Brasil','China','Ninguno'));

-- 2) Control de OC vencidas: una OC puede tener dos líneas del mismo producto, así que la clave es la línea.
drop table if exists public.calc_control_oc;
create table public.calc_control_oc (
  corrida_id uuid not null references public.compras_corridas(id) on delete cascade,
  linea_id   integer not null,                 -- purchase.order.line.id
  oc_id      integer,                          -- purchase.order.id
  product_id integer,
  datos      jsonb not null,
  primary key (corrida_id, linea_id)
);
alter table public.calc_control_oc enable row level security;
revoke all on public.calc_control_oc from anon, authenticated;
grant select, insert, update, delete on public.calc_control_oc to service_role;

-- 3) Una sola corrida "corriendo" a la vez (evita que dos personas pisen la misma actualización).
create unique index if not exists compras_corridas_una_corriendo on public.compras_corridas ((true)) where estado = 'corriendo';
