import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { PassSemanticCode } from "./pass-code-resolver.js";
import type { PassCanonicalOwnershipRepository, PassEntitlementKind, PassOwnershipState, PassOwnershipStatus } from "./pass-canonical-ownership-repository.js";

export interface PassOwnershipMutation{playerId:bigint;semanticCode:PassSemanticCode;action:"grant"|"remove";entitlementKind:PassEntitlementKind;endDate:string|null;expectedVersion:bigint|null;idempotencyKey:string;}
export interface PassOwnershipMutationResult{playerId:string;semanticCode:PassSemanticCode;action:"grant"|"remove";changed:boolean;status:PassOwnershipStatus|null;entitlementKind:PassEntitlementKind|null;endDate:string|null;version:string|null;replayed:boolean;}
const SCOPE="support.pass.canonical.ownership";
const stableKey=(value:string)=>value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;
const parseStored=(value:string|PassOwnershipMutationResult)=>typeof value==="string"?JSON.parse(value) as PassOwnershipMutationResult:value;

// canonical ownership mutation과 compatibility projection을 한 transaction에서 수렴시킵니다.
export class PassCanonicalOwnershipProvider{
 constructor(private readonly database:DatabaseClient,private readonly repository:PassCanonicalOwnershipRepository){}
 async read(playerId:bigint,semanticCode:PassSemanticCode):Promise<PassOwnershipState|null>{return this.database.withTransaction(async tx=>(await this.repository.readCanonical(tx,playerId,semanticCode,false))??this.repository.readCompatibility(tx,playerId,semanticCode,false));}
 async mutate(input:PassOwnershipMutation):Promise<PassOwnershipMutationResult>{return this.database.withTransaction(async tx=>{
  const idempotencyKey=stableKey(input.idempotencyKey);const prior=(await tx.query<Array<{result_json:string|PassOwnershipMutationResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[SCOPE,idempotencyKey]))[0];
  if(prior?.result_json!=null)return{...parseStored(prior.result_json),replayed:true};
  if(prior)throw new ApplicationError("PASS_OWNERSHIP_OPERATION_IN_PROGRESS","패스 소유권 작업이 진행 중입니다.",409);
  const operationId=(await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'system',NULL,'pass_convergence','processing',UTC_TIMESTAMP(3))",[randomUUID(),SCOPE,idempotencyKey])).insertId;
  const canonical=await this.repository.readCanonical(tx,input.playerId,input.semanticCode,true);const compatibility=await this.repository.readCompatibility(tx,input.playerId,input.semanticCode,true);const before=canonical??compatibility;
  if(input.expectedVersion!==null&&(before?.version??0n)!==input.expectedVersion)throw new ApplicationError("PASS_OWNERSHIP_VERSION_CONFLICT","패스 소유권 버전이 변경되었습니다.",409);
  const targetKind=input.endDate===null?"permanent":input.entitlementKind;const targetEnd=targetKind==="permanent"?null:input.endDate;let changed=false;let canonicalId=canonical?.id??null;
  if(input.action==="grant"){
   changed=before?.status!=="active"||before.entitlementKind!==targetKind||before.endDate!==targetEnd||before.source!=="CANONICAL";
   if(changed){const write={playerId:input.playerId,semanticCode:input.semanticCode,entitlementKind:targetKind,endDate:targetEnd,status:"active" as const,operationId};if(canonical?.id===null||canonical===null)canonicalId=await this.repository.insertCanonical(tx,write);else if(!await this.repository.updateCanonical(tx,canonical.id,canonical.version,write))throw new ApplicationError("PASS_OWNERSHIP_VERSION_CONFLICT","패스 소유권 버전이 변경되었습니다.",409);await this.repository.writeCompatibility(tx,write);}
  }else if(before?.status==="active"||before?.status==="expired"){
   changed=true;const write={playerId:input.playerId,semanticCode:input.semanticCode,entitlementKind:before.entitlementKind,endDate:before.endDate,status:"revoked" as const,operationId};if(canonical?.id===null||canonical===null)canonicalId=await this.repository.insertCanonical(tx,write);else if(!await this.repository.updateCanonical(tx,canonical.id,canonical.version,write))throw new ApplicationError("PASS_OWNERSHIP_VERSION_CONFLICT","패스 소유권 버전이 변경되었습니다.",409);await this.repository.writeCompatibility(tx,write);
  }
  const after=await this.repository.readCanonical(tx,input.playerId,input.semanticCode,false);
  await this.writeEvidence(tx,operationId,canonicalId,input,before,after,changed);
  const result:PassOwnershipMutationResult={playerId:input.playerId.toString(),semanticCode:input.semanticCode,action:input.action,changed,status:after?.status??before?.status??null,entitlementKind:after?.entitlementKind??before?.entitlementKind??null,endDate:after?.endDate??before?.endDate??null,version:after?.version.toString()??null,replayed:false};
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operationId]);return result;
 });}
 private async writeEvidence(tx:DatabaseTransaction,operationId:bigint,passId:bigint|null,input:PassOwnershipMutation,before:PassOwnershipState|null,after:PassOwnershipState|null,changed:boolean):Promise<void>{await tx.execute(`INSERT INTO support_pass_change_events(operation_id,pass_id,player_id,pass_code,action_code,previous_status,previous_kind,previous_end_date,next_status,next_kind,next_end_date,changed,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[operationId,passId,input.playerId,input.semanticCode,input.action==="grant"?"add":"delete",before?.status??null,before?.entitlementKind??null,before?.endDate??null,after?.status??before?.status??"missing",after?.entitlementKind??before?.entitlementKind??null,after?.endDate??before?.endDate??null,changed]);}
}
