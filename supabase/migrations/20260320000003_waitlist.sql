-- =============================================================================
-- Waitlist table — captures emails from landing page
-- =============================================================================

create table if not exists waitlist (
  id         uuid default gen_random_uuid() primary key,
  email      text not null unique,
  joined_at  timestamptz not null default now(),
  source     text default 'landing'
);

create index if not exists waitlist_joined_at on waitlist(joined_at desc);
