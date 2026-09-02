// Boot + listen. Shared by src/server.js (VPS/local) and server.cjs (Hostinger lsnode).
import { buildApp } from './server.js';
import { config } from './config.js';

const app = await buildApp();
const shutdown = async (sig) => {
  app.log.info({ sig }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// On LiteSpeed the port is ignored: listen() is intercepted and bound to the vhost's Unix socket.
await app.listen({ host: config.host, port: config.port });
app.log.info(`NSD.SG v${config.version} platform on ${config.platformHosts.join(', ')} · tenants on *.${config.baseDomain}${config.hostinger.tenantRoot ? ` (served by LiteSpeed from ${config.hostinger.tenantRoot})` : ''}`);
