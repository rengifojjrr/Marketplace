#!/usr/bin/env bash
# =========================================================================
# Tumbo Market — entorno local por equipo (sin Docker)
# -------------------------------------------------------------------------
#   tools/supabase-local/levantar.sh <base> <puerto-postgrest> <puerto-pasarela>
#   tools/supabase-local/levantar.sh parar <puerto-postgrest> <puerto-pasarela>
#
# Arranca Postgres 16 (:54322) si hace falta, crea la base si no existe con
# lo que un proyecto Supabase trae por base (roles de la API, esquema
# extensions con pgcrypto, privilegios y un Storage mínimo: ver base.sql),
# vuelve a aplicar todas las migraciones (reaplicar.sh), escribe la
# configuración de PostgREST y (re)arranca PostgREST y la pasarela en esos
# puertos (la pasarela hace también de Storage y de la función
# tumbo-archivos). Al final imprime la clave anon. Cada equipo usa su base y
# sus puertos (ver docs/PLAN-PRODUCCION.md), p. ej. la ola 0:
#
#   tools/supabase-local/levantar.sh tumbo3 54350 54351
#   python3 -m http.server 8099 --bind 127.0.0.1
#   K=$(node tools/supabase-local/pasarela.js --clave)
#   NODE_PATH=$(npm root -g) TM_PGDATABASE=tumbo3 TM_SUPABASE_URL=http://127.0.0.1:54351 \
#     TM_SUPABASE_KEY=$K node tools/verificar-todo.js http://localhost:8099
#
# Solo detiene lo que él mismo arrancó (por su PID); si otro proceso ocupa
# un puerto, avisa y no toca nada.
# =========================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="${TM_STACK:-$HOME/.cache/tumbo-supabase}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATOS="${TM_PGDATA:-/var/lib/postgresql/tumbo}"
PGPUERTO="${PGPORT:-54322}"
SECRETO="local-only-secret-for-tests-0123456789abcdef"
V_PGRST="v12.2.3"

uso() {
  echo "Uso: $0 <base> <puerto-postgrest> <puerto-pasarela>" >&2
  echo "     $0 parar <puerto-postgrest> <puerto-pasarela>" >&2
  exit 2
}
responde() { [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$1/" || true)" != "000" ]; }
# Detiene lo que este script arrancó en ese puerto.
detener() {
  local f="$CACHE/pids/$1.pid" pid
  [ -f "$f" ] || return 0
  pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  fi
  rm -f "$f"
}

[ $# -eq 3 ] || uso
mkdir -p "$CACHE/pids"
if [ "$1" = "parar" ]; then
  detener "$2"; detener "$3"
  echo "✓ detenidos PostgREST :$2 y la pasarela :$3"
  exit 0
fi
BASE="$1"; PGRST="$2"; PASARELA="$3"
[[ "$BASE" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "El nombre de la base solo admite minúsculas, números y _." >&2; exit 2; }
[[ "$PGRST" =~ ^[0-9]+$ && "$PASARELA" =~ ^[0-9]+$ ]] || uso

# --- Postgres ---------------------------------------------------------------
if [ ! -f "$DATOS/PG_VERSION" ]; then
  echo "→ creando el clúster en $DATOS"
  mkdir -p "$DATOS" && chown postgres:postgres "$DATOS"
  su postgres -c "$PG_BIN/initdb -D $DATOS -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
fi
if ! su postgres -c "$PG_BIN/pg_ctl -D $DATOS status" >/dev/null 2>&1; then
  echo "→ arrancando Postgres en :$PGPUERTO"
  su postgres -c "$PG_BIN/pg_ctl -D $DATOS -l $DATOS/../tumbo.log -o '-p $PGPUERTO -k /tmp' -w start" >/dev/null
fi
PSQL=(env PGOPTIONS="-c client_min_messages=warning" psql -h /tmp -p "$PGPUERTO" -U postgres -v ON_ERROR_STOP=1 -q -X)
if [ -z "$("${PSQL[@]}" -d postgres -Atc "select 1 from pg_database where datname = '$BASE'")" ]; then
  echo "→ creando la base $BASE"
  "${PSQL[@]}" -d postgres -c "create database \"$BASE\""
fi
"${PSQL[@]}" -d "$BASE" -f "$RAIZ/tools/supabase-local/base.sql" >/dev/null

# --- Migraciones --------------------------------------------------------------
PGDATABASE="$BASE" PGPORT="$PGPUERTO" PGHOST=/tmp "$RAIZ/tools/supabase-local/reaplicar.sh"

# --- PostgREST y pasarela -----------------------------------------------------
if [ ! -x "$CACHE/postgrest" ]; then
  echo "→ descargando PostgREST $V_PGRST"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$V_PGRST/postgrest-$V_PGRST-linux-static-x64.tar.xz" | tar -xJ -C "$CACHE"
fi
detener "$PGRST"
detener "$PASARELA"
for p in "$PGRST" "$PASARELA"; do
  if responde "$p"; then
    echo "El puerto $p está ocupado por otro proceso: libéralo o elige otro puerto." >&2
    exit 1
  fi
done
CONF="$CACHE/postgrest-$BASE-$PGRST.conf"
cat > "$CONF" <<EOF
db-uri = "postgres://authenticator:local@127.0.0.1:$PGPUERTO/$BASE"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRETO"
server-host = "127.0.0.1"
server-port = $PGRST
db-channel-enabled = true
log-level = "error"
EOF
# (comandos simples en segundo plano: el PID guardado es el del proceso y
# ningún subshell se queda con la salida de este script)
cd "$RAIZ"
nohup "$CACHE/postgrest" "$CONF" > "$CACHE/postgrest-$PGRST.log" 2>&1 < /dev/null &
echo $! > "$CACHE/pids/$PGRST.pid"
PUERTO="$PASARELA" PGRST_PORT="$PGRST" PGDATABASE="$BASE" PGPORT="$PGPUERTO" PGHOST=/tmp JWT_SECRET="$SECRETO" \
  nohup node tools/supabase-local/pasarela.js > "$CACHE/pasarela-$PASARELA.log" 2>&1 < /dev/null &
echo $! > "$CACHE/pids/$PASARELA.pid"
for _ in $(seq 1 50); do
  if responde "$PGRST" && responde "$PASARELA"; then break; fi
  sleep 0.2
done
if ! responde "$PGRST" || ! responde "$PASARELA"; then
  echo "PostgREST o la pasarela no arrancaron: revisa $CACHE/postgrest-$PGRST.log y $CACHE/pasarela-$PASARELA.log" >&2
  exit 1
fi
echo "✓ Tumbo local: base $BASE · PostgREST :$PGRST · pasarela http://127.0.0.1:$PASARELA"
echo "  clave anon: $(JWT_SECRET="$SECRETO" node tools/supabase-local/pasarela.js --clave)"
