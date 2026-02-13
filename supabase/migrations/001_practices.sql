-- practices テーブル（Supabase Dashboard の SQL Editor で実行するか、Supabase CLI で適用）
create table if not exists public.practices (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time text not null,
  end_time text not null,
  location text not null,
  capacity integer not null check (capacity >= 1),
  created_by text not null,
  created_at timestamptz not null default now()
);

-- RLS を有効化（必要に応じてポリシーを追加）
alter table public.practices enable row level security;

-- 全員が読み取り可能・認証ユーザーが挿入可能な例（Clerk の userId を created_by に保存するため、anon でも挿入を許可する場合はポリシーで調整）
create policy "Allow read for all" on public.practices for select using (true);
create policy "Allow insert for authenticated or anon" on public.practices for insert with check (true);
