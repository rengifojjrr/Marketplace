#!/usr/bin/env bash
# =========================================================================
# Tumbo Market — respaldo y restauración de la base (esquemas tumbo y
# tumbo_privado, las funciones public.tm_* y los buckets de Tumbo)
# -------------------------------------------------------------------------
#   tools/respaldo.sh volcar <url-de-la-base> <archivo.tar>
#   tools/respaldo.sh restaurar <archivo.tar> <url-de-la-base-destino>
#   tools/respaldo.sh simulacro <base-local-de-origen>
#
# volcar     pg_dump (formato custom) de tumbo y tumbo_privado con sus datos y
#            privilegios, el SQL de las funciones public.tm_* con sus permisos,
#            los buckets de Storage de Tumbo y un manifiesto (fecha, versión y
#            filas por tabla), en un .tar. No guarda los archivos de Storage
#            (solo sus filas): ver docs/PRODUCCION.md.
# restaurar  en una base SIN Tumbo (un proyecto nuevo, o uno donde se corrió
#            tools/retirar-tumbo.sql): crea las extensiones que usa, restaura
#            los esquemas (los disparadores de la auditoría se crean después
#            de los datos), las funciones tm_* y los buckets, comprueba las
#            filas contra el manifiesto y, si hay pg_cron, vuelve a programar
#            las tareas. Se detiene si la base ya tiene Tumbo.
# simulacro  el ensayo completo en local: vuelca la base de origen, crea una
#            base nueva como la de un proyecto Supabase (base.sql), restaura,
#            comprueba que coincide fila por fila, que se puede entrar y que
#            la auditoría sigue siendo inmutable, y borra la base del ensayo.
#
# Las URL son de libpq (postgresql://usuario:clave@host:puerto/base). En
# Supabase, la de «Connection string → Session pooler» o la directa, con el
# usuario postgres. PGBIN elige otro pg_dump (el de la versión del servidor o
# más nueva): PGBIN=/usr/lib/postgresql/17/bin.
# =========================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PGBIN:+$PGBIN/}"
PSQL_OPC=(-X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

# Lo temporal (carpetas y la base del simulacro) se borra al salir, pase lo que pase.
TEMPORALES=()
ENSAYO_URL=""
ENSAYO=""
limpiar() {
  local d
  for d in "${TEMPORALES[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done
  if [ -n "$ENSAYO" ]; then
    "${BIN}psql" -X -q -d "$ENSAYO_URL" -c "drop database if exists \"$ENSAYO\"" > /dev/null 2>&1 || true
  fi
}
trap limpiar EXIT
temporal() { TMP="$(mktemp -d)"; TEMPORALES+=("$TMP"); }

uso() {
  sed -n '6,9p' "$0" | sed 's/^# //' >&2
  exit 2
}
falla() { echo "respaldo: $*" >&2; exit 1; }

# Filas por tabla de tumbo y tumbo_privado (conteo exacto), una por línea.
filas() {
  "${BIN}psql" "${PSQL_OPC[@]}" -At -d "$1" -c "
    select format('select %L || ''='' || count(*) from %I.%I;', n.nspname || '.' || c.relname, n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('tumbo', 'tumbo_privado') and c.relkind in ('r', 'p')
    order by 1" | "${BIN}psql" "${PSQL_OPC[@]}" -At -d "$1"
}

volcar() {
  local url="$1" salida="$2" tmp
  [ -n "$url" ] && [ -n "$salida" ] || uso
  temporal; tmp="$TMP"
  if [ -z "$("${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" -c "select 1 where to_regnamespace('tumbo') is not null")" ]; then
    falla "esa base no tiene el esquema tumbo"
  fi
  echo "→ volcando tumbo y tumbo_privado"
  "${BIN}pg_dump" --dbname="$url" --schema=tumbo --schema=tumbo_privado --format=custom --no-owner \
    --compress=9 --file="$tmp/esquemas.dump"
  echo "→ funciones public.tm_* y buckets"
  "${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" > "$tmp/funciones.sql" <<'SQL'
select '-- Funciones public.tm_* de Tumbo Market (respaldo)';
select pg_get_functiondef(p.oid) || ';' from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname like 'tm\_%' order by p.oid::regprocedure::text;
select format('revoke execute on function %s from public;', p.oid::regprocedure)
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tm\_%';
select format('grant execute on function %s to %s;', p.oid::regprocedure, string_agg(quote_ident(r.rolname), ', '))
from pg_proc p cross join pg_roles r
where p.pronamespace = 'public'::regnamespace and p.proname like 'tm\_%'
  and r.rolname in ('anon', 'authenticated', 'service_role') and has_function_privilege(r.oid, p.oid, 'execute')
group by p.oid;
SQL
  "${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" > "$tmp/buckets.sql" <<'SQL'
select format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %L, %s, %L) on conflict (id) do nothing;',
              b.id, b.name, b.public, coalesce(b.file_size_limit::text, 'null'), b.allowed_mime_types)
from storage.buckets b where to_regclass('storage.buckets') is not null and b.id like 'tumbo-%';
SQL
  {
    echo "fecha=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "pg_dump=$("${BIN}pg_dump" --version)"
    echo "servidor=$("${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" -c 'show server_version')"
    echo "funciones_tm=$(grep -c '^CREATE OR REPLACE FUNCTION public.tm_' "$tmp/funciones.sql" || true)"
    filas "$url"
  } > "$tmp/manifiesto.txt"
  tar -C "$tmp" -cf "$salida" esquemas.dump funciones.sql buckets.sql manifiesto.txt
  echo "✓ respaldo en $salida ($(du -h "$salida" | cut -f1)) · $(grep -c '=' "$tmp/manifiesto.txt") líneas de manifiesto"
}

restaurar() {
  local archivo="$1" url="$2" tmp
  [ -f "$archivo" ] && [ -n "$url" ] || uso
  temporal; tmp="$TMP"
  tar -C "$tmp" -xf "$archivo"
  [ -f "$tmp/esquemas.dump" ] && [ -f "$tmp/manifiesto.txt" ] || falla "$archivo no es un respaldo de Tumbo"
  if [ -n "$("${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" -c "select 1 where to_regnamespace('tumbo') is not null or to_regnamespace('tumbo_privado') is not null")" ]; then
    falla "la base de destino ya tiene Tumbo: restaura en un proyecto nuevo o retíralo antes (tools/retirar-tumbo.sql)"
  fi
  echo "→ extensiones"
  "${BIN}psql" "${PSQL_OPC[@]}" -d "$url" -c "create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create extension if not exists pg_trgm with schema extensions;
    create extension if not exists unaccent with schema extensions;"
  echo "→ esquemas tumbo y tumbo_privado"
  "${BIN}pg_restore" --dbname="$url" --no-owner --exit-on-error "$tmp/esquemas.dump"
  echo "→ funciones public.tm_* y buckets"
  "${BIN}psql" "${PSQL_OPC[@]}" -d "$url" -1 -f "$tmp/funciones.sql" > /dev/null
  if [ -s "$tmp/buckets.sql" ]; then
    if [ -n "$("${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" -c "select 1 where to_regclass('storage.buckets') is not null")" ]; then
      "${BIN}psql" "${PSQL_OPC[@]}" -d "$url" -1 -f "$tmp/buckets.sql" > /dev/null
    else
      echo "· la base de destino no tiene Storage: los buckets no se crearon" >&2
    fi
  fi
  echo "→ comprobando las filas"
  grep -E '^tumbo(_privado)?\.' "$tmp/manifiesto.txt" | sort > "$tmp/origen.txt"
  filas "$url" | sort > "$tmp/destino.txt"
  if ! diff -u "$tmp/origen.txt" "$tmp/destino.txt" > "$tmp/diferencias.txt"; then
    cat "$tmp/diferencias.txt" >&2
    falla "las filas restauradas no coinciden con el respaldo"
  fi
  local esperadas reales
  esperadas="$(sed -n 's/^funciones_tm=//p' "$tmp/manifiesto.txt")"
  reales="$("${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'tm\_%'")"
  [ "$esperadas" = "$reales" ] || falla "se esperaban $esperadas funciones tm_* y hay $reales"
  "${BIN}psql" "${PSQL_OPC[@]}" -d "$url" -c "notify pgrst, 'reload schema'" > /dev/null
  if [ -n "$("${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" -c "select 1 from pg_extension where extname = 'pg_cron'")" ]; then
    echo "→ pg_cron: programando las tareas"
    "${BIN}psql" "${PSQL_OPC[@]}" -At -d "$url" -c "select tumbo_privado.programar_tareas()" > /dev/null
  fi
  echo "✓ restaurado: $(wc -l < "$tmp/origen.txt") tablas con las mismas filas y $reales funciones tm_*"
}

simulacro() {
  local origen="$1" puerto="${PGPORT:-54322}" host="${PGHOST:-/tmp}" ensayo archivo
  [[ "$origen" =~ ^[a-z_][a-z0-9_]*$ ]] || uso
  ensayo="tumbo_simulacro_$$"
  temporal; archivo="$TMP/respaldo.tar"
  local u_origen="postgresql:///$origen?host=$host&port=$puerto&user=postgres"
  local u_ensayo="postgresql:///$ensayo?host=$host&port=$puerto&user=postgres"
  volcar "$u_origen" "$archivo"
  echo "→ base nueva $ensayo, como la de un proyecto Supabase"
  ENSAYO_URL="postgresql:///postgres?host=$host&port=$puerto&user=postgres"
  "${BIN}psql" "${PSQL_OPC[@]}" -d "$ENSAYO_URL" -c "create database \"$ensayo\""
  ENSAYO="$ensayo"
  PGOPTIONS="-c client_min_messages=warning" "${BIN}psql" "${PSQL_OPC[@]}" -d "$u_ensayo" -f "$RAIZ/tools/supabase-local/base.sql" > /dev/null
  restaurar "$archivo" "$u_ensayo"
  echo "→ la base restaurada funciona"
  local acceso inmutable
  acceso="$("${BIN}psql" "${PSQL_OPC[@]}" -At -d "$u_ensayo" -c "select (public.tm_acceder('comprador@demo.ve', 'demo1234') ->> 'sesion') is not null")"
  [ "$acceso" = "t" ] || falla "no se pudo entrar con la cuenta demo en la base restaurada"
  inmutable="$("${BIN}psql" -X -q -At -d "$u_ensayo" -c "delete from tumbo.auditoria where id = (select min(id) from tumbo.auditoria)" 2>&1 || true)"
  [[ "$inmutable" =~ (ERROR|no se puede|inmutable|not allowed) ]] || falla "la auditoría restaurada se pudo borrar: $inmutable"
  echo "✓ simulacro de restauración completo (origen $origen)"
}

[ $# -ge 1 ] || uso
case "$1" in
  volcar) shift; [ $# -eq 2 ] || uso; volcar "$1" "$2" ;;
  restaurar) shift; [ $# -eq 2 ] || uso; restaurar "$1" "$2" ;;
  simulacro) shift; [ $# -eq 1 ] || uso; simulacro "$1" ;;
  *) uso ;;
esac
