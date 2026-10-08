-- Corrida automática diaria de Compras MP, programada desde Supabase (pg_cron + pg_net).
-- Funciona igual en cualquier plan de Vercel: Supabase llama a la web una vez por día y la web hace el trabajo.
--
-- ANTES de correrlo:
--   1) En Supabase: Database > Extensions: activar "pg_cron" y "pg_net".
--   2) Generar un secreto largo (por ejemplo con:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
--      y cargarlo en Vercel como variable de entorno CRON_SECRET (Production) y volver a desplegar.
--   3) Reemplazar abajo TU-DOMINIO y TU-SECRETO.
--
-- Horario: 06:00 hora Argentina = 09:00 UTC (pg_cron trabaja en UTC).

select cron.schedule(
  'compras-mp-corrida-diaria',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://TU-DOMINIO/api/compras-mp/cron',
    headers := jsonb_build_object('Authorization', 'Bearer TU-SECRETO', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Para ver si corrió:        select * from cron.job_run_details order by start_time desc limit 5;
-- Para desprogramarlo:       select cron.unschedule('compras-mp-corrida-diaria');
