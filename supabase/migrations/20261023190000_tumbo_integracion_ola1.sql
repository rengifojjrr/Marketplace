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
-- liquidación).
--
-- Revisión de la integración (al final del archivo, antes de desplegar):
--   8. Un solo contrato de «real» (seller_real cuenta también las cuentas
--      dadas de baja; pedido_real) y las cuentas de prueba del equipo ya no
--      cambian un pedido real (bloquear_pedido), ni moderan los productos de
--      un comercio real, ni ven o suben sus archivos privados
--      (archivo_permitido); lo que mueve dinero de un pedido real (reclamo,
--      devolución, cancelación de Operaciones, entrega con prueba, cierre de
--      la ventana) pide una cuenta real con sesión elevada, y Operaciones
--      tiene la verificación en dos pasos obligatoria.
--   9. La ventana de reclamo se cierra sola al vencer (tarea_sla) y la de un
--      pedido real no se cierra a mano antes de tiempo.
--  10. Cancelar porque la unidad no existe la saca del inventario.
--  11. Pagos: el dinero tardío de un pago vencido sale una sola vez (pago
--      recibido tarde o la cola de excepciones); un pago que vuelve a
--      «pendiente» para corregir conserva su primer reporte y verificar
--      reembolsa y asienta con la misma regla; el envío que retiene Tumbo
--      (envio_al_seller false) se reclasifica al pagar la corrida.
--  12. El comprador figura como «Comprador» en los eventos de pagos y
--      reembolsos, y las cuentas de prueba no reciben su nombre (pago, 360,
--      reclamos) ni lo que escribió el equipo real.
--  13. La baja la impide un pago sin resolver y borra también el destino de
--      sus pedidos, los datos del pagador y su nombre en los historiales.
--  14. El reinicio de la demo no borra datos reales con una cuenta de
--      prueba (ni nunca las direcciones de las cuentas reales) y la
--      invitación de un comercio valida el dígito verificador del RIF.
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
-- una cuenta de prueba del equipo no ve el de una persona real), la
-- auditoría, por auditoria_visible (con una cuenta de prueba, solo lo
-- reciente de las cuentas de prueba y del sistema), y a una cuenta de
-- prueba del equipo el reclamo de una persona o un comercio real le llega
-- sin la descripción, la respuesta ni la evidencia.

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
                                          'portada_url', tumbo_privado.url_publica(s.portada),
                                          -- comercio real ante una cuenta de prueba del equipo: sin acciones (moderación, KYC)
                                          'bloqueado', v_demo and v_admin and tumbo_privado.seller_real(s.id)) order by s.id)
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
      -- a una cuenta de prueba del equipo, el reclamo de una persona o un
      -- comercio real llega sin sus textos ni su evidencia (y bloqueado)
      'disputas', coalesce((
        select jsonb_agg(case when v_demo and v_admin
                                   and (tumbo_privado.comprador_real(d.comprador_id) or tumbo_privado.seller_real(d.seller_id))
                              then (to_jsonb(d) - 'comprador_id' - 'descripcion' - 'evidencia' - 'respuesta_texto' - 'respuesta_evidencia' - 'resolucion_nota')
                                   || jsonb_build_object('mio', false, 'bloqueado', true, 'evidencia', '[]'::jsonb,
                                                         'descripcion', '(Reclamo de una persona o un comercio real: el detalle solo lo ve una cuenta real del equipo.)')
                              else (to_jsonb(d) - 'comprador_id') || jsonb_build_object('mio', d.comprador_id = v_uid) end
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
-- alguien conozca su id. Y una cuenta de prueba del equipo (contraseña
-- pública) solo sube o ve los archivos de los datos de la demo: ni la
-- evidencia, la guía o la entrega de un pedido de una persona o un comercio
-- real (la foto de la guía lleva el destinatario), ni el comprobante de pago
-- de una persona real, ni el comprobante de la liquidación de un comercio
-- real.

create or replace function tumbo_privado.archivo_permitido(p_yo tumbo.usuarios, p_proposito text, p_entidad text, p_accion text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ver boolean := p_accion = 'ver';
  v_demo boolean := coalesce(tumbo_privado.cuenta_demo(p_yo.email), false);
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
    v_ok := found and ((p_yo.rol in ('finanzas', 'superadmin') and (not v_demo or not tumbo_privado.seller_real(v_seller)))
                       or (v_ver and v_principal and p_yo.seller_id = v_seller));
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
      -- el equipo con una cuenta de prueba: solo los pedidos de la demo
      v_equipo := v_equipo and (not v_demo or not (tumbo_privado.comprador_real(v_comprador) or tumbo_privado.seller_real(v_seller)));
      v_ok := case p_proposito
        when 'evidencia' then p_yo.id = v_comprador or (v_principal and p_yo.seller_id = v_seller and v_seller_ve) or v_equipo
        when 'comprobante' then p_yo.id = v_comprador
                                or (v_ver and p_yo.rol in ('finanzas', 'superadmin') and (not v_demo or not tumbo_privado.comprador_real(v_comprador)))
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
-- cuelga de un pedido suyo (excedente o sin venta, con comprador_id), el
-- saldo a favor (crédito en Tumbo), que la baja dejaría sin dueña, y un
-- pago abierto (por pagar o reportado) o reportado que venció hace menos de
-- 60 días sin resolverse: su dinero puede estar en camino y, si un pedido
-- se canceló después del reporte, al verificarlo nace un reembolso que una
-- cuenta eliminada nunca podría recibir.

create or replace function tumbo_privado.baja_impedida(p_usuario uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from tumbo.pedidos where comprador_id = p_usuario
                 and estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'devolucion'))
      or exists (select 1 from tumbo.disputas where comprador_id = p_usuario and estado <> 'resuelta')
      then 'Hay pedidos o reclamos en curso: la cuenta se podrá eliminar cuando terminen.'
    when exists (select 1 from tumbo.pagos g where g.comprador_id = p_usuario
                 and (g.estado in ('pendiente', 'reportado')
                      or (g.estado = 'vencido' and g.reportado_el is not null and not g.tardio and g.vence > now() - interval '60 days')))
      then 'Hay un pago tuyo que Finanzas todavía no ha verificado: la cuenta se podrá eliminar cuando se resuelva (si tu dinero llegó, así se te puede devolver).'
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
-- En el detalle 360 de un pedido de una persona o un comercio real tampoco
-- les llega lo que escribió el equipo real (notas internas, detalle de las
-- novedades, de la devolución y de la respuesta del comercio, quién
-- despachó o entregó), las fotos de la guía y de la entrega, ni las
-- acciones (bloqueado: el servidor las rechaza); el comprador figura como
-- «Comprador» en la línea de tiempo y los responsables posibles son solo
-- las cuentas de prueba.

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
  v_privado boolean;
  v_demo boolean;
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
  v_demo := tumbo_privado.cuenta_demo(yo.email);
  -- una cuenta de prueba y el pedido de una persona o un comercio real: sin
  -- lo que escribió el equipo real (notas, detalle de las novedades y de la
  -- devolución, quién despachó o entregó), sin fotos y sin acciones
  v_privado := v_demo and tumbo_privado.pedido_real(v);

  select coalesce(jsonb_agg(x order by x ->> 'fecha', x ->> 'orden'), '[]'::jsonb) into v_linea from (
    select jsonb_build_object('fecha', pe.fecha, 'orden', 'a' || lpad(pe.id::text, 12, '0'), 'tipo', 'evento',
                              'actor', case when not v_ve and pe.actor = u.nombre then 'Comprador' else pe.actor end,
                              'texto', pe.texto, 'icono', pe.icono, 'interno', false) as x
    from tumbo.pedido_eventos pe where pe.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', i.creado, 'orden', 'b' || lpad(i.id::text, 12, '0'), 'tipo', 'incidencia', 'actor', i.por,
             'texto', tumbo_privado.texto_incidencia(i.tipo) || case when v_privado then '' else ': ' || i.detalle end ||
               case when i.estado = 'resuelta' then ' · resuelta' || case when v_privado then '' else coalesce(': ' || i.resolucion, '') end
                    else ' · abierta' end, 'icono', 'report', 'interno', not tumbo_privado.incidencia_publica(i.tipo),
             'id', i.id, 'estado', i.estado)
    from tumbo.incidencias i where i.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', n.creado, 'orden', 'c' || lpad(n.id::text, 12, '0'), 'tipo', 'nota', 'actor', n.autor,
                              'texto', n.texto, 'icono', 'sticky_note_2', 'interno', true)
    from tumbo.notas_pedido n where n.pedido_id = v.id and not v_privado
    union all
    select jsonb_build_object('fecha', sc.decidido_en, 'orden', 'd' || lpad(sc.id::text, 12, '0'), 'tipo', 'solicitud',
             'actor', coalesce(sc.decidido_por, 'Sistema'), 'texto', 'Solicitud de cancelación ' ||
               case sc.estado when 'aprobada' then 'aprobada' when 'rechazada' then 'rechazada' when 'automatica' then 'aprobada sola por vencimiento'
                              else 'cerrada' end || case when v_privado then '' else coalesce(': ' || sc.respuesta, '') end,
             'icono', 'pending', 'interno', false)
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
             'texto', case when v_privado then 'Responsable asignado' else 'Responsable: ' || e.responsable end, 'icono', 'person', 'interno', true)
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
  if v_privado then
    v_acciones := '{}';
  end if;

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
    'envio', tumbo_privado.envio_resumen(e, v) || jsonb_build_object(
      'guia_foto', case when not v_privado then e.guia_foto end, 'entrega_foto', case when not v_privado then e.entrega_foto end,
      'entrega_nota', case when not v_privado then e.entrega_nota end, 'entrega_por', case when not v_privado then e.entrega_por end,
      'despachado_por', case when not v_privado then e.despachado_por end,
      'costo_cotizado_usd', e.costo_cotizado_usd, 'peso_kg', e.peso_kg, 'dias_min', e.dias_min, 'dias_max', e.dias_max,
      'responsable_id', case when not v_privado then e.responsable_id end),
    'disputa', case when d.id is not null then jsonb_build_object('id', d.id, 'motivo', d.motivo, 'estado', d.estado, 'creado', d.creado) end,
    'devolucion', case when dv.pedido_id is null then null
                       when v_privado then jsonb_build_object('pedido_id', dv.pedido_id, 'estado', dv.estado, 'paga', dv.paga,
                                                              'inspeccion', dv.inspeccion, 'oculto', true)
                       else to_jsonb(dv) end,
    'incidencias', coalesce((select jsonb_agg(tumbo_privado.incidencia_json(i, not v_privado) order by i.creado desc)
                             from tumbo.incidencias i where i.pedido_id = v.id), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'autor', n.autor, 'texto', n.texto, 'creado', n.creado) order by n.creado desc)
                       from tumbo.notas_pedido n where n.pedido_id = v.id and not v_privado), '[]'::jsonb),
    'bloqueado', v_privado,
    'linea', v_linea,
    'acciones', to_jsonb(v_acciones),
    'responsables', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'rol', x.rol) order by x.nombre)
                              from tumbo.usuarios x where x.activo and x.rol in ('superadmin', 'ops')
                                and (not v_demo or tumbo_privado.cuenta_demo(x.email))), '[]'::jsonb),
    'oficinas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'courier', o.courier, 'ciudad', o.ciudad, 'estado', o.estado)
                                           order by o.estado, o.nombre)
                          from tumbo.oficinas o where o.activa and (o.courier = e.courier or o.courier = dv.courier
                                                                     or o.estado = (tumbo_privado.config_envio(v.seller_id)).origen_estado)), '[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object('codigo', k.codigo, 'nombre', k.nombre, 'tipo', k.tipo) order by k.orden)
                          from tumbo.couriers k where k.activo), '[]'::jsonb));
end $$;

-- =========================================================================
-- Revisión de la integración: lo que se corrigió antes de desplegar
-- =========================================================================
-- Los revisores probaron el sistema integrado y encontraron dónde una
-- cuenta de prueba (contraseña pública) todavía tocaba datos de personas y
-- comercios reales, dos caminos por los que el mismo dinero salía dos veces,
-- reglas que quedaban sin cumplir (la ventana de reclamo no se cerraba
-- sola, una unidad inexistente volvía a la venta) y datos personales que la
-- baja no borraba. Cada función parte de su última definición (la de esta
-- migración, si ya estaba aquí) y su comentario dice qué cambió.

-- ---------------------------------------------------------------------------
-- Contrato único de «real» para el dinero y el control (Pagos + Catálogo)
-- ---------------------------------------------------------------------------
-- Desde la de Pagos: un comercio es real para el dinero si alguna vez tuvo
-- una cuenta real (activa, bloqueada o dada de baja). Antes bastaba con dar
-- de baja a su seller principal (anonimizar_cuenta lo desactiva) para que
-- Pagos lo tratara como uno de prueba. Relación con comercio_de_prueba
-- (Catálogo, para la privacidad: lo es si tiene alguna cuenta de prueba o
-- ninguna real): un comercio que no es de prueba siempre es real; uno con
-- cuentas reales y de prueba es real para el dinero y de prueba para la
-- privacidad (sus cuentas de prueba ya ven todo lo suyo).
create or replace function tumbo_privado.seller_real(p_seller text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.usuarios u
                 where u.seller_id = p_seller and not tumbo_privado.cuenta_demo(u.email))
$$;

-- ¿Es el pedido de una persona o de un comercio real?
create function tumbo_privado.pedido_real(v tumbo.pedidos) returns boolean
language sql stable security definer set search_path = '' as $$
  select tumbo_privado.comprador_real(v.comprador_id) or tumbo_privado.seller_real(v.seller_id)
$$;

-- Sobre los datos de una persona o un comercio real, una cuenta de prueba
-- no actúa (como exigir_si_real, sin pedir sesión elevada a las cuentas
-- reales: para el control que no mueve dinero, p. ej. notas, incidencias o
-- la moderación).
create function tumbo_privado.exigir_cuenta_real(p_yo tumbo.usuarios, p_real boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(p_real, true) and p_yo.id is not null and tumbo_privado.cuenta_demo(p_yo.email) then
    raise exception 'Es de una persona o un comercio real: las cuentas de prueba solo actúan sobre los datos de la demo (hace falta una cuenta real del equipo).'
      using errcode = '42501';
  end if;
end $$;

-- Desde la del núcleo (migración 2): el equipo (superadmin, ops, finanzas)
-- con una cuenta de prueba solo bloquea, y por lo tanto solo cambia, los
-- pedidos de la demo. Lo usan todas las escrituras sobre un pedido
-- (cancelaciones, entrega, devoluciones, incidencias, notas, asignación,
-- ventana de reclamo…); las que mueven dinero piden además la sesión
-- elevada de las cuentas reales (exigir_si_real).
create or replace function tumbo_privado.bloquear_pedido(p_id text, p_yo tumbo.usuarios) returns tumbo.pedidos
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
  if p_yo.rol in ('superadmin', 'ops', 'finanzas') then
    perform tumbo_privado.exigir_cuenta_real(p_yo, tumbo_privado.pedido_real(v));
  end if;
  return v;
end $$;

-- Desde la de Cuentas: Operaciones también tiene la verificación en dos
-- pasos obligatoria para lo sensible (cancela con reembolso, resuelve
-- reclamos, confirma entregas y cambia la configuración de envíos, p. ej.
-- el enlace de rastreo que ven todos los compradores). Sin ella,
-- exigir_elevada no le pedía nada.
create or replace function tumbo_privado.rol_obliga_2fa(p_rol text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_rol in ('superadmin', 'finanzas', 'seller', 'ops'), false)
$$;

-- ---------------------------------------------------------------------------
-- Ventana de reclamo
-- ---------------------------------------------------------------------------
-- Cierra la ventana de un pedido entregado (quien llama lo tiene bloqueado):
-- fondos elegibles para la liquidación.
create function tumbo_privado.cerrar_ventana_interna(p_yo tumbo.usuarios, v tumbo.pedidos, p_texto text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = v.id;
  perform tumbo_privado.evento(v.id, 'Sistema', p_texto, 'lock_open');
  perform tumbo_privado.notificar('seller:' || v.seller_id,
    'La ventana de reclamo de ' || v.id || ' se cerró sin casos: fondos elegibles para tu próxima liquidación', 'lock_open', 'seller/finanzas.html');
  perform tumbo_privado.auditar(p_yo, 'Cierre de ventana de reclamo', v.id || case when p_yo.id is null then ' (vencida)' else '' end);
end $$;

-- Desde la del núcleo (migración 2): la ventana del pedido de una persona
-- o un comercio real solo se cierra a mano cuando ya venció (antes, el
-- comprador conserva su derecho a reclamar; la tarea de SLA la cierra sola
-- al vencer) y con la sesión elevada de una cuenta real. En los pedidos de
-- la demo se puede cerrar antes, para avanzar el recorrido.
create or replace function public.tm_cerrar_ventana(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  cfg tumbo.config;
  v_vence timestamptz;
begin
  if v.estado <> 'entregado' or v.liquidacion is distinct from 'retenido' then
    raise exception 'El pedido % no tiene una ventana de reclamo abierta.', p_id;
  end if;
  select * into cfg from tumbo.config;
  v_vence := v.entregado_el + make_interval(days => cfg.ventana_reclamo_dias);
  if tumbo_privado.pedido_real(v) then
    if v_vence > now() then
      raise exception 'La ventana de reclamo de % sigue abierta hasta el %: se cierra sola al vencer (el comprador conserva su plazo para reclamar).',
        p_id, to_char(v_vence at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI');
    end if;
    perform tumbo_privado.exigir_si_real(yo, true);
  end if;
  perform tumbo_privado.cerrar_ventana_interna(yo, v, 'Ventana de reclamo cerrada sin casos · fondos elegibles');
end $$;

-- ---------------------------------------------------------------------------
-- Dinero de un pedido real: solo una cuenta real con sesión elevada
-- ---------------------------------------------------------------------------
-- Desde la de fundaciones: el reclamo de una persona real o contra un
-- comercio real lo decide una cuenta real del equipo con sesión elevada
-- (las cuentas de prueba, solo los de la demo; bloquear_pedido). Los
-- textos ya no dicen «demo»: el reembolso es real (crear_reembolso de
-- Pagos) y la devolución la coordina Operaciones.
create or replace function public.tm_resolver_disputa(p_sesion text, p_id text, p_decision text, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d tumbo.disputas;
  v tumbo.pedidos;
  v_nota text := left(trim(coalesce(p_nota, '')), 500);
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found then raise exception 'Disputa % no encontrada.', p_id; end if;
  if d.estado = 'resuelta' then raise exception 'La disputa % ya está resuelta.', p_id; end if;
  if p_decision is null or p_decision not in ('reembolso', 'devolucion', 'liberar') then
    raise exception 'Decisión inválida.';
  end if;
  v := tumbo_privado.bloquear_pedido(d.pedido_id, yo);
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.pedido_real(v));

  update tumbo.disputas
  set estado = 'resuelta', resolucion_decision = p_decision, resolucion_nota = v_nota, resolucion_fecha = now()
  where id = p_id;

  if p_decision = 'reembolso' then
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta a favor del comprador · reembolso total en cola', 'undo');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue aprobado: el reembolso está en proceso', 'undo', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con reembolso al comprador', 'gavel', 'seller/disputas.html');
    perform tumbo_privado.crear_reembolso(d.pedido_id,
      tumbo_privado.bruto_pedido(d.pedido_id) + (select p.costo_envio_usd from tumbo.pedidos p where p.id = d.pedido_id),
      'Reclamo ' || p_id || ' resuelto con reembolso');
  elsif p_decision = 'devolucion' then
    update tumbo.pedidos set estado = 'devolucion' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta: devolución del producto · Operaciones envía las instrucciones', 'assignment_return');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ': coordinaremos la devolución del producto', 'assignment_return', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con devolución', 'assignment_return', 'seller/disputas.html');
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa cerrada a favor del seller · fondos liberados', 'lock_open');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue revisado y cerrado sin reembolso', 'gavel', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Resolución de disputa', p_id || ' → ' || p_decision);
end $$;

-- Desde la de Logística: el reembolso (o los fondos al comercio) de un
-- pedido real lo decide una cuenta real con sesión elevada
-- (exigir_si_real; las cuentas de prueba ya no bloquean ese pedido).
create or replace function public.tm_cerrar_devolucion(p_sesion text, p_id text, p_recibida boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  dv tumbo.devoluciones;
  v_reponer boolean;
begin
  if v.estado <> 'devolucion' then
    raise exception 'El pedido % no tiene una devolución en curso.', p_id;
  end if;
  if p_recibida is null then
    raise exception 'Indica si el producto volvió.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.pedido_real(v));
  perform tumbo_privado.devolucion_crear(p_id);
  select * into dv from tumbo.devoluciones where pedido_id = p_id for update;
  if p_recibida and (dv.estado is distinct from 'recibida' or dv.inspeccion is null) then
    raise exception 'Antes de reembolsar registra la inspección de la devolución de % (cómo llegó el producto) en el detalle del pedido.', p_id;
  end if;
  if not p_recibida and dv.estado = 'recibida' then
    raise exception 'La devolución de % ya se recibió e inspeccionó: ciérrala con el reembolso.', p_id;
  end if;
  v_reponer := dv.inspeccion = 'apto';
  if p_recibida then
    perform tumbo_privado.bloquear_stock(p_id);
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = p_id;
    if v_reponer then
      update tumbo.productos p set stock_fis = p.stock_fis + i.cant, actualizado = now()
      from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
    end if;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'Devolución recibida · reembolso al comprador en cola' ||
      case when v_reponer then ' y stock repuesto' else ' (producto ' || case dv.inspeccion when 'danado' then 'dañado' else 'incompleto' end ||
                                  ': el stock no se repone)' end, 'undo');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Recibimos la devolución de ' || p_id || ': reembolso en proceso', 'undo', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id ||
      case when v_reponer then ' volvió a tu inventario' else ' llegó ' || case dv.inspeccion when 'danado' then 'dañada' else 'incompleta' end end ||
      '; el pedido se reembolsó', 'assignment_return', 'seller/disputas.html');
    perform tumbo_privado.crear_reembolso(p_id, tumbo_privado.bruto_pedido(p_id) + v.costo_envio_usd,
      'Devolución recibida del pedido ' || p_id);
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = p_id;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'El producto no se devolvió en el plazo · fondos liberados al seller', 'lock_open');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'La devolución de ' || p_id || ' se cerró: el producto no llegó en el plazo', 'gavel', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  update tumbo.devoluciones set estado = 'cerrada', cerrada_en = now(), actualizado = now() where pedido_id = p_id;
  perform tumbo_privado.auditar(yo, 'Cierre de devolución', p_id || ' → ' ||
    case when p_recibida then 'recibida (' || dv.inspeccion || '), reembolso' || case when v_reponer then '' else ' sin reponer stock' end
         else 'no recibida, fondos al seller' end);
end $$;

-- Desde la de Logística: cancelar con reembolso el pedido de una persona o
-- un comercio real pide una cuenta real con sesión elevada.
create or replace function public.tm_cancelar_ops(p_sesion text, p_id text, p_motivo text, p_detalle text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_detalle text := nullif(btrim(coalesce(p_detalle, '')), '');
begin
  if p_motivo is null or p_motivo not in ('fraude', 'quiebre_stock', 'direccion_imposible', 'perdida_courier') then
    raise exception 'Elige el motivo de la cancelación.';
  end if;
  if char_length(coalesce(v_detalle, '')) < 5 then
    raise exception 'Deja el detalle de la cancelación (al menos 5 caracteres): queda en la auditoría.';
  end if;
  if p_motivo = 'perdida_courier' then
    if v.estado <> 'despachado' then
      raise exception 'La pérdida en el courier aplica a un pedido despachado.';
    end if;
  elsif v.estado not in ('por_aceptar', 'preparando', 'listo') then
    raise exception 'El pedido % ya no se puede cancelar por ese motivo.', p_id;
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.pedido_real(v));
  perform tumbo_privado.cancelar_logistica(yo, v, 'ops', p_motivo, v_detalle);
end $$;

-- Desde la de Logística: confirmar sin el comprador la entrega de un pedido
-- real (abre la ventana y retiene los fondos) pide una cuenta real con
-- sesión elevada.
create or replace function public.tm_entrega_confirmar(p_sesion text, p_id text, p_foto uuid, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 300), '');
begin
  if v.estado <> 'despachado' then
    raise exception 'El pedido % no está en camino.', p_id;
  end if;
  if tumbo_privado.disputa_abierta(p_id) is not null then
    raise exception 'El pedido % tiene abierto el reclamo %: resuélvelo desde Disputas (si el paquete llegó, liberando los fondos).',
      p_id, tumbo_privado.disputa_abierta(p_id);
  end if;
  if p_foto is null or not exists (select 1 from tumbo.archivos a where a.id = p_foto and a.proposito = 'entrega'
                                    and a.entidad = p_id and a.estado = 'listo') then
    raise exception 'Adjunta la foto de la prueba de entrega del courier.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.pedido_real(v));
  perform tumbo_privado.envio_asegurar(p_id);
  update tumbo.envios set entrega_foto = p_foto, entrega_nota = v_nota, entrega_por = yo.nombre || ' (' || yo.rol || ')'
  where pedido_id = p_id;
  perform tumbo_privado.confirmar_entrega_interna(yo, v, 'Operaciones (prueba del courier)', 'Entrega confirmada con la prueba del courier');
end $$;

-- ---------------------------------------------------------------------------
-- Moderación: los productos de un comercio real
-- ---------------------------------------------------------------------------
-- Desde la de Catálogo: una cuenta de prueba no aprueba ni rechaza los
-- productos de un comercio real (el uno a uno y el lote pasan por aquí).
create or replace function tumbo_privado.moderar_producto(p_yo tumbo.usuarios, p_sku text, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := p_yo;
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.seller_real(v.seller_id));
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
-- Cancelación sin la unidad: sale del inventario
-- ---------------------------------------------------------------------------
-- Desde la de Logística: con los motivos que dicen que la unidad no existe
-- (sin stock, producto dañado, quiebre de stock) la cancelación también la
-- saca del stock físico (ajuste en el kardex con el pedido), en vez de
-- devolverla a la venta y avisar a los compradores que «volvió a estar
-- disponible».
create or replace function tumbo_privado.cancelar_logistica(p_yo tumbo.usuarios, v tumbo.pedidos, p_por text, p_motivo text, p_detalle text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reembolso bigint;
  v_culpa boolean := p_motivo in ('sin_stock', 'producto_danado', 'no_cubre_destino', 'quiebre_stock', 'sin_aceptar');
  v_actor text := case p_por when 'seller' then 'Comercio' when 'ops' then 'Operaciones' when 'sistema' then 'Sistema' else 'Comprador' end;
  v_quien text := case p_por when 'seller' then 'por el comercio' when 'ops' then 'por Operaciones'
                             when 'sistema' then 'automáticamente' else 'por el comprador' end;
  v_texto text := tumbo_privado.texto_motivo(p_motivo);
  v_desc text;
  v_disp text := tumbo_privado.disputa_abierta(v.id);
  v_falta boolean := p_motivo in ('sin_stock', 'producto_danado', 'quiebre_stock');
begin
  -- con un reclamo abierto, el reembolso lo decide el reclamo (si no, se
  -- reembolsaría dos veces al resolverlo)
  if v_disp is not null then
    raise exception 'El pedido % tiene abierto el reclamo %: resuélvelo desde Disputas (con reembolso si corresponde) en vez de cancelarlo.', v.id, v_disp;
  end if;
  v_desc := case when p_motivo = 'solicitud_comprador' and p_por = 'sistema' then 'a pedido del comprador (el comercio no respondió a tiempo)'
                 when p_motivo = 'solicitud_comprador' then 'a pedido del comprador (aprobado por el comercio)'
                 else v_quien || ' (' || v_texto || ')' end;
  perform tumbo_privado.bloquear_stock(v.id);
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = v.id;
  if v.estado <> 'despachado' and v_falta then
    -- la unidad no existe (sin stock, dañada, quiebre): sale del stock
    -- físico con la reserva, queda en el kardex como ajuste y no vuelve a la
    -- venta (ni avisa «volvió a estar disponible»)
    perform tumbo_privado.contexto_stock('ajuste', 'Cancelación ' || v_quien || ': ' || lower(v_texto), v.id,
                                         coalesce(p_yo.nombre || ' (' || p_yo.rol || ')', 'Sistema'));
    update tumbo.productos p
    set stock_fis = greatest(0, p.stock_fis - i.cant), stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
    perform tumbo_privado.contexto_stock(null, null, null, null);
  elsif v.estado <> 'despachado' then
    update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
  end if;
  if v.estado <> 'pago_por_verificar' then
    v_reembolso := tumbo_privado.crear_reembolso(v.id, tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd,
      'Cancelación del pedido ' || v.id || ' ' || v_desc);
  end if;
  insert into tumbo.cancelaciones (pedido_id, seller_id, por, motivo, culpa_seller, detalle, estado_previo, reembolso_id, actor)
  values (v.id, v.seller_id, p_por, p_motivo, v_culpa, left(p_detalle, 300), v.estado, v_reembolso,
          coalesce(p_yo.nombre || ' (' || p_yo.rol || ')', 'Sistema'));
  perform tumbo_privado.evento(v.id, v_actor, 'Pedido cancelado ' || v_desc ||
    case when v.estado = 'despachado' then '' when v_falta then ' · la unidad sale del inventario' else ' · stock liberado' end ||
    case when v_reembolso is not null then ' y reembolso en cola' else '' end, 'cancel');
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Tu pedido ' || v.id || ' se canceló (' || v_texto || ')' ||
    case when v_reembolso is not null then ': el reembolso quedó en cola' else '' end, 'cancel', 'tienda/pedido.html?id=' || v.id);
  if p_por <> 'seller' then
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'El pedido ' || v.id || ' se canceló ' || v_desc,
      'cancel', 'seller/pedido.html?id=' || v.id, array['seller', 'operador']);
  end if;
  perform tumbo_privado.auditar(p_yo, case when p_motivo = 'solicitud_comprador' then 'Cancelación a pedido del comprador' else 'Cancelación ' || v_quien end,
    v.id || ' · ' || v_texto || coalesce(' · ' || left(p_detalle, 120), ''));
end $$;

-- ---------------------------------------------------------------------------
-- Ventanas de reclamo vencidas: se cierran solas
-- ---------------------------------------------------------------------------
-- Desde la de Logística: además cierra las ventanas de reclamo vencidas
-- (entregado y retenido, sin reclamo abierto, pasados los días de
-- ventana_reclamo_dias desde la entrega): los fondos pasan a elegibles y
-- el calendario de liquidaciones los paga. Antes solo lo hacía
-- tm_cerrar_ventana a mano y, tras la autoconfirmación, el dinero quedaba
-- retenido para siempre.
create or replace function tumbo_privado.tarea_sla() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_recordar interval := make_interval(hours => tumbo_privado.logistica('recordar_horas', 6)::integer);
  v_cancelar interval := make_interval(hours => tumbo_privado.logistica('cancelar_horas', 48)::integer);
  v_aviso interval := make_interval(days => tumbo_privado.logistica('aviso_autoconfirmar_dias', 2)::integer);
  v tumbo.pedidos;
  e tumbo.envios;
  s tumbo.solicitudes_cancelacion;
  n_rec integer := 0;
  n_esc integer := 0;
  n_esc_d integer := 0;
  n_can integer := 0;
  n_sol integer := 0;
  n_avi integer := 0;
  n_con integer := 0;
  n_ven integer := 0;
  n_err integer := 0;
  v_ventana interval := make_interval(days => (select c.ventana_reclamo_dias from tumbo.config c limit 1));
  r jsonb;
begin
  perform tumbo_privado.envio_asegurar(p.id) from tumbo.pedidos p
  where p.estado in ('por_aceptar', 'preparando', 'listo', 'despachado')
    and not exists (select 1 from tumbo.envios x where x.pedido_id = p.id);

  -- 1) recordatorio al comercio
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'por_aceptar' and x.recordado_en is null and x.aceptar_antes - v_recordar <= now() and x.aceptar_antes > now()
           order by x.aceptar_antes limit 100 loop
    begin
      update tumbo.envios set recordado_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('seller:' || e.seller_id, 'El pedido ' || e.pedido_id || ' vence pronto: acéptalo antes de ' ||
        tumbo_privado.fecha_hora_ve(e.aceptar_antes), 'alarm', 'seller/pedido.html?id=' || e.pedido_id, array['seller', 'operador']);
      n_rec := n_rec + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 2) escalado de la aceptación vencida
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'por_aceptar' and x.escalado_aceptar_en is null and x.aceptar_antes <= now()
           order by x.aceptar_antes limit 100 loop
    begin
      update tumbo.envios set escalado_aceptar_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('rol:ops', 'El pedido ' || e.pedido_id || ' (' || e.seller_id || ') lleva más de ' ||
        tumbo_privado.logistica('aceptar_horas', 24) || ' h sin aceptar', 'alarm', 'admin/pedido.html?id=' || e.pedido_id);
      perform tumbo_privado.notificar('seller:' || e.seller_id, 'Venció el plazo para aceptar ' || e.pedido_id ||
        ': si no lo aceptas, se cancelará con reembolso', 'alarm', 'seller/pedido.html?id=' || e.pedido_id, array['seller', 'operador']);
      n_esc := n_esc + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 3) escalado del despacho vencido
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado in ('preparando', 'listo') and x.escalado_despacho_en is null and x.despachar_antes <= now()
           order by x.despachar_antes limit 100 loop
    begin
      update tumbo.envios set escalado_despacho_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('rol:ops', 'El pedido ' || e.pedido_id || ' (' || e.seller_id || ') pasó su plazo de despacho',
        'alarm', 'admin/pedido.html?id=' || e.pedido_id);
      perform tumbo_privado.notificar('seller:' || e.seller_id, 'El pedido ' || e.pedido_id || ' pasó su plazo de despacho: despáchalo cuanto antes',
        'alarm', 'seller/pedido.html?id=' || e.pedido_id, array['seller', 'operador']);
      n_esc_d := n_esc_d + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 4) cancelación de los que nadie aceptó a tiempo (con reembolso)
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'por_aceptar' and coalesce(x.conciliado_en, x.creado) + v_cancelar <= now()
           order by x.conciliado_en limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = e.pedido_id and estado = 'por_aceptar' for update skip locked;
      if found then
        perform tumbo_privado.cancelar_logistica(null, v, 'sistema', 'sin_aceptar',
          'Sin aceptar ' || tumbo_privado.logistica('cancelar_horas', 48) || ' h después de conciliar el pago');
        n_can := n_can + 1;
      end if;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 5) solicitudes de cancelación sin respuesta: se aprueban solas
  for s in select x.* from tumbo.solicitudes_cancelacion x where x.estado = 'pendiente' and x.vence <= now() order by x.vence limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = s.pedido_id for update skip locked;
      if found then
        if v.estado in ('preparando', 'listo') then
          update tumbo.solicitudes_cancelacion set estado = 'automatica', decidido_en = now(), decidido_por = 'Sistema',
            respuesta = 'Aprobada sola: el comercio no respondió a tiempo.' where id = s.id;
          perform tumbo_privado.cancelar_logistica(null, v, 'sistema', 'solicitud_comprador', coalesce(s.motivo, 'Solicitud sin respuesta del comercio'));
        else
          update tumbo.solicitudes_cancelacion set estado = 'cerrada', decidido_en = now(), decidido_por = 'Sistema' where id = s.id;
        end if;
        n_sol := n_sol + 1;
      end if;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 6) aviso previo a la autoconfirmación
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'despachado' and p.disputa_id is null and x.aviso_autoconfirmar_en is null
             and x.autoconfirmar_el - v_aviso <= now() and x.autoconfirmar_el > now()
           order by x.autoconfirmar_el limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = e.pedido_id;
      update tumbo.envios set aviso_autoconfirmar_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Si ya recibiste tu pedido ' || v.id || ', confírmalo; si hay un problema, ' ||
        'repórtalo antes del ' || tumbo_privado.fecha_hora_ve(e.autoconfirmar_el) || ': después se dará por recibido', 'schedule',
        'tienda/pedido.html?id=' || v.id);
      n_avi := n_avi + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 7) autoconfirmación (sin reclamo ni incidencias graves abiertas)
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'despachado' and p.disputa_id is null and x.autoconfirmar_el <= now()
             and not exists (select 1 from tumbo.incidencias i where i.pedido_id = x.pedido_id and i.estado = 'abierta'
                             and i.tipo in ('perdida', 'dano_courier', 'direccion_incorrecta', 'courier_no_retiro'))
           order by x.autoconfirmar_el limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = e.pedido_id and estado = 'despachado' and disputa_id is null for update skip locked;
      if found then
        update tumbo.envios set entrega_por = 'Sistema (autoconfirmación)' where pedido_id = v.id;
        perform tumbo_privado.confirmar_entrega_interna(null, v, 'Sistema',
          'Entrega confirmada automáticamente: el comprador no la confirmó ni reportó un problema a tiempo');
        n_con := n_con + 1;
      end if;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 8) cierre de las ventanas de reclamo vencidas sin reclamo: los fondos
  -- pasan a elegibles y entran en el calendario de liquidaciones
  for v in select p.* from tumbo.pedidos p
           where p.estado = 'entregado' and p.liquidacion = 'retenido' and p.entregado_el + v_ventana <= now()
             and tumbo_privado.disputa_abierta(p.id) is null
           order by p.entregado_el, p.id limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = v.id and estado = 'entregado' and liquidacion = 'retenido' for update skip locked;
      if found then
        perform tumbo_privado.cerrar_ventana_interna(null, v, 'Ventana de reclamo vencida sin casos · fondos elegibles');
        n_ven := n_ven + 1;
      end if;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  r := jsonb_build_object('recordatorios', n_rec, 'escalados_aceptar', n_esc, 'escalados_despacho', n_esc_d, 'cancelados', n_can,
                          'solicitudes', n_sol, 'avisos_autoconfirmacion', n_avi, 'autoconfirmados', n_con,
                          'ventanas_cerradas', n_ven, 'errores', n_err);
  insert into tumbo.tareas_registro (tarea, ultima, resumen) values ('sla', now(), r)
  on conflict (tarea) do update set ultima = excluded.ultima, resumen = excluded.resumen;
  if n_can + n_sol + n_con + n_ven > 0 then
    perform tumbo_privado.auditar(null, 'Revisión de SLA', r::text);
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Pago vencido: el dinero tardío es un solo hecho
-- ---------------------------------------------------------------------------
-- El reembolso con el que se devolvió cada movimiento del banco (lo usan
-- tm_conciliacion_resolver y tm_pago_tardio para no devolver dos veces el
-- mismo dinero).
alter table tumbo.movimientos_banco add column reembolso_id bigint;

-- Desde la de Pagos: el dinero tardío de un pago vencido es un solo hecho,
-- lo registre «pago recibido tarde» o la cola de excepciones de la
-- conciliación. Aquí no se acepta si ese dinero ya se devolvió desde la
-- conciliación (un movimiento reembolsado o un reembolso sin venta del
-- pago), y al reembolsar se cierra con este reembolso el movimiento del
-- banco que esperaba en la cola como «pago vencido» (si ya llegó).
create or replace function public.tm_pago_tardio(p_sesion text, p_id text, p_accion text, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_nota text := left(nullif(trim(coalesce(p_nota, '')), ''), 200);
  v_pago text := tumbo_privado.pago_de(p_id);
  g tumbo.pagos;
  g2 tumbo.pagos;
  r record;
  x tumbo.pedidos;
  v_usd numeric;
  v_pedido text;
  v_reemb bigint;
begin
  if p_accion is null or p_accion not in ('verificar', 'reembolsar') then
    raise exception 'Indica si se verifica (con stock) o se reembolsa.';
  end if;
  if v_pago is null then
    raise exception 'El pedido % es de antes de los pagos guiados: no admite pago tardío.', p_id;
  end if;
  -- (orden de bloqueos: el comprador antes que el pago, como el checkout)
  perform tumbo_privado.bloquear_usuario((select comprador_id from tumbo.pagos where id = v_pago), 'carrito');
  select * into g from tumbo.pagos where id = v_pago for update;
  if g.estado <> 'vencido' then
    raise exception 'Solo un pago vencido se puede recibir tarde.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(g.comprador_id));
  if g.tardio then
    raise exception 'El dinero tardío de este pago ya se registró.';
  end if;
  if exists (select 1 from tumbo.movimientos_banco mb where mb.pago_id = g.id and mb.estado = 'reembolsado')
     or exists (select 1 from tumbo.reembolsos rb where rb.pago_id = g.id and rb.tipo = 'sin_venta') then
    raise exception 'El dinero de este pago ya se devolvió desde la conciliación (movimiento reembolsado): no se recibe tarde otra vez.';
  end if;
  if p_accion = 'reembolsar' then
    if v_nota is null or char_length(v_nota) < 5 then
      raise exception 'Escribe una nota que diga dónde viste el dinero (queda en la auditoría).';
    end if;
    -- lo que el comprador pagó: lo que el pago cubría cuando lo reportó (o
    -- al vencer, si no lo reportó)
    g2 := g;
    g2.estado := case when g.reportado_el is null then 'pendiente' else 'reportado' end;
    g2.tardio := true;
    v_usd := (tumbo_privado.pago_esperado(g2) ->> 'usd')::numeric;
    if coalesce(v_usd, 0) <= 0 then
      raise exception 'Este pago no tenía dinero por recibir.';
    end if;
    select y.id into v_pedido from tumbo_privado.pedidos_del_pago(g2) y order by y.id limit 1;
    v_reemb := tumbo_privado.crear_reembolso_interno(v_pedido, v_usd,
      'Dinero recibido tarde del pago ' || g.id || ' (vencido): se devuelve', 'sin_venta');
    -- (la nota de Finanzas queda en el historial del reembolso, no en lo que ve el comprador)
    perform tumbo_privado.reembolso_evento(v_reemb, yo, 'crear', v_nota);
    update tumbo.pagos set tardio = true, observacion = 'Dinero recibido tarde: se devuelve (R-' || v_reemb || ')' where id = g.id;
    -- el movimiento del banco de este dinero, si ya está en la cola de
    -- excepciones, queda devuelto con este reembolso (si otra persona lo
    -- está resolviendo en este momento, lo verá con el pago ya devuelto)
    update tumbo.movimientos_banco
    set estado = 'reembolsado', reembolso_id = v_reemb, nota = 'Devuelto con «pago recibido tarde» (R-' || v_reemb || ')',
        resuelto_por = tumbo_privado.actor(yo), resuelto_el = now()
    where id = (select o.id from tumbo.movimientos_banco o
                where o.pago_id = g.id and o.estado = 'excepcion' and o.excepcion = 'pago_vencido'
                order by o.id limit 1 for update skip locked);
    perform tumbo_privado.pago_evento(g.id, 'Finanzas', 'Dinero recibido tarde: reembolso R-' || v_reemb || ' de ' || tumbo_privado.fmt_usd(v_usd), 'undo');
    perform tumbo_privado.auditar(yo, 'Pago recibido tarde', g.id || ' → reembolsar R-' || v_reemb || ' · ' || tumbo_privado.fmt_usd(v_usd) || ' · ' || v_nota);
    return tumbo_privado.pago_json((select y from tumbo.pagos y where y.id = g.id), yo);
  end if;
  if g.vence < now() - interval '7 days' then
    raise exception 'Solo un pago vencido hace menos de 7 días se puede reactivar: si el dinero llegó, reembólsalo.';
  end if;
  perform 1 from tumbo.pedidos where pago_id = g.id order by id for update;
  perform 1 from tumbo.productos
  where sku in (select i.sku from tumbo.pedido_items i join tumbo.pedidos p on p.id = i.pedido_id
                where p.pago_id = g.id and p.vencido_el is not null and p.estado = 'cancelado')
  order by sku for update;
  for r in
    select i.pedido_id, i.sku, i.cant, pr.nombre, pr.estado, pr.stock_fis - pr.stock_res as disp, se.estado as seller_estado
    from tumbo.pedido_items i join tumbo.pedidos p on p.id = i.pedido_id
    join tumbo.productos pr on pr.sku = i.sku join tumbo.sellers se on se.id = pr.seller_id
    where p.pago_id = g.id and p.vencido_el is not null and p.estado = 'cancelado' order by i.sku
  loop
    if r.cant > r.disp or r.seller_estado <> 'aprobado' then
      raise exception 'Ya no hay stock de «%» para reactivar el pedido %: genera el reembolso.', r.nombre, r.pedido_id;
    end if;
  end loop;
  for x in select * from tumbo.pedidos where pago_id = g.id and vencido_el is not null and estado = 'cancelado' order by id loop
    update tumbo.pedidos set estado = 'pago_por_verificar', liquidacion = null where id = x.id;
    update tumbo.productos p set stock_res = p.stock_res + i.cant, actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = x.id and i.sku = p.sku;
    perform tumbo_privado.evento(x.id, 'Finanzas', 'Pago recibido tarde · pedido reactivado y stock reservado de nuevo', 'history');
  end loop;
  update tumbo.pagos set estado = case when reportado_el is null then 'pendiente' else 'reportado' end, tardio = true, vence = null
  where id = g.id;
  -- el crédito en Tumbo que se le devolvió al vencer se vuelve a descontar
  perform tumbo_privado.pago_ajustar_creditos(g.id, true);
  perform tumbo_privado.verificar_pago(g.id, yo, null, 'pago recibido tarde' || coalesce(' · ' || v_nota, ''));
  perform tumbo_privado.auditar(yo, 'Pago recibido tarde', g.id || ' → verificar' || coalesce(' · ' || v_nota, ''));
  return tumbo_privado.pago_json((select y from tumbo.pagos y where y.id = g.id), yo);
end $$;

-- Desde la de Pagos: el dinero que llega por un pago vencido es un solo
-- hecho con «pago recibido tarde» (tm_pago_tardio):
--   · si ese dinero ya se devolvió allí (un reembolso sin venta que todavía
--     no tiene su movimiento), este movimiento se cierra con ese reembolso
--     en vez de crear otro;
--   · si no, se devuelve y el pago queda marcado como tardío, así «pago
--     recibido tarde» ya no lo reactiva ni lo devuelve otra vez. (Otro
--     movimiento distinto del mismo pago es otro dinero: se devuelve.)
-- Cada movimiento devuelto guarda su reembolso (reembolso_id).
create or replace function public.tm_conciliacion_resolver(p_sesion text, p_id bigint, p_accion text, p_pago text, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_previo bigint;
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_nota text := left(nullif(trim(coalesce(p_nota, '')), ''), 300);
  v_tol numeric := tumbo_privado.numero(coalesce(tumbo_privado.ajuste('conciliacion'), '{}'::jsonb) -> 'tolerancia_bs', 1);
  mv tumbo.movimientos_banco;
  g tumbo.pagos;
  v_esp numeric;
  v_exceso numeric;
  v_pedido text;
  v_usd numeric;
  v_reemb bigint;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if p_accion is null or p_accion not in ('vincular', 'ignorar', 'reembolsar') then
    raise exception 'Indica si se vincula a un pago, se reembolsa o se ignora.';
  end if;
  if v_nota is null or char_length(v_nota) < 5 then
    raise exception 'Escribe una nota que explique la decisión (queda en la auditoría).';
  end if;
  select * into mv from tumbo.movimientos_banco where id = p_id for update;
  if not found then
    raise exception 'No encontramos ese movimiento.';
  end if;
  if mv.estado not in ('excepcion', 'nuevo') then
    raise exception 'Ese movimiento ya está resuelto (%).', mv.estado;
  end if;
  if p_accion = 'ignorar' then
    update tumbo.movimientos_banco set estado = 'ignorado', nota = v_nota, resuelto_por = tumbo_privado.actor(yo), resuelto_el = now()
    where id = mv.id;
    perform tumbo_privado.auditar(yo, 'Movimiento bancario ignorado', mv.banco || ' ' || mv.referencia || ' ' || tumbo_privado.fmt_bs(mv.monto) || ' · ' || v_nota);
    return jsonb_build_object('estado', 'ignorado');
  end if;
  select * into g from tumbo.pagos where id = coalesce(nullif(p_pago, ''), mv.pago_id) for update;
  if not found then
    raise exception 'Indica el pago al que corresponde el movimiento.';
  end if;
  if g.moneda <> 'VES' then
    raise exception 'Ese pago no es en bolívares: no corresponde a un movimiento del banco.';
  end if;
  if p_accion = 'reembolsar' then
    if mv.monto <= 0 then
      raise exception 'Ese movimiento no es un abono: no hay nada que devolver.';
    end if;
    if g.estado in ('pendiente', 'reportado') then
      raise exception 'El pago % sigue abierto: si el dinero no alcanza, recházalo (o deja que venza) y después reembolsa el movimiento.', g.id;
    end if;
    if g.estado = 'verificado' and g.movimiento_id is null then
      raise exception 'El pago % se verificó sin movimiento del banco: vincula primero el que lo pagó; si llegó otro, reembólsalo después.', g.id;
    end if;
    if g.estado = 'verificado' and g.movimiento_id = mv.id then
      raise exception 'Ese movimiento es el que pagó %: no se reembolsa desde aquí.', g.id;
    end if;
    if g.estado = 'vencido' then
      select r.id into v_previo from tumbo.reembolsos r
      where r.pago_id = g.id and r.tipo = 'sin_venta'
        and not exists (select 1 from tumbo.movimientos_banco o where o.reembolso_id = r.id)
      order by r.id limit 1;
      if v_previo is not null then
        update tumbo.movimientos_banco set estado = 'reembolsado', pago_id = g.id, reembolso_id = v_previo,
          nota = v_nota || ' (R-' || v_previo || ', ya creado con «pago recibido tarde»)', resuelto_por = tumbo_privado.actor(yo), resuelto_el = now()
        where id = mv.id;
        perform tumbo_privado.auditar(yo, 'Movimiento bancario reembolsado', mv.banco || ' ' || mv.referencia || ' ' || tumbo_privado.fmt_bs(mv.monto) ||
          ' → ' || g.id || ' · ya devuelto en R-' || v_previo || ' · ' || v_nota);
        return jsonb_build_object('estado', 'reembolsado', 'pago', g.id, 'reembolso', v_previo, 'existente', true);
      end if;
    end if;
    v_usd := round(mv.monto / g.tasa, 2);
    select x.id into v_pedido from tumbo.pedidos x where x.pago_id = g.id order by x.id limit 1;
    v_reemb := tumbo_privado.crear_reembolso_interno(v_pedido, v_usd,
      'Dinero recibido por el pago ' || g.id || ' (' || g.estado || '): se devuelve el movimiento ' || coalesce(nullif(mv.referencia, ''), 's/r') ||
      ' de ' || tumbo_privado.fmt_bs(mv.monto), 'sin_venta');
    perform tumbo_privado.reembolso_evento(v_reemb, yo, 'crear', v_nota);
    update tumbo.movimientos_banco set estado = 'reembolsado', pago_id = g.id, reembolso_id = v_reemb, nota = v_nota || ' (R-' || v_reemb || ')',
      resuelto_por = tumbo_privado.actor(yo), resuelto_el = now()
    where id = mv.id;
    if g.estado = 'vencido' and not g.tardio then
      update tumbo.pagos set tardio = true, observacion = 'Dinero recibido tarde: se devuelve (R-' || v_reemb || ')' where id = g.id;
    end if;
    perform tumbo_privado.pago_evento(g.id, 'Finanzas', 'Llegó dinero de este pago (' || tumbo_privado.fmt_bs(mv.monto) || '): se devuelve en R-' || v_reemb, 'undo');
    perform tumbo_privado.auditar(yo, 'Movimiento bancario reembolsado', mv.banco || ' ' || mv.referencia || ' ' || tumbo_privado.fmt_bs(mv.monto) ||
      ' → ' || g.id || ' · R-' || v_reemb || ' · ' || v_nota);
    return jsonb_build_object('estado', 'reembolsado', 'pago', g.id, 'reembolso', v_reemb);
  end if;
  if exists (select 1 from tumbo.movimientos_banco o where o.pago_id = g.id and o.estado = 'conciliado' and o.id <> mv.id) then
    raise exception 'El pago % ya tiene otro movimiento conciliado.', g.id;
  end if;
  if g.estado = 'verificado' then
    if g.movimiento_id is not null then
      raise exception 'El pago % ya está verificado con otro movimiento.', g.id;
    end if;
    update tumbo.pagos set movimiento_id = mv.id where id = g.id;
  elsif g.estado in ('pendiente', 'reportado') then
    if g.vence < now() then
      raise exception 'El pago % venció: usa «pago recibido tarde» y después vincula el movimiento.', g.id;
    end if;
    v_esp := (tumbo_privado.pago_esperado(g) ->> 'bs')::numeric;
    if mv.monto < v_esp - v_tol then
      raise exception 'El movimiento (%) no cubre el pago (%): recházalo y reembolsa el movimiento.',
        tumbo_privado.fmt_bs(mv.monto), tumbo_privado.fmt_bs(v_esp);
    end if;
    perform tumbo_privado.verificar_pago(g.id, yo, mv.id, 'vinculado al movimiento ' || mv.banco || ' ' || mv.referencia || ' · ' || v_nota);
    v_exceso := round((mv.monto - v_esp) / g.tasa, 2);
    if mv.monto > v_esp + v_tol and v_exceso > 0 then
      select id into v_pedido from tumbo.pedidos where pago_id = g.id order by id limit 1;
      perform tumbo_privado.crear_reembolso_interno(v_pedido, v_exceso, 'Excedente del pago ' || g.id || ' (' || tumbo_privado.fmt_bs(mv.monto - v_esp) || ')', 'excedente');
    end if;
  else
    raise exception 'El pago % está %: no admite este movimiento.', g.id, g.estado;
  end if;
  update tumbo.movimientos_banco set estado = 'conciliado', pago_id = g.id, nota = v_nota, resuelto_por = tumbo_privado.actor(yo), resuelto_el = now()
  where id = mv.id;
  perform tumbo_privado.auditar(yo, 'Movimiento bancario vinculado', mv.banco || ' ' || mv.referencia || ' → ' || g.id || ' · ' || v_nota);
  return jsonb_build_object('estado', 'conciliado', 'pago', g.id);
end $$;

-- ---------------------------------------------------------------------------
-- Pago devuelto para corregir: los pedidos cancelados después del reporte
-- ---------------------------------------------------------------------------
-- Desde la de Pagos: un pago que vuelve a «pendiente» para corregir la
-- referencia (tm_pago_corregir) conserva su primer reporte (tm_pago_reportar
-- ya no lo pisa), así que lo que el comprador canceló después de reportarlo
-- sigue cubierto con la misma regla antes y después de verificar: ya lo
-- pagó y se reembolsa al verificar. Antes el pendiente lo excluía:
-- verificar_pago no lo reembolsaba, pero asentar_pago y pago_esperado (con
-- el pago ya verificado) lo contaban como venta del comercio.
create or replace function tumbo_privado.pedidos_del_pago(g tumbo.pagos) returns setof tumbo.pedidos
language sql stable security definer set search_path = '' as $$
  select x.* from tumbo.pedidos x
  where x.pago_id = g.id
    and case
          when g.estado = 'vencido' then x.vencido_el is not null
          when g.estado in ('rechazado', 'cancelado') then true
          else x.estado <> 'cancelado'
               or x.cancelado_el >= coalesce(g.reportado_el, g.verificado_el)
               or (g.tardio and x.vencido_el is not null)
        end
  order by x.id
$$;

-- Desde la de Pagos: el conjunto de pedidos (los que pasan a «por
-- aceptar» y los cancelados que se reembolsan) se fija con la regla del pago
-- ya verificado, la misma con la que asentar_pago lo asienta y
-- pago_esperado lo cuenta.
create or replace function tumbo_privado.verificar_pago(p_pago text, p_yo tumbo.usuarios, p_mov bigint, p_nota text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
  g2 tumbo.pagos;
  x tumbo.pedidos;
  v_ids text[] := '{}';
  v_reemb text[] := '{}';
  v_id text;
  v_actor text := case when p_yo.id is null then 'Sistema' else 'Finanzas' end;
  v_esperado jsonb;
begin
  select * into g from tumbo.pagos where id = p_pago for update;
  if g.estado not in ('pendiente', 'reportado') then
    raise exception 'El pago % ya no está pendiente de verificación.', p_pago;
  end if;
  perform 1 from tumbo.pedidos where pago_id = g.id order by id for update;
  g2 := g;
  g2.estado := 'verificado';
  g2.verificado_el := now();
  v_esperado := tumbo_privado.pago_esperado(g2);
  for x in select * from tumbo_privado.pedidos_del_pago(g2) loop
    if x.estado = 'pago_por_verificar' then
      update tumbo.pedidos set estado = 'por_aceptar', sla_horas = 24 where id = x.id;
      perform tumbo_privado.evento(x.id, v_actor, 'Pago conciliado · pendiente de aceptación del seller', 'fact_check');
      perform tumbo_privado.notificar('seller:' || x.seller_id, 'Nuevo pedido ' || x.id || ' pendiente de aceptar', 'shopping_cart',
                                      'seller/pedidos.html', array['seller', 'operador']);
      perform tumbo_privado.notificar('usr:' || x.comprador_id, 'Confirmamos el pago de tu pedido ' || x.id, 'check_circle',
                                      'tienda/pedido.html?id=' || x.id);
      v_ids := v_ids || x.id;
    elsif x.estado = 'cancelado' then
      v_reemb := v_reemb || x.id;
    else
      v_ids := v_ids || x.id;
    end if;
  end loop;
  update tumbo.pagos
  set estado = 'verificado', verificado_el = now(), verificado_por = tumbo_privado.actor(p_yo),
      movimiento_id = coalesce(p_mov, movimiento_id), observacion = null
  where id = g.id;
  -- el crédito de un pedido que el pago ya no cubre vuelve al comprador
  perform tumbo_privado.pago_ajustar_creditos(g.id, false);
  perform tumbo_privado.pago_evento(g.id, v_actor, 'Pago verificado' || coalesce(' · ' || p_nota, ''), 'fact_check');
  perform tumbo_privado.asentar_pago(g.id, tumbo_privado.actor(p_yo));
  -- lo cancelado después de reportar se reembolsa completo (dinero, IGTF y
  -- el crédito que sigue usado)
  foreach v_id in array v_reemb loop
    perform tumbo_privado.crear_reembolso(v_id,
      (tumbo_privado.montos_pedido(x2) ->> 'dinero')::numeric + tumbo_privado.credito_vigente(x2.id),
      'Pedido ' || v_id || ' cancelado después de reportar el pago ' || g.id)
    from tumbo.pedidos x2 where x2.id = v_id;
  end loop;
  perform tumbo_privado.encolar(g.comprador_id, 'pago_confirmado', jsonb_build_object(
    'pedido', array_to_string(v_ids, ', '),
    'monto', case when g.moneda = 'VES' then tumbo_privado.fmt_bs((v_esperado ->> 'bs')::numeric)
                  else tumbo_privado.fmt_usd((v_esperado ->> 'usd')::numeric) end,
    'enlace', 'app/tienda/pago.html?id=' || g.id));
  perform tumbo_privado.auditar(p_yo, 'Conciliación de pago',
    coalesce(g.referencia, 'sin referencia') || ' → ' || g.id || ' (' || array_to_string(v_ids || v_reemb, ', ') || ')' ||
    coalesce(' · ' || p_nota, ''));
  return v_ids;
end $$;

-- Desde la de Pagos: los eventos nombran al comprador como «Comprador» y
-- un segundo reporte (después de que Finanzas pidió corregir la
-- referencia) conserva la fecha del primero, que decide qué pedidos
-- cancelados ya estaban pagados (pedidos_del_pago).
create or replace function public.tm_pago_reportar(p_sesion text, p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v_d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  g tumbo.pagos;
  v_r jsonb;
  v_pagador jsonb := '{}'::jsonb;
  v_fecha date;
  v_banco text;
  v_comp uuid;
  v_doc text;
  v_tel text;
  v_correo text;
  v_titular text;
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'pagos');
  select * into g from tumbo.pagos where id = p_id and comprador_id = yo.id;
  if not found then
    raise exception 'No encontramos ese pago.';
  end if;
  if g.contra_entrega then
    raise exception 'Este pago es en efectivo contra entrega: se registra cuando el courier entregue el efectivo.';
  end if;
  if g.estado = 'reportado' then
    raise exception 'Ya reportaste este pago: Finanzas lo está verificando.';
  end if;
  if g.estado <> 'pendiente' then
    raise exception 'Este pago ya no admite reportes (%).', g.estado;
  end if;
  if g.vence is not null and g.vence < now() then
    raise exception 'El plazo para pagar venció: los pedidos se cancelan y su stock se libera.';
  end if;
  if g.reportes >= 3 then
    raise exception 'Este pago ya se reportó 3 veces: escríbele a soporte.';
  end if;

  v_r := tumbo_privado.referencia_pago(g.metodo, v_d ->> 'referencia');
  if v_r ? 'error' then
    raise exception '%', v_r ->> 'error';
  end if;
  begin
    v_fecha := (v_d ->> 'fecha')::date;
  exception when others then
    v_fecha := null;
  end;
  if v_fecha is null or v_fecha > tumbo_privado.hoy_caracas() or v_fecha < (g.creado at time zone 'America/Caracas')::date - 1 then
    raise exception 'Indica la fecha en que hiciste el pago (desde el día del pedido hasta hoy).';
  end if;
  if g.metodo in ('pago_movil', 'transferencia') then
    v_banco := v_d ->> 'banco';
    if not exists (select 1 from tumbo.bancos where codigo = v_banco) then
      raise exception 'Elige el banco desde el que pagaste.';
    end if;
    v_doc := tumbo_privado.documento(v_d ->> 'cedula');
    if v_doc is null then
      raise exception 'Escribe la cédula o el RIF del titular de la cuenta (p. ej. V-12345678).';
    end if;
    v_pagador := jsonb_build_object('banco', v_banco, 'banco_nombre', (select nombre from tumbo.bancos where codigo = v_banco), 'cedula', v_doc);
    if g.metodo = 'pago_movil' then
      v_tel := tumbo_privado.telefono_movil(v_d ->> 'telefono');
      if v_tel is null then
        raise exception 'Escribe el teléfono desde el que hiciste el Pago Móvil (p. ej. 0414-1234567).';
      end if;
      v_pagador := v_pagador || jsonb_build_object('telefono', v_tel);
    end if;
  elsif g.metodo = 'zelle' then
    v_correo := lower(trim(coalesce(v_d ->> 'correo', '')));
    v_titular := left(regexp_replace(trim(coalesce(v_d ->> 'titular', '')), '[[:cntrl:]<>]+', '', 'g'), 80);
    if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_correo) > 120 then
      raise exception 'Escribe el correo de la cuenta Zelle desde la que pagaste.';
    end if;
    if char_length(v_titular) < 3 then
      raise exception 'Escribe el nombre del titular de la cuenta Zelle.';
    end if;
    v_pagador := jsonb_build_object('correo', v_correo, 'titular', v_titular);
  elsif g.metodo = 'usdt' then
    v_pagador := jsonb_build_object('red', left(coalesce(nullif(trim(v_d ->> 'red'), ''), 'Binance Pay'), 30));
  end if;
  if nullif(v_d ->> 'comprobante', '') is not null then
    v_comp := tumbo_privado.uuid_texto(v_d ->> 'comprobante');
    if v_comp is null or not exists (
         select 1 from tumbo.archivos a
         where a.id = v_comp and a.propietario = yo.id and a.proposito = 'comprobante' and a.estado = 'listo'
           and a.entidad in (select id from tumbo.pedidos where pago_id = g.id)) then
      raise exception 'La captura del pago no es válida: vuelve a subirla.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tumbo:ref:' || coalesce(nullif(v_r ->> 'numero', ''), v_r ->> 'clave'), 0));
  select * into g from tumbo.pagos where id = g.id for update;
  if g.estado <> 'pendiente' then
    raise exception 'Este pago ya no admite reportes (%).', g.estado;
  end if;
  if not tumbo_privado.referencia_libre(v_r ->> 'clave', v_r ->> 'numero', g.id) then
    raise exception 'La referencia % ya está registrada en otro pedido: revisa el número del pago.', v_r ->> 'ref';
  end if;
  update tumbo.pagos
  set estado = 'reportado', referencia = v_r ->> 'ref', ref_clave = v_r ->> 'clave', pagador = v_pagador, fecha_pago = v_fecha,
      comprobante = v_comp, reportado_el = coalesce(reportado_el, now()), reportes = reportes + 1, observacion = null
  where id = g.id;
  update tumbo.pedidos set ref = v_r ->> 'ref' where pago_id = g.id and estado = 'pago_por_verificar';
  insert into tumbo.pedido_eventos (pedido_id, actor, texto, icono)
  select x.id, 'Comprador', 'Pago reportado (' || m.nombre || ' ref. ' || (v_r ->> 'ref') || ')', 'payments'
  from tumbo.pedidos x join tumbo.metodos_pago m on m.id = g.metodo
  where x.pago_id = g.id and x.estado = 'pago_por_verificar';
  perform tumbo_privado.pago_evento(g.id, 'Comprador', 'Pago reportado · ref. ' || (v_r ->> 'ref') ||
    case when g.correcciones > 0 then ' (corrección ' || g.correcciones || ')' else '' end, 'payments');
  perform tumbo_privado.notificar('rol:finanzas', 'Pago ' || (v_r ->> 'ref') || ' reportado (' || g.id || '): por conciliar',
                                  'fact_check', 'admin/conciliacion.html');
  perform tumbo_privado.auditar(yo, 'Pago reportado', g.id || ' · ' || g.metodo || ' ' || (v_r ->> 'ref'));
  return tumbo_privado.pago_json((select x from tumbo.pagos x where x.id = g.id), yo);
end $$;

-- ---------------------------------------------------------------------------
-- El comprador real en los pagos y reembolsos
-- ---------------------------------------------------------------------------
-- Desde la de Pagos: la línea de tiempo del pedido y la del pago nombran al
-- comprador como «Comprador» (como el resto de los eventos del núcleo y de
-- Logística), no por su nombre: la leen el comercio, las cuentas de prueba
-- del equipo y quedan después de una baja.
create or replace function tumbo_privado.checkout_crear(p_yo tumbo.usuarios, p_datos jsonb, p_legado jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  cfg tumbo.config;
  m tumbo.metodos_pago;
  v_red text := tumbo_privado.ip_cliente();
  v_demo boolean := tumbo_privado.cuenta_demo(p_yo.email);
  v_r jsonb;
  v_vencidos text[];
  v_c jsonb;
  v_esp jsonb;
  v_total numeric;
  v_pago text;
  v_vence timestamptz;
  v_contra boolean;
  s jsonb;
  v_id text;
  v_ids text[] := '{}';
  v_dir text;
  v_estado text;
begin
  perform tumbo_privado.bloquear_usuario(p_yo.id, 'carrito');
  if coalesce(tumbo_privado.ajuste('checkout_activo'), 'true'::jsonb) = 'false'::jsonb then
    raise exception 'Las compras están en pausa por mantenimiento. Inténtalo más tarde.';
  end if;
  select * into cfg from tumbo.config;
  select * into m from tumbo.metodos_pago where id = coalesce(nullif(v_d ->> 'metodo', ''), 'pago_movil');
  if not found or not m.activo or m.interno then
    raise exception 'Elige un método de pago disponible.';
  end if;
  if p_legado is not null then
    v_r := tumbo_privado.referencia_pago(m.id, p_legado ->> 'ref');
    if v_r ? 'error' then
      raise exception '%', v_r ->> 'error';
    end if;
  end if;
  if v_d ->> 'entrega' is null or v_d ->> 'entrega' not in ('agencia', 'domicilio') then
    raise exception 'Elige cómo quieres recibir el pedido.';
  end if;
  if v_d ->> 'entrega' = 'domicilio' and not exists (
       select 1 from tumbo.direcciones where id = tumbo_privado.uuid_texto(v_d ->> 'direccion_id') and usuario_id = p_yo.id) then
    raise exception 'Elige una dirección de entrega válida.';
  end if;
  if p_legado is not null then
    -- dos compras con el mismo pago, una tras otra
    perform pg_advisory_xact_lock(hashtextextended('tumbo:ref:' || coalesce(nullif(v_r ->> 'numero', ''), v_r ->> 'clave'), 0));
  end if;

  -- pagos vencidos y productos (del carrito y de esos pedidos) en una sola
  -- pasada ordenada por SKU: el stock se valida y se reserva atómicamente
  v_vencidos := tumbo_privado.pagos_vencidos();
  perform 1 from tumbo.productos p
  where p.sku in (select c.sku from tumbo.carrito_items c where c.usuario_id = p_yo.id
                  union select i.sku from tumbo.pedido_items i where i.pedido_id = any (v_vencidos))
  order by p.sku for update;
  perform tumbo_privado.vencer_pedidos(v_vencidos);

  if p_legado is not null and not tumbo_privado.referencia_libre(v_r ->> 'clave', v_r ->> 'numero', null) then
    raise exception 'La referencia % ya está registrada en otro pedido: revisa el número del pago.', v_r ->> 'ref';
  end if;
  -- topes (sobre la entidad pago): en las cuentas demo (compartidas) cuentan
  -- por red, con un respaldo por cuenta; en las demás, por cuenta
  if (select count(*) from tumbo.pagos
      where comprador_id = p_yo.id and estado in ('pendiente', 'reportado') and not contra_entrega and (not v_demo or red = v_red))
     + (select count(*) from tumbo.pedidos
        where comprador_id = p_yo.id and pago_id is null and estado = 'pago_por_verificar' and (not v_demo or red = v_red)) >= 5 then
    raise exception 'Tienes 5 pagos por verificar: espera la conciliación o cancela alguno de esos pedidos.';
  end if;
  if (select count(*) from tumbo.pagos where comprador_id = p_yo.id and creado > now() - interval '1 hour' and (not v_demo or red = v_red)) >= 10 then
    raise exception 'Has creado muchos pedidos en la última hora: inténtalo más tarde.';
  end if;
  if v_demo and (select count(*) from tumbo.pagos where comprador_id = p_yo.id and creado > now() - interval '1 hour') >= 100 then
    raise exception 'La cuenta demo tiene muchos pedidos en la última hora: inténtalo más tarde o regístrate con tu correo.';
  end if;
  if not exists (select 1 from tumbo.carrito_items where usuario_id = p_yo.id) then
    raise exception 'El carrito está vacío.';
  end if;

  v_c := tumbo_privado.checkout_calcular(p_yo, v_d);
  v_total := (v_c ->> 'total_usd')::numeric;
  if p_legado is not null then
    if tumbo_privado.num_json(p_legado -> 'total_usd') is not null
       and abs((v_c ->> 'subtotal_usd')::numeric - tumbo_privado.num_json(p_legado -> 'total_usd')) >= 0.01 then
      raise exception 'Los precios de tu carrito cambiaron: ahora suman %. Revisa el carrito antes de pagar.',
        tumbo_privado.fmt_usd((v_c ->> 'subtotal_usd')::numeric);
    end if;
  else
    v_esp := v_d -> 'esperado';
    if jsonb_typeof(v_esp) <> 'object' or tumbo_privado.num_json(v_esp -> 'total_usd') is null then
      raise exception 'Falta el total que viste: vuelve a cargar el checkout.';
    end if;
    if abs(v_total - tumbo_privado.num_json(v_esp -> 'total_usd')) >= 0.01
       or (tumbo_privado.num_json(v_esp -> 'total_bs') is not null
           and abs((v_c ->> 'total_bs')::numeric - tumbo_privado.num_json(v_esp -> 'total_bs')) >= 0.01) then
      raise exception 'El total cambió: ahora es % (%). Revisa el resumen antes de confirmar.',
        tumbo_privado.fmt_usd(v_total), tumbo_privado.fmt_bs((v_c ->> 'total_bs')::numeric);
    end if;
    if (v_c -> 'cupon' ->> 'mensaje') is not null then
      raise exception '%', (v_c -> 'cupon' ->> 'mensaje') || ' Quítalo para continuar.';
    end if;
  end if;

  v_contra := m.contra_entrega and v_total > 0;
  v_vence := case when v_total = 0 or v_contra then null else tumbo_privado.vencimiento_pago(now()) end;
  v_pago := 'PAG-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(nextval('tumbo_privado.seq_pago'), 5);
  insert into tumbo.pagos (id, comprador_id, metodo, moneda, estado, subtotal_usd, descuento_usd, envio_usd, iva_usd, igtf_usd,
                           credito_usd, total_usd, tasa, total_bs, referencia, ref_clave, fiscal, cupon, contra_entrega,
                           vence, red, reportado_el)
  values (v_pago, p_yo.id, case when v_total = 0 then 'credito' else m.id end,
          case when v_total = 0 then 'USD' else m.moneda end,
          case when p_legado is not null then 'reportado' else 'pendiente' end,
          (v_c ->> 'subtotal_usd')::numeric, (v_c ->> 'descuento_usd')::numeric, (v_c ->> 'envio_usd')::numeric,
          (v_c ->> 'iva_usd')::numeric, (v_c ->> 'igtf_usd')::numeric, (v_c ->> 'credito_usd')::numeric,
          v_total, cfg.tasa, (v_c ->> 'total_bs')::numeric,
          v_r ->> 'ref', v_r ->> 'clave', v_c -> 'fiscal', v_c -> 'cupon' ->> 'codigo', v_contra,
          v_vence, v_red, case when p_legado is not null then now() end);

  for s in select * from jsonb_array_elements(v_c -> 'sellers') loop
    v_id := 'TM-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(nextval('tumbo_privado.seq_pedido'), 5);
    v_dir := case when v_c ->> 'entrega' = 'agencia'
                  then coalesce(s -> 'envio' ->> 'agencia', s -> 'envio' ->> 'direccion', s -> 'envio' ->> 'descripcion', 'Retiro en agencia')
                  else (v_c -> 'destino' ->> 'linea') || ', ' || (v_c -> 'destino' ->> 'municipio') end;
    v_estado := case when v_contra then 'por_aceptar' else 'pago_por_verificar' end;
    insert into tumbo.pedidos (id, comprador_id, seller_id, estado, envio_tipo, envio_dir, courier, costo_envio_usd, tasa, metodo,
                               ref, pago_vence, red, pago_id, destino, descuento_usd, descuento_tumbo_usd, iva_usd, igtf_usd,
                               credito_usd, exento_usd, monto_bs, comision_pct, tarifa_usd, envio_dias, sla_horas)
    values (v_id, p_yo.id, s ->> 'seller_id', v_estado, v_c ->> 'entrega', left(v_dir, 300),
            coalesce(nullif(s -> 'envio' ->> 'courier', ''), 'Por asignar'), (s ->> 'envio_usd')::numeric, cfg.tasa, m.nombre,
            coalesce(v_r ->> 'ref', ''), v_vence, v_red, v_pago,
            (v_c -> 'destino') || jsonb_build_object('courier', s -> 'envio' ->> 'courier', 'opcion', s -> 'envio' ->> 'clave'),
            (s ->> 'descuento_usd')::numeric, (s ->> 'descuento_tumbo_usd')::numeric, (s ->> 'iva_usd')::numeric,
            (s ->> 'igtf_usd')::numeric, (s ->> 'credito_usd')::numeric, (s ->> 'exento_usd')::numeric, (s ->> 'pedido_bs')::numeric,
            cfg.comision_pct, cfg.tarifa_fija_usd, s ->> 'envio_dias',
            case when v_contra then 24 end);
    -- el crédito en Tumbo se descuenta por pedido: si el pago no se cumple,
    -- cada pedido devuelve el suyo (pago_ajustar_creditos)
    if (s ->> 'credito_usd')::numeric > 0 then
      insert into tumbo.creditos (usuario_id, monto_usd, motivo, referencia, pedido_uso)
      values (p_yo.id, -(s ->> 'credito_usd')::numeric, 'Usado en el pedido ' || v_id || ' (pago ' || v_pago || ')', v_pago, v_id);
    end if;
    insert into tumbo.pedido_items (pedido_id, sku, nombre, img, cant, precio_usd)
    select v_id, p.sku, p.nombre, p.img, c.cant, p.precio_usd
    from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
    where c.usuario_id = p_yo.id and p.seller_id = s ->> 'seller_id';
    -- la reserva sale de las líneas del pedido: lo reservado es exactamente
    -- lo que luego liberan la cancelación, el rechazo o el despacho
    update tumbo.productos p set stock_res = p.stock_res + i.cant, actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v_id and i.sku = p.sku;

    if p_legado is not null then
      perform tumbo_privado.evento(v_id, 'Comprador', 'Pedido creado y pago registrado (' || m.nombre || ' ref. ' || (v_r ->> 'ref') || ')', 'shopping_cart');
      perform tumbo_privado.notificar('rol:finanzas', 'Pago ' || (v_r ->> 'ref') || ' pendiente de conciliar (' || v_id || ')',
                                      'fact_check', 'admin/conciliacion.html');
    elsif v_contra then
      perform tumbo_privado.evento(v_id, 'Comprador', 'Pedido creado · pago en efectivo contra entrega (' || v_pago || ')', 'shopping_cart');
      perform tumbo_privado.notificar('seller:' || (s ->> 'seller_id'), 'Nuevo pedido ' || v_id || ' pendiente de aceptar (cobro contra entrega)',
                                      'shopping_cart', 'seller/pedidos.html', array['seller', 'operador']);
    else
      perform tumbo_privado.evento(v_id, 'Comprador', 'Pedido creado · pago ' || v_pago || ' por hacer (' ||
        case when v_total = 0 then 'crédito en Tumbo' else m.nombre end || ')', 'shopping_cart');
    end if;
    perform tumbo_privado.auditar(p_yo, 'Pedido creado', v_id || ' · ' || v_pago || ' · ' || m.nombre || coalesce(' ' || (v_r ->> 'ref'), ''));
    v_ids := v_ids || v_id;
  end loop;

  perform tumbo_privado.pago_evento(v_pago, 'Comprador',
    case when p_legado is not null then 'Pago registrado con la referencia ' || (v_r ->> 'ref')
         else 'Checkout confirmado: ' || array_to_string(v_ids, ', ') end, 'shopping_cart');
  delete from tumbo.carrito_items where usuario_id = p_yo.id;
  if v_total = 0 then
    perform tumbo_privado.verificar_pago(v_pago, null::tumbo.usuarios, null, 'pagado con crédito en Tumbo');
  end if;
  return jsonb_build_object('pago', v_pago, 'pedidos', to_jsonb(v_ids), 'total_usd', v_total,
                            'total_bs', (v_c ->> 'total_bs')::numeric, 'vence', v_vence,
                            'estado', (select estado from tumbo.pagos where id = v_pago));
end $$;

-- Desde la de Pagos: a una cuenta de prueba del equipo, el pago de una
-- persona real llega sin su nombre (como en la cola y el libro de ventas) y
-- su historial nombra a quien pagó como «Comprador».
create or replace function tumbo_privado.pago_json(g tumbo.pagos, p_yo tumbo.usuarios) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_nombre text := (select u.nombre from tumbo.usuarios u where u.id = g.comprador_id);
  m tumbo.metodos_pago;
  v_benef jsonb := coalesce(tumbo_privado.ajuste('pagos_beneficiario'), '{}'::jsonb);
  v_equipo boolean := p_yo.rol in ('finanzas', 'superadmin');
  v_ve boolean := not v_equipo or tumbo_privado.ve_comprador(p_yo, g.comprador_id);
  v_esp jsonb := tumbo_privado.pago_esperado(g);
begin
  select * into m from tumbo.metodos_pago where id = g.metodo;
  return jsonb_build_object(
    'id', g.id, 'estado', g.estado, 'creado', g.creado, 'vence', g.vence,
    'vencido', g.vence is not null and g.vence < now() and g.estado in ('pendiente', 'reportado', 'vencido'),
    'segundos', case when g.vence is null then null else greatest(0, floor(extract(epoch from g.vence - now())))::bigint end,
    'metodo', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'moneda', m.moneda, 'igtf', m.igtf,
                                 'contra_entrega', m.contra_entrega, 'instrucciones', m.instrucciones, 'campos', to_jsonb(m.campos)),
    'beneficiario', jsonb_build_object('configurado', coalesce((v_benef ->> 'configurado')::boolean, false),
                                       'nota', v_benef ->> 'nota', 'datos', v_benef -> 'metodos' -> m.nombre),
    'montos', jsonb_build_object('subtotal_usd', g.subtotal_usd, 'descuento_usd', g.descuento_usd, 'envio_usd', g.envio_usd,
                                 'iva_usd', g.iva_usd, 'igtf_usd', g.igtf_usd, 'credito_usd', g.credito_usd,
                                 'total_usd', g.total_usd, 'total_bs', g.total_bs, 'tasa', g.tasa,
                                 'esperado_usd', v_esp -> 'usd', 'esperado_bs', v_esp -> 'bs', 'esperado', v_esp -> 'monto'),
    'moneda', g.moneda, 'contra_entrega', g.contra_entrega,
    'referencia', g.referencia, 'fecha_pago', g.fecha_pago,
    'pagador', case when v_ve then g.pagador else '{}'::jsonb end,
    'comprobante', case when v_ve then g.comprobante end,
    'fiscal', case when v_ve then g.fiscal end,
    'cupon', g.cupon, 'correcciones', g.correcciones, 'correcciones_restantes', 2 - g.correcciones,
    'observacion', g.observacion, 'reportado_el', g.reportado_el, 'verificado_el', g.verificado_el, 'tardio', g.tardio,
    'puede_reportar', g.estado = 'pendiente' and not g.contra_entrega and (g.vence is null or g.vence > now()),
    'comprador', case when v_equipo then (select jsonb_build_object('nombre', case when v_ve then u.nombre else 'Cuenta real (oculta a las cuentas de prueba)' end,
                                                                    'email', case when v_ve then u.email end, 'oculto', not v_ve)
                                          from tumbo.usuarios u where u.id = g.comprador_id) end,
    'verificado_por', case when v_equipo then g.verificado_por end,
    'movimiento_id', case when v_equipo then g.movimiento_id end,
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'seller', s.nombre, 'seller_id', x.seller_id, 'estado', x.estado,
                                           'total_usd', (tumbo_privado.montos_pedido(x) ->> 'pagado')::numeric, 'monto_bs', x.monto_bs,
                                           'envio', x.courier, 'envio_dias', x.envio_dias,
                                           'cubierto', exists (select 1 from tumbo_privado.pedidos_del_pago(g) y where y.id = x.id))
                                         order by x.id)
                         from tumbo.pedidos x join tumbo.sellers s on s.id = x.seller_id where x.pago_id = g.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('fecha', e.fecha,
                                                             'actor', case when not v_ve and e.actor = v_nombre then 'Comprador' else e.actor end,
                                                             'texto', e.texto, 'icono', e.icono) order by e.id)
                         from tumbo.pago_eventos e where e.pago_id = g.id and (v_equipo or not e.interno)), '[]'::jsonb));
end $$;

-- Desde la de Pagos: el comprador figura como «Comprador» (no por su
-- nombre) en el historial del reembolso que lee Finanzas.
create or replace function tumbo_privado.reembolso_evento(p_id bigint, p_yo tumbo.usuarios, p_accion text, p_nota text) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.reembolso_eventos (reembolso_id, usuario_id, actor, accion, nota)
  values (p_id, p_yo.id, case when p_yo.rol = 'comprador' then 'Comprador' else tumbo_privado.actor(p_yo) end, p_accion, p_nota);
$$;

-- Desde la de Pagos: a una cuenta de prueba, el historial de un reembolso
-- de una persona real no lleva los nombres de la persona ni del equipo real
-- (solo su papel), como la auditoría.
create or replace function public.tm_reembolsos_gestion(p_sesion text, p_estado text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  v_estado text := coalesce(nullif(p_estado, ''), 'abiertos');
  cfg tumbo.config;
begin
  if v_estado not in ('abiertos', 'pendiente', 'en_proceso', 'enviado', 'fallido', 'todos') then
    raise exception 'Ese estado no existe.';
  end if;
  select * into cfg from tumbo.config;
  return jsonb_build_object(
    'prueba', tumbo_privado.cuenta_demo(yo.email),
    'umbral_doble_usd', tumbo_privado.numero(coalesce(tumbo_privado.ajuste('reembolsos'), '{}'::jsonb) -> 'umbral_doble_usd', 200),
    'tasa_hoy', cfg.tasa,
    'reembolsos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'pedido_id', r.pedido_id, 'pago_id', r.pago_id, 'monto_usd', r.monto_usd, 'monto_bs', r.monto_bs, 'tasa', r.tasa,
               'motivo', r.motivo, 'estado', r.estado, 'referencia', r.referencia, 'error', r.error, 'tipo', r.tipo,
               'bloqueado', tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.comprador_real(p.comprador_id),
               'destino', case when r.destino is null then null
                               when tumbo_privado.ve_comprador(yo, p.comprador_id)
                                 then coalesce((select dd.datos from tumbo.reembolso_destinos dd where dd.reembolso_id = r.id), r.destino)
                               else jsonb_build_object('tipo', r.destino ->> 'tipo', 'oculto', true) end,
               'requiere_doble', r.requiere_doble, 'moneda_envio', r.moneda_envio, 'tasa_envio', r.tasa_envio,
               'monto_enviado', r.monto_enviado, 'enviado_el', r.enviado_el, 'creado', r.creado,
               'comprador', case when tumbo_privado.ve_comprador(yo, p.comprador_id) then u.nombre else 'Cuenta real (oculta a las cuentas de prueba)' end,
               'eventos', coalesce((select jsonb_agg(jsonb_build_object(
                                          'actor', case when tumbo_privado.ve_comprador(yo, p.comprador_id) or tumbo_privado.auditoria_visible(yo, e.usuario_id) then e.actor
                                                        when e.usuario_id = p.comprador_id then 'Comprador'
                                                        else coalesce((select case x.rol when 'finanzas' then 'Finanzas' when 'superadmin' then 'Superadministración'
                                                                                          when 'ops' then 'Operaciones' else 'Cuenta real' end
                                                                       from tumbo.usuarios x where x.id = e.usuario_id), 'Cuenta real') end,
                                          'accion', e.accion, 'nota', e.nota, 'fecha', e.fecha, 'mio', e.usuario_id = yo.id) order by e.id)
                                    from tumbo.reembolso_eventos e where e.reembolso_id = r.id), '[]'::jsonb))
             order by r.creado, r.id)
      from (select * from tumbo.reembolsos x
            where case v_estado when 'abiertos' then x.estado in ('pendiente', 'en_proceso', 'fallido')
                                when 'todos' then true else x.estado = v_estado end
            order by x.creado desc, x.id desc limit 500) r
      join tumbo.pedidos p on p.id = r.pedido_id
      join tumbo.usuarios u on u.id = p.comprador_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Liquidación con el envío retenido por Tumbo
-- ---------------------------------------------------------------------------
-- Desde la de Pagos: con el ajuste liquidaciones.envio_al_seller en false,
-- el envío cobrado de los pedidos de la corrida no se le paga al comercio
-- (liquidacion_pedido lo deja fuera del neto). asentar_pago lo había
-- abonado a por_pagar_seller: al pagar la corrida se reclasifica a
-- ingreso_envios (asiento «envio»), así no queda una deuda con el comercio
-- que nunca se paga.
create or replace function public.tm_liquidacion_pagar(p_sesion text, p_id text, p_referencia text, p_comprobante uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_env_retenido numeric;
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  cfg tumbo.config;
  l tumbo.liquidaciones;
  c tumbo.cuentas_liquidacion;
  v_ret text;
  v_ref text := upper(trim(coalesce(p_referencia, '')));
  x tumbo.pedidos;
  lp jsonb;
  v_dif numeric := 0;
  v_neto_bs numeric;
  u record;
begin
  select * into l from tumbo.liquidaciones where id = p_id for update;
  if not found then
    raise exception 'Liquidación % no encontrada.', p_id;
  end if;
  if l.ciclo is null or l.ciclo not in ('aprobada', 'fallida') then
    raise exception 'Solo se paga una corrida aprobada (o una que falló).';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.seller_real(l.seller_id));
  -- la corrida del calendario no tiene quien la preparó: la paga otra
  -- persona que quien la aprobó (siempre intervienen dos)
  if not exists (select 1 from tumbo.liquidacion_eventos e where e.liquidacion_id = l.id and e.accion = 'preparar' and e.usuario_id is not null)
     and exists (select 1 from tumbo.liquidacion_eventos e where e.liquidacion_id = l.id and e.accion = 'aprobar' and e.usuario_id = yo.id) then
    raise exception 'Esta corrida la preparó el calendario y tú la aprobaste: la paga otra persona.';
  end if;
  v_ret := tumbo_privado.retencion_seller(l.seller_id);
  if v_ret is not null then
    raise exception 'Los fondos de % están retenidos (%): no se pagan.', l.seller_id, v_ret;
  end if;
  c := tumbo_privado.cuenta_vigente(l.seller_id);
  if c.id is null then
    raise exception 'El seller no tiene una cuenta de liquidación verificada y vigente.';
  end if;
  if char_length(v_ref) < 4 or char_length(v_ref) > 40 or v_ref !~ '^[A-Z0-9 ./_-]+$' then
    raise exception 'Escribe la referencia de la transferencia (de 4 a 40 letras sin tilde, números, espacios y . / _ -).';
  end if;
  if p_comprobante is not null and not exists (
       select 1 from tumbo.archivos a where a.id = p_comprobante and a.proposito = 'liquidacion' and a.entidad = l.id and a.estado = 'listo') then
    raise exception 'El comprobante no es válido: súbelo de nuevo en esta corrida.';
  end if;
  select * into cfg from tumbo.config;
  for x in select * from tumbo.pedidos where id = any (l.pedidos) order by id loop
    lp := tumbo_privado.liquidacion_pedido(x);
    v_dif := v_dif + round((lp ->> 'neto')::numeric * (cfg.tasa - x.tasa), 2);
  end loop;
  v_neto_bs := round(l.neto_usd * cfg.tasa, 2);
  update tumbo.liquidaciones
  set ciclo = 'pagada', estado = 'pagada', pagada_el = now(), fecha = tumbo_privado.hoy_caracas(), referencia_pago = v_ref,
      comprobante_archivo = p_comprobante, cuenta = tumbo_privado.cuenta_resumen(c), tasa_pago = cfg.tasa, neto_bs = v_neto_bs,
      diferencial_bs = v_dif, motivo = null
  where id = l.id;
  update tumbo.pedidos set liquidacion = 'liquidado', liquidacion_id = l.id where id = any (l.pedidos);
  insert into tumbo.pedido_eventos (pedido_id, actor, texto, icono)
  select unnest(l.pedidos), 'Finanzas', 'Incluido en la liquidación ' || l.id || ' (pagada)', 'receipt_long';
  perform tumbo_privado.liquidacion_evento(l.id, yo, 'pagar', v_ref);
  perform tumbo_privado.asentar('comision', l.id, 'Comisión y tarifas de la liquidación ' || l.id, tumbo_privado.actor(yo),
    jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', l.seller_id, 'debe', l.comision_usd + l.tarifa_usd),
                      jsonb_build_object('cuenta', 'ingreso_comision', 'haber', l.comision_usd + l.tarifa_usd)));
  perform tumbo_privado.asentar('liquidacion', l.id, 'Liquidación ' || l.id || ' pagada · ref. ' || v_ref, tumbo_privado.actor(yo),
    jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', l.seller_id, 'debe', l.neto_usd),
                      jsonb_build_object('cuenta', 'banco:VES', 'haber', l.neto_usd)));
  select coalesce(sum(x2.costo_envio_usd), 0) - coalesce(l.envio_usd, 0) into v_env_retenido
  from tumbo.pedidos x2 where x2.id = any (l.pedidos) and x2.pago_id is not null;
  if v_env_retenido > 0 then
    perform tumbo_privado.asentar('envio', l.id, 'Envío cobrado que retiene Tumbo en la liquidación ' || l.id || ' (no va al comercio)',
      tumbo_privado.actor(yo),
      jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', l.seller_id, 'debe', v_env_retenido),
                        jsonb_build_object('cuenta', 'ingreso_envios', 'haber', v_env_retenido)));
  end if;
  perform tumbo_privado.asentar('diferencial', l.id, 'Diferencial cambiario de la liquidación ' || l.id || ' (' || tumbo_privado.fmt_bs(v_dif) || ')',
    tumbo_privado.actor(yo),
    jsonb_build_array(jsonb_build_object('cuenta', 'diferencial_cambiario', 'debe', round(v_dif / cfg.tasa, 2)),
                      jsonb_build_object('cuenta', 'banco:VES', 'haber', round(v_dif / cfg.tasa, 2))));
  perform tumbo_privado.notificar('seller:' || l.seller_id,
    'Liquidación ' || l.id || ' pagada: ' || tumbo_privado.fmt_usd(l.neto_usd) || ' (' || tumbo_privado.fmt_bs(v_neto_bs) || ') · comprobante ' || l.comprobante,
    'receipt_long', 'seller/finanzas.html');
  for u in select id from tumbo.usuarios where seller_id = l.seller_id and rol = 'seller' and activo loop
    perform tumbo_privado.encolar(u.id, 'liquidacion_pagada', jsonb_build_object(
      'liquidacion', l.id, 'monto', tumbo_privado.fmt_usd(l.neto_usd) || ' (' || tumbo_privado.fmt_bs(v_neto_bs) || ')',
      'comprobante', l.comprobante || ' · ref. ' || v_ref, 'enlace', 'app/seller/finanzas.html'));
  end loop;
  perform tumbo_privado.auditar(yo, 'Liquidación ejecutada', l.id || ' → ' || l.seller_id || ' · ' || tumbo_privado.fmt_usd(l.neto_usd) ||
    ' · ' || tumbo_privado.fmt_bs(v_neto_bs) || ' · ref. ' || v_ref);
  return jsonb_build_object('id', l.id, 'ciclo', 'pagada', 'netoUsd', l.neto_usd, 'netoBs', v_neto_bs, 'comprobante', l.comprobante);
end $$;

-- ---------------------------------------------------------------------------
-- Baja de la cuenta: también lo que guardan los otros dominios
-- ---------------------------------------------------------------------------
-- Desde la de Cuentas: la baja también borra los datos personales que los
-- otros dominios guardan de sus compras (lo que promete «Eliminar mi
-- cuenta»):
--   · el destino de sus pedidos queda en la ciudad y el estado (sin
--     destinatario, cédula, teléfono, dirección ni punto de referencia);
--   · de sus pagos, los datos del pagador (cédula, teléfono, correo y
--     titular); de sus reembolsos, los del destino (queda el banco);
--   · su nombre en la línea de tiempo de sus pedidos y pagos, en sus
--     cancelaciones y en el historial de sus reembolsos queda «Comprador».
-- Se conservan los montos, los estados, la referencia del pago, los datos
-- fiscales de las facturas que pidió (cédula o RIF y razón social: son
-- registros fiscales) y la auditoría (que ya la nombra por su cuenta).
create or replace function tumbo_privado.anonimizar_cuenta(p_usuario uuid) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
  v_antes tumbo.usuarios;
begin
  select * into v_antes from tumbo.usuarios where id = p_usuario;
  perform tumbo_privado.bloquear_usuario(p_usuario, 'carrito');
  perform tumbo_privado.bloquear_usuario(p_usuario, 'direcciones');
  delete from tumbo.direcciones where usuario_id = p_usuario;
  delete from tumbo.carrito_items where usuario_id = p_usuario;
  delete from tumbo.usuarios_2fa where usuario_id = p_usuario;
  delete from tumbo.respaldo_2fa where usuario_id = p_usuario;
  delete from tumbo.desafios_2fa where usuario_id = p_usuario;
  delete from tumbo.codigos_verificacion where usuario_id = p_usuario;
  delete from tumbo.recuperaciones where usuario_id = p_usuario;
  delete from tumbo.dispositivos where usuario_id = p_usuario;
  delete from tumbo.redes_cuenta where usuario_id = p_usuario;
  delete from tumbo.permisos_usuario where usuario_id = p_usuario;
  delete from tumbo.preferencias_aviso where usuario_id = p_usuario;
  delete from tumbo.notificaciones where para = 'usr:' || p_usuario::text;
  delete from tumbo.salida where usuario_id = p_usuario;
  delete from tumbo.sesiones where usuario_id = p_usuario;
  perform tumbo_privado.revocar_invitaciones_de(p_usuario);
  -- lo que guardan de sus compras Logística (destino) y Pagos (pagador,
  -- destino de los reembolsos e historiales)
  update tumbo.pedidos x
  set destino = jsonb_strip_nulls(jsonb_build_object(
        'tipo', coalesce(x.destino ->> 'tipo', x.envio_tipo), 'ciudad', z.ciudad, 'estado', z.estado,
        'courier', x.destino ->> 'courier', 'opcion', x.destino ->> 'opcion', 'anonimizado', true)),
      envio_dir = case when x.envio_tipo = 'domicilio'
                       then left(coalesce(nullif(concat_ws(', ', z.ciudad, z.estado), ''), 'Dirección eliminada'), 300)
                       else x.envio_dir end
  from (select y.id,
               coalesce(nullif(btrim(y.destino ->> 'ciudad'), ''), nullif(btrim(split_part(coalesce(y.envio_dir, ''), ',', -1)), '')) as ciudad,
               tumbo_privado.destino_estado(tumbo_privado.destino_pedido(y)) as estado
        from tumbo.pedidos y where y.comprador_id = p_usuario) z
  where x.id = z.id;
  update tumbo.pagos set pagador = pagador - 'cedula' - 'telefono' - 'correo' - 'titular'
  where comprador_id = p_usuario and pagador <> '{}'::jsonb;
  update tumbo.reembolso_destinos d
  set datos = jsonb_strip_nulls(jsonb_build_object('tipo', d.datos ->> 'tipo', 'banco', d.datos ->> 'banco',
                                                   'banco_nombre', d.datos ->> 'banco_nombre', 'anonimizado', true)),
      actualizado = now()
  where d.reembolso_id in (select r.id from tumbo.reembolsos r left join tumbo.pedidos x on x.id = r.pedido_id
                           where r.comprador_id = p_usuario or x.comprador_id = p_usuario);
  update tumbo.reembolsos r
  set destino = jsonb_strip_nulls(jsonb_build_object('tipo', r.destino ->> 'tipo', 'banco', r.destino ->> 'banco',
                                                     'banco_nombre', r.destino ->> 'banco_nombre'))
  where r.destino is not null
    and (r.comprador_id = p_usuario or exists (select 1 from tumbo.pedidos x where x.id = r.pedido_id and x.comprador_id = p_usuario));
  update tumbo.pedido_eventos e set actor = 'Comprador'
  from tumbo.pedidos x
  where x.id = e.pedido_id and x.comprador_id = p_usuario and e.actor in (v_antes.nombre, v_antes.nombre || ' (' || v_antes.rol || ')');
  update tumbo.pago_eventos e set actor = 'Comprador'
  from tumbo.pagos g
  where g.id = e.pago_id and g.comprador_id = p_usuario and e.actor in (v_antes.nombre, v_antes.nombre || ' (' || v_antes.rol || ')');
  update tumbo.cancelaciones c set actor = 'Comprador'
  from tumbo.pedidos x
  where x.id = c.pedido_id and x.comprador_id = p_usuario and c.actor = v_antes.nombre || ' (' || v_antes.rol || ')';
  update tumbo.reembolso_eventos set actor = 'Comprador' where usuario_id = p_usuario;
  update tumbo.usuarios
  set email = 'eliminada-' || id::text || '@cuentas.tumbo.invalid', nombre = 'Cuenta eliminada',
      clave_hash = extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf', 4)),
      telefono = null, cedula = null, correo_verificado = false, telefono_verificado = false, mfa = false,
      bloqueado = false, bloqueo_motivo = null, bloqueado_el = null, bloqueado_por = null,
      activo = false, eliminado_el = now()
  where id = p_usuario
  returning * into u;
  return u;
end $$;

-- ---------------------------------------------------------------------------
-- Reinicio de la demo con datos reales
-- ---------------------------------------------------------------------------
-- ¿Qué datos de personas o comercios reales borraría el reinicio? Las
-- clases que encuentra (null si ninguna): el reinicio vacía los pedidos y
-- todo lo que cuelga de ellos (pagos, reembolsos, libro mayor, envíos), los
-- productos, los expedientes, las cuentas de liquidación, el crédito en
-- Tumbo, los ajustes y retenciones de los comercios, su configuración de
-- envíos y sus fotos de perfil, de todos los comercios.
create function tumbo_privado.reinicio_borra_reales() returns text
language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(', ',
    case when exists (select 1 from tumbo.pedidos p where tumbo_privado.pedido_real(p))
           or exists (select 1 from tumbo.pagos g where tumbo_privado.comprador_real(g.comprador_id)) then 'pedidos y pagos' end,
    case when exists (select 1 from tumbo.creditos c where tumbo_privado.comprador_real(c.usuario_id))
           or exists (select 1 from tumbo.reembolsos r where r.comprador_id is not null and tumbo_privado.comprador_real(r.comprador_id))
         then 'saldo a favor y reembolsos' end,
    case when exists (select 1 from tumbo.sellers s
                      where tumbo_privado.seller_real(s.id)
                        and (s.logo is not null or s.portada is not null
                             or exists (select 1 from tumbo.productos p where p.seller_id = s.id)
                             or exists (select 1 from tumbo.sellers_kyc k where k.seller_id = s.id and coalesce(k.rif, '—') <> '—')
                             or exists (select 1 from tumbo.seller_documentos d where d.seller_id = s.id and d.archivo_id is not null)
                             or exists (select 1 from tumbo.cuentas_liquidacion c where c.seller_id = s.id and not c.ficticia)
                             or exists (select 1 from tumbo.envio_config c where c.seller_id = s.id)
                             or exists (select 1 from tumbo.ajustes_seller a where a.seller_id = s.id)
                             or exists (select 1 from tumbo.retenciones r where r.seller_id = s.id)
                             or exists (select 1 from tumbo.liquidaciones l where l.seller_id = s.id)))
         then 'productos, expedientes y cuentas de comercios reales' end), '')
$$;

-- Desde la de semilla extensible. El reinicio (que una cuenta de prueba
-- puede pedir) ya no borra los datos de personas o comercios reales:
--   · si los hay (reinicio_borra_reales), solo lo pide una cuenta real de
--     superadministración con sesión elevada, que acepta borrarlos;
--   · las direcciones de las cuentas reales nunca se borran (solo las de
--     las cuentas de prueba, que la semilla vuelve a crear).
create or replace function public.tm_reiniciar_demo(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  v_reales text;
begin
  -- (un reinicio a la vez: mientras se decide, nadie crea datos reales nuevos que se pierdan)
  perform pg_advisory_xact_lock(hashtextextended('tumbo:reinicio_demo', 0));
  v_reales := tumbo_privado.reinicio_borra_reales();
  if v_reales is not null then
    if tumbo_privado.cuenta_demo(yo.email) then
      raise exception 'Hay datos de personas o comercios reales (%) y el reinicio los borraría: solo lo puede pedir una cuenta real de superadministración con verificación en dos pasos.', v_reales
        using errcode = '42501';
    end if;
    perform tumbo_privado.exigir_elevada(yo);
  end if;
  truncate tumbo.notificaciones_leidas, tumbo.notificaciones, tumbo.liquidaciones,
           tumbo.disputas, tumbo.pedido_eventos, tumbo.pedido_items, tumbo.reembolsos, tumbo.pedidos,
           tumbo.carrito_items restart identity;
  -- (con WHERE explícito: el proyecto usa pg-safeupdate, que rechaza DELETE sin condición)
  delete from tumbo.direcciones d
  where d.usuario_id in (select u.id from tumbo.usuarios u where tumbo_privado.cuenta_demo(u.email));
  update tumbo.archivos set estado = 'descartado', motivo = 'reinicio de la demo' where estado <> 'descartado';
  delete from tumbo.salida where plantilla in ('pago_confirmado', 'pedido_despachado', 'pedido_listo_retiro', 'pago_por_vencer',
                                               'pedido_por_aceptar', 'reclamo_actualizado', 'reembolso_enviado', 'liquidacion_pagada');
  delete from tumbo.productos where sku is not null;
  delete from tumbo.seller_documentos where seller_id is not null;
  delete from tumbo.sellers_kyc where seller_id is not null;
  perform tumbo_privado.sembrar(false);
  perform tumbo_privado.sembrar_extensiones(false);
  perform tumbo_privado.auditar(yo, 'Demo reiniciada', 'Datos de negocio restaurados a la semilla' ||
    case when v_reales is not null then ' · también se borraron ' || v_reales else '' end);
end $$;

-- ---------------------------------------------------------------------------
-- Invitación de un comercio nuevo: el RIF con su dígito verificador
-- ---------------------------------------------------------------------------
-- Desde la de Cuentas (la usa tm_invitar con el RIF de un comercio nuevo):
-- valida el dígito verificador con la misma regla de Catálogo
-- (rif_normalizado), así el expediente no nace con un RIF que después no se
-- puede guardar. Vacío: ''. Inválido: el error para quien invita.
create or replace function tumbo_privado.normalizar_rif(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[[:space:].-]', '', 'g'));
  r text;
begin
  if v = '' then return ''; end if;
  r := tumbo_privado.rif_normalizado(v);
  if r is null then
    raise exception 'El RIF no es válido: revisa la letra, los 8 números y el dígito verificador (p. ej. J-12345678-9), o déjalo vacío y el comercio lo cargará en su expediente.';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: no hay funciones public.tm_* nuevas (las redefinidas
-- conservan los suyos); lo de tumbo_privado no se invoca desde la API.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

notify pgrst, 'reload schema';
