"use server";

import { unstable_noStore } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { TeamRow } from "@/lib/supabase/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

  const result: OrganizerTeamMembersItem[] = [];

  for (const { label, name } of orgNames) {
    const userIds = new Set<string>();

    const { data: teamsByName } = await supabase.from("teams").select("id").eq("name", name);
    const teamIds = (teamsByName ?? []).map((t: { id: string }) => t.id);

    if (teamIds.length > 0) {
      const { data: byTeamId } = await supabase
        .from("team_members")
        .select("user_id")
        .in("team_id", teamIds);
      (byTeamId ?? []).forEach((m: { user_id: string }) => userIds.add(m.user_id));
    }

    const { data: byCustomName } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("custom_team_name", name);
    (byCustomName ?? []).forEach((m: { user_id: string }) => userIds.add(m.user_id));

    if (userIds.size === 0) {
      result.push({ label, name, members: [] });
      continue;
    }

    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", [...userIds]);
    const nameByUserId = new Map(
      (profiles ?? []).map((p: { user_id: string; display_name: string | null }) => [
        p.user_id,
        (p.display_name ?? "").trim() || "名無し",
      ])
    );
    result.push({
      label,
      name,
      members: [...userIds].map((uid) => ({
        user_id: uid,
        display_name: nameByUserId.get(uid) ?? "名無し",
      })),
    });
  }

  return { success: true, data: result };
}
