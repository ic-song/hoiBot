import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/전체판매";

export interface InventoryBulkSellCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface InventoryBulkSellResult {
  status: "sold" | "nothing_to_sell" | "blocked_by_castle_siege" | "ignored_unregistered";
  playerId?: string;
  soldQuantity?: string;
  pointDelta?: string;
  pointBalance?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface SaleRow {
  item_id: bigint;
  code: string;
  display_name: string;
  quantity: bigint;
  version: bigint;
  unit_price: string;
}

// 인자나 접미사가 없는 전체판매 명령만 허용합니다.
export function isInventoryBulkSellCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | InventoryBulkSellResult): InventoryBulkSellResult {
  return typeof value === "string" ? JSON.parse(value) as InventoryBulkSellResult : value;
}

// 정수 DECIMAL 문자열을 손실 없는 bigint로 변환합니다.
function integer(value: string): bigint {
  const match = /^(-?\d+)(?:\.0+)?$/.exec(value);
  if (match === null) throw new ApplicationError("NON_INTEGER_BULK_SELL_VALUE", "판매 금액을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

// bigint 금액을 천 단위 쉼표 형식으로 표시합니다.
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 동시 멱등성 insert 경합인지 확인합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 판매 정책이 허용한 모든 stack을 포인트와 원장으로 원자 변환합니다.
export class InventoryBulkSellService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: InventoryBulkSellCommand): Promise<InventoryBulkSellResult> {
    if (!isInventoryBulkSellCommand(command.message)) {
      throw new ApplicationError("INVALID_INVENTORY_BULK_SELL_COMMAND", "정확한 /전체판매를 입력해주세요.", 422);
    }
    const key = eventKey(command.eventId);
    let replayScope: string | undefined;
    try {
      return await this.database.withTransaction(async (tx) => {
        const siege = await tx.query<Array<{ active_count: bigint }>>(
          "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
        );
        if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

        const owners = await tx.query<OwnerRow[]>(
          `SELECT identity.id AS identity_id, identity.player_id
           FROM external_identities identity
           WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
             AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
          [command.externalUserId]
        );
        const owner = owners[0];
        if (owner === undefined) return { status: "ignored_unregistered" };
        replayScope = `inventory.bulk-sell:${owner.identity_id}`;
        const prior = await tx.query<Array<{ result_json: string | InventoryBulkSellResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
          [replayScope, key]
        );
        if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

        const operation = await tx.execute(
          "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
          [randomUUID(), replayScope, key, owner.identity_id]
        );
        const stacks = await tx.query<SaleRow[]>(
          `SELECT stack.item_id,item.code,item.display_name,stack.quantity,stack.version,
                  CAST(policy.unit_price AS CHAR) AS unit_price
           FROM inventory_stacks stack
           JOIN item_definitions item ON item.id=stack.item_id
           JOIN item_sale_policies policy ON policy.item_id=item.id AND policy.sellable=TRUE
           WHERE stack.player_id=? AND stack.quantity>0 AND item.active=TRUE AND item.stackable=TRUE
           ORDER BY stack.item_id FOR UPDATE`,
          [owner.player_id]
        );

        let soldQuantity = 0n;
        let pointDelta = 0n;
        const soldItems: Array<{ itemCode: string; quantity: string; point: string }> = [];
        for (const stack of stacks) {
          const unitPrice = integer(stack.unit_price);
          if (unitPrice < 0n) throw new ApplicationError("INVALID_ITEM_SALE_POLICY", "아이템 판매 정책이 올바르지 않습니다.", 409);
          soldQuantity += stack.quantity;
          const itemPoint = stack.quantity * unitPrice;
          pointDelta += itemPoint;
          soldItems.push({ itemCode: stack.code, quantity: stack.quantity.toString(), point: itemPoint.toString() });
        }

        let pointBalance: bigint | undefined;
        if (stacks.length > 0) {
          await tx.execute("INSERT IGNORE INTO currency_accounts (player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [owner.player_id]);
          const accounts = await tx.query<Array<{ balance: string; version: bigint }>>(
            "SELECT CAST(balance AS CHAR) AS balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",
            [owner.player_id]
          );
          const account = accounts[0];
          if (account === undefined) throw new ApplicationError("POINT_ACCOUNT_REQUIRED", "포인트 계정을 찾을 수 없습니다.", 409);
          pointBalance = integer(account.balance) + pointDelta;
          for (let index = 0; index < stacks.length; index += 1) {
            const stack = stacks[index]!;
            const write = await tx.execute(
              "UPDATE inventory_stacks SET quantity=0,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
              [owner.player_id, stack.item_id, stack.version]
            );
            if (write.affectedRows !== 1n) throw new ApplicationError("INVENTORY_BULK_SELL_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
            await tx.execute(
              "INSERT INTO inventory_ledger (operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'inventory_bulk_sell')",
              [operation.insertId, index + 1, owner.player_id, stack.item_id, (-stack.quantity).toString()]
            );
          }
          const pointWrite = await tx.execute(
            "UPDATE currency_accounts SET balance=?,version=version+1 WHERE player_id=? AND currency_code='point' AND version=?",
            [pointBalance.toString(), owner.player_id, account.version]
          );
          if (pointWrite.affectedRows !== 1n) throw new ApplicationError("INVENTORY_BULK_SELL_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
          await tx.execute(
            "INSERT INTO currency_ledger (operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'inventory_bulk_sell')",
            [operation.insertId, owner.player_id, pointDelta.toString(), pointBalance.toString()]
          );
        }

        const status = stacks.length === 0 ? "nothing_to_sell" : "sold";
        const data = status === "sold"
          ? `가방 전체 판매가 완료되었습니다.\n판매 수량: ${soldQuantity}개\n획득 포인트: 🅟${commas(pointDelta)}`
          : "판매할 수 있는 아이템이 없습니다.";
        const outbox = await tx.execute(
          "INSERT INTO outbox_messages (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [operation.insertId, command.channelId, JSON.stringify({ data })]
        );
        await tx.execute(
          "INSERT INTO command_executions (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'inventory_bulk_sell',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [command.eventId, operation.insertId, status]
        );
        const audit = await tx.execute(
          "INSERT INTO command_audit (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'inventory.bulk_sell',?,'Iris /전체판매',?,UTC_TIMESTAMP(3))",
          [operation.insertId, owner.identity_id, owner.player_id, status, JSON.stringify({ soldQuantity: soldQuantity.toString(), pointDelta: pointDelta.toString(), soldItems })]
        );
        const result: InventoryBulkSellResult = {
          status, playerId: owner.player_id.toString(), soldQuantity: soldQuantity.toString(),
          pointDelta: pointDelta.toString(), pointBalance: pointBalance?.toString(),
          outboxId: outbox.insertId.toString(), data, auditId: audit.insertId.toString()
        };
        await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error) || replayScope === undefined) throw error;
      const prior = await this.database.query<Array<{ result_json: string | InventoryBulkSellResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?",
        [replayScope, key]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return stored(prior[0].result_json);
    }
  }
}
