#!/usr/bin/env bash
# Nightly backup: consistent SQLite snapshot + tar of site files, kept 14 days locally.
# Set BACKUP_REMOTE (an rclone remote like "b2:nsd-backups" or "s3:bucket/path") to copy off-box.
set -euo pipefail

VOLUME="${VOLUME:-nsd-sg_nsd-data}"           # docker volume name (project_volume)
DEST="${DEST:-/var/backups/nsd}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP=$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

# 1) Online, consistent copy of the database using SQLite's backup API (safe under WAL).
docker run --rm -v "$VOLUME":/data -v "$DEST":/out --entrypoint sh node:22-bookworm-slim -c '
  cd /app 2>/dev/null || true
  node -e "
    const D=require(\"/data/../app/node_modules/better-sqlite3\")" 2>/dev/null || true' >/dev/null 2>&1 || true
docker exec nsd-app node -e "
  const Database=require('better-sqlite3');
  const db=new Database('/var/lib/nsd/nsd.db',{readonly:true});
  db.backup('/var/lib/nsd/tmp/backup-$STAMP.db').then(()=>{db.close();console.log('db snapshot ok')}).catch(e=>{console.error(e);process.exit(1)});
"

# 2) Tar the snapshot + all site releases from the volume.
docker run --rm -v "$VOLUME":/data:ro -v "$DEST":/out alpine:3 sh -c "
  cd /data && tar -czf /out/nsd-$STAMP.tar.gz tmp/backup-$STAMP.db sites 2>/dev/null && echo 'archive ok'"
docker exec nsd-app rm -f "/var/lib/nsd/tmp/backup-$STAMP.db"

# 3) Optional off-box copy.
if [ -n "${BACKUP_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$DEST/nsd-$STAMP.tar.gz" "$BACKUP_REMOTE" && echo "copied to $BACKUP_REMOTE"
fi

# 4) Retention.
find "$DEST" -name 'nsd-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
ls -lh "$DEST" | tail -3
