import type { DatabaseClient } from "../database.js";
import { PASS_CODE_POLICY_VERSION, resolvePassCode } from "../pass/pass-code-resolver.js";
import type { ProfileRepository, ProfileView } from "./profile.js";

interface ProfileRow {
  player_id: bigint;
  display_name: string;
  profile_version: bigint;
  server_code: string | null;
  server_name: string | null;
  joined_at: Date | null;
  level: bigint;
  accumulated_level: bigint;
  experience: bigint;
  rebirth_count: bigint;
  terms_agreed: number;
  first_sponsor: number;
  active_title: string | null;
  title_count: bigint;
  pet_title_count: bigint;
  guild_id: bigint | null;
  guild_name: string | null;
  guild_mark: string | null;
  guild_role_code: string | null;
  pet_name: string | null;
  pet_type_code: string | null;
  pet_image_value: string | null;
  pet_experience: bigint | null;
  pet_enhancement_level: bigint | null;
  mini_pet_name: string | null;
  mini_pet_grade: string | null;
  mini_pet_grade_display: string | null;
  mini_pet_emoji: string | null;
  mini_pet_progress: bigint | null;
  mini_pet_battle_experience: bigint | null;
  home_name: string | null;
  home_likes: bigint | null;
  home_charm: bigint | null;
  home_floor_area: bigint | null;
}

const PROFILE_SELECT = `
  SELECT p.id AS player_id, pp.current_display_name AS display_name,
    pp.version AS profile_version, gs.code AS server_code, gs.display_name AS server_name,
    pp.joined_at, pp.level, pp.level + pp.accumulated_level_offset AS accumulated_level,
    pp.experience, pp.rebirth_count, pp.terms_agreed, pp.first_sponsor,
    (SELECT td.display_name FROM player_titles pt JOIN title_definitions td ON td.id = pt.title_id
      WHERE pt.player_id = p.id AND pt.equipped = TRUE ORDER BY pt.acquired_at DESC LIMIT 1) AS active_title,
    (SELECT COUNT(*) FROM player_titles pt WHERE pt.player_id = p.id) AS title_count,
    (SELECT COUNT(*) FROM pet_titles ptt JOIN player_pets ppt ON ppt.id = ptt.player_pet_id WHERE ppt.player_id = p.id) AS pet_title_count,
    g.id AS guild_id, g.display_name AS guild_name, g.mark AS guild_mark, gm.role_code AS guild_role_code,
    pet.display_name AS pet_name, pet.pet_type_code, pet.image_value AS pet_image_value, pet.experience AS pet_experience,
    pet.enhancement_level AS pet_enhancement_level,
    COALESCE(omp.custom_name, mpd.display_name) AS mini_pet_name, mpd.grade_code AS mini_pet_grade,
    mpd.grade_display_name AS mini_pet_grade_display, mpd.emoji_value AS mini_pet_emoji,
    omp.progress AS mini_pet_progress, omp.battle_experience AS mini_pet_battle_experience,
    home.display_name AS home_name, home.like_count AS home_likes,
    home.base_experience + COALESCE((SELECT SUM(fd.charm_value) FROM furniture_placements fp
      JOIN owned_furniture ofu ON ofu.id = fp.owned_furniture_id
      JOIN furniture_definitions fd ON fd.id = ofu.furniture_definition_id WHERE fp.player_id = p.id), 0) AS home_charm,
    home.floor_area AS home_floor_area
  FROM players p
  JOIN player_profiles pp ON pp.player_id = p.id
  LEFT JOIN game_servers gs ON gs.id = pp.game_server_id
  LEFT JOIN guild_members gm ON gm.player_id = p.id
  LEFT JOIN guilds g ON g.id = gm.guild_id
  LEFT JOIN player_pets pet ON pet.player_id = p.id
  LEFT JOIN owned_mini_pets omp ON omp.player_id = p.id AND omp.equipped = TRUE
  LEFT JOIN mini_pet_definitions mpd ON mpd.id = omp.mini_pet_definition_id
  LEFT JOIN player_homes home ON home.player_id = p.id`;

// DB 시간 값을 API의 UTC ISO 문자열로 변환합니다.
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

// 여러 read-model 행을 ProfileView 하나로 조립합니다.
async function hydrateProfile(database: Pick<DatabaseClient, "query">, row: ProfileRow): Promise<ProfileView> {
  const [currencies, counters, passes, ranks, badges] = await Promise.all([
    database.query<Array<{ code: string; balance: string }>>(
      "SELECT currency_code AS code, CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id = ?",
      [row.player_id]
    ),
    database.query<Array<{ code: string; value: bigint }>>(
      "SELECT CONCAT(counter_code, ':', period_key) AS code, value FROM player_counters WHERE player_id = ?",
      [row.player_id]
    ),
    database.query<Array<{ code: string; enabled: number; permanent: number; ends_at: Date | null }>>(
      "SELECT pass_code AS code, enabled, permanent, ends_at FROM player_passes WHERE player_id = ?",
      [row.player_id]
    ),
    database.query<Array<{ code: string; rank_no: bigint }>>(
      `SELECT lb.code, le.rank_no FROM leaderboard_entries le
       JOIN leaderboards lb ON lb.id = le.leaderboard_id WHERE le.player_id = ?`,
      [row.player_id]
    ),
    database.query<Array<{ badge_code: string }>>(
      `SELECT display_value AS badge_code FROM player_badge_assignments
       WHERE player_id = ? AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
         AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3)) ORDER BY priority DESC, badge_code`,
      [row.player_id]
    )
  ]);
  return {
    playerId: row.player_id.toString(),
    displayName: row.display_name,
    profileVersion: row.profile_version.toString(),
    server: row.server_code === null ? null : { code: row.server_code, displayName: row.server_name! },
    joinedAt: toIso(row.joined_at),
    level: row.level.toString(),
    accumulatedLevel: row.accumulated_level.toString(),
    experience: { current: row.experience.toString(), next: (6n * row.level + 84n).toString() },
    rebirthCount: row.rebirth_count.toString(),
    termsAgreed: Boolean(row.terms_agreed),
    firstSponsor: Boolean(row.first_sponsor),
    passes: passes.map((pass) => ({
      code: resolvePassCode({
        code: pass.code,
        sourceScope: "COMPATIBILITY",
        targetScope: "SEMANTIC",
        policyVersion: PASS_CODE_POLICY_VERSION
      }),
      enabled: Boolean(pass.enabled),
      permanent: Boolean(pass.permanent),
      endsAt: toIso(pass.ends_at)
    })),
    currencies: Object.fromEntries(currencies.map((currency) => [currency.code, currency.balance])),
    counters: Object.fromEntries(counters.map((counter) => [counter.code, counter.value.toString()])),
    activeTitle: row.active_title,
    titleCount: row.title_count.toString(),
    petTitleCount: row.pet_title_count.toString(),
    guild: row.guild_id === null ? null : { id: row.guild_id.toString(), name: row.guild_name!, mark: row.guild_mark, roleCode: row.guild_role_code! },
    pet: row.pet_name === null && row.pet_type_code === null ? null : {
      name: row.pet_name, typeCode: row.pet_type_code, imageValue: row.pet_image_value,
      experience: (row.pet_experience ?? 0n).toString(), enhancementLevel: (row.pet_enhancement_level ?? 0n).toString()
    },
    equippedMiniPet: row.mini_pet_name === null ? null : {
      name: row.mini_pet_name, emoji: row.mini_pet_emoji, gradeCode: row.mini_pet_grade,
      gradeDisplayName: row.mini_pet_grade_display, progress: (row.mini_pet_progress ?? 0n).toString(),
      battleExperience: (row.mini_pet_battle_experience ?? 0n).toString()
    },
    home: row.home_name === null && row.home_likes === null ? null : {
      name: row.home_name, likes: (row.home_likes ?? 0n).toString(), charm: (row.home_charm ?? 0n).toString(), floorArea: (row.home_floor_area ?? 0n).toString()
    },
    ranks: Object.fromEntries(ranks.map((rank) => [rank.code, rank.rank_no.toString()])),
    badges: badges.map((badge) => badge.badge_code)
  };
}

export class MariaProfileRepository implements ProfileRepository {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async findByPlayerId(playerId: string): Promise<ProfileView | null> {
    const rows = await this.database.query<ProfileRow[]>(`${PROFILE_SELECT} WHERE p.id = ? AND p.status = 'active'`, [playerId]);
    return rows[0] === undefined ? null : hydrateProfile(this.database, rows[0]);
  }

  async findByExternalIdentity(providerCode: string, externalUserId: string): Promise<ProfileView | null> {
    const rows = await this.database.query<ProfileRow[]>(
      `${PROFILE_SELECT} JOIN external_identities ei ON ei.player_id = p.id
       WHERE ei.provider_code = ? AND ei.external_user_id = ? AND ei.status = 'linked' AND p.status = 'active'`,
      [providerCode, externalUserId]
    );
    return rows[0] === undefined ? null : hydrateProfile(this.database, rows[0]);
  }

  async list(search: string | undefined, limit: number, offset: number): Promise<ProfileView[]> {
    const values: unknown[] = [];
    let where = " WHERE p.status = 'active'";
    if (search !== undefined && search !== "") {
      where += " AND (pp.current_display_name LIKE ? OR CAST(p.id AS CHAR) = ?)";
      values.push(`%${search}%`, search);
    }
    values.push(limit, offset);
    const rows = await this.database.query<ProfileRow[]>(`${PROFILE_SELECT}${where} ORDER BY p.id LIMIT ? OFFSET ?`, values);
    return Promise.all(rows.map((row) => hydrateProfile(this.database, row)));
  }

  async count(search: string | undefined): Promise<number> {
    const values: unknown[] = [];
    let where = " WHERE p.status = 'active'";
    if (search !== undefined && search !== "") {
      where += " AND (pp.current_display_name LIKE ? OR CAST(p.id AS CHAR) = ?)";
      values.push(`%${search}%`, search);
    }
    const rows = await this.database.query<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM players p JOIN player_profiles pp ON pp.player_id = p.id${where}`,
      values
    );
    return Number(rows[0]?.total ?? 0n);
  }
}
