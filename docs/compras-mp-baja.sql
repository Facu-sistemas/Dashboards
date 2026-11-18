-- Baja del módulo "Compras MP" (el viejo, con motor propio). Correr en el SQL editor de Supabase.
-- IRREVERSIBLE: borra versiones aprobadas, cierres mensuales, parámetros y decisiones de OC.
-- El tablero nuevo ("Presupuesto y cumplimiento MP") no usa ninguna de estas tablas.
-- NO toca presupuesto_mp_linea (la usa otro componente de Compras que sigue en el código).

-- 1) Programadores de la corrida diaria (si se llegaron a crear). Si no existe pg_cron, este bloque no hace nada.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobname) from cron.job
     where jobname in ('compras-mp-corrida-diaria', 'compras-mp-leer-odoo', 'compras-mp-calcular');
  end if;
end $$;

-- 2) Tablas (los triggers de inmutabilidad se van con ellas)
drop table if exists public.calc_control_oc    cascade;
drop table if exists public.calc_desembolsos   cascade;
drop table if exists public.calc_sku_mes       cascade;
drop table if exists public.calc_sku           cascade;
drop table if exists public.oc_decisiones      cascade;
drop table if exists public.version_sku_mes    cascade;
drop table if exists public.version_desembolso cascade;
drop table if exists public.version_presupuesto cascade;
drop table if exists public.cierre_mensual     cascade;
drop table if exists public.raw_compras        cascade;
drop table if exists public.compras_corridas   cascade;
drop table if exists public.cfg_auditoria      cascade;
drop table if exists public.cfg_plan           cascade;
drop table if exists public.cfg_excepciones    cascade;
drop table if exists public.cfg_reglas         cascade;
drop table if exists public.cfg_parametros     cascade;

-- 3) Funciones de los triggers
drop function if exists public.compras_bloquear_modificacion();
drop function if exists public.compras_version_solo_vigente();
