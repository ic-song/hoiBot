import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/다이아조합";
const MATERIAL_ITEM_CODE = "ITEM-RWD-052";
const RESULT_ITEM_CODE = "ITEM-RWD-053";
const POINT_CURRENCY_CODE = "point";
const POINT_COST_PER_CRAFT = 500_000_000n;

export interface DiamondBoxCraftCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface DiamondBoxCraftResult {
  status: "crafted" | "insufficient_stone" | "insufficient_point" | "ignored_unregistered";
  playerId?: string;
  craftQuantity?: string;
  stoneQuantity?: string;
  pointBalance?: string;
  boxQuantity?: string;
  outboxId?: string;
  auditId?: string;
  data?: string;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface ItemRow { id: bigint; code: string; }
interface StackRow { item_id: bigint; quantity: bigint | string; version: bigint | string; }

// 무인자 또는 양의 정수 수량을 가진 다이아조합만 허용합니다.
export function isDiamondBoxCraftCommand(message: string | undefined): boolean {
  return message === COMMAND || (message !== undefined && /^\/다이아조합\s+[1-9]\d*$/.test(message));
}

// 숫자형 입력도 exact command registry 항목으로 라우팅되도록 기본 명령으로 정규화합니다.
export function normalizeDiamondBoxCraftDispatchMessage(message: string): string {
  return isDiamondBoxCraftCommand(message) ? COMMAND : message;
}

// 원문의 조합 수량을 손실 없는 bigint로 변환합니다.
function requestedQuantity(message: string): bigint {
  if (message === COMMAND) return 1n;
  const match = /^\/다이아조합\s+([1-9]\d*)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_DIAMOND_BOX_CRAFT_COMMAND", "정확한 /다이아조합 [수량]을 입력해주세요.", 422);
  return BigInt(match[1]!);
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | DiamondBoxCraftResult): DiamondBoxCraftResult {
  return typeof value === "string" ? JSON.parse(value) as DiamondBoxCraftResult : value;
}

// DECIMAL 정수 문자열을 손실 없는 bigint로 변환합니다.
function integer(value: string): bigint {
  const match = /^(-?\d+)(?:\.0+)?$/.exec(value);
  if (match === null) throw new ApplicationError("NON_INTEGER_POINT_BALANCE", "포인트 잔액을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

// 동시 멱등성 insert 경합인지 확인합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 전설의 돌맹이와 포인트를 다이아 상자로 고정 조합하고 세 원장을 원자 기록합니다.
export class DiamondBoxCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: DiamondBoxCraftCommand): Promise<DiamondBoxCraftResult> {
    if (!isDiamondBoxCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_DIAMOND_BOX_CRAFT_COMMAND", "정확한 /다이아조합 [수량]을 입력해주세요.", 422);
    }
    const craftQuantity = requestedQuantity(command.message);
    const pointCost = craftQuantity * POINT_COST_PER_CRAFT;
    const key = eventKey(command.eventId);
    let replayScope: string | undefined;
    try {
      return await this.database.withTransaction(async (tx) => {
        const owners = await tx.query<OwnerRow[]>(
          `SELECT identity.id AS identity_id,identity.player_id FROM external_identities identity
            WHERE identity.provider_code='kakao' AND identity.external_user_id=?
              AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`, [command.externalUserId]
        );
        const owner = owners[0];
        if (owner === undefined) return { status: "ignored_unregistered" };
        replayScope = `crafting.diamond-box:${owner.identity_id}`;
        const prior = await tx.query<Array<{ result_json: string | DiamondBoxCraftResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [replayScope, key]
        );
        if (prior[0]?.result_json !== undefined && prior[0]?.result_json !== null) return stored(prior[0].result_json);
        const operation = await tx.execute(
          "INSERT INTO operations (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
          [randomUUID(), replayScope, key, owner.identity_id]
        );

        const items = await tx.query<ItemRow[]>(
          "SELECT id,code FROM item_definitions WHERE code IN (?,?) AND active=TRUE AND stackable=TRUE ORDER BY id",
          [MATERIAL_ITEM_CODE, RESULT_ITEM_CODE]
        );
        const materialItem = items.find((item) => item.code === MATERIAL_ITEM_CODE);
        const resultItem = items.find((item) => item.code === RESULT_ITEM_CODE);
        if (materialItem === undefined || resultItem === undefined || materialItem.id === resultItem.id) {
          throw new ApplicationError("DIAMOND_BOX_CRAFT_DEFINITION_REQUIRED", "다이아 조합 아이템 정의를 확인할 수 없습니다.", 409);
        }
        await tx.execute("INSERT IGNORE INTO inventory_stacks (player_id,item_id,quantity,version) VALUES (?,?,0,0),(?,?,0,0)",
          [owner.player_id, materialItem.id, owner.player_id, resultItem.id]);
        const stacks = await tx.query<StackRow[]>(
          "SELECT item_id,quantity,version FROM inventory_stacks WHERE player_id=? AND item_id IN (?,?) ORDER BY item_id FOR UPDATE",
          [owner.player_id, materialItem.id, resultItem.id]
        );
        const materialStack = stacks.find((stack) => stack.item_id === materialItem.id);
        const resultStack = stacks.find((stack) => stack.item_id === resultItem.id);
        if (materialStack === undefined || resultStack === undefined) throw new Error("Diamond craft inventory stacks were not created.");
        const stoneQuantity = BigInt(materialStack.quantity);
        const boxQuantity = BigInt(resultStack.quantity);

        await tx.execute("INSERT IGNORE INTO currency_accounts (player_id,currency_code,balance,version) VALUES (?,?,0,0)", [owner.player_id, POINT_CURRENCY_CODE]);
        const accounts = await tx.query<Array<{ balance: string; version: bigint | string }>>(
          "SELECT CAST(balance AS CHAR) AS balance,version FROM currency_accounts WHERE player_id=? AND currency_code=? FOR UPDATE",
          [owner.player_id, POINT_CURRENCY_CODE]
        );
        const account = accounts[0];
        if (account === undefined) throw new ApplicationError("POINT_ACCOUNT_REQUIRED", "포인트 계정을 찾을 수 없습니다.", 409);
        const pointBalance = integer(account.balance);

        let status: DiamondBoxCraftResult["status"];
        let nextStone = stoneQuantity;
        let nextPoint = pointBalance;
        let nextBox = boxQuantity;
        if (stoneQuantity < craftQuantity) status = "insufficient_stone";
        else if (pointBalance < pointCost) status = "insufficient_point";
        else {
          status = "crafted";
          nextStone -= craftQuantity;
          nextPoint -= pointCost;
          nextBox += craftQuantity;
          const writes = [
            { itemId: materialItem.id, quantity: nextStone, version: materialStack.version },
            { itemId: resultItem.id, quantity: nextBox, version: resultStack.version }
          ].sort((left, right) => left.itemId < right.itemId ? -1 : 1);
          for (const write of writes) {
            const result = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
              [write.quantity, owner.player_id, write.itemId, write.version]);
            if (result.affectedRows !== 1n) throw new ApplicationError("DIAMOND_BOX_CRAFT_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
          }
          const pointWrite = await tx.execute(
            "UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code=? AND version=?",
            [nextPoint.toString(), owner.player_id, POINT_CURRENCY_CODE, account.version]
          );
          if (pointWrite.affectedRows !== 1n) throw new ApplicationError("DIAMOND_BOX_CRAFT_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
          await tx.execute(
            "INSERT INTO inventory_ledger (operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'diamond_box_craft_material'),(?,2,?,?,?,'diamond_box_craft_result')",
            [operation.insertId, owner.player_id, materialItem.id, (-craftQuantity).toString(), operation.insertId, owner.player_id, resultItem.id, craftQuantity.toString()]
          );
          await tx.execute(
            "INSERT INTO currency_ledger (operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,?,?,?, 'diamond_box_craft_cost')",
            [operation.insertId, owner.player_id, POINT_CURRENCY_CODE, (-pointCost).toString(), nextPoint.toString()]
          );
        }

        const data = status === "crafted"
          ? `다이아 상자 ${craftQuantity}개를 조합했습니다.\n남은 전설의 돌맹이: ${nextStone}개\n남은 포인트: ${nextPoint}\n보유 다이아 상자: ${nextBox}개`
          : status === "insufficient_stone" ? "전설의 돌맹이가 부족합니다." : "포인트가 부족합니다.";
        const audit = await tx.execute(
          "INSERT INTO command_audit (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'crafting.diamond_box',?,'Iris /다이아조합',?,UTC_TIMESTAMP(3))",
          [operation.insertId, owner.identity_id, owner.player_id, status, JSON.stringify({ craftQuantity: craftQuantity.toString(), pointCost: pointCost.toString(), stoneQuantity: nextStone.toString(), pointBalance: nextPoint.toString(), boxQuantity: nextBox.toString() })]
        );
        await tx.execute("INSERT INTO command_executions (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'diamond_box_craft',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [command.eventId, operation.insertId, status]);
        const outbox = await tx.execute("INSERT INTO outbox_messages (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [operation.insertId, command.channelId, JSON.stringify({ data })]);
        const result: DiamondBoxCraftResult = { status, playerId: owner.player_id.toString(), craftQuantity: craftQuantity.toString(),
          stoneQuantity: nextStone.toString(), pointBalance: nextPoint.toString(), boxQuantity: nextBox.toString(),
          outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data };
        await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error) || replayScope === undefined) throw error;
      const prior = await this.database.query<Array<{ result_json: string | DiamondBoxCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [replayScope, key]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return stored(prior[0].result_json);
    }
  }
}
