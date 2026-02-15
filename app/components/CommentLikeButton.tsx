"use client";

import { useState, useTransition } from "react";
import { ThumbsUp, Info } from "lucide-react";
import { likeComment, unlikeComment } from "@/app/actions/toggle-comment-like";

type Props = {
  commentId: string;
  practiceId: string;
  liked: boolean;
  count: number;
  /** いいねした人の表示名（ホバー・長押しで表示、自分は「自分」） */
  likedByDisplayNames: string[];
  userId: string | null;
  onOptimisticUpdate: (payload: { practiceId: string; commentId: string; isLiked: boolean; count: number }) => void;
  onSuccess?: (practiceId: string) => void;
};

/** いいねアイコン（ThumbsUp のみ） */
function RacketLikeIcon({ liked, className = "" }: { liked: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      aria-hidden
    >
      <ThumbsUp
        size={18}
        strokeWidth={2.5}
        className={`shrink-0 transition ${liked ? "fill-red-500 text-red-500" : "text-gray-400"}`}
      />
    </span>
  );
}

export function CommentLikeButton({
  commentId,
  practiceId,
  liked,
  count,
  likedByDisplayNames,
  userId,
  onOptimisticUpdate,
  onSuccess,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const namesForTooltip =
    liked && userId && !likedByDisplayNames.includes("自分")
      ? [...likedByDisplayNames, "自分"]
      : likedByDisplayNames;
  const tooltipText =
    count > 0
      ? namesForTooltip.length > 0
        ? `いいね: ${namesForTooltip.join("、")}`
        : `${count}人がいいね`
      : liked
        ? "いいねを解除"
        : "いいねする";

  const [showWhoLiked, setShowWhoLiked] = useState(false);

  const handleClick = async () => {
    if (!userId) return;
    const nextLiked = !liked;
    const nextCount = count + (nextLiked ? 1 : -1);

    startTransition(() => {
      onOptimisticUpdate({ practiceId, commentId, isLiked: nextLiked, count: nextCount });
    });

    const result = nextLiked
      ? await likeComment(commentId)
      : await unlikeComment(commentId);
    if (!result.success) {
      startTransition(() => {
        onOptimisticUpdate({ practiceId, commentId, isLiked: liked, count });
      });
      return;
    }
    onSuccess?.(practiceId);
  };

  return (
    <span className="relative inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={!userId || isPending}
        className="inline-flex items-center gap-1 rounded-md p-1 transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={liked ? "いいねを解除" : "いいねする"}
        title={tooltipText}
      >
        <RacketLikeIcon liked={liked} />
        <span className="min-w-[1.25rem] text-left text-xs tabular-nums text-slate-600">
          {count}
        </span>
      </button>
      {count > 0 && namesForTooltip.length > 0 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowWhoLiked((v) => !v);
            }}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 touch-manipulation"
            aria-label="誰がいいねしたか"
            title="誰がいいねしたか（タップで表示）"
          >
            <Info size={14} />
          </button>
          {showWhoLiked && (
            <>
              <div
                className="fixed inset-0 z-10"
                aria-hidden
                onClick={() => setShowWhoLiked(false)}
              />
              <div
                className="absolute left-0 top-full z-20 mt-1 min-w-[8rem] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 shadow-lg"
                role="tooltip"
              >
                <p className="font-medium text-slate-500">いいねした人</p>
                <p className="mt-0.5">{namesForTooltip.join("、")}</p>
              </div>
            </>
          )}
        </>
      )}
    </span>
  );
}
