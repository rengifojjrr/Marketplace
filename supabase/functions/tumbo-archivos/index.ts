/* =========================================================================
   Tumbo Market — Función de archivos (Supabase Edge Function, Deno)
   -------------------------------------------------------------------------
   Firma las subidas y descargas de Storage para la sesión de Tumbo. Quién
   puede subir o ver qué lo deciden las funciones tm_archivo_* de Postgres;
   esta función solo pide a Storage las URL firmadas con la clave de servicio,
   que nunca sale del servidor.

     POST {accion:'subir', proposito, entidad, tipo, bytes, nombre}
          cabecera x-tumbo-sesion: <token de sesión de Tumbo>
       → tm_archivo_preparar (valida permisos, cuotas, tipo y tamaño; decide la
         ruta) y URL de subida firmada (2 horas, solo esa ruta)
       ← {id, bucket, ruta, url_subida}
     POST {accion:'ver', id}
       → tm_archivo_acceso (¿puede verlo?) y URL de descarga firmada de 5 min
         (o la pública, si el bucket es público)
       ← {url, expira, publico, tipo, nombre}

   Después de subir con PUT a url_subida, el navegador confirma con la RPC
   tm_archivo_confirmar (el archivo queda «listo» solo si Storage lo tiene).

   Se despliega SIN verificación de JWT: autentica con la sesión de Tumbo,
   no con Supabase Auth.
     supabase functions deploy tumbo-archivos --no-verify-jwt
   (o verify_jwt = false en [functions.tumbo-archivos] de supabase/config.toml)

   Usa las variables que Supabase da a toda función: SUPABASE_URL,
   SUPABASE_SERVICE_ROLE_KEY y SUPABASE_ANON_KEY. Sin dependencias externas.
   La pasarela local (tools/supabase-local/pasarela.js) tiene una gemela de
   esta lógica para las pruebas.

   Nota: las RPC salen desde la red de la función, así que el tope de
   escrituras por red de exigir() cuenta las subidas de todos en esa red; el
   tope por cuenta y las cuotas de archivos siguen aplicando por persona.
   ========================================================================= */

const URL_BASE = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLAVE_RPC = Deno.env.get('SUPABASE_ANON_KEY') || SERVICIO;
const MINUTOS_DESCARGA = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-tumbo-sesion',
  'access-control-max-age': '86400',
};

function responder(estado: number, dato: unknown): Response {
  return new Response(JSON.stringify(dato), { status: estado, headers: { ...CORS, 'content-type': 'application/json' } });
}

/* Cada tramo de la ruta, codificado (la ruta la generó el servidor). */
function camino(bucket: string, ruta: string): string {
  return [bucket, ...ruta.split('/')].map(encodeURIComponent).join('/');
}

type Rpc = { ok: true; dato: Record<string, unknown> } | { ok: false; estado: number; error: string; code?: string };

/* Llama a una función tm_* por PostgREST; sus errores ya vienen redactados
   para la persona. */
async function rpc(nombre: string, params: Record<string, unknown>): Promise<Rpc> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: CLAVE_RPC, authorization: `Bearer ${CLAVE_RPC}`, 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const texto = await r.text();
  let dato: Record<string, unknown> | null = null;
  try { dato = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
  if (r.ok && dato) return { ok: true, dato };
  if (r.status === 404 && /function/i.test(String(dato?.message ?? ''))) {
    return { ok: false, estado: 503, error: 'Los archivos todavía no están disponibles en este servidor.' };
  }
  return {
    ok: false,
    estado: r.status >= 500 ? 502 : r.status,
    error: String(dato?.message ?? 'No se pudo completar la acción.'),
    code: dato?.code ? String(dato.code) : undefined,
  };
}

class ErrorStorage extends Error {
  constructor(mensaje: string, readonly estado: number) { super(mensaje); }
}

/* Pide a Storage una URL firmada (con la clave de servicio). */
async function storage(ruta: string, cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${URL_BASE}/storage/v1${ruta}`, {
    method: 'POST',
    headers: { apikey: SERVICIO, authorization: `Bearer ${SERVICIO}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const dato = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorStorage(String(dato?.message ?? `Storage respondió ${r.status}`), r.status);
  return dato;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return responder(405, { error: 'Método no permitido.' });
  if (!URL_BASE || !SERVICIO) return responder(500, { error: 'La función de archivos no está configurada.' });

  let datos: Record<string, unknown>;
  try { datos = await req.json(); } catch { return responder(400, { error: 'Solicitud inválida.' }); }
  const sesion = req.headers.get('x-tumbo-sesion') || null;

  try {
    if (datos.accion === 'subir') {
      const r = await rpc('tm_archivo_preparar', {
        p_sesion: sesion, p_proposito: datos.proposito ?? null, p_entidad: datos.entidad ?? null,
        p_tipo: datos.tipo ?? null, p_bytes: datos.bytes ?? null, p_nombre: datos.nombre ?? null,
      });
      if (!r.ok) return responder(r.estado, { error: r.error, code: r.code });
      const bucket = String(r.dato.bucket), ruta = String(r.dato.ruta);
      const firma = await storage(`/object/upload/sign/${camino(bucket, ruta)}`, {});
      return responder(200, { id: r.dato.id, bucket, ruta, url_subida: `${URL_BASE}/storage/v1${firma.url}` });
    }

    if (datos.accion === 'ver') {
      if (!UUID.test(String(datos.id ?? ''))) return responder(404, { error: 'No encontramos ese archivo.' });
      const r = await rpc('tm_archivo_acceso', { p_sesion: sesion, p_id: datos.id });
      if (!r.ok) return responder(r.estado, { error: r.error, code: r.code });
      const a = r.dato;
      const bucket = String(a.bucket), ruta = String(a.ruta);
      if (a.publico) {
        return responder(200, { url: `${URL_BASE}/storage/v1/object/public/${camino(bucket, ruta)}`, publico: true,
          tipo: a.tipo, nombre: a.nombre });
      }
      const firma = await storage(`/object/sign/${camino(bucket, ruta)}`, { expiresIn: MINUTOS_DESCARGA * 60 });
      return responder(200, { url: `${URL_BASE}/storage/v1${firma.signedURL}`, expira: MINUTOS_DESCARGA * 60,
        publico: false, tipo: a.tipo, nombre: a.nombre });
    }

    return responder(400, { error: 'Acción desconocida.' });
  } catch (e) {
    if (e instanceof ErrorStorage && /not.?found/i.test(e.message)) {
      return responder(404, { error: 'El archivo ya no está en el almacenamiento.' });
    }
    console.error('tumbo-archivos:', e);
    return responder(502, { error: 'El almacenamiento no respondió. Inténtalo de nuevo en unos segundos.' });
  }
});
