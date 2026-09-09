import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";

interface ManagedBackupTargetRow {
  target_code: string;
  file_name: string;
}

interface ManagedBackupSourceRow {
  id: bigint;
  file_name: string;
  payload_text: string;
  content_sha256: string;
  size_bytes: bigint;
  revision_version: bigint;
  modified_at: string;
}

export interface ManagedBackupResult {
  runId: string;
  sourceRevisionKey: string;
  targetCount: number;
  presentFiles: string[];
  missingFiles: string[];
  data: string;
  outboxId: string | null;
}

interface ManagedBackupExecutionContext {
  operatorId: bigint;
  idempotencyKey: string;
  reason: string;
  sourceCode: "iris" | "admin_web";
  eventId?: string;
  destinationId?: string;
}

// 인수가 없는 정확한 운영 백업 명령만 현대화 dispatch 후보로 허용합니다.
export function isManagedBackupCommand(message: string | undefined): boolean {
  return message === "/백업";
}

// 이벤트와 정렬된 source revision을 결합해 충돌 없는 백업 revision을 만듭니다.
export function buildManagedBackupRevisionKey(
  eventKey: string,
  rows: readonly {
    targetCode: string;
    fileName: string;
    revisionVersion: bigint | null;
    contentSha256: string | null;
  }[],
): string {
  const source = rows
    .map((row) =>
      [
        row.targetCode,
        row.fileName,
        row.revisionVersion?.toString() ?? "missing",
        row.contentSha256 ?? "missing",
      ].join(":"),
    )
    .join("\n");
  return "sha256:" + createHash("sha256").update(eventKey + "\n" + source).digest("hex");
}

export function formatManagedBackupResult(
  presentFiles: readonly string[],
  missingFiles: readonly string[],
): string {
  const lines = [
    "✅ 운영 데이터 백업 완료",
    "대상: " + (presentFiles.length + missingFiles.length) + "개",
    "저장: " + presentFiles.length + "개",
    "누락: " + missingFiles.length + "개",
  ];
  if (missingFiles.length > 0) lines.push("- 누락 파일: " + missingFiles.join(", "));
  return lines.join("\n");
}

// DB 카탈로그의 운영 대상 전체를 한 transaction의 immutable manifest로 보존합니다.
export class ManagedBackupCommandService {
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
    const decision = await new CommandDispatcher(
      new MariaCommandDispatchRepository(this.database),
      { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() },
    ).resolve({
      eventId: input.eventId,
      message: input.message,
      userId: input.externalUserId,
      hasTrustedDisplayName: true,
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.backup({
      eventId: input.eventId,
      externalUserId: input.externalUserId,
      destinationId: input.channelId,
    });
    if (result === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId! };
  }

  async backup(input: {
    eventId: string;
    externalUserId: string;
    destinationId: string;
  }): Promise<ManagedBackupResult | null> {
    const operator = (
      await this.database.query<Array<{ id: bigint }>>(
        "SELECT operator.id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active' AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='managed_backup.execute' AND denied.effect='deny') AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='managed_backup.execute' AND allowed.effect='allow') OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='managed_backup.execute' WHERE operator_role.operator_id=operator.id)) LIMIT 1",
        [input.externalUserId],
      )
    )[0];
    if (operator === undefined) return null;

    const eventKey =
      input.eventId.length <= 191
        ? input.eventId
        : "sha256:" + createHash("sha256").update(input.eventId).digest("hex");

    return this.executeBackup({
      operatorId: operator.id,
      idempotencyKey: eventKey,
      reason: "Iris /백업",
      sourceCode: "iris",
      eventId: input.eventId,
      destinationId: input.destinationId,
    });
  }

  // 인증된 웹 운영자를 기존 immutable manifest 백업 transaction에 연결합니다.
  async backupForOperator(input: {
    operatorId: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<ManagedBackupResult> {
    return this.executeBackup({
      operatorId: BigInt(input.operatorId),
      idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
      reason: input.reason,
      sourceCode: "admin_web",
    });
  }

  private async executeBackup(
    context: ManagedBackupExecutionContext,
  ): Promise<ManagedBackupResult> {
    return withManagedBackupRetry(() =>
      this.database.withTransaction(async (transaction) => {
        const previous = (
          await transaction.query<
            Array<{ result_json: string | ManagedBackupResult | null }>
          >(
            "SELECT result_json FROM operations WHERE idempotency_scope='managed_backup.execute' AND idempotency_key=? FOR UPDATE",
            [context.idempotencyKey],
          )
        )[0];
        if (previous?.result_json != null) {
          return typeof previous.result_json === "string"
            ? JSON.parse(previous.result_json)
            : previous.result_json;
        }

        const targets = await transaction.query<ManagedBackupTargetRow[]>(
          "SELECT target_code,file_name FROM managed_backup_targets WHERE active=TRUE ORDER BY sort_order,target_code FOR UPDATE",
        );
        if (targets.length === 0) throw new Error("Managed backup target catalog is empty.");
        const sources = await transaction.query<ManagedBackupSourceRow[]>(
          "SELECT id,file_name,payload_text,content_sha256,size_bytes,revision_version,DATE_FORMAT(modified_at,'%Y-%m-%d %H:%i:%s.%f') modified_at FROM managed_data_objects WHERE environment_code='prod' AND file_name IN (SELECT file_name FROM managed_backup_targets WHERE active=TRUE) ORDER BY file_name FOR UPDATE",
        );
        const sourceByFile = new Map(sources.map((source) => [source.file_name, source]));
        for (const source of sources) {
          const hash = createHash("sha256").update(source.payload_text).digest("hex");
          const size = BigInt(Buffer.byteLength(source.payload_text, "utf8"));
          if (hash !== source.content_sha256 || size !== BigInt(source.size_bytes)) {
            throw new Error("Managed backup source integrity mismatch: " + source.file_name);
          }
          try {
            JSON.parse(source.payload_text);
          } catch {
            throw new Error("Managed backup source JSON invalid: " + source.file_name);
          }
        }

        const revisionRows = targets.map((target) => {
          const source = sourceByFile.get(target.file_name);
          return {
            targetCode: target.target_code,
            fileName: target.file_name,
            revisionVersion: source?.revision_version ?? null,
            contentSha256: source?.content_sha256 ?? null,
          };
        });
        const sourceRevisionKey = buildManagedBackupRevisionKey(context.idempotencyKey, revisionRows);
        const operation = await transaction.execute(
          "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'managed_backup.execute',?,'admin_operator',?,?,'processing',UTC_TIMESTAMP(3))",
          [randomUUID(), context.idempotencyKey, context.operatorId, context.sourceCode],
        );
        const presentFiles = targets
          .filter((target) => sourceByFile.has(target.file_name))
          .map((target) => target.file_name);
        const missingFiles = targets
          .filter((target) => !sourceByFile.has(target.file_name))
          .map((target) => target.file_name);
        const run = await transaction.execute(
          "INSERT INTO managed_backup_runs(operation_id,source_environment,source_revision_key,run_status,target_count,present_count,missing_count,created_at) VALUES (?,'prod',?,'building',?,?,?,UTC_TIMESTAMP(3))",
          [
            operation.insertId,
            sourceRevisionKey,
            targets.length,
            presentFiles.length,
            missingFiles.length,
          ],
        );

        for (const target of targets) {
          const source = sourceByFile.get(target.file_name);
          if (source === undefined) {
            await transaction.execute(
              "INSERT INTO managed_backup_manifest(run_id,target_code,file_name,source_object_id,object_exists,source_revision,content_sha256,size_bytes,modified_at,payload_text,verification_status,captured_at) VALUES (?,?,?,NULL,FALSE,NULL,NULL,NULL,NULL,NULL,'missing',UTC_TIMESTAMP(3))",
              [run.insertId, target.target_code, target.file_name],
            );
          } else {
            await transaction.execute(
              "INSERT INTO managed_backup_manifest(run_id,target_code,file_name,source_object_id,object_exists,source_revision,content_sha256,size_bytes,modified_at,payload_text,verification_status,captured_at) VALUES (?,?,?, ?,TRUE,?,?,?,?,?,'verified',UTC_TIMESTAMP(3))",
              [
                run.insertId,
                target.target_code,
                target.file_name,
                source.id,
                source.revision_version,
                source.content_sha256,
                source.size_bytes,
                source.modified_at,
                source.payload_text,
              ],
            );
          }
        }

        await transaction.execute(
          "UPDATE managed_backup_runs SET run_status='complete',completed_at=UTC_TIMESTAMP(3) WHERE id=?",
          [run.insertId],
        );
        const data = formatManagedBackupResult(presentFiles, missingFiles);
        let outboxId: string | null = null;
        if (context.destinationId !== undefined && context.eventId !== undefined) {
          const outbox = await transaction.execute(
            "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            [operation.insertId, context.destinationId, JSON.stringify({ data })],
          );
          outboxId = outbox.insertId.toString();
          await transaction.execute(
            "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_MANAGED_BACKUP',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            [context.eventId, operation.insertId],
          );
        }
        await transaction.execute(
          "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'managed_backup_run',?,'managed_backup.execute','success',?,?,UTC_TIMESTAMP(3))",
          [
            operation.insertId,
            context.operatorId,
            run.insertId,
            context.reason,
            JSON.stringify({
              sourceEnvironment: "prod",
              sourceRevisionKey,
              targetCount: targets.length,
              presentFiles,
              missingFiles,
            }),
          ],
        );
        const result: ManagedBackupResult = {
          runId: run.insertId.toString(),
          sourceRevisionKey,
          targetCount: targets.length,
          presentFiles,
          missingFiles,
          data,
          outboxId,
        };
        await transaction.execute(
          "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
          [JSON.stringify(result), operation.insertId],
        );
        return result;
      }),
    );
  }
}

function normalizeIdempotencyKey(value: string): string {
  return value.length <= 191
    ? value
    : "sha256:" + createHash("sha256").update(value).digest("hex");
}

async function withManagedBackupRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const value = error as { code?: unknown; errno?: unknown };
      const retryable =
        value.code === "ER_LOCK_DEADLOCK" ||
        value.code === "ER_LOCK_WAIT_TIMEOUT" ||
        value.code === "ER_DUP_ENTRY" ||
        value.errno === 1213 ||
        value.errno === 1205 ||
        value.errno === 1062;
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error("Managed backup retry exhausted.");
}
