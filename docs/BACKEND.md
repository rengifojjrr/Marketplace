# Backend de Tumbo Market (Supabase)

La beta funciona en dos modos con la **misma interfaz y las mismas pantallas**:

| Modo | Cuándo | Dónde viven los datos |
| --- | --- | --- |
| **Remoto** | `assets/js/tm-config.js` trae `supabaseUrl` y `supabaseKey` | Postgres de Supabase, compartido por todos los usuarios |
| **Local** | la configuración está vacía | `localStorage` de cada navegador (demo sin conexión) |

En modo remoto el distintivo del encabezado de los paneles dice **BETA** con
una nube; en modo local, **DEMO**.

## Dónde vive: aislado dentro de un proyecto compartido

Tumbo se aloja en el proyecto Supabase **cotizaciones-interactivas**, que
también usan otras aplicaciones. Está montado para que **nadie más lo vea** y
para **no tocar nada** de lo que ya hay:

- **Esquema propio y oculto.** Los datos están en el esquema `tumbo`
  (ayudantes y semilla en `tumbo_privado`). La API no expone esos esquemas y
  los roles `anon` y `authenticated` no tienen ni permiso de uso: no se pueden
  leer ni listar por `/rest/v1`, por GraphQL ni desde el panel de otra app.
- **Cuentas propias.** Tumbo no usa Supabase Auth: tiene `tumbo.usuarios`
  (contraseñas con bcrypt) y `tumbo.sesiones` (token aleatorio de 32 bytes; en
  la base solo su SHA-256). Así:
  - no crea filas en `auth.users`, por lo que no dispara los disparadores de
    alta de las otras aplicaciones;
  - las cuentas demo de Tumbo (con contraseña pública) **no sirven** para
    entrar en ninguna otra aplicación del proyecto;
  - los usuarios de las otras aplicaciones no tienen cuenta en Tumbo.
- **Una sola puerta.** Lo único visible son las funciones `public.tm_*`. Cada
  una recibe el token de sesión, valida rol, propiedad y estado, y responde
  solo con lo que ese rol puede ver.

Para quitar Tumbo del proyecto basta con:

```sql
drop schema tumbo cascade;
drop schema tumbo_privado cascade;
-- y las funciones public.tm_* (ver tools/supabase-local/reaplicar.sh)
```

## Piezas

```
supabase/migrations/
  20261022170000_tumbo_esquema.sql     esquemas, tablas, auditoría inmutable, IDs, RLS de respaldo
  20261022170100_tumbo_nucleo.sql      sesiones, ayudantes y lectura por rol (tm_cargar)
  20261022170200_tumbo_funciones.sql   operaciones de negocio tm_*
  20261022170300_tumbo_semilla.sql     datos de la demo, reinicio y privilegios
assets/js/tm-config.js                 URL y clave publicable del proyecto
assets/js/tm-remoto.js                 motor remoto: llama a /rest/v1/rpc/tm_* con fetch (sin librerías)
tools/supabase-local/                  Postgres + PostgREST en local para probar sin la nube
tools/verificar-rls.js                 permisos rol por rol contra la API
tools/verificar-beta.js                recorridos completos en navegador
```

## Modelo de seguridad

1. **Identidad**: `tm_acceder(correo, clave)` devuelve un token de sesión que
   vive 7 días (se renueva con el uso) y se invalida con `tm_salir`. Tras 8
   intentos fallidos desde una misma conexión en 15 minutos, esa conexión queda
   frenada para esa cuenta (quien ataca desde su red no bloquea al dueño en la
   suya), con topes adicionales por conexión y por cuenta. La conexión se
   identifica con `cf-connecting-ip`, que fija el borde de Supabase. Un
   registro desde la web **siempre** nace `comprador` (el rol nunca viene del
   navegador) y tiene freno por conexión.
2. **Lectura**: `tm_cargar(sesión)` devuelve de una vez lo que el rol puede ver:

   | Rol | Ve |
   | --- | --- |
   | Visitante | catálogo publicado de sellers aprobados, categorías, configuración |
   | Comprador | lo anterior + sus direcciones, carrito, pedidos, reclamos y avisos |
   | Seller principal | su comercio completo: productos en todo estado, pedidos, reclamos, liquidaciones, KYC propio |
   | Gestor de precios | productos de su comercio (sin pedidos ni finanzas) |
   | Operador | productos y pedidos de su comercio (sin reclamos ni finanzas) |
   | Superadministrador | todo |
   | Operaciones | pedidos y disputas de todo el marketplace |
   | Finanzas | pedidos, liquidaciones, KYC fiscal y auditoría |

   Los pedidos que ve un seller no traen el identificador del comprador, y
   los avisos a un comercio declaran qué roles los ven (dinero y reclamos: solo
   el seller principal).
3. **Escritura**: cada cambio pasa por una función `tm_*` (`SECURITY DEFINER`,
   `search_path` vacío) que, en una sola transacción:
   - exige el rol y la propiedad del recurso (un pedido ajeno responde «no
     encontrado»);
   - bloquea la fila (`FOR UPDATE`) y valida el estado de origen;
   - aplica el cambio, la línea de tiempo, las notificaciones y la auditoría.
4. **Reglas de negocio que el servidor hace cumplir**: un pedido por seller y
   reserva de stock atómica; tope de 5 pagos sin conciliar por comprador;
   Finanzas puede rechazar un pago y liberar la reserva; el stock nunca baja de
   lo reservado; el precio vigente solo lo cambian el seller principal y el
   gestor de precios; cambiar el contenido de un producto publicado lo devuelve
   a moderación; el reclamo solo dentro de la ventana; la entrega la confirma
   el comprador u Operaciones con la prueba del courier; no se liquida un neto
   negativo. Las operaciones de un mismo comprador sobre su carrito se
   serializan, así que dos pestañas a la vez no descuadran las reservas.
5. **Auditoría** de solo agregar: los disparadores impiden editar, borrar o
   vaciar eventos (también al reiniciar la demo).
6. **Segundo factor**: en la beta es un código fijo (`123456`) verificado en el
   navegador. Es una puerta de demostración, no una defensa. Para producción:
   TOTP en el servidor exigido por las funciones financieras.
7. **Defensa en profundidad**: RLS activo y sin políticas en todas las tablas
   de `tumbo`; aunque alguien expusiera el esquema por error, ninguna fila
   sería legible.

## API

| Función | Quién | Efecto |
| --- | --- | --- |
| `tm_acceder(email, clave)` · `tm_registrar(email, clave, nombre)` · `tm_salir` · `tm_sesion` | cualquiera | sesión |
| `tm_cargar(sesión)` | cualquiera | la caché del rol (visitante sin sesión) |
| `tm_carrito_poner` · `tm_carrito_quitar` · `tm_fusionar_carrito` · `tm_direccion_agregar` · `tm_direccion_quitar` | comprador | carrito y direcciones |
| `tm_crear_pedido(tipo, dirección, método, ref)` | comprador | un pedido por seller, reserva stock, vacía el carrito |
| `tm_conciliar_pago` · `tm_rechazar_pago` | superadmin, finanzas | por aceptar, o cancelado con la reserva liberada |
| `tm_aceptar_pedido` · `tm_marcar_listo` · `tm_despachar` | seller, operador | preparación y salida; el despacho descuenta el stock |
| `tm_confirmar_entrega` | comprador, ops, superadmin | abre la ventana de reclamo, fondos retenidos |
| `tm_cancelar_pedido` | comprador | antes del despacho; libera la reserva |
| `tm_abrir_disputa` · `tm_responder_disputa` · `tm_resolver_disputa` | comprador · seller · superadmin y ops | reclamo con fondos congelados hasta la decisión |
| `tm_cerrar_ventana` · `tm_ejecutar_liquidacion` | superadmin, finanzas | fondos elegibles → liquidación con comisión y comprobante |
| `tm_guardar_producto` · `tm_pausar_producto` | seller, operador | alta, edición, revisión, pausa |
| `tm_ajustar_producto` | precio: seller, precios · stock: seller, operador | edición en línea |
| `tm_moderar_producto` · `tm_decidir_kyc` | superadmin | publicación y homologación |
| `tm_marcar_notificaciones_leidas` | con sesión | lectura individual de avisos |
| `tm_reiniciar_demo` | superadmin | vuelve los datos de negocio a la semilla (cuentas y auditoría se conservan) |

## Cambios de otros usuarios

Mientras la pestaña está a la vista, la app vuelve a pedir `tm_cargar` cada
20 segundos con su propia sesión y se repinta solo si algo cambió — salvo que
la persona esté escribiendo o tenga un modal abierto: entonces espera. No se
usa un canal público de Realtime: en un proyecto compartido delataría la
actividad de Tumbo.

## Desplegar o actualizar

1. Aplicar las cuatro migraciones en orden (SQL Editor, `supabase db push` o
   el conector MCP). La última siembra las cuentas demo y los datos.
2. Poner la **Project URL** y la **publishable key** en
   `assets/js/tm-config.js` y publicar.
3. Verificar:

   ```bash
   NODE_USE_ENV_PROXY=1 TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/verificar-rls.js
   node tools/verificar-beta.js https://rengifojjrr.github.io/Marketplace
   ```

   Ambas reinician los datos de la demo.

> El proyecto usa el plan gratuito: si pasa 7 días sin actividad, Supabase lo
> pausa. Si la beta muestra «No pudimos cargar Tumbo», hay que reactivarlo
> desde el panel de Supabase.

## Probar en local sin la nube

```bash
tools/supabase-local/iniciar.sh            # Postgres + PostgREST + pasarela (y Auth, que Tumbo no usa)
python3 -m http.server 8099                # el sitio
TM_SUPABASE_URL=http://127.0.0.1:54321 \
TM_SUPABASE_KEY=$(node tools/supabase-local/pasarela.js --clave) \
node tools/verificar-beta.js http://127.0.0.1:8099
tools/supabase-local/reaplicar.sh          # vuelve a aplicar las migraciones desde cero
```

El stack local usa el binario oficial de PostgREST y reproduce los roles y
tiempos límite del proyecto.
