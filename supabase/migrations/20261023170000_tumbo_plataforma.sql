-- =========================================================================
-- Tumbo Market — Plataforma (ola 2)
-- -------------------------------------------------------------------------
-- No redefine ninguna función de negocio. Agrega:
--   · Tareas programadas comunes: catálogo de todas las tumbo_privado.tarea_*
--     (tumbo.tareas_programadas), envoltorio que registra cada corrida
--     (tumbo_privado.correr_tarea → tumbo.tareas_ejecuciones: inicio, fin,
--     resultado y error) y programación con pg_cron (solo donde existe) con
--     nombres «tumbo-*»: los trabajos que ya programó cada dominio se
--     reutilizan (mismo nombre y horario, solo cambia la orden por el
--     envoltorio), nunca se duplican.
--   · Dos tareas propias: tumbo-almacenamiento (limpieza de archivos por la
--     función tumbo-archivos con pg_net) y tumbo-mantenimiento (purga de lo
--     operativo viejo).
--   · Observabilidad: tumbo.errores_cliente (errores del navegador y RPC
--     fallidas, sin datos personales, con tope por red y global) y
--     tm_salud() público mínimo.
--   · admin/sistema: tm_sistema (estado de cada tarea, tasa, bandeja,
--     errores recientes y almacenamiento; a una cuenta de prueba, sin el
--     detalle), tm_tarea_correr y tm_tareas_programar (superadministración
--     con sesión elevada).
--   · El ajuste demo_activa: en false, el reinicio de la demo se rechaza
--     para todos (lo frena sembrar_ext_plataforma).
-- Solo agrega (create table / function, insert … on conflict do nothing).
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Tareas programadas: catálogo y corridas
-- ---------------------------------------------------------------------------
-- Una fila por tarea: la función tumbo_privado.tarea_* que corre, el nombre
-- de su trabajo en pg_cron («tumbo-…»; null: no se programa aquí) y su
-- horario (cron de 5 campos, en UTC; si su dominio ya la programó, manda el
-- horario de ese trabajo). cada_min es la frecuencia esperada: con pg_cron,
-- una tarea sin corrida buena en el doble de ese tiempo se marca atrasada.
create table tumbo.tareas_programadas (
  tarea       text primary key check (tarea ~ '^[a-z][a-z0-9_]{1,40}$'),
  funcion     text not null unique check (funcion ~ '^tarea_[a-z0-9_]{1,50}$'),
  trabajo     text unique check (trabajo ~ '^tumbo-[a-z0-9-]{1,50}$'),
  horario     text check (horario ~ '^[0-9*/,-]+( [0-9*/,-]+){4}$'),
  dominio     text not null,
  descripcion text not null,
  manual      boolean not null default true,      -- se puede correr a mano desde admin/sistema
  cada_min    integer check (cada_min > 0),
  creado      timestamptz not null default now()
);
alter table tumbo.tareas_programadas enable row level security;
revoke all on tumbo.tareas_programadas from public, anon, authenticated;

-- Cada corrida (programada o a mano). La fila se escribe al terminar, en la
-- misma transacción que la tarea: si la tarea falla, su trabajo se deshace y
-- aquí queda el error; si la transacción entera muere (tiempo límite,
-- reinicio), lo dice cron.job_run_details, que admin/sistema también lee.
create table tumbo.tareas_ejecuciones (
  id        bigint generated always as identity primary key,
  tarea     text not null,
  inicio    timestamptz not null,
  fin       timestamptz not null,
  ok        boolean not null,
  resultado jsonb,
  error     text,
  origen    text not null check (origen in ('programada', 'manual', 'prueba')),
  por       text,
  por_id    uuid           -- la cuenta que la corrió a mano (null: pg_cron o una prueba)
);
create index tareas_ejecuciones_tarea_idx on tumbo.tareas_ejecuciones (tarea, inicio desc);
create index tareas_ejecuciones_inicio_idx on tumbo.tareas_ejecuciones (inicio);
alter table tumbo.tareas_ejecuciones enable row level security;
revoke all on tumbo.tareas_ejecuciones from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Observabilidad: errores del navegador y RPC fallidas
-- ---------------------------------------------------------------------------
-- Sin datos personales: ni la cuenta, ni la red, ni la consulta de la URL;
-- el texto llega ya saneado (correos, números largos y fichas fuera). Una
-- fila por error distinto (huella): repetirse suma «veces». Como mucho
-- 5.000 filas (entra la nueva y sale la vista hace más tiempo) y se borran
-- a los 30 días sin verse.
create table tumbo.errores_cliente (
  id        bigint generated always as identity primary key,
  huella    text not null unique,
  tipo      text not null check (tipo in ('error', 'promesa', 'rpc', 'recurso')),
  mensaje   text not null,
  fuente    text,
  linea     integer,
  columna   integer,
  pila      text,
  pagina    text,
  vista     text,
  rpc       text,
  codigo    text,
  navegador text,
  version   text,
  modo      text,
  rol       text,
  primero   timestamptz not null default now(),
  ultimo    timestamptz not null default now(),
  veces     integer not null default 1
);
create index errores_cliente_ultimo_idx on tumbo.errores_cliente (ultimo desc);
alter table tumbo.errores_cliente enable row level security;
revoke all on tumbo.errores_cliente from public, anon, authenticated;

-- Contadores de los topes de la plataforma, por red y ventana (red «*»: el
-- techo global).
create table tumbo.topes_plataforma (
  red     text not null,
  tipo    text not null,
  ventana timestamptz not null,
  n       integer not null default 0,
  primary key (red, tipo, ventana)
);
alter table tumbo.topes_plataforma enable row level security;
revoke all on tumbo.topes_plataforma from public, anon, authenticated;

-- La dirección de las funciones del proyecto: con pg_net, tumbo-almacenamiento
-- le pide ahí la limpieza a tumbo-archivos. Pendiente hasta que la persona
-- dueña del proyecto la cargue (no se inventa).
-- El interruptor de la demo en el servidor: con false (al lanzar, ver
-- docs/PRODUCCION.md) el reinicio de la demo se rechaza para todos, también
-- para una cuenta real con sesión elevada (borraría los datos reales). En el
-- sitio, su par es TM_CONFIG.demo = false.
insert into tumbo.ajustes (clave, valor, tipo, vaciable, publico, descripcion) values
  ('funciones_url', 'null', 'string', true, false,
   'URL de las funciones del proyecto (https://<referencia>.supabase.co/functions/v1). Con pg_net, la tarea tumbo-almacenamiento llama ahí a la limpieza de archivos. null: sin configurar.'),
  ('demo_activa', 'true', 'boolean', false, false,
   'La demo está encendida (cuentas de prueba y «Reiniciar datos de la demo»). false al lanzar: el reinicio de la demo se rechaza para todos, porque borraría los pedidos y productos reales.')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
-- ¿Existe tumbo_privado.<funcion> y se puede llamar sin argumentos (todos
-- con valor por omisión)? (Su nombre no empieza por «tarea_»: no es una
-- tarea, y admin/sistema avisa de cada tarea_* sin catálogo.)
create function tumbo_privado.es_tarea_invocable(p_funcion text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_funcion ~ '^tarea_[a-z0-9_]{1,50}$', false) and exists (
    select 1 from pg_catalog.pg_proc p
    where p.pronamespace = 'tumbo_privado'::regnamespace and p.proname = p_funcion
      and p.prokind = 'f' and p.pronargs = p.pronargdefaults)
$$;

-- Texto de un error sin datos personales: correos, números largos
-- (teléfonos, cédulas, cuentas), fichas y claves largas fuera; las URL sin
-- su consulta; sin caracteres de control; recortado.
create function tumbo_privado.texto_error(p text, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(left(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(left(coalesce(p, ''), 8000), '[[:cntrl:]]+', ' ', 'g'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[correo]', 'g'),
      '(https?://[^[:space:]?#''"]*)[?#][^[:space:]''")]*', '\1', 'g'),
      '[?#][A-Za-z0-9_.%-]+=[^[:space:]''")]*', '', 'g'),
      '[A-Za-z0-9_+=-]{32,}', '[ficha]', 'g'),
      '\+?[0-9][0-9 .-]{5,}[0-9]', '[número]', 'g'),
    greatest(1, least(coalesce(p_max, 300), 4000)))), '')
$$;

-- Ruta de una página o un archivo del sitio: sin origen, consulta ni
-- fragmento; solo caracteres de ruta.
create function tumbo_privado.ruta_error(p text) returns text
language sql immutable set search_path = '' as $$
  select case when r ~ '^[A-Za-z0-9/_.~%-]{1,200}$' then r end
  from (select regexp_replace(regexp_replace(coalesce(p, ''), '^[a-z][a-z0-9+.-]*://[^/]*', ''), '[?#].*$', '') as r) x
$$;

-- Tope por red de la plataforma (ventana fija) y techo global (red «*»).
-- Cuenta el uso aunque se rechace. La red «desconocida» cuenta como una.
create function tumbo_privado.tope_plataforma(p_tipo text, p_por_red integer, p_global integer, p_ventana interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ventana timestamptz := date_bin(p_ventana, now(), timestamptz '2000-01-01');
  v_n integer;
begin
  if random() < 0.02 then
    delete from tumbo.topes_plataforma where ventana < now() - interval '1 day';
  end if;
  insert into tumbo.topes_plataforma as t (red, tipo, ventana, n) values (tumbo_privado.ip_cliente(), p_tipo, v_ventana, 1)
  on conflict (red, tipo, ventana) do update set n = t.n + 1
  returning n into v_n;
  if v_n > p_por_red then
    return false;
  end if;
  insert into tumbo.topes_plataforma as t (red, tipo, ventana, n) values ('*', p_tipo, v_ventana, 1)
  on conflict (red, tipo, ventana) do update set n = t.n + 1
  returning n into v_n;
  return v_n <= p_global;
end $$;

-- ---------------------------------------------------------------------------
-- El envoltorio: corre una tarea del catálogo y registra la corrida
-- ---------------------------------------------------------------------------
-- La tarea corre en un bloque propio: si falla, se deshace solo su trabajo y
-- queda el error (con el texto saneado). Dos corridas de la misma tarea no
-- se pisan: si la anterior sigue en curso, esta se registra como omitida.
-- Una tarea programada que falla avisa a la superadministración (una vez
-- cada 6 horas por tarea). p_por y p_por_id: el nombre y la cuenta de quien
-- la corre a mano (admin/sistema no le muestra a una cuenta de prueba el
-- nombre de una cuenta real).
create function tumbo_privado.correr_tarea(p_tarea text, p_origen text default 'programada', p_por text default null,
                                           p_por_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t tumbo.tareas_programadas;
  v_inicio timestamptz := clock_timestamp();
  v_void boolean;
  v_res jsonb;
  v_ok boolean;
  v_error text;
  v_estado text;
  v_texto text;
  v_id bigint;
begin
  if p_origen not in ('programada', 'manual', 'prueba') then
    raise exception 'Origen de corrida desconocido.';
  end if;
  select * into t from tumbo.tareas_programadas where tarea = p_tarea;
  if not found then
    raise exception 'La tarea «%» no está en el catálogo de tareas.', left(coalesce(p_tarea, ''), 60);
  end if;
  if not tumbo_privado.es_tarea_invocable(t.funcion) then
    v_ok := false;
    v_error := 'La función tumbo_privado.' || t.funcion || '() no existe en esta base.';
  elsif not pg_try_advisory_xact_lock(hashtextextended('tumbo:correr_tarea:' || t.tarea, 0)) then
    v_ok := true;
    v_res := jsonb_build_object('omitida', 'la corrida anterior seguía en curso');
  else
    select p.prorettype = 'pg_catalog.void'::pg_catalog.regtype into v_void
    from pg_catalog.pg_proc p
    where p.pronamespace = 'tumbo_privado'::regnamespace and p.proname = t.funcion and p.pronargs = p.pronargdefaults
    limit 1;
    begin
      if v_void then
        execute format('select tumbo_privado.%I()', t.funcion);
        v_res := 'null'::jsonb;
      else
        execute format('select to_jsonb(tumbo_privado.%I())', t.funcion) into v_res;
      end if;
      v_ok := true;
    exception when others then
      get stacked diagnostics v_texto = message_text, v_estado = returned_sqlstate;
      v_ok := false;
      v_error := coalesce(tumbo_privado.texto_error(v_estado || ': ' || v_texto, 1000), v_estado);
    end;
  end if;
  if v_res is not null and octet_length(v_res::text) > 8000 then
    v_res := jsonb_build_object('recortado', left(v_res::text, 2000));
  end if;
  insert into tumbo.tareas_ejecuciones (tarea, inicio, fin, ok, resultado, error, origen, por, por_id)
  values (t.tarea, v_inicio, clock_timestamp(), v_ok, v_res, v_error, p_origen, left(p_por, 120), p_por_id)
  returning id into v_id;
  if not v_ok and p_origen = 'programada'
     and not exists (select 1 from tumbo.tareas_ejecuciones e
                     where e.tarea = t.tarea and not e.ok and e.origen = 'programada' and e.id <> v_id
                       and e.inicio > now() - interval '6 hours') then
    perform tumbo_privado.notificar('rol:superadmin', 'La tarea programada «' || t.tarea || '» falló: revisa Sistema.',
                                    'error', 'admin/sistema.html', array['superadmin']);
  end if;
  return jsonb_build_object('id', v_id, 'tarea', t.tarea, 'ok', v_ok, 'resultado', v_res, 'error', v_error,
                            'inicio', v_inicio, 'fin', clock_timestamp(),
                            'ms', round(extract(epoch from clock_timestamp() - v_inicio) * 1000));
end $$;

-- ---------------------------------------------------------------------------
-- Tareas propias de la plataforma
-- ---------------------------------------------------------------------------
-- Limpieza del almacenamiento. Supabase no deja borrar objetos por SQL: con
-- pg_net y el ajuste funciones_url, se le pide a la función tumbo-archivos
-- ({accion: 'limpiar'}), que decide con tarea_archivos y borra en Storage.
-- Sin ellos, lo que Postgres puede hacer solo: descartar las subidas que no
-- se confirmaron a tiempo (los objetos los borra la función la próxima vez
-- que reciba una subida).
create function tumbo_privado.tarea_almacenamiento() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := nullif(btrim(coalesce(tumbo_privado.ajuste('funciones_url') #>> '{}', '')), '');
  v_req bigint;
  v jsonb;
begin
  if v_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[A-Za-z0-9._~/-]*)?$'
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 20000)'
      into v_req
      using rtrim(v_url, '/') || '/tumbo-archivos', '{"accion": "limpiar"}'::jsonb, '{"content-type": "application/json"}'::jsonb;
    return jsonb_build_object('via', 'función tumbo-archivos (pg_net)', 'solicitud', v_req);
  end if;
  v := tumbo_privado.tarea_archivos(100);
  return jsonb_build_object('via', 'solo SQL', 'por_borrar', jsonb_array_length(coalesce(v -> 'borrar', '[]'::jsonb)),
    'pendiente', case when v_url is null then 'falta el ajuste funciones_url para que la función borre los objetos'
                      when v_url !~ '^https://' then 'el ajuste funciones_url no es una dirección https'
                      else 'sin pg_net: la función borra los objetos cuando recibe subidas' end);
end $$;

-- Purga de lo operativo viejo: errores del navegador sin verse en 30 días,
-- corridas de más de 60 días, contadores de topes de más de un día y, si
-- hay pg_cron, el detalle de las corridas de los trabajos «tumbo-*» de más
-- de 14 días (pg_cron no lo purga solo).
create function tumbo_privado.tarea_mantenimiento() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n_err integer;
  n_eje integer;
  n_top integer;
  n_cron integer := null;
begin
  delete from tumbo.errores_cliente where ultimo < now() - interval '30 days';
  get diagnostics n_err = row_count;
  delete from tumbo.tareas_ejecuciones where inicio < now() - interval '60 days';
  get diagnostics n_eje = row_count;
  delete from tumbo.topes_plataforma where ventana < now() - interval '1 day';
  get diagnostics n_top = row_count;
  if to_regclass('cron.job_run_details') is not null then
    begin
      execute $q$delete from cron.job_run_details
                 where jobid in (select jobid from cron.job where jobname like 'tumbo-%')
                   and coalesce(end_time, start_time) < now() - interval '14 days'$q$;
      get diagnostics n_cron = row_count;
    exception when others then
      n_cron := null;
    end;
  end if;
  return jsonb_build_object('errores', n_err, 'corridas', n_eje, 'topes', n_top, 'detalle_cron', n_cron);
end $$;

-- ---------------------------------------------------------------------------
-- Catálogo de las tareas existentes
-- ---------------------------------------------------------------------------
-- Las de Pagos y Logística conservan el nombre y el horario con los que ya
-- las programaron sus migraciones. tarea_archivos no se programa aquí: la
-- corre la función tumbo-archivos (y tumbo-almacenamiento por pg_net).
-- Las de los dominios que lleguen después se adoptan solas al programar
-- (un trabajo «tumbo-*» cuya orden llama a una tarea_* sin catálogo).
create function tumbo_privado.catalogo_tareas_base() returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.tareas_programadas (tarea, funcion, trabajo, horario, dominio, descripcion, manual, cada_min) values
    ('pagos', 'tarea_pagos', 'tumbo-pagos-vencimientos', '*/10 * * * *', 'Pagos',
     'Vence los pagos sin verificar a las 48 horas (libera la reserva) y avisa 12 horas antes.', true, 10),
    ('tasa', 'tarea_tasa', 'tumbo-pagos-tasa', '7 */3 * * *', 'Pagos',
     'Pide la tasa BCV a la fuente pública (con pg_net) y avisa a Finanzas si lleva demasiadas horas sin actualizarse.', true, 180),
    ('tasa_respuesta', 'tarea_tasa_procesar', 'tumbo-pagos-tasa-respuesta', '9 */3 * * *', 'Pagos',
     'Aplica la tasa que respondió la fuente pública, con sus controles.', true, 180),
    ('liquidaciones', 'tarea_liquidaciones', 'tumbo-pagos-liquidaciones', '0 12 * * 1', 'Pagos',
     'Calendario semanal: prepara la corrida de cada comercio con fondos elegibles (lunes 8:00, hora de Caracas).', true, 10080),
    ('cierre_diario', 'tarea_cierre_diario', 'tumbo-pagos-cierre', '15 4 * * *', 'Pagos',
     'Cierre contable del día anterior: cuadra el libro mayor y avisa a Finanzas si algo no cuadra (00:15, hora de Caracas).', true, 1440),
    ('sla', 'tarea_sla', 'tumbo-sla', '*/15 * * * *', 'Logística',
     'Plazos de logística: vencimientos, autoconfirmación de entregas y cierre de las ventanas de reclamo vencidas.', true, 15),
    ('almacenamiento', 'tarea_almacenamiento', 'tumbo-almacenamiento', '23 * * * *', 'Plataforma',
     'Limpieza de archivos: pide a la función tumbo-archivos (con pg_net) que borre lo descartado y lo que no se confirmó.', true, 60),
    ('mantenimiento', 'tarea_mantenimiento', 'tumbo-mantenimiento', '41 7 * * *', 'Plataforma',
     'Purga los errores del navegador de más de 30 días, las corridas de más de 60 y los contadores de topes.', true, 1440),
    ('archivos', 'tarea_archivos', null, null, 'Fundaciones',
     'Decide qué archivos sobran en Storage. La corre la función tumbo-archivos al recibir subidas (y tumbo-almacenamiento por pg_net).', false, null)
  on conflict (tarea) do nothing;
$$;

do $$ begin perform tumbo_privado.catalogo_tareas_base(); end $$;

-- ---------------------------------------------------------------------------
-- Programación con pg_cron
-- ---------------------------------------------------------------------------
-- Solo si existe pg_cron (se mira el esquema cron: así las pruebas lo
-- simulan dentro de una transacción que deshacen). Para cada tarea del
-- catálogo con trabajo y horario:
--   · si ya hay un trabajo con su nombre, o un «tumbo-…» cuya orden llama a
--     su función (lo programó su dominio), se reutiliza con su nombre y su
--     horario y solo cambia la orden por el envoltorio (si el nombre no es
--     el del catálogo, el catálogo toma el del trabajo);
--   · si no, se programa con el nombre y el horario del catálogo.
-- Los demás trabajos de Tumbo que llaman a la misma función (otro «tumbo-…»
-- o uno sin nombre, programado a mano) se quitan: nunca se duplica. Un
-- trabajo sin nombre nunca es el que queda (no se vería en admin/sistema);
-- los de otra aplicación (otro nombre) no se tocan.
-- Antes adopta los trabajos «tumbo-*» que llaman a una tarea_* sin catálogo.
create function tumbo_privado.programar_tareas() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t tumbo.tareas_programadas;
  j record;
  v_cmd text;
  v_patron text;
  v_alterar boolean := to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is not null;
  v_hechas jsonb := '[]'::jsonb;
  v_primero bigint;
begin
  if to_regclass('cron.job') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    return jsonb_build_object('pg_cron', false, 'tareas', '[]'::jsonb,
      'mensaje', 'Este proyecto no tiene pg_cron: las tareas solo corren a mano desde Sistema (o desde su función). Habilita pg_cron y vuelve a programar.');
  end if;

  -- adopción: trabajos «tumbo-*» de los dominios que no están en el catálogo
  for j in execute $q$select jobid, jobname, schedule,
                             substring(lower(command) from '^\s*select\s+tumbo_privado\.(tarea_[a-z0-9_]+)\s*\(\s*\)\s*;?\s*$') as funcion
                      from cron.job where jobname like 'tumbo-%' order by jobid$q$ loop
    if j.funcion is not null and j.jobname ~ '^tumbo-[a-z0-9-]{1,50}$'
       and not exists (select 1 from tumbo.tareas_programadas x where x.funcion = j.funcion)
       and not exists (select 1 from tumbo.tareas_programadas x where x.trabajo = j.jobname) then
      insert into tumbo.tareas_programadas (tarea, funcion, trabajo, horario, dominio, descripcion, manual)
      values (left(substring(j.funcion from 7), 40), j.funcion, j.jobname,
              case when j.schedule ~ '^[0-9*/,-]+( [0-9*/,-]+){4}$' then j.schedule end, 'Sin asignar',
              'La programó su dominio (' || j.jobname || '). Falta su descripción en el catálogo.', true)
      on conflict do nothing;
    end if;
  end loop;

  for t in select * from tumbo.tareas_programadas where trabajo is not null and horario is not null order by tarea loop
    if not tumbo_privado.es_tarea_invocable(t.funcion) then
      v_hechas := v_hechas || jsonb_build_object('tarea', t.tarea, 'accion', 'omitida', 'motivo', 'la función no existe en esta base');
      continue;
    end if;
    v_cmd := format('select tumbo_privado.correr_tarea(%L)', t.tarea);
    v_patron := 'tumbo_privado\.' || t.funcion || '\s*\(';
    v_primero := null;
    -- primero el del nombre del catálogo, después los «tumbo-…» (los sin
    -- nombre al final: «jobname = $1» daría null y en orden descendente los
    -- null van primero)
    for j in execute $q$select jobid, jobname, schedule, command from cron.job
                        where jobname = $1 or command ~ $2 or command = $3
                        order by (jobname is not distinct from $1) desc,
                                 (coalesce(jobname, '') like 'tumbo-%') desc, jobid$q$
             using t.trabajo, v_patron, v_cmd loop
      if v_primero is null and j.jobname like 'tumbo-%' then
        v_primero := j.jobid;
        if j.command is distinct from v_cmd then
          if v_alterar then
            execute 'select cron.alter_job(job_id := $1, command := $2)' using j.jobid, v_cmd;
          else
            execute 'select cron.unschedule($1)' using j.jobid;
            execute 'select cron.schedule($1, $2, $3)' using j.jobname, j.schedule, v_cmd;
          end if;
          v_hechas := v_hechas || jsonb_build_object('tarea', t.tarea, 'trabajo', j.jobname, 'horario', j.schedule, 'accion', 'envuelta');
        else
          v_hechas := v_hechas || jsonb_build_object('tarea', t.tarea, 'trabajo', j.jobname, 'horario', j.schedule, 'accion', 'al día');
        end if;
        if j.jobname <> t.trabajo then
          -- admin/sistema busca el trabajo por el nombre del catálogo
          update tumbo.tareas_programadas set trabajo = j.jobname
          where tarea = t.tarea and not exists (select 1 from tumbo.tareas_programadas x where x.trabajo = j.jobname);
        end if;
      elsif j.jobname is null or j.jobname like 'tumbo-%' then
        -- otro trabajo de Tumbo (o uno sin nombre) que corre lo mismo: sobra
        execute 'select cron.unschedule($1)' using j.jobid;
        v_hechas := v_hechas || jsonb_build_object('tarea', t.tarea, 'trabajo', j.jobname, 'horario', j.schedule,
                                                   'accion', case when j.jobname is null then 'sin nombre quitada' else 'duplicada quitada' end);
      end if;
    end loop;
    if v_primero is null then
      execute 'select cron.schedule($1, $2, $3)' using t.trabajo, t.horario, v_cmd;
      v_hechas := v_hechas || jsonb_build_object('tarea', t.tarea, 'trabajo', t.trabajo, 'horario', t.horario, 'accion', 'programada');
    end if;
  end loop;
  return jsonb_build_object('pg_cron', true, 'tareas', v_hechas);
end $$;

-- ---------------------------------------------------------------------------
-- API
-- ---------------------------------------------------------------------------
-- Salud pública y mínima (para un monitor externo): no dice nada de la
-- actividad (el proyecto es compartido), solo que la base responde y lee
-- el esquema de Tumbo.
create function public.tm_salud() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', exists (select 1 from tumbo.ajustes limit 1), 'hora', now(), 'version', 'plataforma-2026.10.23')
$$;

-- Un error del navegador o una RPC fallida. Público (también sin sesión),
-- sin datos personales y con topes: 20 por red cada 10 minutos y 600 en
-- total cada 10 minutos. Nunca responde con un error HTTP (un aviso de error
-- no debe producir otro): {ok: false, motivo} si no se guarda.
create function public.tm_error_cliente(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := case when jsonb_typeof(p_datos) = 'object' and octet_length(p_datos::text) <= 16000 then p_datos end;
  v_tipo text;
  v_mensaje text;
  v_fuente text;
  v_linea integer;
  v_columna integer;
  v_pila text;
  v_pagina text;
  v_vista text;
  v_rpc text;
  v_codigo text;
  v_version text;
  v_modo text;
  v_rol text;
  v_huella text;
begin
  if d is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  v_tipo := d ->> 'tipo';
  v_mensaje := tumbo_privado.texto_error(d ->> 'mensaje', 300);
  if v_tipo is null or v_tipo not in ('error', 'promesa', 'rpc', 'recurso') or v_mensaje is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  if not tumbo_privado.tope_plataforma('errores', 20, 600, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'motivo', 'tope');
  end if;
  v_fuente := tumbo_privado.ruta_error(d ->> 'fuente');
  v_linea := case when d ->> 'linea' ~ '^[0-9]{1,7}$' then (d ->> 'linea')::integer end;
  v_columna := case when d ->> 'columna' ~ '^[0-9]{1,7}$' then (d ->> 'columna')::integer end;
  v_pila := tumbo_privado.texto_error(d ->> 'pila', 1500);
  v_pagina := tumbo_privado.ruta_error(d ->> 'pagina');
  v_vista := case when d ->> 'vista' ~ '^[a-z0-9/-]{1,60}$' then d ->> 'vista' end;
  v_rpc := case when d ->> 'rpc' ~ '^tm_[a-z0-9_]{1,60}$' then d ->> 'rpc' end;
  v_codigo := case when d ->> 'codigo' ~ '^[0-9A-Z]{1,10}$' then d ->> 'codigo' end;
  v_version := case when d ->> 'version' ~ '^[A-Za-z0-9._-]{1,40}$' then d ->> 'version' end;
  v_modo := case when d ->> 'modo' in ('remoto', 'local') then d ->> 'modo' end;
  v_rol := case when d ->> 'rol' in ('visitante', 'comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas')
                then d ->> 'rol' end;
  v_huella := md5(concat_ws('|', v_tipo, v_mensaje, v_fuente, v_linea, v_columna, v_vista, v_rpc, v_codigo));

  update tumbo.errores_cliente
  set veces = least(veces + 1, 1000000000), ultimo = now(), version = coalesce(v_version, version),
      navegador = tumbo_privado.dispositivo(tumbo_privado.agente()), pagina = coalesce(v_pagina, pagina)
  where huella = v_huella;
  if not found then
    if (select count(*) from tumbo.errores_cliente) >= 5000 then
      delete from tumbo.errores_cliente
      where id in (select id from tumbo.errores_cliente order by ultimo limit 10);
    end if;
    insert into tumbo.errores_cliente as e (huella, tipo, mensaje, fuente, linea, columna, pila, pagina, vista, rpc, codigo,
                                            navegador, version, modo, rol)
    values (v_huella, v_tipo, v_mensaje, v_fuente, v_linea, v_columna, v_pila, v_pagina, v_vista, v_rpc, v_codigo,
            tumbo_privado.dispositivo(tumbo_privado.agente()), v_version, v_modo, v_rol)
    on conflict (huella) do update set veces = least(e.veces + 1, 1000000000), ultimo = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- El estado del sistema para admin/sistema (superadministración). Las
-- cuentas de prueba (contraseña pública) también lo leen, pero solo el
-- estado, los horarios y los conteos (detalle = false): ni el resultado ni
-- el error de las corridas (pueden nombrar comercios reales o el libro), ni
-- el mensaje de pg_cron, ni los errores de los navegadores de las personas,
-- ni el nombre de quien del equipo real corrió una tarea («Equipo de
-- Tumbo»), como la auditoría (auditoria_visible) y los pedidos.
create function public.tm_sistema(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin']);
  v_detalle boolean := not coalesce(tumbo_privado.cuenta_demo(yo.email), false);
  v_cron boolean := to_regclass('cron.job') is not null;
  v_trabajos jsonb := '{}'::jsonb;
  v_cron_error text;
  v_tareas jsonb;
  v_tasa jsonb;
  v_storage jsonb := null;
  v_sin_catalogo jsonb;
  v_otros jsonb := '[]'::jsonb;
begin
  if v_cron then
    begin
      execute $q$
        with j as (select jobid, jobname, schedule, command, active from cron.job where jobname like 'tumbo-%'),
             d as (select distinct on (x.jobid) x.jobid, x.status, x.start_time, x.end_time, x.return_message
                   from cron.job_run_details x
                   where x.jobid in (select jobid from j) and x.start_time > now() - interval '3 days'
                   order by x.jobid, x.runid desc)
        select coalesce(jsonb_object_agg(j.jobname, jsonb_build_object(
                 'horario', j.schedule, 'orden', left(j.command, 200), 'activa', j.active,
                 'envuelta', j.command ~ '^select tumbo_privado\.correr_tarea\(',
                 'ultima', case when d.jobid is not null then jsonb_build_object('estado', d.status, 'inicio', d.start_time,
                                 'fin', d.end_time,
                                 'mensaje', case when $1 then tumbo_privado.texto_error(d.return_message, 300) end) end)), '{}'::jsonb)
        from j left join d on d.jobid = j.jobid$q$ into v_trabajos using v_detalle;
    exception when others then
      v_cron_error := tumbo_privado.texto_error(sqlerrm, 200);
      v_trabajos := '{}'::jsonb;
    end;
  end if;

  select coalesce(jsonb_agg(x.j order by x.dominio, x.tarea), '[]'::jsonb) into v_tareas
  from (
    select t.tarea, t.dominio, jsonb_build_object(
      'tarea', t.tarea, 'funcion', t.funcion, 'dominio', t.dominio, 'descripcion', t.descripcion, 'manual', t.manual,
      'trabajo', t.trabajo, 'cada_min', t.cada_min,
      'horario', coalesce(v_trabajos -> t.trabajo ->> 'horario', t.horario),
      'programada', t.trabajo is not null and v_trabajos ? t.trabajo,
      'cron', v_trabajos -> t.trabajo,
      'existe', tumbo_privado.es_tarea_invocable(t.funcion),
      'ultima', (select jsonb_build_object('inicio', e.inicio, 'fin', e.fin, 'ok', e.ok, 'origen', e.origen,
                                           'por', case when v_detalle or e.por is null
                                                            or exists (select 1 from tumbo.usuarios x
                                                                       where x.id = e.por_id and tumbo_privado.cuenta_demo(x.email))
                                                       then e.por else 'Equipo de Tumbo' end,
                                           'resultado', case when v_detalle then e.resultado end,
                                           'error', case when v_detalle then e.error end,
                                           'ms', round(extract(epoch from e.fin - e.inicio) * 1000))
                 from tumbo.tareas_ejecuciones e where e.tarea = t.tarea order by e.inicio desc, e.id desc limit 1),
      'ultima_buena', (select max(e.fin) from tumbo.tareas_ejecuciones e where e.tarea = t.tarea and e.ok),
      'corridas_24h', (select count(*) from tumbo.tareas_ejecuciones e where e.tarea = t.tarea and e.inicio > now() - interval '24 hours'),
      'errores_24h', (select count(*) from tumbo.tareas_ejecuciones e where e.tarea = t.tarea and not e.ok and e.inicio > now() - interval '24 hours'),
      'estado', case
        when not tumbo_privado.es_tarea_invocable(t.funcion) then 'falta_funcion'
        when (select not e.ok from tumbo.tareas_ejecuciones e where e.tarea = t.tarea order by e.inicio desc, e.id desc limit 1) then 'error'
        when t.trabajo is null then 'externa'
        when not v_cron then 'sin_pg_cron'
        when not (v_trabajos ? t.trabajo) then 'sin_programar'
        when not coalesce((v_trabajos -> t.trabajo ->> 'activa')::boolean, true) then 'pausada'
        when not coalesce((v_trabajos -> t.trabajo ->> 'envuelta')::boolean, false) then 'sin_registro'
        when t.cada_min is not null
             and coalesce((select max(e.fin) from tumbo.tareas_ejecuciones e where e.tarea = t.tarea and e.ok), t.creado)
                 < now() - make_interval(mins => t.cada_min * 2 + 10) then 'atrasada'
        else 'al_dia' end) as j
    from tumbo.tareas_programadas t
  ) x;

  -- funciones tarea_* que nadie catalogó (de un dominio nuevo): las que se
  -- pueden correr sin argumentos, como las corre el envoltorio
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb) into v_sin_catalogo
  from (select distinct p.proname::text as proname from pg_catalog.pg_proc p
        where p.pronamespace = 'tumbo_privado'::regnamespace and p.proname like 'tarea\_%'
          and p.prokind = 'f' and p.pronargs = p.pronargdefaults
          and p.proname not in (select funcion from tumbo.tareas_programadas)) p;
  -- trabajos «tumbo-*» que no son de ninguna tarea del catálogo
  select coalesce(jsonb_agg(jsonb_build_object('trabajo', k, 'horario', v_trabajos -> k ->> 'horario', 'orden', v_trabajos -> k ->> 'orden')
                            order by k), '[]'::jsonb) into v_otros
  from jsonb_object_keys(v_trabajos) k
  where k not in (select trabajo from tumbo.tareas_programadas where trabajo is not null);

  begin
    v_tasa := public.tm_tasa_vigente();
  exception when others then
    v_tasa := null;
  end;

  if to_regclass('storage.objects') is not null then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('bucket', s.bucket_id, 'objetos', s.n, 'bytes', s.b) order by s.bucket_id), '[]'::jsonb)
      into v_storage
      from (select o.bucket_id, count(*) as n, coalesce(sum((o.metadata ->> 'size')::bigint), 0) as b
            from storage.objects o where o.bucket_id = any (tumbo_privado.buckets_tumbo()) group by o.bucket_id) s;
    exception when others then
      v_storage := null;
    end;
  end if;

  return jsonb_build_object(
    'hora', now(),
    'detalle', v_detalle,
    'extensiones', jsonb_build_object('pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron') or v_cron,
                                      'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
                                      'cron_error', v_cron_error,
                                      'funciones_url', nullif(btrim(coalesce(tumbo_privado.ajuste('funciones_url') #>> '{}', '')), '') is not null),
    'tareas', v_tareas,
    'sin_catalogo', v_sin_catalogo,
    'otros_trabajos', v_otros,
    'tasa', v_tasa,
    'bandeja', jsonb_build_object(
      'por_estado', (select coalesce(jsonb_object_agg(s.estado, s.n), '{}'::jsonb)
                     from (select estado, count(*) as n from tumbo.salida group by estado) s),
      'pendientes_por_canal', (select coalesce(jsonb_object_agg(s.canal, s.n), '{}'::jsonb)
                               from (select canal, count(*) as n from tumbo.salida where estado in ('pendiente', 'manual', 'fallido') group by canal) s),
      'mas_antiguo', (select min(creado) from tumbo.salida where estado in ('pendiente', 'manual', 'fallido'))),
    'errores', jsonb_build_object(
      'distintos_24h', (select count(*) from tumbo.errores_cliente where ultimo > now() - interval '24 hours'),
      'veces', (select coalesce(sum(veces), 0) from tumbo.errores_cliente where ultimo > now() - interval '24 hours'),
      'por_tipo', (select coalesce(jsonb_object_agg(x.tipo, x.veces), '{}'::jsonb)
                   from (select tipo, sum(veces) as veces from tumbo.errores_cliente
                         where ultimo > now() - interval '24 hours' group by tipo) x),
      'recientes', case when v_detalle then
                     (select coalesce(jsonb_agg(to_jsonb(e) - 'huella' order by e.ultimo desc), '[]'::jsonb)
                      from (select * from tumbo.errores_cliente order by ultimo desc limit 40) e)
                   else '[]'::jsonb end,
      'tareas', (select coalesce(jsonb_agg(jsonb_build_object('tarea', e.tarea, 'inicio', e.inicio, 'origen', e.origen,
                                                              'error', case when v_detalle then e.error end)
                                           order by e.inicio desc), '[]'::jsonb)
                 from (select * from tumbo.tareas_ejecuciones where not ok order by inicio desc limit 10) e)),
    'almacenamiento', jsonb_build_object(
      'archivos', (select coalesce(jsonb_agg(jsonb_build_object('proposito', a.proposito, 'estado', a.estado, 'archivos', a.n, 'bytes', a.b)
                                             order by a.proposito, a.estado), '[]'::jsonb)
                   from (select proposito, estado, count(*) as n, coalesce(sum(bytes), 0) as b
                         from tumbo.archivos where eliminado is null group by proposito, estado) a),
      'storage', v_storage,
      'cuotas', tumbo_privado.ajuste('cuotas_archivos'),
      'base_bytes', (select coalesce(sum(pg_catalog.pg_total_relation_size(c.oid)), 0)
                     from pg_catalog.pg_class c
                     where c.relnamespace in ('tumbo'::regnamespace, 'tumbo_privado'::regnamespace) and c.relkind in ('r', 'p', 'm')),
      'tablas', (select coalesce(jsonb_agg(jsonb_build_object('tabla', x.relname, 'bytes', x.b, 'filas', x.filas) order by x.b desc), '[]'::jsonb)
                 from (select c.relname::text as relname, pg_catalog.pg_total_relation_size(c.oid) as b,
                              greatest(c.reltuples, 0)::bigint as filas
                       from pg_catalog.pg_class c
                       where c.relnamespace = 'tumbo'::regnamespace and c.relkind in ('r', 'p')
                       order by pg_catalog.pg_total_relation_size(c.oid) desc limit 10) x)));
end $$;

-- Correr una tarea a mano (superadministración con sesión elevada: nunca
-- una cuenta de prueba). Una vez por minuto por tarea; queda en la
-- auditoría y en las corridas.
create function public.tm_tarea_correr(p_sesion text, p_tarea text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  t tumbo.tareas_programadas;
  r jsonb;
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into t from tumbo.tareas_programadas where tarea = p_tarea;
  if not found or not t.manual then
    raise exception 'Esa tarea no se puede correr desde aquí.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tumbo:tarea_manual:' || t.tarea, 0));
  if exists (select 1 from tumbo.tareas_ejecuciones e
             where e.tarea = t.tarea and e.origen = 'manual' and e.inicio > now() - interval '1 minute') then
    raise exception 'Esa tarea se corrió hace menos de un minuto: espera un momento.';
  end if;
  r := tumbo_privado.correr_tarea(t.tarea, 'manual', yo.nombre, yo.id);
  perform tumbo_privado.auditar(yo, 'Tarea ejecutada a mano',
    t.tarea || ' · ' || case when (r ->> 'ok')::boolean then 'terminó bien' else 'falló: ' || coalesce(r ->> 'error', '') end);
  return r;
end $$;

-- Programar (o volver a programar) las tareas con pg_cron: superadministración
-- con sesión elevada. Sin pg_cron, lo dice.
create function public.tm_tareas_programar(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  r jsonb;
begin
  perform tumbo_privado.exigir_elevada(yo);
  r := tumbo_privado.programar_tareas();
  perform tumbo_privado.auditar(yo, 'Tareas programadas revisadas',
    case when (r ->> 'pg_cron')::boolean then left((r -> 'tareas')::text, 1500) else 'sin pg_cron en el proyecto' end);
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Semilla (la llama el reinicio de la demo)
-- ---------------------------------------------------------------------------
-- El historial operativo (corridas y errores del navegador) no es de la
-- demo: se conserva, como la auditoría. El reinicio repone el catálogo de
-- tareas que falte y vacía los contadores de topes y las corridas de prueba.
-- Con la demo apagada (ajuste demo_activa = false) el reinicio
-- (tm_reiniciar_demo → sembrar_extensiones(false)) se rechaza: el error
-- deshace la transacción entera, también lo que el reinicio ya vació.
create function tumbo_privado.sembrar_ext_plataforma(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(p_auditoria, false)
     and coalesce(tumbo_privado.ajuste('demo_activa'), 'true'::jsonb) = 'false'::jsonb then
    raise exception 'La demo está apagada (ajuste demo_activa): el reinicio borraría los pedidos, productos y expedientes reales y ya no está disponible.'
      using errcode = '42501';
  end if;
  delete from tumbo.topes_plataforma where ventana is not null;
  delete from tumbo.tareas_ejecuciones where origen = 'prueba';
  perform tumbo_privado.catalogo_tareas_base();
end $$;

-- ---------------------------------------------------------------------------
-- Programación inicial (solo donde existe pg_cron)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform tumbo_privado.programar_tareas();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: las funciones nuevas de la API, por firma exacta.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'public.tm_salud()', 'public.tm_error_cliente(jsonb)', 'public.tm_sistema(text)',
    'public.tm_tarea_correr(text,text)', 'public.tm_tareas_programar(text)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
