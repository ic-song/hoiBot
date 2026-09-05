import { createHash } from "node:crypto";
import type { ControlledDatabaseTransaction, DatabaseClient } from "../database.js";
import type { AppWiringClaim, AppWiringMutationParticipant } from "../dispatch/app-wiring-operation-provider.js";
import { CanonicalItemInventoryRepository } from "../inventory/canonical-item-inventory-repository.js";
import { MariaCanonicalCurrencyRepository } from "../currency/maria-canonical-currency-repository.js";
import { resolveGuildTerritoryWarAuthority } from "../guild/guild-territory-war-authority.js";
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
  | (PetTitleCanonicalMutationBase&{operationType:"SELL";outcomeCode:"NOT_FOUND";salePoint:0n})
  | (PetTitleCanonicalMutationBase&{operationType:"SELL";outcomeCode:"SILENT_CASTLE_ACTIVE";salePoint:0n});
export type PetTitleCanonicalAdminGrantResult=PetTitleCanonicalMutationBase&{
  operationType:"ADMIN_GRANT";ownedPetTitleId:string;petTitleId:string;titleName:string;acquisitionSequence:bigint;
};
export type PetTitleCanonicalBatchResult=PetTitleCanonicalMutationBase&{
  operationType:"ADMIN_SYNC"|"ADMIN_RESET";affectedPlayerCount:number;affectedTitleCount:number;affectedPlayerIds:string[];affectedMemberKeys:string[];
};
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
interface BatchOwnedTitleRow { owned_pet_title_id:string;player_id:string;member_key_before:string|null;linked_display_name_count:number|string;acquisition_sequence:bigint|string;selected_flag:number|string; }

const TITLE_TICKET_NAME = "펫타이틀권🦊(/펫타이틀이름)";
const CREATED_TITLE_PRICE = 100000000n;
const POINT_SOURCE_SYSTEM="LEGACY_JSON";
const POINT_SOURCE_NAMESPACE="member.point";
const POINT_SOURCE_IDENTIFIER="point";
const GUILD_TERRITORY_WORLD_SCOPE="world";
const PET_TITLE_GLOBAL_SCOPE="PET_TITLE";
const PET_TITLE_BATCH_MEMBER_KEY_CONTRACT="MEMBER_KEY_V1";
const PET_TITLE_BATCH_RESET_CONTRACT="RESET_V1";
const codePointLength=(value:string):number=>Array.from(value).length;

// 모든 PET_TITLE mutation이 동일한 전역 scope를 가장 먼저 잠그도록 강제합니다.
async function lockPetTitleGlobalScope(database:AppWiringMutationParticipant):Promise<void>{
  const row=(await database.query<Array<{lock_key:string}>>(
    "SELECT lock_key FROM canonical_pet_title_global_locks WHERE lock_key=? FOR UPDATE",
    [PET_TITLE_GLOBAL_SCOPE],
  ))[0];
  if(row===undefined)throw new Error("PET_TITLE_GLOBAL_SCOPE_NOT_FOUND");
}

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

  async adminGrant(database:AppWiringMutationParticipant,claim:AppWiringClaim,input:{actor:string;playerId:string;titleName:string;priceDigits:string}):Promise<PetTitleCanonicalAdminGrantResult>{
    if(claim.route!=="MODERN"||claim.effectMode!=="MUTATION")throw new Error("PET_TITLE_APP_WIRING_MUTATION_CLAIM_REQUIRED");
    assertObjectIdentityCandidate(input.playerId);
    if(input.titleName===""||input.titleName.length>255||!/^\d+$/.test(input.priceDigits))throw new Error("PET_TITLE_ADMIN_GRANT_INPUT_INVALID");
    const price=BigInt(input.priceDigits);
    if(price>18446744073709551615n)throw new Error("PET_TITLE_ADMIN_GRANT_PRICE_INVALID");
    await lockPetTitleGlobalScope(database);
    const player=(await database.query<Array<{player_id:string}>>("SELECT player_id FROM canonical_players WHERE player_id=? FOR UPDATE",[input.playerId]))[0];
    if(player===undefined)throw new Error("CANONICAL_PLAYER_NOT_FOUND");
    const existing=await database.query<Array<{owned_pet_title_id:string;acquisition_sequence:bigint|string}>>(
      "SELECT owned_pet_title_id,acquisition_sequence FROM canonical_owned_pet_title_instances WHERE player_id=? ORDER BY acquisition_sequence,owned_pet_title_id FOR UPDATE",
      [input.playerId],
    );
    const acquisitionSequence=existing.reduce((maximum,row)=>BigInt(row.acquisition_sequence)>maximum?BigInt(row.acquisition_sequence):maximum,0n)+1n;
    const scoped=scopedDatabase(database);
    const titles=new MariaCanonicalTitleRepository(scoped,this.now);
    const definition=await titles.registerDefinition({
      domain:"pet",actor:input.actor,sourceSystem:"ADMIN_IRIS",
      sourceIdentifier:`PET_ADMIN_GRANT:${claim.appWiringOperationId}`,
      titleName:input.titleName,baseSalePrice:0n,
    });
    const audit=createObjectAuditValues(input.actor,this.now());
    const owned=await titles.grant({
      domain:"pet",actor:input.actor,sourceSystem:"ADMIN_IRIS",requestKey:claim.requestKey,
      playerId:input.playerId,titleDefinitionId:definition.titleDefinitionId,acquisitionSequence,
      acquiredTime:audit.INSERT_TIME,acquisitionPrice:price,
    });
    const projection={operationType:"ADMIN_GRANT",playerId:input.playerId,petTitleId:definition.titleDefinitionId,ownedPetTitleId:owned.ownedTitleId,titleName:input.titleName,priceDigits:input.priceDigits,acquisitionSequence:acquisitionSequence.toString()};
    const resultFingerprint=fingerprint(projection);
    const operationId=await this.insertReceipt(database,claim,input.actor,projection,resultFingerprint);
    await this.insertParticipant(database,input.actor,operationId,input.playerId);
    return {operationId,resultFingerprint,replayedDomainState:definition.replayed||owned.replayed,operationType:"ADMIN_GRANT",ownedPetTitleId:owned.ownedTitleId,petTitleId:definition.titleDefinitionId,titleName:input.titleName,acquisitionSequence};
  }

  async adminSync(database:AppWiringMutationParticipant,claim:AppWiringClaim,input:{actor:string;activePlayerIds:readonly string[]}):Promise<PetTitleCanonicalBatchResult>{
    const activePlayerIds=[...new Set(input.activePlayerIds)].sort();
    if(activePlayerIds.length!==input.activePlayerIds.length||activePlayerIds.some(playerId=>!/^[a-z][a-z0-9]{7}$/.test(playerId)))throw new Error("PET_TITLE_ACTIVE_MEMBER_AUTHORITY_INVALID");
    return this.adminBatch(database,claim,input.actor,"ADMIN_SYNC",new Set(activePlayerIds));
  }

  async adminReset(database:AppWiringMutationParticipant,claim:AppWiringClaim,input:{actor:string}):Promise<PetTitleCanonicalBatchResult>{
    return this.adminBatch(database,claim,input.actor,"ADMIN_RESET");
  }

  async create(database: AppWiringMutationParticipant, claim: AppWiringClaim, input: { actor: string; playerId: string; titleName: string }): Promise<PetTitleCanonicalCreateResult> {
    if (claim.route !== "MODERN" || claim.effectMode !== "MUTATION") throw new Error("PET_TITLE_APP_WIRING_MUTATION_CLAIM_REQUIRED");
    assertObjectIdentityCandidate(input.playerId);
    if (input.titleName.trim() === "" || input.titleName.length > 20) throw new Error("PET_TITLE_CREATE_NAME_INVALID");
    await lockPetTitleGlobalScope(database);
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
    await lockPetTitleGlobalScope(database);
    const scope=(await database.query<Array<{war_id:bigint}>>(
      "SELECT war_id FROM guild_territory_start_scopes WHERE scope_code=? FOR UPDATE",
      [GUILD_TERRITORY_WORLD_SCOPE],
    ))[0];
    if(scope===undefined)throw new Error("GUILD_TERRITORY_WORLD_SCOPE_NOT_FOUND");
    const war=(await database.query<Array<{active:boolean|number;lifecycle_state:string}>>(
      "SELECT active,lifecycle_state FROM guild_territory_wars WHERE id=? FOR UPDATE",
      [scope.war_id],
    ))[0];
    if(war===undefined)throw new Error("GUILD_TERRITORY_WORLD_WAR_NOT_FOUND");
    const castleActive=resolveGuildTerritoryWarAuthority(war.active,war.lifecycle_state);
    const player=(await database.query<Array<{player_id:string}>>("SELECT player_id FROM canonical_players WHERE player_id=? FOR UPDATE",[input.playerId]))[0];
    if(player===undefined)throw new Error("CANONICAL_PLAYER_NOT_FOUND");
    if(castleActive){
      const projection={operationType:"SELL",outcomeCode:"SILENT_CASTLE_ACTIVE",playerId:input.playerId,petTitleId:null,ownedPetTitleId:null,currencyOperationId:null,index:String(input.index),salePoint:"0"};
      const resultFingerprint=fingerprint(projection);
      const operationId=await this.insertReceipt(database,claim,input.actor,projection,resultFingerprint);
      await this.insertParticipant(database,input.actor,operationId,input.playerId);
      return {operationId,resultFingerprint,replayedDomainState:false,operationType:"SELL",outcomeCode:"SILENT_CASTLE_ACTIVE",salePoint:0n};
    }
    if(!Number.isSafeInteger(input.index)||input.index<1)throw new Error("PET_TITLE_SALE_INDEX_INVALID");
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
    await lockPetTitleGlobalScope(database);
    const player=(await database.query<Array<{player_id:string}>>("SELECT player_id FROM canonical_players WHERE player_id=? FOR UPDATE",[input.playerId]))[0];
    if(player===undefined)throw new Error("CANONICAL_PLAYER_NOT_FOUND");
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

  private async adminBatch(database:AppWiringMutationParticipant,claim:AppWiringClaim,actor:string,operationType:"ADMIN_SYNC"|"ADMIN_RESET",activePlayerIds?:ReadonlySet<string>):Promise<PetTitleCanonicalBatchResult>{
    if(claim.route!=="MODERN"||claim.effectMode!=="MUTATION")throw new Error("PET_TITLE_APP_WIRING_MUTATION_CLAIM_REQUIRED");
    await lockPetTitleGlobalScope(database);
    // batch는 전역 scope 뒤 대상 player를 안정 순서로 잠그고 ownership을 잠급니다.
    await database.query(
      `SELECT canonical_player.player_id
         FROM canonical_players canonical_player
        WHERE EXISTS (SELECT 1 FROM canonical_owned_pet_title_instances owned WHERE owned.player_id=canonical_player.player_id AND owned.ownership_status='owned')
        ORDER BY canonical_player.player_id FOR UPDATE`,
    );
    const ownedRows=await database.query<BatchOwnedTitleRow[]>(`SELECT owned.owned_pet_title_id,owned.player_id,
            COALESCE(CASE WHEN CHAR_LENGTH(profile.current_display_name) BETWEEN 1 AND 255 THEN profile.current_display_name END,
              (SELECT CASE WHEN COUNT(DISTINCT BINARY TRIM(identity_row.display_name))=1 THEN MIN(TRIM(identity_row.display_name)) END
                 FROM canonical_player_identity_crosswalks crosswalk
                 JOIN external_identities identity_row ON identity_row.provider_code=crosswalk.provider_code
                  AND identity_row.external_user_id=crosswalk.external_user_id AND identity_row.status='linked'
                  AND CHAR_LENGTH(TRIM(identity_row.display_name)) BETWEEN 1 AND 255
                WHERE crosswalk.player_id=owned.player_id AND crosswalk.crosswalk_status='LINKED')) member_key_before,
            (SELECT COUNT(DISTINCT BINARY TRIM(identity_row.display_name))
               FROM canonical_player_identity_crosswalks crosswalk
               JOIN external_identities identity_row ON identity_row.provider_code=crosswalk.provider_code
                AND identity_row.external_user_id=crosswalk.external_user_id AND identity_row.status='linked'
                AND CHAR_LENGTH(TRIM(identity_row.display_name)) BETWEEN 1 AND 255
              WHERE crosswalk.player_id=owned.player_id AND crosswalk.crosswalk_status='LINKED') linked_display_name_count,
            owned.acquisition_sequence,CASE WHEN selection.owned_pet_title_id IS NULL THEN 0 ELSE 1 END selected_flag
          FROM canonical_owned_pet_title_instances owned
          JOIN canonical_players canonical_player ON canonical_player.player_id=owned.player_id
          LEFT JOIN player_profiles profile ON profile.player_id=CASE
            WHEN canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier REGEXP '^(0|[1-9][0-9]{0,19})$'
            THEN CAST(canonical_player.source_identifier AS UNSIGNED) ELSE NULL END
          LEFT JOIN canonical_pet_title_selections selection
            ON selection.player_id=owned.player_id AND selection.owned_pet_title_id=owned.owned_pet_title_id
         WHERE owned.ownership_status='owned' ORDER BY owned.player_id,owned.acquisition_sequence,owned.owned_pet_title_id FOR UPDATE`);
    const rows=operationType==="ADMIN_SYNC"?ownedRows.filter(row=>!activePlayerIds?.has(row.player_id)):ownedRows;
    if(operationType==="ADMIN_SYNC"&&rows.some(row=>Number(row.linked_display_name_count)>1&&row.member_key_before===null))throw new Error("PET_TITLE_BATCH_MEMBER_KEY_AMBIGUOUS");
    if(operationType==="ADMIN_SYNC"&&rows.some(row=>typeof row.member_key_before!=="string"||codePointLength(row.member_key_before)<1||codePointLength(row.member_key_before)>255))throw new Error("PET_TITLE_BATCH_MEMBER_KEY_UNRESOLVED");
    const counts=new Map<string,number>();
    for(const row of rows)counts.set(row.player_id,(counts.get(row.player_id)??0)+1);
    if(rows.length>0){
      const audit=createObjectAuditValues(actor,this.now());
      for(const row of rows){
        await database.execute("DELETE FROM canonical_pet_title_selections WHERE player_id=? AND owned_pet_title_id=?",[row.player_id,row.owned_pet_title_id]);
        const changed=await database.execute("UPDATE canonical_owned_pet_title_instances SET ownership_status='removed',UPDATE_USER=?,UPDATE_TIME=? WHERE owned_pet_title_id=? AND player_id=? AND ownership_status='owned'",[audit.UPDATE_USER,audit.UPDATE_TIME,row.owned_pet_title_id,row.player_id]);
        if(changed.affectedRows!==1n)throw new Error("PET_TITLE_ADMIN_BATCH_OWNERSHIP_DRIFT");
      }
    }
    const affectedPlayerIds=[...counts.keys()].sort();
    const memberKeys=new Map<string,string>();
    if(operationType==="ADMIN_SYNC")for(const row of rows){
      const current=memberKeys.get(row.player_id);
      if(current!==undefined&&current!==row.member_key_before)throw new Error("PET_TITLE_BATCH_MEMBER_KEY_DRIFT");
      memberKeys.set(row.player_id,row.member_key_before!);
    }
    const affectedMemberKeys=operationType==="ADMIN_SYNC"?affectedPlayerIds.map(playerId=>memberKeys.get(playerId)!):[];
    const targets=rows.map(row=>({playerId:row.player_id,memberKeyBefore:operationType==="ADMIN_SYNC"?row.member_key_before!:null,acquisitionSequence:String(row.acquisition_sequence),ownedPetTitleId:row.owned_pet_title_id,selected:Number(row.selected_flag)===1}))
      .sort((left,right)=>left.playerId.localeCompare(right.playerId)||(BigInt(left.acquisitionSequence)<BigInt(right.acquisitionSequence)?-1:BigInt(left.acquisitionSequence)>BigInt(right.acquisitionSequence)?1:left.ownedPetTitleId.localeCompare(right.ownedPetTitleId)));
    const fingerprintTargets=operationType==="ADMIN_SYNC"?targets:targets.map(({memberKeyBefore:_,...target})=>target);
    const targetSetFingerprint=fingerprint({targets:fingerprintTargets});
    const projection=operationType==="ADMIN_SYNC"
      ?{operationType,affectedPlayerIds,affectedMemberKeys,affectedPlayerCount:affectedPlayerIds.length,affectedTitleCount:rows.length,targetSetFingerprint}
      :{operationType,affectedPlayerIds,affectedPlayerCount:affectedPlayerIds.length,affectedTitleCount:rows.length,targetSetFingerprint};
    const resultFingerprint=fingerprint(projection);
    const operationId=await this.insertBatchReceipt(database,claim,actor,projection,resultFingerprint,counts,targets);
    return {operationId,resultFingerprint,replayedDomainState:false,operationType,affectedPlayerCount:affectedPlayerIds.length,affectedTitleCount:rows.length,affectedPlayerIds,affectedMemberKeys};
  }

  private async insertBatchReceipt(database:AppWiringMutationParticipant,claim:AppWiringClaim,actor:string,projection:{operationType:"ADMIN_SYNC"|"ADMIN_RESET";affectedPlayerIds:string[];affectedMemberKeys?:string[];affectedPlayerCount:number;affectedTitleCount:number;targetSetFingerprint:string},resultFingerprint:string,counts:Map<string,number>,targets:Array<{playerId:string;memberKeyBefore:string|null;acquisitionSequence:string;ownedPetTitleId:string;selected:boolean}>):Promise<string>{
    const audit=createObjectAuditValues(actor,this.now());
    let operationId:string|undefined;
    for(let attempt=0;attempt<this.maximumAttempts;attempt+=1){
      const candidate=this.generate();assertObjectIdentityCandidate(candidate);
      try{
        const inserted=await database.execute(
          "INSERT INTO canonical_pet_title_batch_operations(pet_title_batch_operation_id,operation_type,result_contract_version,replay_namespace,request_key,payload_fingerprint,affected_player_count,affected_title_count,target_count,target_set_fingerprint,result_fingerprint,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,'COMPLETED',?,?,?,?)",
          [candidate,projection.operationType,projection.operationType==="ADMIN_SYNC"?PET_TITLE_BATCH_MEMBER_KEY_CONTRACT:PET_TITLE_BATCH_RESET_CONTRACT,claim.requestNamespace,claim.requestKey,claim.payloadFingerprint,projection.affectedPlayerCount,projection.affectedTitleCount,targets.length,projection.targetSetFingerprint,resultFingerprint,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME],
        );
        if(inserted.affectedRows!==1n)throw new Error("PET_TITLE_BATCH_RECEIPT_NOT_PERSISTED");
        operationId=candidate;break;
      }catch(error){if(!primaryDuplicate(error))throw error;}
    }
    if(operationId===undefined)throw new Error("OBJECT_IDENTITY_GENERATION_EXHAUSTED");
    for(const target of targets){
      let inserted=false;
      for(let attempt=0;attempt<this.maximumAttempts;attempt+=1){
        const candidate=this.generate();assertObjectIdentityCandidate(candidate);
        try{
          const result=await database.execute("INSERT INTO canonical_pet_title_batch_operation_targets(pet_title_batch_operation_target_id,pet_title_batch_operation_id,player_id,member_key_before,owned_pet_title_id,acquisition_sequence,ownership_status_before,selection_status_before,ownership_status_after,action_type,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'owned',?,'removed','SOFT_REMOVE',?,?,?,?,?)",[candidate,operationId,target.playerId,target.memberKeyBefore,target.ownedPetTitleId,target.acquisitionSequence,target.selected?"SELECTED":"NOT_SELECTED",projection.operationType,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
          if(result.affectedRows!==1n)throw new Error("PET_TITLE_BATCH_TARGET_NOT_PERSISTED");inserted=true;break;
        }catch(error){if(!primaryDuplicate(error))throw error;}
      }
      if(!inserted)throw new Error("OBJECT_IDENTITY_GENERATION_EXHAUSTED");
    }
    for(const playerId of projection.affectedPlayerIds){
      let inserted=false;
      for(let attempt=0;attempt<this.maximumAttempts;attempt+=1){
        const candidate=this.generate();assertObjectIdentityCandidate(candidate);
        try{
          const result=await database.execute("INSERT INTO canonical_pet_title_batch_operation_participants(pet_title_batch_operation_participant_id,pet_title_batch_operation_id,player_id,participant_role,affected_title_count,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'AFFECTED_OWNER',?,?,?,?,?)",[candidate,operationId,playerId,counts.get(playerId)!,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
          if(result.affectedRows!==1n)throw new Error("PET_TITLE_BATCH_PARTICIPANT_NOT_PERSISTED");inserted=true;break;
        }catch(error){if(!primaryDuplicate(error))throw error;}
      }
      if(!inserted)throw new Error("OBJECT_IDENTITY_GENERATION_EXHAUSTED");
    }
    return operationId;
  }
}
