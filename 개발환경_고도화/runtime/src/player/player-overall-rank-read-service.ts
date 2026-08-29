import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const ALLSEE = "\u200b".repeat(500);
const PERCENT_SCALE = 100000n;

interface OverallBaseRow {
  player_id: bigint;
  current_display_name: string;
  rank_emoji: string | null;
  source_order: bigint | null;
  pet_id: bigint;
  pet_experience: bigint;
  pet_enhancement: bigint;
  mini_grade: string | null;
  mini_raid: bigint | null;
  mini_castle: bigint | null;
  home_charm: bigint | string | null;
  arcana_count: bigint;
  royal_placed_count: bigint;
  intimacy_charm: bigint | null;
  elemental_raid: bigint | null;
  elemental_castle: bigint | null;
  pendant_raid: bigint | null;
  pendant_castle: bigint | null;
  cube_raid: string | null;
  cube_castle: string | null;
  cube_pet_upgrade: string | null;
  guild_raid_units: bigint | null;
  guild_castle_units: bigint | null;
}

interface OverallSkillRuleRow {
  player_id: bigint;
  display_name: string;
  raid_charm: bigint;
  castle_charm: bigint;
  condition_code: string | null;
  condition_threshold: bigint;
  home_charm_percent: string;
}

export interface PlayerOverallRankRow {
  playerId: string;
  displayName: string;
  rankEmoji: string;
  sourceOrder: string | null;
  totalCharm: string;
  castleCharm: string;
  raidCharm: string;
  effectiveEnhancement: string;
}

export interface PlayerOverallRankReadResult {
  data: string;
  outboxId: string;
  rowCount: number;
  requesterRank: number | null;
}

export interface OverallScoreInput {
  petExperience: bigint;
  petEnhancement: bigint;
  miniGrade: string | null;
  miniRaid: bigint;
  miniCastle: bigint;
  homeCharm: bigint;
  arcanaCount: bigint;
  royalPlacedCount: bigint;
  intimacyCharm: bigint;
  elementalRaid: bigint;
  elementalCastle: bigint;
  pendantRaid: bigint;
  pendantCastle: bigint;
  cubeRaidPercent: string;
  cubeCastlePercent: string;
  cubePetUpgradePercent: string;
  guildRaidUnits: bigint;
  guildCastleUnits: bigint;
  skills: Array<{ displayName: string; raidCharm: bigint; castleCharm: bigint; conditionCode: string | null; conditionThreshold: bigint; homeCharmPercent: string }>;
}

// 레거시 정확 명령과 한글 단축 별칭만 허용합니다.
export function isPlayerOverallRankReadCommand(message: string | undefined): boolean {
  return message === "/종합순위" || message === "ㅈㅈㅈ";
}

// DB 기반 스킬 조건과 큐브 비율을 적용해 레거시 종합매력을 정수로 계산합니다.
export function calculatePlayerOverallScore(input: OverallScoreInput): { total: bigint; castle: bigint; raid: bigint; effectiveEnhancement: bigint } {
  let skillRaid = 0n;
  let skillCastle = 0n;
  let homePercentMilli = 0n;
  const counted = new Set<string>();
  for (const skill of input.skills) {
    if (counted.has(skill.displayName)) continue;
    counted.add(skill.displayName);
    if (!conditionSatisfied(skill.conditionCode, skill.conditionThreshold, input)) continue;
    skillRaid += skill.raidCharm;
    skillCastle += skill.castleCharm;
    homePercentMilli += parsePercentMilli(skill.homeCharmPercent);
  }
  const homeCharm = applyFloorPercent(input.homeCharm, homePercentMilli);
  const castleBase = input.petExperience + input.miniCastle + homeCharm + input.intimacyCharm
    + input.elementalCastle + input.pendantCastle + skillCastle;
  const raidBase = input.petExperience + input.miniRaid + homeCharm
    + input.elementalRaid + input.pendantRaid + skillRaid;
  const castlePercent = parsePercentMilli(input.cubeCastlePercent) + cappedGuildUnits(input.guildCastleUnits) * 100n;
  const raidPercent = parsePercentMilli(input.cubeRaidPercent) + cappedGuildUnits(input.guildRaidUnits) * 100n;
  const castle = applyFloorPercent(castleBase, castlePercent);
  const raid = applyFloorPercent(raidBase, raidPercent);
  const upgradePercent = parsePercentMilli(input.cubePetUpgradePercent);
  const effectiveEnhancement = (input.petEnhancement * (PERCENT_SCALE + upgradePercent) + PERCENT_SCALE / 2n) / PERCENT_SCALE;
  return { total: castle + raid + effectiveEnhancement * 1000n, castle, raid, effectiveEnhancement };
}

// 레거시 헤더, 요청자 격차 안내, 5명 접힘 경계를 보존합니다.
export function formatPlayerOverallRanking(rows: readonly PlayerOverallRankRow[], requesterPlayerId: string | null): string {
  const guide = buildGapGuide(rows, requesterPlayerId);
  const lines = rows.map((row, index) => `${rankLabel(index + 1)}${row.rankEmoji}${row.displayName} - 👑 ${commas(row.totalCharm)}\n`);
  return '👑 종합 순위 👑\n["/펫정보"에 있는 매력+강화로 합산]\n[캐슬⚔️+레이드👾+펫강화⭐️1강*1,000]\n[하루에 한번 1등~150등 차등으로 보상됩니다.]\n(/종합순위보상) 참조\n\n'
    + guide + lines.slice(0, 5).join("") + ALLSEE + lines.slice(5).join("");
}

// 모든 활성 펫 회원의 종합매력을 읽어 감사·outbox와 원자 기록합니다.
export class PlayerOverallRankReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PlayerOverallRankReadResult | null> {
    return this.database.withTransaction(async (transaction) => {
      const actor = (await transaction.query<Array<{ identity_id: bigint; player_id: bigint | null }>>(
        "SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1 FOR UPDATE",
        [input.externalUserId]
      ))[0];
      if (actor === undefined) return null;
      const idempotencyKey = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = (await transaction.query<Array<{ result_json: string | PlayerOverallRankReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='player.overall_rank_read' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (prior?.result_json != null) return typeof prior.result_json === "string" ? JSON.parse(prior.result_json) : prior.result_json;

      const rows = await this.loadRankingRows(transaction);
      const requesterPlayerId = actor.player_id?.toString() ?? null;
      const requesterIndex = requesterPlayerId === null ? -1 : rows.findIndex((row) => row.playerId === requesterPlayerId);
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.overall_rank_read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey, actor.identity_id]
      )).insertId;
      const data = formatPlayerOverallRanking(rows, requesterPlayerId);
      const outboxId = (await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data })]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PLAYER_OVERALL_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'leaderboard',NULL,'player.overall_rank_read','success','Iris /종합순위',?,UTC_TIMESTAMP(3))",
        [operationId, actor.identity_id, JSON.stringify({ rowCount: rows.length, requesterPlayerId, requesterRank: requesterIndex < 0 ? null : requesterIndex + 1, stableIds: rows.map((row) => row.playerId), readOnly: true })]
      );
      const result: PlayerOverallRankReadResult = { data, outboxId: outboxId.toString(), rowCount: rows.length, requesterRank: requesterIndex < 0 ? null : requesterIndex + 1 };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }

  public async loadRankingRows(transaction: DatabaseTransaction): Promise<PlayerOverallRankRow[]> {
    const bases = await transaction.query<OverallBaseRow[]>(
      `SELECT player.id player_id,profile.current_display_name,rank_profile.rank_emoji,rank_profile.source_order,
              pet.id pet_id,pet.experience pet_experience,pet.enhancement_level pet_enhancement,
              mini_definition.grade_display_name mini_grade,mini.raid_experience mini_raid,mini.castle_experience mini_castle,
              COALESCE(home.base_experience,0)+COALESCE((SELECT SUM(instance.charm_snapshot) FROM furniture_inventory_instances instance WHERE instance.player_id=player.id AND instance.status='placed'),0) home_charm,
              COALESCE((SELECT COUNT(*) FROM furniture_inventory_instances instance WHERE instance.player_id=player.id AND instance.status IN ('bag','placed','listed') AND instance.grade_display_name='아르카나 루미에르'),0) arcana_count,
              COALESCE((SELECT COUNT(*) FROM furniture_inventory_instances instance WHERE instance.player_id=player.id AND instance.status='placed' AND instance.grade_display_name='로열 루미에르'),0) royal_placed_count,
              intimacy.charm intimacy_charm,elemental.raid_charm elemental_raid,elemental.castle_charm elemental_castle,
              pendant.raid_charm pendant_raid,pendant.castle_charm pendant_castle,
              cube.raid_percent cube_raid,cube.castle_percent cube_castle,cube.pet_upgrade_percent cube_pet_upgrade,
              guild_cube.raid_units guild_raid_units,guild_cube.castle_units guild_castle_units
         FROM players player JOIN player_profiles profile ON profile.player_id=player.id JOIN player_pets pet ON pet.player_id=player.id
    LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
    LEFT JOIN owned_mini_pets mini ON mini.player_id=player.id AND mini.equipped=TRUE
    LEFT JOIN mini_pet_definitions mini_definition ON mini_definition.id=mini.mini_pet_definition_id
    LEFT JOIN player_homes home ON home.player_id=player.id
    LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id=pet.id
    LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
    LEFT JOIN player_pet_pendants pendant ON pendant.player_pet_id=pet.id
    LEFT JOIN player_home_badge_cubes cube ON cube.player_id=player.id AND cube.equipped=TRUE
    LEFT JOIN guild_members membership ON membership.player_id=player.id
    LEFT JOIN guild_overall_charm_cube_options guild_cube ON guild_cube.guild_id=membership.guild_id
        WHERE player.status='active' AND player.deleted_at IS NULL AND pet.display_name IS NOT NULL AND pet.display_name<>''
     ORDER BY player.id`
    );
    const rules = await transaction.query<OverallSkillRuleRow[]>(
      `SELECT DISTINCT pet.player_id,definition.display_name,rule.raid_charm,rule.castle_charm,
              rule.condition_code,rule.condition_threshold,CAST(rule.home_charm_percent AS CHAR) home_charm_percent
         FROM pet_skills equipped JOIN player_pets pet ON pet.id=equipped.player_pet_id
         JOIN skill_definitions definition ON definition.id=equipped.skill_id AND definition.active=TRUE
         JOIN player_overall_charm_skill_rules rule ON rule.display_name=definition.display_name AND rule.active=TRUE
        WHERE equipped.equipped=TRUE`
    );
    const byPlayer = new Map<string, OverallSkillRuleRow[]>();
    for (const rule of rules) {
      const key = rule.player_id.toString();
      const values = byPlayer.get(key) ?? [];
      values.push(rule);
      byPlayer.set(key, values);
    }
    const mapped = bases.map((base) => {
      const value = (input: bigint | string | null) => input === null ? 0n : BigInt(input);
      const score = calculatePlayerOverallScore({
        petExperience: base.pet_experience,
        petEnhancement: base.pet_enhancement,
        miniGrade: base.mini_grade,
        miniRaid: value(base.mini_raid),
        miniCastle: value(base.mini_castle),
        homeCharm: value(base.home_charm),
        arcanaCount: base.arcana_count,
        royalPlacedCount: base.royal_placed_count,
        intimacyCharm: value(base.intimacy_charm),
        elementalRaid: value(base.elemental_raid),
        elementalCastle: value(base.elemental_castle),
        pendantRaid: value(base.pendant_raid),
        pendantCastle: value(base.pendant_castle),
        cubeRaidPercent: base.cube_raid ?? "0",
        cubeCastlePercent: base.cube_castle ?? "0",
        cubePetUpgradePercent: base.cube_pet_upgrade ?? "0",
        guildRaidUnits: value(base.guild_raid_units),
        guildCastleUnits: value(base.guild_castle_units),
        skills: (byPlayer.get(base.player_id.toString()) ?? []).map((rule) => ({
          displayName: rule.display_name, raidCharm: rule.raid_charm, castleCharm: rule.castle_charm,
          conditionCode: rule.condition_code, conditionThreshold: rule.condition_threshold, homeCharmPercent: rule.home_charm_percent
        }))
      });
      return {
        playerId: base.player_id.toString(), displayName: base.current_display_name, rankEmoji: base.rank_emoji ?? "",
        sourceOrder: base.source_order?.toString() ?? null, totalCharm: score.total.toString(), castleCharm: score.castle.toString(),
        raidCharm: score.raid.toString(), effectiveEnhancement: score.effectiveEnhancement.toString()
      };
    });
    mapped.sort((left, right) => {
      const scoreCompare = compareBigInt(BigInt(right.totalCharm), BigInt(left.totalCharm));
      if (scoreCompare !== 0) return scoreCompare;
      const leftOrder = left.sourceOrder === null ? null : BigInt(left.sourceOrder);
      const rightOrder = right.sourceOrder === null ? null : BigInt(right.sourceOrder);
      if (leftOrder !== null && rightOrder !== null) {
        const orderCompare = compareBigInt(leftOrder, rightOrder);
        if (orderCompare !== 0) return orderCompare;
      } else if (leftOrder !== null) return -1;
      else if (rightOrder !== null) return 1;
      return compareBigInt(BigInt(left.playerId), BigInt(right.playerId));
    });
    return mapped;
  }
}

function conditionSatisfied(code: string | null, threshold: bigint, input: OverallScoreInput): boolean {
  if (code === null || code === "") return true;
  if (code === "ELITE_MINI_PET") return input.miniGrade === "엘리트";
  if (code === "CREATION_MINI_PET") return input.miniGrade === "창조";
  if (code === "ARCANA_FURNITURE") return input.arcanaCount >= threshold;
  if (code === "ROYAL_PLACED_FURNITURE") return input.royalPlacedCount >= threshold;
  return false;
}

function parsePercentMilli(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (match === null) return 0n;
  return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
}

function applyFloorPercent(value: bigint, percentMilli: bigint): bigint {
  return value * (PERCENT_SCALE + percentMilli) / PERCENT_SCALE;
}

function cappedGuildUnits(value: bigint): bigint {
  return value < 0n ? 0n : value > 500n ? 500n : value;
}

function buildGapGuide(rows: readonly PlayerOverallRankRow[], requesterPlayerId: string | null): string {
  if (requesterPlayerId === null) return "";
  const index = rows.findIndex((row) => row.playerId === requesterPlayerId);
  if (index < 0) return "";
  const mine = rows[index]!;
  const mineName = `${mine.rankEmoji}${mine.displayName}`;
  if (index === 0) {
    if (rows.length < 2) return "";
    const second = rows[1]!;
    const gap = BigInt(mine.totalCharm) - BigInt(second.totalCharm);
    return `👀 뒤를 조심하세요!\n${mineName}님은 현재 🏆 1등!\n${second.rankEmoji}${second.displayName}님이 ☆ ${commas(gap.toString())} 차이로 바짝 추격 중! 👣\n\n`;
  }
  const previous = rows[index - 1]!;
  const need = BigInt(previous.totalCharm) - BigInt(mine.totalCharm) + 1n;
  return `앗, 간발의 차이!\n${mineName}님의 순위는 ${index + 1}등!\n종합매력을 ☆ ${commas(need.toString())}만 더 모으면\n${previous.rankEmoji}${previous.displayName}님을 제치고 순위가 상승합니다! 🚀\n\n`;
}

function rankLabel(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}위 `;
}

function commas(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
