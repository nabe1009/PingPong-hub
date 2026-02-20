"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { supabase } from "@/lib/supabase/client";
import type { UserProfileRow } from "@/lib/supabase/client";
import type { TeamMemberWithDisplay } from "@/types/database";
import { PREFECTURES_NORTH_TO_SOUTH, sortPrefecturesNorthToSouth } from "@/lib/prefectures";
import { saveUserProfile } from "@/app/actions/save-user-profile";
import {
  getMyTeamMembers,
  searchTeamsByPrefecture,
  addTeamMember,
  deleteTeamMember,
  deleteTeamMembersByDisplayName,
  replaceAffiliatedTeams,
  syncOrganizerTeamsToTeamMembers,
  saveOrganizerTeamsOnly,
  type TeamSearchResult,
} from "@/app/actions/team-members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";

const LABELS: Record<string, string> = {
  affiliation: "所属/チーム名",
  career: "卓球歴",
  play_style: "戦型",
  dominant_hand: "利き腕",
  achievements: "主な戦績",
  racket: "ラケット",
  forehand_rubber: "フォアラバー",
  backhand_rubber: "バックラバー（裏面）",
};

function formatUpdatedAt(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AccountPage() {
  const { user, isLoaded } = useUser();
  const DOMINANT_HAND_OPTIONS = ["右利き", "左利き"] as const;

  const [savedProfile, setSavedProfile] = useState<UserProfileRow | null>(null);
  const [isEditMode, setIsEditMode] = useState(true);
  const [form, setForm] = useState({
    display_name: "",
    affiliation: "",
    prefecture: "",
    career: "",
    play_style: "",
    dominant_hand: "",
    achievements: "",
    is_organizer: false,
    org_name_1: "",
    org_name_2: "",
    org_name_3: "",
    org_prefecture_1: "",
    org_prefecture_2: "",
    org_prefecture_3: "",
    racket: "",
    forehand_rubber: "",
    backhand_rubber: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingOrganizerTeams, setIsSavingOrganizerTeams] = useState(false);
  const [isSavingTeamMembers, setIsSavingTeamMembers] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  /** 保存完了ポップアップ（ボワっと表示） */
  const [saveSuccessVisible, setSaveSuccessVisible] = useState(false);
  const [saveSuccessReady, setSaveSuccessReady] = useState(false);
  /** 居住地選択肢：prefectures_cities の prefecture_name の重複除去・ソート */
  const [prefectureOptions, setPrefectureOptions] = useState<string[]>([]);
  /** 所属チーム（team_members + teams 結合） */
  const [teamMembers, setTeamMembers] = useState<TeamMemberWithDisplay[]>([]);
  const [teamMembersError, setTeamMembersError] = useState<string | null>(null);
  /** 追加フロー: 検索して選択（既存チームのみ） */
  const [addTeamMode, setAddTeamMode] = useState(false);
  const [teamSearchPrefecture, setTeamSearchPrefecture] = useState("");
  const [teamSearchResults, setTeamSearchResults] = useState<TeamSearchResult[]>([]);
  const [teamSearchLoading, setTeamSearchLoading] = useState(false);
  const [selectedTeamIdForAdd, setSelectedTeamIdForAdd] = useState("");
  const [addTeamSubmitting, setAddTeamSubmitting] = useState(false);
  const [addTeamError, setAddTeamError] = useState<string | null>(null);
  /** 検索ボタン押下後か（0件メッセージを検索後にのみ表示するため） */
  const [hasSearchedTeam, setHasSearchedTeam] = useState(false);

  /** 保存完了ポップアップのボワっと表示 */
  useEffect(() => {
    if (saveSuccessVisible) {
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setSaveSuccessReady(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setSaveSuccessReady(false);
  }, [saveSuccessVisible]);

  /** 保存完了ポップアップを2.5秒後に自動で閉じる */
  useEffect(() => {
    if (!saveSuccessVisible) return;
    const t = setTimeout(() => setSaveSuccessVisible(false), 2500);
    return () => clearTimeout(t);
  }, [saveSuccessVisible]);

  useEffect(() => {
    async function fetchPrefectures() {
      const { data } = await supabase
        .from("prefectures_cities")
        .select("prefecture_name")
        .limit(5000);
      const rows = (data as { prefecture_name: string }[]) ?? [];
      const names = sortPrefecturesNorthToSouth([...new Set(rows.map((r) => r.prefecture_name))].filter(Boolean));
      // Supabase が空 or 取得失敗時も選択できるよう、静的リストをフォールバックにする
      setPrefectureOptions(names.length > 0 ? names : [...PREFECTURES_NORTH_TO_SOUTH]);
    }
    fetchPrefectures();
  }, []);

  const fetchProfile = useCallback(async (options?: { keepEditMode?: boolean }) => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("user_profiles")
      .select("display_name, prefecture, career, play_style, dominant_hand, achievements, is_organizer, org_name_1, org_name_2, org_name_3, org_prefecture_1, org_prefecture_2, org_prefecture_3, racket, forehand_rubber, backhand_rubber, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const row = data as UserProfileRow | null;
    if (row) {
      setSavedProfile(row);
      setForm({
        display_name: row.display_name ?? "",
        affiliation: "",
        prefecture: row.prefecture ?? "",
        career: row.career ?? "",
        play_style: row.play_style ?? "",
        dominant_hand: row.dominant_hand ?? "",
        achievements: row.achievements ?? "",
        is_organizer: row.is_organizer ?? false,
        org_name_1: row.org_name_1 ?? "",
        org_name_2: row.org_name_2 ?? "",
        org_name_3: row.org_name_3 ?? "",
        org_prefecture_1: row.org_prefecture_1 ?? "",
        org_prefecture_2: row.org_prefecture_2 ?? "",
        org_prefecture_3: row.org_prefecture_3 ?? "",
        racket: row.racket ?? "",
        forehand_rubber: row.forehand_rubber ?? "",
        backhand_rubber: row.backhand_rubber ?? "",
      });
      if (!options?.keepEditMode) setIsEditMode(false);
    } else {
      setSavedProfile(null);
      const fromClerk = (user.fullName && user.fullName.trim()) || (user.firstName && user.firstName.trim()) || "";
      setForm((f) => ({ ...f, display_name: fromClerk }));
      setIsEditMode(true);
    }
  }, [user?.id, user?.fullName, user?.firstName]);

  const fetchTeamMembers = useCallback(async () => {
    if (!user?.id) return;
    setTeamMembersError(null);
    const res = await getMyTeamMembers();
    if (res.success) setTeamMembers(res.data);
    else setTeamMembersError(res.error);
  }, [user?.id]);

  useEffect(() => {
    if (!isLoaded || !user?.id) return;
    async function run() {
      await fetchProfile();
      await fetchTeamMembers();
      setIsLoading(false);
    }
    run();
  }, [isLoaded, user?.id, fetchProfile, fetchTeamMembers]);

  /** 表示モードにいるときは所属チームを team_members から必ず再取得（古いテキストカラムは一切使わない） */
  useEffect(() => {
    if (!isEditMode && user?.id) fetchTeamMembers();
  }, [isEditMode, user?.id, fetchTeamMembers]);

  const REQUIRED_FIELDS: { key: keyof typeof form; label: string }[] = [
    { key: "display_name", label: "表示名" },
    { key: "prefecture", label: "居住地（都道府県）" },
    { key: "career", label: "卓球歴" },
    { key: "play_style", label: "戦型" },
    { key: "dominant_hand", label: "利き腕" },
    { key: "achievements", label: "主な戦績" },
    { key: "racket", label: "ラケット" },
    { key: "forehand_rubber", label: "フォアラバー" },
    { key: "backhand_rubber", label: "バックラバー（裏面）" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.id) return;
    setMessage(null);
    const errors: Record<string, string> = {};
    for (const { key, label } of REQUIRED_FIELDS) {
      const value = form[key];
      const str = typeof value === "string" ? value.trim() : "";
      if (!str) {
        errors[key] = `${label}を入力してください`;
      }
    }
    if (form.is_organizer && !form.org_name_1.trim()) {
      errors.org_name_1 = "主催者の場合は主催チーム①を入力してください";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMessage({ type: "error", text: "すべての項目を入力してください。" });
      return;
    }

    /* 同じ都道府県＋同じチーム名の主催者が既にいればエラー（主催チームごとの都道府県で判定） */
    if (form.is_organizer) {
      const myPairs: { pref: string; name: string }[] = [];
      [
        [form.org_prefecture_1.trim(), form.org_name_1.trim()],
        [form.org_prefecture_2.trim(), form.org_name_2.trim()],
        [form.org_prefecture_3.trim(), form.org_name_3.trim()],
      ].forEach(([pref, name]) => {
        if (name) myPairs.push({ pref, name });
      });
      if (myPairs.length > 0) {
        const { data: existing } = await supabase
          .from("user_profiles")
          .select("user_id, org_name_1, org_name_2, org_name_3, org_prefecture_1, org_prefecture_2, org_prefecture_3")
          .eq("is_organizer", true)
          .neq("user_id", user.id);
        const rows = (existing as {
          user_id: string;
          org_name_1: string | null;
          org_name_2: string | null;
          org_name_3: string | null;
          org_prefecture_1: string | null;
          org_prefecture_2: string | null;
          org_prefecture_3: string | null;
        }[] | null) ?? [];
        const otherPairs = new Set<string>();
        for (const r of rows) {
          [
            [(r.org_prefecture_1 ?? "").trim(), (r.org_name_1 ?? "").trim()],
            [(r.org_prefecture_2 ?? "").trim(), (r.org_name_2 ?? "").trim()],
            [(r.org_prefecture_3 ?? "").trim(), (r.org_name_3 ?? "").trim()],
          ].forEach(([pref, name]) => {
            if (name) otherPairs.add(`${pref}\t${name}`);
          });
        }
        const conflict = myPairs.some((p) => otherPairs.has(`${p.pref}\t${p.name}`));
        if (conflict) {
          setMessage({ type: "error", text: "すでに主催者が存在します。問い合わせてください。" });
          return;
        }
      }
    }

    setIsSaving(true);
    const saveResult = await saveUserProfile({
      display_name: form.display_name,
      prefecture: form.prefecture,
      career: form.career,
      play_style: form.play_style,
      dominant_hand: form.dominant_hand,
      achievements: form.achievements,
      is_organizer: form.is_organizer,
      org_name_1: form.org_name_1.trim() || null,
      org_name_2: form.org_name_2.trim() || null,
      org_name_3: form.org_name_3.trim() || null,
      org_prefecture_1: form.org_prefecture_1.trim() || null,
      org_prefecture_2: form.org_prefecture_2.trim() || null,
      org_prefecture_3: form.org_prefecture_3.trim() || null,
      racket: form.racket,
      forehand_rubber: form.forehand_rubber,
      backhand_rubber: form.backhand_rubber,
    });
    setIsSaving(false);
    if (!saveResult.success) {
      setMessage({ type: "error", text: saveResult.error });
      return;
    }
    const replaceRes = await replaceAffiliatedTeams(
      teamMembers.map((m) => ({ team_id: m.team_id, custom_team_name: m.custom_team_name }))
    );
    if (!replaceRes.success) {
      setMessage({ type: "error", text: replaceRes.error });
      return;
    }
    await fetchTeamMembers();
    await fetchProfile();
    await fetchTeamMembers();
    setSaveSuccessVisible(true);
    setMessage({ type: "ok", text: "保存しました。" });
  }

  if (!isLoaded) {
    return (
      <div className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
        <p className="text-slate-500">読み込み中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
        <p className="text-slate-500">ログインしてください。</p>
        <Link href="/" className="mt-4 inline-block text-emerald-600 hover:underline">
          トップへ
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft size={16} />
        トップへ
      </Link>
      <h1 className="mb-6 text-xl font-semibold">プロフィール</h1>

      {isEditMode ? (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>プロフィール</CardTitle>
              <CardDescription>
                卓球歴・戦型と使用用具を登録できます。練習相手への参考として表示されます。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="display_name">表示名 <span className="text-red-500">（必須）</span></Label>
                <Input
                  id="display_name"
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder="例: 山田 太郎"
                  className="w-full"
                />
                {fieldErrors.display_name && <p className="text-sm text-red-600">{fieldErrors.display_name}</p>}
              </div>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_organizer}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        is_organizer: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium">練習会主催者</span>
                </label>
                <p className="text-xs text-slate-500">※練習会主催者でないと練習会を登録できません</p>
                {form.is_organizer && (
                  <div className="pl-6 space-y-3">
                    <p className="text-xs text-slate-500">主催チームは最大３つまで登録できます（①は必須）</p>
                    <div className="space-y-2">
                      <Label htmlFor="org_name_1">主催チーム① <span className="text-red-500">（必須）</span></Label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <select
                          id="org_prefecture_1"
                          value={form.org_prefecture_1}
                          onChange={(e) => setForm((f) => ({ ...f, org_prefecture_1: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:w-40"
                        >
                          <option value="">都道府県を選択</option>
                          {prefectureOptions.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                        <Input
                          id="org_name_1"
                          value={form.org_name_1}
                          onChange={(e) => setForm((f) => ({ ...f, org_name_1: e.target.value }))}
                          placeholder="例: ○○卓球クラブ"
                          className="flex-1"
                        />
                      </div>
                      {fieldErrors.org_name_1 && <p className="text-sm text-red-600">{fieldErrors.org_name_1}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org_name_2">主催チーム②</Label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <select
                          id="org_prefecture_2"
                          value={form.org_prefecture_2}
                          onChange={(e) => setForm((f) => ({ ...f, org_prefecture_2: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:w-40"
                        >
                          <option value="">都道府県を選択</option>
                          {prefectureOptions.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                        <Input
                          id="org_name_2"
                          value={form.org_name_2}
                          onChange={(e) => setForm((f) => ({ ...f, org_name_2: e.target.value }))}
                          placeholder="例: ○○卓球クラブ"
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org_name_3">主催チーム③</Label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <select
                          id="org_prefecture_3"
                          value={form.org_prefecture_3}
                          onChange={(e) => setForm((f) => ({ ...f, org_prefecture_3: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:w-40"
                        >
                          <option value="">都道府県を選択</option>
                          {prefectureOptions.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                        <Input
                          id="org_name_3"
                          value={form.org_name_3}
                          onChange={(e) => setForm((f) => ({ ...f, org_name_3: e.target.value }))}
                          placeholder="例: ○○卓球クラブ"
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSavingOrganizerTeams || (form.is_organizer && !form.org_name_1.trim())}
                      onClick={async () => {
                        setMessage(null);
                        setIsSavingOrganizerTeams(true);
                        const res = await saveOrganizerTeamsOnly({
                          is_organizer: form.is_organizer,
                          org_name_1: form.org_name_1,
                          org_name_2: form.org_name_2,
                          org_name_3: form.org_name_3,
                          org_prefecture_1: form.org_prefecture_1,
                          org_prefecture_2: form.org_prefecture_2,
                          org_prefecture_3: form.org_prefecture_3,
                        });
                        setIsSavingOrganizerTeams(false);
                        if (res.success) {
                          const preserved = {
                            display_name: form.display_name,
                            prefecture: form.prefecture,
                            org_prefecture_1: form.org_prefecture_1,
                            org_prefecture_2: form.org_prefecture_2,
                            org_prefecture_3: form.org_prefecture_3,
                            career: form.career,
                            play_style: form.play_style,
                            dominant_hand: form.dominant_hand,
                            achievements: form.achievements,
                            racket: form.racket,
                            forehand_rubber: form.forehand_rubber,
                            backhand_rubber: form.backhand_rubber,
                          };
                          await fetchProfile({ keepEditMode: true });
                          setForm((prev) => ({ ...prev, ...preserved }));
                          await fetchTeamMembers();
                          setMessage({
                            type: "ok",
                            text: res.added > 0 ? `主催チームを保存し、所属チームに${res.added}件追加しました。` : "主催チームを保存しました。",
                          });
                        } else {
                          setMessage({ type: "error", text: res.error });
                        }
                      }}
                    >
                      {isSavingOrganizerTeams ? "保存中…" : "主催チームを保存"}
                    </Button>
                  </div>
                )}
              </div>
              {/* 所属チーム管理（teams / team_members）最大3つ */}
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                <h3 className="text-sm font-semibold text-slate-800">所属チーム管理（最大3つ）</h3>
                <p className="text-xs text-slate-600">
                  チームはプルダウンから選択して登録することで紐づけられます。まだない場合は主催者にチームの作成をお願いしてください。
                </p>
                {teamMembersError && (
                  <p className="text-sm text-red-600">{teamMembersError}</p>
                )}
                {teamMembers.length === 0 && !addTeamMode && (
                  <p className="text-sm text-slate-500">未登録</p>
                )}
                {teamMembers.length > 0 && (
                  <ul className="space-y-2">
                    {teamMembers.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <span className="text-slate-800">{m.display_name}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            setTeamMembersError(null);
                            const res = await deleteTeamMembersByDisplayName(m.display_name);
                            if (res.success) {
                              await fetchTeamMembers();
                            } else {
                              setTeamMembersError(res.error);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded text-red-600 hover:bg-red-50 hover:text-red-700"
                          aria-label="削除"
                        >
                          <Trash2 size={14} />
                          削除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-3">
                {teamMembers.length < 3 && !addTeamMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddTeamMode(true);
                      setTeamSearchPrefecture("");
                      setTeamSearchResults([]);
                      setSelectedTeamIdForAdd("");
                      setAddTeamError(null);
                      setHasSearchedTeam(false);
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    <Plus size={16} />
                    チームを追加
                  </button>
                )}
                {teamMembers.length < 3 && addTeamMode && (
                  <div className="w-full space-y-3 rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-xs text-slate-500">都道府県で検索し、プルダウンからチームを選択してください。リストにない場合は主催者にチームの作成をお願いしてください。</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[10rem]">
                        <Label htmlFor="team-search-pref" className="text-xs">都道府県</Label>
                        <select
                          id="team-search-pref"
                          value={teamSearchPrefecture}
                          onChange={(e) => {
                            setTeamSearchPrefecture(e.target.value);
                            setTeamSearchResults([]);
                            setSelectedTeamIdForAdd("");
                          }}
                          className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">選択</option>
                          {prefectureOptions.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!teamSearchPrefecture.trim() || teamSearchLoading}
                        onClick={async () => {
                          if (!teamSearchPrefecture.trim()) return;
                          setTeamSearchLoading(true);
                          setAddTeamError(null);
                          setHasSearchedTeam(true);
                          const res = await searchTeamsByPrefecture(teamSearchPrefecture.trim());
                          setTeamSearchLoading(false);
                          if (res.success) setTeamSearchResults(res.data);
                          else setAddTeamError(res.error ?? "検索に失敗しました");
                        }}
                      >
                        {teamSearchLoading ? "検索中…" : "検索"}
                      </Button>
                    </div>
                    {teamSearchResults.length > 0 && (
                      <div>
                        <Label className="text-xs">チームを選択</Label>
                        <select
                          value={selectedTeamIdForAdd}
                          onChange={(e) => setSelectedTeamIdForAdd(e.target.value)}
                          className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">選択してください</option>
                          {teamSearchResults.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}（{t.prefecture}）
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {hasSearchedTeam && !teamSearchLoading && teamSearchResults.length === 0 && (
                      <p className="text-xs text-amber-700">
                        この都道府県に登録されたチームはありません。主催者にチームの作成をお願いしてください。
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={addTeamSubmitting || !selectedTeamIdForAdd}
                        onClick={async () => {
                          if (!selectedTeamIdForAdd) return;
                          setAddTeamError(null);
                          setAddTeamSubmitting(true);
                          const res = await addTeamMember({ team_id: selectedTeamIdForAdd });
                          setAddTeamSubmitting(false);
                          if (res.success) {
                            await fetchTeamMembers();
                            setAddTeamMode(false);
                            setTeamSearchPrefecture("");
                            setTeamSearchResults([]);
                            setSelectedTeamIdForAdd("");
                          } else {
                            setAddTeamError(res.error);
                          }
                        }}
                      >
                        {addTeamSubmitting ? "登録中…" : "登録する"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddTeamMode(false);
                          setAddTeamError(null);
                        }}
                        className="text-xs text-slate-500 underline hover:text-slate-700"
                      >
                        キャンセル
                      </button>
                    </div>
                    {addTeamError && <p className="text-sm text-red-600">{addTeamError}</p>}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSavingTeamMembers}
                  className="shrink-0"
                  onClick={async () => {
                    setMessage(null);
                    setTeamMembersError(null);
                    setIsSavingTeamMembers(true);
                    const res = await getMyTeamMembers();
                    setIsSavingTeamMembers(false);
                    if (res.success) {
                      setTeamMembers(res.data);
                      setMessage({ type: "ok", text: "所属チームを保存しました。" });
                    } else {
                      setTeamMembersError(res.error);
                      setMessage({ type: "error", text: res.error });
                    }
                  }}
                >
                  {isSavingTeamMembers ? "保存中…" : "所属チームを保存"}
                </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="prefecture">居住地（都道府県） <span className="text-red-500">（必須）</span></Label>
                <select
                  id="prefecture"
                  value={form.prefecture}
                  onChange={(e) => setForm((f) => ({ ...f, prefecture: e.target.value }))}
                  className="border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 md:text-sm"
                >
                  <option value="">選択してください</option>
                  {prefectureOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {fieldErrors.prefecture && <p className="text-sm text-red-600">{fieldErrors.prefecture}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="career">卓球歴 <span className="text-red-500">（必須）</span></Label>
                <Input
                  id="career"
                  value={form.career}
                  onChange={(e) => setForm((f) => ({ ...f, career: e.target.value }))}
                  placeholder="例: 10年"
                  className="w-full"
                />
                {fieldErrors.career && <p className="text-sm text-red-600">{fieldErrors.career}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="play_style">戦型 <span className="text-red-500">（必須）</span></Label>
                <Input
                  id="play_style"
                  value={form.play_style}
                  onChange={(e) => setForm((f) => ({ ...f, play_style: e.target.value }))}
                  placeholder="例: 前陣速攻"
                  className="w-full"
                />
                {fieldErrors.play_style && <p className="text-sm text-red-600">{fieldErrors.play_style}</p>}
              </div>
              <div className="space-y-2">
                <Label>利き腕 <span className="text-red-500">（必須）</span></Label>
                <div className="flex gap-4">
                  {DOMINANT_HAND_OPTIONS.map((value) => (
                    <label key={value} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="dominant_hand"
                        value={value}
                        checked={form.dominant_hand === value}
                        onChange={() => setForm((f) => ({ ...f, dominant_hand: value }))}
                        className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm">{value}</span>
                    </label>
                  ))}
                </div>
                {fieldErrors.dominant_hand && <p className="text-sm text-red-600">{fieldErrors.dominant_hand}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="achievements">主な戦績 <span className="text-red-500">（必須）</span></Label>
                <textarea
                  id="achievements"
                  value={form.achievements}
                  onChange={(e) => setForm((f) => ({ ...f, achievements: e.target.value }))}
                  placeholder="例: 〇〇大会ベスト8、県大会シングルス優勝"
                  rows={4}
                  className="border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-slate-400 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 md:text-sm"
                />
                {fieldErrors.achievements && <p className="text-sm text-red-600">{fieldErrors.achievements}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="racket">ラケット <span className="text-red-500">（必須）</span></Label>
                <Input
                  id="racket"
                  value={form.racket}
                  onChange={(e) => setForm((f) => ({ ...f, racket: e.target.value }))}
                  placeholder="例: バタフライ ヴィスカリア"
                  className="w-full"
                />
                {fieldErrors.racket && <p className="text-sm text-red-600">{fieldErrors.racket}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="forehand_rubber">フォアラバー <span className="text-red-500">（必須）</span></Label>
                <Input
                  id="forehand_rubber"
                  value={form.forehand_rubber}
                  onChange={(e) => setForm((f) => ({ ...f, forehand_rubber: e.target.value }))}
                  placeholder="例: ダニエル デジタル"
                  className="w-full"
                />
                {fieldErrors.forehand_rubber && <p className="text-sm text-red-600">{fieldErrors.forehand_rubber}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="backhand_rubber">バックラバー（裏面） <span className="text-red-500">（必須）</span></Label>
                <Input
                  id="backhand_rubber"
                  value={form.backhand_rubber}
                  onChange={(e) => setForm((f) => ({ ...f, backhand_rubber: e.target.value }))}
                  placeholder="例: バタフライ テナーギー"
                  className="w-full"
                />
                {fieldErrors.backhand_rubber && <p className="text-sm text-red-600">{fieldErrors.backhand_rubber}</p>}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "保存中…" : "保存する"}
              </Button>
              {message && (
                <p
                  className={
                    message.type === "ok"
                      ? "text-sm text-emerald-600"
                      : "text-sm text-red-600"
                  }
                >
                  {message.text}
                </p>
              )}
            </CardFooter>
          </Card>
        </form>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>プロフィール</CardTitle>
            <CardDescription>
              登録した内容です。変更する場合は下のボタンから編集できます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {savedProfile?.display_name?.trim() && (
              <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">表示名</span>
                <span className="text-slate-900">{savedProfile.display_name}</span>
              </div>
            )}
            <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
              <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">練習会主催者</span>
              <span className="text-slate-900">{savedProfile?.is_organizer ? "はい" : "いいえ"}</span>
            </div>
            {savedProfile?.is_organizer && [savedProfile.org_name_1, savedProfile.org_name_2, savedProfile.org_name_3].some((v) => (v ?? "").trim() !== "") && (
              <>
                {savedProfile.org_name_1?.trim() && (
                  <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                    <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">主催チーム①</span>
                    <span className="text-slate-900">
                      {savedProfile.org_prefecture_1?.trim() ? `${savedProfile.org_prefecture_1}の${savedProfile.org_name_1}` : savedProfile.org_name_1}
                    </span>
                  </div>
                )}
                {savedProfile.org_name_2?.trim() && (
                  <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                    <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">主催チーム②</span>
                    <span className="text-slate-900">
                      {savedProfile.org_prefecture_2?.trim() ? `${savedProfile.org_prefecture_2}の${savedProfile.org_name_2}` : savedProfile.org_name_2}
                    </span>
                  </div>
                )}
                {savedProfile.org_name_3?.trim() && (
                  <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                    <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">主催チーム③</span>
                    <span className="text-slate-900">
                      {savedProfile.org_prefecture_3?.trim() ? `${savedProfile.org_prefecture_3}の${savedProfile.org_name_3}` : savedProfile.org_name_3}
                    </span>
                  </div>
                )}
              </>
            )}
            {/* 所属チーム: team_members テーブル（teams JOIN）のみ。user_profiles のテキストカラムは参照しない */}
            <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
              <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">所属チーム</span>
              <span className="text-slate-900">
                {teamMembers.length === 0
                  ? "所属なし"
                  : teamMembers.map((m) => m.display_name).join("、")}
              </span>
            </div>
            {savedProfile?.prefecture && (
              <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">居住地（都道府県）</span>
                <span className="text-slate-900">{savedProfile.prefecture}</span>
              </div>
            )}
            {(["career", "play_style", "dominant_hand", "achievements", "racket", "forehand_rubber", "backhand_rubber"] as const).map(
              (key) => {
                const value = savedProfile?.[key];
                if (value == null || value === "") return null;
                return (
                  <div key={key} className="flex flex-col gap-0.5 md:flex-row md:gap-4">
                    <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">
                      {LABELS[key]}
                    </span>
                    <span className={key === "achievements" ? "whitespace-pre-line text-slate-900" : "text-slate-900"}>
                      {value}
                    </span>
                  </div>
                );
              }
            )}
            <div className="mt-4 flex flex-col gap-0.5 border-t border-slate-100 pt-4 md:flex-row sm:gap-4">
              <span className="min-w-[10rem] text-sm font-medium text-slate-500">更新日</span>
              <span className="text-slate-600 text-sm">
                {formatUpdatedAt(savedProfile?.updated_at)}
              </span>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMessage(null);
                setFieldErrors({});
                setIsEditMode(true);
              }}
              className="gap-2"
            >
              <Pencil size={16} />
              変更
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* 保存完了ポップアップ（ボワっと表示） */}
      {saveSuccessVisible && (
        <div
          className={`fixed inset-0 z-30 flex items-center justify-center p-4 bg-slate-900/25 backdrop-blur-[2px] transition-opacity duration-300 ${
            saveSuccessReady ? "opacity-100" : "opacity-0"
          }`}
          role="alert"
          aria-live="polite"
          onClick={() => setSaveSuccessVisible(false)}
        >
          <div
            className={`rounded-xl bg-white px-8 py-6 shadow-xl transition-all duration-300 ease-out ${
              saveSuccessReady ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-semibold text-slate-900">保存しました！</p>
            <button
              type="button"
              onClick={() => setSaveSuccessVisible(false)}
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
