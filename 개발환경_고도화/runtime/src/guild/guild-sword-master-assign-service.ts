import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface GuildSwordMasterAssignInput { eventId:string; externalUserId:string; channelId:string; message:string; }
export interface ParsedGuildSwordMasterAssign { memberNumbers:number[]; }
export interface GuildSwordMasterAssignResult {
  status:"assigned"; guildId:string; selectedPlayerIds:string[]; selectedNames:string[];
  previousPlayerIds:string[]; assignmentCapacity:number; reinforcementEnabled:boolean;
  memberOrderHash:string; previousGuildVersion:string; guildVersion:string;
  data:string; outboxId:string; auditId:string;
}
interface MemberRow { player_id:bigint; display_name:string; role_code:string; contribution_value:bigint; joined_at:string|null; }
interface AuthorizationRow { player_id:bigint; active:number; version:bigint; }

// 소드마스터 명령 namespace만 공용 dispatch 후보로 판정합니다.
export function isGuildSwordMasterAssignCandidate(message:string|undefined):boolean {
  return message==="/소드마스터"||(message!==undefined&&message.startsWith("/소드마스터 "));
}

// 세 명 또는 네 명의 중복 없는 양의 회원 번호만 허용합니다.
export function parseGuildSwordMasterAssign(message:string):ParsedGuildSwordMasterAssign {
  if(!isGuildSwordMasterAssignCandidate(message))throw new ApplicationError("INVALID_GUILD_SWORD_MASTER_COMMAND","소드마스터 명령 형식이 올바르지 않습니다.",422);
  const matched=/^\/소드마스터\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/.exec(message);
  if(matched===null)throw new ApplicationError("GUILD_SWORD_MASTER_USAGE","사용법: /소드마스터 번호 번호 번호 [번호]",422);
  const memberNumbers=matched.slice(1).filter((value):value is string=>value!==undefined).map(Number);
  if(memberNumbers.some(value=>!Number.isSafeInteger(value)||value<=0))throw new ApplicationError("GUILD_SWORD_MASTER_RANGE","회원 번호는 1 이상의 정수여야 합니다.",422);
  if(new Set(memberNumbers).size!==memberNumbers.length)throw new ApplicationError("GUILD_SWORD_MASTER_DUPLICATE","같은 회원을 중복 지정할 수 없습니다.",422);
  return {memberNumbers};
}

// 기사단 증원 장착 여부에 따라 소드마스터 정원을 결정합니다.
export function resolveGuildSwordMasterCapacity(reinforcementEnabled:boolean):3|4 { return reinforcementEnabled?4:3; }
function normalizedRole(roleCode:string):string { const value=roleCode.toLowerCase(); return value==="leader"?"master":value==="submaster"?"sub_master":value; }
function eventKey(value:string):string { return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value:string|GuildSwordMasterAssignResult):GuildSwordMasterAssignResult { return typeof value==="string"?JSON.parse(value) as GuildSwordMasterAssignResult:value; }

// 길드·회원·전쟁·펫 스킬·권한 projection을 잠가 소드마스터 집합을 원자 교체합니다.
export class GuildSwordMasterAssignService {
  constructor(private readonly database:DatabaseClient){}

  async handleIris(input:GuildSwordMasterAssignInput):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"}>{
    parseGuildSwordMasterAssign(input.message);
    const rollout=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='GUILD_SWORD_MASTER_ASSIGN' LIMIT 1"))[0];
    if(rollout===undefined||rollout.enabled!==1||rollout.rollout_state==="LEGACY_ONLY")return {status:"legacy_fallback"};
    if(rollout.rollout_state!=="ACTIVE")return {status:"shadow"};
    const result=await this.assign(input); return {status:"changed",data:result.data,outboxId:result.outboxId};
  }

  async assign(input:GuildSwordMasterAssignInput):Promise<GuildSwordMasterAssignResult>{
    const parsed=parseGuildSwordMasterAssign(input.message);
    return withGuildSwordMasterAssignRetry(()=>this.database.withTransaction(async(tx)=>{
      const actor=(await tx.query<Array<{player_id:bigint}>>(
        "SELECT identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1 FOR UPDATE",
        [input.externalUserId]
      ))[0];
      if(actor===undefined)throw new ApplicationError("VERIFIED_PLAYER_REQUIRED","❌ 인증된 유저를 찾을 수 없습니다.",404);
      const guild=(await tx.query<Array<{id:bigint;display_name:string;version:bigint;actor_role:string}>>(
        "SELECT guild.id,guild.display_name,guild.version,member.role_code actor_role FROM guild_members member JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active' WHERE member.player_id=? LIMIT 1 FOR UPDATE",
        [actor.player_id]
      ))[0];
      if(guild===undefined)throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED","❌ 가입한 길드가 없습니다.",404);
      const actorRole=normalizedRole(guild.actor_role);
      if(actorRole!=="master"&&actorRole!=="sub_master")throw new ApplicationError("GUILD_SWORD_MASTER_PERMISSION_REQUIRED","❌ 길드마스터 또는 부길드마스터만 지정할 수 있습니다.",403);
      const scope=`guild.sword-master:${guild.id}`,key=eventKey(input.eventId);
      const prior=await tx.query<Array<{actor_id:bigint|null;result_json:string|GuildSwordMasterAssignResult|null}>>("SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
      if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null){if(prior[0].actor_id!==actor.player_id)throw new ApplicationError("GUILD_SWORD_MASTER_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(prior[0].result_json);}
      const activeReady=await tx.query<Array<{id:bigint}>>(
        "SELECT war.id FROM guild_territory_wars war JOIN guild_territory_ready_guilds ready ON ready.war_id=war.id WHERE ready.guild_id=? AND ready.ready=TRUE AND ready.eliminated_at IS NULL AND (war.active=TRUE OR war.lifecycle_state IN ('ACTIVE_OPENING','ACTIVE_READY')) ORDER BY war.id DESC LIMIT 1 FOR UPDATE",
        [guild.id]
      );
      if(activeReady.length>0)throw new ApplicationError("GUILD_SWORD_MASTER_WAR_ACTIVE","❌ 길드 영지전 진행 중에는 소드마스터를 변경할 수 없습니다.",409);
      const reinforcement=await tx.query<Array<{skill_id:bigint}>>(
        "SELECT equipped_skill.skill_id FROM guild_members leader JOIN player_pets pet ON pet.player_id=leader.player_id JOIN pet_skills equipped_skill ON equipped_skill.player_pet_id=pet.id AND equipped_skill.equipped=TRUE JOIN skill_definitions definition ON definition.id=equipped_skill.skill_id AND definition.active=TRUE WHERE leader.guild_id=? AND leader.role_code IN ('master','leader') AND definition.display_name='기사단 증원' ORDER BY leader.player_id,equipped_skill.slot_no LIMIT 1 FOR UPDATE",
        [guild.id]
      );
      const reinforcementEnabled=reinforcement.length>0,assignmentCapacity=resolveGuildSwordMasterCapacity(reinforcementEnabled);
      if(parsed.memberNumbers.length!==assignmentCapacity)throw new ApplicationError("GUILD_SWORD_MASTER_CAPACITY",reinforcementEnabled?"기사단 증원 적용 시 소드마스터 4명을 지정해야 합니다.":"소드마스터 3명을 지정해야 합니다.",422);
      const members=await tx.query<MemberRow[]>(
        `SELECT member.player_id,profile.current_display_name display_name,member.role_code,COALESCE(detail.contribution_value,0) contribution_value,member.joined_at
         FROM guild_members member JOIN player_profiles profile ON profile.player_id=member.player_id
         LEFT JOIN guild_member_profile_details detail ON detail.guild_id=member.guild_id AND detail.player_id=member.player_id
         WHERE member.guild_id=?
         ORDER BY CASE member.role_code WHEN 'master' THEN 0 WHEN 'leader' THEN 0 WHEN 'sub_master' THEN 1 WHEN 'submaster' THEN 1 ELSE 2 END,
          COALESCE(detail.contribution_value,0) DESC,COALESCE(member.joined_at,'9999-12-31'),member.player_id FOR UPDATE`,
        [guild.id]
      );
      const selected=parsed.memberNumbers.map(number=>{const member=members[number-1];if(member===undefined)throw new ApplicationError("GUILD_SWORD_MASTER_MEMBER_RANGE",`❌ ${number}번 회원은 존재하지 않습니다.`,422);return member;});
      const selectedIds=new Set(selected.map(member=>member.player_id.toString()));
      const authorizations=await tx.query<AuthorizationRow[]>("SELECT player_id,active,version FROM guild_territory_rift_authorizations WHERE guild_id=? AND authority_code='sword_master' ORDER BY player_id FOR UPDATE",[guild.id]);
      const previousPlayerIds=authorizations.filter(row=>row.active===1).map(row=>row.player_id.toString());
      const memberOrderHash=createHash("sha256").update(members.map((member,index)=>`${index+1}:${member.player_id}:${member.role_code}:${member.contribution_value}`).join("|")).digest("hex");
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,actor.player_id]);
      for(const current of authorizations){
        const shouldBeActive=selectedIds.has(current.player_id.toString());
        if((current.active===1)!==shouldBeActive){const changed=await tx.execute("UPDATE guild_territory_rift_authorizations SET active=?,version=version+1,granted_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND player_id=? AND authority_code='sword_master' AND version=?",[shouldBeActive,guild.id,current.player_id,current.version]);if(changed.affectedRows!==1n)throw new ApplicationError("GUILD_SWORD_MASTER_CONFLICT","소드마스터 권한이 먼저 변경되었습니다.",409);}
      }
      for(const member of selected){if(!authorizations.some(row=>row.player_id===member.player_id)){await tx.execute("INSERT INTO guild_territory_rift_authorizations(guild_id,player_id,authority_code,active,version,granted_at) VALUES (?,?,'sword_master',TRUE,1,UTC_TIMESTAMP(3))",[guild.id,member.player_id]);}}
      const guildWrite=await tx.execute("UPDATE guilds SET version=version+1 WHERE id=? AND version=?",[guild.id,guild.version]);
      if(guildWrite.affectedRows!==1n)throw new ApplicationError("GUILD_SWORD_MASTER_VERSION_CONFLICT","길드 정보가 먼저 변경되었습니다.",409);
      await tx.execute("INSERT INTO guild_sword_master_assignment_runs(operation_id,guild_id,actor_player_id,assignment_capacity,reinforcement_enabled,member_order_hash,previous_selection_json,selected_selection_json) VALUES (?,?,?,?,?,?,?,?)",[operation.insertId,guild.id,actor.player_id,assignmentCapacity,reinforcementEnabled,memberOrderHash,JSON.stringify(previousPlayerIds),JSON.stringify(selected.map(member=>member.player_id.toString()))]);
      const selectedNames=selected.map(member=>member.display_name),data=`✅ [${guild.display_name}] 소드마스터가 지정되었습니다.\n${selectedNames.join(", ")}`;
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_SWORD_MASTER_ASSIGN',?,'completed','assigned',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId]);
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.sword_master.assign','assigned','Iris 소드마스터 지정',?,UTC_TIMESTAMP(3))",[operation.insertId,actor.player_id,guild.id,JSON.stringify({selectedMemberNumbers:parsed.memberNumbers,selectedPlayerIds:selected.map(member=>member.player_id.toString()),previousPlayerIds,assignmentCapacity,reinforcementEnabled,memberOrderHash,guildVersion:(guild.version+1n).toString()})]);
      const result:GuildSwordMasterAssignResult={status:"assigned",guildId:guild.id.toString(),selectedPlayerIds:selected.map(member=>member.player_id.toString()),selectedNames,previousPlayerIds,assignmentCapacity,reinforcementEnabled,memberOrderHash,previousGuildVersion:guild.version.toString(),guildVersion:(guild.version+1n).toString(),data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    }));
  }
}

async function withGuildSwordMasterAssignRetry<T>(work:()=>Promise<T>):Promise<T>{for(let attempt=0;attempt<4;attempt+=1){try{return await work();}catch(error){const value=error as{code?:unknown;errno?:unknown};const retryable=value.code==="ER_LOCK_DEADLOCK"||value.code==="ER_LOCK_WAIT_TIMEOUT"||value.code==="ER_DUP_ENTRY"||value.errno===1213||value.errno===1205||value.errno===1062;if(!retryable||attempt===3)throw error;}}throw new Error("Guild sword-master assign retry exhausted.");}
