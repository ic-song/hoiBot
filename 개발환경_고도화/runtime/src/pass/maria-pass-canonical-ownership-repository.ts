import type { DatabaseTransaction } from "../database.js";
import { PASS_CODE_MAPPINGS, type PassSemanticCode } from "./pass-code-resolver.js";
import type {
  CanonicalPassWrite,
  PassCanonicalOwnershipRepository,
  PassEntitlementKind,
  PassOwnershipState,
  PassOwnershipStatus
} from "./pass-canonical-ownership-repository.js";

type CanonicalRow={id:bigint;player_id:bigint;pass_code:PassSemanticCode;entitlement_kind:PassEntitlementKind;end_date:Date|string|null;status:PassOwnershipStatus;version:bigint};
type CompatibilityRow={player_id:bigint;enabled:number|boolean;permanent:number|boolean;ends_at:Date|string|null;expired:number|bigint};
const dateText=(value:Date|string|null):string|null=>value===null?null:value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const compatibilityCode=(semanticCode:PassSemanticCode):string|null=>PASS_CODE_MAPPINGS.find(row=>row.semanticCode===semanticCode)?.compatibilityCode??null;

// canonical entitlement와 보존된 compatibility projection을 typed identity로 읽고 씁니다.
export class MariaPassCanonicalOwnershipRepository implements PassCanonicalOwnershipRepository{
 async readCanonical(transaction:DatabaseTransaction,playerId:bigint,semanticCode:PassSemanticCode,lock:boolean):Promise<PassOwnershipState|null>{
  const rows=await transaction.query<CanonicalRow[]>(`SELECT id,player_id,pass_code,entitlement_kind,end_date,status,version FROM player_support_passes WHERE player_id=? AND pass_code=?${lock?" FOR UPDATE":""}`,[playerId,semanticCode]);
  const row=rows[0];return row?{id:row.id,playerId:row.player_id,semanticCode:row.pass_code,entitlementKind:row.entitlement_kind,endDate:dateText(row.end_date),status:row.status,version:row.version,source:"CANONICAL"}:null;
 }
 async readCompatibility(transaction:DatabaseTransaction,playerId:bigint,semanticCode:PassSemanticCode,lock:boolean):Promise<PassOwnershipState|null>{
  const code=compatibilityCode(semanticCode);if(code===null)return null;
  const rows=await transaction.query<CompatibilityRow[]>(`SELECT player_id,enabled,permanent,ends_at,(permanent=FALSE AND ends_at IS NOT NULL AND DATE(ends_at)<UTC_DATE()) expired FROM player_passes WHERE player_id=? AND pass_code=?${lock?" FOR UPDATE":""}`,[playerId,code]);
  const row=rows[0];if(!row)return null;const permanent=Boolean(row.permanent)||row.ends_at===null;
  return{id:null,playerId:row.player_id,semanticCode,entitlementKind:permanent?"permanent":"dated",endDate:permanent?null:dateText(row.ends_at),status:!Boolean(row.enabled)?"revoked":Boolean(row.expired)?"expired":"active",version:0n,source:"COMPATIBILITY"};
 }
 async insertCanonical(transaction:DatabaseTransaction,write:CanonicalPassWrite):Promise<bigint>{const result=await transaction.execute(`INSERT INTO player_support_passes(player_id,pass_code,entitlement_kind,end_date,status,version,created_operation_id,updated_operation_id,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[write.playerId,write.semanticCode,write.entitlementKind,write.endDate,write.status,write.operationId,write.operationId]);return result.insertId;}
 async updateCanonical(transaction:DatabaseTransaction,id:bigint,expectedVersion:bigint,write:CanonicalPassWrite):Promise<boolean>{const result=await transaction.execute(`UPDATE player_support_passes SET entitlement_kind=?,end_date=?,status=?,version=version+1,updated_operation_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND version=?`,[write.entitlementKind,write.endDate,write.status,write.operationId,id,expectedVersion]);return result.affectedRows===1n;}
 async writeCompatibility(transaction:DatabaseTransaction,write:CanonicalPassWrite):Promise<void>{const code=compatibilityCode(write.semanticCode);if(code===null)return;const enabled=write.status==="active",permanent=write.entitlementKind==="permanent";await transaction.execute(`INSERT INTO player_passes(player_id,pass_code,enabled,permanent,starts_at,ends_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3),?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),permanent=VALUES(permanent),ends_at=VALUES(ends_at)`,[write.playerId,code,enabled,permanent,permanent?null:write.endDate]);}
}
