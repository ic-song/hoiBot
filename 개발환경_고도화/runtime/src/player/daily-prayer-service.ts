import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "PLAYER_DAILY_PRAYER";
const COUNTER_CODE = "daily_prayer_used";
const REWARD_ITEM_CODE = "ITEM-RWD-048";
const REWARD_THRESHOLD = 0.03;

export interface DailyPrayerCompletedResult {
  status: "completed";
  rewarded: boolean;
  periodKey: string;
  roll: string;
  quantity?: string;
  auditId: string;
  data: string;
  outboxId: string;
}

export type DailyPrayerResult = DailyPrayerCompletedResult | {
  status: "ignored";
  reasonCode: "PRAYER_SKILL_REQUIRED" | "ALREADY_USED";
};

interface DailyPrayerOptions {
  random?: () => number;
  now?: () => Date;
}

interface DailyPrayerCommand {
  playerId: string;
  channelId: string;
  eventId: string;
}

// `/기도`의 일일 1회 처리, RNG 추적, 선택 보상을 하나의 DB 트랜잭션으로 실행합니다.
export class DailyPrayerService {
  private readonly random: () => number;
  private readonly now: () => Date;

  constructor(private readonly database: DatabaseClient, options: DailyPrayerOptions = {}) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
  }

  async execute(command: DailyPrayerCommand): Promise<DailyPrayerResult> {
    const periodKey = dailyPrayerPeriodKey(this.now());
    const scope = `player.daily_prayer:${command.playerId}`;
    try {
      return await this.database.withTransaction(async (transaction) => {
        const prior = await transaction.query<Array<{ result_json: string | DailyPrayerCompletedResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
          [scope, command.eventId]
        );
        if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
          return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
        }

        const skills = await transaction.query<Array<{ equipped: number }>>(
          `SELECT 1 AS equipped
             FROM player_pets pet
             JOIN pet_skills equipped_skill ON equipped_skill.player_pet_id = pet.id AND equipped_skill.equipped = TRUE
             JOIN skill_definitions skill ON skill.id = equipped_skill.skill_id AND skill.active = TRUE
            WHERE pet.player_id = ? AND skill.code = 'SKILL-PRAYER'
            LIMIT 1`,
          [command.playerId]
        );
        if (skills[0] === undefined) return { status: "ignored", reasonCode: "PRAYER_SKILL_REQUIRED" };

        const counters = await transaction.query<Array<{ value: bigint }>>(
          `SELECT value FROM player_counters
            WHERE player_id = ? AND counter_code = ? AND period_key = ? FOR UPDATE`,
          [command.playerId, COUNTER_CODE, periodKey]
        );
        if (counters[0] !== undefined) return { status: "ignored", reasonCode: "ALREADY_USED" };

        const operation = await transaction.execute(
          `INSERT INTO operations
            (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
           VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))`,
          [randomUUID(), scope, command.eventId, command.playerId]
        );
        await transaction.execute(
          `INSERT INTO player_counters (player_id,counter_code,period_key,value,updated_at)
           VALUES (?,?,?,1,UTC_TIMESTAMP(3))`,
          [command.playerId, COUNTER_CODE, periodKey]
        );

        const roll = this.random();
        if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
          throw new ApplicationError("INVALID_RNG_SAMPLE", "기도 확률 표본이 유효하지 않습니다.", 500);
        }
        const rewarded = roll < REWARD_THRESHOLD;
        await transaction.execute(
          `INSERT INTO rng_events
            (operation_id,player_id,event_code,period_key,sample_value,threshold_value,outcome_code,created_at)
           VALUES (?,?,'daily_prayer',?,?,?,?,UTC_TIMESTAMP(3))`,
          [operation.insertId, command.playerId, periodKey, roll.toFixed(17), REWARD_THRESHOLD.toFixed(17), rewarded ? "reward" : "no_reward"]
        );

        let quantity: string | undefined;
        if (rewarded) {
          const items = await transaction.query<Array<{ id: bigint }>>(
            "SELECT id FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE",
            [REWARD_ITEM_CODE]
          );
          const item = items[0];
          if (item === undefined) throw new ApplicationError("PRAYER_REWARD_ITEM_NOT_FOUND", "기도 보상 아이템을 찾을 수 없습니다.", 404);
          await transaction.execute(
            "INSERT IGNORE INTO inventory_stacks (player_id,item_id,quantity,version) VALUES (?,?,0,0)",
            [command.playerId, item.id]
          );
          const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
            "SELECT quantity,version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE",
            [command.playerId, item.id]
          );
          const stack = stacks[0];
          if (stack === undefined) throw new Error("Daily prayer reward stack was not created.");
          const nextQuantity = stack.quantity + 1n;
          const update = await transaction.execute(
            "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
            [nextQuantity, command.playerId, item.id, stack.version]
          );
          if (update.affectedRows !== 1n) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
          await transaction.execute(
            `INSERT INTO inventory_ledger
              (operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code)
             VALUES (?,1,?,?,1,'daily_prayer_reward')`,
            [operation.insertId, command.playerId, item.id]
          );
          quantity = nextQuantity.toString();
        }

        const data = formatDailyPrayerReply(rewarded);
        const audit = await transaction.execute(
          `INSERT INTO command_audit
            (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
           VALUES (?,'player',?,'player',?,'player.daily_prayer','success','Iris /기도',?,UTC_TIMESTAMP(3))`,
          [operation.insertId, command.playerId, command.playerId,
            JSON.stringify({ periodKey, roll: roll.toFixed(17), threshold: REWARD_THRESHOLD.toFixed(17), rewarded, rewardItemCode: rewarded ? REWARD_ITEM_CODE : null, quantity: quantity ?? null })]
        );
        await transaction.execute(
          `INSERT INTO command_executions
            (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
           VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [command.eventId, "player_daily_prayer", operation.insertId]
        );
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
           VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [operation.insertId, command.channelId, JSON.stringify({ data })]
        );
        const result: DailyPrayerCompletedResult = {
          status: "completed", rewarded, periodKey, roll: roll.toFixed(17), quantity,
          auditId: audit.insertId.toString(), data, outboxId: outbox.insertId.toString()
        };
        await transaction.execute(
          "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [JSON.stringify(result), operation.insertId]
        );
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const prior = await this.database.query<Array<{ result_json: string | DailyPrayerCompletedResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?",
        [scope, command.eventId]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
    }
  }
}

// rollout과 Kakao 연결 회원을 확인한 뒤 일일 기도 provider를 호출합니다.
export class DailyPrayerIrisCommandService {
  constructor(private readonly database: DatabaseClient, private readonly options: DailyPrayerOptions = {}) {}

  async execute(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    DailyPrayerResult | { status: "shadow" | "legacy_fallback" }
  > {
    if (!isDailyPrayerCommand(input.message)) throw new ApplicationError("INVALID_DAILY_PRAYER_COMMAND", "기도 명령 형식이 올바르지 않습니다.", 422);
    const definitions = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code = ? LIMIT 1", [COMMAND_CODE]
    );
    const definition = definitions[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: COMMAND_CODE });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: COMMAND_CODE });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: COMMAND_CODE });
    const players = await this.database.query<Array<{ player_id: bigint }>>(
      `SELECT identity.player_id
         FROM external_identities identity
         JOIN players player ON player.id = identity.player_id AND player.status = 'active'
        WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
          AND identity.status = 'linked' AND identity.player_id IS NOT NULL
        LIMIT 1`,
      [input.externalUserId]
    );
    const player = players[0];
    if (player === undefined) return { status: "ignored", reasonCode: "PRAYER_SKILL_REQUIRED" };
    return new DailyPrayerService(this.database, this.options).execute({
      playerId: player.player_id.toString(), channelId: input.channelId, eventId: input.eventId
    });
  }
}

// KST 날짜를 일일 기도 중복 차단 period key로 변환합니다.
export function dailyPrayerPeriodKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// exact `/기도`만 현대화 후보로 인정합니다.
export function isDailyPrayerCommand(message: string | undefined): boolean {
  return message === "/기도";
}

// 기도 RNG 결과를 사용자 응답 문구로 변환합니다.
export function formatDailyPrayerReply(rewarded: boolean): string {
  return rewarded
    ? "🙏 기도가 이루어졌습니다.\n주간상자🌼 1개를 획득했습니다."
    : "🙏 기도를 드렸지만 아무 일도 일어나지 않았습니다.";
}

// 동시 idempotency operation 생성 경합만 완료 결과 재조회 대상으로 판별합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}
