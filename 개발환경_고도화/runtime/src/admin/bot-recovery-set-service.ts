import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import {
  CommandDispatcher,
  MariaCommandDispatchRepository,
} from "../dispatch/command-dispatcher.js";

const TARGETS = [
  "member",
  "member_pet",
  "petHomeActivityData",
  "petSkillData",
] as const;
const REQUIRED_TARGETS = [
  "member",
  "member_pet",
  "petHomeActivityData",
] as const;

export type BotRecoveryTarget = (typeof TARGETS)[number];

export interface BotRecoverySetResult {
  restored: boolean;
  sourceRevisionKey: string | null;
  restoredTargets: BotRecoveryTarget[];
  skippedTargets: BotRecoveryTarget[];
  data: string;
  outboxId: string;
}

interface SourceRow {
  generation_id: bigint;
  revision_key: string;
  source_object_id: bigint;
  target_code: BotRecoveryTarget;
  object_exists: number;
  object_hash: string | null;
  object_size: bigint | null;
  valid_json: number | null;
  payload_text: string | null;
  payload_hash: string | null;
  payload_size: bigint | null;
}

interface ValidSource extends SourceRow {
  payload_text: string;
  payload_hash: string;
  payload_size: bigint;
}

interface OperatorRow {
  id: bigint;
  display_name: string;
}

export function isBotRecoverySetCommand(message: string | undefined): boolean {
  return message === "/봇살리기";
}

export function formatBotRecoverySetSuccess(displayName: string): string {
  return `${displayName}님이 직전 데이터로 봇을 살립니다.`;
}

// 직전 backup1 세트 전체를 검증한 뒤 운영 데이터 3~4개를 원자 복구합니다.
export class BotRecoverySetService {
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
    if (!isBotRecoverySetCommand(input.message)) {
      return { status: "legacy_fallback" };
    }
    const decision = await new CommandDispatcher(
      new MariaCommandDispatchRepository(this.database),
      { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() },
    ).resolve({
      eventId: input.eventId,
      message: "/봇살리기",
      userId: input.externalUserId,
      hasTrustedDisplayName: true,
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.restore(input);
    if (result === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async restore(input: {
    externalUserId: string;
    channelId: string;
    eventId: string;
  }): Promise<BotRecoverySetResult | null> {
    const operator = await this.findOperator(input.externalUserId);
    if (operator === undefined) return null;
    const idempotencyKey = normalizeIdempotencyKey(input.eventId);
    return withDeadlockRetry(() =>
      this.database.withTransaction(async (transaction) => {
        const previous = (
          await transaction.query<
            Array<{ result_json: string | BotRecoverySetResult | null }>
          >(
            "SELECT result_json FROM operations WHERE idempotency_scope='bot_recovery_set.execute' AND idempotency_key=? FOR UPDATE",
            [idempotencyKey],
          )
        )[0];
        if (previous?.result_json != null) {
          return typeof previous.result_json === "string"
            ? (JSON.parse(previous.result_json) as BotRecoverySetResult)
            : previous.result_json;
        }

        const generation = (
          await transaction.query<
            Array<{ id: bigint; revision_key: string }>
          >(
            `SELECT id,revision_key FROM backup_generations
             WHERE environment_code='prod' AND generation_status='complete'
             ORDER BY completed_at DESC,id DESC LIMIT 1 FOR UPDATE`,
          )
        )[0];
        if (generation === undefined) {
          return this.persistFailure(transaction, operator, idempotencyKey, input, {
            code: "member_backup_missing",
            message: "해당 경로에 파일 없음",
            generationId: null,
            revisionKey: null,
          });
        }

        const sources = await this.readSources(transaction, generation.id);
        const byTarget = new Map(sources.map((source) => [source.target_code, source]));
        const member = byTarget.get("member");
        if (!validateSource(member)) {
          return this.persistFailure(transaction, operator, idempotencyKey, input, {
            code: "member_backup_missing",
            message: "해당 경로에 파일 없음",
            generationId: generation.id,
            revisionKey: generation.revision_key,
          });
        }
        const required = REQUIRED_TARGETS.map((target) => byTarget.get(target));
        if (!required.every(validateSource)) {
          return this.persistFailure(transaction, operator, idempotencyKey, input, {
            code: "backup_invalid",
            message: "백파일도 이상 발생...",
            generationId: generation.id,
            revisionKey: generation.revision_key,
          });
        }
        const optional = byTarget.get("petSkillData");
        if (optional !== undefined && optional.object_exists === 1 && !validateSource(optional)) {
          return this.persistFailure(transaction, operator, idempotencyKey, input, {
            code: "backup_invalid",
            message: "백파일도 이상 발생...",
            generationId: generation.id,
            revisionKey: generation.revision_key,
          });
        }

        const validSources = required as ValidSource[];
        if (validateSource(optional)) validSources.push(optional);
        return this.restoreSet(
          transaction,
          operator,
          idempotencyKey,
          input,
          generation,
          validSources,
        );
      }),
    );
  }

  private async findOperator(externalUserId: string): Promise<OperatorRow | undefined> {
    return (
      await this.database.query<OperatorRow[]>(
        `SELECT operator.id,operator.display_name FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND operator.status='active'
           AND NOT EXISTS (
             SELECT 1 FROM admin_operator_permission_overrides denied
             WHERE denied.operator_id=operator.id AND denied.permission_code='data_restore.execute' AND denied.effect='deny'
           )
           AND (
             EXISTS (
               SELECT 1 FROM admin_operator_permission_overrides allowed
               WHERE allowed.operator_id=operator.id AND allowed.permission_code='data_restore.execute' AND allowed.effect='allow'
             ) OR EXISTS (
               SELECT 1 FROM admin_operator_roles operator_role
               JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
               JOIN admin_role_permissions permission ON permission.role_id=role.id
                 AND permission.permission_code='data_restore.execute'
               WHERE operator_role.operator_id=operator.id
             )
           ) LIMIT 1`,
        [externalUserId],
      )
    )[0];
  }

  private async readSources(
    transaction: DatabaseTransaction,
    generationId: bigint,
  ): Promise<SourceRow[]> {
    return transaction.query<SourceRow[]>(
      `SELECT generation.id generation_id,generation.revision_key,
              object_row.id source_object_id,object_row.target_code,
              object_row.object_exists,object_row.content_sha256 object_hash,
              object_row.size_bytes object_size,health.valid_json,
              payload.payload_text,payload.content_sha256 payload_hash,
              payload.size_bytes payload_size
         FROM backup_generations generation
         JOIN backup_objects object_row ON object_row.generation_id=generation.id
         LEFT JOIN backup_health_checks health ON health.backup_object_id=object_row.id
         LEFT JOIN backup_object_payloads payload ON payload.backup_object_id=object_row.id
        WHERE generation.id=? AND object_row.slot_code='backup1'
          AND object_row.target_code IN ('member','member_pet','petSkillData','petHomeActivityData')
        ORDER BY object_row.target_code FOR UPDATE`,
      [generationId],
    );
  }

  private async restoreSet(
    transaction: DatabaseTransaction,
    operator: OperatorRow,
    idempotencyKey: string,
    input: { channelId: string; eventId: string },
    generation: { id: bigint; revision_key: string },
    sources: ValidSource[],
  ): Promise<BotRecoverySetResult> {
    const operation = await transaction.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'bot_recovery_set.execute',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), idempotencyKey, operator.id],
    );
    await transaction.execute(
      "INSERT INTO bot_recovery_set_runs(operation_id,generation_id,environment_code,slot_code,source_revision_key,restore_status,created_at) VALUES (?,?,'prod','backup1',?,'processing',UTC_TIMESTAMP(3))",
      [operation.insertId, generation.id, generation.revision_key],
    );

    const ordered = [...sources].sort((left, right) =>
      left.target_code.localeCompare(right.target_code),
    );
    for (const source of ordered) {
      const fileName = `${source.target_code}.json`;
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
          "SELECT id,payload_text,content_sha256,size_bytes,revision_version FROM managed_data_objects WHERE environment_code='prod' AND file_name=? FOR UPDATE",
          [fileName],
        )
      )[0];
      await transaction.execute(
        `INSERT INTO bot_recovery_set_items(
           operation_id,target_code,source_backup_object_id,required_item,
           before_target_object_id,before_object_existed,before_payload_text,
           before_content_sha256,before_size_bytes,before_revision
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          operation.insertId,
          source.target_code,
          source.source_object_id,
          REQUIRED_TARGETS.includes(source.target_code as (typeof REQUIRED_TARGETS)[number]),
          before?.id ?? null,
          before !== undefined,
          before?.payload_text ?? null,
          before?.content_sha256 ?? null,
          before?.size_bytes ?? null,
          before?.revision_version ?? null,
        ],
      );
      await transaction.execute(
        `INSERT INTO managed_data_objects(
           environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at
         ) VALUES ('prod',?,?,?,?,1,UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE payload_text=VALUES(payload_text),
           content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),
           revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)`,
        [fileName, source.payload_text, source.payload_hash, source.payload_size],
      );
      const after = (
        await transaction.query<Array<{ id: bigint; revision_version: bigint }>>(
          "SELECT id,revision_version FROM managed_data_objects WHERE environment_code='prod' AND file_name=? FOR UPDATE",
          [fileName],
        )
      )[0]!;
      await transaction.execute(
        "UPDATE bot_recovery_set_items SET after_target_object_id=?,after_revision=? WHERE operation_id=? AND target_code=?",
        [after.id, after.revision_version, operation.insertId, source.target_code],
      );
    }

    await transaction.execute(
      "UPDATE bot_recovery_set_runs SET restore_status='complete',restored_count=?,restored_at=UTC_TIMESTAMP(3) WHERE operation_id=?",
      [ordered.length, operation.insertId],
    );
    const restoredTargets = ordered.map((source) => source.target_code);
    const skippedTargets = TARGETS.filter((target) => !restoredTargets.includes(target));
    const data = formatBotRecoverySetSuccess(operator.display_name);
    const outbox = await transaction.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [operation.insertId, input.channelId, JSON.stringify({ data })],
    );
    await transaction.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'BOT_RECOVERY_SET',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [input.eventId, operation.insertId],
    );
    await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'backup_generation',?,'bot_recovery_set.execute','success','Iris /봇살리기',?,UTC_TIMESTAMP(3))",
      [
        operation.insertId,
        operator.id,
        generation.id,
        JSON.stringify({
          environment: "prod",
          slot: "backup1",
          sourceRevisionKey: generation.revision_key,
          restoredTargets,
          skippedTargets,
        }),
      ],
    );
    const result: BotRecoverySetResult = {
      restored: true,
      sourceRevisionKey: generation.revision_key,
      restoredTargets,
      skippedTargets,
      data,
      outboxId: outbox.insertId.toString(),
    };
    await transaction.execute(
      "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
      [JSON.stringify(result), operation.insertId],
    );
    return result;
  }

  private async persistFailure(
    transaction: DatabaseTransaction,
    operator: OperatorRow,
    idempotencyKey: string,
    input: { channelId: string; eventId: string },
    failure: {
      code: string;
      message: string;
      generationId: bigint | null;
      revisionKey: string | null;
    },
  ): Promise<BotRecoverySetResult> {
    const operation = await transaction.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'bot_recovery_set.execute',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), idempotencyKey, operator.id],
    );
    const outbox = await transaction.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [operation.insertId, input.channelId, JSON.stringify({ data: failure.message })],
    );
    await transaction.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'BOT_RECOVERY_SET',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [input.eventId, operation.insertId, failure.code],
    );
    await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'backup_generation',?,'bot_recovery_set.execute','failure','Iris /봇살리기',?,UTC_TIMESTAMP(3))",
      [
        operation.insertId,
        operator.id,
        failure.generationId,
        JSON.stringify({
          environment: "prod",
          slot: "backup1",
          sourceRevisionKey: failure.revisionKey,
          failureCode: failure.code,
        }),
      ],
    );
    const result: BotRecoverySetResult = {
      restored: false,
      sourceRevisionKey: failure.revisionKey,
      restoredTargets: [],
      skippedTargets: [...TARGETS],
      data: failure.message,
      outboxId: outbox.insertId.toString(),
    };
    await transaction.execute(
      "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
      [JSON.stringify(result), operation.insertId],
    );
    return result;
  }
}

function validateSource(source: SourceRow | undefined): source is ValidSource {
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

function normalizeIdempotencyKey(value: string): string {
  return value.length <= 191
    ? value
    : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const databaseError = error as { code?: unknown; errno?: unknown };
      if (
        attempt === 2 ||
        (databaseError.code !== "ER_LOCK_DEADLOCK" && databaseError.errno !== 1213)
      ) {
        throw error;
      }
    }
  }
  throw new Error("Bot recovery set deadlock retry exhausted.");
}
