#!/usr/bin/env bash
# Build the archive that the Hostinger MCP / hPanel "Deploy from archive" expects.
# Contains only source: package.json, lockfile, server.cjs, src/, and deploy/hostinger/env.hostinger as .env.
# Hostinger runs `npm install` and starts server.cjs under LiteSpeed lsnode. Usage:
#   deploy/hostinger/build-archive.sh [out.zip]
set -euo pipefail
cd "$(dirname "$0")/../.."
out="$(realpath -m "${1:-nsd-sg_$(date +%Y%m%d_%H%M%S).zip}")"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/app"
cp package.json package-lock.json server.cjs "$stage/app/"
cp -r src "$stage/app/src"
cp deploy/hostinger/env.hostinger "$stage/app/.env"
( cd "$stage/app" && zip -qr "$out" . -x '*/node_modules/*' '*/.DS_Store' )
echo "built $out ($(du -h "$out" | cut -f1))"
