-- =========================================================================
-- Tumbo Market — Esquema de datos
-- -------------------------------------------------------------------------
-- Tumbo vive DENTRO de un proyecto Supabase que comparte con otras
-- aplicaciones. Para que ni esas aplicaciones ni sus usuarios lo vean, y
-- para no tocar nada de ellas:
--
--   · Los datos están en el esquema `tumbo`, que la API no expone y sobre el
--     que anon/authenticated no tienen ni USAGE: no se pueden leer ni
--     listar por /rest/v1 ni por GraphQL.
--   · Tumbo tiene sus PROPIOS usuarios y sesiones (tumbo.usuarios,
--     tumbo.sesiones). No crea filas en auth.users, así que no dispara los
--     triggers de alta de las demás aplicaciones y sus cuentas demo (con
--     contraseña pública) no sirven para entrar en ninguna otra.
--   · La única puerta son las funciones public.tm_* (SECURITY DEFINER), que
--     reciben el token de sesión, validan rol, propiedad y estado, y
--     devuelven solo lo que ese rol puede ver.
--
-- `tumbo_privado` guarda ayudantes, secuencias y la semilla.
-- =========================================================================

create schema if not exists tumbo;
create schema if not exists tumbo_privado;
revoke all on schema tumbo, tumbo_privado from public;
comment on schema tumbo is
  'Tumbo Market (beta). Privado: no expuesto por la API; se accede solo con las funciones public.tm_*.';
comment on schema tumbo_privado is 'Tumbo Market (beta): ayudantes internos, secuencias y semilla.';

-- ---------------------------------------------------------------------------
-- Configuración comercial (una sola fila)
-- ---------------------------------------------------------------------------
create table tumbo.config (
  id                   boolean primary key default true check (id),
  tasa                 numeric(12,4) not null check (tasa > 0),        -- Bs. por USD
  comision_pct         numeric(5,2)  not null check (comision_pct between 0 and 100),
  tarifa_fija_usd      numeric(10,2) not null check (tarifa_fija_usd >= 0),
  ventana_reclamo_dias integer       not null check (ventana_reclamo_dias > 0),
  ciudad_entrega       text          not null
);

-- ---------------------------------------------------------------------------
-- Catálogo maestro y comercios
-- ---------------------------------------------------------------------------
create table tumbo.categorias (
  id     text primary key,
  nombre text not null,
  icono  text not null,
  orden  integer not null default 0
);

-- Perfil público del seller (lo que la tienda puede mostrar).
create table tumbo.sellers (
  id          text primary key,
  nombre      text not null,
  ciudad      text not null,
  estado      text not null check (estado in ('en_revision', 'observado', 'aprobado', 'rechazado', 'suspendido')),
  rating      numeric(2,1) check (rating between 0 and 5),
  resenas     integer not null default 0 check (resenas >= 0),
  desde       date not null default current_date,
  descripcion text not null default ''
);

-- Expediente KYC: datos fiscales y observaciones internas.
create table tumbo.sellers_kyc (
  seller_id   text primary key references tumbo.sellers (id) on delete cascade,
  rif         text not null,
  observacion text
);

create table tumbo.seller_documentos (
  seller_id text not null references tumbo.sellers (id) on delete cascade,
  orden     integer not null,
  nombre    text not null,
  estado    text not null check (estado in ('pendiente', 'en_revision', 'aprobado', 'observado', 'rechazado')),
  primary key (seller_id, orden)
);

-- ---------------------------------------------------------------------------
-- Identidad propia de Tumbo
-- El rol SOLO lo asigna la semilla o el backoffice: un registro desde la web
-- siempre nace comprador.
-- ---------------------------------------------------------------------------
create table tumbo.usuarios (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email = lower(email) and char_length(email) <= 120),
  clave_hash text not null,                                  -- bcrypt (pgcrypto)
  nombre     text not null check (char_length(nombre) between 2 and 80),
  rol        text not null default 'comprador'
             check (rol in ('comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas')),
  seller_id  text references tumbo.sellers (id),
  mfa        boolean not null default false,
  activo     boolean not null default true,
  creado     timestamptz not null default now(),
  -- los roles del Seller Center pertenecen a un comercio; los demás, a ninguno
  check ((rol in ('seller', 'precios', 'operador')) = (seller_id is not null))
);
create index usuarios_seller_idx on tumbo.usuarios (seller_id);

-- Sesiones: el navegador guarda un token aleatorio; aquí solo su SHA-256.
create table tumbo.sesiones (
  token_hash bytea primary key,
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  creada     timestamptz not null default now(),
  expira     timestamptz not null,
  ultimo_uso timestamptz not null default now()
);
create index sesiones_usuario_idx on tumbo.sesiones (usuario_id);
create index sesiones_expira_idx on tumbo.sesiones (expira);

-- Intentos de acceso: frenan la adivinación de contraseñas.
create table tumbo.intentos_acceso (
  id    bigint generated always as identity primary key,
  email text not null,
  fecha timestamptz not null default now(),
  exito boolean not null
);
create index intentos_acceso_email_idx on tumbo.intentos_acceso (email, fecha desc);

-- ---------------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------------
create table tumbo.productos (
  sku            text primary key,
  seller_id      text not null references tumbo.sellers (id),
  nombre         text not null check (char_length(nombre) between 4 and 160),
  marca          text not null default '' check (char_length(marca) <= 80),
  categoria      text not null references tumbo.categorias (id),
  precio_usd     numeric(12,2) not null check (precio_usd > 0),
  stock_fis      integer not null default 0 check (stock_fis >= 0),
  stock_res      integer not null default 0 check (stock_res >= 0),
  estado         text not null check (estado in ('borrador', 'en_revision', 'publicado', 'pausado', 'rechazado')),
  img            text not null default 'producto-01' check (img ~ '^producto-0[1-6]$'),
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
create index productos_seller_idx on tumbo.productos (seller_id);
create index productos_estado_idx on tumbo.productos (estado);
create index productos_categoria_idx on tumbo.productos (categoria);

-- ---------------------------------------------------------------------------
-- Comprador: direcciones y carrito
-- ---------------------------------------------------------------------------
create table tumbo.direcciones (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references tumbo.usuarios (id) on delete cascade,
  nombre         text not null check (char_length(nombre) between 1 and 60),
  linea          text not null check (char_length(linea) between 3 and 200),
  municipio      text not null check (char_length(municipio) between 2 and 80),
  ciudad         text not null default 'Caracas' check (char_length(ciudad) <= 80),
  codigo         text not null default '1010' check (char_length(codigo) <= 10),
  telefono       text not null default '—' check (char_length(telefono) <= 30),
  predeterminada boolean not null default false,
  creado         timestamptz not null default now()
);
create index direcciones_usuario_idx on tumbo.direcciones (usuario_id);

create table tumbo.carrito_items (
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  sku        text not null references tumbo.productos (sku) on delete cascade,
  cant       integer not null check (cant between 1 and 99),
  agregado   timestamptz not null default now(),
  primary key (usuario_id, sku)
);
create index carrito_items_sku_idx on tumbo.carrito_items (sku);

-- ---------------------------------------------------------------------------
-- Pedidos
--   estado:      pago_por_verificar → por_aceptar → preparando → listo →
--                despachado → entregado → cerrado | cancelado | reembolsado | devolucion
--   liquidacion: retenido | congelado | elegible | liquidado | reembolsado
-- ---------------------------------------------------------------------------
create table tumbo.pedidos (
  id              text primary key,
  comprador_id    uuid not null references tumbo.usuarios (id),
  seller_id       text not null references tumbo.sellers (id),
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
  despachado_el   timestamptz,
  entregado_el    timestamptz
);
create index pedidos_comprador_idx on tumbo.pedidos (comprador_id);
create index pedidos_seller_idx on tumbo.pedidos (seller_id);
create index pedidos_estado_idx on tumbo.pedidos (estado);

-- Las líneas guardan nombre e imagen del momento de la compra: el pedido se
-- sigue leyendo bien aunque el producto se pause o cambie después.
create table tumbo.pedido_items (
  pedido_id  text not null references tumbo.pedidos (id) on delete cascade,
  sku        text not null references tumbo.productos (sku),
  nombre     text not null,
  img        text not null,
  cant       integer not null check (cant > 0),
  precio_usd numeric(12,2) not null check (precio_usd >= 0),
  primary key (pedido_id, sku)
);
create index pedido_items_sku_idx on tumbo.pedido_items (sku);

create table tumbo.pedido_eventos (
  id        bigint generated always as identity primary key,
  pedido_id text not null references tumbo.pedidos (id) on delete cascade,
  fecha     timestamptz not null default now(),
  actor     text not null,
  texto     text not null,
  icono     text not null default 'info'
);
create index pedido_eventos_pedido_idx on tumbo.pedido_eventos (pedido_id, fecha);

-- ---------------------------------------------------------------------------
-- Disputas y liquidaciones
-- ---------------------------------------------------------------------------
create table tumbo.disputas (
  id                  text primary key,
  pedido_id           text not null unique references tumbo.pedidos (id),
  comprador_id        uuid not null references tumbo.usuarios (id),
  seller_id           text not null references tumbo.sellers (id),
  motivo              text not null check (char_length(motivo) between 3 and 80),
  descripcion         text not null check (char_length(descripcion) between 15 and 2000),
  evidencia           text[] not null default '{}' check (cardinality(evidencia) <= 10),
  monto_usd           numeric(12,2) not null,
  estado              text not null check (estado in ('abierta', 'respondida', 'resuelta')),
  creado              timestamptz not null default now(),
  respuesta_texto     text check (char_length(respuesta_texto) <= 2000),
  respuesta_evidencia text[] check (cardinality(respuesta_evidencia) <= 10),
  respuesta_fecha     timestamptz,
  resolucion_decision text check (resolucion_decision in ('reembolso', 'devolucion', 'liberar')),
  resolucion_nota     text,
  resolucion_fecha    timestamptz
);
create index disputas_seller_idx on tumbo.disputas (seller_id);
create index disputas_comprador_idx on tumbo.disputas (comprador_id);

create table tumbo.liquidaciones (
  id           text primary key,
  seller_id    text not null references tumbo.sellers (id),
  periodo      text not null,
  pedidos      text[] not null,
  bruto_usd    numeric(12,2) not null,
  comision_usd numeric(12,2) not null,
  tarifa_usd   numeric(12,2) not null,
  neto_usd     numeric(12,2) not null check (neto_usd > 0),
  estado       text not null default 'pagada' check (estado in ('pagada', 'pendiente')),
  fecha        date not null default current_date,
  comprobante  text not null
);
create index liquidaciones_seller_idx on tumbo.liquidaciones (seller_id);

-- ---------------------------------------------------------------------------
-- Notificaciones: destinatario por usuario, por rol o por comercio.
--   para  = 'usr:<uuid>' | 'rol:<rol>' | 'seller:<id>'
--   roles = dentro de un comercio, qué roles la ven (dinero, reclamos y KYC:
--           solo el seller principal; pedidos: también el operador).
--           NULL = todos los destinatarios de `para`.
-- La lectura es individual aunque el aviso sea compartido.
-- ---------------------------------------------------------------------------
create table tumbo.notificaciones (
  id     bigint generated always as identity primary key,
  para   text not null check (para ~ '^(usr|rol|seller):'),
  roles  text[],
  texto  text not null,
  icono  text not null default 'info',
  enlace text,
  fecha  timestamptz not null default now()
);
create index notificaciones_para_idx on tumbo.notificaciones (para, fecha desc);

create table tumbo.notificaciones_leidas (
  notificacion_id bigint not null references tumbo.notificaciones (id) on delete cascade,
  usuario_id      uuid not null references tumbo.usuarios (id) on delete cascade,
  primary key (notificacion_id, usuario_id)
);
create index notificaciones_leidas_usuario_idx on tumbo.notificaciones_leidas (usuario_id);

-- ---------------------------------------------------------------------------
-- Auditoría: solo se agrega. Ni UPDATE ni DELETE ni TRUNCATE (los triggers lo
-- impiden incluso a las funciones con privilegios; el reinicio de la demo la
-- conserva).
-- ---------------------------------------------------------------------------
create table tumbo.auditoria (
  id       bigint generated always as identity primary key,
  fecha    timestamptz not null default now(),
  actor_id uuid,
  actor    text not null,
  accion   text not null,
  detalle  text not null default ''
);
create index auditoria_fecha_idx on tumbo.auditoria (fecha desc);
create index auditoria_accion_idx on tumbo.auditoria (accion, fecha desc);

create function tumbo_privado.auditoria_inmutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'La auditoría es de solo lectura: los eventos no se editan ni se borran.';
end $$;

create trigger auditoria_inmutable
  before update or delete on tumbo.auditoria
  for each row execute function tumbo_privado.auditoria_inmutable();
create trigger auditoria_sin_truncate
  before truncate on tumbo.auditoria
  for each statement execute function tumbo_privado.auditoria_inmutable();

-- Tope de direcciones por usuario.
create function tumbo_privado.limitar_direcciones() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from tumbo.direcciones where usuario_id = new.usuario_id) >= 20 then
    raise exception 'Puedes guardar hasta 20 direcciones.';
  end if;
  return new;
end $$;

create trigger direcciones_tope
  before insert on tumbo.direcciones
  for each row execute function tumbo_privado.limitar_direcciones();

-- ---------------------------------------------------------------------------
-- Secuencias de identificadores legibles (TM-2026-00435, DSP-0099, …)
-- ---------------------------------------------------------------------------
create sequence tumbo_privado.seq_pedido start 1;
create sequence tumbo_privado.seq_disputa start 1;
create sequence tumbo_privado.seq_liquidacion start 1;
create sequence tumbo_privado.seq_guia start 1;
create sequence tumbo_privado.seq_sku start 1;

-- ---------------------------------------------------------------------------
-- Defensa en profundidad: RLS activo y sin políticas en todas las tablas.
-- Aunque alguien expusiera el esquema por error, nadie leería una fila: solo
-- el dueño (las funciones tm_*) accede.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'tumbo' loop
    execute format('alter table tumbo.%I enable row level security', t.tablename);
    execute format('revoke all on tumbo.%I from public, anon, authenticated', t.tablename);
  end loop;
end $$;
revoke all on all sequences in schema tumbo_privado from public, anon, authenticated;
