/* =========================================================================
   Tumbo Market — Función de envíos (Supabase Edge Function, Deno)
   -------------------------------------------------------------------------
   Manda la bandeja de salida (tumbo.salida) por correo (Resend) y por
   WhatsApp (Cloud API de Meta, con plantillas aprobadas), con reintentos,
   registro de cada entrega o fallo e idempotencia. La lógica vive en
   ./nucleo.mjs (la misma que simula la pasarela local para las pruebas).

     POST {accion: 'enviar', limite?}   toma hasta `limite` (50) pendientes y los envía
       ← {ok, correo, whatsapp, tomados, enviados, reintentos, fallidos, mensaje}
     POST {accion: 'estado'}            qué proveedores tiene (nunca los secretos)
       ← {correo, whatsapp, faltan}

   Quién la puede llamar (nadie más):
     · la clave de servicio (Authorization: Bearer <service_role>);
     · la tarea programada (pg_cron + pg_net: tumbo_privado.tarea_envios),
       con el secreto propio de la base en la cabecera x-tumbo-envios;
     · una cuenta real del equipo (superadmin u Operaciones) desde
       admin/mensajes, con su sesión en x-tumbo-sesion.
   La base lo comprueba (tm_envios_autorizar, solo con la clave de servicio).

   Secretos (supabase secrets set …): RESEND_API_KEY y RESEND_DE (p. ej.
   «Tumbo Market <avisos@tu-dominio>», con el dominio verificado en Resend);
   WHATSAPP_TOKEN, WHATSAPP_NUMERO_ID y, opcional, WHATSAPP_API_VERSION
   (v20.0). Sin ellos no envía nada y lo dice: los mensajes siguen en la
   bandeja para enviarlos a mano.

   Se despliega SIN verificación de JWT (autentica como se dice arriba):
     supabase functions deploy tumbo-envios --no-verify-jwt
   Usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, que Supabase da a toda
   función. Sin dependencias externas.
   ========================================================================= */
// @ts-ignore: módulo JavaScript local sin tipos (lo comparte la pasarela de pruebas)
import { enviarPendientes, proveedores } from './nucleo.mjs';

const URL_BASE = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-tumbo-sesion, x-tumbo-envios',
  'access-control-max-age': '86400',
};

function responder(estado: number, dato: unknown): Response {
  return new Response(JSON.stringify(dato), { status: estado, headers: { ...CORS, 'content-type': 'application/json' } });
}

type Rpc = { ok: boolean; dato?: unknown; error?: string };

async function rpc(nombre: string, params: Record<string, unknown>): Promise<Rpc> {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: { apikey: SERVICIO, authorization: `Bearer ${SERVICIO}`, 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const texto = await r.text();
    let dato: unknown = null;
    try { dato = texto ? JSON.parse(texto) : null; } catch { /* no JSON */ }
    if (r.ok) return { ok: true, dato };
    return { ok: false, error: String((dato as { message?: string } | null)?.message ?? `La base respondió ${r.status}`) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

function config() {
  return {
    resend: { clave: Deno.env.get('RESEND_API_KEY') ?? '', de: Deno.env.get('RESEND_DE') ?? '' },
    whatsapp: {
      token: Deno.env.get('WHATSAPP_TOKEN') ?? '',
      numeroId: Deno.env.get('WHATSAPP_NUMERO_ID') ?? '',
      version: Deno.env.get('WHATSAPP_API_VERSION') ?? '',
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return responder(405, { error: 'Método no permitido.' });
  if (!URL_BASE || !SERVICIO) return responder(503, { error: 'La función no tiene SUPABASE_URL ni la clave de servicio.' });
  let datos: Record<string, unknown> = {};
  try { datos = (await req.json()) ?? {}; } catch { datos = {}; }

  // ¿Quién llama? La clave de servicio, el secreto de la tarea o una cuenta real del equipo.
  let por = '';
  if ((req.headers.get('authorization') ?? '') === `Bearer ${SERVICIO}`) {
    por = 'Clave de servicio';
  } else {
    const secreto = req.headers.get('x-tumbo-envios');
    const sesion = req.headers.get('x-tumbo-sesion');
    if (!secreto && !sesion) return responder(401, { error: 'No autorizado.' });
    const a = await rpc('tm_envios_autorizar', { p_secreto: secreto || null, p_sesion: sesion || null });
    const r = (a.dato ?? {}) as { ok?: boolean; error?: string; por?: string };
    if (!a.ok || !r.ok) return responder(403, { error: r.error ?? a.error ?? 'No autorizado.' });
    por = String(r.por ?? '');
  }

  const accion = String(datos.accion ?? 'enviar');
  if (accion === 'estado') return responder(200, proveedores(config()));
  if (accion !== 'enviar') return responder(400, { error: 'Acción desconocida.' });
  const r = await enviarPendientes({ rpc, http: fetch, config: config(), limite: datos.limite, por });
  return responder(r.ok ? 200 : 502, r);
});
