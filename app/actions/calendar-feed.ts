"use server";

import { auth } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * ログインユーザーのカレンダー登録用URLを取得する。
 * 未発行の場合はトークンを発行してからURLを返す。
 */
export async function getOrCreateCalendarFeedUrl(
  origin: string
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, error: "ログインしてください" };
  }

  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("calendar_feed_token")
    .eq("user_id", userId)
    .maybeSingle();

  const row = profile as { calendar_feed_token: string | null } | null;
  let token = row?.calendar_feed_token?.trim() ?? null;

  if (!token) {
    token = crypto.randomUUID();
    if (row) {
      const { error } = await supabase
        .from("user_profiles")
        .update({ calendar_feed_token: token })
        .eq("user_id", userId);
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await supabase.from("user_profiles").insert({
        user_id: userId,
        calendar_feed_token: token,
      });
      if (error) return { success: false, error: error.message };
    }
  }

  const base = origin.replace(/\/$/, "");
  const url = `${base}/api/calendar/feed?token=${encodeURIComponent(token)}`;
  return { success: true, url };
}
