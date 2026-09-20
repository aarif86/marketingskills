-- 0.9.5: paid plans are off the public showcase unless the owner opts in. NULL = never chose.
ALTER TABLE sites ADD COLUMN listed_choice INTEGER;
