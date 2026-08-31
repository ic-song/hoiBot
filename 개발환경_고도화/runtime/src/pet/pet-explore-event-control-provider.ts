import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type PetExploreEventCode = "diamond_mine" | "guild_raid";
export type PetExploreEventControlSource = "admin_api" | "iris" | "system";

export interface PetExploreEventControlInput {
  eventCode: PetExploreEventCode;
  active: boolean;
  expectedVersion: string;
  idempotencyKey: string;
  operatorId: string;
  reason: string;
  sourceCode: PetExploreEventControlSource;
}

export interface PetExploreEventControlResult {
  status: "changed" | "unchanged";
  eventCode: PetExploreEventCode;
  previousActive: boolean;
  active: boolean;
  previousVersion: string;
  version: string;
  relocatedParticipantCount: string;
  operationId: string;
  auditId: string;
  outboxId: string;
  replayed: boolean;
}

interface StoredEnvelope {
  fingerprint: string;
  result: PetExploreEventControlResult;
}

interface RuntimeConfigRow {
  event_mine_active: number;
  guild_raid_active: number;
  version: bigint;
}

const EVENT_POLICY = {
  diamond_mine: {
    flagColumn: "event_mine_active",
    participantDestination: "diamond_mine_event",
  },
  guild_raid: {
    flagColumn: "guild_raid_active",
    participantDestination: "guild_raid_event",
  },
} as const;

// idempotency payload mismatch를 판별할 canonical fingerprint를 생성합니다.
export function createPetExploreEventControlFingerprint(input: PetExploreEventControlInput): string {
  return createHash("sha256").update(JSON.stringify({
    eventCode: input.eventCode,
    active: input.active,
    expectedVersion: input.expectedVersion,
    operatorId: input.operatorId,
    reason: input.reason.trim(),
    sourceCode: input.sourceCode,
  })).digest("hex");
}

// 긴 외부 operation key를 operations 제한 안의 안정적인 키로 축약합니다.
function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new ApplicationError("PET_EXPLORE_EVENT_IDEMPOTENCY_KEY_INVALID", "Idempotency key가 필요합니다.", 422);
  }
  return normalized.length <= 191
    ? normalized
    : `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

// bigint CAS version을 정밀도 손실 없는 decimal string으로 검증합니다.
function normalizeVersion(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApplicationError("PET_EXPLORE_EVENT_VERSION_INVALID", "expectedVersion은 1 이상의 정수 문자열이어야 합니다.", 422);
  }
  return value;
}

// 감사 사유를 기존 command_audit 길이와 제어문자 계약에 맞춥니다.
function normalizeReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 5 || normalized.length > 500 || /[\u0000-\u001f]/.test(normalized)) {
    throw new ApplicationError("PET_EXPLORE_EVENT_REASON_INVALID", "변경 사유는 제어문자 없이 5~500자로 입력해주세요.", 422);
  }
  return normalized;
}

// Maria JSON 반환형을 stable operation envelope로 복원합니다.
function parseEnvelope(value: string | StoredEnvelope): StoredEnvelope {
  return typeof value === "string" ? JSON.parse(value) as StoredEnvelope : value;
}

// migration160 singleton을 CAS로 전환하고 현재 이벤트 참가자만 일반 광산군으로 이동합니다.
export class PetExploreEventControlProvider {
  constructor(private readonly database: DatabaseClient) {}

  async setActive(input: PetExploreEventControlInput): Promise<PetExploreEventControlResult> {
    const policy = EVENT_POLICY[input.eventCode];
    if (policy === undefined) {
      throw new ApplicationError("PET_EXPLORE_EVENT_CODE_INVALID", "지원하지 않는 펫 탐험 이벤트입니다.", 422);
    }
    const expectedVersion = normalizeVersion(input.expectedVersion);
    const reason = normalizeReason(input.reason);
    const key = normalizeIdempotencyKey(input.idempotencyKey);
    const normalizedInput = { ...input, expectedVersion, reason };
    const fingerprint = createPetExploreEventControlFingerprint(normalizedInput);
    const scope = `admin.pet_explore_event_control:${input.operatorId}`;

    return this.database.withTransaction(async (transaction) => {
      const operationWrite = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, ?, 'processing', UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [randomUUID(), scope, key, input.operatorId, input.sourceCode],
      );
      const claimed = (await transaction.query<Array<{ result_json: string | StoredEnvelope | null }>>(
        "SELECT result_json FROM operations WHERE id=? FOR UPDATE",
        [operationWrite.insertId],
      ))[0];
      if (claimed === undefined) throw new Error("Pet explore event control operation claim failed.");
      if (claimed.result_json !== null) {
        const stored = parseEnvelope(claimed.result_json);
        if (stored.fingerprint !== fingerprint) {
          throw new ApplicationError(
            "PET_EXPLORE_EVENT_IDEMPOTENCY_PAYLOAD_MISMATCH",
            "같은 Idempotency key에 다른 이벤트 제어 요청을 사용할 수 없습니다.",
            409,
          );
        }
        return { ...stored.result, replayed: true };
      }

      const current = (await transaction.query<RuntimeConfigRow[]>(
        "SELECT event_mine_active,guild_raid_active,version FROM pet_explore_runtime_config WHERE config_id=1 FOR UPDATE",
      ))[0];
      if (current === undefined) throw new Error("Pet explore runtime config is missing.");
      if (current.version.toString() !== expectedVersion) {
        throw new ApplicationError(
          "PET_EXPLORE_EVENT_VERSION_CONFLICT",
          "펫 탐험 이벤트 상태가 먼저 변경되었습니다.",
          409,
          { expectedVersion, actualVersion: current.version.toString() },
        );
      }

      const previousActive = current[policy.flagColumn] === 1;
      const changed = previousActive !== input.active;
      const resultingVersion = changed ? current.version + 1n : current.version;
      let relocatedParticipantCount = 0n;

      if (changed) {
        const stateUpdate = await transaction.execute(
          `UPDATE pet_explore_runtime_config
           SET ${policy.flagColumn}=?,version=version+1,updated_operation_id=?
           WHERE config_id=1 AND version=?`,
          [input.active, operationWrite.insertId, expectedVersion],
        );
        if (stateUpdate.affectedRows !== 1n) {
          throw new ApplicationError("PET_EXPLORE_EVENT_VERSION_CONFLICT", "펫 탐험 이벤트 상태가 먼저 변경되었습니다.", 409);
        }
        if (!input.active) {
          const relocationEvidence = await transaction.execute(
            `INSERT INTO pet_explore_event_control_relocations
              (operation_id,participation_id,previous_destination_code,resulting_destination_code,previous_version,resulting_version)
             SELECT ?,participation.id,participation.destination_code,'regular_mine',participation.version,participation.version+1
             FROM pet_explore_participations participation
             JOIN pet_explore_rounds round_state ON round_state.id=participation.round_id AND round_state.state_code='open'
             WHERE participation.destination_code=? AND participation.state_code='active'`,
            [operationWrite.insertId, policy.participantDestination],
          );
          const relocation = await transaction.execute(
            `UPDATE pet_explore_participations participation
             JOIN pet_explore_rounds round_state ON round_state.id=participation.round_id AND round_state.state_code='open'
             SET participation.destination_code='regular_mine',participation.version=participation.version+1,participation.updated_operation_id=?
             WHERE participation.destination_code=? AND participation.state_code='active'`,
            [operationWrite.insertId, policy.participantDestination],
          );
          if (relocation.affectedRows !== relocationEvidence.affectedRows) {
            throw new Error("Pet explore event participant relocation evidence mismatch.");
          }
          relocatedParticipantCount = relocation.affectedRows;
        }
      }

      await transaction.execute(
        `INSERT INTO pet_explore_event_control_changes
          (operation_id,event_code,previous_active,requested_active,previous_version,resulting_version,relocated_participant_count)
         VALUES (?,?,?,?,?,?,?)`,
        [
          operationWrite.insertId,
          input.eventCode,
          previousActive,
          input.active,
          current.version,
          resultingVersion,
          relocatedParticipantCount,
        ],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'pet_explore_runtime_config',NULL,'pet_explore.event_control',?,?,?,UTC_TIMESTAMP(3))`,
        [
          operationWrite.insertId,
          input.operatorId,
          changed ? "changed" : "unchanged",
          reason,
          JSON.stringify({
            eventCode: input.eventCode,
            previousActive,
            active: input.active,
            previousVersion: current.version.toString(),
            version: resultingVersion.toString(),
            relocatedParticipantCount: relocatedParticipantCount.toString(),
          }),
        ],
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'internal',?,'pet_explore.event_control',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [
          operationWrite.insertId,
          input.eventCode,
          JSON.stringify({
            eventCode: input.eventCode,
            active: input.active,
            version: resultingVersion.toString(),
            relocatedParticipantCount: relocatedParticipantCount.toString(),
          }),
        ],
      );
      const result: PetExploreEventControlResult = {
        status: changed ? "changed" : "unchanged",
        eventCode: input.eventCode,
        previousActive,
        active: input.active,
        previousVersion: current.version.toString(),
        version: resultingVersion.toString(),
        relocatedParticipantCount: relocatedParticipantCount.toString(),
        operationId: operationWrite.insertId.toString(),
        auditId: audit.insertId.toString(),
        outboxId: outbox.insertId.toString(),
        replayed: false,
      };
      const envelope: StoredEnvelope = { fingerprint, result };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(envelope), operationWrite.insertId],
      );
      return result;
    });
  }
}
