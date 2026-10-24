# Tumbo Market en producción

Lo que falta para operar de verdad y **depende de la persona dueña del
proyecto** (una cuenta, un contrato, un pago o una firma), en el orden en que
conviene hacerlo. Todo lo demás está construido por dentro y probado; donde
algo depende de un tercero, la interfaz lo dice («pendiente de configurar»,
«sin pg_cron», «envío por WhatsApp pendiente de conectar»…) y nunca simula
que funcionó.

Detalle técnico: [BACKEND.md](BACKEND.md) (despliegue, seguridad, API) y
cada dominio en [docs/dominios/](dominios/).

## Lista de lo que falta

| # | Qué | Quién lo da | Sin eso… |
| --- | --- | --- | --- |
| 1 | **Proyecto Supabase propio y de pago** (no el compartido `cotizaciones-interactivas`) | Supabase (plan Pro) | El plan gratuito se pausa a los 7 días sin actividad y no tiene respaldos diarios ni recuperación a un punto en el tiempo. |
| 2 | **Dominio propio** (p. ej. `tumbo.com.ve`) con su DNS apuntando a GitHub Pages (o a otro hosting estático) | registrador del dominio | Los buscadores no leen `robots.txt` (el sitio vive en una subcarpeta) y los enlaces de los correos apuntan a `github.io`. |
| 3 | **Correo**: Resend (u otro) con el dominio verificado → secreto `RESEND_API_KEY` | Resend | Los códigos, enlaces y avisos quedan en la bandeja de salida y el equipo los envía a mano. |
| 4 | **WhatsApp Business Platform**: número, plantillas aprobadas → `WHATSAPP_TOKEN` y `WHATSAPP_NUMERO_ID` | Meta | Igual que el correo: bandeja manual con `wa.me`. |
| 5 | **Cobro**: datos reales del beneficiario (Pago Móvil, transferencia, Zelle, USDT) y, si se quiere verificación automática, una API bancaria o un agregador y el botón de pago C2P | el banco o el agregador | Finanzas concilia con el estado de cuenta (ya funciona) y el comprador ve «pendiente de configurar» en los datos de pago. |
| 6 | **Couriers** (MRW, Zoom, Tealca, Liberty Express, Domesa): convenios, tarifas oficiales, oficinas, patrones de rastreo y, si hay, API de guías; convenio de cobro en destino | cada courier | Las guías se cargan a mano y la cotización usa tarifas de referencia. |
| 7 | **Imprenta digital autorizada por el SENIAT** para facturas con número de control | una imprenta digital | Tumbo entrega un recibo **no fiscal**. |
| 8 | **Revisión legal** de términos, privacidad, contrato del comercio y devoluciones | abogado | Los textos de Comunicación están marcados como borrador para revisión. |
| 9 | **Contador**: custodia de fondos, IVA, IGTF, diferencial cambiario y plan de cuentas | contador | El libro mayor funciona con un plan de cuentas razonable, no validado. |
| 10 | **Financiamiento** (Cashea u otro) | convenio | No se ofrece. |
| 11 | Secretos de GitHub para el **respaldo diario**: `SUPABASE_DB_URL` y `RESPALDO_CLAVE` | la persona dueña | El flujo «Respaldo» termina avisando y no respalda nada. |
| 12 | Un **monitor externo** (UptimeRobot, Better Stack…) contra `tm_salud` | servicio de terceros | Nadie avisa si la base no responde. |

## Puesta en marcha, paso a paso

1. **Proyecto**: crear el proyecto propio (región más cercana: `us-east-1`),
   habilitar **pg_cron** y **pg_net** (Database → Extensions) y aplicar
   todas las migraciones de `supabase/migrations/` en orden (`supabase db
   push` o el SQL Editor), incluida la de integración de cada ola (la de la
   ola 2, `20261024190000`, al final). Las grandes pasan del límite de una
   llamada del SQL Editor o de la API: se aplican en trozos de sentencias
   completas con `node tools/supabase-local/partir-migracion.js <archivo>
   <carpeta> --max 30000`, cada trozo en orden. Después,
   superadmin → «Reiniciar datos de la demo» (solo mientras la demo esté
   encendida: ver abajo).
2. **Funciones**: `supabase functions deploy tumbo-archivos --no-verify-jwt`
   y `supabase functions deploy tumbo-envios --no-verify-jwt` (la de
   Comunicación, con sus secretos: `supabase secrets set RESEND_API_KEY=…
   RESEND_DE=… WHATSAPP_TOKEN=… WHATSAPP_NUMERO_ID=…`). Las plantillas de
   WhatsApp aprobadas por Meta se marcan en `admin/mensajes`; hasta entonces
   esos mensajes quedan para enviarlos a mano.
3. **Sitio**: la *Project URL* y la *publishable key* en
   `assets/js/tm-config.js`. Ese archivo no necesita regenerar: el service
   worker lo pide primero a la red, así que quien ya visitó el sitio recibe
   la configuración nueva en su visita siguiente. **Cualquier otro archivo
   del sitio** que cambies: `python3 tools/generar_paginas.py` y publica
   también lo que regenera (`sw.js` y las páginas); si se olvida, el service
   worker revalida en segundo plano y lo trae en la visita siguiente, pero
   la CI lo marca. Con dominio propio: `CNAME` en la raíz del repositorio
   (GitHub Pages → Custom domain, con HTTPS), regenerar con
   `TM_SITIO_URL=https://tu-dominio python3 tools/generar_paginas.py` (sitemap,
   robots y Open Graph) y fijar el ajuste `sitio_url` (abajo).
4. **Primera cuenta real de superadministración** (la documentó Cuentas,
   [cuentas.md](dominios/cuentas.md#primera-cuenta-real-de-superadministrador-puesta-en-marcha)),
   en el SQL Editor (tumbo_privado no se expone por la API):

   ```sql
   select tumbo_privado.invitacion_inicial('dueña@tu-dominio.com');
   ```

   Devuelve un enlace que vence en 7 días: al abrirlo se fijan el nombre y la
   contraseña. En **Mi cuenta → Seguridad** se activa la verificación en dos
   pasos (guarda la **clave manual** y los **códigos de respaldo** fuera del
   teléfono). Sin ella no se cambian ajustes ni se mueve dinero. El resto del
   equipo entra por invitación desde `admin/usuarios`.
5. **Ajustes** (Backoffice, o `tm_ajuste_guardar` con la sesión elevada; los
   valores iniciales dicen «PENDIENTE DE CONFIGURAR», nunca datos inventados):
   `sitio_url` (la dirección pública), `pagos_beneficiario` (con
   `configurado: true`), `soporte`, `funciones_url`
   (`https://<referencia>.supabase.co/functions/v1`, para que la limpieza
   programada de archivos borre en Storage), `envios` (su `funcion_url`:
   `https://<referencia>.supabase.co/functions/v1/tumbo-envios`, para que la
   tarea `envios` llame a la función), `tasa_bcv` (confirmar la fuente),
   `impuestos`, `liquidaciones` y `logistica`. Antes de que exista el editor
   del Backoffice, por SQL:

   ```sql
   update tumbo.ajustes set valor = '"https://tu-dominio"' where clave = 'sitio_url';
   update tumbo.ajustes set valor = '"https://<ref>.supabase.co/functions/v1"' where clave = 'funciones_url';
   ```

   `sitio_url`, `envios` y `funciones_url` son ajustes de seguridad (de ahí
   salen los enlaces con token de los correos y adónde llama Tumbo a sus
   funciones): desde el Backoffice solo los propone un superadministrador,
   los aprueba otro y solo pueden apuntar al dominio que ya tienen (el que
   cargaste por SQL) o a uno que autorices tú por SQL, p. ej. para mudar el
   sitio a un dominio propio:

   ```sql
   insert into tumbo_privado.secretos (nombre, valor) values ('hosts_sitio_url', 'tumbo.com.ve www.tumbo.com.ve')
   on conflict (nombre) do update set valor = excluded.valor;
   ```

   (`hosts_envios` y `hosts_funciones_url` para las funciones, `hosts_tasa_bcv`
   para otra fuente de la tasa.) `reembolsos`, `tasa_bcv`, `conciliacion`,
   `riesgo` y `analitica` también piden la segunda aprobación.

6. **Tareas programadas**: en `admin/sistema`, «Programar tareas» (cuenta
   real con 2FA). Comprueba que todas quedan «Al día» en su primera corrida
   (la tasa cada 3 horas, la liquidación los lunes). Si una falla, la campana
   de la superadministración lo avisa y `admin/sistema` muestra el error.
7. **Couriers, tarifas y oficinas** (`admin/envios`), **cuentas de
   liquidación** de los comercios y **formatos de los estados de cuenta** de
   cada banco (Finanzas).
8. **Verificar** contra la nube (reinician la demo: solo antes de lanzar):

   ```bash
   NODE_USE_ENV_PROXY=1 TM_NUBE=1 TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL \
     TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/verificar-todo.js https://tu-dominio --sin-local
   ```

9. **Respaldos** y **monitor** (abajo) antes de recibir el primer pedido real.

## Apagar la demo cuando se lance

La demo son siete cuentas con contraseña pública (`demo1234`, código
`123456`), los comercios y productos de la semilla y el botón «Reiniciar datos
de la demo». Al lanzar:

1. **Cerrar las cuentas de prueba** (el acceso las rechaza y sus sesiones
   dejan de valer al momento):

   ```sql
   begin;
   update tumbo.usuarios set activo = false where tumbo_privado.cuenta_demo(email);
   delete from tumbo.sesiones where usuario_id in (select id from tumbo.usuarios where tumbo_privado.cuenta_demo(email));
   commit;
   ```

2. **Sacar de la tienda los comercios de la semilla** (sus productos dejan
   de verse; sus pedidos de prueba quedan en la base, fuera de la vista):

   ```sql
   begin;
   select id, nombre from tumbo.sellers where tumbo_privado.comercio_de_prueba(id);   -- revisa la lista
   update tumbo.sellers set estado = 'suspendido' where tumbo_privado.comercio_de_prueba(id);
   commit;
   ```

   (Si algún comercio real todavía no tiene cuenta propia,
   `comercio_de_prueba` lo cuenta como de prueba: invítalo antes.)
3. **Apagar el reinicio en el servidor**: «Reiniciar datos de la demo» borra
   pedidos, productos y expedientes de **todos** los comercios. Con el ajuste
   `demo_activa = false` el servidor lo rechaza para todos, también para una
   cuenta real con sesión elevada (desde el Backoffice con
   `tm_ajuste_guardar`, o en el SQL Editor):

   ```sql
   update tumbo.ajustes set valor = 'false', actualizado = now(), por = 'lanzamiento' where clave = 'demo_activa';
   ```

4. **En el sitio**: `demo: false` en `assets/js/tm-config.js`

   ```js
   window.TM_CONFIG = { supabaseUrl: '…', supabaseKey: '…', demo: false };
   ```

   El acceso deja de ofrecer las cuentas de prueba, la tienda deja de decir
   «beta» (pie y avisos) y el menú de la cuenta ya no ofrece «Reiniciar datos
   de la demo». No hace falta regenerar: el service worker pide
   `tm-config.js` primero a la red.
5. Quitar `noindex` no hace falta (la tienda pública ya es indexable); sí
   enviar el `sitemap.xml` a Google Search Console con el dominio propio.

## Respaldos

**Diario, cifrado** (`.github/workflows/respaldo.yml`, 03:17 de Caracas, o a
mano desde Actions → Respaldo → Run workflow):

1. En GitHub → Settings → Secrets and variables → Actions:
   - `SUPABASE_DB_URL`: Supabase → Connect → *Session pooler* (usuario
     `postgres` y su contraseña). Es la llave de toda la base: solo como
     secreto.
   - `RESPALDO_CLAVE`: una frase de 20 caracteres o más. **Guárdala también
     fuera de GitHub** (un gestor de contraseñas): sin ella el respaldo no se
     abre.
2. Cada corrida deja un artefacto `tumbo-respaldo-AAAAMMDD-HHMM` (30 días)
   con `…tar.gpg`: los esquemas `tumbo` y `tumbo_privado` (datos y
   privilegios), las funciones `public.tm_*` con sus permisos, los buckets de
   Tumbo y un manifiesto con las filas y la huella del contenido de cada
   tabla (de la misma foto de la base que el volcado), cifrado con AES-256.

El respaldo lleva las contraseñas (bcrypt), los secretos de la 2FA **y la
clave con que se cifran** (`tumbo_privado.secretos`) y los datos de las
personas: por eso nunca se guarda sin cifrar. Conviene mover esa clave a
Supabase Vault en el proyecto propio (lo propone Cuentas).

**No incluye los archivos de Storage** (fotos, documentos KYC, comprobantes):
solo sus filas. Con el plan de pago, Supabase respalda la base; para los
archivos, una copia periódica de los buckets `tumbo-publico` y `tumbo-privado`
con la API S3 de Storage (p. ej. `rclone sync`) a otro proveedor.

**Restaurar** (en un proyecto **sin** Tumbo: uno nuevo, o después de
`tools/retirar-tumbo.sql`):

```bash
# 1. bajar el artefacto de Actions y descifrarlo
gpg --decrypt tumbo-respaldo-20261101-0717.tar.gpg > respaldo.tar      # pide RESPALDO_CLAVE
# 2. restaurar (crea las extensiones, los esquemas, las funciones tm_* y los
#    buckets; compara filas y contenido de cada tabla con el manifiesto y las
#    secuencias con sus columnas; con pg_cron vuelve a programar las tareas)
PGBIN=/usr/lib/postgresql/17/bin tools/respaldo.sh restaurar respaldo.tar "postgresql://postgres:…@…/postgres"
```

Después: desplegar la función `tumbo-archivos`, recargar el esquema de la API
(`notify pgrst, 'reload schema'`, lo hace el script), copiar los archivos de
Storage y apuntar `tm-config.js` al proyecto nuevo si cambió (sin regenerar:
el service worker lo pide primero a la red y cada navegador usa el proyecto
nuevo en su visita siguiente; si tocas otro archivo del sitio, sí:
`python3 tools/generar_paginas.py` y publica `sw.js` con lo demás).

**Simulacro** (cada vez que cambian las migraciones, y la CI lo corre en cada
push): `tools/respaldo.sh simulacro <base-local>` vuelca la base local, la
restaura en una base nueva como la de un proyecto Supabase, compara las filas
y la huella del contenido de cada tabla (la suma de los md5 de sus filas: un
valor cambiado en cualquier fila la cambia) y las secuencias, comprueba que
la huella detecta una fila cambiada, entra con una cuenta y comprueba que la
auditoría sigue siendo inmutable. Para ensayar con un respaldo real de la nube, una vez al trimestre:
levantar el entorno local (`tools/supabase-local/levantar.sh tumbo_ensayo …`
crea la base con las migraciones; para el ensayo, una base vacía con
`tools/supabase-local/base.sql`), descifrar el último artefacto y
`tools/respaldo.sh restaurar respaldo.tar "postgresql:///<base>?host=/tmp&port=54322&user=postgres"`.

## Monitoreo

- **`tm_salud()`**: `POST https://<ref>.supabase.co/rest/v1/rpc/tm_salud`
  con la cabecera `apikey: <publishable key>` → `{"ok": true, …}`. Un
  monitor cada 5 minutos que avise por correo o WhatsApp si no responde 200.
- **`admin/sistema`**: tareas atrasadas o con error, la tasa desactualizada,
  la bandeja sin enviar y los errores del navegador (sin datos personales).
- Supabase → Logs y el *Security Advisor* (los avisos esperados están en
  [BACKEND.md](BACKEND.md)).

## Seguridad al lanzar

- 2FA activa en todas las cuentas del equipo (superadmin, Finanzas,
  Operaciones) y en los comercios principales (la exige el servidor).
- Las suites de prueba **no** se corren contra producción después del
  lanzamiento (reinician la demo y crean cuentas de prueba).
- Revisar quién tiene acceso al repositorio (los artefactos de Actions se
  descargan con acceso de lectura: por eso van cifrados) y al proyecto de
  Supabase.
- Rotar la *publishable key* no hace falta (es pública por diseño); la
  contraseña de `postgres` sí, si alguna vez salió de los secretos.
