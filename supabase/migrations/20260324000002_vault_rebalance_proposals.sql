-- T4.2 — vault_rebalance_proposals
-- Stores oracle-signed range proposals for social vaults.
-- Each row is a pending rebalance instruction the contract can verify via EIP-712.
-- T4.3 wires the UI/cron to submit the stored signature to SocialVault.rebalanceWithProposal().
--
-- Additive migration — no existing tables modified.

create table vault_rebalance_proposals (
  id               uuid primary key default gen_random_uuid(),
  vault_id         uuid not null references social_vaults(id) on delete cascade,

  -- Proposed tick range
  tick_lower       integer not null,
  tick_upper       integer not null,

  -- Why this proposal was triggered
  reason           text not null
    check (reason in (
      'price_out_of_range',
      'range_drifted',
      'range_too_narrow',
      'range_too_wide',
      'scheduled'
    )),

  -- Oracle EIP-712 signature — verified by SocialVault.rebalanceWithProposal() in T4.3
  oracle_signature text not null,
  signer_address   text not null,

  -- Unix timestamp after which the signature is invalid (4h from signing)
  valid_until      bigint not null,

  -- Monotonically increasing per vault — prevents replay attacks
  nonce            bigint not null,

  -- Lifecycle: pending → submitted → expired
  status           text not null default 'pending'
    check (status in ('pending', 'submitted', 'expired')),

  -- Populated by T4.3 when someone submits the proposal on-chain
  submitted_tx     text,
  submitted_at     timestamptz,

  created_at       timestamptz default now()
);

-- Each vault has at most one pending proposal at a time (the latest)
-- Older pending rows are expired by the rebalance API route before inserting new ones.
create index vault_rebalance_proposals_vault_status
  on vault_rebalance_proposals (vault_id, status, created_at desc);

-- Nonce uniqueness per vault
create unique index vault_rebalance_proposals_vault_nonce
  on vault_rebalance_proposals (vault_id, nonce);

-- Auto-expire proposals whose valid_until has passed (called by cleanup job in T4.3)
comment on column vault_rebalance_proposals.valid_until is
  'Unix timestamp (seconds). Proposal is invalid after this time. '
  'T4.3 cleanup job sets status=expired for rows where valid_until < now().';
