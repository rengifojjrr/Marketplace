#!/usr/bin/env node
// =========================================================================
// Tumbo Market — parte una migración .sql en trozos aplicables por separado
// -------------------------------------------------------------------------
//   node tools/supabase-local/partir-migracion.js <archivo.sql> <directorio> [--max BYTES] [--conservar K]
//
// Escribe <directorio>/<migración>/p01.sql, p02.sql, … (la migración es el
// nombre del archivo sin .sql) de como máximo --max bytes (35 KB por omisión)
// cada uno, cortando SOLO entre sentencias de nivel superior, y comprueba que
// la concatenación de los trozos, leídos de vuelta del disco, reproduce el
// archivo original byte a byte. Una sentencia que sola pase del máximo va en
// su propio trozo y se avisa de su tamaño.
//
// --conservar K deja como están los K primeros trozos que ya haya en el
// directorio (p. ej. ya aplicados en la nube) y reparte solo el resto con el
// --max indicado, numerando desde K+1. Comprueba antes que esos K trozos son
// un prefijo exacto del archivo y que terminan entre dos sentencias.
// (La API de Supabase rechazó una llamada de ~35,3 KB y aceptó una de
// ~34,9 KB: para aplicar por ella conviene --max 30000.)
//
// El analizador respeta lo que psql respeta al buscar el ; que cierra una
// sentencia: comentarios -- y /* */ (anidables), cadenas '…' con '' escapada,
// cadenas E'…' con \ escapada, identificadores "…" con "" escapada, bloques
// con comillas dólar ($$ y $etiqueta$) y paréntesis. Trabaja sobre los bytes
// (latin1: un carácter por byte), así que los cortes y los tamaños son
// exactos aunque el archivo tenga UTF-8.
//
// Sirve para aplicar migraciones grandes por la API de Supabase (que limita
// el tamaño de cada llamada): cada trozo se aplica como una migración propia,
// en orden. Una migración que dependa de estado de sesión entre sentencias
// (set, tablas temporales) no se puede partir así: pruébalo antes en local
// aplicando cada trozo con psql -1 -f.
// =========================================================================
'use strict';
const fs = require('fs');
const path = require('path');

function uso() {
  console.error('Uso: node tools/supabase-local/partir-migracion.js <archivo.sql> <directorio> [--max BYTES]');
  process.exit(2);
}

// Carácter que puede formar parte de un identificador (o de la etiqueta de
// unas comillas dólar). Los bytes ≥ 0x80 cuentan como letras, como en Postgres.
const esIdent = (c) => /[A-Za-z0-9_]/.test(c) || c.charCodeAt(0) >= 0x80;
const esInicioIdent = (c) => /[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80;

// Devuelve las sentencias de nivel superior como [inicio, fin) sobre el texto.
// Cada una va desde el final de la anterior hasta su ; (más los espacios y el
// comentario -- que sigan en la misma línea, y el salto de línea). Lo que
// quede tras el último ; (espacios, comentarios) se suma a la última.
function sentencias(t) {
  const n = t.length;
  const res = [];
  let i = 0;
  let inicio = 0;
  let parentesis = 0;
  let hayCodigo = false; // ¿hay algo más que espacios y comentarios desde el inicio?
  while (i < n) {
    const c = t[i];
    const d = i + 1 < n ? t[i + 1] : '';
    if (c === '-' && d === '-') {
      const fin = t.indexOf('\n', i);
      i = fin < 0 ? n : fin + 1;
      continue;
    }
    if (c === '/' && d === '*') {
      let prof = 1;
      i += 2;
      while (i < n && prof > 0) {
        if (t[i] === '/' && t[i + 1] === '*') { prof++; i += 2; }
        else if (t[i] === '*' && t[i + 1] === '/') { prof--; i += 2; }
        else i++;
      }
      if (prof > 0) throw new Error('comentario /* sin cerrar');
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    hayCodigo = true;
    if (c === "'") {
      // ¿cadena E'…'? (la E no debe ser el final de un identificador)
      const conEscape = i > 0 && (t[i - 1] === 'E' || t[i - 1] === 'e') && !(i > 1 && esIdent(t[i - 2]));
      i++;
      for (;;) {
        if (i >= n) throw new Error('cadena sin cerrar');
        if (conEscape && t[i] === '\\') { i += 2; continue; }
        if (t[i] === "'") {
          if (t[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      i++;
      for (;;) {
        if (i >= n) throw new Error('identificador "…" sin cerrar');
        if (t[i] === '"') {
          if (t[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '$' && !(i > 0 && (esIdent(t[i - 1]) || t[i - 1] === '$'))) {
      // ¿comillas dólar? $$ o $etiqueta$ (la etiqueta no empieza por dígito:
      // $1 es un parámetro)
      let j = i + 1;
      if (j < n && esInicioIdent(t[j])) {
        while (j < n && esIdent(t[j])) j++;
      }
      if (j < n && t[j] === '$') {
        const etiqueta = t.slice(i, j + 1);
        const cierre = t.indexOf(etiqueta, j + 1);
        if (cierre < 0) throw new Error(`bloque ${etiqueta} sin cerrar (byte ${i})`);
        i = cierre + etiqueta.length;
        continue;
      }
      i++;
      continue;
    }
    if (c === '(') { parentesis++; i++; continue; }
    if (c === ')') { if (parentesis > 0) parentesis--; i++; continue; }
    if (c === ';' && parentesis === 0) {
      i++;
      // el resto de la línea va con esta sentencia si son espacios o un --
      let j = i;
      while (j < n && (t[j] === ' ' || t[j] === '\t')) j++;
      if (t[j] === '-' && t[j + 1] === '-') {
        const fin = t.indexOf('\n', j);
        i = fin < 0 ? n : fin + 1;
      } else if (t[j] === '\r' && t[j + 1] === '\n') {
        i = j + 2;
      } else if (t[j] === '\n') {
        i = j + 1;
      }
      res.push([inicio, i]);
      inicio = i;
      hayCodigo = false;
      continue;
    }
    i++;
  }
  if (inicio < n) {
    if (hayCodigo) throw new Error('el archivo termina con una sentencia sin ;');
    if (res.length) res[res.length - 1][1] = n;
    else res.push([inicio, n]);
  }
  return res;
}

// Agrupa las sentencias en trozos de como máximo `max` bytes, a partir del
// byte `desde` (que debe ser el comienzo de una sentencia).
function trozos(t, max, desde = 0) {
  const res = [];
  const grandes = [];
  let actual = null;
  const todas = sentencias(t);
  if (desde > 0 && !todas.some(([a]) => a === desde)) {
    throw new Error(`el byte ${desde} no es el comienzo de una sentencia de nivel superior`);
  }
  for (const [a, b] of todas) {
    if (a < desde) continue;
    const tam = b - a;
    if (tam > max) {
      if (actual) res.push(actual);
      res.push({ inicio: a, fin: b, sentencias: 1 });
      grandes.push({ trozo: res.length, bytes: tam, linea: t.slice(0, a).split('\n').length });
      actual = null;
      continue;
    }
    if (actual && b - actual.inicio <= max) {
      actual.fin = b;
      actual.sentencias++;
    } else {
      if (actual) res.push(actual);
      actual = { inicio: a, fin: b, sentencias: 1 };
    }
  }
  if (actual) res.push(actual);
  return { res, grandes };
}

function main() {
  const args = process.argv.slice(2);
  let max = 35 * 1024;
  let conservar = 0;
  const pos = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '--max') max = Number(args[++k]);
    else if (args[k] === '--conservar') conservar = Number(args[++k]);
    else pos.push(args[k]);
  }
  if (pos.length !== 2 || !Number.isInteger(max) || max < 1024 || !Number.isInteger(conservar) || conservar < 0) uso();
  const [archivo, dirBase] = pos;
  const original = fs.readFileSync(archivo);
  const t = original.toString('latin1');
  const nombre = path.basename(archivo).replace(/\.sql$/, '');
  const dir = path.join(dirBase, nombre);
  fs.mkdirSync(dir, { recursive: true });

  // Los trozos que se conservan: deben ser p01…pK y un prefijo exacto.
  const existentes = fs.readdirSync(dir).filter((f) => /^p\d+\.sql$/.test(f)).sort((x, y) => parseInt(x.slice(1), 10) - parseInt(y.slice(1), 10));
  const conservados = existentes.slice(0, conservar);
  if (conservados.length !== conservar || conservados.some((f, k) => parseInt(f.slice(1), 10) !== k + 1)) {
    console.error(`✗ ${nombre}: no están los trozos p01…p${conservar} que se pidió conservar`);
    process.exit(1);
  }
  const prefijo = Buffer.concat(conservados.map((f) => fs.readFileSync(path.join(dir, f))));
  if (!original.subarray(0, prefijo.length).equals(prefijo)) {
    console.error(`✗ ${nombre}: los trozos conservados no son un prefijo exacto del archivo`);
    process.exit(1);
  }
  for (const f of existentes.slice(conservar)) fs.unlinkSync(path.join(dir, f));

  const { res, grandes } = trozos(t, max, prefijo.length);
  const total = conservar + res.length;
  const ancho = Math.max(2, String(total).length);
  const archivos = conservados.map((f) => path.join(dir, f)).concat(res.map((tr, k) => {
    const f = path.join(dir, `p${String(conservar + k + 1).padStart(ancho, '0')}.sql`);
    fs.writeFileSync(f, Buffer.from(t.slice(tr.inicio, tr.fin), 'latin1'));
    return f;
  }));

  // Comprobación: la concatenación, leída del disco, es el original exacto.
  const junto = Buffer.concat(archivos.map((f) => fs.readFileSync(f)));
  if (!junto.equals(original)) {
    console.error(`✗ ${nombre}: la concatenación de los trozos NO reproduce el original`);
    process.exit(1);
  }
  console.log(`${nombre}: ${original.length} bytes → ${total} trozos (máx. ${max} bytes${conservar ? `; ${conservar} conservados` : ''}) en ${dir}`);
  conservados.forEach((f) => {
    console.log(`  ${f}  ${String(fs.statSync(path.join(dir, f)).size).padStart(6)} bytes  (conservado)`);
  });
  res.forEach((tr, k) => {
    console.log(`  ${path.basename(archivos[conservar + k])}  ${String(tr.fin - tr.inicio).padStart(6)} bytes  ${String(tr.sentencias).padStart(3)} sentencias`);
  });
  for (const g of grandes) {
    console.log(`  ⚠ el trozo p${String(conservar + g.trozo).padStart(ancho, '0')} es una sola sentencia de ${g.bytes} bytes (línea ${g.linea}): pasa del máximo`);
  }
  console.log('  ✓ la concatenación reproduce el original byte a byte');
}

if (require.main === module) main();
module.exports = { sentencias, trozos };
