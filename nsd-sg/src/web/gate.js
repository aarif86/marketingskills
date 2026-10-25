// Publish gate: a site may only go online once the owner's email is confirmed. One throwaway account with a phishing
// page can get the whole *.nsd.sg domain flagged by Safe Browsing, so the zero-effort path is closed. Try pages
// (3 hours, capped per person and per IP) are unaffected; Google sign-ups arrive confirmed.
import { config } from '../config.js';

export function publishGate(user) {
  if (!config.publish.requireVerifiedEmail || !user || user.email_verified_at) return null;
  return `Confirm your email before your site goes online. We sent a link to ${user.email}. Did not get it? Send it again from your Account page.`;
}
