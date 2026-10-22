-- =========================================================================
-- Tumbo Market — Operaciones de negocio (API RPC)
-- -------------------------------------------------------------------------
-- Cada `public.tm_*` es la única puerta para cambiar un estado. Todas:
--   1. exigen el rol (privado.exigir) y la propiedad del recurso;
--   2. bloquean la fila (FOR UPDATE) y validan el estado de origen;
--   3. escriben el cambio, la línea de tiempo, las notificaciones y la
--      auditoría en la MISMA transacción: o pasa todo o no pasa nada.
-- Son SECURITY DEFINER con search_path vacío y nombres calificados.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Ayudantes internos
-- ---------------------------------------------------------------------------
create function privado.exigir(p_roles text[]) returns public.perfiles
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.perfiles;
begin
  select * into v from public.perfiles where id = (select auth.uid());
  if not found then
    raise exception 'Inicia sesión para continuar.' using errcode = '42501';
  end if;
  if not (v.rol = any (p_roles)) then
    raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
  end if;
  return v;
end $$;

create function privado.auditar(p_accion text, p_detalle text) returns void
language sql security definer set search_path = '' as $$
  insert into public.auditoria (actor_id, actor, accion, detalle)
  values ((select auth.uid()),
          coalesce((select nombre from public.perfiles where id = (select auth.uid())), 'Sistema'),
          p_accion, coalesce(p_detalle, ''));
$$;

create function privado.notificar(p_para text, p_texto text, p_icono text, p_enlace text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notificaciones (para, texto, icono, enlace) values (p_para, p_texto, coalesce(p_icono, 'info'), p_enlace);
$$;

create function privado.evento(p_pedido text, p_actor text, p_texto text, p_icono text) returns void
language sql security definer set search_path = '' as $$
  insert into public.pedido_eventos (pedido_id, actor, texto, icono) values (p_pedido, p_actor, p_texto, coalesce(p_icono, 'info'));
$$;

create function privado.fmt_usd(p numeric) returns text
language sql immutable set search_path = '' as $$
  select '$' || to_char(coalesce(p, 0), 'FM999,999,990.00')
$$;

-- Bloquea un pedido que el usuario puede tocar; si no le pertenece, responde
-- como si no existiera (no se filtra información de terceros).
create function privado.bloquear_pedido(p_id text, p_yo public.perfiles) returns public.pedidos
language plpgsql security definer set search_path = '' as $$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_id for update;
  if not found
     or (p_yo.rol = 'comprador' and v.comprador_id <> p_yo.id)
     or (p_yo.rol in ('seller', 'precios', 'operador') and v.seller_id is distinct from p_yo.seller_id) then
    raise exception 'Pedido % no encontrado.', p_id;
  end if;
  return v;
end $$;

create function privado.bloquear_producto(p_sku text, p_yo public.perfiles) returns public.productos
language plpgsql security definer set search_path = '' as $$
declare
  v public.productos;
begin
  select * into v from public.productos where sku = p_sku for update;
  if not found or (p_yo.rol in ('seller', 'precios', 'operador') and v.seller_id is distinct from p_yo.seller_id) then
    raise exception 'Producto % no encontrado.', p_sku;
  end if;
  return v;
end $$;

create function privado.bruto_pedido(p_id text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(precio_usd * cant), 0) from public.pedido_items where pedido_id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Cuenta
-- ---------------------------------------------------------------------------

-- Registro de comprador desde la web (la beta no envía correos de
-- confirmación: la cuenta queda activa al instante).
create function public.tm_registrar(p_email text, p_clave text, p_nombre text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_id uuid := gen_random_uuid();
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_email) > 120 then
    raise exception 'Escribe un correo válido.';
  end if;
  if char_length(coalesce(p_clave, '')) < 8 or char_length(p_clave) > 72 then
    raise exception 'La contraseña necesita entre 8 y 72 caracteres.';
  end if;
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then
    raise exception 'Escribe tu nombre (entre 2 y 80 caracteres).';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Ya existe una cuenta con ese correo: inicia sesión.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_clave, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('nombre', v_nombre), now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.auditoria (actor_id, actor, accion, detalle)
  values (v_id, v_nombre, 'Registro de comprador', v_email);
  return v_id;
end $$;

create function public.tm_registrar_acceso() returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
begin
  perform privado.auditar('Inicio de sesión', yo.rol);
end $$;

create function public.tm_marcar_notificaciones_leidas() returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
begin
  insert into public.notificaciones_leidas (notificacion_id, usuario_id)
  select n.id, yo.id from public.notificaciones n
  where n.para = 'usr:' || yo.id::text
     or n.para = 'rol:' || yo.rol
     or (yo.seller_id is not null and n.para = 'seller:' || yo.seller_id)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Carrito: el de invitado se fusiona al identificarse
-- ---------------------------------------------------------------------------
create function public.tm_fusionar_carrito(p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['comprador']);
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'Carrito inválido.';
  end if;
  insert into public.carrito_items as c (usuario_id, sku, cant)
  select yo.id, p.sku, least(99, greatest(1, sum((i ->> 'cant')::int)))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  join public.productos p on p.sku = i ->> 'sku' and p.estado = 'publicado'
  where (i ->> 'cant') ~ '^\d{1,2}$'
  group by p.sku
  on conflict (usuario_id, sku) do update set cant = least(99, c.cant + excluded.cant);
end $$;

-- ---------------------------------------------------------------------------
-- Flujo del pedido
-- ---------------------------------------------------------------------------
create function public.tm_crear_pedido(p_envio_tipo text, p_direccion_id uuid, p_metodo text, p_ref text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['comprador']);
  cfg public.config;
  v_ref text := upper(trim(coalesce(p_ref, '')));
  v_dir text;
  v_courier text;
  v_costo numeric;
  r record;
  v_seller text;
  v_id text;
  v_ids text[] := '{}';
begin
  select * into cfg from public.config;
  if p_metodo is null or p_metodo not in ('Pago Móvil', 'Transferencia') then
    raise exception 'Elige un método de pago válido.';
  end if;
  if char_length(v_ref) < 5 or char_length(v_ref) > 30 then
    raise exception 'Registra la referencia del pago (entre 5 y 30 caracteres).';
  end if;
  if p_envio_tipo = 'agencia' then
    v_dir := 'Agencia MRW La Candelaria, Caracas'; v_courier := 'MRW (demo)'; v_costo := 2.5;
  elsif p_envio_tipo = 'domicilio' then
    select d.linea || ', ' || d.municipio into v_dir
    from public.direcciones d where d.id = p_direccion_id and d.usuario_id = yo.id;
    if v_dir is null then raise exception 'Elige una dirección de entrega válida.'; end if;
    v_courier := 'Zoom (demo)'; v_costo := 4;
  else
    raise exception 'Elige cómo quieres recibir el pedido.';
  end if;

  -- Bloqueo de los productos del carrito en orden estable (sin interbloqueos
  -- entre compras simultáneas): el stock se valida y se reserva atómicamente.
  perform 1 from public.productos p
  where p.sku in (select c.sku from public.carrito_items c where c.usuario_id = yo.id)
  order by p.sku for update;

  if not exists (select 1 from public.carrito_items where usuario_id = yo.id) then
    raise exception 'El carrito está vacío.';
  end if;

  for r in
    select c.cant, p.nombre, p.estado, p.stock_fis - p.stock_res as disp, s.estado as seller_estado
    from public.carrito_items c
    join public.productos p on p.sku = c.sku
    join public.sellers s on s.id = p.seller_id
    where c.usuario_id = yo.id
  loop
    if r.estado <> 'publicado' or r.seller_estado <> 'aprobado' then
      raise exception '«%» ya no está disponible: quítalo del carrito.', r.nombre;
    end if;
    if r.cant > r.disp then
      raise exception '«%» solo tiene % disponibles.', r.nombre, greatest(r.disp, 0);
    end if;
  end loop;

  -- Un pedido por seller (regla del marketplace)
  for v_seller in
    select distinct p.seller_id from public.carrito_items c join public.productos p on p.sku = c.sku
    where c.usuario_id = yo.id order by 1
  loop
    v_id := 'TM-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || lpad(nextval('privado.seq_pedido')::text, 5, '0');
    insert into public.pedidos (id, comprador_id, seller_id, estado, envio_tipo, envio_dir, courier,
                                costo_envio_usd, tasa, metodo, ref)
    values (v_id, yo.id, v_seller, 'pago_por_verificar', p_envio_tipo, v_dir, v_courier,
            v_costo, cfg.tasa, p_metodo, v_ref);
    insert into public.pedido_items (pedido_id, sku, nombre, img, cant, precio_usd)
    select v_id, p.sku, p.nombre, p.img, c.cant, p.precio_usd
    from public.carrito_items c join public.productos p on p.sku = c.sku
    where c.usuario_id = yo.id and p.seller_id = v_seller;
    update public.productos p set stock_res = p.stock_res + c.cant, actualizado = now()
    from public.carrito_items c
    where c.usuario_id = yo.id and c.sku = p.sku and p.seller_id = v_seller;

    perform privado.evento(v_id, yo.nombre, 'Pedido creado y pago registrado (' || p_metodo || ' ref. ' || v_ref || ')', 'shopping_cart');
    perform privado.notificar('rol:finanzas', 'Pago ' || v_ref || ' pendiente de conciliar (' || v_id || ')', 'fact_check', 'admin/conciliacion.html');
    perform privado.auditar('Pedido creado', v_id || ' · ' || p_metodo || ' ' || v_ref);
    v_ids := v_ids || v_id;
  end loop;

  delete from public.carrito_items where usuario_id = yo.id;
  return v_ids;
end $$;

create function public.tm_conciliar_pago(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['superadmin', 'finanzas']);
  v public.pedidos := privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'pago_por_verificar' then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  update public.pedidos set estado = 'por_aceptar', sla_horas = 24 where id = p_id;
  perform privado.evento(p_id, 'Finanzas', 'Pago conciliado · pendiente de aceptación del seller', 'fact_check');
  perform privado.notificar('seller:' || v.seller_id, 'Nuevo pedido ' || p_id || ' pendiente de aceptar', 'shopping_cart', 'seller/pedidos.html');
  perform privado.notificar('usr:' || v.comprador_id, 'Confirmamos el pago de tu pedido ' || p_id, 'check_circle', 'tienda/pedido.html?id=' || p_id);
  perform privado.auditar('Conciliación de pago', v.ref || ' → ' || p_id);
end $$;

create function public.tm_aceptar_pedido(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['seller', 'operador']);
  v public.pedidos := privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'por_aceptar' then
    raise exception 'El pedido % no está por aceptar.', p_id;
  end if;
  update public.pedidos set estado = 'preparando' where id = p_id;
  perform privado.evento(p_id, v.seller_id, 'Pedido aceptado, preparación iniciada', 'inventory_2');
  perform privado.notificar('usr:' || v.comprador_id, 'El seller está preparando tu pedido ' || p_id, 'inventory_2', 'tienda/pedido.html?id=' || p_id);
  perform privado.auditar('Pedido aceptado', p_id);
end $$;

create function public.tm_marcar_listo(p_id text, p_peso numeric) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['seller', 'operador']);
  v public.pedidos := privado.bloquear_pedido(p_id, yo);
  v_guia text;
begin
  if v.estado <> 'preparando' then
    raise exception 'El pedido % no está en preparación.', p_id;
  end if;
  if p_peso is not null and (p_peso <= 0 or p_peso > 1000) then
    raise exception 'Indica un peso entre 0,1 y 1.000 kg.';
  end if;
  v_guia := 'TM-GUIA-' || nextval('privado.seq_guia');
  update public.pedidos set estado = 'listo', guia = v_guia, peso = p_peso where id = p_id;
  perform privado.evento(p_id, v.seller_id, 'Paquete listo · guía ' || v_guia || ' (demo)', 'package_2');
  perform privado.auditar('Guía generada (demo)', p_id || ' · ' || v_guia);
  return v_guia;
end $$;

create function public.tm_despachar(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['seller', 'operador']);
  v public.pedidos := privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'listo' then
    raise exception 'El pedido % no está listo para despachar.', p_id;
  end if;
  update public.pedidos set estado = 'despachado' where id = p_id;
  -- El stock sale del inventario al entregarse al courier.
  update public.productos p
  set stock_fis = greatest(0, p.stock_fis - i.cant),
      stock_res = greatest(0, p.stock_res - i.cant),
      actualizado = now()
  from public.pedido_items i
  where i.pedido_id = p_id and i.sku = p.sku;
  perform privado.evento(p_id, 'Courier', 'Paquete retirado por ' || v.courier || ' · en tránsito', 'local_shipping');
  perform privado.notificar('usr:' || v.comprador_id, 'Tu pedido ' || p_id || ' va en camino', 'local_shipping', 'tienda/pedido.html?id=' || p_id);
  perform privado.notificar('rol:ops', 'Pedido ' || p_id || ' despachado con ' || v.courier, 'local_shipping', 'admin/pedidos.html');
  perform privado.auditar('Despacho al courier (demo)', p_id);
end $$;

create function public.tm_confirmar_entrega(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['comprador']);
  v public.pedidos := privado.bloquear_pedido(p_id, yo);
  cfg public.config;
begin
  select * into cfg from public.config;
  if v.estado <> 'despachado' then
    raise exception 'El pedido % no está en camino.', p_id;
  end if;
  update public.pedidos set estado = 'entregado', entregado_el = now(), liquidacion = 'retenido' where id = p_id;
  perform privado.evento(p_id, yo.nombre,
    'Entrega confirmada · abre la ventana de reclamo (' || cfg.ventana_reclamo_dias || ' días)', 'check_circle');
  perform privado.notificar('seller:' || v.seller_id,
    'El pedido ' || p_id || ' fue entregado: fondos en retención hasta cerrar la ventana', 'lock', 'seller/finanzas.html');
  perform privado.auditar('Entrega confirmada', p_id);
end $$;

create function public.tm_cancelar_pedido(p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['comprador']);
  v public.pedidos := privado.bloquear_pedido(p_id, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 200);
begin
  if v.estado in ('despachado', 'entregado', 'cerrado', 'reembolsado', 'devolucion') then
    raise exception 'El pedido ya fue despachado: corresponde un reclamo, no una cancelación.';
  end if;
  if v.estado = 'cancelado' then
    raise exception 'El pedido % ya está cancelado.', p_id;
  end if;
  update public.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update public.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from public.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform privado.evento(p_id, yo.nombre,
    'Pedido cancelado (' || coalesce(v_motivo, 'sin motivo') || ') · stock liberado' ||
    case when v.estado = 'pago_por_verificar' then '' else ' y reembolso en cola' end, 'cancel');
  if v.estado <> 'pago_por_verificar' then
    perform privado.notificar('seller:' || v.seller_id, 'El comprador canceló el pedido ' || p_id, 'cancel', 'seller/pedidos.html?estado=');
  end if;
  perform privado.notificar('rol:finanzas', 'Cancelación de ' || p_id || ': procesar reembolso demo', 'undo', 'admin/conciliacion.html');
  perform privado.auditar('Cancelación', p_id || coalesce(' · ' || v_motivo, ''));
end $$;

-- ---------------------------------------------------------------------------
-- Disputas
-- ---------------------------------------------------------------------------
create function public.tm_abrir_disputa(p_pedido text, p_motivo text, p_descripcion text, p_evidencia text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['comprador']);
  v public.pedidos := privado.bloquear_pedido(p_pedido, yo);
  cfg public.config;
  v_id text;
  v_desc text := trim(coalesce(p_descripcion, ''));
  v_evid text[] := coalesce(p_evidencia, '{}');
begin
  select * into cfg from public.config;
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
  if coalesce(array_length(v_evid, 1), 0) > 10
     or exists (select 1 from unnest(v_evid) e where char_length(e) > 120) then
    raise exception 'Adjunta como máximo 10 archivos.';
  end if;

  v_id := 'DSP-' || lpad(nextval('privado.seq_disputa')::text, 4, '0');
  insert into public.disputas (id, pedido_id, comprador_id, seller_id, motivo, descripcion, evidencia, monto_usd, estado)
  values (v_id, v.id, v.comprador_id, v.seller_id, p_motivo, v_desc, v_evid, privado.bruto_pedido(v.id), 'abierta');
  update public.pedidos set disputa_id = v_id, liquidacion = 'congelado' where id = v.id;
  perform privado.evento(v.id, yo.nombre, 'Reclamo ' || v_id || ' abierto · liquidación congelada', 'gavel');
  perform privado.notificar('seller:' || v.seller_id, 'Reclamo ' || v_id || ' abierto sobre ' || v.id || ': responde con tu evidencia', 'gavel', 'seller/disputas.html');
  perform privado.notificar('rol:ops', 'Disputa ' || v_id || ' en cola: ' || p_motivo, 'gavel', 'admin/disputas.html');
  perform privado.auditar('Apertura de disputa', v_id || ' sobre ' || v.id);
  return v_id;
end $$;

create function public.tm_responder_disputa(p_id text, p_texto text, p_evidencia text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['seller']);
  d public.disputas;
  v_texto text := trim(coalesce(p_texto, ''));
begin
  select * into d from public.disputas where id = p_id for update;
  if not found or d.seller_id is distinct from yo.seller_id then
    raise exception 'Reclamo % no encontrado.', p_id;
  end if;
  if d.estado <> 'abierta' then
    raise exception 'El reclamo % ya fue respondido.', p_id;
  end if;
  if char_length(v_texto) < 10 or char_length(v_texto) > 2000 then
    raise exception 'Describe qué pasó con al menos 10 caracteres.';
  end if;
  update public.disputas
  set respuesta_texto = v_texto, respuesta_evidencia = coalesce(p_evidencia[1:10], '{}'), respuesta_fecha = now(), estado = 'respondida'
  where id = p_id;
  perform privado.notificar('rol:ops', 'El seller respondió la disputa ' || p_id, 'forum', 'admin/disputas.html');
  perform privado.auditar('Respuesta a disputa', p_id);
end $$;

create function public.tm_resolver_disputa(p_id text, p_decision text, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['superadmin', 'ops']);
  d public.disputas;
  v_nota text := left(trim(coalesce(p_nota, '')), 500);
begin
  select * into d from public.disputas where id = p_id for update;
  if not found then raise exception 'Disputa % no encontrada.', p_id; end if;
  if d.estado = 'resuelta' then raise exception 'La disputa % ya está resuelta.', p_id; end if;
  if p_decision is null or p_decision not in ('reembolso', 'devolucion', 'liberar') then
    raise exception 'Decisión inválida.';
  end if;
  perform 1 from public.pedidos where id = d.pedido_id for update;

  update public.disputas
  set estado = 'resuelta', resolucion_decision = p_decision, resolucion_nota = v_nota, resolucion_fecha = now()
  where id = p_id;

  if p_decision = 'reembolso' then
    update public.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = d.pedido_id;
    perform privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta a favor del comprador · reembolso total en modo demo', 'undo');
    perform privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue aprobado: reembolso en proceso (demo)', 'undo', 'tienda/pedido.html?id=' || d.pedido_id);
    perform privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con reembolso al comprador', 'gavel', 'seller/disputas.html');
  elsif p_decision = 'devolucion' then
    update public.pedidos set estado = 'devolucion' where id = d.pedido_id;
    perform privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta: devolución del producto con logística inversa (demo)', 'assignment_return');
    perform privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ': coordinaremos la devolución del producto', 'assignment_return', 'tienda/pedido.html?id=' || d.pedido_id);
    perform privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con devolución', 'assignment_return', 'seller/disputas.html');
  else
    update public.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = d.pedido_id;
    perform privado.evento(d.pedido_id, 'Operaciones', 'Disputa cerrada a favor del seller · fondos liberados', 'lock_open');
    perform privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue revisado y cerrado sin reembolso', 'gavel', 'tienda/pedido.html?id=' || d.pedido_id);
    perform privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  perform privado.auditar('Resolución de disputa', p_id || ' → ' || p_decision);
end $$;

-- ---------------------------------------------------------------------------
-- Finanzas
-- ---------------------------------------------------------------------------
create function public.tm_cerrar_ventana(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['superadmin', 'finanzas']);
  v public.pedidos := privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'entregado' or v.liquidacion is distinct from 'retenido' then
    raise exception 'El pedido % no tiene una ventana de reclamo abierta.', p_id;
  end if;
  update public.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = p_id;
  perform privado.evento(p_id, 'Sistema', 'Ventana de reclamo cerrada sin casos · fondos elegibles', 'lock_open');
  perform privado.auditar('Cierre de ventana de reclamo', p_id);
end $$;

create function public.tm_ejecutar_liquidacion(p_seller text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['superadmin', 'finanzas']);
  cfg public.config;
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
  select * into cfg from public.config;
  select array_agg(id order by id) into v_ids
  from (select id from public.pedidos where seller_id = p_seller and liquidacion = 'elegible' for update) e;
  if v_ids is null then
    raise exception 'No hay pedidos elegibles para este seller.';
  end if;

  select coalesce(sum(i.precio_usd * i.cant), 0) into v_bruto from public.pedido_items i where i.pedido_id = any (v_ids);
  v_comision := round(v_bruto * cfg.comision_pct / 100, 2);
  v_tarifa := round(cfg.tarifa_fija_usd * array_length(v_ids, 1), 2);
  v_neto := v_bruto - v_comision - v_tarifa;
  v_num := nextval('privado.seq_liquidacion');
  v_id := 'LIQ-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || lpad(v_num::text, 3, '0');
  v_cpr := 'CPR-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || lpad(v_num::text, 3, '0');

  insert into public.liquidaciones (id, seller_id, periodo, pedidos, bruto_usd, comision_usd, tarifa_usd, neto_usd, estado, fecha, comprobante)
  values (v_id, p_seller, 'hasta ' || v_hoy, v_ids, v_bruto, v_comision, v_tarifa, v_neto, 'pagada',
          (now() at time zone 'America/Caracas')::date, v_cpr);
  update public.pedidos set liquidacion = 'liquidado', liquidacion_id = v_id where id = any (v_ids);
  insert into public.pedido_eventos (pedido_id, actor, texto, icono)
  select unnest(v_ids), 'Finanzas', 'Incluido en la liquidación ' || v_id || ' (demo)', 'receipt_long';
  perform privado.notificar('seller:' || p_seller,
    'Liquidación ' || v_id || ' ejecutada: ' || privado.fmt_usd(v_neto) || ' · comprobante ' || v_cpr, 'receipt_long', 'seller/finanzas.html');
  perform privado.auditar('Liquidación ejecutada', v_id || ' → ' || p_seller || ' · ' || privado.fmt_usd(v_neto));
  return jsonb_build_object('id', v_id, 'netoUsd', v_neto, 'comprobante', v_cpr);
end $$;

-- ---------------------------------------------------------------------------
-- Catálogo (Seller Center)
-- ---------------------------------------------------------------------------
create function public.tm_guardar_producto(p_datos jsonb, p_enviar boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['seller', 'operador']);
  v public.productos;
  v_sku text := nullif(trim(coalesce(p_datos ->> 'sku', '')), '');
  v_nombre text := trim(coalesce(p_datos ->> 'nombre', ''));
  v_categoria text := p_datos ->> 'categoria';
  v_precio numeric;
  v_stock integer;
  v_estado text;
begin
  if p_datos ? 'precioUsd' then
    if (p_datos ->> 'precioUsd') !~ '^\d{1,7}(\.\d{1,2})?$' then raise exception 'El precio debe ser mayor que cero.'; end if;
    v_precio := (p_datos ->> 'precioUsd')::numeric;
    if v_precio <= 0 then raise exception 'El precio debe ser mayor que cero.'; end if;
  end if;
  if p_datos ? 'stockFis' then
    if (p_datos ->> 'stockFis') !~ '^\d{1,6}$' then raise exception 'El stock debe ser un número entero.'; end if;
    v_stock := (p_datos ->> 'stockFis')::integer;
  end if;
  if p_datos ? 'nombre' and char_length(v_nombre) not between 4 and 160 then
    raise exception 'El nombre necesita al menos 4 caracteres.';
  end if;
  if v_categoria is not null and not exists (select 1 from public.categorias where id = v_categoria) then
    raise exception 'Categoría inválida.';
  end if;

  if v_sku is null then
    -- Alta
    if char_length(v_nombre) < 4 then raise exception 'El nombre necesita al menos 4 caracteres.'; end if;
    if v_precio is null then raise exception 'El precio debe ser mayor que cero.'; end if;
    v_categoria := coalesce(v_categoria, 'tecnologia');
    v_sku := 'SKU-' || upper(left(v_categoria, 3)) || '-' || lpad(nextval('privado.seq_sku')::text, 4, '0');
    insert into public.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, estado, img, descripcion)
    values (v_sku, yo.seller_id, v_nombre, left(trim(coalesce(p_datos ->> 'marca', '')), 80), v_categoria, v_precio,
            coalesce(v_stock, 0), case when p_enviar then 'en_revision' else 'borrador' end,
            'producto-0' || (1 + (select count(*) from public.productos) % 6),
            left(trim(coalesce(p_datos ->> 'descripcion', '')), 4000));
    v_estado := case when p_enviar then 'en_revision' else 'borrador' end;
  else
    v := privado.bloquear_producto(v_sku, yo);
    if v_stock is not null and v_stock < v.stock_res then
      raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
    end if;
    v_estado := case
      when p_enviar then 'en_revision'
      when v.estado in ('publicado', 'pausado', 'en_revision') then v.estado
      else 'borrador' end;
    if p_enviar and v.estado = 'publicado' and not (p_datos ? 'nombre') then
      raise exception 'El producto ya está publicado.';
    end if;
    update public.productos set
      nombre      = case when p_datos ? 'nombre' then v_nombre else nombre end,
      marca       = case when p_datos ? 'marca' then left(trim(p_datos ->> 'marca'), 80) else marca end,
      categoria   = coalesce(v_categoria, categoria),
      descripcion = case when p_datos ? 'descripcion' then left(trim(p_datos ->> 'descripcion'), 4000) else descripcion end,
      precio_usd  = coalesce(v_precio, precio_usd),
      stock_fis   = coalesce(v_stock, stock_fis),
      estado      = v_estado,
      motivo_rechazo = case when p_enviar then null else motivo_rechazo end,
      actualizado = now()
    where sku = v_sku;
  end if;

  if p_enviar then
    perform privado.notificar('rol:superadmin',
      'Producto ' || v_sku || ' («' || coalesce(nullif(v_nombre, ''), v.nombre) || '») espera moderación', 'category', 'admin/moderacion.html');
  end if;
  perform privado.auditar(case when p_enviar then 'Producto enviado a revisión' else 'Producto guardado' end, v_sku);
  return v_sku;
end $$;

create function public.tm_ajustar_producto(p_sku text, p_campo text, p_valor numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles;
  v public.productos;
begin
  if p_campo = 'precioUsd' then
    yo := privado.exigir(array['seller', 'precios']);
  elsif p_campo = 'stockFis' then
    yo := privado.exigir(array['seller', 'operador']);
  else
    raise exception 'Campo inválido.';
  end if;
  v := privado.bloquear_producto(p_sku, yo);

  if p_campo = 'precioUsd' then
    if p_valor is null or p_valor <= 0 or p_valor > 9999999 then
      raise exception 'El precio debe ser mayor que cero.';
    end if;
    update public.productos set precio_usd = round(p_valor, 2), actualizado = now() where sku = p_sku;
    perform privado.auditar('Ajuste de precio', p_sku || ': ' || v.precio_usd || ' → ' || round(p_valor, 2));
  else
    if p_valor is null or p_valor < 0 or p_valor <> trunc(p_valor) or p_valor > 999999 then
      raise exception 'El stock debe ser un número entero mayor o igual a cero.';
    end if;
    if p_valor < v.stock_res then
      raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
    end if;
    update public.productos set stock_fis = p_valor::integer, actualizado = now() where sku = p_sku;
    perform privado.auditar('Ajuste de stock', p_sku || ': ' || v.stock_fis || ' → ' || p_valor::integer);
  end if;
end $$;

create function public.tm_pausar_producto(p_sku text, p_pausar boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['seller', 'operador']);
  v public.productos := privado.bloquear_producto(p_sku, yo);
begin
  if p_pausar and v.estado = 'publicado' then
    update public.productos set estado = 'pausado', actualizado = now() where sku = p_sku;
  elsif not p_pausar and v.estado = 'pausado' then
    update public.productos set estado = 'publicado', actualizado = now() where sku = p_sku;
  else
    raise exception 'El producto está %: no se puede %.', replace(v.estado, '_', ' '),
      case when p_pausar then 'pausar' else 'reanudar' end;
  end if;
  perform privado.auditar(case when p_pausar then 'Publicación pausada' else 'Publicación reanudada' end, p_sku);
end $$;

-- ---------------------------------------------------------------------------
-- Backoffice: moderación y KYC
-- ---------------------------------------------------------------------------
create function public.tm_moderar_producto(p_sku text, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['superadmin']);
  v public.productos := privado.bloquear_producto(p_sku, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  if v.estado <> 'en_revision' then
    raise exception 'El producto % no está en revisión.', p_sku;
  end if;
  if p_aprobar then
    update public.productos set estado = 'publicado', motivo_rechazo = null, actualizado = now() where sku = p_sku;
    perform privado.notificar('seller:' || v.seller_id, 'Tu producto ' || p_sku || ' fue aprobado y ya está publicado', 'check_circle', 'seller/catalogo.html');
  else
    v_motivo := coalesce(v_motivo, 'No cumple los requisitos de publicación.');
    update public.productos set estado = 'rechazado', motivo_rechazo = v_motivo, actualizado = now() where sku = p_sku;
    perform privado.notificar('seller:' || v.seller_id, 'Tu producto ' || p_sku || ' fue rechazado: ' || v_motivo, 'cancel', 'seller/catalogo.html');
  end if;
  perform privado.auditar(case when p_aprobar then 'Producto aprobado' else 'Producto rechazado' end,
                          p_sku || coalesce(' · ' || case when p_aprobar then null else v_motivo end, ''));
end $$;

create function public.tm_decidir_kyc(p_seller text, p_decision text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['superadmin']);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
  v_antes text;
begin
  if p_decision is null or p_decision not in ('aprobado', 'observado', 'rechazado', 'suspendido') then
    raise exception 'Decisión inválida.';
  end if;
  select estado into v_antes from public.sellers where id = p_seller for update;
  if not found then raise exception 'Seller % no encontrado.', p_seller; end if;
  if p_decision <> 'aprobado' and v_motivo is null then
    raise exception 'Indica el motivo: el seller lo verá.';
  end if;
  update public.sellers set estado = p_decision where id = p_seller;
  insert into public.sellers_kyc (seller_id, rif, observacion) values (p_seller, '—', null)
  on conflict (seller_id) do nothing;
  update public.sellers_kyc
  set observacion = case when p_decision = 'aprobado' then null else v_motivo end
  where seller_id = p_seller;
  if p_decision = 'aprobado' then
    update public.seller_documentos set estado = 'aprobado' where seller_id = p_seller;
  end if;
  perform privado.notificar('seller:' || p_seller,
    case p_decision
      when 'aprobado' then 'Tu comercio fue homologado: ya puedes vender en Tumbo'
      when 'observado' then 'Tu expediente tiene observaciones: ' || v_motivo
      when 'suspendido' then 'Tu comercio fue suspendido: ' || v_motivo
      else 'Tu solicitud fue rechazada: ' || v_motivo end,
    'verified_user', null);
  perform privado.auditar('Decisión KYC', p_seller || ': ' || v_antes || ' → ' || p_decision || coalesce(' · ' || v_motivo, ''));
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios de ejecución: nada es invocable salvo lo que se concede aquí.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol(), privado.seller_id(), privado.tiene_rol(text[]) to anon, authenticated;

grant execute on function public.tm_registrar(text, text, text) to anon, authenticated;
grant execute on function
  public.tm_registrar_acceso(),
  public.tm_marcar_notificaciones_leidas(),
  public.tm_fusionar_carrito(jsonb),
  public.tm_crear_pedido(text, uuid, text, text),
  public.tm_conciliar_pago(text),
  public.tm_aceptar_pedido(text),
  public.tm_marcar_listo(text, numeric),
  public.tm_despachar(text),
  public.tm_confirmar_entrega(text),
  public.tm_cancelar_pedido(text, text),
  public.tm_abrir_disputa(text, text, text, text[]),
  public.tm_responder_disputa(text, text, text[]),
  public.tm_resolver_disputa(text, text, text),
  public.tm_cerrar_ventana(text),
  public.tm_ejecutar_liquidacion(text),
  public.tm_guardar_producto(jsonb, boolean),
  public.tm_ajustar_producto(text, text, numeric),
  public.tm_pausar_producto(text, boolean),
  public.tm_moderar_producto(text, boolean, text),
  public.tm_decidir_kyc(text, text, text)
to authenticated;
