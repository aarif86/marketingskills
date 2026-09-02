# Caddy with the Cloudflare DNS module so it can obtain a wildcard certificate for *.nsd.sg via DNS-01.
# If DNS stays on Hostinger (no supported Caddy DNS plugin), use the on-demand TLS block in the Caddyfile instead;
# this image still works for that mode.
FROM caddy:2-builder AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
