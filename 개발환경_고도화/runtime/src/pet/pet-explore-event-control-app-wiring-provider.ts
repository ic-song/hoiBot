import { createHash, randomUUID } from "node:crypto";

import type { AppWiringClaim, AppWiringMutationParticipant } from "../dispatch/app-wiring-operation-provider.js";
import {
  OBJECT_IDENTITY_MAX_ATTEMPTS,
  assertObjectIdentityCandidate,
  createObjectAuditValues,
  createObjectIdentityCandidate,
  type ObjectIdentityCandidateGenerator,
} from "../identity/object-identity-audit-provider.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  formatPetExploreEventControlReply,
  parsePetExploreEventControlCommand,
  type PetExploreEventControlCommand,
} from "./pet-explore-event-control-command-service.js";

interface RuntimeConfigRow { event_mine_active: number; guild_raid_active: number; version: bigint }
interface AuthorityRow { operator_id: bigint }

export interface PetExploreEventControlAppWiringResult {
  readonly status: "changed";
  readonly data: string;
  readonly operationId: string;
  readonly resultFingerprint: string;
  readonly replayed: false;
}

const POLICY = {
  diamond_mine: { flagColumn: "event_mine_active", participantDestination: "diamond_mine_event" },
  guild_raid: { flagColumn: "guild_raid_active", participantDestination: "guild_raid_event" },
} as const;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function primaryDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "ER_DUP_ENTRY" && /PRIMARY/i.test(message);
}

// EVENT_CONTROL만 app-wiring이 제공한 mutation participant 안에서 실행합니다.
export class PetExploreEventControlAppWiringProvider {
  constructor(
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maximumAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(database: AppWiringMutationParticipant, event: NormalizedIrisEvent, claim: AppWiringClaim): Promise<PetExploreEventControlAppWiringResult> {
    const command = parsePetExploreEventControlCommand(event.message);
    if (command === null || event.userId === undefined || event.channelId === undefined) {
      throw new ApplicationError("PET_EXPLORE_EVENT_CONTROL_INPUT_INVALID", "펫탐험 이벤트 제어 입력이 올바르지 않습니다.", 422);
    }
    const operator = (await database.query<AuthorityRow[]>(
      `SELECT operator.id operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='pet_explore.event.control' AND denied.effect='deny')
       AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='pet_explore.event.control' AND allowed.effect='allow')
         OR EXISTS (SELECT 1 FROM admin_operator_roles assignment JOIN admin_roles role ON role.id=assignment.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='pet_explore.event.control' WHERE assignment.operator_id=operator.id))
       ORDER BY operator.id LIMIT 1`,
      [event.userId],
    ))[0];
    if (operator === undefined) throw new ApplicationError("PET_EXPLORE_EVENT_CONTROL_FORBIDDEN", "펫탐험 이벤트 제어 권한이 없습니다.", 403);

    const current = (await database.query<RuntimeConfigRow[]>(
      "SELECT event_mine_active,guild_raid_active,version FROM pet_explore_runtime_config WHERE config_id=1 FOR UPDATE",
    ))[0];
    if (current === undefined) throw new Error("PET_EXPLORE_EVENT_CONTROL_CONFIG_MISSING");
    const policy = POLICY[command.eventCode];
    const previousActive = current[policy.flagColumn] === 1;
    const changed = previousActive !== command.active;
    const resultingVersion = changed ? current.version + 1n : current.version;
    const legacyOperation = await database.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,? ,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), `admin.pet_explore_event_control:${operator.operator_id.toString()}`, claim.requestKey, operator.operator_id],
    );
    let relocatedParticipantCount = 0n;
    if (changed) {
      const updated = await database.execute(
        `UPDATE pet_explore_runtime_config SET ${policy.flagColumn}=?,version=version+1,updated_operation_id=? WHERE config_id=1 AND version=?`,
        [command.active, legacyOperation.insertId, current.version],
      );
      if (updated.affectedRows !== 1n) throw new ApplicationError("PET_EXPLORE_EVENT_VERSION_CONFLICT", "펫 탐험 이벤트 상태가 먼저 변경되었습니다.", 409);
      if (!command.active) relocatedParticipantCount = await this.relocate(database, policy.participantDestination, legacyOperation.insertId);
    }
    await database.execute(
      "INSERT INTO pet_explore_event_control_changes(operation_id,event_code,previous_active,requested_active,previous_version,resulting_version,relocated_participant_count) VALUES (?,?,?,?,?,?,?)",
      [legacyOperation.insertId, command.eventCode, previousActive, command.active, current.version, resultingVersion, relocatedParticipantCount],
    );
    const data = formatPetExploreEventControlReply(command, { relocatedParticipantCount: relocatedParticipantCount.toString() });
    await database.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_explore_runtime_config',NULL,'pet_explore.event_control',?,'Iris pet explore event control',?,UTC_TIMESTAMP(3))",
      [legacyOperation.insertId, operator.operator_id, changed ? "changed" : "unchanged", JSON.stringify({ eventCode: command.eventCode, previousActive, active: command.active, previousVersion: current.version.toString(), version: resultingVersion.toString(), relocatedParticipantCount: relocatedParticipantCount.toString() })],
    );
    await database.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'internal',?,'pet_explore.event_control',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [legacyOperation.insertId, command.eventCode, JSON.stringify({ eventCode: command.eventCode, active: command.active, version: resultingVersion.toString(), relocatedParticipantCount: relocatedParticipantCount.toString() })],
    );
    await database.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [legacyOperation.insertId, event.channelId, JSON.stringify({ data })],
    );
    await database.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_EXPLORE_EVENT_CONTROL',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [claim.externalRequestId, legacyOperation.insertId, changed ? "changed" : "unchanged"],
    );
    const projection = { eventCode: command.eventCode, previousActive, active: command.active, previousVersion: current.version.toString(), version: resultingVersion.toString(), relocatedParticipantCount: relocatedParticipantCount.toString(), data };
    const resultFingerprint = fingerprint(projection);
    const operationId = await this.insertReceipt(database, claim, command, projection, resultFingerprint);
    await database.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(projection), legacyOperation.insertId]);
    return { status: "changed", data, operationId, resultFingerprint, replayed: false };
  }

  private async relocate(database: AppWiringMutationParticipant, destination: string, operationId: bigint): Promise<bigint> {
    const evidence = await database.execute(
      "INSERT INTO pet_explore_event_control_relocations(operation_id,participation_id,previous_destination_code,resulting_destination_code,previous_version,resulting_version) SELECT ?,participation.id,participation.destination_code,'regular_mine',participation.version,participation.version+1 FROM pet_explore_participations participation JOIN pet_explore_rounds round_state ON round_state.id=participation.round_id AND round_state.state_code='open' WHERE participation.destination_code=? AND participation.state_code='active'",
      [operationId, destination],
    );
    const relocation = await database.execute(
      "UPDATE pet_explore_participations participation JOIN pet_explore_rounds round_state ON round_state.id=participation.round_id AND round_state.state_code='open' SET participation.destination_code='regular_mine',participation.version=participation.version+1,participation.updated_operation_id=? WHERE participation.destination_code=? AND participation.state_code='active'",
      [operationId, destination],
    );
    if (evidence.affectedRows !== relocation.affectedRows) throw new Error("PET_EXPLORE_EVENT_CONTROL_RELOCATION_EVIDENCE_MISMATCH");
    return relocation.affectedRows;
  }

  private async insertReceipt(database: AppWiringMutationParticipant, claim: AppWiringClaim, command: PetExploreEventControlCommand, projection: object, resultFingerprint: string): Promise<string> {
    const audit = createObjectAuditValues("pet_explore_event_control_app_wiring", this.now());
    for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) {
      const operationId = this.generate();
      assertObjectIdentityCandidate(operationId);
      try {
        const inserted = await database.execute(
          "INSERT INTO canonical_pet_explore_event_control_operations(pet_explore_event_control_operation_id,event_code,requested_active,previous_active,previous_version,resulting_version,relocated_participant_count,replay_namespace,request_key,payload_fingerprint,result_fingerprint,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,'COMPLETED',?,?,?,?)",
          [operationId, command.eventCode, command.active, (projection as {previousActive:boolean}).previousActive, (projection as {previousVersion:string}).previousVersion, (projection as {version:string}).version, (projection as {relocatedParticipantCount:string}).relocatedParticipantCount, claim.requestNamespace, claim.requestKey, claim.payloadFingerprint, resultFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
        );
        if (inserted.affectedRows !== 1n) throw new Error("PET_EXPLORE_EVENT_CONTROL_RECEIPT_NOT_PERSISTED");
        return operationId;
      } catch (error) {
        if (!primaryDuplicate(error) || attempt + 1 === this.maximumAttempts) throw error;
      }
    }
    throw new Error("PET_EXPLORE_EVENT_CONTROL_RECEIPT_ID_COLLISION_RETRY_EXHAUSTED");
  }
}
