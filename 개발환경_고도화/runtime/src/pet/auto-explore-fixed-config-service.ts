import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE="PLAYER_AUTO_EXPLORE_FIXED_CONFIG";
const NAMES:Record<string,string>={"0":"다이아 광산💎","1":"펫강화 광산⭐️","2":"친밀도 광산🐾","3":"행운의 광산🍀","4":"전도르 던전🗿","5":"양계장 던전🐓","6":"땅문서 던전📜","7":"샵오픈 던전🏡","8":"보물수호자 벨카르💎","9":"잊혀진 대마법사의 유적📙","10":"길드레이드던전👾"};
export interface AutoExploreFixedResult{status:"completed";changed:boolean;destinationCode:string|null;data:string;outboxId:string;auditId:string;}
export function isAutoExploreFixedConfigCommand(message:string|undefined):boolean{return message==="/자동탐고정"||(message!==undefined&&/^\/자동탐고정\s+\d+$/.test(message));}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|AutoExploreFixedResult):AutoExploreFixedResult{return typeof value==="string"?JSON.parse(value) as AutoExploreFixedResult:value;}
function range(eventMine:boolean,raid:boolean):string{let value=eventMine?"0~9":"1~9";if(raid)value+=", 10";return value;}
function reply(raw:string|null,eventMine:boolean,raid:boolean,previous:string|null):{data:string;valid:boolean;changed:boolean}{
  const allowed=raw!==null&&((Number(raw)>=1&&Number(raw)<=9)||(raw==="0"&&eventMine)||(raw==="10"&&raid));
  if(raw===null){const example=raid?"10":eventMine?"0":"4";return{data:`사용법: /자동탐고정 ${range(eventMine,raid)}\n(예: /자동탐고정 ${example})`,valid:false,changed:false};}
  if(!allowed){const example=raid?"10":eventMine?"0":"2";return{data:`${range(eventMine,raid)} 중 하나만 입력해줘!\n예) /자동탐고정 ${example}`,valid:false,changed:false};}
  if(previous===raw)return{data:`✅ 이미 자동탐험지가 ${NAMES[raw]} (탐${raw}) 로 고정되어 있어!`,valid:true,changed:false};
  let guide="";if(raw==="10")guide="※ 탐10 자동탐험은 길드 가입과 펫던전 입장권🌋이 필요하며\n소모는 탐험 시작 시점에 처리됩니다.\n펫던전 입장권🌋이 부족하면 보상에서 제외됩니다.";else if(Number(raw)>=8){guide=`※ 탐${raw} 자동탐험은 미궁 입장권🕋이 필요하며\n소모는 탐험 시작 시점에 처리됩니다.\n미궁 입장권🕋이 부족하면 보상에서 제외됩니다.${raw==="9"?"\n탐9는 /종합순위 20등 안에 들어가야 입장할 수 있습니다.":""}`;}else if(Number(raw)>=4)guide="※ 탐4~7 자동탐험은 펫던전 입장권🌋이 필요하며\n소모는 탐험 시작 시점에 처리됩니다.\n펫던전 입장권🌋을 전부 소모하면 탐 1~3으로 이동합니다.";
  const data=guide?`✅ 자동탐험 고정 완료!\n내 자동탐험지: ${NAMES[raw]} (탐${raw})\n${guide}\n\n자동탐험권🌄(호이패스,초보패스,호이패스 프리미엄) 구독자만 이용가능합니다.`:`✅ 자동탐험 고정 완료!\n내 자동탐험지: ${NAMES[raw]} (탐${raw})\n\n*탐험고정은 자동탐험권🌄이 필요하며 호이패스, 초보패스, 호이패스 프리미엄 구독자가 이용할 수 있습니다.`;
  return{data,valid:true,changed:true};
}

// rollout과 연결 회원을 확인한 뒤 자동탐 목적지만 원자 저장합니다.
export class AutoExploreFixedConfigService{
 constructor(private readonly database:DatabaseClient){}
 async handleIris(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<AutoExploreFixedResult|{status:"shadow"|"legacy_fallback"}>{
  if(!isAutoExploreFixedConfigCommand(input.message))throw new ApplicationError("INVALID_AUTO_EXPLORE_FIXED_COMMAND","자동탐고정 명령 형식이 올바르지 않습니다.",422);
  const definition=(await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]))[0],dispatch=new MariaCommandDispatchRepository(this.database);
  if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode:COMMAND_CODE,handlerKey:COMMAND_CODE});return{status:"legacy_fallback"};}
  if(definition.rollout_state==="SHADOW"||definition.rollout_state==="CANARY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:COMMAND_CODE,handlerKey:COMMAND_CODE});return{status:"shadow"};}
  await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode:COMMAND_CODE,handlerKey:COMMAND_CODE});
  const player=(await this.database.query<Array<{player_id:bigint}>>("SELECT identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1",[input.externalUserId]))[0];if(player===undefined)throw new ApplicationError("PLAYER_NOT_FOUND","가입된 회원 정보를 찾을 수 없습니다.",404);
  return this.execute({playerId:player.player_id.toString(),channelId:input.channelId,message:input.message,eventId:input.eventId});
 }
 async execute(input:{playerId:string;channelId:string;message:string;eventId:string}):Promise<AutoExploreFixedResult>{return this.database.withTransaction(async tx=>{
  const scope=`player.auto_explore_fixed:${input.playerId}`,key=eventKey(input.eventId),prior=await tx.query<Array<{result_json:string|AutoExploreFixedResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null)return stored(prior[0].result_json);
  const config=(await tx.query<Array<{event_mine_active:number;guild_raid_active:number}>>("SELECT event_mine_active,guild_raid_active FROM pet_explore_runtime_config WHERE config_id=1 FOR UPDATE"))[0];if(config===undefined)throw new Error("Pet explore runtime config is missing.");
  const current=(await tx.query<Array<{destination_code:string}>>("SELECT destination_code FROM pet_explore_auto_fixed_configs WHERE player_id=? FOR UPDATE",[input.playerId]))[0],raw=input.message==="/자동탐고정"?null:input.message.replace(/^\/자동탐고정\s+/,""),projection=reply(raw,config.event_mine_active===1,config.guild_raid_active===1,current?.destination_code??null);
  const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,input.playerId]);
  if(projection.valid&&raw!==null){if(projection.changed)await tx.execute("INSERT INTO pet_explore_auto_fixed_configs(player_id,destination_code,version,updated_operation_id) VALUES (?,?,1,?) ON DUPLICATE KEY UPDATE destination_code=VALUES(destination_code),version=version+1,updated_operation_id=VALUES(updated_operation_id)",[input.playerId,raw,operation.insertId]);await tx.execute("INSERT INTO pet_explore_auto_fixed_changes(operation_id,player_id,previous_destination_code,configured_destination_code,changed) VALUES (?,?,?,?,?)",[operation.insertId,input.playerId,current?.destination_code??null,raw,projection.changed]);}
  const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'player',?,'pet_explore.fixed_config','success','Iris /자동탐고정',?,UTC_TIMESTAMP(3))",[operation.insertId,input.playerId,input.playerId,JSON.stringify({destinationCode:raw,valid:projection.valid,changed:projection.changed})]);await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'auto_explore_fixed_config',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId]);const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({data:projection.data})]);const result:AutoExploreFixedResult={status:"completed",changed:projection.changed,destinationCode:projection.valid?raw:null,data:projection.data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
 });}
}
