-- =========================================================================
-- Tumbo Market — Ajustes tras la revisión de la migración 5
-- -------------------------------------------------------------------------
-- Las cuentas demo tienen contraseña pública y las comparte cualquiera que
-- visite la beta: los topes no pueden permitir que un visitante deje sin
-- servicio a los demás. Aquí:
--   · la cuota de escrituras y el tope de sesiones cuentan por cuenta Y por
--     red: cada red solo agota lo suyo; la campana de avisos no consume cuota;
--   · los frenos de acceso cuentan aciertos por (correo, red) con su propio
--     mensaje; el techo global cuenta todo bcrypt; la red conocida vive en su
--     propia tabla (acotada) e incluye la red del registro;
--   · el vencimiento de pagos se hace sin romper el orden de bloqueos (sin
--     interbloqueos) y también al leer; un pago vencido no se concilia;
--   · la referencia de pago es única de verdad (candado por referencia y
--     clave normalizada; un pago conciliado no se libera al cancelar);
--   · el tope de 10 unidades vale también al crear el pedido;
--   · tm_cargar: huella determinista, pendientes de más antiguo a más nuevo
--     con aviso si se recortan, auditoría en ventanas (equipo / resto /
--     accesos) y tm_auditoria para buscar y paginar todo el historial;
--   · volver_a_pausa sobrevive al rechazo y al reenvío;
--   · privilegios por firma exacta.
--
-- Solo agrega: no borra ni reescribe datos ni objetos existentes (en un
-- proyecto compartido, el conector de Supabase pide confirmación humana para
-- eso). Quedan sin uso `tumbo.cuotas` (la reemplaza `tumbo.cuotas_red`) y el
-- índice `pedidos_ref_idx`; se pueden borrar a mano cuando se quiera.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
-- Cuota por (usuario, red, ventana de 10 min). La tabla es efímera.
create table tumbo.cuotas_red (
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  red        text not null,
  ventana    timestamptz not null,
  n          integer not null,
  primary key (usuario_id, red, ventana)
);
alter table tumbo.cuotas_red enable row level security;
revoke all on tumbo.cuotas_red from public, anon, authenticated;

-- La sesión recuerda desde qué red se abrió: el tope se aplica por red.
alter table tumbo.sesiones add column red text not null default 'desconocida';
create index sesiones_usuario_red_idx on tumbo.sesiones (usuario_id, red, ultimo_uso);

-- Redes desde las que cada correo entró o se registró en los últimos 7 días
-- (como mucho 20 por correo): el techo por cuenta no frena al dueño en ellas.
create table tumbo.redes_conocidas (
  email  text not null,
  red    text not null,
  ultimo timestamptz not null default now(),
  primary key (email, red)
);
create index redes_conocidas_ultimo_idx on tumbo.redes_conocidas (ultimo);
alter table tumbo.redes_conocidas enable row level security;
revoke all on tumbo.redes_conocidas from public, anon, authenticated;
insert into tumbo.redes_conocidas (email, red, ultimo)
select email, ip, max(fecha) from tumbo.intentos_acceso
where exito and ip <> 'desconocida' and fecha > now() - interval '7 days'
group by email, ip
on conflict do nothing;

-- Referencia de pago normalizada: «PM-123456», «pm 123456» y «PM123456» son
-- la misma transferencia.
alter table tumbo.pedidos add column ref_clave text
  generated always as (regexp_replace(upper(ref), '[^A-Z0-9]', '', 'g')) stored;
create index pedidos_ref_clave_idx on tumbo.pedidos (ref_clave);

-- Hasta 10 unidades por producto (también lo exige tm_crear_pedido).
alter table tumbo.carrito_items add constraint carrito_items_cant_tope check (cant between 1 and 10);

-- Ventanas de la auditoría: decisiones del equipo (y del sistema) y el resto.
-- El actor lleva el rol que añade el servidor al final: «Nombre (rol)».
create index auditoria_equipo_idx on tumbo.auditoria (fecha desc, id desc)
  where accion <> 'Inicio de sesión' and (actor_id is null or actor ~ '\((superadmin|ops|finanzas)\)$');
create index auditoria_resto_idx on tumbo.auditoria (fecha desc, id desc)
  where accion <> 'Inicio de sesión' and not (actor_id is null or actor ~ '\((superadmin|ops|finanzas)\)$');

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
-- IPv4 dentro de IPv6 (::ffff:a.b.c.d en cualquier forma) cuenta como la IPv4.
create or replace function tumbo_privado.ip_cliente() returns text
language plpgsql stable set search_path = '' as $$
declare
  v text;
  d inet;
begin
  v := nullif(current_setting('request.headers', true), '')::jsonb ->> 'cf-connecting-ip';
  if v is null or v !~ '^[0-9A-Fa-f:.]{3,45}$' then
    return 'desconocida';
  end if;
  d := v::inet;
  if family(d) = 6 and d << '::ffff:0:0/96'::inet then
    return host('0.0.0.0'::inet + (d - '::ffff:0.0.0.0'::inet));
  end if;
  if family(d) = 6 then
    return host(network(set_masklen(d, 64))) || '/64';
  end if;
  return host(d);
exception when others then
  return 'desconocida';
end $$;

-- Rol y cuota de escrituras por (usuario, red): quien agota la cuota de una
-- cuenta demo solo se frena a sí mismo, no a quien la usa desde otra red.
create or replace function tumbo_privado.exigir(p_sesion text, p_roles text[]) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_n integer;
begin
  if u.id is null then
    raise exception 'Tu sesión expiró: vuelve a iniciar sesión.' using errcode = '28000';
  end if;
  if not (u.rol = any (p_roles)) then
    raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
  end if;
  insert into tumbo.cuotas_red as c (usuario_id, red, ventana, n)
  values (u.id, tumbo_privado.ip_cliente(), date_bin('10 minutes', now(), timestamptz '2000-01-01'), 1)
  on conflict (usuario_id, red, ventana) do update set n = c.n + 1
  returning n into v_n;
  if v_n > 150 then
    raise exception 'Vas muy rápido: espera unos minutos antes de seguir.';
  end if;
  return u;
end $$;

-- Rol sin cuota, para lecturas y operaciones idempotentes y acotadas.
create function tumbo_privado.exigir_rol(p_sesion text, p_roles text[]) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
begin
  if u.id is null then
    raise exception 'Tu sesión expiró: vuelve a iniciar sesión.' using errcode = '28000';
  end if;
  if not (u.rol = any (p_roles)) then
    raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
  end if;
  return u;
end $$;

-- Sesiones: hasta 10 por cuenta y red, y 200 por cuenta; se desalojan las
-- que llevan más tiempo sin usarse. Una red solo desaloja sus propias
-- sesiones mientras la cuenta no llegue al total.
create or replace function tumbo_privado.abrir_sesion(p_usuario uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_red text := tumbo_privado.ip_cliente();
begin
  delete from tumbo.sesiones where expira < now();
  delete from tumbo.sesiones where token_hash in (
    select token_hash from tumbo.sesiones where usuario_id = p_usuario and red = v_red
    order by ultimo_uso desc, creada desc offset 9);
  delete from tumbo.sesiones where token_hash in (
    select token_hash from tumbo.sesiones where usuario_id = p_usuario
    order by ultimo_uso desc, creada desc offset 199);
  delete from tumbo.cuotas_red where ventana < now() - interval '1 day';
  insert into tumbo.sesiones (token_hash, usuario_id, expira, red)
  values (tumbo_privado.hash_token(v_token), p_usuario, now() + interval '7 days', v_red);
  return v_token;
end $$;

create function tumbo_privado.recordar_red(p_email text, p_red text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_red = 'desconocida' then
    return;
  end if;
  delete from tumbo.redes_conocidas where ultimo < now() - interval '7 days';
  insert into tumbo.redes_conocidas (email, red, ultimo) values (p_email, p_red, now())
  on conflict (email, red) do update set ultimo = now();
  delete from tumbo.redes_conocidas where email = p_email and red in (
    select red from tumbo.redes_conocidas where email = p_email order by ultimo desc offset 20);
end $$;

-- Pedidos con el pago vencido (48 h sin verificar), bloqueados para este
-- proceso; los que otro ya está tocando se dejan para la próxima.
create function tumbo_privado.pagos_vencidos() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_ids text[];
begin
  select coalesce(array_agg(id order by id), '{}') into v_ids
  from (select id from tumbo.pedidos
        where estado = 'pago_por_verificar' and pago_vence < now()
        order by id limit 50 for update skip locked) x;
  return v_ids;
end $$;

-- Vence esos pedidos. Quien llama ya tiene bloqueados sus productos.
create function tumbo_privado.vencer_pedidos(p_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
begin
  for v in select * from tumbo.pedidos where id = any (p_ids) and estado = 'pago_por_verificar' order by id loop
    update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = v.id;
    update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
    perform tumbo_privado.evento(v.id, 'Sistema', 'Pago sin verificar en 48 horas · pedido vencido y stock liberado', 'schedule');
    perform tumbo_privado.notificar('usr:' || v.comprador_id,
      'Tu pedido ' || v.id || ' venció: no pudimos verificar el pago a tiempo', 'schedule', 'tienda/pedido.html?id=' || v.id);
    perform tumbo_privado.auditar(null, 'Pedido vencido', v.ref || ' → ' || v.id);
  end loop;
end $$;

-- Vencimiento de mejor esfuerzo para quien no tiene otros bloqueos (la
-- lectura): si un producto está ocupado, no espera; lo hará la próxima vez.
create or replace function tumbo_privado.vencer_pagos() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids text[] := tumbo_privado.pagos_vencidos();
begin
  if cardinality(v_ids) = 0 then
    return;
  end if;
  begin
    perform 1 from tumbo.productos
    where sku in (select sku from tumbo.pedido_items where pedido_id = any (v_ids))
    order by sku for update nowait;
  exception when lock_not_available then
    return;
  end;
  perform tumbo_privado.vencer_pedidos(v_ids);
end $$;

-- ---------------------------------------------------------------------------
-- Cuenta
-- ---------------------------------------------------------------------------
create or replace function public.tm_acceder(p_email text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 120);
  v_ip text := tumbo_privado.ip_cliente();
  u tumbo.usuarios;
  v_ok boolean := false;
  v_token text;
begin
  delete from tumbo.intentos_acceso where fecha < now() - interval '1 day';

  -- Techo global de comprobaciones bcrypt (aciertos y fallos) por minuto:
  -- acota la CPU que Tumbo puede gastar en la base compartida.
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and fecha > now() - interval '1 minute') >= 120 then
    return jsonb_build_object('error', 'El acceso está muy solicitado en este momento. Inténtalo de nuevo en un minuto.');
  end if;
  -- Aciertos repetidos de una cuenta desde una red (las cuentas demo son
  -- públicas): frena el abuso sin afectar a quien entra desde otra red.
  if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and exito and fecha > now() - interval '15 minutes') >= 60 then
    return jsonb_build_object('error', 'Demasiados accesos seguidos a esta cuenta desde tu conexión. Espera unos minutos.');
  end if;
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 8
     or (v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
         where tipo = 'acceso' and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 40)
     -- techo por cuenta para quien rote redes; no frena al dueño en una red
     -- desde la que entró o se registró esta semana
     or ((select count(*) from tumbo.intentos_acceso
          where tipo = 'acceso' and email = v_email and not exito and fecha > now() - interval '15 minutes') >= 100
         and not exists (select 1 from tumbo.redes_conocidas r
                         where r.email = v_email and r.red = v_ip and r.ultimo > now() - interval '7 days')) then
    return jsonb_build_object('error', 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');
  end if;

  select * into u from tumbo.usuarios where email = v_email and activo;
  if found then
    v_ok := u.clave_hash = extensions.crypt(coalesce(p_clave, ''), u.clave_hash);
  else
    -- mismo coste que una comprobación real: el tiempo no delata si el correo existe
    perform extensions.crypt(coalesce(p_clave, ''), extensions.gen_salt('bf', 10));
  end if;
  insert into tumbo.intentos_acceso (tipo, email, ip, exito) values ('acceso', v_email, v_ip, v_ok);

  if not v_ok then
    return jsonb_build_object('error', 'Correo o contraseña incorrectos. Las cuentas demo usan demo1234.');
  end if;
  perform tumbo_privado.recordar_red(v_email, v_ip);
  v_token := tumbo_privado.abrir_sesion(u.id);
  if not exists (select 1 from tumbo.auditoria a
                 where a.accion = 'Inicio de sesión' and a.actor_id = u.id and a.fecha > now() - interval '10 minutes') then
    perform tumbo_privado.auditar(u, 'Inicio de sesión', u.rol);
  end if;
  return jsonb_build_object('sesion', v_token, 'usuario', tumbo_privado.perfil_json(u));
end $$;

create or replace function public.tm_registrar(p_email text, p_clave text, p_nombre text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 200);
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_ip text := tumbo_privado.ip_cliente();
  v_error text;
  u tumbo.usuarios;
begin
  delete from tumbo.intentos_acceso where fecha < now() - interval '1 day';
  if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
      where tipo = 'registro' and ip = v_ip and fecha > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('error', 'Hay demasiados registros desde tu conexión. Inténtalo en unos minutos.');
  end if;
  -- Techo global: protege la base compartida de altas en masa desde muchas redes.
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'registro' and exito and fecha > now() - interval '10 minutes') >= 200 then
    return jsonb_build_object('error', 'El registro está en pausa por alta demanda. Inténtalo en unos minutos.');
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_email) > 120 then
    v_error := 'Escribe un correo válido.';
  -- bcrypt solo usa los primeros 72 bytes: más larga sería una contraseña truncada
  elsif char_length(coalesce(p_clave, '')) < 8 or octet_length(p_clave) > 72 then
    v_error := 'La contraseña necesita entre 8 y 72 caracteres.';
  elsif char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then
    v_error := 'Escribe tu nombre (entre 2 y 80 caracteres).';
  -- nombres reservados a actores del sistema en las líneas de tiempo
  elsif lower(v_nombre) in ('finanzas', 'operaciones', 'sistema', 'courier', 'moderación', 'moderacion', 'backoffice', 'tumbo', 'tumbo market')
        or v_nombre ~* '^sel-\d' then
    v_error := 'Elige otro nombre: ese lo usa el sistema.';
  elsif exists (select 1 from tumbo.usuarios where email = v_email) then
    v_error := 'Ya existe una cuenta con ese correo: inicia sesión.';
  end if;

  if v_error is null then
    begin
      insert into tumbo.usuarios (email, clave_hash, nombre, rol)
      values (v_email, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), v_nombre, 'comprador')
      returning * into u;
    exception when unique_violation then
      -- dos altas simultáneas con el mismo correo
      v_error := 'Ya existe una cuenta con ese correo: inicia sesión.';
    end;
  end if;

  insert into tumbo.intentos_acceso (tipo, email, ip, exito) values ('registro', left(v_email, 120), v_ip, v_error is null);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;
  perform tumbo_privado.recordar_red(v_email, v_ip);
  perform tumbo_privado.auditar(u, 'Registro de comprador', 'cuenta nueva');
  return jsonb_build_object('sesion', tumbo_privado.abrir_sesion(u.id), 'usuario', tumbo_privado.perfil_json(u));
end $$;

-- Idempotente y acotada a los 100 avisos visibles: no consume cuota.
create or replace function public.tm_marcar_notificaciones_leidas(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
begin
  insert into tumbo.notificaciones_leidas (notificacion_id, usuario_id)
  select n.id, yo.id
  from (select n.id from tumbo.notificaciones n
        where (n.para = 'usr:' || yo.id::text
               or n.para = 'rol:' || yo.rol
               or (yo.seller_id is not null and n.para = 'seller:' || yo.seller_id))
          and (n.roles is null or yo.rol = any (n.roles))
        order by n.fecha desc, n.id desc limit 100) n
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Lectura
-- ---------------------------------------------------------------------------
-- Cambios respecto de la migración 5:
--   · vence (sin esperar) los pagos de más de 48 h antes de leer;
--   · todos los ORDER BY tienen desempate único: la huella es determinista;
--   · lo pendiente va de más antiguo a más nuevo (hasta 2000) y, si hay más,
--     `pendientes_truncados` lo avisa;
--   · al operador tampoco le llega «Disputa resuelta: devolución…»;
--   · auditoría en tres ventanas: decisiones del equipo y del sistema (300),
--     acciones de comercios y compradores (150) e inicios de sesión (50).
--     El historial completo se consulta con tm_auditoria.
create or replace function public.tm_cargar(p_sesion text default null, p_huella text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_uid uuid := u.id;
  v_rol text := u.rol;
  v_seller text := u.seller_id;
  v_admin boolean := coalesce(u.rol in ('superadmin', 'ops', 'finanzas'), false);
  r jsonb;
  v_h text;
  v_pendientes integer;
  v_abiertas integer;
begin
  perform tumbo_privado.vencer_pagos();

  r := jsonb_build_object(
    'yo', case when v_uid is null then null else tumbo_privado.perfil_json(u) end,
    'sesion_invalida', p_sesion is not null and v_uid is null,
    'config', (select to_jsonb(c) - 'id' from tumbo.config c),
    'categorias', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden, c.id) from tumbo.categorias c), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.id) from tumbo.sellers s
      where s.estado = 'aprobado' or s.id = v_seller or v_admin
         or exists (select 1 from tumbo.pedidos p where p.seller_id = s.id and p.comprador_id = v_uid)), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(
               case when p.seller_id = v_seller or v_rol = 'superadmin' then to_jsonb(p)
                    else (to_jsonb(p) - 'stock_res' - 'actualizado' - 'creado' - 'motivo_rechazo' - 'volver_a_pausa')
                         || jsonb_build_object('stock_fis', greatest(p.stock_fis - p.stock_res, 0), 'stock_res', 0) end
               order by p.creado desc, p.sku)
      from tumbo.productos p
      where (p.estado = 'publicado'
             and exists (select 1 from tumbo.sellers s where s.id = p.seller_id and s.estado = 'aprobado'))
         or p.seller_id = v_seller
         or v_rol = 'superadmin'), '[]'::jsonb)
  );

  if v_uid is not null then
    select count(*) into v_pendientes from tumbo.pedidos p
    where (p.comprador_id = v_uid
           or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
               and p.estado <> 'pago_por_verificar'
               and not (p.estado = 'cancelado' and p.sla_horas is null))
           or v_admin)
      and (p.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
           or p.liquidacion in ('retenido', 'congelado', 'elegible'));
    select count(*) into v_abiertas from tumbo.disputas d
    where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
      and d.estado <> 'resuelta';

    r := r || jsonb_build_object(
      'pendientes_truncados', v_pendientes > 2000 or v_abiertas > 2000,
      -- El comercio solo ve pedidos con el pago ya conciliado, y el operador,
      -- sin los datos de dinero ni de reclamos.
      'pedidos', coalesce((
        select jsonb_agg((case when v_rol = 'operador'
                               then to_jsonb(p) - 'comprador_id' - 'liquidacion' - 'liquidacion_id' - 'disputa_id'
                               else to_jsonb(p) - 'comprador_id' end) - 'ref_clave' || jsonb_build_object(
                 'mio', p.comprador_id = v_uid,
                 'pedido_items', coalesce((select jsonb_agg(to_jsonb(i) - 'pedido_id' order by i.sku)
                                           from tumbo.pedido_items i where i.pedido_id = p.id), '[]'::jsonb),
                 'pedido_eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'pedido_id' order by e.fecha, e.id)
                                             from tumbo.pedido_eventos e
                                             where e.pedido_id = p.id
                                               and (v_rol <> 'operador'
                                                    or e.icono not in ('gavel', 'lock_open', 'undo', 'receipt_long', 'assignment_return'))),
                                            '[]'::jsonb))
               order by p.creado desc, p.id desc)
        from (
          (select * from tumbo.pedidos p
           where (p.comprador_id = v_uid
                  or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
                      and p.estado <> 'pago_por_verificar'
                      and not (p.estado = 'cancelado' and p.sla_horas is null))
                  or v_admin)
             and (p.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                  or p.liquidacion in ('retenido', 'congelado', 'elegible'))
           order by p.creado, p.id limit 2000)
          union all
          (select * from tumbo.pedidos p
           where (p.comprador_id = v_uid
                  or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
                      and p.estado <> 'pago_por_verificar'
                      and not (p.estado = 'cancelado' and p.sla_horas is null))
                  or v_admin)
             and not (p.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                      or coalesce(p.liquidacion in ('retenido', 'congelado', 'elegible'), false))
           order by p.creado desc, p.id desc limit 150)) p), '[]'::jsonb),
      'disputas', coalesce((
        select jsonb_agg((to_jsonb(d) - 'comprador_id') || jsonb_build_object('mio', d.comprador_id = v_uid)
                         order by d.creado desc, d.id desc)
        from (
          (select * from tumbo.disputas d
           where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
             and d.estado <> 'resuelta'
           order by d.creado, d.id limit 2000)
          union all
          (select * from tumbo.disputas d
           where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
             and d.estado = 'resuelta'
           order by d.creado desc, d.id desc limit 150)) d), '[]'::jsonb),
      'liquidaciones', coalesce((
        select jsonb_agg(to_jsonb(l) order by l.fecha desc, l.id desc)
        from (select * from tumbo.liquidaciones l
              where (l.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'finanzas')
              order by l.fecha desc, l.id desc limit 200) l), '[]'::jsonb),
      -- Finanzas necesita el RIF para pagar, no las observaciones de cumplimiento.
      'kyc', coalesce((
        select jsonb_agg(case when v_rol = 'finanzas' then to_jsonb(k) - 'observacion' else to_jsonb(k) end order by k.seller_id)
        from tumbo.sellers_kyc k
        where (k.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'finanzas')), '[]'::jsonb),
      'docs', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.seller_id, x.orden) from tumbo.seller_documentos x
        where (x.seller_id = v_seller and v_rol = 'seller') or v_rol = 'superadmin'), '[]'::jsonb),
      'notificaciones', coalesce((
        select jsonb_agg((to_jsonb(n) - 'roles') || jsonb_build_object('leida', exists (
                 select 1 from tumbo.notificaciones_leidas l where l.notificacion_id = n.id and l.usuario_id = v_uid))
               order by n.fecha desc, n.id desc)
        from (select * from tumbo.notificaciones n
              where (n.para = 'usr:' || v_uid::text
                     or n.para = 'rol:' || v_rol
                     or (v_seller is not null and n.para = 'seller:' || v_seller))
                and (n.roles is null or v_rol = any (n.roles))
              order by n.fecha desc, n.id desc limit 100) n), '[]'::jsonb),
      'eventos', case when v_rol in ('superadmin', 'finanzas') then coalesce((
        select jsonb_agg(to_jsonb(a) - 'actor_id' order by a.fecha desc, a.id desc)
        from (
          (select * from tumbo.auditoria a
           where a.accion <> 'Inicio de sesión' and (a.actor_id is null or a.actor ~ '\((superadmin|ops|finanzas)\)$')
           order by a.fecha desc, a.id desc limit 300)
          union all
          (select * from tumbo.auditoria a
           where a.accion <> 'Inicio de sesión' and not (a.actor_id is null or a.actor ~ '\((superadmin|ops|finanzas)\)$')
           order by a.fecha desc, a.id desc limit 150)
          union all
          (select * from tumbo.auditoria a where a.accion = 'Inicio de sesión'
           order by a.fecha desc, a.id desc limit 50)) a), '[]'::jsonb)
        else '[]'::jsonb end,
      'direcciones', coalesce((
        select jsonb_agg(to_jsonb(d) - 'usuario_id' order by d.creado, d.id) from tumbo.direcciones d
        where d.usuario_id = v_uid), '[]'::jsonb),
      'carrito', coalesce((
        select jsonb_agg(jsonb_build_object('sku', c.sku, 'cant', c.cant) order by c.agregado, c.sku) from tumbo.carrito_items c
        where c.usuario_id = v_uid), '[]'::jsonb)
    );
  end if;

  v_h := md5(r::text);
  if p_huella is not null and p_huella = v_h then
    return jsonb_build_object('sin_cambios', true, 'huella', v_h);
  end if;
  return r || jsonb_build_object('huella', v_h);
end $$;

-- Historial completo de auditoría, paginado (200 por página, del más nuevo
-- al más antiguo) y con búsqueda en actor, acción y detalle.
create function public.tm_auditoria(p_sesion text, p_antes bigint default null, p_texto text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  v_texto text := nullif(left(trim(coalesce(p_texto, '')), 100), '');
  v_patron text;
begin
  if v_texto is not null then
    v_patron := '%' || replace(replace(replace(v_texto, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) - 'actor_id' order by a.id desc)
    from (select * from tumbo.auditoria a
          where (p_antes is null or a.id < p_antes)
            and (v_patron is null or (a.actor || ' ' || a.accion || ' ' || a.detalle) ilike v_patron)
          order by a.id desc limit 200) a), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Carrito y pedido: vencimiento sin interbloqueos
-- ---------------------------------------------------------------------------
-- El orden de bloqueos es siempre: candado del usuario → candado de la
-- referencia → pedidos vencidos (sin esperar) → productos en orden de SKU
-- (el carrito y los de los pedidos vencidos, en una sola pasada).
create or replace function public.tm_carrito_poner(p_sesion text, p_sku text, p_cant integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v_vencidos text[];
  v_disp integer;
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'carrito');
  if p_cant is null or p_cant < 1 or p_cant > 10 then
    raise exception 'Puedes llevar entre 1 y 10 unidades de cada producto.';
  end if;
  v_vencidos := tumbo_privado.pagos_vencidos();
  perform 1 from tumbo.productos
  where sku in (select p_sku union select i.sku from tumbo.pedido_items i where i.pedido_id = any (v_vencidos))
  order by sku for update;
  perform tumbo_privado.vencer_pedidos(v_vencidos);

  select p.stock_fis - p.stock_res into v_disp
  from tumbo.productos p join tumbo.sellers s on s.id = p.seller_id
  where p.sku = p_sku and p.estado = 'publicado' and s.estado = 'aprobado';
  if not found then
    raise exception 'Producto no disponible.';
  end if;
  if p_cant > v_disp then
    raise exception 'Solo quedan % unidades disponibles.', greatest(v_disp, 0);
  end if;
  insert into tumbo.carrito_items (usuario_id, sku, cant) values (yo.id, p_sku, p_cant)
  on conflict (usuario_id, sku) do update set cant = excluded.cant;
end $$;

create or replace function public.tm_crear_pedido(p_sesion text, p_envio_tipo text, p_direccion_id uuid, p_metodo text, p_ref text,
                                                  p_total_usd numeric default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  cfg tumbo.config;
  v_ref text := upper(trim(coalesce(p_ref, '')));
  v_clave text;
  v_dir text;
  v_courier text;
  v_costo numeric;
  v_subtotal numeric;
  v_vencidos text[];
  r record;
  v_seller text;
  v_id text;
  v_ids text[] := '{}';
begin
  -- Nadie más toca este carrito mientras se convierte en pedidos.
  perform tumbo_privado.bloquear_usuario(yo.id, 'carrito');
  select * into cfg from tumbo.config;
  if p_metodo is null or p_metodo not in ('Pago Móvil', 'Transferencia') then
    raise exception 'Elige un método de pago válido.';
  end if;
  v_clave := regexp_replace(v_ref, '[^A-Z0-9]', '', 'g');
  if char_length(v_ref) < 5 or char_length(v_ref) > 30 or char_length(v_clave) < 4 then
    raise exception 'Registra la referencia del pago (entre 5 y 30 caracteres).';
  end if;
  if p_envio_tipo = 'agencia' then
    v_dir := 'Agencia MRW La Candelaria, Caracas'; v_courier := 'MRW (demo)'; v_costo := 2.5;
  elsif p_envio_tipo = 'domicilio' then
    select d.linea || ', ' || d.municipio into v_dir
    from tumbo.direcciones d where d.id = p_direccion_id and d.usuario_id = yo.id;
    if v_dir is null then raise exception 'Elige una dirección de entrega válida.'; end if;
    v_courier := 'Zoom (demo)'; v_costo := 4;
  else
    raise exception 'Elige cómo quieres recibir el pedido.';
  end if;

  -- Dos compras con la misma referencia, una tras otra.
  perform pg_advisory_xact_lock(hashtextextended('tumbo:ref:' || v_clave, 0));

  -- Pedidos vencidos y productos (del carrito y de esos pedidos) en una sola
  -- pasada ordenada por SKU: el stock se valida y se reserva atómicamente.
  v_vencidos := tumbo_privado.pagos_vencidos();
  perform 1 from tumbo.productos p
  where p.sku in (select c.sku from tumbo.carrito_items c where c.usuario_id = yo.id
                  union select i.sku from tumbo.pedido_items i where i.pedido_id = any (v_vencidos))
  order by p.sku for update;
  perform tumbo_privado.vencer_pedidos(v_vencidos);

  -- Una referencia bancaria corresponde a un solo pago; solo queda libre la
  -- de un pedido cancelado que nunca se concilió.
  if exists (select 1 from tumbo.pedidos
             where ref_clave = v_clave and (estado <> 'cancelado' or sla_horas is not null)) then
    raise exception 'La referencia % ya está registrada en otro pedido: revisa el número del pago.', v_ref;
  end if;
  if (select count(*) from tumbo.pedidos where comprador_id = yo.id and estado = 'pago_por_verificar') >= 5 then
    raise exception 'Tienes 5 pedidos con el pago por verificar: espera la conciliación o cancela alguno.';
  end if;
  if (select count(*) from tumbo.pedidos where comprador_id = yo.id and creado > now() - interval '1 hour') >= 10 then
    raise exception 'Has creado muchos pedidos en la última hora: inténtalo más tarde.';
  end if;

  if not exists (select 1 from tumbo.carrito_items where usuario_id = yo.id) then
    raise exception 'El carrito está vacío.';
  end if;

  for r in
    select c.cant, c.sku, p.nombre, p.estado, p.stock_fis - p.stock_res as disp, s.estado as seller_estado
    from tumbo.carrito_items c
    join tumbo.productos p on p.sku = c.sku
    join tumbo.sellers s on s.id = p.seller_id
    where c.usuario_id = yo.id
    order by c.sku
  loop
    if r.estado <> 'publicado' or r.seller_estado <> 'aprobado' then
      -- (por SKU: el nombre actual podría ser un cambio aún sin moderar)
      raise exception 'El producto % ya no está disponible: quítalo del carrito.', r.sku;
    end if;
    if r.cant > 10 then
      raise exception 'Puedes llevar hasta 10 unidades de cada producto.';
    end if;
    if r.cant > r.disp then
      raise exception '«%» solo tiene % disponibles.', r.nombre, greatest(r.disp, 0);
    end if;
  end loop;

  select coalesce(sum(p.precio_usd * c.cant), 0) into v_subtotal
  from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
  where c.usuario_id = yo.id;
  if p_total_usd is not null and abs(v_subtotal - p_total_usd) >= 0.01 then
    raise exception 'Los precios de tu carrito cambiaron: ahora suman %. Revisa el carrito antes de pagar.', tumbo_privado.fmt_usd(v_subtotal);
  end if;

  -- Un pedido por seller (regla del marketplace)
  for v_seller in
    select distinct p.seller_id from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
    where c.usuario_id = yo.id order by 1
  loop
    v_id := 'TM-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(nextval('tumbo_privado.seq_pedido'), 5);
    insert into tumbo.pedidos (id, comprador_id, seller_id, estado, envio_tipo, envio_dir, courier,
                               costo_envio_usd, tasa, metodo, ref, pago_vence)
    values (v_id, yo.id, v_seller, 'pago_por_verificar', p_envio_tipo, v_dir, v_courier,
            v_costo, cfg.tasa, p_metodo, v_ref, now() + interval '48 hours');
    insert into tumbo.pedido_items (pedido_id, sku, nombre, img, cant, precio_usd)
    select v_id, p.sku, p.nombre, p.img, c.cant, p.precio_usd
    from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
    where c.usuario_id = yo.id and p.seller_id = v_seller;
    -- La reserva sale de las líneas del pedido: lo reservado es exactamente
    -- lo que luego liberan la cancelación, el rechazo o el despacho.
    update tumbo.productos p set stock_res = p.stock_res + i.cant, actualizado = now()
    from tumbo.pedido_items i
    where i.pedido_id = v_id and i.sku = p.sku;

    perform tumbo_privado.evento(v_id, yo.nombre, 'Pedido creado y pago registrado (' || p_metodo || ' ref. ' || v_ref || ')', 'shopping_cart');
    perform tumbo_privado.notificar('rol:finanzas', 'Pago ' || v_ref || ' pendiente de conciliar (' || v_id || ')', 'fact_check', 'admin/conciliacion.html');
    perform tumbo_privado.auditar(yo, 'Pedido creado', v_id || ' · ' || p_metodo || ' ' || v_ref);
    v_ids := v_ids || v_id;
  end loop;

  delete from tumbo.carrito_items where usuario_id = yo.id;
  return v_ids;
end $$;

-- Un pago que pasó 48 horas sin verificar ya no se concilia: el pedido
-- vence (y libera su stock) en la siguiente lectura.
create or replace function public.tm_conciliar_pago(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'pago_por_verificar' then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  if v.pago_vence < now() then
    raise exception 'El pago de % venció (48 horas sin verificar): el pedido se cancela y su stock se libera.', p_id;
  end if;
  update tumbo.pedidos set estado = 'por_aceptar', sla_horas = 24 where id = p_id;
  perform tumbo_privado.evento(p_id, 'Finanzas', 'Pago conciliado · pendiente de aceptación del seller', 'fact_check');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Nuevo pedido ' || p_id || ' pendiente de aceptar', 'shopping_cart',
                                  'seller/pedidos.html', array['seller', 'operador']);
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Confirmamos el pago de tu pedido ' || p_id, 'check_circle', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Conciliación de pago', v.ref || ' → ' || p_id);
end $$;

-- Ya no hay vencimiento dentro de carrito/pedido fuera de las funciones de
-- arriba; el ayudante de bloqueo de stock se mantiene igual.

-- ---------------------------------------------------------------------------
-- Catálogo: la pausa del seller sobrevive a un rechazo y a un reenvío
-- ---------------------------------------------------------------------------
create or replace function public.tm_guardar_producto(p_sesion text, p_datos jsonb, p_enviar boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.productos;
  v_sku text := nullif(trim(coalesce(p_datos ->> 'sku', '')), '');
  v_nombre text := trim(coalesce(p_datos ->> 'nombre', ''));
  v_categoria text := p_datos ->> 'categoria';
  v_precio numeric;
  v_stock integer;
  v_estado text;
  v_contenido boolean := false;
  v_enviar boolean := coalesce(p_enviar, false);
begin
  if jsonb_typeof(coalesce(p_datos, '{}'::jsonb)) <> 'object' then
    raise exception 'Datos del producto inválidos.';
  end if;
  if p_datos ? 'precioUsd' then
    if (p_datos ->> 'precioUsd') !~ '^\d{1,7}(\.\d{1,2})?$' or (p_datos ->> 'precioUsd')::numeric <= 0 then
      raise exception 'El precio debe ser mayor que cero.';
    end if;
    v_precio := (p_datos ->> 'precioUsd')::numeric;
  end if;
  if p_datos ? 'stockFis' then
    if (p_datos ->> 'stockFis') !~ '^\d{1,6}$' then raise exception 'El stock debe ser un número entero.'; end if;
    v_stock := (p_datos ->> 'stockFis')::integer;
  end if;
  if p_datos ? 'nombre' and char_length(v_nombre) not between 4 and 160 then
    raise exception 'El nombre necesita al menos 4 caracteres.';
  end if;
  if char_length(coalesce(p_datos ->> 'marca', '')) > 80 or char_length(coalesce(p_datos ->> 'descripcion', '')) > 4000 then
    raise exception 'La marca admite 80 caracteres y la descripción 4.000.';
  end if;
  if v_categoria is not null and not exists (select 1 from tumbo.categorias where id = v_categoria) then
    raise exception 'Categoría inválida.';
  end if;

  if v_sku is null then
    -- Alta (el operador fija el precio inicial; moderación lo revisa)
    if char_length(v_nombre) < 4 then raise exception 'El nombre necesita al menos 4 caracteres.'; end if;
    if v_precio is null then raise exception 'El precio debe ser mayor que cero.'; end if;
    perform 1 from tumbo.sellers where id = yo.seller_id for update;
    if (select count(*) from tumbo.productos where seller_id = yo.seller_id) >= 150 then
      raise exception 'Tu catálogo llegó al tope de la beta (150 productos).';
    end if;
    v_categoria := coalesce(v_categoria, 'tecnologia');
    v_sku := 'SKU-' || upper(left(v_categoria, 3)) || '-' || tumbo_privado.folio(nextval('tumbo_privado.seq_sku'), 4);
    v_estado := case when v_enviar then 'en_revision' else 'borrador' end;
    insert into tumbo.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, estado, img, descripcion)
    values (v_sku, yo.seller_id, v_nombre, trim(coalesce(p_datos ->> 'marca', '')), v_categoria, v_precio,
            coalesce(v_stock, 0), v_estado,
            'producto-0' || (1 + (select count(*) from tumbo.productos) % 6),
            trim(coalesce(p_datos ->> 'descripcion', '')));
  else
    v := tumbo_privado.bloquear_producto(v_sku, yo);
    -- El precio vigente es del seller principal y del gestor de precios.
    if yo.rol = 'operador' and v_precio is not null and v_precio <> v.precio_usd then
      raise exception 'El precio lo gestionan el seller principal o el gestor de precios.' using errcode = '42501';
    end if;
    if v_stock is not null and v_stock < v.stock_res then
      raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
    end if;
    v_contenido := (p_datos ? 'nombre' and v_nombre is distinct from v.nombre)
      or (p_datos ? 'marca' and trim(p_datos ->> 'marca') is distinct from v.marca)
      or (v_categoria is not null and v_categoria is distinct from v.categoria)
      or (p_datos ? 'descripcion' and trim(p_datos ->> 'descripcion') is distinct from v.descripcion);
    -- Lo que Moderación aprueba es exactamente lo que revisó.
    if v.estado = 'en_revision' and v_contenido then
      raise exception 'El producto está en revisión: espera la decisión de Moderación para cambiar su contenido.';
    end if;
    if v.estado = 'en_revision' then
      v_enviar := false;               -- ya está en la cola
    elsif v.estado in ('publicado', 'pausado') and v_contenido then
      v_enviar := true;
    elsif v_enviar and v.estado in ('publicado', 'pausado') then
      raise exception 'El producto ya pasó moderación: solo vuelve a revisión si cambias su contenido.';
    end if;
    v_estado := case
      when v_enviar then 'en_revision'
      when v.estado in ('publicado', 'pausado', 'en_revision') then v.estado
      else 'borrador' end;
    update tumbo.productos set
      nombre      = case when p_datos ? 'nombre' then v_nombre else nombre end,
      marca       = case when p_datos ? 'marca' then trim(p_datos ->> 'marca') else marca end,
      categoria   = coalesce(v_categoria, categoria),
      descripcion = case when p_datos ? 'descripcion' then trim(p_datos ->> 'descripcion') else descripcion end,
      precio_usd  = coalesce(v_precio, precio_usd),
      stock_fis   = coalesce(v_stock, stock_fis),
      estado      = v_estado,
      -- sale de pausado → volverá pausado; un rechazado o borrador que venía
      -- de una pausa conserva la marca hasta que Moderación lo apruebe
      volver_a_pausa = case
        when v_enviar then v.estado = 'pausado' or (v.estado in ('rechazado', 'borrador') and v.volver_a_pausa)
        else volver_a_pausa end,
      motivo_rechazo = case when v_enviar then null else motivo_rechazo end,
      actualizado = now()
    where sku = v_sku;
  end if;

  if v_enviar then
    perform tumbo_privado.notificar('rol:superadmin',
      'Producto ' || v_sku || ' («' || coalesce(nullif(v_nombre, ''), v.nombre) || '») espera moderación', 'category', 'admin/moderacion.html');
  end if;
  perform tumbo_privado.auditar(yo, case when v_enviar then 'Producto enviado a revisión' else 'Producto guardado' end, v_sku);
  return v_sku;
end $$;

create or replace function public.tm_moderar_producto(p_sesion text, p_sku text, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  if v.estado <> 'en_revision' then
    raise exception 'El producto % no está en revisión.', p_sku;
  end if;
  if p_aprobar then
    -- Si el seller lo tenía pausado, sigue pausado: aprobar no lo publica.
    update tumbo.productos
    set estado = case when v.volver_a_pausa then 'pausado' else 'publicado' end,
        volver_a_pausa = false, motivo_rechazo = null, actualizado = now()
    where sku = p_sku;
    perform tumbo_privado.notificar('seller:' || v.seller_id,
      case when v.volver_a_pausa then 'Tu producto ' || p_sku || ' fue aprobado; sigue pausado hasta que lo reanudes'
           else 'Tu producto ' || p_sku || ' fue aprobado y ya está publicado' end,
      'check_circle', 'seller/catalogo.html', array['seller', 'precios', 'operador']);
  else
    -- (la marca de pausa se conserva para cuando lo corrija y reenvíe)
    v_motivo := coalesce(v_motivo, 'No cumple los requisitos de publicación.');
    update tumbo.productos set estado = 'rechazado', motivo_rechazo = v_motivo, actualizado = now()
    where sku = p_sku;
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'Tu producto ' || p_sku || ' fue rechazado: ' || v_motivo, 'cancel',
                                    'seller/catalogo.html', array['seller', 'precios', 'operador']);
  end if;
  perform tumbo_privado.auditar(yo, case when p_aprobar then 'Producto aprobado' else 'Producto rechazado' end,
                                p_sku || case when p_aprobar then '' else ' · ' || v_motivo end);
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios por firma exacta (una sobrecarga ajena con el mismo nombre no
-- se toca). Además, aviso si hay funciones public.tm_* que no son de Tumbo y
-- que anon puede ejecutar: las migraciones 1-4 concedían por patrón.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

do $$
declare
  firmas regprocedure[] := array[
    'public.tm_acceder(text,text)', 'public.tm_registrar(text,text,text)', 'public.tm_sesion(text)',
    'public.tm_salir(text)', 'public.tm_cargar(text,text)', 'public.tm_auditoria(text,bigint,text)',
    'public.tm_marcar_notificaciones_leidas(text)', 'public.tm_carrito_poner(text,text,integer)',
    'public.tm_carrito_quitar(text,text)', 'public.tm_fusionar_carrito(text,jsonb)',
    'public.tm_direccion_agregar(text,jsonb)', 'public.tm_direccion_quitar(text,uuid)',
    'public.tm_crear_pedido(text,text,uuid,text,text,numeric)', 'public.tm_conciliar_pago(text,text)',
    'public.tm_rechazar_pago(text,text,text)', 'public.tm_aceptar_pedido(text,text)',
    'public.tm_marcar_listo(text,text,numeric)', 'public.tm_despachar(text,text)',
    'public.tm_confirmar_entrega(text,text)', 'public.tm_cancelar_pedido(text,text,text)',
    'public.tm_abrir_disputa(text,text,text,text,text[])', 'public.tm_responder_disputa(text,text,text,text[])',
    'public.tm_resolver_disputa(text,text,text,text)', 'public.tm_cerrar_devolucion(text,text,boolean)',
    'public.tm_cerrar_ventana(text,text)', 'public.tm_ejecutar_liquidacion(text,text,text[])',
    'public.tm_guardar_producto(text,jsonb,boolean)', 'public.tm_ajustar_producto(text,text,text,numeric)',
    'public.tm_pausar_producto(text,text,boolean)', 'public.tm_moderar_producto(text,text,boolean,text)',
    'public.tm_decidir_kyc(text,text,text,text)', 'public.tm_reiniciar_demo(text)']::regprocedure[];
  f regprocedure;
  ajena record;
begin
  foreach f in array firmas loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  for ajena in
    select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'tm\_%' and p.oid <> all (firmas::oid[])
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    raise warning 'La función % no es de Tumbo y anon puede ejecutarla: revisa si ese permiso es suyo.', ajena.firma;
  end loop;
end $$;

notify pgrst, 'reload schema';
