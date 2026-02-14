-- practice_comments.type に 'comment' を許可（コメント投稿機能用）
alter table public.practice_comments
  drop constraint if exists practice_comments_type_check;

alter table public.practice_comments
  add constraint practice_comments_type_check
  check (type in ('join', 'cancel', 'comment'));
