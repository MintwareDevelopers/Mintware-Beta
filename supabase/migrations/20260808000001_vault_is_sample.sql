-- Categorize showcase/example vaults from genuinely-deployed ones.
-- Defaults to TRUE so every existing (seeded/demo) vault is a SAMPLE; a real
-- vault is inserted or updated with is_sample = false. The app treats absent/true
-- as sample and only an explicit false as real, so this is safe to apply anytime.

ALTER TABLE social_vaults
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT true;

-- All currently-seeded vaults are illustrative examples.
UPDATE social_vaults SET is_sample = true WHERE is_sample IS DISTINCT FROM false;

COMMENT ON COLUMN social_vaults.is_sample IS
  'true = example/showcase vault (not real capital); false = a genuinely deployed vault. Defaults true.';
