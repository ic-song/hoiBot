import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE="GUILD_TERRITORY_OCCUPATION_RESET",SCOPE_CODE="world",CASTLE_STATE_CODE="HOI_CASTLE";
type Lifecycle="READY"|"PENDING_START"|"ACTIVE_OPENING"|"ACTIVE_READY";
export interface GuildTerritoryOccupationResetInput{eventId:string;externalUserId:string;channelId:string;message:string;}
export interface GuildTerritoryOccupationResetResult{
  status:"reset";warId:string;warKey:string;territoryCount:number;activePreserved:boolean;
  lifecycleBefore:Lifecycle;lifecycleAfter:Lifecycle;pendingTransitionsSkipped:number;castleStatePresent:boolean;
  previousWarVersion:string;warVersion:string;data:string;outboxId:string;auditId:string;
}
interface OperatorRow{operator_id:bigint;player_id:bigint;}
interface WarRow{id:bigint;war_key:string;active:number;lifecycle_state:Lifecycle;start_ready:number;pending_start_token:string|null;pending_start_due_at:string|null;opening_token:string|null;opening_due_at:string|null;castle_lord_player_id:bigint|null;castle_earnings:string;castle_defense_count:bigint;version:bigint;}
interface OccupationRow{territory_no:bigint;territory_name:string;owner_guild_id:bigint|null;owner_player_id:bigint|null;version:bigint;}
interface CastleRow{lord_player_id:bigint|null;lord_guild_name:string|null;tax_rate_basis_points:number;earnings:string;defense_count:bigint;version:bigint;}

// 길드영지초기화 exact 명령만 공용 dispatch 후보로 인정합니다.
export function isGuildTerritoryOccupationResetCommand(message:string|undefined):boolean{return message==="/길드영지초기화";}
// 시작 대기만 취소하고 이미 active인 전쟁 lifecycle은 그대로 보존합니다.
export function resolveTerritoryResetLifecycle(active:boolean,lifecycle:Lifecycle):Lifecycle{return !active&&lifecycle==="PENDING_START"?"READY":lifecycle;}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|GuildTerritoryOccupationResetResult):GuildTerritoryOccupationResetResult{return typeof value==="string"?JSON.parse(value) as GuildTerritoryOccupationResetResult:value;}
function serial(value:unknown):string{return JSON.stringify(value,(_key,item)=>typeof item==="bigint"?item.toString():item);}

// 영지 7곳·두 캐슬 projection·시작 대기 상태를 같은 transaction에서 초기화합니다.
export class GuildTerritoryOccupationResetService{
  constructor(private readonly database:DatabaseClient){}
  async handleIris(input:GuildTerritoryOccupationResetInput):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"|"handled_no_reply"}>{
    if(!isGuildTerritoryOccupationResetCommand(input.message))throw new ApplicationError("INVALID_GUILD_TERRITORY_RESET_COMMAND","길드영지초기화 명령 형식이 올바르지 않습니다.",422);
    const rollout=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]))[0];
    if(rollout===undefined||rollout.enabled!==1||rollout.rollout_state==="LEGACY_ONLY")return{status:"legacy_fallback"};
    if(rollout.rollout_state!=="ACTIVE")return{status:"shadow"};
    const result=await this.reset(input);if(result===null)return{status:"handled_no_reply"};return{status:"changed",data:result.data,outboxId:result.outboxId};
  }

  async reset(input:GuildTerritoryOccupationResetInput):Promise<GuildTerritoryOccupationResetResult|null>{
    if(!isGuildTerritoryOccupationResetCommand(input.message))throw new ApplicationError("INVALID_GUILD_TERRITORY_RESET_COMMAND","길드영지초기화 명령 형식이 올바르지 않습니다.",422);
    return withTerritoryResetRetry(()=>this.database.withTransaction(async tx=>{
      const operator=(await tx.query<OperatorRow[]>(`SELECT operator.id operator_id,identity.player_id
        FROM external_identities identity
        JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
        JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
        JOIN guild_territory_occupation_reset_operator_allowlist allowlist ON allowlist.operator_id=operator.id AND allowlist.external_channel_id=? AND allowlist.active=TRUE
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL
        ORDER BY operator.id LIMIT 1 FOR UPDATE`,[input.channelId,input.externalUserId]))[0];
      if(operator===undefined)return null;
      const key=eventKey(input.eventId),scope=`guild.territory.occupation.reset:${SCOPE_CODE}`;
      const prior=(await tx.query<Array<{actor_id:bigint|null;result_json:string|GuildTerritoryOccupationResetResult|null}>>("SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]))[0];
      if(prior?.result_json!==undefined&&prior.result_json!==null){if(prior.actor_id!==operator.operator_id)throw new ApplicationError("GUILD_TERRITORY_RESET_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(prior.result_json);}
      const scopeRow=(await tx.query<Array<{war_id:bigint}>>("SELECT war_id FROM guild_territory_start_scopes WHERE scope_code=? FOR UPDATE",[SCOPE_CODE]))[0];
      if(scopeRow===undefined)throw new ApplicationError("GUILD_TERRITORY_RESET_SCOPE_REQUIRED","초기화할 길드 영지전 범위가 없습니다.",409);
      const war=(await tx.query<WarRow[]>("SELECT id,war_key,active,lifecycle_state,start_ready,pending_start_token,DATE_FORMAT(pending_start_due_at,'%Y-%m-%dT%H:%i:%s.%fZ') pending_start_due_at,opening_token,DATE_FORMAT(opening_due_at,'%Y-%m-%dT%H:%i:%s.%fZ') opening_due_at,castle_lord_player_id,CAST(castle_earnings AS CHAR) castle_earnings,castle_defense_count,version FROM guild_territory_wars WHERE id=? FOR UPDATE",[scopeRow.war_id]))[0];
      if(war===undefined)throw new ApplicationError("GUILD_TERRITORY_WAR_REQUIRED","길드 영지전 상태를 확인할 수 없습니다.",409);
      const occupations=await tx.query<OccupationRow[]>("SELECT territory_no,territory_name,owner_guild_id,owner_player_id,version FROM guild_territory_occupations WHERE war_id=? ORDER BY territory_no FOR UPDATE",[war.id]);
      if(occupations.length!==7||occupations.some((row,index)=>row.territory_no!==BigInt(index+1)))throw new ApplicationError("GUILD_TERRITORY_RESET_OCCUPATIONS_REQUIRED","1~7번 길드 영지 projection이 모두 필요합니다.",409);
      const castle=(await tx.query<CastleRow[]>("SELECT lord_player_id,lord_guild_name,tax_rate_basis_points,CAST(earnings AS CHAR) earnings,defense_count,version FROM castle_state WHERE state_code=? FOR UPDATE",[CASTLE_STATE_CODE]))[0];
      const lifecycleAfter=resolveTerritoryResetLifecycle(war.active===1,war.lifecycle_state),cancelPending=war.active!==1&&war.lifecycle_state==="PENDING_START";
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,operator.operator_id]);
      let pendingTransitionsSkipped=0;
      if(cancelPending){const skipped=await tx.execute("UPDATE guild_territory_scheduled_transitions SET status='SKIPPED',version=version+1,completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE war_id=? AND status='PENDING'",[war.id]);pendingTransitionsSkipped=Number(skipped.affectedRows);}
      await tx.execute("UPDATE guild_territory_occupations SET owner_guild_id=NULL,owner_player_id=NULL,version=version+1 WHERE war_id=?",[war.id]);
      const warWrite=await tx.execute(`UPDATE guild_territory_wars SET castle_lord_player_id=NULL,castle_earnings=0,castle_defense_count=0,
        lifecycle_state=?,start_ready=IF(?,FALSE,start_ready),pending_start_token=NULL,pending_start_due_at=NULL,
        opening_token=IF(?,NULL,opening_token),opening_due_at=IF(?,NULL,opening_due_at),start_operation_id=IF(?,NULL,start_operation_id),version=version+1
        WHERE id=? AND version=?`,[lifecycleAfter,cancelPending,cancelPending,cancelPending,cancelPending,war.id,war.version]);
      if(warWrite.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_RESET_VERSION_CONFLICT","길드 영지전 상태가 먼저 변경되었습니다.",409);
      if(castle!==undefined){const castleWrite=await tx.execute("UPDATE castle_state SET lord_player_id=NULL,lord_guild_name=NULL,earnings=0,defense_count=0,version=version+1 WHERE state_code=? AND version=?",[CASTLE_STATE_CODE,castle.version]);if(castleWrite.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_RESET_CASTLE_CONFLICT","캐슬 상태가 먼저 변경되었습니다.",409);}
      const data="✅ 길드 영지와 캐슬 점령 상태를 초기화했습니다.";
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,COMMAND_CODE,operation.insertId]);
      const resultBase={status:"reset" as const,warId:war.id.toString(),warKey:war.war_key,territoryCount:occupations.length,activePreserved:true,lifecycleBefore:war.lifecycle_state,lifecycleAfter,pendingTransitionsSkipped,castleStatePresent:castle!==undefined,previousWarVersion:war.version.toString(),warVersion:(war.version+1n).toString(),data,outboxId:outbox.insertId.toString()};
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'guild_territory_war',?,'guild.territory.occupation.reset','reset','Iris 길드영지초기화',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.operator_id,war.id,serial({...resultBase,preserved:{active:war.active===1,readyGuilds:true,turns:true,memberships:true},castleTaxPreserved:castle?.tax_rate_basis_points??null})]);
      const result:GuildTerritoryOccupationResetResult={...resultBase,auditId:audit.insertId.toString()};
      await tx.execute("INSERT INTO guild_territory_occupation_reset_runs(request_key,operation_id,operator_id,war_id,territory_count,pending_transitions_skipped,previous_war_json,previous_castle_json,previous_occupations_json,result_json) VALUES (?,?,?,?,?,?,?,?,?,?)",[key,operation.insertId,operator.operator_id,war.id,occupations.length,pendingTransitionsSkipped,serial(war),castle===undefined?null:serial(castle),serial(occupations),serial(result)]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[serial(result),operation.insertId]);return result;
    }));
  }
}

async function withTerritoryResetRetry<T>(work:()=>Promise<T>):Promise<T>{for(let attempt=0;attempt<4;attempt+=1){try{return await work();}catch(error){const value=error as{code?:unknown;errno?:unknown};const retryable=value.code==="ER_LOCK_DEADLOCK"||value.code==="ER_LOCK_WAIT_TIMEOUT"||value.code==="ER_DUP_ENTRY"||value.errno===1213||value.errno===1205||value.errno===1062;if(!retryable||attempt===3)throw error;}}throw new Error("Guild territory occupation reset retry exhausted.");}
