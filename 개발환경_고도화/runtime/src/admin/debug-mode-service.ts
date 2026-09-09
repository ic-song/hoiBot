import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "ADMIN_DEBUG_MODE";
const PERMISSION_CODE = "diagnostic.debug_mode.toggle";
const DEFAULT_PROCESS_INSTANCE_ID = randomUUID();

interface OperatorRow { operator_id: bigint }
interface StateRow { enabled: number }
interface ReplayRow { result_json: string }

export interface DebugModeResult {
  enabled: boolean;
  message: string;
  outboxId: string;
  replayed: boolean;
  processInstanceId: string;
}

// 프로세스별 디버깅 상태를 조회·토글하고 실행·감사·Outbox 증거를 원자 기록합니다.
export class DebugModeService {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly processInstanceId: string = DEFAULT_PROCESS_INSTANCE_ID,
  ) {}

  // 새 프로세스 ID는 저장된 행이 없어 항상 OFF로 시작합니다.
  public async isEnabled(): Promise<boolean> {
    const rows = await this.database.query<StateRow[]>(
      "SELECT enabled FROM admin_debug_mode_instances WHERE process_instance_id=?",
      [this.processInstanceId],
    );
    return Boolean(rows[0]?.enabled);
  }

  // 권한과 재실행 키를 확인한 뒤 현재 프로세스 상태를 정확히 한 번 반전합니다.
  public async execute(input: {
    eventId: string;
    externalUserId: string;
    destinationId: string;
  }): Promise<DebugModeResult> {
    const operator = await this.findOperator(input.externalUserId);
    const existing = await this.database.query<ReplayRow[]>(
      "SELECT result_json FROM admin_debug_mode_mutations WHERE request_key=?",
      [input.eventId],
    );
    if (existing[0]) return { ...(JSON.parse(existing[0].result_json) as DebugModeResult), replayed: true };

    return this.database.withTransaction(async (transaction) => {
      const replay = await transaction.query<ReplayRow[]>(
        "SELECT result_json FROM admin_debug_mode_mutations WHERE request_key=? FOR UPDATE",
        [input.eventId],
      );
      if (replay[0]) return { ...(JSON.parse(replay[0].result_json) as DebugModeResult), replayed: true };
      await transaction.execute(
        `INSERT INTO admin_debug_mode_instances(process_instance_id,enabled,version)
         VALUES (?,FALSE,1) ON DUPLICATE KEY UPDATE process_instance_id=VALUES(process_instance_id)`,
        [this.processInstanceId],
      );
      const state = (await transaction.query<StateRow[]>(
        "SELECT enabled FROM admin_debug_mode_instances WHERE process_instance_id=? FOR UPDATE",
        [this.processInstanceId],
      ))[0]!;
      const enabledBefore = Boolean(state.enabled);
      const enabledAfter = !enabledBefore;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status)
         VALUES (?,'admin.debug_mode.toggle',?,'admin_operator',?,'iris','processing')`,
        [randomUUID(), input.eventId, operator.operator_id],
      );
      await transaction.execute(
        `UPDATE admin_debug_mode_instances
         SET enabled=?,version=version+1,toggled_by_operator_id=?,last_operation_id=?,updated_at=UTC_TIMESTAMP(3)
         WHERE process_instance_id=?`,
        [enabledAfter, operator.operator_id, operation.insertId, this.processInstanceId],
      );
      const message = buildDebugModeMessage(enabledAfter);
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status)
         VALUES (?,'iris',?,'text',?,'pending')`,
        [operation.insertId, input.destinationId, JSON.stringify({ room: input.destinationId, data: message })],
      );
      const result: DebugModeResult = {
        enabled: enabledAfter,
        message,
        outboxId: outbox.insertId.toString(),
        replayed: false,
        processInstanceId: this.processInstanceId,
      };
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,completed_at)
         VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3))`,
        [input.eventId, COMMAND_CODE, operation.insertId],
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json)
         VALUES (?,'admin_operator',?,'runtime_debug_mode',NULL,?,'success',?)`,
        [operation.insertId, operator.operator_id, COMMAND_CODE,
          JSON.stringify({ processInstanceId: this.processInstanceId, enabledBefore, enabledAfter })],
      );
      await transaction.execute(
        `INSERT INTO admin_debug_mode_mutations(
           request_key,operation_id,process_instance_id,operator_id,enabled_before,enabled_after,result_json
         ) VALUES (?,?,?,?,?,?,?)`,
        [input.eventId, operation.insertId, this.processInstanceId, operator.operator_id,
          enabledBefore, enabledAfter, JSON.stringify(result)],
      );
      await transaction.execute(
        "UPDATE operations SET status='committed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }

  // Kakao identity에 연결된 활성 운영자와 디버깅 토글 권한을 함께 확인합니다.
  private async findOperator(externalUserId: string): Promise<OperatorRow> {
    const operators = await this.database.query<OperatorRow[]>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code=?
       ORDER BY mapping.operator_id LIMIT 1`,
      [externalUserId, PERMISSION_CODE],
    );
    if (!operators[0]) throw new ApplicationError("FORBIDDEN", "디버깅 모드 변경 권한이 없습니다.", 403);
    return operators[0];
  }
}

// 레거시 토글 응답 문구를 그대로 생성합니다.
export function buildDebugModeMessage(enabled: boolean): string {
  return `디버깅 모드 : ${enabled ? "ON" : "OFF"}`;
}
