-- 練習会のプライベートモード（チーム内限定公開）用カラム
alter table public.practices
  add column if not exists is_private boolean not null default false,
  add column if not exists team_id uuid null;

comment on column public.practices.is_private is 'true: チームメンバー限定公開';
comment on column public.practices.team_id is '主催チーム（teams.id）。is_private 時の閲覧判定に使用';
