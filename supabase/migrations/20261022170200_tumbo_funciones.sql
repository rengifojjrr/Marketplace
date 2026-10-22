-- =========================================================================
-- Tumbo Market — Operaciones de negocio (API RPC)
-- -------------------------------------------------------------------------
-- Cada public.tm_* recibe primero `p_sesion` y es la única puerta para
-- cambiar un dato. Todas:
--   1. exigen el rol (tumbo_privado.exigir) y la propiedad del recurso;
--   2. bloquean la fila (FOR UPDATE) y validan el estado de origen;
--   3. escriben el cambio, la línea de tiempo, las notificaciones y la
--      auditoría en la MISMA transacción: o pasa todo o no pasa nada;
--   4. emiten la señal de tiempo real.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Comprador: carrito y direcciones
-- ---------------------------------------------------------------------------
create function public.tm_carrito_poner(p_sesion text, p_sku text, p_cant integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v_disp integer;
begin
  if p_cant is null or p_cant < 1 or p_cant > 99 then
    raise exception 'Cantidad inválida.';
  end if;
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

create function public.tm_carrito_quitar(p_sesion text, p_sku text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  delete from tumbo.carrito_items where usuario_id = yo.id and sku = p_sku;
end $$;

-- El carrito de invitado se fusiona al identificarse (solo productos que la
-- tienda muestra).
create function public.tm_fusionar_carrito(p_sesion text, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'Carrito inválido.';
  end if;
  insert into tumbo.carrito_items as c (usuario_id, sku, cant)
  select yo.id, p.sku, least(99, greatest(1, sum((i ->> 'cant')::int)))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  join tumbo.productos p on p.sku = i ->> 'sku' and p.estado = 'publicado'
  join tumbo.sellers s on s.id = p.seller_id and s.estado = 'aprobado'
  where jsonb_typeof(i) = 'object' and (i ->> 'cant') ~ '^\d{1,2}$'
  group by p.sku
  on conflict (usuario_id, sku) do update set cant = least(99, c.cant + excluded.cant);
end $$;

create function public.tm_direccion_agregar(p_sesion text, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v_id uuid;
begin
  insert into tumbo.direcciones (usuario_id, nombre, linea, municipio, ciudad, codigo, telefono, predeterminada)
  values (yo.id, trim(coalesce(p_datos ->> 'nombre', '')), trim(coalesce(p_datos ->> 'linea', '')),
          trim(coalesce(p_datos ->> 'municipio', '')), coalesce(nullif(trim(p_datos ->> 'ciudad'), ''), 'Caracas'),
          coalesce(nullif(trim(p_datos ->> 'codigo'), ''), '1010'), coalesce(nullif(trim(p_datos ->> 'telefono'), ''), '—'),
          false)
  returning id into v_id;
  perform tumbo_privado.auditar(yo, 'Dirección agregada', left(p_datos ->> 'nombre', 60));
  return v_id;
exception when check_violation then
  raise exception 'Revisa la dirección: nombre, dirección completa y municipio son obligatorios.';
end $$;

create function public.tm_direccion_quitar(p_sesion text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  delete from tumbo.direcciones where id = p_id and usuario_id = yo.id;
end $$;

-- ---------------------------------------------------------------------------
-- Flujo del pedido
-- ---------------------------------------------------------------------------
create function public.tm_crear_pedido(p_sesion text, p_envio_tipo text, p_direccion_id uuid, p_metodo text, p_ref text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  cfg tumbo.config;
  v_ref text := upper(trim(coalesce(p_ref, '')));
  v_dir text;
  v_courier text;
  v_costo numeric;
  r record;
  v_seller text;
  v_id text;
  v_ids text[] := '{}';
begin
  select * into cfg from tumbo.config;
  if p_metodo is null or p_metodo not in ('Pago Móvil', 'Transferencia') then
    raise exception 'Elige un método de pago válido.';
  end if;
  if char_length(v_ref) < 5 or char_length(v_ref) > 30 then
    raise exception 'Registra la referencia del pago (entre 5 y 30 caracteres).';
  end if;
  -- Cada pedido reserva stock: sin tope, un comprador podría acapararlo con
  -- pagos que nunca llegan. Finanzas además puede rechazar pagos.
  if (select count(*) from tumbo.pedidos where comprador_id = yo.id and estado = 'pago_por_verificar') >= 5 then
    raise exception 'Tienes 5 pedidos con el pago por verificar: espera la conciliación o cancela alguno.';
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

  -- Bloqueo de los productos del carrito en orden estable (sin interbloqueos
  -- entre compras simultáneas): el stock se valida y se reserva atómicamente.
  perform 1 from tumbo.productos p
  where p.sku in (select c.sku from tumbo.carrito_items c where c.usuario_id = yo.id)
  order by p.sku for update;

  if not exists (select 1 from tumbo.carrito_items where usuario_id = yo.id) then
    raise exception 'El carrito está vacío.';
  end if;

  for r in
    select c.cant, p.nombre, p.estado, p.stock_fis - p.stock_res as disp, s.estado as seller_estado
    from tumbo.carrito_items c
    join tumbo.productos p on p.sku = c.sku
    join tumbo.sellers s on s.id = p.seller_id
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
    select distinct p.seller_id from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
    where c.usuario_id = yo.id order by 1
  loop
    v_id := 'TM-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || lpad(nextval('tumbo_privado.seq_pedido')::text, 5, '0');
    insert into tumbo.pedidos (id, comprador_id, seller_id, estado, envio_tipo, envio_dir, courier,
                               costo_envio_usd, tasa, metodo, ref)
    values (v_id, yo.id, v_seller, 'pago_por_verificar', p_envio_tipo, v_dir, v_courier,
            v_costo, cfg.tasa, p_metodo, v_ref);
    insert into tumbo.pedido_items (pedido_id, sku, nombre, img, cant, precio_usd)
    select v_id, p.sku, p.nombre, p.img, c.cant, p.precio_usd
    from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
    where c.usuario_id = yo.id and p.seller_id = v_seller;
    update tumbo.productos p set stock_res = p.stock_res + c.cant, actualizado = now()
    from tumbo.carrito_items c
    where c.usuario_id = yo.id and c.sku = p.sku and p.seller_id = v_seller;

    perform tumbo_privado.evento(v_id, yo.nombre, 'Pedido creado y pago registrado (' || p_metodo || ' ref. ' || v_ref || ')', 'shopping_cart');
    perform tumbo_privado.notificar('rol:finanzas', 'Pago ' || v_ref || ' pendiente de conciliar (' || v_id || ')', 'fact_check', 'admin/conciliacion.html');
    perform tumbo_privado.auditar(yo, 'Pedido creado', v_id || ' · ' || p_metodo || ' ' || v_ref);
    v_ids := v_ids || v_id;
  end loop;

  delete from tumbo.carrito_items where usuario_id = yo.id;
  perform tumbo_privado.senal();
  return v_ids;
end $$;

create function public.tm_conciliar_pago(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'pago_por_verificar' then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  update tumbo.pedidos set estado = 'por_aceptar', sla_horas = 24 where id = p_id;
  perform tumbo_privado.evento(p_id, 'Finanzas', 'Pago conciliado · pendiente de aceptación del seller', 'fact_check');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Nuevo pedido ' || p_id || ' pendiente de aceptar', 'shopping_cart',
                                  'seller/pedidos.html', array['seller', 'operador']);
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Confirmamos el pago de tu pedido ' || p_id, 'check_circle', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Conciliación de pago', v.ref || ' → ' || p_id);
  perform tumbo_privado.senal();
end $$;

-- El pago no llegó o no coincide: el pedido se cancela y libera su reserva.
create function public.tm_rechazar_pago(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_motivo text := coalesce(left(nullif(trim(coalesce(p_motivo, '')), ''), 200), 'el pago no se pudo verificar');
begin
  if v.estado <> 'pago_por_verificar' then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, 'Finanzas', 'Pago rechazado (' || v_motivo || ') · pedido cancelado y stock liberado', 'block');
  perform tumbo_privado.notificar('usr:' || v.comprador_id,
    'No pudimos verificar el pago de tu pedido ' || p_id || ': ' || v_motivo, 'block', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Pago rechazado', v.ref || ' → ' || p_id || ' · ' || v_motivo);
  perform tumbo_privado.senal();
end $$;

create function public.tm_aceptar_pedido(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'por_aceptar' then
    raise exception 'El pedido % no está por aceptar.', p_id;
  end if;
  update tumbo.pedidos set estado = 'preparando' where id = p_id;
  perform tumbo_privado.evento(p_id, v.seller_id, 'Pedido aceptado, preparación iniciada', 'inventory_2');
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'El seller está preparando tu pedido ' || p_id, 'inventory_2', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Pedido aceptado', p_id);
  perform tumbo_privado.senal();
end $$;

create function public.tm_marcar_listo(p_sesion text, p_id text, p_peso numeric) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_guia text;
begin
  if v.estado <> 'preparando' then
    raise exception 'El pedido % no está en preparación.', p_id;
  end if;
  if p_peso is not null and (p_peso <= 0 or p_peso > 1000) then
    raise exception 'Indica un peso entre 0,1 y 1.000 kg.';
  end if;
  v_guia := 'TM-GUIA-' || nextval('tumbo_privado.seq_guia');
  update tumbo.pedidos set estado = 'listo', guia = v_guia, peso = p_peso where id = p_id;
  perform tumbo_privado.evento(p_id, v.seller_id, 'Paquete listo · guía ' || v_guia || ' (demo)', 'package_2');
  perform tumbo_privado.auditar(yo, 'Guía generada (demo)', p_id || ' · ' || v_guia);
  perform tumbo_privado.senal();
  return v_guia;
end $$;

create function public.tm_despachar(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'listo' then
    raise exception 'El pedido % no está listo para despachar.', p_id;
  end if;
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
  perform tumbo_privado.senal();
end $$;

-- La entrega la confirma el comprador o, con la prueba del courier,
-- Operaciones: así un comprador no puede dejar los fondos del seller en
-- suspenso indefinidamente.
create function public.tm_confirmar_entrega(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'ops', 'superadmin']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  cfg tumbo.config;
begin
  select * into cfg from tumbo.config;
  if v.estado <> 'despachado' then
    raise exception 'El pedido % no está en camino.', p_id;
  end if;
  update tumbo.pedidos set estado = 'entregado', entregado_el = now(), liquidacion = 'retenido' where id = p_id;
  perform tumbo_privado.evento(p_id, case when yo.rol = 'comprador' then yo.nombre else 'Operaciones (prueba del courier)' end,
    'Entrega confirmada · abre la ventana de reclamo (' || cfg.ventana_reclamo_dias || ' días)', 'check_circle');
  perform tumbo_privado.notificar('seller:' || v.seller_id,
    'El pedido ' || p_id || ' fue entregado: fondos en retención hasta cerrar la ventana', 'lock', 'seller/finanzas.html');
  if yo.rol <> 'comprador' then
    perform tumbo_privado.notificar('usr:' || v.comprador_id,
      'Tu pedido ' || p_id || ' figura entregado: tienes ' || cfg.ventana_reclamo_dias || ' días para reclamar', 'check_circle', 'tienda/pedido.html?id=' || p_id);
  end if;
  perform tumbo_privado.auditar(yo, 'Entrega confirmada', p_id);
  perform tumbo_privado.senal();
end $$;

create function public.tm_cancelar_pedido(p_sesion text, p_id text, p_motivo text) returns void
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
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, yo.nombre,
    'Pedido cancelado (' || coalesce(v_motivo, 'sin motivo') || ') · stock liberado' ||
    case when v.estado = 'pago_por_verificar' then '' else ' y reembolso en cola' end, 'cancel');
  if v.estado <> 'pago_por_verificar' then
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'El comprador canceló el pedido ' || p_id, 'cancel',
                                    'seller/pedidos.html?estado=', array['seller', 'operador']);
  end if;
  perform tumbo_privado.notificar('rol:finanzas', 'Cancelación de ' || p_id || ': procesar reembolso demo', 'undo', 'admin/conciliacion.html');
  perform tumbo_privado.auditar(yo, 'Cancelación', p_id || coalesce(' · ' || v_motivo, ''));
  perform tumbo_privado.senal();
end $$;

-- ---------------------------------------------------------------------------
-- Disputas
-- ---------------------------------------------------------------------------
create function public.tm_abrir_disputa(p_sesion text, p_pedido text, p_motivo text, p_descripcion text, p_evidencia text[]) returns text
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

  v_id := 'DSP-' || lpad(nextval('tumbo_privado.seq_disputa')::text, 4, '0');
  insert into tumbo.disputas (id, pedido_id, comprador_id, seller_id, motivo, descripcion, evidencia, monto_usd, estado)
  values (v_id, v.id, v.comprador_id, v.seller_id, p_motivo, v_desc, v_evid, tumbo_privado.bruto_pedido(v.id), 'abierta');
  update tumbo.pedidos set disputa_id = v_id, liquidacion = 'congelado' where id = v.id;
  perform tumbo_privado.evento(v.id, yo.nombre, 'Reclamo ' || v_id || ' abierto · liquidación congelada', 'gavel');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Reclamo ' || v_id || ' abierto sobre ' || v.id || ': responde con tu evidencia', 'gavel', 'seller/disputas.html');
  perform tumbo_privado.notificar('rol:ops', 'Disputa ' || v_id || ' en cola: ' || p_motivo, 'gavel', 'admin/disputas.html');
  perform tumbo_privado.auditar(yo, 'Apertura de disputa', v_id || ' sobre ' || v.id);
  perform tumbo_privado.senal();
  return v_id;
end $$;

create function public.tm_responder_disputa(p_sesion text, p_id text, p_texto text, p_evidencia text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  d tumbo.disputas;
  v_texto text := trim(coalesce(p_texto, ''));
  v_evid text[] := coalesce(p_evidencia, '{}');
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found or d.seller_id is distinct from yo.seller_id then
    raise exception 'Reclamo % no encontrado.', p_id;
  end if;
  if d.estado <> 'abierta' then
    raise exception 'El reclamo % ya fue respondido.', p_id;
  end if;
  if char_length(v_texto) < 10 or char_length(v_texto) > 2000 then
    raise exception 'Describe qué pasó con entre 10 y 2.000 caracteres.';
  end if;
  if coalesce(array_ndims(v_evid), 1) <> 1 or cardinality(v_evid) > 10
     or exists (select 1 from unnest(v_evid) e where char_length(e) > 120) then
    raise exception 'Adjunta como máximo 10 archivos.';
  end if;
  update tumbo.disputas
  set respuesta_texto = v_texto, respuesta_evidencia = v_evid, respuesta_fecha = now(), estado = 'respondida'
  where id = p_id;
  perform tumbo_privado.notificar('rol:ops', 'El seller respondió la disputa ' || p_id, 'forum', 'admin/disputas.html');
  perform tumbo_privado.auditar(yo, 'Respuesta a disputa', p_id);
  perform tumbo_privado.senal();
end $$;

create function public.tm_resolver_disputa(p_sesion text, p_id text, p_decision text, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d tumbo.disputas;
  v_nota text := left(trim(coalesce(p_nota, '')), 500);
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found then raise exception 'Disputa % no encontrada.', p_id; end if;
  if d.estado = 'resuelta' then raise exception 'La disputa % ya está resuelta.', p_id; end if;
  if p_decision is null or p_decision not in ('reembolso', 'devolucion', 'liberar') then
    raise exception 'Decisión inválida.';
  end if;
  perform 1 from tumbo.pedidos where id = d.pedido_id for update;

  update tumbo.disputas
  set estado = 'resuelta', resolucion_decision = p_decision, resolucion_nota = v_nota, resolucion_fecha = now()
  where id = p_id;

  if p_decision = 'reembolso' then
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta a favor del comprador · reembolso total en modo demo', 'undo');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue aprobado: reembolso en proceso (demo)', 'undo', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con reembolso al comprador', 'gavel', 'seller/disputas.html');
  elsif p_decision = 'devolucion' then
    update tumbo.pedidos set estado = 'devolucion' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta: devolución del producto con logística inversa (demo)', 'assignment_return');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ': coordinaremos la devolución del producto', 'assignment_return', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con devolución', 'assignment_return', 'seller/disputas.html');
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa cerrada a favor del seller · fondos liberados', 'lock_open');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue revisado y cerrado sin reembolso', 'gavel', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Resolución de disputa', p_id || ' → ' || p_decision);
  perform tumbo_privado.senal();
end $$;

-- ---------------------------------------------------------------------------
-- Finanzas
-- ---------------------------------------------------------------------------
create function public.tm_cerrar_ventana(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'entregado' or v.liquidacion is distinct from 'retenido' then
    raise exception 'El pedido % no tiene una ventana de reclamo abierta.', p_id;
  end if;
  update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = p_id;
  perform tumbo_privado.evento(p_id, 'Sistema', 'Ventana de reclamo cerrada sin casos · fondos elegibles', 'lock_open');
  perform tumbo_privado.auditar(yo, 'Cierre de ventana de reclamo', p_id);
  perform tumbo_privado.senal();
end $$;

create function public.tm_ejecutar_liquidacion(p_sesion text, p_seller text) returns jsonb
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
  select * into cfg from tumbo.config;
  select array_agg(id order by id) into v_ids
  from (select id from tumbo.pedidos where seller_id = p_seller and liquidacion = 'elegible' for update) e;
  if v_ids is null then
    raise exception 'No hay pedidos elegibles para este seller.';
  end if;

  select coalesce(sum(i.precio_usd * i.cant), 0) into v_bruto from tumbo.pedido_items i where i.pedido_id = any (v_ids);
  v_comision := round(v_bruto * cfg.comision_pct / 100, 2);
  v_tarifa := round(cfg.tarifa_fija_usd * array_length(v_ids, 1), 2);
  v_neto := v_bruto - v_comision - v_tarifa;
  if v_neto <= 0 then
    raise exception 'El neto sería % : acumula más pedidos antes de liquidar.', tumbo_privado.fmt_usd(v_neto);
  end if;
  v_num := nextval('tumbo_privado.seq_liquidacion');
  v_id := 'LIQ-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || lpad(v_num::text, 3, '0');
  v_cpr := 'CPR-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || lpad(v_num::text, 3, '0');

  insert into tumbo.liquidaciones (id, seller_id, periodo, pedidos, bruto_usd, comision_usd, tarifa_usd, neto_usd, estado, fecha, comprobante)
  values (v_id, p_seller, 'hasta ' || v_hoy, v_ids, v_bruto, v_comision, v_tarifa, v_neto, 'pagada',
          (now() at time zone 'America/Caracas')::date, v_cpr);
  update tumbo.pedidos set liquidacion = 'liquidado', liquidacion_id = v_id where id = any (v_ids);
  insert into tumbo.pedido_eventos (pedido_id, actor, texto, icono)
  select unnest(v_ids), 'Finanzas', 'Incluido en la liquidación ' || v_id || ' (demo)', 'receipt_long';
  perform tumbo_privado.notificar('seller:' || p_seller,
    'Liquidación ' || v_id || ' ejecutada: ' || tumbo_privado.fmt_usd(v_neto) || ' · comprobante ' || v_cpr, 'receipt_long', 'seller/finanzas.html');
  perform tumbo_privado.auditar(yo, 'Liquidación ejecutada', v_id || ' → ' || p_seller || ' · ' || tumbo_privado.fmt_usd(v_neto));
  perform tumbo_privado.senal();
  return jsonb_build_object('id', v_id, 'netoUsd', v_neto, 'comprobante', v_cpr);
end $$;

-- ---------------------------------------------------------------------------
-- Catálogo (Seller Center)
-- ---------------------------------------------------------------------------
-- Alta y edición de fichas. Cambiar el contenido (nombre, marca, categoría o
-- descripción) de un producto publicado lo devuelve a moderación: lo que ve
-- el comprador siempre pasó por el backoffice.
create function public.tm_guardar_producto(p_sesion text, p_datos jsonb, p_enviar boolean) returns text
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
    v_categoria := coalesce(v_categoria, 'tecnologia');
    v_sku := 'SKU-' || upper(left(v_categoria, 3)) || '-' || lpad(nextval('tumbo_privado.seq_sku')::text, 4, '0');
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
    if v.estado in ('publicado', 'pausado') and v_contenido then
      v_enviar := true;
    end if;
    if v_enviar and v.estado in ('publicado', 'pausado', 'en_revision') and not v_contenido then
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
      motivo_rechazo = case when v_enviar then null else motivo_rechazo end,
      actualizado = now()
    where sku = v_sku;
  end if;

  if v_enviar then
    perform tumbo_privado.notificar('rol:superadmin',
      'Producto ' || v_sku || ' («' || coalesce(nullif(v_nombre, ''), v.nombre) || '») espera moderación', 'category', 'admin/moderacion.html');
  end if;
  perform tumbo_privado.auditar(yo, case when v_enviar then 'Producto enviado a revisión' else 'Producto guardado' end, v_sku);
  perform tumbo_privado.senal();
  return v_sku;
end $$;

create function public.tm_ajustar_producto(p_sesion text, p_sku text, p_campo text, p_valor numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios;
  v tumbo.productos;
begin
  if p_campo = 'precioUsd' then
    yo := tumbo_privado.exigir(p_sesion, array['seller', 'precios']);
  elsif p_campo = 'stockFis' then
    yo := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  else
    raise exception 'Campo inválido.';
  end if;
  v := tumbo_privado.bloquear_producto(p_sku, yo);

  if p_campo = 'precioUsd' then
    if p_valor is null or p_valor <= 0 or p_valor > 9999999 then
      raise exception 'El precio debe ser mayor que cero.';
    end if;
    update tumbo.productos set precio_usd = round(p_valor, 2), actualizado = now() where sku = p_sku;
    perform tumbo_privado.auditar(yo, 'Ajuste de precio', p_sku || ': ' || v.precio_usd || ' → ' || round(p_valor, 2));
  else
    if p_valor is null or p_valor < 0 or p_valor <> trunc(p_valor) or p_valor > 999999 then
      raise exception 'El stock debe ser un número entero mayor o igual a cero.';
    end if;
    if p_valor < v.stock_res then
      raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
    end if;
    update tumbo.productos set stock_fis = p_valor::integer, actualizado = now() where sku = p_sku;
    perform tumbo_privado.auditar(yo, 'Ajuste de stock', p_sku || ': ' || v.stock_fis || ' → ' || p_valor::integer);
  end if;
  perform tumbo_privado.senal();
end $$;

create function public.tm_pausar_producto(p_sesion text, p_sku text, p_pausar boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, yo);
begin
  if p_pausar and v.estado = 'publicado' then
    update tumbo.productos set estado = 'pausado', actualizado = now() where sku = p_sku;
  elsif not p_pausar and v.estado = 'pausado' then
    update tumbo.productos set estado = 'publicado', actualizado = now() where sku = p_sku;
  else
    raise exception 'El producto no se puede % en su estado actual.', case when p_pausar then 'pausar' else 'reanudar' end;
  end if;
  perform tumbo_privado.auditar(yo, case when p_pausar then 'Publicación pausada' else 'Publicación reanudada' end, p_sku);
  perform tumbo_privado.senal();
end $$;

-- ---------------------------------------------------------------------------
-- Backoffice: moderación y KYC
-- ---------------------------------------------------------------------------
create function public.tm_moderar_producto(p_sesion text, p_sku text, p_aprobar boolean, p_motivo text) returns void
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
    update tumbo.productos set estado = 'publicado', motivo_rechazo = null, actualizado = now() where sku = p_sku;
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'Tu producto ' || p_sku || ' fue aprobado y ya está publicado', 'check_circle',
                                    'seller/catalogo.html', array['seller', 'precios', 'operador']);
  else
    v_motivo := coalesce(v_motivo, 'No cumple los requisitos de publicación.');
    update tumbo.productos set estado = 'rechazado', motivo_rechazo = v_motivo, actualizado = now() where sku = p_sku;
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'Tu producto ' || p_sku || ' fue rechazado: ' || v_motivo, 'cancel',
                                    'seller/catalogo.html', array['seller', 'precios', 'operador']);
  end if;
  perform tumbo_privado.auditar(yo, case when p_aprobar then 'Producto aprobado' else 'Producto rechazado' end,
                                p_sku || case when p_aprobar then '' else ' · ' || v_motivo end);
  perform tumbo_privado.senal();
end $$;

create function public.tm_decidir_kyc(p_sesion text, p_seller text, p_decision text, p_motivo text) returns void
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
  perform tumbo_privado.auditar(yo, 'Decisión KYC', p_seller || ': ' || v_antes || ' → ' || p_decision || coalesce(' · ' || v_motivo, ''));
  perform tumbo_privado.senal();
end $$;
