-- =========================================================================
-- Tumbo Market — Topes de las cuentas demo sin bloqueos cruzados
-- -------------------------------------------------------------------------
-- Cierra lo que la revisión de la migración 7 encontró:
--   · cuota de escrituras: en las cuentas demo el respaldo por cuenta pasa
--     de 600 a 3.000 cada 10 minutos (con 600, cuatro redes bastaban para
--     dejar sin escrituras a todos los visitantes de la cuenta);
--   · sesiones: con la cuenta llena se desaloja en la red que más sesiones
--     tiene (quien acapara la cuenta se desaloja a sí mismo), no a los demás;
--   · acceso: tope de 30 comprobaciones de contraseña por minuto por red,
--     antes del techo global (una sola red ya no lo agota);
--   · lectura: los 50 pedidos más recientes del comprador llegan siempre,
--     aunque su cola esté recortada (en la cuenta demo compartida, el pedido
--     recién creado no podía quedar fuera);
--   · referencia de pago: un pago se identifica por su número con cualquier
--     método, y cada regla tiene su propio mensaje;
--   · vencimientos: el asiento de la tanda lista hasta 50 pedidos con su
--     referencia;
--   · las redes IPv6 recordadas como /64 se recuerdan también como /56.
-- Solo agrega: no borra ni reescribe datos ni objetos existentes.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Estructura y datos
-- ---------------------------------------------------------------------------
-- Un pago, un pedido: se busca por número, sin importar el método.
create index pedidos_ref_numero_solo_idx on tumbo.pedidos (ref_numero);

-- La migración 7 agrupa IPv6 por /56: las redes que la dueña ya usó siguen
-- contando como conocidas.
insert into tumbo.redes_conocidas (email, red, ultimo)
select r.email, host(network(set_masklen(split_part(r.red, '/', 1)::inet, 56))) || '/56', max(r.ultimo)
from tumbo.redes_conocidas r
where r.red like '%/64' and split_part(r.red, '/', 1) ~ '^[0-9A-Fa-f:]+$'
group by 1, 2
on conflict (email, red) do nothing;

-- ---------------------------------------------------------------------------
-- Cuotas y sesiones
-- ---------------------------------------------------------------------------
-- Escrituras: 150 por (cuenta, red) cada 10 minutos y, de respaldo, 600 por
-- cuenta (3.000 en las cuentas demo, que comparten todos los visitantes).
create or replace function tumbo_privado.exigir(p_sesion text, p_roles text[]) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_ventana timestamptz := date_bin('10 minutes', now(), timestamptz '2000-01-01');
  v_n integer;
begin
  if u.id is null then
    raise exception 'Tu sesión expiró: vuelve a iniciar sesión.' using errcode = '28000';
  end if;
  if not (u.rol = any (p_roles)) then
    raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
  end if;
  insert into tumbo.cuotas_red as c (usuario_id, red, ventana, n)
  values (u.id, tumbo_privado.ip_cliente(), v_ventana, 1)
  on conflict (usuario_id, red, ventana) do update set n = c.n + 1
  returning n into v_n;
  if v_n > 150 then
    raise exception 'Vas muy rápido: espera unos minutos antes de seguir.';
  end if;
  if (select sum(n) from tumbo.cuotas_red where usuario_id = u.id and ventana = v_ventana)
     > (case when tumbo_privado.cuenta_demo(u.email) then 3000 else 600 end) then
    raise exception 'Esta cuenta tiene mucha actividad en este momento: espera unos minutos.';
  end if;
  return u;
end $$;

-- Sesiones: 50 por (cuenta, red) y 200 por cuenta. Con la cuenta llena se
-- cierran las de uso más antiguo de la red que más sesiones tiene.
create or replace function tumbo_privado.abrir_sesion(p_usuario uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_red text := tumbo_privado.ip_cliente();
  v_sobran integer;
begin
  delete from tumbo.sesiones where expira < now();
  delete from tumbo.sesiones where token_hash in (
    select token_hash from tumbo.sesiones where usuario_id = p_usuario and red = v_red
    order by ultimo_uso desc, creada desc offset 49);
  select count(*) - 199 into v_sobran from tumbo.sesiones where usuario_id = p_usuario;
  if v_sobran > 0 then
    delete from tumbo.sesiones where token_hash in (
      select s.token_hash from tumbo.sesiones s
      where s.usuario_id = p_usuario
        and s.red = (select x.red from tumbo.sesiones x where x.usuario_id = p_usuario
                     group by x.red order by count(*) desc, max(x.ultimo_uso), x.red limit 1)
      order by s.ultimo_uso, s.creada
      limit v_sobran);
  end if;
  delete from tumbo.cuotas_red where ventana < now() - interval '1 day';
  insert into tumbo.sesiones (token_hash, usuario_id, expira, red)
  values (tumbo_privado.hash_token(v_token), p_usuario, now() + interval '7 days', v_red);
  return v_token;
end $$;

-- Vencimiento: un asiento por tanda con hasta 50 pedidos y su referencia.
create or replace function tumbo_privado.vencer_pedidos(p_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  v_hechos text[] := '{}';
begin
  for v in select * from tumbo.pedidos where id = any (p_ids) and estado = 'pago_por_verificar' order by id loop
    update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = v.id;
    update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
    perform tumbo_privado.evento(v.id, 'Sistema', 'Pago sin verificar en 48 horas · pedido vencido y stock liberado', 'schedule');
    perform tumbo_privado.notificar('usr:' || v.comprador_id,
      'Tu pedido ' || v.id || ' venció: no pudimos verificar el pago a tiempo', 'schedule', 'tienda/pedido.html?id=' || v.id);
    v_hechos := v_hechos || (v.id || ' (' || v.metodo || ' ' || v.ref || ')');
  end loop;
  if cardinality(v_hechos) > 0 then
    perform tumbo_privado.auditar(null, 'Pedidos vencidos',
      cardinality(v_hechos) || ': ' || array_to_string(v_hechos[1:50], ', ') || case when cardinality(v_hechos) > 50 then '…' else '' end);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Acceso
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

  -- Comprobaciones de contraseña por red y minuto: una sola red no agota el
  -- techo global.
  if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and ip = v_ip and fecha > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('error', 'Demasiados intentos de acceso desde tu conexión. Espera un minuto.');
  end if;
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
     -- desde la que entró o se registró esta semana, ni existe en las cuentas
     -- demo (su contraseña es pública: solo serviría para bloquearlas)
     or (not tumbo_privado.cuenta_demo(v_email)
         and (select count(*) from tumbo.intentos_acceso
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

-- ---------------------------------------------------------------------------
-- Lectura
-- ---------------------------------------------------------------------------
-- Cambio respecto de la migración 7: además de lo pendiente por cola y del
-- historial reciente, llegan siempre los 50 pedidos más recientes del propio
-- comprador.
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
  v_recortadas jsonb;
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
    select coalesce(jsonb_agg(x.cola order by x.cola), '[]'::jsonb) into v_recortadas
    from (select tumbo_privado.cola(p.estado, p.liquidacion) as cola from tumbo.pedidos p
          where (p.comprador_id = v_uid
                 or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
                     and p.estado <> 'pago_por_verificar'
                     and not (p.estado = 'cancelado' and p.sla_horas is null))
                 or v_admin)
            and (p.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                 or p.liquidacion in ('retenido', 'congelado', 'elegible'))
          group by 1 having count(*) > 500) x;
    select count(*) into v_abiertas from tumbo.disputas d
    where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
      and d.estado <> 'resuelta';
    if v_abiertas > 2000 then
      v_recortadas := v_recortadas || '["disputas"]'::jsonb;
    end if;

    r := r || jsonb_build_object(
      'pendientes_truncados', jsonb_array_length(v_recortadas) > 0,
      'colas_recortadas', v_recortadas,
      -- El comercio solo ve pedidos con el pago ya conciliado, y el operador,
      -- sin los datos de dinero ni de reclamos.
      'pedidos', coalesce((
        select jsonb_agg((case when v_rol = 'operador'
                               then to_jsonb(p) - 'comprador_id' - 'liquidacion' - 'liquidacion_id' - 'disputa_id'
                               else to_jsonb(p) - 'comprador_id' end) - 'ref_clave' - 'ref_numero' - 'red' || jsonb_build_object(
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
        from tumbo.pedidos p
        where p.id in (
          select w.id from (
            select q.id, row_number() over (partition by tumbo_privado.cola(q.estado, q.liquidacion) order by q.creado, q.id) as n
            from tumbo.pedidos q
            where (q.comprador_id = v_uid
                   or (q.seller_id = v_seller and v_rol in ('seller', 'operador')
                       and q.estado <> 'pago_por_verificar'
                       and not (q.estado = 'cancelado' and q.sla_horas is null))
                   or v_admin)
              and (q.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                   or q.liquidacion in ('retenido', 'congelado', 'elegible'))) w
          where w.n <= 500
          union all
          select h.id from (
            select q.id from tumbo.pedidos q
            where (q.comprador_id = v_uid
                   or (q.seller_id = v_seller and v_rol in ('seller', 'operador')
                       and q.estado <> 'pago_por_verificar'
                       and not (q.estado = 'cancelado' and q.sla_horas is null))
                   or v_admin)
              and not (q.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                       or coalesce(q.liquidacion in ('retenido', 'congelado', 'elegible'), false))
            order by q.creado desc, q.id desc limit 150) h
          union all
          -- lo más reciente del propio comprador, aunque su cola esté recortada
          select m.id from (
            select q.id from tumbo.pedidos q
            where q.comprador_id = v_uid
            order by q.creado desc, q.id desc limit 50) m)), '[]'::jsonb),
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

-- ---------------------------------------------------------------------------
-- Pedido
-- ---------------------------------------------------------------------------
create or replace function public.tm_crear_pedido(p_sesion text, p_envio_tipo text, p_direccion_id uuid, p_metodo text, p_ref text,
                                                  p_total_usd numeric default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  cfg tumbo.config;
  v_ref text := upper(trim(coalesce(p_ref, '')));
  v_numero text;
  v_red text := tumbo_privado.ip_cliente();
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
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
  -- Solo los caracteres de una referencia bancaria; el pago se identifica por
  -- su número (las mismas reglas y mensajes que el checkout).
  v_numero := ltrim(regexp_replace(v_ref, '[^0-9]', '', 'g'), '0');
  if char_length(v_ref) < 5 or char_length(v_ref) > 30 then
    raise exception 'La referencia del pago debe tener entre 5 y 30 caracteres.';
  end if;
  if v_ref !~ '^[A-Z0-9 ./_-]+$' then
    raise exception 'La referencia solo admite letras sin tilde, números, espacios y . / _ -';
  end if;
  if char_length(v_numero) < 4 then
    raise exception 'La referencia debe tener al menos 4 dígitos, sin contar los ceros iniciales.';
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

  -- Dos compras con el mismo pago, una tras otra (con cualquier método).
  perform pg_advisory_xact_lock(hashtextextended('tumbo:ref:' || v_numero, 0));

  -- Pedidos vencidos y productos (del carrito y de esos pedidos) en una sola
  -- pasada ordenada por SKU: el stock se valida y se reserva atómicamente.
  v_vencidos := tumbo_privado.pagos_vencidos();
  perform 1 from tumbo.productos p
  where p.sku in (select c.sku from tumbo.carrito_items c where c.usuario_id = yo.id
                  union select i.sku from tumbo.pedido_items i where i.pedido_id = any (v_vencidos))
  order by p.sku for update;
  perform tumbo_privado.vencer_pedidos(v_vencidos);

  -- Un pago corresponde a un solo pedido (los de un mismo checkout comparten
  -- referencia); solo queda libre el de un pedido cancelado que nunca se
  -- concilió.
  if exists (select 1 from tumbo.pedidos
             where ref_numero = v_numero and (estado <> 'cancelado' or sla_horas is not null)) then
    raise exception 'La referencia % ya está registrada en otro pedido: revisa el número del pago.', v_ref;
  end if;
  -- En las cuentas demo (compartidas) los topes cuentan por red, con un
  -- respaldo por cuenta; en las demás, por cuenta.
  if (select count(*) from tumbo.pedidos
      where comprador_id = yo.id and estado = 'pago_por_verificar' and (not v_demo or red = v_red)) >= 5 then
    raise exception 'Tienes 5 pedidos con el pago por verificar: espera la conciliación o cancela alguno.';
  end if;
  if (select count(*) from tumbo.pedidos
      where comprador_id = yo.id and creado > now() - interval '1 hour' and (not v_demo or red = v_red)) >= 10 then
    raise exception 'Has creado muchos pedidos en la última hora: inténtalo más tarde.';
  end if;
  if v_demo and (select count(*) from tumbo.pedidos
                 where comprador_id = yo.id and creado > now() - interval '1 hour') >= 100 then
    raise exception 'La cuenta demo tiene muchos pedidos en la última hora: inténtalo más tarde o regístrate con tu correo.';
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
                               costo_envio_usd, tasa, metodo, ref, pago_vence, red)
    values (v_id, yo.id, v_seller, 'pago_por_verificar', p_envio_tipo, v_dir, v_courier,
            v_costo, cfg.tasa, p_metodo, v_ref, now() + interval '48 hours', v_red);
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

-- ---------------------------------------------------------------------------
-- Privilegios (todas las funciones de aquí ya existían por firma).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

notify pgrst, 'reload schema';
