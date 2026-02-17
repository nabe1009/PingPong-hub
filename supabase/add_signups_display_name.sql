-- signups に display_name を追加（参加時の表示名を保存）
alter table public.signups
  add column if not exists display_name text;
