-- =========================================================================
-- Tumbo Market — Integración de la ola 1 (cuentas · catálogo · pagos · logística)
-- -------------------------------------------------------------------------
-- Los cuatro equipos construyeron en paralelo desde la ola 0; esta
-- migración une lo que cada uno dejó pedido a los demás (las «notas de
-- integración» de docs/dominios/*.md). Solo agrega: cada función redefinida
-- parte de su ÚLTIMA definición tras aplicar 110000..140000 y cambia lo
-- mínimo (el comentario de cada una dice qué).
--
--   1. Auditoría: las personas de fuera del equipo figuran por su cuenta
--      («cuenta <id> (rol)», como actor_cuenta de Cuentas) y una cuenta de
--      prueba solo lee los asientos de las cuentas de prueba y del sistema
--      (tm_auditoria y la ventana de tm_cargar).
--   2. tm_cargar (Catálogo) entrega cada pedido por pedido_lectura_json:
--      al comercio, con el contrato pedido_comercio_json de Logística (sin
--      destino con el pedido cerrado); a una cuenta de prueba del equipo,
--      sin el destino de una persona real.
--   3. archivo_permitido (ola 0) consulta kyc_archivo_visible (Catálogo) en
--      la rama «kyc».
--   4. baja_impedida (Cuentas) cuenta el saldo a favor y los reembolsos sin
--      pedido (Pagos).
--   5. Las RPC de Pagos que leen sellers_kyc pasan por expediente_visible;
--      el recibo no entrega el destino de una persona real a una cuenta de
--      prueba ni el de un pedido cerrado al comercio.
--   6. El checkout (Pagos) respeta el orden de cotizar_envio (Logística): la
--      opción por omisión nunca es el cobro en destino ni el retiro en la
--      tienda.
--   7. Logística: el destinatario y el contacto de una persona real no
--      llegan a las cuentas de prueba del equipo (360, etiquetas, envío).
--
-- Las acciones de dinero de Pagos ya pasan por exigir_elevada (Cuentas)
-- cuando tocan a una persona o un comercio real (exigir_si_real) y siempre
-- en lo irreversible (estados de cuenta, tasa, métodos, cuentas de
-- liquidación); no hizo falta cambiarlas.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
-- Desde la del núcleo (migración 2). La auditoría es inmutable y la leen
-- finanzas y la superadministración: una persona de fuera del equipo
-- (comprador, comercio y su equipo) que no es una cuenta de prueba figura
-- por su cuenta y su rol, no por su nombre (como los asientos de la propia
-- cuenta de Cuentas: si después se da de baja, su nombre no queda en un
-- registro que no se puede editar). El equipo interno firma con su nombre y
-- las cuentas de prueba conservan el suyo.
create or replace function tumbo_privado.auditar(p_yo tumbo.usuarios, p_accion text, p_detalle text) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.auditoria (actor_id, actor, accion, detalle)
  values (p_yo.id,
          case when p_yo.id is null then 'Sistema'
               when p_yo.rol in ('comprador', 'seller', 'precios', 'operador') and not tumbo_privado.cuenta_demo(p_yo.email)
                 then 'cuenta ' || p_yo.id::text || ' (' || p_yo.rol || ')'
               else p_yo.nombre || ' (' || p_yo.rol || ')' end,
          p_accion, coalesce(p_detalle, ''));
$$;

-- ¿Puede quien mira leer un asiento de este actor? Las cuentas reales del
-- equipo, todos; una cuenta de prueba (contraseña pública), solo los de las
-- cuentas de prueba y los del sistema (propuesta de Cuentas).
create function tumbo_privado.auditoria_visible(p_yo tumbo.usuarios, p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce(tumbo_privado.cuenta_demo(p_yo.email), false)
      or p_actor is null
      or exists (select 1 from tumbo.usuarios x where x.id = p_actor and tumbo_privado.cuenta_demo(x.email))
$$;

-- Historial de auditoría (desde la migración 7): a una cuenta de prueba
-- solo le llegan los asientos de las cuentas de prueba y del sistema.

create or replace function public.tm_auditoria(p_sesion text, p_antes bigint default null, p_texto text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
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
          and (not v_demo or tumbo_privado.auditoria_visible(yo, a.actor_id))
        order by a.id desc limit 200) a;
  return jsonb_build_object(
    'eventos', v_eventos,
    'siguiente', case
      when jsonb_array_length(v_eventos) = 200 then (v_eventos -> 199 ->> 'id')::bigint
      when v_piso > coalesce((select min(id) from tumbo.auditoria), 0) then v_piso
      else null end);
end $$;

-- ---------------------------------------------------------------------------
-- Lectura de un pedido según quién mira
-- ---------------------------------------------------------------------------
-- El JSON de un pedido que se va a entregar, recortado por quién lo mira:
--   · el seller y su operador, con el contrato de Logística
--     (pedido_comercio_json: sin destino y con solo la ciudad y el estado
--     cuando el pedido ya no está activo);
--   · una cuenta de prueba del equipo (contraseña pública) y el pedido de
--     una persona real: sin la foto del destino y con solo la ciudad y el
--     estado (como Pagos con los datos de pago y Catálogo con el KYC).
create function tumbo_privado.pedido_lectura_json(p_yo tumbo.usuarios, v tumbo.pedidos, j jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb;
begin
  if p_yo.rol in ('seller', 'operador') then
    return tumbo_privado.pedido_comercio_json(p_yo.rol, v, j);
  end if;
  if p_yo.rol in ('superadmin', 'ops', 'finanzas') and tumbo_privado.cuenta_demo(p_yo.email)
     and not tumbo_privado.ve_comprador(p_yo, v.comprador_id) then
    d := tumbo_privado.destinatario_pedido(v);
    j := j - 'destino';
    if j ? 'envio_dir' then
      j := j || jsonb_build_object('envio_dir',
        coalesce(nullif(concat_ws(', ', d ->> 'ciudad', d ->> 'estado'), ''), 'Dirección oculta a las cuentas de prueba'));
    end if;
  end if;
  return j;
end $$;

-- Desde la de Catálogo. Cambios: cada pedido pasa por
-- pedido_lectura_json (el comercio no ve el destino de un pedido cerrado;
-- una cuenta de prueba del equipo no ve el de una persona real) y la
-- auditoría, por auditoria_visible (con una cuenta de prueba, solo lo
-- reciente de las cuentas de prueba y del sistema).

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
  v_demo boolean := coalesce(tumbo_privado.cuenta_demo(u.email), false);
  v_piso bigint;
begin
  -- a una cuenta de prueba solo le llega lo reciente de la auditoría (lo
  -- suyo y lo del sistema): la búsqueda nunca recorre la tabla entera
  if v_demo and v_rol in ('superadmin', 'finanzas') then
    v_piso := coalesce((select max(id) from tumbo.auditoria), 0) - 20000;
  end if;
  perform tumbo_privado.vencer_pagos();

  r := jsonb_build_object(
    'yo', case when v_uid is null then null else tumbo_privado.perfil_json(u) end,
    'sesion_invalida', p_sesion is not null and v_uid is null,
    'config', (select to_jsonb(c) - 'id' from tumbo.config c),
    'categorias', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden, c.id) from tumbo.categorias c where c.padre is null), '[]'::jsonb),
    'catalogo', jsonb_build_object(
      'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'icono', c.icono, 'padre', c.padre,
                                                                  'orden', c.orden) order by c.orden, c.id)
                              from tumbo.categorias c), '[]'::jsonb),
      'atributos', coalesce((select jsonb_agg(jsonb_build_object('categoria', a.categoria, 'clave', a.clave, 'nombre', a.nombre,
                                                                 'tipo', a.tipo, 'opciones', to_jsonb(a.opciones), 'unidad', a.unidad,
                                                                 'ayuda', a.ayuda, 'obligatorio', a.obligatorio, 'filtrable', a.filtrable,
                                                                 'orden', a.orden) order by a.categoria, a.orden, a.clave)
                             from tumbo.categoria_atributos a), '[]'::jsonb)),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'ciudad', s.ciudad, 'estado', s.estado,
                                          'rating', rs.rating, 'resenas', coalesce(rs.resenas, 0), 'desde', s.desde,
                                          'descripcion', s.descripcion, 'kyc_verificado', s.kyc_verificado,
                                          'horario', s.horario, 'politicas', s.politicas,
                                          'logo_url', tumbo_privado.url_publica(s.logo),
                                          'portada_url', tumbo_privado.url_publica(s.portada)) order by s.id)
      from tumbo.sellers s left join tumbo_privado.reputacion_sellers() rs on rs.seller_id = s.id
      where s.estado = 'aprobado' or s.id = v_seller or v_admin
         or exists (select 1 from tumbo.pedidos p where p.seller_id = s.id and p.comprador_id = v_uid)), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(
               case when p.seller_id = v_seller or v_rol = 'superadmin'
                    then (to_jsonb(p) - 'rating' - 'resenas' - 'imagenes' - 'busqueda')
                         || jsonb_build_object('rating', rp.rating, 'resenas', coalesce(rp.resenas, 0),
                                               'imagenes', tumbo_privado.imagenes_json(p.imagenes))
                    else jsonb_build_object(
                           'sku', p.sku, 'seller_id', p.seller_id, 'nombre', p.nombre, 'marca', p.marca, 'categoria', p.categoria,
                           'precio_usd', p.precio_usd, 'stock_fis', greatest(p.stock_fis - p.stock_res, 0), 'stock_res', 0,
                           'estado', p.estado, 'img', p.img, 'rating', rp.rating, 'resenas', coalesce(rp.resenas, 0),
                           'descripcion', p.descripcion, 'specs', p.specs, 'imagenes', tumbo_privado.imagenes_json(p.imagenes),
                           'padre_sku', p.padre_sku, 'variantes_por', to_jsonb(p.variantes_por), 'atributos', p.atributos,
                           'condicion', p.condicion, 'garantia_meses', p.garantia_meses, 'garantia_quien', p.garantia_quien,
                           'origen', p.origen, 'contenido_caja', p.contenido_caja, 'peso_kg', p.peso_kg,
                           'largo_cm', p.largo_cm, 'ancho_cm', p.ancho_cm, 'alto_cm', p.alto_cm, 'iva', p.iva) end
               order by p.creado desc, p.sku)
      from tumbo.productos p left join tumbo_privado.reputacion_productos() rp on rp.sku = p.sku
      where (p.estado = 'publicado'
             and exists (select 1 from tumbo.sellers s where s.id = p.seller_id and s.estado = 'aprobado'))
         or p.seller_id = v_seller
         or v_rol = 'superadmin'), '[]'::jsonb),
    'mas_vendidos', coalesce((
      select jsonb_agg(x.sku order by x.u desc, x.sku) from (
        select i.sku, sum(i.cant) as u
        from tumbo.pedido_items i
        join tumbo.pedidos pe on pe.id = i.pedido_id
        join tumbo.productos p on p.sku = i.sku and p.estado = 'publicado'
        join tumbo.sellers s on s.id = p.seller_id and s.estado = 'aprobado'
        where pe.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'cerrado')
        group by i.sku order by 2 desc, 1 limit 12) x), '[]'::jsonb)
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
        select jsonb_agg(tumbo_privado.pedido_lectura_json(u, p, (case when v_rol = 'operador'
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
                                            '[]'::jsonb)))
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
      -- Con una cuenta de prueba, solo los expedientes de los comercios de prueba.
      'kyc', coalesce((
        select jsonb_agg(case when v_rol = 'finanzas' then to_jsonb(k) - 'observacion' else to_jsonb(k) end order by k.seller_id)
        from tumbo.sellers_kyc k
        where ((k.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'finanzas'))
          and tumbo_privado.expediente_visible(u, k.seller_id)), '[]'::jsonb),
      'docs', coalesce((
        select jsonb_agg((to_jsonb(x) - 'archivo_id')
                         || jsonb_build_object('archivo_id', case when x.seller_id = v_seller and v_rol = 'seller' then x.archivo_id end,
                                               'archivo_nombre', a.nombre, 'archivo_tipo', a.tipo, 'archivo_listo', a.id is not null)
                         order by x.seller_id, x.orden)
        from tumbo.seller_documentos x
        left join tumbo.archivos a on a.id = x.archivo_id and a.estado = 'listo'
        where ((x.seller_id = v_seller and v_rol = 'seller') or v_rol = 'superadmin')
          and tumbo_privado.expediente_visible(u, x.seller_id)), '[]'::jsonb),
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
             and (not v_demo or (a.id >= v_piso and tumbo_privado.auditoria_visible(u, a.actor_id)))
           order by a.fecha desc, a.id desc limit 300)
          union all
          (select * from tumbo.auditoria a
           where a.accion <> 'Inicio de sesión' and not (a.actor_id is null or a.actor ~ '\((superadmin|ops|finanzas)\)$')
             and (not v_demo or (a.id >= v_piso and tumbo_privado.auditoria_visible(u, a.actor_id)))
           order by a.fecha desc, a.id desc limit 150)
          union all
          (select * from tumbo.auditoria a where a.accion = 'Inicio de sesión'
             and (not v_demo or (a.id >= v_piso and tumbo_privado.auditoria_visible(u, a.actor_id)))
           order by a.fecha desc, a.id desc limit 50)) a), '[]'::jsonb)
        else '[]'::jsonb end,
      'direcciones', coalesce((
        select jsonb_agg(to_jsonb(d) - 'usuario_id' order by d.creado, d.id) from tumbo.direcciones d
        where d.usuario_id = v_uid), '[]'::jsonb),
      'carrito', coalesce((
        select jsonb_agg(jsonb_build_object('sku', c.sku, 'cant', c.cant) order by c.agregado, c.sku) from tumbo.carrito_items c
        where c.usuario_id = v_uid), '[]'::jsonb),
      'favoritos', case when v_rol = 'comprador' then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku', f.sku, 'nombre', p.nombre, 'img', p.img, 'creado', f.creado,
                 'visible', p.estado = 'publicado' and s.estado = 'aprobado',
                 'precio_usd', case when p.estado = 'publicado' and s.estado = 'aprobado' then p.precio_usd end,
                 'imagen', case when p.estado = 'publicado' and s.estado = 'aprobado'
                                then tumbo_privado.imagenes_json(p.imagenes) -> 0 ->> 'url' end)
               order by f.creado desc, f.sku)
        from tumbo.favoritos f join tumbo.productos p on p.sku = f.sku join tumbo.sellers s on s.id = p.seller_id
        where f.usuario_id = v_uid), '[]'::jsonb) else '[]'::jsonb end,
      'alertas', case when v_rol = 'comprador' then coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'sku', a.sku, 'tipo', a.tipo, 'precio_ref', a.precio_ref, 'creado', a.creado)
                         order by a.creado desc, a.id desc)
        from tumbo.alertas a where a.usuario_id = v_uid and a.activa), '[]'::jsonb) else '[]'::jsonb end
    );
  end if;

  v_h := md5(r::text);
  if p_huella is not null and p_huella = v_h then
    return jsonb_build_object('sin_cambios', true, 'huella', v_h);
  end if;
  return r || jsonb_build_object('huella', v_h);
end $$;

-- ---------------------------------------------------------------------------
-- Archivos KYC (pedido de Catálogo a la ola 0)
-- ---------------------------------------------------------------------------
-- Desde la de fundaciones: la rama «kyc» consulta kyc_archivo_visible, así la
-- URL firmada de un documento pide lo mismo que tm_kyc_archivo aunque
-- alguien conozca su id.

create or replace function tumbo_privado.archivo_permitido(p_yo tumbo.usuarios, p_proposito text, p_entidad text, p_accion text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ver boolean := p_accion = 'ver';
  v_equipo boolean := coalesce(p_yo.rol in ('superadmin', 'ops'), false);
  v_comercio boolean := coalesce(p_yo.rol in ('seller', 'operador'), false);
  v_principal boolean := coalesce(p_yo.rol = 'seller', false);
  v_comprador uuid;
  v_seller text;
  v_seller_ve boolean := false;
  v_ok boolean := false;
begin
  if p_yo.id is null or p_entidad is null or p_accion is null or p_accion not in ('subir', 'ver') then
    return false;
  end if;

  if p_proposito = 'producto' then
    v_ok := v_comercio and (p_entidad = p_yo.seller_id
      or exists (select 1 from tumbo.productos p where p.sku = p_entidad and p.seller_id = p_yo.seller_id));
  elsif p_proposito = 'perfil' then
    v_ok := v_principal and p_entidad = p_yo.seller_id;
  elsif p_proposito = 'kyc' then
    -- ver: el contrato de Catálogo (cuenta real con sesión elevada; una
    -- cuenta de prueba, solo los documentos de los comercios de prueba)
    v_ok := (v_principal and p_entidad = p_yo.seller_id)
            or (v_ver and p_yo.rol = 'superadmin' and tumbo_privado.kyc_archivo_visible(p_yo, p_entidad));
  elsif p_proposito = 'liquidacion' then
    select l.seller_id into v_seller from tumbo.liquidaciones l where l.id = p_entidad;
    v_ok := found and (p_yo.rol in ('finanzas', 'superadmin') or (v_ver and v_principal and p_yo.seller_id = v_seller));
  elsif p_proposito in ('evidencia', 'comprobante', 'guia', 'entrega', 'chat') then
    -- Cuelgan de un pedido (la evidencia, también de un reclamo).
    if p_proposito = 'evidencia' then
      select d.comprador_id, d.seller_id, true into v_comprador, v_seller, v_seller_ve
      from tumbo.disputas d where d.id = p_entidad;
    end if;
    if v_comprador is null then
      select p.comprador_id, p.seller_id,
             p.estado <> 'pago_por_verificar' and not (p.estado = 'cancelado' and p.sla_horas is null)
        into v_comprador, v_seller, v_seller_ve
      from tumbo.pedidos p where p.id = p_entidad;
    end if;
    if v_comprador is not null then
      v_ok := case p_proposito
        when 'evidencia' then p_yo.id = v_comprador or (v_principal and p_yo.seller_id = v_seller and v_seller_ve) or v_equipo
        when 'comprobante' then p_yo.id = v_comprador or (v_ver and p_yo.rol in ('finanzas', 'superadmin'))
        when 'chat' then p_yo.id = v_comprador or (v_comercio and p_yo.seller_id = v_seller and v_seller_ve)
        -- guía y entrega
        else (v_comercio and p_yo.seller_id = v_seller and v_seller_ve) or v_equipo or (v_ver and p_yo.id = v_comprador) end;
    end if;
  end if;
  -- nunca NULL: quien llama hace «not archivo_permitido(…)»
  return coalesce(v_ok, false);
end $$;

-- ---------------------------------------------------------------------------
-- Baja de la cuenta (Cuentas) con el dinero de Pagos
-- ---------------------------------------------------------------------------
-- Desde la de Cuentas: también la impiden un reembolso sin enviar que no
-- cuelga de un pedido suyo (excedente o sin venta, con comprador_id) y el
-- saldo a favor (crédito en Tumbo), que la baja dejaría sin dueña.

create or replace function tumbo_privado.baja_impedida(p_usuario uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from tumbo.pedidos where comprador_id = p_usuario
                 and estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'devolucion'))
      or exists (select 1 from tumbo.disputas where comprador_id = p_usuario and estado <> 'resuelta')
      then 'Hay pedidos o reclamos en curso: la cuenta se podrá eliminar cuando terminen.'
    when exists (select 1 from tumbo.reembolsos r join tumbo.pedidos p on p.id = r.pedido_id
                 where p.comprador_id = p_usuario and r.estado <> 'enviado')
      or exists (select 1 from tumbo.reembolsos r where r.comprador_id = p_usuario and r.estado <> 'enviado')
      then 'Hay un reembolso que todavía no se ha enviado: la cuenta se podrá eliminar cuando llegue (así no se pierden los datos para devolver el dinero).'
    when (select coalesce(sum(c.monto_usd), 0) from tumbo.creditos c where c.usuario_id = p_usuario) > 0
      then 'Tienes saldo a favor (crédito en Tumbo): úsalo en una compra o pide que te lo devuelvan antes de eliminar la cuenta.'
  end
$$;

-- ---------------------------------------------------------------------------
-- Pagos: lo que viene del expediente KYC pasa por expediente_visible
-- ---------------------------------------------------------------------------
-- A una cuenta de prueba no le llega el RIF de un comercio real (Catálogo:
-- expediente_visible); en el recibo, tampoco el destino de una persona real,
-- y el comercio no ve el de un pedido cerrado (Logística).

create or replace function public.tm_cuentas_liquidacion(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'superadmin', 'finanzas']);
begin
  return jsonb_build_object(
    'bancos', (select jsonb_agg(jsonb_build_object('codigo', b.codigo, 'nombre', b.nombre) order by b.nombre) from tumbo.bancos b),
    'cuentas', coalesce((
      select jsonb_agg(tumbo_privado.cuenta_json_para(c, yo) || jsonb_build_object(
               'seller_id', c.seller_id, 'seller', s.nombre, 'rif_comercio', case when tumbo_privado.expediente_visible(yo, c.seller_id) then k.rif end,
               'vigente', c.id = (tumbo_privado.cuenta_vigente(c.seller_id)).id,
               'anulable', c.estado = 'pendiente' or (c.estado = 'verificada' and c.vigente_desde > now()),
               'verificada_por', case when yo.rol <> 'seller' then c.verificada_por end, 'creado_por', c.creado_por)
             order by c.seller_id, c.id desc)
      from tumbo.cuentas_liquidacion c join tumbo.sellers s on s.id = c.seller_id
      left join tumbo.sellers_kyc k on k.seller_id = c.seller_id
      where (yo.rol = 'seller' and c.seller_id = yo.seller_id)
         or (yo.rol <> 'seller' and (c.estado = 'pendiente' or c.creado > now() - interval '180 days' or c.estado = 'verificada'))), '[]'::jsonb));
end $$;

create or replace function public.tm_liquidaciones_corridas(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  cfg tumbo.config;
begin
  select * into cfg from tumbo.config;
  return jsonb_build_object(
    'tasa', cfg.tasa,
    'prueba', tumbo_privado.cuenta_demo(yo.email),
    'por_preparar', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seller_id', s.id, 'seller', s.nombre, 'retencion', tumbo_privado.retencion_seller(s.id),
               'cuenta', tumbo_privado.cuenta_json_para(tumbo_privado.cuenta_vigente(s.id), yo),
               'bloqueado', tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.seller_real(s.id),
               'pedidos', x.pedidos, 'bruto', x.bruto, 'envio', x.envio, 'comision', x.comision, 'tarifa', x.tarifa,
               'ajustes', coalesce(a.total, 0), 'ajustes_detalle', coalesce(a.detalle, '[]'::jsonb),
               'neto', x.bruto + x.envio + coalesce(a.total, 0) - x.comision - x.tarifa) order by s.id)
      from (select q.seller_id,
                   jsonb_agg(tumbo_privado.liquidacion_pedido(q) order by q.id) as pedidos,
                   sum((tumbo_privado.liquidacion_pedido(q) ->> 'base')::numeric) as bruto,
                   sum((tumbo_privado.liquidacion_pedido(q) ->> 'envio')::numeric) as envio,
                   sum((tumbo_privado.liquidacion_pedido(q) ->> 'comision')::numeric) as comision,
                   sum((tumbo_privado.liquidacion_pedido(q) ->> 'tarifa')::numeric) as tarifa
            from tumbo.pedidos q where tumbo_privado.pedido_liquidable(q) group by q.seller_id) x
      join tumbo.sellers s on s.id = x.seller_id
      left join lateral (select sum(j.monto_usd) as total,
                                jsonb_agg(jsonb_build_object('id', j.id, 'monto_usd', j.monto_usd, 'motivo', j.motivo, 'por', j.por, 'creado', j.creado) order by j.id) as detalle
                         from tumbo.ajustes_seller j where j.seller_id = s.id and j.liquidacion_id is null) a on true), '[]'::jsonb),
    'en_curso', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object(
               'seller', s.nombre, 'retencion', tumbo_privado.retencion_seller(l.seller_id),
               'bloqueado', tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.seller_real(l.seller_id),
               'cuenta_vigente', tumbo_privado.cuenta_json_para(tumbo_privado.cuenta_vigente(l.seller_id), yo),
               'ajustes_por', coalesce((select jsonb_agg(distinct a.por) from tumbo.ajustes_seller a where a.id = any (l.ajuste_ids)), '[]'::jsonb),
               'ajuste_mio', exists (select 1 from tumbo.ajustes_seller a where a.id = any (l.ajuste_ids) and a.por_id = yo.id),
               'eventos', coalesce((select jsonb_agg(jsonb_build_object('actor', e.actor, 'accion', e.accion, 'nota', e.nota, 'fecha', e.fecha,
                                                                        'mio', e.usuario_id = yo.id) order by e.id)
                                    from tumbo.liquidacion_eventos e where e.liquidacion_id = l.id), '[]'::jsonb))
             order by l.preparada_el, l.id)
      from tumbo.liquidaciones l join tumbo.sellers s on s.id = l.seller_id
      where l.ciclo in ('preparada', 'aprobada', 'fallida')), '[]'::jsonb),
    'historial', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object('seller', s.nombre) order by l.fecha desc, l.id desc)
      from (select * from tumbo.liquidaciones where ciclo is null or ciclo in ('pagada', 'anulada') order by fecha desc, id desc limit 100) l
      join tumbo.sellers s on s.id = l.seller_id), '[]'::jsonb),
    'cuentas_por_verificar', coalesce((
      select jsonb_agg(tumbo_privado.cuenta_json_para(c, yo) || jsonb_build_object('seller_id', c.seller_id, 'seller', s.nombre, 'rif_comercio', case when tumbo_privado.expediente_visible(yo, c.seller_id) then k.rif end,
                                                                          'creado_por', c.creado_por) order by c.id)
      from tumbo.cuentas_liquidacion c join tumbo.sellers s on s.id = c.seller_id left join tumbo.sellers_kyc k on k.seller_id = c.seller_id
      where c.estado = 'pendiente'), '[]'::jsonb),
    'retenciones', coalesce((select jsonb_agg(to_jsonb(r) order by r.desde) from tumbo.retenciones r), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'estado', s.estado,
                                                             'retencion', tumbo_privado.retencion_seller(s.id),
                                                             'bloqueado', tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.seller_real(s.id)) order by s.id)
                         from tumbo.sellers s), '[]'::jsonb));
end $$;

create or replace function tumbo_privado.libro_ventas(p_seller text, p_desde date, p_hasta date, p_yo tumbo.usuarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'columnas', jsonb_build_array('Fecha', 'Pedido', 'Pago', 'Comercio', 'RIF comercio', 'Documento comprador', 'Comprador',
                                  'Productos USD', 'Descuentos USD', 'Exento USD', 'Base imponible USD', 'IVA USD', 'Envío USD',
                                  'IGTF USD', 'Total USD', 'Tasa', 'Total Bs', 'Estado'),
    'filas', coalesce(jsonb_agg(jsonb_build_array(
               to_char(g.verificado_el at time zone 'America/Caracas', 'DD/MM/YYYY'), x.id, g.id, s.nombre,
               case when tumbo_privado.expediente_visible(p_yo, x.seller_id) then k.rif else 'oculto' end,
               case when tumbo_privado.ve_comprador(p_yo, x.comprador_id) then coalesce(g.fiscal ->> 'documento', '') else 'oculto' end,
               case when tumbo_privado.ve_comprador(p_yo, x.comprador_id) then coalesce(g.fiscal ->> 'razon_social', u.nombre)
                    else 'Cuenta real (oculta a las cuentas de prueba)' end,
               tumbo_privado.bruto_pedido(x.id), x.descuento_usd + x.descuento_tumbo_usd, x.exento_usd,
               tumbo_privado.bruto_pedido(x.id) - x.descuento_usd - x.descuento_tumbo_usd - x.exento_usd - x.iva_usd,
               x.iva_usd, x.costo_envio_usd, x.igtf_usd,
               tumbo_privado.bruto_pedido(x.id) - x.descuento_usd - x.descuento_tumbo_usd + x.costo_envio_usd + x.igtf_usd,
               x.tasa, x.monto_bs, x.estado) order by g.verificado_el, x.id), '[]'::jsonb))
  from tumbo.pedidos x join tumbo.pagos g on g.id = x.pago_id
  join tumbo.sellers s on s.id = x.seller_id left join tumbo.sellers_kyc k on k.seller_id = x.seller_id
  join tumbo.usuarios u on u.id = x.comprador_id
  where g.estado = 'verificado' and (p_seller is null or x.seller_id = p_seller)
    and (g.verificado_el at time zone 'America/Caracas')::date between p_desde and p_hasta
    and (x.estado <> 'cancelado' or x.cancelado_el > g.verificado_el)
$$;

create or replace function public.tm_pedido_recibo(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'finanzas', 'superadmin']);
  x tumbo.pedidos;
  g tumbo.pagos;
  m jsonb;
  v_ve boolean;
begin
  select * into x from tumbo.pedidos where id = p_id;
  if not found
     or (yo.rol = 'comprador' and x.comprador_id <> yo.id)
     or (yo.rol = 'seller' and (x.seller_id is distinct from yo.seller_id or x.estado = 'pago_por_verificar'
                                or (x.estado = 'cancelado' and x.sla_horas is null))) then
    raise exception 'Pedido % no encontrado.', p_id;
  end if;
  select * into g from tumbo.pagos where id = x.pago_id;
  m := tumbo_privado.montos_pedido(x);
  v_ve := yo.id = x.comprador_id or tumbo_privado.ve_comprador(yo, x.comprador_id);
  return jsonb_build_object(
    'aviso', 'Documento no fiscal: recibo y nota de entrega. La factura con número de control la emite el comercio con su imprenta digital autorizada por el SENIAT.',
    'pedido', tumbo_privado.pedido_lectura_json(yo, x,
                jsonb_build_object('id', x.id, 'creado', x.creado, 'estado', x.estado, 'envio_tipo', x.envio_tipo, 'envio_dir', x.envio_dir,
                                   'courier', x.courier, 'guia', x.guia, 'envio_dias', x.envio_dias, 'destino', x.destino)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('sku', i.sku, 'nombre', i.nombre, 'cant', i.cant, 'precio_usd', i.precio_usd,
                                                          'total_usd', i.precio_usd * i.cant, 'exento', tumbo_privado.iva_exento(i.sku)) order by i.sku)
                       from tumbo.pedido_items i where i.pedido_id = x.id), '[]'::jsonb),
    'montos', m || jsonb_build_object('exento', x.exento_usd, 'tasa', x.tasa,
                                      'total_bs', coalesce(x.monto_bs, round((m ->> 'pagado')::numeric * x.tasa, 2)),
                                      'iva_pct', tumbo_privado.numero(coalesce(tumbo_privado.ajuste('impuestos'), '{}'::jsonb) -> 'iva_pct', 16)),
    'comercio', (select jsonb_build_object('id', s.id, 'nombre', s.nombre, 'ciudad', s.ciudad,
                                           'rif', case when yo.rol in ('comprador', 'seller') or tumbo_privado.expediente_visible(yo, s.id) then k.rif end)
                 from tumbo.sellers s left join tumbo.sellers_kyc k on k.seller_id = s.id where s.id = x.seller_id),
    'comprador', case when v_ve then (select jsonb_build_object('nombre', coalesce(g.fiscal ->> 'razon_social', u.nombre), 'documento', g.fiscal ->> 'documento')
                                      from tumbo.usuarios u where u.id = x.comprador_id)
                      else jsonb_build_object('nombre', 'Cuenta real (oculta a las cuentas de prueba)', 'documento', null, 'oculto', true) end,
    'pago', case when g.id is null then jsonb_build_object('metodo', x.metodo, 'referencia', nullif(x.ref, ''))
                 else jsonb_build_object('id', g.id, 'metodo', x.metodo, 'referencia', g.referencia, 'estado', g.estado,
                                         'verificado_el', g.verificado_el, 'moneda', g.moneda) end);
end $$;

-- ---------------------------------------------------------------------------
-- Checkout (Pagos) sobre la cotización de Logística
-- ---------------------------------------------------------------------------
-- Desde la de Pagos: las opciones de envío conservan el orden del contrato
-- cotizar_envio (Logística) en vez de ordenarse solo por costo. El cobro en
-- destino y el retiro en la tienda cuestan 0 ahora, así que por costo
-- quedaban primero y el checkout los elegía por omisión.

create or replace function tumbo_privado.checkout_calcular(p_yo tumbo.usuarios, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  cfg tumbo.config;
  m tumbo.metodos_pago;
  v_imp jsonb := coalesce(tumbo_privado.ajuste('impuestos'), '{}'::jsonb);
  v_iva numeric := tumbo_privado.numero(v_imp -> 'iva_pct', 16);
  v_igtf numeric := tumbo_privado.numero(v_imp -> 'igtf_pct', 3);
  v_entrega text := coalesce(v_d ->> 'entrega', '');
  v_destino jsonb;
  v_ag_ciudad text;
  v_ag_estado text;
  v_fiscal jsonb;
  v_doc text;
  v_razon text;
  v_items jsonb;
  v_cupon text := nullif(upper(left(trim(coalesce(v_d ->> 'cupon', '')), 40)), '');
  v_promo jsonb;
  v_lineas jsonb;
  v_lineas_total numeric := 0;
  v_desc_global numeric;
  v_base_total numeric := 0;
  v_desc_global_rest numeric;
  v_saldo numeric := 0;
  v_credito_rest numeric := 0;
  v_sellers jsonb := '[]'::jsonb;
  v_n_sellers integer;
  v_k integer := 0;
  s record;
  i record;
  v_l jsonb;
  v_ld numeric;
  v_ex boolean;
  v_items_s jsonb;
  v_prod numeric; v_desc numeric; v_desc_t numeric; v_gravado numeric; v_exento numeric;
  v_opciones jsonb; v_opc jsonb; v_elegida text; v_envio numeric;
  v_base_s numeric; v_desc_g_s numeric; v_iva_s numeric; v_base_pago numeric; v_cred numeric; v_igtf_s numeric; v_pagar numeric;
  t_sub numeric := 0; t_desc numeric := 0; t_env numeric := 0; t_iva numeric := 0; t_igtf numeric := 0;
  t_cred numeric := 0; t_total numeric := 0; t_bs numeric := 0;
  v_mensaje_cupon text;
begin
  select * into cfg from tumbo.config;
  select * into m from tumbo.metodos_pago where id = coalesce(nullif(v_d ->> 'metodo', ''), 'pago_movil');
  if not found or not m.activo or m.interno then
    raise exception 'Elige un método de pago disponible.';
  end if;

  -- destino
  if v_entrega = 'domicilio' then
    select jsonb_build_object('tipo', 'domicilio', 'direccion_id', d.id, 'nombre', d.nombre, 'linea', d.linea,
             'municipio', d.municipio, 'parroquia', d.parroquia, 'estado', d.estado, 'ciudad', d.ciudad, 'codigo', d.codigo,
             'referencia', d.referencia, 'telefono', nullif(d.telefono, '—'),
             'destinatario', coalesce(nullif(trim(d.destinatario), ''), p_yo.nombre),
             'cedula', d.cedula_destinatario,
             'telefono_destinatario', coalesce(d.telefono_destinatario, nullif(d.telefono, '—')))
      into v_destino
    from tumbo.direcciones d
    where d.id = tumbo_privado.uuid_texto(v_d ->> 'direccion_id') and d.usuario_id = p_yo.id;
    if v_destino is null then
      raise exception 'Elige una dirección de entrega válida.';
    end if;
  elsif v_entrega = 'agencia' then
    -- la ciudad (y el estado) donde retira: los que eligió o, si no, los de
    -- su dirección predeterminada (o la más reciente). Sin ellos no se
    -- inventa ninguna: Logística cotiza sin ciudad.
    v_ag_ciudad := nullif(left(regexp_replace(trim(coalesce(v_d -> 'agencia' ->> 'ciudad', '')), '[[:cntrl:]<>]+', '', 'g'), 80), '');
    v_ag_estado := nullif(left(regexp_replace(trim(coalesce(v_d -> 'agencia' ->> 'estado', '')), '[[:cntrl:]<>]+', '', 'g'), 40), '');
    if v_ag_ciudad is null then
      select nullif(trim(d.ciudad), ''), nullif(trim(d.estado), '') into v_ag_ciudad, v_ag_estado
      from tumbo.direcciones d where d.usuario_id = p_yo.id order by d.predeterminada desc, d.creado desc limit 1;
    end if;
    v_destino := jsonb_strip_nulls(jsonb_build_object('tipo', 'agencia', 'destinatario', p_yo.nombre, 'cedula', p_yo.cedula,
                                    'telefono_destinatario', p_yo.telefono, 'ciudad', v_ag_ciudad, 'estado', v_ag_estado));
  else
    raise exception 'Elige cómo quieres recibir el pedido.';
  end if;

  -- datos fiscales (opcionales) para la factura
  if jsonb_typeof(v_d -> 'fiscal') = 'object' and nullif(trim(coalesce(v_d -> 'fiscal' ->> 'documento', '')), '') is not null then
    v_doc := tumbo_privado.documento(v_d -> 'fiscal' ->> 'documento');
    if v_doc is null then
      raise exception 'Revisa la cédula o el RIF para la factura (p. ej. V-12345678 o J-12345678-9).';
    end if;
    v_razon := left(regexp_replace(trim(coalesce(v_d -> 'fiscal' ->> 'razon_social', '')), '[[:cntrl:]<>]+', '', 'g'), 120);
    if v_doc ~ '^[JG]-' and char_length(v_razon) < 3 then
      raise exception 'Escribe la razón social para la factura.';
    end if;
    v_fiscal := jsonb_build_object('documento', v_doc, 'razon_social', coalesce(nullif(v_razon, ''), p_yo.nombre));
  end if;

  -- carrito: solo lo que está a la venta, con existencia y hasta 10 unidades
  for i in
    select c.sku, c.cant, p.nombre, p.estado, p.stock_fis - p.stock_res as disp, se.estado as seller_estado
    from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku join tumbo.sellers se on se.id = p.seller_id
    where c.usuario_id = p_yo.id order by c.sku
  loop
    if i.estado <> 'publicado' or i.seller_estado <> 'aprobado' then
      raise exception 'El producto % ya no está disponible: quítalo del carrito.', i.sku;
    end if;
    if i.cant > 10 then
      raise exception 'Puedes llevar hasta 10 unidades de cada producto.';
    end if;
    if i.cant > i.disp then
      raise exception '«%» solo tiene % disponibles.', i.nombre, greatest(i.disp, 0);
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('sku', c.sku, 'cant', c.cant) order by c.sku) into v_items
  from tumbo.carrito_items c where c.usuario_id = p_yo.id;
  if v_items is null then
    raise exception 'El carrito está vacío.';
  end if;

  -- promociones (contrato de Crecimiento)
  v_promo := tumbo_privado.aplicar_promociones(p_yo.id, v_items, v_cupon);
  if jsonb_typeof(v_promo) <> 'object' then
    v_promo := '{}'::jsonb;
  end if;
  select coalesce(jsonb_object_agg(l ->> 'sku', l), '{}'::jsonb) into v_lineas
  from jsonb_array_elements(case when jsonb_typeof(v_promo -> 'lineas') = 'array' then v_promo -> 'lineas' else '[]'::jsonb end) l
  where jsonb_typeof(l) = 'object' and l ? 'sku';
  if v_cupon is not null and nullif(v_promo ->> 'cupon', '') is null then
    v_mensaje_cupon := 'El cupón ' || v_cupon || ' no es válido o no aplica a este carrito.';
  end if;

  -- base de cada línea y descuento general (el que excede a las líneas)
  select coalesce(sum(p.precio_usd * c.cant), 0),
         coalesce(sum(least(greatest(coalesce(tumbo_privado.num_json(v_lineas -> c.sku -> 'descuento_usd'), 0), 0), p.precio_usd * c.cant)), 0)
    into v_base_total, v_lineas_total
  from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku where c.usuario_id = p_yo.id;
  v_desc_global := least(greatest(coalesce(tumbo_privado.num_json(v_promo -> 'descuento_usd'), 0) - v_lineas_total, 0),
                         v_base_total - v_lineas_total);
  v_desc_global := round(v_desc_global, 2);
  v_desc_global_rest := v_desc_global;
  v_base_total := v_base_total - v_lineas_total;

  -- crédito en Tumbo
  select coalesce(sum(monto_usd), 0) into v_saldo from tumbo.creditos where usuario_id = p_yo.id;
  if coalesce(v_d ->> 'usar_credito', 'false') = 'true' then
    v_credito_rest := greatest(v_saldo, 0);
  end if;

  select count(distinct p.seller_id) into v_n_sellers
  from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku where c.usuario_id = p_yo.id;

  for s in
    select p.seller_id, se.nombre from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
    join tumbo.sellers se on se.id = p.seller_id
    where c.usuario_id = p_yo.id group by p.seller_id, se.nombre order by p.seller_id
  loop
    v_k := v_k + 1;
    v_items_s := '[]'::jsonb; v_prod := 0; v_desc := 0; v_desc_t := 0; v_gravado := 0; v_exento := 0;
    for i in
      select c.sku, c.cant, p.nombre, p.img, p.precio_usd from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
      where c.usuario_id = p_yo.id and p.seller_id = s.seller_id order by c.sku
    loop
      v_l := v_lineas -> i.sku;
      v_ld := round(least(greatest(coalesce(tumbo_privado.num_json(v_l -> 'descuento_usd'), 0), 0), i.precio_usd * i.cant), 2);
      v_ex := tumbo_privado.iva_exento(i.sku);
      if coalesce(v_l ->> 'financia', 'seller') = 'tumbo' then v_desc_t := v_desc_t + v_ld; else v_desc := v_desc + v_ld; end if;
      v_prod := v_prod + i.precio_usd * i.cant;
      if not v_ex then
        v_gravado := v_gravado + i.precio_usd * i.cant - v_ld;
      else
        v_exento := v_exento + i.precio_usd * i.cant - v_ld;
      end if;
      v_items_s := v_items_s || jsonb_build_object('sku', i.sku, 'nombre', i.nombre, 'img', i.img, 'cant', i.cant,
        'precio_usd', i.precio_usd, 'total_usd', i.precio_usd * i.cant, 'descuento_usd', v_ld, 'exento', v_ex);
    end loop;
    v_base_s := v_prod - v_desc - v_desc_t;
    -- parte del descuento general (Tumbo), el último seller se lleva el resto
    v_desc_g_s := case when v_desc_global = 0 or v_base_total <= 0 then 0
                       when v_k = v_n_sellers then v_desc_global_rest
                       else least(round(v_desc_global * v_base_s / v_base_total, 2), v_desc_global_rest) end;
    v_desc_g_s := least(v_desc_g_s, v_base_s);
    v_desc_global_rest := v_desc_global_rest - v_desc_g_s;
    if v_base_s > 0 and v_desc_g_s > 0 then
      v_gravado := v_gravado * (1 - v_desc_g_s / v_base_s);
      v_exento := v_exento * (1 - v_desc_g_s / v_base_s);
    end if;
    v_desc_t := v_desc_t + v_desc_g_s;

    -- envío (contrato de Logística): en el orden del contrato (lo que llega
    -- al estado del comprador y se paga ahora, del más económico al más
    -- caro; después el cobro en destino y al final el retiro en la tienda),
    -- así la opción por omisión nunca es una que no entrega en el destino
    v_opciones := tumbo_privado.cotizar_envio(s.seller_id, v_destino, v_items_s);
    select coalesce(jsonb_agg(o || jsonb_build_object('clave', coalesce(o ->> 'id', (o ->> 'tipo') || ':' || coalesce(o ->> 'courier', '')))
                              order by coalesce(o ->> 'en_destino', '') = 'false', coalesce(o ->> 'cobro_destino', '') = 'true', k), '[]'::jsonb)
      into v_opciones
    from jsonb_array_elements(case when jsonb_typeof(v_opciones) = 'array' then v_opciones else '[]'::jsonb end) with ordinality as x (o, k)
    where jsonb_typeof(o) = 'object' and o ->> 'tipo' = v_entrega and tumbo_privado.num_json(o -> 'costo_usd') >= 0;
    if jsonb_array_length(v_opciones) = 0 then
      raise exception '% no tiene envíos con esa modalidad para ese destino: elige otra dirección o el retiro en agencia.', s.nombre;
    end if;
    v_elegida := v_d -> 'envios' ->> s.seller_id;
    v_opc := null;
    select o into v_opc from jsonb_array_elements(v_opciones) o where o ->> 'clave' = v_elegida limit 1;
    if v_opc is null then
      v_opc := v_opciones -> 0;
    end if;
    v_envio := round(tumbo_privado.num_json(v_opc -> 'costo_usd'), 2);

    v_iva_s := round(greatest(v_gravado, 0) * v_iva / (100 + v_iva), 2);
    v_base_pago := v_prod - v_desc - v_desc_t + v_envio;
    v_cred := least(v_credito_rest, v_base_pago);
    v_credito_rest := v_credito_rest - v_cred;
    v_igtf_s := case when m.igtf then round((v_base_pago - v_cred) * v_igtf / 100, 2) else 0 end;
    v_pagar := v_base_pago - v_cred + v_igtf_s;

    v_sellers := v_sellers || jsonb_build_object(
      'seller_id', s.seller_id, 'nombre', s.nombre, 'items', v_items_s,
      'productos_usd', v_prod, 'descuento_usd', v_desc, 'descuento_tumbo_usd', v_desc_t,
      'opciones', v_opciones, 'envio', v_opc, 'envio_usd', v_envio,
      'envio_dias', coalesce((v_opc ->> 'dias_min') || '–' || (v_opc ->> 'dias_max') || ' días', v_opc ->> 'plazo'),
      'iva_usd', v_iva_s, 'exento_usd', round(v_exento, 2), 'igtf_usd', v_igtf_s, 'credito_usd', v_cred,
      'total_usd', v_pagar, 'pedido_usd', v_base_pago + v_igtf_s,
      'pedido_bs', round((v_base_pago + v_igtf_s) * cfg.tasa, 2), 'total_bs', round(v_pagar * cfg.tasa, 2));
    t_sub := t_sub + v_prod; t_desc := t_desc + v_desc + v_desc_t; t_env := t_env + v_envio; t_iva := t_iva + v_iva_s;
    t_igtf := t_igtf + v_igtf_s; t_cred := t_cred + v_cred; t_total := t_total + v_pagar; t_bs := t_bs + round(v_pagar * cfg.tasa, 2);
  end loop;

  return jsonb_build_object(
    'metodo', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'moneda', m.moneda, 'igtf', m.igtf, 'contra_entrega', m.contra_entrega),
    'entrega', v_entrega, 'destino', v_destino, 'fiscal', v_fiscal,
    'tasa', cfg.tasa, 'iva_pct', v_iva, 'igtf_pct', v_igtf,
    'sellers', v_sellers,
    'subtotal_usd', t_sub, 'descuento_usd', t_desc, 'envio_usd', t_env, 'iva_usd', t_iva, 'igtf_usd', t_igtf,
    'credito_usd', t_cred, 'credito_disponible', greatest(v_saldo, 0),
    'total_usd', t_total, 'total_bs', t_bs,
    'monto_esperado', case when m.moneda = 'VES' then t_bs else t_total end, 'moneda', m.moneda,
    'cupon', jsonb_build_object('codigo', v_cupon, 'aplicado', v_cupon is not null and v_mensaje_cupon is null, 'mensaje', v_mensaje_cupon),
    'promociones', case when jsonb_typeof(v_promo -> 'promociones') = 'array' then v_promo -> 'promociones' else '[]'::jsonb end,
    'checkout_activo', coalesce(tumbo_privado.ajuste('checkout_activo'), 'true'::jsonb) <> 'false'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Logística: el destinatario de una persona real y las cuentas de prueba
-- ---------------------------------------------------------------------------
-- Las cuentas de prueba (contraseña pública) de Operaciones y de la
-- superadministración no ven el destinatario ni el contacto de una persona
-- real (como en la bandeja, el KYC y los pagos): les llega como a un pedido
-- cerrado (ciudad y estado, nombre y teléfono enmascarados).

create or replace function tumbo_privado.destinatario_visible(p_yo tumbo.usuarios, v tumbo.pedidos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb := tumbo_privado.destinatario_pedido(v);
  v_activo boolean := v.estado in ('por_aceptar', 'preparando', 'listo', 'despachado');
  v_caso boolean := v.estado = 'devolucion'
    or exists (select 1 from tumbo.disputas x where x.pedido_id = v.id and x.estado <> 'resuelta');
begin
  if p_yo.id = v.comprador_id then
    return d || jsonb_build_object('oculto', false);
  end if;
  if (p_yo.rol in ('seller', 'operador') and p_yo.seller_id = v.seller_id and v_activo)
     or (p_yo.rol in ('ops', 'superadmin') and (v_activo or v_caso) and tumbo_privado.ve_comprador(p_yo, v.comprador_id)) then
    return d || jsonb_build_object('oculto', false);
  end if;
  if p_yo.rol in ('seller', 'operador', 'ops', 'superadmin') then
    return jsonb_build_object('oculto', true, 'ciudad', d ->> 'ciudad', 'estado', d ->> 'estado',
      'nombre', case when p_yo.rol in ('ops', 'superadmin') then left(d ->> 'nombre', 1) || '•••' end,
      'telefono', case when p_yo.rol in ('ops', 'superadmin') then tumbo_privado.ocultar(d ->> 'telefono', 4) end);
  end if;
  return null;
end $$;

create or replace function public.tm_envio_etiquetas(p_sesion text, p_ids text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- escribe en la auditoría: con la cuota de escrituras de la cuenta
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador', 'superadmin', 'ops']);
  v tumbo.pedidos;
  e tumbo.envios;
  c tumbo.envio_config;
  s tumbo.sellers;
  r jsonb := '[]'::jsonb;
  v_id text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Elige al menos un pedido.';
  end if;
  if cardinality(p_ids) > 50 then
    raise exception 'Imprime hasta 50 etiquetas por vez.';
  end if;
  foreach v_id in array p_ids loop
    select * into v from tumbo.pedidos where id = v_id;
    if not found or (yo.rol in ('seller', 'operador') and v.seller_id is distinct from yo.seller_id) then
      raise exception 'Pedido % no encontrado.', left(v_id, 30);
    end if;
    if v.estado not in ('preparando', 'listo', 'despachado') then
      raise exception 'El pedido % no está en preparación ni en camino: no lleva etiqueta.', v.id;
    end if;
    e := tumbo_privado.envio_asegurar(v.id);
    c := tumbo_privado.config_envio(v.seller_id);
    select * into s from tumbo.sellers where id = v.seller_id;
    r := r || jsonb_build_object(
      'id', v.id, 'referencia', e.referencia, 'guia', e.guia,
      'courier', (select k.nombre from tumbo.couriers k where k.codigo = e.courier), 'courier_codigo', e.courier,
      'servicio', e.servicio, 'tipo', e.tipo, 'retiro', e.retiro, 'cobro_destino', e.cobro_destino,
      'peso_kg', coalesce(v.peso, e.peso_kg),
      'unidades', (select coalesce(sum(i.cant), 0) from tumbo.pedido_items i where i.pedido_id = v.id),
      'destinatario', case when yo.rol in ('ops', 'superadmin') and not tumbo_privado.ve_comprador(yo, v.comprador_id)
                           then tumbo_privado.destinatario_visible(yo, v) else tumbo_privado.destinatario_pedido(v) end,
      'remitente', jsonb_build_object('nombre', s.nombre, 'id', s.id, 'ciudad', c.origen_ciudad, 'estado', c.origen_estado),
      'fecha_prometida', e.fecha_prometida, 'creado', v.creado);
  end loop;
  perform tumbo_privado.auditar(yo, 'Etiquetas impresas', array_to_string(p_ids[1:20], ', ') || case when cardinality(p_ids) > 20 then '…' else '' end);
  return r;
end $$;

create or replace function public.tm_pedido_360(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos;
  e tumbo.envios;
  u tumbo.usuarios;
  s tumbo.sellers;
  dv tumbo.devoluciones;
  d tumbo.disputas;
  v_activo boolean;
  v_linea jsonb;
  v_acciones text[] := '{}';
  v_ve boolean;
begin
  select * into v from tumbo.pedidos where id = p_id;
  if not found then
    raise exception 'Pedido % no encontrado.', left(coalesce(p_id, ''), 30);
  end if;
  e := tumbo_privado.envio_asegurar(v.id);
  select * into u from tumbo.usuarios where id = v.comprador_id;
  select * into s from tumbo.sellers where id = v.seller_id;
  select * into dv from tumbo.devoluciones where pedido_id = v.id;
  select * into d from tumbo.disputas where pedido_id = v.id;
  v_activo := v.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion') or (d.id is not null and d.estado <> 'resuelta');
  v_ve := tumbo_privado.ve_comprador(yo, v.comprador_id);

  select coalesce(jsonb_agg(x order by x ->> 'fecha', x ->> 'orden'), '[]'::jsonb) into v_linea from (
    select jsonb_build_object('fecha', pe.fecha, 'orden', 'a' || lpad(pe.id::text, 12, '0'), 'tipo', 'evento', 'actor', pe.actor,
                              'texto', pe.texto, 'icono', pe.icono, 'interno', false) as x
    from tumbo.pedido_eventos pe where pe.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', i.creado, 'orden', 'b' || lpad(i.id::text, 12, '0'), 'tipo', 'incidencia', 'actor', i.por,
             'texto', tumbo_privado.texto_incidencia(i.tipo) || ': ' || i.detalle || case when i.estado = 'resuelta' then ' · resuelta' ||
               coalesce(': ' || i.resolucion, '') else ' · abierta' end, 'icono', 'report', 'interno', not tumbo_privado.incidencia_publica(i.tipo),
             'id', i.id, 'estado', i.estado)
    from tumbo.incidencias i where i.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', n.creado, 'orden', 'c' || lpad(n.id::text, 12, '0'), 'tipo', 'nota', 'actor', n.autor,
                              'texto', n.texto, 'icono', 'sticky_note_2', 'interno', true)
    from tumbo.notas_pedido n where n.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', sc.decidido_en, 'orden', 'd' || lpad(sc.id::text, 12, '0'), 'tipo', 'solicitud',
             'actor', coalesce(sc.decidido_por, 'Sistema'), 'texto', 'Solicitud de cancelación ' ||
               case sc.estado when 'aprobada' then 'aprobada' when 'rechazada' then 'rechazada' when 'automatica' then 'aprobada sola por vencimiento'
                              else 'cerrada' end || coalesce(': ' || sc.respuesta, ''), 'icono', 'pending', 'interno', false)
    from tumbo.solicitudes_cancelacion sc where sc.pedido_id = v.id and sc.decidido_en is not null
    union all
    select jsonb_build_object('fecha', r.creado, 'orden', 'e' || lpad(r.id::text, 12, '0'), 'tipo', 'reembolso', 'actor', coalesce(r.por, 'Sistema'),
             'texto', 'Reembolso ' || r.estado || ' por ' || tumbo_privado.fmt_usd(r.monto_usd) || ' · ' || r.motivo, 'icono', 'undo', 'interno', true)
    from tumbo.reembolsos r where r.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', e.escalado_aceptar_en, 'orden', 'f1', 'tipo', 'sla', 'actor', 'Sistema',
             'texto', 'SLA de aceptación vencido: escalado a Operaciones', 'icono', 'alarm', 'interno', true)
    where e.escalado_aceptar_en is not null
    union all
    select jsonb_build_object('fecha', e.escalado_despacho_en, 'orden', 'f2', 'tipo', 'sla', 'actor', 'Sistema',
             'texto', 'Plazo de despacho vencido: escalado a Operaciones', 'icono', 'alarm', 'interno', true)
    where e.escalado_despacho_en is not null
    union all
    select jsonb_build_object('fecha', e.asignado_en, 'orden', 'f3', 'tipo', 'asignacion', 'actor', 'Operaciones',
             'texto', 'Responsable: ' || e.responsable, 'icono', 'person', 'interno', true)
    where e.asignado_en is not null
  ) y;

  -- con un reclamo abierto, la entrega y la cancelación por pérdida se
  -- deciden en Disputas (los fondos siguen congelados)
  if v.estado = 'despachado' then
    v_acciones := v_acciones || 'novedad'::text;
    if d.id is null or d.estado = 'resuelta' then v_acciones := v_acciones || array['confirmar_entrega', 'cancelar_perdida']; end if;
  end if;
  if v.estado = 'despachado' and e.retiro and e.courier <> 'tienda' and e.en_agencia_en is null then v_acciones := v_acciones || 'en_agencia'::text; end if;
  if v.estado in ('por_aceptar', 'preparando', 'listo') then v_acciones := v_acciones || 'cancelar'::text; end if;
  -- devolución: el reembolso, solo después de la inspección; «no llegó», solo
  -- si aún no se recibió
  if v.estado = 'devolucion' then
    v_acciones := v_acciones || array['devolucion_instrucciones', 'devolucion_inspeccionar'];
    if dv.estado = 'recibida' and dv.inspeccion is not null then v_acciones := v_acciones || 'devolucion_reembolsar'::text;
    else v_acciones := v_acciones || 'devolucion_no_llego'::text; end if;
  end if;
  if v.estado in ('preparando', 'listo', 'despachado') then v_acciones := v_acciones || 'etiqueta'::text; end if;
  v_acciones := v_acciones || array['nota', 'asignar'];

  return jsonb_build_object(
    'pedido', tumbo_privado.pedido_lectura_json(yo, v, to_jsonb(v) - 'comprador_id' - 'ref_clave' - 'ref_numero' - 'red' - 'destino') || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(i) - 'pedido_id' order by i.sku) from tumbo.pedido_items i where i.pedido_id = v.id), '[]'::jsonb),
      'bruto_usd', tumbo_privado.bruto_pedido(v.id)),
    'seller', jsonb_build_object('id', s.id, 'nombre', s.nombre, 'ciudad', s.ciudad, 'estado', s.estado),
    'comprador', jsonb_build_object('nombre', case when v_activo and v_ve then u.nombre else left(u.nombre, 1) || '•••' end,
      'email', case when v_activo and v_ve then u.email else tumbo_privado.ocultar(split_part(u.email, '@', 1), 2) || '@' || split_part(u.email, '@', 2) end,
      'telefono', case when v_activo and v_ve then u.telefono else tumbo_privado.ocultar(u.telefono, 4) end,
      'pedidos', (select count(*) from tumbo.pedidos x where x.comprador_id = v.comprador_id),
      'cancelados', (select count(*) from tumbo.pedidos x where x.comprador_id = v.comprador_id and x.estado = 'cancelado'),
      'reclamos', (select count(*) from tumbo.disputas x where x.comprador_id = v.comprador_id)),
    'destinatario', tumbo_privado.destinatario_visible(yo, v),
    'envio', tumbo_privado.envio_resumen(e, v) || jsonb_build_object('guia_foto', e.guia_foto, 'entrega_foto', e.entrega_foto,
      'entrega_nota', e.entrega_nota, 'entrega_por', e.entrega_por, 'despachado_por', e.despachado_por,
      'costo_cotizado_usd', e.costo_cotizado_usd, 'peso_kg', e.peso_kg, 'dias_min', e.dias_min, 'dias_max', e.dias_max,
      'responsable_id', e.responsable_id),
    'disputa', case when d.id is not null then jsonb_build_object('id', d.id, 'motivo', d.motivo, 'estado', d.estado, 'creado', d.creado) end,
    'devolucion', case when dv.pedido_id is not null then to_jsonb(dv) end,
    'incidencias', coalesce((select jsonb_agg(tumbo_privado.incidencia_json(i, true) order by i.creado desc)
                             from tumbo.incidencias i where i.pedido_id = v.id), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'autor', n.autor, 'texto', n.texto, 'creado', n.creado) order by n.creado desc)
                       from tumbo.notas_pedido n where n.pedido_id = v.id), '[]'::jsonb),
    'linea', v_linea,
    'acciones', to_jsonb(v_acciones),
    'responsables', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'rol', x.rol) order by x.nombre)
                              from tumbo.usuarios x where x.activo and x.rol in ('superadmin', 'ops')), '[]'::jsonb),
    'oficinas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'courier', o.courier, 'ciudad', o.ciudad, 'estado', o.estado)
                                           order by o.estado, o.nombre)
                          from tumbo.oficinas o where o.activa and (o.courier = e.courier or o.courier = dv.courier
                                                                     or o.estado = (tumbo_privado.config_envio(v.seller_id)).origen_estado)), '[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object('codigo', k.codigo, 'nombre', k.nombre, 'tipo', k.tipo) order by k.orden)
                          from tumbo.couriers k where k.activo), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: no hay funciones public.tm_* nuevas (las redefinidas
-- conservan los suyos); lo de tumbo_privado no se invoca desde la API.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

notify pgrst, 'reload schema';
