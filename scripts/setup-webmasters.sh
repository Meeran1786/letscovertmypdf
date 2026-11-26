#!/usr/bin/env bash
# One-time setup for the Google Search Console + Bing Webmaster connection.
# Run on the droplet:  bash /opt/letsconvertpdf/scripts/setup-webmasters.sh
# It asks for the Bing API key and the Google service-account JSON, checks
# them, saves them in the data folder, restarts the app and shows the result.
set -euo pipefail
DATA=/opt/letsconvertpdf-data
APP=letsconvertpdf
mkdir -p "$DATA"

echo
echo "== Bing Webmaster API key =="
echo "Paste the key and press Enter (leave empty to skip):"
read -r BING
BING="$(echo -n "$BING" | tr -d '[:space:]')"
if [ -n "$BING" ]; then
  printf '%s' "$BING" > "$DATA/bing-webmaster-key.txt"; chmod 600 "$DATA/bing-webmaster-key.txt"
  echo "Saved the Bing key."
fi

echo
echo "== Google service-account JSON =="
echo "Paste the whole JSON file. Then, on a new line, type END and press Enter."
echo "(Type just END to skip.)"
JSON=""
while IFS= read -r line; do
  # A paste often lacks a final newline, so "END" can land on the "}" line.
  if [[ "$line" == *END ]]; then JSON+="${line%END}"$'\n'; break; fi
  JSON+="$line"$'\n'
done
if [ -n "$(echo "$JSON" | tr -d '[:space:]')" ]; then
  TMP="$(mktemp)"; printf '%s' "$JSON" > "$TMP"
  if python3 - "$TMP" <<'PY'
import json, sys
k = json.load(open(sys.argv[1]))
assert k.get("client_email") and "PRIVATE KEY" in k.get("private_key", ""), "not a service-account key"
print("Service account:", k["client_email"])
PY
  then
    mv "$TMP" "$DATA/gsc-service-account.json"; chmod 600 "$DATA/gsc-service-account.json"
    echo "Saved the Google key. Make sure the email above is an Owner in Search Console."
  else
    rm -f "$TMP"; echo "That doesn't look like a service-account JSON file. Nothing saved for Google."
  fi
fi

echo
echo "Restarting the app..."
docker restart "$APP" >/dev/null
for i in $(seq 1 30); do
  if curl -fs localhost:3000/api/health >/dev/null 2>&1; then break; fi; sleep 2
done
echo "Waiting 60 seconds for the first sitemap submission..."
sleep 60
curl -s localhost:3000/api/health | python3 -c 'import json,sys; w=json.load(sys.stdin).get("webmasters"); print("\nResult:", json.dumps(w, indent=1) if w else "webmasters not found: deploy the latest code first")'
