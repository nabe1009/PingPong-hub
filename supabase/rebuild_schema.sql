-- =============================================================================
-- 全テーブル削除 → 現在の構築に必要なスキーマを再作成
-- 実行前にバックアップを推奨。Supabase Dashboard の SQL Editor で実行可能。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 全テーブル削除（外部キー依存の逆順）
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
drop table if exists public.prefectures_cities;

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
create policy "teams_select_public" on public.teams for select to public using (true);
create policy "teams_insert_authenticated" on public.teams for insert to authenticated with check (true);
create policy "teams_update_authenticated" on public.teams for update to authenticated using (true) with check (true);
create policy "teams_delete_authenticated" on public.teams for delete to authenticated using (true);

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
create policy "team_members_select_public" on public.team_members for select to public using (true);
create policy "team_members_insert_all" on public.team_members for insert with check (true);
create policy "team_members_delete_all" on public.team_members for delete using (true);

-- -----------------------------------------------------------------------------
-- 4. user_profiles（プロフィール・Clerk user_id を text で保存）
-- -----------------------------------------------------------------------------
create table public.user_profiles (
  user_id text primary key,
  display_name text,
  prefecture text,
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
create policy "recurrence_rules_select_public" on public.recurrence_rules for select to public using (true);
create policy "recurrence_rules_insert_all" on public.recurrence_rules for insert with check (true);

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
create policy "practices_select_public" on public.practices for select to public using (true);
create policy "practices_insert_anon" on public.practices for insert with check (true);
create policy "practices_update_all" on public.practices for update using (true) with check (true);
create policy "practices_delete_all" on public.practices for delete using (true);

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
create policy "practice_members_select_public" on public.practice_members for select to public using (true);
create policy "practice_members_insert_all" on public.practice_members for insert with check (true);

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
create policy "signups_select_public" on public.signups for select to public using (true);
create policy "signups_insert_all" on public.signups for insert with check (true);
create policy "signups_delete_all" on public.signups for delete using (true);

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
create policy "practice_comments_select_public" on public.practice_comments for select to public using (true);
create policy "practice_comments_insert_all" on public.practice_comments for insert with check (true);

-- -----------------------------------------------------------------------------
-- 10. comment_likes（コメントいいね・ID は text で扱う）
-- -----------------------------------------------------------------------------
create table public.comment_likes (
  user_id text not null,
  comment_id text not null,
  primary key (user_id, comment_id)
);

create index if not exists idx_comment_likes_comment_id on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;
create policy "comment_likes_select_public" on public.comment_likes for select to public using (true);
create policy "comment_likes_insert_all" on public.comment_likes for insert with check (true);
create policy "comment_likes_delete_all" on public.comment_likes for delete using (true);

-- -----------------------------------------------------------------------------
-- 11. prefectures_cities（都道府県・市区町村・居住地・練習会作成用）
-- -----------------------------------------------------------------------------
create table public.prefectures_cities (
  id serial primary key,
  prefecture_name text not null,
  city_name text not null
);

create index if not exists idx_prefectures_cities_prefecture on public.prefectures_cities (prefecture_name);

-- RLS は未設定（匿名読み取り可で運用する場合はポリシー追加）
alter table public.prefectures_cities enable row level security;
create policy "prefectures_cities_select_public" on public.prefectures_cities for select to public using (true);
