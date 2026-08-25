import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMANDS = {
  "/양계장박스오픈": "INVENTORY_CHICKEN_DUNGEON_BOX_OPEN",
  "/샵오픈박스오픈": "INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN"
} as const;

type FixedRewardCommand = keyof typeof COMMANDS;

export interface FixedRewardBoxOpenCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface FixedRewardBoxOpenResult {
  status: "opened" | "no_box" | "ignored_unregistered";
  playerId?: string;
  commandCode?: string;
  openedQuantity?: string;
  sourceQuantity?: string;
  rewardQuantity?: string;
  rewardBalance?: string;
  outboxId?: string;
  auditId?: string;
  data?: string;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface RuleRow {
  command_code: string;
  source_item_id: bigint;
  source_display_name: string;
  reward_item_id: bigint;
  reward_display_name: string;
  reward_quantity: bigint | string;
}
interface StackRow { item_id: bigint; quantity: bigint | string; version: bigint | string; }

// 지원 명령의 기본형 또는 양의 정수 수량형만 허용합니다.
export function isFixedRewardBoxOpenCommand(message: string | undefined): boolean {
  if (message === undefined) return false;
  return Object.keys(COMMANDS).some((command) => message === command || new RegExp(`^${command}\\s+[1-9]\\d*$`).test(message));
}

// 숫자형 입력을 command registry의 기본 별칭으로 정규화합니다.
export function normalizeFixedRewardBoxOpenDispatchMessage(message: string): string {
  for (const command of Object.keys(COMMANDS) as FixedRewardCommand[]) {
    if (message === command || new RegExp(`^${command}\\s+[1-9]\\d*$`).test(message)) return command;
  }
  return message;
}

// 정규화된 명령과 요청 수량을 손실 없는 bigint로 반환합니다.
function parseCommand(message: string): { command: FixedRewardCommand; commandCode: string; requested: bigint } {
  for (const command of Object.keys(COMMANDS) as FixedRewardCommand[]) {
    if (message === command) return { command, commandCode: COMMANDS[command], requested: 1n };
    const match = new RegExp(`^${command}\\s+([1-9]\\d*)$`).exec(message);
    if (match !== null) return { command, commandCode: COMMANDS[command], requested: BigInt(match[1]!) };
  }
  throw new ApplicationError("INVALID_FIXED_REWARD_BOX_OPEN_COMMAND", "정확한 박스오픈 명령과 수량을 입력해주세요.", 422);
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | FixedRewardBoxOpenResult): FixedRewardBoxOpenResult {
  return typeof value === "string" ? JSON.parse(value) as FixedRewardBoxOpenResult : value;
}

// 동시 멱등성 insert 경합인지 확인합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// DB seed 규칙에 따라 고정 보상 박스를 소비하고 보상을 원자 지급합니다.
export class FixedRewardBoxOpenService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: FixedRewardBoxOpenCommand): Promise<FixedRewardBoxOpenResult> {
    const parsed = parseCommand(input.message);
    const key = eventKey(input.eventId);
    let replayScope: string | undefined;
    try {
      return await this.database.withTransaction(async (tx) => {
        const owners = await tx.query<OwnerRow[]>(
          `SELECT identity.id AS identity_id,identity.player_id FROM external_identities identity
            WHERE identity.provider_code='kakao' AND identity.external_user_id=?
              AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`, [input.externalUserId]
        );
        const owner = owners[0];
        if (owner === undefined) return { status: "ignored_unregistered" };
        replayScope = `inventory.fixed-reward-box-open:${owner.identity_id}`;
        const prior = await tx.query<Array<{ result_json: string | FixedRewardBoxOpenResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [replayScope, key]
        );
        if (prior[0]?.result_json !== undefined && prior[0]?.result_json !== null) return stored(prior[0].result_json);
        const operation = await tx.execute(
          "INSERT INTO operations (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
          [randomUUID(), replayScope, key, owner.identity_id]
        );
        const rules = await tx.query<RuleRow[]>(
          `SELECT rule.command_code,source.id AS source_item_id,source.display_name AS source_display_name,
                  reward.id AS reward_item_id,reward.display_name AS reward_display_name,rule.reward_quantity
             FROM fixed_reward_box_rules rule
             JOIN item_definitions source ON source.code=rule.source_item_code AND source.active=TRUE AND source.stackable=TRUE
             JOIN item_definitions reward ON reward.code=rule.reward_item_code AND reward.active=TRUE AND reward.stackable=TRUE
            WHERE rule.command_code=? AND rule.active=TRUE FOR UPDATE`, [parsed.commandCode]
        );
        const rule = rules[0];
        if (rule === undefined || rule.source_item_id === rule.reward_item_id) {
          throw new ApplicationError("FIXED_REWARD_BOX_RULE_REQUIRED", "고정 보상 박스 설정을 확인할 수 없습니다.", 409);
        }
        await tx.execute(
          "INSERT IGNORE INTO inventory_stacks (player_id,item_id,quantity,version) VALUES (?,?,0,0),(?,?,0,0)",
          [owner.player_id, rule.source_item_id, owner.player_id, rule.reward_item_id]
        );
        const stacks = await tx.query<StackRow[]>(
          "SELECT item_id,quantity,version FROM inventory_stacks WHERE player_id=? AND item_id IN (?,?) ORDER BY item_id FOR UPDATE",
          [owner.player_id, rule.source_item_id, rule.reward_item_id]
        );
        const source = stacks.find((row) => row.item_id === rule.source_item_id);
        const reward = stacks.find((row) => row.item_id === rule.reward_item_id);
        if (source === undefined || reward === undefined) throw new Error("Fixed reward box inventory stacks were not created.");
        const owned = BigInt(source.quantity);
        const opened = owned < parsed.requested ? owned : parsed.requested;
        const rewardDelta = opened * BigInt(rule.reward_quantity);
        const nextSource = owned - opened;
        const nextReward = BigInt(reward.quantity) + rewardDelta;

        if (opened > 0n) {
          const writes = [
            { itemId: rule.source_item_id, quantity: nextSource, version: source.version },
            { itemId: rule.reward_item_id, quantity: nextReward, version: reward.version }
          ].sort((left, right) => left.itemId < right.itemId ? -1 : 1);
          for (const write of writes) {
            const result = await tx.execute(
              "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
              [write.quantity.toString(), owner.player_id, write.itemId, write.version]
            );
            if (result.affectedRows !== 1n) throw new ApplicationError("FIXED_REWARD_BOX_OPEN_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
          }
          await tx.execute(
            "INSERT INTO inventory_ledger (operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'fixed_reward_box_open_source'),(?,2,?,?,?,'fixed_reward_box_open_reward')",
            [operation.insertId, owner.player_id, rule.source_item_id, (-opened).toString(), operation.insertId, owner.player_id, rule.reward_item_id, rewardDelta.toString()]
          );
        }

        const status = opened > 0n ? "opened" : "no_box";
        const data = status === "opened"
          ? `${rule.source_display_name} ${opened}개를 열어 ${rule.reward_display_name} ${rewardDelta}개를 받았습니다.\n남은 박스: ${nextSource}개\n보유 보상: ${nextReward}개`
          : `보유한 ${rule.source_display_name}가 없습니다.`;
        const audit = await tx.execute(
          "INSERT INTO command_audit (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'inventory.fixed_reward_box_open',?,'Iris fixed reward box open',?,UTC_TIMESTAMP(3))",
          [operation.insertId, owner.identity_id, owner.player_id, status, JSON.stringify({ command: parsed.command, commandCode: parsed.commandCode, requestedQuantity: parsed.requested.toString(), openedQuantity: opened.toString(), sourceQuantity: nextSource.toString(), rewardQuantity: rewardDelta.toString(), rewardBalance: nextReward.toString() })]
        );
        await tx.execute(
          "INSERT INTO command_executions (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [input.eventId, parsed.commandCode.toLowerCase(), operation.insertId, status]
        );
        const outbox = await tx.execute(
          "INSERT INTO outbox_messages (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [operation.insertId, input.channelId, JSON.stringify({ data })]
        );
        const result: FixedRewardBoxOpenResult = {
          status, playerId: owner.player_id.toString(), commandCode: parsed.commandCode,
          openedQuantity: opened.toString(), sourceQuantity: nextSource.toString(), rewardQuantity: rewardDelta.toString(),
          rewardBalance: nextReward.toString(), outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data
        };
        await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error) || replayScope === undefined) throw error;
      const prior = await this.database.query<Array<{ result_json: string | FixedRewardBoxOpenResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [replayScope, key]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return stored(prior[0].result_json);
    }
  }
}
