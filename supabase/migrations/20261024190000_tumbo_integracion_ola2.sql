-- =========================================================================
-- Tumbo Market — Integración de la ola 2 (comunicación · crecimiento · plataforma)
-- -------------------------------------------------------------------------
-- Los tres equipos construyeron en paralelo sobre la integración de la ola
-- 1 (20261023190000); sus migraciones van ahora en 20261024150000 (comuni-
-- cación), 20261024160000 (crecimiento) y 20261024170000 (plataforma), y
-- esta une lo que cada uno dejó pedido a los demás (las «notas de
-- integración» de docs/dominios/*.md). Solo agrega: cada función redefinida
-- parte de su ÚLTIMA definición tras aplicar todas las anteriores y cambia
-- lo mínimo (el comentario de cada una dice qué).
--
--   1. Pagos expone dos contratos que Comunicación ya no escribe a mano en
--      tumbo.reembolsos: completar_reembolso_total (lo que falta para
--      devolver todo lo pagado, con el asiento de un reembolso completo) y
--      crear_reembolso_extra (un reembolso por encima de lo pagado, como el
--      reintegro del envío de vuelta, a cargo del comercio o de Tumbo).
--      disputa_reembolso_total y tm_disputa_envio_vuelta_resolver los usan.
--   2. El panel financiero distingue, dentro de lo congelado, los pedidos
--      con el reclamo ya resuelto que esperan el plazo de apelación
--      (tm_finanzas_resumen → congelado_apelacion).
--   3. Logística es dueña del texto de las instrucciones de devolución:
--      devolucion_paga_texto (la frase de quién paga el envío de vuelta,
--      también «lo paga Tumbo» y el reporte en el expediente) y el contrato
--      devolucion_pagador, que usa la resolución de los reclamos v2
--      (disputa_resolver_interno) en vez de reemplazar el texto con una
--      expresión que dependía de la redacción de Logística.
--   4. Archivos: archivo_permitido conecta el propósito «marketing» de
--      Crecimiento (marketing_puede_subir) y la limpieza de huérfanos
--      (tarea_archivos) reconoce todos los propósitos de la tabla (también
--      resena, soporte y marketing).
--   5. Cuentas: la baja (anonimizar_cuenta) borra también el consentimiento
--      de WhatsApp y las lecturas del chat y deja sin texto ni adjuntos los
--      casos de soporte de la persona (las aceptaciones legales quedan como
--      constancia).
--   6. Plataforma: el catálogo de tareas suma las de Comunicación
--      (envios, comunicacion) y Crecimiento (niveles, analitica) con su
--      dominio, descripción y frecuencia (también si pg_cron ya las había
--      adoptado como «Sin asignar»), y tm_reiniciar_demo mira el ajuste
--      demo_activa antes que nada.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. Pagos: completar a total y reembolso extra
-- ---------------------------------------------------------------------------
-- Contrato de Pagos: devuelve lo que falta de lo que pagó el comprador por
-- el pedido (con el IGTF; un pedido de antes de los pagos guiados, productos
-- y envío) como un reembolso más (crear_reembolso). Si antes hubo otro
-- reembolso de ese pedido, crear_reembolso lo asienta como parcial (contra
-- por_pagar_seller) y aquí se completa como el de un reembolso completo de
-- una vez: vuelve el IGTF por pagar y se revierte el descuento que asumió
-- Tumbo. → el id del reembolso, o null si no falta nada o el pago no se
-- verificó.
create function tumbo_privado.completar_reembolso_total(p_pedido text, p_motivo text, p_por text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  m jsonb;
  v_ya numeric;
  v_falta numeric;
  v_t numeric;
  v_i numeric;
  v_id bigint;
  v_real numeric;
begin
  select * into v from tumbo.pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Pedido % no encontrado.', p_pedido;
  end if;
  m := tumbo_privado.montos_pedido(v);
  select coalesce(sum(r.monto_usd), 0) into v_ya from tumbo.reembolsos r where r.pedido_id = v.id and r.tipo = 'pedido';
  v_falta := greatest(0, case when v.pago_id is null then tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd
                              else (m ->> 'pagado')::numeric end - v_ya);
  if v_falta <= 0 then
    return null;
  end if;
  v_id := tumbo_privado.crear_reembolso(v.id, v_falta, p_motivo);
  if v_id is null then
    return null;
  end if;
  select r.monto_usd into v_real from tumbo.reembolsos r where r.id = v_id;
  v_t := coalesce((m ->> 'descuento_tumbo')::numeric, 0);
  v_i := coalesce((m ->> 'igtf')::numeric, 0);
  if v.pago_id is not null and v_ya > 0 and v_ya + v_real = (m ->> 'pagado')::numeric and (v_t <> 0 or v_i <> 0) then
    perform tumbo_privado.asentar('reembolso', 'R-' || v_id,
      'Reembolso del pedido ' || v.id || ' completado a total (' || left(coalesce(p_motivo, 'reembolso'), 120) || '): IGTF y descuento de Tumbo',
      coalesce(p_por, 'Sistema'),
      jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', v.seller_id, 'debe', v_t - v_i),
                        jsonb_build_object('cuenta', 'igtf_por_pagar', 'debe', v_i),
                        jsonb_build_object('cuenta', 'descuentos_tumbo', 'haber', v_t)));
  end if;
  return v_id;
end $$;

-- Contrato de Pagos: un reembolso del pedido por encima de lo que pagó el
-- comprador (p. ej. el reintegro del envío de vuelta de una devolución), a
-- la tasa del día, con la doble aprobación por encima del umbral y su
-- asiento según quién lo carga:
--   · 'seller': contra por_pagar_seller y un ajuste negativo (sin asiento
--     propio) que lo descuenta de la próxima liquidación del comercio;
--   · 'tumbo': contra devoluciones_envio (gasto de Tumbo).
-- Quien lo pide avisa a Finanzas y al comprador con su propio texto.
create function tumbo_privado.crear_reembolso_extra(p_pedido text, p_monto_usd numeric, p_motivo text, p_cargo text, p_por text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  v_monto numeric := round(coalesce(p_monto_usd, 0), 2);
  v_tasa numeric := (select c.tasa from tumbo.config c limit 1);
  v_umbral numeric := tumbo_privado.numero(coalesce(tumbo_privado.ajuste('reembolsos'), '{}'::jsonb) -> 'umbral_doble_usd', 200);
  v_motivo text := left(coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Reembolso adicional'), 300);
  v_id bigint;
begin
  if p_cargo is null or p_cargo not in ('seller', 'tumbo') then
    raise exception 'Indica quién carga el reembolso: el comercio o Tumbo.';
  end if;
  if v_monto <= 0 then
    raise exception 'El monto del reembolso debe ser mayor que cero.';
  end if;
  select * into v from tumbo.pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Pedido % no encontrado.', p_pedido;
  end if;
  insert into tumbo.reembolsos (pedido_id, monto_usd, monto_bs, tasa, motivo, por, pago_id, comprador_id, requiere_doble, tipo)
  values (v.id, v_monto, round(v_monto * v_tasa, 2), v_tasa, v_motivo, coalesce(p_por, 'Sistema'), v.pago_id, v.comprador_id,
          v_monto >= v_umbral, 'pedido')
  returning id into v_id;
  if v.pago_id is not null then
    perform tumbo_privado.asentar('reembolso', 'R-' || v_id, left('Reembolso adicional del pedido ' || v.id || ' por pagar: ' || v_motivo, 300),
      coalesce(p_por, 'Sistema'),
      case when p_cargo = 'seller'
           then jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', v.seller_id, 'debe', v_monto),
                                  jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'haber', v_monto))
           else jsonb_build_array(jsonb_build_object('cuenta', 'devoluciones_envio', 'debe', v_monto),
                                  jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'haber', v_monto)) end);
  end if;
  if p_cargo = 'seller' then
    -- (sin asiento propio, como el reembolso parcial: el reembolso ya cargó por_pagar_seller)
    insert into tumbo.ajustes_seller (seller_id, monto_usd, motivo, por)
    values (v.seller_id, -v_monto, v_motivo, coalesce(p_por, 'Sistema'));
  end if;
  return v_id;
end $$;

-- Desde la de Comunicación: el reembolso total de un reclamo es el contrato
-- completar_reembolso_total de Pagos (antes asentaba aquí la parte que
-- completa el total). Misma firma y misma respuesta. → {reembolso_id, monto}
create or replace function tumbo_privado.disputa_reembolso_total(v tumbo.pedidos, p_disputa text, p_motivo text, p_actor text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  v_id := tumbo_privado.completar_reembolso_total(v.id, coalesce(p_motivo, 'Reclamo ' || p_disputa), coalesce(p_actor, 'Sistema'));
  if v_id is null then
    return jsonb_build_object('reembolso_id', null, 'monto', 0);
  end if;
  return jsonb_build_object('reembolso_id', v_id, 'monto', (select r.monto_usd from tumbo.reembolsos r where r.id = v_id));
end $$;

-- Desde la de Comunicación: el reintegro del envío de vuelta es el contrato
-- crear_reembolso_extra de Pagos (antes insertaba en tumbo.reembolsos, el
-- asiento y el ajuste al comercio por su cuenta). Lo demás, igual.
create or replace function public.tm_disputa_envio_vuelta_resolver(p_sesion text, p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  x jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  v_aprobar boolean;
  v_monto numeric;
  v_nota text := left(btrim(coalesce(x ->> 'nota', '')), 500);
  v_id bigint;
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found then raise exception 'Disputa % no encontrada.', p_id; end if;
  c := tumbo_privado.disputa_caso(d.id);
  if c.vuelta_estado is distinct from 'reportado' then
    raise exception 'No hay un envío de vuelta reportado por revisar en este reclamo.';
  end if;
  v := tumbo_privado.bloquear_pedido(d.pedido_id, yo);
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.pedido_real(v));
  if jsonb_typeof(x -> 'aprobar') is distinct from 'boolean' then
    raise exception 'Indica si se reintegra o no el envío de vuelta.';
  end if;
  v_aprobar := (x ->> 'aprobar')::boolean;
  if not v_aprobar then
    if char_length(v_nota) < 5 then
      raise exception 'Explica por qué no se reintegra (lo lee el comprador).';
    end if;
    update tumbo.disputa_casos set vuelta_estado = 'rechazado', vuelta_nota = v_nota, vuelta_por = tumbo_privado.actor(yo) where disputa_id = d.id;
    insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto)
    values (d.id, yo.id, 'sistema', 'Tumbo', left('Operaciones no reintegra el envío de vuelta: ' || regexp_replace(v_nota, '([^.!?])$', '\1.') ||
            ' Puedes reportarlo de nuevo con el recibo correcto.', 2000));
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Revisamos el envío de vuelta de tu reclamo ' || d.id || ': no se reintegra', 'local_shipping',
      'tienda/reclamo.html?id=' || d.pedido_id);
    perform tumbo_privado.auditar(yo, 'Envío de vuelta rechazado', d.id || ' · ' || v_nota);
    return jsonb_build_object('ok', true, 'estado', 'rechazado');
  end if;
  if v.estado <> 'reembolsado' then
    raise exception 'Primero cierra la devolución con su reembolso (en el detalle del pedido): el envío de vuelta se reintegra después.';
  end if;
  begin
    v_monto := round(coalesce(nullif(x ->> 'monto_usd', '')::numeric, c.vuelta_usd), 2);
  exception when others then
    raise exception 'El monto no es válido.';
  end;
  if v_monto is null or v_monto <= 0 or v_monto > c.vuelta_usd then
    raise exception 'El reintegro va de $0.01 a lo que reportó el comprador (%).', tumbo_privado.fmt_usd(c.vuelta_usd);
  end if;
  v_id := tumbo_privado.crear_reembolso_extra(v.id, v_monto,
    'Reintegro del envío de vuelta (reclamo ' || d.id || '; lo paga ' || case c.paga_logistica when 'seller' then 'el comercio' else 'Tumbo' end || ')',
    case when c.paga_logistica = 'seller' then 'seller' else 'tumbo' end, tumbo_privado.actor(yo));
  if c.paga_logistica = 'seller' then
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'El envío de vuelta del reclamo ' || d.id || ' (' || tumbo_privado.fmt_usd(v_monto) ||
      ') se descuenta de tu próxima liquidación', 'local_shipping', 'seller/finanzas.html');
  end if;
  update tumbo.disputa_casos
  set vuelta_estado = 'reintegrado', vuelta_reintegro_usd = v_monto, vuelta_reembolso_id = v_id, vuelta_nota = nullif(v_nota, ''),
      vuelta_por = tumbo_privado.actor(yo)
  where disputa_id = d.id;
  insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto)
  values (d.id, yo.id, 'sistema', 'Tumbo', 'Se reintegra el envío de vuelta: ' || tumbo_privado.fmt_usd(v_monto) ||
          '. Elige dónde recibirlo en «Mis reembolsos».');
  perform tumbo_privado.notificar('rol:finanzas', 'Reembolso de ' || tumbo_privado.fmt_usd(v_monto) || ' por enviar (' || v.id || ', envío de vuelta)',
    'undo', 'admin/reembolsos.html');
  perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tienes un reembolso de ' || tumbo_privado.fmt_usd(v_monto) ||
    ' por el envío de vuelta del pedido ' || v.id || ': indica dónde quieres recibirlo', 'undo', 'tienda/reembolsos.html');
  perform tumbo_privado.auditar(yo, 'Reintegro del envío de vuelta', d.id || ' · R-' || v_id || ' · ' || tumbo_privado.fmt_usd(v_monto) ||
    ' · lo paga ' || c.paga_logistica);
  return jsonb_build_object('ok', true, 'estado', 'reintegrado', 'reembolso', v_id, 'monto', v_monto);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Panel financiero: lo congelado por el plazo de apelación
-- ---------------------------------------------------------------------------
-- Desde la de Pagos: además de «congelado» (todo lo que espera un reclamo),
-- congelado_apelacion es la parte de los pedidos con el reclamo ya resuelto
-- (a favor del comercio o con un reembolso parcial) que esperan a que venza
-- el plazo de apelación del comprador (Comunicación los pasa a elegibles).
create or replace function public.tm_finanzas_resumen(p_sesion text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  v_hasta date := coalesce(p_hasta, tumbo_privado.hoy_caracas());
  v_desde date := coalesce(p_desde, v_hasta - 30);
begin
  if v_desde > v_hasta or v_hasta - v_desde > 400 then
    raise exception 'Elige un período de hasta 400 días.';
  end if;
  return jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'cobrado', (select jsonb_build_object('n', count(*), 'usd', coalesce(sum(g.total_usd), 0), 'bs', coalesce(sum(g.total_bs), 0))
                from tumbo.pagos g where g.estado = 'verificado'
                  and (g.verificado_el at time zone 'America/Caracas')::date between v_desde and v_hasta),
    'por_verificar', (select jsonb_build_object('n', count(*),
                               'reportados', count(*) filter (where g.estado = 'reportado'),
                               'usd', coalesce(sum((tumbo_privado.pago_esperado(g) ->> 'usd')::numeric), 0),
                               'bs', coalesce(sum((tumbo_privado.pago_esperado(g) ->> 'bs')::numeric), 0))
                      from tumbo.pagos g where g.estado in ('pendiente', 'reportado')),
    'vencidos_recientes', (select count(*) from tumbo.pagos g where g.estado = 'vencido' and g.vence > now() - interval '7 days'),
    'retenido', (select coalesce(sum((tumbo_privado.liquidacion_pedido(x) ->> 'neto')::numeric), 0) from tumbo.pedidos x where x.liquidacion = 'retenido'),
    'congelado', (select coalesce(sum((tumbo_privado.liquidacion_pedido(x) ->> 'neto')::numeric), 0) from tumbo.pedidos x where x.liquidacion = 'congelado'),
    'congelado_apelacion', (select coalesce(sum((tumbo_privado.liquidacion_pedido(x) ->> 'neto')::numeric), 0) from tumbo.pedidos x
                            where x.liquidacion = 'congelado'
                              and exists (select 1 from tumbo.disputas d where d.id = x.disputa_id and d.estado = 'resuelta')),
    'dias_apelacion', tumbo_privado.comunicacion('dias_apelacion', 5)::integer,
    'por_liquidar', (select jsonb_build_object(
                       'elegible', coalesce((select sum((tumbo_privado.liquidacion_pedido(x) ->> 'neto')::numeric) from tumbo.pedidos x
                                             where tumbo_privado.pedido_liquidable(x)), 0),
                       'en_corridas', coalesce((select sum(l.neto_usd) from tumbo.liquidaciones l where l.ciclo in ('preparada', 'aprobada', 'fallida')), 0),
                       'corridas', (select coalesce(jsonb_object_agg(z.ciclo, z.n), '{}'::jsonb)
                                    from (select ciclo, count(*) as n from tumbo.liquidaciones where ciclo in ('preparada', 'aprobada', 'fallida') group by ciclo) z))),
    'reembolsos', (select jsonb_build_object('n', count(*), 'usd', coalesce(sum(r.monto_usd), 0),
                                             'sin_destino', count(*) filter (where r.destino is null),
                                             'fallidos', count(*) filter (where r.estado = 'fallido'))
                   from tumbo.reembolsos r where r.estado in ('pendiente', 'en_proceso', 'fallido')),
    'excepciones', (select count(*) from tumbo.movimientos_banco where estado = 'excepcion'),
    'cuentas_por_verificar', (select count(*) from tumbo.cuentas_liquidacion where estado = 'pendiente'),
    'comisiones', (select coalesce(sum(l.haber) - sum(l.debe), 0) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                   where l.cuenta = 'ingreso_comision' and (a.fecha at time zone 'America/Caracas')::date between v_desde and v_hasta),
    'igtf', (select coalesce(sum(l.haber) - sum(l.debe), 0) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
             where l.cuenta = 'igtf_por_pagar' and (a.fecha at time zone 'America/Caracas')::date between v_desde and v_hasta),
    'tasa', public.tm_tasa_vigente(),
    'tasa_propuesta', (select jsonb_build_object('id', t.id, 'valor', t.valor, 'fecha', t.fecha, 'propuesta_por', t.propuesta_por_nombre,
                                                 'mia', t.propuesta_por is not distinct from yo.id, 'automatica', t.automatica,
                                                 'fuente', t.fuente, 'nota', t.nota)
                       from tumbo.tasas t where t.estado = 'propuesta' order by t.id desc limit 1),
    'ultimo_cierre', (select to_jsonb(c) from tumbo.cierres c order by c.fecha desc limit 1));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Logística: quién paga el envío de vuelta
-- ---------------------------------------------------------------------------
-- La frase de las instrucciones de devolución que dice quién paga el envío
-- de vuelta. Cuando lo paga el comercio o Tumbo, el comprador que lo pagó
-- lo reporta en el expediente del reclamo («Envío de vuelta», de
-- Comunicación) y Operaciones se lo reintegra.
create function tumbo_privado.devolucion_paga_texto(p_paga text) returns text
language sql immutable set search_path = '' as $$
  select case p_paga
    when 'seller' then 'El envío de vuelta lo paga el comercio: pide «cobro en destino» si la agencia lo ofrece; si no, pagas tú, guardas el recibo y lo reportas en el expediente del reclamo («Envío de vuelta») para que te lo reintegremos.'
    when 'tumbo' then 'El envío de vuelta lo paga Tumbo: guarda el recibo y repórtalo en el expediente del reclamo («Envío de vuelta») para que te lo reintegremos.'
    else 'El envío de vuelta lo pagas tú.' end
$$;

-- Desde la de Logística: la frase de quién paga sale de devolucion_paga_texto.
create or replace function tumbo_privado.devolucion_crear(p_pedido text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  d tumbo.disputas;
  e tumbo.envios := tumbo_privado.envio_asegurar(p_pedido);
  c tumbo.envio_config;
  s tumbo.sellers;
  k tumbo.couriers;
  o tumbo.oficinas;
  v_paga text;
  v_texto text;
begin
  select * into v from tumbo.pedidos where id = p_pedido;
  if not found or exists (select 1 from tumbo.devoluciones where pedido_id = p_pedido and estado <> 'cerrada') then
    return;
  end if;
  select * into d from tumbo.disputas where id = v.disputa_id;
  select * into s from tumbo.sellers where id = v.seller_id;
  c := tumbo_privado.config_envio(v.seller_id);
  select * into k from tumbo.couriers where codigo = coalesce(e.courier, 'mrw');
  if k.tipo is distinct from 'courier' then
    select * into k from tumbo.couriers where codigo = coalesce(c.couriers[1], 'mrw');
  end if;
  select * into o from tumbo.oficinas
  where courier = k.codigo and estado = c.origen_estado and activa order by (tumbo_privado.lugar_clave(ciudad) = tumbo_privado.lugar_clave(c.origen_ciudad)) desc, id limit 1;
  v_paga := case when d.motivo in ('Producto dañado', 'Producto incorrecto', 'Faltan piezas o accesorios',
                                   'No coincide con la descripción', 'No llegó') then 'seller' else 'comprador' end;
  v_texto := 'Empaca el producto con todos sus accesorios y envíalo con ' || coalesce(k.nombre, 'el courier') || ' a ' ||
             coalesce(o.nombre || ' (' || o.direccion || ', ' || o.ciudad || ')',
                      'una agencia de ' || coalesce(k.nombre, 'courier') || ' en ' || c.origen_ciudad || ', a nombre de ' || s.nombre ||
                      ' (Operaciones te confirma la agencia exacta)') || '. ' ||
             tumbo_privado.devolucion_paga_texto(v_paga) ||
             ' Cuando lo envíes, registra aquí la guía.';
  insert into tumbo.devoluciones (pedido_id, seller_id, disputa_id, motivo, paga, oficina_id, instrucciones)
  values (v.id, v.seller_id, v.disputa_id, d.motivo, v_paga, o.id, left(v_texto, 900))
  on conflict (pedido_id) do update set disputa_id = excluded.disputa_id, motivo = excluded.motivo, paga = excluded.paga,
    oficina_id = excluded.oficina_id, instrucciones = excluded.instrucciones, estado = 'instrucciones', courier = null, guia = null,
    enviada_en = null, recibida_en = null, inspeccion = null, inspeccion_nota = null, inspeccion_foto = null,
    inspeccionada_por = null, cerrada_en = null, actualizado = now();
  perform tumbo_privado.evento(v.id, 'Operaciones', 'Instrucciones de devolución listas: envía el producto con ' || coalesce(k.nombre, 'el courier') ||
    ' · el envío lo paga ' || case when v_paga = 'seller' then 'el comercio' else 'el comprador' end, 'assignment_return');
end $$;

-- Contrato de Logística: quién paga el envío de vuelta de la devolución en
-- curso de un pedido ('comprador', 'seller' o 'tumbo'). Cambia «paga» y, en
-- las instrucciones, la frase de quién paga (la de devolucion_paga_texto o
-- la que escribía Logística antes de esta migración); si Operaciones las
-- reescribió sin esa frase, la agrega al final. → true si había una
-- devolución en curso.
create function tumbo_privado.devolucion_pagador(p_pedido text, p_paga text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  dv tumbo.devoluciones;
  v_nueva text := tumbo_privado.devolucion_paga_texto(p_paga);
  v_frases text[] := array[tumbo_privado.devolucion_paga_texto('seller'), tumbo_privado.devolucion_paga_texto('tumbo'),
                           tumbo_privado.devolucion_paga_texto('comprador'),
                           'El envío de vuelta lo paga el comercio: pide «cobro en destino» si la agencia lo ofrece o guarda el recibo.'];
  v_texto text;
  f text;
begin
  if p_paga is null or p_paga not in ('comprador', 'seller', 'tumbo') then
    raise exception 'Indica quién paga el envío de vuelta (comprador, comercio o Tumbo).';
  end if;
  select * into dv from tumbo.devoluciones where pedido_id = p_pedido and estado <> 'cerrada' for update;
  if not found then
    return false;
  end if;
  v_texto := coalesce(dv.instrucciones, '');
  foreach f in array v_frases loop
    if position(f in v_texto) > 0 then
      v_texto := replace(v_texto, f, v_nueva);
      v_nueva := null;
      exit;
    end if;
  end loop;
  if v_nueva is not null then
    v_texto := btrim(v_texto || ' ' || v_nueva);
  end if;
  update tumbo.devoluciones set paga = p_paga, instrucciones = left(v_texto, 900), actualizado = now() where pedido_id = p_pedido;
  return true;
end $$;

-- Desde la de Comunicación: quién paga el envío de vuelta lo fija el
-- contrato devolucion_pagador de Logística (antes se reemplazaba la frase
-- de las instrucciones con una expresión regular). Lo demás, igual.
create or replace function tumbo_privado.disputa_resolver_interno(p_yo tumbo.usuarios, p_id text, p_decision text, p_nota text,
                                                       p_monto numeric, p_paga text, p_plantilla text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  v_auto boolean := p_yo.id is null;
  v_nota text := left(trim(coalesce(p_nota, '')), 500);
  v_monto numeric;
  r jsonb;
  v_aj bigint;
  v_txt text;
  v_hasta timestamptz := now() + make_interval(days => tumbo_privado.comunicacion('dias_apelacion', 5)::integer);
  v_paga text;
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found then raise exception 'Disputa % no encontrada.', p_id; end if;
  if v_auto then
    -- (ya con el reclamo bloqueado: si el comercio respondió mientras la
    -- tarea lo elegía, o alguien lo resolvió, el fallo automático no va)
    c := tumbo_privado.disputa_caso(p_id);
    if d.estado <> 'abierta' or c.respondida_en is not null or c.decision is not null or c.plazo_seller >= now() then
      return false;
    end if;
  end if;
  if d.estado = 'resuelta' then raise exception 'La disputa % ya está resuelta.', p_id; end if;
  if p_decision is null or p_decision not in ('reembolso', 'reembolso_parcial', 'devolucion', 'liberar') then
    raise exception 'Decisión inválida.';
  end if;
  if v_auto then
    select * into v from tumbo.pedidos where id = d.pedido_id for update;
  else
    v := tumbo_privado.bloquear_pedido(d.pedido_id, p_yo);
    perform tumbo_privado.exigir_si_real(p_yo, tumbo_privado.pedido_real(v));
  end if;
  c := tumbo_privado.disputa_caso(p_id);
  if p_decision = 'reembolso_parcial' then
    v_monto := round(coalesce(p_monto, 0), 2);
    if v.estado <> 'entregado' then
      raise exception 'El reembolso parcial es para un pedido entregado (el comprador se queda con el producto).';
    end if;
    if v_monto <= 0 or v_monto >= tumbo_privado.disputa_tope_parcial(v) then
      raise exception 'El reembolso parcial va de $0.01 a menos de % (lo que pagó el comprador o lo que cobra el comercio por el pedido, lo menor); para devolver todo, elige el reembolso total.',
        tumbo_privado.fmt_usd(tumbo_privado.disputa_tope_parcial(v));
    end if;
  end if;
  if p_paga is not null and (p_decision <> 'devolucion' or p_paga not in ('comprador', 'seller', 'tumbo')) then
    raise exception 'Quién paga el envío de vuelta se indica solo en una devolución (comprador, comercio o Tumbo).';
  end if;

  perform set_config('tumbo.disputa_v2', p_id, true);
  update tumbo.disputas
  set estado = 'resuelta', resolucion_decision = case when p_decision = 'reembolso_parcial' then 'reembolso' else p_decision end,
      resolucion_nota = left(case when p_decision = 'reembolso_parcial'
                                  then 'Reembolso parcial de ' || tumbo_privado.fmt_usd(v_monto) || ' (no es total; el resto se libera al comercio).' ||
                                       case when v_nota <> '' then ' ' || v_nota else '' end
                                  else v_nota end, 500),
      resolucion_fecha = now()
  where id = p_id;

  if p_decision = 'reembolso' then
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, case when v_auto then 'Sistema' else 'Operaciones' end,
      case when v_auto then 'Fallo automático: el comercio no respondió el reclamo a tiempo · reembolso total en cola'
           else 'Disputa resuelta a favor del comprador · reembolso total en cola' end, 'undo');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue aprobado: el reembolso está en proceso', 'undo', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con reembolso al comprador' ||
      case when v_auto then ' (fallo automático: no respondiste a tiempo)' else '' end, 'gavel', 'seller/disputas.html');
    v_monto := tumbo_privado.disputa_total_reembolso(v);
    r := tumbo_privado.disputa_reembolso_total(v, p_id, 'Reclamo ' || p_id || ' resuelto con reembolso',
                                               case when v_auto then 'Sistema' else tumbo_privado.actor(p_yo) end);
    if (r ->> 'reembolso_id') is not null then
      v_monto := (r ->> 'monto')::numeric;
    end if;
  elsif p_decision = 'reembolso_parcial' then
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'congelado' where id = d.pedido_id;
    r := tumbo_privado.disputa_reembolso_parcial(v, v_monto, p_id, 'Reclamo ' || p_id || ': reembolso parcial');
    v_monto := (r ->> 'monto')::numeric;
    v_aj := (r ->> 'ajuste_id')::bigint;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta con un reembolso parcial de ' || tumbo_privado.fmt_usd(v_monto) ||
      ' · el resto se libera al comercio al vencer el plazo de apelación (' || tumbo_privado.fecha_legible(v_hasta) || ')', 'undo');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' se resolvió con un reembolso parcial de ' || tumbo_privado.fmt_usd(v_monto),
      'undo', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con un reembolso parcial de ' || tumbo_privado.fmt_usd(v_monto) ||
      ' a cargo de tu comercio (se descuenta de tu próxima liquidación)', 'gavel', 'seller/finanzas.html');
  elsif p_decision = 'devolucion' then
    update tumbo.pedidos set estado = 'devolucion' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta: devolución del producto · Operaciones envía las instrucciones', 'assignment_return');
    if p_paga is not null then
      -- (la devolución la creó Logística al pasar el pedido a «devolución»)
      perform tumbo_privado.devolucion_pagador(d.pedido_id, p_paga);
      perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'El envío de vuelta lo paga ' ||
        case p_paga when 'seller' then 'el comercio' when 'tumbo' then 'Tumbo' else 'el comprador' end, 'assignment_return');
    end if;
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ': coordinaremos la devolución del producto', 'assignment_return', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con devolución', 'assignment_return', 'seller/disputas.html');
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'congelado' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa cerrada a favor del seller · fondos elegibles al vencer el plazo de apelación (' ||
      tumbo_privado.fecha_legible(v_hasta) || ')', 'lock_open');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue revisado y cerrado sin reembolso', 'gavel', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se cerró a tu favor: los fondos pasan a elegibles el ' ||
      tumbo_privado.fecha_legible(v_hasta) || ' si el comprador no apela', 'lock_open', 'seller/disputas.html?id=' || p_id);
  end if;

  v_paga := case when p_decision = 'devolucion' then coalesce(p_paga, (select dv.paga from tumbo.devoluciones dv where dv.pedido_id = d.pedido_id)) end;
  update tumbo.disputa_casos
  set decision = p_decision,
      reembolso_usd = case when p_decision in ('reembolso', 'reembolso_parcial') then v_monto end,
      paga_logistica = v_paga,
      plantilla = left(p_plantilla, 40), resuelta_por = p_yo.id,
      resuelta_por_nombre = case when v_auto then 'Sistema' else p_yo.nombre || ' (' || p_yo.rol || ')' end,
      resuelta_en = now(), fallo_automatico = v_auto, ajuste_id = v_aj
  where disputa_id = p_id;
  update tumbo.disputa_solicitudes set estado = 'cancelada' where disputa_id = p_id and estado = 'pendiente';
  v_txt := tumbo_privado.disputa_texto(p_decision, v_monto, v_paga);
  insert into tumbo.disputa_mensajes (disputa_id, lado, autor, texto)
  values (p_id, 'sistema', 'Tumbo', left('Decisión' || case when v_auto then ' automática' else '' end || ': ' || v_txt || '.' ||
          case when v_nota <> '' then ' ' || regexp_replace(v_nota, '([^.!?])$', '\1.') else '' end ||
          ' Si no estás de acuerdo, puedes apelar una vez, con evidencia nueva, hasta el ' || tumbo_privado.fecha_legible(v_hasta) || '.' ||
          case when p_decision in ('liberar', 'reembolso_parcial') then ' Hasta esa fecha los fondos del pedido siguen retenidos.' else '' end, 2000));
  perform tumbo_privado.disputa_avisar(d, 'resuelto: ' || v_txt, 'resuelto: ' || v_txt);
  if v_auto then
    perform tumbo_privado.auditar(p_yo, 'Resolución de disputa', p_id || ' → reembolso (fallo automático: el comercio no respondió)');
  else
    perform tumbo_privado.auditar(p_yo, 'Resolución de disputa', p_id || ' → ' || p_decision ||
      case when p_decision = 'reembolso_parcial' then ' ' || tumbo_privado.fmt_usd(v_monto) else '' end ||
      case when p_paga is not null then ' · envío de vuelta: ' || p_paga else '' end);
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Archivos: el propósito «marketing» y la limpieza de huérfanos
-- ---------------------------------------------------------------------------
-- Desde la de la integración de la ola 1: la rama «marketing» (Crecimiento:
-- banners y colecciones de la portada; los sube el equipo de marketing con
-- una cuenta real, en la entidad «marketing»). Los propósitos de
-- Comunicación siguen en archivo_permitido_comunicacion, que consultan
-- tm_archivo_preparar y tm_archivo_acceso.
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
  elsif p_proposito = 'marketing' then
    v_ok := tumbo_privado.marketing_puede_subir(p_yo, p_entidad);
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

-- Desde la de fundaciones: los objetos huérfanos (sin fila) se reconocen por
-- la forma de ruta de Tumbo con cualquiera de los propósitos de la tabla
-- (la expresión fija no tenía resena, soporte ni marketing).
create or replace function tumbo_privado.tarea_archivos(p_limite integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_buckets text[] := tumbo_privado.buckets_tumbo();
  v jsonb := '[]'::jsonb;
begin
  update tumbo.archivos set estado = 'descartado', motivo = 'no se confirmó a tiempo'
  where estado = 'pendiente' and creado < now() - tumbo_privado.vigencia_subida();
  if to_regclass('storage.objects') is null then
    update tumbo.archivos set eliminado = now() where estado = 'descartado' and eliminado is null;
  else
    update tumbo.archivos a set eliminado = now()
    where a.estado = 'descartado' and a.eliminado is null
      and not exists (select 1 from storage.objects o where o.name = a.ruta and o.bucket_id = any (v_buckets));
    select coalesce(jsonb_agg(jsonb_build_object('bucket', x.bucket_id, 'ruta', x.name)), '[]'::jsonb) into v
    from (select o.bucket_id, o.name
          from storage.objects o
          where o.bucket_id = any (v_buckets)
            and (exists (select 1 from tumbo.archivos a where a.ruta = o.name and a.estado = 'descartado')
                 or (o.created_at < now() - interval '10 minutes'
                     and o.name ~ '^[a-z_]+/[A-Za-z0-9-]+/[0-9a-f-]{36}\.(jpg|png|webp|pdf|mp4|bin)$'
                     and split_part(o.name, '/', 1) in (select p.proposito from tumbo.archivo_propositos p)
                     and not exists (select 1 from tumbo.archivos a where a.ruta = o.name)))
          order by o.created_at
          limit greatest(1, least(coalesce(p_limite, 100), 1000))) x;
  end if;
  delete from tumbo.archivos where eliminado < now() - interval '1 day' and creado < now() - interval '1 day';
  return jsonb_build_object('borrar', v);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Cuentas: la baja borra también lo de Comunicación
-- ---------------------------------------------------------------------------
-- Desde la de la integración de la ola 1. Además:
--   · se borran el consentimiento de WhatsApp (con el teléfono) y las
--     marcas de lectura del chat;
--   · sus casos de soporte quedan cerrados, sin asunto, sin el texto de sus
--     mensajes y sin sus adjuntos (descartados); el caso, su categoría y sus
--     fechas se conservan para las métricas del soporte;
--   · las aceptaciones de los documentos legales se conservan (constancia).
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
  -- lo que guarda Comunicación (ola 2)
  delete from tumbo.consentimientos_whatsapp where usuario_id = p_usuario;
  delete from tumbo.chat_lecturas where usuario_id = p_usuario;
  update tumbo.archivos set estado = 'descartado', motivo = 'baja de la cuenta'
  where propietario = p_usuario and proposito = 'soporte' and estado <> 'descartado';
  update tumbo.ticket_mensajes
  set texto = '(Mensaje borrado: la persona dio de baja su cuenta.)', adjuntos = '{}', autor = 'Cuenta eliminada'
  where lado = 'cliente' and (autor_id = p_usuario or ticket_id in (select t.id from tumbo.tickets t where t.usuario_id = p_usuario));
  update tumbo.tickets
  set asunto = 'Caso de una cuenta eliminada', estado = 'cerrado', cerrado = coalesce(cerrado, now()), actualizado = now()
  where usuario_id = p_usuario;
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
-- 6. Plataforma: el catálogo de tareas y el interruptor de la demo
-- ---------------------------------------------------------------------------
-- Desde la de la plataforma: el catálogo suma las tareas de Comunicación y
-- Crecimiento (sus migraciones van antes que la de la plataforma) con el
-- nombre y el horario con que ya las programaron. Si pg_cron ya las había
-- adoptado («Sin asignar», sin descripción), se completan su dominio, su
-- descripción y su frecuencia (el trabajo y el horario quedan como están).
create or replace function tumbo_privado.catalogo_tareas_base() returns void
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
    ('envios', 'tarea_envios', 'tumbo-envios', '* * * * *', 'Comunicación',
     'Envío de la bandeja de salida: llama a la función tumbo-envios (con pg_net y el ajuste «envios») cuando hay correos o WhatsApp que puede enviar.', true, 1),
    ('comunicacion', 'tarea_comunicacion', 'tumbo-comunicacion', '*/15 * * * *', 'Comunicación',
     'Plazos de los reclamos (recordatorio 24 h antes y fallo automático), evidencia vencida, SLA de soporte, fondos liberados al vencer la apelación y versión vigente de los términos.', true, 15),
    ('niveles', 'tarea_niveles', 'tumbo-crecimiento-niveles', '20 9 * * *', 'Crecimiento',
     'Recalcula el nivel de cada comercio (Tumbo Líder, Oro y Platino), su beneficio en la comisión y le avisa (05:20, hora de Caracas).', true, 1440),
    ('analitica', 'tarea_analitica', 'tumbo-crecimiento-analitica', '40 9 * * *', 'Crecimiento',
     'Purga los eventos de analítica más viejos que los días que se conservan (05:40, hora de Caracas).', true, 1440),
    ('almacenamiento', 'tarea_almacenamiento', 'tumbo-almacenamiento', '23 * * * *', 'Plataforma',
     'Limpieza de archivos: pide a la función tumbo-archivos (con pg_net) que borre lo descartado y lo que no se confirmó.', true, 60),
    ('mantenimiento', 'tarea_mantenimiento', 'tumbo-mantenimiento', '41 7 * * *', 'Plataforma',
     'Purga los errores del navegador de más de 30 días, las corridas de más de 60 y los contadores de topes.', true, 1440),
    ('archivos', 'tarea_archivos', null, null, 'Fundaciones',
     'Decide qué archivos sobran en Storage. La corre la función tumbo-archivos al recibir subidas (y tumbo-almacenamiento por pg_net).', false, null)
  on conflict do nothing;
  update tumbo.tareas_programadas t
  set dominio = c.dominio, descripcion = c.descripcion, cada_min = coalesce(t.cada_min, c.cada_min)
  from (values
    ('tarea_envios', 'Comunicación',
     'Envío de la bandeja de salida: llama a la función tumbo-envios (con pg_net y el ajuste «envios») cuando hay correos o WhatsApp que puede enviar.', 1),
    ('tarea_comunicacion', 'Comunicación',
     'Plazos de los reclamos (recordatorio 24 h antes y fallo automático), evidencia vencida, SLA de soporte, fondos liberados al vencer la apelación y versión vigente de los términos.', 15),
    ('tarea_niveles', 'Crecimiento',
     'Recalcula el nivel de cada comercio (Tumbo Líder, Oro y Platino), su beneficio en la comisión y le avisa (05:20, hora de Caracas).', 1440),
    ('tarea_analitica', 'Crecimiento',
     'Purga los eventos de analítica más viejos que los días que se conservan (05:40, hora de Caracas).', 1440)) c (funcion, dominio, descripcion, cada_min)
  where t.funcion = c.funcion and t.dominio = 'Sin asignar';
$$;

do $$ begin perform tumbo_privado.catalogo_tareas_base(); end $$;

-- Con pg_cron: los trabajos de Comunicación y Crecimiento ya los adoptó y
-- envolvió la migración de la plataforma; repetirlo no cambia nada (deja
-- cada uno con el envoltorio y el nombre del catálogo).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform tumbo_privado.programar_tareas();
  end if;
end $$;

-- Desde la de la integración de la ola 1: con la demo apagada (ajuste
-- demo_activa = false, de la plataforma) el reinicio se rechaza antes que
-- nada (antes lo frenaba sembrar_ext_plataforma al final, y el error
-- deshacía lo ya vaciado). Lo demás, igual.
create or replace function public.tm_reiniciar_demo(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios;
  v_reales text;
begin
  if coalesce(tumbo_privado.ajuste('demo_activa'), 'true'::jsonb) = 'false'::jsonb then
    raise exception 'La demo está apagada (ajuste demo_activa): el reinicio borraría los pedidos, productos y expedientes reales y ya no está disponible.'
      using errcode = '42501';
  end if;
  yo := tumbo_privado.exigir(p_sesion, array['superadmin']);
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
-- Privilegios: no hay funciones public.tm_* nuevas (las redefinidas
-- conservan los suyos); lo de tumbo_privado no se invoca desde la API.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

notify pgrst, 'reload schema';
