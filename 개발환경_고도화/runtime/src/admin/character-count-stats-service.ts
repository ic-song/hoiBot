import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

export type CharacterCountEnvironment = "prod" | "dev";
export interface CharacterCountRuntimeContext { environmentCode:CharacterCountEnvironment; databaseIdentity?:string; }
export interface CharacterCountSourceRow { source_code:string; raw_json:string; content_sha256:string; utf16_code_unit_count:bigint; entity_count:bigint; read_status:string; }
export interface CharacterCountStat { sourceCode:string; label:string; section:"핵심 데이터"|"칭호·성장 데이터"|"운영 데이터"; readStatus:"valid"|"missing"; utf16CodeUnitCount:string|null; entityCount:string|null; syncCommands:readonly string[]; }
export interface CharacterCountStatsResult { status:"counted"; requestFingerprint:string; environment:CharacterCountEnvironment; databaseIdentity:string; snapshotVersion:string; snapshotAt:string; sourceCount:number; projectionCount:number; stats:CharacterCountStat[]; data:string; outboxId:string; auditId:string; }

const SOURCE_DEFINITIONS = [
  ["member","멤버","핵심 데이터",["/길드데이터동기화","/전체동기화"]],
  ["pet_home","펫홈","핵심 데이터",["/장착가구동기화"]],
  ["equipped_furniture","장착가구","핵심 데이터",["/장착가구동기화"]],
  ["member_pet","펫멤버","핵심 데이터",["/펫데이터동기화","/전체동기화"]],
  ["pet_skill","펫스킬","핵심 데이터",[]],
  ["pendant","펜던트","핵심 데이터",[]],
  ["member_title","회원칭호","칭호·성장 데이터",[]],
  ["pet_title","펫칭호","칭호·성장 데이터",["/펫타이틀동기화","/전체동기화"]],
  ["mini_pet_title","미니펫칭호","칭호·성장 데이터",[]],
  ["mini_pet_collection","미니펫도감","칭호·성장 데이터",[]],
  ["trial_tower","시련의탑","칭호·성장 데이터",["/시련의탑동기화","/전체동기화"]],
  ["pet_explore","펫탐험","운영 데이터",[]],
  ["guild","길드","운영 데이터",["/길드데이터동기화","/전체동기화"]],
  ["attendance_light","경량출석","운영 데이터",[]],
  ["board","게시판","운영 데이터",[]],
  ["free_market","자유시장","운영 데이터",[]]
] as const;
const PHYSICAL_SOURCE_CODES=SOURCE_DEFINITIONS.filter(definition=>definition[0]!=="pendant").map(definition=>definition[0]);

// 인자나 접미 문구가 없는 정확한 관리자 통계 명령만 허용합니다.
export function isCharacterCountStatsCommand(message:string|undefined):boolean{return message==="/글자수통계";}

// 존재하는 원본은 직접 검산하고 누락 원본은 레거시와 같이 항목별로 표시합니다.
export function projectCharacterCountStats(rows:CharacterCountSourceRow[]):CharacterCountStat[]{
  const byCode=new Map<string,CharacterCountSourceRow>();
  for(const row of rows){
    if(!PHYSICAL_SOURCE_CODES.includes(row.source_code as typeof PHYSICAL_SOURCE_CODES[number]))throw invalidBundle(`허용되지 않은 source_code: ${row.source_code}`);
    if(byCode.has(row.source_code))throw invalidBundle(`중복 source_code: ${row.source_code}`);
    if(row.read_status==="missing"){byCode.set(row.source_code,row);continue;}
    if(row.read_status!=="valid")throw invalidBundle(`유효하지 않은 source 상태: ${row.source_code}`);
    if(sha256(row.raw_json)!==row.content_sha256)throw invalidBundle(`hash 불일치: ${row.source_code}`);
    if(BigInt(row.raw_json.length)!==BigInt(row.utf16_code_unit_count))throw invalidBundle(`UTF-16 글자 수 불일치: ${row.source_code}`);
    parseSource(row.source_code,row.raw_json);byCode.set(row.source_code,row);
  }
  const memberPetRow=byCode.get("member_pet");let pendantProjection:Record<string,unknown>|null=null;
  if(memberPetRow?.read_status==="valid"){
    const memberPet=parseSource("member_pet",memberPetRow.raw_json);if(!isRecord(memberPet))throw invalidBundle("member_pet 최상위 구조가 객체가 아닙니다.");pendantProjection={};
    for(const[userKey,value]of Object.entries(memberPet))if(isRecord(value)&&(Boolean(value.pendant)||Boolean(value.pendantBag)))pendantProjection[userKey]={pendant:value.pendant||null,pendantBag:value.pendantBag||[]};
  }
  const pendantJson=pendantProjection===null?null:JSON.stringify(pendantProjection);
  return SOURCE_DEFINITIONS.map(([sourceCode,label,section,syncCommands])=>{
    if(sourceCode==="pendant")return pendantProjection===null||pendantJson===null?{sourceCode,label,section,readStatus:"missing",utf16CodeUnitCount:null,entityCount:null,syncCommands}:{sourceCode,label,section,readStatus:"valid",utf16CodeUnitCount:pendantJson.length.toString(),entityCount:Object.keys(pendantProjection).length.toString(),syncCommands};
    const row=byCode.get(sourceCode);if(row===undefined||row.read_status==="missing")return{sourceCode,label,section,readStatus:"missing",utf16CodeUnitCount:null,entityCount:null,syncCommands};
    return{sourceCode,label,section,readStatus:"valid",utf16CodeUnitCount:row.raw_json.length.toString(),entityCount:countLegacyEntities(sourceCode,parseSource(sourceCode,row.raw_json)).toString(),syncCommands};
  });
}

// 레거시 명령의 제목, 구역, 누락 표시와 동기화 안내를 byte 단위로 유지합니다.
export function formatCharacterCountStats(stats:CharacterCountStat[]):string{
  const lines=["📊 글자수 통계"];
  for(const section of["핵심 데이터","칭호·성장 데이터","운영 데이터"]as const){lines.push("",`[${section}]`);for(const stat of stats.filter(candidate=>candidate.section===section)){lines.push(stat.readStatus==="missing"?`- ${stat.label}: ❌ 파일 없음`:`- ${stat.label}: ${formatNumber(stat.utf16CodeUnitCount!)}자 / ${formatNumber(stat.entityCount!)}명`);if(stat.readStatus==="valid"&&stat.syncCommands.length>0)lines.push(`  ↳ 동기화: ${stat.syncCommands.join(", ")}`);}}
  return lines.join("\n");
}

// 관리자 권한과 고정 snapshot을 확인한 뒤 조회 결과, 감사, Outbox를 원자 기록합니다.
export class CharacterCountStatsService{
  constructor(private readonly database:DatabaseClient,private readonly runtime?:CharacterCountRuntimeContext){}
  async handleIris(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"|"handled_no_reply"}>{
    if(this.runtime===undefined)return{status:"legacy_fallback"};
    const decision=await new CommandDispatcher(new MariaCommandDispatchRepository(this.database),{enabled:true,allowAllCanaries:false,canaryUserIds:new Set()}).resolve({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true});
    if(decision.route==="SHADOW")return{status:"shadow"};if(decision.route!=="MODERN")return{status:"legacy_fallback"};
    const result=await this.read({eventId:input.eventId,externalUserId:input.externalUserId,destinationId:input.channelId,environment:this.runtime.environmentCode,expectedDatabaseIdentity:this.runtime.databaseIdentity,requestText:input.message});
    return result===null?{status:"handled_no_reply"}:{status:"changed",data:result.data,outboxId:result.outboxId};
  }
  async read(input:{eventId:string;externalUserId:string;destinationId:string;environment:CharacterCountEnvironment;expectedDatabaseIdentity?:string;requestText?:string}):Promise<CharacterCountStatsResult|null>{
    const operator=(await this.database.query<Array<{id:bigint}>>(`SELECT operator.id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active' AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='stats.character_count.read' AND denied.effect='deny') AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='stats.character_count.read' AND allowed.effect='allow') OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='stats.character_count.read' WHERE operator_role.operator_id=operator.id)) LIMIT 1`,[input.externalUserId]))[0];if(operator===undefined)return null;
    const idempotencyKey=eventKey(input.eventId),requestFingerprint=sha256([input.environment,input.eventId,input.externalUserId,input.destinationId,input.requestText??"/글자수통계"].join("\n"));
    return withDeadlockRetry(()=>this.database.withTransaction(async transaction=>{
      const reserved=await transaction.execute("INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,result_json,created_at) VALUES (?,'stats.character_count.read',?,'admin_operator',?,'iris','processing',?,UTC_TIMESTAMP(3))",[randomUUID(),idempotencyKey,operator.id,JSON.stringify({requestFingerprint})]);
      const previous=(await transaction.query<Array<{id:bigint;status:string;result_json:string|CharacterCountStatsResult|null;age_seconds:bigint}>>("SELECT id,status,result_json,TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(3)) age_seconds FROM operations WHERE idempotency_scope='stats.character_count.read' AND idempotency_key=? FOR UPDATE",[idempotencyKey]))[0]!;
      if(reserved.affectedRows===0n){const stored=parseStored(previous.result_json);if(stored.requestFingerprint!==requestFingerprint)throw new ApplicationError("CHARACTER_COUNT_STATS_REPLAY_MISMATCH","동일 이벤트의 글자수 통계 요청 내용이 다릅니다.",409);if(previous.status==="completed"&&"status"in stored)return stored;if(previous.status==="processing"&&BigInt(previous.age_seconds)<300n)throw new ApplicationError("CHARACTER_COUNT_STATS_IN_PROGRESS","같은 글자수 통계 요청을 처리 중입니다.",409);await transaction.execute("UPDATE operations SET status='processing',result_json=?,created_at=UTC_TIMESTAMP(3),completed_at=NULL WHERE id=?",[JSON.stringify({requestFingerprint}),previous.id]);}
      const environment=(await transaction.query<Array<{database_identity:string;active_snapshot_set_id:bigint|null}>>("SELECT database_identity,active_snapshot_set_id FROM legacy_snapshot_environments WHERE environment_code=? FOR UPDATE",[input.environment]))[0];if(environment===undefined||environment.active_snapshot_set_id===null)throw invalidBundle(`${input.environment} 활성 snapshot이 없습니다.`);if(input.expectedDatabaseIdentity!==undefined&&environment.database_identity!==input.expectedDatabaseIdentity)throw invalidBundle("검증된 DB identity와 snapshot 환경이 일치하지 않습니다.");
      const snapshotSet=(await transaction.query<Array<{id:bigint;database_identity:string;snapshot_version:bigint;snapshot_at:string}>>("SELECT id,database_identity,snapshot_version,DATE_FORMAT(snapshot_at,'%Y-%m-%d %H:%i:%s') snapshot_at FROM legacy_snapshot_sets WHERE id=? AND environment_code=? AND snapshot_status='ready' FOR UPDATE",[environment.active_snapshot_set_id,input.environment]))[0];if(snapshotSet===undefined||snapshotSet.database_identity!==environment.database_identity)throw invalidBundle("DB environment identity와 snapshot이 일치하지 않습니다.");
      const rows=await transaction.query<CharacterCountSourceRow[]>("SELECT source_code,raw_json,content_sha256,utf16_code_unit_count,entity_count,read_status FROM legacy_source_snapshots WHERE snapshot_set_id=? ORDER BY source_code FOR UPDATE",[snapshotSet.id]),stats=projectCharacterCountStats(rows),snapshotVersion=BigInt(snapshotSet.snapshot_version).toString(),data=formatCharacterCountStats(stats),operationId=previous.id;
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operationId,input.destinationId,JSON.stringify({data})]);await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_CHARACTER_COUNT_STATS',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operationId]);await transaction.execute("INSERT INTO admin_character_count_stat_executions(operation_id,snapshot_set_id,environment_code,database_identity,snapshot_version,source_count,projection_count,result_sha256) VALUES (?,?,?,?,?,?,?,?)",[operationId,snapshotSet.id,input.environment,environment.database_identity,snapshotSet.snapshot_version,rows.length,stats.length,sha256(data)]);const audit=await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'legacy_snapshot_set',?,'stats.character_count.read','success','Iris /글자수통계',?,UTC_TIMESTAMP(3))",[operationId,operator.id,snapshotSet.id,JSON.stringify({readOnly:true,requestFingerprint,environment:input.environment,databaseIdentity:environment.database_identity,snapshotVersion,sourceCount:rows.length,projectionCount:stats.length})]);
      const result:CharacterCountStatsResult={status:"counted",requestFingerprint,environment:input.environment,databaseIdentity:environment.database_identity,snapshotVersion,snapshotAt:snapshotSet.snapshot_at,sourceCount:rows.length,projectionCount:stats.length,stats,data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operationId]);return result;
    }));
  }
}

function countLegacyEntities(sourceCode:string,parsed:unknown):number{if(!isRecord(parsed))return 0;if(["member","member_title","pet_title","mini_pet_title","mini_pet_collection"].includes(sourceCode))return recordSize(parsed.member);if(sourceCode==="trial_tower")return recordSize(parsed.user);if(sourceCode==="attendance_light")return recordSize(parsed.users);if(sourceCode==="pet_explore"){const users=new Set<string>();for(const key of["userBet","autoFixedDungeon","record"])for(const user of recordKeys(parsed[key]))users.add(user);if(isRecord(parsed.bet))for(const value of Object.values(parsed.bet))if(Array.isArray(value))for(const entry of value)if(isRecord(entry)&&entry.user)users.add(String(entry.user));return users.size;}if(sourceCode==="guild"){const users=new Set<string>();if(isRecord(parsed.guilds))for(const guild of Object.values(parsed.guilds))if(isRecord(guild))for(const user of recordKeys(guild.members))users.add(user);return users.size;}if(sourceCode==="board")return uniqueEntryUsers(parsed.memo,parsed.record).size;if(sourceCode==="free_market"){const users=new Set<string>();for(const value of[parsed.listings,parsed.completedLogs])if(Array.isArray(value))for(const entry of value)if(isRecord(entry)){if(entry.seller)users.add(String(entry.seller));if(entry.buyer)users.add(String(entry.buyer));}return users.size;}return Object.keys(parsed).length;}
function uniqueEntryUsers(...values:unknown[]):Set<string>{const users=new Set<string>();for(const value of values)if(Array.isArray(value))for(const entry of value)if(isRecord(entry)&&entry.user)users.add(String(entry.user));return users;}
function recordKeys(value:unknown):string[]{return isRecord(value)?Object.keys(value):[];}function recordSize(value:unknown):number{return recordKeys(value).length;}function parseSource(sourceCode:string,rawJson:string):unknown{try{return JSON.parse(rawJson)as unknown;}catch{throw invalidBundle(`JSON 파싱 실패: ${sourceCode}`);}}function invalidBundle(detail:string):ApplicationError{return new ApplicationError("CHARACTER_COUNT_SNAPSHOT_INVALID",`글자수 통계 snapshot이 올바르지 않습니다: ${detail}`,409);}function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value);}function formatNumber(value:string):string{return value.replace(/\B(?=(\d{3})+(?!\d))/g,",");}function sha256(value:string):string{return createHash("sha256").update(value).digest("hex");}function eventKey(value:string):string{return value.length<=191?value:`sha256:${sha256(value)}`;}function parseStored(value:string|CharacterCountStatsResult|null):{requestFingerprint:string}|CharacterCountStatsResult{if(value===null)throw new Error("CHARACTER_COUNT_STATS_OPERATION_STATE_MISSING");const parsed=typeof value==="string"?JSON.parse(value)as Record<string,unknown>:value;if(typeof parsed.requestFingerprint!=="string")throw new Error("CHARACTER_COUNT_STATS_REQUEST_FINGERPRINT_MISSING");return parsed as{requestFingerprint:string}|CharacterCountStatsResult;}async function withDeadlockRetry<T>(work:()=>Promise<T>):Promise<T>{for(let attempt=0;attempt<3;attempt+=1){try{return await work();}catch(error){const e=error as{code?:unknown;errno?:unknown};if(attempt===2||(e.code!=="ER_LOCK_DEADLOCK"&&e.errno!==1213&&e.code!=="ER_LOCK_WAIT_TIMEOUT"&&e.errno!==1205))throw error;}}throw new Error("Character count stats retry exhausted.");}
