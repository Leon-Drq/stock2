alter table public.strategy_miner_candidates
  add column if not exists incubation_score integer,
  add column if not exists incubation_gate text,
  add column if not exists overfit_risk text,
  add column if not exists market_coverage integer,
  add column if not exists incubation_payload jsonb not null default '{}'::jsonb;

create index if not exists strategy_miner_candidates_incubation_idx
  on public.strategy_miner_candidates (incubation_gate, incubation_score desc, overfit_risk);
