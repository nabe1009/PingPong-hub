"use client";

import { useState, useMemo, useCallback, useEffect, useRef, useOptimistic, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { PrefectureCityRow, PracticeRow, UserProfileRow, SignupRow, PracticeCommentRow, PracticeCommentWithLikes } from "@/lib/supabase/client";
import { sortPrefecturesNorthToSouth, PREFECTURES_NORTH_TO_SOUTH } from "@/lib/prefectures";
import { toggleParticipation } from "@/app/actions/toggle-participation";
import { postComment } from "@/app/actions/post-practice-comment";
import { getTeamMembersForUser, getMyTeamMembers, getTeamMembershipsByUserIds } from "@/app/actions/team-members";
import { getPractices } from "@/app/actions/get-practices";
import { getPracticeById } from "@/app/actions/get-practice-by-id";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
  useAuth,
} from "@clerk/nextjs";
import {
  Calendar,
  CalendarDays,
  CheckCircle,
  List,
  Lock,
  MapPin,
  Users,
  ChevronRight,
  ChevronLeft,
  LogIn,
  LogOut,
  X,
  Search,
  Plus,
  MessageCircle,
  Menu,
  Share2,
} from "lucide-react";
import { CommentLikeButton } from "@/app/components/CommentLikeButton";

type ViewMode = "list" | "month" | "week";

type Practice = {
  id: string;
  /** 開始日時 ISO */
  date: string;
  /** 終了日時 ISO */
  endDate: string;
  location: string;
  participants: { id: string; name: string }[];
  /** 参加人数の上限 */
  maxParticipants: number;
  /** 練習内容（試合多め、課題練習多め、前半1時間練習・後半1時間試合 など） */
  content: string;
  /** 練習者のレベル（任意） */
  level?: string;
  /** 求める条件（レベル問わず、フォア打ちができるくらい など）（任意） */
  requirements?: string;
  /** 参加費（例: 500円、無料）（任意） */
  fee?: string;
  /** チーム内限定公開 */
  is_private?: boolean;
  /** プライベート閲覧判定用：practices.team_id（都道府県で別チームの判定に使用） */
  practiceTeamId?: string | null;
  /** プライベート閲覧判定用：practices.prefecture */
  practicePrefecture?: string | null;
};

type Team = {
  id: string;
  name: string;
  prefecture: string;
  /** 市で区別（京都市、長岡京市、宇治市 など） */
  city: string;
  practices: Practice[];
};

// 都道府県一覧（Supabase 連携確認のためサイト上では空・prefectures_cities で取得する想定）
const PREFECTURES: string[] = [];

// 練習の一意キー（チームID + 練習ID）
function practiceKey(teamId: string, practiceId: string): string {
  return `${teamId}-${practiceId}`;
}

// ダミーデータ: Supabase 連携確認のため空（practices 等で取得する想定）
const MOCK_TEAMS: Team[] = [];

export type PracticeWithMeta = Practice & {
  practiceKey: string;
  teamId: string;
  teamName: string;
};

const ACCENT = "#059669";
const ACCENT_HOVER = "#047857";

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

/** 練習詳細への共有URL（?practice=id で直接詳細が開く） */
function getShareUrl(p: PracticeWithMeta, origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/?practice=${p.id}`;
}

/** 練習の共有用テキストを生成 */
function buildShareText(p: PracticeWithMeta, origin: string): string {
  const shareUrl = getShareUrl(p, origin);
  const lines = [
    "【練習会のお知らせ】",
    p.teamName,
    formatPracticeDate(p.date, p.endDate),
    `場所: ${p.location}`,
    `参加費: ¥${p.fee ?? "—"}`,
    `${p.maxParticipants}名まで`,
    "",
    `練習内容: ${p.content}`,
    "",
    `詳細はこちら: ${shareUrl}`,
  ];
  return lines.join("\n");
}

/** LINE用の短い共有テキスト（URL長制限対策） */
function buildShareTextForLine(p: PracticeWithMeta, origin: string): string {
  const shareUrl = getShareUrl(p, origin);
  const lines = [
    "【練習会のお知らせ】",
    `${p.teamName} ${formatPracticeDate(p.date, p.endDate)}`,
    `${p.location} ${shareUrl}`,
  ];
  return lines.join("\n");
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 直近1か月（今以降〜30日後）に含まれるか。今日以降の練習のみカウント */
function isWithinLastMonth(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);
  return d >= now && d <= end;
}

/** 開始〜終了時刻のみ（例: 14:00〜16:00） */
function formatTimeRange(isoStart: string, isoEnd: string) {
  const s = new Date(isoStart);
  const e = new Date(isoEnd);
  const sh = s.getHours();
  const sm = s.getMinutes();
  const eh = e.getHours();
  const em = e.getMinutes();
  return `${sh}:${sm.toString().padStart(2, "0")}〜${eh}:${em.toString().padStart(2, "0")}`;
}

/** 参加人数表示（現在/上限）。自分が参加する場合は current に +1 する想定 */
function formatParticipantLimit(
  current: number,
  max: number,
  includeSelf?: boolean
): string {
  const n = includeSelf ? current + 1 : current;
  return `${n}/${max}人`;
}

/** 参加日時（ISO）を表示用に整形（例: 2/14 14:30） */
function formatParticipatedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** タイムライン表示名を user_profiles.display_name 優先にする（保存済みの "Y W" 等も上書き） */
async function enrichCommentsWithDisplayNames(
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
async function enrichCommentsWithLikes(
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

/** 定員に達しているか（maxParticipants が 1 未満のときは定員なしとして false） */
function isPracticeFull(p: Practice, includeSelf?: boolean, currentCount?: number): boolean {
  if (p.maxParticipants < 1) return false;
  const count = currentCount ?? p.participants.length;
  const current = includeSelf ? count + 1 : count;
  return current >= p.maxParticipants;
}

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
    const fill = rows[rows.length - 1];
    const nextRow: (Date | null)[] = [];
    for (let i = 0; i < 7; i++) nextRow.push(null);
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

// チームごとの色分け用（選択チームの表示順で割り当て）
const TEAM_COLOR_CLASSES = [
  "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200",
  "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200",
  "bg-violet-100 text-violet-800 border-violet-200 hover:bg-violet-200",
  "bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-200",
  "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200",
  "bg-sky-100 text-sky-800 border-sky-200 hover:bg-sky-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200",
  "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200",
];
const DEFAULT_TEAM_CLASSES = "bg-slate-200 text-slate-600 border-slate-300 hover:bg-slate-300";

// 週ビュー用: 30分区切りバーティカル
const WEEK_VIEW = {
  startHour: 6,
  endHour: 22,
  slotMinutes: 30,
  slotHeightPx: 28,
} as const;

function getTimeSlotIndex(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  const start = WEEK_VIEW.startHour;
  const end = WEEK_VIEW.endHour;
  if (hours < start || hours >= end) return -1;
  return Math.floor((hours - start) * (60 / WEEK_VIEW.slotMinutes));
}

function getPracticesInWeek(
  weekStart: Date,
  practices: PracticeWithMeta[]
): (PracticeWithMeta & { dayIndex: number; slotIndex: number; durationSlots: number })[] {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startTs = start.getTime();
  const endTs = weekEnd.getTime();
  const result: (PracticeWithMeta & { dayIndex: number; slotIndex: number; durationSlots: number })[] = [];
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

function HomeContent() {
  const searchParams = useSearchParams();
  const [subscribedTeamIds, setSubscribedTeamIds] = useState<string[]>([]);
  /** 参加するモーダルで対象の練習（null のときモーダル非表示） */
  const [participateTargetPracticeKey, setParticipateTargetPracticeKey] = useState<string | null>(null);
  const [participateComment, setParticipateComment] = useState("");
  /** キャンセルするモーダルで対象の練習（null のときモーダル非表示） */
  const [cancelTargetPracticeKey, setCancelTargetPracticeKey] = useState<string | null>(null);
  const [cancelComment, setCancelComment] = useState("");
  const [selectedPracticeKey, setSelectedPracticeKey] = useState<string | null>(null);
  /** URL ?practice=id で開いた共有リンク用の練習（購読チーム外でも表示） */
  const [sharedPracticeFromUrl, setSharedPracticeFromUrl] = useState<PracticeWithMeta | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [prefectureInput, setPrefectureInput] = useState("");
  const [selectedPrefecture, setSelectedPrefecture] = useState<string | null>(null);
  const [prefectureDropdownOpen, setPrefectureDropdownOpen] = useState(false);
  const { userId } = useAuth();
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [addedTeams, setAddedTeams] = useState<{ id: string; name: string; prefecture: string; city: string }[]>([]);
  const [addedPractices, setAddedPractices] = useState<{ teamId: string; practice: Practice }[]>([]);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [profileModalData, setProfileModalData] = useState<UserProfileRow | null>(null);
  /** プロフィールモーダル用：対象ユーザーの所属チーム表示名（team_members 由来のみ） */
  const [profileModalTeamNames, setProfileModalTeamNames] = useState<string[]>([]);
  const [profileModalLoaded, setProfileModalLoaded] = useState(false);
  /** ログインユーザーの所属チーム（team_members）。居住地セクションの上にチェック欄を出す用 */
  const [myTeamMembers, setMyTeamMembers] = useState<
    { id: string; team_id: string | null; custom_team_name: string | null; display_name: string; display_prefecture?: string }[]
  >([]);
  const affiliatedDefaultAppliedRef = useRef(false);
  /** プロフィールモーダルのボワっと表示用（mount 後に opacity を効かせる） */
  const [profileModalReady, setProfileModalReady] = useState(false);
  /** 練習ID → 参加者（signups） */
  const [signupsByPracticeId, setSignupsByPracticeId] = useState<Record<string, SignupRow[]>>({});
  /** 参加者表示名の補完（user_profiles.display_name）user_id → display_name */
  const [displayNameByUserId, setDisplayNameByUserId] = useState<Record<string, string | null>>({});
  /** 参加者ごとの所属チーム（teamIds / teamNames / 都道府県+名前キー）。チーム・ゲストの表示用 */
  const [participantTeamMemberships, setParticipantTeamMemberships] = useState<
    Record<string, { teamIds: string[]; teamNames: string[]; teamPrefectureNameKeys: string[] }>
  >({});
  /** 練習ID → 参加・キャンセル履歴（practice_comments + いいね情報） */
  const [practiceCommentsByPracticeId, setPracticeCommentsByPracticeId] = useState<Record<string, PracticeCommentWithLikes[]>>({});
  const [optimisticComments, setOptimisticComments] = useOptimistic(
    practiceCommentsByPracticeId,
    (state, action: { practiceId: string; commentId: string; isLiked: boolean; count: number }) => {
      const next = { ...state };
      const list = next[action.practiceId];
      if (!list) return state;
      next[action.practiceId] = list.map((c) =>
        c.id === action.commentId ? { ...c, is_liked_by_me: action.isLiked, likes_count: action.count } : c
      );
      return next;
    }
  );
  const [participationActionError, setParticipationActionError] = useState<string | null>(null);
  const [participationSubmitting, setParticipationSubmitting] = useState(false);
  /** コメント投稿フォーム */
  const [freeCommentSubmitting, setFreeCommentSubmitting] = useState(false);
  const [freeCommentError, setFreeCommentError] = useState<string | null>(null);
  /** コメントするポップアップ（practiceKey がセットで開く） */
  const [commentPopupPracticeKey, setCommentPopupPracticeKey] = useState<string | null>(null);
  /** 共有ポップアップ（practiceKey がセットで開く） */
  const [sharePopupPracticeKey, setSharePopupPracticeKey] = useState<string | null>(null);
  /** 共有ポップアップ内でコピー完了したか */
  const [shareCopySuccess, setShareCopySuccess] = useState(false);
  const [commentPopupText, setCommentPopupText] = useState("");
  /** 練習詳細モーダルでコメント履歴を開いているか */
  const [practiceModalCommentOpen, setPracticeModalCommentOpen] = useState(false);
  /** 参加する押下時にプロフィール未登録なら表示するポップアップ */
  const [profileRequiredPopupOpen, setProfileRequiredPopupOpen] = useState(false);
  /** 参加する押下時に未ログインなら表示するログイン誘導ポップアップ */
  const [loginRequiredPopupOpen, setLoginRequiredPopupOpen] = useState(false);
  /** PingPong Hubとは？ポップアップ */
  const [aboutPopupOpen, setAboutPopupOpen] = useState(false);
  /** スマホ用ナビドロワー開閉 */
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);

  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const weekCalendarScrollRef = useRef<HTMLDivElement>(null);
  const weekTodayColumnRef = useRef<HTMLDivElement>(null);
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // 週ビューを開いたとき・週を切り替えたときに9時が上に見える＋今日の列がまず見えるようスクロール
  useEffect(() => {
    if (viewMode !== "week") return;
    const el = weekCalendarScrollRef.current;
    if (!el) return;
    const slotsToScroll = ((9 - WEEK_VIEW.startHour) * 60) / WEEK_VIEW.slotMinutes;
    const scrollTop = slotsToScroll * WEEK_VIEW.slotHeightPx;
    const id = requestAnimationFrame(() => {
      el.scrollTop = scrollTop;
      requestAnimationFrame(() => {
        if (weekTodayColumnRef.current) {
          el.scrollLeft = Math.max(0, weekTodayColumnRef.current.offsetLeft - 8);
        }
      });
    });
    return () => cancelAnimationFrame(id);
  }, [viewMode, calendarWeekStart]);

  /** 練習追加モーダル用：Supabase prefectures_cities の都道府県・市一覧 */
  const [prefectureCityRows, setPrefectureCityRows] = useState<PrefectureCityRow[]>([]);

  /** 練習追加モーダル用：user_profiles の主催者チーム一覧（スロットごとに都道府県を持つ） */
  const [organizerTeams, setOrganizerTeams] = useState<{
    user_id: string;
    org_name_1: string | null;
    org_name_2: string | null;
    org_name_3: string | null;
    org_prefecture_1: string | null;
    org_prefecture_2: string | null;
    org_prefecture_3: string | null;
  }[]>([]);

  /** ログインユーザーのプロフィール居住地（user_profiles.prefecture） */
  const [profilePrefecture, setProfilePrefecture] = useState<string | null>(null);

  /** Supabase practices テーブルから取得した練習一覧（保存後に再取得してカレンダーを更新） */
  const [fetchedPractices, setFetchedPractices] = useState<PracticeRow[]>([]);

  useEffect(() => {
    async function fetchOrganizerTeams() {
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id, org_name_1, org_name_2, org_name_3, org_prefecture_1, org_prefecture_2, org_prefecture_3")
        .eq("is_organizer", true)
        .limit(5000);
      const rows = (data as {
        user_id: string;
        org_name_1: string | null;
        org_name_2: string | null;
        org_name_3: string | null;
        org_prefecture_1: string | null;
        org_prefecture_2: string | null;
        org_prefecture_3: string | null;
      }[]) ?? [];
      const hasAnyOrgName = (r: typeof rows[0]) => [r.org_name_1, r.org_name_2, r.org_name_3].some((v) => (v ?? "").trim() !== "");
      setOrganizerTeams(rows.filter(hasAnyOrgName));
    }
    fetchOrganizerTeams();
  }, []);

  /** ログインユーザーが練習会主催者かどうか & プロフィール居住地（user_profiles） */
  useEffect(() => {
    if (!userId) {
      setIsOrganizer(false);
      setProfilePrefecture(null);
      return;
    }
    async function fetchProfile() {
      const { data } = await supabase
        .from("user_profiles")
        .select("is_organizer, prefecture")
        .eq("user_id", userId)
        .maybeSingle();
      const row = data as { is_organizer?: boolean; prefecture?: string | null } | null;
      setIsOrganizer(!!row?.is_organizer);
      const pref = row?.prefecture?.trim();
      setProfilePrefecture(pref || null);
    }
    fetchProfile();
  }, [userId]);

  /** ログインユーザーの所属チーム（居住地セクションの上にチェック欄を表示する用） */
  useEffect(() => {
    if (!userId) {
      setMyTeamMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await getMyTeamMembers();
      if (cancelled) return;
      if (res.success) setMyTeamMembers(res.data);
      else setMyTeamMembers([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /** 練習一覧を取得（公開＋自分が所属するチームの非公開のみ・サーバーでフィルタ） */
  const fetchPractices = useCallback(async () => {
    const res = await getPractices();
    if (!res.success) {
      console.error("practices fetch error:", res.error);
      return;
    }
    setFetchedPractices(res.data);
  }, []);

  useEffect(() => {
    fetchPractices();
  }, [fetchPractices]);

  /** URL ?practice=id があれば練習詳細を取得してモーダルを開く */
  const practiceIdFromUrl = searchParams.get("practice");
  useEffect(() => {
    const practiceId = practiceIdFromUrl;
    if (!practiceId?.trim()) return;
    let cancelled = false;
    (async () => {
      const res = await getPracticeById(practiceId);
      if (cancelled || !res.success) return;
      const row = res.data;
      const dateStart =
        row.event_date +
        "T" +
        (row.start_time.length === 5 ? row.start_time : row.start_time + ":00").slice(0, 5) +
        ":00";
      const dateEnd =
        row.event_date +
        "T" +
        (row.end_time.length === 5 ? row.end_time : row.end_time + ":00").slice(0, 5) +
        ":00";
      const teamId = row.team_id ?? "supabase-" + row.team_name;
      const teamName =
        (row as { teams?: { name: string } | null }).teams?.name ?? row.team_name;
      const p: PracticeWithMeta = {
        id: row.id,
        date: dateStart,
        endDate: dateEnd,
        location: row.location,
        participants: [],
        maxParticipants: row.max_participants,
        content: row.content ?? "",
        level: row.level ?? undefined,
        requirements: row.conditions ?? undefined,
        fee: row.fee?.trim() ? row.fee : undefined,
        is_private: row.is_private ?? false,
        practiceTeamId: row.team_id ?? undefined,
        practicePrefecture: row.prefecture ?? undefined,
        practiceKey: practiceKey(teamId, row.id),
        teamId,
        teamName,
      };
      setSharedPracticeFromUrl(p);
      setSelectedPracticeKey(p.practiceKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceIdFromUrl]);

  /** プロフィールモーダル表示時のボワっとトランジション用 */
  useEffect(() => {
    if (profileModalUserId || profileModalData) {
      setProfileModalReady(false);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setProfileModalReady(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setProfileModalReady(false);
  }, [profileModalUserId, profileModalData]);

  /** 参加メンバーをクリックしたとき: プロフィールモーダル用に user_profiles と team_members を取得 */
  useEffect(() => {
    if (!profileModalUserId) {
      setProfileModalData(null);
      setProfileModalTeamNames([]);
      setProfileModalLoaded(false);
      return;
    }
    setProfileModalLoaded(false);
    let cancelled = false;
    (async () => {
      const [profileRes, teamRes] = await Promise.all([
        supabase.from("user_profiles").select("*").eq("user_id", profileModalUserId).maybeSingle(),
        getTeamMembersForUser(profileModalUserId),
      ]);
      if (cancelled) return;
      setProfileModalData((profileRes.data as UserProfileRow) ?? null);
      setProfileModalTeamNames(teamRes.success ? teamRes.data : []);
      setProfileModalLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileModalUserId]);

  useEffect(() => {
    async function fetchPrefecturesCities() {
      const tableName = "prefectures_cities" as const;
      const { data, error } = await supabase.from(tableName).select("prefecture_name, city_name").limit(5000);
      if (error) {
        console.error("prefectures_cities fetch error:", error);
        return;
      }
      const raw = (data as { prefecture_name: string; city_name: string }[]) ?? [];
      const formattedRows: PrefectureCityRow[] = raw.map((row) => ({
        prefecture: row.prefecture_name,
        city: row.city_name,
      }));
      setPrefectureCityRows(formattedRows);
    }
    fetchPrefecturesCities();
  }, []);

  /** 都道府県名の検索用正規化（前後空白・BOM除去） */
  const normalizeForSearch = (s: string) => s.trim().replace(/\s+/g, " ").replace(/^\uFEFF/, "");

  /** 都道府県がクエリに一致するか（先頭一致：『京都』で東京都が出ないように） */
  const prefectureMatchesQuery = (prefecture: string, q: string) => {
    const pn = normalizeForSearch(prefecture);
    const qn = normalizeForSearch(q);
    if (qn.length < 1) return false;
    const pBase = pn.replace(/[都道府県]$/, "");
    return pn.startsWith(qn) || pBase.startsWith(qn);
  };

  /** 都道府県で練習を探す：予測候補（prefectures_cities があればそれを使用、空なら全国リストでフォールバック） */
  const prefectureSuggestions = useMemo(() => {
    const q = prefectureInput.trim();
    if (q.length < 1) return [];
    const fromDb = [...new Set(prefectureCityRows.map((r) => r.prefecture).filter(Boolean))];
    const prefectures = sortPrefecturesNorthToSouth(
      fromDb.length > 0 ? fromDb : [...PREFECTURES_NORTH_TO_SOUTH]
    );
    const matched = prefectures.filter((p) => prefectureMatchesQuery(p, q));
    return matched.sort((a, b) => {
      const qn = normalizeForSearch(q);
      const aStart = normalizeForSearch(a).startsWith(qn) || a.replace(/[都道府県]$/, "").startsWith(qn) ? 0 : 1;
      const bStart = normalizeForSearch(b).startsWith(qn) || b.replace(/[都道府県]$/, "").startsWith(qn) ? 0 : 1;
      return aStart - bStart || a.localeCompare(b, "ja");
    }).slice(0, 15);
  }, [prefectureInput, prefectureCityRows]);

  /** practices テーブルの行を Practice 型に変換（表示用の練習内容はすべてここから）。日付はローカル時刻のまま扱う（toISOString にしない） */
  const practicesFromTable = useMemo((): Practice[] => {
    return fetchedPractices.map((row) => {
      const dateStart = row.event_date + "T" + (row.start_time.length === 5 ? row.start_time : row.start_time + ":00").slice(0, 5) + ":00";
      const dateEnd = row.event_date + "T" + (row.end_time.length === 5 ? row.end_time : row.end_time + ":00").slice(0, 5) + ":00";
      return {
        id: row.id,
        date: dateStart,
        endDate: dateEnd,
        location: row.location,
        participants: [],
        maxParticipants: row.max_participants,
        content: row.content ?? "",
        level: row.level ?? undefined,
        requirements: row.conditions ?? undefined,
        fee: row.fee?.trim() ? row.fee : undefined,
        is_private: row.is_private ?? false,
        practiceTeamId: row.team_id ?? undefined,
        practicePrefecture: row.prefecture ?? undefined,
      };
    });
  }, [fetchedPractices]);

  /** MOCK_TEAMS + 主催者チーム（user_profiles の ①②③ ごとに1チーム）+ practices テーブル由来の練習を紐付け。選択したチーム名でユーザーに表示。 */
  const teamsData = useMemo(() => {
    const byId = new Map<string, Team>();
    for (const t of MOCK_TEAMS) {
      byId.set(t.id, { ...t, practices: [...t.practices] });
    }
    for (const o of organizerTeams) {
      if ((o.org_name_1 ?? "").trim() !== "")
        byId.set(`${o.user_id}::1`, {
          id: `${o.user_id}::1`,
          name: o.org_name_1!.trim(),
          prefecture: (o.org_prefecture_1 ?? "").trim(),
          city: "",
          practices: [],
        });
      if ((o.org_name_2 ?? "").trim() !== "")
        byId.set(`${o.user_id}::2`, {
          id: `${o.user_id}::2`,
          name: o.org_name_2!.trim(),
          prefecture: (o.org_prefecture_2 ?? "").trim(),
          city: "",
          practices: [],
        });
      if ((o.org_name_3 ?? "").trim() !== "")
        byId.set(`${o.user_id}::3`, {
          id: `${o.user_id}::3`,
          name: o.org_name_3!.trim(),
          prefecture: (o.org_prefecture_3 ?? "").trim(),
          city: "",
          practices: [],
        });
    }
    const trimP = (v: string | null | undefined) => (v ?? "").trim();
    for (const p of practicesFromTable) {
      const row = fetchedPractices.find((r) => r.id === p.id);
      if (!row) continue;
      const rowPrefecture = trimP(row.prefecture);
      const rowTeamName = trimP(row.team_name);
      const organizer = organizerTeams.find(
        (o) =>
          (trimP(o.org_prefecture_1) === rowPrefecture && trimP(o.org_name_1) === rowTeamName) ||
          (trimP(o.org_prefecture_2) === rowPrefecture && trimP(o.org_name_2) === rowTeamName) ||
          (trimP(o.org_prefecture_3) === rowPrefecture && trimP(o.org_name_3) === rowTeamName)
      );
      const pWithMeta = {
        ...p,
        practiceTeamId: row.team_id ?? undefined,
        practicePrefecture: row.prefecture ?? undefined,
      };
      if (organizer) {
        const slot =
          trimP(organizer.org_prefecture_1) === rowPrefecture && trimP(organizer.org_name_1) === rowTeamName
            ? 1
            : trimP(organizer.org_prefecture_2) === rowPrefecture && trimP(organizer.org_name_2) === rowTeamName
              ? 2
              : 3;
        const team = byId.get(`${organizer.user_id}::${slot}`);
        if (team) team.practices.push(pWithMeta);
      } else {
        const key = "supabase-" + (row.prefecture ?? "").trim() + "\t" + row.team_name;
        let team = byId.get(key);
        if (!team) {
          team = { id: key, name: row.team_name, prefecture: (row.prefecture ?? "").trim(), city: "", practices: [] };
          byId.set(key, team);
        }
        team.practices.push(pWithMeta);
      }
    }
    for (const t of addedTeams) {
      byId.set(t.id, { ...t, practices: [] });
    }
    for (const { teamId, practice } of addedPractices) {
      const team = byId.get(teamId);
      if (team) team.practices.push(practice);
    }
    return Array.from(byId.values());
  }, [organizerTeams, practicesFromTable, fetchedPractices, addedTeams, addedPractices]);

  const teamsInSelectedPrefecture = useMemo(() => {
    if (!selectedPrefecture) return [];
    return teamsData.filter((t) => t.prefecture === selectedPrefecture);
  }, [selectedPrefecture, teamsData]);

  /** プロフィール居住地の都道府県で開催されるチーム一覧 */
  const teamsInProfilePrefecture = useMemo(() => {
    if (!profilePrefecture) return [];
    return teamsData.filter((t) => t.prefecture === profilePrefecture);
  }, [profilePrefecture, teamsData]);

  /** プロフィール居住地のチームを市ごとにグループ化 */
  const teamsByProfilePrefectureCity = useMemo(() => {
    const map: Record<string, Team[]> = {};
    for (const team of teamsInProfilePrefecture) {
      const city = team.city || "（未設定）";
      if (!map[city]) map[city] = [];
      map[city].push(team);
    }
    return map;
  }, [teamsInProfilePrefecture]);

  /** 自分が所属しているチームのうち、teamsData に存在するもの（都道府県+名前で照合・同一名でも別都道府県は別チーム） */
  const myTeamsInData = useMemo(() => {
    if (myTeamMembers.length === 0) return [];
    const keysWithPrefecture = new Set<string>();
    const namesOnly = new Set<string>();
    for (const m of myTeamMembers) {
      const name = (m.display_name ?? "").trim();
      const pref = (m.display_prefecture ?? "").trim();
      if (!name) continue;
      if (pref && pref !== "—") keysWithPrefecture.add(`${pref}\t${name}`);
      else namesOnly.add(name);
    }
    return teamsData.filter((t) => {
      const tName = (t.name ?? "").trim();
      const tPref = (t.prefecture ?? "").trim();
      const teamKey = `${tPref}\t${tName}`;
      if (keysWithPrefecture.has(teamKey)) return true;
      if (namesOnly.has(tName)) return true;
      return false;
    });
  }, [myTeamMembers, teamsData]);

  /** ログインユーザーが所属するチームID一覧。プライベート練習の閲覧可否は team_id で判定する */
  const myTeamIdsSet = useMemo(() => {
    const ids = new Set(
      myTeamMembers
        .map((m) => m.team_id)
        .filter((id): id is string => id != null && id.trim() !== "")
    );
    return ids;
  }, [myTeamMembers]);

  /** 都道府県+チーム名（プライベート練習の閲覧可否のフォールバック。team_id がない練習用） */
  const myTeamPrefectureNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const m of myTeamMembers) {
      const name = (m.display_name ?? m.custom_team_name ?? "").trim();
      const pref = (m.display_prefecture ?? "").trim();
      if (name && pref && pref !== "—") set.add(`${pref}\t${name}`);
    }
    return set;
  }, [myTeamMembers]);

  /** 指定した練習がプライベートかつ、現在のユーザーがそのチームに所属していない場合は false。都道府県+名前で区別する */
  const isUserInPracticeTeam = useCallback(
    (practice: PracticeWithMeta) => {
      if (!practice.is_private) return true;
      if (practice.practiceTeamId && myTeamIdsSet.has(practice.practiceTeamId)) return true;
      const pref = (practice.practicePrefecture ?? "").trim();
      const name = (practice.teamName ?? "").trim();
      if (pref && name && myTeamPrefectureNameSet.has(`${pref}\t${name}`)) return true;
      return false;
    },
    [myTeamIdsSet, myTeamPrefectureNameSet]
  );

  /** 居住地の練習会セクション用：所属チームを除いたチーム一覧（所属チームは上のブロックで表示するためここでは表示しない） */
  const teamsInProfilePrefectureExcludingAffiliated = useMemo(() => {
    const myIds = new Set(myTeamsInData.map((m) => m.id));
    return teamsInProfilePrefecture.filter((t) => !myIds.has(t.id));
  }, [teamsInProfilePrefecture, myTeamsInData]);

  /** 居住地のチームを市ごとにグループ化（所属チーム除く） */
  const teamsByProfilePrefectureCityExcludingAffiliated = useMemo(() => {
    const map: Record<string, Team[]> = {};
    for (const team of teamsInProfilePrefectureExcludingAffiliated) {
      const city = team.city || "（未設定）";
      if (!map[city]) map[city] = [];
      map[city].push(team);
    }
    return map;
  }, [teamsInProfilePrefectureExcludingAffiliated]);

  /** 所属チームをデフォルトでチェック済みにする（初回のみ） */
  useEffect(() => {
    if (myTeamsInData.length === 0 || affiliatedDefaultAppliedRef.current) return;
    affiliatedDefaultAppliedRef.current = true;
    setSubscribedTeamIds((prev) => {
      const toAdd = myTeamsInData.map((t) => t.id);
      const next = new Set([...prev, ...toAdd]);
      return next.size === prev.length && toAdd.every((id) => prev.includes(id)) ? prev : Array.from(next);
    });
  }, [myTeamsInData]);

  /** 選択した都道府県のチームを市ごとにグループ化（京都市、長岡京市、宇治市 など） */
  const teamsByCity = useMemo(() => {
    const map: Record<string, Team[]> = {};
    for (const team of teamsInSelectedPrefecture) {
      const city = team.city;
      if (!map[city]) map[city] = [];
      map[city].push(team);
    }
    return map;
  }, [teamsInSelectedPrefecture]);

  const toggleTeam = useCallback((teamId: string) => {
    setSubscribedTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]
    );
  }, []);

  // チェックを入れたチームの練習だけをフラットに（practiceKey, teamId, teamName 付き）
  const subscribedPractices = useMemo((): PracticeWithMeta[] => {
    return teamsData.flatMap((team) =>
      subscribedTeamIds.includes(team.id)
        ? team.practices.map((p) => ({
            ...p,
            practiceKey: practiceKey(team.id, p.id),
            teamId: team.id,
            teamName: team.name,
          }))
        : []
    );
  }, [subscribedTeamIds, teamsData]);

  /** チェックしたチームの練習 + URL共有リンクの練習の signups を取得 */
  useEffect(() => {
    const ids = new Set(subscribedPractices.map((p) => p.id));
    if (sharedPracticeFromUrl) ids.add(sharedPracticeFromUrl.id);
    const practiceIds = Array.from(ids);
    if (practiceIds.length === 0) {
      setSignupsByPracticeId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: signupsData, error: signupsError } = await supabase
        .from("signups")
        .select("*")
        .in("practice_id", practiceIds);
      if (signupsError || cancelled) return;
      const signups = (signupsData as SignupRow[]) ?? [];
      const byPractice: Record<string, SignupRow[]> = {};
      for (const s of signups) {
        if (!byPractice[s.practice_id]) byPractice[s.practice_id] = [];
        byPractice[s.practice_id].push(s);
      }
      if (!cancelled) setSignupsByPracticeId(byPractice);
    })();
    return () => {
      cancelled = true;
    };
  }, [subscribedPractices, sharedPracticeFromUrl]);

  /** 参加者表示名を user_profiles で補完（参加予定メンバーの「Y2 W2」→ 表示名に） */
  useEffect(() => {
    const userIds = new Set<string>();
    for (const signups of Object.values(signupsByPracticeId)) {
      for (const s of signups) userIds.add(s.user_id);
    }
    if (userIds.size === 0) {
      setDisplayNameByUserId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", [...userIds]);
      if (cancelled) return;
      const map: Record<string, string | null> = {};
      for (const row of (data as { user_id: string; display_name: string | null }[]) ?? []) {
        map[row.user_id] = row.display_name?.trim() ?? null;
      }
      setDisplayNameByUserId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [signupsByPracticeId]);

  /** 参加予定メンバーの所属チームを取得（チーム／ゲストの表示用） */
  useEffect(() => {
    const userIds = new Set<string>();
    for (const signups of Object.values(signupsByPracticeId)) {
      for (const s of signups) userIds.add(s.user_id);
    }
    if (userIds.size === 0) {
      setParticipantTeamMemberships({});
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await getTeamMembershipsByUserIds(Array.from(userIds));
      if (cancelled) return;
      if (res.success) setParticipantTeamMemberships(res.data);
      else setParticipantTeamMemberships({});
    })();
    return () => {
      cancelled = true;
    };
  }, [signupsByPracticeId]);

  /** 参加・キャンセル後にその練習の signups と practice_comments を再取得（表示名は user_profiles で補完） */
  const refetchPracticeSignupsAndComments = useCallback(async (practiceId: string) => {
    const [signupsRes, commentsRes] = await Promise.all([
      supabase.from("signups").select("*").eq("practice_id", practiceId),
      supabase.from("practice_comments").select("*").eq("practice_id", practiceId).order("created_at", { ascending: true }),
    ]);
    const signups = (signupsRes.data as SignupRow[]) ?? [];
    const commentsRaw = (commentsRes.data as PracticeCommentRow[]) ?? [];
    const withNames = await enrichCommentsWithDisplayNames(commentsRaw);
    const withLikes = await enrichCommentsWithLikes(withNames, userId ?? null);
    setSignupsByPracticeId((prev) => ({ ...prev, [practiceId]: signups }));
    setPracticeCommentsByPracticeId((prev) => ({ ...prev, [practiceId]: withLikes }));
  }, [userId]);

  /** 一言コメント付きで参加する（Server Action → DB 反映 → refetch）。コメントは任意。 */
  const confirmParticipateWithComment = useCallback(
    async (practiceId: string, comment: string) => {
      setParticipationActionError(null);
      setParticipationSubmitting(true);
      try {
        const result = await toggleParticipation(practiceId, "join", (comment ?? "").trim());
        if (!result.success) {
          setParticipationActionError(result.error ?? "参加に失敗しました");
          return;
        }
        await refetchPracticeSignupsAndComments(practiceId);
        setParticipateTargetPracticeKey(null);
        setParticipateComment("");
      } catch (e) {
        setParticipationActionError(e instanceof Error ? e.message : "参加の処理中にエラーが発生しました");
      } finally {
        setParticipationSubmitting(false);
      }
    },
    [refetchPracticeSignupsAndComments]
  );

  const closePracticeModal = useCallback(() => {
    setSelectedPracticeKey(null);
    setSharedPracticeFromUrl(null);
  }, []);

  /** 参加をキャンセルする（Server Action → DB 反映 → refetch） */
  const confirmCancelParticipation = useCallback(
    async (practiceId: string, _key: string, cancelCommentText: string) => {
      setParticipationActionError(null);
      setParticipationSubmitting(true);
      try {
        const result = await toggleParticipation(practiceId, "cancel", cancelCommentText.trim());
        if (!result.success) {
          setParticipationActionError(result.error ?? "キャンセルに失敗しました");
          return;
        }
        await refetchPracticeSignupsAndComments(practiceId);
        setCancelTargetPracticeKey(null);
        setCancelComment("");
        closePracticeModal();
      } catch (e) {
        setParticipationActionError(e instanceof Error ? e.message : "キャンセル処理中にエラーが発生しました");
      } finally {
        setParticipationSubmitting(false);
      }
    },
    [refetchPracticeSignupsAndComments, closePracticeModal]
  );

  const practicesByDateKey = useMemo(() => {
    const map: Record<string, PracticeWithMeta[]> = {};
    for (const p of subscribedPractices) {
      const key = toDateKey(new Date(p.date));
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return map;
  }, [subscribedPractices]);

  // チームID → 表示用色クラス（選択チームの並び順で割り当て）
  const getTeamColorClasses = useCallback((teamId: string) => {
    const idx = subscribedTeamIds.indexOf(teamId);
    if (idx < 0) return DEFAULT_TEAM_CLASSES;
    return TEAM_COLOR_CLASSES[idx % TEAM_COLOR_CLASSES.length] ?? DEFAULT_TEAM_CLASSES;
  }, [subscribedTeamIds]);

  const practicesInWeek = useMemo(
    () => getPracticesInWeek(calendarWeekStart, subscribedPractices),
    [calendarWeekStart, subscribedPractices]
  );

  /** 直近の練習会に表示する「次の1件」。プライベート練習は同じチームのメンバーのみ表示（他は直近の練習会には出さない） */
  const nextPractice = useMemo(() => {
    const visible = subscribedPractices.filter((p) => isUserInPracticeTeam(p));
    const sorted = [...visible].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const now = new Date();
    const future = sorted.filter((p) => new Date(p.date) >= now);
    return future[0] ?? null;
  }, [subscribedPractices, isUserInPracticeTeam]);

  /** 練習の参加者リスト（表示名は user_profiles を優先、なければ signups.display_name） */
  const getParticipantsForPractice = useCallback(
    (practiceId: string): { id: string; name: string }[] => {
      return (signupsByPracticeId[practiceId] ?? []).map((s) => ({
        id: s.user_id,
        name: displayNameByUserId[s.user_id] ?? s.display_name?.trim() ?? "名前未設定",
      }));
    },
    [signupsByPracticeId, displayNameByUserId]
  );

  const isParticipating = useCallback(
    (key: string) => {
      const p = subscribedPractices.find((x) => x.practiceKey === key);
      if (!p || !userId) return false;
      return (signupsByPracticeId[p.id] ?? []).some((s) => s.user_id === userId);
    },
    [subscribedPractices, signupsByPracticeId, userId]
  );

  /** 参加する押下時: 未ログインならログイン誘導ポップアップ、プロフィール未登録ならポップアップ、登録済みなら参加モーダルを開く */
  const handleJoinClick = useCallback(
    async (practiceKey: string) => {
      if (!userId) {
        setLoginRequiredPopupOpen(true);
        return;
      }
      setParticipationActionError(null);
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .eq("user_id", userId)
        .maybeSingle();
      const displayName = (data as { display_name: string | null } | null)?.display_name?.trim();
      if (!displayName) {
        setProfileRequiredPopupOpen(true);
        return;
      }
      setParticipateTargetPracticeKey(practiceKey);
      setParticipateComment("");
    },
    [userId]
  );

  const selectedPractice = useMemo(
    () =>
      selectedPracticeKey
        ? (sharedPracticeFromUrl?.practiceKey === selectedPracticeKey
            ? sharedPracticeFromUrl
            : subscribedPractices.find((p) => p.practiceKey === selectedPracticeKey) ?? null)
        : null,
    [selectedPracticeKey, sharedPracticeFromUrl, subscribedPractices]
  );

  useEffect(() => {
    setPracticeModalCommentOpen(false);
  }, [selectedPracticeKey]);

  /** 練習詳細または「次の練習」表示時に practice_comments を取得 */
  const practiceIdsToLoadComments = useMemo(() => {
    const ids = new Set<string>();
    if (selectedPractice) ids.add(selectedPractice.id);
    if (nextPractice) ids.add(nextPractice.id);
    return Array.from(ids);
  }, [selectedPractice?.id, nextPractice?.id]);

  useEffect(() => {
    if (practiceIdsToLoadComments.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const pid of practiceIdsToLoadComments) {
        if (cancelled) return;
        const { data, error } = await supabase
          .from("practice_comments")
          .select("*")
          .eq("practice_id", pid)
          .order("created_at", { ascending: true });
        if (cancelled || error) continue;
        const commentsRaw = (data as PracticeCommentRow[]) ?? [];
        const withNames = await enrichCommentsWithDisplayNames(commentsRaw);
        if (cancelled) return;
        const withLikes = await enrichCommentsWithLikes(withNames, userId ?? null);
        if (cancelled) return;
        setPracticeCommentsByPracticeId((prev) => ({ ...prev, [pid]: withLikes }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceIdsToLoadComments.join(","), userId]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white shadow-sm">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 md:max-w-5xl md:mx-auto">
          <Link href="/" className="flex flex-col items-start gap-0.5 shrink-0">
            <span className="flex items-center gap-1.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              <span className="text-2xl sm:text-3xl" aria-hidden>🏓</span>
              <span className="text-emerald-600">PingPong</span> Hub
            </span>
            <span className="text-xs font-normal text-slate-500 sm:text-sm">
              卓球の「練習」を、もっと自由に、もっとスマートに
            </span>
          </Link>

          {/* PC: ナビリンク群を表示 */}
          <div className="hidden min-w-0 flex-shrink-0 flex-wrap items-center justify-end gap-2 md:flex">
            <button
              type="button"
              onClick={() => setAboutPopupOpen(true)}
              className="inline-flex items-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              PingPong Hubとは？
            </button>
            <SignedOut>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-3 py-2 text-sm font-medium text-emerald-600 transition hover:bg-emerald-50"
                >
                  <LogIn size={16} />
                  ログイン
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
                >
                  新規登録
                </button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <Link
                href="/my-practices"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Calendar size={16} className="shrink-0" />
                自分の練習予定
              </Link>
              {isOrganizer && (
                <Link
                  href="/organizer"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  <Plus size={16} className="shrink-0" />
                  <span>主催者ページ</span>
                </Link>
              )}
              <Link
                href="/account"
                className="inline-flex items-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                プロフィール
              </Link>
              <div className="shrink-0">
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: {
                      avatarBox: "h-9 w-9 rounded-lg border border-slate-200",
                    },
                  }}
                />
              </div>
            </SignedIn>
          </div>

          {/* スマホ: ハンバーガーボタン */}
          <div className="flex shrink-0 md:hidden">
            <button
              type="button"
              onClick={() => setNavDrawerOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              aria-label="メニューを開く"
            >
              <Menu size={24} />
            </button>
          </div>
        </div>
      </header>

      {/* スマホ用ナビドロワー */}
      {navDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/50 md:hidden"
            onClick={() => setNavDrawerOpen(false)}
            aria-hidden
          />
          <div
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xs flex-col gap-4 bg-white p-4 shadow-xl md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="font-semibold text-slate-900">メニュー</span>
              <button
                type="button"
                onClick={() => setNavDrawerOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="メニューを閉じる"
              >
                <X size={20} />
              </button>
            </div>
            <nav className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setNavDrawerOpen(false);
                  setAboutPopupOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                PingPong Hubとは？
              </button>
              <SignedOut>
                <SignInButton mode="modal">
                  <button
                    type="button"
                    onClick={() => setNavDrawerOpen(false)}
                    className="flex w-full items-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-3 text-sm font-medium text-emerald-600 transition hover:bg-emerald-50"
                  >
                    <LogIn size={20} className="shrink-0" />
                    ログイン
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button
                    type="button"
                    onClick={() => setNavDrawerOpen(false)}
                    className="flex w-full items-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                  >
                    新規登録
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <Link
                  href="/my-practices"
                  onClick={() => setNavDrawerOpen(false)}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <Calendar size={20} className="shrink-0" />
                  自分の練習予定
                </Link>
                {isOrganizer && (
                  <Link
                    href="/organizer"
                    onClick={() => setNavDrawerOpen(false)}
                    className="flex items-center gap-2 rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <Plus size={20} className="shrink-0" />
                    主催者ページ
                  </Link>
                )}
                <Link
                  href="/account"
                  onClick={() => setNavDrawerOpen(false)}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  プロフィール
                </Link>
                <div className="mt-2 border-t border-slate-200 pt-3">
                  <p className="mb-2 text-xs font-medium text-slate-500">アカウント</p>
                  <UserButton
                    afterSignOutUrl="/"
                    appearance={{
                      elements: {
                        avatarBox: "h-9 w-9 rounded-lg border border-slate-200",
                      },
                    }}
                  />
                </div>
              </SignedIn>
            </nav>
          </div>
        </>
      )}

      <main className="w-full px-4 pb-16 pt-6 md:max-w-5xl md:mx-auto">
        {userId && !isOrganizer && (
          <p className="mb-4 text-sm text-slate-600">
            練習日程を追加したい場合はプロフィールから主催者登録してください。
          </p>
        )}

        {/* PingPong Hubとは？ポップアップ */}
        {aboutPopupOpen && (
          <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md"
            onClick={() => setAboutPopupOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-popup-title"
          >
            <div
              className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-2xl backdrop-blur-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="about-popup-title" className="mb-6 text-center text-lg font-bold text-emerald-600 sm:text-xl">
                卓球を、もっと自由に。
              </h2>
              <div className="space-y-6">
                <div>
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">
                    練習会主催者のメリット
                  </h3>
                  <ul className="space-y-3 text-sm text-slate-600">
                    <li>
                      <span className="font-bold text-emerald-700">出欠管理をゼロに:</span>{" "}
                      練習日を登録するだけで、参加状況がリアルタイムで自動集約されます。個別の連絡は不要です。
                    </li>
                    <li>
                      <span className="font-bold text-emerald-700">「いつものメンツ」を打破:</span>{" "}
                      外部募集をワンタップで開放。新しいプレイスタイルの選手を招き、練習の質を向上させます。
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">
                    プレイヤーのメリット
                  </h3>
                  <ul className="space-y-3 text-sm text-slate-600">
                    <li>
                      <span className="font-bold text-emerald-700">迷わず、即合流:</span>{" "}
                      近隣の練習場やチームを地図・リストから即座に発見。飛び込み参加のハードルを最小化します。
                    </li>
                    <li>
                      <span className="font-bold text-emerald-700">スケジュールを1画面に:</span>{" "}
                      自分の予定、所属チームの予定、近所の募集情報をカレンダーで一元管理。ダブルブッキングを防ぎます。
                    </li>
                  </ul>
                </div>
              </div>
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setAboutPopupOpen(false)}
                  className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 md:py-2.5"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* スマホのみ: 自分の練習予定・主催者ページを「あなたの居住地の練習会」の上に表示（主催者は並べて配置） */}
        {userId && (
          <div className="mb-4 flex flex-wrap gap-2 md:hidden">
            <Link
              href="/my-practices"
              className="inline-flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Calendar size={18} className="shrink-0" />
              自分の練習予定
            </Link>
            {isOrganizer && (
              <Link
                href="/organizer"
                className="inline-flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
              >
                <Plus size={18} className="shrink-0" />
                主催者ページ
              </Link>
            )}
          </div>
        )}

        {/* 自分が所属しているチーム（teamsData に紐づいているもの）のチェック欄。デフォルトでチェック済み。 */}
        {myTeamsInData.length > 0 && (
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
              あなたの所属チーム
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              所属チームの練習をカレンダーに表示するにはチェックを入れてください。初期状態ではすべてオンです。
            </p>
            <ul className="space-y-0.5">
              {myTeamsInData.map((team) => {
                const recentCount = team.practices.filter((p) => isWithinLastMonth(p.date)).length;
                return (
                  <li key={team.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-3 transition hover:bg-slate-50 md:py-2">
                      <input
                        type="checkbox"
                        checked={subscribedTeamIds.includes(team.id)}
                        onChange={() => toggleTeam(team.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm font-medium text-slate-800">{team.name}</span>
                      <span className="text-xs text-slate-500">（直近1か月の練習{recentCount}件）</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* プロフィール居住地の都道府県で開催される練習会（ログイン＆居住地設定時のみ表示） */}
        {profilePrefecture && (
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
              あなたの居住地の練習会（所属チーム除く）
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              {profilePrefecture}で練習を募集しているチームです。チェックを入れると下のカレンダーに表示されます。
            </p>
            {teamsInProfilePrefectureExcludingAffiliated.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                {teamsInProfilePrefecture.length === 0
                  ? `${profilePrefecture}のチームはまだ登録されていません`
                  : "所属チーム以外のチームはありません"}
              </p>
            ) : (
              <div className="space-y-4">
                {Object.entries(teamsByProfilePrefectureCityExcludingAffiliated)
                  .sort(([a], [b]) => a.localeCompare(b, "ja"))
                  .map(([city, teams]) => (
                    <div key={city}>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {city}
                      </h3>
                      <ul className="space-y-0.5">
                        {teams.map((team) => {
                          const recentCount = team.practices.filter((p) => isWithinLastMonth(p.date)).length;
                          return (
                            <li key={team.id}>
                              <label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-3 transition hover:bg-slate-50 md:py-2">
                                <input
                                  type="checkbox"
                                  checked={subscribedTeamIds.includes(team.id)}
                                  onChange={() => toggleTeam(team.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="text-sm font-medium text-slate-800">{team.name}</span>
                                <span className="text-xs text-slate-500">（直近1か月の練習{recentCount}件）</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}

        {/* 都道府県検索 → その県の練習（チーム）一覧でチェック */}
        <section className="relative mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            都道府県で練習を探す
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            都道府県を入力すると予測変換が出ます。選択すると、その県で練習を募集しているチーム一覧からチェックできます。
          </p>
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={prefectureInput}
              onChange={(e) => {
                setPrefectureInput(e.target.value);
                setPrefectureDropdownOpen(true);
                if (!e.target.value.trim()) setSelectedPrefecture(null);
              }}
              onFocus={() => setPrefectureDropdownOpen(true)}
              onBlur={() => {
                setTimeout(() => setPrefectureDropdownOpen(false), 150);
              }}
              placeholder="例: 京都府、東京都"
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-3 pl-9 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 md:py-2.5 md:text-sm"
              aria-autocomplete="list"
              aria-expanded={prefectureDropdownOpen && prefectureSuggestions.length > 0}
              aria-controls="prefecture-suggestions"
              id="prefecture-search"
            />
            {prefectureDropdownOpen && prefectureSuggestions.length > 0 && (
              <ul
                id="prefecture-suggestions"
                role="listbox"
                className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              >
                {prefectureSuggestions.slice(0, 10).map((pref) => (
                  <li key={pref} role="option">
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setPrefectureInput(pref);
                        setSelectedPrefecture(pref);
                        setPrefectureDropdownOpen(false);
                      }}
                      className="w-full px-4 py-3 text-left text-base text-slate-700 hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none md:py-2.5 md:text-sm"
                    >
                      {pref}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 選択した都道府県のチーム一覧（市で区別して表示） */}
          {selectedPrefecture && (
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                {selectedPrefecture}で練習を募集しているチーム
              </h3>
              {teamsInSelectedPrefecture.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">
                  この都道府県のチームはまだ登録されていません
                </p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(teamsByCity)
                    .sort(([a], [b]) => a.localeCompare(b, "ja"))
                    .map(([city, teams]) => (
                      <div key={city}>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {city}
                        </h4>
                        <ul className="space-y-0.5">
                          {teams.map((team) => {
                            const recentCount = team.practices.filter((p) => isWithinLastMonth(p.date)).length;
                            return (
                              <li key={team.id}>
                                <label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-3 transition hover:bg-white md:py-2">
                                  <input
                                    type="checkbox"
                                    checked={subscribedTeamIds.includes(team.id)}
                                    onChange={() => toggleTeam(team.id)}
                                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                  />
                                  <span className="text-sm font-medium text-slate-800">{team.name}</span>
                                  <span className="text-xs text-slate-500">（直近1か月の練習{recentCount}件）</span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* 登録中のチーム（参考表示） */}
          {subscribedTeamIds.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">登録中:</span>
              {subscribedTeamIds.map((id) => {
                const team = teamsData.find((t) => t.id === id);
                return team ? (
                  <span
                    key={id}
                    className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
                  >
                    {team.name}
                  </span>
                ) : null;
              })}
            </div>
          )}
        </section>

        {/* ビュー切り替え: 直近の練習会 / 月 / 週 */}
        <div className="mb-6 flex flex-col rounded-lg border border-slate-200 bg-white p-1 shadow-sm md:flex-row">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-3 text-sm font-medium transition md:gap-2 md:py-2.5 ${
              viewMode === "list"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <List size={18} />
            <span>直近の練習会</span>
          </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("month");
                setCalendarMonth(new Date());
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-3 text-sm font-medium transition md:gap-2 md:py-2.5 ${
                viewMode === "month"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
              weekStart.setHours(0, 0, 0, 0);
              setCalendarWeekStart(weekStart);
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-3 text-sm font-medium transition md:gap-2 md:py-2.5 ${
              viewMode === "week"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <CalendarDays size={18} />
            <span>練習会日程（週）</span>
          </button>
        </div>

        {/* リストビュー: 直近の練習会カード */}
        {viewMode === "list" && (
          <>
            {subscribedTeamIds.length === 0 ? (
              <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
                都道府県を検索してチームにチェックを入れると、そのチームの練習がここに表示されます。
              </section>
            ) : nextPractice ? (
              <>
                <section className="mb-8">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    直近の練習会
                  </h2>
                  <div
                    className={`relative overflow-hidden rounded-lg border bg-white shadow-sm ${
                      isParticipating(nextPractice.practiceKey)
                        ? "border-t-4 border-t-emerald-500 border-slate-200"
                        : !isParticipating(nextPractice.practiceKey) && isPracticeFull(nextPractice, false, (signupsByPracticeId[nextPractice.id] ?? []).length)
                          ? "border-t-4 border-t-amber-500 border-slate-200"
                          : "border-t-4 border-t-slate-300 border-slate-200"
                    }`}
                  >
                    {userId && isParticipating(nextPractice.practiceKey) && (
                      <div className="absolute right-3 top-3 flex flex-col items-center gap-0.5" aria-hidden>
                        <CheckCircle size={24} className="shrink-0 text-red-500" />
                        <span className="text-[10px] text-slate-500">参加連絡済み</span>
                      </div>
                    )}
                    <div className="p-5 sm:p-6">
                      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
                        {nextPractice.is_private && (
                          <span title="チームメンバー限定" className="shrink-0" aria-label="チームメンバー限定">
                            <Lock size={12} />
                          </span>
                        )}
                        {nextPractice.teamName}
                      </div>
                      <div className={`mb-4 flex items-center gap-2 text-base font-semibold text-slate-700 md:text-lg ${isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : ""}`}>
                        <Calendar size={22} className={isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-400"} />
                        {formatPracticeDate(nextPractice.date, nextPractice.endDate)}
                      </div>
                      <div className="mb-5 flex items-center gap-2 text-slate-600">
                        <MapPin size={18} className={`shrink-0 ${isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-400"}`} />
                        <span>{nextPractice.location}</span>
                      </div>
                      {nextPractice.fee && (
                        <div className="mb-3 flex items-center gap-2 text-sm text-slate-600">
                          <span className="font-medium text-slate-500">参加費：</span>
                          <span className={`shrink-0 font-semibold ${isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-400"}`}>￥</span>
                          <span>{nextPractice.fee}</span>
                        </div>
                      )}
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Users size={18} className={`shrink-0 ${isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-400"}`} />
                        <span className="text-slate-700">
                          <span className="font-semibold">
                            {formatParticipantLimit(
                              (signupsByPracticeId[nextPractice.id] ?? []).length,
                              nextPractice.maxParticipants,
                              false
                            )}
                          </span>
                          <span className="text-slate-500"> 参加予定（上限{nextPractice.maxParticipants}名）</span>
                        </span>
                        {!isParticipating(nextPractice.practiceKey) && isPracticeFull(nextPractice, false, (signupsByPracticeId[nextPractice.id] ?? []).length) && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">定員</span>
                        )}
                      </div>
                      <p className="mb-5 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                        <span className="font-medium text-slate-500">練習内容：</span>
                        {nextPractice.content}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={!isParticipating(nextPractice.practiceKey) && isPracticeFull(nextPractice, false, (signupsByPracticeId[nextPractice.id] ?? []).length)}
                          onClick={() => {
                            if (isParticipating(nextPractice.practiceKey)) {
                              setParticipationActionError(null);
                              setCancelTargetPracticeKey(nextPractice.practiceKey);
                              setCancelComment("");
                            } else {
                              handleJoinClick(nextPractice.practiceKey);
                            }
                          }}
                          className={`flex min-w-[8rem] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg py-3.5 font-semibold text-white transition ${
                            !isParticipating(nextPractice.practiceKey) && isPracticeFull(nextPractice, false, (signupsByPracticeId[nextPractice.id] ?? []).length)
                              ? "cursor-not-allowed bg-slate-300"
                              : isParticipating(nextPractice.practiceKey)
                                ? "bg-red-500 hover:bg-red-600 hover:opacity-95 active:opacity-90"
                                : "bg-emerald-600 hover:bg-emerald-700 hover:opacity-95 active:opacity-90"
                          }`}
                        >
                          {isParticipating(nextPractice.practiceKey) ? (
                            <>
                              <LogOut size={18} />
                              キャンセルする
                            </>
                          ) : isPracticeFull(nextPractice, false, (signupsByPracticeId[nextPractice.id] ?? []).length) ? (
                            "定員に達しています"
                          ) : (
                            <>
                              <LogIn size={18} />
                              参加する
                            </>
                          )}
                        </button>
                        {userId && (
                          <button
                            type="button"
                            onClick={async () => {
                              const { data } = await supabase
                                .from("user_profiles")
                                .select("user_id, display_name")
                                .eq("user_id", userId)
                                .maybeSingle();
                              const displayName = (data as { display_name: string | null } | null)?.display_name?.trim();
                              if (!displayName) {
                                setProfileRequiredPopupOpen(true);
                                return;
                              }
                              setCommentPopupPracticeKey(nextPractice.practiceKey);
                              setCommentPopupText("");
                            }}
                            className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-2 border-emerald-500 bg-white px-4 py-3 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 transition"
                          >
                            <MessageCircle size={18} />
                            コメントする
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSharePopupPracticeKey(nextPractice.practiceKey)}
                          className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                        >
                          <Share2 size={18} />
                          共有する
                        </button>
                      </div>
                    </div>
                  </div>
                  {userId && (
                  <>
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-slate-700">参加予定メンバー</h3>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        const organizerUserId = fetchedPractices.find((r) => r.id === nextPractice.id)?.user_id;
                        const participants = getParticipantsForPractice(nextPractice.id);
                        if (participants.length === 0) return <p className="text-sm text-slate-500">まだ参加者はいません</p>;
                        return participants.map((p) => {
                          const isOrganizer = p.id === organizerUserId;
                          const membership = participantTeamMemberships[p.id];
                          const practiceTeamId = nextPractice.practiceTeamId ?? null;
                          const practicePref = (nextPractice.practicePrefecture ?? "").trim();
                          const practiceName = (nextPractice.teamName ?? "").trim();
                          const isTeam =
                            membership &&
                            (membership.teamIds.includes(nextPractice.teamId) ||
                              (practiceTeamId && membership.teamIds.includes(practiceTeamId)) ||
                              (practicePref && practiceName && membership.teamPrefectureNameKeys?.includes(`${practicePref}\t${practiceName}`)) ||
                              (!practicePref && membership.teamNames.some((n) => (n ?? "").trim() === practiceName)));
                          return p.id === userId ? (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setProfileModalUserId(p.id)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-xs shadow-sm border border-slate-100 hover:bg-slate-50 transition cursor-pointer"
                              title={isOrganizer ? "自分（主催者）" : "自分"}
                            >
                              <span className="flex flex-1 items-center gap-1.5 min-w-0">
                                {!isOrganizer && (isTeam ? (
                                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">チーム</span>
                                ) : (
                                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">ゲスト</span>
                                ))}
                                {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                              </span>
                              <span className="text-slate-700 font-medium max-w-[4.5rem] truncate shrink-0">自分</span>
                            </button>
                          ) : (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setProfileModalUserId(p.id)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-xs shadow-sm border border-slate-100 hover:bg-slate-50 transition text-left"
                              title={p.name}
                            >
                              <span className="flex flex-1 items-center gap-1.5 min-w-0">
                                {!isOrganizer && (isTeam ? (
                                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">チーム</span>
                                ) : (
                                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">ゲスト</span>
                                ))}
                                {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                              </span>
                              <span className="text-slate-700 max-w-[4.5rem] truncate shrink-0">{p.name}</span>
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                  {(optimisticComments[nextPractice.id]?.length ?? 0) > 0 && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">コメント履歴</h3>
                      <div className="space-y-2 text-sm">
                        {(() => {
                          const organizerUserId = fetchedPractices.find((r) => r.id === nextPractice.id)?.user_id;
                          const practiceTeamId = nextPractice.practiceTeamId ?? null;
                          const practicePref = (nextPractice.practicePrefecture ?? "").trim();
                          const practiceName = (nextPractice.teamName ?? "").trim();
                          return optimisticComments[nextPractice.id].map((entry) => {
                            const isOrganizer = entry.user_id === organizerUserId;
                            const isSelf = entry.user_id === userId;
                            const membership = participantTeamMemberships[entry.user_id];
                            const isTeam =
                              membership &&
                              (membership.teamIds.includes(nextPractice.teamId) ||
                                (practiceTeamId && membership.teamIds.includes(practiceTeamId)) ||
                                (practicePref && practiceName && membership.teamPrefectureNameKeys?.includes(`${practicePref}\t${practiceName}`)) ||
                                (!practicePref && membership.teamNames.some((n) => (n ?? "").trim() === practiceName)));
                            const bubble = (
                              <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 max-w-[85%] ${
                                isSelf ? "bg-emerald-50 border border-emerald-100" : "bg-white border border-slate-200"
                              }`}>
                                <span className="text-xs text-slate-400 shrink-0">{formatParticipatedAt(entry.created_at)}</span>
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
                                <button
                                  type="button"
                                  onClick={() => setProfileModalUserId(entry.user_id)}
                                  className="shrink-0 text-left text-slate-600 underline decoration-slate-400 underline-offset-2 hover:text-slate-900 hover:decoration-slate-600"
                                >
                                  {entry.display_name ?? entry.user_name ?? "名前未設定"}
                                </button>
                                {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                                {!isOrganizer && (isTeam ? (
                                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">チーム</span>
                                ) : (
                                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">ゲスト</span>
                                ))}
                                <span className="text-slate-700 min-w-0">{entry.comment || "—"}</span>
                                <span className="ml-auto shrink-0">
                                  <CommentLikeButton
                                    commentId={entry.id}
                                    practiceId={nextPractice.id}
                                    liked={entry.is_liked_by_me}
                                    count={entry.likes_count}
                                    likedByDisplayNames={entry.liked_by_display_names}
                                    userId={userId ?? null}
                                    onOptimisticUpdate={setOptimisticComments}
                                    onSuccess={refetchPracticeSignupsAndComments}
                                  />
                                </span>
                              </div>
                            );
                            return (
                              <div key={entry.id} className={isSelf ? "flex justify-end" : "flex justify-start"}>
                                {bubble}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </section>
              </>
            ) : (
              <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
                チェックしたチームの今後の練習はありません
              </section>
            )}

          </>
        )}

        {/* 練習詳細モーダル（リスト・月・週のどこからでも開く） */}
        {selectedPractice && (
          <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={closePracticeModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-modal-title"
          >
            <div
              className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {!userId ? (
                <>
                  <div className="shrink-0 flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <h3 id="practice-modal-title" className="text-lg font-semibold text-slate-900">
                      練習の詳細
                    </h3>
                    <button
                      type="button"
                      onClick={closePracticeModal}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                      aria-label="閉じる"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600" aria-hidden>
                      <LogIn size={24} />
                    </span>
                    <p className="text-sm font-medium text-slate-800">
                      練習の詳細を見るにはログインが必要です。
                    </p>
                    <div className="flex w-full flex-col gap-2">
                      <SignInButton mode="modal">
                        <button
                          type="button"
                          className="w-full rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
                        >
                          ログインする
                        </button>
                      </SignInButton>
                      <button
                        type="button"
                        onClick={closePracticeModal}
                        className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                </>
              ) : selectedPractice.is_private && !isUserInPracticeTeam(selectedPractice) ? (
                <>
                  <div className="shrink-0 flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <h3 id="practice-modal-title" className="text-lg font-semibold text-slate-900">
                      練習の詳細
                    </h3>
                    <button
                      type="button"
                      onClick={closePracticeModal}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                      aria-label="閉じる"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600" aria-hidden>
                      <Lock size={24} />
                    </span>
                    <p className="text-sm font-medium text-slate-800">
                      この練習はプライベートのため、同じチームのメンバーのみ閲覧できます。
                    </p>
                    <button
                      type="button"
                      onClick={closePracticeModal}
                      className="rounded-lg bg-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-300"
                    >
                      閉じる
                    </button>
                  </div>
                </>
              ) : (
                <>
              {userId && isParticipating(selectedPractice.practiceKey) && (
                <div className="absolute right-12 top-4 z-10 flex flex-col items-center gap-0.5" aria-hidden>
                  <CheckCircle size={22} className="shrink-0 text-red-500" />
                  <span className="text-[10px] text-slate-500">参加連絡済み</span>
                </div>
              )}
              <div className="shrink-0 p-6 pb-2">
                <div className="flex items-center justify-between">
                  <h3 id="practice-modal-title" className="text-lg font-semibold text-slate-900 md:text-xl">
                    練習の詳細
                  </h3>
                  <button
                    type="button"
                    onClick={closePracticeModal}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                    aria-label="閉じる"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
              <p className="mb-1 flex items-center gap-1.5 text-sm text-slate-500">
                {selectedPractice.is_private && (
                  <span title="チームメンバー限定" className="shrink-0 text-slate-500" aria-label="チームメンバー限定">
                    <Lock size={14} />
                  </span>
                )}
                {selectedPractice.teamName}
              </p>
              <p className="mb-4 flex items-center gap-2 text-slate-900">
                <Calendar size={18} className="text-emerald-600" />
                {formatPracticeDate(selectedPractice.date, selectedPractice.endDate)}
              </p>
              <p className="mb-4 flex items-center gap-2 text-slate-600">
                <MapPin size={18} className="text-emerald-600" />
                {selectedPractice.location}
              </p>
              <p className="mb-4 flex items-center gap-2 text-sm text-slate-600">
                <span className="font-medium text-slate-500">参加費：</span>
                <span className="text-emerald-600 font-semibold">￥</span>
                {selectedPractice.fee ?? "—"}
              </p>
              <p className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                <Users size={18} className="text-emerald-600" />
                {formatParticipantLimit(
                  (signupsByPracticeId[selectedPractice.id] ?? []).length,
                  selectedPractice.maxParticipants,
                  false
                )}
                参加予定（上限{selectedPractice.maxParticipants}名）
              </p>
              <div className="mb-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">参加予定メンバー（クリックでプロフィール）</h4>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const organizerUserId = fetchedPractices.find((r) => r.id === selectedPractice.id)?.user_id;
                    const participants = getParticipantsForPractice(selectedPractice.id);
                    if (participants.length === 0) return <p className="text-sm text-slate-500">まだ参加者はいません</p>;
                    return participants.map((p) => {
                      const isOrganizer = p.id === organizerUserId;
                      const membership = participantTeamMemberships[p.id];
                      const practiceTeamId = selectedPractice.practiceTeamId ?? null;
                      const practicePref = (selectedPractice.practicePrefecture ?? "").trim();
                      const practiceName = (selectedPractice.teamName ?? "").trim();
                      const isTeam =
                        membership &&
                        (membership.teamIds.includes(selectedPractice.teamId) ||
                          (practiceTeamId && membership.teamIds.includes(practiceTeamId)) ||
                          (practicePref && practiceName && membership.teamPrefectureNameKeys?.includes(`${practicePref}\t${practiceName}`)) ||
                          (!practicePref && membership.teamNames.some((n) => (n ?? "").trim() === practiceName)));
                      return p.id === userId ? (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProfileModalUserId(p.id)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-xs border border-slate-200 hover:bg-slate-100 transition"
                          title={isOrganizer ? "自分（主催者）" : "自分"}
                        >
                          <span className="flex flex-1 items-center gap-1.5 min-w-0">
                            {!isOrganizer && (isTeam ? (
                              <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">チーム</span>
                            ) : (
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">ゲスト</span>
                            ))}
                            {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                          </span>
                          <span className="text-slate-700 font-medium max-w-[4.5rem] truncate shrink-0">自分</span>
                        </button>
                      ) : (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProfileModalUserId(p.id)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-xs border border-slate-200 hover:bg-slate-100 transition text-left"
                          title={p.name}
                        >
                          <span className="flex flex-1 items-center gap-1.5 min-w-0">
                            {!isOrganizer && (isTeam ? (
                              <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">チーム</span>
                            ) : (
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">ゲスト</span>
                            ))}
                            {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                          </span>
                          <span className="text-slate-700 max-w-[4.5rem] truncate shrink-0">{p.name}</span>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
              {(optimisticComments[selectedPractice.id]?.length ?? 0) > 0 ? (
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
                        {(() => {
                          const organizerUserId = fetchedPractices.find((r) => r.id === selectedPractice.id)?.user_id;
                          const practiceTeamId = selectedPractice.practiceTeamId ?? null;
                          const practicePref = (selectedPractice.practicePrefecture ?? "").trim();
                          const practiceName = (selectedPractice.teamName ?? "").trim();
                          return optimisticComments[selectedPractice.id].map((entry) => {
                            const isOrganizer = entry.user_id === organizerUserId;
                            const isSelf = entry.user_id === userId;
                            const membership = participantTeamMemberships[entry.user_id];
                            const isTeam =
                              membership &&
                              (membership.teamIds.includes(selectedPractice.teamId) ||
                                (practiceTeamId && membership.teamIds.includes(practiceTeamId)) ||
                                (practicePref && practiceName && membership.teamPrefectureNameKeys?.includes(`${practicePref}\t${practiceName}`)) ||
                                (!practicePref && membership.teamNames.some((n) => (n ?? "").trim() === practiceName)));
                            const bubble = (
                              <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 max-w-[85%] ${
                                isSelf ? "bg-emerald-50 border border-emerald-100" : "bg-white border border-slate-200"
                              }`}>
                                <span className="text-xs text-slate-400 shrink-0">{formatParticipatedAt(entry.created_at)}</span>
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
                                <button
                                  type="button"
                                  onClick={() => setProfileModalUserId(entry.user_id)}
                                  className="shrink-0 text-left text-slate-600 underline decoration-slate-400 underline-offset-2 hover:text-slate-900 hover:decoration-slate-600"
                                >
                                  {entry.display_name ?? entry.user_name ?? "名前未設定"}
                                </button>
                                {isOrganizer && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">主催者</span>}
                                {!isOrganizer && (isTeam ? (
                                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">チーム</span>
                                ) : (
                                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">ゲスト</span>
                                ))}
                                <span className="text-slate-700 min-w-0">{entry.comment || "—"}</span>
                                <span className="ml-auto shrink-0">
                                  <CommentLikeButton
                                    commentId={entry.id}
                                    practiceId={selectedPractice.id}
                                    liked={entry.is_liked_by_me}
                                    count={entry.likes_count}
                                    likedByDisplayNames={entry.liked_by_display_names}
                                    userId={userId ?? null}
                                    onOptimisticUpdate={setOptimisticComments}
                                    onSuccess={refetchPracticeSignupsAndComments}
                                  />
                                </span>
                              </div>
                            );
                            return (
                              <div key={entry.id} className={isSelf ? "flex justify-end" : "flex justify-start"}>
                                {bubble}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPracticeModalCommentOpen(true)}
                      className="text-left text-sm font-medium text-slate-600 hover:text-slate-800"
                    >
                      コメントを開く（{optimisticComments[selectedPractice.id].length}件）
                    </button>
                  )}
                </div>
              ) : null}
              {participationActionError && (
                <p className="mb-4 text-sm text-red-600" role="alert">{participationActionError}</p>
              )}
              <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium text-slate-500">練習内容：</span>
                {selectedPractice.content}
              </p>
              {selectedPractice.level && (
                <p className="mb-4 text-sm text-slate-600">
                  <span className="font-medium text-slate-500">練習者のレベル：</span>
                  {selectedPractice.level}
                </p>
              )}
              {selectedPractice.requirements && (
                <p className="mb-5 rounded-md bg-amber-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-500">求める条件：</span>
                  {selectedPractice.requirements}
                </p>
              )}
              {!selectedPractice.level && !selectedPractice.requirements && <div className="mb-5" />}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!isParticipating(selectedPractice.practiceKey) && isPracticeFull(selectedPractice, false, (signupsByPracticeId[selectedPractice.id] ?? []).length)}
                  onClick={() => {
                    if (isParticipating(selectedPractice.practiceKey)) {
                      setParticipationActionError(null);
                      setCancelTargetPracticeKey(selectedPractice.practiceKey);
                      setCancelComment("");
                    } else {
                      handleJoinClick(selectedPractice.practiceKey);
                    }
                  }}
                  className={`flex min-w-[8rem] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg py-3.5 font-semibold text-white transition ${
                    !isParticipating(selectedPractice.practiceKey) && isPracticeFull(selectedPractice, false, (signupsByPracticeId[selectedPractice.id] ?? []).length)
                      ? "cursor-not-allowed bg-slate-300"
                      : isParticipating(selectedPractice.practiceKey)
                        ? "bg-red-500 hover:bg-red-600"
                        : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {isParticipating(selectedPractice.practiceKey) ? (
                    <>
                      <LogOut size={18} />
                      参加をキャンセルする
                    </>
                  ) : isPracticeFull(selectedPractice, false, (signupsByPracticeId[selectedPractice.id] ?? []).length) ? (
                    "定員に達しています"
                  ) : (
                    <>
                      <LogIn size={18} />
                      参加する
                    </>
                  )}
                </button>
                {userId && (
                  <button
                    type="button"
                    onClick={async () => {
                      const { data } = await supabase
                        .from("user_profiles")
                        .select("user_id, display_name")
                        .eq("user_id", userId)
                        .maybeSingle();
                      const displayName = (data as { display_name: string | null } | null)?.display_name?.trim();
                      if (!displayName) {
                        setProfileRequiredPopupOpen(true);
                        return;
                      }
                      setCommentPopupPracticeKey(selectedPractice.practiceKey);
                      setCommentPopupText("");
                    }}
                    className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-2 border-emerald-500 bg-white px-4 py-3 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 transition"
                  >
                    <MessageCircle size={18} />
                    コメントする
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSharePopupPracticeKey(selectedPractice.practiceKey)}
                  className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  <Share2 size={18} />
                  共有する
                </button>
              </div>
              </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 共有ポップアップ */}
        {sharePopupPracticeKey && (() => {
          const target =
            sharedPracticeFromUrl?.practiceKey === sharePopupPracticeKey
              ? sharedPracticeFromUrl
              : subscribedPractices.find((p) => p.practiceKey === sharePopupPracticeKey);
          if (!target) return null;
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const shareText = buildShareText(target, origin);
          return (
            <div
              className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
              onClick={() => {
                setSharePopupPracticeKey(null);
                setShareCopySuccess(false);
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="share-popup-title"
            >
              <div
                className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="share-popup-title" className="mb-2 text-lg font-semibold text-slate-900">
                  練習会を共有
                </h3>
                <p className="mb-3 text-sm text-slate-600">
                  以下のテキストをコピーしてLINEやメールで送信できます。
                </p>
                <pre className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-left text-xs text-slate-800 whitespace-pre-wrap break-words sm:max-h-48">
                  {shareText}
                </pre>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const lineText = buildShareTextForLine(target, origin);
                      window.open(`https://line.me/R/msg/text/?${encodeURIComponent(lineText)}`, "_blank");
                      setSharePopupPracticeKey(null);
                      setShareCopySuccess(false);
                    }}
                    className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border-2 border-[#06C755] bg-[#06C755] px-4 py-3 text-sm font-medium text-white hover:bg-[#05b84c] sm:flex-1"
                  >
                    LINEで共有
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareText);
                        setShareCopySuccess(true);
                        setTimeout(() => setShareCopySuccess(false), 1500);
                      } catch {
                        const ta = document.createElement("textarea");
                        ta.value = shareText;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        document.body.removeChild(ta);
                        setShareCopySuccess(true);
                        setTimeout(() => setShareCopySuccess(false), 1500);
                      }
                    }}
                    className={`w-full rounded-lg px-4 py-3 text-sm font-medium sm:flex-1 ${
                      shareCopySuccess
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                    }`}
                  >
                    {shareCopySuccess ? "コピーしました" : "コピーする"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSharePopupPracticeKey(null);
                      setShareCopySuccess(false);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* コメントするポップアップ */}
        {commentPopupPracticeKey && (() => {
          const target = subscribedPractices.find((p) => p.practiceKey === commentPopupPracticeKey);
          return (
            <div
              className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
              onClick={() => {
                setCommentPopupPracticeKey(null);
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
                {target && (
                  <p className="mb-4 text-sm text-slate-600">
                    {target.teamName} · {formatPracticeDate(target.date, target.endDate)}
                  </p>
                )}
                <label htmlFor="comment-popup-text" className="mb-1 block text-sm font-medium text-slate-700">
                  質問や連絡事項 <span className="text-slate-400">（任意）</span>
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
                      setCommentPopupPracticeKey(null);
                      setCommentPopupText("");
                      setFreeCommentError(null);
                    }}
                    className="flex-1 rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 md:py-2.5"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    disabled={freeCommentSubmitting}
                    onClick={async () => {
                      if (!target || freeCommentSubmitting) return;
                      setFreeCommentError(null);
                      setFreeCommentSubmitting(true);
                      try {
                        const result = await postComment(target.id, commentPopupText.trim());
                        if (result.success) {
                          setCommentPopupPracticeKey(null);
                          setCommentPopupText("");
                          setFreeCommentError(null);
                          await refetchPracticeSignupsAndComments(target.id);
                        } else {
                          setFreeCommentError(result.error ?? "送信に失敗しました");
                        }
                      } finally {
                        setFreeCommentSubmitting(false);
                      }
                    }}
                    className="flex-1 rounded-lg bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none md:py-2.5"
                  >
                    {freeCommentSubmitting ? "送信中…" : "送信"}
                  </button>
                </div>
                {freeCommentError && (
                  <p className="mt-3 text-sm text-red-600" role="alert">{freeCommentError}</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* 参加するモーダル（一言コメント任意） */}
        {participateTargetPracticeKey && (() => {
          const target = subscribedPractices.find((p) => p.practiceKey === participateTargetPracticeKey);
          return (
            <div
              className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
              onClick={() => {
                setParticipateTargetPracticeKey(null);
                setParticipateComment("");
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="participate-modal-title"
            >
              <div
                className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="participate-modal-title" className="mb-2 text-lg font-semibold text-slate-900">
                  参加する
                </h3>
                {target && (
                  <p className="mb-4 text-sm text-slate-600">
                    {target.teamName} · {formatPracticeDate(target.date, target.endDate)}
                  </p>
                )}
                <label htmlFor="participate-comment" className="mb-1 block text-sm font-medium text-slate-700">
                  一言コメント <span className="text-slate-400">（任意）</span>
                </label>
                <textarea
                  id="participate-comment"
                  rows={3}
                  value={participateComment}
                  onChange={(e) => setParticipateComment(e.target.value)}
                  placeholder="例: 初参加です。よろしくお願いします"
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
                      setParticipateTargetPracticeKey(null);
                      setParticipateComment("");
                    }}
                    className="flex-1 rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:py-2.5"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    disabled={participationSubmitting}
                    onClick={async () => {
                      const target = subscribedPractices.find((p) => p.practiceKey === participateTargetPracticeKey);
                      if (target) {
                        await confirmParticipateWithComment(target.id, participateComment);
                      }
                    }}
                    className="flex-1 rounded-lg bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none md:py-2.5"
                  >
                    {participationSubmitting ? "送信中…" : "参加する"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 参加をキャンセルするモーダル */}
        {cancelTargetPracticeKey && (() => {
          const target = subscribedPractices.find((p) => p.practiceKey === cancelTargetPracticeKey);
          return (
            <div
              className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
              onClick={() => {
                setCancelTargetPracticeKey(null);
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
                {target && (
                  <p className="mb-4 text-sm text-slate-600">
                    {target.teamName} · {formatPracticeDate(target.date, target.endDate)}
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
                      setCancelTargetPracticeKey(null);
                      setCancelComment("");
                    }}
                    className="flex-1 rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:py-2.5"
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    disabled={!cancelComment.trim() || participationSubmitting}
                    onClick={async () => {
                      const target = subscribedPractices.find((p) => p.practiceKey === cancelTargetPracticeKey);
                      if (target && cancelComment.trim()) {
                        await confirmCancelParticipation(target.id, cancelTargetPracticeKey, cancelComment);
                      }
                    }}
                    className="flex-1 rounded-lg bg-red-500 py-3 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 disabled:pointer-events-none md:py-2.5"
                  >
                    {participationSubmitting ? "送信中…" : "参加をキャンセルする"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 未ログイン時ポップアップ（参加する押下時）→ ログイン画面へ誘導 */}
        {loginRequiredPopupOpen && (
          <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md"
            onClick={() => setLoginRequiredPopupOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-required-title"
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-2xl backdrop-blur-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="login-required-title" className="mb-3 text-center text-lg font-semibold text-slate-800">
                ログインが必要です
              </h3>
              <p className="mb-5 text-center text-sm text-slate-600">
                練習に参加するには、ログインが必要です。
              </p>
              <div className="flex flex-col gap-2">
                <SignInButton mode="modal">
                  <button
                    type="button"
                    onClick={() => setLoginRequiredPopupOpen(false)}
                    className="w-full rounded-xl bg-emerald-600 py-3 text-center text-sm font-medium text-white hover:bg-emerald-700"
                  >
                    ログインする
                  </button>
                </SignInButton>
                <button
                  type="button"
                  onClick={() => setLoginRequiredPopupOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 md:py-2.5"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* プロフィール未登録時ポップアップ（参加する押下時） */}
        {profileRequiredPopupOpen && (
          <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md"
            onClick={() => setProfileRequiredPopupOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-required-title"
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-2xl backdrop-blur-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="profile-required-title" className="mb-3 text-center text-lg font-semibold text-slate-800">
                プロフィールを登録してください
              </h3>
              <p className="mb-5 text-center text-sm text-slate-600">
                練習に参加するには、プロフィールの登録が必要です。
              </p>
              <div className="flex flex-col gap-2">
                <Link
                  href="/account"
                  onClick={() => setProfileRequiredPopupOpen(false)}
                  className="rounded-xl bg-emerald-600 py-3 text-center text-sm font-medium text-white hover:bg-emerald-700"
                >
                  プロフィールを登録する
                </Link>
                <button
                  type="button"
                  onClick={() => setProfileRequiredPopupOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 md:py-2.5"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 参加メンバーのプロフィールモーダル（ボワっと表示） */}
        {(profileModalUserId || profileModalData) && (
          <div
            className={`fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm transition-opacity duration-300 ${
              profileModalReady ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => {
              setProfileModalUserId(null);
              setProfileModalData(null);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
          >
            <div
              className={`max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl transition duration-300 ${
                profileModalReady ? "opacity-100 scale-100" : "opacity-0 scale-95"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 id="profile-modal-title" className="text-lg font-semibold text-slate-900">
                  プロフィール
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setProfileModalUserId(null);
                    setProfileModalData(null);
                  }}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  aria-label="閉じる"
                >
                  <X size={20} />
                </button>
              </div>
              {profileModalData ? (
                <div className="space-y-3 text-sm">
                  {profileModalData.display_name && (
                    <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                      <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">表示名</span>
                      <span className="text-slate-900">{profileModalData.display_name}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                    <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">練習会主催者</span>
                    <span className="text-slate-900">{profileModalData.is_organizer ? "はい" : "いいえ"}</span>
                  </div>
                  {profileModalData.is_organizer &&
                    [profileModalData.org_name_1, profileModalData.org_name_2, profileModalData.org_name_3].some((v) => (v ?? "").trim() !== "") && (
                      <>
                        {profileModalData.org_name_1?.trim() && (
                          <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                            <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">主催チーム①</span>
                            <span className="text-slate-900">{profileModalData.org_name_1}</span>
                          </div>
                        )}
                        {profileModalData.org_name_2?.trim() && (
                          <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                            <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">主催チーム②</span>
                            <span className="text-slate-900">{profileModalData.org_name_2}</span>
                          </div>
                        )}
                        {profileModalData.org_name_3?.trim() && (
                          <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                            <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">主催チーム③</span>
                            <span className="text-slate-900">{profileModalData.org_name_3}</span>
                          </div>
                        )}
                      </>
                    )}
                  {profileModalData.prefecture && (
                    <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                      <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">居住地（都道府県）</span>
                      <span className="text-slate-900">{profileModalData.prefecture}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                    <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">所属チーム</span>
                    <span className="text-slate-900">
                      {profileModalTeamNames.length === 0 ? "未登録" : profileModalTeamNames.join("、")}
                    </span>
                  </div>
                  {[
                    { key: "career" as const, label: "卓球歴" },
                    { key: "play_style" as const, label: "戦型" },
                    { key: "dominant_hand" as const, label: "利き腕" },
                    { key: "achievements" as const, label: "主な戦績" },
                    { key: "racket" as const, label: "ラケット" },
                    { key: "forehand_rubber" as const, label: "フォアラバー" },
                    { key: "backhand_rubber" as const, label: "バックラバー（裏面）" },
                  ].map(({ key, label }) => {
                    const value = profileModalData[key];
                    if (value == null || value === "") return null;
                    return (
                      <div key={key} className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                        <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">{label}</span>
                        <span className={key === "achievements" ? "whitespace-pre-line text-slate-900" : "text-slate-900"}>{value}</span>
                      </div>
                    );
                  })}
                </div>
              ) : profileModalLoaded ? (
                <p className="py-6 text-center text-slate-500">プロフィールが登録されていません</p>
              ) : (
                <p className="py-6 text-center text-slate-500">読み込み中…</p>
              )}
            </div>
          </div>
        )}

        {/* 月カレンダービュー */}
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
                  const practices = practicesByDateKey[key] ?? [];
                  const isToday =
                    toDateKey(new Date()) === key;
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
                            const fullAndNotJoined = !isParticipating(p.practiceKey) && isPracticeFull(p, false, p.participants.length);
                            return (
                            <button
                              key={p.practiceKey}
                              type="button"
                              onClick={() => setSelectedPracticeKey(p.practiceKey)}
                              className={`rounded px-1 text-[10px] font-medium sm:text-xs ${getTeamColorClasses(p.teamId)} ${
                                isParticipating(p.practiceKey) ? "ring-2 ring-red-500" : fullAndNotJoined ? "ring-2 ring-amber-500 opacity-90" : ""
                              }`}
                              title={`${p.teamName} ${formatTimeRange(p.date, p.endDate)} ${p.location}${fullAndNotJoined ? "（定員）" : ""}`}
                            >
                              <span className="flex items-center gap-0.5 truncate">
                                {p.is_private && (
                                  <span title="チームメンバー限定" className="shrink-0 text-slate-500" aria-label="チームメンバー限定">
                                    <Lock size={10} />
                                  </span>
                                )}
                                <span className="truncate">{p.teamName}</span>
                              </span>
                              <span className="block truncate">{formatTimeRange(p.date, p.endDate)}</span>
                              <span className="block truncate">{p.location.split(" ")[0]}{fullAndNotJoined ? " 満" : ""}</span>
                            </button>
                          );})}
                          {practices.length > 2 && (
                            <span className="text-[10px] text-slate-500">+{practices.length - 2}</span>
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

        {/* 週カレンダービュー（30分区切りバーティカル・Outlook風） */}
        {viewMode === "week" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const d = new Date(calendarWeekStart);
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() - 7);
                  setCalendarWeekStart(d);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                aria-label="前週"
              >
                <ChevronLeft size={20} />
              </button>
              <h2 className="text-center text-base font-semibold text-slate-900 md:text-lg">
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
                  d.setHours(0, 0, 0, 0);
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
              className="max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm"
            >
              <div
                className="grid min-w-[600px]"
                style={{
                  gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))",
                  gridTemplateRows: `40px repeat(${(WEEK_VIEW.endHour - WEEK_VIEW.startHour) * (60 / WEEK_VIEW.slotMinutes)}, ${WEEK_VIEW.slotHeightPx}px)`,
                }}
              >
                {/* ヘッダー: 時間列（縦・横スクロール時も固定） */}
                <div className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 py-2 pr-1 text-right text-xs font-semibold text-slate-500">
                  時間
                </div>
                {/* ヘッダー: 曜日・日付（縦スクロール時も固定） */}
                {getWeekDates(calendarWeekStart).map((day, i) => {
                  const isToday = toDateKey(new Date()) === toDateKey(day);
                  const dow = (day.getDay() + 6) % 7;
                  const isSat = dow === 5;
                  const isSun = dow === 6;
                  return (
                    <div
                      key={i}
                      ref={isToday ? weekTodayColumnRef : undefined}
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

                {/* 時間軸ラベル（6:00〜22:00、30分区切り） */}
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

                {/* 曜日列のスロット（罫線用・背景） */}
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
                      const isToday = toDateKey(new Date()) === toDateKey(day);
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

                {/* 練習ブロック（灰色＝興味あり／色付き＝参加予定・クリックで詳細） */}
                {practicesInWeek.map((p) => {
                  const fullAndNotJoined = !isParticipating(p.practiceKey) && isPracticeFull(p, false, p.participants.length);
                  return (
                  <button
                    key={p.practiceKey}
                    type="button"
                    onClick={() => setSelectedPracticeKey(p.practiceKey)}
                    className={`mx-0.5 overflow-hidden rounded-md border py-1 px-1.5 text-left text-xs transition hover:opacity-90 ${getTeamColorClasses(p.teamId)} ${
                      isParticipating(p.practiceKey) ? "ring-2 ring-red-500" : fullAndNotJoined ? "ring-2 ring-amber-500" : ""
                    }`}
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
                    <p className="flex items-center gap-1 truncate font-medium text-slate-700" title={p.teamName}>
                      {p.is_private && (
                        <span title="チームメンバー限定" className="shrink-0 text-slate-500" aria-label="チームメンバー限定">
                          <Lock size={14} />
                        </span>
                      )}
                      <span className="truncate">{p.teamName}</span>
                      {fullAndNotJoined && <span className="ml-1 shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800">定員</span>}
                    </p>
                    <p className="truncate" title={p.location}>
                      {p.location}
                    </p>
                    <p className="text-slate-500">
                      {formatParticipantLimit(p.participants.length, p.maxParticipants, isParticipating(p.practiceKey))}
                    </p>
                    <p className="truncate text-[10px] text-slate-500" title={p.content}>
                      {p.content}
                    </p>
                  </button>
                );})}
              </div>
        </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <HomeContent />
    </Suspense>
  );
}
