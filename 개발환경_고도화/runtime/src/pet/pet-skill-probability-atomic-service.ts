import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { MariaCanonicalPetSkillReadProvider } from "./canonical-pet-skill-read-provider.js";
import { formatLegacyPetSkillProbability } from "./pet-skill-probability-service.js";

const COMMAND_CODE = "PET_SKILL_PROBABILITY";
const OPERATION_SCOPE = "pet_skill_probability.read";

interface StoredResult {
  requestFingerprint: string;
  data: string | null;
  outboxId: string | null;
}

export interface AtomicPetSkillProbabilityResult {
  data: string | null;
  outboxId: string | null;
  replayed: boolean;
}

export function petSkillProbabilityRequestFingerprint(input: {
  environment: "dev" | "prod";
  databaseIdentity: string;
  event: NormalizedIrisEvent;
  destinationId: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    version: "PET_SKILL_PROBABILITY_REQUEST_V1",
    environment: input.environment,
    databaseIdentity: input.databaseIdentity,
    eventId: input.event.eventId,
    providerCode: input.event.providerCode,
    providerEventId: input.event.providerEventId,
    payloadHash: input.event.payloadHash,
    message: input.event.message ?? null,
    actor: input.event.userId ?? null,
    channel: input.event.channelId ?? null,
    destination: input.destinationId
  }), "utf8").digest("hex");
}

function parseStoredResult(value: string | StoredResult | null): StoredResult {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null
    || typeof (parsed as StoredResult).requestFingerprint !== "string"
    || ((parsed as StoredResult).data !== null && typeof (parsed as StoredResult).data !== "string")
    || ((parsed as StoredResult).outboxId !== null && typeof (parsed as StoredResult).outboxId !== "string")
    || (((parsed as StoredResult).data === null) !== ((parsed as StoredResult).outboxId === null))) {
    throw new Error("PET_SKILL_PROBABILITY_REPLAY_RESULT_INVALID");
  }
  return parsed as StoredResult;
}

function assertFingerprint(stored: StoredResult, expected: string): void {
  if (stored.requestFingerprint !== expected) {
    throw new ApplicationError("PET_SKILL_PROBABILITY_REQUEST_DRIFT", "같은 이벤트의 요청 내용이 다릅니다.", 409);
  }
}

// inbox 행을 잠근 동일 transaction에서 actor·catalog snapshot과 audit/outbox를 확정합니다.
export class PetSkillProbabilityAtomicService {
  public constructor(private readonly database: DatabaseClient) {}

  public async verifyCompletedReplayInTransaction(transaction: DatabaseTransaction, input: {
    event: NormalizedIrisEvent;
    environment: "dev" | "prod";
    databaseIdentity: string;
    destinationId: string;
  }): Promise<boolean> {
    const fingerprint = petSkillProbabilityRequestFingerprint(input);
    const rows = await transaction.query<Array<{ result_json: string | StoredResult | null }>>(
        `SELECT operation.result_json
           FROM command_executions execution
           JOIN operations operation ON operation.id=execution.operation_id
          WHERE execution.event_id=? AND execution.command_code=?
          LIMIT 2 FOR UPDATE`,
        [input.event.eventId, COMMAND_CODE]
      );
    if (rows.length > 1) throw new Error("PET_SKILL_PROBABILITY_REPLAY_DUPLICATE");
    if (rows.length === 0) return false;
    const stored = parseStoredResult(rows[0]!.result_json);
    assertFingerprint(stored, fingerprint);
    return true;
  }

  public async executeInTransaction(transaction: DatabaseTransaction, input: {
    event: NormalizedIrisEvent;
    environment: "dev" | "prod";
    databaseIdentity: string;
    destinationId: string;
    duplicateClaim: boolean;
  }): Promise<AtomicPetSkillProbabilityResult> {
    const inbox = await transaction.query<Array<{ provider_code:string;provider_event_id:string|null;external_channel_id:string|null;external_user_id:string|null;payload_hash:string }>>(
      "SELECT provider_code,provider_event_id,external_channel_id,external_user_id,payload_hash FROM event_inbox WHERE event_id=? FOR UPDATE", [input.event.eventId]
    );
    if (inbox.length !== 1) throw new Error("PET_SKILL_PROBABILITY_INBOX_REQUIRED");
    const claimed = inbox[0]!;
    if (claimed.provider_code !== input.event.providerCode || claimed.provider_event_id !== input.event.providerEventId
      || claimed.external_channel_id !== input.event.channelId || claimed.external_user_id !== input.event.userId
      || claimed.payload_hash !== input.event.payloadHash) {
      throw new ApplicationError("PET_SKILL_PROBABILITY_INBOX_DRIFT", "같은 이벤트의 요청 내용이 다릅니다.", 409);
    }
    const fingerprint = petSkillProbabilityRequestFingerprint(input);
    const prior = await transaction.query<Array<{ result_json: string | StoredResult | null }>>(
      `SELECT operation.result_json
         FROM command_executions execution
         JOIN operations operation ON operation.id=execution.operation_id
        WHERE execution.event_id=? AND execution.command_code=?
        LIMIT 2 FOR UPDATE`,
      [input.event.eventId, COMMAND_CODE]
    );
    if (prior.length > 1) throw new Error("PET_SKILL_PROBABILITY_REPLAY_DUPLICATE");
    if (prior.length === 1) {
      const stored = parseStoredResult(prior[0]!.result_json);
      assertFingerprint(stored, fingerprint);
      return { data: stored.data, outboxId: stored.outboxId, replayed: true };
    }
    if (input.duplicateClaim) throw new Error("PET_SKILL_PROBABILITY_DUPLICATE_RECEIPT_MISSING");
    const nicknameAllowed = input.event.displayName !== undefined
      && (input.event.displayName.length <= 4 || input.event.displayName === "오픈채팅봇");
    const actors = input.event.userId === undefined || !nicknameAllowed ? [] : await transaction.query<Array<{ identity_id: bigint; player_id: bigint; player_status: string }>>(
      `SELECT identity.id identity_id,player.id player_id,player.status player_status
         FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.deleted_at IS NULL
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        ORDER BY identity.id LIMIT 2 FOR UPDATE`,
      [input.event.userId]
    );
    if (actors.length > 1) throw new Error("PET_SKILL_PROBABILITY_IDENTITY_DUPLICATE");
    const actor = actors[0];
    let resultCode = !nicknameAllowed ? "nickname_guard_silent" : actor === undefined ? "member_required_silent" : "success";
    let data: string | null = null;
    if (actor?.player_status === "suspended") {
      resultCode = "account_suspended";
      data = "계정정지 상태입니다 호월고객센터로 문의해주세요";
    } else if (actor?.player_status === "active") {
      const catalog = await new MariaCanonicalPetSkillReadProvider(this.database).readCatalogInSnapshot(transaction);
      data = formatLegacyPetSkillProbability(catalog.definitions);
    } else if (actor !== undefined) resultCode = "member_inactive_silent";
    const operation = await transaction.execute(
      `INSERT INTO operations
        (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
       VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))`,
      [randomUUID(), OPERATION_SCOPE, input.event.eventId, actor?.identity_id ?? null]
    );
    const outbox = data === null ? null : await transaction.execute(
      `INSERT INTO outbox_messages
        (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
       VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [operation.insertId, input.destinationId, JSON.stringify({ data })]
    );
    await transaction.execute(
      `INSERT INTO command_executions
        (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
       VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [input.event.eventId, COMMAND_CODE, operation.insertId, resultCode]
    );
    await transaction.execute(
      `INSERT INTO command_audit
        (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
       VALUES (?,'external_identity',?,'player',?,'pet_skill.probability.read',?,'Iris /펫스킬확률',?,UTC_TIMESTAMP(3))`,
      [operation.insertId, actor?.identity_id ?? null, actor?.player_id ?? null, resultCode, JSON.stringify({ mutation: false, replied: data !== null })]
    );
    const stored: StoredResult = { requestFingerprint: fingerprint, data, outboxId: outbox?.insertId.toString() ?? null };
    await transaction.execute(
      "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
      [JSON.stringify(stored), operation.insertId]
    );
    return { ...stored, replayed: false };
  }
}
