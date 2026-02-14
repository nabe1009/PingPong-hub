-- コメントいいね用（user_id, comment_id）
create table if not exists public.comment_likes (
  user_id text not null,
  comment_id uuid not null,
  primary key (user_id, comment_id)
);

create index if not exists idx_comment_likes_comment_id on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;
create policy "Allow read for all" on public.comment_likes for select using (true);
create policy "Allow insert for authenticated or anon" on public.comment_likes for insert with check (true);
create policy "Allow delete for authenticated or anon" on public.comment_likes for delete using (true);
