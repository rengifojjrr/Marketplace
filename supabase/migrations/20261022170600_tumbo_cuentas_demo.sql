-- =========================================================================
-- Tumbo Market — Cuentas demo compartidas y colas de trabajo
-- -------------------------------------------------------------------------
-- Las siete cuentas demo tienen contraseña pública: cualquier visitante las
-- usa a la vez. Un tope por cuenta se vuelve una forma de dejar sin servicio
-- a los demás, y un tope por red se esquiva rotando direcciones. Aquí se
-- equilibra:
--   · IPv6 se agrupa por /56 (lo que un proveedor entrega a un hogar) y las
--     IPv4 escritas como IPv6 cuentan como la IPv4;
--   · la cuota de escrituras es por (cuenta, red) con un techo por cuenta
--     que acota lo que se puede escribir en la base compartida;
--   · sesiones: 50 por (cuenta, red) y 200 por cuenta, desalojando las que
--     llevan más tiempo sin usarse (el uso se anota cada minuto);
--   · el techo de fallos por cuenta no aplica a las cuentas demo (su
--     contraseña es pública: no hay nada que proteger y solo serviría para
--     bloquearlas);
--   · en las cuentas demo, los topes de pedidos (5 por verificar, 10 por
--     hora) cuentan por red, con un respaldo por cuenta;
--   · la referencia de pago solo admite caracteres de una referencia real y
--     se compara por su número (sin ceros a la izquierda) y método;
--   · el vencimiento deja un solo asiento de auditoría por tanda y no se
--     intenta en una transacción de solo lectura;
--   · tm_cargar recorta lo pendiente por cola (500 por cola, de más antiguo a
--     más nuevo) y dice qué colas quedaron incompletas;
--   · tm_auditoria busca por tramos de ids (acotado) y devuelve el cursor
--     para seguir.
-- Solo agrega: no borra ni reescribe datos ni objetos existentes.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
-- Red desde la que se creó el pedido (topes por red en las cuentas demo).
alter table tumbo.pedidos add column red text;
create index pedidos_comprador_red_idx on tumbo.pedidos (comprador_id, red, creado);

-- Número del pago: dígitos sin ceros a la izquierda. «PM-0123456»,
-- «0123456» y «123456» son el mismo pago (con el mismo método).
alter table tumbo.pedidos add column ref_numero text
  generated always as (ltrim(regexp_replace(ref, '[^0-9]', '', 'g'), '0')) stored;
create index pedidos_ref_numero_idx on tumbo.pedidos (metodo, ref_numero);

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
create function tumbo_privado.cuenta_demo(p_email text) returns boolean
language sql immutable set search_path = '' as $$
  select p_email = any (array['comprador@demo.ve', 'propietario@sel-014.demo', 'precios@sel-014.demo',
                              'operador@sel-014.demo', 'superadmin@tumbomarket.demo',
                              'operaciones@tumbomarket.demo', 'finanzas@tumbomarket.demo'])
$$;

-- IPv6 por /56; IPv4 escrita como IPv6 (::ffff:a.b.c.d o ::a.b.c.d) como la IPv4.
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
  if family(d) = 6 and d << '::/96'::inet and d - '::'::inet > 1 then
    return host('0.0.0.0'::inet + (d - '::'::inet));
  end if;
  if family(d) = 6 then
    return host(network(set_masklen(d, 56))) || '/56';
  end if;
  return host(d);
exception when others then
  return 'desconocida';
end $$;

-- El uso de la sesión se anota cada minuto: el desalojo por antigüedad de
-- uso respeta a quien está usando la beta.
create or replace function tumbo_privado.usuario(p_sesion text) returns tumbo.usuarios
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
  if s.ultimo_uso < now() - interval '1 minute' and current_setting('transaction_read_only') = 'off' then
    update tumbo.sesiones
    set ultimo_uso = now(), expira = least(creada + interval '30 days', greatest(expira, now() + interval '7 days'))
    where token_hash = s.token_hash;
  end if;
  return u;
end $$;

-- Cuota de escrituras: 150 por (cuenta, red) y, de respaldo, 600 por cuenta
-- cada 10 minutos (acota lo que se escribe en la base compartida aunque se
-- roten redes).
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
  if (select sum(n) from tumbo.cuotas_red where usuario_id = u.id and ventana = v_ventana) > 600 then
    raise exception 'Esta cuenta tiene mucha actividad en este momento: espera unos minutos.';
  end if;
  return u;
end $$;

create or replace function tumbo_privado.abrir_sesion(p_usuario uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_red text := tumbo_privado.ip_cliente();
begin
  delete from tumbo.sesiones where expira < now();
  delete from tumbo.sesiones where token_hash in (
    select token_hash from tumbo.sesiones where usuario_id = p_usuario and red = v_red
    order by ultimo_uso desc, creada desc offset 49);
  delete from tumbo.sesiones where token_hash in (
    select token_hash from tumbo.sesiones where usuario_id = p_usuario
    order by ultimo_uso desc, creada desc offset 199);
  delete from tumbo.cuotas_red where ventana < now() - interval '1 day';
  insert into tumbo.sesiones (token_hash, usuario_id, expira, red)
  values (tumbo_privado.hash_token(v_token), p_usuario, now() + interval '7 days', v_red);
  return v_token;
end $$;

-- Vencimiento: un solo asiento de auditoría por tanda (la auditoría no se
-- llena de «Pedido vencido»).
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
    v_hechos := v_hechos || v.id;
  end loop;
  if cardinality(v_hechos) > 0 then
    perform tumbo_privado.auditar(null, 'Pedidos vencidos',
      cardinality(v_hechos) || ': ' || array_to_string(v_hechos[1:10], ', ') || case when cardinality(v_hechos) > 10 then '…' else '' end);
  end if;
end $$;

-- En una transacción de solo lectura (GET) no se vence nada.
create or replace function tumbo_privado.vencer_pagos() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids text[];
begin
  if current_setting('transaction_read_only') = 'on' then
    return;
  end if;
  v_ids := tumbo_privado.pagos_vencidos();
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

-- Cola de trabajo de un pedido pendiente.
create function tumbo_privado.cola(p_estado text, p_liquidacion text) returns text
language sql immutable set search_path = '' as $$
  select case when p_estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
              then p_estado else 'fondos_' || p_liquidacion end
$$;

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
-- Cambios respecto de la migración 6: lo pendiente se recorta por cola (500
-- por cola, de más antiguo a más nuevo) y `colas_recortadas` dice cuáles
-- quedaron incompletas, para que cada vista avise de lo suyo.
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
            order by q.creado desc, q.id desc limit 150) h)), '[]'::jsonb),
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

-- Historial de auditoría por tramos de 20.000 ids (la búsqueda nunca recorre
-- la tabla entera): devuelve hasta 200 eventos del tramo y `siguiente`, el
-- id desde el que continuar (null cuando ya no queda nada más antiguo).
create or replace function public.tm_auditoria(p_sesion text, p_antes bigint default null, p_texto text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  v_texto text := nullif(left(trim(coalesce(p_texto, '')), 100), '');
  v_patron text;
  v_techo bigint;
  v_piso bigint;
  v_eventos jsonb;
begin
  if v_texto is not null then
    v_patron := '%' || replace(replace(replace(v_texto, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  v_techo := coalesce(p_antes, (select max(id) + 1 from tumbo.auditoria), 0);
  v_piso := greatest(v_techo - 20000, 0);
  select coalesce(jsonb_agg(to_jsonb(a) - 'actor_id' order by a.id desc), '[]'::jsonb) into v_eventos
  from (select * from tumbo.auditoria a
        where a.id < v_techo and a.id >= v_piso
          and (v_patron is null or (a.actor || ' ' || a.accion || ' ' || a.detalle) ilike v_patron)
        order by a.id desc limit 200) a;
  return jsonb_build_object(
    'eventos', v_eventos,
    'siguiente', case
      when jsonb_array_length(v_eventos) = 200 then (v_eventos -> 199 ->> 'id')::bigint
      when v_piso > coalesce((select min(id) from tumbo.auditoria), 0) then v_piso
      else null end);
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
  -- su número.
  v_numero := ltrim(regexp_replace(v_ref, '[^0-9]', '', 'g'), '0');
  if char_length(v_ref) < 5 or char_length(v_ref) > 30 or v_ref !~ '^[A-Z0-9 ./_-]+$' or char_length(v_numero) < 4 then
    raise exception 'Registra la referencia del pago: entre 5 y 30 caracteres, con al menos 4 dígitos.';
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

  -- Dos compras con el mismo pago, una tras otra.
  perform pg_advisory_xact_lock(hashtextextended('tumbo:ref:' || p_metodo || ':' || v_numero, 0));

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
             where metodo = p_metodo and ref_numero = v_numero and (estado <> 'cancelado' or sla_horas is not null)) then
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
-- Privilegios por firma exacta (las funciones nuevas ya existían por firma).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

notify pgrst, 'reload schema';
