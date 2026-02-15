"use server";

import { unstable_noStore } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { PracticeRow } from "@/lib/supabase/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * 練習会一覧を取得。
 * RLS により「見てよいデータ」だけが返る。is_private のフィルタはアプリ側では行わない。
 */
export async function getPractices(): Promise<
  { success: true; data: PracticeRow[] } | { success: false; error: string }
> {
  unstable_noStore();
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("practices")
    .select("*, teams(*)")
    .order("event_date", { ascending: true });

  if (error) return { success: false, error: error.message };

  const list = (data ?? []) as PracticeRow[];
  const sorted = [...list].sort(
    (a, b) => (a.event_date || "").localeCompare(b.event_date || "") || (a.start_time || "").localeCompare(b.start_time || "")
  );

  return { success: true, data: sorted };
}
