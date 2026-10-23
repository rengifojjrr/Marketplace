-- =========================================================================
-- Tumbo Market — Ola 1: pagos y finanzas
-- -------------------------------------------------------------------------
-- (ver docs/dominios/pagos.md y docs/PLAN-PRODUCCION.md)
--   · La entidad «pago»: un checkout = un pago que agrupa los pedidos de
--     varios sellers (método, moneda, montos en USD y Bs., tasa, referencia,
--     datos del pagador, comprobante, estado y vencimiento). Conciliar y
--     rechazar operan sobre el pago y sus pedidos.
--   · Checkout calculado en el servidor (envío por seller con
--     cotizar_envio, promociones con aplicar_promociones, IVA incluido, IGTF
--     en divisas, crédito en Tumbo) que rechaza si el total difiere del que
--     vio el comprador; métodos de pago configurables; pago guiado con
--     reporte y corrección; vencimiento a las 48 h (domingo → lunes 12:00) y
--     pago recibido tarde.
--   · Tasa BCV con historial (automática con pg_net si existe; manual con
--     doble aprobación), conciliación con el estado de cuenta del banco y
--     cola de excepciones, reembolsos con destino y aprobación por monto,
--     cuentas de liquidación verificadas, liquidaciones con ciclo
--     (preparada → aprobada → pagada / fallida), libro mayor de doble
--     partida con cierre diario, panel financiero, estados de cuenta,
--     recibos no fiscales y libro de ventas.
-- Solo agrega: no borra ni reescribe datos ni objetos existentes. Las tablas
-- nuevas no tienen claves foráneas hacia las que vacía el reinicio de la
-- demo (pedidos, reembolsos, liquidaciones…): su limpieza va en
-- tumbo_privado.sembrar_ext_pagos.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Ajustes del dominio (los cambia el superadministrador con sesión elevada)
-- ---------------------------------------------------------------------------
insert into tumbo.ajustes (clave, valor, tipo, vaciable, publico, descripcion) values
  ('impuestos', '{"iva_pct": 16, "igtf_pct": 3, "categorias_exentas": []}', 'object', false, true,
   'IVA incluido en el precio de los productos (salvo los exentos) e IGTF de los pagos en divisas, en %.'),
  ('conciliacion', '{"tolerancia_bs": 1, "dias": 3, "digitos_sufijo": 6, "filas_dia_usuario": 5000, "filas_dia_total": 20000}', 'object', false, false,
   'Cruce con el estado de cuenta: tolerancia del monto en Bs., días de margen alrededor de la fecha del pago, dígitos mínimos para aceptar una referencia que el banco recorta y tope de movimientos nuevos por persona y en total cada 24 horas.'),
  ('reembolsos', '{"umbral_doble_usd": 200}', 'object', false, false,
   'Reembolsos: desde este monto (USD) los aprueban dos personas distintas con sesión elevada (los de dinero que llegó de más o sin venta, siempre).'),
  ('tasa_bcv', '{"url": "https://ve.dolarapi.com/v1/dolares/oficial", "horas_alerta": 24, "variacion_max_pct": 15}', 'object', false, false,
   'Fuente pública de la tasa oficial (BCV), horas sin actualizarse antes de avisar a Finanzas y variación máxima (%) que se aplica sola: una mayor queda propuesta para que una persona la confirme.'),
  ('liquidaciones', '{"envio_al_seller": true}', 'object', false, false,
   'Regla de liquidación: el seller paga la guía y recibe el envío cobrado al comprador.')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
create sequence tumbo_privado.seq_pago start 1;
revoke all on sequence tumbo_privado.seq_pago from public, anon, authenticated;

-- Bancos de Venezuela (código SUDEBAN de 4 dígitos): para validar el banco
-- emisor de un pago, el destino de un reembolso y las cuentas de liquidación.
create table tumbo.bancos (
  codigo text primary key check (codigo ~ '^[0-9]{4}$'),
  nombre text not null
);
insert into tumbo.bancos (codigo, nombre) values
  ('0102', 'Banco de Venezuela'), ('0104', 'Venezolano de Crédito'), ('0105', 'Mercantil'),
  ('0108', 'Provincial (BBVA)'), ('0114', 'Bancaribe'), ('0115', 'Banco Exterior'), ('0128', 'Banco Caroní'),
  ('0134', 'Banesco'), ('0137', 'Sofitasa'), ('0138', 'Banco Plaza'), ('0151', 'BFC Banco Fondo Común'),
  ('0156', '100% Banco'), ('0157', 'DelSur'), ('0163', 'Banco del Tesoro'), ('0166', 'Banco Agrícola de Venezuela'),
  ('0168', 'Bancrecer'), ('0169', 'R4 Banco Microfinanciero'), ('0171', 'Banco Activo'), ('0172', 'Bancamiga'),
  ('0174', 'Banplus'), ('0175', 'Banco Digital de los Trabajadores'), ('0177', 'Banfanb'), ('0191', 'Banco Nacional de Crédito (BNC)')
on conflict (codigo) do nothing;

-- Métodos de pago. El nombre coincide con pedidos.metodo y con la clave de
-- los datos del beneficiario en el ajuste pagos_beneficiario. `campos`: lo
-- que reporta quien paga. «crédito» es interno: el saldo del comprador en
-- Tumbo cuando cubre todo el pedido.
create table tumbo.metodos_pago (
  id             text primary key check (id ~ '^[a-z_]{2,30}$'),
  nombre         text not null unique,
  moneda         text not null check (moneda in ('VES', 'USD', 'USDT')),
  activo         boolean not null default true,
  igtf           boolean not null default false,
  contra_entrega boolean not null default false,
  interno        boolean not null default false,
  orden          integer not null default 0,
  instrucciones  text not null default '' check (char_length(instrucciones) <= 1000),
  campos         text[] not null default '{}',
  actualizado    timestamptz not null default now(),
  por            text
);
insert into tumbo.metodos_pago (id, nombre, moneda, activo, igtf, contra_entrega, interno, orden, instrucciones, campos) values
  ('pago_movil', 'Pago Móvil', 'VES', true, false, false, false, 1,
   'Haz el Pago Móvil desde la app de tu banco por el monto exacto en bolívares y reporta la referencia, el banco y el teléfono desde el que pagaste.',
   array['banco', 'telefono', 'cedula', 'referencia', 'fecha']),
  ('transferencia', 'Transferencia', 'VES', true, false, false, false, 2,
   'Transfiere el monto exacto en bolívares a la cuenta indicada y reporta la referencia, el banco emisor y la cédula o RIF del titular.',
   array['banco', 'cedula', 'referencia', 'fecha']),
  ('zelle', 'Zelle', 'USD', true, true, false, false, 3,
   'Envía el monto exacto en dólares por Zelle (incluye el IGTF) y reporta el código de confirmación, el correo y el titular de la cuenta.',
   array['correo', 'titular', 'referencia', 'fecha']),
  ('usdt', 'USDT (Binance Pay)', 'USDT', true, true, false, false, 4,
   'Paga el monto exacto en USDT con Binance Pay (o a la dirección indicada) y reporta el ID de la orden o el hash de la transacción.',
   array['referencia', 'fecha']),
  ('efectivo', 'Efectivo en divisas', 'USD', false, true, true, false, 5,
   'Pagas en efectivo, en dólares, al recibir el pedido. Pendiente: necesita el convenio de cobro contra entrega con el courier; mientras tanto está desactivado.',
   array[]::text[]),
  ('credito', 'Crédito en Tumbo', 'USD', true, false, false, true, 9,
   'Saldo a tu favor en Tumbo (de reembolsos).', array[]::text[])
on conflict (id) do nothing;

-- El pago: un checkout. Los montos son los del momento de crearlo; lo que
-- falta por pagar se calcula con los pedidos que siguen vivos
-- (tumbo_privado.pago_esperado).
create table tumbo.pagos (
  id             text primary key,
  comprador_id   uuid not null references tumbo.usuarios (id),
  metodo         text not null references tumbo.metodos_pago (id),
  moneda         text not null check (moneda in ('VES', 'USD', 'USDT')),
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente', 'reportado', 'verificado', 'rechazado', 'vencido', 'cancelado')),
  subtotal_usd   numeric(12,2) not null default 0,
  descuento_usd  numeric(12,2) not null default 0,
  envio_usd      numeric(12,2) not null default 0,
  iva_usd        numeric(12,2) not null default 0,
  igtf_usd       numeric(12,2) not null default 0,
  credito_usd    numeric(12,2) not null default 0,
  total_usd      numeric(12,2) not null default 0,
  tasa           numeric(12,4) not null check (tasa > 0),
  total_bs       numeric(14,2) not null default 0,
  referencia     text check (referencia is null or char_length(referencia) <= 100),
  ref_clave      text,
  pagador        jsonb not null default '{}'::jsonb,
  comprobante    uuid,
  fecha_pago     date,
  fiscal         jsonb,
  cupon          text,
  contra_entrega boolean not null default false,
  correcciones   integer not null default 0 check (correcciones between 0 and 2),
  reportes       integer not null default 0,
  observacion    text,
  vence          timestamptz,
  avisado        timestamptz,
  tardio         boolean not null default false,
  movimiento_id  bigint,
  red            text,
  creado         timestamptz not null default now(),
  reportado_el   timestamptz,
  verificado_el  timestamptz,
  verificado_por text
);
create index pagos_comprador_idx on tumbo.pagos (comprador_id, creado desc);
create index pagos_estado_idx on tumbo.pagos (estado, vence);
create index pagos_red_idx on tumbo.pagos (comprador_id, red, creado);
-- Una referencia (por su número, código o hash) corresponde a un solo pago
-- reportado o verificado.
create unique index pagos_ref_clave_idx on tumbo.pagos (ref_clave) where estado in ('reportado', 'verificado') and ref_clave is not null;
create index pagos_ref_buscar_idx on tumbo.pagos (ref_clave);

create table tumbo.pago_eventos (
  id      bigint generated always as identity primary key,
  pago_id text not null references tumbo.pagos (id),
  fecha   timestamptz not null default now(),
  actor   text not null,
  texto   text not null,
  icono   text not null default 'info',
  interno boolean not null default false              -- solo lo ve Finanzas
);
create index pago_eventos_pago_idx on tumbo.pago_eventos (pago_id, id);

-- El pedido guarda lo que se le cobró al venderse: su pago, descuentos,
-- IVA incluido, IGTF, crédito aplicado, el total en Bs. con su tasa, la
-- comisión y la tarifa vigentes y el plazo de envío cotizado. (destino ya
-- existe desde la ola 0.) Los datos fiscales del comprador quedan en su
-- pago (tumbo.pagos.fiscal), que solo leen las funciones de este dominio:
-- la lectura general (tm_cargar) entrega el pedido completo.
alter table tumbo.pedidos
  add column pago_id             text references tumbo.pagos (id),
  add column descuento_usd       numeric(12,2) not null default 0,
  add column descuento_tumbo_usd numeric(12,2) not null default 0,
  add column iva_usd             numeric(12,2) not null default 0,
  add column igtf_usd            numeric(12,2) not null default 0,
  add column credito_usd         numeric(12,2) not null default 0,
  add column exento_usd          numeric(12,2) not null default 0,
  add column monto_bs            numeric(14,2),
  add column comision_pct        numeric(5,2),
  add column tarifa_usd          numeric(10,2),
  add column envio_dias          text,
  add column vencido_el          timestamptz,
  add column cancelado_el        timestamptz;
create index pedidos_pago_idx on tumbo.pedidos (pago_id);

-- Reembolsos: a quién y por dónde, con su doble aprobación y su envío.
-- tipo: 'pedido' (lo pagado por un pedido, con tope), 'excedente' (dinero
-- que llegó de más en un pago verificado) o 'sin_venta' (dinero que llegó
-- por un pago que no se cumplió: tarde, rechazado, parcial o repetido).
-- destino guarda solo un resumen (tipo, banco y los datos enmascarados): la
-- lectura de reembolsos de la ola 0 lo entrega completo a Finanzas.
alter table tumbo.reembolsos
  add column tipo           text not null default 'pedido' check (tipo in ('pedido', 'excedente', 'sin_venta')),
  add column pago_id        text,
  add column comprador_id   uuid,
  add column requiere_doble boolean not null default false,
  add column moneda_envio   text check (moneda_envio is null or moneda_envio in ('VES', 'USD', 'CREDITO')),
  add column tasa_envio     numeric(12,4),
  add column monto_enviado  numeric(14,2),
  add column error          text,
  add column enviado_el     timestamptz;
create index reembolsos_comprador_idx on tumbo.reembolsos (comprador_id, creado desc);

-- El destino completo de cada reembolso (teléfono, cédula, correo y titular):
-- solo lo leen las funciones de este dominio, con la privacidad de la demo.
create table tumbo.reembolso_destinos (
  reembolso_id bigint primary key,
  datos        jsonb not null,
  actualizado  timestamptz not null default now()
);

-- Quién hizo qué con cada reembolso (no lo ve el comprador).
create table tumbo.reembolso_eventos (
  id           bigint generated always as identity primary key,
  reembolso_id bigint not null,
  usuario_id   uuid,
  actor        text not null,
  accion       text not null,
  nota         text,
  fecha        timestamptz not null default now()
);
create index reembolso_eventos_idx on tumbo.reembolso_eventos (reembolso_id, id);

-- Crédito en Tumbo del comprador (movimientos: + reembolso, − compra,
-- + devolución de lo usado en un pedido cuyo pago no se cumplió).
-- pedido_uso: el pedido que usó (−) o al que se le devolvió (+) ese crédito;
-- la suma por pedido es lo que ese pedido tiene usado ahora.
create table tumbo.creditos (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references tumbo.usuarios (id),
  monto_usd  numeric(12,2) not null check (monto_usd <> 0),
  motivo     text not null,
  referencia text,
  pedido_uso text,
  creado     timestamptz not null default now()
);
create index creditos_usuario_idx on tumbo.creditos (usuario_id, id);
create index creditos_pedido_idx on tumbo.creditos (pedido_uso) where pedido_uso is not null;

-- Tasa oficial con historial. Las automáticas se aplican al llegar si son
-- de la fecha vigente o posterior y no se alejan más de lo configurado; si
-- se alejan quedan «propuesta» hasta que una persona las confirma. Las
-- manuales son «propuesta» hasta que otra persona las confirma.
create table tumbo.tasas (
  id                   bigint generated always as identity primary key,
  fecha                date not null,
  valor                numeric(14,4) not null check (valor > 0 and valor < 10000000),
  fuente               text not null,
  automatica           boolean not null default false,
  estado               text not null default 'aplicada' check (estado in ('propuesta', 'aplicada', 'descartada')),
  propuesta_por        uuid,
  propuesta_por_nombre text,
  aprobada_por         uuid,
  aprobada_por_nombre  text,
  nota                 text,
  creado               timestamptz not null default now(),
  aplicada_el          timestamptz,
  ultima_consulta      timestamptz
);
create index tasas_estado_idx on tumbo.tasas (estado, id desc);

-- Solicitudes a la fuente pública (pg_net) y alertas ya enviadas.
create table tumbo.tasa_solicitudes (
  id        bigint generated always as identity primary key,
  solicitud bigint,
  fuente    text not null default '',
  creado    timestamptz not null default now(),
  procesado timestamptz,
  resultado text
);
create table tumbo.alertas_finanzas (
  clave  text primary key,
  ultima timestamptz not null default now()
);

-- Estados de cuenta del banco: formato de cada exportación (configurable),
-- importaciones y movimientos (sin duplicar).
create table tumbo.bancos_formatos (
  banco         text primary key check (banco ~ '^[a-z]{2,30}$'),
  nombre        text not null,
  formato       jsonb not null,
  actualizado   timestamptz not null default now(),
  por           text
);
insert into tumbo.bancos_formatos (banco, nombre, formato) values
  ('banesco', 'Banesco', '{"separador": ";", "decimal": ",", "fecha": "DD/MM/YYYY", "saltar": 0,
     "columnas": {"fecha": ["fecha"], "referencia": ["referencia", "ref"], "descripcion": ["descripcion", "concepto"],
                  "monto": ["monto", "importe"], "credito": ["credito", "abono", "haber"], "debito": ["debito", "cargo", "debe"]}}'),
  ('mercantil', 'Mercantil', '{"separador": ";", "decimal": ",", "fecha": "DD/MM/YYYY", "saltar": 0,
     "columnas": {"fecha": ["fecha", "fecha valor"], "referencia": ["referencia", "numero de referencia"], "descripcion": ["descripcion", "concepto"],
                  "monto": ["monto"], "credito": ["credito", "abono"], "debito": ["debito", "cargo"]}}'),
  ('provincial', 'Provincial (BBVA)', '{"separador": ";", "decimal": ",", "fecha": "DD/MM/YYYY", "saltar": 0,
     "columnas": {"fecha": ["fecha", "f. valor", "fecha operacion"], "referencia": ["referencia", "numero"], "descripcion": ["concepto", "descripcion"],
                  "monto": ["importe", "monto"], "credito": ["abono", "credito"], "debito": ["cargo", "debito"]}}'),
  ('bdv', 'Banco de Venezuela', '{"separador": ",", "decimal": ".", "fecha": "DD/MM/YYYY", "saltar": 0,
     "columnas": {"fecha": ["fecha"], "referencia": ["referencia"], "descripcion": ["descripcion", "concepto"],
                  "monto": ["monto"], "credito": ["credito", "abono"], "debito": ["debito", "cargo"]}}'),
  ('bancamiga', 'Bancamiga', '{"separador": ",", "decimal": ".", "fecha": "YYYY-MM-DD", "saltar": 0,
     "columnas": {"fecha": ["fecha"], "referencia": ["referencia", "nro. referencia"], "descripcion": ["descripcion", "concepto"],
                  "monto": ["monto"], "credito": ["credito", "abono"], "debito": ["debito", "cargo"]}}')
on conflict (banco) do nothing;

create table tumbo.importaciones_banco (
  id         bigint generated always as identity primary key,
  banco      text not null references tumbo.bancos_formatos (banco),
  archivo    text not null default '',
  filas      integer not null default 0,
  nuevas     integer not null default 0,
  repetidas  integer not null default 0,
  conciliadas integer not null default 0,
  excepciones integer not null default 0,
  por_id     uuid,
  por        text not null,
  creado     timestamptz not null default now()
);

create table tumbo.movimientos_banco (
  id            bigint generated always as identity primary key,
  importacion_id bigint not null references tumbo.importaciones_banco (id),
  banco         text not null,
  fecha         date not null,
  referencia    text not null default '',
  ref_numero    text not null default '',
  monto         numeric(14,2) not null,
  descripcion   text not null default '',
  huella        text not null,
  estado        text not null default 'nuevo' check (estado in ('nuevo', 'conciliado', 'excepcion', 'ignorado', 'reembolsado')),
  excepcion     text check (excepcion is null or excepcion in
                  ('monto_distinto', 'duplicado', 'no_identificado', 'pago_parcial', 'fuera_de_fecha', 'pago_vencido')),
  pago_id       text,
  nota          text,
  resuelto_por  text,
  resuelto_el   timestamptz,
  creado        timestamptz not null default now(),
  unique (banco, huella)
);
create index movimientos_banco_estado_idx on tumbo.movimientos_banco (estado, id desc);
create index movimientos_banco_ref_idx on tumbo.movimientos_banco (ref_numero);

-- Cuentas de liquidación de los sellers (verificadas por Finanzas: el
-- titular debe ser el RIF del comercio). Un cambio rige 48 h después y el
-- seller lo puede anular mientras no rija. ficticia: las de la semilla de
-- la demo (las únicas que las cuentas de prueba ven completas).
create table tumbo.cuentas_liquidacion (
  id           bigint generated always as identity primary key,
  seller_id    text not null references tumbo.sellers (id),
  tipo         text not null check (tipo in ('cuenta', 'pago_movil')),
  banco        text not null references tumbo.bancos (codigo),
  titular      text not null check (char_length(titular) between 3 and 120),
  rif          text not null check (rif ~ '^[VEJPG]-[0-9]{5,9}(-[0-9])?$'),
  numero       text check (numero is null or numero ~ '^[0-9]{20}$'),
  tipo_cuenta  text check (tipo_cuenta is null or tipo_cuenta in ('corriente', 'ahorro')),
  telefono     text check (telefono is null or telefono ~ '^04[0-9]{9}$'),
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'verificada', 'rechazada', 'reemplazada', 'anulada')),
  vigente_desde timestamptz,
  motivo       text,
  ficticia     boolean not null default false,
  creado       timestamptz not null default now(),
  creado_por   text not null,
  creado_por_id uuid,
  verificada_por text,
  verificada_el timestamptz,
  check ((tipo = 'cuenta' and numero is not null and tipo_cuenta is not null) or (tipo = 'pago_movil' and telefono is not null))
);
create index cuentas_liquidacion_seller_idx on tumbo.cuentas_liquidacion (seller_id, id desc);

-- Liquidaciones: ciclo de vida, envío y ajustes incluidos, cuenta usada,
-- tasa del día de pago y diferencial cambiario. «estado» sigue diciendo
-- pagada/pendiente (las de antes de la ola 1 no tienen ciclo: pagadas).
alter table tumbo.liquidaciones
  add column ciclo               text check (ciclo is null or ciclo in ('preparada', 'aprobada', 'pagada', 'fallida', 'anulada')),
  add column envio_usd           numeric(12,2) not null default 0,
  add column ajustes_usd         numeric(12,2) not null default 0,
  add column ajuste_ids          bigint[] not null default '{}',
  add column tasa_pago           numeric(12,4),
  add column neto_bs             numeric(14,2),
  add column diferencial_bs      numeric(14,2),
  add column referencia_pago     text,
  add column comprobante_archivo uuid,
  add column cuenta              jsonb,
  add column motivo              text,
  add column preparada_el        timestamptz,
  add column aprobada_el         timestamptz,
  add column pagada_el           timestamptz;

-- Quién preparó, aprobó, pagó o anuló cada corrida (no lo ve el seller).
create table tumbo.liquidacion_eventos (
  id             bigint generated always as identity primary key,
  liquidacion_id text not null,
  usuario_id     uuid,
  actor          text not null,
  accion         text not null,
  nota           text,
  fecha          timestamptz not null default now()
);
create index liquidacion_eventos_idx on tumbo.liquidacion_eventos (liquidacion_id, id);

-- Ajustes manuales al saldo de un seller (con motivo); entran en su
-- siguiente corrida.
create table tumbo.ajustes_seller (
  id             bigint generated always as identity primary key,
  seller_id      text not null references tumbo.sellers (id),
  monto_usd      numeric(12,2) not null check (monto_usd <> 0 and abs(monto_usd) <= 100000),
  motivo         text not null check (char_length(motivo) between 5 and 300),
  liquidacion_id text,
  por_id         uuid,
  por            text not null,
  creado         timestamptz not null default now()
);
create index ajustes_seller_idx on tumbo.ajustes_seller (seller_id) where liquidacion_id is null;

-- Retenciones manuales de fondos (además de la automática por estado del
-- comercio).
create table tumbo.retenciones (
  seller_id text primary key references tumbo.sellers (id),
  motivo    text not null,
  desde     timestamptz not null default now(),
  por       text not null
);

-- Libro mayor de doble partida (USD de referencia): un asiento por evento
-- de dinero, con líneas que cuadran. Solo se agrega (el reinicio de la demo
-- lo vacía desde sembrar_ext_pagos).
create table tumbo.asientos (
  id          bigint generated always as identity primary key,
  fecha       timestamptz not null default now(),
  evento      text not null check (evento in ('pago_verificado', 'envio', 'comision', 'reembolso', 'reembolso_enviado',
                                              'liquidacion', 'ajuste', 'diferencial')),
  referencia  text not null,
  descripcion text not null default '',
  actor       text not null default 'Sistema'
);
create index asientos_fecha_idx on tumbo.asientos (fecha, id);
create index asientos_ref_idx on tumbo.asientos (referencia);

create table tumbo.asiento_lineas (
  id         bigint generated always as identity primary key,
  asiento_id bigint not null references tumbo.asientos (id),
  cuenta     text not null,
  seller_id  text,
  debe       numeric(14,2) not null default 0 check (debe >= 0),
  haber      numeric(14,2) not null default 0 check (haber >= 0),
  check (debe = 0 or haber = 0)
);
create index asiento_lineas_asiento_idx on tumbo.asiento_lineas (asiento_id);
create index asiento_lineas_cuenta_idx on tumbo.asiento_lineas (cuenta, seller_id);

create table tumbo.cierres (
  fecha       date primary key,
  asientos    integer not null,
  debe        numeric(16,2) not null,
  haber       numeric(16,2) not null,
  descuadrados integer not null default 0,
  cuadra      boolean not null,
  detalle     jsonb not null default '{}'::jsonb,
  creado      timestamptz not null default now()
);

create function tumbo_privado.libro_inmutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('tumbo.reinicio_libro', true), '') = 'si' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'El libro mayor solo admite asientos nuevos: un error se corrige con otro asiento.';
end $$;

create trigger asientos_inmutables before update or delete on tumbo.asientos
  for each row execute function tumbo_privado.libro_inmutable();
create trigger asiento_lineas_inmutables before update or delete on tumbo.asiento_lineas
  for each row execute function tumbo_privado.libro_inmutable();

-- Defensa en profundidad: RLS activo y sin políticas en las tablas nuevas.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'tumbo' loop
    execute format('alter table tumbo.%I enable row level security', t.tablename);
    execute format('revoke all on tumbo.%I from public, anon, authenticated', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
-- «Bs. 1.234,56»
create function tumbo_privado.fmt_bs(p numeric) returns text
language sql immutable set search_path = '' as $$
  select 'Bs. ' || translate(to_char(coalesce(p, 0), 'FM999,999,999,990.00'), ',.', '.,')
$$;

-- «21/10/2026 03:15 pm» (hora de Caracas)
create function tumbo_privado.fecha_caracas(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select case when p is null then '' else to_char(p at time zone 'America/Caracas', 'DD/MM/YYYY HH12:MI am') end
$$;

create function tumbo_privado.hoy_caracas() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Caracas')::date
$$;

create function tumbo_privado.uuid_texto(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p::uuid;
end $$;

-- Un número de un jsonb (texto o número) o null si no lo es.
create function tumbo_privado.num_json(p jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' then (p #>> '{}')::numeric end
$$;

-- Vencimiento de un pago: 48 horas; si cae en domingo (hora de Caracas),
-- pasa al lunes a las 12:00.
create function tumbo_privado.vencimiento_pago(p_desde timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select case when extract(isodow from (p_desde + interval '48 hours') at time zone 'America/Caracas') = 7
              then ((((p_desde + interval '48 hours') at time zone 'America/Caracas')::date + 1) + time '12:00') at time zone 'America/Caracas'
              else p_desde + interval '48 hours' end
$$;

-- Valida la referencia según el método: {ref, clave, numero} o {error}.
--   · bancos (Pago Móvil, transferencia): las reglas y los mensajes de
--     siempre; el pago se identifica por su número sin ceros a la
--     izquierda, con cualquiera de los dos métodos;
--   · Zelle: el código de confirmación (letras y números);
--   · USDT: el ID de la orden de Binance Pay o el hash de la transacción.
create function tumbo_privado.referencia_pago(p_metodo text, p_ref text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_ref text := upper(trim(coalesce(p_ref, '')));
  v_num text;
begin
  if p_metodo = 'usdt' then
    v_ref := trim(coalesce(p_ref, ''));
    if v_ref !~ '^(0x)?[A-Za-z0-9]{8,100}$' then
      return jsonb_build_object('error', 'Escribe el ID de la orden de Binance Pay o el hash de la transacción (solo letras y números).');
    end if;
    return jsonb_build_object('ref', v_ref, 'clave', 'u:' || lower(regexp_replace(v_ref, '^0x', '', 'i')), 'numero', '');
  end if;
  if char_length(v_ref) < 5 or char_length(v_ref) > 30 then
    return jsonb_build_object('error', 'La referencia del pago debe tener entre 5 y 30 caracteres.');
  end if;
  if v_ref !~ '^[A-Z0-9 ./_-]+$' then
    return jsonb_build_object('error', 'La referencia solo admite letras sin tilde, números, espacios y . / _ -');
  end if;
  if p_metodo = 'zelle' then
    if char_length(regexp_replace(v_ref, '[^A-Z0-9]', '', 'g')) < 5 then
      return jsonb_build_object('error', 'Escribe el código de confirmación de Zelle completo.');
    end if;
    return jsonb_build_object('ref', v_ref, 'clave', 'z:' || regexp_replace(v_ref, '[^A-Z0-9]', '', 'g'), 'numero', '');
  end if;
  v_num := ltrim(regexp_replace(v_ref, '[^0-9]', '', 'g'), '0');
  if char_length(v_num) < 4 then
    return jsonb_build_object('error', 'La referencia debe tener al menos 4 dígitos, sin contar los ceros iniciales.');
  end if;
  return jsonb_build_object('ref', v_ref, 'clave', 'n:' || v_num, 'numero', v_num);
end $$;

-- ¿Está libre la referencia? (sin contar el pago p_pago). También mira los
-- pedidos de antes de la ola 1, que guardaban la referencia sin pago: solo
-- queda libre la de uno cancelado que nunca se concilió.
create function tumbo_privado.referencia_libre(p_clave text, p_numero text, p_pago text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from tumbo.pagos g
                     where g.ref_clave = p_clave and g.estado in ('reportado', 'verificado') and g.id is distinct from p_pago)
     and (coalesce(p_numero, '') = '' or not exists (
           select 1 from tumbo.pedidos p
           where p.pago_id is null and p.ref_numero = p_numero and (p.estado <> 'cancelado' or p.sla_horas is not null)))
$$;

-- Cédula o RIF normalizado (V-12345678, J-12345678-9) o null si no lo es.
create function tumbo_privado.documento(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  m text[] := regexp_match(upper(regexp_replace(coalesce(p, ''), '[\s.]', '', 'g')), '^([VEJPG])-?([0-9]{5,9})(-?([0-9]))?$');
begin
  if m is null then
    return null;
  end if;
  return m[1] || '-' || m[2] || coalesce('-' || m[4], '');
end $$;

-- Teléfono móvil venezolano normalizado (04121234567) o null.
create function tumbo_privado.telefono_movil(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if v ~ '^584[0-9]{9}$' then
    v := '0' || substr(v, 3);
  end if;
  if v ~ '^4[0-9]{9}$' then
    v := '0' || v;
  end if;
  return case when v ~ '^04(12|14|16|22|24|26)[0-9]{7}$' then v end;
end $$;

-- ¿Exento de IVA? Si el catálogo trae productos.iva (ola 1, catálogo), manda
-- esa columna; si no, el ajuste impuestos.categorias_exentas.
create function tumbo_privado.iva_exento(p_sku text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v text;
  v_exentas jsonb := tumbo_privado.ajuste('impuestos') -> 'categorias_exentas';
begin
  if exists (select 1 from pg_attribute where attrelid = 'tumbo.productos'::regclass and attname = 'iva' and not attisdropped) then
    execute 'select iva::text from tumbo.productos where sku = $1' into v using p_sku;
    return coalesce(v = 'exento', false);
  end if;
  if jsonb_typeof(v_exentas) <> 'array' then
    return false;
  end if;
  select categoria into v from tumbo.productos where sku = p_sku;
  return coalesce(v in (select jsonb_array_elements_text(v_exentas)), false);
end $$;

-- Lo cobrado por un pedido (USD): productos, descuentos, envío, IGTF, IVA,
-- crédito aplicado, lo que pagó el comprador (con el crédito), lo que pagó
-- en dinero y la base del seller (productos menos sus descuentos).
create function tumbo_privado.montos_pedido(p tumbo.pedidos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_prod numeric := tumbo_privado.bruto_pedido(p.id);
  v_pagado numeric;
begin
  v_pagado := v_prod - p.descuento_usd - p.descuento_tumbo_usd + p.costo_envio_usd + p.igtf_usd;
  return jsonb_build_object('productos', v_prod, 'descuento', p.descuento_usd, 'descuento_tumbo', p.descuento_tumbo_usd,
    'envio', p.costo_envio_usd, 'igtf', p.igtf_usd, 'iva', p.iva_usd, 'credito', p.credito_usd,
    'pagado', v_pagado, 'dinero', v_pagado - p.credito_usd, 'base_seller', v_prod - p.descuento_usd);
end $$;

-- Pedidos que cubre un pago: los que siguen vivos y los que el comprador
-- canceló después de reportarlo (ya pagados: se reembolsan). En un pago
-- vencido, los que venció.
create function tumbo_privado.pedidos_del_pago(g tumbo.pagos) returns setof tumbo.pedidos
language sql stable security definer set search_path = '' as $$
  select x.* from tumbo.pedidos x
  where x.pago_id = g.id
    and case
          when g.estado = 'vencido' then x.vencido_el is not null
          when g.estado in ('rechazado', 'cancelado') then true
          when g.estado = 'pendiente' then x.estado <> 'cancelado' or (g.tardio and x.vencido_el is not null)
          else x.estado <> 'cancelado'
               or x.cancelado_el >= coalesce(g.reportado_el, g.verificado_el)
               or (g.tardio and x.vencido_el is not null)
        end
  order by x.id
$$;

-- Lo que se espera recibir por un pago, con los pedidos que cubre:
-- {usd, bs, monto (en su moneda), moneda, pedidos}.
create function tumbo_privado.pago_esperado(g tumbo.pagos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_usd numeric := 0;
  v_bs numeric := 0;
  n integer := 0;
  x tumbo.pedidos;
  v numeric;
begin
  for x in select * from tumbo_privado.pedidos_del_pago(g) loop
    v := (tumbo_privado.montos_pedido(x) ->> 'dinero')::numeric;
    v_usd := v_usd + v;
    v_bs := v_bs + round(v * g.tasa, 2);
    n := n + 1;
  end loop;
  return jsonb_build_object('usd', v_usd, 'bs', v_bs, 'moneda', g.moneda,
                            'monto', case when g.moneda = 'VES' then v_bs else v_usd end, 'pedidos', n);
end $$;

-- El crédito en Tumbo que un pedido tiene usado ahora (lo que se descontó
-- al comprar menos lo que se le devolvió).
create function tumbo_privado.credito_vigente(p_pedido text) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(0, -coalesce(sum(c.monto_usd), 0)) from tumbo.creditos c where c.pedido_uso = p_pedido
$$;

-- Deja el crédito de cada pedido de un pago como corresponde a su estado:
-- un pedido que el pago cubre (por verificar o verificado) lo tiene usado;
-- uno que ya no cubre (cancelado antes de pagar, o de un pago cancelado,
-- vencido o rechazado) lo devuelve al saldo del comprador, una sola vez.
-- Con p_cobrar (pago recibido tarde) vuelve a descontar lo devuelto de un
-- pedido que se reactiva; si el comprador ya lo gastó, no se puede. Quien
-- llama tiene bloqueado el pago (eso evita devolver dos veces) y, para
-- cobrar, al comprador. El crédito reservado no se asienta en el libro
-- mayor hasta que el pago se verifica.
create function tumbo_privado.pago_ajustar_creditos(p_pago text, p_cobrar boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
  x tumbo.pedidos;
  v_desea numeric;
  v_actual numeric;
  v_saldo numeric;
begin
  select * into g from tumbo.pagos where id = p_pago;
  if not found then
    return;
  end if;
  for x in select * from tumbo.pedidos where pago_id = g.id and credito_usd > 0 order by id loop
    v_desea := case when g.estado in ('pendiente', 'reportado', 'verificado')
                         and exists (select 1 from tumbo_privado.pedidos_del_pago(g) y where y.id = x.id)
                    then x.credito_usd else 0 end;
    v_actual := tumbo_privado.credito_vigente(x.id);
    if v_actual > v_desea then
      insert into tumbo.creditos (usuario_id, monto_usd, motivo, referencia, pedido_uso)
      values (g.comprador_id, v_actual - v_desea,
              'Devolución del crédito usado en el pedido ' || x.id || ' (pago ' || g.id || ' ' ||
              case g.estado when 'vencido' then 'vencido' when 'rechazado' then 'rechazado' when 'cancelado' then 'cancelado'
                            else 'sin ese pedido' end || ')', g.id, x.id);
      perform tumbo_privado.pago_evento(g.id, 'Sistema', 'Crédito en Tumbo de ' || x.id || ' devuelto al comprador (' ||
                                        tumbo_privado.fmt_usd(v_actual - v_desea) || ')', 'undo');
    elsif v_actual < v_desea and p_cobrar then
      select coalesce(sum(monto_usd), 0) into v_saldo from tumbo.creditos where usuario_id = g.comprador_id;
      if v_saldo < v_desea - v_actual then
        raise exception 'El comprador ya usó el crédito en Tumbo que se le devolvió por %: no se puede reactivar, genera el reembolso.', x.id;
      end if;
      insert into tumbo.creditos (usuario_id, monto_usd, motivo, referencia, pedido_uso)
      values (g.comprador_id, -(v_desea - v_actual), 'Usado de nuevo en el pedido ' || x.id || ' (pago ' || g.id || ' recibido tarde)', g.id, x.id);
    end if;
  end loop;
end $$;

create function tumbo_privado.pago_evento(p_pago text, p_actor text, p_texto text, p_icono text, p_interno boolean default false) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.pago_eventos (pago_id, actor, texto, icono, interno)
  values (p_pago, coalesce(p_actor, 'Sistema'), p_texto, coalesce(p_icono, 'info'), coalesce(p_interno, false));
$$;

-- «Nombre (rol)» de quien actúa, o «Sistema».
create function tumbo_privado.actor(p_yo tumbo.usuarios) returns text
language sql immutable set search_path = '' as $$
  select case when p_yo.id is null then 'Sistema' else p_yo.nombre || ' (' || p_yo.rol || ')' end
$$;

-- Asiento del libro mayor. Las líneas ({cuenta, seller, debe, haber}) se
-- agrupan por cuenta y seller y se dejan en neto; el asiento debe cuadrar.
-- Sin importes, no asienta nada.
create function tumbo_privado.asentar(p_evento text, p_ref text, p_desc text, p_actor text, p_lineas jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_debe numeric;
  v_haber numeric;
  v_netas jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('cuenta', x.cuenta, 'seller', x.seller_id, 'neto', x.neto) order by x.cuenta, x.seller_id), '[]'::jsonb)
    into v_netas
  from (select l ->> 'cuenta' as cuenta, nullif(l ->> 'seller', '') as seller_id,
               sum(round(coalesce(tumbo_privado.num_json(l -> 'debe'), 0), 2) - round(coalesce(tumbo_privado.num_json(l -> 'haber'), 0), 2)) as neto
        from jsonb_array_elements(case when jsonb_typeof(p_lineas) = 'array' then p_lineas else '[]'::jsonb end) l
        group by 1, 2) x
  where x.neto <> 0;
  select coalesce(sum(greatest((n ->> 'neto')::numeric, 0)), 0), coalesce(sum(greatest(-(n ->> 'neto')::numeric, 0)), 0)
    into v_debe, v_haber
  from jsonb_array_elements(v_netas) n;
  if v_debe = 0 and v_haber = 0 then
    return null;
  end if;
  if v_debe <> v_haber or exists (select 1 from jsonb_array_elements(v_netas) n where n ->> 'cuenta' is null) then
    raise exception 'El asiento % de % no cuadra (debe % / haber %).', p_evento, p_ref, v_debe, v_haber;
  end if;
  insert into tumbo.asientos (evento, referencia, descripcion, actor)
  values (p_evento, p_ref, left(coalesce(p_desc, ''), 300), coalesce(p_actor, 'Sistema'))
  returning id into v_id;
  insert into tumbo.asiento_lineas (asiento_id, cuenta, seller_id, debe, haber)
  select v_id, n ->> 'cuenta', n ->> 'seller', greatest((n ->> 'neto')::numeric, 0), greatest(-(n ->> 'neto')::numeric, 0)
  from jsonb_array_elements(v_netas) n;
  return v_id;
end $$;

-- Asientos de un pago verificado: «pago_verificado» (productos e IGTF) y
-- «envio» (el envío cobrado, que va al seller). El dinero entra al banco de
-- la moneda del método; el crédito en Tumbo usado y los descuentos que
-- asume Tumbo completan lo que se le debe a cada seller.
create function tumbo_privado.asentar_pago(p_pago text, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
  x tumbo.pedidos;
  m jsonb;
  v_banco text;
  v_pv jsonb := '[]'::jsonb;
  v_env jsonb := '[]'::jsonb;
  v_dinero numeric;
  v_env_dinero numeric;
  v_env_credito numeric;
begin
  select * into g from tumbo.pagos where id = p_pago;
  v_banco := case when g.contra_entrega then 'caja:USD' else 'banco:' || g.moneda end;
  for x in select * from tumbo_privado.pedidos_del_pago(g) loop
    m := tumbo_privado.montos_pedido(x);
    v_dinero := (m ->> 'dinero')::numeric;
    v_env_dinero := least((m ->> 'envio')::numeric, greatest(v_dinero, 0));
    v_env_credito := (m ->> 'envio')::numeric - v_env_dinero;
    v_pv := v_pv || jsonb_build_array(
      jsonb_build_object('cuenta', v_banco, 'debe', v_dinero - v_env_dinero),
      jsonb_build_object('cuenta', 'credito_clientes', 'debe', (m ->> 'credito')::numeric - v_env_credito),
      jsonb_build_object('cuenta', 'descuentos_tumbo', 'debe', (m ->> 'descuento_tumbo')::numeric),
      jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', x.seller_id, 'haber', (m ->> 'base_seller')::numeric),
      jsonb_build_object('cuenta', 'igtf_por_pagar', 'haber', (m ->> 'igtf')::numeric));
    v_env := v_env || jsonb_build_array(
      jsonb_build_object('cuenta', v_banco, 'debe', v_env_dinero),
      jsonb_build_object('cuenta', 'credito_clientes', 'debe', v_env_credito),
      jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', x.seller_id, 'haber', (m ->> 'envio')::numeric));
  end loop;
  perform tumbo_privado.asentar('pago_verificado', g.id,
    'Pago ' || g.id || ' verificado (' || (select nombre from tumbo.metodos_pago where id = g.metodo) ||
    coalesce(' ref. ' || g.referencia, '') || ')', p_actor, v_pv);
  perform tumbo_privado.asentar('envio', g.id, 'Envío cobrado en el pago ' || g.id || ' (lo recibe el seller)', p_actor, v_env);
end $$;

-- Motivo por el que los fondos de un seller están retenidos, o null.
create function tumbo_privado.retencion_seller(p_seller text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'retención manual: ' || r.motivo from tumbo.retenciones r where r.seller_id = p_seller),
    (select case s.estado when 'suspendido' then 'comercio suspendido'
                          when 'observado' then 'expediente observado (en riesgo)'
                          when 'rechazado' then 'comercio rechazado' end
     from tumbo.sellers s where s.id = p_seller))
$$;

-- Cuenta de liquidación verificada y vigente de un seller (null si no hay).
create function tumbo_privado.cuenta_vigente(p_seller text) returns tumbo.cuentas_liquidacion
language sql stable security definer set search_path = '' as $$
  select c.* from tumbo.cuentas_liquidacion c
  where c.seller_id = p_seller and c.estado = 'verificada' and c.vigente_desde <= now()
  order by c.vigente_desde desc, c.id desc limit 1
$$;

create function tumbo_privado.cuenta_json(c tumbo.cuentas_liquidacion) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when c.id is null then null else jsonb_build_object(
    'id', c.id, 'tipo', c.tipo, 'banco', c.banco, 'banco_nombre', (select b.nombre from tumbo.bancos b where b.codigo = c.banco),
    'titular', c.titular, 'rif', c.rif, 'numero', c.numero, 'tipo_cuenta', c.tipo_cuenta, 'telefono', c.telefono,
    'estado', c.estado, 'vigente_desde', c.vigente_desde, 'motivo', c.motivo, 'creado', c.creado, 'ficticia', c.ficticia) end
$$;

-- «••••6666»: deja ver solo los últimos caracteres de un dato.
create function tumbo_privado.enmascarar(p text, p_visibles integer default 4) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or p = '' then p
              when char_length(p) <= p_visibles then repeat('•', char_length(p))
              else repeat('•', least(char_length(p) - p_visibles, 8)) || right(p, p_visibles) end
$$;

-- La cuenta con el número, el teléfono y el RIF enmascarados (lo que guarda
-- la corrida pagada y lo que ve quien no puede ver los datos completos).
create function tumbo_privado.cuenta_resumen(c tumbo.cuentas_liquidacion) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when c.id is null then null
              else tumbo_privado.cuenta_json(c) || jsonb_build_object(
                     'numero', tumbo_privado.enmascarar(c.numero), 'telefono', tumbo_privado.enmascarar(c.telefono),
                     'rif', left(c.rif, 2) || '•••••' || right(c.rif, 2), 'oculta', true) end
$$;

-- ¿Puede esta persona ver la cuenta completa? Las cuentas de prueba solo
-- ven las ficticias de la semilla.
create function tumbo_privado.ve_cuenta(p_yo tumbo.usuarios, c tumbo.cuentas_liquidacion) returns boolean
language sql stable security definer set search_path = '' as $$
  select not tumbo_privado.cuenta_demo(p_yo.email) or coalesce(c.ficticia, false)
$$;

create function tumbo_privado.cuenta_json_para(c tumbo.cuentas_liquidacion, p_yo tumbo.usuarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when tumbo_privado.ve_cuenta(p_yo, c) then tumbo_privado.cuenta_json(c) else tumbo_privado.cuenta_resumen(c) end
$$;

create function tumbo_privado.liquidacion_evento(p_liq text, p_yo tumbo.usuarios, p_accion text, p_nota text) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.liquidacion_eventos (liquidacion_id, usuario_id, actor, accion, nota)
  values (p_liq, p_yo.id, tumbo_privado.actor(p_yo), p_accion, p_nota);
$$;

create function tumbo_privado.reembolso_evento(p_id bigint, p_yo tumbo.usuarios, p_accion text, p_nota text) returns void
language sql security definer set search_path = '' as $$
  insert into tumbo.reembolso_eventos (reembolso_id, usuario_id, actor, accion, nota)
  values (p_id, p_yo.id, tumbo_privado.actor(p_yo), p_accion, p_nota);
$$;

-- ¿Puede esta persona del equipo ver datos de esta cuenta? Las cuentas de
-- prueba (contraseña pública) no ven los datos de personas reales.
create function tumbo_privado.ve_comprador(p_yo tumbo.usuarios, p_comprador uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not tumbo_privado.cuenta_demo(p_yo.email)
         or exists (select 1 from tumbo.usuarios u where u.id = p_comprador and tumbo_privado.cuenta_demo(u.email))
$$;

-- ¿Es una persona real (no una cuenta de prueba de la demo)?
create function tumbo_privado.comprador_real(p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.usuarios u where u.id = p_usuario and not tumbo_privado.cuenta_demo(u.email))
$$;

-- ¿Es un comercio real? Lo es si alguna cuenta activa de su equipo no es de
-- prueba (el comercio de la demo solo tiene cuentas de prueba).
create function tumbo_privado.seller_real(p_seller text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.usuarios u
                 where u.seller_id = p_seller and u.activo and not tumbo_privado.cuenta_demo(u.email))
$$;

-- Las acciones de dinero o de control sobre una persona o un comercio real
-- exigen sesión elevada (contrato de Cuentas: hoy rechaza las cuentas de
-- prueba, cuya contraseña es pública). Sobre los datos de la demo, las
-- cuentas de prueba pueden practicar.
create function tumbo_privado.exigir_si_real(p_yo tumbo.usuarios, p_real boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(p_real, true) then
    return;
  end if;
  if p_yo.id is not null and tumbo_privado.cuenta_demo(p_yo.email) then
    raise exception 'Es de una persona o un comercio real: las cuentas de prueba solo actúan sobre los datos de la demo (hace falta una cuenta real del equipo con verificación en dos pasos).'
      using errcode = '42501';
  end if;
  perform tumbo_privado.exigir_elevada(p_yo);
end $$;

-- ---------------------------------------------------------------------------
-- Tasa oficial (BCV)
-- ---------------------------------------------------------------------------
-- Registra una tasa de la fuente automática: 'repetida' (la misma de la
-- misma fecha y fuente: solo anota la consulta), 'antigua' (de una fecha
-- anterior a la vigente: no se aplica, nunca deshace una más reciente, p. ej.
-- la cargada a mano), 'propuesta' (se aleja de la vigente más que
-- tasa_bcv.variacion_max_pct: queda para que una persona de Finanzas la
-- confirme, y se le avisa) o 'aplicada' (al historial y a tumbo.config.tasa).
create function tumbo_privado.registrar_tasa(p_valor numeric, p_fecha date, p_fuente text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t tumbo.tasas;
  pr tumbo.tasas;
  v_valor numeric := round(p_valor, 4);
  v_fuente text := left(coalesce(p_fuente, ''), 80);
  v_actual numeric;
  v_max numeric := greatest(1, least(100, tumbo_privado.numero(coalesce(tumbo_privado.ajuste('tasa_bcv'), '{}'::jsonb) -> 'variacion_max_pct', 15)));
begin
  if p_valor is null or p_valor <= 0 or p_valor >= 10000000 or p_fecha is null or p_fecha > tumbo_privado.hoy_caracas() + 3 then
    raise exception 'Tasa inválida.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tumbo:tasa', 0));
  select * into t from tumbo.tasas where estado = 'aplicada' order by aplicada_el desc nulls last, id desc limit 1;
  if found and t.fecha = p_fecha and t.valor = v_valor and t.fuente = v_fuente then
    update tumbo.tasas set ultima_consulta = now() where id = t.id;
    update tumbo.config set tasa = t.valor where id and tasa <> t.valor;
    return 'repetida';
  end if;
  if found and p_fecha < t.fecha then
    return 'antigua';
  end if;
  select tasa into v_actual from tumbo.config;
  if v_actual > 0 and abs(v_valor - v_actual) * 100 / v_actual > v_max then
    select * into pr from tumbo.tasas where estado = 'propuesta' order by id desc limit 1 for update;
    if found and pr.automatica and pr.valor = v_valor and pr.fecha = p_fecha then
      update tumbo.tasas set ultima_consulta = now() where id = pr.id;
      return 'propuesta';
    end if;
    if found and not pr.automatica then
      -- una persona ya propuso una tasa: se decide esa primero
      return 'propuesta';
    end if;
    if found then
      update tumbo.tasas set estado = 'descartada', nota = 'Reemplazada por una consulta más reciente de la fuente' where id = pr.id;
    end if;
    insert into tumbo.tasas (fecha, valor, fuente, automatica, estado, propuesta_por_nombre, nota, ultima_consulta)
    values (p_fecha, v_valor, v_fuente, true, 'propuesta', 'Fuente automática',
            'Se aleja ' || round(abs(v_valor - v_actual) * 100 / v_actual, 1) || ' % de la vigente (' || tumbo_privado.fmt_bs(v_actual) || '): confírmala o descártala',
            now());
    perform tumbo_privado.notificar('rol:finanzas', 'La fuente de la tasa BCV trae ' || tumbo_privado.fmt_bs(v_valor) || ', muy distinta de la vigente (' ||
      tumbo_privado.fmt_bs(v_actual) || '): confírmala o descártala', 'currency_exchange', 'admin/finanzas.html');
    perform tumbo_privado.auditar(null, 'Tasa automática retenida', tumbo_privado.fmt_bs(v_valor) || ' por USD · ' || to_char(p_fecha, 'DD/MM/YYYY') ||
      ' · ' || v_fuente || ' · vigente ' || tumbo_privado.fmt_bs(v_actual));
    return 'propuesta';
  end if;
  insert into tumbo.tasas (fecha, valor, fuente, automatica, estado, aplicada_el, ultima_consulta)
  values (p_fecha, v_valor, v_fuente, true, 'aplicada', now(), now());
  update tumbo.config set tasa = v_valor where id;
  perform tumbo_privado.auditar(null, 'Tasa actualizada',
    tumbo_privado.fmt_bs(v_valor) || ' por USD · ' || to_char(p_fecha, 'DD/MM/YYYY') || ' · ' || v_fuente);
  return 'aplicada';
end $$;

-- La tasa de la respuesta de la fuente pública (ve.dolarapi.com:
-- {"promedio": 886.22, "fechaActualizacion": "2026-10-23T00:00:00-04:00"}, o
-- una lista donde se toma la «oficial»): {valor, fecha} o null.
create function tumbo_privado.tasa_desde_respuesta(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v numeric;
  f date;
begin
  if jsonb_typeof(p) = 'array' then
    select x into p from jsonb_array_elements(p) x where x ->> 'fuente' = 'oficial' limit 1;
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    return null;
  end if;
  v := coalesce(tumbo_privado.num_json(p -> 'promedio'), tumbo_privado.num_json(p -> 'venta'), tumbo_privado.num_json(p -> 'compra'));
  begin
    f := ((p ->> 'fechaActualizacion')::timestamptz at time zone 'America/Caracas')::date;
  exception when others then
    f := null;
  end;
  if v is null or v <= 0 or v >= 10000000 then
    return null;
  end if;
  return jsonb_build_object('valor', round(v, 4), 'fecha', coalesce(f, tumbo_privado.hoy_caracas()));
end $$;

-- Procesa las respuestas que dejó pg_net (si existe).
create function tumbo_privado.tarea_tasa_procesar() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_estado integer;
  v_cuerpo text;
  v jsonb;
  v_res text;
  n integer := 0;
begin
  if to_regclass('net._http_response') is null then
    return 0;
  end if;
  for s in select * from tumbo.tasa_solicitudes where procesado is null and solicitud is not null order by id limit 20 for update skip locked loop
    v_estado := null;
    execute 'select status_code, content from net._http_response where id = $1' into v_estado, v_cuerpo using s.solicitud;
    if v_estado is null then
      if s.creado < now() - interval '1 hour' then
        update tumbo.tasa_solicitudes set procesado = now(), resultado = 'sin respuesta' where id = s.id;
      end if;
      continue;
    end if;
    begin
      v := tumbo_privado.tasa_desde_respuesta(v_cuerpo::jsonb);
    exception when others then
      v := null;
    end;
    if v_estado between 200 and 299 and v is not null then
      begin
        v_res := tumbo_privado.registrar_tasa((v ->> 'valor')::numeric, (v ->> 'fecha')::date, 'BCV vía ' || coalesce(nullif(s.fuente, ''), 'fuente pública'));
      exception when others then
        v_res := 'inválida';
      end;
      update tumbo.tasa_solicitudes set procesado = now(), resultado = v_res || ' ' || (v ->> 'valor') || ' del ' || (v ->> 'fecha') where id = s.id;
      if v_res in ('aplicada', 'repetida') then
        n := n + 1;
      end if;
    else
      update tumbo.tasa_solicitudes set procesado = now(), resultado = 'respuesta ' || v_estado || ' no válida' where id = s.id;
    end if;
  end loop;
  return n;
end $$;

-- Tarea programada (cada 3 horas): procesa lo pendiente, pide la tasa a la
-- fuente pública con pg_net (si existe) y avisa a Finanzas (una vez al día)
-- si la tasa lleva más de N horas sin actualizarse.
create function tumbo_privado.tarea_tasa() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb := coalesce(tumbo_privado.ajuste('tasa_bcv'), '{}'::jsonb);
  v_url text := coalesce(v_cfg ->> 'url', 'https://ve.dolarapi.com/v1/dolares/oficial');
  v_horas integer := greatest(1, least(240, tumbo_privado.numero(v_cfg -> 'horas_alerta', 24)::integer));
  v_req bigint;
  v_ultima timestamptz;
  v_res jsonb;
begin
  v_res := jsonb_build_object('procesadas', tumbo_privado.tarea_tasa_procesar());
  if v_url ~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/%?=&-]*)?$' and exists (select 1 from pg_extension where extname = 'pg_net') then
    execute 'select net.http_get(url := $1, timeout_milliseconds := 8000)' into v_req using v_url;
    insert into tumbo.tasa_solicitudes (solicitud, fuente) values (v_req, substring(v_url from '^https://([^/]+)'));
    v_res := v_res || jsonb_build_object('solicitud', v_req);
  else
    v_res := v_res || jsonb_build_object('solicitud', null, 'motivo', 'sin pg_net: la tasa se carga a mano');
  end if;
  delete from tumbo.tasa_solicitudes where creado < now() - interval '7 days';
  select max(coalesce(ultima_consulta, aplicada_el)) into v_ultima from tumbo.tasas where estado = 'aplicada';
  if v_ultima is null or v_ultima < now() - make_interval(hours => v_horas) then
    if not exists (select 1 from tumbo.alertas_finanzas where clave = 'tasa_desactualizada' and ultima > now() - interval '24 hours') then
      insert into tumbo.alertas_finanzas (clave, ultima) values ('tasa_desactualizada', now())
      on conflict (clave) do update set ultima = now();
      perform tumbo_privado.notificar('rol:finanzas',
        'La tasa BCV lleva más de ' || v_horas || ' h sin actualizarse: revisa la fuente o cárgala a mano (con doble aprobación)',
        'currency_exchange', 'admin/finanzas.html');
    end if;
    v_res := v_res || jsonb_build_object('alerta', true);
  end if;
  return v_res;
end $$;

-- La tasa vigente con su fecha y su fuente (la vitrina la muestra) y si
-- lleva más de tasa_bcv.horas_alerta horas sin actualizarse.
create function public.tm_tasa_vigente() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'valor', c.tasa,
    'fecha', t.fecha, 'fuente', coalesce(t.fuente, 'Tasa de referencia de la demo (sin fuente oficial cargada)'),
    'actualizada', coalesce(t.ultima_consulta, t.aplicada_el),
    'oficial', t.id is not null and t.valor = c.tasa,
    'horas_alerta', h.horas,
    'desactualizada', t.id is null or coalesce(t.ultima_consulta, t.aplicada_el) < now() - make_interval(hours => h.horas))
  from tumbo.config c
  cross join lateral (select greatest(1, least(240, tumbo_privado.numero(coalesce(tumbo_privado.ajuste('tasa_bcv'), '{}'::jsonb) -> 'horas_alerta', 24)::integer)) as horas) h
  left join lateral (select * from tumbo.tasas x where x.estado = 'aplicada'
                     order by x.aplicada_el desc nulls last, x.id desc limit 1) t on true
$$;

-- ---------------------------------------------------------------------------
-- Checkout
-- ---------------------------------------------------------------------------
-- Calcula el checkout del carrito del comprador, todo en el servidor:
--   · destino: una dirección de su libreta (foto con el destinatario) o el
--     retiro en agencia;
--   · por seller, las opciones de envío de cotizar_envio (Logística) del
--     tipo elegido; la elegida (p_datos.envios[seller] = clave) o la más
--     económica;
--   · promociones y cupón con aplicar_promociones (Crecimiento): los
--     descuentos de línea los asume el seller salvo `financia: 'tumbo'`; lo
--     que exceda a las líneas (un cupón general) lo asume Tumbo y se reparte
--     entre los sellers en proporción a su subtotal;
--   · IVA incluido en los productos no exentos (informativo), IGTF sobre lo
--     que se paga en divisas, crédito en Tumbo si se pide usarlo;
--   · total en USD y en Bs. con la tasa vigente.
-- p_datos: {entrega: 'domicilio'|'agencia', direccion_id, agencia: {ciudad, estado},
--           metodo, cupon, envios: {seller: clave}, usar_credito,
--           fiscal: {documento, razon_social}}
create function tumbo_privado.checkout_calcular(p_yo tumbo.usuarios, p_datos jsonb) returns jsonb
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

    -- envío (contrato de Logística)
    v_opciones := tumbo_privado.cotizar_envio(s.seller_id, v_destino, v_items_s);
    select coalesce(jsonb_agg(o || jsonb_build_object('clave', coalesce(o ->> 'id', (o ->> 'tipo') || ':' || coalesce(o ->> 'courier', '')))
                              order by tumbo_privado.num_json(o -> 'costo_usd'), o ->> 'courier'), '[]'::jsonb)
      into v_opciones
    from jsonb_array_elements(case when jsonb_typeof(v_opciones) = 'array' then v_opciones else '[]'::jsonb end) o
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

-- Verifica un pago (manual, con el estado de cuenta, con crédito o tardío):
-- sus pedidos por verificar pasan a «por aceptar», lo que el comprador
-- canceló después de reportarlo se reembolsa, se asientan los pagos en el
-- libro mayor y se avisa (campana y bandeja de salida). Quien llama ya
-- validó el estado y el vencimiento.
create function tumbo_privado.verificar_pago(p_pago text, p_yo tumbo.usuarios, p_mov bigint, p_nota text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
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
  v_esperado := tumbo_privado.pago_esperado(g);
  for x in select * from tumbo_privado.pedidos_del_pago(g) loop
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

-- Crea el checkout: un pago y un pedido por seller, con la reserva de
-- stock, en una sola transacción. Orden de bloqueos (el de siempre):
-- usuario → referencia → pagos y pedidos vencidos → productos por SKU.
-- p_legado (tm_crear_pedido de antes): {ref, total_usd}: el pago nace
-- reportado con esa referencia y se compara el subtotal de productos; si
-- no, se compara el total (p_datos.esperado.total_usd y total_bs) con el
-- que vio el comprador.
create function tumbo_privado.checkout_crear(p_yo tumbo.usuarios, p_datos jsonb, p_legado jsonb) returns jsonb
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
      perform tumbo_privado.evento(v_id, p_yo.nombre, 'Pedido creado y pago registrado (' || m.nombre || ' ref. ' || (v_r ->> 'ref') || ')', 'shopping_cart');
      perform tumbo_privado.notificar('rol:finanzas', 'Pago ' || (v_r ->> 'ref') || ' pendiente de conciliar (' || v_id || ')',
                                      'fact_check', 'admin/conciliacion.html');
    elsif v_contra then
      perform tumbo_privado.evento(v_id, p_yo.nombre, 'Pedido creado · pago en efectivo contra entrega (' || v_pago || ')', 'shopping_cart');
      perform tumbo_privado.notificar('seller:' || (s ->> 'seller_id'), 'Nuevo pedido ' || v_id || ' pendiente de aceptar (cobro contra entrega)',
                                      'shopping_cart', 'seller/pedidos.html', array['seller', 'operador']);
    else
      perform tumbo_privado.evento(v_id, p_yo.nombre, 'Pedido creado · pago ' || v_pago || ' por hacer (' ||
        case when v_total = 0 then 'crédito en Tumbo' else m.nombre end || ')', 'shopping_cart');
    end if;
    perform tumbo_privado.auditar(p_yo, 'Pedido creado', v_id || ' · ' || v_pago || ' · ' || m.nombre || coalesce(' ' || (v_r ->> 'ref'), ''));
    v_ids := v_ids || v_id;
  end loop;

  perform tumbo_privado.pago_evento(v_pago, p_yo.nombre,
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

-- Cotiza el checkout (sin crear nada).
create function public.tm_checkout_cotizar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador']);
begin
  return tumbo_privado.checkout_calcular(yo, p_datos);
end $$;

-- Confirma el checkout: {pago, pedidos, total_usd, total_bs, vence, estado}.
create function public.tm_checkout_crear(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  return tumbo_privado.checkout_crear(yo, p_datos, null);
end $$;

-- El checkout de antes (referencia y subtotal), sobre la entidad pago: el
-- pago nace reportado con esa referencia. Mismas reglas y mensajes.
create or replace function public.tm_crear_pedido(p_sesion text, p_envio_tipo text, p_direccion_id uuid, p_metodo text, p_ref text,
                                                  p_total_usd numeric default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v jsonb;
begin
  if p_metodo is null or p_metodo not in ('Pago Móvil', 'Transferencia') then
    raise exception 'Elige un método de pago válido.';
  end if;
  v := tumbo_privado.checkout_crear(yo,
         jsonb_build_object('entrega', p_envio_tipo, 'direccion_id', p_direccion_id,
                            'metodo', case p_metodo when 'Pago Móvil' then 'pago_movil' else 'transferencia' end),
         jsonb_build_object('ref', p_ref, 'total_usd', p_total_usd));
  return array(select jsonb_array_elements_text(v -> 'pedidos'));
end $$;

-- ---------------------------------------------------------------------------
-- El pago sigue a sus pedidos
-- ---------------------------------------------------------------------------
-- Anota cuándo se cancela un pedido (sirve para saber si el comprador lo
-- canceló antes o después de reportar el pago).
create function tumbo_privado.pedido_cancelado_el() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.estado = 'cancelado' and old.estado <> 'cancelado' then
    new.cancelado_el := now();
  elsif new.estado <> 'cancelado' and old.estado = 'cancelado' then
    new.cancelado_el := null;
  end if;
  return new;
end $$;

create trigger pedidos_cancelado_el before update of estado on tumbo.pedidos
  for each row execute function tumbo_privado.pedido_cancelado_el();

-- Si el comprador cancela todos los pedidos de un pago que aún no reportó,
-- el pago queda cancelado; el crédito en Tumbo que usaba un pedido
-- cancelado antes de pagar vuelve a su saldo. Si ya lo había reportado,
-- Finanzas recibe el aviso: si el dinero llegó, al verificarlo se reembolsa
-- lo cancelado (con su crédito); si no llega, el crédito vuelve al rechazar
-- o vencer el pago. (Un pago bloqueado por otra operación se deja: esa
-- operación vuelve a mirar.)
create function tumbo_privado.pedido_sincroniza_pago() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
begin
  select * into g from tumbo.pagos where id = new.pago_id and estado in ('pendiente', 'reportado') for update skip locked;
  if not found then
    return null;
  end if;
  if g.estado = 'pendiente' then
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

create trigger pedidos_sincroniza_pago after update of estado on tumbo.pedidos
  for each row when (new.estado = 'cancelado' and old.estado = 'pago_por_verificar' and new.pago_id is not null and new.vencido_el is null)
  execute function tumbo_privado.pedido_sincroniza_pago();

-- ---------------------------------------------------------------------------
-- Vencimiento (desde la migración 8; ahora sobre el pago)
-- ---------------------------------------------------------------------------
-- Pagos vencidos (bloqueados para este proceso; los que otro está tocando se
-- dejan para la próxima): los que ya no tienen pedidos por verificar vencen
-- aquí mismo; devuelve los pedidos por vencer (los de esos pagos y los de
-- antes de la ola 1, sin pago), para que quien llama bloquee sus productos y
-- llame a vencer_pedidos.
create or replace function tumbo_privado.pagos_vencidos() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_pagos text[];
  v_ids text[];
  v_legado text[];
  v_ya text[];
  v_id text;
begin
  select coalesce(array_agg(id order by id), '{}') into v_pagos
  from (select id from tumbo.pagos
        where estado in ('pendiente', 'reportado') and vence < now() and not contra_entrega
        order by vence, id limit 50 for update skip locked) x;
  select coalesce(array_agg(id order by id), '{}') into v_ids
  from (select id from tumbo.pedidos
        where pago_id = any (v_pagos) and estado = 'pago_por_verificar'
        order by id for update skip locked) x;
  with vencidos as (
    update tumbo.pagos g set estado = 'vencido'
    where g.id = any (v_pagos)
      and not exists (select 1 from tumbo.pedidos p where p.pago_id = g.id and p.estado = 'pago_por_verificar')
    returning g.id)
  select coalesce(array_agg(id order by id), '{}') into v_ya from vencidos;
  insert into tumbo.pago_eventos (pago_id, actor, texto, icono)
  select id, 'Sistema', 'Pago vencido sin verificar', 'schedule' from unnest(v_ya) as id;
  -- (pagos cuyos pedidos ya estaban cancelados: su crédito vuelve al comprador)
  foreach v_id in array v_ya loop
    perform tumbo_privado.pago_ajustar_creditos(v_id, false);
  end loop;
  select coalesce(array_agg(id order by id), '{}') into v_legado
  from (select id from tumbo.pedidos
        where pago_id is null and estado = 'pago_por_verificar' and pago_vence < now()
        order by id limit 50 for update skip locked) x;
  return v_ids || v_legado;
end $$;

-- Vence esos pedidos (quien llama ya tiene bloqueados sus productos) y deja
-- vencidos los pagos que se quedan sin pedidos por verificar. Un asiento de
-- auditoría por tanda.
create or replace function tumbo_privado.vencer_pedidos(p_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  v_hechos text[] := '{}';
  v_pagos text[] := '{}';
  v_pago text;
begin
  for v in select * from tumbo.pedidos where id = any (p_ids) and estado = 'pago_por_verificar' order by id loop
    update tumbo.pedidos set estado = 'cancelado', liquidacion = null, vencido_el = now() where id = v.id;
    update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
    perform tumbo_privado.evento(v.id, 'Sistema', 'Pago sin verificar a tiempo · pedido vencido y stock liberado', 'schedule');
    perform tumbo_privado.notificar('usr:' || v.comprador_id,
      'Tu pedido ' || v.id || ' venció: no pudimos verificar el pago a tiempo', 'schedule', 'tienda/pedido.html?id=' || v.id);
    v_hechos := v_hechos || (v.id || ' (' || v.metodo || coalesce(' ' || nullif(v.ref, ''), '') || ')');
    if v.pago_id is not null and not (v.pago_id = any (v_pagos)) then
      v_pagos := v_pagos || v.pago_id;
    end if;
  end loop;
  update tumbo.pagos g set estado = 'vencido'
  where g.id = any (v_pagos) and g.estado in ('pendiente', 'reportado')
    and not exists (select 1 from tumbo.pedidos p where p.pago_id = g.id and p.estado = 'pago_por_verificar');
  insert into tumbo.pago_eventos (pago_id, actor, texto, icono)
  select g.id, 'Sistema', 'Pago vencido: no se verificó a tiempo y los pedidos liberaron su stock', 'schedule'
  from tumbo.pagos g where g.id = any (v_pagos) and g.estado = 'vencido';
  -- el crédito en Tumbo que usaban sus pedidos vuelve al comprador
  foreach v_pago in array v_pagos loop
    perform tumbo_privado.pago_ajustar_creditos(v_pago, false);
  end loop;
  if cardinality(v_hechos) > 0 then
    perform tumbo_privado.auditar(null, 'Pedidos vencidos',
      cardinality(v_hechos) || ': ' || array_to_string(v_hechos[1:50], ', ') || case when cardinality(v_hechos) > 50 then '…' else '' end);
  end if;
end $$;

-- Vencimiento de mejor esfuerzo para la lectura: sin esperar bloqueos y
-- nunca en una transacción de solo lectura.
create or replace function tumbo_privado.vencer_pagos() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids text[];
begin
  if current_setting('transaction_read_only') = 'on' then
    return;
  end if;
  v_ids := tumbo_privado.pagos_vencidos();
  if cardinality(v_ids) = 0 then
    return;
  end if;
  begin
    perform 1 from tumbo.productos
    where sku in (select sku from tumbo.pedido_items where pedido_id = any (v_ids))
    order by sku for update nowait;
  exception when lock_not_available then
    return;
  end;
  perform tumbo_privado.vencer_pedidos(v_ids);
end $$;

-- Tarea programada: vence lo vencido y avisa (campana y bandeja de salida)
-- 12 horas antes del vencimiento de cada pago, una sola vez.
create function tumbo_privado.tarea_pagos() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
  n_avisos integer := 0;
  v_vueltas integer := 0;
  v_ids text[];
  n_vencidos integer := 0;
begin
  loop
    v_ids := tumbo_privado.pagos_vencidos();
    exit when cardinality(v_ids) = 0 or v_vueltas >= 20;
    perform 1 from tumbo.productos
    where sku in (select sku from tumbo.pedido_items where pedido_id = any (v_ids)) order by sku for update;
    perform tumbo_privado.vencer_pedidos(v_ids);
    n_vencidos := n_vencidos + cardinality(v_ids);
    v_vueltas := v_vueltas + 1;
  end loop;
  for g in
    select * from tumbo.pagos
    where estado in ('pendiente', 'reportado') and avisado is null and vence > now() and vence <= now() + interval '12 hours'
    order by vence limit 200 for update skip locked
  loop
    perform tumbo_privado.encolar(g.comprador_id, 'pago_por_vencer', jsonb_build_object(
      'pedido', g.id, 'vence', tumbo_privado.fecha_caracas(g.vence), 'enlace', 'app/tienda/pago.html?id=' || g.id));
    perform tumbo_privado.notificar('usr:' || g.comprador_id,
      'El pago ' || g.id || ' vence el ' || tumbo_privado.fecha_caracas(g.vence) ||
      case when g.estado = 'pendiente' then ': si ya pagaste, repórtalo' else ': aún lo estamos verificando' end,
      'schedule', 'tienda/pago.html?id=' || g.id);
    update tumbo.pagos set avisado = now() where id = g.id;
    n_avisos := n_avisos + 1;
  end loop;
  return jsonb_build_object('vencidos', n_vencidos, 'avisos', n_avisos);
end $$;

-- ---------------------------------------------------------------------------
-- Pago guiado (comprador)
-- ---------------------------------------------------------------------------
-- El pago con todo lo que hace falta para pagarlo: monto exacto, datos del
-- beneficiario (ajuste pagos_beneficiario), vencimiento, pedidos, estado,
-- correcciones e historial. Para el comprador (el suyo) y para Finanzas.
-- p_id: el pago o uno de sus pedidos.
create function tumbo_privado.pago_json(g tumbo.pagos, p_yo tumbo.usuarios) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
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
    'comprador', case when v_equipo then (select jsonb_build_object('nombre', u.nombre, 'email', case when v_ve then u.email end)
                                          from tumbo.usuarios u where u.id = g.comprador_id) end,
    'verificado_por', case when v_equipo then g.verificado_por end,
    'movimiento_id', case when v_equipo then g.movimiento_id end,
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'seller', s.nombre, 'seller_id', x.seller_id, 'estado', x.estado,
                                           'total_usd', (tumbo_privado.montos_pedido(x) ->> 'pagado')::numeric, 'monto_bs', x.monto_bs,
                                           'envio', x.courier, 'envio_dias', x.envio_dias,
                                           'cubierto', exists (select 1 from tumbo_privado.pedidos_del_pago(g) y where y.id = x.id))
                                         order by x.id)
                         from tumbo.pedidos x join tumbo.sellers s on s.id = x.seller_id where x.pago_id = g.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('fecha', e.fecha, 'actor', e.actor, 'texto', e.texto, 'icono', e.icono) order by e.id)
                         from tumbo.pago_eventos e where e.pago_id = g.id and (v_equipo or not e.interno)), '[]'::jsonb));
end $$;

create function public.tm_pago_ver(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'finanzas', 'superadmin']);
  g tumbo.pagos;
begin
  select * into g from tumbo.pagos
  where id = coalesce((select pago_id from tumbo.pedidos where id = p_id), p_id)
    and (yo.rol <> 'comprador' or comprador_id = yo.id);
  if not found then
    raise exception 'No encontramos ese pago.';
  end if;
  return tumbo_privado.pago_json(g, yo);
end $$;

-- Los pagos del comprador (los 50 más recientes).
create function public.tm_pagos_mios(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'estado', g.estado, 'metodo', m.nombre, 'moneda', g.moneda,
                                        'total_usd', g.total_usd, 'total_bs', g.total_bs, 'tasa', g.tasa, 'vence', g.vence,
                                        'creado', g.creado, 'referencia', g.referencia, 'observacion', g.observacion,
                                        'pedidos', (select coalesce(jsonb_agg(x.id order by x.id), '[]'::jsonb) from tumbo.pedidos x where x.pago_id = g.id))
                     order by g.creado desc, g.id desc)
    from (select * from tumbo.pagos where comprador_id = yo.id order by creado desc, id desc limit 50) g
    join tumbo.metodos_pago m on m.id = g.metodo), '[]'::jsonb);
end $$;

-- El comprador reporta su pago: según el método, banco emisor, teléfono y
-- cédula (Pago Móvil), cédula o RIF del titular (transferencia), correo y
-- titular (Zelle) o el hash (USDT), la fecha, la referencia y, si quiere, la
-- captura (archivo «comprobante» de uno de sus pedidos). Solo con el pago
-- pendiente y sin vencer; la referencia debe estar libre.
create function public.tm_pago_reportar(p_sesion text, p_id text, p_datos jsonb) returns jsonb
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
      comprobante = v_comp, reportado_el = now(), reportes = reportes + 1, observacion = null
  where id = g.id;
  update tumbo.pedidos set ref = v_r ->> 'ref' where pago_id = g.id and estado = 'pago_por_verificar';
  insert into tumbo.pedido_eventos (pedido_id, actor, texto, icono)
  select x.id, yo.nombre, 'Pago reportado (' || m.nombre || ' ref. ' || (v_r ->> 'ref') || ')', 'payments'
  from tumbo.pedidos x join tumbo.metodos_pago m on m.id = g.metodo
  where x.pago_id = g.id and x.estado = 'pago_por_verificar';
  perform tumbo_privado.pago_evento(g.id, yo.nombre, 'Pago reportado · ref. ' || (v_r ->> 'ref') ||
    case when g.correcciones > 0 then ' (corrección ' || g.correcciones || ')' else '' end, 'payments');
  perform tumbo_privado.notificar('rol:finanzas', 'Pago ' || (v_r ->> 'ref') || ' reportado (' || g.id || '): por conciliar',
                                  'fact_check', 'admin/conciliacion.html');
  perform tumbo_privado.auditar(yo, 'Pago reportado', g.id || ' · ' || g.metodo || ' ' || (v_r ->> 'ref'));
  return tumbo_privado.pago_json((select x from tumbo.pagos x where x.id = g.id), yo);
end $$;

-- ---------------------------------------------------------------------------
-- Conciliación manual (Finanzas)
-- ---------------------------------------------------------------------------
-- El pago de un identificador (un pago o uno de sus pedidos). Un pedido de
-- antes de la ola 1 no tiene pago: null. Lo que no existe: «no encontrado».
create function tumbo_privado.pago_de(p_id text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v text;
begin
  if p_id like 'PAG-%' then
    if not exists (select 1 from tumbo.pagos where id = p_id) then
      raise exception 'Pago % no encontrado.', p_id;
    end if;
    return p_id;
  end if;
  select pago_id into v from tumbo.pedidos where id = p_id;
  if not found then
    raise exception 'Pedido % no encontrado.', p_id;
  end if;
  return v;
end $$;

-- Conciliar un pedido de antes de la ola 1 (sin pago): como siempre.
create function tumbo_privado.conciliar_pedido_legado(yo tumbo.usuarios, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'pago_por_verificar' then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(v.comprador_id));
  if v.pago_vence < now() then
    raise exception 'El pago de % venció (48 horas sin verificar): el pedido se cancela y su stock se libera.', p_id;
  end if;
  update tumbo.pedidos set estado = 'por_aceptar', sla_horas = 24 where id = p_id;
  perform tumbo_privado.evento(p_id, 'Finanzas', 'Pago conciliado · pendiente de aceptación del seller', 'fact_check');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Nuevo pedido ' || p_id || ' pendiente de aceptar', 'shopping_cart',
                                  'seller/pedidos.html', array['seller', 'operador']);
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Confirmamos el pago de tu pedido ' || p_id, 'check_circle', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Conciliación de pago', v.ref || ' → ' || p_id);
end $$;

-- Rechazar el pago de un pedido de antes de la ola 1: como siempre.
create function tumbo_privado.rechazar_pedido_legado(yo tumbo.usuarios, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'pago_por_verificar' then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(v.comprador_id));
  perform tumbo_privado.bloquear_stock(p_id);
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, 'Finanzas', 'Pago rechazado (' || p_motivo || ') · pedido cancelado y stock liberado', 'block');
  perform tumbo_privado.notificar('usr:' || v.comprador_id,
    'No pudimos verificar el pago de tu pedido ' || p_id || ': ' || p_motivo, 'block', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Pago rechazado', v.ref || ' → ' || p_id || ' · ' || p_motivo);
end $$;

-- Conciliar (desde la migración 6): ahora sobre el pago completo. p_id es
-- el pago o uno de sus pedidos. Verifica a mano un pago cotejado en el banco
-- (también uno pendiente: el dinero llegó aunque el comprador no lo
-- reportara). Un pago vencido ya no se concilia aquí: «pago recibido tarde».
-- El pago de una persona real exige sesión elevada: las cuentas de prueba
-- solo concilian los de las cuentas de prueba (si no, cualquiera daría por
-- pagado su propio pedido con la contraseña pública).
create or replace function public.tm_conciliar_pago(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_pago text := tumbo_privado.pago_de(p_id);
  g tumbo.pagos;
begin
  if v_pago is null then
    perform tumbo_privado.conciliar_pedido_legado(yo, p_id);
    return;
  end if;
  select * into g from tumbo.pagos where id = v_pago for update;
  if g.estado not in ('pendiente', 'reportado') then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(g.comprador_id));
  if g.vence < now() then
    raise exception 'El pago de % venció sin verificarse: sus pedidos se cancelan y su stock se libera. Si el dinero llegó, usa «pago recibido tarde».', p_id;
  end if;
  perform tumbo_privado.verificar_pago(g.id, yo, null, 'cotejado en el banco');
end $$;

-- Rechazar (desde la migración 5): ahora sobre el pago completo. Sus
-- pedidos por verificar se cancelan y liberan su reserva, el crédito en
-- Tumbo que usaban vuelve al comprador y él ve el motivo. Para una
-- referencia errada, mejor tm_pago_corregir. Si después aparece dinero de
-- ese pago, se devuelve desde la conciliación («reembolsar»).
create or replace function public.tm_rechazar_pago(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_motivo text := coalesce(left(nullif(trim(coalesce(p_motivo, '')), ''), 200), 'el pago no se pudo verificar');
  v_pago text := tumbo_privado.pago_de(p_id);
  g tumbo.pagos;
  x tumbo.pedidos;
  v_ids text[] := '{}';
begin
  if v_pago is null then
    perform tumbo_privado.rechazar_pedido_legado(yo, p_id, v_motivo);
    return;
  end if;
  select * into g from tumbo.pagos where id = v_pago for update;
  if g.estado not in ('pendiente', 'reportado') then
    raise exception 'El pedido % ya no está pendiente de conciliación.', p_id;
  end if;
  if g.contra_entrega then
    raise exception 'Un pago contra entrega no se rechaza: cancela el pedido o regístralo cuando llegue el efectivo.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(g.comprador_id));
  update tumbo.pagos set estado = 'rechazado', observacion = v_motivo where id = g.id;
  perform 1 from tumbo.pedidos where pago_id = g.id order by id for update;
  perform 1 from tumbo.productos
  where sku in (select i.sku from tumbo.pedido_items i join tumbo.pedidos p on p.id = i.pedido_id
                where p.pago_id = g.id and p.estado = 'pago_por_verificar')
  order by sku for update;
  for x in select * from tumbo.pedidos where pago_id = g.id and estado = 'pago_por_verificar' order by id loop
    update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = x.id;
    update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = x.id and i.sku = p.sku;
    perform tumbo_privado.evento(x.id, 'Finanzas', 'Pago rechazado (' || v_motivo || ') · pedido cancelado y stock liberado', 'block');
    perform tumbo_privado.notificar('usr:' || x.comprador_id,
      'No pudimos verificar el pago de tu pedido ' || x.id || ': ' || v_motivo, 'block', 'tienda/pedido.html?id=' || x.id);
    v_ids := v_ids || x.id;
  end loop;
  perform tumbo_privado.pago_evento(g.id, 'Finanzas', 'Pago rechazado: ' || v_motivo, 'block');
  perform tumbo_privado.pago_ajustar_creditos(g.id, false);
  perform tumbo_privado.auditar(yo, 'Pago rechazado',
    coalesce(g.referencia, 'sin referencia') || ' → ' || g.id || ' (' || array_to_string(v_ids, ', ') || ') · ' || v_motivo);
end $$;

-- Referencia errada: el pago vuelve al comprador para que la corrija y lo
-- reporte de nuevo sin perder sus pedidos (como mucho 2 veces). Tiene al
-- menos 12 horas más para hacerlo.
create function public.tm_pago_corregir(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 200);
  v_pago text := tumbo_privado.pago_de(p_id);
  g tumbo.pagos;
  v_vence timestamptz;
begin
  if v_pago is null then
    raise exception 'El pedido % es de antes de los pagos guiados: concílialo o recházalo.', p_id;
  end if;
  if v_motivo is null or char_length(v_motivo) < 5 then
    raise exception 'Indica qué debe corregir el comprador (lo verá tal cual).';
  end if;
  select * into g from tumbo.pagos where id = v_pago for update;
  if g.estado <> 'reportado' then
    raise exception 'Solo se pide corregir un pago reportado.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(g.comprador_id));
  if g.correcciones >= 2 then
    raise exception 'Ya se pidió corregir este pago 2 veces: si la referencia sigue sin aparecer, recházalo.';
  end if;
  v_vence := greatest(g.vence, now() + interval '12 hours');
  update tumbo.pagos
  set estado = 'pendiente', correcciones = correcciones + 1, referencia = null, ref_clave = null, avisado = null,
      observacion = v_motivo, vence = v_vence
  where id = g.id;
  -- un pedido cancelado después del reporte deja de estar cubierto: su
  -- crédito vuelve al comprador
  perform tumbo_privado.pago_ajustar_creditos(g.id, false);
  update tumbo.pedidos set ref = '', pago_vence = v_vence where pago_id = g.id and estado = 'pago_por_verificar';
  insert into tumbo.pedido_eventos (pedido_id, actor, texto, icono)
  select x.id, 'Finanzas', 'Finanzas pidió corregir el pago (' || v_motivo || ')', 'edit_note'
  from tumbo.pedidos x where x.pago_id = g.id and x.estado = 'pago_por_verificar';
  perform tumbo_privado.pago_evento(g.id, 'Finanzas', 'La referencia ' || coalesce(g.referencia, '') || ' no se encontró: ' || v_motivo, 'edit_note');
  perform tumbo_privado.notificar('usr:' || g.comprador_id,
    'Revisa el pago ' || g.id || ': ' || v_motivo || '. Corrígelo y repórtalo de nuevo (te queda' ||
    case when g.correcciones = 1 then ' 1 corrección' else 'n 2 correcciones' end || ' contando esta).',
    'edit_note', 'tienda/pago.html?id=' || g.id);
  perform tumbo_privado.auditar(yo, 'Corrección de pago pedida', g.id || ' · ' || coalesce(g.referencia, '') || ' · ' || v_motivo);
end $$;

-- Pago recibido tarde: «verificar» (vencido hace menos de 7 días) reactiva
-- los pedidos que venció si aún hay stock (vuelve a reservarlo y a
-- descontar el crédito en Tumbo que se le había devuelto) y verifica el
-- pago; «reembolsar» (vencido hace cualquier tiempo) no vende nada: genera
-- el reembolso del dinero que llegó (tipo «sin_venta», con doble
-- aprobación), una sola vez por pago. El pago de una persona real exige
-- sesión elevada.
create function public.tm_pago_tardio(p_sesion text, p_id text, p_accion text, p_nota text) returns jsonb
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

-- La cola de Finanzas: por verificar (pendientes y reportados, de los más
-- antiguos a los más nuevos), vencidos de los últimos 60 días (pago tardío:
-- reactivables los de 7 días) o los últimos verificados y rechazados.
-- Incluye los pedidos de antes de la ola 1 que siguen por verificar (sin
-- pago). «bloqueado»: quien mira es una cuenta de prueba y el comprador es
-- una persona real (solo lo gestiona una cuenta real con sesión elevada).
create function public.tm_pagos_cola(p_sesion text, p_filtro text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  v_filtro text := coalesce(nullif(p_filtro, ''), 'por_verificar');
  v jsonb;
begin
  if v_filtro not in ('por_verificar', 'vencidos', 'verificados', 'rechazados') then
    raise exception 'Ese filtro no existe.';
  end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('id', g.id, 'estado', g.estado, 'metodo', m.nombre, 'metodo_id', m.id, 'moneda', g.moneda,
             'referencia', g.referencia, 'fecha_pago', g.fecha_pago,
             'pagador', case when tumbo_privado.ve_comprador(yo, g.comprador_id) then g.pagador else '{}'::jsonb end,
             'comprobante', case when tumbo_privado.ve_comprador(yo, g.comprador_id) then g.comprobante end,
             'esperado', tumbo_privado.pago_esperado(g), 'tasa', g.tasa, 'total_usd', g.total_usd, 'total_bs', g.total_bs,
             'vence', g.vence, 'correcciones', g.correcciones, 'observacion', g.observacion, 'contra_entrega', g.contra_entrega,
             'comprador', case when tumbo_privado.ve_comprador(yo, g.comprador_id) then u.nombre else 'Cuenta real (oculta a las cuentas de prueba)' end,
             'creado', g.creado, 'reportado_el', g.reportado_el, 'verificado_el', g.verificado_el,
             'verificado_por', g.verificado_por, 'tardio', g.tardio,
             'reactivable', g.estado = 'vencido' and not g.tardio and g.vence > now() - interval '7 days',
             'bloqueado', tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.comprador_real(g.comprador_id),
             'pedidos', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'estado', x.estado, 'seller', x.seller_id) order by x.id), '[]'::jsonb)
                         from tumbo.pedidos x where x.pago_id = g.id))
           order by case when v_filtro = 'por_verificar' then g.creado end, g.creado desc, g.id), '[]'::jsonb)
    into v
  from (select * from tumbo.pagos q
        where case v_filtro
                when 'por_verificar' then q.estado in ('pendiente', 'reportado')
                when 'vencidos' then q.estado = 'vencido' and q.vence > now() - interval '60 days'
                when 'verificados' then q.estado = 'verificado'
                else q.estado = 'rechazado' end
        order by case when v_filtro = 'por_verificar' then q.creado end, q.creado desc, q.id
        limit 500) g
  join tumbo.metodos_pago m on m.id = g.metodo
  join tumbo.usuarios u on u.id = g.comprador_id;
  if v_filtro = 'por_verificar' then
    v := v || coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'legado', true, 'estado', 'reportado', 'metodo', p.metodo, 'moneda', 'VES',
               'referencia', p.ref, 'tasa', p.tasa,
               'esperado', jsonb_build_object('usd', tumbo_privado.bruto_pedido(p.id) + p.costo_envio_usd,
                                              'bs', round((tumbo_privado.bruto_pedido(p.id) + p.costo_envio_usd) * p.tasa, 2)),
               'vence', p.pago_vence, 'creado', p.creado,
               'bloqueado', tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.comprador_real(p.comprador_id),
               'pedidos', jsonb_build_array(jsonb_build_object('id', p.id, 'estado', p.estado, 'seller', p.seller_id)))
             order by p.creado)
      from (select * from tumbo.pedidos where pago_id is null and estado = 'pago_por_verificar' order by creado limit 500) p), '[]'::jsonb);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Conciliación con el estado de cuenta del banco
-- ---------------------------------------------------------------------------
-- Los formatos de exportación de cada banco (el navegador lee el CSV con
-- ellos y manda las filas).
create function public.tm_conciliacion_formatos(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('banco', f.banco, 'nombre', f.nombre, 'formato', f.formato,
                                                       'actualizado', f.actualizado, 'por', f.por) order by f.nombre)
                   from tumbo.bancos_formatos f), '[]'::jsonb);
end $$;

-- Cambia el formato de un banco (columnas, separador, decimales, fecha). Con
-- él se leen los estados de cuenta reales: exige sesión elevada.
create function public.tm_conciliacion_formato_guardar(p_sesion text, p_banco text, p_formato jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  f tumbo.bancos_formatos;
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into f from tumbo.bancos_formatos where banco = p_banco for update;
  if not found then
    raise exception 'Ese banco no tiene formato.';
  end if;
  if jsonb_typeof(p_formato) <> 'object' or octet_length(p_formato::text) > 4000
     or coalesce(p_formato ->> 'separador', '') not in (',', ';', '|', 'tab')
     or coalesce(p_formato ->> 'decimal', '') not in (',', '.')
     or coalesce(p_formato ->> 'fecha', '') not in ('DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD-MM-YYYY')
     or jsonb_typeof(p_formato -> 'columnas') <> 'object'
     or jsonb_typeof(p_formato -> 'columnas' -> 'fecha') <> 'array'
     or jsonb_typeof(p_formato -> 'columnas' -> 'referencia') <> 'array' then
    raise exception 'El formato necesita separador (, ; | o tab), decimal (, o .), formato de fecha y las columnas de fecha y referencia (y monto, o crédito y débito).';
  end if;
  update tumbo.bancos_formatos set formato = p_formato, actualizado = now(), por = tumbo_privado.actor(yo) where banco = p_banco;
  perform tumbo_privado.auditar(yo, 'Formato de banco cambiado', p_banco || ': ' || left(p_formato::text, 400));
  return p_formato;
end $$;

-- Cruza un movimiento nuevo (un abono) con los pagos: por la referencia (el
-- número, también si el banco lo recorta a sus últimos dígitos), el monto en
-- Bs. (con tolerancia) y la fecha. Un cruce limpio verifica el pago; si no,
-- queda en la cola de excepciones con su motivo.
create function tumbo_privado.conciliar_movimiento(p_mov bigint, p_yo tumbo.usuarios) returns text
language plpgsql security definer set search_path = '' as $$
declare
  mv tumbo.movimientos_banco;
  v_cfg jsonb := coalesce(tumbo_privado.ajuste('conciliacion'), '{}'::jsonb);
  v_tol numeric := tumbo_privado.numero(v_cfg -> 'tolerancia_bs', 1);
  v_dias integer := tumbo_privado.numero(v_cfg -> 'dias', 3)::integer;
  v_dig integer := greatest(4, tumbo_privado.numero(v_cfg -> 'digitos_sufijo', 6)::integer);
  v_cands text[];
  g tumbo.pagos;
  v_esp numeric;
  v_exc text;
begin
  select * into mv from tumbo.movimientos_banco where id = p_mov for update;
  if mv.monto <= 0 then
    update tumbo.movimientos_banco set estado = 'ignorado', nota = 'No es un abono' where id = mv.id;
    return 'ignorado';
  end if;
  if char_length(mv.ref_numero) < 4 then
    update tumbo.movimientos_banco set estado = 'excepcion', excepcion = 'no_identificado' where id = mv.id;
    return 'no_identificado';
  end if;
  -- pagos en bolívares con esa referencia (o recortada por el banco)
  select coalesce(array_agg(x.id order by x.id), '{}') into v_cands
  from tumbo.pagos x
  where x.moneda = 'VES' and x.ref_clave like 'n:%' and x.estado in ('pendiente', 'reportado', 'vencido')
    and (substr(x.ref_clave, 3) = mv.ref_numero
         or (char_length(mv.ref_numero) >= v_dig and right(substr(x.ref_clave, 3), char_length(mv.ref_numero)) = mv.ref_numero)
         or (char_length(substr(x.ref_clave, 3)) >= v_dig and right(mv.ref_numero, char_length(substr(x.ref_clave, 3))) = substr(x.ref_clave, 3)));
  if cardinality(v_cands) = 0 then
    -- ¿la referencia ya pertenece a un pago verificado? (el mismo movimiento en otro archivo, o un pago doble)
    select x.id into v_exc from tumbo.pagos x
    where x.ref_clave = 'n:' || mv.ref_numero and x.estado = 'verificado' limit 1;
    if v_exc is not null then
      update tumbo.movimientos_banco set estado = 'excepcion', excepcion = 'duplicado', pago_id = v_exc,
        nota = 'La referencia ya está en el pago verificado ' || v_exc where id = mv.id;
      return 'duplicado';
    end if;
    update tumbo.movimientos_banco set estado = 'excepcion', excepcion = 'no_identificado' where id = mv.id;
    return 'no_identificado';
  end if;
  if cardinality(v_cands) > 1 then
    update tumbo.movimientos_banco set estado = 'excepcion', excepcion = 'duplicado',
      nota = 'La referencia coincide con varios pagos: ' || array_to_string(v_cands, ', ') where id = mv.id;
    return 'duplicado';
  end if;
  select * into g from tumbo.pagos where id = v_cands[1] for update;
  if exists (select 1 from tumbo.movimientos_banco o where o.pago_id = g.id and o.id <> mv.id and o.estado = 'conciliado') then
    update tumbo.movimientos_banco set estado = 'excepcion', excepcion = 'duplicado', pago_id = g.id,
      nota = 'El pago ya tiene otro movimiento conciliado' where id = mv.id;
    return 'duplicado';
  end if;
  if g.estado = 'vencido' or g.vence < now() then
    update tumbo.movimientos_banco set estado = 'excepcion', excepcion = 'pago_vencido', pago_id = g.id where id = mv.id;
    return 'pago_vencido';
  end if;
  v_esp := (tumbo_privado.pago_esperado(g) ->> 'bs')::numeric;
  if mv.monto < v_esp - v_tol then
    v_exc := 'pago_parcial';
  elsif mv.monto > v_esp + v_tol then
    v_exc := 'monto_distinto';
  elsif mv.fecha < (g.creado at time zone 'America/Caracas')::date - 1
        or mv.fecha > coalesce(g.fecha_pago, (g.creado at time zone 'America/Caracas')::date) + v_dias then
    v_exc := 'fuera_de_fecha';
  end if;
  if v_exc is not null then
    update tumbo.movimientos_banco set estado = 'excepcion', excepcion = v_exc, pago_id = g.id,
      nota = 'Esperado ' || tumbo_privado.fmt_bs(v_esp) || ', llegó ' || tumbo_privado.fmt_bs(mv.monto) where id = mv.id;
    return v_exc;
  end if;
  perform tumbo_privado.verificar_pago(g.id, p_yo, mv.id, 'conciliado con el estado de cuenta (' || mv.banco || ', ' || to_char(mv.fecha, 'DD/MM/YYYY') || ')');
  update tumbo.movimientos_banco set estado = 'conciliado', pago_id = g.id, resuelto_por = 'Cruce automático', resuelto_el = now() where id = mv.id;
  return 'conciliado';
end $$;

-- Importa las filas de un estado de cuenta (las lee el navegador con el
-- formato del banco): [{fecha: 'AAAA-MM-DD', referencia, monto, descripcion}].
-- Hasta 2.000 filas; los movimientos ya importados no se repiten. Cruza
-- cada abono nuevo y devuelve el resumen. Exige sesión elevada (el cruce
-- verifica pagos de personas reales) y tiene tope de movimientos nuevos por
-- persona y en total cada 24 horas (ajuste conciliacion).
create function public.tm_conciliacion_importar(p_sesion text, p_banco text, p_filas jsonb, p_archivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_cfg jsonb := coalesce(tumbo_privado.ajuste('conciliacion'), '{}'::jsonb);
  v_tope_yo integer := greatest(100, tumbo_privado.numero(v_cfg -> 'filas_dia_usuario', 5000)::integer);
  v_tope_total integer := greatest(100, tumbo_privado.numero(v_cfg -> 'filas_dia_total', 20000)::integer);
  v_dia_yo bigint;
  v_dia_total bigint;
  v_imp bigint;
  f jsonb;
  n integer := 0;
  v_fecha date;
  v_monto numeric;
  v_ref text;
  v_desc text;
  v_id bigint;
  v_nuevos bigint[] := '{}';
  v_res text;
  v_cont jsonb := '{}'::jsonb;
  v_repetidas integer := 0;
  v_conc integer := 0;
  v_exc integer := 0;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if not exists (select 1 from tumbo.bancos_formatos where banco = p_banco) then
    raise exception 'Elige el banco del estado de cuenta.';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no tiene movimientos.';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'Importa como mucho 2.000 movimientos por archivo (divide el estado de cuenta por fechas).';
  end if;
  -- (las importaciones de Finanzas van de a una)
  perform pg_advisory_xact_lock(hashtextextended('tumbo:conciliacion', 0));
  insert into tumbo.importaciones_banco (banco, archivo, filas, por_id, por)
  values (p_banco, left(regexp_replace(coalesce(p_archivo, ''), '[[:cntrl:]/\\<>"]+', '', 'g'), 120), jsonb_array_length(p_filas),
          yo.id, tumbo_privado.actor(yo))
  returning id into v_imp;
  for f in select * from jsonb_array_elements(p_filas) loop
    n := n + 1;
    if jsonb_typeof(f) <> 'object' then
      raise exception 'La fila % no es válida.', n;
    end if;
    begin
      v_fecha := (f ->> 'fecha')::date;
    exception when others then
      v_fecha := null;
    end;
    v_monto := tumbo_privado.num_json(f -> 'monto');
    v_ref := left(regexp_replace(trim(coalesce(f ->> 'referencia', '')), '[[:cntrl:]]+', '', 'g'), 40);
    v_desc := left(regexp_replace(trim(coalesce(f ->> 'descripcion', '')), '[[:cntrl:]]+', ' ', 'g'), 300);
    if v_fecha is null or v_fecha > tumbo_privado.hoy_caracas() + 1 or v_fecha < tumbo_privado.hoy_caracas() - 400 then
      raise exception 'La fila % tiene una fecha que no se entiende o fuera de rango (revisa el formato del banco).', n;
    end if;
    if v_monto is null or abs(v_monto) >= 1000000000000 or round(v_monto, 2) <> v_monto then
      raise exception 'La fila % tiene un monto que no se entiende (revisa el separador decimal del banco).', n;
    end if;
    insert into tumbo.movimientos_banco (importacion_id, banco, fecha, referencia, ref_numero, monto, descripcion, huella)
    values (v_imp, p_banco, v_fecha, v_ref, ltrim(regexp_replace(v_ref, '[^0-9]', '', 'g'), '0'), v_monto, v_desc,
            md5(v_fecha::text || '|' || ltrim(regexp_replace(v_ref, '[^0-9]', '', 'g'), '0') || '|' || v_monto::text || '|' || lower(v_desc)))
    on conflict (banco, huella) do nothing
    returning id into v_id;
    if v_id is null then
      v_repetidas := v_repetidas + 1;
    else
      v_nuevos := v_nuevos || v_id;
    end if;
    v_id := null;
  end loop;
  -- topes contra abuso (cada movimiento nuevo se guarda y va a la cola)
  select coalesce(sum(nuevas) filter (where por_id = yo.id), 0), coalesce(sum(nuevas), 0) into v_dia_yo, v_dia_total
  from tumbo.importaciones_banco where creado > now() - interval '24 hours' and id <> v_imp;
  if v_dia_yo + cardinality(v_nuevos) > v_tope_yo then
    raise exception 'Llegaste al tope de % movimientos nuevos en 24 horas (ya importaste %): sigue mañana o pide que se amplíe.', v_tope_yo, v_dia_yo;
  end if;
  if v_dia_total + cardinality(v_nuevos) > v_tope_total then
    raise exception 'El equipo llegó al tope de % movimientos nuevos en 24 horas: sigue mañana o pide que se amplíe.', v_tope_total;
  end if;
  foreach v_id in array v_nuevos loop
    v_res := tumbo_privado.conciliar_movimiento(v_id, yo);
    v_cont := v_cont || jsonb_build_object(v_res, coalesce((v_cont ->> v_res)::integer, 0) + 1);
    if v_res = 'conciliado' then v_conc := v_conc + 1;
    elsif v_res <> 'ignorado' then v_exc := v_exc + 1; end if;
  end loop;
  update tumbo.importaciones_banco set nuevas = cardinality(v_nuevos), repetidas = v_repetidas, conciliadas = v_conc, excepciones = v_exc
  where id = v_imp;
  perform tumbo_privado.auditar(yo, 'Estado de cuenta importado',
    p_banco || ' · ' || n || ' filas, ' || cardinality(v_nuevos) || ' nuevas, ' || v_conc || ' conciliadas, ' || v_exc || ' excepciones');
  return jsonb_build_object('importacion', v_imp, 'filas', n, 'nuevas', cardinality(v_nuevos), 'repetidas', v_repetidas,
                            'conciliadas', v_conc, 'excepciones', v_exc, 'detalle', v_cont);
end $$;

-- Los movimientos importados: la cola de excepciones (por omisión) u otro
-- estado; 100 por página, del más nuevo al más viejo.
create function public.tm_conciliacion_movimientos(p_sesion text, p_estado text, p_antes bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
  v_estado text := coalesce(nullif(p_estado, ''), 'excepcion');
  v jsonb;
begin
  if v_estado not in ('excepcion', 'conciliado', 'ignorado', 'nuevo', 'reembolsado', 'todos') then
    raise exception 'Ese estado no existe.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'banco', m.banco, 'fecha', m.fecha, 'referencia', m.referencia,
                                               'monto', m.monto, 'descripcion', m.descripcion, 'estado', m.estado,
                                               'excepcion', m.excepcion, 'pago_id', m.pago_id, 'nota', m.nota,
                                               'resuelto_por', m.resuelto_por, 'resuelto_el', m.resuelto_el, 'creado', m.creado)
                            order by m.id desc), '[]'::jsonb)
    into v
  from (select * from tumbo.movimientos_banco
        where (v_estado = 'todos' or estado = v_estado) and (p_antes is null or id < p_antes)
        order by id desc limit 100) m;
  return jsonb_build_object('movimientos', v, 'prueba', tumbo_privado.cuenta_demo(yo.email),
    'siguiente', case when jsonb_array_length(v) = 100 then (v -> 99 ->> 'id')::bigint end,
    'resumen', (select coalesce(jsonb_object_agg(x.estado, x.n), '{}'::jsonb)
                from (select estado, count(*) as n from tumbo.movimientos_banco group by estado) x),
    'importaciones', (select coalesce(jsonb_agg(to_jsonb(i) - 'por_id' order by i.id desc), '[]'::jsonb)
                      from (select * from tumbo.importaciones_banco order by id desc limit 10) i));
end $$;

-- Resolver una excepción (con sesión elevada: son movimientos del banco
-- real), siempre con nota:
--   · «vincular» el movimiento a un pago abierto (lo verifica; si sobra
--     dinero, genera el reembolso del excedente; un pago ya verificado solo
--     se asocia);
--   · «reembolsar» el dinero de un pago que no se va a cumplir (rechazado,
--     vencido, cancelado, o un pago repetido de uno ya verificado): un
--     reembolso «sin_venta» por el monto del movimiento, con doble
--     aprobación. Un pago abierto primero se rechaza (o vence);
--   · «ignorar» (no es un pago de Tumbo).
create function public.tm_conciliacion_resolver(p_sesion text, p_id bigint, p_accion text, p_pago text, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
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
    v_usd := round(mv.monto / g.tasa, 2);
    select x.id into v_pedido from tumbo.pedidos x where x.pago_id = g.id order by x.id limit 1;
    v_reemb := tumbo_privado.crear_reembolso_interno(v_pedido, v_usd,
      'Dinero recibido por el pago ' || g.id || ' (' || g.estado || '): se devuelve el movimiento ' || coalesce(nullif(mv.referencia, ''), 's/r') ||
      ' de ' || tumbo_privado.fmt_bs(mv.monto), 'sin_venta');
    perform tumbo_privado.reembolso_evento(v_reemb, yo, 'crear', v_nota);
    update tumbo.movimientos_banco set estado = 'reembolsado', pago_id = g.id, nota = v_nota || ' (R-' || v_reemb || ')',
      resuelto_por = tumbo_privado.actor(yo), resuelto_el = now()
    where id = mv.id;
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
-- Reembolsos
-- ---------------------------------------------------------------------------
-- Crea un reembolso según su tipo:
--   · 'pedido' (contrato crear_reembolso): lo pagado por un pedido de un
--     pago verificado (o de antes de la ola 1), como mucho lo que el
--     comprador pagó (con IGTF) menos lo ya reembolsado de ese pedido en
--     cualquier estado (un fallido se puede reintentar: sigue contando). Un
--     pedido cancelado o reembolsado al que se le pide devolver todo lo
--     cobrado sin el IGTF (bruto + envío) se devuelve completo, con el IGTF.
--     Si el pago nunca se verificó no hay nada que devolver: null.
--   · 'excedente' (dinero que llegó de más en un pago verificado) y
--     'sin_venta' (dinero que llegó por un pago que no se cumplió): sin tope,
--     siempre con doble aprobación.
-- Asienta el reembolso por pagar en el libro mayor y avisa a Finanzas y al
-- comprador.
create function tumbo_privado.crear_reembolso_interno(p_pedido text, p_monto_usd numeric, p_motivo text, p_tipo text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  g tumbo.pagos;
  m jsonb;
  v_monto numeric := round(coalesce(p_monto_usd, 0), 2);
  v_ya numeric := 0;
  v_pagado numeric;
  v_id bigint;
  v_umbral numeric := tumbo_privado.numero(coalesce(tumbo_privado.ajuste('reembolsos'), '{}'::jsonb) -> 'umbral_doble_usd', 200);
  v_completo boolean;
begin
  if p_tipo is null or p_tipo not in ('pedido', 'excedente', 'sin_venta') then
    raise exception 'Tipo de reembolso desconocido.';
  end if;
  select * into v from tumbo.pedidos where id = p_pedido for update;
  if not found then
    raise exception 'Pedido % no encontrado.', p_pedido;
  end if;
  if v_monto <= 0 then
    raise exception 'El monto del reembolso debe ser mayor que cero.';
  end if;
  if v.pago_id is not null then
    select * into g from tumbo.pagos where id = v.pago_id;
    if p_tipo <> 'sin_venta' and g.estado <> 'verificado' then
      return null;
    end if;
  elsif p_tipo <> 'pedido' then
    raise exception 'El pedido % es de antes de los pagos guiados: no admite ese reembolso.', p_pedido;
  end if;
  m := tumbo_privado.montos_pedido(v);
  v_pagado := (m ->> 'pagado')::numeric;
  if p_tipo = 'pedido' and v.pago_id is not null then
    select coalesce(sum(r.monto_usd), 0) into v_ya from tumbo.reembolsos r where r.pedido_id = v.id and r.tipo = 'pedido';
    -- todo lo cobrado sin el IGTF (lo que piden la cancelación y el reclamo): completo
    if v.estado in ('cancelado', 'reembolsado') and v_monto >= v_pagado - (m ->> 'igtf')::numeric - 0.005 then
      v_monto := v_pagado;
    end if;
    v_monto := least(v_monto, v_pagado - v_ya);
    if v_monto <= 0 then
      return null;
    end if;
  end if;
  insert into tumbo.reembolsos (pedido_id, monto_usd, monto_bs, tasa, motivo, por, pago_id, comprador_id, requiere_doble, tipo)
  values (v.id, v_monto, round(v_monto * coalesce(g.tasa, v.tasa), 2), coalesce(g.tasa, v.tasa),
          left(coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Reembolso'), 300), 'Sistema', v.pago_id, v.comprador_id,
          p_tipo <> 'pedido' or v_monto >= v_umbral, p_tipo)
  returning id into v_id;
  -- libro mayor (solo con pago de la ola 1: los anteriores no se asentaron)
  if v.pago_id is not null then
    if p_tipo <> 'pedido' then
      perform tumbo_privado.asentar('reembolso', 'R-' || v_id,
        case when p_tipo = 'excedente' then 'Excedente del pago ' || v.pago_id || ' por devolver'
             else 'Dinero sin venta del pago ' || v.pago_id || ' por devolver' end, 'Sistema',
        jsonb_build_array(jsonb_build_object('cuenta', 'banco:' || g.moneda, 'debe', v_monto),
                          jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'haber', v_monto)));
    else
      v_completo := v_ya = 0 and v_monto = v_pagado;
      perform tumbo_privado.asentar('reembolso', 'R-' || v_id, 'Reembolso del pedido ' || v.id || ' por pagar', 'Sistema',
        case when v_completo then jsonb_build_array(
          jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', v.seller_id, 'debe', (m ->> 'base_seller')::numeric + (m ->> 'envio')::numeric),
          jsonb_build_object('cuenta', 'igtf_por_pagar', 'debe', (m ->> 'igtf')::numeric),
          jsonb_build_object('cuenta', 'descuentos_tumbo', 'haber', (m ->> 'descuento_tumbo')::numeric),
          jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'haber', v_monto))
        else jsonb_build_array(
          jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', v.seller_id, 'debe', v_monto),
          jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'haber', v_monto)) end);
    end if;
  end if;
  perform tumbo_privado.notificar('rol:finanzas',
    'Reembolso de ' || tumbo_privado.fmt_usd(v_monto) || ' por enviar (' || v.id || ')', 'undo', 'admin/reembolsos.html');
  perform tumbo_privado.notificar('usr:' || v.comprador_id,
    'Tienes un reembolso de ' || tumbo_privado.fmt_usd(v_monto) ||
    case when p_tipo = 'pedido' then ' del pedido ' || v.id else ' del pago ' || coalesce(v.pago_id, v.id) end ||
    ': indica dónde quieres recibirlo', 'undo', 'tienda/reembolsos.html');
  return v_id;
end $$;

-- Contrato (ola 0): crea el reembolso de un pedido; ahora con el tope de lo
-- pagado, el libro mayor y el aviso al comprador para que elija el destino.
create or replace function tumbo_privado.crear_reembolso(p_pedido text, p_monto_usd numeric, p_motivo text) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  return tumbo_privado.crear_reembolso_interno(p_pedido, p_monto_usd, p_motivo, 'pedido');
end $$;

-- Resumen de un destino de reembolso con los datos enmascarados (lo que se
-- guarda en reembolsos.destino, que la lectura de la ola 0 entrega a
-- Finanzas): tipo, banco y lo justo para reconocerlo.
create function tumbo_privado.destino_resumen(d jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case d ->> 'tipo'
    when 'pago_movil' then jsonb_build_object('tipo', 'pago_movil', 'banco', d ->> 'banco', 'banco_nombre', d ->> 'banco_nombre',
                                              'telefono', tumbo_privado.enmascarar(d ->> 'telefono'),
                                              'cedula', left(d ->> 'cedula', 2) || '•••' || right(d ->> 'cedula', 3), 'resumen', true)
    when 'zelle' then jsonb_build_object('tipo', 'zelle',
                                         'correo', left(d ->> 'correo', 1) || '•••@' || split_part(d ->> 'correo', '@', 2),
                                         'titular', left(d ->> 'titular', 1) || '•••', 'resumen', true)
    else jsonb_build_object('tipo', d ->> 'tipo') end
$$;

-- El comprador elige dónde recibir su reembolso: Pago Móvil (banco,
-- teléfono y cédula), Zelle (correo y titular) o crédito en Tumbo (se
-- acredita al momento, salvo que el reembolso necesite doble aprobación:
-- entonces espera a Finanzas como los demás). Solo mientras esté pendiente
-- o haya fallado. El detalle queda en tumbo.reembolso_destinos.
create function public.tm_reembolso_destino(p_sesion text, p_id bigint, p_destino jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  r tumbo.reembolsos;
  v_tipo text := p_destino ->> 'tipo';
  v_dest jsonb;
  v_tel text;
  v_doc text;
  v_correo text;
  v_titular text;
begin
  select x.* into r from tumbo.reembolsos x join tumbo.pedidos p on p.id = x.pedido_id
  where x.id = p_id and p.comprador_id = yo.id for update of x;
  if not found then
    raise exception 'No encontramos ese reembolso.';
  end if;
  if r.estado not in ('pendiente', 'fallido') then
    raise exception 'Ese reembolso ya está en proceso: el destino no se puede cambiar.';
  end if;
  if (select count(*) from tumbo.reembolso_eventos e where e.reembolso_id = r.id and e.accion = 'destino' and e.fecha > now() - interval '1 hour') >= 10 then
    raise exception 'Cambiaste el destino muchas veces en la última hora: espera un poco.';
  end if;
  if v_tipo = 'pago_movil' then
    v_tel := tumbo_privado.telefono_movil(p_destino ->> 'telefono');
    v_doc := tumbo_privado.documento(p_destino ->> 'cedula');
    if not exists (select 1 from tumbo.bancos where codigo = p_destino ->> 'banco') then
      raise exception 'Elige el banco de tu Pago Móvil.';
    end if;
    if v_tel is null then raise exception 'Escribe el teléfono afiliado a Pago Móvil (p. ej. 0414-1234567).'; end if;
    if v_doc is null then raise exception 'Escribe la cédula del titular (p. ej. V-12345678).'; end if;
    v_dest := jsonb_build_object('tipo', 'pago_movil', 'banco', p_destino ->> 'banco',
                                 'banco_nombre', (select nombre from tumbo.bancos where codigo = p_destino ->> 'banco'),
                                 'telefono', v_tel, 'cedula', v_doc);
  elsif v_tipo = 'zelle' then
    v_correo := lower(trim(coalesce(p_destino ->> 'correo', '')));
    v_titular := left(regexp_replace(trim(coalesce(p_destino ->> 'titular', '')), '[[:cntrl:]<>]+', '', 'g'), 80);
    if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_correo) > 120 then
      raise exception 'Escribe el correo de tu cuenta Zelle.';
    end if;
    if char_length(v_titular) < 3 then raise exception 'Escribe el nombre del titular de la cuenta Zelle.'; end if;
    v_dest := jsonb_build_object('tipo', 'zelle', 'correo', v_correo, 'titular', v_titular);
  elsif v_tipo = 'credito' then
    v_dest := jsonb_build_object('tipo', 'credito');
  else
    raise exception 'Elige cómo quieres recibir el reembolso: Pago Móvil, Zelle o crédito en Tumbo.';
  end if;
  insert into tumbo.reembolso_destinos (reembolso_id, datos) values (r.id, v_dest)
  on conflict (reembolso_id) do update set datos = excluded.datos, actualizado = now();
  update tumbo.reembolsos set destino = tumbo_privado.destino_resumen(v_dest), estado = 'pendiente', error = null, actualizado = now()
  where id = r.id;
  perform tumbo_privado.reembolso_evento(r.id, yo, 'destino', v_tipo);
  if v_tipo = 'credito' and not r.requiere_doble then
    -- crédito en Tumbo: se acredita al momento (no sale dinero)
    perform tumbo_privado.reembolso_acreditar(r.id, yo);
    perform tumbo_privado.auditar(yo, 'Reembolso acreditado en Tumbo', 'R-' || r.id || ' · ' || r.pedido_id || ' · ' || tumbo_privado.fmt_usd(r.monto_usd));
  else
    perform tumbo_privado.notificar('rol:finanzas', 'El reembolso R-' || r.id || ' (' || r.pedido_id || ') ya tiene destino: ' ||
                                    case when r.requiere_doble then 'lo aprueba otra persona antes de enviarlo' else 'puedes enviarlo' end,
                                    'undo', 'admin/reembolsos.html');
  end if;
  return (select (to_jsonb(x) - 'por') || jsonb_build_object('destino', v_dest) from tumbo.reembolsos x where x.id = r.id);
end $$;

-- Acredita un reembolso en el crédito en Tumbo del comprador: lo deja
-- enviado y lo asienta (reembolsos por pagar → crédito de clientes).
create function tumbo_privado.reembolso_acreditar(p_id bigint, p_yo tumbo.usuarios) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r tumbo.reembolsos;
  v_comprador uuid;
begin
  select * into r from tumbo.reembolsos where id = p_id;
  select comprador_id into v_comprador from tumbo.pedidos where id = r.pedido_id;
  insert into tumbo.creditos (usuario_id, monto_usd, motivo, referencia)
  values (v_comprador, r.monto_usd, 'Reembolso del pedido ' || r.pedido_id, 'R-' || r.id);
  update tumbo.reembolsos set estado = 'enviado', referencia = 'CRÉDITO-' || r.id, moneda_envio = 'CREDITO', tasa_envio = null,
    monto_enviado = r.monto_usd, enviado_el = now(), actualizado = now(), error = null,
    por = case when p_yo.id is null or p_yo.rol = 'comprador' then 'Sistema' else tumbo_privado.actor(p_yo) end
  where id = r.id;
  if r.pago_id is not null then
    perform tumbo_privado.asentar('reembolso_enviado', 'R-' || r.id, 'Reembolso del pedido ' || r.pedido_id || ' acreditado en Tumbo',
      case when p_yo.id is null or p_yo.rol = 'comprador' then 'Sistema' else tumbo_privado.actor(p_yo) end,
      jsonb_build_array(jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'debe', r.monto_usd),
                        jsonb_build_object('cuenta', 'credito_clientes', 'haber', r.monto_usd)));
  end if;
end $$;

-- El saldo de crédito en Tumbo del comprador y sus movimientos.
create function public.tm_credito(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador']);
begin
  return jsonb_build_object(
    'saldo', (select coalesce(sum(monto_usd), 0) from tumbo.creditos where usuario_id = yo.id),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('fecha', c.creado, 'monto_usd', c.monto_usd, 'motivo', c.motivo,
                                                                 'referencia', c.referencia) order by c.id desc)
                             from (select * from tumbo.creditos where usuario_id = yo.id order by id desc limit 100) c), '[]'::jsonb));
end $$;

-- La cola de reembolsos de Finanzas con su destino, quién los tomó y
-- aprobó, y lo que falta para enviarlos. p_estado: 'abiertos' (pendiente,
-- en proceso y fallido) u otro estado.
create function public.tm_reembolsos_gestion(p_sesion text, p_estado text) returns jsonb
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
               'eventos', coalesce((select jsonb_agg(jsonb_build_object('actor', e.actor, 'accion', e.accion, 'nota', e.nota, 'fecha', e.fecha,
                                                                        'mio', e.usuario_id = yo.id) order by e.id)
                                    from tumbo.reembolso_eventos e where e.reembolso_id = r.id), '[]'::jsonb))
             order by r.creado, r.id)
      from (select * from tumbo.reembolsos x
            where case v_estado when 'abiertos' then x.estado in ('pendiente', 'en_proceso', 'fallido')
                                when 'todos' then true else x.estado = v_estado end
            order by x.creado desc, x.id desc limit 500) r
      join tumbo.pedidos p on p.id = r.pedido_id
      join tumbo.usuarios u on u.id = p.comprador_id), '[]'::jsonb));
end $$;

-- El ciclo de un reembolso en Finanzas:
--   · tomar: pendiente → en proceso (con destino elegido por el comprador);
--   · aprobar: segunda firma de los que llegan al umbral (otra persona que
--     quien lo tomó, con sesión elevada);
--   · enviar: en proceso → enviado, con la referencia (al umbral: aprobado
--     por otra persona y con sesión elevada). Por Pago Móvil se paga en Bs.
--     a la tasa del día (se guarda); por Zelle, en USD;
--   · fallar: en proceso → fallido, con el motivo (el comprador revisa su
--     destino); reintentar: fallido → pendiente.
-- Al crédito en Tumbo solo llegan aquí los de doble aprobación: «enviar»
-- lo acredita sin referencia. El reembolso de una persona real exige sesión
-- elevada en cualquier paso (las cuentas de prueba, solo los de prueba).
create function public.tm_reembolso_procesar(p_sesion text, p_id bigint, p_accion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  r tumbo.reembolsos;
  cfg tumbo.config;
  v_ref text;
  v_nota text := left(nullif(trim(coalesce(p_datos ->> 'nota', p_datos ->> 'motivo', '')), ''), 300);
  v_tomo uuid;
  v_moneda text;
  v_enviado numeric;
begin
  if p_accion is null or p_accion not in ('tomar', 'aprobar', 'enviar', 'fallar', 'reintentar') then
    raise exception 'Acción de reembolso desconocida.';
  end if;
  select * into r from tumbo.reembolsos where id = p_id for update;
  if not found then
    raise exception 'No encontramos ese reembolso.';
  end if;
  -- el reembolso de una persona real: sesión elevada (las cuentas de prueba
  -- solo practican con los de las cuentas de prueba)
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real((select comprador_id from tumbo.pedidos where id = r.pedido_id)));
  select * into cfg from tumbo.config;
  select e.usuario_id into v_tomo from tumbo.reembolso_eventos e where e.reembolso_id = r.id and e.accion = 'tomar' order by e.id desc limit 1;

  if p_accion = 'tomar' then
    if r.estado <> 'pendiente' then raise exception 'Solo se toma un reembolso pendiente.'; end if;
    if r.destino is null then raise exception 'El comprador aún no indicó dónde recibir el reembolso.'; end if;
    update tumbo.reembolsos set estado = 'en_proceso', actualizado = now(), por = tumbo_privado.actor(yo) where id = r.id;
    perform tumbo_privado.reembolso_evento(r.id, yo, 'tomar', v_nota);
    perform tumbo_privado.auditar(yo, 'Reembolso en proceso', 'R-' || r.id || ' · ' || r.pedido_id || ' · ' || tumbo_privado.fmt_usd(r.monto_usd));
  elsif p_accion = 'aprobar' then
    if r.estado <> 'en_proceso' then raise exception 'Solo se aprueba un reembolso en proceso.'; end if;
    if not r.requiere_doble then raise exception 'Este reembolso no necesita una segunda aprobación.'; end if;
    perform tumbo_privado.exigir_elevada(yo);
    if v_tomo = yo.id then
      raise exception 'La segunda aprobación la da otra persona: tú tomaste este reembolso.';
    end if;
    if exists (select 1 from tumbo.reembolso_eventos e where e.reembolso_id = r.id and e.accion = 'aprobar'
               and e.fecha > (select max(f.fecha) from tumbo.reembolso_eventos f where f.reembolso_id = r.id and f.accion = 'tomar')) then
      raise exception 'Este reembolso ya tiene su segunda aprobación.';
    end if;
    perform tumbo_privado.reembolso_evento(r.id, yo, 'aprobar', v_nota);
    perform tumbo_privado.auditar(yo, 'Reembolso aprobado', 'R-' || r.id || ' · ' || tumbo_privado.fmt_usd(r.monto_usd));
  elsif p_accion = 'enviar' then
    if r.estado <> 'en_proceso' then raise exception 'Solo se envía un reembolso en proceso.'; end if;
    v_ref := upper(trim(coalesce(p_datos ->> 'referencia', '')));
    if r.destino ->> 'tipo' <> 'credito'
       and (char_length(v_ref) < 4 or char_length(v_ref) > 40 or v_ref !~ '^[A-Z0-9 ./_-]+$') then
      raise exception 'Escribe la referencia del envío (de 4 a 40 letras sin tilde, números, espacios y . / _ -).';
    end if;
    if r.requiere_doble then
      perform tumbo_privado.exigir_elevada(yo);
      if not exists (select 1 from tumbo.reembolso_eventos e where e.reembolso_id = r.id and e.accion = 'aprobar' and e.usuario_id <> yo.id
                     and e.fecha > (select max(f.fecha) from tumbo.reembolso_eventos f where f.reembolso_id = r.id and f.accion = 'tomar')) then
        raise exception 'Este reembolso llega al umbral: necesita la aprobación de otra persona antes de enviarse.';
      end if;
    end if;
    if r.destino ->> 'tipo' = 'credito' then
      -- crédito en Tumbo (con su doble aprobación ya dada): se acredita
      perform tumbo_privado.reembolso_acreditar(r.id, yo);
      perform tumbo_privado.reembolso_evento(r.id, yo, 'enviar', 'crédito en Tumbo');
      perform tumbo_privado.notificar('usr:' || (select comprador_id from tumbo.pedidos where id = r.pedido_id),
        'Acreditamos en tu crédito en Tumbo el reembolso del pedido ' || r.pedido_id || ' (' || tumbo_privado.fmt_usd(r.monto_usd) || ')',
        'undo', 'tienda/reembolsos.html');
      perform tumbo_privado.auditar(yo, 'Reembolso acreditado en Tumbo', 'R-' || r.id || ' · ' || r.pedido_id || ' · ' || tumbo_privado.fmt_usd(r.monto_usd));
      return (select to_jsonb(x) from tumbo.reembolsos x where x.id = r.id);
    end if;
    v_moneda := case when r.destino ->> 'tipo' = 'zelle' then 'USD' else 'VES' end;
    v_enviado := case when v_moneda = 'USD' then r.monto_usd else round(r.monto_usd * cfg.tasa, 2) end;
    update tumbo.reembolsos
    set estado = 'enviado', referencia = v_ref, moneda_envio = v_moneda, tasa_envio = case when v_moneda = 'VES' then cfg.tasa end,
        monto_enviado = v_enviado, enviado_el = now(), actualizado = now(), error = null, por = tumbo_privado.actor(yo)
    where id = r.id;
    perform tumbo_privado.reembolso_evento(r.id, yo, 'enviar', v_ref);
    if r.pago_id is not null then
      perform tumbo_privado.asentar('reembolso_enviado', 'R-' || r.id, 'Reembolso del pedido ' || r.pedido_id || ' enviado · ref. ' || v_ref,
        tumbo_privado.actor(yo),
        jsonb_build_array(jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'debe', r.monto_usd),
                          jsonb_build_object('cuenta', 'banco:' || v_moneda, 'haber', r.monto_usd)));
    end if;
    perform tumbo_privado.encolar((select comprador_id from tumbo.pedidos where id = r.pedido_id), 'reembolso_enviado', jsonb_build_object(
      'pedido', r.pedido_id, 'monto', case when v_moneda = 'USD' then tumbo_privado.fmt_usd(v_enviado) else tumbo_privado.fmt_bs(v_enviado) end,
      'referencia', v_ref, 'enlace', 'app/tienda/reembolsos.html'));
    perform tumbo_privado.notificar('usr:' || (select comprador_id from tumbo.pedidos where id = r.pedido_id),
      'Enviamos el reembolso del pedido ' || r.pedido_id || ' (ref. ' || v_ref || ')', 'undo', 'tienda/reembolsos.html');
    perform tumbo_privado.auditar(yo, 'Reembolso enviado', 'R-' || r.id || ' · ' || r.pedido_id || ' · ' ||
      case when v_moneda = 'USD' then tumbo_privado.fmt_usd(v_enviado) else tumbo_privado.fmt_bs(v_enviado) end || ' · ref. ' || v_ref);
  elsif p_accion = 'fallar' then
    if r.estado <> 'en_proceso' then raise exception 'Solo falla un reembolso en proceso.'; end if;
    if v_nota is null then raise exception 'Indica por qué falló (el comprador lo verá).'; end if;
    update tumbo.reembolsos set estado = 'fallido', error = v_nota, actualizado = now(), por = tumbo_privado.actor(yo) where id = r.id;
    perform tumbo_privado.reembolso_evento(r.id, yo, 'fallar', v_nota);
    perform tumbo_privado.notificar('usr:' || (select comprador_id from tumbo.pedidos where id = r.pedido_id),
      'No pudimos enviar el reembolso del pedido ' || r.pedido_id || ': ' || v_nota || '. Revisa el destino.', 'error', 'tienda/reembolsos.html');
    perform tumbo_privado.auditar(yo, 'Reembolso fallido', 'R-' || r.id || ' · ' || v_nota);
  else
    if r.estado <> 'fallido' then raise exception 'Solo se reintenta un reembolso fallido.'; end if;
    update tumbo.reembolsos set estado = 'pendiente', actualizado = now(), por = tumbo_privado.actor(yo) where id = r.id;
    perform tumbo_privado.reembolso_evento(r.id, yo, 'reintentar', v_nota);
    perform tumbo_privado.auditar(yo, 'Reembolso reintentado', 'R-' || r.id);
  end if;
  return (select to_jsonb(x) from tumbo.reembolsos x where x.id = r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Tasa manual (con doble aprobación) e historial
-- ---------------------------------------------------------------------------
create function public.tm_tasas(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas']);
begin
  return jsonb_build_object(
    'vigente', public.tm_tasa_vigente(),
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'ultima_solicitud', (select jsonb_build_object('creado', s.creado, 'procesado', s.procesado, 'resultado', s.resultado)
                         from tumbo.tasa_solicitudes s order by s.id desc limit 1),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'fecha', t.fecha, 'valor', t.valor, 'fuente', t.fuente,
                                                               'estado', t.estado, 'propuesta_por', t.propuesta_por_nombre, 'automatica', t.automatica,
                                                               'aprobada_por', t.aprobada_por_nombre, 'nota', t.nota, 'creado', t.creado,
                                                               'aplicada_el', t.aplicada_el, 'ultima_consulta', t.ultima_consulta,
                                                               'mia', t.propuesta_por = yo.id) order by t.id desc)
                           from (select * from tumbo.tasas order by id desc limit 60) t), '[]'::jsonb));
end $$;

-- Carga manual de la tasa (cuando la fuente falla): una persona de Finanzas
-- la propone y otra la confirma; las dos con sesión elevada (nunca con las
-- cuentas de prueba: la tasa cambia los precios de toda la tienda).
create function public.tm_tasa_proponer(p_sesion text, p_valor numeric, p_fecha date, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_id bigint;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if p_valor is null or p_valor <= 0 or p_valor >= 10000000 or round(p_valor, 4) <> p_valor then
    raise exception 'Escribe la tasa en bolívares por dólar (hasta 4 decimales).';
  end if;
  if p_fecha is null or p_fecha > tumbo_privado.hoy_caracas() + 3 or p_fecha < tumbo_privado.hoy_caracas() - 7 then
    raise exception 'Indica la fecha de vigencia de la tasa (de hace una semana a los próximos días).';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tumbo:tasa', 0));
  if exists (select 1 from tumbo.tasas where estado = 'propuesta') then
    raise exception 'Ya hay una tasa propuesta esperando confirmación: confírmala o descártala primero.';
  end if;
  insert into tumbo.tasas (fecha, valor, fuente, estado, propuesta_por, propuesta_por_nombre, nota)
  values (p_fecha, p_valor, 'Carga manual (BCV)', 'propuesta', yo.id, tumbo_privado.actor(yo), left(nullif(trim(coalesce(p_nota, '')), ''), 200))
  returning id into v_id;
  perform tumbo_privado.notificar('rol:finanzas', 'Tasa propuesta ' || tumbo_privado.fmt_bs(p_valor) || ': confírmala con otra persona', 'currency_exchange', 'admin/finanzas.html');
  perform tumbo_privado.notificar('rol:superadmin', 'Tasa propuesta ' || tumbo_privado.fmt_bs(p_valor) || ': confírmala con otra persona', 'currency_exchange', 'admin/finanzas.html');
  perform tumbo_privado.auditar(yo, 'Tasa propuesta', tumbo_privado.fmt_bs(p_valor) || ' · ' || to_char(p_fecha, 'DD/MM/YYYY'));
  return jsonb_build_object('id', v_id, 'estado', 'propuesta');
end $$;

create function public.tm_tasa_decidir(p_sesion text, p_id bigint, p_aprobar boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  t tumbo.tasas;
  v_antes numeric;
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into t from tumbo.tasas where id = p_id for update;
  if not found or t.estado <> 'propuesta' then
    raise exception 'Esa tasa ya no está esperando confirmación.';
  end if;
  if p_aprobar is null then
    raise exception 'Indica si confirmas o descartas la tasa.';
  end if;
  if p_aprobar and t.propuesta_por = yo.id then
    raise exception 'La confirma otra persona: tú la propusiste.';
  end if;
  if not p_aprobar then
    update tumbo.tasas set estado = 'descartada', aprobada_por = yo.id, aprobada_por_nombre = tumbo_privado.actor(yo) where id = t.id;
    perform tumbo_privado.auditar(yo, 'Tasa descartada', tumbo_privado.fmt_bs(t.valor));
    return jsonb_build_object('id', t.id, 'estado', 'descartada');
  end if;
  select tasa into v_antes from tumbo.config;
  update tumbo.tasas set estado = 'aplicada', aprobada_por = yo.id, aprobada_por_nombre = tumbo_privado.actor(yo),
    aplicada_el = now(), ultima_consulta = now()
  where id = t.id;
  update tumbo.config set tasa = t.valor where id;
  perform tumbo_privado.auditar(yo, 'Tasa actualizada', tumbo_privado.fmt_bs(v_antes) || ' → ' || tumbo_privado.fmt_bs(t.valor) ||
    ' por USD · carga manual propuesta por ' || t.propuesta_por_nombre);
  return jsonb_build_object('id', t.id, 'estado', 'aplicada', 'valor', t.valor);
end $$;

-- ---------------------------------------------------------------------------
-- Métodos de pago
-- ---------------------------------------------------------------------------
-- Los métodos activos con sus instrucciones y los datos del beneficiario
-- (del ajuste pagos_beneficiario; lo que falta dice «pendiente»).
create function public.tm_metodos_pago() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'moneda', m.moneda, 'igtf', m.igtf,
                                               'contra_entrega', m.contra_entrega, 'instrucciones', m.instrucciones,
                                               'campos', to_jsonb(m.campos), 'activo', m.activo,
                                               'beneficiario', tumbo_privado.ajuste('pagos_beneficiario') -> 'metodos' -> m.nombre)
                            order by m.orden), '[]'::jsonb)
  from tumbo.metodos_pago m where not m.interno
$$;

-- El superadministrador activa o desactiva un método, su IGTF y sus
-- instrucciones (con sesión elevada).
create function public.tm_metodo_pago_guardar(p_sesion text, p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  m tumbo.metodos_pago;
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into m from tumbo.metodos_pago where id = p_id and not interno for update;
  if not found then
    raise exception 'Ese método de pago no existe.';
  end if;
  if jsonb_typeof(p_datos) <> 'object' or (p_datos ? 'activo' and jsonb_typeof(p_datos -> 'activo') <> 'boolean')
     or (p_datos ? 'igtf' and jsonb_typeof(p_datos -> 'igtf') <> 'boolean')
     or (p_datos ? 'instrucciones' and (jsonb_typeof(p_datos -> 'instrucciones') <> 'string' or char_length(p_datos ->> 'instrucciones') > 1000)) then
    raise exception 'Datos del método inválidos (activo e IGTF: sí o no; instrucciones: hasta 1.000 caracteres).';
  end if;
  update tumbo.metodos_pago
  set activo = coalesce((p_datos ->> 'activo')::boolean, activo), igtf = coalesce((p_datos ->> 'igtf')::boolean, igtf),
      instrucciones = coalesce(trim(p_datos ->> 'instrucciones'), instrucciones), actualizado = now(), por = tumbo_privado.actor(yo)
  where id = m.id;
  perform tumbo_privado.auditar(yo, 'Método de pago cambiado', m.nombre || ': ' || left(p_datos::text, 400));
  return (select to_jsonb(x) from tumbo.metodos_pago x where x.id = m.id);
end $$;

-- ---------------------------------------------------------------------------
-- Cuentas de liquidación de los sellers
-- ---------------------------------------------------------------------------
-- Aviso fuera de la app (correo y WhatsApp de la bandeja de salida) a las
-- personas dueñas del comercio de cada cambio en su cuenta de liquidación:
-- la espera de 48 horas sirve para que el dueño note un cambio que no hizo.
insert into tumbo.plantillas (clave, canal, asunto, cuerpo) values
  ('cuenta_liquidacion', 'correo', 'Cambio en la cuenta donde cobra {{comercio}}',
   E'Hola, {{nombre}}:\n\n{{detalle}}\n\nSi no fuiste tú, entra a Tumbo Seller Center, anula el cambio antes de que rija y escríbele a soporte.\n\n{{enlace}}'),
  ('cuenta_liquidacion', 'whatsapp', '',
   'Tumbo Seller Center: {{detalle}} Si no fuiste tú, anúlalo en {{enlace}} y escríbele a soporte.')
on conflict (clave, canal) do nothing;

create function tumbo_privado.avisar_cuenta_liquidacion(c tumbo.cuentas_liquidacion, p_detalle text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u record;
begin
  for u in select id from tumbo.usuarios where seller_id = c.seller_id and rol = 'seller' and activo loop
    perform tumbo_privado.encolar(u.id, 'cuenta_liquidacion', jsonb_build_object(
      'comercio', (select nombre from tumbo.sellers where id = c.seller_id), 'detalle', p_detalle,
      'enlace', 'app/seller/finanzas.html'));
  end loop;
  perform tumbo_privado.notificar('seller:' || c.seller_id, p_detalle, 'account_balance', 'seller/finanzas.html');
end $$;

-- El seller principal ve las de su comercio; Finanzas, todas. Las cuentas de
-- prueba solo ven completas las ficticias de la semilla.
create function public.tm_cuentas_liquidacion(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'superadmin', 'finanzas']);
begin
  return jsonb_build_object(
    'bancos', (select jsonb_agg(jsonb_build_object('codigo', b.codigo, 'nombre', b.nombre) order by b.nombre) from tumbo.bancos b),
    'cuentas', coalesce((
      select jsonb_agg(tumbo_privado.cuenta_json_para(c, yo) || jsonb_build_object(
               'seller_id', c.seller_id, 'seller', s.nombre, 'rif_comercio', k.rif,
               'vigente', c.id = (tumbo_privado.cuenta_vigente(c.seller_id)).id,
               'anulable', c.estado = 'pendiente' or (c.estado = 'verificada' and c.vigente_desde > now()),
               'verificada_por', case when yo.rol <> 'seller' then c.verificada_por end, 'creado_por', c.creado_por)
             order by c.seller_id, c.id desc)
      from tumbo.cuentas_liquidacion c join tumbo.sellers s on s.id = c.seller_id
      left join tumbo.sellers_kyc k on k.seller_id = c.seller_id
      where (yo.rol = 'seller' and c.seller_id = yo.seller_id)
         or (yo.rol <> 'seller' and (c.estado = 'pendiente' or c.creado > now() - interval '180 days' or c.estado = 'verificada'))), '[]'::jsonb));
end $$;

-- El seller principal registra la cuenta donde cobra (cuenta bancaria o
-- Pago Móvil) con sesión elevada (2FA). Queda pendiente hasta que Finanzas
-- la verifique; si ya tenía una verificada, la nueva rige 48 horas después
-- de registrarla. Las personas dueñas del comercio reciben el aviso por
-- correo y WhatsApp (bandeja de salida).
create function public.tm_cuenta_liquidacion_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  v_tipo text := p_datos ->> 'tipo';
  v_banco text := p_datos ->> 'banco';
  v_titular text := left(regexp_replace(trim(coalesce(p_datos ->> 'titular', '')), '[[:cntrl:]<>]+', '', 'g'), 120);
  v_rif text := tumbo_privado.documento(p_datos ->> 'rif');
  v_numero text := regexp_replace(coalesce(p_datos ->> 'numero', ''), '[^0-9]', '', 'g');
  v_tel text := tumbo_privado.telefono_movil(p_datos ->> 'telefono');
  v_id bigint;
  c tumbo.cuentas_liquidacion;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if v_tipo is null or v_tipo not in ('cuenta', 'pago_movil') then
    raise exception 'Elige si cobras por cuenta bancaria o por Pago Móvil.';
  end if;
  if not exists (select 1 from tumbo.bancos where codigo = v_banco) then
    raise exception 'Elige el banco.';
  end if;
  if char_length(v_titular) < 3 then
    raise exception 'Escribe el titular (la razón social del comercio).';
  end if;
  if v_rif is null then
    raise exception 'Escribe el RIF del titular (p. ej. J-12345678-9).';
  end if;
  if v_tipo = 'cuenta' and (v_numero !~ '^[0-9]{20}$' or left(v_numero, 4) <> v_banco) then
    raise exception 'El número de cuenta tiene 20 dígitos y empieza por el código del banco (%).', v_banco;
  end if;
  if v_tipo = 'cuenta' and coalesce(p_datos ->> 'tipo_cuenta', '') not in ('corriente', 'ahorro') then
    raise exception 'Indica si la cuenta es corriente o de ahorro.';
  end if;
  if v_tipo = 'pago_movil' and v_tel is null then
    raise exception 'Escribe el teléfono afiliado a Pago Móvil (p. ej. 0414-1234567).';
  end if;
  perform 1 from tumbo.sellers where id = yo.seller_id for update;
  if exists (select 1 from tumbo.cuentas_liquidacion where seller_id = yo.seller_id and estado = 'pendiente') then
    raise exception 'Ya tienes una cuenta esperando la verificación de Finanzas.';
  end if;
  if (select count(*) from tumbo.cuentas_liquidacion where seller_id = yo.seller_id and creado > now() - interval '30 days') >= 5 then
    raise exception 'Registraste muchas cuentas este mes: escríbele a soporte.';
  end if;
  insert into tumbo.cuentas_liquidacion (seller_id, tipo, banco, titular, rif, numero, tipo_cuenta, telefono, creado_por, creado_por_id)
  values (yo.seller_id, v_tipo, v_banco, v_titular, v_rif, case when v_tipo = 'cuenta' then v_numero end,
          case when v_tipo = 'cuenta' then p_datos ->> 'tipo_cuenta' end, case when v_tipo = 'pago_movil' then v_tel end,
          tumbo_privado.actor(yo), yo.id)
  returning * into c;
  v_id := c.id;
  perform tumbo_privado.notificar('rol:finanzas', 'Cuenta de liquidación de ' || yo.seller_id || ' por verificar', 'account_balance', 'admin/liquidaciones.html');
  perform tumbo_privado.avisar_cuenta_liquidacion(c,
    yo.nombre || ' registró una cuenta nueva para cobrar (' || (select nombre from tumbo.bancos where codigo = c.banco) || ' ' ||
    coalesce(tumbo_privado.enmascarar(c.numero), tumbo_privado.enmascarar(c.telefono)) || '). Queda pendiente de verificación' ||
    case when (tumbo_privado.cuenta_vigente(c.seller_id)).id is not null then ' y, si se verifica, rige 48 horas después de registrada.' else '.' end);
  perform tumbo_privado.auditar(yo, 'Cuenta de liquidación registrada', yo.seller_id || ' · ' || v_tipo || ' ' || v_banco || ' · ' || v_rif);
  return tumbo_privado.cuenta_json(c);
end $$;

-- Finanzas verifica la cuenta (con sesión elevada: decide a dónde va el
-- dinero de un comercio): el RIF del titular debe ser el del comercio.
create function public.tm_cuenta_liquidacion_verificar(p_sesion text, p_id bigint, p_aprobar boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  c tumbo.cuentas_liquidacion;
  v_rif text;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
  v_desde timestamptz;
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into c from tumbo.cuentas_liquidacion where id = p_id for update;
  if not found or c.estado <> 'pendiente' then
    raise exception 'Esa cuenta ya no está esperando verificación.';
  end if;
  if p_aprobar is null then
    raise exception 'Indica si la cuenta se verifica o se rechaza.';
  end if;
  if not p_aprobar then
    if v_motivo is null then
      raise exception 'Indica el motivo del rechazo (el seller lo verá).';
    end if;
    update tumbo.cuentas_liquidacion set estado = 'rechazada', motivo = v_motivo, verificada_por = tumbo_privado.actor(yo), verificada_el = now()
    where id = c.id;
    perform tumbo_privado.notificar('seller:' || c.seller_id, 'Tu cuenta de liquidación no se verificó: ' || v_motivo, 'account_balance', 'seller/finanzas.html');
    perform tumbo_privado.auditar(yo, 'Cuenta de liquidación rechazada', c.seller_id || ' · ' || v_motivo);
  else
    select tumbo_privado.documento(k.rif) into v_rif from tumbo.sellers_kyc k where k.seller_id = c.seller_id;
    if v_rif is null or v_rif <> c.rif then
      raise exception 'El titular de la cuenta (%) no es el RIF del comercio (%): no se puede verificar.', c.rif, coalesce(v_rif, 'sin RIF');
    end if;
    v_desde := case when (tumbo_privado.cuenta_vigente(c.seller_id)).id is not null
                    then greatest(now(), c.creado + interval '48 hours') else now() end;
    update tumbo.cuentas_liquidacion set estado = 'verificada', vigente_desde = v_desde, motivo = null,
      verificada_por = tumbo_privado.actor(yo), verificada_el = now()
    where id = c.id;
    perform tumbo_privado.avisar_cuenta_liquidacion(c,
      'Finanzas verificó la cuenta nueva donde cobra tu comercio (' || (select nombre from tumbo.bancos where codigo = c.banco) || ' ' ||
      coalesce(tumbo_privado.enmascarar(c.numero), tumbo_privado.enmascarar(c.telefono)) || '): rige desde el ' || tumbo_privado.fecha_caracas(v_desde) || '.');
    perform tumbo_privado.auditar(yo, 'Cuenta de liquidación verificada', c.seller_id || ' · ' || c.banco || ' · rige ' || tumbo_privado.fecha_caracas(v_desde));
  end if;
  return tumbo_privado.cuenta_json_para((select x from tumbo.cuentas_liquidacion x where x.id = c.id), yo);
end $$;

-- El seller principal anula (con sesión elevada) una cuenta que todavía no
-- rige: pendiente de verificación o verificada dentro de sus 48 horas de
-- espera. Las liquidaciones siguen yendo a la cuenta vigente.
create function public.tm_cuenta_liquidacion_anular(p_sesion text, p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  c tumbo.cuentas_liquidacion;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into c from tumbo.cuentas_liquidacion where id = p_id and seller_id = yo.seller_id for update;
  if not found then
    raise exception 'No encontramos esa cuenta.';
  end if;
  if not (c.estado = 'pendiente' or (c.estado = 'verificada' and c.vigente_desde > now())) then
    raise exception 'Esa cuenta ya rige o ya no está activa: para cambiarla registra otra.';
  end if;
  update tumbo.cuentas_liquidacion set estado = 'anulada', motivo = coalesce(v_motivo, 'Anulada por el comercio') where id = c.id;
  perform tumbo_privado.notificar('rol:finanzas', 'El comercio ' || c.seller_id || ' anuló una cuenta de liquidación que aún no regía', 'account_balance',
                                  'admin/liquidaciones.html');
  perform tumbo_privado.avisar_cuenta_liquidacion(c,
    yo.nombre || ' anuló la cuenta nueva (' || (select nombre from tumbo.bancos where codigo = c.banco) || ' ' ||
    coalesce(tumbo_privado.enmascarar(c.numero), tumbo_privado.enmascarar(c.telefono)) || '): se sigue cobrando en la cuenta vigente.');
  perform tumbo_privado.auditar(yo, 'Cuenta de liquidación anulada', c.seller_id || ' · #' || c.id || coalesce(' · ' || v_motivo, ''));
  return tumbo_privado.cuenta_json((select x from tumbo.cuentas_liquidacion x where x.id = c.id));
end $$;

-- ---------------------------------------------------------------------------
-- Liquidaciones: preparada → aprobada (otra persona) → pagada / fallida
-- ---------------------------------------------------------------------------
-- ¿Entra el pedido en una corrida? Elegible, sin corrida y con su pago
-- verificado (o de antes de la ola 1).
create function tumbo_privado.pedido_liquidable(x tumbo.pedidos) returns boolean
language sql stable security definer set search_path = '' as $$
  select x.liquidacion = 'elegible' and x.liquidacion_id is null
     and (x.pago_id is null or exists (select 1 from tumbo.pagos g where g.id = x.pago_id and g.estado = 'verificado'))
$$;

-- Lo que cobra el seller por un pedido: base (productos menos sus
-- descuentos), envío (la regla por omisión: el seller paga la guía y recibe
-- el envío cobrado), comisión (con el % guardado al vender) y tarifa.
create function tumbo_privado.liquidacion_pedido(x tumbo.pedidos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg tumbo.config;
  m jsonb := tumbo_privado.montos_pedido(x);
  v_env_seller boolean := coalesce((tumbo_privado.ajuste('liquidaciones') ->> 'envio_al_seller')::boolean, true);
  v_base numeric;
  v_com numeric;
  v_tar numeric;
  v_env numeric;
begin
  select * into cfg from tumbo.config;
  v_base := (m ->> 'base_seller')::numeric;
  v_com := round(v_base * coalesce(x.comision_pct, cfg.comision_pct) / 100, 2);
  v_tar := coalesce(x.tarifa_usd, cfg.tarifa_fija_usd);
  v_env := case when v_env_seller then x.costo_envio_usd else 0 end;
  return jsonb_build_object('id', x.id, 'base', v_base, 'envio', v_env, 'comision', v_com, 'tarifa', v_tar,
                            'comision_pct', coalesce(x.comision_pct, cfg.comision_pct), 'neto', v_base + v_env - v_com - v_tar,
                            'tasa', x.tasa);
end $$;

-- Prepara una corrida con exactamente los pedidos mostrados (más los
-- ajustes pendientes del seller). p_yo nulo: la prepara el calendario.
create function tumbo_privado.preparar_liquidacion(p_seller text, p_pedidos text[], p_yo tumbo.usuarios) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ids text[];
  v_ret text;
  x tumbo.pedidos;
  l jsonb;
  v_bruto numeric := 0; v_env numeric := 0; v_com numeric := 0; v_tar numeric := 0; v_aj numeric := 0;
  v_aj_ids bigint[];
  v_neto numeric;
  v_num bigint;
  v_id text;
  v_cpr text;
begin
  if p_pedidos is null or coalesce(array_ndims(p_pedidos), 0) <> 1 or cardinality(p_pedidos) > 1000 then
    raise exception 'Indica los pedidos de la corrida.';
  end if;
  v_ret := tumbo_privado.retencion_seller(p_seller);
  if v_ret is not null then
    raise exception 'Los fondos de % están retenidos (%): no se liquidan hasta levantar la retención.', p_seller, v_ret;
  end if;
  perform 1 from tumbo.sellers where id = p_seller for update;
  select array_agg(id order by id) into v_ids
  from (select q.id from tumbo.pedidos q
        where q.seller_id = p_seller and q.id = any (p_pedidos) and tumbo_privado.pedido_liquidable(q)
        order by q.id for update) e;
  if v_ids is null then
    raise exception 'No hay pedidos elegibles para este seller.';
  end if;
  if cardinality(v_ids) <> (select count(distinct y) from unnest(p_pedidos) y) then
    raise exception 'La corrida cambió (algún pedido ya no está elegible): recarga la página y revísala.';
  end if;
  for x in select * from tumbo.pedidos where id = any (v_ids) order by id loop
    l := tumbo_privado.liquidacion_pedido(x);
    v_bruto := v_bruto + (l ->> 'base')::numeric;
    v_env := v_env + (l ->> 'envio')::numeric;
    v_com := v_com + (l ->> 'comision')::numeric;
    v_tar := v_tar + (l ->> 'tarifa')::numeric;
  end loop;
  select coalesce(array_agg(id order by id), '{}'), coalesce(sum(monto_usd), 0) into v_aj_ids, v_aj
  from (select id, monto_usd from tumbo.ajustes_seller where seller_id = p_seller and liquidacion_id is null order by id for update) a;
  v_neto := v_bruto + v_env + v_aj - v_com - v_tar;
  if v_neto <= 0 then
    raise exception 'El neto sería % : acumula más pedidos antes de liquidar.', tumbo_privado.fmt_usd(v_neto);
  end if;
  v_num := nextval('tumbo_privado.seq_liquidacion');
  v_id := 'LIQ-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(v_num, 3);
  v_cpr := 'CPR-' || to_char(now() at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(v_num, 3);
  insert into tumbo.liquidaciones (id, seller_id, periodo, pedidos, bruto_usd, comision_usd, tarifa_usd, neto_usd, estado, fecha,
                                   comprobante, ciclo, envio_usd, ajustes_usd, ajuste_ids, preparada_el)
  values (v_id, p_seller, 'hasta ' || to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY'), v_ids, v_bruto, v_com, v_tar, v_neto,
          'pendiente', tumbo_privado.hoy_caracas(), v_cpr, 'preparada', v_env, v_aj, v_aj_ids, now());
  update tumbo.pedidos set liquidacion_id = v_id where id = any (v_ids);
  update tumbo.ajustes_seller set liquidacion_id = v_id where id = any (v_aj_ids);
  perform tumbo_privado.liquidacion_evento(v_id, p_yo, 'preparar', null);
  perform tumbo_privado.notificar('rol:finanzas', 'Corrida ' || v_id || ' de ' || p_seller || ' preparada (' || tumbo_privado.fmt_usd(v_neto) ||
                                  '): la aprueba otra persona', 'receipt_long', 'admin/liquidaciones.html');
  perform tumbo_privado.auditar(p_yo, 'Liquidación preparada', v_id || ' → ' || p_seller || ' · ' || tumbo_privado.fmt_usd(v_neto) ||
                                ' · ' || cardinality(v_ids) || ' pedidos');
  return jsonb_build_object('id', v_id, 'netoUsd', v_neto, 'comprobante', v_cpr, 'ciclo', 'preparada');
end $$;

-- Ejecutar liquidación (desde la migración 5): ahora PREPARA la corrida con
-- exactamente los pedidos mostrados; la aprueba otra persona y después se
-- paga con su referencia (tm_liquidacion_aprobar / tm_liquidacion_pagar).
create or replace function public.tm_ejecutar_liquidacion(p_sesion text, p_seller text, p_pedidos text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
begin
  -- el dinero de un comercio real: sesión elevada
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.seller_real(p_seller));
  return tumbo_privado.preparar_liquidacion(p_seller, p_pedidos, yo);
end $$;

-- Aprobar: la segunda firma. La da otra persona que quien preparó la
-- corrida y que quien registró cualquiera de sus ajustes manuales (así
-- cada ajuste también tiene dos firmas, también en las corridas que prepara
-- el calendario). Un comercio real exige sesión elevada.
create function public.tm_liquidacion_aprobar(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  l tumbo.liquidaciones;
  v_ret text;
begin
  select * into l from tumbo.liquidaciones where id = p_id for update;
  if not found then
    raise exception 'Liquidación % no encontrada.', p_id;
  end if;
  if l.ciclo is distinct from 'preparada' then
    raise exception 'Solo se aprueba una corrida preparada.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.seller_real(l.seller_id));
  if exists (select 1 from tumbo.liquidacion_eventos e where e.liquidacion_id = l.id and e.accion = 'preparar' and e.usuario_id = yo.id) then
    raise exception 'La aprueba otra persona: tú preparaste esta corrida.';
  end if;
  if exists (select 1 from tumbo.ajustes_seller a where a.id = any (l.ajuste_ids) and a.por_id = yo.id) then
    raise exception 'La aprueba otra persona: tú registraste un ajuste que va en esta corrida.';
  end if;
  v_ret := tumbo_privado.retencion_seller(l.seller_id);
  if v_ret is not null then
    raise exception 'Los fondos de % están retenidos (%): anula la corrida o levanta la retención.', l.seller_id, v_ret;
  end if;
  update tumbo.liquidaciones set ciclo = 'aprobada', aprobada_el = now() where id = l.id;
  perform tumbo_privado.liquidacion_evento(l.id, yo, 'aprobar', null);
  perform tumbo_privado.auditar(yo, 'Liquidación aprobada', l.id || ' → ' || l.seller_id || ' · ' || tumbo_privado.fmt_usd(l.neto_usd));
  return jsonb_build_object('id', l.id, 'ciclo', 'aprobada');
end $$;

-- Pagar: con la referencia de la transferencia (y, si se quiere, el
-- comprobante subido con TM.archivos, propósito «liquidacion»). Se paga en
-- Bs. a la tasa del día (USD de referencia), se guardan la tasa, la cuenta
-- usada (enmascarada: la completa sigue en tumbo.cuentas_liquidacion) y el
-- diferencial cambiario contra la tasa de cada venta.
create function public.tm_liquidacion_pagar(p_sesion text, p_id text, p_referencia text, p_comprobante uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
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

-- El banco rechazó la transferencia: la corrida queda fallida (se puede
-- volver a pagar o anular).
create function public.tm_liquidacion_fallar(p_sesion text, p_id text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  l tumbo.liquidaciones;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  select * into l from tumbo.liquidaciones where id = p_id for update;
  if not found or l.ciclo is distinct from 'aprobada' then
    raise exception 'Solo falla una corrida aprobada.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.seller_real(l.seller_id));
  if v_motivo is null then
    raise exception 'Indica qué pasó con la transferencia.';
  end if;
  update tumbo.liquidaciones set ciclo = 'fallida', motivo = v_motivo where id = l.id;
  perform tumbo_privado.liquidacion_evento(l.id, yo, 'fallar', v_motivo);
  perform tumbo_privado.auditar(yo, 'Liquidación fallida', l.id || ' · ' || v_motivo);
  return jsonb_build_object('id', l.id, 'ciclo', 'fallida');
end $$;

-- Anular una corrida no pagada: sus pedidos y ajustes vuelven a quedar
-- disponibles para la siguiente.
create function public.tm_liquidacion_anular(p_sesion text, p_id text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  l tumbo.liquidaciones;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  select * into l from tumbo.liquidaciones where id = p_id for update;
  if not found or l.ciclo is null or l.ciclo not in ('preparada', 'aprobada', 'fallida') then
    raise exception 'Solo se anula una corrida que no se ha pagado.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.seller_real(l.seller_id));
  if v_motivo is null then
    raise exception 'Indica por qué se anula la corrida.';
  end if;
  update tumbo.liquidaciones set ciclo = 'anulada', motivo = v_motivo where id = l.id;
  update tumbo.pedidos set liquidacion_id = null where liquidacion_id = l.id and liquidacion = 'elegible';
  update tumbo.ajustes_seller set liquidacion_id = null where liquidacion_id = l.id;
  perform tumbo_privado.liquidacion_evento(l.id, yo, 'anular', v_motivo);
  perform tumbo_privado.auditar(yo, 'Liquidación anulada', l.id || ' · ' || v_motivo);
  return jsonb_build_object('id', l.id, 'ciclo', 'anulada');
end $$;

-- Lo que Finanzas necesita para liquidar: las corridas por preparar (por
-- seller, con su retención y su cuenta), las corridas en curso con quién
-- las preparó y aprobó, las cuentas por verificar y el historial.
create function public.tm_liquidaciones_corridas(p_sesion text) returns jsonb
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
      select jsonb_agg(tumbo_privado.cuenta_json_para(c, yo) || jsonb_build_object('seller_id', c.seller_id, 'seller', s.nombre, 'rif_comercio', k.rif,
                                                                          'creado_por', c.creado_por) order by c.id)
      from tumbo.cuentas_liquidacion c join tumbo.sellers s on s.id = c.seller_id left join tumbo.sellers_kyc k on k.seller_id = c.seller_id
      where c.estado = 'pendiente'), '[]'::jsonb),
    'retenciones', coalesce((select jsonb_agg(to_jsonb(r) order by r.desde) from tumbo.retenciones r), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'estado', s.estado,
                                                             'retencion', tumbo_privado.retencion_seller(s.id),
                                                             'bloqueado', tumbo_privado.cuenta_demo(yo.email) and tumbo_privado.seller_real(s.id)) order by s.id)
                         from tumbo.sellers s), '[]'::jsonb));
end $$;

-- Lote para el banco: las corridas aprobadas con la cuenta de cada seller y
-- el monto en Bs. a la tasa de hoy (formato genérico; cada banco tiene el
-- suyo para la carga masiva). Las cuentas de prueba la reciben enmascarada
-- salvo las ficticias de la semilla (marcadas «ficticia»).
create function public.tm_liquidaciones_lote(p_sesion text, p_ids text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  cfg tumbo.config;
  v jsonb;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'Elige las corridas aprobadas del lote.';
  end if;
  select * into cfg from tumbo.config;
  select coalesce(jsonb_agg(jsonb_build_object(
           'liquidacion', l.id, 'seller', l.seller_id, 'comercio', s.nombre,
           'cuenta', tumbo_privado.cuenta_json_para(tumbo_privado.cuenta_vigente(l.seller_id), yo),
           'monto_usd', l.neto_usd, 'tasa', cfg.tasa, 'monto_bs', round(l.neto_usd * cfg.tasa, 2),
           'concepto', 'Liquidación ' || l.id || ' Tumbo Market') order by l.id), '[]'::jsonb)
    into v
  from tumbo.liquidaciones l join tumbo.sellers s on s.id = l.seller_id
  where l.id = any (p_ids) and l.ciclo = 'aprobada';
  if jsonb_array_length(v) = 0 then
    raise exception 'Ninguna de esas corridas está aprobada.';
  end if;
  if exists (select 1 from jsonb_array_elements(v) e where e -> 'cuenta' = 'null'::jsonb or e -> 'cuenta' is null) then
    raise exception 'Algún seller del lote no tiene cuenta de liquidación verificada y vigente.';
  end if;
  perform tumbo_privado.auditar(yo, 'Lote de pago exportado', jsonb_array_length(v) || ' corridas: ' ||
    (select string_agg(e ->> 'liquidacion', ', ') from jsonb_array_elements(v) e));
  return v;
end $$;

-- Ajuste manual al saldo de un seller (a favor o en contra), con motivo:
-- entra en su próxima corrida, que aprueba otra persona (segunda firma del
-- ajuste). Queda en el libro mayor y en la auditoría. A un comercio real,
-- con sesión elevada.
create function public.tm_ajuste_seller(p_sesion text, p_seller text, p_monto_usd numeric, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
  v_monto numeric := round(coalesce(p_monto_usd, 0), 2);
  v_id bigint;
begin
  if not exists (select 1 from tumbo.sellers where id = p_seller) then
    raise exception 'Seller % no encontrado.', p_seller;
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.seller_real(p_seller));
  if v_monto = 0 or abs(v_monto) > 100000 then
    raise exception 'El ajuste va de -100.000 a 100.000 USD y no puede ser cero.';
  end if;
  if v_motivo is null or char_length(v_motivo) < 5 then
    raise exception 'Explica el motivo del ajuste (el seller lo verá en su estado de cuenta).';
  end if;
  if (select count(*) from tumbo.ajustes_seller where por_id = yo.id and creado > now() - interval '1 hour') >= 30 then
    raise exception 'Hiciste muchos ajustes en la última hora: espera un poco.';
  end if;
  insert into tumbo.ajustes_seller (seller_id, monto_usd, motivo, por_id, por)
  values (p_seller, v_monto, v_motivo, yo.id, tumbo_privado.actor(yo))
  returning id into v_id;
  perform tumbo_privado.asentar('ajuste', 'AJ-' || v_id, 'Ajuste a ' || p_seller || ': ' || v_motivo, tumbo_privado.actor(yo),
    jsonb_build_array(jsonb_build_object('cuenta', 'ajustes_seller', 'debe', v_monto),
                      jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', p_seller, 'haber', v_monto)));
  perform tumbo_privado.notificar('seller:' || p_seller, 'Ajuste de ' || tumbo_privado.fmt_usd(v_monto) || ' a tu saldo: ' || v_motivo,
                                  'receipt_long', 'seller/finanzas.html');
  perform tumbo_privado.auditar(yo, 'Ajuste al seller', 'AJ-' || v_id || ' · ' || p_seller || ' · ' || tumbo_privado.fmt_usd(v_monto) || ' · ' || v_motivo);
  return jsonb_build_object('id', v_id, 'monto_usd', v_monto);
end $$;

-- Retener (o liberar) a mano los fondos de un seller (un comercio real, con
-- sesión elevada).
create function public.tm_retencion_seller(p_sesion text, p_seller text, p_retener boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas']);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  if not exists (select 1 from tumbo.sellers where id = p_seller) then
    raise exception 'Seller % no encontrado.', p_seller;
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.seller_real(p_seller));
  if p_retener is null then
    raise exception 'Indica si se retiene o se libera.';
  end if;
  if v_motivo is null then
    raise exception 'Indica el motivo.';
  end if;
  if p_retener then
    insert into tumbo.retenciones (seller_id, motivo, por) values (p_seller, v_motivo, tumbo_privado.actor(yo))
    on conflict (seller_id) do update set motivo = excluded.motivo, por = excluded.por, desde = now();
    perform tumbo_privado.notificar('seller:' || p_seller, 'Tus liquidaciones quedaron retenidas: ' || v_motivo, 'lock', 'seller/finanzas.html');
  else
    delete from tumbo.retenciones where seller_id = p_seller;
    perform tumbo_privado.notificar('seller:' || p_seller, 'Se levantó la retención de tus liquidaciones', 'lock_open', 'seller/finanzas.html');
  end if;
  perform tumbo_privado.auditar(yo, case when p_retener then 'Fondos retenidos' else 'Retención levantada' end, p_seller || ' · ' || v_motivo);
  return jsonb_build_object('seller', p_seller, 'retencion', tumbo_privado.retencion_seller(p_seller));
end $$;

-- Calendario semanal (tarea programada): prepara la corrida de cada seller
-- con fondos elegibles que no esté retenido.
create function tumbo_privado.tarea_liquidaciones() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v jsonb;
  v_hechas text[] := '{}';
  v_omitidas text[] := '{}';
begin
  for s in
    select q.seller_id, array_agg(q.id order by q.id) as pedidos
    from tumbo.pedidos q where tumbo_privado.pedido_liquidable(q) group by q.seller_id order by q.seller_id
  loop
    if tumbo_privado.retencion_seller(s.seller_id) is not null then
      v_omitidas := v_omitidas || (s.seller_id || ' (retenido)');
      continue;
    end if;
    begin
      v := tumbo_privado.preparar_liquidacion(s.seller_id, s.pedidos, null::tumbo.usuarios);
      v_hechas := v_hechas || (v ->> 'id');
    exception when others then
      v_omitidas := v_omitidas || (s.seller_id || ' (' || left(sqlerrm, 80) || ')');
    end;
  end loop;
  if cardinality(v_hechas) + cardinality(v_omitidas) > 0 then
    perform tumbo_privado.notificar('rol:finanzas', 'Calendario semanal: ' || cardinality(v_hechas) || ' corridas preparadas' ||
      case when cardinality(v_omitidas) > 0 then ', ' || cardinality(v_omitidas) || ' omitidas' else '' end, 'event', 'admin/liquidaciones.html');
  end if;
  return jsonb_build_object('preparadas', to_jsonb(v_hechas), 'omitidas', to_jsonb(v_omitidas));
end $$;

-- ---------------------------------------------------------------------------
-- Libro mayor, cierre diario y panel financiero
-- ---------------------------------------------------------------------------
-- Cierre de un día (por omisión, ayer en Caracas): suma el debe y el haber
-- de sus asientos, cuenta los que no cuadran y lo guarda; si no cuadra,
-- avisa a Finanzas. Repetirlo recalcula el día. De paso borra los
-- movimientos del banco ignorados (no eran de Tumbo) de más de 400 días: la
-- importación ya no admite fechas tan viejas, así que no se repiten.
create function tumbo_privado.tarea_cierre_diario(p_fecha date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_fecha date := coalesce(p_fecha, tumbo_privado.hoy_caracas() - 1);
  v_n integer;
  v_debe numeric;
  v_haber numeric;
  v_malos integer;
  v_detalle jsonb;
  v_cuadra boolean;
  v_purgados integer;
begin
  delete from tumbo.movimientos_banco where estado = 'ignorado' and fecha < tumbo_privado.hoy_caracas() - 400;
  get diagnostics v_purgados = row_count;
  select count(distinct a.id), coalesce(sum(l.debe), 0), coalesce(sum(l.haber), 0) into v_n, v_debe, v_haber
  from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
  where (a.fecha at time zone 'America/Caracas')::date = v_fecha;
  select count(*) into v_malos from (
    select a.id from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
    where (a.fecha at time zone 'America/Caracas')::date = v_fecha group by a.id having sum(l.debe) <> sum(l.haber)) x;
  select coalesce(jsonb_object_agg(x.cuenta, jsonb_build_object('debe', x.debe, 'haber', x.haber)), '{}'::jsonb) into v_detalle
  from (select l.cuenta, sum(l.debe) as debe, sum(l.haber) as haber
        from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
        where (a.fecha at time zone 'America/Caracas')::date = v_fecha group by l.cuenta) x;
  v_cuadra := v_debe = v_haber and v_malos = 0;
  insert into tumbo.cierres (fecha, asientos, debe, haber, descuadrados, cuadra, detalle)
  values (v_fecha, v_n, v_debe, v_haber, v_malos, v_cuadra, v_detalle)
  on conflict (fecha) do update set asientos = excluded.asientos, debe = excluded.debe, haber = excluded.haber,
    descuadrados = excluded.descuadrados, cuadra = excluded.cuadra, detalle = excluded.detalle, creado = now();
  if not v_cuadra then
    perform tumbo_privado.notificar('rol:finanzas', 'El cierre del ' || to_char(v_fecha, 'DD/MM/YYYY') || ' no cuadra: revisa el libro mayor',
                                    'error', 'admin/finanzas.html');
  end if;
  return jsonb_build_object('fecha', v_fecha, 'asientos', v_n, 'debe', v_debe, 'haber', v_haber, 'cuadra', v_cuadra,
                            'movimientos_purgados', v_purgados);
end $$;

-- El libro mayor: saldos por cuenta y por seller (hasta p_hasta), el
-- movimiento del período, los últimos asientos con sus líneas y los cierres.
create function public.tm_libro_mayor(p_sesion text, p_desde date, p_hasta date) returns jsonb
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
    'cuentas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', x.cuenta, 'debe', x.debe, 'haber', x.haber, 'saldo', x.debe - x.haber,
                                          'debe_periodo', x.debe_p, 'haber_periodo', x.haber_p) order by x.cuenta)
      from (select l.cuenta, sum(l.debe) as debe, sum(l.haber) as haber,
                   sum(l.debe) filter (where (a.fecha at time zone 'America/Caracas')::date >= v_desde) as debe_p,
                   sum(l.haber) filter (where (a.fecha at time zone 'America/Caracas')::date >= v_desde) as haber_p
            from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
            where (a.fecha at time zone 'America/Caracas')::date <= v_hasta group by l.cuenta) x), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object('seller_id', x.seller_id, 'seller', s.nombre, 'por_pagar', x.saldo) order by x.seller_id)
      from (select l.seller_id, sum(l.haber) - sum(l.debe) as saldo
            from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
            where l.cuenta = 'por_pagar_seller' and (a.fecha at time zone 'America/Caracas')::date <= v_hasta group by l.seller_id) x
      left join tumbo.sellers s on s.id = x.seller_id), '[]'::jsonb),
    'totales', (select jsonb_build_object('debe', coalesce(sum(l.debe), 0), 'haber', coalesce(sum(l.haber), 0))
                from tumbo.asiento_lineas l join tumbo.asientos a on a.id = l.asiento_id
                where (a.fecha at time zone 'America/Caracas')::date <= v_hasta),
    'asientos', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'fecha', a.fecha, 'evento', a.evento, 'referencia', a.referencia,
                                          'descripcion', a.descripcion, 'actor', a.actor,
                                          'lineas', (select jsonb_agg(jsonb_build_object('cuenta', l.cuenta, 'seller', l.seller_id, 'debe', l.debe, 'haber', l.haber) order by l.id)
                                                     from tumbo.asiento_lineas l where l.asiento_id = a.id)) order by a.id desc)
      from (select * from tumbo.asientos x
            where (x.fecha at time zone 'America/Caracas')::date between v_desde and v_hasta order by x.id desc limit 200) a), '[]'::jsonb),
    'cierres', coalesce((select jsonb_agg(to_jsonb(c) order by c.fecha desc) from (select * from tumbo.cierres order by fecha desc limit 30) c), '[]'::jsonb));
end $$;

-- El panel financiero: cobrado en el período, por verificar, retenido,
-- congelado, por liquidar, reembolsos pendientes, excepciones, tasa,
-- comisiones e IGTF del período.
create function public.tm_finanzas_resumen(p_sesion text, p_desde date, p_hasta date) returns jsonb
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

-- Libro de ventas (para el contador): una fila por pedido con su pago
-- verificado en el período. Los datos fiscales salen del pago; a una cuenta
-- de prueba, los de una persona real llegan ocultos.
create function tumbo_privado.libro_ventas(p_seller text, p_desde date, p_hasta date, p_yo tumbo.usuarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'columnas', jsonb_build_array('Fecha', 'Pedido', 'Pago', 'Comercio', 'RIF comercio', 'Documento comprador', 'Comprador',
                                  'Productos USD', 'Descuentos USD', 'Exento USD', 'Base imponible USD', 'IVA USD', 'Envío USD',
                                  'IGTF USD', 'Total USD', 'Tasa', 'Total Bs', 'Estado'),
    'filas', coalesce(jsonb_agg(jsonb_build_array(
               to_char(g.verificado_el at time zone 'America/Caracas', 'DD/MM/YYYY'), x.id, g.id, s.nombre, k.rif,
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

-- Exportaciones por período (el navegador arma el CSV): pagos,
-- conciliaciones, liquidaciones, comisiones, reembolsos, libro de ventas y
-- asientos. El seller principal exporta su libro de ventas y sus
-- liquidaciones.
create function public.tm_finanzas_exportar(p_sesion text, p_tipo text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas', 'seller']);
  v_hasta date := coalesce(p_hasta, tumbo_privado.hoy_caracas());
  v_desde date := coalesce(p_desde, v_hasta - 30);
  v_seller text := case when yo.rol = 'seller' then yo.seller_id end;
  v jsonb;
begin
  if v_desde > v_hasta or v_hasta - v_desde > 400 then
    raise exception 'Elige un período de hasta 400 días.';
  end if;
  if yo.rol = 'seller' and p_tipo not in ('libro_ventas', 'liquidaciones') then
    raise exception 'Tu rol no permite esta exportación.' using errcode = '42501';
  end if;
  if p_tipo = 'libro_ventas' then
    v := tumbo_privado.libro_ventas(v_seller, v_desde, v_hasta, yo);
  elsif p_tipo = 'pagos' then
    select jsonb_build_object('columnas', jsonb_build_array('Pago', 'Creado', 'Estado', 'Método', 'Moneda', 'Referencia', 'Fecha del pago',
                                                            'Subtotal USD', 'Descuento USD', 'Envío USD', 'IVA USD', 'IGTF USD', 'Crédito USD',
                                                            'Total USD', 'Tasa', 'Total Bs', 'Verificado', 'Verificado por', 'Pedidos', 'Tardío'),
      'filas', coalesce(jsonb_agg(jsonb_build_array(g.id, to_char(g.creado at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI'), g.estado, m.nombre,
                g.moneda, coalesce(g.referencia, ''), coalesce(to_char(g.fecha_pago, 'DD/MM/YYYY'), ''), g.subtotal_usd, g.descuento_usd,
                g.envio_usd, g.iva_usd, g.igtf_usd, g.credito_usd, g.total_usd, g.tasa, g.total_bs,
                coalesce(to_char(g.verificado_el at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI'), ''), coalesce(g.verificado_por, ''),
                (select string_agg(x.id, ' ' order by x.id) from tumbo.pedidos x where x.pago_id = g.id), case when g.tardio then 'sí' else '' end)
                order by g.creado, g.id), '[]'::jsonb))
      into v
    from tumbo.pagos g join tumbo.metodos_pago m on m.id = g.metodo
    where (g.creado at time zone 'America/Caracas')::date between v_desde and v_hasta;
  elsif p_tipo = 'conciliaciones' then
    select jsonb_build_object('columnas', jsonb_build_array('Movimiento', 'Banco', 'Fecha', 'Referencia', 'Monto Bs', 'Descripción', 'Estado',
                                                            'Excepción', 'Pago', 'Nota', 'Resuelto por', 'Importado'),
      'filas', coalesce(jsonb_agg(jsonb_build_array(mv.id, mv.banco, to_char(mv.fecha, 'DD/MM/YYYY'), mv.referencia, mv.monto, mv.descripcion,
                mv.estado, coalesce(mv.excepcion, ''), coalesce(mv.pago_id, ''), coalesce(mv.nota, ''), coalesce(mv.resuelto_por, ''),
                to_char(mv.creado at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI')) order by mv.fecha, mv.id), '[]'::jsonb))
      into v
    from tumbo.movimientos_banco mv where mv.fecha between v_desde and v_hasta;
  elsif p_tipo = 'liquidaciones' then
    select jsonb_build_object('columnas', jsonb_build_array('Liquidación', 'Comercio', 'Ciclo', 'Período', 'Pedidos', 'Bruto USD', 'Envío USD',
                                                            'Ajustes USD', 'Comisión USD', 'Tarifas USD', 'Neto USD', 'Tasa de pago', 'Neto Bs',
                                                            'Diferencial Bs', 'Referencia', 'Comprobante', 'Fecha'),
      'filas', coalesce(jsonb_agg(jsonb_build_array(l.id, l.seller_id, coalesce(l.ciclo, 'pagada'), l.periodo, array_to_string(l.pedidos, ' '),
                l.bruto_usd, l.envio_usd, l.ajustes_usd, l.comision_usd, l.tarifa_usd, l.neto_usd, l.tasa_pago, l.neto_bs, l.diferencial_bs,
                coalesce(l.referencia_pago, ''), l.comprobante, to_char(l.fecha, 'DD/MM/YYYY')) order by l.fecha, l.id), '[]'::jsonb))
      into v
    from tumbo.liquidaciones l where l.fecha between v_desde and v_hasta and (v_seller is null or l.seller_id = v_seller)
      and (v_seller is null or coalesce(l.ciclo, 'pagada') <> 'anulada');
  elsif p_tipo = 'comisiones' then
    select jsonb_build_object('columnas', jsonb_build_array('Pedido', 'Comercio', 'Liquidación', 'Fecha', 'Base USD', 'Comisión %', 'Comisión USD', 'Tarifa USD'),
      'filas', coalesce(jsonb_agg(jsonb_build_array(x.id, x.seller_id, l.id, to_char(l.fecha, 'DD/MM/YYYY'),
                (tumbo_privado.liquidacion_pedido(x) ->> 'base')::numeric, (tumbo_privado.liquidacion_pedido(x) ->> 'comision_pct')::numeric,
                (tumbo_privado.liquidacion_pedido(x) ->> 'comision')::numeric, (tumbo_privado.liquidacion_pedido(x) ->> 'tarifa')::numeric)
                order by l.fecha, x.id), '[]'::jsonb))
      into v
    from tumbo.liquidaciones l join tumbo.pedidos x on x.id = any (l.pedidos)
    where coalesce(l.ciclo, 'pagada') = 'pagada' and l.fecha between v_desde and v_hasta;
  elsif p_tipo = 'reembolsos' then
    select jsonb_build_object('columnas', jsonb_build_array('Reembolso', 'Pedido', 'Pago', 'Creado', 'Motivo', 'Monto USD', 'Estado', 'Destino',
                                                            'Moneda', 'Tasa de envío', 'Monto enviado', 'Referencia', 'Enviado'),
      'filas', coalesce(jsonb_agg(jsonb_build_array('R-' || r.id, r.pedido_id, coalesce(r.pago_id, ''),
                to_char(r.creado at time zone 'America/Caracas', 'DD/MM/YYYY'), r.motivo, r.monto_usd, r.estado,
                coalesce(r.destino ->> 'tipo', ''), coalesce(r.moneda_envio, ''), r.tasa_envio, r.monto_enviado, coalesce(r.referencia, ''),
                coalesce(to_char(r.enviado_el at time zone 'America/Caracas', 'DD/MM/YYYY'), '')) order by r.creado, r.id), '[]'::jsonb))
      into v
    from tumbo.reembolsos r where (r.creado at time zone 'America/Caracas')::date between v_desde and v_hasta;
  elsif p_tipo = 'asientos' then
    select jsonb_build_object('columnas', jsonb_build_array('Asiento', 'Fecha', 'Evento', 'Referencia', 'Descripción', 'Cuenta', 'Seller', 'Debe USD', 'Haber USD'),
      'filas', coalesce(jsonb_agg(jsonb_build_array(a.id, to_char(a.fecha at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI'), a.evento,
                a.referencia, a.descripcion, l.cuenta, coalesce(l.seller_id, ''), l.debe, l.haber) order by a.id, l.id), '[]'::jsonb))
      into v
    from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
    where (a.fecha at time zone 'America/Caracas')::date between v_desde and v_hasta;
  else
    raise exception 'Esa exportación no existe.';
  end if;
  if jsonb_array_length(v -> 'filas') > 20000 then
    raise exception 'Son demasiadas filas: elige un período más corto.';
  end if;
  return v || jsonb_build_object('tipo', p_tipo, 'desde', v_desde, 'hasta', v_hasta);
end $$;

-- Estado de cuenta del seller principal: saldo inicial, movimientos de su
-- cuenta por pagar en el período, saldo final, liquidaciones, ajustes
-- pendientes, cuenta vigente y retención.
create function public.tm_seller_estado_cuenta(p_sesion text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller']);
  v_hasta date := coalesce(p_hasta, tumbo_privado.hoy_caracas());
  v_desde date := coalesce(p_desde, date_trunc('month', v_hasta)::date);
  v_inicial numeric;
begin
  if v_desde > v_hasta or v_hasta - v_desde > 400 then
    raise exception 'Elige un período de hasta 400 días.';
  end if;
  select coalesce(sum(l.haber) - sum(l.debe), 0) into v_inicial
  from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
  where l.cuenta = 'por_pagar_seller' and l.seller_id = yo.seller_id and (a.fecha at time zone 'America/Caracas')::date < v_desde;
  return jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'comercio', (select jsonb_build_object('id', s.id, 'nombre', s.nombre, 'rif', k.rif, 'ciudad', s.ciudad)
                 from tumbo.sellers s left join tumbo.sellers_kyc k on k.seller_id = s.id where s.id = yo.seller_id),
    'saldo_inicial', v_inicial,
    'movimientos', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', y.fecha, 'evento', y.evento, 'referencia', y.referencia, 'descripcion', y.descripcion,
                                          'abono', y.haber, 'cargo', y.debe, 'saldo', y.saldo) order by y.fecha, y.id)
      from (select x.*, v_inicial + sum(x.haber - x.debe) over (order by x.fecha, x.id) as saldo
            from (select a.id, a.fecha, a.evento, a.referencia, a.descripcion, sum(l.debe) as debe, sum(l.haber) as haber
                  from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                  where l.cuenta = 'por_pagar_seller' and l.seller_id = yo.seller_id
                    and (a.fecha at time zone 'America/Caracas')::date between v_desde and v_hasta
                  group by a.id) x) y), '[]'::jsonb),
    'saldo_final', (select coalesce(sum(l.haber) - sum(l.debe), 0) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                    where l.cuenta = 'por_pagar_seller' and l.seller_id = yo.seller_id and (a.fecha at time zone 'America/Caracas')::date <= v_hasta),
    'ajustes_pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'monto_usd', j.monto_usd, 'motivo', j.motivo, 'creado', j.creado) order by j.id)
                                    from tumbo.ajustes_seller j where j.seller_id = yo.seller_id and j.liquidacion_id is null), '[]'::jsonb),
    'cuenta', tumbo_privado.cuenta_json_para(tumbo_privado.cuenta_vigente(yo.seller_id), yo),
    'retencion', tumbo_privado.retencion_seller(yo.seller_id),
    'comision_pct', (select comision_pct from tumbo.config), 'tarifa_usd', (select tarifa_fija_usd from tumbo.config),
    'envio_al_seller', coalesce((tumbo_privado.ajuste('liquidaciones') ->> 'envio_al_seller')::boolean, true));
end $$;

-- Recibo / nota de entrega de un pedido con su desglose. NO es una factura:
-- la factura con número de control necesita la imprenta digital autorizada
-- por el SENIAT. Lo ve el comprador (el suyo), el seller principal (los de
-- su comercio ya pagados, con los datos fiscales para su factura) y
-- Finanzas; a una cuenta de prueba, los datos de una persona real llegan
-- ocultos.
create function public.tm_pedido_recibo(p_sesion text, p_id text) returns jsonb
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
    'pedido', jsonb_build_object('id', x.id, 'creado', x.creado, 'estado', x.estado, 'envio_tipo', x.envio_tipo, 'envio_dir', x.envio_dir,
                                 'courier', x.courier, 'guia', x.guia, 'envio_dias', x.envio_dias, 'destino', x.destino),
    'items', coalesce((select jsonb_agg(jsonb_build_object('sku', i.sku, 'nombre', i.nombre, 'cant', i.cant, 'precio_usd', i.precio_usd,
                                                          'total_usd', i.precio_usd * i.cant, 'exento', tumbo_privado.iva_exento(i.sku)) order by i.sku)
                       from tumbo.pedido_items i where i.pedido_id = x.id), '[]'::jsonb),
    'montos', m || jsonb_build_object('exento', x.exento_usd, 'tasa', x.tasa,
                                      'total_bs', coalesce(x.monto_bs, round((m ->> 'pagado')::numeric * x.tasa, 2)),
                                      'iva_pct', tumbo_privado.numero(coalesce(tumbo_privado.ajuste('impuestos'), '{}'::jsonb) -> 'iva_pct', 16)),
    'comercio', (select jsonb_build_object('id', s.id, 'nombre', s.nombre, 'rif', k.rif, 'ciudad', s.ciudad)
                 from tumbo.sellers s left join tumbo.sellers_kyc k on k.seller_id = s.id where s.id = x.seller_id),
    'comprador', case when v_ve then (select jsonb_build_object('nombre', coalesce(g.fiscal ->> 'razon_social', u.nombre), 'documento', g.fiscal ->> 'documento')
                                      from tumbo.usuarios u where u.id = x.comprador_id)
                      else jsonb_build_object('nombre', 'Cuenta real (oculta a las cuentas de prueba)', 'documento', null, 'oculto', true) end,
    'pago', case when g.id is null then jsonb_build_object('metodo', x.metodo, 'referencia', nullif(x.ref, ''))
                 else jsonb_build_object('id', g.id, 'metodo', x.metodo, 'referencia', g.referencia, 'estado', g.estado,
                                         'verificado_el', g.verificado_el, 'moneda', g.moneda) end);
end $$;

-- ---------------------------------------------------------------------------
-- Semilla y reinicio de la demo
-- ---------------------------------------------------------------------------
-- Limpia lo de este dominio y siembra: un pago por cada pedido de la semilla
-- (verificado salvo el que espera conciliación), sus asientos en el libro
-- mayor (con su fecha), la liquidación sembrada con su ciclo, las cuentas
-- de liquidación (ficticias) de los sellers homologados y la tasa vigente
-- del historial (los pedidos conservan la suya).
create function tumbo_privado.sembrar_ext_pagos(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cfg tumbo.config;
  x tumbo.pedidos;
  t tumbo.tasas;
  v_pago text;
  v_n integer := 0;
  v_r jsonb;
  v_verif timestamptz;
  v_rif text;
  l tumbo.liquidaciones;
  v_iva_pct numeric := tumbo_privado.numero(coalesce(tumbo_privado.ajuste('impuestos'), '{}'::jsonb) -> 'iva_pct', 16);
  v_iva numeric;
  v_exento numeric;
begin
  perform set_config('tumbo.reinicio_libro', 'si', true);
  delete from tumbo.asiento_lineas where id is not null;
  delete from tumbo.asientos where id is not null;
  delete from tumbo.cierres where fecha is not null;
  delete from tumbo.movimientos_banco where id is not null;
  delete from tumbo.importaciones_banco where id is not null;
  delete from tumbo.reembolso_eventos where id is not null;
  delete from tumbo.reembolso_destinos where reembolso_id is not null;
  delete from tumbo.salida where plantilla = 'cuenta_liquidacion';
  delete from tumbo.liquidacion_eventos where id is not null;
  delete from tumbo.ajustes_seller where id is not null;
  delete from tumbo.retenciones where seller_id is not null;
  delete from tumbo.creditos where id is not null;
  delete from tumbo.cuentas_liquidacion where id is not null;
  delete from tumbo.pago_eventos where id is not null;
  update tumbo.pedidos set pago_id = null where pago_id is not null;
  delete from tumbo.pagos where id is not null;

  -- la tasa vigente del historial (la semilla base vuelve a la de la demo)
  select * into t from tumbo.tasas where estado = 'aplicada' order by aplicada_el desc nulls last, id desc limit 1;
  if found then
    update tumbo.config set tasa = t.valor where id;
  end if;
  select * into cfg from tumbo.config;

  for x in select * from tumbo.pedidos where pago_id is null order by creado, id loop
    v_n := v_n + 1;
    v_pago := 'PAG-' || to_char(x.creado at time zone 'America/Caracas', 'YYYY') || '-' || tumbo_privado.folio(v_n, 5);
    v_r := tumbo_privado.referencia_pago(case x.metodo when 'Transferencia' then 'transferencia' else 'pago_movil' end, x.ref);
    v_verif := case when x.estado = 'pago_por_verificar' then null else x.creado + interval '50 minutes' end;
    -- IVA incluido (informativo) y exento, como en el checkout
    select coalesce(sum(i.precio_usd * i.cant) filter (where tumbo_privado.iva_exento(i.sku)), 0),
           round(coalesce(sum(i.precio_usd * i.cant) filter (where not tumbo_privado.iva_exento(i.sku)), 0) * v_iva_pct / (100 + v_iva_pct), 2)
      into v_exento, v_iva
    from tumbo.pedido_items i where i.pedido_id = x.id;
    insert into tumbo.pagos (id, comprador_id, metodo, moneda, estado, subtotal_usd, envio_usd, iva_usd, total_usd, tasa, total_bs,
                             referencia, ref_clave, fecha_pago, creado, reportado_el, verificado_el, verificado_por)
    values (v_pago, x.comprador_id, case x.metodo when 'Transferencia' then 'transferencia' else 'pago_movil' end, 'VES',
            case when v_verif is null then 'reportado' else 'verificado' end,
            tumbo_privado.bruto_pedido(x.id), x.costo_envio_usd, v_iva, tumbo_privado.bruto_pedido(x.id) + x.costo_envio_usd, x.tasa,
            round((tumbo_privado.bruto_pedido(x.id) + x.costo_envio_usd) * x.tasa, 2),
            x.ref, v_r ->> 'clave', (x.creado at time zone 'America/Caracas')::date, x.creado, x.creado, v_verif,
            case when v_verif is not null then 'Rosa Blanco (finanzas)' end);
    update tumbo.pedidos
    set pago_id = v_pago, monto_bs = round((tumbo_privado.bruto_pedido(x.id) + x.costo_envio_usd) * x.tasa, 2),
        comision_pct = cfg.comision_pct, tarifa_usd = cfg.tarifa_fija_usd, iva_usd = v_iva, exento_usd = v_exento
    where id = x.id;
    insert into tumbo.pago_eventos (pago_id, fecha, actor, texto, icono) values
      (v_pago, x.creado, 'María González', 'Pago registrado con la referencia ' || x.ref, 'shopping_cart');
    if v_verif is not null then
      insert into tumbo.pago_eventos (pago_id, fecha, actor, texto, icono) values (v_pago, v_verif, 'Finanzas', 'Pago verificado · cotejado en el banco', 'fact_check');
      perform tumbo_privado.asentar_pago(v_pago, 'Rosa Blanco (finanzas)');
      update tumbo.asientos set fecha = v_verif where referencia = v_pago;
    end if;
  end loop;
  perform setval('tumbo_privado.seq_pago', greatest(v_n, 1), v_n > 0);

  -- la liquidación sembrada (anterior a la regla de envío al seller): pagada
  for l in select * from tumbo.liquidaciones where ciclo is null order by id loop
    update tumbo.liquidaciones
    set ciclo = 'pagada', tasa_pago = 36.20, neto_bs = round(l.neto_usd * 36.20, 2), diferencial_bs = 0,
        referencia_pago = 'TRF-DEMO-' || right(l.id, 3), preparada_el = l.fecha::timestamptz, aprobada_el = l.fecha::timestamptz,
        pagada_el = l.fecha::timestamptz + interval '13 hours'
    where id = l.id;
    perform tumbo_privado.asentar('comision', l.id, 'Comisión y tarifas de la liquidación ' || l.id, 'Rosa Blanco (finanzas)',
      jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', l.seller_id, 'debe', l.comision_usd + l.tarifa_usd),
                        jsonb_build_object('cuenta', 'ingreso_comision', 'haber', l.comision_usd + l.tarifa_usd)));
    perform tumbo_privado.asentar('liquidacion', l.id, 'Liquidación ' || l.id || ' pagada', 'Rosa Blanco (finanzas)',
      jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', l.seller_id, 'debe', l.neto_usd),
                        jsonb_build_object('cuenta', 'banco:VES', 'haber', l.neto_usd)));
    update tumbo.asientos set fecha = l.fecha::timestamptz + interval '13 hours' where referencia = l.id;
    insert into tumbo.liquidacion_eventos (liquidacion_id, actor, accion, nota, fecha) values
      (l.id, 'Rosa Blanco (finanzas)', 'pagar', 'TRF-DEMO-' || right(l.id, 3), l.fecha::timestamptz + interval '13 hours');
    -- el envío de sus pedidos no se incluyó: queda a favor del comercio
    insert into tumbo.ajustes_seller (seller_id, monto_usd, motivo, por)
    select l.seller_id, sum(p.costo_envio_usd), 'Envío de ' || string_agg(p.id, ', ') || ' (liquidado en ' || l.id || ' antes de la regla de envío al seller)', 'Sistema'
    from tumbo.pedidos p where p.id = any (l.pedidos) and p.costo_envio_usd > 0
    having sum(p.costo_envio_usd) > 0;
  end loop;

  -- cuentas de liquidación ficticias de los sellers homologados de la semilla
  for v_rif, v_pago in select tumbo_privado.documento(k.rif), k.seller_id from tumbo.sellers_kyc k
                       join tumbo.sellers s on s.id = k.seller_id
                       where k.seller_id in ('SEL-014', 'SEL-009') and tumbo_privado.documento(k.rif) is not null loop
    insert into tumbo.cuentas_liquidacion (seller_id, tipo, banco, titular, rif, numero, tipo_cuenta, estado, vigente_desde,
                                           ficticia, creado, creado_por, verificada_por, verificada_el)
    values (v_pago, 'cuenta', case v_pago when 'SEL-014' then '0134' else '0105' end,
            (select nombre from tumbo.sellers where id = v_pago), v_rif,
            case v_pago when 'SEL-014' then '01340000000000000014' else '01050000000000000009' end, 'corriente', 'verificada',
            '2026-03-02 09:00-04', true, '2026-03-01 09:00-04', 'Semilla de la demo (cuenta ficticia)', 'Rosa Blanco (finanzas)', '2026-03-02 09:00-04');
  end loop;
  perform set_config('tumbo.reinicio_libro', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Tareas programadas (pg_cron, solo donde existe)
-- ---------------------------------------------------------------------------
do $$
declare
  j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in execute $q$select jobid from cron.job where jobname in ('tumbo-pagos-vencimientos', 'tumbo-pagos-tasa',
               'tumbo-pagos-tasa-respuesta', 'tumbo-pagos-liquidaciones', 'tumbo-pagos-cierre')$q$ loop
      execute 'select cron.unschedule($1)' using j.jobid;
    end loop;
    execute $q$select cron.schedule('tumbo-pagos-vencimientos', '*/10 * * * *', 'select tumbo_privado.tarea_pagos()')$q$;
    execute $q$select cron.schedule('tumbo-pagos-tasa', '7 */3 * * *', 'select tumbo_privado.tarea_tasa()')$q$;
    execute $q$select cron.schedule('tumbo-pagos-tasa-respuesta', '9 */3 * * *', 'select tumbo_privado.tarea_tasa_procesar()')$q$;
    -- lunes 8:00 en Caracas (12:00 UTC)
    execute $q$select cron.schedule('tumbo-pagos-liquidaciones', '0 12 * * 1', 'select tumbo_privado.tarea_liquidaciones()')$q$;
    -- 00:15 en Caracas (04:15 UTC): cierre del día anterior
    execute $q$select cron.schedule('tumbo-pagos-cierre', '15 4 * * *', 'select tumbo_privado.tarea_cierre_diario()')$q$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: las funciones nuevas de la API, por firma exacta (las
-- redefinidas conservan los suyos).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

do $$
declare
  f regprocedure;
begin
  foreach f in array array[
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
    'public.tm_pedido_recibo(text,text)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
