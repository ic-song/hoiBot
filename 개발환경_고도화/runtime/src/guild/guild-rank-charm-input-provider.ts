import { createHash } from "node:crypto";
import type { DatabaseTransaction } from "../database.js";
import { calculatePlayerOverallScore, type OverallScoreInput } from "../player/player-overall-rank-read-service.js";

type Numeric = bigint | number | string;

interface RawMemberRow {
  guild_id: Numeric; guild_version: Numeric; guild_name: string; guild_level: Numeric;
  player_id: Numeric; player_name: string; player_level: Numeric; pet_experience: Numeric; pet_enhancement: Numeric;
  mini_grade: string | null; mini_raid: Numeric | null; mini_castle: Numeric | null; home_charm: Numeric | null;
  arcana_count: Numeric; royal_placed_count: Numeric; intimacy_charm: Numeric | null; elemental_raid: Numeric | null;
  elemental_castle: Numeric | null; pendant_raid: Numeric | null; pendant_castle: Numeric | null;
  cube_raid: string | null; cube_castle: string | null; cube_pet_upgrade: string | null;
  guild_raid_units: Numeric | null; guild_castle_units: Numeric | null;
}
interface SkillRow { player_id: Numeric; display_name: string; raid_charm: Numeric; castle_charm: Numeric; condition_code: string | null; condition_threshold: Numeric; home_charm_percent: string; }

export interface GuildMemberCharmInput {
  guildId: string; guildVersion: string; guildName: string; guildLevel: bigint;
  playerId: string; playerName: string; playerLevel: bigint; totalCharm: bigint; sourceHash: string; components: OverallScoreInput;
}
const big = (value: Numeric | null): bigint => value === null ? 0n : BigInt(value);

// 길드 순위 계산에 필요한 전체 회원 매력 입력을 한 transaction에서 고정합니다.
export class GuildRankCharmInputProvider {
  async loadAll(transaction: DatabaseTransaction): Promise<GuildMemberCharmInput[]> {
    const bases = await transaction.query<RawMemberRow[]>(`
      SELECT guild.id guild_id,guild.version guild_version,guild.display_name guild_name,
             COALESCE(guild_detail.level_value,guild.level,1) guild_level,
             player.id player_id,profile.current_display_name player_name,profile.level player_level,
             pet.experience pet_experience,pet.enhancement_level pet_enhancement,
             mini_definition.grade_display_name mini_grade,mini.raid_experience mini_raid,mini.castle_experience mini_castle,
             COALESCE(home.base_experience,0)+COALESCE((SELECT SUM(instance.charm_snapshot) FROM furniture_inventory_instances instance WHERE instance.player_id=player.id AND instance.status='placed'),0) home_charm,
             COALESCE((SELECT COUNT(*) FROM furniture_inventory_instances instance WHERE instance.player_id=player.id AND instance.status IN ('bag','placed','listed') AND instance.grade_display_name='아르카나 루미에르'),0) arcana_count,
             COALESCE((SELECT COUNT(*) FROM furniture_inventory_instances instance WHERE instance.player_id=player.id AND instance.status='placed' AND instance.grade_display_name='로열 루미에르'),0) royal_placed_count,
             intimacy.charm intimacy_charm,elemental.raid_charm elemental_raid,elemental.castle_charm elemental_castle,
             pendant.raid_charm pendant_raid,pendant.castle_charm pendant_castle,
             cube.raid_percent cube_raid,cube.castle_percent cube_castle,cube.pet_upgrade_percent cube_pet_upgrade,
             guild_cube.raid_units guild_raid_units,guild_cube.castle_units guild_castle_units
        FROM guild_members membership
        JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active'
        LEFT JOIN guild_profile_details guild_detail ON guild_detail.guild_id=guild.id
        JOIN players player ON player.id=membership.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id
        JOIN player_pets pet ON pet.id=(SELECT MIN(candidate.id) FROM player_pets candidate WHERE candidate.player_id=player.id AND candidate.display_name IS NOT NULL AND candidate.display_name<>'')
        LEFT JOIN owned_mini_pets mini ON mini.id=(SELECT MIN(candidate.id) FROM owned_mini_pets candidate WHERE candidate.player_id=player.id AND candidate.equipped=TRUE)
        LEFT JOIN mini_pet_definitions mini_definition ON mini_definition.id=mini.mini_pet_definition_id
        LEFT JOIN player_homes home ON home.player_id=player.id
        LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id=pet.id
        LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
        LEFT JOIN player_pet_pendants pendant ON pendant.player_pet_id=pet.id
        LEFT JOIN player_home_badge_cubes cube ON cube.player_id=player.id AND cube.equipped=TRUE
             AND cube.badge_code=(SELECT MIN(candidate.badge_code) FROM player_home_badge_cubes candidate WHERE candidate.player_id=player.id AND candidate.equipped=TRUE)
        LEFT JOIN guild_overall_charm_cube_options guild_cube ON guild_cube.guild_id=guild.id
       ORDER BY guild.id,player.id FOR UPDATE`);
    const skills = await transaction.query<SkillRow[]>(`
      SELECT DISTINCT pet.player_id,definition.display_name,rule.raid_charm,rule.castle_charm,rule.condition_code,rule.condition_threshold,CAST(rule.home_charm_percent AS CHAR) home_charm_percent
        FROM pet_skills equipped JOIN player_pets pet ON pet.id=equipped.player_pet_id
        JOIN skill_definitions definition ON definition.id=equipped.skill_id AND definition.active=TRUE
        JOIN player_overall_charm_skill_rules rule ON rule.display_name=definition.display_name AND rule.active=TRUE
       WHERE equipped.equipped=TRUE ORDER BY pet.player_id,definition.id FOR UPDATE`);
    const byPlayer = new Map<string, SkillRow[]>();
    for (const skill of skills) { const key = String(skill.player_id), rows = byPlayer.get(key) ?? []; rows.push(skill); byPlayer.set(key, rows); }
    return bases.map((base) => {
      const playerSkills = (byPlayer.get(String(base.player_id)) ?? []).map((skill) => ({ displayName: skill.display_name, raidCharm: big(skill.raid_charm), castleCharm: big(skill.castle_charm), conditionCode: skill.condition_code, conditionThreshold: big(skill.condition_threshold), homeCharmPercent: skill.home_charm_percent }));
      const components: OverallScoreInput = {
        petExperience: big(base.pet_experience), petEnhancement: big(base.pet_enhancement), miniGrade: base.mini_grade,
        miniRaid: big(base.mini_raid), miniCastle: big(base.mini_castle), homeCharm: big(base.home_charm), arcanaCount: big(base.arcana_count), royalPlacedCount: big(base.royal_placed_count), intimacyCharm: big(base.intimacy_charm),
        elementalRaid: big(base.elemental_raid), elementalCastle: big(base.elemental_castle), pendantRaid: big(base.pendant_raid), pendantCastle: big(base.pendant_castle),
        cubeRaidPercent: base.cube_raid ?? "0", cubeCastlePercent: base.cube_castle ?? "0", cubePetUpgradePercent: base.cube_pet_upgrade ?? "0",
        guildRaidUnits: big(base.guild_raid_units), guildCastleUnits: big(base.guild_castle_units), skills: playerSkills,
      };
      const totalCharm = calculatePlayerOverallScore(components).total;
      const serial = { guildId: String(base.guild_id), guildVersion: String(base.guild_version), guildName: base.guild_name, guildLevel: String(base.guild_level), playerId: String(base.player_id), playerName: base.player_name, playerLevel: String(base.player_level), totalCharm: totalCharm.toString(), components: serializeComponents(components) };
      return { guildId: serial.guildId, guildVersion: serial.guildVersion, guildName: serial.guildName, guildLevel: big(base.guild_level), playerId: serial.playerId, playerName: serial.playerName, playerLevel: big(base.player_level), totalCharm, sourceHash: createHash("sha256").update(JSON.stringify(serial)).digest("hex"), components };
    });
  }
}

export function serializeComponents(input: OverallScoreInput): Record<string, unknown> {
  return { petExperience: input.petExperience.toString(), petEnhancement: input.petEnhancement.toString(), miniGrade: input.miniGrade, miniRaid: input.miniRaid.toString(), miniCastle: input.miniCastle.toString(), homeCharm: input.homeCharm.toString(), arcanaCount: input.arcanaCount.toString(), royalPlacedCount: input.royalPlacedCount.toString(), intimacyCharm: input.intimacyCharm.toString(), elementalRaid: input.elementalRaid.toString(), elementalCastle: input.elementalCastle.toString(), pendantRaid: input.pendantRaid.toString(), pendantCastle: input.pendantCastle.toString(), cubeRaidPercent: input.cubeRaidPercent, cubeCastlePercent: input.cubeCastlePercent, cubePetUpgradePercent: input.cubePetUpgradePercent, guildRaidUnits: input.guildRaidUnits.toString(), guildCastleUnits: input.guildCastleUnits.toString(), skills: input.skills.map((skill) => ({ displayName: skill.displayName, raidCharm: skill.raidCharm.toString(), castleCharm: skill.castleCharm.toString(), conditionCode: skill.conditionCode, conditionThreshold: skill.conditionThreshold.toString(), homeCharmPercent: skill.homeCharmPercent })) };
}
