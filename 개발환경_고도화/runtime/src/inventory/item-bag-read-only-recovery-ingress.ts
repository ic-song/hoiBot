import { createHash } from "node:crypto";
import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import type { MariaAppWiringReadOnlyRecoveryProvider } from "../dispatch/app-wiring-read-only-recovery-provider.js";
import { ProcessIrisEventService, type ChannelNameObservation, type EventProcessingResult } from "../integration/event-processing-service.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { assertVerifiedEnvironmentContext, type VerifiedEnvironmentContext } from "../runtime/environment-context.js";
import { ITEM_BAG_CANONICAL_CONSUMER_ID, type CanonicalItemBagDirectReadResult, CanonicalItemBagDirectReadService, isCanonicalItemBagCommand } from "./canonical-item-bag-direct-read-service.js";

export const ITEM_BAG_RECEIPT_VERSION = "ITEM_BAG_CANONICAL_DIRECT_READ_V1";
const LEGACY_REPLY_COMMAND = "bag_read";

const SILENT_REASONS = new Set([
  "CASTLE_SIEGE_ACTIVE", "CASTLE_AUTHORITY_UNPROVEN", "PLAYER_CONTEXT_UNPROVEN",
  "ACTIVE_PLAYER_PARITY_UNAVAILABLE", "PRESENTATION_PARITY_UNPROVEN",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validCanonicalDecision(value: unknown): value is CanonicalItemBagDirectReadResult {
  if (!record(value) || value.consumerId !== ITEM_BAG_CANONICAL_CONSUMER_ID) return false;
  if (value.status === "direct_reply") {
    return exactKeys(value, ["status", "consumerId", "playerId", "parityFingerprint", "data"])
      && typeof value.playerId === "string" && /^[a-z][a-z0-9]{7}$/.test(value.playerId)
      && typeof value.parityFingerprint === "string" && /^[0-9a-f]{64}$/.test(value.parityFingerprint)
      && typeof value.data === "string";
  }
  if (value.status === "legacy_reply") {
    return exactKeys(value, ["status", "consumerId", "reason", "playerId", "parityFingerprint", "data"])
      && value.reason === "CANONICAL_IMPORT_INCOMPLETE" && typeof value.playerId === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value.playerId)
      && typeof value.parityFingerprint === "string" && /^[0-9a-f]{64}$/.test(value.parityFingerprint)
      && typeof value.data === "string";
  }
  return value.status === "silent" && exactKeys(value, ["status", "consumerId", "reason"])
    && SILENT_REASONS.has(String(value.reason));
}

interface LegacyReplyProjection {
  commandCode: typeof LEGACY_REPLY_COMMAND;
  destinationId: string;
  data: string;
  payloadSha256: string;
}

function validLegacyReplyProjection(value: unknown, channelId: string): value is LegacyReplyProjection {
  return record(value) && exactKeys(value, ["commandCode", "destinationId", "data", "payloadSha256"])
    && value.commandCode === LEGACY_REPLY_COMMAND && value.destinationId === channelId
    && typeof value.data === "string" && typeof value.payloadSha256 === "string"
    && value.payloadSha256 === createHash("sha256").update(value.data, "utf8").digest("hex");
}

function validateItemBagReceiptProjection(projection: unknown, input: {
  event: NormalizedIrisEvent;
  replyIdentity: NormalizedIrisEvent;
  environmentContext: VerifiedEnvironmentContext;
}): void {
  if (!record(projection) || !exactKeys(projection, ["version", "consumerId", "eventId", "message", "externalUserId", "externalChannelId", "environmentCode", "databaseIdentity", "value"])
    || projection.version !== ITEM_BAG_RECEIPT_VERSION || projection.consumerId !== ITEM_BAG_CANONICAL_CONSUMER_ID
    || projection.eventId !== input.event.eventId || projection.message !== input.event.message
    || projection.externalUserId !== input.replyIdentity.userId || projection.externalChannelId !== input.replyIdentity.channelId
    || projection.environmentCode !== input.environmentContext.environmentCode || projection.databaseIdentity !== input.environmentContext.databaseIdentity
    || !record(projection.value)) throw new Error("ITEM_BAG_RECEIPT_DRIFT");
  const value = projection.value;
  if (value.status === "evaluation_error") {
    if (!exactKeys(value, ["status", "delivery", "reason"]) || value.delivery !== "silent" || value.reason !== "CANONICAL_EVALUATION_ERROR") throw new Error("ITEM_BAG_RECEIPT_DRIFT");
    return;
  }
  if (!record(value.canonicalDecision) || !validCanonicalDecision(value.canonicalDecision)
    || value.status !== value.canonicalDecision.status) throw new Error("ITEM_BAG_RECEIPT_DRIFT");
  if (value.status === "silent") {
    if (!exactKeys(value, ["status", "canonicalDecision"])) throw new Error("ITEM_BAG_RECEIPT_DRIFT");
    return;
  }
  if (!exactKeys(value, ["status", "canonicalDecision", "legacyReply"])
    || !validLegacyReplyProjection(value.legacyReply, input.replyIdentity.channelId!)
    || value.canonicalDecision.status === "silent"
    || value.legacyReply.data !== value.canonicalDecision.data) throw new Error("ITEM_BAG_RECEIPT_DRIFT");
}

function legacyReplyFromReceipt(projection: unknown, input: {
  event: NormalizedIrisEvent; replyIdentity: NormalizedIrisEvent; environmentContext: VerifiedEnvironmentContext;
}): LegacyReplyProjection | null {
  validateItemBagReceiptProjection(projection, input);
  const value = (projection as { value: Record<string, unknown> }).value;
  return value.status === "direct_reply" || value.status === "legacy_reply"
    ? value.legacyReply as LegacyReplyProjection
    : null;
}

async function assertOrQueueLegacyReply(transaction: DatabaseTransaction, input: {
  event: NormalizedIrisEvent; replyIdentity: NormalizedIrisEvent; environmentContext: VerifiedEnvironmentContext;
}, processing: EventProcessingResult, projection: unknown): Promise<void> {
  const expected = legacyReplyFromReceipt(projection, input);
  const rows = await transaction.query<Array<{
    command_code: string; execution_status: string; result_code: string; operation_status: string;
    provider_code: string; destination_id: string; message_type: string; payload_json: string | Record<string, unknown>;
  }>>(
    `SELECT execution.command_code,execution.execution_status,execution.result_code,operation.status AS operation_status,
            outbox.provider_code,outbox.destination_id,outbox.message_type,outbox.payload_json
       FROM command_executions execution
       JOIN operations operation ON operation.id=execution.operation_id
       JOIN outbox_messages outbox ON outbox.operation_id=operation.id
      WHERE execution.event_id=? AND execution.command_code=?
      ORDER BY outbox.id LIMIT 2 FOR UPDATE`,
    [input.event.eventId, LEGACY_REPLY_COMMAND],
  );
  if (expected === null) {
    if (rows.length !== 0) throw new Error("ITEM_BAG_LEGACY_OUTBOX_UNEXPECTED");
    return;
  }
  if (!processing.duplicate) {
    if (rows.length !== 0) throw new Error("ITEM_BAG_LEGACY_OUTBOX_PREEXISTING");
    await new ProcessIrisEventService(createScopedDatabaseClient(transaction)).queueCommandReply(
      input.event, expected.commandCode, expected.data, expected.destinationId,
    );
    return;
  }
  if (rows.length !== 1) throw new Error("ITEM_BAG_LEGACY_OUTBOX_CARDINALITY_DRIFT");
  const row = rows[0]!;
  let payload: unknown;
  try { payload = typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json; }
  catch { throw new Error("ITEM_BAG_LEGACY_OUTBOX_PAYLOAD_DRIFT"); }
  if (row.command_code !== expected.commandCode || row.execution_status !== "completed" || row.result_code !== "reply_queued"
    || row.operation_status !== "completed" || row.provider_code !== "iris" || row.destination_id !== expected.destinationId
    || row.message_type !== "text" || !record(payload) || !exactKeys(payload, ["data"]) || payload.data !== expected.data
    || createHash("sha256").update(expected.data, "utf8").digest("hex") !== expected.payloadSha256) {
    throw new Error("ITEM_BAG_LEGACY_OUTBOX_PAYLOAD_DRIFT");
  }
}

export async function executeItemBagReadOnlyRecovery(input: {
  database: DatabaseClient;
  recovery: Pick<MariaAppWiringReadOnlyRecoveryProvider, "execute">;
  canonical: Pick<CanonicalItemBagDirectReadService, "execute">;
  environmentContext: VerifiedEnvironmentContext;
  event: NormalizedIrisEvent;
  replyIdentity: NormalizedIrisEvent;
  channelType: "open_group" | "open_direct";
  reasonCode: "ROLLOUT_SHADOW";
  channelName?: ChannelNameObservation;
}): Promise<{ processing: EventProcessingResult; queuedReply?: { outboxId: string; room: string; data: string } }> {
  assertVerifiedEnvironmentContext(input.environmentContext);
  if (!isCanonicalItemBagCommand(input.event.message) || input.replyIdentity.userId === undefined || input.replyIdentity.channelId === undefined
    || input.reasonCode !== "ROLLOUT_SHADOW") throw new Error("ITEM_BAG_RECOVERY_BINDING_REQUIRED");
  const recovered = await input.recovery.execute({
    event: input.event, replyIdentity: input.replyIdentity, routingMessage: input.event.message,
    channelType: input.channelType, identityProviderCode: "kakao", devContext: "DEFAULT", actor: "app:item-bag-canonical-read",
    ...(input.channelName === undefined ? {} : { channelName: input.channelName }),
    commandBinding: { consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, message: input.event.message },
    decision: { route: "SHADOW", effectMode: "READ_ONLY", reasonCode: input.reasonCode, commandCode: "ITEM_BAG_READ", handlerKey: "item_bag_canonical_read" },
    evaluateInSnapshot: async (database) => {
      let value: Record<string, unknown>;
      try {
        const canonical = await input.canonical.execute(database, { providerCode: "kakao", externalUserId: input.replyIdentity.userId!, externalContextId: input.replyIdentity.channelId! });
        if (canonical.status === "silent") value = { status: canonical.status, canonicalDecision: canonical };
        else {
          // The canonical service already returns the parity-checked exact legacy presentation
          // for both direct and fallback decisions. Re-reading the generic SQL bag here would
          // drop signed/zero quantities, inactive source rows, and the checkRank owner label.
          const data = canonical.data;
          value = { status: canonical.status, canonicalDecision: canonical, legacyReply: {
            commandCode: LEGACY_REPLY_COMMAND, destinationId: input.replyIdentity.channelId, data,
            payloadSha256: createHash("sha256").update(data, "utf8").digest("hex"),
          } };
        }
      } catch {
        value = { status: "evaluation_error", delivery: "silent", reason: "CANONICAL_EVALUATION_ERROR" };
      }
      const receiptProjection = { version: ITEM_BAG_RECEIPT_VERSION, consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, eventId: input.event.eventId, message: input.event.message, externalUserId: input.replyIdentity.userId, externalChannelId: input.replyIdentity.channelId, environmentCode: input.environmentContext.environmentCode, databaseIdentity: input.environmentContext.databaseIdentity, value };
      return { value, receiptProjection };
    },
    validateReceiptProjection: (projection) => validateItemBagReceiptProjection(projection, input),
    afterEvaluateInTransaction: (transaction, processing, result) =>
      assertOrQueueLegacyReply(transaction, input, processing, result.receiptProjection),
    errorCode: (error) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message) ? error.message : "ITEM_BAG_READ_FAILED",
  });
  return { processing: recovered.processing, ...(recovered.reply === undefined ? {} : { queuedReply: recovered.reply }) };
}
