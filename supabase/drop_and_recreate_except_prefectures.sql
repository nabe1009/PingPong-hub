-- =============================================================================
-- prefectures_cities 以外のテーブルを削除し、現在のコードに必要なテーブルを再作成
-- すべて RLS 有効・UNRESTRICTED（select/insert/update/delete を public で許可）
-- Supabase Dashboard の SQL Editor で実行可能。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. prefectures_cities 以外を削除（外部キー依存の逆順）
-- -----------------------------------------------------------------------------
drop table if exists public.comment_likes;
drop table if exists public.signups;
drop table if exists public.practice_members;
drop table if exists public.practice_comments;
drop table if exists public.practices;
drop table if exists public.recurrence_rules;
drop table if exists public.team_members;
drop table if exists public.teams;
drop table if exists public.user_profiles;

-- -----------------------------------------------------------------------------
-- 2. teams（チームマスタ）
-- -----------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prefecture text not null,
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;
create policy "Allow read for all" on public.teams for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.teams for insert to public with check (true);
create policy "Allow update for all" on public.teams for update to public using (true) with check (true);
create policy "Allow delete for all" on public.teams for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 3. team_members（所属情報）
-- -----------------------------------------------------------------------------
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  team_id uuid references public.teams(id) on delete cascade,
  custom_team_name text,
  custom_prefecture text,
  created_at timestamptz not null default now()
);

create index if not exists idx_team_members_user_id on public.team_members (user_id);
create index if not exists idx_team_members_team_id on public.team_members (team_id);

alter table public.team_members enable row level security;
create policy "Allow read for all" on public.team_members for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.team_members for insert to public with check (true);
create policy "Allow update for all" on public.team_members for update to public using (true) with check (true);
create policy "Allow delete for all" on public.team_members for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 4. user_profiles（プロフィール・Clerk user_id を text で保存）
-- -----------------------------------------------------------------------------
create table public.user_profiles (
  user_id text primary key,
  display_name text,
  prefecture text,
  affiliation text,
  career text,
  play_style text,
  dominant_hand text,
  achievements text,
  is_organizer boolean not null default false,
  org_name_1 text,
  org_name_2 text,
  org_name_3 text,
  racket text,
  forehand_rubber text,
  backhand_rubber text,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
create policy "Allow read for all" on public.user_profiles for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.user_profiles for insert to public with check (true);
create policy "Allow update for all" on public.user_profiles for update to public using (true) with check (true);
create policy "Allow delete for all" on public.user_profiles for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 5. recurrence_rules（繰り返しルール）
-- -----------------------------------------------------------------------------
create table public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null check (type in ('weekly', 'monthly_date', 'monthly_nth')),
  day_of_week smallint check (day_of_week >= 0 and day_of_week <= 6),
  nth_week smallint check (nth_week >= 1 and nth_week <= 5),
  end_date date not null
);

create index if not exists idx_recurrence_rules_end_date on public.recurrence_rules (end_date);

alter table public.recurrence_rules enable row level security;
create policy "Allow read for all" on public.recurrence_rules for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.recurrence_rules for insert to public with check (true);
create policy "Allow update for all" on public.recurrence_rules for update to public using (true) with check (true);
create policy "Allow delete for all" on public.recurrence_rules for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 6. practices（練習会）
-- -----------------------------------------------------------------------------
create table public.practices (
  id uuid primary key default gen_random_uuid(),
  team_name text,
  prefecture text,
  city text,
  event_date date not null,
  start_time text not null,
  end_time text not null,
  location text not null,
  max_participants integer not null check (max_participants >= 1),
  content text,
  level text,
  conditions text,
  fee text,
  user_id text not null,
  display_name text,
  recurrence_rule_id uuid references public.recurrence_rules(id) on delete set null,
  is_private boolean not null default false,
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_practices_event_date on public.practices (event_date);
create index if not exists idx_practices_user_id on public.practices (user_id);
create index if not exists idx_practices_recurrence_rule_id on public.practices (recurrence_rule_id);
create index if not exists idx_practices_team_id on public.practices (team_id);

alter table public.practices enable row level security;
create policy "Allow read for all" on public.practices for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.practices for insert to public with check (true);
create policy "Allow update for all" on public.practices for update to public using (true) with check (true);
create policy "Allow delete for all" on public.practices for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 7. practice_members（参加者・一言コメント）
-- -----------------------------------------------------------------------------
create table public.practice_members (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id text not null,
  comment text not null,
  created_at timestamptz not null default now(),
  unique(practice_id, user_id)
);

create index if not exists idx_practice_members_practice_id on public.practice_members (practice_id);

alter table public.practice_members enable row level security;
create policy "Allow read for all" on public.practice_members for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.practice_members for insert to public with check (true);
create policy "Allow update for all" on public.practice_members for update to public using (true) with check (true);
create policy "Allow delete for all" on public.practice_members for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 8. signups（定員計算用・1人1練習1行）
-- -----------------------------------------------------------------------------
create table public.signups (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  unique(practice_id, user_id)
);

create index if not exists idx_signups_practice_id on public.signups (practice_id);
create index if not exists idx_signups_user_id on public.signups (user_id);

alter table public.signups enable row level security;
create policy "Allow read for all" on public.signups for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.signups for insert to public with check (true);
create policy "Allow update for all" on public.signups for update to public using (true) with check (true);
create policy "Allow delete for all" on public.signups for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 9. practice_comments（参加・キャンセル・コメント履歴）
-- -----------------------------------------------------------------------------
create table public.practice_comments (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id text not null,
  type text not null check (type in ('join', 'cancel', 'comment')),
  comment text,
  user_name text,
  display_name text,
  user_avatar_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_comments_practice_id on public.practice_comments (practice_id);
create index if not exists idx_practice_comments_created_at on public.practice_comments (created_at);

alter table public.practice_comments enable row level security;
create policy "Allow read for all" on public.practice_comments for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.practice_comments for insert to public with check (true);
create policy "Allow update for all" on public.practice_comments for update to public using (true) with check (true);
create policy "Allow delete for all" on public.practice_comments for delete to public using (true);

-- -----------------------------------------------------------------------------
-- 10. comment_likes（コメントいいね・comment_id は text）
-- -----------------------------------------------------------------------------
create table public.comment_likes (
  user_id text not null,
  comment_id text not null,
  primary key (user_id, comment_id)
);

create index if not exists idx_comment_likes_comment_id on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;
create policy "Allow read for all" on public.comment_likes for select to public using (true);
create policy "Allow insert for authenticated or anon" on public.comment_likes for insert to public with check (true);
create policy "Allow update for all" on public.comment_likes for update to public using (true) with check (true);
create policy "Allow delete for all" on public.comment_likes for delete to public using (true);
