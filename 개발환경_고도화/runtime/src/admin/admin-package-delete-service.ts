import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/선물삭제";
const PERMISSION_CODE = "game.inventory.free_support.delete";
const SCOPE = "admin.inventory.free_support.delete";
const LOCK_KEY = "free_hoi_support_package";
const ITEM_CODES = Array.from({ length: 10 }, (_, index) => `ITEM-FREE-HOI-SUPPORT-${String(index + 1).padStart(2, "0")}`);

interface OperatorRow { operator_id: bigint }
interface StackRow { player_id: bigint; item_id: bigint; quantity: bigint | string; version: bigint | string }
interface ReplayRow { result_json: string | AdminPackageDeleteResult | null }

export interface AdminPackageDeleteResult {
  status: "deleted";
  data: string;
  outboxId: string;
  affectedMemberCount: string;
  deletedStackCount: string;
  positiveQuantityTotal: string;
  minVariant: number;
  maxVariant: number;
}

// 선물삭제는 인자 없는 정확한 운영 명령만 실행 후보로 허용합니다.
export function isAdminPackageDeleteCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

export function normalizeAdminPackageDeleteDispatchMessage(message: string): string {
  return isAdminPackageDeleteCommand(message) ? COMMAND : message;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | AdminPackageDeleteResult): AdminPackageDeleteResult {
  return typeof value === "string" ? JSON.parse(value) as AdminPackageDeleteResult : value;
}

// 기존 범위·회원·양수 수량 집계를 운영자가 확인하기 쉬운 응답으로 유지합니다.
export function formatAdminPackageDeleteReply(affectedMemberCount: bigint, deletedStackCount: bigint, positiveQuantityTotal: bigint): string {
  return `🎁 무료 호이응원패키지 삭제 완료\n범위: [1] ~ [10]\n삭제 회원: ${affectedMemberCount}명\n삭제 항목: ${deletedStackCount}건\n삭제 수량: ${positiveQuantityTotal}개`;
}

// Admin/Master 권한을 RBAC permission으로 확인하고 전 회원 무료 패키지 stack을 원자 삭제합니다.
export class AdminPackageDeleteService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handle(input: { eventId: string; externalUserId: string; channelId?: string; destinationId?: string; message: string }): Promise<AdminPackageDeleteResult> {
    if (!isAdminPackageDeleteCommand(input.message)) {
      throw new ApplicationError("ADMIN_PACKAGE_DELETE_COMMAND_INVALID", "정확한 /선물삭제 명령을 입력해주세요.", 422);
    }
    const key = eventKey(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const operator = await this.requireOperator(transaction, input.externalUserId);
      await transaction.query(
        "SELECT version FROM admin_global_inventory_cleanup_locks WHERE lock_key=? FOR UPDATE",
        [LOCK_KEY]
      );
      const prior = (await transaction.query<ReplayRow[]>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [SCOPE, key]
      ))[0];
      if (prior?.result_json !== null && prior?.result_json !== undefined) return stored(prior.result_json);

      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, key, operator.operator_id]
      )).insertId;
      const definitions = await transaction.query<Array<{ id: bigint; code: string }>>(
        `SELECT id,code FROM item_definitions WHERE active=TRUE AND stackable=TRUE AND code IN (${ITEM_CODES.map(() => "?").join(",")}) ORDER BY code FOR UPDATE`,
        ITEM_CODES
      );
      if (definitions.length !== ITEM_CODES.length || definitions.some((row, index) => row.code !== ITEM_CODES[index])) {
        throw new ApplicationError("ADMIN_PACKAGE_DELETE_DEFINITION_REQUIRED", "무료 호이응원패키지 1~10번 정의를 확인할 수 없습니다.", 409);
      }
      const itemIds = definitions.map((row) => row.id);
      const stacks = await transaction.query<StackRow[]>(
        `SELECT player_id,item_id,quantity,version FROM inventory_stacks WHERE item_id IN (${itemIds.map(() => "?").join(",")}) ORDER BY player_id,item_id FOR UPDATE`,
        itemIds
      );
      const affectedPlayers = new Set<string>();
      let positiveQuantityTotal = 0n;
      let ledgerSequence = 0;
      for (let index = 0; index < stacks.length; index += 1) {
        const stack = stacks[index]!;
        const quantity = BigInt(stack.quantity);
        const counted = quantity > 0n ? quantity : 0n;
        affectedPlayers.add(stack.player_id.toString());
        positiveQuantityTotal += counted;
        await transaction.execute(
          "INSERT INTO admin_package_delete_changes(operation_id,sequence_no,player_id,item_id,quantity_before,counted_positive_quantity) VALUES (?,?,?,?,?,?)",
          [operationId, index + 1, stack.player_id, stack.item_id, quantity.toString(), counted.toString()]
        );
        if (counted > 0n) {
          ledgerSequence += 1;
          await transaction.execute(
            "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code,created_at) VALUES (?,?,?,?,?,'ADMIN_FREE_SUPPORT_PACKAGE_DELETE',UTC_TIMESTAMP(3))",
            [operationId, ledgerSequence, stack.player_id, stack.item_id, (-counted).toString()]
          );
        }
        const deleted = await transaction.execute(
          "DELETE FROM inventory_stacks WHERE player_id=? AND item_id=? AND version=?",
          [stack.player_id, stack.item_id, stack.version]
        );
        if (deleted.affectedRows !== 1n) throw new ApplicationError("ADMIN_PACKAGE_DELETE_CONFLICT", "회원 가방이 먼저 변경되었습니다.", 409);
      }

      const affectedMemberCount = BigInt(affectedPlayers.size);
      const deletedStackCount = BigInt(stacks.length);
      const data = formatAdminPackageDeleteReply(affectedMemberCount, deletedStackCount, positiveQuantityTotal);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.channelId ?? input.destinationId ?? "", JSON.stringify({ data })]
      );
      const result: AdminPackageDeleteResult = {
        status: "deleted",
        data,
        outboxId: outbox.insertId.toString(),
        affectedMemberCount: affectedMemberCount.toString(),
        deletedStackCount: deletedStackCount.toString(),
        positiveQuantityTotal: positiveQuantityTotal.toString(),
        minVariant: 1,
        maxVariant: 10
      };
      await transaction.execute(
        "INSERT INTO admin_package_delete_runs(operation_id,request_key,operator_id,min_variant,max_variant,affected_member_count,deleted_stack_count,positive_quantity_total,result_json) VALUES (?,?,?,?,?,?,?,?,?)",
        [operationId, key, operator.operator_id, 1, 10, affectedMemberCount.toString(), deletedStackCount.toString(), positiveQuantityTotal.toString(), JSON.stringify(result)]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_PACKAGE_DELETE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player_inventory_group',NULL,'admin.package_delete','success','Iris /선물삭제',?,UTC_TIMESTAMP(3))",
        [operationId, operator.operator_id, JSON.stringify({ minVariant: 1, maxVariant: 10, affectedMemberCount: result.affectedMemberCount, deletedStackCount: result.deletedStackCount, positiveQuantityTotal: result.positiveQuantityTotal, deletedItemCodes: ITEM_CODES })]
      );
      await transaction.execute(
        "UPDATE admin_global_inventory_cleanup_locks SET version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE lock_key=?",
        [LOCK_KEY]
      );
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }

  // 연결된 Kakao identity의 활성 Admin/Master permission을 확인합니다.
  private async requireOperator(transaction: DatabaseTransaction, externalUserId: string): Promise<OperatorRow> {
    const operator = (await transaction.query<OperatorRow[]>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=?
         AND identity.status='linked' AND operator.status='active'
         AND permission.permission_code=?
       ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`,
      [externalUserId, PERMISSION_CODE]
    ))[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "선물 삭제 권한이 없습니다.", 403);
    return operator;
  }
}
