-- 練習会の参加者（一言コメント必須・1人1回のみ）
create table if not exists public.practice_members (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id text not null,
  comment text not null,
  created_at timestamptz not null default now(),
  unique(practice_id, user_id)
);

create index if not exists idx_practice_members_practice_id
  on public.practice_members (practice_id);

alter table public.practice_members enable row level security;

create policy "Allow read for all"
  on public.practice_members for select using (true);

create policy "Allow insert for authenticated or anon"
  on public.practice_members for insert with check (true);
