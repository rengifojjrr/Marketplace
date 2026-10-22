#!/usr/bin/env bash
# Borra todo lo de Tumbo en el Postgres local (esquemas tumbo y tumbo_privado
# y las funciones public.tm_*) y vuelve a aplicar supabase/migrations en
# orden. No toca nada más de la base. Uso: tools/supabase-local/reaplicar.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-54322}" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
drop schema if exists tumbo cascade;
drop schema if exists tumbo_privado cascade;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'tm\_%' loop
    execute format('drop function %s', f.firma);
  end loop;
end $$;
SQL

for f in "$RAIZ"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" -1 -f "$f" >/dev/null
done
"${PSQL[@]}" -c "notify pgrst, 'reload schema'" >/dev/null
echo "✓ migraciones aplicadas"
