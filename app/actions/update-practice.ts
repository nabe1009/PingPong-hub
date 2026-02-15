"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type UpdatePracticeInput = {
  id: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  content: string | null;
  level: string | null;
  conditions: string | null;
  /** 繰り返しから外して単独予定にするときに null を渡す */
  recurrence_rule_id?: string | null;
};

export type UpdatePracticeResult = { success: boolean; error?: string };

export async function updatePractice(
  input: UpdatePracticeInput
): Promise<UpdatePracticeResult> {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "ログインしてください。" };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const updatePayload: Record<string, unknown> = {
    event_date: input.event_date.trim(),
    start_time: input.start_time.trim().slice(0, 5).padStart(5, "0"),
    end_time: input.end_time.trim().slice(0, 5).padStart(5, "0"),
    location: input.location.trim(),
    max_participants: Math.max(1, Number(input.max_participants) || 1),
    content: input.content?.trim() || null,
    level: input.level?.trim() || null,
    conditions: input.conditions?.trim() || null,
  };
  if (input.recurrence_rule_id !== undefined) {
    updatePayload.recurrence_rule_id = input.recurrence_rule_id;
  }
  const { error } = await supabase
    .from("practices")
    .update(updatePayload)
    .eq("id", input.id)
    .eq("user_id", user.id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/organizer");
  return { success: true };
}
