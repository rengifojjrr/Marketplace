-- =========================================================================
-- Tumbo Market — Seguridad: ayudantes de rol, RLS y privilegios
-- -------------------------------------------------------------------------
-- Principio: cada fila se ve solo si el rol la necesita para trabajar.
--   · visitante (anon): catálogo publicado de sellers aprobados.
--   · comprador: además, sus direcciones, carrito, pedidos, reclamos y avisos.
--   · seller / precios / operador: su comercio (productos en todos los estados,
--     pedidos de seller y operador, reclamos y liquidaciones del principal).
--   · superadmin: todo. ops: pedidos y disputas. finanzas: pedidos,
--     liquidaciones y auditoría.
-- Las escrituras de negocio no tienen privilegio directo: van por `tm_*`.
-- =========================================================================

-- Ninguna función de `privado` es ejecutable por omisión.
alter default privileges in schema privado revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Ayudantes de rol (los usan las políticas; definer para leer perfiles sin RLS)
-- ---------------------------------------------------------------------------
create function privado.rol() returns text
language sql stable security definer set search_path = '' as $$
  select rol from public.perfiles where id = (select auth.uid())
$$;

create function privado.seller_id() returns text
language sql stable security definer set search_path = '' as $$
  select seller_id from public.perfiles where id = (select auth.uid())
$$;

create function privado.tiene_rol(p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select rol from public.perfiles where id = (select auth.uid())) = any (p_roles), false)
$$;

grant usage on schema privado to anon, authenticated;
revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol(), privado.seller_id(), privado.tiene_rol(text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Alta de perfil: todo usuario nuevo nace comprador. El rol jamás se toma de
-- los metadatos que envía el cliente.
-- ---------------------------------------------------------------------------
create function privado.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, email, nombre, rol)
  values (new.id,
          lower(coalesce(new.email, new.id::text)),
          left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(coalesce(new.email, 'usuario'), '@', 1)), 80),
          'comprador')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger tumbo_crear_perfil
  after insert on auth.users
  for each row execute function privado.crear_perfil();

-- ---------------------------------------------------------------------------
-- RLS en todas las tablas
-- ---------------------------------------------------------------------------
alter table public.config                enable row level security;
alter table public.categorias            enable row level security;
alter table public.sellers               enable row level security;
alter table public.sellers_kyc           enable row level security;
alter table public.seller_documentos     enable row level security;
alter table public.perfiles              enable row level security;
alter table public.productos             enable row level security;
alter table public.direcciones           enable row level security;
alter table public.carrito_items         enable row level security;
alter table public.pedidos               enable row level security;
alter table public.pedido_items          enable row level security;
alter table public.pedido_eventos        enable row level security;
alter table public.disputas              enable row level security;
alter table public.liquidaciones         enable row level security;
alter table public.notificaciones        enable row level security;
alter table public.notificaciones_leidas enable row level security;
alter table public.auditoria             enable row level security;

-- Privilegios mínimos (Supabase concede todo por omisión: se retira y se
-- devuelve solo lo necesario).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.config, public.categorias, public.sellers, public.productos to anon, authenticated;
grant select on public.sellers_kyc, public.seller_documentos, public.perfiles,
                public.pedidos, public.pedido_items, public.pedido_eventos,
                public.disputas, public.liquidaciones,
                public.notificaciones, public.notificaciones_leidas, public.auditoria to authenticated;
grant select, insert, update, delete on public.direcciones, public.carrito_items to authenticated;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
create policy config_lectura on public.config
  for select to anon, authenticated using (true);

create policy categorias_lectura on public.categorias
  for select to anon, authenticated using (true);

-- Sellers: el perfil público de los aprobados; el propio comercio; el
-- backoffice; y el comprador, los sellers de sus pedidos (aunque luego se
-- suspendan, su historial sigue legible).
create policy sellers_publico on public.sellers
  for select to anon using (estado = 'aprobado');

create policy sellers_autenticado on public.sellers
  for select to authenticated using (
    estado = 'aprobado'
    or id = (select privado.seller_id())
    or (select privado.tiene_rol(array['superadmin', 'ops', 'finanzas']))
    or exists (select 1 from public.pedidos p
               where p.seller_id = sellers.id and p.comprador_id = (select auth.uid()))
  );

create policy sellers_kyc_lectura on public.sellers_kyc
  for select to authenticated using (
    (seller_id = (select privado.seller_id()) and (select privado.tiene_rol(array['seller'])))
    or (select privado.tiene_rol(array['superadmin', 'finanzas']))
  );

create policy seller_documentos_lectura on public.seller_documentos
  for select to authenticated using (
    (seller_id = (select privado.seller_id()) and (select privado.tiene_rol(array['seller'])))
    or (select privado.tiene_rol(array['superadmin']))
  );

create policy perfiles_lectura on public.perfiles
  for select to authenticated using (
    id = (select auth.uid()) or (select privado.tiene_rol(array['superadmin']))
  );

-- Productos: la tienda ve lo publicado de sellers aprobados; el comercio ve
-- todo lo suyo; el backoffice, todo.
create policy productos_publico on public.productos
  for select to anon, authenticated using (
    estado = 'publicado'
    and exists (select 1 from public.sellers s where s.id = productos.seller_id and s.estado = 'aprobado')
  );

create policy productos_staff on public.productos
  for select to authenticated using (
    seller_id = (select privado.seller_id())
    or (select privado.tiene_rol(array['superadmin', 'ops', 'finanzas']))
  );

create policy direcciones_propias on public.direcciones
  for all to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

create policy carrito_propio on public.carrito_items
  for all to authenticated
  using (usuario_id = (select auth.uid()))
  with check (
    usuario_id = (select auth.uid())
    and (select privado.rol()) = 'comprador'
    and exists (select 1 from public.productos p where p.sku = carrito_items.sku and p.estado = 'publicado')
  );

create policy pedidos_lectura on public.pedidos
  for select to authenticated using (
    comprador_id = (select auth.uid())
    or (seller_id = (select privado.seller_id()) and (select privado.tiene_rol(array['seller', 'operador'])))
    or (select privado.tiene_rol(array['superadmin', 'ops', 'finanzas']))
  );

-- Las líneas y la línea de tiempo heredan la visibilidad del pedido.
create policy pedido_items_lectura on public.pedido_items
  for select to authenticated using (exists (select 1 from public.pedidos p where p.id = pedido_items.pedido_id));

create policy pedido_eventos_lectura on public.pedido_eventos
  for select to authenticated using (exists (select 1 from public.pedidos p where p.id = pedido_eventos.pedido_id));

create policy disputas_lectura on public.disputas
  for select to authenticated using (
    comprador_id = (select auth.uid())
    or (seller_id = (select privado.seller_id()) and (select privado.tiene_rol(array['seller'])))
    or (select privado.tiene_rol(array['superadmin', 'ops']))
  );

create policy liquidaciones_lectura on public.liquidaciones
  for select to authenticated using (
    (seller_id = (select privado.seller_id()) and (select privado.tiene_rol(array['seller'])))
    or (select privado.tiene_rol(array['superadmin', 'finanzas']))
  );

create policy notificaciones_lectura on public.notificaciones
  for select to authenticated using (
    para = 'usr:' || (select auth.uid())::text
    or para = 'rol:' || (select privado.rol())
    or ((select privado.seller_id()) is not null and para = 'seller:' || (select privado.seller_id()))
  );

create policy notificaciones_leidas_lectura on public.notificaciones_leidas
  for select to authenticated using (usuario_id = (select auth.uid()));

create policy auditoria_lectura on public.auditoria
  for select to authenticated using ((select privado.tiene_rol(array['superadmin', 'finanzas'])));
