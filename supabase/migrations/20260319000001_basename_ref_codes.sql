-- =============================================================================
-- Basename-first ref code migration
--
-- Enforces uniqueness on wallet_profiles.ref_code.
-- Existing codes (mw_xxxxxx format) are preserved — the constraint only
-- prevents future duplicates. The new ref code generation system
-- (lib/referral-code.ts) runs a collision-check loop before inserting.
-- =============================================================================

-- Ensure the column is wide enough for Basename-derived codes
ALTER TABLE wallet_profiles
  ALTER COLUMN ref_code TYPE varchar(32);

-- Add unique constraint if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallet_profiles_ref_code_unique'
      AND conrelid = 'wallet_profiles'::regclass
  ) THEN
    ALTER TABLE wallet_profiles
      ADD CONSTRAINT wallet_profiles_ref_code_unique UNIQUE (ref_code);
  END IF;
END $$;
