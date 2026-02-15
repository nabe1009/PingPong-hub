"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import type { PrefectureCityRow } from "@/lib/supabase/client";
import {
  createPracticesWithRecurrence,
  type RecurrenceType,
  type ConflictPractice,
} from "@/app/actions/create-practices-with-recurrence";
import { sortPrefecturesNorthToSouth } from "@/lib/prefectures";
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
  const [conflictPractices, setConflictPractices] = useState<ConflictPractice[] | null>(null);
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
    fee: "",
    content: "",
    level: "",
    requirements: "",
    recurrence_type: "none" as RecurrenceType,
    recurrence_end_date: "",
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
    return sortPrefecturesNorthToSouth(Array.from(set));
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

  /** 今日の日付 YYYY-MM-DD（過去の日付を選択不可にするため） */
  const todayDateMin = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  /** 今日を選択している場合の開始時刻の最小値（現在時刻を15分単位で切り上げ） */
  const minStartTimeToday = (() => {
    const d = new Date();
    let h = d.getHours();
    let m = d.getMinutes();
    m = Math.ceil(m / 15) * 15;
    if (m >= 60) {
      m = 0;
      h += 1;
    }
    if (h >= 24) h = 23;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  })();

  const isDateToday = form.date === todayDateMin;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConflictPractices(null);
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
    const recurrenceType = form.recurrence_type ?? "none";
    const recurrenceEndDateMax = `${new Date().getFullYear()}-12-31`;
    if (recurrenceType !== "none" && !form.recurrence_end_date.trim()) {
      setError("繰り返しを設定する場合は終了日を指定してください。");
      return;
    }
    if (recurrenceType !== "none" && form.recurrence_end_date.trim() && form.recurrence_end_date.trim() > recurrenceEndDateMax) {
      setError("繰り返しの終了日は年内を指定してください。");
      return;
    }
    const max_participants = Number(form.capacity);
    if (Number.isNaN(max_participants) || max_participants < 1) {
      setError("参加人数上限は1以上で入力してください。");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createPracticesWithRecurrence({
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
        fee: form.fee.trim() || null,
        recurrence_type: recurrenceType,
        recurrence_end_date:
          recurrenceType !== "none" ? form.recurrence_end_date.trim() : null,
      });
      if (!result.success) {
        setError(result.error ?? "登録に失敗しました。");
        setConflictPractices(result.conflictPractices ?? null);
        setIsSubmitting(false);
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました。");
      setConflictPractices(null);
      setIsSubmitting(false);
    }
  }

  /** 日付を 2/17（火） 形式で表示 */
  function formatConflictDate(iso: string): string {
    const d = new Date(iso + "T00:00:00");
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
  }

  if (!isSignedIn) {
    return (
      <div className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
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
      <div className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
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
    <div className="w-full px-4 py-8 md:max-w-5xl md:mx-auto">
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
              <div
                className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
                onClick={() => {
                  setError(null);
                  setConflictPractices(null);
                }}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="error-popup-title"
              >
                <div
                  className="w-full max-w-md rounded-xl border border-slate-200/80 bg-white/95 p-5 shadow-2xl backdrop-blur-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 id="error-popup-title" className="sr-only">エラー</h3>
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                  {conflictPractices && conflictPractices.length > 0 && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-slate-800">
                      <p className="mb-2 font-medium text-amber-800">以下の練習と時間が重複しています：</p>
                      <ul className="list-inside list-disc space-y-1 text-slate-700">
                        {conflictPractices.map((c, i) => (
                          <li key={i}>
                            {formatConflictDate(c.event_date)} {c.start_time}〜{c.end_time}　{c.team_name}
                            {c.location ? ` @ ${c.location}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setError(null);
                        setConflictPractices(null);
                      }}
                      className="rounded-lg"
                    >
                      閉じる
                    </Button>
                  </div>
                </div>
              </div>
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
                min={todayDateMin}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
              <p className="text-xs text-slate-500">過去の日付は選択できません</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recurrence_type">繰り返しの設定</Label>
              <select
                id="recurrence_type"
                value={form.recurrence_type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    recurrence_type: e.target.value as RecurrenceType,
                    recurrence_end_date: e.target.value === "none" ? "" : f.recurrence_end_date,
                  }))
                }
                className={selectClassName}
              >
                <option value="none">なし</option>
                <option value="weekly">毎週</option>
                <option value="monthly_date">毎月（日付固定）</option>
                <option value="monthly_nth">毎月（第N曜日）</option>
              </select>
            </div>

            {form.recurrence_type !== "none" && (
              <div className="space-y-2">
                <Label htmlFor="recurrence_end_date">終了日（年内）</Label>
                <Input
                  id="recurrence_end_date"
                  type="date"
                  max={`${new Date().getFullYear()}-12-31`}
                  value={form.recurrence_end_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recurrence_end_date: e.target.value }))
                  }
                />
                <p className="text-xs text-slate-500">※繰り返し日程は年内までしか登録できません。来年以降は年が明けてから設定してください。</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="start_time">開始時刻</Label>
                <Input
                  id="start_time"
                  type="time"
                  required
                  min={isDateToday ? minStartTimeToday : undefined}
                  value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                />
                {isDateToday && (
                  <p className="text-xs text-slate-500">今日の場合は現在時刻以降を選択してください</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">終了時刻</Label>
                <Input
                  id="end_time"
                  type="time"
                  required
                  min={form.start_time}
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
              <Label htmlFor="fee">参加費（任意）</Label>
              <Input
                id="fee"
                type="text"
                placeholder="例: 500円、無料"
                value={form.fee}
                onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
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
