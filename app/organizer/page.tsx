"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { supabase } from "@/lib/supabase/client";
import type { PracticeRow, RecurrenceRuleRow, PracticeCommentWithLikes } from "@/lib/supabase/client";
import {
  createPracticesWithRecurrence,
  type RecurrenceType,
} from "@/app/actions/create-practices-with-recurrence";
import { updatePractice } from "@/app/actions/update-practice";
import { deletePractice } from "@/app/actions/delete-practice";
import { updateRecurrenceRuleEndDate } from "@/app/actions/update-recurrence-rule";
import { postComment } from "@/app/actions/post-practice-comment";
import { ArrowLeft, Plus, X, Calendar, MapPin, CalendarDays, List, ChevronLeft, ChevronRight, Pencil, Trash2, LogIn, LogOut, MessageCircle, Activity, Users, CheckCircle } from "lucide-react";
import { CommentLikeButton } from "@/app/components/CommentLikeButton";

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimelineDate(iso: string): string {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${h}:${min}`;
}

/** 練習日時（例: 2/17（火）14:00〜16:00） */
function formatPracticeDateDetail(eventDate: string, startTime: string, endTime: string): string {
  const [y, mo, day] = eventDate.split("-").map(Number);
  const d = new Date(y, mo - 1, day);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const w = weekdays[d.getDay()];
  const st = (startTime ?? "").slice(0, 5);
  const et = (endTime ?? "").slice(0, 5);
  return `${mo}/${day}（${w}）${st}〜${et}`;
}

/** 参加日時（例: 2/14 14:30） */
function formatParticipatedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** 繰り返し終了日の上限（年内） */
function getRecurrenceEndDateMax(): string {
  return `${new Date().getFullYear()}-12-31`;
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
    const nextRow: (Date | null)[] = Array(7).fill(null);
    rows.push(nextRow);
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

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

/** 主催練習のアクション時系列 1 件 */
type OrganizerTimelineItem = {
  id: string;
  type: "signup" | "cancel" | "comment";
  at: string;
  practiceId: string;
  practiceLabel: string;
  displayName: string;
  comment?: string | null;
  /** コメント/キャンセル行のみ。practice_comments.id（いいね対象） */
  commentId?: string;
  likes_count?: number;
  is_liked_by_me?: boolean;
  liked_by_display_names?: string[];
};

const WEEK_VIEW = { startHour: 6, endHour: 22, slotMinutes: 30, slotHeightPx: 28 } as const;

function getTimeSlotIndex(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  if (hours < WEEK_VIEW.startHour || hours >= WEEK_VIEW.endHour) return -1;
  return Math.floor((hours - WEEK_VIEW.startHour) * (60 / WEEK_VIEW.slotMinutes));
}

type CalendarPractice = {
  id: string;
  date: string;
  endDate: string;
  teamName: string;
  location: string;
  content: string;
  practiceKey: string;
};

function getPracticesInWeek(
  weekStart: Date,
  practices: CalendarPractice[]
): (CalendarPractice & { dayIndex: number; slotIndex: number; durationSlots: number })[] {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startTs = weekStart.getTime();
  const endTs = weekEnd.getTime();
  const result: (CalendarPractice & { dayIndex: number; slotIndex: number; durationSlots: number })[] = [];
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

type OrganizerTeam = {
  user_id: string;
  org_name_1: string | null;
  org_name_2: string | null;
  org_name_3: string | null;
  prefecture: string | null;
};

type MyOrgNames = {
  org_name_1: string | null;
  org_name_2: string | null;
  org_name_3: string | null;
};

export default function OrganizerPage() {
  const { userId, isLoaded } = useAuth();
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [myOrgNames, setMyOrgNames] = useState<MyOrgNames | null>(null);
  const [organizerTeams, setOrganizerTeams] = useState<OrganizerTeam[]>([]);
  const [selectedOrgSlot, setSelectedOrgSlot] = useState<1 | 2 | 3>(1);
  const [myPractices, setMyPractices] = useState<PracticeRow[]>([]);
  const [myRecurrenceRules, setMyRecurrenceRules] = useState<RecurrenceRuleRow[]>([]);
  /** 主催練習の参加・キャンセル・コメントの時系列（新しい順） */
  const [organizerTimeline, setOrganizerTimeline] = useState<OrganizerTimelineItem[]>([]);
  /** アクティビティで練習をクリックしたときにポップアップする練習 ID */
  const [activityDetailPracticeId, setActivityDetailPracticeId] = useState<string | null>(null);
  /** ポップアップ用: 参加予定メンバー（表示名） */
  const [activityDetailSignups, setActivityDetailSignups] = useState<{ id: string; name: string }[]>([]);
  /** ポップアップ用: コメント一覧（いいね付き） */
  const [activityDetailComments, setActivityDetailComments] = useState<PracticeCommentWithLikes[]>([]);
  /** ポップアップ内でコメント履歴を開いているか */
  const [activityDetailCommentsOpen, setActivityDetailCommentsOpen] = useState(false);
  /** アクティビティでインラインコメントフォームを開いている練習 ID（コメントするボタンで開く） */
  const [activityCommentPracticeId, setActivityCommentPracticeId] = useState<string | null>(null);
  const [activityCommentText, setActivityCommentText] = useState("");
  const [activityCommentSubmitting, setActivityCommentSubmitting] = useState(false);
  const [activityCommentError, setActivityCommentError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"activity" | "list" | "month" | "week">("list");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
    return d;
  });
  const [addPracticeOpen, setAddPracticeOpen] = useState(false);
  const [isAddingPractice, setIsAddingPractice] = useState(false);
  /** 追加完了ポップアップ（ボワっと表示） */
  const [addSuccessVisible, setAddSuccessVisible] = useState(false);
  const [addSuccessReady, setAddSuccessReady] = useState(false);
  /** 編集対象の練習（モーダル表示）。繰り返しのときは先頭の1件でフォームを表示し、保存時に editingGroupIds の全件を更新 */
  const [editingPractice, setEditingPractice] = useState<PracticeRow | null>(null);
  const [editingGroupIds, setEditingGroupIds] = useState<string[] | null>(null);
  const [isUpdatingPractice, setIsUpdatingPractice] = useState(false);
  /** 編集モーダル内で繰り返し終了日更新時のエラーメッセージ */
  const [editRecurrenceError, setEditRecurrenceError] = useState<string | null>(null);
  useEffect(() => {
    if (editingPractice) setEditRecurrenceError(null);
  }, [editingPractice]);
  /** 削除確認対象の練習 ID（複数＝繰り返し一括削除） */
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const [isDeletingPractice, setIsDeletingPractice] = useState(false);
  /** 月・週ビューで編集/削除を押したときの「この回だけ / 繰り返し全体」選択 */
  const [calendarScopeChoice, setCalendarScopeChoice] = useState<{
    practice: PracticeRow;
    groupPractices: PracticeRow[];
    action: "edit" | "delete";
  } | null>(null);
  /** 編集フォーム（editingPractice を開いたときに同期） */
  const [editForm, setEditForm] = useState({
    event_date: "",
    start_time: "14:00",
    end_time: "16:00",
    location: "",
    max_participants: 8,
    content: "",
    level: "",
    conditions: "",
    recurrence_end_date: "",
  });
  const [addForm, setAddForm] = useState({
    teamId: "",
    date: "",
    timeStart: "14:00",
    timeEnd: "16:00",
    location: "",
    maxParticipants: 8,
    content: "",
    level: "",
    requirements: "",
    recurrence_type: "none" as RecurrenceType,
    recurrence_end_date: "",
  });
  /** 追加フォームのバリデーションエラー（未入力の項目名） */
  const [addFormErrors, setAddFormErrors] = useState<
    Partial<Record<"teamId" | "date" | "timeStart" | "timeEnd" | "location" | "maxParticipants" | "content" | "level" | "requirements" | "recurrence_end_date", boolean>>
  >({});

  /** 追加完了ポップアップのボワっと表示（マウント後にトランジション用フラグを立てる） */
  useEffect(() => {
    if (addSuccessVisible) {
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setAddSuccessReady(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setAddSuccessReady(false);
  }, [addSuccessVisible]);

  /** 追加完了ポップアップを2.5秒後に自動で閉じる */
  useEffect(() => {
    if (!addSuccessVisible) return;
    const t = setTimeout(() => setAddSuccessVisible(false), 2500);
    return () => clearTimeout(t);
  }, [addSuccessVisible]);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("is_organizer, org_name_1, org_name_2, org_name_3")
        .eq("user_id", userId)
        .maybeSingle();
      const row = data as { is_organizer?: boolean; org_name_1?: string | null; org_name_2?: string | null; org_name_3?: string | null } | null;
      setIsOrganizer(!!row?.is_organizer);
      if (row?.org_name_1 != null || row?.org_name_2 != null || row?.org_name_3 != null) {
        setMyOrgNames({
          org_name_1: row.org_name_1 ?? null,
          org_name_2: row.org_name_2 ?? null,
          org_name_3: row.org_name_3 ?? null,
        });
      }
    })();
  }, [isLoaded, userId]);

  useEffect(() => {
    async function fetchOrganizerTeams() {
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id, org_name_1, org_name_2, org_name_3, prefecture")
        .eq("is_organizer", true)
        .limit(5000);
      const rows = (data as OrganizerTeam[]) ?? [];
      const hasAny = (r: OrganizerTeam) =>
        [r.org_name_1, r.org_name_2, r.org_name_3].some((v) => (v ?? "").trim() !== "");
      setOrganizerTeams(rows.filter(hasAny));
    }
    fetchOrganizerTeams();
  }, []);

  const fetchMyPractices = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("practices")
      .select("*")
      .eq("user_id", userId)
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) {
      console.error("practices fetch error:", error);
      return;
    }
    setMyPractices((data as PracticeRow[]) ?? []);
  }, [userId]);

  const fetchMyRecurrenceRules = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("recurrence_rules")
      .select("*")
      .eq("user_id", userId);
    if (error) {
      console.error("recurrence_rules fetch error:", error);
      return;
    }
    setMyRecurrenceRules((data as RecurrenceRuleRow[]) ?? []);
  }, [userId]);

  useEffect(() => {
    fetchMyPractices();
  }, [fetchMyPractices]);

  useEffect(() => {
    fetchMyRecurrenceRules();
  }, [fetchMyRecurrenceRules]);

  const fetchOrganizerTimeline = useCallback(async () => {
    if (!userId || myPractices.length === 0) {
      setOrganizerTimeline([]);
      return;
    }
    const practiceIds = myPractices.map((p) => p.id);
    const practiceById = new Map(myPractices.map((p) => [p.id, p]));
    const toLabel = (p: PracticeRow) => {
      const d = p.event_date;
      const t = (p.start_time ?? "").slice(0, 5);
      const name = (p.team_name ?? "").trim() || "練習";
      return `${d.slice(5).replace("-", "/")} ${t} ${name}`;
    };

    const { data: commentsData } = await supabase
      .from("practice_comments")
      .select("id, practice_id, user_id, type, display_name, comment, created_at")
      .in("practice_id", practiceIds)
      .in("type", ["join", "cancel", "comment"])
      .order("created_at", { ascending: false })
      .limit(100);

    const items: OrganizerTimelineItem[] = [];
    const commentRows = (commentsData as { id: string; practice_id: string; user_id: string; type: string; display_name: string | null; comment: string | null; created_at: string }[] | null) ?? [];
    for (const c of commentRows) {
      const p = practiceById.get(c.practice_id);
      const type = c.type === "join" ? "signup" : c.type === "cancel" ? "cancel" : "comment";
      items.push({
        id: "comment-" + c.id,
        type,
        at: c.created_at,
        practiceId: c.practice_id,
        practiceLabel: p ? toLabel(p) : c.practice_id.slice(0, 8),
        displayName: (c.display_name ?? "").trim() || "名前未設定",
        comment: c.comment ?? null,
        commentId: c.id,
      });
    }

    const commentIds = items.map((i) => i.commentId).filter((id): id is string => !!id);
    if (commentIds.length > 0) {
      const { data: likes } = await supabase
        .from("comment_likes")
        .select("comment_id, user_id")
        .in("comment_id", commentIds);
      const byComment = new Map<string, { count: number; likedByMe: boolean; userIds: string[] }>();
      for (const cid of commentIds) byComment.set(cid, { count: 0, likedByMe: false, userIds: [] });
      for (const row of likes ?? []) {
        const r = row as { comment_id: string; user_id: string };
        const cur = byComment.get(r.comment_id);
        if (!cur) continue;
        byComment.set(r.comment_id, {
          count: cur.count + 1,
          likedByMe: cur.likedByMe || r.user_id === userId,
          userIds: [...cur.userIds, r.user_id],
        });
      }
      const likerIds = [...new Set((likes ?? []).map((row: { user_id: string }) => row.user_id))];
      const nameByUserId: Record<string, string> = {};
      if (likerIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("user_id, display_name")
          .in("user_id", likerIds);
        for (const p of profiles ?? []) {
          const row = p as { user_id: string; display_name: string | null };
          nameByUserId[row.user_id] = (row.display_name ?? "").trim() || "名前未設定";
        }
      }
      for (const it of items) {
        if (!it.commentId) continue;
        const cur = byComment.get(it.commentId) ?? { count: 0, likedByMe: false, userIds: [] };
        it.likes_count = cur.count;
        it.is_liked_by_me = cur.likedByMe;
        it.liked_by_display_names = cur.userIds.map((uid) =>
          uid === userId ? "自分" : (nameByUserId[uid] ?? "名前未設定")
        );
      }
    }

    items.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
    setOrganizerTimeline(items.slice(0, 50));
  }, [userId, myPractices]);

  useEffect(() => {
    fetchOrganizerTimeline();
  }, [fetchOrganizerTimeline]);

  /** アクティビティポップアップ用: 参加者・コメント取得 */
  useEffect(() => {
    if (!activityDetailPracticeId || !userId) {
      setActivityDetailSignups([]);
      setActivityDetailComments([]);
      setActivityDetailCommentsOpen(false);
      return;
    }
    (async () => {
      const pid = activityDetailPracticeId;
      const [signupsRes, commentsRes] = await Promise.all([
        supabase.from("signups").select("user_id, display_name").eq("practice_id", pid),
        supabase.from("practice_comments").select("id, practice_id, user_id, type, display_name, comment, created_at").eq("practice_id", pid).order("created_at", { ascending: true }),
      ]);
      const signupRows = (signupsRes.data as { user_id: string; display_name: string | null }[] | null) ?? [];
      type CommentRow = { id: string; practice_id: string; user_id: string; type: string; display_name: string | null; comment: string | null; created_at: string };
      const comments = (commentsRes.data as CommentRow[] | null) ?? [];
      const nameByUserId: Record<string, string> = {};
      const userIds = [...new Set([...signupRows.map((s) => s.user_id), ...comments.map((c) => c.user_id)])];
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("user_profiles").select("user_id, display_name").in("user_id", userIds);
        for (const p of profiles ?? []) {
          const row = p as { user_id: string; display_name: string | null };
          nameByUserId[row.user_id] = (row.display_name ?? "").trim() || "名前未設定";
        }
      }
      setActivityDetailSignups(
        signupRows.map((s) => ({
          id: s.user_id,
          name: nameByUserId[s.user_id] ?? ((s.display_name ?? "").trim() || "名前未設定"),
        }))
      );
      const commentIds = comments.map((c) => c.id);
      let withLikes: PracticeCommentWithLikes[] = comments.map((c) => ({
        ...c,
        type: c.type as "join" | "cancel" | "comment",
        likes_count: 0,
        is_liked_by_me: false,
        liked_by_display_names: [],
      }));
      if (commentIds.length > 0) {
        const { data: likes } = await supabase.from("comment_likes").select("comment_id, user_id").in("comment_id", commentIds);
        const byComment = new Map<string, { count: number; likedByMe: boolean; userIds: string[] }>();
        for (const c of comments) byComment.set(c.id, { count: 0, likedByMe: false, userIds: [] });
        for (const row of likes ?? []) {
          const r = row as { comment_id: string; user_id: string };
          const cur = byComment.get(r.comment_id);
          if (!cur) continue;
          byComment.set(r.comment_id, { count: cur.count + 1, likedByMe: cur.likedByMe || r.user_id === userId, userIds: [...cur.userIds, r.user_id] });
        }
        const likerIds = [...new Set((likes ?? []).map((row: { user_id: string }) => row.user_id))];
        const likerNames: Record<string, string> = {};
        if (likerIds.length > 0) {
          const { data: prof } = await supabase.from("user_profiles").select("user_id, display_name").in("user_id", likerIds);
          for (const p of prof ?? []) {
            const row = p as { user_id: string; display_name: string | null };
            likerNames[row.user_id] = (row.display_name ?? "").trim() || "名前未設定";
          }
        }
        withLikes = comments.map((c) => {
          const cur = byComment.get(c.id) ?? { count: 0, likedByMe: false, userIds: [] };
          return {
            ...c,
            type: c.type as "join" | "cancel" | "comment",
            likes_count: cur.count,
            is_liked_by_me: cur.likedByMe,
            liked_by_display_names: cur.userIds.map((uid) => (uid === userId ? "自分" : likerNames[uid] ?? "名前未設定")),
          };
        });
      }
      setActivityDetailComments(withLikes);
    })();
  }, [activityDetailPracticeId, userId]);

  useEffect(() => {
    if (!myOrgNames) return;
    const currentName =
      selectedOrgSlot === 1
        ? (myOrgNames.org_name_1 ?? "").trim()
        : selectedOrgSlot === 2
          ? (myOrgNames.org_name_2 ?? "").trim()
          : (myOrgNames.org_name_3 ?? "").trim();
    if (currentName !== "") return;
    if ((myOrgNames.org_name_1 ?? "").trim() !== "") setSelectedOrgSlot(1);
    else if ((myOrgNames.org_name_2 ?? "").trim() !== "") setSelectedOrgSlot(2);
    else if ((myOrgNames.org_name_3 ?? "").trim() !== "") setSelectedOrgSlot(3);
  }, [myOrgNames, selectedOrgSlot]);

  const selectedName =
    myOrgNames == null
      ? ""
      : selectedOrgSlot === 1
        ? (myOrgNames.org_name_1 ?? "").trim()
        : selectedOrgSlot === 2
          ? (myOrgNames.org_name_2 ?? "").trim()
          : (myOrgNames.org_name_3 ?? "").trim();

  /** アクティビティポップアップ用の練習（ID から myPractices を参照） */
  const activityDetailPractice = useMemo(
    () => (activityDetailPracticeId ? myPractices.find((p) => p.id === activityDetailPracticeId) ?? null : null),
    [activityDetailPracticeId, myPractices]
  );

  const practicesForSlotAsCalendar = useMemo((): CalendarPractice[] => {
    return myPractices
      .filter((p) => p.team_name === selectedName)
      .map((p) => {
        const dateStart = p.event_date + "T" + (p.start_time.length === 5 ? p.start_time : p.start_time + ":00").slice(0, 5) + ":00";
        const dateEnd = p.event_date + "T" + (p.end_time.length === 5 ? p.end_time : p.end_time + ":00").slice(0, 5) + ":00";
        return {
          id: p.id,
          date: new Date(dateStart).toISOString(),
          endDate: new Date(dateEnd).toISOString(),
          teamName: p.team_name,
          location: p.location,
          content: p.content ?? "",
          practiceKey: p.id,
        };
      });
  }, [myPractices, selectedName]);

  /** リスト用: 繰り返しは1グループにまとめる（recurrence_rule_id でグループ化） */
  const practiceGroupsForList = useMemo(() => {
    const filtered = myPractices.filter((p) => p.team_name === selectedName);
    const byKey = new Map<string, PracticeRow[]>();
    for (const p of filtered) {
      const key = p.recurrence_rule_id ?? `single-${p.id}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(p);
    }
    const groups = Array.from(byKey.entries()).map(([key, practices]) => ({
      key,
      practices: practices.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time)),
    }));
    groups.sort((a, b) => a.practices[0].event_date.localeCompare(b.practices[0].event_date) || a.practices[0].start_time.localeCompare(b.practices[0].start_time));
    return groups;
  }, [myPractices, selectedName]);

  const practicesByDateKey = useMemo(() => {
    const map: Record<string, CalendarPractice[]> = {};
    for (const p of practicesForSlotAsCalendar) {
      const key = toDateKey(new Date(p.date));
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return map;
  }, [practicesForSlotAsCalendar]);

  const practicesInWeek = useMemo(
    () => getPracticesInWeek(calendarWeekStart, practicesForSlotAsCalendar),
    [calendarWeekStart, practicesForSlotAsCalendar]
  );

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <p className="text-slate-500">読み込み中…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <p className="text-slate-500">ログインしてください。</p>
        <Link href="/" className="mt-4 inline-block text-emerald-600 hover:underline">
          トップへ
        </Link>
      </div>
    );
  }

  if (!isOrganizer) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <p className="text-slate-500">主催者のみ利用できるページです。</p>
        <Link href="/" className="mt-4 inline-block text-emerald-600 hover:underline">
          トップへ
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft size={18} />
            トップへ
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold">主催者ページ</h1>

        <button
          type="button"
          onClick={() => setAddPracticeOpen(true)}
          className="mb-6 flex items-center gap-1.5 rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
        >
          <Plus size={18} />
          練習日程を追加する
        </button>

        {/* ビュー切り替え: アクティビティ / リスト / 月 / 週（アクティビティはリストの左） */}
        {isOrganizer && (
          <div className="mb-6 flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("activity")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-medium transition sm:gap-2 ${
                viewMode === "activity"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Activity size={18} />
              <span>アクティビティ</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-medium transition sm:gap-2 ${
                viewMode === "list"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <List size={18} />
              <span>リスト</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("month");
                setCalendarMonth(new Date());
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-medium transition sm:gap-2 ${
                viewMode === "month"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Calendar size={18} />
              <span>月</span>
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
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-medium transition sm:gap-2 ${
                viewMode === "week"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <CalendarDays size={18} />
              <span>週</span>
            </button>
          </div>
        )}

        {/* アクティビティビュー: 時系列のみ */}
        {viewMode === "activity" && (
          <>
            <section className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                どの練習にどんなアクションがあったか（新しい順）
              </h2>
              {organizerTimeline.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">まだアクションはありません</p>
              ) : (
                <ul className="space-y-2">
                  {organizerTimeline.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-0.5 rounded-md border-b border-slate-100 py-2 last:border-b-0"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setActivityDetailPracticeId(item.practiceId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setActivityDetailPracticeId(item.practiceId);
                          }
                        }}
                        className="cursor-pointer hover:bg-slate-50 rounded-md -mx-1 px-1"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          {item.type === "signup" && (
                            <LogIn size={14} className="shrink-0 text-emerald-600" aria-hidden />
                          )}
                          {item.type === "cancel" && (
                            <LogOut size={14} className="shrink-0 text-amber-600" aria-hidden />
                          )}
                          {item.type === "comment" && (
                            <MessageCircle size={14} className="shrink-0 text-blue-600" aria-hidden />
                          )}
                          <span className="font-medium text-slate-800">{item.practiceLabel}</span>
                          <span className="text-slate-500">
                            — {item.displayName}
                            {item.type === "signup" && " が参加"}
                            {item.type === "cancel" && " がキャンセル"}
                            {item.type === "comment" && " がコメント"}
                          </span>
                        </div>
                        {item.comment && (
                          <p className="ml-5 truncate text-xs text-slate-600" title={item.comment}>
                            「{item.comment}」
                          </p>
                        )}
                      </div>
                      <div className="ml-5 mt-0.5 flex flex-wrap items-center gap-2">
                        <time className="text-xs text-slate-400" dateTime={item.at}>
                          {formatTimelineDate(item.at)}
                        </time>
                        {item.commentId != null && (
                          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <CommentLikeButton
                              commentId={item.commentId}
                              practiceId={item.practiceId}
                              liked={item.is_liked_by_me ?? false}
                              count={item.likes_count ?? 0}
                              likedByDisplayNames={item.liked_by_display_names ?? []}
                              userId={userId}
                              onOptimisticUpdate={(payload) => {
                                setOrganizerTimeline((prev) =>
                                  prev.map((i) =>
                                    i.commentId === payload.commentId
                                      ? {
                                          ...i,
                                          is_liked_by_me: payload.isLiked,
                                          likes_count: payload.count,
                                        }
                                      : i
                                  )
                                );
                              }}
                            />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivityCommentError(null);
                            if (activityCommentPracticeId === item.practiceId) {
                              setActivityCommentPracticeId(null);
                            } else {
                              setActivityCommentPracticeId(item.practiceId);
                              setActivityCommentText("");
                            }
                          }}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
                        >
                          コメントする
                        </button>
                      </div>
                      {activityCommentPracticeId === item.practiceId && (
                        <div
                          className="ml-5 mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <label htmlFor={`activity-inline-comment-${item.practiceId}`} className="sr-only">
                            コメントを入力
                          </label>
                          <textarea
                            id={`activity-inline-comment-${item.practiceId}`}
                            rows={2}
                            value={activityCommentText}
                            onChange={(e) => setActivityCommentText(e.target.value)}
                            placeholder="質問や連絡事項があればどうぞ"
                            className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            disabled={activityCommentSubmitting}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={activityCommentSubmitting || !activityCommentText.trim()}
                              onClick={async () => {
                                if (!activityCommentText.trim() || activityCommentSubmitting) return;
                                setActivityCommentError(null);
                                setActivityCommentSubmitting(true);
                                try {
                                  const result = await postComment(item.practiceId, activityCommentText.trim());
                                  if (result.success) {
                                    setActivityCommentText("");
                                    setActivityCommentPracticeId(null);
                                    await fetchOrganizerTimeline();
                                  } else {
                                    setActivityCommentError(result.error ?? "送信に失敗しました");
                                  }
                                } finally {
                                  setActivityCommentSubmitting(false);
                                }
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none"
                            >
                              {activityCommentSubmitting ? "送信中…" : "送信"}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActivityCommentPracticeId(null);
                                setActivityCommentText("");
                                setActivityCommentError(null);
                              }}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              キャンセル
                            </button>
                          </div>
                          {activityCommentError && (
                            <p className="mt-2 text-sm text-red-600" role="alert">
                              {activityCommentError}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* アクティビティで練習をクリックしたときのポップアップ（トップページの練習の詳細と同じレイアウト） */}
            {activityDetailPractice && (
              <div
                className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
                onClick={() => setActivityDetailPracticeId(null)}
                role="dialog"
                aria-modal="true"
                aria-labelledby="activity-practice-detail-title"
              >
                <div
                  className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {userId && activityDetailSignups.some((s) => s.id === userId) && (
                    <div className="absolute right-12 top-4 z-10 flex flex-col items-center gap-0.5" aria-hidden>
                      <CheckCircle size={22} className="shrink-0 text-red-500" />
                      <span className="text-[10px] text-slate-500">参加連絡済み</span>
                    </div>
                  )}
                  <div className="shrink-0 p-6 pb-2">
                    <div className="flex items-center justify-between">
                      <h3 id="activity-practice-detail-title" className="text-lg font-semibold text-slate-900">
                        練習の詳細
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActivityDetailPracticeId(null)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        aria-label="閉じる"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
                    <p className="mb-1 text-sm text-slate-500">{activityDetailPractice.team_name}</p>
                    <p className="mb-4 flex items-center gap-2 text-slate-900">
                      <Calendar size={18} className="text-emerald-600" />
                      {formatPracticeDateDetail(
                        activityDetailPractice.event_date,
                        activityDetailPractice.start_time,
                        activityDetailPractice.end_time
                      )}
                    </p>
                    <p className="mb-4 flex items-center gap-2 text-slate-600">
                      <MapPin size={18} className="text-emerald-600" />
                      {activityDetailPractice.location}
                    </p>
                    <p className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                      <Users size={18} className="text-emerald-600" />
                      {activityDetailSignups.length}/{activityDetailPractice.max_participants}人参加予定（上限{activityDetailPractice.max_participants}名）
                    </p>
                    <div className="mb-4">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        参加予定メンバー（クリックでプロフィール）
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {activityDetailSignups.length === 0 ? (
                          <p className="text-sm text-slate-500">まだ参加者はいません</p>
                        ) : (
                          activityDetailSignups.map((s) => {
                            const isOrganizer = s.id === activityDetailPractice.user_id;
                            const isSelf = s.id === userId;
                            return (
                              <span
                                key={s.id}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${
                                  isSelf ? "border-emerald-200 bg-emerald-50 text-slate-700" : "border-slate-200 bg-slate-50 text-slate-700"
                                }`}
                              >
                                <span
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white ${
                                    isSelf ? "bg-emerald-600" : "bg-slate-500"
                                  }`}
                                >
                                  {(isSelf ? "自分" : s.name).slice(0, 1)}
                                </span>
                                <span className="max-w-[4.5rem] truncate font-medium">{isSelf ? "自分" : s.name}</span>
                                {isOrganizer && (
                                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                    主催者
                                  </span>
                                )}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                    {activityDetailComments.length > 0 ? (
                      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
                        {activityDetailCommentsOpen ? (
                          <>
                            <div className="mb-2 flex items-center justify-between">
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">コメント履歴</h4>
                              <button
                                type="button"
                                onClick={() => setActivityDetailCommentsOpen(false)}
                                className="text-xs text-slate-500 underline hover:text-slate-700"
                              >
                                コメントを閉じる
                              </button>
                            </div>
                            <div className="space-y-2 text-sm">
                              {activityDetailComments.map((entry) => {
                                const isOrganizer = entry.user_id === activityDetailPractice.user_id;
                                const isSelf = entry.user_id === userId;
                                return (
                                  <div
                                    key={entry.id}
                                    className={isSelf ? "flex justify-end" : "flex justify-start"}
                                  >
                                    <div
                                      className={`flex max-w-[85%] flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 ${
                                        isSelf ? "border border-emerald-100 bg-emerald-50" : "border border-slate-200 bg-white"
                                      }`}
                                    >
                                      <span className="shrink-0 text-xs text-slate-400">{formatParticipatedAt(entry.created_at)}</span>
                                      {entry.type === "join" ? (
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                                          <LogIn size={12} aria-hidden />
                                          <span>参加</span>
                                        </span>
                                      ) : entry.type === "cancel" ? (
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                                          <LogOut size={12} aria-hidden />
                                          <span>キャンセル</span>
                                        </span>
                                      ) : (
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                                          <MessageCircle size={12} aria-hidden />
                                          <span>コメント</span>
                                        </span>
                                      )}
                                      <span className="shrink-0 text-slate-600">
                                        {entry.display_name ?? "名前未設定"}
                                      </span>
                                      {isOrganizer && (
                                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>
                                      )}
                                      <span className="min-w-0 text-slate-700">{entry.comment || "—"}</span>
                                      <span className="ml-auto shrink-0">
                                        <CommentLikeButton
                                          commentId={entry.id}
                                          practiceId={activityDetailPractice.id}
                                          liked={entry.is_liked_by_me}
                                          count={entry.likes_count}
                                          likedByDisplayNames={entry.liked_by_display_names}
                                          userId={userId}
                                          onOptimisticUpdate={(payload) => {
                                            setActivityDetailComments((prev) =>
                                              prev.map((c) =>
                                                c.id === payload.commentId
                                                  ? { ...c, is_liked_by_me: payload.isLiked, likes_count: payload.count }
                                                  : c
                                              )
                                            );
                                          }}
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
                            onClick={() => setActivityDetailCommentsOpen(true)}
                            className="text-left text-sm font-medium text-slate-600 hover:text-slate-800"
                          >
                            コメントを開く（{activityDetailComments.length}件）
                          </button>
                        )}
                      </div>
                    ) : null}
                    <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                      <span className="font-medium text-slate-500">練習内容：</span>
                      {activityDetailPractice.content || "—"}
                    </p>
                    {activityDetailPractice.level ? (
                      <p className="mb-4 text-sm text-slate-600">
                        <span className="font-medium text-slate-500">練習者のレベル：</span>
                        {activityDetailPractice.level}
                      </p>
                    ) : null}
                    {activityDetailPractice.conditions ? (
                      <p className="mb-5 rounded-md bg-amber-50 px-3 py-2 text-sm text-slate-700">
                        <span className="font-medium text-slate-500">求める条件：</span>
                        {activityDetailPractice.conditions}
                      </p>
                    ) : null}
                    {!activityDetailPractice.level && !activityDetailPractice.conditions ? <div className="mb-5" /> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActivityCommentPracticeId(activityDetailPractice.id);
                          setActivityDetailPracticeId(null);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border-2 border-emerald-500 bg-white px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        <MessageCircle size={18} />
                        コメントする
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* リスト/月/週ビュー: チーム名選択と練習一覧 */}
        {viewMode !== "activity" && (
          <>
        {/* チーム名 ①②③ の切り替え（プルダウン） */}
        {myOrgNames && (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              チーム名（追加した練習を切り替えて表示）
            </h2>
            <select
              value={selectedOrgSlot}
              onChange={(e) => setSelectedOrgSlot(Number(e.target.value) as 1 | 2 | 3)}
              className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              {([1, 2, 3] as const).map((slot) => {
                const name =
                  slot === 1
                    ? (myOrgNames.org_name_1 ?? "").trim()
                    : slot === 2
                      ? (myOrgNames.org_name_2 ?? "").trim()
                      : (myOrgNames.org_name_3 ?? "").trim();
                if (!name) return null;
                return (
                  <option key={slot} value={slot}>
                    {name}
                  </option>
                );
              })}
            </select>
          </section>
        )}

        {/* リストビュー: 選択した組織の練習一覧（繰り返しは1行にまとめて表示） */}
        {myOrgNames && viewMode === "list" && (
          <section className="mb-8 rounded-lg border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
              「{selectedName || "（未選択）"}」で追加した練習（{practiceGroupsForList.length}件）
            </h2>
            {practiceGroupsForList.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                この組織ではまだ練習を追加していません
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {practiceGroupsForList.map((group) => {
                  const isRecurring = group.practices.length > 1;
                  const first = group.practices[0];
                  const last = group.practices[group.practices.length - 1];
                  const recurrenceRule = first.recurrence_rule_id ? myRecurrenceRules.find((r) => r.id === first.recurrence_rule_id) ?? null : null;
                  const recurrenceTypeLabel = recurrenceRule?.type === "weekly" ? "毎週" : recurrenceRule?.type === "monthly_date" ? "毎月（日付固定）" : recurrenceRule?.type === "monthly_nth" ? "毎月（第N曜日）" : null;
                  const startTime = first.start_time.length >= 5 ? first.start_time.slice(0, 5) : first.start_time;
                  const endTime = first.end_time.length >= 5 ? first.end_time.slice(0, 5) : first.end_time;
                  const dateRange = isRecurring
                    ? `${first.event_date.replace(/-/g, "/")}～${last.event_date.replace(/-/g, "/")}（${group.practices.length}回）`
                    : `${first.event_date.replace(/-/g, "/")} ${startTime}～${endTime}`;
                  return (
                  <li key={group.key} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-slate-600">
                          {isRecurring && (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                              繰り返し
                              {recurrenceTypeLabel && <span className="font-normal text-emerald-700"> · {recurrenceTypeLabel}</span>}
                            </span>
                          )}
                          <Calendar size={16} className="shrink-0 text-emerald-600" />
                          <span className="font-medium">
                            {dateRange}
                            {isRecurring && (
                              <span className="ml-1.5 text-slate-500 font-normal">
                                {startTime}～{endTime}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                          <MapPin size={14} className="shrink-0" />
                          {first.location}
                        </div>
                        {(first.content ?? "").trim() && (
                          <p className="mt-1 text-sm text-slate-700">{first.content}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const rule = first.recurrence_rule_id ? myRecurrenceRules.find((r) => r.id === first.recurrence_rule_id) ?? null : null;
                            setEditingPractice(first);
                            setEditingGroupIds(isRecurring ? group.practices.map((p) => p.id) : null);
                            setEditForm({
                              event_date: first.event_date,
                              start_time: startTime,
                              end_time: endTime,
                              location: first.location,
                              max_participants: first.max_participants,
                              content: first.content ?? "",
                              level: first.level ?? "",
                              conditions: first.conditions ?? "",
                              recurrence_end_date: rule?.end_date ?? "",
                            });
                          }}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          aria-label="編集"
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmIds(group.practices.map((p) => p.id))}
                          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          aria-label="削除"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* 月カレンダービュー */}
        {myOrgNames && viewMode === "month" && (
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
              <h2 className="text-lg font-semibold text-slate-900">
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
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
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
              <div className="grid grid-cols-7">
                {getMonthGrid(
                  calendarMonth.getFullYear(),
                  calendarMonth.getMonth()
                )
                  .flat()
                  .map((cell, i) => {
                    if (!cell) {
                      return (
                        <div
                          key={i}
                          className="min-h-[64px] bg-slate-50/50 sm:min-h-[72px]"
                        />
                      );
                    }
                    const key = toDateKey(cell);
                    const practices = practicesByDateKey[key] ?? [];
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
                        {practices.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-0.5">
                            {practices.slice(0, 2).map((p) => {
                              const practiceRow = myPractices.find((r) => r.id === p.id);
                              const groupPractices = practiceRow
                                ? (practiceRow.recurrence_rule_id
                                    ? myPractices.filter((r) => r.recurrence_rule_id === practiceRow.recurrence_rule_id)
                                    : [practiceRow])
                                : [];
                              const openEdit = (e: React.MouseEvent) => {
                                e.stopPropagation();
                                if (!practiceRow) return;
                                if (groupPractices.length > 1) {
                                  setCalendarScopeChoice({ practice: practiceRow, groupPractices, action: "edit" });
                                } else {
                                  const rule = practiceRow.recurrence_rule_id ? myRecurrenceRules.find((r) => r.id === practiceRow.recurrence_rule_id) ?? null : null;
                                  const st = (practiceRow.start_time ?? "").slice(0, 5);
                                  const et = (practiceRow.end_time ?? "").slice(0, 5);
                                  setEditingPractice(practiceRow);
                                  setEditingGroupIds(null);
                                  setEditForm({
                                    event_date: practiceRow.event_date,
                                    start_time: st,
                                    end_time: et,
                                    location: practiceRow.location,
                                    max_participants: practiceRow.max_participants,
                                    content: practiceRow.content ?? "",
                                    level: practiceRow.level ?? "",
                                    conditions: practiceRow.conditions ?? "",
                                    recurrence_end_date: rule?.end_date ?? "",
                                  });
                                }
                              };
                              const openDelete = (e: React.MouseEvent) => {
                                e.stopPropagation();
                                if (!practiceRow) return;
                                if (groupPractices.length > 1) {
                                  setCalendarScopeChoice({ practice: practiceRow, groupPractices, action: "delete" });
                                } else {
                                  setDeleteConfirmIds([practiceRow.id]);
                                }
                              };
                              return (
                                <div
                                  key={p.id}
                                  className="flex min-w-0 flex-1 items-start gap-0.5 rounded px-1 text-[10px] font-medium text-slate-600 sm:text-xs"
                                  title={`${p.teamName} ${p.location}`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <span className="block truncate">{p.teamName}</span>
                                    <span className="block truncate">{p.location.split(" ")[0]}</span>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-0" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      onClick={openEdit}
                                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                                      aria-label="編集"
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={openDelete}
                                      className="rounded p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                                      aria-label="削除"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                            {practices.length > 2 && (
                              <span className="text-[10px] text-slate-500">
                                +{practices.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </section>
        )}

        {/* 週カレンダービュー */}
        {myOrgNames && viewMode === "week" && (
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
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <div
                className="grid min-w-[600px]"
                style={{
                  gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))",
                  gridTemplateRows: `40px repeat(${
                    (WEEK_VIEW.endHour - WEEK_VIEW.startHour) *
                    (60 / WEEK_VIEW.slotMinutes)
                  }, ${WEEK_VIEW.slotHeightPx}px)`,
                }}
              >
                <div className="border-b border-r border-slate-200 bg-slate-50 py-2 pr-1 text-right text-xs font-semibold text-slate-500">
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
                      className={`border-b border-r border-slate-200 py-2 text-center text-sm last:border-r-0 ${
                        isToday
                          ? "bg-emerald-50 font-semibold text-emerald-700"
                          : "bg-slate-50 text-slate-700"
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
                    const totalMins =
                      WEEK_VIEW.startHour * 60 + i * WEEK_VIEW.slotMinutes;
                    const h = Math.floor(totalMins / 60);
                    const m = totalMins % 60;
                    return (
                      <div
                        key={i}
                        className="border-b border-r border-slate-100 bg-white pr-1 pt-0.5 text-right text-[10px] text-slate-400"
                        style={{ gridColumn: 1, gridRow: i + 2 }}
                      >
                        {h}:{m.toString().padStart(2, "0")}
                      </div>
                    );
                  }
                )}
                {getWeekDates(calendarWeekStart).map((day, dayIndex) => {
                  const dow = (day.getDay() + 6) % 7;
                  const isSat = dow === 5;
                  const isSun = dow === 6;
                  return Array.from(
                    {
                      length:
                        (WEEK_VIEW.endHour - WEEK_VIEW.startHour) *
                        (60 / WEEK_VIEW.slotMinutes),
                    },
                    (_, slotIndex) => {
                      const isToday =
                        toDateKey(new Date()) === toDateKey(day);
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
                  );
                })}
                {practicesInWeek.map((p) => {
                  const practiceRow = myPractices.find((r) => r.id === p.id);
                  const groupPractices = practiceRow
                    ? (practiceRow.recurrence_rule_id
                        ? myPractices.filter((r) => r.recurrence_rule_id === practiceRow.recurrence_rule_id)
                        : [practiceRow])
                    : [];
                  const openEdit = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (!practiceRow) return;
                    if (groupPractices.length > 1) {
                      setCalendarScopeChoice({ practice: practiceRow, groupPractices, action: "edit" });
                    } else {
                      const rule = practiceRow.recurrence_rule_id ? myRecurrenceRules.find((r) => r.id === practiceRow.recurrence_rule_id) ?? null : null;
                      const st = (practiceRow.start_time ?? "").slice(0, 5);
                      const et = (practiceRow.end_time ?? "").slice(0, 5);
                      setEditingPractice(practiceRow);
                      setEditingGroupIds(null);
                      setEditForm({
                        event_date: practiceRow.event_date,
                        start_time: st,
                        end_time: et,
                        location: practiceRow.location,
                        max_participants: practiceRow.max_participants,
                        content: practiceRow.content ?? "",
                        level: practiceRow.level ?? "",
                        conditions: practiceRow.conditions ?? "",
                        recurrence_end_date: rule?.end_date ?? "",
                      });
                    }
                  };
                  const openDelete = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (!practiceRow) return;
                    if (groupPractices.length > 1) {
                      setCalendarScopeChoice({ practice: practiceRow, groupPractices, action: "delete" });
                    } else {
                      setDeleteConfirmIds([practiceRow.id]);
                    }
                  };
                  return (
                    <div
                      key={p.id}
                      className="mx-0.5 flex flex-col overflow-hidden rounded-md border border-emerald-200 bg-emerald-50 py-1 px-1.5 text-left text-xs text-emerald-800"
                      style={{
                        gridColumn: p.dayIndex + 2,
                        gridRow: `${p.slotIndex + 2} / span ${p.durationSlots}`,
                      }}
                    >
                      <span className="block font-semibold">
                        {new Date(p.date).getHours()}:
                        {new Date(p.date).getMinutes().toString().padStart(2, "0")}
                        ～
                        {new Date(p.endDate).getHours()}:
                        {new Date(p.endDate).getMinutes().toString().padStart(2, "0")}
                      </span>
                      <p className="truncate font-medium" title={p.teamName}>
                        {p.teamName}
                      </p>
                      <p className="truncate" title={p.location}>
                        {p.location}
                      </p>
                      <p className="truncate text-[10px] text-slate-500" title={p.content}>
                        {p.content}
                      </p>
                      <div className="mt-auto flex items-center gap-0.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={openEdit}
                          className="rounded p-0.5 text-emerald-600 hover:bg-emerald-100"
                          aria-label="編集"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={openDelete}
                          className="rounded p-0.5 text-emerald-600 hover:bg-red-100 hover:text-red-600"
                          aria-label="削除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
          </>
        )}
      </main>

      {/* 練習日程を追加するモーダル（トップページと同じ機能） */}
      {addPracticeOpen && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setAddPracticeOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-practice-modal-title"
        >
          <div
            className="my-auto flex w-full max-w-md flex-col rounded-lg border border-slate-200 bg-white shadow-xl max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 id="add-practice-modal-title" className="text-lg font-semibold text-slate-900">
                練習日程を追加する
              </h3>
              <button
                type="button"
                onClick={() => setAddPracticeOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </div>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={async (e) => {
                e.preventDefault();
                const maxNum = Math.max(1, Math.floor(Number(addForm.maxParticipants)) || 1);
                const recurrenceType = addForm.recurrence_type ?? "none";
                const errors = {
                  teamId: !addForm.teamId.trim(),
                  date: !addForm.date.trim(),
                  timeStart: !addForm.timeStart.trim(),
                  timeEnd: !addForm.timeEnd.trim(),
                  location: !addForm.location.trim(),
                  maxParticipants: maxNum < 1,
                  content: !addForm.content.trim(),
                  level: !addForm.level.trim(),
                  requirements: !addForm.requirements.trim(),
                  recurrence_end_date:
                    recurrenceType !== "none" &&
                    (!addForm.recurrence_end_date.trim() || addForm.recurrence_end_date.trim() > getRecurrenceEndDateMax()),
                };
                setAddFormErrors(errors);
                if (Object.values(errors).some(Boolean)) return;

                const parts = addForm.teamId.split("::");
                const [uid, slot] = parts.length === 2 ? parts : [addForm.teamId, "1"];
                const organizer = organizerTeams.find((o) => o.user_id === uid);
                const team_name =
                  slot === "1"
                    ? (organizer?.org_name_1 ?? "").trim()
                    : slot === "2"
                      ? (organizer?.org_name_2 ?? "").trim()
                      : (organizer?.org_name_3 ?? "").trim();
                if (!team_name) return;

                setIsAddingPractice(true);
                const result = await createPracticesWithRecurrence({
                  team_name,
                  event_date: String(addForm.date).trim(),
                  start_time: String(addForm.timeStart).trim().slice(0, 5).padStart(5, "0"),
                  end_time: String(addForm.timeEnd).trim().slice(0, 5).padStart(5, "0"),
                  location: addForm.location.trim(),
                  max_participants: Number(
                    Math.max(1, Math.floor(Number(addForm.maxParticipants)) || 1)
                  ),
                  content: addForm.content.trim(),
                  level: addForm.level.trim(),
                  conditions: addForm.requirements.trim(),
                  recurrence_type: recurrenceType,
                  recurrence_end_date:
                    recurrenceType !== "none" ? addForm.recurrence_end_date.trim() : null,
                });
                if (!result.success) {
                  console.error("createPracticesWithRecurrence:", result.error);
                  setIsAddingPractice(false);
                  return;
                }
                setAddForm({
                  teamId: "",
                  date: "",
                  timeStart: "14:00",
                  timeEnd: "16:00",
                  location: "",
                  maxParticipants: 8,
                  content: "",
                  level: "",
                  requirements: "",
                  recurrence_type: "none",
                  recurrence_end_date: "",
                });
                setAddFormErrors({});
                setAddPracticeOpen(false);
                setIsAddingPractice(false);
                await fetchMyPractices();
                setAddSuccessVisible(true);
              }}
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                <div>
                  <label
                    htmlFor="add-team"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    チーム
                  </label>
                  <select
                    id="add-team"
                    value={addForm.teamId}
                    onChange={(e) => {
                      setAddForm((f) => ({ ...f, teamId: e.target.value }));
                      setAddFormErrors((err) => ({ ...err, teamId: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">チームを選択</option>
                    {organizerTeams
                      .filter((o) => o.user_id === userId)
                      .flatMap((o) => {
                        const options: { key: string; value: string; label: string }[] = [];
                        if ((o.org_name_1 ?? "").trim() !== "")
                          options.push({
                            key: `${o.user_id}-1`,
                            value: `${o.user_id}::1`,
                            label: o.org_name_1!.trim(),
                          });
                        if ((o.org_name_2 ?? "").trim() !== "")
                          options.push({
                            key: `${o.user_id}-2`,
                            value: `${o.user_id}::2`,
                            label: o.org_name_2!.trim(),
                          });
                        if ((o.org_name_3 ?? "").trim() !== "")
                          options.push({
                            key: `${o.user_id}-3`,
                            value: `${o.user_id}::3`,
                            label: o.org_name_3!.trim(),
                          });
                        return options.map((opt) => (
                          <option key={opt.key} value={opt.value}>
                            {opt.label}
                          </option>
                        ));
                      })}
                  </select>
                  {addFormErrors.teamId && (
                    <p className="mt-1 text-sm text-red-600">入力してください</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="add-date"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    日付
                  </label>
                  <input
                    id="add-date"
                    type="date"
                    value={addForm.date}
                    onChange={(e) => {
                      setAddForm((f) => ({ ...f, date: e.target.value }));
                      setAddFormErrors((err) => ({ ...err, date: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {addFormErrors.date && (
                    <p className="mt-1 text-sm text-red-600">入力してください</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="add-time-start"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      開始時刻
                    </label>
                    <input
                      id="add-time-start"
                      type="time"
                      value={addForm.timeStart}
                      onChange={(e) => {
                        setAddForm((f) => ({ ...f, timeStart: e.target.value }));
                        setAddFormErrors((err) => ({ ...err, timeStart: false }));
                      }}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    {addFormErrors.timeStart && (
                      <p className="mt-1 text-sm text-red-600">入力してください</p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="add-time-end"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      終了時刻
                    </label>
                    <input
                      id="add-time-end"
                      type="time"
                      value={addForm.timeEnd}
                      onChange={(e) => {
                        setAddForm((f) => ({ ...f, timeEnd: e.target.value }));
                        setAddFormErrors((err) => ({ ...err, timeEnd: false }));
                      }}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    {addFormErrors.timeEnd && (
                      <p className="mt-1 text-sm text-red-600">入力してください</p>
                    )}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="add-recurrence"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    繰り返しの設定
                  </label>
                  <select
                    id="add-recurrence"
                    value={addForm.recurrence_type}
                    onChange={(e) => {
                      const v = e.target.value as RecurrenceType;
                      setAddForm((f) => ({
                        ...f,
                        recurrence_type: v,
                        recurrence_end_date: v === "none" ? "" : f.recurrence_end_date,
                      }));
                      setAddFormErrors((err) => ({ ...err, recurrence_end_date: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="none">なし</option>
                    <option value="weekly">毎週</option>
                    <option value="monthly_date">毎月（日付固定）</option>
                    <option value="monthly_nth">毎月（第N曜日）</option>
                  </select>
                </div>
                {addForm.recurrence_type !== "none" && (
                  <div>
                    <label
                      htmlFor="add-recurrence-end"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      終了日
                    </label>
                    <input
                      id="add-recurrence-end"
                      type="date"
                      max={getRecurrenceEndDateMax()}
                      value={addForm.recurrence_end_date}
                      onChange={(e) => {
                        setAddForm((f) => ({ ...f, recurrence_end_date: e.target.value }));
                        setAddFormErrors((err) => ({ ...err, recurrence_end_date: false }));
                      }}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    {addFormErrors.recurrence_end_date && (
                      <p className="mt-1 text-sm text-red-600">
                        {!addForm.recurrence_end_date.trim()
                          ? "繰り返しの場合は終了日を入力してください"
                          : "繰り返しの終了日は年内を指定してください"}
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <label
                    htmlFor="add-location"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    場所
                  </label>
                  <input
                    id="add-location"
                    type="text"
                    placeholder="例：〇〇体育館"
                    value={addForm.location}
                    onChange={(e) => {
                      setAddForm((f) => ({ ...f, location: e.target.value }));
                      setAddFormErrors((err) => ({ ...err, location: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {addFormErrors.location && (
                    <p className="mt-1 text-sm text-red-600">入力してください</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="add-max"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    参加人数上限
                  </label>
                  <input
                    id="add-max"
                    type="number"
                    min={1}
                    max={99}
                    value={addForm.maxParticipants}
                    onChange={(e) => {
                      setAddForm((f) => ({
                        ...f,
                        maxParticipants: parseInt(e.target.value, 10) || 1,
                      }));
                      setAddFormErrors((err) => ({ ...err, maxParticipants: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {addFormErrors.maxParticipants && (
                    <p className="mt-1 text-sm text-red-600">入力してください</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="add-content"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    練習内容
                  </label>
                  <textarea
                    id="add-content"
                    rows={2}
                    placeholder="例：基礎練習・ゲーム"
                    value={addForm.content}
                    onChange={(e) => {
                      setAddForm((f) => ({ ...f, content: e.target.value }));
                      setAddFormErrors((err) => ({ ...err, content: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {addFormErrors.content && (
                    <p className="mt-1 text-sm text-red-600">入力してください</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="add-level"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    練習者のレベル
                  </label>
                  <input
                    id="add-level"
                    type="text"
                    placeholder="例：初級〜中級、中級以上"
                    value={addForm.level}
                    onChange={(e) => {
                      setAddForm((f) => ({ ...f, level: e.target.value }));
                      setAddFormErrors((err) => ({ ...err, level: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {addFormErrors.level && (
                    <p className="mt-1 text-sm text-red-600">入力してください</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="add-requirements"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    求める条件
                  </label>
                  <textarea
                    id="add-requirements"
                    rows={2}
                    placeholder="例：レベル問わず、フォア打ちができるくらい、相手の練習内容にある程度対応できる"
                    value={addForm.requirements}
                    onChange={(e) => {
                      setAddForm((f) => ({ ...f, requirements: e.target.value }));
                      setAddFormErrors((err) => ({ ...err, requirements: false }));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {addFormErrors.requirements && (
                    <p className="mt-1 text-sm text-red-600">入力してください</p>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setAddPracticeOpen(false)}
                  className="flex-1 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isAddingPractice}
                  className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {isAddingPractice ? "追加中…" : "追加する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 練習を編集するモーダル */}
      {editingPractice && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => { setEditingPractice(null); setEditingGroupIds(null); setEditRecurrenceError(null); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-practice-modal-title"
        >
          <div
            className="my-auto flex w-full max-w-md flex-col rounded-lg border border-slate-200 bg-white shadow-xl max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 id="edit-practice-modal-title" className="text-lg font-semibold text-slate-900">
                練習を編集
              </h3>
              <button
                type="button"
                onClick={() => { setEditingPractice(null); setEditingGroupIds(null); setEditRecurrenceError(null); }}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </div>
            {editingGroupIds && editingGroupIds.length > 1 && (
              <p className="border-b border-slate-100 px-6 py-2 text-sm text-slate-600">
                時間・場所・内容などの変更は、この繰り返しの全{editingGroupIds.length}回に反映されます。
              </p>
            )}
            {editingPractice?.recurrence_rule_id && (() => {
              const rule = myRecurrenceRules.find((r) => r.id === editingPractice.recurrence_rule_id);
              return rule ? (
                <div className="border-b border-slate-100 px-6 py-3">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">繰り返しの設定</h4>
                  <p className="mb-1 text-sm text-slate-600">
                    {rule.type === "weekly" ? "毎週" : rule.type === "monthly_date" ? "毎月（日付固定）" : "毎月（第N曜日）"}
                  </p>
                  <label htmlFor="edit-recurrence-end" className="mb-1 block text-sm font-medium text-slate-700">終了日</label>
                  <input
                    id="edit-recurrence-end"
                    type="date"
                    max={getRecurrenceEndDateMax()}
                    value={editForm.recurrence_end_date}
                    onChange={(e) => { setEditForm((f) => ({ ...f, recurrence_end_date: e.target.value })); setEditRecurrenceError(null); }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {editRecurrenceError && <p className="mt-1 text-sm text-red-600" role="alert">{editRecurrenceError}</p>}
                  <p className="mt-1 text-xs text-slate-500">終了日は年内で指定してください。変更すると、その日付に合わせて練習日程が追加または削除されます。</p>
                </div>
              ) : null;
            })()}
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!editingPractice) return;
                setIsUpdatingPractice(true);
                const idsToUpdate = editingGroupIds?.length ? editingGroupIds : [editingPractice.id];
                const payload = {
                  event_date: editForm.event_date.trim(),
                  start_time: editForm.start_time.trim().slice(0, 5).padStart(5, "0"),
                  end_time: editForm.end_time.trim().slice(0, 5).padStart(5, "0"),
                  location: editForm.location.trim(),
                  max_participants: Math.max(1, Math.floor(Number(editForm.max_participants)) || 1),
                  content: editForm.content.trim() || null,
                  level: editForm.level.trim() || null,
                  conditions: editForm.conditions.trim() || null,
                };
                for (const id of idsToUpdate) {
                  const row = myPractices.find((r) => r.id === id);
                  const result = await updatePractice({
                    id,
                    ...payload,
                    event_date: row ? row.event_date : payload.event_date,
                  });
                  if (!result.success) {
                    console.error("updatePractice:", result.error);
                    setIsUpdatingPractice(false);
                    return;
                  }
                }
                const rule = editingPractice.recurrence_rule_id ? myRecurrenceRules.find((r) => r.id === editingPractice.recurrence_rule_id) : null;
                if (rule && editForm.recurrence_end_date.trim() && editForm.recurrence_end_date.trim() !== rule.end_date) {
                  const res = await updateRecurrenceRuleEndDate(editingPractice.recurrence_rule_id, editForm.recurrence_end_date.trim());
                  if (!res.success) {
                    setEditRecurrenceError(res.error ?? "終了日の更新に失敗しました。");
                    setIsUpdatingPractice(false);
                    return;
                  }
                }
                setEditRecurrenceError(null);
                setIsUpdatingPractice(false);
                setEditingPractice(null);
                setEditingGroupIds(null);
                await fetchMyPractices();
                await fetchMyRecurrenceRules();
              }}
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                <p className="text-sm text-slate-500">{editingPractice.team_name}</p>
                {!editingGroupIds?.length && (
                  <div>
                    <label htmlFor="edit-date" className="mb-1 block text-sm font-medium text-slate-700">日付</label>
                    <input
                      id="edit-date"
                      type="date"
                      value={editForm.event_date}
                      onChange={(e) => setEditForm((f) => ({ ...f, event_date: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="edit-time-start" className="mb-1 block text-sm font-medium text-slate-700">開始時刻</label>
                    <input
                      id="edit-time-start"
                      type="time"
                      value={editForm.start_time}
                      onChange={(e) => setEditForm((f) => ({ ...f, start_time: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-time-end" className="mb-1 block text-sm font-medium text-slate-700">終了時刻</label>
                    <input
                      id="edit-time-end"
                      type="time"
                      value={editForm.end_time}
                      onChange={(e) => setEditForm((f) => ({ ...f, end_time: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="edit-location" className="mb-1 block text-sm font-medium text-slate-700">場所</label>
                  <input
                    id="edit-location"
                    type="text"
                    value={editForm.location}
                    onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="edit-max" className="mb-1 block text-sm font-medium text-slate-700">参加人数上限</label>
                  <input
                    id="edit-max"
                    type="number"
                    min={1}
                    value={editForm.max_participants}
                    onChange={(e) => setEditForm((f) => ({ ...f, max_participants: Math.max(1, Math.floor(Number(e.target.value)) || 1) }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="edit-content" className="mb-1 block text-sm font-medium text-slate-700">練習内容</label>
                  <input
                    id="edit-content"
                    type="text"
                    value={editForm.content}
                    onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="edit-level" className="mb-1 block text-sm font-medium text-slate-700">練習者のレベル</label>
                  <input
                    id="edit-level"
                    type="text"
                    value={editForm.level}
                    onChange={(e) => setEditForm((f) => ({ ...f, level: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label htmlFor="edit-conditions" className="mb-1 block text-sm font-medium text-slate-700">求める条件</label>
                  <textarea
                    id="edit-conditions"
                    rows={2}
                    value={editForm.conditions}
                    onChange={(e) => setEditForm((f) => ({ ...f, conditions: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <button
                  type="button"
                  onClick={() => { setEditingPractice(null); setEditingGroupIds(null); setEditRecurrenceError(null); }}
                  className="flex-1 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingPractice}
                  className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {isUpdatingPractice ? "保存中…" : "保存する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 月・週ビュー用: この回だけ / 繰り返し全体 の選択 */}
      {calendarScopeChoice && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setCalendarScopeChoice(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="calendar-scope-title"
        >
          <div
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="calendar-scope-title" className="text-lg font-semibold text-slate-900">
              {calendarScopeChoice.action === "edit" ? "編集範囲" : "削除範囲"}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {calendarScopeChoice.action === "edit"
                ? "この回だけ編集しますか？繰り返し全体に反映しますか？"
                : "この回だけ削除しますか？繰り返し全体を削除しますか？"}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const { practice, groupPractices, action } = calendarScopeChoice;
                  if (action === "edit") {
                    const rule = practice.recurrence_rule_id ? myRecurrenceRules.find((r) => r.id === practice.recurrence_rule_id) ?? null : null;
                    const st = (practice.start_time ?? "").slice(0, 5);
                    const et = (practice.end_time ?? "").slice(0, 5);
                    setEditingPractice(practice);
                    setEditingGroupIds(null);
                    setEditForm({
                      event_date: practice.event_date,
                      start_time: st,
                      end_time: et,
                      location: practice.location,
                      max_participants: practice.max_participants,
                      content: practice.content ?? "",
                      level: practice.level ?? "",
                      conditions: practice.conditions ?? "",
                      recurrence_end_date: rule?.end_date ?? "",
                    });
                  } else {
                    setDeleteConfirmIds([practice.id]);
                  }
                  setCalendarScopeChoice(null);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {calendarScopeChoice.action === "edit" ? "この回だけ編集" : "この回だけ削除"}
              </button>
              {calendarScopeChoice.groupPractices.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const { practice, groupPractices, action } = calendarScopeChoice;
                    if (action === "edit") {
                      const rule = practice.recurrence_rule_id ? myRecurrenceRules.find((r) => r.id === practice.recurrence_rule_id) ?? null : null;
                      const first = groupPractices.sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""))[0];
                      const st = (first.start_time ?? "").slice(0, 5);
                      const et = (first.end_time ?? "").slice(0, 5);
                      setEditingPractice(first);
                      setEditingGroupIds(groupPractices.map((p) => p.id));
                      setEditForm({
                        event_date: first.event_date,
                        start_time: st,
                        end_time: et,
                        location: first.location,
                        max_participants: first.max_participants,
                        content: first.content ?? "",
                        level: first.level ?? "",
                        conditions: first.conditions ?? "",
                        recurrence_end_date: rule?.end_date ?? "",
                      });
                    } else {
                      setDeleteConfirmIds(groupPractices.map((p) => p.id));
                    }
                    setCalendarScopeChoice(null);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {calendarScopeChoice.action === "edit"
                    ? `繰り返し全体を編集（${calendarScopeChoice.groupPractices.length}件）`
                    : `繰り返し全体を削除（${calendarScopeChoice.groupPractices.length}件）`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setCalendarScopeChoice(null)}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {deleteConfirmIds && deleteConfirmIds.length > 0 && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setDeleteConfirmIds(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-confirm-title" className="text-lg font-semibold text-slate-900">
              {deleteConfirmIds.length === 1 ? "練習を削除しますか？" : `この繰り返しスケジュール（${deleteConfirmIds.length}件）を削除しますか？`}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              削除すると参加申し込みやコメント履歴も一緒に削除され、元に戻せません。
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmIds(null)}
                className="flex-1 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={isDeletingPractice}
                onClick={async () => {
                  setIsDeletingPractice(true);
                  for (const id of deleteConfirmIds) {
                    const result = await deletePractice(id);
                    if (!result.success) console.error("deletePractice:", result.error);
                  }
                  setIsDeletingPractice(false);
                  setDeleteConfirmIds(null);
                  await fetchMyPractices();
                }}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isDeletingPractice ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 追加完了ポップアップ（ボワっと表示） */}
      {addSuccessVisible && (
        <div
          className={`fixed inset-0 z-30 flex items-center justify-center p-4 bg-slate-900/25 backdrop-blur-[2px] transition-opacity duration-300 ${
            addSuccessReady ? "opacity-100" : "opacity-0"
          }`}
          role="alert"
          aria-live="polite"
          onClick={() => setAddSuccessVisible(false)}
        >
          <div
            className={`rounded-xl bg-white px-8 py-6 shadow-xl transition-all duration-300 ease-out ${
              addSuccessReady ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-semibold text-slate-900">追加が完了しました！</p>
            <button
              type="button"
              onClick={() => setAddSuccessVisible(false)}
              className="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
