// "Need a hand?" panel: three answers for the page the person is on, then WhatsApp a real human.
// Hours are Singapore time; outside them the panel says when to expect a reply, so nobody waits up.
import { config } from '../config.js';
import { getSetting } from '../services/settings.js';

export const TIPS = {
  home: [
    ['Where do I get the file?', 'In Claude press Download on the page it made; in ChatGPT or Gemini press Copy on the code box and paste it in the box above.'],
    ['Is it really free?', 'Yes. One site, your own name.nsd.sg, 30 days to start, then press "Get more time" or pick a plan. No card to begin.'],
    ['What can I not put here?', 'Anything that needs a login, stores people’s data or takes payments. Pages, yes; apps, no.'],
  ],
  try: [
    ['Taking longer than usual?', 'A brand-new address needs a padlock (secure connection), which can take up to 15 minutes the first time. Keep the page open; it updates by itself.'],
    ['Which file do I upload?', 'The one ending in .html that your AI gave you. Pictures and PDFs come later, once you have an account.'],
    ['Where did my test page go?', 'Test pages last 3 hours. Sign up free and press "Keep it" to put it on your own address for good.'],
  ],
  auth: [
    ['Forgot your password?', 'Use "Reset password" under the form. If you signed up with Google, just press "Continue with Google".'],
    ['Name already taken?', 'Names are first come, first served. Try adding what you do, like nur-tutoring or kopi-tiongbahru.'],
    ['No email arrived?', 'Check spam, then wait a minute. The confirmation link works for a day.'],
  ],
  dashboard: [
    ['My page shows "page not found"', 'Your site needs a file called index.html at the top level. Upload it, or paste the code and name the page "index".'],
    ['How do I change the page?', 'Upload again or paste new code. Every upload is a version; you can roll back from the Versions list.'],
    ['Pictures missing?', 'Upload them with the page, in the same folder names the code expects. A ZIP keeps the folders intact.'],
  ],
  billing: [
    ['What happens when the free period ends?', 'Your site stays online. Changes pause until you extend or upgrade. Nothing is charged without you pressing a button.'],
    ['Promo code not working?', 'Codes are entered on this page, not at sign-up. They are case-insensitive and some have a limited number of uses.'],
    ['Card payment: when am I charged?', 'Upgrading from Free charges today. Keeping your current plan charges on the day your free period ends.'],
  ],
  connect: [
    ['My AI says the connector failed', 'Copy the whole long address from step 1, including the part after /mcp/. Paste it as the URL, choose “No sign-in” under Authentication, leave headers empty, press Add.'],
    ['Does it work with ChatGPT or Gemini, not only Claude?', 'Yes. Any AI tool that supports connectors (MCP) works: Claude, ChatGPT, Codex, Gemini CLI, Cursor and more. Steps for each are on the page.'],
    ['Can the AI delete my sites?', 'Only the ones on your account, and only if you leave “delete site” allowed. Keep it on “Needs approval” and the AI must ask you first. Press Switch off next to the key any time.'],
    ['Published, but the browser says "can’t provide a secure connection"', 'A new address needs 5 to 15 minutes for its padlock the first time. Wait, then reload. Updates to an existing site show at once.'],
    ['Publishing says "quota"', 'Your plan’s site limit or storage is full. The message carries a link to the Plan page.'],
  ],
  domains: [
    ['The check keeps failing', 'DNS changes take up to an hour to spread. Make sure the TXT record name is exactly _nsd-verify.yourdomain and the value is pasted whole.'],
    ['www or the bare domain?', 'Point www with a CNAME and the bare domain with an A record. The page shows both values.'],
    ['Connected but not loading?', 'The padlock for a new domain can take up to 15 minutes. If it is still blank after an hour, write to us.'],
  ],
  notfound: [
    ['Looking for a site?', 'Sites live at name.nsd.sg, not nsd.sg/name. Check the spelling of the name before the dot.'],
    ['Looking for your dashboard?', 'Log in and press Sites. Every site you own is listed there.'],
    ['Think something broke?', 'Tell us the link you pressed and we will fix it.'],
  ],
  default: [
    ['How does NSD.SG work?', 'Ask an AI for a page, paste it here, and it is online at yourname.nsd.sg. Three steps on the home page.'],
    ['Is my page safe?', 'Every page gets a padlock. Pages cannot run programs on the server, so nothing on your page can be hacked into.'],
    ['How do I contact a person?', 'The green button below, or the Contact page in the footer: WhatsApp, email, the roadmap for ideas, Report abuse for bad sites.'],
  ],
};

/** Which tip set fits this page. `active` is the dashboard tab key; `path` the URL path. */
export function tipKeyFor({ active = '', path = '' } = {}) {
  if (active === 'billing') return 'billing';
  if (active === 'connect') return 'connect';
  if (active === 'sites' || active === 'account') return path.includes('/domains') || path.includes('/settings') ? 'domains' : 'dashboard';
  if (path.startsWith('/try')) return 'try';
  if (['/login', '/signup', '/forgot', '/reset', '/verify'].some((p) => path.startsWith(p))) return 'auth';
  if (path === '/404') return 'notfound';
  if (path === '/' || path === '') return 'home';
  return 'default';
}

export const DEFAULT_HOURS = { start: 9, end: 22 };

/** Admin-set support state: enabled, number, hours (SGT). */
export function supportConfig() {
  const enabled = getSetting('support.whatsapp.enabled', '1') !== '0';
  const number = (getSetting('support.whatsapp.number', config.branding.whatsapp) || '').replace(/\D/g, '');
  const start = Math.min(23, Math.max(0, Number(getSetting('support.hours.start', String(DEFAULT_HOURS.start))) || 0));
  const end = Math.min(24, Math.max(1, Number(getSetting('support.hours.end', String(DEFAULT_HOURS.end))) || 24));
  const sgtHour = (new Date(Date.now() + 8 * 3600_000).getUTCHours());
  const open = sgtHour >= start && sgtHour < end;
  const fmt = (h) => (h === 0 || h === 24 ? '12 midnight' : h === 12 ? '12 noon' : h < 12 ? `${h}am` : `${h - 12}pm`);
  return { enabled: enabled && !!number, number, start, end, open, hoursText: `${fmt(start)} to ${fmt(end)}, Singapore time` };
}

export const SUPPORT_SETTING_KEYS = ['support.whatsapp.enabled', 'support.whatsapp.number', 'support.hours.start', 'support.hours.end'];
