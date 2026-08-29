import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface GuildTerritoryWarReadyInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface GuildTerritoryWarReadyResult {
  status: "prepared" | "already_ready";
  warId: string; guildId: string; guildName: string;
  preparedByPlayerId: string; preparedByName: string; preparedAt: string;
  eligibleAttackerPlayerIds: string[];
  previousGuildVersion: string; guildVersion: string; previousWarVersion: string; warVersion: string;
  data: string; outboxId: string; auditId: string;
}
interface ActorRow { player_id: bigint; display_name: string; guild_id: bigint | null; role_code: string | null; }
interface GuildRow { id: bigint; display_name: string; version: bigint; }
interface WarRow { id: bigint; lifecycle_state: "READY" | "PENDING_START"; version: bigint; }
interface ReadyRow { ready: number; prepared_by_player_id: bigint | null; prepared_by_display_name: string | null; prepared_at: string | null; version: bigint; }
interface AttackerRow { player_id: bigint; authority_code: "sword_master" | "combat_commander"; role_code: string; display_name: string; }

// 길드영지준비 exact 명령만 공용 dispatch 후보로 인정합니다.
export function isGuildTerritoryWarReadyCommand(message: string | undefined): boolean { return message === "/길드영지준비"; }
// DB 역할 코드를 현재 길드 역할 계약으로 정규화합니다.
export function normalizeGuildTerritoryRole(roleCode: string): string { const value=roleCode.toLowerCase(); return value==="submaster"?"sub_master":value==="leader"?"master":value; }
// 소드마스터와 현재 길드마스터의 전투형 지휘관만 공격 자격으로 인정합니다.
export function isEligibleGuildTerritoryAttacker(authorityCode: string, roleCode: string): boolean { return authorityCode==="sword_master"||(authorityCode==="combat_commander"&&normalizeGuildTerritoryRole(roleCode)==="master"); }
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|GuildTerritoryWarReadyResult):GuildTerritoryWarReadyResult{return typeof value==="string"?JSON.parse(value) as GuildTerritoryWarReadyResult:value;}

// 길드·전쟁·준비 row를 같은 transaction에서 잠가 회차별 준비를 원자 처리합니다.
export class GuildTerritoryWarReadyService {
  constructor(private readonly database:DatabaseClient){}
  async handleIris(input:GuildTerritoryWarReadyInput):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"}>{
    if(!isGuildTerritoryWarReadyCommand(input.message))throw new ApplicationError("INVALID_GUILD_TERRITORY_READY_COMMAND","길드영지준비 명령 형식이 올바르지 않습니다.",422);
    const rollout=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='GUILD_TERRITORY_WAR_READY' LIMIT 1"))[0];
    if(rollout===undefined||rollout.enabled!==1||rollout.rollout_state==="LEGACY_ONLY")return{status:"legacy_fallback"};
    if(rollout.rollout_state!=="ACTIVE")return{status:"shadow"};
    const result=await this.prepare(input);return{status:"changed",data:result.data,outboxId:result.outboxId};
  }
  async prepare(input:GuildTerritoryWarReadyInput):Promise<GuildTerritoryWarReadyResult>{
    if(!isGuildTerritoryWarReadyCommand(input.message))throw new ApplicationError("INVALID_GUILD_TERRITORY_READY_COMMAND","길드영지준비 명령 형식이 올바르지 않습니다.",422);
    return withGuildTerritoryReadyRetry(()=>this.database.withTransaction(async(tx)=>{
      const actor=(await tx.query<ActorRow[]>(`SELECT identity.player_id,profile.current_display_name display_name,membership.guild_id,membership.role_code FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN guild_members membership ON membership.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1 FOR UPDATE`,[input.externalUserId]))[0];
      if(actor===undefined)throw new ApplicationError("VERIFIED_PLAYER_REQUIRED","❌ 인증된 유저를 찾을 수 없습니다.",404);
      if(actor.guild_id===null||actor.role_code===null)throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED","❌ 가입한 길드가 없습니다.",404);
      const actorRole=normalizeGuildTerritoryRole(actor.role_code);
      if(actorRole!=="master"&&actorRole!=="sub_master")throw new ApplicationError("GUILD_TERRITORY_READY_PERMISSION_REQUIRED","❌ 길드마스터 또는 부길드마스터만 준비할 수 있습니다.",403);
      const guild=(await tx.query<GuildRow[]>("SELECT id,display_name,version FROM guilds WHERE id=? AND status='active' LIMIT 1 FOR UPDATE",[actor.guild_id]))[0];
      if(guild===undefined)throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED","❌ 가입한 길드를 확인할 수 없습니다.",404);
      const key=eventKey(input.eventId);
      const prior=(await tx.query<Array<{actor_id:bigint|null;result_json:string|GuildTerritoryWarReadyResult|null}>>("SELECT actor_id,result_json FROM operations WHERE idempotency_scope='guild.territory.war_ready' AND idempotency_key=? FOR UPDATE",[key]))[0];
      if(prior?.result_json!==undefined&&prior.result_json!==null){if(prior.actor_id!==actor.player_id)throw new ApplicationError("GUILD_TERRITORY_READY_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(prior.result_json);}
      const activeWars=await tx.query<Array<{id:bigint}>>("SELECT id FROM guild_territory_wars WHERE active=TRUE OR lifecycle_state IN ('ACTIVE_OPENING','ACTIVE_READY') ORDER BY id DESC LIMIT 2 FOR UPDATE");
      if(activeWars.length>0)throw new ApplicationError("GUILD_TERRITORY_WAR_ACTIVE","현재 길드 영지전이 진행 중입니다.",409);
      const targets=await tx.query<WarRow[]>("SELECT id,lifecycle_state,version FROM guild_territory_wars WHERE lifecycle_state IN ('READY','PENDING_START') ORDER BY id DESC LIMIT 2 FOR UPDATE");
      if(targets.length===0)throw new ApplicationError("GUILD_TERRITORY_WAR_UNAVAILABLE","준비할 다음 길드 영지전이 없습니다.",409);
      const war=targets[0]!;
      const existing=(await tx.query<ReadyRow[]>(`SELECT ready,prepared_by_player_id,prepared_by_display_name,DATE_FORMAT(prepared_at,'%Y-%m-%dT%H:%i:%s.%fZ') prepared_at,version FROM guild_territory_ready_guilds WHERE war_id=? AND guild_id=? FOR UPDATE`,[war.id,guild.id]))[0];
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.territory.war_ready',?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,actor.player_id]);
      const complete=async(result:Omit<GuildTerritoryWarReadyResult,"outboxId"|"auditId">):Promise<GuildTerritoryWarReadyResult>=>{
        const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({data:result.data})]);
        await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_TERRITORY_WAR_READY',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId,result.status]);
        const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.territory.war.ready',?,'Iris 길드영지 준비',?,UTC_TIMESTAMP(3))",[operation.insertId,actor.player_id,guild.id,result.status,JSON.stringify({warId:result.warId,preparedByPlayerId:result.preparedByPlayerId,preparedAt:result.preparedAt,eligibleAttackerPlayerIds:result.eligibleAttackerPlayerIds,guildVersion:result.guildVersion,warVersion:result.warVersion})]);
        const completed:GuildTerritoryWarReadyResult={...result,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
        await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(completed),operation.insertId]);return completed;
      };
      if(existing?.ready===1){
        return complete({status:"already_ready",warId:war.id.toString(),guildId:guild.id.toString(),guildName:guild.display_name,preparedByPlayerId:existing.prepared_by_player_id?.toString()??actor.player_id.toString(),preparedByName:existing.prepared_by_display_name??actor.display_name,preparedAt:existing.prepared_at??"",eligibleAttackerPlayerIds:[],previousGuildVersion:guild.version.toString(),guildVersion:guild.version.toString(),previousWarVersion:war.version.toString(),warVersion:war.version.toString(),data:`⚠️ [${guild.display_name}] 길드는 이미 다음 길드영지전 준비를 완료했습니다.`});
      }
      const attackers=await tx.query<AttackerRow[]>(`SELECT authorization.player_id,authorization.authority_code,member.role_code,profile.current_display_name display_name FROM guild_territory_rift_authorizations authorization JOIN guild_members member ON member.guild_id=authorization.guild_id AND member.player_id=authorization.player_id JOIN players player ON player.id=member.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id WHERE authorization.guild_id=? AND authorization.active=TRUE AND (authorization.authority_code='sword_master' OR (authorization.authority_code='combat_commander' AND member.role_code IN ('master','leader'))) ORDER BY CASE authorization.authority_code WHEN 'sword_master' THEN 0 ELSE 1 END,authorization.player_id FOR UPDATE`,[guild.id]);
      const eligible=attackers.filter(row=>isEligibleGuildTerritoryAttacker(row.authority_code,row.role_code));
      if(eligible.length===0)throw new ApplicationError("GUILD_TERRITORY_ATTACKER_REQUIRED","❌ 영지전에 참가할 소드마스터 또는 전투형 지휘관 길드마스터가 없습니다.",409);
      const preparedAt=(await tx.query<Array<{value:string}>>("SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') value"))[0]!.value;
      if(existing===undefined)await tx.execute("INSERT INTO guild_territory_ready_guilds(war_id,guild_id,ready,prepared_by_player_id,prepared_by_display_name,prepared_at,prepare_source_code,prepare_operation_id,version) VALUES (?,?,TRUE,?,?,UTC_TIMESTAMP(3),'manual',?,1)",[war.id,guild.id,actor.player_id,actor.display_name,operation.insertId]);
      else{const changed=await tx.execute("UPDATE guild_territory_ready_guilds SET ready=TRUE,prepared_by_player_id=?,prepared_by_display_name=?,prepared_at=UTC_TIMESTAMP(3),prepare_source_code='manual',prepare_operation_id=?,eliminated_reason=NULL,eliminated_at=NULL,version=version+1 WHERE war_id=? AND guild_id=? AND version=? AND ready=FALSE",[actor.player_id,actor.display_name,operation.insertId,war.id,guild.id,existing.version]);if(changed.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_READY_CONFLICT","길드 준비 상태가 먼저 변경되었습니다.",409);}
      const guildWrite=await tx.execute("UPDATE guilds SET version=version+1 WHERE id=? AND version=?",[guild.id,guild.version]);
      const warWrite=await tx.execute("UPDATE guild_territory_wars SET version=version+1 WHERE id=? AND version=?",[war.id,war.version]);
      if(guildWrite.affectedRows!==1n||warWrite.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_READY_VERSION_CONFLICT","길드 또는 전쟁 상태가 먼저 변경되었습니다.",409);
      await tx.execute("INSERT INTO guild_territory_ready_history(operation_id,war_id,guild_id,player_id,source_code,previous_ready,ready,prepared_at) VALUES (?,?,?,?,'manual',?,TRUE,UTC_TIMESTAMP(3))",[operation.insertId,war.id,guild.id,actor.player_id,existing?.ready===1]);
      return complete({status:"prepared",warId:war.id.toString(),guildId:guild.id.toString(),guildName:guild.display_name,preparedByPlayerId:actor.player_id.toString(),preparedByName:actor.display_name,preparedAt,eligibleAttackerPlayerIds:eligible.map(row=>row.player_id.toString()),previousGuildVersion:guild.version.toString(),guildVersion:(guild.version+1n).toString(),previousWarVersion:war.version.toString(),warVersion:(war.version+1n).toString(),data:`✅ [${guild.display_name}] 길드가 다음 길드영지전 준비를 완료했습니다.`});
    }));
  }
}
async function withGuildTerritoryReadyRetry<T>(work:()=>Promise<T>):Promise<T>{for(let attempt=0;attempt<4;attempt+=1){try{return await work();}catch(error){const value=error as{code?:unknown;errno?:unknown};const retryable=value.code==="ER_LOCK_DEADLOCK"||value.code==="ER_LOCK_WAIT_TIMEOUT"||value.code==="ER_DUP_ENTRY"||value.errno===1213||value.errno===1205||value.errno===1062;if(!retryable||attempt===3)throw error;}}throw new Error("Guild territory ready retry exhausted.");}
