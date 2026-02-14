"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { supabase } from "@/lib/supabase/client";
import type { PracticeRow, SignupRow } from "@/lib/supabase/client";
import { Calendar, MapPin, Users, ArrowLeft, LogIn } from "lucide-react";

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

export default function MyPracticesPage() {
  const { userId, isLoaded } = useAuth();
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [practices, setPractices] = useState<PracticeRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white shadow-sm">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
              <ArrowLeft size={20} />
              トップへ
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <p className="text-center text-slate-500">読み込み中…</p>
        </main>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white shadow-sm">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
              <ArrowLeft size={20} />
              トップへ
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
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
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
            <ArrowLeft size={20} />
            トップへ
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="mb-6 text-xl font-bold text-slate-900 sm:text-2xl">自分の練習予定</h1>

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
                        <Link
                          href="/"
                          className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
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
                        </Link>
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
                        <div className="block rounded-lg border border-slate-100 bg-slate-50/80 p-4">
                          <p className="mb-1 font-semibold text-slate-700">{p.team_name ?? "練習会"}</p>
                          <p className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                            <Calendar size={16} className="shrink-0" />
                            {formatPracticeDate(isoStart, isoEnd)}
                          </p>
                          <p className="flex items-center gap-2 text-sm text-slate-500">
                            <MapPin size={16} className="shrink-0" />
                            {p.location}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
