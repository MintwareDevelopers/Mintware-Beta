-- ai_agent_pnl
-- Tracks WETH net flow per agent as a PnL proxy.
-- Written by oracle-watcher. Read by GET /api/agents/[address].
-- No scoring impact — data-only.

create table if not exists ai_agent_pnl (
  address           text        primary key references ai_agent_profiles(address),
  total_eth_in      numeric     not null default 0,  -- total WETH received (in wei)
  total_eth_out     numeric     not null default 0,  -- total WETH sent (in wei)
  realized_pnl_eth  numeric     generated always as (total_eth_out - total_eth_in) stored,
  realized_pnl_usd  numeric     not null default 0,  -- USD at last update
  eth_price_usd     numeric     not null default 0,  -- ETH/USD at last update
  total_trades      integer     not null default 0,  -- outflow count (proxy for trade count)
  updated_at        timestamptz not null default now()
);

-- Fast lookup by PnL for leaderboard sorting
create index if not exists idx_ai_agent_pnl_address on ai_agent_pnl (address);
