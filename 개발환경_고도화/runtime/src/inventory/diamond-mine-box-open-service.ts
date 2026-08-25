import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/다이아박스오픈";
const SOURCE_ITEM_CODE = "ITEM-DIAMOND-MINE-BOX";
const REWARD_ITEM_CODE = "ITEM-RWD-053";

export interface DiamondMineBoxOpenCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface DiamondMineBoxOpenResult {
  status: "opened" | "no_box" | "ignored_unregistered";
  playerId?: string;
  openedQuantity?: string;
  sourceQuantity?: string;
  rewardQuantity?: string;
  outboxId?: string;
  auditId?: string;
  data?: string;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface ItemRow { id: bigint; code: string; }
interface StackRow { item_id: bigint; quantity: bigint | string; version: bigint | string; }

// 무인자 또는 양의 정수 수량을 가진 다이아박스오픈만 허용합니다.
export function isDiamondMineBoxOpenCommand(message: string | undefined): boolean {
  return message === COMMAND || (message !== undefined && /^\/다이아박스오픈\s+[1-9]\d*$/.test(message));
}

// 숫자형 입력도 exact command registry 항목으로 라우팅되도록 기본 명령으로 정규화합니다.
export function normalizeDiamondMineBoxOpenDispatchMessage(message: string): string {
  return isDiamondMineBoxOpenCommand(message) ? COMMAND : message;
}

// 원문의 선택 수량을 손실 없는 bigint로 변환합니다.
function requestedQuantity(message: string): bigint {
  if (message === COMMAND) return 1n;
  const match = /^\/다이아박스오픈\s+([1-9]\d*)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_DIAMOND_MINE_BOX_OPEN_COMMAND", "정확한 /다이아박스오픈 [수량]을 입력해주세요.", 422);
  return BigInt(match[1]!);
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | DiamondMineBoxOpenResult): DiamondMineBoxOpenResult {
  return typeof value === "string" ? JSON.parse(value) as DiamondMineBoxOpenResult : value;
}

// 동시 멱등성 insert 경합인지 확인합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 다이아 광산 박스를 다이아 상자로 고정 1:1 변환하고 두 원장을 함께 기록합니다.
export class DiamondMineBoxOpenService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: DiamondMineBoxOpenCommand): Promise<DiamondMineBoxOpenResult> {
    if (!isDiamondMineBoxOpenCommand(command.message)) {
      throw new ApplicationError("INVALID_DIAMOND_MINE_BOX_OPEN_COMMAND", "정확한 /다이아박스오픈 [수량]을 입력해주세요.", 422);
    }
    const requestQuantity = requestedQuantity(command.message);
    const key = eventKey(command.eventId);
    let replayScope: string | undefined;
    try {
      return await this.database.withTransaction(async (tx) => {
        const owners = await tx.query<OwnerRow[]>(
          `SELECT identity.id AS identity_id,identity.player_id
             FROM external_identities identity
            WHERE identity.provider_code='kakao' AND identity.external_user_id=?
              AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
          [command.externalUserId]
        );
        const owner = owners[0];
        if (owner === undefined) return { status: "ignored_unregistered" };
        replayScope = `inventory.diamond-mine-box-open:${owner.identity_id}`;
        const prior = await tx.query<Array<{ result_json: string | DiamondMineBoxOpenResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
          [replayScope, key]
        );
        if (prior[0]?.result_json !== undefined && prior[0]?.result_json !== null) return stored(prior[0].result_json);

        const operation = await tx.execute(
          "INSERT INTO operations (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
          [randomUUID(), replayScope, key, owner.identity_id]
        );
        const items = await tx.query<ItemRow[]>(
          "SELECT id,code FROM item_definitions WHERE code IN (?,?) AND active=TRUE AND stackable=TRUE ORDER BY id",
          [SOURCE_ITEM_CODE, REWARD_ITEM_CODE]
        );
        const sourceItem = items.find((item) => item.code === SOURCE_ITEM_CODE);
        const rewardItem = items.find((item) => item.code === REWARD_ITEM_CODE);
        if (sourceItem === undefined || rewardItem === undefined || sourceItem.id === rewardItem.id) {
          throw new ApplicationError("DIAMOND_MINE_BOX_DEFINITION_REQUIRED", "다이아 광산 박스 정의를 확인할 수 없습니다.", 409);
        }
        await tx.execute(
          "INSERT IGNORE INTO inventory_stacks (player_id,item_id,quantity,version) VALUES (?,?,0,0),(?,?,0,0)",
          [owner.player_id, sourceItem.id, owner.player_id, rewardItem.id]
        );
        const stacks = await tx.query<StackRow[]>(
          "SELECT item_id,quantity,version FROM inventory_stacks WHERE player_id=? AND item_id IN (?,?) ORDER BY item_id FOR UPDATE",
          [owner.player_id, sourceItem.id, rewardItem.id]
        );
        const sourceStack = stacks.find((stack) => stack.item_id === sourceItem.id);
        const rewardStack = stacks.find((stack) => stack.item_id === rewardItem.id);
        if (sourceStack === undefined || rewardStack === undefined) throw new Error("Diamond mine inventory stacks were not created.");
        const sourceQuantity = BigInt(sourceStack.quantity);
        const rewardQuantity = BigInt(rewardStack.quantity);
        const openedQuantity = sourceQuantity < requestQuantity ? sourceQuantity : requestQuantity;
        const nextSourceQuantity = sourceQuantity - openedQuantity;
        const nextRewardQuantity = rewardQuantity + openedQuantity;

        if (openedQuantity > 0n) {
          const writes = [
            { itemId: sourceItem.id, quantity: nextSourceQuantity, version: sourceStack.version },
            { itemId: rewardItem.id, quantity: nextRewardQuantity, version: rewardStack.version }
          ].sort((left, right) => left.itemId < right.itemId ? -1 : 1);
          for (const write of writes) {
            const result = await tx.execute(
              "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
              [write.quantity, owner.player_id, write.itemId, write.version]
            );
            if (result.affectedRows !== 1n) throw new ApplicationError("DIAMOND_MINE_BOX_OPEN_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
          }
          await tx.execute(
            "INSERT INTO inventory_ledger (operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'diamond_mine_box_consume'),(?,2,?,?,?,'diamond_mine_box_reward')",
            [operation.insertId, owner.player_id, sourceItem.id, (-openedQuantity).toString(), operation.insertId, owner.player_id, rewardItem.id, openedQuantity.toString()]
          );
        }

        const status = openedQuantity > 0n ? "opened" : "no_box";
        const data = status === "opened"
          ? `다이아 광산 박스 ${openedQuantity}개를 열어 다이아 상자 ${openedQuantity}개를 받았습니다.\n남은 광산 박스: ${nextSourceQuantity}개\n보유 다이아 상자: ${nextRewardQuantity}개`
          : "보유한 다이아 광산 박스가 없습니다.";
        const audit = await tx.execute(
          "INSERT INTO command_audit (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'inventory.diamond_mine_box_open',?,'Iris /다이아박스오픈',?,UTC_TIMESTAMP(3))",
          [operation.insertId, owner.identity_id, owner.player_id, status, JSON.stringify({ requestedQuantity: requestQuantity.toString(), openedQuantity: openedQuantity.toString(), sourceQuantity: nextSourceQuantity.toString(), rewardQuantity: nextRewardQuantity.toString() })]
        );
        await tx.execute(
          "INSERT INTO command_executions (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'inventory_diamond_mine_box_open',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [command.eventId, operation.insertId, status]
        );
        const outbox = await tx.execute(
          "INSERT INTO outbox_messages (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [operation.insertId, command.channelId, JSON.stringify({ data })]
        );
        const result: DiamondMineBoxOpenResult = {
          status, playerId: owner.player_id.toString(), openedQuantity: openedQuantity.toString(),
          sourceQuantity: nextSourceQuantity.toString(), rewardQuantity: nextRewardQuantity.toString(),
          outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data
        };
        await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error) || replayScope === undefined) throw error;
      const prior = await this.database.query<Array<{ result_json: string | DiamondMineBoxOpenResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?",
        [replayScope, key]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return stored(prior[0].result_json);
    }
  }
}
