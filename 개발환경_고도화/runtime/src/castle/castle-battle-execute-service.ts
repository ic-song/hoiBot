import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export const CASTLE_BATTLE_EXECUTE_COMMAND = "/캐슬대전";
const ALL_SEE = "​".repeat(500);
const DIRECT_MAX_RUNS = 15;
const AUTO_MAX_RUNS = 20;
const POINT_REWARD = 10_000_000;
const RESET_TICKET_CODE = "legacy-castle-battle-reset-ticket";
const BOOSTER_COUNTER = "experience_booster_count";
const FREE_COUNTER = "castle_battle_free_used";

type Numeric = bigint | number | string;

export interface CastleBattleRankDefinition {
  scoreRequirement: number;
  tierPoint: number;
  rankName: string;
}

export interface CastleBattleCombatant {
  playerId: string;
  displayName: string;
  level: number;
  experience: number;
  pointBalance: bigint;
  score: number;
  wins: number;
  losses: number;
  tierPoint: number;
  battleCount: number;
  freeUsed: number;
  boosterCount: number;
  resetTicketItemId: string | null;
  resetTicketCount: number;
  petId: string;
  petName: string;
  petImage: string;
  petType: string;
  petExperience: number;
  castleCharm: number;
  effectiveUpgradeLevel: number;
  hasExperiencedWarrior: boolean;
  hasMindWin: boolean;
}

export interface CastleBattleResolution {
  attacker: CastleBattleCombatant;
  defender: CastleBattleCombatant;
  attackerWon: boolean;
  attackerScoreBefore: number;
  defenderScoreBefore: number;
  winnerScoreDelta: number;
  loserScoreDelta: number;
  experienceDelta: number;
  pointDelta: number;
  resetTicketDelta: number;
  experiencedWarriorCharmDelta: number;
  messages: string[];
}

export interface CastleBattleExecuteResult {
  status: "completed";
  playerId: string;
  defenderPlayerId: string;
  attackerWon: boolean;
  messages: string[];
  outboxIds: string[];
  replayed: boolean;
}

interface CombatantRow {
  player_id: Numeric; display_name: string; level_value: Numeric; experience_value: Numeric; point_balance: Numeric;
  score_value: Numeric; win_count: Numeric; loss_count: Numeric; tier_point: Numeric;
  battle_count: Numeric; free_used: Numeric; booster_count: Numeric;
  reset_ticket_item_id: Numeric | null; reset_ticket_count: Numeric;
  pet_id: Numeric; pet_name: string; pet_image: string | null; pet_type: string | null; pet_experience: Numeric;
  pet_enhancement: Numeric; mini_castle: Numeric; home_castle: Numeric; intimacy_castle: Numeric;
  elemental_castle: Numeric; pendant_castle: Numeric; castle_percent: Numeric; upgrade_percent: Numeric;
  experienced_warrior: Numeric; mind_win: Numeric;
}

// 레거시 실행 명령과 정확히 일치하는 입력만 허용합니다.
export function isCastleBattleExecuteCommand(message: string | undefined): boolean {
  return message === CASTLE_BATTLE_EXECUTE_COMMAND;
}

// 공용 dispatch가 exact alias를 찾도록 명령을 정규화합니다.
export function normalizeCastleBattleExecuteDispatchMessage(message: string): string {
  return isCastleBattleExecuteCommand(message) ? CASTLE_BATTLE_EXECUTE_COMMAND : message;
}

// 긴 이벤트 키를 공용 operation 키 제한에 맞춥니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function integer(value: Numeric | null): number {
  return value === null ? 0 : Number(value);
}

function deterministicUnit(seed: string, index: number): number {
  const hex = createHash("sha256").update(`${seed}:${index}`).digest("hex").slice(0, 13);
  return Number.parseInt(hex, 16) / 0x1fffffffffffff;
}

function deterministicInt(seed: string, index: number, min: number, max: number): number {
  return Math.floor(deterministicUnit(seed, index) * (max - min + 1)) + min;
}

function typeBuff(attackerType: string, defenderType: string): [number, number] {
  const advantage: Record<string, string> = { "하늘": "땅", "땅": "바다", "바다": "하늘" };
  if (!(attackerType in advantage) || !(defenderType in advantage) || attackerType === defenderType) return [1, 1];
  return advantage[attackerType] === defenderType ? [1.3, 1] : [1, 1.3];
}

function criticalChance(level: number): number {
  const capped = Math.max(0, Math.min(300, Math.trunc(level)));
  if (capped <= 100) return capped * 0.005;
  if (capped <= 200) return (50 + (capped - 100) * 0.3) / 100;
  return (80 + (capped - 200) * 0.1) / 100;
}

function criticalMultiplier(level: number): number {
  return level <= 300 ? 1.7 : Number((1.7 + (Math.trunc(level) - 300) * 0.01).toFixed(2));
}

function applyCritical(base: number, level: number, roll: number): { value: number; critical: boolean } {
  const critical = roll < criticalChance(level);
  return { value: critical ? Math.round(base * criticalMultiplier(level)) : base, critical };
}

function rankFor(score: number, definitions: readonly CastleBattleRankDefinition[]): CastleBattleRankDefinition {
  const eligible = definitions.filter((definition) => score >= definition.scoreRequirement);
  const rank = eligible[eligible.length - 1];
  if (rank === undefined) throw new Error("CASTLE_BATTLE_RANK_DEFINITION_MISSING");
  return rank;
}

function scoreRange(winner: boolean, attackerWon: boolean, matchPoint: number): [number, number] {
  if (!winner) return [4, 5];
  if (matchPoint === 3) return attackerWon ? [17, 20] : [7, 9];
  if (matchPoint === 2) return [11, 13];
  return attackerWon ? [7, 9] : [17, 20];
}

function chooseCandidates(attacker: CastleBattleCombatant, rows: readonly CastleBattleCombatant[], roll: number) {
  const eligible = rows.filter((row) => row.playerId !== attacker.playerId && row.petExperience > 499);
  const tier = attacker.tierPoint;
  let candidates: CastleBattleCombatant[] = [];
  let matchPoint = 2;
  if (roll <= 0.4) candidates = eligible.filter((row) => row.tierPoint === tier);
  else if (roll <= 0.6) { candidates = eligible.filter((row) => row.tierPoint === tier + 1); matchPoint = 3; }
  else if (tier <= 1) candidates = eligible.filter((row) => row.tierPoint === tier);
  else { candidates = eligible.filter((row) => row.tierPoint === tier - 1); matchPoint = 1; }
  if (candidates.length === 0) {
    if (roll <= 0.6 && tier > 1) { candidates = eligible.filter((row) => row.tierPoint === tier - 1); matchPoint = 1; }
    else { candidates = eligible.filter((row) => row.tierPoint === tier); matchPoint = 2; }
  }
  for (let gap = 2; candidates.length === 0 && gap < tier; gap += 1) {
    candidates = eligible.filter((row) => row.tierPoint === tier - gap);
    matchPoint = 1;
  }
  return { candidates, matchPoint };
}

function commas(value: Numeric): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// bigint 자산을 정밀도 손실 없이 JSON 문자열 증거로 저장합니다.
function stringifyEvidence(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

function renderBattle(attacker: CastleBattleCombatant, defender: CastleBattleCombatant, values: Record<string, number | boolean | string>, maxRuns: number): string {
  const won = values.attackerWon as boolean;
  const expAfter = values.expAfter as number;
  const levelExp = 6 * attacker.level + 84;
  return [
    "🏆 데일리 캐슬매력 대전",
    `(대전횟수: ${values.battleCount}/${maxRuns}) (리셋권: ${values.resetTickets}개)`,
    `결과: ${won ? "✅ 승리" : "❌ 패배"}`,
    "━━━━━━━━━━━━", "",
    `⚔️ 공격\n유저: ${attacker.displayName}\n펫: ${attacker.petName}(${attacker.petImage})\n타입: ${attacker.petType} · 등급: ${values.beforeRank}`,
    `캐슬매력: ${commas(attacker.castleCharm)}💕\n상성: ${commas(values.attackerTypeCharm as number)}💕${values.attackerBuff === 1.3 ? " ⬆️유리" : ""}`,
    `최종: ${commas(values.attackerFinal as number)}💕${values.attackerCritical ? " 💥크리티컬" : ""}`, "", "              🆚", "",
    `🛡️ 방어\n유저: ${defender.displayName}\n펫: ${defender.petName}(${defender.petImage})\n타입: ${defender.petType} · 등급: ${values.defenderRank}`,
    `캐슬매력: ${commas(defender.castleCharm)}💕\n상성: ${commas(values.defenderTypeCharm as number)}💕${values.defenderBuff === 1.3 ? " ⬆️유리" : ""}`,
    `최종: ${commas(values.defenderFinal as number)}💕${values.defenderCritical ? " 💥크리티컬" : ""}`, "", "━━━━━━━━━━━━",
    `📊 최종 매력 비교${ALL_SEE}\n${commas(values.attackerFinal as number)} ${values.compare} ${commas(values.defenderFinal as number)}`,
    `매력 차이: ${commas(values.gap as number)}💕`, "", won ? "🏆 공격 승리" : "🛡️ 방어 승리",
    `${won ? attacker.displayName : defender.displayName} 님이 캐슬대전에서 승리했습니다!`,
    `CP: ${won ? "+" + values.winnerScore : "-" + values.loserScore}🏆 · 누적 ${commas(values.attackerScore as number)}🏆`,
    `경험치: ${values.expDelta}exp(${values.baseExp}/${values.boosterExp})(⤴️)`,
    `\n━ ✦ 획득포인트 및 경험치 상세정보✦ ━\n${ALL_SEE}\n\n획득 포인트🤑: 🅟7,000,000`,
    `현재 레벨 ${attacker.level} (${commas(expAfter)}/${commas(levelExp)}[${(expAfter / levelExp * 100).toFixed(2)}%])`,
    values.boostersAfter === 0 ? `[${attacker.displayName}] 님\n경험치 부스터가 없습니다.\n경험치패스⭐️를 후원해보세요!\nhttps://hoiland123.tistory.com/363` : `남은 경험치 부스터 횟수:  ${commas(values.boostersAfter as number)}`,
    `🔸️캐슬대전 최종 매력 차이🔸️\n${ALL_SEE}${commas(values.gap as number)}💕`,
    `${won ? attacker.displayName : defender.displayName} 캐슬포인트(CP): +${commas(values.winnerScore as number)}pt🏆`,
    `${won ? defender.displayName : attacker.displayName} 캐슬포인트(CP): -${commas(values.loserScore as number)}pt🏆`
  ].join("\n");
}

// 캐슬대전 매칭·상성·크리티컬·CP·경험치 결과를 이벤트 키로 결정합니다.
export function resolveCastleBattle(input: {
  attacker: CastleBattleCombatant;
  candidates: readonly CastleBattleCombatant[];
  rankDefinitions: readonly CastleBattleRankDefinition[];
  seed: string;
  maxRuns?: number;
}): CastleBattleResolution {
  const maxRuns = input.maxRuns ?? DIRECT_MAX_RUNS;
  const attacker = { ...input.attacker };
  if (attacker.petExperience <= 499) throw new ApplicationError("CASTLE_BATTLE_CHARM_REQUIRED", "펫 매력💕 500이상 부터 캐슬대전이 가능합니다.", 409);
  if (attacker.battleCount >= maxRuns) throw new ApplicationError("CASTLE_BATTLE_DAILY_LIMIT", `[${attacker.displayName}]님\n캐대리🐶는 하루에 ${maxRuns}회만 가능합니다.`, 409);
  const match = chooseCandidates(attacker, input.candidates, deterministicUnit(input.seed, 0));
  if (match.candidates.length === 0) throw new ApplicationError("CASTLE_BATTLE_MATCH_REQUIRED", "매칭 상대가 없습니다.", 409);
  const defender = { ...match.candidates[Math.min(match.candidates.length - 1, Math.floor(deterministicUnit(input.seed, 1) * match.candidates.length))]! };
  let resetTicketDelta = 0;
  if (attacker.freeUsed >= 1) {
    if (attacker.resetTicketCount <= 0) throw new ApplicationError("CASTLE_BATTLE_RESET_TICKET_REQUIRED", `오늘 무료대전 1회를 모두 사용했습니다.\n캐슬대전리셋권🐶 소지시 최대 ${maxRuns}회 가능합니다.\n\n캐대리🐶 이(가) 부족하신가요?\nhttps://hoiland123.tistory.com/512`, 409);
    attacker.resetTicketCount -= 1;
    resetTicketDelta = -1;
  } else attacker.freeUsed += 1;
  const experienced = attacker.hasExperiencedWarrior && deterministicUnit(input.seed, 2) <= 0.5 ? 20 : 0;
  const [attackerBuff, defenderBuff] = typeBuff(attacker.petType, defender.petType);
  const attackerTypeCharm = Math.round(attacker.castleCharm * attackerBuff);
  const defenderTypeCharm = Math.round(defender.castleCharm * defenderBuff);
  const attackerFinal = applyCritical(attackerTypeCharm, attacker.effectiveUpgradeLevel, deterministicUnit(input.seed, 3));
  const defenderFinal = applyCritical(defenderTypeCharm, defender.effectiveUpgradeLevel, deterministicUnit(input.seed, 4));
  const attackerWon = attackerFinal.value > defenderFinal.value;
  const winRange = scoreRange(true, attackerWon, match.matchPoint);
  const loseRange = scoreRange(false, attackerWon, match.matchPoint);
  let winnerScore = deterministicInt(input.seed, 5, winRange[0], winRange[1]);
  const loserScore = deterministicInt(input.seed, 6, loseRange[0], loseRange[1]);
  if (!attackerWon) winnerScore = 5;
  const attackerScoreBefore = attacker.score;
  const defenderScoreBefore = defender.score;
  if (attackerWon) {
    attacker.wins += 1; attacker.score += winnerScore; defender.losses += 1; defender.score = Math.max(0, defender.score - loserScore);
  } else {
    defender.wins += 1; defender.score += winnerScore; attacker.losses += 1; attacker.score = Math.max(0, attacker.score - loserScore);
  }
  attacker.battleCount += 1;
  attacker.pointBalance += BigInt(POINT_REWARD);
  const baseExp = attackerWon ? 100 : 50;
  const boosterExp = Math.min(attacker.boosterCount, baseExp);
  attacker.boosterCount -= boosterExp;
  attacker.experience += baseExp + boosterExp;
  attacker.petExperience += experienced;
  attacker.tierPoint = rankFor(attacker.score, input.rankDefinitions).tierPoint;
  defender.tierPoint = rankFor(defender.score, input.rankDefinitions).tierPoint;
  const beforeRank = rankFor(attackerScoreBefore, input.rankDefinitions).rankName;
  const afterRank = rankFor(attacker.score, input.rankDefinitions).rankName;
  const values = {
    attackerWon, battleCount: attacker.battleCount, resetTickets: attacker.resetTicketCount, beforeRank,
    defenderRank: rankFor(defender.score, input.rankDefinitions).rankName,
    attackerTypeCharm, defenderTypeCharm, attackerBuff, defenderBuff,
    attackerFinal: attackerFinal.value, defenderFinal: defenderFinal.value,
    attackerCritical: attackerFinal.critical, defenderCritical: defenderFinal.critical,
    compare: attackerFinal.value > defenderFinal.value ? ">" : attackerFinal.value < defenderFinal.value ? "<" : "=",
    gap: Math.abs(attackerFinal.value - defenderFinal.value), winnerScore, loserScore,
    attackerScore: attacker.score, baseExp, boosterExp, expDelta: baseExp + boosterExp,
    expAfter: attacker.experience, boostersAfter: attacker.boosterCount
  };
  const messages = [renderBattle(attacker, defender, values, maxRuns)];
  if (experienced > 0) messages.unshift(`숙련된 전사✨\n[${attacker.displayName}] 님이 깨달음을 얻어 매력 20💕을 획득하셨습니다`);
  if (!attackerWon && attacker.hasMindWin) messages.push(`[${attacker.displayName}] : 지는 게 이기는 거야..`);
  if (beforeRank !== afterRank) messages.push(`[${attacker.displayName}] 님의 캐슬대전🏆 등급이\n[${beforeRank}] -> [${afterRank}] 으로 ${attackerScoreBefore < attacker.score ? "\n🥇승급" : "\n〽강등"}하였습니다.`);
  return { attacker, defender, attackerWon, attackerScoreBefore, defenderScoreBefore,
    winnerScoreDelta: winnerScore, loserScoreDelta: loserScore, experienceDelta: baseExp + boosterExp,
    pointDelta: POINT_REWARD, resetTicketDelta, experiencedWarriorCharmDelta: experienced, messages };
}

function parseStoredResult(value: string | CastleBattleExecuteResult): CastleBattleExecuteResult {
  return typeof value === "string" ? JSON.parse(value) as CastleBattleExecuteResult : value;
}

function toCombatant(row: CombatantRow): CastleBattleCombatant {
  const petExperience = integer(row.pet_experience);
  const baseCharm = petExperience + integer(row.mini_castle) + integer(row.home_castle) + integer(row.intimacy_castle)
    + integer(row.elemental_castle) + integer(row.pendant_castle);
  const castleCharm = Math.floor(baseCharm * (1 + integer(row.castle_percent) / 100));
  const effectiveUpgradeLevel = Math.round(integer(row.pet_enhancement) * (1 + integer(row.upgrade_percent) / 100));
  return {
    playerId: String(row.player_id), displayName: row.display_name, level: integer(row.level_value),
    experience: integer(row.experience_value), pointBalance: BigInt(String(row.point_balance).split(".")[0] ?? "0"),
    score: integer(row.score_value), wins: integer(row.win_count), losses: integer(row.loss_count), tierPoint: integer(row.tier_point),
    battleCount: integer(row.battle_count), freeUsed: integer(row.free_used), boosterCount: integer(row.booster_count),
    resetTicketItemId: row.reset_ticket_item_id === null ? null : String(row.reset_ticket_item_id),
    resetTicketCount: integer(row.reset_ticket_count), petId: String(row.pet_id), petName: row.pet_name,
    petImage: row.pet_image ?? "", petType: row.pet_type ?? "", petExperience, castleCharm, effectiveUpgradeLevel,
    hasExperiencedWarrior: integer(row.experienced_warrior) > 0, hasMindWin: integer(row.mind_win) > 0
  };
}

// 공용 자산 테이블과 캐슬 전용 상태를 한 transaction으로 정산합니다.
export class CastleBattleExecuteService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: { externalUserId: string; channelId: string; message: string; eventId: string; mode?: "direct" | "auto" }): Promise<CastleBattleExecuteResult> {
    if (!isCastleBattleExecuteCommand(command.message)) throw new ApplicationError("CASTLE_BATTLE_COMMAND_INVALID", "정확한 /캐슬대전을 입력해 주세요.", 422);
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<Array<{ identity_id: Numeric; player_id: Numeric }>>(
        `SELECT id AS identity_id,player_id FROM external_identities
         WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const identity = identities[0];
      if (identity === undefined) throw new ApplicationError("CASTLE_BATTLE_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);
      const scope = `castle.battle.execute:${identity.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | CastleBattleExecuteResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        return { ...parseStoredResult(prior[0].result_json), replayed: true };
      }
      const seasons = await transaction.query<Array<{ id: Numeric }>>(
        `SELECT id FROM castle_battle_seasons WHERE status='active'
         AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))
         ORDER BY starts_at DESC,id DESC LIMIT 1 FOR UPDATE`
      );
      const season = seasons[0];
      if (season === undefined) throw new ApplicationError("CASTLE_BATTLE_SEASON_INACTIVE", "현재 캐슬대전시즌이 아닙니다.", 409);
      await transaction.execute(
        `INSERT INTO castle_battle_player_states(season_id,player_id,score,win_count,loss_count,tier_point,version)
         SELECT ?,player.id,0,0,0,1,1 FROM players player JOIN player_pets pet ON pet.player_id=player.id WHERE player.status='active'
         ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`, [season.id]
      );
      await transaction.execute(
        "INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)",
        [identity.player_id]
      );
      const rows = await transaction.query<CombatantRow[]>(
        `SELECT player.id AS player_id,profile.current_display_name AS display_name,profile.level AS level_value,
           profile.experience AS experience_value,COALESCE(currency.balance,0) AS point_balance,
           state.score AS score_value,state.win_count,state.loss_count,state.tier_point,
           COALESCE(daily.castle_battle_attempts,0) AS battle_count,
           COALESCE((SELECT counter_row.value FROM player_counters counter_row WHERE counter_row.player_id=player.id
             AND counter_row.counter_code=? AND counter_row.period_key=DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d')),0) AS free_used,
           COALESCE((SELECT counter_row.value FROM player_counters counter_row WHERE counter_row.player_id=player.id
             AND counter_row.counter_code=? AND counter_row.period_key='lifetime'),0) AS booster_count,
           reset_item.id AS reset_ticket_item_id,COALESCE(reset_stack.quantity,0) AS reset_ticket_count,
           pet.id AS pet_id,pet.display_name AS pet_name,pet.image_value AS pet_image,
           COALESCE(pet_definition.display_name,pet.pet_type_code,'') AS pet_type,pet.experience AS pet_experience,
           pet.enhancement_level AS pet_enhancement,COALESCE(mini.castle_experience,0) AS mini_castle,
           COALESCE(home.base_experience,0)+COALESCE((SELECT SUM(furniture_definition.charm_value)
             FROM furniture_placements placement JOIN owned_furniture furniture ON furniture.id=placement.owned_furniture_id
             JOIN furniture_definitions furniture_definition ON furniture_definition.id=furniture.furniture_definition_id
             WHERE placement.player_id=player.id),0) AS home_castle,
           COALESCE(intimacy.charm,0) AS intimacy_castle,COALESCE(elemental.castle_charm,0) AS elemental_castle,
           COALESCE(pendant.castle_charm,0) AS pendant_castle,COALESCE(cube.castle_percent,0) AS castle_percent,
           COALESCE(cube.pet_upgrade_percent,0) AS upgrade_percent,
           EXISTS(SELECT 1 FROM pet_skills skill_assignment JOIN skill_definitions skill_definition ON skill_definition.id=skill_assignment.skill_id
             WHERE skill_assignment.player_pet_id=pet.id AND skill_assignment.equipped=TRUE AND skill_definition.display_name='숙련된 전사') AS experienced_warrior,
           EXISTS(SELECT 1 FROM pet_skills skill_assignment JOIN skill_definitions skill_definition ON skill_definition.id=skill_assignment.skill_id
             WHERE skill_assignment.player_pet_id=pet.id AND skill_assignment.equipped=TRUE AND skill_definition.display_name IN ('정신승리','지는 게 이기는 거야')) AS mind_win
         FROM players player JOIN player_profiles profile ON profile.player_id=player.id
         JOIN player_pets pet ON pet.player_id=player.id
         JOIN castle_battle_player_states state ON state.player_id=player.id AND state.season_id=?
         LEFT JOIN pet_definitions pet_definition ON pet_definition.code=pet.pet_type_code
         LEFT JOIN currency_accounts currency ON currency.player_id=player.id AND currency.currency_code='point'
         LEFT JOIN player_pet_daily_records daily ON daily.player_id=player.id AND daily.record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))
         LEFT JOIN owned_mini_pets mini ON mini.player_id=player.id AND mini.equipped=TRUE
         LEFT JOIN player_homes home ON home.player_id=player.id
         LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id=pet.id
         LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
         LEFT JOIN player_pet_pendants pendant ON pendant.player_pet_id=pet.id
         LEFT JOIN player_home_badge_cubes cube ON cube.player_id=player.id AND cube.equipped=TRUE
         LEFT JOIN item_definitions reset_item ON reset_item.code=? AND reset_item.active=TRUE
         LEFT JOIN inventory_stacks reset_stack ON reset_stack.player_id=player.id AND reset_stack.item_id=reset_item.id
         WHERE player.status='active' ORDER BY player.id FOR UPDATE`,
        [FREE_COUNTER, BOOSTER_COUNTER, season.id, RESET_TICKET_CODE]
      );
      const combatants = rows.map(toCombatant);
      const attacker = combatants.find((row) => row.playerId === String(identity.player_id));
      if (attacker === undefined) throw new ApplicationError("CASTLE_BATTLE_PET_REQUIRED", "펫이 없습니다.", 409);
      const rankRows = await transaction.query<Array<{ score_requirement: Numeric; tier_point: Numeric; rank_name: string }>>(
        "SELECT score_requirement,tier_point,rank_name FROM castle_battle_rank_definitions ORDER BY score_requirement FOR UPDATE"
      );
      const rankDefinitions = rankRows.map((row) => ({ scoreRequirement: integer(row.score_requirement), tierPoint: integer(row.tier_point), rankName: row.rank_name }));
      const seed = createHash("sha256").update(`${scope}:${eventKey}:${identity.player_id}`).digest("hex");
      const resolution = resolveCastleBattle({ attacker, candidates: combatants, rankDefinitions, seed,
        maxRuns: command.mode === "auto" ? AUTO_MAX_RUNS : DIRECT_MAX_RUNS });
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, identity.identity_id]
      );
      await transaction.execute(
        `UPDATE castle_battle_player_states SET score=?,win_count=?,loss_count=?,tier_point=?,last_battle_at=UTC_TIMESTAMP(3),version=version+1
         WHERE season_id=? AND player_id=?`,
        [resolution.attacker.score,resolution.attacker.wins,resolution.attacker.losses,resolution.attacker.tierPoint,season.id,resolution.attacker.playerId]
      );
      await transaction.execute(
        `UPDATE castle_battle_player_states SET score=?,win_count=?,loss_count=?,tier_point=?,last_battle_at=UTC_TIMESTAMP(3),version=version+1
         WHERE season_id=? AND player_id=?`,
        [resolution.defender.score,resolution.defender.wins,resolution.defender.losses,resolution.defender.tierPoint,season.id,resolution.defender.playerId]
      );
      const attackerRank = rankFor(resolution.attacker.score, rankDefinitions).rankName;
      const defenderRank = rankFor(resolution.defender.score, rankDefinitions).rankName;
      await transaction.execute(
        `INSERT INTO player_pet_daily_records(player_id,record_date,castle_battle_attempts,castle_battle_score,castle_rank_label,version)
         VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),1,?,?,1)
         ON DUPLICATE KEY UPDATE castle_battle_attempts=castle_battle_attempts+1,castle_battle_score=VALUES(castle_battle_score),castle_rank_label=VALUES(castle_rank_label),version=version+1`,
        [resolution.attacker.playerId,resolution.attacker.score,attackerRank]
      );
      await transaction.execute(
        `INSERT INTO player_pet_daily_records(player_id,record_date,castle_battle_score,castle_rank_label,version)
         VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),?,?,1)
         ON DUPLICATE KEY UPDATE castle_battle_score=VALUES(castle_battle_score),castle_rank_label=VALUES(castle_rank_label),version=version+1`,
        [resolution.defender.playerId,resolution.defender.score,defenderRank]
      );
      await transaction.execute("UPDATE player_profiles SET experience=experience+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=?",
        [resolution.experienceDelta,resolution.attacker.playerId]);
      await transaction.execute("UPDATE currency_accounts SET balance=balance+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point'",
        [resolution.pointDelta,resolution.attacker.playerId]);
      await transaction.execute(
        `INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code)
         VALUES (?,1,?,'point',?,?,'castle_battle_participation')`,
        [operation.insertId,resolution.attacker.playerId,resolution.pointDelta,resolution.attacker.pointBalance.toString()]
      );
      await transaction.execute(
        `INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES (?,?,DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d'),?)
         ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=UTC_TIMESTAMP(3)`,
        [resolution.attacker.playerId,FREE_COUNTER,resolution.attacker.freeUsed]
      );
      await transaction.execute(
        `INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES (?,?,'lifetime',?)
         ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=UTC_TIMESTAMP(3)`,
        [resolution.attacker.playerId,BOOSTER_COUNTER,resolution.attacker.boosterCount]
      );
      if (resolution.resetTicketDelta < 0) {
        if (resolution.attacker.resetTicketItemId === null) throw new ApplicationError("CASTLE_BATTLE_RESET_TICKET_ITEM_REQUIRED", "캐슬대전리셋권 설정을 찾을 수 없습니다.", 409);
        const consumed = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND quantity>0",
          [resolution.attacker.playerId,resolution.attacker.resetTicketItemId]
        );
        if (consumed.affectedRows !== 1n) throw new ApplicationError("CASTLE_BATTLE_RESET_TICKET_CONFLICT", "캐슬대전리셋권 수량이 먼저 변경되었습니다.", 409);
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,-1,'castle_battle_reset_ticket_used')",
          [operation.insertId,resolution.attacker.playerId,resolution.attacker.resetTicketItemId]
        );
      }
      if (resolution.experiencedWarriorCharmDelta > 0) {
        await transaction.execute("UPDATE player_pets SET experience=experience+?,version=version+1 WHERE id=?",
          [resolution.experiencedWarriorCharmDelta,resolution.attacker.petId]);
      }
      const settlementResult = { attackerWon: resolution.attackerWon, attacker: resolution.attacker, defender: resolution.defender, messages: resolution.messages };
      await transaction.execute(
        `INSERT INTO castle_battle_settlements(operation_id,season_id,attacker_player_id,defender_player_id,attacker_won,
           attacker_score_before,attacker_score_after,defender_score_before,defender_score_after,winner_score_delta,loser_score_delta,
           experience_delta,point_delta,reset_ticket_delta,result_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [operation.insertId,season.id,resolution.attacker.playerId,resolution.defender.playerId,resolution.attackerWon,
          resolution.attackerScoreBefore,resolution.attacker.score,resolution.defenderScoreBefore,resolution.defender.score,
          resolution.winnerScoreDelta,resolution.loserScoreDelta,resolution.experienceDelta,resolution.pointDelta,resolution.resetTicketDelta,
          stringifyEvidence(settlementResult)]
      );
      const outboxIds: string[] = [];
      for (const message of resolution.messages) {
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
           VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [operation.insertId,command.channelId,JSON.stringify({ data: message })]
        );
        outboxIds.push(outbox.insertId.toString());
      }
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'castle_battle_execute',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [command.eventId,operation.insertId]
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'player',?,'castle.battle.execute','success','Iris /캐슬대전',?,UTC_TIMESTAMP(3))`,
        [operation.insertId,identity.identity_id,resolution.defender.playerId,JSON.stringify({
          seasonId:String(season.id),attackerPlayerId:resolution.attacker.playerId,defenderPlayerId:resolution.defender.playerId,
          attackerWon:resolution.attackerWon,pointDelta:resolution.pointDelta,experienceDelta:resolution.experienceDelta,
          resetTicketDelta:resolution.resetTicketDelta,mode:command.mode ?? "direct"
        })]
      );
      const result: CastleBattleExecuteResult = {
        status:"completed",playerId:resolution.attacker.playerId,defenderPlayerId:resolution.defender.playerId,
        attackerWon:resolution.attackerWon,messages:resolution.messages,outboxIds,replayed:false
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
