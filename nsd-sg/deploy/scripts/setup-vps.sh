#!/usr/bin/env bash
# One-shot provisioning for a fresh Ubuntu 22.04/24.04 Hostinger KVM VPS.
# Run as root:  bash setup-vps.sh
# Idempotent: safe to re-run.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/aarif86/marketingskills.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/nsd}"
SUBDIR="${SUBDIR:-nsd-sg}"

log() { printf '\n\033[1;35m[nsd]\033[0m %s\n' "$*"; }

log "1/7 Base packages + unattended security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades jq
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

log "2/7 Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

log "3/7 Firewall: only SSH, HTTP, HTTPS (TCP+UDP for HTTP/3)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

log "4/7 fail2ban for SSH"
cat >/etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "5/7 Fetch application source into $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH" && git -C "$APP_DIR" reset --hard "origin/$REPO_BRANCH"
fi
cd "$APP_DIR/$SUBDIR"

log "6/7 Environment file"
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 48)
  ASK=$(openssl rand -hex 24)
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
  sed -i "s|^TLS_ASK_TOKEN=.*|TLS_ASK_TOKEN=$ASK|" .env
  {
    echo ""
    echo "# ---- edge (Caddy) ----"
    echo "TLS_MODE=ondemand            # or: wildcard (requires CLOUDFLARE_API_TOKEN)"
    echo "ACME_EMAIL=admin@nsd.sg"
    echo "CLOUDFLARE_API_TOKEN="
  } >> .env
  chmod 600 .env
  echo
  echo "  >>> Edit $APP_DIR/$SUBDIR/.env now: ADMIN_EMAIL, ADMIN_PASSWORD, SMTP_*, TLS_MODE. Then re-run this script. <<<"
  echo
  exit 0
fi

log "7/7 Build and start the stack"
docker compose -f deploy/docker-compose.yml up -d --build
sleep 5
docker compose -f deploy/docker-compose.yml ps

log "Installing daily backup + weekly prune cron"
install -m 755 deploy/scripts/backup.sh /usr/local/bin/nsd-backup
cat >/etc/cron.d/nsd <<EOF
15 3 * * * root /usr/local/bin/nsd-backup >> /var/log/nsd-backup.log 2>&1
30 4 * * 0 root docker exec nsd-app node src/cli.js prune >> /var/log/nsd-prune.log 2>&1
EOF

log "Done. Check: curl -sI https://$(grep ^BASE_DOMAIN .env | cut -d= -f2)/healthz"
