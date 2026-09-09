import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE="ADMIN_TRIAL_TOWER_SEASON_RESET";
const REPLY="시련의탑데이터가 초기화 되었습니다";

export interface TrialTowerSeasonResetResult { status:"changed"; data:string; outboxId:string; auditId:string; resetCount:number; }

// 시즌 초기화 정확 명령만 후보로 허용합니다.
export function isTrialTowerSeasonResetCommand(message:string|undefined):boolean{return message==="/시련의탑시즌초기화";}
// 긴 Iris event ID를 operations 멱등 키 길이에 맞춥니다.
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
// 저장된 JSON 결과를 replay 응답으로 복원합니다.
function stored(value:string|TrialTowerSeasonResetResult):TrialTowerSeasonResetResult{return typeof value==="string"?JSON.parse(value) as TrialTowerSeasonResetResult:value;}

// 기존 진행을 snapshot한 뒤 전체 시즌 진행을 원자적으로 초기화합니다.
export class TrialTowerSeasonResetService {
  constructor(private readonly database:DatabaseClient){}

  async handleIris(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<TrialTowerSeasonResetResult|{status:"shadow"|"legacy_fallback"}>{
    const definitions=await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]);
    const definition=definitions[0],dispatch=new MariaCommandDispatchRepository(this.database);
    if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){
      await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode:COMMAND_CODE,handlerKey:COMMAND_CODE});
      return{status:"legacy_fallback"};
    }
    if(definition.rollout_state==="SHADOW"||definition.rollout_state==="CANARY"){
      await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:COMMAND_CODE,handlerKey:COMMAND_CODE});
      return{status:"shadow"};
    }
    await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode:COMMAND_CODE,handlerKey:COMMAND_CODE});
    const operators=await this.database.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity
      JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
      JOIN admin_operators operator ON operator.id=mapping.operator_id
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        AND operator.status='active' AND operator.display_name='호이 남' LIMIT 1`,[input.externalUserId]);
    if(operators[0]===undefined)throw new ApplicationError("FORBIDDEN","시련의탑 초기화 권한이 없습니다.",403);
    return this.reset({idempotencyKey:input.eventId,sourceEventId:input.eventId,operatorId:operators[0].operator_id.toString(),destinationId:input.channelId});
  }

  async reset(input:{idempotencyKey:string;sourceEventId:string;operatorId:string;destinationId:string}):Promise<TrialTowerSeasonResetResult>{
    return this.database.withTransaction(async transaction=>{
      const scope=`admin.trial_tower.season.reset:${input.operatorId}`,key=eventKey(input.idempotencyKey);
      const prior=await transaction.query<Array<{result_json:string|TrialTowerSeasonResetResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
      if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null)return stored(prior[0].result_json);
      const progress=await transaction.query<Array<{season_key:string;player_id:bigint;floor:bigint;last_win_at:Date|null;version:bigint}>>("SELECT season_key,player_id,floor,last_win_at,version FROM trial_tower_progress ORDER BY season_key,player_id FOR UPDATE");
      const operation=await transaction.execute(`INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,[randomUUID(),scope,key,input.operatorId]);
      for(const row of progress)await transaction.execute("INSERT INTO trial_tower_reset_snapshots(operation_id,season_key,player_id,floor,last_win_at,progress_version) VALUES (?,?,?,?,?,?)",[operation.insertId,row.season_key,row.player_id,row.floor,row.last_win_at,row.version]);
      await transaction.execute("DELETE FROM trial_tower_progress");
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data:REPLY})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'trial_tower_season_reset',?,'completed','progress_reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.sourceEventId,operation.insertId]);
      const audit=await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'trial_tower_season',NULL,'trial_tower.season.reset','success','/시련의탑시즌초기화',?,UTC_TIMESTAMP(3))",[operation.insertId,input.operatorId,JSON.stringify({resetCount:progress.length})]);
      const result:TrialTowerSeasonResetResult={status:"changed",data:REPLY,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString(),resetCount:progress.length};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}
