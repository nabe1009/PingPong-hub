"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ToggleCommentLikeResult = { success: boolean; error?: string; liked?: boolean };

export async function likeComment(commentId: string): Promise<ToggleCommentLikeResult> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("comment_likes").insert({ user_id: user.id, comment_id: commentId });

  if (error) {
    if (error.code === "23505") return { success: true, liked: true };
    return { success: false, error: error.message };
  }
  revalidatePath("/");
  return { success: true, liked: true };
}

export async function unlikeComment(commentId: string): Promise<ToggleCommentLikeResult> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("comment_likes")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", user.id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/");
  return { success: true, liked: false };
}
