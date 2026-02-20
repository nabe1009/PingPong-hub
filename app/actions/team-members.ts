"use server";

import { revalidatePath, unstable_noStore } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TeamMemberRow, TeamMemberWithDisplay, TeamRow } from "@/lib/supabase/client";

const MAX_TEAM_MEMBERS = 3;

/** 自分の所属チーム一覧（teams 結合で表示名・都道府県を付与） */
export async function getMyTeamMembers(): Promise<
  { success: true; data: TeamMemberWithDisplay[] } | { success: false; error: string }
> {
  unstable_noStore();
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("team_members")
    .select("id, user_id, team_id, custom_team_name, custom_prefecture, created_at")
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
      display_prefecture: (m.custom_prefecture ?? "").trim() || "—",
    };
  });

  return { success: true, data };
}

/** 所属チーム一覧（getMyTeamMembers のエイリアス） */
export const getAffiliatedTeams = getMyTeamMembers;

/**
 * 指定ユーザーの所属チーム表示名一覧（他ユーザーのプロフィール表示用）。
 * team_members + teams から取得し、teams.name または custom_team_name を返す。
 */
export async function getTeamMembersForUser(
  userId: string
): Promise<{ success: true; data: string[] } | { success: false; error: string }> {
  unstable_noStore();
  if (!userId.trim()) return { success: true, data: [] };

  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("team_members")
    .select("team_id, custom_team_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return { success: false, error: error.message };
  const members = (rows as { team_id: string | null; custom_team_name: string | null }[]) ?? [];
  if (members.length === 0) return { success: true, data: [] };

  const teamIds = members.map((m) => m.team_id).filter((id): id is string => id != null && id.trim() !== "");
  let teamsMap: Record<string, string> = {};
  if (teamIds.length > 0) {
    const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
    const list = (teams as { id: string; name: string }[]) ?? [];
    teamsMap = Object.fromEntries(list.map((t) => [t.id, t.name]));
  }

  const displayNames = members.map((m) => {
    if (m.team_id && teamsMap[m.team_id]) return teamsMap[m.team_id];
    return (m.custom_team_name ?? "").trim() || "—";
  });

  return { success: true, data: displayNames };
}

/**
 * 複数ユーザーの所属チーム（team_id 一覧・チーム名一覧・都道府県+名前キー）を取得。
 * 参加予定メンバーの「チーム／外部」表示用。別都道府県の同名チームは区別する。
 */
export async function getTeamMembershipsByUserIds(
  userIds: string[]
): Promise<
  | { success: true; data: Record<string, { teamIds: string[]; teamNames: string[]; teamPrefectureNameKeys: string[] }> }
  | { success: false; error: string }
> {
  unstable_noStore();
  const unique = [...new Set(userIds.filter((id) => id != null && String(id).trim() !== ""))];
  if (unique.length === 0) return { success: true, data: {} };

  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("team_members")
    .select("user_id, team_id, custom_team_name, custom_prefecture")
    .in("user_id", unique);

  if (error) return { success: false, error: error.message };
  const list = (rows as {
    user_id: string;
    team_id: string | null;
    custom_team_name: string | null;
    custom_prefecture: string | null;
  }[]) ?? [];

  const teamIdsFromRows = list.map((r) => r.team_id).filter((id): id is string => id != null && id.trim() !== "");
  let teamsMap: Record<string, { name: string; prefecture: string }> = {};
  if (teamIdsFromRows.length > 0) {
    const { data: teams } = await supabase.from("teams").select("id, name, prefecture").in("id", [...new Set(teamIdsFromRows)]);
    const teamsList = (teams as { id: string; name: string; prefecture: string | null }[]) ?? [];
    teamsMap = Object.fromEntries(
      teamsList.map((t) => [t.id, { name: (t.name ?? "").trim(), prefecture: (t.prefecture ?? "").trim() }])
    );
  }

  const key = (pref: string, name: string) => `${(pref ?? "").trim()}\t${(name ?? "").trim()}`;
  const data: Record<string, { teamIds: string[]; teamNames: string[]; teamPrefectureNameKeys: string[] }> = {};
  for (const uid of unique) data[uid] = { teamIds: [], teamNames: [], teamPrefectureNameKeys: [] };
  for (const r of list) {
    const tid = r.team_id != null && r.team_id.trim() !== "" ? r.team_id.trim() : null;
    const name = tid ? (teamsMap[tid]?.name ?? "").trim() : (r.custom_team_name ?? "").trim();
    const pref = tid ? (teamsMap[tid]?.prefecture ?? "").trim() : (r.custom_prefecture ?? "").trim();
    if (tid) data[r.user_id].teamIds.push(tid);
    if (name) data[r.user_id].teamNames.push(name);
    if (name) data[r.user_id].teamPrefectureNameKeys.push(key(pref, name));
  }
  return { success: true, data };
}

/** 検索結果1件（teams テーブルのチームのみ） */
export type TeamSearchResult = {
  id: string;
  name: string;
  prefecture: string;
};

/** 都道府県で teams テーブルのチームのみ検索（既存チームからのみ選択） */
export async function searchTeamsByPrefecture(
  prefecture: string
): Promise<{ success: true; data: TeamSearchResult[] } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const trimmed = prefecture.trim();
  if (!trimmed) return { success: true, data: [] };

  const supabase = await createSupabaseServerClient();
  const { data: teamsData, error } = await supabase
    .from("teams")
    .select("id, name, prefecture")
    .eq("prefecture", trimmed)
    .order("name", { ascending: true });

  if (error) return { success: false, error: error.message };
  const data: TeamSearchResult[] = ((teamsData as TeamRow[]) ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    prefecture: t.prefecture,
  }));
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

  const supabase = await createSupabaseServerClient();
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
    const teamId = params.team_id!.trim();
    const { data: existingByTeamId } = await supabase
      .from("team_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("team_id", teamId)
      .maybeSingle();
    if (existingByTeamId) {
      return { success: false, error: "このチームはすでに登録済みです。" };
    }
    /* 同じチームを custom_team_name + custom_prefecture で既に持っている場合も重複とする（主催チーム同期の残りなど） */
    const { data: teamRow } = await supabase.from("teams").select("name, prefecture").eq("id", teamId).maybeSingle();
    const team = teamRow as { name: string; prefecture: string } | null;
    if (team?.name != null) {
      const { data: existingRows } = await supabase
        .from("team_members")
        .select("id, custom_team_name, custom_prefecture")
        .eq("user_id", user.id)
        .is("team_id", null);
      const rows = (existingRows ?? []) as { id: string; custom_team_name: string | null; custom_prefecture: string | null }[];
      const pref = (team.prefecture ?? "").trim();
      const name = (team.name ?? "").trim();
      const alreadyHasSame = rows.some(
        (r) =>
          (r.custom_team_name ?? "").trim() === name &&
          ((r.custom_prefecture ?? "").trim() === pref || (!(r.custom_prefecture ?? "").trim() && !pref))
      );
      if (alreadyHasSame) {
        return { success: false, error: "このチームはすでに登録済みです。" };
      }
    }
    const { error: insertError } = await supabase.from("team_members").insert({
      user_id: user.id,
      team_id: teamId,
      custom_team_name: null,
      custom_prefecture: null,
    });
    if (insertError) return { success: false, error: insertError.message };
    revalidatePath("/account");
    return { success: true };
  }

  if (hasCustom) {
    const customName = params.custom_team_name!.trim();
    const customPref = (params.custom_prefecture ?? "").trim();
    const { data: existingList } = await supabase
      .from("team_members")
      .select("id, team_id, custom_team_name, custom_prefecture")
      .eq("user_id", user.id);
    const list = (existingList ?? []) as { id: string; team_id: string | null; custom_team_name: string | null; custom_prefecture: string | null }[];
    const hasSameCustom = list.some(
      (r) =>
        (r.custom_team_name ?? "").trim() === customName &&
        ((r.custom_prefecture ?? "").trim() === customPref || (!(r.custom_prefecture ?? "").trim() && !customPref))
    );
    if (hasSameCustom) {
      return { success: false, error: "このチームはすでに登録済みです。" };
    }
    const { data: sameTeamByTeamId } = await supabase.from("teams").select("id").eq("name", customName).eq("prefecture", customPref || "").limit(1).maybeSingle();
    const sameTeam = sameTeamByTeamId as { id: string } | null;
    if (sameTeam?.id && list.some((r) => r.team_id === sameTeam.id)) {
      return { success: false, error: "このチームはすでに登録済みです。" };
    }
    const { error: insertError } = await supabase.from("team_members").insert({
      user_id: user.id,
      team_id: null,
      custom_team_name: customName,
      custom_prefecture: customPref || null,
    });
    if (insertError) return { success: false, error: insertError.message };
    revalidatePath("/account");
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
  org_prefecture_1: string;
  org_prefecture_2: string;
  org_prefecture_3: string;
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
  const org_prefecture_1 = (params.org_prefecture_1 ?? "").trim() || null;
  const org_prefecture_2 = (params.org_prefecture_2 ?? "").trim() || null;
  const org_prefecture_3 = (params.org_prefecture_3 ?? "").trim() || null;

  const supabase = await createSupabaseServerClient();

  /* 同じ都道府県＋同じチーム名の主催者が他にいればエラー（チームごとの都道府県で判定） */
  if (is_organizer) {
    const myPairs: { pref: string; name: string }[] = [];
    [
      [org_prefecture_1 ?? "", org_name_1 ?? ""],
      [org_prefecture_2 ?? "", org_name_2 ?? ""],
      [org_prefecture_3 ?? "", org_name_3 ?? ""],
    ].forEach(([pref, name]) => {
      if (name) myPairs.push({ pref: pref || "", name });
    });
    if (myPairs.length > 0) {
      const { data: existing } = await supabase
        .from("user_profiles")
        .select("user_id, org_name_1, org_name_2, org_name_3, org_prefecture_1, org_prefecture_2, org_prefecture_3")
        .eq("is_organizer", true)
        .neq("user_id", user.id);
      const rows = (existing as {
        user_id: string;
        org_name_1: string | null;
        org_name_2: string | null;
        org_name_3: string | null;
        org_prefecture_1: string | null;
        org_prefecture_2: string | null;
        org_prefecture_3: string | null;
      }[] | null) ?? [];
      const otherPairs = new Set<string>();
      const namesWithEmptyPrefecture = new Set<string>();
      for (const r of rows) {
        [
          [(r.org_prefecture_1 ?? "").trim(), (r.org_name_1 ?? "").trim()],
          [(r.org_prefecture_2 ?? "").trim(), (r.org_name_2 ?? "").trim()],
          [(r.org_prefecture_3 ?? "").trim(), (r.org_name_3 ?? "").trim()],
        ].forEach(([pref, name]) => {
          if (name) {
            otherPairs.add(`${pref}\t${name}`);
            if (!pref) namesWithEmptyPrefecture.add(name);
          }
        });
      }
      const conflict = myPairs.some(
        (p) => otherPairs.has(`${p.pref}\t${p.name}`) || namesWithEmptyPrefecture.has(p.name)
      );
      if (conflict) {
        return { success: false, error: "同じ都道府県に同じ主催チームがすでに登録されています。問い合わせてください。" };
      }
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("user_profiles")
    .update({
      is_organizer,
      org_name_1,
      org_name_2,
      org_name_3,
      org_prefecture_1,
      org_prefecture_2,
      org_prefecture_3,
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
      org_prefecture_1,
      org_prefecture_2,
      org_prefecture_3,
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

  const supabase = await createSupabaseServerClient();

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("is_organizer, org_name_1, org_name_2, org_name_3, org_prefecture_1, org_prefecture_2, org_prefecture_3")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) return { success: false, error: profileError?.message ?? "プロフィールを取得できませんでした。" };
  const row = profile as {
    is_organizer?: boolean;
    org_name_1?: string | null;
    org_name_2?: string | null;
    org_name_3?: string | null;
    org_prefecture_1?: string | null;
    org_prefecture_2?: string | null;
    org_prefecture_3?: string | null;
  };
  if (!row.is_organizer) return { success: true, added: 0 };

  const orgPairs: { prefecture: string; name: string }[] = [
    [(row.org_prefecture_1 ?? "").trim(), (row.org_name_1 ?? "").trim()],
    [(row.org_prefecture_2 ?? "").trim(), (row.org_name_2 ?? "").trim()],
    [(row.org_prefecture_3 ?? "").trim(), (row.org_name_3 ?? "").trim()],
  ]
    .filter(([, name]) => name !== "")
    .map(([prefecture, name]) => ({ prefecture: prefecture || "", name }));

  if (orgPairs.length === 0) return { success: true, added: 0 };

  const { data: members, error: membersError } = await supabase
    .from("team_members")
    .select("id, team_id, custom_team_name, custom_prefecture")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (membersError) return { success: false, error: membersError.message };
  const list = (members as { id: string; team_id: string | null; custom_team_name: string | null; custom_prefecture: string | null }[]) ?? [];
  const currentCount = list.length;
  const existingCustomKey = new Set(
    list
      .filter((m) => (m.custom_team_name ?? "").trim())
      .map((m) => `${(m.custom_prefecture ?? "").trim()}\t${(m.custom_team_name ?? "").trim()}`)
  );

  const teamIds = list.map((m) => m.team_id).filter((id): id is string => id != null && id.trim() !== "");
  const existingTeamKeys = new Set<string>();
  if (teamIds.length > 0) {
    const { data: teams } = await supabase.from("teams").select("id, name, prefecture").in("id", teamIds);
    const teamsList = (teams as { id: string; name: string; prefecture: string }[]) ?? [];
    teamsList.forEach((t) => existingTeamKeys.add(`${(t.prefecture ?? "").trim()}\t${(t.name ?? "").trim()}`));
  }

  const namesWithEmptyPrefecture = new Set(
    list.filter((m) => (m.custom_team_name ?? "").trim() && !(m.custom_prefecture ?? "").trim()).map((m) => (m.custom_team_name ?? "").trim())
  );

  const existingTeamIdSet = new Set(teamIds);
  let teamsMap: Record<string, string> = {};
  if (teamIds.length > 0) {
    const { data: teamsData } = await supabase.from("teams").select("id, name, prefecture").in("id", teamIds);
    const teamsList = (teamsData as { id: string; name: string; prefecture: string }[]) ?? [];
    teamsList.forEach((t) => {
      teamsMap[`${(t.prefecture ?? "").trim()}\t${(t.name ?? "").trim()}`] = t.id;
    });
  }

  let added = 0;
  for (const { prefecture, name } of orgPairs) {
    const key = `${prefecture}\t${name}`;
    if (existingTeamIdSet.has(teamsMap[key] ?? "")) continue;

    const getOrCreateTeamId = async (): Promise<string> => {
      if (teamsMap[key]) return teamsMap[key];
      const { data: existingTeam } = await supabase.from("teams").select("id").eq("name", name).eq("prefecture", prefecture || "").limit(1).maybeSingle();
      const existing = existingTeam as { id: string } | null;
      if (existing?.id) {
        teamsMap[key] = existing.id;
        return existing.id;
      }
      const { data: inserted, error: insertTeamErr } = await supabase.from("teams").insert({ name, prefecture: prefecture || "" }).select("id").single();
      if (insertTeamErr) throw new Error(insertTeamErr.message);
      const id = (inserted as { id: string }).id;
      teamsMap[key] = id;
      return id;
    };

    if (existingCustomKey.has(key)) {
      const customRow = list.find((m) => (m.custom_prefecture ?? "").trim() === prefecture && (m.custom_team_name ?? "").trim() === name);
      if (customRow) {
        try {
          const teamId = await getOrCreateTeamId();
          const { error: updateErr } = await supabase
            .from("team_members")
            .update({ team_id: teamId, custom_team_name: null, custom_prefecture: null })
            .eq("id", customRow.id)
            .eq("user_id", user.id);
          if (!updateErr) {
            added++;
            existingTeamIdSet.add(teamId);
          }
        } catch (_e) {
          return { success: false, error: _e instanceof Error ? _e.message : "チームの取得に失敗しました。" };
        }
      }
      continue;
    }
    if (namesWithEmptyPrefecture.has(name)) {
      const legacyRow = list.find((m) => (m.custom_team_name ?? "").trim() === name && !(m.custom_prefecture ?? "").trim());
      if (legacyRow) {
        try {
          const teamId = await getOrCreateTeamId();
          const { error: updateErr } = await supabase
            .from("team_members")
            .update({ team_id: teamId, custom_team_name: null, custom_prefecture: null })
            .eq("id", legacyRow.id)
            .eq("user_id", user.id);
          if (!updateErr) {
            added++;
            existingTeamIdSet.add(teamId);
            existingCustomKey.add(key);
            namesWithEmptyPrefecture.delete(name);
          }
        } catch (_e) {
          return { success: false, error: _e instanceof Error ? _e.message : "チームの取得に失敗しました。" };
        }
      }
      continue;
    }
    if (currentCount + added >= MAX_TEAM_MEMBERS) break;

    let teamId: string;
    try {
      teamId = await getOrCreateTeamId();
    } catch (_e) {
      return { success: false, error: _e instanceof Error ? _e.message : "チームの取得に失敗しました。" };
    }

    const { error: insertError } = await supabase.from("team_members").insert({
      user_id: user.id,
      team_id: teamId,
      custom_team_name: null,
      custom_prefecture: null,
    });
    if (!insertError) {
      added++;
      existingTeamIdSet.add(teamId);
      existingCustomKey.add(key);
    }
  }

  return { success: true, added };
}

/** 所属を1件削除 */
export async function deleteTeamMember(id: string): Promise<{ success: true } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) {
    return { success: false, error: "削除対象が見つかりませんでした。画面を更新してやり直してください。" };
  }
  revalidatePath("/account");
  return { success: true };
}

/**
 * 同じ表示名の所属チームをすべて削除（重複登録を一括解除）。
 * 表示名は teams.name または custom_team_name。
 */
export async function deleteTeamMembersByDisplayName(
  displayName: string
): Promise<{ success: true; deleted: number } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const trimmed = (displayName ?? "").trim();
  if (!trimmed) return { success: false, error: "チーム名を指定してください。" };

  const res = await getMyTeamMembers();
  if (!res.success) return res;
  const members = res.data.filter((m) => (m.display_name ?? "").trim() === trimmed);
  if (members.length === 0) {
    return { success: false, error: "削除対象が見つかりませんでした。" };
  }

  const supabase = await createSupabaseServerClient();
  let deleted = 0;
  for (const m of members) {
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("id", m.id)
      .eq("user_id", user.id);
    if (!error) deleted++;
  }
  revalidatePath("/account");
  return { success: true, deleted };
}

/**
 * 所属チームを洗い替え：このユーザーの team_members を全削除し、送られたリストで一括 INSERT。
 * 画面に残っているものだけが保存される。
 */
export async function replaceAffiliatedTeams(
  teams: { team_id?: string | null; custom_team_name?: string | null }[]
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user?.id) return { success: false, error: "ログインしてください。" };

  const list = teams.slice(0, MAX_TEAM_MEMBERS).filter((t) => {
    const hasId = t.team_id != null && String(t.team_id).trim() !== "";
    const hasCustom = t.custom_team_name != null && String(t.custom_team_name).trim() !== "";
    return hasId || hasCustom;
  });

  const supabase = await createSupabaseServerClient();

  const { error: deleteError } = await supabase
    .from("team_members")
    .delete()
    .eq("user_id", user.id);

  if (deleteError) return { success: false, error: deleteError.message };

  if (list.length === 0) {
    revalidatePath("/account");
    return { success: true };
  }

  const rows = list.map((t) => ({
    user_id: user.id,
    team_id: (t.team_id != null && String(t.team_id).trim() !== "" ? String(t.team_id).trim() : null) as string | null,
    custom_team_name:
      t.custom_team_name != null && String(t.custom_team_name).trim() !== "" ? String(t.custom_team_name).trim() : null,
  }));

  const { error: insertError } = await supabase.from("team_members").insert(rows);
  if (insertError) return { success: false, error: insertError.message };

  revalidatePath("/account");
  return { success: true };
}

/** 所属を1件削除（deleteTeamMember のエイリアス） */
export const removeTeamMember = deleteTeamMember;
