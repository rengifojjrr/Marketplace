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
 *     sin sesión;
 *   · lo de la revisión de la integración (sección 7 de la migración):
 *     cupones, presupuestos y relámpagos en un checkout de varios
 *     comercios; el pago recibido tarde con sus promociones tomadas; la
 *     cancelación con el cupón de Tumbo (TMPAG y el pago completo); la
 *     apelación con el descuento del parcial ya liquidado y con quién paga
 *     la devolución; los reclamos perdidos de niveles y métricas; la cuenta
 *     de prueba del comercio frente a una compradora real (chat, reclamo,
 *     evidencia, preguntas y fallo automático); los ajustes de seguridad y
 *     de control; las listas negras y el riesgo de las cuentas de prueba; el
 *     techo de la analítica; las métricas de la demo y ocultar_contacto.
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
      'el catálogo de tareas de Comunicación y Crecimiento', 'el reinicio con la demo apagada',
      'la revisión de la integración (promociones, pago tardío, apelaciones, niveles, cuentas de prueba del comercio, ajustes, listas negras, analítica y ocultar_contacto)']) omitida(t);
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

    /* =====================================================================
       Revisión de la integración (hallazgos corregidos antes de desplegar)
       ===================================================================== */
    /* (la demo vuelve a la semilla: DSP-0098 sin resolver, sus pedidos como al principio) */
    const rRev = await R.reiniciar(rpc, s.superadmin);
    ok(rRev.ok, 'la demo vuelve a la semilla para las pruebas de la revisión', rRev.texto);
    /* sesiones reales con la 2FA y elevadas; Finanzas real con «ajustes» */
    psql(`insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
          select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REALES.admin.email)}
          on conflict (usuario_id) do update set activo = true;
          update tumbo.sesiones set elevada_hasta = now() + interval '1 hour'
          where usuario_id in (select id from tumbo.usuarios where email in (${lit(REALES.admin.email)}, ${lit(REALES.fin.email)}))`);
    /* La compra de quien tiene la sesión (agencia, pago móvil) con un cupón:
       {aplicado, descuento, pago} o {…, error}. Vacía antes su carrito. */
    const COMPRAR = `create function pg_temp.comprar(sa text, p_items jsonb, p_cupon text) returns jsonb language plpgsql as $f$
      declare q jsonb; c jsonb; x jsonb;
      begin
        delete from tumbo.carrito_items where usuario_id = (select s.usuario_id from tumbo.sesiones s where s.token_hash = tumbo_privado.hash_token(sa));
        for x in select * from jsonb_array_elements(p_items) loop
          perform public.tm_carrito_poner(sa, x ->> 0, (x ->> 1)::integer);
        end loop;
        q := public.tm_checkout_cotizar(sa, jsonb_build_object('entrega', 'agencia', 'metodo', 'pago_movil', 'cupon', p_cupon));
        begin
          c := public.tm_checkout_crear(sa, jsonb_build_object('entrega', 'agencia', 'metodo', 'pago_movil', 'cupon', p_cupon,
                                           'esperado', jsonb_build_object('total_usd', (q ->> 'total_usd')::numeric)));
          return jsonb_build_object('aplicado', q -> 'cupon' -> 'aplicado', 'descuento', (q ->> 'descuento_usd')::numeric, 'pago', c ->> 'pago');
        exception when others then
          return jsonb_build_object('aplicado', q -> 'cupon' -> 'aplicado', 'descuento', (q ->> 'descuento_usd')::numeric, 'error', sqlerrm);
        end;
      end $f$;`;
    const cuponSql = (codigo, tipo, valor, minimo, usos, presupuesto, seller) =>
      `insert into tumbo.cupones (codigo, tipo, valor, minimo_usd, usos_por_usuario, desde, hasta, financia, presupuesto_usd, seller_id, por)
       values (${lit(codigo)}, ${lit(tipo)}, ${valor}, ${minimo}, ${usos}, now() - interval '1 minute', now() + interval '1 day',
               ${seller ? "'seller'" : "'tumbo'"}, ${presupuesto == null ? 'null' : presupuesto}, ${seller ? lit(seller) : 'null'}, 'Pruebas de la integración')`;

    /* --- a. Promociones de un checkout de varios comercios --- */
    {
      const pr = json(`begin;
        ${COMPRAR}
        create function pg_temp.probar(sa text) returns jsonb language plpgsql as $f$
        declare r jsonb; res jsonb := '{}'; e text; st text; v_ped text;
        begin
          -- 1. cupón de Tumbo de un uso por persona (10 %) en dos comercios
          begin
            ${cuponSql('INTEG2UNO', 'porcentaje', 10, 0, 1, 1000)};
            r := pg_temp.comprar(sa, '[["SKU-TEC-0450",1],["SKU-HOG-0110",1]]', 'INTEG2UNO');
            res := res || jsonb_build_object('uno', r || jsonb_build_object('uso', tumbo_privado.cupon_uso((select id from tumbo.cupones where codigo = 'INTEG2UNO'), null),
              'pedidos', (select count(*) from tumbo.pedidos where pago_id = r ->> 'pago')));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('uno', sqlerrm); end if;
          end;
          -- 2. cupón de Hogar Total (SEL-009, el primer comercio) de un uso por persona
          begin
            ${cuponSql('INTEG2HOGAR', 'porcentaje', 10, 0, 1, null, 'SEL-009')};
            res := res || jsonb_build_object('dos', pg_temp.comprar(sa, '[["SKU-TEC-0450",1],["SKU-HOG-0110",1]]', 'INTEG2HOGAR'));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('dos', sqlerrm); end if;
          end;
          -- 3. cupón de Tumbo de $10 con el presupuesto justo para un uso
          begin
            ${cuponSql('INTEG2PRES', 'monto', 10, 0, 5, 10)};
            r := pg_temp.comprar(sa, '[["SKU-TEC-0450",1],["SKU-HOG-0110",1]]', 'INTEG2PRES');
            res := res || jsonb_build_object('tres', r || jsonb_build_object('uso', tumbo_privado.cupon_uso((select id from tumbo.cupones where codigo = 'INTEG2PRES'), null)));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('tres', sqlerrm); end if;
          end;
          -- 4. relámpago de SEL-009 (3 unidades): lleva 2 más un producto de SEL-014
          begin
            insert into tumbo.ofertas (seller_id, sku, tipo, precio_oferta_usd, precio_referencia_usd, stock_oferta, desde, hasta, financia, por)
            values ('SEL-009', 'SKU-HOG-0110', 'relampago', 45, 55, 3, now() - interval '1 minute', now() + interval '24 hours', 'seller', 'Pruebas');
            r := pg_temp.comprar(sa, '[["SKU-HOG-0110",2],["SKU-TEC-0450",1]]', null);
            res := res || jsonb_build_object('cuatro', r || jsonb_build_object('vendidas',
              tumbo_privado.oferta_vendidas((select id from tumbo.ofertas where sku = 'SKU-HOG-0110' and tipo = 'relampago' order by id desc limit 1))));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('cuatro', sqlerrm); end if;
          end;
          -- 5. cancelar un pedido de un pago con el cupón de Tumbo ($30 desde $100)
          begin
            ${cuponSql('INTEG2MIN', 'monto', 30, 100, 5, 1000)};
            r := pg_temp.comprar(sa, '[["SKU-TEC-0450",2],["SKU-HOG-0110",1]]', 'INTEG2MIN');
            v_ped := (select id from tumbo.pedidos where pago_id = r ->> 'pago' and seller_id = 'SEL-009');
            begin
              perform public.tm_cancelar_pedido(sa, v_ped, 'Ya no lo quiero');
            exception when others then e := sqlerrm; st := sqlstate;
            end;
            perform public.tm_cancelar_pedido(sa, r ->> 'pago', 'Todo el pago');
            res := res || jsonb_build_object('cinco', r || jsonb_build_object('e', e, 'st', st,
              'pedidos', (select jsonb_agg(estado order by id) from tumbo.pedidos where pago_id = r ->> 'pago'),
              'estado', (select estado from tumbo.pagos where id = r ->> 'pago'),
              'uso', tumbo_privado.cupon_uso((select id from tumbo.cupones where codigo = 'INTEG2MIN'), null)));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('cinco', sqlerrm); end if;
          end;
          -- 6. sin compra mínima: la parte del pedido cancelado vuelve al presupuesto
          begin
            ${cuponSql('INTEG2SIN', 'monto', 30, 0, 5, 1000)};
            r := pg_temp.comprar(sa, '[["SKU-TEC-0450",2],["SKU-HOG-0110",1]]', 'INTEG2SIN');
            perform public.tm_cancelar_pedido(sa, (select id from tumbo.pedidos where pago_id = r ->> 'pago' and seller_id = 'SEL-009'), 'Ya no lo quiero');
            res := res || jsonb_build_object('seis', r || jsonb_build_object(
              'queda', (select descuento_tumbo_usd from tumbo.pedidos where pago_id = r ->> 'pago' and seller_id = 'SEL-014'),
              'uso', tumbo_privado.cupon_uso((select id from tumbo.cupones where codigo = 'INTEG2SIN'), null)));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('seis', sqlerrm); end if;
          end;
          return res;
        end $f$;
        select pg_temp.probar(${lit(s.comprador)});
        rollback;`);
      const { uno = {}, dos = {}, tres = {}, cuatro = {}, cinco = {}, seis = {} } = pr;
      ok(uno.aplicado === true && uno.pago && Number(uno.pedidos) === 2 && uno.uso && Number(uno.uso.usos) === 1 &&
         Math.abs(Number(uno.uso.gastado_usd) - Number(uno.descuento)) < 0.005,
        'un cupón de Tumbo de un uso por persona sirve en un checkout de dos comercios (el registro no cuenta el propio pago) y queda registrado una vez',
        JSON.stringify(uno).slice(0, 300));
      ok(dos.aplicado === true && dos.pago, 'un cupón de un uso del primer comercio del carrito también (antes: «Ya usaste el cupón»)', JSON.stringify(dos).slice(0, 300));
      ok(tres.aplicado === true && tres.pago && tres.uso && Number(tres.uso.gastado_usd) === 10,
        'el cupón con el presupuesto justo para un uso aplica en dos comercios y gasta exactamente su presupuesto', JSON.stringify(tres).slice(0, 300));
      ok(cuatro.pago && Number(cuatro.vendidas) === 2 && Number(cuatro.descuento) === 20,
        'la relámpago del primer comercio ve sus unidades sin descontar las que el mismo pago ya registró', JSON.stringify(cuatro).slice(0, 300));
      ok(cinco.pago && cinco.st === 'TMPAG' && /compra mínima de \$100\.00/.test(cinco.e || '') && /cancela el pago completo/.test(cinco.e || '') &&
         JSON.stringify(cinco.pedidos) === '["cancelado","cancelado"]' && cinco.estado === 'cancelado' && cinco.uso && Number(cinco.uso.gastado_usd) === 0,
        'cancelar un pedido de un pago con el cupón de Tumbo no deja el resto bajo la compra mínima (TMPAG): se cancela el pago completo y el cupón deja de contarlo',
        JSON.stringify(cinco).slice(0, 300));
      ok(seis.pago && seis.uso && Math.abs(Number(seis.uso.gastado_usd) - Number(seis.queda)) < 0.005 && Number(seis.queda) > 0 && Number(seis.queda) < 30,
        'sin compra mínima, la parte del cupón del pedido cancelado vuelve a su presupuesto (queda solo la del pedido que sigue)', JSON.stringify(seis).slice(0, 300));
    }

    /* --- a. Pago recibido tarde con las promociones tomadas por otra compra --- */
    {
      const pt = json(`begin;
        ${COMPRAR}
        create function pg_temp.probar(sa text, sb text, sf text) returns jsonb language plpgsql as $f$
        declare a jsonb; b jsonb; res jsonb := '{}'; e text;
        begin
          -- relámpago de 2 unidades y cupón de $10 con presupuesto de $10: A compra, vence; B compra; A llega tarde
          foreach e in array array['oferta', 'cupon', 'libre'] loop
            begin
              if e = 'oferta' then
                insert into tumbo.ofertas (seller_id, sku, tipo, precio_oferta_usd, precio_referencia_usd, stock_oferta, desde, hasta, financia, por)
                values ('SEL-014', 'SKU-TEC-0450', 'relampago', 20, 25, 2, now() - interval '1 minute', now() + interval '24 hours', 'seller', 'Pruebas');
              end if;
              ${cuponSql('INTEG2TARDE', 'monto', 10, 0, 1, 10)};
              a := pg_temp.comprar(sa, '[["SKU-TEC-0450",2]]', 'INTEG2TARDE');
              update tumbo.pagos set vence = now() - interval '1 hour' where id = a ->> 'pago';
              perform tumbo_privado.tarea_pagos();
              if e <> 'libre' then
                b := pg_temp.comprar(sb, '[["SKU-TEC-0450",2]]', 'INTEG2TARDE');
              end if;
              begin
                res := res || jsonb_build_object(e, jsonb_build_object('a', a ->> 'pago', 'b', b ->> 'pago',
                  'estado', public.tm_pago_tardio(sf, a ->> 'pago', 'verificar', 'Llegó el lunes') ->> 'estado'));
              exception when others then
                res := res || jsonb_build_object(e, jsonb_build_object('a', a ->> 'pago', 'b', b ->> 'pago', 'error', sqlerrm));
              end;
              raise exception 'deshacer';
            exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object(e, sqlerrm); end if;
            end;
          end loop;
          return res;
        end $f$;
        select pg_temp.probar(${lit(s.comprador)}, ${lit(s.r_compra)}, ${lit(s.r_fin)});
        rollback;`);
      ok(pt.oferta && pt.oferta.b && /oferta relámpago .* ya las compró otra persona/.test(pt.oferta.error || '') &&
         pt.cupon && pt.cupon.b && /cupón INTEG2TARDE llegó a su tope/.test(pt.cupon.error || '') &&
         pt.libre && pt.libre.estado === 'verificado',
        'el pago recibido tarde no se reactiva si sus unidades relámpago o su cupón ya los tomó otra compra («genera el reembolso»); sin otra compra, se verifica',
        JSON.stringify(pt).slice(0, 300));
    }

    /* --- b. Apelaciones: el descuento del parcial ya liquidado y quién paga la devolución --- */
    {
      const T = (p) => psql(`select tumbo_privado.devolucion_paga_texto(${lit(p)})`);
      const tTumbo = T('tumbo'), tSeller = T('seller');
      const ap = json(`begin;
        create function pg_temp.evidencia(dsp text) returns text language sql as $q$
          insert into tumbo.archivos (proposito, bucket, ruta, entidad, propietario, tipo, bytes, reserva, estado)
          values ('evidencia', 'tumbo-privado', 'evidencia/' || dsp || '/' || gen_random_uuid() || '.jpg', dsp,
                  'a0000000-0000-4000-8000-000000000001', 'image/jpeg', 100, 100, 'listo') returning id::text $q$;
        create function pg_temp.probar(sc text, so text, sa text) returns jsonb language plpgsql as $f$
        declare res jsonb := '{}';
        begin
          -- 1. parcial de $20 → la corrida del lunes toma su descuento → apelación → reembolso total
          begin
            perform public.tm_disputa_resolver(so, 'DSP-0098', '{"decision": "reembolso_parcial", "monto": 20, "nota": "Parcial por un rayón"}');
            perform tumbo_privado.tarea_liquidaciones();
            perform public.tm_disputa_apelar(sc, 'DSP-0098', 'El rayón inutiliza la pantalla: pido el reembolso total del pedido', array[pg_temp.evidencia('DSP-0098')]);
            update tumbo.disputa_casos set resuelta_en = now() - interval '6 days' where disputa_id = 'DSP-0098';
            perform public.tm_disputa_apelacion_resolver(sa, 'DSP-0098', '{"resultado": "modificar", "decision": "reembolso", "nota": "La evidencia muestra la pantalla inutilizable"}');
            res := res || jsonb_build_object('total', jsonb_build_object(
              'liq', (select jsonb_agg(l.ajustes_usd) from tumbo.liquidaciones l where l.seller_id = 'SEL-014' and l.ciclo = 'preparada'),
              'ajustes', (select jsonb_agg(a.monto_usd::text || '|' || (a.liquidacion_id is null) order by a.id) from tumbo.ajustes_seller a
                          where a.seller_id = 'SEL-014' and (a.motivo like '%DSP-0098%')),
              'estado', (select estado from tumbo.pedidos where id = 'TM-2026-00428'),
              'decision', (select decision from tumbo.disputa_casos where disputa_id = 'DSP-0098')));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('total', sqlerrm); end if;
          end;
          -- 2. liberar → apelación → devolución que paga Tumbo
          begin
            perform public.tm_disputa_resolver(so, 'DSP-0098', '{"decision": "liberar", "nota": "Sin pruebas suficientes"}');
            perform public.tm_disputa_apelar(sc, 'DSP-0098', 'Adjunto fotos nuevas que muestran que el producto llegó defectuoso', array[pg_temp.evidencia('DSP-0098')]);
            perform public.tm_disputa_apelacion_resolver(sa, 'DSP-0098', '{"resultado": "modificar", "decision": "devolucion", "paga": "tumbo", "nota": "Las fotos nuevas muestran el defecto de fábrica"}');
            res := res || jsonb_build_object('devolucion', (select jsonb_build_object('paga', paga, 'instrucciones', instrucciones)
                                                            from tumbo.devoluciones where pedido_id = 'TM-2026-00428'));
            raise exception 'deshacer';
          exception when others then if sqlerrm <> 'deshacer' then res := res || jsonb_build_object('devolucion', sqlerrm); end if;
          end;
          return res;
        end $f$;
        select pg_temp.probar(${lit(s.comprador)}, ${lit(s.ops)}, ${lit(s.superadmin)});
        rollback;`);
      const tot = ap.total || {};
      ok(Array.isArray(tot.liq) && tot.liq.some((x) => Number(x) === -20) && JSON.stringify(tot.ajustes) === '["-20.00|false","20.00|true"]' &&
         tot.estado === 'reembolsado' && tot.decision === 'reembolso',
        'la apelación pasa a reembolso total aunque el descuento del parcial ya entró en una corrida: se le devuelve al comercio en la próxima (+$20)',
        JSON.stringify(ap.total).slice(0, 300));
      const dv = ap.devolucion || {};
      ok(dv.paga === 'tumbo' && (dv.instrucciones || '').includes(tTumbo) && !(dv.instrucciones || '').includes(tSeller),
        'la apelación que pasa a devolución fija quién paga con el contrato de Logística: «paga» y la frase que lee el comprador coinciden',
        JSON.stringify(ap.devolucion).slice(0, 300));
    }

    /* --- c. Un reclamo que el comercio ganó en la apelación no cuenta como perdido --- */
    {
      const nv = json(`begin;
        create function pg_temp.probar(ss text, so text, sa text) returns jsonb language plpgsql as $f$
        declare a jsonb; b jsonb; m1 jsonb; m2 jsonb; v_ev text;
        begin
          perform public.tm_disputa_resolver(so, 'DSP-0098', '{"decision": "reembolso", "nota": "A favor del comprador"}');
          a := tumbo_privado.metricas_nivel('SEL-014', 90);
          m1 := public.tm_metricas_negocio(sa, jsonb_build_object('desde', (current_date - 399)::text, 'hasta', current_date::text)) -> 'disputas';
          insert into tumbo.archivos (proposito, bucket, ruta, entidad, propietario, tipo, bytes, reserva, estado)
          select 'evidencia', 'tumbo-privado', 'evidencia/DSP-0098/' || gen_random_uuid() || '.jpg', 'DSP-0098', u.id, 'image/jpeg', 100, 100, 'listo'
          from tumbo.usuarios u where u.email = 'propietario@sel-014.demo' returning id::text into v_ev;
          perform public.tm_disputa_apelar(ss, 'DSP-0098', 'La guía muestra que el comprador recibió el producto en perfecto estado', array[v_ev]);
          perform public.tm_disputa_apelacion_resolver(sa, 'DSP-0098', '{"resultado": "modificar", "monto": 10, "nota": "La guía firmada le da la razón al comercio"}');
          b := tumbo_privado.metricas_nivel('SEL-014', 90);
          m2 := public.tm_metricas_negocio(sa, jsonb_build_object('desde', (current_date - 399)::text, 'hasta', current_date::text)) -> 'disputas';
          return jsonb_build_object('antes', a -> 'disputas_perdidas', 'despues', b -> 'disputas_perdidas',
            'm_antes', m1 -> 'perdidas', 'm_despues', m2 -> 'perdidas',
            'reput', tumbo_privado.reputacion_comercio('SEL-014') -> 'reclamos_perdidos_pct',
            'a_favor', (select apelacion_a_favor from tumbo.disputa_casos where disputa_id = 'DSP-0098'));
        end $f$;
        select pg_temp.probar(${lit(s.seller)}, ${lit(s.ops)}, ${lit(s.superadmin)});
        rollback;`);
      ok(nv.a_favor === 'comercio' && Number(nv.despues) === Number(nv.antes) - 1 && Number(nv.m_despues) === Number(nv.m_antes) - 1,
        'los niveles y las métricas de negocio cuentan los reclamos perdidos como la reputación: el que el comercio ganó en la apelación ya no pesa',
        JSON.stringify(nv));
    }

    /* --- d. La cuenta de prueba del comercio frente a una compradora real --- */
    {
      const cr = json(`begin;
        create function pg_temp.probar(sc text, ss text) returns jsonb language plpgsql as $f$
        declare v_dsp text; res jsonb := '{}'; e1 text; e2 text; e3 text; e4 text; v_q bigint; v_vendedor tumbo.usuarios;
        begin
          -- un pedido entregado de la compradora real a TechElectro (comercio de la demo)
          update tumbo.pedidos set comprador_id = (select s.usuario_id from tumbo.sesiones s where s.token_hash = tumbo_privado.hash_token(sc)),
                 estado = 'entregado', entregado_el = now(), liquidacion = 'retenido', disputa_id = null
          where id = 'TM-2026-00431';
          perform public.tm_chat_enviar(sc, 'TM-2026-00431', 'Hola, déjenlo con el conserje del 7-B, estoy de 2 a 6', '{}');
          v_dsp := public.tm_abrir_disputa(sc, 'TM-2026-00431', 'Producto dañado', 'Llegó con la pantalla rota; estoy en Chacao, piso 7.', '{}');
          res := jsonb_build_object('chat', public.tm_chat(ss, 'TM-2026-00431', null), 'pendientes', public.tm_chat_pendientes(ss),
                                    'disputa', public.tm_disputa(ss, v_dsp), 'propia', public.tm_disputa(sc, v_dsp) -> 'bloqueado',
                                    'cargar', (select d from jsonb_array_elements(public.tm_cargar(ss) -> 'disputas') d where d ->> 'id' = v_dsp));
          select * into v_vendedor from tumbo.usuarios where email = 'propietario@sel-014.demo';
          res := res || jsonb_build_object('evidencia', tumbo_privado.archivo_permitido(v_vendedor, 'evidencia', v_dsp, 'ver'));
          begin perform public.tm_responder_disputa(ss, v_dsp, 'No aceptamos el reclamo: salió bien empacado.', '{}'); exception when others then e1 := sqlerrm; end;
          begin perform public.tm_disputa_mensaje(ss, v_dsp, 'Mensaje de la cuenta de prueba', '{}'); exception when others then e2 := sqlerrm; end;
          v_q := (public.tm_pregunta_hacer(sc, 'SKU-TEC-0450', '¿Este modelo trae el cable de carga?') ->> 'id')::bigint;
          begin perform public.tm_pregunta_responder(ss, v_q, 'Sí, trae el cable original.'); exception when others then e3 := sqlerrm; end;
          -- el plazo del comercio vence: el fallo automático corre (nadie lo frenó)
          update tumbo.disputa_casos set plazo_seller = now() - interval '1 minute' where disputa_id = v_dsp;
          res := res || jsonb_build_object('e1', e1, 'e2', e2, 'e3', e3, 'tarea', tumbo_privado.tarea_comunicacion());
          res := res || jsonb_build_object('final', (select estado || '|' || coalesce(resolucion_decision, '') from tumbo.disputas where id = v_dsp));
          return res;
        end $f$;
        select pg_temp.probar(${lit(s.r_compra)}, ${lit(s.seller)});
        rollback;`);
      const ch = cr.chat || {}, dp = cr.disputa || {}, cg = cr.cargar || {};
      ok(ch.bloqueado === true && Array.isArray(ch.mensajes) && ch.mensajes.length === 0 && ch.puede_escribir === false &&
         !Object.keys(cr.pendientes || {}).includes('TM-2026-00431'),
        'la cuenta de prueba del comercio no lee el chat de una compradora real (bloqueado, sin mensajes ni avisos de no leídos)', JSON.stringify(ch).slice(0, 240));
      ok(dp.bloqueado === true && !/Chacao/.test(JSON.stringify(dp)) && dp.acciones && dp.acciones.responder === false && dp.acciones.apelar === false &&
         Array.isArray(dp.mensajes) && dp.mensajes.length === 0 && cr.propia === false && cg.bloqueado === true && !/Chacao/.test(JSON.stringify(cg)) &&
         cr.evidencia === false,
        'ni su reclamo (tm_disputa y tm_cargar bloqueados, sin descripción ni evidencia; la compradora sí lo ve completo)', JSON.stringify(dp).slice(0, 240));
      ok(/cuentas de prueba/.test(cr.e1 || '') && /cuentas de prueba/.test(cr.e2 || '') && /cuentas de prueba/.test(cr.e3 || '') &&
         cr.tarea && Number(cr.tarea.fallos_automaticos) >= 1 && /^resuelta\|reembolso$/.test(cr.final || ''),
        'ni responde su reclamo, ni le escribe en el expediente, ni responde su pregunta: el fallo automático a su favor sigue su curso',
        JSON.stringify({ final: cr.final, tarea: cr.tarea, e2: cr.e2 }).slice(0, 300));
    }

    /* --- e. Ajustes de seguridad y de control --- */
    {
      const aj = json(`begin;
        insert into tumbo.permisos_usuario (usuario_id, permiso, otorgado_por)
        select id, 'ajustes', 'Pruebas' from tumbo.usuarios where email = ${lit(REALES.fin.email)} on conflict do nothing;
        create function pg_temp.intento(ses text, clave text, valor jsonb) returns text language plpgsql as $f$
        begin
          return coalesce(public.tm_ajuste_guardar(ses, clave, valor) ->> 'pendiente', 'aplicado');
        exception when others then return 'error: ' || sqlerrm;
        end $f$;
        create function pg_temp.probar(sf text, sa text) returns jsonb language plpgsql as $f$
        declare res jsonb := '{}'; v_id bigint; e text;
        begin
          res := jsonb_build_object(
            'fin_sitio', pg_temp.intento(sf, 'sitio_url', '"https://tumbo-market.ejemplo-atacante.net"'),
            'fin_envios', pg_temp.intento(sf, 'envios', '{"funcion_url": "https://atacante.example/functions/v1/tumbo-envios", "lote": 50, "max_intentos": 5}'),
            'admin_ajeno', pg_temp.intento(sa, 'sitio_url', '"https://tumbo-market.ejemplo-atacante.net"'),
            'admin_mismo', pg_temp.intento(sa, 'sitio_url', '"https://rengifojjrr.github.io/Tumbo"'),
            'umbral_alto', pg_temp.intento(sf, 'reembolsos', '{"umbral_doble_usd": 10000000}'),
            'umbral', pg_temp.intento(sf, 'reembolsos', '{"umbral_doble_usd": 1000}'),
            'tasa_url', pg_temp.intento(sf, 'tasa_bcv', '{"url": "https://tasa.atacante.example/v1", "horas_alerta": 24, "variacion_max_pct": 15}'),
            'tasa_var', pg_temp.intento(sf, 'tasa_bcv', '{"url": "https://ve.dolarapi.com/v1/dolares/oficial", "horas_alerta": 24, "variacion_max_pct": 100}'),
            'valor', (select valor #>> '{}' from tumbo.ajustes where clave = 'sitio_url'),
            'umbral_valor', (select valor -> 'umbral_doble_usd' from tumbo.ajustes where clave = 'reembolsos'));
          v_id := (select id from tumbo.cambios_config where clave = 'sitio_url' and estado = 'pendiente' order by id desc limit 1);
          begin perform public.tm_cambio_decidir(sf, v_id, true, 'Aprobado'); exception when others then e := sqlerrm; end;
          -- un dominio que la persona dueña del proyecto autorizó por SQL
          insert into tumbo_privado.secretos (nombre, valor) values ('hosts_sitio_url', 'tumbo.com.ve www.tumbo.com.ve')
          on conflict (nombre) do update set valor = excluded.valor;
          update tumbo.cambios_config set estado = 'anulado' where clave = 'sitio_url' and estado = 'pendiente';
          res := res || jsonb_build_object('aprobar_fin', e,
            'autorizado', pg_temp.intento(sa, 'sitio_url', '"https://www.tumbo.com.ve"'),
            'admin', (select jsonb_object_agg(x ->> 'clave', jsonb_build_object('doble', x -> 'doble', 'seguridad', x -> 'seguridad'))
                      from jsonb_array_elements(public.tm_ajustes_admin(sf) -> 'ajustes') x
                      where x ->> 'clave' in ('sitio_url', 'envios', 'funciones_url', 'reembolsos', 'tasa_bcv', 'conciliacion', 'riesgo', 'analitica', 'moderacion')));
          return res;
        end $f$;
        select pg_temp.probar(${lit(s.r_fin)}, ${lit(s.r_admin)});
        rollback;`);
      ok(/Solo el superadministrador/.test(aj.fin_sitio || '') && /Solo el superadministrador/.test(aj.fin_envios || '') &&
         /dominio autorizado/.test(aj.admin_ajeno || '') && aj.admin_mismo === 'true' && aj.valor === 'https://rengifojjrr.github.io/Marketplace' &&
         /otro superadministrador/.test(aj.aprobar_fin || '') && aj.autorizado === 'true',
        'sitio_url y las direcciones de las funciones: solo el superadministrador, con doble aprobación de otro superadministrador y a un dominio autorizado',
        JSON.stringify(aj).slice(0, 300));
      const ad = aj.admin || {};
      ok(/hasta 5\.000 USD/.test(aj.umbral_alto || '') && aj.umbral === 'true' && Number(aj.umbral_valor) === 200 &&
         /dominio autorizado/.test(aj.tasa_url || '') && /hasta 50 %/.test(aj.tasa_var || '') &&
         ['reembolsos', 'tasa_bcv', 'conciliacion', 'riesgo', 'analitica', 'sitio_url', 'envios', 'funciones_url'].every((k) => ad[k] && ad[k].doble === true) &&
         ad.moderacion && ad.moderacion.doble === false && ad.sitio_url.seguridad === true && ad.reembolsos.seguridad === false,
        'el umbral de los reembolsos, la tasa automática, la conciliación, el riesgo y la analítica piden la segunda aprobación, con topes y la fuente de la tasa autorizada',
        JSON.stringify(aj).slice(0, 300));
    }

    /* --- f. Listas negras y riesgo de las cuentas de prueba --- */
    {
      const rg = json(`begin;
        insert into tumbo.listas_negras (tipo, valor, motivo, por, demo)
        values ('cedula', tumbo_privado.valor_lista('cedula', 'V-27111919'), 'Fraude confirmado: cédula de una persona real', 'Finanzas (real)', false),
               ('cuenta', '01340000000000000014', 'Cuenta usada en un fraude real', 'Finanzas (real)', false);
        insert into tumbo.usuarios (email, clave_hash, nombre, rol, cedula) values ('integ2-cedula@tumbo-local.ve', 'x', 'Persona Real', 'comprador', 'V-30555919');
        create function pg_temp.probar(so text, sa text, sf text) returns jsonb language plpgsql as $f$
        declare v_demo uuid := 'a0000000-0000-4000-8000-000000000001';
                v_real uuid := (select id from tumbo.usuarios where email = ${lit(REALES.compra.email)});
                res jsonb;
        begin
          res := jsonb_build_object(
            'demo_lista', tumbo_privado.riesgo_pedido(v_demo, '{"pagador": {"cedula": "V-27111919"}}') -> 'motivos',
            'demo_dato', tumbo_privado.riesgo_pedido(v_demo, '{"pagador": {"cedula": "V-30555919"}}') -> 'motivos',
            'real_lista', tumbo_privado.riesgo_pedido(v_real, '{"pagador": {"cedula": "V-27111919"}}') -> 'motivos',
            'real_dato', tumbo_privado.riesgo_pedido(v_real, '{"pagador": {"cedula": "V-30555919"}}') -> 'motivos',
            'comercio_visto', tumbo_privado.seller_lista_negra('SEL-014', true),
            'comercio_control', tumbo_privado.seller_lista_negra('SEL-014'),
            'panel_demo', (select jsonb_agg(x ->> 'id') from jsonb_array_elements(public.tm_riesgo_panel(sf) -> 'comercios') x));
          update tumbo.listas_negras set demo = true where valor = '01340000000000000014';
          update tumbo.usuarios set cedula = 'V-27111919' where id = v_demo;
          return res || jsonb_build_object('comercio_demo', tumbo_privado.seller_lista_negra('SEL-014', true),
            'ops_sin_riesgo', public.tm_comprador_360(so, v_demo) -> 'riesgo' -> 'listas_negras',
            'super_demo', public.tm_comprador_360(sa, v_demo) -> 'riesgo' -> 'listas_negras');
        end $f$;
        select pg_temp.probar(${lit(s.r_ops)}, ${lit(s.superadmin)}, ${lit(s.finanzas)});
        rollback;`);
      const reglas = (m) => (m || []).map((x) => x.regla);
      ok(!reglas(rg.demo_lista).includes('lista_negra') && !reglas(rg.demo_dato).includes('dato_compartido') &&
         reglas(rg.real_lista).includes('lista_negra') && reglas(rg.real_dato).includes('dato_compartido'),
        'una cuenta de prueba ya no consulta la lista negra real ni si una cédula es de una persona registrada (riesgo_pedido solo mira lo de la demo); una real, sí',
        JSON.stringify(rg).slice(0, 300));
      ok(rg.comercio_visto === null && /cuenta/.test(rg.comercio_control || '') && !(rg.panel_demo || []).includes('SEL-014') &&
         /cuenta/.test(rg.comercio_demo || '') && rg.ops_sin_riesgo === null &&
         Array.isArray(rg.super_demo) && !/persona real/.test(JSON.stringify(rg.super_demo)),
        'a una cuenta de prueba, los datos de cobro de un comercio solo se le cotejan con la lista de la demo (la retención sigue con la lista completa), y la ficha 360 da las listas solo con el permiso «riesgo»',
        JSON.stringify(rg).slice(0, 300));
    }

    /* --- g. Analítica con techo diario; métricas de la demo sin lo de los visitantes reales --- */
    {
      const an = json(`begin;
        insert into tumbo.topes_crecimiento as t (red, tipo, ventana, n)
        values ('*', 'analitica_dia', date_bin(interval '1 day', now(), timestamptz '2000-01-01'), 100000)
        on conflict (red, tipo, ventana) do update set n = 100000;
        select jsonb_build_object('lleno', public.tm_analitica_registrar('[{"tipo": "busqueda", "texto": "tope diario", "visitante": "integ2tope"}]'));
        rollback;`);
      const mt = jsonTodo(`begin;
        insert into tumbo.eventos_analitica (tipo, texto, visitante) values ('busqueda', 'repuestos corolla integ dos', 'integ2visit');
        insert into tumbo.eventos_analitica (tipo, visitante) values ('inicio_checkout', 'integ2visit');
        select jsonb_build_object('demo', public.tm_metricas_negocio(${lit(s.superadmin)}, '{}'));
        select jsonb_build_object('real', public.tm_metricas_negocio(${lit(s.r_admin)}, '{}'));
        rollback;`);
      const d = mt.demo || {}, r = mt.real || {};
      ok(an.lleno && an.lleno.limitado === true && Number(an.lleno.registrados) === 0,
        'la analítica tiene un techo diario (100.000 eventos) además del tope por minuto: lo que lo pasa se descarta en silencio', JSON.stringify(an));
      ok(d.solo_demo === true && Array.isArray(d.top_busquedas) && d.top_busquedas.length === 0 && (d.reservado || []).includes('top_busquedas') &&
         d.embudo && Number(d.embudo.busquedas) === 0 && Number(d.embudo.iniciaron_checkout) === 0 &&
         (r.top_busquedas || []).some((x) => x.texto === 'repuestos corolla integ dos'),
        'las métricas de la demo ya no traen las búsquedas ni el checkout de los visitantes reales (una cuenta real, sí)',
        JSON.stringify({ d: d.top_busquedas, e: d.embudo, res: d.reservado }).slice(0, 300));
    }

    /* --- h. ocultar_contacto con cifras de ancho completo y la I o la l por el 1 --- */
    {
      const oc = (t) => JSON.parse(psql(`select tumbo_privado.ocultar_contacto(${lit(t)})`));
      const a = oc('Escríbeme al ０４１４-５５５-１２３４'), b = oc('Llámame al 04I4 555 I234 o al O4l4|555|1234');
      const c = oc('Botella de 2l, guía MRW 123456, pedido TM-2026-00431, iPhone 12 Pro');
      let pub = '';
      try { psql(`select tumbo_privado.texto_publico(${lit('Tengo el mismo más barato, info al ０４１４５５５１２３４')}, 'la pregunta')`); } catch (e) { pub = e.message; }
      ok(a.ocultos.includes('telefono') && !/[０-９]{4}/.test(a.texto) && b.ocultos.includes('telefono') && !/I234|l4/.test(b.texto) &&
         c.ocultos.length === 0 && /No incluyas teléfonos/.test(pub),
        'ocultar_contacto reconoce las cifras de ancho completo y la I, la l o la barra en lugar del 1 (y deja las guías y los pedidos)',
        JSON.stringify([a, b, c]).slice(0, 300));
    }

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
