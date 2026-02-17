"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  /** 参加費（例: 500円、無料） */
  fee: string | null;
  /** 繰り返しから外して単独予定にするときに null を渡す */
  recurrence_rule_id?: string | null;
  /** 主催チーム（teams.id）。省略時は更新しない */
  team_id?: string | null;
  /** チーム内限定公開。省略時は更新しない */
  is_private?: boolean;
};

export type UpdatePracticeResult = { success: boolean; error?: string };

export async function updatePractice(
  input: UpdatePracticeInput
): Promise<UpdatePracticeResult> {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "ログインしてください。" };
  }

  const supabase = await createSupabaseServerClient();
  const updatePayload: Record<string, unknown> = {
    event_date: input.event_date.trim(),
    start_time: input.start_time.trim().slice(0, 5).padStart(5, "0"),
    end_time: input.end_time.trim().slice(0, 5).padStart(5, "0"),
    location: input.location.trim(),
    max_participants: Math.max(1, Number(input.max_participants) || 1),
    content: input.content?.trim() || null,
    level: input.level?.trim() || null,
    conditions: input.conditions?.trim() || null,
    fee: input.fee?.trim() || null,
  };
  if (input.recurrence_rule_id !== undefined) {
    updatePayload.recurrence_rule_id = input.recurrence_rule_id;
  }
  if (input.team_id !== undefined) {
    updatePayload.team_id = input.team_id;
  }
  if (input.is_private !== undefined) {
    updatePayload.is_private = input.is_private;
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
