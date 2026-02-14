-- 繰り返しルール（毎週・毎月日付・毎月第N曜日）
create table if not exists public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null check (type in ('weekly', 'monthly_date', 'monthly_nth')),
  day_of_week smallint check (day_of_week >= 0 and day_of_week <= 6),
  nth_week smallint check (nth_week >= 1 and nth_week <= 5),
  end_date date not null
);

create index if not exists idx_recurrence_rules_end_date on public.recurrence_rules (end_date);

alter table public.recurrence_rules enable row level security;
create policy "Allow read for all" on public.recurrence_rules for select using (true);
create policy "Allow insert for all" on public.recurrence_rules for insert with check (true);

-- practices に recurrence_rule_id を追加（既存の場合はスキップ）
alter table public.practices
  add column if not exists recurrence_rule_id uuid references public.recurrence_rules(id) on delete set null;

create index if not exists idx_practices_recurrence_rule_id on public.practices (recurrence_rule_id);
