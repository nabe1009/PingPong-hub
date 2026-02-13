"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { supabase } from "@/lib/supabase/client";
import type { UserProfileRow } from "@/lib/supabase/client";
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
import { ArrowLeft, Pencil } from "lucide-react";

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
    racket: "",
    forehand_rubber: "",
    backhand_rubber: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  /** 保存完了ポップアップ（ボワっと表示） */
  const [saveSuccessVisible, setSaveSuccessVisible] = useState(false);
  const [saveSuccessReady, setSaveSuccessReady] = useState(false);
  /** 居住地選択肢：prefectures_cities の prefecture_name の重複除去・ソート */
  const [prefectureOptions, setPrefectureOptions] = useState<string[]>([]);

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
      const names = [...new Set(rows.map((r) => r.prefecture_name))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ja"));
      setPrefectureOptions(names);
    }
    fetchPrefectures();
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("user_profiles")
      .select("affiliation, prefecture, career, play_style, dominant_hand, achievements, is_organizer, org_name_1, org_name_2, org_name_3, racket, forehand_rubber, backhand_rubber, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const row = data as UserProfileRow | null;
    if (row) {
      setSavedProfile(row);
      setForm({
        affiliation: row.affiliation ?? "",
        prefecture: row.prefecture ?? "",
        career: row.career ?? "",
        play_style: row.play_style ?? "",
        dominant_hand: row.dominant_hand ?? "",
        achievements: row.achievements ?? "",
        is_organizer: row.is_organizer ?? false,
        org_name_1: row.org_name_1 ?? "",
        org_name_2: row.org_name_2 ?? "",
        org_name_3: row.org_name_3 ?? "",
        racket: row.racket ?? "",
        forehand_rubber: row.forehand_rubber ?? "",
        backhand_rubber: row.backhand_rubber ?? "",
      });
      setIsEditMode(false);
    } else {
      setSavedProfile(null);
      setIsEditMode(true);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isLoaded || !user?.id) return;
    async function run() {
      await fetchProfile();
      setIsLoading(false);
    }
    run();
  }, [isLoaded, user?.id, fetchProfile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.id) return;
    setIsSaving(true);
    setMessage(null);
    const displayName =
      (user.fullName && user.fullName.trim()) ||
      (user.firstName && user.firstName.trim()) ||
      null;
    const { error } = await supabase.from("user_profiles").upsert(
      {
        user_id: user.id,
        display_name: displayName,
        affiliation: form.affiliation.trim() || null,
        prefecture: form.prefecture.trim() || null,
        career: form.career.trim() || null,
        play_style: form.play_style.trim() || null,
        dominant_hand: form.dominant_hand.trim() || null,
        achievements: form.achievements.trim() || null,
        is_organizer: form.is_organizer,
        org_name_1: form.org_name_1.trim() || null,
        org_name_2: form.org_name_2.trim() || null,
        org_name_3: form.org_name_3.trim() || null,
        racket: form.racket.trim() || null,
        forehand_rubber: form.forehand_rubber.trim() || null,
        backhand_rubber: form.backhand_rubber.trim() || null,
      },
      { onConflict: "user_id" }
    );
    setIsSaving(false);
    if (error) {
      setMessage({ type: "error", text: "保存に失敗しました。" });
      return;
    }
    setMessage({ type: "ok", text: "保存しました。" });
    await fetchProfile();
    setSaveSuccessVisible(true);
  }

  if (!isLoaded) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p className="text-slate-500">読み込み中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p className="text-slate-500">ログインしてください。</p>
        <Link href="/" className="mt-4 inline-block text-emerald-600 hover:underline">
          トップへ
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
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
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_organizer}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        is_organizer: e.target.checked,
                        // チェックを外してもチーム名はフォームに残す（再チェック時に復元するため）
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium">練習会主催者</span>
                </label>
                <p className="text-xs text-slate-500">※練習会主催者でないと練習会を登録できません</p>
                {form.is_organizer && (
                  <div className="pl-6 space-y-3">
                    <p className="text-xs text-slate-500">最大３つまで登録できます</p>
                    <div className="space-y-2">
                      <Label htmlFor="org_name_1">主催チーム名/卓球場/個人名①</Label>
                      <Input
                        id="org_name_1"
                        value={form.org_name_1}
                        onChange={(e) => setForm((f) => ({ ...f, org_name_1: e.target.value }))}
                        placeholder="例: 〇〇卓球クラブ"
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org_name_2">主催チーム名/卓球場/個人名②</Label>
                      <Input
                        id="org_name_2"
                        value={form.org_name_2}
                        onChange={(e) => setForm((f) => ({ ...f, org_name_2: e.target.value }))}
                        placeholder="例: △△市民体育館"
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org_name_3">主催チーム名/卓球場/個人名③</Label>
                      <Input
                        id="org_name_3"
                        value={form.org_name_3}
                        onChange={(e) => setForm((f) => ({ ...f, org_name_3: e.target.value }))}
                        placeholder="例: 山田太郎"
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="affiliation">所属/チーム名</Label>
                <Input
                  id="affiliation"
                  value={form.affiliation}
                  onChange={(e) => setForm((f) => ({ ...f, affiliation: e.target.value }))}
                  placeholder="例: 〇〇大学卓球部"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prefecture">居住地（都道府県）</Label>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="career">卓球歴</Label>
                <Input
                  id="career"
                  value={form.career}
                  onChange={(e) => setForm((f) => ({ ...f, career: e.target.value }))}
                  placeholder="例: 10年"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="play_style">戦型</Label>
                <Input
                  id="play_style"
                  value={form.play_style}
                  onChange={(e) => setForm((f) => ({ ...f, play_style: e.target.value }))}
                  placeholder="例: 前陣速攻"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label>利き腕</Label>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="achievements">主な戦績</Label>
                <textarea
                  id="achievements"
                  value={form.achievements}
                  onChange={(e) => setForm((f) => ({ ...f, achievements: e.target.value }))}
                  placeholder="例: 〇〇大会ベスト8、県大会シングルス優勝"
                  rows={4}
                  className="border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-slate-400 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 md:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="racket">ラケット</Label>
                <Input
                  id="racket"
                  value={form.racket}
                  onChange={(e) => setForm((f) => ({ ...f, racket: e.target.value }))}
                  placeholder="例: バタフライ ヴィスカリア"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forehand_rubber">フォアラバー</Label>
                <Input
                  id="forehand_rubber"
                  value={form.forehand_rubber}
                  onChange={(e) => setForm((f) => ({ ...f, forehand_rubber: e.target.value }))}
                  placeholder="例: ダニエル デジタル"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backhand_rubber">バックラバー（裏面）</Label>
                <Input
                  id="backhand_rubber"
                  value={form.backhand_rubber}
                  onChange={(e) => setForm((f) => ({ ...f, backhand_rubber: e.target.value }))}
                  placeholder="例: バタフライ テナーギー"
                  className="w-full"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
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
            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
              <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">練習会主催者</span>
              <span className="text-slate-900">{savedProfile?.is_organizer ? "はい" : "いいえ"}</span>
            </div>
            {savedProfile?.is_organizer && [savedProfile.org_name_1, savedProfile.org_name_2, savedProfile.org_name_3].some((v) => (v ?? "").trim() !== "") && (
              <>
                {savedProfile.org_name_1?.trim() && (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                    <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">主催チーム名/卓球場/個人名①</span>
                    <span className="text-slate-900">{savedProfile.org_name_1}</span>
                  </div>
                )}
                {savedProfile.org_name_2?.trim() && (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                    <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">主催チーム名/卓球場/個人名②</span>
                    <span className="text-slate-900">{savedProfile.org_name_2}</span>
                  </div>
                )}
                {savedProfile.org_name_3?.trim() && (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                    <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">主催チーム名/卓球場/個人名③</span>
                    <span className="text-slate-900">{savedProfile.org_name_3}</span>
                  </div>
                )}
              </>
            )}
            {savedProfile?.prefecture && (
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                <span className="min-w-[10rem] shrink-0 text-sm font-medium text-slate-500">居住地（都道府県）</span>
                <span className="text-slate-900">{savedProfile.prefecture}</span>
              </div>
            )}
            {(["affiliation", "career", "play_style", "dominant_hand", "achievements", "racket", "forehand_rubber", "backhand_rubber"] as const).map(
              (key) => {
                const value = savedProfile?.[key];
                if (value == null || value === "") return null;
                return (
                  <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
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
            <div className="mt-4 flex flex-col gap-0.5 border-t border-slate-100 pt-4 sm:flex-row sm:gap-4">
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
