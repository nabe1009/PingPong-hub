"use server";

import { currentUser } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { TeamMemberRow, TeamMemberWithDisplay, TeamRow } from "@/lib/supabase/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const MAX_TEAM_MEMBERS = 3;

/** 自分の所属チーム一覧（teams 結合で表示名・都道府県を付与） */
export async function getMyTeamMembers(): Promise<
  { success: true; data: TeamMemberWithDisplay[] } | { success: false; error: string }
> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: rows, error } = await supabase
    .from("team_members")
    .select("id, user_id, team_id, custom_team_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return { success: false, error: error.message };
  const members = (rows as TeamMemberRow[]) ?? [];

  if (members.length === 0) return { success: true, data: [] };

  const teamIds = members.map((m) => m.team_id).filter((id): id is string => id != null);
  let teamsMap: Record<string, TeamRow> = {};
  if (teamIds.length > 0) {
    const { data: teams } = await supabase.from("teams").select("id, name, prefecture").in("id", teamIds);
    const list = (teams as TeamRow[]) ?? [];
    teamsMap = Object.fromEntries(list.map((t) => [t.id, t]));
  }

  const data: TeamMemberWithDisplay[] = members.map((m) => {
    if (m.team_id && teamsMap[m.team_id]) {
      return {
        ...m,
        display_name: teamsMap[m.team_id].name,
        display_prefecture: teamsMap[m.team_id].prefecture,
      };
    }
    return {
      ...m,
      display_name: m.custom_team_name ?? "—",
      display_prefecture: "—",
    };
  });

  return { success: true, data };
}

/** 所属チーム一覧（getMyTeamMembers のエイリアス） */
export const getAffiliatedTeams = getMyTeamMembers;

/** 検索結果1件（teams 由来は id あり、主催者プロフィール由来は id なしで custom 登録用） */
export type TeamSearchResult = {
  id: string | null;
  name: string;
  prefecture: string;
};

/** 都道府県で teams と主催者プロフィール（org_name_1/2/3）を検索 */
export async function searchTeamsByPrefecture(
  prefecture: string
): Promise<{ success: true; data: TeamSearchResult[] } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const trimmed = prefecture.trim();
  if (!trimmed) return { success: true, data: [] };

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const [teamsRes, profilesRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, prefecture")
      .eq("prefecture", trimmed)
      .order("name", { ascending: true }),
    supabase
      .from("user_profiles")
      .select("org_name_1, org_name_2, org_name_3, prefecture")
      .eq("is_organizer", true)
      .eq("prefecture", trimmed),
  ]);

  if (teamsRes.error) return { success: false, error: teamsRes.error.message };
  if (profilesRes.error) return { success: false, error: profilesRes.error.message };

  const fromTeams: TeamSearchResult[] = ((teamsRes.data as TeamRow[]) ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    prefecture: t.prefecture,
  }));

  type ProfileRow = { org_name_1: string | null; org_name_2: string | null; org_name_3: string | null; prefecture: string | null };
  const profiles = (profilesRes.data as ProfileRow[]) ?? [];
  const seen = new Set<string>();
  const fromOrganizers: TeamSearchResult[] = [];
  for (const p of profiles) {
    const pref = p.prefecture ?? trimmed;
    for (const name of [p.org_name_1, p.org_name_2, p.org_name_3]) {
      const n = (name ?? "").trim();
      if (!n) continue;
      const key = `${n}::${pref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fromOrganizers.push({ id: null, name: n, prefecture: pref });
    }
  }
  fromOrganizers.sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const data: TeamSearchResult[] = [...fromTeams, ...fromOrganizers];
  return { success: true, data };
}

/** 所属を1件追加（既存チーム選択 or 手入力）。最大3件まで。 */
export async function addTeamMember(params: {
  team_id?: string | null;
  custom_team_name?: string | null;
  custom_prefecture?: string | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { count } = await supabase
    .from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_TEAM_MEMBERS) {
    return { success: false, error: `所属チームは最大${MAX_TEAM_MEMBERS}件までです。` };
  }

  const hasTeamId = params.team_id != null && params.team_id.trim() !== "";
  const hasCustom = params.custom_team_name != null && params.custom_team_name.trim() !== "";

  if (hasTeamId) {
    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("team_id", params.team_id!.trim())
      .maybeSingle();
    if (existing) {
      return { success: false, error: "このチームはすでに登録済みです。" };
    }
    const { error: insertError } = await supabase.from("team_members").insert({
      user_id: user.id,
      team_id: params.team_id!.trim(),
      custom_team_name: null,
    });
    if (insertError) return { success: false, error: insertError.message };
    return { success: true };
  }

  if (hasCustom) {
    const customName = params.custom_team_name!.trim();
    const { error: insertError } = await supabase.from("team_members").insert({
      user_id: user.id,
      team_id: null,
      custom_team_name: customName,
    });
    if (insertError) return { success: false, error: insertError.message };
    return { success: true };
  }

  return { success: false, error: "チームを選択するか、名前と都道府県を入力してください。" };
}

/**
 * 主催チーム①②③だけを user_profiles に保存し、所属チームにも同期する。
 * プロフィール未作成の場合は行を新規作成（他項目は null のまま）。
 */
export async function saveOrganizerTeamsOnly(params: {
  is_organizer: boolean;
  org_name_1: string;
  org_name_2: string;
  org_name_3: string;
}): Promise<
  { success: true; added: number } | { success: false; error: string }
> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  if (params.is_organizer && !(params.org_name_1 ?? "").trim()) {
    return { success: false, error: "主催チーム①を入力してください。" };
  }

  const is_organizer = !!params.is_organizer;
  const org_name_1 = (params.org_name_1 ?? "").trim() || null;
  const org_name_2 = (params.org_name_2 ?? "").trim() || null;
  const org_name_3 = (params.org_name_3 ?? "").trim() || null;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: updated, error: updateError } = await supabase
    .from("user_profiles")
    .update({
      is_organizer,
      org_name_1,
      org_name_2,
      org_name_3,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select("user_id");

  if (updateError) return { success: false, error: updateError.message };

  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabase.from("user_profiles").insert({
      user_id: user.id,
      is_organizer,
      org_name_1,
      org_name_2,
      org_name_3,
    });
    if (insertError) return { success: false, error: insertError.message };
  }

  const syncRes = await syncOrganizerTeamsToTeamMembers();
  if (!syncRes.success) return syncRes;
  return { success: true, added: syncRes.added };
}

/**
 * 主催者プロフィールの主催チーム①②③を、所属チーム（team_members）に自動で1件ずつ追加する。
 * 既に同じ名前で登録済みの場合はスキップ。最大3件を超えないようにする。
 */
export async function syncOrganizerTeamsToTeamMembers(): Promise<
  { success: true; added: number } | { success: false; error: string }
> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("is_organizer, org_name_1, org_name_2, org_name_3")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) return { success: false, error: profileError?.message ?? "プロフィールを取得できませんでした。" };
  const row = profile as { is_organizer?: boolean; org_name_1?: string | null; org_name_2?: string | null; org_name_3?: string | null };
  if (!row.is_organizer) return { success: true, added: 0 };

  const orgNames = [row.org_name_1, row.org_name_2, row.org_name_3]
    .map((n) => (n ?? "").trim())
    .filter(Boolean);
  if (orgNames.length === 0) return { success: true, added: 0 };

  const { data: members, error: membersError } = await supabase
    .from("team_members")
    .select("id, team_id, custom_team_name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (membersError) return { success: false, error: membersError.message };
  const list = (members as { id: string; team_id: string | null; custom_team_name: string | null }[]) ?? [];
  const currentCount = list.length;
  const existingCustomNames = new Set(list.map((m) => (m.custom_team_name ?? "").trim()).filter(Boolean));

  const teamIds = list.map((m) => m.team_id).filter((id): id is string => id != null && id.trim() !== "");
  let existingTeamNames = new Set<string>();
  if (teamIds.length > 0) {
    const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
    const teamsList = (teams as { id: string; name: string }[]) ?? [];
    teamsList.forEach((t) => existingTeamNames.add((t.name ?? "").trim()));
  }

  let added = 0;
  for (const name of orgNames) {
    if (existingCustomNames.has(name) || existingTeamNames.has(name)) continue;
    if (currentCount + added >= MAX_TEAM_MEMBERS) break;

    const { error: insertError } = await supabase.from("team_members").insert({
      user_id: user.id,
      team_id: null,
      custom_team_name: name,
    });
    if (!insertError) {
      added++;
      existingCustomNames.add(name);
    }
  }

  return { success: true, added };
}

/** 所属を1件削除 */
export async function deleteTeamMember(id: string): Promise<{ success: true } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** 所属を1件削除（deleteTeamMember のエイリアス） */
export const removeTeamMember = deleteTeamMember;
