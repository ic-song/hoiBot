import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { assertObjectIdentityCandidate, MariaObjectIdentityAuditProvider } from "../identity/object-identity-audit-provider.js";
import { normalizeCanonicalPetSkillOptions } from "./canonical-pet-skill-handler-registry.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;

export interface CanonicalPetSkillDefinitionInput {
  actor: string;
  sourceSystem: string;
  sourceNamespace: string;
  sourceIdentifier: string;
  petSkillName: string;
  petSkillDescription?: string | null;
  petSkillGrade?: string | null;
  handlerKey: string;
  options: unknown;
  active?: boolean;
}

export interface CanonicalPetSkillGrantInput {
  actor: string;
  playerId: string;
  petSkillId: string;
  quantity: bigint;
  requestKey: string;
}

export interface CanonicalPetSkillEquipInput {
  actor: string;
  playerId: string;
  ownedPetId: string;
  petSkillId: string;
  slotNumber: number;
  requestKey: string;
}

export interface CanonicalPetSkillMutationResult {
  petSkillOperationId: string;
  resultingQuantity: bigint;
  ownedPetSkillEquipmentId: string | null;
  replayed: boolean;
}

interface ImportRow { pet_skill_id: string; payload_fingerprint: string; }
interface StackRow { owned_pet_skill_id: string; quantity: bigint; }
interface ReplayRow {
  pet_skill_operation_id: string;
  operation_kind: string;
  payload_fingerprint: string;
  resulting_quantity: bigint | null;
  owned_pet_skill_equipment_id: string | null;
}

function identifier(value: string): void {
  try { assertObjectIdentityCandidate(value); }
  catch { throw new Error("CANONICAL_PET_SKILL_IDENTIFIER_INVALID"); }
}

function text(value: string, maximum: number, code: string): void {
  if (value.trim() === "" || value.length > maximum) throw new Error(code);
}

function duplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message))));
}

function fingerprint(value: Record<string, string | number>): string {
  return createHash("sha256").update(JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]])), "utf8").digest("hex");
}

function sourceDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function replay(row: ReplayRow, kind: string, payloadFingerprint: string): CanonicalPetSkillMutationResult {
  if (row.operation_kind !== kind || row.payload_fingerprint !== payloadFingerprint) throw new Error("CANONICAL_PET_SKILL_REQUEST_PAYLOAD_CONFLICT");
  if (row.resulting_quantity === null) throw new Error("CANONICAL_PET_SKILL_REPLAY_INCOMPLETE");
  return { petSkillOperationId: row.pet_skill_operation_id, resultingQuantity: row.resulting_quantity, ownedPetSkillEquipmentId: row.owned_pet_skill_equipment_id, replayed: true };
}

// 공용 CUID2·KST 감사 provider를 사용해 정의, 수량 보유, 펫 장착을 동일 transaction 경계에 기록합니다.
export class MariaCanonicalPetSkillRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async registerDefinition(input: CanonicalPetSkillDefinitionInput): Promise<{ petSkillId: string; replayed: boolean }> {
    text(input.sourceSystem, 50, "CANONICAL_PET_SKILL_SOURCE_SYSTEM_INVALID");
    text(input.sourceNamespace, 100, "CANONICAL_PET_SKILL_SOURCE_NAMESPACE_INVALID");
    text(input.sourceIdentifier, 191, "CANONICAL_PET_SKILL_SOURCE_IDENTIFIER_INVALID");
    text(input.petSkillName, 255, "CANONICAL_PET_SKILL_NAME_INVALID");
    if (input.petSkillGrade !== undefined && input.petSkillGrade !== null) text(input.petSkillGrade, 50, "CANONICAL_PET_SKILL_GRADE_INVALID");
    const options = normalizeCanonicalPetSkillOptions(input.handlerKey, input.options);
    const definitionFingerprint = createHash("sha256").update(JSON.stringify([
      input.petSkillName, input.petSkillDescription ?? null, input.petSkillGrade ?? null,
      input.handlerKey, options, input.active ?? true,
    ]), "utf8").digest("hex");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => {
          const current = (await transaction.query<ImportRow[]>("SELECT pet_skill_id,payload_fingerprint FROM canonical_pet_skill_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE", [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]))[0];
          if (current !== undefined) {
            if (current.payload_fingerprint !== definitionFingerprint) throw new Error("CANONICAL_PET_SKILL_DEFINITION_PAYLOAD_CONFLICT");
            return { petSkillId: current.pet_skill_id, replayed: true };
          }
          const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
          const definition = await identity.registerCrosswalk({ actor: input.actor, objectType: "PET_SKILL", sourceSystem: input.sourceSystem, sourceNamespace: input.sourceNamespace, sourceIdentifier: input.sourceIdentifier });
          const imported = await identity.registerCrosswalk({ actor: input.actor, objectType: "PET_SKILL_IMPORT", sourceSystem: input.sourceSystem, sourceNamespace: "petSkillDefinitionImport", sourceIdentifier: sourceDigest(`${input.sourceNamespace}:${input.sourceIdentifier}`) });
          const audit = definition.audit;
          await transaction.execute("INSERT INTO canonical_pet_skill_definitions(pet_skill_id,pet_skill_name,pet_skill_description,pet_skill_grade,handler_key,options_json,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [definition.objectIdentityId, input.petSkillName, input.petSkillDescription ?? null, input.petSkillGrade ?? null, input.handlerKey, JSON.stringify(options), input.active ?? true, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
          await transaction.execute("INSERT INTO canonical_pet_skill_definition_imports(pet_skill_definition_import_id,pet_skill_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", [imported.objectIdentityId, definition.objectIdentityId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, definitionFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
          return { petSkillId: definition.objectIdentityId, replayed: false };
        });
      } catch (error) {
        if (!duplicate(error) || attempt === 2) throw error;
      }
    }
    throw new Error("CANONICAL_PET_SKILL_DEFINITION_RETRY_EXHAUSTED");
  }

  public async grant(input: CanonicalPetSkillGrantInput): Promise<CanonicalPetSkillMutationResult> {
    identifier(input.playerId); identifier(input.petSkillId);
    text(input.requestKey, 191, "CANONICAL_PET_SKILL_REQUEST_KEY_INVALID");
    if (input.quantity <= 0n || input.quantity > UINT64_MAX) throw new Error("CANONICAL_PET_SKILL_QUANTITY_INVALID");
    const payload = fingerprint({ kind: "grant", petSkillId: input.petSkillId, quantity: input.quantity.toString() });
    return this.mutateWithReplay(input.playerId, input.requestKey, "grant", payload, (transaction) => this.grantInTransaction(transaction, input, payload));
  }

  public async equip(input: CanonicalPetSkillEquipInput): Promise<CanonicalPetSkillMutationResult> {
    identifier(input.playerId); identifier(input.ownedPetId); identifier(input.petSkillId);
    text(input.requestKey, 191, "CANONICAL_PET_SKILL_REQUEST_KEY_INVALID");
    if (!Number.isInteger(input.slotNumber) || input.slotNumber < 1 || input.slotNumber > 30) throw new Error("CANONICAL_PET_SKILL_SLOT_INVALID");
    const payload = fingerprint({ kind: "equip", ownedPetId: input.ownedPetId, petSkillId: input.petSkillId, slotNumber: input.slotNumber });
    return this.mutateWithReplay(input.playerId, input.requestKey, "equip", payload, (transaction) => this.equipInTransaction(transaction, input, payload));
  }

  private async mutateWithReplay(playerId: string, requestKey: string, kind: string, payload: string, work: (transaction: DatabaseTransaction) => Promise<CanonicalPetSkillMutationResult>): Promise<CanonicalPetSkillMutationResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.database.withTransaction(work); }
      catch (error) {
        if (!duplicate(error)) throw error;
        const row = await this.findReplay(playerId, requestKey);
        if (row !== undefined) return replay(row, kind, payload);
        if (attempt === 2) throw error;
      }
    }
    throw new Error("CANONICAL_PET_SKILL_OPERATION_RETRY_EXHAUSTED");
  }

  private async prior(transaction: DatabaseTransaction, playerId: string, requestKey: string): Promise<ReplayRow | undefined> {
    return (await transaction.query<ReplayRow[]>("SELECT pet_skill_operation_id,operation_kind,payload_fingerprint,resulting_quantity,owned_pet_skill_equipment_id FROM canonical_pet_skill_operation_replays WHERE player_id=? AND request_key=? FOR UPDATE", [playerId, requestKey]))[0];
  }

  private async findReplay(playerId: string, requestKey: string): Promise<ReplayRow | undefined> {
    return (await this.database.query<ReplayRow[]>("SELECT pet_skill_operation_id,operation_kind,payload_fingerprint,resulting_quantity,owned_pet_skill_equipment_id FROM canonical_pet_skill_operation_replays WHERE player_id=? AND request_key=?", [playerId, requestKey]))[0];
  }

  private async grantInTransaction(transaction: DatabaseTransaction, input: CanonicalPetSkillGrantInput, payload: string): Promise<CanonicalPetSkillMutationResult> {
    const prior = await this.prior(transaction, input.playerId, input.requestKey);
    if (prior !== undefined) return replay(prior, "grant", payload);
    const active = await transaction.query<Array<{ pet_skill_id: string }>>("SELECT pet_skill_id FROM canonical_pet_skill_definitions WHERE pet_skill_id=? AND active_flag=TRUE FOR UPDATE", [input.petSkillId]);
    if (active[0] === undefined) throw new Error("CANONICAL_PET_SKILL_DEFINITION_NOT_FOUND");
    const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
    const operation = await identity.registerCrosswalk({ actor: input.actor, objectType: "PET_SKILL_OPERATION", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "petSkillOperation", sourceIdentifier: sourceDigest(`${input.playerId}:${input.requestKey}`) });
    let stack = (await transaction.query<StackRow[]>("SELECT owned_pet_skill_id,quantity FROM canonical_owned_pet_skill_stacks WHERE player_id=? AND pet_skill_id=? FOR UPDATE", [input.playerId, input.petSkillId]))[0];
    if (stack === undefined) {
      const owned = await identity.registerCrosswalk({ actor: input.actor, objectType: "OWNED_PET_SKILL", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "ownedPetSkill", sourceIdentifier: `${input.playerId}:${input.petSkillId}` });
      const audit = owned.audit;
      await transaction.execute("INSERT INTO canonical_owned_pet_skill_stacks(owned_pet_skill_id,player_id,pet_skill_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,0,?,?,?,?)", [owned.objectIdentityId, input.playerId, input.petSkillId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      stack = { owned_pet_skill_id: owned.objectIdentityId, quantity: 0n };
    }
    const quantity = stack.quantity + input.quantity;
    if (quantity > UINT64_MAX) throw new Error("CANONICAL_PET_SKILL_QUANTITY_OVERFLOW");
    const audit = operation.audit;
    await transaction.execute("UPDATE canonical_owned_pet_skill_stacks SET quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_pet_skill_id=?", [quantity, audit.UPDATE_USER, audit.UPDATE_TIME, stack.owned_pet_skill_id]);
    await transaction.execute("INSERT INTO canonical_pet_skill_operation_replays(pet_skill_operation_id,player_id,request_key,operation_kind,payload_fingerprint,pet_skill_id,owned_pet_id,owned_pet_skill_equipment_id,resulting_quantity,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,NULL,NULL,?,'completed',?,?,?,?)", [operation.objectIdentityId, input.playerId, input.requestKey, "grant", payload, input.petSkillId, quantity, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    return { petSkillOperationId: operation.objectIdentityId, resultingQuantity: quantity, ownedPetSkillEquipmentId: null, replayed: false };
  }

  private async equipInTransaction(transaction: DatabaseTransaction, input: CanonicalPetSkillEquipInput, payload: string): Promise<CanonicalPetSkillMutationResult> {
    const prior = await this.prior(transaction, input.playerId, input.requestKey);
    if (prior !== undefined) return replay(prior, "equip", payload);
    const pet = await transaction.query<Array<{ owned_pet_id: string }>>("SELECT owned_pet_id FROM canonical_owned_pet_instances WHERE owned_pet_id=? AND player_id=? AND ownership_status='owned' FOR UPDATE", [input.ownedPetId, input.playerId]);
    if (pet[0] === undefined) throw new Error("CANONICAL_PET_SKILL_OWNED_PET_NOT_FOUND");
    const stack = (await transaction.query<StackRow[]>("SELECT owned_pet_skill_id,quantity FROM canonical_owned_pet_skill_stacks WHERE player_id=? AND pet_skill_id=? FOR UPDATE", [input.playerId, input.petSkillId]))[0];
    if (stack === undefined || stack.quantity < 1n) throw new Error("CANONICAL_PET_SKILL_INSUFFICIENT_QUANTITY");
    const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
    const operation = await identity.registerCrosswalk({ actor: input.actor, objectType: "PET_SKILL_OPERATION", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "petSkillOperation", sourceIdentifier: sourceDigest(`${input.playerId}:${input.requestKey}`) });
    const equipment = await identity.registerCrosswalk({ actor: input.actor, objectType: "OWNED_PET_SKILL_EQUIPMENT", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "petSkillEquipment", sourceIdentifier: `${input.playerId}:${input.ownedPetId}:${input.petSkillId}` });
    const audit = operation.audit;
    const quantity = stack.quantity - 1n;
    await transaction.execute("UPDATE canonical_owned_pet_skill_stacks SET quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_pet_skill_id=?", [quantity, audit.UPDATE_USER, audit.UPDATE_TIME, stack.owned_pet_skill_id]);
    await transaction.execute("INSERT INTO canonical_owned_pet_skill_equipments(owned_pet_skill_equipment_id,owned_pet_id,player_id,pet_skill_id,slot_number,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)", [equipment.objectIdentityId, input.ownedPetId, input.playerId, input.petSkillId, input.slotNumber, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    await transaction.execute("INSERT INTO canonical_pet_skill_operation_replays(pet_skill_operation_id,player_id,request_key,operation_kind,payload_fingerprint,pet_skill_id,owned_pet_id,owned_pet_skill_equipment_id,resulting_quantity,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,'completed',?,?,?,?)", [operation.objectIdentityId, input.playerId, input.requestKey, "equip", payload, input.petSkillId, input.ownedPetId, equipment.objectIdentityId, quantity, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    return { petSkillOperationId: operation.objectIdentityId, resultingQuantity: quantity, ownedPetSkillEquipmentId: equipment.objectIdentityId, replayed: false };
  }
}
