#!/usr/bin/env bash
# Borra el esquema de Tumbo en el Postgres local y vuelve a aplicar todas las
# migraciones de supabase/migrations en orden. Uso: tools/supabase-local/reaplicar.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-54322}" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
drop schema if exists privado cascade;
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
delete from auth.identities;
delete from auth.users;
SQL

for f in "$RAIZ"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" -1 -f "$f"
done
"${PSQL[@]}" -c "notify pgrst, 'reload schema'" >/dev/null
echo "✓ migraciones aplicadas"
