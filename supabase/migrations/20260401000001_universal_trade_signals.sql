create table if not exists public.trade_signals (
  id text primary key,
  chain_id bigint not null,
  pool_id text not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  swapper text not null,
  referrer text,
  amount_in_raw text not null,
  amount_out_raw text not null,
  dynamic_fee_bps integer not null default 0,
  capture_amount_raw text not null default '0',
  tick_after integer not null default 0,
  pyth_timestamp bigint not null default 0,
  hook_data text,
  observed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists trade_signals_chain_tx_log_uidx
  on public.trade_signals (chain_id, tx_hash, log_index);

create index if not exists trade_signals_pool_block_idx
  on public.trade_signals (pool_id, block_number desc);

create index if not exists trade_signals_swapper_idx
  on public.trade_signals (swapper);

alter table if exists public.trade_signals enable row level security;

create or replace function public.touch_trade_signal_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trade_signals_touch_updated_at on public.trade_signals;
create trigger trade_signals_touch_updated_at
before update on public.trade_signals
for each row
execute function public.touch_trade_signal_updated_at();
