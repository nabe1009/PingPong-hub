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
  /** 参加費（例: 500円、無料） */
  fee: string | null;
  user_id: string;
  /** 作成時の表示名（非正規化・user_profiles 結合不要） */
  display_name: string | null;
  recurrence_group_id: string | null;
  recurrence_rule_id: string | null;
  created_at: string;
};

/** recurrence_rules テーブル（繰り返し登録用） */
export type RecurrenceRuleRow = {
  id: string;
  user_id: string;
  type: "weekly" | "monthly_date" | "monthly_nth";
  day_of_week: number | null;
  nth_week: number | null;
  end_date: string;
};

/** recurrence_rules 挿入用 */
export type RecurrenceRuleInsert = {
  user_id: string;
  type: "weekly" | "monthly_date" | "monthly_nth";
  day_of_week?: number | null;
  nth_week?: number | null;
  end_date: string;
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
  /** 参加費（例: 500円、無料） */
  fee?: string | null;
  user_id: string;
  /** 作成時の表示名（非正規化） */
  display_name?: string | null;
  recurrence_group_id?: string | null;
  recurrence_rule_id?: string | null;
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
  /** 参加時の表示名（非正規化・user_profiles 結合不要） */
  display_name: string | null;
  created_at: string;
};

/** practice_comments テーブル（参加・キャンセル履歴・コメント・タイムライン表示用） */
export type PracticeCommentRow = {
  id: string;
  practice_id: string;
  user_id: string;
  type: "join" | "cancel" | "comment";
  comment: string | null;
  /** 記録時の表示名（非正規化・user_profiles 結合不要） */
  display_name: string | null;
  /** 旧カラム（display_name 未設定の既存行用・フォールバック） */
  user_name?: string | null;
  user_avatar_url: string | null;
  created_at: string;
};

/** comment_likes テーブル（コメントいいね） */
export type CommentLikeRow = {
  user_id: string;
  comment_id: string;
};

/** いいね数・自分がいいね済み・いいねした人の表示名（ホバー用） */
export type PracticeCommentWithLikes = PracticeCommentRow & {
  likes_count: number;
  is_liked_by_me: boolean;
  /** いいねした人の表示名（自分は「自分」） */
  liked_by_display_names: string[];
};

/** teams テーブル（チームマスタ） */
export type TeamRow = {
  id: string;
  name: string;
  prefecture: string;
  created_at?: string;
};

/** team_members テーブル（所属情報。team_id または custom_team_name のどちらか） */
export type TeamMemberRow = {
  id: string;
  user_id: string;
  /** 既存チームを選んだ場合 */
  team_id: string | null;
  /** 手入力の場合（team_id が null のとき） */
  custom_team_name: string | null;
  /** 手入力時の都道府県 */
  custom_prefecture: string | null;
  created_at?: string;
};

/** team_members 挿入用 */
export type TeamMemberInsert = {
  user_id: string;
  team_id?: string | null;
  custom_team_name?: string | null;
  custom_prefecture?: string | null;
};

/** 表示用：team_members + teams 結合（team_id があれば teams.name/prefecture、なければ custom_*） */
export type TeamMemberWithDisplay = TeamMemberRow & {
  display_name: string;
  display_prefecture: string;
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
  /** 主催者用：チーム名 */
  org_name_1: string | null;
  org_name_2: string | null;
  org_name_3: string | null;
  racket: string | null;
  forehand_rubber: string | null;
  backhand_rubber: string | null;
  updated_at?: string;
};
