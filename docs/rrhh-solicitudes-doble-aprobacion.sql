-- Solicitudes de retiro con doble aprobación (RRHH + un líder o dev) y marca "Líder" en las cuentas.
-- Correr UNA vez en el SQL editor de Supabase, ANTES de subir el cambio a producción. Es seguro repetirlo.

-- 1) Marca de líder en cada cuenta (se tilda desde /admin/usuarios; el dev cuenta como líder sin tildar nada).
alter table public.perfiles add column if not exists es_lider boolean not null default false;

-- 2) Las dos aprobaciones de cada solicitud: quién y cuándo, más el comentario del líder.
alter table public.rrhh_solicitudes_retiro
  add column if not exists aprobo_rrhh_por text,
  add column if not exists aprobo_rrhh_en timestamptz,
  add column if not exists aprobo_lider_por text,
  add column if not exists aprobo_lider_en timestamptz,
  add column if not exists comentario_lider text;

-- Las que ya estaban aprobadas antes de este cambio quedan como están (aprobadas): no se vuelven a pedir los checks.
