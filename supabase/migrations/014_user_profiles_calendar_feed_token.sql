-- カレンダー登録用URL（.ics フィード）のトークン。NULL の場合は未発行。
alter table public.user_profiles
  add column if not exists calendar_feed_token text unique;

comment on column public.user_profiles.calendar_feed_token is 'カレンダーアプリに登録する .ics フィード用のトークン。URL に含めると参加予定の練習が取得できる';
