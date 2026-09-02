#!/usr/bin/env bash
# Restore from a backup archive produced by backup.sh. STOPS the app while restoring.
#   bash restore.sh /var/backups/nsd/nsd-20260901-031500.tar.gz
set -euo pipefail
ARCHIVE="${1:?usage: restore.sh <archive.tar.gz>}"
VOLUME="${VOLUME:-nsd-sg_nsd-data}"
COMPOSE="${COMPOSE:-/opt/nsd/nsd-sg/deploy/docker-compose.yml}"

docker compose -f "$COMPOSE" stop app
docker run --rm -v "$VOLUME":/data -v "$(dirname "$ARCHIVE")":/in:ro alpine:3 sh -c "
  set -e; cd /data
  rm -rf sites.restoring && mkdir sites.restoring
  tar -xzf /in/$(basename "$ARCHIVE") -C /data
  DB=\$(ls tmp/backup-*.db | head -1)
  cp \"\$DB\" nsd.db && rm -f nsd.db-wal nsd.db-shm \"\$DB\"
  echo restored"
docker compose -f "$COMPOSE" start app
echo "Done. Verify: docker compose -f $COMPOSE logs --tail 20 app"
