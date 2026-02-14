import { supabase } from "@/lib/supabase/client";
import type { PracticeCommentRow, PracticeCommentWithLikes } from "@/lib/supabase/client";

/** タイムライン表示名を user_profiles.display_name 優先にする */
export async function enrichCommentsWithDisplayNames(
  comments: PracticeCommentRow[]
): Promise<PracticeCommentRow[]> {
  if (comments.length === 0) return comments;
  const userIds = [...new Set(comments.map((c) => c.user_id))];
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);
  const nameByUserId: Record<string, string | null> = {};
  for (const p of profiles ?? []) {
    const row = p as { user_id: string; display_name: string | null };
    nameByUserId[row.user_id] = row.display_name?.trim() ?? null;
  }
  return comments.map((c) => ({
    ...c,
    display_name:
      nameByUserId[c.user_id] ?? c.display_name ?? c.user_name ?? null,
  }));
}

/** コメント一覧にいいね数・自分がいいね済み・いいねした人の表示名を付与 */
export async function enrichCommentsWithLikes(
  comments: PracticeCommentRow[],
  currentUserId: string | null
): Promise<PracticeCommentWithLikes[]> {
  if (comments.length === 0) return [];
  const commentIds = comments.map((c) => c.id);
  const { data: likes } = await supabase
    .from("comment_likes")
    .select("comment_id, user_id")
    .in("comment_id", commentIds);
  const byComment = new Map<string, { count: number; likedByMe: boolean; userIds: string[] }>();
  for (const c of comments) byComment.set(c.id, { count: 0, likedByMe: false, userIds: [] });
  for (const row of likes ?? []) {
    const r = row as { comment_id: string; user_id: string };
    const cur = byComment.get(r.comment_id);
    if (!cur) continue;
    byComment.set(r.comment_id, {
      count: cur.count + 1,
      likedByMe: cur.likedByMe || r.user_id === currentUserId,
      userIds: [...cur.userIds, r.user_id],
    });
  }
  const allUserIds = [...new Set((likes ?? []).map((r: { user_id: string }) => r.user_id))];
  const nameByUserId: Record<string, string> = {};
  if (allUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", allUserIds);
    for (const p of profiles ?? []) {
      const row = p as { user_id: string; display_name: string | null };
      nameByUserId[row.user_id] = (row.display_name?.trim() || "名前未設定") as string;
    }
  }
  return comments.map((c) => {
    const cur = byComment.get(c.id) ?? { count: 0, likedByMe: false, userIds: [] };
    const liked_by_display_names = cur.userIds.map((uid) =>
      uid === currentUserId ? "自分" : (nameByUserId[uid] ?? "名前未設定")
    );
    return {
      ...c,
      likes_count: cur.count,
      is_liked_by_me: cur.likedByMe,
      liked_by_display_names,
    };
  });
}
