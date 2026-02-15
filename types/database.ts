/**
 * DB スキーマ用の型定義（teams / team_members など）
 * 実体は lib/supabase/client.ts にあり、ここから re-export する。
 */
export type {
  TeamRow,
  TeamMemberRow,
  TeamMemberInsert,
  TeamMemberWithDisplay,
} from "@/lib/supabase/client";
