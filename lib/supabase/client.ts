import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** prefectures_cities テーブルの行（県と市） */
export type PrefectureCityRow = {
  id?: number;
  prefecture: string;
  city: string;
};

/** practices テーブルの行（DB カラム名: event_date, max_participants, conditions, user_id） */
export type PracticeRow = {
  id: string;
  team_name: string;
  prefecture: string | null;
  city: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  content: string | null;
  level: string | null;
  conditions: string | null;
  user_id: string;
  recurrence_group_id: string | null;
  created_at: string;
};

/** practices 挿入用（id, created_at は自動） */
export type PracticeInsert = {
  team_name: string;
  prefecture?: string | null;
  city?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  content: string | null;
  level: string | null;
  conditions: string | null;
  user_id: string;
  recurrence_group_id?: string | null;
};

/** practice_members テーブル（参加者・一言コメント） */
export type PracticeMemberRow = {
  id: string;
  practice_id: string;
  user_id: string;
  comment: string;
  created_at: string;
};

/** signups テーブル（参加者管理・定員計算用） */
export type SignupRow = {
  id: string;
  practice_id: string;
  user_id: string;
  created_at: string;
};

/** practice_comments テーブル（参加・キャンセル履歴・タイムライン表示用） */
export type PracticeCommentRow = {
  id: string;
  practice_id: string;
  user_id: string;
  type: "join" | "cancel";
  comment: string | null;
  user_name: string | null;
  user_avatar_url: string | null;
  created_at: string;
};

/** user_profiles テーブル（プロフィール・使用用具・user_id は Clerk の userId） */
export type UserProfileRow = {
  user_id: string;
  display_name: string | null;
  prefecture: string | null;
  /** 一般用：所属/チーム名 */
  affiliation: string | null;
  career: string | null;
  play_style: string | null;
  dominant_hand: string | null;
  achievements: string | null;
  is_organizer: boolean;
  /** 主催者用：チーム名 / 卓球場 / 個人名 */
  org_name_1: string | null;
  org_name_2: string | null;
  org_name_3: string | null;
  racket: string | null;
  forehand_rubber: string | null;
  backhand_rubber: string | null;
  updated_at?: string;
};
