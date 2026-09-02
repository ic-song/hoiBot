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

interface ReplayRow { pet_equipment_operation_id: string; owned_pet_equipment_id: string | null; owned_pet_id: string; owned_equipment_id: string; equipment_slot: string; }
interface EquipmentSlotRow { equipment_slot: string; }

function assertInput(input: CanonicalPetEquipmentAssignInput): void {
  for (const value of [input.playerId, input.ownedPetId, input.ownedEquipmentId]) if (!/^[a-z0-9]{8}$/.test(value)) throw new Error("CANONICAL_PET_EQUIPMENT_IDENTIFIER_INVALID");
  if (input.actor.trim() === "" || input.equipmentSlot.trim() === "" || input.requestKey.trim() === "") throw new Error("CANONICAL_PET_EQUIPMENT_INPUT_INVALID");
}

function samePayload(row: ReplayRow, input: CanonicalPetEquipmentAssignInput): boolean {
  return row.owned_pet_id === input.ownedPetId && row.owned_equipment_id === input.ownedEquipmentId && row.equipment_slot === input.equipmentSlot;
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message))));
}

// 공용 CUID2·감사 provider와 같은 트랜잭션에서 소유자 일치 장착 및 replay를 기록합니다.
export class MariaCanonicalPetEquipmentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async assign(input: CanonicalPetEquipmentAssignInput): Promise<CanonicalPetEquipmentAssignResult> {
    assertInput(input);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => this.assignInTransaction(transaction, input));
      } catch (error) {
        if (!isDuplicate(error) || attempt === 1) throw error;
        const concurrent = await this.findReplay(input);
        if (concurrent !== undefined) return concurrent;
      }
    }
    throw new Error("CANONICAL_PET_EQUIPMENT_CONCURRENT_RETRY_EXHAUSTED");
  }

  private async assignInTransaction(transaction: DatabaseTransaction, input: CanonicalPetEquipmentAssignInput): Promise<CanonicalPetEquipmentAssignResult> {
    const prior = (await transaction.query<ReplayRow[]>("SELECT pet_equipment_operation_id,owned_pet_equipment_id,owned_pet_id,owned_equipment_id,equipment_slot FROM canonical_pet_equipment_operation_replays WHERE player_id=? AND request_key=? FOR UPDATE", [input.playerId, input.requestKey]))[0];
    if (prior !== undefined) return this.toReplay(prior, input);
    const slots = await transaction.query<EquipmentSlotRow[]>("SELECT definition_row.equipment_slot FROM canonical_owned_equipment_instances owned JOIN canonical_equipment_definitions definition_row ON definition_row.equipment_id=owned.equipment_id WHERE owned.owned_equipment_id=? AND owned.player_id=? AND definition_row.active_flag=TRUE FOR UPDATE", [input.ownedEquipmentId, input.playerId]);
    if (slots[0] === undefined) throw new Error("CANONICAL_PET_EQUIPMENT_OWNED_EQUIPMENT_NOT_FOUND");
    if (slots[0].equipment_slot !== input.equipmentSlot) throw new Error("CANONICAL_PET_EQUIPMENT_SLOT_MISMATCH");
    const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
    const operation = await identity.registerCrosswalk({ actor: input.actor, objectType: "PET_EQUIPMENT_OPERATION", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "petEquipmentOperation", sourceIdentifier: `${input.playerId}:${input.requestKey}` });
    const assignment = await identity.registerCrosswalk({ actor: input.actor, objectType: "OWNED_PET_EQUIPMENT", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "petEquipmentAssignment", sourceIdentifier: `${input.playerId}:${input.ownedPetId}:${input.ownedEquipmentId}` });
    const audit = operation.audit;
    await transaction.execute(
      "INSERT INTO canonical_owned_pet_equipment(owned_pet_equipment_id,owned_pet_id,owned_equipment_id,player_id,equipment_slot,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)",
      [assignment.objectIdentityId, input.ownedPetId, input.ownedEquipmentId, input.playerId, input.equipmentSlot, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    await transaction.execute(
      "INSERT INTO canonical_pet_equipment_operation_replays(pet_equipment_operation_id,player_id,request_key,owned_pet_id,owned_equipment_id,equipment_slot,operation_status,owned_pet_equipment_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'completed',?,?,?,?,?)",
      [operation.objectIdentityId, input.playerId, input.requestKey, input.ownedPetId, input.ownedEquipmentId, input.equipmentSlot, assignment.objectIdentityId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    return { petEquipmentOperationId: operation.objectIdentityId, ownedPetEquipmentId: assignment.objectIdentityId, replayed: false };
  }

  private async findReplay(input: CanonicalPetEquipmentAssignInput): Promise<CanonicalPetEquipmentAssignResult | undefined> {
    const row = (await this.database.query<ReplayRow[]>("SELECT pet_equipment_operation_id,owned_pet_equipment_id,owned_pet_id,owned_equipment_id,equipment_slot FROM canonical_pet_equipment_operation_replays WHERE player_id=? AND request_key=?", [input.playerId, input.requestKey]))[0];
    return row === undefined ? undefined : this.toReplay(row, input);
  }

  private toReplay(row: ReplayRow, input: CanonicalPetEquipmentAssignInput): CanonicalPetEquipmentAssignResult {
    if (!samePayload(row, input)) throw new Error("CANONICAL_PET_EQUIPMENT_REQUEST_PAYLOAD_CONFLICT");
    if (row.owned_pet_equipment_id === null) throw new Error("CANONICAL_PET_EQUIPMENT_REPLAY_INCOMPLETE");
    return { petEquipmentOperationId: row.pet_equipment_operation_id, ownedPetEquipmentId: row.owned_pet_equipment_id, replayed: true };
  }
}
