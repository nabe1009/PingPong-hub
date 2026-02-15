-- team_members に custom_prefecture カラムを追加（手入力チームの都道府県用）
alter table public.team_members
  add column if not exists custom_prefecture text;
