#!/usr/bin/env node
/**
 * Pruebas por la API de la plataforma (migración
 * 20261024170000_tumbo_plataforma.sql).
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… [TM_PGDATABASE=…] node tools/api-plataforma.js
 *
 * Por la API: tm_salud es pública y mínima; tm_error_cliente acepta un
 * error sin sesión, rechaza lo que no es un error y nunca responde con un
 * error HTTP; tm_sistema es de la superadministración (una cuenta de
 * prueba la lee sin el detalle: ni resultados ni errores de las corridas,
 * ni los errores de los navegadores, ni el nombre de la cuenta real que
 * corrió una tarea; un comprador o un visitante no la leen); correr y
 * programar tareas lo rechazan las cuentas de prueba (sesión elevada).
 * Con TM_PGDATABASE (solo en local), además:
 *   · el texto de un error llega sin datos personales (correos, números,
 *     fichas, consulta de la URL) y un error repetido suma «veces»;
 *   · el tope por red (desde otras direcciones de 127.0.0.0/8), el techo
 *     global y el máximo de filas;
 *   · el envoltorio de las tareas: registra la corrida, deshace el trabajo
 *     de una tarea que falla, avisa una sola vez, no corre dos veces a la
 *     vez y sabe de las funciones que faltan;
 *   · la programación con pg_cron (simulado dentro de una transacción que
 *     se deshace): envuelve los trabajos de cada dominio sin cambiarles el
 *     nombre ni el horario, programa los que faltan, adopta los de un
 *     dominio nuevo, quita los duplicados de Tumbo (también los sin nombre,
 *     que nunca quedan en lugar del suyo), no toca los ajenos y repetirla
 *     no cambia nada;
 *   · una cuenta real con sesión elevada corre una tarea (corrida y
 *     auditoría; una vez por minuto) y no corre las que no son manuales; la
 *     cuenta de prueba no ve su nombre, el resultado, los errores de los
 *     navegadores ni el mensaje de pg_cron; la cuenta real sí;
 *   · con la demo apagada (ajuste demo_activa = false) el reinicio de la
 *     demo se rechaza también para una cuenta real con sesión elevada;
 *   · las funciones tarea_* sin catálogo: solo las que el envoltorio puede
 *     correr (ningún ayudante);
 *   · las tareas propias (mantenimiento y almacenamiento), el reinicio de la
 *     demo y los permisos (tm_* nuevas y tumbo_privado) y que
 *     retirar-tumbo.sql conoce todas las tm_* de la base.
 * Sin TM_PGDATABASE lo informa como omitido. Reinicia la demo al terminar.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const R = require('./reinicio-comun');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE);
if (!LOCAL && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}
const BD = LOCAL ? (process.env.TM_PGDATABASE || '') : '';
const RAIZ = path.join(__dirname, '..');

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const DEMO = { comprador: 'comprador@demo.ve', superadmin: 'superadmin@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo' };
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };
const REAL = 'plataforma-pruebas@tumbo-local.ve';

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: CAB, body: JSON.stringify(args || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
/* La misma llamada desde otra dirección de 127.0.0.0/8 (otra «red» para la pasarela). */
function rpcDesde(ip, fn, args) {
  const u = new URL(`${URL_BASE}/rest/v1/rpc/${fn}`);
  const datos = JSON.stringify(args || {});
  return new Promise((ok) => {
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', localAddress: ip,
      headers: Object.assign({}, CAB, { 'content-length': Buffer.byteLength(datos),
        'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' }) }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => {
        let dato = null;
        try { dato = JSON.parse(texto); } catch (e) { }
        ok({ ok: res.statusCode < 300, status: res.statusCode, texto, dato });
      });
    });
    r.on('error', (e) => ok({ ok: false, status: 0, texto: e.message, dato: null }));
    r.end(datos);
  });
}
async function sesion(email) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: 'demo1234' });
  if (!r.ok || !r.dato || !r.dato.sesion) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  return r.dato.sesion;
}
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* pg_cron simulado: las tablas y funciones que usa programar_tareas */
const CRON_SIMULADO = `
  create schema cron;
  create table cron.job (jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432,
                         database text default current_database(), username text default current_user, active boolean default true, jobname text unique);
  create table cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid int, database text, username text, command text,
                                     status text, return_message text, start_time timestamptz, end_time timestamptz);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $f$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$;
  create function cron.schedule(schedule text, command text) returns bigint language sql as $f$
    insert into cron.job (schedule, command) values (schedule, command) returning jobid $f$;
  create function cron.unschedule(job_id bigint) returns boolean language sql as $f$ delete from cron.job where jobid = job_id returning true $f$;
  create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null,
                                 username text default null, active boolean default null) returns void language sql as $f$
    update cron.job set schedule = coalesce(alter_job.schedule, cron.job.schedule), command = coalesce(alter_job.command, cron.job.command),
           active = coalesce(alter_job.active, cron.job.active) where jobid = job_id $f$;`;

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 300)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');

  const s = {};
  for (const [rol, email] of Object.entries(DEMO)) s[rol] = await sesion(email);

  /* ================= Salud ================= */
  const salud = await rpc('tm_salud', {});
  ok(salud.ok && salud.dato && salud.dato.ok === true && salud.dato.hora && salud.dato.version &&
     Object.keys(salud.dato).sort().join(',') === 'hora,ok,version',
  'tm_salud es pública y mínima (ok, hora y versión: nada de la actividad)', salud.texto);

  /* ================= Errores del navegador ================= */
  const marca = 'prueba-' + Date.now().toString(36);
  const e1 = await rpc('tm_error_cliente', { p_datos: { tipo: 'error', mensaje: 'TypeError: ' + marca + ' no es una función', fuente: '/assets/js/tm-x.js',
    linea: 10, columna: 4, pagina: '/app/tienda/inicio.html', vista: 'tienda/inicio', rol: 'visitante', modo: 'remoto', version: 'abc123' } });
  ok(e1.ok && e1.dato && e1.dato.ok === true, 'tm_error_cliente guarda un error sin sesión', e1.texto);
  const malos = await Promise.all([
    rpc('tm_error_cliente', { p_datos: { tipo: 'otro', mensaje: 'x' } }),
    rpc('tm_error_cliente', { p_datos: { tipo: 'error', mensaje: '   ' } }),
    rpc('tm_error_cliente', { p_datos: 'texto' }),
    rpc('tm_error_cliente', { p_datos: { tipo: 'error', mensaje: 'x'.repeat(20000) } })]);
  ok(malos.every((r) => r.status === 200 && r.dato && r.dato.ok === false),
    'lo que no es un error se descarta con 200 (un aviso de error nunca produce otro error)', malos.map((r) => r.status + ' ' + r.texto).join(' | '));

  /* ================= Sistema: quién lo ve ================= */
  const sinSesion = await rpc('tm_sistema', { p_sesion: null });
  const comprador = await rpc('tm_sistema', { p_sesion: s.comprador });
  const finanzas = await rpc('tm_sistema', { p_sesion: s.finanzas });
  ok(!sinSesion.ok && !comprador.ok && !finanzas.ok && /expiró|sesión/i.test(sinSesion.texto) && /rol no permite/.test(comprador.texto),
    'tm_sistema no es para visitantes, compradores ni finanzas', [sinSesion.texto, comprador.texto, finanzas.texto].join(' | '));
  const sis = await rpc('tm_sistema', { p_sesion: s.superadmin });
  const d = sis.dato || {};
  const tareas = (d.tareas || []).map((t) => t.tarea);
  ok(sis.ok && ['pagos', 'tasa', 'tasa_respuesta', 'liquidaciones', 'cierre_diario', 'sla', 'almacenamiento', 'mantenimiento', 'archivos']
    .every((t) => tareas.includes(t)) && d.extensiones && 'pg_cron' in d.extensiones && d.bandeja && d.errores && d.almacenamiento && d.tasa,
  'la superadministración (también la cuenta de prueba) lee las tareas de todos los dominios, la tasa, la bandeja, los errores y el almacenamiento',
  sis.texto.slice(0, 300));
  ok(Array.isArray(d.sin_catalogo) && !d.sin_catalogo.some((f) => /invocable/.test(f)),
    'el ayudante del envoltorio no aparece como una tarea sin catálogo', JSON.stringify(d.sin_catalogo));
  const archivos = (d.tareas || []).find((t) => t.tarea === 'archivos') || {};
  const sla = (d.tareas || []).find((t) => t.tarea === 'sla') || {};
  ok(archivos.estado === 'externa' && archivos.manual === false && sla.trabajo === 'tumbo-sla' && sla.horario === '*/15 * * * *' &&
     (LOCAL ? sla.estado === 'sin_pg_cron' || sla.estado === 'error' : true),
  'cada tarea dice su trabajo, su horario y su estado (en local, sin pg_cron)', JSON.stringify([archivos.estado, sla.estado, sla.horario]));
  const errDemo = d.errores || {};
  ok(d.detalle === false && Array.isArray(errDemo.recientes) && errDemo.recientes.length === 0 && Number(errDemo.distintos_24h) >= 1 &&
     errDemo.por_tipo && Number(errDemo.por_tipo.error) >= 1 && (errDemo.tareas || []).every((x) => x.error == null) &&
     (d.tareas || []).every((t) => !t.ultima || (t.ultima.resultado == null && t.ultima.error == null)) &&
     !/correo|TypeError|tm-x\.js/.test(JSON.stringify(d.errores)),
  'una cuenta de prueba ve cuántos errores hubo y el estado de las tareas, sin el mensaje de los navegadores ni el resultado o el error de las corridas',
  JSON.stringify(d.errores).slice(0, 300));

  /* ================= Acciones: solo cuentas reales ================= */
  const correrDemo = await rpc('tm_tarea_correr', { p_sesion: s.superadmin, p_tarea: 'sla' });
  const programarDemo = await rpc('tm_tareas_programar', { p_sesion: s.superadmin });
  const correrComprador = await rpc('tm_tarea_correr', { p_sesion: s.comprador, p_tarea: 'sla' });
  ok(!correrDemo.ok && !programarDemo.ok && /cuentas de prueba/.test(correrDemo.texto) && /cuentas de prueba/.test(programarDemo.texto) &&
     !correrComprador.ok && /rol no permite/.test(correrComprador.texto),
  'correr o programar tareas no lo hace una cuenta de prueba (sesión elevada) ni un comprador', [correrDemo.texto, programarDemo.texto, correrComprador.texto].join(' | '));

  if (!BD) {
    for (const t of ['el texto de los errores llega sin datos personales y los repetidos suman «veces»',
      'tope de errores por red, techo global y máximo de filas', 'el envoltorio registra cada corrida y deshace la tarea que falla',
      'la programación con pg_cron (simulado) envuelve, adopta y no duplica', 'una cuenta real corre una tarea a mano (una vez por minuto)',
      'tareas de mantenimiento y almacenamiento', 'el reinicio, los permisos y retirar-tumbo.sql']) omitida(t);
    console.log('');
    if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
    console.log(verde('✓ Plataforma: lo que se puede comprobar sin TM_PGDATABASE está en verde.'));
    return;
  }

  /* ================= Limpieza del texto y repetidos ================= */
  const sucio = 'Error de ana.perez@correo.com al pagar con 0414-555.12.34 ficha ' + 'a1b2'.repeat(16) +
    ' en https://tumbo.example/app/tienda/pago.html?pago=PAG-123&ref=99887766 ' + marca;
  const ip = '127.0.0.' + (20 + Math.floor(Math.random() * 200));
  const datosSucios = { tipo: 'promesa', mensaje: sucio, pila: 'at pagar (' + 'https://x.ve/assets/js/a.js?v=1:3:9)',
    pagina: 'https://tumbo.example/app/tienda/pago.html?pago=PAG-123', fuente: 'https://tumbo.example/assets/js/a.js?v=1', rol: 'comprador' };
  const r1 = await rpcDesde(ip, 'tm_error_cliente', { p_datos: datosSucios });
  await rpcDesde(ip, 'tm_error_cliente', { p_datos: datosSucios });
  const fila = psql(`select json_build_object('mensaje', mensaje, 'pila', pila, 'pagina', pagina, 'fuente', fuente, 'veces', veces, 'navegador', navegador)
                     from tumbo.errores_cliente where tipo = 'promesa' and mensaje like ${lit('%' + marca)}`);
  let f = {};
  try { f = JSON.parse(fila || '{}'); } catch (e) { }
  ok(r1.ok && f.mensaje && !/@|0414|555|a1b2a1b2|PAG-123|99887766/.test(f.mensaje + f.pila + f.pagina + f.fuente) &&
     /\[correo\]/.test(f.mensaje) && /\[número\]/.test(f.mensaje) && /\[ficha\]/.test(f.mensaje) &&
     f.pagina === '/app/tienda/pago.html' && f.fuente === '/assets/js/a.js',
  'el servidor quita correos, números largos, fichas y la consulta de las URL (aunque el navegador no lo haga)', fila);
  ok(f.veces === 2 && f.navegador === 'Chrome en Android', 'un error repetido suma «veces» en la misma fila y guarda el navegador, no la red', fila);
  ok(psql(`select count(*) from information_schema.columns where table_schema = 'tumbo' and table_name = 'errores_cliente'
           and column_name in ('red', 'ip', 'usuario_id', 'sesion', 'email')`) === '0',
  'la tabla de errores no tiene columnas de la red ni de la cuenta');

  /* ================= Topes ================= */
  /* (el lote no debe cruzar el cambio de ventana de 10 minutos) */
  const enVentana = (Date.now() / 1000) % 600;
  if (enVentana > 585) await esperar((601 - enVentana) * 1000);
  const ipT = '127.0.0.' + (20 + Math.floor(Math.random() * 200));
  psql(`delete from tumbo.topes_plataforma where red in (${lit(ipT)}, '*')`);
  const lote = [];
  for (let i = 0; i < 21; i++) {
    lote.push(await rpcDesde(ipT, 'tm_error_cliente', { p_datos: { tipo: 'error', mensaje: 'tope ' + i + ' ' + marca } }));
  }
  const otraRed = await rpcDesde(ipT.replace(/\.\d+$/, '.' + (ipT.endsWith('.250') ? 251 : 250)), 'tm_error_cliente',
    { p_datos: { tipo: 'error', mensaje: 'otra red ' + marca } });
  ok(lote.slice(0, 20).every((r) => r.dato && r.dato.ok) && lote[20].status === 200 && lote[20].dato && lote[20].dato.motivo === 'tope' &&
     otraRed.dato && otraRed.dato.ok,
  'una red registra 20 errores cada 10 minutos (el siguiente se descarta con 200) y no frena a otra red', lote[20].texto + ' | ' + otraRed.texto);
  psql(`insert into tumbo.topes_plataforma (red, tipo, ventana, n) values ('*', 'errores', date_bin('10 minutes', now(), timestamptz '2000-01-01'), 600)
        on conflict (red, tipo, ventana) do update set n = 600`);
  const techo = await rpcDesde('127.0.0.249', 'tm_error_cliente', { p_datos: { tipo: 'error', mensaje: 'techo ' + marca } });
  psql(`delete from tumbo.topes_plataforma where red in (${lit(ipT)}, '*', '127.0.0.249', '127.0.0.250', '127.0.0.251')`);
  ok(techo.dato && techo.dato.motivo === 'tope', 'con 600 errores en 10 minutos (todas las redes) se dejan de guardar', techo.texto);
  /* máximo de filas: con 5.000, entra la nueva y salen las vistas hace más tiempo */
  const cap = psql(`begin;
    insert into tumbo.errores_cliente (huella, tipo, mensaje, ultimo)
      select md5('relleno' || g), 'error', 'relleno ' || g, now() - interval '20 days' from generate_series(1, 5000 - (select count(*) from tumbo.errores_cliente)) g;
    set local request.headers = '{"cf-connecting-ip": "127.0.0.248"}';
    select public.tm_error_cliente('{"tipo": "error", "mensaje": "nuevo con la tabla llena ${marca}"}'::jsonb) ->> 'ok';
    select count(*) || ' ' || count(*) filter (where mensaje like 'nuevo con la tabla llena%') from tumbo.errores_cliente;
    rollback;`).split('\n').pop();
  ok(/^\d+ 1$/.test(cap) && Number(cap.split(' ')[0]) <= 5000, 'la tabla de errores no pasa de 5.000 filas (entra la nueva, sale la más vieja)', cap);

  /* ================= Envoltorio de las tareas ================= */
  const env = psql(`begin;
    create table tumbo.prueba_plataforma (n int);
    create function tumbo_privado.tarea_prueba_falla() returns jsonb language plpgsql as $f$
    begin insert into tumbo.prueba_plataforma values (1); raise exception 'Falló para ana@correo.com con la cuenta 01020304050607'; end $f$;
    create function tumbo_privado.tarea_prueba_bien() returns integer language sql as $f$ select 7 $f$;
    insert into tumbo.tareas_programadas (tarea, funcion, dominio, descripcion) values
      ('prueba_falla', 'tarea_prueba_falla', 'Pruebas', 'falla'), ('prueba_bien', 'tarea_prueba_bien', 'Pruebas', 'bien'),
      ('prueba_falta', 'tarea_prueba_falta', 'Pruebas', 'sin función');
    select tumbo_privado.correr_tarea('prueba_falla', 'programada') ->> 'ok';
    select tumbo_privado.correr_tarea('prueba_falla', 'programada') ->> 'ok';
    select (select count(*) from tumbo.prueba_plataforma) || '|' ||
           (select count(*) from tumbo.tareas_ejecuciones where tarea = 'prueba_falla' and not ok) || '|' ||
           (select error from tumbo.tareas_ejecuciones where tarea = 'prueba_falla' order by id desc limit 1) || '|' ||
           (select count(*) from tumbo.notificaciones where para = 'rol:superadmin' and texto like '%prueba_falla%');
    select (tumbo_privado.correr_tarea('prueba_bien', 'prueba') -> 'resultado')::text || '|' ||
           (tumbo_privado.correr_tarea('prueba_falta', 'prueba') ->> 'error');
    rollback;`).split('\n');
  const [hechas, fallidas, error, avisos] = (env[2] || '').split('|');
  ok(hechas === '0' && fallidas === '2' && /Falló para \[correo\] con la cuenta \[número\]/.test(error) && !/ana@|0102/.test(error) && avisos === '1',
    'una tarea que falla: se deshace su trabajo, queda el error (sin datos personales) y la superadministración recibe un solo aviso', env.join(' / '));
  ok(/^7\|La función tumbo_privado\.tarea_prueba_falta\(\) no existe/.test(env[3] || ''),
    'el envoltorio guarda el resultado de cualquier tipo y dice cuándo falta la función', env[3]);
  /* dos corridas a la vez: la segunda se registra como omitida */
  const bloqueo = spawn('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres', '-d', BD, '-X', '-q',
    '-c', "select pg_advisory_lock(hashtextextended('tumbo:correr_tarea:mantenimiento', 0)); select pg_sleep(4);"]);
  await esperar(1200);
  const doble = psql(`select tumbo_privado.correr_tarea('mantenimiento', 'prueba') -> 'resultado' ->> 'omitida'`);
  await new Promise((fin) => bloqueo.on('exit', fin));
  ok(/en curso/.test(doble), 'si la corrida anterior de una tarea sigue en curso, la nueva se registra como omitida', doble);

  /* ================= pg_cron (simulado) ================= */
  const cron = psql(`begin;
    ${CRON_SIMULADO}
    select cron.schedule('tumbo-pagos-vencimientos', '*/10 * * * *', 'select tumbo_privado.tarea_pagos()');
    select cron.schedule('tumbo-pagos-tasa', '5 */2 * * *', 'select tumbo_privado.tarea_tasa()');
    select cron.schedule('tumbo-sla', '*/15 * * * *', 'select tumbo_privado.tarea_sla()');
    select cron.schedule('tumbo-sla-copia', '*/5 * * * *', 'select tumbo_privado.tarea_sla()');
    create function tumbo_privado.tarea_prueba_dominio() returns jsonb language sql as $f$ select '{"listo": true}'::jsonb $f$;
    select cron.schedule('tumbo-comunicacion-envios', '*/2 * * * *', 'SELECT tumbo_privado.tarea_prueba_dominio();');
    select cron.schedule('otra-app', '* * * * *', 'select tumbo_privado.tarea_sla()');
    -- programados a mano y sin nombre (cron.schedule de dos argumentos): uno junto al del dominio, otro solo
    select cron.schedule('*/30 * * * *', 'select tumbo_privado.tarea_pagos()');
    select cron.schedule('*/20 * * * *', 'select tumbo_privado.tarea_mantenimiento()');
    select '#sinnombre=' || (select string_agg(x ->> 'tarea' || ':' || (x ->> 'horario'), ',' order by x ->> 'tarea')
                             from jsonb_array_elements(tumbo_privado.programar_tareas() -> 'tareas') x where x ->> 'accion' = 'sin nombre quitada');
    select string_agg(jobname || '=' || schedule || '=' || command, E'\\n' order by jobname) from cron.job;
    select '#adoptada=' || (select count(*) from tumbo.tareas_programadas where funcion = 'tarea_prueba_dominio' and trabajo = 'tumbo-comunicacion-envios');
    select '#otra=' || coalesce((select string_agg(x ->> 'accion', ',') from jsonb_array_elements(tumbo_privado.programar_tareas() -> 'tareas') x
                                 where x ->> 'accion' <> 'al día'), '');
    select '#total=' || (select count(*) from cron.job) || ' sin nombre ' || (select count(*) from cron.job where jobname is null);
    select '#sistema=' || (select string_agg((t ->> 'tarea') || ':' || (t ->> 'estado') || ':' || (t ->> 'programada'), ',' order by t ->> 'tarea')
                           from jsonb_array_elements(public.tm_sistema(${lit(s.superadmin)}) -> 'tareas') t
                           where t ->> 'tarea' in ('pagos', 'mantenimiento'));
    rollback;`);
  const trabajos = {};
  cron.split('\n').filter((l) => /^[a-z-]+=/.test(l)).forEach((l) => { const [n, h, c] = l.split('='); trabajos[n] = { h, c }; });
  const extras = {};
  cron.split('\n').filter((l) => l.startsWith('#')).forEach((l) => { const i = l.indexOf('='); extras[l.slice(1, i)] = l.slice(i + 1); });
  ok(trabajos['tumbo-pagos-vencimientos'] && trabajos['tumbo-pagos-vencimientos'].c === "select tumbo_privado.correr_tarea('pagos')" &&
     trabajos['tumbo-pagos-tasa'] && trabajos['tumbo-pagos-tasa'].h === '5 */2 * * *' && trabajos['tumbo-pagos-tasa'].c === "select tumbo_privado.correr_tarea('tasa')" &&
     trabajos['tumbo-sla'] && trabajos['tumbo-sla'].c === "select tumbo_privado.correr_tarea('sla')",
  'pg_cron: los trabajos que ya programó cada dominio pasan por el envoltorio con su mismo nombre y su horario', cron.slice(0, 400));
  ok(trabajos['tumbo-almacenamiento'] && trabajos['tumbo-mantenimiento'] && trabajos['tumbo-pagos-liquidaciones'] &&
     trabajos['tumbo-pagos-cierre'] && trabajos['tumbo-pagos-tasa-respuesta'] && !trabajos['tumbo-sla-copia'] &&
     !Object.keys(trabajos).some((k) => /archivos/.test(k)),
  'pg_cron: programa las que faltan, quita el duplicado de Tumbo y no programa la que corre su función (archivos)', Object.keys(trabajos).join(', '));
  ok(trabajos['otra-app'] && trabajos['otra-app'].c === 'select tumbo_privado.tarea_sla()',
    'pg_cron: el trabajo de otra aplicación (sin «tumbo-») no se toca', JSON.stringify(trabajos['otra-app']));
  ok(trabajos['tumbo-comunicacion-envios'] && trabajos['tumbo-comunicacion-envios'].c === "select tumbo_privado.correr_tarea('prueba_dominio')" &&
     extras.adoptada === '1', 'pg_cron: el trabajo «tumbo-…» de un dominio nuevo se adopta en el catálogo y pasa por el envoltorio', JSON.stringify(extras) + ' ' + JSON.stringify(trabajos['tumbo-comunicacion-envios']));
  ok(extras.sinnombre === 'mantenimiento:*/20 * * * *,pagos:*/30 * * * *' &&
     trabajos['tumbo-pagos-vencimientos'] && trabajos['tumbo-pagos-vencimientos'].h === '*/10 * * * *' &&
     trabajos['tumbo-mantenimiento'] && trabajos['tumbo-mantenimiento'].h === '41 7 * * *' &&
     trabajos['tumbo-mantenimiento'].c === "select tumbo_privado.correr_tarea('mantenimiento')" &&
     /^mantenimiento:(al_dia|atrasada):true,pagos:(al_dia|atrasada):true$/.test(extras.sistema),
  'pg_cron: un trabajo sin nombre que corre lo mismo se quita (nunca reemplaza al del dominio): queda el «tumbo-…» con su horario y admin/sistema lo ve programado',
  JSON.stringify(extras) + ' ' + JSON.stringify([trabajos['tumbo-pagos-vencimientos'], trabajos['tumbo-mantenimiento']]));
  ok(extras.otra === '' && extras.total === Object.keys(trabajos).length + ' sin nombre 0',
    'pg_cron: programar otra vez no cambia nada (ni duplica)', JSON.stringify(extras));
  const sinCron = psql(`select tumbo_privado.programar_tareas() ->> 'pg_cron'`);
  ok(sinCron === 'false', 'sin pg_cron, programar lo dice y no falla', sinCron);

  /* ================= Una cuenta real corre una tarea ================= */
  const real = psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
      values (${lit(REAL)}, extensions.crypt(encode(extensions.gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 4)), 'Dueña Plataforma', 'superadmin')
      on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, bloqueado = false;
    insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
      select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REAL)}
      on conflict (usuario_id) do update set activo = true;
    delete from tumbo.tareas_ejecuciones where origen = 'manual' and tarea in ('sla', 'archivos');
    select tumbo_privado.abrir_sesion(id) from tumbo.usuarios where email = ${lit(REAL)};
    update tumbo.sesiones set elevada_hasta = now() + interval '10 minutes' where usuario_id = (select id from tumbo.usuarios where email = ${lit(REAL)});`)
    .split('\n').map((l) => l.trim()).find((l) => /^[0-9a-f]{64}$/.test(l));
  try {
    const c1 = await rpc('tm_tarea_correr', { p_sesion: real, p_tarea: 'sla' });
    const c2 = await rpc('tm_tarea_correr', { p_sesion: real, p_tarea: 'sla' });
    const c3 = await rpc('tm_tarea_correr', { p_sesion: real, p_tarea: 'archivos' });
    const c4 = await rpc('tm_tarea_correr', { p_sesion: real, p_tarea: 'no_existe' });
    const reg = psql(`select origen || '|' || por || '|' || ok from tumbo.tareas_ejecuciones where tarea = 'sla' and origen = 'manual' order by id desc limit 1`);
    const aud = psql(`select count(*) from tumbo.auditoria where accion = 'Tarea ejecutada a mano' and detalle like 'sla%' and fecha > now() - interval '1 minute'`);
    ok(c1.ok && c1.dato && c1.dato.ok === true && c1.dato.resultado && reg === 'manual|Dueña Plataforma|true' && Number(aud) >= 1,
      'una cuenta real con sesión elevada corre una tarea: queda la corrida (a mano, con su nombre) y la auditoría', c1.texto + ' / ' + reg + ' / ' + aud);
    ok(!c2.ok && /menos de un minuto/.test(c2.texto) && !c3.ok && /no se puede correr/.test(c3.texto) && !c4.ok,
      'la misma tarea a mano una vez por minuto; las que no son manuales (archivos) o no existen, no', [c2.texto, c3.texto, c4.texto].join(' | '));
    const prog = await rpc('tm_tareas_programar', { p_sesion: real });
    ok(prog.ok && prog.dato && prog.dato.pg_cron === false && /pg_cron/.test(prog.dato.mensaje),
      'programar las tareas sin pg_cron lo dice (y queda en la auditoría)', prog.texto);

    /* lo que ve cada una en admin/sistema (la cuenta de prueba tiene la contraseña pública) */
    psql(`update tumbo.errores_cliente set ultimo = now() where mensaje like ${lit('TypeError: ' + marca + '%')}`);
    const sisDemo = await rpc('tm_sistema', { p_sesion: s.superadmin });
    const sisReal = await rpc('tm_sistema', { p_sesion: real });
    const slaDemo = ((sisDemo.dato || {}).tareas || []).find((t) => t.tarea === 'sla') || {};
    const slaReal = ((sisReal.dato || {}).tareas || []).find((t) => t.tarea === 'sla') || {};
    ok(sisDemo.ok && slaDemo.ultima && slaDemo.ultima.origen === 'manual' && slaDemo.ultima.por === 'Equipo de Tumbo' &&
       slaDemo.ultima.resultado == null && !sisDemo.texto.includes('Dueña Plataforma'),
    'la cuenta de prueba no recibe el nombre de la cuenta real que corrió la tarea («Equipo de Tumbo») ni su resultado', JSON.stringify(slaDemo.ultima));
    const mio = (((sisReal.dato || {}).errores || {}).recientes || []).find((x) => x.mensaje && x.mensaje.startsWith('TypeError: ' + marca));
    ok(sisReal.ok && sisReal.dato.detalle === true && slaReal.ultima && slaReal.ultima.por === 'Dueña Plataforma' && slaReal.ultima.resultado != null &&
       mio && !('huella' in mio) && mio.vista === 'tienda/inicio' && mio.version === 'abc123' && mio.rol === 'visitante',
    'la cuenta real ve quién corrió la tarea, su resultado y los errores del navegador con su vista, su rol y su versión',
    JSON.stringify([slaReal.ultima, mio]).slice(0, 300));
    const cronMsg = psql(`begin;
      ${CRON_SIMULADO}
      select cron.schedule('tumbo-sla', '*/15 * * * *', 'select tumbo_privado.correr_tarea(''sla'')');
      insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
        select jobid, 'failed', 'ERROR: falló para ana@correo.com con la cuenta 01020304050607', now(), now() from cron.job where jobname = 'tumbo-sla';
      select coalesce(t -> 'cron' -> 'ultima' ->> 'estado', '') || '|' || coalesce(t -> 'cron' -> 'ultima' ->> 'mensaje', '<nulo>')
      from jsonb_array_elements(public.tm_sistema(${lit(s.superadmin)}) -> 'tareas') t where t ->> 'tarea' = 'sla';
      select coalesce(t -> 'cron' -> 'ultima' ->> 'estado', '') || '|' || coalesce(t -> 'cron' -> 'ultima' ->> 'mensaje', '<nulo>')
      from jsonb_array_elements(public.tm_sistema(${lit(real)}) -> 'tareas') t where t ->> 'tarea' = 'sla';
      rollback;`).split('\n').slice(-2);
    ok(cronMsg[0] === 'failed|<nulo>' && /^failed\|ERROR: falló para \[correo\] con la cuenta \[número\]$/.test(cronMsg[1]),
      'el mensaje de pg_cron: la cuenta de prueba ve solo el estado; la real, el mensaje sin datos personales', cronMsg.join(' / '));

    /* la demo apagada en el servidor: el reinicio se rechaza para todos */
    const pedidosAntes = psql(`select count(*) from tumbo.pedidos`);
    const apagar = await rpc('tm_ajuste_guardar', { p_sesion: real, p_clave: 'demo_activa', p_valor: false });
    const reinReal = await rpc('tm_reiniciar_demo', { p_sesion: real });
    const reinDemo = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
    const pedidosDespues = psql(`select count(*) from tumbo.pedidos`);
    ok(apagar.ok && !reinReal.ok && /demo está apagada/.test(reinReal.texto) && !reinDemo.ok && Number(pedidosAntes) > 0 && pedidosAntes === pedidosDespues,
      'con la demo apagada (demo_activa = false) nadie reinicia la demo, ni una cuenta real con sesión elevada, y no se borra nada',
      [apagar.texto, reinReal.texto, reinDemo.texto, pedidosAntes + '→' + pedidosDespues].join(' | ').slice(0, 400));
  } finally {
    psql(`update tumbo.ajustes set valor = 'true' where clave = 'demo_activa';
          delete from tumbo.sesiones where usuario_id = (select id from tumbo.usuarios where email = ${lit(REAL)});
          update tumbo.usuarios set activo = false where email = ${lit(REAL)};`);
  }

  /* ================= Tareas propias ================= */
  const mant = psql(`begin;
    insert into tumbo.errores_cliente (huella, tipo, mensaje, ultimo) values (md5('viejo-${marca}'), 'error', 'viejo', now() - interval '31 days'),
                                                                             (md5('nuevo-${marca}'), 'error', 'nuevo', now());
    insert into tumbo.tareas_ejecuciones (tarea, inicio, fin, ok, origen) values ('sla', now() - interval '61 days', now() - interval '61 days', true, 'prueba');
    select (tumbo_privado.tarea_mantenimiento() ->> 'errores')::int >= 1;
    select (select count(*) from tumbo.errores_cliente where huella = md5('viejo-${marca}')) || '|' ||
           (select count(*) from tumbo.errores_cliente where huella = md5('nuevo-${marca}')) || '|' ||
           (select count(*) from tumbo.tareas_ejecuciones where inicio < now() - interval '60 days');
    rollback;`).split('\n');
  ok(mant[0] === 't' && mant[1] === '0|1|0', 'tumbo-mantenimiento purga los errores de más de 30 días y las corridas de más de 60 (y deja lo reciente)', mant.join(' / '));
  const alm = psql(`begin;
    select tumbo_privado.tarea_almacenamiento() ->> 'pendiente';
    update tumbo.ajustes set valor = '"https://proyecto.supabase.co/functions/v1"' where clave = 'funciones_url';
    select tumbo_privado.tarea_almacenamiento() ->> 'pendiente';
    rollback;`).split('\n');
  ok(/falta el ajuste funciones_url/.test(alm[0]) && /sin pg_net/.test(alm[1]),
    'tumbo-almacenamiento dice qué le falta para borrar en Storage (la URL de las funciones o pg_net) y hace lo que puede por SQL', alm.join(' / '));

  /* ================= Funciones sin catálogo ================= */
  psql(`create or replace function tumbo_privado.tarea_prueba_huerfana() returns integer language sql as $f$ select 1 $f$;
        create or replace function tumbo_privado.tarea_prueba_ayudante(p_n integer) returns integer language sql as $f$ select p_n $f$;`);
  const huerfana = await rpc('tm_sistema', { p_sesion: s.superadmin });
  const esperadas = psql(`select coalesce(string_agg(distinct p.proname, ',' order by p.proname), '') from pg_proc p
                          where p.pronamespace = 'tumbo_privado'::regnamespace and p.proname like 'tarea\\_%' and p.pronargs = p.pronargdefaults
                            and p.proname not in (select funcion from tumbo.tareas_programadas)`);
  psql(`drop function tumbo_privado.tarea_prueba_huerfana(); drop function tumbo_privado.tarea_prueba_ayudante(integer);`);
  const sinCat = (huerfana.dato && huerfana.dato.sin_catalogo) || [];
  ok(huerfana.ok && sinCat.includes('tarea_prueba_huerfana') && !sinCat.includes('tarea_prueba_ayudante') && sinCat.join(',') === esperadas,
    'admin/sistema muestra las funciones tarea_* que nadie catalogó (de un dominio nuevo), no los ayudantes con argumentos', JSON.stringify(sinCat) + ' / ' + esperadas);
  ok(psql(`select count(*) from pg_proc where pronamespace = 'tumbo_privado'::regnamespace and proname like 'tarea\\_%' and pronargs > pronargdefaults`) === '0',
    'ninguna función tarea_* de la base pide argumentos (todas las corre el envoltorio)');

  /* ================= Reinicio, permisos y retiro ================= */
  psql(`insert into tumbo.tareas_ejecuciones (tarea, inicio, fin, ok, origen) values ('sla', now(), now(), true, 'prueba');
        delete from tumbo.tareas_programadas where tarea = 'mantenimiento';`);
  const rr = await R.reiniciar(rpc, s.superadmin);
  const tras = psql(`select (select count(*) from tumbo.tareas_programadas where tarea = 'mantenimiento') || '|' ||
                            (select count(*) from tumbo.tareas_ejecuciones where origen = 'prueba') || '|' ||
                            (select count(*) from tumbo.tareas_ejecuciones where origen = 'manual') || '|' ||
                            (select count(*) from tumbo.topes_plataforma)`);
  const [catalogo, pruebas, manuales] = tras.split('|');
  ok(rr.ok && catalogo === '1' && pruebas === '0' && Number(manuales) >= 1,
    'el reinicio de la demo repone el catálogo de tareas y borra las corridas de prueba, no el historial', rr.texto + ' / ' + tras);
  const permisos = psql(`select string_agg(f || '=' || has_function_privilege('anon', f, 'execute'), ',' order by f) from unnest(array[
      'public.tm_salud()', 'public.tm_error_cliente(jsonb)', 'public.tm_sistema(text)', 'public.tm_tarea_correr(text,text)',
      'public.tm_tareas_programar(text)']) f;
    select count(*) from pg_proc p where p.pronamespace = 'tumbo_privado'::regnamespace and has_function_privilege('anon', p.oid, 'execute');`).split('\n');
  ok(!/=false/.test(permisos[0]) && permisos[1] === '0',
    'la API expone las cinco tm_* nuevas y nada de tumbo_privado', permisos.join(' / '));
  /* las firmas de retirar-tumbo.sql, resueltas por la base: ninguna tm_* queda fuera */
  const firmas = (fs.readFileSync(path.join(RAIZ, 'tools', 'retirar-tumbo.sql'), 'utf8').match(/'public\.tm_[a-z0-9_]+\([^)]*\)'/g) || []);
  const faltan = psql(`select coalesce(string_agg(p.oid::regprocedure::text, ', '), '') from pg_proc p
                       where p.pronamespace = 'public'::regnamespace and p.proname like 'tm\\_%'
                         and p.oid not in (select to_regprocedure(f) from unnest(array[${firmas.join(', ')}]::text[]) f where to_regprocedure(f) is not null)`)
    .split(', ').filter(Boolean);
  ok(!faltan.length, 'retirar-tumbo.sql conoce todas las funciones tm_* de la base (no quedaría ninguna huérfana)', faltan.join(', '));

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Plataforma: tareas, errores, sistema y permisos en verde.'));
})().catch((e) => { console.error(rojo('La prueba se cortó: ' + (e && e.stack || e))); process.exit(1); });
