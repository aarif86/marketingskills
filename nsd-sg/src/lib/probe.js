// "Does this address really answer?" One HEAD request over HTTPS, 6 s cap. Injectable for tests.
// On Hostinger the app never serves tenant hosts itself, so this is the only honest way to know that a brand-new
// subdomain (waiting on its certificate) is reachable before we tell the owner it is online.
let impl = async (url) => {
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(6000) });
  return res.status === 200;
};
export function setProbe(fn) { impl = fn ?? impl; }
/** @returns {Promise<{ok:boolean, detail:string}>} never throws */
export async function probeUrl(url) {
  try { return { ok: await impl(url), detail: '' }; } catch (e) { return { ok: false, detail: String(e.cause?.code ?? e.code ?? e.message).slice(0, 120) }; }
}
