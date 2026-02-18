-- =============================================================================
-- RLS パフォーマンス最適化: auth.jwt() をサブクエリで囲む
-- Supabase SQL エディタで実行
-- =============================================================================

-- 1. teams
drop policy if exists "teams_insert_authenticated" on public.teams;
drop policy if exists "teams_update_authenticated" on public.teams;
drop policy if exists "teams_delete_authenticated" on public.teams;

create policy "teams_insert_authenticated"
  on public.teams for insert to public
  with check ( (select auth.jwt() ->> 'sub') is not null );

create policy "teams_update_authenticated"
  on public.teams for update to public
  using ( (select auth.jwt() ->> 'sub') is not null )
  with check ( (select auth.jwt() ->> 'sub') is not null );

create policy "teams_delete_authenticated"
  on public.teams for delete to public
  using ( (select auth.jwt() ->> 'sub') is not null );

-- 2. team_members
drop policy if exists "team_members_insert_own" on public.team_members;
drop policy if exists "team_members_update_own" on public.team_members;
drop policy if exists "team_members_delete_own" on public.team_members;

create policy "team_members_insert_own"
  on public.team_members for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "team_members_update_own"
  on public.team_members for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "team_members_delete_own"
  on public.team_members for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );

-- 3. user_profiles
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;
drop policy if exists "user_profiles_delete_own" on public.user_profiles;

create policy "user_profiles_insert_own"
  on public.user_profiles for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "user_profiles_update_own"
  on public.user_profiles for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "user_profiles_delete_own"
  on public.user_profiles for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );

-- 4. recurrence_rules
drop policy if exists "recurrence_rules_insert_own" on public.recurrence_rules;
drop policy if exists "recurrence_rules_update_own" on public.recurrence_rules;
drop policy if exists "recurrence_rules_delete_own" on public.recurrence_rules;

create policy "recurrence_rules_insert_own"
  on public.recurrence_rules for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "recurrence_rules_update_own"
  on public.recurrence_rules for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "recurrence_rules_delete_own"
  on public.recurrence_rules for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );

-- 5. practices
drop policy if exists "practices_insert_own" on public.practices;
drop policy if exists "practices_update_own" on public.practices;
drop policy if exists "practices_delete_own" on public.practices;

create policy "practices_insert_own"
  on public.practices for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "practices_update_own"
  on public.practices for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "practices_delete_own"
  on public.practices for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );

-- 6. practice_members
drop policy if exists "practice_members_insert_own" on public.practice_members;
drop policy if exists "practice_members_update_own" on public.practice_members;
drop policy if exists "practice_members_delete_own" on public.practice_members;

create policy "practice_members_insert_own"
  on public.practice_members for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "practice_members_update_own"
  on public.practice_members for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "practice_members_delete_own"
  on public.practice_members for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );

-- 7. signups
drop policy if exists "signups_insert_own" on public.signups;
drop policy if exists "signups_update_own" on public.signups;
drop policy if exists "signups_delete_own" on public.signups;

create policy "signups_insert_own"
  on public.signups for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "signups_update_own"
  on public.signups for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "signups_delete_own"
  on public.signups for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );

-- 8. practice_comments
drop policy if exists "practice_comments_insert_own" on public.practice_comments;
drop policy if exists "practice_comments_update_own" on public.practice_comments;
drop policy if exists "practice_comments_delete_own" on public.practice_comments;

create policy "practice_comments_insert_own"
  on public.practice_comments for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "practice_comments_update_own"
  on public.practice_comments for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "practice_comments_delete_own"
  on public.practice_comments for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );

-- 9. comment_likes
drop policy if exists "comment_likes_insert_own" on public.comment_likes;
drop policy if exists "comment_likes_update_own" on public.comment_likes;
drop policy if exists "comment_likes_delete_own" on public.comment_likes;

create policy "comment_likes_insert_own"
  on public.comment_likes for insert to public
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "comment_likes_update_own"
  on public.comment_likes for update to public
  using ( (select auth.jwt() ->> 'sub') = user_id )
  with check ( (select auth.jwt() ->> 'sub') = user_id );

create policy "comment_likes_delete_own"
  on public.comment_likes for delete to public
  using ( (select auth.jwt() ->> 'sub') = user_id );
