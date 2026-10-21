// Admin-editable switches, cached in memory (one process). Values are strings; callers parse.
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/ids.js';

let cache = null;
const load = () => { cache ??= Object.fromEntries(getDb().prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])); return cache; };

export function getSetting(key, fallback = '') { const v = load()[key]; return v === undefined || v === '' ? fallback : v; }
export function setSetting(key, value) {
  getDb().prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, String(value ?? ''), nowIso());
  load()[key] = String(value ?? '');
}
export const resetSettingsCache = () => { cache = null; };
