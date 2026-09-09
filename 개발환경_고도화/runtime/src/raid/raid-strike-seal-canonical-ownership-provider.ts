import { createHash } from "node:crypto";
import type { CurrentTransactionDatabaseClient, DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../database.js";
import { assertItem25CanonicalDefinitionOptions } from "../data-migration/item25-canonical-definition-provider.js";
import { assertObjectIdentityCandidate } from "../identity/object-identity-audit-provider.js";
import { CanonicalItemInventoryRepository } from "../inventory/canonical-item-inventory-repository.js";

export const RAID_STRIKE_SEAL_SOURCE_POINTER = "/raidSpecialItem/dept2/item_0";
export const RAID_STRIKE_SEAL_SOURCE_LOCATOR = "064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf";
export const RAID_STRIKE_SEAL_SOURCE_PAYLOAD = "77cb001679d3e915622e91a872848c4c53b388479d4c88ca68760361e18c6ee9";
const IDENTITY_NAMESPACE = "object-import.item.canonical_item_definitions";
const LEGACY_INPUT_CODE = "ITEM-RWD-043";

type DefinitionRow = { item_id:string;definition_options:string|Record<string,unknown>;source_identifier:string;payload_fingerprint:string|null };
type PlayerRow = { player_id:string };
type BalanceRow = { quantity:bigint|string };
type CharmRow = { legacy_player_id:bigint|string;canonical_player_id:string;quantity:bigint|string };

function scoped(transaction:DatabaseTransaction):DatabaseClient&CurrentTransactionDatabaseClient{return{
  ping:async()=>undefined,verifyRollback:async()=>true,
  query:<T>(sql:string,values:readonly unknown[]=[])=>transaction.query<T>(sql,values),
  execute:(sql:string,values:readonly unknown[]=[])=>transaction.execute(sql,values),
  withTransaction:<T>(work:(current:DatabaseTransaction)=>Promise<T>)=>work(transaction),withCurrentTransaction:<T>(work:(current:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined
};}

function exactDefinition(row:DefinitionRow|undefined):{itemId:string;raidCharmPerItem:600n}{
  if(row===undefined||row.source_identifier!==RAID_STRIKE_SEAL_SOURCE_LOCATOR||row.payload_fingerprint!==RAID_STRIKE_SEAL_SOURCE_PAYLOAD)throw new Error("RAID_STRIKE_SEAL_CANONICAL_DEFINITION_REQUIRED");
  try{assertObjectIdentityCandidate(row.item_id);}catch{throw new Error("RAID_STRIKE_SEAL_CANONICAL_DEFINITION_REQUIRED");}
  let options:unknown;try{options=typeof row.definition_options==="string"?JSON.parse(row.definition_options):row.definition_options;}catch{throw new Error("RAID_STRIKE_SEAL_CANONICAL_OPTIONS_DRIFT");}
  try{assertItem25CanonicalDefinitionOptions(RAID_STRIKE_SEAL_SOURCE_POINTER,options);}catch{throw new Error("RAID_STRIKE_SEAL_CANONICAL_OPTIONS_DRIFT");}
  return{itemId:row.item_id,raidCharmPerItem:600n};
}

export class RaidStrikeSealCanonicalOwnershipProvider{
  isLegacyCompatibilityInput(value:string):boolean{return value===LEGACY_INPUT_CODE;}

  async resolve(transaction:DatabaseTransaction):Promise<{itemId:string;raidCharmPerItem:600n}>{
    const rows=await transaction.query<DefinitionRow[]>(`SELECT definition.item_id,CAST(definition.definition_options AS CHAR) definition_options,
      crosswalk.source_identifier,crosswalk.payload_fingerprint FROM canonical_item_definition_imports import_row
      JOIN canonical_item_definitions definition ON definition.item_id=import_row.item_id
      JOIN object_identity_crosswalks crosswalk ON crosswalk.object_identity_id=definition.item_id
       AND crosswalk.source_system='LEGACY_JSON' AND crosswalk.source_namespace=? AND crosswalk.source_identifier=?
      WHERE import_row.source_system='LEGACY_JSON' AND import_row.source_namespace='itemInfo.json'
       AND import_row.source_identifier=? AND definition.active_flag=TRUE AND definition.stackable_flag=TRUE FOR UPDATE`,
      [IDENTITY_NAMESPACE,RAID_STRIKE_SEAL_SOURCE_LOCATOR,RAID_STRIKE_SEAL_SOURCE_POINTER]);
    if(rows.length!==1)throw new Error("RAID_STRIKE_SEAL_CANONICAL_DEFINITION_AMBIGUOUS");
    return exactDefinition(rows[0]);
  }

  async resolvePlayer(transaction:DatabaseTransaction,legacyPlayerId:string):Promise<string>{
    const rows=await transaction.query<PlayerRow[]>(`SELECT DISTINCT crosswalk.player_id FROM external_identities identity_row
      JOIN canonical_player_identity_crosswalks crosswalk ON crosswalk.provider_code=identity_row.provider_code
       AND crosswalk.external_user_id=identity_row.external_user_id AND crosswalk.crosswalk_status='LINKED'
      JOIN canonical_players player ON player.player_id=crosswalk.player_id
      WHERE identity_row.player_id=? AND identity_row.status='linked' ORDER BY crosswalk.player_id FOR UPDATE`,[legacyPlayerId]);
    if(rows.length!==1)throw new Error("RAID_STRIKE_SEAL_CANONICAL_PLAYER_REQUIRED");
    try{assertObjectIdentityCandidate(rows[0]!.player_id);}catch{throw new Error("RAID_STRIKE_SEAL_CANONICAL_PLAYER_REQUIRED");}
    return rows[0]!.player_id;
  }

  async change(transaction:DatabaseTransaction,input:{actor:string;legacyPlayerId:string;requestKey:string;quantityDelta:bigint;reasonType:string}):Promise<{quantity:bigint;replayed:boolean}>{
    const definition=await this.resolve(transaction),playerId=await this.resolvePlayer(transaction,input.legacyPlayerId);
    return this.changeResolved(transaction,{...input,playerId,itemId:definition.itemId});
  }

  async changeResolved(transaction:DatabaseTransaction,input:{actor:string;playerId:string;itemId:string;requestKey:string;quantityDelta:bigint;reasonType:string}):Promise<{quantity:bigint;replayed:boolean}>{
    try{assertObjectIdentityCandidate(input.playerId);assertObjectIdentityCandidate(input.itemId);}catch{throw new Error("RAID_STRIKE_SEAL_CANONICAL_ID_REQUIRED");}
    const requestKey=`raid-seal:${createHash("sha256").update(input.requestKey).digest("hex")}`;
    return new CanonicalItemInventoryRepository(scoped(transaction)).changeStackQuantity({actor:input.actor,playerId:input.playerId,itemId:input.itemId,requestKey,quantityDelta:input.quantityDelta,reasonType:input.reasonType});
  }

  async balance(transaction:DatabaseTransaction,legacyPlayerId:string):Promise<bigint>{
    const definition=await this.resolve(transaction),playerId=await this.resolvePlayer(transaction,legacyPlayerId);
    const row=(await transaction.query<BalanceRow[]>("SELECT quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=? FOR UPDATE",[playerId,definition.itemId]))[0];
    return BigInt(row?.quantity??0);
  }

  async charmByLegacyPlayer(transaction:DatabaseTransaction):Promise<Map<string,bigint>>{
    const definition=await this.resolve(transaction);
    const rows=await transaction.query<CharmRow[]>(`SELECT identity_row.player_id legacy_player_id,stack.player_id canonical_player_id,stack.quantity FROM canonical_owned_item_stacks stack
      JOIN canonical_player_identity_crosswalks player_crosswalk ON player_crosswalk.player_id=stack.player_id AND player_crosswalk.crosswalk_status='LINKED'
      JOIN external_identities identity_row ON identity_row.provider_code=player_crosswalk.provider_code
       AND identity_row.external_user_id=player_crosswalk.external_user_id AND identity_row.status='linked'
      WHERE stack.item_id=? AND identity_row.player_id IS NOT NULL ORDER BY identity_row.player_id,stack.player_id FOR UPDATE`,[definition.itemId]);
    const result=new Map<string,bigint>();
    const canonicalByLegacy=new Map<string,string>();
    for(const row of rows){const key=BigInt(row.legacy_player_id).toString(),prior=canonicalByLegacy.get(key);if(prior!==undefined&&prior!==row.canonical_player_id)throw new Error("RAID_STRIKE_SEAL_CANONICAL_PLAYER_AMBIGUOUS");canonicalByLegacy.set(key,row.canonical_player_id);result.set(key,BigInt(row.quantity)*definition.raidCharmPerItem);}
    return result;
  }
}

export function asDatabaseTransaction(transaction:{query<T>(sql:string,values?:readonly unknown[]):Promise<T[]>;execute(sql:string,values?:readonly unknown[]):Promise<{affectedRows:bigint;insertId?:string|number|bigint}>}):DatabaseTransaction{return{
  query:<T>(sql:string,values:readonly unknown[]=[])=>transaction.query<unknown>(sql,values) as Promise<T>,
  execute:async(sql:string,values:readonly unknown[]=[])=>{const result=await transaction.execute(sql,values);return{affectedRows:result.affectedRows,insertId:BigInt(result.insertId??0)} as DatabaseWriteResult;}
};}
