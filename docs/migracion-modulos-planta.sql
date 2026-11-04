-- Reestructuración de módulos: nuevo area_slug 'planta' (Calculadora Carpintería + Embalaje).
-- Herramientas de producción sigue siendo 'produccion' (ahora con Espumado, que venía de Test).
-- Correr en Supabase antes de subir a main. (permisos_modulo: user_id, area_slug, activo)

-- Planta: quien tenía Herramientas de producción o Logística
insert into permisos_modulo (user_id, area_slug, activo)
select user_id, 'planta', bool_or(activo) from permisos_modulo
where area_slug in ('produccion', 'logistica') group by user_id
on conflict (user_id, area_slug) do update set activo = excluded.activo;

-- Herramientas de producción: ahora incluye Espumado y Optimizador Vertical, que antes se veían con Test.
-- Quien tenía Test conserva el acceso a esas pestañas (y gana el resto de Herramientas de producción).
-- Si no querés eso, salteá este bloque y dalo de alta a mano desde Admin > Usuarios.
insert into permisos_modulo (user_id, area_slug, activo)
select user_id, 'produccion', true from permisos_modulo
where area_slug = 'test' and activo
on conflict (user_id, area_slug) do nothing;
