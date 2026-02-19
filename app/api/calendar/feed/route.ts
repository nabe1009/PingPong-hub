import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildIcsFromPractices } from "@/lib/ics-export";
import type { PracticeRow } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/feed?token=xxx
 * トークンに紐づくユーザーの「今後の参加予定」を .ics で返す。
 * Googleカレンダー・iPhoneカレンダーで「URLで追加」すると、ダウンロードなしで反映される。
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token?.trim()) {
    return new Response("token required", { status: 400 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return new Response("Calendar feed not configured", { status: 503 });
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("calendar_feed_token", token.trim())
    .maybeSingle();

  if (!profile) {
    return new Response("Invalid token", { status: 404 });
  }

  const userId = (profile as { user_id: string }).user_id;

  const { data: signups } = await admin
    .from("signups")
    .select("practice_id")
    .eq("user_id", userId);

  const practiceIds = [...new Set((signups ?? []).map((s: { practice_id: string }) => s.practice_id))];
  if (practiceIds.length === 0) {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//PingPong Hub//練習予定//JA",
      "CALSCALE:GREGORIAN",
      "END:VCALENDAR",
    ].join("\r\n");
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  const { data: practices } = await admin
    .from("practices")
    .select("*")
    .in("id", practiceIds);

  const list = (practices ?? []) as PracticeRow[];
  const now = new Date();
  const upcoming = list.filter((p) => {
    const iso = `${p.event_date}T${(p.start_time.length === 5 ? p.start_time : p.start_time + ":00").slice(0, 5)}:00`;
    return new Date(iso) >= now;
  });
  const sorted = [...upcoming].sort(
    (a, b) =>
      `${a.event_date}T${a.start_time}`.localeCompare(`${b.event_date}T${b.start_time}`)
  );

  const ics = buildIcsFromPractices(sorted);

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
