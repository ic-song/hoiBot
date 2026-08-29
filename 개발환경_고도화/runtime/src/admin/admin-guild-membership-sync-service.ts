import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE="ADMIN_GUILD_MEMBERSHIP_SYNC";
type PlayerRow={id:bigint;status:string};
type GuildRow={id:bigint;display_name:string;status:string;version:bigint};
type MembershipRow={guild_id:bigint;player_id:bigint;role_code:string;joined_at:Date|null};
export interface AdminGuildMembershipSyncResult{status:"silent"|"synced";runId?:string;sourceHash?:string;playerCount:number;membershipCount:number;assignedCount:number;unassignedCount:number;missingProfileCount:number;changedCount:number;sourceReused:boolean;data?:string;outboxId?:string}

// 길드 소속 동기화는 접미·인자 없는 exact 운영 명령만 허용합니다.
export function isAdminGuildMembershipSyncCommand(message:string|undefined):boolean{return message==="/길드데이터동기화";}
function key(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|AdminGuildMembershipSyncResult):AdminGuildMembershipSyncResult{return typeof value==="string"?JSON.parse(value)as AdminGuildMembershipSyncResult:value;}
function sourceHash(players:PlayerRow[],guilds:GuildRow[],memberships:MembershipRow[],profiles:bigint[]):string{return createHash("sha256").update(JSON.stringify({players:players.map(r=>[r.id.toString(),r.status]),guilds:guilds.map(r=>[r.id.toString(),r.status,r.version.toString()]),memberships:memberships.map(r=>[r.guild_id.toString(),r.player_id.toString(),r.role_code,r.joined_at?.toISOString()??null]),profiles:profiles.map(String)})).digest("hex");}
// 동기화 결과를 운영자가 한눈에 대사할 수 있는 고정 순서로 표시합니다.
export function formatAdminGuildMembershipSyncResult(value:Omit<AdminGuildMembershipSyncResult,"status"|"data"|"outboxId">):string{return `길드데이터 동기화완료\n전체 회원: ${value.playerCount}\n길드 소속: ${value.assignedCount}\n미소속: ${value.unassignedCount}\n변경: ${value.changedCount}\n프로필 누락: ${value.missingProfileCount}`;}

// 권위 guild_members snapshot과 전 회원 projection을 ordered lock·hash·delta run으로 원자 대사합니다.
export class AdminGuildMembershipSyncService{
 constructor(private readonly database:DatabaseClient){}
 async handleIris(input:{eventId:string;externalUserId:string;channelId:string;message:string}):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"}>{
  const rows=await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]),definition=rows[0],dispatch=new MariaCommandDispatchRepository(this.database);
  if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode:COMMAND_CODE,handlerKey:"admin_guild_membership_sync"});return{status:"legacy_fallback"};}
  if(definition.rollout_state==="SHADOW"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:COMMAND_CODE,handlerKey:"admin_guild_membership_sync"});return{status:"shadow"};}
  const result=await this.handle({eventId:input.eventId,externalUserId:input.externalUserId,destinationId:input.channelId,message:input.message});
  return result.status==="synced"?{status:"changed",data:result.data!,outboxId:result.outboxId!}:{status:"legacy_fallback"};
 }
 async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<AdminGuildMembershipSyncResult>{
  if(!isAdminGuildMembershipSyncCommand(input.message))throw new Error("INVALID_ADMIN_GUILD_MEMBERSHIP_SYNC_COMMAND");
  return this.database.withTransaction(async tx=>{
   const operators=await tx.query<Array<{operator_id:bigint}>>(`SELECT operator.id operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE AND role.code IN ('administrator','manager','super_admin') JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='guild.membership.reconcile' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`,[input.externalUserId]);
   const operator=operators[0];if(operator===undefined)return{status:"silent",playerCount:0,membershipCount:0,assignedCount:0,unassignedCount:0,missingProfileCount:0,changedCount:0,sourceReused:false};
   const scope=`admin.guild-membership.sync:${operator.operator_id}`,eventKey=key(input.eventId);
   const operation=await tx.execute("INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,eventKey,operator.operator_id]);
   if(operation.affectedRows===0n){const prior=await tx.query<Array<{result_json:string|AdminGuildMembershipSyncResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,eventKey]);if(prior[0]?.result_json!=null)return stored(prior[0].result_json);throw new Error("GUILD_MEMBERSHIP_SYNC_IN_PROGRESS");}
   const players=await tx.query<PlayerRow[]>("SELECT id,status FROM players ORDER BY id FOR UPDATE");
   const guilds=await tx.query<GuildRow[]>("SELECT id,display_name,status,version FROM guilds ORDER BY id FOR UPDATE");
   const memberships=await tx.query<MembershipRow[]>("SELECT guild_id,player_id,role_code,joined_at FROM guild_members ORDER BY guild_id,player_id FOR UPDATE");
   const profileRows=await tx.query<Array<{player_id:bigint}>>("SELECT player_id FROM player_profiles ORDER BY player_id FOR UPDATE"),profiles=profileRows.map(r=>r.player_id);
   const hash=sourceHash(players,guilds,memberships,profiles),profileSet=new Set(profiles.map(String)),membershipByPlayer=new Map(memberships.map(r=>[r.player_id.toString(),r.guild_id]));
   const assignedCount=membershipByPlayer.size,missingProfileCount=players.filter(r=>!profileSet.has(r.id.toString())).length;
   const existingRuns=await tx.query<Array<{id:bigint;player_count:number;membership_count:number;assigned_count:number;unassigned_count:number;missing_profile_count:number;changed_count:number}>>("SELECT id,player_count,membership_count,assigned_count,unassigned_count,missing_profile_count,changed_count FROM guild_membership_reconciliation_runs WHERE source_hash=? FOR UPDATE",[hash]);
   let runId:bigint,changedCount=0,sourceReused=false;
   if(existingRuns[0]!==undefined){runId=existingRuns[0].id;sourceReused=true;}
   else{
    const projections=await tx.query<Array<{player_id:bigint;guild_id:bigint|null;version:bigint}>>("SELECT player_id,guild_id,version FROM guild_membership_projections ORDER BY player_id FOR UPDATE"),byPlayer=new Map(projections.map(r=>[r.player_id.toString(),r]));
    const run=await tx.execute("INSERT INTO guild_membership_reconciliation_runs(operation_id,source_hash,player_count,membership_count,assigned_count,unassigned_count,missing_profile_count,changed_count) VALUES (?,?,?,?,?,?,?,0)",[operation.insertId,hash,players.length,memberships.length,assignedCount,players.length-assignedCount,missingProfileCount]);runId=run.insertId;
    for(const player of players){const expected=membershipByPlayer.get(player.id.toString())??null,current=byPlayer.get(player.id.toString()),before=current?.guild_id??null,changed=current===undefined||String(before)!==String(expected);await tx.execute("INSERT INTO guild_membership_reconciliation_snapshots(run_id,player_id,guild_id,profile_missing) VALUES (?,?,?,?)",[runId,player.id,expected,!profileSet.has(player.id.toString())]);if(changed){changedCount++;await tx.execute("INSERT INTO guild_membership_reconciliation_deltas(run_id,player_id,before_guild_id,after_guild_id,change_type) VALUES (?,?,?,?,?)",[runId,player.id,before,expected,current===undefined?"created":expected===null?"cleared":before===null?"assigned":"moved"]);await tx.execute("INSERT INTO guild_membership_projections(player_id,guild_id,source_run_id,version,updated_at) VALUES (?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE guild_id=VALUES(guild_id),source_run_id=VALUES(source_run_id),version=version+1,updated_at=UTC_TIMESTAMP(3)",[player.id,expected,runId]);}}
    await tx.execute("UPDATE guild_membership_reconciliation_runs SET changed_count=? WHERE id=?",[changedCount,runId]);
   }
   const summary={runId:runId.toString(),sourceHash:hash,playerCount:players.length,membershipCount:memberships.length,assignedCount,unassignedCount:players.length-assignedCount,missingProfileCount,changedCount,sourceReused},data=formatAdminGuildMembershipSyncResult(summary),outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);
   await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','synced',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,COMMAND_CODE,operation.insertId]);
   await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'guild_membership',NULL,'guild.membership.reconcile','success','Iris /길드데이터동기화',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.operator_id,JSON.stringify(summary)]);
   const result:AdminGuildMembershipSyncResult={status:"synced",...summary,data,outboxId:outbox.insertId.toString()};await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
  });
 }
}
