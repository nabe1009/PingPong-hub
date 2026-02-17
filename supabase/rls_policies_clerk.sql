-- =============================================================================
-- RLS ポリシーを Clerk 連携用に変更（auth.jwt() ->> 'sub' = user_id）
-- drop_and_recreate_except_prefectures.sql 適用後に実行する。
-- 未ログインは JWT が null のため、制限付き操作は不可。
-- =============================================================================

-- 共通: ログインユーザーの sub（Clerk user id）を取得する条件
-- (auth.jwt() ->> 'sub') = user_id

-- -----------------------------------------------------------------------------
-- 1. teams（チームマスタ・user_id なし＝作成者不明のため「ログイン済みのみ書き込み可」）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.teams;
drop policy if exists "Allow insert for authenticated or anon" on public.teams;
drop policy if exists "Allow update for all" on public.teams;
drop policy if exists "Allow delete for all" on public.teams;

create policy "teams_select_public"
  on public.teams for select to public using (true);

create policy "teams_insert_authenticated"
  on public.teams for insert to public
  with check ( (auth.jwt() ->> 'sub') is not null );

create policy "teams_update_authenticated"
  on public.teams for update to public
  using ( (auth.jwt() ->> 'sub') is not null )
  with check ( (auth.jwt() ->> 'sub') is not null );

create policy "teams_delete_authenticated"
  on public.teams for delete to public
  using ( (auth.jwt() ->> 'sub') is not null );

-- -----------------------------------------------------------------------------
-- 2. team_members（自分の行のみ編集・削除、INSERT は自分を追加するときのみ）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.team_members;
drop policy if exists "Allow insert for authenticated or anon" on public.team_members;
drop policy if exists "Allow update for all" on public.team_members;
drop policy if exists "Allow delete for all" on public.team_members;

create policy "team_members_select_public"
  on public.team_members for select to public using (true);

create policy "team_members_insert_own"
  on public.team_members for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "team_members_update_own"
  on public.team_members for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "team_members_delete_own"
  on public.team_members for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );

-- -----------------------------------------------------------------------------
-- 3. user_profiles（自分の行のみ編集・削除、INSERT は自分用のみ）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.user_profiles;
drop policy if exists "Allow insert for authenticated or anon" on public.user_profiles;
drop policy if exists "Allow update for all" on public.user_profiles;
drop policy if exists "Allow delete for all" on public.user_profiles;

create policy "user_profiles_select_public"
  on public.user_profiles for select to public using (true);

create policy "user_profiles_insert_own"
  on public.user_profiles for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "user_profiles_update_own"
  on public.user_profiles for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "user_profiles_delete_own"
  on public.user_profiles for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );

-- -----------------------------------------------------------------------------
-- 4. recurrence_rules（自分の行のみ操作）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.recurrence_rules;
drop policy if exists "Allow insert for authenticated or anon" on public.recurrence_rules;
drop policy if exists "Allow update for all" on public.recurrence_rules;
drop policy if exists "Allow delete for all" on public.recurrence_rules;

create policy "recurrence_rules_select_public"
  on public.recurrence_rules for select to public using (true);

create policy "recurrence_rules_insert_own"
  on public.recurrence_rules for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "recurrence_rules_update_own"
  on public.recurrence_rules for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "recurrence_rules_delete_own"
  on public.recurrence_rules for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );

-- -----------------------------------------------------------------------------
-- 5. practices（作成者＝user_id のみ更新・削除、INSERT は自分を user_id で登録）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.practices;
drop policy if exists "Allow insert for authenticated or anon" on public.practices;
drop policy if exists "Allow update for all" on public.practices;
drop policy if exists "Allow delete for all" on public.practices;

create policy "practices_select_public"
  on public.practices for select to public using (true);

create policy "practices_insert_own"
  on public.practices for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "practices_update_own"
  on public.practices for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "practices_delete_own"
  on public.practices for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );

-- -----------------------------------------------------------------------------
-- 6. practice_members（自分＝user_id の行のみ追加・更新・削除）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.practice_members;
drop policy if exists "Allow insert for authenticated or anon" on public.practice_members;
drop policy if exists "Allow update for all" on public.practice_members;
drop policy if exists "Allow delete for all" on public.practice_members;

create policy "practice_members_select_public"
  on public.practice_members for select to public using (true);

create policy "practice_members_insert_own"
  on public.practice_members for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "practice_members_update_own"
  on public.practice_members for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "practice_members_delete_own"
  on public.practice_members for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );

-- -----------------------------------------------------------------------------
-- 7. signups（自分＝user_id の行のみ追加・更新・削除）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.signups;
drop policy if exists "Allow insert for authenticated or anon" on public.signups;
drop policy if exists "Allow update for all" on public.signups;
drop policy if exists "Allow delete for all" on public.signups;

create policy "signups_select_public"
  on public.signups for select to public using (true);

create policy "signups_insert_own"
  on public.signups for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "signups_update_own"
  on public.signups for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "signups_delete_own"
  on public.signups for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );

-- -----------------------------------------------------------------------------
-- 8. practice_comments（自分＝user_id の行のみ追加・更新・削除）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.practice_comments;
drop policy if exists "Allow insert for authenticated or anon" on public.practice_comments;
drop policy if exists "Allow update for all" on public.practice_comments;
drop policy if exists "Allow delete for all" on public.practice_comments;

create policy "practice_comments_select_public"
  on public.practice_comments for select to public using (true);

create policy "practice_comments_insert_own"
  on public.practice_comments for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "practice_comments_update_own"
  on public.practice_comments for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "practice_comments_delete_own"
  on public.practice_comments for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );

-- -----------------------------------------------------------------------------
-- 9. comment_likes（自分＝user_id の行のみ追加・削除。更新は実質なし）
-- -----------------------------------------------------------------------------
drop policy if exists "Allow read for all" on public.comment_likes;
drop policy if exists "Allow insert for authenticated or anon" on public.comment_likes;
drop policy if exists "Allow update for all" on public.comment_likes;
drop policy if exists "Allow delete for all" on public.comment_likes;

create policy "comment_likes_select_public"
  on public.comment_likes for select to public using (true);

create policy "comment_likes_insert_own"
  on public.comment_likes for insert to public
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "comment_likes_update_own"
  on public.comment_likes for update to public
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "comment_likes_delete_own"
  on public.comment_likes for delete to public
  using ( (auth.jwt() ->> 'sub') = user_id );
