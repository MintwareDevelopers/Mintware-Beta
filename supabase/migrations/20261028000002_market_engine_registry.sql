-- MarketEngine becomes the verified V1 deposit target. Gateway tables remain in place for E3 cleanup.
alter table public.gateway_instances
  add column if not exists market_engine_address text,
  add column if not exists market_engine_code_hash text,
  add column if not exists market_engine_owner text,
  add column if not exists market_engine_token0 text,
  add column if not exists market_engine_token1 text,
  add column if not exists engine_verified_at timestamptz;

alter table public.gateway_instances alter column staging drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gateway_instances_engine_address_format' and conrelid = 'public.gateway_instances'::regclass) then
    alter table public.gateway_instances add constraint gateway_instances_engine_address_format
      check (market_engine_address is null or market_engine_address ~ '^0x[0-9a-fA-F]{40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gateway_instances_engine_code_hash_format' and conrelid = 'public.gateway_instances'::regclass) then
    alter table public.gateway_instances add constraint gateway_instances_engine_code_hash_format
      check (market_engine_code_hash is null or market_engine_code_hash ~ '^0x[0-9a-fA-F]{64}$');
  end if;
end $$;

comment on column public.gateway_instances.market_engine_address is 'Verified MarketEngine instance used by V1; null rows are legacy Gateway instances disconnected from V1.';
comment on column public.gateway_instances.engine_verified_at is 'Last successful on-chain MarketEngine trust-root verification.';

create table if not exists public.market_engine_tx_events (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  user_wallet text not null,
  pool_address text not null,
  chain_id integer not null,
  market_engine_address text not null,
  action text not null check (action in ('deposit', 'withdraw')),
  shares_atomic numeric(78,0) not null,
  amount0_atomic numeric(78,0) not null default 0,
  amount1_atomic numeric(78,0) not null default 0,
  block_number numeric(78,0) not null,
  transaction_index integer not null,
  created_at timestamptz not null default now()
);
create index if not exists market_engine_tx_events_wallet_idx on public.market_engine_tx_events(user_wallet, chain_id, pool_address, block_number, transaction_index);
alter table public.market_engine_tx_events enable row level security;
comment on table public.market_engine_tx_events is 'Idempotent, receipt-verified V1 MarketEngine actions. Positions remain chain-derived.';
