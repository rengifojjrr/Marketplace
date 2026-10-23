#!/usr/bin/env node
/**
 * Corre todas las pruebas, una tras otra y con las mismas variables de
 * entorno, y resume el resultado.
 *
 *   node tools/verificar-todo.js [urlBase] [--sin-local] [--sin-remoto]
 *
 * Con TM_SUPABASE_URL y TM_SUPABASE_KEY (el backend):
 *   1. tools/verificar-rls.js y cada tools/api-*.js (permisos y reglas por la API);
 *   2. tools/verificar-beta.js y cada tools/e2e-*.js en el navegador, contra ese backend.
 * Con el sitio servido en local (urlBase localhost), además:
 *   3. verificar-beta.js y los e2e-*.js en modo local (datos en el navegador).
 * Sin backend solo corre el paso 3. Las suites reinician la demo del backend
 * que usan: contra uno que no es local hace falta TM_NUBE=1 (lo exige cada
 * suite). TM_PGDATABASE habilita las comprobaciones por SQL de las api-*.js.
 *
 * Ejemplo (stack local de tools/supabase-local/levantar.sh):
 *   K=$(node tools/supabase-local/pasarela.js --clave)
 *   NODE_PATH=$(npm root -g) TM_PGDATABASE=tumbo3 TM_SUPABASE_URL=http://127.0.0.1:54351 \
 *     TM_SUPABASE_KEY=$K node tools/verificar-todo.js http://localhost:8099
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) || 'http://localhost:8000';
const conBackend = !!(process.env.TM_SUPABASE_URL && process.env.TM_SUPABASE_KEY);
const sitioLocal = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE);
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const negrita = (s) => `\x1b[1m${s}\x1b[0m`;

const archivos = fs.readdirSync(DIR).sort();
const api = archivos.filter((f) => /^api-.+\.js$/.test(f));
const e2e = ['verificar-beta.js'].concat(archivos.filter((f) => /^e2e-.+\.js$/.test(f) && f !== 'e2e-comun.js'));

const pasos = [];
if (conBackend && !args.includes('--sin-remoto')) {
  ['verificar-rls.js'].concat(api).forEach((f) => pasos.push({ archivo: f, modo: 'API', args: [], env: process.env }));
  e2e.forEach((f) => pasos.push({ archivo: f, modo: 'remoto', args: [BASE], env: process.env }));
}
if ((!conBackend || sitioLocal) && !args.includes('--sin-local')) {
  if (!sitioLocal) {
    console.error('El modo local necesita el sitio servido en local (http://localhost:…).');
    process.exit(2);
  }
  /* sin backend: cada suite reemplaza tm-config.js por una configuración vacía */
  const env = Object.assign({}, process.env, { TM_LOCAL: '1' });
  delete env.TM_SUPABASE_URL;
  delete env.TM_SUPABASE_KEY;
  e2e.forEach((f) => pasos.push({ archivo: f, modo: 'local', args: [BASE], env }));
}
if (!pasos.length) { console.error('No hay nada que correr con esas opciones.'); process.exit(2); }

const resultados = [];
for (const paso of pasos) {
  const titulo = `${paso.archivo} (${paso.modo})`;
  console.log('\n' + negrita('══ ' + titulo + ' ══'));
  const inicio = Date.now();
  const r = spawnSync(process.execPath, [path.join(DIR, paso.archivo)].concat(paso.args), { stdio: 'inherit', env: paso.env });
  resultados.push({ titulo, ok: r.status === 0, segundos: Math.round((Date.now() - inicio) / 1000), codigo: r.status });
}

console.log('\n' + negrita('══ Resumen ══'));
const ancho = Math.max.apply(null, resultados.map((r) => r.titulo.length));
resultados.forEach((r) => {
  console.log((r.ok ? verde('✓ ') : rojo('✗ ')) + r.titulo.padEnd(ancho) + '  ' + String(r.segundos).padStart(4) + ' s' +
    (r.ok ? '' : rojo('  (salida ' + r.codigo + ')')));
});
const mal = resultados.filter((r) => !r.ok);
if (mal.length) {
  console.log(rojo(`\n${mal.length} de ${resultados.length} suites fallaron.`));
  process.exit(1);
}
console.log(verde(`\n✓ Las ${resultados.length} suites están en verde.`));
