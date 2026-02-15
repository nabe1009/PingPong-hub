-- team_members の RLS ポリシー（Clerk 利用のため auth.uid() は使わず、アプリ側で user_id を検証）
alter table public.team_members enable row level security;

drop policy if exists "Allow read for all" on public.team_members;
drop policy if exists "Allow insert for all" on public.team_members;
drop policy if exists "Allow delete for all" on public.team_members;

create policy "Allow read for all" on public.team_members for select using (true);
create policy "Allow insert for all" on public.team_members for insert with check (true);
create policy "Allow delete for all" on public.team_members for delete using (true);
