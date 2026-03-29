-- =============================================================================
-- Migration: 20260329000002_wallet_links.sql
-- Date: 2026-03-29
--
-- wallet_links — cross-chain wallet linking
--
-- Links a Solana address to an EVM address under one Mintware identity.
-- Both wallets must sign to prove ownership. Only one new sig required
-- (EVM session is already authenticated).
--
-- Sign message format (Solana side):
--   "Link wallet to Mintware: evm=0x46bb...42d7 ts=1743000000"
--
-- Replay protection: ts must be within 5 minutes of server time.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wallet_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_address  text        NOT NULL,   -- EVM address (0x..., lowercase)
  linked_address   text        NOT NULL,   -- Solana address (base58)
  linked_chain     text        NOT NULL DEFAULT 'solana',
  link_signature   text        NOT NULL,   -- Ed25519 sig from linked wallet
  link_message     text        NOT NULL,   -- signed message for audit
  verified_at      timestamptz NOT NULL DEFAULT now(),
  status           text        NOT NULL DEFAULT 'verified'
                     CHECK (status IN ('verified', 'revoked')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One Solana address can only be linked to one EVM address
CREATE UNIQUE INDEX IF NOT EXISTS wallet_links_linked_address_uidx
  ON wallet_links (linked_address)
  WHERE status = 'verified';

-- Look up by EVM address (profile page — "linked wallets")
CREATE INDEX IF NOT EXISTS wallet_links_primary_idx
  ON wallet_links (primary_address)
  WHERE status = 'verified';

ALTER TABLE wallet_links ENABLE ROW LEVEL SECURITY;

-- Public read — profile page shows linked wallets without auth
DROP POLICY IF EXISTS "Wallet links are publicly readable" ON wallet_links;
CREATE POLICY "Wallet links are publicly readable"
  ON wallet_links FOR SELECT USING (true);

-- Writes via service role only (wallet-link API route)
