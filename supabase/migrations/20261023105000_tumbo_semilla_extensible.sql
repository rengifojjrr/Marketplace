-- =========================================================================
-- Tumbo Market — Reinicio de la demo extensible por dominio
-- -------------------------------------------------------------------------
-- Cada equipo de las olas siguientes aporta, si lo necesita,
-- tumbo_privado.sembrar_ext_<dominio>(p_auditoria boolean): limpia sus
-- propias tablas (DELETE con WHERE: el proyecto usa pg-safeupdate) y siembra
-- sus datos de demostración. El reinicio las llama todas, en orden
-- alfabético, después de la semilla base.
-- Solo agrega: redefine tm_reiniciar_demo (desde la migración de fundaciones).
-- =========================================================================

create function tumbo_privado.sembrar_extensiones(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f text;
begin
  for f in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tumbo_privado' and p.proname like 'sembrar\_ext\_%'
      and pg_get_function_identity_arguments(p.oid) = 'p_auditoria boolean'
    order by p.proname
  loop
    execute format('select tumbo_privado.%I($1)', f) using p_auditoria;
  end loop;
end $$;

create or replace function public.tm_reiniciar_demo(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
begin
  truncate tumbo.notificaciones_leidas, tumbo.notificaciones, tumbo.liquidaciones,
           tumbo.disputas, tumbo.pedido_eventos, tumbo.pedido_items, tumbo.reembolsos, tumbo.pedidos,
           tumbo.carrito_items, tumbo.direcciones restart identity;
  update tumbo.archivos set estado = 'descartado', motivo = 'reinicio de la demo' where estado <> 'descartado';
  -- (con WHERE explícito: el proyecto usa pg-safeupdate, que rechaza DELETE sin condición)
  delete from tumbo.salida where plantilla in ('pago_confirmado', 'pedido_despachado', 'pedido_listo_retiro', 'pago_por_vencer',
                                               'pedido_por_aceptar', 'reclamo_actualizado', 'reembolso_enviado', 'liquidacion_pagada');
  delete from tumbo.productos where sku is not null;
  delete from tumbo.seller_documentos where seller_id is not null;
  delete from tumbo.sellers_kyc where seller_id is not null;
  perform tumbo_privado.sembrar(false);
  perform tumbo_privado.sembrar_extensiones(false);
  perform tumbo_privado.auditar(yo, 'Demo reiniciada', 'Datos de negocio restaurados a la semilla');
end $$;

revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

notify pgrst, 'reload schema';
