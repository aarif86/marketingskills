-- Roadmap catch-up, 25 Oct: the MCP card is not Claude-only any more; three things shipped since the last sort.
UPDATE roadmap_items SET title = 'Publish straight from your AI',
  body = 'Connect your AI once (Claude, ChatGPT, Codex, Gemini CLI, Cursor and any other tool that supports connectors), then say “put this online as my-site” and get a live link back. Keys you can switch off, same rules as the dashboard.'
  WHERE id = 'rm-mcp';
INSERT OR IGNORE INTO roadmap_items (id, title, body, status, category, sort_order, shipped_at) VALUES
  ('rm-help-panel', 'A real human one tap away', 'A small help panel on every page: three quick answers for where you are, then WhatsApp a real person. It shows up when you seem stuck, not all the time.', 'shipped', 'platform', 4, '2026-10-21T06:00:00Z'),
  ('rm-samples', 'Three sample pages to try', 'No page yet? A proposal, a class quiz and a one-page shop, one click each, so anyone can see the whole flow before making their own.', 'shipped', 'platform', 5, '2026-10-21T04:00:00Z'),
  ('rm-evidence-grade', 'Evidence packs an investigator can use', 'Plain-words summary, every version with the IP that uploaded it, a SHA-256 manifest and chain of custody, legal hold, and visitor logs for reported sites.', 'shipped', 'admin', 6, '2026-10-20T20:00:00Z');
