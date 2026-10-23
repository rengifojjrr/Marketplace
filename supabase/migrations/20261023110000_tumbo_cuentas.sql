-- =========================================================================
-- Tumbo Market — Ola 1: cuentas y seguridad
-- -------------------------------------------------------------------------
-- Lo que necesita una cuenta real para operar (ver docs/dominios/cuentas.md):
--   · perfil (nombre, cédula y teléfono +58 validados), cambio de
--     contraseña (pide la actual y cierra las demás sesiones) y baja de la
--     cuenta (desactiva y anonimiza lo no fiscal; pedidos y auditoría se
--     conservan);
--   · verificación de correo y de teléfono con un código de 6 dígitos de un
--     solo uso (con HMAC, 15 minutos, 5 intentos), por la bandeja de salida;
--   · recuperación de contraseña con un enlace de un solo uso (30 minutos)
--     que no revela si el correo existe, con topes por red y por correo;
--   · sesiones por dispositivo: agente, dispositivo y red; cerrar una o
--     todas las demás; aviso de acceso desde un dispositivo o una red
--     nuevos; 12 horas de vigencia para el equipo interno; último acceso;
--   · verificación en dos pasos con TOTP real (RFC 6238, HMAC-SHA1, ventana
--     ±1, sin reutilizar un código), secreto cifrado con pgcrypto, 10
--     códigos de respaldo, paso 2FA en el acceso (sin sesión hasta
--     verificar) y sesión elevada de 10 minutos (tm_elevar), que exige el
--     contrato exigir_elevada;
--   · invitaciones (equipo del seller, personal interno y comercios nuevos)
--     y la primera cuenta real de superadministrador;
--   · administración de usuarios (con baja administrativa) y permisos
--     finos (contrato tiene_permiso);
--   · libreta de direcciones completa; registro con teléfono y términos.
-- Las cuentas de prueba (contraseña pública) no cambian nada de esto: no
-- tienen sesión elevada y solo ven a otras cuentas de prueba.
-- Solo agrega: no borra ni reescribe datos ni objetos existentes.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
alter table tumbo.usuarios
  add column bloqueado      boolean not null default false,
  add column bloqueo_motivo text check (bloqueo_motivo is null or char_length(bloqueo_motivo) <= 300),
  add column bloqueado_el   timestamptz,
  add column bloqueado_por  text,
  add column eliminado_el   timestamptz,
  add column clave_cambiada timestamptz,
  add column terminos_version text check (terminos_version is null or char_length(terminos_version) <= 40),
  add column terminos_fecha   timestamptz;

-- Cada sesión tiene un identificador público (para cerrarla), el agente del
-- navegador, el dispositivo legible y hasta cuándo está elevada.
alter table tumbo.sesiones
  add column id            uuid not null default gen_random_uuid(),
  add column agente        text check (agente is null or char_length(agente) <= 300),
  add column dispositivo   text check (dispositivo is null or char_length(dispositivo) <= 80),
  add column elevada_hasta timestamptz;
create unique index sesiones_id_idx on tumbo.sesiones (id);

-- Secretos del servidor (cifrado del 2FA y HMAC de los códigos). Viven en
-- tumbo_privado, que la API no expone: nunca salen de la base.
create table tumbo_privado.secretos (
  nombre text primary key,
  valor  text not null
);
insert into tumbo_privado.secretos (nombre, valor) values
  ('cifrado_2fa', encode(extensions.gen_random_bytes(32), 'hex')),
  ('hmac_codigos', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (nombre) do nothing;

-- Intentos de las operaciones de seguridad (códigos, recuperación,
-- invitaciones…): los topes por cuenta y por red. Se guardan un día.
create table tumbo.intentos_seguridad (
  id    bigint generated always as identity primary key,
  tipo  text not null,
  clave text not null,
  red   text not null default 'desconocida',
  fecha timestamptz not null default now(),
  exito boolean not null default false
);
create index intentos_seguridad_clave_idx on tumbo.intentos_seguridad (tipo, clave, fecha desc);
create index intentos_seguridad_red_idx on tumbo.intentos_seguridad (tipo, red, fecha desc);
create index intentos_seguridad_fecha_idx on tumbo.intentos_seguridad (fecha);

-- Segundo factor (TOTP): el secreto, cifrado; activo = confirmado con un código.
create table tumbo.usuarios_2fa (
  usuario_id  uuid primary key references tumbo.usuarios (id) on delete cascade,
  secreto     bytea not null,
  activo      boolean not null default false,
  creado      timestamptz not null default now(),
  activado    timestamptz,
  ultimo_paso bigint not null default 0      -- último intervalo de 30 s aceptado: un código no sirve dos veces
);

create table tumbo.respaldo_2fa (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  hash       text not null,                  -- bcrypt del código
  usado_el   timestamptz,
  creado     timestamptz not null default now()
);
create index respaldo_2fa_usuario_idx on tumbo.respaldo_2fa (usuario_id) where usado_el is null;

-- Acceso a medias: la contraseña fue correcta y falta el código. No es una
-- sesión: no sirve para ninguna otra función.
create table tumbo.desafios_2fa (
  token_hash bytea primary key,
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  creado     timestamptz not null default now(),
  expira     timestamptz not null,
  intentos   integer not null default 0,
  red        text not null default 'desconocida'
);
create index desafios_2fa_usuario_idx on tumbo.desafios_2fa (usuario_id);
create index desafios_2fa_expira_idx on tumbo.desafios_2fa (expira);

-- Códigos de verificación de correo y de teléfono (HMAC del código).
create table tumbo.codigos_verificacion (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  tipo       text not null check (tipo in ('correo', 'telefono')),
  destino    text not null,
  hash       bytea not null,
  creado     timestamptz not null default now(),
  expira     timestamptz not null,
  intentos   integer not null default 0,
  usado_el   timestamptz
);
create index codigos_verificacion_usuario_idx on tumbo.codigos_verificacion (usuario_id, tipo, creado desc);

-- Enlaces de recuperación de contraseña (SHA-256 del token).
create table tumbo.recuperaciones (
  token_hash bytea primary key,
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  creado     timestamptz not null default now(),
  expira     timestamptz not null,
  usado_el   timestamptz,
  red        text not null default 'desconocida',
  por        text                             -- quien lo generó desde la administración (null: la persona)
);
create index recuperaciones_usuario_idx on tumbo.recuperaciones (usuario_id, creado desc);

-- Dispositivos desde los que entró cada cuenta (como mucho 20) y redes
-- (prefijo /24 en IPv4, /48 en IPv6; como mucho 30): un acceso desde un
-- dispositivo nuevo o desde una red nueva se avisa.
create table tumbo.dispositivos (
  usuario_id  uuid not null references tumbo.usuarios (id) on delete cascade,
  dispositivo text not null,
  primero     timestamptz not null default now(),
  ultimo      timestamptz not null default now(),
  red         text,
  primary key (usuario_id, dispositivo)
);
create table tumbo.redes_cuenta (
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  red        text not null,
  primero    timestamptz not null default now(),
  ultimo     timestamptz not null default now(),
  primary key (usuario_id, red)
);

-- Invitaciones: equipo del seller, personal interno y comercios nuevos.
create table tumbo.invitaciones (
  id           uuid primary key default gen_random_uuid(),
  token_hash   bytea not null unique,
  email        text not null check (email = lower(email) and char_length(email) <= 120),
  rol          text not null check (rol in ('seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas')),
  seller_id    text references tumbo.sellers (id),          -- del equipo; el comercio nuevo, al aceptarse
  datos        jsonb not null default '{}'::jsonb,           -- comercio nuevo: {comercio, ciudad, rif}
  invitado_por uuid references tumbo.usuarios (id) on delete set null,
  por          text not null,
  creado       timestamptz not null default now(),
  vence        timestamptz not null,
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'revocada')),
  cerrada_el   timestamptz,
  usuario_id   uuid references tumbo.usuarios (id) on delete set null,
  inicial      boolean not null default false                 -- la de puesta en marcha (SQL): no la hizo ninguna cuenta
);
create index invitaciones_email_idx on tumbo.invitaciones (email) where estado = 'pendiente';
create index invitaciones_seller_idx on tumbo.invitaciones (seller_id, creado desc);
create index invitaciones_por_idx on tumbo.invitaciones (invitado_por, creado desc);

-- Permisos finos: catálogo y asignaciones.
create table tumbo.permisos (
  permiso      text primary key check (permiso ~ '^[a-z][a-z0-9_]{1,39}$'),
  descripcion  text not null,
  ambito       text not null check (ambito in ('interno', 'seller')),
  implicito_en text[] not null default '{}',   -- roles que lo tienen siempre
  asignable_a  text[] not null default '{}'    -- roles a los que se puede asignar
);
insert into tumbo.permisos (permiso, descripcion, ambito, implicito_en, asignable_a) values
  ('conciliar', 'Conciliar y rechazar pagos', 'interno', '{finanzas}', '{ops}'),
  ('reembolsar', 'Enviar y conciliar reembolsos', 'interno', '{finanzas}', '{ops}'),
  ('liquidar', 'Cerrar ventanas y ejecutar liquidaciones a sellers', 'interno', '{finanzas}', '{}'),
  ('moderar', 'Moderar productos y contenido', 'interno', '{}', '{ops}'),
  ('kyc', 'Decidir la homologación (KYC) de los comercios', 'interno', '{}', '{ops,finanzas}'),
  ('disputas', 'Resolver reclamos y devoluciones', 'interno', '{ops}', '{finanzas}'),
  ('usuarios', 'Gestionar cuentas de compradores: bloquear, cerrar sesiones y dejar en su bandeja un enlace de recuperación', 'interno', '{}', '{ops}'),
  ('ajustes', 'Cambiar los ajustes de la plataforma', 'interno', '{}', '{ops,finanzas}'),
  ('precios_operador', 'El operador del comercio también cambia precios', 'seller', '{seller,precios}', '{operador}')
on conflict (permiso) do nothing;

create table tumbo.permisos_usuario (
  usuario_id   uuid not null references tumbo.usuarios (id) on delete cascade,
  permiso      text not null references tumbo.permisos (permiso),
  otorgado_por text not null,
  creado       timestamptz not null default now(),
  primary key (usuario_id, permiso)
);

create sequence tumbo_privado.seq_seller start 100;

do $$
declare t text;
begin
  foreach t in array array['tumbo.intentos_seguridad', 'tumbo.usuarios_2fa', 'tumbo.respaldo_2fa', 'tumbo.desafios_2fa',
                           'tumbo.codigos_verificacion', 'tumbo.recuperaciones', 'tumbo.dispositivos', 'tumbo.redes_cuenta', 'tumbo.invitaciones',
                           'tumbo.permisos', 'tumbo.permisos_usuario', 'tumbo_privado.secretos'] loop
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on %s from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema tumbo_privado from public, anon, authenticated;

-- Ajustes nuevos (los edita el superadministrador real, como los demás).
insert into tumbo.ajustes (clave, valor, tipo, vaciable, publico, descripcion) values
  ('sitio_url', '"https://rengifojjrr.github.io/Marketplace"', 'string', false, true,
   'Dirección pública del sitio: los enlaces de los correos (recuperación, invitaciones, avisos) parten de ella.'),
  ('terminos_version', '"2026-10-beta"', 'string', false, true,
   'Versión vigente de los términos de uso que se aceptan al registrarse (los textos definitivos esperan revisión legal).')
on conflict (clave) do nothing;

-- Plantillas de los avisos de seguridad de la cuenta.
insert into tumbo.plantillas (clave, canal, asunto, cuerpo) values
  ('acceso_nuevo', 'correo', 'Nuevo inicio de sesión en tu cuenta de Tumbo Market',
   E'Hola, {{nombre}}:\n\nSe inició sesión en tu cuenta desde {{dispositivo}} (conexión {{red}}) el {{fecha}}.\n\nSi fuiste tú, no tienes que hacer nada. Si no lo reconoces, cambia tu contraseña y cierra las demás sesiones desde Mi cuenta → Seguridad:\n{{enlace}}'),
  ('clave_cambiada', 'correo', 'Tu contraseña de Tumbo Market cambió',
   E'Hola, {{nombre}}:\n\nLa contraseña de tu cuenta cambió el {{fecha}} y cerramos las demás sesiones.\n\nSi no fuiste tú, crea una nueva desde «¿Olvidaste tu contraseña?» y escríbenos a soporte.')
on conflict (clave, canal) do nothing;

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
create function tumbo_privado.secreto(p_nombre text) returns text
language sql stable security definer set search_path = '' as $$
  select valor from tumbo_privado.secretos where nombre = p_nombre
$$;

-- El equipo interno: sesiones de 12 horas.
create function tumbo_privado.rol_interno(p_rol text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_rol in ('superadmin', 'ops', 'finanzas'), false)
$$;

-- Roles con la verificación en dos pasos obligatoria para lo irreversible.
create function tumbo_privado.rol_obliga_2fa(p_rol text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_rol in ('superadmin', 'finanzas', 'seller'), false)
$$;

create function tumbo_privado.vigencia_sesion(p_rol text) returns interval
language sql immutable set search_path = '' as $$
  select case when tumbo_privado.rol_interno(p_rol) then interval '12 hours' else interval '7 days' end
$$;

create function tumbo_privado.nombre_rol(p_rol text) returns text
language sql immutable set search_path = '' as $$
  select case p_rol when 'comprador' then 'comprador' when 'seller' then 'seller principal'
                    when 'precios' then 'gestor de precios' when 'operador' then 'operador'
                    when 'superadmin' then 'superadministrador' when 'ops' then 'operaciones'
                    when 'finanzas' then 'finanzas' else coalesce(p_rol, '') end
$$;

create function tumbo_privado.totp_activo(p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.usuarios_2fa where usuario_id = p_usuario and activo)
$$;

-- Agente del navegador (lo pasa PostgREST en las cabeceras).
create function tumbo_privado.agente() returns text
language plpgsql stable set search_path = '' as $$
begin
  return left(nullif(trim(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent'), ''), 300);
exception when others then
  return null;
end $$;

-- «Chrome en Windows», «Safari en iOS»… (un nuevo dispositivo es una
-- combinación nueva de navegador y sistema: una actualización del navegador
-- no cuenta como dispositivo nuevo).
create function tumbo_privado.dispositivo(p_agente text) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(p_agente, '') = '' then 'Dispositivo desconocido' else
    (case
       when p_agente ~* '(edg|edga|edgios)/' then 'Edge'
       when p_agente ~* '(opr|opera)[/ ]' then 'Opera'
       when p_agente ~* 'samsungbrowser/' then 'Samsung Internet'
       when p_agente ~* '(firefox|fxios)/' then 'Firefox'
       when p_agente ~* '(chrome|crios|chromium)/' then 'Chrome'
       when p_agente ~* 'safari/' and p_agente ~* 'version/' then 'Safari'
       when p_agente ~* '^(node|undici|curl|python|go-http|wget|axios)' then 'Programa'
       else 'Navegador' end)
    || ' en ' ||
    (case
       when p_agente ~* 'android' then 'Android'
       when p_agente ~* '(iphone|ipad|ipod)' then 'iOS'
       when p_agente ~* 'windows' then 'Windows'
       when p_agente ~* '(macintosh|mac os x)' then 'macOS'
       when p_agente ~* 'cros' then 'ChromeOS'
       when p_agente ~* 'linux' then 'Linux'
       else 'otro sistema' end) end
$$;

-- Dirección pública de una página del sitio (ajuste sitio_url).
create function tumbo_privado.url_sitio(p_ruta text) returns text
language sql stable security definer set search_path = '' as $$
  select rtrim(coalesce(tumbo_privado.ajuste('sitio_url') #>> '{}', ''), '/') || '/' || ltrim(coalesce(p_ruta, ''), '/')
$$;

-- «Mi cuenta» del área de cada rol (relativa a app/).
create function tumbo_privado.enlace_cuenta(p_rol text) returns text
language sql immutable set search_path = '' as $$
  select case when p_rol in ('seller', 'precios', 'operador') then 'seller/cuenta.html'
              when p_rol in ('superadmin', 'ops', 'finanzas') then 'admin/cuenta.html'
              else 'tienda/cuenta.html' end
$$;

create function tumbo_privado.fecha_legible(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p at time zone 'America/Caracas', 'DD/MM/YYYY HH12:MI am') || ' (hora de Caracas)'
$$;

create function tumbo_privado.url_codificar(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  b bytea := convert_to(coalesce(p, ''), 'UTF8');
  r text := '';
  c integer;
  i integer;
begin
  for i in 0 .. length(b) - 1 loop
    c := get_byte(b, i);
    if c between 48 and 57 or c between 65 and 90 or c between 97 and 122 or c in (45, 46, 95, 126) then
      r := r || chr(c);
    else
      r := r || '%' || upper(lpad(to_hex(c), 2, '0'));
    end if;
  end loop;
  return r;
end $$;

-- Cómo se nombra una cuenta en la auditoría: por su identificador y rol,
-- no por su correo (las cuentas de prueba, con contraseña pública, leen la
-- auditoría: no deben ver los datos de las personas reales).
create function tumbo_privado.ref_usuario(u tumbo.usuarios) returns text
language sql immutable set search_path = '' as $$
  select 'cuenta ' || u.id::text || ' (' || u.rol || ')'
$$;

-- Quién figura como actor en los asientos de la propia cuenta (acceso,
-- registro, contraseña, 2FA, sesiones, baja, invitación aceptada): una
-- cuenta propia, por su identificador y no por su nombre (la auditoría es
-- inmutable y la leen las cuentas de prueba; una cuenta que se da de baja
-- no debe dejar su nombre en ella). Las cuentas de prueba, con su nombre.
create function tumbo_privado.actor_cuenta(u tumbo.usuarios) returns tumbo.usuarios
language plpgsql stable set search_path = '' as $$
declare
  v tumbo.usuarios := u;
begin
  if u.id is not null and not tumbo_privado.cuenta_demo(u.email) then
    v.nombre := 'cuenta ' || u.id::text;
  end if;
  return v;
end $$;

-- La red de un acceso para el aviso de «red nueva»: el prefijo /24 (IPv4)
-- o /48 (IPv6) de la dirección; lo que no es una dirección, tal cual.
create function tumbo_privado.red_prefijo(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v inet;
begin
  v := p::inet;
  return network(set_masklen(v, case when family(v) = 4 then 24 else 48 end))::text;
exception when others then
  return coalesce(nullif(trim(p), ''), 'desconocida');
end $$;

-- Enmascarados, para mostrar a quien no es el dueño (o en un aviso).
create function tumbo_privado.correo_oculto(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or position('@' in p) < 2 then p
              else left(p, 1) || '•••' || substr(p, position('@' in p)) end
$$;
create function tumbo_privado.telefono_oculto(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or char_length(p) < 8 then p else left(p, 3) || '•••••' || right(p, 3) end
$$;

-- Teléfono de Venezuela en formato internacional: móvil (412, 414, 416,
-- 422, 424, 426) o fijo (2xx). Devuelve +58… normalizado, '' si viene vacío
-- o null si no es válido. Admite «0412-555-0101», «+58 412 5550101»…
create function tumbo_privado.normalizar_telefono(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g');
begin
  if d = '' then
    return '';
  end if;
  if d ~ '^\+58' then d := substr(d, 4);
  elsif d ~ '^0058' then d := substr(d, 5);
  elsif d ~ '^58[24][0-9]{9}$' then d := substr(d, 3);
  elsif d ~ '^0[24][0-9]{9}$' then d := substr(d, 2);
  end if;
  if d ~ '^(2[1-9][0-9]{8}|4(12|14|16|22|24|26)[0-9]{7})$' then
    return '+58' || d;
  end if;
  return null;
end $$;

-- Cédula de identidad: V-12345678 o E-12345678 ('' si viene vacía, null si
-- no es válida). Sin letra se entiende venezolana.
create function tumbo_privado.normalizar_cedula(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[[:space:].]', '', 'g'));
begin
  if v = '' then
    return '';
  end if;
  if v ~ '^[0-9]+$' then
    v := 'V' || v;
  end if;
  v := regexp_replace(v, '^([VE])-?', '\1-');
  if v ~ '^[VE]-[1-9][0-9]{4,8}$' then
    return v;
  end if;
  return null;
end $$;

create function tumbo_privado.error_nombre(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when char_length(trim(coalesce(p, ''))) < 2 or char_length(trim(coalesce(p, ''))) > 80
      then 'Escribe tu nombre (entre 2 y 80 caracteres).'
    when lower(trim(p)) in ('finanzas', 'operaciones', 'sistema', 'courier', 'moderación', 'moderacion', 'backoffice',
                            'tumbo', 'tumbo market', 'cuenta eliminada') or trim(p) ~* '^sel-\d'
      then 'Elige otro nombre: ese lo usa el sistema.'
    when p ~ '[[:cntrl:]]' then 'El nombre tiene caracteres que no se admiten.'
  end
$$;

-- bcrypt solo usa los primeros 72 bytes: más larga sería una contraseña truncada.
create function tumbo_privado.error_clave(p text) returns text
language sql immutable set search_path = '' as $$
  select case when char_length(coalesce(p, '')) < 8 or octet_length(p) > 72
              then 'La contraseña necesita entre 8 y 72 caracteres.' end
$$;

-- Intentos de seguridad: se anota cada uno (y se borran los de más de un día).
create function tumbo_privado.anotar_intento(p_tipo text, p_clave text, p_exito boolean) returns void
language sql security definer set search_path = '' as $$
  delete from tumbo.intentos_seguridad where fecha < now() - interval '1 day';
  insert into tumbo.intentos_seguridad (tipo, clave, red, exito)
  values (p_tipo, left(coalesce(p_clave, ''), 200), tumbo_privado.ip_cliente(), coalesce(p_exito, false));
$$;

-- Cuántos hubo en la ventana, por clave (cuenta, correo…) y/o por red.
create function tumbo_privado.intentos(p_tipo text, p_clave text, p_red text, p_ventana interval, p_solo_fallos boolean) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from tumbo.intentos_seguridad
  where tipo = p_tipo and fecha > now() - p_ventana
    and (p_clave is null or clave = p_clave) and (p_red is null or red = p_red)
    and (not p_solo_fallos or not exito)
$$;

-- ---------------------------------------------------------------------------
-- TOTP (RFC 6238): HMAC-SHA1, 6 dígitos, intervalos de 30 s
-- ---------------------------------------------------------------------------
create function tumbo_privado.totp(p_secreto bytea, p_paso bigint) returns text
language plpgsql immutable set search_path = '' as $$
declare
  h bytea := extensions.hmac(int8send(p_paso), p_secreto, 'sha1');
  o integer := get_byte(h, 19) & 15;
  v bigint;
begin
  v := ((get_byte(h, o)::bigint & 127) << 24)
       | (get_byte(h, o + 1)::bigint << 16)
       | (get_byte(h, o + 2)::bigint << 8)
       | get_byte(h, o + 3)::bigint;
  return lpad((v % 1000000)::text, 6, '0');
end $$;

create function tumbo_privado.base32(p bytea) returns text
language plpgsql immutable set search_path = '' as $$
declare
  alfabeto constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  r text := '';
  acumulado bigint := 0;
  bits integer := 0;
  i integer;
begin
  for i in 0 .. length(p) - 1 loop
    acumulado := (acumulado << 8) | get_byte(p, i);
    bits := bits + 8;
    while bits >= 5 loop
      r := r || substr(alfabeto, ((acumulado >> (bits - 5)) & 31)::integer + 1, 1);
      bits := bits - 5;
    end loop;
    acumulado := acumulado & ((1::bigint << bits) - 1);
  end loop;
  if bits > 0 then
    r := r || substr(alfabeto, ((acumulado << (5 - bits)) & 31)::integer + 1, 1);
  end if;
  return r;
end $$;

create function tumbo_privado.cifrar_2fa(p bytea) returns bytea
language sql volatile security definer set search_path = '' as $$
  select extensions.pgp_sym_encrypt(encode(p, 'hex'), tumbo_privado.secreto('cifrado_2fa'), 'cipher-algo=aes256, compress-algo=0')
$$;

create function tumbo_privado.descifrar_2fa(p bytea) returns bytea
language sql stable security definer set search_path = '' as $$
  select decode(extensions.pgp_sym_decrypt(p, tumbo_privado.secreto('cifrado_2fa')), 'hex')
$$;

-- ¿Vale el código para el secreto activo (o el que se está dando de alta)?
-- Ventana de ±1 intervalo; un intervalo ya usado no vuelve a servir.
create function tumbo_privado.totp_verificar(p_usuario uuid, p_codigo text, p_activo boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  f tumbo.usuarios_2fa;
  v_secreto bytea;
  v_paso bigint := floor(extract(epoch from now()) / 30)::bigint;
  i integer;
begin
  if coalesce(p_codigo, '') !~ '^[0-9]{6}$' then
    return false;
  end if;
  select * into f from tumbo.usuarios_2fa where usuario_id = p_usuario and activo = p_activo for update;
  if not found then
    return false;
  end if;
  v_secreto := tumbo_privado.descifrar_2fa(f.secreto);
  for i in -1 .. 1 loop
    if v_paso + i > f.ultimo_paso and tumbo_privado.totp(v_secreto, v_paso + i) = p_codigo then
      update tumbo.usuarios_2fa set ultimo_paso = v_paso + i where usuario_id = p_usuario;
      return true;
    end if;
  end loop;
  return false;
end $$;

-- Segundo factor de una cuenta: el código TOTP o un código de respaldo (que
-- se gasta). En las cuentas de prueba, mientras exista la demo, el código
-- fijo y público 123456 (su contraseña también es pública: no protege nada).
create function tumbo_privado.verificar_segundo_factor(p_yo tumbo.usuarios, p_codigo text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v text := upper(regexp_replace(coalesce(p_codigo, ''), '[[:space:]-]', '', 'g'));
  r record;
begin
  if p_yo.id is null then
    return false;
  end if;
  if tumbo_privado.cuenta_demo(p_yo.email) then
    return v = '123456';
  end if;
  if v ~ '^[0-9]{6}$' then
    return tumbo_privado.totp_verificar(p_yo.id, v, true);
  end if;
  if v ~ '^[A-Z0-9]{8}$' and tumbo_privado.totp_activo(p_yo.id) then
    for r in select id, hash from tumbo.respaldo_2fa where usuario_id = p_yo.id and usado_el is null order by id for update loop
      if extensions.crypt(v, r.hash) = r.hash then
        update tumbo.respaldo_2fa set usado_el = now() where id = r.id;
        return true;
      end if;
    end loop;
  end if;
  return false;
end $$;

-- 10 códigos de respaldo nuevos (los anteriores dejan de valer). Se
-- devuelven una sola vez; en la base queda su bcrypt.
create function tumbo_privado.generar_respaldo(p_usuario uuid) returns text[]
language plpgsql volatile security definer set search_path = '' as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_codigo text;
  r text[] := '{}';
  i integer;
  j integer;
begin
  delete from tumbo.respaldo_2fa where usuario_id = p_usuario;
  for i in 1 .. 10 loop
    v_bytes := extensions.gen_random_bytes(8);
    v_codigo := '';
    for j in 0 .. 7 loop
      v_codigo := v_codigo || substr(alfabeto, (get_byte(v_bytes, j) & 31) + 1, 1);
    end loop;
    insert into tumbo.respaldo_2fa (usuario_id, hash) values (p_usuario, extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)));
    r := r || (substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4));
  end loop;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Sesiones (redefinidas desde su última versión)
-- ---------------------------------------------------------------------------
-- Cambios respecto de la migración 7 (cuentas demo):
--   · una cuenta bloqueada no opera (ni con sesiones abiertas);
--   · el equipo interno (superadmin, ops, finanzas) tiene sesiones de 12
--     horas desde el acceso, sin renovación;
--   · la sesión de la llamada queda en tumbo.sesion_actual (de la
--     transacción): el contrato exigir_elevada la consulta.
create or replace function tumbo_privado.usuario(p_sesion text) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
  s tumbo.sesiones;
begin
  if p_sesion is null or p_sesion !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into s from tumbo.sesiones
  where token_hash = tumbo_privado.hash_token(p_sesion) and expira > now();
  if not found then
    return null;
  end if;
  select * into u from tumbo.usuarios where id = s.usuario_id and activo and not bloqueado;
  if not found then
    return null;
  end if;
  if tumbo_privado.rol_interno(u.rol) and s.creada < now() - interval '12 hours' then
    return null;
  end if;
  perform set_config('tumbo.sesion_actual', encode(s.token_hash, 'hex'), true);
  -- Renovación deslizante de 7 días con tope de 30 desde el acceso; el
  -- equipo interno no renueva (12 horas desde el acceso).
  if s.ultimo_uso < now() - interval '1 minute' and current_setting('transaction_read_only') = 'off' then
    update tumbo.sesiones
    set ultimo_uso = now(),
        expira = case when tumbo_privado.rol_interno(u.rol) then least(expira, creada + interval '12 hours')
                      else least(creada + interval '30 days', greatest(expira, now() + interval '7 days')) end
    where token_hash = s.token_hash;
  end if;
  return u;
end $$;

-- Cambios respecto de la migración 8 (topes de las cuentas demo): guarda el
-- agente, el dispositivo y la vigencia del rol; anota el último acceso; avisa
-- de un acceso desde un dispositivo o una red nuevos (en las cuentas propias).
create or replace function tumbo_privado.abrir_sesion(p_usuario uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_red text := tumbo_privado.ip_cliente();
  v_agente text := tumbo_privado.agente();
  v_disp text := tumbo_privado.dispositivo(tumbo_privado.agente());
  v_sobran integer;
  v_nuevo boolean;
  v_red_nueva boolean;
  v_primero boolean;
  v_prefijo text;
  u tumbo.usuarios;
begin
  perform tumbo_privado.bloquear_usuario(p_usuario, 'sesiones');
  select * into u from tumbo.usuarios where id = p_usuario;
  delete from tumbo.sesiones where expira < now();
  delete from tumbo.sesiones where token_hash in (
    select token_hash from tumbo.sesiones where usuario_id = p_usuario and red = v_red
    order by ultimo_uso desc, creada desc offset 49);
  select count(*) - 199 into v_sobran from tumbo.sesiones where usuario_id = p_usuario;
  if v_sobran > 0 then
    delete from tumbo.sesiones where token_hash in (
      select s.token_hash from (
        select x.token_hash, x.ultimo_uso, x.creada,
               x.ultimo_uso < now() - interval '1 day' as abandonada,
               count(*) filter (where x.ultimo_uso >= now() - interval '1 day') over (partition by x.red) as en_uso_red
        from tumbo.sesiones x where x.usuario_id = p_usuario) s
      order by s.abandonada desc, case when s.abandonada then 0 else s.en_uso_red end desc, s.ultimo_uso, s.creada
      limit v_sobran);
  end if;
  delete from tumbo.cuotas_red where ventana < now() - interval '1 day';
  insert into tumbo.sesiones (token_hash, usuario_id, expira, red, agente, dispositivo)
  values (tumbo_privado.hash_token(v_token), p_usuario, now() + tumbo_privado.vigencia_sesion(u.rol), v_red, v_agente, v_disp);
  -- (en las cuentas demo, que entran a la vez muchas personas, una vez por minuto)
  update tumbo.usuarios set ultimo_acceso = now()
  where id = p_usuario and (ultimo_acceso is null or ultimo_acceso < now() - interval '1 minute');

  if not tumbo_privado.cuenta_demo(u.email) then
    -- Nuevo es un dispositivo (navegador y sistema) o una red que la cuenta
    -- no usó: quien entra con la contraseña robada desde otra red con el
    -- mismo navegador también se avisa. El primer acceso no se avisa.
    v_prefijo := tumbo_privado.red_prefijo(v_red);
    v_primero := not exists (select 1 from tumbo.dispositivos where usuario_id = p_usuario)
                 and not exists (select 1 from tumbo.redes_cuenta where usuario_id = p_usuario);
    v_nuevo := not exists (select 1 from tumbo.dispositivos where usuario_id = p_usuario and dispositivo = v_disp);
    v_red_nueva := not exists (select 1 from tumbo.redes_cuenta where usuario_id = p_usuario and red = v_prefijo);
    insert into tumbo.dispositivos (usuario_id, dispositivo, red) values (p_usuario, v_disp, v_red)
    on conflict (usuario_id, dispositivo) do update set ultimo = now(), red = excluded.red;
    insert into tumbo.redes_cuenta (usuario_id, red) values (p_usuario, v_prefijo)
    on conflict (usuario_id, red) do update set ultimo = now();
    if not v_primero and (v_nuevo or v_red_nueva) then
      perform tumbo_privado.encolar(p_usuario, 'acceso_nuevo', jsonb_build_object(
        'dispositivo', v_disp, 'red', v_red, 'fecha', tumbo_privado.fecha_legible(now()),
        'enlace', tumbo_privado.url_sitio('app/' || tumbo_privado.enlace_cuenta(u.rol))));
      perform tumbo_privado.notificar('usr:' || p_usuario,
        'Nuevo inicio de sesión desde ' || v_disp
        || case when v_nuevo then '' else ' en una conexión nueva (' || v_red || ')' end
        || ': si no fuiste tú, cambia tu contraseña y cierra las demás sesiones',
        'devices', tumbo_privado.enlace_cuenta(u.rol));
    end if;
    delete from tumbo.dispositivos where usuario_id = p_usuario and dispositivo in (
      select dispositivo from tumbo.dispositivos where usuario_id = p_usuario order by ultimo desc offset 20);
    delete from tumbo.redes_cuenta where usuario_id = p_usuario and red in (
      select red from tumbo.redes_cuenta where usuario_id = p_usuario order by ultimo desc offset 30);
  end if;
  return v_token;
end $$;

-- El perfil del navegador. Cambios respecto de la ola 0: «mfa» dice si el
-- acceso pide el segundo factor (en las cuentas propias, si tienen el TOTP
-- activo; en las demo, lo que diga la semilla), y se agregan «demo»,
-- «totp» y «obliga2fa» (el rol lo exige para lo irreversible).
create or replace function tumbo_privado.perfil_json(u tumbo.usuarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'nombre', u.nombre, 'rol', u.rol,
                            'sellerId', u.seller_id,
                            'mfa', case when tumbo_privado.cuenta_demo(u.email) then u.mfa else tumbo_privado.totp_activo(u.id) end,
                            'telefono', u.telefono,
                            'correoVerificado', u.correo_verificado, 'telefonoVerificado', u.telefono_verificado,
                            'demo', tumbo_privado.cuenta_demo(u.email),
                            'totp', tumbo_privado.totp_activo(u.id),
                            'obliga2fa', tumbo_privado.rol_obliga_2fa(u.rol))
$$;

-- ---------------------------------------------------------------------------
-- Contratos: sesión elevada y permisos finos
-- ---------------------------------------------------------------------------
-- Sesión elevada para lo que no admite marcha atrás (ajustes, dinero,
-- administración de cuentas):
--   · nunca con una cuenta de prueba (contraseña y código públicos);
--   · los roles con 2FA obligatoria (superadmin, finanzas, seller principal)
--     necesitan tenerla activa;
--   · con la 2FA activa, la sesión de la llamada debe estar elevada (código
--     confirmado con tm_elevar hace menos de 10 minutos). El error lleva el
--     código TMELV: el cliente pide el código y repite la acción.
-- Los demás roles sin 2FA activa pasan (su rol ya lo validó quien llama).
create or replace function tumbo_privado.exigir_elevada(p_yo tumbo.usuarios) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sesion text := nullif(current_setting('tumbo.sesion_actual', true), '');
  v_hasta timestamptz;
begin
  if p_yo.id is null or tumbo_privado.cuenta_demo(p_yo.email) then
    raise exception 'Las cuentas de prueba no pueden hacer esta acción: hace falta una cuenta real del equipo con verificación en dos pasos.'
      using errcode = '42501';
  end if;
  if not tumbo_privado.totp_activo(p_yo.id) then
    if tumbo_privado.rol_obliga_2fa(p_yo.rol) then
      raise exception 'Esta acción exige la verificación en dos pasos: actívala en Mi cuenta → Seguridad.' using errcode = '42501';
    end if;
    return;
  end if;
  if v_sesion is not null then
    select s.elevada_hasta into v_hasta from tumbo.sesiones s
    where s.token_hash = decode(v_sesion, 'hex') and s.usuario_id = p_yo.id;
  end if;
  if v_hasta is null or v_hasta < now() then
    raise exception 'Confirma tu código de verificación en dos pasos para continuar.' using errcode = 'TMELV', hint = 'elevar';
  end if;
end $$;

-- Administración de cuentas e invitaciones: sesión elevada con la 2FA
-- activa sea cual sea el rol (p. ej. operaciones con el permiso «usuarios»).
create function tumbo_privado.exigir_admin_elevada(p_yo tumbo.usuarios) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_yo.id is not null and not tumbo_privado.cuenta_demo(p_yo.email) and not tumbo_privado.totp_activo(p_yo.id) then
    raise exception 'Esta acción exige la verificación en dos pasos: actívala en Mi cuenta → Seguridad.' using errcode = '42501';
  end if;
  perform tumbo_privado.exigir_elevada(p_yo);
end $$;

-- Permiso fino: el superadministrador los tiene todos; los demás, los
-- implícitos de su rol y los asignados (si su rol puede tenerlos).
-- Catálogo en tumbo.permisos (ver docs/dominios/cuentas.md).
create or replace function tumbo_privado.tiene_permiso(p_yo tumbo.usuarios, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_yo.rol = 'superadmin', false)
      or exists (select 1 from tumbo.permisos p where p.permiso = p_permiso and p_yo.rol = any (p.implicito_en))
      or exists (select 1 from tumbo.permisos_usuario pu join tumbo.permisos p on p.permiso = pu.permiso
                 where pu.usuario_id = p_yo.id and pu.permiso = p_permiso and p_yo.rol = any (p.asignable_a))
$$;

-- ¿Ve la persona `yo` la cuenta `o` en la administración? Las cuentas de
-- prueba solo ven cuentas de prueba (nunca los datos de personas reales);
-- operaciones, solo compradores (con o sin el permiso «usuarios»: nunca el
-- personal interno ni los comercios).
create function tumbo_privado.ve_usuario(p_yo tumbo.usuarios, p_otro tumbo.usuarios) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_otro.id is not null
     and (not tumbo_privado.cuenta_demo(p_yo.email) or tumbo_privado.cuenta_demo(p_otro.email))
     and (p_yo.rol = 'superadmin' or (p_yo.rol = 'ops' and p_otro.rol = 'comprador'))
$$;

-- ¿Gestiona (bloquea, cierra sesiones, recupera) esa cuenta? Además de
-- verla: el superadministrador, cualquiera; operaciones con el permiso
-- «usuarios», solo compradores (nunca un rol interno ni un comercio: con
-- un enlace de recuperación se podría quedar con esa cuenta).
create function tumbo_privado.gestiona_usuario(p_yo tumbo.usuarios, p_otro tumbo.usuarios) returns boolean
language sql stable security definer set search_path = '' as $$
  select tumbo_privado.ve_usuario(p_yo, p_otro)
     and (p_yo.rol = 'superadmin'
          or (p_yo.rol = 'ops' and p_otro.rol = 'comprador' and tumbo_privado.tiene_permiso(p_yo, 'usuarios')))
$$;

-- ---------------------------------------------------------------------------
-- Acceso
-- ---------------------------------------------------------------------------
-- Cambios respecto de la migración 9 (acceso demo):
--   · una cuenta bloqueada no entra (se dice solo con la contraseña correcta);
--   · con la 2FA activa no se entrega la sesión: se devuelve un desafío de 5
--     minutos que se completa con tm_acceder_2fa.
create or replace function public.tm_acceder(p_email text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 120);
  v_ip text := tumbo_privado.ip_cliente();
  v_demo boolean := tumbo_privado.cuenta_demo(v_email);
  u tumbo.usuarios;
  v_ok boolean := false;
  v_token text;
begin
  delete from tumbo.intentos_acceso where fecha < now() - interval '1 day';

  if not v_demo then
    -- Comprobaciones bcrypt por red y minuto: una sola red no agota el
    -- techo global.
    if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
        where tipo = 'acceso' and ip = v_ip and fecha > now() - interval '1 minute'
          and not tumbo_privado.cuenta_demo(email)) >= 40 then
      return jsonb_build_object('error', 'Demasiados intentos de acceso desde tu conexión. Espera un minuto.');
    end if;
    -- Techo global de comprobaciones bcrypt (aciertos y fallos) por minuto:
    -- acota la CPU que Tumbo puede gastar en la base compartida.
    if (select count(*) from tumbo.intentos_acceso
        where tipo = 'acceso' and fecha > now() - interval '1 minute'
          and not tumbo_privado.cuenta_demo(email)) >= 120 then
      return jsonb_build_object('error', 'El acceso está muy solicitado en este momento. Inténtalo de nuevo en un minuto.');
    end if;
  end if;
  -- Aciertos repetidos de una cuenta desde una red (las cuentas demo son
  -- públicas): frena el abuso sin afectar a quien entra desde otra red.
  if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and exito and fecha > now() - interval '15 minutes') >= 60 then
    return jsonb_build_object('error', 'Demasiados accesos seguidos a esta cuenta desde tu conexión. Espera unos minutos.');
  end if;
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 8
     or (v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
         where tipo = 'acceso' and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 40)
     -- techo por cuenta para quien rote redes; no frena al dueño en una red
     -- desde la que entró o se registró esta semana, ni existe en las cuentas
     -- demo (su contraseña es pública: solo serviría para bloquearlas)
     or (not v_demo
         and (select count(*) from tumbo.intentos_acceso
              where tipo = 'acceso' and email = v_email and not exito and fecha > now() - interval '15 minutes') >= 100
         and not exists (select 1 from tumbo.redes_conocidas r
                         where r.email = v_email and r.red = v_ip and r.ultimo > now() - interval '7 days')) then
    return jsonb_build_object('error', 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');
  end if;

  select * into u from tumbo.usuarios where email = v_email and activo;
  if found and v_demo then
    -- contraseña pública de la semilla: no hace falta bcrypt
    v_ok := coalesce(p_clave, '') = 'demo1234';
  elsif found then
    v_ok := u.clave_hash = extensions.crypt(coalesce(p_clave, ''), u.clave_hash);
  else
    -- mismo coste que una comprobación real: el tiempo no delata si el correo existe
    perform extensions.crypt(coalesce(p_clave, ''), extensions.gen_salt('bf', 10));
  end if;
  insert into tumbo.intentos_acceso (tipo, email, ip, exito) values ('acceso', v_email, v_ip, v_ok);

  if not v_ok then
    return jsonb_build_object('error', 'Correo o contraseña incorrectos. Las cuentas demo usan demo1234.');
  end if;
  if u.bloqueado then
    return jsonb_build_object('error', 'Tu cuenta está bloqueada. Si crees que es un error, escribe a soporte.');
  end if;
  if not v_demo and tumbo_privado.totp_activo(u.id) then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    delete from tumbo.desafios_2fa where expira < now();
    delete from tumbo.desafios_2fa where token_hash in (
      select token_hash from tumbo.desafios_2fa where usuario_id = u.id order by creado desc offset 4);
    insert into tumbo.desafios_2fa (token_hash, usuario_id, expira, red)
    values (tumbo_privado.hash_token(v_token), u.id, now() + interval '5 minutes', v_ip);
    return jsonb_build_object('requiere2fa', true, 'desafio', v_token);
  end if;
  perform tumbo_privado.recordar_red(v_email, v_ip);
  v_token := tumbo_privado.abrir_sesion(u.id);
  if not exists (select 1 from tumbo.auditoria a
                 where a.accion = 'Inicio de sesión' and a.actor_id = u.id and a.fecha > now() - interval '10 minutes') then
    perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(u), 'Inicio de sesión', u.rol);
  end if;
  return jsonb_build_object('sesion', v_token, 'usuario', tumbo_privado.perfil_json(u));
end $$;

-- Segundo paso del acceso: el código TOTP (o uno de respaldo) del desafío.
-- Hasta 5 intentos por desafío y 10 fallos por cuenta cada 15 minutos (se
-- cuentan aunque la contraseña la tenga otra persona). La sesión nace
-- elevada: el código se acaba de comprobar.
create function public.tm_acceder_2fa(p_desafio text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d tumbo.desafios_2fa;
  u tumbo.usuarios;
  v_ok boolean;
  v_token text;
begin
  if coalesce(p_desafio, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error', 'La verificación venció: vuelve a iniciar sesión.');
  end if;
  select * into d from tumbo.desafios_2fa
  where token_hash = tumbo_privado.hash_token(p_desafio) and expira > now() for update;
  if not found then
    return jsonb_build_object('error', 'La verificación venció: vuelve a iniciar sesión.');
  end if;
  select * into u from tumbo.usuarios where id = d.usuario_id and activo and not bloqueado;
  if not found then
    delete from tumbo.desafios_2fa where token_hash = d.token_hash;
    return jsonb_build_object('error', 'La verificación venció: vuelve a iniciar sesión.');
  end if;
  if tumbo_privado.intentos('2fa', u.id::text, null, interval '15 minutes', true) >= 10 then
    return jsonb_build_object('error', 'Demasiados códigos incorrectos en esta cuenta. Espera 15 minutos e inténtalo de nuevo.');
  end if;
  v_ok := tumbo_privado.verificar_segundo_factor(u, p_codigo);
  perform tumbo_privado.anotar_intento('2fa', u.id::text, v_ok);
  if not v_ok then
    if d.intentos + 1 >= 5 then
      delete from tumbo.desafios_2fa where token_hash = d.token_hash;
      return jsonb_build_object('error', 'Demasiados códigos incorrectos: vuelve a iniciar sesión.');
    end if;
    update tumbo.desafios_2fa set intentos = intentos + 1 where token_hash = d.token_hash;
    return jsonb_build_object('error', 'Código incorrecto. Revisa que la hora de tu teléfono esté bien o usa un código de respaldo.');
  end if;
  delete from tumbo.desafios_2fa where usuario_id = u.id;
  perform tumbo_privado.recordar_red(u.email, tumbo_privado.ip_cliente());
  v_token := tumbo_privado.abrir_sesion(u.id);
  update tumbo.sesiones set elevada_hasta = now() + interval '10 minutes' where token_hash = tumbo_privado.hash_token(v_token);
  if not exists (select 1 from tumbo.auditoria a
                 where a.accion = 'Inicio de sesión' and a.actor_id = u.id and a.fecha > now() - interval '10 minutes') then
    perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(u), 'Inicio de sesión', u.rol || ' · con verificación en dos pasos');
  end if;
  return jsonb_build_object('sesion', v_token, 'usuario', tumbo_privado.perfil_json(u));
end $$;

-- Sesión elevada (10 minutos) con el segundo factor. Los fallos se
-- devuelven como {error} (no como excepción) para que cuenten en el tope.
-- En las cuentas de prueba vale el código público 123456 (sirve para que la
-- demo verifique el paso en el servidor; exigir_elevada las rechaza igual).
create function public.tm_elevar(p_sesion text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_ok boolean;
  v_hasta timestamptz := now() + interval '10 minutes';
begin
  if tumbo_privado.cuenta_demo(yo.email) then
    if not tumbo_privado.verificar_segundo_factor(yo, p_codigo) then
      return jsonb_build_object('error', 'Código incorrecto. En las cuentas de prueba el código es 123456.');
    end if;
  else
    if not tumbo_privado.totp_activo(yo.id) then
      return jsonb_build_object('error', 'Activa primero la verificación en dos pasos en Mi cuenta → Seguridad.');
    end if;
    if tumbo_privado.intentos('2fa', yo.id::text, null, interval '15 minutes', true) >= 10 then
      return jsonb_build_object('error', 'Demasiados códigos incorrectos en esta cuenta. Espera 15 minutos e inténtalo de nuevo.');
    end if;
    v_ok := tumbo_privado.verificar_segundo_factor(yo, p_codigo);
    perform tumbo_privado.anotar_intento('2fa', yo.id::text, v_ok);
    if not v_ok then
      return jsonb_build_object('error', 'Código incorrecto. Revisa que la hora de tu teléfono esté bien o usa un código de respaldo.');
    end if;
  end if;
  update tumbo.sesiones set elevada_hasta = v_hasta where token_hash = tumbo_privado.hash_token(p_sesion);
  return jsonb_build_object('ok', true, 'hasta', v_hasta);
end $$;

-- ---------------------------------------------------------------------------
-- Registro (redefinido desde la migración 6 de ajustes)
-- ---------------------------------------------------------------------------
-- Cambios: respeta el ajuste registro_activo, admite el teléfono (opcional)
-- y exige aceptar la versión vigente de los términos, que guarda con su
-- fecha. La firma de tres parámetros se conserva (las llamadas existentes
-- reciben un error claro en vez de un 404), pero tampoco crea una cuenta sin
-- la aceptación: ninguna cuenta nace sin términos.
create function tumbo_privado.registrar_comprador(p_email text, p_clave text, p_nombre text, p_telefono text,
                                                  p_terminos text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 200);
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_ip text := tumbo_privado.ip_cliente();
  v_tel text := tumbo_privado.normalizar_telefono(p_telefono);
  v_vigente text := tumbo_privado.ajuste('terminos_version') #>> '{}';
  v_error text;
  u tumbo.usuarios;
begin
  if coalesce((tumbo_privado.ajuste('registro_activo') #>> '{}')::boolean, true) is false then
    return jsonb_build_object('error', 'El registro de cuentas nuevas está pausado en este momento. Inténtalo más tarde.');
  end if;
  delete from tumbo.intentos_acceso where fecha < now() - interval '1 day';
  if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
      where tipo = 'registro' and ip = v_ip and fecha > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('error', 'Hay demasiados registros desde tu conexión. Inténtalo en unos minutos.');
  end if;
  -- Techo global: protege la base compartida de altas en masa desde muchas redes.
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'registro' and exito and fecha > now() - interval '10 minutes') >= 200 then
    return jsonb_build_object('error', 'El registro está en pausa por alta demanda. Inténtalo en unos minutos.');
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_email) > 120 then
    v_error := 'Escribe un correo válido.';
  elsif tumbo_privado.error_clave(p_clave) is not null then
    v_error := tumbo_privado.error_clave(p_clave);
  elsif tumbo_privado.error_nombre(v_nombre) is not null then
    v_error := tumbo_privado.error_nombre(v_nombre);
  elsif v_tel is null then
    v_error := 'Escribe un teléfono de Venezuela con su código (por ejemplo +58 412 1234567) o déjalo vacío.';
  elsif p_terminos is distinct from v_vigente then
    v_error := 'Acepta los términos vigentes (versión ' || coalesce(v_vigente, '—') || ') para crear tu cuenta.'
               || case when p_terminos is null then ' Si no ves la casilla de los términos, recarga la página.' else '' end;
  elsif exists (select 1 from tumbo.usuarios where email = v_email) then
    v_error := 'Ya existe una cuenta con ese correo: inicia sesión.';
  end if;

  if v_error is null then
    begin
      insert into tumbo.usuarios (email, clave_hash, nombre, rol, telefono, terminos_version, terminos_fecha)
      values (v_email, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), v_nombre, 'comprador', nullif(v_tel, ''),
              v_vigente, now())
      returning * into u;
    exception when unique_violation then
      -- dos altas simultáneas con el mismo correo
      v_error := 'Ya existe una cuenta con ese correo: inicia sesión.';
    end;
  end if;

  insert into tumbo.intentos_acceso (tipo, email, ip, exito) values ('registro', left(v_email, 120), v_ip, v_error is null);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;
  perform tumbo_privado.recordar_red(v_email, v_ip);
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(u), 'Registro de comprador', 'cuenta nueva');
  return jsonb_build_object('sesion', tumbo_privado.abrir_sesion(u.id), 'usuario', tumbo_privado.perfil_json(u));
end $$;

create or replace function public.tm_registrar(p_email text, p_clave text, p_nombre text) returns jsonb
language sql security definer set search_path = '' as $$
  select tumbo_privado.registrar_comprador(p_email, p_clave, p_nombre, null, null)
$$;

create function public.tm_registrar(p_email text, p_clave text, p_nombre text, p_telefono text, p_terminos text) returns jsonb
language sql security definer set search_path = '' as $$
  select tumbo_privado.registrar_comprador(p_email, p_clave, p_nombre, p_telefono, p_terminos)
$$;

-- ---------------------------------------------------------------------------
-- Perfil
-- ---------------------------------------------------------------------------
create function tumbo_privado.perfil_completo(u tumbo.usuarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select tumbo_privado.perfil_json(u) || jsonb_build_object(
    'cedula', u.cedula, 'creado', u.creado, 'ultimoAcceso', u.ultimo_acceso, 'claveCambiada', u.clave_cambiada,
    'terminosVersion', u.terminos_version, 'terminosFecha', u.terminos_fecha,
    'totpDesde', (select activado from tumbo.usuarios_2fa where usuario_id = u.id and activo),
    'respaldoRestantes', (select count(*) from tumbo.respaldo_2fa where usuario_id = u.id and usado_el is null),
    'permisos', coalesce((select jsonb_agg(p.permiso order by p.permiso) from tumbo.permisos p
                          where tumbo_privado.tiene_permiso(u, p.permiso)), '[]'::jsonb))
$$;

create function public.tm_perfil(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
begin
  return tumbo_privado.perfil_completo(yo);
end $$;

-- Nombre, cédula y teléfono (los que vengan). Un teléfono nuevo deja de
-- estar verificado. Las cuentas de prueba no se modifican.
create function public.tm_perfil_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_nombre text := yo.nombre;
  v_cedula text := yo.cedula;
  v_tel text := yo.telefono;
begin
  if tumbo_privado.cuenta_demo(yo.email) then
    raise exception 'Las cuentas de prueba no se pueden modificar: crea tu propia cuenta para probarlo.';
  end if;
  if d ? 'nombre' then
    v_nombre := trim(coalesce(d ->> 'nombre', ''));
    if tumbo_privado.error_nombre(v_nombre) is not null then
      raise exception '%', tumbo_privado.error_nombre(v_nombre);
    end if;
  end if;
  if d ? 'cedula' then
    v_cedula := tumbo_privado.normalizar_cedula(d ->> 'cedula');
    if v_cedula is null then
      raise exception 'Escribe la cédula como V-12345678 o E-12345678.';
    end if;
    v_cedula := nullif(v_cedula, '');
  end if;
  if d ? 'telefono' then
    v_tel := tumbo_privado.normalizar_telefono(d ->> 'telefono');
    if v_tel is null then
      raise exception 'Escribe un teléfono de Venezuela con su código (por ejemplo +58 412 1234567).';
    end if;
    v_tel := nullif(v_tel, '');
  end if;
  update tumbo.usuarios
  set nombre = v_nombre, cedula = v_cedula, telefono = v_tel,
      telefono_verificado = case when telefono is distinct from v_tel then false else telefono_verificado end
  where id = yo.id
  returning * into yo;
  -- un código pedido para el teléfono anterior ya no sirve
  update tumbo.codigos_verificacion set expira = now()
  where usuario_id = yo.id and tipo = 'telefono' and usado_el is null and expira > now() and destino is distinct from v_tel;
  return tumbo_privado.perfil_completo(yo);
end $$;

-- ---------------------------------------------------------------------------
-- Contraseña
-- ---------------------------------------------------------------------------
-- Pide la actual (5 fallos cada 15 minutos por cuenta) y cierra las demás
-- sesiones. Los fallos se devuelven como {error} para que cuenten.
create function public.tm_clave_cambiar(p_sesion text, p_actual text, p_nueva text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_ok boolean;
  v_cerradas integer;
begin
  if tumbo_privado.cuenta_demo(yo.email) then
    return jsonb_build_object('error', 'La contraseña de las cuentas de prueba es pública y no se cambia: crea tu propia cuenta para probarlo.');
  end if;
  if tumbo_privado.intentos('clave', yo.id::text, null, interval '15 minutes', true) >= 5 then
    return jsonb_build_object('error', 'Demasiados intentos con la contraseña actual. Espera 15 minutos.');
  end if;
  v_ok := yo.clave_hash = extensions.crypt(coalesce(p_actual, ''), yo.clave_hash);
  perform tumbo_privado.anotar_intento('clave', yo.id::text, v_ok);
  if not v_ok then
    return jsonb_build_object('error', 'La contraseña actual no es correcta.');
  end if;
  if tumbo_privado.error_clave(p_nueva) is not null then
    return jsonb_build_object('error', tumbo_privado.error_clave(p_nueva));
  end if;
  if p_nueva = p_actual then
    return jsonb_build_object('error', 'La contraseña nueva debe ser distinta de la actual.');
  end if;
  update tumbo.usuarios set clave_hash = extensions.crypt(p_nueva, extensions.gen_salt('bf', 10)), clave_cambiada = now()
  where id = yo.id;
  delete from tumbo.sesiones where usuario_id = yo.id and token_hash <> tumbo_privado.hash_token(p_sesion);
  get diagnostics v_cerradas = row_count;
  delete from tumbo.desafios_2fa where usuario_id = yo.id;
  update tumbo.recuperaciones set usado_el = now() where usuario_id = yo.id and usado_el is null;
  perform tumbo_privado.encolar(yo.id, 'clave_cambiada', jsonb_build_object('fecha', tumbo_privado.fecha_legible(now())));
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(yo), 'Contraseña cambiada', 'por la persona · ' || v_cerradas || ' sesiones cerradas');
  return jsonb_build_object('ok', true, 'cerradas', v_cerradas);
end $$;

-- Enlace de recuperación de 30 minutos (los anteriores dejan de valer) y su
-- mensaje en la bandeja. Devuelve el enlace.
create function tumbo_privado.crear_recuperacion(p_usuario tumbo.usuarios, p_por text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_enlace text;
begin
  update tumbo.recuperaciones set usado_el = now() where usuario_id = p_usuario.id and usado_el is null;
  delete from tumbo.recuperaciones where usuario_id = p_usuario.id and creado < now() - interval '7 days';
  insert into tumbo.recuperaciones (token_hash, usuario_id, expira, red, por)
  values (tumbo_privado.hash_token(v_token), p_usuario.id, now() + interval '30 minutes', tumbo_privado.ip_cliente(), p_por);
  v_enlace := tumbo_privado.url_sitio('app/acceso/clave.html?token=' || v_token);
  perform tumbo_privado.encolar(p_usuario.id, 'recuperar_clave', jsonb_build_object('enlace', v_enlace, 'minutos', 30));
  return v_enlace;
end $$;

-- «¿Olvidaste tu contraseña?». La respuesta es la misma exista o no la
-- cuenta. Topes: 5 solicitudes por red cada 15 minutos (eso sí se dice: no
-- depende del correo) y 3 por correo cada hora (en silencio).
create function public.tm_clave_recuperar(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 120);
  v_ip text := tumbo_privado.ip_cliente();
  u tumbo.usuarios;
  v_respuesta jsonb := jsonb_build_object('ok', true, 'mensaje',
    'Si ese correo tiene una cuenta en Tumbo, te enviamos un enlace para crear una contraseña nueva. Vence en 30 minutos.');
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    return jsonb_build_object('error', 'Escribe un correo válido.');
  end if;
  if v_ip <> 'desconocida' and tumbo_privado.intentos('recuperar', null, v_ip, interval '15 minutes', false) >= 5 then
    return jsonb_build_object('error', 'Hay demasiadas solicitudes desde tu conexión. Espera unos minutos.');
  end if;
  if tumbo_privado.intentos('recuperar', v_email, null, interval '1 hour', false) >= 3 then
    perform tumbo_privado.anotar_intento('recuperar', v_email, false);
    return v_respuesta;
  end if;
  perform tumbo_privado.anotar_intento('recuperar', v_email, true);
  select * into u from tumbo.usuarios where email = v_email and activo and not bloqueado;
  if found and not tumbo_privado.cuenta_demo(v_email) then
    perform tumbo_privado.crear_recuperacion(u, null);
  end if;
  return v_respuesta;
end $$;

create function tumbo_privado.recuperacion_vigente(p_token text) returns tumbo.recuperaciones
language sql stable security definer set search_path = '' as $$
  select r.* from tumbo.recuperaciones r join tumbo.usuarios u on u.id = r.usuario_id
  where coalesce(p_token, '') ~ '^[0-9a-f]{64}$' and r.token_hash = tumbo_privado.hash_token(p_token)
    and r.usado_el is null and r.expira > now() and u.activo and not u.bloqueado
$$;

-- ¿Sigue valiendo el enlace? (la página lo consulta antes de pedir la clave)
create function public.tm_clave_enlace(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r tumbo.recuperaciones;
begin
  if tumbo_privado.intentos('enlace', null, tumbo_privado.ip_cliente(), interval '15 minutes', true) >= 20 then
    return jsonb_build_object('valido', false, 'error', 'Hay demasiados intentos desde tu conexión. Espera unos minutos.');
  end if;
  r := tumbo_privado.recuperacion_vigente(p_token);
  if r.usuario_id is null then
    perform tumbo_privado.anotar_intento('enlace', 'clave', false);
    return jsonb_build_object('valido', false, 'error', 'Este enlace ya no vale: venció o ya se usó. Pide uno nuevo desde «¿Olvidaste tu contraseña?».');
  end if;
  return jsonb_build_object('valido', true, 'correo',
    (select tumbo_privado.correo_oculto(email) from tumbo.usuarios where id = r.usuario_id), 'vence', r.expira);
end $$;

-- Fija la contraseña nueva con el enlace (un solo uso) y cierra todas las
-- sesiones. No abre una: si la cuenta tiene 2FA, el acceso la pedirá.
create function public.tm_clave_restablecer(p_token text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r tumbo.recuperaciones;
  u tumbo.usuarios;
begin
  if tumbo_privado.intentos('enlace', null, tumbo_privado.ip_cliente(), interval '15 minutes', true) >= 20 then
    return jsonb_build_object('error', 'Hay demasiados intentos desde tu conexión. Espera unos minutos.');
  end if;
  select * into r from tumbo.recuperaciones
  where token_hash = (tumbo_privado.recuperacion_vigente(p_token)).token_hash for update;
  if not found or r.usado_el is not null then
    perform tumbo_privado.anotar_intento('enlace', 'clave', false);
    return jsonb_build_object('error', 'Este enlace ya no vale: venció o ya se usó. Pide uno nuevo desde «¿Olvidaste tu contraseña?».');
  end if;
  if tumbo_privado.error_clave(p_clave) is not null then
    return jsonb_build_object('error', tumbo_privado.error_clave(p_clave));
  end if;
  update tumbo.usuarios set clave_hash = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), clave_cambiada = now()
  where id = r.usuario_id returning * into u;
  update tumbo.recuperaciones set usado_el = now() where usuario_id = u.id and usado_el is null;
  delete from tumbo.sesiones where usuario_id = u.id;
  delete from tumbo.desafios_2fa where usuario_id = u.id;
  perform tumbo_privado.encolar(u.id, 'clave_cambiada', jsonb_build_object('fecha', tumbo_privado.fecha_legible(now())));
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(u), 'Contraseña restablecida', case when r.por is null then 'con el enlace de recuperación'
                                                                   else 'con un enlace generado por ' || r.por end);
  return jsonb_build_object('ok', true, 'email', u.email);
end $$;

-- ---------------------------------------------------------------------------
-- Verificación de correo y teléfono
-- ---------------------------------------------------------------------------
create function tumbo_privado.hash_codigo(p_usuario uuid, p_tipo text, p_codigo text) returns bytea
language sql stable security definer set search_path = '' as $$
  select extensions.hmac(p_usuario::text || ':' || p_tipo || ':' || coalesce(p_codigo, ''), tumbo_privado.secreto('hmac_codigos'), 'sha256')
$$;

-- Envía (deja en la bandeja) un código de 6 dígitos que vence en 15
-- minutos. Uno por minuto y 5 por hora por cuenta y tipo; el anterior deja
-- de valer.
create function public.tm_verificacion_enviar(p_sesion text, p_tipo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_destino text;
  v_codigo text;
begin
  if p_tipo is null or p_tipo not in ('correo', 'telefono') then
    raise exception 'Indica si verificas el correo o el teléfono.';
  end if;
  if tumbo_privado.cuenta_demo(yo.email) then
    raise exception 'Las cuentas de prueba no se verifican: crea tu propia cuenta para probarlo.';
  end if;
  if p_tipo = 'correo' then
    if yo.correo_verificado then raise exception 'Tu correo ya está verificado.'; end if;
    v_destino := yo.email;
  else
    if yo.telefono is null then raise exception 'Primero guarda tu teléfono en el perfil.'; end if;
    if yo.telefono_verificado then raise exception 'Tu teléfono ya está verificado.'; end if;
    v_destino := yo.telefono;
  end if;
  if exists (select 1 from tumbo.codigos_verificacion where usuario_id = yo.id and tipo = p_tipo and creado > now() - interval '1 minute') then
    raise exception 'Ya te enviamos un código hace menos de un minuto: espera un momento antes de pedir otro.';
  end if;
  if (select count(*) from tumbo.codigos_verificacion where usuario_id = yo.id and tipo = p_tipo and creado > now() - interval '1 hour') >= 5 then
    raise exception 'Pediste muchos códigos en la última hora: inténtalo más tarde.';
  end if;
  update tumbo.codigos_verificacion set expira = now()
  where usuario_id = yo.id and tipo = p_tipo and usado_el is null and expira > now();
  delete from tumbo.codigos_verificacion where usuario_id = yo.id and creado < now() - interval '2 days';
  v_codigo := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into tumbo.codigos_verificacion (usuario_id, tipo, destino, hash, expira)
  values (yo.id, p_tipo, v_destino, tumbo_privado.hash_codigo(yo.id, p_tipo, v_codigo), now() + interval '15 minutes');
  perform tumbo_privado.encolar(yo.id, case p_tipo when 'correo' then 'verificar_correo' else 'verificar_telefono' end,
                                jsonb_build_object('codigo', v_codigo, 'minutos', 15));
  return jsonb_build_object('ok', true, 'minutos', 15,
    'destino', case p_tipo when 'correo' then tumbo_privado.correo_oculto(v_destino) else tumbo_privado.telefono_oculto(v_destino) end);
end $$;

-- Confirma el código (5 intentos). Los fallos se devuelven como {error}.
create function public.tm_verificacion_confirmar(p_sesion text, p_tipo text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  c tumbo.codigos_verificacion;
  v text := regexp_replace(coalesce(p_codigo, ''), '[^0-9]', '', 'g');
begin
  if p_tipo is null or p_tipo not in ('correo', 'telefono') then
    return jsonb_build_object('error', 'Indica si verificas el correo o el teléfono.');
  end if;
  select * into c from tumbo.codigos_verificacion
  where usuario_id = yo.id and tipo = p_tipo and usado_el is null and expira > now()
  order by creado desc limit 1 for update;
  if not found then
    return jsonb_build_object('error', 'Ese código venció o no existe: pide uno nuevo.');
  end if;
  if c.intentos >= 5 then
    return jsonb_build_object('error', 'Demasiados intentos con ese código: pide uno nuevo.');
  end if;
  if c.hash <> tumbo_privado.hash_codigo(yo.id, p_tipo, v) then
    update tumbo.codigos_verificacion set intentos = intentos + 1 where id = c.id;
    return jsonb_build_object('error', 'Código incorrecto.' || case when c.intentos + 1 < 5
                                                                    then ' Te quedan ' || (5 - c.intentos - 1) || ' intentos.' else ' Pide uno nuevo.' end);
  end if;
  if c.destino is distinct from (case p_tipo when 'correo' then yo.email else yo.telefono end) then
    update tumbo.codigos_verificacion set expira = now() where id = c.id;
    return jsonb_build_object('error', 'Ese código era para un dato que ya cambiaste: pide uno nuevo.');
  end if;
  update tumbo.codigos_verificacion set usado_el = now() where id = c.id;
  if p_tipo = 'correo' then
    update tumbo.usuarios set correo_verificado = true where id = yo.id;
  else
    update tumbo.usuarios set telefono_verificado = true where id = yo.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Sesiones por dispositivo
-- ---------------------------------------------------------------------------
create function tumbo_privado.sesion_json(s tumbo.sesiones, p_actual bytea) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'dispositivo', coalesce(s.dispositivo, 'Dispositivo desconocido'), 'red', s.red,
                            'creada', s.creada, 'ultimoUso', s.ultimo_uso, 'expira', s.expira,
                            'elevada', coalesce(s.elevada_hasta > now(), false), 'actual', s.token_hash = p_actual)
$$;

-- Las sesiones abiertas de la cuenta. En una cuenta de prueba, compartida
-- por muchos visitantes, solo la propia (nunca las redes de los demás).
create function public.tm_sesiones(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_actual bytea := tumbo_privado.hash_token(p_sesion);
begin
  return coalesce((
    select jsonb_agg(tumbo_privado.sesion_json(s, v_actual) order by s.token_hash = v_actual desc, s.ultimo_uso desc)
    from (select * from tumbo.sesiones s
          where s.usuario_id = yo.id and s.expira > now()
            and (not tumbo_privado.cuenta_demo(yo.email) or s.token_hash = v_actual)
          order by s.ultimo_uso desc limit 100) s), '[]'::jsonb);
end $$;

-- Cierra una sesión propia (también la actual: es salir).
create function public.tm_sesion_cerrar(p_sesion text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_actual bytea := tumbo_privado.hash_token(p_sesion);
  v_n integer;
begin
  delete from tumbo.sesiones
  where id = p_id and usuario_id = yo.id and (not tumbo_privado.cuenta_demo(yo.email) or token_hash = v_actual);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No encontramos esa sesión: quizá ya se cerró.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.tm_sesiones_cerrar_otras(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_n integer;
begin
  if tumbo_privado.cuenta_demo(yo.email) then
    raise exception 'En las cuentas de prueba no se cierran las sesiones de las demás personas que la usan.';
  end if;
  delete from tumbo.sesiones where usuario_id = yo.id and token_hash <> tumbo_privado.hash_token(p_sesion);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(yo), 'Sesiones cerradas', v_n || ' sesiones de otros dispositivos, por la persona');
  end if;
  return jsonb_build_object('ok', true, 'cerradas', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- Verificación en dos pasos (TOTP)
-- ---------------------------------------------------------------------------
-- Alta: pide la contraseña actual (con una sesión robada nadie activa su
-- propio teléfono y deja fuera a la persona), genera el secreto (20 bytes),
-- lo guarda cifrado y sin activar, y devuelve la clave en base32 y el
-- enlace otpauth:// para el QR. Los fallos de contraseña se devuelven como
-- {error} para que cuenten (5 cada 15 minutos, como al cambiarla).
create function public.tm_2fa_iniciar(p_sesion text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_secreto bytea := extensions.gen_random_bytes(20);
  v_clave text;
  v_ok boolean;
begin
  if tumbo_privado.cuenta_demo(yo.email) then
    raise exception 'Las cuentas de prueba usan el código fijo 123456: la verificación en dos pasos real es para las cuentas propias.';
  end if;
  if tumbo_privado.totp_activo(yo.id) then
    raise exception 'La verificación en dos pasos ya está activa. Para pasarla a otro teléfono, desactívala y vuelve a activarla.';
  end if;
  if tumbo_privado.intentos('clave', yo.id::text, null, interval '15 minutes', true) >= 5 then
    return jsonb_build_object('error', 'Demasiados intentos con la contraseña. Espera 15 minutos.');
  end if;
  v_ok := yo.clave_hash = extensions.crypt(coalesce(p_clave, ''), yo.clave_hash);
  perform tumbo_privado.anotar_intento('clave', yo.id::text, v_ok);
  if not v_ok then
    return jsonb_build_object('error', 'La contraseña no es correcta.');
  end if;
  insert into tumbo.usuarios_2fa as f (usuario_id, secreto, activo, creado, ultimo_paso)
  values (yo.id, tumbo_privado.cifrar_2fa(v_secreto), false, now(), 0)
  on conflict (usuario_id) do update set secreto = excluded.secreto, creado = now(), activado = null, ultimo_paso = 0
  where not f.activo;
  v_clave := tumbo_privado.base32(v_secreto);
  return jsonb_build_object('secreto', v_clave,
    'uri', 'otpauth://totp/' || tumbo_privado.url_codificar('Tumbo Market') || ':' || tumbo_privado.url_codificar(yo.email)
           || '?secret=' || v_clave || '&issuer=Tumbo%20Market&algorithm=SHA1&digits=6&period=30');
end $$;

-- Confirma el alta con un código de la app: la activa, entrega los 10
-- códigos de respaldo (una sola vez) y deja la sesión elevada.
create function public.tm_2fa_confirmar(p_sesion text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_ok boolean;
  v_codigos text[];
begin
  if tumbo_privado.cuenta_demo(yo.email) then
    return jsonb_build_object('error', 'Las cuentas de prueba usan el código fijo 123456.');
  end if;
  if tumbo_privado.totp_activo(yo.id) then
    return jsonb_build_object('error', 'La verificación en dos pasos ya está activa.');
  end if;
  if not exists (select 1 from tumbo.usuarios_2fa where usuario_id = yo.id and not activo and creado > now() - interval '1 hour') then
    return jsonb_build_object('error', 'La configuración venció: empieza de nuevo para ver otro código QR.');
  end if;
  if tumbo_privado.intentos('2fa_alta', yo.id::text, null, interval '15 minutes', true) >= 10 then
    return jsonb_build_object('error', 'Demasiados códigos incorrectos. Espera 15 minutos y empieza de nuevo.');
  end if;
  v_ok := tumbo_privado.totp_verificar(yo.id, regexp_replace(coalesce(p_codigo, ''), '[^0-9]', '', 'g'), false);
  perform tumbo_privado.anotar_intento('2fa_alta', yo.id::text, v_ok);
  if not v_ok then
    return jsonb_build_object('error', 'Código incorrecto. Revisa que la hora de tu teléfono esté bien y escribe el código que muestra ahora.');
  end if;
  update tumbo.usuarios_2fa set activo = true, activado = now() where usuario_id = yo.id;
  update tumbo.usuarios set mfa = true where id = yo.id;
  v_codigos := tumbo_privado.generar_respaldo(yo.id);
  update tumbo.sesiones set elevada_hasta = now() + interval '10 minutes' where token_hash = tumbo_privado.hash_token(p_sesion);
  perform tumbo_privado.notificar('usr:' || yo.id, 'Activaste la verificación en dos pasos: guarda tus códigos de respaldo', 'verified_user',
                                  tumbo_privado.enlace_cuenta(yo.rol));
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(yo), 'Verificación en dos pasos activada', yo.rol);
  return jsonb_build_object('ok', true, 'respaldo', to_jsonb(v_codigos));
end $$;

-- Desactiva con un código (TOTP o de respaldo).
create function public.tm_2fa_desactivar(p_sesion text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_ok boolean;
begin
  if tumbo_privado.cuenta_demo(yo.email) or not tumbo_privado.totp_activo(yo.id) then
    return jsonb_build_object('error', 'La verificación en dos pasos no está activa en esta cuenta.');
  end if;
  if tumbo_privado.intentos('2fa', yo.id::text, null, interval '15 minutes', true) >= 10 then
    return jsonb_build_object('error', 'Demasiados códigos incorrectos en esta cuenta. Espera 15 minutos e inténtalo de nuevo.');
  end if;
  v_ok := tumbo_privado.verificar_segundo_factor(yo, p_codigo);
  perform tumbo_privado.anotar_intento('2fa', yo.id::text, v_ok);
  if not v_ok then
    return jsonb_build_object('error', 'Código incorrecto.');
  end if;
  delete from tumbo.respaldo_2fa where usuario_id = yo.id;
  delete from tumbo.usuarios_2fa where usuario_id = yo.id;
  update tumbo.usuarios set mfa = false where id = yo.id;
  update tumbo.sesiones set elevada_hasta = null where usuario_id = yo.id and elevada_hasta is not null;
  perform tumbo_privado.notificar('usr:' || yo.id, 'Desactivaste la verificación en dos pasos de tu cuenta', 'lock_open',
                                  tumbo_privado.enlace_cuenta(yo.rol));
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(yo), 'Verificación en dos pasos desactivada', yo.rol);
  return jsonb_build_object('ok', true, 'aviso', case when tumbo_privado.rol_obliga_2fa(yo.rol)
    then 'Tu rol la exige para las acciones sensibles: actívala de nuevo para poder hacerlas.' end);
end $$;

-- Códigos de respaldo nuevos (los anteriores dejan de valer).
create function public.tm_2fa_respaldo(p_sesion text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_ok boolean;
begin
  if tumbo_privado.cuenta_demo(yo.email) or not tumbo_privado.totp_activo(yo.id) then
    return jsonb_build_object('error', 'La verificación en dos pasos no está activa en esta cuenta.');
  end if;
  if tumbo_privado.intentos('2fa', yo.id::text, null, interval '15 minutes', true) >= 10 then
    return jsonb_build_object('error', 'Demasiados códigos incorrectos en esta cuenta. Espera 15 minutos e inténtalo de nuevo.');
  end if;
  v_ok := tumbo_privado.verificar_segundo_factor(yo, p_codigo);
  perform tumbo_privado.anotar_intento('2fa', yo.id::text, v_ok);
  if not v_ok then
    return jsonb_build_object('error', 'Código incorrecto.');
  end if;
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(yo), 'Códigos de respaldo renovados', yo.rol);
  return jsonb_build_object('ok', true, 'respaldo', to_jsonb(tumbo_privado.generar_respaldo(yo.id)));
end $$;

-- ---------------------------------------------------------------------------
-- Baja de la cuenta (la persona, si es compradora; la administración, para
-- cualquier cuenta: tm_admin_baja)
-- ---------------------------------------------------------------------------
-- Revoca las invitaciones pendientes que hizo una cuenta: al bloquearla,
-- cambiarle el rol, quitarle el acceso o darla de baja (una cuenta
-- comprometida no deja invitaciones vivas). Devuelve cuántas.
create function tumbo_privado.revocar_invitaciones_de(p_usuario uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update tumbo.invitaciones set estado = 'revocada', cerrada_el = now()
  where invitado_por = p_usuario and estado = 'pendiente';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ¿Qué impide dar de baja a esta cuenta compradora? (null: nada). Pedidos en
-- curso, reclamos sin resolver o un reembolso que aún no llegó: la baja
-- borra el teléfono y la cédula con los que se devuelve el dinero y la
-- persona ya no podría entrar a verlo ni reclamarlo. Se llama con el bloqueo
-- de su carrito tomado (el mismo de tm_crear_pedido).
create function tumbo_privado.baja_impedida(p_usuario uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from tumbo.pedidos where comprador_id = p_usuario
                 and estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'devolucion'))
      or exists (select 1 from tumbo.disputas where comprador_id = p_usuario and estado <> 'resuelta')
      then 'Hay pedidos o reclamos en curso: la cuenta se podrá eliminar cuando terminen.'
    when exists (select 1 from tumbo.reembolsos r join tumbo.pedidos p on p.id = r.pedido_id
                 where p.comprador_id = p_usuario and r.estado <> 'enviado')
      then 'Hay un reembolso que todavía no se ha enviado: la cuenta se podrá eliminar cuando llegue (así no se pierden los datos para devolver el dinero).'
  end
$$;

-- Desactiva y anonimiza lo que no es fiscal (nombre, correo, teléfono,
-- cédula, direcciones, carrito, sesiones, 2FA, dispositivos y redes,
-- códigos, avisos, permisos y mensajes) y revoca sus invitaciones
-- pendientes; los pedidos (con la foto de su destino), los reclamos y la
-- auditoría se conservan. Devuelve la cuenta ya anonimizada.
create function tumbo_privado.anonimizar_cuenta(p_usuario uuid) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios;
begin
  perform tumbo_privado.bloquear_usuario(p_usuario, 'carrito');
  perform tumbo_privado.bloquear_usuario(p_usuario, 'direcciones');
  delete from tumbo.direcciones where usuario_id = p_usuario;
  delete from tumbo.carrito_items where usuario_id = p_usuario;
  delete from tumbo.usuarios_2fa where usuario_id = p_usuario;
  delete from tumbo.respaldo_2fa where usuario_id = p_usuario;
  delete from tumbo.desafios_2fa where usuario_id = p_usuario;
  delete from tumbo.codigos_verificacion where usuario_id = p_usuario;
  delete from tumbo.recuperaciones where usuario_id = p_usuario;
  delete from tumbo.dispositivos where usuario_id = p_usuario;
  delete from tumbo.redes_cuenta where usuario_id = p_usuario;
  delete from tumbo.permisos_usuario where usuario_id = p_usuario;
  delete from tumbo.preferencias_aviso where usuario_id = p_usuario;
  delete from tumbo.notificaciones where para = 'usr:' || p_usuario::text;
  delete from tumbo.salida where usuario_id = p_usuario;
  delete from tumbo.sesiones where usuario_id = p_usuario;
  perform tumbo_privado.revocar_invitaciones_de(p_usuario);
  update tumbo.usuarios
  set email = 'eliminada-' || id::text || '@cuentas.tumbo.invalid', nombre = 'Cuenta eliminada',
      clave_hash = extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf', 4)),
      telefono = null, cedula = null, correo_verificado = false, telefono_verificado = false, mfa = false,
      bloqueado = false, bloqueo_motivo = null, bloqueado_el = null, bloqueado_por = null,
      activo = false, eliminado_el = now()
  where id = p_usuario
  returning * into u;
  return u;
end $$;

-- La persona compradora se da de baja: pide la contraseña y la palabra
-- ELIMINAR, y que no haya pedidos, reclamos ni reembolsos en curso. Las
-- cuentas del equipo y de los comercios las da de baja la administración
-- (tm_admin_baja). La auditoría la nombra por su identificador.
create function public.tm_cuenta_eliminar(p_sesion text, p_clave text, p_confirmacion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas']);
  v_ok boolean;
  v_impide text;
begin
  if yo.rol <> 'comprador' then
    return jsonb_build_object('error', 'Las cuentas del equipo y de los comercios las da de baja la superadministración: escríbele a quien administra tu acceso.');
  end if;
  if tumbo_privado.cuenta_demo(yo.email) then
    return jsonb_build_object('error', 'Las cuentas de prueba no se eliminan.');
  end if;
  if upper(trim(coalesce(p_confirmacion, ''))) <> 'ELIMINAR' then
    return jsonb_build_object('error', 'Escribe ELIMINAR para confirmar.');
  end if;
  if tumbo_privado.intentos('clave', yo.id::text, null, interval '15 minutes', true) >= 5 then
    return jsonb_build_object('error', 'Demasiados intentos con la contraseña. Espera 15 minutos.');
  end if;
  v_ok := yo.clave_hash = extensions.crypt(coalesce(p_clave, ''), yo.clave_hash);
  perform tumbo_privado.anotar_intento('clave', yo.id::text, v_ok);
  if not v_ok then
    return jsonb_build_object('error', 'La contraseña no es correcta.');
  end if;
  -- con el carrito bloqueado no nace un pedido mientras se decide
  perform tumbo_privado.bloquear_usuario(yo.id, 'carrito');
  v_impide := tumbo_privado.baja_impedida(yo.id);
  if v_impide is not null then
    return jsonb_build_object('error', replace(v_impide, 'la cuenta se podrá eliminar', 'podrás eliminar tu cuenta'));
  end if;
  yo := tumbo_privado.anonimizar_cuenta(yo.id);
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(yo), 'Cuenta eliminada', 'por la persona; pedidos y auditoría conservados');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------------
create function tumbo_privado.normalizar_rif(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[[:space:].-]', '', 'g'));
begin
  if v = '' then return ''; end if;
  if v ~ '^[JGVEPC][0-9]{9}$' then
    return substr(v, 1, 1) || '-' || substr(v, 2, 8) || '-' || substr(v, 10, 1);
  end if;
  return null;
end $$;

-- Invita a una persona por correo (la invitación vence en 7 días):
--   · el seller principal, a su equipo: gestor de precios u operador;
--   · el superadministrador, al personal interno (ops, finanzas,
--     superadmin) o a un comercio nuevo (seller principal de un comercio que
--     se crea al aceptar, en revisión para el KYC).
-- Pide sesión elevada. Deja el correo en la bandeja y devuelve el enlace
-- para copiarlo.
create function public.tm_invitar(p_sesion text, p_email text, p_rol text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'superadmin']);
  v_email text := lower(trim(coalesce(p_email, '')));
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_datos jsonb := '{}'::jsonb;
  v_seller text;
  v_comercio text;
  v_rif text;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_vence timestamptz := now() + interval '7 days';
  v_enlace text;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_email) > 120 then
    raise exception 'Escribe un correo válido.';
  end if;
  if yo.rol = 'seller' then
    if p_rol is null or p_rol not in ('precios', 'operador') then
      raise exception 'A tu equipo puedes invitarlo como gestor de precios o como operador.';
    end if;
    v_seller := yo.seller_id;
    select nombre into v_comercio from tumbo.sellers where id = v_seller;
    if (select count(*) from tumbo.usuarios where seller_id = v_seller and activo)
       + (select count(*) from tumbo.invitaciones where seller_id = v_seller and estado = 'pendiente' and vence > now()) >= 20 then
      raise exception 'Tu equipo llegó al límite de 20 personas (contando las invitaciones pendientes).';
    end if;
  else
    if p_rol is null or p_rol not in ('ops', 'finanzas', 'superadmin', 'seller') then
      raise exception 'Elige el rol: operaciones, finanzas, superadministrador o un comercio nuevo.';
    end if;
    if p_rol = 'seller' then
      v_comercio := trim(coalesce(d ->> 'comercio', ''));
      if char_length(v_comercio) < 3 or char_length(v_comercio) > 80 or v_comercio ~ '[[:cntrl:]]' then
        raise exception 'Escribe el nombre del comercio (entre 3 y 80 caracteres).';
      end if;
      if char_length(trim(coalesce(d ->> 'ciudad', ''))) < 2 or char_length(trim(coalesce(d ->> 'ciudad', ''))) > 80 then
        raise exception 'Escribe la ciudad del comercio.';
      end if;
      v_rif := tumbo_privado.normalizar_rif(d ->> 'rif');
      if v_rif is null then
        raise exception 'Escribe el RIF como J-12345678-9 (o déjalo vacío: el comercio lo cargará en su expediente).';
      end if;
      v_datos := jsonb_build_object('comercio', v_comercio, 'ciudad', trim(d ->> 'ciudad'), 'rif', nullif(v_rif, ''));
    else
      -- la plantilla dice «te invitó a sumarte a {{comercio}} en Tumbo Market»
      v_comercio := 'su equipo';
    end if;
    if (select count(*) from tumbo.invitaciones where estado = 'pendiente' and vence > now()) >= 200 then
      raise exception 'Hay demasiadas invitaciones pendientes: revoca las que ya no hagan falta.';
    end if;
  end if;
  -- (decir que el correo tiene cuenta es un dato: esos intentos cuentan y
  -- tienen tope, para que nadie sondee correos invitando)
  if tumbo_privado.intentos('invitar', yo.id::text, null, interval '1 hour', true) >= 10 then
    raise exception 'Demasiadas invitaciones rechazadas en la última hora: inténtalo más tarde.';
  end if;
  if exists (select 1 from tumbo.usuarios where email = v_email and activo) then
    perform tumbo_privado.anotar_intento('invitar', yo.id::text, false);
    return jsonb_build_object('error', 'Ese correo ya tiene una cuenta activa en Tumbo.');
  end if;
  if (select count(*) from tumbo.invitaciones where invitado_por = yo.id and creado > now() - interval '1 day') >= 30 then
    raise exception 'Enviaste muchas invitaciones hoy: inténtalo mañana.';
  end if;
  -- Una invitación nueva reemplaza las pendientes de su mismo ámbito (las
  -- de ese comercio, si invita un seller; las de la plataforma, si invita
  -- la superadministración). Las de otro ámbito siguen vivas: nadie anula
  -- la invitación de otro comercio ni la del personal interno.
  update tumbo.invitaciones set estado = 'revocada', cerrada_el = now()
  where email = v_email and estado = 'pendiente'
    and ((yo.rol = 'seller' and seller_id = v_seller and rol in ('precios', 'operador'))
         or (yo.rol = 'superadmin' and seller_id is null));
  insert into tumbo.invitaciones (token_hash, email, rol, seller_id, datos, invitado_por, por, vence)
  values (tumbo_privado.hash_token(v_token), v_email, p_rol, v_seller, v_datos, yo.id, yo.nombre || ' (' || yo.rol || ')', v_vence)
  returning id into v_id;
  v_enlace := tumbo_privado.url_sitio('app/acceso/invitacion.html?token=' || v_token);
  perform tumbo_privado.encolar(null, 'invitacion', jsonb_build_object(
    'correo', v_email, 'invita', yo.nombre, 'comercio', v_comercio, 'rol', tumbo_privado.nombre_rol(p_rol),
    'dias', 7, 'enlace', v_enlace));
  perform tumbo_privado.auditar(yo, 'Invitación enviada',
    tumbo_privado.correo_oculto(v_email) || ' como ' || p_rol || coalesce(' · ' || v_seller, '')
    || case when p_rol = 'seller' and v_seller is null then ' · comercio nuevo «' || v_comercio || '»' else '' end || ' · invitación ' || v_id);
  return jsonb_build_object('id', v_id, 'email', v_email, 'rol', p_rol, 'vence', v_vence, 'enlace', v_enlace);
end $$;

create function tumbo_privado.invitacion_json(i tumbo.invitaciones) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'email', i.email, 'rol', i.rol, 'rolNombre', tumbo_privado.nombre_rol(i.rol),
    'sellerId', i.seller_id,
    'comercio', coalesce(i.datos ->> 'comercio', (select s.nombre from tumbo.sellers s where s.id = i.seller_id)),
    'por', i.por, 'creado', i.creado, 'vence', i.vence,
    'estado', case when i.estado = 'pendiente' and i.vence <= now() then 'vencida' else i.estado end,
    'cerradaEl', i.cerrada_el)
$$;

-- Invitaciones visibles: el seller principal, las de su comercio; el
-- superadministrador, todas (con una cuenta de prueba, solo las que
-- hicieron cuentas de prueba).
create function public.tm_invitaciones(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'superadmin']);
begin
  return coalesce((
    select jsonb_agg(tumbo_privado.invitacion_json(i) order by i.creado desc)
    from (select * from tumbo.invitaciones i
          where (yo.rol = 'seller' and i.seller_id = yo.seller_id and i.rol in ('precios', 'operador'))
             or (yo.rol = 'superadmin' and (not tumbo_privado.cuenta_demo(yo.email)
                 or exists (select 1 from tumbo.usuarios x where x.id = i.invitado_por and tumbo_privado.cuenta_demo(x.email))))
          order by i.creado desc limit 200) i), '[]'::jsonb);
end $$;

create function public.tm_invitacion_revocar(p_sesion text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'superadmin']);
  i tumbo.invitaciones;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  select * into i from tumbo.invitaciones where id = p_id for update;
  if not found or (yo.rol = 'seller' and (i.seller_id is distinct from yo.seller_id or i.rol not in ('precios', 'operador'))) then
    raise exception 'No encontramos esa invitación.';
  end if;
  if i.estado <> 'pendiente' then
    raise exception 'Esa invitación ya no está pendiente (%).', i.estado;
  end if;
  update tumbo.invitaciones set estado = 'revocada', cerrada_el = now() where id = i.id;
  perform tumbo_privado.auditar(yo, 'Invitación revocada', tumbo_privado.correo_oculto(i.email) || ' como ' || i.rol || ' · invitación ' || i.id);
  return jsonb_build_object('ok', true);
end $$;

-- ¿Puede quien hizo la invitación seguir haciéndola? Activo, sin bloquear
-- y con el rol que la permitía: el seller principal de ese comercio para su
-- equipo; un superadministrador para el personal interno y los comercios
-- nuevos. La de puesta en marcha (SQL) no la hizo ninguna cuenta.
create function tumbo_privado.invitante_vigente(i tumbo.invitaciones) returns boolean
language sql stable security definer set search_path = '' as $$
  select i.inicial or exists (
    select 1 from tumbo.usuarios x
    where x.id = i.invitado_por and x.activo and not x.bloqueado and not tumbo_privado.cuenta_demo(x.email)
      and ((i.rol in ('precios', 'operador') and x.rol = 'seller' and x.seller_id is not distinct from i.seller_id)
           or (i.rol in ('ops', 'finanzas', 'superadmin', 'seller') and i.seller_id is null and x.rol = 'superadmin')))
$$;

create function tumbo_privado.invitacion_vigente(p_token text) returns tumbo.invitaciones
language sql stable security definer set search_path = '' as $$
  select * from tumbo.invitaciones i
  where coalesce(p_token, '') ~ '^[0-9a-f]{64}$' and i.token_hash = tumbo_privado.hash_token(p_token)
    and i.estado = 'pendiente' and i.vence > now() and tumbo_privado.invitante_vigente(i)
$$;

-- La página de aceptación: a quién, como qué y quién invita.
create function public.tm_invitacion_ver(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i tumbo.invitaciones;
begin
  if tumbo_privado.intentos('invitacion', null, tumbo_privado.ip_cliente(), interval '15 minutes', true) >= 20 then
    return jsonb_build_object('valida', false, 'error', 'Hay demasiados intentos desde tu conexión. Espera unos minutos.');
  end if;
  i := tumbo_privado.invitacion_vigente(p_token);
  if i.id is null then
    perform tumbo_privado.anotar_intento('invitacion', 'ver', false);
    return jsonb_build_object('valida', false, 'error', 'Esta invitación ya no vale: venció, se revocó o ya se usó. Pide una nueva a quien te invitó.');
  end if;
  return jsonb_build_object('valida', true, 'email', i.email, 'rol', i.rol, 'rolNombre', tumbo_privado.nombre_rol(i.rol),
    'comercio', coalesce(i.datos ->> 'comercio', (select s.nombre from tumbo.sellers s where s.id = i.seller_id)),
    'comercioNuevo', i.rol = 'seller' and i.seller_id is null,
    'invita', regexp_replace(i.por, ' \([a-z]+\)$', ''), 'vence', i.vence,
    'terminosVersion', tumbo_privado.ajuste('terminos_version') #>> '{}');
end $$;

-- Acepta la invitación: crea la cuenta con el rol (y el comercio nuevo, en
-- revisión, con sus documentos pendientes) y la persona entra después con
-- su correo y su contraseña. El correo queda sin verificar (el enlace se
-- pudo copiar).
create function public.tm_invitacion_aceptar(p_token text, p_nombre text, p_clave text, p_terminos text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i tumbo.invitaciones;
  u tumbo.usuarios;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_vigente text := tumbo_privado.ajuste('terminos_version') #>> '{}';
  v_seller text;
  v_n bigint;
begin
  if tumbo_privado.intentos('invitacion', null, tumbo_privado.ip_cliente(), interval '15 minutes', true) >= 20 then
    return jsonb_build_object('error', 'Hay demasiados intentos desde tu conexión. Espera unos minutos.');
  end if;
  select * into i from tumbo.invitaciones where id = (tumbo_privado.invitacion_vigente(p_token)).id for update;
  if not found or i.estado <> 'pendiente' or i.vence <= now() or not tumbo_privado.invitante_vigente(i) then
    perform tumbo_privado.anotar_intento('invitacion', 'aceptar', false);
    return jsonb_build_object('error', 'Esta invitación ya no vale: venció, se revocó o ya se usó. Pide una nueva a quien te invitó.');
  end if;
  if tumbo_privado.error_nombre(v_nombre) is not null then
    return jsonb_build_object('error', tumbo_privado.error_nombre(v_nombre));
  end if;
  if tumbo_privado.error_clave(p_clave) is not null then
    return jsonb_build_object('error', tumbo_privado.error_clave(p_clave));
  end if;
  if p_terminos is distinct from v_vigente then
    return jsonb_build_object('error', 'Acepta los términos vigentes (versión ' || coalesce(v_vigente, '—') || ') para continuar.');
  end if;
  -- Solo vuelve una cuenta del equipo a la que le retiraron el acceso: una
  -- bloqueada, la de un comprador o una dada de baja por otro motivo no.
  select * into u from tumbo.usuarios where email = i.email for update;
  if found and (u.activo or u.eliminado_el is not null or u.bloqueado or u.rol = 'comprador') then
    return jsonb_build_object('error', 'Ese correo ya tiene una cuenta en Tumbo: inicia sesión o escribe a soporte.');
  end if;

  v_seller := i.seller_id;
  if i.rol = 'seller' and v_seller is null then
    loop
      v_n := nextval('tumbo_privado.seq_seller');
      v_seller := 'SEL-' || tumbo_privado.folio(v_n, 3);
      exit when not exists (select 1 from tumbo.sellers where id = v_seller);
    end loop;
    insert into tumbo.sellers (id, nombre, ciudad, estado, rating, resenas, desde, descripcion)
    values (v_seller, i.datos ->> 'comercio', coalesce(i.datos ->> 'ciudad', '—'), 'en_revision', null, 0, current_date, '');
    insert into tumbo.sellers_kyc (seller_id, rif, observacion) values (v_seller, coalesce(i.datos ->> 'rif', '—'), null)
    on conflict (seller_id) do nothing;
    insert into tumbo.seller_documentos (seller_id, orden, nombre, estado)
    select v_seller, d.orden, d.nombre, 'pendiente'
    from (values (1, 'RIF vigente'), (2, 'Registro mercantil'), (3, 'Cédula del representante'), (4, 'Cuenta de liquidación')) d (orden, nombre)
    on conflict do nothing;
    perform tumbo_privado.notificar('rol:superadmin', 'Comercio nuevo por homologar: ' || (i.datos ->> 'comercio') || ' (' || v_seller || ')',
                                    'storefront', 'admin/sellers.html');
  elsif v_seller is not null and not exists (select 1 from tumbo.sellers where id = v_seller) then
    return jsonb_build_object('error', 'El comercio de esta invitación ya no existe.');
  end if;

  if u.id is not null then
    -- una cuenta a la que le retiraron el acceso vuelve con el rol nuevo
    update tumbo.usuarios
    set nombre = v_nombre, clave_hash = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), rol = i.rol,
        seller_id = case when i.rol in ('seller', 'precios', 'operador') then v_seller end,
        activo = true, mfa = false, correo_verificado = false,
        terminos_version = v_vigente, terminos_fecha = now(), clave_cambiada = now()
    where id = u.id returning * into u;
    delete from tumbo.usuarios_2fa where usuario_id = u.id;
    delete from tumbo.respaldo_2fa where usuario_id = u.id;
    delete from tumbo.permisos_usuario where usuario_id = u.id;
  else
    insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id, terminos_version, terminos_fecha)
    values (i.email, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), v_nombre, i.rol,
            case when i.rol in ('seller', 'precios', 'operador') then v_seller end, v_vigente, now())
    returning * into u;
  end if;
  update tumbo.invitaciones set estado = 'aceptada', cerrada_el = now(), usuario_id = u.id, seller_id = v_seller where id = i.id;
  perform tumbo_privado.anotar_intento('invitacion', 'aceptar', true);
  perform tumbo_privado.auditar(tumbo_privado.actor_cuenta(u), 'Invitación aceptada', u.rol || coalesce(' · ' || v_seller, '')
    || ' · invitación ' || i.id || ' de ' || coalesce((select tumbo_privado.ref_usuario(x) from tumbo.usuarios x where x.id = i.invitado_por),
                                                       'la puesta en marcha'));
  if i.invitado_por is not null then
    perform tumbo_privado.notificar('usr:' || i.invitado_por, v_nombre || ' aceptó tu invitación como ' || tumbo_privado.nombre_rol(i.rol),
                                    'how_to_reg', null);
  end if;
  return jsonb_build_object('ok', true, 'email', u.email, 'rol', u.rol, 'sellerId', u.seller_id);
end $$;

-- Puesta en marcha: la primera cuenta real de superadministrador. Solo se
-- ejecuta desde el SQL Editor (tumbo_privado no se expone por la API):
--   select tumbo_privado.invitacion_inicial('dueña@dominio.com');
-- Devuelve el enlace para fijar el nombre y la contraseña (vence en 7 días).
create function tumbo_privado.invitacion_inicial(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_email) > 120 or tumbo_privado.cuenta_demo(v_email) then
    raise exception 'Escribe el correo real de la persona dueña del proyecto.';
  end if;
  if exists (select 1 from tumbo.usuarios where email = v_email and activo) then
    raise exception 'Ese correo ya tiene una cuenta activa.';
  end if;
  update tumbo.invitaciones set estado = 'revocada', cerrada_el = now() where email = v_email and estado = 'pendiente';
  insert into tumbo.invitaciones (token_hash, email, rol, invitado_por, por, vence, inicial)
  values (tumbo_privado.hash_token(v_token), v_email, 'superadmin', null, 'Puesta en marcha (SQL)', now() + interval '7 days', true);
  perform tumbo_privado.auditar(null, 'Invitación inicial de superadministrador', tumbo_privado.correo_oculto(v_email));
  return tumbo_privado.url_sitio('app/acceso/invitacion.html?token=' || v_token);
end $$;

-- ---------------------------------------------------------------------------
-- Equipo del seller
-- ---------------------------------------------------------------------------
create function tumbo_privado.miembro_json(u tumbo.usuarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'nombre', u.nombre, 'email', u.email, 'rol', u.rol,
    'rolNombre', tumbo_privado.nombre_rol(u.rol), 'ultimoAcceso', u.ultimo_acceso, 'bloqueado', u.bloqueado,
    'totp', tumbo_privado.totp_activo(u.id), 'demo', tumbo_privado.cuenta_demo(u.email),
    'permisos', coalesce((select jsonb_agg(pu.permiso order by pu.permiso) from tumbo.permisos_usuario pu where pu.usuario_id = u.id), '[]'::jsonb))
$$;

create function public.tm_equipo(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller']);
begin
  return jsonb_build_object(
    'miembros', coalesce((select jsonb_agg(tumbo_privado.miembro_json(u) || jsonb_build_object('yo', u.id = yo.id)
                                           order by u.rol = 'seller' desc, u.nombre)
                          from tumbo.usuarios u where u.seller_id = yo.seller_id and u.activo), '[]'::jsonb),
    'invitaciones', public.tm_invitaciones(p_sesion));
end $$;

-- Quita el acceso a una persona del equipo (gestor de precios u operador):
-- la cuenta queda desactivada y sin sesiones; se la puede volver a invitar.
create function public.tm_equipo_quitar(p_sesion text, p_usuario uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  o tumbo.usuarios;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  select * into o from tumbo.usuarios where id = p_usuario and seller_id = yo.seller_id and activo for update;
  if not found or o.rol not in ('precios', 'operador') then
    raise exception 'No encontramos a esa persona en tu equipo.';
  end if;
  update tumbo.usuarios set activo = false where id = o.id;
  delete from tumbo.sesiones where usuario_id = o.id;
  delete from tumbo.desafios_2fa where usuario_id = o.id;
  delete from tumbo.permisos_usuario where usuario_id = o.id;
  perform tumbo_privado.revocar_invitaciones_de(o.id);
  perform tumbo_privado.auditar(yo, 'Acceso al comercio retirado', tumbo_privado.ref_usuario(o) || ' de ' || yo.seller_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos finos
-- ---------------------------------------------------------------------------
create function public.tm_permisos(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'superadmin', 'ops', 'finanzas']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('permiso', p.permiso, 'descripcion', p.descripcion, 'ambito', p.ambito,
                                                       'implicitoEn', p.implicito_en, 'asignableA', p.asignable_a) order by p.ambito, p.permiso)
                   from tumbo.permisos p), '[]'::jsonb);
end $$;

-- Otorga o retira un permiso: los internos, el superadministrador (a ops y
-- finanzas); los del comercio, el seller principal a su equipo (o el
-- superadministrador). Con sesión elevada y auditado.
create function public.tm_permiso_asignar(p_sesion text, p_usuario uuid, p_permiso text, p_otorgar boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'superadmin']);
  o tumbo.usuarios;
  p tumbo.permisos;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  select * into p from tumbo.permisos where permiso = p_permiso;
  if not found then
    raise exception 'Ese permiso no existe.';
  end if;
  select * into o from tumbo.usuarios where id = p_usuario and activo;
  if not found
     or (yo.rol = 'seller' and (p.ambito <> 'seller' or o.seller_id is distinct from yo.seller_id))
     or (yo.rol = 'superadmin' and not tumbo_privado.ve_usuario(yo, o)) then
    raise exception 'No encontramos a esa persona.';
  end if;
  if not (o.rol = any (p.asignable_a)) then
    raise exception 'El permiso «%» no se asigna al rol %.', p.permiso, tumbo_privado.nombre_rol(o.rol);
  end if;
  if coalesce(p_otorgar, false) then
    insert into tumbo.permisos_usuario (usuario_id, permiso, otorgado_por)
    values (o.id, p.permiso, yo.nombre || ' (' || yo.rol || ')')
    on conflict (usuario_id, permiso) do nothing;
  else
    delete from tumbo.permisos_usuario where usuario_id = o.id and permiso = p.permiso;
  end if;
  perform tumbo_privado.auditar(yo, case when p_otorgar then 'Permiso otorgado' else 'Permiso retirado' end,
                                p.permiso || ' · ' || tumbo_privado.ref_usuario(o));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Administración de usuarios
-- ---------------------------------------------------------------------------
create function tumbo_privado.usuario_admin_json(u tumbo.usuarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'nombre', u.nombre, 'rol', u.rol, 'rolNombre', tumbo_privado.nombre_rol(u.rol),
    'sellerId', u.seller_id, 'comercio', (select s.nombre from tumbo.sellers s where s.id = u.seller_id),
    'telefono', u.telefono, 'cedula', u.cedula, 'correoVerificado', u.correo_verificado, 'telefonoVerificado', u.telefono_verificado,
    'activo', u.activo, 'bloqueado', u.bloqueado, 'bloqueoMotivo', u.bloqueo_motivo, 'bloqueadoEl', u.bloqueado_el,
    'bloqueadoPor', u.bloqueado_por, 'eliminado', u.eliminado_el is not null, 'creado', u.creado, 'ultimoAcceso', u.ultimo_acceso,
    'totp', tumbo_privado.totp_activo(u.id), 'demo', tumbo_privado.cuenta_demo(u.email))
$$;

-- Busca por correo, nombre, teléfono, cédula o identificador (el de la
-- auditoría) (las 50 más recientes que
-- coincidan). El superadministrador ve a todos; operaciones, solo a los
-- compradores (tenga o no el permiso «usuarios»); con una cuenta de prueba,
-- solo a las cuentas de prueba.
create function public.tm_admin_usuarios(p_sesion text, p_texto text, p_rol text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  v_texto text := left(trim(coalesce(p_texto, '')), 80);
  v_patron text := '%' || replace(replace(replace(lower(left(trim(coalesce(p_texto, '')), 80)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digitos text := regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g');
begin
  if p_rol is not null and p_rol not in ('comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas') then
    raise exception 'Ese rol no existe.';
  end if;
  return coalesce((
    select jsonb_agg(tumbo_privado.usuario_admin_json(u) order by u.creado desc)
    from (select * from tumbo.usuarios u
          where tumbo_privado.ve_usuario(yo, u)
            and (p_rol is null or u.rol = p_rol)
            and (v_texto = '' or u.id::text = lower(v_texto)
                 or lower(u.email) like v_patron or lower(u.nombre) like v_patron
                 or (char_length(v_digitos) >= 4 and (regexp_replace(coalesce(u.telefono, ''), '[^0-9]', '', 'g') like '%' || v_digitos || '%'
                                                     or regexp_replace(coalesce(u.cedula, ''), '[^0-9]', '', 'g') like '%' || v_digitos || '%')))
          order by u.creado desc limit 50) u), '[]'::jsonb);
end $$;

-- Ficha de una cuenta: datos, sesiones abiertas, permisos e invitación.
create function public.tm_admin_usuario(p_sesion text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  o tumbo.usuarios;
begin
  select * into o from tumbo.usuarios where id = p_id;
  if not found or not tumbo_privado.ve_usuario(yo, o) then
    raise exception 'No encontramos esa cuenta.';
  end if;
  return tumbo_privado.usuario_admin_json(o) || jsonb_build_object(
    'gestiona', tumbo_privado.gestiona_usuario(yo, o) and not tumbo_privado.cuenta_demo(yo.email),
    'puedeBaja', yo.rol = 'superadmin' and not tumbo_privado.cuenta_demo(yo.email) and not tumbo_privado.cuenta_demo(o.email)
                 and o.eliminado_el is null and o.id <> yo.id,
    'sesiones', case when tumbo_privado.gestiona_usuario(yo, o) then coalesce((
       select jsonb_agg(tumbo_privado.sesion_json(s, null) order by s.ultimo_uso desc)
       from (select * from tumbo.sesiones s where s.usuario_id = o.id and s.expira > now() order by s.ultimo_uso desc limit 100) s), '[]'::jsonb)
       else '[]'::jsonb end,
    'permisos', coalesce((select jsonb_agg(pu.permiso order by pu.permiso) from tumbo.permisos_usuario pu where pu.usuario_id = o.id), '[]'::jsonb),
    'permisosEfectivos', coalesce((select jsonb_agg(p.permiso order by p.permiso) from tumbo.permisos p where tumbo_privado.tiene_permiso(o, p.permiso)), '[]'::jsonb));
end $$;

-- La cuenta que se gestiona, bloqueada para el cambio (o «no encontrada»).
create function tumbo_privado.cuenta_gestionada(p_yo tumbo.usuarios, p_id uuid) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  o tumbo.usuarios;
begin
  select * into o from tumbo.usuarios where id = p_id for update;
  if not found or not tumbo_privado.gestiona_usuario(p_yo, o) then
    raise exception 'No encontramos esa cuenta.';
  end if;
  return o;
end $$;

-- ¿Queda otro superadministrador real activo además de p_excepto?
create function tumbo_privado.otro_superadmin(p_excepto uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.usuarios where rol = 'superadmin' and activo and not bloqueado
                 and id <> p_excepto and not tumbo_privado.cuenta_demo(email))
$$;

-- Cierra sesiones de otra cuenta (una, o todas con p_id null).
create function public.tm_admin_sesiones_cerrar(p_sesion text, p_usuario uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  o tumbo.usuarios;
  v_n integer;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  o := tumbo_privado.cuenta_gestionada(yo, p_usuario);
  delete from tumbo.sesiones where usuario_id = o.id and (p_id is null or id = p_id)
    and token_hash <> tumbo_privado.hash_token(p_sesion);
  get diagnostics v_n = row_count;
  perform tumbo_privado.auditar(yo, 'Sesiones cerradas por la administración', tumbo_privado.ref_usuario(o) || ' · ' || v_n || ' sesiones');
  return jsonb_build_object('ok', true, 'cerradas', v_n);
end $$;

-- Bloquea o desbloquea una cuenta, siempre con motivo (queda en la
-- auditoría). Bloquear cierra sus sesiones y revoca las invitaciones que
-- dejó pendientes; nadie se bloquea a sí mismo ni deja la plataforma sin
-- superadministrador real.
create function public.tm_admin_bloquear(p_sesion text, p_usuario uuid, p_bloquear boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  o tumbo.usuarios;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
  v_revocadas integer;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  o := tumbo_privado.cuenta_gestionada(yo, p_usuario);
  if o.id = yo.id then
    raise exception 'No puedes bloquear tu propia cuenta.';
  end if;
  if not o.activo then
    raise exception 'Esa cuenta no está activa.';
  end if;
  if v_motivo is null or char_length(v_motivo) < 5 then
    raise exception 'Escribe el motivo del %, de al menos 5 caracteres (queda en la auditoría).',
      case when coalesce(p_bloquear, false) then 'bloqueo' else 'desbloqueo' end;
  end if;
  if coalesce(p_bloquear, false) then
    if o.rol = 'superadmin' and not tumbo_privado.otro_superadmin(o.id) then
      raise exception 'Es el único superadministrador activo: no se puede bloquear.';
    end if;
    update tumbo.usuarios set bloqueado = true, bloqueo_motivo = v_motivo, bloqueado_el = now(),
                              bloqueado_por = yo.nombre || ' (' || yo.rol || ')'
    where id = o.id;
    delete from tumbo.sesiones where usuario_id = o.id;
    delete from tumbo.desafios_2fa where usuario_id = o.id;
    v_revocadas := tumbo_privado.revocar_invitaciones_de(o.id);
    perform tumbo_privado.auditar(yo, 'Cuenta bloqueada', tumbo_privado.ref_usuario(o) || ' · ' || v_motivo
      || case when v_revocadas > 0 then ' · ' || v_revocadas || ' invitaciones pendientes revocadas' else '' end);
  else
    if not o.bloqueado then
      raise exception 'Esa cuenta no está bloqueada.';
    end if;
    update tumbo.usuarios set bloqueado = false, bloqueo_motivo = null, bloqueado_el = null, bloqueado_por = null where id = o.id;
    perform tumbo_privado.notificar('usr:' || o.id, 'Tu cuenta fue desbloqueada', 'lock_open', null);
    perform tumbo_privado.auditar(yo, 'Cuenta desbloqueada', tumbo_privado.ref_usuario(o) || ' · ' || v_motivo);
  end if;
  return jsonb_build_object('ok', true, 'invitacionesRevocadas', coalesce(v_revocadas, 0));
end $$;

-- Genera un enlace de recuperación para otra cuenta y lo deja en su
-- bandeja. Solo el superadministrador lo recibe para enviarlo a mano;
-- operaciones (con el permiso «usuarios», a compradores) solo lo encola: el
-- enlace no necesita el buzón de la persona, así que quien lo tiene puede
-- fijar la contraseña. Auditado sin el enlace.
create function public.tm_admin_recuperacion(p_sesion text, p_usuario uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  o tumbo.usuarios;
  v_enlace text;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  o := tumbo_privado.cuenta_gestionada(yo, p_usuario);
  if not o.activo or o.bloqueado or tumbo_privado.cuenta_demo(o.email) then
    raise exception 'Esa cuenta no puede recuperar su contraseña (está inactiva, bloqueada o es de prueba).';
  end if;
  if o.id = yo.id then
    raise exception 'Para tu propia cuenta usa «Cambiar contraseña» en Mi cuenta.';
  end if;
  v_enlace := tumbo_privado.crear_recuperacion(o, yo.nombre || ' (' || yo.rol || ')');
  perform tumbo_privado.auditar(yo, 'Enlace de recuperación generado', tumbo_privado.ref_usuario(o)
    || case when yo.rol = 'superadmin' then '' else ' · solo en su bandeja' end);
  return jsonb_build_object('ok', true, 'enlace', case when yo.rol = 'superadmin' then v_enlace end,
                            'enBandeja', true, 'vence', now() + interval '30 minutes');
end $$;

-- Cambia el rol del personal interno (ops, finanzas, superadmin). Cierra
-- sus sesiones, retira los permisos que el rol nuevo no admite y revoca las
-- invitaciones que dejó pendientes.
create function public.tm_admin_rol(p_sesion text, p_usuario uuid, p_rol text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  o tumbo.usuarios;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  o := tumbo_privado.cuenta_gestionada(yo, p_usuario);
  if p_rol is null or p_rol not in ('ops', 'finanzas', 'superadmin') or not tumbo_privado.rol_interno(o.rol) then
    raise exception 'Solo se cambia el rol del personal interno (operaciones, finanzas y superadministración).';
  end if;
  if o.id = yo.id then
    raise exception 'No puedes cambiar tu propio rol.';
  end if;
  if o.rol = p_rol then
    raise exception 'Esa cuenta ya tiene ese rol.';
  end if;
  if o.rol = 'superadmin' and not tumbo_privado.otro_superadmin(o.id) then
    raise exception 'Es el único superadministrador activo: no se le puede quitar el rol.';
  end if;
  update tumbo.usuarios set rol = p_rol where id = o.id;
  delete from tumbo.sesiones where usuario_id = o.id;
  delete from tumbo.desafios_2fa where usuario_id = o.id;
  delete from tumbo.permisos_usuario pu where pu.usuario_id = o.id
    and not exists (select 1 from tumbo.permisos p where p.permiso = pu.permiso and p_rol = any (p.asignable_a));
  perform tumbo_privado.revocar_invitaciones_de(o.id);
  perform tumbo_privado.auditar(yo, 'Rol cambiado', 'cuenta ' || o.id || ': ' || o.rol || ' → ' || p_rol);
  return jsonb_build_object('ok', true);
end $$;

-- Quita la verificación en dos pasos de otra cuenta que perdió el teléfono y
-- sus códigos de respaldo (después de comprobar su identidad por otro
-- canal). Solo el superadministrador, con motivo; cierra sus sesiones.
create function public.tm_admin_2fa_quitar(p_sesion text, p_usuario uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  o tumbo.usuarios;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  o := tumbo_privado.cuenta_gestionada(yo, p_usuario);
  if o.id = yo.id then
    raise exception 'Para tu propia cuenta usa «Desactivar» en Mi cuenta (con un código de respaldo).';
  end if;
  if not tumbo_privado.totp_activo(o.id) then
    raise exception 'Esa cuenta no tiene la verificación en dos pasos activa.';
  end if;
  if v_motivo is null or char_length(v_motivo) < 5 then
    raise exception 'Escribe cómo comprobaste la identidad de la persona (queda en la auditoría).';
  end if;
  delete from tumbo.respaldo_2fa where usuario_id = o.id;
  delete from tumbo.usuarios_2fa where usuario_id = o.id;
  delete from tumbo.desafios_2fa where usuario_id = o.id;
  delete from tumbo.sesiones where usuario_id = o.id;
  update tumbo.usuarios set mfa = false where id = o.id;
  perform tumbo_privado.notificar('usr:' || o.id, 'La administración quitó la verificación en dos pasos de tu cuenta: actívala de nuevo en Mi cuenta → Seguridad',
                                  'lock_open', tumbo_privado.enlace_cuenta(o.rol));
  perform tumbo_privado.auditar(yo, 'Verificación en dos pasos quitada', tumbo_privado.ref_usuario(o) || ' · ' || v_motivo);
  return jsonb_build_object('ok', true);
end $$;

-- Baja administrativa (solo el superadministrador, con sesión elevada y
-- motivo): desactiva y anonimiza la cuenta como la baja de la persona
-- (anonimizar_cuenta), cierra sus sesiones y revoca sus invitaciones. Para
-- quien se va del equipo interno o de un comercio, o una compradora que lo
-- pide por otro canal (con las mismas condiciones que su propia baja). Un
-- seller principal solo cuando su comercio ya no opera (suspendido,
-- rechazado o aún en revisión): si no, el comercio quedaría sin quien lo
-- gestione. Nadie se da de baja a sí mismo por aquí ni deja la plataforma
-- sin superadministrador real.
create function public.tm_admin_baja(p_sesion text, p_usuario uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  o tumbo.usuarios;
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
  v_impide text;
begin
  perform tumbo_privado.exigir_admin_elevada(yo);
  o := tumbo_privado.cuenta_gestionada(yo, p_usuario);
  if o.id = yo.id then
    raise exception 'No puedes dar de baja tu propia cuenta: pídeselo a otro superadministrador.';
  end if;
  if tumbo_privado.cuenta_demo(o.email) then
    raise exception 'Las cuentas de prueba no se dan de baja.';
  end if;
  if o.eliminado_el is not null then
    raise exception 'Esa cuenta ya está dada de baja.';
  end if;
  if v_motivo is null or char_length(v_motivo) < 5 then
    raise exception 'Escribe el motivo de la baja, de al menos 5 caracteres (queda en la auditoría).';
  end if;
  if o.rol = 'superadmin' and not tumbo_privado.otro_superadmin(o.id) then
    raise exception 'Es el único superadministrador activo: no se puede dar de baja.';
  end if;
  if o.rol = 'seller' and exists (select 1 from tumbo.sellers s where s.id = o.seller_id and s.estado in ('aprobado', 'observado')) then
    raise exception 'Su comercio sigue operando: suspéndelo en «Sellers y KYC» antes de dar de baja a su seller principal.';
  end if;
  if o.rol = 'comprador' then
    perform tumbo_privado.bloquear_usuario(o.id, 'carrito');
    v_impide := tumbo_privado.baja_impedida(o.id);
    if v_impide is not null then
      raise exception '%', v_impide;
    end if;
  end if;
  perform tumbo_privado.anonimizar_cuenta(o.id);
  perform tumbo_privado.auditar(yo, 'Cuenta dada de baja por la administración', tumbo_privado.ref_usuario(o) || ' · ' || v_motivo);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Libreta de direcciones
-- ---------------------------------------------------------------------------
create function tumbo_privado.estados_venezuela() returns text[]
language sql immutable set search_path = '' as $$
  select array['Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas', 'Bolívar', 'Carabobo', 'Cojedes', 'Delta Amacuro',
               'Distrito Capital', 'Falcón', 'Guárico', 'La Guaira', 'Lara', 'Mérida', 'Miranda', 'Monagas', 'Nueva Esparta',
               'Portuguesa', 'Sucre', 'Táchira', 'Trujillo', 'Yaracuy', 'Zulia']
$$;

-- Normaliza y valida los datos de una dirección. Obligatorios: nombre
-- (Casa, Oficina…), dirección y municipio; con el formato completo (trae
-- «estado»), también estado (uno de los 24), ciudad, destinatario y su
-- teléfono. Devuelve los campos listos para guardar.
create function tumbo_privado.direccion_datos(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_completa boolean := d ? 'estado';
  v_nombre text := trim(coalesce(d ->> 'nombre', ''));
  v_linea text := trim(coalesce(d ->> 'linea', ''));
  v_municipio text := trim(coalesce(d ->> 'municipio', ''));
  v_ciudad text := nullif(trim(coalesce(d ->> 'ciudad', '')), '');
  v_estado text := nullif(trim(coalesce(d ->> 'estado', '')), '');
  v_parroquia text := nullif(trim(coalesce(d ->> 'parroquia', '')), '');
  v_referencia text := nullif(trim(coalesce(d ->> 'referencia', '')), '');
  v_destinatario text := nullif(trim(coalesce(d ->> 'destinatario', '')), '');
  v_cedula text := tumbo_privado.normalizar_cedula(d ->> 'cedula_destinatario');
  v_tel_dest text := tumbo_privado.normalizar_telefono(d ->> 'telefono_destinatario');
  v_tel text := tumbo_privado.normalizar_telefono(d ->> 'telefono');
  v_codigo text := trim(coalesce(d ->> 'codigo', ''));
begin
  if char_length(v_nombre) < 1 or char_length(v_nombre) > 60 then
    raise exception 'Ponle un nombre a la dirección (Casa, Oficina…), de hasta 60 caracteres.';
  end if;
  if char_length(v_linea) < 3 or char_length(v_linea) > 200 then
    raise exception 'Escribe la dirección completa (calle, edificio o casa, piso…), de hasta 200 caracteres.';
  end if;
  if char_length(v_municipio) < 2 or char_length(v_municipio) > 80 then
    raise exception 'Escribe el municipio.';
  end if;
  if v_completa then
    if v_estado is null or not (v_estado = any (tumbo_privado.estados_venezuela())) then
      raise exception 'Elige el estado de la lista.';
    end if;
    if v_ciudad is null then
      raise exception 'Escribe la ciudad.';
    end if;
    if v_destinatario is null or char_length(v_destinatario) < 2 then
      raise exception 'Escribe quién recibe el pedido.';
    end if;
    if v_tel_dest is null or v_tel_dest = '' then
      raise exception 'Escribe el teléfono de quien recibe, de Venezuela con su código (por ejemplo +58 412 1234567).';
    end if;
  end if;
  if char_length(coalesce(v_ciudad, '')) > 80 or char_length(coalesce(v_parroquia, '')) > 80
     or char_length(coalesce(v_referencia, '')) > 200 or char_length(coalesce(v_destinatario, '')) > 80 then
    raise exception 'Algún dato de la dirección es demasiado largo.';
  end if;
  if v_cedula is null then
    raise exception 'Escribe la cédula de quien recibe como V-12345678 o E-12345678 (o déjala vacía).';
  end if;
  if v_tel_dest is null then
    raise exception 'Escribe el teléfono de quien recibe, de Venezuela con su código (por ejemplo +58 412 1234567).';
  end if;
  if v_tel is null then
    v_tel := '';
  end if;
  if v_codigo !~ '^[0-9]{0,6}$' then
    raise exception 'El código postal son solo números (hasta 6).';
  end if;
  return jsonb_build_object(
    'nombre', v_nombre, 'linea', v_linea, 'municipio', v_municipio,
    'ciudad', coalesce(v_ciudad, case when v_completa then null else 'Caracas' end),
    'codigo', case when v_codigo = '' and not v_completa then '1010' else v_codigo end,
    'estado', v_estado, 'parroquia', v_parroquia, 'referencia', v_referencia, 'destinatario', v_destinatario,
    'cedula_destinatario', nullif(v_cedula, ''), 'telefono_destinatario', nullif(v_tel_dest, ''),
    -- el teléfono de la línea de siempre (lo muestra el checkout): el de quien recibe
    'telefono', coalesce(nullif(v_tel_dest, ''), nullif(v_tel, ''), '—'),
    'predeterminada', coalesce((d ->> 'predeterminada')::boolean, false));
exception when invalid_text_representation then
  raise exception 'Revisa los datos de la dirección.';
end $$;

-- La más reciente queda predeterminada si ninguna lo está.
create function tumbo_privado.asegurar_predeterminada(p_usuario uuid) returns void
language sql security definer set search_path = '' as $$
  update tumbo.direcciones set predeterminada = true
  where id = (select id from tumbo.direcciones where usuario_id = p_usuario order by creado desc, id limit 1)
    and not exists (select 1 from tumbo.direcciones where usuario_id = p_usuario and predeterminada);
$$;

-- Cambios respecto de la migración 5: todos los campos (estado, parroquia,
-- referencia, destinatario…), la predeterminada (la primera lo es) y un
-- mensaje por campo.
create or replace function public.tm_direccion_agregar(p_sesion text, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v jsonb;
  v_id uuid;
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'direcciones');
  v := tumbo_privado.direccion_datos(p_datos);
  if (v ->> 'predeterminada')::boolean then
    update tumbo.direcciones set predeterminada = false where usuario_id = yo.id and predeterminada;
  end if;
  insert into tumbo.direcciones (usuario_id, nombre, linea, municipio, ciudad, codigo, telefono, predeterminada, estado, parroquia,
                                 referencia, destinatario, cedula_destinatario, telefono_destinatario)
  values (yo.id, v ->> 'nombre', v ->> 'linea', v ->> 'municipio', v ->> 'ciudad', v ->> 'codigo', v ->> 'telefono',
          (v ->> 'predeterminada')::boolean, v ->> 'estado', v ->> 'parroquia', v ->> 'referencia', v ->> 'destinatario',
          v ->> 'cedula_destinatario', v ->> 'telefono_destinatario')
  returning id into v_id;
  perform tumbo_privado.asegurar_predeterminada(yo.id);
  return v_id;
exception when check_violation then
  raise exception 'Revisa la dirección: algún dato no es válido.';
end $$;

create function public.tm_direccion_editar(p_sesion text, p_id uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  v jsonb;
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'direcciones');
  if not exists (select 1 from tumbo.direcciones where id = p_id and usuario_id = yo.id) then
    raise exception 'No encontramos esa dirección.';
  end if;
  v := tumbo_privado.direccion_datos(p_datos);
  if (v ->> 'predeterminada')::boolean then
    update tumbo.direcciones set predeterminada = false where usuario_id = yo.id and predeterminada and id <> p_id;
  end if;
  update tumbo.direcciones
  set nombre = v ->> 'nombre', linea = v ->> 'linea', municipio = v ->> 'municipio', ciudad = v ->> 'ciudad', codigo = v ->> 'codigo',
      telefono = v ->> 'telefono', estado = v ->> 'estado', parroquia = v ->> 'parroquia', referencia = v ->> 'referencia',
      destinatario = v ->> 'destinatario', cedula_destinatario = v ->> 'cedula_destinatario',
      telefono_destinatario = v ->> 'telefono_destinatario',
      predeterminada = predeterminada or (v ->> 'predeterminada')::boolean
  where id = p_id and usuario_id = yo.id;
  perform tumbo_privado.asegurar_predeterminada(yo.id);
  return p_id;
exception when check_violation then
  raise exception 'Revisa la dirección: algún dato no es válido.';
end $$;

create function public.tm_direccion_predeterminada(p_sesion text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'direcciones');
  if not exists (select 1 from tumbo.direcciones where id = p_id and usuario_id = yo.id) then
    raise exception 'No encontramos esa dirección.';
  end if;
  update tumbo.direcciones set predeterminada = (id = p_id)
  where usuario_id = yo.id and (predeterminada or id = p_id);
end $$;

-- Cambio respecto de la migración 2: si se borra la predeterminada, pasa a
-- serlo la más reciente.
create or replace function public.tm_direccion_quitar(p_sesion text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'direcciones');
  delete from tumbo.direcciones where id = p_id and usuario_id = yo.id;
  perform tumbo_privado.asegurar_predeterminada(yo.id);
end $$;

-- ---------------------------------------------------------------------------
-- Semilla de la demo (la llama tm_reiniciar_demo)
-- ---------------------------------------------------------------------------
-- Completa las dos direcciones sembradas de la compradora demo con los
-- datos de la libreta completa. Las cuentas, sus sesiones, invitaciones,
-- permisos y 2FA se conservan (como las cuentas en el reinicio).
create function tumbo_privado.sembrar_ext_cuentas(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update tumbo.direcciones
  set estado = 'Miranda', parroquia = 'Chacao', referencia = 'Frente a la plaza, edificio de fachada blanca',
      destinatario = 'María González', cedula_destinatario = 'V-12345678', telefono_destinatario = '+584125550101',
      telefono = '+584125550101'
  where id = 'd0000000-0000-4000-8000-000000000001';
  update tumbo.direcciones
  set estado = 'Distrito Capital', parroquia = 'El Recreo', referencia = 'Recepción del piso 6, horario de oficina',
      destinatario = 'María González', cedula_destinatario = 'V-12345678', telefono_destinatario = '+582127810202',
      telefono = '+582127810202'
  where id = 'd0000000-0000-4000-8000-000000000002';
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
    'public.tm_acceder_2fa(text,text)', 'public.tm_elevar(text,text)',
    'public.tm_registrar(text,text,text,text,text)',
    'public.tm_perfil(text)', 'public.tm_perfil_guardar(text,jsonb)',
    'public.tm_clave_cambiar(text,text,text)', 'public.tm_clave_recuperar(text)', 'public.tm_clave_enlace(text)',
    'public.tm_clave_restablecer(text,text)',
    'public.tm_verificacion_enviar(text,text)', 'public.tm_verificacion_confirmar(text,text,text)',
    'public.tm_sesiones(text)', 'public.tm_sesion_cerrar(text,uuid)', 'public.tm_sesiones_cerrar_otras(text)',
    'public.tm_2fa_iniciar(text,text)', 'public.tm_2fa_confirmar(text,text)', 'public.tm_2fa_desactivar(text,text)',
    'public.tm_2fa_respaldo(text,text)',
    'public.tm_cuenta_eliminar(text,text,text)',
    'public.tm_invitar(text,text,text,jsonb)', 'public.tm_invitaciones(text)', 'public.tm_invitacion_revocar(text,uuid)',
    'public.tm_invitacion_ver(text)', 'public.tm_invitacion_aceptar(text,text,text,text)',
    'public.tm_equipo(text)', 'public.tm_equipo_quitar(text,uuid)',
    'public.tm_permisos(text)', 'public.tm_permiso_asignar(text,uuid,text,boolean)',
    'public.tm_admin_usuarios(text,text,text)', 'public.tm_admin_usuario(text,uuid)',
    'public.tm_admin_sesiones_cerrar(text,uuid,uuid)', 'public.tm_admin_bloquear(text,uuid,boolean,text)',
    'public.tm_admin_recuperacion(text,uuid)', 'public.tm_admin_rol(text,uuid,text)', 'public.tm_admin_2fa_quitar(text,uuid,text)',
    'public.tm_admin_baja(text,uuid,text)',
    'public.tm_direccion_editar(text,uuid,jsonb)', 'public.tm_direccion_predeterminada(text,uuid)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
