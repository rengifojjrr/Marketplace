-- =========================================================================
-- Tumbo Market — Núcleo: sesiones, ayudantes y lectura por rol
-- -------------------------------------------------------------------------
-- · Identidad propia: correo + contraseña (bcrypt) en tumbo.usuarios y
--   tokens de sesión opacos (32 bytes aleatorios; en la base, su SHA-256).
-- · Cada función de la API recibe `p_sesion` y obtiene el usuario con
--   tumbo_privado.usuario(); no hay otra forma de identificarse.
-- · public.tm_cargar() devuelve de una vez todo lo que ese rol puede ver: es
--   la única lectura de datos. Las reglas de visibilidad viven aquí.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Sesiones
-- ---------------------------------------------------------------------------
-- IP del cliente según el proxy de Supabase (Cloudflare la fija y no se puede
-- falsificar desde el navegador); sin cabeceras, 'desconocida'.
create function tumbo_privado.ip_cliente() returns text
language plpgsql stable set search_path = '' as $$
declare
  h jsonb;
begin
  h := nullif(current_setting('request.headers', true), '')::jsonb;
  return left(coalesce(
    nullif(h ->> 'cf-connecting-ip', ''),
    nullif(h ->> 'x-real-ip', ''),
    nullif(trim((regexp_split_to_array(coalesce(h ->> 'x-forwarded-for', ''), ','))[1]), ''),
    'desconocida'), 64);
exception when others then
  return 'desconocida';
end $$;

create function tumbo_privado.hash_token(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(p_token, 'sha256')
$$;

-- Usuario de la sesión, o NULL si no hay sesión, venció o la cuenta está
-- inactiva. Renueva la caducidad como mucho una vez cada 10 minutos.
create function tumbo_privado.usuario(p_sesion text) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
  s tumbo.sesiones;
begin
  if p_sesion is null or p_sesion !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into s from tumbo.sesiones
  where token_hash = tumbo_privado.hash_token(p_sesion) and expira > now();
  if not found then
    return null;
  end if;
  select * into u from tumbo.usuarios where id = s.usuario_id and activo;
  if not found then
    return null;
  end if;
  -- Renovación deslizante de 7 días, con tope absoluto de 30 desde el acceso.
  if s.ultimo_uso < now() - interval '10 minutes' then
    update tumbo.sesiones
    set ultimo_uso = now(), expira = least(creada + interval '30 days', greatest(expira, now() + interval '7 days'))
    where token_hash = s.token_hash;
  end if;
  return u;
end $$;

create function tumbo_privado.exigir(p_sesion text, p_roles text[]) returns tumbo.usuarios
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

create function tumbo_privado.abrir_sesion(p_usuario uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from tumbo.sesiones where expira < now();
  insert into tumbo.sesiones (token_hash, usuario_id, expira)
  values (tumbo_privado.hash_token(v_token), p_usuario, now() + interval '7 days');
  return v_token;
end $$;

create function tumbo_privado.perfil_json(u tumbo.usuarios) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'nombre', u.nombre, 'rol', u.rol,
                            'sellerId', u.seller_id, 'mfa', u.mfa)
$$;

-- ---------------------------------------------------------------------------
-- Ayudantes de negocio
-- ---------------------------------------------------------------------------
-- El actor se registra con su rol: un comprador que se llame como alguien del
-- equipo no puede hacerse pasar por él en la auditoría.
create function tumbo_privado.auditar(p_yo tumbo.usuarios, p_accion text, p_detalle text) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.auditoria (actor_id, actor, accion, detalle)
  values (p_yo.id, case when p_yo.id is null then 'Sistema' else p_yo.nombre || ' (' || p_yo.rol || ')' end,
          p_accion, coalesce(p_detalle, ''));
$$;

-- Un aviso a un comercio es, por omisión, solo para su seller principal
-- (dinero, reclamos, KYC); quien quiera más audiencia la indica en p_roles.
create function tumbo_privado.notificar(p_para text, p_texto text, p_icono text, p_enlace text, p_roles text[] default null) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.notificaciones (para, texto, icono, enlace, roles)
  values (p_para, p_texto, coalesce(p_icono, 'info'), p_enlace,
          coalesce(p_roles, case when p_para like 'seller:%' then array['seller'] end));
$$;

create function tumbo_privado.evento(p_pedido text, p_actor text, p_texto text, p_icono text) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.pedido_eventos (pedido_id, actor, texto, icono) values (p_pedido, p_actor, p_texto, coalesce(p_icono, 'info'));
$$;

create function tumbo_privado.fmt_usd(p numeric) returns text
language sql immutable set search_path = '' as $$
  select '$' || to_char(coalesce(p, 0), 'FM999,999,990.00')
$$;

-- Aviso «algo cambió» por Supabase Realtime (canal público `tumbo`, sin
-- datos): las pantallas abiertas recargan lo suyo con su propia sesión. Si
-- Realtime no está disponible, no pasa nada: nunca deshace la operación.
create function tumbo_privado.senal() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, $4)'
      using jsonb_build_object('en', extract(epoch from clock_timestamp())), 'cambio', 'tumbo', false;
  end if;
exception when others then
  null;
end $$;

-- Bloquea un pedido que el usuario puede tocar; si no le pertenece, responde
-- como si no existiera (no se filtra información de terceros).
create function tumbo_privado.bloquear_pedido(p_id text, p_yo tumbo.usuarios) returns tumbo.pedidos
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
begin
  select * into v from tumbo.pedidos where id = p_id for update;
  if not found
     or (p_yo.rol = 'comprador' and v.comprador_id <> p_yo.id)
     or (p_yo.rol in ('seller', 'precios', 'operador') and v.seller_id is distinct from p_yo.seller_id) then
    raise exception 'Pedido % no encontrado.', p_id;
  end if;
  return v;
end $$;

create function tumbo_privado.bloquear_producto(p_sku text, p_yo tumbo.usuarios) returns tumbo.productos
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.productos;
begin
  select * into v from tumbo.productos where sku = p_sku for update;
  if not found or (p_yo.rol in ('seller', 'precios', 'operador') and v.seller_id is distinct from p_yo.seller_id) then
    raise exception 'Producto % no encontrado.', p_sku;
  end if;
  return v;
end $$;

create function tumbo_privado.bruto_pedido(p_id text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(precio_usd * cant), 0) from tumbo.pedido_items where pedido_id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Cuenta
-- ---------------------------------------------------------------------------

-- Acceso. Los fallos se devuelven como {error} (no como excepción) para que
-- el intento quede registrado y cuente para el freno de fuerza bruta.
create function public.tm_acceder(p_email text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 120);
  v_ip text := tumbo_privado.ip_cliente();
  u tumbo.usuarios;
  v_ok boolean := false;
  v_token text;
begin
  delete from tumbo.intentos_acceso where fecha < now() - interval '1 day';
  -- Freno por correo y conexión: quien falla desde su IP no bloquea al dueño
  -- de la cuenta en la suya. Más un tope por conexión para cualquier correo
  -- y un techo por cuenta.
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 8
     or (v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
         where tipo = 'acceso' and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 40)
     -- techo por cuenta para quien rote direcciones: muy por encima del uso normal
     or (select count(*) from tumbo.intentos_acceso
         where tipo = 'acceso' and email = v_email and not exito and fecha > now() - interval '15 minutes') >= 100 then
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
  perform tumbo_privado.auditar(u, 'Inicio de sesión', u.rol);
  return jsonb_build_object('sesion', v_token, 'usuario', tumbo_privado.perfil_json(u));
end $$;

-- Registro de comprador desde la web: la cuenta queda activa al instante.
-- Los rechazos se devuelven como {error} para que el intento quede contado:
-- el freno por conexión limita tanto las altas en masa como el sondeo de
-- qué correos tienen cuenta.
create function public.tm_registrar(p_email text, p_clave text, p_nombre text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 200);
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_ip text := tumbo_privado.ip_cliente();
  v_error text;
  u tumbo.usuarios;
begin
  delete from tumbo.intentos_acceso where fecha < now() - interval '1 day';
  if (v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
      where tipo = 'registro' and ip = v_ip and fecha > now() - interval '10 minutes') >= 10)
     or (select count(*) from tumbo.intentos_acceso
         where tipo = 'registro' and exito and fecha > now() - interval '10 minutes') >= 200 then
    return jsonb_build_object('error', 'Hay demasiados registros desde tu conexión. Inténtalo en unos minutos.');
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

  insert into tumbo.intentos_acceso (tipo, email, ip, exito) values ('registro', left(v_email, 120), v_ip, v_error is null);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;

  insert into tumbo.usuarios (email, clave_hash, nombre, rol)
  values (v_email, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), v_nombre, 'comprador')
  returning * into u;
  perform tumbo_privado.auditar(u, 'Registro de comprador', 'cuenta nueva');
  return jsonb_build_object('sesion', tumbo_privado.abrir_sesion(u.id), 'usuario', tumbo_privado.perfil_json(u));
end $$;

create function public.tm_sesion(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
begin
  return case when u.id is null then null else tumbo_privado.perfil_json(u) end;
end $$;

create function public.tm_salir(p_sesion text) returns void
language sql security definer set search_path = '' as $$
  delete from tumbo.sesiones where token_hash = tumbo_privado.hash_token(coalesce(p_sesion, ''));
$$;

create function public.tm_marcar_notificaciones_leidas(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
begin
  insert into tumbo.notificaciones_leidas (notificacion_id, usuario_id)
  select n.id, yo.id from tumbo.notificaciones n
  where (n.para = 'usr:' || yo.id::text
         or n.para = 'rol:' || yo.rol
         or (yo.seller_id is not null and n.para = 'seller:' || yo.seller_id))
    and (n.roles is null or yo.rol = any (n.roles))
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Lectura: todo lo que el rol puede ver, en un solo documento.
--   visitante  · catálogo publicado de sellers aprobados
--   comprador  · + sus direcciones, carrito, pedidos, reclamos y avisos
--   seller     · su comercio completo (productos, pedidos, reclamos, finanzas, KYC)
--   precios    · productos de su comercio
--   operador   · productos y pedidos de su comercio
--   superadmin · todo · ops: pedidos y disputas · finanzas: pedidos,
--                liquidaciones, KYC fiscal y auditoría
-- ---------------------------------------------------------------------------
create function public.tm_cargar(p_sesion text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_uid uuid := u.id;
  v_rol text := u.rol;
  v_seller text := u.seller_id;
  v_admin boolean := coalesce(u.rol in ('superadmin', 'ops', 'finanzas'), false);
  r jsonb;
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
      select jsonb_agg(to_jsonb(p) order by p.creado desc, p.sku) from tumbo.productos p
      where (p.estado = 'publicado'
             and exists (select 1 from tumbo.sellers s where s.id = p.seller_id and s.estado = 'aprobado'))
         or p.seller_id = v_seller
         or v_rol = 'superadmin'), '[]'::jsonb)
  );
  if v_uid is null then
    return r;
  end if;

  r := r || jsonb_build_object(
    -- Los 300 más recientes. El comercio solo ve pedidos con el pago ya
    -- conciliado, y el operador, sin los datos de dinero ni de reclamos.
    'pedidos', coalesce((
      select jsonb_agg((case when v_rol = 'operador'
                             then to_jsonb(p) - 'comprador_id' - 'liquidacion' - 'liquidacion_id' - 'disputa_id'
                             else to_jsonb(p) - 'comprador_id' end) || jsonb_build_object(
               'mio', p.comprador_id = v_uid,
               'pedido_items', coalesce((select jsonb_agg(to_jsonb(i) - 'pedido_id' order by i.sku)
                                         from tumbo.pedido_items i where i.pedido_id = p.id), '[]'::jsonb),
               'pedido_eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'pedido_id' order by e.fecha, e.id)
                                           from tumbo.pedido_eventos e where e.pedido_id = p.id), '[]'::jsonb))
             order by p.creado desc)
      from (select * from tumbo.pedidos p
            where p.comprador_id = v_uid
               or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
                   and p.estado <> 'pago_por_verificar'
                   and not (p.estado = 'cancelado' and p.sla_horas is null))
               or v_admin
            order by p.creado desc limit 300) p), '[]'::jsonb),
    'disputas', coalesce((
      select jsonb_agg((to_jsonb(d) - 'comprador_id') || jsonb_build_object('mio', d.comprador_id = v_uid) order by d.creado desc)
      from (select * from tumbo.disputas d
            where d.comprador_id = v_uid
               or (d.seller_id = v_seller and v_rol = 'seller')
               or v_rol in ('superadmin', 'ops')
            order by d.creado desc limit 300) d), '[]'::jsonb),
    'liquidaciones', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.fecha desc, l.id desc) from tumbo.liquidaciones l
      where (l.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'finanzas')), '[]'::jsonb),
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
      from (select * from tumbo.auditoria order by fecha desc, id desc limit 500) a), '[]'::jsonb)
      else '[]'::jsonb end,
    'direcciones', coalesce((
      select jsonb_agg(to_jsonb(d) - 'usuario_id' order by d.creado) from tumbo.direcciones d
      where d.usuario_id = v_uid), '[]'::jsonb),
    'carrito', coalesce((
      select jsonb_agg(jsonb_build_object('sku', c.sku, 'cant', c.cant) order by c.agregado) from tumbo.carrito_items c
      where c.usuario_id = v_uid), '[]'::jsonb)
  );
  return r;
end $$;
