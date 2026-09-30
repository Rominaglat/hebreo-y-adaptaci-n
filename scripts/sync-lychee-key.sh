#!/usr/bin/env bash
# Loads the Lychee API key from .env into Supabase Vault (secret 'lychee_api_key'),
# where the monthly survey WhatsApp sender (migration 20260930120000) reads it.
# Along the way it proves the key works and prints what the sender needs to know:
# the connected WhatsApp numbers and the survey_clients template (language +
# the order of its {{1}}/{{2}} variables).
#
#   scripts/sync-lychee-key.sh                 # uses ./.env
#   ENV_FILE=../other/.env scripts/sync-lychee-key.sh
#
# Reads from the env file: LYCHEE_API_KEY, SUPABASE_DB_PASSWORD, optional LYCHEE_CHANNEL_ID.
# Does NOT enable sending — that stays a deliberate
#   UPDATE public.survey_whatsapp_config SET enabled = true;
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
val() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"; }

KEY="$(val LYCHEE_API_KEY)"
[ -n "$KEY" ] || { echo "LYCHEE_API_KEY is empty in $ENV_FILE" >&2; exit 1; }
export PGPASSWORD="$(val SUPABASE_DB_PASSWORD)"
# Session pooler — the direct db host is IPv6-only.
DB="host=aws-1-ap-northeast-2.pooler.supabase.com port=5432 user=postgres.gmepopxxvgcwiqlkpuwd dbname=postgres sslmode=require"
BASE="https://app.lychee-ltd.com/api/wap"

lychee_get() {
  local out code
  out="$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/$1")"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  if [ "$code" != 200 ]; then echo "Lychee $1 → HTTP $code: $out" >&2; exit 1; fi
  printf '%s' "$out"
}

echo "→ Checking the key against Lychee (channels)…"
CHANNELS="$(lychee_get make-channels)"
printf '%s' "$CHANNELS" | python3 -m json.tool --no-ensure-ascii

echo "→ The survey_clients template:"
# Lychee lists only Meta-APPROVED templates, and only name/language/category —
# never the body, so the {{1}}/{{2}} order can't be checked from here.
TEMPLATE_LANG="$(lychee_get make-templates | python3 -c '
import sys, json
d = json.load(sys.stdin)
items = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
hits = [t for t in items if t.get("name") == "survey_clients"]
if hits:
    print(json.dumps(hits, ensure_ascii=False, indent=2), file=sys.stderr)
    print(hits[0].get("language", ""))
else:
    print("  NOT APPROVED YET (or named differently). Approved: " + ", ".join(str(t.get("name")) for t in items), file=sys.stderr)
')"

CHANNEL="$(val LYCHEE_CHANNEL_ID)"
if [ -z "$CHANNEL" ]; then
  CHANNEL="$(printf '%s' "$CHANNELS" | python3 -c '
import sys, json
d = json.load(sys.stdin)
items = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
print(items[0].get("id", "") if len(items) == 1 else "")
')"
fi

echo "→ Storing the key in Supabase Vault…"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -v key="$KEY" -v channel="$CHANNEL" -v lang="$TEMPLATE_LANG" <<'SQL'
DO $do$ BEGIN
  IF to_regclass('public.survey_whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20260930120000_survey_whatsapp_reminder.sql first';
  END IF;
END $do$;
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'lychee_api_key')
    THEN (SELECT vault.update_secret(id, :'key') FROM vault.secrets WHERE name = 'lychee_api_key')::text
  ELSE vault.create_secret(:'key', 'lychee_api_key', 'Lychee WhatsApp API key — monthly survey reminder')::text
END AS stored \gset
UPDATE public.survey_whatsapp_config
   SET channel_id = coalesce(NULLIF(:'channel', ''), channel_id),
       template_language = coalesce(NULLIF(:'lang', ''), template_language),   -- e.g. es_AR, not es
       updated_at = now();
SELECT format('  vault: lychee_api_key stored | channel_id: %s | template: %s (%s) vars=%s | enabled: %s',
              coalesce(channel_id, 'NOT SET — add LYCHEE_CHANNEL_ID'), template_name, template_language,
              body_variables, enabled)
FROM public.survey_whatsapp_config;
SQL
if [ -z "$TEMPLATE_LANG" ]; then
  echo "Key stored, but survey_clients is not approved in Lychee yet — re-run this script once it is." >&2
  exit 2
fi
echo "Done. Sending is still OFF until: UPDATE public.survey_whatsapp_config SET enabled = true;"
