/* =========================================================================
   Tumbo Market — Función de archivos (Supabase Edge Function, Deno)
   -------------------------------------------------------------------------
   Firma las subidas y descargas de Storage para la sesión de Tumbo, mueve
   al bucket público las fotos confirmadas y borra lo descartado. Quién
   puede subir o ver qué lo deciden las funciones tm_archivo_* de Postgres;
   esta función solo hace en Storage lo que ellas responden, con la clave de
   servicio, que nunca sale del servidor.

     POST {accion:'subir', proposito, entidad, tipo, bytes, nombre}
          cabecera x-tumbo-sesion: <token de sesión de Tumbo>
       → tm_archivo_preparar (valida permisos, cuotas, tipo y tamaño; decide la
         ruta) y URL de subida firmada (2 horas, solo esa ruta; las fotos
         públicas esperan en el bucket privado tumbo-espera)
       ← {id, bucket, ruta, url_subida}
     POST {accion:'confirmar', id}            (después del PUT a url_subida)
       → tm_archivo_confirmar: lo que llegó debe ser lo autorizado y caber en
         la cuota. Si no, borra el objeto y responde el motivo; si es una foto
         pública, la mueve al bucket público y vuelve a confirmar
       ← {id, url_publica}   (relativa al proyecto, o null si es privado)
     POST {accion:'ver', id}
       → tm_archivo_acceso (¿puede verlo?) y URL de descarga firmada de 5 min
         (o la pública, si el bucket es público)
       ← {url, expira, publico, tipo, nombre}
     POST {accion:'limpiar'}
       → tm_archivos_limpiar (solo con la clave de servicio) y borra en
         Storage lo que responde: subidas que no se confirmaron a tiempo,
         descartados y objetos sin fila. Corre también sola, como mucho una
         vez por minuto, mientras la función recibe subidas; se puede
         programar (p. ej. pg_cron + pg_net) para un proyecto sin actividad.
       ← {borrados}

   Se despliega SIN verificación de JWT: autentica con la sesión de Tumbo,
   no con Supabase Auth.
     supabase functions deploy tumbo-archivos --no-verify-jwt
   (o verify_jwt = false en [functions.tumbo-archivos] de supabase/config.toml)

   Usa las variables que Supabase da a toda función: SUPABASE_URL y
   SUPABASE_SERVICE_ROLE_KEY. Sin dependencias externas. La pasarela local
   (tools/supabase-local/pasarela.js) tiene una gemela de esta lógica para
   las pruebas.

   La red del navegador: las RPC salen desde la red de la función, así que
   se llaman con la clave de servicio y la conexión del navegador va en
   x-tumbo-red; tumbo_privado.ip_cliente() solo la cree con esa clave. Así
   los topes por red (escrituras y archivos de las cuentas demo) siguen
   siendo por persona.
   ========================================================================= */

const URL_BASE = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MINUTOS_DESCARGA = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP = /^[0-9A-Fa-f:.]{3,45}$/;
const CADA_LIMPIEZA_MS = 60_000;

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

/* La conexión del navegador, como la ve el borde de Supabase. */
function redDe(req: Request): string {
  const candidatos = [req.headers.get('cf-connecting-ip'), req.headers.get('x-real-ip'),
    (req.headers.get('x-forwarded-for') ?? '').split(',')[0]];
  for (const c of candidatos) {
    const v = (c ?? '').trim();
    if (IP.test(v)) return v;
  }
  return '';
}

type Rpc = { ok: true; dato: Record<string, unknown> } | { ok: false; estado: number; error: string; code?: string };

/* Llama a una función tm_* por PostgREST, con la clave de servicio y la red
   del navegador; sus errores ya vienen redactados para la persona. */
async function rpc(nombre: string, params: Record<string, unknown>, red: string): Promise<Rpc> {
  const cabeceras: Record<string, string> = { apikey: SERVICIO, authorization: `Bearer ${SERVICIO}`, 'content-type': 'application/json' };
  if (red) cabeceras['x-tumbo-red'] = red;
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nombre}`, { method: 'POST', headers: cabeceras, body: JSON.stringify(params) });
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

/* Una llamada a la API de Storage con la clave de servicio. */
async function storage(metodo: string, ruta: string, cuerpo: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${URL_BASE}/storage/v1${ruta}`, {
    method: metodo,
    headers: { apikey: SERVICIO, authorization: `Bearer ${SERVICIO}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const dato = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorStorage(String(dato?.message ?? `Storage respondió ${r.status}`), r.status);
  return dato;
}

type Objeto = { bucket: string; ruta: string };

/* Borra objetos de Storage, agrupados por bucket. */
async function borrar(objetos: Objeto[]): Promise<number> {
  const porBucket = new Map<string, string[]>();
  for (const o of objetos) {
    if (!o || !o.bucket || !o.ruta) continue;
    porBucket.set(o.bucket, [...(porBucket.get(o.bucket) ?? []), o.ruta]);
  }
  let n = 0;
  for (const [bucket, rutas] of porBucket) {
    await storage('DELETE', `/object/${encodeURIComponent(bucket)}`, { prefixes: rutas });
    n += rutas.length;
  }
  return n;
}

/* La tarea de limpieza: Postgres decide qué sobra y aquí se borra. */
async function limpiar(): Promise<number> {
  const r = await rpc('tm_archivos_limpiar', {}, '');
  if (!r.ok) throw new Error(r.error);
  return borrar((r.dato.borrar as Objeto[]) ?? []);
}
let ultimaLimpieza = 0, ultimaPedida = 0;
function limpiarDeVezEnCuando(): void {
  if (Date.now() - ultimaLimpieza < CADA_LIMPIEZA_MS) return;
  ultimaLimpieza = Date.now();
  const tarea = limpiar().catch((e) => console.error('tumbo-archivos: limpieza', e));
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') er.waitUntil(tarea);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return responder(405, { error: 'Método no permitido.' });
  if (!URL_BASE || !SERVICIO) return responder(500, { error: 'La función de archivos no está configurada.' });

  let datos: Record<string, unknown>;
  try { datos = await req.json(); } catch { return responder(400, { error: 'Solicitud inválida.' }); }
  const sesion = req.headers.get('x-tumbo-sesion') || null;
  const red = redDe(req);

  try {
    if (datos.accion === 'subir') {
      const r = await rpc('tm_archivo_preparar', {
        p_sesion: sesion, p_proposito: datos.proposito ?? null, p_entidad: datos.entidad ?? null,
        p_tipo: datos.tipo ?? null, p_bytes: datos.bytes ?? null, p_nombre: datos.nombre ?? null,
      }, red);
      if (!r.ok) return responder(r.estado, { error: r.error, code: r.code });
      limpiarDeVezEnCuando();
      const bucket = String(r.dato.bucket), ruta = String(r.dato.ruta);
      const firma = await storage('POST', `/object/upload/sign/${camino(bucket, ruta)}`, {});
      return responder(200, { id: r.dato.id, bucket, ruta, url_subida: `${URL_BASE}/storage/v1${firma.url}` });
    }

    if (datos.accion === 'confirmar') {
      if (!UUID.test(String(datos.id ?? ''))) return responder(404, { error: 'No encontramos ese archivo.' });
      const confirmar = () => rpc('tm_archivo_confirmar', { p_sesion: sesion, p_id: datos.id }, red);
      let r = await confirmar();
      if (r.ok && r.dato.estado === 'mover') {
        const de = r.dato.de as Objeto, a = r.dato.a as Objeto;
        try {
          await storage('POST', '/object/move', { bucketId: de.bucket, sourceKey: de.ruta, destinationBucket: a.bucket, destinationKey: a.ruta });
        } catch (e) {
          /* (otra confirmación simultánea pudo moverla ya: la siguiente lo dice) */
          console.error('tumbo-archivos: mover', e);
        }
        r = await confirmar();
      }
      if (!r.ok) return responder(r.estado, { error: r.error, code: r.code });
      if (r.dato.estado === 'descartado') {
        await borrar([r.dato.borrar as Objeto]).catch((e) => console.error('tumbo-archivos: borrar', e));
        return responder(400, { error: String(r.dato.error) });
      }
      if (r.dato.estado !== 'listo') {
        return responder(502, { error: 'No pudimos publicar el archivo. Inténtalo de nuevo en unos segundos.' });
      }
      limpiarDeVezEnCuando();
      return responder(200, { id: r.dato.id, url_publica: r.dato.url_publica ?? null });
    }

    if (datos.accion === 'ver') {
      if (!UUID.test(String(datos.id ?? ''))) return responder(404, { error: 'No encontramos ese archivo.' });
      const r = await rpc('tm_archivo_acceso', { p_sesion: sesion, p_id: datos.id }, red);
      if (!r.ok) return responder(r.estado, { error: r.error, code: r.code });
      const a = r.dato;
      const bucket = String(a.bucket), ruta = String(a.ruta);
      if (a.publico) {
        return responder(200, { url: `${URL_BASE}/storage/v1/object/public/${camino(bucket, ruta)}`, publico: true,
          tipo: a.tipo, nombre: a.nombre });
      }
      const firma = await storage('POST', `/object/sign/${camino(bucket, ruta)}`, { expiresIn: MINUTOS_DESCARGA * 60 });
      return responder(200, { url: `${URL_BASE}/storage/v1${firma.signedURL}`, expira: MINUTOS_DESCARGA * 60,
        publico: false, tipo: a.tipo, nombre: a.nombre });
    }

    if (datos.accion === 'limpiar') {
      /* (lo que se borra lo decide Postgres; aquí solo se frena la frecuencia) */
      if (Date.now() - ultimaPedida < 5_000) return responder(200, { borrados: 0, espera: true });
      ultimaPedida = Date.now();
      return responder(200, { borrados: await limpiar() });
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
