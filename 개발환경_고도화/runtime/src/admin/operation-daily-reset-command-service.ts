import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { createCanonicalDomainItemProvider } from "../package/current-domain-package-runtime.js";
import type { ItemProvider } from "../package/item-provider.js";
import { ApplicationError } from "../shared/application-error.js";
import { CommonDailyResetProvider, dailyResetKstPeriodKey, type DailyResetResult } from "./common-daily-reset-provider.js";

const COMMAND_CODE = "OPERATION_DAILY_RESET";
const PERMISSION_CODE = "operation.daily_reset";
const FIXED_OPERATOR_NAMES = ["오픈채팅봇", "호이 남"] as const;
const TEMPORARY_ITEM_CODES = [
  "legacy_bag_ee475eca8a6543ef",
  "legacy_bag_8aa52459621254e1",
  "legacy_bag_c0feb66372020637",
] as const;
const COMPLETE_MESSAGE = "출첵시작! 리셋 완료";
const BROADCAST_MESSAGE = "출석체크가 시작 되었습니다!\nㅊㅊ 가즈아!!";

interface ResetProviderPort {
  reset(input: { eventId: string; operatorId: string; periodKey?: string }): Promise<DailyResetResult>;
}

interface ItemProviderPort {
  remove(itemId: string, quantity: bigint, context: Parameters<ItemProvider["remove"]>[2]): Promise<void>;
}

export interface OperationDailyResetReply { outboxId: string; room: string; data: string; }
export interface OperationDailyResetCommandResult {
  status: "changed";
  data: string;
  outboxId: string;
  replies: OperationDailyResetReply[];
  operationId: string;
  providerOperationId: string;
  removedTemporaryItemQuantity: string;
  replayed: boolean;
}

// 인자와 접미 문구가 없는 정확한 레거시 일일 초기화 명령만 허용합니다.
export function isOperationDailyResetCommand(message: string | undefined): boolean {
  return message === "/리셋";
}

// 레거시 현재방 완료 응답과 운영방 공지 문구를 보존합니다.
export function operationDailyResetMessages(): { complete: string; broadcast: string } {
  return { complete: COMPLETE_MESSAGE, broadcast: BROADCAST_MESSAGE };
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | OperationDailyResetCommandResult): OperationDailyResetCommandResult {
  return typeof value === "string" ? JSON.parse(value) as OperationDailyResetCommandResult : value;
}

// 공용 reset provider와 canonical item provider를 순서대로 소비해 중단 후 재실행 가능한 명령 경계를 제공합니다.
export class OperationDailyResetCommandService {
  private readonly resetProvider: ResetProviderPort;
  private readonly itemProviderFactory: (database: DatabaseClient) => ItemProviderPort;

  constructor(
    private readonly database: DatabaseClient,
    private readonly broadcastIds: string[],
    resetProvider?: ResetProviderPort,
    itemProviderFactory?: (database: DatabaseClient) => ItemProviderPort,
  ) {
    this.resetProvider = resetProvider ?? new CommonDailyResetProvider(database);
    this.itemProviderFactory = itemProviderFactory ?? createCanonicalDomainItemProvider;
  }

  async handleDispatchedIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<OperationDailyResetCommandResult | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }> {
    if (!isOperationDailyResetCommand(input.message)) return { status: "handled_no_reply" };
    const decision = await new CommandDispatcher(
      new MariaCommandDispatchRepository(this.database),
      { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() },
    ).resolve({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    return await this.execute(input) ?? { status: "handled_no_reply" };
  }

  async execute(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<OperationDailyResetCommandResult | null> {
    if (!isOperationDailyResetCommand(input.message)) return null;
    const operator = (await this.database.query<Array<{ operator_id: bigint; display_name: string }>>(
      `SELECT operator.id operator_id,operator.display_name
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
          AND operator.display_name IN (?,?)
          AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code=? AND denied.effect='deny')
          AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code=? AND allowed.effect='allow')
            OR EXISTS (SELECT 1 FROM admin_operator_roles assignment JOIN admin_roles role ON role.id=assignment.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code=? WHERE assignment.operator_id=operator.id))
        ORDER BY operator.id LIMIT 1`,
      [input.externalUserId, ...FIXED_OPERATOR_NAMES, PERMISSION_CODE, PERMISSION_CODE, PERMISSION_CODE],
    ))[0];
    if (operator === undefined) return null;

    const key = eventKey(input.eventId);
    const prior = (await this.database.query<Array<{ result_json: string | OperationDailyResetCommandResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope='operation.daily_reset.command' AND idempotency_key=? LIMIT 1",
      [key],
    ))[0];
    if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };

    const periodKey = dailyResetKstPeriodKey();
    const providerResult = await this.resetProvider.reset({ eventId: `${key}:provider`, operatorId: operator.operator_id.toString(), periodKey });
    return await this.database.withTransaction(async transaction => this.completeConsumer(transaction, input, operator, key, providerResult));
  }

  private async completeConsumer(
    transaction: DatabaseTransaction,
    input: { eventId: string; externalUserId: string; channelId: string },
    operator: { operator_id: bigint; display_name: string },
    key: string,
    providerResult: DailyResetResult,
  ): Promise<OperationDailyResetCommandResult> {
    const operation = await transaction.execute(
      "INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'operation.daily_reset.command',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), key, operator.operator_id],
    );
    if (operation.affectedRows === 0n) {
      const prior = (await transaction.query<Array<{ result_json: string | OperationDailyResetCommandResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='operation.daily_reset.command' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      throw new ApplicationError("DAILY_RESET_COMMAND_IN_PROGRESS", "일일 초기화가 처리 중입니다.", 409);
    }

    const rows = await transaction.query<Array<{ player_id: bigint; item_code: string; quantity: bigint }>>(
      `SELECT stack.player_id,item.code item_code,stack.quantity
         FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
        WHERE item.code IN (?,?,?) AND stack.quantity>0
        ORDER BY stack.player_id,item.code FOR UPDATE`,
      [...TEMPORARY_ITEM_CODES],
    );
    const scoped = createScopedDatabaseClient(transaction);
    const items = this.itemProviderFactory(scoped);
    let removedTemporaryItemQuantity = 0n;
    for (const row of rows) {
      await items.remove(row.item_code, row.quantity, {
        ownerType: "USER",
        ownerId: row.player_id.toString(),
        transactionId: operation.insertId.toString(),
        transactionHandle: transaction,
        requestKey: `${key}:${row.player_id.toString()}:${row.item_code}`,
        operation: "REMOVE",
      });
      removedTemporaryItemQuantity += row.quantity;
    }

    const replies: OperationDailyResetReply[] = [];
    const queue = async (room: string, data: string): Promise<void> => {
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, room, JSON.stringify({ data })],
      );
      replies.push({ outboxId: outbox.insertId.toString(), room, data });
    };
    await queue(input.channelId, COMPLETE_MESSAGE);
    for (const room of [...new Set(this.broadcastIds)]) await queue(room, BROADCAST_MESSAGE);

    await transaction.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [key, COMMAND_CODE, operation.insertId],
    );
    await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'daily_reset_run',?,'operation.daily_reset','success','Iris /리셋',?,UTC_TIMESTAMP(3))",
      [operation.insertId, operator.operator_id, providerResult.runId, JSON.stringify({ periodKey: providerResult.periodKey, providerOperationId: providerResult.operationId, providerReplayed: providerResult.replayed, removedTemporaryItemQuantity: removedTemporaryItemQuantity.toString(), broadcastCount: new Set(this.broadcastIds).size })],
    );
    const result: OperationDailyResetCommandResult = {
      status: "changed",
      data: COMPLETE_MESSAGE,
      outboxId: replies[0]!.outboxId,
      replies,
      operationId: operation.insertId.toString(),
      providerOperationId: providerResult.operationId,
      removedTemporaryItemQuantity: removedTemporaryItemQuantity.toString(),
      replayed: false,
    };
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
    return result;
  }
}
