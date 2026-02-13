"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import type { PrefectureCityRow, PracticeInsert } from "@/lib/supabase/client";
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
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const selectClassName = cn(
  "border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
);

export default function NewPracticePage() {
  const router = useRouter();
  const { userId, isSignedIn } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [prefectureCityRows, setPrefectureCityRows] = useState<PrefectureCityRow[]>([]);
  const [form, setForm] = useState({
    team_name: "",
    prefecture: "",
    city: "",
    date: "",
    start_time: "14:00",
    end_time: "16:00",
    location: "",
    capacity: 8,
    content: "",
    level: "",
    requirements: "",
  });

  useEffect(() => {
    async function fetchPrefecturesCities() {
      const { data, error: e } = await supabase
        .from("prefectures_cities")
        .select("prefecture_name, city_name")
        .limit(5000);
      if (e) {
        setError("都道府県・市区町村データの取得に失敗しました。");
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

  const prefectures = useMemo(() => {
    const set = new Set(prefectureCityRows.map((r) => r.prefecture));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [prefectureCityRows]);

  const citiesByPrefecture = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of prefectureCityRows) {
      if (!map[row.prefecture]) map[row.prefecture] = [];
      if (!map[row.prefecture].includes(row.city)) {
        map[row.prefecture].push(row.city);
      }
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.localeCompare(b, "ja"));
    }
    return map;
  }, [prefectureCityRows]);

  const cityOptions = form.prefecture ? citiesByPrefecture[form.prefecture] ?? [] : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isSignedIn || !userId) {
      setError("ログインしてください。");
      return;
    }
    if (!form.team_name.trim()) {
      setError("チーム名を入力してください。");
      return;
    }
    if (!form.prefecture || !form.city) {
      setError("都道府県と市区町村を選択してください。");
      return;
    }
    if (!form.date || !form.start_time || !form.end_time || !form.location.trim()) {
      setError("日付・開始時刻・終了時刻・場所は必須です。");
      return;
    }
    const max_participants = Number(form.capacity);
    if (Number.isNaN(max_participants) || max_participants < 1) {
      setError("参加人数上限は1以上で入力してください。");
      return;
    }

    setIsSubmitting(true);
    try {
      const row: PracticeInsert = {
        team_name: form.team_name.trim(),
        prefecture: form.prefecture || null,
        city: form.city || null,
        event_date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        location: form.location.trim(),
        max_participants,
        content: form.content.trim() || null,
        level: form.level.trim() || null,
        conditions: form.requirements.trim() || null,
        user_id: userId,
      };
      const { error: insertError } = await supabase.from("practices").insert(row);
      if (insertError) throw insertError;
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました。");
      setIsSubmitting(false);
    }
  }

  if (!isSignedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>ログインが必要です</CardTitle>
            <CardDescription>練習日程を登録するにはログインしてください。</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="default">
              <Link href="/sign-in">ログイン</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>追加が完了しました！</CardTitle>
            <CardDescription>練習日程を登録しました。</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="default">
              <Link href="/" className="gap-1">
                <ArrowLeft className="size-4" />
                トップへ
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/" className="gap-1">
            <ArrowLeft className="size-4" />
            トップへ
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>練習日程を追加する</CardTitle>
          <CardDescription>各項目を入力して「追加する」で保存します。</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="team_name">チーム名</Label>
              <Input
                id="team_name"
                type="text"
                required
                placeholder="例: 〇〇卓球クラブ"
                value={form.team_name}
                onChange={(e) => setForm((f) => ({ ...f, team_name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prefecture">都道府県</Label>
              <select
                id="prefecture"
                required
                value={form.prefecture}
                onChange={(e) =>
                  setForm((f) => ({ ...f, prefecture: e.target.value, city: "" }))
                }
                className={selectClassName}
              >
                <option value="">都道府県を選択</option>
                {prefectures.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">市区町村</Label>
              <select
                id="city"
                required
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                className={selectClassName}
                disabled={!form.prefecture}
              >
                <option value="">
                  {form.prefecture ? "市区町村を選択" : "先に都道府県を選択してください"}
                </option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">日付</Label>
              <Input
                id="date"
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time">開始時刻</Label>
                <Input
                  id="start_time"
                  type="time"
                  required
                  value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">終了時刻</Label>
                <Input
                  id="end_time"
                  type="time"
                  required
                  value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">場所</Label>
              <Input
                id="location"
                type="text"
                required
                placeholder="例: 〇〇体育館"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="capacity">参加人数上限</Label>
              <Input
                id="capacity"
                type="number"
                min={1}
                max={999}
                required
                value={form.capacity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, capacity: parseInt(e.target.value, 10) || 1 }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">練習内容</Label>
              <textarea
                id="content"
                rows={3}
                placeholder="例: 基礎練習・ゲーム"
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                className="border-input placeholder:text-muted-foreground w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="level">練習者のレベル（任意）</Label>
              <Input
                id="level"
                type="text"
                placeholder="例: 初級〜中級、中級以上"
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="requirements">求める条件（任意）</Label>
              <textarea
                id="requirements"
                rows={3}
                placeholder="例: レベル問わず、フォア打ちができるくらい、相手の練習内容にある程度対応できる"
                value={form.requirements}
                onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
                className="border-input placeholder:text-muted-foreground w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm"
              />
            </div>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "登録中…" : "追加する"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/">キャンセル</Link>
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
