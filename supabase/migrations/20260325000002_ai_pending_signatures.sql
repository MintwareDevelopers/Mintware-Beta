-- ai_pending_signatures
-- Stores oracle-signed EIP-712 messages for AI agents to pick up and submit to chain.
-- Written by oracle-watcher (Cloudflare Worker). Read by GET /api/agents/[address]/pending.

create table if not exists ai_pending_signatures (
  id           bigserial    primary key,
  address      text         not null,
  tx_hash      text         not null,
  signature    text         not null,
  nonce        text         not null,
  deadline     text         not null,
  volume_wei   text         not null default '0',
  campaign_id  bigint       not null default 0,
  claimed      boolean      not null default false,
  claimed_at   timestamptz  default null,
  created_at   timestamptz  not null default now(),

  unique (address, tx_hash)
);

-- Fast lookup: unclaimed sigs for a given agent
create index if not exists idx_pending_sigs_address_unclaimed
  on ai_pending_signatures (address, created_at desc)
  where claimed = false;

-- Cleanup index: find expired sigs (deadline < now)
create index if not exists idx_pending_sigs_deadline
  on ai_pending_signatures (deadline)
  where claimed = false;
