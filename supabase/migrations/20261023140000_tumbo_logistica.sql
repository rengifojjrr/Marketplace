-- =========================================================================
-- Tumbo Market — Ola 1: logística y operación
-- -------------------------------------------------------------------------
-- Ver docs/dominios/logistica.md. Lo que agrega:
--   · couriers (MRW, Zoom, Tealca, Liberty Express, Domesa, delivery propio y
--     retiro en tienda) con su patrón de rastreo, regiones por estado, lugares
--     conocidos (ciudades y municipios → estado), tarifas por courier, zona y
--     peso (sembradas como valores de REFERENCIA, editables), oficinas (las
--     crea el personal: aquí no se inventa ninguna dirección) y feriados
--     nacionales para contar días hábiles;
--   · configuración de envíos por comercio (origen, couriers, delivery
--     propio por municipio, retiro en tienda, envío gratis desde un monto,
--     días de preparación, cobro en destino y modo vacaciones);
--   · cotizar_envio real (contrato de la ola 0) y la promesa de la ficha;
--   · por pedido: la opción elegida y su promesa, la referencia de la
--     etiqueta, la guía real del courier con su foto, los vencimientos (SLA)
--     y su seguimiento por disparadores sobre tumbo.pedidos (cualquier equipo
--     que cambie el estado de un pedido alimenta la logística sin saberlo);
--   · incidencias, cancelación por el comercio o por Operaciones con motivo
--     tipificado, solicitud de cancelación del comprador ya aceptado,
--     reclamo «no llegó», devoluciones con instrucciones e inspección,
--     notas internas, asignación de responsables y el panel de Operaciones;
--   · la tarea programada tumbo_privado.tarea_sla() (pg_cron si existe).
-- Solo agrega: crea tablas, índices, funciones y disparadores; las funciones
-- existentes que redefine (tm_marcar_listo, tm_despachar, tm_confirmar_entrega,
-- tm_cancelar_pedido, tm_cerrar_devolucion y tm_abrir_disputa) parten de su
-- última definición y conservan su comportamiento de base.
-- =========================================================================

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Ajustes de la operación (privados; se cambian con tm_ajuste_guardar)
-- ---------------------------------------------------------------------------
insert into tumbo.ajustes (clave, valor, tipo, vaciable, publico, descripcion) values
  ('logistica', '{"aceptar_horas": 24, "recordar_horas": 6, "cancelar_horas": 48, "solicitud_horas": 24,
                  "autoconfirmar_dias": 10, "aviso_autoconfirmar_dias": 2, "reclamo_no_llego_habiles": 2,
                  "sin_novedad_dias": 5, "peso_defecto_kg": 1}', 'object', false, false,
   'Plazos de la operación: horas para aceptar, recordar y cancelar un pedido sin aceptar; horas para que el comercio responda una solicitud de cancelación; días para dar por recibida una entrega y para avisarlo antes; días hábiles de gracia del reclamo «no llegó»; días sin novedades de un despacho y peso por omisión de un producto (kg).')
on conflict (clave) do nothing;

-- Mínimo y máximo de cada plazo: tm_logistica_plazos_guardar rechaza lo que
-- se sale de ahí y, si el ajuste se cambiara por otra vía, la lectura lo
-- lleva al límite (un 0 nunca cancela ni autoconfirma todo de inmediato).
create function tumbo_privado.logistica_rango(p_clave text) returns numeric[]
language sql immutable set search_path = '' as $$
  select case p_clave
    when 'aceptar_horas' then array[2, 72]
    when 'recordar_horas' then array[1, 24]
    when 'cancelar_horas' then array[24, 168]
    when 'solicitud_horas' then array[2, 72]
    when 'autoconfirmar_dias' then array[3, 30]
    when 'aviso_autoconfirmar_dias' then array[1, 7]
    when 'reclamo_no_llego_habiles' then array[0, 10]
    when 'sin_novedad_dias' then array[1, 30]
    when 'peso_defecto_kg' then array[0.1, 50] end::numeric[]
$$;

create function tumbo_privado.logistica(p_clave text, p_omision numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when x.r is null or x.v is null then x.v else greatest(x.r[1], least(x.r[2], x.v)) end
  from (select tumbo_privado.numero(coalesce(tumbo_privado.ajuste('logistica'), '{}'::jsonb) -> p_clave, p_omision) as v,
               tumbo_privado.logistica_rango(p_clave) as r) x
$$;

-- ---------------------------------------------------------------------------
-- Couriers, regiones, lugares, tarifas, oficinas y feriados
-- ---------------------------------------------------------------------------
create table tumbo.couriers (
  codigo        text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,19}$'),
  nombre        text not null check (char_length(nombre) between 2 and 60),
  tipo          text not null default 'courier' check (tipo in ('courier', 'propio', 'tienda')),
  agencia       boolean not null default true,       -- retiro en una oficina del courier
  domicilio     boolean not null default true,       -- entrega en la dirección
  cobro_destino boolean not null default false,      -- el comprador paga el envío al retirar
  url_rastreo   text check (url_rastreo is null or (char_length(url_rastreo) <= 300
                  and url_rastreo ~ '^https://[^[:space:]<>"'']+$' and position('{guia}' in url_rastreo) > 0)),
  activo        boolean not null default true,
  orden         integer not null default 100,
  nota          text check (char_length(nota) <= 300),
  actualizado   timestamptz not null default now(),
  por           text
);
alter table tumbo.couriers enable row level security;
revoke all on tumbo.couriers from public, anon, authenticated;

-- El patrón de rastreo lo pega el personal (con {guia} donde va el número):
-- aquí no se presume ninguna dirección de los couriers.
insert into tumbo.couriers (codigo, nombre, tipo, agencia, domicilio, cobro_destino, orden, nota) values
  ('mrw',     'MRW',             'courier', true,  true,  true,  10, 'Patrón de rastreo pendiente de configurar.'),
  ('zoom',    'Zoom',            'courier', true,  true,  true,  20, 'Patrón de rastreo pendiente de configurar.'),
  ('tealca',  'Tealca',          'courier', true,  true,  true,  30, 'Patrón de rastreo pendiente de configurar.'),
  ('liberty', 'Liberty Express', 'courier', true,  true,  false, 40, 'Patrón de rastreo pendiente de configurar.'),
  ('domesa',  'Domesa',          'courier', true,  true,  false, 50, 'Patrón de rastreo pendiente de configurar.'),
  ('propio',  'Delivery propio', 'propio',  false, true,  false, 90, 'Lo hace el comercio con su propio repartidor.'),
  ('tienda',  'Retiro en tienda','tienda',  true,  false, false, 95, 'El comprador retira en el local del comercio.')
on conflict (codigo) do nothing;

-- Regiones: deciden la zona tarifaria entre el estado de origen y el de
-- destino (mismo estado, misma región, nacional o remota).
create table tumbo.envio_zonas (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,29}$'),
  nombre text not null,
  remota boolean not null default false,
  orden  integer not null default 0
);
alter table tumbo.envio_zonas enable row level security;
revoke all on tumbo.envio_zonas from public, anon, authenticated;

insert into tumbo.envio_zonas (codigo, nombre, remota, orden) values
  ('central', 'Central', false, 1),
  ('centro_occidental', 'Centro occidental y llanos', false, 2),
  ('occidental', 'Occidente y Andes', false, 3),
  ('oriental', 'Oriente y Guayana', false, 4),
  ('remota', 'Insular y remota', true, 5)
on conflict (codigo) do nothing;

create table tumbo.envio_estados (
  estado  text primary key,
  zona    text not null references tumbo.envio_zonas (codigo),
  capital text not null,
  orden   integer not null default 0
);
alter table tumbo.envio_estados enable row level security;
revoke all on tumbo.envio_estados from public, anon, authenticated;

insert into tumbo.envio_estados (estado, zona, capital, orden) values
  ('Amazonas', 'remota', 'Puerto Ayacucho', 1), ('Anzoátegui', 'oriental', 'Barcelona', 2),
  ('Apure', 'occidental', 'San Fernando de Apure', 3), ('Aragua', 'central', 'Maracay', 4),
  ('Barinas', 'occidental', 'Barinas', 5), ('Bolívar', 'oriental', 'Ciudad Bolívar', 6),
  ('Carabobo', 'central', 'Valencia', 7), ('Cojedes', 'centro_occidental', 'San Carlos', 8),
  ('Delta Amacuro', 'remota', 'Tucupita', 9), ('Distrito Capital', 'central', 'Caracas', 10),
  ('Falcón', 'centro_occidental', 'Coro', 11), ('Guárico', 'centro_occidental', 'San Juan de los Morros', 12),
  ('La Guaira', 'central', 'La Guaira', 13), ('Lara', 'centro_occidental', 'Barquisimeto', 14),
  ('Mérida', 'occidental', 'Mérida', 15), ('Miranda', 'central', 'Los Teques', 16),
  ('Monagas', 'oriental', 'Maturín', 17), ('Nueva Esparta', 'remota', 'La Asunción', 18),
  ('Portuguesa', 'centro_occidental', 'Guanare', 19), ('Sucre', 'oriental', 'Cumaná', 20),
  ('Táchira', 'occidental', 'San Cristóbal', 21), ('Trujillo', 'occidental', 'Trujillo', 22),
  ('Yaracuy', 'centro_occidental', 'San Felipe', 23), ('Zulia', 'occidental', 'Maracaibo', 24)
on conflict (estado) do nothing;

-- Nombres normalizados (minúsculas, sin tildes) → estado: los propios
-- estados (y sus nombres de antes), ciudades y los municipios que no se
-- repiten en otros estados. Sirven para ubicar un destino escrito a mano.
create function tumbo_privado.lugar_clave(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))),
                                     '[^a-z0-9]+', ' ', 'g')), '')
$$;

create table tumbo.envio_lugares (
  lugar  text not null,
  tipo   text not null check (tipo in ('estado', 'ciudad', 'municipio')),
  estado text not null references tumbo.envio_estados (estado),
  primary key (lugar, tipo)
);
alter table tumbo.envio_lugares enable row level security;
revoke all on tumbo.envio_lugares from public, anon, authenticated;

insert into tumbo.envio_lugares (lugar, tipo, estado)
select tumbo_privado.lugar_clave(e.estado), 'estado', e.estado from tumbo.envio_estados e
on conflict do nothing;
insert into tumbo.envio_lugares (lugar, tipo, estado) values
  ('vargas', 'estado', 'La Guaira'), ('distrito federal', 'estado', 'Distrito Capital'), ('dtto capital', 'estado', 'Distrito Capital'),
  ('caracas', 'ciudad', 'Distrito Capital'), ('la guaira', 'ciudad', 'La Guaira'), ('maiquetia', 'ciudad', 'La Guaira'),
  ('catia la mar', 'ciudad', 'La Guaira'), ('los teques', 'ciudad', 'Miranda'), ('guarenas', 'ciudad', 'Miranda'),
  ('guatire', 'ciudad', 'Miranda'), ('petare', 'ciudad', 'Miranda'), ('charallave', 'ciudad', 'Miranda'),
  ('ocumare del tuy', 'ciudad', 'Miranda'), ('maracay', 'ciudad', 'Aragua'), ('la victoria', 'ciudad', 'Aragua'),
  ('turmero', 'ciudad', 'Aragua'), ('valencia', 'ciudad', 'Carabobo'), ('puerto cabello', 'ciudad', 'Carabobo'),
  ('naguanagua', 'ciudad', 'Carabobo'), ('guacara', 'ciudad', 'Carabobo'), ('barquisimeto', 'ciudad', 'Lara'),
  ('cabudare', 'ciudad', 'Lara'), ('carora', 'ciudad', 'Lara'), ('san felipe', 'ciudad', 'Yaracuy'),
  ('coro', 'ciudad', 'Falcón'), ('punto fijo', 'ciudad', 'Falcón'), ('san carlos', 'ciudad', 'Cojedes'),
  ('guanare', 'ciudad', 'Portuguesa'), ('acarigua', 'ciudad', 'Portuguesa'), ('araure', 'ciudad', 'Portuguesa'),
  ('san juan de los morros', 'ciudad', 'Guárico'), ('calabozo', 'ciudad', 'Guárico'), ('valle de la pascua', 'ciudad', 'Guárico'),
  ('maracaibo', 'ciudad', 'Zulia'), ('cabimas', 'ciudad', 'Zulia'), ('ciudad ojeda', 'ciudad', 'Zulia'),
  ('merida', 'ciudad', 'Mérida'), ('el vigia', 'ciudad', 'Mérida'), ('san cristobal', 'ciudad', 'Táchira'),
  ('trujillo', 'ciudad', 'Trujillo'), ('valera', 'ciudad', 'Trujillo'), ('barinas', 'ciudad', 'Barinas'),
  ('san fernando de apure', 'ciudad', 'Apure'), ('barcelona', 'ciudad', 'Anzoátegui'), ('puerto la cruz', 'ciudad', 'Anzoátegui'),
  ('lecheria', 'ciudad', 'Anzoátegui'), ('el tigre', 'ciudad', 'Anzoátegui'), ('maturin', 'ciudad', 'Monagas'),
  ('cumana', 'ciudad', 'Sucre'), ('carupano', 'ciudad', 'Sucre'), ('ciudad bolivar', 'ciudad', 'Bolívar'),
  ('puerto ordaz', 'ciudad', 'Bolívar'), ('ciudad guayana', 'ciudad', 'Bolívar'), ('san felix', 'ciudad', 'Bolívar'),
  ('porlamar', 'ciudad', 'Nueva Esparta'), ('la asuncion', 'ciudad', 'Nueva Esparta'), ('pampatar', 'ciudad', 'Nueva Esparta'),
  ('puerto ayacucho', 'ciudad', 'Amazonas'), ('tucupita', 'ciudad', 'Delta Amacuro'),
  ('chacao', 'municipio', 'Miranda'), ('baruta', 'municipio', 'Miranda'), ('el hatillo', 'municipio', 'Miranda'),
  ('naguanagua', 'municipio', 'Carabobo'), ('san diego', 'municipio', 'Carabobo'), ('maracaibo', 'municipio', 'Zulia'),
  ('lecheria', 'municipio', 'Anzoátegui'), ('maneiro', 'municipio', 'Nueva Esparta')
on conflict do nothing;

-- Tarifas por courier, zona tarifaria, servicio y tramo de peso. La semilla
-- trae valores de REFERENCIA (referencia = true): el personal los cambia por
-- la tarifa vigente de cada courier y al guardarlos dejan de ser referencia.
create table tumbo.tarifas (
  id            bigint generated always as identity primary key,
  courier       text not null references tumbo.couriers (codigo),
  alcance       text not null check (alcance in ('local', 'regional', 'nacional', 'remota')),
  tipo          text not null check (tipo in ('agencia', 'domicilio')),
  peso_hasta_kg numeric(7,2) not null check (peso_hasta_kg > 0 and peso_hasta_kg <= 1000),
  costo_usd     numeric(10,2) not null check (costo_usd >= 0 and costo_usd <= 1000),
  dias_min      integer not null check (dias_min between 0 and 30),
  dias_max      integer not null check (dias_max between 0 and 45),
  referencia    boolean not null default true,
  activo        boolean not null default true,
  actualizado   timestamptz not null default now(),
  por           text,
  unique (courier, alcance, tipo, peso_hasta_kg),
  check (dias_max >= dias_min)
);
alter table tumbo.tarifas enable row level security;
revoke all on tumbo.tarifas from public, anon, authenticated;

insert into tumbo.tarifas (courier, alcance, tipo, peso_hasta_kg, costo_usd, dias_min, dias_max)
select c.codigo, a.alcance, t.tipo, w.peso,
       round((a.base + case when t.tipo = 'domicilio' then a.recargo else 0 end) * w.factor * c.factor * 10) / 10,
       a.dmin, a.dmax + case when t.tipo = 'domicilio' then 1 else 0 end
from (values ('mrw', 1.00), ('zoom', 0.95), ('tealca', 0.98), ('liberty', 1.08), ('domesa', 0.92)) c (codigo, factor)
cross join (values ('local', 2.5, 1.5, 1, 2), ('regional', 3.5, 2.0, 1, 3), ('nacional', 4.5, 2.0, 2, 4),
                   ('remota', 7.0, 2.5, 4, 7)) a (alcance, base, recargo, dmin, dmax)
cross join (values ('agencia'), ('domicilio')) t (tipo)
cross join (values (1, 1.0), (3, 1.35), (5, 1.7), (10, 2.4), (20, 3.6), (30, 4.8)) w (peso, factor)
on conflict (courier, alcance, tipo, peso_hasta_kg) do nothing;

-- Oficinas de los couriers: las carga el personal con sus datos reales.
create table tumbo.oficinas (
  id          bigint generated always as identity primary key,
  courier     text not null references tumbo.couriers (codigo),
  estado      text not null references tumbo.envio_estados (estado),
  ciudad      text not null check (char_length(ciudad) between 2 and 60),
  nombre      text not null check (char_length(nombre) between 3 and 80),
  direccion   text not null check (char_length(direccion) between 10 and 300),
  telefono    text check (char_length(telefono) <= 30),
  horario     text check (char_length(horario) <= 120),
  activa      boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  por         text
);
create index oficinas_estado_idx on tumbo.oficinas (estado, courier) where activa;
alter table tumbo.oficinas enable row level security;
revoke all on tumbo.oficinas from public, anon, authenticated;

-- Feriados nacionales (Ley Orgánica del Trabajo, art. 184): no cuentan como
-- días hábiles en las promesas de entrega ni en los plazos.
create table tumbo.feriados (
  fecha  date primary key,
  nombre text not null check (char_length(nombre) between 3 and 80),
  activo boolean not null default true
);
alter table tumbo.feriados enable row level security;
revoke all on tumbo.feriados from public, anon, authenticated;

insert into tumbo.feriados (fecha, nombre) values
  ('2026-01-01', 'Año Nuevo'), ('2026-02-16', 'Lunes de Carnaval'), ('2026-02-17', 'Martes de Carnaval'),
  ('2026-04-02', 'Jueves Santo'), ('2026-04-03', 'Viernes Santo'), ('2026-04-19', 'Declaración de la Independencia'),
  ('2026-05-01', 'Día del Trabajador'), ('2026-06-24', 'Batalla de Carabobo'), ('2026-07-05', 'Día de la Independencia'),
  ('2026-07-24', 'Natalicio del Libertador'), ('2026-10-12', 'Día de la Resistencia Indígena'),
  ('2026-12-24', 'Nochebuena'), ('2026-12-25', 'Navidad'), ('2026-12-31', 'Fin de año'),
  ('2027-01-01', 'Año Nuevo'), ('2027-02-08', 'Lunes de Carnaval'), ('2027-02-09', 'Martes de Carnaval'),
  ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'), ('2027-04-19', 'Declaración de la Independencia'),
  ('2027-05-01', 'Día del Trabajador'), ('2027-06-24', 'Batalla de Carabobo'), ('2027-07-05', 'Día de la Independencia'),
  ('2027-07-24', 'Natalicio del Libertador'), ('2027-10-12', 'Día de la Resistencia Indígena'),
  ('2027-12-24', 'Nochebuena'), ('2027-12-25', 'Navidad'), ('2027-12-31', 'Fin de año')
on conflict (fecha) do nothing;

-- ---------------------------------------------------------------------------
-- Configuración de envíos del comercio
-- ---------------------------------------------------------------------------
create table tumbo.envio_config (
  seller_id          text primary key references tumbo.sellers (id) on delete cascade,
  origen_estado      text not null references tumbo.envio_estados (estado),
  origen_ciudad      text not null check (char_length(origen_ciudad) between 2 and 60),
  couriers           text[] not null default '{}' check (cardinality(couriers) <= 10),
  -- [{municipio, estado?, costo_usd, dias}]: delivery propio por municipio
  delivery           jsonb not null default '[]'::jsonb check (jsonb_typeof(delivery) = 'array' and jsonb_array_length(delivery) <= 40),
  retiro_tienda      boolean not null default false,
  retiro_direccion   text check (char_length(retiro_direccion) <= 300),
  retiro_horario     text check (char_length(retiro_horario) <= 120),
  gratis_desde_usd   numeric(10,2) check (gratis_desde_usd > 0),
  dias_preparacion   integer not null default 1 check (dias_preparacion between 1 and 10),
  cobro_destino      boolean not null default false,
  vacaciones         boolean not null default false,
  vacaciones_hasta   date,
  vacaciones_mensaje text check (char_length(vacaciones_mensaje) <= 200),
  actualizado        timestamptz not null default now(),
  por                text
);
alter table tumbo.envio_config enable row level security;
revoke all on tumbo.envio_config from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Por pedido. Sin claves foráneas hacia tumbo.pedidos: el reinicio de la demo
-- lo vacía con TRUNCATE (que no admite referencias desde fuera de su lista) y
-- tumbo_privado.sembrar_ext_logistica limpia estas tablas.
-- ---------------------------------------------------------------------------
create table tumbo.envios (
  pedido_id            text primary key,
  seller_id            text not null,
  codigo               text,               -- la opción elegida (mrw:agencia, propio:domicilio, tienda:retiro…)
  courier              text,               -- código del courier
  servicio             text,
  tipo                 text,
  retiro               boolean not null default false,
  oficina_id           bigint,
  cobro_destino        boolean not null default false,
  costo_cotizado_usd   numeric(10,2),
  peso_kg              numeric(8,2),
  dias_min             integer,
  dias_max             integer,
  prepara_dias         integer,
  fecha_minima         date,
  fecha_prometida      date,               -- hasta cuándo se prometió la entrega (días hábiles)
  referencia           text,               -- la de la etiqueta de Tumbo (no es la guía del courier)
  guia                 text,               -- la guía real que da el courier al recibir el paquete
  guia_foto            uuid,
  guia_foto_lote       boolean not null default false,   -- foto de un lote (puede mostrar a otros destinatarios)
  despachado_por       text,
  conciliado_en        timestamptz,
  aceptar_antes        timestamptz,
  despachar_antes      timestamptz,
  aceptado_en          timestamptz,
  listo_en             timestamptz,
  despachado_en        timestamptz,
  en_agencia_en        timestamptz,
  entregado_en         timestamptz,
  cancelado_en         timestamptz,
  autoconfirmar_el     timestamptz,
  recordado_en         timestamptz,
  escalado_aceptar_en  timestamptz,
  escalado_despacho_en timestamptz,
  aviso_autoconfirmar_en timestamptz,
  entrega_foto         uuid,
  entrega_nota         text,
  entrega_por          text,
  responsable_id       uuid,
  responsable          text,
  asignado_en          timestamptz,
  creado               timestamptz not null default now()
);
create index envios_seller_idx on tumbo.envios (seller_id);
create index envios_guia_idx on tumbo.envios (courier, guia) where guia is not null;
alter table tumbo.envios enable row level security;
revoke all on tumbo.envios from public, anon, authenticated;

create table tumbo.incidencias (
  id          bigint generated always as identity primary key,
  pedido_id   text not null,
  seller_id   text not null,
  tipo        text not null check (tipo in ('sin_stock', 'danado', 'courier_no_retiro', 'direccion_incorrecta',
                                            'retraso', 'perdida', 'dano_courier', 'reenvio', 'otro')),
  origen      text not null check (origen in ('seller', 'ops', 'sistema')),
  detalle     text not null check (char_length(detalle) between 3 and 500),
  datos       jsonb not null default '{}'::jsonb,
  estado      text not null default 'abierta' check (estado in ('abierta', 'resuelta')),
  resolucion  text check (char_length(resolucion) <= 500),
  creado      timestamptz not null default now(),
  por         text not null,
  resuelta_en timestamptz,
  resuelta_por text
);
create index incidencias_pedido_idx on tumbo.incidencias (pedido_id, creado);
create index incidencias_abiertas_idx on tumbo.incidencias (creado) where estado = 'abierta';
alter table tumbo.incidencias enable row level security;
revoke all on tumbo.incidencias from public, anon, authenticated;

create table tumbo.cancelaciones (
  id            bigint generated always as identity primary key,
  pedido_id     text not null,
  seller_id     text not null,
  por           text not null check (por in ('comprador', 'seller', 'ops', 'sistema')),
  motivo        text not null,
  culpa_seller  boolean not null,
  detalle       text,
  estado_previo text not null,
  reembolso_id  bigint,
  actor         text not null,
  creado        timestamptz not null default now()
);
create index cancelaciones_seller_idx on tumbo.cancelaciones (seller_id, creado);
create index cancelaciones_pedido_idx on tumbo.cancelaciones (pedido_id);
alter table tumbo.cancelaciones enable row level security;
revoke all on tumbo.cancelaciones from public, anon, authenticated;

create table tumbo.solicitudes_cancelacion (
  id           bigint generated always as identity primary key,
  pedido_id    text not null,
  seller_id    text not null,
  motivo       text check (char_length(motivo) <= 200),
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'automatica', 'cerrada')),
  respuesta    text check (char_length(respuesta) <= 300),
  creado       timestamptz not null default now(),
  vence        timestamptz not null,
  decidido_en  timestamptz,
  decidido_por text
);
create unique index solicitudes_pendiente_idx on tumbo.solicitudes_cancelacion (pedido_id) where estado = 'pendiente';
create index solicitudes_vence_idx on tumbo.solicitudes_cancelacion (vence) where estado = 'pendiente';
create index solicitudes_pedido_idx on tumbo.solicitudes_cancelacion (pedido_id, creado);
alter table tumbo.solicitudes_cancelacion enable row level security;
revoke all on tumbo.solicitudes_cancelacion from public, anon, authenticated;

-- Notas internas del equipo: nunca las ve el comprador ni el comercio.
create table tumbo.notas_pedido (
  id        bigint generated always as identity primary key,
  pedido_id text not null,
  autor_id  uuid,
  autor     text not null,
  texto     text not null check (char_length(texto) between 3 and 1000),
  creado    timestamptz not null default now()
);
create index notas_pedido_idx on tumbo.notas_pedido (pedido_id, creado);
alter table tumbo.notas_pedido enable row level security;
revoke all on tumbo.notas_pedido from public, anon, authenticated;

create table tumbo.devoluciones (
  pedido_id         text primary key,
  seller_id         text not null,
  disputa_id        text,
  motivo            text,
  paga              text not null check (paga in ('comprador', 'seller', 'tumbo')),
  oficina_id        bigint,
  instrucciones     text not null check (char_length(instrucciones) <= 900),
  estado            text not null default 'instrucciones' check (estado in ('instrucciones', 'en_transito', 'recibida', 'cerrada')),
  courier           text,
  guia              text,
  enviada_en        timestamptz,
  recibida_en       timestamptz,
  inspeccion        text check (inspeccion in ('apto', 'danado', 'incompleto')),
  inspeccion_nota   text check (char_length(inspeccion_nota) <= 500),
  inspeccion_foto   uuid,
  inspeccionada_por text,
  cerrada_en        timestamptz,
  creado            timestamptz not null default now(),
  actualizado       timestamptz not null default now()
);
alter table tumbo.devoluciones enable row level security;
revoke all on tumbo.devoluciones from public, anon, authenticated;

create table tumbo.tareas_registro (
  tarea   text primary key,
  ultima  timestamptz not null,
  resumen jsonb not null default '{}'::jsonb
);
alter table tumbo.tareas_registro enable row level security;
revoke all on tumbo.tareas_registro from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ayudantes: fechas, días hábiles, lugares y textos
-- ---------------------------------------------------------------------------
create function tumbo_privado.hoy() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Caracas')::date
$$;

-- El final (medianoche de Caracas) de un día.
create function tumbo_privado.fin_dia(p date) returns timestamptz
language sql immutable set search_path = '' as $$
  select ((p + 1)::timestamp at time zone 'America/Caracas')
$$;

create function tumbo_privado.es_habil(p date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p) < 6 and not exists (select 1 from tumbo.feriados f where f.fecha = p and f.activo)
$$;

-- p_desde + p_dias días hábiles (sin sábados, domingos ni feriados).
create function tumbo_privado.sumar_habiles(p_desde date, p_dias integer) returns date
language plpgsql stable security definer set search_path = '' as $$
declare
  d date := p_desde;
  n integer := greatest(coalesce(p_dias, 0), 0);
  i integer := 0;
begin
  if d is null then
    return null;
  end if;
  while n > 0 and i < 500 loop
    d := d + 1;
    i := i + 1;
    if tumbo_privado.es_habil(d) then
      n := n - 1;
    end if;
  end loop;
  return d;
end $$;

-- «jue 29/10/2026»
create function tumbo_privado.fecha_corta(p date) returns text
language sql stable set search_path = '' as $$
  select case when p is null then null
              else (array['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'])[extract(isodow from p)::int] || ' ' || to_char(p, 'DD/MM/YYYY') end
$$;

-- «29/10/2026 03:15 pm (hora de Caracas)»
create function tumbo_privado.fecha_hora_ve(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select case when p is null then null
              else to_char(p at time zone 'America/Caracas', 'DD/MM/YYYY HH12:MI ') ||
                   lower(to_char(p at time zone 'America/Caracas', 'am')) || ' (hora de Caracas)' end
$$;

-- El estado de un nombre escrito a mano, buscando por los tipos indicados en
-- ese orden de preferencia.
create function tumbo_privado.lugar_estado(p text, p_tipos text[]) returns text
language sql stable security definer set search_path = '' as $$
  select l.estado from tumbo.envio_lugares l
  where l.lugar = tumbo_privado.lugar_clave(p) and l.tipo = any (p_tipos)
  order by array_position(p_tipos, l.tipo) limit 1
$$;

-- El estado de destino de una dirección: el estado escrito, si no el
-- municipio (solo los que no se repiten) y si no la ciudad.
create function tumbo_privado.destino_estado(p_destino jsonb) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    tumbo_privado.lugar_estado(p_destino ->> 'estado', array['estado']),
    tumbo_privado.lugar_estado(p_destino ->> 'municipio', array['municipio']),
    tumbo_privado.lugar_estado(p_destino ->> 'ciudad', array['ciudad', 'estado', 'municipio']))
$$;

-- Zona tarifaria entre dos estados.
create function tumbo_privado.alcance_envio(p_origen text, p_destino text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_origen is null or p_destino is null then 'nacional'
    when p_origen = p_destino then 'local'
    when exists (select 1 from tumbo.envio_estados e join tumbo.envio_zonas z on z.codigo = e.zona
                 where e.estado in (p_origen, p_destino) and z.remota) then 'remota'
    when (select e.zona from tumbo.envio_estados e where e.estado = p_origen)
       = (select e.zona from tumbo.envio_estados e where e.estado = p_destino) then 'regional'
    else 'nacional' end
$$;

-- Cuándo se da por recibida una entrega que el comprador no confirmó: los
-- días del ajuste desde el despacho, pero nunca antes de que termine el plazo
-- del reclamo «no llegó» (fecha prometida + días hábiles de gracia).
create function tumbo_privado.autoconfirmar_desde(p_despacho timestamptz, p_prometida date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(coalesce(p_despacho, now()) + make_interval(days => tumbo_privado.logistica('autoconfirmar_dias', 10)::integer),
                  tumbo_privado.fin_dia(tumbo_privado.sumar_habiles(coalesce(p_prometida, tumbo_privado.hoy()),
                                                                    tumbo_privado.logistica('reclamo_no_llego_habiles', 2)::integer + 1)))
$$;

-- Un enlace a una página del sitio: con la URL pública del sitio si la
-- plataforma la conoce (tumbo_privado.url_sitio, ola 1 de cuentas); si no,
-- la ruta relativa.
create function tumbo_privado.enlace_app(p_ruta text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v text;
begin
  if to_regprocedure('tumbo_privado.url_sitio(text)') is not null then
    execute 'select tumbo_privado.url_sitio($1)' into v using p_ruta;
    if v ~ '^https?://' then
      return v;
    end if;
  end if;
  return p_ruta;
exception when others then
  return p_ruta;
end $$;

create function tumbo_privado.texto_motivo(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'sin_stock' then 'sin stock' when 'producto_danado' then 'producto dañado en el almacén'
    when 'no_cubre_destino' then 'el comercio no envía a ese destino' when 'fraude' then 'posible fraude'
    when 'quiebre_stock' then 'quiebre de stock del comercio' when 'direccion_imposible' then 'dirección imposible de entregar'
    when 'perdida_courier' then 'pérdida del paquete en el courier'
    when 'sin_aceptar' then 'el comercio no aceptó el pedido a tiempo'
    when 'solicitud_comprador' then 'a pedido del comprador' else coalesce(p, 'sin motivo') end
$$;

create function tumbo_privado.texto_incidencia(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'sin_stock' then 'Sin stock' when 'danado' then 'Producto dañado' when 'courier_no_retiro' then 'El courier no retiró'
    when 'direccion_incorrecta' then 'Dirección incorrecta' when 'retraso' then 'Retraso del courier'
    when 'perdida' then 'Pérdida en el courier' when 'dano_courier' then 'Daño en el courier' when 'reenvio' then 'Reenvío'
    else 'Otra novedad' end
$$;

-- Las novedades que también ve el comprador.
create function tumbo_privado.incidencia_publica(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p in ('direccion_incorrecta', 'retraso', 'perdida', 'dano_courier', 'reenvio'), false)
$$;

create function tumbo_privado.ocultar(p text, p_visibles integer) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or btrim(p) = '' then null
              when char_length(regexp_replace(p, '[^0-9A-Za-z]', '', 'g')) <= p_visibles then '••••'
              else '••••' || right(regexp_replace(p, '[^0-9A-Za-z]', '', 'g'), p_visibles) end
$$;

-- El reclamo sin resolver de un pedido (o null). Mientras exista, el dinero
-- del pedido se decide por el reclamo: ni la entrega confirmada ni una
-- cancelación lo descongelan o lo reembolsan por su cuenta.
create function tumbo_privado.disputa_abierta(p_pedido text) returns text
language sql stable security definer set search_path = '' as $$
  select d.id from tumbo.disputas d where d.pedido_id = p_pedido and d.estado <> 'resuelta' order by d.creado desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Configuración efectiva de un comercio y cotización
-- ---------------------------------------------------------------------------
-- La guardada o, si el comercio aún no configuró sus envíos, la de omisión:
-- origen en su ciudad, todos los couriers activos y un día de preparación.
create function tumbo_privado.config_envio(p_seller text) returns tumbo.envio_config
language plpgsql stable security definer set search_path = '' as $$
declare
  c tumbo.envio_config;
  s tumbo.sellers;
begin
  select * into c from tumbo.envio_config where seller_id = p_seller;
  if found then
    return c;
  end if;
  select * into s from tumbo.sellers where id = p_seller;
  c.seller_id := p_seller;
  c.origen_ciudad := coalesce(s.ciudad, 'Caracas');
  c.origen_estado := coalesce(tumbo_privado.lugar_estado(s.ciudad, array['ciudad', 'estado', 'municipio']), 'Distrito Capital');
  select coalesce(array_agg(x.codigo order by x.orden, x.codigo), '{}') into c.couriers
  from tumbo.couriers x where x.activo and x.tipo = 'courier';
  c.delivery := '[]'::jsonb;
  c.retiro_tienda := false;
  c.dias_preparacion := 1;
  c.cobro_destino := false;
  c.vacaciones := false;
  return c;
end $$;

create function tumbo_privado.vacaciones_activas(c tumbo.envio_config) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(c.vacaciones and (c.vacaciones_hasta is null or c.vacaciones_hasta >= tumbo_privado.hoy()), false)
$$;

create function tumbo_privado.mensaje_vacaciones(p_nombre text, c tumbo.envio_config) returns text
language sql stable set search_path = '' as $$
  select 'El comercio «' || coalesce(p_nombre, c.seller_id) || '» está de vacaciones' ||
         coalesce(' hasta el ' || to_char(c.vacaciones_hasta, 'DD/MM/YYYY'), '') ||
         ' y no recibe pedidos por ahora: quita sus productos del carrito para continuar.'
$$;

-- Peso (kg), subtotal (USD) y unidades de unas líneas [{sku, cant}]: el
-- peso del producto si lo tiene (peso_kg, del catálogo), si no el de omisión.
create function tumbo_privado.carga_items(p_items jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  with l as (
    select least(greatest(coalesce(i.cant, 1), 1), 99) as cant, p.precio_usd,
           coalesce(case when (to_jsonb(p) ->> 'peso_kg') ~ '^[0-9]{1,4}(\.[0-9]+)?$' and (to_jsonb(p) ->> 'peso_kg')::numeric > 0
                         then (to_jsonb(p) ->> 'peso_kg')::numeric end,
                    tumbo_privado.logistica('peso_defecto_kg', 1)) as peso
    from (select * from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
                        as x (sku text, cant integer) limit 100) i
    join tumbo.productos p on p.sku = i.sku)
  select jsonb_build_object('peso_kg', coalesce(sum(l.peso * l.cant), 0),
                            'subtotal_usd', coalesce(sum(l.precio_usd * l.cant), 0),
                            'unidades', coalesce(sum(l.cant), 0))
  from l
$$;

create function tumbo_privado.tarifa_envio(p_courier text, p_alcance text, p_tipo text, p_peso numeric) returns tumbo.tarifas
language sql stable security definer set search_path = '' as $$
  select t.* from tumbo.tarifas t
  where t.courier = p_courier and t.alcance = p_alcance and t.tipo = p_tipo and t.activo and t.peso_hasta_kg >= p_peso
  order by t.peso_hasta_kg limit 1
$$;

create function tumbo_privado.opcion_envio(p_codigo text, p_tipo text, p_courier tumbo.couriers, p_servicio text, p_costo numeric,
                                           p_dmin integer, p_dmax integer, p_retiro boolean, p_descripcion text, p_gratis boolean,
                                           p_cobro boolean, p_estimado numeric, p_referencia boolean, p_alcance text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_codigo, 'codigo', p_codigo, 'tipo', p_tipo, 'courier', p_courier.nombre, 'courier_codigo', p_courier.codigo,
    'servicio', p_servicio,
    'costo_usd', case when p_gratis and not p_cobro then 0 else round(coalesce(p_costo, 0), 2) end,
    'costo_original_usd', case when p_gratis and not p_cobro and coalesce(p_costo, 0) > 0 then round(p_costo, 2) end,
    'gratis', p_gratis and not p_cobro and coalesce(p_costo, 0) > 0,
    'cobro_destino', p_cobro, 'costo_estimado_usd', case when p_cobro then round(p_estimado, 2) end,
    'dias_min', p_dmin, 'dias_max', p_dmax,
    'fecha_min', tumbo_privado.sumar_habiles(tumbo_privado.hoy(), p_dmin),
    'fecha_max', tumbo_privado.sumar_habiles(tumbo_privado.hoy(), p_dmax),
    'retiro', p_retiro, 'descripcion', p_descripcion, 'tarifa_referencia', coalesce(p_referencia, false),
    'alcance', p_alcance, 'rastreo', p_courier.url_rastreo is not null,
    -- llega al estado del comprador (courier o delivery); el retiro en tienda
    -- es en la ciudad del comercio
    'en_destino', p_courier.tipo is distinct from 'tienda')
$$;

-- Todas las opciones de envío de un comercio a un destino para unas líneas.
-- No falla: un comercio de vacaciones devuelve sus opciones y el aviso en
-- «vacaciones» (cotizar_envio, el contrato, sí lo rechaza). Con p_todos, los
-- couriers activos aunque el comercio no los ofrezca (para ubicar la opción
-- de un pedido ya hecho).
create function tumbo_privado.opciones_envio(p_seller text, p_destino jsonb, p_items jsonb, p_todos boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c tumbo.envio_config := tumbo_privado.config_envio(p_seller);
  s tumbo.sellers;
  v_dest jsonb := case when jsonb_typeof(p_destino) = 'object' then p_destino else '{}'::jsonb end;
  v_estado text := tumbo_privado.destino_estado(v_dest);
  v_alcance text;
  v_carga jsonb := tumbo_privado.carga_items(p_items);
  v_peso numeric;
  v_sub numeric := (v_carga ->> 'subtotal_usd')::numeric;
  v_gratis boolean;
  v_prep integer;
  v_ops jsonb := '[]'::jsonb;
  v_muni text := tumbo_privado.lugar_clave(v_dest ->> 'municipio');
  v_ciudad text := tumbo_privado.lugar_clave(v_dest ->> 'ciudad');
  k tumbo.couriers;
  pr tumbo.couriers;
  t tumbo.tarifas;
  d jsonb;
begin
  select * into s from tumbo.sellers where id = p_seller;
  if s.id is null then
    return jsonb_build_object('opciones', '[]'::jsonb, 'error', 'El comercio no existe.');
  end if;
  v_prep := coalesce(c.dias_preparacion, 1);
  v_alcance := tumbo_privado.alcance_envio(c.origen_estado, v_estado);
  v_peso := case when (v_carga ->> 'unidades')::numeric > 0 then greatest((v_carga ->> 'peso_kg')::numeric, 0.01)
                 else tumbo_privado.logistica('peso_defecto_kg', 1) end;
  v_gratis := c.gratis_desde_usd is not null and v_sub >= c.gratis_desde_usd;

  for k in select x.* from tumbo.couriers x
           where x.activo and x.tipo = 'courier' and (p_todos or x.codigo = any (c.couriers))
           order by x.orden, x.codigo loop
    if k.agencia then
      t := tumbo_privado.tarifa_envio(k.codigo, v_alcance, 'agencia', v_peso);
      if t.id is not null then
        v_ops := v_ops || tumbo_privado.opcion_envio(k.codigo || ':agencia', 'agencia', k, 'Retiro en agencia', t.costo_usd,
          v_prep + t.dias_min, v_prep + t.dias_max, true,
          'Retiras en una agencia de ' || k.nombre || coalesce(' en ' || v_estado, ''), v_gratis, false, null, t.referencia, v_alcance);
        if k.cobro_destino and c.cobro_destino then
          v_ops := v_ops || tumbo_privado.opcion_envio(k.codigo || ':agencia:cobro_destino', 'agencia', k,
            'Retiro en agencia · pagas el envío al retirar', 0, v_prep + t.dias_min, v_prep + t.dias_max, true,
            'Pagas el envío (unos ' || tumbo_privado.fmt_usd(t.costo_usd) || ') al retirar en la agencia de ' || k.nombre,
            false, true, t.costo_usd, t.referencia, v_alcance);
        end if;
      end if;
    end if;
    if k.domicilio then
      t := tumbo_privado.tarifa_envio(k.codigo, v_alcance, 'domicilio', v_peso);
      if t.id is not null then
        v_ops := v_ops || tumbo_privado.opcion_envio(k.codigo || ':domicilio', 'domicilio', k, 'Entrega a domicilio', t.costo_usd,
          v_prep + t.dias_min, v_prep + t.dias_max, false, 'Entrega en tu dirección con ' || k.nombre, v_gratis, false, null,
          t.referencia, v_alcance);
      end if;
    end if;
  end loop;

  -- Delivery propio: solo en los municipios que el comercio cubre, del mismo
  -- estado (Libertador, Sucre o Bolívar se repiten en varios estados). Una
  -- zona guardada sin estado es del estado de origen; con un destino de
  -- estado desconocido no se ofrece.
  select * into pr from tumbo.couriers where codigo = 'propio' and activo;
  if pr.codigo is not null and v_estado is not null and coalesce(v_muni, v_ciudad) is not null then
    for d in select x from jsonb_array_elements(c.delivery) x loop
      if tumbo_privado.lugar_clave(d ->> 'municipio') in (v_muni, v_ciudad)
         and coalesce(nullif(d ->> 'estado', ''), c.origen_estado) = v_estado then
        v_ops := v_ops || tumbo_privado.opcion_envio('propio:domicilio', 'domicilio', pr, 'Delivery propio',
          (d ->> 'costo_usd')::numeric, v_prep, v_prep + coalesce((d ->> 'dias')::integer, 1), false,
          'Entrega en ' || (d ->> 'municipio') || ' con el delivery de ' || s.nombre, v_gratis, false, null, false, 'local');
        exit;
      end if;
    end loop;
  end if;

  select * into pr from tumbo.couriers where codigo = 'tienda' and activo;
  if pr.codigo is not null and c.retiro_tienda then
    v_ops := v_ops || tumbo_privado.opcion_envio('tienda:retiro', 'agencia', pr, 'Retiro en tienda', 0, v_prep, v_prep, true,
      'Retiras en la tienda de ' || s.nombre || ' en ' || c.origen_ciudad, false, false, null, false, 'local');
  end if;

  -- primero las que llegan al estado del comprador y se pagan ahora; después
  -- las de cobro en destino (costo 0 en el checkout porque se pagan al
  -- retirar) y al final el retiro en la tienda del comercio (en su ciudad):
  -- ni la promesa de la ficha ni la opción por omisión del checkout salen de
  -- una opción que no entrega en el destino
  select coalesce(jsonb_agg(o order by not (o ->> 'en_destino')::boolean, (o ->> 'cobro_destino')::boolean, (o ->> 'costo_usd')::numeric,
                                       (o ->> 'dias_max')::integer, o ->> 'codigo'), '[]'::jsonb)
    into v_ops from jsonb_array_elements(v_ops) o;

  return jsonb_build_object(
    'seller', p_seller,
    'origen', jsonb_build_object('estado', c.origen_estado, 'ciudad', c.origen_ciudad),
    'destino', jsonb_build_object('estado', v_estado, 'ciudad', v_dest ->> 'ciudad', 'municipio', v_dest ->> 'municipio',
                                  'estimado', v_estado is null),
    'alcance', v_alcance, 'peso_kg', round(v_peso, 2), 'subtotal_usd', v_sub,
    'gratis_desde_usd', c.gratis_desde_usd, 'dias_preparacion', v_prep,
    'delivery_municipios', coalesce((select jsonb_agg((x ->> 'municipio') || ' (' || coalesce(nullif(x ->> 'estado', ''), c.origen_estado) || ')')
                                     from jsonb_array_elements(c.delivery) x), '[]'::jsonb),
    'retiro_tienda', c.retiro_tienda,
    'vacaciones', case when tumbo_privado.vacaciones_activas(c) then jsonb_build_object(
                    'hasta', c.vacaciones_hasta, 'mensaje', c.vacaciones_mensaje,
                    'mensaje_compra', tumbo_privado.mensaje_vacaciones(s.nombre, c)) end,
    'opciones', v_ops);
end $$;

-- Contrato (ola 0): las opciones de envío de un comercio a un destino para
-- unas líneas [{sku, cant}]. Cada opción conserva las claves de la versión
-- mínima (tipo, courier, costo_usd, dias_min, dias_max, descripcion) y suma
-- id y codigo (el mismo valor, estable: «mrw:agencia»; guárdalo en el pedido
-- como destino.opcion o destino.envio_codigo), servicio, retiro, fecha_min,
-- fecha_max, gratis, cobro_destino… Las de cobro en destino cuestan 0 en el
-- checkout (el comprador paga al retirar): no las elijas por omisión.
-- p_destino: {estado, ciudad, municipio} (los nombres se ubican aunque
-- vengan sin tildes). Un comercio de vacaciones no recibe pedidos: se
-- rechaza con un mensaje para la persona.
create or replace function tumbo_privado.cotizar_envio(p_seller text, p_destino jsonb, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb := tumbo_privado.opciones_envio(p_seller, p_destino, p_items, false);
begin
  if jsonb_typeof(r -> 'vacaciones') = 'object' then
    raise exception '%', r -> 'vacaciones' ->> 'mensaje_compra';
  end if;
  return coalesce(r -> 'opciones', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- El envío de un pedido
-- ---------------------------------------------------------------------------
-- El destino de un pedido: la foto de la dirección que guarda el checkout
-- (pedidos.destino) o, si viene vacía, lo que dice envio_dir.
create function tumbo_privado.destino_pedido(v tumbo.pedidos) returns jsonb
language sql stable set search_path = '' as $$
  select case
    when jsonb_typeof(v.destino) = 'object' and v.destino <> '{}'::jsonb then v.destino
    else jsonb_build_object('linea', v.envio_dir,
                            'municipio', nullif(btrim(split_part(coalesce(v.envio_dir, ''), ',', -1)), ''),
                            'ciudad', nullif(btrim(split_part(coalesce(v.envio_dir, ''), ',', -1)), '')) end
$$;

-- Datos completos del destinatario (para la etiqueta y para entregar): los
-- del checkout o, si faltan, los de la cuenta del comprador.
create function tumbo_privado.destinatario_pedido(v tumbo.pedidos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb := case when jsonb_typeof(v.destino) = 'object' then v.destino else '{}'::jsonb end;
  u tumbo.usuarios;
  dir tumbo.direcciones;
  tel text;
begin
  select * into u from tumbo.usuarios where id = v.comprador_id;
  -- sin foto del checkout (pedidos de antes de la ola 1): la dirección del
  -- comprador que coincide con la del pedido, si sigue guardada
  if d = '{}'::jsonb and v.envio_tipo = 'domicilio' then
    select * into dir from tumbo.direcciones x
    where x.usuario_id = v.comprador_id and position(x.linea in coalesce(v.envio_dir, '')) = 1
    order by x.predeterminada desc, x.creado limit 1;
    if found then
      d := (to_jsonb(dir) - 'id' - 'usuario_id' - 'creado' - 'predeterminada' - 'nombre') || jsonb_build_object('fuente_direccion', true);
    end if;
  end if;
  tel := coalesce(nullif(btrim(d ->> 'telefono_destinatario'), ''), nullif(nullif(btrim(d ->> 'telefono'), ''), '—'), u.telefono);
  return jsonb_build_object(
    'nombre', coalesce(nullif(btrim(d ->> 'destinatario'), ''), nullif(btrim(d ->> 'nombre_destinatario'), ''), u.nombre),
    'cedula', coalesce(nullif(btrim(d ->> 'cedula_destinatario'), ''), nullif(btrim(d ->> 'cedula'), ''), u.cedula),
    'telefono', tel,
    'direccion', coalesce(nullif(btrim(d ->> 'linea'), ''), nullif(btrim(d ->> 'direccion'), ''), v.envio_dir),
    'referencia', nullif(btrim(d ->> 'referencia'), ''),
    'parroquia', nullif(btrim(d ->> 'parroquia'), ''),
    'municipio', nullif(btrim(d ->> 'municipio'), ''),
    'ciudad', nullif(btrim(d ->> 'ciudad'), ''),
    'estado', coalesce(tumbo_privado.destino_estado(d), tumbo_privado.destino_estado(tumbo_privado.destino_pedido(v))),
    'codigo_postal', coalesce(nullif(btrim(d ->> 'codigo_postal'), ''), nullif(btrim(d ->> 'codigo'), '')),
    'fuente', case when d ? 'fuente_direccion' then 'direccion' when d <> '{}'::jsonb then 'checkout' else 'pedido' end);
end $$;

-- Lo que una persona puede ver del destinatario. El comercio (seller u
-- operador) solo mientras el pedido está activo; el equipo, mientras está
-- activo o con un reclamo o una devolución en curso. Fuera de eso, solo la
-- ciudad y el estado.
create function tumbo_privado.destinatario_visible(p_yo tumbo.usuarios, v tumbo.pedidos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb := tumbo_privado.destinatario_pedido(v);
  v_activo boolean := v.estado in ('por_aceptar', 'preparando', 'listo', 'despachado');
  v_caso boolean := v.estado = 'devolucion'
    or exists (select 1 from tumbo.disputas x where x.pedido_id = v.id and x.estado <> 'resuelta');
begin
  if p_yo.id = v.comprador_id then
    return d || jsonb_build_object('oculto', false);
  end if;
  if (p_yo.rol in ('seller', 'operador') and p_yo.seller_id = v.seller_id and v_activo)
     or (p_yo.rol in ('ops', 'superadmin') and (v_activo or v_caso)) then
    return d || jsonb_build_object('oculto', false);
  end if;
  if p_yo.rol in ('seller', 'operador', 'ops', 'superadmin') then
    return jsonb_build_object('oculto', true, 'ciudad', d ->> 'ciudad', 'estado', d ->> 'estado',
      'nombre', case when p_yo.rol in ('ops', 'superadmin') then left(d ->> 'nombre', 1) || '•••' end,
      'telefono', case when p_yo.rol in ('ops', 'superadmin') then tumbo_privado.ocultar(d ->> 'telefono', 4) end);
  end if;
  return null;
end $$;

-- Contrato para quien arme la lista de pedidos del comercio (tm_cargar, de
-- Catálogo): recibe el pedido y el JSON que se iba a entregar y, si quien
-- mira es el seller o su operador y el pedido ya no está activo, quita la
-- foto del destino y deja en envio_dir solo la ciudad y el estado. El mismo
-- mínimo privilegio que tm_pedido_envio.
create function tumbo_privado.pedido_comercio_json(p_rol text, v tumbo.pedidos, j jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_rol in ('seller', 'operador') and v.estado not in ('por_aceptar', 'preparando', 'listo', 'despachado') then
      (j - 'destino') || jsonb_build_object('envio_dir',
        coalesce(nullif(concat_ws(', ', x.d ->> 'ciudad', x.d ->> 'estado'), ''), 'Dirección oculta: el pedido ya no está activo'))
    else j end
  from (select tumbo_privado.destinatario_pedido(v) as d) x
$$;

-- El envío del pedido; si aún no tiene fila (pedidos de antes de esta ola o
-- sembrados por otro dominio), se crea con la opción que corresponde a su
-- courier y tipo. Los relojes de un pedido activo arrancan al crearla.
create function tumbo_privado.envio_asegurar(p_pedido text) returns tumbo.envios
language plpgsql security definer set search_path = '' as $$
declare
  e tumbo.envios;
  v tumbo.pedidos;
  r jsonb;
  o jsonb;
  v_items jsonb;
  v_dest jsonb;
  v_codigo text;
  v_cour text;
  v_base date;
  v_hoy date := tumbo_privado.hoy();
  c tumbo.envio_config;
begin
  select * into e from tumbo.envios where pedido_id = p_pedido;
  if found then
    return e;
  end if;
  select * into v from tumbo.pedidos where id = p_pedido;
  if not found then
    return null;
  end if;
  c := tumbo_privado.config_envio(v.seller_id);
  v_dest := tumbo_privado.destino_pedido(v);
  select coalesce(jsonb_agg(jsonb_build_object('sku', i.sku, 'cant', i.cant)), '[]'::jsonb) into v_items
  from tumbo.pedido_items i where i.pedido_id = v.id;
  v_codigo := coalesce(to_jsonb(v) ->> 'envio_codigo', v.destino ->> 'envio_codigo', v.destino ->> 'opcion', v.destino -> 'envio' ->> 'codigo');
  v_cour := tumbo_privado.lugar_clave(regexp_replace(coalesce(v.courier, ''), '\(.*\)', '', 'g'));

  -- 1) el código que guardó el checkout; 2) el mismo courier y tipo entre las
  -- del comercio; 3) entre todos los couriers; 4) la primera del mismo tipo
  r := tumbo_privado.opciones_envio(v.seller_id, v_dest, v_items, false);
  select x into o from jsonb_array_elements(r -> 'opciones') x where x ->> 'codigo' = v_codigo limit 1;
  if o is null and v_cour is not null then
    select x into o from jsonb_array_elements(r -> 'opciones') x
    where x ->> 'tipo' = v.envio_tipo and not coalesce((x ->> 'cobro_destino')::boolean, false)
      and (v_cour = tumbo_privado.lugar_clave(x ->> 'courier') or v_cour = x ->> 'courier_codigo'
           or v_cour like tumbo_privado.lugar_clave(x ->> 'courier') || ' %')
    limit 1;
    if o is null then
      select x into o from jsonb_array_elements(tumbo_privado.opciones_envio(v.seller_id, v_dest, v_items, true) -> 'opciones') x
      where x ->> 'tipo' = v.envio_tipo and not coalesce((x ->> 'cobro_destino')::boolean, false)
        and (v_cour = tumbo_privado.lugar_clave(x ->> 'courier') or v_cour = x ->> 'courier_codigo'
             or v_cour like tumbo_privado.lugar_clave(x ->> 'courier') || ' %')
      limit 1;
    end if;
  end if;
  if o is null then
    select x into o from jsonb_array_elements(r -> 'opciones') x
    where x ->> 'tipo' = v.envio_tipo and not coalesce((x ->> 'cobro_destino')::boolean, false) limit 1;
  end if;

  -- la promesa corre desde el pago; un pedido activo sin historial de esta
  -- ola arranca hoy (como sus plazos)
  v_base := case when v.estado in ('por_aceptar', 'preparando', 'listo') then v_hoy
                 else (coalesce(v.creado, now()) at time zone 'America/Caracas')::date end;
  insert into tumbo.envios (pedido_id, seller_id, codigo, courier, servicio, tipo, retiro, cobro_destino, costo_cotizado_usd, peso_kg,
                            dias_min, dias_max, prepara_dias, fecha_minima, fecha_prometida,
                            conciliado_en, aceptar_antes, despachar_antes, despachado_en, autoconfirmar_el, entregado_en,
                            referencia, guia)
  values (v.id, v.seller_id, o ->> 'codigo',
          coalesce(o ->> 'courier_codigo', (select k.codigo from tumbo.couriers k
                                            where v_cour is not null and (k.codigo = v_cour or tumbo_privado.lugar_clave(k.nombre) = v_cour
                                                                          or v_cour like tumbo_privado.lugar_clave(k.nombre) || ' %')
                                            order by k.orden limit 1)),
          coalesce(o ->> 'servicio', case when v.envio_tipo = 'agencia' then 'Retiro en agencia' else 'Entrega a domicilio' end),
          v.envio_tipo, coalesce((o ->> 'retiro')::boolean, v.envio_tipo = 'agencia'), coalesce((o ->> 'cobro_destino')::boolean, false),
          v.costo_envio_usd, (r ->> 'peso_kg')::numeric,
          coalesce((o ->> 'dias_min')::integer, c.dias_preparacion + 1), coalesce((o ->> 'dias_max')::integer, c.dias_preparacion + 4),
          c.dias_preparacion,
          tumbo_privado.sumar_habiles(v_base, coalesce((o ->> 'dias_min')::integer, c.dias_preparacion + 1)),
          tumbo_privado.sumar_habiles(v_base, coalesce((o ->> 'dias_max')::integer, c.dias_preparacion + 4)),
          case when v.estado in ('por_aceptar', 'preparando', 'listo') then now() end,
          case when v.estado = 'por_aceptar' then now() + make_interval(hours => tumbo_privado.logistica('aceptar_horas', 24)::integer) end,
          case when v.estado in ('por_aceptar', 'preparando', 'listo')
               then tumbo_privado.fin_dia(tumbo_privado.sumar_habiles(v_hoy, c.dias_preparacion)) end,
          case when v.estado = 'despachado' then coalesce(v.despachado_el, now()) end,
          case when v.estado = 'despachado'
               then tumbo_privado.autoconfirmar_desde(greatest(coalesce(v.despachado_el, now()), now()),
                      tumbo_privado.sumar_habiles(v_base, coalesce((o ->> 'dias_max')::integer, c.dias_preparacion + 4))) end,
          v.entregado_el,
          -- la guía «TM-GUIA-…» de antes de esta ola era la referencia interna, no la del courier
          case when v.guia like 'TM-GUIA-%' then v.guia end, case when v.guia not like 'TM-GUIA-%' then v.guia end)
  on conflict (pedido_id) do nothing;
  select * into e from tumbo.envios where pedido_id = p_pedido;
  return e;
end $$;

-- La URL de rastreo de una guía con el patrón del courier (o null).
create function tumbo_privado.url_rastreo(p_courier text, p_guia text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_guia is null then null
              else replace(c.url_rastreo, '{guia}', regexp_replace(p_guia, '[^A-Za-z0-9-]', '', 'g')) end
  from tumbo.couriers c where c.codigo = p_courier and c.url_rastreo is not null
$$;

-- Usuarios del comercio que operan sus pedidos.
create function tumbo_privado.encolar_comercio(p_seller text, p_plantilla text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
begin
  for u in select x.id from tumbo.usuarios x where x.seller_id = p_seller and x.rol in ('seller', 'operador') and x.activo order by x.id loop
    perform tumbo_privado.encolar(u, p_plantilla, p_datos);
  end loop;
end $$;

-- Devolución con sus instrucciones (al pasar el pedido a «devolución»).
create function tumbo_privado.devolucion_crear(p_pedido text) returns void
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
             case when v_paga = 'seller' then 'El envío de vuelta lo paga el comercio: pide «cobro en destino» si la agencia lo ofrece o guarda el recibo.'
                  else 'El envío de vuelta lo pagas tú.' end ||
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

-- Lo que cambia en la logística cuando cambia el estado de un pedido (lo
-- llama el disparador de tumbo.pedidos, sea quien sea el que lo cambió).
create function tumbo_privado.envio_transicion(p_pedido text, p_de text, p_a text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e tumbo.envios := tumbo_privado.envio_asegurar(p_pedido);
  v tumbo.pedidos;
  s tumbo.sellers;
  c tumbo.envio_config;
  v_hoy date := tumbo_privado.hoy();
begin
  if e.pedido_id is null then
    return;
  end if;
  select * into v from tumbo.pedidos where id = p_pedido;
  select * into s from tumbo.sellers where id = v.seller_id;
  if p_a = 'por_aceptar' then
    update tumbo.envios
    set conciliado_en = now(),
        aceptar_antes = now() + make_interval(hours => tumbo_privado.logistica('aceptar_horas', 24)::integer),
        despachar_antes = tumbo_privado.fin_dia(tumbo_privado.sumar_habiles(v_hoy, coalesce(prepara_dias, 1))),
        fecha_minima = tumbo_privado.sumar_habiles(v_hoy, coalesce(dias_min, 2)),
        fecha_prometida = tumbo_privado.sumar_habiles(v_hoy, coalesce(dias_max, 5)),
        recordado_en = null, escalado_aceptar_en = null, escalado_despacho_en = null
    where pedido_id = p_pedido returning * into e;
    perform tumbo_privado.encolar_comercio(v.seller_id, 'pedido_por_aceptar', jsonb_build_object(
      'pedido', v.id, 'monto', tumbo_privado.fmt_usd(tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd),
      'limite', tumbo_privado.fecha_hora_ve(e.aceptar_antes),
      'enlace', tumbo_privado.enlace_app('app/seller/pedido.html?id=' || v.id)));
  elsif p_a = 'preparando' then
    update tumbo.envios set aceptado_en = coalesce(aceptado_en, now()) where pedido_id = p_pedido;
  elsif p_a = 'listo' then
    update tumbo.envios set listo_en = now() where pedido_id = p_pedido;
    if e.courier = 'tienda' then
      c := tumbo_privado.config_envio(v.seller_id);
      perform tumbo_privado.encolar(v.comprador_id, 'pedido_listo_retiro', jsonb_build_object(
        'pedido', v.id, 'agencia', 'la tienda de ' || s.nombre || coalesce(' (' || c.retiro_direccion || ')', ' en ' || c.origen_ciudad),
        'enlace', tumbo_privado.enlace_app('app/tienda/pedido.html?id=' || v.id)));
      perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Tu pedido ' || v.id || ' está listo para retirar en la tienda de ' || s.nombre,
        'storefront', 'tienda/pedido.html?id=' || v.id);
    end if;
  elsif p_a = 'despachado' then
    update tumbo.envios
    set despachado_en = now(), autoconfirmar_el = tumbo_privado.autoconfirmar_desde(now(), fecha_prometida)
    where pedido_id = p_pedido returning * into e;
    if e.courier is distinct from 'tienda' then
      perform tumbo_privado.encolar(v.comprador_id, 'pedido_despachado', jsonb_build_object(
        'pedido', v.id, 'courier', coalesce((select k.nombre from tumbo.couriers k where k.codigo = e.courier), v.courier),
        'guia', coalesce(e.guia, 'por confirmar'),
        'enlace', coalesce(tumbo_privado.url_rastreo(e.courier, e.guia), tumbo_privado.enlace_app('app/tienda/pedido.html?id=' || v.id))));
    end if;
  elsif p_a = 'entregado' then
    update tumbo.envios set entregado_en = coalesce(entregado_en, now()) where pedido_id = p_pedido;
  elsif p_a = 'cancelado' then
    update tumbo.envios set cancelado_en = now() where pedido_id = p_pedido;
    update tumbo.solicitudes_cancelacion set estado = 'cerrada', decidido_en = now(), decidido_por = 'Sistema'
    where pedido_id = p_pedido and estado = 'pendiente';
  elsif p_a = 'devolucion' then
    perform tumbo_privado.devolucion_crear(p_pedido);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Disparadores sobre tumbo.pedidos
-- ---------------------------------------------------------------------------
-- Un comercio de vacaciones no recibe pedidos nuevos (los sembrados, con su
-- fecha de creación antigua, no cuentan).
create function tumbo_privado.pedido_vacaciones() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c tumbo.envio_config;
begin
  if new.creado < now() - interval '5 minutes' then
    return new;
  end if;
  select * into c from tumbo.envio_config where seller_id = new.seller_id;
  if found and tumbo_privado.vacaciones_activas(c) then
    raise exception '%', tumbo_privado.mensaje_vacaciones((select s.nombre from tumbo.sellers s where s.id = new.seller_id), c);
  end if;
  return new;
end $$;

create trigger pedidos_vacaciones
  before insert on tumbo.pedidos
  for each row execute function tumbo_privado.pedido_vacaciones();

-- Al terminar la transacción que creó el pedido (ya con sus líneas y su
-- destino), su envío y su promesa. Un fallo aquí nunca deshace la compra.
create function tumbo_privado.pedido_envio_alta() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if exists (select 1 from tumbo.pedidos p where p.id = new.id and p.creado >= now() - interval '10 minutes') then
      perform tumbo_privado.envio_asegurar(new.id);
    end if;
  exception when others then
    raise warning 'logística: no se preparó el envío de % (%)', new.id, sqlerrm;
  end;
  return null;
end $$;

create constraint trigger pedidos_envio_alta
  after insert on tumbo.pedidos
  deferrable initially deferred
  for each row execute function tumbo_privado.pedido_envio_alta();

create function tumbo_privado.pedido_envio_estado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform tumbo_privado.envio_transicion(new.id, old.estado, new.estado);
  exception when others then
    raise warning 'logística: no se registró el paso de % a % (%)', new.id, new.estado, sqlerrm;
  end;
  return null;
end $$;

create trigger pedidos_envio_estado
  after update of estado on tumbo.pedidos
  for each row when (old.estado is distinct from new.estado)
  execute function tumbo_privado.pedido_envio_estado();

-- ---------------------------------------------------------------------------
-- Operaciones internas de pedido
-- ---------------------------------------------------------------------------
-- Cancela un pedido aún no entregado: libera la reserva (si no se despachó),
-- crea el reembolso si el pago ya estaba verificado, deja el motivo
-- tipificado para las métricas del comercio y avisa a todos.
create function tumbo_privado.cancelar_logistica(p_yo tumbo.usuarios, v tumbo.pedidos, p_por text, p_motivo text, p_detalle text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reembolso bigint;
  v_culpa boolean := p_motivo in ('sin_stock', 'producto_danado', 'no_cubre_destino', 'quiebre_stock', 'sin_aceptar');
  v_actor text := case p_por when 'seller' then 'Comercio' when 'ops' then 'Operaciones' when 'sistema' then 'Sistema' else 'Comprador' end;
  v_quien text := case p_por when 'seller' then 'por el comercio' when 'ops' then 'por Operaciones'
                             when 'sistema' then 'automáticamente' else 'por el comprador' end;
  v_texto text := tumbo_privado.texto_motivo(p_motivo);
  v_desc text;
  v_disp text := tumbo_privado.disputa_abierta(v.id);
begin
  -- con un reclamo abierto, el reembolso lo decide el reclamo (si no, se
  -- reembolsaría dos veces al resolverlo)
  if v_disp is not null then
    raise exception 'El pedido % tiene abierto el reclamo %: resuélvelo desde Disputas (con reembolso si corresponde) en vez de cancelarlo.', v.id, v_disp;
  end if;
  v_desc := case when p_motivo = 'solicitud_comprador' and p_por = 'sistema' then 'a pedido del comprador (el comercio no respondió a tiempo)'
                 when p_motivo = 'solicitud_comprador' then 'a pedido del comprador (aprobado por el comercio)'
                 else v_quien || ' (' || v_texto || ')' end;
  perform tumbo_privado.bloquear_stock(v.id);
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = v.id;
  if v.estado <> 'despachado' then
    update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
  end if;
  if v.estado <> 'pago_por_verificar' then
    v_reembolso := tumbo_privado.crear_reembolso(v.id, tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd,
      'Cancelación del pedido ' || v.id || ' ' || v_desc);
  end if;
  insert into tumbo.cancelaciones (pedido_id, seller_id, por, motivo, culpa_seller, detalle, estado_previo, reembolso_id, actor)
  values (v.id, v.seller_id, p_por, p_motivo, v_culpa, left(p_detalle, 300), v.estado, v_reembolso,
          coalesce(p_yo.nombre || ' (' || p_yo.rol || ')', 'Sistema'));
  perform tumbo_privado.evento(v.id, v_actor, 'Pedido cancelado ' || v_desc ||
    case when v.estado = 'despachado' then '' else ' · stock liberado' end ||
    case when v_reembolso is not null then ' y reembolso en cola' else '' end, 'cancel');
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Tu pedido ' || v.id || ' se canceló (' || v_texto || ')' ||
    case when v_reembolso is not null then ': el reembolso quedó en cola' else '' end, 'cancel', 'tienda/pedido.html?id=' || v.id);
  if p_por <> 'seller' then
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'El pedido ' || v.id || ' se canceló ' || v_desc,
      'cancel', 'seller/pedido.html?id=' || v.id, array['seller', 'operador']);
  end if;
  perform tumbo_privado.auditar(p_yo, case when p_motivo = 'solicitud_comprador' then 'Cancelación a pedido del comprador' else 'Cancelación ' || v_quien end,
    v.id || ' · ' || v_texto || coalesce(' · ' || left(p_detalle, 120), ''));
end $$;

-- Despacho: courier (el de la opción elegida si no se indica), guía real y
-- foto del recibo. Con p_exigir, un courier exige su guía.
create function tumbo_privado.despachar_envio(p_yo tumbo.usuarios, v tumbo.pedidos, p_courier text, p_guia text, p_foto uuid,
                                              p_exigir boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e tumbo.envios := tumbo_privado.envio_asegurar(v.id);
  k tumbo.couriers;
  v_guia text := nullif(upper(regexp_replace(btrim(coalesce(p_guia, '')), '\s+', ' ', 'g')), '');
  v_texto text;
begin
  if v.estado <> 'listo' then
    raise exception 'El pedido % no está listo para despachar.', v.id;
  end if;
  if exists (select 1 from tumbo.solicitudes_cancelacion where pedido_id = v.id and estado = 'pendiente') then
    raise exception 'El comprador pidió cancelar el pedido %: responde la solicitud antes de despacharlo.', v.id;
  end if;
  select * into k from tumbo.couriers
  where codigo = coalesce(nullif(btrim(p_courier), ''), e.courier, (tumbo_privado.config_envio(v.seller_id)).couriers[1]);
  if not found or not k.activo then
    raise exception 'Elige un courier activo.';
  end if;
  if k.tipo = 'tienda' and e.courier is distinct from 'tienda' then
    raise exception 'El comprador no eligió retiro en tienda: despacha con un courier o con tu delivery.';
  end if;
  if v_guia is not null and v_guia !~ '^[A-Z0-9][A-Z0-9 ./-]{2,39}$' then
    raise exception 'La guía solo admite letras, números, espacios y . / - (entre 3 y 40 caracteres).';
  end if;
  if p_exigir and k.tipo = 'courier' and v_guia is null then
    raise exception 'Escribe el número de guía que te dio % al recibir el paquete.', k.nombre;
  end if;
  -- la entrega en la tienda no tiene courier que la respalde: queda la
  -- constancia (foto de la nota de entrega firmada por el comprador)
  if p_exigir and k.tipo = 'tienda' and p_foto is null then
    raise exception 'Adjunta la constancia de la entrega en la tienda: la foto de la nota de entrega firmada por el comprador.';
  end if;
  if v_guia is not null and exists (select 1 from tumbo.envios x where x.courier = k.codigo and x.guia = v_guia and x.pedido_id <> v.id) then
    raise exception 'Esa guía de % ya está registrada en otro pedido: revisa el número.', k.nombre;
  end if;
  if p_foto is not null and not exists (select 1 from tumbo.archivos a where a.id = p_foto and a.proposito = 'guia'
                                         and a.entidad = v.id and a.estado = 'listo') then
    raise exception 'La foto del recibo no está lista: vuelve a subirla.';
  end if;

  update tumbo.envios
  set courier = k.codigo, guia = coalesce(v_guia, guia), guia_foto = coalesce(p_foto, guia_foto),
      despachado_por = coalesce(p_yo.nombre || ' (' || p_yo.rol || ')', 'Sistema')
  where pedido_id = v.id;
  perform tumbo_privado.bloquear_stock(v.id);
  update tumbo.pedidos set estado = 'despachado', despachado_el = now(), courier = k.nombre,
                           guia = coalesce(v_guia, guia)
  where id = v.id;
  -- El stock sale del inventario al entregarse al courier.
  update tumbo.productos p
  set stock_fis = greatest(0, p.stock_fis - i.cant), stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = p.sku;
  v_texto := case k.tipo
    when 'tienda' then 'Entregado al comprador en la tienda · falta su confirmación'
    when 'propio' then 'Paquete en camino con el delivery del comercio' || coalesce(' · referencia ' || v_guia, '') || ' · en tránsito'
    else 'Paquete entregado a ' || k.nombre || coalesce(' · guía ' || v_guia, '') || ' · en tránsito' end;
  perform tumbo_privado.evento(v.id, case when k.tipo = 'courier' then 'Courier' else v.seller_id end, v_texto, 'local_shipping');
  perform tumbo_privado.notificar('usr:' || v.comprador_id,
    case when k.tipo = 'tienda' then 'Retiraste tu pedido ' || v.id || ': confirma que lo recibiste bien'
         else 'Tu pedido ' || v.id || ' va en camino' || coalesce(' (guía ' || v_guia || ')', '') end,
    'local_shipping', 'tienda/pedido.html?id=' || v.id);
  perform tumbo_privado.notificar('rol:ops', 'Pedido ' || v.id || ' despachado con ' || k.nombre, 'local_shipping', 'admin/pedido.html?id=' || v.id);
  perform tumbo_privado.auditar(p_yo, 'Despacho al courier', v.id || ' · ' || k.nombre || coalesce(' · guía ' || v_guia, ''));
  return jsonb_build_object('id', v.id, 'courier', k.nombre, 'guia', v_guia, 'rastreo', tumbo_privado.url_rastreo(k.codigo, v_guia));
end $$;

-- Entrega confirmada sin el comprador (Operaciones con su prueba, o la
-- autoconfirmación).
create function tumbo_privado.confirmar_entrega_interna(p_yo tumbo.usuarios, v tumbo.pedidos, p_actor text, p_texto text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cfg tumbo.config;
  v_disp text := tumbo_privado.disputa_abierta(v.id);
begin
  -- con un reclamo abierto («no llegó») los fondos siguen congelados: el
  -- caso se cierra por el reclamo
  if v_disp is not null then
    raise exception 'El pedido % tiene abierto el reclamo %: resuélvelo desde Disputas (si el paquete llegó, liberando los fondos).', v.id, v_disp;
  end if;
  select * into cfg from tumbo.config;
  update tumbo.pedidos set estado = 'entregado', entregado_el = now(), liquidacion = 'retenido' where id = v.id;
  perform tumbo_privado.evento(v.id, p_actor, p_texto || ' · abre la ventana de reclamo (' || cfg.ventana_reclamo_dias || ' días)', 'check_circle');
  perform tumbo_privado.notificar('seller:' || v.seller_id,
    'El pedido ' || v.id || ' fue entregado: fondos en retención hasta cerrar la ventana', 'lock', 'seller/finanzas.html');
  perform tumbo_privado.notificar('usr:' || v.comprador_id,
    'Tu pedido ' || v.id || ' figura entregado: tienes ' || cfg.ventana_reclamo_dias || ' días para reclamar', 'check_circle', 'tienda/pedido.html?id=' || v.id);
  perform tumbo_privado.auditar(p_yo, 'Entrega confirmada', v.id || ' · ' || p_actor);
end $$;

-- ---------------------------------------------------------------------------
-- Funciones existentes que esta ola redefine (desde su última definición)
-- ---------------------------------------------------------------------------
-- Listo para despachar (desde la migración 2): la referencia de la etiqueta
-- de Tumbo se guarda aparte; la guía del pedido queda para la guía real del
-- courier, que llega al despachar.
create or replace function public.tm_marcar_listo(p_sesion text, p_id text, p_peso numeric) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  e tumbo.envios;
  v_ref text;
begin
  if v.estado <> 'preparando' then
    raise exception 'El pedido % no está en preparación.', p_id;
  end if;
  if p_peso is not null and (p_peso <= 0 or p_peso > 1000) then
    raise exception 'Indica un peso entre 0,1 y 1.000 kg.';
  end if;
  e := tumbo_privado.envio_asegurar(p_id);
  v_ref := coalesce(e.referencia, 'TM-GUIA-' || nextval('tumbo_privado.seq_guia'));
  update tumbo.envios set referencia = v_ref, peso_kg = coalesce(p_peso, peso_kg) where pedido_id = p_id;
  update tumbo.pedidos set estado = 'listo', peso = p_peso where id = p_id;
  perform tumbo_privado.evento(p_id, v.seller_id, 'Paquete listo · etiqueta ' || v_ref, 'package_2');
  perform tumbo_privado.auditar(yo, 'Paquete listo', p_id || ' · etiqueta ' || v_ref);
  return v_ref;
end $$;

-- Despacho (desde la migración 4) con el courier de la opción elegida. Las
-- mismas reglas que el despacho con guía (tm_despachar_guia): un courier
-- exige su número de guía y la entrega en la tienda, su constancia, así que
-- por aquí solo sale el delivery propio; lo demás pide tm_despachar_guia.
create or replace function public.tm_despachar(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  perform tumbo_privado.despachar_envio(yo, v, null, null, null, true);
end $$;

-- Confirmación de entrega (desde la migración 2). La del comprador, como
-- siempre; Operaciones confirma sin el comprador solo con la foto de la
-- prueba del courier (tm_entrega_confirmar). Con un reclamo abierto sobre el
-- pedido («no llegó») no se confirma: el dinero lo decide el reclamo.
create or replace function public.tm_confirmar_entrega(p_sesion text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'ops', 'superadmin']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  cfg tumbo.config;
  v_disp text;
begin
  select * into cfg from tumbo.config;
  if v.estado <> 'despachado' then
    raise exception 'El pedido % no está en camino.', p_id;
  end if;
  if yo.rol <> 'comprador' then
    raise exception 'Para confirmar una entrega sin el comprador adjunta la foto de la prueba del courier (confirmar entrega con prueba).';
  end if;
  v_disp := tumbo_privado.disputa_abierta(p_id);
  if v_disp is not null then
    raise exception 'Tienes abierto el reclamo % sobre este pedido: si ya te llegó, avísale a soporte para que Operaciones cierre el reclamo.', v_disp;
  end if;
  update tumbo.pedidos set estado = 'entregado', entregado_el = now(), liquidacion = 'retenido' where id = p_id;
  perform tumbo_privado.evento(p_id, 'Comprador', 'Entrega confirmada · abre la ventana de reclamo (' || cfg.ventana_reclamo_dias || ' días)', 'check_circle');
  perform tumbo_privado.notificar('seller:' || v.seller_id,
    'El pedido ' || p_id || ' fue entregado: fondos en retención hasta cerrar la ventana', 'lock', 'seller/finanzas.html');
  perform tumbo_privado.auditar(yo, 'Entrega confirmada', p_id);
end $$;

-- Cancelación del comprador (desde la de fundaciones): antes de que el
-- comercio acepte, se cancela al momento (con el reembolso si el pago ya se
-- había conciliado); ya aceptado, queda como solicitud que el comercio
-- aprueba o rechaza (se aprueba sola si no responde a tiempo).
create or replace function public.tm_cancelar_pedido(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 200);
  v_vence timestamptz;
begin
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

-- Cierre de devolución (desde la de fundaciones): si el producto volvió se
-- reembolsa, siempre después de la inspección al recibirlo (el stock se
-- repone solo si llegó apto); si no volvió en el plazo, los fondos pasan al
-- comercio, salvo que ya se haya recibido.
create or replace function public.tm_cerrar_devolucion(p_sesion text, p_id text, p_recibida boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  dv tumbo.devoluciones;
  v_reponer boolean;
begin
  if v.estado <> 'devolucion' then
    raise exception 'El pedido % no tiene una devolución en curso.', p_id;
  end if;
  if p_recibida is null then
    raise exception 'Indica si el producto volvió.';
  end if;
  perform tumbo_privado.devolucion_crear(p_id);
  select * into dv from tumbo.devoluciones where pedido_id = p_id for update;
  if p_recibida and (dv.estado is distinct from 'recibida' or dv.inspeccion is null) then
    raise exception 'Antes de reembolsar registra la inspección de la devolución de % (cómo llegó el producto) en el detalle del pedido.', p_id;
  end if;
  if not p_recibida and dv.estado = 'recibida' then
    raise exception 'La devolución de % ya se recibió e inspeccionó: ciérrala con el reembolso.', p_id;
  end if;
  v_reponer := dv.inspeccion = 'apto';
  if p_recibida then
    perform tumbo_privado.bloquear_stock(p_id);
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = p_id;
    if v_reponer then
      update tumbo.productos p set stock_fis = p.stock_fis + i.cant, actualizado = now()
      from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
    end if;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'Devolución recibida · reembolso al comprador en cola' ||
      case when v_reponer then ' y stock repuesto' else ' (producto ' || case dv.inspeccion when 'danado' then 'dañado' else 'incompleto' end ||
                                  ': el stock no se repone)' end, 'undo');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Recibimos la devolución de ' || p_id || ': reembolso en proceso', 'undo', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id ||
      case when v_reponer then ' volvió a tu inventario' else ' llegó ' || case dv.inspeccion when 'danado' then 'dañada' else 'incompleta' end end ||
      '; el pedido se reembolsó', 'assignment_return', 'seller/disputas.html');
    perform tumbo_privado.crear_reembolso(p_id, tumbo_privado.bruto_pedido(p_id) + v.costo_envio_usd,
      'Devolución recibida del pedido ' || p_id);
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = p_id;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'El producto no se devolvió en el plazo · fondos liberados al seller', 'lock_open');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'La devolución de ' || p_id || ' se cerró: el producto no llegó en el plazo', 'gavel', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  update tumbo.devoluciones set estado = 'cerrada', cerrada_en = now(), actualizado = now() where pedido_id = p_id;
  perform tumbo_privado.auditar(yo, 'Cierre de devolución', p_id || ' → ' ||
    case when p_recibida then 'recibida (' || dv.inspeccion || '), reembolso' || case when v_reponer then '' else ' sin reponer stock' end
         else 'no recibida, fondos al seller' end);
end $$;

-- Apertura de reclamo (desde la migración 4): además de los reclamos tras la
-- entrega, el comprador puede reclamar «No llegó» cuando un pedido
-- despachado pasa su fecha prometida más los días hábiles de gracia.
create or replace function public.tm_abrir_disputa(p_sesion text, p_pedido text, p_motivo text, p_descripcion text, p_evidencia text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_pedido, yo);
  cfg tumbo.config;
  e tumbo.envios;
  v_id text;
  v_desc text := trim(coalesce(p_descripcion, ''));
  v_evid text[] := coalesce(p_evidencia, '{}');
  v_desde timestamptz;
  v_no_llego boolean := p_motivo = 'No llegó';
begin
  select * into cfg from tumbo.config;
  if v.disputa_id is not null then
    raise exception 'Este pedido ya tiene un reclamo abierto.';
  end if;
  if v_no_llego then
    if v.estado <> 'despachado' then
      raise exception 'El reclamo «No llegó» es para un pedido despachado que no recibiste.';
    end if;
    e := tumbo_privado.envio_asegurar(v.id);
    -- el retiro en tienda se entregó en mano, con la constancia firmada
    if e.courier = 'tienda' then
      raise exception 'Este pedido se entregó en la tienda del comercio con una constancia firmada: el reclamo «No llegó» es para envíos. Si no lo retiraste, escríbele a soporte.';
    end if;
    v_desde := tumbo_privado.fin_dia(tumbo_privado.sumar_habiles(coalesce(e.fecha_prometida, tumbo_privado.hoy()),
                                                                 tumbo_privado.logistica('reclamo_no_llego_habiles', 2)::integer));
    if now() < v_desde then
      raise exception 'La entrega se prometió hasta el %: podrás reportar que no llegó desde el %.',
        tumbo_privado.fecha_corta(e.fecha_prometida), tumbo_privado.fecha_corta((v_desde at time zone 'America/Caracas')::date);
    end if;
  elsif v.estado <> 'entregado' or v.liquidacion is distinct from 'retenido'
     or v.entregado_el < now() - make_interval(days => cfg.ventana_reclamo_dias) then
    raise exception 'Solo un pedido entregado y dentro de la ventana de reclamo (% días) admite reclamo.', cfg.ventana_reclamo_dias;
  end if;
  if p_motivo is null or p_motivo not in ('Producto dañado', 'Producto incorrecto', 'Faltan piezas o accesorios',
                                         'No coincide con la descripción', 'Otro', 'No llegó') then
    raise exception 'Elige el motivo del reclamo.';
  end if;
  if char_length(v_desc) < 15 or char_length(v_desc) > 2000 then
    raise exception 'Describe el problema con al menos 15 caracteres.';
  end if;
  if coalesce(array_ndims(v_evid), 1) <> 1 or cardinality(v_evid) > 10
     or exists (select 1 from unnest(v_evid) e2 where char_length(e2) > 120) then
    raise exception 'Adjunta como máximo 10 archivos.';
  end if;

  v_id := 'DSP-' || tumbo_privado.folio(nextval('tumbo_privado.seq_disputa'), 4);
  insert into tumbo.disputas (id, pedido_id, comprador_id, seller_id, motivo, descripcion, evidencia, monto_usd, estado)
  values (v_id, v.id, v.comprador_id, v.seller_id, p_motivo, v_desc, v_evid, tumbo_privado.bruto_pedido(v.id), 'abierta');
  update tumbo.pedidos set disputa_id = v_id, liquidacion = 'congelado' where id = v.id;
  perform tumbo_privado.evento(v.id, 'Comprador', 'Reclamo ' || v_id || ' abierto' ||
    case when v_no_llego then ': el pedido no llegó' else '' end || ' · liquidación congelada', 'gavel');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Reclamo ' || v_id || ' abierto sobre ' || v.id ||
    case when v_no_llego then ' (no llegó)' else '' end || ': responde con tu evidencia', 'gavel', 'seller/disputas.html');
  perform tumbo_privado.notificar('rol:ops', 'Disputa ' || v_id || ' en cola: ' || p_motivo, 'gavel', 'admin/disputas.html');
  perform tumbo_privado.auditar(yo, 'Apertura de disputa', v_id || ' sobre ' || v.id || case when v_no_llego then ' (no llegó)' else '' end);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Lectura
-- ---------------------------------------------------------------------------
-- Couriers, estados y regiones: lo que cualquiera puede ver.
create or replace function public.tm_envio_referencias() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'couriers', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'tipo', c.tipo,
                            'agencia', c.agencia, 'domicilio', c.domicilio, 'cobro_destino', c.cobro_destino,
                            'rastreo', c.url_rastreo is not null) order by c.orden, c.codigo)
                          from tumbo.couriers c where c.activo), '[]'::jsonb),
    'estados', coalesce((select jsonb_agg(jsonb_build_object('estado', e.estado, 'zona', e.zona, 'capital', e.capital)
                         order by e.orden, e.estado) from tumbo.envio_estados e), '[]'::jsonb),
    'zonas', coalesce((select jsonb_agg(to_jsonb(z) order by z.orden) from tumbo.envio_zonas z), '[]'::jsonb))
$$;

-- Todo lo configurable (superadmin y Operaciones).
create or replace function public.tm_logistica_admin(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
begin
  return jsonb_build_object(
    'couriers', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden, c.codigo) from tumbo.couriers c), '[]'::jsonb),
    'zonas', coalesce((select jsonb_agg(to_jsonb(z) order by z.orden) from tumbo.envio_zonas z), '[]'::jsonb),
    'estados', coalesce((select jsonb_agg(to_jsonb(e) order by e.orden) from tumbo.envio_estados e), '[]'::jsonb),
    'tarifas', coalesce((select jsonb_agg(to_jsonb(t) order by t.courier, t.alcance, t.tipo, t.peso_hasta_kg) from tumbo.tarifas t), '[]'::jsonb),
    'oficinas', coalesce((select jsonb_agg(to_jsonb(o) order by o.estado, o.courier, o.ciudad, o.id) from tumbo.oficinas o), '[]'::jsonb),
    'feriados', coalesce((select jsonb_agg(to_jsonb(f) order by f.fecha) from tumbo.feriados f
                          where f.fecha >= tumbo_privado.hoy() - 31), '[]'::jsonb),
    'ajustes', coalesce(tumbo_privado.ajuste('logistica'), '{}'::jsonb),
    'rangos', (select jsonb_object_agg(k, to_jsonb(tumbo_privado.logistica_rango(k)))
               from unnest(array['aceptar_horas', 'recordar_horas', 'cancelar_horas', 'solicitud_horas', 'autoconfirmar_dias',
                                 'aviso_autoconfirmar_dias', 'reclamo_no_llego_habiles', 'sin_novedad_dias', 'peso_defecto_kg']) k),
    'tarea_sla', (select to_jsonb(t) from tumbo.tareas_registro t where t.tarea = 'sla'),
    'editable', not tumbo_privado.cuenta_demo(yo.email));
end $$;

-- La configuración de envíos del comercio (el operador la ve, no la cambia).
create or replace function public.tm_envio_config(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'operador']);
  c tumbo.envio_config := tumbo_privado.config_envio(yo.seller_id);
begin
  return jsonb_build_object(
    'config', to_jsonb(c) - 'por',
    'guardada', exists (select 1 from tumbo.envio_config x where x.seller_id = yo.seller_id),
    'vacaciones_activas', tumbo_privado.vacaciones_activas(c),
    'editable', yo.rol = 'seller',
    'referencias', public.tm_envio_referencias());
end $$;

-- La promesa de entrega de la ficha: desde dónde envía el comercio y cuánto
-- tarda hasta el estado del comprador (el elegido, el de su dirección
-- predeterminada o, si no hay, Distrito Capital).
create or replace function public.tm_envio_promesa(p_sesion text, p_sku text, p_estado text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  p tumbo.productos;
  d tumbo.direcciones;
  v_estado text := tumbo_privado.lugar_estado(p_estado, array['estado']);
  v_fuente text := 'elegido';
  v_dest jsonb;
  r jsonb;
begin
  select * into p from tumbo.productos where sku = p_sku;
  if not found or p.estado <> 'publicado'
     or not exists (select 1 from tumbo.sellers s where s.id = p.seller_id and s.estado = 'aprobado') then
    raise exception 'Producto no disponible.';
  end if;
  if v_estado is null and yo.id is not null then
    select * into d from tumbo.direcciones x where x.usuario_id = yo.id order by x.predeterminada desc, x.creado limit 1;
    if found then
      v_dest := jsonb_build_object('estado', d.estado, 'municipio', d.municipio, 'ciudad', d.ciudad);
      v_estado := tumbo_privado.destino_estado(v_dest);
      v_fuente := 'direccion';
    end if;
  end if;
  if v_estado is null then
    v_estado := 'Distrito Capital';
    v_fuente := 'omision';
  end if;
  r := tumbo_privado.opciones_envio(p.seller_id, coalesce(v_dest, '{}'::jsonb) || jsonb_build_object('estado', v_estado),
                                    jsonb_build_array(jsonb_build_object('sku', p.sku, 'cant', 1)), false);
  return (r - 'subtotal_usd') || jsonb_build_object('destino', (r -> 'destino') || jsonb_build_object('fuente', v_fuente));
end $$;

-- Datos de SLA y envío de un pedido para listas.
create function tumbo_privado.envio_resumen(e tumbo.envios, v tumbo.pedidos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'estado', v.estado, 'seller_id', v.seller_id, 'codigo', e.codigo, 'courier', e.courier,
    'courier_nombre', (select k.nombre from tumbo.couriers k where k.codigo = e.courier),
    'servicio', e.servicio, 'tipo', e.tipo, 'retiro', e.retiro, 'cobro_destino', e.cobro_destino,
    'guia', e.guia, 'referencia', e.referencia, 'rastreo', tumbo_privado.url_rastreo(e.courier, e.guia),
    'aceptar_antes', e.aceptar_antes, 'despachar_antes', e.despachar_antes,
    'fecha_minima', e.fecha_minima, 'fecha_prometida', e.fecha_prometida,
    'conciliado_en', e.conciliado_en, 'aceptado_en', e.aceptado_en, 'listo_en', e.listo_en,
    'despachado_en', e.despachado_en, 'en_agencia_en', e.en_agencia_en, 'autoconfirmar_el', e.autoconfirmar_el,
    'responsable', e.responsable,
    'solicitud', (select jsonb_build_object('id', s.id, 'estado', s.estado, 'motivo', s.motivo, 'vence', s.vence, 'creado', s.creado)
                  from tumbo.solicitudes_cancelacion s where s.pedido_id = v.id and s.estado = 'pendiente'),
    'incidencias_abiertas', (select count(*) from tumbo.incidencias i where i.pedido_id = v.id and i.estado = 'abierta'),
    'destino_estado', tumbo_privado.destino_estado(tumbo_privado.destino_pedido(v)))
$$;

-- Métricas logísticas de un comercio (últimos p_dias días): aceptación y
-- despacho a tiempo, cancelaciones atribuibles al comercio e incidencias.
create function tumbo_privado.envio_metricas(p_seller text, p_dias integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select e.* from tumbo.envios e
    where e.seller_id = p_seller and e.conciliado_en > now() - make_interval(days => p_dias)),
  canc as (
    select c.* from tumbo.cancelaciones c
    where c.seller_id = p_seller and c.creado > now() - make_interval(days => p_dias))
  select jsonb_build_object(
    'dias', p_dias,
    'pedidos', (select count(*) from base),
    'aceptados', (select count(*) from base where aceptado_en is not null),
    'aceptados_a_tiempo', (select count(*) from base where aceptado_en is not null and aceptado_en <= aceptar_antes),
    'despachados', (select count(*) from base where despachado_en is not null),
    'despachados_a_tiempo', (select count(*) from base where despachado_en is not null and despachado_en <= despachar_antes),
    'cancelaciones_seller', (select count(*) from canc where culpa_seller),
    'cancelaciones', (select count(*) from canc),
    'incidencias_abiertas', (select count(*) from tumbo.incidencias i where i.seller_id = p_seller and i.estado = 'abierta'),
    'por_aceptar_vencidos', (select count(*) from tumbo.envios e join tumbo.pedidos p on p.id = e.pedido_id
                             where e.seller_id = p_seller and p.estado = 'por_aceptar' and e.aceptar_antes < now()),
    'despacho_vencido', (select count(*) from tumbo.envios e join tumbo.pedidos p on p.id = e.pedido_id
                         where e.seller_id = p_seller and p.estado in ('preparando', 'listo') and e.despachar_antes < now()))
$$;

-- Cola logística del comercio: los vencimientos de sus pedidos activos, las
-- solicitudes de cancelación y sus métricas. Operaciones ve todos; el
-- comprador, el envío de sus 60 pedidos más recientes (sin lo interno).
create or replace function public.tm_envios_cola(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'operador', 'superadmin', 'ops']);
  v_equipo boolean := yo.rol in ('superadmin', 'ops');
  v tumbo.pedidos;
  e tumbo.envios;
  r jsonb := '{}'::jsonb;
begin
  if yo.rol = 'comprador' then
    for v in select p.* from tumbo.pedidos p where p.comprador_id = yo.id order by p.creado desc, p.id desc limit 60 loop
      e := tumbo_privado.envio_asegurar(v.id);
      r := r || jsonb_build_object(v.id, tumbo_privado.envio_resumen(e, v) - 'responsable' - 'incidencias_abiertas' - 'aceptar_antes'
                                         - 'despachar_antes' - 'conciliado_en' - 'aceptado_en' - 'listo_en' - 'seller_id');
    end loop;
    return jsonb_build_object('ahora', now(), 'pedidos', r);
  end if;
  for v in select p.* from tumbo.pedidos p
           where (v_equipo or p.seller_id = yo.seller_id)
             and p.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
           order by p.creado, p.id limit 500 loop
    e := tumbo_privado.envio_asegurar(v.id);
    r := r || jsonb_build_object(v.id, tumbo_privado.envio_resumen(e, v));
  end loop;
  return jsonb_build_object(
    'ahora', now(),
    'pedidos', r,
    'solicitudes', (select count(*) from tumbo.solicitudes_cancelacion s
                    where s.estado = 'pendiente' and (v_equipo or s.seller_id = yo.seller_id)),
    'metricas', case when yo.rol = 'seller' then tumbo_privado.envio_metricas(yo.seller_id, 30) end);
end $$;

-- Una incidencia, para quien la puede ver.
create function tumbo_privado.incidencia_json(i tumbo.incidencias, p_completa boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'tipo', i.tipo, 'nombre', tumbo_privado.texto_incidencia(i.tipo),
    'origen', i.origen, 'detalle', case when p_completa then i.detalle end, 'estado', i.estado,
    'resolucion', case when p_completa then i.resolucion end, 'creado', i.creado, 'resuelta_en', i.resuelta_en,
    'por', case when p_completa then i.por end, 'datos', case when p_completa then i.datos else '{}'::jsonb end)
$$;

-- El envío de un pedido para su comprador o su comercio (Operaciones usa
-- tm_pedido_360). Un pedido ajeno responde «no encontrado».
create or replace function public.tm_pedido_envio(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'operador']);
  v tumbo.pedidos;
  e tumbo.envios;
  c tumbo.envio_config;
  dv tumbo.devoluciones;
  k tumbo.couriers;
  o tumbo.oficinas;
  v_comprador boolean;
  v_desde timestamptz;
  v_cancelable text;
begin
  select * into v from tumbo.pedidos where id = p_id;
  if not found or (yo.rol = 'comprador' and v.comprador_id <> yo.id)
     or (yo.rol in ('seller', 'operador') and (v.seller_id is distinct from yo.seller_id or v.estado = 'pago_por_verificar'
                                              or (v.estado = 'cancelado' and v.sla_horas is null))) then
    raise exception 'Pedido % no encontrado.', p_id;
  end if;
  v_comprador := yo.rol = 'comprador';
  e := tumbo_privado.envio_asegurar(v.id);
  c := tumbo_privado.config_envio(v.seller_id);
  select * into k from tumbo.couriers where codigo = e.courier;
  select * into dv from tumbo.devoluciones where pedido_id = v.id;
  if dv.oficina_id is not null then
    select * into o from tumbo.oficinas where id = dv.oficina_id;
  end if;
  if v.estado = 'despachado' then
    v_desde := tumbo_privado.fin_dia(tumbo_privado.sumar_habiles(coalesce(e.fecha_prometida, tumbo_privado.hoy()),
                                                                 tumbo_privado.logistica('reclamo_no_llego_habiles', 2)::integer));
  end if;
  v_cancelable := case when v.estado in ('pago_por_verificar', 'por_aceptar') then 'directo'
                       when v.estado in ('preparando', 'listo') then 'solicitud' end;
  return jsonb_build_object(
    'id', v.id, 'estado', v.estado,
    'envio', tumbo_privado.envio_resumen(e, v) || jsonb_build_object(
      'courier_tipo', k.tipo, 'costo_cotizado_usd', e.costo_cotizado_usd, 'peso_kg', e.peso_kg,
      'dias_min', e.dias_min, 'dias_max', e.dias_max,
      'guia_foto', case when not (v_comprador and e.guia_foto_lote) then e.guia_foto end, 'entrega_foto', e.entrega_foto,
      'entregado_en', e.entregado_en, 'cancelado_en', e.cancelado_en),
    'origen', jsonb_build_object('ciudad', c.origen_ciudad, 'estado', c.origen_estado),
    'tienda', case when e.courier = 'tienda' then jsonb_build_object('direccion', c.retiro_direccion, 'horario', c.retiro_horario) end,
    'destinatario', tumbo_privado.destinatario_visible(yo, v),
    'no_llego', case when v_comprador and v.estado = 'despachado' and v.disputa_id is null and e.courier is distinct from 'tienda' then
                  jsonb_build_object('puede', now() >= v_desde, 'desde', (v_desde at time zone 'America/Caracas')::date) end,
    'cancelable', case when v_comprador then v_cancelable end,
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'estado', s.estado, 'motivo', s.motivo,
                              'respuesta', s.respuesta, 'creado', s.creado, 'vence', s.vence, 'decidido_en', s.decidido_en)
                              order by s.creado desc)
                             from tumbo.solicitudes_cancelacion s where s.pedido_id = v.id), '[]'::jsonb),
    'incidencias', coalesce((select jsonb_agg(tumbo_privado.incidencia_json(i, not v_comprador) order by i.creado desc)
                             from tumbo.incidencias i
                             where i.pedido_id = v.id and (not v_comprador or tumbo_privado.incidencia_publica(i.tipo))), '[]'::jsonb),
    'devolucion', case when dv.pedido_id is not null then (to_jsonb(dv) - 'inspeccionada_por' - 'seller_id') || jsonb_build_object(
                    'oficina', case when o.id is not null then jsonb_build_object('nombre', o.nombre, 'direccion', o.direccion,
                                 'ciudad', o.ciudad, 'estado', o.estado, 'telefono', o.telefono, 'horario', o.horario) end,
                    'courier_nombre', (select x.nombre from tumbo.couriers x where x.codigo = dv.courier)) end,
    'cancelacion', (select jsonb_build_object('por', x.por, 'motivo', x.motivo, 'texto', tumbo_privado.texto_motivo(x.motivo),
                                              'creado', x.creado)
                    from tumbo.cancelaciones x where x.pedido_id = v.id order by x.creado desc limit 1));
end $$;

-- Datos para las etiquetas 10×15 (pedidos activos del comercio, o de
-- cualquiera para Operaciones), hasta 50 por vez.
create or replace function public.tm_envio_etiquetas(p_sesion text, p_ids text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- escribe en la auditoría: con la cuota de escrituras de la cuenta
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador', 'superadmin', 'ops']);
  v tumbo.pedidos;
  e tumbo.envios;
  c tumbo.envio_config;
  s tumbo.sellers;
  r jsonb := '[]'::jsonb;
  v_id text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Elige al menos un pedido.';
  end if;
  if cardinality(p_ids) > 50 then
    raise exception 'Imprime hasta 50 etiquetas por vez.';
  end if;
  foreach v_id in array p_ids loop
    select * into v from tumbo.pedidos where id = v_id;
    if not found or (yo.rol in ('seller', 'operador') and v.seller_id is distinct from yo.seller_id) then
      raise exception 'Pedido % no encontrado.', left(v_id, 30);
    end if;
    if v.estado not in ('preparando', 'listo', 'despachado') then
      raise exception 'El pedido % no está en preparación ni en camino: no lleva etiqueta.', v.id;
    end if;
    e := tumbo_privado.envio_asegurar(v.id);
    c := tumbo_privado.config_envio(v.seller_id);
    select * into s from tumbo.sellers where id = v.seller_id;
    r := r || jsonb_build_object(
      'id', v.id, 'referencia', e.referencia, 'guia', e.guia,
      'courier', (select k.nombre from tumbo.couriers k where k.codigo = e.courier), 'courier_codigo', e.courier,
      'servicio', e.servicio, 'tipo', e.tipo, 'retiro', e.retiro, 'cobro_destino', e.cobro_destino,
      'peso_kg', coalesce(v.peso, e.peso_kg),
      'unidades', (select coalesce(sum(i.cant), 0) from tumbo.pedido_items i where i.pedido_id = v.id),
      'destinatario', tumbo_privado.destinatario_pedido(v),
      'remitente', jsonb_build_object('nombre', s.nombre, 'id', s.id, 'ciudad', c.origen_ciudad, 'estado', c.origen_estado),
      'fecha_prometida', e.fecha_prometida, 'creado', v.creado);
  end loop;
  perform tumbo_privado.auditar(yo, 'Etiquetas impresas', array_to_string(p_ids[1:20], ', ') || case when cardinality(p_ids) > 20 then '…' else '' end);
  return r;
end $$;

create or replace function public.tm_envio_metricas(p_sesion text, p_seller text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'superadmin', 'ops']);
begin
  if yo.rol = 'seller' then
    return tumbo_privado.envio_metricas(yo.seller_id, 30);
  end if;
  if p_seller is not null then
    if not exists (select 1 from tumbo.sellers where id = p_seller) then
      raise exception 'Comercio % no encontrado.', left(p_seller, 30);
    end if;
    return tumbo_privado.envio_metricas(p_seller, 30);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('seller', s.id, 'nombre', s.nombre) || tumbo_privado.envio_metricas(s.id, 30)
                                    order by s.id)
                   from tumbo.sellers s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Escritura del comercio
-- ---------------------------------------------------------------------------
create or replace function public.tm_envio_config_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_estado text := tumbo_privado.lugar_estado(d ->> 'origen_estado', array['estado']);
  v_ciudad text := left(btrim(coalesce(d ->> 'origen_ciudad', '')), 60);
  v_couriers text[];
  v_delivery jsonb := '[]'::jsonb;
  x jsonb;
  v_muni text;
  v_muni_estado text;
  v_costo numeric;
  v_dias integer;
  v_prep integer;
  v_gratis numeric;
  v_hasta date;
  v_retiro boolean := coalesce((d ->> 'retiro_tienda')::boolean, false);
  v_dir text := nullif(left(btrim(coalesce(d ->> 'retiro_direccion', '')), 300), '');
  v_vac boolean := coalesce((d ->> 'vacaciones')::boolean, false);
  antes tumbo.envio_config := tumbo_privado.config_envio(yo.seller_id);
begin
  if v_estado is null then
    raise exception 'Elige el estado desde el que envías.';
  end if;
  if char_length(v_ciudad) < 2 then
    raise exception 'Escribe la ciudad desde la que envías.';
  end if;
  if jsonb_typeof(d -> 'couriers') is distinct from 'array' then
    raise exception 'Indica los couriers que aceptas.';
  end if;
  select coalesce(array_agg(distinct x2 order by x2), '{}') into v_couriers
  from jsonb_array_elements_text(d -> 'couriers') x2;
  if cardinality(v_couriers) > 10 or exists (select 1 from unnest(v_couriers) c2
       where not exists (select 1 from tumbo.couriers k where k.codigo = c2 and k.activo and k.tipo = 'courier')) then
    raise exception 'Algún courier no existe o no está activo.';
  end if;
  if jsonb_typeof(coalesce(d -> 'delivery', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(d -> 'delivery', '[]'::jsonb)) > 40 then
    raise exception 'El delivery propio admite hasta 40 municipios.';
  end if;
  for x in select y from jsonb_array_elements(coalesce(d -> 'delivery', '[]'::jsonb)) y loop
    v_muni := left(btrim(coalesce(x ->> 'municipio', '')), 60);
    if char_length(v_muni) < 2 then
      raise exception 'Escribe el municipio de cada zona de delivery.';
    end if;
    begin
      v_costo := round((x ->> 'costo_usd')::numeric, 2);
      v_dias := coalesce((x ->> 'dias')::integer, 1);
    exception when others then
      raise exception 'La tarifa y los días del delivery en % deben ser números.', v_muni;
    end;
    if v_costo is null or v_costo < 0 or v_costo > 100 then
      raise exception 'La tarifa del delivery en % debe estar entre 0 y 100 USD.', v_muni;
    end if;
    if v_dias < 0 or v_dias > 5 then
      raise exception 'El delivery en % debe tardar entre 0 y 5 días hábiles.', v_muni;
    end if;
    -- cada zona lleva su estado (muchos municipios se repiten en varios
    -- estados); sin indicarlo, el de origen del comercio
    v_muni_estado := case when nullif(btrim(coalesce(x ->> 'estado', '')), '') is null then v_estado
                          else tumbo_privado.lugar_estado(x ->> 'estado', array['estado']) end;
    if v_muni_estado is null then
      raise exception 'Elige de la lista el estado del delivery en %.', v_muni;
    end if;
    if exists (select 1 from jsonb_array_elements(v_delivery) z
               where tumbo_privado.lugar_clave(z ->> 'municipio') = tumbo_privado.lugar_clave(v_muni) and z ->> 'estado' = v_muni_estado) then
      raise exception 'El municipio % (%) está repetido en el delivery.', v_muni, v_muni_estado;
    end if;
    v_delivery := v_delivery || jsonb_build_object('municipio', v_muni, 'costo_usd', v_costo, 'dias', v_dias, 'estado', v_muni_estado);
  end loop;
  if v_retiro and char_length(coalesce(v_dir, '')) < 10 then
    raise exception 'Para el retiro en tienda escribe la dirección del local (al menos 10 caracteres).';
  end if;
  if cardinality(v_couriers) = 0 and jsonb_array_length(v_delivery) = 0 and not v_retiro then
    raise exception 'Ofrece al menos una forma de envío: un courier, tu delivery o el retiro en tienda.';
  end if;
  begin
    v_prep := coalesce((d ->> 'dias_preparacion')::integer, 1);
    v_gratis := nullif(round((d ->> 'gratis_desde_usd')::numeric, 2), 0);
    -- la fecha de regreso solo cuenta con el modo vacaciones activado
    v_hasta := case when v_vac then nullif(d ->> 'vacaciones_hasta', '')::date end;
  exception when others then
    raise exception 'Revisa los días de preparación, el monto del envío gratis y la fecha de regreso.';
  end;
  if v_prep < 1 or v_prep > 10 then
    raise exception 'Los días de preparación van de 1 a 10 días hábiles.';
  end if;
  if v_gratis is not null and (v_gratis < 1 or v_gratis > 100000) then
    raise exception 'El envío gratis se ofrece desde 1 hasta 100.000 USD.';
  end if;
  -- unas vacaciones que ya terminaron (se reenvía la fecha guardada, que ya
  -- pasó) se dan por terminadas: el comercio sigue guardando sus cambios
  if v_vac and v_hasta is not null and v_hasta < tumbo_privado.hoy() and v_hasta = antes.vacaciones_hasta then
    v_vac := false;
    v_hasta := null;
  end if;
  if v_hasta is not null and (v_hasta < tumbo_privado.hoy() or v_hasta > tumbo_privado.hoy() + 90) then
    raise exception 'La fecha de regreso de las vacaciones debe estar entre hoy y los próximos 90 días.';
  end if;
  insert into tumbo.envio_config (seller_id, origen_estado, origen_ciudad, couriers, delivery, retiro_tienda, retiro_direccion,
                                  retiro_horario, gratis_desde_usd, dias_preparacion, cobro_destino, vacaciones, vacaciones_hasta,
                                  vacaciones_mensaje, actualizado, por)
  values (yo.seller_id, v_estado, v_ciudad, v_couriers, v_delivery, v_retiro, v_dir,
          nullif(left(btrim(coalesce(d ->> 'retiro_horario', '')), 120), ''), v_gratis, v_prep,
          coalesce((d ->> 'cobro_destino')::boolean, false), v_vac, case when v_vac then v_hasta end,
          case when v_vac then nullif(left(btrim(coalesce(d ->> 'vacaciones_mensaje', '')), 200), '') end,
          now(), yo.nombre || ' (' || yo.rol || ')')
  on conflict (seller_id) do update set origen_estado = excluded.origen_estado, origen_ciudad = excluded.origen_ciudad,
    couriers = excluded.couriers, delivery = excluded.delivery, retiro_tienda = excluded.retiro_tienda,
    retiro_direccion = excluded.retiro_direccion, retiro_horario = excluded.retiro_horario,
    gratis_desde_usd = excluded.gratis_desde_usd, dias_preparacion = excluded.dias_preparacion,
    cobro_destino = excluded.cobro_destino, vacaciones = excluded.vacaciones, vacaciones_hasta = excluded.vacaciones_hasta,
    vacaciones_mensaje = excluded.vacaciones_mensaje, actualizado = now(), por = excluded.por;
  perform tumbo_privado.auditar(yo, 'Configuración de envíos', yo.seller_id || ': origen ' || v_ciudad || ' (' || v_estado || '), ' ||
    cardinality(v_couriers) || ' couriers, ' || jsonb_array_length(v_delivery) || ' zonas de delivery, ' || v_prep || ' días de preparación' ||
    case when v_vac and not tumbo_privado.vacaciones_activas(antes) then ', vacaciones activadas'
         when not v_vac and tumbo_privado.vacaciones_activas(antes) then ', vacaciones terminadas' else '' end);
  if v_vac and not coalesce(antes.vacaciones, false) then
    perform tumbo_privado.notificar('rol:ops', 'El comercio ' || yo.seller_id || ' activó el modo vacaciones' ||
      coalesce(' hasta el ' || to_char(v_hasta, 'DD/MM/YYYY'), ''), 'beach_access', 'admin/operaciones.html');
  end if;
  return public.tm_envio_config(p_sesion);
end $$;

-- Despacho con courier, guía y foto del recibo.
create or replace function public.tm_despachar_guia(p_sesion text, p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_foto uuid;
begin
  begin
    v_foto := nullif(d ->> 'foto', '')::uuid;
  exception when others then
    raise exception 'La foto del recibo no está lista: vuelve a subirla.';
  end;
  return tumbo_privado.despachar_envio(yo, v, d ->> 'courier', d ->> 'guia', v_foto, true);
end $$;

-- Despacho por lotes: cada pedido se despacha por separado (uno que falla no
-- frena a los demás). p_lote: [{id, courier, guia}]; una foto del recibo
-- (o del manifiesto) opcional para todos.
create or replace function public.tm_despachar_lote(p_sesion text, p_lote jsonb, p_foto uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  x jsonb;
  v tumbo.pedidos;
  r jsonb := '[]'::jsonb;
  v_foto_ok boolean;
begin
  if jsonb_typeof(p_lote) is distinct from 'array' or jsonb_array_length(p_lote) = 0 then
    raise exception 'Elige los pedidos que vas a despachar.';
  end if;
  if jsonb_array_length(p_lote) > 30 then
    raise exception 'Despacha hasta 30 pedidos por lote.';
  end if;
  if p_foto is not null and not exists (select 1 from tumbo.archivos a where a.id = p_foto and a.proposito = 'guia' and a.estado = 'listo'
                                        and a.seller_id is not distinct from yo.seller_id) then
    raise exception 'La foto del recibo no está lista: vuelve a subirla.';
  end if;
  for x in select y from jsonb_array_elements(p_lote) y order by y ->> 'id' loop
    begin
      v := tumbo_privado.bloquear_pedido(left(coalesce(x ->> 'id', ''), 40), yo);
      -- la foto del lote vale para todos sus pedidos (se sube con el primero)
      v_foto_ok := p_foto is not null and exists (select 1 from tumbo.archivos a where a.id = p_foto and a.entidad = v.id);
      perform tumbo_privado.despachar_envio(yo, v, x ->> 'courier', x ->> 'guia', case when v_foto_ok then p_foto end, true);
      if p_foto is not null then
        update tumbo.envios set guia_foto = p_foto, guia_foto_lote = jsonb_array_length(p_lote) > 1 where pedido_id = v.id;
      end if;
      r := r || jsonb_build_object('id', v.id, 'ok', true);
    exception when others then
      r := r || jsonb_build_object('id', left(coalesce(x ->> 'id', ''), 40), 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return r;
end $$;

-- El paquete llegó a la agencia de destino (opciones con retiro).
create or replace function public.tm_envio_en_agencia(p_sesion text, p_id text, p_oficina bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador', 'superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  e tumbo.envios := tumbo_privado.envio_asegurar(p_id);
  o tumbo.oficinas;
  k tumbo.couriers;
  v_lugar text;
begin
  if v.estado <> 'despachado' or not e.retiro or e.courier = 'tienda' then
    raise exception 'Solo un pedido despachado para retirar en agencia se avisa como listo para retirar.';
  end if;
  if e.en_agencia_en is not null then
    raise exception 'Ya se avisó que el pedido % está en la agencia.', p_id;
  end if;
  select * into k from tumbo.couriers where codigo = e.courier;
  if p_oficina is not null then
    select * into o from tumbo.oficinas where id = p_oficina and courier = e.courier and activa;
    if not found then
      raise exception 'Esa oficina no existe o no es de %.', k.nombre;
    end if;
  end if;
  v_lugar := coalesce(o.nombre || ' (' || o.direccion || ', ' || o.ciudad || ')', 'la agencia de ' || k.nombre || ' que elegiste');
  update tumbo.envios set en_agencia_en = now(), oficina_id = coalesce(o.id, oficina_id) where pedido_id = p_id;
  perform tumbo_privado.evento(p_id, case when yo.rol in ('ops', 'superadmin') then 'Operaciones' else v.seller_id end,
    'El paquete llegó a ' || v_lugar || ' · listo para retirar con tu cédula', 'storefront');
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Tu pedido ' || p_id || ' está listo para retirar en ' || v_lugar,
    'storefront', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.encolar(v.comprador_id, 'pedido_listo_retiro', jsonb_build_object('pedido', p_id, 'agencia', v_lugar,
    'enlace', tumbo_privado.enlace_app('app/tienda/pedido.html?id=' || p_id)));
  perform tumbo_privado.auditar(yo, 'Pedido en agencia', p_id || ' · ' || left(v_lugar, 120));
end $$;

-- Incidencias que reporta el comercio.
create or replace function public.tm_incidencia_reportar(p_sesion text, p_id text, p_tipo text, p_detalle text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_detalle text := left(btrim(coalesce(p_detalle, '')), 500);
  v_id bigint;
begin
  if p_tipo is null or p_tipo not in ('sin_stock', 'danado', 'courier_no_retiro', 'direccion_incorrecta') then
    raise exception 'Elige el tipo de incidencia.';
  end if;
  if v.estado not in ('por_aceptar', 'preparando', 'listo', 'despachado')
     or (p_tipo in ('sin_stock', 'danado', 'courier_no_retiro') and v.estado = 'despachado') then
    raise exception 'El pedido % no admite esa incidencia en su estado actual.', p_id;
  end if;
  if char_length(v_detalle) < 5 then
    raise exception 'Cuenta qué pasó con al menos 5 caracteres.';
  end if;
  if (select count(*) from tumbo.incidencias where pedido_id = p_id and estado = 'abierta') >= 5 then
    raise exception 'El pedido % ya tiene 5 incidencias abiertas: espera a que Operaciones las atienda.', p_id;
  end if;
  if (select count(*) from tumbo.incidencias where seller_id = v.seller_id and creado > now() - interval '1 hour') >= 30 then
    raise exception 'Tu comercio reportó muchas incidencias en la última hora: espera un poco.';
  end if;
  insert into tumbo.incidencias (pedido_id, seller_id, tipo, origen, detalle, por)
  values (p_id, v.seller_id, p_tipo, 'seller', v_detalle, yo.nombre || ' (' || yo.rol || ')') returning id into v_id;
  perform tumbo_privado.notificar('rol:ops', 'Incidencia en ' || p_id || ': ' || tumbo_privado.texto_incidencia(p_tipo), 'report',
    'admin/pedido.html?id=' || p_id);
  if p_tipo = 'direccion_incorrecta' then
    perform tumbo_privado.evento(p_id, 'Operaciones', 'Hay un problema con la dirección de entrega: Operaciones te contactará', 'wrong_location');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Revisamos la dirección de tu pedido ' || p_id || ': Operaciones te contactará',
      'wrong_location', 'tienda/pedido.html?id=' || p_id);
  end if;
  perform tumbo_privado.auditar(yo, 'Incidencia reportada', p_id || ' · ' || tumbo_privado.texto_incidencia(p_tipo));
  return v_id;
end $$;

-- El comercio cancela (sin stock, producto dañado o destino que no cubre):
-- cuenta en sus métricas.
create or replace function public.tm_cancelar_seller(p_sesion text, p_id text, p_motivo text, p_detalle text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if p_motivo is null or p_motivo not in ('sin_stock', 'producto_danado', 'no_cubre_destino') then
    raise exception 'Elige el motivo de la cancelación.';
  end if;
  if v.estado not in ('por_aceptar', 'preparando', 'listo') then
    raise exception 'El pedido % ya no se puede cancelar desde el comercio.', p_id;
  end if;
  perform tumbo_privado.cancelar_logistica(yo, v, 'seller', p_motivo, nullif(btrim(coalesce(p_detalle, '')), ''));
end $$;

-- Respuesta del comercio a la solicitud de cancelación del comprador.
create or replace function public.tm_cancelacion_responder(p_sesion text, p_id text, p_aprobar boolean, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  s tumbo.solicitudes_cancelacion;
  v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 300), '');
begin
  select * into s from tumbo.solicitudes_cancelacion where pedido_id = p_id and estado = 'pendiente' for update;
  if not found then
    raise exception 'El pedido % no tiene una solicitud de cancelación pendiente.', p_id;
  end if;
  if p_aprobar is null then
    raise exception 'Indica si apruebas la cancelación.';
  end if;
  if not p_aprobar and char_length(coalesce(v_nota, '')) < 5 then
    raise exception 'Explícale al comprador por qué no se puede cancelar (al menos 5 caracteres).';
  end if;
  update tumbo.solicitudes_cancelacion
  set estado = case when p_aprobar then 'aprobada' else 'rechazada' end, respuesta = v_nota,
      decidido_en = now(), decidido_por = yo.nombre || ' (' || yo.rol || ')'
  where id = s.id;
  if p_aprobar then
    perform tumbo_privado.cancelar_logistica(yo, v, 'comprador', 'solicitud_comprador', coalesce(s.motivo, v_nota));
  else
    perform tumbo_privado.evento(p_id, v.seller_id, 'El comercio no aprobó la cancelación: ' || v_nota, 'block');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'El comercio no aprobó cancelar tu pedido ' || p_id || ': ' || v_nota,
      'block', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.auditar(yo, 'Solicitud de cancelación rechazada', p_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Escritura de Operaciones
-- ---------------------------------------------------------------------------
create or replace function public.tm_cancelar_ops(p_sesion text, p_id text, p_motivo text, p_detalle text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_detalle text := nullif(btrim(coalesce(p_detalle, '')), '');
begin
  if p_motivo is null or p_motivo not in ('fraude', 'quiebre_stock', 'direccion_imposible', 'perdida_courier') then
    raise exception 'Elige el motivo de la cancelación.';
  end if;
  if char_length(coalesce(v_detalle, '')) < 5 then
    raise exception 'Deja el detalle de la cancelación (al menos 5 caracteres): queda en la auditoría.';
  end if;
  if p_motivo = 'perdida_courier' then
    if v.estado <> 'despachado' then
      raise exception 'La pérdida en el courier aplica a un pedido despachado.';
    end if;
  elsif v.estado not in ('por_aceptar', 'preparando', 'listo') then
    raise exception 'El pedido % ya no se puede cancelar por ese motivo.', p_id;
  end if;
  perform tumbo_privado.cancelar_logistica(yo, v, 'ops', p_motivo, v_detalle);
end $$;

-- Novedades con el courier que registra Operaciones: retraso (con días
-- hábiles de más), pérdida, daño o reenvío con guía nueva.
create or replace function public.tm_incidencia_registrar(p_sesion text, p_id text, p_tipo text, p_detalle text, p_datos jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  e tumbo.envios := tumbo_privado.envio_asegurar(p_id);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_detalle text := left(btrim(coalesce(p_detalle, '')), 500);
  v_dias integer;
  k tumbo.couriers;
  v_guia text;
  v_id bigint;
  v_extra jsonb := '{}'::jsonb;
begin
  if p_tipo is null or p_tipo not in ('retraso', 'perdida', 'dano_courier', 'reenvio', 'otro') then
    raise exception 'Elige el tipo de novedad.';
  end if;
  if v.estado <> 'despachado' and p_tipo <> 'otro' then
    raise exception 'Las novedades con el courier aplican a un pedido despachado.';
  end if;
  if v.estado in ('cancelado', 'cerrado', 'reembolsado') then
    raise exception 'El pedido % ya está cerrado.', p_id;
  end if;
  if char_length(v_detalle) < 5 then
    raise exception 'Deja el detalle de la novedad (al menos 5 caracteres).';
  end if;
  if (select count(*) from tumbo.incidencias where pedido_id = p_id) >= 30 then
    raise exception 'El pedido % ya tiene demasiadas novedades registradas.', p_id;
  end if;
  if p_tipo = 'retraso' then
    begin
      v_dias := coalesce((d ->> 'dias')::integer, 0);
    exception when others then
      raise exception 'Los días de retraso deben ser un número.';
    end;
    if v_dias < 0 or v_dias > 20 then
      raise exception 'El retraso se registra con 0 a 20 días hábiles más.';
    end if;
    if v_dias > 0 then
      update tumbo.envios
      set fecha_prometida = tumbo_privado.sumar_habiles(coalesce(fecha_prometida, tumbo_privado.hoy()), v_dias), aviso_autoconfirmar_en = null
      where pedido_id = p_id returning * into e;
      update tumbo.envios set autoconfirmar_el = greatest(autoconfirmar_el, tumbo_privado.autoconfirmar_desde(despachado_en, fecha_prometida))
      where pedido_id = p_id returning * into e;
    end if;
    v_extra := jsonb_build_object('dias', v_dias, 'fecha_prometida', e.fecha_prometida);
    perform tumbo_privado.evento(p_id, 'Operaciones', 'El courier reporta un retraso' ||
      case when v_dias > 0 then ': la nueva fecha de entrega es hasta el ' || tumbo_privado.fecha_corta(e.fecha_prometida) else '' end, 'schedule');
  elsif p_tipo = 'reenvio' then
    select * into k from tumbo.couriers where codigo = coalesce(nullif(d ->> 'courier', ''), e.courier) and activo;
    if not found then
      raise exception 'Elige un courier activo para el reenvío.';
    end if;
    v_guia := nullif(upper(btrim(coalesce(d ->> 'guia', ''))), '');
    if v_guia is null or v_guia !~ '^[A-Z0-9][A-Z0-9 ./-]{2,39}$' then
      raise exception 'Escribe la guía nueva del reenvío (letras, números, espacios y . / -).';
    end if;
    if exists (select 1 from tumbo.envios x where x.courier = k.codigo and x.guia = v_guia and x.pedido_id <> p_id) then
      raise exception 'Esa guía de % ya está registrada en otro pedido.', k.nombre;
    end if;
    v_extra := jsonb_build_object('courier_anterior', e.courier, 'guia_anterior', e.guia, 'courier', k.codigo, 'guia', v_guia);
    update tumbo.envios
    set courier = k.codigo, guia = v_guia, despachado_en = now(), en_agencia_en = null,
        fecha_prometida = tumbo_privado.sumar_habiles(tumbo_privado.hoy(), greatest(coalesce(dias_max, 5) - coalesce(prepara_dias, 1), 1)),
        aviso_autoconfirmar_en = null
    where pedido_id = p_id returning * into e;
    update tumbo.envios set autoconfirmar_el = tumbo_privado.autoconfirmar_desde(now(), fecha_prometida)
    where pedido_id = p_id returning * into e;
    update tumbo.pedidos set courier = k.nombre, guia = v_guia where id = p_id;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'Reenvío con ' || k.nombre || ' · guía nueva ' || v_guia ||
      ' · entrega prevista hasta el ' || tumbo_privado.fecha_corta(e.fecha_prometida), 'local_shipping');
    perform tumbo_privado.encolar(v.comprador_id, 'pedido_despachado', jsonb_build_object('pedido', p_id, 'courier', k.nombre, 'guia', v_guia,
      'enlace', coalesce(tumbo_privado.url_rastreo(k.codigo, v_guia), tumbo_privado.enlace_app('app/tienda/pedido.html?id=' || p_id))));
  elsif p_tipo = 'perdida' then
    perform tumbo_privado.evento(p_id, 'Operaciones', 'El courier reporta la pérdida del paquete: Operaciones gestiona la solución', 'report');
  elsif p_tipo = 'dano_courier' then
    perform tumbo_privado.evento(p_id, 'Operaciones', 'El courier reporta daños en el paquete: Operaciones gestiona la solución', 'report');
  end if;
  insert into tumbo.incidencias (pedido_id, seller_id, tipo, origen, detalle, datos, estado, por, resuelta_en, resuelta_por)
  values (p_id, v.seller_id, p_tipo, 'ops', v_detalle, v_extra,
          case when p_tipo in ('reenvio', 'retraso') then 'resuelta' else 'abierta' end, yo.nombre || ' (' || yo.rol || ')',
          case when p_tipo in ('reenvio', 'retraso') then now() end,
          case when p_tipo in ('reenvio', 'retraso') then yo.nombre || ' (' || yo.rol || ')' end)
  returning id into v_id;
  if tumbo_privado.incidencia_publica(p_tipo) then
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Novedad en el envío de tu pedido ' || p_id || ': ' ||
      lower(tumbo_privado.texto_incidencia(p_tipo)), 'local_shipping', 'tienda/pedido.html?id=' || p_id);
  end if;
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Novedad en el envío de ' || p_id || ': ' || tumbo_privado.texto_incidencia(p_tipo),
    'report', 'seller/pedido.html?id=' || p_id, array['seller', 'operador']);
  perform tumbo_privado.auditar(yo, 'Novedad de envío', p_id || ' · ' || tumbo_privado.texto_incidencia(p_tipo) ||
    case when v_guia is not null then ' · guía ' || v_guia else '' end);
  return v_id;
end $$;

-- Cierra una incidencia. El comercio solo las que él mismo reportó.
create or replace function public.tm_incidencia_resolver(p_sesion text, p_incidencia bigint, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador', 'superadmin', 'ops']);
  i tumbo.incidencias;
  v tumbo.pedidos;
  v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 500), '');
begin
  select * into i from tumbo.incidencias where id = p_incidencia;
  if not found or (yo.rol in ('seller', 'operador') and (i.seller_id is distinct from yo.seller_id or i.origen <> 'seller')) then
    raise exception 'Incidencia no encontrada.';
  end if;
  v := tumbo_privado.bloquear_pedido(i.pedido_id, yo);
  select * into i from tumbo.incidencias where id = p_incidencia for update;
  if i.estado <> 'abierta' then
    raise exception 'Esa incidencia ya está resuelta.';
  end if;
  if char_length(coalesce(v_nota, '')) < 3 then
    raise exception 'Cuenta cómo se resolvió (al menos 3 caracteres).';
  end if;
  update tumbo.incidencias set estado = 'resuelta', resolucion = v_nota, resuelta_en = now(), resuelta_por = yo.nombre || ' (' || yo.rol || ')'
  where id = i.id;
  perform tumbo_privado.auditar(yo, 'Incidencia resuelta', i.pedido_id || ' · ' || tumbo_privado.texto_incidencia(i.tipo));
end $$;

-- Operaciones confirma una entrega a mano con la foto de la prueba del courier.
create or replace function public.tm_entrega_confirmar(p_sesion text, p_id text, p_foto uuid, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 300), '');
begin
  if v.estado <> 'despachado' then
    raise exception 'El pedido % no está en camino.', p_id;
  end if;
  if tumbo_privado.disputa_abierta(p_id) is not null then
    raise exception 'El pedido % tiene abierto el reclamo %: resuélvelo desde Disputas (si el paquete llegó, liberando los fondos).',
      p_id, tumbo_privado.disputa_abierta(p_id);
  end if;
  if p_foto is null or not exists (select 1 from tumbo.archivos a where a.id = p_foto and a.proposito = 'entrega'
                                    and a.entidad = p_id and a.estado = 'listo') then
    raise exception 'Adjunta la foto de la prueba de entrega del courier.';
  end if;
  perform tumbo_privado.envio_asegurar(p_id);
  update tumbo.envios set entrega_foto = p_foto, entrega_nota = v_nota, entrega_por = yo.nombre || ' (' || yo.rol || ')'
  where pedido_id = p_id;
  perform tumbo_privado.confirmar_entrega_interna(yo, v, 'Operaciones (prueba del courier)', 'Entrega confirmada con la prueba del courier');
end $$;

-- Devoluciones: instrucciones (Operaciones), guía de vuelta (comprador) e
-- inspección al recibir (comercio u Operaciones).
create or replace function public.tm_devolucion_instrucciones(p_sesion text, p_id text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  dv tumbo.devoluciones;
  v_paga text := coalesce(nullif(d ->> 'paga', ''), 'seller');
  v_ins text := nullif(left(btrim(coalesce(d ->> 'instrucciones', '')), 900), '');
  v_oficina bigint;
begin
  if v.estado <> 'devolucion' then
    raise exception 'El pedido % no tiene una devolución en curso.', p_id;
  end if;
  perform tumbo_privado.devolucion_crear(p_id);
  select * into dv from tumbo.devoluciones where pedido_id = p_id for update;
  if v_paga not in ('comprador', 'seller', 'tumbo') then
    raise exception 'Indica quién paga el envío de vuelta.';
  end if;
  begin
    v_oficina := nullif(d ->> 'oficina_id', '')::bigint;
  exception when others then
    raise exception 'Elige una oficina de la lista.';
  end;
  if v_oficina is not null and not exists (select 1 from tumbo.oficinas where id = v_oficina and activa) then
    raise exception 'Esa oficina no existe o no está activa.';
  end if;
  if v_ins is not null and char_length(v_ins) < 20 then
    raise exception 'Las instrucciones deben tener al menos 20 caracteres.';
  end if;
  update tumbo.devoluciones set paga = v_paga, oficina_id = coalesce(v_oficina, oficina_id), instrucciones = coalesce(v_ins, instrucciones),
                                actualizado = now()
  where pedido_id = p_id;
  perform tumbo_privado.evento(p_id, 'Operaciones', 'Instrucciones de devolución actualizadas · el envío de vuelta lo paga ' ||
    case v_paga when 'seller' then 'el comercio' when 'tumbo' then 'Tumbo' else 'el comprador' end, 'assignment_return');
  perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Actualizamos las instrucciones para devolver tu pedido ' || p_id,
    'assignment_return', 'tienda/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Instrucciones de devolución', p_id || ' · paga ' || v_paga);
end $$;

create or replace function public.tm_devolucion_guia(p_sesion text, p_id text, p_courier text, p_guia text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  dv tumbo.devoluciones;
  k tumbo.couriers;
  v_guia text := nullif(upper(btrim(coalesce(p_guia, ''))), '');
begin
  if v.estado <> 'devolucion' then
    raise exception 'El pedido % no tiene una devolución en curso.', p_id;
  end if;
  perform tumbo_privado.devolucion_crear(p_id);
  select * into dv from tumbo.devoluciones where pedido_id = p_id for update;
  if dv.estado not in ('instrucciones', 'en_transito') then
    raise exception 'La devolución de % ya se recibió.', p_id;
  end if;
  select * into k from tumbo.couriers where codigo = p_courier and activo and tipo = 'courier';
  if not found then
    raise exception 'Elige el courier con el que enviaste el producto.';
  end if;
  if v_guia is null or v_guia !~ '^[A-Z0-9][A-Z0-9 ./-]{2,39}$' then
    raise exception 'Escribe la guía del envío (letras, números, espacios y . / -).';
  end if;
  update tumbo.devoluciones set estado = 'en_transito', courier = k.codigo, guia = v_guia, enviada_en = now(), actualizado = now()
  where pedido_id = p_id;
  perform tumbo_privado.evento(p_id, 'Comprador', 'Devolución enviada con ' || k.nombre || ' · guía ' || v_guia, 'assignment_return');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'El comprador envió la devolución de ' || p_id || ' con ' || k.nombre || ' (guía ' || v_guia || ')',
    'assignment_return', 'seller/pedido.html?id=' || p_id, array['seller', 'operador']);
  perform tumbo_privado.notificar('rol:ops', 'Devolución de ' || p_id || ' en tránsito con ' || k.nombre, 'assignment_return', 'admin/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Devolución enviada', p_id || ' · ' || k.nombre || ' ' || v_guia);
end $$;

create or replace function public.tm_devolucion_inspeccionar(p_sesion text, p_id text, p_resultado text, p_nota text, p_foto uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador', 'superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  dv tumbo.devoluciones;
  v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 500), '');
begin
  if v.estado <> 'devolucion' then
    raise exception 'El pedido % no tiene una devolución en curso.', p_id;
  end if;
  if p_resultado is null or p_resultado not in ('apto', 'danado', 'incompleto') then
    raise exception 'Indica cómo llegó el producto: apto, dañado o incompleto.';
  end if;
  if p_resultado <> 'apto' and char_length(coalesce(v_nota, '')) < 5 then
    raise exception 'Describe el daño o lo que falta (al menos 5 caracteres).';
  end if;
  if p_foto is not null and not exists (select 1 from tumbo.archivos a where a.id = p_foto and a.proposito = 'entrega'
                                         and a.entidad = p_id and a.estado = 'listo') then
    raise exception 'La foto de la inspección no está lista: vuelve a subirla.';
  end if;
  perform tumbo_privado.devolucion_crear(p_id);
  select * into dv from tumbo.devoluciones where pedido_id = p_id for update;
  if dv.estado = 'cerrada' then
    raise exception 'La devolución de % ya está cerrada.', p_id;
  end if;
  -- El comercio la registra cuando el comprador ya la envió (con su guía) y
  -- una sola vez. Operaciones puede registrarla sin guía (llegó por otra vía)
  -- o corregir una inspección, siempre dejando la nota de lo que pasó.
  if yo.rol in ('seller', 'operador') then
    if dv.estado = 'instrucciones' then
      raise exception 'El comprador aún no registra el envío de la devolución de %: regístrala como recibida cuando llegue (si llegó sin guía, avísale a Operaciones).', p_id;
    elsif dv.estado = 'recibida' then
      raise exception 'La devolución de % ya se inspeccionó: si hay que corregirla, avísale a Operaciones.', p_id;
    end if;
  elsif dv.estado in ('instrucciones', 'recibida') and char_length(coalesce(v_nota, '')) < 10 then
    raise exception '%', case when dv.estado = 'instrucciones'
      then 'El comprador no registró la guía de vuelta: deja una nota (al menos 10 caracteres) de cómo llegó la devolución.'
      else 'Para corregir la inspección deja una nota (al menos 10 caracteres) con el motivo.' end;
  end if;
  update tumbo.devoluciones
  set estado = 'recibida', recibida_en = coalesce(recibida_en, now()), inspeccion = p_resultado, inspeccion_nota = v_nota,
      inspeccion_foto = coalesce(p_foto, inspeccion_foto), inspeccionada_por = yo.nombre || ' (' || yo.rol || ')', actualizado = now()
  where pedido_id = p_id;
  -- (con el ícono de las devoluciones, que tm_cargar no le muestra al
  -- operador: como el resto de los eventos de reclamos y dinero)
  perform tumbo_privado.evento(p_id, case when yo.rol in ('ops', 'superadmin') then 'Operaciones' else v.seller_id end,
    'Devolución recibida e inspeccionada: ' || case p_resultado when 'apto' then 'el producto llegó en buen estado'
      when 'danado' then 'el producto llegó dañado' else 'el producto llegó incompleto' end || ' · Operaciones cierra el caso', 'assignment_return');
  perform tumbo_privado.notificar('rol:ops', 'Devolución de ' || p_id || ' inspeccionada: ' || p_resultado || ' (falta cerrarla)',
    'assignment_return', 'admin/pedido.html?id=' || p_id);
  perform tumbo_privado.auditar(yo, 'Inspección de devolución', p_id || ' · ' || p_resultado);
end $$;

-- Responsable de un caso en Operaciones (o nadie).
create or replace function public.tm_operaciones_asignar(p_sesion text, p_id text, p_responsable uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  u tumbo.usuarios;
begin
  if p_responsable is not null then
    select * into u from tumbo.usuarios where id = p_responsable and activo and rol in ('superadmin', 'ops');
    if not found then
      raise exception 'Esa persona no es del equipo de Operaciones.';
    end if;
  end if;
  perform tumbo_privado.envio_asegurar(p_id);
  update tumbo.envios set responsable_id = u.id, responsable = u.nombre, asignado_en = case when u.id is null then null else now() end
  where pedido_id = p_id;
  perform tumbo_privado.auditar(yo, 'Responsable asignado', p_id || ' → ' || coalesce(u.nombre, 'nadie'));
end $$;

-- Notas internas (no las ven el comprador ni el comercio).
create or replace function public.tm_nota_interna(p_sesion text, p_id text, p_texto text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id bigint;
begin
  if char_length(v_texto) < 3 or char_length(v_texto) > 1000 then
    raise exception 'La nota debe tener entre 3 y 1.000 caracteres.';
  end if;
  if (select count(*) from tumbo.notas_pedido where pedido_id = p_id) >= 100 then
    raise exception 'El pedido % ya tiene 100 notas internas.', p_id;
  end if;
  insert into tumbo.notas_pedido (pedido_id, autor_id, autor, texto)
  values (p_id, yo.id, yo.nombre || ' (' || yo.rol || ')', v_texto) returning id into v_id;
  perform tumbo_privado.auditar(yo, 'Nota interna', p_id);
  return v_id;
end $$;

-- Detalle 360 de un pedido para Operaciones: línea de tiempo unificada,
-- datos con mínimo privilegio, notas internas y acciones posibles.
create or replace function public.tm_pedido_360(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos;
  e tumbo.envios;
  u tumbo.usuarios;
  s tumbo.sellers;
  dv tumbo.devoluciones;
  d tumbo.disputas;
  v_activo boolean;
  v_linea jsonb;
  v_acciones text[] := '{}';
begin
  select * into v from tumbo.pedidos where id = p_id;
  if not found then
    raise exception 'Pedido % no encontrado.', left(coalesce(p_id, ''), 30);
  end if;
  e := tumbo_privado.envio_asegurar(v.id);
  select * into u from tumbo.usuarios where id = v.comprador_id;
  select * into s from tumbo.sellers where id = v.seller_id;
  select * into dv from tumbo.devoluciones where pedido_id = v.id;
  select * into d from tumbo.disputas where pedido_id = v.id;
  v_activo := v.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion') or (d.id is not null and d.estado <> 'resuelta');

  select coalesce(jsonb_agg(x order by x ->> 'fecha', x ->> 'orden'), '[]'::jsonb) into v_linea from (
    select jsonb_build_object('fecha', pe.fecha, 'orden', 'a' || lpad(pe.id::text, 12, '0'), 'tipo', 'evento', 'actor', pe.actor,
                              'texto', pe.texto, 'icono', pe.icono, 'interno', false) as x
    from tumbo.pedido_eventos pe where pe.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', i.creado, 'orden', 'b' || lpad(i.id::text, 12, '0'), 'tipo', 'incidencia', 'actor', i.por,
             'texto', tumbo_privado.texto_incidencia(i.tipo) || ': ' || i.detalle || case when i.estado = 'resuelta' then ' · resuelta' ||
               coalesce(': ' || i.resolucion, '') else ' · abierta' end, 'icono', 'report', 'interno', not tumbo_privado.incidencia_publica(i.tipo),
             'id', i.id, 'estado', i.estado)
    from tumbo.incidencias i where i.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', n.creado, 'orden', 'c' || lpad(n.id::text, 12, '0'), 'tipo', 'nota', 'actor', n.autor,
                              'texto', n.texto, 'icono', 'sticky_note_2', 'interno', true)
    from tumbo.notas_pedido n where n.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', sc.decidido_en, 'orden', 'd' || lpad(sc.id::text, 12, '0'), 'tipo', 'solicitud',
             'actor', coalesce(sc.decidido_por, 'Sistema'), 'texto', 'Solicitud de cancelación ' ||
               case sc.estado when 'aprobada' then 'aprobada' when 'rechazada' then 'rechazada' when 'automatica' then 'aprobada sola por vencimiento'
                              else 'cerrada' end || coalesce(': ' || sc.respuesta, ''), 'icono', 'pending', 'interno', false)
    from tumbo.solicitudes_cancelacion sc where sc.pedido_id = v.id and sc.decidido_en is not null
    union all
    select jsonb_build_object('fecha', r.creado, 'orden', 'e' || lpad(r.id::text, 12, '0'), 'tipo', 'reembolso', 'actor', coalesce(r.por, 'Sistema'),
             'texto', 'Reembolso ' || r.estado || ' por ' || tumbo_privado.fmt_usd(r.monto_usd) || ' · ' || r.motivo, 'icono', 'undo', 'interno', true)
    from tumbo.reembolsos r where r.pedido_id = v.id
    union all
    select jsonb_build_object('fecha', e.escalado_aceptar_en, 'orden', 'f1', 'tipo', 'sla', 'actor', 'Sistema',
             'texto', 'SLA de aceptación vencido: escalado a Operaciones', 'icono', 'alarm', 'interno', true)
    where e.escalado_aceptar_en is not null
    union all
    select jsonb_build_object('fecha', e.escalado_despacho_en, 'orden', 'f2', 'tipo', 'sla', 'actor', 'Sistema',
             'texto', 'Plazo de despacho vencido: escalado a Operaciones', 'icono', 'alarm', 'interno', true)
    where e.escalado_despacho_en is not null
    union all
    select jsonb_build_object('fecha', e.asignado_en, 'orden', 'f3', 'tipo', 'asignacion', 'actor', 'Operaciones',
             'texto', 'Responsable: ' || e.responsable, 'icono', 'person', 'interno', true)
    where e.asignado_en is not null
  ) y;

  -- con un reclamo abierto, la entrega y la cancelación por pérdida se
  -- deciden en Disputas (los fondos siguen congelados)
  if v.estado = 'despachado' then
    v_acciones := v_acciones || 'novedad'::text;
    if d.id is null or d.estado = 'resuelta' then v_acciones := v_acciones || array['confirmar_entrega', 'cancelar_perdida']; end if;
  end if;
  if v.estado = 'despachado' and e.retiro and e.courier <> 'tienda' and e.en_agencia_en is null then v_acciones := v_acciones || 'en_agencia'::text; end if;
  if v.estado in ('por_aceptar', 'preparando', 'listo') then v_acciones := v_acciones || 'cancelar'::text; end if;
  -- devolución: el reembolso, solo después de la inspección; «no llegó», solo
  -- si aún no se recibió
  if v.estado = 'devolucion' then
    v_acciones := v_acciones || array['devolucion_instrucciones', 'devolucion_inspeccionar'];
    if dv.estado = 'recibida' and dv.inspeccion is not null then v_acciones := v_acciones || 'devolucion_reembolsar'::text;
    else v_acciones := v_acciones || 'devolucion_no_llego'::text; end if;
  end if;
  if v.estado in ('preparando', 'listo', 'despachado') then v_acciones := v_acciones || 'etiqueta'::text; end if;
  v_acciones := v_acciones || array['nota', 'asignar'];

  return jsonb_build_object(
    'pedido', (to_jsonb(v) - 'comprador_id' - 'ref_clave' - 'ref_numero' - 'red' - 'destino') || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(i) - 'pedido_id' order by i.sku) from tumbo.pedido_items i where i.pedido_id = v.id), '[]'::jsonb),
      'bruto_usd', tumbo_privado.bruto_pedido(v.id)),
    'seller', jsonb_build_object('id', s.id, 'nombre', s.nombre, 'ciudad', s.ciudad, 'estado', s.estado),
    'comprador', jsonb_build_object('nombre', case when v_activo then u.nombre else left(u.nombre, 1) || '•••' end,
      'email', case when v_activo then u.email else tumbo_privado.ocultar(split_part(u.email, '@', 1), 2) || '@' || split_part(u.email, '@', 2) end,
      'telefono', case when v_activo then u.telefono else tumbo_privado.ocultar(u.telefono, 4) end,
      'pedidos', (select count(*) from tumbo.pedidos x where x.comprador_id = v.comprador_id),
      'cancelados', (select count(*) from tumbo.pedidos x where x.comprador_id = v.comprador_id and x.estado = 'cancelado'),
      'reclamos', (select count(*) from tumbo.disputas x where x.comprador_id = v.comprador_id)),
    'destinatario', tumbo_privado.destinatario_visible(yo, v),
    'envio', tumbo_privado.envio_resumen(e, v) || jsonb_build_object('guia_foto', e.guia_foto, 'entrega_foto', e.entrega_foto,
      'entrega_nota', e.entrega_nota, 'entrega_por', e.entrega_por, 'despachado_por', e.despachado_por,
      'costo_cotizado_usd', e.costo_cotizado_usd, 'peso_kg', e.peso_kg, 'dias_min', e.dias_min, 'dias_max', e.dias_max,
      'responsable_id', e.responsable_id),
    'disputa', case when d.id is not null then jsonb_build_object('id', d.id, 'motivo', d.motivo, 'estado', d.estado, 'creado', d.creado) end,
    'devolucion', case when dv.pedido_id is not null then to_jsonb(dv) end,
    'incidencias', coalesce((select jsonb_agg(tumbo_privado.incidencia_json(i, true) order by i.creado desc)
                             from tumbo.incidencias i where i.pedido_id = v.id), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'autor', n.autor, 'texto', n.texto, 'creado', n.creado) order by n.creado desc)
                       from tumbo.notas_pedido n where n.pedido_id = v.id), '[]'::jsonb),
    'linea', v_linea,
    'acciones', to_jsonb(v_acciones),
    'responsables', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'rol', x.rol) order by x.nombre)
                              from tumbo.usuarios x where x.activo and x.rol in ('superadmin', 'ops')), '[]'::jsonb),
    'oficinas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'courier', o.courier, 'ciudad', o.ciudad, 'estado', o.estado)
                                           order by o.estado, o.nombre)
                          from tumbo.oficinas o where o.activa and (o.courier = e.courier or o.courier = dv.courier
                                                                     or o.estado = (tumbo_privado.config_envio(v.seller_id)).origen_estado)), '[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object('codigo', k.codigo, 'nombre', k.nombre, 'tipo', k.tipo) order by k.orden)
                          from tumbo.couriers k where k.activo), '[]'::jsonb));
end $$;

-- Panel de Operaciones: semáforo de SLA y casos, con filtros
-- {bucket, seller, responsable ('yo' | 'sin' | uuid), q}.
create or replace function public.tm_operaciones_panel(p_sesion text, p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  f jsonb := case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end;
  v_bucket text := nullif(f ->> 'bucket', '');
  v_seller text := nullif(f ->> 'seller', '');
  v_resp text := nullif(f ->> 'responsable', '');
  v_q text := nullif(upper(btrim(coalesce(f ->> 'q', ''))), '');
  v_sin_novedad interval := make_interval(days => tumbo_privado.logistica('sin_novedad_dias', 5)::integer);
  v_recordar interval := make_interval(hours => tumbo_privado.logistica('recordar_horas', 6)::integer);
  v_casos jsonb;
  v_conteos jsonb;
begin
  perform tumbo_privado.envio_asegurar(p.id) from tumbo.pedidos p
  where p.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
    and not exists (select 1 from tumbo.envios e where e.pedido_id = p.id);

  with base as (
    select p.id, p.seller_id, p.estado, p.creado, e.aceptar_antes, e.despachar_antes, e.listo_en, e.despachado_en,
           e.fecha_prometida, e.responsable_id, e.responsable, e.courier, e.guia,
           array_remove(array[
             case when p.estado = 'por_aceptar' and e.aceptar_antes < now() then 'aceptar_vencido' end,
             case when p.estado = 'por_aceptar' and e.aceptar_antes >= now() and e.aceptar_antes < now() + v_recordar then 'aceptar_riesgo' end,
             case when p.estado in ('preparando', 'listo') and e.despachar_antes < now() then 'despacho_vencido' end,
             case when p.estado = 'listo' and e.listo_en < now() - interval '24 hours'
                       and not (e.despachar_antes < now()) then 'listo_sin_despacho' end,
             case when p.estado = 'despachado' and coalesce(e.despachado_en, p.despachado_el) < now() - v_sin_novedad then 'sin_novedad' end,
             case when p.estado = 'devolucion' then 'devolucion' end,
             case when exists (select 1 from tumbo.incidencias i where i.pedido_id = p.id and i.estado = 'abierta') then 'incidencia' end,
             case when exists (select 1 from tumbo.solicitudes_cancelacion s where s.pedido_id = p.id and s.estado = 'pendiente') then 'solicitud' end,
             case when exists (select 1 from tumbo.disputas d where d.pedido_id = p.id and d.estado <> 'resuelta' and d.motivo = 'No llegó') then 'no_llego' end
           ], null) as buckets
    from tumbo.pedidos p join tumbo.envios e on e.pedido_id = p.id
    where p.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion', 'entregado')
  ), casos as (
    select b.*, s.nombre as seller_nombre,
           case when b.buckets && array['aceptar_vencido', 'despacho_vencido', 'no_llego'] then 'rojo'
                when exists (select 1 from tumbo.incidencias i where i.pedido_id = b.id and i.estado = 'abierta' and i.tipo in ('perdida', 'dano_courier'))
                  then 'rojo'
                when cardinality(b.buckets) > 0 then 'ambar' else 'verde' end as nivel
    from base b join tumbo.sellers s on s.id = b.seller_id
    where cardinality(b.buckets) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', c.id, 'seller_id', c.seller_id, 'seller', c.seller_nombre, 'estado', c.estado,
           'buckets', to_jsonb(c.buckets), 'nivel', c.nivel, 'creado', c.creado, 'aceptar_antes', c.aceptar_antes,
           'despachar_antes', c.despachar_antes, 'despachado_en', c.despachado_en, 'fecha_prometida', c.fecha_prometida,
           'responsable_id', c.responsable_id, 'responsable', c.responsable, 'courier', c.courier, 'guia', c.guia)
           order by case c.nivel when 'rojo' then 0 else 1 end, c.creado, c.id) filter (where
             (v_bucket is null or v_bucket = any (c.buckets)) and (v_seller is null or c.seller_id = v_seller)
             and (v_resp is null or (v_resp = 'sin' and c.responsable_id is null) or (v_resp = 'yo' and c.responsable_id = yo.id)
                  or c.responsable_id::text = v_resp)
             and (v_q is null or c.id like '%' || v_q || '%' or upper(coalesce(c.guia, '')) like '%' || v_q || '%')), '[]'::jsonb),
         jsonb_build_object(
           'aceptar_vencido', count(*) filter (where 'aceptar_vencido' = any (c.buckets)),
           'aceptar_riesgo', count(*) filter (where 'aceptar_riesgo' = any (c.buckets)),
           'despacho_vencido', count(*) filter (where 'despacho_vencido' = any (c.buckets)),
           'listo_sin_despacho', count(*) filter (where 'listo_sin_despacho' = any (c.buckets)),
           'sin_novedad', count(*) filter (where 'sin_novedad' = any (c.buckets)),
           'devolucion', count(*) filter (where 'devolucion' = any (c.buckets)),
           'incidencia', count(*) filter (where 'incidencia' = any (c.buckets)),
           'solicitud', count(*) filter (where 'solicitud' = any (c.buckets)),
           'no_llego', count(*) filter (where 'no_llego' = any (c.buckets)))
    into v_casos, v_conteos
  from casos c;

  return jsonb_build_object(
    'ahora', now(),
    'conteos', v_conteos,
    'casos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_casos) x limit 300) y),
    'total', jsonb_array_length(v_casos),
    'responsables', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'rol', x.rol) order by x.nombre)
                              from tumbo.usuarios x where x.activo and x.rol in ('superadmin', 'ops')), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.nombre) from tumbo.sellers s), '[]'::jsonb),
    'tarea_sla', (select to_jsonb(t) from tumbo.tareas_registro t where t.tarea = 'sla'));
end $$;

-- ---------------------------------------------------------------------------
-- Configuración de la plataforma (superadmin y Operaciones con sesión
-- elevada: nunca las cuentas de prueba, cuya contraseña es pública)
-- ---------------------------------------------------------------------------
create or replace function public.tm_courier_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_codigo text := lower(btrim(coalesce(d ->> 'codigo', '')));
  antes tumbo.couriers;
  k tumbo.couriers;
  v_url text := nullif(btrim(coalesce(d ->> 'url_rastreo', '')), '');
begin
  perform tumbo_privado.exigir_elevada(yo);
  if v_codigo !~ '^[a-z][a-z0-9_]{1,19}$' then
    raise exception 'El código del courier admite minúsculas, números y _ (2 a 20 caracteres).';
  end if;
  if v_url is not null and (v_url !~ '^https://[^[:space:]<>"'']+$' or position('{guia}' in v_url) = 0 or char_length(v_url) > 300) then
    raise exception 'El patrón de rastreo debe empezar por https:// y llevar {guia} donde va el número.';
  end if;
  if char_length(btrim(coalesce(d ->> 'nombre', ''))) not between 2 and 60 then
    raise exception 'El nombre del courier debe tener entre 2 y 60 caracteres.';
  end if;
  select * into antes from tumbo.couriers where codigo = v_codigo for update;
  if not found and (select count(*) from tumbo.couriers) >= 30 then
    raise exception 'Se admiten hasta 30 couriers.';
  end if;
  insert into tumbo.couriers (codigo, nombre, tipo, agencia, domicilio, cobro_destino, url_rastreo, activo, orden, nota, actualizado, por)
  values (v_codigo, btrim(d ->> 'nombre'), coalesce(antes.tipo, 'courier'),
          coalesce((d ->> 'agencia')::boolean, antes.agencia, true), coalesce((d ->> 'domicilio')::boolean, antes.domicilio, true),
          coalesce((d ->> 'cobro_destino')::boolean, antes.cobro_destino, false), v_url,
          coalesce((d ->> 'activo')::boolean, antes.activo, true), coalesce((d ->> 'orden')::integer, antes.orden, 100),
          nullif(left(btrim(coalesce(d ->> 'nota', '')), 300), ''), now(), yo.nombre || ' (' || yo.rol || ')')
  on conflict (codigo) do update set nombre = excluded.nombre, agencia = excluded.agencia, domicilio = excluded.domicilio,
    cobro_destino = excluded.cobro_destino, url_rastreo = excluded.url_rastreo, activo = excluded.activo, orden = excluded.orden,
    nota = excluded.nota, actualizado = now(), por = excluded.por
  returning * into k;
  perform tumbo_privado.auditar(yo, 'Courier ' || case when antes.codigo is null then 'creado' else 'actualizado' end,
    k.codigo || ': ' || left(coalesce((to_jsonb(antes) - 'actualizado' - 'por')::text, '—'), 300) || ' → ' ||
    left((to_jsonb(k) - 'actualizado' - 'por')::text, 300));
  return to_jsonb(k);
end $$;

create or replace function public.tm_tarifa_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  antes tumbo.tarifas;
  t tumbo.tarifas;
  v_id bigint;
  v_peso numeric;
  v_costo numeric;
  v_dmin integer;
  v_dmax integer;
begin
  perform tumbo_privado.exigir_elevada(yo);
  begin
    v_id := nullif(d ->> 'id', '')::bigint;
    v_peso := round((d ->> 'peso_hasta_kg')::numeric, 2);
    v_costo := round((d ->> 'costo_usd')::numeric, 2);
    v_dmin := (d ->> 'dias_min')::integer;
    v_dmax := (d ->> 'dias_max')::integer;
  exception when others then
    raise exception 'El peso, el costo y los días deben ser números.';
  end;
  if v_id is not null then
    select * into antes from tumbo.tarifas where id = v_id for update;
    if not found then
      raise exception 'Esa tarifa no existe.';
    end if;
  else
    if not exists (select 1 from tumbo.couriers where codigo = d ->> 'courier' and tipo = 'courier') then
      raise exception 'Elige un courier.';
    end if;
    if coalesce(d ->> 'alcance', '') not in ('local', 'regional', 'nacional', 'remota') or coalesce(d ->> 'tipo', '') not in ('agencia', 'domicilio') then
      raise exception 'Elige la zona tarifaria y el servicio.';
    end if;
    if (select count(*) from tumbo.tarifas) >= 600 then
      raise exception 'Se admiten hasta 600 tarifas.';
    end if;
  end if;
  v_peso := coalesce(v_peso, antes.peso_hasta_kg);
  v_costo := coalesce(v_costo, antes.costo_usd);
  v_dmin := coalesce(v_dmin, antes.dias_min);
  v_dmax := coalesce(v_dmax, antes.dias_max);
  if v_peso is null or v_peso <= 0 or v_peso > 1000 then
    raise exception 'El tramo de peso va de 0,01 a 1.000 kg.';
  end if;
  if v_costo is null or v_costo < 0 or v_costo > 1000 then
    raise exception 'El costo va de 0 a 1.000 USD.';
  end if;
  if v_dmin is null or v_dmax is null or v_dmin < 0 or v_dmax > 45 or v_dmax < v_dmin then
    raise exception 'Los días hábiles van de 0 a 45 y el máximo no puede ser menor que el mínimo.';
  end if;
  if v_id is not null then
    if exists (select 1 from tumbo.tarifas x where x.courier = antes.courier and x.alcance = antes.alcance and x.tipo = antes.tipo
               and x.peso_hasta_kg = v_peso and x.id <> v_id) then
      raise exception 'Ya hay una tarifa para ese tramo de peso.';
    end if;
    update tumbo.tarifas set peso_hasta_kg = v_peso, costo_usd = v_costo, dias_min = v_dmin, dias_max = v_dmax,
                             activo = coalesce((d ->> 'activo')::boolean, activo), referencia = false,
                             actualizado = now(), por = yo.nombre || ' (' || yo.rol || ')'
    where id = v_id returning * into t;
  else
    insert into tumbo.tarifas (courier, alcance, tipo, peso_hasta_kg, costo_usd, dias_min, dias_max, referencia, activo, por)
    values (d ->> 'courier', d ->> 'alcance', d ->> 'tipo', v_peso, v_costo, v_dmin, v_dmax, false,
            coalesce((d ->> 'activo')::boolean, true), yo.nombre || ' (' || yo.rol || ')')
    returning * into t;
  end if;
  perform tumbo_privado.auditar(yo, 'Tarifa de envío ' || case when antes.id is null then 'creada' else 'actualizada' end,
    t.courier || ' ' || t.alcance || ' ' || t.tipo || ' hasta ' || t.peso_hasta_kg || ' kg: ' ||
    coalesce(tumbo_privado.fmt_usd(antes.costo_usd) || ' (' || antes.dias_min || '–' || antes.dias_max || ' d)', '—') || ' → ' ||
    tumbo_privado.fmt_usd(t.costo_usd) || ' (' || t.dias_min || '–' || t.dias_max || ' d)' || case when not t.activo then ' inactiva' else '' end);
  return to_jsonb(t);
end $$;

create or replace function public.tm_oficina_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_id bigint;
  antes tumbo.oficinas;
  o tumbo.oficinas;
  v_estado text := tumbo_privado.lugar_estado(d ->> 'estado', array['estado']);
begin
  perform tumbo_privado.exigir_elevada(yo);
  begin
    v_id := nullif(d ->> 'id', '')::bigint;
  exception when others then
    raise exception 'Esa oficina no existe.';
  end;
  if v_id is not null then
    select * into antes from tumbo.oficinas where id = v_id for update;
    if not found then
      raise exception 'Esa oficina no existe.';
    end if;
  elsif (select count(*) from tumbo.oficinas) >= 3000 then
    raise exception 'Se admiten hasta 3.000 oficinas.';
  end if;
  if not exists (select 1 from tumbo.couriers where codigo = coalesce(d ->> 'courier', antes.courier) and tipo = 'courier') then
    raise exception 'Elige el courier de la oficina.';
  end if;
  if coalesce(v_estado, antes.estado) is null then
    raise exception 'Elige el estado de la oficina.';
  end if;
  if char_length(btrim(coalesce(d ->> 'ciudad', antes.ciudad, ''))) not between 2 and 60
     or char_length(btrim(coalesce(d ->> 'nombre', antes.nombre, ''))) not between 3 and 80
     or char_length(btrim(coalesce(d ->> 'direccion', antes.direccion, ''))) not between 10 and 300 then
    raise exception 'Completa la ciudad, el nombre (3 a 80) y la dirección (10 a 300 caracteres) de la oficina.';
  end if;
  if v_id is null then
    insert into tumbo.oficinas (courier, estado, ciudad, nombre, direccion, telefono, horario, activa, por)
    values (d ->> 'courier', v_estado, btrim(d ->> 'ciudad'), btrim(d ->> 'nombre'), btrim(d ->> 'direccion'),
            nullif(left(btrim(coalesce(d ->> 'telefono', '')), 30), ''), nullif(left(btrim(coalesce(d ->> 'horario', '')), 120), ''),
            coalesce((d ->> 'activa')::boolean, true), yo.nombre || ' (' || yo.rol || ')')
    returning * into o;
  else
    update tumbo.oficinas
    set courier = coalesce(d ->> 'courier', courier), estado = coalesce(v_estado, estado),
        ciudad = coalesce(nullif(btrim(d ->> 'ciudad'), ''), ciudad), nombre = coalesce(nullif(btrim(d ->> 'nombre'), ''), nombre),
        direccion = coalesce(nullif(btrim(d ->> 'direccion'), ''), direccion),
        telefono = case when d ? 'telefono' then nullif(left(btrim(coalesce(d ->> 'telefono', '')), 30), '') else telefono end,
        horario = case when d ? 'horario' then nullif(left(btrim(coalesce(d ->> 'horario', '')), 120), '') else horario end,
        activa = coalesce((d ->> 'activa')::boolean, activa), actualizado = now(), por = yo.nombre || ' (' || yo.rol || ')'
    where id = v_id returning * into o;
  end if;
  perform tumbo_privado.auditar(yo, 'Oficina ' || case when antes.id is null then 'creada' else 'actualizada' end,
    o.id || ' · ' || o.courier || ' · ' || o.nombre || ' (' || o.ciudad || ', ' || o.estado || ')' || case when not o.activa then ' inactiva' else '' end);
  return to_jsonb(o);
end $$;

create or replace function public.tm_zona_estado(p_sesion text, p_estado text, p_zona text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v_estado text := tumbo_privado.lugar_estado(p_estado, array['estado']);
  antes text;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if v_estado is null then
    raise exception 'Ese estado no existe.';
  end if;
  if not exists (select 1 from tumbo.envio_zonas where codigo = p_zona) then
    raise exception 'Esa región no existe.';
  end if;
  select zona into antes from tumbo.envio_estados where estado = v_estado for update;
  update tumbo.envio_estados set zona = p_zona where estado = v_estado;
  perform tumbo_privado.auditar(yo, 'Región de envío cambiada', v_estado || ': ' || antes || ' → ' || p_zona);
end $$;

create or replace function public.tm_feriado_guardar(p_sesion text, p_fecha date, p_nombre text, p_activo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v_nombre text := btrim(coalesce(p_nombre, ''));
begin
  perform tumbo_privado.exigir_elevada(yo);
  if p_fecha is null or p_fecha < tumbo_privado.hoy() - 366 or p_fecha > tumbo_privado.hoy() + 800 then
    raise exception 'Elige una fecha entre el año pasado y los próximos dos años.';
  end if;
  if char_length(v_nombre) not between 3 and 80 then
    raise exception 'El nombre del feriado debe tener entre 3 y 80 caracteres.';
  end if;
  if not exists (select 1 from tumbo.feriados where fecha = p_fecha) and (select count(*) from tumbo.feriados) >= 400 then
    raise exception 'Se admiten hasta 400 feriados.';
  end if;
  insert into tumbo.feriados (fecha, nombre, activo) values (p_fecha, v_nombre, coalesce(p_activo, true))
  on conflict (fecha) do update set nombre = excluded.nombre, activo = excluded.activo;
  perform tumbo_privado.auditar(yo, 'Feriado guardado', to_char(p_fecha, 'DD/MM/YYYY') || ' · ' || v_nombre ||
    case when coalesce(p_activo, true) then '' else ' (inactivo)' end);
end $$;

-- Los plazos de la operación (ajuste «logistica»): superadmin y Operaciones
-- con sesión elevada, cada uno dentro de su rango y coherentes entre sí (el
-- recordatorio antes del vencimiento, la cancelación después de él y el
-- aviso antes de la autoconfirmación).
create or replace function public.tm_logistica_plazos_guardar(p_sesion text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d jsonb := case when jsonb_typeof(p_valor) = 'object' then p_valor else '{}'::jsonb end;
  antes jsonb;
  v jsonb;
  k text;
  r numeric[];
  n numeric;
  v_nombres constant jsonb := '{"aceptar_horas": "Las horas para aceptar", "recordar_horas": "El recordatorio",
    "cancelar_horas": "La cancelación sin aceptar", "solicitud_horas": "Las horas para responder una solicitud de cancelación",
    "autoconfirmar_dias": "Los días para dar por recibida una entrega", "aviso_autoconfirmar_dias": "El aviso previo",
    "reclamo_no_llego_habiles": "Los días de gracia del reclamo «no llegó»", "sin_novedad_dias": "Los días sin novedades",
    "peso_defecto_kg": "El peso por omisión"}';
begin
  perform tumbo_privado.exigir_elevada(yo);
  select a.valor into antes from tumbo.ajustes a where a.clave = 'logistica' for update;
  if antes is null then
    raise exception 'El ajuste de los plazos no existe.';
  end if;
  v := antes;
  for k in select jsonb_object_keys(d) loop
    r := tumbo_privado.logistica_rango(k);
    if r is null then
      raise exception 'Ese plazo no existe.';
    end if;
    if jsonb_typeof(d -> k) <> 'number' then
      raise exception '% debe ser un número.', v_nombres ->> k;
    end if;
    n := (d ->> k)::numeric;
    if k <> 'peso_defecto_kg' and n <> trunc(n) then
      raise exception '% debe ser un número entero.', v_nombres ->> k;
    end if;
    if n < r[1] or n > r[2] then
      raise exception '% va de % a %.', v_nombres ->> k, replace(r[1]::text, '.', ','), replace(r[2]::text, '.', ',');
    end if;
    v := v || jsonb_build_object(k, n);
  end loop;
  if tumbo_privado.numero(v -> 'recordar_horas', 6) >= tumbo_privado.numero(v -> 'aceptar_horas', 24) then
    raise exception 'El recordatorio debe llegar antes de que venza el plazo para aceptar.';
  end if;
  if tumbo_privado.numero(v -> 'cancelar_horas', 48) <= tumbo_privado.numero(v -> 'aceptar_horas', 24) then
    raise exception 'La cancelación sin aceptar debe ser después del plazo para aceptar.';
  end if;
  if tumbo_privado.numero(v -> 'aviso_autoconfirmar_dias', 2) >= tumbo_privado.numero(v -> 'autoconfirmar_dias', 10) then
    raise exception 'El aviso previo debe llegar antes de dar por recibida la entrega.';
  end if;
  update tumbo.ajustes set valor = v, actualizado = now(), por = yo.nombre || ' (' || yo.rol || ')' where clave = 'logistica';
  perform tumbo_privado.auditar(yo, 'Plazos de logística', left(antes::text, 400) || ' → ' || left(v::text, 400));
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Tarea programada: SLA, solicitudes y autoconfirmación
-- ---------------------------------------------------------------------------
-- Recuerda al comercio los pedidos por aceptar que vencen pronto, escala a
-- Operaciones los vencidos (aceptación y despacho), cancela con reembolso los
-- que nadie aceptó a tiempo, aprueba las solicitudes de cancelación sin
-- respuesta, avisa antes de dar por recibida una entrega y la da por
-- recibida si el comprador no confirmó ni reclamó. Hasta 100 casos por paso
-- y por ejecución; cada caso va aparte (uno que falla no frena a los demás).
create function tumbo_privado.tarea_sla() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_recordar interval := make_interval(hours => tumbo_privado.logistica('recordar_horas', 6)::integer);
  v_cancelar interval := make_interval(hours => tumbo_privado.logistica('cancelar_horas', 48)::integer);
  v_aviso interval := make_interval(days => tumbo_privado.logistica('aviso_autoconfirmar_dias', 2)::integer);
  v tumbo.pedidos;
  e tumbo.envios;
  s tumbo.solicitudes_cancelacion;
  n_rec integer := 0;
  n_esc integer := 0;
  n_esc_d integer := 0;
  n_can integer := 0;
  n_sol integer := 0;
  n_avi integer := 0;
  n_con integer := 0;
  n_err integer := 0;
  r jsonb;
begin
  perform tumbo_privado.envio_asegurar(p.id) from tumbo.pedidos p
  where p.estado in ('por_aceptar', 'preparando', 'listo', 'despachado')
    and not exists (select 1 from tumbo.envios x where x.pedido_id = p.id);

  -- 1) recordatorio al comercio
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'por_aceptar' and x.recordado_en is null and x.aceptar_antes - v_recordar <= now() and x.aceptar_antes > now()
           order by x.aceptar_antes limit 100 loop
    begin
      update tumbo.envios set recordado_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('seller:' || e.seller_id, 'El pedido ' || e.pedido_id || ' vence pronto: acéptalo antes de ' ||
        tumbo_privado.fecha_hora_ve(e.aceptar_antes), 'alarm', 'seller/pedido.html?id=' || e.pedido_id, array['seller', 'operador']);
      n_rec := n_rec + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 2) escalado de la aceptación vencida
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'por_aceptar' and x.escalado_aceptar_en is null and x.aceptar_antes <= now()
           order by x.aceptar_antes limit 100 loop
    begin
      update tumbo.envios set escalado_aceptar_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('rol:ops', 'El pedido ' || e.pedido_id || ' (' || e.seller_id || ') lleva más de ' ||
        tumbo_privado.logistica('aceptar_horas', 24) || ' h sin aceptar', 'alarm', 'admin/pedido.html?id=' || e.pedido_id);
      perform tumbo_privado.notificar('seller:' || e.seller_id, 'Venció el plazo para aceptar ' || e.pedido_id ||
        ': si no lo aceptas, se cancelará con reembolso', 'alarm', 'seller/pedido.html?id=' || e.pedido_id, array['seller', 'operador']);
      n_esc := n_esc + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 3) escalado del despacho vencido
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado in ('preparando', 'listo') and x.escalado_despacho_en is null and x.despachar_antes <= now()
           order by x.despachar_antes limit 100 loop
    begin
      update tumbo.envios set escalado_despacho_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('rol:ops', 'El pedido ' || e.pedido_id || ' (' || e.seller_id || ') pasó su plazo de despacho',
        'alarm', 'admin/pedido.html?id=' || e.pedido_id);
      perform tumbo_privado.notificar('seller:' || e.seller_id, 'El pedido ' || e.pedido_id || ' pasó su plazo de despacho: despáchalo cuanto antes',
        'alarm', 'seller/pedido.html?id=' || e.pedido_id, array['seller', 'operador']);
      n_esc_d := n_esc_d + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 4) cancelación de los que nadie aceptó a tiempo (con reembolso)
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'por_aceptar' and coalesce(x.conciliado_en, x.creado) + v_cancelar <= now()
           order by x.conciliado_en limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = e.pedido_id and estado = 'por_aceptar' for update skip locked;
      if found then
        perform tumbo_privado.cancelar_logistica(null, v, 'sistema', 'sin_aceptar',
          'Sin aceptar ' || tumbo_privado.logistica('cancelar_horas', 48) || ' h después de conciliar el pago');
        n_can := n_can + 1;
      end if;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 5) solicitudes de cancelación sin respuesta: se aprueban solas
  for s in select x.* from tumbo.solicitudes_cancelacion x where x.estado = 'pendiente' and x.vence <= now() order by x.vence limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = s.pedido_id for update skip locked;
      if found then
        if v.estado in ('preparando', 'listo') then
          update tumbo.solicitudes_cancelacion set estado = 'automatica', decidido_en = now(), decidido_por = 'Sistema',
            respuesta = 'Aprobada sola: el comercio no respondió a tiempo.' where id = s.id;
          perform tumbo_privado.cancelar_logistica(null, v, 'sistema', 'solicitud_comprador', coalesce(s.motivo, 'Solicitud sin respuesta del comercio'));
        else
          update tumbo.solicitudes_cancelacion set estado = 'cerrada', decidido_en = now(), decidido_por = 'Sistema' where id = s.id;
        end if;
        n_sol := n_sol + 1;
      end if;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 6) aviso previo a la autoconfirmación
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'despachado' and p.disputa_id is null and x.aviso_autoconfirmar_en is null
             and x.autoconfirmar_el - v_aviso <= now() and x.autoconfirmar_el > now()
           order by x.autoconfirmar_el limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = e.pedido_id;
      update tumbo.envios set aviso_autoconfirmar_en = now() where pedido_id = e.pedido_id;
      perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Si ya recibiste tu pedido ' || v.id || ', confírmalo; si hay un problema, ' ||
        'repórtalo antes del ' || tumbo_privado.fecha_hora_ve(e.autoconfirmar_el) || ': después se dará por recibido', 'schedule',
        'tienda/pedido.html?id=' || v.id);
      n_avi := n_avi + 1;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  -- 7) autoconfirmación (sin reclamo ni incidencias graves abiertas)
  for e in select x.* from tumbo.envios x join tumbo.pedidos p on p.id = x.pedido_id
           where p.estado = 'despachado' and p.disputa_id is null and x.autoconfirmar_el <= now()
             and not exists (select 1 from tumbo.incidencias i where i.pedido_id = x.pedido_id and i.estado = 'abierta'
                             and i.tipo in ('perdida', 'dano_courier', 'direccion_incorrecta', 'courier_no_retiro'))
           order by x.autoconfirmar_el limit 100 loop
    begin
      select * into v from tumbo.pedidos where id = e.pedido_id and estado = 'despachado' and disputa_id is null for update skip locked;
      if found then
        update tumbo.envios set entrega_por = 'Sistema (autoconfirmación)' where pedido_id = v.id;
        perform tumbo_privado.confirmar_entrega_interna(null, v, 'Sistema',
          'Entrega confirmada automáticamente: el comprador no la confirmó ni reportó un problema a tiempo');
        n_con := n_con + 1;
      end if;
    exception when others then n_err := n_err + 1;
    end;
  end loop;

  r := jsonb_build_object('recordatorios', n_rec, 'escalados_aceptar', n_esc, 'escalados_despacho', n_esc_d, 'cancelados', n_can,
                          'solicitudes', n_sol, 'avisos_autoconfirmacion', n_avi, 'autoconfirmados', n_con, 'errores', n_err);
  insert into tumbo.tareas_registro (tarea, ultima, resumen) values ('sla', now(), r)
  on conflict (tarea) do update set ultima = excluded.ultima, resumen = excluded.resumen;
  if n_can + n_sol + n_con > 0 then
    perform tumbo_privado.auditar(null, 'Revisión de SLA', r::text);
  end if;
  return r;
end $$;

-- La revisión de SLA a pedido (para un proyecto sin pg_cron o para no
-- esperar): como mucho una vez por minuto.
create or replace function public.tm_sla_revisar(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  t tumbo.tareas_registro;
  r jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('tumbo:tarea_sla', 0));
  select * into t from tumbo.tareas_registro where tarea = 'sla';
  if found and t.ultima > now() - interval '1 minute' then
    return t.resumen || jsonb_build_object('reciente', true, 'ultima', t.ultima);
  end if;
  r := tumbo_privado.tarea_sla();
  perform tumbo_privado.auditar(yo, 'Revisión de SLA ejecutada', r::text);
  return r || jsonb_build_object('reciente', false, 'ultima', now());
end $$;

-- Si el proyecto tiene pg_cron, la revisión corre cada 15 minutos.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $c$select cron.schedule('tumbo-sla', '*/15 * * * *', 'select tumbo_privado.tarea_sla()')$c$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Semilla de la demo (la llama el reinicio después de la semilla base)
-- ---------------------------------------------------------------------------
-- La configuración de envíos de los comercios sembrados (si no la tienen).
create function tumbo_privado.sembrar_config_envios() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into tumbo.envio_config (seller_id, origen_estado, origen_ciudad, couriers, delivery, gratis_desde_usd, dias_preparacion, cobro_destino, por)
  select x.seller_id, x.origen_estado, x.origen_ciudad, x.couriers, x.delivery::jsonb, x.gratis, x.prep, x.cobro, 'Semilla de la demo'
  from (values
    ('SEL-014', 'Distrito Capital', 'Caracas', array['mrw', 'zoom', 'tealca', 'liberty', 'domesa'],
     '[{"municipio": "Libertador", "estado": "Distrito Capital", "costo_usd": 3, "dias": 1},
       {"municipio": "Chacao", "estado": "Miranda", "costo_usd": 3, "dias": 1},
       {"municipio": "Baruta", "estado": "Miranda", "costo_usd": 3.5, "dias": 1},
       {"municipio": "Sucre", "estado": "Miranda", "costo_usd": 3.5, "dias": 1},
       {"municipio": "El Hatillo", "estado": "Miranda", "costo_usd": 4, "dias": 1}]', 200::numeric, 1, false),
    ('SEL-009', 'Carabobo', 'Valencia', array['mrw', 'zoom', 'domesa'],
     '[{"municipio": "Valencia", "estado": "Carabobo", "costo_usd": 3, "dias": 1},
       {"municipio": "Naguanagua", "estado": "Carabobo", "costo_usd": 3.5, "dias": 1},
       {"municipio": "San Diego", "estado": "Carabobo", "costo_usd": 3.5, "dias": 1}]', null, 2, false),
    ('SEL-021', 'Mérida', 'Mérida', array['mrw', 'zoom'], '[]', null, 2, false),
    ('SEL-017', 'Zulia', 'Maracaibo', array['mrw', 'tealca', 'liberty'],
     '[{"municipio": "Maracaibo", "estado": "Zulia", "costo_usd": 3, "dias": 1}]', null, 3, false)
  ) x (seller_id, origen_estado, origen_ciudad, couriers, delivery, gratis, prep, cobro)
  where exists (select 1 from tumbo.sellers s where s.id = x.seller_id)
  on conflict (seller_id) do nothing;
end $$;

-- Couriers, regiones, tarifas, oficinas y feriados son configuración de la
-- plataforma (como los ajustes): el reinicio no los toca. Se reinician la
-- configuración de envíos de los comercios y todo lo de los pedidos.
create function tumbo_privado.sembrar_ext_logistica(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hoy date := tumbo_privado.hoy();
begin
  delete from tumbo.envios where pedido_id is not null;
  delete from tumbo.incidencias where id is not null;
  delete from tumbo.cancelaciones where id is not null;
  delete from tumbo.solicitudes_cancelacion where id is not null;
  delete from tumbo.notas_pedido where id is not null;
  delete from tumbo.devoluciones where pedido_id is not null;
  delete from tumbo.envio_config where seller_id is not null;

  perform tumbo_privado.sembrar_config_envios();

  -- El envío de los pedidos sembrados; los activos, con sus relojes desde hoy.
  perform tumbo_privado.envio_asegurar(p.id) from tumbo.pedidos p;
  update tumbo.envios e
  set conciliado_en = now() - interval '2 days', aceptado_en = now() - interval '2 days',
      aceptar_antes = now() - interval '1 day', despachar_antes = tumbo_privado.fin_dia(tumbo_privado.sumar_habiles(v_hoy - 2, e.prepara_dias)),
      listo_en = now() - interval '1 day', despachado_en = now() - interval '1 day',
      fecha_minima = tumbo_privado.sumar_habiles(v_hoy - 2, e.dias_min),
      fecha_prometida = tumbo_privado.sumar_habiles(v_hoy - 2, e.dias_max),
      autoconfirmar_el = tumbo_privado.autoconfirmar_desde(now() - interval '1 day', tumbo_privado.sumar_habiles(v_hoy - 2, e.dias_max))
  from tumbo.pedidos p
  where p.id = e.pedido_id and p.estado = 'despachado';
end $$;

-- Los pedidos que ya existen (antes de esta ola) y la configuración de los
-- comercios sembrados.
do $$
begin
  perform tumbo_privado.sembrar_config_envios();
  perform tumbo_privado.envio_asegurar(p.id) from tumbo.pedidos p;
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
    'public.tm_envio_referencias()', 'public.tm_logistica_admin(text)', 'public.tm_envio_config(text)',
    'public.tm_envio_promesa(text,text,text)', 'public.tm_envios_cola(text)', 'public.tm_pedido_envio(text,text)',
    'public.tm_envio_etiquetas(text,text[])', 'public.tm_envio_metricas(text,text)',
    'public.tm_envio_config_guardar(text,jsonb)', 'public.tm_despachar_guia(text,text,jsonb)',
    'public.tm_despachar_lote(text,jsonb,uuid)', 'public.tm_envio_en_agencia(text,text,bigint)',
    'public.tm_incidencia_reportar(text,text,text,text)', 'public.tm_cancelar_seller(text,text,text,text)',
    'public.tm_cancelacion_responder(text,text,boolean,text)', 'public.tm_cancelar_ops(text,text,text,text)',
    'public.tm_incidencia_registrar(text,text,text,text,jsonb)', 'public.tm_incidencia_resolver(text,bigint,text)',
    'public.tm_entrega_confirmar(text,text,uuid,text)', 'public.tm_devolucion_instrucciones(text,text,jsonb)',
    'public.tm_devolucion_guia(text,text,text,text)', 'public.tm_devolucion_inspeccionar(text,text,text,text,uuid)',
    'public.tm_operaciones_asignar(text,text,uuid)', 'public.tm_nota_interna(text,text,text)',
    'public.tm_pedido_360(text,text)', 'public.tm_operaciones_panel(text,jsonb)',
    'public.tm_courier_guardar(text,jsonb)', 'public.tm_tarifa_guardar(text,jsonb)', 'public.tm_oficina_guardar(text,jsonb)',
    'public.tm_zona_estado(text,text,text)', 'public.tm_feriado_guardar(text,date,text,boolean)',
    'public.tm_logistica_plazos_guardar(text,jsonb)', 'public.tm_sla_revisar(text)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
