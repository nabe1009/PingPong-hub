"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PostCommentResult = { success: boolean; error?: string };

export async function postComment(
  practiceId: string,
  commentText: string
): Promise<PostCommentResult> {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "ログインしてください" };
  }

  const trimmed = (commentText ?? "").trim();

  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  const profileDisplayName = (profile as { display_name: string | null } | null)?.display_name?.trim() ?? null;
  const display_name =
    profileDisplayName ||
    user.fullName?.trim() ||
    user.firstName?.trim() ||
    user.username?.trim() ||
    null;
  const user_avatar_url = user.imageUrl ?? null;

  const { error } = await supabase.from("practice_comments").insert({
    practice_id: practiceId,
    user_id: user.id,
    type: "comment",
    comment: trimmed || null,
    display_name,
    user_avatar_url,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/");
  return { success: true };
}
