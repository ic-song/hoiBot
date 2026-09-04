import { createHash } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import type { AppWiringClaim, AppWiringMutationParticipant } from "../dispatch/app-wiring-operation-provider.js";
import {
  assertObjectIdentityCandidate,
  createObjectAuditValues,
  createObjectIdentityCandidate,
  OBJECT_IDENTITY_MAX_ATTEMPTS,
  type ObjectIdentityCandidateGenerator,
} from "../identity/object-identity-audit-provider.js";
import { MariaCanonicalTitleRepository, type CanonicalTitleReleaseStatus } from "../title/maria-canonical-title-repository.js";

export interface PetTitleCanonicalMutationResult {
  operationId: string;
  resultFingerprint: string;
  operationType: "SELECT" | "REMOVE" | "SELL";
  ownedPetTitleId: string;
  replayedDomainState: boolean;
}

interface OwnedTitleRow {
  pet_title_id: string;
  ownership_status: string;
}

function scopedDatabase(participant: AppWiringMutationParticipant): DatabaseClient {
  return {
    ping: async () => { await participant.query("SELECT 1"); },
    verifyRollback: async () => true,
    query: <T>(sql: string, values: readonly unknown[] = []) => participant.query<T>(sql, values),
    execute: (sql: string, values: readonly unknown[] = []) => participant.execute(sql, values),
    withTransaction: (work) => participant.withTransaction(work),
    close: async () => undefined,
  };
}

function fingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function primaryDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "ER_DUP_ENTRY" && /PRIMARY/i.test(message);
}

// SELECT/REMOVE/SELL are deliberately isolated from ITEM/CURRENCY-linked creation and sale settlement.
// The caller must execute this provider inside MariaAppWiringOperationProvider.runMutation.
export class PetTitleCanonicalMutationProvider {
  constructor(
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maximumAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async select(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; ownedPetTitleId: string }): Promise<PetTitleCanonicalMutationResult> {
    return this.mutate(database, claim, { ...input, operationType: "SELECT" });
  }

  async release(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; ownedPetTitleId: string; status: CanonicalTitleReleaseStatus }): Promise<PetTitleCanonicalMutationResult> {
    if (input.status === "sold") throw new Error("PET_TITLE_SELL_CURRENCY_PARTICIPANT_REQUIRED");
    return this.mutate(database, claim, { ...input, operationType: "REMOVE", releaseStatus: input.status });
  }

  private async mutate(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; ownedPetTitleId: string; operationType: "SELECT" | "REMOVE" | "SELL"; releaseStatus?: CanonicalTitleReleaseStatus }): Promise<PetTitleCanonicalMutationResult> {
    if (claim.route !== "MODERN" || claim.effectMode !== "MUTATION") throw new Error("PET_TITLE_APP_WIRING_MUTATION_CLAIM_REQUIRED");
    assertObjectIdentityCandidate(input.playerId);
    assertObjectIdentityCandidate(input.ownedPetTitleId);
    const owned = (await database.query<OwnedTitleRow[]>(
      "SELECT pet_title_id,ownership_status FROM canonical_owned_pet_title_instances WHERE owned_pet_title_id=? AND player_id=? FOR UPDATE",
      [input.ownedPetTitleId, input.playerId],
    ))[0];
    if (owned === undefined) throw new Error("CANONICAL_TITLE_OWNED_INSTANCE_NOT_FOUND");
    const repository = new MariaCanonicalTitleRepository(scopedDatabase(database), this.now);
    let replayedDomainState = false;
    if (input.operationType === "SELECT") {
      await repository.select({ domain: "pet", actor: input.actor, playerId: input.playerId, ownedTitleId: input.ownedPetTitleId });
    } else {
      replayedDomainState = await repository.release({ domain: "pet", actor: input.actor, playerId: input.playerId, ownedTitleId: input.ownedPetTitleId, status: input.releaseStatus! });
    }
    const projection = { operationType: input.operationType, playerId: input.playerId, petTitleId: owned.pet_title_id, ownedPetTitleId: input.ownedPetTitleId, replayedDomainState };
    const resultFingerprint = fingerprint(projection);
    const operationId = await this.insertReceipt(database, claim, input.actor, projection, resultFingerprint);
    await this.insertParticipant(database, input.actor, operationId, input.playerId);
    return { operationId, resultFingerprint, operationType: input.operationType, ownedPetTitleId: input.ownedPetTitleId, replayedDomainState };
  }

  private async insertReceipt(database: AppWiringMutationParticipant, claim: AppWiringClaim, actor: string, projection: { operationType: string; playerId: string; petTitleId: string; ownedPetTitleId: string }, resultFingerprint: string): Promise<string> {
    const audit = createObjectAuditValues(actor, this.now());
    for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) {
      const operationId = this.generate();
      assertObjectIdentityCandidate(operationId);
      try {
        const result = await database.execute(
          "INSERT INTO canonical_pet_title_operations(pet_title_operation_id,player_id,pet_title_id,owned_pet_title_id,owned_pet_id,operation_type,replay_namespace,request_key,payload_fingerprint,result_fingerprint,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,NULL,?,?,?,?,?,'COMPLETED',?,?,?,?)",
          [operationId, projection.playerId, projection.petTitleId, projection.ownedPetTitleId, projection.operationType, claim.requestNamespace, claim.requestKey, claim.payloadFingerprint, resultFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
        );
        if (result.affectedRows !== 1n) throw new Error("PET_TITLE_OPERATION_RECEIPT_NOT_PERSISTED");
        return operationId;
      } catch (error) {
        if (!primaryDuplicate(error) || attempt + 1 === this.maximumAttempts) throw error;
      }
    }
    throw new Error("PET_TITLE_OPERATION_RECEIPT_ID_COLLISION_RETRY_EXHAUSTED");
  }

  private async insertParticipant(database: AppWiringMutationParticipant, actor: string, operationId: string, playerId: string): Promise<void> {
    const audit = createObjectAuditValues(actor, this.now());
    for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) {
      const participantId = this.generate();
      assertObjectIdentityCandidate(participantId);
      try {
        const result = await database.execute(
          "INSERT INTO canonical_pet_title_operation_participants(pet_title_operation_participant_id,pet_title_operation_id,player_id,participant_role,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'OWNER',?,?,?,?)",
          [participantId, operationId, playerId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
        );
        if (result.affectedRows !== 1n) throw new Error("PET_TITLE_OPERATION_PARTICIPANT_NOT_PERSISTED");
        return;
      } catch (error) {
        if (!primaryDuplicate(error) || attempt + 1 === this.maximumAttempts) throw error;
      }
    }
    throw new Error("PET_TITLE_OPERATION_PARTICIPANT_ID_COLLISION_RETRY_EXHAUSTED");
  }
}
