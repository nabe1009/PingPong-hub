"use server";

import { currentUser } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type ToggleResult = { success: boolean; error?: string };

export async function toggleParticipation(
  practiceId: string,
  action: "join" | "cancel",
  comment: string
): Promise<ToggleResult> {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "ログインしてください" };
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
  const user_avatar_url = user.imageUrl ?? null;

  if (action === "join") {
    const { error: signupError } = await supabase.from("signups").insert({
      practice_id: practiceId,
      user_id: user.id,
      display_name,
    });
    if (signupError) {
      return { success: false, error: signupError.message };
    }
    const { error: commentError } = await supabase.from("practice_comments").insert({
      practice_id: practiceId,
      user_id: user.id,
      type: "join",
      comment: comment.trim() || null,
      display_name,
      user_avatar_url,
    });
    if (commentError) {
      return { success: false, error: commentError.message };
    }
    return { success: true };
  }

  const { error: deleteError } = await supabase
    .from("signups")
    .delete()
    .eq("practice_id", practiceId)
    .eq("user_id", user.id);
  if (deleteError) {
    return { success: false, error: deleteError.message };
  }
  const { error: commentError } = await supabase.from("practice_comments").insert({
    practice_id: practiceId,
    user_id: user.id,
    type: "cancel",
    comment: comment.trim() || null,
    display_name,
    user_avatar_url,
  });
  if (commentError) {
    return { success: false, error: commentError.message };
  }
  return { success: true };
}
