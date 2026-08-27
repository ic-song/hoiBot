import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { isPetExploreRecordsResetCommand } from "./pet-explore-records-reset-command.js";

const COMMAND_CODE = "PET_EXPLORE_RECORDS_RESET";
const ALLSEE = "\u200b".repeat(500);

type Operator = { operator_id: bigint; display_name: string; role_code: string };
type ExploreRecord = { player_name: string; win_count: bigint | string; lose_count: bigint | string; source_order: bigint | number | string; imported_at: Date | string };

export interface PetExploreRecordsResetResult {
  status: "reset";
  deletedCount: string;
  data: string;
  outboxId: string;
  auditId: string;
  replayed: boolean;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | PetExploreRecordsResetResult): PetExploreRecordsResetResult {
  return typeof value === "string" ? JSON.parse(value) as PetExploreRecordsResetResult : value;
}

// 레거시 전체 전적 초기화 결과를 동일한 접기 영역과 대상 수로 출력합니다.
export function buildPetExploreRecordsResetMessage(deletedCount: bigint): string {
  return `🧹/펫탐험전체전적초기화\n펫탐험과 관련된 승/패/승률 기록을 모두 삭제합니다.\n${ALLSEE}\n초기화 완료 ✅ (대상: ${deletedCount}명)`;
}

// 현재 operator가 레거시 Master 또는 호이 남 권한에 대응하는지 확인합니다.
function canReset(operator: Operator | undefined): operator is Operator {
  return operator !== undefined && (operator.role_code === "super_admin" || operator.display_name === "호이 남");
}

// 전적 전체 snapshot을 operation 백업에 보존한 뒤 projection만 원자 삭제합니다.
export class PetExploreRecordsResetService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetExploreRecordsResetResult> {
    if (!isPetExploreRecordsResetCommand(input.message)) throw new ApplicationError("PET_EXPLORE_RECORDS_RESET_COMMAND_INVALID", "펫탐험 전적 초기화 명령 형식을 확인해 주세요.", 422);
    const operator = (await this.database.query<Operator[]>(`SELECT mapping.operator_id,operator.display_name,role.code role_code
      FROM external_identities identity
      JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
      JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
      JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
      JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
      ORDER BY CASE role.code WHEN 'super_admin' THEN 0 ELSE 1 END LIMIT 1`, [input.externalUserId]))[0];
    if (!canReset(operator)) throw new ApplicationError("PET_EXPLORE_RECORDS_RESET_FORBIDDEN", "펫탐험 전체 전적 초기화 권한이 없습니다.", 403);

    return this.database.withTransaction(async transaction => {
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | PetExploreRecordsResetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.explore.records.reset_all' AND idempotency_key=? FOR UPDATE", [key]
      ))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.explore.records.reset_all',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, operator.operator_id]
      )).insertId;
      const records = await transaction.query<ExploreRecord[]>(
        "SELECT player_name,win_count,lose_count,source_order,imported_at FROM player_pet_explore_rank_stats ORDER BY player_name FOR UPDATE"
      );
      for (const record of records) {
        await transaction.execute(
          "INSERT INTO pet_explore_record_reset_backups(operation_id,player_name,win_count,lose_count,source_order,imported_at) VALUES (?,?,?,?,?,?)",
          [operationId, record.player_name, record.win_count, record.lose_count, record.source_order, record.imported_at]
        );
      }
      const deleted = await transaction.execute("DELETE FROM player_pet_explore_rank_stats");
      if (deleted.affectedRows !== BigInt(records.length)) throw new ApplicationError("PET_EXPLORE_RECORDS_RESET_CONFLICT", "펫탐험 전적이 먼저 변경되었습니다.", 409);
      const deletedCount = BigInt(records.length);
      await transaction.execute("INSERT INTO pet_explore_record_reset_operations(operation_id,deleted_count,created_at) VALUES (?,?,UTC_TIMESTAMP(3))", [operationId, deletedCount]);
      const data = buildPetExploreRecordsResetMessage(deletedCount);
      const audit = await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_explore_records',NULL,'pet_explore.records.reset_all','reset','Iris /펫탐험전체전적초기화',?,UTC_TIMESTAMP(3))",
        [operationId, operator.operator_id, JSON.stringify({ deletedCount: deletedCount.toString(), backupCount: deletedCount.toString(), preservedScopes: ["participants", "autoFixedDungeon", "scheduler"] })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, COMMAND_CODE, operationId]
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data })]
      );
      const result: PetExploreRecordsResetResult = { status: "reset", deletedCount: deletedCount.toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), replayed: false };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}
