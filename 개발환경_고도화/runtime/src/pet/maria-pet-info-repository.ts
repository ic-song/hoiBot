import type { DatabaseClient } from "../database.js";
import type { PetInfoRepository, PetInfoView } from "./pet-info.js";

interface PetInfoRow {
  player_id: bigint; display_name: string; tier_code: string | null;
  pet_name: string; pet_type_code: string | null; pet_type_name: string | null; pet_image: string | null; personality: string | null;
  pet_experience: bigint; pet_enhancement: bigint; title_name: string | null;
  elemental_name: string | null; elemental_grade: string | null; elemental_enhancement: bigint | null;
  elemental_raid_charm: bigint | null; elemental_castle_charm: bigint | null;
  pendant_name: string | null; pendant_grade: string | null; pendant_durability: bigint | null; pendant_max_durability: bigint | null;
  pendant_enhancement: bigint | null; pendant_raid_charm: bigint | null; pendant_castle_charm: bigint | null;
  mini_name: string | null; mini_emoji: string | null; mini_grade: string | null; mini_battle_charm: bigint | null;
  mini_raid_charm: bigint | null; mini_castle_charm: bigint | null; mini_enhancement: bigint | null;
  home_name: string | null; home_charm: bigint | string | null; home_floor: bigint | null;
  intimacy_level: bigint | null; intimacy_progress: bigint | null; intimacy_charm: bigint | null;
  equipped_skill_count: bigint; intro_skill_count: bigint; base_pass_count: bigint; premium_pass_count: bigint;
  cube_castle: string | null; cube_raid: string | null; cube_pet_upgrade: string | null;
  tower_attempts: bigint | null; tower_floor: bigint | null; castle_attempts: bigint | null; castle_score: bigint | null; castle_rank: string | null;
  mini_attempts: bigint | null; mini_wins: bigint | null; mini_losses: bigint | null;
  explore_attempts: bigint | null; explore_wins: bigint | null; explore_losses: bigint | null;
  daily_rewarded: number | null; weekly_count: bigint | null; pet_home_comment_count: bigint | null; feed_post_count: bigint | null; home_alert_open_count: bigint | null;
}

// 펫정보 계산에 필요한 정규화 projection을 한 회원 단위로 조회합니다.
export class MariaPetInfoRepository implements PetInfoRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findByExternalIdentity(providerCode: string, externalUserId: string): Promise<PetInfoView | null> {
    const rows = await this.database.query<PetInfoRow[]>(
      `SELECT p.id AS player_id, profile.current_display_name AS display_name, profile.tier_code,
         pet.display_name AS pet_name, pet.pet_type_code, definition_row.display_name AS pet_type_name,
         pet.image_value AS pet_image, pet.personality_label AS personality, pet.experience AS pet_experience,
         pet.enhancement_level AS pet_enhancement,
         (SELECT title.display_name FROM pet_titles assignment JOIN title_definitions title ON title.id = assignment.title_id
           WHERE assignment.player_pet_id = pet.id AND assignment.equipped = TRUE LIMIT 1) AS title_name,
         elemental.display_name AS elemental_name, elemental.grade_display_name AS elemental_grade,
         elemental.enhancement_level AS elemental_enhancement, elemental.raid_charm AS elemental_raid_charm,
         elemental.castle_charm AS elemental_castle_charm,
         pendant.display_name AS pendant_name, pendant.grade_display_name AS pendant_grade,
         pendant.durability AS pendant_durability, pendant.max_durability AS pendant_max_durability,
         pendant.enhancement_level AS pendant_enhancement, pendant.raid_charm AS pendant_raid_charm,
         pendant.castle_charm AS pendant_castle_charm,
         COALESCE(mini.custom_name, mini_definition.display_name) AS mini_name, mini_definition.emoji_value AS mini_emoji,
         mini_definition.grade_display_name AS mini_grade, mini.battle_experience AS mini_battle_charm,
         mini.raid_experience AS mini_raid_charm, mini.castle_experience AS mini_castle_charm,
         mini.enhancement_level AS mini_enhancement,
         home.display_name AS home_name,
         COALESCE(home.base_experience, 0) + COALESCE((SELECT SUM(definition_row2.charm_value)
           FROM furniture_placements placement JOIN owned_furniture owned ON owned.id = placement.owned_furniture_id
           JOIN furniture_definitions definition_row2 ON definition_row2.id = owned.furniture_definition_id
           WHERE placement.player_id = p.id), 0) AS home_charm,
         home.floor_area AS home_floor, intimacy.intimacy_level, intimacy.progress AS intimacy_progress,
         intimacy.charm AS intimacy_charm,
         (SELECT COUNT(*) FROM pet_skills skill_row WHERE skill_row.player_pet_id = pet.id AND skill_row.equipped = TRUE) AS equipped_skill_count,
         (SELECT COUNT(*) FROM pet_skills skill_row JOIN skill_definitions skill_definition ON skill_definition.id = skill_row.skill_id
           WHERE skill_row.player_pet_id = pet.id AND skill_row.equipped = TRUE AND skill_definition.display_name = '펫스킬 학개론') AS intro_skill_count,
         (SELECT COUNT(*) FROM player_passes pass_row WHERE pass_row.player_id = p.id AND pass_row.enabled = TRUE
           AND pass_row.pass_code IN ('support', 'beginner') AND (pass_row.permanent = TRUE OR pass_row.ends_at >= UTC_TIMESTAMP(3))) AS base_pass_count,
         (SELECT COUNT(*) FROM player_passes pass_row WHERE pass_row.player_id = p.id AND pass_row.enabled = TRUE
           AND pass_row.pass_code = 'premium' AND (pass_row.permanent = TRUE OR pass_row.ends_at >= UTC_TIMESTAMP(3))) AS premium_pass_count,
         cube.castle_percent AS cube_castle, cube.raid_percent AS cube_raid, cube.pet_upgrade_percent AS cube_pet_upgrade,
         daily.tower_attempts, daily.tower_floor, daily.castle_battle_attempts AS castle_attempts,
         daily.castle_battle_score AS castle_score, daily.castle_rank_label AS castle_rank,
         daily.mini_battle_attempts AS mini_attempts, daily.mini_battle_wins AS mini_wins,
         daily.mini_battle_losses AS mini_losses, daily.explore_attempts, daily.explore_wins, daily.explore_losses,
         daily.daily_quest_rewarded AS daily_rewarded, daily.weekly_quest_count AS weekly_count,
         daily.pet_home_comment_count, daily.feed_post_count, daily.home_alert_open_count
       FROM external_identities identity_row JOIN players p ON p.id = identity_row.player_id
       JOIN player_profiles profile ON profile.player_id = p.id JOIN player_pets pet ON pet.player_id = p.id
       LEFT JOIN pet_definitions definition_row ON definition_row.code = pet.pet_type_code
       LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id = pet.id
       LEFT JOIN player_pet_pendants pendant ON pendant.player_pet_id = pet.id
       LEFT JOIN owned_mini_pets mini ON mini.player_id = p.id AND mini.equipped = TRUE
       LEFT JOIN mini_pet_definitions mini_definition ON mini_definition.id = mini.mini_pet_definition_id
       LEFT JOIN player_homes home ON home.player_id = p.id LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id = pet.id
       LEFT JOIN player_home_badge_cubes cube ON cube.player_id = p.id AND cube.equipped = TRUE
       LEFT JOIN player_pet_daily_records daily ON daily.player_id = p.id
         AND daily.record_date = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR))
       WHERE identity_row.provider_code = ? AND identity_row.external_user_id = ? AND identity_row.status = 'linked'`,
      [providerCode, externalUserId]
    );
    const row = rows[0];
    if (row === undefined || row.pet_name === null || row.pet_name === "") return null;
    const number = (value: bigint | string | null) => value === null ? 0n : BigInt(value);
    const homeCharm = number(row.home_charm);
    const intimacyCharm = number(row.intimacy_charm);
    const castleBase = row.pet_experience + number(row.mini_castle_charm) + homeCharm + intimacyCharm
      + number(row.elemental_castle_charm) + number(row.pendant_castle_charm);
    const raidBase = row.pet_experience + number(row.mini_raid_charm) + homeCharm + intimacyCharm
      + number(row.elemental_raid_charm) + number(row.pendant_raid_charm);
    const cubeRate = (value: string | null) => Number.parseFloat(value ?? "0") || 0;
    const castle = BigInt(Math.floor(Number(castleBase) * (1 + cubeRate(row.cube_castle) / 100)));
    const raid = BigInt(Math.floor(Number(raidBase) * (1 + cubeRate(row.cube_raid) / 100)));
    const effectiveEnhancement = BigInt(Math.round(Number(row.pet_enhancement) * (1 + cubeRate(row.cube_pet_upgrade) / 100)));
    const total = castle + raid + effectiveEnhancement * 1000n;
    const capped = effectiveEnhancement > 300n ? 300n : effectiveEnhancement;
    const criticalChance = capped <= 100n ? Number(capped) * 0.5 : capped <= 200n
      ? 50 + Number(capped - 100n) * 0.3 : 80 + Number(capped - 200n) * 0.1;
    const criticalMultiplier = effectiveEnhancement <= 300n ? 1.7 : 1.7 + Number(effectiveEnhancement - 300n) * 0.01;
    const intimacyLevel = number(row.intimacy_level);
    const skillSlots = BigInt(Math.min(30 + (row.intro_skill_count > 0n ? 3 : 0), Math.floor(Number(intimacyLevel) / 100) + (row.intro_skill_count > 0n ? 3 : 0)))
      + (row.premium_pass_count > 0n ? 7n : 0n);
    return {
      playerId: row.player_id.toString(), displayName: row.display_name, tierCode: row.tier_code,
      pet: { name: row.pet_name, typeCode: row.pet_type_code, typeName: row.pet_type_name, image: row.pet_image,
        personality: row.personality, experience: row.pet_experience.toString(), enhancement: row.pet_enhancement.toString() },
      title: row.title_name,
      elemental: row.elemental_name === null ? null : { name: row.elemental_name, grade: row.elemental_grade ?? "", enhancement: number(row.elemental_enhancement).toString() },
      pendant: row.pendant_name === null ? null : { name: row.pendant_name, grade: row.pendant_grade ?? "", durability: row.pendant_durability?.toString() ?? null,
        maxDurability: row.pendant_max_durability?.toString() ?? null, enhancement: number(row.pendant_enhancement).toString() },
      miniPet: row.mini_name === null ? null : { name: row.mini_name, emoji: row.mini_emoji, grade: row.mini_grade,
        battleCharm: number(row.mini_battle_charm).toString(), enhancement: number(row.mini_enhancement).toString() },
      home: row.home_name === null ? null : { name: row.home_name, charm: homeCharm.toString(), floorArea: number(row.home_floor).toString() },
      intimacy: { level: intimacyLevel.toString(), progress: number(row.intimacy_progress).toString(), charm: intimacyCharm.toString(), rank: null },
      skill: { equipped: row.equipped_skill_count.toString(), slots: skillSlots.toString() },
      charm: { raid: raid.toString(), castle: castle.toString(), total: total.toString(), effectiveEnhancement: effectiveEnhancement.toString(),
        criticalChance: criticalChance.toFixed(2), criticalMultiplier: Number(criticalMultiplier.toFixed(2)).toString(), rank: null },
      daily: { towerAttempts: number(row.tower_attempts).toString(), towerFloor: number(row.tower_floor).toString(),
        castleAttempts: number(row.castle_attempts).toString(), castleScore: number(row.castle_score).toString(), castleRank: row.castle_rank,
        miniAttempts: number(row.mini_attempts).toString(), miniWins: number(row.mini_wins).toString(), miniLosses: number(row.mini_losses).toString(),
        exploreAttempts: number(row.explore_attempts).toString(), exploreWins: number(row.explore_wins).toString(), exploreLosses: number(row.explore_losses).toString(),
        dailyQuestRewarded: Boolean(row.daily_rewarded), weeklyQuestCount: number(row.weekly_count).toString(),
        petHomeCommentCount: number(row.pet_home_comment_count).toString(), feedPostCount: number(row.feed_post_count).toString(),
        homeAlertOpenCount: number(row.home_alert_open_count).toString() },
      pass: { base: row.base_pass_count > 0n, premium: row.premium_pass_count > 0n }
    };
  }
}
