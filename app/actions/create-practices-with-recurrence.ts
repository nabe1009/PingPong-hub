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

export type ConflictPractice = {
  event_date: string;
  start_time: string;
  end_time: string;
  team_name: string;
  location: string;
};

export type CreatePracticesResult = {
  success: boolean;
  error?: string;
  count?: number;
  /** 同時間・同一主催者・同一チーム名で既に登録済みの練習一覧 */
  conflictPractices?: ConflictPractice[];
};

/** 時刻を "HH:MM" に正規化（比較用） */
function toTimeMinutes(s: string): number {
  const part = s.trim().slice(0, 5);
  const [h, m] = part.split(":").map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

/** 同一日の時間帯が重複するか（開始・終了のどちらかが重なれば true） */
function timeRangesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = toTimeMinutes(start1);
  const e1 = toTimeMinutes(end1);
  const s2 = toTimeMinutes(start2);
  const e2 = toTimeMinutes(end2);
  return s1 < e2 && e1 > s2;
}

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
  const newStart = input.start_time.trim().slice(0, 5).padStart(5, "0");
  const newEnd = input.end_time.trim().slice(0, 5).padStart(5, "0");
  const teamNameTrim = input.team_name.trim();

  const yearEnd = `${new Date().getFullYear()}-12-31`;
  if (recurrenceType !== "none" && endDateStr && endDateStr > yearEnd) {
    return { success: false, error: "繰り返しの終了日は年内を指定してください。" };
  }

  /** 追加予定の (event_date, start_time, end_time) 一覧 */
  let datesToInsert: string[];
  if (recurrenceType === "none" || !endDateStr) {
    datesToInsert = [input.event_date.trim()];
  } else {
    const startDateStr = input.event_date.trim();
    const start = parseISO(startDateStr);
    const day_of_week = getDay(start);
    const nth_week = Math.min(5, Math.max(1, Math.ceil(getDate(start) / 7)));
    datesToInsert = expandRecurrenceDates(
      startDateStr,
      endDateStr,
      recurrenceType as "weekly" | "monthly_date" | "monthly_nth",
      day_of_week,
      nth_week
    );
  }

  /** 過去の開始日時は登録不可 */
  const now = new Date();
  for (const d of datesToInsert) {
    const startDatetime = new Date(`${d}T${newStart}:00`);
    if (startDatetime < now) {
      return { success: false, error: "練習の開始日時は現在以降を指定してください。" };
    }
  }

  /** 同主催者・同一チーム名の既存練習を取得（対象日のみ） */
  const { data: existingRows } = await supabase
    .from("practices")
    .select("event_date, start_time, end_time, team_name, location")
    .eq("user_id", user.id)
    .eq("team_name", teamNameTrim)
    .in("event_date", datesToInsert);

  const existing = (existingRows ?? []) as {
    event_date: string;
    start_time: string;
    end_time: string;
    team_name: string;
    location: string;
  }[];

  const conflictPractices: ConflictPractice[] = [];
  for (const d of datesToInsert) {
    for (const ex of existing) {
      if (ex.event_date !== d) continue;
      const exStart = (ex.start_time ?? "").trim().slice(0, 5).padStart(5, "0");
      const exEnd = (ex.end_time ?? "").trim().slice(0, 5).padStart(5, "0");
      if (timeRangesOverlap(newStart, newEnd, exStart, exEnd)) {
        if (!conflictPractices.some((c) => c.event_date === ex.event_date && c.start_time === exStart && c.end_time === exEnd)) {
          conflictPractices.push({
            event_date: ex.event_date,
            start_time: exStart,
            end_time: exEnd,
            team_name: ex.team_name,
            location: ex.location ?? "",
          });
        }
        break;
      }
    }
  }

  if (conflictPractices.length > 0) {
    return {
      success: false,
      error: "すでに同時間に同じ主催チーム名で登録済みの練習があります。",
      conflictPractices,
    };
  }

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
