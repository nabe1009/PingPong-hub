"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { supabase } from "@/lib/supabase/client";
import type { PracticeRow, SignupRow, PracticeCommentRow, PracticeCommentWithLikes } from "@/lib/supabase/client";
import { enrichCommentsWithDisplayNames, enrichCommentsWithLikes } from "@/lib/enrich-practice-comments";
import { Calendar, MapPin, Users, ArrowLeft, LogIn, List, CalendarDays, ChevronLeft, ChevronRight, X, CheckCircle, MessageCircle, LogOut } from "lucide-react";
import { toggleParticipation } from "@/app/actions/toggle-participation";
import { postComment } from "@/app/actions/post-practice-comment";
import { CommentLikeButton } from "@/app/components/CommentLikeButton";

type ViewMode = "list" | "month" | "week";

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

const WEEK_VIEW = {
  startHour: 6,
  endHour: 22,
  slotMinutes: 30,
  slotHeightPx: 28,
} as const;

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();
  const rows: (Date | null)[][] = [];
  let row: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) row.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    row.push(new Date(year, month, d));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) {
    while (row.length < 7) row.push(null);
    rows.push(row);
  }
  while (rows.length < 6) {
    rows.push(Array.from({ length: 7 }, () => null));
  }
  return rows;
}

function getWeekDates(weekStart: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    out.push(d);
  }
  return out;
}

function getTimeSlotIndex(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  const start = WEEK_VIEW.startHour;
  const end = WEEK_VIEW.endHour;
  if (hours < start || hours >= end) return -1;
  return Math.floor((hours - start) * (60 / WEEK_VIEW.slotMinutes));
}

/** 日付＋開始〜終了時間（例: 3/15（日）14:00〜16:00） */
function formatPracticeDate(isoStart: string, isoEnd?: string) {
  const d = new Date(isoStart);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const w = weekdays[d.getDay()];
  const startH = d.getHours();
  const startM = d.getMinutes();
  const startStr = `${startH}:${startM.toString().padStart(2, "0")}`;
  if (isoEnd) {
    const e = new Date(isoEnd);
    const endH = e.getHours();
    const endM = e.getMinutes();
    const endStr = `${endH}:${endM.toString().padStart(2, "0")}`;
    return `${month}/${day}（${w}）${startStr}〜${endStr}`;
  }
  return `${month}/${day}（${w}）${startStr}`;
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTimeRange(isoStart: string, isoEnd: string) {
  const s = new Date(isoStart);
  const e = new Date(isoEnd);
  const sh = s.getHours();
  const sm = s.getMinutes();
  const eh = e.getHours();
  const em = e.getMinutes();
  return `${sh}:${sm.toString().padStart(2, "0")}〜${eh}:${em.toString().padStart(2, "0")}`;
}

function formatParticipantLimit(current: number, max: number): string {
  return `${current}/${max}人`;
}

function formatParticipatedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

type PracticeItem = {
  id: string;
  date: string;
  endDate: string;
  teamName: string;
  location: string;
  content: string;
};

function practiceRowToItem(p: PracticeRow): PracticeItem {
  const isoStart = `${p.event_date}T${(p.start_time.length === 5 ? p.start_time : p.start_time + ":00").slice(0, 5)}:00`;
  const isoEnd = `${p.event_date}T${(p.end_time.length === 5 ? p.end_time : p.end_time + ":00").slice(0, 5)}:00`;
  return {
    id: p.id,
    date: isoStart,
    endDate: isoEnd,
    teamName: p.team_name ?? "練習会",
    location: p.location,
    content: p.content ?? "",
  };
}

function getPracticesInWeek(
  weekStart: Date,
  practices: PracticeItem[]
): (PracticeItem & { dayIndex: number; slotIndex: number; durationSlots: number })[] {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startTs = weekStart.getTime();
  const endTs = weekEnd.getTime();
  const result: (PracticeItem & { dayIndex: number; slotIndex: number; durationSlots: number })[] = [];
  for (const p of practices) {
    const d = new Date(p.date);
    const ts = d.getTime();
    if (ts < startTs || ts >= endTs) continue;
    const dayIndex = Math.floor((ts - startTs) / (24 * 60 * 60 * 1000));
    const slotIndex = getTimeSlotIndex(d);
    if (slotIndex < 0) continue;
    const endD = new Date(p.endDate);
    const durationMins = (endD.getTime() - d.getTime()) / (60 * 1000);
    const durationSlots = Math.max(1, Math.round(durationMins / WEEK_VIEW.slotMinutes));
    result.push({ ...p, dayIndex, slotIndex, durationSlots });
  }
  return result;
}

export default function MyPracticesPage() {
  const { userId, isLoaded } = useAuth();
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [practices, setPractices] = useState<PracticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  });
  const weekCalendarScrollRef = useRef<HTMLDivElement>(null);

  /** 練習詳細モーダルで表示する練習 ID（セットでモーダル表示） */
  const [selectedPracticeId, setSelectedPracticeId] = useState<string | null>(null);
  const [modalSignups, setModalSignups] = useState<SignupRow[]>([]);
  const [modalDisplayNames, setModalDisplayNames] = useState<Record<string, string>>({});
  const [modalComments, setModalComments] = useState<PracticeCommentWithLikes[]>([]);
  const [practiceModalCommentOpen, setPracticeModalCommentOpen] = useState(false);
  const [commentPopupPracticeId, setCommentPopupPracticeId] = useState<string | null>(null);
  const [commentPopupText, setCommentPopupText] = useState("");
  const [cancelTargetPracticeId, setCancelTargetPracticeId] = useState<string | null>(null);
  const [cancelComment, setCancelComment] = useState("");
  const [participationActionError, setParticipationActionError] = useState<string | null>(null);
  const [participationSubmitting, setParticipationSubmitting] = useState(false);
  const [freeCommentSubmitting, setFreeCommentSubmitting] = useState(false);
  const [freeCommentError, setFreeCommentError] = useState<string | null>(null);
  const [optimisticComments, setOptimisticComments] = useState<Record<string, PracticeCommentWithLikes[]>>({});

  useEffect(() => {
    if (!userId) {
      setSignups([]);
      setPractices([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: signupsData, error: signupsError } = await supabase
        .from("signups")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (signupsError || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const list = (signupsData as SignupRow[]) ?? [];
      if (!cancelled) setSignups(list);
      const practiceIds = [...new Set(list.map((s) => s.practice_id))];
      if (practiceIds.length === 0) {
        if (!cancelled) setPractices([]);
        if (!cancelled) setLoading(false);
        return;
      }
      const { data: practicesData, error: practicesError } = await supabase
        .from("practices")
        .select("*")
        .in("id", practiceIds);
      if (practicesError || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (!cancelled) setPractices((practicesData as PracticeRow[]) ?? []);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const sortedPractices = useMemo(() => {
    const byId = new Map(practices.map((p) => [p.id, p]));
    return signups
      .map((s) => byId.get(s.practice_id))
      .filter((p): p is PracticeRow => p != null)
      .sort((a, b) => {
        const da = `${a.event_date}T${(a.start_time.length === 5 ? a.start_time : a.start_time + ":00").slice(0, 5)}:00`;
        const db = `${b.event_date}T${(b.start_time.length === 5 ? b.start_time : b.start_time + ":00").slice(0, 5)}:00`;
        return new Date(da).getTime() - new Date(db).getTime();
      });
  }, [signups, practices]);

  const now = new Date();
  const upcoming = sortedPractices.filter((p) => {
    const iso = `${p.event_date}T${(p.start_time.length === 5 ? p.start_time : p.start_time + ":00").slice(0, 5)}:00`;
    return new Date(iso) >= now;
  });
  const past = sortedPractices.filter((p) => {
    const iso = `${p.event_date}T${(p.start_time.length === 5 ? p.start_time : p.start_time + ":00").slice(0, 5)}:00`;
    return new Date(iso) < now;
  });

  const practiceItems = useMemo(() => sortedPractices.map(practiceRowToItem), [sortedPractices]);
  const practicesByDateKey = useMemo(() => {
    const map: Record<string, PracticeItem[]> = {};
    for (const p of practiceItems) {
      const key = toDateKey(new Date(p.date));
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return map;
  }, [practiceItems]);
  const practicesInWeek = useMemo(
    () => getPracticesInWeek(calendarWeekStart, practiceItems),
    [calendarWeekStart, practiceItems]
  );

  useEffect(() => {
    if (viewMode !== "week") return;
    const el = weekCalendarScrollRef.current;
    if (!el) return;
    const slotsToScroll = ((9 - WEEK_VIEW.startHour) * 60) / WEEK_VIEW.slotMinutes;
    const scrollTop = slotsToScroll * WEEK_VIEW.slotHeightPx;
    const id = requestAnimationFrame(() => {
      el.scrollTop = scrollTop;
    });
    return () => cancelAnimationFrame(id);
  }, [viewMode, calendarWeekStart]);

  /** 練習詳細モーダル用データの取得（参加者・表示名・コメント） */
  const refetchModalData = useCallback(async (practiceId: string) => {
    const [signupsRes, commentsRes] = await Promise.all([
      supabase.from("signups").select("*").eq("practice_id", practiceId),
      supabase.from("practice_comments").select("*").eq("practice_id", practiceId).order("created_at", { ascending: true }),
    ]);
    const signups = (signupsRes.data as SignupRow[]) ?? [];
    const commentsRaw = (commentsRes.data as PracticeCommentRow[]) ?? [];
    const withNames = await enrichCommentsWithDisplayNames(commentsRaw);
    const withLikes = await enrichCommentsWithLikes(withNames, userId ?? null);
    setModalSignups(signups);
    setModalComments(withLikes);
    setOptimisticComments((prev) => ({ ...prev, [practiceId]: withLikes }));
    const userIds = [...new Set(signups.map((s) => s.user_id))];
    if (userIds.length === 0) {
      setModalDisplayNames({});
      return;
    }
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    const map: Record<string, string> = {};
    for (const p of profiles ?? []) {
      const row = p as { user_id: string; display_name: string | null };
      map[row.user_id] = row.display_name?.trim() || "名前未設定";
    }
    setModalDisplayNames(map);
  }, [userId]);

  useEffect(() => {
    if (!selectedPracticeId) return;
    setPracticeModalCommentOpen(false);
    refetchModalData(selectedPracticeId);
  }, [selectedPracticeId, refetchModalData]);

  const confirmCancelParticipation = useCallback(
    async (practiceId: string, cancelCommentText: string) => {
      setParticipationActionError(null);
      setParticipationSubmitting(true);
      try {
        const result = await toggleParticipation(practiceId, "cancel", cancelCommentText.trim());
        if (!result.success) {
          setParticipationActionError(result.error ?? "キャンセルに失敗しました");
          return;
        }
        setCancelTargetPracticeId(null);
        setCancelComment("");
        setSelectedPracticeId(null);
        await refetchModalData(practiceId);
        setSignups((prev) => prev.filter((s) => s.practice_id !== practiceId));
        setPractices((prev) => prev.filter((p) => p.id !== practiceId));
      } catch (e) {
        setParticipationActionError(e instanceof Error ? e.message : "キャンセル処理中にエラーが発生しました");
      } finally {
        setParticipationSubmitting(false);
      }
    },
    [refetchModalData]
  );

  const displayComments = selectedPracticeId
    ? (optimisticComments[selectedPracticeId] ?? modalComments)
    : [];

  const selectedPractice = useMemo(
    () => (selectedPracticeId ? sortedPractices.find((p) => p.id === selectedPracticeId) ?? null : null),
    [selectedPracticeId, sortedPractices]
  );

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white shadow-sm">
          <div className="flex w-full items-center gap-3 px-4 py-3 md:max-w-5xl md:mx-auto">
            <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
              <ArrowLeft size={20} />
              トップへ
            </Link>
          </div>
        </header>
        <main className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
          <p className="text-center text-slate-500">読み込み中…</p>
        </main>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white shadow-sm">
          <div className="flex w-full items-center gap-3 px-4 py-3 md:max-w-5xl md:mx-auto">
            <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
              <ArrowLeft size={20} />
              トップへ
            </Link>
          </div>
        </header>
        <main className="w-full px-4 py-12 md:max-w-5xl md:mx-auto">
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h1 className="mb-2 text-lg font-bold text-slate-900">自分の練習予定</h1>
            <p className="mb-6 text-sm text-slate-600">参加予定の練習を表示するにはログインしてください。</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <LogIn size={18} />
              トップでログイン
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white shadow-sm">
        <div className="flex w-full items-center gap-3 px-4 py-3 md:max-w-5xl md:mx-auto">
          <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
            <ArrowLeft size={20} />
            トップへ
          </Link>
        </div>
      </header>

      <main className="w-full px-4 pb-16 pt-6 md:max-w-5xl md:mx-auto">
        <h1 className="mb-4 text-lg font-bold text-slate-900 md:text-xl">自分の練習予定</h1>

        {loading ? (
          <p className="text-center text-slate-500">読み込み中…</p>
        ) : sortedPractices.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-slate-600">まだ参加予定の練習はありません。</p>
            <p className="mt-2 text-sm text-slate-500">トップページでチームを選択し、練習に参加してみましょう。</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              トップへ
            </Link>
          </div>
        ) : (
          <>
            {/* ビュー切り替え: リスト / 月 / 週 */}
            <div className="mb-4 flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 md:flex-row">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-3 text-sm font-medium transition md:py-2.5 ${
                  viewMode === "list"
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <List size={18} />
                <span>リスト</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("month")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-3 text-sm font-medium transition md:py-2.5 ${
                  viewMode === "month"
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Calendar size={18} />
                <span>練習会日程（月）</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("week");
                  const today = new Date();
                  const weekStart = new Date(today);
                  weekStart.setDate(today.getDate() + (today.getDay() === 0 ? -6 : 1 - today.getDay()));
                  setCalendarWeekStart(weekStart);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-3 text-sm font-medium transition md:py-2.5 ${
                  viewMode === "week"
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <CalendarDays size={18} />
                <span>練習会日程（週）</span>
              </button>
            </div>

            {viewMode === "list" && (
              <div className="space-y-8">
                {upcoming.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-600">今後の予定</h2>
                    <ul className="space-y-3">
                      {upcoming.map((p) => {
                        const isoStart = `${p.event_date}T${(p.start_time.length === 5 ? p.start_time : p.start_time + ":00").slice(0, 5)}:00`;
                        const isoEnd = `${p.event_date}T${(p.end_time.length === 5 ? p.end_time : p.end_time + ":00").slice(0, 5)}:00`;
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedPracticeId(p.id)}
                              className="block w-full rounded-lg border border-slate-200 bg-white p-4 text-left text-sm shadow-sm transition hover:border-emerald-200 hover:shadow-md md:text-base"
                            >
                              <p className="mb-1 font-semibold text-slate-900">{p.team_name ?? "練習会"}</p>
                              <p className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                                <Calendar size={16} className="shrink-0 text-emerald-600" />
                                {formatPracticeDate(isoStart, isoEnd)}
                              </p>
                              <p className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                                <MapPin size={16} className="shrink-0 text-emerald-600" />
                                {p.location}
                              </p>
                              <p className="flex items-center gap-2 text-xs text-slate-500">
                                <Users size={14} className="shrink-0" />
                                参加人数上限 {p.max_participants}名
                              </p>
                              {p.content && (
                                <p className="mt-2 border-t border-slate-100 pt-2 text-sm text-slate-600">{p.content}</p>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {past.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">過去の参加履歴</h2>
                    <ul className="space-y-3">
                      {past.map((p) => {
                        const isoStart = `${p.event_date}T${(p.start_time.length === 5 ? p.start_time : p.start_time + ":00").slice(0, 5)}:00`;
                        const isoEnd = `${p.event_date}T${(p.end_time.length === 5 ? p.end_time : p.end_time + ":00").slice(0, 5)}:00`;
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedPracticeId(p.id)}
                                className="block w-full rounded-lg border border-slate-100 bg-slate-50/80 p-4 text-left text-sm transition hover:bg-slate-100 md:text-base"
                            >
                              <p className="mb-1 font-semibold text-slate-700">{p.team_name ?? "練習会"}</p>
                              <p className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                                <Calendar size={16} className="shrink-0" />
                                {formatPracticeDate(isoStart, isoEnd)}
                              </p>
                              <p className="flex items-center gap-2 text-sm text-slate-500">
                                <MapPin size={16} className="shrink-0" />
                                {p.location}
                              </p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {viewMode === "month" && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarMonth(
                        new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1)
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                    aria-label="前月"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-base font-semibold text-slate-900 md:text-lg">
                    {calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarMonth(
                        new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1)
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                    aria-label="翌月"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="grid min-w-[280px] grid-cols-7 border-b border-slate-200 bg-slate-50">
                    {WEEKDAY_LABELS.map((label, i) => (
                      <div
                        key={label}
                        className={`py-2 text-center text-xs font-semibold ${
                          i === 5 ? "text-blue-600" : i === 6 ? "text-red-600" : "text-slate-500"
                        }`}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="grid min-w-[280px] grid-cols-7">
                    {getMonthGrid(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth()
                    ).flat().map((cell, i) => {
                      if (!cell) {
                        return <div key={i} className="min-h-[64px] sm:min-h-[72px] bg-slate-50/50" />;
                      }
                      const key = toDateKey(cell);
                      const items = practicesByDateKey[key] ?? [];
                      const isToday = toDateKey(new Date()) === key;
                      return (
                        <div
                          key={key}
                          className={`min-h-[64px] border-b border-r border-slate-100 p-1 sm:min-h-[72px] sm:p-1.5 ${
                            cell.getMonth() !== calendarMonth.getMonth()
                              ? "bg-slate-50/50 text-slate-400"
                              : "bg-white"
                          } ${i % 7 === 6 ? "border-r-0" : ""}`}
                        >
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-sm ${
                              isToday
                                ? "bg-emerald-600 font-semibold text-white"
                                : (cell.getDay() + 6) % 7 === 5
                                  ? "text-blue-600"
                                  : (cell.getDay() + 6) % 7 === 6
                                    ? "text-red-600"
                                    : "text-slate-700"
                            }`}
                          >
                            {cell.getDate()}
                          </span>
                          {items.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-0.5">
                              {items.slice(0, 2).map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => setSelectedPracticeId(p.id)}
                                  className="block rounded px-1 text-[10px] font-medium sm:text-xs bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200 truncate max-w-full text-left"
                                  title={`${p.teamName} ${formatTimeRange(p.date, p.endDate)} ${p.location}`}
                                >
                                  <span className="block truncate">{p.teamName}</span>
                                  <span className="block truncate">{formatTimeRange(p.date, p.endDate)}</span>
                                </button>
                              ))}
                              {items.length > 2 && (
                                <span className="text-[10px] text-slate-500">+{items.length - 2}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">今月の練習予定</h3>
                  {(() => {
                    const year = calendarMonth.getFullYear();
                    const month = calendarMonth.getMonth();
                    const list = practiceItems
                      .filter((p) => {
                        const d = new Date(p.date);
                        return d.getFullYear() === year && d.getMonth() === month;
                      })
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                    if (list.length === 0) {
                      return <p className="text-sm text-slate-500">この月の練習はありません</p>;
                    }
                    return (
                      <ul className="space-y-1">
                        {list.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedPracticeId(p.id)}
                              className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                            >
                              <span className="flex w-full items-center gap-2">
                                <span className="font-medium">{formatShortDate(p.date)} {formatTimeRange(p.date, p.endDate)}</span>
                                <span className="text-slate-400">·</span>
                                <span className="truncate text-slate-600">{p.teamName}</span>
                                <span className="text-slate-400">·</span>
                                <span className="truncate">{p.location}</span>
                              </span>
                              {p.content && <span className="text-xs text-slate-500">{p.content}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>
              </section>
            )}

            {viewMode === "week" && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(calendarWeekStart);
                      d.setDate(d.getDate() - 7);
                      setCalendarWeekStart(d);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                    aria-label="前週"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-center text-lg font-semibold text-slate-900">
                    {calendarWeekStart.getMonth() + 1}月 {calendarWeekStart.getDate()}日 ～{" "}
                    {(() => {
                      const end = new Date(calendarWeekStart);
                      end.setDate(end.getDate() + 6);
                      return `${end.getMonth() + 1}月${end.getDate()}日`;
                    })()}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(calendarWeekStart);
                      d.setDate(d.getDate() + 7);
                      setCalendarWeekStart(d);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                    aria-label="翌週"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                <div
                  ref={weekCalendarScrollRef}
                  className="max-h-[min(70vh,720px)] overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm"
                >
                  <div
                    className="grid min-w-[600px]"
                    style={{
                      gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))",
                      gridTemplateRows: `40px repeat(${(WEEK_VIEW.endHour - WEEK_VIEW.startHour) * (60 / WEEK_VIEW.slotMinutes)}, ${WEEK_VIEW.slotHeightPx}px)`,
                    }}
                  >
                    <div className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 py-2 pr-1 text-right text-xs font-semibold text-slate-500">
                      時間
                    </div>
                    {getWeekDates(calendarWeekStart).map((day, i) => {
                      const isToday = toDateKey(new Date()) === toDateKey(day);
                      const dow = (day.getDay() + 6) % 7;
                      const isSat = dow === 5;
                      const isSun = dow === 6;
                      return (
                        <div
                          key={i}
                          className={`sticky top-0 z-10 border-b border-r border-slate-200 py-2 text-center text-sm last:border-r-0 ${
                            isToday ? "bg-emerald-50 font-semibold text-emerald-700" : "bg-slate-50 text-slate-700"
                          }`}
                        >
                          <span className={`block text-xs ${isSat ? "text-blue-600 font-semibold" : isSun ? "text-red-600 font-semibold" : "text-slate-500"}`}>
                            {WEEKDAY_LABELS[dow]}
                          </span>
                          <span className={isSat ? "text-blue-700" : isSun ? "text-red-700" : ""}>{day.getDate()}</span>
                        </div>
                      );
                    })}
                    {Array.from(
                      {
                        length:
                          (WEEK_VIEW.endHour - WEEK_VIEW.startHour) *
                          (60 / WEEK_VIEW.slotMinutes),
                      },
                      (_, i) => {
                        const totalMins = WEEK_VIEW.startHour * 60 + i * WEEK_VIEW.slotMinutes;
                        const h = Math.floor(totalMins / 60);
                        const m = totalMins % 60;
                        return (
                          <div
                            key={i}
                            className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white pr-1 pt-0.5 text-right text-[10px] text-slate-400"
                            style={{ gridColumn: 1, gridRow: i + 2 }}
                          >
                            {h}:{m.toString().padStart(2, "0")}
                          </div>
                        );
                      }
                    )}
                    {getWeekDates(calendarWeekStart).map((day, dayIndex) =>
                      Array.from(
                        {
                          length:
                            (WEEK_VIEW.endHour - WEEK_VIEW.startHour) *
                            (60 / WEEK_VIEW.slotMinutes),
                        },
                        (_, slotIndex) => {
                          const isToday = toDateKey(new Date()) === toDateKey(day);
                          const dow = (day.getDay() + 6) % 7;
                          const isSat = dow === 5;
                          const isSun = dow === 6;
                          return (
                            <div
                              key={`${dayIndex}-${slotIndex}`}
                              className={`border-b border-r border-slate-100 last:border-r-0 ${
                                isToday ? "bg-emerald-50/50" : isSat ? "bg-blue-50/30" : isSun ? "bg-red-50/30" : "bg-white"
                              }`}
                              style={{
                                gridColumn: dayIndex + 2,
                                gridRow: slotIndex + 2,
                              }}
                            />
                          );
                        }
                      )
                    )}
                    {practicesInWeek.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPracticeId(p.id)}
                        className="mx-0.5 overflow-hidden rounded-md border border-emerald-200 bg-emerald-100 py-1 px-1.5 text-left text-xs text-emerald-800 transition hover:bg-emerald-200"
                        style={{
                          gridColumn: p.dayIndex + 2,
                          gridRow: `${p.slotIndex + 2} / span ${p.durationSlots}`,
                        }}
                      >
                        <span className="block font-semibold">
                          {new Date(p.date).getHours()}:
                          {new Date(p.date).getMinutes().toString().padStart(2, "0")}
                          〜
                          {new Date(p.endDate).getHours()}:
                          {new Date(p.endDate).getMinutes().toString().padStart(2, "0")}
                        </span>
                        <p className="truncate font-medium" title={p.teamName}>{p.teamName}</p>
                        <p className="truncate" title={p.location}>{p.location}</p>
                        {p.content && <p className="truncate text-[10px] text-slate-500" title={p.content}>{p.content}</p>}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* 練習詳細モーダル（リスト・月・週の練習をクリックで表示） */}
            {selectedPractice && (
              <div
                className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
                onClick={() => {
                  setSelectedPracticeId(null);
                  setCommentPopupPracticeId(null);
                  setCommentPopupText("");
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="practice-modal-title"
              >
                <div
                  className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {userId && (
                    <div className="absolute right-12 top-4 z-10 flex flex-col items-center gap-0.5" aria-hidden>
                      <CheckCircle size={22} className="shrink-0 text-red-500" />
                      <span className="text-[10px] text-slate-500">参加連絡済み</span>
                    </div>
                  )}
                  <div className="shrink-0 p-6 pb-2">
                    <div className="flex items-center justify-between">
                      <h3 id="practice-modal-title" className="text-lg font-semibold text-slate-900">
                        練習の詳細
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPracticeId(null);
                          setCommentPopupPracticeId(null);
                        }}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        aria-label="閉じる"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
                    {(() => {
                      const isoStart = `${selectedPractice.event_date}T${(selectedPractice.start_time.length === 5 ? selectedPractice.start_time : selectedPractice.start_time + ":00").slice(0, 5)}:00`;
                      const isoEnd = `${selectedPractice.event_date}T${(selectedPractice.end_time.length === 5 ? selectedPractice.end_time : selectedPractice.end_time + ":00").slice(0, 5)}:00`;
                      return (
                        <>
                          <p className="mb-1 text-sm text-slate-500">{selectedPractice.team_name ?? "練習会"}</p>
                          <p className="mb-4 flex items-center gap-2 text-slate-900">
                            <Calendar size={18} className="text-emerald-600" />
                            {formatPracticeDate(isoStart, isoEnd)}
                          </p>
                          <p className="mb-4 flex items-center gap-2 text-slate-600">
                            <MapPin size={18} className="text-emerald-600" />
                            {selectedPractice.location}
                          </p>
                          <p className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                            <Users size={18} className="text-emerald-600" />
                            {formatParticipantLimit(modalSignups.length, selectedPractice.max_participants)}
                            参加予定（上限{selectedPractice.max_participants}名）
                          </p>
                          <div className="mb-4">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">参加予定メンバー（クリックでプロフィール）</h4>
                            <div className="flex flex-wrap gap-2">
                              {modalSignups.length === 0 ? (
                                <p className="text-sm text-slate-500">まだ参加者はいません</p>
                              ) : (
                                modalSignups.map((s) => {
                                  const name = modalDisplayNames[s.user_id] ?? s.display_name?.trim() ?? "名前未設定";
                                  const isOrganizer = s.user_id === selectedPractice.user_id;
                                  return (
                                    <span
                                      key={s.user_id}
                                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-xs border border-slate-200"
                                      title={name}
                                    >
                                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white bg-slate-500">
                                        {name.slice(0, 1)}
                                      </span>
                                      <span className="text-slate-700 font-medium max-w-[4.5rem] truncate">{name}</span>
                                      {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                                    </span>
                                  );
                                })
                              )}
                            </div>
                          </div>
                          {displayComments.length > 0 ? (
                            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
                              {practiceModalCommentOpen ? (
                                <>
                                  <div className="mb-2 flex items-center justify-between">
                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">コメント履歴</h4>
                                    <button
                                      type="button"
                                      onClick={() => setPracticeModalCommentOpen(false)}
                                      className="text-xs text-slate-500 underline hover:text-slate-700"
                                    >
                                      コメントを閉じる
                                    </button>
                                  </div>
                                  <div className="space-y-2 text-sm">
                                    {displayComments.map((entry) => {
                                      const isOrganizer = entry.user_id === selectedPractice.user_id;
                                      const isSelf = entry.user_id === userId;
                                      return (
                                        <div key={entry.id} className={isSelf ? "flex justify-end" : "flex justify-start"}>
                                          <div
                                            className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 max-w-[85%] ${
                                              isSelf ? "bg-emerald-50 border border-emerald-100" : "bg-white border border-slate-200"
                                            }`}
                                          >
                                            <span className="text-xs text-slate-400 shrink-0">{formatParticipatedAt(entry.created_at)}</span>
                                            {entry.type === "join" ? (
                                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">参加</span>
                                            ) : entry.type === "cancel" ? (
                                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">キャンセル</span>
                                            ) : (
                                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">コメント</span>
                                            )}
                                            <span className="text-slate-600">{entry.display_name ?? entry.user_name ?? "名前未設定"}</span>
                                            {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                                            <span className="text-slate-700 min-w-0">{entry.comment || "—"}</span>
                                            <span className="ml-auto shrink-0">
                                              <CommentLikeButton
                                                commentId={entry.id}
                                                practiceId={selectedPractice.id}
                                                liked={entry.is_liked_by_me}
                                                count={entry.likes_count}
                                                likedByDisplayNames={entry.liked_by_display_names}
                                                userId={userId}
                                                onOptimisticUpdate={(payload) => {
                                                  setOptimisticComments((prev) => {
                                                    const list = prev[payload.practiceId] ?? [];
                                                    const next = list.map((c) =>
                                                      c.id === payload.commentId ? { ...c, is_liked_by_me: payload.isLiked, likes_count: payload.count } : c
                                                    );
                                                    return { ...prev, [payload.practiceId]: next };
                                                  });
                                                }}
                                                onSuccess={() => refetchModalData(selectedPractice.id)}
                                              />
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPracticeModalCommentOpen(true)}
                                  className="text-left text-sm font-medium text-slate-600 hover:text-slate-800"
                                >
                                  コメントを開く（{displayComments.length}件）
                                </button>
                              )}
                            </div>
                          ) : null}
                          {participationActionError && (
                            <p className="mb-4 text-sm text-red-600" role="alert">{participationActionError}</p>
                          )}
                          <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                            <span className="font-medium text-slate-500">練習内容：</span>
                            {selectedPractice.content ?? "—"}
                          </p>
                          {selectedPractice.level && (
                            <p className="mb-4 text-sm text-slate-600">
                              <span className="font-medium text-slate-500">練習者のレベル：</span>
                              {selectedPractice.level}
                            </p>
                          )}
                          {selectedPractice.conditions && (
                            <p className="mb-5 rounded-md bg-amber-50 px-3 py-2 text-sm text-slate-700">
                              <span className="font-medium text-slate-500">求める条件：</span>
                              {selectedPractice.conditions}
                            </p>
                          )}
                          {!selectedPractice.level && !selectedPractice.conditions && <div className="mb-5" />}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setParticipationActionError(null);
                                setCancelTargetPracticeId(selectedPractice.id);
                                setCancelComment("");
                              }}
                              className="flex min-w-[8rem] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-red-500 py-3.5 font-semibold text-white transition hover:bg-red-600"
                            >
                              <LogOut size={18} />
                              参加をキャンセルする
                            </button>
                            {userId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCommentPopupPracticeId(selectedPractice.id);
                                  setCommentPopupText("");
                                }}
                                className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-2 border-emerald-500 bg-white px-4 py-3 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 transition"
                              >
                                <MessageCircle size={18} />
                                コメントする
                              </button>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* 参加をキャンセルするモーダル */}
            {cancelTargetPracticeId && selectedPractice && selectedPractice.id === cancelTargetPracticeId && (
              <div
                className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
                onClick={() => {
                  setCancelTargetPracticeId(null);
                  setCancelComment("");
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="cancel-modal-title"
              >
                <div
                  className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 id="cancel-modal-title" className="mb-2 text-lg font-semibold text-slate-900">
                    参加をキャンセルする
                  </h3>
                  {selectedPractice && (
                    <p className="mb-4 text-sm text-slate-600">
                      {selectedPractice.team_name} · {formatPracticeDate(
                        `${selectedPractice.event_date}T${(selectedPractice.start_time.length === 5 ? selectedPractice.start_time : selectedPractice.start_time + ":00").slice(0, 5)}:00`,
                        `${selectedPractice.event_date}T${(selectedPractice.end_time.length === 5 ? selectedPractice.end_time : selectedPractice.end_time + ":00").slice(0, 5)}:00`
                      )}
                    </p>
                  )}
                  <label htmlFor="cancel-comment" className="mb-1 block text-sm font-medium text-slate-700">
                    キャンセルする理由や一言 <span className="text-red-500">（必須）</span>
                  </label>
                  <textarea
                    id="cancel-comment"
                    required
                    rows={3}
                    value={cancelComment}
                    onChange={(e) => setCancelComment(e.target.value)}
                    placeholder="例: 予定が重なったため"
                    className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {participationActionError && (
                    <p className="mb-4 text-sm text-red-600" role="alert">{participationActionError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={participationSubmitting}
                      onClick={() => {
                        setParticipationActionError(null);
                        setCancelTargetPracticeId(null);
                        setCancelComment("");
                      }}
                      className="flex-1 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      戻る
                    </button>
                    <button
                      type="button"
                      disabled={!cancelComment.trim() || participationSubmitting}
                      onClick={() => {
                        if (cancelTargetPracticeId && cancelComment.trim()) {
                          confirmCancelParticipation(cancelTargetPracticeId, cancelComment);
                        }
                      }}
                      className="flex-1 rounded-lg bg-red-500 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {participationSubmitting ? "送信中…" : "参加をキャンセルする"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* コメントするポップアップ */}
            {commentPopupPracticeId && selectedPractice && selectedPractice.id === commentPopupPracticeId && (
              <div
                className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
                onClick={() => {
                  setCommentPopupPracticeId(null);
                  setCommentPopupText("");
                  setFreeCommentError(null);
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="comment-popup-title"
              >
                <div
                  className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 id="comment-popup-title" className="mb-2 text-lg font-semibold text-slate-900">
                    コメントする
                  </h3>
                  <p className="mb-4 text-sm text-slate-600">
                    {selectedPractice.team_name} · {formatPracticeDate(
                      `${selectedPractice.event_date}T${(selectedPractice.start_time.length === 5 ? selectedPractice.start_time : selectedPractice.start_time + ":00").slice(0, 5)}:00`,
                      `${selectedPractice.event_date}T${(selectedPractice.end_time.length === 5 ? selectedPractice.end_time : selectedPractice.end_time + ":00").slice(0, 5)}:00`
                    )}
                  </p>
                  <label htmlFor="comment-popup-text" className="mb-1 block text-sm font-medium text-slate-700">
                    質問や連絡事項があればどうぞ
                  </label>
                  <textarea
                    id="comment-popup-text"
                    rows={4}
                    value={commentPopupText}
                    onChange={(e) => setCommentPopupText(e.target.value)}
                    placeholder="質問や連絡事項があればどうぞ"
                    className="mb-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    disabled={freeCommentSubmitting}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCommentPopupPracticeId(null);
                        setCommentPopupText("");
                        setFreeCommentError(null);
                      }}
                      className="flex-1 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      disabled={freeCommentSubmitting || !commentPopupText.trim()}
                      onClick={async () => {
                        if (!commentPopupText.trim() || freeCommentSubmitting) return;
                        setFreeCommentError(null);
                        setFreeCommentSubmitting(true);
                        try {
                          const result = await postComment(selectedPractice.id, commentPopupText.trim());
                          if (result.success) {
                            setCommentPopupPracticeId(null);
                            setCommentPopupText("");
                            setFreeCommentError(null);
                            await refetchModalData(selectedPractice.id);
                          } else {
                            setFreeCommentError(result.error ?? "送信に失敗しました");
                          }
                        } finally {
                          setFreeCommentSubmitting(false);
                        }
                      }}
                      className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {freeCommentSubmitting ? "送信中…" : "送信"}
                    </button>
                  </div>
                  {freeCommentError && (
                    <p className="mt-3 text-sm text-red-600" role="alert">{freeCommentError}</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
