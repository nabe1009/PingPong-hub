"use server";

import { currentUser } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SaveUserProfilePayload = {
  display_name: string;
  prefecture: string;
  career: string;
  play_style: string;
  dominant_hand: string;
  achievements: string;
  is_organizer: boolean;
  org_name_1: string | null;
  org_name_2: string | null;
  org_name_3: string | null;
  org_prefecture_1: string | null;
  org_prefecture_2: string | null;
  org_prefecture_3: string | null;
  racket: string;
  forehand_rubber: string;
  backhand_rubber: string;
};

export type SaveUserProfileResult = { success: true } | { success: false; error: string };

/**
 * プロフィールを保存。Clerk JWT 付きで Supabase に送るため RLS を通過する。
 */
export async function saveUserProfile(payload: SaveUserProfilePayload): Promise<SaveUserProfileResult> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: user.id,
      display_name: payload.display_name.trim(),
      prefecture: payload.prefecture.trim(),
      career: payload.career.trim(),
      play_style: payload.play_style.trim(),
      dominant_hand: payload.dominant_hand.trim(),
      achievements: payload.achievements.trim(),
      is_organizer: payload.is_organizer,
      org_name_1: payload.org_name_1?.trim() || null,
      org_name_2: payload.org_name_2?.trim() || null,
      org_name_3: payload.org_name_3?.trim() || null,
      org_prefecture_1: payload.org_prefecture_1?.trim() || null,
      org_prefecture_2: payload.org_prefecture_2?.trim() || null,
      org_prefecture_3: payload.org_prefecture_3?.trim() || null,
      racket: payload.racket.trim(),
      forehand_rubber: payload.forehand_rubber.trim(),
      backhand_rubber: payload.backhand_rubber.trim(),
    },
    { onConflict: "user_id" }
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}
