-- Treasury-vault (YPN v2) tranche intent captured at create time.
--
-- The /vault/create flow was repurposed to the treasury model (community USDC senior + team token
-- junior). This persists the team's launch choices so a provisioning step can stand the vault up +
-- commitTeam from them. Additive + backward-compatible: existing DeFi pair-vault rows keep
-- vault_kind = 'defi' and leave the tranche columns null.

alter table social_vaults
  -- 'defi' = the legacy project-token/USDC pair vault; 'treasury' = the YPN v2 tranche vault.
  add column if not exists vault_kind         text    not null default 'defi',
  -- USDC value of the team's junior token cushion committed at launch (the first-loss leg).
  add column if not exists junior_commit_usdc numeric,
  -- junior hard-lock in days (>= 90; enforced on-chain by MIN_LOCK_DURATION).
  add column if not exists lock_days          integer,
  -- OPTIONAL senior USDC the team also seeds (equal to the community by default).
  add column if not exists team_usdc          numeric default 0,
  -- OPTIONAL: subordinate the team's own USDC below the community's as extra first-loss (PR #227).
  add column if not exists subordinate_usdc   boolean default false;

comment on column social_vaults.vault_kind is 'defi (pair vault) | treasury (YPN v2 tranche vault)';
comment on column social_vaults.junior_commit_usdc is 'USDC value of the team junior token cushion at launch';
comment on column social_vaults.subordinate_usdc is 'true = team USDC is junior (first-loss) below the community senior';
