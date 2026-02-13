-- アカウント設定「使用用具」用テーブル（Supabase SQL Editor で実行）
-- user_id は Clerk の userId を想定。認証は Clerk のため、RLS は未使用（アプリ側で user_id を限定して読み書き）
create table if not exists public.user_profiles (
  user_id text primary key,
  racket text,
  forehand_rubber text,
  backhand_rubber text,
  updated_at timestamptz not null default now()
);
