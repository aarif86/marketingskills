// Real quotes, added by admin. Nothing renders until there is at least one shown.
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export function listTestimonials({ shownOnly = false, limit = 50 } = {}) {
  return getDb().prepare(`SELECT * FROM testimonials ${shownOnly ? 'WHERE shown = 1' : ''} ORDER BY created_at DESC LIMIT ?`).all(limit);
}
export function addTestimonial({ quote, name, role = '', url = '' }) {
  const q = String(quote ?? '').trim().slice(0, 400);
  const n = String(name ?? '').trim().slice(0, 80);
  if (q.length < 10) return { ok: false, reason: 'The quote needs at least 10 characters.' };
  if (!n) return { ok: false, reason: 'Give the person a name (first name is fine).' };
  let u = String(url ?? '').trim().slice(0, 200);
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  const id = newId();
  getDb().prepare('INSERT INTO testimonials (id, quote, name, role, url) VALUES (?, ?, ?, ?, ?)').run(id, q, n, String(role ?? '').trim().slice(0, 80), u);
  return { ok: true, id };
}
export function toggleTestimonial(id) { return getDb().prepare('UPDATE testimonials SET shown = 1 - shown WHERE id = ?').run(id).changes > 0; }
export function removeTestimonial(id) { return getDb().prepare('DELETE FROM testimonials WHERE id = ?').run(id).changes > 0; }
