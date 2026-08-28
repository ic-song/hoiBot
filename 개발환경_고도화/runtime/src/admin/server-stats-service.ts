import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";
import { MariaServerStatsRepository } from "./maria-server-stats-repository.js";
import type { ServerStatCount } from "./server-stats-repository.js";

export type ServerStatsEnvironment="prod"|"dev";
export interface ServerStatsResult {
  status:"counted";
  environment:ServerStatsEnvironment;
  databaseIdentity:string;
  snapshotVersion:string;
  snapshotAt:string;
  activeMemberCount:string;
  rows:Array<{serverCode:string;serverDisplayName:string;activeMemberCount:string}>;
  data:string;
  outboxId:string;
  auditId:string;
}

// 인자나 접미 문구가 없는 정확한 서버 통계 명령만 허용합니다.
export function isServerStatsCommand(message:string|undefined):boolean{return message==="/서버통계";}

// 한국어 서버 표시 순서를 보존하며 빈 결과와 전체 활성 회원 수를 명시합니다.
export function formatServerStats(rows:ServerStatCount[]):string{
  const lines=["📊 서버 통계","━━━━━━━━━━━━"];
  if(rows.length===0)lines.push("활성 서버 회원이 없습니다.");
  else for(const row of rows)lines.push(`${row.serverDisplayName}: ${formatNumber(row.activeMemberCount)}명`);
  const total=rows.reduce((sum,row)=>sum+row.activeMemberCount,0n);
  lines.push("━━━━━━━━━━━━",`전체 활성 회원: ${formatNumber(total)}명`);
  return lines.join("\n");
}

// DB 환경 identity와 한 transaction의 회원 집계를 고정해 감사 가능한 서버 통계 snapshot을 만듭니다.
export class ServerStatsService{
  constructor(private readonly database:DatabaseClient){}

  async handleIris(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<
    {status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"|"handled_no_reply"}
  >{
    const decision=await new CommandDispatcher(new MariaCommandDispatchRepository(this.database),{enabled:true,allowAllCanaries:false,canaryUserIds:new Set()}).resolve({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true});
    if(decision.route==="SHADOW")return{status:"shadow"};
    if(decision.route!=="MODERN")return{status:"legacy_fallback"};
    const result=await this.read({eventId:input.eventId,externalUserId:input.externalUserId,destinationId:input.channelId,environment:"prod",requestText:input.message});
    if(result===null)return{status:"handled_no_reply"};
    return{status:"changed",data:result.data,outboxId:result.outboxId};
  }

  async read(input:{eventId:string;externalUserId:string;destinationId:string;environment:ServerStatsEnvironment;requestText?:string}):Promise<ServerStatsResult|null>{
    const operator=(await this.database.query<Array<{id:bigint}>>(
      `SELECT operator.id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active'
       AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='stats.server.read' AND denied.effect='deny')
       AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='stats.server.read' AND allowed.effect='allow')
         OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='stats.server.read' WHERE operator_role.operator_id=operator.id))
       LIMIT 1`,[input.externalUserId]))[0];
    if(operator===undefined)return null;
    const eventKey=input.eventId.length<=191?input.eventId:`sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    const requestHash=createHash("sha256").update(`${input.environment}\n${input.requestText??"/서버통계"}`).digest("hex");
    return withRetry(()=>this.database.withTransaction(async transaction=>{
      const previous=(await transaction.query<Array<{id:bigint;status:string;result_json:string|ServerStatsResult|null;age_seconds:bigint}>>("SELECT id,status,result_json,TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(3)) age_seconds FROM operations WHERE idempotency_scope='stats.server.read' AND idempotency_key=? FOR UPDATE",[eventKey]))[0];
      if(previous?.status==="completed"&&previous.result_json!==null){
        const execution=(await transaction.query<Array<{request_sha256:string}>>("SELECT request_sha256 FROM admin_server_stat_read_executions WHERE operation_id=?",[previous.id]))[0];
        if(execution===undefined||execution.request_sha256!==requestHash)throw new ApplicationError("SERVER_STATS_REPLAY_MISMATCH","동일 이벤트의 서버 통계 요청 내용이 다릅니다.",409);
        return parseResult(previous.result_json);
      }
      if(previous?.status==="processing"&&BigInt(previous.age_seconds)<300n)throw new ApplicationError("SERVER_STATS_IN_PROGRESS","같은 서버 통계 요청을 처리 중입니다.",409);
      const environment=(await transaction.query<Array<{database_identity:string}>>("SELECT database_identity FROM legacy_snapshot_environments WHERE environment_code=? FOR UPDATE",[input.environment]))[0];
      if(environment===undefined)throw new ApplicationError("SERVER_STATS_ENVIRONMENT_MISSING","서버 통계 DB 환경 identity가 없습니다.",409);
      const clock=(await transaction.query<Array<{snapshot_at:string}>>("SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') snapshot_at"))[0]!;
      const rows=await new MariaServerStatsRepository(transaction).listActiveMemberCounts();
      const total=rows.reduce((sum,row)=>sum+row.activeMemberCount,0n),data=formatServerStats(rows);
      const operation=previous===undefined
        ?await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'stats.server.read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),eventKey,operator.id])
        :{insertId:previous.id};
      if(previous!==undefined)await transaction.execute("UPDATE operations SET status='processing',result_json=NULL,created_at=UTC_TIMESTAMP(3),completed_at=NULL WHERE id=?",[previous.id]);
      const snapshot=await transaction.execute("INSERT INTO admin_server_stat_snapshot_sets(environment_code,database_identity,snapshot_at,active_member_count) VALUES (?,?,UTC_TIMESTAMP(3),?)",[input.environment,environment.database_identity,total]);
      for(let index=0;index<rows.length;index+=1){const row=rows[index]!;await transaction.execute("INSERT INTO admin_server_stat_snapshot_rows(snapshot_set_id,server_code,server_display_name,active_member_count,display_order) VALUES (?,?,?,?,?)",[snapshot.insertId,row.serverCode,row.serverDisplayName,row.activeMemberCount,index+1]);}
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_SERVER_STATS',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId]);
      await transaction.execute("INSERT INTO admin_server_stat_read_executions(operation_id,snapshot_set_id,request_sha256,result_sha256) VALUES (?,?,?,?)",[operation.insertId,snapshot.insertId,requestHash,createHash("sha256").update(data).digest("hex")]);
      const audit=await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'server_stat_snapshot',?,'stats.server.read','success','Iris /서버통계',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.id,snapshot.insertId,JSON.stringify({readOnly:true,environment:input.environment,databaseIdentity:environment.database_identity,snapshotVersion:snapshot.insertId.toString(),activeMemberCount:total.toString(),serverCount:rows.length})]);
      const result:ServerStatsResult={status:"counted",environment:input.environment,databaseIdentity:environment.database_identity,snapshotVersion:snapshot.insertId.toString(),snapshotAt:clock.snapshot_at,activeMemberCount:total.toString(),rows:rows.map(row=>({serverCode:row.serverCode,serverDisplayName:row.serverDisplayName,activeMemberCount:row.activeMemberCount.toString()})),data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    }));
  }
}

function formatNumber(value:bigint):string{return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function parseResult(value:string|ServerStatsResult):ServerStatsResult{return typeof value==="string"?JSON.parse(value) as ServerStatsResult:value;}
async function withRetry<T>(work:()=>Promise<T>):Promise<T>{for(let attempt=0;attempt<3;attempt+=1){try{return await work();}catch(error){const e=error as{code?:unknown;errno?:unknown};if(attempt===2||(e.code!=="ER_LOCK_DEADLOCK"&&e.errno!==1213&&e.code!=="ER_DUP_ENTRY"&&e.errno!==1062))throw error;}}throw new Error("Server stats retry exhausted.");}
