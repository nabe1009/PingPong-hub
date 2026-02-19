import type { PracticeRow } from "@/lib/supabase/client";

/** iCalendar のテキストで特殊文字をエスケープ */
function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** 日付＋時刻を iCalendar の YYYYMMDDTHHmmss に（ローカル時刻として） */
function toIcsDateTime(eventDate: string, time: string): string {
  const [h, m] = time.slice(0, 5).split(":").map((x) => x.padStart(2, "0"));
  const datePart = eventDate.replace(/-/g, "");
  return `${datePart}T${h}${m}00`;
}

/**
 * 参加予定の練習一覧から .ics（iCalendar）文字列を生成。
 * iPhone のカレンダー・Google カレンダーにインポート可能。
 */
export function buildIcsFromPractices(practices: PracticeRow[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PingPong Hub//練習予定//JA",
    "CALSCALE:GREGORIAN",
  ];

  for (const p of practices) {
    const startStr = toIcsDateTime(p.event_date, p.start_time);
    const endStr = toIcsDateTime(p.event_date, p.end_time);
    const summary = `卓球練習 - ${p.team_name ?? "練習会"}`;
    const location = p.location ?? "";
    const descParts = [p.content?.trim(), p.fee?.trim() ? `参加費: ${p.fee}` : null].filter(Boolean);
    const description = descParts.length > 0 ? descParts.join("\n") : "";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${p.id}@pingpong-hub`);
    lines.push(`DTSTART:${startStr}`);
    lines.push(`DTEND:${endStr}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** .ics をダウンロードさせる（ファイル名・Blob） */
export function downloadIcs(icsContent: string, filename = "pingpong-hub-practices.ics"): void {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 1件の練習をGoogleカレンダー「予定を追加」画面で開くURL（ホットペッパー風・URL登録不要）
 * 新しいタブで開くと日時・場所が入力された状態になるので「保存」するだけ。
 */
export function getGoogleCalendarAddEventUrl(p: PracticeRow): string {
  const startStr = toIcsDateTime(p.event_date, p.start_time);
  const endStr = toIcsDateTime(p.event_date, p.end_time);
  const text = `卓球練習 - ${p.team_name ?? "練習会"}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text,
    dates: `${startStr}/${endStr}`,
  });
  if (p.location?.trim()) params.set("location", p.location.trim());
  const descParts = [p.content?.trim(), p.fee?.trim() ? `参加費: ${p.fee}` : null].filter(Boolean);
  if (descParts.length > 0) params.set("details", descParts.join("\n"));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
