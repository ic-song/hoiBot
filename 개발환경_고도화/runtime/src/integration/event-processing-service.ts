import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type { NormalizedIrisEvent } from "./iris-normalizer.js";

export interface PendingReply {
  outboxId: string;
  room: string;
  data: string;
}

export interface EventProcessingResult {
  duplicate: boolean;
  replies: PendingReply[];
}

// MariaDB 중복 키 오류인지 드라이버 코드로 확인합니다.
function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

// Iris 이벤트의 inbox, 명령 실행과 outbox를 한 트랜잭션으로 처리합니다.
export class ProcessIrisEventService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(event: NormalizedIrisEvent): Promise<EventProcessingResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
        const identity = await observeEventIdentity(transaction, event);
        await transaction.execute(
          `INSERT INTO event_inbox (
             event_id, provider_code, provider_event_id, external_channel_id, channel_id,
             external_user_id, external_identity_id,
             event_kind, event_origin, direction, payload_hash, parse_status,
             processing_status, received_at, attempt_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsed', 'processing', UTC_TIMESTAMP(3), 1)`,
          [event.eventId, event.providerCode, event.providerEventId, event.channelId ?? null, identity.channelId,
            event.userId ?? null, identity.externalIdentityId, event.eventKind, event.origin ?? null,
            event.direction, event.payloadHash]
        );

        const replies: PendingReply[] = [];
        if (event.message === "/ping" && event.channelId !== undefined && event.displayName !== undefined) {
          replies.push(await this.createPingReply(transaction, event));
        }

        await transaction.execute(
          "UPDATE event_inbox SET processing_status = 'processed', processed_at = UTC_TIMESTAMP(3) WHERE event_id = ?",
          [event.eventId]
        );
        return { duplicate: false, replies };
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        return { duplicate: true, replies: [] };
      }
      throw error;
    }
  }

  async queueCommandReply(event: NormalizedIrisEvent, commandCode: string, data: string): Promise<PendingReply> {
    if (event.channelId === undefined) {
      throw new Error("Cannot queue an Iris reply without a channel id.");
    }
    const channelId = event.channelId;
    return this.database.withTransaction(async (transaction) => {
      const operation = await transaction.execute(
        `INSERT INTO operations
           (operation_key, actor_type, source_code, status, created_at, completed_at)
         VALUES (?, 'external_identity', 'iris', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID()]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [event.eventId, commandCode, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, channelId, JSON.stringify({ data })]
      );
      return { outboxId: outbox.insertId.toString(), room: channelId, data };
    });
  }

  private async createPingReply(
    transaction: DatabaseTransaction,
    event: NormalizedIrisEvent
  ): Promise<PendingReply> {
    const operation = await transaction.execute(
      `INSERT INTO operations
         (operation_key, actor_type, source_code, status, created_at, completed_at)
       VALUES (?, 'external_identity', 'iris', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [randomUUID()]
    );
    await transaction.execute(
      `INSERT INTO command_executions
         (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, 'ping', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [event.eventId, operation.insertId]
    );
    const data = `${event.displayName} pong`;
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages
         (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation.insertId, event.channelId, JSON.stringify({ data })]
    );
    return { outboxId: outbox.insertId.toString(), room: event.channelId!, data };
  }
}

// 관측된 channel/identity/name을 후보 상태로 기록하되 표시명만으로 player를 연결하지 않습니다.
async function observeEventIdentity(
  transaction: DatabaseTransaction,
  event: NormalizedIrisEvent
): Promise<{ channelId: bigint | null; externalIdentityId: bigint | null }> {
  let channelId: bigint | null = null;
  let externalIdentityId: bigint | null = null;
  if (event.channelId !== undefined) {
    await transaction.execute(
      `INSERT INTO channels (provider_code, external_channel_id, channel_type, status, created_at, updated_at)
       VALUES (?, ?, 'group', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
      [event.providerCode, event.channelId]
    );
    const channels = await transaction.query<Array<{ id: bigint }>>(
      "SELECT id FROM channels WHERE provider_code = ? AND external_channel_id = ?",
      [event.providerCode, event.channelId]
    );
    channelId = channels[0]?.id ?? null;
  }
  if (event.userId !== undefined) {
    const existing = await transaction.query<Array<{ id: bigint; display_name: string | null }>>(
      "SELECT id, display_name FROM external_identities WHERE provider_code = ? AND external_user_id = ? FOR UPDATE",
      [event.providerCode === "iris" ? "kakao" : event.providerCode, event.userId]
    );
    await transaction.execute(
      `INSERT INTO external_identities
        (provider_code, external_user_id, display_name, status, created_at, updated_at)
       VALUES ('kakao', ?, ?, 'candidate', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(VALUES(display_name), display_name), updated_at = VALUES(updated_at)`,
      [event.userId, event.displayName ?? null]
    );
    const observed = await transaction.query<Array<{ id: bigint }>>(
      "SELECT id FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ?",
      [event.userId]
    );
    externalIdentityId = observed[0]?.id ?? null;
    if (event.displayName !== undefined && (existing[0] === undefined || existing[0].display_name !== event.displayName)) {
      await transaction.execute(
        "INSERT INTO external_identity_names (external_identity_id, display_name, observed_at) VALUES (?, ?, UTC_TIMESTAMP(3))",
        [externalIdentityId, event.displayName]
      );
    }
  }
  if (channelId !== null && externalIdentityId !== null) {
    await transaction.execute(
      `INSERT INTO channel_memberships (channel_id, external_identity_id, status, joined_at, updated_at)
       VALUES (?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status = 'active', updated_at = VALUES(updated_at)`,
      [channelId, externalIdentityId]
    );
  }
  return { channelId, externalIdentityId };
}

// 전송 성공 또는 실패를 outbox와 delivery attempt에 기록합니다.
export async function recordOutboxDelivery(
  database: DatabaseClient,
  outboxId: string,
  result: { ok: true } | { ok: false; errorCode: string }
): Promise<void> {
  await database.withTransaction(async (transaction) => {
    const attempts = await transaction.query<Array<{ next_attempt: bigint }>>(
      "SELECT attempt_count + 1 AS next_attempt FROM outbox_messages WHERE id = ? FOR UPDATE",
      [outboxId]
    );
    const attempt = attempts[0]?.next_attempt ?? 1n;
    const deliveryStatus = result.ok ? "sent" : attempt >= 10n ? "dead_letter" : "failed";
    await transaction.execute(
      `UPDATE outbox_messages
       SET status = ?, attempt_count = ?, sent_at = ?, last_error_code = ?,
           available_at = IF(? = 'failed', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE), available_at)
       WHERE id = ?`,
      [deliveryStatus, attempt, result.ok ? new Date() : null,
        result.ok ? null : result.errorCode, deliveryStatus, outboxId]
    );
    await transaction.execute(
      `INSERT INTO delivery_attempts
         (outbox_message_id, attempt_no, result_code, error_code, attempted_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [outboxId, attempt, result.ok ? "sent" : "failed", result.ok ? null : result.errorCode]
    );
  });
}
