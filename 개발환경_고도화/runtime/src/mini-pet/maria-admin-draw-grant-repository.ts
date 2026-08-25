import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  ADMIN_DRAW_GRANT_ACTOR_NAME, ADMIN_DRAW_GRANT_QUANTITY,
  type AdminDrawGrantCommand, type AdminDrawGrantRepository, type AdminDrawGrantResult
} from "./admin-draw-grant-service.js";

const TICKET_CODE = "bag_3241894752b82f7a";
const TICKET_NAME = "미니펫뽑기🐹(/미니펫오픈)";

interface OperatorRow { operator_id: bigint; display_name: string; }
interface TargetRow { operator_id: bigint; player_id: bigint; current_display_name: string; }

// 긴 event ID를 operations key 길이 안에서 안정적으로 표현합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 동일 지급 DTO로 복원합니다.
function stored(value: string | AdminDrawGrantResult): AdminDrawGrantResult {
  return typeof value === "string" ? JSON.parse(value) as AdminDrawGrantResult : value;
}

// operation unique 충돌만 완료 결과 재조회 경로로 전환합니다.
function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

// 관리자 대상 snapshot, 티켓 지급, 두 원장, 감사와 응답을 한 transaction으로 저장합니다.
export class MariaAdminDrawGrantRepository implements AdminDrawGrantRepository {
  constructor(private readonly database: DatabaseClient) {}

  async grant(command: AdminDrawGrantCommand): Promise<AdminDrawGrantResult> {
    try {
      return await this.database.withTransaction((tx) => this.grantTransaction(tx, command, false));
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return this.database.withTransaction((tx) => this.grantTransaction(tx, command, true));
    }
  }

  // actor와 대상 관리자 집합을 잠그고 중복 replay 또는 신규 batch grant를 처리합니다.
  private async grantTransaction(tx: DatabaseTransaction, command: AdminDrawGrantCommand, collisionReplay: boolean): Promise<AdminDrawGrantResult> {
    const operators = await tx.query<OperatorRow[]>(
      `SELECT operator.id AS operator_id, operator.display_name
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
       JOIN admin_operators operator ON operator.id = mapping.operator_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
         AND operator.status = 'active' AND operator.display_name = ? LIMIT 1 FOR UPDATE`,
      [command.externalUserId, ADMIN_DRAW_GRANT_ACTOR_NAME]
    );
    const operator = operators[0];
    if (operator === undefined) return { status: "ignored_forbidden" };
    const scope = `admin.minipet_draw_grant:${operator.operator_id}`;
    const key = eventKey(command.eventId);
    const prior = await tx.query<Array<{ result_json: string | AdminDrawGrantResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);
    if (collisionReplay) throw new ApplicationError("ADMIN_DRAW_GRANT_REPLAY_INCOMPLETE", "이전 상여 지급 결과가 아직 완료되지 않았습니다.", 409);

    const targetRows = await tx.query<TargetRow[]>(
      `SELECT operator.id AS operator_id, identity.player_id, profile.current_display_name
       FROM admin_operators operator
       JOIN admin_operator_external_identities mapping ON mapping.operator_id = operator.id
       JOIN external_identities identity ON identity.id = mapping.external_identity_id
       JOIN player_profiles profile ON profile.player_id = identity.player_id
       WHERE operator.status = 'active' AND identity.status = 'linked' AND identity.player_id IS NOT NULL
       ORDER BY operator.id, identity.id FOR UPDATE`
    );
    const targets = targetRows.filter((target, index) => targetRows.findIndex((row) => row.player_id === target.player_id) === index);
    const items = await tx.query<Array<{ id: bigint; code: string }>>(
      "SELECT id, code FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE FOR UPDATE", [TICKET_CODE]
    );
    const item = items[0];
    if (item === undefined) throw new ApplicationError("MINIPET_DRAW_TICKET_NOT_FOUND", "미니펫 뽑기권 item 정의가 없습니다.", 409);
    const operation = await tx.execute(
      `INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
       VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
      [randomUUID(), scope, key, operator.operator_id]
    );

    const recipients: NonNullable<AdminDrawGrantResult["recipients"]> = [];
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]!;
      await tx.execute("INSERT IGNORE INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, 0, 0)", [target.player_id, item.id]);
      const stacks = await tx.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE", [target.player_id, item.id]
      );
      const stack = stacks[0]!;
      const quantity = stack.quantity + ADMIN_DRAW_GRANT_QUANTITY;
      const update = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [quantity, target.player_id, item.id, stack.version]
      );
      if (update.affectedRows !== 1n) throw new ApplicationError("ADMIN_DRAW_GRANT_CONFLICT", "관리자 티켓 수량이 먼저 변경되었습니다.", 409);
      const sequence = index + 1;
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'admin_minipet_draw_grant')",
        [operation.insertId, sequence, target.player_id, item.id, ADMIN_DRAW_GRANT_QUANTITY]
      );
      await tx.execute(
        `INSERT INTO admin_adjustment_ledger
          (operation_id, sequence_no, operator_id, target_player_id, asset_type_code, asset_code, quantity_delta, reason_code)
         VALUES (?, ?, ?, ?, 'item', ?, ?, 'admin_minipet_draw_grant')`,
        [operation.insertId, sequence, operator.operator_id, target.player_id, TICKET_CODE, ADMIN_DRAW_GRANT_QUANTITY]
      );
      recipients.push({ playerId: target.player_id.toString(), displayName: target.current_display_name, quantity: quantity.toString() });
    }

    const names = recipients.map((recipient) => recipient.displayName).join(", ");
    const data = `🎁 부방 상여 지급 완료\n${TICKET_NAME} 1,000개씩 지급\n대상(${recipients.length}명): ${names}`;
    const outbox = await tx.execute(
      `INSERT INTO outbox_messages
        (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation.insertId, command.channelId, JSON.stringify({ data })]
    );
    await tx.execute(
      `INSERT INTO command_executions
        (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, 'admin_minipet_draw_grant', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [command.eventId, operation.insertId]
    );
    const audit = await tx.execute(
      `INSERT INTO command_audit
        (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'admin_operator', ?, 'admin_group', 0, 'admin.minipet_draw_grant', 'success', 'Iris /부방상여', ?, UTC_TIMESTAMP(3))`,
      [operation.insertId, operator.operator_id, JSON.stringify({ itemCode: TICKET_CODE, quantityDelta: ADMIN_DRAW_GRANT_QUANTITY.toString(),
        recipients: recipients.map((recipient) => ({ playerId: recipient.playerId, displayName: recipient.displayName })) })]
    );
    const result: AdminDrawGrantResult = { status: "granted", data, operatorId: operator.operator_id.toString(),
      itemCode: TICKET_CODE, quantityDelta: ADMIN_DRAW_GRANT_QUANTITY.toString(), recipients,
      outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
    await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(result), operation.insertId]);
    return result;
  }
}
