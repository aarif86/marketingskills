// Entry file for Hostinger managed Node.js hosting (LiteSpeed lsnode). lsnode require()s the startup file,
// which cannot be an ES module with top-level await, so this tiny CommonJS shim loads the real app.
// Local/VPS: `npm start` runs src/server.js directly.
import('./src/start.js').catch((e) => { console.error(e); process.exit(1); });
