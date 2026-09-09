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
  incidentId?: string;
}

export interface ChannelNameObservation {
  displayName: string;
  sourceCode: "kakao_open_link" | "kakao_chat_room_meta";
}

// MariaDB 중복 키 오류인지 드라이버 코드로 확인합니다.
function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

// Iris 이벤트의 inbox, 명령 실행과 outbox를 한 트랜잭션으로 처리합니다.
export class ProcessIrisEventService {
  constructor(private readonly database: DatabaseClient) {}

  // 전용 원자 read 명령은 inbox를 먼저 선점하고 같은 root transaction에서 관찰 이력을 완성합니다.
  async executeAtomicCommandInTransaction(
    transaction: DatabaseTransaction,
    event: NormalizedIrisEvent,
    replyIdentity: NormalizedIrisEvent,
    channelType: "open_group" | "open_direct",
    options: { channelName?: ChannelNameObservation; retryFailedErrorCode?: string; retryAttemptNumber?: number } = {}
  ): Promise<EventProcessingResult> {
    const claimToken = randomUUID();
    await transaction.execute(
      `INSERT INTO event_inbox (
         event_id,provider_code,provider_event_id,external_channel_id,channel_id,
         external_user_id,external_identity_id,event_kind,event_origin,direction,payload_hash,
         parse_status,processing_status,received_at,attempt_count,error_code
       ) VALUES (?,?,?,?,NULL,?,NULL,?,?,?,?, 'parsed','processing',UTC_TIMESTAMP(3),1,?)
       ON DUPLICATE KEY UPDATE event_id=VALUES(event_id)`,
      [event.eventId,event.providerCode,event.providerEventId,event.channelId ?? null,replyIdentity.userId ?? null,
        event.eventKind,event.origin ?? null,event.direction,event.payloadHash,claimToken]
    );
    const claimed = await transaction.query<Array<{ error_code:string|null;processing_status:string }>>(
      "SELECT error_code,processing_status FROM event_inbox WHERE event_id=? FOR UPDATE", [event.eventId]
    );
    if (claimed.length !== 1) throw new Error("ATOMIC_EVENT_INBOX_CLAIM_RESULT_INVALID");
    if (claimed[0]!.error_code !== claimToken) {
      if(options.retryFailedErrorCode===undefined||claimed[0]!.processing_status!=="failed"||claimed[0]!.error_code!==options.retryFailedErrorCode)return { duplicate: true, replies: [] };
      const retryAttemptNumber=options.retryAttemptNumber??1;
      if(!Number.isInteger(retryAttemptNumber)||retryAttemptNumber<1||retryAttemptNumber>8)throw new Error("ATOMIC_EVENT_INBOX_RETRY_ATTEMPT_INVALID");
      const retryClaim=await transaction.execute("UPDATE event_inbox SET processing_status='processing',error_code=?,attempt_count=attempt_count+?,processed_at=NULL WHERE event_id=? AND processing_status='failed' AND error_code=?",[claimToken,retryAttemptNumber,event.eventId,options.retryFailedErrorCode]);
      if(retryClaim.affectedRows!==1n)throw new Error("ATOMIC_EVENT_INBOX_FAILED_RECLAIM_CONFLICT");
      await transaction.execute("UPDATE event_inbox SET processing_status='processed',processed_at=UTC_TIMESTAMP(3),error_code=NULL WHERE event_id=? AND processing_status='processing' AND error_code=?",[event.eventId,claimToken]);
      return{duplicate:false,replies:[]};
    }
    const identity = await observeEventIdentity(transaction, replyIdentity, channelType);
    await transaction.execute(
      "UPDATE event_inbox SET channel_id=?,external_identity_id=? WHERE event_id=?",
      [identity.channelId,identity.externalIdentityId,event.eventId]
    );
    await recordChannelNameObservation(transaction,event,identity.channelId,options.channelName);
    await recordNormalizedEvent(transaction,event);
    await recordMembershipEvent(transaction,event,identity);
    const incidentId = await recordModerationIncident(transaction,event,identity);
    await recordChannelActivity(transaction,event,identity);
    await transaction.execute(
      "UPDATE event_inbox SET processing_status='processed',processed_at=UTC_TIMESTAMP(3),error_code=NULL WHERE event_id=?",
      [event.eventId]
    );
    return { duplicate: false, replies: [], incidentId: incidentId?.toString() };
  }

  // 진단방의 삭제·가리기 사건은 원문·identity·활동 없이 최소 상관 메타데이터만 기록합니다.
  async executeDiagnosticModeration(event: NormalizedIrisEvent): Promise<EventProcessingResult> {
    if (event.eventCode !== "message.deleted" && event.eventCode !== "message.hidden_by_host") {
      return { duplicate: false, replies: [] };
    }
    try {
      return await this.database.withTransaction(async (transaction) => {
        await transaction.execute(
          `INSERT INTO event_inbox (
             event_id, provider_code, provider_event_id, external_channel_id, channel_id,
             external_user_id, external_identity_id,
             event_kind, event_origin, direction, payload_hash, parse_status,
             processing_status, received_at, attempt_count
           ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, 'parsed', 'processing', UTC_TIMESTAMP(3), 1)`,
          [event.eventId, event.providerCode, event.providerEventId, event.channelId ?? null,
            event.userId ?? null, event.eventKind, event.origin ?? null, event.direction, event.payloadHash]
        );
        await recordNormalizedEvent(transaction, event);
        const incidentId = await recordModerationIncident(transaction, event, {
          channelId: null,
          externalIdentityId: null
        });
        await transaction.execute(
          "UPDATE event_inbox SET processing_status = 'processed', processed_at = UTC_TIMESTAMP(3) WHERE event_id = ?",
          [event.eventId]
        );
        return { duplicate: false, replies: [], incidentId: incidentId?.toString() };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { duplicate: true, replies: [] };
      throw error;
    }
  }

  async execute(
    event: NormalizedIrisEvent,
    replyIdentity?: NormalizedIrisEvent,
    channelType: "open_group" | "open_direct" = "open_group",
    options: { allowCommands?: boolean; channelName?: ChannelNameObservation } = {}
  ): Promise<EventProcessingResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
        const identityEvent = replyIdentity ?? event;
        const identity = await observeEventIdentity(transaction, identityEvent, channelType);
        await recordChannelNameObservation(transaction, event, identity.channelId, options.channelName);
        await transaction.execute(
          `INSERT INTO event_inbox (
             event_id, provider_code, provider_event_id, external_channel_id, channel_id,
             external_user_id, external_identity_id,
             event_kind, event_origin, direction, payload_hash, parse_status,
             processing_status, received_at, attempt_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsed', 'processing', UTC_TIMESTAMP(3), 1)`,
          [event.eventId, event.providerCode, event.providerEventId, event.channelId ?? null, identity.channelId,
            identityEvent.userId ?? null, identity.externalIdentityId, event.eventKind, event.origin ?? null,
             event.direction, event.payloadHash]
        );
        await recordNormalizedEvent(transaction, event);
        await recordMembershipEvent(transaction, event, identity);
        const incidentId = await recordModerationIncident(transaction, event, identity);
        await recordChannelActivity(transaction, event, identity);

        const replies: PendingReply[] = [];
        if (options.allowCommands !== false && event.message === "/ping" && event.channelId !== undefined) {
          replies.push(await this.createPingReply(transaction, event, replyIdentity));
        }

        await transaction.execute(
          "UPDATE event_inbox SET processing_status = 'processed', processed_at = UTC_TIMESTAMP(3) WHERE event_id = ?",
          [event.eventId]
        );
        return { duplicate: false, replies, incidentId: incidentId?.toString() };
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        return { duplicate: true, replies: [] };
      }
      throw error;
    }
  }

  async queueCommandReply(
    event: NormalizedIrisEvent,
    commandCode: string,
    data: string,
    destinationId?: string
  ): Promise<PendingReply> {
    if (destinationId === undefined && event.channelId === undefined) {
      throw new Error("Cannot queue an Iris reply without a channel id.");
    }
    const channelId = destinationId ?? event.channelId!;
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
    event: NormalizedIrisEvent,
    replyIdentity?: NormalizedIrisEvent
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
    const verifiedNames = event.userId === undefined ? [] : await transaction.query<Array<{ display_name: string }>>(
      `SELECT display_name FROM external_identities
       WHERE provider_code = 'kakao' AND external_user_id = ? AND status = 'linked'
         AND display_name IS NOT NULL LIMIT 1`,
      [event.userId]
    );
    const replyName = verifiedNames[0]?.display_name
      ?? (replyIdentity?.displayNameTrust === "trusted" ? replyIdentity.displayName : undefined)
      ?? "미확인 사용자";
    const data = `${replyName} pong`;
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages
         (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation.insertId, event.channelId, JSON.stringify({ data })]
    );
    return { outboxId: outbox.insertId.toString(), room: event.channelId!, data };
  }
}

// 검증된 KakaoTalk DB 방 이름은 변경 시점만 append-only 이력으로 기록합니다.
async function recordChannelNameObservation(
  transaction: DatabaseTransaction,
  event: NormalizedIrisEvent,
  channelId: bigint | null,
  observation?: ChannelNameObservation
): Promise<void> {
  if (channelId === null || observation === undefined || observation.displayName.trim() === "") return;
  const previous = await transaction.query<Array<{ display_name: string }>>(
    `SELECT display_name FROM channel_name_observations
     WHERE channel_id = ? AND source_code = ? ORDER BY observed_at DESC, id DESC LIMIT 1`,
    [channelId, observation.sourceCode]
  );
  if (previous[0]?.display_name === observation.displayName) return;
  await transaction.execute(
    `INSERT INTO channel_name_observations
      (channel_id, display_name, source_code, provider_event_id, observed_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [channelId, observation.displayName, observation.sourceCode, event.providerEventId]
  );
}

// 개인정보 원문 없이 검증된 분류와 최소 상관 메타데이터만 기록합니다.
async function recordNormalizedEvent(transaction: DatabaseTransaction, event: NormalizedIrisEvent): Promise<void> {
  await transaction.execute(
    `INSERT INTO normalized_provider_events
      (event_id, event_code, event_category, monitoring_group, target_provider_event_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [event.eventId, event.eventCode, event.eventCategory, event.monitoringGroup, event.targetProviderEventId ?? null,
      Object.keys(event.eventMetadata).length === 0 ? null : JSON.stringify(event.eventMetadata)]
  );
}

// 입장·퇴장 이벤트를 방별 membership 상태와 append-only 이력에 반영합니다.
async function recordMembershipEvent(
  transaction: DatabaseTransaction,
  event: NormalizedIrisEvent,
  identity: { channelId: bigint | null; externalIdentityId: bigint | null }
): Promise<void> {
  if (identity.channelId === null || identity.externalIdentityId === null
    || (event.eventCode !== "member.joined" && event.eventCode !== "member.departed")) return;
  const membershipEventCode = event.eventCode === "member.joined" ? "joined" : "departed";
  await transaction.execute(
    `INSERT INTO channel_membership_events
      (event_id, channel_id, external_identity_id, membership_event_code, occurred_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [event.eventId, identity.channelId, identity.externalIdentityId, membershipEventCode]
  );
  if (membershipEventCode === "joined") {
    await transaction.execute(
      `UPDATE channel_memberships
       SET status = 'active', joined_at = UTC_TIMESTAMP(3), left_at = NULL, updated_at = UTC_TIMESTAMP(3)
       WHERE channel_id = ? AND external_identity_id = ?`,
      [identity.channelId, identity.externalIdentityId]
    );
  } else {
    await transaction.execute(
      `UPDATE channel_memberships
       SET status = 'inactive', left_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
       WHERE channel_id = ? AND external_identity_id = ?`,
      [identity.channelId, identity.externalIdentityId]
    );
  }
}

// 수정·삭제 감지를 원문 내용 없이 운영 사건으로 기록합니다.
async function recordModerationIncident(
  transaction: DatabaseTransaction,
  event: NormalizedIrisEvent,
  identity: { channelId: bigint | null; externalIdentityId: bigint | null }
): Promise<bigint | null> {
  if (event.eventCode !== "message.edited" && event.eventCode !== "message.deleted"
    && event.eventCode !== "message.hidden_by_host") return null;
  const incidentType = event.eventCode === "message.edited"
    ? "message_edited"
    : event.eventCode === "message.deleted" ? "message_deleted" : "message_hidden_by_host";
  const result = await transaction.execute(
    `INSERT INTO moderation_incidents
      (event_id, channel_id, external_identity_id, incident_type, target_provider_event_id, status, occurred_at)
     VALUES (?, ?, ?, ?, ?, 'detected', UTC_TIMESTAMP(3))`,
    [event.eventId, identity.channelId, identity.externalIdentityId,
      incidentType, event.targetProviderEventId ?? null]
  );
  return result.insertId;
}

// 메시지 본문을 보관하지 않고 방·사용자·일자별 활동 건수만 누적합니다.
async function recordChannelActivity(
  transaction: DatabaseTransaction,
  event: NormalizedIrisEvent,
  identity: { channelId: bigint | null; externalIdentityId: bigint | null }
): Promise<void> {
  if (event.direction !== "incoming" || identity.channelId === null || identity.externalIdentityId === null) return;
  const isMessage = event.eventCategory === "message";
  const isMedia = event.eventCategory === "media" || event.eventCategory === "content";
  if (!isMessage && !isMedia) return;
  const isReply = event.eventCode === "message.created.reply"
    || event.eventCode === "message.created.thread_reply";
  const isMention = event.eventCode === "message.created.mention";
  await transaction.execute(
    `INSERT INTO channel_activity_daily
      (channel_id, external_identity_id, activity_date, message_count, media_count,
       reply_count, mention_count, event_count, last_event_at)
     VALUES (?, ?, UTC_DATE(), ?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       message_count = message_count + VALUES(message_count),
       media_count = media_count + VALUES(media_count),
       reply_count = reply_count + VALUES(reply_count),
       mention_count = mention_count + VALUES(mention_count),
       event_count = event_count + 1,
       last_event_at = VALUES(last_event_at)`,
    [identity.channelId, identity.externalIdentityId, isMessage ? 1 : 0, isMedia ? 1 : 0,
      isReply ? 1 : 0, isMention ? 1 : 0]
  );
}

// 관측된 channel/identity를 후보로 기록하고 Iris sender는 미신뢰 이력으로만 분리합니다.
async function observeEventIdentity(
  transaction: DatabaseTransaction,
  event: NormalizedIrisEvent,
  channelType: "open_group" | "open_direct"
): Promise<{ channelId: bigint | null; externalIdentityId: bigint | null }> {
  let channelId: bigint | null = null;
  let externalIdentityId: bigint | null = null;
  if (event.channelId !== undefined) {
    const channelProviderCode = event.providerCode === "iris" ? "kakao" : event.providerCode;
    await transaction.execute(
      `INSERT INTO channels (provider_code, external_channel_id, channel_type, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE channel_type = VALUES(channel_type), status = 'active', updated_at = VALUES(updated_at)`,
      [channelProviderCode, event.channelId, channelType]
    );
    const channels = await transaction.query<Array<{ id: bigint }>>(
      "SELECT id FROM channels WHERE provider_code = ? AND external_channel_id = ?",
      [channelProviderCode, event.channelId]
    );
    channelId = channels[0]?.id ?? null;
  }
  if (event.userId !== undefined) {
    await transaction.execute(
      `INSERT INTO external_identities
        (provider_code, external_user_id, display_name, status, created_at, updated_at)
       VALUES ('kakao', ?, NULL, 'candidate', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
          updated_at = VALUES(updated_at)`,
      [event.userId]
    );
    const observed = await transaction.query<Array<{ id: bigint }>>(
      "SELECT id FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ?",
      [event.userId]
    );
    externalIdentityId = observed[0]?.id ?? null;
    if (externalIdentityId !== null && event.displayName !== undefined) {
      const nameSourceCode = event.displayNameSource === "kakao_db" && event.displayNameTrust === "trusted"
        ? "kakao_membership_feed"
        : "iris_cache";
      const nameTrustStatus = nameSourceCode === "kakao_membership_feed" ? "verified" : "untrusted";
      const previousNames = await transaction.query<Array<{ display_name: string }>>(
        `SELECT display_name FROM external_identity_names
         WHERE external_identity_id = ? AND source_code = ?
         ORDER BY observed_at DESC, id DESC LIMIT 1`,
        [externalIdentityId, nameSourceCode]
      );
      if (previousNames[0]?.display_name !== event.displayName) {
        await transaction.execute(
          `INSERT INTO external_identity_names
            (external_identity_id, display_name, source_code, trust_status, channel_id, provider_event_id, observed_at)
           VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [externalIdentityId, event.displayName, nameSourceCode, nameTrustStatus,
            channelId, event.providerEventId]
        );
      }
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
