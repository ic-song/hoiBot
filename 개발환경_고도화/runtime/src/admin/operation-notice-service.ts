import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type OperationNoticeKey = "notice.cleanup" | "notice.package_bag" | "notice.advertisement";

export interface OperationNoticeCommand {
  commandCode: "OPERATION_NOTICE_CLEANUP_MUTATE" | "OPERATION_NOTICE_PACKAGE_MUTATE" | "OPERATION_ADVERTISEMENT_MUTATE";
  key: OperationNoticeKey;
  label: "정리" | "패키지 가방" | "광고";
  value: string;
}

export interface OperationNoticeMutationResult {
  data: string;
  outboxId: string;
  key: OperationNoticeKey;
  action: "SET" | "CLEAR" | "NOOP";
  changed: boolean;
  version: string;
  valueHash: string;
  valueLength: number;
}

export interface OperationNoticeSnapshot {
  version: string;
  cleanup: string;
  packageBag: string;
  advertisement: string;
}

const maximumNoticeLength = 16_384;

// 인자가 있는 운영 공지 명령만 후보로 인정하며 단일 구분 공백뿐인 입력은 실행하지 않습니다.
export function isOperationNoticeCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && parseOperationNoticeCommand(message) !== undefined;
}

// DB alias 조회용으로 인자형 공지 명령을 정확한 기본 명령어로 줄입니다.
export function normalizeOperationNoticeDispatchMessage(message: string): string {
  const parsed = parseOperationNoticeCommand(message);
  if (parsed === undefined) return message;
  if (parsed.commandCode === "OPERATION_NOTICE_CLEANUP_MUTATE") return "/정리알림";
  if (parsed.commandCode === "OPERATION_NOTICE_PACKAGE_MUTATE") return "/패키지알림";
  return "/광고";
}

// 레거시의 literal \n 및 /n 치환과 trim 규칙을 적용해 공지 값을 파싱합니다.
export function parseOperationNoticeCommand(message: string): OperationNoticeCommand | undefined {
  const match = /^\/(정리알림|패키지알림|광고)\s+([\s\S]+)$/.exec(message);
  if (match === null) return undefined;
  const value = match[2]!.replace(/\\n|\/n/g, "\n").trim();
  if (value.includes("\0")) throw new ApplicationError("INVALID_OPERATION_NOTICE_CONTROL", "공지에는 NUL 제어문자를 넣을 수 없습니다.", 422);
  if (value.length > maximumNoticeLength) throw new ApplicationError("OPERATION_NOTICE_TOO_LONG", `공지는 ${maximumNoticeLength.toString()}자 이내로 입력해주세요.`, 422);
  if (match[1] === "정리알림") return { commandCode: "OPERATION_NOTICE_CLEANUP_MUTATE", key: "notice.cleanup", label: "정리", value };
  if (match[1] === "패키지알림") return { commandCode: "OPERATION_NOTICE_PACKAGE_MUTATE", key: "notice.package_bag", label: "패키지 가방", value };
  return { commandCode: "OPERATION_ADVERTISEMENT_MUTATE", key: "notice.advertisement", label: "광고", value };
}

// 한 요청에서 활성 head와 두 공지 값을 함께 읽어 소비자에게 고정된 버전 스냅샷을 제공합니다.
export class OperationNoticeReader {
  constructor(private readonly database: DatabaseClient) {}

  async readActiveSnapshot(): Promise<OperationNoticeSnapshot> {
    const rows = await this.database.query<Array<{ version: bigint; cleanup: string | null; package_bag: string | null; advertisement: string | null }>>(
      `SELECT head.version,
              MAX(CASE WHEN value.config_key='notice.cleanup' THEN value.string_value END) cleanup,
              MAX(CASE WHEN value.config_key='notice.package_bag' THEN value.string_value END) package_bag,
              MAX(CASE WHEN value.config_key='notice.advertisement' THEN value.string_value END) advertisement
       FROM operation_notice_heads head
       JOIN configuration_values value ON value.configuration_set_id=head.active_configuration_set_id
       WHERE head.set_code='operation_notices' GROUP BY head.version`
    );
    const row = rows[0];
    if (row === undefined) throw new ApplicationError("OPERATION_NOTICE_CONFIG_MISSING", "운영 공지 설정이 준비되지 않았습니다.", 503);
    return { version: row.version.toString(), cleanup: row.cleanup ?? "", packageBag: row.package_bag ?? "", advertisement: row.advertisement ?? "" };
  }
}

// 운영자 권한과 활성 설정 head를 잠근 뒤 공지 버전·감사·응답을 원자적으로 기록합니다.
export class OperationNoticeService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<OperationNoticeMutationResult> {
    const command = parseOperationNoticeCommand(input.message);
    if (command === undefined) throw new ApplicationError("INVALID_OPERATION_NOTICE_COMMAND", "사용법: /정리알림 [내용], /패키지알림 [내용] 또는 /광고 [내용]", 422);
    const operatorId = await resolveAuthorizedOperator(this.database, input.externalUserId);
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | OperationNoticeMutationResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='operation.notice.mutate' AND idempotency_key=? FOR UPDATE", [input.eventId]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;

      const heads = await transaction.query<Array<{ active_configuration_set_id: bigint; version: bigint }>>(
        "SELECT active_configuration_set_id,version FROM operation_notice_heads WHERE set_code='operation_notices' FOR UPDATE"
      );
      const head = heads[0];
      if (head === undefined) throw new ApplicationError("OPERATION_NOTICE_CONFIG_MISSING", "운영 공지 설정이 준비되지 않았습니다.", 503);
      const currentRows = await transaction.query<Array<{ string_value: string }>>(
        "SELECT string_value FROM configuration_values WHERE configuration_set_id=? AND config_key=? FOR UPDATE", [head.active_configuration_set_id, command.key]
      );
      const previousValue = currentRows[0]?.string_value ?? "";
      const changed = previousValue !== command.value;
      const action: OperationNoticeMutationResult["action"] = changed ? (command.value === "" ? "CLEAR" : "SET") : "NOOP";
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,'operation.notice.mutate',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), input.eventId, operatorId]
      );
      let version = head.version;
      if (changed) version = await replaceActiveVersion(transaction, head, command, operatorId);
      const valueHash = hash(command.value);
      const data = `✅ ${command.label} 알림이 변경되었습니다.`;
      const summary = {
        key: command.key, action, changed, versionBefore: head.version.toString(), versionAfter: version.toString(),
        beforeHash: hash(previousValue), beforeLength: previousValue.length, valueHash, valueLength: command.value.length
      };
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'configuration_set',?,'operation.notice.mutate','success','Iris 운영 공지 변경',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operatorId, head.active_configuration_set_id, JSON.stringify(summary)]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.eventId, command.commandCode, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      const result: OperationNoticeMutationResult = {
        data, outboxId: outbox.insertId.toString(), key: command.key, action, changed,
        version: version.toString(), valueHash, valueLength: command.value.length
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    }));
  }
}

// 서로 다른 idempotency gap lock이 head lock과 교차할 때의 MariaDB deadlock만 제한적으로 재시도합니다.
async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const databaseError = error as { code?: unknown; errno?: unknown };
      if (attempt === 2 || (databaseError.code !== "ER_LOCK_DEADLOCK" && databaseError.errno !== 1213)) throw error;
    }
  }
  throw new Error("Operation notice deadlock retry exhausted.");
}

// 역할 권한과 개별 allow/deny override를 합성해 공지 변경 가능 운영자를 찾습니다.
async function resolveAuthorizedOperator(database: DatabaseClient, externalUserId: string): Promise<bigint> {
  const rows = await database.query<Array<{ operator_id: bigint }>>(
    `SELECT operator.id operator_id
     FROM external_identities identity
     JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
     JOIN admin_operators operator ON operator.id=mapping.operator_id
     WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active'
       AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='operation.notice.manage' AND denied.effect='deny')
       AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='operation.notice.manage' AND allowed.effect='allow')
         OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='operation.notice.manage' WHERE operator_role.operator_id=operator.id))
     LIMIT 1`, [externalUserId]
  );
  if (rows[0] === undefined) throw new ApplicationError("FORBIDDEN", "운영 공지 변경 권한이 없습니다.", 403);
  return rows[0].operator_id;
}

// 기존 공지 key 스냅샷을 복제하고 대상 key만 바꾼 새 버전을 활성 head로 교체합니다.
async function replaceActiveVersion(
  transaction: DatabaseTransaction,
  head: { active_configuration_set_id: bigint; version: bigint },
  command: OperationNoticeCommand,
  operatorId: bigint
): Promise<bigint> {
  const nextVersion = head.version + 1n;
  const inserted = await transaction.execute(
    `INSERT INTO configuration_sets(set_code,version,status,effective_from,approved_by,created_at)
     VALUES ('operation_notices',?,'preparing',NULL,?,UTC_TIMESTAMP(3))`, [nextVersion, operatorId]
  );
  await transaction.execute(
    `INSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value,validation_json)
     SELECT ?,config_key,value_type,string_value,validation_json FROM configuration_values WHERE configuration_set_id=?`,
    [inserted.insertId, head.active_configuration_set_id]
  );
  await transaction.execute(
    `INSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value)
     VALUES (? ,?,'string',?) ON DUPLICATE KEY UPDATE value_type='string',string_value=VALUES(string_value),decimal_value=NULL,integer_value=NULL,boolean_value=NULL,json_value=NULL`,
    [inserted.insertId, command.key, command.value]
  );
  const change = { key: command.key, action: command.value === "" ? "CLEAR" : "SET", valueHash: hash(command.value), valueLength: command.value.length, fromVersion: head.version.toString(), toVersion: nextVersion.toString() };
  await transaction.execute(
    "INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at) VALUES (?,? ,?, ?,UTC_TIMESTAMP(3))",
    [inserted.insertId, operatorId, change.action, JSON.stringify(change)]
  );
  await transaction.execute("UPDATE configuration_sets SET status='retired',effective_to=UTC_TIMESTAMP(3) WHERE id=?", [head.active_configuration_set_id]);
  await transaction.execute("UPDATE configuration_sets SET status='active',effective_from=UTC_TIMESTAMP(3) WHERE id=?", [inserted.insertId]);
  await transaction.execute(
    "UPDATE operation_notice_heads SET active_configuration_set_id=?,version=?,updated_at=UTC_TIMESTAMP(3) WHERE set_code='operation_notices' AND version=?",
    [inserted.insertId, nextVersion, head.version]
  );
  return nextVersion;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
