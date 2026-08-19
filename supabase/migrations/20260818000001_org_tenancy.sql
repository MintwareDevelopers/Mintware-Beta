-- ============================================================================
-- Org tenancy — the grounded, non-overengineered version.
--
-- Lets any org invite a roster and get flat OrgMembership EAS attestations for
-- them (lib/rewards/eas.ts#attestOrgMembership). Deliberately does NOT include
-- a tier-weighting engine, a trust graph, or pluggable signal sources — those
-- were scoped out as speculative (see docs/developers/attribution-trust-graph-spec.md,
-- which documents the fuller vision as design-not-started). This is just: an
-- org exists, it has members, each member has a flat role and an attestation.
--
-- `treasury_vault_address` is intentionally nullable and NOT set by any app
-- code path. The converged MintwareTreasuryVault uses a delegatecall-linked
-- library that only Foundry's linker handles correctly (see the deprecated
-- app/api/(admin)/oracle/deploy-ypn-v2-testnet/route.ts for why the old
-- app-route deploy path was retired) — deploying a per-org treasury instance
-- is an operator running `forge script contracts-v4/script/DeployTreasuryV2.s.sol
-- --broadcast`, same as every other testnet contract in this repo. This column
-- exists so an operator can record the address after that manual step; nothing
-- here triggers or assumes an on-chain deploy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS orgs (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text        NOT NULL,
  slug                    text        NOT NULL UNIQUE,
  owner_wallet            text        NOT NULL,          -- EIP-191 authenticated creator; the only wallet that can invite until roles exist
  treasury_vault_address  text,                          -- set manually by an operator after a real Foundry deploy; NULL = no treasury yet
  treasury_chain_id       int,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orgs_owner_wallet_idx ON orgs (owner_wallet);

CREATE TABLE IF NOT EXISTS org_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- Invites start as email-only (wallet unknown until the invitee logs in via
  -- Privy); `wallet` is filled in when they accept. Never both null.
  invited_email text,
  wallet        text,
  role          text        NOT NULL DEFAULT 'contributor',  -- free text, org-defined; Mintware doesn't enforce an enum
  status        text        NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
  eas_uid       text,                                        -- OrgMembership attestation UID, set once status = 'active'
  invited_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  CONSTRAINT org_members_has_identity CHECK (invited_email IS NOT NULL OR wallet IS NOT NULL)
);

-- One pending invite per email per org; one membership per wallet per org.
CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_email_idx ON org_members (org_id, invited_email) WHERE invited_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_wallet_idx ON org_members (org_id, wallet) WHERE wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_members_wallet_idx ON org_members (wallet);

COMMENT ON TABLE orgs IS 'A tenant org — flat membership only, no computed tiering. See migration header.';
COMMENT ON TABLE org_members IS 'Roster: email-invited → wallet-accepted → OrgMembership EAS attestation issued.';
