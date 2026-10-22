-- =========================================================================
-- Tumbo Market — Semilla de la demo y reinicio
-- -------------------------------------------------------------------------
-- Mismos datos ficticios que assets/js/tm-datos.js. `privado.sembrar()` deja
-- el negocio en su punto de partida; `public.tm_reiniciar_demo()` permite al
-- superadministrador volver a él desde la aplicación.
-- Cuentas demo: contraseña demo1234 (ver README).
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Cuentas demo (idempotente). UUID fijos para que la semilla las referencie.
-- ---------------------------------------------------------------------------
create function privado.sembrar_usuarios() returns void
language plpgsql security definer set search_path = '' as $$
declare
  u record;
begin
  for u in
    select * from (values
      ('a0000000-0000-4000-8000-000000000001'::uuid, 'comprador@demo.ve',            'María González', 'comprador',  null,      false),
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'propietario@sel-014.demo',     'Jorge Rengifo',  'seller',     'SEL-014', true),
      ('a0000000-0000-4000-8000-000000000003'::uuid, 'precios@sel-014.demo',         'Ana Fuentes',    'precios',    'SEL-014', true),
      ('a0000000-0000-4000-8000-000000000004'::uuid, 'operador@sel-014.demo',        'Luis Medina',    'operador',   'SEL-014', false),
      ('a0000000-0000-4000-8000-000000000005'::uuid, 'superadmin@tumbomarket.demo',  'Carla Núñez',    'superadmin', null,      true),
      ('a0000000-0000-4000-8000-000000000006'::uuid, 'operaciones@tumbomarket.demo', 'Pedro Salas',    'ops',        null,      true),
      ('a0000000-0000-4000-8000-000000000007'::uuid, 'finanzas@tumbomarket.demo',    'Rosa Blanco',    'finanzas',   null,      true)
    ) as t (id, email, nombre, rol, seller_id, mfa)
  loop
    if not exists (select 1 from auth.users where id = u.id) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
              extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}'::jsonb,
              jsonb_build_object('nombre', u.nombre), now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), u.id, u.id::text,
              jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
              'email', now(), now(), now());
    end if;
    -- El trigger crea el perfil como comprador; aquí se fija el rol real.
    insert into public.perfiles (id, email, nombre, rol, seller_id, mfa)
    values (u.id, u.email, u.nombre, u.rol, u.seller_id, u.mfa)
    on conflict (id) do update
      set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
          seller_id = excluded.seller_id, mfa = excluded.mfa;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Datos de negocio
-- ---------------------------------------------------------------------------
create function privado.sembrar() returns void
language plpgsql security definer set search_path = '' as $$
declare
  maria constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  insert into public.config (id, tasa, comision_pct, tarifa_fija_usd, ventana_reclamo_dias, ciudad_entrega)
  values (true, 36.20, 10, 0.60, 3, 'Caracas 1010')
  on conflict (id) do update set tasa = excluded.tasa, comision_pct = excluded.comision_pct,
    tarifa_fija_usd = excluded.tarifa_fija_usd, ventana_reclamo_dias = excluded.ventana_reclamo_dias,
    ciudad_entrega = excluded.ciudad_entrega;

  insert into public.categorias (id, nombre, icono, orden) values
    ('automotriz', 'Automotriz', 'directions_car', 1),
    ('tecnologia', 'Tecnología', 'devices', 2),
    ('hogar', 'Hogar', 'kitchen', 3),
    ('salud', 'Salud', 'local_pharmacy', 4),
    ('moda', 'Moda', 'checkroom', 5)
  on conflict (id) do update set nombre = excluded.nombre, icono = excluded.icono, orden = excluded.orden;

  insert into public.sellers (id, nombre, ciudad, estado, rating, resenas, desde, descripcion) values
    ('SEL-014', 'TechElectro, C.A.', 'Caracas', 'aprobado', 4.8, 142, '2026-03-02', 'Repuestos automotrices y tecnología con garantía nacional.'),
    ('SEL-009', 'Hogar Total, C.A.', 'Valencia', 'aprobado', 4.5, 87, '2026-01-15', 'Todo para el hogar: cocina, limpieza y organización.'),
    ('SEL-021', 'Farma Andina, C.A.', 'Mérida', 'en_revision', null, 0, '2026-08-27', 'Productos de salud y cuidado personal.'),
    ('SEL-017', 'Moda Urbana 21, C.A.', 'Maracaibo', 'observado', 4.1, 23, '2026-06-11', 'Ropa y accesorios urbanos.')
  on conflict (id) do update set nombre = excluded.nombre, ciudad = excluded.ciudad, estado = excluded.estado,
    rating = excluded.rating, resenas = excluded.resenas, desde = excluded.desde, descripcion = excluded.descripcion;

  -- Las cuentas del Seller Center referencian a su comercio: van después de los sellers.
  perform privado.sembrar_usuarios();

  insert into public.sellers_kyc (seller_id, rif, observacion) values
    ('SEL-014', 'J-40881234-5', null),
    ('SEL-009', 'J-31220987-1', null),
    ('SEL-021', 'J-50778812-3', null),
    ('SEL-017', 'J-29455610-9', 'El registro mercantil está vencido: se solicitó la renovación.');

  insert into public.seller_documentos (seller_id, orden, nombre, estado)
  select s.id, d.orden, d.nombre,
         case
           when s.id = 'SEL-021' and d.orden = 2 then 'en_revision'
           when s.id = 'SEL-021' and d.orden = 4 then 'pendiente'
           when s.id = 'SEL-017' and d.orden = 2 then 'observado'
           else 'aprobado' end
  from (values ('SEL-014'), ('SEL-009'), ('SEL-021'), ('SEL-017')) s (id)
  cross join (values (1, 'RIF vigente'), (2, 'Registro mercantil'), (3, 'Cédula del representante'), (4, 'Cuenta de liquidación')) d (orden, nombre);

  -- Lo reservado (stock_res) corresponde a los pedidos sembrados aún sin despachar.
  insert into public.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, stock_res, estado, img, rating, resenas, descripcion, specs) values
    ('SKU-MOT-0832', 'SEL-014', 'Caucho Rin 14 · 185/60 R14', 'Bridgestone', 'automotriz', 70, 15, 0, 'publicado', 'producto-01', 4.7, 96,
     'Caucho radial para rin 14, compuesto de larga duración y agarre en pavimento húmedo. Garantía de 5 años contra defectos de fabricación.',
     '{"Medida": "185/60 R14", "Índice de carga": "82H", "Origen": "Nacional", "Garantía": "5 años"}'),
    ('SKU-MOT-0777', 'SEL-014', 'Batería 12V 65Ah libre de mantenimiento', 'Duncan', 'automotriz', 95, 8, 1, 'publicado', 'producto-02', 4.6, 61,
     'Batería sellada de 65 amperios, arranque en frío garantizado. Incluye instalación gratuita en Caracas.',
     '{"Voltaje": "12 V", "Capacidad": "65 Ah", "Polaridad": "Izquierda", "Garantía": "18 meses"}'),
    ('SKU-ELE-1045', 'SEL-014', 'Alternador Bosch 12V 90A', 'Bosch', 'automotriz', 120, 8, 0, 'en_revision', 'producto-03', null, 0,
     'Alternador original Bosch de 90 amperios para vehículos livianos.',
     '{"Amperaje": "90 A", "Voltaje": "12 V", "Condición": "Nuevo"}'),
    ('SKU-MAN-0021', 'SEL-014', 'Filtro de aceite sintético', 'Mann', 'automotriz', 15, 0, 0, 'pausado', 'producto-04', 4.4, 33,
     'Filtro de aceite de alto flujo para motores a gasolina.',
     '{"Rosca": "3/4-16", "Compatibilidad": "Ver tabla del fabricante"}'),
    ('SKU-TEC-0301', 'SEL-014', 'Monitor 24" FHD 75Hz', 'Samsung', 'tecnologia', 140, 12, 0, 'publicado', 'producto-05', 4.8, 210,
     'Monitor Full HD de 24 pulgadas, panel VA, 75 Hz, bordes ultradelgados. Ideal para oficina y estudio.',
     '{"Resolución": "1920×1080", "Tasa": "75 Hz", "Puertos": "HDMI, VGA", "Garantía": "1 año"}'),
    ('SKU-TEC-0450', 'SEL-014', 'Audífonos Bluetooth con estuche', 'Xiaomi', 'tecnologia', 25, 40, 0, 'publicado', 'producto-06', 4.3, 154,
     'Audífonos inalámbricos con cancelación pasiva y 20 horas de autonomía con el estuche.',
     '{"Bluetooth": "5.3", "Autonomía": "20 h", "Carga": "USB-C"}'),
    ('SKU-TEC-0512', 'SEL-014', 'Teclado mecánico retroiluminado', 'Redragon', 'tecnologia', 45, 6, 0, 'borrador', 'producto-01', null, 0,
     'Teclado mecánico switch rojo, retroiluminación RGB, formato 87 teclas.',
     '{"Switch": "Rojo", "Formato": "TKL 87"}'),
    ('SKU-HOG-0110', 'SEL-009', 'Licuadora 600W vaso de vidrio', 'Oster', 'hogar', 55, 18, 0, 'publicado', 'producto-02', 4.5, 78,
     'Licuadora de 600 W con vaso de vidrio de 1,5 L y cuchillas de acero inoxidable.',
     '{"Potencia": "600 W", "Vaso": "Vidrio 1,5 L", "Velocidades": "3 + pulso"}'),
    ('SKU-HOG-0234', 'SEL-009', 'Juego de ollas 7 piezas antiadherente', 'Tramontina', 'hogar', 80, 9, 1, 'publicado', 'producto-03', 4.6, 45,
     'Juego de ollas con recubrimiento antiadherente y tapas de vidrio templado.',
     '{"Piezas": "7", "Material": "Aluminio antiadherente"}');

  insert into public.direcciones (id, usuario_id, nombre, linea, municipio, ciudad, codigo, telefono, predeterminada) values
    ('d0000000-0000-4000-8000-000000000001', maria, 'Casa', 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2', 'Chacao', 'Caracas', '1060', '0412-5550101', true),
    ('d0000000-0000-4000-8000-000000000002', maria, 'Oficina', 'Torre Polar, piso 6, ofic. 6-C, Plaza Venezuela', 'Libertador', 'Caracas', '1050', '0212-7810202', false);

  insert into public.pedidos (id, comprador_id, seller_id, estado, liquidacion, envio_tipo, envio_dir, courier, costo_envio_usd,
                              tasa, metodo, ref, guia, sla_horas, disputa_id, liquidacion_id, creado, entregado_el) values
    ('TM-2026-00415', maria, 'SEL-014', 'cerrado', 'elegible', 'domicilio', 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2, Chacao', 'Zoom (demo)', 3,
     36.20, 'Pago Móvil', 'PM-771204', 'TM-GUIA-88410', null, null, null, '2026-08-21 10:12-04', '2026-08-24 15:40-04'),
    ('TM-2026-00422', maria, 'SEL-009', 'cerrado', 'liquidado', 'agencia', 'Agencia MRW La Candelaria, Caracas', 'MRW (demo)', 2.5,
     36.20, 'Transferencia', 'TRF-90211', 'TM-GUIA-87719', null, null, 'LIQ-2026-008', '2026-08-12 16:20-04', '2026-08-15 11:00-04'),
    ('TM-2026-00428', maria, 'SEL-014', 'entregado', 'congelado', 'domicilio', 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2, Chacao', 'Tealca (demo)', 5,
     36.20, 'Pago Móvil', 'PM-778812', 'TM-GUIA-88602', null, 'DSP-0098', null, '2026-08-24 09:45-04', '2026-08-27 14:15-04'),
    ('TM-2026-00431', maria, 'SEL-014', 'despachado', null, 'domicilio', 'Torre Polar, piso 6, ofic. 6-C, Plaza Venezuela, Libertador', 'Zoom (demo)', 4,
     36.20, 'Pago Móvil', 'PM-779955', 'TM-GUIA-88710', null, null, null, '2026-08-27 11:20-04', null),
    ('TM-2026-00433', maria, 'SEL-009', 'pago_por_verificar', null, 'agencia', 'Agencia Tealca Sabana Grande, Caracas', 'Tealca (demo)', 2.5,
     36.20, 'Transferencia', 'TRF-91108', null, null, null, null, '2026-08-28 17:35-04', null),
    ('TM-2026-00434', maria, 'SEL-014', 'por_aceptar', null, 'domicilio', 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2, Chacao', 'Zoom (demo)', 4,
     36.20, 'Pago Móvil', 'PM-780331', null, 24, null, null, '2026-08-28 19:58-04', null);

  insert into public.pedido_items (pedido_id, sku, nombre, img, cant, precio_usd) values
    ('TM-2026-00415', 'SKU-TEC-0450', 'Audífonos Bluetooth con estuche', 'producto-06', 1, 25),
    ('TM-2026-00422', 'SKU-HOG-0110', 'Licuadora 600W vaso de vidrio', 'producto-02', 1, 55),
    ('TM-2026-00428', 'SKU-MOT-0832', 'Caucho Rin 14 · 185/60 R14', 'producto-01', 2, 70),
    ('TM-2026-00431', 'SKU-TEC-0301', 'Monitor 24" FHD 75Hz', 'producto-05', 1, 140),
    ('TM-2026-00433', 'SKU-HOG-0234', 'Juego de ollas 7 piezas antiadherente', 'producto-03', 1, 80),
    ('TM-2026-00434', 'SKU-MOT-0777', 'Batería 12V 65Ah libre de mantenimiento', 'producto-02', 1, 95);

  insert into public.pedido_eventos (pedido_id, fecha, actor, texto, icono) values
    ('TM-2026-00415', '2026-08-21 10:12-04', 'María González', 'Pedido creado y pago registrado (Pago Móvil ref. PM-771204)', 'shopping_cart'),
    ('TM-2026-00415', '2026-08-21 11:05-04', 'Finanzas', 'Pago conciliado', 'fact_check'),
    ('TM-2026-00415', '2026-08-21 14:30-04', 'SEL-014', 'Pedido aceptado, preparación iniciada', 'inventory_2'),
    ('TM-2026-00415', '2026-08-22 09:15-04', 'SEL-014', 'Paquete listo · guía TM-GUIA-88410', 'package_2'),
    ('TM-2026-00415', '2026-08-22 13:10-04', 'Courier', 'Paquete retirado por Zoom (demo)', 'local_shipping'),
    ('TM-2026-00415', '2026-08-24 15:40-04', 'María González', 'Entrega confirmada', 'check_circle'),
    ('TM-2026-00415', '2026-08-27 15:40-04', 'Sistema', 'Ventana de reclamo cerrada sin casos · fondos elegibles', 'lock_open'),
    ('TM-2026-00422', '2026-08-12 16:20-04', 'María González', 'Pedido creado y pago registrado (transferencia ref. TRF-90211)', 'shopping_cart'),
    ('TM-2026-00422', '2026-08-15 11:00-04', 'María González', 'Entrega confirmada en agencia', 'check_circle'),
    ('TM-2026-00422', '2026-08-20 09:00-04', 'Finanzas', 'Incluido en la liquidación LIQ-2026-008', 'receipt_long'),
    ('TM-2026-00428', '2026-08-24 09:45-04', 'María González', 'Pedido creado y pago registrado (Pago Móvil ref. PM-778812)', 'shopping_cart'),
    ('TM-2026-00428', '2026-08-24 10:30-04', 'Finanzas', 'Pago conciliado', 'fact_check'),
    ('TM-2026-00428', '2026-08-24 14:00-04', 'SEL-014', 'Pedido aceptado, preparación iniciada', 'inventory_2'),
    ('TM-2026-00428', '2026-08-25 08:40-04', 'SEL-014', 'Paquete listo · guía TM-GUIA-88602', 'package_2'),
    ('TM-2026-00428', '2026-08-25 12:05-04', 'Courier', 'Paquete retirado por Tealca (demo)', 'local_shipping'),
    ('TM-2026-00428', '2026-08-27 14:15-04', 'María González', 'Entrega confirmada', 'check_circle'),
    ('TM-2026-00428', '2026-08-27 18:20-04', 'María González', 'Reclamo DSP-0098 abierto · liquidación congelada', 'gavel'),
    ('TM-2026-00431', '2026-08-27 11:20-04', 'María González', 'Pedido creado y pago registrado (Pago Móvil ref. PM-779955)', 'shopping_cart'),
    ('TM-2026-00431', '2026-08-27 12:00-04', 'Finanzas', 'Pago conciliado', 'fact_check'),
    ('TM-2026-00431', '2026-08-27 15:10-04', 'SEL-014', 'Pedido aceptado, preparación iniciada', 'inventory_2'),
    ('TM-2026-00431', '2026-08-28 09:30-04', 'SEL-014', 'Paquete listo · guía TM-GUIA-88710', 'package_2'),
    ('TM-2026-00431', '2026-08-28 11:45-04', 'Courier', 'Paquete retirado por Zoom (demo) · en tránsito', 'local_shipping'),
    ('TM-2026-00433', '2026-08-28 17:35-04', 'María González', 'Pedido creado y pago registrado (transferencia ref. TRF-91108)', 'shopping_cart'),
    ('TM-2026-00434', '2026-08-28 19:58-04', 'María González', 'Pedido creado y pago registrado (Pago Móvil ref. PM-780331)', 'shopping_cart'),
    ('TM-2026-00434', '2026-08-28 20:15-04', 'Finanzas', 'Pago conciliado · pendiente de aceptación del seller', 'fact_check');

  insert into public.disputas (id, pedido_id, comprador_id, seller_id, motivo, descripcion, evidencia, monto_usd, estado, creado) values
    ('DSP-0098', 'TM-2026-00428', maria, 'SEL-014', 'Producto dañado',
     'Uno de los dos cauchos llegó con una deformación visible en el talón. Adjunto fotos y el video de la apertura del paquete.',
     array['foto-talon-1.jpg', 'foto-talon-2.jpg', 'video-apertura.mp4'], 70, 'abierta', '2026-08-27 18:20-04');

  insert into public.liquidaciones (id, seller_id, periodo, pedidos, bruto_usd, comision_usd, tarifa_usd, neto_usd, estado, fecha, comprobante) values
    ('LIQ-2026-008', 'SEL-009', '01/08/2026 – 15/08/2026', array['TM-2026-00422'], 55, 5.5, 0.6, 48.9, 'pagada', '2026-08-20', 'CPR-2026-008');

  insert into public.notificaciones (para, texto, icono, fecha, enlace) values
    ('seller:SEL-014', 'Nuevo pedido TM-2026-00434 pendiente de aceptar', 'shopping_cart', '2026-08-28 20:15-04', 'seller/pedidos.html'),
    ('seller:SEL-014', 'Reclamo DSP-0098 abierto sobre TM-2026-00428: responde con tu evidencia', 'gavel', '2026-08-27 18:20-04', 'seller/disputas.html'),
    ('rol:ops', 'Disputa DSP-0098 en cola: producto dañado, Bs. 2.534,00', 'gavel', '2026-08-27 18:20-04', 'admin/disputas.html'),
    ('rol:finanzas', 'Pago TRF-91108 pendiente de conciliar (TM-2026-00433)', 'fact_check', '2026-08-28 17:35-04', 'admin/conciliacion.html'),
    ('rol:superadmin', 'Seller SEL-021 (Farma Andina) espera revisión KYC', 'verified_user', '2026-08-27 09:00-04', 'admin/sellers.html'),
    ('usr:' || maria::text, 'Tu pedido TM-2026-00431 va en camino', 'local_shipping', '2026-08-28 11:45-04', 'tienda/pedido.html?id=TM-2026-00431');

  insert into public.auditoria (fecha, actor, accion, detalle) values
    ('2026-08-20 09:00-04', 'Rosa Blanco', 'Liquidación ejecutada', 'LIQ-2026-008 → SEL-009 · $48.90'),
    ('2026-08-27 18:20-04', 'Sistema', 'Congelación de liquidación', 'TM-2026-00428 por DSP-0098'),
    ('2026-08-27 18:20-04', 'María González', 'Apertura de disputa', 'DSP-0098 sobre TM-2026-00428'),
    ('2026-08-28 20:15-04', 'Rosa Blanco', 'Conciliación de pago', 'PM-780331 → TM-2026-00434');

  -- Los identificadores nuevos continúan donde termina la semilla.
  perform setval('privado.seq_pedido', 434);
  perform setval('privado.seq_disputa', 98);
  perform setval('privado.seq_liquidacion', 8);
  perform setval('privado.seq_guia', 88710);
  perform setval('privado.seq_sku', 1100);
end $$;

-- ---------------------------------------------------------------------------
-- Reinicio desde la aplicación (solo superadministrador)
-- ---------------------------------------------------------------------------
create function public.tm_reiniciar_demo() returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo public.perfiles := privado.exigir(array['superadmin']);
begin
  truncate public.notificaciones_leidas, public.notificaciones, public.auditoria, public.liquidaciones,
           public.disputas, public.pedido_eventos, public.pedido_items, public.pedidos,
           public.carrito_items, public.direcciones restart identity;
  delete from public.productos;
  delete from public.seller_documentos;
  delete from public.sellers_kyc;
  perform privado.sembrar();
  insert into public.auditoria (actor_id, actor, accion, detalle)
  values (yo.id, yo.nombre, 'Demo reiniciada', 'Datos de negocio restaurados a la semilla');
end $$;

revoke execute on function public.tm_reiniciar_demo() from public, anon;
grant execute on function public.tm_reiniciar_demo() to authenticated;
revoke execute on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol(), privado.seller_id(), privado.tiene_rol(text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tiempo real: los cambios llegan a las pantallas abiertas (RLS incluida).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.pedidos, public.productos, public.disputas, public.liquidaciones,
      public.notificaciones, public.sellers;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Carga inicial
-- ---------------------------------------------------------------------------
select privado.sembrar();
