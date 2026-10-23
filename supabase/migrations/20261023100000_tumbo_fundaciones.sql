-- =========================================================================
-- Tumbo Market — Ola 0: fundaciones
-- -------------------------------------------------------------------------
-- Lo común que necesitan los equipos de las olas siguientes (ver
-- docs/PLAN-PRODUCCION.md):
--   · ajustes de la plataforma (tumbo.ajustes) con lectura pública de los
--     marcados como públicos y edición solo del superadministrador;
--   · contacto y verificaciones del usuario, direcciones completas y la
--     columna `destino` del pedido (la llenará la ola 1);
--   · archivos: propósitos con su bucket, tamaño y tipos; permisos por
--     propósito; cuotas contra el abuso del almacenamiento compartido;
--     preparar → subir con URL firmada (función tumbo-archivos) → confirmar;
--   · bandeja de mensajes salientes (plantillas, preferencias y cola): nada
--     se envía todavía, eso es de la ola 2;
--   · reembolsos básicos: los flujos que antes solo avisaban a Finanzas ahora
--     crean el reembolso;
--   · contratos entre equipos (sesión elevada, permisos finos, cotización de
--     envío, promociones, riesgo) en su versión mínima y documentada.
-- Solo agrega: no borra ni reescribe datos ni objetos existentes.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Ajustes
-- ---------------------------------------------------------------------------
create table tumbo.ajustes (
  clave       text primary key check (clave ~ '^[a-z][a-z0-9_]{1,59}$'),
  valor       jsonb not null,
  publico     boolean not null default false,
  descripcion text,
  actualizado timestamptz not null default now(),
  por         text
);
alter table tumbo.ajustes enable row level security;
revoke all on tumbo.ajustes from public, anon, authenticated;

-- Lo que falta lo dice el propio valor: nada se presenta como real.
insert into tumbo.ajustes (clave, valor, publico, descripcion) values
  ('pagos_beneficiario', '{
     "configurado": false,
     "nota": "Pendiente de configurar: la persona dueña del proyecto debe cargar los datos reales antes de cobrar.",
     "metodos": {
       "Pago Móvil": {"banco": "PENDIENTE DE CONFIGURAR", "telefono": "PENDIENTE DE CONFIGURAR",
                      "rif": "PENDIENTE DE CONFIGURAR", "titular": "PENDIENTE DE CONFIGURAR"},
       "Transferencia": {"banco": "PENDIENTE DE CONFIGURAR", "cuenta": "PENDIENTE DE CONFIGURAR",
                         "rif": "PENDIENTE DE CONFIGURAR", "titular": "PENDIENTE DE CONFIGURAR"}
     }}', true,
   'Datos del beneficiario que ve el comprador para pagar, por método.'),
  ('checkout_activo', 'true', true, 'Interruptor: permite crear pedidos desde el checkout.'),
  ('registro_activo', 'true', true, 'Interruptor: permite registrar cuentas nuevas desde la web.'),
  ('aviso_incidencia', 'null', true, 'Aviso visible en la tienda durante una incidencia (texto), o null si no hay.'),
  ('soporte', '{"configurado": false, "whatsapp": "PENDIENTE DE CONFIGURAR", "correo": "PENDIENTE DE CONFIGURAR",
                "horario": "PENDIENTE DE CONFIGURAR"}', true,
   'Canales y horario de atención que la tienda muestra.'),
  ('cuotas_archivos', '{"archivos_por_dia": 100, "mb_por_seller": 300, "mb_por_usuario": 300}', false,
   'Topes del almacenamiento compartido: archivos por usuario y día, y MB en total por comercio y por cuenta sin comercio.')
on conflict (clave) do nothing;

create function tumbo_privado.ajuste(p_clave text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select valor from tumbo.ajustes where clave = p_clave
$$;

create function public.tm_ajustes_publicos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(a.clave, a.valor order by a.clave), '{}'::jsonb) from tumbo.ajustes a where a.publico
$$;

-- Contrato: la ola 1 (Cuentas) exige aquí una sesión elevada con el segundo
-- factor verificado en el servidor. Hasta entonces no hace nada.
create function tumbo_privado.exigir_elevada(p_yo tumbo.usuarios) returns void
language plpgsql security definer set search_path = '' as $$
begin
  return;
end $$;

-- Contrato: permisos finos por persona (ola 1, Cuentas). Por ahora solo el
-- superadministrador los tiene todos.
create function tumbo_privado.tiene_permiso(p_yo tumbo.usuarios, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_yo.rol = 'superadmin', false)
$$;

-- Edición de un ajuste existente. El tipo se conserva (un interruptor sigue
-- siendo verdadero/falso); null vale para los ajustes que se pueden vaciar.
create function public.tm_ajuste_guardar(p_sesion text, p_clave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  a tumbo.ajustes;
  v_valor jsonb := coalesce(p_valor, 'null'::jsonb);
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into a from tumbo.ajustes where clave = p_clave for update;
  if not found then
    raise exception 'El ajuste «%» no existe.', left(coalesce(p_clave, ''), 60);
  end if;
  if octet_length(v_valor::text) > 20000 then
    raise exception 'El valor del ajuste es demasiado grande.';
  end if;
  if jsonb_typeof(a.valor) <> 'null' and jsonb_typeof(v_valor) <> 'null' and jsonb_typeof(a.valor) <> jsonb_typeof(v_valor) then
    raise exception 'El ajuste «%» espera %.', a.clave,
      case jsonb_typeof(a.valor) when 'boolean' then 'sí o no' when 'number' then 'un número' when 'string' then 'un texto'
                                 when 'array' then 'una lista' else 'un conjunto de datos' end;
  end if;
  update tumbo.ajustes set valor = v_valor, actualizado = now(), por = yo.nombre || ' (' || yo.rol || ')'
  where clave = a.clave;
  perform tumbo_privado.auditar(yo, 'Ajuste cambiado',
    a.clave || ': ' || left(a.valor::text, 400) || ' → ' || left(v_valor::text, 400));
  return v_valor;
end $$;

-- ---------------------------------------------------------------------------
-- Contacto del usuario, direcciones completas y destino del pedido
-- ---------------------------------------------------------------------------
alter table tumbo.usuarios
  add column telefono            text check (telefono is null or char_length(telefono) <= 20),
  add column cedula              text check (cedula is null or char_length(cedula) <= 15),
  add column correo_verificado   boolean not null default false,
  add column telefono_verificado boolean not null default false,
  add column ultimo_acceso       timestamptz;

-- (linea, municipio, ciudad y predeterminada ya existen)
alter table tumbo.direcciones
  add column estado                text check (estado is null or char_length(estado) <= 40),
  add column parroquia             text check (parroquia is null or char_length(parroquia) <= 80),
  add column referencia            text check (referencia is null or char_length(referencia) <= 200),
  add column destinatario          text check (destinatario is null or char_length(destinatario) <= 80),
  add column cedula_destinatario   text check (cedula_destinatario is null or char_length(cedula_destinatario) <= 15),
  add column telefono_destinatario text check (telefono_destinatario is null or char_length(telefono_destinatario) <= 20);

-- Foto de la dirección y del destinatario al crear el pedido: el pedido se
-- sigue entregando bien aunque la dirección cambie o se borre después.
alter table tumbo.pedidos add column destino jsonb;

-- El perfil lleva el teléfono y las verificaciones; la cédula no hace falta
-- en el navegador.
create or replace function tumbo_privado.perfil_json(u tumbo.usuarios) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'nombre', u.nombre, 'rol', u.rol,
                            'sellerId', u.seller_id, 'mfa', u.mfa, 'telefono', u.telefono,
                            'correoVerificado', u.correo_verificado, 'telefonoVerificado', u.telefono_verificado)
$$;

-- ---------------------------------------------------------------------------
-- Archivos
--   Cada archivo tiene un propósito, que fija su bucket, su tamaño máximo,
--   sus tipos y quién lo sube o lo ve. La ruta la decide el servidor:
--   <propósito>/<seller o usuario>/<uuid>.<ext>. El navegador sube con una
--   URL firmada que pide la función tumbo-archivos y después confirma: el
--   archivo queda «listo» solo si Storage lo tiene con el tamaño y el tipo
--   autorizados.
-- ---------------------------------------------------------------------------
create table tumbo.archivo_propositos (
  proposito text primary key,
  bucket    text not null,
  max_bytes bigint not null check (max_bytes > 0),
  tipos     text[] not null,
  publico   boolean not null default false
);
alter table tumbo.archivo_propositos enable row level security;
revoke all on tumbo.archivo_propositos from public, anon, authenticated;

insert into tumbo.archivo_propositos (proposito, bucket, max_bytes, tipos, publico) values
  ('producto',    'tumbo-publico',  5242880, array['image/jpeg', 'image/png', 'image/webp'], true),
  ('perfil',      'tumbo-publico',  3145728, array['image/jpeg', 'image/png', 'image/webp'], true),
  ('kyc',         'tumbo-privado',  8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], false),
  ('evidencia',   'tumbo-privado', 15728640, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'], false),
  ('comprobante', 'tumbo-privado',  5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], false),
  ('guia',        'tumbo-privado',  5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], false),
  ('entrega',     'tumbo-privado',  8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], false),
  ('chat',        'tumbo-privado',  8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], false),
  ('liquidacion', 'tumbo-privado',  5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], false)
on conflict (proposito) do nothing;

create table tumbo.archivos (
  id          uuid primary key default gen_random_uuid(),
  proposito   text not null references tumbo.archivo_propositos (proposito),
  bucket      text not null,
  ruta        text not null unique,
  entidad     text not null,                          -- SKU, seller, pedido, reclamo o liquidación
  propietario uuid not null references tumbo.usuarios (id) on delete cascade,
  seller_id   text references tumbo.sellers (id),     -- comercio de quien sube (cuota)
  tipo        text not null,
  bytes       bigint not null check (bytes > 0),
  nombre      text not null default '',
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'listo')),
  red         text not null default 'desconocida',
  creado      timestamptz not null default now(),
  confirmado  timestamptz
);
create index archivos_propietario_idx on tumbo.archivos (propietario, creado desc);
create index archivos_seller_idx on tumbo.archivos (seller_id) where seller_id is not null;
create index archivos_entidad_idx on tumbo.archivos (proposito, entidad);
alter table tumbo.archivos enable row level security;
revoke all on tumbo.archivos from public, anon, authenticated;

-- Buckets de Storage, solo donde existe Storage (en el Postgres local de las
-- pruebas lo crea tools/supabase-local/base.sql). Storage también impone el
-- tamaño y los tipos al subir.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
        ('tumbo-publico', 'tumbo-publico', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
        ('tumbo-privado', 'tumbo-privado', false, 15728640,
         array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'])
      on conflict (id) do nothing $q$;
  end if;
end $$;

-- Tipos admitidos, en palabras: «imágenes (JPG, PNG o WebP), PDF o video MP4».
create function tumbo_privado.tipos_legibles(p_tipos text[]) returns text
language sql immutable set search_path = '' as $$
  select case when cardinality(y.a) = 1 then y.a[1]
              else array_to_string(y.a[1:cardinality(y.a) - 1], ', ') || ' o ' || y.a[cardinality(y.a)] end
  from (select array_agg(x.nombre order by x.orden) as a
        from (select distinct
                case when t like 'image/%' then 'imágenes (JPG, PNG o WebP)' when t = 'application/pdf' then 'PDF'
                     when t = 'video/mp4' then 'video MP4' else t end as nombre,
                case when t like 'image/%' then 1 when t = 'application/pdf' then 2 when t = 'video/mp4' then 3 else 4 end as orden
              from unnest(p_tipos) t) x) y
$$;

-- ¿Puede esta persona subir (o ver) un archivo de este propósito sobre esta
-- entidad? Una entidad que no existe o que no es suya responde que no.
--   producto    · seller u operador del comercio dueño del SKU (nuevo: entidad = su seller)
--   perfil      · seller principal de ese comercio
--   kyc         · seller principal de ese comercio (ver: también superadmin)
--   evidencia   · partes del reclamo o del pedido (comprador, seller) y superadmin/ops
--   comprobante · comprador del pedido (ver: también finanzas y superadmin)
--   guia/entrega· seller u operador del pedido y ops/superadmin (ver: también el comprador)
--   chat        · partes del pedido (comprador, seller, operador)
--   liquidacion · finanzas y superadmin (ver: también el seller de la liquidación)
-- El comercio solo alcanza los pedidos que ya ve (pago conciliado), como en
-- tm_cargar.
create function tumbo_privado.archivo_permitido(p_yo tumbo.usuarios, p_proposito text, p_entidad text, p_accion text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ver boolean := p_accion = 'ver';
  v_equipo boolean := coalesce(p_yo.rol in ('superadmin', 'ops'), false);
  v_comercio boolean := coalesce(p_yo.rol in ('seller', 'operador'), false);
  v_principal boolean := coalesce(p_yo.rol = 'seller', false);
  v_comprador uuid;
  v_seller text;
  v_seller_ve boolean := false;
  v_ok boolean := false;
begin
  if p_yo.id is null or p_entidad is null or p_accion is null or p_accion not in ('subir', 'ver') then
    return false;
  end if;

  if p_proposito = 'producto' then
    v_ok := v_comercio and (p_entidad = p_yo.seller_id
      or exists (select 1 from tumbo.productos p where p.sku = p_entidad and p.seller_id = p_yo.seller_id));
  elsif p_proposito = 'perfil' then
    v_ok := v_principal and p_entidad = p_yo.seller_id;
  elsif p_proposito = 'kyc' then
    v_ok := (v_principal and p_entidad = p_yo.seller_id) or (v_ver and p_yo.rol = 'superadmin');
  elsif p_proposito = 'liquidacion' then
    select l.seller_id into v_seller from tumbo.liquidaciones l where l.id = p_entidad;
    v_ok := found and (p_yo.rol in ('finanzas', 'superadmin') or (v_ver and v_principal and p_yo.seller_id = v_seller));
  elsif p_proposito in ('evidencia', 'comprobante', 'guia', 'entrega', 'chat') then
    -- Cuelgan de un pedido (la evidencia, también de un reclamo).
    if p_proposito = 'evidencia' then
      select d.comprador_id, d.seller_id, true into v_comprador, v_seller, v_seller_ve
      from tumbo.disputas d where d.id = p_entidad;
    end if;
    if v_comprador is null then
      select p.comprador_id, p.seller_id,
             p.estado <> 'pago_por_verificar' and not (p.estado = 'cancelado' and p.sla_horas is null)
        into v_comprador, v_seller, v_seller_ve
      from tumbo.pedidos p where p.id = p_entidad;
    end if;
    if v_comprador is not null then
      v_ok := case p_proposito
        when 'evidencia' then p_yo.id = v_comprador or (v_principal and p_yo.seller_id = v_seller and v_seller_ve) or v_equipo
        when 'comprobante' then p_yo.id = v_comprador or (v_ver and p_yo.rol in ('finanzas', 'superadmin'))
        when 'chat' then p_yo.id = v_comprador or (v_comercio and p_yo.seller_id = v_seller and v_seller_ve)
        -- guía y entrega
        else (v_comercio and p_yo.seller_id = v_seller and v_seller_ve) or v_equipo or (v_ver and p_yo.id = v_comprador) end;
    end if;
  end if;
  -- nunca NULL: quien llama hace «not archivo_permitido(…)»
  return coalesce(v_ok, false);
end $$;

-- Un número de un ajuste; si falta o no es un número, el valor por omisión
-- (un ajuste mal escrito no debe romper las subidas).
create function tumbo_privado.numero(p_valor jsonb, p_omision numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_valor) = 'number' and (p_valor #>> '{}')::numeric >= 0
              then (p_valor #>> '{}')::numeric else p_omision end
$$;

-- Registra la subida («pendiente») con una ruta que decide el servidor.
-- Cuotas: archivos por usuario y día (en las cuentas demo, por usuario y
-- red, con un respaldo por cuenta) y MB en total por comercio (o por cuenta
-- sin comercio); lo pendiente cuenta una hora.
create function public.tm_archivo_preparar(p_sesion text, p_proposito text, p_entidad text, p_tipo text,
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
  v_mb_seller numeric := tumbo_privado.numero(v_cuotas -> 'mb_por_seller', 300);
  v_mb_usuario numeric := tumbo_privado.numero(v_cuotas -> 'mb_por_usuario', 300);
  v_red text := tumbo_privado.ip_cliente();
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  v_id uuid := gen_random_uuid();
  v_usados bigint;
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
     or not coalesce(tumbo_privado.archivo_permitido(yo, pr.proposito, v_entidad, 'subir'), false) then
    raise exception 'No puedes adjuntar archivos a «%».', left(v_entidad, 60);
  end if;

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
    select coalesce(sum(bytes), 0) into v_usados from tumbo.archivos
    where seller_id = yo.seller_id and (estado = 'listo' or creado > now() - interval '1 hour');
    if v_usados + p_bytes > v_mb_seller * 1048576 then
      raise exception 'Tu comercio llegó al límite de % MB de archivos. Escríbele a soporte si necesitas más espacio.', v_mb_seller;
    end if;
  else
    select coalesce(sum(bytes), 0) into v_usados from tumbo.archivos
    where propietario = yo.id and seller_id is null and (estado = 'listo' or creado > now() - interval '1 hour');
    if v_usados + p_bytes > v_mb_usuario * 1048576 then
      raise exception 'Tu cuenta llegó al límite de % MB de archivos. Escríbele a soporte si necesitas más espacio.', v_mb_usuario;
    end if;
  end if;

  v_ext := case v_tipo when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                       when 'application/pdf' then 'pdf' when 'video/mp4' then 'mp4' else 'bin' end;
  v_ruta := pr.proposito || '/' || coalesce(yo.seller_id, yo.id::text) || '/' || v_id::text || '.' || v_ext;
  insert into tumbo.archivos (id, proposito, bucket, ruta, entidad, propietario, seller_id, tipo, bytes, nombre, red)
  values (v_id, pr.proposito, pr.bucket, v_ruta, v_entidad, yo.id, yo.seller_id, v_tipo, p_bytes, v_nombre, v_red);
  return jsonb_build_object('id', v_id, 'bucket', pr.bucket, 'ruta', v_ruta);
end $$;

-- Confirma la subida: Storage debe tener el objeto con un tamaño y un tipo
-- autorizados. Repetirla no cambia nada.
create function public.tm_archivo_confirmar(p_sesion text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  a tumbo.archivos;
  pr tumbo.archivo_propositos;
  v_meta jsonb;
  v_bytes bigint;
  v_tipo text;
begin
  select * into a from tumbo.archivos where id = p_id and propietario = yo.id for update;
  if not found then
    raise exception 'No encontramos ese archivo.';
  end if;
  select * into pr from tumbo.archivo_propositos where proposito = a.proposito;
  if a.estado = 'pendiente' then
    if to_regclass('storage.objects') is null then
      raise exception 'El almacenamiento de archivos no está disponible en este servidor.';
    end if;
    select o.metadata into v_meta from storage.objects o where o.bucket_id = a.bucket and o.name = a.ruta;
    if not found then
      raise exception 'El archivo no terminó de subir. Vuelve a intentarlo.';
    end if;
    v_bytes := case when v_meta ->> 'size' ~ '^[0-9]{1,15}$' then (v_meta ->> 'size')::bigint end;
    v_tipo := lower(coalesce(v_meta ->> 'mimetype', ''));
    if v_bytes is null or v_bytes <= 0 or v_bytes > pr.max_bytes or not (v_tipo = any (pr.tipos)) then
      raise exception 'El archivo que llegó no coincide con el autorizado (tipo o tamaño). Vuelve a subirlo.';
    end if;
    update tumbo.archivos set estado = 'listo', confirmado = now(), bytes = v_bytes, tipo = v_tipo where id = a.id;
  end if;
  return jsonb_build_object('id', a.id, 'url_publica',
    case when pr.publico then '/storage/v1/object/public/' || a.bucket || '/' || a.ruta end);
end $$;

-- Dónde está un archivo que esta persona puede ver (para firmar la descarga).
-- Los públicos los ve cualquiera; un archivo ajeno responde como inexistente.
create function public.tm_archivo_acceso(p_sesion text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  a tumbo.archivos;
  pr tumbo.archivo_propositos;
begin
  select * into a from tumbo.archivos where id = p_id and estado = 'listo';
  select * into pr from tumbo.archivo_propositos where proposito = a.proposito;
  if a.id is null or not coalesce(pr.publico or a.propietario = yo.id
                                  or tumbo_privado.archivo_permitido(yo, a.proposito, a.entidad, 'ver'), false) then
    raise exception 'No encontramos ese archivo.';
  end if;
  return jsonb_build_object('id', a.id, 'bucket', a.bucket, 'ruta', a.ruta, 'publico', pr.publico,
                            'tipo', a.tipo, 'bytes', a.bytes, 'nombre', a.nombre);
end $$;

-- ---------------------------------------------------------------------------
-- Bandeja de mensajes salientes
--   Las plantillas usan {{variables}}; tumbo_privado.encolar() las rellena
--   para cada canal y deja el mensaje en tumbo.salida. Ningún mensaje sale
--   todavía (la ola 2 conecta correo y WhatsApp, y la bandeja manual).
-- ---------------------------------------------------------------------------
create table tumbo.plantillas (
  clave  text not null,
  canal  text not null check (canal in ('correo', 'whatsapp', 'sms')),
  asunto text not null default '',
  cuerpo text not null,
  primary key (clave, canal)
);
alter table tumbo.plantillas enable row level security;
revoke all on tumbo.plantillas from public, anon, authenticated;

create table tumbo.preferencias_aviso (
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  tipo       text not null,
  canal      text not null check (canal in ('correo', 'whatsapp', 'sms')),
  activo     boolean not null default true,
  primary key (usuario_id, tipo, canal)
);
alter table tumbo.preferencias_aviso enable row level security;
revoke all on tumbo.preferencias_aviso from public, anon, authenticated;

create table tumbo.salida (
  id         bigint generated always as identity primary key,
  usuario_id uuid references tumbo.usuarios (id) on delete cascade,
  destino    text not null,
  canal      text not null check (canal in ('correo', 'whatsapp', 'sms')),
  plantilla  text not null,
  asunto     text not null default '',
  cuerpo     text not null,
  enlace     text,
  estado     text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'fallido', 'manual', 'descartado')),
  intentos   integer not null default 0,
  error      text,
  nota       text,
  creado     timestamptz not null default now(),
  enviado_en timestamptz,
  por        text
);
create index salida_estado_idx on tumbo.salida (estado, id desc);
create index salida_usuario_idx on tumbo.salida (usuario_id, creado desc);
alter table tumbo.salida enable row level security;
revoke all on tumbo.salida from public, anon, authenticated;

insert into tumbo.plantillas (clave, canal, asunto, cuerpo) values
  ('bienvenida', 'correo', 'Bienvenido a Tumbo Market, {{nombre}}',
   E'Hola, {{nombre}}:\n\nTu cuenta en Tumbo Market ya está activa. Compra a sellers homologados, paga en bolívares y sigue cada pedido desde «Mis pedidos».\n\n{{enlace}}'),
  ('verificar_correo', 'correo', 'Tu código para verificar el correo',
   E'Hola, {{nombre}}:\n\nTu código de verificación es {{codigo}}. Vence en {{minutos}} minutos.\n\nSi no lo pediste, ignora este mensaje.'),
  ('verificar_telefono', 'whatsapp', '',
   'Tumbo Market: tu código de verificación es {{codigo}}. Vence en {{minutos}} minutos. No lo compartas con nadie.'),
  ('verificar_telefono', 'sms', '',
   'Tumbo: tu codigo es {{codigo}}. Vence en {{minutos}} min. No lo compartas.'),
  ('recuperar_clave', 'correo', 'Recupera tu contraseña de Tumbo Market',
   E'Hola, {{nombre}}:\n\nPara crear una contraseña nueva entra aquí (vence en {{minutos}} minutos):\n{{enlace}}\n\nSi no lo pediste, ignora este mensaje: tu contraseña sigue igual.'),
  ('invitacion', 'correo', '{{invita}} te invitó a Tumbo Market',
   E'Hola:\n\n{{invita}} te invitó a sumarte a {{comercio}} en Tumbo Market como {{rol}}.\n\nAcepta la invitación aquí (vence en {{dias}} días):\n{{enlace}}'),
  ('pago_confirmado', 'correo', 'Confirmamos el pago de tu pedido {{pedido}}',
   E'Hola, {{nombre}}:\n\nConfirmamos el pago de tu pedido {{pedido}} por {{monto}}. El seller ya lo está preparando.\n\nSíguelo aquí: {{enlace}}'),
  ('pago_confirmado', 'whatsapp', '',
   'Tumbo Market: confirmamos el pago de tu pedido {{pedido}} por {{monto}}. Síguelo en {{enlace}}'),
  ('pedido_despachado', 'correo', 'Tu pedido {{pedido}} va en camino',
   E'Hola, {{nombre}}:\n\nTu pedido {{pedido}} salió con {{courier}}. Guía: {{guia}}.\n\nSíguelo aquí: {{enlace}}'),
  ('pedido_despachado', 'whatsapp', '',
   'Tumbo Market: tu pedido {{pedido}} va en camino con {{courier}} (guía {{guia}}). Síguelo en {{enlace}}'),
  ('pedido_listo_retiro', 'correo', 'Tu pedido {{pedido}} está listo para retirar',
   E'Hola, {{nombre}}:\n\nTu pedido {{pedido}} ya está en {{agencia}}. Lleva tu cédula para retirarlo.\n\n{{enlace}}'),
  ('pedido_listo_retiro', 'whatsapp', '',
   'Tumbo Market: tu pedido {{pedido}} está listo para retirar en {{agencia}}. Lleva tu cédula.'),
  ('pago_por_vencer', 'correo', 'El pago de tu pedido {{pedido}} está por vencer',
   E'Hola, {{nombre}}:\n\nAún no pudimos verificar el pago de tu pedido {{pedido}} y vence {{vence}}. Si ya pagaste, revisa que la referencia sea correcta.\n\n{{enlace}}'),
  ('pago_por_vencer', 'whatsapp', '',
   'Tumbo Market: el pago de tu pedido {{pedido}} vence {{vence}}. Si ya pagaste, revisa la referencia en {{enlace}}'),
  ('pedido_por_aceptar', 'correo', 'Tienes un pedido nuevo por aceptar: {{pedido}}',
   E'Hola, {{nombre}}:\n\nEl pedido {{pedido}} ({{monto}}) tiene el pago conciliado y espera tu aceptación antes de {{limite}}.\n\n{{enlace}}'),
  ('pedido_por_aceptar', 'whatsapp', '',
   'Tumbo Seller Center: el pedido {{pedido}} ({{monto}}) espera tu aceptación antes de {{limite}}. {{enlace}}'),
  ('reclamo_actualizado', 'correo', 'Novedades de tu reclamo {{reclamo}}',
   E'Hola, {{nombre}}:\n\nTu reclamo {{reclamo}} sobre el pedido {{pedido}} cambió: {{estado}}.\n\n{{enlace}}'),
  ('reclamo_actualizado', 'whatsapp', '',
   'Tumbo Market: tu reclamo {{reclamo}} sobre el pedido {{pedido}} cambió: {{estado}}. {{enlace}}'),
  ('reembolso_enviado', 'correo', 'Enviamos el reembolso de tu pedido {{pedido}}',
   E'Hola, {{nombre}}:\n\nEnviamos el reembolso de tu pedido {{pedido}} por {{monto}}. Referencia: {{referencia}}.\n\n{{enlace}}'),
  ('reembolso_enviado', 'whatsapp', '',
   'Tumbo Market: enviamos el reembolso de tu pedido {{pedido}} por {{monto}} (ref. {{referencia}}).'),
  ('liquidacion_pagada', 'correo', 'Pagamos tu liquidación {{liquidacion}}',
   E'Hola, {{nombre}}:\n\nPagamos la liquidación {{liquidacion}} por {{monto}}. Comprobante: {{comprobante}}.\n\n{{enlace}}'),
  ('liquidacion_pagada', 'whatsapp', '',
   'Tumbo Seller Center: pagamos la liquidación {{liquidacion}} por {{monto}} (comprobante {{comprobante}}).')
on conflict (clave, canal) do nothing;

-- Rellena una plantilla en un solo recorrido (lo que traen los datos no se
-- vuelve a interpretar como variable). En el correo los valores se escapan
-- para HTML; en los demás canales y en el asunto se quitan los caracteres de
-- control. Una variable sin dato queda vacía.
create function tumbo_privado.render_plantilla(p_texto text, p_datos jsonb, p_modo text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_texto text := coalesce(p_texto, '');
  v_partes text[];
  v_claves text[];
  v_val text;
  v_dato jsonb;
  r text;
  i integer;
begin
  v_partes := regexp_split_to_array(v_texto, '\{\{[a-z0-9_]+\}\}');
  select coalesce(array_agg(m[1] order by n), '{}') into v_claves
  from regexp_matches(v_texto, '\{\{([a-z0-9_]+)\}\}', 'g') with ordinality as x (m, n);
  r := v_partes[1];
  for i in 1 .. coalesce(array_length(v_claves, 1), 0) loop
    v_dato := case when jsonb_typeof(p_datos) = 'object' then p_datos -> v_claves[i] end;
    v_val := case when v_dato is null or jsonb_typeof(v_dato) = 'null' then ''
                  when jsonb_typeof(v_dato) = 'string' then v_dato #>> '{}'
                  else v_dato::text end;
    v_val := left(regexp_replace(v_val, '[[:cntrl:]]+', ' ', 'g'), 500);
    if p_modo = 'html' then
      v_val := replace(replace(replace(replace(replace(v_val, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
    end if;
    r := r || v_val || coalesce(v_partes[i + 1], '');
  end loop;
  if p_modo = 'asunto' then
    r := left(regexp_replace(r, '[[:cntrl:]]+', ' ', 'g'), 200);
  end if;
  return r;
end $$;

-- Contrato: deja en la bandeja un mensaje por canal de la plantilla. Correo
-- al del usuario; WhatsApp y SMS solo si tiene teléfono; respeta sus
-- preferencias salvo en los mensajes de seguridad (códigos, recuperación e
-- invitaciones). Sin usuario (p. ej. una invitación a quien aún no tiene
-- cuenta) va solo por correo a p_datos->>'correo'.
create function tumbo_privado.encolar(p_usuario uuid, p_plantilla text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
  pl tumbo.plantillas;
  v_datos jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_seguridad boolean := p_plantilla in ('verificar_correo', 'verificar_telefono', 'recuperar_clave', 'invitacion');
  v_destino text;
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

  for pl in select * from tumbo.plantillas where clave = p_plantilla order by canal loop
    v_destino := case when p_usuario is null then (case when pl.canal = 'correo' then lower(v_datos ->> 'correo') end)
                      when pl.canal = 'correo' then u.email
                      else nullif(trim(coalesce(u.telefono, '')), '') end;
    continue when v_destino is null;
    continue when p_usuario is not null and not v_seguridad and exists (
      select 1 from tumbo.preferencias_aviso pa
      where pa.usuario_id = p_usuario and pa.tipo = p_plantilla and pa.canal = pl.canal and not pa.activo);
    insert into tumbo.salida (usuario_id, destino, canal, plantilla, asunto, cuerpo, enlace)
    values (p_usuario, left(v_destino, 200), pl.canal, p_plantilla,
            tumbo_privado.render_plantilla(pl.asunto, v_datos, 'asunto'),
            tumbo_privado.render_plantilla(pl.cuerpo, v_datos, case when pl.canal = 'correo' then 'html' else 'texto' end),
            left(nullif(v_datos ->> 'enlace', ''), 500));
  end loop;
  if not found then
    -- (sin cortar la operación de negocio que encola: queda en el registro de Postgres)
    raise warning 'encolar: la plantilla «%» no existe.', p_plantilla;
  end if;
end $$;

-- La bandeja, del más nuevo al más viejo (50 por página). Los mensajes con
-- códigos o enlaces de seguridad solo los lee el superadministrador.
create function public.tm_salida_listar(p_sesion text, p_estado text default null, p_antes bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  v jsonb;
begin
  if p_estado is not null and p_estado not in ('pendiente', 'enviado', 'fallido', 'manual', 'descartado') then
    raise exception 'Ese estado de mensaje no existe.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'usuario', u.nombre, 'destino', s.destino, 'canal', s.canal, 'plantilla', s.plantilla,
           'asunto', s.asunto,
           'cuerpo', case when s.sensible and yo.rol <> 'superadmin'
                          then '(Mensaje con un código o enlace de seguridad: solo lo ve el superadministrador.)' else s.cuerpo end,
           'enlace', case when s.sensible and yo.rol <> 'superadmin' then null else s.enlace end,
           'estado', s.estado, 'intentos', s.intentos, 'error', s.error, 'nota', s.nota,
           'creado', s.creado, 'enviado_en', s.enviado_en, 'por', s.por) order by s.id desc), '[]'::jsonb) into v
  from (select x.*, x.plantilla in ('verificar_correo', 'verificar_telefono', 'recuperar_clave', 'invitacion') as sensible
        from tumbo.salida x
        where (p_estado is null or x.estado = p_estado) and (p_antes is null or x.id < p_antes)
        order by x.id desc limit 50) s
  left join tumbo.usuarios u on u.id = s.usuario_id;
  return jsonb_build_object('mensajes', v,
    'siguiente', case when jsonb_array_length(v) = 50 then (v -> 49 ->> 'id')::bigint end);
end $$;

-- Cierra a mano un mensaje: «manual» (queda para enviarlo a mano),
-- «enviado» (ya salió) o «descartado».
create function public.tm_salida_marcar(p_sesion text, p_id bigint, p_estado text, p_nota text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  m tumbo.salida;
begin
  if p_estado is null or p_estado not in ('manual', 'enviado', 'descartado') then
    raise exception 'Indica si el mensaje queda para enviarlo a mano, si ya salió o si se descarta.';
  end if;
  select * into m from tumbo.salida where id = p_id for update;
  if not found then
    raise exception 'No encontramos ese mensaje.';
  end if;
  if m.estado in ('enviado', 'descartado') then
    raise exception 'Ese mensaje ya está cerrado (%).', m.estado;
  end if;
  if m.plantilla in ('verificar_correo', 'verificar_telefono', 'recuperar_clave', 'invitacion')
     and yo.rol <> 'superadmin' and p_estado <> 'descartado' then
    raise exception 'Los mensajes de seguridad solo los gestiona el superadministrador.';
  end if;
  update tumbo.salida
  set estado = p_estado, nota = left(nullif(trim(coalesce(p_nota, '')), ''), 300),
      por = yo.nombre || ' (' || yo.rol || ')',
      enviado_en = case when p_estado = 'enviado' then now() else enviado_en end
  where id = p_id;
  perform tumbo_privado.auditar(yo, 'Mensaje saliente marcado', '#' || p_id || ' ' || m.plantilla || ' (' || m.canal || ') → ' || p_estado);
end $$;

-- ---------------------------------------------------------------------------
-- Reembolsos
-- ---------------------------------------------------------------------------
create table tumbo.reembolsos (
  id          bigint generated always as identity primary key,
  pedido_id   text not null references tumbo.pedidos (id),
  monto_usd   numeric(12,2) not null check (monto_usd > 0),
  monto_bs    numeric(14,2) not null check (monto_bs >= 0),
  tasa        numeric(12,4) not null,
  motivo      text not null,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'enviado', 'fallido')),
  destino     jsonb,                                   -- a dónde se devuelve (ola 1)
  referencia  text,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  por         text
);
create index reembolsos_pedido_idx on tumbo.reembolsos (pedido_id);
create index reembolsos_estado_idx on tumbo.reembolsos (estado, creado);
alter table tumbo.reembolsos enable row level security;
revoke all on tumbo.reembolsos from public, anon, authenticated;

-- Contrato (versión básica; Pagos la completa): registra el reembolso, en
-- bolívares con la tasa del pedido, y avisa a Finanzas.
create function tumbo_privado.crear_reembolso(p_pedido text, p_monto_usd numeric, p_motivo text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.pedidos;
  v_monto numeric := round(coalesce(p_monto_usd, 0), 2);
  v_id bigint;
begin
  select * into v from tumbo.pedidos where id = p_pedido;
  if not found then
    raise exception 'Pedido % no encontrado.', p_pedido;
  end if;
  if v_monto <= 0 then
    raise exception 'El monto del reembolso debe ser mayor que cero.';
  end if;
  insert into tumbo.reembolsos (pedido_id, monto_usd, monto_bs, tasa, motivo, por)
  values (v.id, v_monto, round(v_monto * v.tasa, 2), v.tasa,
          left(coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Reembolso'), 300), 'Sistema')
  returning id into v_id;
  perform tumbo_privado.notificar('rol:finanzas',
    'Reembolso de ' || tumbo_privado.fmt_usd(v_monto) || ' por enviar (' || v.id || ')', 'undo', 'admin/conciliacion.html');
  return v_id;
end $$;

-- Reembolsos del comprador (de sus pedidos) o todos para Finanzas.
create function public.tm_reembolsos(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'finanzas', 'superadmin']);
begin
  return coalesce((
    select jsonb_agg(case when yo.rol = 'comprador' then to_jsonb(r) - 'por' else to_jsonb(r) end
                     order by r.creado desc, r.id desc)
    from (select r.* from tumbo.reembolsos r join tumbo.pedidos p on p.id = r.pedido_id
          where yo.rol in ('finanzas', 'superadmin') or p.comprador_id = yo.id
          order by r.creado desc, r.id desc limit 300) r), '[]'::jsonb);
end $$;

-- Cancelación (desde la migración 4): el reembolso de un pedido ya conciliado
-- se crea en vez de solo avisar a Finanzas.
create or replace function public.tm_cancelar_pedido(p_sesion text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 200);
begin
  if v.estado in ('despachado', 'entregado', 'cerrado', 'reembolsado', 'devolucion') then
    raise exception 'El pedido ya fue despachado: corresponde un reclamo, no una cancelación.';
  end if;
  if v.estado = 'cancelado' then
    raise exception 'El pedido % ya está cancelado.', p_id;
  end if;
  perform tumbo_privado.bloquear_stock(p_id);
  update tumbo.pedidos set estado = 'cancelado', liquidacion = null where id = p_id;
  update tumbo.productos p set stock_res = greatest(0, p.stock_res - i.cant), actualizado = now()
  from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
  perform tumbo_privado.evento(p_id, yo.nombre,
    'Pedido cancelado (' || coalesce(v_motivo, 'sin motivo') || ') · stock liberado' ||
    case when v.estado = 'pago_por_verificar' then '' else ' y reembolso en cola' end, 'cancel');
  if v.estado <> 'pago_por_verificar' then
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'El comprador canceló el pedido ' || p_id, 'cancel',
                                    'seller/pedidos.html?estado=', array['seller', 'operador']);
    perform tumbo_privado.crear_reembolso(p_id, tumbo_privado.bruto_pedido(p_id) + v.costo_envio_usd,
      'Cancelación del pedido ' || p_id || coalesce(' · ' || v_motivo, ''));
  end if;
  perform tumbo_privado.auditar(yo, 'Cancelación', p_id || coalesce(' · ' || v_motivo, ''));
end $$;

-- Resolución de disputas (desde la migración 2): el reembolso se crea.
create or replace function public.tm_resolver_disputa(p_sesion text, p_id text, p_decision text, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  d tumbo.disputas;
  v_nota text := left(trim(coalesce(p_nota, '')), 500);
begin
  select * into d from tumbo.disputas where id = p_id for update;
  if not found then raise exception 'Disputa % no encontrada.', p_id; end if;
  if d.estado = 'resuelta' then raise exception 'La disputa % ya está resuelta.', p_id; end if;
  if p_decision is null or p_decision not in ('reembolso', 'devolucion', 'liberar') then
    raise exception 'Decisión inválida.';
  end if;
  perform 1 from tumbo.pedidos where id = d.pedido_id for update;

  update tumbo.disputas
  set estado = 'resuelta', resolucion_decision = p_decision, resolucion_nota = v_nota, resolucion_fecha = now()
  where id = p_id;

  if p_decision = 'reembolso' then
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta a favor del comprador · reembolso total en modo demo', 'undo');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue aprobado: reembolso en proceso (demo)', 'undo', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con reembolso al comprador', 'gavel', 'seller/disputas.html');
    perform tumbo_privado.crear_reembolso(d.pedido_id,
      tumbo_privado.bruto_pedido(d.pedido_id) + (select p.costo_envio_usd from tumbo.pedidos p where p.id = d.pedido_id),
      'Reclamo ' || p_id || ' resuelto con reembolso');
  elsif p_decision = 'devolucion' then
    update tumbo.pedidos set estado = 'devolucion' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa resuelta: devolución del producto con logística inversa (demo)', 'assignment_return');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ': coordinaremos la devolución del producto', 'assignment_return', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se resolvió con devolución', 'assignment_return', 'seller/disputas.html');
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = d.pedido_id;
    perform tumbo_privado.evento(d.pedido_id, 'Operaciones', 'Disputa cerrada a favor del seller · fondos liberados', 'lock_open');
    perform tumbo_privado.notificar('usr:' || d.comprador_id, 'Tu reclamo ' || p_id || ' fue revisado y cerrado sin reembolso', 'gavel', 'tienda/pedido.html?id=' || d.pedido_id);
    perform tumbo_privado.notificar('seller:' || d.seller_id, 'La disputa ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Resolución de disputa', p_id || ' → ' || p_decision);
end $$;

-- Cierre de devolución (desde la migración 4): si el producto volvió, el
-- reembolso se crea.
create or replace function public.tm_cerrar_devolucion(p_sesion text, p_id text, p_recibida boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  v tumbo.pedidos := tumbo_privado.bloquear_pedido(p_id, yo);
begin
  if v.estado <> 'devolucion' then
    raise exception 'El pedido % no tiene una devolución en curso.', p_id;
  end if;
  if p_recibida is null then
    raise exception 'Indica si el producto volvió.';
  end if;
  if p_recibida then
    perform tumbo_privado.bloquear_stock(p_id);
    update tumbo.pedidos set estado = 'reembolsado', liquidacion = 'reembolsado' where id = p_id;
    update tumbo.productos p set stock_fis = p.stock_fis + i.cant, actualizado = now()
    from tumbo.pedido_items i where i.pedido_id = p_id and i.sku = p.sku;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'Devolución recibida · reembolso al comprador (demo) y stock repuesto', 'undo');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'Recibimos la devolución de ' || p_id || ': reembolso en proceso (demo)', 'undo', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id || ' volvió a tu inventario; el pedido se reembolsó', 'assignment_return', 'seller/disputas.html');
    perform tumbo_privado.crear_reembolso(p_id, tumbo_privado.bruto_pedido(p_id) + v.costo_envio_usd,
      'Devolución recibida del pedido ' || p_id);
  else
    update tumbo.pedidos set estado = 'cerrado', liquidacion = 'elegible' where id = p_id;
    perform tumbo_privado.evento(p_id, 'Operaciones', 'El producto no se devolvió en el plazo · fondos liberados al seller', 'lock_open');
    perform tumbo_privado.notificar('usr:' || v.comprador_id, 'La devolución de ' || p_id || ' se cerró: el producto no llegó en el plazo', 'gavel', 'tienda/pedido.html?id=' || p_id);
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'La devolución de ' || p_id || ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Cierre de devolución', p_id || ' → ' || case when p_recibida then 'recibida, reembolso' else 'no recibida, fondos al seller' end);
end $$;

-- Reinicio de la demo (desde la migración 3): los reembolsos se van con sus
-- pedidos, y los adjuntos y mensajes ligados a pedidos, reclamos y
-- liquidaciones también (sus identificadores se vuelven a usar: un archivo
-- viejo no debe aparecer en el pedido nuevo que herede el número). Los
-- objetos que queden en Storage sin fila ya no se pueden ver ni firmar.
create or replace function public.tm_reiniciar_demo(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
begin
  truncate tumbo.notificaciones_leidas, tumbo.notificaciones, tumbo.liquidaciones,
           tumbo.disputas, tumbo.pedido_eventos, tumbo.pedido_items, tumbo.reembolsos, tumbo.pedidos,
           tumbo.carrito_items, tumbo.direcciones restart identity;
  -- (con WHERE explícito: el proyecto usa pg-safeupdate, que rechaza DELETE sin condición)
  delete from tumbo.archivos where proposito in ('evidencia', 'comprobante', 'guia', 'entrega', 'chat', 'liquidacion');
  delete from tumbo.salida where plantilla in ('pago_confirmado', 'pedido_despachado', 'pedido_listo_retiro', 'pago_por_vencer',
                                               'pedido_por_aceptar', 'reclamo_actualizado', 'reembolso_enviado', 'liquidacion_pagada');
  delete from tumbo.productos where sku is not null;
  delete from tumbo.seller_documentos where seller_id is not null;
  delete from tumbo.sellers_kyc where seller_id is not null;
  perform tumbo_privado.sembrar(false);
  perform tumbo_privado.auditar(yo, 'Demo reiniciada', 'Datos de negocio restaurados a la semilla');
end $$;

-- ---------------------------------------------------------------------------
-- Contratos de las olas siguientes (versión mínima)
-- ---------------------------------------------------------------------------
-- Logística: las dos opciones de hoy (las mismas que cobra tm_crear_pedido).
create function tumbo_privado.cotizar_envio(p_seller text, p_destino jsonb, p_items jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_array(
    jsonb_build_object('tipo', 'agencia', 'courier', 'MRW', 'costo_usd', 2.5, 'dias_min', 1, 'dias_max', 3,
                       'descripcion', 'Retiro en agencia MRW'),
    jsonb_build_object('tipo', 'domicilio', 'courier', 'Zoom', 'costo_usd', 4, 'dias_min', 2, 'dias_max', 4,
                       'descripcion', 'Entrega a domicilio con Zoom'))
$$;

-- Crecimiento: sin promociones todavía; las líneas van con su precio vigente.
create function tumbo_privado.aplicar_promociones(p_usuario uuid, p_items jsonb, p_cupon text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with lineas as (
    select i.sku, greatest(coalesce(i.cant, 1), 1) as cant, p.precio_usd
    from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as i (sku text, cant integer)
    join tumbo.productos p on p.sku = i.sku)
  select jsonb_build_object(
    'lineas', coalesce(jsonb_agg(jsonb_build_object('sku', l.sku, 'cant', l.cant, 'precio_usd', l.precio_usd,
                                                     'descuento_usd', 0, 'total_usd', l.precio_usd * l.cant)
                                 order by l.sku), '[]'::jsonb),
    'subtotal_usd', coalesce(sum(l.precio_usd * l.cant), 0),
    'descuento_usd', 0,
    'total_usd', coalesce(sum(l.precio_usd * l.cant), 0),
    'promociones', '[]'::jsonb,
    'cupon', null)
  from lineas l
$$;

-- Crecimiento: sin reglas de riesgo todavía.
create function tumbo_privado.riesgo_pedido(p_usuario uuid, p_datos jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select '{"puntaje": 0, "motivos": []}'::jsonb
$$;

-- ---------------------------------------------------------------------------
-- Privilegios: las funciones nuevas de la API, por firma exacta (las
-- redefinidas conservan los suyos).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.tm_ajustes_publicos()', 'public.tm_ajuste_guardar(text,text,jsonb)',
    'public.tm_archivo_preparar(text,text,text,text,bigint,text)', 'public.tm_archivo_confirmar(text,uuid)',
    'public.tm_archivo_acceso(text,uuid)', 'public.tm_salida_listar(text,text,bigint)',
    'public.tm_salida_marcar(text,bigint,text,text)', 'public.tm_reembolsos(text)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
