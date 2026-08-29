#!/bin/bash
# Village factory — apply a village's env pack to its Netlify site.
# Usage: apply-envpack.sh <site-id> <envpack.json> <identity.json>
# envpack.json:  { "envVars": { "NOTION_*_DB_ID": "<db-id>", ... } }
# identity.json: flat { "KEY": "value" } of branding/config vars (refactor env-var names)
set -euo pipefail
SITE_ID="$1"; ENVPACK="$2"; IDENTITY="$3"
apply() {
  local key="$1" val="$2"
  NETLIFY_SITE_ID="$SITE_ID" netlify env:set "$key" "$val" --force >/dev/null 2>&1 \
    && echo "  set $key" || echo "  FAILED $key"
}
echo "Applying DB env pack to $SITE_ID"
while IFS=$'\t' read -r k v; do apply "$k" "$v"; done < <(python3 -c "
import json,sys
d=json.load(open('$ENVPACK'))
for k,v in d['envVars'].items(): print(f'{k}\t{v}')
# GOTCHA (29 Aug 2026): the Astro content layer reads the LEGACY alias
# NOTION_DATABASE_ID, not NOTION_CONTENT_DB_ID — both must point at the
# village's own content DB or builds pull the flagship's content.
cid=d['envVars'].get('NOTION_CONTENT_DB_ID')
if cid: print(f'NOTION_DATABASE_ID\t{cid}')")
echo "Applying identity vars"
while IFS=$'\t' read -r k v; do apply "$k" "$v"; done < <(python3 -c "
import json,sys
d=json.load(open('$IDENTITY'))
for k,v in d.items(): print(f'{k}\t{v}')")
echo "Done: $SITE_ID"
