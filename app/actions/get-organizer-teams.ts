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
    .select("org_name_1, org_name_2, org_name_3, org_prefecture_1, org_prefecture_2, org_prefecture_3")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileErr) return { success: false, error: profileErr.message };
  type ProfileRow = {
    org_name_1?: string | null;
    org_name_2?: string | null;
    org_name_3?: string | null;
    org_prefecture_1?: string | null;
    org_prefecture_2?: string | null;
    org_prefecture_3?: string | null;
  };
  const row = profile as ProfileRow | null;
  const trim = (v: string | null | undefined) => (v ?? "").trim();
  const orgSlots: { slot: 1 | 2 | 3; label: string; name: string; prefecture: string }[] = [];
  if (trim(row?.org_name_1)) {
    orgSlots.push({
      slot: 1,
      label: "主催チーム1",
      name: trim(row!.org_name_1),
      prefecture: trim(row!.org_prefecture_1),
    });
  }
  if (trim(row?.org_name_2)) {
    orgSlots.push({
      slot: 2,
      label: "主催チーム2",
      name: trim(row!.org_name_2),
      prefecture: trim(row!.org_prefecture_2),
    });
  }
  if (trim(row?.org_name_3)) {
    orgSlots.push({
      slot: 3,
      label: "主催チーム3",
      name: trim(row!.org_name_3),
      prefecture: trim(row!.org_prefecture_3),
    });
  }

  if (orgSlots.length === 0) return { success: true, data: [] };

  /** 都道府県+名前で一意キー（別県の同名チームを区別） */
  const slotKey = (p: string, n: string) => `${p}::${n}`;
  const slotKeys = new Set(orgSlots.map((o) => slotKey(o.prefecture, o.name)));

  const names = [...new Set(orgSlots.map((o) => o.name))];

  // teams: 名前が一致するものを取得し、都道府県でフィルタして slot ごとの team_id を割り当て
  const { data: teamsData } = await supabase.from("teams").select("id, name, prefecture").in("name", names);
  const teams = (teamsData ?? []) as { id: string; name: string; prefecture: string | null }[];
  const teamIdToSlotKey = new Map<string, string>();
  for (const t of teams) {
    const p = (t.prefecture ?? "").trim();
    const key = slotKey(p, t.name);
    if (slotKeys.has(key)) teamIdToSlotKey.set(t.id, key);
  }
  const teamIds = [...teamIdToSlotKey.keys()];

  const [membersByTeamIdRes, membersByCustomRes] = await Promise.all([
    teamIds.length > 0
      ? supabase.from("team_members").select("user_id, team_id").in("team_id", teamIds)
      : Promise.resolve({ data: [] }),
    names.length > 0
      ? supabase.from("team_members").select("user_id, custom_team_name, custom_prefecture").in("custom_team_name", names)
      : Promise.resolve({ data: [] }),
  ]);

  const slotKeyToUserIds = new Map<string, Set<string>>();
  for (const key of slotKeys) slotKeyToUserIds.set(key, new Set());

  for (const m of membersByTeamIdRes.data ?? []) {
    const r = m as { user_id: string; team_id: string };
    const key = teamIdToSlotKey.get(r.team_id);
    if (key) slotKeyToUserIds.get(key)?.add(r.user_id);
  }
  for (const m of membersByCustomRes.data ?? []) {
    const r = m as { user_id: string; custom_team_name: string | null; custom_prefecture: string | null } | null;
    if (!r?.custom_team_name) continue;
    const p = (r.custom_prefecture ?? "").trim();
    const key = slotKey(p, r.custom_team_name);
    if (slotKeys.has(key)) slotKeyToUserIds.get(key)?.add(r.user_id);
  }

  const allUserIds = [...new Set([...slotKeyToUserIds.values()].flatMap((s) => [...s]))];
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

  const result: OrganizerTeamMembersItem[] = orgSlots.map(({ label, name, prefecture }) => {
    const key = slotKey(prefecture, name);
    const userIds = slotKeyToUserIds.get(key) ?? new Set();
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
