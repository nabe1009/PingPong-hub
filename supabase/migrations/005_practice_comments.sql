-- 参加・キャンセル履歴（タイムライン表示用）
create table if not exists public.practice_comments (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id text not null,
  type text not null check (type in ('join', 'cancel')),
  comment text,
  user_name text,
  user_avatar_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_comments_practice_id on public.practice_comments (practice_id);
create index if not exists idx_practice_comments_created_at on public.practice_comments (created_at);

alter table public.practice_comments enable row level security;

create policy "Allow read for all" on public.practice_comments for select using (true);
create policy "Allow insert for authenticated or anon" on public.practice_comments for insert with check (true);
