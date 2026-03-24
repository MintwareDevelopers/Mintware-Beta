-- =============================================================================
-- AI Attribution schema — agent profiles, scores, MWP hashes, campaigns
-- Three-groupings: Rewards (agent scoring) + Web2 (leaderboard queries)
-- =============================================================================

-- ── Agent profiles ────────────────────────────────────────────────────────────
create table if not exists ai_agent_profiles (
  address          text        primary key,          -- wallet address (lowercase)
  erc8004_token_id bigint      default null,         -- linked ERC-8004 tokenId (optional)
  registered_at    timestamptz default now() not null,
  last_seen_at     timestamptz default now() not null
);

-- ── Agent scores (mirrors contract state for fast off-chain reads) ────────────
create table if not exists ai_agent_scores (
  address          text        primary key references ai_agent_profiles(address),
  behavior         numeric     not null default 0,
  contribution     numeric     not null default 0,
  risk             numeric     not null default 0,
  interpretability numeric     not null default 0,
  total_score      numeric     generated always as (
                     greatest(0, behavior + contribution + interpretability - risk)
                   ) stored,
  mwp_submissions  integer     not null default 0,
  is_transparent   boolean     not null default false,
  last_mwp_hash    text        default null,
  updated_at       timestamptz default now() not null
);

-- ── MWP hash log (one row per unique hash per agent) ─────────────────────────
create table if not exists ai_agent_mwp_hashes (
  id               bigserial   primary key,
  address          text        not null references ai_agent_profiles(address),
  mwp_hash         text        not null,
  submitted_at     timestamptz default now() not null,
  unique (address, mwp_hash)
);

-- ── Volume campaigns ──────────────────────────────────────────────────────────
create table if not exists ai_volume_campaigns (
  id               bigserial   primary key,
  campaign_id      bigint      not null unique,      -- matches contract campaignCount
  protocol_address text        not null,
  name             text        not null,
  target_volume    numeric     not null,
  start_time       timestamptz not null,
  end_time         timestamptz not null,
  active           boolean     not null default true,
  created_at       timestamptz default now() not null
);

-- ── Campaign volume per agent ─────────────────────────────────────────────────
create table if not exists ai_campaign_volume (
  id               bigserial   primary key,
  campaign_id      bigint      not null references ai_volume_campaigns(campaign_id),
  address          text        not null references ai_agent_profiles(address),
  volume_wei       numeric     not null default 0,   -- raw wei
  updated_at       timestamptz default now() not null,
  unique (campaign_id, address)
);

-- ── Leaderboard view (top 100 by total_score) ────────────────────────────────
create or replace view ai_agent_leaderboard as
  select
    p.address,
    p.erc8004_token_id,
    p.registered_at,
    s.behavior,
    s.contribution,
    s.risk,
    s.interpretability,
    s.total_score,
    s.mwp_submissions,
    s.is_transparent,
    s.last_mwp_hash,
    s.updated_at,
    rank() over (order by s.total_score desc, s.updated_at asc) as rank
  from ai_agent_profiles p
  join ai_agent_scores s on s.address = p.address
  order by s.total_score desc
  limit 100;

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_ai_agent_scores_total   on ai_agent_scores(total_score desc);
create index if not exists idx_ai_campaign_volume_camp  on ai_campaign_volume(campaign_id);
create index if not exists idx_ai_mwp_hashes_address   on ai_agent_mwp_hashes(address);

-- ── updated_at auto-trigger ───────────────────────────────────────────────────
create or replace function update_ai_score_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_agent_scores_updated_at on ai_agent_scores;
create trigger trg_ai_agent_scores_updated_at
  before update on ai_agent_scores
  for each row execute function update_ai_score_updated_at();
