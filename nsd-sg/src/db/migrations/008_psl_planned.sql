-- Nobody has opened the Public Suffix List request yet: the public roadmap must not say 'in progress'.
UPDATE roadmap_items SET status = 'planned' WHERE id = 'rm-psl' AND status = 'in_progress';
