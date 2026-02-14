-- 主催者による練習の編集・削除用（サーバー側で user_id 一致を必須にすること）
create policy "Allow update for all" on public.practices for update using (true) with check (true);
create policy "Allow delete for all" on public.practices for delete using (true);
