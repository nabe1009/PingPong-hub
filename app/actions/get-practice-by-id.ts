"use server";

import { unstable_noStore } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PracticeRow } from "@/lib/supabase/client";

export type PracticeWithTeamRow = PracticeRow & {
  teams?: { id: string; name: string } | null;
};

/**
 * 練習会をIDで1件取得。
 * RLS により見てよいデータだけが返る。
 */
export async function getPracticeById(
  practiceId: string
): Promise<
  { success: true; data: PracticeWithTeamRow } | { success: false; error: string }
> {
  unstable_noStore();
  if (!practiceId?.trim()) {
    return { success: false, error: "練習会IDが指定されていません" };
  }
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("practices")
    .select("*, teams(id, name)")
    .eq("id", practiceId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "練習会が見つかりません" };

  return { success: true, data: data as PracticeWithTeamRow };
}
