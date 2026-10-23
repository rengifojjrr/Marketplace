-- =========================================================================
-- Tumbo Market — Ola 1: catálogo y comercio
-- -------------------------------------------------------------------------
-- Ver docs/dominios/catalogo.md. Agrega:
--   · galería real (hasta 8 fotos por producto, de tumbo.archivos), ficha
--     completa (condición, garantía, origen, contenido de la caja, peso y
--     medidas, IVA) y variantes (cada variante es un SKU con padre_sku);
--   · categorías jerárquicas (las 5 de siempre quedan como raíz) con
--     atributos por categoría, obligatorios y opcionales, validados al enviar
--     a revisión;
--   · búsqueda en el servidor (pg_trgm + unaccent, sinónimos locales,
--     filtros, orden, paginación y registro de búsquedas sin resultado);
--   · gestor de precios (masivo con vista previa, freno a cambios de más de
--     ±30 %, deshacer en 5 minutos, precio mínimo por SKU e historial);
--   · inventario con movimientos (kardex) y umbral de stock bajo;
--   · favoritos y alertas reales («avísame cuando vuelva», «si baja de
--     precio»);
--   · carga masiva por CSV (validación por fila, simulación y modo «solo
--     precio y stock»);
--   · KYC real: datos del comercio, documentos con archivo, revisión por
--     documento con sesión elevada e insignia «Verificado por Tumbo» solo con
--     todos los documentos aprobados; tienda pública editable del seller;
--   · moderación en lote; la tienda deja de mostrar las valoraciones de la
--     semilla (las reseñas reales llegan en la ola 2 por un contrato).
-- Revisión adversarial: las cuentas de prueba no ven los expedientes de los
-- comercios reales y el id de un documento KYC solo sale por tm_kyc_archivo
-- (sesión elevada y auditoría); búsqueda con candidatos por índice
-- (columna productos.busqueda), topes por red y registro de búsquedas
-- vacías acotado; deshacer precios respeta el precio mínimo; la carga CSV
-- deja sus precios en su lote; el reinicio recalcula la verificación de
-- todos los comercios.
-- Funciones redefinidas (desde su última definición): tm_cargar,
-- tm_guardar_producto, tm_ajustar_producto, tm_moderar_producto y
-- tm_decidir_kyc.
-- Solo agrega: no borra ni reescribe datos ni objetos existentes.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Extensiones de búsqueda
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Texto normalizado para buscar: sin tildes, en minúsculas y solo letras,
-- números y espacios. (unaccent con su diccionario explícito: inmutable, así
-- sirve en un índice.)
create function tumbo_privado.normalizar(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))),
                              '[^a-z0-9]+', ' ', 'g'))
$$;

-- Lo que se busca de un producto: nombre, marca, SKU y valores de sus atributos.
create function tumbo_privado.doc_busqueda(p_nombre text, p_marca text, p_sku text, p_atributos jsonb) returns text
language sql immutable parallel safe set search_path = '' as $$
  select tumbo_privado.normalizar(coalesce(p_nombre, '') || ' ' || coalesce(p_marca, '') || ' ' || coalesce(p_sku, '') || ' ' ||
    coalesce((select string_agg(e.value, ' ' order by e.key)
              from jsonb_each_text(case when jsonb_typeof(p_atributos) = 'object' then p_atributos else '{}'::jsonb end) e), ''))
$$;

-- ---------------------------------------------------------------------------
-- Categorías jerárquicas y atributos por categoría
-- ---------------------------------------------------------------------------
-- Las 5 categorías de siempre quedan como raíz (padre null); tm_cargar sigue
-- entregando solo las raíces en «categorias» y el árbol completo en «catalogo».
alter table tumbo.categorias add column padre text references tumbo.categorias (id);
create index categorias_padre_idx on tumbo.categorias (padre);

-- Plantilla de ficha: cada categoría hereda los atributos de su padre (una
-- clave repetida en la hija la redefine).
create table tumbo.categoria_atributos (
  categoria   text not null references tumbo.categorias (id) on delete cascade,
  clave       text not null check (clave ~ '^[a-z][a-z0-9_]{1,29}$'),
  nombre      text not null check (char_length(nombre) between 2 and 40),
  tipo        text not null check (tipo in ('texto', 'numero', 'opcion', 'si_no')),
  opciones    text[] not null default '{}',
  unidad      text check (char_length(unidad) <= 12),
  ayuda       text check (char_length(ayuda) <= 80),
  obligatorio boolean not null default false,
  filtrable   boolean not null default false,
  orden       integer not null default 0,
  primary key (categoria, clave),
  check (tipo <> 'opcion' or cardinality(opciones) > 0)
);
alter table tumbo.categoria_atributos enable row level security;
revoke all on tumbo.categoria_atributos from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sinónimos y búsquedas sin resultado
-- ---------------------------------------------------------------------------
create table tumbo.sinonimos (
  termino text primary key check (termino ~ '^[a-z0-9 ]{2,40}$'),
  grupo   integer not null
);
create index sinonimos_grupo_idx on tumbo.sinonimos (grupo);
alter table tumbo.sinonimos enable row level security;
revoke all on tumbo.sinonimos from public, anon, authenticated;

create table tumbo.busquedas_vacias (
  texto   text primary key check (char_length(texto) between 1 and 100),
  veces   integer not null default 1,
  filtros jsonb,
  primera timestamptz not null default now(),
  ultima  timestamptz not null default now()
);
create index busquedas_vacias_ultima_idx on tumbo.busquedas_vacias (ultima);
create index busquedas_vacias_uso_idx on tumbo.busquedas_vacias (veces, ultima);
alter table tumbo.busquedas_vacias enable row level security;
revoke all on tumbo.busquedas_vacias from public, anon, authenticated;

-- Topes por red de la búsqueda pública (tm_buscar es anónima): búsquedas
-- por minuto y textos nuevos en el registro de búsquedas vacías por hora.
-- Sin bitácora (unlogged): son contadores de minutos u horas.
create unlogged table tumbo.topes_busqueda (
  red     text not null,
  tipo    text not null check (tipo in ('buscar', 'vacia')),
  ventana timestamptz not null,
  n       integer not null default 0,
  primary key (red, tipo, ventana)
);
create index topes_busqueda_ventana_idx on tumbo.topes_busqueda (ventana);
alter table tumbo.topes_busqueda enable row level security;
revoke all on tumbo.topes_busqueda from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Productos: galería, variantes, atributos, ficha completa y topes propios
-- ---------------------------------------------------------------------------
-- imagenes: ids de tumbo.archivos (propósito «producto»), en orden; la
-- primera es la principal. Las galerías leen solo los archivos «listo».
alter table tumbo.productos
  add column imagenes       jsonb not null default '[]'::jsonb
                            check (jsonb_typeof(imagenes) = 'array' and jsonb_array_length(imagenes) <= 8),
  add column padre_sku      text references tumbo.productos (sku),
  add column variantes_por  text[] not null default '{}' check (cardinality(variantes_por) <= 3),
  add column atributos      jsonb not null default '{}'::jsonb check (jsonb_typeof(atributos) = 'object'),
  add column condicion      text not null default 'nuevo' check (condicion in ('nuevo', 'usado', 'reacondicionado')),
  add column garantia_meses integer check (garantia_meses between 0 and 120),
  add column garantia_quien text check (garantia_quien in ('fabricante', 'vendedor')),
  add column origen         text check (char_length(origen) <= 60),
  add column contenido_caja text check (char_length(contenido_caja) <= 500),
  add column peso_kg        numeric(8,3) check (peso_kg > 0 and peso_kg <= 1000),
  add column largo_cm       numeric(7,1) check (largo_cm > 0 and largo_cm <= 500),
  add column ancho_cm       numeric(7,1) check (ancho_cm > 0 and ancho_cm <= 500),
  add column alto_cm        numeric(7,1) check (alto_cm > 0 and alto_cm <= 500),
  add column iva            text not null default 'general' check (iva in ('general', 'exento')),
  add column precio_minimo  numeric(12,2) check (precio_minimo > 0),
  add column stock_minimo   integer check (stock_minimo between 0 and 99999);
create index productos_padre_idx on tumbo.productos (padre_sku) where padre_sku is not null;
-- Texto de búsqueda ya normalizado (columna generada: se calcula al guardar,
-- no en cada búsqueda) con su índice de trigramas. tm_buscar encuentra con
-- él los candidatos de cada palabra (LIKE y «<%») y solo puntúa esos. Sin
-- lista de pendientes (fastupdate = off): cada búsqueda hace hasta 160
-- consultas al índice y la lista se recorre entera en cada una hasta que el
-- autovacuum la vacía; los productos se escriben poco y se buscan mucho.
alter table tumbo.productos
  add column busqueda text generated always as (tumbo_privado.doc_busqueda(nombre, marca, sku, atributos)) stored;
create index productos_busqueda_idx on tumbo.productos using gin (busqueda extensions.gin_trgm_ops) with (fastupdate = off);

-- ---------------------------------------------------------------------------
-- Precios: historial (con lote para deshacer)
-- ---------------------------------------------------------------------------
create table tumbo.precio_historial (
  id        bigint generated always as identity primary key,
  sku       text not null references tumbo.productos (sku) on delete cascade,
  seller_id text not null,
  antes     numeric(12,2) not null,
  despues   numeric(12,2) not null,
  origen    text not null check (origen in ('ficha', 'en_linea', 'masivo', 'csv', 'deshacer')),
  lote      uuid not null,
  deshecho  boolean not null default false,
  por       text not null,
  por_id    uuid,
  fecha     timestamptz not null default now()
);
create index precio_historial_sku_idx on tumbo.precio_historial (sku, fecha desc, id desc);
create index precio_historial_lote_idx on tumbo.precio_historial (lote);
alter table tumbo.precio_historial enable row level security;
revoke all on tumbo.precio_historial from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Inventario: movimientos del stock físico (kardex)
-- ---------------------------------------------------------------------------
create table tumbo.movimientos_stock (
  id            bigint generated always as identity primary key,
  sku           text not null references tumbo.productos (sku) on delete cascade,
  seller_id     text not null,
  tipo          text not null check (tipo in ('entrada', 'venta', 'devolucion', 'ajuste')),
  cantidad      integer not null,                     -- cambio del stock físico (con signo)
  stock_antes   integer not null,
  stock_despues integer not null,
  motivo        text check (char_length(motivo) <= 200),
  ref           text check (char_length(ref) <= 200),
  por           text not null default 'Sistema',
  fecha         timestamptz not null default now()
);
create index movimientos_stock_sku_idx on tumbo.movimientos_stock (sku, id desc);
alter table tumbo.movimientos_stock enable row level security;
revoke all on tumbo.movimientos_stock from public, anon, authenticated;

-- El kardex empieza con el stock que cada producto tiene hoy.
insert into tumbo.movimientos_stock (sku, seller_id, tipo, cantidad, stock_antes, stock_despues, motivo, por)
select p.sku, p.seller_id, 'entrada', p.stock_fis, 0, p.stock_fis, 'Saldo al activar el kardex', 'Sistema'
from tumbo.productos p where p.stock_fis > 0;

-- ---------------------------------------------------------------------------
-- Favoritos y alertas del comprador
-- ---------------------------------------------------------------------------
create table tumbo.favoritos (
  usuario_id uuid not null references tumbo.usuarios (id) on delete cascade,
  sku        text not null references tumbo.productos (sku) on delete cascade,
  creado     timestamptz not null default now(),
  primary key (usuario_id, sku)
);
create index favoritos_sku_idx on tumbo.favoritos (sku);
alter table tumbo.favoritos enable row level security;
revoke all on tumbo.favoritos from public, anon, authenticated;

create table tumbo.alertas (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null references tumbo.usuarios (id) on delete cascade,
  sku          text not null references tumbo.productos (sku) on delete cascade,
  tipo         text not null check (tipo in ('stock', 'precio')),
  precio_ref   numeric(12,2),                        -- precio al pedir el aviso (las de precio)
  activa       boolean not null default true,
  creado       timestamptz not null default now(),
  disparada    timestamptz,
  precio_aviso numeric(12,2)
);
create unique index alertas_activa_idx on tumbo.alertas (usuario_id, sku, tipo) where activa;
create index alertas_sku_idx on tumbo.alertas (sku, tipo) where activa;
alter table tumbo.alertas enable row level security;
revoke all on tumbo.alertas from public, anon, authenticated;

insert into tumbo.plantillas (clave, canal, asunto, cuerpo) values
  ('alerta_stock', 'correo', '{{producto}} volvió a estar disponible',
   E'Hola, {{nombre}}:\n\n«{{producto}}» ya tiene stock en Tumbo Market, a {{precio}}.\n\nCómpralo aquí: {{enlace}}'),
  ('alerta_stock', 'whatsapp', '',
   'Tumbo Market: «{{producto}}» volvió a estar disponible a {{precio}}. {{enlace}}'),
  ('alerta_precio', 'correo', 'Bajó de precio: {{producto}}',
   E'Hola, {{nombre}}:\n\n«{{producto}}» bajó de {{antes}} a {{precio}} en Tumbo Market.\n\nMíralo aquí: {{enlace}}'),
  ('alerta_precio', 'whatsapp', '',
   'Tumbo Market: «{{producto}}» bajó de {{antes}} a {{precio}}. {{enlace}}')
on conflict (clave, canal) do nothing;

-- ---------------------------------------------------------------------------
-- KYC real y tienda pública del seller
-- ---------------------------------------------------------------------------
-- kyc_verificado: solo cuando los cuatro documentos están aprobados con su
-- archivo. Es la única fuente de la insignia «Verificado por Tumbo».
alter table tumbo.sellers
  add column kyc_verificado    boolean not null default false,
  add column kyc_verificado_el timestamptz,
  add column logo              uuid references tumbo.archivos (id) on delete set null,
  add column portada           uuid references tumbo.archivos (id) on delete set null,
  add column horario           text check (char_length(horario) <= 200),
  add column politicas         text check (char_length(politicas) <= 2000);

-- expediente: incompleto → en_revision → observado | verificado.
alter table tumbo.sellers_kyc
  add column razon_social     text check (char_length(razon_social) <= 160),
  add column direccion_fiscal text check (char_length(direccion_fiscal) <= 300),
  add column ciudad_despacho  text check (char_length(ciudad_despacho) <= 80),
  add column telefono         text check (char_length(telefono) <= 20),
  add column expediente       text not null default 'incompleto'
                              check (expediente in ('incompleto', 'en_revision', 'observado', 'verificado')),
  add column enviado          timestamptz,
  add column revisado         timestamptz;

-- Orden del documento: 1 RIF, 2 registro mercantil, 3 cédula del
-- representante, 4 constancia bancaria (cuenta de liquidación).
alter table tumbo.seller_documentos
  add column archivo_id   uuid references tumbo.archivos (id) on delete set null,
  add column observacion  text check (char_length(observacion) <= 300),
  add column actualizado  timestamptz,
  add column revisado_por text;

-- ---------------------------------------------------------------------------
-- Contrato para la ola 2 (Comunicación): reputación calculada de reseñas
-- reales. Hoy no hay reseñas, así que no devuelve nada y la tienda no
-- muestra estrellas. La ola 2 las redefine con la misma firma.
-- ---------------------------------------------------------------------------
create function tumbo_privado.reputacion_productos() returns table (sku text, rating numeric, resenas integer)
language sql stable security definer set search_path = '' as $$
  select null::text, null::numeric, null::integer where false
$$;

create function tumbo_privado.reputacion_sellers() returns table (seller_id text, rating numeric, resenas integer)
language sql stable security definer set search_path = '' as $$
  select null::text, null::numeric, null::integer where false
$$;

-- ---------------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------------
-- URL pública (relativa al proyecto) de un archivo público y listo.
create function tumbo_privado.url_publica(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select '/storage/v1/object/public/' || a.bucket || '/' || a.ruta
  from tumbo.archivos a join tumbo.archivo_propositos pr on pr.proposito = a.proposito and pr.publico
  where a.id = p_id and a.estado = 'listo'
$$;

-- Un texto con forma de UUID, o null (para comparar con el índice de archivos).
create function tumbo_privado.uuid_o_null(p text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

-- La galería de un producto: [{id, url}] en su orden, solo con lo «listo».
create function tumbo_privado.imagenes_json(p_ids jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'url', '/storage/v1/object/public/' || a.bucket || '/' || a.ruta)
                            order by e.o), '[]'::jsonb)
  from jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end) with ordinality e (id, o)
  join tumbo.archivos a on a.id = tumbo_privado.uuid_o_null(e.id) and a.estado = 'listo' and a.proposito = 'producto'
$$;

-- Una lista de textos de un filtro (o un texto suelto), en minúsculas y sin
-- vacíos; null si no queda ninguno.
create function tumbo_privado.lista_texto(p jsonb, p_max integer) returns text[]
language sql immutable set search_path = '' as $$
  select case when count(*) = 0 then null else array_agg(x) end
  from (select lower(left(trim(e), 80)) as x
        from jsonb_array_elements_text(case jsonb_typeof(p) when 'array' then p when 'string' then jsonb_build_array(p)
                                                            else '[]'::jsonb end) e
        where trim(e) <> '' limit greatest(1, p_max)) s
$$;

-- Una medida opcional de la ficha (peso, largo…): null si viene vacía;
-- si no es un número válido, el mensaje para la persona.
create function tumbo_privado.medida(p_datos jsonb, p_clave text, p_max numeric, p_error text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  t text := replace(trim(coalesce(p_datos ->> p_clave, '')), ',', '.');
begin
  if t = '' then
    return null;
  end if;
  if t !~ '^\d{1,4}(\.\d{1,3})?$' or t::numeric <= 0 or t::numeric > p_max then
    raise exception '%', p_error;
  end if;
  return t::numeric;
end $$;

-- RIF venezolano con su dígito verificador (letra V, E, J, P, G o C, ocho
-- números y el dígito), normalizado como J-12345678-9; null si no es válido.
create function tumbo_privado.rif_normalizado(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  t text := upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
  pesos constant integer[] := array[3, 2, 7, 6, 5, 4, 3, 2];
  v_suma integer;
  v_dv integer;
  i integer;
begin
  if t ~ '^[VEJPGC][0-9]{8}$' then
    t := left(t, 1) || '0' || substr(t, 2);           -- siete números: se completa con un cero
  end if;
  if t !~ '^[VEJPGC][0-9]{9}$' then
    return null;
  end if;
  v_suma := 4 * case left(t, 1) when 'V' then 1 when 'E' then 2 when 'J' then 3 when 'C' then 3 when 'P' then 4 else 5 end;
  for i in 1 .. 8 loop
    v_suma := v_suma + substr(t, i + 1, 1)::integer * pesos[i];
  end loop;
  v_dv := 11 - v_suma % 11;
  if v_dv >= 10 then
    v_dv := 0;
  end if;
  if v_dv <> substr(t, 10, 1)::integer then
    return null;
  end if;
  return left(t, 1) || '-' || substr(t, 2, 8) || '-' || right(t, 1);
end $$;

-- Teléfono venezolano (fijo o móvil) como 0412-1234567; null si no lo es.
create function tumbo_privado.telefono_ve(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  t text := regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g');
begin
  if t like '+58%' then
    t := '0' || substr(t, 4);
  elsif t like '58%' and char_length(t) = 12 then
    t := '0' || substr(t, 3);
  end if;
  if t !~ '^0(2[0-9]{2}|4(12|14|16|22|24|26))[0-9]{7}$' then
    return null;
  end if;
  return substr(t, 1, 4) || '-' || substr(t, 5);
end $$;

-- Atributos de una categoría, con los heredados de sus ancestros (la clave
-- más cercana gana).
create function tumbo_privado.atributos_de(p_categoria text) returns setof tumbo.categoria_atributos
language sql stable security definer set search_path = '' as $$
  with recursive cadena as (
    select c.id, c.padre, 0 as nivel from tumbo.categorias c where c.id = p_categoria
    union all
    select c.id, c.padre, x.nivel + 1 from tumbo.categorias c join cadena x on c.id = x.padre where x.nivel < 5
  )
  select y.categoria, y.clave, y.nombre, y.tipo, y.opciones, y.unidad, y.ayuda, y.obligatorio, y.filtrable, y.orden
  from (select distinct on (a.clave) a.*, x.nivel
        from tumbo.categoria_atributos a join cadena x on x.id = a.categoria
        order by a.clave, x.nivel) y
  order by y.orden, y.clave
$$;

-- Valida y limpia los atributos de un producto para su categoría. Con
-- p_estricto, una clave ajena o un valor inválido es un error (lo que escribe
-- la persona); sin él, se descartan (lo que venía de otra categoría). Con
-- p_exigir, faltar un obligatorio es un error (al enviar a revisión).
create function tumbo_privado.validar_atributos(p_categoria text, p_atributos jsonb, p_estricto boolean, p_exigir boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_entrada jsonb := case when jsonb_typeof(p_atributos) = 'object' then p_atributos else '{}'::jsonb end;
  v_salida jsonb := '{}'::jsonb;
  a tumbo.categoria_atributos;
  k text;
  v jsonb;
  t text;
  v_ok text;
  v_error text;
  v_faltan text[];
begin
  if p_atributos is not null and jsonb_typeof(p_atributos) not in ('object', 'null') then
    raise exception 'Los atributos deben ser una lista de «nombre: valor».';
  end if;
  if (select count(*) from jsonb_object_keys(v_entrada)) > 40 then
    raise exception 'Un producto admite hasta 40 atributos.';
  end if;
  for k, v in select e.key, e.value from jsonb_each(v_entrada) e loop
    select * into a from tumbo_privado.atributos_de(p_categoria) x where x.clave = k;
    if not found then
      if p_estricto then
        raise exception 'El atributo «%» no corresponde a esta categoría.', left(k, 40);
      end if;
      continue;
    end if;
    t := case jsonb_typeof(v) when 'string' then trim(v #>> '{}') when 'number' then v::text
                              when 'boolean' then case when v::text = 'true' then 'Sí' else 'No' end end;
    continue when t is null or t = '';
    v_ok := null;
    v_error := null;
    if a.tipo = 'texto' then
      if char_length(t) <= 120 then
        v_ok := regexp_replace(t, '[[:cntrl:]]+', ' ', 'g');
      else
        v_error := format('«%s» admite hasta 120 caracteres.', a.nombre);
      end if;
    elsif a.tipo = 'numero' then
      t := replace(t, ',', '.');
      if t ~ '^\d{1,7}(\.\d{1,3})?$' then
        v_ok := (t::numeric)::text;
      else
        v_error := format('«%s» debe ser un número%s.', a.nombre, coalesce(' (en ' || a.unidad || ')', ''));
      end if;
    elsif a.tipo = 'opcion' then
      select o into v_ok from unnest(a.opciones) o where lower(o) = lower(t) limit 1;
      if v_ok is null then
        v_error := format('Para «%s» elige una de estas opciones: %s.', a.nombre, array_to_string(a.opciones, ', '));
      end if;
    else
      v_ok := case when lower(t) in ('si', 'sí', 'true', '1') then 'Sí' when lower(t) in ('no', 'false', '0') then 'No' end;
      if v_ok is null then
        v_error := format('«%s» se responde con sí o no.', a.nombre);
      end if;
    end if;
    if v_ok is null then
      if p_estricto then
        raise exception '%', v_error;
      end if;
      continue;
    end if;
    v_salida := v_salida || jsonb_build_object(a.clave, v_ok);
  end loop;
  if p_exigir then
    select array_agg(x.nombre order by x.orden, x.clave) into v_faltan
    from tumbo_privado.atributos_de(p_categoria) x where x.obligatorio and not (v_salida ? x.clave);
    if v_faltan is not null then
      raise exception 'Completa los atributos obligatorios de la categoría: %.', array_to_string(v_faltan, ', ');
    end if;
  end if;
  return v_salida;
end $$;

-- Antes de pasar a revisión: atributos obligatorios, garantía coherente y,
-- en una familia de variantes, los atributos que la distinguen (presentes y
-- sin repetir).
create function tumbo_privado.validar_envio(p_sku text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  p tumbo.productos;
  v_ejes text[];
  e text;
  v_nombre text;
  v_desc text;
begin
  select * into p from tumbo.productos where sku = p_sku;
  if p.padre_sku is not null then
    select x.variantes_por into v_ejes from tumbo.productos x where x.sku = p.padre_sku;
  elsif exists (select 1 from tumbo.productos x where x.padre_sku = p.sku) then
    v_ejes := p.variantes_por;
  end if;
  foreach e in array coalesce(v_ejes, '{}') loop
    if coalesce(p.atributos ->> e, '') = '' then
      select x.nombre into v_nombre from tumbo_privado.atributos_de(p.categoria) x where x.clave = e;
      raise exception 'Falta «%» para distinguir esta variante de las demás.', coalesce(v_nombre, e);
    end if;
  end loop;
  if coalesce(cardinality(v_ejes), 0) > 0 and exists (select 1 from tumbo.productos x
             where x.sku <> p.sku and coalesce(x.padre_sku, x.sku) = coalesce(p.padre_sku, p.sku)
               and not exists (select 1 from unnest(v_ejes) e2
                               where coalesce(x.atributos ->> e2, '') is distinct from coalesce(p.atributos ->> e2, ''))) then
    select string_agg(coalesce(a.nombre, e3) || ' ' || coalesce(p.atributos ->> e3, ''), ' · ')
      into v_desc
    from unnest(v_ejes) e3 left join tumbo_privado.atributos_de(p.categoria) a on a.clave = e3;
    raise exception 'Ya hay otra variante con %: cambia sus atributos.', v_desc;
  end if;
  perform tumbo_privado.validar_atributos(p.categoria, p.atributos, false, true);
  if coalesce(p.garantia_meses, 0) > 0 and p.garantia_quien is null then
    raise exception 'Indica quién da la garantía: el fabricante o tu comercio.';
  end if;
end $$;

-- Las fotos que se asignan a un producto: archivos «listo» del propósito
-- producto, subidos por su comercio para ese SKU (o para el comercio, si el
-- producto aún no existía) y que ningún otro producto usa.
create function tumbo_privado.validar_fotos(p_seller text, p_sku text, p_ids text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  i text;
begin
  foreach i in array coalesce(p_ids, '{}') loop
    if not exists (select 1 from tumbo.archivos a
                   where a.id = tumbo_privado.uuid_o_null(i) and a.estado = 'listo' and a.proposito = 'producto'
                     and a.seller_id = p_seller and (a.entidad = p_seller or a.entidad = p_sku))
       or exists (select 1 from tumbo.productos x where x.sku is distinct from p_sku and x.imagenes ? i) then
      raise exception 'Una de las fotos ya no está disponible: vuelve a subirla.';
    end if;
  end loop;
end $$;

-- Contexto de un cambio de stock (lo lee el disparador del kardex): tipo,
-- motivo, referencia y quién. Las funciones lo fijan antes del UPDATE y lo
-- limpian después; sin contexto, el disparador lo deduce (despacho → venta,
-- devolución recibida → devolución, lo demás → ajuste del sistema). Los
-- equipos que cambien stock_fis pueden usarlo para que su movimiento quede
-- bien nombrado.
create function tumbo_privado.contexto_stock(p_tipo text, p_motivo text, p_ref text, p_por text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('tumbo.stock_tipo', coalesce(p_tipo, ''), true);
  perform set_config('tumbo.stock_motivo', coalesce(left(p_motivo, 200), ''), true);
  perform set_config('tumbo.stock_ref', coalesce(left(p_ref, 200), ''), true);
  perform set_config('tumbo.stock_por', coalesce(left(p_por, 120), ''), true);
end $$;

-- Dispara los avisos de un producto: «volvió» (stock) o «bajó de precio».
-- Cada alerta se usa una vez; avisa en la campana y deja el mensaje en la
-- bandeja de salida (el envío real es de la ola 2).
create function tumbo_privado.disparar_alertas(p_sku text, p_tipo text, p_precio numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p tumbo.productos;
  a tumbo.alertas;
begin
  select * into p from tumbo.productos where sku = p_sku;
  for a in
    select * from tumbo.alertas x
    where x.sku = p_sku and x.tipo = p_tipo and x.activa and (p_tipo = 'stock' or x.precio_ref > p_precio)
    order by x.creado, x.id limit 500 for update skip locked
  loop
    update tumbo.alertas set activa = false, disparada = now(), precio_aviso = p.precio_usd where id = a.id;
    perform tumbo_privado.notificar('usr:' || a.usuario_id,
      case when p_tipo = 'stock' then '«' || p.nombre || '» volvió a estar disponible'
           else '«' || p.nombre || '» bajó de ' || tumbo_privado.fmt_usd(a.precio_ref) || ' a ' || tumbo_privado.fmt_usd(p.precio_usd) end,
      case when p_tipo = 'stock' then 'notifications_active' else 'trending_down' end,
      'tienda/producto.html?sku=' || p_sku);
    perform tumbo_privado.encolar(a.usuario_id, case when p_tipo = 'stock' then 'alerta_stock' else 'alerta_precio' end,
      jsonb_build_object('producto', p.nombre, 'precio', tumbo_privado.fmt_usd(p.precio_usd),
                         'antes', tumbo_privado.fmt_usd(a.precio_ref), 'enlace', 'app/tienda/producto.html?sku=' || p_sku));
  end loop;
end $$;

-- Disparador de productos: kardex de cada cambio del stock físico, aviso de
-- stock bajo al comercio y alertas de los compradores.
create function tumbo_privado.productos_tras_cambio() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tipo text := nullif(current_setting('tumbo.stock_tipo', true), '');
  v_motivo text := nullif(current_setting('tumbo.stock_motivo', true), '');
  v_ref text := nullif(current_setting('tumbo.stock_ref', true), '');
  v_por text := coalesce(nullif(current_setting('tumbo.stock_por', true), ''), 'Sistema');
  v_delta integer;
  v_antes integer;
  v_ahora integer;
begin
  if tg_op = 'INSERT' then
    if new.stock_fis > 0 then
      insert into tumbo.movimientos_stock (sku, seller_id, tipo, cantidad, stock_antes, stock_despues, motivo, ref, por)
      values (new.sku, new.seller_id, coalesce(v_tipo, 'entrada'), new.stock_fis, 0, new.stock_fis,
              coalesce(v_motivo, 'Stock inicial'), v_ref, v_por);
    end if;
    return null;
  end if;

  if new.stock_fis is distinct from old.stock_fis then
    v_delta := new.stock_fis - old.stock_fis;
    if v_tipo is null then
      if v_delta < 0 and new.stock_res - old.stock_res = v_delta then
        v_tipo := 'venta';
        v_motivo := coalesce(v_motivo, 'Despacho al courier');
        select string_agg(distinct i.pedido_id, ', ') into v_ref
        from tumbo.pedido_items i join tumbo.pedidos pe on pe.id = i.pedido_id
        where i.sku = new.sku and pe.estado = 'despachado' and pe.despachado_el = now();
      elsif v_delta > 0 and new.stock_res = old.stock_res then
        v_tipo := 'devolucion';
        v_motivo := coalesce(v_motivo, 'Devolución recibida');
        select string_agg(distinct i.pedido_id, ', ') into v_ref
        from tumbo.pedido_items i join tumbo.pedidos pe on pe.id = i.pedido_id
        where i.sku = new.sku and pe.estado = 'reembolsado' and pe.xmin = pg_current_xact_id()::xid;
      else
        v_tipo := 'ajuste';
        v_motivo := coalesce(v_motivo, 'Cambio del sistema');
      end if;
    end if;
    insert into tumbo.movimientos_stock (sku, seller_id, tipo, cantidad, stock_antes, stock_despues, motivo, ref, por)
    values (new.sku, new.seller_id, v_tipo, v_delta, old.stock_fis, new.stock_fis, v_motivo, v_ref, v_por);
  end if;

  v_antes := old.stock_fis - old.stock_res;
  v_ahora := new.stock_fis - new.stock_res;
  -- stock bajo: al cruzar el umbral del producto (3 si no lo fijó)
  if new.estado = 'publicado' and v_antes > coalesce(new.stock_minimo, 3) and v_ahora <= coalesce(new.stock_minimo, 3) then
    perform tumbo_privado.notificar('seller:' || new.seller_id,
      'Stock bajo: ' || new.sku || ' («' || new.nombre || '») tiene ' || greatest(v_ahora, 0) || ' disponibles',
      'inventory_2', 'seller/inventario.html?sku=' || new.sku, array['seller', 'operador']);
  end if;
  -- alertas de los compradores (solo lo que la tienda muestra)
  if new.estado = 'publicado' and exists (select 1 from tumbo.sellers s where s.id = new.seller_id and s.estado = 'aprobado') then
    if v_ahora > 0 and not (old.estado = 'publicado' and v_antes > 0) then
      perform tumbo_privado.disparar_alertas(new.sku, 'stock', null);
    end if;
    if new.precio_usd < old.precio_usd then
      perform tumbo_privado.disparar_alertas(new.sku, 'precio', new.precio_usd);
    end if;
  end if;
  return null;
end $$;

create trigger productos_alta_kardex
  after insert on tumbo.productos
  for each row execute function tumbo_privado.productos_tras_cambio();
create trigger productos_cambio_kardex
  after update on tumbo.productos
  for each row
  when (old.stock_fis is distinct from new.stock_fis or old.stock_res is distinct from new.stock_res
        or old.precio_usd is distinct from new.precio_usd or old.estado is distinct from new.estado)
  execute function tumbo_privado.productos_tras_cambio();

-- ---------------------------------------------------------------------------
-- Catálogo base: subcategorías, atributos y sinónimos (idempotente; también
-- lo vuelve a sembrar el reinicio de la demo)
-- ---------------------------------------------------------------------------
create function tumbo_privado.sembrar_catalogo_base() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into tumbo.categorias (id, nombre, icono, orden, padre) values
    ('auto-cauchos',       'Cauchos',                    'tire_repair',           11, 'automotriz'),
    ('auto-baterias',      'Baterías',                   'battery_charging_full', 12, 'automotriz'),
    ('auto-repuestos',     'Repuestos y filtros',        'build',                 13, 'automotriz'),
    ('auto-accesorios',    'Accesorios para el carro',   'directions_car',        14, 'automotriz'),
    ('tec-celulares',      'Celulares',                  'smartphone',            21, 'tecnologia'),
    ('tec-computacion',    'Computación y monitores',    'computer',              22, 'tecnologia'),
    ('tec-audio',          'Audio',                      'headphones',            23, 'tecnologia'),
    ('tec-accesorios',     'Accesorios tecnológicos',    'cable',                 24, 'tecnologia'),
    ('hogar-linea-blanca', 'Línea blanca',               'kitchen',               31, 'hogar'),
    ('hogar-cocina',       'Pequeños electrodomésticos', 'blender',               32, 'hogar'),
    ('hogar-utensilios',   'Ollas y utensilios',         'soup_kitchen',          33, 'hogar'),
    ('salud-cuidado',      'Cuidado personal',           'spa',                   41, 'salud'),
    ('salud-equipos',      'Equipos de salud',           'medical_services',      42, 'salud'),
    ('moda-ropa',          'Ropa',                       'checkroom',             51, 'moda'),
    ('moda-calzado',       'Calzado',                    'steps',                 52, 'moda'),
    ('moda-accesorios',    'Accesorios de moda',         'watch',                 53, 'moda')
  on conflict (id) do nothing;

  insert into tumbo.categoria_atributos (categoria, clave, nombre, tipo, opciones, unidad, ayuda, obligatorio, filtrable, orden) values
    ('automotriz',         'compatibilidad',    'Vehículos compatibles', 'texto',  '{}', null, 'Ej.: Corolla 2009-2014', false, false, 90),
    ('auto-cauchos',       'medida',            'Medida',                'texto',  '{}', null, 'Ej.: 185/60 R14', true, false, 1),
    ('auto-cauchos',       'rin',               'Rin',                   'opcion', array['13', '14', '15', '16', '17', '18', '19', '20'], 'pulg.', null, true, true, 2),
    ('auto-cauchos',       'indice_carga',      'Índice de carga',       'texto',  '{}', null, 'Ej.: 82H', false, false, 3),
    ('auto-cauchos',       'tipo',              'Tipo',                  'opcion', array['Radial', 'Convencional'], null, null, false, true, 4),
    ('auto-baterias',      'amperaje',          'Capacidad',             'numero', '{}', 'Ah', 'Ej.: 65', true, true, 1),
    ('auto-baterias',      'voltaje',           'Voltaje',               'opcion', array['6 V', '12 V', '24 V'], null, null, true, true, 2),
    ('auto-baterias',      'polaridad',         'Polaridad',             'opcion', array['Izquierda', 'Derecha'], null, null, false, true, 3),
    ('auto-repuestos',     'numero_parte',      'Número de parte',       'texto',  '{}', null, 'Código del fabricante', false, false, 1),
    ('tecnologia',         'modelo',            'Modelo',                'texto',  '{}', null, null, false, false, 90),
    ('tec-celulares',      'almacenamiento',    'Almacenamiento',        'opcion', array['32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB'], null, null, true, true, 1),
    ('tec-celulares',      'ram',               'Memoria RAM',           'opcion', array['2 GB', '3 GB', '4 GB', '6 GB', '8 GB', '12 GB', '16 GB'], null, null, false, true, 2),
    ('tec-celulares',      'color',             'Color',                 'texto',  '{}', null, null, true, true, 3),
    ('tec-celulares',      'red',               'Red',                   'opcion', array['4G', '5G'], null, null, false, true, 4),
    ('tec-celulares',      'liberado',          'Liberado',              'si_no',  '{}', null, null, false, false, 5),
    ('tec-computacion',    'pantalla',          'Pantalla',              'numero', '{}', 'pulg.', 'Ej.: 24', false, true, 1),
    ('tec-computacion',    'resolucion',        'Resolución',            'opcion', array['HD', 'Full HD', '2K', '4K'], null, null, false, true, 2),
    ('tec-computacion',    'procesador',        'Procesador',            'texto',  '{}', null, null, false, false, 3),
    ('tec-audio',          'conexion',          'Conexión',              'opcion', array['Bluetooth', 'Cable', 'Bluetooth y cable'], null, null, true, true, 1),
    ('tec-audio',          'autonomia',         'Autonomía',             'numero', '{}', 'h', null, false, false, 2),
    ('tec-accesorios',     'compatibilidad',    'Compatible con',        'texto',  '{}', null, null, false, false, 1),
    ('hogar',              'material',          'Material',              'texto',  '{}', null, null, false, false, 90),
    ('hogar-linea-blanca', 'capacidad',         'Capacidad',             'texto',  '{}', null, 'Ej.: 14 pies, 12 kg', true, false, 1),
    ('hogar-linea-blanca', 'voltaje',           'Voltaje',               'opcion', array['110 V', '220 V'], null, null, true, true, 2),
    ('hogar-linea-blanca', 'color',             'Color',                 'texto',  '{}', null, null, false, true, 3),
    ('hogar-cocina',       'potencia',          'Potencia',              'numero', '{}', 'W', null, false, true, 1),
    ('hogar-cocina',       'voltaje',           'Voltaje',               'opcion', array['110 V', '220 V'], null, null, false, true, 2),
    ('hogar-utensilios',   'piezas',            'Piezas',                'numero', '{}', null, null, false, true, 1),
    ('salud',              'registro_sanitario','Registro sanitario',    'texto',  '{}', null, 'Si el producto lo exige', false, false, 90),
    ('salud-cuidado',      'presentacion',      'Presentación',          'texto',  '{}', null, 'Ej.: 400 ml', true, false, 1),
    ('salud-equipos',      'uso',               'Uso',                   'opcion', array['Doméstico', 'Profesional'], null, null, false, true, 1),
    ('moda',               'genero',            'Para',                  'opcion', array['Dama', 'Caballero', 'Unisex', 'Niños'], null, null, false, true, 90),
    ('moda-ropa',          'talla',             'Talla',                 'opcion', array['XS', 'S', 'M', 'L', 'XL', 'XXL'], null, null, true, true, 1),
    ('moda-ropa',          'color',             'Color',                 'texto',  '{}', null, null, true, true, 2),
    ('moda-ropa',          'material',          'Material',              'texto',  '{}', null, null, false, false, 3),
    ('moda-calzado',       'talla',             'Talla',                 'opcion', array['34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'], null, null, true, true, 1),
    ('moda-calzado',       'color',             'Color',                 'texto',  '{}', null, null, false, true, 2),
    ('moda-accesorios',    'color',             'Color',                 'texto',  '{}', null, null, false, true, 1)
  on conflict (categoria, clave) do nothing;

  insert into tumbo.sinonimos (termino, grupo)
  select t, g from (values
    (1, array['caucho', 'cauchos', 'neumatico', 'neumaticos', 'llanta', 'llantas', 'goma', 'gomas']),
    (2, array['celular', 'celulares', 'telefono', 'telefonos', 'movil', 'moviles', 'smartphone', 'smartphones']),
    (3, array['nevera', 'neveras', 'refrigerador', 'refrigeradores', 'heladera', 'heladeras', 'frigorifico']),
    (4, array['audifonos', 'auriculares', 'cascos', 'headphones']),
    (5, array['computadora', 'computadoras', 'computador', 'laptop', 'laptops', 'portatil', 'portatiles', 'pc']),
    (6, array['bateria', 'baterias', 'acumulador', 'acumuladores']),
    (7, array['carro', 'carros', 'auto', 'autos', 'vehiculo', 'vehiculos', 'automovil', 'coche']),
    (8, array['televisor', 'televisores', 'tv', 'television', 'tele']),
    (9, array['lavadora', 'lavadoras', 'lavarropas']),
    (10, array['cocina', 'cocinas', 'estufa', 'estufas']),
    (11, array['franela', 'franelas', 'camiseta', 'camisetas', 'remera', 'playera']),
    (12, array['zapato', 'zapatos', 'calzado', 'calzados']),
    (13, array['cartera', 'carteras', 'bolso', 'bolsos']),
    (14, array['corneta', 'cornetas', 'parlante', 'parlantes', 'altavoz', 'bocina']),
    (15, array['olla', 'ollas', 'cacerola', 'cacerolas']),
    (16, array['licuadora', 'licuadoras', 'blender']),
    (17, array['monitor', 'monitores', 'pantalla', 'pantallas']),
    (18, array['aire acondicionado', 'split', 'aires']),
    (19, array['repuesto', 'repuestos', 'pieza', 'piezas', 'autoparte', 'autopartes']),
    (20, array['cargador', 'cargadores']),
    (21, array['teclado', 'teclados']),
    (22, array['crema', 'cremas', 'locion', 'lociones'])
  ) as s (g, terminos), unnest(s.terminos) t
  on conflict (termino) do nothing;
end $$;

select tumbo_privado.sembrar_catalogo_base();

-- ---------------------------------------------------------------------------
-- Productos: guardar (alta y edición), con la ficha completa
-- ---------------------------------------------------------------------------
-- Desde la última tm_guardar_producto (migración 5), con todo su
-- comportamiento, y además: ficha completa, atributos de la categoría,
-- fotos, variantes (padreSku al crear; variantesPor en el principal),
-- umbral de stock bajo, precio mínimo (solo el seller principal), freno a
-- los cambios de precio de más de 30 % (confirmarPrecio) e historial, y
-- kardex de los cambios de stock. Las fotos nuevas, la condición, la
-- garantía, el origen, el contenido de la caja y los atributos cuentan como
-- contenido: en un producto publicado lo devuelven a moderación. El cambio
-- de precio queda en el historial con su origen y su lote: «ficha» (el
-- formulario, un lote por cambio) o «csv» (la carga masiva pasa el lote de
-- la importación, para deshacerla junta).
create function tumbo_privado.guardar_producto(p_yo tumbo.usuarios, p_datos jsonb, p_enviar boolean,
                                               p_origen text, p_lote uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := p_yo;
  d jsonb := coalesce(p_datos, '{}'::jsonb);
  v tumbo.productos;
  pa tumbo.productos;
  v_sku text;
  v_nombre text;
  v_categoria text;
  v_cat_final text;
  v_precio numeric;
  v_stock integer;
  v_estado text;
  v_contenido boolean := false;
  v_enviar boolean := coalesce(p_enviar, false);
  v_actor text := yo.nombre || ' (' || yo.rol || ')';
  v_confirmar boolean;
  v_motivo_stock text;
  v_padre text;
  v_marca text;
  v_desc text;
  v_condicion text;
  v_gmeses integer;
  v_gquien text;
  v_origen text;
  v_caja text;
  v_peso numeric;
  v_largo numeric;
  v_ancho numeric;
  v_alto numeric;
  v_iva text;
  v_atrib jsonb;
  v_ids text[];
  v_viejas text[];
  v_fotos_nuevas boolean := false;
  v_ejes text[];
  v_smin integer;
  v_pmin numeric;
  v_pmin_final numeric;
  v_origen_precio text := coalesce(p_origen, 'ficha');
begin
  if v_origen_precio not in ('ficha', 'csv') then
    raise exception 'Origen del cambio inválido.';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'Datos del producto inválidos.';
  end if;
  if yo.id is null or yo.rol not in ('seller', 'operador') then
    raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
  end if;
  v_sku := nullif(trim(coalesce(d ->> 'sku', '')), '');
  v_nombre := trim(coalesce(d ->> 'nombre', ''));
  v_categoria := d ->> 'categoria';
  v_padre := nullif(trim(coalesce(d ->> 'padreSku', '')), '');
  v_confirmar := lower(coalesce(d ->> 'confirmarPrecio', '')) in ('true', '1', 'si', 'sí');
  v_motivo_stock := nullif(left(trim(coalesce(d ->> 'motivoStock', '')), 120), '');

  -- Datos básicos (como siempre)
  if d ? 'precioUsd' then
    if (d ->> 'precioUsd') !~ '^\d{1,7}(\.\d{1,2})?$' or (d ->> 'precioUsd')::numeric <= 0 then
      raise exception 'El precio debe ser mayor que cero.';
    end if;
    v_precio := (d ->> 'precioUsd')::numeric;
  end if;
  if d ? 'stockFis' then
    if (d ->> 'stockFis') !~ '^\d{1,6}$' then raise exception 'El stock debe ser un número entero.'; end if;
    v_stock := (d ->> 'stockFis')::integer;
  end if;
  if d ? 'nombre' and char_length(v_nombre) not between 4 and 160 then
    raise exception 'El nombre necesita al menos 4 caracteres.';
  end if;
  if char_length(coalesce(d ->> 'marca', '')) > 80 or char_length(coalesce(d ->> 'descripcion', '')) > 4000 then
    raise exception 'La marca admite 80 caracteres y la descripción 4.000.';
  end if;
  if v_categoria is not null and not exists (select 1 from tumbo.categorias where id = v_categoria) then
    raise exception 'Categoría inválida.';
  end if;

  -- Ficha completa
  if d ? 'condicion' then
    v_condicion := lower(trim(coalesce(d ->> 'condicion', '')));
    if v_condicion not in ('nuevo', 'usado', 'reacondicionado') then
      raise exception 'La condición debe ser nuevo, usado o reacondicionado.';
    end if;
  end if;
  if coalesce(d ->> 'garantiaMeses', '') <> '' then
    if (d ->> 'garantiaMeses') !~ '^\d{1,3}$' or (d ->> 'garantiaMeses')::integer > 120 then
      raise exception 'La garantía se indica en meses, de 0 a 120.';
    end if;
    v_gmeses := (d ->> 'garantiaMeses')::integer;
  end if;
  if coalesce(d ->> 'garantiaQuien', '') <> '' then
    v_gquien := lower(d ->> 'garantiaQuien');
    if v_gquien not in ('fabricante', 'vendedor') then
      raise exception 'La garantía la da el fabricante o el vendedor.';
    end if;
  end if;
  if char_length(coalesce(d ->> 'origen', '')) > 60 then
    raise exception 'El origen admite 60 caracteres.';
  end if;
  if char_length(coalesce(d ->> 'contenidoCaja', '')) > 500 then
    raise exception 'El contenido de la caja admite 500 caracteres.';
  end if;
  v_origen := nullif(regexp_replace(trim(coalesce(d ->> 'origen', '')), '[[:cntrl:]]+', ' ', 'g'), '');
  v_caja := nullif(trim(coalesce(d ->> 'contenidoCaja', '')), '');
  v_peso := tumbo_privado.medida(d, 'pesoKg', 1000, 'El peso va en kilos: mayor que cero y hasta 1.000.');
  v_largo := tumbo_privado.medida(d, 'largoCm', 500, 'Las medidas van en centímetros: mayores que cero y hasta 500.');
  v_ancho := tumbo_privado.medida(d, 'anchoCm', 500, 'Las medidas van en centímetros: mayores que cero y hasta 500.');
  v_alto := tumbo_privado.medida(d, 'altoCm', 500, 'Las medidas van en centímetros: mayores que cero y hasta 500.');
  if d ? 'iva' then
    v_iva := lower(trim(coalesce(d ->> 'iva', '')));
    if v_iva not in ('general', 'exento') then
      raise exception 'El IVA es «general» (16 %%) o «exento».';
    end if;
  end if;
  if coalesce(d ->> 'stockMinimo', '') <> '' then
    if (d ->> 'stockMinimo') !~ '^\d{1,5}$' then
      raise exception 'El umbral de stock bajo es un número entero.';
    end if;
    v_smin := (d ->> 'stockMinimo')::integer;
  end if;
  if coalesce(d ->> 'precioMinimo', '') <> '' then
    if (d ->> 'precioMinimo') !~ '^\d{1,7}(\.\d{1,2})?$' or (d ->> 'precioMinimo')::numeric <= 0 then
      raise exception 'El precio mínimo debe ser mayor que cero.';
    end if;
    v_pmin := (d ->> 'precioMinimo')::numeric;
  end if;
  if d ? 'atributos' and jsonb_typeof(d -> 'atributos') not in ('object', 'null') then
    raise exception 'Los atributos deben ser una lista de «nombre: valor».';
  end if;
  if d ? 'imagenes' then
    if jsonb_typeof(d -> 'imagenes') <> 'array'
       or exists (select 1 from jsonb_array_elements(d -> 'imagenes') e
                  where jsonb_typeof(e) <> 'string' or tumbo_privado.uuid_o_null(e #>> '{}') is null) then
      raise exception 'Una de las fotos no es válida: vuelve a subirla.';
    end if;
    select coalesce(array_agg(s.x order by s.o), '{}') into v_ids
    from (select distinct on (lower(e.f)) lower(e.f) as x, e.o
          from jsonb_array_elements_text(d -> 'imagenes') with ordinality e (f, o)
          order by lower(e.f), e.o) s;
    if cardinality(v_ids) > 8 then
      raise exception 'Cada producto admite hasta 8 fotos.';
    end if;
  end if;
  if d ? 'variantesPor' then
    if jsonb_typeof(d -> 'variantesPor') <> 'array'
       or exists (select 1 from jsonb_array_elements(d -> 'variantesPor') e
                  where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z][a-z0-9_]{1,29}$') then
      raise exception 'Indica por qué atributos se distinguen las variantes.';
    end if;
    select coalesce(array_agg(distinct e), '{}') into v_ejes from jsonb_array_elements_text(d -> 'variantesPor') e;
    if cardinality(v_ejes) > 3 then
      raise exception 'Las variantes se distinguen por hasta 3 atributos.';
    end if;
  end if;

  if v_sku is null then
    -- ---------------- Alta (el operador fija el precio inicial; moderación lo revisa)
    if v_padre is not null then
      pa := tumbo_privado.bloquear_producto(v_padre, yo);
      if pa.padre_sku is not null then
        raise exception 'Una variante no puede tener variantes: créala desde el producto principal (%).', pa.padre_sku;
      end if;
      if cardinality(pa.variantes_por) = 0 then
        raise exception 'Primero indica en el producto principal qué distingue a sus variantes (talla, color…).';
      end if;
      if d ? 'variantesPor' then
        raise exception 'Las variantes usan los atributos que define el producto principal.';
      end if;
      if v_categoria is not null and v_categoria <> pa.categoria then
        raise exception 'Las variantes comparten la categoría del producto principal.';
      end if;
      if (select count(*) from tumbo.productos where padre_sku = pa.sku) >= 30 then
        raise exception 'Un producto admite hasta 30 variantes.';
      end if;
      v_categoria := pa.categoria;
      if not d ? 'nombre' then v_nombre := pa.nombre; end if;
      v_precio := coalesce(v_precio, pa.precio_usd);
    end if;
    if char_length(v_nombre) < 4 then raise exception 'El nombre necesita al menos 4 caracteres.'; end if;
    if v_precio is null then raise exception 'El precio debe ser mayor que cero.'; end if;
    if v_pmin is not null and yo.rol <> 'seller' then
      raise exception 'El precio mínimo lo gestionan el seller principal o el gestor de precios.' using errcode = '42501';
    end if;
    if v_pmin is not null and v_precio < v_pmin then
      raise exception 'El precio no puede ser menor que el precio mínimo que indicaste.';
    end if;
    perform 1 from tumbo.sellers where id = yo.seller_id for update;
    if (select count(*) from tumbo.productos where seller_id = yo.seller_id) >= 150 then
      raise exception 'Tu catálogo llegó al tope de la beta (150 productos).';
    end if;
    v_categoria := coalesce(v_categoria, 'tecnologia');
    v_marca := case when d ? 'marca' then trim(coalesce(d ->> 'marca', '')) else coalesce(pa.marca, '') end;
    v_desc := case when d ? 'descripcion' then trim(coalesce(d ->> 'descripcion', '')) else coalesce(pa.descripcion, '') end;
    if pa.sku is not null then
      v_condicion := coalesce(v_condicion, pa.condicion);
      if not d ? 'garantiaMeses' then v_gmeses := pa.garantia_meses; end if;
      if not d ? 'garantiaQuien' then v_gquien := pa.garantia_quien; end if;
      if not d ? 'origen' then v_origen := pa.origen; end if;
      if not d ? 'contenidoCaja' then v_caja := pa.contenido_caja; end if;
      if not d ? 'pesoKg' then v_peso := pa.peso_kg; end if;
      if not d ? 'largoCm' then v_largo := pa.largo_cm; end if;
      if not d ? 'anchoCm' then v_ancho := pa.ancho_cm; end if;
      if not d ? 'altoCm' then v_alto := pa.alto_cm; end if;
      v_iva := coalesce(v_iva, pa.iva);
      -- (hereda los atributos del principal, salvo los que distinguen a las variantes)
      v_atrib := tumbo_privado.validar_atributos(v_categoria, (pa.atributos - pa.variantes_por) || coalesce(nullif(d -> 'atributos', 'null'::jsonb), '{}'::jsonb), true, false);
    else
      v_atrib := tumbo_privado.validar_atributos(v_categoria, nullif(d -> 'atributos', 'null'::jsonb), true, false);
    end if;
    if v_ejes is not null and exists (select 1 from unnest(v_ejes) e
                                      where not exists (select 1 from tumbo_privado.atributos_de(v_categoria) a where a.clave = e)) then
      raise exception 'Las variantes solo pueden distinguirse por atributos de su categoría.';
    end if;
    perform tumbo_privado.validar_fotos(yo.seller_id, null, v_ids);
    v_sku := 'SKU-' || upper(left(v_categoria, 3)) || '-' || tumbo_privado.folio(nextval('tumbo_privado.seq_sku'), 4);
    v_estado := case when v_enviar then 'en_revision' else 'borrador' end;
    perform tumbo_privado.contexto_stock('entrada', coalesce(v_motivo_stock, 'Stock inicial'), null, v_actor);
    insert into tumbo.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, estado, img, descripcion,
                                 imagenes, padre_sku, variantes_por, atributos, condicion, garantia_meses, garantia_quien,
                                 origen, contenido_caja, peso_kg, largo_cm, ancho_cm, alto_cm, iva, precio_minimo, stock_minimo)
    values (v_sku, yo.seller_id, v_nombre, v_marca, v_categoria, v_precio, coalesce(v_stock, 0), v_estado,
            'producto-0' || (1 + (select count(*) from tumbo.productos) % 6), v_desc,
            to_jsonb(coalesce(v_ids, '{}')), pa.sku, coalesce(v_ejes, '{}'), v_atrib, coalesce(v_condicion, 'nuevo'),
            v_gmeses, v_gquien, v_origen, v_caja, v_peso, v_largo, v_ancho, v_alto, coalesce(v_iva, 'general'), v_pmin, v_smin);
    perform tumbo_privado.contexto_stock(null, null, null, null);
  else
    -- ---------------- Edición
    v := tumbo_privado.bloquear_producto(v_sku, yo);
    if v_padre is not null and v_padre is distinct from v.padre_sku then
      raise exception 'El producto principal de una variante no se cambia: crea la variante nueva.';
    end if;
    -- El precio vigente es del seller principal y del gestor de precios.
    if yo.rol = 'operador' and v_precio is not null and v_precio <> v.precio_usd then
      raise exception 'El precio lo gestionan el seller principal o el gestor de precios.' using errcode = '42501';
    end if;
    if yo.rol = 'operador' and d ? 'precioMinimo' and v_pmin is distinct from v.precio_minimo then
      raise exception 'El precio mínimo lo gestionan el seller principal o el gestor de precios.' using errcode = '42501';
    end if;
    if v_stock is not null and v_stock < v.stock_res then
      raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
    end if;
    if v_categoria is not null and v_categoria <> v.categoria then
      if v.padre_sku is not null then
        raise exception 'Las variantes comparten la categoría del producto principal.';
      end if;
      if exists (select 1 from tumbo.productos x where x.padre_sku = v.sku) then
        raise exception 'Este producto tiene variantes: no se puede cambiar de categoría.';
      end if;
    end if;
    v_cat_final := coalesce(v_categoria, v.categoria);
    if d ? 'atributos' then
      v_atrib := tumbo_privado.validar_atributos(v_cat_final, nullif(d -> 'atributos', 'null'::jsonb), true, false);
    else
      v_atrib := tumbo_privado.validar_atributos(v_cat_final, v.atributos, false, false);
    end if;
    if d ? 'variantesPor' then
      if v.padre_sku is not null then
        raise exception 'Las variantes usan los atributos que define el producto principal.';
      end if;
      if exists (select 1 from unnest(v_ejes) e
                 where not exists (select 1 from tumbo_privado.atributos_de(v_cat_final) a where a.clave = e)) then
        raise exception 'Las variantes solo pueden distinguirse por atributos de su categoría.';
      end if;
    else
      v_ejes := v.variantes_por;
    end if;
    -- precio: mínimo y freno a los cambios grandes
    v_pmin_final := case when d ? 'precioMinimo' then v_pmin else v.precio_minimo end;
    if v_precio is not null and v_precio <> v.precio_usd then
      if v_pmin_final is not null and v_precio < v_pmin_final then
        raise exception 'El precio no puede bajar de su mínimo (%).', tumbo_privado.fmt_usd(v_pmin_final);
      end if;
      if not v_confirmar and abs(v_precio - v.precio_usd) > 0.3 * v.precio_usd then
        raise exception 'Confirma el cambio de precio de %: pasa de % a % (% %%), más de 30 %%.', v.sku,
          tumbo_privado.fmt_usd(v.precio_usd), tumbo_privado.fmt_usd(v_precio),
          to_char(round((v_precio / v.precio_usd - 1) * 100), 'FMSG990');
      end if;
    elsif d ? 'precioMinimo' and v_pmin is distinct from v.precio_minimo
          and v_pmin_final is not null and v_pmin_final > v.precio_usd then
      -- (solo si el mínimo cambia: una ficha que no lo toca se guarda igual)
      raise exception 'El precio mínimo no puede ser mayor que el precio actual (%).', tumbo_privado.fmt_usd(v.precio_usd);
    end if;
    -- fotos
    select coalesce(array_agg(e order by o), '{}') into v_viejas
    from jsonb_array_elements_text(v.imagenes) with ordinality t (e, o);
    if d ? 'imagenes' then
      perform tumbo_privado.validar_fotos(v.seller_id, v.sku, v_ids);
      v_fotos_nuevas := exists (select 1 from unnest(v_ids) i where not (i = any (v_viejas)));
    else
      v_ids := v_viejas;
    end if;
    v_contenido := (d ? 'nombre' and v_nombre is distinct from v.nombre)
      or (d ? 'marca' and trim(d ->> 'marca') is distinct from v.marca)
      or (v_categoria is not null and v_categoria is distinct from v.categoria)
      or (d ? 'descripcion' and trim(d ->> 'descripcion') is distinct from v.descripcion)
      or (d ? 'condicion' and v_condicion is distinct from v.condicion)
      or (d ? 'garantiaMeses' and v_gmeses is distinct from v.garantia_meses)
      or (d ? 'garantiaQuien' and v_gquien is distinct from v.garantia_quien)
      or (d ? 'origen' and v_origen is distinct from v.origen)
      or (d ? 'contenidoCaja' and v_caja is distinct from v.contenido_caja)
      or v_atrib is distinct from v.atributos
      or v_fotos_nuevas;
    -- Lo que Moderación aprueba es exactamente lo que revisó.
    if v.estado = 'en_revision' and v_contenido then
      raise exception 'El producto está en revisión: espera la decisión de Moderación para cambiar su contenido.';
    end if;
    if v.estado = 'en_revision' then
      v_enviar := false;               -- ya está en la cola
    elsif v.estado in ('publicado', 'pausado') and v_contenido then
      v_enviar := true;
    elsif v_enviar and v.estado in ('publicado', 'pausado') then
      raise exception 'El producto ya pasó moderación: solo vuelve a revisión si cambias su contenido.';
    end if;
    v_estado := case
      when v_enviar then 'en_revision'
      when v.estado in ('publicado', 'pausado', 'en_revision') then v.estado
      else 'borrador' end;
    if v_stock is not null and v_stock <> v.stock_fis then
      perform tumbo_privado.contexto_stock('ajuste', coalesce(v_motivo_stock, 'Edición de la ficha'), null, v_actor);
    end if;
    update tumbo.productos set
      nombre         = case when d ? 'nombre' then v_nombre else nombre end,
      marca          = case when d ? 'marca' then trim(d ->> 'marca') else marca end,
      categoria      = v_cat_final,
      descripcion    = case when d ? 'descripcion' then trim(d ->> 'descripcion') else descripcion end,
      precio_usd     = coalesce(v_precio, precio_usd),
      stock_fis      = coalesce(v_stock, stock_fis),
      estado         = v_estado,
      -- sale de pausado → volverá pausado; un rechazado o borrador que venía
      -- de una pausa conserva la marca hasta que Moderación lo apruebe
      volver_a_pausa = case
        when v_enviar then v.estado = 'pausado' or (v.estado in ('rechazado', 'borrador') and v.volver_a_pausa)
        else volver_a_pausa end,
      motivo_rechazo = case when v_enviar then null else motivo_rechazo end,
      imagenes       = to_jsonb(v_ids),
      variantes_por  = v_ejes,
      atributos      = v_atrib,
      condicion      = coalesce(v_condicion, condicion),
      garantia_meses = case when d ? 'garantiaMeses' then v_gmeses else garantia_meses end,
      garantia_quien = case when d ? 'garantiaQuien' then v_gquien else garantia_quien end,
      origen         = case when d ? 'origen' then v_origen else origen end,
      contenido_caja = case when d ? 'contenidoCaja' then v_caja else contenido_caja end,
      peso_kg        = case when d ? 'pesoKg' then v_peso else peso_kg end,
      largo_cm       = case when d ? 'largoCm' then v_largo else largo_cm end,
      ancho_cm       = case when d ? 'anchoCm' then v_ancho else ancho_cm end,
      alto_cm        = case when d ? 'altoCm' then v_alto else alto_cm end,
      iva            = coalesce(v_iva, iva),
      precio_minimo  = v_pmin_final,
      stock_minimo   = case when d ? 'stockMinimo' then v_smin else stock_minimo end,
      actualizado    = now()
    where sku = v_sku;
    perform tumbo_privado.contexto_stock(null, null, null, null);
    -- las fotos que se quitaron se dan de baja (la limpieza borra sus objetos)
    update tumbo.archivos a set estado = 'descartado', motivo = 'quitada del producto'
    where a.estado = 'listo' and a.proposito = 'producto' and a.id::text = any (v_viejas) and not (a.id::text = any (v_ids))
      and not exists (select 1 from tumbo.productos x where x.imagenes ? a.id::text);
    if v_precio is not null and v_precio <> v.precio_usd then
      insert into tumbo.precio_historial (sku, seller_id, antes, despues, origen, lote, por, por_id)
      values (v.sku, v.seller_id, v.precio_usd, v_precio, v_origen_precio, coalesce(p_lote, gen_random_uuid()), v_actor, yo.id);
    end if;
  end if;

  if v_enviar then
    perform tumbo_privado.validar_envio(v_sku);
    perform tumbo_privado.notificar('rol:superadmin',
      'Producto ' || v_sku || ' («' || coalesce(nullif(v_nombre, ''), v.nombre) || '») espera moderación', 'category', 'admin/moderacion.html');
  end if;
  perform tumbo_privado.auditar(yo, case when v_enviar then 'Producto enviado a revisión' else 'Producto guardado' end, v_sku);
  return v_sku;
end $$;

create or replace function public.tm_guardar_producto(p_sesion text, p_datos jsonb, p_enviar boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
begin
  return tumbo_privado.guardar_producto(yo, p_datos, p_enviar, 'ficha', null);
end $$;

-- ---------------------------------------------------------------------------
-- Precios
-- ---------------------------------------------------------------------------
-- Cambia el precio de un SKU del comercio (seller principal o gestor de
-- precios): no baja del mínimo, y un cambio de más de ±30 % exige
-- p_confirmar. Queda en el historial con su lote (para deshacer).
create function tumbo_privado.cambiar_precio(p_yo tumbo.usuarios, p_sku text, p_precio numeric, p_confirmar boolean,
                                             p_origen text, p_lote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.productos;
  v_nuevo numeric := round(p_precio, 2);
begin
  if p_yo.id is null or p_yo.rol not in ('seller', 'precios') then
    raise exception 'El precio lo gestionan el seller principal o el gestor de precios.' using errcode = '42501';
  end if;
  v := tumbo_privado.bloquear_producto(p_sku, p_yo);
  if v_nuevo is null or v_nuevo <= 0 or v_nuevo > 9999999 then
    raise exception 'El precio debe ser mayor que cero.';
  end if;
  if v.precio_minimo is not null and v_nuevo < v.precio_minimo then
    raise exception 'El precio de % no puede bajar de su mínimo (%).', p_sku, tumbo_privado.fmt_usd(v.precio_minimo);
  end if;
  if v_nuevo = v.precio_usd then
    return jsonb_build_object('sku', p_sku, 'antes', v.precio_usd, 'despues', v_nuevo, 'igual', true);
  end if;
  if not coalesce(p_confirmar, false) and abs(v_nuevo - v.precio_usd) > 0.3 * v.precio_usd then
    raise exception 'Confirma el cambio de precio de %: pasa de % a % (% %%), más de 30 %%.', p_sku,
      tumbo_privado.fmt_usd(v.precio_usd), tumbo_privado.fmt_usd(v_nuevo),
      to_char(round((v_nuevo / v.precio_usd - 1) * 100), 'FMSG990');
  end if;
  update tumbo.productos set precio_usd = v_nuevo, actualizado = now() where sku = p_sku;
  insert into tumbo.precio_historial (sku, seller_id, antes, despues, origen, lote, por, por_id)
  values (p_sku, v.seller_id, v.precio_usd, v_nuevo, p_origen, p_lote, p_yo.nombre || ' (' || p_yo.rol || ')', p_yo.id);
  return jsonb_build_object('sku', p_sku, 'antes', v.precio_usd, 'despues', v_nuevo);
end $$;

-- Precio de un SKU desde el catálogo o el gestor: con el freno de ±30 % y el
-- lote para deshacerlo en 5 minutos.
create function public.tm_ajustar_precio(p_sesion text, p_sku text, p_precio numeric, p_confirmar boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'precios']);
  v_lote uuid := gen_random_uuid();
  r jsonb;
begin
  r := tumbo_privado.cambiar_precio(yo, p_sku, p_precio, p_confirmar, 'en_linea', v_lote);
  if not coalesce((r ->> 'igual')::boolean, false) then
    perform tumbo_privado.auditar(yo, 'Ajuste de precio', p_sku || ': ' || (r ->> 'antes') || ' → ' || (r ->> 'despues'));
  end if;
  return r || jsonb_build_object('lote', v_lote);
end $$;

-- Desde la versión de la migración 2: el precio pasa por el mínimo y el
-- freno de ±30 % (los cambios grandes se confirman en el gestor de precios)
-- y queda en el historial; el stock deja su movimiento en el kardex.
create or replace function public.tm_ajustar_producto(p_sesion text, p_sku text, p_campo text, p_valor numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios;
  v tumbo.productos;
  r jsonb;
begin
  if p_campo = 'precioUsd' then
    yo := tumbo_privado.exigir(p_sesion, array['seller', 'precios']);
  elsif p_campo = 'stockFis' then
    yo := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  else
    raise exception 'Campo inválido.';
  end if;
  v := tumbo_privado.bloquear_producto(p_sku, yo);

  if p_campo = 'precioUsd' then
    if p_valor is null or p_valor <= 0 or p_valor > 9999999 then
      raise exception 'El precio debe ser mayor que cero.';
    end if;
    r := tumbo_privado.cambiar_precio(yo, p_sku, p_valor, false, 'en_linea', gen_random_uuid());
    perform tumbo_privado.auditar(yo, 'Ajuste de precio', p_sku || ': ' || v.precio_usd || ' → ' || round(p_valor, 2));
  else
    if p_valor is null or p_valor < 0 or p_valor <> trunc(p_valor) or p_valor > 999999 then
      raise exception 'El stock debe ser un número entero mayor o igual a cero.';
    end if;
    if p_valor < v.stock_res then
      raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
    end if;
    perform tumbo_privado.contexto_stock('ajuste', 'Edición en línea', null, yo.nombre || ' (' || yo.rol || ')');
    update tumbo.productos set stock_fis = p_valor::integer, actualizado = now() where sku = p_sku;
    perform tumbo_privado.contexto_stock(null, null, null, null);
    perform tumbo_privado.auditar(yo, 'Ajuste de stock', p_sku || ': ' || v.stock_fis || ' → ' || p_valor::integer);
  end if;
end $$;

-- Edición masiva de precios (la vista previa la calcula el gestor): todo o
-- nada. Si algún cambio no es válido, nada se aplica y se dice cuál; si
-- alguno supera ±30 %, hace falta p_confirmar. Devuelve el lote para
-- deshacerlo en 5 minutos.
create function public.tm_precios_masivo(p_sesion text, p_cambios jsonb, p_confirmar boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'precios']);
  v_lote uuid := gen_random_uuid();
  c record;
  v tumbo.productos;
  v_errores jsonb := '[]'::jsonb;
  v_confirmar jsonb := '[]'::jsonb;
  v_hechos jsonb := '[]'::jsonb;
  v_n integer := 0;
  r jsonb;
begin
  if jsonb_typeof(p_cambios) <> 'array' or jsonb_array_length(p_cambios) = 0 then
    raise exception 'No hay cambios de precio que aplicar.';
  end if;
  if jsonb_array_length(p_cambios) > 200 then
    raise exception 'Cambia hasta 200 precios por vez.';
  end if;
  -- validación completa (bloqueando en orden de SKU)
  for c in
    select distinct on (e ->> 'sku') e ->> 'sku' as sku, e ->> 'precio' as precio
    from jsonb_array_elements(p_cambios) e order by e ->> 'sku'
  loop
    select * into v from tumbo.productos where sku = c.sku and seller_id = yo.seller_id for update;
    if not found then
      v_errores := v_errores || jsonb_build_object('sku', c.sku, 'error', 'Producto no encontrado.');
    elsif coalesce(c.precio, '') !~ '^\d{1,7}(\.\d{1,2})?$' or c.precio::numeric <= 0 then
      v_errores := v_errores || jsonb_build_object('sku', c.sku, 'error', 'El precio debe ser mayor que cero.');
    elsif v.precio_minimo is not null and c.precio::numeric < v.precio_minimo then
      v_errores := v_errores || jsonb_build_object('sku', c.sku,
        'error', 'No puede bajar de su mínimo (' || tumbo_privado.fmt_usd(v.precio_minimo) || ').');
    elsif c.precio::numeric <> v.precio_usd and abs(c.precio::numeric - v.precio_usd) > 0.3 * v.precio_usd then
      v_confirmar := v_confirmar || jsonb_build_object('sku', c.sku, 'antes', v.precio_usd, 'despues', c.precio::numeric,
        'pct', round((c.precio::numeric / v.precio_usd - 1) * 100));
    end if;
  end loop;
  if jsonb_array_length(v_errores) > 0 then
    return jsonb_build_object('aplicado', false, 'errores', v_errores);
  end if;
  if jsonb_array_length(v_confirmar) > 0 and not coalesce(p_confirmar, false) then
    return jsonb_build_object('aplicado', false, 'confirmar', v_confirmar);
  end if;
  for c in
    select distinct on (e ->> 'sku') e ->> 'sku' as sku, (e ->> 'precio')::numeric as precio
    from jsonb_array_elements(p_cambios) e order by e ->> 'sku'
  loop
    r := tumbo_privado.cambiar_precio(yo, c.sku, c.precio, true, 'masivo', v_lote);
    if not coalesce((r ->> 'igual')::boolean, false) then
      v_n := v_n + 1;
      v_hechos := v_hechos || r;
    end if;
  end loop;
  if v_n > 0 then
    perform tumbo_privado.auditar(yo, 'Precios actualizados en lote',
      v_n || ' SKU · lote ' || left(v_lote::text, 8) || ': ' ||
      (select string_agg((x ->> 'sku') || ' ' || (x ->> 'antes') || ' → ' || (x ->> 'despues'), ', ')
       from (select x from jsonb_array_elements(v_hechos) x limit 30) s));
  end if;
  return jsonb_build_object('aplicado', true, 'lote', v_lote, 'cambiados', v_n);
end $$;

-- Deshace un lote de cambios de precio del propio comercio en sus primeros 5
-- minutos (del cambio más reciente al más viejo, así un SKU que cambió dos
-- veces en el lote vuelve al primer precio). No se toca un SKU cuyo precio
-- volvió a cambiar después ni uno al que su precio mínimo vigente no deja
-- volver al precio anterior (ningún cambio atraviesa el mínimo): se informan
-- en «detalle» con su motivo.
create function public.tm_precios_deshacer(p_sesion text, p_lote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'precios']);
  h tumbo.precio_historial;
  v tumbo.productos;
  v_lote uuid := gen_random_uuid();
  v_n integer := 0;
  v_omitidos integer := 0;
  v_detalle jsonb := '[]'::jsonb;
  v_hay boolean := false;
begin
  for h in
    select * from tumbo.precio_historial
    where lote = p_lote and seller_id = yo.seller_id and not deshecho and origen <> 'deshacer'
    order by sku, id desc for update
  loop
    v_hay := true;
    if h.fecha < now() - interval '5 minutes' then
      raise exception 'Ya pasaron más de 5 minutos: ese cambio de precios no se puede deshacer.';
    end if;
    v := tumbo_privado.bloquear_producto(h.sku, yo);
    if v.precio_usd <> h.despues then
      v_omitidos := v_omitidos + 1;
      v_detalle := v_detalle || jsonb_build_object('sku', h.sku, 'motivo', 'Su precio cambió después.');
    elsif v.precio_minimo is not null and h.antes < v.precio_minimo then
      v_omitidos := v_omitidos + 1;
      v_detalle := v_detalle || jsonb_build_object('sku', h.sku,
        'motivo', 'Su precio mínimo (' || tumbo_privado.fmt_usd(v.precio_minimo) || ') no deja volver a ' || tumbo_privado.fmt_usd(h.antes) || '.');
    else
      update tumbo.productos set precio_usd = h.antes, actualizado = now() where sku = h.sku;
      insert into tumbo.precio_historial (sku, seller_id, antes, despues, origen, lote, por, por_id)
      values (h.sku, h.seller_id, h.despues, h.antes, 'deshacer', v_lote, yo.nombre || ' (' || yo.rol || ')', yo.id);
      v_n := v_n + 1;
    end if;
    update tumbo.precio_historial set deshecho = true where id = h.id;
  end loop;
  if not v_hay then
    raise exception 'No encontramos ese cambio de precios (o ya se deshizo).';
  end if;
  perform tumbo_privado.auditar(yo, 'Cambio de precios deshecho',
    'lote ' || left(p_lote::text, 8) || ': ' || v_n || ' restaurados' ||
    case when v_omitidos > 0 then ', ' || v_omitidos || ' sin tocar (' ||
      (select string_agg((x ->> 'sku') || ': ' || (x ->> 'motivo'), ' ') from (select x from jsonb_array_elements(v_detalle) x limit 10) s) || ')'
    else '' end);
  return jsonb_build_object('restaurados', v_n, 'omitidos', v_omitidos, 'detalle', v_detalle);
end $$;

-- Precio mínimo opcional de un SKU (null lo quita): ningún cambio de precio
-- lo atraviesa.
create function public.tm_precio_minimo(p_sesion text, p_sku text, p_minimo numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'precios']);
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, yo);
  v_min numeric := round(p_minimo, 2);
begin
  if v_min is not null and (v_min <= 0 or v_min > 9999999) then
    raise exception 'El precio mínimo debe ser mayor que cero.';
  end if;
  if v_min is not null and v_min > v.precio_usd then
    raise exception 'El precio mínimo no puede ser mayor que el precio actual (%).', tumbo_privado.fmt_usd(v.precio_usd);
  end if;
  update tumbo.productos set precio_minimo = v_min, actualizado = now() where sku = p_sku;
  perform tumbo_privado.auditar(yo, 'Precio mínimo', p_sku || ': ' || coalesce(v.precio_minimo::text, 'sin mínimo') || ' → ' || coalesce(v_min::text, 'sin mínimo'));
end $$;

-- Historial de precios de un SKU propio (100 más recientes).
create function public.tm_precio_historial(p_sesion text, p_sku text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'precios', 'superadmin']);
begin
  if not exists (select 1 from tumbo.productos p where p.sku = p_sku and (yo.rol = 'superadmin' or p.seller_id = yo.seller_id)) then
    raise exception 'Producto % no encontrado.', p_sku;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'antes', h.antes, 'despues', h.despues, 'origen', h.origen,
                                        'lote', h.lote, 'deshecho', h.deshecho, 'por', h.por, 'fecha', h.fecha)
                     order by h.fecha desc, h.id desc)
    from (select * from tumbo.precio_historial x where x.sku = p_sku order by x.fecha desc, x.id desc limit 100) h), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------------
-- Entrada de mercancía (+n) o ajuste con motivo (±n) de un SKU propio.
create function public.tm_stock_movimiento(p_sesion text, p_sku text, p_tipo text, p_cantidad integer, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, yo);
  v_motivo text := nullif(left(regexp_replace(trim(coalesce(p_motivo, '')), '[[:cntrl:]]+', ' ', 'g'), 200), '');
  v_nuevo integer;
begin
  if p_tipo is null or p_tipo not in ('entrada', 'ajuste') then
    raise exception 'El movimiento es una entrada de mercancía o un ajuste.';
  end if;
  if p_tipo = 'entrada' and (p_cantidad is null or p_cantidad < 1 or p_cantidad > 99999) then
    raise exception 'Una entrada suma de 1 a 99.999 unidades.';
  end if;
  if p_tipo = 'ajuste' then
    if p_cantidad is null or p_cantidad = 0 or abs(p_cantidad) > 99999 then
      raise exception 'Indica cuántas unidades suma o resta el ajuste.';
    end if;
    if v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'Indica el motivo del ajuste (conteo, merma, daño…).';
    end if;
  end if;
  v_nuevo := v.stock_fis + p_cantidad;
  if v_nuevo < 0 then
    raise exception 'El stock no puede quedar en negativo (hay %).', v.stock_fis;
  end if;
  if v_nuevo < v.stock_res then
    raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
  end if;
  if v_nuevo > 999999 then
    raise exception 'El stock admite hasta 999.999 unidades.';
  end if;
  perform tumbo_privado.contexto_stock(p_tipo, coalesce(v_motivo, 'Reposición'), null, yo.nombre || ' (' || yo.rol || ')');
  update tumbo.productos set stock_fis = v_nuevo, actualizado = now() where sku = p_sku;
  perform tumbo_privado.contexto_stock(null, null, null, null);
  perform tumbo_privado.auditar(yo, 'Movimiento de inventario',
    p_sku || ': ' || p_tipo || ' ' || to_char(p_cantidad, 'FMSG999990') || coalesce(' (' || v_motivo || ')', '') || ' → ' || v_nuevo);
  return jsonb_build_object('sku', p_sku, 'stock', v_nuevo);
end $$;

-- Umbral de stock bajo de un SKU (null vuelve al de siempre: 3).
create function public.tm_stock_umbral(p_sesion text, p_sku text, p_umbral integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'operador']);
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, yo);
begin
  if p_umbral is not null and (p_umbral < 0 or p_umbral > 99999) then
    raise exception 'El umbral de stock bajo va de 0 a 99.999 unidades.';
  end if;
  update tumbo.productos set stock_minimo = p_umbral, actualizado = now() where sku = p_sku;
  perform tumbo_privado.auditar(yo, 'Umbral de stock bajo', p_sku || ': ' || coalesce(v.stock_minimo::text, '3') || ' → ' || coalesce(p_umbral::text, '3'));
end $$;

-- Kardex de un SKU propio: 100 movimientos por página, del más nuevo al más
-- viejo ({movimientos, siguiente}).
create function public.tm_kardex(p_sesion text, p_sku text, p_antes bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'operador', 'superadmin']);
  v jsonb;
begin
  if not exists (select 1 from tumbo.productos p where p.sku = p_sku and (yo.rol = 'superadmin' or p.seller_id = yo.seller_id)) then
    raise exception 'Producto % no encontrado.', p_sku;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'cantidad', m.cantidad, 'antes', m.stock_antes,
                                               'despues', m.stock_despues, 'motivo', m.motivo, 'ref', m.ref, 'por', m.por,
                                               'fecha', m.fecha) order by m.id desc), '[]'::jsonb) into v
  from (select * from tumbo.movimientos_stock x where x.sku = p_sku and (p_antes is null or x.id < p_antes)
        order by x.id desc limit 100) m;
  return jsonb_build_object('movimientos', v,
    'siguiente', case when jsonb_array_length(v) = 100 then (v -> 99 ->> 'id')::bigint end);
end $$;

-- ---------------------------------------------------------------------------
-- Carga masiva (CSV ya leído en el navegador: una fila = un objeto)
-- ---------------------------------------------------------------------------
-- p_modo 'completo': alta o edición de la ficha (seller y operador, con las
-- mismas reglas que el formulario). 'precio_stock': solo precio (seller y
-- gestor de precios) y stock (seller y operador) por SKU. Cada fila se valida
-- por separado; con p_simular nada queda guardado (vista previa). Los
-- cambios de precio de más de ±30 % piden p_confirmar.
create function public.tm_importar_productos(p_sesion text, p_filas jsonb, p_modo text, p_enviar boolean default false,
                                             p_simular boolean default false, p_confirmar boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'precios', 'operador']);
  v_lote uuid := gen_random_uuid();
  v_res jsonb := '[]'::jsonb;
  f jsonb;
  i integer;
  v_sku text;
  v_existe boolean;
  v_datos jsonb;
  v tumbo.productos;
  v_stock integer;
  v_ok integer := 0;
  v_mal integer := 0;
  v_confirmar boolean := false;
begin
  if p_modo is null or p_modo not in ('completo', 'precio_stock') then
    raise exception 'El modo de carga es «completo» o «precio_stock».';
  end if;
  if p_modo = 'completo' and yo.rol = 'precios' then
    raise exception 'El gestor de precios solo actualiza precios: usa el modo «solo precio y stock».' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no tiene filas.';
  end if;
  if jsonb_array_length(p_filas) > 200 then
    raise exception 'Carga hasta 200 filas por archivo.';
  end if;

  begin
    for f, i in select e, n::integer from jsonb_array_elements(p_filas) with ordinality t (e, n) loop
      v_sku := nullif(trim(coalesce(f ->> 'sku', '')), '');
      begin
        if jsonb_typeof(f) <> 'object' then
          raise exception 'La fila no tiene el formato esperado.';
        end if;
        if p_modo = 'completo' then
          v_existe := v_sku is not null;
          v_datos := (select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) from jsonb_each(f) k
                      where k.key in ('sku', 'padreSku', 'nombre', 'marca', 'categoria', 'precioUsd', 'stockFis', 'descripcion',
                                      'condicion', 'garantiaMeses', 'garantiaQuien', 'origen', 'contenidoCaja', 'pesoKg',
                                      'largoCm', 'anchoCm', 'altoCm', 'iva', 'atributos', 'stockMinimo', 'precioMinimo'))
                     || jsonb_build_object('motivoStock', 'Carga masiva CSV', 'confirmarPrecio', coalesce(p_confirmar, false));
          v_sku := tumbo_privado.guardar_producto(yo, v_datos, p_enviar, 'csv', v_lote);
        else
          if v_sku is null then
            raise exception 'Falta el SKU.';
          end if;
          if not (f ? 'precioUsd' or f ? 'stockFis') then
            raise exception 'Indica el precio, el stock o ambos.';
          end if;
          v_existe := true;
          if f ? 'precioUsd' then
            if yo.rol = 'operador' then
              raise exception 'Tu rol no cambia precios: deja vacía la columna precio_usd.';
            end if;
            if coalesce(f ->> 'precioUsd', '') !~ '^\d{1,7}(\.\d{1,2})?$' then
              raise exception 'El precio debe ser mayor que cero.';
            end if;
            perform tumbo_privado.cambiar_precio(yo, v_sku, (f ->> 'precioUsd')::numeric, p_confirmar, 'csv', v_lote);
          end if;
          if f ? 'stockFis' then
            if yo.rol = 'precios' then
              raise exception 'Tu rol no cambia el stock: deja vacía la columna stock.';
            end if;
            if coalesce(f ->> 'stockFis', '') !~ '^\d{1,6}$' then
              raise exception 'El stock debe ser un número entero.';
            end if;
            v_stock := (f ->> 'stockFis')::integer;
            v := tumbo_privado.bloquear_producto(v_sku, yo);
            if v_stock < v.stock_res then
              raise exception 'No puedes dejar el stock por debajo de lo reservado por pedidos en curso (%).', v.stock_res;
            end if;
            if v_stock <> v.stock_fis then
              perform tumbo_privado.contexto_stock('ajuste', 'Carga masiva CSV', null, yo.nombre || ' (' || yo.rol || ')');
              update tumbo.productos set stock_fis = v_stock, actualizado = now() where sku = v_sku;
              perform tumbo_privado.contexto_stock(null, null, null, null);
            end if;
          end if;
        end if;
        v_ok := v_ok + 1;
        v_res := v_res || jsonb_build_object('fila', i, 'sku', v_sku, 'ok', true, 'accion', case when v_existe then 'actualizado' else 'creado' end);
      exception when others then
        v_mal := v_mal + 1;
        v_confirmar := v_confirmar or sqlerrm like 'Confirma el cambio de precio%';
        v_res := v_res || jsonb_build_object('fila', i, 'sku', v_sku, 'ok', false, 'error', sqlerrm);
      end;
    end loop;
    if coalesce(p_simular, false) then
      raise exception using errcode = 'TMSIM', message = 'simulación';
    end if;
  exception when sqlstate 'TMSIM' then
    null;                               -- la simulación no deja nada guardado
  end;

  if not coalesce(p_simular, false) and v_ok > 0 then
    perform tumbo_privado.auditar(yo, 'Carga masiva de productos',
      case when p_modo = 'completo' then 'ficha completa' else 'precio y stock' end || ': ' || v_ok || ' filas aplicadas, ' ||
      v_mal || ' con error · lote ' || left(v_lote::text, 8));
  end if;
  return jsonb_build_object('simulado', coalesce(p_simular, false), 'lote', v_lote, 'ok', v_ok, 'errores', v_mal,
                            'requiere_confirmacion', v_confirmar, 'filas', v_res);
end $$;

-- ---------------------------------------------------------------------------
-- Moderación (uno a uno y en lote)
-- ---------------------------------------------------------------------------
-- Desde la última tm_moderar_producto (migración 5), sin cambios de
-- comportamiento: la usan el uno a uno y el lote.
create function tumbo_privado.moderar_producto(p_yo tumbo.usuarios, p_sku text, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := p_yo;
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, yo);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
begin
  if v.estado <> 'en_revision' then
    raise exception 'El producto % no está en revisión.', p_sku;
  end if;
  if p_aprobar then
    -- Si el seller lo tenía pausado, sigue pausado: aprobar no lo publica.
    update tumbo.productos
    set estado = case when v.volver_a_pausa then 'pausado' else 'publicado' end,
        volver_a_pausa = false, motivo_rechazo = null, actualizado = now()
    where sku = p_sku;
    perform tumbo_privado.notificar('seller:' || v.seller_id,
      case when v.volver_a_pausa then 'Tu producto ' || p_sku || ' fue aprobado; sigue pausado hasta que lo reanudes'
           else 'Tu producto ' || p_sku || ' fue aprobado y ya está publicado' end,
      'check_circle', 'seller/catalogo.html', array['seller', 'precios', 'operador']);
  else
    -- (la marca de pausa se conserva para cuando lo corrija y reenvíe)
    v_motivo := coalesce(v_motivo, 'No cumple los requisitos de publicación.');
    update tumbo.productos set estado = 'rechazado', motivo_rechazo = v_motivo, actualizado = now()
    where sku = p_sku;
    perform tumbo_privado.notificar('seller:' || v.seller_id, 'Tu producto ' || p_sku || ' fue rechazado: ' || v_motivo, 'cancel',
                                    'seller/catalogo.html', array['seller', 'precios', 'operador']);
  end if;
  perform tumbo_privado.auditar(yo, case when p_aprobar then 'Producto aprobado' else 'Producto rechazado' end,
                                p_sku || case when p_aprobar then '' else ' · ' || v_motivo end);
end $$;

create or replace function public.tm_moderar_producto(p_sesion text, p_sku text, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
begin
  perform tumbo_privado.moderar_producto(yo, p_sku, p_aprobar, p_motivo);
end $$;

-- Aprobar o rechazar varios a la vez (hasta 100): cada uno se decide por
-- separado y se informa el resultado de cada SKU.
create function public.tm_moderar_lote(p_sesion text, p_skus text[], p_aprobar boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  v_sku text;
  v_hechos text[] := '{}';
  v_errores jsonb := '[]'::jsonb;
begin
  if p_aprobar is null then
    raise exception 'Indica si se aprueban o se rechazan.';
  end if;
  if coalesce(cardinality(p_skus), 0) = 0 then
    raise exception 'Elige al menos un producto.';
  end if;
  if cardinality(p_skus) > 100 then
    raise exception 'Modera hasta 100 productos por vez.';
  end if;
  if not p_aprobar and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo del rechazo: el seller lo verá.';
  end if;
  for v_sku in select distinct s from unnest(p_skus) s where s is not null order by s loop
    begin
      perform tumbo_privado.moderar_producto(yo, v_sku, p_aprobar, p_motivo);
      v_hechos := v_hechos || v_sku;
    exception when others then
      v_errores := v_errores || jsonb_build_object('sku', v_sku, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('hechos', to_jsonb(v_hechos), 'errores', v_errores);
end $$;

-- ---------------------------------------------------------------------------
-- KYC: expediente del comercio
-- ---------------------------------------------------------------------------
-- El expediente y sus cuatro documentos existen siempre (un comercio nuevo
-- los recibe al primer uso).
create function tumbo_privado.asegurar_expediente(p_seller text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into tumbo.sellers_kyc (seller_id, rif) values (p_seller, '—') on conflict (seller_id) do nothing;
  insert into tumbo.seller_documentos (seller_id, orden, nombre, estado)
  select p_seller, d.orden, d.nombre, 'pendiente'
  from (values (1, 'RIF vigente'), (2, 'Registro mercantil'), (3, 'Cédula del representante'), (4, 'Constancia bancaria')) d (orden, nombre)
  on conflict (seller_id, orden) do nothing;
end $$;

-- Recalcula el estado del expediente y la verificación: «verificado» solo
-- con los cuatro documentos aprobados y su archivo disponible.
create function tumbo_privado.recalcular_kyc(p_seller text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
  v_observado boolean;
  v_enviado boolean;
begin
  select count(*) filter (where d.estado = 'aprobado' and a.id is not null) = 4,
         bool_or(d.estado = 'observado'),
         count(*) filter (where d.estado in ('en_revision', 'aprobado') and a.id is not null) = 4
    into v_ok, v_observado, v_enviado
  from tumbo.seller_documentos d
  left join tumbo.archivos a on a.id = d.archivo_id and a.estado = 'listo'
  where d.seller_id = p_seller and d.orden between 1 and 4;
  v_ok := coalesce(v_ok, false);
  update tumbo.sellers
  set kyc_verificado = v_ok,
      kyc_verificado_el = case when v_ok then coalesce(kyc_verificado_el, now()) end
  where id = p_seller;
  update tumbo.sellers_kyc
  set expediente = case when v_ok then 'verificado' when coalesce(v_observado, false) then 'observado'
                        when coalesce(v_enviado, false) and enviado is not null then 'en_revision' else 'incompleto' end
  where seller_id = p_seller;
  return v_ok;
end $$;

-- ¿Es un comercio de prueba? Lo es si alguna de sus cuentas es de prueba
-- (su contraseña es pública: cualquiera ve y carga lo que tiene) o si no
-- tiene ninguna cuenta real (los de la semilla). Un comercio con cuentas
-- reales y ninguna de prueba es de personas reales.
create function tumbo_privado.comercio_de_prueba(p_seller text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.usuarios u where u.seller_id = p_seller and tumbo_privado.cuenta_demo(u.email))
      or not exists (select 1 from tumbo.usuarios u where u.seller_id = p_seller and not tumbo_privado.cuenta_demo(u.email))
$$;

-- ¿Ve esta persona el expediente (datos fiscales y lista de documentos) de
-- ese comercio? Su seller principal; el superadministrador y finanzas (sin
-- las observaciones) con su cuenta real; con una cuenta de prueba, solo los
-- comercios de prueba (como la bandeja: las cuentas de prueba nunca ven los
-- datos de las personas reales).
create function tumbo_privado.expediente_visible(p_yo tumbo.usuarios, p_seller text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (p_yo.rol = 'seller' and p_yo.seller_id = p_seller)
    or (p_yo.rol in ('superadmin', 'finanzas')
        and (not tumbo_privado.cuenta_demo(p_yo.email) or tumbo_privado.comercio_de_prueba(p_seller))), false)
$$;

-- Abrir un documento KYC: el seller principal del comercio; el
-- superadministrador con su cuenta real y sesión elevada (exigir_elevada:
-- con la 2FA de Cuentas, el código confirmado hace poco); con una cuenta de
-- prueba, solo los documentos de los comercios de prueba. Si no, el error
-- para la persona (el de exigir_elevada, si es lo que falta).
create function tumbo_privado.exigir_documento_kyc(p_yo tumbo.usuarios, p_seller text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_yo.id is not null and p_yo.rol = 'seller' and p_yo.seller_id = p_seller then
    return;
  end if;
  if p_yo.id is null or p_yo.rol is distinct from 'superadmin' then
    raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
  end if;
  if tumbo_privado.cuenta_demo(p_yo.email) then
    if not tumbo_privado.comercio_de_prueba(p_seller) then
      raise exception 'Con una cuenta de prueba solo se ven los expedientes de los comercios de prueba.' using errcode = '42501';
    end if;
    return;
  end if;
  perform tumbo_privado.exigir_elevada(p_yo);
end $$;

-- Contrato (pedido a la ola 0, dueña de archivo_permitido y de
-- tm_archivo_acceso): la misma regla como sí o no, para que la rama «kyc» de
-- archivo_permitido la consulte con la entidad del archivo (el comercio) y
-- la URL firmada pida lo mismo que tm_kyc_archivo.
create function tumbo_privado.kyc_archivo_visible(p_yo tumbo.usuarios, p_seller text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tumbo_privado.exigir_documento_kyc(p_yo, p_seller);
  return true;
exception when others then
  return false;
end $$;

-- Datos del comercio (seller principal): razón social, RIF (con su dígito
-- verificador), dirección fiscal, ciudad de despacho y teléfono. Cambiar la
-- razón social o el RIF vuelve a pedir la revisión de su documento.
create function public.tm_kyc_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  k tumbo.sellers_kyc;
  v_razon text := regexp_replace(trim(coalesce(d ->> 'razonSocial', '')), '[[:cntrl:]]+', ' ', 'g');
  v_rif text := tumbo_privado.rif_normalizado(d ->> 'rif');
  v_dir text := regexp_replace(trim(coalesce(d ->> 'direccionFiscal', '')), '[[:cntrl:]]+', ' ', 'g');
  v_ciudad text := regexp_replace(trim(coalesce(d ->> 'ciudadDespacho', '')), '[[:cntrl:]]+', ' ', 'g');
  v_tel text := tumbo_privado.telefono_ve(d ->> 'telefono');
begin
  if char_length(v_razon) not between 3 and 160 then
    raise exception 'Escribe la razón social como aparece en el RIF (de 3 a 160 caracteres).';
  end if;
  if v_rif is null then
    raise exception 'El RIF no es válido: revisa la letra, los 8 números y el dígito verificador (p. ej. J-12345678-9).';
  end if;
  if char_length(v_dir) not between 10 and 300 then
    raise exception 'Escribe la dirección fiscal completa (de 10 a 300 caracteres).';
  end if;
  if char_length(v_ciudad) not between 2 and 80 then
    raise exception 'Indica la ciudad desde donde despachas.';
  end if;
  if v_tel is null then
    raise exception 'Escribe un teléfono venezolano: 0412-1234567 o 0212-1234567.';
  end if;
  perform tumbo_privado.asegurar_expediente(yo.seller_id);
  select * into k from tumbo.sellers_kyc where seller_id = yo.seller_id for update;
  update tumbo.sellers_kyc
  set razon_social = v_razon, rif = v_rif, direccion_fiscal = v_dir, ciudad_despacho = v_ciudad, telefono = v_tel
  where seller_id = yo.seller_id;
  -- el documento que respalda un dato que cambió vuelve a revisión
  if k.rif is distinct from v_rif then
    update tumbo.seller_documentos set estado = 'pendiente', revisado_por = null, actualizado = now()
    where seller_id = yo.seller_id and orden = 1 and estado <> 'pendiente';
  end if;
  if k.razon_social is not null and k.razon_social is distinct from v_razon then
    update tumbo.seller_documentos set estado = 'pendiente', revisado_por = null, actualizado = now()
    where seller_id = yo.seller_id and orden = 2 and estado <> 'pendiente';
  end if;
  perform tumbo_privado.recalcular_kyc(yo.seller_id);
  perform tumbo_privado.auditar(yo, 'Datos del comercio actualizados', yo.seller_id || ' · RIF ' || v_rif);
  return jsonb_build_object('rif', v_rif, 'telefono', v_tel);
end $$;

-- Asigna un archivo (propósito kyc, ya subido con TM.archivos) a uno de los
-- cuatro documentos. El anterior se da de baja; el documento queda pendiente
-- de enviar a revisión y, si el comercio estaba verificado, deja de estarlo.
create function public.tm_kyc_documento(p_sesion text, p_orden integer, p_archivo uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  doc tumbo.seller_documentos;
begin
  if p_orden is null or p_orden not between 1 and 4 then
    raise exception 'Ese documento no existe.';
  end if;
  if not exists (select 1 from tumbo.archivos a
                 where a.id = p_archivo and a.estado = 'listo' and a.proposito = 'kyc'
                   and a.seller_id = yo.seller_id and a.entidad = yo.seller_id)
     or exists (select 1 from tumbo.seller_documentos x where x.archivo_id = p_archivo and not (x.seller_id = yo.seller_id and x.orden = p_orden)) then
    raise exception 'Ese archivo no está disponible: vuelve a subirlo.';
  end if;
  perform tumbo_privado.asegurar_expediente(yo.seller_id);
  select * into doc from tumbo.seller_documentos where seller_id = yo.seller_id and orden = p_orden for update;
  if doc.archivo_id = p_archivo then
    return;
  end if;
  update tumbo.seller_documentos
  set archivo_id = p_archivo, estado = 'pendiente', observacion = null, revisado_por = null, actualizado = now()
  where seller_id = yo.seller_id and orden = p_orden;
  if doc.archivo_id is not null then
    update tumbo.archivos set estado = 'descartado', motivo = 'reemplazado en el expediente'
    where id = doc.archivo_id and estado = 'listo';
  end if;
  perform tumbo_privado.recalcular_kyc(yo.seller_id);
  perform tumbo_privado.auditar(yo, 'Documento KYC cargado', yo.seller_id || ' · ' || doc.nombre);
end $$;

-- Envía el expediente a revisión: datos completos y los cuatro documentos con
-- su archivo. Un comercio observado (o rechazado) vuelve a «en revisión».
create function public.tm_kyc_enviar(p_sesion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  k tumbo.sellers_kyc;
  s tumbo.sellers;
  v_faltan text;
begin
  perform tumbo_privado.asegurar_expediente(yo.seller_id);
  select * into s from tumbo.sellers where id = yo.seller_id for update;
  select * into k from tumbo.sellers_kyc where seller_id = yo.seller_id for update;
  if k.razon_social is null or tumbo_privado.rif_normalizado(k.rif) is null or k.direccion_fiscal is null
     or k.ciudad_despacho is null or k.telefono is null then
    raise exception 'Completa y guarda los datos del comercio antes de enviar el expediente.';
  end if;
  select string_agg(d.nombre, ', ' order by d.orden) into v_faltan
  from tumbo.seller_documentos d
  left join tumbo.archivos a on a.id = d.archivo_id and a.estado = 'listo'
  where d.seller_id = yo.seller_id and d.orden between 1 and 4 and a.id is null;
  if v_faltan is not null then
    raise exception 'Falta subir: %.', v_faltan;
  end if;
  if not exists (select 1 from tumbo.seller_documentos d where d.seller_id = yo.seller_id and d.estado in ('pendiente', 'observado')) then
    if k.expediente = 'verificado' then
      raise exception 'Tu expediente ya está verificado.';
    end if;
    raise exception 'Tu expediente ya está en revisión.';
  end if;
  update tumbo.seller_documentos set estado = 'en_revision', actualizado = now()
  where seller_id = yo.seller_id and estado in ('pendiente', 'observado');
  update tumbo.sellers_kyc set enviado = now() where seller_id = yo.seller_id;
  if s.estado in ('observado', 'rechazado') then
    update tumbo.sellers set estado = 'en_revision' where id = yo.seller_id;
  end if;
  perform tumbo_privado.recalcular_kyc(yo.seller_id);
  perform tumbo_privado.notificar('rol:superadmin',
    'Expediente KYC de ' || s.nombre || ' (' || s.id || ') listo para revisar', 'verified_user', 'admin/sellers.html');
  perform tumbo_privado.auditar(yo, 'Expediente KYC enviado', yo.seller_id);
end $$;

-- Revisión de un documento (superadministrador con sesión elevada): aprobar
-- u observar (con la observación que verá el seller).
create function public.tm_kyc_revisar(p_sesion text, p_seller text, p_orden integer, p_decision text, p_observacion text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  doc tumbo.seller_documentos;
  v_obs text := left(nullif(regexp_replace(trim(coalesce(p_observacion, '')), '[[:cntrl:]]+', ' ', 'g'), ''), 300);
  v_antes boolean;
  v_ahora boolean;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if p_decision is null or p_decision not in ('aprobado', 'observado') then
    raise exception 'El documento se aprueba o se observa.';
  end if;
  select * into doc from tumbo.seller_documentos where seller_id = p_seller and orden = p_orden for update;
  if not found then
    raise exception 'Documento no encontrado.';
  end if;
  if not exists (select 1 from tumbo.archivos a where a.id = doc.archivo_id and a.estado = 'listo') then
    raise exception 'Ese documento no tiene archivo: el seller debe subirlo.';
  end if;
  if p_decision = 'observado' and v_obs is null then
    raise exception 'Escribe la observación: el seller la verá.';
  end if;
  select kyc_verificado into v_antes from tumbo.sellers where id = p_seller for update;
  update tumbo.seller_documentos
  set estado = p_decision, observacion = case when p_decision = 'observado' then v_obs end,
      revisado_por = yo.nombre, actualizado = now()
  where seller_id = p_seller and orden = p_orden;
  update tumbo.sellers_kyc set revisado = now() where seller_id = p_seller;
  v_ahora := tumbo_privado.recalcular_kyc(p_seller);
  if v_ahora and not coalesce(v_antes, false) then
    perform tumbo_privado.notificar('seller:' || p_seller, 'Tu expediente quedó verificado: tu tienda ya muestra «Verificado por Tumbo»',
                                    'verified', 'seller/comercio.html');
  elsif p_decision = 'observado' then
    perform tumbo_privado.notificar('seller:' || p_seller, 'Observación en «' || doc.nombre || '»: ' || v_obs, 'warning', 'seller/comercio.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Documento KYC revisado', p_seller || ' · ' || doc.nombre || ' → ' || p_decision);
  return jsonb_build_object('verificado', v_ahora);
end $$;

-- El archivo de un documento KYC, para abrirlo con TM.archivos.ver (URL
-- firmada de 5 minutos): superadministrador con su cuenta real y sesión
-- elevada, o una cuenta de prueba con un comercio de prueba
-- (exigir_documento_kyc). tm_cargar ya no entrega el id del archivo a nadie
-- más que al seller dueño. Cada consulta queda en la auditoría.
create function public.tm_kyc_archivo(p_sesion text, p_seller text, p_orden integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  doc tumbo.seller_documentos;
  a tumbo.archivos;
begin
  perform tumbo_privado.exigir_documento_kyc(yo, p_seller);
  select * into doc from tumbo.seller_documentos where seller_id = p_seller and orden = p_orden;
  select * into a from tumbo.archivos where id = doc.archivo_id and estado = 'listo' and proposito = 'kyc';
  if doc.seller_id is null or a.id is null then
    raise exception 'Ese documento no tiene archivo.';
  end if;
  perform tumbo_privado.auditar(yo, 'Documento KYC consultado', p_seller || ' · ' || doc.nombre);
  return jsonb_build_object('id', a.id, 'nombre', a.nombre, 'tipo', a.tipo);
end $$;

-- Decisión sobre el comercio (desde la versión de la migración 4): ahora con
-- sesión elevada, y aprobar ya no da por aprobados los documentos (la
-- verificación se gana documento por documento).
create or replace function public.tm_decidir_kyc(p_sesion text, p_seller text, p_decision text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  v_motivo text := left(nullif(trim(coalesce(p_motivo, '')), ''), 300);
  v_antes text;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if p_decision is null or p_decision not in ('aprobado', 'observado', 'rechazado', 'suspendido') then
    raise exception 'Decisión inválida.';
  end if;
  select estado into v_antes from tumbo.sellers where id = p_seller for update;
  if not found then raise exception 'Seller % no encontrado.', p_seller; end if;
  if p_decision <> 'aprobado' and v_motivo is null then
    raise exception 'Indica el motivo: el seller lo verá.';
  end if;
  update tumbo.sellers set estado = p_decision where id = p_seller;
  perform tumbo_privado.asegurar_expediente(p_seller);
  update tumbo.sellers_kyc
  set observacion = case when p_decision = 'aprobado' then null else v_motivo end
  where seller_id = p_seller;
  perform tumbo_privado.recalcular_kyc(p_seller);
  perform tumbo_privado.notificar('seller:' || p_seller,
    case p_decision
      when 'aprobado' then 'Tu comercio fue homologado: ya puedes vender en Tumbo'
      when 'observado' then 'Tu expediente tiene observaciones: ' || v_motivo
      when 'suspendido' then 'Tu comercio fue suspendido: ' || v_motivo
      else 'Tu solicitud fue rechazada: ' || v_motivo end,
    'verified_user', null);
  perform tumbo_privado.auditar(yo, 'Decisión KYC', p_seller || ': ' || v_antes || ' → ' || p_decision);
end $$;

-- Tienda pública del comercio (seller principal): descripción, horario,
-- políticas, logo y portada (archivos del propósito perfil).
create function public.tm_tienda_guardar(p_sesion text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  s tumbo.sellers;
  v_logo uuid;
  v_portada uuid;
  v_desc text := trim(coalesce(d ->> 'descripcion', ''));
  v_horario text := nullif(regexp_replace(trim(coalesce(d ->> 'horario', '')), '[[:cntrl:]]+', ' ', 'g'), '');
  v_politicas text := nullif(trim(coalesce(d ->> 'politicas', '')), '');
begin
  select * into s from tumbo.sellers where id = yo.seller_id for update;
  if char_length(v_desc) > 600 then
    raise exception 'La descripción admite 600 caracteres.';
  end if;
  if char_length(coalesce(v_horario, '')) > 200 then
    raise exception 'El horario admite 200 caracteres.';
  end if;
  if char_length(coalesce(v_politicas, '')) > 2000 then
    raise exception 'Las políticas admiten 2.000 caracteres.';
  end if;
  v_logo := case when d ? 'logo' then tumbo_privado.uuid_o_null(d ->> 'logo') else s.logo end;
  v_portada := case when d ? 'portada' then tumbo_privado.uuid_o_null(d ->> 'portada') else s.portada end;
  if (v_logo is distinct from s.logo and v_logo is not null
      and not exists (select 1 from tumbo.archivos a where a.id = v_logo and a.estado = 'listo' and a.proposito = 'perfil'
                                                        and a.seller_id = yo.seller_id and a.entidad = yo.seller_id))
     or (v_portada is distinct from s.portada and v_portada is not null
      and not exists (select 1 from tumbo.archivos a where a.id = v_portada and a.estado = 'listo' and a.proposito = 'perfil'
                                                        and a.seller_id = yo.seller_id and a.entidad = yo.seller_id)) then
    raise exception 'Esa imagen no está disponible: vuelve a subirla.';
  end if;
  update tumbo.sellers
  set descripcion = case when d ? 'descripcion' then v_desc else descripcion end,
      horario = case when d ? 'horario' then v_horario else horario end,
      politicas = case when d ? 'politicas' then v_politicas else politicas end,
      logo = v_logo, portada = v_portada
  where id = yo.seller_id;
  update tumbo.archivos set estado = 'descartado', motivo = 'reemplazada en la tienda'
  where estado = 'listo' and id in (s.logo, s.portada) and id is distinct from v_logo and id is distinct from v_portada;
  perform tumbo_privado.auditar(yo, 'Tienda pública actualizada', yo.seller_id);
end $$;

-- ---------------------------------------------------------------------------
-- Favoritos y alertas
-- ---------------------------------------------------------------------------
create function public.tm_favorito(p_sesion text, p_sku text, p_activo boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
begin
  perform tumbo_privado.bloquear_usuario(yo.id, 'favoritos');
  if coalesce(p_activo, false) then
    if not exists (select 1 from tumbo.productos p join tumbo.sellers s on s.id = p.seller_id and s.estado = 'aprobado'
                   where p.sku = p_sku and p.estado = 'publicado') then
      raise exception 'Producto no disponible.';
    end if;
    if not exists (select 1 from tumbo.favoritos where usuario_id = yo.id and sku = p_sku)
       and (select count(*) from tumbo.favoritos where usuario_id = yo.id) >= 300 then
      raise exception 'Llegaste al máximo de 300 favoritos: quita alguno para guardar otro.';
    end if;
    insert into tumbo.favoritos (usuario_id, sku) values (yo.id, p_sku) on conflict do nothing;
  else
    delete from tumbo.favoritos where usuario_id = yo.id and sku = p_sku;
  end if;
  return coalesce(p_activo, false);
end $$;

-- «Avísame cuando vuelva» (stock: solo con el producto agotado) y «avísame
-- si baja de precio» (desde el precio de hoy). p_activa false la quita.
create function public.tm_alerta(p_sesion text, p_sku text, p_tipo text, p_activa boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['comprador']);
  p tumbo.productos;
begin
  if p_tipo is null or p_tipo not in ('stock', 'precio') then
    raise exception 'El aviso es de stock o de precio.';
  end if;
  perform tumbo_privado.bloquear_usuario(yo.id, 'alertas');
  if not coalesce(p_activa, false) then
    update tumbo.alertas set activa = false where usuario_id = yo.id and sku = p_sku and tipo = p_tipo and activa;
    return;
  end if;
  select pr.* into p from tumbo.productos pr join tumbo.sellers s on s.id = pr.seller_id and s.estado = 'aprobado'
  where pr.sku = p_sku and pr.estado = 'publicado';
  if not found then
    raise exception 'Producto no disponible.';
  end if;
  if p_tipo = 'stock' and p.stock_fis - p.stock_res > 0 then
    raise exception 'Este producto tiene stock: puedes comprarlo ahora.';
  end if;
  if not exists (select 1 from tumbo.alertas where usuario_id = yo.id and sku = p_sku and tipo = p_tipo and activa)
     and (select count(*) from tumbo.alertas where usuario_id = yo.id and activa) >= 100 then
    raise exception 'Tienes 100 avisos activos: quita alguno para pedir otro.';
  end if;
  insert into tumbo.alertas (usuario_id, sku, tipo, precio_ref)
  values (yo.id, p_sku, p_tipo, case when p_tipo = 'precio' then p.precio_usd end)
  on conflict (usuario_id, sku, tipo) where activa do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Búsqueda en el servidor
-- ---------------------------------------------------------------------------
-- Tope por red de la búsqueda pública: cuenta un uso en la ventana actual y
-- dice si todavía cabe. La red «desconocida» (sin la cabecera del borde de
-- Supabase, p. ej. en local) no se limita: sería un tope para todos.
create function tumbo_privado.tope_busqueda(p_tipo text, p_tope integer, p_ventana interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_red text := tumbo_privado.ip_cliente();
  v_n integer;
begin
  if v_red = 'desconocida' then
    return true;
  end if;
  if random() < 0.02 then
    delete from tumbo.topes_busqueda where ventana < now() - interval '1 day';
  end if;
  insert into tumbo.topes_busqueda as t (red, tipo, ventana, n)
  values (v_red, p_tipo, date_bin(p_ventana, now(), timestamptz '2000-01-01'), 1)
  on conflict (red, tipo, ventana) do update set n = t.n + 1
  returning n into v_n;
  return v_n <= p_tope;
end $$;

-- Registra una búsqueda sin resultado (para saber qué falta en el catálogo).
-- Guarda el texto (hasta 100 caracteres) y los filtros ya saneados por
-- tm_buscar (hasta 2 kB). Tabla acotada: primero se purga lo de más de 180
-- días; con 5.000 textos, un texto nuevo reemplaza al menos buscado y más
-- viejo (lo que mucha gente busca no se pierde por una ráfaga de textos
-- inventados). Cada red registra hasta 60 textos nuevos por hora. Un fallo
-- no corta la búsqueda.
create function tumbo_privado.registrar_busqueda_vacia(p_texto text, p_filtros jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_filtros jsonb := case when p_filtros is not null and octet_length(p_filtros::text) <= 2048 then nullif(p_filtros, '{}'::jsonb) end;
  v_sobran integer;
begin
  if p_texto is null or char_length(p_texto) not between 1 and 100 then
    return;
  end if;
  delete from tumbo.busquedas_vacias where ultima < now() - interval '180 days';
  update tumbo.busquedas_vacias set veces = veces + 1, ultima = now(), filtros = v_filtros where texto = p_texto;
  if found then
    return;
  end if;
  if not tumbo_privado.tope_busqueda('vacia', 60, interval '1 hour') then
    return;
  end if;
  select count(*) - 4999 into v_sobran from tumbo.busquedas_vacias;
  if v_sobran > 0 then
    delete from tumbo.busquedas_vacias where texto in (
      select b.texto from tumbo.busquedas_vacias b order by b.veces, b.ultima, b.texto limit v_sobran);
  end if;
  insert into tumbo.busquedas_vacias (texto, filtros) values (p_texto, v_filtros)
  on conflict (texto) do update set veces = tumbo.busquedas_vacias.veces + 1, ultima = now();
exception when others then
  null;
end $$;

-- tm_buscar(texto, filtros, orden, página): búsqueda pública del catálogo
-- (publicado y de sellers aprobados). Tolera tildes, errores de tipeo y
-- plurales, y amplía con los sinónimos locales. Filtros:
--   {categoria (con sus subcategorías), precio_min, precio_max, marcas[],
--    condiciones[], ciudades[] (del seller), disponible, verificados, seller,
--    atributos: {clave: [valores]}}
-- Orden: relevancia | precio_asc | precio_desc | novedades | vendidos.
-- Agrupa las variantes por su producto principal (una tarjeta por familia)
-- y pagina de a 24 (todas las páginas se pueden pedir; una página de más
-- devuelve la última). Devuelve también las facetas para los filtros.
-- Rendimiento: cada alternativa de cada palabra busca sus candidatos con el
-- índice de trigramas de productos.busqueda (LIKE y «<%»), y solo esos se
-- puntúan; las categorías se comparan por su nombre (son pocas). Topes: 300
-- búsquedas por minuto y red, filtros de hasta 16 kB y 10 alternativas por
-- palabra (8 palabras).
create function public.tm_buscar(p_texto text default null, p_filtros jsonb default '{}'::jsonb,
                                 p_orden text default 'relevancia', p_pagina integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end;
  v_q text := left(tumbo_privado.normalizar(left(coalesce(p_texto, ''), 200)), 100);
  v_palabras text[];
  v_n integer;
  v_orden text := case when p_orden in ('relevancia', 'precio_asc', 'precio_desc', 'novedades', 'vendidos') then p_orden else 'relevancia' end;
  v_pagina integer := greatest(1, least(coalesce(p_pagina, 1), 100000));
  v_tam constant integer := 24;
  v_cat text;
  v_cats text[];
  v_pmin numeric;
  v_pmax numeric;
  v_marcas text[];
  v_conds text[];
  v_ciudades text[];
  v_disp boolean;
  v_verif boolean;
  v_seller text;
  v_attrs jsonb;
  v_guardar jsonb;
  v jsonb;
begin
  if not tumbo_privado.tope_busqueda('buscar', 300, interval '1 minute') then
    raise exception 'Hay muchas búsquedas desde tu red: espera un minuto y vuelve a intentarlo.';
  end if;
  if pg_column_size(p_filtros) > 16384 then
    raise exception 'Los filtros de la búsqueda son demasiado largos.';
  end if;
  v_cat := nullif(left(trim(coalesce(f ->> 'categoria', '')), 60), '');
  v_pmin := case when (f ->> 'precio_min') ~ '^\d{1,7}(\.\d{1,2})?$' then (f ->> 'precio_min')::numeric end;
  v_pmax := case when (f ->> 'precio_max') ~ '^\d{1,7}(\.\d{1,2})?$' then (f ->> 'precio_max')::numeric end;
  v_marcas := tumbo_privado.lista_texto(f -> 'marcas', 20);
  v_conds := tumbo_privado.lista_texto(f -> 'condiciones', 3);
  v_ciudades := tumbo_privado.lista_texto(f -> 'ciudades', 20);
  v_disp := coalesce(f ->> 'disponible', '') in ('true', '1');
  v_verif := coalesce(f ->> 'verificados', '') in ('true', '1');
  v_seller := nullif(left(trim(coalesce(f ->> 'seller', '')), 60), '');
  -- atributos: hasta 10 claves válidas, con hasta 30 valores cada una
  select coalesce(jsonb_object_agg(a.key, to_jsonb(a.valores)), '{}'::jsonb) into v_attrs
  from (select e.key, tumbo_privado.lista_texto(e.value, 30) as valores
        from jsonb_each(case when jsonb_typeof(f -> 'atributos') = 'object' then f -> 'atributos' else '{}'::jsonb end) e
        where e.key ~ '^[a-z][a-z0-9_]{1,29}$' and tumbo_privado.lista_texto(e.value, 30) is not null
        order by e.key limit 10) a;
  select coalesce(array_agg(t.w order by t.n), '{}') into v_palabras
  from (select x.w, x.n from unnest(string_to_array(v_q, ' ')) with ordinality x (w, n)
        where x.w <> '' and (char_length(x.w) > 1 or x.w ~ '^[0-9]$')
          and x.w <> all (array['de', 'la', 'el', 'los', 'las', 'del', 'para', 'con', 'en', 'un', 'una', 'por', 'al', 'sin'])
        order by x.n limit 8) t;
  v_n := cardinality(v_palabras);
  if v_cat is not null then
    v_cats := array[v_cat] || coalesce((select array_agg(c.id) from tumbo.categorias c where c.padre = v_cat), '{}');
  end if;
  -- (umbral de «<%»: desde 0,5; las palabras de 4 letras piden 0,6 abajo)
  perform set_config('pg_trgm.word_similarity_threshold', '0.5', true);

  with terminos as (
    -- cada palabra con sus alternativas (ella misma, su singular y sus
    -- sinónimos), hasta 10 por palabra
    select t.n, z.a
    from unnest(v_palabras) with ordinality t (w, n)
    cross join lateral (
      select y.a from (
        select distinct on (x.a) x.a, x.pri from (
          select t.w as a, 0 as pri
          union all select regexp_replace(t.w, 'es$', ''), 1 where char_length(t.w) > 4 and t.w like '%es'
          union all select regexp_replace(t.w, 's$', ''), 1 where char_length(t.w) > 3 and t.w like '%s'
          union all
          select s2.termino, 2 from tumbo.sinonimos s1 join tumbo.sinonimos s2 on s2.grupo = s1.grupo
          where s1.termino = t.w or s1.termino = regexp_replace(t.w, 's$', '')
             or (char_length(t.w) >= 5 and extensions.similarity(s1.termino, t.w) >= 0.5)) x
        where x.a <> '' order by x.a, x.pri) y
      order by y.pri, y.a limit 10) z
  ), hits as (
    -- productos que contienen la alternativa o una palabra parecida (con el
    -- índice de trigramas): solo estos se puntúan. 3 si empieza una palabra
    -- del nombre, 2 si está en el texto, 2 × el parecido si se parece.
    select t.n, p.sku, char_length(t.a) as largo,
           case when p.busqueda like '%' || t.a || '%'
                then case when (' ' || tumbo_privado.normalizar(p.nombre)) like '% ' || t.a || '%' then 3 else 2 end
                else 2 * extensions.word_similarity(t.a, p.busqueda) end as pts
    from terminos t
    join tumbo.productos p
      on p.busqueda like '%' || t.a || '%'
         or (char_length(t.a) >= 4 and t.a operator(extensions.<%) p.busqueda)
    where p.estado = 'publicado' and (v_seller is null or p.seller_id = v_seller)
  ), cat_hits as (
    -- y los de las categorías cuyo nombre (o el de su raíz) coincide
    select t.n, c.id,
           max(case when c.doc like '%' || t.a || '%' then 2 else 2 * extensions.word_similarity(t.a, c.doc) end) as pts
    from terminos t
    cross join (select c.id, tumbo_privado.normalizar(c.nombre || ' ' || coalesce(cp.nombre, '')) as doc
                from tumbo.categorias c left join tumbo.categorias cp on cp.id = c.padre) c
    where c.doc like '%' || t.a || '%'
       or (char_length(t.a) >= 4
           and extensions.word_similarity(t.a, c.doc) >= case when char_length(t.a) >= 5 then 0.5 else 0.6 end)
    group by t.n, c.id
  ), puntos as (
    -- por producto: la mejor alternativa de cada palabra, sumadas, y cuántas
    -- palabras encontró
    select u.sku, sum(u.pts) as puntos, count(*) as aciertos
    from (select x.n, x.sku, max(x.pts) as pts
          from (select h.n, h.sku, h.pts from hits h
                where h.pts >= 2 or h.pts >= 2 * case when h.largo >= 5 then 0.5 else 0.6 end
                union all
                select ch.n, p.sku, ch.pts from cat_hits ch
                join tumbo.productos p on p.categoria = ch.id
                where p.estado = 'publicado' and (v_seller is null or p.seller_id = v_seller)) x
          group by x.n, x.sku) u
    group by u.sku
  ), ventas as (
    select i.sku, sum(i.cant)::integer as u
    from tumbo.pedido_items i join tumbo.pedidos pe on pe.id = i.pedido_id
    where pe.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'cerrado')
    group by i.sku
  ), visibles as (
    -- sin texto, todo lo publicado; con texto, lo que encontró alguna palabra
    select p.sku, p.padre_sku, p.seller_id, p.marca, p.categoria, p.precio_usd, p.stock_fis - p.stock_res as disp,
           p.condicion, p.atributos, p.creado, s.ciudad, s.kyc_verificado,
           coalesce(c.padre, c.id) as raiz, coalesce(ve.u, 0) as vendidos,
           coalesce(pu.puntos, 0) as puntos, coalesce(pu.aciertos, 0) as aciertos
    from tumbo.productos p
    join tumbo.sellers s on s.id = p.seller_id and s.estado = 'aprobado'
    left join tumbo.categorias c on c.id = p.categoria
    left join puntos pu on pu.sku = p.sku
    left join ventas ve on ve.sku = p.sku
    where p.estado = 'publicado' and (v_seller is null or p.seller_id = v_seller) and (v_n = 0 or pu.sku is not null)
  ), coincidentes as (
    -- con todas las palabras si alguno las tiene; si no, los aproximados
    select x.* from (select vi.*, count(*) filter (where vi.aciertos = v_n) over () as n_todas from visibles vi) x
    where v_n = 0 or (x.n_todas > 0 and x.aciertos = v_n) or x.n_todas = 0
  ), cat_f as (
    select * from coincidentes where v_cats is null or categoria = any (v_cats)
  ), filtrados as (
    select * from cat_f cf
    where (v_pmin is null or cf.precio_usd >= v_pmin) and (v_pmax is null or cf.precio_usd <= v_pmax)
      and (v_marcas is null or lower(cf.marca) = any (v_marcas))
      and (v_conds is null or cf.condicion = any (v_conds))
      and (v_ciudades is null or lower(cf.ciudad) = any (v_ciudades))
      and (not v_disp or cf.disp > 0)
      and (not v_verif or cf.kyc_verificado)
      and not exists (select 1 from jsonb_each(v_attrs) fa
                      where not (lower(coalesce(cf.atributos ->> fa.key, '')) in (select jsonb_array_elements_text(fa.value))))
  ), familias as (
    select coalesce(padre_sku, sku) as fam,
           (array_agg(sku order by (padre_sku is null) desc, puntos desc, precio_usd, sku))[1] as rep,
           min(precio_usd) as pmin, max(precio_usd) as pmax, max(puntos) as puntos,
           max(creado) as creado, sum(vendidos) as vendidos, bool_or(disp > 0) as hay
    from filtrados group by 1
  ), meta as (
    -- la página pedida, dentro de las que hay
    select count(*) as total, greatest(1, ceil(count(*) / v_tam::numeric)::integer) as paginas,
           least(v_pagina, greatest(1, ceil(count(*) / v_tam::numeric)::integer)) as pagina
    from familias
  ), orden as (
    select fa.*, row_number() over (order by
             case when v_orden = 'precio_asc' then fa.pmin end asc nulls last,
             case when v_orden = 'precio_desc' then fa.pmax end desc nulls last,
             case when v_orden = 'vendidos' then fa.vendidos end desc nulls last,
             case when v_orden = 'relevancia' then fa.puntos end desc nulls last,
             case when v_orden in ('relevancia', 'vendidos') then fa.vendidos end desc nulls last,
             fa.creado desc, fa.fam) as pos
    from familias fa
  )
  select jsonb_build_object(
    'texto', v_q, 'orden', v_orden, 'pagina', m.pagina, 'tamano', v_tam, 'total', m.total, 'paginas', m.paginas,
    'aproximado', v_n > 1 and exists (select 1 from coincidentes where n_todas = 0),
    'resultados', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sku', p.sku, 'nombre', p.nombre, 'marca', p.marca, 'categoria', p.categoria, 'seller_id', p.seller_id,
               'precio_usd', p.precio_usd, 'disponible', greatest(p.stock_fis - p.stock_res, 0), 'img', p.img,
               -- la foto de la variante o, si no tiene, la de su principal
               -- solo si está publicado (la de un borrador no pasó moderación)
               'imagen', coalesce(tumbo_privado.imagenes_json(p.imagenes) -> 0 ->> 'url',
                                  case when pp.estado = 'publicado' then tumbo_privado.imagenes_json(pp.imagenes) -> 0 ->> 'url' end),
               'condicion', p.condicion, 'padre_sku', p.padre_sku,
               'variantes', (select count(*) from tumbo.productos vv
                             where (vv.sku = o.fam or vv.padre_sku = o.fam) and vv.estado = 'publicado'),
               'precio_min', o.pmin, 'precio_max', o.pmax, 'hay_stock', o.hay) order by o.pos)
      from orden o join tumbo.productos p on p.sku = o.rep left join tumbo.productos pp on pp.sku = p.padre_sku
      where o.pos > (m.pagina - 1) * v_tam and o.pos <= m.pagina * v_tam), '[]'::jsonb),
    'facetas', jsonb_build_object(
      'categorias', coalesce((
        select jsonb_agg(jsonb_build_object('id', z.id, 'n', z.n) order by z.n desc, z.id) from (
          select raiz as id, count(*) as n from coincidentes group by raiz
          union all
          select categoria, count(*) from coincidentes where categoria <> raiz group by categoria) z), '[]'::jsonb),
      'marcas', coalesce((
        select jsonb_agg(jsonb_build_object('valor', z.valor, 'n', z.n) order by z.n desc, z.valor) from (
          select marca as valor, count(*) as n from cat_f where marca <> '' group by marca order by 2 desc, 1 limit 30) z), '[]'::jsonb),
      'condiciones', coalesce((
        select jsonb_agg(jsonb_build_object('valor', z.valor, 'n', z.n) order by z.valor) from (
          select condicion as valor, count(*) as n from cat_f group by condicion) z), '[]'::jsonb),
      'ciudades', coalesce((
        select jsonb_agg(jsonb_build_object('valor', z.valor, 'n', z.n) order by z.n desc, z.valor) from (
          select ciudad as valor, count(*) as n from cat_f group by ciudad order by 2 desc, 1 limit 30) z), '[]'::jsonb),
      'precio', (select jsonb_build_object('min', min(precio_usd), 'max', max(precio_usd)) from cat_f),
      'disponibles', (select count(*) from cat_f where disp > 0),
      'atributos', case when v_cat is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('clave', a.clave, 'nombre', a.nombre, 'unidad', a.unidad, 'valores', a.valores)
                         order by a.orden, a.clave)
        from (select at.clave, at.nombre, at.unidad, at.orden, (
                       select jsonb_agg(jsonb_build_object('valor', z.valor, 'n', z.n) order by z.n desc, z.valor)
                       from (select cf.atributos ->> at.clave as valor, count(*) as n from cat_f cf
                             where coalesce(cf.atributos ->> at.clave, '') <> '' group by 1 order by 2 desc, 1 limit 30) z) as valores
              from tumbo_privado.atributos_de(v_cat) at where at.filtrable) a
        where a.valores is not null), '[]'::jsonb) end)
  ) into v
  from meta m;

  if (v ->> 'total')::integer = 0 and v_q <> '' then
    -- (se guarda la versión saneada y acotada de los filtros, nunca lo recibido)
    select jsonb_strip_nulls(jsonb_build_object(
             'categoria', v_cat, 'precio_min', v_pmin, 'precio_max', v_pmax,
             'marcas', to_jsonb(v_marcas[1:5]), 'condiciones', to_jsonb(v_conds), 'ciudades', to_jsonb(v_ciudades[1:5]),
             'disponible', case when v_disp then true end, 'verificados', case when v_verif then true end, 'seller', v_seller,
             'atributos', (select jsonb_object_agg(a.key, (select jsonb_agg(left(x, 40)) from (
                                    select jsonb_array_elements_text(a.value) as x limit 5) s))
                           from (select e.key, e.value from jsonb_each(v_attrs) e order by e.key limit 5) a)))
      into v_guardar;
    perform tumbo_privado.registrar_busqueda_vacia(v_q, v_guardar);
  end if;
  return v;
end $$;

-- Lo que la gente busca y no encuentra (superadministrador).
create function public.tm_busquedas_sin_resultado(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('texto', b.texto, 'veces', b.veces, 'ultima', b.ultima, 'primera', b.primera)
                     order by b.veces desc, b.ultima desc)
    from (select * from tumbo.busquedas_vacias order by veces desc, ultima desc limit 50) b), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Lectura por rol
-- ---------------------------------------------------------------------------
-- Desde la última tm_cargar (migración 7). Cambios:
--   · «categorias» sigue trayendo solo las raíces; «catalogo» trae el árbol
--     completo y los atributos de cada categoría;
--   · sellers y productos salen por lista blanca: fuera del comercio no se
--     publican el precio mínimo, el umbral de stock, reservas ni fechas
--     internas; las valoraciones salen del contrato de reputación (reseñas
--     reales, ola 2), nunca de la semilla;
--   · la galería sale con sus URL públicas (solo lo «listo»);
--   · «mas_vendidos»: SKU ordenados por unidades vendidas de verdad (pagos
--     conciliados, sin cancelados ni reembolsados);
--   · el comprador recibe sus favoritos y sus avisos activos;
--   · los documentos KYC traen el nombre y el tipo de su archivo; el id del
--     archivo solo va al seller dueño (el superadministrador lo pide con
--     tm_kyc_archivo, con sesión elevada);
--   · expediente («kyc» y «docs»): las cuentas de prueba solo reciben los de
--     los comercios de prueba (tumbo_privado.expediente_visible).
create or replace function public.tm_cargar(p_sesion text default null, p_huella text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_uid uuid := u.id;
  v_rol text := u.rol;
  v_seller text := u.seller_id;
  v_admin boolean := coalesce(u.rol in ('superadmin', 'ops', 'finanzas'), false);
  r jsonb;
  v_h text;
  v_recortadas jsonb;
  v_abiertas integer;
begin
  perform tumbo_privado.vencer_pagos();

  r := jsonb_build_object(
    'yo', case when v_uid is null then null else tumbo_privado.perfil_json(u) end,
    'sesion_invalida', p_sesion is not null and v_uid is null,
    'config', (select to_jsonb(c) - 'id' from tumbo.config c),
    'categorias', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden, c.id) from tumbo.categorias c where c.padre is null), '[]'::jsonb),
    'catalogo', jsonb_build_object(
      'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'icono', c.icono, 'padre', c.padre,
                                                                  'orden', c.orden) order by c.orden, c.id)
                              from tumbo.categorias c), '[]'::jsonb),
      'atributos', coalesce((select jsonb_agg(jsonb_build_object('categoria', a.categoria, 'clave', a.clave, 'nombre', a.nombre,
                                                                 'tipo', a.tipo, 'opciones', to_jsonb(a.opciones), 'unidad', a.unidad,
                                                                 'ayuda', a.ayuda, 'obligatorio', a.obligatorio, 'filtrable', a.filtrable,
                                                                 'orden', a.orden) order by a.categoria, a.orden, a.clave)
                             from tumbo.categoria_atributos a), '[]'::jsonb)),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'ciudad', s.ciudad, 'estado', s.estado,
                                          'rating', rs.rating, 'resenas', coalesce(rs.resenas, 0), 'desde', s.desde,
                                          'descripcion', s.descripcion, 'kyc_verificado', s.kyc_verificado,
                                          'horario', s.horario, 'politicas', s.politicas,
                                          'logo_url', tumbo_privado.url_publica(s.logo),
                                          'portada_url', tumbo_privado.url_publica(s.portada)) order by s.id)
      from tumbo.sellers s left join tumbo_privado.reputacion_sellers() rs on rs.seller_id = s.id
      where s.estado = 'aprobado' or s.id = v_seller or v_admin
         or exists (select 1 from tumbo.pedidos p where p.seller_id = s.id and p.comprador_id = v_uid)), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(
               case when p.seller_id = v_seller or v_rol = 'superadmin'
                    then (to_jsonb(p) - 'rating' - 'resenas' - 'imagenes' - 'busqueda')
                         || jsonb_build_object('rating', rp.rating, 'resenas', coalesce(rp.resenas, 0),
                                               'imagenes', tumbo_privado.imagenes_json(p.imagenes))
                    else jsonb_build_object(
                           'sku', p.sku, 'seller_id', p.seller_id, 'nombre', p.nombre, 'marca', p.marca, 'categoria', p.categoria,
                           'precio_usd', p.precio_usd, 'stock_fis', greatest(p.stock_fis - p.stock_res, 0), 'stock_res', 0,
                           'estado', p.estado, 'img', p.img, 'rating', rp.rating, 'resenas', coalesce(rp.resenas, 0),
                           'descripcion', p.descripcion, 'specs', p.specs, 'imagenes', tumbo_privado.imagenes_json(p.imagenes),
                           'padre_sku', p.padre_sku, 'variantes_por', to_jsonb(p.variantes_por), 'atributos', p.atributos,
                           'condicion', p.condicion, 'garantia_meses', p.garantia_meses, 'garantia_quien', p.garantia_quien,
                           'origen', p.origen, 'contenido_caja', p.contenido_caja, 'peso_kg', p.peso_kg,
                           'largo_cm', p.largo_cm, 'ancho_cm', p.ancho_cm, 'alto_cm', p.alto_cm, 'iva', p.iva) end
               order by p.creado desc, p.sku)
      from tumbo.productos p left join tumbo_privado.reputacion_productos() rp on rp.sku = p.sku
      where (p.estado = 'publicado'
             and exists (select 1 from tumbo.sellers s where s.id = p.seller_id and s.estado = 'aprobado'))
         or p.seller_id = v_seller
         or v_rol = 'superadmin'), '[]'::jsonb),
    'mas_vendidos', coalesce((
      select jsonb_agg(x.sku order by x.u desc, x.sku) from (
        select i.sku, sum(i.cant) as u
        from tumbo.pedido_items i
        join tumbo.pedidos pe on pe.id = i.pedido_id
        join tumbo.productos p on p.sku = i.sku and p.estado = 'publicado'
        join tumbo.sellers s on s.id = p.seller_id and s.estado = 'aprobado'
        where pe.estado in ('por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'cerrado')
        group by i.sku order by 2 desc, 1 limit 12) x), '[]'::jsonb)
  );

  if v_uid is not null then
    select coalesce(jsonb_agg(x.cola order by x.cola), '[]'::jsonb) into v_recortadas
    from (select tumbo_privado.cola(p.estado, p.liquidacion) as cola from tumbo.pedidos p
          where (p.comprador_id = v_uid
                 or (p.seller_id = v_seller and v_rol in ('seller', 'operador')
                     and p.estado <> 'pago_por_verificar'
                     and not (p.estado = 'cancelado' and p.sla_horas is null))
                 or v_admin)
            and (p.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                 or p.liquidacion in ('retenido', 'congelado', 'elegible'))
          group by 1 having count(*) > 500) x;
    select count(*) into v_abiertas from tumbo.disputas d
    where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
      and d.estado <> 'resuelta';
    if v_abiertas > 2000 then
      v_recortadas := v_recortadas || '["disputas"]'::jsonb;
    end if;

    r := r || jsonb_build_object(
      'pendientes_truncados', jsonb_array_length(v_recortadas) > 0,
      'colas_recortadas', v_recortadas,
      -- El comercio solo ve pedidos con el pago ya conciliado, y el operador,
      -- sin los datos de dinero ni de reclamos.
      'pedidos', coalesce((
        select jsonb_agg((case when v_rol = 'operador'
                               then to_jsonb(p) - 'comprador_id' - 'liquidacion' - 'liquidacion_id' - 'disputa_id'
                               else to_jsonb(p) - 'comprador_id' end) - 'ref_clave' - 'ref_numero' - 'red' || jsonb_build_object(
                 'mio', p.comprador_id = v_uid,
                 'pedido_items', coalesce((select jsonb_agg(to_jsonb(i) - 'pedido_id' order by i.sku)
                                           from tumbo.pedido_items i where i.pedido_id = p.id), '[]'::jsonb),
                 'pedido_eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'pedido_id' order by e.fecha, e.id)
                                             from tumbo.pedido_eventos e
                                             where e.pedido_id = p.id
                                               and (v_rol <> 'operador'
                                                    or e.icono not in ('gavel', 'lock_open', 'undo', 'receipt_long', 'assignment_return'))),
                                            '[]'::jsonb))
               order by p.creado desc, p.id desc)
        from tumbo.pedidos p
        where p.id in (
          select w.id from (
            select q.id, row_number() over (partition by tumbo_privado.cola(q.estado, q.liquidacion) order by q.creado, q.id) as n
            from tumbo.pedidos q
            where (q.comprador_id = v_uid
                   or (q.seller_id = v_seller and v_rol in ('seller', 'operador')
                       and q.estado <> 'pago_por_verificar'
                       and not (q.estado = 'cancelado' and q.sla_horas is null))
                   or v_admin)
              and (q.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                   or q.liquidacion in ('retenido', 'congelado', 'elegible'))) w
          where w.n <= 500
          union all
          select h.id from (
            select q.id from tumbo.pedidos q
            where (q.comprador_id = v_uid
                   or (q.seller_id = v_seller and v_rol in ('seller', 'operador')
                       and q.estado <> 'pago_por_verificar'
                       and not (q.estado = 'cancelado' and q.sla_horas is null))
                   or v_admin)
              and not (q.estado in ('pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'devolucion')
                       or coalesce(q.liquidacion in ('retenido', 'congelado', 'elegible'), false))
            order by q.creado desc, q.id desc limit 150) h
          union all
          -- lo más reciente del propio comprador, aunque su cola esté recortada
          select m.id from (
            select q.id from tumbo.pedidos q
            where q.comprador_id = v_uid
            order by q.creado desc, q.id desc limit 50) m)), '[]'::jsonb),
      'disputas', coalesce((
        select jsonb_agg((to_jsonb(d) - 'comprador_id') || jsonb_build_object('mio', d.comprador_id = v_uid)
                         order by d.creado desc, d.id desc)
        from (
          (select * from tumbo.disputas d
           where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
             and d.estado <> 'resuelta'
           order by d.creado, d.id limit 2000)
          union all
          (select * from tumbo.disputas d
           where (d.comprador_id = v_uid or (d.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'ops'))
             and d.estado = 'resuelta'
           order by d.creado desc, d.id desc limit 150)) d), '[]'::jsonb),
      'liquidaciones', coalesce((
        select jsonb_agg(to_jsonb(l) order by l.fecha desc, l.id desc)
        from (select * from tumbo.liquidaciones l
              where (l.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'finanzas')
              order by l.fecha desc, l.id desc limit 200) l), '[]'::jsonb),
      -- Finanzas necesita el RIF para pagar, no las observaciones de cumplimiento.
      -- Con una cuenta de prueba, solo los expedientes de los comercios de prueba.
      'kyc', coalesce((
        select jsonb_agg(case when v_rol = 'finanzas' then to_jsonb(k) - 'observacion' else to_jsonb(k) end order by k.seller_id)
        from tumbo.sellers_kyc k
        where ((k.seller_id = v_seller and v_rol = 'seller') or v_rol in ('superadmin', 'finanzas'))
          and tumbo_privado.expediente_visible(u, k.seller_id)), '[]'::jsonb),
      'docs', coalesce((
        select jsonb_agg((to_jsonb(x) - 'archivo_id')
                         || jsonb_build_object('archivo_id', case when x.seller_id = v_seller and v_rol = 'seller' then x.archivo_id end,
                                               'archivo_nombre', a.nombre, 'archivo_tipo', a.tipo, 'archivo_listo', a.id is not null)
                         order by x.seller_id, x.orden)
        from tumbo.seller_documentos x
        left join tumbo.archivos a on a.id = x.archivo_id and a.estado = 'listo'
        where ((x.seller_id = v_seller and v_rol = 'seller') or v_rol = 'superadmin')
          and tumbo_privado.expediente_visible(u, x.seller_id)), '[]'::jsonb),
      'notificaciones', coalesce((
        select jsonb_agg((to_jsonb(n) - 'roles') || jsonb_build_object('leida', exists (
                 select 1 from tumbo.notificaciones_leidas l where l.notificacion_id = n.id and l.usuario_id = v_uid))
               order by n.fecha desc, n.id desc)
        from (select * from tumbo.notificaciones n
              where (n.para = 'usr:' || v_uid::text
                     or n.para = 'rol:' || v_rol
                     or (v_seller is not null and n.para = 'seller:' || v_seller))
                and (n.roles is null or v_rol = any (n.roles))
              order by n.fecha desc, n.id desc limit 100) n), '[]'::jsonb),
      'eventos', case when v_rol in ('superadmin', 'finanzas') then coalesce((
        select jsonb_agg(to_jsonb(a) - 'actor_id' order by a.fecha desc, a.id desc)
        from (
          (select * from tumbo.auditoria a
           where a.accion <> 'Inicio de sesión' and (a.actor_id is null or a.actor ~ '\((superadmin|ops|finanzas)\)$')
           order by a.fecha desc, a.id desc limit 300)
          union all
          (select * from tumbo.auditoria a
           where a.accion <> 'Inicio de sesión' and not (a.actor_id is null or a.actor ~ '\((superadmin|ops|finanzas)\)$')
           order by a.fecha desc, a.id desc limit 150)
          union all
          (select * from tumbo.auditoria a where a.accion = 'Inicio de sesión'
           order by a.fecha desc, a.id desc limit 50)) a), '[]'::jsonb)
        else '[]'::jsonb end,
      'direcciones', coalesce((
        select jsonb_agg(to_jsonb(d) - 'usuario_id' order by d.creado, d.id) from tumbo.direcciones d
        where d.usuario_id = v_uid), '[]'::jsonb),
      'carrito', coalesce((
        select jsonb_agg(jsonb_build_object('sku', c.sku, 'cant', c.cant) order by c.agregado, c.sku) from tumbo.carrito_items c
        where c.usuario_id = v_uid), '[]'::jsonb),
      'favoritos', case when v_rol = 'comprador' then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku', f.sku, 'nombre', p.nombre, 'img', p.img, 'creado', f.creado,
                 'visible', p.estado = 'publicado' and s.estado = 'aprobado',
                 'precio_usd', case when p.estado = 'publicado' and s.estado = 'aprobado' then p.precio_usd end,
                 'imagen', case when p.estado = 'publicado' and s.estado = 'aprobado'
                                then tumbo_privado.imagenes_json(p.imagenes) -> 0 ->> 'url' end)
               order by f.creado desc, f.sku)
        from tumbo.favoritos f join tumbo.productos p on p.sku = f.sku join tumbo.sellers s on s.id = p.seller_id
        where f.usuario_id = v_uid), '[]'::jsonb) else '[]'::jsonb end,
      'alertas', case when v_rol = 'comprador' then coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'sku', a.sku, 'tipo', a.tipo, 'precio_ref', a.precio_ref, 'creado', a.creado)
                         order by a.creado desc, a.id desc)
        from tumbo.alertas a where a.usuario_id = v_uid and a.activa), '[]'::jsonb) else '[]'::jsonb end
    );
  end if;

  v_h := md5(r::text);
  if p_huella is not null and p_huella = v_h then
    return jsonb_build_object('sin_cambios', true, 'huella', v_h);
  end if;
  return r || jsonb_build_object('huella', v_h);
end $$;

-- ---------------------------------------------------------------------------
-- Reinicio de la demo: limpieza y semilla del catálogo
-- ---------------------------------------------------------------------------
-- La llama tm_reiniciar_demo después de la semilla base (los productos
-- vuelven sin sus favoritos, avisos, historial ni kardex anterior: van en
-- cascada con ellos). Deja la semilla honesta: sin valoraciones inventadas,
-- sin documentos dados por aprobados sin archivo y sin sellers verificados.
-- El reinicio borra todos los expedientes y descarta todos los archivos, así
-- que la verificación se recalcula para todos los comercios (no solo los de
-- la semilla): ninguno queda «Verificado por Tumbo» sin sus documentos, ni
-- con un logo o una portada que ya no existen.
create function tumbo_privado.sembrar_ext_catalogo(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id text;
begin
  perform tumbo_privado.sembrar_catalogo_base();
  -- (con WHERE explícito: el proyecto usa pg-safeupdate)
  delete from tumbo.favoritos where usuario_id is not null;
  delete from tumbo.alertas where id is not null;
  delete from tumbo.precio_historial where id is not null;
  delete from tumbo.busquedas_vacias where texto is not null;
  update tumbo.productos set rating = null, resenas = 0 where rating is not null or resenas <> 0;
  update tumbo.sellers
  set rating = null, resenas = 0, horario = null, politicas = null
  where id in ('SEL-014', 'SEL-009', 'SEL-021', 'SEL-017');
  update tumbo.sellers set logo = null, portada = null where logo is not null or portada is not null;
  update tumbo.seller_documentos set estado = 'pendiente', observacion = null, revisado_por = null
  where archivo_id is null and estado <> 'pendiente';
  for v_id in select s.id from tumbo.sellers s order by s.id loop
    perform tumbo_privado.recalcular_kyc(v_id);
  end loop;
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
    'public.tm_buscar(text,jsonb,text,integer)', 'public.tm_busquedas_sin_resultado(text)',
    'public.tm_favorito(text,text,boolean)', 'public.tm_alerta(text,text,text,boolean)',
    'public.tm_ajustar_precio(text,text,numeric,boolean)', 'public.tm_precios_masivo(text,jsonb,boolean)',
    'public.tm_precios_deshacer(text,uuid)', 'public.tm_precio_minimo(text,text,numeric)',
    'public.tm_precio_historial(text,text)', 'public.tm_stock_movimiento(text,text,text,integer,text)',
    'public.tm_stock_umbral(text,text,integer)', 'public.tm_kardex(text,text,bigint)',
    'public.tm_importar_productos(text,jsonb,text,boolean,boolean,boolean)', 'public.tm_moderar_lote(text,text[],boolean,text)',
    'public.tm_kyc_guardar(text,jsonb)', 'public.tm_kyc_documento(text,integer,uuid)', 'public.tm_kyc_enviar(text)',
    'public.tm_kyc_revisar(text,text,integer,text,text)', 'public.tm_tienda_guardar(text,jsonb)',
    'public.tm_kyc_archivo(text,text,integer)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
