#!/usr/bin/env bash
# Borra todo lo de Tumbo en el Postgres local (tools/retirar-tumbo.sql) y
# vuelve a aplicar supabase/migrations en orden. No toca nada más de la base.
# Uso: [PGDATABASE=…] tools/supabase-local/reaplicar.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(env PGOPTIONS="-c client_min_messages=warning" psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-54322}" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f "$RAIZ/tools/retirar-tumbo.sql" >/dev/null

for f in "$RAIZ"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" -1 -f "$f" >/dev/null
done
"${PSQL[@]}" -c "notify pgrst, 'reload schema'" >/dev/null
echo "✓ migraciones aplicadas"
