#!/usr/bin/env node
/**
 * Pruebas por la API de la integración de la ola 2 (migración
 * 20261024190000_tumbo_integracion_ola2.sql): lo que Comunicación,
 * Crecimiento y Plataforma le pidieron a los demás dominios.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… TM_PGDATABASE=… node tools/api-integracion2.js
 *
 * Sin base comprueba que cada cuenta del libro mayor que asientan las
 * migraciones tiene su nombre en el panel financiero (CUENTAS de
 * tm-mod-pagos-admin.js). Con TM_PGDATABASE (solo en local) crea personas
 * reales de pruebas por SQL y comprueba además:
 *   · Pagos: completar_reembolso_total (de un parcial al total, con el
 *     asiento de un reembolso completo) y crear_reembolso_extra (a cargo
 *     del comercio, con su descuento en la liquidación, o de Tumbo), y que
 *     Comunicación los usa en vez de escribir en tumbo.reembolsos;
 *   · el panel financiero separa lo congelado por el plazo de apelación;
 *   · Logística: devolucion_pagador cambia quién paga el envío de vuelta y
 *     su frase en las instrucciones (también la de antes y un texto
 *     reescrito por Operaciones);
 *   · archivos: el propósito «marketing» (solo el equipo de marketing con
 *     una cuenta real) y la limpieza de los huérfanos de todos los
 *     propósitos;
 *   · la baja borra el consentimiento de WhatsApp, las lecturas del chat y
 *     el texto de sus casos de soporte, y conserva las aceptaciones legales;
 *   · el catálogo de tareas tiene las de Comunicación y Crecimiento (también
 *     si pg_cron las había adoptado) y ninguna tarea_* queda sin catálogo;
 *   · con la demo apagada el reinicio se rechaza antes que nada, también
 *     sin sesión.
 * Reinicia la demo al empezar y al terminar (con datos reales, con la
 * cuenta real de las pruebas: tools/reinicio-comun.js).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./reinicio-comun');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE);
if (!LOCAL && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}
const BD = process.env.TM_PGDATABASE || '';
const RAIZ = path.join(__dirname, '..');

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const DEMO = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', superadmin: 'superadmin@tumbomarket.demo',
  ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
/* Personas reales de pruebas (con TM_PGDATABASE): nunca son cuentas demo. */
const REALES = {
  compra: { email: 'integ2-compradora@tumbo-local.ve', nombre: 'Compradora Integración Dos', rol: 'comprador' },
  fin: { email: 'integ2-finanzas@tumbo-local.ve', nombre: 'Finanzas Integración Dos', rol: 'finanzas' },
  admin: { email: 'integ2-superadmin@tumbo-local.ve', nombre: 'Dueña Integración Dos', rol: 'superadmin' },
  ops: { email: 'integ2-ops@tumbo-local.ve', nombre: 'Operaciones Integración Dos', rol: 'ops' },
  baja: { email: 'integ2-baja@tumbo-local.ve', nombre: 'Persona que se va', rol: 'comprador' }
};
const CLAVE_REAL = 'clave-integracion-dos-1';
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: CAB, body: JSON.stringify(args || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
async function sesion(email) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: 'demo1234' });
  if (!r.ok || !r.dato || !r.dato.sesion) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  return r.dato.sesion;
}
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
/* La última línea de una consulta que devuelve un jsonb (las anteriores son los «BEGIN»…). */
function json(consulta) {
  const lineas = psql(consulta).split('\n').filter((l) => /^[[{]/.test(l.trim()));
  return JSON.parse(lineas[lineas.length - 1]);
}
/* Junta los objetos jsonb que devuelven las consultas de un bloque (una línea cada uno). */
function jsonTodo(consulta) {
  return psql(consulta).split('\n').filter((l) => /^\{/.test(l.trim())).map((l) => JSON.parse(l)).reduce((a, b) => Object.assign(a, b), {});
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const hoy = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 300)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');

  /* ================= Las cuentas del libro mayor tienen nombre en el panel ================= */
  {
    const cuentas = new Set();
    for (const f of fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations'))) {
      if (!/\.sql$/.test(f)) continue;
      const sql = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', f), 'utf8');
      /* (las líneas de un asiento: 'cuenta' con su 'debe' o su 'haber') */
      for (const m of sql.matchAll(/'cuenta',\s*'([a-z_]+(?::[A-Z]+)?)'[^()]*?'(?:debe|haber)'/g)) cuentas.add(m[1]);
    }
    const js = fs.readFileSync(path.join(RAIZ, 'assets', 'js', 'tm-mod-pagos-admin.js'), 'utf8');
    const bloque = (js.match(/var CUENTAS = \{([\s\S]*?)\};/) || [])[1] || '';
    const nombradas = new Set([...bloque.matchAll(/'?([a-z_]+(?::[A-Z]+)?)'?\s*:/g)].map((m) => m[1]));
    const faltan = [...cuentas].filter((c) => !nombradas.has(c));
    ok(cuentas.has('devoluciones_envio') && faltan.length === 0,
      'cada cuenta que asientan las migraciones (también devoluciones_envio, de Comunicación) tiene su nombre en el panel financiero',
      'sin nombre: ' + faltan.join(', '));
  }

  const s = {};
  for (const [rol, email] of Object.entries(DEMO)) s[rol] = await sesion(email);
  const r0 = await R.reiniciar(rpc, s.superadmin);
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

  if (!BD) {
    for (const t of ['completar_reembolso_total y crear_reembolso_extra (Pagos) y su uso en Comunicación',
      'congelado por el plazo de apelación en el panel financiero', 'devolucion_pagador (Logística)',
      'el propósito marketing y la limpieza de huérfanos', 'la baja borra lo de Comunicación',
      'el catálogo de tareas de Comunicación y Crecimiento', 'el reinicio con la demo apagada']) omitida(t);
    console.log('');
    if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
    console.log(verde('✓ Integración de la ola 2: nada más que comprobar sin TM_PGDATABASE.'));
    return;
  }

  /* ================= Personas reales ================= */
  for (const u of Object.values(REALES)) {
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
          values (${lit(u.email)}, extensions.crypt(${lit(CLAVE_REAL)}, extensions.gen_salt('bf', 4)), ${lit(u.nombre)}, ${lit(u.rol)})
          on conflict (email) do update set rol = excluded.rol, seller_id = null, nombre = excluded.nombre, activo = true,
            bloqueado = false, clave_hash = excluded.clave_hash`);
  }
  const lista = Object.values(REALES).map((u) => lit(u.email)).join(', ');
  psql(`delete from tumbo.usuarios_2fa where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
        delete from tumbo.permisos_usuario where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
        delete from tumbo.direcciones where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
        delete from tumbo.carrito_items where usuario_id in (select id from tumbo.usuarios where email in (${lista}))`);
  /* (las sesiones se abren por SQL: el acceso web tiene topes por red que las suites comparten) */
  for (const [k, u] of Object.entries(REALES)) s['r_' + k] = psql(`select tumbo_privado.abrir_sesion(id) from tumbo.usuarios where email = ${lit(u.email)}`);
  /* finanzas real con la 2FA activa y la sesión elevada (exigir_elevada de Cuentas) */
  psql(`insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
        select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REALES.fin.email)};
        update tumbo.sesiones set elevada_hasta = now() + interval '1 hour' where usuario_id = (select id from tumbo.usuarios where email = ${lit(REALES.fin.email)})`);
  const idDe = (k) => psql(`select id from tumbo.usuarios where email = ${lit(REALES[k].email)}`);

  try {
    /* ================= Pagos: completar a total y reembolso extra ================= */
    await rpc('tm_carrito_poner', { p_sesion: s.r_compra, p_sku: 'SKU-TEC-0450', p_cant: 1 });
    const dir = await rpc('tm_direccion_agregar', { p_sesion: s.r_compra, p_datos: { nombre: 'Casa', destinatario: 'Compradora Integración Dos',
      cedula_destinatario: 'V-20333444', telefono_destinatario: '0412-555-6677', estado: 'Carabobo', ciudad: 'Valencia', municipio: 'Naguanagua',
      parroquia: 'Naguanagua', linea: 'Av. Universidad, Res. Ola Dos, Torre 2, Apto 5-B', referencia: 'Frente a la plaza', codigo: '2005', predeterminada: true } });
    const datos = { entrega: 'domicilio', direccion_id: dir.dato, metodo: 'pago_movil' };
    const cot = await rpc('tm_checkout_cotizar', { p_sesion: s.r_compra, p_datos: datos });
    const ch = await rpc('tm_checkout_crear', { p_sesion: s.r_compra, p_datos: Object.assign({}, datos,
      { esperado: { total_usd: cot.dato && cot.dato.total_usd, total_bs: cot.dato && cot.dato.total_bs } }) });
    const ped = ch.dato && ch.dato.pedidos && ch.dato.pedidos[0];
    const rep = await rpc('tm_pago_reportar', { p_sesion: s.r_compra, p_id: ch.dato && ch.dato.pago, p_datos: { banco: '0134', telefono: '0414-1234567',
      cedula: 'V-20333444', referencia: 'PM-' + (70000000 + (Date.now() % 9000000)), fecha: hoy() } });
    const con = await rpc('tm_conciliar_pago', { p_sesion: s.r_fin, p_id: ch.dato && ch.dato.pago });
    ok(dir.ok && ch.ok && rep.ok && con.ok && ped, 'una persona real compra y una cuenta real de finanzas concilia su pago',
      [dir.texto, ch.texto, rep.texto, con.texto].join(' | ').slice(0, 240));

    if (ped) {
      /* (todo en una transacción que se deshace: el pedido queda como estaba) */
      const r = json(`begin;
        update tumbo.pedidos set igtf_usd = 0.90, descuento_tumbo_usd = 2 where id = ${lit(ped)};
        create function pg_temp.probar() returns jsonb language plpgsql as $f$
        declare
          v_pagado numeric := (select (tumbo_privado.montos_pedido(p) ->> 'pagado')::numeric from tumbo.pedidos p where id = ${lit(ped)});
          r1 bigint; r2 bigint; r3 bigint; r4 bigint; r5 bigint;
          e1 text; e2 text;
          neto jsonb;
        begin
          r1 := tumbo_privado.crear_reembolso(${lit(ped)}, 3, 'Parcial de prueba');
          r2 := tumbo_privado.completar_reembolso_total(${lit(ped)}, 'Total de prueba', 'Prueba');
          r5 := tumbo_privado.completar_reembolso_total(${lit(ped)}, 'Nada que completar', 'Prueba');
          select jsonb_object_agg(cuenta, n) into neto from (
            select l.cuenta, sum(l.debe - l.haber) as n from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
            where a.referencia in ('R-' || r1, 'R-' || r2) group by l.cuenta) x;
          r3 := tumbo_privado.crear_reembolso_extra(${lit(ped)}, 5, 'Reintegro de prueba (comercio)', 'seller', 'Prueba');
          r4 := tumbo_privado.crear_reembolso_extra(${lit(ped)}, 4, 'Reintegro de prueba (Tumbo)', 'tumbo', 'Prueba');
          begin perform tumbo_privado.crear_reembolso_extra(${lit(ped)}, 4, 'x', 'otro', 'Prueba'); exception when others then e1 := sqlerrm; end;
          begin perform tumbo_privado.crear_reembolso_extra(${lit(ped)}, 0, 'x', 'tumbo', 'Prueba'); exception when others then e2 := sqlerrm; end;
          return jsonb_build_object('pagado', v_pagado, 'r1', r1, 'r2', r2, 'r5', r5, 'neto', neto,
            'suma', (select sum(monto_usd) from tumbo.reembolsos where id in (r1, r2)),
            'l3', (select string_agg(l.cuenta || ':' || l.debe || '/' || l.haber, ' ' order by l.id) from tumbo.asientos a
                   join tumbo.asiento_lineas l on l.asiento_id = a.id where a.referencia = 'R-' || r3),
            'l4', (select string_agg(l.cuenta || ':' || l.debe || '/' || l.haber, ' ' order by l.id) from tumbo.asientos a
                   join tumbo.asiento_lineas l on l.asiento_id = a.id where a.referencia = 'R-' || r4),
            'aj3', (select jsonb_agg(monto_usd) from tumbo.ajustes_seller where motivo = 'Reintegro de prueba (comercio)'),
            'aj4', (select count(*) from tumbo.ajustes_seller where motivo = 'Reintegro de prueba (Tumbo)'),
            'm3', (select jsonb_build_object('tipo', tipo, 'por', por, 'tasa', tasa = (select c.tasa from tumbo.config c limit 1))
                   from tumbo.reembolsos where id = r3),
            'e1', e1, 'e2', e2);
        end $f$;
        select pg_temp.probar();
        rollback;`);
      const n = r.neto || {};
      ok(r.r1 && r.r2 && !r.r5 && Number(r.suma) === Number(r.pagado) && Number(n.igtf_por_pagar) === 0.9 && Number(n.descuentos_tumbo) === -2 &&
         Math.abs(Number(n.por_pagar_seller) - (Number(r.pagado) - 0.9 + 2)) < 0.005,
        'completar_reembolso_total: de un parcial al total devuelve todo lo pagado y el libro queda como un reembolso completo (IGTF y descuento de Tumbo); sin nada que completar, null',
        JSON.stringify(r).slice(0, 300));
      ok(/^por_pagar_seller:5\.00\/0\.00 reembolsos_por_pagar:0\.00\/5\.00$/.test(r.l3 || '') && JSON.stringify(r.aj3) === '[-5]' &&
         /^devoluciones_envio:4\.00\/0\.00 reembolsos_por_pagar:0\.00\/4\.00$/.test(r.l4 || '') && Number(r.aj4) === 0 &&
         r.m3 && r.m3.tipo === 'pedido' && r.m3.por === 'Prueba' && r.m3.tasa === true && /comercio o Tumbo/.test(r.e1 || '') && /mayor que cero/.test(r.e2 || ''),
        'crear_reembolso_extra: a cargo del comercio (por_pagar_seller y su descuento en la liquidación) o de Tumbo (devoluciones_envio), a la tasa del día',
        JSON.stringify(r).slice(0, 300));
    } else {
      omitida('completar_reembolso_total y crear_reembolso_extra', 'sin pedido pagado');
    }
    const fuentes = JSON.parse(psql(`select jsonb_object_agg(p.proname, p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname, p.proname) in (('tumbo_privado', 'disputa_reembolso_total'), ('public', 'tm_disputa_envio_vuelta_resolver'),
                                       ('tumbo_privado', 'disputa_resolver_interno'))`));
    ok(/completar_reembolso_total/.test(fuentes.disputa_reembolso_total) && !/asentar/.test(fuentes.disputa_reembolso_total) &&
       /crear_reembolso_extra/.test(fuentes.tm_disputa_envio_vuelta_resolver) && !/insert into tumbo\.reembolsos/.test(fuentes.tm_disputa_envio_vuelta_resolver) &&
       /devolucion_pagador/.test(fuentes.disputa_resolver_interno) && !/regexp_replace\(instrucciones/.test(fuentes.disputa_resolver_interno),
      'Comunicación usa los contratos de Pagos (completar a total, reembolso extra) y de Logística (quién paga el envío de vuelta)');

    /* ================= Panel financiero: el plazo de apelación ================= */
    const fin0 = await rpc('tm_finanzas_resumen', { p_sesion: s.finanzas, p_desde: null, p_hasta: null });
    const lib = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: 'DSP-0098', p_datos: { decision: 'liberar', nota: 'Prueba de la integración de la ola 2.' } });
    const neto428 = Number(psql(`select (tumbo_privado.liquidacion_pedido(p) ->> 'neto')::numeric from tumbo.pedidos p where id = 'TM-2026-00428'`));
    const fin1 = await rpc('tm_finanzas_resumen', { p_sesion: s.finanzas, p_desde: null, p_hasta: null });
    ok(fin0.ok && lib.ok && fin1.ok && Number(fin0.dato.congelado_apelacion) === 0 && neto428 > 0 &&
       Math.abs(Number(fin1.dato.congelado_apelacion) - neto428) < 0.005 && Number(fin1.dato.congelado) >= Number(fin1.dato.congelado_apelacion) &&
       Number(fin1.dato.dias_apelacion) === 5,
      'el panel financiero separa lo congelado por el plazo de apelación de un reclamo ya resuelto (congelado_apelacion, dias_apelacion)',
      [lib.texto, JSON.stringify(fin1.dato && { c: fin1.dato.congelado, a: fin1.dato.congelado_apelacion, n: neto428 })].join(' | ').slice(0, 300));

    /* ================= Logística: quién paga el envío de vuelta ================= */
    {
      const T = (p) => psql(`select tumbo_privado.devolucion_paga_texto(${lit(p)})`);
      const tTumbo = T('tumbo'), tSeller = T('seller'), tComp = T('comprador');
      const legado = 'El envío de vuelta lo paga el comercio: pide «cobro en destino» si la agencia lo ofrece o guarda el recibo.';
      const todo = jsonTodo(`begin;
        update tumbo.pedidos set estado = 'devolucion' where id = 'TM-2026-00431';
        select jsonb_build_object('creada', (select paga || '|' || instrucciones from tumbo.devoluciones where pedido_id = 'TM-2026-00431'));
        select tumbo_privado.devolucion_pagador('TM-2026-00431', 'tumbo');
        select jsonb_build_object('a', (select paga || '|' || instrucciones from tumbo.devoluciones where pedido_id = 'TM-2026-00431'));
        update tumbo.devoluciones set instrucciones = 'Lleva el paquete a la agencia. ' || ${lit(legado)} || ' Registra la guía.' where pedido_id = 'TM-2026-00431';
        select tumbo_privado.devolucion_pagador('TM-2026-00431', 'comprador');
        select jsonb_build_object('b', (select paga || '|' || instrucciones from tumbo.devoluciones where pedido_id = 'TM-2026-00431'));
        update tumbo.devoluciones set instrucciones = 'Operaciones te escribe por el chat con la agencia exacta.' where pedido_id = 'TM-2026-00431';
        select tumbo_privado.devolucion_pagador('TM-2026-00431', 'seller');
        select jsonb_build_object('c', (select paga || '|' || instrucciones from tumbo.devoluciones where pedido_id = 'TM-2026-00431'),
                                  'sin', tumbo_privado.devolucion_pagador('TM-2026-00415', 'tumbo'));
        rollback;`);
      const veces = (t, f) => t.split(f).length - 1;
      const [pa, ia] = String(todo.a || '').split('|');
      const [pb, ib] = String(todo.b || '').split('|');
      const [pc, ic] = String(todo.c || '').split('|');
      ok(todo.creada && /^(seller|comprador)\|/.test(todo.creada) && (todo.creada.includes(tSeller) || todo.creada.includes(tComp)) &&
         pa === 'tumbo' && veces(ia, tTumbo) === 1 && !ia.includes(tSeller) && !ia.includes(tComp) && /Cuando lo envíes, registra aquí la guía\.$/.test(ia) &&
         pb === 'comprador' && ib === 'Lleva el paquete a la agencia. ' + tComp + ' Registra la guía.' &&
         pc === 'seller' && ic === 'Operaciones te escribe por el chat con la agencia exacta. ' + tSeller && todo.sin === false,
        'devolucion_pagador (Logística) cambia quién paga y su frase en las instrucciones (también la frase de antes; si Operaciones las reescribió, la agrega)',
        JSON.stringify(todo).slice(0, 300));
    }

    /* ================= Archivos: marketing y huérfanos ================= */
    psql(`insert into tumbo.permisos_usuario (usuario_id, permiso, otorgado_por) values (${lit(idDe('ops'))}, 'marketing', 'Pruebas') on conflict do nothing`);
    const subir = (ses) => rpc('tm_archivo_preparar', { p_sesion: ses, p_proposito: 'marketing', p_entidad: 'marketing', p_tipo: 'image/webp',
      p_bytes: 120000, p_nombre: 'banner-portada.webp' });
    const mAdmin = await subir(s.r_admin);
    const mOps = await subir(s.r_ops);
    const mDemo = await subir(s.superadmin);
    psql(`delete from tumbo.permisos_usuario where usuario_id = ${lit(idDe('ops'))}`);
    const mSin = await subir(s.r_ops);
    const mOtra = await rpc('tm_archivo_preparar', { p_sesion: s.r_admin, p_proposito: 'marketing', p_entidad: 'SEL-014', p_tipo: 'image/webp',
      p_bytes: 120000, p_nombre: 'banner.webp' });
    const mkt = await rpc('tm_marketing_admin', { p_sesion: s.r_admin });
    ok(mAdmin.ok && mOps.ok && /^marketing\//.test(mAdmin.dato.ruta) && mAdmin.dato.bucket === 'tumbo-espera' && !mDemo.ok && !mSin.ok && !mOtra.ok &&
       mkt.ok && mkt.dato.imagenes === true,
      'el propósito marketing: sube el superadministrador real y Operaciones con el permiso marketing, en la entidad «marketing»; ni una cuenta de prueba ni Operaciones sin el permiso; Marketing ofrece la subida',
      [mAdmin.texto, mOps.texto, mDemo.texto, mSin.texto, mOtra.texto, mkt.dato && mkt.dato.imagenes].join(' | ').slice(0, 300));
    psql(`update tumbo.archivos set estado = 'descartado', motivo = 'prueba' where proposito = 'marketing' and estado = 'pendiente'`);
    const u = '0b0b0b0b-0000-4000-8000-0000000000';
    const huer = json(`begin;
      insert into storage.objects (bucket_id, name, created_at) values
        ('tumbo-publico', 'resena/a0000000-0000-4000-8000-000000000001/${u}01.webp', now() - interval '20 minutes'),
        ('tumbo-privado', 'soporte/a0000000-0000-4000-8000-000000000001/${u}02.pdf', now() - interval '20 minutes'),
        ('tumbo-publico', 'marketing/a0000000-0000-4000-8000-000000000005/${u}03.webp', now() - interval '20 minutes'),
        ('tumbo-publico', 'producto/SEL-014/${u}04.webp', now() - interval '20 minutes'),
        ('tumbo-publico', 'otro/SEL-014/${u}05.webp', now() - interval '20 minutes'),
        ('tumbo-publico', 'resena/a0000000-0000-4000-8000-000000000001/${u}06.webp', now());
      select jsonb_build_object('rutas', (select jsonb_agg(x ->> 'ruta') from jsonb_array_elements(tumbo_privado.tarea_archivos(1000) -> 'borrar') x
                                           where x ->> 'ruta' like '%${u}%'));
      rollback;`);
    const rutas = (huer.rutas || []).map((x) => x.split('/')[0] + ':' + (x.match(/(\d\d\.[a-z]+)$/) || [])[1]).sort();
    ok(rutas.join() === 'marketing:03.webp,producto:04.webp,resena:01.webp,soporte:02.pdf',
      'la limpieza de huérfanos reconoce los objetos de todos los propósitos (también resena, soporte y marketing), no los ajenos ni los recién subidos',
      JSON.stringify(huer.rutas));

    /* ================= La baja borra lo de Comunicación ================= */
    {
      const uB = idDe('baja');
      const b = json(`begin;
        update tumbo.usuarios set telefono = '04125550199', terminos_version = '2026-10-beta' where id = ${lit(uB)};
        insert into tumbo.consentimientos_whatsapp (usuario_id, accion, telefono, version) values (${lit(uB)}, 'otorgar', '04125550199', 'prueba');
        insert into tumbo.chat_lecturas (pedido_id, usuario_id, ultimo) values ('TM-2026-00431', ${lit(uB)}, 3);
        insert into tumbo.tickets (id, usuario_id, rol, categoria, asunto, sla_vence) values ('SOP-INTEG2', ${lit(uB)}, 'comprador', 'cuenta', 'Mi teléfono es 0414-555-1234', now() + interval '1 day');
        insert into tumbo.ticket_mensajes (ticket_id, autor_id, lado, autor, texto) values ('SOP-INTEG2', ${lit(uB)}, 'cliente', 'Tú', 'Llámenme al 0414-555-1234, vivo en la Av. Bolívar.');
        insert into tumbo.ticket_mensajes (ticket_id, autor_id, lado, autor, texto) values ('SOP-INTEG2', null, 'soporte', 'Soporte Tumbo · Ana', 'Te escribimos por aquí.');
        insert into tumbo.archivos (proposito, bucket, ruta, entidad, propietario, tipo, bytes, reserva, estado)
          values ('soporte', 'tumbo-privado', 'soporte/${uB}/0c0c0c0c-0000-4000-8000-000000000001.pdf', ${lit(uB)}, ${lit(uB)}, 'application/pdf', 1000, 1000, 'listo');
        select tumbo_privado.anonimizar_cuenta(${lit(uB)});
        select jsonb_build_object(
          'consent', (select count(*) from tumbo.consentimientos_whatsapp where usuario_id = ${lit(uB)}),
          'lecturas', (select count(*) from tumbo.chat_lecturas where usuario_id = ${lit(uB)}),
          'ticket', (select asunto || '|' || estado from tumbo.tickets where id = 'SOP-INTEG2'),
          'msj', (select jsonb_agg(lado || '|' || autor || '|' || texto order by id) from tumbo.ticket_mensajes where ticket_id = 'SOP-INTEG2'),
          'archivo', (select estado from tumbo.archivos where propietario = ${lit(uB)} and proposito = 'soporte'),
          'legales', (select count(*) from tumbo.aceptaciones_legales where usuario_id = ${lit(uB)}));
        rollback;`);
      const msj = b.msj || [];
      ok(Number(b.consent) === 0 && Number(b.lecturas) === 0 && b.ticket === 'Caso de una cuenta eliminada|cerrado' &&
         msj.length === 2 && /^cliente\|Cuenta eliminada\|\(Mensaje borrado/.test(msj[0]) && /^soporte\|/.test(msj[1]) && !/0414|Bolívar/.test(JSON.stringify(msj)) &&
         b.archivo === 'descartado' && Number(b.legales) >= 1,
        'la baja borra el consentimiento de WhatsApp y las lecturas del chat, deja sus casos de soporte sin texto ni adjuntos y conserva las aceptaciones legales',
        JSON.stringify(b).slice(0, 300));
    }

    /* ================= Catálogo de tareas ================= */
    const sis = await rpc('tm_sistema', { p_sesion: s.superadmin });
    const tareas = JSON.parse(psql(`select jsonb_object_agg(tarea, dominio || '|' || coalesce(trabajo, '-') || '|' || coalesce(cada_min::text, '-'))
                                    from tumbo.tareas_programadas`));
    ok(tareas.envios === 'Comunicación|tumbo-envios|1' && tareas.comunicacion === 'Comunicación|tumbo-comunicacion|15' &&
       tareas.niveles === 'Crecimiento|tumbo-crecimiento-niveles|1440' && tareas.analitica === 'Crecimiento|tumbo-crecimiento-analitica|1440' &&
       sis.ok && Array.isArray(sis.dato.sin_catalogo) && sis.dato.sin_catalogo.length === 0,
      'el catálogo de tareas tiene las de Comunicación y Crecimiento (dominio, trabajo y frecuencia) y ninguna tarea_* queda sin catálogo',
      JSON.stringify({ tareas, sin: sis.dato && sis.dato.sin_catalogo }).slice(0, 300));
    const adop = json(`begin;
      delete from tumbo.tareas_programadas where funcion in ('tarea_envios', 'tarea_niveles');
      insert into tumbo.tareas_programadas (tarea, funcion, trabajo, horario, dominio, descripcion, manual) values
        ('envios', 'tarea_envios', 'tumbo-envios', '* * * * *', 'Sin asignar', 'La programó su dominio (tumbo-envios). Falta su descripción en el catálogo.', true),
        ('niveles', 'tarea_niveles', 'tumbo-crecimiento-niveles', '20 9 * * *', 'Sin asignar', 'La programó su dominio. Falta su descripción en el catálogo.', true);
      select tumbo_privado.catalogo_tareas_base();
      select jsonb_object_agg(tarea, dominio || '|' || cada_min || '|' || (descripcion like 'La programó%')) from tumbo.tareas_programadas
      where funcion in ('tarea_envios', 'tarea_niveles');
      rollback;`);
    ok(adop.envios === 'Comunicación|1|false' && adop.niveles === 'Crecimiento|1440|false',
      'si pg_cron ya las había adoptado («Sin asignar»), el catálogo completa su dominio, su descripción y su frecuencia', JSON.stringify(adop));

    /* ================= Reinicio con la demo apagada ================= */
    const pedidosAntes = psql(`select count(*) from tumbo.pedidos`);
    let rSin, rDemo;
    try {
      psql(`update tumbo.ajustes set valor = 'false' where clave = 'demo_activa'`);
      rSin = await rpc('tm_reiniciar_demo', { p_sesion: null });
      rDemo = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
    } finally {
      psql(`update tumbo.ajustes set valor = 'true' where clave = 'demo_activa'`);
    }
    ok(!rSin.ok && /demo está apagada/.test(rSin.texto) && !rDemo.ok && /demo está apagada/.test(rDemo.texto) &&
       psql(`select count(*) from tumbo.pedidos`) === pedidosAntes,
      'con la demo apagada, tm_reiniciar_demo lo dice antes que nada (también sin sesión) y no toca nada',
      [rSin.texto, rDemo.texto].join(' | ').slice(0, 240));
  } finally {
    /* ================= Limpieza ================= */
    psql(`delete from tumbo.permisos_usuario where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
          delete from tumbo.sesiones where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
          update tumbo.usuarios set activo = false where email in (${lista})`);
  }
  const rf = await R.reiniciar(rpc, s.superadmin);
  ok(rf.ok, 'la demo queda reiniciada', rf.texto);

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Integración de la ola 2 verificada por la API: contratos de Pagos y Logística, panel financiero, archivos, baja, tareas y el interruptor de la demo.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });
