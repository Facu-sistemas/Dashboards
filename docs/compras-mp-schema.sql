-- Esquema del módulo Compras MP (Finanzas > Compras MP). Correr en el SQL editor de Supabase.
-- Es idempotente: se puede correr de nuevo sin romper nada.
-- Mismo criterio que fichaje_caras: RLS activado y sin políticas (default-deny); solo accede
-- el service-role desde las /api routes. La inmutabilidad NO depende de RLS (el service-role la
-- saltea): la garantizan los triggers del final, que bloquean UPDATE/DELETE.

-- ============================================================ Corridas del motor
create table if not exists public.compras_corridas (
  id            uuid primary key default gen_random_uuid(),
  creada_en     timestamptz not null default now(),
  origen        text not null check (origen in ('cron','manual','golden','paralelo')),
  disparada_por text,                           -- email del usuario si fue manual
  fecha_datos   date not null,                  -- fecha de los datos de Odoo
  estado        text not null default 'corriendo' check (estado in ('corriendo','ok','error')),
  error         text,
  params        jsonb not null default '{}',    -- copia de parámetros/reglas/plan usados
  resumen       jsonb not null default '{}',    -- compra total, nº SKUs, etc.
  controles     jsonb not null default '[]'     -- [{control, estado: OK|AVISO|REVISAR|PENDIENTE, detalle}]
);
create index if not exists compras_corridas_fecha_idx on public.compras_corridas (creada_en desc);

-- ============================================================ raw_*: fotos crudas de Odoo
create table if not exists public.raw_compras (
  id          uuid primary key default gen_random_uuid(),
  corrida_id  uuid not null references public.compras_corridas(id) on delete cascade,
  fuente      text not null,   -- base | consumo | oc | stock_fin_mes | gasto | cond_pago | facturas | pagos | impuestos | gastos_imp | recepciones_sin_facturar | tipo_cambio
  fecha_datos date not null,
  hash        text not null,   -- sha256 del contenido, para detectar si cambió
  filas       integer not null,
  datos       jsonb not null,
  unique (corrida_id, fuente)
);

-- ============================================================ cfg_*: reglas editables (con auditoría)
create table if not exists public.cfg_parametros (
  clave          text primary key,             -- ej. sommier_pct_ventas, ss_abc, origenes, umbral_A...
  valor          jsonb not null,
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);

create table if not exists public.cfg_reglas (
  tipo           text not null,                -- linea_categoria | origen_proveedor | quimico_principal | cond_pago_default | coleccion
  clave          text not null,
  valor          jsonb not null,
  actualizado_en timestamptz not null default now(),
  actualizado_por text,
  primary key (tipo, clave)
);

create table if not exists public.cfg_excepciones (   -- 72 filas hoy (Parámetros L:S desde fila 40)
  product_id     integer primary key,          -- product.product.id (la clave es el id, no el nombre)
  sku_nombre     text not null,                -- solo informativo
  metodo         text check (metodo in ('Coeficiente','Promedio','Agotar stock','Discontinuado','Consignado','Sin proyeccion')),
  critico        boolean not null default false,
  costo          numeric,
  consumo_mensual numeric,
  origen         text check (origen in ('Local','Brasil','China')),
  respaldo       text check (respaldo in ('Local','Brasil','China')),
  comentario     text,
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);

create table if not exists public.cfg_plan (          -- IN_Plan: un valor por concepto y mes
  anio     integer not null,
  mes      integer not null check (mes between 1 and 12),
  concepto text not null,                      -- dias_habiles | prod_real_colchones | prod_consensuada_colchones | prod_real_sillones | prod_consensuada_sillones | ventas_consensuadas
  valor    numeric,
  actualizado_en timestamptz not null default now(),
  actualizado_por text,
  primary key (anio, mes, concepto)
);

create table if not exists public.cfg_auditoria (     -- append-only: quién, cuándo, valor anterior y nuevo
  id        bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  usuario   text not null,
  tabla     text not null,
  clave     text not null,
  anterior  jsonb,
  nuevo     jsonb
);

-- ============================================================ calc_*: resultados del motor por corrida
create table if not exists public.calc_sku (          -- una fila por SKU (todas las columnas de Cálculo SKU en datos)
  corrida_id uuid not null references public.compras_corridas(id) on delete cascade,
  product_id integer not null,
  sku        text not null,
  categoria  text,
  linea      text,
  origen     text,
  abc        text,
  datos      jsonb not null,
  primary key (corrida_id, product_id)
);

create table if not exists public.calc_sku_mes (      -- una fila por SKU y mes (lo mismo que la hoja Exportar)
  corrida_id uuid not null references public.compras_corridas(id) on delete cascade,
  product_id integer not null,
  mes        text not null,                    -- AAAA-MM
  llegada_u  numeric, llegada_ars numeric,
  regular_u  numeric, china_u numeric, respaldo_u numeric,
  emitir_u   numeric, emitir_ars numeric,
  faltante_u numeric, consumo_proy_u numeric, deficit_u numeric, entrante_u numeric,
  primary key (corrida_id, product_id, mes)
);

create table if not exists public.calc_desembolsos (  -- las 88 cifras de la hoja Desembolsos
  corrida_id uuid not null references public.compras_corridas(id) on delete cascade,
  mes        text not null,
  tipo       text not null,                    -- pagado | proyectado
  concepto   text not null,                    -- neto | iva | percepciones | gastos_imp_* | facturas_abiertas | oc_emitidas | presupuesto_*
  valor      numeric not null,
  primary key (corrida_id, mes, tipo, concepto)
);

create table if not exists public.calc_control_oc (   -- hoja Control OC vencidas
  corrida_id uuid not null references public.compras_corridas(id) on delete cascade,
  oc_id      integer not null,
  product_id integer not null,
  datos      jsonb not null,                   -- días de atraso, % recibido, sugerencia, etc.
  primary key (corrida_id, oc_id, product_id)
);

-- ============================================================ Decisiones sobre OC vencidas (historial; vale la última)
create table if not exists public.oc_decisiones (
  id          bigint generated always as identity primary key,
  oc_id       integer not null,
  product_id  integer not null,
  decision    text not null check (decision in ('Llega','Cerrar saldo','Reclamar','Reprogramada')),
  nueva_fecha date,
  comentario  text,
  usuario     text not null,
  creado_en   timestamptz not null default now()
);
create index if not exists oc_decisiones_oc_idx on public.oc_decisiones (oc_id, product_id, creado_en desc);

-- ============================================================ version_*: presupuestos aprobados (inmutables)
create table if not exists public.version_presupuesto (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,                   -- ej. "Oct-Ene 2026"
  horizonte   text[] not null,                 -- meses AAAA-MM
  corrida_id  uuid not null references public.compras_corridas(id),
  aprobada_por text not null,
  aprobada_en timestamptz not null default now(),
  total_compra numeric not null,
  params      jsonb not null,
  vigente     boolean not null default true    -- único campo "lógico": se resuelve con una nueva versión, ver nota abajo
);

create table if not exists public.version_sku_mes (
  version_id uuid not null references public.version_presupuesto(id),
  product_id integer not null,
  mes        text not null,
  datos      jsonb not null,
  primary key (version_id, product_id, mes)
);

create table if not exists public.version_desembolso (
  version_id uuid not null references public.version_presupuesto(id),
  mes        text not null,
  tipo       text not null,
  concepto   text not null,
  valor      numeric not null,
  primary key (version_id, mes, tipo, concepto)
);

-- ============================================================ cierre_*: cierres mensuales de indicadores (inmutables)
create table if not exists public.cierre_mensual (
  id          uuid primary key default gen_random_uuid(),
  mes         text not null,                   -- AAAA-MM
  revision    integer not null default 1,      -- una corrección = revisión nueva, nunca se pisa
  indicadores jsonb not null,                  -- N1/N2 de compras e inventario
  fecha_datos date not null,
  corrida_id  uuid references public.compras_corridas(id),
  usuario     text not null,
  creado_en   timestamptz not null default now(),
  unique (mes, revision)
);

-- ============================================================ RLS: default-deny (acceso solo por service-role desde /api)
do $$
declare t text;
begin
  foreach t in array array[
    'compras_corridas','raw_compras','cfg_parametros','cfg_reglas','cfg_excepciones','cfg_plan','cfg_auditoria',
    'calc_sku','calc_sku_mes','calc_desembolsos','calc_control_oc','oc_decisiones',
    'version_presupuesto','version_sku_mes','version_desembolso','cierre_mensual']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ============================================================ Inmutabilidad (triggers: valen también para el service-role)
create or replace function public.compras_bloquear_modificacion() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % es inmutable: solo se permite INSERT (las correcciones van como revisión nueva).', tg_table_name;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'version_sku_mes','version_desembolso','cierre_mensual','cfg_auditoria','oc_decisiones']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_inmutable', t);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.compras_bloquear_modificacion()',
      t || '_inmutable', t);
  end loop;
end $$;

-- version_presupuesto: inmutable salvo pasar "vigente" de true a false (cuando se aprueba una versión nueva).
create or replace function public.compras_version_solo_vigente() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las versiones aprobadas no se pueden borrar.';
  end if;
  if (to_jsonb(new) - 'vigente') is distinct from (to_jsonb(old) - 'vigente') or new.vigente = true and old.vigente = false then
    raise exception 'Las versiones aprobadas son inmutables (solo se puede quitar la marca "vigente").';
  end if;
  return new;
end $$;

drop trigger if exists version_presupuesto_inmutable on public.version_presupuesto;
create trigger version_presupuesto_inmutable before update or delete on public.version_presupuesto
  for each row execute function public.compras_version_solo_vigente();
