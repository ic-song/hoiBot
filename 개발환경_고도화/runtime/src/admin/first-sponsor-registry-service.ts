import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

type Action = "register" | "list" | "release";

export interface FirstSponsorCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface FirstSponsorResult {
  action: Action;
  resultCode: "registered" | "already_registered" | "listed" | "released" | "already_released";
  targetPlayerId?: string;
  targetName?: string;
  names?: string[];
  data: string;
  outboxId: string;
  auditId: string;
}

interface ParsedCommand { action: Action; commandCode: string; targetName?: string; }

// 첫후원 등록·목록·해제 명령을 전체 형식으로만 허용합니다.
export function isFirstSponsorCommandCandidate(message: string | undefined): boolean {
  return message === "/첫후원리스트"
    || (message !== undefined && /^\/첫후원\s+\S(?:.*\S)?$/.test(message))
    || (message !== undefined && /^\/첫후원해제\s+\S(?:.*\S)?$/.test(message));
}

// 인자형 첫후원 명령을 command registry의 canonical alias로 정규화합니다.
export function normalizeFirstSponsorDispatchMessage(message: string): string {
  if (message === "/첫후원리스트") return message;
  if (/^\/첫후원해제\s+\S(?:.*\S)?$/.test(message)) return "/첫후원해제";
  if (/^\/첫후원\s+\S(?:.*\S)?$/.test(message)) return "/첫후원";
  return message;
}

// 첫후원 명령을 실행 동작과 대상 표시명으로 분리합니다.
function parseCommand(message: string): ParsedCommand {
  if (message === "/첫후원리스트") return { action: "list", commandCode: "ADMIN_FIRST_SPONSOR_LIST" };
  const register = /^\/첫후원\s+(\S(?:.*\S)?)$/.exec(message);
  if (register !== null) return { action: "register", commandCode: "ADMIN_FIRST_SPONSOR_REGISTER", targetName: register[1]! };
  const release = /^\/첫후원해제\s+(\S(?:.*\S)?)$/.exec(message);
  if (release !== null) return { action: "release", commandCode: "ADMIN_FIRST_SPONSOR_RELEASE", targetName: release[1]! };
  throw new ApplicationError("INVALID_FIRST_SPONSOR_COMMAND", "첫후원 명령 형식이 올바르지 않습니다.", 422);
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | FirstSponsorResult): FirstSponsorResult {
  return typeof value === "string" ? JSON.parse(value) as FirstSponsorResult : value;
}

// Iris 관리자 신원과 총괄 운영 권한을 확인합니다.
async function resolveOperator(database: DatabaseClient, externalUserId: string): Promise<string> {
  const rows = await database.query<Array<{ operator_id: bigint }>>(
    `SELECT mapping.operator_id
     FROM external_identities identity
     JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
     JOIN admin_operators operator ON operator.id=mapping.operator_id
     JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
     JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
     WHERE identity.provider_code='kakao' AND identity.external_user_id=?
       AND identity.status='linked' AND operator.status='active'
       AND permission.permission_code='game.event.change'
     ORDER BY mapping.operator_id LIMIT 2`,
    [externalUserId]
  );
  if (rows.length !== 1) throw new ApplicationError("FORBIDDEN", "첫후원 관리 권한이 없습니다.", 403);
  return rows[0]!.operator_id.toString();
}

// 첫후원 상태와 변경 이력·감사·응답을 하나의 트랜잭션으로 처리합니다.
export class FirstSponsorRegistryService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: FirstSponsorCommand): Promise<FirstSponsorResult> {
    const parsed = parseCommand(command.message);
    const operatorId = await resolveOperator(this.database, command.externalUserId);
    const scope = `admin.first-sponsor:${operatorId}`;
    const key = eventKey(command.eventId);
    return this.database.withTransaction(async (tx) => {
      const prior = await tx.query<Array<{ result_json: string | FirstSponsorResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);
      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, operatorId]
      );

      let resultCode: FirstSponsorResult["resultCode"];
      let targetPlayerId: string | undefined;
      let targetName: string | undefined;
      let names: string[] | undefined;
      let data: string;
      let beforeValue: boolean | undefined;
      let afterValue: boolean | undefined;
      if (parsed.action === "list") {
        const rows = await tx.query<Array<{ current_display_name: string }>>(
          `SELECT profile.current_display_name FROM player_sponsor_flags flag
           JOIN player_profiles profile ON profile.player_id=flag.player_id
           WHERE flag.first_sponsor=TRUE`
        );
        names = rows.map((row) => row.current_display_name).sort();
        resultCode = "listed";
        data = names.length === 0 ? "첫후원 회원이 없습니다." : `첫후원 회원 목록\n${names.join("\n")}`;
      } else {
        targetName = parsed.targetName!;
        const targets = await tx.query<Array<{ player_id: bigint; current_display_name: string; first_sponsor: number | null; version: bigint | null }>>(
          `SELECT profile.player_id,profile.current_display_name,flag.first_sponsor,flag.version
           FROM player_profiles profile LEFT JOIN player_sponsor_flags flag ON flag.player_id=profile.player_id
           WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2 FOR UPDATE`, [targetName]
        );
        if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
        if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
        const target = targets[0]!;
        targetPlayerId = target.player_id.toString();
        beforeValue = target.first_sponsor === 1;
        afterValue = parsed.action === "register";
        const changed = beforeValue !== afterValue;
        if (target.version === null) {
          await tx.execute(
            "INSERT INTO player_sponsor_flags(player_id,first_sponsor,version,updated_by_operator_id,updated_at) VALUES (?,?,1,?,UTC_TIMESTAMP(3))",
            [target.player_id, afterValue, operatorId]
          );
        } else if (changed) {
          const write = await tx.execute(
            "UPDATE player_sponsor_flags SET first_sponsor=?,version=version+1,updated_by_operator_id=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
            [afterValue, operatorId, target.player_id, target.version]
          );
          if (write.affectedRows !== 1n) throw new ApplicationError("FIRST_SPONSOR_CONFLICT", "첫후원 상태가 먼저 변경되었습니다.", 409);
        }
        if (changed) {
          await tx.execute(
            "INSERT INTO player_sponsor_flag_events(operation_id,player_id,operator_id,before_value,after_value,action_code,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))",
            [operation.insertId, target.player_id, operatorId, beforeValue, afterValue, parsed.action]
          );
        }
        if (parsed.action === "register") {
          resultCode = changed ? "registered" : "already_registered";
          data = changed ? `[${targetName}] 님을 첫후원 회원으로 등록했습니다.` : `[${targetName}] 님은 이미 첫후원 회원입니다.`;
        } else {
          resultCode = changed ? "released" : "already_released";
          data = changed ? `[${targetName}] 님의 첫후원 등록을 해제했습니다.` : `[${targetName}] 님은 첫후원 회원이 아닙니다.`;
        }
      }

      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [command.eventId, parsed.commandCode, operation.insertId, resultCode]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,?,?,?,?,UTC_TIMESTAMP(3))",
        [operation.insertId, operatorId, targetPlayerId ?? null, `player.first_sponsor.${parsed.action}`, resultCode, `Iris ${command.message}`, JSON.stringify({ beforeValue, afterValue, names })]
      );
      const result: FirstSponsorResult = { action: parsed.action, resultCode, targetPlayerId, targetName, names, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
