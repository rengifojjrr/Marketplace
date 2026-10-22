#!/usr/bin/env bash
# =========================================================================
# Tumbo Market — Supabase mínimo en local (sin Docker)
# -------------------------------------------------------------------------
# Levanta lo justo para probar el backend real de la beta:
#   Postgres 16 (:54322) + GoTrue/Auth (:54331) + PostgREST (:54330)
#   + pasarela con la forma de URL de Supabase (:54321)
# y aplica supabase/migrations. Requiere postgresql-16 instalado y node.
#
#   tools/supabase-local/iniciar.sh         # arranca (descarga binarios la 1.ª vez)
#   tools/supabase-local/iniciar.sh parar   # detiene todo
#
# Después:
#   TM_SUPABASE_URL=http://127.0.0.1:54321 \
#   TM_SUPABASE_KEY=$(node tools/supabase-local/pasarela.js --clave) \
#   node tools/verificar-beta.js http://127.0.0.1:8099
# =========================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="${TM_STACK:-$HOME/.cache/tumbo-supabase}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATOS="${TM_PGDATA:-/var/lib/postgresql/tumbo}"
SECRETO="local-only-secret-for-tests-0123456789abcdef"
V_PGRST="v12.2.3"
V_AUTH="v2.180.0"
mkdir -p "$CACHE"

if [ "${1:-}" = "parar" ]; then
  pkill -f "$CACHE/postgrest" 2>/dev/null || true
  pkill -f "$CACHE/gotrue/auth serve" 2>/dev/null || true
  pkill -f "supabase-local/pasarela.js" 2>/dev/null || true
  su postgres -c "$PG_BIN/pg_ctl -D $DATOS stop" 2>/dev/null || true
  echo "✓ detenido"; exit 0
fi

# --- binarios -------------------------------------------------------------
if [ ! -x "$CACHE/postgrest" ]; then
  echo "→ descargando PostgREST $V_PGRST"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$V_PGRST/postgrest-$V_PGRST-linux-static-x64.tar.xz" | tar -xJ -C "$CACHE"
fi
if [ ! -x "$CACHE/gotrue/auth" ]; then
  echo "→ descargando Supabase Auth $V_AUTH"
  mkdir -p "$CACHE/gotrue"
  curl -sSL "https://github.com/supabase/auth/releases/download/$V_AUTH/auth-$V_AUTH-x86.tar.gz" | tar -xz -C "$CACHE/gotrue"
fi

# --- Postgres ---------------------------------------------------------------
NUEVO=0
if [ ! -f "$DATOS/PG_VERSION" ]; then
  echo "→ creando el clúster en $DATOS"
  mkdir -p "$DATOS" && chown postgres:postgres "$DATOS"
  su postgres -c "$PG_BIN/initdb -D $DATOS -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
  NUEVO=1
fi
if ! su postgres -c "$PG_BIN/pg_ctl -D $DATOS status" >/dev/null 2>&1; then
  su postgres -c "$PG_BIN/pg_ctl -D $DATOS -l $DATOS/../tumbo.log -o '-p 54322 -k /tmp' start" >/dev/null
  sleep 2
fi
PSQL=(psql -h /tmp -p 54322 -U postgres -v ON_ERROR_STOP=1 -q)
if [ "$NUEVO" = 1 ]; then
  "${PSQL[@]}" -f "$RAIZ/tools/supabase-local/bootstrap.sql" 2>/dev/null
fi

# --- Auth (crea el esquema auth con sus propias migraciones) ---------------
cat > "$CACHE/gotrue.env" <<EOF
GOTRUE_API_HOST=127.0.0.1
PORT=54331
API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL='postgres://supabase_auth_admin:local@127.0.0.1:54322/postgres?search_path=auth&sslmode=disable'
GOTRUE_SITE_URL=http://127.0.0.1:8099
GOTRUE_JWT_SECRET=$SECRETO
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_DISABLE_SIGNUP=false
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_DB_MIGRATIONS_PATH=$CACHE/gotrue/migrations
GOTRUE_LOG_LEVEL=warn
EOF
(cd "$CACHE/gotrue" && set -a && . "$CACHE/gotrue.env" && set +a && ./auth migrate >/dev/null 2>&1)
if ! curl -sf http://127.0.0.1:54331/health >/dev/null; then
  (cd "$CACHE/gotrue" && set -a && . "$CACHE/gotrue.env" && set +a && nohup ./auth serve > "$CACHE/gotrue.log" 2>&1 &)
fi

# --- Esquema de Tumbo -------------------------------------------------------
if [ "$NUEVO" = 1 ] || [ "${TM_REAPLICAR:-0}" = 1 ]; then
  "$RAIZ/tools/supabase-local/reaplicar.sh"
fi

# --- PostgREST y pasarela ---------------------------------------------------
cat > "$CACHE/postgrest.conf" <<EOF
db-uri = "postgres://authenticator:local@127.0.0.1:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRETO"
server-host = "127.0.0.1"
server-port = 54330
db-channel-enabled = true
log-level = "error"
EOF
if ! curl -sf http://127.0.0.1:54330/ >/dev/null; then
  (cd "$CACHE" && nohup ./postgrest postgrest.conf > postgrest.log 2>&1 &)
fi
if ! curl -s http://127.0.0.1:54321/ >/dev/null; then
  (cd "$RAIZ" && JWT_SECRET="$SECRETO" nohup node tools/supabase-local/pasarela.js > "$CACHE/pasarela.log" 2>&1 &)
fi
sleep 2
echo "✓ Supabase local en http://127.0.0.1:54321"
echo "  clave anon: $(cd "$RAIZ" && JWT_SECRET="$SECRETO" node tools/supabase-local/pasarela.js --clave)"
