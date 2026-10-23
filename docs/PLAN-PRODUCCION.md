# Plan: de beta a plataforma funcional

Este documento guía la construcción de todo lo que le falta a Tumbo Market
para operar de verdad (la lista completa por usuario está en la conversación
de origen y resumida abajo). Se construye en **olas**; cada ola se integra,
se revisa de forma adversarial, se prueba y se publica antes de la siguiente.

## Reglas para todo el trabajo

- **Base compartida, solo agregar.** El backend vive en el proyecto Supabase
  compartido (`tumbo` y `tumbo_privado`). Las migraciones solo agregan:
  `create table`, `alter table … add column`, `create index`,
  `create or replace function`, `insert … on conflict do nothing`. Nada de
  `drop`, `delete`, `update`, `truncate` ni `alter … drop/alter column` en el
  nivel superior de una migración (el conector pide confirmación humana).
  Para cambiar una restricción existente, se agrega una columna o tabla nueva.
- **Una migración por equipo y ola**, con el número reservado en la tabla de
  abajo. Cada una termina con los `grant execute … to anon, authenticated` de
  sus funciones `public.tm_*` nuevas **por firma exacta**,
  `revoke execute on all functions in schema tumbo_privado from public, anon, authenticated`
  y `notify pgrst, 'reload schema'`. Toda función nueva va con
  `security definer set search_path = ''` y nombres totalmente calificados.
- **Extensiones que no existen en local** (`pg_cron`, `pg_net`) se usan dentro de
  `do $$ begin if exists (select 1 from pg_extension where extname = '…') then … end if; end $$`.
  Las tareas programadas llaman a funciones `tumbo_privado.tarea_*()` que las
  pruebas pueden invocar directamente. `pg_trgm` y `unaccent` sí existen en
  local y en la nube: se crean con `create extension if not exists … with schema extensions`.
- **El cliente es modular.** Cada dominio tiene su archivo
  `assets/js/tm-mod-<dominio>.js` con sus llamadas (`TM.api`), sus vistas
  (`APP.registrar`), sus entradas de menú (`APP.nav`) y sus ganchos
  (`APP.gancho`). Las páginas nuevas se declaran en `tools/paginas/<dominio>.json`
  y se generan con `python3 tools/generar_paginas.py`. Los archivos comunes
  (`tm-app.js`, `tm-remoto.js`, `tm-store.js`, `tm-vistas-*.js`) solo se tocan
  en lo que el dueño de la tabla de abajo indica.
- **Funciones nuevas = solo con servidor.** En modo local (`localStorage`)
  `TM.api` responde «Esta función necesita el servidor de Tumbo» y las vistas
  nuevas lo muestran con un aviso; el modo local queda como demo sin conexión
  de los flujos originales.
- **Pruebas por dominio**: `tools/api-<dominio>.js` (permisos y reglas por la
  API) y `tools/e2e-<dominio>.js` (navegador, con el arnés `tools/e2e-comun.js`).
  `node tools/verificar-todo.js` corre todo. Las suites existentes deben seguir
  en verde.
- **Idioma y estilo**: español de Venezuela, mismo estilo del código vecino,
  mensajes de error claros para la persona (no técnicos).
- **Nada de datos falsos presentados como reales.** Lo que dependa de un
  proveedor externo queda construido por dentro y la interfaz dice qué falta
  (p. ej. «envío por WhatsApp pendiente de conectar»), nunca simula que funcionó.

## Contratos entre equipos (definidos en la ola 0)

| Pieza | Firma | Dueño de la implementación |
| --- | --- | --- |
| Sesión elevada (2FA) | `tumbo_privado.exigir_elevada(p_yo tumbo.usuarios) returns void` | Cuentas |
| Permiso fino | `tumbo_privado.tiene_permiso(p_yo tumbo.usuarios, p_permiso text) returns boolean` | Cuentas |
| Cotización de envío | `tumbo_privado.cotizar_envio(p_seller text, p_destino jsonb, p_items jsonb) returns jsonb` | Logística |
| Promociones y cupones | `tumbo_privado.aplicar_promociones(p_usuario uuid, p_items jsonb, p_cupon text) returns jsonb` | Crecimiento |
| Riesgo | `tumbo_privado.riesgo_pedido(p_usuario uuid, p_datos jsonb) returns jsonb` | Crecimiento |
| Reembolso | `tumbo_privado.crear_reembolso(p_pedido text, p_monto_usd numeric, p_motivo text) returns bigint` | Pagos (la ola 0 crea la tabla y la versión básica) |
| Mensajes salientes | `tumbo_privado.encolar(p_usuario uuid, p_plantilla text, p_datos jsonb) returns void` | Comunicación (la ola 0 crea la bandeja) |
| Archivos | `tm_archivo_preparar` / `tm_archivo_confirmar` / función `tumbo-archivos`; en el cliente `TM.archivos.subir(...)` | Ola 0 |
| Ajustes | `tumbo.ajustes` + `tumbo_privado.ajuste(clave)` | Ola 0 (la edición desde el backoffice: Crecimiento) |

## Olas, equipos y migraciones

| Ola | Equipo (dominio) | Migración | Puertos locales (PostgREST / pasarela / sitio) |
| --- | --- | --- | --- |
| 0 | Fundaciones | `20261023100000_tumbo_fundaciones.sql` | 54350 / 54351 / 8099 |
| 1 | Cuentas y seguridad (`cuentas`) | `20261023110000_tumbo_cuentas.sql` | 54360 / 54361 / 8101 |
| 1 | Catálogo y comercio (`catalogo`) | `20261023120000_tumbo_catalogo.sql` | 54362 / 54363 / 8102 |
| 1 | Pagos y finanzas (`pagos`) | `20261023130000_tumbo_pagos.sql` | 54364 / 54365 / 8103 |
| 1 | Logística y operación (`logistica`) | `20261023140000_tumbo_logistica.sql` | 54366 / 54367 / 8104 |
| 2 | Comunicación y confianza (`comunicacion`) | `20261023150000_tumbo_comunicacion.sql` | 54368 / 54369 / 8105 |
| 2 | Backoffice y crecimiento (`crecimiento`) | `20261023160000_tumbo_crecimiento.sql` | 54370 / 54371 / 8106 |
| 2 | Plataforma (`plataforma`) | `20261023170000_tumbo_plataforma.sql` | 54372 / 54373 / 8107 |

Cada equipo levanta su propio entorno local con
`tools/supabase-local/levantar.sh <base> <puerto-postgrest> <puerto-pasarela>`
(crea la base si no existe, aplica todas las migraciones y arranca PostgREST y
la pasarela) y sirve el sitio con `python3 -m http.server <puerto> --bind 127.0.0.1`.

### Ola 0 — Fundaciones
Infraestructura común del cliente (`TM.api`, `APP.nav`, `APP.gancho`, páginas
por manifiesto, arnés de pruebas), ajustes, columnas de contacto del usuario,
direcciones completas y destinatario del pedido, archivos (Storage + función
`tumbo-archivos` + simulación local), bandeja de mensajes salientes,
reembolsos básicos, contratos y librería de códigos QR.

### Ola 1
- **Cuentas y seguridad**: perfil, cambio y recuperación de contraseña,
  verificación de correo y teléfono, sesiones por dispositivo, 2FA TOTP real
  verificada en el servidor y sesiones elevadas, invitaciones (equipo del
  seller, personal interno, alta de sellers), administración de usuarios y
  permisos finos, libreta de direcciones completa.
- **Catálogo y comercio**: galería de fotos, variantes, categorías con
  atributos, carga masiva CSV, búsqueda en el servidor con filtros, favoritos y
  alertas, KYC real con documentos y expediente del seller, tienda pública
  editable, inventario con movimientos, herramientas del gestor de precios,
  quitar valoraciones sembradas e insignia honesta.
- **Pagos y finanzas**: entidad «pago» por checkout, checkout y pago guiado,
  métodos (Pago Móvil, transferencia, Zelle, USDT, efectivo), datos fiscales,
  IVA e IGTF, tasa BCV automática con historial, conciliación con estado de
  cuenta y excepciones, vencimiento y pago tardío, reembolsos, cuentas
  bancarias de sellers, liquidaciones con ciclo de vida y calendario, libro
  mayor, panel financiero, estados de cuenta y exportaciones.
- **Logística y operación**: couriers, zonas y tarifas, cotización real,
  configuración de envíos del seller, guías con foto y rastreo, etiquetas,
  picking por lotes, incidencias, cancelación por seller u operaciones,
  reclamo por pedido no recibido, SLA con vencimientos automáticos,
  autoconfirmación y cierre de ventanas, panel de operaciones y detalle 360 del
  pedido con notas internas.

### Ola 2
- **Comunicación y confianza**: envío de correo y WhatsApp (si hay credenciales)
  y bandeja manual con `wa.me`, preferencias de aviso, chat por pedido,
  preguntas en la ficha, reseñas verificadas y reputación calculada, centro de
  ayuda y textos legales (para revisión de abogado) con aceptación versionada,
  disputas con mensajes, plazos, reembolso parcial y apelación, denuncias,
  soporte.
- **Backoffice y crecimiento**: ajustes y comisiones editables con vigencia,
  interruptores y aviso de incidencia, moderación con reglas y masiva, ficha
  360 de seller y de comprador, sanciones y niveles, riesgo y listas negras,
  banners, cupones, ofertas y campañas, métricas de negocio y analítica.
- **Plataforma**: tareas programadas, PWA, SEO, observabilidad, CI, accesibilidad,
  rendimiento y respaldos.

## Lo que no se puede terminar sin la persona dueña del proyecto

Queda construido por dentro y documentado, pero necesita una cuenta, un
contrato, un pago o una firma:

- Proyecto Supabase propio y de pago (respaldos, sin pausa a los 7 días) y dominio propio.
- Proveedor de correo (p. ej. Resend) con dominio verificado → secreto `RESEND_API_KEY`.
- WhatsApp Business Platform (número, plantillas aprobadas) → secretos `WHATSAPP_TOKEN`, `WHATSAPP_NUMERO_ID`.
- Verificación automática de pagos (API bancaria o agregador) y botón de pago C2P.
- Convenios con couriers para guías por API.
- Imprenta digital autorizada por el SENIAT para facturas con número de control.
- Cashea u otro financiamiento (convenio).
- Revisión legal de términos, privacidad, contrato de seller y devoluciones; contador para impuestos.

## Avance

- [ ] Ola 0 — Fundaciones
- [ ] Ola 1 — Cuentas · Catálogo · Pagos · Logística
- [ ] Ola 2 — Comunicación · Crecimiento · Plataforma
