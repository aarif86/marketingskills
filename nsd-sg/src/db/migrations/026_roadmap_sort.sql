-- Roadmap tidy before going public: what is actually in progress, a sensible order for Planned, and today's shipped work.
UPDATE roadmap_items SET status = 'in_progress', sort_order = 1,
  body = 'A 30-day traffic chart is already on every site page. Next: visits and top pages, privacy-friendly, no cookies.' WHERE id = 'rm-analytics' AND status = 'planned';
UPDATE roadmap_items SET sort_order = 10 WHERE id = 'rm-email-gate';
UPDATE roadmap_items SET sort_order = 11 WHERE id = 'rm-demo-video';
UPDATE roadmap_items SET sort_order = 12 WHERE id = 'rm-capacity';
UPDATE roadmap_items SET sort_order = 13 WHERE id = 'rm-psl';
UPDATE roadmap_items SET sort_order = 14 WHERE id = 'rm-vs-pages';
UPDATE roadmap_items SET sort_order = 15 WHERE id = 'rm-domain-buy';
INSERT OR IGNORE INTO roadmap_items (id, title, body, status, category, sort_order, shipped_at) VALUES
  ('rm-gift-plans', 'Gift plans that charge only when the free period ends', 'A promo code can unlock a plan for months. Keep it by card and the first charge lands on the day the free period ends, not today. Admin can make gift plans that stay on the showcase.', 'shipped', 'billing', 7, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
