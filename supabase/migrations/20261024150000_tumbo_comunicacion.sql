-- =========================================================================
-- Tumbo Market — Ola 2: Comunicación y confianza
-- -------------------------------------------------------------------------
-- Solo agrega (create table, alter table … add column, create index,
-- create or replace function, insert … on conflict do nothing):
--   · envío real de la bandeja de salida: la función tumbo-envios toma los
--     mensajes pendientes (tm_envios_tomar), los manda por correo (Resend) y
--     por WhatsApp Cloud API (plantillas aprobadas) si tiene sus secretos,
--     y anota el resultado (tm_envios_resultado) con reintentos e
--     idempotencia; sin secretos no envía y lo dice. Bandeja manual
--     (admin/mensajes) con filtros, wa.me y mailto;
--   · preferencias de aviso por tipo y canal, con consentimiento (opt-in)
--     para WhatsApp: encolar (contrato de la ola 0) las respeta;
--   · chat por pedido (comprador ↔ comercio, y Operaciones con un reclamo),
--     con adjuntos y los datos de contacto ocultos (aviso antiestafa);
--   · preguntas y respuestas públicas en la ficha, con moderación;
--   · reseñas verificadas (producto y comercio) al cerrarse la ventana de
--     reclamo, con fotos, respuesta pública y moderación; los contratos
--     reputacion_productos / reputacion_sellers de Catálogo pasan a
--     calcularse SOLO de reseñas reales; reputación calculada del comercio;
--   · documentos legales versionados y su aceptación;
--   · disputas v2: mensajes de las tres partes, solicitud de evidencia con
--     plazo, fallo automático a las 72 h sin respuesta del comercio,
--     reembolso parcial (con el tope de lo pagado), quién paga la logística
--     inversa y el reintegro del envío de vuelta, apelación (una por parte,
--     con evidencia nueva, la revisa otra persona; los fondos se retienen
--     mientras el comprador puede apelar) y plantillas;
--   · denuncias (publicación, comercio, pregunta o reseña) con su cola;
--   · soporte: tickets con conversación, adjuntos, macros y SLA.
-- Funciones redefinidas desde su última definición: tumbo_privado.encolar
-- (fundaciones), tm_abrir_disputa (logística), tm_responder_disputa
-- (funciones), tumbo_privado.reputacion_productos / reputacion_sellers
-- (contrato de Catálogo para la ola 2) y, con una sola línea distinta,
-- tm_archivo_preparar / tm_archivo_acceso (fundaciones: consultan además
-- los permisos de los archivos de este dominio). tm_resolver_disputa y
-- tumbo_privado.archivo_permitido no se redefinen aquí: son de la
-- integración de la ola 1 (20261023190000, que se aplica antes; esta
-- migración se escribió sobre ella y nació como 20261023150000); lo que la
-- ola 2 suma a la resolución de siempre lo pone un disparador.
-- Las tablas nuevas no tienen FK a pedidos ni a disputas: el reinicio de la
-- demo las vacía con truncate.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Bandeja de salida: lo que necesita el envío real
-- ---------------------------------------------------------------------------
-- datos: las variables de la plantilla que pide la plantilla aprobada de
--   WhatsApp (se borran al cerrar un mensaje de seguridad);
-- proximo_intento: no se vuelve a tomar antes (reintentos con espera);
-- enviando_desde: la función lo tomó (candado; si no anota el resultado en
--   10 minutos, el correo se reintenta con la misma clave de idempotencia y
--   el WhatsApp queda fallido para revisarlo: no se manda dos veces).
alter table tumbo.salida
  add column datos           jsonb,
  add column proximo_intento timestamptz not null default now(),
  add column enviando_desde  timestamptz,
  add column ultimo_intento  timestamptz,
  add column proveedor       text check (char_length(proveedor) <= 40),
  add column proveedor_id    text check (char_length(proveedor_id) <= 200);
create index salida_envio_idx on tumbo.salida (canal, proximo_intento) where estado = 'pendiente';

-- Catálogo de avisos (para las preferencias): qué plantilla es de qué
-- grupo, a qué roles llega y si es obligatoria (seguridad de la cuenta).
create table tumbo.avisos_tipos (
  plantilla   text primary key,
  grupo       text not null check (grupo in ('pedidos', 'reclamos', 'dinero', 'mensajes', 'preguntas', 'resenas',
                                             'soporte', 'alertas', 'cuenta', 'comercio', 'legal')),
  nombre      text not null,
  descripcion text not null,
  roles       text[] not null,
  obligatorio boolean not null default false,
  orden       integer not null default 100
);
alter table tumbo.avisos_tipos enable row level security;
revoke all on tumbo.avisos_tipos from public, anon, authenticated;

-- Consentimiento para recibir avisos por WhatsApp (opt-in): un registro por
-- cada vez que se da o se retira, con el número, la versión del texto y la
-- red. Vale el último y solo para ese número (si cambia el teléfono, hay
-- que volver a darlo).
create table tumbo.consentimientos_whatsapp (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  accion     text not null check (accion in ('otorgar', 'retirar')),
  telefono   text check (char_length(telefono) <= 20),
  version    text not null check (char_length(version) <= 40),
  red        text not null default 'desconocida',
  creado     timestamptz not null default now()
);
create index consentimientos_whatsapp_idx on tumbo.consentimientos_whatsapp (usuario_id, id desc);
alter table tumbo.consentimientos_whatsapp enable row level security;
revoke all on tumbo.consentimientos_whatsapp from public, anon, authenticated;

-- Plantillas aprobadas por Meta (WhatsApp Business): un mensaje que inicia
-- la empresa solo sale con una plantilla aprobada. parametros: las
-- variables de Tumbo en el orden {{1}}, {{2}}… del texto aprobado. Hasta
-- que el superadministrador la marque aprobada, el WhatsApp de esa
-- plantilla queda para enviarlo a mano.
create table tumbo.plantillas_whatsapp (
  clave       text primary key,
  nombre_meta text not null check (nombre_meta ~ '^[a-z0-9_]+$' and char_length(nombre_meta) <= 512),
  idioma      text not null default 'es' check (idioma ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  parametros  text[] not null default '{}',
  categoria   text not null default 'utility' check (categoria in ('utility', 'authentication', 'marketing')),
  aprobada    boolean not null default false,
  actualizado timestamptz not null default now(),
  por         text
);
alter table tumbo.plantillas_whatsapp enable row level security;
revoke all on tumbo.plantillas_whatsapp from public, anon, authenticated;

-- Estado de los proveedores que informa la función tumbo-envios en cada
-- corrida (la base no ve sus secretos; solo si están).
create table tumbo.envios_estado (
  id          integer primary key default 1 check (id = 1),
  correo      boolean not null default false,
  whatsapp    boolean not null default false,
  ultima      timestamptz,
  resumen     jsonb not null default '{}'::jsonb,
  por         text
);
alter table tumbo.envios_estado enable row level security;
revoke all on tumbo.envios_estado from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Chat por pedido
-- ---------------------------------------------------------------------------
create table tumbo.chat_mensajes (
  id        bigint generated always as identity primary key,
  pedido_id text not null,
  autor_id  uuid references tumbo.usuarios (id) on delete set null,
  lado      text not null check (lado in ('comprador', 'comercio', 'tumbo')),
  autor     text not null check (char_length(autor) <= 120),
  texto     text not null check (char_length(texto) between 1 and 1000),
  adjuntos  uuid[] not null default '{}' check (cardinality(adjuntos) <= 4),
  ocultos   text[] not null default '{}',
  creado    timestamptz not null default now()
);
create index chat_mensajes_pedido_idx on tumbo.chat_mensajes (pedido_id, id);
create index chat_mensajes_autor_idx on tumbo.chat_mensajes (autor_id, creado);
alter table tumbo.chat_mensajes enable row level security;
revoke all on tumbo.chat_mensajes from public, anon, authenticated;

-- Hasta dónde leyó cada persona, y el último aviso por la bandeja a cada
-- lado del pedido (uno cada 30 minutos como mucho).
create table tumbo.chat_lecturas (
  pedido_id  text not null,
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  ultimo     bigint not null default 0,
  primary key (pedido_id, usuario_id)
);
alter table tumbo.chat_lecturas enable row level security;
revoke all on tumbo.chat_lecturas from public, anon, authenticated;

create table tumbo.chat_avisos (
  pedido_id text not null,
  lado      text not null,
  avisado   timestamptz not null,
  primary key (pedido_id, lado)
);
alter table tumbo.chat_avisos enable row level security;
revoke all on tumbo.chat_avisos from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Preguntas y respuestas públicas
-- ---------------------------------------------------------------------------
-- estado (de la pregunta) y respuesta_estado: publicada, revision (la
-- moderación automática la apartó: no se ve hasta que la apruebe una
-- persona) u oculta (moderación manual).
create table tumbo.preguntas (
  id                bigint generated always as identity primary key,
  sku               text not null,
  seller_id         text not null,
  autor_id          uuid references tumbo.usuarios (id) on delete set null,
  texto             text not null check (char_length(texto) between 5 and 500),
  estado            text not null default 'publicada' check (estado in ('publicada', 'revision', 'oculta')),
  respuesta         text check (char_length(respuesta) <= 1000),
  respuesta_estado  text check (respuesta_estado in ('publicada', 'revision', 'oculta')),
  respondida_por    uuid,
  respondida_en     timestamptz,
  moderada_por      text,
  moderacion_motivo text check (char_length(moderacion_motivo) <= 300),
  moderada_en       timestamptz,
  creado            timestamptz not null default now()
);
create index preguntas_sku_idx on tumbo.preguntas (sku, creado desc);
create index preguntas_seller_idx on tumbo.preguntas (seller_id, creado desc);
create index preguntas_autor_idx on tumbo.preguntas (autor_id, creado);
create index preguntas_revision_idx on tumbo.preguntas (creado) where estado = 'revision' or respuesta_estado = 'revision';
alter table tumbo.preguntas enable row level security;
revoke all on tumbo.preguntas from public, anon, authenticated;

-- Respuestas guardadas del comercio (para preguntas y chat).
create table tumbo.respuestas_rapidas (
  id        bigint generated always as identity primary key,
  seller_id text not null,
  titulo    text not null check (char_length(titulo) between 2 and 60),
  texto     text not null check (char_length(texto) between 5 and 1000),
  creado    timestamptz not null default now(),
  unique (seller_id, titulo)
);
alter table tumbo.respuestas_rapidas enable row level security;
revoke all on tumbo.respuestas_rapidas from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reseñas verificadas
-- ---------------------------------------------------------------------------
-- Una por pedido y producto (sku) y una del comercio por pedido (sku nulo).
-- calidad: del producto; empaque y entrega (tiempo de entrega): del comercio.
create table tumbo.resenas (
  id                bigint generated always as identity primary key,
  pedido_id         text not null,
  sku               text,
  seller_id         text not null,
  comprador_id      uuid references tumbo.usuarios (id) on delete set null,
  estrellas         smallint not null check (estrellas between 1 and 5),
  calidad           smallint check (calidad between 1 and 5),
  empaque           smallint check (empaque between 1 and 5),
  entrega           smallint check (entrega between 1 and 5),
  texto             text check (char_length(texto) <= 1500),
  fotos             uuid[] not null default '{}' check (cardinality(fotos) <= 4),
  estado            text not null default 'publicada' check (estado in ('publicada', 'revision', 'oculta')),
  moderada_por      text,
  moderacion_motivo text check (char_length(moderacion_motivo) <= 300),
  moderada_en       timestamptz,
  respuesta         text check (char_length(respuesta) <= 1000),
  respuesta_estado  text check (respuesta_estado in ('publicada', 'revision', 'oculta')),
  respondida_por    uuid,
  respondida_en     timestamptz,
  creado            timestamptz not null default now()
);
create unique index resenas_pedido_sku_idx on tumbo.resenas (pedido_id, coalesce(sku, ''));
create index resenas_sku_idx on tumbo.resenas (sku, creado desc) where sku is not null;
create index resenas_seller_idx on tumbo.resenas (seller_id, creado desc);
create index resenas_comprador_idx on tumbo.resenas (comprador_id);
create index resenas_revision_idx on tumbo.resenas (creado) where estado = 'revision' or respuesta_estado = 'revision';
alter table tumbo.resenas enable row level security;
revoke all on tumbo.resenas from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Documentos legales versionados y su aceptación
-- ---------------------------------------------------------------------------
-- El texto de cada versión vive en el centro de ayuda (BORRADOR pendiente de
-- revisión legal); aquí, qué versión rige desde cuándo, quién debe aceptarla
-- y qué cambió. Una versión nueva vigente se vuelve a pedir.
create table tumbo.documentos_legales (
  clave         text not null check (clave in ('terminos', 'privacidad', 'contrato_seller', 'devoluciones', 'compra_protegida')),
  version       text not null check (version ~ '^[A-Za-z0-9._-]{3,40}$'),
  titulo        text not null check (char_length(titulo) <= 120),
  vigente_desde timestamptz not null,
  resumen       text check (char_length(resumen) <= 600),
  roles         text[] not null default '{}',      -- quién debe aceptarla (vacío: no se acepta, solo se publica)
  borrador      boolean not null default true,     -- pendiente de revisión legal
  -- su texto ya está en el centro de ayuda (lo marca el superadministrador
  -- al desplegarlo): hasta entonces la versión no rige ni se acepta
  texto_publicado boolean not null default false,
  publicado_por text,
  creado        timestamptz not null default now(),
  primary key (clave, version)
);
alter table tumbo.documentos_legales enable row level security;
revoke all on tumbo.documentos_legales from public, anon, authenticated;

create table tumbo.aceptaciones_legales (
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  clave      text not null,
  version    text not null,
  aceptado   timestamptz not null default now(),
  red        text not null default 'desconocida',
  primary key (usuario_id, clave, version)
);
alter table tumbo.aceptaciones_legales enable row level security;
revoke all on tumbo.aceptaciones_legales from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Disputas v2 (sin tocar tumbo.disputas, que tm_cargar entrega entera)
-- ---------------------------------------------------------------------------
-- El caso: plazo del comercio (72 h), cómo y quién lo resolvió (reembolso
-- parcial, quién paga el envío de vuelta, plantilla), la revisión de las
-- apelaciones (una ronda: cada parte apela una vez y una sola revisión las
-- decide; las apelaciones van en disputa_apelaciones) y el reintegro del
-- envío de vuelta de una devolución que paga el comercio o Tumbo.
create table tumbo.disputa_casos (
  disputa_id               text primary key,
  plazo_seller             timestamptz not null,
  respondida_en            timestamptz,
  fallo_automatico         boolean not null default false,
  decision                 text check (decision in ('reembolso', 'reembolso_parcial', 'devolucion', 'liberar')),
  reembolso_usd            numeric(12,2),          -- lo que devolvió Pagos (no lo que se pidió)
  paga_logistica           text check (paga_logistica in ('comprador', 'seller', 'tumbo')),
  plantilla                text,
  resuelta_por             uuid,
  resuelta_por_nombre      text,
  resuelta_en              timestamptz,
  ajuste_id                bigint,                 -- el descuento al comercio por un reembolso parcial
  apelacion_estado         text check (apelacion_estado in ('pedida', 'confirmada', 'modificada')),
  apelacion_a_favor        text check (apelacion_a_favor in ('comprador', 'comercio')),
  apelacion_por            uuid,
  apelacion_por_nombre     text,
  apelacion_nota           text check (char_length(apelacion_nota) <= 1000),
  apelacion_resultado      text,
  apelacion_resuelta_en    timestamptz,
  aviso_plazo              timestamptz,            -- recordatorio al comercio antes del fallo automático
  vuelta_estado            text check (vuelta_estado in ('reportado', 'reintegrado', 'rechazado')),
  vuelta_bs                numeric(14,2),          -- lo que el comprador dice que pagó por el envío de vuelta
  vuelta_usd               numeric(12,2),          -- a la tasa del día del reporte
  vuelta_recibo            text[] not null default '{}',
  vuelta_reportado         timestamptz,
  vuelta_reintegro_usd     numeric(12,2),
  vuelta_reembolso_id      bigint,
  vuelta_nota              text check (char_length(vuelta_nota) <= 500),
  vuelta_por               text,
  creado                   timestamptz not null default now()
);
create index disputa_casos_plazo_idx on tumbo.disputa_casos (plazo_seller) where respondida_en is null and decision is null;
alter table tumbo.disputa_casos enable row level security;
revoke all on tumbo.disputa_casos from public, anon, authenticated;

-- Las apelaciones: una por parte y reclamo (en un reembolso parcial apelan
-- las dos; la que apela primero no le quita la suya a la otra).
create table tumbo.disputa_apelaciones (
  disputa_id text not null,
  lado       text not null check (lado in ('comprador', 'comercio')),
  autor_id   uuid,
  motivo     text not null check (char_length(motivo) between 1 and 2000),
  evidencia  text[] not null default '{}',
  decision   text not null,                        -- la decisión que se apeló
  congelo    boolean not null default false,       -- volvió a congelar los fondos (comprador)
  creado     timestamptz not null default now(),
  primary key (disputa_id, lado)
);
alter table tumbo.disputa_apelaciones enable row level security;
revoke all on tumbo.disputa_apelaciones from public, anon, authenticated;

-- Mensajes del expediente entre las tres partes (todos los ven).
create table tumbo.disputa_mensajes (
  id           bigint generated always as identity primary key,
  disputa_id   text not null,
  autor_id     uuid,
  lado         text not null check (lado in ('comprador', 'comercio', 'tumbo', 'sistema')),
  autor        text not null check (char_length(autor) <= 120),
  texto        text not null check (char_length(texto) between 1 and 2000),
  adjuntos     text[] not null default '{}' check (cardinality(adjuntos) <= 10),
  solicitud_id bigint,
  creado       timestamptz not null default now()
);
create index disputa_mensajes_idx on tumbo.disputa_mensajes (disputa_id, id);
alter table tumbo.disputa_mensajes enable row level security;
revoke all on tumbo.disputa_mensajes from public, anon, authenticated;

-- Solicitudes de evidencia con plazo.
create table tumbo.disputa_solicitudes (
  id            bigint generated always as identity primary key,
  disputa_id    text not null,
  para          text not null check (para in ('comprador', 'comercio')),
  texto         text not null check (char_length(texto) between 10 and 600),
  vence         timestamptz not null,
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'respondida', 'vencida', 'cancelada')),
  pedida_por    text not null,
  respondida_en timestamptz,
  creado        timestamptz not null default now()
);
create index disputa_solicitudes_idx on tumbo.disputa_solicitudes (disputa_id, id);
create index disputa_solicitudes_vence_idx on tumbo.disputa_solicitudes (vence) where estado = 'pendiente';
alter table tumbo.disputa_solicitudes enable row level security;
revoke all on tumbo.disputa_solicitudes from public, anon, authenticated;

-- Plantillas de decisión (texto para el comprador y el comercio).
create table tumbo.disputa_plantillas (
  clave    text primary key check (clave ~ '^[a-z0-9_]{2,40}$'),
  titulo   text not null,
  decision text not null check (decision in ('reembolso', 'reembolso_parcial', 'devolucion', 'liberar')),
  paga     text check (paga in ('comprador', 'seller', 'tumbo')),
  texto    text not null check (char_length(texto) between 10 and 500),
  orden    integer not null default 100
);
alter table tumbo.disputa_plantillas enable row level security;
revoke all on tumbo.disputa_plantillas from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Denuncias
-- ---------------------------------------------------------------------------
create table tumbo.denuncias (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('producto', 'seller', 'pregunta', 'resena')),
  objeto     text not null check (char_length(objeto) <= 60),
  seller_id  text,
  motivo     text not null check (motivo in ('falsificacion', 'prohibido', 'engano', 'precio', 'contacto', 'ofensivo', 'fraude', 'otro')),
  detalle    text check (char_length(detalle) <= 1000),
  autor_id   uuid references tumbo.usuarios (id) on delete set null,
  estado     text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  resolucion text check (resolucion in ('procede', 'no_procede', 'duplicada')),
  nota       text check (char_length(nota) <= 600),
  cerrada_por text,
  cerrada_en timestamptz,
  creado     timestamptz not null default now()
);
create unique index denuncias_abierta_idx on tumbo.denuncias (autor_id, tipo, objeto) where estado = 'abierta';
create index denuncias_estado_idx on tumbo.denuncias (estado, creado);
create index denuncias_autor_idx on tumbo.denuncias (autor_id, creado);
alter table tumbo.denuncias enable row level security;
revoke all on tumbo.denuncias from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Soporte
-- ---------------------------------------------------------------------------
create sequence tumbo_privado.seq_ticket start 1001;

create table tumbo.tickets (
  id                text primary key,
  usuario_id        uuid references tumbo.usuarios (id) on delete set null,
  rol               text not null,
  seller_id         text,
  categoria         text not null check (categoria in ('pedido', 'pago', 'envio', 'devolucion', 'cuenta', 'vender', 'otro')),
  asunto            text not null check (char_length(asunto) between 5 and 120),
  pedido_id         text,
  estado            text not null default 'abierto' check (estado in ('abierto', 'en_proceso', 'esperando', 'cerrado')),
  prioridad         text not null default 'normal' check (prioridad in ('alta', 'normal', 'baja')),
  asignado_a        uuid references tumbo.usuarios (id) on delete set null,
  sla_vence         timestamptz not null,
  sla_avisado       timestamptz,
  primera_respuesta timestamptz,
  cerrado           timestamptz,
  actualizado       timestamptz not null default now(),
  creado            timestamptz not null default now()
);
create index tickets_usuario_idx on tumbo.tickets (usuario_id, creado desc);
create index tickets_estado_idx on tumbo.tickets (estado, sla_vence);
alter table tumbo.tickets enable row level security;
revoke all on tumbo.tickets from public, anon, authenticated;

-- interno: nota del equipo que no ve quien abrió el caso.
create table tumbo.ticket_mensajes (
  id        bigint generated always as identity primary key,
  ticket_id text not null references tumbo.tickets (id) on delete cascade,
  autor_id  uuid,
  lado      text not null check (lado in ('cliente', 'soporte', 'sistema')),
  autor     text not null check (char_length(autor) <= 120),
  texto     text not null check (char_length(texto) between 1 and 3000),
  adjuntos  uuid[] not null default '{}' check (cardinality(adjuntos) <= 5),
  interno   boolean not null default false,
  creado    timestamptz not null default now()
);
create index ticket_mensajes_idx on tumbo.ticket_mensajes (ticket_id, id);
alter table tumbo.ticket_mensajes enable row level security;
revoke all on tumbo.ticket_mensajes from public, anon, authenticated;

create table tumbo.soporte_macros (
  id        bigint generated always as identity primary key,
  titulo    text not null unique check (char_length(titulo) between 3 and 80),
  texto     text not null check (char_length(texto) between 10 and 2000),
  categoria text,
  activa    boolean not null default true,
  por       text,
  creado    timestamptz not null default now()
);
alter table tumbo.soporte_macros enable row level security;
revoke all on tumbo.soporte_macros from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Datos de configuración (no son datos de demostración)
-- ---------------------------------------------------------------------------
insert into tumbo.archivo_propositos (proposito, bucket, max_bytes, tipos, publico) values
  ('resena',  'tumbo-publico', 5242880, array['image/jpeg', 'image/png', 'image/webp'], true),
  ('soporte', 'tumbo-privado', 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], false)
on conflict (proposito) do nothing;

insert into tumbo.permisos (permiso, descripcion, ambito, implicito_en, asignable_a) values
  ('soporte', 'Atender la bandeja de soporte (casos, respuestas y macros)', 'interno', '{ops}', '{finanzas}'),
  ('contenido', 'Moderar preguntas y reseñas y cerrar denuncias', 'interno', '{ops}', '{finanzas}')
on conflict (permiso) do nothing;

insert into tumbo.ajustes (clave, valor, tipo, vaciable, publico, descripcion) values
  ('comunicacion', '{"horas_respuesta_reclamo": 72, "horas_evidencia": 48, "dias_apelacion": 5, "dias_resena": 90,
                     "sla_soporte_horas": {"alta": 4, "normal": 24, "baja": 48}}', 'object', false, false,
   'Plazos de comunicación y confianza: respuesta del comercio a un reclamo (fallo automático a favor del comprador), evidencia pedida, apelación, reseñas y primera respuesta de soporte.'),
  ('envios', '{"funcion_url": null, "lote": 50, "max_intentos": 5}', 'object', false, false,
   'Envío real de la bandeja: la URL de la función tumbo-envios para la tarea programada (pg_cron + pg_net), el tamaño del lote y los intentos.')
on conflict (clave) do nothing;

-- Secreto propio de la tarea programada de envíos (la función lo comprueba
-- con tm_envios_autorizar; nunca sale de la base salvo en la llamada de pg_net).
insert into tumbo_privado.secretos (nombre, valor)
values ('envios', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (nombre) do nothing;

insert into tumbo.envios_estado (id) values (1) on conflict (id) do nothing;

-- Plantillas nuevas de la bandeja.
insert into tumbo.plantillas (clave, canal, asunto, cuerpo) values
  ('chat_mensaje', 'correo', 'Mensaje nuevo sobre tu pedido {{pedido}}',
   E'Hola, {{nombre}}:\n\n{{de}} te escribió sobre el pedido {{pedido}}. Responde desde Tumbo: por tu seguridad, nunca pagues ni compartas datos por fuera de la plataforma.\n\n{{enlace}}'),
  ('chat_mensaje', 'whatsapp', '',
   'Tumbo Market: {{de}} te escribió sobre el pedido {{pedido}}. Respóndele desde Tumbo: {{enlace}}'),
  ('pregunta_nueva', 'correo', 'Te preguntaron sobre {{producto}}',
   E'Hola, {{nombre}}:\n\nUn comprador preguntó sobre «{{producto}}». Responder rápido mejora tu reputación en Tumbo.\n\n{{enlace}}'),
  ('pregunta_nueva', 'whatsapp', '',
   'Tumbo Seller Center: te preguntaron sobre «{{producto}}». Responde en {{enlace}}'),
  ('pregunta_respondida', 'correo', 'Respondieron tu pregunta sobre {{producto}}',
   E'Hola, {{nombre}}:\n\nEl comercio respondió tu pregunta sobre «{{producto}}».\n\n{{enlace}}'),
  ('pregunta_respondida', 'whatsapp', '',
   'Tumbo Market: respondieron tu pregunta sobre «{{producto}}». Míralo en {{enlace}}'),
  ('resena_pendiente', 'correo', '¿Cómo te fue con tu pedido {{pedido}}?',
   E'Hola, {{nombre}}:\n\nTu pedido {{pedido}} de {{comercio}} ya cerró su ventana de reclamo. Cuéntale a otros compradores cómo te fue: tu reseña es verificada.\n\n{{enlace}}'),
  ('resena_pendiente', 'whatsapp', '',
   'Tumbo Market: ¿cómo te fue con tu pedido {{pedido}}? Califícalo en {{enlace}}'),
  ('resena_nueva', 'correo', 'Recibiste una reseña de {{estrellas}} estrellas',
   E'Hola, {{nombre}}:\n\nUn comprador calificó su pedido {{pedido}} con {{estrellas}} estrellas. Puedes responderle en público desde Seller Center.\n\n{{enlace}}'),
  ('resena_respondida', 'correo', '{{comercio}} respondió tu reseña',
   E'Hola, {{nombre}}:\n\n{{comercio}} respondió en público la reseña de tu pedido {{pedido}}.\n\n{{enlace}}'),
  ('reclamo_comercio', 'correo', 'Reclamo {{reclamo}} sobre el pedido {{pedido}}',
   E'Hola, {{nombre}}:\n\nEl reclamo {{reclamo}} sobre el pedido {{pedido}}: {{estado}}.\n\n{{enlace}}'),
  ('reclamo_comercio', 'whatsapp', '',
   'Tumbo Seller Center: el reclamo {{reclamo}} sobre el pedido {{pedido}}: {{estado}}. {{enlace}}'),
  ('reclamo_evidencia', 'correo', 'Operaciones te pide evidencia del reclamo {{reclamo}}',
   E'Hola, {{nombre}}:\n\nPara decidir el reclamo {{reclamo}} necesitamos: {{texto}}\n\nEnvíala antes del {{vence}} desde el expediente:\n{{enlace}}'),
  ('reclamo_evidencia', 'whatsapp', '',
   'Tumbo Market: para decidir el reclamo {{reclamo}} necesitamos tu evidencia antes del {{vence}}. Envíala en {{enlace}}'),
  ('ticket_creado', 'correo', 'Recibimos tu caso {{ticket}}',
   E'Hola, {{nombre}}:\n\nRecibimos tu caso {{ticket}} («{{asunto}}»). Te responderemos antes del {{vence}}.\n\n{{enlace}}'),
  ('ticket_actualizado', 'correo', 'Respondimos tu caso {{ticket}}',
   E'Hola, {{nombre}}:\n\nHay una respuesta de soporte en tu caso {{ticket}} («{{asunto}}»).\n\n{{enlace}}'),
  ('ticket_actualizado', 'whatsapp', '',
   'Tumbo Market: soporte respondió tu caso {{ticket}}. Míralo en {{enlace}}'),
  ('legal_actualizado', 'correo', 'Actualizamos {{documento}}',
   E'Hola, {{nombre}}:\n\nPublicamos la versión {{version}} de {{documento}}, vigente desde el {{desde}}. {{resumen}}\n\nLa próxima vez que entres a Tumbo te pediremos aceptarla:\n{{enlace}}'),
  ('segundo_factor_quitado', 'correo', 'Quitamos la verificación en dos pasos de tu cuenta',
   E'Hola, {{nombre}}:\n\nEl equipo de Tumbo quitó la verificación en dos pasos de tu cuenta el {{fecha}}, a tu pedido. Vuelve a activarla en Mi cuenta → Seguridad.\n\nSi no lo pediste, escríbenos a soporte de inmediato.\n\n{{enlace}}'),
  ('cuenta_desbloqueada', 'correo', 'Tu cuenta de Tumbo Market está activa de nuevo',
   E'Hola, {{nombre}}:\n\nDesbloqueamos tu cuenta el {{fecha}}. Ya puedes entrar con tu correo y tu contraseña.\n\n{{enlace}}')
on conflict (clave, canal) do nothing;

-- Catálogo de avisos para las preferencias (roles: a quién le llegan).
insert into tumbo.avisos_tipos (plantilla, grupo, nombre, descripcion, roles, obligatorio, orden) values
  ('pago_confirmado', 'pedidos', 'Pago confirmado', 'Cuando Finanzas verifica el pago de tu pedido.', '{comprador}', false, 10),
  ('pago_por_vencer', 'pedidos', 'Pago por vencer', 'Doce horas antes de que venza un pago sin verificar.', '{comprador}', false, 11),
  ('pedido_despachado', 'pedidos', 'Pedido en camino', 'Cuando el comercio despacha, con la guía.', '{comprador}', false, 12),
  ('pedido_listo_retiro', 'pedidos', 'Listo para retirar', 'Cuando tu pedido llega a la agencia o a la tienda.', '{comprador}', false, 13),
  ('pedido_por_aceptar', 'comercio', 'Pedido por aceptar', 'Un pedido pagado espera tu aceptación.', '{seller,operador}', false, 20),
  ('reclamo_actualizado', 'reclamos', 'Novedades de tus reclamos', 'Cada cambio de un reclamo que abriste.', '{comprador}', false, 30),
  ('reclamo_comercio', 'reclamos', 'Reclamos sobre tus pedidos', 'Reclamos abiertos y resueltos sobre las ventas de tu comercio.', '{seller}', false, 31),
  ('reclamo_evidencia', 'reclamos', 'Evidencia pedida', 'Cuando Operaciones te pide evidencia con plazo.', '{comprador,seller}', false, 32),
  ('reembolso_enviado', 'dinero', 'Reembolso enviado', 'Cuando Finanzas envía un reembolso.', '{comprador}', false, 40),
  ('liquidacion_pagada', 'dinero', 'Liquidación pagada', 'Cuando Tumbo paga una liquidación a tu comercio.', '{seller}', false, 41),
  ('cuenta_liquidacion', 'dinero', 'Cambios en la cuenta de cobro', 'Cada cambio en la cuenta donde cobra tu comercio (seguridad).', '{seller}', true, 42),
  ('chat_mensaje', 'mensajes', 'Mensajes del chat del pedido', 'Cuando el comercio, el comprador u Operaciones te escriben.', '{comprador,seller,operador}', false, 50),
  ('pregunta_nueva', 'preguntas', 'Preguntas nuevas', 'Cuando un comprador pregunta sobre un producto tuyo.', '{seller,operador}', false, 60),
  ('pregunta_respondida', 'preguntas', 'Respuestas a tus preguntas', 'Cuando el comercio responde lo que preguntaste.', '{comprador}', false, 61),
  ('resena_pendiente', 'resenas', 'Califica tu compra', 'Cuando un pedido cierra su ventana de reclamo y puedes reseñarlo.', '{comprador}', false, 70),
  ('resena_nueva', 'resenas', 'Reseñas nuevas', 'Cuando un comprador califica un pedido de tu comercio.', '{seller}', false, 71),
  ('resena_respondida', 'resenas', 'Respuestas a tus reseñas', 'Cuando el comercio responde tu reseña.', '{comprador}', false, 72),
  ('ticket_creado', 'soporte', 'Caso de soporte recibido', 'La confirmación de cada caso que abres.', '{comprador,seller,precios,operador}', false, 80),
  ('ticket_actualizado', 'soporte', 'Respuestas de soporte', 'Cuando soporte responde tu caso.', '{comprador,seller,precios,operador}', false, 81),
  ('alerta_stock', 'alertas', 'Volvió a estar disponible', 'Tus avisos de «avísame cuando vuelva».', '{comprador}', false, 90),
  ('alerta_precio', 'alertas', 'Bajó de precio', 'Tus avisos de «avísame si baja de precio».', '{comprador}', false, 91),
  ('legal_actualizado', 'legal', 'Cambios en los términos', 'Cuando cambia un documento legal que aceptaste.', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 95),
  ('acceso_nuevo', 'cuenta', 'Inicio de sesión nuevo', 'Un acceso desde un dispositivo o una red nueva (seguridad).', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 100),
  ('clave_cambiada', 'cuenta', 'Contraseña cambiada', 'Cuando cambia la contraseña de tu cuenta (seguridad).', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 101),
  ('segundo_factor_quitado', 'cuenta', 'Verificación en dos pasos quitada', 'Cuando el equipo quita tu verificación en dos pasos (seguridad).', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 102),
  ('cuenta_desbloqueada', 'cuenta', 'Cuenta desbloqueada', 'Cuando el equipo desbloquea tu cuenta.', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 103),
  ('verificar_correo', 'cuenta', 'Código para verificar el correo', 'Solo cuando lo pides (seguridad).', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 104),
  ('verificar_telefono', 'cuenta', 'Código para verificar el teléfono', 'Solo cuando lo pides (seguridad).', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 105),
  ('recuperar_clave', 'cuenta', 'Recuperar la contraseña', 'Solo cuando lo pides (seguridad).', '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, 106)
on conflict (plantilla) do nothing;

-- Plantillas de WhatsApp para Meta (pendientes de aprobación): el texto que
-- se somete es el cuerpo de tumbo.plantillas con {{1}}, {{2}}… en el orden
-- de parametros.
insert into tumbo.plantillas_whatsapp (clave, nombre_meta, parametros, categoria) values
  ('verificar_telefono', 'tumbo_codigo_verificacion', '{codigo,minutos}', 'authentication'),
  ('pago_confirmado', 'tumbo_pago_confirmado', '{pedido,monto,enlace}', 'utility'),
  ('pedido_despachado', 'tumbo_pedido_despachado', '{pedido,courier,guia,enlace}', 'utility'),
  ('pedido_listo_retiro', 'tumbo_pedido_listo_retiro', '{pedido,agencia}', 'utility'),
  ('pago_por_vencer', 'tumbo_pago_por_vencer', '{pedido,vence,enlace}', 'utility'),
  ('pedido_por_aceptar', 'tumbo_pedido_por_aceptar', '{pedido,monto,limite,enlace}', 'utility'),
  ('reclamo_actualizado', 'tumbo_reclamo_actualizado', '{reclamo,pedido,estado,enlace}', 'utility'),
  ('reclamo_comercio', 'tumbo_reclamo_comercio', '{reclamo,pedido,estado,enlace}', 'utility'),
  ('reclamo_evidencia', 'tumbo_reclamo_evidencia', '{reclamo,vence,enlace}', 'utility'),
  ('reembolso_enviado', 'tumbo_reembolso_enviado', '{pedido,monto,referencia}', 'utility'),
  ('liquidacion_pagada', 'tumbo_liquidacion_pagada', '{liquidacion,monto,comprobante}', 'utility'),
  ('cuenta_liquidacion', 'tumbo_cuenta_liquidacion', '{detalle,enlace}', 'utility'),
  ('alerta_stock', 'tumbo_alerta_stock', '{producto,precio,enlace}', 'utility'),
  ('alerta_precio', 'tumbo_alerta_precio', '{producto,antes,precio,enlace}', 'utility'),
  ('chat_mensaje', 'tumbo_chat_mensaje', '{de,pedido,enlace}', 'utility'),
  ('pregunta_nueva', 'tumbo_pregunta_nueva', '{producto,enlace}', 'utility'),
  ('pregunta_respondida', 'tumbo_pregunta_respondida', '{producto,enlace}', 'utility'),
  ('resena_pendiente', 'tumbo_resena_pendiente', '{pedido,enlace}', 'utility'),
  ('ticket_actualizado', 'tumbo_ticket_actualizado', '{ticket,enlace}', 'utility')
on conflict (clave) do nothing;

-- Documentos legales: la versión de los términos es la que ya registra
-- Cuentas al crear la cuenta (ajuste terminos_version). Todos son BORRADOR
-- pendiente de revisión legal.
insert into tumbo.documentos_legales (clave, version, titulo, vigente_desde, resumen, roles, borrador, texto_publicado) values
  ('terminos', '2026-10-beta', 'Términos y condiciones de uso', now(), 'Primera versión de la beta (borrador pendiente de revisión legal).',
   '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, true),
  ('privacidad', '2026-10-beta', 'Política de privacidad', now(), 'Primera versión de la beta (borrador pendiente de revisión legal).',
   '{comprador,seller,precios,operador,superadmin,ops,finanzas}', true, true),
  ('contrato_seller', '2026-10-beta', 'Contrato de comercio (seller)', now(), 'Primera versión de la beta (borrador pendiente de revisión legal).',
   '{seller}', true, true),
  ('devoluciones', '2026-10-beta', 'Política de devoluciones y reembolsos', now(), 'Primera versión de la beta (borrador pendiente de revisión legal).',
   '{}', true, true),
  ('compra_protegida', '2026-10-beta', 'Compra Protegida', now(), 'Primera versión de la beta (borrador pendiente de revisión legal).',
   '{}', true, true)
on conflict (clave, version) do nothing;

-- Las cuentas de prueba ya aceptaron la versión de la beta (su contraseña es
-- pública: la demo no les pide aceptar nada).
insert into tumbo.aceptaciones_legales (usuario_id, clave, version)
select u.id, d.clave, d.version
from tumbo.usuarios u cross join tumbo.documentos_legales d
where tumbo_privado.cuenta_demo(u.email) and d.version = '2026-10-beta' and u.rol = any (d.roles)
on conflict do nothing;

-- Quien ya tiene cuenta la creó marcando «Acepto los términos y las
-- políticas de privacidad» (Cuentas guarda solo la versión de los
-- términos): queda constancia de las dos, con la fecha de su registro.
insert into tumbo.aceptaciones_legales (usuario_id, clave, version, aceptado)
select u.id, k.clave, '2026-10-beta', u.terminos_fecha
from tumbo.usuarios u cross join (values ('terminos'), ('privacidad')) k (clave)
where not tumbo_privado.cuenta_demo(u.email) and u.terminos_version = '2026-10-beta' and u.terminos_fecha is not null
on conflict do nothing;

insert into tumbo.disputa_plantillas (clave, titulo, decision, paga, texto, orden) values
  ('dano_comprobado', 'Daño comprobado', 'reembolso', null,
   'La evidencia muestra el producto dañado al recibirlo: devolvemos lo que pagaste completo (productos y envío).', 10),
  ('no_llego', 'No llegó (sin prueba de entrega)', 'reembolso', null,
   'El courier no pudo confirmar la entrega a tu nombre: devolvemos lo que pagaste completo.', 20),
  ('devolucion_comercio', 'Devolución a cargo del comercio', 'devolucion', 'seller',
   'El producto no coincide con lo publicado o llegó defectuoso: devuélvelo con las instrucciones del pedido; el envío de vuelta lo paga el comercio y, al recibirlo e inspeccionarlo, se te reembolsa.', 30),
  ('devolucion_comprador', 'Devolución a cargo del comprador', 'devolucion', 'comprador',
   'El motivo no es responsabilidad del comercio: puedes devolverlo pagando tú el envío de vuelta; al recibirlo e inspeccionarlo, se te reembolsa.', 40),
  ('parcial_faltante', 'Faltaba una pieza (reembolso parcial)', 'reembolso_parcial', null,
   'Faltaba una pieza o un accesorio: reembolsamos su valor y el resto del pedido se liquida al comercio.', 50),
  ('sin_evidencia', 'Sin evidencia suficiente', 'liberar', null,
   'No hay evidencia suficiente de un problema con el producto: el caso se cierra a favor del comercio. Puedes apelar una vez con evidencia nueva.', 60),
  ('entrega_comprobada', 'Entrega comprobada', 'liberar', null,
   'La prueba del courier muestra la entrega en tu dirección: el caso se cierra a favor del comercio. Puedes apelar una vez con evidencia nueva.', 70)
on conflict (clave) do nothing;

insert into tumbo.soporte_macros (titulo, texto, categoria, por) values
  ('Pedido en camino', 'Hola: tu pedido ya salió con el courier. En «Mis pedidos» ves la guía y el enlace de rastreo; si pasa la fecha prometida más dos días hábiles, desde ahí mismo puedes reportar que no llegó.', 'envio', 'Sistema'),
  ('Pago por verificar', 'Hola: Finanzas verifica cada pago con el estado de cuenta del banco. Revisa que la referencia y el monto sean los del comprobante; si Finanzas necesita una corrección, te lo pedirá en la página del pago.', 'pago', 'Sistema'),
  ('Cómo reclamar', 'Hola: abre el reclamo desde el detalle del pedido (botón «Reclamar») dentro de la ventana de reclamo, con fotos o video. Los fondos del comercio quedan congelados hasta la decisión.', 'pedido', 'Sistema'),
  ('Pedimos más datos', 'Hola: para ayudarte necesitamos el número del pedido y, si aplica, una foto del problema. Puedes adjuntarlos aquí mismo.', 'otro', 'Sistema'),
  ('Caso resuelto', 'Hola: damos por resuelto tu caso. Si necesitas algo más, respóndenos aquí y lo reabrimos.', 'otro', 'Sistema')
on conflict (titulo) do nothing;

-- ---------------------------------------------------------------------------
-- Ayudantes del dominio
-- ---------------------------------------------------------------------------
-- Un plazo del ajuste «comunicacion», llevado a su rango (un valor absurdo
-- nunca falla todos los reclamos de inmediato).
create function tumbo_privado.comunicacion(p_clave text, p_omision numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(r.minimo, least(r.maximo,
           tumbo_privado.numero(coalesce(tumbo_privado.ajuste('comunicacion'), '{}'::jsonb) -> p_clave, p_omision)))
  from (select case p_clave when 'horas_respuesta_reclamo' then 24 when 'horas_evidencia' then 12 when 'dias_apelacion' then 1
                            when 'dias_resena' then 7 else 0 end::numeric as minimo,
               case p_clave when 'horas_respuesta_reclamo' then 168 when 'horas_evidencia' then 168 when 'dias_apelacion' then 15
                            when 'dias_resena' then 365 else 100000 end::numeric as maximo) r
$$;

-- Horas para la primera respuesta de soporte según la prioridad.
create function tumbo_privado.sla_soporte_horas(p_prioridad text) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(1, least(240, tumbo_privado.numero(
    coalesce(tumbo_privado.ajuste('comunicacion'), '{}'::jsonb) -> 'sla_soporte_horas' -> coalesce(p_prioridad, 'normal'),
    case coalesce(p_prioridad, 'normal') when 'alta' then 4 when 'baja' then 48 else 24 end)))
$$;

-- Oculta los datos de contacto y de pago de un texto que verá la otra parte
-- (chat) o el público (preguntas, reseñas): correos, enlaces, teléfonos de
-- Venezuela o internacionales, números de cuenta o de tarjeta y usuarios de
-- redes. → {texto, ocultos: ['correo', 'enlace', 'telefono', 'cuenta', 'usuario']}.
-- Los números que no parecen un teléfono ni una cuenta (guías, montos,
-- fechas, números de pedido) se dejan.
-- Las cifras se buscan aunque vengan separadas por espacios, puntos,
-- barras, paréntesis, guiones bajos o guiones de cualquier tipo (hasta 3
-- seguidos: «0414 - 555 12 34», «0414 – 5551234», «0414_555_1234») y con
-- la letra O pegada a una cifra en lugar del cero («O414-555-1234»). Una
-- tira de 16 cifras o más se oculta siempre (cuenta, tarjeta o varios
-- números pegados); una de 10 o más que contiene un celular venezolano,
-- también.
create function tumbo_privado.ocultar_contacto(p_texto text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v text := coalesce(p_texto, '');
  v_ocultos text[] := '{}';
  v_dom constant text := '\m[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.(com|net|org|ve|co|info|io|me|app|link|ly|gl|xyz|shop|store|site|online|top|biz|page|bio)\M(/[^[:space:]]*)?';
  v_sep constant text := '[[:space:].()/_‐‑‒–—―−-]';
  v_dig constant text := '(?:[0-9]|[Oo](?=[0-9])|(?<=[0-9])[Oo])';
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
    d := regexp_replace(translate(m, 'Oo', '00'), '[^0-9]', '', 'g');
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

-- ¿Pide pagar o hablar por fuera de Tumbo, o insulta? (la moderación
-- automática lo aparta para que lo revise una persona antes de publicarlo)
create function tumbo_privado.texto_sospechoso(p_texto text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(lower(p_texto) ~ ('(por\s+fuera|fuera\s+de\s+tumbo|p[aá]game|transfi[eé]reme|deposita(me)?\s+(a|en)\s+mi|'
         'escr[ií]beme\s+al|ll[aá]mame\s+al|whats?app|telegram|instagram|\mzelle\s+directo|'
         '\m(idiota|estafador(es)?|maldit[oa]s?|mierda|co[ñn]o|marico|mamaguevo|hijo\s+de\s+puta|hdp|pendej[oa]s?|imb[eé]cil(es)?|gonorrea)\M)'), false)
$$;

-- Teléfono venezolano (o internacional con su código) en formato E.164 sin
-- el «+»: el que piden wa.me y la API de WhatsApp. null si no lo parece.
create function tumbo_privado.telefono_e164(p text) returns text
language sql immutable set search_path = '' as $$
  select case when d ~ '^58(2|4)[0-9]{9}$' then d
              when d ~ '^0(2|4)[0-9]{9}$' then '58' || substr(d, 2)
              when d ~ '^(2|4)[0-9]{9}$' then '58' || d
              when coalesce(p, '') like '+%' and d ~ '^[1-9][0-9]{7,14}$' then d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- El lado de una persona en una conversación.
create function tumbo_privado.lado_de(p_rol text) returns text
language sql immutable set search_path = '' as $$
  select case when p_rol = 'comprador' then 'comprador'
              when p_rol in ('seller', 'precios', 'operador') then 'comercio'
              else 'tumbo' end
$$;

-- Cómo se ve en público el autor de una reseña o una pregunta: la inicial
-- de su nombre (una cuenta dada de baja, «Cuenta eliminada»).
create function tumbo_privado.autor_publico(p_usuario uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when not u.activo or u.eliminado_el is not null then 'Cuenta eliminada'
                               else upper(left(split_part(trim(u.nombre), ' ', 1), 1)) || '.' end
                   from tumbo.usuarios u where u.id = p_usuario), 'Cuenta eliminada')
$$;

-- ¿Son archivos listos de esta persona, de esos propósitos y de esas
-- entidades? (adjuntos del chat, del expediente, de reseñas y de soporte)
create function tumbo_privado.archivos_propios(p_ids text[], p_yo uuid, p_propositos text[], p_entidades text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(array_ndims(p_ids), 1) = 1
     and not exists (select 1 from unnest(coalesce(p_ids, '{}')) x
                     where x !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        or not exists (select 1 from tumbo.archivos a
                                       where a.id = x::uuid and a.estado = 'listo' and a.propietario = p_yo
                                         and a.proposito = any (p_propositos) and a.entidad = any (p_entidades)))
$$;

-- Lo que la vista necesita de una lista de archivos: id, nombre y tipo (de
-- los que siguen listos).
create function tumbo_privado.archivos_json(p_ids text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'tipo', a.tipo,
                                               'url', tumbo_privado.url_publica(a.id)) order by x.n), '[]'::jsonb)
  from unnest(coalesce(p_ids, '{}')) with ordinality as x (id, n)
  join tumbo.archivos a on a.id::text = x.id and a.estado = 'listo'
$$;

-- ¿Dio la persona su consentimiento para WhatsApp, para ese número?
create function tumbo_privado.whatsapp_consentido(p_usuario uuid, p_telefono text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.accion = 'otorgar'
                          and tumbo_privado.telefono_e164(c.telefono) = tumbo_privado.telefono_e164(p_telefono)
                   from tumbo.consentimientos_whatsapp c where c.usuario_id = p_usuario
                   order by c.id desc limit 1), false)
$$;

-- ---------------------------------------------------------------------------
-- Bandeja de salida: encolar (contrato de la ola 0)
-- ---------------------------------------------------------------------------
-- Desde la de fundaciones. Cambios:
--   · las preferencias no apagan los avisos obligatorios (seguridad de la
--     cuenta y de la cuenta de cobro, cambios legales) ni los mensajes de
--     seguridad;
--   · WhatsApp solo con el consentimiento (opt-in) vigente para el número
--     de la cuenta, salvo los mensajes de seguridad que la persona pidió
--     (el código para verificar su teléfono);
--   · un enlace relativo al sitio («app/tienda/…») sale absoluto (ajuste
--     sitio_url), en el cuerpo y en el enlace;
--   · guarda las variables que pide la plantilla aprobada de WhatsApp.
create or replace function tumbo_privado.encolar(p_usuario uuid, p_plantilla text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
  pl tumbo.plantillas;
  w tumbo.plantillas_whatsapp;
  v_datos jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_seguridad boolean := tumbo_privado.mensaje_sensible(p_plantilla);
  v_obligatorio boolean;
  v_destino text;
  v_enlace text;
  v_hay boolean := false;
begin
  if p_usuario is not null then
    select * into u from tumbo.usuarios where id = p_usuario and activo;
    if not found then
      return;
    end if;
    v_datos := jsonb_build_object('nombre', split_part(u.nombre, ' ', 1)) || v_datos;
  elsif coalesce(v_datos ->> 'correo', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    return;
  end if;
  v_enlace := nullif(btrim(coalesce(v_datos ->> 'enlace', '')), '');
  if v_enlace is not null and v_enlace !~* '^[a-z][a-z0-9+.-]*:' then
    v_enlace := tumbo_privado.url_sitio(v_enlace);
    v_datos := v_datos || jsonb_build_object('enlace', v_enlace);
  end if;
  v_obligatorio := v_seguridad or coalesce((select t.obligatorio from tumbo.avisos_tipos t where t.plantilla = p_plantilla), false);
  select * into w from tumbo.plantillas_whatsapp where clave = p_plantilla;

  for pl in select * from tumbo.plantillas where clave = p_plantilla order by canal loop
    v_hay := true;
    v_destino := case when p_usuario is null then (case when pl.canal = 'correo' then lower(v_datos ->> 'correo') end)
                      when pl.canal = 'correo' then u.email
                      else nullif(trim(coalesce(u.telefono, '')), '') end;
    continue when v_destino is null;
    continue when p_usuario is not null and not v_obligatorio and exists (
      select 1 from tumbo.preferencias_aviso pa
      where pa.usuario_id = p_usuario and pa.tipo = p_plantilla and pa.canal = pl.canal and not pa.activo);
    continue when pl.canal = 'whatsapp' and not v_seguridad
              and (p_usuario is null or not tumbo_privado.whatsapp_consentido(p_usuario, u.telefono));
    insert into tumbo.salida (usuario_id, destino, canal, plantilla, asunto, cuerpo, enlace, datos)
    values (p_usuario, left(v_destino, 200), pl.canal, p_plantilla,
            tumbo_privado.render_plantilla(pl.asunto, v_datos, 'asunto'),
            tumbo_privado.render_plantilla(pl.cuerpo, v_datos, case when pl.canal = 'correo' then 'html' else 'texto' end),
            left(v_enlace, 500),
            case when pl.canal = 'whatsapp' and w.clave is not null then
              (select coalesce(jsonb_object_agg(k, left(regexp_replace(coalesce(v_datos ->> k, ''), '[[:cntrl:]]+', ' ', 'g'), 500)), '{}'::jsonb)
               from unnest(w.parametros) k) end);
  end loop;
  if not v_hay then
    -- (sin cortar la operación de negocio que encola: queda en el registro de Postgres)
    raise warning 'encolar: la plantilla «%» no existe.', p_plantilla;
  end if;
end $$;

-- Al cerrar un mensaje de seguridad (enviado o descartado, a mano o por la
-- función) se borra también su código de las variables guardadas, como
-- tm_salida_marcar borra el cuerpo y el enlace. Un mensaje cerrado suelta
-- el candado de envío.
create function tumbo_privado.salida_al_cerrar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estado in ('enviado', 'descartado') and tumbo_privado.mensaje_sensible(new.plantilla) then
    new.datos := null;
    new.enlace := null;
    if new.cuerpo not like '(Código o enlace de seguridad borrado%' then
      new.cuerpo := '(Código o enlace de seguridad borrado al cerrar el mensaje.)';
    end if;
  end if;
  if new.estado <> 'pendiente' then
    new.enviando_desde := null;
  end if;
  return new;
end $$;

create trigger salida_al_cerrar
  before update of estado on tumbo.salida
  for each row when (old.estado is distinct from new.estado)
  execute function tumbo_privado.salida_al_cerrar();

-- ---------------------------------------------------------------------------
-- Envío real: lo que usa la función tumbo-envios (solo con la clave de
-- servicio). La función autentica a quien la llama: la clave de servicio,
-- el secreto propio de la tarea programada o la sesión de una cuenta real
-- del equipo (superadmin u Operaciones).
-- ---------------------------------------------------------------------------
create function tumbo_privado.exigir_servicio() returns void
language plpgsql stable set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Solo la función de envíos puede hacer esto.' using errcode = '42501';
  end if;
end $$;

create function public.tm_envios_autorizar(p_secreto text, p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
  v_ultima timestamptz;
begin
  perform tumbo_privado.exigir_servicio();
  if nullif(p_secreto, '') is not null then
    if p_secreto = tumbo_privado.secreto('envios') then
      return jsonb_build_object('ok', true, 'por', 'Tarea programada');
    end if;
    return jsonb_build_object('ok', false, 'error', 'No autorizado.');
  end if;
  u := tumbo_privado.usuario(p_sesion);
  if u.id is null then
    return jsonb_build_object('ok', false, 'error', 'Tu sesión expiró: vuelve a iniciar sesión.');
  end if;
  if u.rol not in ('superadmin', 'ops') then
    return jsonb_build_object('ok', false, 'error', 'Tu rol no permite esta acción.');
  end if;
  if tumbo_privado.cuenta_demo(u.email) then
    return jsonb_build_object('ok', false, 'error', 'Las cuentas de prueba no disparan el envío real de mensajes: lo hace la tarea programada o una cuenta real del equipo.');
  end if;
  select ultima into v_ultima from tumbo.envios_estado where id = 1;
  if v_ultima > now() - interval '20 seconds' then
    return jsonb_build_object('ok', false, 'error', 'Acaba de correr un envío: espera unos segundos.');
  end if;
  return jsonb_build_object('ok', true, 'por', u.nombre || ' (' || u.rol || ')');
end $$;

-- Toma un lote de mensajes pendientes de los canales con proveedor.
--   · los mensajes de seguridad de más de una hora se descartan (el código
--     ya venció);
--   · uno tomado que no anotó su resultado en 10 minutos: el correo se
--     vuelve a tomar (con la misma clave de idempotencia, Resend no lo manda
--     dos veces); el WhatsApp queda fallido para revisarlo (su API no tiene
--     idempotencia: nunca se manda dos veces);
--   · WhatsApp solo con una plantilla aprobada por Meta y un número válido;
--   · nunca los de las cuentas de prueba (cualquiera puede poner ahí el
--     correo o el teléfono de otra persona).
create function public.tm_envios_tomar(p_canales text[], p_limite integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lote integer := least(greatest(coalesce(p_limite, 50), 1), 200);
  v jsonb;
begin
  perform tumbo_privado.exigir_servicio();
  update tumbo.salida set estado = 'descartado', error = 'Venció sin enviarse (código o enlace de seguridad)'
  where estado = 'pendiente' and tumbo_privado.mensaje_sensible(plantilla) and creado < now() - interval '60 minutes';
  update tumbo.salida set enviando_desde = null, proximo_intento = now()
  where estado = 'pendiente' and canal = 'correo' and enviando_desde < now() - interval '10 minutes';
  update tumbo.salida set estado = 'fallido', error = 'Sin confirmación del proveedor: revisa si llegó antes de reenviarlo.'
  where estado = 'pendiente' and canal <> 'correo' and enviando_desde < now() - interval '10 minutes';
  update tumbo.salida set estado = 'fallido', error = 'El teléfono no es válido para WhatsApp.'
  where estado = 'pendiente' and canal = 'whatsapp' and 'whatsapp' = any (coalesce(p_canales, '{}'))
    and tumbo_privado.telefono_e164(destino) is null;

  with lote as (
    select s.id from tumbo.salida s
    where s.estado = 'pendiente' and s.enviando_desde is null and s.proximo_intento <= now()
      and s.canal = any (coalesce(p_canales, '{}')) and s.canal in ('correo', 'whatsapp')
      and (s.canal <> 'whatsapp' or exists (select 1 from tumbo.plantillas_whatsapp w where w.clave = s.plantilla and w.aprobada))
      -- los de las cuentas de prueba (contraseña pública) nunca salen: quedan para practicar el envío a mano
      and not exists (select 1 from tumbo.usuarios u where u.id = s.usuario_id and tumbo_privado.cuenta_demo(u.email))
    order by s.proximo_intento, s.id
    limit v_lote
    for update skip locked
  ), tomados as (
    update tumbo.salida s set enviando_desde = now(), intentos = s.intentos + 1, ultimo_intento = now()
    from lote where s.id = lote.id
    returning s.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'canal', t.canal, 'plantilla', t.plantilla, 'intento', t.intentos,
           'idempotencia', 'tumbo-salida-' || t.id,
           'destino', case when t.canal = 'whatsapp' then tumbo_privado.telefono_e164(t.destino) else t.destino end,
           'asunto', t.asunto, 'cuerpo', t.cuerpo, 'enlace', t.enlace,
           'whatsapp', case when t.canal = 'whatsapp' then (
              select jsonb_build_object('nombre', w.nombre_meta, 'idioma', w.idioma,
                       'parametros', coalesce((select jsonb_agg(coalesce(t.datos ->> k, '') order by n)
                                               from unnest(w.parametros) with ordinality as p (k, n)), '[]'::jsonb))
              from tumbo.plantillas_whatsapp w where w.clave = t.plantilla) end) order by t.id), '[]'::jsonb) into v
  from tomados t;
  return v;
end $$;

-- El resultado de un envío. Idempotente: un mensaje que ya no estaba
-- tomado no cambia. Un fallo temporal se reintenta con espera (1, 5 y 30
-- minutos, 2 horas) hasta el máximo de intentos; uno permanente queda
-- fallido (para revisarlo y enviarlo a mano).
create function public.tm_envios_resultado(p_id bigint, p_ok boolean, p_proveedor text, p_proveedor_id text,
                                           p_error text, p_reintentar boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m tumbo.salida;
  v_max integer := least(greatest(tumbo_privado.numero(tumbo_privado.ajuste('envios') -> 'max_intentos', 5)::integer, 1), 10);
  v_estado text;
begin
  perform tumbo_privado.exigir_servicio();
  select * into m from tumbo.salida where id = p_id for update;
  if not found or m.estado <> 'pendiente' or m.enviando_desde is null then
    return jsonb_build_object('ok', false, 'motivo', 'El mensaje no estaba tomado para enviarse.');
  end if;
  if coalesce(p_ok, false) then
    v_estado := 'enviado';
    update tumbo.salida
    set estado = 'enviado', enviado_en = now(), enviando_desde = null, error = null,
        proveedor = left(p_proveedor, 40), proveedor_id = left(p_proveedor_id, 200),
        por = 'Envío automático (' || coalesce(left(p_proveedor, 40), 'proveedor') || ')'
    where id = p_id;
  elsif coalesce(p_reintentar, false) and m.intentos < v_max then
    v_estado := 'pendiente';
    update tumbo.salida
    set enviando_desde = null, proveedor = left(p_proveedor, 40), error = left(coalesce(p_error, 'Fallo temporal del proveedor'), 300),
        proximo_intento = now() + make_interval(mins => case m.intentos when 1 then 1 when 2 then 5 when 3 then 30 else 120 end)
    where id = p_id;
  else
    v_estado := 'fallido';
    update tumbo.salida
    set estado = 'fallido', enviando_desde = null, proveedor = left(p_proveedor, 40),
        error = left(coalesce(p_error, 'El proveedor rechazó el mensaje'), 300)
    where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'estado', v_estado);
end $$;

-- Lo que la función informa en cada corrida: qué proveedores tiene
-- configurados (sin sus secretos) y el resumen.
create function public.tm_envios_reporte(p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
begin
  perform tumbo_privado.exigir_servicio();
  insert into tumbo.envios_estado (id, correo, whatsapp, ultima, resumen, por)
  values (1, coalesce((d ->> 'correo')::boolean, false), coalesce((d ->> 'whatsapp')::boolean, false), now(),
          jsonb_build_object('enviados', coalesce((d ->> 'enviados')::integer, 0), 'fallidos', coalesce((d ->> 'fallidos')::integer, 0),
                             'reintentos', coalesce((d ->> 'reintentos')::integer, 0), 'tomados', coalesce((d ->> 'tomados')::integer, 0),
                             'mensaje', left(d ->> 'mensaje', 300)),
          left(d ->> 'por', 120))
  on conflict (id) do update set correo = excluded.correo, whatsapp = excluded.whatsapp, ultima = excluded.ultima,
    resumen = excluded.resumen, por = excluded.por;
end $$;

-- ¿Hay algo que tm_envios_tomar tomaría por esos canales? (pendiente y en
-- su hora, o tomado sin resultado hace más de 10 minutos; WhatsApp solo con
-- plantilla aprobada; nunca los de las cuentas de prueba)
create function tumbo_privado.envios_por_tomar(p_canales text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from tumbo.salida s
    where s.estado = 'pendiente' and s.canal = any (coalesce(p_canales, '{}')) and s.canal in ('correo', 'whatsapp')
      and ((s.enviando_desde is null and s.proximo_intento <= now()) or s.enviando_desde < now() - interval '10 minutes')
      and (s.canal <> 'whatsapp' or exists (select 1 from tumbo.plantillas_whatsapp w where w.clave = s.plantilla and w.aprobada))
      and not exists (select 1 from tumbo.usuarios u where u.id = s.usuario_id and tumbo_privado.cuenta_demo(u.email)))
$$;

-- La tarea programada (pg_cron cada minuto, si existe): llama a la función
-- con pg_net (si existe y si se configuró su URL en el ajuste «envios») y
-- solo cuando hay algo que tm_envios_tomar tomaría: ni los mensajes de las
-- cuentas de prueba ni los WhatsApp sin plantilla aprobada (esos se envían
-- a mano), y solo de los canales con proveedor según la última corrida. Si
-- la función informó que no tiene ninguno, vuelve a probar cada 30 minutos.
create function tumbo_privado.tarea_envios() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := tumbo_privado.ajuste('envios') ->> 'funcion_url';
  v_req bigint;
  e tumbo.envios_estado;
  v_canales text[];
begin
  if v_url is null or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/functions/v1/tumbo-envios$' then
    return jsonb_build_object('llamada', false, 'motivo', 'Falta la URL de la función tumbo-envios en el ajuste «envios».');
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return jsonb_build_object('llamada', false, 'motivo', 'Sin pg_net: la función se llama a mano desde admin/mensajes.');
  end if;
  select * into e from tumbo.envios_estado where id = 1;
  v_canales := array_remove(array[case when e.correo then 'correo' end, case when e.whatsapp then 'whatsapp' end], null);
  if e.ultima is null or cardinality(v_canales) = 0 then
    if e.ultima > now() - interval '30 minutes' then
      return jsonb_build_object('llamada', false, 'motivo', 'La función no tiene proveedores configurados (lo informó a las ' ||
        to_char(e.ultima at time zone 'America/Caracas', 'HH24:MI') || '): se vuelve a probar cada 30 minutos.');
    end if;
    v_canales := array['correo', 'whatsapp'];
  end if;
  if not tumbo_privado.envios_por_tomar(v_canales) then
    return jsonb_build_object('llamada', false, 'motivo', 'Nada que la función pueda enviar.');
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 20000)'
    into v_req
    using v_url, '{"accion": "enviar"}'::jsonb,
          jsonb_build_object('content-type', 'application/json', 'x-tumbo-envios', tumbo_privado.secreto('envios'));
  return jsonb_build_object('llamada', true, 'solicitud', v_req);
end $$;

-- ---------------------------------------------------------------------------
-- Bandeja para el equipo (admin/mensajes): filtros, estado del envío y
-- reintento. Mismas reglas que tm_salida_listar (ola 0): las cuentas de
-- prueba solo ven los mensajes de las cuentas de prueba, y el contenido de
-- seguridad solo lo ve el superadministrador con su cuenta real.
-- ---------------------------------------------------------------------------
create function public.tm_mensajes(p_sesion text, p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  f jsonb := case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end;
  v_seguridad boolean := yo.rol = 'superadmin' and not tumbo_privado.cuenta_demo(yo.email);
  v_estado text := nullif(f ->> 'estado', '');
  v_canal text := nullif(f ->> 'canal', '');
  v_plantilla text := nullif(f ->> 'plantilla', '');
  v_texto text := nullif(left(btrim(coalesce(f ->> 'texto', '')), 80), '');
  v_antes bigint;
  v jsonb;
begin
  if v_estado is not null and v_estado not in ('pendiente', 'enviado', 'fallido', 'manual', 'descartado') then
    raise exception 'Ese estado de mensaje no existe.';
  end if;
  if v_canal is not null and v_canal not in ('correo', 'whatsapp', 'sms') then
    raise exception 'Ese canal no existe.';
  end if;
  begin
    v_antes := nullif(f ->> 'antes', '')::bigint;
  exception when others then
    v_antes := null;
  end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'usuario', u.nombre, 'destino', s.destino, 'canal', s.canal, 'plantilla', s.plantilla,
           'tipo', coalesce(t.nombre, s.plantilla), 'asunto', s.asunto, 'sensible', s.sensible,
           'cuerpo', case when s.sensible and not v_seguridad
                          then '(Mensaje con un código o enlace de seguridad: solo lo ve el superadministrador con su cuenta.)' else s.cuerpo end,
           'enlace', case when s.sensible and not v_seguridad then null else s.enlace end,
           'telefono', case when s.canal <> 'correo' and (not s.sensible or v_seguridad) then tumbo_privado.telefono_e164(s.destino) end,
           'estado', s.estado, 'intentos', s.intentos, 'error', s.error, 'nota', s.nota, 'proveedor', s.proveedor,
           'proximo_intento', case when s.estado = 'pendiente' then s.proximo_intento end,
           'enviando', s.enviando_desde is not null,
           'creado', s.creado, 'enviado_en', s.enviado_en, 'por', s.por,
           'automatico', s.canal = 'correo' or (s.canal = 'whatsapp' and coalesce(w.aprobada, false))) order by s.id desc), '[]'::jsonb) into v
  from (select x.*, tumbo_privado.mensaje_sensible(x.plantilla) as sensible
        from tumbo.salida x
        where (v_estado is null or x.estado = v_estado) and (v_canal is null or x.canal = v_canal)
          and (v_plantilla is null or x.plantilla = v_plantilla)
          and (v_texto is null or x.destino ilike '%' || v_texto || '%' or x.asunto ilike '%' || v_texto || '%')
          and (v_antes is null or x.id < v_antes)
          and tumbo_privado.salida_visible(yo, x.usuario_id)
        order by x.id desc limit 50) s
  left join tumbo.usuarios u on u.id = s.usuario_id
  left join tumbo.avisos_tipos t on t.plantilla = s.plantilla
  left join tumbo.plantillas_whatsapp w on w.clave = s.plantilla;
  return jsonb_build_object('mensajes', v,
    'siguiente', case when jsonb_array_length(v) = 50 then (v -> 49 ->> 'id')::bigint end);
end $$;

-- Estado del envío para la página del equipo: proveedores, colas por canal,
-- la tarea programada y las plantillas de WhatsApp.
create function public.tm_envios_estado(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  e tumbo.envios_estado;
begin
  select * into e from tumbo.envios_estado where id = 1;
  return jsonb_build_object(
    'proveedores', jsonb_build_object('correo', coalesce(e.correo, false), 'whatsapp', coalesce(e.whatsapp, false),
                                      'ultima', e.ultima, 'resumen', coalesce(e.resumen, '{}'::jsonb), 'por', e.por),
    'colas', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
               select x.estado || ':' || x.canal as k, count(*) as n from tumbo.salida x
               where x.estado in ('pendiente', 'fallido', 'manual') and tumbo_privado.salida_visible(yo, x.usuario_id)
               group by 1) c),
    'tarea', jsonb_build_object('pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
                                'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
                                'funcion_url', (tumbo_privado.ajuste('envios') ->> 'funcion_url') is not null),
    'plantillas_whatsapp', coalesce((select jsonb_agg(jsonb_build_object('clave', w.clave, 'nombre_meta', w.nombre_meta,
                             'idioma', w.idioma, 'parametros', to_jsonb(w.parametros), 'categoria', w.categoria, 'aprobada', w.aprobada,
                             'cuerpo', (select p.cuerpo from tumbo.plantillas p where p.clave = w.clave and p.canal = 'whatsapp'))
                             order by w.clave) from tumbo.plantillas_whatsapp w), '[]'::jsonb),
    'puede_enviar', not tumbo_privado.cuenta_demo(yo.email),
    'puede_configurar', yo.rol = 'superadmin' and not tumbo_privado.cuenta_demo(yo.email));
end $$;

-- Vuelve a poner en cola un mensaje fallido o apartado para envío manual.
create function public.tm_mensaje_reintentar(p_sesion text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  m tumbo.salida;
begin
  select * into m from tumbo.salida where id = p_id for update;
  if not found or not tumbo_privado.salida_visible(yo, m.usuario_id) then
    raise exception 'No encontramos ese mensaje.';
  end if;
  if m.estado not in ('fallido', 'manual') then
    raise exception 'Solo se vuelve a poner en cola un mensaje fallido o apartado para enviarlo a mano.';
  end if;
  if tumbo_privado.mensaje_sensible(m.plantilla) and (yo.rol <> 'superadmin' or tumbo_privado.cuenta_demo(yo.email)) then
    raise exception 'Los mensajes de seguridad solo los gestiona el superadministrador con su cuenta.';
  end if;
  update tumbo.salida set estado = 'pendiente', proximo_intento = now(), enviando_desde = null, error = null
  where id = p_id;
  perform tumbo_privado.auditar(yo, 'Mensaje saliente en cola de nuevo', '#' || p_id || ' ' || m.plantilla || ' (' || m.canal || ')');
end $$;

-- El superadministrador real anota la plantilla aprobada por Meta (nombre,
-- idioma, orden de las variables) y si ya está aprobada.
create function public.tm_whatsapp_plantilla_guardar(p_sesion text, p_clave text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  w tumbo.plantillas_whatsapp;
  v_params text[];
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into w from tumbo.plantillas_whatsapp where clave = p_clave for update;
  if not found then
    raise exception 'Esa plantilla de WhatsApp no existe.';
  end if;
  if d ? 'parametros' then
    if jsonb_typeof(d -> 'parametros') <> 'array' or jsonb_array_length(d -> 'parametros') > 10 then
      raise exception 'Indica las variables en orden (hasta 10).';
    end if;
    select array_agg(x order by n) into v_params from jsonb_array_elements_text(d -> 'parametros') with ordinality as t (x, n);
    if exists (select 1 from unnest(coalesce(v_params, '{}')) x where x !~ '^[a-z0-9_]{1,40}$') then
      raise exception 'Cada variable es un nombre de la plantilla de Tumbo (minúsculas, números y _).';
    end if;
  end if;
  if d ? 'nombre_meta' and (coalesce(d ->> 'nombre_meta', '') !~ '^[a-z0-9_]+$' or char_length(d ->> 'nombre_meta') > 512) then
    raise exception 'El nombre de la plantilla en Meta solo admite minúsculas, números y _.';
  end if;
  if d ? 'idioma' and coalesce(d ->> 'idioma', '') !~ '^[a-z]{2}(_[A-Z]{2})?$' then
    raise exception 'El idioma va como es o es_VE.';
  end if;
  update tumbo.plantillas_whatsapp
  set nombre_meta = coalesce(d ->> 'nombre_meta', nombre_meta), idioma = coalesce(d ->> 'idioma', idioma),
      parametros = coalesce(v_params, parametros),
      aprobada = coalesce((d ->> 'aprobada')::boolean, aprobada), actualizado = now(), por = yo.nombre || ' (' || yo.rol || ')'
  where clave = p_clave;
  perform tumbo_privado.auditar(yo, 'Plantilla de WhatsApp', p_clave || ' → ' || coalesce(d ->> 'nombre_meta', w.nombre_meta) ||
    case when coalesce((d ->> 'aprobada')::boolean, w.aprobada) then ' (aprobada)' else ' (pendiente)' end);
end $$;

-- ---------------------------------------------------------------------------
-- Preferencias de aviso (Mi cuenta → Notificaciones)
-- ---------------------------------------------------------------------------
create function public.tm_avisos(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  c tumbo.consentimientos_whatsapp;
  e tumbo.envios_estado;
begin
  select * into c from tumbo.consentimientos_whatsapp where usuario_id = yo.id order by id desc limit 1;
  select * into e from tumbo.envios_estado where id = 1;
  return jsonb_build_object(
    'tipos', coalesce((select jsonb_agg(jsonb_build_object(
               'plantilla', t.plantilla, 'grupo', t.grupo, 'nombre', t.nombre, 'descripcion', t.descripcion,
               'obligatorio', t.obligatorio or tumbo_privado.mensaje_sensible(t.plantilla),
               'canales', (select coalesce(jsonb_object_agg(p.canal, not exists (
                             select 1 from tumbo.preferencias_aviso pa where pa.usuario_id = yo.id and pa.tipo = t.plantilla
                               and pa.canal = p.canal and not pa.activo)), '{}'::jsonb)
                           from tumbo.plantillas p where p.clave = t.plantilla and p.canal in ('correo', 'whatsapp')))
             order by t.orden, t.plantilla)
             from tumbo.avisos_tipos t where yo.rol = any (t.roles)), '[]'::jsonb),
    'whatsapp', jsonb_build_object(
      'telefono', yo.telefono, 'telefono_verificado', yo.telefono_verificado,
      'consentido', tumbo_privado.whatsapp_consentido(yo.id, yo.telefono),
      'desde', case when c.accion = 'otorgar' then c.creado end,
      'otro_numero', c.accion = 'otorgar' and tumbo_privado.telefono_e164(c.telefono) is distinct from tumbo_privado.telefono_e164(yo.telefono)),
    'proveedores', jsonb_build_object('correo', coalesce(e.correo, false), 'whatsapp', coalesce(e.whatsapp, false)),
    'demo', tumbo_privado.cuenta_demo(yo.email));
end $$;

-- p_cambios: [{plantilla, canal, activo}] (hasta 80). Los obligatorios y
-- los de otros roles no se tocan.
create function public.tm_avisos_guardar(p_sesion text, p_cambios jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  x jsonb;
  n integer := 0;
begin
  if jsonb_typeof(p_cambios) <> 'array' or jsonb_array_length(p_cambios) > 80 then
    raise exception 'Indica los avisos que cambian (hasta 80).';
  end if;
  for x in select * from jsonb_array_elements(p_cambios) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'canal', '') not in ('correo', 'whatsapp')
       or jsonb_typeof(x -> 'activo') <> 'boolean' then
      raise exception 'Cada aviso lleva su tipo, su canal (correo o WhatsApp) y si queda activo.';
    end if;
    if not exists (select 1 from tumbo.avisos_tipos t where t.plantilla = x ->> 'plantilla' and yo.rol = any (t.roles)) then
      raise exception 'Ese tipo de aviso no existe para tu cuenta.';
    end if;
    if exists (select 1 from tumbo.avisos_tipos t where t.plantilla = x ->> 'plantilla'
               and (t.obligatorio or tumbo_privado.mensaje_sensible(t.plantilla))) then
      raise exception 'Los avisos de seguridad no se pueden desactivar.';
    end if;
    insert into tumbo.preferencias_aviso (usuario_id, tipo, canal, activo)
    values (yo.id, x ->> 'plantilla', x ->> 'canal', (x ->> 'activo')::boolean)
    on conflict (usuario_id, tipo, canal) do update set activo = excluded.activo;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cambios', n);
end $$;

-- Consentimiento para WhatsApp (opt-in): con un teléfono verificado (así
-- nadie suscribe el número de otra persona). Retirarlo siempre se puede.
create function public.tm_whatsapp_consentimiento(p_sesion text, p_otorgar boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
begin
  if p_otorgar is null then
    raise exception 'Indica si aceptas o retiras el consentimiento.';
  end if;
  if p_otorgar then
    if tumbo_privado.telefono_e164(yo.telefono) is null then
      raise exception 'Agrega tu teléfono en Mi cuenta → Perfil para recibir avisos por WhatsApp.';
    end if;
    if not yo.telefono_verificado then
      raise exception 'Verifica tu teléfono en Mi cuenta → Perfil antes de activar WhatsApp (así nadie suscribe un número ajeno).';
    end if;
    if tumbo_privado.whatsapp_consentido(yo.id, yo.telefono) then
      return jsonb_build_object('ok', true, 'consentido', true);
    end if;
  elsif not tumbo_privado.whatsapp_consentido(yo.id, yo.telefono)
        and coalesce((select accion from tumbo.consentimientos_whatsapp where usuario_id = yo.id order by id desc limit 1), 'retirar') = 'retirar' then
    return jsonb_build_object('ok', true, 'consentido', false);
  end if;
  insert into tumbo.consentimientos_whatsapp (usuario_id, accion, telefono, version, red)
  values (yo.id, case when p_otorgar then 'otorgar' else 'retirar' end, yo.telefono, 'whatsapp-2026-10', tumbo_privado.ip_cliente());
  perform tumbo_privado.auditar(yo, case when p_otorgar then 'Consentimiento de WhatsApp otorgado' else 'Consentimiento de WhatsApp retirado' end, '');
  return jsonb_build_object('ok', true, 'consentido', p_otorgar);
end $$;

-- ---------------------------------------------------------------------------
-- Chat por pedido
-- ---------------------------------------------------------------------------
-- ¿Quién entra al chat de un pedido? El comprador; el seller principal y su
-- operador (los pedidos que el comercio ya ve: pago conciliado); y el
-- equipo (superadmin y Operaciones) solo cuando el pedido tiene un reclamo,
-- con una cuenta de prueba solo en los pedidos de la demo.
-- → {lado, puede_escribir, motivo} o null si no entra.
create function tumbo_privado.chat_acceso(p_yo tumbo.usuarios, v tumbo.pedidos) returns jsonb
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
  -- se escribe desde que el pago se concilia hasta 60 días después de creado
  -- el pedido (o mientras tenga un reclamo sin resolver)
  v_abierto := v.estado <> 'pago_por_verificar'
               and (v.creado > now() - interval '60 days'
                    or exists (select 1 from tumbo.disputas d where d.id = v.disputa_id and d.estado <> 'resuelta'));
  return jsonb_build_object('lado', v_lado, 'puede_escribir', v_abierto,
    'motivo', case when v.estado = 'pago_por_verificar' then 'El chat se abre cuando Finanzas verifica el pago.'
                   when not v_abierto then 'El chat de este pedido ya se cerró (60 días después de la compra).' end);
end $$;

-- La conversación de un pedido, de 50 en 50 (las más nuevas primero con
-- p_antes; se devuelven en orden). Marca lo leído.
create function public.tm_chat(p_sesion text, p_pedido text, p_antes bigint) returns jsonb
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

-- Mensajes sin leer de los pedidos de la persona (para avisar en las listas).
create function public.tm_chat_pendientes(p_sesion text) returns jsonb
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
             or (yo.rol in ('seller', 'operador') and p.seller_id = yo.seller_id and c.lado <> 'comercio'))
        and c.id > coalesce((select l.ultimo from tumbo.chat_lecturas l where l.pedido_id = c.pedido_id and l.usuario_id = yo.id), 0)
      group by c.pedido_id) x), '{}'::jsonb);
end $$;

-- Escribe en el chat. El texto sale con los datos de contacto y de pago
-- ocultos (correos, enlaces, teléfonos, cuentas): la otra parte nunca los
-- recibe. Adjuntos: hasta 4 archivos del chat de ese pedido, ya subidos.
-- Al otro lado le llega el aviso en la campana y, como mucho uno cada 30
-- minutos por pedido, por la bandeja de salida.
create function public.tm_chat_enviar(p_sesion text, p_pedido text, p_texto text, p_adjuntos uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'operador', 'superadmin', 'ops']);
  v tumbo.pedidos;
  a jsonb;
  o jsonb;
  s tumbo.sellers;
  v_lado text;
  v_autor text;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_adj uuid[] := coalesce(p_adjuntos, '{}');
  v_id bigint;
  u record;
begin
  select * into v from tumbo.pedidos where id = p_pedido;
  a := tumbo_privado.chat_acceso(yo, v);
  if a is null then
    raise exception 'No encontramos la conversación de ese pedido.';
  end if;
  if not (a ->> 'puede_escribir')::boolean then
    raise exception '%', a ->> 'motivo';
  end if;
  v_lado := a ->> 'lado';
  -- una cuenta de prueba (contraseña pública) no le escribe a una persona o un comercio real
  perform tumbo_privado.exigir_cuenta_real(yo, case v_lado when 'comprador' then tumbo_privado.seller_real(v.seller_id)
                                                           when 'comercio' then tumbo_privado.comprador_real(v.comprador_id)
                                                           else tumbo_privado.pedido_real(v) end);
  if char_length(v_texto) = 0 and cardinality(v_adj) = 0 then
    raise exception 'Escribe un mensaje o adjunta un archivo.';
  end if;
  if char_length(v_texto) > 1000 then
    raise exception 'El mensaje puede tener hasta 1.000 caracteres.';
  end if;
  if cardinality(v_adj) > 4 or coalesce(array_ndims(v_adj), 1) <> 1
     or not tumbo_privado.archivos_propios(v_adj::text[], yo.id, array['chat'], array[p_pedido]) then
    raise exception 'Adjunta hasta 4 archivos subidos para este pedido.';
  end if;
  if (select count(*) from tumbo.chat_mensajes where autor_id = yo.id and creado > now() - interval '1 hour') >= 60
     or (select count(*) from tumbo.chat_mensajes where autor_id = yo.id and pedido_id = p_pedido and creado > now() - interval '10 minutes') >= 20 then
    raise exception 'Enviaste muchos mensajes seguidos: espera unos minutos.';
  end if;
  o := tumbo_privado.ocultar_contacto(v_texto);
  select * into s from tumbo.sellers where id = v.seller_id;
  v_autor := case v_lado when 'comprador' then 'Comprador' when 'comercio' then s.nombre else 'Operaciones Tumbo' end;
  insert into tumbo.chat_mensajes (pedido_id, autor_id, lado, autor, texto, adjuntos, ocultos)
  values (p_pedido, yo.id, v_lado, v_autor,
          coalesce(nullif(o ->> 'texto', ''), '(archivo adjunto)'), v_adj,
          coalesce((select array_agg(x) from jsonb_array_elements_text(o -> 'ocultos') x), '{}'))
  returning id into v_id;
  insert into tumbo.chat_lecturas (pedido_id, usuario_id, ultimo) values (p_pedido, yo.id, v_id)
  on conflict (pedido_id, usuario_id) do update set ultimo = excluded.ultimo;

  -- avisos al otro lado (y a Operaciones con un reclamo abierto)
  if v_lado <> 'comprador' then
    perform tumbo_privado.notificar('usr:' || v.comprador_id, v_autor || ' te escribió sobre ' || v.id, 'chat', 'tienda/pedido.html?id=' || v.id);
    if not exists (select 1 from tumbo.chat_avisos where pedido_id = v.id and lado = 'comprador' and avisado > now() - interval '30 minutes') then
      insert into tumbo.chat_avisos (pedido_id, lado, avisado) values (v.id, 'comprador', now())
      on conflict (pedido_id, lado) do update set avisado = excluded.avisado;
      perform tumbo_privado.encolar(v.comprador_id, 'chat_mensaje', jsonb_build_object('pedido', v.id, 'de', v_autor,
        'enlace', 'app/tienda/pedido.html?id=' || v.id));
    end if;
  end if;
  if v_lado <> 'comercio' then
    perform tumbo_privado.notificar('seller:' || v.seller_id, case v_lado when 'comprador' then 'El comprador' else 'Operaciones' end ||
      ' te escribió sobre ' || v.id, 'chat', 'seller/pedido.html?id=' || v.id, array['seller', 'operador']);
    if not exists (select 1 from tumbo.chat_avisos where pedido_id = v.id and lado = 'comercio' and avisado > now() - interval '30 minutes') then
      insert into tumbo.chat_avisos (pedido_id, lado, avisado) values (v.id, 'comercio', now())
      on conflict (pedido_id, lado) do update set avisado = excluded.avisado;
      for u in select x.id from tumbo.usuarios x where x.seller_id = v.seller_id and x.rol in ('seller', 'operador') and x.activo order by x.id loop
        perform tumbo_privado.encolar(u.id, 'chat_mensaje', jsonb_build_object('pedido', v.id,
          'de', case v_lado when 'comprador' then 'El comprador' else 'Operaciones Tumbo' end,
          'enlace', 'app/seller/pedido.html?id=' || v.id));
      end loop;
    end if;
  end if;
  if v_lado <> 'tumbo' and exists (select 1 from tumbo.disputas d where d.id = v.disputa_id and d.estado <> 'resuelta') then
    perform tumbo_privado.notificar('rol:ops', 'Mensaje nuevo en el chat de ' || v.id || ' (reclamo ' || v.disputa_id || ')', 'chat',
      'admin/pedido.html?id=' || v.id);
  end if;
  return jsonb_build_object('id', v_id, 'ocultos', o -> 'ocultos', 'texto', o ->> 'texto');
end $$;

-- ---------------------------------------------------------------------------
-- Preguntas y respuestas públicas
-- ---------------------------------------------------------------------------
-- Una pregunta o respuesta con datos de contacto se rechaza (es pública y
-- Tumbo protege la compra); una que pide pagar por fuera o insulta se
-- publica solo después de revisarla una persona.
create function tumbo_privado.texto_publico(p_texto text, p_que text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_array_length(tumbo_privado.ocultar_contacto(p_texto) -> 'ocultos') > 0 then
    raise exception 'No incluyas teléfonos, correos, enlaces, usuarios de redes ni números de cuenta en %: es público y, por tu seguridad, todo se coordina dentro de Tumbo.', p_que;
  end if;
  return case when tumbo_privado.texto_sospechoso(p_texto) then 'revision' else 'publicada' end;
end $$;

-- Mediana de horas para responder preguntas (90 días) de un comercio.
create function tumbo_privado.respuesta_horas(p_seller text) returns numeric
language sql stable security definer set search_path = '' as $$
  select round((percentile_cont(0.5) within group (order by extract(epoch from q.respondida_en - q.creado) / 3600))::numeric, 1)
  from tumbo.preguntas q
  where q.seller_id = p_seller and q.respondida_en is not null and q.creado > now() - interval '90 days'
$$;

-- Las preguntas de un producto (públicas; con sesión, también las propias en
-- revisión). 20 por página. Una respuesta solo se entrega publicada: la que
-- apartó la moderación no la lee nadie (tampoco quien preguntó, que ve que
-- está en revisión) hasta que la apruebe una persona.
create function public.tm_preguntas(p_sesion text, p_sku text, p_pagina integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  p tumbo.productos;
  v_pag integer := greatest(coalesce(p_pagina, 1), 1);
  v_total integer;
  v jsonb;
begin
  select * into p from tumbo.productos where sku = p_sku;
  if not found or (p.estado <> 'publicado' and p.seller_id is distinct from yo.seller_id and yo.rol is distinct from 'superadmin') then
    return jsonb_build_object('error', 'Producto no disponible.', 'preguntas', '[]'::jsonb, 'total', 0);
  end if;
  select count(*) into v_total from tumbo.preguntas q where q.sku = p_sku and q.estado = 'publicada';
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'texto', q.texto, 'creado', q.creado, 'estado', case when q.autor_id = yo.id then q.estado end,
           'mia', coalesce(q.autor_id = yo.id, false),
           'respuesta', case when q.respuesta_estado = 'publicada' then q.respuesta end,
           'respuesta_en_revision', coalesce(q.autor_id = yo.id and q.respuesta_estado = 'revision', false),
           'respondida_en', case when q.respuesta_estado = 'publicada' then q.respondida_en end) order by q.creado desc, q.id desc), '[]'::jsonb) into v
  from (select * from tumbo.preguntas q
        where q.sku = p_sku and (q.estado = 'publicada' or (yo.id is not null and q.autor_id = yo.id and q.estado = 'revision'))
        order by q.creado desc, q.id desc offset (v_pag - 1) * 20 limit 20) q;
  return jsonb_build_object('preguntas', v, 'total', v_total, 'pagina', v_pag, 'paginas', greatest(1, ceil(v_total / 20.0)::integer),
    'puede_preguntar', coalesce(yo.rol = 'comprador', false), 'con_sesion', yo.id is not null,
    'respuesta_horas', tumbo_privado.respuesta_horas(p.seller_id));
end $$;

create function public.tm_pregunta_hacer(p_sesion text, p_sku text, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  p tumbo.productos;
  v_texto text := btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  v_estado text;
  v_id bigint;
  u record;
begin
  select * into p from tumbo.productos where sku = p_sku;
  if not found or p.estado <> 'publicado' or not exists (select 1 from tumbo.sellers s where s.id = p.seller_id and s.estado = 'aprobado') then
    raise exception 'Ese producto no está disponible.';
  end if;
  -- (una cuenta de prueba, de contraseña pública, no publica en la ficha de un comercio real ni le dispara avisos)
  perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.seller_real(p.seller_id));
  if char_length(v_texto) < 5 or char_length(v_texto) > 500 then
    raise exception 'Escribe tu pregunta con entre 5 y 500 caracteres.';
  end if;
  v_estado := tumbo_privado.texto_publico(v_texto, 'la pregunta');
  perform tumbo_privado.bloquear_usuario(yo.id, 'preguntas');
  if (select count(*) from tumbo.preguntas where autor_id = yo.id and creado > now() - interval '1 day') >= 10 then
    raise exception 'Llegaste al máximo de 10 preguntas por día. Podrás preguntar más mañana.';
  end if;
  if (select count(*) from tumbo.preguntas where autor_id = yo.id and sku = p_sku and respondida_en is null and estado <> 'oculta') >= 3 then
    raise exception 'Ya tienes 3 preguntas sin responder sobre este producto: espera la respuesta del comercio.';
  end if;
  if exists (select 1 from tumbo.preguntas where autor_id = yo.id and sku = p_sku and lower(texto) = lower(v_texto)) then
    raise exception 'Ya hiciste esa misma pregunta.';
  end if;
  insert into tumbo.preguntas (sku, seller_id, autor_id, texto, estado) values (p_sku, p.seller_id, yo.id, v_texto, v_estado)
  returning id into v_id;
  if v_estado = 'publicada' then
    perform tumbo_privado.notificar('seller:' || p.seller_id, 'Te preguntaron sobre «' || left(p.nombre, 60) || '»', 'help',
      'seller/preguntas.html', array['seller', 'operador']);
    for u in select x.id from tumbo.usuarios x where x.seller_id = p.seller_id and x.rol in ('seller', 'operador') and x.activo order by x.id loop
      perform tumbo_privado.encolar(u.id, 'pregunta_nueva', jsonb_build_object('producto', left(p.nombre, 80), 'enlace', 'app/seller/preguntas.html'));
    end loop;
  else
    perform tumbo_privado.notificar('rol:ops', 'Pregunta en revisión sobre ' || p_sku, 'flag', 'admin/contenido.html');
  end if;
  return jsonb_build_object('id', v_id, 'estado', v_estado);
end $$;

-- La bandeja del comercio: preguntas por responder primero, con el
-- producto, el tiempo de espera y sus respuestas rápidas.
create function public.tm_preguntas_seller(p_sesion text, p_filtro text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'operador']);
  v_filtro text := coalesce(nullif(p_filtro, ''), 'pendientes');
begin
  if v_filtro not in ('pendientes', 'respondidas', 'todas') then
    raise exception 'Ese filtro no existe.';
  end if;
  return jsonb_build_object(
    'preguntas', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', q.id, 'sku', q.sku, 'producto', p.nombre, 'img', p.img, 'texto', q.texto, 'estado', q.estado,
                   'creado', q.creado, 'respuesta', q.respuesta, 'respuesta_estado', q.respuesta_estado, 'respondida_en', q.respondida_en,
                   'espera_horas', round((extract(epoch from coalesce(q.respondida_en, now()) - q.creado) / 3600)::numeric, 1))
                   order by (q.respondida_en is null) desc, q.creado)
                 from (select * from tumbo.preguntas x
                       where x.seller_id = yo.seller_id and x.estado <> 'oculta'
                         and (v_filtro = 'todas' or (v_filtro = 'pendientes') = (x.respondida_en is null))
                       order by x.creado desc limit 200) q
                 left join tumbo.productos p on p.sku = q.sku), '[]'::jsonb),
    'metricas', (select jsonb_build_object('pendientes', count(*) filter (where q.respondida_en is null),
                                           'respondidas_90', count(*) filter (where q.respondida_en is not null),
                                           'mediana_horas', tumbo_privado.respuesta_horas(yo.seller_id))
                 from tumbo.preguntas q where q.seller_id = yo.seller_id and q.estado = 'publicada' and q.creado > now() - interval '90 days'),
    'rapidas', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'titulo', r.titulo, 'texto', r.texto) order by r.titulo)
                         from tumbo.respuestas_rapidas r where r.seller_id = yo.seller_id), '[]'::jsonb));
end $$;

create function public.tm_pregunta_responder(p_sesion text, p_id bigint, p_texto text) returns jsonb
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

-- Respuestas rápidas del comercio (hasta 30): crear, cambiar o borrar.
create function public.tm_respuesta_rapida_guardar(p_sesion text, p_id bigint, p_titulo text, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id bigint;
begin
  if p_id is not null and v_titulo = '' and v_texto = '' then
    delete from tumbo.respuestas_rapidas where id = p_id and seller_id = yo.seller_id;
    if not found then raise exception 'No encontramos esa respuesta rápida.'; end if;
    return jsonb_build_object('ok', true, 'borrada', true);
  end if;
  if char_length(v_titulo) < 2 or char_length(v_titulo) > 60 or char_length(v_texto) < 5 or char_length(v_texto) > 1000 then
    raise exception 'La respuesta rápida lleva un título (2 a 60 caracteres) y un texto (5 a 1.000).';
  end if;
  perform tumbo_privado.texto_publico(v_texto, 'la respuesta rápida');
  if p_id is null then
    if (select count(*) from tumbo.respuestas_rapidas where seller_id = yo.seller_id) >= 30 then
      raise exception 'Tu comercio ya tiene 30 respuestas rápidas: borra alguna antes de crear otra.';
    end if;
    insert into tumbo.respuestas_rapidas (seller_id, titulo, texto) values (yo.seller_id, v_titulo, v_texto)
    on conflict (seller_id, titulo) do update set texto = excluded.texto
    returning id into v_id;
  else
    update tumbo.respuestas_rapidas set titulo = v_titulo, texto = v_texto where id = p_id and seller_id = yo.seller_id
    returning id into v_id;
    if v_id is null then raise exception 'No encontramos esa respuesta rápida.'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Reseñas verificadas y reputación
-- ---------------------------------------------------------------------------
-- ¿Puede la persona reseñar este pedido? Comprador del pedido, entregado y
-- con la ventana de reclamo cerrada (cerrado, o entregado con la ventana
-- vencida), sin reclamo abierto y dentro de los días para reseñar
-- (ajuste comunicacion.dias_resena) desde la entrega. → null si puede, o
-- el motivo.
create function tumbo_privado.resena_impedida(p_yo tumbo.usuarios, v tumbo.pedidos) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg tumbo.config;
begin
  select * into cfg from tumbo.config;
  if v.id is null or p_yo.id is null or v.comprador_id <> p_yo.id then
    return 'No encontramos ese pedido.';
  end if;
  if v.entregado_el is null or not (v.estado = 'cerrado'
     or (v.estado = 'entregado' and v.entregado_el + make_interval(days => cfg.ventana_reclamo_dias) < now())) then
    return 'Podrás calificar el pedido cuando se cierre su ventana de reclamo.';
  end if;
  if exists (select 1 from tumbo.disputas d where d.pedido_id = v.id and d.estado <> 'resuelta') then
    return 'El pedido tiene un reclamo abierto: podrás calificarlo cuando se resuelva.';
  end if;
  if v.entregado_el < now() - make_interval(days => tumbo_privado.comunicacion('dias_resena', 90)::integer) then
    return 'Ya pasó el plazo para calificar este pedido.';
  end if;
  return null;
end $$;

-- Contrato de Catálogo (ola 1 → ola 2): las estrellas salen solo de
-- reseñas reales publicadas. Producto: las de ese SKU.
create or replace function tumbo_privado.reputacion_productos() returns table (sku text, rating numeric, resenas integer)
language sql stable security definer set search_path = '' as $$
  select r.sku, round(avg(r.estrellas)::numeric, 1), count(*)::integer
  from tumbo.resenas r
  where r.sku is not null and r.estado = 'publicada'
  group by r.sku
$$;

-- Comercio: las reseñas del comercio (una por pedido).
create or replace function tumbo_privado.reputacion_sellers() returns table (seller_id text, rating numeric, resenas integer)
language sql stable security definer set search_path = '' as $$
  select r.seller_id, round(avg(r.estrellas)::numeric, 1), count(*)::integer
  from tumbo.resenas r
  where r.sku is null and r.estado = 'publicada'
  group by r.seller_id
$$;

-- Reputación calculada del comercio (últimos 90 días) y su nivel:
--   ventas concretadas (entregadas), despachos a tiempo, reclamos, cancelaciones
--   por su causa, tiempo de respuesta (preguntas y chat) y estrellas.
-- Niveles: nuevo (menos de 5 ventas), excelente, muy_bueno, bueno,
-- en_observacion. Sin datos suficientes no se inventa nada: «nuevo».
create function tumbo_privado.reputacion_comercio(p_seller text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := now() - interval '90 days';
  v_ventas integer;
  v_despachos integer;
  v_a_tiempo integer;
  v_reclamos integer;
  v_reclamos_perdidos integer;
  v_cancel integer;
  v_pedidos integer;
  v_resp numeric;
  v_chat numeric;
  v_rating numeric;
  v_resenas integer;
  v_pct_tiempo numeric;
  v_pct_reclamos numeric;
  v_pct_cancel numeric;
  v_nivel text;
begin
  select count(*) filter (where p.estado in ('entregado', 'cerrado') and p.entregado_el >= v_desde),
         count(*) filter (where p.creado >= v_desde and p.estado <> 'pago_por_verificar' and not (p.estado = 'cancelado' and p.sla_horas is null))
    into v_ventas, v_pedidos
  from tumbo.pedidos p where p.seller_id = p_seller;
  select count(*), count(*) filter (where e.despachado_en <= e.despachar_antes)
    into v_despachos, v_a_tiempo
  from tumbo.envios e
  where e.seller_id = p_seller and e.despachado_en >= v_desde and e.despachar_antes is not null;
  -- perdido: la decisión vigente (después de la apelación, si la hubo) le
  -- costó al comercio, salvo que la revisión le diera la razón
  select count(*), count(*) filter (where coalesce(c.decision, d.resolucion_decision) in ('reembolso', 'reembolso_parcial', 'devolucion')
                                       and c.apelacion_a_favor is distinct from 'comercio')
    into v_reclamos, v_reclamos_perdidos
  from tumbo.disputas d left join tumbo.disputa_casos c on c.disputa_id = d.id
  where d.seller_id = p_seller and d.creado >= v_desde;
  select count(*) into v_cancel from tumbo.cancelaciones c where c.seller_id = p_seller and c.culpa_seller and c.creado >= v_desde;
  v_resp := tumbo_privado.respuesta_horas(p_seller);
  -- chat: horas entre un mensaje del comprador y la siguiente respuesta del comercio
  select round((percentile_cont(0.5) within group (order by extract(epoch from r.creado - c.creado) / 3600))::numeric, 1) into v_chat
  from tumbo.chat_mensajes c
  join tumbo.pedidos p on p.id = c.pedido_id and p.seller_id = p_seller
  cross join lateral (select x.creado from tumbo.chat_mensajes x
                      where x.pedido_id = c.pedido_id and x.id > c.id and x.lado = 'comercio' order by x.id limit 1) r
  where c.lado = 'comprador' and c.creado >= v_desde
    and not exists (select 1 from tumbo.chat_mensajes y where y.pedido_id = c.pedido_id and y.id < c.id and y.id > coalesce(
          (select max(z.id) from tumbo.chat_mensajes z where z.pedido_id = c.pedido_id and z.id < c.id and z.lado = 'comercio'), 0)
          and y.lado = 'comprador');
  select rs.rating, rs.resenas into v_rating, v_resenas from tumbo_privado.reputacion_sellers() rs where rs.seller_id = p_seller;
  v_pct_tiempo := case when v_despachos > 0 then round(100.0 * v_a_tiempo / v_despachos) end;
  v_pct_reclamos := case when v_pedidos > 0 then round(100.0 * v_reclamos_perdidos / v_pedidos, 1) end;
  v_pct_cancel := case when v_pedidos > 0 then round(100.0 * v_cancel / v_pedidos, 1) end;
  v_nivel := case
    when coalesce(v_ventas, 0) < 5 then 'nuevo'
    when coalesce(v_pct_tiempo, 100) >= 95 and coalesce(v_pct_reclamos, 0) <= 2 and coalesce(v_pct_cancel, 0) <= 2
         and coalesce(v_rating, 5) >= 4.5 and coalesce(least(v_resp, v_chat), 0) <= 12 then 'excelente'
    when coalesce(v_pct_tiempo, 100) >= 90 and coalesce(v_pct_reclamos, 0) <= 5 and coalesce(v_pct_cancel, 0) <= 5
         and coalesce(v_rating, 5) >= 4 then 'muy_bueno'
    when coalesce(v_pct_tiempo, 100) >= 80 and coalesce(v_pct_reclamos, 0) <= 10 and coalesce(v_pct_cancel, 0) <= 10
         and coalesce(v_rating, 5) >= 3.5 then 'bueno'
    else 'en_observacion' end;
  return jsonb_build_object('seller', p_seller, 'nivel', v_nivel,
    'nivel_nombre', case v_nivel when 'nuevo' then 'Comercio nuevo' when 'excelente' then 'Reputación excelente'
                                 when 'muy_bueno' then 'Muy buena reputación' when 'bueno' then 'Buena reputación'
                                 else 'En observación' end,
    'ventas_90', coalesce(v_ventas, 0), 'pedidos_90', coalesce(v_pedidos, 0),
    'a_tiempo_pct', v_pct_tiempo, 'despachos_90', coalesce(v_despachos, 0),
    'reclamos_90', coalesce(v_reclamos, 0), 'reclamos_perdidos_pct', v_pct_reclamos,
    'cancelaciones_90', coalesce(v_cancel, 0), 'cancelaciones_pct', v_pct_cancel,
    'respuesta_preguntas_horas', v_resp, 'respuesta_chat_horas', v_chat,
    'rating', v_rating, 'resenas', coalesce(v_resenas, 0));
end $$;

-- Pública: la reputación de un comercio aprobado.
create function public.tm_reputacion(p_seller text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from tumbo.sellers s where s.id = p_seller and s.estado = 'aprobado') then
    return jsonb_build_object('error', 'Comercio no disponible.');
  end if;
  return tumbo_privado.reputacion_comercio(p_seller);
end $$;

-- Una reseña como la ve el público.
create function tumbo_privado.resena_json(r tumbo.resenas, p_yo uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'sku', r.sku, 'estrellas', r.estrellas, 'calidad', r.calidad, 'empaque', r.empaque,
    'entrega', r.entrega, 'texto', r.texto, 'fotos', tumbo_privado.archivos_json(r.fotos::text[]),
    'autor', tumbo_privado.autor_publico(r.comprador_id), 'creado', r.creado, 'verificada', true,
    'mia', coalesce(r.comprador_id = p_yo, false), 'estado', case when r.comprador_id = p_yo then r.estado end,
    'respuesta', case when r.respuesta_estado = 'publicada' then jsonb_build_object('texto', r.respuesta, 'fecha', r.respondida_en) end,
    'producto', case when r.sku is not null then (select p.nombre from tumbo.productos p where p.sku = r.sku) end)
$$;

-- Reseñas públicas de un producto (p_tipo 'producto', p_id = SKU) o de un
-- comercio ('seller'), con el resumen (promedio, distribución y aspectos),
-- 10 por página.
create function public.tm_resenas(p_sesion text, p_tipo text, p_id text, p_pagina integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_pag integer := greatest(coalesce(p_pagina, 1), 1);
  v_res jsonb;
  v jsonb;
  v_total integer;
begin
  if p_tipo not in ('producto', 'seller') then
    return jsonb_build_object('error', 'Tipo de reseña desconocido.');
  end if;
  select jsonb_build_object('total', count(*), 'promedio', round(avg(r.estrellas)::numeric, 1),
           'distribucion', jsonb_build_object('5', count(*) filter (where r.estrellas = 5), '4', count(*) filter (where r.estrellas = 4),
                                              '3', count(*) filter (where r.estrellas = 3), '2', count(*) filter (where r.estrellas = 2),
                                              '1', count(*) filter (where r.estrellas = 1)),
           'calidad', round(avg(r.calidad)::numeric, 1), 'empaque', round(avg(r.empaque)::numeric, 1),
           'entrega', round(avg(r.entrega)::numeric, 1))
    into v_res
  from tumbo.resenas r
  where r.estado = 'publicada' and ((p_tipo = 'producto' and r.sku = p_id) or (p_tipo = 'seller' and r.seller_id = p_id and r.sku is null));
  -- las páginas, con el mismo filtro que la lista (en la tienda del comercio
  -- van también las reseñas de sus productos que tienen texto)
  select count(*) into v_total
  from tumbo.resenas r
  where (r.estado = 'publicada' or (yo.id is not null and r.comprador_id = yo.id and r.estado = 'revision'))
    and ((p_tipo = 'producto' and r.sku = p_id) or (p_tipo = 'seller' and r.seller_id = p_id and (r.sku is null or r.texto is not null)));
  -- aspectos del comercio (empaque, entrega) también en la ficha del producto
  if p_tipo = 'producto' then
    v_res := v_res || (select jsonb_build_object('empaque', round(avg(r.empaque)::numeric, 1), 'entrega', round(avg(r.entrega)::numeric, 1))
                       from tumbo.resenas r join tumbo.productos p on p.sku = p_id
                       where r.sku is null and r.estado = 'publicada' and r.seller_id = p.seller_id);
  end if;
  select coalesce(jsonb_agg(tumbo_privado.resena_json(r, yo.id) order by r.creado desc, r.id desc), '[]'::jsonb) into v
  from (select * from tumbo.resenas r
        where (r.estado = 'publicada' or (yo.id is not null and r.comprador_id = yo.id and r.estado = 'revision'))
          and ((p_tipo = 'producto' and r.sku = p_id) or (p_tipo = 'seller' and r.seller_id = p_id and (r.sku is null or r.texto is not null)))
        order by r.creado desc, r.id desc offset (v_pag - 1) * 10 limit 10) r;
  return jsonb_build_object('resumen', v_res, 'resenas', v, 'pagina', v_pag, 'paginas', greatest(1, ceil(v_total / 10.0)::integer),
                            'total_lista', v_total);
end $$;

-- Los pedidos que el comprador puede calificar (y lo que ya calificó).
create function public.tm_resenas_pendientes(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'pedido', p.id, 'seller', p.seller_id, 'comercio', s.nombre, 'entregado', p.entregado_el,
             'vence', p.entregado_el + make_interval(days => tumbo_privado.comunicacion('dias_resena', 90)::integer),
             'comercio_resenado', exists (select 1 from tumbo.resenas r where r.pedido_id = p.id and r.sku is null),
             'items', (select jsonb_agg(jsonb_build_object('sku', i.sku, 'nombre', i.nombre, 'img', i.img,
                              'resenado', exists (select 1 from tumbo.resenas r where r.pedido_id = p.id and r.sku = i.sku)) order by i.sku)
                       from tumbo.pedido_items i where i.pedido_id = p.id)) order by p.entregado_el desc)
    from tumbo.pedidos p join tumbo.sellers s on s.id = p.seller_id
    where p.comprador_id = yo.id and tumbo_privado.resena_impedida(yo, p) is null
      and ((select count(*) from tumbo.resenas r where r.pedido_id = p.id)
           < (select count(*) from tumbo.pedido_items i where i.pedido_id = p.id) + 1)), '[]'::jsonb);
end $$;

-- Califica un pedido: p_datos = {productos: [{sku, estrellas, calidad, texto, fotos}],
-- comercio: {estrellas, empaque, entrega, texto}} (se puede calificar una
-- parte y el resto después). Fotos: hasta 4 por producto, subidas con el
-- propósito «resena» para el pedido.
create function public.tm_resena_crear(p_sesion text, p_pedido text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos;
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  x jsonb;
  c jsonb := d -> 'comercio';
  v_motivo text;
  v_texto text;
  v_estado text;
  v_fotos uuid[];
  v_ids bigint[] := '{}';
  v_id bigint;
  v_rev boolean := false;
  u record;
  v_min integer;
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'resenas');
  select * into v from tumbo.pedidos where id = p_pedido;
  v_motivo := tumbo_privado.resena_impedida(yo, v);
  if v_motivo is not null then
    raise exception '%', v_motivo;
  end if;
  perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.seller_real(v.seller_id));
  if (jsonb_typeof(d -> 'productos') is distinct from 'array' or jsonb_array_length(d -> 'productos') = 0)
     and jsonb_typeof(c) is distinct from 'object' then
    raise exception 'Califica al menos un producto o al comercio.';
  end if;
  if jsonb_typeof(d -> 'productos') = 'array' and jsonb_array_length(d -> 'productos') > 30 then
    raise exception 'Demasiados productos en una sola calificación.';
  end if;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(d -> 'productos') = 'array' then d -> 'productos' else '[]'::jsonb end) loop
    if not exists (select 1 from tumbo.pedido_items i where i.pedido_id = v.id and i.sku = x ->> 'sku') then
      raise exception 'Ese producto no es de este pedido.';
    end if;
    if exists (select 1 from tumbo.resenas r where r.pedido_id = v.id and r.sku = x ->> 'sku') then
      raise exception 'Ya calificaste ese producto de este pedido.';
    end if;
    if jsonb_typeof(x -> 'estrellas') <> 'number' or (x ->> 'estrellas')::numeric not in (1, 2, 3, 4, 5)
       or (x ? 'calidad' and jsonb_typeof(x -> 'calidad') <> 'null' and (jsonb_typeof(x -> 'calidad') <> 'number' or (x ->> 'calidad')::numeric not in (1, 2, 3, 4, 5))) then
      raise exception 'Elige de 1 a 5 estrellas.';
    end if;
    v_texto := nullif(btrim(coalesce(x ->> 'texto', '')), '');
    if char_length(v_texto) > 1500 then
      raise exception 'La reseña puede tener hasta 1.500 caracteres.';
    end if;
    v_estado := case when v_texto is null then 'publicada' else tumbo_privado.texto_publico(v_texto, 'la reseña') end;
    begin
      v_fotos := coalesce((select array_agg(f::uuid) from jsonb_array_elements_text(case when jsonb_typeof(x -> 'fotos') = 'array' then x -> 'fotos' else '[]'::jsonb end) f), '{}');
    exception when others then
      raise exception 'Las fotos de la reseña no son válidas.';
    end;
    if cardinality(v_fotos) > 4 or not tumbo_privado.archivos_propios(v_fotos::text[], yo.id, array['resena'], array[v.id]) then
      raise exception 'Adjunta hasta 4 fotos subidas para este pedido.';
    end if;
    insert into tumbo.resenas (pedido_id, sku, seller_id, comprador_id, estrellas, calidad, texto, fotos, estado)
    values (v.id, x ->> 'sku', v.seller_id, yo.id, (x ->> 'estrellas')::smallint, nullif(x ->> 'calidad', '')::smallint, v_texto, v_fotos, v_estado)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_rev := v_rev or v_estado = 'revision';
  end loop;
  if jsonb_typeof(c) = 'object' then
    if exists (select 1 from tumbo.resenas r where r.pedido_id = v.id and r.sku is null) then
      raise exception 'Ya calificaste al comercio de este pedido.';
    end if;
    if jsonb_typeof(c -> 'estrellas') <> 'number' or (c ->> 'estrellas')::numeric not in (1, 2, 3, 4, 5)
       or exists (select 1 from unnest(array['empaque', 'entrega']) k
                  where c ? k and jsonb_typeof(c -> k) <> 'null' and (jsonb_typeof(c -> k) <> 'number' or (c ->> k)::numeric not in (1, 2, 3, 4, 5))) then
      raise exception 'Elige de 1 a 5 estrellas para el comercio.';
    end if;
    v_texto := nullif(btrim(coalesce(c ->> 'texto', '')), '');
    if char_length(v_texto) > 1500 then
      raise exception 'La reseña puede tener hasta 1.500 caracteres.';
    end if;
    v_estado := case when v_texto is null then 'publicada' else tumbo_privado.texto_publico(v_texto, 'la reseña') end;
    insert into tumbo.resenas (pedido_id, sku, seller_id, comprador_id, estrellas, empaque, entrega, texto, estado)
    values (v.id, null, v.seller_id, yo.id, (c ->> 'estrellas')::smallint, nullif(c ->> 'empaque', '')::smallint,
            nullif(c ->> 'entrega', '')::smallint, v_texto, v_estado)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_rev := v_rev or v_estado = 'revision';
  end if;
  select min(estrellas) into v_min from tumbo.resenas where id = any (v_ids);
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Recibiste una reseña del pedido ' || v.id || ' (' || v_min || '★ o más)', 'reviews',
    'seller/resenas.html');
  for u in select x2.id from tumbo.usuarios x2 where x2.seller_id = v.seller_id and x2.rol = 'seller' and x2.activo order by x2.id loop
    perform tumbo_privado.encolar(u.id, 'resena_nueva', jsonb_build_object('pedido', v.id, 'estrellas', v_min, 'enlace', 'app/seller/resenas.html'));
  end loop;
  if v_rev then
    perform tumbo_privado.notificar('rol:ops', 'Reseña en revisión del pedido ' || v.id, 'flag', 'admin/contenido.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Reseña publicada', v.id || ' · ' || cardinality(v_ids) || ' calificación(es)');
  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids), 'revision', v_rev);
end $$;

-- Las reseñas que recibió el comercio (para responder).
create function public.tm_resenas_seller(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'operador']);
begin
  return jsonb_build_object(
    'resenas', coalesce((select jsonb_agg(tumbo_privado.resena_json(r, null) || jsonb_build_object('pedido', r.pedido_id,
                           'estado', r.estado, 'respuesta_estado', r.respuesta_estado,
                           'respuesta_texto', case when r.respuesta_estado <> 'oculta' then r.respuesta end)
                         order by (r.respuesta is null) desc, r.creado desc)
                         from (select * from tumbo.resenas x where x.seller_id = yo.seller_id and x.estado <> 'oculta'
                               order by x.creado desc limit 200) r), '[]'::jsonb),
    'reputacion', tumbo_privado.reputacion_comercio(yo.seller_id),
    'puede_responder', yo.rol = 'seller');
end $$;

-- El seller principal responde en público (una vez).
create function public.tm_resena_responder(p_sesion text, p_id bigint, p_texto text) returns jsonb
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

-- Al cerrarse la ventana de reclamo de un pedido entregado, se invita al
-- comprador a calificarlo (campana y bandeja). Un fallo aquí nunca deshace
-- el cierre de la ventana.
create function tumbo_privado.pedido_invitar_resena() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s tumbo.sellers;
begin
  begin
    select * into s from tumbo.sellers where id = new.seller_id;
    perform tumbo_privado.notificar('usr:' || new.comprador_id, '¿Cómo te fue con tu pedido ' || new.id || '? Califícalo y ayuda a otros compradores',
      'reviews', 'tienda/resenas.html');
    perform tumbo_privado.encolar(new.comprador_id, 'resena_pendiente', jsonb_build_object('pedido', new.id, 'comercio', s.nombre,
      'enlace', 'app/tienda/resenas.html'));
  exception when others then
    raise warning 'comunicación: no se invitó a reseñar % (%)', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger pedidos_invitar_resena
  after update of estado on tumbo.pedidos
  for each row when (old.estado = 'entregado' and new.estado = 'cerrado')
  execute function tumbo_privado.pedido_invitar_resena();

-- ---------------------------------------------------------------------------
-- Documentos legales y su aceptación
-- ---------------------------------------------------------------------------
-- La versión vigente de cada documento: la más reciente ya en vigor cuyo
-- texto está publicado en el centro de ayuda (una versión sin su texto no
-- rige ni se acepta: nadie acepta lo que no pudo leer).
create function tumbo_privado.legal_vigente(p_clave text) returns tumbo.documentos_legales
language sql stable security definer set search_path = '' as $$
  select * from tumbo.documentos_legales d
  where d.clave = p_clave and d.vigente_desde <= now() and d.texto_publicado
  order by d.vigente_desde desc, d.creado desc limit 1
$$;

-- ¿Aceptó la persona esa versión? Los términos también cuentan si los
-- aceptó al registrarse (Cuentas guarda la versión en usuarios).
create function tumbo_privado.legal_aceptado(p_yo tumbo.usuarios, p_clave text, p_version text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.aceptaciones_legales a where a.usuario_id = p_yo.id and a.clave = p_clave and a.version = p_version)
      or coalesce(p_clave = 'terminos' and p_yo.terminos_version = p_version, false)
$$;

-- Al crear la cuenta (registro o invitación, de Cuentas) la persona marca
-- «Acepto los términos y las políticas de privacidad»: Cuentas guarda la
-- versión de los términos en la cuenta y aquí queda constancia de las dos
-- (la de privacidad, la vigente en ese momento). tm_legal_aceptar, que
-- también escribe la versión de los términos en la cuenta, se marca para
-- no acreditar la privacidad que la persona no aceptó ahí.
create function tumbo_privado.usuario_acepto_registro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_priv tumbo.documentos_legales;
begin
  if coalesce(current_setting('tumbo.legal_aceptando', true), '') = '1' or tumbo_privado.cuenta_demo(new.email) then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.terminos_version is not distinct from new.terminos_version
     and old.terminos_fecha is not distinct from new.terminos_fecha then
    return null;
  end if;
  v_priv := tumbo_privado.legal_vigente('privacidad');
  insert into tumbo.aceptaciones_legales (usuario_id, clave, version, red)
  select new.id, k.clave, k.version, tumbo_privado.ip_cliente()
  from (values ('terminos', new.terminos_version), ('privacidad', v_priv.version)) k (clave, version)
  where k.version is not null
  on conflict do nothing;
  return null;
end $$;

create trigger usuarios_acepto_registro
  after insert or update of terminos_version, terminos_fecha on tumbo.usuarios
  for each row when (new.terminos_version is not null)
  execute function tumbo_privado.usuario_acepto_registro();

-- Público: los documentos vigentes (y, con sesión, lo que falta aceptar:
-- «previa» dice si la persona ya había aceptado otra versión, para no
-- decirle «actualizamos» a quien nunca lo aceptó). Al superadministrador
-- real le llegan además las versiones que esperan su texto.
create function public.tm_legales(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('clave', d.clave, 'version', d.version, 'titulo', d.titulo,
           'vigente_desde', d.vigente_desde, 'resumen', d.resumen, 'borrador', d.borrador,
           'requiere', yo.id is not null and yo.rol = any (d.roles),
           'aceptado', case when yo.id is not null and yo.rol = any (d.roles) then tumbo_privado.legal_aceptado(yo, d.clave, d.version) end,
           'previa', case when yo.id is not null and yo.rol = any (d.roles) then
                       exists (select 1 from tumbo.aceptaciones_legales a where a.usuario_id = yo.id and a.clave = d.clave and a.version <> d.version)
                       or coalesce(d.clave = 'terminos' and yo.terminos_version <> d.version, false) end)
           order by d.clave), '[]'::jsonb) into v
  from (select distinct on (x.clave) x.* from tumbo.documentos_legales x where x.vigente_desde <= now() and x.texto_publicado
        order by x.clave, x.vigente_desde desc, x.creado desc) d;
  return jsonb_build_object('documentos', v,
    'pendientes', coalesce((select jsonb_agg(e) from jsonb_array_elements(v) e
                            where (e ->> 'requiere')::boolean and not (e ->> 'aceptado')::boolean), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('clave', h.clave, 'version', h.version, 'vigente_desde', h.vigente_desde,
                                                              'resumen', h.resumen) order by h.clave, h.vigente_desde desc)
                           from tumbo.documentos_legales h where h.texto_publicado), '[]'::jsonb),
    'por_publicar', case when yo.rol = 'superadmin' and not tumbo_privado.cuenta_demo(yo.email) then
                      coalesce((select jsonb_agg(jsonb_build_object('clave', h.clave, 'version', h.version, 'titulo', h.titulo,
                                  'vigente_desde', h.vigente_desde, 'resumen', h.resumen, 'publicado_por', h.publicado_por) order by h.creado)
                                from tumbo.documentos_legales h where not h.texto_publicado), '[]'::jsonb) end,
    -- los plazos vigentes que cita el centro de ayuda (no inventa números)
    'plazos', jsonb_build_object(
      'ventana_reclamo_dias', (select c.ventana_reclamo_dias from tumbo.config c limit 1),
      'horas_respuesta_reclamo', tumbo_privado.comunicacion('horas_respuesta_reclamo', 72),
      'horas_evidencia', tumbo_privado.comunicacion('horas_evidencia', 48),
      'dias_apelacion', tumbo_privado.comunicacion('dias_apelacion', 5),
      'dias_resena', tumbo_privado.comunicacion('dias_resena', 90),
      'sla_soporte', jsonb_build_object('alta', tumbo_privado.sla_soporte_horas('alta'), 'normal', tumbo_privado.sla_soporte_horas('normal'),
                                        'baja', tumbo_privado.sla_soporte_horas('baja'))));
end $$;

-- Acepta la versión vigente de un documento (la de los términos queda
-- también en la cuenta, donde la registra Cuentas). p_version es la versión
-- del texto que la persona leyó en la página: si no es la vigente, no se
-- acepta.
create function public.tm_legal_aceptar(p_sesion text, p_clave text, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  d tumbo.documentos_legales := tumbo_privado.legal_vigente(p_clave);
begin
  if d.clave is null then
    raise exception 'Ese documento no existe.';
  end if;
  if d.version is distinct from p_version then
    raise exception 'La versión vigente de «%» es otra: recarga la página para leerla antes de aceptarla.', d.titulo;
  end if;
  if not (yo.rol = any (d.roles)) then
    raise exception 'Este documento no se acepta desde tu cuenta.';
  end if;
  insert into tumbo.aceptaciones_legales (usuario_id, clave, version, red)
  values (yo.id, d.clave, d.version, tumbo_privado.ip_cliente())
  on conflict do nothing;
  if d.clave = 'terminos' and not tumbo_privado.cuenta_demo(yo.email) then
    perform set_config('tumbo.legal_aceptando', '1', true);
    update tumbo.usuarios set terminos_version = d.version, terminos_fecha = now() where id = yo.id;
    perform set_config('tumbo.legal_aceptando', '', true);
  end if;
  perform tumbo_privado.auditar(yo, 'Documento legal aceptado', d.clave || ' ' || d.version);
  return jsonb_build_object('ok', true, 'clave', d.clave, 'version', d.version);
end $$;

-- Una versión que ya rige con su texto publicado: si es de los términos,
-- pasa a ser la del registro (ajuste terminos_version de Cuentas), y a
-- quienes deben aceptarla les llega el aviso (hasta 5.000). → avisados.
create function tumbo_privado.legal_entra_en_vigor(d tumbo.documentos_legales, p_yo tumbo.usuarios) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  u record;
  n integer := 0;
begin
  if d.clave = 'terminos' and d.vigente_desde <= now() then
    update tumbo.ajustes set valor = to_jsonb(d.version), actualizado = now(), por = tumbo_privado.actor(p_yo)
    where clave = 'terminos_version' and valor is distinct from to_jsonb(d.version);
  end if;
  for u in select x.id from tumbo.usuarios x where x.activo and x.rol = any (d.roles) order by x.creado desc limit 5000 loop
    perform tumbo_privado.encolar(u.id, 'legal_actualizado', jsonb_build_object('documento', d.titulo,
      'version', d.version, 'desde', tumbo_privado.fecha_legible(d.vigente_desde), 'resumen', coalesce(d.resumen, ''),
      'enlace', 'app/ayuda/' || replace(d.clave, '_', '-') || '.html'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- El superadministrador real publica una versión nueva. p_datos =
-- {clave, version, titulo?, resumen, vigente_desde?, borrador,
-- texto_publicado}: con texto_publicado (su texto ya está desplegado en el
-- centro de ayuda) rige desde vigente_desde y se avisa; sin él queda
-- guardada hasta que se marque con tm_legal_texto_publicado.
create function public.tm_legal_publicar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_clave text := d ->> 'clave';
  v_version text := btrim(coalesce(d ->> 'version', ''));
  v_desde timestamptz;
  v_ant tumbo.documentos_legales;
  v_nuevo tumbo.documentos_legales;
  v_listo boolean := coalesce((d ->> 'texto_publicado')::boolean, false);
  n integer := 0;
begin
  perform tumbo_privado.exigir_elevada(yo);
  v_ant := tumbo_privado.legal_vigente(v_clave);
  if v_ant.clave is null then
    raise exception 'Ese documento no existe.';
  end if;
  if v_version !~ '^[A-Za-z0-9._-]{3,40}$' then
    raise exception 'La versión va con letras, números, punto, guion o guion bajo (3 a 40).';
  end if;
  if exists (select 1 from tumbo.documentos_legales where clave = v_clave and version = v_version) then
    raise exception 'Esa versión ya existe.';
  end if;
  begin
    v_desde := coalesce(nullif(d ->> 'vigente_desde', '')::timestamptz, now());
  exception when others then
    raise exception 'La fecha de vigencia no es válida.';
  end;
  if v_desde < now() - interval '1 minute' then
    raise exception 'Una versión nueva no puede regir desde el pasado.';
  end if;
  insert into tumbo.documentos_legales (clave, version, titulo, vigente_desde, resumen, roles, borrador, texto_publicado, publicado_por)
  values (v_clave, v_version, coalesce(nullif(left(d ->> 'titulo', 120), ''), v_ant.titulo), v_desde,
          nullif(left(btrim(coalesce(d ->> 'resumen', '')), 600), ''), v_ant.roles,
          coalesce((d ->> 'borrador')::boolean, true), v_listo, tumbo_privado.actor(yo))
  returning * into v_nuevo;
  if v_listo then
    n := tumbo_privado.legal_entra_en_vigor(v_nuevo, yo);
  end if;
  perform tumbo_privado.auditar(yo, 'Documento legal publicado', v_clave || ' ' || v_version || ' desde ' || tumbo_privado.fecha_legible(v_desde) ||
    case when v_listo then '' else ' (espera su texto en el centro de ayuda)' end);
  return jsonb_build_object('ok', true, 'avisados', n, 'texto_publicado', v_listo);
end $$;

-- El texto de una versión ya está en el centro de ayuda (el sitio se
-- desplegó con él): desde ahora rige (si ya llegó su fecha) y se avisa.
create function public.tm_legal_texto_publicado(p_sesion text, p_clave text, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  d tumbo.documentos_legales;
  n integer;
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into d from tumbo.documentos_legales where clave = p_clave and version = p_version for update;
  if not found then
    raise exception 'Esa versión no existe.';
  end if;
  if d.texto_publicado then
    raise exception 'El texto de esa versión ya estaba marcado como publicado.';
  end if;
  update tumbo.documentos_legales set texto_publicado = true where clave = p_clave and version = p_version
  returning * into d;
  n := tumbo_privado.legal_entra_en_vigor(d, yo);
  perform tumbo_privado.auditar(yo, 'Texto legal publicado', d.clave || ' ' || d.version);
  return jsonb_build_object('ok', true, 'avisados', n);
end $$;

-- ---------------------------------------------------------------------------
-- Denuncias
-- ---------------------------------------------------------------------------
create function public.tm_denunciar(p_sesion text, p_tipo text, p_objeto text, p_motivo text, p_detalle text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador']);
  v_seller text;
  v_detalle text := nullif(left(btrim(coalesce(p_detalle, '')), 1000), '');
  v_id bigint;
begin
  if p_tipo is null or p_tipo not in ('producto', 'seller', 'pregunta', 'resena') then
    raise exception 'Indica qué quieres reportar.';
  end if;
  if p_motivo is null or p_motivo not in ('falsificacion', 'prohibido', 'engano', 'precio', 'contacto', 'ofensivo', 'fraude', 'otro') then
    raise exception 'Elige el motivo del reporte.';
  end if;
  if p_motivo = 'otro' and char_length(coalesce(v_detalle, '')) < 10 then
    raise exception 'Cuéntanos el motivo con al menos 10 caracteres.';
  end if;
  v_seller := case p_tipo
    when 'producto' then (select p.seller_id from tumbo.productos p where p.sku = p_objeto and p.estado = 'publicado')
    when 'seller' then (select s.id from tumbo.sellers s where s.id = p_objeto and s.estado = 'aprobado')
    when 'pregunta' then (select q.seller_id from tumbo.preguntas q where q.id::text = p_objeto and q.estado = 'publicada')
    else (select r.seller_id from tumbo.resenas r where r.id::text = p_objeto and r.estado = 'publicada') end;
  if v_seller is null then
    raise exception 'No encontramos lo que quieres reportar.';
  end if;
  if yo.seller_id is not null and yo.seller_id = v_seller and p_tipo in ('producto', 'seller') then
    raise exception 'No puedes reportar tu propio comercio.';
  end if;
  -- una cuenta de prueba no reporta a un comercio real ni lo que escribió una persona real (la cola es del equipo real)
  perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.seller_real(v_seller)
    or (p_tipo = 'pregunta' and tumbo_privado.comprador_real((select q.autor_id from tumbo.preguntas q where q.id::text = p_objeto)))
    or (p_tipo = 'resena' and tumbo_privado.comprador_real((select r.comprador_id from tumbo.resenas r where r.id::text = p_objeto))));
  perform tumbo_privado.bloquear_usuario(yo.id, 'denuncias');
  if exists (select 1 from tumbo.denuncias where autor_id = yo.id and tipo = p_tipo and objeto = p_objeto and estado = 'abierta') then
    raise exception 'Ya reportaste esto: el equipo lo está revisando.';
  end if;
  if (select count(*) from tumbo.denuncias where autor_id = yo.id and creado > now() - interval '1 day') >= 10 then
    raise exception 'Llegaste al máximo de 10 reportes por día.';
  end if;
  insert into tumbo.denuncias (tipo, objeto, seller_id, motivo, detalle, autor_id)
  values (p_tipo, p_objeto, v_seller, p_motivo, v_detalle, yo.id)
  returning id into v_id;
  perform tumbo_privado.notificar('rol:superadmin', 'Denuncia nueva (' || p_tipo || ' ' || p_objeto || ')', 'flag', 'admin/contenido.html');
  perform tumbo_privado.auditar(yo, 'Denuncia', '#' || v_id || ' ' || p_tipo || ' ' || p_objeto || ' · ' || p_motivo);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ¿Puede esta persona del equipo moderar contenido y cerrar denuncias?
create function tumbo_privado.exigir_contenido(p_yo tumbo.usuarios) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not tumbo_privado.tiene_permiso(p_yo, 'contenido') then
    raise exception 'Tu rol no permite moderar contenido.' using errcode = '42501';
  end if;
end $$;

-- La cola de contenido: preguntas, respuestas y reseñas apartadas por la
-- moderación automática y las denuncias abiertas. Una cuenta de prueba solo
-- ve el contenido de la demo (cuentas y comercios de prueba).
create function public.tm_contenido_cola(p_sesion text, p_filtro text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops', 'finanzas']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  v_filtro text := coalesce(nullif(p_filtro, ''), 'abiertas');
begin
  -- una lectura: sin el permiso responde {error} (la página lo explica)
  if not tumbo_privado.tiene_permiso(yo, 'contenido') then
    return jsonb_build_object('error', 'Tu rol no tiene el permiso «contenido»: pídeselo al superadministrador.', 'sin_permiso', true);
  end if;
  return jsonb_build_object(
    'revision', coalesce((select jsonb_agg(x order by x ->> 'creado') from (
        select jsonb_build_object('tipo', 'pregunta', 'id', q.id, 'sku', q.sku, 'seller', q.seller_id, 'texto', q.texto, 'creado', q.creado,
                                  'producto', (select p.nombre from tumbo.productos p where p.sku = q.sku)) as x
        from tumbo.preguntas q where q.estado = 'revision'
          and (not v_demo or (not tumbo_privado.comprador_real(q.autor_id) and not tumbo_privado.seller_real(q.seller_id)))
        union all
        select jsonb_build_object('tipo', 'respuesta', 'id', q.id, 'sku', q.sku, 'seller', q.seller_id, 'texto', q.respuesta,
                                  'pregunta', q.texto, 'creado', q.respondida_en)
        from tumbo.preguntas q where q.respuesta_estado = 'revision' and (not v_demo or not tumbo_privado.seller_real(q.seller_id))
        union all
        select jsonb_build_object('tipo', 'resena', 'id', r.id, 'sku', r.sku, 'seller', r.seller_id, 'texto', r.texto, 'estrellas', r.estrellas,
                                  'creado', r.creado)
        from tumbo.resenas r where r.estado = 'revision'
          and (not v_demo or (not tumbo_privado.comprador_real(r.comprador_id) and not tumbo_privado.seller_real(r.seller_id)))
        union all
        select jsonb_build_object('tipo', 'resena_respuesta', 'id', r.id, 'sku', r.sku, 'seller', r.seller_id, 'texto', r.respuesta,
                                  'creado', r.respondida_en)
        from tumbo.resenas r where r.respuesta_estado = 'revision' and (not v_demo or not tumbo_privado.seller_real(r.seller_id))
        limit 300) t), '[]'::jsonb),
    'denuncias', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'objeto', d.objeto, 'seller', d.seller_id,
                             'comercio', (select s.nombre from tumbo.sellers s where s.id = d.seller_id),
                             'producto', case when d.tipo = 'producto' then (select p.nombre from tumbo.productos p where p.sku = d.objeto) end,
                             'motivo', d.motivo, 'detalle', d.detalle, 'estado', d.estado, 'resolucion', d.resolucion, 'nota', d.nota,
                             'cerrada_por', d.cerrada_por, 'cerrada_en', d.cerrada_en, 'creado', d.creado,
                             'reportes', (select count(*) from tumbo.denuncias o where o.tipo = d.tipo and o.objeto = d.objeto and o.estado = 'abierta'))
                           order by d.creado)
                           from (select * from tumbo.denuncias x
                                 where (v_filtro = 'todas' or x.estado = 'abierta')
                                   and (not v_demo or (not tumbo_privado.comprador_real(x.autor_id) and not tumbo_privado.seller_real(x.seller_id)))
                                 order by x.creado desc limit 300) d), '[]'::jsonb));
end $$;

-- Publica u oculta una pregunta, una respuesta, una reseña o la respuesta a
-- una reseña (con motivo al ocultar). Las fotos de una reseña oculta se
-- descartan.
create function public.tm_contenido_moderar(p_sesion text, p_tipo text, p_id bigint, p_accion text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  v_motivo text := nullif(left(btrim(coalesce(p_motivo, '')), 300), '');
  q tumbo.preguntas;
  r tumbo.resenas;
  v_estado text;
  p tumbo.productos;
begin
  perform tumbo_privado.exigir_contenido(yo);
  if p_accion is null or p_accion not in ('publicar', 'ocultar') then
    raise exception 'Indica si se publica o se oculta.';
  end if;
  if p_accion = 'ocultar' and char_length(coalesce(v_motivo, '')) < 5 then
    raise exception 'Explica por qué se oculta (queda en la auditoría).';
  end if;
  v_estado := case p_accion when 'publicar' then 'publicada' else 'oculta' end;
  if p_tipo in ('pregunta', 'respuesta') then
    select * into q from tumbo.preguntas where id = p_id for update;
    if not found or (p_tipo = 'respuesta' and q.respuesta is null) then
      raise exception 'No encontramos ese contenido.';
    end if;
    perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.comprador_real(q.autor_id) or tumbo_privado.seller_real(q.seller_id));
    if p_tipo = 'pregunta' then
      update tumbo.preguntas set estado = v_estado, moderada_por = yo.nombre || ' (' || yo.rol || ')', moderacion_motivo = v_motivo, moderada_en = now()
      where id = p_id;
      if v_estado = 'publicada' and q.estado = 'revision' then
        select * into p from tumbo.productos where sku = q.sku;
        perform tumbo_privado.notificar('seller:' || q.seller_id, 'Te preguntaron sobre «' || left(coalesce(p.nombre, q.sku), 60) || '»', 'help',
          'seller/preguntas.html', array['seller', 'operador']);
      end if;
    else
      update tumbo.preguntas set respuesta_estado = v_estado, moderada_por = yo.nombre || ' (' || yo.rol || ')', moderacion_motivo = v_motivo, moderada_en = now()
      where id = p_id;
      if v_estado = 'publicada' and q.respuesta_estado = 'revision' and q.autor_id is not null then
        perform tumbo_privado.notificar('usr:' || q.autor_id, 'Respondieron tu pregunta sobre ' || q.sku, 'help', 'tienda/producto.html?sku=' || q.sku);
      end if;
    end if;
  elsif p_tipo in ('resena', 'resena_respuesta') then
    select * into r from tumbo.resenas where id = p_id for update;
    if not found or (p_tipo = 'resena_respuesta' and r.respuesta is null) then
      raise exception 'No encontramos ese contenido.';
    end if;
    perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.comprador_real(r.comprador_id) or tumbo_privado.seller_real(r.seller_id));
    if p_tipo = 'resena' then
      update tumbo.resenas set estado = v_estado, moderada_por = yo.nombre || ' (' || yo.rol || ')', moderacion_motivo = v_motivo, moderada_en = now()
      where id = p_id;
      if v_estado = 'oculta' then
        update tumbo.archivos set estado = 'descartado', motivo = 'reseña oculta por moderación'
        where id = any (r.fotos) and estado <> 'descartado';
      end if;
    else
      update tumbo.resenas set respuesta_estado = v_estado, moderada_por = yo.nombre || ' (' || yo.rol || ')', moderacion_motivo = v_motivo, moderada_en = now()
      where id = p_id;
    end if;
  else
    raise exception 'Ese tipo de contenido no existe.';
  end if;
  -- las denuncias abiertas sobre ese contenido se cierran con la decisión
  if p_tipo in ('pregunta', 'resena') then
    update tumbo.denuncias set estado = 'cerrada', resolucion = case when v_estado = 'oculta' then 'procede' else 'no_procede' end,
      nota = coalesce(v_motivo, 'Moderado'), cerrada_por = yo.nombre || ' (' || yo.rol || ')', cerrada_en = now()
    where tipo = p_tipo and objeto = p_id::text and estado = 'abierta';
  end if;
  perform tumbo_privado.auditar(yo, 'Contenido moderado', p_tipo || ' #' || p_id || ' → ' || v_estado || coalesce(' · ' || v_motivo, ''));
end $$;

-- Cierre de una denuncia (la moderación del producto o del comercio la
-- decide Crecimiento en su backoffice: aquí queda la resolución y la nota).
create function public.tm_denuncia_cerrar(p_sesion text, p_id bigint, p_resolucion text, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  d tumbo.denuncias;
  v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 600), '');
begin
  perform tumbo_privado.exigir_contenido(yo);
  if p_resolucion is null or p_resolucion not in ('procede', 'no_procede', 'duplicada') then
    raise exception 'Indica si la denuncia procede, no procede o está repetida.';
  end if;
  if char_length(coalesce(v_nota, '')) < 5 then
    raise exception 'Deja una nota con lo que se decidió (queda en la auditoría).';
  end if;
  select * into d from tumbo.denuncias where id = p_id for update;
  if not found then
    raise exception 'No encontramos esa denuncia.';
  end if;
  perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.comprador_real(d.autor_id) or tumbo_privado.seller_real(d.seller_id));
  if d.estado = 'cerrada' then
    raise exception 'Esa denuncia ya está cerrada.';
  end if;
  update tumbo.denuncias set estado = 'cerrada', resolucion = p_resolucion, nota = v_nota,
    cerrada_por = yo.nombre || ' (' || yo.rol || ')', cerrada_en = now()
  where id = p_id;
  if d.autor_id is not null then
    perform tumbo_privado.notificar('usr:' || d.autor_id, 'Revisamos tu reporte #' || p_id || ': ' ||
      case p_resolucion when 'procede' then 'tomamos medidas, gracias por avisar' when 'duplicada' then 'ya lo estábamos atendiendo'
                        else 'no encontramos una infracción' end, 'flag', null);
  end if;
  perform tumbo_privado.auditar(yo, 'Denuncia cerrada', '#' || p_id || ' ' || d.tipo || ' ' || d.objeto || ' → ' || p_resolucion || ' · ' || v_nota);
end $$;

-- ---------------------------------------------------------------------------
-- Soporte
-- ---------------------------------------------------------------------------
create function tumbo_privado.es_soporte(p_yo tumbo.usuarios) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_yo.id is not null and p_yo.rol in ('superadmin', 'ops', 'finanzas') and tumbo_privado.tiene_permiso(p_yo, 'soporte')
$$;

-- ¿Ve esta persona el caso? Quien lo abrió; el equipo de soporte (con una
-- cuenta de prueba, solo los casos de las cuentas de prueba).
create function tumbo_privado.ticket_visible(p_yo tumbo.usuarios, t tumbo.tickets) returns boolean
language sql stable security definer set search_path = '' as $$
  select t.id is not null and p_yo.id is not null
     and (t.usuario_id = p_yo.id
          or (tumbo_privado.es_soporte(p_yo) and (not tumbo_privado.cuenta_demo(p_yo.email)
              or exists (select 1 from tumbo.usuarios u where u.id = t.usuario_id and tumbo_privado.cuenta_demo(u.email)))))
$$;

create function tumbo_privado.ticket_json(t tumbo.tickets, p_yo tumbo.usuarios, p_detalle boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'categoria', t.categoria, 'asunto', t.asunto, 'pedido', t.pedido_id, 'estado', t.estado,
    'prioridad', t.prioridad, 'creado', t.creado, 'actualizado', t.actualizado, 'sla_vence', t.sla_vence,
    'primera_respuesta', t.primera_respuesta, 'cerrado', t.cerrado,
    'sla_vencido', t.primera_respuesta is null and t.estado <> 'cerrado' and t.sla_vence < now(),
    'mio', coalesce(t.usuario_id = p_yo.id, false), 'rol', t.rol, 'seller', t.seller_id,
    'quien', case when tumbo_privado.es_soporte(p_yo) then (select u.nombre || ' · ' || u.email from tumbo.usuarios u where u.id = t.usuario_id) end,
    'asignado', (select u.nombre from tumbo.usuarios u where u.id = t.asignado_a),
    'asignado_id', case when tumbo_privado.es_soporte(p_yo) then t.asignado_a end)
  || case when p_detalle then jsonb_build_object('mensajes', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'lado', m.lado, 'autor', m.autor, 'texto', m.texto, 'interno', m.interno, 'creado', m.creado,
          'mio', coalesce(m.autor_id = p_yo.id, false), 'adjuntos', tumbo_privado.archivos_json(m.adjuntos::text[])) order by m.id)
        from tumbo.ticket_mensajes m where m.ticket_id = t.id and (not m.interno or tumbo_privado.es_soporte(p_yo))), '[]'::jsonb))
    else '{}'::jsonb end
$$;

-- Abre un caso. p_datos = {categoria, asunto, texto, pedido?, adjuntos?}.
create function public.tm_ticket_crear(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_cat text := d ->> 'categoria';
  v_asunto text := btrim(coalesce(d ->> 'asunto', ''));
  v_texto text := btrim(coalesce(d ->> 'texto', ''));
  v_pedido text := nullif(btrim(coalesce(d ->> 'pedido', '')), '');
  v_adj uuid[];
  v_prio text;
  v_id text;
  v tumbo.pedidos;
begin
  if v_cat is null or v_cat not in ('pedido', 'pago', 'envio', 'devolucion', 'cuenta', 'vender', 'otro') then
    raise exception 'Elige de qué trata tu caso.';
  end if;
  if char_length(v_asunto) < 5 or char_length(v_asunto) > 120 then
    raise exception 'El asunto va con entre 5 y 120 caracteres.';
  end if;
  if char_length(v_texto) < 15 or char_length(v_texto) > 3000 then
    raise exception 'Cuéntanos qué pasó con al menos 15 caracteres (hasta 3.000).';
  end if;
  if v_pedido is not null then
    select * into v from tumbo.pedidos where id = v_pedido;
    if not found or not ((yo.rol = 'comprador' and v.comprador_id = yo.id) or (yo.seller_id is not null and v.seller_id = yo.seller_id)) then
      raise exception 'No encontramos ese pedido en tu cuenta.';
    end if;
  end if;
  begin
    v_adj := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(case when jsonb_typeof(d -> 'adjuntos') = 'array' then d -> 'adjuntos' else '[]'::jsonb end) x), '{}');
  exception when others then
    raise exception 'Los adjuntos no son válidos.';
  end;
  if cardinality(v_adj) > 5 or not tumbo_privado.archivos_propios(v_adj::text[], yo.id, array['soporte'], array[yo.id::text]) then
    raise exception 'Adjunta hasta 5 archivos subidos para soporte.';
  end if;
  perform tumbo_privado.bloquear_usuario(yo.id, 'tickets');
  if (select count(*) from tumbo.tickets where usuario_id = yo.id and creado > now() - interval '1 day') >= 5 then
    raise exception 'Llegaste al máximo de 5 casos por día: responde en los que ya tienes abiertos.';
  end if;
  if (select count(*) from tumbo.tickets where usuario_id = yo.id and estado <> 'cerrado') >= 10 then
    raise exception 'Tienes 10 casos abiertos: espera a que se resuelvan o responde en ellos.';
  end if;
  v_prio := case when v_cat in ('pago', 'devolucion') or (v_cat = 'pedido' and v_pedido is not null) then 'alta'
                 when v_cat in ('vender', 'otro') then 'baja' else 'normal' end;
  v_id := 'TCK-' || tumbo_privado.folio(nextval('tumbo_privado.seq_ticket'), 6);
  insert into tumbo.tickets (id, usuario_id, rol, seller_id, categoria, asunto, pedido_id, prioridad, sla_vence)
  values (v_id, yo.id, yo.rol, yo.seller_id, v_cat, v_asunto, v_pedido, v_prio,
          now() + make_interval(hours => tumbo_privado.sla_soporte_horas(v_prio)::integer));
  insert into tumbo.ticket_mensajes (ticket_id, autor_id, lado, autor, texto, adjuntos)
  values (v_id, yo.id, 'cliente', case when yo.rol = 'comprador' then 'Tú' else yo.nombre end, v_texto, v_adj);
  perform tumbo_privado.notificar('rol:ops', 'Caso de soporte ' || v_id || ': ' || left(v_asunto, 60), 'support_agent', 'admin/soporte.html?id=' || v_id);
  perform tumbo_privado.encolar(yo.id, 'ticket_creado', jsonb_build_object('ticket', v_id, 'asunto', v_asunto,
    'vence', tumbo_privado.fecha_legible(now() + make_interval(hours => tumbo_privado.sla_soporte_horas(v_prio)::integer)),
    'enlace', case when yo.rol = 'comprador' then 'app/tienda/soporte.html?id=' else 'app/seller/soporte.html?id=' end || v_id));
  return jsonb_build_object('id', v_id, 'prioridad', v_prio);
end $$;

-- Los casos: los propios, o la bandeja de soporte con filtros
-- (estado, asignados a mí, sin asignar, vencidos).
create function public.tm_tickets(p_sesion text, p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  f jsonb := case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end;
  v_soporte boolean := tumbo_privado.es_soporte(yo);
  v_estado text := nullif(f ->> 'estado', '');
  v_vista text := coalesce(nullif(f ->> 'vista', ''), 'todos');
begin
  if v_estado is not null and v_estado not in ('abierto', 'en_proceso', 'esperando', 'cerrado', 'activos') then
    raise exception 'Ese estado no existe.';
  end if;
  return jsonb_build_object(
    'tickets', coalesce((select jsonb_agg(tumbo_privado.ticket_json(t, yo, false) order by
                           (t.estado = 'cerrado'), (t.primera_respuesta is null and t.sla_vence < now()) desc, t.sla_vence, t.creado desc)
                         from (select * from tumbo.tickets x
                               where ((v_soporte and coalesce((f ->> 'mios')::boolean, false) is false) or x.usuario_id = yo.id)
                                 and tumbo_privado.ticket_visible(yo, x)
                                 and (v_estado is null or (v_estado = 'activos' and x.estado <> 'cerrado') or x.estado = v_estado)
                                 and (v_vista = 'todos' or (v_vista = 'mios_asignados' and x.asignado_a = yo.id)
                                      or (v_vista = 'sin_asignar' and x.asignado_a is null)
                                      or (v_vista = 'vencidos' and x.primera_respuesta is null and x.estado <> 'cerrado' and x.sla_vence < now()))
                               order by x.creado desc limit 300) t), '[]'::jsonb),
    'soporte', v_soporte,
    'macros', case when v_soporte then coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'titulo', m.titulo, 'texto', m.texto,
                                                  'categoria', m.categoria) order by m.titulo)
                                                from tumbo.soporte_macros m where m.activa), '[]'::jsonb) end,
    'equipo', case when v_soporte then coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre)
                                                from tumbo.usuarios u where u.activo and u.rol in ('superadmin', 'ops', 'finanzas')
                                                  and tumbo_privado.tiene_permiso(u, 'soporte')
                                                  and tumbo_privado.cuenta_demo(u.email) = tumbo_privado.cuenta_demo(yo.email)), '[]'::jsonb) end);
end $$;

create function public.tm_ticket(p_sesion text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  t tumbo.tickets;
begin
  select * into t from tumbo.tickets where id = p_id;
  if not tumbo_privado.ticket_visible(yo, t) then
    return jsonb_build_object('error', 'No encontramos ese caso.');
  end if;
  return tumbo_privado.ticket_json(t, yo, true);
end $$;

-- Responde en un caso: quien lo abrió (lo reabre si estaba esperando o
-- cerrado hace menos de 15 días) o soporte (cuenta la primera respuesta;
-- con p_interno, una nota que no ve quien lo abrió).
create function public.tm_ticket_responder(p_sesion text, p_id text, p_texto text, p_adjuntos uuid[], p_interno boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  t tumbo.tickets;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_adj uuid[] := coalesce(p_adjuntos, '{}');
  v_soporte boolean;
  v_interno boolean := coalesce(p_interno, false);
begin
  select * into t from tumbo.tickets where id = p_id for update;
  if not tumbo_privado.ticket_visible(yo, t) then
    raise exception 'No encontramos ese caso.';
  end if;
  v_soporte := t.usuario_id is distinct from yo.id;
  if char_length(v_texto) < 2 or char_length(v_texto) > 3000 then
    raise exception 'Escribe la respuesta (hasta 3.000 caracteres).';
  end if;
  if cardinality(v_adj) > 5 or coalesce(array_ndims(v_adj), 1) <> 1
     or not tumbo_privado.archivos_propios(v_adj::text[], yo.id, array['soporte'], array[yo.id::text, t.id]) then
    raise exception 'Adjunta hasta 5 archivos subidos para soporte.';
  end if;
  if not v_soporte then
    if v_interno then raise exception 'Las notas internas son del equipo de soporte.'; end if;
    if t.estado = 'cerrado' and t.cerrado < now() - interval '15 days' then
      raise exception 'Este caso se cerró hace más de 15 días: abre uno nuevo.';
    end if;
    if (select count(*) from tumbo.ticket_mensajes where autor_id = yo.id and creado > now() - interval '1 hour') >= 30 then
      raise exception 'Enviaste muchos mensajes seguidos: espera unos minutos.';
    end if;
  else
    perform tumbo_privado.exigir_cuenta_real(yo, not tumbo_privado.cuenta_demo((select u.email from tumbo.usuarios u where u.id = t.usuario_id)));
  end if;
  insert into tumbo.ticket_mensajes (ticket_id, autor_id, lado, autor, texto, adjuntos, interno)
  values (t.id, yo.id, case when v_soporte then 'soporte' else 'cliente' end,
          case when v_soporte then 'Soporte Tumbo · ' || split_part(yo.nombre, ' ', 1) when yo.rol = 'comprador' then 'Tú' else yo.nombre end,
          v_texto, v_adj, v_interno);
  if v_soporte and not v_interno then
    update tumbo.tickets set primera_respuesta = coalesce(primera_respuesta, now()), actualizado = now(),
      estado = case when estado = 'cerrado' then 'cerrado' else 'esperando' end,
      asignado_a = coalesce(asignado_a, yo.id)
    where id = t.id;
    if t.usuario_id is not null then
      perform tumbo_privado.notificar('usr:' || t.usuario_id, 'Soporte respondió tu caso ' || t.id, 'support_agent',
        case when t.rol = 'comprador' then 'tienda/soporte.html?id=' else 'seller/soporte.html?id=' end || t.id);
      perform tumbo_privado.encolar(t.usuario_id, 'ticket_actualizado', jsonb_build_object('ticket', t.id, 'asunto', t.asunto,
        'enlace', case when t.rol = 'comprador' then 'app/tienda/soporte.html?id=' else 'app/seller/soporte.html?id=' end || t.id));
    end if;
  elsif v_soporte then
    update tumbo.tickets set actualizado = now() where id = t.id;
  else
    update tumbo.tickets set actualizado = now(), estado = case when estado in ('esperando', 'cerrado') then 'abierto' else estado end,
      cerrado = case when estado = 'cerrado' then null else cerrado end
    where id = t.id;
    perform tumbo_privado.notificar('rol:ops', 'Respuesta del cliente en ' || t.id, 'support_agent', 'admin/soporte.html?id=' || t.id);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Gestión del caso por soporte: asignar, estado y prioridad.
create function public.tm_ticket_gestionar(p_sesion text, p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  t tumbo.tickets;
  v_asig uuid;
  a tumbo.usuarios;
begin
  if not tumbo_privado.es_soporte(yo) then
    raise exception 'Tu rol no permite gestionar casos de soporte.' using errcode = '42501';
  end if;
  select * into t from tumbo.tickets where id = p_id for update;
  if not tumbo_privado.ticket_visible(yo, t) then
    raise exception 'No encontramos ese caso.';
  end if;
  perform tumbo_privado.exigir_cuenta_real(yo, not tumbo_privado.cuenta_demo((select u.email from tumbo.usuarios u where u.id = t.usuario_id)));
  if d ? 'estado' and coalesce(d ->> 'estado', '') not in ('abierto', 'en_proceso', 'esperando', 'cerrado') then
    raise exception 'Ese estado no existe.';
  end if;
  if d ? 'prioridad' and coalesce(d ->> 'prioridad', '') not in ('alta', 'normal', 'baja') then
    raise exception 'Esa prioridad no existe.';
  end if;
  if d ? 'asignado' then
    begin
      v_asig := nullif(d ->> 'asignado', '')::uuid;
    exception when others then
      raise exception 'Elige a alguien del equipo de soporte.';
    end;
    if v_asig is not null then
      select * into a from tumbo.usuarios where id = v_asig and activo;
      if a.id is null or not tumbo_privado.es_soporte(a) or tumbo_privado.cuenta_demo(a.email) <> tumbo_privado.cuenta_demo(yo.email) then
        raise exception 'Elige a alguien del equipo de soporte.';
      end if;
    end if;
  end if;
  update tumbo.tickets
  set estado = coalesce(d ->> 'estado', estado), prioridad = coalesce(d ->> 'prioridad', prioridad),
      asignado_a = case when d ? 'asignado' then v_asig else asignado_a end,
      cerrado = case when d ->> 'estado' = 'cerrado' then now() when d ? 'estado' then null else cerrado end,
      sla_vence = case when d ? 'prioridad' and primera_respuesta is null
                       then creado + make_interval(hours => tumbo_privado.sla_soporte_horas(d ->> 'prioridad')::integer) else sla_vence end,
      actualizado = now()
  where id = t.id;
  if d ->> 'estado' = 'cerrado' and t.estado <> 'cerrado' and t.usuario_id is not null then
    perform tumbo_privado.notificar('usr:' || t.usuario_id, 'Cerramos tu caso ' || t.id || ': si necesitas algo más, respóndenos ahí mismo',
      'support_agent', case when t.rol = 'comprador' then 'tienda/soporte.html?id=' else 'seller/soporte.html?id=' end || t.id);
  end if;
  perform tumbo_privado.auditar(yo, 'Caso de soporte', t.id || ' · ' || d::text);
  return jsonb_build_object('ok', true);
end $$;

-- Macros de soporte: crear, cambiar o desactivar (superadmin y soporte).
create function public.tm_soporte_macro_guardar(p_sesion text, p_id bigint, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_titulo text := btrim(coalesce(d ->> 'titulo', ''));
  v_texto text := btrim(coalesce(d ->> 'texto', ''));
  v_id bigint;
begin
  if not tumbo_privado.es_soporte(yo) then
    raise exception 'Tu rol no permite gestionar las macros de soporte.' using errcode = '42501';
  end if;
  perform tumbo_privado.exigir_cuenta_real(yo, true);
  if p_id is not null and coalesce((d ->> 'activa')::boolean, true) is false then
    update tumbo.soporte_macros set activa = false, por = yo.nombre where id = p_id returning id into v_id;
    if v_id is null then raise exception 'No encontramos esa macro.'; end if;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  if char_length(v_titulo) < 3 or char_length(v_titulo) > 80 or char_length(v_texto) < 10 or char_length(v_texto) > 2000 then
    raise exception 'La macro lleva un título (3 a 80 caracteres) y un texto (10 a 2.000).';
  end if;
  if p_id is null then
    if (select count(*) from tumbo.soporte_macros where activa) >= 100 then
      raise exception 'Ya hay 100 macros activas.';
    end if;
    insert into tumbo.soporte_macros (titulo, texto, categoria, por) values (v_titulo, v_texto, nullif(d ->> 'categoria', ''), yo.nombre)
    on conflict (titulo) do update set texto = excluded.texto, activa = true, por = excluded.por
    returning id into v_id;
  else
    update tumbo.soporte_macros set titulo = v_titulo, texto = v_texto, categoria = nullif(d ->> 'categoria', ''), activa = true, por = yo.nombre
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'No encontramos esa macro.'; end if;
  end if;
  perform tumbo_privado.auditar(yo, 'Macro de soporte', '#' || v_id || ' ' || v_titulo);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Disputas v2
-- ---------------------------------------------------------------------------
-- El lado de una persona en un reclamo: el comprador, el seller principal
-- del comercio o el equipo (superadmin y Operaciones). null: no lo ve.
create function tumbo_privado.disputa_lado(p_yo tumbo.usuarios, d tumbo.disputas) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_yo.id is null or d.id is null then null
              when p_yo.rol = 'comprador' and d.comprador_id = p_yo.id then 'comprador'
              when p_yo.rol = 'seller' and d.seller_id = p_yo.seller_id then 'comercio'
              when p_yo.rol in ('superadmin', 'ops') then 'tumbo' end
$$;

-- El caso de un reclamo (los de antes de esta ola lo reciben al consultarse,
-- con un plazo que nunca corre hacia atrás).
create function tumbo_privado.disputa_caso(p_id text) returns tumbo.disputa_casos
language plpgsql security definer set search_path = '' as $$
declare
  c tumbo.disputa_casos;
begin
  select * into c from tumbo.disputa_casos where disputa_id = p_id;
  if found then
    return c;
  end if;
  insert into tumbo.disputa_casos (disputa_id, plazo_seller, respondida_en, decision, resuelta_en)
  select d.id, greatest(d.creado, now()) + make_interval(hours => tumbo_privado.comunicacion('horas_respuesta_reclamo', 72)::integer),
         d.respuesta_fecha, d.resolucion_decision, d.resolucion_fecha
  from tumbo.disputas d where d.id = p_id
  on conflict (disputa_id) do nothing;
  select * into c from tumbo.disputa_casos where disputa_id = p_id;
  return c;
end $$;

-- Cómo se cuenta una decisión a las partes.
create function tumbo_privado.disputa_texto(p_decision text, p_monto numeric, p_paga text) returns text
language sql immutable set search_path = '' as $$
  select case p_decision
    when 'reembolso' then 'reembolso total al comprador'
    when 'reembolso_parcial' then 'reembolso parcial de ' || tumbo_privado.fmt_usd(p_monto) || ' al comprador; el resto se libera al comercio'
    when 'devolucion' then 'devolución del producto' || case p_paga when 'seller' then ' (el envío de vuelta lo paga el comercio)'
                                                                    when 'comprador' then ' (el envío de vuelta lo paga el comprador)'
                                                                    when 'tumbo' then ' (el envío de vuelta lo paga Tumbo)' else '' end
    when 'liberar' then 'cerrado a favor del comercio: fondos liberados al vencer el plazo de apelación'
    else coalesce(p_decision, '') end
$$;

-- Avisos de un reclamo a las partes (campana y bandeja).
create function tumbo_privado.disputa_avisar(d tumbo.disputas, p_comprador text, p_comercio text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u record;
begin
  if p_comprador is not null then
    perform tumbo_privado.encolar(d.comprador_id, 'reclamo_actualizado', jsonb_build_object('reclamo', d.id, 'pedido', d.pedido_id,
      'estado', p_comprador, 'enlace', 'app/tienda/reclamo.html?id=' || d.pedido_id));
  end if;
  if p_comercio is not null then
    for u in select x.id from tumbo.usuarios x where x.seller_id = d.seller_id and x.rol = 'seller' and x.activo order by x.id loop
      perform tumbo_privado.encolar(u.id, 'reclamo_comercio', jsonb_build_object('reclamo', d.id, 'pedido', d.pedido_id,
        'estado', p_comercio, 'enlace', 'app/seller/disputas.html?id=' || d.id));
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- El dinero de un reclamo (con los reembolsos de Pagos)
-- ---------------------------------------------------------------------------
-- Lo ya reembolsado de un pedido (en cualquier estado: como lo cuenta
-- crear_reembolso).
create function tumbo_privado.reembolsado_pedido(p_pedido text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(r.monto_usd), 0) from tumbo.reembolsos r where r.pedido_id = p_pedido and r.tipo = 'pedido'
$$;

-- Lo que devuelve un reembolso total: lo que el comprador pagó (con el
-- IGTF y sin los descuentos; un pedido de antes de los pagos guiados,
-- productos y envío) menos lo ya reembolsado.
create function tumbo_privado.disputa_total_reembolso(v tumbo.pedidos) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(0, case when v.pago_id is null then tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd
                          else (tumbo_privado.montos_pedido(v) ->> 'pagado')::numeric end
                     - tumbo_privado.reembolsado_pedido(v.id))
$$;

-- El tope (exclusivo) de un reembolso parcial: menos que lo que pagó el
-- comprador y que lo que cobra el comercio por el pedido (productos con sus
-- descuentos y envío), lo menor, descontado lo ya reembolsado. Así Pagos
-- nunca lo asienta como un reembolso completo y al comercio le queda un
-- resto que liquidar.
create function tumbo_privado.disputa_tope_parcial(v tumbo.pedidos) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(0, least(case when v.pago_id is null then tumbo_privado.bruto_pedido(v.id) + v.costo_envio_usd
                                else (x.m ->> 'pagado')::numeric end,
                           (x.m ->> 'base_seller')::numeric + (x.m ->> 'envio')::numeric)
                     - tumbo_privado.reembolsado_pedido(v.id))
  from (select tumbo_privado.montos_pedido(v) as m) x
$$;

-- Reembolso parcial (crear_reembolso de Pagos) y el descuento al comercio
-- por lo que de verdad devolvió Pagos. → {reembolso_id, monto, ajuste_id}
create function tumbo_privado.disputa_reembolso_parcial(v tumbo.pedidos, p_monto numeric, p_disputa text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tope numeric := tumbo_privado.disputa_tope_parcial(v);
  v_monto numeric := round(coalesce(p_monto, 0), 2);
  v_id bigint;
  v_real numeric;
  v_aj bigint;
begin
  if v_monto <= 0 or v_monto >= v_tope then
    raise exception 'El reembolso parcial va de $0.01 a menos de % (lo que pagó el comprador o lo que cobra el comercio por el pedido, lo menor); para devolver todo, elige el reembolso total.',
      tumbo_privado.fmt_usd(v_tope);
  end if;
  v_id := tumbo_privado.crear_reembolso(v.id, v_monto, p_motivo);
  if v_id is null then
    raise exception 'Este pedido no tiene un pago verificado que reembolsar.';
  end if;
  select r.monto_usd into v_real from tumbo.reembolsos r where r.id = v_id;
  if v_real is distinct from v_monto then
    raise exception 'Pagos registraría un reembolso de % y no de %: revísalo con Finanzas.', tumbo_privado.fmt_usd(v_real), tumbo_privado.fmt_usd(v_monto);
  end if;
  -- (sin asiento propio: el reembolso ya cargó por_pagar_seller; así la corrida le paga al comercio el resto)
  insert into tumbo.ajustes_seller (seller_id, monto_usd, motivo, por)
  values (v.seller_id, -v_real, left('Reembolso parcial del reclamo ' || p_disputa || ' (pedido ' || v.id || ')', 300), 'Sistema (reclamo ' || p_disputa || ')')
  returning id into v_aj;
  return jsonb_build_object('reembolso_id', v_id, 'monto', v_real, 'ajuste_id', v_aj);
end $$;

-- Reembolso total: lo que falta para devolver todo lo que pagó el comprador
-- (con el IGTF). Si ya hubo un reembolso parcial, Pagos asienta este resto
-- como otro parcial (contra por_pagar_seller); el asiento que sigue lo
-- completa como el de un reembolso completo de una vez: vuelve el IGTF por
-- pagar y se revierte el descuento que asumió Tumbo. → {reembolso_id, monto}
create function tumbo_privado.disputa_reembolso_total(v tumbo.pedidos, p_disputa text, p_motivo text, p_actor text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := tumbo_privado.montos_pedido(v);
  v_ya numeric := tumbo_privado.reembolsado_pedido(v.id);
  v_falta numeric := tumbo_privado.disputa_total_reembolso(v);
  v_t numeric := coalesce((m ->> 'descuento_tumbo')::numeric, 0);
  v_i numeric := coalesce((m ->> 'igtf')::numeric, 0);
  v_id bigint;
  v_real numeric;
begin
  if v_falta <= 0 then
    return jsonb_build_object('reembolso_id', null, 'monto', 0);
  end if;
  v_id := tumbo_privado.crear_reembolso(v.id, v_falta, p_motivo);
  if v_id is null then
    return jsonb_build_object('reembolso_id', null, 'monto', 0);
  end if;
  select r.monto_usd into v_real from tumbo.reembolsos r where r.id = v_id;
  if v.pago_id is not null and v_ya > 0 and v_ya + v_real = (m ->> 'pagado')::numeric and (v_t <> 0 or v_i <> 0) then
    perform tumbo_privado.asentar('reembolso', 'R-' || v_id,
      'Reembolso del pedido ' || v.id || ' completado a total (reclamo ' || p_disputa || '): IGTF y descuento de Tumbo', coalesce(p_actor, 'Sistema'),
      jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', v.seller_id, 'debe', v_t - v_i),
                        jsonb_build_object('cuenta', 'igtf_por_pagar', 'debe', v_i),
                        jsonb_build_object('cuenta', 'descuentos_tumbo', 'haber', v_t)));
  end if;
  return jsonb_build_object('reembolso_id', v_id, 'monto', v_real);
end $$;

-- ¿Siguen retenidos los fondos de un pedido con el reclamo resuelto? Tras
-- «liberar» o un reembolso parcial el comprador puede apelar: mientras
-- corre su plazo (o mientras su apelación espera la revisión) el pedido no
-- entra en una liquidación.
create function tumbo_privado.disputa_retiene_fondos(p_disputa text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select coalesce(c.decision, d.resolucion_decision) in ('liberar', 'reembolso_parcial')
       and c.apelacion_estado is distinct from 'confirmada' and c.apelacion_estado is distinct from 'modificada'
       and (now() < coalesce(c.resuelta_en, d.resolucion_fecha, now())
                    + make_interval(days => tumbo_privado.comunicacion('dias_apelacion', 5)::integer)
            or exists (select 1 from tumbo.disputa_apelaciones a where a.disputa_id = d.id and a.lado = 'comprador'))
    from tumbo.disputas d left join tumbo.disputa_casos c on c.disputa_id = d.id
    where d.id = p_disputa and d.estado = 'resuelta'), false)
$$;

-- Un pedido con el reclamo resuelto no pasa a elegible mientras el
-- comprador puede apelar, lo pase quien lo pase (la resolución de siempre,
-- tm_resolver_disputa, lo deja elegible enseguida): queda congelado y la
-- tarea del dominio lo libera al vencer el plazo.
create function tumbo_privado.pedido_retener_apelacion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.disputa_id is not null and new.liquidacion_id is null and tumbo_privado.disputa_retiene_fondos(new.disputa_id) then
    new.liquidacion := 'congelado';
    perform tumbo_privado.evento(new.id, 'Sistema', 'Fondos retenidos hasta que venza el plazo de apelación del reclamo ' || new.disputa_id, 'lock_clock');
  end if;
  return new;
end $$;

create trigger pedidos_retener_apelacion
  before update of liquidacion on tumbo.pedidos
  for each row when (new.liquidacion = 'elegible' and old.liquidacion is distinct from 'elegible')
  execute function tumbo_privado.pedido_retener_apelacion();

-- ¿Puede esta parte apelar? null si puede; si no, el motivo.
--   · una vez cada parte (en un reembolso parcial apelan las dos), dentro
--     del plazo desde la decisión y mientras no se revisaron las apelaciones;
--   · el comprador apela lo que lo dejó sin todo su dinero (fondos
--     liberados o reembolso parcial) mientras el dinero no entró en una
--     liquidación; el comercio, lo que le costó (reembolso, reembolso
--     parcial o devolución).
create function tumbo_privado.disputa_apelacion_impedida(d tumbo.disputas, c tumbo.disputa_casos, v tumbo.pedidos, p_lado text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dias integer := tumbo_privado.comunicacion('dias_apelacion', 5)::integer;
begin
  if d.estado <> 'resuelta' or c.decision is null then
    return 'El reclamo todavía no tiene una decisión que apelar.';
  end if;
  if c.apelacion_estado in ('confirmada', 'modificada') then
    return 'Las apelaciones de este reclamo ya se revisaron: la revisión es definitiva.';
  end if;
  if exists (select 1 from tumbo.disputa_apelaciones a where a.disputa_id = d.id and a.lado = p_lado) then
    return 'Ya apelaste esta decisión: la revisa otra persona del equipo.';
  end if;
  if (p_lado = 'comprador' and c.decision not in ('liberar', 'reembolso_parcial'))
     or (p_lado = 'comercio' and c.decision not in ('reembolso', 'reembolso_parcial', 'devolucion')) then
    return 'La decisión ya fue a tu favor: no hay nada que apelar.';
  end if;
  if now() > c.resuelta_en + make_interval(days => v_dias) then
    return format('Pasó el plazo de %s días para apelar.', v_dias);
  end if;
  if p_lado = 'comprador' and (v.liquidacion_id is not null or v.liquidacion is null or v.liquidacion not in ('congelado', 'elegible')) then
    return 'El dinero de este pedido ya entró en una liquidación del comercio: escríbele a soporte desde Ayuda.';
  end if;
  return null;
end $$;

-- La resolución de la ola 2, compartida por tm_disputa_resolver (con
-- reembolso parcial, quién paga el envío de vuelta y plantilla) y el fallo
-- automático de la tarea (p_yo sin id: el sistema). Mismas reglas que la
-- última tm_resolver_disputa (integración de la ola 1): el reclamo
-- de una persona o un comercio real lo decide una cuenta real con sesión
-- elevada; el reembolso es el de Pagos (crear_reembolso) y la devolución
-- la coordina Logística (su inspección antes del reembolso). Tras «liberar»
-- o un reembolso parcial los fondos quedan retenidos durante el plazo de
-- apelación del comprador. → true si resolvió (el fallo automático no
-- resuelve el reclamo que el comercio respondió mientras tanto).
create function tumbo_privado.disputa_resolver_interno(p_yo tumbo.usuarios, p_id text, p_decision text, p_nota text,
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
      update tumbo.devoluciones
      set paga = p_paga, actualizado = now(),
          instrucciones = left(regexp_replace(instrucciones, 'El envío de vuelta lo (paga el comercio[^.]*|pagas tú)\.',
            case p_paga when 'seller' then 'El envío de vuelta lo paga el comercio: pide «cobro en destino» si la agencia lo ofrece; si no, pagas tú, guardas el recibo y lo reportas en el expediente del reclamo («Envío de vuelta») para que te lo reintegremos.'
                        when 'tumbo' then 'El envío de vuelta lo paga Tumbo: guarda el recibo y repórtalo en el expediente del reclamo («Envío de vuelta») para que te lo reintegremos.'
                        else 'El envío de vuelta lo pagas tú.' end), 900)
      where pedido_id = d.pedido_id and estado <> 'cerrada';
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

-- Apertura de reclamo. Desde la de Logística (con «No llegó» para un pedido
-- despachado que pasó su fecha prometida). Cambios: el caso con el plazo
-- del comercio (72 h; si no responde, fallo automático a favor del
-- comprador), el mensaje en el expediente, el aviso por la bandeja y la
-- descripción (y los nombres de los adjuntos) sin datos de contacto: la lee
-- el comercio.
create or replace function public.tm_abrir_disputa(p_sesion text, p_pedido text, p_motivo text, p_descripcion text, p_evidencia text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_pedido, yo);
  cfg tumbo.config;
  e tumbo.envios;
  d tumbo.disputas;
  v_id text;
  v_desc text := trim(coalesce(p_descripcion, ''));
  v_evid text[] := coalesce(p_evidencia, '{}');
  v_desde timestamptz;
  v_no_llego boolean := p_motivo = 'No llegó';
  v_plazo timestamptz := now() + make_interval(hours => tumbo_privado.comunicacion('horas_respuesta_reclamo', 72)::integer);
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
  v_desc := left(tumbo_privado.ocultar_contacto(v_desc) ->> 'texto', 2000);
  v_evid := tumbo_privado.adjuntos_sin_contacto(v_evid);

  v_id := 'DSP-' || tumbo_privado.folio(nextval('tumbo_privado.seq_disputa'), 4);
  insert into tumbo.disputas (id, pedido_id, comprador_id, seller_id, motivo, descripcion, evidencia, monto_usd, estado)
  values (v_id, v.id, v.comprador_id, v.seller_id, p_motivo, v_desc, v_evid, tumbo_privado.bruto_pedido(v.id), 'abierta')
  returning * into d;
  update tumbo.pedidos set disputa_id = v_id, liquidacion = 'congelado' where id = v.id;
  insert into tumbo.disputa_casos (disputa_id, plazo_seller) values (v_id, v_plazo)
  on conflict (disputa_id) do update set plazo_seller = excluded.plazo_seller;
  insert into tumbo.disputa_mensajes (disputa_id, lado, autor, texto)
  values (v_id, 'sistema', 'Tumbo', 'Reclamo abierto. El comercio tiene hasta el ' || tumbo_privado.fecha_legible(v_plazo) ||
          ' para responder con su evidencia; si no responde, el reclamo se resuelve a favor del comprador con el reembolso total.');
  perform tumbo_privado.evento(v.id, 'Comprador', 'Reclamo ' || v_id || ' abierto' ||
    case when v_no_llego then ': el pedido no llegó' else '' end || ' · liquidación congelada', 'gavel');
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Reclamo ' || v_id || ' abierto sobre ' || v.id ||
    case when v_no_llego then ' (no llegó)' else '' end || ': responde con tu evidencia', 'gavel', 'seller/disputas.html');
  perform tumbo_privado.notificar('rol:ops', 'Disputa ' || v_id || ' en cola: ' || p_motivo, 'gavel', 'admin/disputas.html');
  perform tumbo_privado.disputa_avisar(d, null, 'abierto (' || p_motivo || '); responde antes del ' || tumbo_privado.fecha_legible(v_plazo) ||
    ' o se resolverá a favor del comprador');
  perform tumbo_privado.auditar(yo, 'Apertura de disputa', v_id || ' sobre ' || v.id || case when v_no_llego then ' (no llegó)' else '' end);
  return v_id;
end $$;

-- Los adjuntos de un reclamo: los archivos (uuid) tal cual; los nombres
-- sueltos de la demo, sin datos de contacto (los lee la otra parte).
create function tumbo_privado.adjuntos_sin_contacto(p text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(case when x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then x
                                 else left(tumbo_privado.ocultar_contacto(x) ->> 'texto', 120) end order by n), '{}')
  from unnest(coalesce(p, '{}')) with ordinality as t (x, n)
$$;

-- Respuesta del comercio. Desde la de funciones (migración 3). Cambios: para
-- el reloj del fallo automático, queda en el expediente, avisa al
-- comprador y se guarda sin datos de contacto (el comprador la lee en la
-- tarjeta de la respuesta y en tm_cargar).
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

-- La resolución de siempre (tm_resolver_disputa) la define la integración de
-- la ola 1 (20261023190000), que se aplica antes y no se redefine aquí. Lo
-- que la ola 2 suma a toda resolución (el caso con quién decidió, el
-- mensaje en el expediente, las solicitudes canceladas y el aviso por la
-- bandeja) lo pone este disparador, sea quien sea el que resolvió;
-- disputa_resolver_interno lo hace por su cuenta (con el reembolso parcial
-- y quién paga el envío de vuelta) y lo marca en la transacción. Los
-- fondos de un «liberar» los retiene pedidos_retener_apelacion.
create function tumbo_privado.disputa_al_resolver() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
  v tumbo.pedidos;
  v_paga text;
  v_txt text;
  v_hasta timestamptz := now() + make_interval(days => tumbo_privado.comunicacion('dias_apelacion', 5)::integer);
begin
  if coalesce(current_setting('tumbo.disputa_v2', true), '') = new.id then
    return null;
  end if;
  begin
    perform tumbo_privado.disputa_caso(new.id);
    select x.* into u from tumbo.sesiones s join tumbo.usuarios x on x.id = s.usuario_id
    where s.token_hash = decode(nullif(current_setting('tumbo.sesion_actual', true), ''), 'hex');
    select * into v from tumbo.pedidos where id = new.pedido_id;
    if new.resolucion_decision = 'devolucion' then
      select dv.paga into v_paga from tumbo.devoluciones dv where dv.pedido_id = new.pedido_id;
    end if;
    update tumbo.disputa_casos
    set decision = new.resolucion_decision,
        -- (lo que Pagos devolverá: el reembolso se crea después de esta actualización)
        reembolso_usd = case when new.resolucion_decision = 'reembolso' then tumbo_privado.disputa_total_reembolso(v) end,
        paga_logistica = v_paga, resuelta_por = u.id,
        resuelta_por_nombre = case when u.id is null then 'Operaciones' else u.nombre || ' (' || u.rol || ')' end,
        resuelta_en = coalesce(new.resolucion_fecha, now())
    where disputa_id = new.id;
    update tumbo.disputa_solicitudes set estado = 'cancelada' where disputa_id = new.id and estado = 'pendiente';
    v_txt := tumbo_privado.disputa_texto(new.resolucion_decision, null, v_paga);
    insert into tumbo.disputa_mensajes (disputa_id, lado, autor, texto)
    values (new.id, 'sistema', 'Tumbo', left('Decisión: ' || v_txt || '.' ||
            case when coalesce(new.resolucion_nota, '') <> '' then ' ' || regexp_replace(new.resolucion_nota, '([^.!?])$', '\1.') else '' end ||
            ' Si no estás de acuerdo, puedes apelar una vez, con evidencia nueva, hasta el ' || tumbo_privado.fecha_legible(v_hasta) || '.' ||
            case when new.resolucion_decision = 'liberar' then ' Hasta esa fecha los fondos del pedido siguen retenidos.' else '' end, 2000));
    perform tumbo_privado.disputa_avisar(new, 'resuelto: ' || v_txt, 'resuelto: ' || v_txt);
  exception when others then
    raise warning 'comunicación: no se completó el caso del reclamo % (%)', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger disputas_al_resolver
  after update of estado on tumbo.disputas
  for each row when (old.estado is distinct from 'resuelta' and new.estado = 'resuelta')
  execute function tumbo_privado.disputa_al_resolver();

-- La resolución completa: p_datos = {decision, monto (reembolso parcial),
-- paga (devolución: comprador | seller | tumbo), nota, plantilla}.
create function public.tm_disputa_resolver(p_sesion text, p_id text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_monto numeric;
begin
  begin
    v_monto := nullif(d ->> 'monto', '')::numeric;
  exception when others then
    raise exception 'El monto del reembolso parcial no es válido.';
  end;
  if d ->> 'plantilla' is not null and not exists (select 1 from tumbo.disputa_plantillas where clave = d ->> 'plantilla') then
    raise exception 'Esa plantilla de decisión no existe.';
  end if;
  perform tumbo_privado.disputa_resolver_interno(yo, p_id, d ->> 'decision', d ->> 'nota', v_monto, nullif(d ->> 'paga', ''), d ->> 'plantilla');
end $$;

-- Un mensaje del expediente como lo ve cada quien.
create function tumbo_privado.disputa_mensajes_json(p_id text, p_yo uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'lado', m.lado, 'autor', m.autor, 'texto', m.texto,
           'adjuntos', tumbo_privado.archivos_json(m.adjuntos), 'creado', m.creado, 'mio', coalesce(m.autor_id = p_yo, false),
           'solicitud', m.solicitud_id) order by m.id), '[]'::jsonb)
  from (select * from tumbo.disputa_mensajes x where x.disputa_id = p_id order by x.id desc limit 300) m
$$;

-- ¿Sigue abierto el expediente a mensajes? Mientras no hay decisión,
-- mientras hay apelaciones por revisar y mientras la devolución decidida
-- sigue en curso (el comprador reporta ahí el envío de vuelta).
create function tumbo_privado.disputa_abierta_a_mensajes(d tumbo.disputas, c tumbo.disputa_casos, v tumbo.pedidos) returns boolean
language sql stable set search_path = '' as $$
  select d.estado <> 'resuelta' or coalesce(c.apelacion_estado = 'pedida', false)
      or coalesce(c.decision = 'devolucion' and v.estado = 'devolucion', false)
$$;

-- El expediente completo de un reclamo para el comprador, el comercio o el
-- equipo. A una cuenta de prueba del equipo, el reclamo de una persona o un
-- comercio real le llega bloqueado y sin textos ni evidencias.
create function public.tm_disputa(p_sesion text, p_id text) returns jsonb
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
  v_bloq := v_lado = 'tumbo' and tumbo_privado.cuenta_demo(yo.email)
            and (tumbo_privado.comprador_real(d.comprador_id) or tumbo_privado.seller_real(d.seller_id));
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
    'descripcion', case when v_bloq then '(Reclamo de una persona o un comercio real: el detalle solo lo ve una cuenta real del equipo.)' else d.descripcion end,
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
      'responder', v_lado = 'comercio' and d.estado = 'abierta',
      'apelar', v_lado in ('comprador', 'comercio') and tumbo_privado.disputa_apelacion_impedida(d, c, v, v_lado) is null,
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

-- Lo que la lista de reclamos necesita además de tm_cargar: plazo del
-- comercio, solicitudes pendientes, mensajes, apelaciones, fondos retenidos
-- y envío de vuelta, por reclamo.
create function public.tm_disputas_resumen(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'superadmin', 'ops']);
begin
  return coalesce((
    select jsonb_object_agg(d.id, jsonb_build_object(
             'plazo_seller', c.plazo_seller, 'respondida_en', c.respondida_en, 'decision', c.decision,
             'reembolso_usd', c.reembolso_usd, 'paga', c.paga_logistica, 'automatica', c.fallo_automatico,
             'apelacion', c.apelacion_estado, 'apelacion_a_favor', c.apelacion_a_favor,
             'apelacion_de', (select coalesce(jsonb_agg(a.lado order by a.creado), '[]'::jsonb) from tumbo.disputa_apelaciones a where a.disputa_id = d.id),
             'retenido_hasta', case when d.estado = 'resuelta' and tumbo_privado.disputa_retiene_fondos(d.id)
                                    then c.resuelta_en + make_interval(days => tumbo_privado.comunicacion('dias_apelacion', 5)::integer) end,
             'vuelta', c.vuelta_estado,
             'mensajes', (select count(*) from tumbo.disputa_mensajes m where m.disputa_id = d.id and m.lado <> 'sistema'),
             'solicitudes', (select count(*) from tumbo.disputa_solicitudes s where s.disputa_id = d.id and s.estado = 'pendiente')))
    from (select x.* from tumbo.disputas x
          where (x.comprador_id = yo.id or (x.seller_id = yo.seller_id and yo.rol = 'seller') or yo.rol in ('superadmin', 'ops'))
          order by (x.estado = 'resuelta'), x.creado desc limit 2150) d
    left join tumbo.disputa_casos c on c.disputa_id = d.id), '{}'::jsonb);
end $$;

-- Mensaje en el expediente (comprador, seller principal o el equipo), con
-- evidencia (archivos «evidencia» del reclamo o del pedido). Lo que escriben
-- las partes sale sin datos de contacto. Un mensaje del comercio en un
-- reclamo abierto cuenta como su respuesta; uno de la parte a la que se le
-- pidió evidencia responde la solicitud. Después de la decisión, el
-- expediente sigue abierto mientras hay apelaciones por revisar o la
-- devolución está en curso.
create function public.tm_disputa_mensaje(p_sesion text, p_id text, p_texto text, p_adjuntos text[]) returns jsonb
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

-- Operaciones pide evidencia a una parte con plazo (12 a 168 horas).
create function public.tm_disputa_solicitar(p_sesion text, p_id text, p_para text, p_texto text, p_horas integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d tumbo.disputas;
  v tumbo.pedidos;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_horas integer := coalesce(p_horas, tumbo_privado.comunicacion('horas_evidencia', 48)::integer);
  v_vence timestamptz;
  v_id bigint;
  u record;
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found then
    raise exception 'Disputa % no encontrada.', p_id;
  end if;
  v := tumbo_privado.bloquear_pedido(d.pedido_id, yo);
  if d.estado = 'resuelta' then
    raise exception 'La disputa % ya está resuelta.', p_id;
  end if;
  if p_para is null or p_para not in ('comprador', 'comercio') then
    raise exception 'Indica a quién le pides la evidencia.';
  end if;
  if char_length(v_texto) < 10 or char_length(v_texto) > 600 then
    raise exception 'Explica qué evidencia necesitas (10 a 600 caracteres).';
  end if;
  if v_horas < 12 or v_horas > 168 then
    raise exception 'El plazo va de 12 a 168 horas.';
  end if;
  if (select count(*) from tumbo.disputa_solicitudes where disputa_id = d.id) >= 10 then
    raise exception 'Este reclamo ya tiene 10 solicitudes de evidencia.';
  end if;
  v_vence := now() + make_interval(hours => v_horas);
  insert into tumbo.disputa_solicitudes (disputa_id, para, texto, vence, pedida_por)
  values (d.id, p_para, v_texto, v_vence, yo.nombre || ' (' || yo.rol || ')')
  returning id into v_id;
  insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto, solicitud_id)
  values (d.id, yo.id, 'tumbo', 'Operaciones Tumbo', 'Pedimos evidencia ' || case p_para when 'comprador' then 'al comprador' else 'al comercio' end ||
          ' antes del ' || tumbo_privado.fecha_legible(v_vence) || ': ' || v_texto, v_id);
  if p_para = 'comprador' then
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Operaciones pide evidencia de tu reclamo ' || d.id, 'photo_camera', 'tienda/reclamo.html?id=' || d.pedido_id);
    perform tumbo_privado.encolar(d.comprador_id, 'reclamo_evidencia', jsonb_build_object('reclamo', d.id, 'texto', v_texto,
      'vence', tumbo_privado.fecha_legible(v_vence), 'enlace', 'app/tienda/reclamo.html?id=' || d.pedido_id));
  else
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'Operaciones pide evidencia del reclamo ' || d.id, 'photo_camera', 'seller/disputas.html?id=' || d.id);
    for u in select x.id from tumbo.usuarios x where x.seller_id = d.seller_id and x.rol = 'seller' and x.activo order by x.id loop
      perform tumbo_privado.encolar(u.id, 'reclamo_evidencia', jsonb_build_object('reclamo', d.id, 'texto', v_texto,
        'vence', tumbo_privado.fecha_legible(v_vence), 'enlace', 'app/seller/disputas.html?id=' || d.id));
    end loop;
  end if;
  perform tumbo_privado.auditar(yo, 'Evidencia solicitada', d.id || ' → ' || p_para || ' · ' || v_horas || ' h');
  return jsonb_build_object('id', v_id, 'vence', v_vence);
end $$;

-- Apelación (una por parte, dentro del plazo, con evidencia nueva subida
-- después de la decisión; ver disputa_apelacion_impedida). En un reembolso
-- parcial pueden apelar las dos partes: la que apela primero no le quita la
-- suya a la otra, y una sola revisión decide las dos. La del comprador deja
-- (o vuelve a dejar) congelados los fondos hasta la revisión.
create function public.tm_disputa_apelar(p_sesion text, p_id text, p_motivo text, p_evidencia text[]) returns jsonb
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

-- Revisión de las apelaciones (otra persona que la que decidió; en un
-- reembolso parcial con una sola apelación, después de que venza el plazo
-- de la otra parte). p_datos = {resultado: confirmar | modificar, a_favor
-- (comprador | comercio: obligatorio si apelaron las dos), nota, decision?,
-- monto?, paga?}. Solo se modifica a favor de una parte que apeló:
--   · a favor del comprador (sus fondos están congelados): reembolso total
--     (lo que falta de lo que pagó, con el IGTF), reembolso parcial o
--     devolución (desde un reembolso parcial, solo el total);
--   · a favor del comercio: Tumbo le compensa hasta lo que le costó la
--     decisión (un ajuste a favor en su próxima liquidación); el comprador
--     conserva lo que recibió.
-- La decisión nueva queda también en tumbo.disputas (listas, tm_cargar y
-- reputación).
create function public.tm_disputa_apelacion_resolver(p_sesion text, p_id text, p_datos jsonb) returns jsonb
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
      select liquidacion_id into v_aj_liq from tumbo.ajustes_seller where id = c.ajuste_id;
      if v_aj_liq is not null then
        raise exception 'El descuento del reembolso parcial ya entró en una liquidación: lo corrige Finanzas con un ajuste.';
      end if;
      -- el comercio ya no cobra el pedido: el descuento parcial sobra
      delete from tumbo.ajustes_seller where id = c.ajuste_id;
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
        update tumbo.devoluciones set paga = v_paga, actualizado = now() where pedido_id = v.id and estado <> 'cerrada';
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

-- ---------------------------------------------------------------------------
-- Envío de vuelta de una devolución que paga el comercio o Tumbo
-- ---------------------------------------------------------------------------
-- El comprador reporta lo que pagó (en bolívares) con el recibo (archivos
-- «evidencia» del reclamo); hasta el equivalente de $200 y tres reportes.
create function public.tm_disputa_envio_vuelta(p_sesion text, p_id text, p_monto_bs numeric, p_recibo text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  cfg tumbo.config;
  v_bs numeric := round(coalesce(p_monto_bs, 0), 2);
  v_usd numeric;
  v_recibo text[] := coalesce(p_recibo, '{}');
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found or tumbo_privado.disputa_lado(yo, d) is distinct from 'comprador' then
    raise exception 'Reclamo % no encontrado.', p_id;
  end if;
  c := tumbo_privado.disputa_caso(d.id);
  select * into v from tumbo.pedidos where id = d.pedido_id;
  if c.decision is distinct from 'devolucion' or c.paga_logistica is null or c.paga_logistica not in ('seller', 'tumbo') then
    raise exception 'En este reclamo el envío de vuelta no se reintegra: no es una devolución que pague el comercio o Tumbo.';
  end if;
  if v.estado not in ('devolucion', 'reembolsado') then
    raise exception 'La devolución de este pedido no se concretó: no hay envío de vuelta que reintegrar.';
  end if;
  if c.vuelta_estado = 'reportado' then
    raise exception 'Ya reportaste el envío de vuelta: Operaciones lo está revisando.';
  end if;
  if c.vuelta_estado = 'reintegrado' then
    raise exception 'El envío de vuelta ya se reintegró.';
  end if;
  if c.resuelta_en < now() - interval '60 days' then
    raise exception 'Pasaron más de 60 días desde la decisión: escríbenos a soporte desde Ayuda.';
  end if;
  if (select count(*) from tumbo.disputa_mensajes m where m.disputa_id = d.id and m.autor_id = yo.id and m.texto like 'Envío de vuelta:%') >= 3 then
    raise exception 'Ya reportaste el envío de vuelta tres veces: escríbenos a soporte desde Ayuda.';
  end if;
  select * into cfg from tumbo.config;
  v_usd := round(v_bs / nullif(cfg.tasa, 0), 2);
  if v_bs <= 0 or v_usd is null or v_usd <= 0 or v_usd > 200 then
    raise exception 'Indica lo que pagaste por el envío en bolívares (hasta el equivalente de $200,00).';
  end if;
  if cardinality(v_recibo) = 0 or cardinality(v_recibo) > 5
     or not tumbo_privado.archivos_propios(v_recibo, yo.id, array['evidencia'], array[d.id, d.pedido_id]) then
    raise exception 'Adjunta el recibo del envío (hasta 5 archivos de evidencia subidos para este reclamo).';
  end if;
  update tumbo.disputa_casos
  set vuelta_estado = 'reportado', vuelta_bs = v_bs, vuelta_usd = v_usd, vuelta_recibo = v_recibo, vuelta_reportado = now(),
      vuelta_nota = null, vuelta_por = null
  where disputa_id = d.id;
  insert into tumbo.disputa_mensajes (disputa_id, autor_id, lado, autor, texto, adjuntos)
  values (d.id, yo.id, 'comprador', 'Comprador', 'Envío de vuelta: pagué ' || tumbo_privado.fmt_bs(v_bs) || ' (unos ' || tumbo_privado.fmt_usd(v_usd) ||
          ' a la tasa de hoy). Adjunto el recibo para el reintegro.', v_recibo);
  perform tumbo_privado.notificar('rol:ops', 'El comprador reportó el envío de vuelta del reclamo ' || d.id || ' para su reintegro', 'local_shipping',
    'admin/disputas.html?id=' || d.id);
  perform tumbo_privado.auditar(yo, 'Envío de vuelta reportado', d.id || ' · ' || tumbo_privado.fmt_bs(v_bs));
  return jsonb_build_object('ok', true, 'usd', v_usd);
end $$;

-- Operaciones revisa el recibo: lo rechaza (con el motivo; el comprador
-- puede reportarlo de nuevo) o lo reintegra cuando la devolución ya se cerró
-- con su reembolso. El reintegro es otro reembolso del pedido (Finanzas lo
-- envía al destino que elija el comprador) con su asiento: lo carga el
-- comercio (por_pagar_seller y un descuento en su próxima liquidación) o
-- Tumbo (devoluciones_envio). Dinero de un pedido real: cuenta real con
-- sesión elevada. p_datos = {aprobar, monto_usd? (hasta lo reportado), nota}.
create function public.tm_disputa_envio_vuelta_resolver(p_sesion text, p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  x jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  d tumbo.disputas;
  v tumbo.pedidos;
  c tumbo.disputa_casos;
  cfg tumbo.config;
  v_aprobar boolean;
  v_monto numeric;
  v_nota text := left(btrim(coalesce(x ->> 'nota', '')), 500);
  v_id bigint;
  v_umbral numeric := tumbo_privado.numero(coalesce(tumbo_privado.ajuste('reembolsos'), '{}'::jsonb) -> 'umbral_doble_usd', 200);
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
  select * into cfg from tumbo.config;
  insert into tumbo.reembolsos (pedido_id, monto_usd, monto_bs, tasa, motivo, por, pago_id, comprador_id, requiere_doble, tipo)
  values (v.id, v_monto, round(v_monto * cfg.tasa, 2), cfg.tasa,
          left('Reintegro del envío de vuelta (reclamo ' || d.id || '; lo paga ' || case c.paga_logistica when 'seller' then 'el comercio' else 'Tumbo' end || ')', 300),
          tumbo_privado.actor(yo), v.pago_id, v.comprador_id, v_monto >= v_umbral, 'pedido')
  returning id into v_id;
  if v.pago_id is not null then
    perform tumbo_privado.asentar('reembolso', 'R-' || v_id, 'Reintegro del envío de vuelta del pedido ' || v.id || ' (reclamo ' || d.id || ') por pagar',
      tumbo_privado.actor(yo),
      case when c.paga_logistica = 'seller'
           then jsonb_build_array(jsonb_build_object('cuenta', 'por_pagar_seller', 'seller', v.seller_id, 'debe', v_monto),
                                  jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'haber', v_monto))
           else jsonb_build_array(jsonb_build_object('cuenta', 'devoluciones_envio', 'debe', v_monto),
                                  jsonb_build_object('cuenta', 'reembolsos_por_pagar', 'haber', v_monto)) end);
  end if;
  if c.paga_logistica = 'seller' then
    -- (sin asiento propio, como el reembolso parcial: el reintegro ya cargó por_pagar_seller)
    insert into tumbo.ajustes_seller (seller_id, monto_usd, motivo, por)
    values (v.seller_id, -v_monto, left('Envío de vuelta del reclamo ' || d.id || ' (pedido ' || v.id || ')', 300), 'Sistema (reclamo ' || d.id || ')');
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
-- Archivos de este dominio
-- ---------------------------------------------------------------------------
-- Quién sube o ve los archivos de Comunicación:
--   · resena (público): el comprador del pedido que puede calificarlo
--     (entidad = el pedido);
--   · soporte (privado): quien abre o responde un caso (entidad = su
--     cuenta o el caso) y el equipo de soporte de ese caso;
--   · chat: además de lo de la ola 0 (comprador y comercio del pedido), el
--     equipo cuando el pedido tiene un reclamo (con una cuenta de prueba,
--     solo los pedidos de la demo).
create function tumbo_privado.archivo_permitido_comunicacion(p_yo tumbo.usuarios, p_proposito text, p_entidad text, p_accion text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  t tumbo.tickets;
begin
  if p_yo.id is null or p_entidad is null then
    return false;
  end if;
  if p_proposito = 'resena' then
    if p_accion = 'ver' then
      return true;
    end if;
    select * into v from tumbo.pedidos where id = p_entidad;
    return p_yo.rol = 'comprador' and v.id is not null and tumbo_privado.resena_impedida(p_yo, v) is null;
  elsif p_proposito = 'soporte' then
    if p_entidad = p_yo.id::text then
      return true;
    end if;
    select * into t from tumbo.tickets where id = p_entidad;
    if t.id is not null then
      return tumbo_privado.ticket_visible(p_yo, t);
    end if;
    -- lo que un cliente adjuntó al abrir su caso (entidad = su cuenta): lo ve el equipo de soporte de ese caso
    return p_accion = 'ver' and tumbo_privado.es_soporte(p_yo)
       and exists (select 1 from tumbo.tickets x where x.usuario_id::text = p_entidad and tumbo_privado.ticket_visible(p_yo, x));
  elsif p_proposito = 'chat' then
    select * into v from tumbo.pedidos where id = p_entidad;
    return v.id is not null and p_yo.rol in ('superadmin', 'ops') and v.disputa_id is not null
       and (not tumbo_privado.cuenta_demo(p_yo.email) or not tumbo_privado.pedido_real(v));
  end if;
  return false;
end $$;

-- tumbo_privado.archivo_permitido (ola 0) la redefine también la integración
-- de la ola 1 (20261023190000); para no depender del orden, se extienden
-- quienes la consultan, que solo define la ola 0: los propósitos de
-- Comunicación los decide además archivo_permitido_comunicacion (una línea
-- en cada una).

-- Desde la de fundaciones (sin cambios salvo la consulta de permisos).
create or replace function public.tm_archivo_preparar(p_sesion text, p_proposito text, p_entidad text, p_tipo text,
                                                      p_bytes bigint, p_nombre text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  pr tumbo.archivo_propositos;
  v_tipo text := lower(trim(coalesce(p_tipo, '')));
  v_entidad text := trim(coalesce(p_entidad, ''));
  v_nombre text := left(regexp_replace(trim(coalesce(p_nombre, '')), '[[:cntrl:]/\\<>"]+', '', 'g'), 120);
  v_cuotas jsonb := coalesce(tumbo_privado.ajuste('cuotas_archivos'), '{}'::jsonb);
  v_por_dia numeric := tumbo_privado.numero(v_cuotas -> 'archivos_por_dia', 100);
  v_red text := tumbo_privado.ip_cliente();
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  v_id uuid := gen_random_uuid();
  v_bucket text;
  v_excedida text;
  v_ext text;
  v_ruta text;
begin
  select * into pr from tumbo.archivo_propositos where proposito = p_proposito;
  if not found then
    raise exception 'Ese tipo de adjunto no existe.';
  end if;
  if not (v_tipo = any (pr.tipos)) then
    raise exception 'Ese archivo no se admite aquí: sube %.', tumbo_privado.tipos_legibles(pr.tipos);
  end if;
  if p_bytes is null or p_bytes <= 0 then
    raise exception 'El archivo está vacío.';
  end if;
  if p_bytes > pr.max_bytes then
    raise exception 'El archivo pesa más de % MB, el máximo para este adjunto.', round(pr.max_bytes / 1048576.0);
  end if;
  if char_length(v_entidad) = 0 or char_length(v_entidad) > 60
     or not (coalesce(tumbo_privado.archivo_permitido(yo, pr.proposito, v_entidad, 'subir'), false)
             or coalesce(tumbo_privado.archivo_permitido_comunicacion(yo, pr.proposito, v_entidad, 'subir'), false)) then
    raise exception 'No puedes adjuntar archivos a «%».', left(v_entidad, 60);
  end if;
  v_bucket := case when pr.publico then 'tumbo-espera' else pr.bucket end;

  -- Las subidas de una cuenta (y de un comercio) se cuentan de a una.
  perform tumbo_privado.bloquear_usuario(yo.id, 'archivos');
  if (select count(*) from tumbo.archivos
      where propietario = yo.id and creado > now() - interval '1 day' and (not v_demo or red = v_red)) >= v_por_dia then
    raise exception 'Llegaste al máximo de % archivos por día. Podrás subir más mañana.', trunc(v_por_dia);
  end if;
  if v_demo and (select count(*) from tumbo.archivos
                 where propietario = yo.id and creado > now() - interval '1 day') >= v_por_dia * 10 then
    raise exception 'Esta cuenta de prueba ya subió muchos archivos hoy. Podrás subir más mañana.';
  end if;
  if yo.seller_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('tumbo:archivos:' || yo.seller_id, 0));
  end if;
  v_excedida := tumbo_privado.cuota_excedida(yo.seller_id, yo.id, null, p_bytes);
  if v_excedida is not null then
    raise exception '%', v_excedida;
  end if;

  v_ext := case v_tipo when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                       when 'application/pdf' then 'pdf' when 'video/mp4' then 'mp4' else 'bin' end;
  v_ruta := pr.proposito || '/' || coalesce(yo.seller_id, yo.id::text) || '/' || v_id::text || '.' || v_ext;
  insert into tumbo.archivos (id, proposito, bucket, ruta, entidad, propietario, seller_id, tipo, bytes, reserva, nombre, red)
  values (v_id, pr.proposito, v_bucket, v_ruta, v_entidad, yo.id, yo.seller_id, v_tipo, p_bytes,
          greatest(p_bytes, tumbo_privado.tope_bucket(v_bucket, pr.max_bytes)), v_nombre, v_red);
  return jsonb_build_object('id', v_id, 'bucket', v_bucket, 'ruta', v_ruta);
end $$;

-- Desde la de fundaciones (sin cambios salvo la consulta de permisos).
create or replace function public.tm_archivo_acceso(p_sesion text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  a tumbo.archivos;
  pr tumbo.archivo_propositos;
begin
  select * into a from tumbo.archivos where id = p_id and estado = 'listo';
  select * into pr from tumbo.archivo_propositos where proposito = a.proposito;
  if a.id is null or not coalesce(pr.publico or a.propietario = yo.id
                                  or tumbo_privado.archivo_permitido(yo, a.proposito, a.entidad, 'ver')
                                  or tumbo_privado.archivo_permitido_comunicacion(yo, a.proposito, a.entidad, 'ver'), false) then
    raise exception 'No encontramos ese archivo.';
  end if;
  return jsonb_build_object('id', a.id, 'bucket', a.bucket, 'ruta', a.ruta, 'publico', pr.publico,
                            'tipo', a.tipo, 'bytes', a.bytes, 'nombre', a.nombre);
end $$;

-- ---------------------------------------------------------------------------
-- Tarea programada del dominio (pg_cron cada 15 minutos, si existe; las
-- pruebas y Operaciones la pueden correr a mano)
-- ---------------------------------------------------------------------------
--   · recuerda al comercio 24 h antes de que venza su plazo para responder
--     un reclamo y, al vencer sin respuesta, aplica el fallo automático a
--     favor del comprador (reembolso total);
--   · vence las solicitudes de evidencia sin respuesta (avisa a Operaciones);
--   · avisa a Operaciones de los casos de soporte que pasaron su SLA de
--     primera respuesta (una vez por caso);
--   · libera (elegibles para la liquidación) los fondos de los reclamos
--     resueltos cuyo plazo de apelación venció sin apelación del comprador;
--   · deja la versión vigente de los términos como la del registro (una
--     versión publicada con fecha futura entra en vigor sola).
create function tumbo_privado.tarea_comunicacion() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_sistema tumbo.usuarios;
  v_fallos integer := 0;
  v_omitidos integer := 0;
  v_errores integer := 0;
  v_recordatorios integer := 0;
  v_vencidas integer := 0;
  v_sla integer := 0;
  v_liberados integer := 0;
  v_horas integer := tumbo_privado.comunicacion('horas_respuesta_reclamo', 72)::integer;
  v_terminos tumbo.documentos_legales;
  u record;
begin
  -- (una corrida a la vez)
  if not pg_try_advisory_xact_lock(hashtextextended('tumbo:tarea_comunicacion', 0)) then
    return jsonb_build_object('omitida', true);
  end if;
  for r in
    select d.id, d.seller_id, d.pedido_id, c.plazo_seller from tumbo.disputas d join tumbo.disputa_casos c on c.disputa_id = d.id
    where d.estado = 'abierta' and c.respondida_en is null and c.decision is null and c.aviso_plazo is null
      and c.plazo_seller between now() and now() + interval '24 hours'
    order by c.plazo_seller limit 200
  loop
    update tumbo.disputa_casos set aviso_plazo = now() where disputa_id = r.id;
    perform tumbo_privado.notificar('seller:' || r.seller_id, 'Te quedan menos de 24 horas para responder el reclamo ' || r.id ||
      ': si no respondes, se resuelve a favor del comprador', 'timer', 'seller/disputas.html?id=' || r.id);
    for u in select x.id from tumbo.usuarios x where x.seller_id = r.seller_id and x.rol = 'seller' and x.activo order by x.id loop
      perform tumbo_privado.encolar(u.id, 'reclamo_comercio', jsonb_build_object('reclamo', r.id, 'pedido', r.pedido_id,
        'estado', 'te quedan menos de 24 horas para responder (hasta el ' || tumbo_privado.fecha_legible(r.plazo_seller) || ')',
        'enlace', 'app/seller/disputas.html?id=' || r.id));
    end loop;
    v_recordatorios := v_recordatorios + 1;
  end loop;

  -- (el reclamo que alguien tiene bloqueado, p. ej. el comercio respondiendo
  -- justo al vencer, se salta; disputa_resolver_interno vuelve a mirarlo ya
  -- bloqueado y no falla el que se respondió mientras tanto)
  for r in
    select d.id from tumbo.disputas d join tumbo.disputa_casos c on c.disputa_id = d.id
    where d.estado = 'abierta' and c.respondida_en is null and c.decision is null and c.plazo_seller < now()
    order by c.plazo_seller limit 50
    for update of d skip locked
  loop
    begin
      if tumbo_privado.disputa_resolver_interno(v_sistema, r.id, 'reembolso',
           'Fallo automático: el comercio no respondió en ' || v_horas || ' horas.', null, null, 'fallo_automatico') then
        v_fallos := v_fallos + 1;
      else
        v_omitidos := v_omitidos + 1;
      end if;
    exception when others then
      v_errores := v_errores + 1;
      perform tumbo_privado.notificar('rol:ops', 'No se pudo aplicar el fallo automático de ' || r.id || ': ' || left(sqlerrm, 160), 'warning',
        'admin/disputas.html?id=' || r.id);
    end;
  end loop;

  for r in
    update tumbo.disputa_solicitudes set estado = 'vencida' where estado = 'pendiente' and vence < now()
    returning disputa_id, para
  loop
    v_vencidas := v_vencidas + 1;
    insert into tumbo.disputa_mensajes (disputa_id, lado, autor, texto)
    values (r.disputa_id, 'sistema', 'Tumbo', 'Venció el plazo de la evidencia pedida ' ||
            case r.para when 'comprador' then 'al comprador' else 'al comercio' end || ': Operaciones decide con lo que hay en el expediente.');
    perform tumbo_privado.notificar('rol:ops', 'Venció la evidencia pedida en ' || r.disputa_id, 'timer', 'admin/disputas.html?id=' || r.disputa_id);
  end loop;

  for r in
    update tumbo.tickets set sla_avisado = now()
    where primera_respuesta is null and estado <> 'cerrado' and sla_vence < now() and sla_avisado is null
    returning id, asunto
  loop
    v_sla := v_sla + 1;
    perform tumbo_privado.notificar('rol:ops', 'El caso ' || r.id || ' pasó su tiempo de primera respuesta: ' || left(r.asunto, 60), 'timer',
      'admin/soporte.html?id=' || r.id);
  end loop;

  for r in
    select p.id, p.seller_id, p.disputa_id from tumbo.pedidos p join tumbo.disputas d on d.id = p.disputa_id
    where p.liquidacion = 'congelado' and p.estado = 'cerrado' and p.liquidacion_id is null and d.estado = 'resuelta'
      and not tumbo_privado.disputa_retiene_fondos(d.id)
    order by p.id limit 500
    for update of p skip locked
  loop
    update tumbo.pedidos set liquidacion = 'elegible' where id = r.id;
    perform tumbo_privado.evento(r.id, 'Sistema', 'Venció el plazo de apelación del reclamo ' || r.disputa_id || ' · fondos elegibles para la liquidación', 'lock_open');
    perform tumbo_privado.notificar('seller:' || r.seller_id, 'Los fondos del pedido ' || r.id || ' ya son elegibles: venció el plazo de apelación del reclamo ' ||
      r.disputa_id, 'lock_open', 'seller/finanzas.html');
    v_liberados := v_liberados + 1;
  end loop;

  v_terminos := tumbo_privado.legal_vigente('terminos');
  if v_terminos.version is not null then
    update tumbo.ajustes set valor = to_jsonb(v_terminos.version), actualizado = now(), por = 'Sistema (documentos legales)'
    where clave = 'terminos_version' and valor is distinct from to_jsonb(v_terminos.version);
  end if;
  return jsonb_build_object('recordatorios', v_recordatorios, 'fallos_automaticos', v_fallos, 'fallos_omitidos', v_omitidos, 'errores', v_errores,
                            'evidencias_vencidas', v_vencidas, 'soporte_vencidos', v_sla, 'fondos_liberados', v_liberados);
end $$;

-- Operaciones corre la tarea a mano (como mucho una vez por minuto).
create function public.tm_comunicacion_revisar(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
begin
  perform pg_advisory_xact_lock(hashtextextended('tumbo:comunicacion_revisar', 0));
  if exists (select 1 from tumbo.auditoria a where a.accion = 'Plazos de comunicación revisados' and a.fecha > now() - interval '1 minute') then
    raise exception 'Los plazos se revisaron hace menos de un minuto.';
  end if;
  perform tumbo_privado.auditar(yo, 'Plazos de comunicación revisados', '');
  return tumbo_privado.tarea_comunicacion();
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute $c$select cron.schedule('tumbo-comunicacion', '*/15 * * * *', 'select tumbo_privado.tarea_comunicacion()')$c$;
      execute $c$select cron.schedule('tumbo-envios', '* * * * *', 'select tumbo_privado.tarea_envios()')$c$;
    exception when others then
      raise notice 'No se programaron las tareas de comunicación (%): se pueden correr a mano.', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reinicio de la demo
-- ---------------------------------------------------------------------------
-- Lo llama tm_reiniciar_demo después de la semilla base: borra (con WHERE:
-- pg-safeupdate) lo que cuelga de pedidos y reclamos (el reinicio vuelve a
-- usar sus identificadores: chats, reseñas, expedientes), lo que escribieron
-- las cuentas de prueba (preguntas, denuncias, casos de soporte, avisos) y
-- crea el caso de los reclamos sembrados con su plazo desde hoy. Lo de las
-- personas reales se conserva: sus preguntas (con su respuesta; los SKU de
-- la demo vuelven con la semilla), sus denuncias, sus casos (sin el pedido)
-- y sus avisos. Preferencias y aceptaciones legales son de las cuentas: se
-- conservan; el consentimiento de WhatsApp de las cuentas de prueba vuelve
-- a «sin dar». No siembra mensajes, preguntas ni reseñas: nada inventado.
create function tumbo_privado.sembrar_ext_comunicacion(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from tumbo.chat_mensajes where id is not null;
  delete from tumbo.chat_lecturas where pedido_id is not null;
  delete from tumbo.chat_avisos where pedido_id is not null;
  delete from tumbo.preguntas where autor_id is null or not tumbo_privado.comprador_real(autor_id);
  delete from tumbo.respuestas_rapidas where not tumbo_privado.seller_real(seller_id);
  update tumbo.archivos set estado = 'descartado', motivo = 'reinicio de la demo'
  where proposito = 'resena' and estado <> 'descartado';
  delete from tumbo.resenas where id is not null;
  delete from tumbo.disputa_mensajes where id is not null;
  delete from tumbo.disputa_solicitudes where id is not null;
  delete from tumbo.disputa_apelaciones where disputa_id is not null;
  delete from tumbo.disputa_casos where disputa_id is not null;
  delete from tumbo.denuncias where autor_id is null or not tumbo_privado.comprador_real(autor_id);
  delete from tumbo.tickets
  where usuario_id is null or usuario_id in (select u.id from tumbo.usuarios u where tumbo_privado.cuenta_demo(u.email));
  update tumbo.tickets set pedido_id = null where pedido_id is not null;
  delete from tumbo.salida where plantilla in ('chat_mensaje', 'pregunta_nueva', 'pregunta_respondida', 'resena_pendiente', 'resena_nueva',
                                               'resena_respondida', 'reclamo_comercio', 'reclamo_evidencia')
    and (usuario_id is null or not tumbo_privado.comprador_real(usuario_id));
  -- lo de las cuentas de prueba: sus casos ya se borraron; el consentimiento
  -- de WhatsApp vuelve a «sin dar» (su teléfono lo pone quien prueba)
  delete from tumbo.salida
  where plantilla in ('ticket_creado', 'ticket_actualizado')
    and usuario_id in (select u.id from tumbo.usuarios u where tumbo_privado.cuenta_demo(u.email));
  delete from tumbo.consentimientos_whatsapp
  where usuario_id in (select u.id from tumbo.usuarios u where tumbo_privado.cuenta_demo(u.email));
  insert into tumbo.disputa_casos (disputa_id, plazo_seller, respondida_en, decision, resuelta_en)
  select d.id, now() + make_interval(hours => tumbo_privado.comunicacion('horas_respuesta_reclamo', 72)::integer),
         d.respuesta_fecha, d.resolucion_decision, d.resolucion_fecha
  from tumbo.disputas d
  on conflict (disputa_id) do nothing;
end $$;

-- Los reclamos que ya existían reciben su caso (con el plazo desde hoy).
insert into tumbo.disputa_casos (disputa_id, plazo_seller, respondida_en, decision, resuelta_en)
select d.id, now() + interval '72 hours', d.respuesta_fecha, d.resolucion_decision, d.resolucion_fecha
from tumbo.disputas d
on conflict (disputa_id) do nothing;

-- ---------------------------------------------------------------------------
-- Privilegios: las funciones nuevas de la API, por firma exacta (las
-- redefinidas conservan los suyos). Las de la función tumbo-envios, solo
-- para la clave de servicio.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

do $$
declare
  f regprocedure;
  v_servicio boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  foreach f in array array[
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
    'public.tm_denunciar(text,text,text,text,text)', 'public.tm_contenido_cola(text,text)',
    'public.tm_contenido_moderar(text,text,bigint,text,text)', 'public.tm_denuncia_cerrar(text,bigint,text,text)',
    'public.tm_ticket_crear(text,jsonb)', 'public.tm_tickets(text,jsonb)', 'public.tm_ticket(text,text)',
    'public.tm_ticket_responder(text,text,text,uuid[],boolean)', 'public.tm_ticket_gestionar(text,text,jsonb)',
    'public.tm_soporte_macro_guardar(text,bigint,jsonb)',
    'public.tm_disputa(text,text)', 'public.tm_disputas_resumen(text)', 'public.tm_disputa_resolver(text,text,jsonb)',
    'public.tm_disputa_mensaje(text,text,text,text[])', 'public.tm_disputa_solicitar(text,text,text,text,integer)',
    'public.tm_disputa_apelar(text,text,text,text[])', 'public.tm_disputa_apelacion_resolver(text,text,jsonb)',
    'public.tm_disputa_envio_vuelta(text,text,numeric,text[])', 'public.tm_disputa_envio_vuelta_resolver(text,text,jsonb)',
    'public.tm_comunicacion_revisar(text)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.tm_envios_autorizar(text,text)', 'public.tm_envios_tomar(text[],integer)',
    'public.tm_envios_resultado(bigint,boolean,text,text,text,boolean)', 'public.tm_envios_reporte(jsonb)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if v_servicio then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
