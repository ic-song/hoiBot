import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import {
  CommandDispatcher,
  MariaCommandDispatchRepository,
} from "../dispatch/command-dispatcher.js";
import type {
  DataStatusEnvironment,
  DataStatusTarget,
} from "./data-status-service.js";
import { ApplicationError } from "../shared/application-error.js";

export type DataRestoreGeneration = 1 | 2;

export interface DataRestoreCommand {
  environment: DataStatusEnvironment;
  target: DataStatusTarget | null;
  generation: DataRestoreGeneration | null;
}

export interface DataRestoreResult {
  environment: DataStatusEnvironment;
  target: DataStatusTarget | null;
  generation: DataRestoreGeneration | null;
  restored: boolean;
  sourceRevisionKey: string | null;
  sourceHash: string | null;
  beforeRevision: string | null;
  afterRevision: string | null;
  data: string;
  outboxId: string | null;
}

export interface DataRestorePreview {
  environment: DataStatusEnvironment;
  target: DataStatusTarget;
  generation: DataRestoreGeneration;
  available: boolean;
  sourceRevisionKey: string | null;
  sourceHash: string | null;
  beforeRevision: string | null;
  confirmationToken: string | null;
}

const TARGET_PATTERN =
  "(member|member_pet|petSkillData|petHomeActivityData)";
const PROD_EXECUTION = new RegExp(
  `^/데이터복구\\s+${TARGET_PATTERN}\\s+([12])$`,
);
const DEV_EXECUTION = new RegExp(
  `^dev/데이터복구\\s+${TARGET_PATTERN}\\s+([12])$`,
);
const USAGE =
  "사용법: /데이터복구 [member|member_pet|petSkillData|petHomeActivityData] [1|2]";

// 운영과 DEV의 정확한 데이터 복구 명령만 현대화 후보로 허용합니다.
export function parseDataRestoreCommand(
  message: string | undefined,
): DataRestoreCommand | null {
  if (message === "/데이터복구") {
    return { environment: "prod", target: null, generation: null };
  }
  if (message === "dev/데이터복구") {
    return { environment: "dev", target: null, generation: null };
  }
  const prod = message?.match(PROD_EXECUTION);
  if (prod !== undefined && prod !== null) {
    return {
      environment: "prod",
      target: prod[1] as DataStatusTarget,
      generation: Number(prod[2]) as DataRestoreGeneration,
    };
  }
  const dev = message?.match(DEV_EXECUTION);
  if (dev !== undefined && dev !== null) {
    return {
      environment: "dev",
      target: dev[1] as DataStatusTarget,
      generation: Number(dev[2]) as DataRestoreGeneration,
    };
  }
  return null;
}

export function isDataRestoreCommandCandidate(
  message: string | undefined,
): boolean {
  return parseDataRestoreCommand(message) !== null;
}

// 복구 결과를 호출자가 확인할 수 있는 고정 형식으로 표시합니다.
export function formatDataRestoreResult(
  input: Omit<DataRestoreResult, "data" | "outboxId">,
): string {
  if (input.target === null || input.generation === null) return USAGE;
  const environment = input.environment === "dev" ? "DEV" : "운영";
  if (!input.restored) {
    return [
      "❌ 데이터 복구 실패",
      `환경: ${environment}`,
      `파일: ${input.target}`,
      `백업: ${input.generation}차`,
      "선택한 백업이 없거나 손상되었습니다.",
    ].join("\n");
  }
  return [
    "✅ 데이터 복구 완료",
    `환경: ${environment}`,
    `파일: ${input.target}`,
    `백업: ${input.generation}차`,
    `revision: ${input.sourceRevisionKey ?? "-"}`,
  ].join("\n");
}

// dry-run에서 확인한 source와 현재 대상 revision을 실행 확인 토큰으로 고정합니다.
export function buildRestoreConfirmationToken(input: {
  environment: DataStatusEnvironment;
  target: DataStatusTarget;
  generation: DataRestoreGeneration;
  sourceRevisionKey: string;
  sourceHash: string;
  beforeRevision: string | null;
}): string {
  return "sha256:" + createHash("sha256").update([
    input.environment,
    input.target,
    input.generation,
    input.sourceRevisionKey,
    input.sourceHash,
    input.beforeRevision ?? "missing",
  ].join(":"), "utf8").digest("hex");
}

// immutable 백업 payload를 검증하고 현재 원본 snapshot과 복구 결과를 원자 저장합니다.
export class DataRestoreService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: {
    externalUserId: string;
    channelId: string;
    message: string;
    eventId: string;
  }): Promise<
    | { status: "changed"; data: string; outboxId: string }
    | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const command = parseDataRestoreCommand(input.message);
    if (command === null) return { status: "legacy_fallback" };
    const normalized =
      command.environment === "dev" ? "dev/데이터복구" : "/데이터복구";
    const decision = await new CommandDispatcher(
      new MariaCommandDispatchRepository(this.database),
      { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() },
    ).resolve({
      eventId: input.eventId,
      message: normalized,
      userId: input.externalUserId,
      hasTrustedDisplayName: true,
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.restore({
      eventId: input.eventId,
      externalUserId: input.externalUserId,
      destinationId: input.channelId,
      command,
    });
    if (result === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId! };
  }

  async restore(input: {
    eventId: string;
    externalUserId: string;
    destinationId: string;
    command: DataRestoreCommand;
  }): Promise<DataRestoreResult | null> {
    const operator = await this.findOperator(input.externalUserId);
    if (operator === undefined) return null;
    const scope =
      input.command.target === null
        ? "data_restore.guide"
        : "data_restore.execute";
    const idempotencyKey =
      input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    return withDeadlockRetry(() =>
      this.database.withTransaction(async (transaction) => {
        const previous = (
          await transaction.query<
            Array<{ result_json: string | DataRestoreResult | null }>
          >(
            "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
            [scope, idempotencyKey],
          )
        )[0];
        if (previous?.result_json != null) {
          return typeof previous.result_json === "string"
            ? (JSON.parse(previous.result_json) as DataRestoreResult)
            : previous.result_json;
        }
        if (
          input.command.target === null ||
          input.command.generation === null
        ) {
          return this.persistReply(transaction, {
            operatorId: operator.id,
            idempotencyKey,
            scope,
            eventId: input.eventId,
            destinationId: input.destinationId,
            base: {
              environment: input.command.environment,
              target: null,
              generation: null,
              restored: false,
              sourceRevisionKey: null,
              sourceHash: null,
              beforeRevision: null,
              afterRevision: null,
            },
            resultCode: "guide",
            auditTargetId: null,
          });
        }
        return this.restoreTarget(
          transaction,
          operator.id,
          idempotencyKey,
          input,
        );
      }),
    );
  }

  // 웹 실행 전에 immutable source와 현재 대상 revision을 변경 없이 검증합니다.
  async previewForOperator(input: {
    operatorId: string;
    environment: DataStatusEnvironment;
    target: DataStatusTarget;
    generation: DataRestoreGeneration;
  }): Promise<DataRestorePreview> {
    BigInt(input.operatorId);
    const source = await this.readRestoreSource(this.database, input.environment, input.target, input.generation, false);
    if (!validateSource(source)) {
      return {
        environment: input.environment,
        target: input.target,
        generation: input.generation,
        available: false,
        sourceRevisionKey: source?.revision_key ?? null,
        sourceHash: source?.object_hash ?? null,
        beforeRevision: null,
        confirmationToken: null,
      };
    }
    const before = (await this.database.query<Array<{ revision_version: bigint }>>(
      "SELECT revision_version FROM managed_data_objects WHERE environment_code=? AND file_name=? LIMIT 1",
      [input.environment, `${input.target}.json`],
    ))[0];
    const beforeRevision = before?.revision_version.toString() ?? null;
    return {
      environment: input.environment,
      target: input.target,
      generation: input.generation,
      available: true,
      sourceRevisionKey: source.revision_key,
      sourceHash: source.payload_hash,
      beforeRevision,
      confirmationToken: buildRestoreConfirmationToken({
        ...input,
        sourceRevisionKey: source.revision_key,
        sourceHash: source.payload_hash,
        beforeRevision,
      }),
    };
  }

  // dry-run 토큰을 재검증하고 기존 snapshot·restore transaction을 웹에서 실행합니다.
  async restoreForOperator(input: {
    operatorId: string;
    idempotencyKey: string;
    reason: string;
    environment: DataStatusEnvironment;
    target: DataStatusTarget;
    generation: DataRestoreGeneration;
    confirmationToken: string;
  }): Promise<DataRestoreResult> {
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const previous = (await transaction.query<Array<{ result_json: string | DataRestoreResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='data_restore.execute' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey],
      ))[0];
      if (previous?.result_json != null) return typeof previous.result_json === "string" ? JSON.parse(previous.result_json) : previous.result_json;
      return this.restoreTarget(transaction, BigInt(input.operatorId), idempotencyKey, {
        eventId: input.idempotencyKey,
        destinationId: "",
        command: { environment: input.environment, target: input.target, generation: input.generation },
      }, {
        sourceCode: "admin_web",
        reason: input.reason,
        confirmationToken: input.confirmationToken,
      });
    }));
  }

  private async findOperator(externalUserId: string) {
    return (
      await this.database.query<Array<{ id: bigint }>>(
        `SELECT operator.id FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active'
         AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='data_restore.execute' AND denied.effect='deny')
         AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='data_restore.execute' AND allowed.effect='allow')
           OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='data_restore.execute' WHERE operator_role.operator_id=operator.id))
         LIMIT 1`,
        [externalUserId],
      )
    )[0];
  }

  private async restoreTarget(
    transaction: DatabaseTransaction,
    operatorId: bigint,
    idempotencyKey: string,
    input: {
      eventId: string;
      destinationId: string;
      command: DataRestoreCommand;
    },
    execution: {
      sourceCode: "iris" | "admin_web";
      reason: string;
      confirmationToken?: string;
    } = { sourceCode: "iris", reason: "Iris /데이터복구" },
  ): Promise<DataRestoreResult> {
    const target = input.command.target!;
    const generation = input.command.generation!;
    const slot = `backup${generation}`;
    const source = await this.readRestoreSource(transaction, input.command.environment, target, generation, true);
    const valid = validateSource(source);
    if (!valid) {
      return this.persistReply(transaction, {
        operatorId,
        idempotencyKey,
        scope: "data_restore.execute",
        eventId: input.eventId,
        destinationId: input.destinationId,
        base: {
          environment: input.command.environment,
          target,
          generation,
          restored: false,
          sourceRevisionKey: source?.revision_key ?? null,
          sourceHash: source?.object_hash ?? null,
          beforeRevision: null,
          afterRevision: null,
        },
        resultCode: "backup_unavailable",
        auditTargetId: source?.generation_id ?? null,
      });
    }
    const targetFile = `${target}.json`;
    const before = (
      await transaction.query<
        Array<{
          id: bigint;
          payload_text: string;
          content_sha256: string;
          size_bytes: bigint;
          revision_version: bigint;
        }>
      >(
        "SELECT id,payload_text,content_sha256,size_bytes,revision_version FROM managed_data_objects WHERE environment_code=? AND file_name=? FOR UPDATE",
        [input.command.environment, targetFile],
      )
    )[0];
    if (execution.confirmationToken !== undefined) {
      const expected = buildRestoreConfirmationToken({
        environment: input.command.environment,
        target,
        generation,
        sourceRevisionKey: source.revision_key,
        sourceHash: source.payload_hash,
        beforeRevision: before?.revision_version.toString() ?? null,
      });
      if (execution.confirmationToken !== expected) {
        throw new ApplicationError("RESTORE_PREVIEW_STALE", "백업 또는 현재 데이터가 변경됐습니다. dry-run을 다시 실행해 주세요.", 409);
      }
    }
    const operation = await transaction.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'data_restore.execute',?,'admin_operator',?,?,'processing',UTC_TIMESTAMP(3))",
      [randomUUID(), idempotencyKey, operatorId, execution.sourceCode],
    );
    const restore = await transaction.execute(
      "INSERT INTO restore_operations(operation_id,generation_id,source_backup_object_id,environment_code,target_code,slot_code,before_target_object_id,before_revision,restore_status) VALUES (?,?,?,?,?,?,?,?, 'processing')",
      [
        operation.insertId,
        source.generation_id,
        source.source_object_id,
        input.command.environment,
        target,
        slot,
        before?.id ?? null,
        before?.revision_version ?? null,
      ],
    );
    await transaction.execute(
      "INSERT INTO restore_snapshots(restore_operation_id,object_existed,payload_text,content_sha256,size_bytes,revision_version,captured_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))",
      [
        restore.insertId,
        before !== undefined,
        before?.payload_text ?? null,
        before?.content_sha256 ?? null,
        before?.size_bytes ?? null,
        before?.revision_version ?? null,
      ],
    );
    await transaction.execute(
      `INSERT INTO managed_data_objects(environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at)
       VALUES (?,?,?,?,?,1,UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE payload_text=VALUES(payload_text),content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)`,
      [
        input.command.environment,
        targetFile,
        source.payload_text,
        source.payload_hash,
        source.payload_size,
      ],
    );
    const after = (
      await transaction.query<
        Array<{ id: bigint; revision_version: bigint }>
      >(
        "SELECT id,revision_version FROM managed_data_objects WHERE environment_code=? AND file_name=? FOR UPDATE",
        [input.command.environment, targetFile],
      )
    )[0]!;
    await transaction.execute(
      "UPDATE restore_operations SET after_target_object_id=?,after_revision=?,restore_status='complete',restored_at=UTC_TIMESTAMP(3) WHERE id=?",
      [after.id, after.revision_version, restore.insertId],
    );
    const base = {
      environment: input.command.environment,
      target,
      generation,
      restored: true,
      sourceRevisionKey: source.revision_key,
      sourceHash: source.payload_hash,
      beforeRevision: before?.revision_version.toString() ?? null,
      afterRevision: after.revision_version.toString(),
    };
    const data = formatDataRestoreResult(base);
    let outboxId: string | null = null;
    if (execution.sourceCode === "iris") {
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      outboxId = outbox.insertId.toString();
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_DATA_RESTORE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId],
      );
    }
    await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'backup_object',?,'data_restore.execute','success',?,?,UTC_TIMESTAMP(3))",
      [
        operation.insertId,
        operatorId,
        source.source_object_id,
        execution.reason,
        JSON.stringify({
          environment: input.command.environment,
          target,
          slot,
          beforeRevision: base.beforeRevision,
          afterRevision: base.afterRevision,
          sourceHash: base.sourceHash,
        }),
      ],
    );
    const result: DataRestoreResult = {
      ...base,
      data,
      outboxId,
    };
    await transaction.execute(
      "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
      [JSON.stringify(result), operation.insertId],
    );
    return result;
  }

  private async readRestoreSource(
    database: Pick<DatabaseClient, "query">,
    environment: DataStatusEnvironment,
    target: DataStatusTarget,
    generation: DataRestoreGeneration,
    lock: boolean,
  ) {
    return (await database.query<Array<{
      generation_id: bigint;
      revision_key: string;
      source_object_id: bigint;
      object_exists: number;
      object_hash: string | null;
      object_size: bigint | null;
      valid_json: number | null;
      payload_text: string | null;
      payload_hash: string | null;
      payload_size: bigint | null;
    }>>(
      `SELECT generation.id generation_id,generation.revision_key,
              object_row.id source_object_id,object_row.object_exists,
              object_row.content_sha256 object_hash,object_row.size_bytes object_size,
              health.valid_json,payload.payload_text,
              payload.content_sha256 payload_hash,payload.size_bytes payload_size
         FROM backup_generations generation
         JOIN backup_objects object_row ON object_row.generation_id=generation.id
         LEFT JOIN backup_health_checks health ON health.backup_object_id=object_row.id
         LEFT JOIN backup_object_payloads payload ON payload.backup_object_id=object_row.id
        WHERE generation.environment_code=? AND generation.generation_status='complete'
          AND object_row.target_code=? AND object_row.slot_code=?
        ORDER BY generation.completed_at DESC,generation.id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [environment, target, `backup${generation}`],
    ))[0];
  }

  private async persistReply(
    transaction: DatabaseTransaction,
    input: {
      operatorId: bigint;
      idempotencyKey: string;
      scope: string;
      eventId: string;
      destinationId: string;
      base: Omit<DataRestoreResult, "data" | "outboxId">;
      resultCode: string;
      auditTargetId: bigint | null;
    },
  ): Promise<DataRestoreResult> {
    const operation = await transaction.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), input.scope, input.idempotencyKey, input.operatorId],
    );
    const data = formatDataRestoreResult(input.base);
    const outbox = await transaction.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [operation.insertId, input.destinationId, JSON.stringify({ data })],
    );
    await transaction.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_DATA_RESTORE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [input.eventId, operation.insertId, input.resultCode],
    );
    await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'backup_generation',?,'data_restore.execute',?,'Iris /데이터복구',?,UTC_TIMESTAMP(3))",
      [
        operation.insertId,
        input.operatorId,
        input.auditTargetId,
        input.resultCode === "guide" ? "success" : "failure",
        JSON.stringify({
          environment: input.base.environment,
          target: input.base.target,
          generation: input.base.generation,
          restored: false,
        }),
      ],
    );
    const result: DataRestoreResult = {
      ...input.base,
      data,
      outboxId: outbox.insertId.toString(),
    };
    await transaction.execute(
      "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
      [JSON.stringify(result), operation.insertId],
    );
    return result;
  }
}

function normalizeIdempotencyKey(value: string): string {
  return value.length <= 191
    ? value
    : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validateSource(
  source:
    | {
        object_exists: number;
        object_hash: string | null;
        object_size: bigint | null;
        valid_json: number | null;
        payload_text: string | null;
        payload_hash: string | null;
        payload_size: bigint | null;
      }
    | undefined,
): source is NonNullable<typeof source> & {
  payload_text: string;
  payload_hash: string;
  payload_size: bigint;
} {
  if (
    source === undefined ||
    source.object_exists !== 1 ||
    source.valid_json !== 1 ||
    source.payload_text === null ||
    source.object_hash === null ||
    source.object_size === null ||
    source.payload_hash === null ||
    source.payload_size === null
  ) {
    return false;
  }
  try {
    JSON.parse(source.payload_text);
  } catch {
    return false;
  }
  const hash = createHash("sha256").update(source.payload_text).digest("hex");
  const size = BigInt(Buffer.byteLength(source.payload_text, "utf8"));
  return (
    hash === source.object_hash &&
    hash === source.payload_hash &&
    size === source.object_size &&
    size === source.payload_size
  );
}

async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const dbError = error as { code?: unknown; errno?: unknown };
      if (
        attempt === 2 ||
        (dbError.code !== "ER_LOCK_DEADLOCK" && dbError.errno !== 1213)
      ) {
        throw error;
      }
    }
  }
  throw new Error("Data restore deadlock retry exhausted.");
}
