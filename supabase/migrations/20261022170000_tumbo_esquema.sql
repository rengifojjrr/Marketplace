-- =========================================================================
-- Tumbo Market — Esquema de datos
-- -------------------------------------------------------------------------
-- Las tablas viven en `public` (el esquema que expone la API) y SOLO se leen
-- a través de RLS. Ninguna tabla de negocio admite escritura directa desde el
-- cliente: los cambios de estado pasan por las funciones `tm_*` (ver
-- 20261022170200_tumbo_funciones.sql), que validan rol, propiedad y estado y
-- dejan auditoría y notificaciones en la misma transacción.
--
-- `privado` guarda lo que la API no debe exponer: ayudantes de RLS,
-- secuencias de identificadores y la semilla de la demo.
-- =========================================================================

create schema if not exists privado;
revoke all on schema privado from public;

-- ---------------------------------------------------------------------------
-- Configuración comercial (una sola fila)
-- ---------------------------------------------------------------------------
create table public.config (
  id                   boolean primary key default true check (id),
  tasa                 numeric(12,4) not null check (tasa > 0),        -- Bs. por USD
  comision_pct         numeric(5,2)  not null check (comision_pct between 0 and 100),
  tarifa_fija_usd      numeric(10,2) not null check (tarifa_fija_usd >= 0),
  ventana_reclamo_dias integer       not null check (ventana_reclamo_dias > 0),
  ciudad_entrega       text          not null
);

-- ---------------------------------------------------------------------------
-- Catálogo maestro
-- ---------------------------------------------------------------------------
create table public.categorias (
  id     text primary key,
  nombre text not null,
  icono  text not null,
  orden  integer not null default 0
);

-- Perfil público del seller (lo que la tienda puede mostrar).
create table public.sellers (
  id          text primary key,
  nombre      text not null,
  ciudad      text not null,
  estado      text not null check (estado in ('en_revision', 'observado', 'aprobado', 'rechazado', 'suspendido')),
  rating      numeric(2,1) check (rating between 0 and 5),
  resenas     integer not null default 0 check (resenas >= 0),
  desde       date not null default current_date,
  descripcion text not null default ''
);

-- Expediente KYC: datos fiscales y observaciones internas, fuera de la vista pública.
create table public.sellers_kyc (
  seller_id   text primary key references public.sellers (id) on delete cascade,
  rif         text not null,
  observacion text
);

create table public.seller_documentos (
  seller_id text not null references public.sellers (id) on delete cascade,
  orden     integer not null,
  nombre    text not null,
  estado    text not null check (estado in ('pendiente', 'en_revision', 'aprobado', 'observado', 'rechazado')),
  primary key (seller_id, orden)
);

-- ---------------------------------------------------------------------------
-- Usuarios: el rol vive aquí y SOLO lo asigna el backoffice / la semilla.
-- Un registro desde la web siempre nace como comprador.
-- ---------------------------------------------------------------------------
create table public.perfiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  email     text not null unique,
  nombre    text not null,
  rol       text not null default 'comprador'
            check (rol in ('comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas')),
  seller_id text references public.sellers (id),
  mfa       boolean not null default false,
  creado    timestamptz not null default now(),
  -- los roles del Seller Center pertenecen a un comercio; los demás, a ninguno
  check ((rol in ('seller', 'precios', 'operador')) = (seller_id is not null))
);

-- ---------------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------------
create table public.productos (
  sku            text primary key,
  seller_id      text not null references public.sellers (id),
  nombre         text not null check (char_length(nombre) between 4 and 160),
  marca          text not null default '' check (char_length(marca) <= 80),
  categoria      text not null references public.categorias (id),
  precio_usd     numeric(12,2) not null check (precio_usd > 0),
  stock_fis      integer not null default 0 check (stock_fis >= 0),
  stock_res      integer not null default 0 check (stock_res >= 0),
  estado         text not null check (estado in ('borrador', 'en_revision', 'publicado', 'pausado', 'rechazado')),
  img            text not null default 'producto-01',
  rating         numeric(2,1) check (rating between 0 and 5),
  resenas        integer not null default 0 check (resenas >= 0),
  descripcion    text not null default '' check (char_length(descripcion) <= 4000),
  specs          jsonb not null default '{}'::jsonb,
  motivo_rechazo text,
  creado         timestamptz not null default now(),
  actualizado    timestamptz not null default now(),
  -- lo reservado por pedidos en curso nunca supera lo que hay en el almacén
  check (stock_res <= stock_fis)
);
create index productos_seller_idx on public.productos (seller_id);
create index productos_estado_idx on public.productos (estado);

-- ---------------------------------------------------------------------------
-- Comprador: direcciones y carrito
-- ---------------------------------------------------------------------------
create table public.direcciones (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null default auth.uid() references public.perfiles (id) on delete cascade,
  nombre         text not null check (char_length(nombre) between 1 and 60),
  linea          text not null check (char_length(linea) between 3 and 200),
  municipio      text not null check (char_length(municipio) between 2 and 80),
  ciudad         text not null default 'Caracas' check (char_length(ciudad) <= 80),
  codigo         text not null default '1010' check (char_length(codigo) <= 10),
  telefono       text not null default '—' check (char_length(telefono) <= 30),
  predeterminada boolean not null default false,
  creado         timestamptz not null default now()
);
create index direcciones_usuario_idx on public.direcciones (usuario_id);

create table public.carrito_items (
  usuario_id uuid not null default auth.uid() references public.perfiles (id) on delete cascade,
  sku        text not null references public.productos (sku) on delete cascade,
  cant       integer not null check (cant between 1 and 99),
  agregado   timestamptz not null default now(),
  primary key (usuario_id, sku)
);

-- ---------------------------------------------------------------------------
-- Pedidos
--   estado:      pago_por_verificar → por_aceptar → preparando → listo →
--                despachado → entregado → cerrado | cancelado | reembolsado | devolucion
--   liquidacion: retenido | congelado | elegible | liquidado | reembolsado
-- ---------------------------------------------------------------------------
create table public.pedidos (
  id              text primary key,
  comprador_id    uuid not null references public.perfiles (id),
  seller_id       text not null references public.sellers (id),
  estado          text not null check (estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo',
                    'despachado', 'entregado', 'cerrado', 'cancelado', 'reembolsado', 'devolucion')),
  liquidacion     text check (liquidacion in ('retenido', 'congelado', 'elegible', 'liquidado', 'reembolsado')),
  envio_tipo      text not null check (envio_tipo in ('domicilio', 'agencia')),
  envio_dir       text not null,
  courier         text not null,
  costo_envio_usd numeric(10,2) not null check (costo_envio_usd >= 0),
  tasa            numeric(12,4) not null,
  metodo          text not null,
  ref             text not null,
  guia            text,
  peso            numeric(8,2),
  sla_horas       integer,
  disputa_id      text,
  liquidacion_id  text,
  creado          timestamptz not null default now(),
  entregado_el    timestamptz
);
create index pedidos_comprador_idx on public.pedidos (comprador_id);
create index pedidos_seller_idx on public.pedidos (seller_id);
create index pedidos_estado_idx on public.pedidos (estado);

-- Las líneas guardan nombre e imagen del momento de la compra: el pedido se
-- sigue leyendo bien aunque el producto se pause o cambie después.
create table public.pedido_items (
  pedido_id  text not null references public.pedidos (id) on delete cascade,
  sku        text not null references public.productos (sku),
  nombre     text not null,
  img        text not null,
  cant       integer not null check (cant > 0),
  precio_usd numeric(12,2) not null check (precio_usd >= 0),
  primary key (pedido_id, sku)
);

create table public.pedido_eventos (
  id        bigint generated always as identity primary key,
  pedido_id text not null references public.pedidos (id) on delete cascade,
  fecha     timestamptz not null default now(),
  actor     text not null,
  texto     text not null,
  icono     text not null default 'info'
);
create index pedido_eventos_pedido_idx on public.pedido_eventos (pedido_id, fecha);

-- ---------------------------------------------------------------------------
-- Disputas y liquidaciones
-- ---------------------------------------------------------------------------
create table public.disputas (
  id                  text primary key,
  pedido_id           text not null unique references public.pedidos (id),
  comprador_id        uuid not null references public.perfiles (id),
  seller_id           text not null references public.sellers (id),
  motivo              text not null check (char_length(motivo) between 3 and 80),
  descripcion         text not null check (char_length(descripcion) between 15 and 2000),
  evidencia           text[] not null default '{}',
  monto_usd           numeric(12,2) not null,
  estado              text not null check (estado in ('abierta', 'respondida', 'resuelta')),
  creado              timestamptz not null default now(),
  respuesta_texto     text,
  respuesta_evidencia text[],
  respuesta_fecha     timestamptz,
  resolucion_decision text check (resolucion_decision in ('reembolso', 'devolucion', 'liberar')),
  resolucion_nota     text,
  resolucion_fecha    timestamptz
);
create index disputas_seller_idx on public.disputas (seller_id);
create index disputas_comprador_idx on public.disputas (comprador_id);

create table public.liquidaciones (
  id           text primary key,
  seller_id    text not null references public.sellers (id),
  periodo      text not null,
  pedidos      text[] not null,
  bruto_usd    numeric(12,2) not null,
  comision_usd numeric(12,2) not null,
  tarifa_usd   numeric(12,2) not null,
  neto_usd     numeric(12,2) not null,
  estado       text not null default 'pagada' check (estado in ('pagada', 'pendiente')),
  fecha        date not null default current_date,
  comprobante  text not null
);
create index liquidaciones_seller_idx on public.liquidaciones (seller_id);

-- ---------------------------------------------------------------------------
-- Notificaciones: destinatario por usuario, por rol o por comercio.
--   para = 'usr:<uuid>' | 'rol:<rol>' | 'seller:<id>'
-- La lectura es individual aunque el aviso sea compartido.
-- ---------------------------------------------------------------------------
create table public.notificaciones (
  id     bigint generated always as identity primary key,
  para   text not null check (para ~ '^(usr|rol|seller):'),
  texto  text not null,
  icono  text not null default 'info',
  enlace text,
  fecha  timestamptz not null default now()
);
create index notificaciones_para_idx on public.notificaciones (para, fecha desc);

create table public.notificaciones_leidas (
  notificacion_id bigint not null references public.notificaciones (id) on delete cascade,
  usuario_id      uuid not null references public.perfiles (id) on delete cascade,
  primary key (notificacion_id, usuario_id)
);

-- ---------------------------------------------------------------------------
-- Auditoría: solo se agrega. Ni UPDATE ni DELETE (el trigger lo impide incluso
-- a las funciones con privilegios).
-- ---------------------------------------------------------------------------
create table public.auditoria (
  id       bigint generated always as identity primary key,
  fecha    timestamptz not null default now(),
  actor_id uuid,
  actor    text not null,
  accion   text not null,
  detalle  text not null default ''
);
create index auditoria_fecha_idx on public.auditoria (fecha desc);

create function privado.auditoria_inmutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'La auditoría es de solo lectura: los eventos no se editan ni se borran.';
end $$;

create trigger auditoria_inmutable
  before update or delete on public.auditoria
  for each row execute function privado.auditoria_inmutable();

-- ---------------------------------------------------------------------------
-- Secuencias de identificadores legibles (TM-2026-00435, DSP-0099, …)
-- ---------------------------------------------------------------------------
create sequence privado.seq_pedido start 1;
create sequence privado.seq_disputa start 1;
create sequence privado.seq_liquidacion start 1;
create sequence privado.seq_guia start 1;
create sequence privado.seq_sku start 1;
