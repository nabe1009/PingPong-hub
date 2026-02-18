"use server";

import { unstable_noStore } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TeamRow } from "@/lib/supabase/client";

/** team_members に紐づく user_profiles（JOIN で取得） */
export type TeamMemberWithProfile = {
  id: string;
  user_id: string;
  team_id: string | null;
  custom_team_name: string | null;
  custom_prefecture: string | null;
  created_at?: string;
  user_profiles: { display_name: string | null } | null;
};

/** チーム + メンバー一覧（メンバーは user_profiles.display_name 付き） */
export type TeamWithMembers = TeamRow & {
  team_members: TeamMemberWithProfile[];
};

/**
 * 主催者（ログインユーザー）が所属するチーム一覧を、
 * team_members と user_profiles を JOIN して取得する。
 * select('*, team_members(*, user_profiles(display_name))')
 */
export async function getOrganizerTeams(): Promise<
  { success: true; data: TeamWithMembers[] } | { success: false; error: string }
> {
  unstable_noStore();
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = await createSupabaseServerClient();

  const { data: myMembers, error: membersErr } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .not("team_id", "is", null);

  if (membersErr) return { success: false, error: membersErr.message };
  const teamIds = [...new Set((myMembers ?? []).map((m: { team_id: string }) => m.team_id))];
  if (teamIds.length === 0) return { success: true, data: [] };

  const { data, error } = await supabase
    .from("teams")
    .select("*, team_members(*, user_profiles(display_name))")
    .in("id", teamIds);

  if (error) return { success: false, error: error.message };

  const rows = (data ?? []) as TeamWithMembers[];
  return { success: true, data: rows };
}

/** 主催チーム（org_name_1/2/3）ごとに、そのチームを所属登録しているメンバー一覧 */
export type OrganizerTeamMembersItem = {
  label: string;
  name: string;
  members: { user_id: string; display_name: string }[];
};

/**
 * 主催者の主催チーム①②③ごとに、そのチームを「所属チーム」に登録しているユーザー一覧を取得する。
 */
export async function getOrganizerTeamMembersByOrgNames(): Promise<
  { success: true; data: OrganizerTeamMembersItem[] } | { success: false; error: string }
> {
  unstable_noStore();
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = await createSupabaseServerClient();

  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select("org_name_1, org_name_2, org_name_3")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileErr) return { success: false, error: profileErr.message };
  const row = profile as { org_name_1?: string | null; org_name_2?: string | null; org_name_3?: string | null } | null;
  const orgNames: { slot: 1 | 2 | 3; label: string; name: string }[] = [];
  if ((row?.org_name_1 ?? "").trim()) orgNames.push({ slot: 1, label: "主催チーム1", name: (row!.org_name_1 ?? "").trim() });
  if ((row?.org_name_2 ?? "").trim()) orgNames.push({ slot: 2, label: "主催チーム2", name: (row!.org_name_2 ?? "").trim() });
  if ((row?.org_name_3 ?? "").trim()) orgNames.push({ slot: 3, label: "主催チーム3", name: (row!.org_name_3 ?? "").trim() });

  if (orgNames.length === 0) return { success: true, data: [] };

  const names = orgNames.map((o) => o.name);

  // 一括取得（並列＋ループをやめてクエリ数を削減）
  const { data: teamsData } = await supabase.from("teams").select("id, name").in("name", names);
  const teamIds = (teamsData ?? []).map((t: { id: string }) => t.id);
  const teamIdToName = new Map((teamsData ?? []).map((t: { id: string; name: string }) => [t.id, t.name]));

  const [membersByTeamIdRes, membersByCustomRes] = await Promise.all([
    teamIds.length > 0
      ? supabase.from("team_members").select("user_id, team_id").in("team_id", teamIds)
      : Promise.resolve({ data: [] }),
    supabase.from("team_members").select("user_id, custom_team_name").in("custom_team_name", names),
  ]);

  const nameToUserIds = new Map<string, Set<string>>();
  for (const n of names) nameToUserIds.set(n, new Set());

  for (const m of membersByTeamIdRes.data ?? []) {
    const r = m as { user_id: string; team_id: string };
    const teamName = teamIdToName.get(r.team_id);
    if (teamName) nameToUserIds.get(teamName)?.add(r.user_id);
  }
  for (const m of membersByCustomRes.data ?? []) {
    const r = m as { user_id: string; custom_team_name: string | null };
    if (r.custom_team_name && nameToUserIds.has(r.custom_team_name)) {
      nameToUserIds.get(r.custom_team_name)!.add(r.user_id);
    }
  }

  const allUserIds = [...new Set([...nameToUserIds.values()].flatMap((s) => [...s]))];
  const { data: profiles } =
    allUserIds.length > 0
      ? await supabase.from("user_profiles").select("user_id, display_name").in("user_id", allUserIds)
      : { data: [] };
  const nameByUserId = new Map(
    (profiles ?? []).map((p: { user_id: string; display_name: string | null }) => [
      p.user_id,
      (p.display_name ?? "").trim() || "名無し",
    ])
  );

  const result: OrganizerTeamMembersItem[] = orgNames.map(({ label, name }) => {
    const userIds = nameToUserIds.get(name) ?? new Set();
    return {
      label,
      name,
      members: [...userIds].map((uid) => ({
        user_id: uid,
        display_name: nameByUserId.get(uid) ?? "名無し",
      })),
    };
  });

  return { success: true, data: result };
}
