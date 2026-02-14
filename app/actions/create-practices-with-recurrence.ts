"use server";

import { currentUser } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import {
  addWeeks,
  addMonths,
  getDay,
  getDate,
  startOfMonth,
  addDays,
  isBefore,
  isAfter,
  parseISO,
  format,
  getMonth,
} from "date-fns";
import type { PracticeInsert, RecurrenceRuleInsert } from "@/lib/supabase/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type RecurrenceType = "none" | "weekly" | "monthly_date" | "monthly_nth";

export type CreatePracticesInput = {
  team_name: string;
  prefecture?: string | null;
  city?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  content?: string | null;
  level?: string | null;
  conditions?: string | null;
  recurrence_type: RecurrenceType;
  recurrence_end_date?: string | null;
};

export type CreatePracticesResult = { success: boolean; error?: string; count?: number };

/** 指定月の「第 nth 回目の weekday」の日付を返す。該当なしなら null */
function getNthWeekdayInMonth(year: number, month: number, dayOfWeek: number, nth: number): Date | null {
  const monthStart = startOfMonth(new Date(year, month, 1));
  const firstDow = getDay(monthStart);
  const daysUntilFirst = (dayOfWeek - firstDow + 7) % 7;
  const firstOccurrence = addDays(monthStart, daysUntilFirst);
  const candidate = addDays(firstOccurrence, (nth - 1) * 7);
  if (getMonth(candidate) !== month) return null;
  return candidate;
}

/** 開始日〜終了日の範囲で、ルールに合う日付リストを生成 */
function expandRecurrenceDates(
  startDateStr: string,
  endDateStr: string,
  type: "weekly" | "monthly_date" | "monthly_nth",
  dayOfWeek: number,
  nthWeek: number
): string[] {
  const start = parseISO(startDateStr);
  const end = parseISO(endDateStr);
  if (isAfter(start, end)) return [format(start, "yyyy-MM-dd")];

  const out: string[] = [];
  if (type === "weekly") {
    let d = start;
    while (!isAfter(d, end)) {
      out.push(format(d, "yyyy-MM-dd"));
      d = addWeeks(d, 1);
    }
    return out;
  }
  if (type === "monthly_date") {
    const dayOfMonth = getDate(start);
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (true) {
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const day = Math.min(dayOfMonth, lastDay);
      const candidate = new Date(d.getFullYear(), d.getMonth(), day);
      if (isAfter(candidate, end)) break;
      if (!isBefore(candidate, start)) out.push(format(candidate, "yyyy-MM-dd"));
      d = addMonths(d, 1);
    }
    return out;
  }
  // monthly_nth
  let d = start;
  const startYear = d.getFullYear();
  const startMonth = d.getMonth();
  for (let y = startYear; y <= end.getFullYear(); y++) {
    const monthEnd = y === end.getFullYear() ? end.getMonth() : 11;
    for (let m = y === startYear ? startMonth : 0; m <= monthEnd; m++) {
      const candidate = getNthWeekdayInMonth(y, m, dayOfWeek, nthWeek);
      if (candidate && !isBefore(candidate, start) && !isAfter(candidate, end)) {
        out.push(format(candidate, "yyyy-MM-dd"));
      }
    }
  }
  return out.sort();
}

export async function createPracticesWithRecurrence(
  input: CreatePracticesInput
): Promise<CreatePracticesResult> {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "ログインしてください。" };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  const display_name =
    (profile as { display_name: string | null } | null)?.display_name?.trim() ||
    user.fullName?.trim() ||
    user.firstName?.trim() ||
    user.username?.trim() ||
    null;

  // practices に prefecture/city カラムがない環境があるため、insert には含めない
  const base: Omit<PracticeInsert, "event_date" | "recurrence_rule_id" | "prefecture" | "city"> = {
    team_name: input.team_name.trim(),
    start_time: input.start_time.trim().slice(0, 5).padStart(5, "0"),
    end_time: input.end_time.trim().slice(0, 5).padStart(5, "0"),
    location: input.location.trim(),
    max_participants: Math.max(1, Number(input.max_participants) || 1),
    content: input.content?.trim() || null,
    level: input.level?.trim() || null,
    conditions: input.conditions?.trim() || null,
    user_id: user.id,
    display_name,
  };

  const recurrenceType = input.recurrence_type ?? "none";
  const endDateStr = (input.recurrence_end_date ?? "").trim();

  if (recurrenceType === "none" || !endDateStr) {
    const row = {
      ...base,
      event_date: input.event_date.trim(),
    };
    const { error } = await supabase.from("practices").insert(row);
    if (error) return { success: false, error: error.message };
    return { success: true, count: 1 };
  }

  const startDateStr = input.event_date.trim();
  const start = parseISO(startDateStr);
  const day_of_week = getDay(start);
  const nth_week = Math.min(5, Math.max(1, Math.ceil(getDate(start) / 7)));

  const ruleInsert: RecurrenceRuleInsert = {
    user_id: user.id,
    type: recurrenceType as "weekly" | "monthly_date" | "monthly_nth",
    end_date: endDateStr,
    day_of_week: recurrenceType !== "monthly_date" ? day_of_week : null,
    nth_week: recurrenceType === "monthly_nth" ? nth_week : null,
  };
  const { data: ruleRow, error: ruleError } = await supabase
    .from("recurrence_rules")
    .insert(ruleInsert)
    .select("id")
    .single();
  if (ruleError || !ruleRow) {
    return { success: false, error: ruleError?.message ?? "繰り返しルールの保存に失敗しました。" };
  }

  const dates = expandRecurrenceDates(
    startDateStr,
    endDateStr,
    ruleInsert.type,
    day_of_week,
    nth_week
  );
  if (dates.length === 0) {
    return { success: false, error: "条件に合う日付がありません。" };
  }

  const rows = dates.map((event_date) => ({
    ...base,
    event_date,
    recurrence_rule_id: ruleRow.id,
  }));

  const { error: insertError } = await supabase.from("practices").insert(rows);
  if (insertError) return { success: false, error: insertError.message };
  return { success: true, count: rows.length };
}
