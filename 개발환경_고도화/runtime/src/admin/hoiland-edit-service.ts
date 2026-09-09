import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface HoiLandEditCommand {
  playerId: string;
  targetDisplayName: string;
  amount: string;
  idempotencyKey: string;
  operatorId: string;
  sourceEventId: string;
  irisReplyDestinationId: string;
}

export interface HoiLandEditResult {
  amount: string;
  affectedCategoryCount: number;
  categoryKeys: string[];
  data: string;
  outboxIds: string[];
  auditId: string;
}

// 호이랜드 카테고리별 회원 수치를 잠금·감사·응답과 함께 원자적으로 설정합니다.
export class HoiLandEditService {
  constructor(private readonly database: DatabaseClient) {}

  async setAbsolute(command: HoiLandEditCommand): Promise<HoiLandEditResult | null> {
    if (!/^\d{1,27}$/.test(command.amount)) {
      throw new ApplicationError("INVALID_HOILAND_AMOUNT", "수정할 값은 0 이상의 정수여야 합니다.", 422);
    }
    const normalizedAmount = BigInt(command.amount).toString();
    const scope = `hoiland.set_absolute:${command.playerId}`;
    try {
      return await this.database.withTransaction(async (transaction) => {
        const prior = await transaction.query<Array<{ result_json: string | HoiLandEditResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
          [scope, command.idempotencyKey]
        );
        if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
          return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
        }
        const entries = await transaction.query<Array<{ id: bigint; category_key: string; version: bigint }>>(
          `SELECT entry.id, category.category_key, entry.version
           FROM hoiland_entries entry
           JOIN hoiland_categories category ON category.id = entry.category_id
           WHERE entry.player_id = ? AND category.active = TRUE
           ORDER BY category.display_order, category.id
           FOR UPDATE`,
          [command.playerId]
        );
        if (entries.length === 0) return null;
        const operation = await transaction.execute(
          `INSERT INTO operations
            (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
           VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
          [randomUUID(), scope, command.idempotencyKey, command.operatorId]
        );
        for (const entry of entries) {
          const update = await transaction.execute(
            "UPDATE hoiland_entries SET amount=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND version=?",
            [normalizedAmount, entry.id, entry.version]
          );
          if (update.affectedRows !== 1n) {
            throw new ApplicationError("HOILAND_VERSION_CONFLICT", "호이랜드 수치가 먼저 변경되었습니다.", 409);
          }
        }
        const categoryKeys = entries.map((entry) => entry.category_key);
        const data = `[${command.targetDisplayName}] 가 변경되었습니다.`;
        const audit = await transaction.execute(
          `INSERT INTO command_audit
            (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
           VALUES (?,'admin_operator',?,'player',?,'hoiland.set_absolute','success','Iris 총괄 운영자 /수정',?,UTC_TIMESTAMP(3))`,
          [operation.insertId, command.operatorId, command.playerId,
            JSON.stringify({ amount: normalizedAmount, affectedCategoryCount: entries.length, categoryKeys })]
        );
        await transaction.execute(
          `INSERT INTO command_executions
            (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
           VALUES (?,'admin_hoiland_edit',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [command.sourceEventId, operation.insertId]
        );
        const outboxIds: string[] = [];
        for (let index = 0; index < entries.length; index += 1) {
          const outbox = await transaction.execute(
            `INSERT INTO outbox_messages
              (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
             VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
            [operation.insertId, command.irisReplyDestinationId, JSON.stringify({ data })]
          );
          outboxIds.push(outbox.insertId.toString());
        }
        const result: HoiLandEditResult = {
          amount: normalizedAmount,
          affectedCategoryCount: entries.length,
          categoryKeys,
          data,
          outboxIds,
          auditId: audit.insertId.toString()
        };
        await transaction.execute(
          `INSERT INTO hoiland_edit_mutations
            (operation_id,player_id,target_amount,affected_category_count,result_json)
           VALUES (?,?,?,?,?)`,
          [operation.insertId, command.playerId, normalizedAmount, entries.length, JSON.stringify(result)]
        );
        await transaction.execute(
          "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
          [JSON.stringify(result), operation.insertId]
        );
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const prior = await this.database.query<Array<{ result_json: string | HoiLandEditResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?",
        [scope, command.idempotencyKey]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
    }
  }
}

// 동시 operation 생성 경합만 저장된 멱등 결과 재조회 대상으로 판별합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}
