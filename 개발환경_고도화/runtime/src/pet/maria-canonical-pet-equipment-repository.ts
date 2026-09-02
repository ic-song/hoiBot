import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { MariaObjectIdentityAuditProvider } from "../identity/object-identity-audit-provider.js";

export interface CanonicalPetEquipmentAssignInput {
  actor: string;
  playerId: string;
  ownedPetId: string;
  ownedEquipmentId: string;
  equipmentSlot: string;
  requestKey: string;
}

export interface CanonicalPetEquipmentAssignResult {
  petEquipmentOperationId: string;
  ownedPetEquipmentId: string;
  replayed: boolean;
}

interface ReplayRow { pet_equipment_operation_id: string; owned_pet_equipment_id: string | null; }

function assertInput(input: CanonicalPetEquipmentAssignInput): void {
  for (const value of [input.playerId, input.ownedPetId, input.ownedEquipmentId]) if (!/^[a-z0-9]{8}$/.test(value)) throw new Error("CANONICAL_PET_EQUIPMENT_IDENTIFIER_INVALID");
  if (input.actor.trim() === "" || input.equipmentSlot.trim() === "" || input.requestKey.trim() === "") throw new Error("CANONICAL_PET_EQUIPMENT_INPUT_INVALID");
}

// 공용 CUID2·감사 provider와 같은 트랜잭션에서 소유자 일치 장착 및 replay를 기록합니다.
export class MariaCanonicalPetEquipmentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async assign(input: CanonicalPetEquipmentAssignInput): Promise<CanonicalPetEquipmentAssignResult> {
    assertInput(input);
    return this.database.withTransaction(async (transaction) => this.assignInTransaction(transaction, input));
  }

  private async assignInTransaction(transaction: DatabaseTransaction, input: CanonicalPetEquipmentAssignInput): Promise<CanonicalPetEquipmentAssignResult> {
    const prior = (await transaction.query<ReplayRow[]>("SELECT pet_equipment_operation_id,owned_pet_equipment_id FROM canonical_pet_equipment_operation_replays WHERE player_id=? AND request_key=? FOR UPDATE", [input.playerId, input.requestKey]))[0];
    if (prior?.owned_pet_equipment_id) return { petEquipmentOperationId: prior.pet_equipment_operation_id, ownedPetEquipmentId: prior.owned_pet_equipment_id, replayed: true };
    const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
    const operation = await identity.registerCrosswalk({ actor: input.actor, objectType: "PET_EQUIPMENT_OPERATION", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "petEquipmentOperation", sourceIdentifier: `${input.playerId}:${input.requestKey}` });
    const assignment = await identity.registerCrosswalk({ actor: input.actor, objectType: "OWNED_PET_EQUIPMENT", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "petEquipmentAssignment", sourceIdentifier: `${input.playerId}:${input.ownedPetId}:${input.ownedEquipmentId}` });
    const audit = operation.audit;
    await transaction.execute(
      "INSERT INTO canonical_owned_pet_equipment(owned_pet_equipment_id,owned_pet_id,owned_equipment_id,player_id,equipment_slot,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)",
      [assignment.objectIdentityId, input.ownedPetId, input.ownedEquipmentId, input.playerId, input.equipmentSlot, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    await transaction.execute(
      "INSERT INTO canonical_pet_equipment_operation_replays(pet_equipment_operation_id,player_id,request_key,operation_status,owned_pet_equipment_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'completed',?,?,?,?,?)",
      [operation.objectIdentityId, input.playerId, input.requestKey, assignment.objectIdentityId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    return { petEquipmentOperationId: operation.objectIdentityId, ownedPetEquipmentId: assignment.objectIdentityId, replayed: false };
  }
}
