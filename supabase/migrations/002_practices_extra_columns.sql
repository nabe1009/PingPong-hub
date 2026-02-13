-- 画像のフォーム項目に対応するカラムを追加
-- Supabase Dashboard の SQL Editor で実行
alter table public.practices
  add column if not exists team_name text,
  add column if not exists content text default '',
  add column if not exists level text,
  add column if not exists requirements text;
