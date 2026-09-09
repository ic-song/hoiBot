import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface HappyFoundationCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface HappyFoundationResult {
  resultCode: "captain_set" | "captain_cleared";
  captainPlayerId: string | null;
  captainName: string | null;
  previousCaptainPlayerId: string | null;
  previousTotalAmount: string;
  version: string;
  data: string;
  outboxId: string;
  auditId: string;
}

// 대상이 포함된 행복단장변경 명령만 전체 형식으로 허용합니다.
export function isHappyFoundationCaptainCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/행복단장변경\s+\S(?:.*\S)?$/.test(message);
}

// 인자형 명령을 command registry의 canonical alias로 정규화합니다.
export function normalizeHappyFoundationDispatchMessage(message: string): string {
  return isHappyFoundationCaptainCommand(message) ? "/행복단장변경" : message;
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | HappyFoundationResult): HappyFoundationResult {
  return typeof value === "string" ? JSON.parse(value) as HappyFoundationResult : value;
}

// 기존 총괄 운영 성격의 Iris 관리자 신원을 안정 ID로 해석합니다.
async function resolveOperator(database: DatabaseClient, externalUserId: string): Promise<string> {
  const rows = await database.query<Array<{ operator_id: bigint }>>(
    `SELECT mapping.operator_id FROM external_identities identity
     JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
     JOIN admin_operators operator ON operator.id=mapping.operator_id
     JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
     JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
     WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       AND operator.status='active' AND permission.permission_code='game.event.change'
     ORDER BY mapping.operator_id LIMIT 2`, [externalUserId]
  );
  if (rows.length !== 1) throw new ApplicationError("FORBIDDEN", "행복재단 단장 변경 권한이 없습니다.", 403);
  return rows[0]!.operator_id.toString();
}

// 행복재단 단장과 누적액 초기화를 설정 로그·감사·응답과 원자 처리합니다.
export class HappyFoundationCaptainService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: HappyFoundationCommand): Promise<HappyFoundationResult> {
    const match = /^\/행복단장변경\s+(\S(?:.*\S)?)$/.exec(command.message);
    if (match === null) throw new ApplicationError("INVALID_HAPPY_FOUNDATION_COMMAND", "행복단장변경 명령 형식이 올바르지 않습니다.", 422);
    const requested = match[1]!;
    const clear = requested === "없음" || requested === "해제";
    const operatorId = await resolveOperator(this.database, command.externalUserId);
    const scope = `foundation.happy.captain:${operatorId}`;
    const key = eventKey(command.eventId);
    return this.database.withTransaction(async (tx) => {
      const prior = await tx.query<Array<{ result_json: string | HappyFoundationResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);
      let captainPlayerId: bigint | null = null;
      let captainName: string | null = null;
      if (!clear) {
        const targets = await tx.query<Array<{ player_id: bigint; current_display_name: string }>>(
          "SELECT player_id,current_display_name FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2 FOR UPDATE", [requested]
        );
        if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${requested}] 님은 존재하지 않습니다.`, 404);
        if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
        captainPlayerId = targets[0]!.player_id;
        captainName = targets[0]!.current_display_name;
      }
      const states = await tx.query<Array<{ configuration_set_id: bigint; captain_player_id: bigint | null; total_amount: string; version: bigint }>>(
        "SELECT configuration_set_id,captain_player_id,CAST(total_amount AS CHAR) AS total_amount,version FROM foundation_states WHERE foundation_code='happy' FOR UPDATE"
      );
      const state = states[0];
      if (state === undefined) throw new ApplicationError("HAPPY_FOUNDATION_STATE_REQUIRED", "행복재단 상태가 준비되지 않았습니다.", 409);
      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, operatorId]
      );
      const write = await tx.execute(
        "UPDATE foundation_states SET captain_player_id=?,total_amount=0,version=version+1,updated_by_operator_id=?,updated_at=UTC_TIMESTAMP(3) WHERE foundation_code='happy' AND version=?",
        [captainPlayerId, operatorId, state.version]
      );
      if (write.affectedRows !== 1n) throw new ApplicationError("HAPPY_FOUNDATION_CONFLICT", "행복재단 상태가 먼저 변경되었습니다.", 409);
      const resultCode = clear ? "captain_cleared" : "captain_set";
      const data = clear
        ? "행복재단 단장을 해제했습니다.\n누적액이 0으로 초기화되었습니다."
        : `[${captainName}] 님을 행복재단 단장으로 변경했습니다.\n누적액이 0으로 초기화되었습니다.`;
      await tx.execute(
        "INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at) VALUES (?,?, 'foundation.captain.change',?,UTC_TIMESTAMP(3))",
        [state.configuration_set_id, operatorId, JSON.stringify({ previousCaptainPlayerId: state.captain_player_id?.toString() ?? null, captainPlayerId: captainPlayerId?.toString() ?? null, previousTotalAmount: state.total_amount, totalAmount: "0", reason: resultCode })]
      );
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HAPPY_FOUNDATION_CAPTAIN_CHANGE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId, resultCode]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'foundation.happy.captain.change',?,'Iris /행복단장변경',?,UTC_TIMESTAMP(3))",
        [operation.insertId, operatorId, captainPlayerId, resultCode, JSON.stringify({ previousCaptainPlayerId: state.captain_player_id?.toString() ?? null, previousTotalAmount: state.total_amount, totalAmount: "0" })]
      );
      const result: HappyFoundationResult = { resultCode, captainPlayerId: captainPlayerId?.toString() ?? null, captainName,
        previousCaptainPlayerId: state.captain_player_id?.toString() ?? null, previousTotalAmount: state.total_amount,
        version: (state.version + 1n).toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
