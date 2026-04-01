alter table if exists public.universal_reward_epochs
  add column if not exists distribution_id uuid references public.distributions(id) on delete set null;

alter table if exists public.universal_reward_epochs
  add column if not exists published_at timestamptz;

create unique index if not exists universal_reward_epochs_distribution_uidx
  on public.universal_reward_epochs (distribution_id)
  where distribution_id is not null;
