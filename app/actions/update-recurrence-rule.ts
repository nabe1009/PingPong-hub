"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import {
  addWeeks,
  addMonths,
  getDay,
  getDate,
  getMonth,
  addDays,
  isBefore,
  isAfter,
  parseISO,
  format,
} from "date-fns";
import type { PracticeRow, RecurrenceRuleRow } from "@/lib/supabase/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** 指定月の「第 nth 回目の weekday」の日付を返す */
function getNthWeekdayInMonth(year: number, month: number, dayOfWeek: number, nth: number): Date | null {
  const monthStart = new Date(year, month, 1);
  const firstDow = getDay(monthStart);
  const daysUntilFirst = (dayOfWeek - firstDow + 7) % 7;
  const firstOccurrence = addDays(monthStart, daysUntilFirst);
  const candidate = addDays(firstOccurrence, (nth - 1) * 7);
  if (getMonth(candidate) !== month) return null;
  return candidate;
}

function expandRecurrenceDates(
  startDateStr: string,
  endDateStr: string,
  type: "weekly" | "monthly_date" | "monthly_nth",
  dayOfWeek: number,
  nthWeek: number
): string[] {
  const start = parseISO(startDateStr);
  const end = parseISO(endDateStr);
  if (isAfter(start, end)) return [];

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
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    const monthEnd = y === end.getFullYear() ? end.getMonth() : 11;
    for (let m = y === start.getFullYear() ? start.getMonth() : 0; m <= monthEnd; m++) {
      const candidate = getNthWeekdayInMonth(y, m, dayOfWeek, nthWeek);
      if (candidate && !isBefore(candidate, start) && !isAfter(candidate, end)) {
        out.push(format(candidate, "yyyy-MM-dd"));
      }
    }
  }
  return out.sort();
}

export type UpdateRecurrenceRuleResult = { success: boolean; error?: string };

export async function updateRecurrenceRuleEndDate(
  ruleId: string,
  newEndDate: string
): Promise<UpdateRecurrenceRuleResult> {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "ログインしてください。" };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: rule, error: ruleError } = await supabase
    .from("recurrence_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("user_id", user.id)
    .single();

  if (ruleError || !rule) {
    return { success: false, error: ruleError?.message ?? "繰り返しルールが見つかりません。" };
  }

  const typedRule = rule as RecurrenceRuleRow;
  const oldEndDate = typedRule.end_date;
  const newEnd = newEndDate.trim();
  if (!newEnd) return { success: false, error: "終了日を入力してください。" };

  const yearEnd = `${new Date().getFullYear()}-12-31`;
  if (newEnd > yearEnd) return { success: false, error: "繰り返しの終了日は年内を指定してください。" };

  const { error: updateRuleError } = await supabase
    .from("recurrence_rules")
    .update({ end_date: newEnd })
    .eq("id", ruleId)
    .eq("user_id", user.id);

  if (updateRuleError) return { success: false, error: updateRuleError.message };

  if (isAfter(parseISO(newEnd), parseISO(oldEndDate))) {
    const { data: practices } = await supabase
      .from("practices")
      .select("*")
      .eq("recurrence_rule_id", ruleId)
      .order("event_date", { ascending: false })
      .limit(1);
    const template = (practices as PracticeRow[])?.[0];
    if (!template) {
      revalidatePath("/");
      revalidatePath("/organizer");
      return { success: true };
    }
    const { data: allPractices } = await supabase
      .from("practices")
      .select("event_date")
      .eq("recurrence_rule_id", ruleId);
    const dates = (allPractices as { event_date: string }[]) ?? [];
    const maxDate = dates.length ? dates.reduce((a, b) => (a.event_date > b.event_date ? a : b)).event_date : null;
    const startFrom = maxDate ? format(addDays(parseISO(maxDate), 1), "yyyy-MM-dd") : template.event_date;
    const dayOfWeek = typedRule.day_of_week ?? getDay(parseISO(template.event_date));
    const nthWeek = typedRule.nth_week ?? Math.min(5, Math.max(1, Math.ceil(getDate(parseISO(template.event_date)) / 7)));
    const newDates = expandRecurrenceDates(startFrom, newEnd, typedRule.type, dayOfWeek, nthWeek);
    if (newDates.length === 0) {
      revalidatePath("/");
      revalidatePath("/organizer");
      return { success: true };
    }
    const rows = newDates.map((event_date) => ({
      team_name: template.team_name,
      event_date,
      start_time: template.start_time,
      end_time: template.end_time,
      location: template.location,
      max_participants: template.max_participants,
      content: template.content,
      level: template.level,
      conditions: template.conditions,
      user_id: template.user_id,
      display_name: template.display_name,
      recurrence_rule_id: ruleId,
    }));
    const { error: insertError } = await supabase.from("practices").insert(rows);
    if (insertError) {
      await supabase.from("recurrence_rules").update({ end_date: oldEndDate }).eq("id", ruleId).eq("user_id", user.id);
      return { success: false, error: insertError.message };
    }
  } else if (isBefore(parseISO(newEnd), parseISO(oldEndDate))) {
    const { error: deleteError } = await supabase
      .from("practices")
      .delete()
      .eq("recurrence_rule_id", ruleId)
      .gt("event_date", newEnd);
    if (deleteError) {
      await supabase.from("recurrence_rules").update({ end_date: oldEndDate }).eq("id", ruleId).eq("user_id", user.id);
      return { success: false, error: deleteError.message };
    }
  }

  revalidatePath("/");
  revalidatePath("/organizer");
  return { success: true };
}
