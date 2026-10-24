-- =========================================================================
-- Tumbo Market — Ola 2: backoffice y crecimiento
-- -------------------------------------------------------------------------
-- Lo que la operación necesita para gobernar y hacer crecer el marketplace
-- (ver docs/dominios/crecimiento.md):
--   · ajustes editables con su tipo, metadatos y validación; comisiones por
--     categoría y por comercio con vigencia (comision_vigente, la que se
--     guarda al vender); doble aprobación de las comisiones y los datos de
--     cobro; historial de cambios;
--   · interruptores aplicados en el servidor (compras, métodos, categorías y
--     ciudades en pausa) y el aviso de incidencia;
--   · moderación con reglas (palabras prohibidas o reguladas, precio
--     anómalo, duplicados), marcado automático al enviar a revisión, cola de
--     denuncias y revisión de lo ya publicado;
--   · fichas 360 de comercios y compradores, notas internas, sanciones
--     (advertencia, limitar publicaciones, retener fondos) y niveles
--     automáticos con beneficios;
--   · riesgo (contrato riesgo_pedido con reglas reales, listas negras y
--     retención preventiva que consume la liquidación de Pagos);
--   · marketing: banners, colecciones y campañas; ofertas (precio anterior,
--     relámpago, por cantidad) y cupones, aplicados por el contrato
--     aplicar_promociones (que el checkout ya llama);
--   · métricas de negocio y analítica de eventos sin datos personales.
-- Solo agrega: tablas e índices nuevos, `create or replace` desde la última
-- definición de cada función redefinida e `insert … on conflict do nothing`.
-- Redefine (desde su última versión, conservando su comportamiento):
--   tm_ajuste_guardar (de este dominio); los contratos
--   tumbo_privado.aplicar_promociones y riesgo_pedido; de Pagos,
--   tumbo_privado.retencion_seller (la sanción de retener fondos y la
--   cuenta de cobro en la lista negra) y pedido_liquidable (la retención
--   preventiva por riesgo). No redefine tm_archivo_preparar: la subida de
--   las imágenes de marketing (marketing_puede_subir) la conecta la
--   integración de la ola 2 (ver docs/dominios/crecimiento.md).
-- La tabla tumbo.denuncias es de Comunicación: si aún no existe se crea con
-- su mismo contrato (objeto, autor_id, estado abierta/cerrada, resolución
-- procede/no_procede/duplicada); aquí solo se atienden las de productos y
-- comercios.
-- La regla de moderación (tm_moderar_producto y el lote) y el checkout
-- (tm_crear_pedido y tm_checkout_crear: interruptores, comisión vigente,
-- promociones y riesgo) se completan con disparadores en vez de redefinir
-- moderar_producto y checkout_crear: la migración de la integración de la
-- ola 1 (20261023190000) las redefine y, en el orden de los archivos, se
-- aplica después de esta.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Ajustes: metadatos, ajustes nuevos y validación
-- ---------------------------------------------------------------------------
-- Para el backoffice: grupo, etiqueta, ayuda, si un cambio necesita la
-- aprobación de una segunda persona y el esquema de los ajustes compuestos
-- ({campo: {tipo, min, max, entero, etiqueta}}), que el servidor valida.
create table tumbo.ajustes_meta (
  clave            text primary key check (clave ~ '^[a-z][a-z0-9_]{1,59}$'),
  grupo            text not null,
  etiqueta         text not null,
  ayuda            text,
  doble_aprobacion boolean not null default false,
  esquema          jsonb not null default '{}'::jsonb check (jsonb_typeof(esquema) = 'object'),
  orden            integer not null default 100
);
alter table tumbo.ajustes_meta enable row level security;
revoke all on tumbo.ajustes_meta from public, anon, authenticated;

insert into tumbo.ajustes (clave, valor, tipo, vaciable, publico, descripcion) values
  ('categorias_apagadas', '[]', 'array', false, true,
   'Interruptor: categorías en pausa (sus identificadores). Sus productos no se pueden comprar mientras tanto.'),
  ('ciudades_apagadas', '[]', 'array', false, true,
   'Interruptor: ciudades o estados donde las entregas y los despachos están en pausa (p. ej. por una incidencia).'),
  ('riesgo', '{"umbral_alerta": 40, "umbral_retencion": 80, "cuenta_nueva_dias": 7, "monto_alto_usd": 300,
               "compras_hora": 3, "compras_dia": 8, "rechazos_30d": 2, "pico_factor": 3, "pico_minimo": 5,
               "disputas_seller": 3}', 'object', false, false,
   'Reglas de riesgo de cada pago: puntaje de alerta y de retención preventiva (sus pedidos no se liquidan hasta que una persona lo revisa), cuenta nueva y monto alto, compras seguidas, rechazos y picos del comercio.'),
  ('moderacion', '{"precio_factor": 4, "precio_muestra_min": 3, "duplicado_similitud": 0.85, "denuncias_marcar": 2}', 'object', false, false,
   'Moderación automática: cuántas veces por encima o por debajo de la mediana de su categoría es un precio anómalo (con una muestra mínima), parecido para marcar un duplicado y denuncias para marcar un producto.'),
  ('promociones', '{"ofertas_activas_seller": 50, "cupones_activos_seller": 20, "descuento_max_pct": 70,
                    "relampago_max_horas": 72, "referencia_dias": 7, "cupones_intentos": 10}', 'object', false, false,
   'Topes de las promociones: ofertas y cupones activos por comercio, descuento máximo, duración de una oferta relámpago, días a la venta sin subir el precio antes de tacharlo y códigos de cupón distintos que una persona puede probar cada 10 minutos.'),
  ('analitica', '{"eventos_minuto_red": 120, "eventos_minuto_total": 6000, "dias_conservar": 400}', 'object', false, false,
   'Analítica de eventos sin datos personales: eventos por minuto que acepta cada red y en total, y días que se conservan.'),
  ('niveles', '{"ventana_dias": 90, "requiere_kyc": true, "niveles": [
      {"id": "lider", "nombre": "Tumbo Líder", "ventas_min": 10, "gmv_min_usd": 300, "cancelacion_max_pct": 5,
       "disputas_perdidas_max_pct": 3, "a_tiempo_min_pct": 90, "descuento_comision_pts": 0.5},
      {"id": "lider_oro", "nombre": "Líder Oro", "ventas_min": 40, "gmv_min_usd": 1500, "cancelacion_max_pct": 4,
       "disputas_perdidas_max_pct": 2, "a_tiempo_min_pct": 92, "descuento_comision_pts": 1},
      {"id": "lider_platino", "nombre": "Líder Platino", "ventas_min": 100, "gmv_min_usd": 5000, "cancelacion_max_pct": 3,
       "disputas_perdidas_max_pct": 1, "a_tiempo_min_pct": 95, "descuento_comision_pts": 1.5}]}', 'object', false, true,
   'Niveles de los comercios (tipo MercadoLíder): ventas y monto vendido mínimos en la ventana, cancelaciones, reclamos perdidos y despachos a tiempo; el beneficio es la insignia y puntos menos de comisión.')
on conflict (clave) do nothing;

insert into tumbo.ajustes_meta (clave, grupo, etiqueta, ayuda, doble_aprobacion, esquema, orden) values
  ('checkout_activo', 'Interruptores', 'Compras activas', 'Apagado, nadie puede confirmar un checkout (la tienda lo avisa).', false, '{}', 10),
  ('registro_activo', 'Interruptores', 'Registro de cuentas', 'Apagado, nadie se puede registrar desde la web.', false, '{}', 11),
  ('categorias_apagadas', 'Interruptores', 'Categorías en pausa', 'Sus productos no se pueden comprar (el checkout lo rechaza).', false, '{}', 12),
  ('ciudades_apagadas', 'Interruptores', 'Ciudades o estados en pausa', 'No se entrega ni se despacha desde ahí (el checkout lo rechaza).', false, '{}', 13),
  ('aviso_incidencia', 'Interruptores', 'Aviso de incidencia', 'Texto visible en toda la tienda y en los paneles; vacío, no se muestra.', false, '{}', 14),
  ('pagos_beneficiario', 'Pagos y cobro', 'Datos de cobro', 'Lo que ve el comprador para pagar. Cada cambio lo aprueba otra persona.', true, '{}', 20),
  ('impuestos', 'Pagos y cobro', 'Impuestos', null, false,
   '{"iva_pct": {"tipo": "number", "min": 0, "max": 100, "etiqueta": "IVA (%)"}, "igtf_pct": {"tipo": "number", "min": 0, "max": 100, "etiqueta": "IGTF (%)"}, "categorias_exentas": {"tipo": "array", "etiqueta": "Categorías exentas de IVA"}}', 21),
  ('conciliacion', 'Pagos y cobro', 'Conciliación bancaria', null, false,
   '{"dias": {"tipo": "number", "min": 0, "max": 60, "entero": true, "etiqueta": "Días de margen"}, "tolerancia_bs": {"tipo": "number", "min": 0, "max": 100000, "etiqueta": "Tolerancia (Bs.)"}, "digitos_sufijo": {"tipo": "number", "min": 1, "max": 20, "entero": true, "etiqueta": "Dígitos del sufijo"}, "filas_dia_total": {"tipo": "number", "min": 1, "max": 10000000, "entero": true, "etiqueta": "Movimientos por día (total)"}, "filas_dia_usuario": {"tipo": "number", "min": 1, "max": 10000000, "entero": true, "etiqueta": "Movimientos por día (persona)"}}', 22),
  ('reembolsos', 'Pagos y cobro', 'Reembolsos', null, false,
   '{"umbral_doble_usd": {"tipo": "number", "min": 0, "max": 10000000, "etiqueta": "Doble aprobación desde (USD)"}}', 23),
  ('tasa_bcv', 'Pagos y cobro', 'Tasa BCV', null, false,
   '{"url": {"tipo": "string", "etiqueta": "Fuente (URL)"}, "horas_alerta": {"tipo": "number", "min": 1, "max": 10000, "entero": true, "etiqueta": "Horas sin actualizar antes de avisar"}, "variacion_max_pct": {"tipo": "number", "min": 0, "max": 1000, "etiqueta": "Variación máxima automática (%)"}}', 24),
  ('liquidaciones', 'Pagos y cobro', 'Liquidaciones', null, false,
   '{"envio_al_seller": {"tipo": "boolean", "etiqueta": "El comercio recibe el envío cobrado"}}', 25),
  ('soporte', 'Atención', 'Soporte', 'Canales y horario que muestra la tienda.', false, '{}', 30),
  ('sitio_url', 'Atención', 'Dirección del sitio', 'Los enlaces de los correos parten de ella.', false, '{}', 31),
  ('terminos_version', 'Atención', 'Versión de los términos', null, false, '{}', 32),
  ('logistica', 'Operación', 'Plazos (SLA)', 'Se editan con la validación de Logística (coherencia entre plazos).', false, '{}', 40),
  ('cuotas_archivos', 'Topes', 'Cuotas de archivos', null, false,
   '{"archivos_por_dia": {"tipo": "number", "min": 0, "max": 10000000, "entero": true, "etiqueta": "Archivos por persona y día"}, "mb_por_seller": {"tipo": "number", "min": 0, "max": 10000000, "etiqueta": "MB por comercio"}, "mb_por_usuario": {"tipo": "number", "min": 0, "max": 10000000, "etiqueta": "MB por cuenta sin comercio"}}', 50),
  ('promociones', 'Topes', 'Promociones', null, false,
   '{"ofertas_activas_seller": {"tipo": "number", "min": 1, "max": 1000, "entero": true, "etiqueta": "Ofertas activas por comercio"}, "cupones_activos_seller": {"tipo": "number", "min": 0, "max": 500, "entero": true, "etiqueta": "Cupones activos por comercio"}, "descuento_max_pct": {"tipo": "number", "min": 5, "max": 90, "etiqueta": "Descuento máximo (%)"}, "relampago_max_horas": {"tipo": "number", "min": 1, "max": 336, "entero": true, "etiqueta": "Duración máxima de una relámpago (h)"}, "referencia_dias": {"tipo": "number", "min": 0, "max": 60, "entero": true, "etiqueta": "Días a la venta sin subir el precio para tacharlo"}, "cupones_intentos": {"tipo": "number", "min": 3, "max": 100, "entero": true, "etiqueta": "Códigos de cupón distintos por persona cada 10 minutos"}}', 51),
  ('analitica', 'Topes', 'Analítica', null, false,
   '{"eventos_minuto_red": {"tipo": "number", "min": 10, "max": 10000, "entero": true, "etiqueta": "Eventos por minuto y red"}, "eventos_minuto_total": {"tipo": "number", "min": 100, "max": 1000000, "entero": true, "etiqueta": "Eventos por minuto en total"}, "dias_conservar": {"tipo": "number", "min": 30, "max": 1000, "entero": true, "etiqueta": "Días que se conservan"}}', 52),
  ('riesgo', 'Riesgo', 'Reglas de riesgo', 'Puntaje de 0 a 100 por pago; desde el umbral de retención sus pedidos no se liquidan hasta revisarlo.', false,
   '{"umbral_alerta": {"tipo": "number", "min": 1, "max": 100, "entero": true, "etiqueta": "Puntaje de alerta"}, "umbral_retencion": {"tipo": "number", "min": 1, "max": 100, "entero": true, "etiqueta": "Puntaje de retención preventiva"}, "cuenta_nueva_dias": {"tipo": "number", "min": 0, "max": 365, "entero": true, "etiqueta": "Días de una cuenta nueva"}, "monto_alto_usd": {"tipo": "number", "min": 1, "max": 100000, "etiqueta": "Monto alto (USD)"}, "compras_hora": {"tipo": "number", "min": 1, "max": 100, "entero": true, "etiqueta": "Compras en una hora"}, "compras_dia": {"tipo": "number", "min": 1, "max": 500, "entero": true, "etiqueta": "Compras en un día"}, "rechazos_30d": {"tipo": "number", "min": 1, "max": 50, "entero": true, "etiqueta": "Pagos rechazados en 30 días"}, "pico_factor": {"tipo": "number", "min": 1.5, "max": 50, "etiqueta": "Pico de ventas (veces el promedio)"}, "pico_minimo": {"tipo": "number", "min": 1, "max": 1000, "entero": true, "etiqueta": "Ventas mínimas del pico"}, "disputas_seller": {"tipo": "number", "min": 1, "max": 100, "entero": true, "etiqueta": "Reclamos abiertos del comercio"}}', 60),
  ('moderacion', 'Moderación', 'Moderación automática', null, false,
   '{"precio_factor": {"tipo": "number", "min": 1.5, "max": 100, "etiqueta": "Precio anómalo (veces la mediana)"}, "precio_muestra_min": {"tipo": "number", "min": 1, "max": 100, "entero": true, "etiqueta": "Productos mínimos de la categoría"}, "duplicado_similitud": {"tipo": "number", "min": 0.5, "max": 1, "etiqueta": "Parecido de un duplicado (0,5 a 1)"}, "denuncias_marcar": {"tipo": "number", "min": 1, "max": 100, "entero": true, "etiqueta": "Denuncias para marcar"}}', 70),
  ('niveles', 'Crecimiento', 'Niveles de los comercios', 'Bajan la comisión de los comercios: cada cambio lo aprueba otra persona. Los recalcula la tarea diaria (o «Recalcular niveles» en Comercios 360).', true, '{}', 80)
on conflict (clave) do nothing;

-- Historial de cambios de configuración y cambios que esperan la segunda
-- aprobación (datos de cobro, comisiones y la tarifa fija).
create table tumbo.cambios_config (
  id               bigint generated always as identity primary key,
  tipo             text not null check (tipo in ('ajuste', 'config', 'comision')),
  clave            text not null check (char_length(clave) <= 80),
  antes            jsonb,
  despues          jsonb,
  estado           text not null check (estado in ('aplicado', 'pendiente', 'rechazado', 'anulado')),
  motivo           text check (motivo is null or char_length(motivo) <= 300),
  propuesto_por    uuid,
  propuesto_nombre text not null,
  decidido_por     uuid,
  decidido_nombre  text,
  decidido_el      timestamptz,
  nota             text check (nota is null or char_length(nota) <= 300),
  creado           timestamptz not null default now()
);
create index cambios_config_pendientes_idx on tumbo.cambios_config (tipo, clave) where estado = 'pendiente';
create index cambios_config_creado_idx on tumbo.cambios_config (creado desc);
alter table tumbo.cambios_config enable row level security;
revoke all on tumbo.cambios_config from public, anon, authenticated;

-- Permisos finos nuevos (catálogo de Cuentas).
insert into tumbo.permisos (permiso, descripcion, ambito, implicito_en, asignable_a) values
  ('marketing', 'Banners, colecciones, campañas, ofertas y cupones de Tumbo', 'interno', '{}', '{ops}'),
  ('riesgo', 'Revisar el riesgo de los pagos, liberar retenciones preventivas y gestionar las listas negras', 'interno', '{finanzas}', '{ops}')
on conflict (permiso) do nothing;

-- Quién del equipo actúa en este dominio: el superadministrador, y
-- Operaciones o Finanzas con el permiso fino.
create function tumbo_privado.exigir_permiso(p_yo tumbo.usuarios, p_permiso text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(tumbo_privado.tiene_permiso(p_yo, p_permiso), false) then
    raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
  end if;
end $$;

-- Cómo firma alguien del equipo en el historial que pueden leer las cuentas
-- de prueba: su nombre si quien mira es una cuenta real o si es otra cuenta
-- de prueba; si no, solo su rol.
create function tumbo_privado.firma_visible(p_yo tumbo.usuarios, p_autor uuid, p_nombre text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_nombre is null then null
              when not tumbo_privado.cuenta_demo(p_yo.email) or p_autor is null
                   or exists (select 1 from tumbo.usuarios u where u.id = p_autor and tumbo_privado.cuenta_demo(u.email))
                then p_nombre
              else 'Cuenta real del equipo' end
$$;

-- Valida el contenido de un ajuste más allá de su tipo: los compuestos con
-- su esquema (campos conocidos, tipo y rango) y algunos con reglas propias.
create function tumbo_privado.validar_ajuste(p_clave text, p_valor jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  m tumbo.ajustes_meta;
  k text;
  e jsonb;
  v jsonb;
  x numeric;
  n jsonb;
  v_ids text[] := '{}';
  v_estricto boolean;
begin
  if jsonb_typeof(p_valor) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_valor) = 'string' and (char_length(p_valor #>> '{}') > 2000 or (p_valor #>> '{}') ~ '[[:cntrl:]]') then
    raise exception 'El texto es demasiado largo o tiene caracteres no admitidos.';
  end if;
  if p_clave = 'aviso_incidencia' and (char_length(btrim(p_valor #>> '{}')) < 5 or char_length(p_valor #>> '{}') > 300) then
    raise exception 'El aviso de incidencia va de 5 a 300 caracteres (o vacío para quitarlo).';
  end if;
  if p_clave = 'categorias_apagadas' then
    if jsonb_array_length(p_valor) > 50 then
      raise exception 'Hasta 50 categorías en pausa.';
    end if;
    for v in select * from jsonb_array_elements(p_valor) loop
      if jsonb_typeof(v) <> 'string' or not exists (select 1 from tumbo.categorias c where c.id = v #>> '{}') then
        raise exception 'La categoría «%» no existe.', left(coalesce(v #>> '{}', v::text), 60);
      end if;
    end loop;
    return;
  end if;
  if p_clave = 'ciudades_apagadas' then
    if jsonb_array_length(p_valor) > 50 then
      raise exception 'Hasta 50 ciudades o estados en pausa.';
    end if;
    for v in select * from jsonb_array_elements(p_valor) loop
      if jsonb_typeof(v) <> 'string' or char_length(btrim(v #>> '{}')) not between 2 and 60 or (v #>> '{}') ~ '[[:cntrl:]<>]' then
        raise exception 'Cada ciudad o estado en pausa es un nombre de 2 a 60 caracteres.';
      end if;
    end loop;
    return;
  end if;
  if p_clave = 'niveles' then
    if jsonb_typeof(p_valor -> 'niveles') <> 'array' or jsonb_array_length(p_valor -> 'niveles') not between 1 and 5 then
      raise exception 'Los niveles van en una lista de 1 a 5.';
    end if;
    if tumbo_privado.num_json(p_valor -> 'ventana_dias') is null or tumbo_privado.num_json(p_valor -> 'ventana_dias') not between 30 and 365 then
      raise exception 'La ventana de los niveles va de 30 a 365 días.';
    end if;
    if jsonb_typeof(p_valor -> 'requiere_kyc') <> 'boolean' then
      raise exception 'Indica si los niveles requieren el expediente verificado (sí o no).';
    end if;
    for n in select * from jsonb_array_elements(p_valor -> 'niveles') loop
      if jsonb_typeof(n) <> 'object' or coalesce(n ->> 'id', '') !~ '^[a-z][a-z0-9_]{1,29}$'
         or char_length(coalesce(n ->> 'nombre', '')) not between 3 and 40 then
        raise exception 'Cada nivel lleva un identificador (minúsculas) y un nombre de 3 a 40 caracteres.';
      end if;
      if (n ->> 'id') = any (v_ids) then
        raise exception 'El nivel «%» está repetido.', n ->> 'id';
      end if;
      v_ids := v_ids || (n ->> 'id');
      foreach k in array array['ventas_min', 'gmv_min_usd', 'cancelacion_max_pct', 'disputas_perdidas_max_pct', 'a_tiempo_min_pct', 'descuento_comision_pts'] loop
        x := tumbo_privado.num_json(n -> k);
        if x is null or x < 0 or (k like '%pct' and x > 100) then
          raise exception 'Revisa «%» del nivel «%».', k, n ->> 'nombre';
        end if;
      end loop;
      -- un nivel se gana vendiendo y su beneficio es acotado (cada punto es
      -- comisión que Tumbo deja de cobrar a todos los comercios del nivel)
      if tumbo_privado.num_json(n -> 'ventas_min') < 1 or tumbo_privado.num_json(n -> 'ventas_min') <> trunc(tumbo_privado.num_json(n -> 'ventas_min')) then
        raise exception 'El nivel «%» pide al menos una venta entregada (un número entero).', n ->> 'nombre';
      end if;
      if tumbo_privado.num_json(n -> 'descuento_comision_pts') > 3 then
        raise exception 'El beneficio del nivel «%» va hasta 3 puntos menos de comisión.', n ->> 'nombre';
      end if;
    end loop;
    return;
  end if;
  select * into m from tumbo.ajustes_meta where clave = p_clave;
  if not found or m.esquema = '{}'::jsonb or jsonb_typeof(p_valor) <> 'object' then
    return;
  end if;
  -- los de este dominio llevan exactamente sus campos; los de los demás
  -- dominios se validan en lo que traen (pueden sumar campos propios)
  v_estricto := p_clave in ('riesgo', 'moderacion', 'promociones', 'analitica');
  for k in select jsonb_object_keys(p_valor) loop
    if v_estricto and not m.esquema ? k then
      raise exception 'El campo «%» no existe en «%».', left(k, 40), m.etiqueta;
    end if;
  end loop;
  for k, e in select * from jsonb_each(m.esquema) loop
    v := p_valor -> k;
    if v is null and not v_estricto then
      continue;
    end if;
    if v is null then
      raise exception 'Falta «%» en «%».', coalesce(e ->> 'etiqueta', k), m.etiqueta;
    end if;
    if jsonb_typeof(v) <> (e ->> 'tipo') then
      raise exception '«%» espera %.', coalesce(e ->> 'etiqueta', k),
        case e ->> 'tipo' when 'number' then 'un número' when 'boolean' then 'sí o no' when 'array' then 'una lista' else 'un texto' end;
    end if;
    if e ->> 'tipo' = 'number' then
      x := (v #>> '{}')::numeric;
      if (e ? 'min' and x < (e ->> 'min')::numeric) or (e ? 'max' and x > (e ->> 'max')::numeric) then
        raise exception '«%» va de % a %.', coalesce(e ->> 'etiqueta', k), e ->> 'min', e ->> 'max';
      end if;
      if coalesce((e ->> 'entero')::boolean, false) and x <> trunc(x) then
        raise exception '«%» debe ser un número entero.', coalesce(e ->> 'etiqueta', k);
      end if;
    elsif e ->> 'tipo' = 'string' and char_length(v #>> '{}') > 500 then
      raise exception '«%» es demasiado largo.', coalesce(e ->> 'etiqueta', k);
    end if;
  end loop;
  if p_clave = 'riesgo' and (p_valor ->> 'umbral_alerta')::numeric >= (p_valor ->> 'umbral_retencion')::numeric then
    raise exception 'El puntaje de alerta debe ser menor que el de retención.';
  end if;
end $$;

-- Desde la de fundaciones (sigue siendo de este dominio). Cambios: lo pueden
-- hacer también Operaciones y Finanzas con el permiso fino «ajustes»; se
-- valida el contenido (validar_ajuste); los marcados con doble aprobación
-- (los datos de cobro y los niveles, que cambian la comisión de los
-- comercios) quedan pendientes hasta que otra persona los aprueba
-- (tm_cambio_decidir) y devuelven {pendiente, cambio, mensaje}; cada cambio
-- queda en el historial. Mismos mensajes para quien ya lo llamaba.
create or replace function public.tm_ajuste_guardar(p_sesion text, p_clave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  a tumbo.ajustes;
  m tumbo.ajustes_meta;
  v_valor jsonb := coalesce(p_valor, 'null'::jsonb);
  v_id bigint;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  perform tumbo_privado.exigir_elevada(yo);
  select * into a from tumbo.ajustes where clave = p_clave for update;
  if not found then
    raise exception 'El ajuste «%» no existe.', left(coalesce(p_clave, ''), 60);
  end if;
  if octet_length(v_valor::text) > 20000 then
    raise exception 'El valor del ajuste es demasiado grande.';
  end if;
  if jsonb_typeof(v_valor) = 'null' then
    if not a.vaciable then
      raise exception 'El ajuste «%» no se puede dejar vacío.', a.clave;
    end if;
  elsif jsonb_typeof(v_valor) <> a.tipo then
    raise exception 'El ajuste «%» espera %.', a.clave,
      case a.tipo when 'boolean' then 'sí o no' when 'number' then 'un número' when 'string' then 'un texto'
                  when 'array' then 'una lista' else 'un conjunto de datos' end;
  end if;
  perform tumbo_privado.validar_ajuste(a.clave, v_valor);
  select * into m from tumbo.ajustes_meta where clave = a.clave;
  if coalesce(m.doble_aprobacion, false) then
    if a.valor = v_valor then
      raise exception 'El valor de «%» no cambió.', coalesce(m.etiqueta, a.clave);
    end if;
    if exists (select 1 from tumbo.cambios_config where tipo = 'ajuste' and clave = a.clave and estado = 'pendiente') then
      raise exception 'Ya hay un cambio de «%» esperando la segunda aprobación: decídelo antes de proponer otro.', coalesce(m.etiqueta, a.clave);
    end if;
    insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, propuesto_por, propuesto_nombre)
    values ('ajuste', a.clave, a.valor, v_valor, 'pendiente', yo.id, tumbo_privado.actor(yo))
    returning id into v_id;
    perform tumbo_privado.notificar('rol:superadmin', 'Cambio de «' || coalesce(m.etiqueta, a.clave) || '» esperando la segunda aprobación',
                                    'rule', 'admin/ajustes.html');
    perform tumbo_privado.auditar(yo, 'Ajuste propuesto', a.clave || ' (cambio ' || v_id || ', espera la segunda aprobación)');
    return jsonb_build_object('pendiente', true, 'cambio', v_id,
      'mensaje', 'El cambio queda pendiente: lo aprueba otra persona del equipo con sesión elevada.');
  end if;
  update tumbo.ajustes set valor = v_valor, actualizado = now(), por = yo.nombre || ' (' || yo.rol || ')'
  where clave = a.clave;
  insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, propuesto_por, propuesto_nombre)
  values ('ajuste', a.clave, a.valor, v_valor, 'aplicado', yo.id, tumbo_privado.actor(yo));
  perform tumbo_privado.auditar(yo, 'Ajuste cambiado',
    a.clave || ': ' || left(a.valor::text, 400) || ' → ' || left(v_valor::text, 400));
  return v_valor;
end $$;

-- La configuración base de tumbo.config que se edita desde el backoffice:
-- ventana de reclamo (días), tarifa fija por pedido (con doble aprobación) y
-- la ciudad que muestra la cabecera. La comisión por omisión se cambia con
-- una comisión global (tm_comision_proponer, con vigencia).
create function public.tm_config_guardar(p_sesion text, p_campo text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  cfg tumbo.config;
  v_antes jsonb;
  v_num numeric := tumbo_privado.num_json(p_valor);
  v_texto text := btrim(coalesce(p_valor #>> '{}', ''));
  v_id bigint;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  perform tumbo_privado.exigir_elevada(yo);
  select * into cfg from tumbo.config for update;
  if p_campo = 'ventana_reclamo_dias' then
    if v_num is null or v_num <> trunc(v_num) or v_num not between 1 and 30 then
      raise exception 'La ventana de reclamo va de 1 a 30 días.';
    end if;
    v_antes := to_jsonb(cfg.ventana_reclamo_dias);
    update tumbo.config set ventana_reclamo_dias = v_num::integer where id;
  elsif p_campo = 'ciudad_entrega' then
    if char_length(v_texto) not between 2 and 60 or v_texto ~ '[[:cntrl:]<>]' then
      raise exception 'La ciudad va de 2 a 60 caracteres.';
    end if;
    v_antes := to_jsonb(cfg.ciudad_entrega);
    update tumbo.config set ciudad_entrega = v_texto where id;
  elsif p_campo = 'tarifa_fija_usd' then
    if v_num is null or v_num < 0 or v_num > 20 or round(v_num, 2) <> v_num then
      raise exception 'La tarifa fija va de 0 a 20 USD (con hasta dos decimales).';
    end if;
    if v_num = cfg.tarifa_fija_usd then
      raise exception 'La tarifa fija no cambió.';
    end if;
    if exists (select 1 from tumbo.cambios_config where tipo = 'config' and clave = p_campo and estado = 'pendiente') then
      raise exception 'Ya hay un cambio de la tarifa fija esperando la segunda aprobación.';
    end if;
    insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, propuesto_por, propuesto_nombre)
    values ('config', p_campo, to_jsonb(cfg.tarifa_fija_usd), to_jsonb(v_num), 'pendiente', yo.id, tumbo_privado.actor(yo))
    returning id into v_id;
    perform tumbo_privado.notificar('rol:superadmin', 'Cambio de la tarifa fija esperando la segunda aprobación', 'rule', 'admin/ajustes.html');
    perform tumbo_privado.auditar(yo, 'Ajuste propuesto', 'tarifa_fija_usd → ' || v_num || ' (cambio ' || v_id || ')');
    return jsonb_build_object('pendiente', true, 'cambio', v_id,
      'mensaje', 'El cambio queda pendiente: lo aprueba otra persona del equipo con sesión elevada.');
  else
    raise exception 'Ese dato de la configuración no se edita desde aquí.';
  end if;
  insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, propuesto_por, propuesto_nombre)
  values ('config', p_campo, v_antes, coalesce(to_jsonb(v_num), to_jsonb(v_texto)), 'aplicado', yo.id, tumbo_privado.actor(yo));
  perform tumbo_privado.auditar(yo, 'Ajuste cambiado', p_campo || ': ' || v_antes::text || ' → ' || coalesce(v_num::text, v_texto));
  return jsonb_build_object('ok', true, 'campo', p_campo);
end $$;

-- ---------------------------------------------------------------------------
-- Comisiones por categoría y por comercio, con vigencia
-- ---------------------------------------------------------------------------
-- Una fila fija la comisión (pct) de un ámbito: global (sin comercio ni
-- categoría), una categoría (raíz o subcategoría), un comercio o un comercio
-- en una categoría; desde/hasta acotan su vigencia. Las de origen «nivel»
-- no fijan una comisión: restan puntos (descuento_pts) a la que rija, como
-- beneficio del nivel del comercio. Las manuales nacen «pendiente» y las
-- aprueba otra persona (tm_cambio_decidir). Sin claves foráneas a comercios
-- o categorías: las pruebas y el reinicio los crean y los borran.
create table tumbo.comisiones (
  id               bigint generated always as identity primary key,
  seller_id        text check (seller_id is null or char_length(seller_id) <= 30),
  categoria        text check (categoria is null or char_length(categoria) <= 60),
  pct              numeric(5,2) check (pct is null or (pct >= 0 and pct <= 50)),
  descuento_pts    numeric(5,2) check (descuento_pts is null or (descuento_pts > 0 and descuento_pts <= 10)),
  desde            timestamptz not null,
  hasta            timestamptz,
  origen           text not null default 'manual' check (origen in ('manual', 'nivel')),
  estado           text not null check (estado in ('pendiente', 'vigente', 'rechazada', 'anulada')),
  motivo           text check (motivo is null or char_length(motivo) <= 300),
  propuesta_por    uuid,
  propuesta_nombre text,
  aprobada_por     uuid,
  aprobada_nombre  text,
  aprobada_el      timestamptz,
  creado           timestamptz not null default now(),
  check ((pct is null) <> (descuento_pts is null)),
  check (descuento_pts is null or (origen = 'nivel' and seller_id is not null and categoria is null)),
  check (hasta is null or hasta > desde)
);
create index comisiones_vigentes_idx on tumbo.comisiones (seller_id, categoria) where estado = 'vigente';
alter table tumbo.comisiones enable row level security;
revoke all on tumbo.comisiones from public, anon, authenticated;

-- La comisión que rige ahora para un comercio en una categoría: la fila
-- vigente más específica (comercio y categoría > comercio > categoría —la
-- propia antes que su raíz— > global; entre iguales, la más reciente), o la
-- de tumbo.config si no hay ninguna; menos el beneficio del nivel del
-- comercio. La usa el checkout al vender (se guarda en el pedido).
create function tumbo_privado.comision_vigente(p_seller text, p_categoria text) returns numeric
language sql stable security definer set search_path = '' as $$
  with cats as (
    select p_categoria as id where p_categoria is not null
    union
    select c.padre from tumbo.categorias c where c.id = p_categoria and c.padre is not null),
  base as (
    select c.pct from tumbo.comisiones c
    where c.estado = 'vigente' and c.pct is not null and c.desde <= now() and (c.hasta is null or c.hasta > now())
      and (c.seller_id is null or c.seller_id = p_seller)
      and (c.categoria is null or c.categoria in (select id from cats))
    order by (c.seller_id is not null) desc, (c.categoria is not null) desc, (c.categoria is not distinct from p_categoria) desc,
             c.desde desc, c.id desc
    limit 1)
  select greatest(round(coalesce((select pct from base), (select x.comision_pct from tumbo.config x where x.id))
           - coalesce((select max(c.descuento_pts) from tumbo.comisiones c
                       where p_seller is not null and c.estado = 'vigente' and c.descuento_pts is not null and c.seller_id = p_seller
                         and c.desde <= now() and (c.hasta is null or c.hasta > now())), 0), 2), 0)
$$;

-- La comisión de un pedido que sale del carrito: la de cada línea según su
-- categoría, ponderada por su monto.
create function tumbo_privado.comision_carrito(p_usuario uuid, p_seller text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(
    round(sum(p.precio_usd * c.cant * tumbo_privado.comision_vigente(p.seller_id, p.categoria)) / nullif(sum(p.precio_usd * c.cant), 0), 2),
    tumbo_privado.comision_vigente(p_seller, null))
  from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
  where c.usuario_id = p_usuario and p.seller_id = p_seller
$$;

-- Propone una comisión (queda pendiente de la segunda aprobación):
-- datos = {seller_id?, categoria?, pct, desde?, hasta?, motivo}.
create function public.tm_comision_proponer(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_seller text := nullif(btrim(coalesce(d ->> 'seller_id', '')), '');
  v_cat text := nullif(btrim(coalesce(d ->> 'categoria', '')), '');
  v_pct numeric := tumbo_privado.num_json(d -> 'pct');
  v_desde timestamptz;
  v_hasta timestamptz;
  v_motivo text := left(regexp_replace(btrim(coalesce(d ->> 'motivo', '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
  v_id bigint;
  v_cambio bigint;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  perform tumbo_privado.exigir_elevada(yo);
  if v_seller is not null and not exists (select 1 from tumbo.sellers where id = v_seller) then
    raise exception 'El comercio % no existe.', left(v_seller, 30);
  end if;
  if v_cat is not null and not exists (select 1 from tumbo.categorias where id = v_cat) then
    raise exception 'La categoría % no existe.', left(v_cat, 60);
  end if;
  if v_pct is null or v_pct < 0 or v_pct > 50 or round(v_pct, 2) <> v_pct then
    raise exception 'La comisión va de 0 a 50 %% (con hasta dos decimales).';
  end if;
  begin
    v_desde := coalesce(nullif(d ->> 'desde', '')::timestamptz, now());
    v_hasta := nullif(d ->> 'hasta', '')::timestamptz;
  exception when others then
    raise exception 'Revisa las fechas de vigencia.';
  end;
  if v_desde < now() - interval '5 minutes' then
    raise exception 'La vigencia no puede empezar en el pasado: una comisión nunca se aplica hacia atrás.';
  end if;
  if v_desde > now() + interval '366 days' then
    raise exception 'La vigencia empieza como mucho dentro de un año.';
  end if;
  if v_hasta is not null and v_hasta <= v_desde then
    raise exception 'La fecha de fin debe ser posterior al inicio.';
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'Indica el motivo del cambio (al menos 5 caracteres).';
  end if;
  if (select count(*) from tumbo.comisiones where estado = 'pendiente') >= 30 then
    raise exception 'Hay 30 comisiones esperando la segunda aprobación: decide alguna antes de proponer otra.';
  end if;
  insert into tumbo.comisiones (seller_id, categoria, pct, desde, hasta, origen, estado, motivo, propuesta_por, propuesta_nombre)
  values (v_seller, v_cat, v_pct, greatest(v_desde, now()), v_hasta, 'manual', 'pendiente', v_motivo, yo.id, tumbo_privado.actor(yo))
  returning id into v_id;
  insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, motivo, propuesto_por, propuesto_nombre)
  values ('comision', v_id::text, to_jsonb(tumbo_privado.comision_vigente(v_seller, v_cat)),
          jsonb_build_object('seller_id', v_seller, 'categoria', v_cat, 'pct', v_pct, 'desde', greatest(v_desde, now()), 'hasta', v_hasta),
          'pendiente', v_motivo, yo.id, tumbo_privado.actor(yo))
  returning id into v_cambio;
  perform tumbo_privado.notificar('rol:superadmin', 'Comisión de ' || v_pct || ' % (' || coalesce(v_seller, 'todos los comercios') ||
    coalesce(' · ' || v_cat, '') || ') esperando la segunda aprobación', 'percent', 'admin/ajustes.html');
  perform tumbo_privado.auditar(yo, 'Comisión propuesta', coalesce(v_seller, 'global') || coalesce(' · ' || v_cat, '') || ' → ' || v_pct ||
                                ' % desde ' || to_char(greatest(v_desde, now()) at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI') ||
                                ' (cambio ' || v_cambio || ') · ' || v_motivo);
  return jsonb_build_object('id', v_id, 'cambio', v_cambio, 'pendiente', true,
    'mensaje', 'La comisión queda pendiente: la aprueba otra persona del equipo con sesión elevada.');
end $$;

-- Pide terminar una comisión vigente (también con doble aprobación).
create function public.tm_comision_terminar(p_sesion text, p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  c tumbo.comisiones;
  v_motivo text := left(regexp_replace(btrim(coalesce(p_motivo, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
  v_cambio bigint;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  perform tumbo_privado.exigir_elevada(yo);
  select * into c from tumbo.comisiones where id = p_id for update;
  if not found or c.origen <> 'manual' then
    raise exception 'Comisión no encontrada.';
  end if;
  if c.estado <> 'vigente' or (c.hasta is not null and c.hasta <= now()) then
    raise exception 'Esa comisión ya no está vigente.';
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'Indica el motivo (al menos 5 caracteres).';
  end if;
  if exists (select 1 from tumbo.cambios_config where tipo = 'comision' and clave = 'fin:' || c.id and estado = 'pendiente') then
    raise exception 'Ya se pidió terminar esa comisión: espera la segunda aprobación.';
  end if;
  insert into tumbo.cambios_config (tipo, clave, antes, despues, estado, motivo, propuesto_por, propuesto_nombre)
  values ('comision', 'fin:' || c.id, jsonb_build_object('pct', c.pct, 'seller_id', c.seller_id, 'categoria', c.categoria, 'hasta', c.hasta),
          jsonb_build_object('hasta', 'al aprobarse'), 'pendiente', v_motivo, yo.id, tumbo_privado.actor(yo))
  returning id into v_cambio;
  perform tumbo_privado.auditar(yo, 'Comisión por terminar', c.id || ' (' || coalesce(c.seller_id, 'global') || coalesce(' · ' || c.categoria, '') ||
                                ', ' || c.pct || ' %) · cambio ' || v_cambio || ' · ' || v_motivo);
  return jsonb_build_object('cambio', v_cambio, 'pendiente', true,
    'mensaje', 'La comisión termina cuando otra persona del equipo lo apruebe.');
end $$;

-- Segunda aprobación (o rechazo) de un cambio pendiente: datos de cobro,
-- tarifa fija y comisiones. La da otra persona que quien lo propuso, con
-- sesión elevada; quien lo propuso solo lo puede retirar. Si lo que se iba a
-- cambiar ya cambió por otra vía, el cambio se anula (hay que proponerlo de
-- nuevo, viendo el valor actual).
create function public.tm_cambio_decidir(p_sesion text, p_id bigint, p_aprobar boolean, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  c tumbo.cambios_config;
  a tumbo.ajustes;
  cfg tumbo.config;
  k tumbo.comisiones;
  v_nota text := nullif(left(regexp_replace(btrim(coalesce(p_nota, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300), '');
  v_id bigint;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  perform tumbo_privado.exigir_elevada(yo);
  if p_aprobar is null then
    raise exception 'Indica si apruebas o rechazas el cambio.';
  end if;
  select * into c from tumbo.cambios_config where id = p_id for update;
  if not found then
    raise exception 'Cambio no encontrado.';
  end if;
  if c.estado <> 'pendiente' then
    raise exception 'Ese cambio ya se decidió.';
  end if;
  if c.tipo = 'comision' then
    v_id := nullif(regexp_replace(c.clave, '^fin:', ''), '')::bigint;
    select * into k from tumbo.comisiones where id = v_id for update;
  end if;

  if not p_aprobar then
    update tumbo.cambios_config
    set estado = case when c.propuesto_por = yo.id then 'anulado' else 'rechazado' end,
        decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(), nota = v_nota
    where id = c.id;
    if c.tipo = 'comision' and c.clave !~ '^fin:' and k.estado = 'pendiente' then
      update tumbo.comisiones set estado = case when c.propuesto_por = yo.id then 'anulada' else 'rechazada' end where id = k.id;
    end if;
    if c.propuesto_por is not null and c.propuesto_por <> yo.id then
      perform tumbo_privado.notificar('usr:' || c.propuesto_por, 'Rechazaron tu cambio de «' || c.clave || '»' || coalesce(': ' || v_nota, ''),
                                      'rule', 'admin/ajustes.html');
    end if;
    perform tumbo_privado.auditar(yo, case when c.propuesto_por = yo.id then 'Cambio retirado' else 'Cambio rechazado' end,
                                  c.tipo || ' ' || c.clave || ' (cambio ' || c.id || ')' || coalesce(' · ' || v_nota, ''));
    return jsonb_build_object('ok', true, 'estado', case when c.propuesto_por = yo.id then 'anulado' else 'rechazado' end);
  end if;

  if c.propuesto_por = yo.id then
    raise exception 'La segunda aprobación la da otra persona del equipo (no quien propuso el cambio).';
  end if;

  if c.tipo = 'ajuste' then
    select * into a from tumbo.ajustes where clave = c.clave for update;
    if not found or a.valor is distinct from c.antes then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'El ajuste cambió desde la propuesta: hay que proponerlo de nuevo.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'El ajuste cambió desde la propuesta: proponlo de nuevo.');
    end if;
    perform tumbo_privado.validar_ajuste(a.clave, c.despues);
    update tumbo.ajustes set valor = c.despues, actualizado = now(), por = yo.nombre || ' (' || yo.rol || ', segunda aprobación)'
    where clave = a.clave;
    perform tumbo_privado.auditar(yo, 'Ajuste cambiado',
      a.clave || ': ' || left(a.valor::text, 400) || ' → ' || left(c.despues::text, 400) || ' (propuso ' || c.propuesto_nombre || ')');
  elsif c.tipo = 'config' then
    select * into cfg from tumbo.config where id for update;
    if c.clave <> 'tarifa_fija_usd' or to_jsonb(cfg.tarifa_fija_usd) <> c.antes then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'La configuración cambió desde la propuesta.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'La configuración cambió desde la propuesta: proponlo de nuevo.');
    end if;
    update tumbo.config set tarifa_fija_usd = (c.despues #>> '{}')::numeric where id;
    perform tumbo_privado.auditar(yo, 'Ajuste cambiado', 'tarifa_fija_usd: ' || c.antes::text || ' → ' || c.despues::text ||
                                  ' (propuso ' || c.propuesto_nombre || ')');
  elsif c.clave ~ '^fin:' then
    if k.id is null or k.estado <> 'vigente' or (k.hasta is not null and k.hasta <= now()) then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'La comisión ya no estaba vigente.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'Esa comisión ya no estaba vigente.');
    end if;
    if k.desde > now() then
      update tumbo.comisiones set estado = 'anulada' where id = k.id;
    else
      update tumbo.comisiones set hasta = now() where id = k.id;
    end if;
    perform tumbo_privado.auditar(yo, 'Comisión terminada', k.id || ' (' || coalesce(k.seller_id, 'global') || coalesce(' · ' || k.categoria, '') ||
                                  ', ' || k.pct || ' %) · propuso ' || c.propuesto_nombre);
  else
    if k.id is null or k.estado <> 'pendiente' then
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'La comisión ya no estaba pendiente.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'Esa comisión ya no estaba pendiente.');
    end if;
    -- una vigencia que empezaba mientras esperaba empieza ahora: nunca hacia atrás
    update tumbo.comisiones
    set estado = 'vigente', desde = greatest(desde, now()), aprobada_por = yo.id, aprobada_nombre = tumbo_privado.actor(yo), aprobada_el = now()
    where id = k.id and (hasta is null or hasta > greatest(desde, now()));
    if not found then
      update tumbo.comisiones set estado = 'anulada' where id = k.id;
      update tumbo.cambios_config set estado = 'anulado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(),
        nota = 'Su vigencia ya terminó.' where id = c.id;
      return jsonb_build_object('ok', false, 'estado', 'anulado', 'mensaje', 'La vigencia propuesta ya terminó.');
    end if;
    perform tumbo_privado.auditar(yo, 'Comisión aprobada', k.id || ' (' || coalesce(k.seller_id, 'global') || coalesce(' · ' || k.categoria, '') ||
                                  ' → ' || k.pct || ' %) · propuso ' || c.propuesto_nombre);
  end if;
  update tumbo.cambios_config set estado = 'aplicado', decidido_por = yo.id, decidido_nombre = tumbo_privado.actor(yo), decidido_el = now(), nota = v_nota
  where id = c.id;
  if c.propuesto_por is not null then
    perform tumbo_privado.notificar('usr:' || c.propuesto_por, 'Se aprobó tu cambio de «' || c.clave || '»', 'task_alt', 'admin/ajustes.html');
  end if;
  return jsonb_build_object('ok', true, 'estado', 'aplicado');
end $$;

-- ¿Lee una cuenta de prueba el valor de este ajuste? Los públicos y los
-- privados que no ayudan a burlar un control (plazos de Logística, topes de
-- las promociones —el comercio ya los ve— y las liquidaciones). Los demás
-- privados (riesgo, moderación, conciliación, reembolsos, cuotas,
-- analítica, tasa) le llegan reservados.
create function tumbo_privado.ajuste_visible(p_yo tumbo.usuarios, p_clave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce(tumbo_privado.cuenta_demo(p_yo.email), false)
      or p_clave in ('logistica', 'promociones', 'liquidaciones')
      or exists (select 1 from tumbo.ajustes a where a.clave = p_clave and a.publico)
$$;

-- ¿Ve una cuenta de prueba este cambio del historial? Los de los ajustes
-- que puede leer, los de la configuración base y las comisiones globales,
-- por categoría o de los comercios de prueba (nunca las tarifas negociadas
-- con un comercio real).
create function tumbo_privado.cambio_visible(p_yo tumbo.usuarios, c tumbo.cambios_config) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce(tumbo_privado.cuenta_demo(p_yo.email), false)
      or (c.tipo = 'ajuste' and tumbo_privado.ajuste_visible(p_yo, c.clave))
      or c.tipo = 'config'
      or (c.tipo = 'comision' and coalesce(
            (select k.seller_id is null or tumbo_privado.comercio_de_prueba(k.seller_id)
             from tumbo.comisiones k where k.id = nullif(regexp_replace(c.clave, '^fin:', ''), '')::bigint), false))
$$;

-- Todo lo que muestra admin/ajustes: los ajustes con su tipo y sus
-- metadatos, la configuración base, las comisiones, los métodos de pago, los
-- cambios pendientes y el historial. A una cuenta de prueba: sin el nombre
-- de las personas reales, sin el valor de los ajustes privados de control
-- (ajuste_visible) y sin las comisiones de los comercios reales
-- (cambio_visible).
create function public.tm_ajustes_admin(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops', 'finanzas']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  cfg tumbo.config;
begin
  perform tumbo_privado.exigir_permiso(yo, 'ajustes');
  select * into cfg from tumbo.config where id;
  return jsonb_build_object(
    'ajustes', coalesce((select jsonb_agg(jsonb_build_object(
        'clave', a.clave, 'valor', case when tumbo_privado.ajuste_visible(yo, a.clave) then a.valor end,
        'reservado', not tumbo_privado.ajuste_visible(yo, a.clave),
        'tipo', a.tipo, 'vaciable', a.vaciable, 'publico', a.publico,
        'descripcion', a.descripcion, 'actualizado', a.actualizado,
        'grupo', coalesce(m.grupo, 'Otros'), 'etiqueta', coalesce(m.etiqueta, a.clave), 'ayuda', m.ayuda,
        'doble', coalesce(m.doble_aprobacion, false), 'esquema', coalesce(m.esquema, '{}'::jsonb), 'orden', coalesce(m.orden, 1000))
        order by coalesce(m.orden, 1000), a.clave)
      from tumbo.ajustes a left join tumbo.ajustes_meta m on m.clave = a.clave), '[]'::jsonb),
    'config', jsonb_build_object('comision_pct', cfg.comision_pct, 'comision_global', tumbo_privado.comision_vigente(null, null),
                                 'tarifa_fija_usd', cfg.tarifa_fija_usd, 'ventana_reclamo_dias', cfg.ventana_reclamo_dias,
                                 'ciudad_entrega', cfg.ciudad_entrega),
    'comisiones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'seller_id', c.seller_id, 'seller', s.nombre, 'categoria', c.categoria, 'categoria_nombre', k.nombre,
        'pct', c.pct, 'descuento_pts', c.descuento_pts, 'desde', c.desde, 'hasta', c.hasta, 'origen', c.origen, 'estado', c.estado,
        'motivo', c.motivo, 'propuesta', tumbo_privado.firma_visible(yo, c.propuesta_por, c.propuesta_nombre),
        'aprobada', tumbo_privado.firma_visible(yo, c.aprobada_por, c.aprobada_nombre),
        'rige', c.estado = 'vigente' and c.desde <= now() and (c.hasta is null or c.hasta > now()))
        order by c.estado = 'vigente' desc, c.id desc)
      from (select * from tumbo.comisiones x where x.estado in ('pendiente', 'vigente') and (x.hasta is null or x.hasta > now() - interval '90 days')
              and (not v_demo or x.seller_id is null or tumbo_privado.comercio_de_prueba(x.seller_id))
            order by x.id desc limit 300) c
      left join tumbo.sellers s on s.id = c.seller_id left join tumbo.categorias k on k.id = c.categoria), '[]'::jsonb),
    'metodos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'activo', m.activo, 'moneda', m.moneda,
                                                             'contra_entrega', m.contra_entrega) order by m.orden)
                         from tumbo.metodos_pago m where not m.interno), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'padre', c.padre) order by c.padre nulls first, c.orden, c.id)
                            from tumbo.categorias c), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.id) from tumbo.sellers s
                         where not v_demo or tumbo_privado.comercio_de_prueba(s.id)), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'tipo', c.tipo, 'clave', c.clave, 'antes', c.antes, 'despues', c.despues, 'motivo', c.motivo,
        'propuesto', tumbo_privado.firma_visible(yo, c.propuesto_por, c.propuesto_nombre), 'mio', c.propuesto_por = yo.id, 'creado', c.creado)
        order by c.id) from tumbo.cambios_config c where c.estado = 'pendiente' and tumbo_privado.cambio_visible(yo, c)), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'tipo', c.tipo, 'clave', c.clave, 'antes', c.antes, 'despues', c.despues, 'estado', c.estado, 'motivo', c.motivo,
        'propuesto', tumbo_privado.firma_visible(yo, c.propuesto_por, c.propuesto_nombre),
        'decidido', tumbo_privado.firma_visible(yo, c.decidido_por, c.decidido_nombre), 'decidido_el', c.decidido_el,
        'nota', c.nota, 'creado', c.creado) order by c.id desc)
      from (select * from tumbo.cambios_config x where x.estado <> 'pendiente' and tumbo_privado.cambio_visible(yo, x)
            order by x.id desc limit 100) c), '[]'::jsonb),
    'editable', not v_demo,
    'yo', yo.id);
end $$;

-- ---------------------------------------------------------------------------
-- Interruptores aplicados en el servidor
-- ---------------------------------------------------------------------------
-- checkout_activo ya lo aplica el checkout (Pagos) y los métodos de pago se
-- apagan en tumbo.metodos_pago (tm_metodo_pago_guardar, desde Ajustes). Aquí:
-- categorías en pausa (también la raíz de una subcategoría) y ciudades o
-- estados en pausa, tanto el destino de la entrega como el origen del
-- comercio. Se aplican al crear cada pedido de un checkout (disparador de
-- abajo, antes de que el pedido exista), así valen para tm_crear_pedido y
-- tm_checkout_crear sin redefinir el checkout de Pagos.

-- La cuenta que hace la llamada en curso (la sesión que validó
-- tumbo_privado.usuario), o null (tareas, semillas, SQL directo).
create function tumbo_privado.usuario_en_curso() returns tumbo.usuarios
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ses text := nullif(current_setting('tumbo.sesion_actual', true), '');
  u tumbo.usuarios;
begin
  if v_ses is null or v_ses !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select x.* into u from tumbo.sesiones s join tumbo.usuarios x on x.id = s.usuario_id where s.token_hash = decode(v_ses, 'hex');
  return u;
end $$;

create function tumbo_privado.exigir_interruptores(v tumbo.pedidos) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cats jsonb := coalesce(tumbo_privado.ajuste('categorias_apagadas'), '[]'::jsonb);
  v_ciud jsonb := coalesce(tumbo_privado.ajuste('ciudades_apagadas'), '[]'::jsonb);
  v_apagadas text[];
  v_ciudad text := nullif(btrim(coalesce(v.destino ->> 'ciudad', '')), '');
  v_estado text := nullif(btrim(coalesce(v.destino ->> 'estado', '')), '');
  r record;
begin
  if jsonb_typeof(v_cats) = 'array' and jsonb_array_length(v_cats) > 0 then
    select p.nombre, coalesce(k.nombre, p.categoria) as cat into r
    from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
    left join tumbo.categorias k on k.id = p.categoria
    where c.usuario_id = v.comprador_id and p.seller_id = v.seller_id
      and (p.categoria in (select jsonb_array_elements_text(v_cats))
           or k.padre in (select jsonb_array_elements_text(v_cats)))
    order by c.sku limit 1;
    if found then
      raise exception 'Las compras de «%» están en pausa por ahora: quita «%» del carrito para continuar.', r.cat, r.nombre;
    end if;
  end if;
  if jsonb_typeof(v_ciud) <> 'array' or jsonb_array_length(v_ciud) = 0 then
    return;
  end if;
  select array_agg(tumbo_privado.normalizar(x)) into v_apagadas from jsonb_array_elements_text(v_ciud) x;
  if tumbo_privado.normalizar(v_ciudad) = any (v_apagadas) or tumbo_privado.normalizar(v_estado) = any (v_apagadas) then
    raise exception 'Por ahora no hacemos entregas en %: elige otra dirección o inténtalo más tarde.',
      coalesce(case when tumbo_privado.normalizar(v_ciudad) = any (v_apagadas) then v_ciudad end, v_estado);
  end if;
  select s.nombre, coalesce(nullif(ec.origen_ciudad, ''), s.ciudad) as ciudad into r
  from tumbo.sellers s left join tumbo.envio_config ec on ec.seller_id = s.id
  where s.id = v.seller_id
    and (tumbo_privado.normalizar(coalesce(nullif(ec.origen_ciudad, ''), s.ciudad)) = any (v_apagadas)
         or tumbo_privado.normalizar(ec.origen_estado) = any (v_apagadas));
  if found then
    raise exception 'Los despachos desde % están en pausa: % no puede enviar por ahora. Quita sus productos del carrito para continuar.',
      r.ciudad, r.nombre;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Moderación con reglas, marcas automáticas y denuncias
-- ---------------------------------------------------------------------------
-- Palabras o frases (normalizadas como la búsqueda: minúsculas, sin tildes,
-- letras y números separados por un espacio) de artículos prohibidos o
-- regulados. Un producto que las nombra se marca al enviarse a revisión (y
-- al revisar lo ya publicado). Lo prohibido no se aprueba sin descartar
-- antes la marca; lo regulado se aprueba con su advertencia.
create table tumbo.moderacion_reglas (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('prohibido', 'regulado')),
  patron      text not null check (patron ~ '^[a-z0-9]+( [a-z0-9]+){0,5}$' and char_length(patron) between 3 and 60),
  grupo       text not null check (grupo in ('medicamentos', 'armas', 'replicas', 'divisas', 'drogas', 'fauna', 'alcohol_tabaco', 'otros')),
  descripcion text check (descripcion is null or char_length(descripcion) <= 200),
  categoria   text check (categoria is null or char_length(categoria) <= 60),
  activa      boolean not null default true,
  sembrada    boolean not null default false,
  por         text,
  creado      timestamptz not null default now(),
  unique nulls not distinct (patron, categoria)
);
alter table tumbo.moderacion_reglas enable row level security;
revoke all on tumbo.moderacion_reglas from public, anon, authenticated;

insert into tumbo.moderacion_reglas (tipo, patron, grupo, descripcion, sembrada) values
  ('prohibido', 'clonazepam', 'medicamentos', 'Psicotrópico controlado: solo en farmacia con récipe', true),
  ('prohibido', 'alprazolam', 'medicamentos', 'Psicotrópico controlado', true),
  ('prohibido', 'diazepam', 'medicamentos', 'Psicotrópico controlado', true),
  ('prohibido', 'lorazepam', 'medicamentos', 'Psicotrópico controlado', true),
  ('prohibido', 'rivotril', 'medicamentos', 'Psicotrópico controlado (marca)', true),
  ('prohibido', 'xanax', 'medicamentos', 'Psicotrópico controlado (marca)', true),
  ('prohibido', 'tramadol', 'medicamentos', 'Opioide controlado', true),
  ('prohibido', 'morfina', 'medicamentos', 'Opioide controlado', true),
  ('prohibido', 'fentanilo', 'medicamentos', 'Opioide controlado', true),
  ('prohibido', 'oxicodona', 'medicamentos', 'Opioide controlado', true),
  ('prohibido', 'metadona', 'medicamentos', 'Opioide controlado', true),
  ('prohibido', 'ketamina', 'medicamentos', 'Anestésico controlado', true),
  ('prohibido', 'misoprostol', 'medicamentos', 'Medicamento de venta restringida', true),
  ('prohibido', 'pistola', 'armas', 'Arma de fuego', true),
  ('prohibido', 'revolver', 'armas', 'Arma de fuego', true),
  ('prohibido', 'escopeta', 'armas', 'Arma de fuego', true),
  ('prohibido', 'fusil', 'armas', 'Arma de fuego', true),
  ('prohibido', 'arma de fuego', 'armas', 'Arma de fuego', true),
  ('prohibido', 'municiones', 'armas', 'Municiones', true),
  ('prohibido', 'municion', 'armas', 'Municiones', true),
  ('prohibido', 'balas', 'armas', 'Municiones', true),
  ('prohibido', 'silenciador', 'armas', 'Accesorio de armas', true),
  ('prohibido', 'granada', 'armas', 'Explosivo', true),
  ('prohibido', 'replica', 'replicas', 'Réplica o falsificación de una marca', true),
  ('prohibido', 'imitacion', 'replicas', 'Imitación de una marca', true),
  ('prohibido', 'falsificado', 'replicas', 'Falsificación', true),
  ('prohibido', 'falsificada', 'replicas', 'Falsificación', true),
  ('prohibido', 'pirata', 'replicas', 'Copia no autorizada', true),
  ('prohibido', 'copia exacta', 'replicas', 'Copia de una marca', true),
  ('prohibido', 'calidad aaa', 'replicas', 'Réplica de una marca', true),
  ('prohibido', 'venta de dolares', 'divisas', 'Venta de divisas fuera del sistema cambiario', true),
  ('prohibido', 'vendo dolares', 'divisas', 'Venta de divisas', true),
  ('prohibido', 'compra de dolares', 'divisas', 'Compra de divisas', true),
  ('prohibido', 'cambio de divisas', 'divisas', 'Cambio de divisas', true),
  ('prohibido', 'venta de divisas', 'divisas', 'Venta de divisas', true),
  ('prohibido', 'dolares en efectivo', 'divisas', 'Venta de divisas en efectivo', true),
  ('prohibido', 'marihuana', 'drogas', 'Sustancia ilícita', true),
  ('prohibido', 'cocaina', 'drogas', 'Sustancia ilícita', true),
  ('prohibido', 'extasis', 'drogas', 'Sustancia ilícita', true),
  ('prohibido', 'fauna silvestre', 'fauna', 'Fauna silvestre protegida', true),
  ('prohibido', 'guacamaya', 'fauna', 'Ave protegida', true),
  ('prohibido', 'cunaguaro', 'fauna', 'Felino protegido', true),
  ('prohibido', 'tortuga arrau', 'fauna', 'Especie protegida', true),
  ('regulado', 'antibiotico', 'medicamentos', 'Se vende con récipe: el comercio debe ser una farmacia', true),
  ('regulado', 'amoxicilina', 'medicamentos', 'Antibiótico: con récipe', true),
  ('regulado', 'azitromicina', 'medicamentos', 'Antibiótico: con récipe', true),
  ('regulado', 'insulina', 'medicamentos', 'Cadena de frío y récipe', true),
  ('regulado', 'codeina', 'medicamentos', 'Medicamento con récipe', true),
  ('regulado', 'recipe', 'medicamentos', 'Producto que pide récipe', true),
  ('regulado', 'cannabis', 'drogas', 'Productos derivados: revisar su permiso', true),
  ('regulado', 'cbd', 'drogas', 'Productos derivados: revisar su permiso', true),
  ('regulado', 'airsoft', 'armas', 'Réplica de arma: revisar que no sea de fuego', true),
  ('regulado', 'gas pimienta', 'armas', 'Defensa personal: venta regulada', true),
  ('regulado', 'pirotecnia', 'otros', 'Pirotecnia: venta regulada', true),
  ('regulado', 'fuegos artificiales', 'otros', 'Pirotecnia: venta regulada', true),
  ('regulado', 'cigarrillo electronico', 'alcohol_tabaco', 'Solo para mayores de edad', true),
  ('regulado', 'vape', 'alcohol_tabaco', 'Solo para mayores de edad', true),
  ('regulado', 'bebida alcoholica', 'alcohol_tabaco', 'Solo para mayores de edad', true),
  ('regulado', 'licor', 'alcohol_tabaco', 'Solo para mayores de edad', true)
on conflict (patron, categoria) do nothing;

-- Marcas de un producto: automáticas (prohibido, regulado, precio anómalo,
-- duplicado) o por denuncias. Se resuelven descartándolas (falso positivo)
-- o confirmándolas (el producto se rechaza o se retira).
create table tumbo.moderacion_marcas (
  id          bigint generated always as identity primary key,
  sku         text not null,
  seller_id   text,
  tipo        text not null check (tipo in ('prohibido', 'regulado', 'precio_anomalo', 'duplicado', 'denuncia')),
  detalle     text not null check (char_length(detalle) <= 300),
  regla_id    bigint,
  estado      text not null default 'abierta' check (estado in ('abierta', 'descartada', 'confirmada')),
  creado      timestamptz not null default now(),
  resuelta_por text,
  resuelta_el timestamptz,
  nota        text check (nota is null or char_length(nota) <= 300)
);
create index moderacion_marcas_abiertas_idx on tumbo.moderacion_marcas (sku) where estado = 'abierta';
create index moderacion_marcas_sku_idx on tumbo.moderacion_marcas (sku, tipo, estado);
alter table tumbo.moderacion_marcas enable row level security;
revoke all on tumbo.moderacion_marcas from public, anon, authenticated;

-- Denuncias. La tabla es de Comunicación (migración 20261023150000, que en
-- el orden de los archivos se aplica antes que esta): quien la crea y la
-- llena es tm_denunciar. Si no existe (esta rama sola), se crea con su
-- mismo contrato, columna por columna y restricción por restricción:
-- tipo de lo denunciado ('producto', 'seller', 'pregunta', 'resena'), objeto
-- (el SKU, el comercio o el id), seller_id, motivo (código), detalle,
-- autor_id, estado 'abierta' | 'cerrada', resolución 'procede' |
-- 'no_procede' | 'duplicada', nota, cerrada_por y cerrada_en. Aquí solo se
-- atienden las de productos y comercios (las de preguntas y reseñas son de
-- la cola de contenido de Comunicación).
create table if not exists tumbo.denuncias (
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
create unique index if not exists denuncias_abierta_idx on tumbo.denuncias (autor_id, tipo, objeto) where estado = 'abierta';
create index if not exists denuncias_estado_idx on tumbo.denuncias (estado, creado);
create index if not exists denuncias_autor_idx on tumbo.denuncias (autor_id, creado);
alter table tumbo.denuncias enable row level security;
revoke all on tumbo.denuncias from public, anon, authenticated;
-- (las abiertas de un mismo objeto: las cuentan la cola y la marca)
create index denuncias_objeto_crec_idx on tumbo.denuncias (tipo, objeto) where estado = 'abierta';

-- El texto de un producto tal como lo leen las reglas.
create function tumbo_privado.texto_moderacion(p tumbo.productos) returns text
language sql stable set search_path = '' as $$
  select ' ' || tumbo_privado.normalizar(coalesce(p.nombre, '') || ' ' || coalesce(p.marca, '') || ' ' || coalesce(p.descripcion, '') || ' ' ||
    coalesce((select string_agg(e.value, ' ' order by e.key)
              from jsonb_each_text(case when jsonb_typeof(p.atributos) = 'object' then p.atributos else '{}'::jsonb end) e), '')) || ' '
$$;

-- Mediana del precio de lo publicado en cada categoría raíz y cuántos
-- productos la forman, guardada unos minutos: la consultan cada producto
-- que se envía a revisión (también los de una carga CSV) y la revisión de
-- lo publicado, sin recorrer la categoría entera por cada producto.
create table tumbo.moderacion_medianas (
  categoria text primary key check (char_length(categoria) <= 60),
  mediana   numeric,
  n         integer not null default 0,
  calculado timestamptz not null default now()
);
alter table tumbo.moderacion_medianas enable row level security;
revoke all on tumbo.moderacion_medianas from public, anon, authenticated;

create function tumbo_privado.mediana_categoria(p_raiz text) returns tumbo.moderacion_medianas
language plpgsql security definer set search_path = '' as $$
declare
  m tumbo.moderacion_medianas;
begin
  if p_raiz is null then
    return null;
  end if;
  select * into m from tumbo.moderacion_medianas where categoria = p_raiz;
  if found and m.calculado > now() - interval '10 minutes' then
    return m;
  end if;
  select p_raiz, percentile_cont(0.5) within group (order by x.precio_usd)::numeric, count(*)::integer, now() into m
  from tumbo.productos x left join tumbo.categorias kx on kx.id = x.categoria
  where x.estado = 'publicado' and coalesce(kx.padre, kx.id, x.categoria) = p_raiz;
  insert into tumbo.moderacion_medianas (categoria, mediana, n, calculado) values (m.categoria, m.mediana, m.n, m.calculado)
  on conflict (categoria) do update set mediana = excluded.mediana, n = excluded.n, calculado = excluded.calculado;
  return m;
end $$;

-- Los duplicados se buscan por el parecido del nombre normalizado, guardado
-- aquí con un índice de trigramas: sin recorrer todo el catálogo del
-- comercio ni normalizar cada nombre en cada búsqueda. Lo mantiene un
-- disparador sobre productos (sin clave foránea: el reinicio de la demo
-- vacía y reutiliza los SKU; lo que ya no existe no se cruza con productos).
create table tumbo.productos_nombres (
  sku         text primary key check (char_length(sku) <= 40),
  seller_id   text not null,
  nombre_norm text not null
);
create index productos_nombres_trgm_idx on tumbo.productos_nombres using gin (nombre_norm extensions.gin_trgm_ops) with (fastupdate = off);
create index productos_nombres_seller_idx on tumbo.productos_nombres (seller_id);
alter table tumbo.productos_nombres enable row level security;
revoke all on tumbo.productos_nombres from public, anon, authenticated;

create function tumbo_privado.producto_nombre_norm() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from tumbo.productos_nombres where sku = old.sku;
    return null;
  end if;
  insert into tumbo.productos_nombres (sku, seller_id, nombre_norm) values (new.sku, new.seller_id, tumbo_privado.normalizar(new.nombre))
  on conflict (sku) do update set seller_id = excluded.seller_id, nombre_norm = excluded.nombre_norm;
  return null;
end $$;

create trigger productos_nombre_norm after insert or update of nombre, seller_id or delete on tumbo.productos
  for each row execute function tumbo_privado.producto_nombre_norm();

insert into tumbo.productos_nombres (sku, seller_id, nombre_norm)
select p.sku, p.seller_id, tumbo_privado.normalizar(p.nombre) from tumbo.productos p
on conflict (sku) do nothing;

-- Evalúa un producto con las reglas: vuelve a calcular sus marcas
-- automáticas abiertas (palabras, precio anómalo frente a la mediana de su
-- categoría raíz y duplicados del mismo comercio). Devuelve cuántas quedaron.
create function tumbo_privado.moderacion_evaluar(p_sku text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p tumbo.productos;
  cfg jsonb := coalesce(tumbo_privado.ajuste('moderacion'), '{}'::jsonb);
  v_factor numeric := greatest(tumbo_privado.numero(cfg -> 'precio_factor', 4), 1.5);
  v_muestra numeric := tumbo_privado.numero(cfg -> 'precio_muestra_min', 3);
  v_sim numeric := least(greatest(tumbo_privado.numero(cfg -> 'duplicado_similitud', 0.85), 0.5), 1);
  v_texto text;
  v_raiz text;
  med tumbo.moderacion_medianas;
  v_mediana numeric;
  v_n integer;
  v_nombre text;
  v_umbral text;
  v_dup boolean;
  r record;
begin
  select * into p from tumbo.productos where sku = p_sku;
  if not found then
    return 0;
  end if;
  delete from tumbo.moderacion_marcas
  where sku = p_sku and estado = 'abierta' and tipo in ('prohibido', 'regulado', 'precio_anomalo', 'duplicado');
  -- (una marca que alguien ya descartó para el mismo texto no se repite)
  v_texto := tumbo_privado.texto_moderacion(p);
  select coalesce(k.padre, k.id, p.categoria) into v_raiz from tumbo.categorias k where k.id = p.categoria;
  v_raiz := coalesce(v_raiz, p.categoria);
  for r in
    select g.* from tumbo.moderacion_reglas g
    where g.activa and (g.categoria is null or g.categoria in (p.categoria, v_raiz))
      and position(' ' || g.patron || ' ' in v_texto) > 0
    order by g.tipo, g.id limit 6
  loop
    if not exists (select 1 from tumbo.moderacion_marcas m where m.sku = p.sku and m.regla_id = r.id and m.estado = 'descartada'
                   and m.resuelta_el >= p.actualizado) then
      insert into tumbo.moderacion_marcas (sku, seller_id, tipo, detalle, regla_id)
      values (p.sku, p.seller_id, r.tipo,
              left(case when r.tipo = 'prohibido' then 'Nombra un artículo prohibido: «' else 'Nombra un artículo regulado: «' end ||
                   r.patron || '»' || coalesce(' (' || r.descripcion || ')', ''), 300), r.id);
    end if;
  end loop;
  -- precio muy por debajo o por encima de la mediana de lo publicado en su
  -- categoría (la guardada; la muestra no cuenta al producto mismo)
  med := tumbo_privado.mediana_categoria(v_raiz);
  v_mediana := med.mediana;
  v_n := coalesce(med.n, 0) - case when p.estado = 'publicado' then 1 else 0 end;
  if v_n >= v_muestra and v_mediana > 0 and (p.precio_usd < v_mediana / v_factor or p.precio_usd > v_mediana * v_factor)
     and not exists (select 1 from tumbo.moderacion_marcas m where m.sku = p.sku and m.tipo = 'precio_anomalo' and m.estado = 'descartada'
                     and m.resuelta_el >= p.actualizado) then
    insert into tumbo.moderacion_marcas (sku, seller_id, tipo, detalle)
    values (p.sku, p.seller_id, 'precio_anomalo',
            'Precio ' || tumbo_privado.fmt_usd(p.precio_usd) || ' muy ' || case when p.precio_usd < v_mediana then 'por debajo' else 'por encima' end ||
            ' de la mediana de su categoría (' || tumbo_privado.fmt_usd(round(v_mediana::numeric, 2)) || ', ' || v_n || ' productos)');
  end if;
  -- un producto parecido del mismo comercio (que no es de la misma familia
  -- de variantes): el operador % de pg_trgm con el umbral del ajuste usa el
  -- índice de trigramas de los nombres normalizados (productos_nombres)
  v_nombre := tumbo_privado.normalizar(p.nombre);
  v_umbral := current_setting('pg_trgm.similarity_threshold', true);
  perform set_config('pg_trgm.similarity_threshold', v_sim::text, true);
  select x.sku, x.nombre, extensions.similarity(n.nombre_norm, v_nombre) as sim into r
  from tumbo.productos_nombres n join tumbo.productos x on x.sku = n.sku
  where n.nombre_norm operator(extensions.%) v_nombre and n.seller_id = p.seller_id and n.sku <> p.sku
    and x.seller_id = p.seller_id and x.estado in ('publicado', 'en_revision', 'pausado')
    and x.padre_sku is distinct from p.sku and p.padre_sku is distinct from x.sku
    and (p.padre_sku is null or x.padre_sku is distinct from p.padre_sku)
  order by 3 desc, x.sku limit 1;
  v_dup := found;
  perform set_config('pg_trgm.similarity_threshold', coalesce(nullif(v_umbral, ''), '0.3'), true);
  if v_dup and not exists (select 1 from tumbo.moderacion_marcas m where m.sku = p.sku and m.tipo = 'duplicado' and m.estado = 'descartada'
                           and m.resuelta_el >= p.actualizado) then
    insert into tumbo.moderacion_marcas (sku, seller_id, tipo, detalle)
    values (p.sku, p.seller_id, 'duplicado', left('Parece repetido de ' || r.sku || ' («' || r.nombre || '»)', 300));
  end if;
  return (select count(*) from tumbo.moderacion_marcas m where m.sku = p.sku and m.estado = 'abierta');
end $$;

-- Marcado automático al enviar a revisión (y al cambiar el contenido de un
-- producto en revisión). Nunca impide la operación del comercio.
create function tumbo_privado.producto_moderacion_auto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform tumbo_privado.moderacion_evaluar(new.sku);
  exception when others then
    raise warning 'Tumbo: la moderación automática de % falló: %', new.sku, sqlerrm;
  end;
  return null;
end $$;

create trigger productos_moderacion_auto
  after insert or update of estado, nombre, marca, descripcion, precio_usd, atributos on tumbo.productos
  for each row when (new.estado = 'en_revision') execute function tumbo_privado.producto_moderacion_auto();

-- Reglas en la decisión de moderación (tm_moderar_producto y
-- tm_moderar_lote pasan por tumbo_privado.moderar_producto, de Catálogo):
-- un producto con una marca de artículo prohibido abierta no sale de
-- revisión hacia la venta (hay que descartar antes la marca si es un
-- error); al salir de revisión, sus demás marcas abiertas quedan resueltas
-- (descartadas si se aprobó, confirmadas si se rechazó). Van como
-- disparadores para no redefinir moderar_producto (la integración de la ola
-- 1, que se aplica después en el orden de los archivos, la redefine).
create function tumbo_privado.producto_moderacion_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prohibido text;
begin
  if new.estado in ('publicado', 'pausado') then
    select string_agg(m.detalle, '; ' order by m.id) into v_prohibido
    from tumbo.moderacion_marcas m where m.sku = new.sku and m.estado = 'abierta' and m.tipo = 'prohibido';
    if v_prohibido is not null then
      raise exception 'El producto % tiene una marca de artículo prohibido (%): recházalo o, si es un error, descarta la marca en «Reglas y denuncias».',
        new.sku, left(v_prohibido, 200);
    end if;
  end if;
  return new;
end $$;

create trigger productos_moderacion_decision before update of estado on tumbo.productos
  for each row when (old.estado = 'en_revision' and new.estado in ('publicado', 'pausado'))
  execute function tumbo_privado.producto_moderacion_decision();

create function tumbo_privado.producto_moderacion_cierre() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario_en_curso();
begin
  update tumbo.moderacion_marcas
  set estado = case when new.estado = 'rechazado' then 'confirmada' else 'descartada' end,
      resuelta_por = coalesce(tumbo_privado.actor(u), 'Sistema'), resuelta_el = now(),
      nota = case when new.estado = 'rechazado' then 'Rechazado en moderación' else 'Aprobado en moderación' end
  where sku = new.sku and estado = 'abierta';
  return null;
end $$;

create trigger productos_moderacion_cierre after update of estado on tumbo.productos
  for each row when (old.estado = 'en_revision' and new.estado in ('publicado', 'pausado', 'rechazado'))
  execute function tumbo_privado.producto_moderacion_cierre();

-- Retira de la venta un producto publicado (o en revisión) por una regla o
-- una denuncia: queda «rechazado» con el motivo, que el comercio ve; si lo
-- corrige, vuelve a revisión. Una cuenta de prueba no retira productos de un
-- comercio real.
create function tumbo_privado.retirar_producto(p_yo tumbo.usuarios, p_sku text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v tumbo.productos := tumbo_privado.bloquear_producto(p_sku, p_yo);
begin
  perform tumbo_privado.exigir_cuenta_real(p_yo, tumbo_privado.seller_real(v.seller_id));
  if v.estado not in ('publicado', 'en_revision', 'pausado') then
    raise exception 'El producto % no está a la venta ni en revisión.', p_sku;
  end if;
  update tumbo.productos set estado = 'rechazado', motivo_rechazo = p_motivo, volver_a_pausa = (v.estado = 'pausado'), actualizado = now()
  where sku = p_sku;
  update tumbo.moderacion_marcas set estado = 'confirmada', resuelta_por = tumbo_privado.actor(p_yo), resuelta_el = now(), nota = 'Retirado de la venta'
  where sku = p_sku and estado = 'abierta';
  perform tumbo_privado.notificar('seller:' || v.seller_id, 'Retiramos de la venta tu producto ' || p_sku || ': ' || p_motivo, 'block',
                                  'seller/catalogo.html', array['seller', 'precios', 'operador']);
  perform tumbo_privado.auditar(p_yo, 'Producto retirado', p_sku || ' · ' || p_motivo);
end $$;

-- Quién modera aquí: el superadministrador, u Operaciones con «moderar».
create function tumbo_privado.exigir_moderador(p_sesion text, p_escritura boolean) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := case when p_escritura then tumbo_privado.exigir(p_sesion, array['superadmin', 'ops'])
                            else tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']) end;
begin
  perform tumbo_privado.exigir_permiso(yo, 'moderar');
  return yo;
end $$;

-- La revisión de lo publicado va por partes: cada llamada revisa hasta 200
-- productos (o lo que quepa en poco más de un segundo) desde donde quedó la
-- anterior, y la vista sigue llamando hasta terminar. Una sola corrida a la
-- vez (esta fila la serializa) y una llamada cada 3 segundos.
create table tumbo.moderacion_revision (
  id        smallint primary key default 1 check (id = 1),
  iniciada  timestamptz,
  terminada timestamptz,
  ultima    timestamptz,
  cursor    text not null default '',
  revisados integer not null default 0,
  marcados  integer not null default 0,
  total     integer not null default 0,
  por_id    uuid,
  por       text
);
alter table tumbo.moderacion_revision enable row level security;
revoke all on tumbo.moderacion_revision from public, anon, authenticated;
insert into tumbo.moderacion_revision (id) values (1) on conflict (id) do nothing;

-- Lo que muestra «Reglas y denuncias»: reglas, marcas abiertas con su
-- producto (de lo que está en revisión, publicado o pausado) y resumen.
create function public.tm_moderacion_panel(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_moderador(p_sesion, false);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  rv tumbo.moderacion_revision;
begin
  select * into rv from tumbo.moderacion_revision where id = 1;
  return jsonb_build_object(
    'reglas', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'tipo', g.tipo, 'patron', g.patron, 'grupo', g.grupo,
                                                            'descripcion', g.descripcion, 'categoria', g.categoria, 'activa', g.activa,
                                                            'sembrada', g.sembrada) order by g.tipo, g.grupo, g.patron)
                        from tumbo.moderacion_reglas g), '[]'::jsonb),
    'marcas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'sku', m.sku, 'tipo', m.tipo, 'detalle', m.detalle, 'creado', m.creado,
        'nombre', p.nombre, 'estado_producto', p.estado, 'precio_usd', p.precio_usd, 'categoria', p.categoria,
        'seller_id', p.seller_id, 'seller', s.nombre,
        'bloqueado', v_demo and tumbo_privado.seller_real(p.seller_id)) order by m.tipo = 'prohibido' desc, m.id)
      from tumbo.moderacion_marcas m join tumbo.productos p on p.sku = m.sku left join tumbo.sellers s on s.id = p.seller_id
      where m.estado = 'abierta' and p.estado in ('en_revision', 'publicado', 'pausado')), '[]'::jsonb),
    'denuncias_abiertas', (select count(*) from tumbo.denuncias d
                           where d.estado = 'abierta' and d.tipo in ('producto', 'seller') and tumbo_privado.denuncia_visible(yo, d)),
    'publicados', (select count(*) from tumbo.productos where estado = 'publicado'),
    'editable', not v_demo,
    'ultima_revision', rv.terminada,
    'revision', case when rv.iniciada is not null and rv.terminada is null
                     then jsonb_build_object('revisados', rv.revisados, 'marcados', rv.marcados, 'total', greatest(rv.total, rv.revisados),
                                             'iniciada', rv.iniciada, 'ultima', rv.ultima) end);
end $$;

-- Crea o edita una regla (datos = {id?, tipo, patron, grupo, descripcion,
-- categoria, activa}). Cambia la moderación de todos: sesión elevada.
create function public.tm_moderacion_regla(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_moderador(p_sesion, true);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_id bigint := tumbo_privado.num_json(d -> 'id')::bigint;
  v_patron text := tumbo_privado.normalizar(left(coalesce(d ->> 'patron', ''), 80));
  v_cat text := nullif(btrim(coalesce(d ->> 'categoria', '')), '');
  v_desc text := nullif(left(regexp_replace(btrim(coalesce(d ->> 'descripcion', '')), '[[:cntrl:]<>]+', ' ', 'g'), 200), '');
  g tumbo.moderacion_reglas;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if v_id is not null then
    select * into g from tumbo.moderacion_reglas where id = v_id for update;
    if not found then
      raise exception 'Regla no encontrada.';
    end if;
    update tumbo.moderacion_reglas
    set activa = coalesce((d ->> 'activa')::boolean, activa),
        descripcion = coalesce(v_desc, descripcion),
        tipo = case when d ->> 'tipo' in ('prohibido', 'regulado') then d ->> 'tipo' else tipo end
    where id = v_id returning * into g;
    perform tumbo_privado.auditar(yo, 'Regla de moderación cambiada', g.patron || ' · ' || g.tipo || case when g.activa then '' else ' (inactiva)' end);
    return to_jsonb(g);
  end if;
  if coalesce(d ->> 'tipo', '') not in ('prohibido', 'regulado') then
    raise exception 'Indica si es un artículo prohibido o regulado.';
  end if;
  if v_patron !~ '^[a-z0-9]+( [a-z0-9]+){0,5}$' or char_length(v_patron) not between 3 and 60 then
    raise exception 'La palabra o frase va de 3 a 60 letras o números (hasta 6 palabras).';
  end if;
  if coalesce(d ->> 'grupo', '') not in ('medicamentos', 'armas', 'replicas', 'divisas', 'drogas', 'fauna', 'alcohol_tabaco', 'otros') then
    raise exception 'Elige el grupo de la regla.';
  end if;
  if v_cat is not null and not exists (select 1 from tumbo.categorias where id = v_cat) then
    raise exception 'La categoría % no existe.', left(v_cat, 60);
  end if;
  if (select count(*) from tumbo.moderacion_reglas) >= 1000 then
    raise exception 'Hay 1.000 reglas: desactiva o edita alguna antes de agregar otra.';
  end if;
  insert into tumbo.moderacion_reglas (tipo, patron, grupo, descripcion, categoria, por)
  values (d ->> 'tipo', v_patron, d ->> 'grupo', v_desc, v_cat, tumbo_privado.actor(yo))
  on conflict (patron, categoria) do nothing returning * into g;
  if g.id is null then
    raise exception 'Ya hay una regla con «%».', v_patron;
  end if;
  perform tumbo_privado.auditar(yo, 'Regla de moderación agregada', g.patron || ' · ' || g.tipo || ' · ' || g.grupo);
  return to_jsonb(g);
end $$;

-- Resuelve una marca: «descartar» (era un error: no vuelve a salir para el
-- mismo contenido) o «confirmar» (queda como antecedente; para sacar el
-- producto de la venta, tm_moderacion_retirar).
create function public.tm_moderacion_marca(p_sesion text, p_id bigint, p_accion text, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_moderador(p_sesion, true);
  m tumbo.moderacion_marcas;
  v_nota text := nullif(left(regexp_replace(btrim(coalesce(p_nota, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300), '');
begin
  select * into m from tumbo.moderacion_marcas where id = p_id for update;
  if not found then
    raise exception 'Marca no encontrada.';
  end if;
  perform tumbo_privado.exigir_cuenta_real(yo, tumbo_privado.seller_real(m.seller_id));
  if m.estado <> 'abierta' then
    raise exception 'Esa marca ya se resolvió.';
  end if;
  if p_accion not in ('descartar', 'confirmar') then
    raise exception 'Elige descartar o confirmar la marca.';
  end if;
  if p_accion = 'descartar' and m.tipo = 'prohibido' and char_length(coalesce(v_nota, '')) < 5 then
    raise exception 'Para descartar una marca de artículo prohibido explica por qué (al menos 5 caracteres).';
  end if;
  update tumbo.moderacion_marcas
  set estado = case when p_accion = 'descartar' then 'descartada' else 'confirmada' end,
      resuelta_por = tumbo_privado.actor(yo), resuelta_el = now(), nota = v_nota
  where id = m.id;
  perform tumbo_privado.auditar(yo, case when p_accion = 'descartar' then 'Marca de moderación descartada' else 'Marca de moderación confirmada' end,
                                m.sku || ' · ' || m.tipo || ' · ' || m.detalle || coalesce(' · ' || v_nota, ''));
  return jsonb_build_object('ok', true);
end $$;

-- Revisa lo ya publicado con las reglas vigentes, por partes: cada llamada
-- sigue la corrida en curso (o empieza una, si la anterior terminó hace más
-- de un minuto) con hasta 200 productos en orden de SKU o lo que quepa en
-- 1,2 segundos, y dice cuánto lleva ({revisados, marcados, total, lote,
-- terminada}). Recorre el catálogo de todos: cuenta real del equipo con
-- sesión elevada, y una llamada cada 3 segundos.
create function public.tm_moderacion_revisar_publicados(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_moderador(p_sesion, true);
  rv tumbo.moderacion_revision;
  v_t0 timestamptz := clock_timestamp();
  v_sku text;
  v_ultimo text;
  v_n integer := 0;
  v_m integer := 0;
begin
  perform tumbo_privado.exigir_elevada(yo);
  insert into tumbo.moderacion_revision (id) values (1) on conflict (id) do nothing;
  select * into rv from tumbo.moderacion_revision where id = 1 for update;
  if rv.ultima is not null and rv.ultima > now() - interval '3 seconds' then
    raise exception 'La revisión de lo publicado va por partes: espera unos segundos antes de seguir.';
  end if;
  if rv.iniciada is null or rv.terminada is not null then
    if rv.terminada is not null and rv.terminada > now() - interval '1 minute' then
      raise exception 'La revisión de lo publicado terminó hace menos de un minuto: espera un momento.';
    end if;
    rv.iniciada := now();
    rv.terminada := null;
    rv.cursor := '';
    rv.revisados := 0;
    rv.marcados := 0;
    rv.total := (select count(*) from tumbo.productos where estado = 'publicado');
    rv.por_id := yo.id;
    rv.por := tumbo_privado.actor(yo);
  end if;
  for v_sku in select p.sku from tumbo.productos p where p.estado = 'publicado' and p.sku > rv.cursor order by p.sku limit 200 loop
    v_n := v_n + 1;
    v_ultimo := v_sku;
    if tumbo_privado.moderacion_evaluar(v_sku) > 0 then
      v_m := v_m + 1;
    end if;
    exit when clock_timestamp() - v_t0 > interval '1200 milliseconds';
  end loop;
  rv.cursor := coalesce(v_ultimo, rv.cursor);
  rv.revisados := rv.revisados + v_n;
  rv.marcados := rv.marcados + v_m;
  rv.ultima := now();
  if not exists (select 1 from tumbo.productos p where p.estado = 'publicado' and p.sku > rv.cursor) then
    rv.terminada := now();
    perform tumbo_privado.auditar(yo, 'Publicados revisados', rv.revisados || ' productos · ' || rv.marcados || ' con marcas');
  end if;
  update tumbo.moderacion_revision
  set iniciada = rv.iniciada, terminada = rv.terminada, ultima = rv.ultima, cursor = rv.cursor, revisados = rv.revisados,
      marcados = rv.marcados, total = rv.total, por_id = rv.por_id, por = rv.por
  where id = 1;
  return jsonb_build_object('revisados', rv.revisados, 'marcados', rv.marcados, 'total', greatest(rv.total, rv.revisados),
                            'lote', v_n, 'terminada', rv.terminada is not null);
end $$;

-- Retira de la venta hasta 100 productos (marcados o denunciados), cada uno
-- por separado, con el motivo que verá el comercio.
create function public.tm_moderacion_retirar(p_sesion text, p_skus text[], p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_moderador(p_sesion, true);
  v_motivo text := left(regexp_replace(btrim(coalesce(p_motivo, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
  v_sku text;
  v_hechos text[] := '{}';
  v_errores jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_skus), 0) = 0 then
    raise exception 'Elige al menos un producto.';
  end if;
  if cardinality(p_skus) > 100 then
    raise exception 'Retira hasta 100 productos por vez.';
  end if;
  if char_length(v_motivo) < 10 then
    raise exception 'Indica el motivo (al menos 10 caracteres): el comercio lo verá.';
  end if;
  for v_sku in select distinct s from unnest(p_skus) s where s is not null order by s loop
    begin
      perform tumbo_privado.retirar_producto(yo, v_sku, v_motivo);
      v_hechos := v_hechos || v_sku;
    exception when others then
      v_errores := v_errores || jsonb_build_object('sku', v_sku, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('hechos', to_jsonb(v_hechos), 'errores', v_errores);
end $$;

-- El comercio de una denuncia (el que guardó Comunicación o, si falta, el
-- del producto o el comercio denunciado).
create function tumbo_privado.denuncia_seller(d tumbo.denuncias) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(d.seller_id, case when d.tipo = 'seller' then d.objeto
                                    when d.tipo = 'producto' then (select p.seller_id from tumbo.productos p where p.sku = d.objeto) end)
$$;

-- ¿Es una denuncia de la demo? La hizo una cuenta de prueba y no es sobre un
-- comercio real. Una cuenta de prueba del equipo (contraseña pública) solo
-- ve y atiende esas: el detalle de una denuncia es texto libre de una
-- persona y suele llevar datos personales.
create function tumbo_privado.denuncia_de_prueba(d tumbo.denuncias) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tumbo.usuarios u where u.id = d.autor_id and tumbo_privado.cuenta_demo(u.email))
     and not coalesce(tumbo_privado.seller_real(tumbo_privado.denuncia_seller(d)), false)
$$;

create function tumbo_privado.denuncia_visible(p_yo tumbo.usuarios, d tumbo.denuncias) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce(tumbo_privado.cuenta_demo(p_yo.email), false) or tumbo_privado.denuncia_de_prueba(d)
$$;

-- Al llegar a las denuncias configuradas, un producto denunciado queda
-- marcado para moderación.
create function tumbo_privado.denuncia_marca() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_min numeric := tumbo_privado.numero(tumbo_privado.ajuste('moderacion') -> 'denuncias_marcar', 2);
  v_seller text;
  v_n integer;
begin
  begin
    if new.tipo = 'producto' and new.estado = 'abierta' then
      select seller_id into v_seller from tumbo.productos where sku = new.objeto;
      select count(*) into v_n from tumbo.denuncias d where d.tipo = 'producto' and d.objeto = new.objeto and d.estado = 'abierta';
      if v_seller is not null and v_n >= v_min
         and not exists (select 1 from tumbo.moderacion_marcas m where m.sku = new.objeto and m.tipo = 'denuncia' and m.estado = 'abierta') then
        insert into tumbo.moderacion_marcas (sku, seller_id, tipo, detalle)
        values (new.objeto, v_seller, 'denuncia', v_n || ' denuncias abiertas (la última por «' || new.motivo || '»)');
      end if;
    end if;
  exception when others then
    raise warning 'Tumbo: no se pudo marcar la denuncia %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger denuncias_marca after insert on tumbo.denuncias
  for each row execute function tumbo_privado.denuncia_marca();

-- Cerrada la última denuncia abierta de un producto (aquí o en la cola de
-- contenido de Comunicación), su marca se resuelve con esa decisión:
-- confirmada si procede, descartada si no.
create function tumbo_privado.denuncia_marca_cierre() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if not exists (select 1 from tumbo.denuncias d where d.tipo = 'producto' and d.objeto = new.objeto and d.estado = 'abierta') then
      update tumbo.moderacion_marcas
      set estado = case when new.resolucion = 'procede' then 'confirmada' else 'descartada' end,
          resuelta_por = coalesce(new.cerrada_por, 'Sistema'), resuelta_el = now(), nota = 'Denuncias cerradas'
      where sku = new.objeto and tipo = 'denuncia' and estado = 'abierta';
    end if;
  exception when others then
    raise warning 'Tumbo: no se pudo cerrar la marca de la denuncia %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger denuncias_marca_cierre after update of estado on tumbo.denuncias
  for each row when (old.estado = 'abierta' and new.estado = 'cerrada' and new.tipo = 'producto')
  execute function tumbo_privado.denuncia_marca_cierre();

-- Cola de denuncias de productos y comercios (estado: 'abiertas',
-- 'resueltas' —las cerradas— o 'todas'). A una cuenta de prueba solo le
-- llegan las de la demo (denuncia_de_prueba); quien denunció nunca se
-- nombra.
create function public.tm_denuncias(p_sesion text, p_estado text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_moderador(p_sesion, false);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
begin
  return coalesce((select jsonb_agg(x order by (x ->> 'estado') = 'abierta' desc, (x ->> 'id')::bigint desc) from (
    select jsonb_build_object(
      'id', d.id, 'tipo', d.tipo, 'objeto', d.objeto, 'motivo', d.motivo, 'detalle', d.detalle, 'estado', d.estado,
      'resolucion', d.resolucion, 'nota', d.nota, 'cerrada_por', case when v_demo then null else d.cerrada_por end,
      'cerrada_en', d.cerrada_en, 'creado', d.creado,
      'denunciante', (select case when u.rol = 'comprador' then 'Comprador' else 'Comercio' end from tumbo.usuarios u where u.id = d.autor_id),
      'repetidas', (select count(*) from tumbo.denuncias d2 where d2.tipo = d.tipo and d2.objeto = d.objeto and d2.estado = 'abierta'),
      'producto', case when d.tipo = 'producto' then (select jsonb_build_object('sku', p.sku, 'nombre', p.nombre, 'estado', p.estado,
                                                                                'seller_id', p.seller_id, 'precio_usd', p.precio_usd)
                                                      from tumbo.productos p where p.sku = d.objeto) end,
      'seller', (select jsonb_build_object('id', s.id, 'nombre', s.nombre) from tumbo.sellers s where s.id = tumbo_privado.denuncia_seller(d)),
      'bloqueado', false
    ) as x
    from tumbo.denuncias d
    where d.tipo in ('producto', 'seller')
      and case coalesce(p_estado, 'abiertas')
            when 'abiertas' then d.estado = 'abierta'
            when 'resueltas' then d.estado = 'cerrada'
            else true end
      and tumbo_privado.denuncia_visible(yo, d)
    order by d.id desc limit 300) q), '[]'::jsonb);
end $$;

-- Acciones sobre una denuncia de un producto o un comercio: 'descartar'
-- (no procede), 'duplicada', 'resolver' (procede, sin retirar nada) o
-- 'retirar' (retira el producto denunciado y cierra, como procedentes,
-- todas sus denuncias abiertas). Siempre con nota; quien denunció recibe el
-- mismo aviso que con el cierre de Comunicación (tm_denuncia_cerrar).
create function public.tm_denuncia_resolver(p_sesion text, p_id bigint, p_accion text, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_moderador(p_sesion, true);
  d tumbo.denuncias;
  x tumbo.denuncias;
  v_nota text := left(regexp_replace(btrim(coalesce(p_nota, '')), '[[:cntrl:]<>]+', ' ', 'g'), 600);
  v_res text;
  v_por text := yo.nombre || ' (' || yo.rol || ')';
begin
  select * into d from tumbo.denuncias where id = p_id for update;
  if not found or d.tipo not in ('producto', 'seller') then
    raise exception 'Denuncia no encontrada.';
  end if;
  perform tumbo_privado.exigir_cuenta_real(yo, not tumbo_privado.denuncia_de_prueba(d));
  if d.estado <> 'abierta' then
    raise exception 'Esa denuncia ya está cerrada.';
  end if;
  if p_accion is null or p_accion not in ('descartar', 'duplicada', 'resolver', 'retirar') then
    raise exception 'Elige una acción para la denuncia.';
  end if;
  if char_length(v_nota) < 5 then
    raise exception 'Escribe una nota (al menos 5 caracteres).';
  end if;
  v_res := case p_accion when 'descartar' then 'no_procede' when 'duplicada' then 'duplicada' else 'procede' end;
  if p_accion = 'retirar' then
    if d.tipo <> 'producto' then
      raise exception 'Solo se retira un producto denunciado.';
    end if;
    if exists (select 1 from tumbo.productos where sku = d.objeto and estado in ('publicado', 'en_revision', 'pausado')) then
      perform tumbo_privado.retirar_producto(yo, d.objeto, 'Retirado por denuncias: ' || left(v_nota, 250));
    end if;
  end if;
  for x in
    update tumbo.denuncias set estado = 'cerrada', resolucion = v_res, nota = v_nota, cerrada_por = v_por, cerrada_en = now()
    where estado = 'abierta' and (id = d.id or (p_accion = 'retirar' and tipo = 'producto' and objeto = d.objeto))
    returning *
  loop
    if x.autor_id is not null then
      perform tumbo_privado.notificar('usr:' || x.autor_id, 'Revisamos tu reporte #' || x.id || ': ' ||
        case v_res when 'procede' then 'tomamos medidas, gracias por avisar' when 'duplicada' then 'ya lo estábamos atendiendo'
                   else 'no encontramos una infracción' end, 'flag', null);
    end if;
  end loop;
  perform tumbo_privado.auditar(yo, case p_accion when 'retirar' then 'Denuncia cerrada (producto retirado)' else 'Denuncia cerrada' end,
                                '#' || d.id || ' ' || d.tipo || ' ' || d.objeto || ' → ' || v_res || ' · ' || v_nota);
  return jsonb_build_object('ok', true, 'resolucion', v_res);
end $$;

-- ---------------------------------------------------------------------------
-- Sanciones de los comercios
-- ---------------------------------------------------------------------------
-- advertencia (queda como antecedente y cuenta para los niveles mientras
-- dura), limitar_publicaciones (tope de productos activos: publicados o en
-- revisión) y retener_fondos (sus liquidaciones no se preparan: la
-- consulta de Pagos, retencion_seller, la incluye). Siempre con motivo.
create table tumbo.sanciones (
  id               bigint generated always as identity primary key,
  seller_id        text not null check (char_length(seller_id) <= 30),
  tipo             text not null check (tipo in ('advertencia', 'limitar_publicaciones', 'retener_fondos')),
  motivo           text not null check (char_length(motivo) between 10 and 500),
  limite           integer check (limite is null or limite between 0 and 500),
  desde            timestamptz not null default now(),
  hasta            timestamptz,
  activa           boolean not null default true,
  por_id           uuid,
  por              text not null,
  levantada_por    text,
  levantada_el     timestamptz,
  nota             text check (nota is null or char_length(nota) <= 300),
  check (hasta is null or hasta > desde),
  check ((tipo = 'limitar_publicaciones') = (limite is not null))
);
create index sanciones_seller_idx on tumbo.sanciones (seller_id) where activa;
alter table tumbo.sanciones enable row level security;
revoke all on tumbo.sanciones from public, anon, authenticated;

create function tumbo_privado.sancion_vigente(s tumbo.sanciones) returns boolean
language sql stable set search_path = '' as $$
  select s.activa and s.desde <= now() and (s.hasta is null or s.hasta > now())
$$;

-- Contrato para Pagos: el motivo de una sanción de retener fondos vigente,
-- o null. seller_retenido(seller) lo dice en sí o no.
create function tumbo_privado.sancion_retencion(p_seller text) returns text
language sql stable security definer set search_path = '' as $$
  select s.motivo from tumbo.sanciones s
  where s.seller_id = p_seller and s.tipo = 'retener_fondos' and tumbo_privado.sancion_vigente(s)
  order by s.desde desc, s.id desc limit 1
$$;

create function tumbo_privado.seller_retenido(p_seller text) returns boolean
language sql stable security definer set search_path = '' as $$
  select tumbo_privado.sancion_retencion(p_seller) is not null
$$;

-- (retencion_seller, de Pagos, suma la sanción más abajo: después de
-- seller_lista_negra, que también consulta.)

-- Limitar publicaciones: el equipo del comercio no publica ni envía a
-- revisión más productos que el tope de la sanción (lo que hace el equipo de
-- Tumbo o el reinicio de la demo no se limita).
create function tumbo_privado.producto_limite_sancion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ses text := nullif(current_setting('tumbo.sesion_actual', true), '');
  s tumbo.sanciones;
  v_seller_yo text;
  v_n integer;
begin
  if v_ses is null or (tg_op = 'UPDATE' and old.estado in ('en_revision', 'publicado')) then
    return new;
  end if;
  select x.* into s from tumbo.sanciones x
  where x.seller_id = new.seller_id and x.tipo = 'limitar_publicaciones' and tumbo_privado.sancion_vigente(x)
  order by x.limite, x.id limit 1;
  if not found then
    return new;
  end if;
  select u.seller_id into v_seller_yo
  from tumbo.sesiones ss join tumbo.usuarios u on u.id = ss.usuario_id
  where ss.token_hash = decode(v_ses, 'hex') and u.rol in ('seller', 'precios', 'operador');
  if v_seller_yo is distinct from new.seller_id then
    return new;
  end if;
  select count(*) into v_n from tumbo.productos p
  where p.seller_id = new.seller_id and p.estado in ('en_revision', 'publicado') and p.sku <> new.sku;
  if v_n >= s.limite then
    raise exception 'Tu comercio tiene las publicaciones limitadas a % producto(s) activo(s) por una sanción (%): pausa otros antes de publicar o enviar a revisión.',
      s.limite, s.motivo;
  end if;
  return new;
end $$;

create trigger productos_sancion_limite before insert or update of estado on tumbo.productos
  for each row when (new.estado in ('en_revision', 'publicado')) execute function tumbo_privado.producto_limite_sancion();

-- Aplica una sanción: datos = {limite (para limitar publicaciones), dias
-- (vigencia; la advertencia, 90 por omisión)}. Superadministrador con
-- sesión elevada (las cuentas de prueba nunca sancionan).
create function public.tm_sancion_aplicar(p_sesion text, p_seller text, p_tipo text, p_motivo text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_motivo text := left(regexp_replace(btrim(coalesce(p_motivo, '')), '[[:cntrl:]<>]+', ' ', 'g'), 500);
  v_dias numeric := tumbo_privado.num_json(d -> 'dias');
  v_limite numeric := tumbo_privado.num_json(d -> 'limite');
  v_hasta timestamptz;
  s tumbo.sanciones;
begin
  perform tumbo_privado.exigir_elevada(yo);
  if not exists (select 1 from tumbo.sellers where id = p_seller) then
    raise exception 'Comercio % no encontrado.', left(coalesce(p_seller, ''), 30);
  end if;
  if p_tipo not in ('advertencia', 'limitar_publicaciones', 'retener_fondos') then
    raise exception 'Elige el tipo de sanción.';
  end if;
  if char_length(v_motivo) < 10 then
    raise exception 'Explica el motivo de la sanción (al menos 10 caracteres): el comercio lo verá.';
  end if;
  if v_dias is not null and (v_dias <> trunc(v_dias) or v_dias not between 1 and 365) then
    raise exception 'La vigencia va de 1 a 365 días.';
  end if;
  if p_tipo = 'advertencia' then
    v_dias := coalesce(v_dias, 90);
  end if;
  if p_tipo = 'limitar_publicaciones' then
    v_limite := coalesce(v_limite, 5);
    if v_limite <> trunc(v_limite) or v_limite not between 0 and 500 then
      raise exception 'El tope de productos activos va de 0 a 500.';
    end if;
  else
    v_limite := null;
  end if;
  if (select count(*) from tumbo.sanciones x where x.seller_id = p_seller and tumbo_privado.sancion_vigente(x)) >= 10 then
    raise exception 'Ese comercio ya tiene 10 sanciones vigentes.';
  end if;
  v_hasta := case when v_dias is not null then now() + make_interval(days => v_dias::integer) end;
  insert into tumbo.sanciones (seller_id, tipo, motivo, limite, hasta, por_id, por)
  values (p_seller, p_tipo, v_motivo, v_limite::integer, v_hasta, yo.id, tumbo_privado.actor(yo))
  returning * into s;
  perform tumbo_privado.notificar('seller:' || p_seller,
    case p_tipo when 'advertencia' then 'Recibiste una advertencia de Tumbo: ' || v_motivo
                when 'limitar_publicaciones' then 'Tus publicaciones quedan limitadas a ' || v_limite || ' productos activos: ' || v_motivo
                else 'Tus liquidaciones quedan retenidas por una sanción: ' || v_motivo end,
    case p_tipo when 'retener_fondos' then 'lock' else 'gpp_maybe' end,
    case p_tipo when 'retener_fondos' then 'seller/finanzas.html' else 'seller/panel.html' end);
  if p_tipo = 'retener_fondos' then
    perform tumbo_privado.notificar('rol:finanzas', 'Fondos de ' || p_seller || ' retenidos por una sanción: ' || v_motivo, 'lock', 'admin/liquidaciones.html');
  end if;
  perform tumbo_privado.auditar(yo, 'Sanción aplicada', p_seller || ' · ' || p_tipo ||
    coalesce(' (tope ' || v_limite || ')', '') || coalesce(' hasta ' || to_char(v_hasta at time zone 'America/Caracas', 'DD/MM/YYYY'), '') ||
    ' · ' || v_motivo);
  return to_jsonb(s);
end $$;

create function public.tm_sancion_levantar(p_sesion text, p_id bigint, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  s tumbo.sanciones;
  v_nota text := left(regexp_replace(btrim(coalesce(p_nota, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
begin
  perform tumbo_privado.exigir_elevada(yo);
  select * into s from tumbo.sanciones where id = p_id for update;
  if not found then
    raise exception 'Sanción no encontrada.';
  end if;
  if not s.activa then
    raise exception 'Esa sanción ya se levantó.';
  end if;
  if char_length(v_nota) < 5 then
    raise exception 'Explica por qué se levanta (al menos 5 caracteres).';
  end if;
  update tumbo.sanciones set activa = false, levantada_por = tumbo_privado.actor(yo), levantada_el = now(), nota = v_nota where id = s.id;
  perform tumbo_privado.notificar('seller:' || s.seller_id, 'Se levantó una sanción de tu comercio (' ||
    case s.tipo when 'advertencia' then 'advertencia' when 'limitar_publicaciones' then 'publicaciones limitadas' else 'fondos retenidos' end || ')',
    'lock_open', 'seller/panel.html');
  perform tumbo_privado.auditar(yo, 'Sanción levantada', s.seller_id || ' · ' || s.tipo || ' · ' || v_nota);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Niveles automáticos de los comercios (tipo MercadoLíder)
-- ---------------------------------------------------------------------------
create table tumbo.niveles_seller (
  seller_id  text primary key check (char_length(seller_id) <= 30),
  nivel      text,
  metricas   jsonb not null default '{}'::jsonb,
  calculado  timestamptz not null default now(),
  desde      timestamptz
);
alter table tumbo.niveles_seller enable row level security;
revoke all on tumbo.niveles_seller from public, anon, authenticated;

-- Lo que miden los niveles en la ventana: ventas entregadas, monto vendido,
-- cancelaciones atribuibles al comercio, reclamos perdidos y despachos a
-- tiempo (las de Logística, envio_metricas).
create function tumbo_privado.metricas_nivel(p_seller text, p_dias integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e jsonb := tumbo_privado.envio_metricas(p_seller, p_dias);
  v_ventas integer;
  v_gmv numeric;
  v_perdidas integer;
  v_resueltas integer;
begin
  select count(distinct p.id), coalesce(sum(i.precio_usd * i.cant), 0)
    into v_ventas, v_gmv
  from tumbo.pedidos p left join tumbo.pedido_items i on i.pedido_id = p.id
  where p.seller_id = p_seller and p.estado in ('entregado', 'cerrado') and p.creado > now() - make_interval(days => p_dias);
  select count(*) filter (where d.resolucion_decision in ('reembolso', 'devolucion')), count(*)
    into v_perdidas, v_resueltas
  from tumbo.disputas d
  where d.seller_id = p_seller and d.estado = 'resuelta' and d.creado > now() - make_interval(days => p_dias);
  return jsonb_build_object(
    'dias', p_dias, 'ventas', v_ventas, 'gmv_usd', round(v_gmv, 2),
    'pedidos', (e ->> 'pedidos')::integer,
    'cancelacion_pct', case when (e ->> 'pedidos')::integer > 0
                            then round(100.0 * (e ->> 'cancelaciones_seller')::integer / (e ->> 'pedidos')::integer, 1) else 0 end,
    'disputas_perdidas', v_perdidas,
    'disputas_perdidas_pct', case when v_ventas + v_perdidas > 0 then round(100.0 * v_perdidas / (v_ventas + v_perdidas), 1) else 0 end,
    'despachados', (e ->> 'despachados')::integer,
    'a_tiempo_pct', case when (e ->> 'despachados')::integer > 0
                         then round(100.0 * (e ->> 'despachados_a_tiempo')::integer / (e ->> 'despachados')::integer, 1) end,
    'aceptacion_sla_pct', case when (e ->> 'aceptados')::integer > 0
                               then round(100.0 * (e ->> 'aceptados_a_tiempo')::integer / (e ->> 'aceptados')::integer, 1) end,
    'kyc_verificado', coalesce((select s.kyc_verificado from tumbo.sellers s where s.id = p_seller), false),
    'sanciones', (select count(*) from tumbo.sanciones x where x.seller_id = p_seller and tumbo_privado.sancion_vigente(x)));
end $$;

-- El nivel que corresponde (el más alto cuyos requisitos cumple) y lo que
-- falta para el siguiente: {nivel, nombre, siguiente, faltan[]}.
create function tumbo_privado.nivel_evaluar(p_seller text, p_m jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := coalesce(tumbo_privado.ajuste('niveles'), '{}'::jsonb);
  n jsonb;
  v_estado text := (select s.estado from tumbo.sellers s where s.id = p_seller);
  v_base text[] := '{}';
  v_faltan text[];
  v_nivel jsonb;
  v_siguiente jsonb;
  v_faltan_sig text[];
begin
  if v_estado is distinct from 'aprobado' then
    v_base := v_base || 'el comercio debe estar homologado'::text;
  end if;
  if coalesce((cfg ->> 'requiere_kyc')::boolean, true) and not coalesce((p_m ->> 'kyc_verificado')::boolean, false) then
    v_base := v_base || 'el expediente debe estar verificado (insignia «Verificado por Tumbo»)'::text;
  end if;
  if coalesce((p_m ->> 'sanciones')::integer, 0) > 0 then
    v_base := v_base || 'sin sanciones vigentes'::text;
  end if;
  for n in select x from jsonb_array_elements(case when jsonb_typeof(cfg -> 'niveles') = 'array' then cfg -> 'niveles' else '[]'::jsonb end) x
           order by tumbo_privado.num_json(x -> 'ventas_min'), tumbo_privado.num_json(x -> 'gmv_min_usd') loop
    v_faltan := v_base;
    if (p_m ->> 'ventas')::numeric < tumbo_privado.num_json(n -> 'ventas_min') then
      v_faltan := v_faltan || (((n ->> 'ventas_min')::numeric - (p_m ->> 'ventas')::numeric) || ' ventas entregadas más');
    end if;
    if (p_m ->> 'gmv_usd')::numeric < tumbo_privado.num_json(n -> 'gmv_min_usd') then
      v_faltan := v_faltan || ('vender ' || tumbo_privado.fmt_usd(tumbo_privado.num_json(n -> 'gmv_min_usd') - (p_m ->> 'gmv_usd')::numeric) || ' más');
    end if;
    if (p_m ->> 'cancelacion_pct')::numeric > tumbo_privado.num_json(n -> 'cancelacion_max_pct') then
      v_faltan := v_faltan || ('cancelaciones hasta ' || (n ->> 'cancelacion_max_pct') || ' %');
    end if;
    if (p_m ->> 'disputas_perdidas_pct')::numeric > tumbo_privado.num_json(n -> 'disputas_perdidas_max_pct') then
      v_faltan := v_faltan || ('reclamos perdidos hasta ' || (n ->> 'disputas_perdidas_max_pct') || ' %');
    end if;
    if coalesce((p_m ->> 'a_tiempo_pct')::numeric, 0) < tumbo_privado.num_json(n -> 'a_tiempo_min_pct') then
      v_faltan := v_faltan || ('despachos a tiempo desde ' || (n ->> 'a_tiempo_min_pct') || ' %');
    end if;
    if cardinality(v_faltan) = 0 then
      v_nivel := n;
    elsif v_siguiente is null then
      v_siguiente := n;
      v_faltan_sig := v_faltan;
    end if;
  end loop;
  return jsonb_build_object('nivel', v_nivel ->> 'id', 'nombre', v_nivel ->> 'nombre',
                            'descuento_comision_pts', tumbo_privado.num_json(v_nivel -> 'descuento_comision_pts'),
                            'siguiente', v_siguiente ->> 'nombre', 'faltan', to_jsonb(coalesce(v_faltan_sig, '{}'::text[])));
end $$;

-- Recalcula el nivel de cada comercio; si cambia el nivel o el beneficio
-- que da (el ajuste «niveles» cambió), cierra la fila de comisión del
-- beneficio anterior, abre la del nuevo (tumbo.comisiones, origen «nivel»)
-- y le avisa al comercio. Tarea diaria (pg_cron, si existe).
create function tumbo_privado.tarea_niveles() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := coalesce(tumbo_privado.ajuste('niveles'), '{}'::jsonb);
  v_dias integer := least(greatest(coalesce(tumbo_privado.num_json(cfg -> 'ventana_dias'), 90), 30), 365)::integer;
  s record;
  m jsonb;
  ev jsonb;
  ant tumbo.niveles_seller;
  v_pts_ant numeric;
  v_pts numeric;
  v_cambios jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('tumbo:niveles', 0));
  for s in select x.id from tumbo.sellers x
           where x.estado = 'aprobado' or exists (select 1 from tumbo.niveles_seller n where n.seller_id = x.id and n.nivel is not null)
              or exists (select 1 from tumbo.comisiones c where c.seller_id = x.id and c.origen = 'nivel' and c.estado = 'vigente'
                         and (c.hasta is null or c.hasta > now()))
           order by x.id loop
    v_n := v_n + 1;
    m := tumbo_privado.metricas_nivel(s.id, v_dias);
    ev := tumbo_privado.nivel_evaluar(s.id, m);
    select * into ant from tumbo.niveles_seller where seller_id = s.id for update;
    -- el beneficio que rige hoy y el que corresponde (sin nivel, ninguno)
    select c.descuento_pts into v_pts_ant from tumbo.comisiones c
    where c.seller_id = s.id and c.origen = 'nivel' and c.estado = 'vigente' and c.desde <= now() and (c.hasta is null or c.hasta > now())
    order by c.desde desc, c.id desc limit 1;
    v_pts := case when ev ->> 'nivel' is not null then least(coalesce(tumbo_privado.num_json(ev -> 'descuento_comision_pts'), 0), 10) else 0 end;
    insert into tumbo.niveles_seller (seller_id, nivel, metricas, calculado, desde)
    values (s.id, ev ->> 'nivel', m || jsonb_build_object('evaluacion', ev), now(), case when ev ->> 'nivel' is not null then now() end)
    on conflict (seller_id) do update
      set nivel = excluded.nivel, metricas = excluded.metricas, calculado = now(),
          desde = case when tumbo.niveles_seller.nivel is not distinct from excluded.nivel then tumbo.niveles_seller.desde else excluded.desde end;
    if ant.nivel is not distinct from (ev ->> 'nivel') and coalesce(v_pts_ant, 0) <> v_pts then
      -- mismo nivel, otro beneficio: se cambia la fila y se avisa
      update tumbo.comisiones set estado = 'anulada'
      where seller_id = s.id and origen = 'nivel' and estado = 'vigente' and desde >= now();
      update tumbo.comisiones set hasta = now()
      where seller_id = s.id and origen = 'nivel' and estado = 'vigente' and desde < now() and (hasta is null or hasta > now());
      if v_pts > 0 then
        insert into tumbo.comisiones (seller_id, descuento_pts, desde, origen, estado, motivo, propuesta_nombre, aprobada_nombre, aprobada_el)
        values (s.id, v_pts, now(), 'nivel', 'vigente', 'Beneficio del nivel ' || (ev ->> 'nombre'), 'Sistema', 'Sistema (niveles)', now());
      end if;
      perform tumbo_privado.notificar('seller:' || s.id,
        'Cambió el beneficio de tu nivel ' || coalesce(ev ->> 'nombre', '') || ': ahora pagas ' || v_pts || ' puntos menos de comisión',
        'workspace_premium', 'seller/estadisticas.html');
      v_cambios := v_cambios || jsonb_build_object('seller', s.id, 'antes', ant.nivel, 'ahora', ev ->> 'nivel', 'beneficio_antes', coalesce(v_pts_ant, 0),
                                                   'beneficio', v_pts);
    elsif ant.nivel is distinct from (ev ->> 'nivel') then
      update tumbo.comisiones set estado = 'anulada'
      where seller_id = s.id and origen = 'nivel' and estado = 'vigente' and desde >= now();
      update tumbo.comisiones set hasta = now()
      where seller_id = s.id and origen = 'nivel' and estado = 'vigente' and desde < now() and (hasta is null or hasta > now());
      if v_pts > 0 then
        insert into tumbo.comisiones (seller_id, descuento_pts, desde, origen, estado, motivo, propuesta_nombre, aprobada_nombre, aprobada_el)
        values (s.id, v_pts, now(), 'nivel', 'vigente', 'Beneficio del nivel ' || (ev ->> 'nombre'), 'Sistema', 'Sistema (niveles)', now());
      end if;
      perform tumbo_privado.notificar('seller:' || s.id,
        case when ev ->> 'nivel' is null then 'Tu comercio ya no tiene nivel: revisa en Estadísticas lo que falta para recuperarlo'
             else 'Tu comercio ahora es ' || (ev ->> 'nombre') || coalesce(': pagas ' || (ev ->> 'descuento_comision_pts') || ' puntos menos de comisión', '') end,
        'workspace_premium', 'seller/estadisticas.html');
      v_cambios := v_cambios || jsonb_build_object('seller', s.id, 'antes', ant.nivel, 'ahora', ev ->> 'nivel');
    end if;
  end loop;
  if jsonb_array_length(v_cambios) > 0 then
    perform tumbo_privado.auditar(null::tumbo.usuarios, 'Niveles recalculados', v_n || ' comercios · ' || jsonb_array_length(v_cambios) || ' cambios: ' ||
      left((select string_agg((c ->> 'seller') || ' ' || coalesce(c ->> 'antes', '—') || '→' || coalesce(c ->> 'ahora', '—'), ', ')
            from jsonb_array_elements(v_cambios) c), 300));
  end if;
  return jsonb_build_object('revisados', v_n, 'cambios', v_cambios);
end $$;

-- Recalcula a pedido (una vez por minuto).
create function public.tm_niveles_recalcular(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin']);
  r jsonb;
begin
  -- cambia comisiones (los descuentos por nivel): cuenta real con sesión elevada
  perform tumbo_privado.exigir_elevada(yo);
  if exists (select 1 from tumbo.niveles_seller where calculado > now() - interval '1 minute') then
    raise exception 'Los niveles se recalcularon hace menos de un minuto.';
  end if;
  r := tumbo_privado.tarea_niveles();
  perform tumbo_privado.auditar(yo, 'Niveles recalculados a pedido', (r ->> 'revisados') || ' comercios · ' || jsonb_array_length(r -> 'cambios') || ' cambios');
  return r;
end $$;

-- Los niveles vigentes (públicos: la insignia en la ficha y la tienda).
create function public.tm_niveles_publicos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(n.seller_id, jsonb_build_object('nivel', n.nivel,
           'nombre', (select x ->> 'nombre' from jsonb_array_elements(coalesce(tumbo_privado.ajuste('niveles') -> 'niveles', '[]'::jsonb)) x
                      where x ->> 'id' = n.nivel limit 1))), '{}'::jsonb)
  from tumbo.niveles_seller n join tumbo.sellers s on s.id = n.seller_id
  where n.nivel is not null and s.estado = 'aprobado'
$$;

-- ---------------------------------------------------------------------------
-- Notas internas de las fichas 360 (nunca las ve el comercio ni el comprador)
-- ---------------------------------------------------------------------------
create table tumbo.notas_internas (
  id         bigint generated always as identity primary key,
  entidad    text not null check (entidad in ('seller', 'comprador')),
  entidad_id text not null check (char_length(entidad_id) <= 60),
  texto      text not null check (char_length(texto) between 3 and 1000),
  autor_id   uuid,
  autor      text not null,
  creado     timestamptz not null default now()
);
create index notas_internas_idx on tumbo.notas_internas (entidad, entidad_id, id desc);
alter table tumbo.notas_internas enable row level security;
revoke all on tumbo.notas_internas from public, anon, authenticated;

create function tumbo_privado.notas_json(p_yo tumbo.usuarios, p_entidad text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'texto', n.texto, 'autor', tumbo_privado.firma_visible(p_yo, n.autor_id, n.autor),
                                                       'creado', n.creado) order by n.id desc), '[]'::jsonb)
          from (select * from tumbo.notas_internas x where x.entidad = p_entidad and x.entidad_id = p_id order by x.id desc limit 100) n
          where tumbo_privado.auditoria_visible(p_yo, n.autor_id));
end $$;

-- Agrega una nota a la ficha de un comercio (superadmin, ops, finanzas) o de
-- un comprador (quien lo ve en la administración de usuarios).
create function public.tm_ficha_nota(p_sesion text, p_entidad text, p_id text, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops', 'finanzas']);
  v_texto text := left(regexp_replace(btrim(coalesce(p_texto, '')), '[[:cntrl:]<>]+', ' ', 'g'), 1000);
  u tumbo.usuarios;
begin
  if p_entidad = 'seller' then
    if not exists (select 1 from tumbo.sellers where id = p_id) then
      raise exception 'Comercio no encontrado.';
    end if;
    perform tumbo_privado.exigir_cuenta_real(yo, not tumbo_privado.comercio_de_prueba(p_id));
  elsif p_entidad = 'comprador' then
    select * into u from tumbo.usuarios where id = tumbo_privado.uuid_texto(p_id);
    if u.id is null or u.rol <> 'comprador' or not tumbo_privado.ve_usuario(yo, u) then
      raise exception 'Comprador no encontrado.';
    end if;
  else
    raise exception 'La nota va en la ficha de un comercio o de un comprador.';
  end if;
  if char_length(v_texto) < 3 then
    raise exception 'Escribe la nota (al menos 3 caracteres).';
  end if;
  if (select count(*) from tumbo.notas_internas where entidad = p_entidad and entidad_id = p_id) >= 500 then
    raise exception 'Esta ficha tiene 500 notas: no admite más.';
  end if;
  insert into tumbo.notas_internas (entidad, entidad_id, texto, autor_id, autor) values (p_entidad, p_id, v_texto, yo.id, tumbo_privado.actor(yo));
  perform tumbo_privado.auditar(yo, 'Nota interna', p_entidad || ' ' || p_id);
  return tumbo_privado.notas_json(yo, p_entidad, p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Riesgo: listas negras, compradores marcados y el puntaje de cada pago
-- ---------------------------------------------------------------------------
-- Listas negras por cédula, teléfono, cuenta bancaria, RIF o correo (el
-- valor normalizado). Las de la demo son inventadas y lo dicen.
create table tumbo.listas_negras (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('cedula', 'telefono', 'cuenta', 'rif', 'correo')),
  valor      text not null check (char_length(valor) between 3 and 120),
  motivo     text not null check (char_length(motivo) between 5 and 300),
  activo     boolean not null default true,
  demo       boolean not null default false,
  por_id     uuid,
  por        text not null,
  creado     timestamptz not null default now(),
  quitado_por text,
  quitado_el timestamptz,
  nota       text check (nota is null or char_length(nota) <= 300)
);
create unique index listas_negras_activas_idx on tumbo.listas_negras (tipo, valor) where activo;
alter table tumbo.listas_negras enable row level security;
revoke all on tumbo.listas_negras from public, anon, authenticated;

-- Compradores marcados como riesgosos (suman al puntaje de sus pagos).
create table tumbo.compradores_riesgo (
  usuario_id  uuid primary key,
  motivo      text not null check (char_length(motivo) between 5 and 300),
  desde       timestamptz not null default now(),
  por_id      uuid,
  por         text not null,
  activo      boolean not null default true,
  quitado_por text,
  quitado_el  timestamptz
);
alter table tumbo.compradores_riesgo enable row level security;
revoke all on tumbo.compradores_riesgo from public, anon, authenticated;

-- El puntaje de cada pago (se recalcula al crearlo, al reportarlo y al
-- verificarlo). Desde el umbral de retención queda «retenido»: sus pedidos
-- no se liquidan (pedido_liquidable) hasta que una persona lo libera.
create table tumbo.riesgo_pagos (
  pago_id      text primary key check (char_length(pago_id) <= 30),
  comprador_id uuid,
  puntaje      integer not null check (puntaje between 0 and 100),
  nivel        text not null check (nivel in ('bajo', 'medio', 'alto')),
  motivos      jsonb not null default '[]'::jsonb,
  calculado    timestamptz not null default now(),
  retenido     boolean not null default false,
  avisado      boolean not null default false,
  liberado_por text,
  liberado_por_id uuid,
  liberado_el  timestamptz,
  nota         text check (nota is null or char_length(nota) <= 300)
);
create index riesgo_pagos_retenidos_idx on tumbo.riesgo_pagos (pago_id) where retenido and liberado_el is null;
alter table tumbo.riesgo_pagos enable row level security;
revoke all on tumbo.riesgo_pagos from public, anon, authenticated;

-- Normalización de lo que se compara.
create function tumbo_privado.riesgo_tel(p text) returns text
language sql immutable set search_path = '' as $$
  select case when char_length(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')) >= 7
              then right(regexp_replace(p, '[^0-9]', '', 'g'), 10) end
$$;
create function tumbo_privado.riesgo_doc(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(tumbo_privado.documento(p),
                  case when regexp_replace(coalesce(p, ''), '[\s.-]', '', 'g') ~ '^[0-9]{5,9}$'
                       then 'V-' || regexp_replace(p, '[\s.-]', '', 'g') end)
$$;
create function tumbo_privado.valor_lista(p_tipo text, p_valor text) returns text
language sql immutable set search_path = '' as $$
  select case p_tipo
    when 'cedula' then tumbo_privado.riesgo_doc(p_valor)
    when 'rif' then tumbo_privado.documento(p_valor)
    when 'telefono' then tumbo_privado.riesgo_tel(p_valor)
    when 'cuenta' then case when regexp_replace(coalesce(p_valor, ''), '[^0-9]', '', 'g') ~ '^[0-9]{10,24}$'
                            then regexp_replace(p_valor, '[^0-9]', '', 'g') end
    when 'correo' then case when lower(btrim(coalesce(p_valor, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(btrim(p_valor)) end
  end
$$;

-- Los datos que el riesgo compara entre cuentas, con índice: la cédula y el
-- teléfono normalizados del perfil y del pagador de cada pago (sin ellos
-- cada evaluación recorría todas las cuentas y los pagos), y los pedidos de
-- cada comercio por fecha (picos de ventas).
create index usuarios_riesgo_doc_crec_idx on tumbo.usuarios (tumbo_privado.riesgo_doc(cedula));
create index usuarios_riesgo_tel_crec_idx on tumbo.usuarios (tumbo_privado.riesgo_tel(telefono));
create index pagos_riesgo_doc_crec_idx on tumbo.pagos (tumbo_privado.riesgo_doc(pagador ->> 'cedula'));
create index pagos_riesgo_tel_crec_idx on tumbo.pagos (tumbo_privado.riesgo_tel(pagador ->> 'telefono'));
create index pedidos_seller_creado_crec_idx on tumbo.pedidos (seller_id, creado);

-- La lista negra contra los datos de cobro de un comercio: el número de su
-- cuenta de liquidación ('cuenta'), el teléfono de su Pago Móvil, el RIF del
-- titular y el de su expediente. Devuelve qué coincide (o null). Lo
-- consultan la retención de sus liquidaciones (retencion_seller), su ficha
-- 360 y el panel de riesgo.
create function tumbo_privado.seller_lista_negra(p_seller text) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(distinct case l.tipo when 'cuenta' then 'cuenta bancaria' when 'telefono' then 'teléfono de cobro' else 'RIF' end, ', ')
  from tumbo.listas_negras l
  where l.activo and (
    (l.tipo = 'cuenta' and l.valor in (select c.numero from tumbo.cuentas_liquidacion c
                                       where c.seller_id = p_seller and c.estado in ('pendiente', 'verificada') and c.numero is not null))
    or (l.tipo = 'telefono' and l.valor in (select tumbo_privado.riesgo_tel(c.telefono) from tumbo.cuentas_liquidacion c
                                            where c.seller_id = p_seller and c.estado in ('pendiente', 'verificada') and c.telefono is not null))
    or (l.tipo = 'rif' and l.valor in (select tumbo_privado.documento(c.rif) from tumbo.cuentas_liquidacion c
                                       where c.seller_id = p_seller and c.estado in ('pendiente', 'verificada')
                                       union all
                                       select tumbo_privado.documento(k.rif) from tumbo.sellers_kyc k where k.seller_id = p_seller)))
$$;

-- Avisos al momento: una cuenta de liquidación (Pagos) o el destino de un
-- reembolso que coincide con la lista negra le llega a Finanzas antes de
-- que el dinero salga (la liquidación además queda retenida:
-- retencion_seller). Nunca impiden la operación de quien los carga.
create function tumbo_privado.cuenta_liquidacion_lista_negra() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v text;
begin
  begin
    if new.estado in ('pendiente', 'verificada') then
      v := tumbo_privado.seller_lista_negra(new.seller_id);
      if v is not null then
        perform tumbo_privado.notificar('rol:finanzas', 'La cuenta de cobro de ' || new.seller_id || ' coincide con la lista negra (' || v ||
          '): sus liquidaciones quedan retenidas hasta revisarlo', 'gpp_maybe', 'admin/riesgo.html');
        perform tumbo_privado.auditar(null::tumbo.usuarios, 'Lista negra: cuenta de cobro', new.seller_id || ' · ' || v);
      end if;
    end if;
  exception when others then
    raise warning 'Tumbo: no se pudo cotejar la cuenta de % con la lista negra: %', new.seller_id, sqlerrm;
  end;
  return null;
end $$;

-- Desde la de Pagos: el motivo por el que los fondos de un seller están
-- retenidos suma la sanción de retener fondos y los datos de cobro que
-- coinciden con la lista negra (Crecimiento; el comercio lo ve como una
-- revisión de su cuenta de cobro). La consultan la preparación de corridas,
-- el calendario semanal y la vista de Finanzas.
create or replace function tumbo_privado.retencion_seller(p_seller text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'retención manual: ' || r.motivo from tumbo.retenciones r where r.seller_id = p_seller),
    (select 'sanción: ' || tumbo_privado.sancion_retencion(p_seller)),
    (select 'cuenta de cobro en revisión de seguridad' where tumbo_privado.seller_lista_negra(p_seller) is not null),
    (select case s.estado when 'suspendido' then 'comercio suspendido'
                          when 'observado' then 'expediente observado (en riesgo)'
                          when 'rechazado' then 'comercio rechazado' end
     from tumbo.sellers s where s.id = p_seller))
$$;

create trigger cuentas_liquidacion_lista_negra after insert or update of numero, telefono, rif, estado on tumbo.cuentas_liquidacion
  for each row execute function tumbo_privado.cuenta_liquidacion_lista_negra();

create function tumbo_privado.reembolso_destino_lista_negra() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v text;
begin
  begin
    select string_agg(distinct l.tipo, ', ') into v from tumbo.listas_negras l
    where l.activo and ((l.tipo = 'telefono' and l.valor = tumbo_privado.riesgo_tel(new.datos ->> 'telefono'))
                        or (l.tipo = 'cedula' and l.valor = tumbo_privado.riesgo_doc(new.datos ->> 'cedula'))
                        or (l.tipo = 'correo' and l.valor = lower(btrim(new.datos ->> 'correo'))));
    if v is not null then
      perform tumbo_privado.notificar('rol:finanzas', 'El destino del reembolso R-' || new.reembolso_id || ' coincide con la lista negra (' || v ||
        '): revísalo antes de enviarlo', 'gpp_maybe', 'admin/reembolsos.html');
    end if;
  exception when others then
    raise warning 'Tumbo: no se pudo cotejar el destino del reembolso % con la lista negra: %', new.reembolso_id, sqlerrm;
  end;
  return null;
end $$;

create trigger reembolso_destinos_lista_negra after insert or update of datos on tumbo.reembolso_destinos
  for each row execute function tumbo_privado.reembolso_destino_lista_negra();

-- Contrato riesgo_pedido (Crecimiento; ola 0 lo dejó en 0). p_datos: {pago}
-- (lo demás sale del pago y sus pedidos) o, sin pago, {total_usd,
-- referencia, sellers[], pagador{cedula, telefono, correo}, destino{…},
-- fiscal{documento}}. Devuelve {puntaje 0–100, nivel, motivos[{regla,
-- texto, puntos}], umbral_alerta, umbral_retencion}. Puntos: cuenta nueva
-- con monto alto 30; cédula o teléfono en otras cuentas 20; referencia usada
-- por otra cuenta 30; pagos rechazados repetidos 25; compras muy seguidas
-- 15; comercio con pico de ventas 15 o con reclamos abiertos 10; lista
-- negra 50 por cada tipo (cédula, teléfono, correo y RIF del comprador, del
-- pagador, del destinatario y de la factura); un comercio del pago con sus
-- datos de cobro en la lista negra (cuenta bancaria, teléfono o RIF) 30;
-- comprador marcado 40. Las comparaciones entre cuentas usan los índices de
-- riesgo_doc y riesgo_tel (milisegundos aunque haya muchas cuentas).
create or replace function tumbo_privado.riesgo_pedido(p_usuario uuid, p_datos jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  cfg jsonb := coalesce(tumbo_privado.ajuste('riesgo'), '{}'::jsonb);
  v_alerta numeric := tumbo_privado.numero(cfg -> 'umbral_alerta', 40);
  v_retencion numeric := tumbo_privado.numero(cfg -> 'umbral_retencion', 80);
  u tumbo.usuarios;
  g tumbo.pagos;
  v_total numeric;
  v_ref text;
  v_sellers text[];
  v_docs text[] := '{}';
  v_tels text[] := '{}';
  v_correos text[] := '{}';
  v_rifs text[] := '{}';
  v_motivos jsonb := '[]'::jsonb;
  v_puntos integer := 0;
  v_n integer;
  v_m integer;
  v_tipos text[];
  v_marca text;
  s text;
  v_dest jsonb;
begin
  select * into u from tumbo.usuarios where id = p_usuario;
  if nullif(d ->> 'pago', '') is not null then
    select * into g from tumbo.pagos where id = d ->> 'pago';
  end if;
  v_total := coalesce(tumbo_privado.num_json(d -> 'total_usd'), g.total_usd, 0);
  v_ref := coalesce(nullif(d ->> 'referencia', ''), g.ref_clave);
  if g.id is not null then
    select array_agg(distinct p.seller_id) into v_sellers from tumbo.pedidos p where p.pago_id = g.id;
    for v_dest in select p.destino from tumbo.pedidos p where p.pago_id = g.id and p.destino is not null loop
      v_docs := v_docs || tumbo_privado.riesgo_doc(v_dest ->> 'cedula');
      v_tels := v_tels || tumbo_privado.riesgo_tel(v_dest ->> 'telefono_destinatario');
    end loop;
  end if;
  if v_sellers is null and jsonb_typeof(d -> 'sellers') = 'array' then
    select array_agg(x) into v_sellers from jsonb_array_elements_text(d -> 'sellers') x;
  end if;
  v_docs := v_docs || tumbo_privado.riesgo_doc(u.cedula) || tumbo_privado.riesgo_doc(coalesce(g.pagador ->> 'cedula', d -> 'pagador' ->> 'cedula'))
                   || tumbo_privado.riesgo_doc(d -> 'destino' ->> 'cedula');
  v_tels := v_tels || tumbo_privado.riesgo_tel(u.telefono) || tumbo_privado.riesgo_tel(coalesce(g.pagador ->> 'telefono', d -> 'pagador' ->> 'telefono'))
                   || tumbo_privado.riesgo_tel(d -> 'destino' ->> 'telefono_destinatario');
  v_correos := array[lower(u.email), lower(coalesce(g.pagador ->> 'correo', d -> 'pagador' ->> 'correo'))];
  v_rifs := array[tumbo_privado.documento(coalesce(g.fiscal ->> 'documento', d -> 'fiscal' ->> 'documento'))];
  select coalesce(array_agg(distinct x), '{}') into v_docs from unnest(v_docs) x where x is not null;
  select coalesce(array_agg(distinct x), '{}') into v_tels from unnest(v_tels) x where x is not null;
  select coalesce(array_agg(distinct x), '{}') into v_correos from unnest(v_correos) x where x is not null;
  select coalesce(array_agg(distinct x), '{}') into v_rifs from unnest(v_rifs) x where x is not null;

  -- 1. cuenta nueva con un monto alto
  if u.creado > now() - make_interval(days => tumbo_privado.numero(cfg -> 'cuenta_nueva_dias', 7)::integer)
     and v_total >= tumbo_privado.numero(cfg -> 'monto_alto_usd', 300) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'cuenta_nueva', 'puntos', 30,
      'texto', 'Cuenta de ' || greatest(extract(day from now() - u.creado)::integer, 0) || ' días con una compra de ' || tumbo_privado.fmt_usd(v_total));
    v_puntos := v_puntos + 30;
  end if;
  -- 2. la misma cédula o teléfono en otras cuentas (perfil o pagos de 90
  -- días), por igualdad con los índices de riesgo_doc y riesgo_tel
  v_n := 0;
  if cardinality(v_docs) > 0 or cardinality(v_tels) > 0 then
    select count(distinct x.id) into v_n from (
      select o.id from tumbo.usuarios o
      where tumbo_privado.riesgo_doc(o.cedula) = any (v_docs) and o.id is distinct from p_usuario and o.activo
      union
      select o.id from tumbo.usuarios o
      where tumbo_privado.riesgo_tel(o.telefono) = any (v_tels) and o.id is distinct from p_usuario and o.activo
      union
      select q.comprador_id from tumbo.pagos q
      where tumbo_privado.riesgo_doc(q.pagador ->> 'cedula') = any (v_docs)
        and q.comprador_id is distinct from p_usuario and q.creado > now() - interval '90 days'
      union
      select q.comprador_id from tumbo.pagos q
      where tumbo_privado.riesgo_tel(q.pagador ->> 'telefono') = any (v_tels)
        and q.comprador_id is distinct from p_usuario and q.creado > now() - interval '90 days') x;
  end if;
  if v_n > 0 then
    v_motivos := v_motivos || jsonb_build_object('regla', 'dato_compartido', 'puntos', 20,
      'texto', 'La misma cédula o teléfono aparece en ' || v_n || ' cuenta' || case when v_n = 1 then '' else 's' end || ' más');
    v_puntos := v_puntos + 20;
  end if;
  -- 3. la referencia del pago la usó otra cuenta
  if v_ref is not null and exists (select 1 from tumbo.pagos q where q.ref_clave = v_ref and q.comprador_id <> p_usuario
                                   and (g.id is null or q.id <> g.id)) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'referencia_repetida', 'puntos', 30,
      'texto', 'La referencia del pago ya la reportó otra cuenta');
    v_puntos := v_puntos + 30;
  end if;
  -- 4. pagos rechazados repetidos
  select count(*) into v_n from tumbo.pagos q where q.comprador_id = p_usuario and q.estado = 'rechazado' and q.creado > now() - interval '30 days';
  if v_n >= tumbo_privado.numero(cfg -> 'rechazos_30d', 2) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'rechazos', 'puntos', 25, 'texto', v_n || ' pagos rechazados en 30 días');
    v_puntos := v_puntos + 25;
  end if;
  -- 5. compras muy seguidas
  select count(*) filter (where q.creado > now() - interval '1 hour'), count(*) into v_n, v_m
  from tumbo.pagos q where q.comprador_id = p_usuario and q.creado > now() - interval '1 day';
  if v_n >= tumbo_privado.numero(cfg -> 'compras_hora', 3) or v_m >= tumbo_privado.numero(cfg -> 'compras_dia', 8) then
    v_motivos := v_motivos || jsonb_build_object('regla', 'compras_seguidas', 'puntos', 15,
      'texto', v_n || ' compras en la última hora y ' || v_m || ' en el día');
    v_puntos := v_puntos + 15;
  end if;
  -- 6. el comercio: pico de ventas o reclamos abiertos
  foreach s in array coalesce(v_sellers, '{}') loop
    select count(*) filter (where p.creado > now() - interval '1 day'), count(*) into v_n, v_m
    from tumbo.pedidos p where p.seller_id = s and p.creado > now() - interval '30 days' and p.estado <> 'cancelado';
    if v_n >= tumbo_privado.numero(cfg -> 'pico_minimo', 5)
       and v_n > tumbo_privado.numero(cfg -> 'pico_factor', 3) * greatest((v_m - v_n) / 29.0, 0.5) then
      v_motivos := v_motivos || jsonb_build_object('regla', 'pico_seller', 'puntos', 15,
        'texto', s || ' tiene un pico de ventas (' || v_n || ' pedidos en 24 horas)');
      v_puntos := v_puntos + 15;
      exit;
    end if;
    select count(*) into v_n from tumbo.disputas q where q.seller_id = s and q.estado in ('abierta', 'respondida');
    if v_n >= tumbo_privado.numero(cfg -> 'disputas_seller', 3) then
      v_motivos := v_motivos || jsonb_build_object('regla', 'disputas_seller', 'puntos', 10,
        'texto', s || ' tiene ' || v_n || ' reclamos abiertos');
      v_puntos := v_puntos + 10;
      exit;
    end if;
  end loop;
  -- 7. listas negras
  select array_agg(distinct l.tipo order by l.tipo) into v_tipos from tumbo.listas_negras l
  where l.activo and ((l.tipo = 'cedula' and l.valor = any (v_docs)) or (l.tipo = 'telefono' and l.valor = any (v_tels))
                      or (l.tipo = 'correo' and l.valor = any (v_correos)) or (l.tipo = 'rif' and l.valor = any (v_rifs || v_docs)));
  if v_tipos is not null then
    v_motivos := v_motivos || jsonb_build_object('regla', 'lista_negra', 'puntos', 50 * cardinality(v_tipos),
      'texto', 'Coincide con la lista negra (' || array_to_string(v_tipos, ', ') || ')');
    v_puntos := v_puntos + 50 * cardinality(v_tipos);
  end if;
  -- 7 b. un comercio del pago cobra en una cuenta, un teléfono o un RIF de la lista negra
  foreach s in array coalesce(v_sellers, '{}') loop
    v_marca := tumbo_privado.seller_lista_negra(s);
    if v_marca is not null then
      v_motivos := v_motivos || jsonb_build_object('regla', 'lista_negra_comercio', 'puntos', 30,
        'texto', s || ' cobra con datos de la lista negra (' || v_marca || ')');
      v_puntos := v_puntos + 30;
      exit;
    end if;
  end loop;
  v_marca := null;
  -- 8. comprador marcado como riesgoso
  select c.motivo into v_marca from tumbo.compradores_riesgo c where c.usuario_id = p_usuario and c.activo;
  if v_marca is not null then
    v_motivos := v_motivos || jsonb_build_object('regla', 'marcado', 'puntos', 40, 'texto', 'Comprador marcado como riesgoso: ' || v_marca);
    v_puntos := v_puntos + 40;
  end if;
  v_puntos := least(v_puntos, 100);
  return jsonb_build_object('puntaje', v_puntos,
    'nivel', case when v_puntos >= v_retencion then 'alto' when v_puntos >= v_alerta then 'medio' else 'bajo' end,
    'motivos', v_motivos, 'umbral_alerta', v_alerta, 'umbral_retencion', v_retencion);
end $$;

-- Evalúa y guarda el riesgo de un pago (nunca falla: quien la llama sigue).
-- Desde el umbral de retención el pago queda retenido (salvo que alguien ya
-- lo haya liberado) y Finanzas recibe un aviso, una sola vez.
create function tumbo_privado.evaluar_riesgo_pago(p_pago text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g tumbo.pagos;
  r jsonb;
  ant tumbo.riesgo_pagos;
begin
  begin
    select * into g from tumbo.pagos where id = p_pago;
    if not found then
      return null;
    end if;
    r := tumbo_privado.riesgo_pedido(g.comprador_id, jsonb_build_object('pago', g.id));
    select * into ant from tumbo.riesgo_pagos where pago_id = g.id for update;
    insert into tumbo.riesgo_pagos (pago_id, comprador_id, puntaje, nivel, motivos, calculado, retenido)
    values (g.id, g.comprador_id, (r ->> 'puntaje')::integer, r ->> 'nivel', r -> 'motivos', now(), r ->> 'nivel' = 'alto')
    on conflict (pago_id) do update
      set puntaje = excluded.puntaje, nivel = excluded.nivel, motivos = excluded.motivos, calculado = now(),
          retenido = tumbo.riesgo_pagos.retenido or excluded.retenido;
    if r ->> 'nivel' = 'alto' and not coalesce(ant.avisado, false) and ant.liberado_el is null then
      update tumbo.riesgo_pagos set avisado = true where pago_id = g.id;
      perform tumbo_privado.notificar('rol:finanzas', 'Pago ' || g.id || ' con riesgo alto (' || (r ->> 'puntaje') ||
        '): sus pedidos no se liquidan hasta que lo revises', 'gpp_maybe', 'admin/riesgo.html');
    end if;
    return r;
  exception when others then
    raise warning 'Tumbo: no se pudo evaluar el riesgo del pago %: %', p_pago, sqlerrm;
    return null;
  end;
end $$;

create function tumbo_privado.pago_riesgo_auto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform tumbo_privado.evaluar_riesgo_pago(new.id);
  return null;
end $$;

create trigger pagos_riesgo after update of estado on tumbo.pagos
  for each row when (new.estado in ('reportado', 'verificado') and old.estado is distinct from new.estado)
  execute function tumbo_privado.pago_riesgo_auto();

-- ¿Está retenido por riesgo (sin liberar)?
create function tumbo_privado.pago_retenido_riesgo(p_pago text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_pago is not null and exists (select 1 from tumbo.riesgo_pagos r
                                                where r.pago_id = p_pago and r.retenido and r.liberado_el is null), false)
$$;

-- Desde la de Pagos: un pedido cuyo pago quedó retenido por riesgo no entra
-- en una corrida hasta que una persona libera el pago (tm_riesgo_liberar).
create or replace function tumbo_privado.pedido_liquidable(x tumbo.pedidos) returns boolean
language sql stable security definer set search_path = '' as $$
  select x.liquidacion = 'elegible' and x.liquidacion_id is null
     and (x.pago_id is null or exists (select 1 from tumbo.pagos g where g.id = x.pago_id and g.estado = 'verificado'))
     and not tumbo_privado.pago_retenido_riesgo(x.pago_id)
$$;

-- El riesgo como lo ve cada quien: una cuenta de prueba no ve el de los
-- pagos de personas reales (solo que existe); Operaciones sin el permiso
-- «riesgo» (p. ej. en el detalle 360 del pedido) ve el nivel y si está
-- retenido, sin el puntaje ni los motivos (que nombran datos del comprador).
create function tumbo_privado.riesgo_json(p_yo tumbo.usuarios, r tumbo.riesgo_pagos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when r.pago_id is null then null
              when tumbo_privado.cuenta_demo(p_yo.email) and tumbo_privado.comprador_real(r.comprador_id)
                then jsonb_build_object('pago', r.pago_id, 'bloqueado', true)
              when not coalesce(tumbo_privado.tiene_permiso(p_yo, 'riesgo'), false)
                then jsonb_build_object('pago', r.pago_id, 'nivel', r.nivel, 'retenido', r.retenido and r.liberado_el is null, 'resumen', true)
              else jsonb_build_object('pago', r.pago_id, 'puntaje', r.puntaje, 'nivel', r.nivel, 'motivos', r.motivos,
                                      'calculado', r.calculado, 'retenido', r.retenido and r.liberado_el is null,
                                      'liberado_el', r.liberado_el,
                                      'liberado_por', case when r.liberado_por is null then null
                                                           when r.liberado_por_id is null and tumbo_privado.cuenta_demo(p_yo.email) then 'Cuenta del equipo'
                                                           else tumbo_privado.firma_visible(p_yo, r.liberado_por_id, r.liberado_por) end,
                                      'nota', r.nota) end
$$;

-- El riesgo de unos pagos (hasta 100) para la conciliación y los 360. Se
-- lee lo guardado (se calcula al crear el pago, al reportarlo y al
-- verificarlo); en cada llamada se calculan a lo sumo 10: los que no tienen
-- evaluación y los pendientes o reportados con una de hace más de 10
-- minutos (una lista negra nueva, p. ej.). Operaciones sin «riesgo» solo
-- lee el resumen y no recalcula.
create function public.tm_riesgo_pagos(p_sesion text, p_pagos text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas', 'ops']);
  v_permiso boolean := coalesce(tumbo_privado.tiene_permiso(yo, 'riesgo'), false);
  v_ids text[];
  v_id text;
  r tumbo.riesgo_pagos;
  v_calc integer := 0;
  v jsonb := '{}'::jsonb;
begin
  if coalesce(cardinality(p_pagos), 0) > 100 then
    raise exception 'Pide el riesgo de hasta 100 pagos.';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_pagos, '{}')) x where x ~ '^PAG-[0-9]{4}-[0-9]{5,}$';
  if v_permiso then
    for v_id in select g.id from tumbo.pagos g left join tumbo.riesgo_pagos q on q.pago_id = g.id
                where g.id = any (v_ids)
                  and (q.pago_id is null or (g.estado in ('pendiente', 'reportado') and q.calculado < now() - interval '10 minutes'))
                order by q.pago_id is not null, g.id limit 10 loop
      perform tumbo_privado.evaluar_riesgo_pago(v_id);
      v_calc := v_calc + 1;
    end loop;
  end if;
  for r in select * from tumbo.riesgo_pagos q where q.pago_id = any (v_ids) loop
    v := v || jsonb_build_object(r.pago_id, tumbo_privado.riesgo_json(yo, r));
  end loop;
  return v;
end $$;

-- Libera un pago retenido por riesgo (sus pedidos vuelven a ser
-- liquidables). Con nota; el de una persona real, con sesión elevada.
create function public.tm_riesgo_liberar(p_sesion text, p_pago text, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas', 'ops']);
  r tumbo.riesgo_pagos;
  v_nota text := left(regexp_replace(btrim(coalesce(p_nota, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
begin
  perform tumbo_privado.exigir_permiso(yo, 'riesgo');
  select * into r from tumbo.riesgo_pagos where pago_id = p_pago for update;
  if not found then
    raise exception 'Ese pago no tiene una evaluación de riesgo.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(r.comprador_id));
  if not r.retenido or r.liberado_el is not null then
    raise exception 'Ese pago no está retenido.';
  end if;
  if char_length(v_nota) < 10 then
    raise exception 'Explica qué revisaste (al menos 10 caracteres).';
  end if;
  update tumbo.riesgo_pagos set liberado_por = tumbo_privado.actor(yo), liberado_por_id = yo.id, liberado_el = now(), nota = v_nota
  where pago_id = p_pago;
  perform tumbo_privado.auditar(yo, 'Retención por riesgo liberada', p_pago || ' (puntaje ' || r.puntaje || ') · ' || v_nota);
  return jsonb_build_object('ok', true);
end $$;

-- Panel de riesgo: umbrales, pagos retenidos y recientes de riesgo medio o
-- alto, listas negras (con dónde se coteja cada tipo), los comercios cuyos
-- datos de cobro coinciden con ellas y los compradores marcados. Una cuenta
-- de prueba solo ve lo de la demo (nunca datos de personas o comercios
-- reales) y no recibe los umbrales (dirían cómo quedar justo debajo).
create function public.tm_riesgo_panel(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'finanzas', 'ops']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
begin
  perform tumbo_privado.exigir_permiso(yo, 'riesgo');
  return jsonb_build_object(
    'umbrales', case when v_demo then null else coalesce(tumbo_privado.ajuste('riesgo'), '{}'::jsonb) end,
    'cotejo', jsonb_build_object(
      'cedula', 'El puntaje de cada pago (comprador, pagador y destinatario) y los destinos de reembolso.',
      'telefono', 'El puntaje de cada pago (comprador, pagador y destinatario), los destinos de reembolso y el Pago Móvil de cobro de los comercios (retiene sus liquidaciones).',
      'correo', 'El puntaje de cada pago (cuenta del comprador y correo del pagador) y los destinos de reembolso (Zelle).',
      'rif', 'El puntaje de cada pago (datos de la factura) y el RIF de cobro y del expediente de los comercios (retiene sus liquidaciones).',
      'cuenta', 'Las cuentas de liquidación de los comercios: retiene sus liquidaciones y suma 30 puntos a los pagos de sus pedidos.'),
    'comercios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'coincide', tumbo_privado.seller_lista_negra(s.id))
                                            order by s.id)
                           from tumbo.sellers s
                           where tumbo_privado.seller_lista_negra(s.id) is not null
                             and (not v_demo or tumbo_privado.comercio_de_prueba(s.id))), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(tumbo_privado.riesgo_json(yo, r) || jsonb_build_object(
        'estado_pago', g.estado, 'total_usd', g.total_usd, 'creado', g.creado,
        'pedidos', (select coalesce(jsonb_agg(p.id order by p.id), '[]'::jsonb) from tumbo.pedidos p where p.pago_id = g.id))
        order by (r.retenido and r.liberado_el is null) desc, r.calculado desc)
      from (select * from tumbo.riesgo_pagos x
            where (x.nivel <> 'bajo' or (x.retenido and x.liberado_el is null))
              and (not v_demo or not tumbo_privado.comprador_real(x.comprador_id))
            order by (x.retenido and x.liberado_el is null) desc, x.calculado desc limit 200) r
      join tumbo.pagos g on g.id = r.pago_id), '[]'::jsonb),
    'listas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'tipo', l.tipo, 'valor', l.valor, 'motivo', l.motivo, 'demo', l.demo,
                                                            'por', tumbo_privado.firma_visible(yo, l.por_id, l.por), 'creado', l.creado)
                                         order by l.id desc)
                        from tumbo.listas_negras l where l.activo and (not v_demo or l.demo)), '[]'::jsonb),
    'marcados', coalesce((select jsonb_agg(jsonb_build_object('usuario', c.usuario_id, 'nombre', u.nombre, 'motivo', c.motivo, 'desde', c.desde,
                                                              'por', tumbo_privado.firma_visible(yo, c.por_id, c.por)) order by c.desde desc)
                          from tumbo.compradores_riesgo c join tumbo.usuarios u on u.id = c.usuario_id
                          where c.activo and (not v_demo or tumbo_privado.cuenta_demo(u.email))), '[]'::jsonb),
    'editable', not v_demo);
end $$;

-- Listas negras: agregar (normaliza el valor) y quitar, con sesión elevada.
create function public.tm_lista_negra_guardar(p_sesion text, p_tipo text, p_valor text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas', 'ops']);
  v_valor text := tumbo_privado.valor_lista(p_tipo, p_valor);
  v_motivo text := left(regexp_replace(btrim(coalesce(p_motivo, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
  l tumbo.listas_negras;
begin
  perform tumbo_privado.exigir_permiso(yo, 'riesgo');
  perform tumbo_privado.exigir_elevada(yo);
  if p_tipo not in ('cedula', 'telefono', 'cuenta', 'rif', 'correo') then
    raise exception 'Elige qué dato va a la lista negra.';
  end if;
  if v_valor is null then
    raise exception 'Ese % no es válido.', case p_tipo when 'cedula' then 'número de cédula' when 'telefono' then 'teléfono'
      when 'cuenta' then 'número de cuenta (de 10 a 24 dígitos)' when 'rif' then 'RIF' else 'correo' end;
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'Indica el motivo (al menos 5 caracteres).';
  end if;
  if (select count(*) from tumbo.listas_negras where activo) >= 5000 then
    raise exception 'La lista negra llegó a 5.000 datos.';
  end if;
  insert into tumbo.listas_negras (tipo, valor, motivo, por_id, por)
  values (p_tipo, v_valor, v_motivo, yo.id, tumbo_privado.actor(yo))
  on conflict (tipo, valor) where activo do nothing returning * into l;
  if l.id is null then
    raise exception 'Ese dato ya está en la lista negra.';
  end if;
  perform tumbo_privado.auditar(yo, 'Lista negra: dato agregado', p_tipo || ' ' || tumbo_privado.enmascarar(v_valor) || ' · ' || v_motivo);
  return jsonb_build_object('id', l.id, 'tipo', l.tipo, 'valor', l.valor);
end $$;

create function public.tm_lista_negra_quitar(p_sesion text, p_id bigint, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'finanzas', 'ops']);
  l tumbo.listas_negras;
  v_nota text := left(regexp_replace(btrim(coalesce(p_nota, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
begin
  perform tumbo_privado.exigir_permiso(yo, 'riesgo');
  perform tumbo_privado.exigir_elevada(yo);
  select * into l from tumbo.listas_negras where id = p_id and activo for update;
  if not found then
    raise exception 'Ese dato no está en la lista negra.';
  end if;
  if char_length(v_nota) < 5 then
    raise exception 'Indica por qué se quita (al menos 5 caracteres).';
  end if;
  update tumbo.listas_negras set activo = false, quitado_por = tumbo_privado.actor(yo), quitado_el = now(), nota = v_nota where id = l.id;
  perform tumbo_privado.auditar(yo, 'Lista negra: dato quitado', l.tipo || ' ' || tumbo_privado.enmascarar(l.valor) || ' · ' || v_nota);
  return jsonb_build_object('ok', true);
end $$;

-- Marca (o desmarca) a un comprador como riesgoso, con motivo. Sobre una
-- persona real, una cuenta real con sesión elevada.
create function public.tm_comprador_marcar(p_sesion text, p_usuario uuid, p_riesgoso boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
  u tumbo.usuarios;
  v_motivo text := left(regexp_replace(btrim(coalesce(p_motivo, '')), '[[:cntrl:]<>]+', ' ', 'g'), 300);
begin
  select * into u from tumbo.usuarios where id = p_usuario;
  if u.id is null or u.rol <> 'comprador' or not tumbo_privado.ve_usuario(yo, u) then
    raise exception 'Comprador no encontrado.';
  end if;
  perform tumbo_privado.exigir_si_real(yo, tumbo_privado.comprador_real(u.id));
  if p_riesgoso is null then
    raise exception 'Indica si lo marcas o lo desmarcas.';
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'Indica el motivo (al menos 5 caracteres).';
  end if;
  if p_riesgoso then
    insert into tumbo.compradores_riesgo (usuario_id, motivo, por_id, por)
    values (u.id, v_motivo, yo.id, tumbo_privado.actor(yo))
    on conflict (usuario_id) do update set motivo = excluded.motivo, desde = now(), por_id = excluded.por_id, por = excluded.por,
                                          activo = true, quitado_por = null, quitado_el = null;
  else
    update tumbo.compradores_riesgo set activo = false, quitado_por = tumbo_privado.actor(yo) || ': ' || v_motivo, quitado_el = now()
    where usuario_id = u.id and activo;
    if not found then
      raise exception 'Ese comprador no estaba marcado.';
    end if;
  end if;
  perform tumbo_privado.auditar(yo, case when p_riesgoso then 'Comprador marcado como riesgoso' else 'Comprador desmarcado' end,
                                'cuenta ' || u.id || ' · ' || v_motivo);
  return jsonb_build_object('ok', true, 'riesgoso', p_riesgoso);
end $$;

-- ---------------------------------------------------------------------------
-- Fichas 360 de comercios y compradores
-- ---------------------------------------------------------------------------
-- Ficha 360 de un comercio (superadmin, ops, finanzas): catálogo, pedidos,
-- métricas (cancelación, aceptación en SLA, reclamos perdidos, tiempo de
-- despacho), liquidaciones, equipo, expediente e historial KYC, notas
-- internas, sanciones, nivel y comisión. A una cuenta de prueba, un
-- comercio real le llega reservado (solo su nombre y estado).
create function public.tm_seller_360(p_sesion text, p_seller text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops', 'finanzas']);
  s tumbo.sellers;
  k tumbo.sellers_kyc;
  m jsonb;
  v_piso bigint := (select coalesce(max(id), 0) - 50000 from tumbo.auditoria);
  v_reservado boolean;
begin
  select * into s from tumbo.sellers where id = p_seller;
  if not found then
    raise exception 'Comercio % no encontrado.', left(coalesce(p_seller, ''), 30);
  end if;
  v_reservado := tumbo_privado.cuenta_demo(yo.email) and not tumbo_privado.comercio_de_prueba(s.id);
  if v_reservado then
    return jsonb_build_object('seller', jsonb_build_object('id', s.id, 'nombre', s.nombre, 'ciudad', s.ciudad, 'estado', s.estado),
                              'bloqueado', true);
  end if;
  select * into k from tumbo.sellers_kyc where seller_id = s.id;
  m := tumbo_privado.metricas_nivel(s.id, 90);
  return jsonb_build_object(
    'seller', jsonb_build_object('id', s.id, 'nombre', s.nombre, 'ciudad', s.ciudad, 'estado', s.estado, 'desde', s.desde,
                                 'descripcion', s.descripcion, 'kyc_verificado', s.kyc_verificado, 'real', tumbo_privado.seller_real(s.id)),
    'bloqueado', false,
    'catalogo', jsonb_build_object(
      'por_estado', coalesce((select jsonb_object_agg(x.estado, x.n) from (select p.estado, count(*) as n from tumbo.productos p
                                                                           where p.seller_id = s.id group by p.estado) x), '{}'::jsonb),
      'productos', coalesce((select jsonb_agg(jsonb_build_object('sku', p.sku, 'nombre', p.nombre, 'estado', p.estado, 'precio_usd', p.precio_usd,
                                                                 'disponible', p.stock_fis - p.stock_res, 'categoria', p.categoria,
                                                                 'marcas', (select count(*) from tumbo.moderacion_marcas mm where mm.sku = p.sku and mm.estado = 'abierta'))
                                              order by p.actualizado desc)
                             from (select * from tumbo.productos x where x.seller_id = s.id order by x.actualizado desc limit 40) p), '[]'::jsonb)),
    'pedidos', jsonb_build_object(
      'por_estado', coalesce((select jsonb_object_agg(x.estado, x.n) from (select p.estado, count(*) as n from tumbo.pedidos p
                                                                           where p.seller_id = s.id group by p.estado) x), '{}'::jsonb),
      'recientes', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'estado', p.estado, 'creado', p.creado, 'liquidacion', p.liquidacion,
                                                                 'total_usd', (tumbo_privado.montos_pedido(p) ->> 'pagado')::numeric,
                                                                 'pago_id', p.pago_id, 'real', tumbo_privado.pedido_real(p))
                                              order by p.creado desc)
                             from tumbo.pedidos p where p.id in (select x.id from tumbo.pedidos x where x.seller_id = s.id order by x.creado desc limit 30)), '[]'::jsonb)),
    'metricas', m || jsonb_build_object(
      'despacho_horas', (select round(avg(extract(epoch from e.despachado_en - e.conciliado_en) / 3600)::numeric, 1)
                         from tumbo.envios e where e.seller_id = s.id and e.despachado_en is not null and e.conciliado_en is not null
                           and e.conciliado_en > now() - interval '90 days'),
      'disputas_abiertas', (select count(*) from tumbo.disputas d where d.seller_id = s.id and d.estado in ('abierta', 'respondida')),
      'disputas_total', (select count(*) from tumbo.disputas d where d.seller_id = s.id and d.creado > now() - interval '90 days'),
      'ventas_24h', (select count(*) from tumbo.pedidos p where p.seller_id = s.id and p.creado > now() - interval '1 day' and p.estado <> 'cancelado')),
    'liquidaciones', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ciclo', l.ciclo, 'estado', l.estado, 'neto_usd', l.neto_usd,
                                                                   'fecha', l.fecha, 'pedidos', cardinality(l.pedidos)) order by l.fecha desc, l.id desc)
                               from (select * from tumbo.liquidaciones x where x.seller_id = s.id order by x.fecha desc, x.id desc limit 20) l), '[]'::jsonb),
    'retencion', tumbo_privado.retencion_seller(s.id),
    'lista_negra', tumbo_privado.seller_lista_negra(s.id),
    'equipo', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre, 'rol', u.rol, 'activo', u.activo, 'bloqueado', u.bloqueado,
                                                            'demo', tumbo_privado.cuenta_demo(u.email), 'ultimo_acceso', u.ultimo_acceso,
                                                            'totp', exists (select 1 from tumbo.usuarios_2fa z where z.usuario_id = u.id and z.activo))
                                         order by u.rol, u.nombre)
                        from tumbo.usuarios u where u.seller_id = s.id), '[]'::jsonb),
    'kyc', case when tumbo_privado.expediente_visible(yo, s.id) then jsonb_build_object(
        'expediente', k.expediente, 'enviado', k.enviado, 'revisado', k.revisado, 'rif', k.rif, 'razon_social', k.razon_social,
        'documentos', coalesce((select jsonb_agg(jsonb_build_object('orden', d.orden, 'nombre', d.nombre, 'estado', d.estado,
                                                                    'observacion', d.observacion, 'revisado_por', d.revisado_por,
                                                                    'actualizado', d.actualizado) order by d.orden)
                                from tumbo.seller_documentos d where d.seller_id = s.id), '[]'::jsonb),
        'historial', coalesce((select jsonb_agg(jsonb_build_object('fecha', a.fecha, 'actor', a.actor, 'accion', a.accion, 'detalle', a.detalle)
                                                order by a.id desc)
                               from (select * from tumbo.auditoria a2
                                     where a2.id > v_piso
                                       and a2.accion in ('Decisión KYC', 'Documento KYC cargado', 'Documento KYC revisado', 'Expediente KYC enviado')
                                       and a2.detalle like '%' || s.id || '%'
                                       and tumbo_privado.auditoria_visible(yo, a2.actor_id)
                                     order by a2.id desc limit 30) a), '[]'::jsonb)) end,
    'notas', tumbo_privado.notas_json(yo, 'seller', s.id),
    'sanciones', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'motivo', x.motivo, 'limite', x.limite, 'desde', x.desde,
                                                               'hasta', x.hasta, 'vigente', tumbo_privado.sancion_vigente(x),
                                                               'por', tumbo_privado.firma_visible(yo, x.por_id, x.por),
                                                               'levantada_por', case when tumbo_privado.cuenta_demo(yo.email) then null else x.levantada_por end,
                                                               'levantada_el', x.levantada_el, 'nota', x.nota) order by x.desde desc)
                           from tumbo.sanciones x where x.seller_id = s.id), '[]'::jsonb),
    'nivel', (select jsonb_build_object('nivel', n.nivel, 'desde', n.desde, 'calculado', n.calculado, 'evaluacion', n.metricas -> 'evaluacion')
              from tumbo.niveles_seller n where n.seller_id = s.id),
    'nivel_ahora', tumbo_privado.nivel_evaluar(s.id, m),
    'comision', jsonb_build_object('vigente', tumbo_privado.comision_vigente(s.id, null),
      'propias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'categoria', c.categoria, 'pct', c.pct, 'descuento_pts', c.descuento_pts,
                                                               'desde', c.desde, 'hasta', c.hasta, 'origen', c.origen, 'estado', c.estado) order by c.id desc)
                           from tumbo.comisiones c where c.seller_id = s.id and c.estado in ('pendiente', 'vigente')
                             and (c.hasta is null or c.hasta > now())), '[]'::jsonb)),
    'puede_sancionar', yo.rol = 'superadmin' and not tumbo_privado.cuenta_demo(yo.email));
end $$;

-- Ficha 360 de un comprador para soporte (quien lo ve en la administración
-- de usuarios: superadmin u Operaciones; una cuenta de prueba, solo a las
-- cuentas de prueba): perfil, pedidos, pagos con su riesgo, reclamos,
-- reembolsos, crédito, notas internas y si está marcado como riesgoso.
create function public.tm_comprador_360(p_sesion text, p_usuario uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  u tumbo.usuarios;
  v_listas jsonb;
begin
  select * into u from tumbo.usuarios where id = p_usuario;
  if u.id is null or u.rol <> 'comprador' or not tumbo_privado.ve_usuario(yo, u) then
    raise exception 'Comprador no encontrado.';
  end if;
  -- su perfil, los pagadores de sus pagos y los destinos de sus reembolsos
  select coalesce(jsonb_agg(jsonb_build_object('tipo', l.tipo, 'motivo', l.motivo)), '[]'::jsonb) into v_listas
  from tumbo.listas_negras l
  where l.activo and (
    (l.tipo = 'correo' and (l.valor = lower(u.email)
                            or l.valor in (select lower(g.pagador ->> 'correo') from tumbo.pagos g where g.comprador_id = u.id)
                            or l.valor in (select lower(d.datos ->> 'correo') from tumbo.reembolso_destinos d join tumbo.reembolsos r on r.id = d.reembolso_id
                                           where r.comprador_id = u.id or r.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id))))
    or (l.tipo = 'cedula' and (l.valor = tumbo_privado.riesgo_doc(u.cedula)
                               or l.valor in (select tumbo_privado.riesgo_doc(g.pagador ->> 'cedula') from tumbo.pagos g where g.comprador_id = u.id)
                               or l.valor in (select tumbo_privado.riesgo_doc(d.datos ->> 'cedula') from tumbo.reembolso_destinos d join tumbo.reembolsos r on r.id = d.reembolso_id
                                              where r.comprador_id = u.id or r.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id))))
    or (l.tipo = 'telefono' and (l.valor = tumbo_privado.riesgo_tel(u.telefono)
                                 or l.valor in (select tumbo_privado.riesgo_tel(g.pagador ->> 'telefono') from tumbo.pagos g where g.comprador_id = u.id)
                                 or l.valor in (select tumbo_privado.riesgo_tel(d.datos ->> 'telefono') from tumbo.reembolso_destinos d join tumbo.reembolsos r on r.id = d.reembolso_id
                                                where r.comprador_id = u.id or r.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id)))));
  return jsonb_build_object(
    'usuario', jsonb_build_object('id', u.id, 'nombre', u.nombre, 'email', u.email, 'telefono', u.telefono, 'cedula', u.cedula,
                                  'creado', u.creado, 'ultimo_acceso', u.ultimo_acceso, 'activo', u.activo, 'bloqueado', u.bloqueado,
                                  'bloqueo_motivo', u.bloqueo_motivo, 'bloqueado_el', u.bloqueado_el,
                                  'correo_verificado', u.correo_verificado, 'telefono_verificado', u.telefono_verificado,
                                  'demo', tumbo_privado.cuenta_demo(u.email)),
    'puede_bloquear', tumbo_privado.gestiona_usuario(yo, u),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'estado', p.estado, 'seller_id', p.seller_id, 'seller', se.nombre,
                                                             'creado', p.creado, 'total_usd', (tumbo_privado.montos_pedido(p) ->> 'pagado')::numeric,
                                                             'pago_id', p.pago_id, 'disputa_id', p.disputa_id) order by p.creado desc)
                         from tumbo.pedidos p left join tumbo.sellers se on se.id = p.seller_id
                         where p.id in (select x.id from tumbo.pedidos x where x.comprador_id = u.id order by x.creado desc limit 50)), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'estado', g.estado, 'metodo', g.metodo, 'total_usd', g.total_usd,
                                                           'referencia', g.referencia, 'creado', g.creado, 'verificado_el', g.verificado_el,
                                                           'riesgo', tumbo_privado.riesgo_json(yo, r)) order by g.creado desc)
                       from (select * from tumbo.pagos x where x.comprador_id = u.id order by x.creado desc limit 30) g
                       left join tumbo.riesgo_pagos r on r.pago_id = g.id), '[]'::jsonb),
    'reclamos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'pedido_id', d.pedido_id, 'motivo', d.motivo, 'estado', d.estado,
                                                              'creado', d.creado, 'decision', d.resolucion_decision, 'monto_usd', d.monto_usd)
                                           order by d.creado desc)
                          from (select * from tumbo.disputas x where x.comprador_id = u.id order by x.creado desc limit 30) d), '[]'::jsonb),
    'reembolsos', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'pedido_id', r.pedido_id, 'monto_usd', r.monto_usd, 'estado', r.estado,
                                                                'tipo', r.tipo, 'motivo', r.motivo, 'creado', r.creado) order by r.creado desc)
                            from (select * from tumbo.reembolsos x
                                  where x.comprador_id = u.id or x.pedido_id in (select p.id from tumbo.pedidos p where p.comprador_id = u.id)
                                  order by x.creado desc limit 30) r), '[]'::jsonb),
    'credito_usd', (select coalesce(sum(c.monto_usd), 0) from tumbo.creditos c where c.usuario_id = u.id),
    'notas', tumbo_privado.notas_json(yo, 'comprador', u.id::text),
    'riesgo', jsonb_build_object(
      'marcado', (select jsonb_build_object('motivo', c.motivo, 'desde', c.desde, 'por', tumbo_privado.firma_visible(yo, c.por_id, c.por))
                  from tumbo.compradores_riesgo c where c.usuario_id = u.id and c.activo),
      'listas_negras', v_listas,
      'ultimo', (select tumbo_privado.riesgo_json(yo, r) from tumbo.riesgo_pagos r where r.comprador_id = u.id order by r.calculado desc limit 1)));
end $$;

-- ---------------------------------------------------------------------------
-- Marketing: campañas, banners y colecciones
-- ---------------------------------------------------------------------------
-- Imágenes de banners y colecciones: un propósito público nuevo (5 MB, las
-- mismas imágenes que un producto). Las sube el equipo de marketing con una
-- cuenta real (marketing_puede_subir, abajo; la subida la conecta la
-- integración de la ola 2).
insert into tumbo.archivo_propositos (proposito, bucket, max_bytes, tipos, publico) values
  ('marketing', 'tumbo-publico', 5242880, array['image/jpeg', 'image/png', 'image/webp'], true)
on conflict (proposito) do nothing;

create table tumbo.campanas (
  id          bigint generated always as identity primary key,
  nombre      text not null check (char_length(nombre) between 3 and 80),
  descripcion text check (descripcion is null or char_length(descripcion) <= 300),
  desde       timestamptz not null,
  hasta       timestamptz not null,
  color       text not null default 'azul' check (color in ('azul', 'verde', 'ambar', 'rojo', 'violeta')),
  activa      boolean not null default true,
  demo        boolean not null default false,
  por_id      uuid,
  por         text,
  creado      timestamptz not null default now(),
  check (hasta > desde)
);
alter table tumbo.campanas enable row level security;
revoke all on tumbo.campanas from public, anon, authenticated;

-- Banners programados de la portada: el enlace solo lleva a una página de
-- la tienda (nunca fuera del sitio).
create table tumbo.banners (
  id          bigint generated always as identity primary key,
  titulo      text not null check (char_length(titulo) between 3 and 80),
  texto       text check (texto is null or char_length(texto) <= 160),
  imagen      uuid,
  enlace      text check (enlace is null or enlace ~ '^app/tienda/[a-z0-9-]+\.html(\?[A-Za-z0-9=&_.%-]{0,200})?$'),
  boton       text check (boton is null or char_length(boton) between 2 and 30),
  tono        text not null default 'marca' check (tono in ('marca', 'calido', 'fresco', 'oscuro')),
  desde       timestamptz not null,
  hasta       timestamptz not null,
  orden       integer not null default 100 check (orden between 0 and 1000),
  activo      boolean not null default true,
  campana_id  bigint,
  demo        boolean not null default false,
  por_id      uuid,
  por         text,
  creado      timestamptz not null default now(),
  check (hasta > desde)
);
alter table tumbo.banners enable row level security;
revoke all on tumbo.banners from public, anon, authenticated;

-- Colecciones destacadas: una lista curada de productos con su página
-- (tienda/coleccion?id=<slug>).
create table tumbo.colecciones (
  id          bigint generated always as identity primary key,
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  titulo      text not null check (char_length(titulo) between 3 and 80),
  descripcion text check (descripcion is null or char_length(descripcion) <= 300),
  skus        text[] not null check (cardinality(skus) between 1 and 24),
  desde       timestamptz not null,
  hasta       timestamptz not null,
  orden       integer not null default 100 check (orden between 0 and 1000),
  activa      boolean not null default true,
  campana_id  bigint,
  demo        boolean not null default false,
  por_id      uuid,
  por         text,
  creado      timestamptz not null default now(),
  check (hasta > desde)
);
alter table tumbo.colecciones enable row level security;
revoke all on tumbo.colecciones from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ofertas y cupones
-- ---------------------------------------------------------------------------
-- Ofertas sobre un SKU, con vigencia:
--   precio: precio de oferta con el precio de lista tachado;
--   relampago: lo mismo con unidades contadas y una cuenta regresiva;
--   cantidad: % de descuento desde N unidades.
-- precio_referencia_usd es el precio de lista al crearla: si el comercio lo
-- sube después, la oferta deja de aplicarse (nunca se tacha un precio
-- inflado). La financia el comercio (las de Tumbo, el equipo de marketing).
create table tumbo.ofertas (
  id                    bigint generated always as identity primary key,
  seller_id             text not null check (char_length(seller_id) <= 30),
  sku                   text not null check (char_length(sku) <= 40),
  tipo                  text not null check (tipo in ('precio', 'relampago', 'cantidad')),
  precio_oferta_usd     numeric(12,2) check (precio_oferta_usd is null or precio_oferta_usd > 0),
  precio_referencia_usd numeric(12,2) not null check (precio_referencia_usd > 0),
  descuento_pct         numeric(5,2) check (descuento_pct is null or (descuento_pct > 0 and descuento_pct <= 90)),
  cantidad_min          integer check (cantidad_min is null or cantidad_min between 2 and 10),
  stock_oferta          integer check (stock_oferta is null or stock_oferta between 1 and 10000),
  desde                 timestamptz not null,
  hasta                 timestamptz not null,
  financia              text not null default 'seller' check (financia in ('seller', 'tumbo')),
  activa                boolean not null default true,
  campana_id            bigint,
  demo                  boolean not null default false,
  por_id                uuid,
  por                   text,
  creado                timestamptz not null default now(),
  check (hasta > desde),
  check ((tipo = 'cantidad') = (descuento_pct is not null and cantidad_min is not null)),
  check ((tipo in ('precio', 'relampago')) = (precio_oferta_usd is not null)),
  check ((tipo = 'relampago') = (stock_oferta is not null))
);
create index ofertas_sku_idx on tumbo.ofertas (sku) where activa;
create index ofertas_seller_idx on tumbo.ofertas (seller_id);
alter table tumbo.ofertas enable row level security;
revoke all on tumbo.ofertas from public, anon, authenticated;

-- Desde cuándo cada producto está a la venta (publicado o pausado) a su
-- precio actual o a uno mayor: el precio que se puede tachar es uno que de
-- verdad se cobró durante los días de referencia. Lo lleva un disparador
-- sobre productos: la primera publicación y cada subida de precio lo
-- reinician (también una subida fuera de la venta); una baja no, y el
-- precio de lista vigente es entonces el menor de la ventana.
create table tumbo.precio_referencia (
  sku         text primary key check (char_length(sku) <= 40),
  precio_usd  numeric(12,2) not null,
  desde       timestamptz not null,
  actualizado timestamptz not null default now()
);
alter table tumbo.precio_referencia enable row level security;
revoke all on tumbo.precio_referencia from public, anon, authenticated;

create function tumbo_privado.producto_precio_referencia() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estado in ('publicado', 'pausado') then
    insert into tumbo.precio_referencia as r (sku, precio_usd, desde) values (new.sku, new.precio_usd, now())
    on conflict (sku) do update
      set desde = case when excluded.precio_usd > r.precio_usd then now() else r.desde end,
          precio_usd = excluded.precio_usd, actualizado = now();
  elsif tg_op = 'UPDATE' and new.precio_usd > old.precio_usd then
    update tumbo.precio_referencia set precio_usd = new.precio_usd, desde = now(), actualizado = now() where sku = new.sku;
  end if;
  return null;
end $$;

create trigger productos_precio_referencia after insert or update of estado, precio_usd on tumbo.productos
  for each row execute function tumbo_privado.producto_precio_referencia();

-- Lo que ya está a la venta al aplicar esta migración: desde su creación o
-- desde su última subida de precio registrada (lo que sea posterior).
insert into tumbo.precio_referencia (sku, precio_usd, desde)
select p.sku, p.precio_usd,
       greatest(p.creado, coalesce((select max(h.fecha) from tumbo.precio_historial h where h.sku = p.sku and h.despues > h.antes), p.creado))
from tumbo.productos p where p.estado in ('publicado', 'pausado')
on conflict (sku) do nothing;

-- Desde cuándo se puede mostrar el precio de lista de un producto tachado
-- (una oferta de precio o relámpago): lleva los días de referencia
-- (promociones.referencia_dias) a la venta sin subirlo. Null: no está a la
-- venta (p. ej. sigue en revisión).
create function tumbo_privado.tachable_desde(p tumbo.productos) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when p.estado in ('publicado', 'pausado') then
    greatest((select r.desde from tumbo.precio_referencia r where r.sku = p.sku),
             (select max(h.fecha) from tumbo.precio_historial h where h.sku = p.sku and h.despues > h.antes))
    + make_interval(days => tumbo_privado.numero(coalesce(tumbo_privado.ajuste('promociones'), '{}'::jsonb) -> 'referencia_dias', 7)::integer)
  end
$$;

-- Cupones: código, % o monto, compra mínima, tope de descuento, usos en
-- total y por persona, vigencia, quién lo financia (Tumbo: aplica a todo el
-- carrito; el comercio: solo a sus productos) y presupuesto.
create table tumbo.cupones (
  id                 bigint generated always as identity primary key,
  codigo             text not null check (codigo ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  descripcion        text check (descripcion is null or char_length(descripcion) <= 160),
  tipo               text not null check (tipo in ('porcentaje', 'monto')),
  valor              numeric(12,2) not null check (valor > 0),
  minimo_usd         numeric(12,2) not null default 0 check (minimo_usd >= 0),
  tope_descuento_usd numeric(12,2) check (tope_descuento_usd is null or tope_descuento_usd > 0),
  usos_max           integer check (usos_max is null or usos_max between 1 and 100000),
  usos_por_usuario   integer not null default 1 check (usos_por_usuario between 1 and 100),
  desde              timestamptz not null,
  hasta              timestamptz not null,
  financia           text not null check (financia in ('tumbo', 'seller')),
  seller_id          text check (seller_id is null or char_length(seller_id) <= 30),
  presupuesto_usd    numeric(12,2) check (presupuesto_usd is null or presupuesto_usd > 0),
  activo             boolean not null default true,
  campana_id         bigint,
  demo               boolean not null default false,
  por_id             uuid,
  por                text,
  creado             timestamptz not null default now(),
  check (hasta > desde),
  check ((financia = 'seller') = (seller_id is not null)),
  check (tipo = 'monto' or valor <= 90)
);
create unique index cupones_codigo_activo_idx on tumbo.cupones (codigo) where activo;
alter table tumbo.cupones enable row level security;
revoke all on tumbo.cupones from public, anon, authenticated;

-- Lo que cada checkout aplicó (sin claves foráneas: el reinicio de la demo
-- vacía pedidos y pagos). Una oferta cuenta sus unidades por pedido no
-- cancelado; un cupón, sus usos y su presupuesto por pago no cancelado,
-- vencido ni rechazado: lo que no se pagó no gasta nada.
create table tumbo.promociones_aplicadas (
  id            bigint generated always as identity primary key,
  pago_id       text not null,
  pedido_id     text,
  comprador_id  uuid,
  seller_id     text,
  sku           text,
  oferta_id     bigint,
  cupon_id      bigint,
  unidades      integer,
  descuento_usd numeric(12,2) not null check (descuento_usd >= 0),
  financia      text not null check (financia in ('seller', 'tumbo')),
  creado        timestamptz not null default now(),
  check ((oferta_id is null) <> (cupon_id is null))
);
create index promociones_aplicadas_oferta_idx on tumbo.promociones_aplicadas (oferta_id) where oferta_id is not null;
create index promociones_aplicadas_cupon_idx on tumbo.promociones_aplicadas (cupon_id) where cupon_id is not null;
alter table tumbo.promociones_aplicadas enable row level security;
revoke all on tumbo.promociones_aplicadas from public, anon, authenticated;

-- Topes por red de las consultas públicas de cupones (sin bitácora).
create unlogged table tumbo.topes_crecimiento (
  red     text not null,
  tipo    text not null,
  ventana timestamptz not null,
  n       integer not null default 0,
  primary key (red, tipo, ventana)
);
alter table tumbo.topes_crecimiento enable row level security;
revoke all on tumbo.topes_crecimiento from public, anon, authenticated;

-- Suma p_n al contador de la red en la ventana; true si se pasó del tope.
-- (La red «desconocida», sin la cabecera del borde, no se limita.)
create function tumbo_privado.tope_red(p_tipo text, p_minutos integer, p_tope integer, p_n integer default 1) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_red text := tumbo_privado.ip_cliente();
  v_ventana timestamptz := date_bin(make_interval(mins => p_minutos), now(), timestamptz '2000-01-01');
  v_n integer;
begin
  if v_red is null or v_red = 'desconocida' then
    return false;
  end if;
  if random() < 0.01 then
    delete from tumbo.topes_crecimiento where ventana < now() - interval '1 day';
  end if;
  insert into tumbo.topes_crecimiento as t (red, tipo, ventana, n) values (v_red, p_tipo, v_ventana, greatest(p_n, 1))
  on conflict (red, tipo, ventana) do update set n = t.n + greatest(p_n, 1)
  returning n into v_n;
  return v_n > p_tope;
end $$;

-- Códigos de cupón probados por persona y por red en ventanas de 10
-- minutos (sin bitácora): contra la adivinación de códigos, que son dinero.
create unlogged table tumbo.cupon_intentos (
  clave   text not null,
  ventana timestamptz not null,
  codigo  text not null,
  primary key (clave, ventana, codigo)
);
alter table tumbo.cupon_intentos enable row level security;
revoke all on tumbo.cupon_intentos from public, anon, authenticated;

-- ¿Puede probar este código? Cuenta los códigos distintos de la ventana: la
-- persona hasta promociones.cupones_intentos (10); en una cuenta de prueba
-- (compartida) por cuenta y red, con un respaldo de diez veces por cuenta;
-- la red, el triple (varias personas pueden salir por la misma). Un código
-- ya probado en la ventana no vuelve a contar (la cotización y el checkout
-- lo consultan varias veces). Lo usa el contrato aplicar_promociones, así
-- vale para tm_promociones_cotizar y para el checkout de Pagos.
create function tumbo_privado.cupon_intento(p_usuario uuid, p_codigo text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_tope integer := greatest(tumbo_privado.numero(coalesce(tumbo_privado.ajuste('promociones'), '{}'::jsonb) -> 'cupones_intentos', 10), 3)::integer;
  v_ventana timestamptz := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01');
  v_red text := tumbo_privado.ip_cliente();
  v_demo boolean := false;
  v_claves text[] := '{}';
  v_topes integer[] := '{}';
  i integer;
begin
  if p_usuario is not null then
    v_demo := exists (select 1 from tumbo.usuarios u where u.id = p_usuario and tumbo_privado.cuenta_demo(u.email));
    if v_demo then
      v_claves := v_claves || ('usr:' || p_usuario || '@' || coalesce(v_red, 'desconocida')) || ('usr:' || p_usuario);
      v_topes := v_topes || v_tope || v_tope * 10;
    else
      v_claves := v_claves || ('usr:' || p_usuario);
      v_topes := v_topes || v_tope;
    end if;
  end if;
  if v_red is not null and v_red <> 'desconocida' then
    v_claves := v_claves || ('red:' || v_red);
    v_topes := v_topes || v_tope * 3;
  end if;
  for i in 1 .. coalesce(cardinality(v_claves), 0) loop
    if not exists (select 1 from tumbo.cupon_intentos c where c.clave = v_claves[i] and c.ventana = v_ventana and c.codigo = p_codigo)
       and (select count(*) from tumbo.cupon_intentos c where c.clave = v_claves[i] and c.ventana = v_ventana) >= v_topes[i] then
      return false;
    end if;
  end loop;
  for i in 1 .. coalesce(cardinality(v_claves), 0) loop
    insert into tumbo.cupon_intentos (clave, ventana, codigo) values (v_claves[i], v_ventana, p_codigo) on conflict do nothing;
  end loop;
  if random() < 0.01 then
    delete from tumbo.cupon_intentos where ventana < now() - interval '1 hour';
  end if;
  return true;
end $$;

-- Unidades vendidas de una oferta y usos de un cupón (lo pagado o por pagar).
create function tumbo_privado.oferta_vendidas(p_oferta bigint) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.unidades), 0)::integer
  from tumbo.promociones_aplicadas a join tumbo.pedidos p on p.id = a.pedido_id
  where a.oferta_id = p_oferta and p.estado <> 'cancelado'
$$;
create function tumbo_privado.cupon_uso(p_cupon bigint, p_usuario uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'usos', count(distinct a.pago_id),
    'usos_usuario', count(distinct a.pago_id) filter (where p_usuario is not null and a.comprador_id = p_usuario),
    'gastado_usd', coalesce(sum(a.descuento_usd), 0))
  from tumbo.promociones_aplicadas a join tumbo.pagos g on g.id = a.pago_id
  where a.cupon_id = p_cupon and g.estado in ('pendiente', 'reportado', 'verificado')
$$;

-- La mejor oferta vigente para una línea (sin acumular ofertas): {id, tipo,
-- descuento_usd, unidades, financia, precio_oferta_usd, ...} o null.
create function tumbo_privado.mejor_oferta(p_sku text, p_cant integer, p_precio numeric) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  o tumbo.ofertas;
  v_desc numeric;
  v_uni integer;
  v_mejor jsonb;
  v_mejor_desc numeric := 0;
  v_minimo numeric := (select p.precio_minimo from tumbo.productos p where p.sku = p_sku);
begin
  for o in select * from tumbo.ofertas x
           where x.sku = p_sku and x.activa and x.desde <= now() and x.hasta > now() and p_precio <= x.precio_referencia_usd
           order by x.id loop
    v_desc := 0;
    v_uni := p_cant;
    -- ninguna oferta deja la unidad por debajo del precio mínimo que rige hoy
    continue when v_minimo is not null
      and coalesce(o.precio_oferta_usd, round(p_precio * (1 - o.descuento_pct / 100), 2)) < v_minimo;
    if o.tipo = 'cantidad' then
      if p_cant >= o.cantidad_min then
        v_desc := round(p_precio * p_cant * o.descuento_pct / 100, 2);
      end if;
    elsif o.precio_oferta_usd < p_precio then
      if o.tipo = 'relampago' then
        v_uni := least(p_cant, greatest(o.stock_oferta - tumbo_privado.oferta_vendidas(o.id), 0));
      end if;
      v_desc := round((p_precio - o.precio_oferta_usd) * v_uni, 2);
    end if;
    if v_desc > v_mejor_desc then
      v_mejor_desc := v_desc;
      v_mejor := jsonb_build_object('id', o.id, 'tipo', o.tipo, 'descuento_usd', v_desc, 'unidades', v_uni, 'financia', o.financia,
                                    'precio_oferta_usd', o.precio_oferta_usd, 'descuento_pct', o.descuento_pct,
                                    'cantidad_min', o.cantidad_min, 'hasta', o.hasta);
    end if;
  end loop;
  return v_mejor;
end $$;

-- El cálculo de las promociones de un carrito: devuelve las líneas con su
-- descuento (y quién lo financia), el descuento total (lo que excede a las
-- líneas es el cupón de Tumbo, que el checkout reparte entre los
-- comercios), las promociones aplicadas y el cupón si es válido (si no,
-- cupon = null y cupon_error dice por qué: el mismo mensaje para un código
-- que no existe y para uno que no aplica, salvo la compra mínima y el uso
-- ya hecho por la misma persona). Con p_contar, un código nuevo cuenta para
-- el tope de códigos probados (cupon_intento); el registro del checkout
-- (registrar_promociones) vuelve a calcular sin contar.
create function tumbo_privado.calcular_promociones(p_usuario uuid, p_items jsonb, p_cupon text, p_contar boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text := nullif(upper(btrim(coalesce(p_cupon, ''))), '');
  v_no_valido text := 'El cupón ' || coalesce(nullif(upper(btrim(coalesce(p_cupon, ''))), ''), '') || ' no es válido o no aplica a este carrito.';
  l record;
  b jsonb;
  v_lineas jsonb := '[]'::jsonb;
  v_promos jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_desc_lineas numeric := 0;
  c tumbo.cupones;
  v_uso jsonb;
  v_error text;
  v_elegible numeric := 0;
  v_desc_cupon numeric := 0;
  v_resto numeric;
  v_n integer;
  v_i integer;
  x jsonb;
  v_parte numeric;
  v_lineas2 jsonb := '[]'::jsonb;
begin
  for l in
    select i.sku, greatest(least(coalesce(i.cant, 1), 1000), 1) as cant, p.precio_usd, p.seller_id, p.nombre
    from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as i (sku text, cant integer)
    join tumbo.productos p on p.sku = i.sku
    order by i.sku
  loop
    b := tumbo_privado.mejor_oferta(l.sku, l.cant, l.precio_usd);
    v_sub := v_sub + l.precio_usd * l.cant;
    v_desc_lineas := v_desc_lineas + coalesce((b ->> 'descuento_usd')::numeric, 0);
    v_lineas := v_lineas || jsonb_build_object('sku', l.sku, 'cant', l.cant, 'precio_usd', l.precio_usd, 'seller_id', l.seller_id,
      'descuento_usd', coalesce((b ->> 'descuento_usd')::numeric, 0),
      'total_usd', l.precio_usd * l.cant - coalesce((b ->> 'descuento_usd')::numeric, 0),
      'financia', coalesce(b ->> 'financia', 'seller'), 'oferta', b);
    if b is not null then
      v_promos := v_promos || jsonb_build_object('tipo', 'oferta', 'id', (b ->> 'id')::bigint, 'oferta', b ->> 'tipo', 'sku', l.sku,
        'nombre', l.nombre, 'seller_id', l.seller_id, 'descuento_usd', (b ->> 'descuento_usd')::numeric,
        'unidades', (b ->> 'unidades')::integer, 'financia', b ->> 'financia');
    end if;
  end loop;

  if v_codigo is not null and (char_length(v_codigo) > 24 or v_codigo !~ '^[A-Z0-9][A-Z0-9_-]+$') then
    v_error := v_no_valido;
  elsif v_codigo is not null and p_contar and not tumbo_privado.cupon_intento(p_usuario, v_codigo) then
    v_error := 'Probaste muchos códigos de cupón distintos seguidos: espera unos minutos.';
  elsif v_codigo is not null then
    select * into c from tumbo.cupones where codigo = v_codigo and activo order by id desc limit 1;
    if not found or c.desde > now() or c.hasta <= now() then
      v_error := v_no_valido;
    else
      v_uso := tumbo_privado.cupon_uso(c.id, p_usuario);
      if p_usuario is not null and (v_uso ->> 'usos_usuario')::integer >= c.usos_por_usuario then
        v_error := 'Ya usaste el cupón ' || v_codigo || case when c.usos_por_usuario = 1 then '.' else ' ' || c.usos_por_usuario || ' veces.' end;
      elsif (c.usos_max is not null and (v_uso ->> 'usos')::integer >= c.usos_max)
            or (c.presupuesto_usd is not null and (v_uso ->> 'gastado_usd')::numeric >= c.presupuesto_usd) then
        v_error := v_no_valido;
      end if;
    end if;
    if v_error is null then
      select coalesce(sum((x2 ->> 'total_usd')::numeric), 0), count(*) into v_elegible, v_n
      from jsonb_array_elements(v_lineas) x2
      where (x2 ->> 'total_usd')::numeric > 0
        and (c.seller_id is null or (x2 ->> 'seller_id' = c.seller_id and x2 ->> 'financia' = 'seller'));
      if v_n = 0 then
        v_error := v_no_valido;
      elsif v_elegible < c.minimo_usd then
        v_error := 'El cupón ' || v_codigo || ' pide una compra mínima de ' || tumbo_privado.fmt_usd(c.minimo_usd) ||
                   case when c.seller_id is not null then ' en productos de ese comercio' else '' end || '.';
      else
        v_desc_cupon := case when c.tipo = 'porcentaje' then round(v_elegible * c.valor / 100, 2) else least(c.valor, v_elegible) end;
        if c.tope_descuento_usd is not null then
          v_desc_cupon := least(v_desc_cupon, c.tope_descuento_usd);
        end if;
        if c.presupuesto_usd is not null then
          v_desc_cupon := least(v_desc_cupon, c.presupuesto_usd - (v_uso ->> 'gastado_usd')::numeric);
        end if;
        v_desc_cupon := greatest(least(v_desc_cupon, v_elegible), 0);
      end if;
    end if;
    if v_error is null and v_desc_cupon > 0 then
      if c.financia = 'seller' then
        -- el cupón del comercio va en sus líneas, en proporción a su monto
        v_resto := v_desc_cupon;
        v_i := 0;
        for x in select * from jsonb_array_elements(v_lineas) loop
          if x ->> 'seller_id' = c.seller_id and x ->> 'financia' = 'seller' and (x ->> 'total_usd')::numeric > 0 then
            v_i := v_i + 1;
            v_parte := case when v_i = v_n then v_resto
                            else least(round(v_desc_cupon * (x ->> 'total_usd')::numeric / v_elegible, 2), v_resto) end;
            v_parte := least(v_parte, (x ->> 'total_usd')::numeric);
            v_resto := v_resto - v_parte;
            x := x || jsonb_build_object('descuento_usd', (x ->> 'descuento_usd')::numeric + v_parte,
                                         'total_usd', (x ->> 'total_usd')::numeric - v_parte, 'cupon_usd', v_parte);
          end if;
          v_lineas2 := v_lineas2 || x;
        end loop;
        v_lineas := v_lineas2;
        v_desc_cupon := v_desc_cupon - v_resto;
        v_desc_lineas := v_desc_lineas + v_desc_cupon;
      end if;
      v_promos := v_promos || jsonb_build_object('tipo', 'cupon', 'id', c.id, 'codigo', c.codigo, 'descuento_usd', v_desc_cupon,
                                                 'financia', c.financia, 'seller_id', c.seller_id, 'descripcion', c.descripcion);
    elsif v_error is null then
      v_error := v_no_valido;
    end if;
  end if;

  return jsonb_build_object(
    'lineas', v_lineas,
    'subtotal_usd', v_sub,
    'descuento_usd', v_desc_lineas + case when v_error is null and c.financia = 'tumbo' then v_desc_cupon else 0 end,
    'total_usd', v_sub - v_desc_lineas - case when v_error is null and c.financia = 'tumbo' then v_desc_cupon else 0 end,
    'promociones', v_promos,
    'cupon', case when v_codigo is not null and v_error is null then c.codigo end,
    'cupon_error', v_error);
end $$;

-- Contrato aplicar_promociones (Crecimiento; la ola 0 dejó las líneas sin
-- descuento). Lo llama el checkout de Pagos (checkout_calcular, también en
-- tm_checkout_cotizar) con el carrito: el cálculo de arriba, con el tope de
-- códigos de cupón probados (es volátil: lo cuenta).
create or replace function tumbo_privado.aplicar_promociones(p_usuario uuid, p_items jsonb, p_cupon text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return tumbo_privado.calcular_promociones(p_usuario, p_items, p_cupon, true);
end $$;

-- Registra lo que aplicó el checkout en un pedido recién creado (lo llama
-- el disparador de pedidos, con el carrito todavía completo). Bloquea las
-- ofertas de sus productos y el cupón del pago y vuelve a calcular: si una
-- relámpago se agotó, un cupón llegó a su tope o el descuento cambió
-- mientras el comprador confirmaba, rechaza el checkout (nada se crea). Se
-- compara con lo que cobró el checkout tanto lo que financia el comercio
-- (por pedido) como el descuento de todo el pago (también lo de Tumbo: su
-- cupón y sus ofertas), así dos checkouts a la vez no gastan más que el
-- presupuesto de un cupón ni lo registrado difiere de lo cobrado.
create function tumbo_privado.registrar_promociones(p_yo tumbo.usuarios, v tumbo.pedidos, g tumbo.pagos) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb;
  promo jsonb;
  x jsonb;
  o tumbo.ofertas;
  c tumbo.cupones;
  v_uso jsonb;
  v_desc_seller numeric := 0;
begin
  perform 1 from tumbo.ofertas o2
  where o2.activa and o2.sku in (select ci.sku from tumbo.carrito_items ci join tumbo.productos p on p.sku = ci.sku
                                 where ci.usuario_id = v.comprador_id and p.seller_id = v.seller_id)
  order by o2.id for update;
  if g.cupon is not null then
    perform 1 from tumbo.cupones c2 where c2.codigo = g.cupon and c2.activo order by c2.id for update;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku', ci.sku, 'cant', ci.cant) order by ci.sku), '[]'::jsonb) into v_items
  from tumbo.carrito_items ci where ci.usuario_id = v.comprador_id;
  promo := tumbo_privado.calcular_promociones(v.comprador_id, v_items, g.cupon, false);
  if g.cupon is not null and nullif(promo ->> 'cupon', '') is null then
    raise exception 'El cupón % ya no se puede usar (%): quítalo y revisa el total.', g.cupon,
      coalesce(promo ->> 'cupon_error', 'llegó a su tope mientras confirmabas');
  end if;
  -- lo que financia el comercio en sus líneas debe ser lo que cobró el checkout
  select coalesce(sum((l ->> 'descuento_usd')::numeric), 0) into v_desc_seller
  from jsonb_array_elements(promo -> 'lineas') l
  where l ->> 'seller_id' = v.seller_id and coalesce(l ->> 'financia', 'seller') = 'seller';
  if abs(round(v_desc_seller, 2) - coalesce(v.descuento_usd, 0)) >= 0.01 then
    raise exception 'Las promociones de tu carrito cambiaron mientras confirmabas (una oferta terminó o se agotó): revisa el total.';
  end if;
  -- y el descuento de todo el pago (con el cupón y las ofertas de Tumbo),
  -- calculado ya con el cupón bloqueado, debe ser el que se cobró
  if abs(round(coalesce((promo ->> 'descuento_usd')::numeric, 0), 2) - coalesce(g.descuento_usd, 0)) >= 0.01 then
    raise exception 'Las promociones de tu carrito cambiaron mientras confirmabas (un cupón u oferta llegó a su tope): revisa el total.';
  end if;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(promo -> 'promociones') = 'array' then promo -> 'promociones' else '[]'::jsonb end) loop
    if x ->> 'tipo' = 'oferta' and x ->> 'seller_id' = v.seller_id then
      select * into o from tumbo.ofertas where id = (x ->> 'id')::bigint;
      if o.tipo = 'relampago' and tumbo_privado.oferta_vendidas(o.id) + (x ->> 'unidades')::integer > o.stock_oferta then
        raise exception 'La oferta relámpago de «%» se agotó mientras confirmabas: revisa el total.', x ->> 'nombre';
      end if;
      insert into tumbo.promociones_aplicadas (pago_id, pedido_id, comprador_id, seller_id, sku, oferta_id, unidades, descuento_usd, financia)
      values (g.id, v.id, v.comprador_id, v.seller_id, x ->> 'sku', o.id, (x ->> 'unidades')::integer, (x ->> 'descuento_usd')::numeric, o.financia);
    elsif x ->> 'tipo' = 'cupon' and (x ->> 'seller_id' = v.seller_id
                                     or (x ->> 'seller_id' is null and not exists (select 1 from tumbo.promociones_aplicadas a
                                                                                   where a.pago_id = g.id and a.cupon_id = (x ->> 'id')::bigint))) then
      select * into c from tumbo.cupones where id = (x ->> 'id')::bigint;
      insert into tumbo.promociones_aplicadas (pago_id, pedido_id, comprador_id, seller_id, cupon_id, descuento_usd, financia)
      values (g.id, case when c.seller_id is not null then v.id end, v.comprador_id, c.seller_id, c.id, (x ->> 'descuento_usd')::numeric, c.financia);
      -- (de respaldo: con lo registrado, el cupón no pasa su presupuesto ni sus usos)
      v_uso := tumbo_privado.cupon_uso(c.id, null);
      if (c.presupuesto_usd is not null and (v_uso ->> 'gastado_usd')::numeric > c.presupuesto_usd + 0.005)
         or (c.usos_max is not null and (v_uso ->> 'usos')::integer > c.usos_max) then
        raise exception 'El cupón % llegó a su tope mientras confirmabas: quítalo y revisa el total.', c.codigo;
      end if;
    end if;
  end loop;
end $$;

-- Lo que la ficha muestra de un producto: sus ofertas vigentes (con el
-- precio de lista tachado, la cuenta regresiva y las unidades que quedan de
-- una relámpago) y el nivel de su comercio.
create function public.tm_promos_producto(p_sku text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sku', p.sku,
    'ofertas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'precio_usd', p.precio_usd,
                                         'precio_oferta_usd', o.precio_oferta_usd,
                                         'ahorro_pct', case when o.precio_oferta_usd is not null then round(100 * (1 - o.precio_oferta_usd / p.precio_usd)) end,
                                         'descuento_pct', o.descuento_pct, 'cantidad_min', o.cantidad_min, 'hasta', o.hasta,
                                         'quedan', case when o.tipo = 'relampago' then greatest(o.stock_oferta - tumbo_privado.oferta_vendidas(o.id), 0) end,
                                         'stock_oferta', o.stock_oferta) order by o.tipo, o.id)
                         from tumbo.ofertas o
                         where o.sku = p.sku and o.activa and o.desde <= now() and o.hasta > now() and p.precio_usd <= o.precio_referencia_usd
                           and (o.tipo = 'cantidad' or o.precio_oferta_usd < p.precio_usd)
                           and (p.precio_minimo is null or coalesce(o.precio_oferta_usd, round(p.precio_usd * (1 - o.descuento_pct / 100), 2)) >= p.precio_minimo)
                           and (o.tipo <> 'relampago' or o.stock_oferta > tumbo_privado.oferta_vendidas(o.id))), '[]'::jsonb),
    'nivel', (select jsonb_build_object('nivel', n.nivel,
                     'nombre', (select z ->> 'nombre' from jsonb_array_elements(coalesce(tumbo_privado.ajuste('niveles') -> 'niveles', '[]'::jsonb)) z
                                where z ->> 'id' = n.nivel limit 1))
              from tumbo.niveles_seller n where n.seller_id = p.seller_id and n.nivel is not null))
  from tumbo.productos p
  join tumbo.sellers s on s.id = p.seller_id
  where p.sku = p_sku and p.estado = 'publicado' and s.estado = 'aprobado'
$$;

-- La oferta de precio vigente de varios productos (hasta 100) para las
-- tarjetas, las colecciones y el carrito: {sku: {precio_usd, precio_oferta_usd, tipo, hasta}}.
create function public.tm_promos_skus(p_skus text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(q.sku, q.o), '{}'::jsonb) from (
    select distinct on (p.sku) p.sku, jsonb_build_object('tipo', o.tipo, 'precio_usd', p.precio_usd, 'precio_oferta_usd', o.precio_oferta_usd,
                                                         'hasta', o.hasta,
                                                         'quedan', case when o.tipo = 'relampago' then greatest(o.stock_oferta - tumbo_privado.oferta_vendidas(o.id), 0) end) as o
    from tumbo.productos p join tumbo.ofertas o on o.sku = p.sku
    where p.sku = any ((coalesce(p_skus, '{}'))[1:100]) and p.estado = 'publicado'
      and o.activa and o.desde <= now() and o.hasta > now() and o.tipo in ('precio', 'relampago')
      and p.precio_usd <= o.precio_referencia_usd and o.precio_oferta_usd < p.precio_usd
      and (p.precio_minimo is null or o.precio_oferta_usd >= p.precio_minimo)
      and (o.tipo <> 'relampago' or o.stock_oferta > tumbo_privado.oferta_vendidas(o.id))
    order by p.sku, o.precio_oferta_usd, o.id) q
$$;

-- Cotiza las promociones de un carrito (el de la sesión del comprador si la
-- hay; si no, p_items) con un cupón opcional, para el carrito y el checkout.
-- Tope por red de consultas con cupón (contra la adivinación de códigos).
create function public.tm_promociones_cotizar(p_sesion text, p_items jsonb, p_cupon text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.usuario(p_sesion);
  v_items jsonb := p_items;
begin
  if nullif(btrim(coalesce(p_cupon, '')), '') is not null and tumbo_privado.tope_red('cupon', 10, 40) then
    raise exception 'Probaste muchos cupones seguidos: espera unos minutos.';
  end if;
  if yo.id is not null and yo.rol = 'comprador' then
    select coalesce(jsonb_agg(jsonb_build_object('sku', c.sku, 'cant', c.cant) order by c.sku), '[]'::jsonb) into v_items
    from tumbo.carrito_items c where c.usuario_id = yo.id;
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) > 100 then
    v_items := '[]'::jsonb;
  end if;
  return tumbo_privado.aplicar_promociones(case when yo.rol = 'comprador' then yo.id end, v_items, p_cupon);
end $$;

-- Portada: banners y colecciones vigentes (públicos).
create function public.tm_marketing_portada() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'banners', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'titulo', b.titulo, 'texto', b.texto, 'enlace', b.enlace,
                                                             'boton', b.boton, 'tono', b.tono, 'hasta', b.hasta,
                                                             'imagen', tumbo_privado.url_publica(b.imagen)) order by b.orden, b.id)
                         from tumbo.banners b
                         where b.activo and b.desde <= now() and b.hasta > now()
                           and (b.campana_id is null or exists (select 1 from tumbo.campanas k where k.id = b.campana_id and k.activa))), '[]'::jsonb),
    'colecciones', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'titulo', c.titulo, 'descripcion', c.descripcion,
                                                                 'skus', (select coalesce(jsonb_agg(p.sku order by array_position(c.skus, p.sku)), '[]'::jsonb)
                                                                          from tumbo.productos p join tumbo.sellers s on s.id = p.seller_id
                                                                          where p.sku = any (c.skus) and p.estado = 'publicado' and s.estado = 'aprobado'))
                                              order by c.orden, c.id)
                             from tumbo.colecciones c
                             where c.activa and c.desde <= now() and c.hasta > now()
                               and (c.campana_id is null or exists (select 1 from tumbo.campanas k where k.id = c.campana_id and k.activa))), '[]'::jsonb))
$$;

-- Una colección vigente por su slug (pública).
create function public.tm_coleccion(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug', c.slug, 'titulo', c.titulo, 'descripcion', c.descripcion, 'hasta', c.hasta,
    'skus', (select coalesce(jsonb_agg(p.sku order by array_position(c.skus, p.sku)), '[]'::jsonb)
             from tumbo.productos p join tumbo.sellers s on s.id = p.seller_id
             where p.sku = any (c.skus) and p.estado = 'publicado' and s.estado = 'aprobado'))
  from tumbo.colecciones c
  where c.slug = p_slug and c.activa and c.desde <= now() and c.hasta > now()
$$;

-- Quién gestiona el marketing de Tumbo: el superadministrador u Operaciones
-- con «marketing», con sesión elevada (lo que publica sale en la portada
-- pública y los cupones de Tumbo son dinero).
create function tumbo_privado.exigir_marketing(p_sesion text) returns tumbo.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['superadmin', 'ops']);
begin
  perform tumbo_privado.exigir_permiso(yo, 'marketing');
  perform tumbo_privado.exigir_elevada(yo);
  return yo;
end $$;

create function tumbo_privado.fecha_json(p jsonb, p_omision timestamptz) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) = 'null' or btrim(p #>> '{}') = '' then
    return p_omision;
  end if;
  return (p #>> '{}')::timestamptz;
exception when others then
  raise exception 'Revisa las fechas: «%» no es una fecha válida.', left(p #>> '{}', 40);
end $$;

-- Campaña: {id?, nombre, descripcion, desde, hasta, color, activa}.
create function public.tm_campana_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_marketing(p_sesion);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_id bigint := tumbo_privado.num_json(d -> 'id')::bigint;
  v_nombre text := left(regexp_replace(btrim(coalesce(d ->> 'nombre', '')), '[[:cntrl:]<>]+', ' ', 'g'), 80);
  v_desc text := nullif(left(regexp_replace(btrim(coalesce(d ->> 'descripcion', '')), '[[:cntrl:]<>]+', ' ', 'g'), 300), '');
  v_desde timestamptz := tumbo_privado.fecha_json(d -> 'desde', now());
  v_hasta timestamptz := tumbo_privado.fecha_json(d -> 'hasta', null);
  v_color text := coalesce(nullif(d ->> 'color', ''), 'azul');
  k tumbo.campanas;
begin
  if char_length(v_nombre) < 3 then
    raise exception 'Escribe el nombre de la campaña (al menos 3 caracteres).';
  end if;
  if v_hasta is null or v_hasta <= v_desde or v_hasta > v_desde + interval '366 days' then
    raise exception 'La campaña necesita un fin posterior al inicio (hasta un año).';
  end if;
  if v_color not in ('azul', 'verde', 'ambar', 'rojo', 'violeta') then
    raise exception 'Elige un color de la lista.';
  end if;
  if v_id is not null then
    update tumbo.campanas set nombre = v_nombre, descripcion = v_desc, desde = v_desde, hasta = v_hasta, color = v_color,
                              activa = coalesce((d ->> 'activa')::boolean, activa), demo = false, por_id = yo.id, por = tumbo_privado.actor(yo)
    where id = v_id returning * into k;
    if not found then
      raise exception 'Campaña no encontrada.';
    end if;
  else
    if (select count(*) from tumbo.campanas where activa and hasta > now()) >= 100 then
      raise exception 'Hay 100 campañas vigentes o programadas.';
    end if;
    insert into tumbo.campanas (nombre, descripcion, desde, hasta, color, por_id, por)
    values (v_nombre, v_desc, v_desde, v_hasta, v_color, yo.id, tumbo_privado.actor(yo)) returning * into k;
  end if;
  perform tumbo_privado.auditar(yo, 'Campaña guardada', k.id || ' · ' || k.nombre);
  return to_jsonb(k);
end $$;

-- Banner: {id?, titulo, texto, imagen (archivo «marketing» listo), enlace
-- (app/tienda/…), boton, tono, desde, hasta, orden, campana_id, activo}.
create function public.tm_banner_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_marketing(p_sesion);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_id bigint := tumbo_privado.num_json(d -> 'id')::bigint;
  v_titulo text := left(regexp_replace(btrim(coalesce(d ->> 'titulo', '')), '[[:cntrl:]<>]+', ' ', 'g'), 80);
  v_texto text := nullif(left(regexp_replace(btrim(coalesce(d ->> 'texto', '')), '[[:cntrl:]<>]+', ' ', 'g'), 160), '');
  v_boton text := nullif(left(regexp_replace(btrim(coalesce(d ->> 'boton', '')), '[[:cntrl:]<>]+', ' ', 'g'), 30), '');
  v_enlace text := nullif(btrim(coalesce(d ->> 'enlace', '')), '');
  v_imagen uuid := tumbo_privado.uuid_o_null(d ->> 'imagen');
  v_desde timestamptz := tumbo_privado.fecha_json(d -> 'desde', now());
  v_hasta timestamptz := tumbo_privado.fecha_json(d -> 'hasta', null);
  v_campana bigint := tumbo_privado.num_json(d -> 'campana_id')::bigint;
  v_orden numeric := coalesce(tumbo_privado.num_json(d -> 'orden'), 100);
  b tumbo.banners;
begin
  if char_length(v_titulo) < 3 then
    raise exception 'Escribe el título del banner (al menos 3 caracteres).';
  end if;
  if v_enlace is not null and v_enlace !~ '^app/tienda/[a-z0-9-]+\.html(\?[A-Za-z0-9=&_.%-]{0,200})?$' then
    raise exception 'El enlace va a una página de la tienda (p. ej. app/tienda/coleccion.html?id=vuelta-a-clases).';
  end if;
  if v_imagen is not null and not exists (select 1 from tumbo.archivos a where a.id = v_imagen and a.proposito = 'marketing' and a.estado = 'listo') then
    raise exception 'La imagen no está disponible: súbela de nuevo.';
  end if;
  if v_hasta is null or v_hasta <= v_desde or v_hasta > v_desde + interval '366 days' then
    raise exception 'El banner necesita un fin posterior al inicio (hasta un año).';
  end if;
  if coalesce(d ->> 'tono', 'marca') not in ('marca', 'calido', 'fresco', 'oscuro') then
    raise exception 'Elige un tono de la lista.';
  end if;
  if v_campana is not null and not exists (select 1 from tumbo.campanas where id = v_campana) then
    raise exception 'La campaña no existe.';
  end if;
  if v_id is not null then
    update tumbo.banners
    set titulo = v_titulo, texto = v_texto, imagen = v_imagen, enlace = v_enlace, boton = v_boton, tono = coalesce(d ->> 'tono', 'marca'),
        desde = v_desde, hasta = v_hasta, orden = least(greatest(v_orden, 0), 1000)::integer, campana_id = v_campana,
        activo = coalesce((d ->> 'activo')::boolean, activo), demo = false, por_id = yo.id, por = tumbo_privado.actor(yo)
    where id = v_id returning * into b;
    if not found then
      raise exception 'Banner no encontrado.';
    end if;
  else
    if (select count(*) from tumbo.banners where activo and hasta > now()) >= 30 then
      raise exception 'Hay 30 banners vigentes o programados: desactiva alguno.';
    end if;
    insert into tumbo.banners (titulo, texto, imagen, enlace, boton, tono, desde, hasta, orden, campana_id, por_id, por)
    values (v_titulo, v_texto, v_imagen, v_enlace, v_boton, coalesce(d ->> 'tono', 'marca'), v_desde, v_hasta,
            least(greatest(v_orden, 0), 1000)::integer, v_campana, yo.id, tumbo_privado.actor(yo))
    returning * into b;
  end if;
  perform tumbo_privado.auditar(yo, 'Banner guardado', b.id || ' · ' || b.titulo);
  return to_jsonb(b) || jsonb_build_object('imagen_url', tumbo_privado.url_publica(b.imagen));
end $$;

-- Colección: {id?, slug, titulo, descripcion, skus[], desde, hasta, orden,
-- campana_id, activa}. Solo productos publicados.
create function public.tm_coleccion_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_marketing(p_sesion);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  v_id bigint := tumbo_privado.num_json(d -> 'id')::bigint;
  v_slug text := lower(btrim(coalesce(d ->> 'slug', '')));
  v_titulo text := left(regexp_replace(btrim(coalesce(d ->> 'titulo', '')), '[[:cntrl:]<>]+', ' ', 'g'), 80);
  v_desc text := nullif(left(regexp_replace(btrim(coalesce(d ->> 'descripcion', '')), '[[:cntrl:]<>]+', ' ', 'g'), 300), '');
  v_skus text[];
  v_desde timestamptz := tumbo_privado.fecha_json(d -> 'desde', now());
  v_hasta timestamptz := tumbo_privado.fecha_json(d -> 'hasta', null);
  v_campana bigint := tumbo_privado.num_json(d -> 'campana_id')::bigint;
  v_faltan text;
  k tumbo.colecciones;
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
    raise exception 'El identificador va de 3 a 40 minúsculas, números o guiones (p. ej. vuelta-a-clases).';
  end if;
  if char_length(v_titulo) < 3 then
    raise exception 'Escribe el título de la colección.';
  end if;
  if jsonb_typeof(d -> 'skus') <> 'array' then
    raise exception 'Elige los productos de la colección.';
  end if;
  select array_agg(distinct upper(btrim(x))) into v_skus from jsonb_array_elements_text(d -> 'skus') x where btrim(x) <> '';
  if coalesce(cardinality(v_skus), 0) not between 1 and 24 then
    raise exception 'Una colección lleva de 1 a 24 productos.';
  end if;
  select string_agg(x, ', ') into v_faltan from unnest(v_skus) x
  where not exists (select 1 from tumbo.productos p where p.sku = x and p.estado = 'publicado');
  if v_faltan is not null then
    raise exception 'Estos productos no están publicados: %.', left(v_faltan, 200);
  end if;
  if v_hasta is null or v_hasta <= v_desde or v_hasta > v_desde + interval '366 days' then
    raise exception 'La colección necesita un fin posterior al inicio (hasta un año).';
  end if;
  if v_campana is not null and not exists (select 1 from tumbo.campanas where id = v_campana) then
    raise exception 'La campaña no existe.';
  end if;
  if v_id is not null then
    update tumbo.colecciones
    set slug = v_slug, titulo = v_titulo, descripcion = v_desc, skus = v_skus, desde = v_desde, hasta = v_hasta,
        orden = least(greatest(coalesce(tumbo_privado.num_json(d -> 'orden'), 100), 0), 1000)::integer, campana_id = v_campana,
        activa = coalesce((d ->> 'activa')::boolean, activa), demo = false, por_id = yo.id, por = tumbo_privado.actor(yo)
    where id = v_id returning * into k;
    if not found then
      raise exception 'Colección no encontrada.';
    end if;
  else
    if exists (select 1 from tumbo.colecciones where slug = v_slug) then
      raise exception 'Ya hay una colección «%».', v_slug;
    end if;
    if (select count(*) from tumbo.colecciones where activa and hasta > now()) >= 30 then
      raise exception 'Hay 30 colecciones vigentes o programadas.';
    end if;
    insert into tumbo.colecciones (slug, titulo, descripcion, skus, desde, hasta, orden, campana_id, por_id, por)
    values (v_slug, v_titulo, v_desc, v_skus, v_desde, v_hasta,
            least(greatest(coalesce(tumbo_privado.num_json(d -> 'orden'), 100), 0), 1000)::integer, v_campana, yo.id, tumbo_privado.actor(yo))
    returning * into k;
  end if;
  perform tumbo_privado.auditar(yo, 'Colección guardada', k.slug || ' · ' || cardinality(k.skus) || ' productos');
  return to_jsonb(k);
end $$;

-- Una oferta: {sku, tipo, precio_oferta_usd | (descuento_pct, cantidad_min),
-- stock_oferta (relámpago), desde, hasta, campana_id}. El comercio (seller o
-- gestor de precios) en sus productos, financiada por él; el equipo de
-- marketing, financiada por Tumbo. El precio tachado es el de lista, que no
-- debe haber subido en los últimos días (ajuste promociones.referencia_dias).
create function public.tm_oferta_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'precios', 'superadmin', 'ops']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  cfg jsonb := coalesce(tumbo_privado.ajuste('promociones'), '{}'::jsonb);
  v_max_pct numeric := tumbo_privado.numero(cfg -> 'descuento_max_pct', 70);
  v_dias_ref numeric := tumbo_privado.numero(cfg -> 'referencia_dias', 7);
  p tumbo.productos;
  v_tipo text := d ->> 'tipo';
  v_precio numeric := tumbo_privado.num_json(d -> 'precio_oferta_usd');
  v_pct numeric := tumbo_privado.num_json(d -> 'descuento_pct');
  v_min numeric := tumbo_privado.num_json(d -> 'cantidad_min');
  v_stock numeric := tumbo_privado.num_json(d -> 'stock_oferta');
  v_desde timestamptz := tumbo_privado.fecha_json(d -> 'desde', now());
  v_hasta timestamptz := tumbo_privado.fecha_json(d -> 'hasta', null);
  v_campana bigint := tumbo_privado.num_json(d -> 'campana_id')::bigint;
  v_financia text;
  o tumbo.ofertas;
begin
  if yo.rol in ('superadmin', 'ops') then
    perform tumbo_privado.exigir_permiso(yo, 'marketing');
    perform tumbo_privado.exigir_elevada(yo);
    v_financia := 'tumbo';
  else
    v_financia := 'seller';
  end if;
  select * into p from tumbo.productos where sku = upper(btrim(coalesce(d ->> 'sku', ''))) for update;
  if not found or (v_financia = 'seller' and p.seller_id is distinct from yo.seller_id) then
    raise exception 'Producto % no encontrado.', left(coalesce(d ->> 'sku', ''), 40);
  end if;
  if p.estado not in ('publicado', 'pausado', 'en_revision') then
    raise exception 'Solo se ofertan productos publicados, pausados o en revisión.';
  end if;
  if v_tipo not in ('precio', 'relampago', 'cantidad') then
    raise exception 'Elige el tipo de oferta: precio anterior, relámpago o por cantidad.';
  end if;
  if v_hasta is null or v_hasta <= v_desde then
    raise exception 'La oferta necesita un fin posterior al inicio.';
  end if;
  if v_desde < now() - interval '5 minutes' or v_desde > now() + interval '180 days' then
    raise exception 'La oferta empieza desde ahora y hasta dentro de 180 días.';
  end if;
  if v_hasta > v_desde + interval '90 days' then
    raise exception 'Una oferta dura como mucho 90 días.';
  end if;
  if v_tipo = 'relampago' and v_hasta > v_desde + make_interval(hours => tumbo_privado.numero(cfg -> 'relampago_max_horas', 72)::integer) then
    raise exception 'Una oferta relámpago dura como mucho % horas.', tumbo_privado.numero(cfg -> 'relampago_max_horas', 72);
  end if;
  if v_tipo = 'cantidad' then
    if v_min is null or v_min <> trunc(v_min) or v_min not between 2 and 10 then
      raise exception 'El descuento por cantidad empieza desde 2 y hasta 10 unidades.';
    end if;
    if v_pct is null or v_pct <= 0 or v_pct > v_max_pct then
      raise exception 'El descuento va de 1 a % %%.', v_max_pct;
    end if;
    -- como cualquier cambio de precio, no atraviesa el precio mínimo del SKU
    if p.precio_minimo is not null and round(p.precio_usd * (1 - v_pct / 100), 2) < p.precio_minimo then
      raise exception 'Con ese descuento cada unidad quedaría en %, por debajo del precio mínimo del producto (%).',
        tumbo_privado.fmt_usd(round(p.precio_usd * (1 - v_pct / 100), 2)), tumbo_privado.fmt_usd(p.precio_minimo);
    end if;
    v_precio := null;
    v_stock := null;
  else
    if v_precio is null or v_precio <= 0 or round(v_precio, 2) <> v_precio then
      raise exception 'Escribe el precio de oferta en USD (con hasta dos decimales).';
    end if;
    if v_precio >= p.precio_usd then
      raise exception 'El precio de oferta debe ser menor que el precio actual (%).', tumbo_privado.fmt_usd(p.precio_usd);
    end if;
    if v_precio < p.precio_usd * (1 - v_max_pct / 100) then
      raise exception 'El descuento máximo es de % %%.', v_max_pct;
    end if;
    if p.precio_minimo is not null and v_precio < p.precio_minimo then
      raise exception 'El precio de oferta no puede bajar del precio mínimo del producto (%).', tumbo_privado.fmt_usd(p.precio_minimo);
    end if;
    -- el precio tachado es uno que de verdad se cobró: el producto lleva los
    -- días de referencia a la venta sin subirlo (tachable_desde)
    if p.estado not in ('publicado', 'pausado') then
      raise exception '% todavía no está a la venta: para tachar su precio debe llevar % días publicado a ese precio.', p.sku, v_dias_ref;
    end if;
    if exists (select 1 from tumbo.precio_historial h where h.sku = p.sku and h.despues > h.antes
               and h.fecha > now() - make_interval(days => v_dias_ref::integer)) then
      raise exception 'El precio de % subió en los últimos % días: para mostrar un precio anterior tachado debe llevar ese tiempo sin subir.',
        p.sku, v_dias_ref;
    end if;
    if coalesce(tumbo_privado.tachable_desde(p), 'infinity'::timestamptz) > greatest(v_desde, now()) then
      raise exception 'Para tachar el precio de % debe llevar % días a la venta sin subirlo: la oferta puede empezar desde el %.', p.sku, v_dias_ref,
        coalesce(to_char(tumbo_privado.tachable_desde(p) at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI'), 'momento en que se publique');
    end if;
    if v_tipo = 'relampago' then
      if v_stock is null or v_stock <> trunc(v_stock) or v_stock < 1 then
        raise exception 'Indica cuántas unidades entran en la oferta relámpago.';
      end if;
      if v_stock > p.stock_fis - p.stock_res then
        raise exception 'Solo hay % unidades disponibles para la oferta.', greatest(p.stock_fis - p.stock_res, 0);
      end if;
    else
      v_stock := null;
    end if;
    v_pct := null;
    v_min := null;
  end if;
  if exists (select 1 from tumbo.ofertas x where x.sku = p.sku and x.activa and x.hasta > now()
             and x.desde < v_hasta and x.hasta > v_desde
             and ((v_tipo = 'cantidad') = (x.tipo = 'cantidad'))) then
    raise exception 'Ya hay una oferta % para % en esas fechas: desactívala primero.',
      case when v_tipo = 'cantidad' then 'por cantidad' else 'de precio' end, p.sku;
  end if;
  if (select count(*) from tumbo.ofertas x where x.seller_id = p.seller_id and x.activa and x.hasta > now() and x.financia = v_financia)
     >= tumbo_privado.numero(cfg -> 'ofertas_activas_seller', 50) then
    raise exception 'Llegaste al máximo de % ofertas activas o programadas.', tumbo_privado.numero(cfg -> 'ofertas_activas_seller', 50);
  end if;
  if v_campana is not null and (v_financia = 'seller' or not exists (select 1 from tumbo.campanas where id = v_campana)) then
    raise exception 'La campaña no existe.';
  end if;
  insert into tumbo.ofertas (seller_id, sku, tipo, precio_oferta_usd, precio_referencia_usd, descuento_pct, cantidad_min, stock_oferta,
                             desde, hasta, financia, campana_id, por_id, por)
  values (p.seller_id, p.sku, v_tipo, v_precio, p.precio_usd, v_pct, v_min::integer, v_stock::integer,
          greatest(v_desde, now()), v_hasta, v_financia, v_campana, yo.id, tumbo_privado.actor(yo))
  returning * into o;
  perform tumbo_privado.auditar(yo, 'Oferta creada', p.sku || ' · ' || v_tipo ||
    coalesce(' · ' || tumbo_privado.fmt_usd(v_precio), '') || coalesce(' · ' || v_pct || ' % desde ' || v_min::integer, '') ||
    coalesce(' · ' || v_stock::integer || ' unidades', '') || ' · financia ' || v_financia);
  return to_jsonb(o);
end $$;

-- Un cupón: {codigo, descripcion, tipo, valor, minimo_usd, tope_descuento_usd,
-- usos_max, usos_por_usuario, desde, hasta, presupuesto_usd, campana_id}. El
-- comercio (seller principal) crea los suyos (los financia y aplican a sus
-- productos); el equipo de marketing, los de Tumbo (con presupuesto).
create function public.tm_cupon_guardar(p_sesion text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'superadmin', 'ops']);
  d jsonb := case when jsonb_typeof(p_datos) = 'object' then p_datos else '{}'::jsonb end;
  cfg jsonb := coalesce(tumbo_privado.ajuste('promociones'), '{}'::jsonb);
  v_max_pct numeric := tumbo_privado.numero(cfg -> 'descuento_max_pct', 70);
  v_codigo text := upper(btrim(coalesce(d ->> 'codigo', '')));
  v_tipo text := d ->> 'tipo';
  v_valor numeric := tumbo_privado.num_json(d -> 'valor');
  v_minimo numeric := coalesce(tumbo_privado.num_json(d -> 'minimo_usd'), 0);
  v_tope numeric := tumbo_privado.num_json(d -> 'tope_descuento_usd');
  v_usos numeric := tumbo_privado.num_json(d -> 'usos_max');
  v_por_usuario numeric := coalesce(tumbo_privado.num_json(d -> 'usos_por_usuario'), 1);
  v_presupuesto numeric := tumbo_privado.num_json(d -> 'presupuesto_usd');
  v_desde timestamptz := tumbo_privado.fecha_json(d -> 'desde', now());
  v_hasta timestamptz := tumbo_privado.fecha_json(d -> 'hasta', null);
  v_desc text := nullif(left(regexp_replace(btrim(coalesce(d ->> 'descripcion', '')), '[[:cntrl:]<>]+', ' ', 'g'), 160), '');
  v_campana bigint := tumbo_privado.num_json(d -> 'campana_id')::bigint;
  v_financia text;
  v_seller text;
  c tumbo.cupones;
begin
  if yo.rol in ('superadmin', 'ops') then
    perform tumbo_privado.exigir_permiso(yo, 'marketing');
    perform tumbo_privado.exigir_elevada(yo);
    v_financia := 'tumbo';
    if v_presupuesto is null then
      raise exception 'Un cupón de Tumbo necesita un presupuesto (USD).';
    end if;
  else
    v_financia := 'seller';
    v_seller := yo.seller_id;
    v_campana := null;
  end if;
  if v_codigo !~ '^[A-Z0-9][A-Z0-9_-]{2,23}$' then
    raise exception 'El código va de 3 a 24 letras sin tilde, números, guiones o «_» (p. ej. VERANO10).';
  end if;
  if exists (select 1 from tumbo.cupones where codigo = v_codigo and activo) then
    raise exception 'Ya hay un cupón activo con el código %.', v_codigo;
  end if;
  if v_tipo not in ('porcentaje', 'monto') then
    raise exception 'Elige si el cupón descuenta un porcentaje o un monto.';
  end if;
  if v_valor is null or v_valor <= 0 or round(v_valor, 2) <> v_valor
     or (v_tipo = 'porcentaje' and v_valor > v_max_pct) or (v_tipo = 'monto' and v_valor > 10000) then
    raise exception 'Revisa el valor del cupón (un porcentaje hasta % %% o un monto hasta 10.000 USD).', v_max_pct;
  end if;
  if v_minimo < 0 or v_minimo > 100000 or (v_tope is not null and (v_tope <= 0 or v_tope > 10000))
     or (v_presupuesto is not null and (v_presupuesto <= 0 or v_presupuesto > 1000000)) then
    raise exception 'Revisa la compra mínima, el tope de descuento y el presupuesto.';
  end if;
  if v_usos is not null and (v_usos <> trunc(v_usos) or v_usos < 1 or v_usos > 100000) then
    raise exception 'Los usos en total van de 1 a 100.000 (o sin tope).';
  end if;
  if v_por_usuario <> trunc(v_por_usuario) or v_por_usuario not between 1 and 100 then
    raise exception 'Los usos por persona van de 1 a 100.';
  end if;
  if v_hasta is null or v_hasta <= v_desde or v_hasta > v_desde + interval '366 days' then
    raise exception 'El cupón necesita un fin posterior al inicio (hasta un año).';
  end if;
  if v_desde < now() - interval '5 minutes' then
    raise exception 'El cupón empieza desde ahora.';
  end if;
  if v_financia = 'seller' and (select count(*) from tumbo.cupones x where x.seller_id = v_seller and x.activo and x.hasta > now())
                                >= tumbo_privado.numero(cfg -> 'cupones_activos_seller', 20) then
    raise exception 'Llegaste al máximo de % cupones activos o programados.', tumbo_privado.numero(cfg -> 'cupones_activos_seller', 20);
  end if;
  if v_campana is not null and not exists (select 1 from tumbo.campanas where id = v_campana) then
    raise exception 'La campaña no existe.';
  end if;
  insert into tumbo.cupones (codigo, descripcion, tipo, valor, minimo_usd, tope_descuento_usd, usos_max, usos_por_usuario, desde, hasta,
                             financia, seller_id, presupuesto_usd, campana_id, por_id, por)
  values (v_codigo, v_desc, v_tipo, v_valor, v_minimo, case when v_tipo = 'porcentaje' then v_tope end, v_usos::integer, v_por_usuario::integer,
          greatest(v_desde, now()), v_hasta, v_financia, v_seller, v_presupuesto, v_campana, yo.id, tumbo_privado.actor(yo))
  returning * into c;
  perform tumbo_privado.auditar(yo, 'Cupón creado', c.codigo || ' · ' || case when c.tipo = 'porcentaje' then c.valor || ' %' else tumbo_privado.fmt_usd(c.valor) end ||
                                ' · financia ' || coalesce(c.seller_id, 'Tumbo') || coalesce(' · presupuesto ' || tumbo_privado.fmt_usd(c.presupuesto_usd), ''));
  return to_jsonb(c);
end $$;

-- Activa o desactiva una oferta, un cupón, un banner, una colección o una
-- campaña. Las ofertas y cupones del comercio, su equipo; lo de Tumbo, el
-- equipo de marketing con sesión elevada.
create function public.tm_promocion_estado(p_sesion text, p_tipo text, p_id bigint, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir(p_sesion, array['seller', 'precios', 'superadmin', 'ops']);
  o tumbo.ofertas;
  c tumbo.cupones;
  v_admin boolean := yo.rol in ('superadmin', 'ops');
begin
  if p_activo is null then
    raise exception 'Indica si se activa o se desactiva.';
  end if;
  if v_admin then
    perform tumbo_privado.exigir_permiso(yo, 'marketing');
  end if;
  if p_tipo = 'oferta' then
    select * into o from tumbo.ofertas where id = p_id for update;
    if not found or (o.financia = 'seller' and (v_admin or o.seller_id is distinct from yo.seller_id))
       or (o.financia = 'tumbo' and not v_admin) then
      raise exception 'Oferta no encontrada.';
    end if;
    if v_admin then
      perform tumbo_privado.exigir_elevada(yo);
    end if;
    if p_activo and (o.hasta <= now() or exists (select 1 from tumbo.ofertas x where x.id <> o.id and x.sku = o.sku and x.activa and x.hasta > now()
                                                  and x.desde < o.hasta and x.hasta > o.desde and ((o.tipo = 'cantidad') = (x.tipo = 'cantidad')))) then
      raise exception 'No se puede reactivar: ya terminó o hay otra oferta del mismo tipo en esas fechas.';
    end if;
    update tumbo.ofertas set activa = p_activo where id = o.id;
    perform tumbo_privado.auditar(yo, case when p_activo then 'Oferta activada' else 'Oferta desactivada' end, o.id || ' · ' || o.sku);
  elsif p_tipo = 'cupon' then
    select * into c from tumbo.cupones where id = p_id for update;
    if not found or (c.financia = 'seller' and (v_admin or yo.rol <> 'seller' or c.seller_id is distinct from yo.seller_id))
       or (c.financia = 'tumbo' and not v_admin) then
      raise exception 'Cupón no encontrado.';
    end if;
    if v_admin then
      perform tumbo_privado.exigir_elevada(yo);
    end if;
    if p_activo and (c.hasta <= now() or exists (select 1 from tumbo.cupones x where x.codigo = c.codigo and x.activo and x.id <> c.id)) then
      raise exception 'No se puede reactivar: ya venció o hay otro cupón activo con ese código.';
    end if;
    update tumbo.cupones set activo = p_activo where id = c.id;
    perform tumbo_privado.auditar(yo, case when p_activo then 'Cupón activado' else 'Cupón desactivado' end, c.codigo);
  elsif p_tipo in ('banner', 'coleccion', 'campana') then
    if not v_admin then
      raise exception 'Tu rol no permite esta acción.' using errcode = '42501';
    end if;
    perform tumbo_privado.exigir_elevada(yo);
    if p_tipo = 'banner' then
      update tumbo.banners set activo = p_activo where id = p_id;
    elsif p_tipo = 'coleccion' then
      update tumbo.colecciones set activa = p_activo where id = p_id;
    else
      update tumbo.campanas set activa = p_activo where id = p_id;
    end if;
    if not found then
      raise exception 'No encontrado.';
    end if;
    perform tumbo_privado.auditar(yo, case when p_activo then 'Marketing activado' else 'Marketing desactivado' end, p_tipo || ' ' || p_id);
  else
    raise exception 'Tipo desconocido.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Lo que muestra admin/marketing: campañas (con su calendario), banners,
-- colecciones, cupones y ofertas de Tumbo, y las de los comercios, con su
-- uso; quién creó cada cosa pasa por firma_visible. A una cuenta de prueba
-- (contraseña pública) solo le llega lo de la demo: las campañas, los
-- cupones y las ofertas de la semilla y de los comercios de prueba, y los
-- banners y colecciones de la demo o que ya están a la vista en la portada;
-- nunca un cupón de Tumbo ni de un comercio real (su código es dinero).
create function public.tm_marketing_admin(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin', 'ops']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
begin
  perform tumbo_privado.exigir_permiso(yo, 'marketing');
  return jsonb_build_object(
    'campanas', coalesce((select jsonb_agg(to_jsonb(k) - 'por_id' || jsonb_build_object('por', tumbo_privado.firma_visible(yo, k.por_id, k.por))
                                           order by k.desde desc)
                          from tumbo.campanas k where k.hasta > now() - interval '180 days' and (not v_demo or k.demo)), '[]'::jsonb),
    'banners', coalesce((select jsonb_agg(to_jsonb(b) - 'por_id' || jsonb_build_object('por', tumbo_privado.firma_visible(yo, b.por_id, b.por),
                                                                            'imagen_url', tumbo_privado.url_publica(b.imagen),
                                                                            'vigente', b.activo and b.desde <= now() and b.hasta > now()) order by b.orden, b.id)
                         from tumbo.banners b
                         where b.hasta > now() - interval '180 days' and (not v_demo or b.demo or (b.activo and b.desde <= now() and b.hasta > now()))), '[]'::jsonb),
    'colecciones', coalesce((select jsonb_agg(to_jsonb(c) - 'por_id' || jsonb_build_object('por', tumbo_privado.firma_visible(yo, c.por_id, c.por),
                                                                                'vigente', c.activa and c.desde <= now() and c.hasta > now()) order by c.orden, c.id)
                             from tumbo.colecciones c
                             where c.hasta > now() - interval '180 days' and (not v_demo or c.demo or (c.activa and c.desde <= now() and c.hasta > now()))), '[]'::jsonb),
    'cupones', coalesce((select jsonb_agg(to_jsonb(c) - 'por_id' || jsonb_build_object('por', tumbo_privado.firma_visible(yo, c.por_id, c.por))
                                          || tumbo_privado.cupon_uso(c.id, null) order by c.id desc)
                         from tumbo.cupones c
                         where c.hasta > now() - interval '180 days'
                           and (not v_demo or c.demo or (c.seller_id is not null and tumbo_privado.comercio_de_prueba(c.seller_id)))), '[]'::jsonb),
    'ofertas', coalesce((select jsonb_agg(to_jsonb(o) - 'por_id' || jsonb_build_object('por', tumbo_privado.firma_visible(yo, o.por_id, o.por),
                                                                                       'vendidas', tumbo_privado.oferta_vendidas(o.id), 'nombre', p.nombre)
                                          order by o.id desc)
                         from tumbo.ofertas o left join tumbo.productos p on p.sku = o.sku
                         where o.hasta > now() - interval '180 days'
                           and (not v_demo or o.demo or (o.financia = 'seller' and tumbo_privado.comercio_de_prueba(o.seller_id)))), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('sku', p.sku, 'nombre', p.nombre, 'precio_usd', p.precio_usd, 'seller_id', p.seller_id) order by p.sku)
                           from tumbo.productos p where p.estado = 'publicado'), '[]'::jsonb),
    'imagenes', tumbo_privado.marketing_imagenes_listas(),
    'editable', not v_demo);
end $$;

-- Lo que muestra seller/promociones: sus ofertas y cupones con su uso, y sus
-- productos para ofertar.
create function public.tm_seller_promociones(p_sesion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller', 'precios']);
  cfg jsonb := coalesce(tumbo_privado.ajuste('promociones'), '{}'::jsonb);
begin
  return jsonb_build_object(
    'ofertas', coalesce((select jsonb_agg(to_jsonb(o) - 'por_id' || jsonb_build_object('por', tumbo_privado.firma_visible(yo, o.por_id, o.por),
                                                                                        'vendidas', tumbo_privado.oferta_vendidas(o.id), 'nombre', p.nombre,
                                                                                        'precio_actual', p.precio_usd,
                                                                                        'vigente', o.activa and o.desde <= now() and o.hasta > now()
                                                                                                   and p.precio_usd <= o.precio_referencia_usd)
                                          order by o.id desc)
                         from tumbo.ofertas o left join tumbo.productos p on p.sku = o.sku
                         where o.seller_id = yo.seller_id and o.hasta > now() - interval '120 days'), '[]'::jsonb),
    'cupones', case when yo.rol = 'seller' then coalesce((select jsonb_agg(to_jsonb(c) - 'por_id' || jsonb_build_object('por', tumbo_privado.firma_visible(yo, c.por_id, c.por))
                                                                           || tumbo_privado.cupon_uso(c.id, null) order by c.id desc)
                                                          from tumbo.cupones c where c.seller_id = yo.seller_id and c.hasta > now() - interval '120 days'), '[]'::jsonb) end,
    'productos', coalesce((select jsonb_agg(jsonb_build_object('sku', p.sku, 'nombre', p.nombre, 'precio_usd', p.precio_usd, 'estado', p.estado,
                                                               'disponible', p.stock_fis - p.stock_res, 'precio_minimo', p.precio_minimo,
                                                               'subio', exists (select 1 from tumbo.precio_historial h where h.sku = p.sku and h.despues > h.antes
                                                                                and h.fecha > now() - make_interval(days => tumbo_privado.numero(cfg -> 'referencia_dias', 7)::integer)),
                                                               'tachable_desde', tumbo_privado.tachable_desde(p))
                                            order by p.nombre)
                           from tumbo.productos p where p.seller_id = yo.seller_id and p.estado in ('publicado', 'pausado', 'en_revision')), '[]'::jsonb),
    'topes', cfg,
    'puede_cupones', yo.rol = 'seller');
end $$;

-- ---------------------------------------------------------------------------
-- Analítica de eventos (sin datos personales)
-- ---------------------------------------------------------------------------
-- Lo que registra el navegador: búsquedas, vistas de producto, agregar al
-- carrito, inicio y abandono del checkout y pago reportado. Sin cuenta, sin
-- correo ni red: el «visitante» es un número al azar de la pestaña que no
-- se vincula con la cuenta; el texto de una búsqueda se guarda normalizado y
-- sin correos ni números largos (teléfonos, cédulas).
create table tumbo.eventos_analitica (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('busqueda', 'vista_producto', 'agregar_carrito', 'inicio_checkout', 'abandono_checkout', 'pago_reportado')),
  sku        text check (sku is null or char_length(sku) <= 40),
  seller_id  text check (seller_id is null or char_length(seller_id) <= 30),
  categoria  text check (categoria is null or char_length(categoria) <= 60),
  texto      text check (texto is null or char_length(texto) <= 60),
  origen     text check (origen is null or origen in ('busqueda', 'coleccion', 'banner', 'inicio', 'categoria', 'tienda', 'otro')),
  visitante  text check (visitante is null or visitante ~ '^[a-z0-9]{8,32}$'),
  creado     timestamptz not null default now()
);
create index eventos_analitica_creado_idx on tumbo.eventos_analitica (creado);
create index eventos_analitica_seller_idx on tumbo.eventos_analitica (seller_id, creado) where seller_id is not null;
alter table tumbo.eventos_analitica enable row level security;
revoke all on tumbo.eventos_analitica from public, anon, authenticated;

-- El texto de una búsqueda sin datos personales: fuera los correos y los
-- números de 6 cifras o más; normalizado como la búsqueda; hasta 60.
create function tumbo_privado.texto_analitica(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(tumbo_privado.normalizar(
           regexp_replace(regexp_replace(coalesce(p, ''), '\S+@\S+', ' ', 'g'), '[0-9][0-9 .-]{5,}', ' ', 'g')), 60), '')
$$;

-- Registra hasta 20 eventos del navegador (cualquiera, sin sesión). Tope por
-- red (ajuste analitica.eventos_minuto_red) y, de respaldo, en total
-- (eventos_minuto_total, también sin la cabecera del borde): lo que los pasa
-- se descarta en silencio (la analítica nunca molesta a quien compra).
create function public.tm_analitica_registrar(p_eventos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := coalesce(tumbo_privado.ajuste('analitica'), '{}'::jsonb);
  v_tope integer := tumbo_privado.numero(cfg -> 'eventos_minuto_red', 120)::integer;
  v_total integer := tumbo_privado.numero(cfg -> 'eventos_minuto_total', 6000)::integer;
  v_lote integer;
  v_cuenta integer;
  e jsonb;
  p tumbo.productos;
  v_raiz text;
  v_n integer := 0;
  v_tipo text;
  v_vis text;
begin
  if jsonb_typeof(p_eventos) <> 'array' or jsonb_array_length(p_eventos) = 0 then
    return jsonb_build_object('registrados', 0);
  end if;
  v_lote := least(jsonb_array_length(p_eventos), 20);
  if tumbo_privado.tope_red('analitica', 1, v_tope, v_lote) then
    return jsonb_build_object('registrados', 0, 'limitado', true);
  end if;
  insert into tumbo.topes_crecimiento as t (red, tipo, ventana, n)
  values ('*', 'analitica', date_bin(interval '1 minute', now(), timestamptz '2000-01-01'), v_lote)
  on conflict (red, tipo, ventana) do update set n = t.n + v_lote
  returning n into v_cuenta;
  if v_cuenta > v_total then
    return jsonb_build_object('registrados', 0, 'limitado', true);
  end if;
  for e in select x from jsonb_array_elements(p_eventos) x limit 20 loop
    v_tipo := e ->> 'tipo';
    continue when jsonb_typeof(e) <> 'object'
      or v_tipo not in ('busqueda', 'vista_producto', 'agregar_carrito', 'inicio_checkout', 'abandono_checkout', 'pago_reportado');
    p := null;
    v_raiz := null;
    if nullif(e ->> 'sku', '') is not null then
      select * into p from tumbo.productos where sku = left(e ->> 'sku', 40) and estado = 'publicado';
      if p.sku is not null then
        select coalesce(k.padre, k.id) into v_raiz from tumbo.categorias k where k.id = p.categoria;
      end if;
    end if;
    continue when v_tipo in ('vista_producto', 'agregar_carrito') and p.sku is null;
    v_vis := case when coalesce(e ->> 'visitante', '') ~ '^[a-z0-9]{8,32}$' then e ->> 'visitante' end;
    insert into tumbo.eventos_analitica (tipo, sku, seller_id, categoria, texto, origen, visitante)
    values (v_tipo, p.sku, p.seller_id, coalesce(v_raiz, p.categoria),
            case when v_tipo = 'busqueda' or (v_tipo = 'vista_producto' and e ->> 'origen' = 'busqueda') then tumbo_privado.texto_analitica(e ->> 'texto') end,
            case when e ->> 'origen' in ('busqueda', 'coleccion', 'banner', 'inicio', 'categoria', 'tienda', 'otro') then e ->> 'origen' end,
            v_vis);
    v_n := v_n + 1;
  end loop;
  if random() < 0.002 then
    perform tumbo_privado.tarea_analitica();
  end if;
  return jsonb_build_object('registrados', v_n);
end $$;

-- Borra los eventos más viejos que los días que se conservan (de a 20.000).
create function tumbo_privado.tarea_analitica() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dias integer := greatest(tumbo_privado.numero(coalesce(tumbo_privado.ajuste('analitica'), '{}'::jsonb) -> 'dias_conservar', 400)::integer, 30);
  v_n integer;
begin
  delete from tumbo.eventos_analitica
  where id in (select id from tumbo.eventos_analitica where creado < now() - make_interval(days => v_dias) order by id limit 20000);
  get diagnostics v_n = row_count;
  delete from tumbo.topes_crecimiento where ventana < now() - interval '1 day';
  return jsonb_build_object('borrados', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- Métricas de negocio
-- ---------------------------------------------------------------------------
-- El período de un filtro: [inicio, fin) en hora de Caracas, la agrupación y
-- la expresión de cada grupo. Hasta 400 días; por día, hasta 120 días.
create function tumbo_privado.periodo_metricas(p_filtros jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  f jsonb := case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end;
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_desde date;
  v_hasta date;
  v_agrupar text := coalesce(nullif(f ->> 'agrupar', ''), 'dia');
begin
  begin
    v_hasta := coalesce(nullif(f ->> 'hasta', '')::date, v_hoy);
    v_desde := coalesce(nullif(f ->> 'desde', '')::date, v_hasta - 29);
  exception when others then
    raise exception 'Revisa las fechas del período.';
  end;
  if v_desde > v_hasta then
    raise exception 'El inicio del período es posterior al fin.';
  end if;
  if v_hasta - v_desde > 400 then
    raise exception 'El período va hasta 400 días.';
  end if;
  if v_agrupar not in ('dia', 'semana', 'mes') then
    raise exception 'Agrupa por día, semana o mes.';
  end if;
  if v_agrupar = 'dia' and v_hasta - v_desde > 120 then
    v_agrupar := 'semana';
  end if;
  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'agrupar', v_agrupar,
    'inicio', (v_desde::timestamp at time zone 'America/Caracas'), 'fin', ((v_hasta + 1)::timestamp at time zone 'America/Caracas'));
end $$;

create function tumbo_privado.grupo_fecha(p timestamptz, p_agrupar text) returns date
language sql immutable set search_path = '' as $$
  select date_trunc(case p_agrupar when 'mes' then 'month' when 'semana' then 'week' else 'day' end,
                    (p at time zone 'America/Caracas'))::date
$$;

-- Panel de negocio (superadministrador; Finanzas y Operaciones con su
-- permiso de ver métricas no aplican): GMV, pedidos, ticket promedio, take
-- rate real (comisión y tarifa guardadas en cada pedido), conversión del
-- embudo, recompra, tiempos de conciliación y despacho, % de reclamos y de
-- cancelaciones, por período y por categoría o comercio. A una cuenta de
-- prueba solo le llegan los datos de la demo: sin pedidos de personas o
-- comercios reales, y la analítica (embudo, lo más visto) solo de los
-- comercios de prueba y de lo que no es de ningún comercio (búsquedas,
-- checkout); el filtro por un comercio real se rechaza.
create function public.tm_metricas_negocio(p_sesion text, p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['superadmin']);
  v_demo boolean := tumbo_privado.cuenta_demo(yo.email);
  per jsonb := tumbo_privado.periodo_metricas(p_filtros);
  f jsonb := case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end;
  v_ini timestamptz := (per ->> 'inicio')::timestamptz;
  v_fin timestamptz := (per ->> 'fin')::timestamptz;
  v_agrupar text := per ->> 'agrupar';
  v_cat text := nullif(f ->> 'categoria', '');
  v_seller text := nullif(f ->> 'seller', '');
  v_prueba text[];
  cfg tumbo.config;
  r jsonb;
begin
  if v_demo then
    select coalesce(array_agg(s.id), '{}') into v_prueba from tumbo.sellers s where tumbo_privado.comercio_de_prueba(s.id);
    if v_seller is not null and not (v_seller = any (v_prueba)) then
      raise exception 'Con una cuenta de prueba solo ves los comercios de la demo.' using errcode = '42501';
    end if;
  end if;
  select * into cfg from tumbo.config where id;
  create temporary table if not exists crec_ped (id text primary key, comprador_id uuid, seller_id text, estado text, creado timestamptz,
                                                 bruto numeric, base numeric, comision numeric, unidades integer, vendido boolean) on commit drop;
  truncate crec_ped;
  insert into crec_ped
  select p.id, p.comprador_id, p.seller_id, p.estado, p.creado, x.bruto, x.bruto - p.descuento_usd,
         round((x.bruto - p.descuento_usd) * coalesce(p.comision_pct, cfg.comision_pct) / 100, 2) + coalesce(p.tarifa_usd, cfg.tarifa_fija_usd),
         x.unidades, p.estado not in ('pago_por_verificar', 'cancelado')
  from tumbo.pedidos p
  cross join lateral (select coalesce(sum(i.precio_usd * i.cant), 0) as bruto, coalesce(sum(i.cant), 0)::integer as unidades
                      from tumbo.pedido_items i left join tumbo.productos pr on pr.sku = i.sku left join tumbo.categorias k on k.id = pr.categoria
                      where i.pedido_id = p.id and (v_cat is null or coalesce(k.padre, k.id, pr.categoria) = v_cat)) x
  where p.creado >= v_ini and p.creado < v_fin
    and (v_seller is null or p.seller_id = v_seller)
    and (v_cat is null or x.unidades > 0)
    and (not v_demo or not tumbo_privado.pedido_real(p));

  r := jsonb_build_object(
    'periodo', per - 'inicio' - 'fin',
    'kpis', (select jsonb_build_object(
        'gmv_usd', coalesce(sum(bruto) filter (where vendido), 0),
        'pedidos', count(*) filter (where vendido),
        'pedidos_creados', count(*),
        'ticket_usd', round(coalesce(sum(bruto) filter (where vendido), 0) / nullif(count(*) filter (where vendido), 0), 2),
        'comision_usd', coalesce(sum(comision) filter (where vendido), 0),
        'take_rate_pct', round(100 * coalesce(sum(comision) filter (where vendido), 0) / nullif(sum(bruto) filter (where vendido), 0), 2),
        'unidades', coalesce(sum(unidades) filter (where vendido), 0),
        'cancelados', count(*) filter (where estado = 'cancelado'),
        'cancelacion_pct', round(100.0 * count(*) filter (where estado = 'cancelado') / nullif(count(*), 0), 1),
        'compradores', count(distinct comprador_id) filter (where vendido),
        'recompra_pct', round(100.0 * count(distinct comprador_id) filter (where vendido and (
            exists (select 1 from crec_ped q where q.comprador_id = crec_ped.comprador_id and q.vendido and q.id <> crec_ped.id)
            or exists (select 1 from tumbo.pedidos q where q.comprador_id = crec_ped.comprador_id and q.creado < v_ini
                       and q.estado not in ('pago_por_verificar', 'cancelado'))))
          / nullif(count(distinct comprador_id) filter (where vendido), 0), 1))
      from crec_ped),
    'disputas', (select jsonb_build_object('total', count(*), 'pct', round(100.0 * count(*) / nullif((select count(*) from crec_ped where vendido), 0), 1),
                                           'perdidas', count(*) filter (where d.resolucion_decision in ('reembolso', 'devolucion')))
                 from tumbo.disputas d join crec_ped c on c.id = d.pedido_id),
    'tiempos', jsonb_build_object(
      'conciliacion_horas', (select round(avg(extract(epoch from g.verificado_el - coalesce(g.reportado_el, g.creado)) / 3600)::numeric, 1)
                             from tumbo.pagos g
                             where g.estado = 'verificado' and g.verificado_el >= v_ini and g.verificado_el < v_fin
                               and exists (select 1 from crec_ped c join tumbo.pedidos p on p.id = c.id where p.pago_id = g.id)),
      'despacho_horas', (select round(avg(extract(epoch from e.despachado_en - e.conciliado_en) / 3600)::numeric, 1)
                         from tumbo.envios e join crec_ped c on c.id = e.pedido_id
                         where e.despachado_en is not null and e.conciliado_en is not null)),
    'serie', coalesce((select jsonb_agg(jsonb_build_object('grupo', g, 'gmv_usd', gmv, 'pedidos', n, 'ticket_usd', round(gmv / nullif(n, 0), 2)) order by g)
                       from (select tumbo_privado.grupo_fecha(creado, v_agrupar) as g, coalesce(sum(bruto) filter (where vendido), 0) as gmv,
                                    count(*) filter (where vendido) as n
                             from crec_ped group by 1) s), '[]'::jsonb),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', cat, 'nombre', (select k.nombre from tumbo.categorias k where k.id = cat),
                                                                   'gmv_usd', gmv, 'unidades', uni, 'pedidos', n) order by gmv desc)
                               from (select coalesce(k.padre, k.id, pr.categoria) as cat, sum(i.precio_usd * i.cant) as gmv, sum(i.cant) as uni,
                                            count(distinct c.id) as n
                                     from crec_ped c join tumbo.pedido_items i on i.pedido_id = c.id
                                     left join tumbo.productos pr on pr.sku = i.sku left join tumbo.categorias k on k.id = pr.categoria
                                     where c.vendido and (v_cat is null or coalesce(k.padre, k.id, pr.categoria) = v_cat)
                                     group by 1) s), '[]'::jsonb),
    'por_seller', coalesce((select jsonb_agg(jsonb_build_object('seller', s.seller_id, 'nombre', se.nombre, 'gmv_usd', s.gmv, 'pedidos', s.n,
                                                                'comision_usd', s.com, 'cancelados', s.canc) order by s.gmv desc)
                            from (select seller_id, coalesce(sum(bruto) filter (where vendido), 0) as gmv, count(*) filter (where vendido) as n,
                                         coalesce(sum(comision) filter (where vendido), 0) as com, count(*) filter (where estado = 'cancelado') as canc
                                  from crec_ped group by seller_id order by 2 desc limit 20) s
                            left join tumbo.sellers se on se.id = s.seller_id), '[]'::jsonb),
    'embudo', (select jsonb_build_object(
        'busquedas', count(*) filter (where e.tipo = 'busqueda'),
        'visitantes', count(distinct e.visitante),
        'vieron', count(distinct e.visitante) filter (where e.tipo = 'vista_producto'),
        'agregaron', count(distinct e.visitante) filter (where e.tipo = 'agregar_carrito'),
        'iniciaron_checkout', count(distinct e.visitante) filter (where e.tipo = 'inicio_checkout'),
        'abandonaron_checkout', count(distinct e.visitante) filter (where e.tipo = 'abandono_checkout'),
        'reportaron_pago', count(distinct e.visitante) filter (where e.tipo = 'pago_reportado'),
        'vistas', count(*) filter (where e.tipo = 'vista_producto'))
      from tumbo.eventos_analitica e
      where e.creado >= v_ini and e.creado < v_fin and (v_seller is null or e.seller_id = v_seller or e.tipo in ('busqueda', 'inicio_checkout', 'abandono_checkout', 'pago_reportado'))
        and (v_cat is null or e.categoria = v_cat or e.categoria is null)
        and (not v_demo or e.seller_id is null or e.seller_id = any (v_prueba))),
    'top_busquedas', coalesce((select jsonb_agg(jsonb_build_object('texto', t, 'veces', n) order by n desc, t)
                               from (select e.texto as t, count(*) as n from tumbo.eventos_analitica e
                                     where e.tipo = 'busqueda' and e.texto is not null and e.creado >= v_ini and e.creado < v_fin
                                       and (not v_demo or e.seller_id is null or e.seller_id = any (v_prueba))
                                     group by 1 order by 2 desc, 1 limit 15) s), '[]'::jsonb),
    'top_vistos', coalesce((select jsonb_agg(jsonb_build_object('sku', s.sku, 'nombre', p.nombre, 'vistas', s.n) order by s.n desc, s.sku)
                            from (select e.sku, count(*) as n from tumbo.eventos_analitica e
                                  where e.tipo = 'vista_producto' and e.creado >= v_ini and e.creado < v_fin
                                    and (v_seller is null or e.seller_id = v_seller) and (v_cat is null or e.categoria = v_cat)
                                    and (not v_demo or e.seller_id = any (v_prueba))
                                  group by 1 order by 2 desc, 1 limit 10) s
                            left join tumbo.productos p on p.sku = s.sku), '[]'::jsonb),
    'filtros', jsonb_build_object('categoria', v_cat, 'seller', v_seller),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'nombre', k.nombre) order by k.orden, k.id) from tumbo.categorias k where k.padre is null), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.id) from tumbo.sellers s
                         where not v_demo or tumbo_privado.comercio_de_prueba(s.id)), '[]'::jsonb),
    'solo_demo', v_demo);
  drop table if exists crec_ped;
  return r;
end $$;

-- Estadísticas del comercio (seller principal): ventas por período, visitas
-- por ficha, conversión, búsquedas que le traen tráfico, su nivel con lo que
-- le falta para el siguiente y la comisión que rige.
create function public.tm_seller_estadisticas(p_sesion text, p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  yo tumbo.usuarios := tumbo_privado.exigir_rol(p_sesion, array['seller']);
  per jsonb := tumbo_privado.periodo_metricas(p_filtros);
  v_ini timestamptz := (per ->> 'inicio')::timestamptz;
  v_fin timestamptz := (per ->> 'fin')::timestamptz;
  v_agrupar text := per ->> 'agrupar';
  cfg jsonb := coalesce(tumbo_privado.ajuste('niveles'), '{}'::jsonb);
  m jsonb;
begin
  m := tumbo_privado.metricas_nivel(yo.seller_id, least(greatest(coalesce(tumbo_privado.num_json(cfg -> 'ventana_dias'), 90), 30), 365)::integer);
  return jsonb_build_object(
    'periodo', per - 'inicio' - 'fin',
    'kpis', (select jsonb_build_object(
        'ventas', count(*) filter (where p.estado not in ('pago_por_verificar', 'cancelado')),
        'gmv_usd', coalesce(sum(x.bruto) filter (where p.estado not in ('pago_por_verificar', 'cancelado')), 0),
        'unidades', coalesce(sum(x.unidades) filter (where p.estado not in ('pago_por_verificar', 'cancelado')), 0),
        'cancelados', count(*) filter (where p.estado = 'cancelado'),
        'ticket_usd', round(coalesce(sum(x.bruto) filter (where p.estado not in ('pago_por_verificar', 'cancelado')), 0)
                            / nullif(count(*) filter (where p.estado not in ('pago_por_verificar', 'cancelado')), 0), 2))
      from tumbo.pedidos p
      cross join lateral (select coalesce(sum(i.precio_usd * i.cant), 0) as bruto, coalesce(sum(i.cant), 0) as unidades
                          from tumbo.pedido_items i where i.pedido_id = p.id) x
      where p.seller_id = yo.seller_id and p.creado >= v_ini and p.creado < v_fin),
    'visitas', (select jsonb_build_object('vistas', count(*) filter (where e.tipo = 'vista_producto'),
                                          'visitantes', count(distinct e.visitante) filter (where e.tipo = 'vista_producto'),
                                          'agregados', count(*) filter (where e.tipo = 'agregar_carrito'))
                from tumbo.eventos_analitica e where e.seller_id = yo.seller_id and e.creado >= v_ini and e.creado < v_fin),
    'serie', coalesce((select jsonb_agg(jsonb_build_object('grupo', coalesce(s.g, vv.g2), 'gmv_usd', coalesce(s.gmv, 0), 'ventas', coalesce(s.n, 0),
                                                           'vistas', coalesce(vv.n, 0)) order by coalesce(s.g, vv.g2))
                       from (select tumbo_privado.grupo_fecha(p.creado, v_agrupar) as g,
                                    coalesce(sum((select sum(i.precio_usd * i.cant) from tumbo.pedido_items i where i.pedido_id = p.id)), 0) as gmv,
                                    count(*) as n
                             from tumbo.pedidos p
                             where p.seller_id = yo.seller_id and p.creado >= v_ini and p.creado < v_fin
                               and p.estado not in ('pago_por_verificar', 'cancelado')
                             group by 1) s
                       full join (select tumbo_privado.grupo_fecha(e.creado, v_agrupar) as g2, count(*) as n
                                  from tumbo.eventos_analitica e
                                  where e.seller_id = yo.seller_id and e.tipo = 'vista_producto' and e.creado >= v_ini and e.creado < v_fin
                                  group by 1) vv on vv.g2 = s.g), '[]'::jsonb),
    'por_producto', coalesce((select jsonb_agg(jsonb_build_object('sku', q.sku, 'nombre', q.nombre, 'vistas', q.vistas, 'visitantes', q.visitantes,
                                                                  'agregados', q.agregados, 'unidades', q.unidades,
                                                                  'conversion_pct', round(100.0 * q.unidades / nullif(q.visitantes, 0), 1))
                                               order by q.vistas desc, q.unidades desc, q.sku)
                              from (select pr.sku, pr.nombre,
                                           (select count(*) from tumbo.eventos_analitica e where e.sku = pr.sku and e.tipo = 'vista_producto'
                                              and e.creado >= v_ini and e.creado < v_fin) as vistas,
                                           (select count(distinct e.visitante) from tumbo.eventos_analitica e where e.sku = pr.sku and e.tipo = 'vista_producto'
                                              and e.creado >= v_ini and e.creado < v_fin) as visitantes,
                                           (select count(*) from tumbo.eventos_analitica e where e.sku = pr.sku and e.tipo = 'agregar_carrito'
                                              and e.creado >= v_ini and e.creado < v_fin) as agregados,
                                           (select coalesce(sum(i.cant), 0) from tumbo.pedido_items i join tumbo.pedidos p on p.id = i.pedido_id
                                            where i.sku = pr.sku and p.creado >= v_ini and p.creado < v_fin
                                              and p.estado not in ('pago_por_verificar', 'cancelado')) as unidades
                                    from tumbo.productos pr where pr.seller_id = yo.seller_id and pr.estado in ('publicado', 'pausado')
                                    order by pr.sku limit 200) q), '[]'::jsonb),
    'busquedas', coalesce((select jsonb_agg(jsonb_build_object('texto', t, 'vistas', n) order by n desc, t)
                           from (select e.texto as t, count(*) as n from tumbo.eventos_analitica e
                                 where e.seller_id = yo.seller_id and e.tipo = 'vista_producto' and e.origen = 'busqueda' and e.texto is not null
                                   and e.creado >= v_ini and e.creado < v_fin
                                 group by 1 order by 2 desc, 1 limit 15) s), '[]'::jsonb),
    'nivel', (select jsonb_build_object('nivel', n.nivel, 'desde', n.desde, 'calculado', n.calculado) from tumbo.niveles_seller n where n.seller_id = yo.seller_id),
    'nivel_ahora', tumbo_privado.nivel_evaluar(yo.seller_id, m),
    'metricas', m,
    'comision_pct', tumbo_privado.comision_vigente(yo.seller_id, null),
    'sanciones', coalesce((select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'motivo', x.motivo, 'limite', x.limite, 'desde', x.desde, 'hasta', x.hasta)
                                            order by x.desde desc)
                           from tumbo.sanciones x where x.seller_id = yo.seller_id and tumbo_privado.sancion_vigente(x)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- El checkout: interruptores, comisión vigente, promociones y riesgo
-- ---------------------------------------------------------------------------
-- El checkout de Pagos (tumbo_privado.checkout_crear, cuerpo de
-- tm_crear_pedido y de tm_checkout_crear) crea el pago y después un pedido
-- por comercio mientras el carrito sigue completo. Estos disparadores lo
-- completan sin redefinirlo (la integración de la ola 1, que en el orden de
-- los archivos se aplica después de esta migración, lo redefine; así nada se
-- pisa):
--   · antes de insertar cada pedido: los interruptores (categorías y
--     ciudades en pausa) y la comisión vigente de su comercio y sus
--     categorías (comision_carrito) en vez de la global;
--   · después: registra las promociones aplicadas (stock de las relámpago,
--     usos y presupuesto de los cupones, con su bloqueo) y evalúa el riesgo
--     del pago (nunca impide la compra).
-- Solo actúan en un checkout: la llamada es del propio comprador y su
-- carrito tiene productos de ese comercio (no en la semilla ni en el SQL).
create function tumbo_privado.pedido_checkout_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario_en_curso();
begin
  if u.id is null or u.id is distinct from new.comprador_id or u.rol <> 'comprador'
     or not exists (select 1 from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
                    where c.usuario_id = new.comprador_id and p.seller_id = new.seller_id) then
    return new;
  end if;
  perform tumbo_privado.exigir_interruptores(new);
  new.comision_pct := tumbo_privado.comision_carrito(new.comprador_id, new.seller_id);
  return new;
end $$;

create trigger pedidos_crecimiento_antes before insert on tumbo.pedidos
  for each row execute function tumbo_privado.pedido_checkout_antes();

create function tumbo_privado.pedido_checkout_despues() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u tumbo.usuarios := tumbo_privado.usuario_en_curso();
  g tumbo.pagos;
begin
  if new.pago_id is null or u.id is null or u.id is distinct from new.comprador_id or u.rol <> 'comprador'
     or not exists (select 1 from tumbo.carrito_items c join tumbo.productos p on p.sku = c.sku
                    where c.usuario_id = new.comprador_id and p.seller_id = new.seller_id) then
    return null;
  end if;
  select * into g from tumbo.pagos where id = new.pago_id;
  if g.id is null then
    return null;
  end if;
  perform tumbo_privado.registrar_promociones(u, new, g);
  -- el riesgo, una sola vez por pago: con el último de sus pedidos (cuando
  -- cada comercio del carrito ya tiene el suyo)
  if not exists (select 1 from tumbo.carrito_items ci join tumbo.productos p on p.sku = ci.sku
                 where ci.usuario_id = new.comprador_id
                   and not exists (select 1 from tumbo.pedidos x where x.pago_id = new.pago_id and x.seller_id = p.seller_id)) then
    perform tumbo_privado.evaluar_riesgo_pago(new.pago_id);
  end if;
  return null;
end $$;

create trigger pedidos_crecimiento_despues after insert on tumbo.pedidos
  for each row execute function tumbo_privado.pedido_checkout_despues();

-- ---------------------------------------------------------------------------
-- Archivos: el propósito «marketing»
-- ---------------------------------------------------------------------------
-- Las imágenes de banners y colecciones salen en la portada pública: las
-- sube el equipo de marketing (superadministrador u Operaciones con el
-- permiso «marketing») con una cuenta real, en la entidad «marketing».
create function tumbo_privado.marketing_puede_subir(p_yo tumbo.usuarios, p_entidad text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_entidad = 'marketing' and not tumbo_privado.cuenta_demo(p_yo.email)
                  and (p_yo.rol = 'superadmin' or (p_yo.rol = 'ops' and tumbo_privado.tiene_permiso(p_yo, 'marketing'))), false)
$$;

-- tm_archivo_preparar (ola 0) no se redefine aquí: Comunicación también la
-- extiende (archivo_permitido_comunicacion) y archivo_permitido la redefine
-- la integración de la ola 1, que se aplica después. La integración de la
-- ola 2 agrega en una sola redefinición, junto a la de Comunicación, la
-- rama «marketing»: «or (pr.proposito = 'marketing' and
-- tumbo_privado.marketing_puede_subir(yo, v_entidad))». Hasta entonces el
-- propósito existe pero nadie sube a él, y admin/marketing lo dice
-- (marketing_imagenes_listas): los banners salen con su tono de color.
create function tumbo_privado.marketing_imagenes_listas() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where ((n.nspname = 'public' and p.proname = 'tm_archivo_preparar')
                        or (n.nspname = 'tumbo_privado' and p.proname = 'archivo_permitido'))
                   and p.prosrc like '%marketing_puede_subir%')
$$;


-- ---------------------------------------------------------------------------
-- Tareas programadas (pg_cron, solo si existe; sin él, «Recalcular niveles»
-- y la purga ocasional al registrar eventos)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $c$select cron.schedule('tumbo-crecimiento-niveles', '20 9 * * *', 'select tumbo_privado.tarea_niveles()')$c$;
    execute $c$select cron.schedule('tumbo-crecimiento-analitica', '40 9 * * *', 'select tumbo_privado.tarea_analitica()')$c$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Semilla de la demo (la llama el reinicio después de la semilla base)
-- ---------------------------------------------------------------------------
-- Limpia lo que cuelga de pedidos, pagos y productos (el reinicio los
-- vacía: sus identificadores se vuelven a usar) y lo de la demo (marketing,
-- sanciones, notas, marcas de riesgo y listas de ejemplo); conserva lo del
-- equipo real (reglas, comisiones, campañas, cupones de Tumbo y de comercios
-- reales, listas negras y sanciones de comercios reales). Siembra una
-- campaña con su banner y su colección, un cupón del comercio de la demo y
-- una oferta programada (no vigente: no cambia los precios de la demo), y
-- dos datos inventados en la lista negra, marcados como tales.
create function tumbo_privado.sembrar_ext_crecimiento(p_auditoria boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hoy timestamptz := date_trunc('day', now() at time zone 'America/Caracas') at time zone 'America/Caracas';
  v_campana bigint;
begin
  -- (con WHERE explícito: el proyecto usa pg-safeupdate)
  delete from tumbo.promociones_aplicadas where id is not null;
  delete from tumbo.riesgo_pagos where pago_id is not null;
  delete from tumbo.eventos_analitica where id is not null;
  delete from tumbo.topes_crecimiento where red is not null;
  delete from tumbo.cupon_intentos where clave is not null;
  delete from tumbo.moderacion_marcas where id is not null;
  delete from tumbo.moderacion_medianas where categoria is not null;
  delete from tumbo.productos_nombres n where not exists (select 1 from tumbo.productos p where p.sku = n.sku);
  insert into tumbo.productos_nombres (sku, seller_id, nombre_norm)
  select p.sku, p.seller_id, tumbo_privado.normalizar(p.nombre) from tumbo.productos p
  on conflict (sku) do update set seller_id = excluded.seller_id, nombre_norm = excluded.nombre_norm;
  update tumbo.moderacion_revision set iniciada = null, terminada = null, ultima = null, cursor = '', revisados = 0, marcados = 0, total = 0
  where id = 1;
  -- las denuncias de la demo (como el reinicio de Comunicación)
  delete from tumbo.denuncias where autor_id is null or not tumbo_privado.comprador_real(autor_id);
  -- desde cuándo está a la venta cada producto: la semilla los trae a la
  -- venta desde hace 30 días (sus pedidos son de meses atrás); los demás,
  -- desde su creación o su última subida de precio
  delete from tumbo.precio_referencia where sku is not null;
  insert into tumbo.precio_referencia (sku, precio_usd, desde)
  select p.sku, p.precio_usd,
         case when tumbo_privado.comercio_de_prueba(p.seller_id) then now() - interval '30 days'
              else greatest(p.creado, coalesce((select max(h.fecha) from tumbo.precio_historial h where h.sku = p.sku and h.despues > h.antes), p.creado)) end
  from tumbo.productos p where p.estado in ('publicado', 'pausado')
  on conflict (sku) do nothing;
  delete from tumbo.ofertas where demo or not exists (select 1 from tumbo.productos p where p.sku = ofertas.sku)
                              or tumbo_privado.comercio_de_prueba(seller_id);
  delete from tumbo.cupones where demo or (seller_id is not null and tumbo_privado.comercio_de_prueba(seller_id));
  delete from tumbo.banners where demo;
  delete from tumbo.colecciones where demo;
  delete from tumbo.campanas where demo;
  delete from tumbo.sanciones where tumbo_privado.comercio_de_prueba(seller_id);
  delete from tumbo.notas_internas
  where (entidad = 'seller' and tumbo_privado.comercio_de_prueba(entidad_id))
     or (entidad = 'comprador' and not tumbo_privado.comprador_real(tumbo_privado.uuid_texto(entidad_id)))
     or autor_id in (select u.id from tumbo.usuarios u where tumbo_privado.cuenta_demo(u.email));
  delete from tumbo.compradores_riesgo where not tumbo_privado.comprador_real(usuario_id);
  delete from tumbo.listas_negras where demo;
  delete from tumbo.comisiones where origen = 'nivel' and tumbo_privado.comercio_de_prueba(seller_id);
  delete from tumbo.niveles_seller where tumbo_privado.comercio_de_prueba(seller_id);

  -- marketing de la demo (dice que es de demostración)
  insert into tumbo.campanas (nombre, descripcion, desde, hasta, color, demo, por)
  values ('Semana Tumbo (demostración)', 'Campaña de ejemplo con productos de los comercios de prueba.',
          v_hoy - interval '1 day', v_hoy + interval '14 days', 'violeta', true, 'Semilla de la demo')
  returning id into v_campana;
  insert into tumbo.colecciones (slug, titulo, descripcion, skus, desde, hasta, orden, campana_id, demo, por)
  select 'para-estrenar', 'Para estrenar en casa y en la oficina',
         'Una selección de la demo: productos de comercios de prueba.',
         array(select p.sku from tumbo.productos p where p.sku in ('SKU-TEC-0450', 'SKU-TEC-0301', 'SKU-HOG-0110', 'SKU-HOG-0234')
               and p.estado = 'publicado' order by p.sku),
         v_hoy - interval '1 day', v_hoy + interval '14 days', 10, v_campana, true, 'Semilla de la demo'
  where exists (select 1 from tumbo.productos p where p.sku in ('SKU-TEC-0450', 'SKU-TEC-0301', 'SKU-HOG-0110', 'SKU-HOG-0234') and p.estado = 'publicado');
  insert into tumbo.banners (titulo, texto, enlace, boton, tono, desde, hasta, orden, campana_id, demo, por)
  values ('Semana Tumbo · demostración', 'Recorre una colección de ejemplo con productos de los comercios de prueba (no es una oferta real).',
          'app/tienda/coleccion.html?id=para-estrenar', 'Ver la colección', 'marca',
          v_hoy - interval '1 day', v_hoy + interval '14 days', 10, v_campana, true, 'Semilla de la demo');
  -- un cupón del comercio de la demo (lo financia ese comercio de prueba)
  if exists (select 1 from tumbo.sellers where id = 'SEL-014') and not exists (select 1 from tumbo.cupones where codigo = 'TECH5' and activo) then
    insert into tumbo.cupones (codigo, descripcion, tipo, valor, minimo_usd, usos_max, usos_por_usuario, desde, hasta, financia, seller_id, demo, por)
    values ('TECH5', '5 % en productos de TechElectro (cupón de la demo)', 'porcentaje', 5, 30, 500, 3,
            v_hoy - interval '1 day', v_hoy + interval '30 days', 'seller', 'SEL-014', true, 'Semilla de la demo');
  end if;
  -- una oferta programada (empieza en dos días: no cambia los precios de hoy)
  insert into tumbo.ofertas (seller_id, sku, tipo, precio_oferta_usd, precio_referencia_usd, desde, hasta, demo, por)
  select p.seller_id, p.sku, 'precio', round(p.precio_usd * 0.9, 2), p.precio_usd, v_hoy + interval '2 days', v_hoy + interval '9 days', true,
         'Semilla de la demo'
  from tumbo.productos p where p.sku = 'SKU-TEC-0301' and p.estado = 'publicado';
  -- lista negra: datos inventados que lo dicen (dominio .invalid y un prefijo que no existe)
  insert into tumbo.listas_negras (tipo, valor, motivo, demo, por) values
    ('correo', 'estafa-demo@ejemplo.invalid', 'Ejemplo de la demo: dato inventado, no es de una persona real.', true, 'Semilla de la demo'),
    ('telefono', '4000000000', 'Ejemplo de la demo: el prefijo 0400 no existe.', true, 'Semilla de la demo')
  on conflict (tipo, valor) where activo do nothing;

  -- las marcas de moderación de lo que quedó en revisión y los niveles
  perform tumbo_privado.moderacion_evaluar(p.sku) from tumbo.productos p where p.estado = 'en_revision';
  perform tumbo_privado.tarea_niveles();
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: las funciones nuevas de la API, por firma exacta (las
-- redefinidas conservan los suyos); lo de tumbo_privado no se invoca desde
-- la API.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema tumbo_privado from public, anon, authenticated;

do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'public.tm_ajustes_admin(text)', 'public.tm_config_guardar(text,text,jsonb)', 'public.tm_cambio_decidir(text,bigint,boolean,text)',
    'public.tm_comision_proponer(text,jsonb)', 'public.tm_comision_terminar(text,bigint,text)',
    'public.tm_moderacion_panel(text)', 'public.tm_moderacion_regla(text,jsonb)', 'public.tm_moderacion_marca(text,bigint,text,text)',
    'public.tm_moderacion_revisar_publicados(text)', 'public.tm_moderacion_retirar(text,text[],text)',
    'public.tm_denuncias(text,text)', 'public.tm_denuncia_resolver(text,bigint,text,text)',
    'public.tm_sancion_aplicar(text,text,text,text,jsonb)', 'public.tm_sancion_levantar(text,bigint,text)',
    'public.tm_niveles_recalcular(text)', 'public.tm_niveles_publicos()', 'public.tm_ficha_nota(text,text,text,text)',
    'public.tm_seller_360(text,text)', 'public.tm_comprador_360(text,uuid)',
    'public.tm_riesgo_pagos(text,text[])', 'public.tm_riesgo_liberar(text,text,text)', 'public.tm_riesgo_panel(text)',
    'public.tm_lista_negra_guardar(text,text,text,text)', 'public.tm_lista_negra_quitar(text,bigint,text)',
    'public.tm_comprador_marcar(text,uuid,boolean,text)',
    'public.tm_promos_producto(text)', 'public.tm_promos_skus(text[])', 'public.tm_promociones_cotizar(text,jsonb,text)',
    'public.tm_marketing_portada()', 'public.tm_coleccion(text)', 'public.tm_marketing_admin(text)',
    'public.tm_campana_guardar(text,jsonb)', 'public.tm_banner_guardar(text,jsonb)', 'public.tm_coleccion_guardar(text,jsonb)',
    'public.tm_oferta_guardar(text,jsonb)', 'public.tm_cupon_guardar(text,jsonb)', 'public.tm_promocion_estado(text,text,bigint,boolean)',
    'public.tm_seller_promociones(text)',
    'public.tm_analitica_registrar(jsonb)', 'public.tm_metricas_negocio(text,jsonb)', 'public.tm_seller_estadisticas(text,jsonb)']::regprocedure[]
  loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
