import { createClient } from "@supabase/supabase-js";
import type { PracticeRow, SignupRow } from "@/lib/supabase/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * RLS をバイパスする管理者用クライアント。
 * サーバー専用。カレンダーフィード等、トークンでユーザーを特定する API で使用。
 * 環境変数 SUPABASE_SERVICE_ROLE_KEY が必要。
 */
export function createSupabaseAdminClient() {
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}
