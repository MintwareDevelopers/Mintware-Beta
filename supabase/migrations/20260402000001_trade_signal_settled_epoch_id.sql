alter table if exists public.trade_signals
  add column if not exists settled_epoch_id uuid;
