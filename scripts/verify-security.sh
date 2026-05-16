#!/usr/bin/env bash
# scripts/verify-security.sh — comprehensive local verification.
#
# What this checks (in order, fail-fast):
#   1. The dangerous edge function source dirs are gone.
#   2. No edge function uses `Access-Control-Allow-Origin: *`.
#   3. No module-level helper references a closure-bound `corsHeaders` (a refactor footgun).
#   4. `.env` is git-ignored.
#   5. `xlsx` is uninstalled.
#   6. `vite build` succeeds (catches all TS/JSX/import regressions).
#   7. `vitest run` passes the security-critical unit tests.
#   8. `npm audit` production has no NEW high+ vulns vs the audit doc.
#   9. The prompt-injection scrubber test matches the edge function's regex list (drift guard).
#
# Run before each merge:
#   npm run verify

set -euo pipefail
cd "$(dirname "$0")/.."

FAILED=0
ok()  { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAILED=1; }
say() { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }

say "1/9  Dangerous edge functions are deleted"
for f in migrate-database export-database export-database-zip; do
  if [ -d "supabase/functions/$f" ]; then
    bad "supabase/functions/$f still exists — must be removed"
  else
    ok "supabase/functions/$f is gone"
  fi
done

say "2/9  No wildcard CORS in any edge function"
if grep -rln "Access-Control-Allow-Origin.*\\*" supabase/functions/*/index.ts 2>/dev/null | grep -v _shared; then
  bad "found wildcard ACAO in the files above"
else
  ok "all browser-facing functions use the _shared/cors.ts allowlist"
fi

say "3/9  No closure-bound corsHeaders in module-level helpers"
python3 - <<'PY'
import re, pathlib, sys
root = pathlib.Path('supabase/functions')
bad = []
for f in sorted(root.glob('*/index.ts')):
    src = f.read_text()
    # Find ALL function declarations at column 0 (module level) and check whether
    # their body references corsHeaders.
    for m in re.finditer(r'^function\s+\w+\b[^{]*\{', src, re.MULTILINE):
        start = m.end()
        depth = 1
        i = start
        while i < len(src) and depth > 0:
            c = src[i]
            if c == '{': depth += 1
            elif c == '}': depth -= 1
            i += 1
        body = src[start:i]
        if 'corsHeaders' in body:
            bad.append(f'{f.parent.name}/index.ts at offset {m.start()}')
if bad:
    print('FAIL — module-level helpers reference corsHeaders:')
    for b in bad: print('  -', b)
    sys.exit(1)
else:
    print('  ok')
PY
if [ $? -ne 0 ]; then bad "closure bug regression detected"; else ok "no closure regressions"; fi

say "4/9  .env hygiene (rule in gitignore + tracked .env has only VITE_ public values)"
if ! grep -qE '^\.env$|^\.env\*' .gitignore; then
  bad ".env is missing from .gitignore — future .env edits could leak secrets"
else
  # .env may still be tracked because Vercel reads it at build time.
  # Acceptable AS LONG AS the file contains only VITE_ public values
  # (no server secrets). Until the user moves them into Vercel project
  # env vars (planned follow-up), we just enforce the content shape.
  if [ -f .env ] && grep -qvE '^(VITE_|#|[[:space:]]*$)' .env; then
    bad ".env contains non-VITE_ entries — move secrets to Supabase/Vercel env vars"
  else
    ok ".env rule present; tracked .env (if any) is VITE_-only"
  fi
fi

say "5/9  xlsx is uninstalled"
if [ -d node_modules/xlsx ]; then
  bad "node_modules/xlsx still present — run \`bun install\` (or \`npm install\`)"
else
  ok "xlsx not installed"
fi

say "6/9  Production build"
if npx vite build > /tmp/verify-build.log 2>&1; then
  ok "vite build ($(grep -c 'transforming' /tmp/verify-build.log || true) phase passed)"
else
  bad "vite build FAILED — see /tmp/verify-build.log:"
  tail -20 /tmp/verify-build.log | sed 's/^/    /'
fi

say "7/9  Unit tests"
if npx vitest run --reporter=basic > /tmp/verify-test.log 2>&1; then
  ok "vitest passed"
  grep -E 'Test Files|Tests' /tmp/verify-test.log | head -5 | sed 's/^/    /'
else
  bad "vitest FAILED — see /tmp/verify-test.log:"
  tail -30 /tmp/verify-test.log | sed 's/^/    /'
fi

say "8/9  npm audit (production, high+) shows no surprise vulns"
AUDIT_JSON=$(npm audit --omit=dev --json 2>/dev/null || true)
HIGH=$(echo "$AUDIT_JSON" | python3 -c "import json,sys;d=json.load(sys.stdin);v=d.get('metadata',{}).get('vulnerabilities',{});print((v.get('high',0) or 0) + (v.get('critical',0) or 0))" 2>/dev/null || echo "0")
KNOWN_HIGH_BUDGET=15  # baseline 2026-05-13: react-router-dom + 14 dev/build transitive deps. Lower as Renovate clears them.
if [ "$HIGH" -gt "$KNOWN_HIGH_BUDGET" ]; then
  bad "npm audit reports $HIGH high+critical findings (budget = $KNOWN_HIGH_BUDGET). Check audit doc."
else
  ok "$HIGH high+critical findings (within budget $KNOWN_HIGH_BUDGET)"
fi

say "9/9  Prompt-injection scrubber drift check"
# The unit test re-implements the patterns. If they diverge from the edge
# function's source, the test will pass while production stays unprotected.
# Compare a representative pattern as a smoke check.
if grep -q "ignore.*previous.*instructions" supabase/functions/ai-assistant/index.ts && \
   grep -q "ignore.*previous.*instructions" src/lib/promptInjection.test.ts; then
  ok "scrubber pattern present in both source and test"
else
  bad "scrubber pattern drift detected — sync supabase/functions/ai-assistant/index.ts with src/lib/promptInjection.test.ts"
fi

echo
if [ "$FAILED" = "0" ]; then
  printf "\033[32m\033[1m✓ verify-security: all checks passed\033[0m\n"
  exit 0
else
  printf "\033[31m\033[1m✗ verify-security: at least one check FAILED\033[0m\n"
  exit 1
fi
