"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DeletePracticeResult = { success: boolean; error?: string };

export async function deletePractice(practiceId: string): Promise<DeletePracticeResult> {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "ログインしてください。" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("practices")
    .delete()
    .eq("id", practiceId)
    .eq("user_id", user.id)
    .select();

  if (error) return { success: false, error: error.message };
  // RLSやID不一致で削除されない場合でも error が null になることがあるため、件数で判定する
  if (!data || data.length === 0) {
    return { success: false, error: "削除対象が見つかりませんでした。権限またはIDを確認してください。" };
  }
  revalidatePath("/");
  revalidatePath("/organizer");
  return { success: true };
}
