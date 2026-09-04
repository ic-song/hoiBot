import { createHash } from "node:crypto";
import type { ControlledDatabaseTransaction, DatabaseClient } from "../database.js";
import type { AppWiringClaim, AppWiringMutationParticipant } from "../dispatch/app-wiring-operation-provider.js";
import { CanonicalItemInventoryRepository } from "../inventory/canonical-item-inventory-repository.js";
import { MariaCanonicalCurrencyRepository } from "../currency/maria-canonical-currency-repository.js";
import {
  assertObjectIdentityCandidate,
  createObjectAuditValues,
  createObjectIdentityCandidate,
  OBJECT_IDENTITY_MAX_ATTEMPTS,
  type ObjectIdentityCandidateGenerator,
} from "../identity/object-identity-audit-provider.js";
import { MariaCanonicalTitleRepository, type CanonicalTitleReleaseStatus } from "../title/maria-canonical-title-repository.js";
import { calculatePetTitleSaleMinorAmount } from "./pet-title-sale-policy.js";

interface PetTitleCanonicalMutationBase {
  operationId: string;
  resultFingerprint: string;
  replayedDomainState: boolean;
}
export type PetTitleCanonicalCreateResult =
  | (PetTitleCanonicalMutationBase & { operationType:"CREATE";outcomeCode:"CREATED";ownedPetTitleId:string;titleName:string;remainingTicketQuantity:bigint })
  | (PetTitleCanonicalMutationBase & { operationType:"CREATE";outcomeCode:"INSUFFICIENT_TICKET";titleName:string;remainingTicketQuantity:0n });
export type PetTitleCanonicalMutationResult = PetTitleCanonicalCreateResult
  | (PetTitleCanonicalMutationBase & { operationType:"SELECT"|"REMOVE"|"SELL";ownedPetTitleId:string });
export type PetTitleCanonicalSelectResult=PetTitleCanonicalMutationBase&{operationType:"SELECT";ownedPetTitleId:string};
export type PetTitleCanonicalRemoveResult=PetTitleCanonicalMutationBase&{operationType:"REMOVE";ownedPetTitleId:string};
export type PetTitleCanonicalSellResult=
  | (PetTitleCanonicalMutationBase&{operationType:"SELL";outcomeCode:"SOLD";ownedPetTitleId:string;titleName:string;salePoint:bigint;currencyOperationId:string;balanceAfterMinorAmount:bigint})
  | (PetTitleCanonicalMutationBase&{operationType:"SELL";outcomeCode:"NOT_FOUND";salePoint:0n});
type PetTitleCanonicalOwnershipMutationResult=PetTitleCanonicalMutationBase&{operationType:"SELECT"|"REMOVE"|"SELL";ownedPetTitleId:string};

interface OwnedTitleRow {
  pet_title_id: string;
  ownership_status: string;
}

interface SellTitleRow extends OwnedTitleRow {
  owned_pet_title_id:string;
  title_name:string;
  acquisition_price:bigint|string|null;
  base_sale_price:bigint|string;
}

interface PointCurrencyRow { currency_id:string;decimal_places:number|string; }

interface TicketDefinitionRow { item_id: string; }
interface TicketStackRow { quantity: bigint | string; }

const TITLE_TICKET_NAME = "펫타이틀권🦊(/펫타이틀이름)";
const CREATED_TITLE_PRICE = 100000000n;
const POINT_SOURCE_SYSTEM="LEGACY_JSON";
const POINT_SOURCE_NAMESPACE="member.point";
const POINT_SOURCE_IDENTIFIER="point";

function controlledParticipant(current:AppWiringMutationParticipant):ControlledDatabaseTransaction{
  return {
    query:<T>(sql:string,values:readonly unknown[]=[])=>(current.query<T>(sql,values)),
    execute:(sql:string,values:readonly unknown[]=[])=>current.execute(sql,values),
    withSavepoint:<T>(work:(nested:ControlledDatabaseTransaction)=>Promise<T>)=>current.withTransaction(next=>work(controlledParticipant(next))),
  };
}

function scopedDatabase(participant: AppWiringMutationParticipant): DatabaseClient {
  return {
    ping: async () => { await participant.query("SELECT 1"); },
    verifyRollback: async () => true,
    query: <T>(sql: string, values: readonly unknown[] = []) => participant.query<T>(sql, values),
    execute: (sql: string, values: readonly unknown[] = []) => participant.execute(sql, values),
    withTransaction: (work) => participant.withTransaction((nested)=>work(controlledParticipant(nested))),
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
  const constraint = "constraint" in error ? String(error.constraint) : "";
  return code === "ER_DUP_ENTRY" && (/PRIMARY/i.test(message) || /^PRIMARY$/i.test(constraint));
}

// SELECT/REMOVE/SELL are deliberately isolated from ITEM/CURRENCY-linked creation and sale settlement.
// The caller must execute this provider inside MariaAppWiringOperationProvider.runMutation.
export class PetTitleCanonicalMutationProvider {
  constructor(
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maximumAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; titleName: string }): Promise<PetTitleCanonicalCreateResult> {
    if (claim.route !== "MODERN" || claim.effectMode !== "MUTATION") throw new Error("PET_TITLE_APP_WIRING_MUTATION_CLAIM_REQUIRED");
    assertObjectIdentityCandidate(input.playerId);
    if (input.titleName.trim() === "" || input.titleName.length > 20) throw new Error("PET_TITLE_CREATE_NAME_INVALID");
    const player = (await database.query<Array<{ player_id: string }>>("SELECT player_id FROM canonical_players WHERE player_id=? FOR UPDATE", [input.playerId]))[0];
    if (player === undefined) throw new Error("CANONICAL_PLAYER_NOT_FOUND");
    const ticket = (await database.query<TicketDefinitionRow[]>(
      `SELECT definition_row.item_id
         FROM canonical_item_definition_imports import_row
         JOIN canonical_item_definitions definition_row ON definition_row.item_id=import_row.item_id
        WHERE import_row.source_system='LEGACY_JSON' AND import_row.source_namespace='member.bag'
          AND import_row.source_identifier=? AND definition_row.stackable_flag=TRUE AND definition_row.active_flag=TRUE
        FOR UPDATE`,
      [TITLE_TICKET_NAME],
    ))[0];
    if (ticket === undefined) throw new Error("PET_TITLE_TICKET_CANONICAL_DEFINITION_NOT_FOUND");
    const stack = (await database.query<TicketStackRow[]>(
      "SELECT quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
      [input.playerId, ticket.item_id],
    ))[0];
    if (stack === undefined || BigInt(stack.quantity) < 1n) {
      const projection = { operationType: "CREATE", outcomeCode: "INSUFFICIENT_TICKET", playerId: input.playerId, petTitleId: null, ownedPetTitleId: null, itemId: ticket.item_id, titleName: input.titleName, remainingTicketQuantity: "0" };
      const resultFingerprint = fingerprint(projection);
      const operationId = await this.insertReceipt(database, claim, input.actor, projection, resultFingerprint);
      await this.insertParticipant(database, input.actor, operationId, input.playerId);
      return { operationId, resultFingerprint, operationType: "CREATE", outcomeCode: "INSUFFICIENT_TICKET", titleName: input.titleName, remainingTicketQuantity: 0n, replayedDomainState: false };
    }
    const scoped = scopedDatabase(database);
    const itemResult = await new CanonicalItemInventoryRepository(scoped, this.generate, this.maximumAttempts, this.now).changeStackQuantity({
      actor: input.actor, playerId: input.playerId, itemId: ticket.item_id, requestKey: claim.requestKey, quantityDelta: -1n, reasonType: "PET_TITLE_TICKET_USED",
    });
    const titles = new MariaCanonicalTitleRepository(scoped, this.now);
    const definition = await titles.registerDefinition({
      domain: "pet", actor: input.actor, sourceSystem: "APP_WIRING", sourceIdentifier: claim.appWiringOperationId,
      titleName: input.titleName, baseSalePrice: CREATED_TITLE_PRICE,
    });
    const sequenceRow = (await database.query<Array<{ next_sequence: bigint | string }>>(
      "SELECT COALESCE(MAX(acquisition_sequence),0)+1 AS next_sequence FROM canonical_owned_pet_title_instances WHERE player_id=? FOR UPDATE",
      [input.playerId],
    ))[0];
    const acquisitionSequence = BigInt(sequenceRow?.next_sequence ?? 1);
    const acquiredTime = createObjectAuditValues(input.actor, this.now()).INSERT_TIME;
    const granted = await titles.grant({
      domain: "pet", actor: input.actor, sourceSystem: "APP_WIRING", requestKey: claim.requestKey,
      playerId: input.playerId, titleDefinitionId: definition.titleDefinitionId, acquisitionSequence,
      acquiredTime, acquisitionPrice: CREATED_TITLE_PRICE,
    });
    const projection = {
      operationType: "CREATE", outcomeCode: "CREATED", playerId: input.playerId, petTitleId: definition.titleDefinitionId,
      ownedPetTitleId: granted.ownedTitleId, itemId: ticket.item_id, titleName: input.titleName,
      acquisitionSequence: acquisitionSequence.toString(), acquisitionPrice: CREATED_TITLE_PRICE.toString(), remainingTicketQuantity: itemResult.quantity.toString(),
    };
    const resultFingerprint = fingerprint(projection);
    const operationId = await this.insertReceipt(database, claim, input.actor, projection, resultFingerprint);
    await this.insertParticipant(database, input.actor, operationId, input.playerId);
    return {
      operationId, resultFingerprint, operationType: "CREATE", outcomeCode: "CREATED", ownedPetTitleId: granted.ownedTitleId,
      titleName: input.titleName, remainingTicketQuantity: itemResult.quantity,
      replayedDomainState: itemResult.replayed || definition.replayed || granted.replayed,
    };
  }

  async select(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; ownedPetTitleId: string }): Promise<PetTitleCanonicalSelectResult> {
    return this.mutate(database, claim, { ...input, operationType: "SELECT" }) as Promise<PetTitleCanonicalSelectResult>;
  }

  async release(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; ownedPetTitleId: string; status: CanonicalTitleReleaseStatus }): Promise<PetTitleCanonicalRemoveResult> {
    if (input.status === "sold") throw new Error("PET_TITLE_SELL_CURRENCY_PARTICIPANT_REQUIRED");
    return this.mutate(database, claim, { ...input, operationType: "REMOVE", releaseStatus: input.status }) as Promise<PetTitleCanonicalRemoveResult>;
  }

  async sell(database:AppWiringMutationParticipant,claim:AppWiringClaim,input:{actor:string;playerId:string;index:number}):Promise<PetTitleCanonicalSellResult>{
    if(claim.route!=="MODERN"||claim.effectMode!=="MUTATION")throw new Error("PET_TITLE_APP_WIRING_MUTATION_CLAIM_REQUIRED");
    assertObjectIdentityCandidate(input.playerId);
    if(!Number.isSafeInteger(input.index)||input.index<1)throw new Error("PET_TITLE_SALE_INDEX_INVALID");
    const player=(await database.query<Array<{player_id:string}>>("SELECT player_id FROM canonical_players WHERE player_id=? FOR UPDATE",[input.playerId]))[0];
    if(player===undefined)throw new Error("CANONICAL_PLAYER_NOT_FOUND");
    const target=(await database.query<SellTitleRow[]>(
      `SELECT owned.owned_pet_title_id,owned.pet_title_id,owned.ownership_status,owned.acquisition_price,definition.title_name,definition.base_sale_price
         FROM canonical_owned_pet_title_instances owned
         JOIN canonical_pet_title_definitions definition ON definition.pet_title_id=owned.pet_title_id
        WHERE owned.player_id=? AND owned.ownership_status='owned'
        ORDER BY owned.acquisition_sequence,owned.owned_pet_title_id LIMIT 1 OFFSET ? FOR UPDATE`,
      [input.playerId,input.index-1],
    ))[0];
    if(target===undefined){
      const projection={operationType:"SELL",outcomeCode:"NOT_FOUND",playerId:input.playerId,petTitleId:null,ownedPetTitleId:null,currencyOperationId:null,index:input.index,salePoint:"0"};
      const resultFingerprint=fingerprint(projection);
      const operationId=await this.insertReceipt(database,claim,input.actor,projection,resultFingerprint);
      await this.insertParticipant(database,input.actor,operationId,input.playerId);
      return {operationId,resultFingerprint,replayedDomainState:false,operationType:"SELL",outcomeCode:"NOT_FOUND",salePoint:0n};
    }
    const point=(await database.query<PointCurrencyRow[]>(
      `SELECT definition.currency_id,definition.decimal_places
         FROM canonical_currency_definition_imports import_row
         JOIN canonical_currency_definitions definition ON definition.currency_id=import_row.currency_id
        WHERE import_row.source_system=? AND import_row.source_namespace=? AND import_row.source_identifier=?
          AND definition.active_flag=TRUE FOR UPDATE`,
      [POINT_SOURCE_SYSTEM,POINT_SOURCE_NAMESPACE,POINT_SOURCE_IDENTIFIER],
    ))[0];
    if(point===undefined)throw new Error("PET_TITLE_POINT_CANONICAL_DEFINITION_NOT_FOUND");
    const priceAmount=BigInt(target.acquisition_price??target.base_sale_price);
    const sale=calculatePetTitleSaleMinorAmount(priceAmount,Number(point.decimal_places));
    const scoped=scopedDatabase(database);
    const currency=await new MariaCanonicalCurrencyRepository(scoped).adjustBalanceInTransaction(controlledParticipant(database),{
      actor:input.actor,playerId:input.playerId,currencyId:point.currency_id,deltaMinorAmount:sale.deltaMinorAmount,
      operationKind:"PET_TITLE_SELL",reasonKey:"PET_TITLE_SOLD",requestKey:claim.requestKey,
    });
    const replayedTitle=await new MariaCanonicalTitleRepository(scoped,this.now).release({
      domain:"pet",actor:input.actor,playerId:input.playerId,ownedTitleId:target.owned_pet_title_id,status:"sold",
    });
    const projection={operationType:"SELL",outcomeCode:"SOLD",playerId:input.playerId,petTitleId:target.pet_title_id,ownedPetTitleId:target.owned_pet_title_id,currencyOperationId:currency.currencyOperationId,titleName:target.title_name,salePoint:sale.salePoint.toString(),deltaMinorAmount:sale.deltaMinorAmount.toString(),balanceAfterMinorAmount:currency.balanceAfterMinorAmount.toString()};
    const resultFingerprint=fingerprint(projection);
    const operationId=await this.insertReceipt(database,claim,input.actor,projection,resultFingerprint);
    await this.insertParticipant(database,input.actor,operationId,input.playerId);
    return {operationId,resultFingerprint,replayedDomainState:currency.replayed||replayedTitle,operationType:"SELL",outcomeCode:"SOLD",ownedPetTitleId:target.owned_pet_title_id,titleName:target.title_name,salePoint:sale.salePoint,currencyOperationId:currency.currencyOperationId,balanceAfterMinorAmount:currency.balanceAfterMinorAmount};
  }

  private async mutate(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; ownedPetTitleId: string; operationType: "SELECT"|"REMOVE"|"SELL"; releaseStatus?: CanonicalTitleReleaseStatus }): Promise<PetTitleCanonicalOwnershipMutationResult> {
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

  private async insertReceipt(database: AppWiringMutationParticipant, claim: AppWiringClaim, actor: string, projection: { operationType: string; playerId: string; petTitleId: string | null; ownedPetTitleId: string | null;currencyOperationId?:string|null }, resultFingerprint: string): Promise<string> {
    const audit = createObjectAuditValues(actor, this.now());
    for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) {
      const operationId = this.generate();
      assertObjectIdentityCandidate(operationId);
      try {
        const result = await database.execute(
          "INSERT INTO canonical_pet_title_operations(pet_title_operation_id,player_id,pet_title_id,owned_pet_title_id,owned_pet_id,currency_operation_id,operation_type,replay_namespace,request_key,payload_fingerprint,result_fingerprint,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,'COMPLETED',?,?,?,?)",
          [operationId, projection.playerId, projection.petTitleId, projection.ownedPetTitleId,projection.currencyOperationId??null, projection.operationType, claim.requestNamespace, claim.requestKey, claim.payloadFingerprint, resultFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
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
