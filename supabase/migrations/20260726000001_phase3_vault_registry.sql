-- ============================================================================
-- Phase 3 · Track 0 — Two-surface ERC-4626 vaults + on-chain registry
-- Additive only — extends social_vaults to describe the new 4626 vault stack.
-- See docs/developers/phase3-track0-foundation-design.md
-- ============================================================================

-- ─── social_vaults: Phase-3 columns ─────────────────────────────────────────
-- Existing rows describe the legacy (Phase-2) SocialVault. New 4626 vaults set
-- vault_standard='erc4626' and carry their on-chain registry vaultId + surface.

alter table social_vaults
  add column if not exists surface             text not null default 'defi',   -- 'defi' | 'rwa'
  add column if not exists vault_standard      text not null default 'legacy', -- 'legacy' | 'erc4626'
  add column if not exists registry_address    text,                           -- MintwareVaultRegistry
  add column if not exists registry_vault_id   text,                           -- bytes32 hex (keccak(chainid, vault))
  add column if not exists share_token_address text,                           -- ERC-4626 vault == share token
  add column if not exists provider            text;                           -- strategy manager / issuer

-- surface + standard are constrained to known values
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_vaults_surface_chk') then
    alter table social_vaults
      add constraint social_vaults_surface_chk check (surface in ('defi', 'rwa'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_vaults_standard_chk') then
    alter table social_vaults
      add constraint social_vaults_standard_chk check (vault_standard in ('legacy', 'erc4626'));
  end if;
end $$;

-- Registry vaultId is unique when set (one row per on-chain vault).
create unique index if not exists social_vaults_registry_vault_id_uniq
  on social_vaults (registry_vault_id)
  where registry_vault_id is not null;

comment on column social_vaults.surface is 'Vault surface: defi (permissionless yield) | rwa (legal-wrapped)';
comment on column social_vaults.vault_standard is 'legacy = Phase-2 SocialVault; erc4626 = Phase-3 MintwareBaseVault4626 subclass';
comment on column social_vaults.registry_vault_id is 'On-chain bytes32 vaultId in MintwareVaultRegistry = keccak256(abi.encode(chainId, vaultAddress))';
comment on column social_vaults.share_token_address is 'ERC-4626 vault address (the vault IS its own share token); null for legacy vaults';
