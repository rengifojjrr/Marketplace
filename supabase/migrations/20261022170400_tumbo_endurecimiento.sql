-- =========================================================================
-- Tumbo Market — Endurecimiento (tercera revisión)
-- -------------------------------------------------------------------------
-- Se aplica sobre las cuatro migraciones anteriores. Cierra lo que una
-- cuenta demo (con contraseña pública) o un anónimo podían hacer contra el
-- proyecto compartido o contra la operación:
--   · topes de escritura por usuario, de catálogo por comercio y de
--     unidades por producto; los pagos sin verificar vencen a las 48 h;
--   · frenos de acceso por red (IPv6 por /64) con techo global de fallos
--     (acota el bcrypt en la base compartida) y sin bloquear al dueño desde
--     la red en la que ya entró;
--   · la auditoría no se puede tapar a fuerza de acciones triviales;
--   · tm_cargar devuelve siempre lo pendiente (el tope solo aplica al
--     historial), no publica reservas internas y no repite la descarga si
--     nada cambió;
--   · el pedido respeta el precio que vio el comprador, una referencia de
--     pago no se reutiliza, la liquidación paga exactamente lo mostrado y la
--     devolución tiene cierre;
--   · los folios no se truncan (lpad cortaba al pasar del ancho).
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
alter table tumbo.pedidos add column pago_vence timestamptz;
alter table tumbo.productos add column volver_a_pausa boolean not null default false;

create index pedidos_ref_idx on tumbo.pedidos (ref);
create index pedidos_pago_vence_idx on tumbo.pedidos (pago_vence) where estado = 'pago_por_verificar';
create index intentos_acceso_fecha_idx on tumbo.intentos_acceso (exito, fecha);

-- Escrituras por usuario en ventanas de 10 minutos.
create table tumbo.cuotas (
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  ventana    timestamptz not null,
  n          integer not null,
  primary key (usuario_id, ventana)
);
alter table tumbo.cuotas enable row level security;
revoke all on tumbo.cuotas from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
-- Folio con ancho mínimo: lpad trunca ('10000' a 4 → '1000') y repetía claves.
create function tumbo_privado.folio(p_n bigint, p_ancho integer) returns text
language sql immutable set search_path = '' as $$
  select case when length(p_n::text) >= p_ancho then p_n::text else lpad(p_n::text, p_ancho, '0') end
$$;

-- IP del cliente según el borde de Supabase. Una conexión IPv6 suele tener
-- un /64 entero: se agrupa por /64 para que rotar direcciones no evada los
-- frenos.
create or replace function tumbo_privado.ip_cliente() returns text
language plpgsql stable set search_path = '' as $$
declare
  v text;
begin
  v := nullif(current_setting('request.headers', true), '')::jsonb ->> 'cf-connecting-ip';
  if v is null or v !~ '^[0-9A-Fa-f:.]{3,45}$' then
    return 'desconocida';
  end if;
  if family(v::inet) = 6 and v !~* '^::ffff:' then
    return host(network(set_masklen(v::inet, 64))) || '/64';
  end if;
  return host(v::inet);
exception when others then
  return 'desconocida';
end $$;

-- Rol, y además un tope de escrituras por usuario: con las cuentas demo
-- (contraseña pública) nadie puede inundar la base compartida. Una llamada
-- que falla no cuenta (su transacción se revierte).
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
  insert into tumbo.cuotas as c (usuario_id, ventana, n)
  values (u.id, date_bin('10 minutes', now(), timestamptz '2000-01-01'), 1)
  on conflict (usuario_id, ventana) do update set n = c.n + 1
  returning n into v_n;
  if v_n > 150 then
    raise exception 'Vas muy rápido: espera unos minutos antes de seguir.';
  end if;
  return u;
end $$;

-- Hasta 50 sesiones abiertas por cuenta (las cuentas demo se comparten).
create or replace function tumbo_privado.abrir_sesion(p_usuario uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from tumbo.sesiones where expira < now();
  delete from tumbo.sesiones where usuario_id = p_usuario and token_hash in (
    select token_hash from tumbo.sesiones where usuario_id = p_usuario order by creada desc offset 49);
  delete from tumbo.cuotas where ventana < now() - interval '1 day';
  insert into tumbo.sesiones (token_hash, usuario_id, expira)
  values (tumbo_privado.hash_token(v_token), p_usuario, now() + interval '7 days');
  return v_token;
end $$;

-- Pagos que nadie verificó en 48 horas: el pedido vence y libera su reserva
-- (así un pago falso no retiene stock indefinidamente). Se invoca al
-- reservar; los pedidos de la semilla no vencen.
create function tumbo_privado.vencer_pagos() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids text[];
  v tumbo.pedidos;
begin
  select array_agg(id order by id) into v_ids
  from (select id from tumbo.pedidos
        where estado = 'pago_por_verificar' and pago_vence < now()
        order by id limit 50 for update skip locked) x;
  if v_ids is null then
    return;
  end if;
  perform 1 from tumbo.productos
  where sku in (select sku from tumbo.pedido_items where pedido_id = any (v_ids))
  order by sku for update;
  for v in select * from tumbo.pedidos where id = any (v_ids) order by id loop
    update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = v.id;
    update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
    perform tumbo_privado.evento(v.id, 'Sistema', 'Pago sin verificar en 48 horas · pedido vencido y stock liberado', 'schedule');
    perform tumbo_privado.notificar('usr:' || v.comprador_id,
      'Tu pedido ' || v.id || ' venció: no pudimos verificar el pago a tiempo', 'schedule', 'tienda/pedido.html?id=' || v.id);
    perform tumbo_privado.auditar(null, 'Pedido vencido', v.ref || ' → ' || v.id);
  end loop;
end $$;

-- Bloquea los productos de un pedido en orden de SKU, el mismo que usa
-- tm_crear_pedido: dos operaciones sobre el mismo stock no se interbloquean.
create function tumbo_privado.bloquear_stock(p_pedido text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from tumbo.productos
  where sku in (select sku from tumbo.pedido_items where pedido_id = p_pedido)
  order by sku for update;
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
  -- Los fallos se guardan un día; los aciertos, siete (identifican la red
  -- desde la que el dueño suele entrar).
  delete from tumbo.intentos_acceso
  where (not exito and fecha < now() - interval '1 day') or (exito and fecha < now() - interval '7 days');

  -- Techo global de fallos: acota el coste de bcrypt en la base compartida
  -- aunque el ataque venga de muchas redes.
  if (select count(*) from tumbo.intentos_acceso
      where not exito and fecha > now() - interval '1 minute' and tipo = 'acceso') >= 150 then
    return jsonb_build_object('error', 'El acceso está muy solicitado en este momento. Inténtalo de nuevo en un minuto.');
  end if;
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 8
     or (v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
         where tipo = 'acceso' and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 40)
     or (v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
         where tipo = 'acceso' and ip = v_ip and exito and fecha > now() - interval '15 minutes') >= 200)
     -- techo por cuenta para quien rote redes; no frena al dueño en una red
     -- desde la que ya entró esta semana
     or ((select count(*) from tumbo.intentos_acceso
          where tipo = 'acceso' and email = v_email and not exito and fecha > now() - interval '15 minutes') >= 100
         and not exists (select 1 from tumbo.intentos_acceso
          where tipo = 'acceso' and email = v_email and ip = v_ip and exito and fecha > now() - interval '7 days')) then
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
  v_token := tumbo_privado.abrir_sesion(u.id);
  -- Un inicio de sesión por cuenta cada 10 minutos basta para la auditoría
  -- (que es inmutable: repetirlo sin tope la haría crecer sin límite).
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
  delete from tumbo.intentos_acceso
  where (not exito and fecha < now() - interval '1 day') or (exito and fecha < now() - interval '7 days');
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
  perform tumbo_privado.auditar(u, 'Registro de comprador', 'cuenta nueva');
  return jsonb_build_object('sesion', tumbo_privado.abrir_sesion(u.id), 'usuario', tumbo_privado.perfil_json(u));
end $$;

-- Solo los avisos que la persona ve (los 100 más recientes), no el historial
-- completo del rol.
create or replace function public.tm_marcar_notificaciones_leidas(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
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
-- Cambios respecto de la versión anterior:
--   · los pedidos y reclamos pendientes llegan siempre; el tope (150) solo
--     aplica al historial ya cerrado;
--   · fuera del equipo del comercio, el producto muestra lo disponible y no
--     sus reservas, fechas internas ni motivos de rechazo;
--   · el operador no recibe en la línea de tiempo los eventos de dinero ni
--     de reclamos;
--   · la auditoría reserva su propia ventana a los inicios de sesión, que
--     no pueden tapar al resto;
--   · `huella`: si el cliente ya tiene esta versión, solo se confirma.
drop function public.tm_cargar(text);
create function public.tm_cargar(p_sesion text default null, p_huella text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_uid uuid := u.id;
  v_rol text := u.rol;
  v_seller text := u.seller_id;
  v_admin boolean := coalesce(u.rol in ('superadmin', 'ops', 'finanzas'), false);
  r jsonb;
  v_h text;
begin
  r := jsonb_build_object(
    'yo', case when v_uid is null then null else tumbo_privado.perfil_json(u) end,
    'sesion_invalida', p_sesion is not null and v_uid is null,
    'config', (select to_jsonb(c) - 'id' from tumbo.config c),
    'categorias', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden) from tumbo.categorias c), '[]'::jsonb),
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
    r := r || jsonb_build_object(
      -- El comercio solo ve pedidos con el pago ya conciliado, y el operador,
      -- sin los datos de dinero ni de reclamos.
      'pedidos', coalesce((
        select jsonb_agg((case when v_rol = 'operador'
                               then to_jsonb(p) - 'comprador_id' - 'liquidacion' - 'liquidacion_id' - 'disputa_id'
                               else to_jsonb(p) - 'comprador_id' end) || jsonb_build_object(
                 'mio', p.comprador_id = v_uid,
                 'pedido_items', coalesce((select jsonb_agg(to_jsonb(i) - 'pedido_id' order by i.sku)
                                           from tumbo.pedido_items i where i.pedido_id = p.id), '[]'::jsonb),
                 'pedido_eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'pedido_id' order by e.fecha, e.id)
                                             from tumbo.pedido_eventos e
                                             where e.pedido_id = p.id
                                               and (v_rol <> 'operador' or e.icono not in ('gavel', 'lock_open', 'undo', 'receipt_long'))),
                                            '[]'::jsonb))
               order by p.creado desc)
        from (
          (select * from tumbo.pedidos p
           where (p.comprador_id = v_uid
                  or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
                      and p.estado <> 'pago_por_verificar'
                      and not (p.estado = 'cancelado' and p.sla_horas is null))
                  or v_admin)
             and (p.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                  or p.liquidacion in ('retenido', 'congelado', 'elegible'))
           order by p.creado desc limit 1000)
          union all
          (select * from tumbo.pedidos p
           where (p.comprador_id = v_uid
                  or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
                      and p.estado <> 'pago_por_verificar'
                      and not (p.estado = 'cancelado' and p.sla_horas is null))
                  or v_admin)
             and not (p.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                      or coalesce(p.liquidacion in ('retenido', 'congelado', 'elegible'), false))
           order by p.creado desc limit 150)) p), '[]'::jsonb),
      'disputas', coalesce((
        select jsonb_agg((to_jsonb(d) - 'comprador_id') || jsonb_build_object('mio', d.comprador_id = v_uid) order by d.creado desc)
        from (
          (select * from tumbo.disputas d
           where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
             and d.estado <> 'resuelta'
           order by d.creado desc limit 1000)
          union all
          (select * from tumbo.disputas d
           where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
             and d.estado = 'resuelta'
           order by d.creado desc limit 150)) d), '[]'::jsonb),
      'liquidaciones', coalesce((
        select jsonb_agg(to_jsonb(l) order by l.fecha desc, l.id desc)
        from (select * from tumbo.liquidaciones l
              where (l.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'finanzas')
              order by l.fecha desc, l.id desc limit 200) l), '[]'::jsonb),
      -- Finanzas necesita el RIF para pagar, no las observaciones de cumplimiento.
      'kyc', coalesce((
        select jsonb_agg(case when v_rol = 'finanzas' then to_jsonb(k) - 'observacion' else to_jsonb(k) end)
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
          (select * from tumbo.auditoria where accion <> 'Inicio de sesión' order by fecha desc, id desc limit 400)
          union all
          (select * from tumbo.auditoria where accion = 'Inicio de sesión' order by fecha desc, id desc limit 100)) a), '[]'::jsonb)
        else '[]'::jsonb end,
      'direcciones', coalesce((
        select jsonb_agg(to_jsonb(d) - 'usuario_id' order by d.creado) from tumbo.direcciones d
        where d.usuario_id = v_uid), '[]'::jsonb),
      'carrito', coalesce((
        select jsonb_agg(jsonb_build_object('sku', c.sku, 'cant', c.cant) order by c.agregado) from tumbo.carrito_items c
        where c.usuario_id = v_uid), '[]'::jsonb)
    );
  end if;

  v_h := md5(r::text);
  if p_huella is not null and p_huella = v_h then
    return jsonb_build_object('sin_cambios', true, 'huella', v_h);
  end if;
  return r || jsonb_build_object('huella', v_h);
end $$;

-- ---------------------------------------------------------------------------
-- Carrito y direcciones
-- ---------------------------------------------------------------------------
create or replace function public.tm_carrito_poner(p_sesion text, p_sku text, p_cant integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v_disp integer;
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'carrito');
  if p_cant is null or p_cant < 1 or p_cant > 10 then
    raise exception 'Puedes llevar entre 1 y 10 unidades de cada producto.';
  end if;
  perform tumbo_privado.vencer_pagos();
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

create or replace function public.tm_fusionar_carrito(p_sesion text, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'carrito');
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'Carrito inválido.';
  end if;
  insert into tumbo.carrito_items as c (usuario_id, sku, cant)
  select yo.id, p.sku, least(10, greatest(1, sum((i ->> 'cant')::int)))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  join tumbo.productos p on p.sku = i ->> 'sku' and p.estado = 'publicado'
  join tumbo.sellers s on s.id = p.seller_id and s.estado = 'aprobado'
  where jsonb_typeof(i) = 'object' and (i ->> 'cant') ~ '^\d{1,2}$'
  group by p.sku
  on conflict (usuario_id, sku) do update set cant = least(10, c.cant + excluded.cant);
end $$;

-- Una dirección nueva no se audita: es un dato del comprador, no una
-- decisión del marketplace (y la auditoría es inmutable).
create or replace function public.tm_direccion_agregar(p_sesion text, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v_id uuid;
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'direcciones');
  insert into tumbo.direcciones (usuario_id, nombre, linea, municipio, ciudad, codigo, telefono, predeterminada)
  values (yo.id, trim(coalesce(p_datos ->> 'nombre', '')), trim(coalesce(p_datos ->> 'linea', '')),
          trim(coalesce(p_datos ->> 'municipio', '')), coalesce(nullif(trim(p_datos ->> 'ciudad'), ''), 'Caracas'),
          coalesce(nullif(trim(p_datos ->> 'codigo'), ''), '1010'), coalesce(nullif(trim(p_datos ->> 'telefono'), ''), '—'),
          false)
  returning id into v_id;
  return v_id;
exception when check_violation then
  raise exception 'Revisa la dirección: nombre, dirección completa y municipio son obligatorios.';
end $$;

-- ---------------------------------------------------------------------------
-- Pedido
-- ---------------------------------------------------------------------------
-- p_total_usd: el subtotal que vio el comprador. Si los precios cambiaron
-- mientras pagaba, el pedido no se crea con otro monto sin avisarle.
drop function public.tm_crear_pedido(text, text, uuid, text, text);
create function public.tm_crear_pedido(p_sesion text, p_envio_tipo text, p_direccion_id uuid, p_metodo text, p_ref text,
                                       p_total_usd numeric default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  cfg tumbo.config;
  v_ref text := upper(trim(coalesce(p_ref, '')));
  v_dir text;
  v_courier text;
  v_costo numeric;
  v_subtotal numeric;
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
  if char_length(v_ref) < 5 or char_length(v_ref) > 30 then
    raise exception 'Registra la referencia del pago (entre 5 y 30 caracteres).';
  end if;
  -- Una referencia bancaria corresponde a un solo pago.
  if exists (select 1 from tumbo.pedidos where ref = v_ref and estado <> 'cancelado') then
    raise exception 'La referencia % ya está registrada en otro pedido: revisa el número del pago.', v_ref;
  end if;
  if (select count(*) from tumbo.pedidos where comprador_id = yo.id and estado = 'pago_por_verificar') >= 5 then
    raise exception 'Tienes 5 pedidos con el pago por verificar: espera la conciliación o cancela alguno.';
  end if;
  if (select count(*) from tumbo.pedidos where comprador_id = yo.id and creado > now() - interval '1 hour') >= 10 then
    raise exception 'Has creado muchos pedidos en la última hora: inténtalo más tarde.';
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

  -- Libera antes lo retenido por pagos vencidos.
  perform tumbo_privado.vencer_pagos();

  -- Bloqueo de los productos del carrito en orden estable (sin interbloqueos
  -- entre compras simultáneas): el stock se valida y se reserva atómicamente.
  perform 1 from tumbo.productos p
  where p.sku in (select c.sku from tumbo.carrito_items c where c.usuario_id = yo.id)
  order by p.sku for update;

  if not exists (select 1 from tumbo.carrito_items where usuario_id = yo.id) then
    raise exception 'El carrito está vacío.';
  end if;

  for r in
    select c.cant, c.sku, p.nombre, p.estado, p.stock_fis - p.stock_res as disp, s.estado as seller_estado
    from tumbo.carrito_items c
    join tumbo.productos p on p.sku = c.sku
    join tumbo.sellers s on s.id = p.seller_id
    where c.usuario_id = yo.id
  loop
    if r.estado <> 'publicado' or r.seller_estado <> 'aprobado' then
      -- (por SKU: el nombre actual podría ser un cambio aún sin moderar)
      raise exception 'El producto % ya no está disponible: quítalo del carrito.', r.sku;
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

create or replace function public.tm_rechazar_pago(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_motivo text := coalesce(left(nullif(trim(coalesce(p_motivo, '')), ''), 200), 'el pago no se pudo verificar');
begin
  if v.estado <> 'pago_por_verificar' then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  perform tumbo_privado.bloquear_stock(p_id);
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, 'Finanzas', 'Pago rechazado (' || v_motivo || ') · pedido cancelado y stock liberado', 'block');
  perform tumbo_privado.notificar('usr:' || v.comprador_id,
    'No pudimos verificar el pago de tu pedido ' || p_id || ': ' || v_motivo, 'block', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Pago rechazado', v.ref || ' → ' || p_id || ' · ' || v_motivo);
end $$;

create or replace function public.tm_despachar(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'listo' then
    raise exception 'El pedido % no está listo para despachar.', p_id;
  end if;
  perform tumbo_privado.bloquear_stock(p_id);
  update tumbo.pedidos set estado = 'despachado', despachado_el = now() where id = p_id;
  -- El stock sale del inventario al entregarse al courier.
  update tumbo.productos p
  set stock_fis = greatest(0, p.stock_fis - i.cant),
      stock_res = greatest(0, p.stock_res - i.cant),
      actualizado = now()
  from tumbo.pedido_items i
  where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, 'Courier', 'Paquete retirado por ' || v.courier || ' · en tránsito', 'local_shipping');
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Tu pedido ' || p_id || ' va en camino', 'local_shipping', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.notificar('rol:ops', 'Pedido ' || p_id || ' despachado con ' || v.courier, 'local_shipping', 'admin/pedidos.html');
  perform tumbo_privado.auditar(yo, 'Despacho al courier (demo)', p_id);
end $$;

create or replace function public.tm_cancelar_pedido(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 200);
begin
  if v.estado in ('despachado', 'entregado', 'cerrado', 'reembolsado', 'devolucion') then
    raise exception 'El pedido ya fue despachado: corresponde un reclamo, no una cancelación.';
  end if;
  if v.estado = 'cancelado' then
    raise exception 'El pedido % ya está cancelado.', p_id;
  end if;
  perform tumbo_privado.bloquear_stock(p_id);
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, yo.nombre,
    'Pedido cancelado (' || coalesce(v_motivo, 'sin motivo') || ') · stock liberado' ||
    case when v.estado = 'pago_por_verificar' then '' else ' y reembolso en cola' end, 'cancel');
  if v.estado <> 'pago_por_verificar' then
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'El comprador canceló el pedido ' || p_id, 'cancel',
                                    'seller/pedidos.html?estado=', array['seller', 'operador']);
    perform tumbo_privado.notificar('rol:finanzas', 'Cancelación de ' || p_id || ': procesar reembolso demo', 'undo', 'admin/conciliacion.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Cancelación', p_id || coalesce(' · ' || v_motivo, ''));
end $$;

-- ---------------------------------------------------------------------------
-- Disputas: la devolución tiene cierre
-- ---------------------------------------------------------------------------
create or replace function public.tm_abrir_disputa(p_sesion text, p_pedido text, p_motivo text, p_descripcion text, p_evidencia text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_pedido, yo);
  cfg tumbo.config;
  v_id text;
  v_desc text := trim(coalesce(p_descripcion, ''));
  v_evid text[] := coalesce(p_evidencia, '{}');
begin
  select * into cfg from tumbo.config;
  if v.disputa_id is not null then
    raise exception 'Este pedido ya tiene un reclamo abierto.';
  end if;
  if v.estado <> 'entregado' or v.liquidacion is distinct from 'retenido'
     or v.entregado_el < now() - make_interval(days => cfg.ventana_reclamo_dias) then
    raise exception 'Solo un pedido entregado y dentro de la ventana de reclamo (% días) admite reclamo.', cfg.ventana_reclamo_dias;
  end if;
  if p_motivo is null or p_motivo not in ('Producto dañado', 'Producto incorrecto', 'Faltan piezas o accesorios',
                                         'No coincide con la descripción', 'Otro') then
    raise exception 'Elige el motivo del reclamo.';
  end if;
  if char_length(v_desc) < 15 or char_length(v_desc) > 2000 then
    raise exception 'Describe el problema con al menos 15 caracteres.';
  end if;
  if coalesce(array_ndims(v_evid), 1) <> 1 or cardinality(v_evid) > 10
     or exists (select 1 from unnest(v_evid) e where char_length(e) > 120) then
    raise exception 'Adjunta como máximo 10 archivos.';
  end if;

  v_id := 'DSP-' || tumbo_privado.folio(nextval('tumbo_privado.seq_disputa'), 4);
  insert into tumbo.disputas (id, pedido_id, comprador_id, seller_id, motivo, descripcion, evidencia, monto_usd, estado)
  values (v_id, v.id, v.comprador_id, v.seller_id, p_motivo, v_desc, v_evid, tumbo_privado.bruto_pedido(v.id), 'abierta');
  update tumbo.pedidos set disputa_id = v_id, liquidacion = 'congelado' where id = v.id;
  perform tumbo_privado.evento(v.id, yo.nombre, 'Reclamo ' || v_id || ' abierto · liquidación congelada', 'gavel');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Reclamo ' || v_id || ' abierto sobre ' || v.id || ': responde con tu evidencia', 'gavel', 'seller/disputas.html');
  perform tumbo_privado.notificar('rol:ops', 'Disputa ' || v_id || ' en cola: ' || p_motivo, 'gavel', 'admin/disputas.html');
  perform tumbo_privado.auditar(yo, 'Apertura de disputa', v_id || ' sobre ' || v.id);
  return v_id;
end $$;

-- Tras resolver con devolución, Operaciones cierra el caso: si el producto
-- volvió, se reembolsa al comprador y el stock se repone; si no volvió, los
-- fondos se liberan al seller.
create function public.tm_cerrar_devolucion(p_sesion text, p_id text, p_recibida boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'devolucion' then
    raise exception 'El pedido % no tiene una devolución en curso.', p_id;
  end if;
  if p_recibida is null then
    raise exception 'Indica si el producto volvió.';
  end if;
  if p_recibida then
    perform tumbo_privado.bloquear_stock(p_id);
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = p_id;
    update tumbo.productos p set stock_fis = p.stock_fis + i.cant, actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'Devolución recibida · reembolso al comprador (demo) y stock repuesto', 'undo');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Recibimos la devolución de ' || p_id || ': reembolso en proceso (demo)', 'undo', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id || ' volvió a tu inventario; el pedido se reembolsó', 'assignment_return', 'seller/disputas.html');
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = p_id;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'El producto no se devolvió en el plazo · fondos liberados al seller', 'lock_open');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'La devolución de ' || p_id || ' se cerró: el producto no llegó en el plazo', 'gavel', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Cierre de devolución', p_id || ' → ' || case when p_recibida then 'recibida, reembolso' else 'no recibida, fondos al seller' end);
end $$;

-- ---------------------------------------------------------------------------
-- Finanzas: la corrida paga exactamente los pedidos que se mostraron
-- ---------------------------------------------------------------------------
drop function public.tm_ejecutar_liquidacion(text, text);
create function public.tm_ejecutar_liquidacion(p_sesion text, p_seller text, p_pedidos text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  cfg tumbo.config;
  v_ids text[];
  v_bruto numeric;
  v_comision numeric;
  v_tarifa numeric;
  v_neto numeric;
  v_num bigint;
  v_id text;
  v_cpr text;
  v_hoy text := to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY');
begin
  if p_pedidos is null or coalesce(array_ndims(p_pedidos), 0) <> 1 or cardinality(p_pedidos) > 1000 then
    raise exception 'Indica los pedidos de la corrida.';
  end if;
  select * into cfg from tumbo.config;
  select array_agg(id order by id) into v_ids
  from (select id from tumbo.pedidos
        where seller_id = p_seller and liquidacion = 'elegible' and id = any (p_pedidos)
        order by id for update) e;
  if v_ids is null then
    raise exception 'No hay pedidos elegibles para este seller.';
  end if;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(p_pedidos) x) then
    raise exception 'La corrida cambió (algún pedido ya no está elegible): recarga la página y revísala.';
  end if;

  select coalesce(sum(i.precio_usd * i.cant), 0) into v_bruto from tumbo.pedido_items i where i.pedido_id = any (v_ids);
  v_comision := round(v_bruto * cfg.comision_pct / 100, 2);
  v_tarifa := round(cfg.tarifa_fija_usd * array_length(v_ids, 1), 2);
  v_neto := v_bruto - v_comision - v_tarifa;
  if v_neto <= 0 then
    raise exception 'El neto sería % : acumula más pedidos antes de liquidar.', tumbo_privado.fmt_usd(v_neto);
  end if;
  v_num := nextval('tumbo_privado.seq_liquidacion');
  v_id := 'LIQ-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(v_num, 3);
  v_cpr := 'CPR-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(v_num, 3);

  insert into tumbo.liquidaciones (id, seller_id, periodo, pedidos, bruto_usd, comision_usd, tarifa_usd, neto_usd, estado, fecha, comprobante)
  values (v_id, p_seller, 'hasta ' || v_hoy, v_ids, v_bruto, v_comision, v_tarifa, v_neto, 'pagada',
          (now() at time zone 'America/Caracas')::date, v_cpr);
  update tumbo.pedidos set liquidacion = 'liquidado', liquidacion_id = v_id where id = any (v_ids);
  insert into tumbo.pedido_eventos (pedido_id, actor, texto, icono)
  select unnest(v_ids), 'Finanzas', 'Incluido en la liquidación ' || v_id || ' (demo)', 'receipt_long';
  perform tumbo_privado.notificar('seller:' || p_seller,
    'Liquidación ' || v_id || ' ejecutada: ' || tumbo_privado.fmt_usd(v_neto) || ' · comprobante ' || v_cpr, 'receipt_long', 'seller/finanzas.html');
  perform tumbo_privado.auditar(yo, 'Liquidación ejecutada', v_id || ' → ' || p_seller || ' · ' || tumbo_privado.fmt_usd(v_neto));
  return jsonb_build_object('id', v_id, 'netoUsd', v_neto, 'comprobante', v_cpr);
end $$;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
-- Cambios: tope de 150 productos por comercio; folio sin truncar; enviar a
-- revisión un producto que ya está en cola no es un error; corregir un
-- producto pausado lo devuelve pausado tras la aprobación.
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
      volver_a_pausa = case when v_enviar then v.estado = 'pausado' else volver_a_pausa end,
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
    v_motivo := coalesce(v_motivo, 'No cumple los requisitos de publicación.');
    update tumbo.productos set estado = 'rechazado', volver_a_pausa = false, motivo_rechazo = v_motivo, actualizado = now()
    where sku = p_sku;
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'Tu producto ' || p_sku || ' fue rechazado: ' || v_motivo, 'cancel',
                                    'seller/catalogo.html', array['seller', 'precios', 'operador']);
  end if;
  perform tumbo_privado.auditar(yo, case when p_aprobar then 'Producto aprobado' else 'Producto rechazado' end,
                                p_sku || case when p_aprobar then '' else ' · ' || v_motivo end);
end $$;

-- La observación de cumplimiento queda en el expediente (que Finanzas no
-- ve); la auditoría registra la decisión, no el motivo.
create or replace function public.tm_decidir_kyc(p_sesion text, p_seller text, p_decision text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
  v_antes text;
begin
  if p_decision is null or p_decision not in ('aprobado', 'observado', 'rechazado', 'suspendido') then
    raise exception 'Decisión inválida.';
  end if;
  select estado into v_antes from tumbo.sellers where id = p_seller for update;
  if not found then raise exception 'Seller % no encontrado.', p_seller; end if;
  if p_decision <> 'aprobado' and v_motivo is null then
    raise exception 'Indica el motivo: el seller lo verá.';
  end if;
  update tumbo.sellers set estado = p_decision where id = p_seller;
  insert into tumbo.sellers_kyc (seller_id, rif, observacion) values (p_seller, '—', null)
  on conflict (seller_id) do nothing;
  update tumbo.sellers_kyc
  set observacion = case when p_decision = 'aprobado' then null else v_motivo end
  where seller_id = p_seller;
  if p_decision = 'aprobado' then
    update tumbo.seller_documentos set estado = 'aprobado' where seller_id = p_seller;
  end if;
  perform tumbo_privado.notificar('seller:' || p_seller,
    case p_decision
      when 'aprobado' then 'Tu comercio fue homologado: ya puedes vender en Tumbo'
      when 'observado' then 'Tu expediente tiene observaciones: ' || v_motivo
      when 'suspendido' then 'Tu comercio fue suspendido: ' || v_motivo
      else 'Tu solicitud fue rechazada: ' || v_motivo end,
    'verified_user', null);
  perform tumbo_privado.auditar(yo, 'Decisión KYC', p_seller || ': ' || v_antes || ' → ' || p_decision);
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: solo las funciones de Tumbo, por nombre (una función tm_* de
-- otra aplicación del proyecto no se toca).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'tm_acceder', 'tm_registrar', 'tm_sesion', 'tm_salir', 'tm_cargar', 'tm_marcar_notificaciones_leidas',
      'tm_carrito_poner', 'tm_carrito_quitar', 'tm_fusionar_carrito', 'tm_direccion_agregar', 'tm_direccion_quitar',
      'tm_crear_pedido', 'tm_conciliar_pago', 'tm_rechazar_pago', 'tm_aceptar_pedido', 'tm_marcar_listo',
      'tm_despachar', 'tm_confirmar_entrega', 'tm_cancelar_pedido', 'tm_abrir_disputa', 'tm_responder_disputa',
      'tm_resolver_disputa', 'tm_cerrar_devolucion', 'tm_cerrar_ventana', 'tm_ejecutar_liquidacion',
      'tm_guardar_producto', 'tm_ajustar_producto', 'tm_pausar_producto', 'tm_moderar_producto', 'tm_decidir_kyc',
      'tm_reiniciar_demo'])
  loop
    execute format('revoke execute on function %s from public', f.firma);
    execute format('grant execute on function %s to anon, authenticated', f.firma);
  end loop;
end $$;

notify pgrst, 'reload schema';
