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
-- 7. Revisión de la integración (hallazgos corregidos antes de desplegar)
-- ---------------------------------------------------------------------------
-- Cada función parte de su última definición (también las de las secciones
-- de arriba) y cambia lo que dice su comentario:
--   a. Promociones: el registro del checkout no cuenta el propio pago al
--      recalcular (varios comercios con un cupón de un uso, el último
--      presupuesto o una relámpago); el pago recibido tarde no se reactiva
--      si sus unidades relámpago o su cupón ya los tomó otra compra; la
--      cancelación de un pedido devuelve al presupuesto su parte del cupón
--      de Tumbo y no deja el resto por debajo de la compra mínima.
--   b. Reclamos: la apelación que pasa a reembolso total devuelve el
--      descuento del parcial aunque ya haya entrado en una corrida, y la que
--      pasa a devolución fija quién paga con el contrato de Logística.
--   c. Niveles y métricas cuentan como perdido un reclamo con el criterio de
--      la reputación (no el que el comercio ganó en la apelación).
--   d. Cuentas de prueba del comercio frente a compradores reales: no leen
--      ni responden sus reclamos, su chat ni su evidencia, ni responden sus
--      preguntas y reseñas (el fallo automático sigue su curso).
--   e. Ajustes: los de seguridad (sitio_url, envios, funciones_url) solo los
--      cambia el superadministrador, con doble aprobación y a un dominio
--      autorizado; los que fijan controles de cuatro ojos o de riesgo
--      (reembolsos, tasa_bcv, conciliacion, riesgo, analitica) también piden
--      la segunda aprobación, con topes razonables.
--   f. Listas negras y riesgo: una cuenta de prueba solo se coteja con lo de
--      la demo; la ficha 360 del comprador da las listas solo con el permiso
--      «riesgo».
--   g. Analítica con techo diario y de filas; métricas de la demo sin las
--      búsquedas ni el checkout de los visitantes reales.
--   h. ocultar_contacto reconoce las cifras de ancho completo (NFKC) y la I,
--      la l o la barra en lugar del 1.

-- a.1 Desde la de Crecimiento: oferta_vendidas y cupon_uso no cuentan el pago
-- que registrar_promociones está registrando (el ajuste de la transacción
-- tumbo.promo_pago, que solo fija mientras recalcula). Un checkout de varios
-- comercios registra sus promociones pedido por pedido: desde el segundo, el
-- pago se contaba a sí mismo (el cupón de un uso por persona salía «ya
-- usado», el último presupuesto o el último uso ya no alcanzaba y la
-- relámpago de un comercio anterior tenía menos unidades) y el checkout se
-- rechazaba aunque la cotización dijo que aplicaba. Fuera de ese cálculo,
-- igual que antes.
create or replace function tumbo_privado.oferta_vendidas(p_oferta bigint) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.unidades), 0)::integer
  from tumbo.promociones_aplicadas a join tumbo.pedidos p on p.id = a.pedido_id
  where a.oferta_id = p_oferta and p.estado <> 'cancelado'
    and coalesce(a.pago_id <> nullif(current_setting('tumbo.promo_pago', true), ''), true)
$$;
create or replace function tumbo_privado.cupon_uso(p_cupon bigint, p_usuario uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'usos', count(distinct a.pago_id),
    'usos_usuario', count(distinct a.pago_id) filter (where p_usuario is not null and a.comprador_id = p_usuario),
    'gastado_usd', coalesce(sum(a.descuento_usd), 0))
  from tumbo.promociones_aplicadas a join tumbo.pagos g on g.id = a.pago_id
  where a.cupon_id = p_cupon and g.estado in ('pendiente', 'reportado', 'verificado')
    and coalesce(a.pago_id <> nullif(current_setting('tumbo.promo_pago', true), ''), true)
$$;

-- a.2 Desde la de Crecimiento: el cálculo de comprobación se hace sin contar
-- el propio pago (a.1). Las comprobaciones de respaldo de después (unidades
-- de la relámpago y presupuesto del cupón con lo ya registrado) sí lo
-- cuentan. Lo demás, igual.
create or replace function tumbo_privado.registrar_promociones(p_yo tumbo.usuarios, v tumbo.pedidos, g tumbo.pagos) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb;
  promo jsonb;
  x jsonb;
  o tumbo.ofertas;
  c tumbo.cupones;
  v_uso jsonb;
  v_desc_seller numeric := 0;
begin
  perform 1 from tumbo.ofertas o2
  where o2.activa and o2.sku in (select ci.sku from tumbo.carrito_items ci join tumbo.productos p on p.sku = ci.sku
                                 where ci.usuario_id = v.comprador_id and p.seller_id = v.seller_id)
  order by o2.id for update;
  if g.cupon is not null then
    perform 1 from tumbo.cupones c2 where c2.codigo = g.cupon and c2.activo order by c2.id for update;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku', ci.sku, 'cant', ci.cant) order by ci.sku), '[]'::jsonb) into v_items
  from tumbo.carrito_items ci where ci.usuario_id = v.comprador_id;
  -- (sin contar lo que este mismo pago ya registró en sus pedidos anteriores)
  perform set_config('tumbo.promo_pago', g.id, true);
  promo := tumbo_privado.calcular_promociones(v.comprador_id, v_items, g.cupon, false);
  perform set_config('tumbo.promo_pago', '', true);
  if g.cupon is not null and nullif(promo ->> 'cupon', '') is null then
    raise exception 'El cupón % ya no se puede usar (%): quítalo y revisa el total.', g.cupon,
      coalesce(promo ->> 'cupon_error', 'llegó a su tope mientras confirmabas');
  end if;
  -- lo que financia el comercio en sus líneas debe ser lo que cobró el checkout
  select coalesce(sum((l ->> 'descuento_usd')::numeric), 0) into v_desc_seller
  from jsonb_array_elements(promo -> 'lineas') l
  where l ->> 'seller_id' = v.seller_id and coalesce(l ->> 'financia', 'seller') = 'seller';
  if abs(round(v_desc_seller, 2) - coalesce(v.descuento_usd, 0)) >= 0.01 then
    raise exception 'Las promociones de tu carrito cambiaron mientras confirmabas (una oferta terminó o se agotó): revisa el total.';
  end if;
  -- y el descuento de todo el pago (con el cupón y las ofertas de Tumbo),
  -- calculado ya con el cupón bloqueado, debe ser el que se cobró
  if abs(round(coalesce((promo ->> 'descuento_usd')::numeric, 0), 2) - coalesce(g.descuento_usd, 0)) >= 0.01 then
    raise exception 'Las promociones de tu carrito cambiaron mientras confirmabas (un cupón u oferta llegó a su tope): revisa el total.';
  end if;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(promo -> 'promociones') = 'array' then promo -> 'promociones' else '[]'::jsonb end) loop
    if x ->> 'tipo' = 'oferta' and x ->> 'seller_id' = v.seller_id then
      select * into o from tumbo.ofertas where id = (x ->> 'id')::bigint;
      if o.tipo = 'relampago' and tumbo_privado.oferta_vendidas(o.id) + (x ->> 'unidades')::integer > o.stock_oferta then
        raise exception 'La oferta relámpago de «%» se agotó mientras confirmabas: revisa el total.', x ->> 'nombre';
      end if;
      insert into tumbo.promociones_aplicadas (pago_id, pedido_id, comprador_id, seller_id, sku, oferta_id, unidades, descuento_usd, financia)
      values (g.id, v.id, v.comprador_id, v.seller_id, x ->> 'sku', o.id, (x ->> 'unidades')::integer, (x ->> 'descuento_usd')::numeric, o.financia);
    elsif x ->> 'tipo' = 'cupon' and (x ->> 'seller_id' = v.seller_id
                                     or (x ->> 'seller_id' is null and not exists (select 1 from tumbo.promociones_aplicadas a
                                                                                   where a.pago_id = g.id and a.cupon_id = (x ->> 'id')::bigint))) then
      select * into c from tumbo.cupones where id = (x ->> 'id')::bigint;
      insert into tumbo.promociones_aplicadas (pago_id, pedido_id, comprador_id, seller_id, cupon_id, descuento_usd, financia)
      values (g.id, case when c.seller_id is not null then v.id end, v.comprador_id, c.seller_id, c.id, (x ->> 'descuento_usd')::numeric, c.financia);
      -- (de respaldo: con lo registrado, el cupón no pasa su presupuesto ni sus usos)
      v_uso := tumbo_privado.cupon_uso(c.id, null);
      if (c.presupuesto_usd is not null and (v_uso ->> 'gastado_usd')::numeric > c.presupuesto_usd + 0.005)
         or (c.usos_max is not null and (v_uso ->> 'usos')::integer > c.usos_max) then
        raise exception 'El cupón % llegó a su tope mientras confirmabas: quítalo y revisa el total.', c.codigo;
      end if;
    end if;
  end loop;
end $$;

-- a.3 Desde la de la integración de la ola 1: antes de reactivar un pago
-- vencido, además del stock, se comprueban las reglas de Crecimiento de sus
-- promociones (unidades de la relámpago, presupuesto, usos y usos por
-- persona del cupón): otro comprador pudo tomarlas mientras estaba vencido
-- (oferta_vendidas y cupon_uso no cuentan los pedidos ni el pago vencidos).
-- Si no caben, se rechaza con «genera el reembolso», como sin stock.
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
  -- las promociones del pago (Crecimiento): al vencer, sus unidades
  -- relámpago y lo que gastaba de un cupón quedaron libres y otra compra
  -- pudo tomarlos. Con las ofertas y los cupones bloqueados (en el orden
  -- del checkout: después de los productos), si ya no caben, no se reactiva
  -- con ese descuento.
  perform 1 from tumbo.ofertas o
  where o.id in (select a.oferta_id from tumbo.promociones_aplicadas a where a.pago_id = g.id)
  order by o.id for update;
  perform 1 from tumbo.cupones c
  where c.id in (select a.cupon_id from tumbo.promociones_aplicadas a where a.pago_id = g.id)
  order by c.id for update;
  for r in
    select o.id, o.stock_oferta, sum(a.unidades)::integer as u, coalesce(min(pr.nombre), min(o.sku)) as nombre
    from tumbo.promociones_aplicadas a join tumbo.ofertas o on o.id = a.oferta_id
    left join tumbo.productos pr on pr.sku = o.sku
    where a.pago_id = g.id and o.tipo = 'relampago'
    group by o.id, o.stock_oferta
  loop
    if tumbo_privado.oferta_vendidas(r.id) + r.u > r.stock_oferta then
      raise exception 'Las unidades de la oferta relámpago de «%» ya las compró otra persona mientras el pago estaba vencido: genera el reembolso.', r.nombre;
    end if;
  end loop;
  for r in
    select c.codigo, c.presupuesto_usd, c.usos_max, c.usos_por_usuario, sum(a.descuento_usd) as gasto,
           tumbo_privado.cupon_uso(c.id, g.comprador_id) as uso
    from tumbo.promociones_aplicadas a join tumbo.cupones c on c.id = a.cupon_id
    where a.pago_id = g.id
    group by c.id
  loop
    if (r.presupuesto_usd is not null and (r.uso ->> 'gastado_usd')::numeric + r.gasto > r.presupuesto_usd + 0.005)
       or (r.usos_max is not null and (r.uso ->> 'usos')::integer + 1 > r.usos_max)
       or (r.usos_por_usuario is not null and (r.uso ->> 'usos_usuario')::integer + 1 > r.usos_por_usuario) then
      raise exception 'El cupón % llegó a su tope con otras compras mientras el pago estaba vencido: genera el reembolso.', r.codigo;
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

-- a.4 La cancelación de un pedido de un pago pendiente con el cupón de Tumbo
-- (repartido entre sus pedidos, una sola fila en promociones_aplicadas por
-- pago): la parte del pedido cancelado vuelve al presupuesto del cupón. Si
-- quien cancela es el comprador y lo que queda del pago ya no llega a la
-- compra mínima del cupón, no se cancela un solo pedido: se rechaza con el
-- código TMPAG y el comprador cancela el pago completo (tm_cancelar_pedido
-- con el código del pago, que marca tumbo.cancela_pago). Una cancelación de
-- Operaciones (no es culpa del comprador) le deja el descuento al resto.
create or replace function tumbo_privado.pago_cupon_cancelado(g tumbo.pagos, x tumbo.pedidos) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a tumbo.promociones_aplicadas;
  c tumbo.cupones;
  u tumbo.usuarios := tumbo_privado.usuario_en_curso();
  v_resto numeric;
  v_parte numeric;
begin
  select * into a from tumbo.promociones_aplicadas
  where pago_id = g.id and cupon_id is not null and pedido_id is null and financia = 'tumbo'
  order by id limit 1 for update;
  if not found or not exists (select 1 from tumbo.pedidos y where y.pago_id = g.id and y.estado <> 'cancelado') then
    -- (sin cupón de Tumbo, o se canceló todo el pago: cupon_uso ya no lo cuenta)
    return;
  end if;
  select * into c from tumbo.cupones where id = a.cupon_id;
  if u.rol = 'comprador' and coalesce(current_setting('tumbo.cancela_pago', true), '') <> g.id and c.minimo_usd > 0 then
    -- lo que queda, como lo mide el cupón: los productos con los descuentos
    -- de sus líneas (las ofertas del comercio y las de Tumbo)
    select coalesce(sum(tumbo_privado.bruto_pedido(y.id) - y.descuento_usd
                        - coalesce((select sum(o.descuento_usd) from tumbo.promociones_aplicadas o
                                    where o.pedido_id = y.id and o.oferta_id is not null and o.financia = 'tumbo'), 0)), 0)
      into v_resto
    from tumbo.pedidos y where y.pago_id = g.id and y.estado <> 'cancelado';
    if v_resto < c.minimo_usd then
      raise exception 'El cupón % pide una compra mínima de % y, sin el pedido %, el pago % ya no llega: para cancelarlo, cancela el pago completo.',
        c.codigo, tumbo_privado.fmt_usd(c.minimo_usd), x.id, g.id using errcode = 'TMPAG';
    end if;
  end if;
  -- la parte del cupón que llevaba el pedido cancelado (su descuento de
  -- Tumbo sin las ofertas que financia Tumbo en sus líneas)
  v_parte := greatest(x.descuento_tumbo_usd - coalesce((select sum(o.descuento_usd) from tumbo.promociones_aplicadas o
                                                        where o.pedido_id = x.id and o.oferta_id is not null and o.financia = 'tumbo'), 0), 0);
  if v_parte > 0 then
    update tumbo.promociones_aplicadas set descuento_usd = greatest(descuento_usd - v_parte, 0) where id = a.id;
    perform tumbo_privado.pago_evento(g.id, 'Sistema', 'Cupón ' || c.codigo || ': la parte del pedido cancelado ' || x.id ||
      ' (' || tumbo_privado.fmt_usd(v_parte) || ') vuelve a su presupuesto', 'sell');
  end if;
end $$;

-- a.5 Desde la de Pagos: al cancelar un pedido de un pago pendiente, el
-- cupón de Tumbo del pago (a.4). Lo demás, igual.
create or replace function tumbo_privado.pedido_sincroniza_pago() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
begin
  select * into g from tumbo.pagos where id = new.pago_id and estado in ('pendiente', 'reportado') for update skip locked;
  if not found then
    return null;
  end if;
  if g.estado = 'pendiente' then
    perform tumbo_privado.pago_cupon_cancelado(g, new);
    if not exists (select 1 from tumbo.pedidos where pago_id = g.id and estado <> 'cancelado') then
      update tumbo.pagos set estado = 'cancelado' where id = g.id;
      perform tumbo_privado.pago_evento(g.id, 'Sistema', 'Pago cancelado: el comprador canceló sus pedidos', 'cancel');
    end if;
    perform tumbo_privado.pago_ajustar_creditos(g.id, false);
  else
    update tumbo.pagos set observacion = 'El comprador canceló ' || new.id || ' después de reportar el pago: si el dinero llegó, al verificarlo se reembolsa.'
    where id = g.id;
    perform tumbo_privado.pago_evento(g.id, 'Sistema', 'El comprador canceló ' || new.id || ' después de reportar el pago', 'cancel', true);
    perform tumbo_privado.notificar('rol:finanzas', 'El comprador canceló ' || new.id || ' después de reportar el pago ' || g.id ||
                                    ': si el dinero llegó, verifícalo y se reembolsa', 'undo', 'admin/conciliacion.html');
  end if;
  return null;
end $$;

-- a.6 Desde la de Logística: p_id puede ser el código de un pago
-- (PAG-…): cancela juntos todos sus pedidos por pagar (a.4). Con el código de
-- un pedido, igual que antes.
create or replace function public.tm_cancelar_pedido(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 200);
  v_vence timestamptz;
  v_ped text;
  v_n integer := 0;
begin
  if p_id ~ '^PAG-' then
    -- el pago completo: cancela juntos todos sus pedidos por pagar (p. ej.
    -- cuando el cupón de Tumbo no deja cancelar uno solo)
    if not exists (select 1 from tumbo.pagos g where g.id = p_id and g.comprador_id = yo.id) then
      raise exception 'Pago % no encontrado.', p_id;
    end if;
    perform set_config('tumbo.cancela_pago', p_id, true);
    for v_ped in select p.id from tumbo.pedidos p
                 where p.pago_id = p_id and p.comprador_id = yo.id and p.estado = 'pago_por_verificar' order by p.id loop
      perform public.tm_cancelar_pedido(p_sesion, v_ped, p_motivo);
      v_n := v_n + 1;
    end loop;
    perform set_config('tumbo.cancela_pago', '', true);
    if v_n = 0 then
      raise exception 'El pago % no tiene pedidos por pagar que cancelar.', p_id;
    end if;
    return;
  end if;
  v := tumbo_privado.bloquear_pedido(p_id, yo);
  if v.estado in ('despachado', 'entregado', 'cerrado', 'reembolsado', 'devolucion') then
    raise exception 'El pedido ya fue despachado: corresponde un reclamo, no una cancelación.';
  end if;
  if v.estado = 'cancelado' then
    raise exception 'El pedido % ya está cancelado.', p_id;
  end if;
  if v.estado in ('preparando', 'listo') then
    if exists (select 1 from tumbo.solicitudes_cancelacion where pedido_id = p_id and estado = 'pendiente') then
      raise exception 'Ya pediste cancelar el pedido %: el comercio tiene hasta el plazo para responder.', p_id;
    end if;
    if (select count(*) from tumbo.solicitudes_cancelacion where pedido_id = p_id) >= 3 then
      raise exception 'El comercio ya respondió tus solicitudes de cancelación de este pedido: si hay un problema, escríbele a soporte.';
    end if;
    v_vence := now() + make_interval(hours => tumbo_privado.logistica('solicitud_horas', 24)::integer);
    insert into tumbo.solicitudes_cancelacion (pedido_id, seller_id, motivo, vence)
    values (p_id, v.seller_id, v_motivo, v_vence);
    perform tumbo_privado.evento(p_id, 'Comprador', 'Solicitud de cancelación enviada al comercio (' || coalesce(v_motivo, 'sin motivo') ||
      ') · si no responde, se aprueba sola el ' || tumbo_privado.fecha_hora_ve(v_vence), 'pending');
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'El comprador pidió cancelar el pedido ' || p_id || ': respóndele antes de despacharlo',
      'cancel', 'seller/pedido.html?id=' || p_id, array['seller', 'operador']);
    perform tumbo_privado.auditar(yo, 'Solicitud de cancelación', p_id || coalesce(' · ' || v_motivo, ''));
    return;
  end if;
  perform tumbo_privado.bloquear_stock(p_id);
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, 'Comprador',
    'Pedido cancelado (' || coalesce(v_motivo, 'sin motivo') || ') · stock liberado' ||
    case when v.estado = 'pago_por_verificar' then '' else ' y reembolso en cola' end, 'cancel');
  if v.estado <> 'pago_por_verificar' then
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'El comprador canceló el pedido ' || p_id, 'cancel',
                                    'seller/pedidos.html?estado=', array['seller', 'operador']);
    insert into tumbo.cancelaciones (pedido_id, seller_id, por, motivo, culpa_seller, detalle, estado_previo, reembolso_id, actor)
    values (p_id, v.seller_id, 'comprador', 'comprador', false, v_motivo, v.estado,
            tumbo_privado.crear_reembolso(p_id, tumbo_privado.bruto_pedido(p_id) + v.costo_envio_usd,
              'Cancelación del pedido ' || p_id || coalesce(' · ' || v_motivo, '')),
            yo.nombre || ' (comprador)');
  end if;
  perform tumbo_privado.auditar(yo, 'Cancelación', p_id || coalesce(' · ' || v_motivo, ''));
end $$;

-- b.1 Desde la de Comunicación:
--   · reembolso parcial → total: si el descuento del parcial ya entró en una
--     corrida (la del lunes toma los ajustes pendientes aunque el pedido siga
--     congelado por la apelación), ya no se detiene: se le devuelve al
--     comercio con un ajuste a favor en su próxima liquidación. Así ninguna
--     corrida le corta la apelación al comprador.
--   · → devolución con quién paga: devolucion_pagador (Logística), como
--     disputa_resolver_interno; antes cambiaba «paga» sin la frase de las
--     instrucciones que lee el comprador.
-- Lo demás, igual.
create or replace function public.tm_disputa_apelacion_resolver(p_sesion text, p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  x jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  v_res text := x ->> 'resultado';
  v_favor text := nullif(x ->> 'a_favor', '');
  v_nota text := btrim(coalesce(x ->> 'nota', ''));
  v_dec text := x ->> 'decision';
  v_paga text := nullif(x ->> 'paga', '');
  v_monto numeric;
  v_tope numeric;
  v_lados text[];
  v_hasta timestamptz;
  v_aj bigint;
  v_txt text;
  v_aj_liq text;
  r jsonb;
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found then raise exception 'Disputa % no encontrada.', p_id; end if;
  c := tumbo_privado.disputa_caso(d.id);
  if c.apelacion_estado is distinct from 'pedida' then
    raise exception 'Este reclamo no tiene una apelación pendiente.';
  end if;
  if c.resuelta_por = yo.id then
    raise exception 'La apelación la revisa otra persona del equipo, no quien decidió el reclamo.';
  end if;
  v := tumbo_privado.bloquear_pedido(d.pedido_id, yo);
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.pedido_real(v));
  select coalesce(array_agg(a.lado order by a.creado), '{}') into v_lados from tumbo.disputa_apelaciones a where a.disputa_id = d.id;
  v_hasta := c.resuelta_en + make_interval(days => tumbo_privado.comunicacion('dias_apelacion', 5)::integer);
  if c.decision = 'reembolso_parcial' and cardinality(v_lados) = 1 and now() < v_hasta then
    raise exception 'El % todavía puede apelar hasta el %: la revisión decide las dos apelaciones juntas (o la que haya cuando venza ese plazo).',
      case when v_lados[1] = 'comprador' then 'comercio' else 'comprador' end, tumbo_privado.fecha_legible(v_hasta);
  end if;
  if v_res is null or v_res not in ('confirmar', 'modificar') then
    raise exception 'Indica si confirmas la decisión o la modificas.';
  end if;
  if char_length(v_nota) < 10 or char_length(v_nota) > 1000 then
    raise exception 'Explica la revisión con al menos 10 caracteres (la leen las dos partes).';
  end if;
  begin
    v_monto := round(nullif(x ->> 'monto', '')::numeric, 2);
  exception when others then
    raise exception 'El monto no es válido.';
  end;
  if v_res = 'modificar' then
    if v_favor is null and cardinality(v_lados) = 1 then
      v_favor := v_lados[1];
    end if;
    if v_favor is null then
      raise exception 'Apelaron las dos partes: indica a favor de quién se modifica la decisión.';
    end if;
    if v_favor not in ('comprador', 'comercio') or not (v_favor = any (v_lados)) then
      raise exception 'La revisión solo modifica la decisión a favor de una parte que apeló.';
    end if;
  else
    v_favor := null;
  end if;
  -- (la ronda queda revisada antes de mover el pedido: así los fondos ya no se retienen por la apelación)
  update tumbo.disputa_casos
  set apelacion_estado = case when v_res = 'confirmar' then 'confirmada' else 'modificada' end, apelacion_a_favor = v_favor,
      apelacion_nota = left(v_nota, 1000), apelacion_resuelta_en = now(),
      apelacion_por = yo.id, apelacion_por_nombre = yo.nombre || ' (' || yo.rol || ')'
  where disputa_id = d.id;

  if v_res = 'confirmar' then
    if v.estado = 'cerrado' and v.liquidacion = 'congelado' and v.liquidacion_id is null then
      update tumbo.pedidos set liquidacion = 'elegible' where id = v.id;
    end if;
    v_txt := 'se confirma la decisión: ' || tumbo_privado.disputa_texto(c.decision, c.reembolso_usd, c.paga_logistica);
  elsif v_favor = 'comprador' then
    if v.liquidacion_id is not null or v.liquidacion is distinct from 'congelado' then
      raise exception 'El dinero de este pedido ya no está congelado: no se puede cambiar la decisión desde aquí.';
    end if;
    if c.decision = 'reembolso_parcial' and v_dec is distinct from 'reembolso' then
      raise exception 'Desde un reembolso parcial solo se puede pasar al reembolso total.';
    end if;
    if v_dec is null or v_dec not in ('reembolso', 'reembolso_parcial', 'devolucion') then
      raise exception 'Elige la nueva decisión: reembolso total, reembolso parcial o devolución.';
    end if;
    if v_paga is not null and (v_dec <> 'devolucion' or v_paga not in ('comprador', 'seller', 'tumbo')) then
      raise exception 'Quién paga el envío de vuelta se indica solo en una devolución.';
    end if;
    if v_dec = 'reembolso_parcial' then
      v_tope := tumbo_privado.disputa_tope_parcial(v);
      if v_monto is null or v_monto <= 0 or v_monto >= v_tope then
        raise exception 'El reembolso parcial va de $0.01 a menos de % (lo que pagó el comprador o lo que cobra el comercio por el pedido, lo menor).',
          tumbo_privado.fmt_usd(v_tope);
      end if;
    end if;
    if c.decision = 'reembolso_parcial' and c.ajuste_id is not null then
      -- el comercio ya no cobra el pedido: el descuento del parcial sobra. Si
      -- todavía no entró en una corrida, se borra; si ya entró (la corrida
      -- toma todos los ajustes pendientes del comercio, también los del
      -- calendario de los lunes), se le devuelve en la próxima con un ajuste
      -- a favor, sin asiento como el descuento (el reembolso total ya carga
      -- por_pagar_seller por todo lo pagado)
      select liquidacion_id into v_aj_liq from tumbo.ajustes_seller where id = c.ajuste_id for update;
      if v_aj_liq is null then
        delete from tumbo.ajustes_seller where id = c.ajuste_id;
      else
        insert into tumbo.ajustes_seller (seller_id, monto_usd, motivo, por_id, por)
        select a.seller_id, -a.monto_usd,
               left('Devolución del descuento del reembolso parcial del reclamo ' || d.id || ' (se descontó en ' || a.liquidacion_id ||
                    '; la apelación lo cambió a reembolso total)', 300), yo.id, tumbo_privado.actor(yo)
        from tumbo.ajustes_seller a where a.id = c.ajuste_id and a.monto_usd < 0;
        perform tumbo_privado.notificar('seller:' || d.seller_id, 'El descuento del reembolso parcial del reclamo ' || d.id ||
          ' (ya aplicado en ' || v_aj_liq || ') se te devuelve en tu próxima liquidación', 'payments', 'seller/finanzas.html');
      end if;
    end if;
    if v_dec = 'reembolso' then
      update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = v.id;
      -- lo que falta de lo que pagó el comprador (con el IGTF), con el asiento completo
      r := tumbo_privado.disputa_reembolso_total(v, d.id, 'Apelación del reclamo ' || d.id || ': reembolso total', tumbo_privado.actor(yo));
      v_monto := tumbo_privado.reembolsado_pedido(v.id);
    elsif v_dec = 'reembolso_parcial' then
      r := tumbo_privado.disputa_reembolso_parcial(v, v_monto, d.id, 'Apelación del reclamo ' || d.id || ': reembolso parcial');
      v_monto := (r ->> 'monto')::numeric;
      v_aj := (r ->> 'ajuste_id')::bigint;
      update tumbo.pedidos set liquidacion = 'elegible' where id = v.id;
    else
      update tumbo.pedidos set estado = 'devolucion' where id = v.id;
      if v_paga is not null then
        -- (contrato de Logística: «paga» y la frase de las instrucciones cambian juntas)
        perform tumbo_privado.devolucion_pagador(v.id, v_paga);
        perform tumbo_privado.evento(v.id, 'Operaciones', 'El envío de vuelta lo paga ' ||
          case v_paga when 'seller' then 'el comercio' when 'tumbo' then 'Tumbo' else 'el comprador' end, 'assignment_return');
      end if;
      v_monto := null;
      v_paga := coalesce(v_paga, (select dv.paga from tumbo.devoluciones dv where dv.pedido_id = v.id));
    end if;
    update tumbo.disputa_casos set decision = v_dec, reembolso_usd = case when v_dec <> 'devolucion' then v_monto end,
      paga_logistica = case when v_dec = 'devolucion' then v_paga end,
      ajuste_id = v_aj
    where disputa_id = d.id;
    v_txt := 'se modifica a favor del comprador: ' || tumbo_privado.disputa_texto(v_dec, v_monto, v_paga);
    -- (el reclamo cuenta la decisión vigente: las listas, tm_cargar y la reputación la leen de aquí)
    update tumbo.disputas
    set resolucion_decision = case when v_dec = 'reembolso_parcial' then 'reembolso' else v_dec end,
        resolucion_nota = left('Revisión de la apelación: ' || v_txt || '. ' || v_nota, 500)
    where id = d.id;
    perform tumbo_privado.evento(v.id, 'Operaciones', 'Apelación del reclamo ' || d.id || ' revisada: ' || tumbo_privado.disputa_texto(v_dec, v_monto, v_paga),
      case when v_dec = 'devolucion' then 'assignment_return' else 'undo' end);
  else
    -- a favor del comercio: compensación de Tumbo
    -- (lo que le costó: el reembolso decidido o, en una devolución, lo que se devolvió o se devolverá)
    v_tope := coalesce(c.reembolso_usd, greatest(tumbo_privado.reembolsado_pedido(v.id), tumbo_privado.disputa_total_reembolso(v)));
    if v_monto is null or v_monto <= 0 or v_monto > v_tope then
      raise exception 'La compensación al comercio va de $0.01 a % (lo que le costó la decisión).', tumbo_privado.fmt_usd(v_tope);
    end if;
    insert into tumbo.ajustes_seller (seller_id, monto_usd, motivo, por_id, por)
    values (v.seller_id, v_monto, left('Compensación de Tumbo por la apelación del reclamo ' || d.id, 300), yo.id, tumbo_privado.actor(yo))
    returning id into v_aj;
    perform tumbo_privado.asentar('ajuste', 'AJ-' || v_aj, 'Ajuste a ' || v.seller_id || ': compensación por la apelación del reclamo ' || d.id,
      tumbo_privado.actor(yo),
      jsonb_build_array(jsonb_build_object('cuenta', 'ajustes_seller', 'debe', v_monto),
                        jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', v.seller_id, 'haber', v_monto)));
    if v.estado = 'cerrado' and v.liquidacion = 'congelado' and v.liquidacion_id is null then
      update tumbo.pedidos set liquidacion = 'elegible' where id = v.id;
    end if;
    v_txt := 'se modifica a favor del comercio: Tumbo le compensa ' || tumbo_privado.fmt_usd(v_monto) || ' (el comprador conserva lo que recibió)';
    perform tumbo_privado.evento(v.id, 'Operaciones', 'Apelación del reclamo ' || d.id || ' revisada: compensación de Tumbo al comercio', 'gavel');
  end if;
  update tumbo.disputa_casos set apelacion_resultado = left(v_txt, 300) where disputa_id = d.id;
  insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto)
  values (d.id, yo.id, 'sistema', 'Tumbo', left('Revisión de la apelación: ' || v_txt || '. ' || regexp_replace(v_nota, '([^.!?])$', '\1.') ||
          ' Esta decisión es definitiva.', 2000));
  perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Revisamos la apelación del reclamo ' || d.id, 'gavel', 'tienda/reclamo.html?id=' || d.pedido_id);
  perform tumbo_privado.notificar('seller:' || d.seller_id, 'Revisamos la apelación del reclamo ' || d.id, 'gavel', 'seller/disputas.html?id=' || d.id);
  perform tumbo_privado.disputa_avisar(d, 'apelación revisada: ' || v_txt, 'apelación revisada: ' || v_txt);
  perform tumbo_privado.auditar(yo, 'Apelación de disputa revisada', d.id || ' → ' || v_res || coalesce(' a favor del ' || v_favor, '') || coalesce(' ' || v_dec, ''));
  return jsonb_build_object('ok', true, 'resultado', v_res, 'a_favor', v_favor);
end $$;

-- c.1 Desde la de Crecimiento: un reclamo perdido se cuenta como en la
-- reputación de Comunicación (la decisión vigente le costó al comercio y la
-- apelación no le dio la razón). Antes contaba el reembolso que la
-- revisión de la apelación cambió a favor del comercio. Lo demás, igual.
create or replace function tumbo_privado.metricas_nivel(p_seller text, p_dias integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e jsonb := tumbo_privado.envio_metricas(p_seller, p_dias);
  v_ventas integer;
  v_gmv numeric;
  v_perdidas integer;
  v_resueltas integer;
begin
  select count(distinct p.id), coalesce(sum(i.precio_usd * i.cant), 0)
    into v_ventas, v_gmv
  from tumbo.pedidos p left join tumbo.pedido_items i on i.pedido_id = p.id
  where p.seller_id = p_seller and p.estado in ('entregado', 'cerrado') and p.creado > now() - make_interval(days => p_dias);
  -- perdido: el criterio de la reputación (reputacion_comercio) — la
  -- decisión vigente le costó al comercio, salvo que la revisión de una
  -- apelación le diera la razón
  select count(*) filter (where coalesce(c.decision, d.resolucion_decision) in ('reembolso', 'reembolso_parcial', 'devolucion')
                            and c.apelacion_a_favor is distinct from 'comercio'), count(*)
    into v_perdidas, v_resueltas
  from tumbo.disputas d left join tumbo.disputa_casos c on c.disputa_id = d.id
  where d.seller_id = p_seller and d.estado = 'resuelta' and d.creado > now() - make_interval(days => p_dias);
  return jsonb_build_object(
    'dias', p_dias, 'ventas', v_ventas, 'gmv_usd', round(v_gmv, 2),
    'pedidos', (e ->> 'pedidos')::integer,
    'cancelacion_pct', case when (e ->> 'pedidos')::integer > 0
                            then round(100.0 * (e ->> 'cancelaciones_seller')::integer / (e ->> 'pedidos')::integer, 1) else 0 end,
    'disputas_perdidas', v_perdidas,
    'disputas_perdidas_pct', case when v_ventas + v_perdidas > 0 then round(100.0 * v_perdidas / (v_ventas + v_perdidas), 1) else 0 end,
    'despachados', (e ->> 'despachados')::integer,
    'a_tiempo_pct', case when (e ->> 'despachados')::integer > 0
                         then round(100.0 * (e ->> 'despachados_a_tiempo')::integer / (e ->> 'despachados')::integer, 1) end,
    'aceptacion_sla_pct', case when (e ->> 'aceptados')::integer > 0
                               then round(100.0 * (e ->> 'aceptados_a_tiempo')::integer / (e ->> 'aceptados')::integer, 1) end,
    'kyc_verificado', coalesce((select s.kyc_verificado from tumbo.sellers s where s.id = p_seller), false),
    'sanciones', (select count(*) from tumbo.sanciones x where x.seller_id = p_seller and tumbo_privado.sancion_vigente(x)));
end $$;

-- c.2 Desde la de Crecimiento:
--   · los reclamos perdidos, con el criterio de c.1;
--   · a una cuenta de prueba, la analítica solo de los comercios de prueba:
--     las búsquedas, el checkout y el pago reportado (sin comercio) los
--     hacen también los visitantes reales, así que no le llegan (ni «lo más
--     buscado», texto libre de personas reales); «reservado» lo dice.
-- Lo demás, igual.
create or replace function public.tm_metricas_negocio(p_sesion text, p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  per jsonb := tumbo_privado.periodo_metricas(p_filtros);
  f jsonb := case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end;
  v_ini timestamptz := (per ->> 'inicio')::timestamptz;
  v_fin timestamptz := (per ->> 'fin')::timestamptz;
  v_agrupar text := per ->> 'agrupar';
  v_cat text := nullif(f ->> 'categoria', '');
  v_seller text := nullif(f ->> 'seller', '');
  v_prueba text[];
  cfg tumbo.config;
  r jsonb;
begin
  if v_demo then
    select coalesce(array_agg(s.id), '{}') into v_prueba from tumbo.sellers s where tumbo_privado.comercio_de_prueba(s.id);
    if v_seller is not null and not (v_seller = any (v_prueba)) then
      raise exception 'Con una cuenta de prueba solo ves los comercios de la demo.' using errcode = '42501';
    end if;
  end if;
  select * into cfg from tumbo.config where id;
  create temporary table if not exists crec_ped (id text primary key, comprador_id uuid, seller_id text, estado text, creado timestamptz,
                                                 bruto numeric, base numeric, comision numeric, unidades integer, vendido boolean) on commit drop;
  truncate crec_ped;
  insert into crec_ped
  select p.id, p.comprador_id, p.seller_id, p.estado, p.creado, x.bruto, x.bruto - p.descuento_usd,
         round((x.bruto - p.descuento_usd) * coalesce(p.comision_pct, cfg.comision_pct) / 100, 2) + coalesce(p.tarifa_usd, cfg.tarifa_fija_usd),
         x.unidades, p.estado not in ('pago_por_verificar', 'cancelado')
  from tumbo.pedidos p
  cross join lateral (select coalesce(sum(i.precio_usd * i.cant), 0) as bruto, coalesce(sum(i.cant), 0)::integer as unidades
                      from tumbo.pedido_items i left join tumbo.productos pr on pr.sku = i.sku left join tumbo.categorias k on k.id = pr.categoria
                      where i.pedido_id = p.id and (v_cat is null or coalesce(k.padre, k.id, pr.categoria) = v_cat)) x
  where p.creado >= v_ini and p.creado < v_fin
    and (v_seller is null or p.seller_id = v_seller)
    and (v_cat is null or x.unidades > 0)
    and (not v_demo or not tumbo_privado.pedido_real(p));

  r := jsonb_build_object(
    'periodo', per - 'inicio' - 'fin',
    'kpis', (select jsonb_build_object(
        'gmv_usd', coalesce(sum(bruto) filter (where vendido), 0),
        'pedidos', count(*) filter (where vendido),
        'pedidos_creados', count(*),
        'ticket_usd', round(coalesce(sum(bruto) filter (where vendido), 0) / nullif(count(*) filter (where vendido), 0), 2),
        'comision_usd', coalesce(sum(comision) filter (where vendido), 0),
        'take_rate_pct', round(100 * coalesce(sum(comision) filter (where vendido), 0) / nullif(sum(bruto) filter (where vendido), 0), 2),
        'unidades', coalesce(sum(unidades) filter (where vendido), 0),
        'cancelados', count(*) filter (where estado = 'cancelado'),
        'cancelacion_pct', round(100.0 * count(*) filter (where estado = 'cancelado') / nullif(count(*), 0), 1),
        'compradores', count(distinct comprador_id) filter (where vendido),
        'recompra_pct', round(100.0 * count(distinct comprador_id) filter (where vendido and (
            exists (select 1 from crec_ped q where q.comprador_id = crec_ped.comprador_id and q.vendido and q.id <> crec_ped.id)
            or exists (select 1 from tumbo.pedidos q where q.comprador_id = crec_ped.comprador_id and q.creado < v_ini
                       and q.estado not in ('pago_por_verificar', 'cancelado'))))
          / nullif(count(distinct comprador_id) filter (where vendido), 0), 1))
      from crec_ped),
    'disputas', (select jsonb_build_object('total', count(*), 'pct', round(100.0 * count(*) / nullif((select count(*) from crec_ped where vendido), 0), 1),
                                           'perdidas', count(*) filter (where coalesce(k.decision, d.resolucion_decision) in ('reembolso', 'reembolso_parcial', 'devolucion')
                                                                          and k.apelacion_a_favor is distinct from 'comercio'))
                 from tumbo.disputas d join crec_ped c on c.id = d.pedido_id left join tumbo.disputa_casos k on k.disputa_id = d.id),
    'tiempos', jsonb_build_object(
      'conciliacion_horas', (select round(avg(extract(epoch from g.verificado_el - coalesce(g.reportado_el, g.creado)) / 3600)::numeric, 1)
                             from tumbo.pagos g
                             where g.estado = 'verificado' and g.verificado_el >= v_ini and g.verificado_el < v_fin
                               and exists (select 1 from crec_ped c join tumbo.pedidos p on p.id = c.id where p.pago_id = g.id)),
      'despacho_horas', (select round(avg(extract(epoch from e.despachado_en - e.conciliado_en) / 3600)::numeric, 1)
                         from tumbo.envios e join crec_ped c on c.id = e.pedido_id
                         where e.despachado_en is not null and e.conciliado_en is not null)),
    'serie', coalesce((select jsonb_agg(jsonb_build_object('grupo', g, 'gmv_usd', gmv, 'pedidos', n, 'ticket_usd', round(gmv / nullif(n, 0), 2)) order by g)
                       from (select tumbo_privado.grupo_fecha(creado, v_agrupar) as g, coalesce(sum(bruto) filter (where vendido), 0) as gmv,
                                    count(*) filter (where vendido) as n
                             from crec_ped group by 1) s), '[]'::jsonb),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', cat, 'nombre', (select k.nombre from tumbo.categorias k where k.id = cat),
                                                                   'gmv_usd', gmv, 'unidades', uni, 'pedidos', n) order by gmv desc)
                               from (select coalesce(k.padre, k.id, pr.categoria) as cat, sum(i.precio_usd * i.cant) as gmv, sum(i.cant) as uni,
                                            count(distinct c.id) as n
                                     from crec_ped c join tumbo.pedido_items i on i.pedido_id = c.id
                                     left join tumbo.productos pr on pr.sku = i.sku left join tumbo.categorias k on k.id = pr.categoria
                                     where c.vendido and (v_cat is null or coalesce(k.padre, k.id, pr.categoria) = v_cat)
                                     group by 1) s), '[]'::jsonb),
    'por_seller', coalesce((select jsonb_agg(jsonb_build_object('seller', s.seller_id, 'nombre', se.nombre, 'gmv_usd', s.gmv, 'pedidos', s.n,
                                                                'comision_usd', s.com, 'cancelados', s.canc) order by s.gmv desc)
                            from (select seller_id, coalesce(sum(bruto) filter (where vendido), 0) as gmv, count(*) filter (where vendido) as n,
                                         coalesce(sum(comision) filter (where vendido), 0) as com, count(*) filter (where estado = 'cancelado') as canc
                                  from crec_ped group by seller_id order by 2 desc limit 20) s
                            left join tumbo.sellers se on se.id = s.seller_id), '[]'::jsonb),
    'embudo', (select jsonb_build_object(
        'busquedas', count(*) filter (where e.tipo = 'busqueda'),
        'visitantes', count(distinct e.visitante),
        'vieron', count(distinct e.visitante) filter (where e.tipo = 'vista_producto'),
        'agregaron', count(distinct e.visitante) filter (where e.tipo = 'agregar_carrito'),
        'iniciaron_checkout', count(distinct e.visitante) filter (where e.tipo = 'inicio_checkout'),
        'abandonaron_checkout', count(distinct e.visitante) filter (where e.tipo = 'abandono_checkout'),
        'reportaron_pago', count(distinct e.visitante) filter (where e.tipo = 'pago_reportado'),
        'vistas', count(*) filter (where e.tipo = 'vista_producto'))
      from tumbo.eventos_analitica e
      where e.creado >= v_ini and e.creado < v_fin and (v_seller is null or e.seller_id = v_seller or e.tipo in ('busqueda', 'inicio_checkout', 'abandono_checkout', 'pago_reportado'))
        and (v_cat is null or e.categoria = v_cat or e.categoria is null)
        and (not v_demo or e.seller_id = any (v_prueba))),
    'top_busquedas', coalesce((select jsonb_agg(jsonb_build_object('texto', t, 'veces', n) order by n desc, t)
                               from (select e.texto as t, count(*) as n from tumbo.eventos_analitica e
                                     where e.tipo = 'busqueda' and e.texto is not null and e.creado >= v_ini and e.creado < v_fin
                                       and not v_demo
                                     group by 1 order by 2 desc, 1 limit 15) s), '[]'::jsonb),
    'top_vistos', coalesce((select jsonb_agg(jsonb_build_object('sku', s.sku, 'nombre', p.nombre, 'vistas', s.n) order by s.n desc, s.sku)
                            from (select e.sku, count(*) as n from tumbo.eventos_analitica e
                                  where e.tipo = 'vista_producto' and e.creado >= v_ini and e.creado < v_fin
                                    and (v_seller is null or e.seller_id = v_seller) and (v_cat is null or e.categoria = v_cat)
                                    and (not v_demo or e.seller_id = any (v_prueba))
                                  group by 1 order by 2 desc, 1 limit 10) s
                            left join tumbo.productos p on p.sku = s.sku), '[]'::jsonb),
    'filtros', jsonb_build_object('categoria', v_cat, 'seller', v_seller),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'nombre', k.nombre) order by k.orden, k.id) from tumbo.categorias k where k.padre is null), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.id) from tumbo.sellers s
                         where not v_demo or tumbo_privado.comercio_de_prueba(s.id)), '[]'::jsonb),
    'solo_demo', v_demo,
    -- (a una cuenta de prueba: lo que no es de ningún comercio —búsquedas,
    -- checkout y pago reportado— lo hacen también los visitantes reales)
    'reservado', case when v_demo then '["top_busquedas", "busquedas", "checkout"]'::jsonb else '[]'::jsonb end);
  drop table if exists crec_ped;
  return r;
end $$;

-- d.1 Desde la de Comunicación: el lado del comercio con una cuenta de
-- prueba no lee el chat de un comprador real (antes solo se le impedía
-- escribir): {bloqueado: true}, sin poder escribir. Lo demás, igual.
create or replace function tumbo_privado.chat_acceso(p_yo tumbo.usuarios, v tumbo.pedidos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lado text;
  v_abierto boolean;
begin
  if p_yo.id is null or v.id is null then
    return null;
  end if;
  if p_yo.rol = 'comprador' and v.comprador_id = p_yo.id then
    v_lado := 'comprador';
  elsif p_yo.rol in ('seller', 'operador') and v.seller_id = p_yo.seller_id
        and v.estado <> 'pago_por_verificar' and not (v.estado = 'cancelado' and v.sla_horas is null) then
    v_lado := 'comercio';
  elsif p_yo.rol in ('superadmin', 'ops') and v.disputa_id is not null
        and (not tumbo_privado.cuenta_demo(p_yo.email) or not tumbo_privado.pedido_real(v)) then
    v_lado := 'tumbo';
  else
    return null;
  end if;
  -- el comercio con una cuenta de prueba (contraseña pública) no lee la
  -- conversación de una persona real: la ve bloqueada, sin mensajes
  if v_lado = 'comercio' and tumbo_privado.cuenta_demo(p_yo.email) and tumbo_privado.comprador_real(v.comprador_id) then
    return jsonb_build_object('lado', v_lado, 'puede_escribir', false, 'bloqueado', true,
      'motivo', 'Es la conversación de una persona real: solo la lee una cuenta real del comercio.');
  end if;
  -- se escribe desde que el pago se concilia hasta 60 días después de creado
  -- el pedido (o mientras tenga un reclamo sin resolver)
  v_abierto := v.estado <> 'pago_por_verificar'
               and (v.creado > now() - interval '60 days'
                    or exists (select 1 from tumbo.disputas d where d.id = v.disputa_id and d.estado <> 'resuelta'));
  return jsonb_build_object('lado', v_lado, 'puede_escribir', v_abierto,
    'motivo', case when v.estado = 'pago_por_verificar' then 'El chat se abre cuando Finanzas verifica el pago.'
                   when not v_abierto then 'El chat de este pedido ya se cerró (60 días después de la compra).' end);
end $$;

-- d.2 Desde la de Comunicación: una conversación bloqueada (d.1) llega sin
-- mensajes y sin marcar nada como leído. Lo demás, igual.
create or replace function public.tm_chat(p_sesion text, p_pedido text, p_antes bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'operador', 'superadmin', 'ops']);
  v tumbo.pedidos;
  a jsonb;
  v_ult bigint;
  v_msgs jsonb;
begin
  select * into v from tumbo.pedidos where id = p_pedido;
  a := tumbo_privado.chat_acceso(yo, v);
  if a is null then
    return jsonb_build_object('error', 'No encontramos la conversación de ese pedido.');
  end if;
  if coalesce((a ->> 'bloqueado')::boolean, false) then
    return a || jsonb_build_object('pedido', v.id, 'mensajes', '[]'::jsonb, 'siguiente', null, 'con_tumbo', v.disputa_id is not null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'lado', m.lado, 'autor', m.autor, 'texto', m.texto,
                                               'adjuntos', tumbo_privado.archivos_json(m.adjuntos::text[]),
                                               'ocultos', to_jsonb(m.ocultos), 'creado', m.creado, 'mio', coalesce(m.autor_id = yo.id, false))
                            order by m.id), '[]'::jsonb), max(m.id) into v_msgs, v_ult
  from (select * from tumbo.chat_mensajes c where c.pedido_id = p_pedido and (p_antes is null or c.id < p_antes)
        order by c.id desc limit 50) m;
  if v_ult is not null and p_antes is null then
    insert into tumbo.chat_lecturas (pedido_id, usuario_id, ultimo) values (p_pedido, yo.id, v_ult)
    on conflict (pedido_id, usuario_id) do update set ultimo = greatest(tumbo.chat_lecturas.ultimo, excluded.ultimo);
  end if;
  return a || jsonb_build_object('pedido', v.id, 'mensajes', v_msgs,
    'siguiente', case when jsonb_array_length(v_msgs) = 50 then (v_msgs -> 0 ->> 'id')::bigint end,
    'con_tumbo', v.disputa_id is not null);
end $$;

-- d.3 Desde la de Comunicación: sin los chats bloqueados (d.1). Lo demás, igual.
create or replace function public.tm_chat_pendientes(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'operador']);
begin
  return coalesce((
    select jsonb_object_agg(x.pedido_id, x.n) from (
      select c.pedido_id, count(*) as n
      from tumbo.chat_mensajes c join tumbo.pedidos p on p.id = c.pedido_id
      where c.creado > now() - interval '60 days'
        and ((yo.rol = 'comprador' and p.comprador_id = yo.id and c.lado <> 'comprador')
             or (yo.rol in ('seller', 'operador') and p.seller_id = yo.seller_id and c.lado <> 'comercio'
                 and not (tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.comprador_real(p.comprador_id))))
        and c.id > coalesce((select l.ultimo from tumbo.chat_lecturas l where l.pedido_id = c.pedido_id and l.usuario_id = yo.id), 0)
      group by c.pedido_id) x), '{}'::jsonb);
end $$;

-- d.4 Desde la de Comunicación: el comercio con una cuenta de prueba recibe
-- bloqueado (sin descripción, evidencia, mensajes ni apelaciones, y sin
-- responder ni apelar) el reclamo de un comprador real, como el equipo con
-- una cuenta de prueba. Lo demás, igual.
create or replace function public.tm_disputa(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'superadmin', 'ops']);
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  dv tumbo.devoluciones;
  v_lado text;
  v_bloq boolean;
  v_apelar_hasta timestamptz;
  v_lados text[];
  v_espera timestamptz;
  v_vuelta boolean;
begin
  select * into d from tumbo.disputas where id = p_id or (pedido_id = p_id and p_id like 'TM-%') limit 1;
  v_lado := tumbo_privado.disputa_lado(yo, d);
  if v_lado is null then
    return jsonb_build_object('error', 'No encontramos ese reclamo.');
  end if;
  select * into v from tumbo.pedidos where id = d.pedido_id;
  c := tumbo_privado.disputa_caso(d.id);
  select * into dv from tumbo.devoluciones where pedido_id = d.pedido_id;
  v_bloq := tumbo_privado.cuenta_demo(yo.email)
            and ((v_lado = 'tumbo' and (tumbo_privado.comprador_real(d.comprador_id) or tumbo_privado.seller_real(d.seller_id)))
                 or (v_lado = 'comercio' and tumbo_privado.comprador_real(d.comprador_id)));
  v_apelar_hasta := c.resuelta_en + make_interval(days => tumbo_privado.comunicacion('dias_apelacion', 5)::integer);
  select coalesce(array_agg(a.lado order by a.creado), '{}') into v_lados from tumbo.disputa_apelaciones a where a.disputa_id = d.id;
  -- en un reembolso parcial apelan las dos partes: la revisión espera a la
  -- otra hasta que venza su plazo (decide las dos apelaciones juntas)
  v_espera := case when c.apelacion_estado = 'pedida' and c.decision = 'reembolso_parcial' and cardinality(v_lados) = 1
                    and now() < v_apelar_hasta then v_apelar_hasta end;
  v_vuelta := c.decision = 'devolucion' and c.paga_logistica in ('seller', 'tumbo');
  return jsonb_build_object(
    'id', d.id, 'pedido', d.pedido_id, 'lado', v_lado, 'bloqueado', v_bloq, 'seller', d.seller_id,
    'comercio', (select s.nombre from tumbo.sellers s where s.id = d.seller_id),
    'motivo', d.motivo, 'estado', d.estado, 'creado', d.creado,
    'descripcion', case when v_bloq and v_lado = 'comercio' then '(Reclamo de una persona real: el detalle solo lo ve una cuenta real del comercio.)'
                        when v_bloq then '(Reclamo de una persona o un comercio real: el detalle solo lo ve una cuenta real del equipo.)' else d.descripcion end,
    'evidencia', case when v_bloq then '[]'::jsonb else tumbo_privado.archivos_json(d.evidencia) end,
    'evidencia_nombres', case when v_bloq then '[]'::jsonb else coalesce((select jsonb_agg(x) from unnest(d.evidencia) x
                           where x !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '[]'::jsonb) end,
    'monto_usd', d.monto_usd, 'total_usd', tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd, 'tasa', v.tasa,
    'pagado_usd', case when v.pago_id is null then tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd
                       else (tumbo_privado.montos_pedido(v) ->> 'pagado')::numeric end,
    'reembolso_total_usd', tumbo_privado.disputa_total_reembolso(v),
    'tope_parcial_usd', case when d.estado <> 'resuelta' or c.apelacion_estado = 'pedida' then tumbo_privado.disputa_tope_parcial(v) end,
    'pedido_estado', v.estado, 'congelado', v.liquidacion = 'congelado',
    'retenido_hasta', case when v.liquidacion = 'congelado' and tumbo_privado.disputa_retiene_fondos(d.id) then v_apelar_hasta end,
    'respuesta', case when d.respuesta_fecha is not null then jsonb_build_object(
                   'texto', case when v_bloq then '(oculta a las cuentas de prueba)' else d.respuesta_texto end,
                   'fecha', d.respuesta_fecha,
                   'evidencia', case when v_bloq then '[]'::jsonb else tumbo_privado.archivos_json(d.respuesta_evidencia) end) end,
    'plazo_seller', c.plazo_seller, 'respondida_en', c.respondida_en,
    'resolucion', case when d.estado = 'resuelta' then jsonb_build_object(
                    'decision', coalesce(c.decision, d.resolucion_decision), 'nota', case when v_bloq then null else d.resolucion_nota end,
                    'fecha', d.resolucion_fecha, 'reembolso_usd', c.reembolso_usd, 'paga', c.paga_logistica,
                    'automatica', c.fallo_automatico, 'texto', tumbo_privado.disputa_texto(coalesce(c.decision, d.resolucion_decision), c.reembolso_usd, c.paga_logistica),
                    'por', case when v_lado = 'tumbo' and not v_bloq then c.resuelta_por_nombre end) end,
    'apelacion', case when c.apelacion_estado is not null then jsonb_build_object(
                   'estado', c.apelacion_estado, 'de', to_jsonb(v_lados), 'a_favor', c.apelacion_a_favor,
                   'resultado', c.apelacion_resultado, 'nota', case when v_bloq then null else c.apelacion_nota end,
                   'resuelta_en', c.apelacion_resuelta_en, 'espera_hasta', v_espera,
                   'por', case when v_lado = 'tumbo' and not v_bloq then c.apelacion_por_nombre end) end,
    'apelaciones', case when v_bloq then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                     'lado', a.lado, 'motivo', a.motivo, 'evidencia', tumbo_privado.archivos_json(a.evidencia), 'fecha', a.creado,
                     'decision', a.decision, 'congelo', a.congelo, 'mia', a.lado = v_lado) order by a.creado)
                   from tumbo.disputa_apelaciones a where a.disputa_id = d.id), '[]'::jsonb) end,
    'apelar_hasta', case when d.estado = 'resuelta' then v_apelar_hasta end,
    'devolucion', case when dv.pedido_id is not null and v.disputa_id = d.id then jsonb_build_object(
                    'estado', dv.estado, 'paga', dv.paga, 'inspeccion', dv.inspeccion, 'guia', dv.guia) end,
    'envio_vuelta', case when v_vuelta then jsonb_build_object(
                      'paga', c.paga_logistica, 'estado', c.vuelta_estado, 'bs', c.vuelta_bs, 'usd', c.vuelta_usd,
                      'recibo', case when v_bloq then '[]'::jsonb else tumbo_privado.archivos_json(c.vuelta_recibo) end,
                      'reportado', c.vuelta_reportado, 'reintegro_usd', c.vuelta_reintegro_usd,
                      'nota', case when v_bloq then null else c.vuelta_nota end,
                      'por', case when v_lado = 'tumbo' and not v_bloq then c.vuelta_por end) end,
    'mensajes', case when v_bloq then '[]'::jsonb else tumbo_privado.disputa_mensajes_json(d.id, yo.id) end,
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'para', s.para, 'texto', s.texto, 'vence', s.vence,
                               'estado', s.estado, 'creado', s.creado, 'respondida_en', s.respondida_en) order by s.id)
                             from tumbo.disputa_solicitudes s where s.disputa_id = d.id and not v_bloq
                               and (v_lado = 'tumbo' or s.para = v_lado)), '[]'::jsonb),
    'acciones', jsonb_build_object(
      'mensaje', not v_bloq and tumbo_privado.disputa_abierta_a_mensajes(d, c, v),
      'responder', v_lado = 'comercio' and not v_bloq and d.estado = 'abierta',
      'apelar', v_lado in ('comprador', 'comercio') and not v_bloq and tumbo_privado.disputa_apelacion_impedida(d, c, v, v_lado) is null,
      'resolver', v_lado = 'tumbo' and not v_bloq and d.estado <> 'resuelta',
      'solicitar', v_lado = 'tumbo' and not v_bloq and d.estado <> 'resuelta',
      'revisar_apelacion', v_lado = 'tumbo' and not v_bloq and coalesce(c.apelacion_estado = 'pedida', false)
                           and c.resuelta_por is distinct from yo.id and v_espera is null,
      'reportar_vuelta', v_lado = 'comprador' and coalesce(v_vuelta, false) and v.estado in ('devolucion', 'reembolsado')
                         and coalesce(c.vuelta_estado, 'rechazado') = 'rechazado' and c.resuelta_en > now() - interval '60 days',
      'resolver_vuelta', v_lado = 'tumbo' and not v_bloq and coalesce(c.vuelta_estado = 'reportado', false)),
    'plantillas', case when v_lado = 'tumbo' then coalesce((select jsonb_agg(jsonb_build_object('clave', p.clave, 'titulo', p.titulo,
                    'decision', p.decision, 'paga', p.paga, 'texto', p.texto) order by p.orden) from tumbo.disputa_plantillas p), '[]'::jsonb) end);
end $$;

-- d.5 Desde la de Comunicación: el reclamo de un comprador real no lo
-- responde una cuenta de prueba (respondido, ya no corría el fallo
-- automático a favor de la persona). Lo demás, igual.
create or replace function public.tm_responder_disputa(p_sesion text, p_id text, p_texto text, p_evidencia text[]) returns void
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
  -- (una cuenta de prueba no responde el reclamo de una persona real ni frena su fallo automático)
  perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.comprador_real(d.comprador_id));
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
  v_texto := left(tumbo_privado.ocultar_contacto(v_texto) ->> 'texto', 2000);
  v_evid := tumbo_privado.adjuntos_sin_contacto(v_evid);
  update tumbo.disputas
  set respuesta_texto = v_texto, respuesta_evidencia = v_evid, respuesta_fecha = now(), estado = 'respondida'
  where id = p_id;
  perform tumbo_privado.disputa_caso(p_id);
  update tumbo.disputa_casos set respondida_en = coalesce(respondida_en, now()) where disputa_id = p_id;
  insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto, adjuntos)
  values (p_id, yo.id, 'comercio', coalesce((select s.nombre from tumbo.sellers s where s.id = d.seller_id), 'Comercio'),
          v_texto, (select coalesce(array_agg(x), '{}') from unnest(v_evid) x where x ~ '^[0-9a-f-]{36}$'));
  perform tumbo_privado.notificar('rol:ops', 'El seller respondió la disputa ' || p_id, 'forum', 'admin/disputas.html');
  perform tumbo_privado.notificar('usr:' || d.comprador_id, 'El comercio respondió tu reclamo ' || p_id, 'forum', 'tienda/reclamo.html?id=' || d.pedido_id);
  perform tumbo_privado.disputa_avisar(d, 'el comercio respondió; Operaciones decidirá con la evidencia de los dos', null);
  perform tumbo_privado.auditar(yo, 'Respuesta a disputa', p_id);
end $$;

-- d.6 Desde la de Comunicación: el comercio con una cuenta de prueba no
-- escribe en el expediente de un comprador real. Lo demás, igual.
create or replace function public.tm_disputa_mensaje(p_sesion text, p_id text, p_texto text, p_adjuntos text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'superadmin', 'ops']);
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  v_lado text;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_adj text[] := coalesce(p_adjuntos, '{}');
  v_sol bigint;
  v_id bigint;
  v_autor text;
begin
  select * into d from tumbo.disputas where id = p_id for update;
  v_lado := tumbo_privado.disputa_lado(yo, d);
  if v_lado is null then
    raise exception 'Reclamo % no encontrado.', p_id;
  end if;
  select * into v from tumbo.pedidos where id = d.pedido_id;
  if v_lado = 'tumbo' then
    perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.pedido_real(v));
  elsif v_lado = 'comercio' then
    perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.comprador_real(d.comprador_id));
  end if;
  c := tumbo_privado.disputa_caso(d.id);
  if not tumbo_privado.disputa_abierta_a_mensajes(d, c, v) then
    raise exception 'El reclamo ya está resuelto: si no estás de acuerdo con la decisión, apela una vez con evidencia nueva.';
  end if;
  if char_length(v_texto) < 2 or char_length(v_texto) > 2000 then
    raise exception 'Escribe tu mensaje (hasta 2.000 caracteres).';
  end if;
  if cardinality(v_adj) > 10 or not tumbo_privado.archivos_propios(v_adj, yo.id, array['evidencia'], array[d.id, d.pedido_id]) then
    raise exception 'Adjunta hasta 10 archivos de evidencia subidos para este reclamo.';
  end if;
  if (select count(*) from tumbo.disputa_mensajes where autor_id = yo.id and creado > now() - interval '1 hour') >= 30 then
    raise exception 'Enviaste muchos mensajes seguidos: espera unos minutos.';
  end if;
  if v_lado <> 'tumbo' then
    v_texto := left(tumbo_privado.ocultar_contacto(v_texto) ->> 'texto', 2000);
  end if;
  select s.id into v_sol from tumbo.disputa_solicitudes s
  where s.disputa_id = d.id and s.estado = 'pendiente' and s.para = v_lado order by s.id limit 1;
  v_autor := case v_lado when 'comprador' then 'Comprador'
                         when 'comercio' then coalesce((select s.nombre from tumbo.sellers s where s.id = d.seller_id), 'Comercio')
                         else 'Operaciones Tumbo' end;
  insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto, adjuntos, solicitud_id)
  values (d.id, yo.id, v_lado, v_autor, v_texto, v_adj, v_sol)
  returning id into v_id;
  if v_sol is not null then
    update tumbo.disputa_solicitudes set estado = 'respondida', respondida_en = now() where id = v_sol;
  end if;
  if v_lado = 'comercio' and d.estado = 'abierta' then
    update tumbo.disputas set estado = 'respondida', respuesta_texto = v_texto, respuesta_evidencia = v_adj, respuesta_fecha = now()
    where id = d.id;
    update tumbo.disputa_casos set respondida_en = coalesce(respondida_en, now()) where disputa_id = d.id;
  end if;
  if v_lado <> 'comprador' then
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Mensaje nuevo en tu reclamo ' || d.id, 'forum', 'tienda/reclamo.html?id=' || d.pedido_id);
  end if;
  if v_lado <> 'comercio' then
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'Mensaje nuevo en el reclamo ' || d.id, 'forum', 'seller/disputas.html?id=' || d.id);
  end if;
  if v_lado <> 'tumbo' then
    perform tumbo_privado.notificar('rol:ops', 'Mensaje nuevo en la disputa ' || d.id, 'forum', 'admin/disputas.html?id=' || d.id);
  end if;
  return jsonb_build_object('id', v_id, 'solicitud', v_sol);
end $$;

-- d.7 Desde la de Comunicación: el comercio con una cuenta de prueba no
-- apela la decisión del reclamo de un comprador real. Lo demás, igual.
create or replace function public.tm_disputa_apelar(p_sesion text, p_id text, p_motivo text, p_evidencia text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller']);
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  v_lado text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_evid text[] := coalesce(p_evidencia, '{}');
  v_congela boolean := false;
  v_imp text;
  v_otro text;
  v_hasta timestamptz;
begin
  select * into d from tumbo.disputas where id = p_id for update;
  v_lado := tumbo_privado.disputa_lado(yo, d);
  if v_lado is null or v_lado = 'tumbo' then
    raise exception 'Reclamo % no encontrado.', p_id;
  end if;
  if v_lado = 'comercio' then
    perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.comprador_real(d.comprador_id));
  end if;
  c := tumbo_privado.disputa_caso(d.id);
  select * into v from tumbo.pedidos where id = d.pedido_id for update;
  v_imp := tumbo_privado.disputa_apelacion_impedida(d, c, v, v_lado);
  if v_imp is not null then
    raise exception '%', v_imp;
  end if;
  if char_length(v_motivo) < 20 or char_length(v_motivo) > 2000 then
    raise exception 'Explica por qué apelas con al menos 20 caracteres.';
  end if;
  if cardinality(v_evid) = 0 or cardinality(v_evid) > 10
     or not tumbo_privado.archivos_propios(v_evid, yo.id, array['evidencia'], array[d.id, d.pedido_id])
     or exists (select 1 from unnest(v_evid) x join tumbo.archivos a on a.id::text = x where a.creado < c.resuelta_en) then
    raise exception 'La apelación necesita evidencia nueva: adjunta al menos un archivo subido después de la decisión.';
  end if;
  v_motivo := left(tumbo_privado.ocultar_contacto(v_motivo) ->> 'texto', 2000);
  v_hasta := c.resuelta_en + make_interval(days => tumbo_privado.comunicacion('dias_apelacion', 5)::integer);
  if v_lado = 'comprador' then
    if v.liquidacion is distinct from 'congelado' then
      update tumbo.pedidos set liquidacion = 'congelado' where id = v.id;
    end if;
    v_congela := true;
    perform tumbo_privado.evento(v.id, 'Comprador', 'Apelación del reclamo ' || d.id || ' · fondos congelados hasta la revisión', 'gavel');
  else
    perform tumbo_privado.evento(v.id, 'Comercio', 'Apelación del reclamo ' || d.id || ' presentada por el comercio', 'gavel');
  end if;
  insert into tumbo.disputa_apelaciones (disputa_id, lado, autor_id, motivo, evidencia, decision, congelo)
  values (d.id, v_lado, yo.id, v_motivo, v_evid, c.decision, v_congela);
  update tumbo.disputa_casos set apelacion_estado = 'pedida' where disputa_id = d.id;
  -- ¿puede apelar también la otra parte? (en un reembolso parcial, hasta el mismo plazo)
  v_otro := case when v_lado = 'comprador' then 'comercio' else 'comprador' end;
  if tumbo_privado.disputa_apelacion_impedida(d, (select x from tumbo.disputa_casos x where x.disputa_id = d.id), v, v_otro) is not null then
    v_otro := null;
  end if;
  insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto, adjuntos)
  values (d.id, yo.id, v_lado, case v_lado when 'comprador' then 'Comprador'
                                           else coalesce((select s.nombre from tumbo.sellers s where s.id = d.seller_id), 'Comercio') end,
          left('Apelación: ' || v_motivo, 2000), v_evid);
  if v_otro is not null then
    insert into tumbo.disputa_mensajes (disputa_id, lado, autor, texto)
    values (d.id, 'sistema', 'Tumbo', 'Apeló ' || case v_lado when 'comprador' then 'el comprador' else 'el comercio' end ||
            '. ' || case v_otro when 'comprador' then 'El comprador' else 'El comercio' end || ' también puede apelar hasta el ' ||
            tumbo_privado.fecha_legible(v_hasta) || ': otra persona del equipo revisará las dos apelaciones juntas.');
  end if;
  perform tumbo_privado.notificar('rol:ops', 'Apelación del reclamo ' || d.id || ': la revisa otra persona del equipo', 'gavel', 'admin/disputas.html?id=' || d.id);
  if v_lado = 'comprador' then
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'El comprador apeló la decisión del reclamo ' || d.id, 'gavel', 'seller/disputas.html?id=' || d.id);
    perform tumbo_privado.disputa_avisar(d, null, 'el comprador apeló la decisión; otra persona del equipo la revisa' ||
      case when v_otro is not null then ' (también puedes apelar hasta el ' || tumbo_privado.fecha_legible(v_hasta) || ')' else '' end);
  else
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'El comercio apeló la decisión de tu reclamo ' || d.id, 'gavel', 'tienda/reclamo.html?id=' || d.pedido_id);
    perform tumbo_privado.disputa_avisar(d, 'el comercio apeló la decisión; otra persona del equipo la revisa' ||
      case when v_otro is not null then ' (también puedes apelar hasta el ' || tumbo_privado.fecha_legible(v_hasta) || ')' else '' end, null);
  end if;
  perform tumbo_privado.auditar(yo, 'Apelación de disputa', d.id || ' (' || v_lado || ')');
  return jsonb_build_object('ok', true, 'congelado', v_congela, 'otra_parte_hasta', case when v_otro is not null then v_hasta end);
end $$;

-- d.8 Desde la de Comunicación: una cuenta de prueba del comercio no
-- responde la pregunta de una persona real. Lo demás, igual.
create or replace function public.tm_pregunta_responder(p_sesion text, p_id bigint, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  q tumbo.preguntas;
  p tumbo.productos;
  v_texto text := btrim(regexp_replace(coalesce(p_texto, ''), '[ \t]+', ' ', 'g'));
  v_estado text;
begin
  select * into q from tumbo.preguntas where id = p_id for update;
  if not found or q.seller_id is distinct from yo.seller_id or q.estado = 'oculta' then
    raise exception 'No encontramos esa pregunta.';
  end if;
  -- (lo que responde una cuenta de prueba no va debajo de la pregunta de una persona real)
  perform tumbo_privado.exigir_cuenta_real(yo, q.autor_id is not null and tumbo_privado.comprador_real(q.autor_id));
  if q.respondida_en is not null then
    raise exception 'Esa pregunta ya tiene respuesta.';
  end if;
  if char_length(v_texto) < 2 or char_length(v_texto) > 1000 then
    raise exception 'Escribe la respuesta con hasta 1.000 caracteres.';
  end if;
  v_estado := tumbo_privado.texto_publico(v_texto, 'la respuesta');
  update tumbo.preguntas set respuesta = v_texto, respuesta_estado = v_estado, respondida_por = yo.id, respondida_en = now()
  where id = p_id;
  select * into p from tumbo.productos where sku = q.sku;
  if v_estado = 'publicada' and q.autor_id is not null then
    perform tumbo_privado.notificar('usr:' || q.autor_id, 'Respondieron tu pregunta sobre «' || left(coalesce(p.nombre, q.sku), 60) || '»', 'help',
      'tienda/producto.html?sku=' || q.sku);
    perform tumbo_privado.encolar(q.autor_id, 'pregunta_respondida', jsonb_build_object('producto', left(coalesce(p.nombre, q.sku), 80),
      'enlace', 'app/tienda/producto.html?sku=' || q.sku));
  elsif v_estado = 'revision' then
    perform tumbo_privado.notificar('rol:ops', 'Respuesta en revisión sobre ' || q.sku, 'flag', 'admin/contenido.html');
  end if;
  return jsonb_build_object('ok', true, 'estado', v_estado);
end $$;

-- d.9 Desde la de Comunicación: una cuenta de prueba del comercio no
-- responde la reseña de una persona real. Lo demás, igual.
create or replace function public.tm_resena_responder(p_sesion text, p_id bigint, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  r tumbo.resenas;
  s tumbo.sellers;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_estado text;
begin
  select * into r from tumbo.resenas where id = p_id for update;
  if not found or r.seller_id is distinct from yo.seller_id or r.estado = 'oculta' then
    raise exception 'No encontramos esa reseña.';
  end if;
  perform tumbo_privado.exigir_cuenta_real(yo, r.comprador_id is not null and tumbo_privado.comprador_real(r.comprador_id));
  if r.respuesta is not null then
    raise exception 'Ya respondiste esa reseña.';
  end if;
  if char_length(v_texto) < 5 or char_length(v_texto) > 1000 then
    raise exception 'Escribe la respuesta con entre 5 y 1.000 caracteres.';
  end if;
  v_estado := tumbo_privado.texto_publico(v_texto, 'la respuesta');
  update tumbo.resenas set respuesta = v_texto, respuesta_estado = v_estado, respondida_por = yo.id, respondida_en = now() where id = p_id;
  select * into s from tumbo.sellers where id = r.seller_id;
  if v_estado = 'publicada' and r.comprador_id is not null then
    perform tumbo_privado.notificar('usr:' || r.comprador_id, s.nombre || ' respondió tu reseña del pedido ' || r.pedido_id, 'reviews',
      case when r.sku is not null then 'tienda/producto.html?sku=' || r.sku else 'tienda/seller.html?id=' || r.seller_id end);
    perform tumbo_privado.encolar(r.comprador_id, 'resena_respondida', jsonb_build_object('comercio', s.nombre, 'pedido', r.pedido_id,
      'enlace', case when r.sku is not null then 'app/tienda/producto.html?sku=' || r.sku else 'app/tienda/seller.html?id=' || r.seller_id end));
  elsif v_estado = 'revision' then
    perform tumbo_privado.notificar('rol:ops', 'Respuesta a una reseña en revisión (' || r.seller_id || ')', 'flag', 'admin/contenido.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Respuesta a reseña', '#' || p_id || ' · ' || r.pedido_id);
  return jsonb_build_object('ok', true, 'estado', v_estado);
end $$;

-- d.10 Desde la de arriba (sección 4): la evidencia y los adjuntos del chat
-- de un comprador real no los abre el comercio con una cuenta de prueba
-- (la guía y la entrega, sí: las sube él para despachar). Lo demás, igual.
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
      -- el equipo con una cuenta de prueba: solo los pedidos de la demo; el
      -- comercio con una cuenta de prueba no abre la evidencia ni los
      -- adjuntos del chat de un comprador real
      v_equipo := v_equipo and (not v_demo or not (tumbo_privado.comprador_real(v_comprador) or tumbo_privado.seller_real(v_seller)));
      v_seller_ve := v_seller_ve and (not v_demo or p_proposito not in ('evidencia', 'chat') or not tumbo_privado.comprador_real(v_comprador));
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

-- d.11 Desde la de la integración de la ola 1: a la cuenta de prueba del
-- comercio, el reclamo de un comprador real le llega como al equipo con una
-- cuenta de prueba (bloqueado, sin descripción, evidencia ni respuesta).
-- Lo demás, igual.
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
        select jsonb_agg(case when v_demo and ((v_admin and (tumbo_privado.comprador_real(d.comprador_id) or tumbo_privado.seller_real(d.seller_id)))
                                                 or (v_rol = 'seller' and tumbo_privado.comprador_real(d.comprador_id)))
                              then (to_jsonb(d) - 'comprador_id' - 'descripcion' - 'evidencia' - 'respuesta_texto' - 'respuesta_evidencia' - 'resolucion_nota')
                                   || jsonb_build_object('mio', false, 'bloqueado', true, 'evidencia', '[]'::jsonb,
                                                         'descripcion', case when v_rol = 'seller'
                                                                             then '(Reclamo de una persona real: el detalle solo lo ve una cuenta real del comercio.)'
                                                                             else '(Reclamo de una persona o un comercio real: el detalle solo lo ve una cuenta real del equipo.)' end)
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

-- e.1 Ajustes de seguridad: de sitio_url salen los enlaces con token (la
-- recuperación de la contraseña, las invitaciones) y todos los de la
-- bandeja; envios.funcion_url recibe el secreto de la tarea de envíos y
-- funciones_url, la limpieza de archivos.
create or replace function tumbo_privado.ajuste_seguridad(p_clave text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_clave in ('sitio_url', 'envios', 'funciones_url'), false)
$$;

-- e.2 ¿Pide la segunda aprobación? Los marcados en ajustes_meta (datos de
-- cobro, niveles), los de seguridad y los que fijan un control de cuatro
-- ojos o de riesgo: el umbral de los reembolsos con doble aprobación, la
-- fuente y la variación de la tasa automática, la tolerancia de la
-- conciliación, las reglas de riesgo y los topes de la analítica. (Los
-- metadatos no se actualizan: la migración solo agrega.)
create or replace function tumbo_privado.ajuste_doble(p_clave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.doble_aprobacion from tumbo.ajustes_meta m where m.clave = p_clave), false)
      or tumbo_privado.ajuste_seguridad(p_clave)
      or coalesce(p_clave in ('reembolsos', 'tasa_bcv', 'conciliacion', 'riesgo', 'analitica'), false)
$$;

-- e.3 El host (en minúsculas) de una dirección https, o null.
create or replace function tumbo_privado.host_https(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(substring(coalesce(p, '') from '^https://([A-Za-z0-9.-]+)(?::[0-9]{2,5})?(?:[/?#]|$)'))
$$;

-- e.4 ¿Puede apuntar a ese host el ajuste? Al del valor que ya tiene (lo
-- carga la persona dueña del proyecto por SQL: docs/PRODUCCION.md) o a uno
-- de la lista que ella guarda por SQL en tumbo_privado.secretos
-- («hosts_<clave>», separados por espacios o comas), nunca a uno que alguien
-- escriba desde el Backoffice. La tasa admite además su fuente pública por
-- omisión.
create or replace function tumbo_privado.host_permitido(p_clave text, p_host text, p_actual text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_host is not null and (
           p_host = tumbo_privado.host_https(p_actual)
           or p_host = any (regexp_split_to_array(lower(coalesce(tumbo_privado.secreto('hosts_' || p_clave), '')), '[[:space:],]+'))
           or (p_clave = 'tasa_bcv' and p_host = 've.dolarapi.com')), false)
$$;

-- e.5 Desde la de Crecimiento: además, las direcciones de sitio_url,
-- funciones_url, envios.funcion_url y tasa_bcv.url (https, con su forma y a
-- un host autorizado: e.4) y topes para el umbral de los reembolsos con
-- doble aprobación (5.000 USD), la variación de la tasa automática (50 %) y
-- la tolerancia de la conciliación (1.000 Bs.). Lo demás, igual.
create or replace function tumbo_privado.validar_ajuste(p_clave text, p_valor jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  m tumbo.ajustes_meta;
  k text;
  e jsonb;
  v jsonb;
  x numeric;
  n jsonb;
  v_ids text[] := '{}';
  v_estricto boolean;
  v_url text;
  v_actual jsonb := (select a.valor from tumbo.ajustes a where a.clave = p_clave);
  v_patron text;
begin
  if jsonb_typeof(p_valor) = 'null' then
    return;
  end if;
  -- las direcciones: https, con su forma, y a un host autorizado (e.4)
  if p_clave in ('sitio_url', 'funciones_url', 'envios', 'tasa_bcv') then
    v_url := case when p_clave in ('sitio_url', 'funciones_url') then p_valor #>> '{}'
                  when jsonb_typeof(p_valor) = 'object' then p_valor ->> case when p_clave = 'envios' then 'funcion_url' else 'url' end end;
    v_patron := case p_clave
      when 'envios' then '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?/functions/v1/tumbo-envios$'
      when 'tasa_bcv' then '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[A-Za-z0-9._~/%?&=-]*)?$'
      else '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[A-Za-z0-9._~/-]*)?$' end;
    if v_url is not null and (v_url !~ v_patron or not tumbo_privado.host_permitido(p_clave, tumbo_privado.host_https(v_url),
          case when p_clave in ('sitio_url', 'funciones_url') then v_actual #>> '{}'
               else v_actual ->> case when p_clave = 'envios' then 'funcion_url' else 'url' end end)) then
      raise exception 'La dirección de «%» debe ser https y de un dominio autorizado (el mismo que ya tiene o uno que la persona dueña del proyecto autorizó): %',
        p_clave, case p_clave when 'envios' then 'https://<proyecto>.supabase.co/functions/v1/tumbo-envios'
                              when 'funciones_url' then 'https://<proyecto>.supabase.co/functions/v1'
                              when 'tasa_bcv' then 'la fuente pública de la tasa'
                              else 'la dirección pública del sitio' end;
    end if;
  end if;
  -- topes razonables para los controles (más allá del rango del esquema)
  if p_clave = 'reembolsos' and tumbo_privado.num_json(p_valor -> 'umbral_doble_usd') > 5000 then
    raise exception 'La doble aprobación de los reembolsos va desde un monto de hasta 5.000 USD.';
  end if;
  if p_clave = 'tasa_bcv' and tumbo_privado.num_json(p_valor -> 'variacion_max_pct') > 50 then
    raise exception 'La variación máxima de la tasa automática va hasta 50 %%: lo que la pase lo aprueba una persona.';
  end if;
  if p_clave = 'conciliacion' and tumbo_privado.num_json(p_valor -> 'tolerancia_bs') > 1000 then
    raise exception 'La tolerancia de la conciliación va hasta 1.000 Bs.';
  end if;
  if jsonb_typeof(p_valor) = 'string' and (char_length(p_valor #>> '{}') > 2000 or (p_valor #>> '{}') ~ '[[:cntrl:]]') then
    raise exception 'El texto es demasiado largo o tiene caracteres no admitidos.';
  end if;
  if p_clave = 'aviso_incidencia' and (char_length(btrim(p_valor #>> '{}')) < 5 or char_length(p_valor #>> '{}') > 300) then
    raise exception 'El aviso de incidencia va de 5 a 300 caracteres (o vacío para quitarlo).';
  end if;
  if p_clave = 'categorias_apagadas' then
    if jsonb_array_length(p_valor) > 50 then
      raise exception 'Hasta 50 categorías en pausa.';
    end if;
    for v in select * from jsonb_array_elements(p_valor) loop
      if jsonb_typeof(v) <> 'string' or not exists (select 1 from tumbo.categorias c where c.id = v #>> '{}') then
        raise exception 'La categoría «%» no existe.', left(coalesce(v #>> '{}', v::text), 60);
      end if;
    end loop;
    return;
  end if;
  if p_clave = 'ciudades_apagadas' then
    if jsonb_array_length(p_valor) > 50 then
      raise exception 'Hasta 50 ciudades o estados en pausa.';
    end if;
    for v in select * from jsonb_array_elements(p_valor) loop
      if jsonb_typeof(v) <> 'string' or char_length(btrim(v #>> '{}')) not between 2 and 60 or (v #>> '{}') ~ '[[:cntrl:]<>]' then
        raise exception 'Cada ciudad o estado en pausa es un nombre de 2 a 60 caracteres.';
      end if;
    end loop;
    return;
  end if;
  if p_clave = 'niveles' then
    if jsonb_typeof(p_valor -> 'niveles') <> 'array' or jsonb_array_length(p_valor -> 'niveles') not between 1 and 5 then
      raise exception 'Los niveles van en una lista de 1 a 5.';
    end if;
    if tumbo_privado.num_json(p_valor -> 'ventana_dias') is null or tumbo_privado.num_json(p_valor -> 'ventana_dias') not between 30 and 365 then
      raise exception 'La ventana de los niveles va de 30 a 365 días.';
    end if;
    if jsonb_typeof(p_valor -> 'requiere_kyc') <> 'boolean' then
      raise exception 'Indica si los niveles requieren el expediente verificado (sí o no).';
    end if;
    for n in select * from jsonb_array_elements(p_valor -> 'niveles') loop
      if jsonb_typeof(n) <> 'object' or coalesce(n ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,29}$'
         or char_length(coalesce(n ->> 'nombre', '')) not between 3 and 40 then
        raise exception 'Cada nivel lleva un identificador (minúsculas) y un nombre de 3 a 40 caracteres.';
      end if;
      if (n ->> 'id') = any (v_ids) then
        raise exception 'El nivel «%» está repetido.', n ->> 'id';
      end if;
      v_ids := v_ids || (n ->> 'id');
      foreach k in array array['ventas_min', 'gmv_min_usd', 'cancelacion_max_pct', 'disputas_perdidas_max_pct', 'a_tiempo_min_pct', 'descuento_comision_pts'] loop
        x := tumbo_privado.num_json(n -> k);
        if x is null or x < 0 or (k like '%pct' and x > 100) then
          raise exception 'Revisa «%» del nivel «%».', k, n ->> 'nombre';
        end if;
      end loop;
      -- un nivel se gana vendiendo y su beneficio es acotado (cada punto es
      -- comisión que Tumbo deja de cobrar a todos los comercios del nivel)
      if tumbo_privado.num_json(n -> 'ventas_min') < 1 or tumbo_privado.num_json(n -> 'ventas_min') <> trunc(tumbo_privado.num_json(n -> 'ventas_min')) then
        raise exception 'El nivel «%» pide al menos una venta entregada (un número entero).', n ->> 'nombre';
      end if;
      if tumbo_privado.num_json(n -> 'descuento_comision_pts') > 3 then
        raise exception 'El beneficio del nivel «%» va hasta 3 puntos menos de comisión.', n ->> 'nombre';
      end if;
    end loop;
    return;
  end if;
  select * into m from tumbo.ajustes_meta where clave = p_clave;
  if not found or m.esquema = '{}'::jsonb or jsonb_typeof(p_valor) <> 'object' then
    return;
  end if;
  -- los de este dominio llevan exactamente sus campos; los de los demás
  -- dominios se validan en lo que traen (pueden sumar campos propios)
  v_estricto := p_clave in ('riesgo', 'moderacion', 'promociones', 'analitica');
  for k in select jsonb_object_keys(p_valor) loop
    if v_estricto and not m.esquema ? k then
      raise exception 'El campo «%» no existe en «%».', left(k, 40), m.etiqueta;
    end if;
  end loop;
  for k, e in select * from jsonb_each(m.esquema) loop
    v := p_valor -> k;
    if v is null and not v_estricto then
      continue;
    end if;
    if v is null then
      raise exception 'Falta «%» en «%».', coalesce(e ->> 'etiqueta', k), m.etiqueta;
    end if;
    if jsonb_typeof(v) <> (e ->> 'tipo') then
      raise exception '«%» espera %.', coalesce(e ->> 'etiqueta', k),
        case e ->> 'tipo' when 'number' then 'un número' when 'boolean' then 'sí o no' when 'array' then 'una lista' else 'un texto' end;
    end if;
    if e ->> 'tipo' = 'number' then
      x := (v #>> '{}')::numeric;
      if (e ? 'min' and x < (e ->> 'min')::numeric) or (e ? 'max' and x > (e ->> 'max')::numeric) then
        raise exception '«%» va de % a %.', coalesce(e ->> 'etiqueta', k), e ->> 'min', e ->> 'max';
      end if;
      if coalesce((e ->> 'entero')::boolean, false) and x <> trunc(x) then
        raise exception '«%» debe ser un número entero.', coalesce(e ->> 'etiqueta', k);
      end if;
    elsif e ->> 'tipo' = 'string' and char_length(v #>> '{}') > 500 then
      raise exception '«%» es demasiado largo.', coalesce(e ->> 'etiqueta', k);
    end if;
  end loop;
  if p_clave = 'riesgo' and (p_valor ->> 'umbral_alerta')::numeric >= (p_valor ->> 'umbral_retencion')::numeric then
    raise exception 'El puntaje de alerta debe ser menor que el de retención.';
  end if;
end $$;

-- e.6 Desde la de Crecimiento: la segunda aprobación la deciden
-- ajuste_doble (e.2) y no solo los metadatos, y los ajustes de seguridad
-- (e.1) solo los propone el superadministrador. Lo demás, igual.
create or replace function public.tm_ajuste_guardar(p_sesion text, p_clave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  a tumbo.ajustes;
  m tumbo.ajustes_meta;
  v_valor jsonb := coalesce(p_valor, 'null'::jsonb);
  v_id bigint;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  perform tumbo_privado.exigir_elevada(yo);
  select * into a from tumbo.ajustes where clave = p_clave for update;
  if not found then
    raise exception 'El ajuste «%» no existe.', left(coalesce(p_clave, ''), 60);
  end if;
  if octet_length(v_valor::text) > 20000 then
    raise exception 'El valor del ajuste es demasiado grande.';
  end if;
  if jsonb_typeof(v_valor) = 'null' then
    if not a.vaciable then
      raise exception 'El ajuste «%» no se puede dejar vacío.', a.clave;
    end if;
  elsif jsonb_typeof(v_valor) <> a.tipo then
    raise exception 'El ajuste «%» espera %.', a.clave,
      case a.tipo when 'boolean' then 'sí o no' when 'number' then 'un número' when 'string' then 'un texto'
                  when 'array' then 'una lista' else 'un conjunto de datos' end;
  end if;
  if tumbo_privado.ajuste_seguridad(a.clave) and yo.rol <> 'superadmin' then
    raise exception 'Solo el superadministrador cambia «%»: de ahí salen los enlaces con token de los correos y adónde llama Tumbo a sus funciones.', a.clave
      using errcode = '42501';
  end if;
  perform tumbo_privado.validar_ajuste(a.clave, v_valor);
  select * into m from tumbo.ajustes_meta where clave = a.clave;
  if tumbo_privado.ajuste_doble(a.clave) then
    if a.valor = v_valor then
      raise exception 'El valor de «%» no cambió.', coalesce(m.etiqueta, a.clave);
    end if;
    if exists (select 1 from tumbo.cambios_config where tipo = 'ajuste' and clave = a.clave and estado = 'pendiente') then
      raise exception 'Ya hay un cambio de «%» esperando la segunda aprobación: decídelo antes de proponer otro.', coalesce(m.etiqueta, a.clave);
    end if;
    insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, propuesto_por, propuesto_nombre)
    values ('ajuste', a.clave, a.valor, v_valor, 'pendiente', yo.id, tumbo_privado.actor(yo))
    returning id into v_id;
    perform tumbo_privado.notificar('rol:superadmin', 'Cambio de «' || coalesce(m.etiqueta, a.clave) || '» esperando la segunda aprobación',
                                    'rule', 'admin/ajustes.html');
    perform tumbo_privado.auditar(yo, 'Ajuste propuesto', a.clave || ' (cambio ' || v_id || ', espera la segunda aprobación)');
    return jsonb_build_object('pendiente', true, 'cambio', v_id,
      'mensaje', 'El cambio queda pendiente: lo aprueba otra persona del equipo con sesión elevada.');
  end if;
  update tumbo.ajustes set valor = v_valor, actualizado = now(), por = yo.nombre || ' (' || yo.rol || ')'
  where clave = a.clave;
  insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, propuesto_por, propuesto_nombre)
  values ('ajuste', a.clave, a.valor, v_valor, 'aplicado', yo.id, tumbo_privado.actor(yo));
  perform tumbo_privado.auditar(yo, 'Ajuste cambiado',
    a.clave || ': ' || left(a.valor::text, 400) || ' → ' || left(v_valor::text, 400));
  return v_valor;
end $$;

-- e.7 Desde la de Crecimiento: el cambio de un ajuste de seguridad (e.1) lo
-- aprueba otro superadministrador. Lo demás, igual.
create or replace function public.tm_cambio_decidir(p_sesion text, p_id bigint, p_aprobar boolean, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  c tumbo.cambios_config;
  a tumbo.ajustes;
  cfg tumbo.config;
  k tumbo.comisiones;
  v_nota text := nullif(left(regexp_replace(btrim(coalesce(p_nota, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300), '');
  v_id bigint;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  perform tumbo_privado.exigir_elevada(yo);
  if p_aprobar is null then
    raise exception 'Indica si apruebas o rechazas el cambio.';
  end if;
  select * into c from tumbo.cambios_config where id = p_id for update;
  if not found then
    raise exception 'Cambio no encontrado.';
  end if;
  if c.estado <> 'pendiente' then
    raise exception 'Ese cambio ya se decidió.';
  end if;
  if c.tipo = 'comision' then
    v_id := nullif(regexp_replace(c.clave, '^fin:', ''), '')::bigint;
    select * into k from tumbo.comisiones where id = v_id for update;
  end if;

  if not p_aprobar then
    update tumbo.cambios_config
    set estado = case when c.propuesto_por = yo.id then 'anulado' else 'rechazado' end,
        decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(), nota = v_nota
    where id = c.id;
    if c.tipo = 'comision' and c.clave !~ '^fin:' and k.estado = 'pendiente' then
      update tumbo.comisiones set estado = case when c.propuesto_por = yo.id then 'anulada' else 'rechazada' end where id = k.id;
    end if;
    if c.propuesto_por is not null and c.propuesto_por <> yo.id then
      perform tumbo_privado.notificar('usr:' || c.propuesto_por, 'Rechazaron tu cambio de «' || c.clave || '»' || coalesce(': ' || v_nota, ''),
                                      'rule', 'admin/ajustes.html');
    end if;
    perform tumbo_privado.auditar(yo, case when c.propuesto_por = yo.id then 'Cambio retirado' else 'Cambio rechazado' end,
                                  c.tipo || ' ' || c.clave || ' (cambio ' || c.id || ')' || coalesce(' · ' || v_nota, ''));
    return jsonb_build_object('ok', true, 'estado', case when c.propuesto_por = yo.id then 'anulado' else 'rechazado' end);
  end if;

  if c.propuesto_por = yo.id then
    raise exception 'La segunda aprobación la da otra persona del equipo (no quien propuso el cambio).';
  end if;
  if c.tipo = 'ajuste' and tumbo_privado.ajuste_seguridad(c.clave) and yo.rol <> 'superadmin' then
    raise exception 'El cambio de «%» lo aprueba otro superadministrador.', c.clave using errcode = '42501';
  end if;

  if c.tipo = 'ajuste' then
    select * into a from tumbo.ajustes where clave = c.clave for update;
    if not found or a.valor is distinct from c.antes then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'El ajuste cambió desde la propuesta: hay que proponerlo de nuevo.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'El ajuste cambió desde la propuesta: proponlo de nuevo.');
    end if;
    perform tumbo_privado.validar_ajuste(a.clave, c.despues);
    update tumbo.ajustes set valor = c.despues, actualizado = now(), por = yo.nombre || ' (' || yo.rol || ', segunda aprobación)'
    where clave = a.clave;
    perform tumbo_privado.auditar(yo, 'Ajuste cambiado',
      a.clave || ': ' || left(a.valor::text, 400) || ' → ' || left(c.despues::text, 400) || ' (propuso ' || c.propuesto_nombre || ')');
  elsif c.tipo = 'config' then
    select * into cfg from tumbo.config where id for update;
    if c.clave <> 'tarifa_fija_usd' or to_jsonb(cfg.tarifa_fija_usd) <> c.antes then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'La configuración cambió desde la propuesta.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'La configuración cambió desde la propuesta: proponlo de nuevo.');
    end if;
    update tumbo.config set tarifa_fija_usd = (c.despues #>> '{}')::numeric where id;
    perform tumbo_privado.auditar(yo, 'Ajuste cambiado', 'tarifa_fija_usd: ' || c.antes::text || ' → ' || c.despues::text ||
                                  ' (propuso ' || c.propuesto_nombre || ')');
  elsif c.clave ~ '^fin:' then
    if k.id is null or k.estado <> 'vigente' or (k.hasta is not null and k.hasta <= now()) then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'La comisión ya no estaba vigente.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'Esa comisión ya no estaba vigente.');
    end if;
    if k.desde > now() then
      update tumbo.comisiones set estado = 'anulada' where id = k.id;
    else
      update tumbo.comisiones set hasta = now() where id = k.id;
    end if;
    perform tumbo_privado.auditar(yo, 'Comisión terminada', k.id || ' (' || coalesce(k.seller_id, 'global') || coalesce(' · ' || k.categoria, '') ||
                                  ', ' || k.pct || ' %) · propuso ' || c.propuesto_nombre);
  else
    if k.id is null or k.estado <> 'pendiente' then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'La comisión ya no estaba pendiente.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'Esa comisión ya no estaba pendiente.');
    end if;
    -- una vigencia que empezaba mientras esperaba empieza ahora: nunca hacia atrás
    update tumbo.comisiones
    set estado = 'vigente', desde = greatest(desde, now()), aprobada_por = yo.id, aprobada_nombre = tumbo_privado.actor(yo), aprobada_el = now()
    where id = k.id and (hasta is null or hasta > greatest(desde, now()));
    if not found then
      update tumbo.comisiones set estado = 'anulada' where id = k.id;
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'Su vigencia ya terminó.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'La vigencia propuesta ya terminó.');
    end if;
    perform tumbo_privado.auditar(yo, 'Comisión aprobada', k.id || ' (' || coalesce(k.seller_id, 'global') || coalesce(' · ' || k.categoria, '') ||
                                  ' → ' || k.pct || ' %) · propuso ' || c.propuesto_nombre);
  end if;
  update tumbo.cambios_config set estado = 'aplicado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(), nota = v_nota
  where id = c.id;
  if c.propuesto_por is not null then
    perform tumbo_privado.notificar('usr:' || c.propuesto_por, 'Se aprobó tu cambio de «' || c.clave || '»', 'task_alt', 'admin/ajustes.html');
  end if;
  return jsonb_build_object('ok', true, 'estado', 'aplicado');
end $$;

-- e.8 Desde la de Crecimiento: «doble» es ajuste_doble (e.2) y «seguridad»
-- marca los que solo cambia el superadministrador. Lo demás, igual.
create or replace function public.tm_ajustes_admin(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops', 'finanzas']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  cfg tumbo.config;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  select * into cfg from tumbo.config where id;
  return jsonb_build_object(
    'ajustes', coalesce((select jsonb_agg(jsonb_build_object(
        'clave', a.clave, 'valor', case when tumbo_privado.ajuste_visible(yo, a.clave) then a.valor end,
        'reservado', not tumbo_privado.ajuste_visible(yo, a.clave),
        'tipo', a.tipo, 'vaciable', a.vaciable, 'publico', a.publico,
        'descripcion', a.descripcion, 'actualizado', a.actualizado,
        'grupo', coalesce(m.grupo, 'Otros'), 'etiqueta', coalesce(m.etiqueta, a.clave), 'ayuda', m.ayuda,
        'doble', tumbo_privado.ajuste_doble(a.clave), 'seguridad', tumbo_privado.ajuste_seguridad(a.clave), 'esquema', coalesce(m.esquema, '{}'::jsonb), 'orden', coalesce(m.orden, 1000))
        order by coalesce(m.orden, 1000), a.clave)
      from tumbo.ajustes a left join tumbo.ajustes_meta m on m.clave = a.clave), '[]'::jsonb),
    'config', jsonb_build_object('comision_pct', cfg.comision_pct, 'comision_global', tumbo_privado.comision_vigente(null, null),
                                 'tarifa_fija_usd', cfg.tarifa_fija_usd, 'ventana_reclamo_dias', cfg.ventana_reclamo_dias,
                                 'ciudad_entrega', cfg.ciudad_entrega),
    'comisiones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'seller_id', c.seller_id, 'seller', s.nombre, 'categoria', c.categoria, 'categoria_nombre', k.nombre,
        'pct', c.pct, 'descuento_pts', c.descuento_pts, 'desde', c.desde, 'hasta', c.hasta, 'origen', c.origen, 'estado', c.estado,
        'motivo', c.motivo, 'propuesta', tumbo_privado.firma_visible(yo, c.propuesta_por, c.propuesta_nombre),
        'aprobada', tumbo_privado.firma_visible(yo, c.aprobada_por, c.aprobada_nombre),
        'rige', c.estado = 'vigente' and c.desde <= now() and (c.hasta is null or c.hasta > now()))
        order by c.estado = 'vigente' desc, c.id desc)
      from (select * from tumbo.comisiones x where x.estado in ('pendiente', 'vigente') and (x.hasta is null or x.hasta > now() - interval '90 days')
              and (not v_demo or x.seller_id is null or tumbo_privado.comercio_de_prueba(x.seller_id))
            order by x.id desc limit 300) c
      left join tumbo.sellers s on s.id = c.seller_id left join tumbo.categorias k on k.id = c.categoria), '[]'::jsonb),
    'metodos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'activo', m.activo, 'moneda', m.moneda,
                                                             'contra_entrega', m.contra_entrega) order by m.orden)
                         from tumbo.metodos_pago m where not m.interno), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'padre', c.padre) order by c.padre nulls first, c.orden, c.id)
                            from tumbo.categorias c), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.id) from tumbo.sellers s
                         where not v_demo or tumbo_privado.comercio_de_prueba(s.id)), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'tipo', c.tipo, 'clave', c.clave, 'antes', c.antes, 'despues', c.despues, 'motivo', c.motivo,
        'propuesto', tumbo_privado.firma_visible(yo, c.propuesto_por, c.propuesto_nombre), 'mio', c.propuesto_por = yo.id, 'creado', c.creado)
        order by c.id) from tumbo.cambios_config c where c.estado = 'pendiente' and tumbo_privado.cambio_visible(yo, c)), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'tipo', c.tipo, 'clave', c.clave, 'antes', c.antes, 'despues', c.despues, 'estado', c.estado, 'motivo', c.motivo,
        'propuesto', tumbo_privado.firma_visible(yo, c.propuesto_por, c.propuesto_nombre),
        'decidido', tumbo_privado.firma_visible(yo, c.decidido_por, c.decidido_nombre), 'decidido_el', c.decidido_el,
        'nota', c.nota, 'creado', c.creado) order by c.id desc)
      from (select * from tumbo.cambios_config x where x.estado <> 'pendiente' and tumbo_privado.cambio_visible(yo, x)
            order by x.id desc limit 100) c), '[]'::jsonb),
    'editable', not v_demo,
    'yo', yo.id);
end $$;

-- f.1 Desde la de Crecimiento: los datos de cobro de un comercio de prueba
-- (los carga cualquiera con la contraseña pública) solo se cotejan con la
-- lista negra de la demo; si no, el panel de riesgo, la ficha 360, el aviso
-- a Finanzas y el puntaje de los pagos decían si una cuenta, un teléfono o
-- un RIF están en la lista real. Lo demás, igual.
create or replace function tumbo_privado.seller_lista_negra(p_seller text) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(distinct case l.tipo when 'cuenta' then 'cuenta bancaria' when 'telefono' then 'teléfono de cobro' else 'RIF' end, ', ')
  from tumbo.listas_negras l
  where l.activo and (l.demo or not tumbo_privado.comercio_de_prueba(p_seller)) and (
    (l.tipo = 'cuenta' and l.valor in (select c.numero from tumbo.cuentas_liquidacion c
                                       where c.seller_id = p_seller and c.estado in ('pendiente', 'verificada') and c.numero is not null))
    or (l.tipo = 'telefono' and l.valor in (select tumbo_privado.riesgo_tel(c.telefono) from tumbo.cuentas_liquidacion c
                                            where c.seller_id = p_seller and c.estado in ('pendiente', 'verificada') and c.telefono is not null))
    or (l.tipo = 'rif' and l.valor in (select tumbo_privado.documento(c.rif) from tumbo.cuentas_liquidacion c
                                       where c.seller_id = p_seller and c.estado in ('pendiente', 'verificada')
                                       union all
                                       select tumbo_privado.documento(k.rif) from tumbo.sellers_kyc k where k.seller_id = p_seller)))
$$;

-- f.2 Desde la de Crecimiento: el destino de reembolso que escribe una
-- cuenta de prueba solo se coteja con la lista de la demo (el aviso le
-- llega también a Finanzas de prueba). Lo demás, igual.
create or replace function tumbo_privado.reembolso_destino_lista_negra() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v text;
begin
  begin
    -- (el destino que escribe una cuenta de prueba, solo con la lista de la demo)
    select string_agg(distinct l.tipo, ', ') into v from tumbo.listas_negras l
    where l.activo
      and (l.demo or not exists (select 1 from tumbo.reembolsos r join tumbo.usuarios u
                                   on u.id = coalesce(r.comprador_id, (select p.comprador_id from tumbo.pedidos p where p.id = r.pedido_id))
                                 where r.id = new.reembolso_id and tumbo_privado.cuenta_demo(u.email)))
      and ((l.tipo = 'telefono' and l.valor = tumbo_privado.riesgo_tel(new.datos ->> 'telefono'))
                        or (l.tipo = 'cedula' and l.valor = tumbo_privado.riesgo_doc(new.datos ->> 'cedula'))
                        or (l.tipo = 'correo' and l.valor = lower(btrim(new.datos ->> 'correo'))));
    if v is not null then
      perform tumbo_privado.notificar('rol:finanzas', 'El destino del reembolso R-' || new.reembolso_id || ' coincide con la lista negra (' || v ||
        '): revísalo antes de enviarlo', 'gpp_maybe', 'admin/reembolsos.html');
    end if;
  exception when others then
    raise warning 'Tumbo: no se pudo cotejar el destino del reembolso % con la lista negra: %', new.reembolso_id, sqlerrm;
  end;
  return null;
end $$;

-- f.3 Desde la de Crecimiento (contrato riesgo_pedido): con un comprador de
-- prueba, la cédula o el teléfono compartidos, la referencia repetida y la
-- lista negra solo miran lo de la demo (las cuentas de prueba, sus pagos y
-- la lista marcada «demo»). Lo demás, igual.
create or replace function tumbo_privado.riesgo_pedido(p_usuario uuid, p_datos jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  cfg jsonb := coalesce(tumbo_privado.ajuste('riesgo'), '{}'::jsonb);
  v_alerta numeric := tumbo_privado.numero(cfg -> 'umbral_alerta', 40);
  v_retencion numeric := tumbo_privado.numero(cfg -> 'umbral_retencion', 80);
  u tumbo.usuarios;
  g tumbo.pagos;
  v_total numeric;
  v_ref text;
  v_sellers text[];
  v_docs text[] := '{}';
  v_tels text[] := '{}';
  v_correos text[] := '{}';
  v_rifs text[] := '{}';
  v_motivos jsonb := '[]'::jsonb;
  v_puntos integer := 0;
  v_n integer;
  v_m integer;
  v_tipos text[];
  v_marca text;
  s text;
  v_dest jsonb;
  v_demo boolean;
begin
  select * into u from tumbo.usuarios where id = p_usuario;
  -- un comprador de prueba (contraseña pública: elige el pagador y el
  -- destino) solo se compara con las cuentas, los pagos y las listas de la
  -- demo; si no, sus motivos dirían si una cédula, un teléfono o un correo
  -- son de una persona registrada o están en la lista negra real
  v_demo := coalesce(tumbo_privado.cuenta_demo(u.email), false);
  if nullif(d ->> 'pago', '') is not null then
    select * into g from tumbo.pagos where id = d ->> 'pago';
  end if;
  v_total := coalesce(tumbo_privado.num_json(d -> 'total_usd'), g.total_usd, 0);
  v_ref := coalesce(nullif(d ->> 'referencia', ''), g.ref_clave);
  if g.id is not null then
    select array_agg(distinct p.seller_id) into v_sellers from tumbo.pedidos p where p.pago_id = g.id;
    for v_dest in select p.destino from tumbo.pedidos p where p.pago_id = g.id and p.destino is not null loop
      v_docs := v_docs || tumbo_privado.riesgo_doc(v_dest ->> 'cedula');
      v_tels := v_tels || tumbo_privado.riesgo_tel(v_dest ->> 'telefono_destinatario');
    end loop;
  end if;
  if v_sellers is null and jsonb_typeof(d -> 'sellers') = 'array' then
    select array_agg(x) into v_sellers from jsonb_array_elements_text(d -> 'sellers') x;
  end if;
  v_docs := v_docs || tumbo_privado.riesgo_doc(u.cedula) || tumbo_privado.riesgo_doc(coalesce(g.pagador ->> 'cedula', d -> 'pagador' ->> 'cedula'))
                   || tumbo_privado.riesgo_doc(d -> 'destino' ->> 'cedula');
  v_tels := v_tels || tumbo_privado.riesgo_tel(u.telefono) || tumbo_privado.riesgo_tel(coalesce(g.pagador ->> 'telefono', d -> 'pagador' ->> 'telefono'))
                   || tumbo_privado.riesgo_tel(d -> 'destino' ->> 'telefono_destinatario');
  v_correos := array[lower(u.email), lower(coalesce(g.pagador ->> 'correo', d -> 'pagador' ->> 'correo'))];
  v_rifs := array[tumbo_privado.documento(coalesce(g.fiscal ->> 'documento', d -> 'fiscal' ->> 'documento'))];
  select coalesce(array_agg(distinct x), '{}') into v_docs from unnest(v_docs) x where x is not null;
  select coalesce(array_agg(distinct x), '{}') into v_tels from unnest(v_tels) x where x is not null;
  select coalesce(array_agg(distinct x), '{}') into v_correos from unnest(v_correos) x where x is not null;
  select coalesce(array_agg(distinct x), '{}') into v_rifs from unnest(v_rifs) x where x is not null;

  -- 1. cuenta nueva con un monto alto
  if u.creado > now() - make_interval(days => tumbo_privado.numero(cfg -> 'cuenta_nueva_dias', 7)::integer)
     and v_total >= tumbo_privado.numero(cfg -> 'monto_alto_usd', 300) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'cuenta_nueva', 'puntos', 30,
      'texto', 'Cuenta de ' || greatest(extract(day from now() - u.creado)::integer, 0) || ' días con una compra de ' || tumbo_privado.fmt_usd(v_total));
    v_puntos := v_puntos + 30;
  end if;
  -- 2. la misma cédula o teléfono en otras cuentas (perfil o pagos de 90
  -- días), por igualdad con los índices de riesgo_doc y riesgo_tel
  v_n := 0;
  if cardinality(v_docs) > 0 or cardinality(v_tels) > 0 then
    select count(distinct x.id) into v_n from (
      select o.id from tumbo.usuarios o
      where tumbo_privado.riesgo_doc(o.cedula) = any (v_docs) and o.id is distinct from p_usuario and o.activo
      union
      select o.id from tumbo.usuarios o
      where tumbo_privado.riesgo_tel(o.telefono) = any (v_tels) and o.id is distinct from p_usuario and o.activo
      union
      select q.comprador_id from tumbo.pagos q
      where tumbo_privado.riesgo_doc(q.pagador ->> 'cedula') = any (v_docs)
        and q.comprador_id is distinct from p_usuario and q.creado > now() - interval '90 days'
      union
      select q.comprador_id from tumbo.pagos q
      where tumbo_privado.riesgo_tel(q.pagador ->> 'telefono') = any (v_tels)
        and q.comprador_id is distinct from p_usuario and q.creado > now() - interval '90 days') x
    where not v_demo or exists (select 1 from tumbo.usuarios w where w.id = x.id and tumbo_privado.cuenta_demo(w.email));
  end if;
  if v_n > 0 then
    v_motivos := v_motivos || jsonb_build_object('regla', 'dato_compartido', 'puntos', 20,
      'texto', 'La misma cédula o teléfono aparece en ' || v_n || ' cuenta' || case when v_n = 1 then '' else 's' end || ' más');
    v_puntos := v_puntos + 20;
  end if;
  -- 3. la referencia del pago la usó otra cuenta
  if v_ref is not null and exists (select 1 from tumbo.pagos q where q.ref_clave = v_ref and q.comprador_id <> p_usuario
                                   and (g.id is null or q.id <> g.id)
                                   and (not v_demo or exists (select 1 from tumbo.usuarios w where w.id = q.comprador_id
                                                                and tumbo_privado.cuenta_demo(w.email)))) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'referencia_repetida', 'puntos', 30,
      'texto', 'La referencia del pago ya la reportó otra cuenta');
    v_puntos := v_puntos + 30;
  end if;
  -- 4. pagos rechazados repetidos
  select count(*) into v_n from tumbo.pagos q where q.comprador_id = p_usuario and q.estado = 'rechazado' and q.creado > now() - interval '30 days';
  if v_n >= tumbo_privado.numero(cfg -> 'rechazos_30d', 2) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'rechazos', 'puntos', 25, 'texto', v_n || ' pagos rechazados en 30 días');
    v_puntos := v_puntos + 25;
  end if;
  -- 5. compras muy seguidas
  select count(*) filter (where q.creado > now() - interval '1 hour'), count(*) into v_n, v_m
  from tumbo.pagos q where q.comprador_id = p_usuario and q.creado > now() - interval '1 day';
  if v_n >= tumbo_privado.numero(cfg -> 'compras_hora', 3) or v_m >= tumbo_privado.numero(cfg -> 'compras_dia', 8) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'compras_seguidas', 'puntos', 15,
      'texto', v_n || ' compras en la última hora y ' || v_m || ' en el día');
    v_puntos := v_puntos + 15;
  end if;
  -- 6. el comercio: pico de ventas o reclamos abiertos
  foreach s in array coalesce(v_sellers, '{}') loop
    select count(*) filter (where p.creado > now() - interval '1 day'), count(*) into v_n, v_m
    from tumbo.pedidos p where p.seller_id = s and p.creado > now() - interval '30 days' and p.estado <> 'cancelado';
    if v_n >= tumbo_privado.numero(cfg -> 'pico_minimo', 5)
       and v_n > tumbo_privado.numero(cfg -> 'pico_factor', 3) * greatest((v_m - v_n) / 29.0, 0.5) then
      v_motivos := v_motivos || jsonb_build_object('regla', 'pico_seller', 'puntos', 15,
        'texto', s || ' tiene un pico de ventas (' || v_n || ' pedidos en 24 horas)');
      v_puntos := v_puntos + 15;
      exit;
    end if;
    select count(*) into v_n from tumbo.disputas q where q.seller_id = s and q.estado in ('abierta', 'respondida');
    if v_n >= tumbo_privado.numero(cfg -> 'disputas_seller', 3) then
      v_motivos := v_motivos || jsonb_build_object('regla', 'disputas_seller', 'puntos', 10,
        'texto', s || ' tiene ' || v_n || ' reclamos abiertos');
      v_puntos := v_puntos + 10;
      exit;
    end if;
  end loop;
  -- 7. listas negras
  select array_agg(distinct l.tipo order by l.tipo) into v_tipos from tumbo.listas_negras l
  where l.activo and (l.demo or not v_demo) and ((l.tipo = 'cedula' and l.valor = any (v_docs)) or (l.tipo = 'telefono' and l.valor = any (v_tels))
                      or (l.tipo = 'correo' and l.valor = any (v_correos)) or (l.tipo = 'rif' and l.valor = any (v_rifs || v_docs)));
  if v_tipos is not null then
    v_motivos := v_motivos || jsonb_build_object('regla', 'lista_negra', 'puntos', 50 * cardinality(v_tipos),
      'texto', 'Coincide con la lista negra (' || array_to_string(v_tipos, ', ') || ')');
    v_puntos := v_puntos + 50 * cardinality(v_tipos);
  end if;
  -- 7 b. un comercio del pago cobra en una cuenta, un teléfono o un RIF de la lista negra
  foreach s in array coalesce(v_sellers, '{}') loop
    v_marca := tumbo_privado.seller_lista_negra(s);
    if v_marca is not null then
      v_motivos := v_motivos || jsonb_build_object('regla', 'lista_negra_comercio', 'puntos', 30,
        'texto', s || ' cobra con datos de la lista negra (' || v_marca || ')');
      v_puntos := v_puntos + 30;
      exit;
    end if;
  end loop;
  v_marca := null;
  -- 8. comprador marcado como riesgoso
  select c.motivo into v_marca from tumbo.compradores_riesgo c where c.usuario_id = p_usuario and c.activo;
  if v_marca is not null then
    v_motivos := v_motivos || jsonb_build_object('regla', 'marcado', 'puntos', 40, 'texto', 'Comprador marcado como riesgoso: ' || v_marca);
    v_puntos := v_puntos + 40;
  end if;
  v_puntos := least(v_puntos, 100);
  return jsonb_build_object('puntaje', v_puntos,
    'nivel', case when v_puntos >= v_retencion then 'alto' when v_puntos >= v_alerta then 'medio' else 'bajo' end,
    'motivos', v_motivos, 'umbral_alerta', v_alerta, 'umbral_retencion', v_retencion);
end $$;

-- f.4 Desde la de Crecimiento: las coincidencias con las listas negras (y su
-- motivo) solo con el permiso «riesgo», como el panel de riesgo; a una
-- cuenta de prueba, solo las entradas de la demo. Sin el permiso,
-- listas_negras llega null. Lo demás, igual.
create or replace function public.tm_comprador_360(p_sesion text, p_usuario uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  u tumbo.usuarios;
  v_listas jsonb;
  v_riesgo boolean := coalesce(tumbo_privado.tiene_permiso(yo, 'riesgo'), false);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
begin
  select * into u from tumbo.usuarios where id = p_usuario;
  if u.id is null or u.rol <> 'comprador' or not tumbo_privado.ve_usuario(yo, u) then
    raise exception 'Comprador no encontrado.';
  end if;
  -- su perfil, los pagadores de sus pagos y los destinos de sus reembolsos
  select coalesce(jsonb_agg(jsonb_build_object('tipo', l.tipo, 'motivo', l.motivo)), '[]'::jsonb) into v_listas
  from tumbo.listas_negras l
  where v_riesgo and l.activo and (l.demo or not v_demo) and (
    (l.tipo = 'correo' and (l.valor = lower(u.email)
                            or l.valor in (select lower(g.pagador ->> 'correo') from tumbo.pagos g where g.comprador_id = u.id)
                            or l.valor in (select lower(d.datos ->> 'correo') from tumbo.reembolso_destinos d join tumbo.reembolsos r on r.id = d.reembolso_id
                                           where r.comprador_id = u.id or r.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id))))
    or (l.tipo = 'cedula' and (l.valor = tumbo_privado.riesgo_doc(u.cedula)
                               or l.valor in (select tumbo_privado.riesgo_doc(g.pagador ->> 'cedula') from tumbo.pagos g where g.comprador_id = u.id)
                               or l.valor in (select tumbo_privado.riesgo_doc(d.datos ->> 'cedula') from tumbo.reembolso_destinos d join tumbo.reembolsos r on r.id = d.reembolso_id
                                              where r.comprador_id = u.id or r.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id))))
    or (l.tipo = 'telefono' and (l.valor = tumbo_privado.riesgo_tel(u.telefono)
                                 or l.valor in (select tumbo_privado.riesgo_tel(g.pagador ->> 'telefono') from tumbo.pagos g where g.comprador_id = u.id)
                                 or l.valor in (select tumbo_privado.riesgo_tel(d.datos ->> 'telefono') from tumbo.reembolso_destinos d join tumbo.reembolsos r on r.id = d.reembolso_id
                                                where r.comprador_id = u.id or r.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id)))));
  return jsonb_build_object(
    'usuario', jsonb_build_object('id', u.id, 'nombre', u.nombre, 'email', u.email, 'telefono', u.telefono, 'cedula', u.cedula,
                                  'creado', u.creado, 'ultimo_acceso', u.ultimo_acceso, 'activo', u.activo, 'bloqueado', u.bloqueado,
                                  'bloqueo_motivo', u.bloqueo_motivo, 'bloqueado_el', u.bloqueado_el,
                                  'correo_verificado', u.correo_verificado, 'telefono_verificado', u.telefono_verificado,
                                  'demo', tumbo_privado.cuenta_demo(u.email)),
    'puede_bloquear', tumbo_privado.gestiona_usuario(yo, u),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'estado', p.estado, 'seller_id', p.seller_id, 'seller', se.nombre,
                                                             'creado', p.creado, 'total_usd', (tumbo_privado.montos_pedido(p) ->> 'pagado')::numeric,
                                                             'pago_id', p.pago_id, 'disputa_id', p.disputa_id) order by p.creado desc)
                         from tumbo.pedidos p left join tumbo.sellers se on se.id = p.seller_id
                         where p.id in (select x.id from tumbo.pedidos x where x.comprador_id = u.id order by x.creado desc limit 50)), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'estado', g.estado, 'metodo', g.metodo, 'total_usd', g.total_usd,
                                                           'referencia', g.referencia, 'creado', g.creado, 'verificado_el', g.verificado_el,
                                                           'riesgo', tumbo_privado.riesgo_json(yo, r)) order by g.creado desc)
                       from (select * from tumbo.pagos x where x.comprador_id = u.id order by x.creado desc limit 30) g
                       left join tumbo.riesgo_pagos r on r.pago_id = g.id), '[]'::jsonb),
    'reclamos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'pedido_id', d.pedido_id, 'motivo', d.motivo, 'estado', d.estado,
                                                              'creado', d.creado, 'decision', d.resolucion_decision, 'monto_usd', d.monto_usd)
                                           order by d.creado desc)
                          from (select * from tumbo.disputas x where x.comprador_id = u.id order by x.creado desc limit 30) d), '[]'::jsonb),
    'reembolsos', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'pedido_id', r.pedido_id, 'monto_usd', r.monto_usd, 'estado', r.estado,
                                                                'tipo', r.tipo, 'motivo', r.motivo, 'creado', r.creado) order by r.creado desc)
                            from (select * from tumbo.reembolsos x
                                  where x.comprador_id = u.id or x.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id)
                                  order by x.creado desc limit 30) r), '[]'::jsonb),
    'credito_usd', (select coalesce(sum(c.monto_usd), 0) from tumbo.creditos c where c.usuario_id = u.id),
    'notas', tumbo_privado.notas_json(yo, 'comprador', u.id::text),
    'riesgo', jsonb_build_object(
      'marcado', (select jsonb_build_object('motivo', c.motivo, 'desde', c.desde, 'por', tumbo_privado.firma_visible(yo, c.por_id, c.por))
                  from tumbo.compradores_riesgo c where c.usuario_id = u.id and c.activo),
      'listas_negras', case when v_riesgo then v_listas end,
      'ultimo', (select tumbo_privado.riesgo_json(yo, r) from tumbo.riesgo_pagos r where r.comprador_id = u.id order by r.calculado desc limit 1)));
end $$;

-- g.1 Desde la de Crecimiento: además del tope por minuto (por red y en
-- total), un techo diario de 100.000 eventos y uno de un millón de filas
-- (la estimación de la tabla), fijos: lo que los pasa se descarta en
-- silencio, como lo demás. Lo demás, igual.
create or replace function public.tm_analitica_registrar(p_eventos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := coalesce(tumbo_privado.ajuste('analitica'), '{}'::jsonb);
  v_tope integer := tumbo_privado.numero(cfg -> 'eventos_minuto_red', 120)::integer;
  v_total integer := tumbo_privado.numero(cfg -> 'eventos_minuto_total', 6000)::integer;
  v_lote integer;
  v_cuenta integer;
  e jsonb;
  p tumbo.productos;
  v_raiz text;
  v_n integer := 0;
  v_tipo text;
  v_vis text;
begin
  if jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) = 0 then
    return jsonb_build_object('registrados', 0);
  end if;
  v_lote := least(jsonb_array_length(p_eventos), 20);
  if tumbo_privado.tope_red('analitica', 1, v_tope, v_lote) then
    return jsonb_build_object('registrados', 0, 'limitado', true);
  end if;
  insert into tumbo.topes_crecimiento as t (red, tipo, ventana, n)
  values ('*', 'analitica', date_bin(interval '1 minute', now(), timestamptz '2000-01-01'), v_lote)
  on conflict (red, tipo, ventana) do update set n = t.n + v_lote
  returning n into v_cuenta;
  if v_cuenta > v_total then
    return jsonb_build_object('registrados', 0, 'limitado', true);
  end if;
  -- y techos fijos: 100.000 eventos por día y un millón de filas guardadas
  -- (unos 190 MB): con muchas redes a la vez, el tope por minuto dejaba
  -- entrar millones de filas al día (y la base se llenaba)
  insert into tumbo.topes_crecimiento as t (red, tipo, ventana, n)
  values ('*', 'analitica_dia', date_bin(interval '1 day', now(), timestamptz '2000-01-01'), v_lote)
  on conflict (red, tipo, ventana) do update set n = t.n + v_lote
  returning n into v_cuenta;
  if v_cuenta > 100000
     or coalesce((select c.reltuples from pg_catalog.pg_class c where c.oid = 'tumbo.eventos_analitica'::regclass), 0) > 1000000 then
    return jsonb_build_object('registrados', 0, 'limitado', true);
  end if;
  for e in select x from jsonb_array_elements(p_eventos) x limit 20 loop
    v_tipo := e ->> 'tipo';
    continue when jsonb_typeof(e) <> 'object'
      or v_tipo not in ('busqueda', 'vista_producto', 'agregar_carrito', 'inicio_checkout', 'abandono_checkout', 'pago_reportado');
    p := null;
    v_raiz := null;
    if nullif(e ->> 'sku', '') is not null then
      select * into p from tumbo.productos where sku = left(e ->> 'sku', 40) and estado = 'publicado';
      if p.sku is not null then
        select coalesce(k.padre, k.id) into v_raiz from tumbo.categorias k where k.id = p.categoria;
      end if;
    end if;
    continue when v_tipo in ('vista_producto', 'agregar_carrito') and p.sku is null;
    v_vis := case when coalesce(e ->> 'visitante', '') ~ '^[a-z0-9]{8,32}$' then e ->> 'visitante' end;
    insert into tumbo.eventos_analitica (tipo, sku, seller_id, categoria, texto, origen, visitante)
    values (v_tipo, p.sku, p.seller_id, coalesce(v_raiz, p.categoria),
            case when v_tipo = 'busqueda' or (v_tipo = 'vista_producto' and e ->> 'origen' = 'busqueda') then tumbo_privado.texto_analitica(e ->> 'texto') end,
            case when e ->> 'origen' in ('busqueda', 'coleccion', 'banner', 'inicio', 'categoria', 'tienda', 'otro') then e ->> 'origen' end,
            v_vis);
    v_n := v_n + 1;
  end loop;
  if random() < 0.002 then
    perform tumbo_privado.tarea_analitica();
  end if;
  return jsonb_build_object('registrados', v_n);
end $$;

-- h.1 Desde la de Comunicación: el texto se normaliza (NFKC) antes de
-- buscar, así «０４１４-５５５-１２３４» es 0414-555-1234, y la I mayúscula,
-- la l minúscula o la barra pegadas a una cifra cuentan como un 1 (como la
-- O como un 0): «04I4 555 I234». Lo demás, igual.
create or replace function tumbo_privado.ocultar_contacto(p_texto text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  -- (NFKC: las cifras de ancho completo y otras variantes pasan a 0-9)
  v text := normalize(coalesce(p_texto, ''), NFKC);
  v_ocultos text[] := '{}';
  v_dom constant text := '\m[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.(com|net|org|ve|co|info|io|me|app|link|ly|gl|xyz|shop|store|site|online|top|biz|page|bio)\M(/[^[:space:]]*)?';
  v_sep constant text := '[[:space:].()/_‐‑‒–—―−-]';
  v_dig constant text := '(?:[0-9]|[OoIl|](?=[0-9])|(?<=[0-9])[OoIl|])';
  v_cel constant text := '0?4(12|14|16|22|24|26)[0-9]{7}';
  m text;
  d text;
  r text;
begin
  if v ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' then
    v := regexp_replace(v, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[correo oculto]', 'g');
    v_ocultos := v_ocultos || 'correo'::text;
  end if;
  if v ~* '(https?://|www\.)[^[:space:]]+' or v ~* v_dom then
    v := regexp_replace(v, '(https?://|www\.)[^[:space:]]+', '[enlace oculto]', 'gi');
    v := regexp_replace(v, v_dom, '[enlace oculto]', 'gi');
    v_ocultos := v_ocultos || 'enlace'::text;
  end if;
  if v ~ '(^|[^[:alnum:]_.])@[A-Za-z0-9_.]{3,30}' then
    v := regexp_replace(v, '(^|[^[:alnum:]_.])@[A-Za-z0-9_.]{3,30}', '\1[usuario oculto]', 'g');
    v_ocultos := v_ocultos || 'usuario'::text;
  end if;
  for m in
    select y from (select distinct x[1] as y
                   from regexp_matches(v, '(?<![[:alnum:]])(\+?' || v_dig || '(?:' || v_sep || '{0,3}' || v_dig || '){6,})(?![[:alnum:]])', 'g') as t (x)) z
    order by char_length(y) desc, y
  loop
    d := regexp_replace(translate(m, 'OoIl|', '00111'), '[^0-9]', '', 'g');
    r := case when char_length(d) >= 16 then case when d ~ v_cel then '[teléfono oculto]' else '[número de cuenta oculto]' end
              when d ~ '^(58)?0?(2[0-9]{2}|4(12|14|16|22|24|26))[0-9]{7}$' then '[teléfono oculto]'
              when char_length(d) >= 10 and d ~ v_cel then '[teléfono oculto]'
              when m like '+%' and char_length(d) between 8 and 15 then '[teléfono oculto]' end;
    continue when r is null;
    v := replace(v, m, r);
    v_ocultos := v_ocultos || case when r like '%cuenta%' then 'cuenta' else 'telefono' end;
  end loop;
  return jsonb_build_object('texto', v,
    'ocultos', coalesce((select jsonb_agg(distinct o) from unnest(v_ocultos) o), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: no hay funciones public.tm_* nuevas (las redefinidas
-- conservan los suyos); lo de tumbo_privado no se invoca desde la API.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

notify pgrst, 'reload schema';
