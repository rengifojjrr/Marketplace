-- Quita Tumbo Market de un proyecto Supabase sin tocar nada más.
--
-- Antes de borrar comprueba que los esquemas `tumbo` y `tumbo_privado` son
-- los de Tumbo y que ningún objeto de fuera depende de ellos; si algo no
-- cuadra, se detiene sin borrar nada. Las funciones public.tm_* se borran
-- por firma exacta (una función de otra aplicación con el mismo nombre no se
-- toca). De los buckets de Storage de Tumbo (tumbo-publico, tumbo-espera y
-- tumbo-privado) se borran los archivos de Tumbo, y el bucket solo si queda
-- vacío; ningún otro bucket se toca. Donde Storage no deja borrar por SQL
-- (Supabase protege storage.objects y storage.buckets: exige su API), se
-- avisa y ese bucket queda para vaciarlo y borrarlo desde el panel, sin
-- detener el retiro. Todo lo demás ocurre en una sola sentencia: o se borra
-- todo o nada.
do $$
declare
  firmas text[] := array[
    'public.tm_acceder(text,text)', 'public.tm_registrar(text,text,text)', 'public.tm_sesion(text)',
    'public.tm_salir(text)', 'public.tm_cargar(text)', 'public.tm_cargar(text,text)',
    'public.tm_auditoria(text,bigint,text)', 'public.tm_marcar_notificaciones_leidas(text)',
    'public.tm_carrito_poner(text,text,integer)', 'public.tm_carrito_quitar(text,text)',
    'public.tm_fusionar_carrito(text,jsonb)', 'public.tm_direccion_agregar(text,jsonb)',
    'public.tm_direccion_quitar(text,uuid)', 'public.tm_crear_pedido(text,text,uuid,text,text)',
    'public.tm_crear_pedido(text,text,uuid,text,text,numeric)', 'public.tm_conciliar_pago(text,text)',
    'public.tm_rechazar_pago(text,text,text)', 'public.tm_aceptar_pedido(text,text)',
    'public.tm_marcar_listo(text,text,numeric)', 'public.tm_despachar(text,text)',
    'public.tm_confirmar_entrega(text,text)', 'public.tm_cancelar_pedido(text,text,text)',
    'public.tm_abrir_disputa(text,text,text,text,text[])', 'public.tm_responder_disputa(text,text,text,text[])',
    'public.tm_resolver_disputa(text,text,text,text)', 'public.tm_cerrar_devolucion(text,text,boolean)',
    'public.tm_cerrar_ventana(text,text)', 'public.tm_ejecutar_liquidacion(text,text)',
    'public.tm_ejecutar_liquidacion(text,text,text[])', 'public.tm_guardar_producto(text,jsonb,boolean)',
    'public.tm_ajustar_producto(text,text,text,numeric)', 'public.tm_pausar_producto(text,text,boolean)',
    'public.tm_moderar_producto(text,text,boolean,text)', 'public.tm_decidir_kyc(text,text,text,text)',
    'public.tm_reiniciar_demo(text)',
    -- ola 0 (fundaciones)
    'public.tm_ajustes_publicos()', 'public.tm_ajuste_guardar(text,text,jsonb)',
    'public.tm_archivo_preparar(text,text,text,text,bigint,text)', 'public.tm_archivo_confirmar(text,uuid)',
    'public.tm_archivo_acceso(text,uuid)', 'public.tm_salida_listar(text,text,bigint)',
    'public.tm_salida_marcar(text,bigint,text,text)', 'public.tm_reembolsos(text)', 'public.tm_archivos_limpiar()',
    -- ola 1 (cuentas)
    'public.tm_acceder_2fa(text,text)', 'public.tm_elevar(text,text)', 'public.tm_registrar(text,text,text,text,text)',
    'public.tm_perfil(text)', 'public.tm_perfil_guardar(text,jsonb)', 'public.tm_clave_cambiar(text,text,text)',
    'public.tm_clave_recuperar(text)', 'public.tm_clave_enlace(text)', 'public.tm_clave_restablecer(text,text)',
    'public.tm_verificacion_enviar(text,text)', 'public.tm_verificacion_confirmar(text,text,text)',
    'public.tm_sesiones(text)', 'public.tm_sesion_cerrar(text,uuid)', 'public.tm_sesiones_cerrar_otras(text)',
    'public.tm_2fa_iniciar(text,text)', 'public.tm_2fa_confirmar(text,text)', 'public.tm_2fa_desactivar(text,text)',
    'public.tm_2fa_respaldo(text,text)', 'public.tm_cuenta_eliminar(text,text,text)',
    'public.tm_invitar(text,text,text,jsonb)', 'public.tm_invitaciones(text)', 'public.tm_invitacion_revocar(text,uuid)',
    'public.tm_invitacion_ver(text)', 'public.tm_invitacion_aceptar(text,text,text,text)',
    'public.tm_equipo(text)', 'public.tm_equipo_quitar(text,uuid)', 'public.tm_permisos(text)',
    'public.tm_permiso_asignar(text,uuid,text,boolean)', 'public.tm_admin_usuarios(text,text,text)',
    'public.tm_admin_usuario(text,uuid)', 'public.tm_admin_sesiones_cerrar(text,uuid,uuid)',
    'public.tm_admin_bloquear(text,uuid,boolean,text)', 'public.tm_admin_recuperacion(text,uuid)',
    'public.tm_admin_rol(text,uuid,text)', 'public.tm_admin_2fa_quitar(text,uuid,text)', 'public.tm_admin_baja(text,uuid,text)',
    'public.tm_direccion_editar(text,uuid,jsonb)',
    'public.tm_direccion_predeterminada(text,uuid)',
    -- ola 1 (catálogo)
    'public.tm_buscar(text,jsonb,text,integer)', 'public.tm_busquedas_sin_resultado(text)',
    'public.tm_favorito(text,text,boolean)', 'public.tm_alerta(text,text,text,boolean)',
    'public.tm_ajustar_precio(text,text,numeric,boolean)', 'public.tm_precios_masivo(text,jsonb,boolean)',
    'public.tm_precios_deshacer(text,uuid)', 'public.tm_precio_minimo(text,text,numeric)',
    'public.tm_precio_historial(text,text)', 'public.tm_stock_movimiento(text,text,text,integer,text)',
    'public.tm_stock_umbral(text,text,integer)', 'public.tm_kardex(text,text,bigint)',
    'public.tm_importar_productos(text,jsonb,text,boolean,boolean,boolean)', 'public.tm_moderar_lote(text,text[],boolean,text)',
    'public.tm_kyc_guardar(text,jsonb)', 'public.tm_kyc_documento(text,integer,uuid)', 'public.tm_kyc_enviar(text)',
    'public.tm_kyc_revisar(text,text,integer,text,text)', 'public.tm_tienda_guardar(text,jsonb)',
    'public.tm_kyc_archivo(text,text,integer)',
    -- ola 1 (pagos)
    'public.tm_tasa_vigente()', 'public.tm_metodos_pago()',
    'public.tm_checkout_cotizar(text,jsonb)', 'public.tm_checkout_crear(text,jsonb)',
    'public.tm_pago_ver(text,text)', 'public.tm_pagos_mios(text)', 'public.tm_pago_reportar(text,text,jsonb)',
    'public.tm_pago_corregir(text,text,text)', 'public.tm_pago_tardio(text,text,text,text)', 'public.tm_pagos_cola(text,text)',
    'public.tm_conciliacion_formatos(text)', 'public.tm_conciliacion_formato_guardar(text,text,jsonb)',
    'public.tm_conciliacion_importar(text,text,jsonb,text)', 'public.tm_conciliacion_movimientos(text,text,bigint)',
    'public.tm_conciliacion_resolver(text,bigint,text,text,text)',
    'public.tm_reembolso_destino(text,bigint,jsonb)', 'public.tm_credito(text)',
    'public.tm_reembolsos_gestion(text,text)', 'public.tm_reembolso_procesar(text,bigint,text,jsonb)',
    'public.tm_tasas(text)', 'public.tm_tasa_proponer(text,numeric,date,text)', 'public.tm_tasa_decidir(text,bigint,boolean)',
    'public.tm_metodo_pago_guardar(text,text,jsonb)',
    'public.tm_cuentas_liquidacion(text)', 'public.tm_cuenta_liquidacion_guardar(text,jsonb)',
    'public.tm_cuenta_liquidacion_verificar(text,bigint,boolean,text)', 'public.tm_cuenta_liquidacion_anular(text,bigint,text)',
    'public.tm_liquidacion_aprobar(text,text)', 'public.tm_liquidacion_pagar(text,text,text,uuid)',
    'public.tm_liquidacion_fallar(text,text,text)', 'public.tm_liquidacion_anular(text,text,text)',
    'public.tm_liquidaciones_corridas(text)', 'public.tm_liquidaciones_lote(text,text[])',
    'public.tm_ajuste_seller(text,text,numeric,text)', 'public.tm_retencion_seller(text,text,boolean,text)',
    'public.tm_libro_mayor(text,date,date)', 'public.tm_finanzas_resumen(text,date,date)',
    'public.tm_finanzas_exportar(text,text,date,date)', 'public.tm_seller_estado_cuenta(text,date,date)',
    'public.tm_pedido_recibo(text,text)',
    -- ola 1 (logística)
    'public.tm_envio_referencias()', 'public.tm_logistica_admin(text)', 'public.tm_envio_config(text)',
    'public.tm_envio_promesa(text,text,text)', 'public.tm_envios_cola(text)', 'public.tm_pedido_envio(text,text)',
    'public.tm_envio_etiquetas(text,text[])', 'public.tm_envio_metricas(text,text)', 'public.tm_envio_config_guardar(text,jsonb)',
    'public.tm_despachar_guia(text,text,jsonb)', 'public.tm_despachar_lote(text,jsonb,uuid)', 'public.tm_envio_en_agencia(text,text,bigint)',
    'public.tm_incidencia_reportar(text,text,text,text)', 'public.tm_cancelar_seller(text,text,text,text)',
    'public.tm_cancelacion_responder(text,text,boolean,text)', 'public.tm_cancelar_ops(text,text,text,text)',
    'public.tm_incidencia_registrar(text,text,text,text,jsonb)', 'public.tm_incidencia_resolver(text,bigint,text)',
    'public.tm_entrega_confirmar(text,text,uuid,text)', 'public.tm_devolucion_instrucciones(text,text,jsonb)',
    'public.tm_devolucion_guia(text,text,text,text)', 'public.tm_devolucion_inspeccionar(text,text,text,text,uuid)',
    'public.tm_operaciones_asignar(text,text,uuid)', 'public.tm_nota_interna(text,text,text)', 'public.tm_pedido_360(text,text)',
    'public.tm_operaciones_panel(text,jsonb)', 'public.tm_courier_guardar(text,jsonb)', 'public.tm_tarifa_guardar(text,jsonb)',
    'public.tm_oficina_guardar(text,jsonb)', 'public.tm_zona_estado(text,text,text)',
    'public.tm_feriado_guardar(text,date,text,boolean)', 'public.tm_logistica_plazos_guardar(text,jsonb)', 'public.tm_sla_revisar(text)',
    -- ola 2 (comunicación)
    'public.tm_envios_autorizar(text,text)', 'public.tm_envios_tomar(text[],integer)',
    'public.tm_envios_resultado(bigint,boolean,text,text,text,boolean)', 'public.tm_envios_reporte(jsonb)',
    'public.tm_mensajes(text,jsonb)', 'public.tm_envios_estado(text)', 'public.tm_mensaje_reintentar(text,bigint)',
    'public.tm_whatsapp_plantilla_guardar(text,text,jsonb)',
    'public.tm_avisos(text)', 'public.tm_avisos_guardar(text,jsonb)', 'public.tm_whatsapp_consentimiento(text,boolean)',
    'public.tm_chat(text,text,bigint)', 'public.tm_chat_pendientes(text)', 'public.tm_chat_enviar(text,text,text,uuid[])',
    'public.tm_preguntas(text,text,integer)', 'public.tm_pregunta_hacer(text,text,text)', 'public.tm_preguntas_seller(text,text)',
    'public.tm_pregunta_responder(text,bigint,text)', 'public.tm_respuesta_rapida_guardar(text,bigint,text,text)',
    'public.tm_reputacion(text)', 'public.tm_resenas(text,text,text,integer)', 'public.tm_resenas_pendientes(text)',
    'public.tm_resena_crear(text,text,jsonb)', 'public.tm_resenas_seller(text)', 'public.tm_resena_responder(text,bigint,text)',
    'public.tm_legales(text)', 'public.tm_legal_aceptar(text,text,text)', 'public.tm_legal_publicar(text,jsonb)',
    'public.tm_legal_texto_publicado(text,text,text)',
    'public.tm_disputa_envio_vuelta(text,text,numeric,text[])', 'public.tm_disputa_envio_vuelta_resolver(text,text,jsonb)',
    'public.tm_denunciar(text,text,text,text,text)', 'public.tm_contenido_cola(text,text)',
    'public.tm_contenido_moderar(text,text,bigint,text,text)', 'public.tm_denuncia_cerrar(text,bigint,text,text)',
    'public.tm_ticket_crear(text,jsonb)', 'public.tm_tickets(text,jsonb)', 'public.tm_ticket(text,text)',
    'public.tm_ticket_responder(text,text,text,uuid[],boolean)', 'public.tm_ticket_gestionar(text,text,jsonb)',
    'public.tm_soporte_macro_guardar(text,bigint,jsonb)',
    'public.tm_disputa(text,text)', 'public.tm_disputas_resumen(text)', 'public.tm_disputa_resolver(text,text,jsonb)',
    'public.tm_disputa_mensaje(text,text,text,text[])', 'public.tm_disputa_solicitar(text,text,text,text,integer)',
    'public.tm_disputa_apelar(text,text,text,text[])', 'public.tm_disputa_apelacion_resolver(text,text,jsonb)',
    'public.tm_comunicacion_revisar(text)',
    -- ola 2 (crecimiento)
    'public.tm_ajustes_admin(text)', 'public.tm_config_guardar(text,text,jsonb)', 'public.tm_cambio_decidir(text,bigint,boolean,text)',
    'public.tm_comision_proponer(text,jsonb)', 'public.tm_comision_terminar(text,bigint,text)',
    'public.tm_moderacion_panel(text)', 'public.tm_moderacion_regla(text,jsonb)', 'public.tm_moderacion_marca(text,bigint,text,text)',
    'public.tm_moderacion_revisar_publicados(text)', 'public.tm_moderacion_retirar(text,text[],text)',
    'public.tm_denuncias(text,text)', 'public.tm_denuncia_resolver(text,bigint,text,text)',
    'public.tm_sancion_aplicar(text,text,text,text,jsonb)', 'public.tm_sancion_levantar(text,bigint,text)',
    'public.tm_niveles_recalcular(text)', 'public.tm_niveles_publicos()', 'public.tm_ficha_nota(text,text,text,text)',
    'public.tm_seller_360(text,text)', 'public.tm_comprador_360(text,uuid)',
    'public.tm_riesgo_pagos(text,text[])', 'public.tm_riesgo_liberar(text,text,text)', 'public.tm_riesgo_panel(text)',
    'public.tm_lista_negra_guardar(text,text,text,text)', 'public.tm_lista_negra_quitar(text,bigint,text)',
    'public.tm_comprador_marcar(text,uuid,boolean,text)',
    'public.tm_promos_producto(text)', 'public.tm_promos_skus(text[])', 'public.tm_promociones_cotizar(text,jsonb,text)',
    'public.tm_marketing_portada()', 'public.tm_coleccion(text)', 'public.tm_marketing_admin(text)',
    'public.tm_campana_guardar(text,jsonb)', 'public.tm_banner_guardar(text,jsonb)', 'public.tm_coleccion_guardar(text,jsonb)',
    'public.tm_oferta_guardar(text,jsonb)', 'public.tm_cupon_guardar(text,jsonb)', 'public.tm_promocion_estado(text,text,bigint,boolean)',
    'public.tm_seller_promociones(text)',
    'public.tm_analitica_registrar(jsonb)', 'public.tm_metricas_negocio(text,jsonb)', 'public.tm_seller_estadisticas(text,jsonb)'];
  f text;
  ajenos text;
  b text;
begin
  if to_regnamespace('tumbo') is null and to_regnamespace('tumbo_privado') is null then
    raise notice 'Tumbo no está instalado en esta base.';
    return;
  end if;
  if to_regnamespace('tumbo') is null or to_regnamespace('tumbo_privado') is null
     or coalesce(obj_description('tumbo'::regnamespace, 'pg_namespace'), '') not like 'Tumbo Market (beta)%'
     or coalesce(obj_description('tumbo_privado'::regnamespace, 'pg_namespace'), '') not like 'Tumbo Market (beta)%'
     or to_regclass('tumbo.usuarios') is null then
    raise exception 'Los esquemas «tumbo»/«tumbo_privado» de esta base no parecen ser los de Tumbo Market: no se borra nada.';
  end if;

  -- Objetos de fuera de Tumbo que dependen de algo de Tumbo: un CASCADE se
  -- los llevaría por delante, así que se avisa y no se borra nada.
  -- (los subobjetos —valores por omisión, disparadores, restricciones,
  -- reglas de vistas, políticas— cuentan en el esquema de su tabla)
  with dependientes as (
    select d.classid, d.objid, d.objsubid
    from pg_depend d
    cross join lateral pg_identify_object(d.refclassid, d.refobjid, d.refobjsubid) ref
    where d.deptype in ('n', 'a')
      and (ref.schema in ('tumbo', 'tumbo_privado')
           or (d.refclassid = 'pg_namespace'::regclass and d.refobjid in ('tumbo'::regnamespace, 'tumbo_privado'::regnamespace)))
  ), ubicados as (
    select x.*, coalesce(case x.classid
      when 'pg_attrdef'::regclass then (select c.relnamespace from pg_attrdef a join pg_class c on c.oid = a.adrelid where a.oid = x.objid)
      when 'pg_trigger'::regclass then (select c.relnamespace from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.oid = x.objid)
      when 'pg_constraint'::regclass then (select coalesce(c.relnamespace, ty.typnamespace, k.connamespace) from pg_constraint k
                                           left join pg_class c on c.oid = k.conrelid left join pg_type ty on ty.oid = k.contypid
                                           where k.oid = x.objid)
      when 'pg_rewrite'::regclass then (select c.relnamespace from pg_rewrite r join pg_class c on c.oid = r.ev_class where r.oid = x.objid)
      when 'pg_policy'::regclass then (select c.relnamespace from pg_policy pol join pg_class c on c.oid = pol.polrelid where pol.oid = x.objid)
      when 'pg_class'::regclass then (select relnamespace from pg_class where oid = x.objid)
      when 'pg_proc'::regclass then (select pronamespace from pg_proc where oid = x.objid)
      when 'pg_type'::regclass then (select typnamespace from pg_type where oid = x.objid)
    end, 0::oid) as esquema
    from dependientes x
  )
  select string_agg(distinct pg_describe_object(u.classid, u.objid, u.objsubid), '; ') into ajenos
  from ubicados u
  where u.esquema not in ('tumbo'::regnamespace, 'tumbo_privado'::regnamespace)
    and not (u.classid = 'pg_proc'::regclass and u.objid in (
      select to_regprocedure(f2)::oid from unnest(firmas) f2 where to_regprocedure(f2) is not null));
  if ajenos is not null then
    raise exception 'Hay objetos de otras aplicaciones que dependen de Tumbo (%): revísalos antes de retirarlo.', ajenos;
  end if;

  -- Storage: solo los objetos de Tumbo, y el bucket si queda vacío.
  if to_regclass('storage.objects') is not null and to_regclass('tumbo.archivos') is not null then
    foreach b in array array['tumbo-publico', 'tumbo-espera', 'tumbo-privado'] loop
      begin
        -- registrados en tumbo.archivos o con la forma de ruta que da Tumbo
        -- (<propósito>/<seller o usuario>/<uuid>.<ext>, p. ej. los que dejó un reinicio de la demo)
        delete from storage.objects o
        where o.bucket_id = b
          and (exists (select 1 from tumbo.archivos a where a.ruta = o.name)
               or o.name ~ '^(producto|perfil|kyc|evidencia|comprobante|guia|entrega|chat|liquidacion|resena|soporte|marketing)/[A-Za-z0-9-]+/[0-9a-f-]{36}\.(jpg|png|webp|pdf|mp4|bin)$');
      exception when others then
        raise notice 'Storage no deja borrar los archivos de «%» por SQL (%): vacíalo desde el panel de Supabase.', b, sqlerrm;
      end;
      if not exists (select 1 from storage.objects o where o.bucket_id = b) then
        begin
          delete from storage.buckets where id = b;
        exception when others then
          raise notice 'Storage no deja borrar el bucket «%» por SQL (%): bórralo desde el panel de Supabase.', b, sqlerrm;
        end;
      else
        raise notice 'El bucket «%» no quedó vacío: se conserva.', b;
      end if;
    end loop;
  end if;

  -- Las tareas programadas de Tumbo (pg_cron), si existe: solo las suyas
  -- (pagos: tumbo-pagos-*; logística: tumbo-sla; comunicación:
  -- tumbo-comunicacion y tumbo-envios; crecimiento: tumbo-crecimiento-*).
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      for b in execute $q$select jobid::text from cron.job where jobname like 'tumbo-%'$q$ loop
        execute 'select cron.unschedule($1::bigint)' using b;
      end loop;
    exception when others then
      raise notice 'No se pudieron quitar las tareas programadas «tumbo-…» (%): quítalas desde el panel.', sqlerrm;
    end;
  end if;

  foreach f in array firmas loop
    if to_regprocedure(f) is not null then
      execute format('drop function %s', to_regprocedure(f));
    end if;
  end loop;
  drop schema tumbo cascade;
  drop schema tumbo_privado cascade;
  raise notice 'Tumbo Market retirado.';
end $$;
