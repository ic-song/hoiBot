import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface DailyQuestCountAdminCommand {
  targetDisplayName: string;
  towerAttempts: bigint;
  castleBattleAttempts: bigint;
  miniBattleAttempts: bigint;
  exploreAttempts: bigint;
  dailyRewardCount?: bigint;
}

interface DailyQuestCountSnapshot {
  towerAttempts: string;
  castleBattleAttempts: string;
  castleBattleFreeUsed: string;
  miniBattleAttempts: string;
  exploreAttempts: string;
  dailyRewardCount: string;
  dailyQuestRewarded: boolean;
}

export interface DailyQuestCountAdminResult {
  data: string;
  outboxId: string;
  targetPlayerId: string;
  targetDisplayName: string;
  before: DailyQuestCountSnapshot;
  after: DailyQuestCountSnapshot;
  changed: boolean;
}

const usage = "사용법: /일퀘횟수수정 유저명 시탑 캐대전 미대전 펫탐험 [일일보상횟수]";
const maximumAttempts = [15n, 15n, 15n, 10n] as const;
const maxUnsignedBigInt = 18_446_744_073_709_551_615n;

// 일퀘횟수수정은 대상명 뒤에 4개 또는 5개의 완전한 숫자 인수가 있을 때만 후보로 봅니다.
export function isDailyQuestCountAdminCommandCandidate(message: string | undefined): boolean {
  if (message === undefined || !message.startsWith("/일퀘횟수수정 ")) return false;
  try {
    parseDailyQuestCountAdminCommand(message);
    return true;
  } catch {
    return false;
  }
}

// 뒤쪽 숫자 토큰을 카운트로 분리해 공백이 포함된 레거시 회원명을 보존합니다.
export function parseDailyQuestCountAdminCommand(message: string): DailyQuestCountAdminCommand {
  const match = /^\/일퀘횟수수정\s+([^\r\n]+)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_DAILY_QUEST_COUNT_COMMAND", usage, 422);
  const tokens = match[1]!.trim().split(/\s+/);
  if (tokens.length < 5) throw new ApplicationError("INVALID_DAILY_QUEST_COUNT_COMMAND", usage, 422);
  const hasOptionalRewardCount = tokens.length >= 6 && tokens.slice(-5).every(isUnsignedDecimal);
  const countLength = hasOptionalRewardCount ? 5 : 4;
  const countTokens = tokens.slice(-countLength);
  const targetDisplayName = tokens.slice(0, -countLength).join(" ");
  if (targetDisplayName.length === 0 || !countTokens.every(isUnsignedDecimal)) {
    throw new ApplicationError("INVALID_DAILY_QUEST_COUNT_COMMAND", usage, 422);
  }
  const counts = countTokens.map((value) => BigInt(value));
  if (counts.slice(0, 4).some((value, index) => value > maximumAttempts[index]!)) {
    throw new ApplicationError("INVALID_DAILY_QUEST_ATTEMPTS", "❌ 일퀘 카운트는 시탑/캐대전/미대전 0~15, 펫탐험 0~10 숫자로 입력해주세요.", 422);
  }
  if (counts[4] !== undefined && counts[4] > maxUnsignedBigInt) {
    throw new ApplicationError("INVALID_DAILY_QUEST_REWARD_COUNT", "❌ 일일보상횟수는 0 이상의 숫자로 입력해주세요.", 422);
  }
  return {
    targetDisplayName,
    towerAttempts: counts[0]!,
    castleBattleAttempts: counts[1]!,
    miniBattleAttempts: counts[2]!,
    exploreAttempts: counts[3]!,
    dailyRewardCount: counts[4]
  };
}

// 레거시 완료 문구와 카운트 표시 순서를 유지합니다.
export function formatDailyQuestCountAdminReply(command: DailyQuestCountAdminCommand): string {
  const freeUsed = command.castleBattleAttempts > 0n ? 1n : 0n;
  const rewardLine = command.dailyRewardCount === undefined ? "" : `\n일일보상횟수: ${command.dailyRewardCount.toString()}`;
  return `✅ 일퀘횟수 수정 완료\n대상: [${command.targetDisplayName}]\n시련탑😈: ${command.towerAttempts.toString()}/15\n캐대전🏆: ${command.castleBattleAttempts.toString()}/15 (무료대전 사용: ${freeUsed.toString()}/1)\n미대전🐹: ${command.miniBattleAttempts.toString()}/15\n펫탐험⛰️: ${command.exploreAttempts.toString()}/10${rewardLine}\n\n테스트 예시: /자동일퀘 또는 ㅇㅋㅋ`;
}

// KST 일일 퀘스트 카운트와 호환 카운터를 한 player lock 아래 원자 수정합니다.
export class DailyQuestCountAdminService {
  constructor(private readonly database: DatabaseClient) {}

  async update(input: {
    command: DailyQuestCountAdminCommand;
    idempotencyKey: string;
    sourceEventId: string;
    destinationId: string;
    operatorId: string;
  }): Promise<DailyQuestCountAdminResult> {
    const scope = "admin.daily_quest_count.update";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | DailyQuestCountAdminResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }

      const state = await prepareTarget(transaction, input.command.targetDisplayName, input.command.dailyRewardCount !== undefined);
      const before = toSnapshot(state);
      const after: DailyQuestCountSnapshot = {
        towerAttempts: input.command.towerAttempts.toString(),
        castleBattleAttempts: input.command.castleBattleAttempts.toString(),
        castleBattleFreeUsed: input.command.castleBattleAttempts > 0n ? "1" : "0",
        miniBattleAttempts: input.command.miniBattleAttempts.toString(),
        exploreAttempts: input.command.exploreAttempts.toString(),
        dailyRewardCount: input.command.dailyRewardCount?.toString() ?? before.dailyRewardCount,
        dailyQuestRewarded: input.command.dailyRewardCount === undefined ? before.dailyQuestRewarded : input.command.dailyRewardCount > 0n
      };
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const versionAfter = state.version + (changed ? 1n : 0n);
      if (changed) {
        const update = await transaction.execute(
          `UPDATE player_pet_daily_records
           SET tower_attempts=?,castle_battle_attempts=?,mini_battle_attempts=?,explore_attempts=?,daily_quest_rewarded=?,version=version+1,updated_at=UTC_TIMESTAMP(3)
           WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) AND version=?`,
          [after.towerAttempts, after.castleBattleAttempts, after.miniBattleAttempts, after.exploreAttempts, after.dailyQuestRewarded, state.player_id, state.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("DAILY_QUEST_COUNT_VERSION_CONFLICT", "일퀘횟수가 먼저 변경되었습니다.", 409);
        await updateCounter(transaction, state.player_id, "castle_battle_free_used", after.castleBattleFreeUsed);
        if (input.command.dailyRewardCount !== undefined) {
          await updateCounter(transaction, state.player_id, "daily_quest_reward_count", after.dailyRewardCount);
        }
      }

      const data = formatDailyQuestCountAdminReply(input.command);
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,'admin.daily_quest_count.update','success','Iris 총괄 운영자 /일퀘횟수수정',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, state.player_id, JSON.stringify({ changed, before, after, versionBefore: state.version.toString(), versionAfter: versionAfter.toString() })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_DAILY_QUEST_COUNT_UPDATE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO admin_daily_quest_count_mutations(operation_id,target_player_id,before_json,after_json,changed,version_before,version_after)
         VALUES (?,?,?,?,?,?,?)`,
        [operation.insertId, state.player_id, JSON.stringify(before), JSON.stringify(after), changed, state.version, versionAfter]
      );
      const result: DailyQuestCountAdminResult = {
        data,
        outboxId: outbox.insertId.toString(),
        targetPlayerId: state.player_id.toString(),
        targetDisplayName: input.command.targetDisplayName,
        before,
        after,
        changed
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}

interface DailyQuestCountRow {
  player_id: bigint;
  tower_attempts: string;
  castle_battle_attempts: string;
  mini_battle_attempts: string;
  explore_attempts: string;
  daily_quest_rewarded: number | bigint | boolean;
  version: bigint;
  castle_battle_free_used: string;
  daily_quest_reward_count: string;
}

// 표시명 중복을 차단하고 오늘의 일일 레코드 및 호환 카운터를 잠급니다.
async function prepareTarget(transaction: DatabaseTransaction, targetDisplayName: string, includeRewardCount: boolean): Promise<DailyQuestCountRow> {
  const targets = await transaction.query<Array<{ player_id: bigint }>>(
    `SELECT profile.player_id
     FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active'
     WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2`,
    [targetDisplayName]
  );
  if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", "❌ 존재하지 않는 유저입니다.", 404);
  if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기준 수정이 필요합니다.", 409);
  const playerId = targets[0]!.player_id;
  await transaction.execute(
    `INSERT INTO player_pet_daily_records(player_id,record_date)
     VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)))
     ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`,
    [playerId]
  );
  await ensureCounter(transaction, playerId, "castle_battle_free_used");
  if (includeRewardCount) await ensureCounter(transaction, playerId, "daily_quest_reward_count");
  const records = await transaction.query<Array<Omit<DailyQuestCountRow, "castle_battle_free_used" | "daily_quest_reward_count">>>(
    `SELECT player_id,CAST(tower_attempts AS CHAR) tower_attempts,CAST(castle_battle_attempts AS CHAR) castle_battle_attempts,
            CAST(mini_battle_attempts AS CHAR) mini_battle_attempts,CAST(explore_attempts AS CHAR) explore_attempts,daily_quest_rewarded,version
     FROM player_pet_daily_records
     WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) FOR UPDATE`,
    [playerId]
  );
  const counters = await transaction.query<Array<{ counter_code: string; value: string }>>(
    `SELECT counter_code,CAST(value AS CHAR) value FROM player_counters
     WHERE player_id=? AND period_key=DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d')
       AND counter_code IN ('castle_battle_free_used','daily_quest_reward_count') FOR UPDATE`,
    [playerId]
  );
  if (records[0] === undefined) throw new Error("Daily quest count row was not created.");
  const values = new Map(counters.map((row) => [row.counter_code, row.value]));
  return {
    ...records[0],
    castle_battle_free_used: values.get("castle_battle_free_used") ?? "0",
    daily_quest_reward_count: values.get("daily_quest_reward_count") ?? "0"
  };
}

// 일일 호환 카운터가 없을 때 0으로 생성합니다.
async function ensureCounter(transaction: DatabaseTransaction, playerId: bigint, counterCode: string): Promise<void> {
  await transaction.execute(
    `INSERT INTO player_counters(player_id,counter_code,period_key,value)
     VALUES (?,?,DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d'),0)
     ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`,
    [playerId, counterCode]
  );
}

// 잠긴 KST 일일 호환 카운터를 새 값으로 갱신합니다.
async function updateCounter(transaction: DatabaseTransaction, playerId: bigint, counterCode: string, value: string): Promise<void> {
  await transaction.execute(
    `UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3)
     WHERE player_id=? AND counter_code=? AND period_key=DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d')`,
    [value, playerId, counterCode]
  );
}

// 잠긴 DB row를 감사 및 응답용 불변 스냅샷으로 변환합니다.
function toSnapshot(row: DailyQuestCountRow): DailyQuestCountSnapshot {
  return {
    towerAttempts: row.tower_attempts,
    castleBattleAttempts: row.castle_battle_attempts,
    castleBattleFreeUsed: row.castle_battle_free_used,
    miniBattleAttempts: row.mini_battle_attempts,
    exploreAttempts: row.explore_attempts,
    dailyRewardCount: row.daily_quest_reward_count,
    dailyQuestRewarded: Boolean(row.daily_quest_rewarded)
  };
}

function isUnsignedDecimal(value: string): boolean {
  return /^\d+$/.test(value);
}
