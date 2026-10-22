-- Quita Tumbo Market de un proyecto Supabase sin tocar nada más: sus dos
-- esquemas y sus funciones public.tm_*, por nombre (una función tm_* de otra
-- aplicación no se borra).
drop schema if exists tumbo cascade;
drop schema if exists tumbo_privado cascade;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'tm_acceder', 'tm_registrar', 'tm_sesion', 'tm_salir', 'tm_cargar', 'tm_marcar_notificaciones_leidas',
      'tm_carrito_poner', 'tm_carrito_quitar', 'tm_fusionar_carrito', 'tm_direccion_agregar', 'tm_direccion_quitar',
      'tm_crear_pedido', 'tm_conciliar_pago', 'tm_rechazar_pago', 'tm_aceptar_pedido', 'tm_marcar_listo',
      'tm_despachar', 'tm_confirmar_entrega', 'tm_cancelar_pedido', 'tm_abrir_disputa', 'tm_responder_disputa',
      'tm_resolver_disputa', 'tm_cerrar_devolucion', 'tm_cerrar_ventana', 'tm_ejecutar_liquidacion',
      'tm_guardar_producto', 'tm_ajustar_producto', 'tm_pausar_producto', 'tm_moderar_producto', 'tm_decidir_kyc',
      'tm_reiniciar_demo'])
  loop
    execute format('drop function %s', f.firma);
  end loop;
end $$;
