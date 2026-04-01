create table if not exists public.trade_signal_sync_state (
  sync_key text primary key,
  chain_slug text not null,
  contract_address text not null,
  last_synced_block bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.trade_signal_sync_state enable row level security;

create or replace function public.touch_trade_signal_sync_state_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trade_signal_sync_state_touch_updated_at on public.trade_signal_sync_state;
create trigger trade_signal_sync_state_touch_updated_at
before update on public.trade_signal_sync_state
for each row
execute function public.touch_trade_signal_sync_state_updated_at();
