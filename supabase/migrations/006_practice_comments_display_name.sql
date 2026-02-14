-- practice_comments に display_name を追加（既存は user_name のままでも可・新規は display_name に保存）
alter table public.practice_comments
  add column if not exists display_name text;
