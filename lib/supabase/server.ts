import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Server Action 等で使う Supabase クライアント。
 * Clerk の JWT（getToken({ template: 'supabase' })）を Authorization ヘッダーに付与するので、
 * RLS で auth.jwt() ->> 'sub' が Clerk の user id として使えます。
 */
export async function createSupabaseServerClient() {
  const { getToken } = await auth();
  const token = await getToken({ template: "supabase" });

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  });
}
