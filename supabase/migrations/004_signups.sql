-- 参加者管理（定員計算用・1人1練習1行）
create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  unique(practice_id, user_id)
);

create index if not exists idx_signups_practice_id on public.signups (practice_id);
create index if not exists idx_signups_user_id on public.signups (user_id);

alter table public.signups enable row level security;

create policy "Allow read for all" on public.signups for select using (true);
create policy "Allow insert for authenticated or anon" on public.signups for insert with check (true);
create policy "Allow delete for authenticated or anon" on public.signups for delete using (true);
