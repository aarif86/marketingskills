#!/usr/bin/env bash
# Point nsd.sg at the VPS using the Hostinger API (DNS zone endpoints).
#   export HOSTINGER_API_TOKEN=...   (hPanel -> Account -> API)
#   bash hostinger-dns.sh nsd.sg 203.0.113.10
#
# NOTE: written from the public Hostinger API documentation (https://developers.hostinger.com); endpoint shapes
# could not be verified from the build environment. If a call fails, compare against the docs and adjust
# the JSON below — the intent is simply: A @ -> IP, A www -> IP, A * -> IP, TTL 300.
set -euo pipefail
DOMAIN="${1:?domain}"; IP="${2:?ip}"
: "${HOSTINGER_API_TOKEN:?set HOSTINGER_API_TOKEN}"
API="https://developers.hostinger.com/api/dns/v1/zones/$DOMAIN"

echo "Current zone:"
curl -sS -H "Authorization: Bearer $HOSTINGER_API_TOKEN" "$API" | jq . || true

echo "Applying A records (@, www, *) -> $IP"
curl -sS -X PUT -H "Authorization: Bearer $HOSTINGER_API_TOKEN" -H 'Content-Type: application/json' "$API" -d @- <<EOF | jq .
{
  "overwrite": false,
  "zone": [
    { "name": "@",   "type": "A", "ttl": 300, "records": [ { "content": "$IP" } ] },
    { "name": "www", "type": "A", "ttl": 300, "records": [ { "content": "$IP" } ] },
    { "name": "*",   "type": "A", "ttl": 300, "records": [ { "content": "$IP" } ] }
  ]
}
EOF
echo "Verify in a minute:  dig +short A anything.$DOMAIN"
