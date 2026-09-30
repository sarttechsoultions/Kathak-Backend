-- Align legacy academy batch codes with the Kathak by Harshita (KBH) prefix.
-- The suffix remains unchanged so existing references remain recognizable.
UPDATE "Batch"
SET "code" = 'KBH-' || SUBSTRING("code" FROM 5)
WHERE "code" LIKE 'KTH-%';
