# Backend de Tumbo Market (Supabase)

La beta funciona en dos modos con la **misma interfaz y las mismas pantallas**:

| Modo | Cuándo | Dónde viven los datos |
| --- | --- | --- |
| **Remoto** | `assets/js/tm-config.js` trae `supabaseUrl` y `supabaseKey` | Postgres de Supabase, compartido por todos los usuarios |
| **Local** | la configuración está vacía | `localStorage` de cada navegador (demo sin conexión) |

En modo remoto el distintivo del encabezado de los paneles dice **BETA** con
una nube; en modo local, **DEMO**.

## Piezas

```
supabase/migrations/
  20261022170000_tumbo_esquema.sql     tablas, índices, auditoría inmutable, secuencias de IDs
  20261022170100_tumbo_seguridad.sql   ayudantes de rol, alta de perfil, RLS y privilegios
  20261022170200_tumbo_funciones.sql   API de negocio: funciones public.tm_*
  20261022170300_tumbo_semilla.sql     datos de la demo, reinicio y tiempo real
assets/js/tm-config.js                 URL y clave publicable del proyecto
assets/js/tm-remoto.js                 motor remoto (sustituye las acciones de TM)
assets/vendor/supabase-js-2.117.3.js   cliente oficial de Supabase (MIT), sin CDN
tools/supabase-local/                  Supabase mínimo en local para probar sin la nube
```

## Modelo de seguridad

1. **Identidad**: Supabase Auth (correo y contraseña). Cada usuario tiene una
   fila en `perfiles` con su **rol** y, si es personal de un comercio, su
   `seller_id`. Un registro desde la web **siempre** nace `comprador`: el rol
   nunca se toma de los datos que envía el navegador.
2. **Lectura**: RLS en las 17 tablas. Cada rol ve solo lo que necesita:

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

3. **Escritura**: las tablas de negocio no tienen privilegio de escritura para
   los usuarios. Todo cambio pasa por una función `public.tm_*` (`SECURITY
   DEFINER`, `search_path` vacío) que, en una sola transacción:
   - exige el rol y la propiedad del recurso (un pedido ajeno responde «no
     encontrado»);
   - bloquea la fila (`FOR UPDATE`) y valida el estado de origen;
   - aplica el cambio, la línea de tiempo, las notificaciones y la auditoría.

   Solo `direcciones` y `carrito_items` admiten escritura directa, limitada por
   RLS a las filas del propio usuario.
4. **Auditoría** de solo agregar: un trigger impide editar o borrar eventos.
5. **Segundo factor**: en la beta es un código fijo (`123456`) verificado en el
   navegador. Es una puerta de demostración, no una defensa. Para producción:
   MFA TOTP de Supabase Auth y políticas que exijan `aal2` en las funciones
   financieras.

## API de negocio

| Función | Rol | Efecto |
| --- | --- | --- |
| `tm_registrar(email, clave, nombre)` | visitante | crea la cuenta de comprador, activa al instante |
| `tm_crear_pedido(tipo, direccion, metodo, ref)` | comprador | un pedido por seller, reserva stock, vacía el carrito |
| `tm_conciliar_pago(id)` | superadmin, finanzas | pago por verificar → por aceptar |
| `tm_aceptar_pedido` · `tm_marcar_listo` · `tm_despachar` | seller, operador | preparación y salida; el despacho descuenta el stock |
| `tm_confirmar_entrega(id)` | comprador | abre la ventana de reclamo, fondos retenidos |
| `tm_cancelar_pedido(id, motivo)` | comprador | antes del despacho; libera la reserva |
| `tm_abrir_disputa` | comprador | dentro de la ventana; congela los fondos |
| `tm_responder_disputa` | seller | respuesta con evidencia |
| `tm_resolver_disputa` | superadmin, ops | reembolso, devolución o liberar |
| `tm_cerrar_ventana` · `tm_ejecutar_liquidacion` | superadmin, finanzas | fondos elegibles → liquidación con comisión y comprobante |
| `tm_guardar_producto` · `tm_pausar_producto` | seller, operador | alta, edición, revisión, pausa |
| `tm_ajustar_producto(sku, campo, valor)` | precio: seller, precios · stock: seller, operador | edición en línea, nunca por debajo de lo reservado |
| `tm_moderar_producto` · `tm_decidir_kyc` | superadmin | publicación y homologación |
| `tm_reiniciar_demo()` | superadmin | vuelve los datos de negocio a la semilla (las cuentas se conservan) |

## Tiempo real

`pedidos`, `productos`, `disputas`, `liquidaciones`, `notificaciones` y
`sellers` están en la publicación `supabase_realtime`. Cuando otro usuario
cambia algo, las pantallas abiertas recargan su caché y se repintan — salvo
que la persona esté escribiendo o tenga un modal abierto: entonces esperan.
Supabase aplica RLS también a estos avisos.

## Desplegar en un proyecto nuevo

1. Crear el proyecto en Supabase (región `us-east-1`).
2. Aplicar las cuatro migraciones en orden (SQL Editor, `supabase db push` o el
   conector MCP). La última siembra las cuentas demo y los datos.
3. Copiar la **Project URL** y la **publishable key** en
   `assets/js/tm-config.js` y publicar.
4. `node tools/verificar-beta.js https://rengifojjrr.github.io/Marketplace`
   recorre la app completa contra el backend (reinicia los datos de la demo).

> Los proyectos del plan gratuito se **pausan tras 7 días sin uso**. Si la beta
> deja de cargar con «No pudimos cargar Tumbo», hay que reactivar el proyecto
> desde el panel de Supabase.

## Probar en local sin la nube

```bash
tools/supabase-local/iniciar.sh            # Postgres + Auth + PostgREST + pasarela
python3 -m http.server 8099                # el sitio
TM_SUPABASE_URL=http://127.0.0.1:54321 \
TM_SUPABASE_KEY=$(node tools/supabase-local/pasarela.js --clave) \
node tools/verificar-beta.js http://127.0.0.1:8099
tools/supabase-local/reaplicar.sh          # vuelve a aplicar las migraciones desde cero
```

El stack local usa los binarios oficiales de Supabase Auth y PostgREST y el
mismo esquema `auth`; no incluye el servidor de tiempo real.
