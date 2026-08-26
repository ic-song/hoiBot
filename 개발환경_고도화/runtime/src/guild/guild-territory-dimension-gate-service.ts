import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface GuildTerritoryDimensionGateCommand {
  enabled: boolean;
}

export interface GuildTerritoryDimensionGateResult {
  data: string;
  outboxId: string;
  enabled: boolean;
  changed: boolean;
  version: string;
}

// 차원의 문 설정은 네 개의 레거시 정확 일치 별칭만 허용합니다.
export function isGuildTerritoryDimensionGateCommand(message: string | undefined): boolean {
  return message === "/차원의문on" || message === "/차원의문온" || message === "/차원의문off" || message === "/차원의문오프";
}

// 정확 별칭을 차원의 문 활성 여부로 변환합니다.
export function parseGuildTerritoryDimensionGateCommand(message: string): GuildTerritoryDimensionGateCommand {
  if (!isGuildTerritoryDimensionGateCommand(message)) {
    throw new ApplicationError("INVALID_DIMENSION_GATE_COMMAND", "차원의 문 설정 명령 형식이 올바르지 않습니다.", 422);
  }
  return { enabled: message === "/차원의문on" || message === "/차원의문온" };
}

// 레거시 ON/OFF 완료 응답을 그대로 생성합니다.
export function formatGuildTerritoryDimensionGateReply(enabled: boolean): string {
  return `✅ 차원의 문 🌀 이벤트가 ${enabled ? "ON" : "OFF"} 상태로 변경되었습니다.`;
}

// singleton 설정을 잠그고 차원의 문 상태·감사·응답을 원자 변경합니다.
export class GuildTerritoryDimensionGateService {
  constructor(private readonly database: DatabaseClient) {}

  async setEnabled(input: { command: GuildTerritoryDimensionGateCommand; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<GuildTerritoryDimensionGateResult> {
    const scope = "guild.territory.dimension_gate.configure";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | GuildTerritoryDimensionGateResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }
      const controls = await transaction.query<Array<{ dimension_gate_enabled: number; version: bigint }>>(
        "SELECT dimension_gate_enabled,version FROM guild_territory_war_control WHERE control_code='current' FOR UPDATE"
      );
      const before = controls[0];
      if (before === undefined) throw new ApplicationError("GUILD_TERRITORY_CONTROL_MISSING", "길드 영지전 설정이 없습니다.", 409);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const enabledBefore = Boolean(before.dimension_gate_enabled);
      const changed = enabledBefore !== input.command.enabled;
      const version = before.version + 1n;
      const update = await transaction.execute(
        `UPDATE guild_territory_war_control SET dimension_gate_enabled=?,version=?,updated_by_operator_id=?,updated_at=UTC_TIMESTAMP(3)
         WHERE control_code='current' AND version=?`,
        [input.command.enabled, version, input.operatorId, before.version]
      );
      if (update.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_CONTROL_VERSION_CONFLICT", "길드 영지전 설정이 먼저 변경되었습니다.", 409);
      const data = formatGuildTerritoryDimensionGateReply(input.command.enabled);
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'guild_territory_war_control',NULL,'guild.territory.dimension_gate.configure','success','Iris 운영자 차원의 문 설정',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({ enabledBefore, enabledAfter: input.command.enabled, changed, versionBefore: before.version.toString(), versionAfter: version.toString() })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'GUILD_TERRITORY_DIMENSION_GATE_TOGGLE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO guild_territory_dimension_gate_mutations(operation_id,enabled_before,enabled_after,changed,version_before,version_after)
         VALUES (?,?,?,?,?,?)`,
        [operation.insertId, enabledBefore, input.command.enabled, changed, before.version, version]
      );
      const result: GuildTerritoryDimensionGateResult = { data, outboxId: outbox.insertId.toString(), enabled: input.command.enabled, changed, version: version.toString() };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
