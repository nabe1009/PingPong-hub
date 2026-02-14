"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import type { PrefectureCityRow, PracticeRow, UserProfileRow, SignupRow, PracticeCommentRow } from "@/lib/supabase/client";
import { toggleParticipation } from "@/app/actions/toggle-participation";
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
  List,
  MapPin,
  Users,
  ChevronRight,
  ChevronLeft,
  LogIn,
  LogOut,
  X,
  Search,
  Plus,
} from "lucide-react";

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

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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

/** 定員に達しているか */
function isPracticeFull(p: Practice, includeSelf?: boolean, currentCount?: number): boolean {
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
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startTs = weekStart.getTime();
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

export default function Home() {
  const [subscribedTeamIds, setSubscribedTeamIds] = useState<string[]>([]);
  /** 参加するモーダルで対象の練習（null のときモーダル非表示） */
  const [participateTargetPracticeKey, setParticipateTargetPracticeKey] = useState<string | null>(null);
  const [participateComment, setParticipateComment] = useState("");
  /** キャンセルするモーダルで対象の練習（null のときモーダル非表示） */
  const [cancelTargetPracticeKey, setCancelTargetPracticeKey] = useState<string | null>(null);
  const [cancelComment, setCancelComment] = useState("");
  const [selectedPracticeKey, setSelectedPracticeKey] = useState<string | null>(null);
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
  const [profileModalLoaded, setProfileModalLoaded] = useState(false);
  /** 練習ID → 参加者（signups） */
  const [signupsByPracticeId, setSignupsByPracticeId] = useState<Record<string, SignupRow[]>>({});
  /** 参加者表示名（user_id → display_name） */
  const [profileByUserId, setProfileByUserId] = useState<Record<string, string>>({});
  /** 練習ID → 参加・キャンセル履歴（practice_comments） */
  const [practiceCommentsByPracticeId, setPracticeCommentsByPracticeId] = useState<Record<string, PracticeCommentRow[]>>({});
  const [participationActionError, setParticipationActionError] = useState<string | null>(null);
  const [participationSubmitting, setParticipationSubmitting] = useState(false);


  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const weekCalendarScrollRef = useRef<HTMLDivElement>(null);
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  });

  // 週ビューを開いたとき・週を切り替えたときに9時が上に見えるよう初期スクロール（6:00→9:00 = 6スロット分）
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

  /** 練習追加モーダル用：Supabase prefectures_cities の都道府県・市一覧 */
  const [prefectureCityRows, setPrefectureCityRows] = useState<PrefectureCityRow[]>([]);

  /** 練習追加モーダル用：user_profiles の主催者チーム一覧（is_organizer かつ org_name_1/2/3 のいずれかあり） */
  const [organizerTeams, setOrganizerTeams] = useState<{ user_id: string; org_name_1: string | null; org_name_2: string | null; org_name_3: string | null; prefecture: string | null }[]>([]);

  /** ログインユーザーのプロフィール居住地（user_profiles.prefecture） */
  const [profilePrefecture, setProfilePrefecture] = useState<string | null>(null);

  /** Supabase practices テーブルから取得した練習一覧（保存後に再取得してカレンダーを更新） */
  const [fetchedPractices, setFetchedPractices] = useState<PracticeRow[]>([]);

  useEffect(() => {
    async function fetchOrganizerTeams() {
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id, org_name_1, org_name_2, org_name_3, prefecture")
        .eq("is_organizer", true)
        .limit(5000);
      const rows = (data as { user_id: string; org_name_1: string | null; org_name_2: string | null; org_name_3: string | null; prefecture: string | null }[]) ?? [];
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

  /** practices テーブルから練習一覧を取得（追加保存後に呼んで一覧を更新） */
  const fetchPractices = useCallback(async () => {
    const { data, error } = await supabase.from("practices").select("*").order("event_date", { ascending: true });
    if (error) {
      console.error("practices fetch error:", error);
      return;
    }
    setFetchedPractices((data as PracticeRow[]) ?? []);
  }, []);

  useEffect(() => {
    fetchPractices();
  }, [fetchPractices]);

  /** 参加メンバーをクリックしたとき: プロフィールモーダル用に user_profiles を取得 */
  useEffect(() => {
    if (!profileModalUserId) {
      setProfileModalData(null);
      setProfileModalLoaded(false);
      return;
    }
    setProfileModalLoaded(false);
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", profileModalUserId)
        .maybeSingle();
      if (!cancelled) {
        setProfileModalData((data as UserProfileRow) ?? null);
        setProfileModalLoaded(true);
      }
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

  /** 都道府県で練習を探す：予測候補（prefectures_cities テーブル・入力が含まれる候補） */
  const prefectureSuggestions = useMemo(() => {
    const q = prefectureInput.trim();
    if (q.length < 1) return [];
    const prefectures = [...new Set(prefectureCityRows.map((r) => r.prefecture))].sort((a, b) => a.localeCompare(b, "ja"));
    const matched = prefectures.filter((p) => prefectureMatchesQuery(p, q));
    return matched.sort((a, b) => {
      const qn = normalizeForSearch(q);
      const aStart = normalizeForSearch(a).startsWith(qn) || a.replace(/[都道府県]$/, "").startsWith(qn) ? 0 : 1;
      const bStart = normalizeForSearch(b).startsWith(qn) || b.replace(/[都道府県]$/, "").startsWith(qn) ? 0 : 1;
      return aStart - bStart || a.localeCompare(b, "ja");
    }).slice(0, 15);
  }, [prefectureInput, prefectureCityRows]);

  /** practices テーブルの行を Practice 型に変換（表示用の練習内容はすべてここから） */
  const practicesFromTable = useMemo((): Practice[] => {
    return fetchedPractices.map((row) => {
      const dateStart = row.event_date + "T" + (row.start_time.length === 5 ? row.start_time : row.start_time + ":00").slice(0, 5) + ":00";
      const dateEnd = row.event_date + "T" + (row.end_time.length === 5 ? row.end_time : row.end_time + ":00").slice(0, 5) + ":00";
      return {
        id: row.id,
        date: new Date(dateStart).toISOString(),
        endDate: new Date(dateEnd).toISOString(),
        location: row.location,
        participants: [],
        maxParticipants: row.max_participants,
        content: row.content ?? "",
        level: row.level ?? undefined,
        requirements: row.conditions ?? undefined,
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
      const prefecture = o.prefecture ?? "";
      if ((o.org_name_1 ?? "").trim() !== "")
        byId.set(`${o.user_id}::1`, { id: `${o.user_id}::1`, name: o.org_name_1!.trim(), prefecture, city: "", practices: [] });
      if ((o.org_name_2 ?? "").trim() !== "")
        byId.set(`${o.user_id}::2`, { id: `${o.user_id}::2`, name: o.org_name_2!.trim(), prefecture, city: "", practices: [] });
      if ((o.org_name_3 ?? "").trim() !== "")
        byId.set(`${o.user_id}::3`, { id: `${o.user_id}::3`, name: o.org_name_3!.trim(), prefecture, city: "", practices: [] });
    }
    for (const p of practicesFromTable) {
      const row = fetchedPractices.find((r) => r.id === p.id);
      if (!row) continue;
      const organizer = organizerTeams.find(
        (o) =>
          (o.org_name_1 ?? "").trim() === row.team_name ||
          (o.org_name_2 ?? "").trim() === row.team_name ||
          (o.org_name_3 ?? "").trim() === row.team_name
      );
      if (organizer) {
        const slot =
          (organizer.org_name_1 ?? "").trim() === row.team_name
            ? 1
            : (organizer.org_name_2 ?? "").trim() === row.team_name
              ? 2
              : 3;
        const team = byId.get(`${organizer.user_id}::${slot}`);
        if (team) team.practices.push(p);
      } else {
        const key = "supabase-" + row.team_name;
        let team = byId.get(key);
        if (!team) {
          team = { id: key, name: row.team_name, prefecture: "", city: "", practices: [] };
          byId.set(key, team);
        }
        team.practices.push(p);
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

  /** チェックしたチームの練習の signups を取得し、参加者表示名用に user_profiles を取得 */
  useEffect(() => {
    const practiceIds = subscribedPractices.map((p) => p.id);
    if (practiceIds.length === 0) {
      setSignupsByPracticeId({});
      setProfileByUserId({});
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
      const userIds = new Set<string>();
      for (const s of signups) {
        if (!byPractice[s.practice_id]) byPractice[s.practice_id] = [];
        byPractice[s.practice_id].push(s);
        userIds.add(s.user_id);
      }
      if (!cancelled) setSignupsByPracticeId(byPractice);
      if (userIds.size === 0) {
        if (!cancelled) setProfileByUserId({});
        return;
      }
      const { data: profilesData, error: profilesError } = await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", Array.from(userIds));
      if (profilesError || cancelled) return;
      const profiles = (profilesData as { user_id: string; display_name: string | null }[]) ?? [];
      const nameByUserId: Record<string, string> = {};
      for (const r of profiles) {
        nameByUserId[r.user_id] = r.display_name?.trim() ?? "名前未設定";
      }
      if (!cancelled) setProfileByUserId(nameByUserId);
    })();
    return () => {
      cancelled = true;
    };
  }, [subscribedPractices]);

  /** 参加・キャンセル後にその練習の signups と practice_comments を再取得 */
  const refetchPracticeSignupsAndComments = useCallback(async (practiceId: string) => {
    const [signupsRes, commentsRes] = await Promise.all([
      supabase.from("signups").select("*").eq("practice_id", practiceId),
      supabase.from("practice_comments").select("*").eq("practice_id", practiceId).order("created_at", { ascending: true }),
    ]);
    const signups = (signupsRes.data as SignupRow[]) ?? [];
    const comments = (commentsRes.data as PracticeCommentRow[]) ?? [];
    setSignupsByPracticeId((prev) => ({ ...prev, [practiceId]: signups }));
    setPracticeCommentsByPracticeId((prev) => ({ ...prev, [practiceId]: comments }));
    const userIds = [...new Set(signups.map((s) => s.user_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("user_profiles").select("user_id, display_name").in("user_id", userIds);
      const list = (profiles as { user_id: string; display_name: string | null }[]) ?? [];
      setProfileByUserId((prev) => {
        const next = { ...prev };
        for (const r of list) next[r.user_id] = r.display_name?.trim() ?? "名前未設定";
        return next;
      });
    }
  }, []);

  /** 一言コメント付きで参加する（Server Action → DB 反映 → refetch） */
  const confirmParticipateWithComment = useCallback(
    async (practiceId: string, comment: string) => {
      const trimmed = comment.trim();
      if (!trimmed) return;
      setParticipationActionError(null);
      setParticipationSubmitting(true);
      try {
        const result = await toggleParticipation(practiceId, "join", trimmed);
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
        setSelectedPracticeKey(null);
      } catch (e) {
        setParticipationActionError(e instanceof Error ? e.message : "キャンセル処理中にエラーが発生しました");
      } finally {
        setParticipationSubmitting(false);
      }
    },
    [refetchPracticeSignupsAndComments]
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

  const { nextPractice, upcomingPractices } = useMemo(() => {
    const sorted = [...subscribedPractices].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const now = new Date();
    const future = sorted.filter((p) => new Date(p.date) >= now);
    const next = future[0] ?? null;
    const upcoming = future.slice(1);
    return { nextPractice: next, upcomingPractices: upcoming };
  }, [subscribedPractices]);

  /** 練習の参加者リスト（signups + 表示名） */
  const getParticipantsForPractice = useCallback(
    (practiceId: string): { id: string; name: string }[] => {
      return (signupsByPracticeId[practiceId] ?? []).map((s) => ({
        id: s.user_id,
        name: profileByUserId[s.user_id] ?? "名前未設定",
      }));
    },
    [signupsByPracticeId, profileByUserId]
  );

  const isParticipating = useCallback(
    (key: string) => {
      const p = subscribedPractices.find((x) => x.practiceKey === key);
      if (!p || !userId) return false;
      return (signupsByPracticeId[p.id] ?? []).some((s) => s.user_id === userId);
    },
    [subscribedPractices, signupsByPracticeId, userId]
  );

  const selectedPractice = useMemo(
    () =>
      selectedPracticeKey
        ? subscribedPractices.find((p) => p.practiceKey === selectedPracticeKey) ?? null
        : null,
    [selectedPracticeKey, subscribedPractices]
  );

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
        setPracticeCommentsByPracticeId((prev) => ({ ...prev, [pid]: (data as PracticeCommentRow[]) ?? [] }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceIdsToLoadComments.join(",")]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex flex-col items-start gap-0.5 shrink-0">
            <span className="flex items-center gap-1.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              <span className="text-2xl sm:text-3xl" aria-hidden>🏓</span>
              <span className="text-emerald-600">PingPong</span> Hub
            </span>
            <span className="text-xs font-normal text-slate-500 sm:text-sm">
              卓球の「練習」を、もっと自由に、もっとスマートに
            </span>
          </Link>
          <SignedOut>
            <div className="flex items-center gap-2">
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
            </div>
          </SignedOut>
          <SignedIn>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              {isOrganizer && (
                <Link
                  href="/organizer"
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 shrink-0"
                >
                  <Plus size={16} />
                  主催者専用ページ
                </Link>
              )}
              <Link
                href="/account"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 shrink-0"
              >
                プロフィール
              </Link>
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
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-6">
        {userId && !isOrganizer && (
          <p className="mb-4 text-sm text-slate-600">
            練習日程を追加したい場合はプロフィールから主催者登録してください。
          </p>
        )}
        <p className="mb-6 text-sm text-slate-600">
          このプラットフォームは、主催者の管理負担を減らし、プレイヤーの選択肢を広げます。
        </p>

        <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-6 text-center text-lg font-bold text-emerald-600 sm:text-xl">
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
        </section>

        {/* プロフィール居住地の都道府県で開催される練習会（ログイン＆居住地設定時のみ表示） */}
        {profilePrefecture && (
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
              あなたの居住地の練習会
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              {profilePrefecture}で練習を募集しているチームです。チェックを入れると下のカレンダーに表示されます。
            </p>
            {teamsInProfilePrefecture.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                {profilePrefecture}のチームはまだ登録されていません
              </p>
            ) : (
              <div className="space-y-4">
                {Object.entries(teamsByProfilePrefectureCity)
                  .sort(([a], [b]) => a.localeCompare(b, "ja"))
                  .map(([city, teams]) => (
                    <div key={city}>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {city}
                      </h3>
                      <ul className="space-y-0.5">
                        {teams.map((team) => (
                          <li key={team.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 transition hover:bg-slate-50">
                              <input
                                type="checkbox"
                                checked={subscribedTeamIds.includes(team.id)}
                                onChange={() => toggleTeam(team.id)}
                                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span className="text-sm font-medium text-slate-800">{team.name}</span>
                              <span className="text-xs text-slate-500">（{team.practices.length}件の練習）</span>
                            </label>
                          </li>
                        ))}
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
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
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
                      className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none"
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
                          {teams.map((team) => (
                            <li key={team.id}>
                              <label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 transition hover:bg-white">
                                <input
                                  type="checkbox"
                                  checked={subscribedTeamIds.includes(team.id)}
                                  onChange={() => toggleTeam(team.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="text-sm font-medium text-slate-800">{team.name}</span>
                                <span className="text-xs text-slate-500">（{team.practices.length}件の練習）</span>
                              </label>
                            </li>
                          ))}
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

        {/* ビュー切り替え: リスト / 月 / 週 */}
        <div className="mb-6 flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
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

        {/* リストビュー: 次回の練習カード + 今後の練習 */}
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
                    次回の練習
                  </h2>
                  <div
                    className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
                      isParticipating(nextPractice.practiceKey)
                        ? "border-t-4 border-t-emerald-500 border-slate-200"
                        : "border-t-4 border-t-slate-300 border-slate-200"
                    }`}
                  >
                    <div className="p-5 sm:p-6">
                      <div className="mb-1 text-xs font-medium text-slate-500">
                        {nextPractice.teamName}
                      </div>
                      <div className={`mb-4 flex items-center gap-2 text-lg font-semibold sm:text-xl ${isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-700"}`}>
                        <Calendar size={22} className={isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-400"} />
                        {formatPracticeDate(nextPractice.date, nextPractice.endDate)}
                      </div>
                      <div className="mb-5 flex items-center gap-2 text-slate-600">
                        <MapPin size={18} className={`shrink-0 ${isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-400"}`} />
                        <span>{nextPractice.location}</span>
                      </div>
                      <div className="mb-3 flex items-center gap-2">
                        <Users size={18} className={`shrink-0 ${isParticipating(nextPractice.practiceKey) ? "text-emerald-600" : "text-slate-400"}`} />
                        <span className="text-slate-700">
                          <span className="font-semibold">
                            {formatParticipantLimit(
                              (signupsByPracticeId[nextPractice.id] ?? []).length,
                              nextPractice.maxParticipants,
                              isParticipating(nextPractice.practiceKey)
                            )}
                          </span>
                          <span className="text-slate-500"> 参加予定（上限{nextPractice.maxParticipants}名）</span>
                        </span>
                      </div>
                      <p className="mb-5 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                        <span className="font-medium text-slate-500">練習内容：</span>
                        {nextPractice.content}
                      </p>
                      <button
                        type="button"
                        disabled={!isParticipating(nextPractice.practiceKey) && isPracticeFull(nextPractice, false, (signupsByPracticeId[nextPractice.id] ?? []).length)}
                        onClick={() => {
                          if (isParticipating(nextPractice.practiceKey)) {
                            setParticipationActionError(null);
                            setCancelTargetPracticeKey(nextPractice.practiceKey);
                            setCancelComment("");
                          } else {
                            setParticipationActionError(null);
                            setParticipateTargetPracticeKey(nextPractice.practiceKey);
                            setParticipateComment("");
                          }
                        }}
                        className={`flex w-full items-center justify-center gap-2 rounded-lg py-3.5 font-semibold text-white transition sm:max-w-[200px] ${
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
                    </div>
                  </div>
                  {isParticipating(nextPractice.practiceKey) && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                      <h3 className="mb-3 text-sm font-semibold text-slate-700">参加予定メンバー</h3>
                      <div className="flex flex-col gap-2">
                        {getParticipantsForPractice(nextPractice.id).map((p) =>
                          p.id === userId ? (
                            <Link
                              key={p.id}
                              href="/account"
                              className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm shadow-sm border border-slate-100 hover:bg-slate-50 transition cursor-pointer"
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-medium text-white bg-emerald-600">我</span>
                              <span className="text-slate-700 font-medium">自分</span>
                            </Link>
                          ) : (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setProfileModalUserId(p.id)}
                              className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm shadow-sm border border-slate-100 hover:bg-slate-50 transition text-left"
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-medium text-white bg-slate-500">
                                {p.name.slice(0, 1)}
                              </span>
                              <span className="text-slate-700">{p.name}</span>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                  {(practiceCommentsByPracticeId[nextPractice.id]?.length ?? 0) > 0 && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">参加・キャンセル時のコメント履歴</h3>
                      <div className="space-y-1.5 text-sm">
                        {practiceCommentsByPracticeId[nextPractice.id].map((entry) => (
                          <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <span className="text-xs text-slate-400 shrink-0">{formatParticipatedAt(entry.created_at)}</span>
                            <span className={`font-medium shrink-0 w-14 ${entry.type === "join" ? "text-emerald-600" : "text-red-600"}`}>{entry.type === "join" ? "参加" : "キャンセル"}</span>
                            <span className="text-slate-600 shrink-0">{entry.user_name ?? "名前未設定"}</span>
                            <span className="text-slate-700 min-w-0">{entry.comment || "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
                <section>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    今後の練習
                  </h2>
                  {upcomingPractices.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-slate-500 shadow-sm">
                      この後の予定はありません
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {upcomingPractices.map((p) => (
                        <li key={p.practiceKey}>
                          <button
                            type="button"
                            onClick={() => setSelectedPracticeKey(p.practiceKey)}
                            className={`flex w-full items-center justify-between gap-3 rounded-lg border p-4 text-left transition ${getTeamColorClasses(p.teamId)} ${
                              isParticipating(p.practiceKey) ? "ring-2 ring-red-500" : "shadow-sm"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-slate-900">
                                <span className="font-medium">{formatShortDate(p.date)} {formatTimeRange(p.date, p.endDate)}</span>
                                <span className="text-slate-400">·</span>
                                <span className="truncate text-slate-600">{p.location}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                                <span className="text-xs">{p.teamName}</span>
                                <span>·</span>
                                <Users size={14} className={isParticipating(p.practiceKey) ? "text-emerald-600" : "text-slate-400"} />
                                {formatParticipantLimit(p.participants.length, p.maxParticipants, isParticipating(p.practiceKey))}
                                <span className="text-slate-400">·</span>
                                <span className="truncate text-xs">{p.content}</span>
                              </div>
                            </div>
                            <ChevronRight size={20} className="shrink-0 text-slate-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
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
            onClick={() => setSelectedPracticeKey(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-modal-title"
          >
            <div
              className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 id="practice-modal-title" className="text-lg font-semibold text-slate-900">
                  練習の詳細
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedPracticeKey(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  aria-label="閉じる"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="mb-1 text-sm text-slate-500">{selectedPractice.teamName}</p>
              <p className="mb-4 flex items-center gap-2 text-slate-900">
                <Calendar size={18} className="text-emerald-600" />
                {formatPracticeDate(selectedPractice.date, selectedPractice.endDate)}
              </p>
              <p className="mb-4 flex items-center gap-2 text-slate-600">
                <MapPin size={18} className="text-emerald-600" />
                {selectedPractice.location}
              </p>
              <p className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                <Users size={18} className="text-emerald-600" />
                {formatParticipantLimit(
                  (signupsByPracticeId[selectedPractice.id] ?? []).length,
                  selectedPractice.maxParticipants,
                  isParticipating(selectedPractice.practiceKey)
                )}
                参加予定（上限{selectedPractice.maxParticipants}名）
              </p>
              {isParticipating(selectedPractice.practiceKey) && (
                <div className="mb-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">参加予定メンバー（クリックでプロフィール）</h4>
                  <div className="flex flex-col gap-2">
                    {getParticipantsForPractice(selectedPractice.id).map((p) =>
                      p.id === userId ? (
                        <Link
                          key={p.id}
                          href="/account"
                          className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm border border-slate-200 hover:bg-slate-100 transition"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-medium text-white bg-emerald-600">我</span>
                          <span className="text-slate-700 font-medium">自分</span>
                        </Link>
                      ) : (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProfileModalUserId(p.id);
                            setSelectedPracticeKey(null);
                          }}
                          className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm border border-slate-200 hover:bg-slate-100 transition text-left"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-medium text-white bg-slate-500">
                            {p.name.slice(0, 1)}
                          </span>
                          <span className="text-slate-700">{p.name}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
              {(practiceCommentsByPracticeId[selectedPractice.id]?.length ?? 0) > 0 && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">参加・キャンセル時のコメント履歴</h4>
                  <div className="space-y-1.5 text-sm">
                    {practiceCommentsByPracticeId[selectedPractice.id].map((entry) => (
                      <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="text-xs text-slate-400 shrink-0">{formatParticipatedAt(entry.created_at)}</span>
                        <span className={`font-medium shrink-0 w-14 ${entry.type === "join" ? "text-emerald-600" : "text-red-600"}`}>{entry.type === "join" ? "参加" : "キャンセル"}</span>
                        <span className="text-slate-600 shrink-0">{entry.user_name ?? "名前未設定"}</span>
                        <span className="text-slate-700 min-w-0">{entry.comment || "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
              <button
                type="button"
                disabled={!isParticipating(selectedPractice.practiceKey) && isPracticeFull(selectedPractice, false, (signupsByPracticeId[selectedPractice.id] ?? []).length)}
                onClick={() => {
                  if (isParticipating(selectedPractice.practiceKey)) {
                    setParticipationActionError(null);
                    setCancelTargetPracticeKey(selectedPractice.practiceKey);
                    setCancelComment("");
                  } else {
                    setParticipationActionError(null);
                    setParticipateTargetPracticeKey(selectedPractice.practiceKey);
                    setParticipateComment("");
                  }
                }}
                className={`flex w-full items-center justify-center gap-2 rounded-lg py-3.5 font-semibold text-white transition ${
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
            </div>
          </div>
        )}

        {/* 参加するモーダル（一言コメント必須） */}
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
                  一言コメント <span className="text-red-500">（必須）</span>
                </label>
                <textarea
                  id="participate-comment"
                  required
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
                    className="flex-1 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    disabled={!participateComment.trim() || participationSubmitting}
                    onClick={async () => {
                      const target = subscribedPractices.find((p) => p.practiceKey === participateTargetPracticeKey);
                      if (target && participateComment.trim()) {
                        await confirmParticipateWithComment(target.id, participateComment);
                      }
                    }}
                    className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none"
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
                    className="flex-1 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
                    className="flex-1 rounded-lg bg-red-500 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {participationSubmitting ? "送信中…" : "参加をキャンセルする"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 参加メンバーのプロフィールモーダル */}
        {(profileModalUserId || profileModalData) && (
          <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={() => {
              setProfileModalUserId(null);
              setProfileModalData(null);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
          >
            <div
              className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
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
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                      <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">表示名</span>
                      <span className="text-slate-900">{profileModalData.display_name}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                    <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">練習会主催者</span>
                    <span className="text-slate-900">{profileModalData.is_organizer ? "はい" : "いいえ"}</span>
                  </div>
                  {profileModalData.is_organizer &&
                    [profileModalData.org_name_1, profileModalData.org_name_2, profileModalData.org_name_3].some((v) => (v ?? "").trim() !== "") && (
                      <>
                        {profileModalData.org_name_1?.trim() && (
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                            <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">主催チーム名/卓球場/個人名①</span>
                            <span className="text-slate-900">{profileModalData.org_name_1}</span>
                          </div>
                        )}
                        {profileModalData.org_name_2?.trim() && (
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                            <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">主催チーム名/卓球場/個人名②</span>
                            <span className="text-slate-900">{profileModalData.org_name_2}</span>
                          </div>
                        )}
                        {profileModalData.org_name_3?.trim() && (
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                            <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">主催チーム名/卓球場/個人名③</span>
                            <span className="text-slate-900">{profileModalData.org_name_3}</span>
                          </div>
                        )}
                      </>
                    )}
                  {profileModalData.prefecture && (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                      <span className="min-w-[10rem] shrink-0 font-medium text-slate-500">居住地（都道府県）</span>
                      <span className="text-slate-900">{profileModalData.prefecture}</span>
                    </div>
                  )}
                  {[
                    { key: "affiliation" as const, label: "所属/チーム名" },
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
                      <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
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
                          {practices.slice(0, 2).map((p) => (
                            <button
                              key={p.practiceKey}
                              type="button"
                              onClick={() => setSelectedPracticeKey(p.practiceKey)}
                              className={`rounded px-1 text-[10px] font-medium sm:text-xs ${getTeamColorClasses(p.teamId)} ${
                                isParticipating(p.practiceKey) ? "ring-2 ring-red-500" : ""
                              }`}
                              title={`${p.teamName} ${formatTimeRange(p.date, p.endDate)} ${p.location}`}
                            >
                              <span className="block truncate">{p.teamName}</span>
                              <span className="block truncate">{formatTimeRange(p.date, p.endDate)}</span>
                              <span className="block truncate">{p.location.split(" ")[0]}</span>
                            </button>
                          ))}
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
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                今月の練習予定
              </h3>
              {(() => {
                const year = calendarMonth.getFullYear();
                const month = calendarMonth.getMonth();
                const list = subscribedPractices
                  .filter((p) => {
                    const d = new Date(p.date);
                    return d.getFullYear() === year && d.getMonth() === month;
                  })
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                if (list.length === 0) {
                  return (
                    <p className="text-sm text-slate-500">
                      {subscribedTeamIds.length === 0
                        ? "チームにチェックを入れると表示されます"
                        : "この月の練習はありません"}
                    </p>
                  );
                }
                return (
                  <ul className="space-y-1">
                    {list.map((p) => (
                      <li key={p.practiceKey}>
                        <button
                          type="button"
                          onClick={() => setSelectedPracticeKey(p.practiceKey)}
                          className={`flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm font-medium ${getTeamColorClasses(p.teamId)} ${
                            isParticipating(p.practiceKey) ? "ring-2 ring-red-500" : ""
                          }`}
                        >
                          <span className="flex w-full items-center gap-2">
                            <span className="font-medium">{formatShortDate(p.date)} {formatTimeRange(p.date, p.endDate)}</span>
                            <span className="text-slate-400">·</span>
                            <span className="truncate text-slate-600">{p.teamName}</span>
                            <span className="text-slate-400">·</span>
                            <span className="truncate">{p.location}</span>
                            <span className="ml-auto text-slate-500">
                              {formatParticipantLimit(p.participants.length, p.maxParticipants, isParticipating(p.practiceKey))}
                            </span>
                          </span>
                          <span className="text-xs text-slate-500">{p.content}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
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
                {/* ヘッダー: 時間列（縦スクロール時も固定） */}
                <div className="sticky top-0 z-10 border-b border-r border-slate-200 bg-slate-50 py-2 pr-1 text-right text-xs font-semibold text-slate-500">
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
                        className="border-b border-r border-slate-100 bg-white pr-1 pt-0.5 text-right text-[10px] text-slate-400"
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
                {practicesInWeek.map((p) => (
                  <button
                    key={p.practiceKey}
                    type="button"
                    onClick={() => setSelectedPracticeKey(p.practiceKey)}
                    className={`mx-0.5 overflow-hidden rounded-md border py-1 px-1.5 text-left text-xs transition hover:opacity-90 ${getTeamColorClasses(p.teamId)} ${
                      isParticipating(p.practiceKey) ? "ring-2 ring-red-500" : ""
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
                    <p className="truncate font-medium text-slate-700" title={p.teamName}>
                      {p.teamName}
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
                ))}
              </div>
        </div>
          </section>
        )}
      </main>
    </div>
  );
}
