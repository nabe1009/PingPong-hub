-- 主催チーム①②③ごとに都道府県を設定できるようにする（例: 京都府のTTCK）
alter table public.user_profiles
  add column if not exists org_prefecture_1 text,
  add column if not exists org_prefecture_2 text,
  add column if not exists org_prefecture_3 text;

comment on column public.user_profiles.org_prefecture_1 is '主催チーム①の都道府県';
comment on column public.user_profiles.org_prefecture_2 is '主催チーム②の都道府県';
comment on column public.user_profiles.org_prefecture_3 is '主催チーム③の都道府県';
