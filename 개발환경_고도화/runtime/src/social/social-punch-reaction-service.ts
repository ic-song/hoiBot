import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

interface ActorRow { identity_id: bigint; player_id: bigint; actor_name: string; }
interface TargetRow { player_id: bigint; target_name: string; }
export type SocialPunchTier = "critical" | "strong" | "light" | "evade";
export type SocialPunchReaction = "collapse" | "tears" | "counter" | "endure";
export interface SocialPunchDraw { tier: SocialPunchTier; reaction: SocialPunchReaction; tierRoll: number; reactionRoll: number; tierThreshold: number; reactionThreshold: number; }
export interface SocialPunchResult { status: "hit" | "usage" | "self" | "not_found"; data?: string; outboxId?: string; targetPlayerId?: string; tier?: SocialPunchTier; reaction?: SocialPunchReaction; tierRoll?: number; reactionRoll?: number; }

const REACTION_TEXT: Record<SocialPunchReaction,string> = {
  collapse: "배를 움켜쥐고 주저앉았습니다.",
  tears: "아무렇지 않은 척했지만 눈물이 맺혔습니다.",
  counter: "잠시 숨을 고르며 반격을 다짐했습니다.",
  endure: "충격을 버티고 태연한 척했습니다."
};

// 접두어 뒤의 전체 문자열을 대상 닉네임으로 보존합니다.
export function parseSocialPunchReactionCommand(message:string):{targetName:string}|null{
  if(!message.startsWith("/명치한대 "))return null;
  return {targetName:message.slice("/명치한대 ".length).trim()};
}

// 접두어가 정확한 명치한대 명령만 공용 dispatch 후보로 허용합니다.
export function isSocialPunchReactionCommandCandidate(message:string|undefined):boolean{return message!==undefined&&parseSocialPunchReactionCommand(message)!==null;}

// 인자가 있는 명령을 registry 대표 별칭으로 정규화합니다.
export function normalizeSocialPunchReactionDispatchMessage(message:string):string{return isSocialPunchReactionCommandCandidate(message)?"/명치한대":message;}

function checkedRoll(value:number):number{if(!Number.isFinite(value)||value<0||value>=1)throw new Error("RNG sample must be in [0, 1).");return value;}
function tierFor(value:number):{tier:SocialPunchTier;threshold:number}{if(value<0.1)return{tier:"critical",threshold:0.1};if(value<0.4)return{tier:"strong",threshold:0.4};if(value<0.7)return{tier:"light",threshold:0.7};return{tier:"evade",threshold:1};}
function reactionFor(value:number):{reaction:SocialPunchReaction;threshold:number}{if(value<0.25)return{reaction:"collapse",threshold:0.25};if(value<0.5)return{reaction:"tears",threshold:0.5};if(value<0.75)return{reaction:"counter",threshold:0.75};return{reaction:"endure",threshold:1};}

// 결과 등급과 무관하게 레거시 순서대로 난수를 정확히 두 번 소비합니다.
export function drawSocialPunch(random:()=>number=Math.random):SocialPunchDraw{const tierRoll=checkedRoll(random()),reactionRoll=checkedRoll(random()),tier=tierFor(tierRoll),reaction=reactionFor(reactionRoll);return{tier:tier.tier,reaction:reaction.reaction,tierRoll,reactionRoll,tierThreshold:tier.threshold,reactionThreshold:reaction.threshold};}

// 등급별 사용자 응답을 생성하며 강타에서만 피해자 반응을 노출합니다.
export function formatSocialPunchReply(actorName:string,targetName:string,draw:SocialPunchDraw):string{
  if(draw.tier==="critical")return `${actorName}님이 ${targetName}님의 명치를 정확히 가격했습니다!`;
  if(draw.tier==="strong")return `${actorName}님이 ${targetName}님의 명치를 강하게 때렸습니다!\n${targetName}님은 ${REACTION_TEXT[draw.reaction]}`;
  if(draw.tier==="light")return `${actorName}님이 ${targetName}님의 명치를 살짝 건드렸습니다.`;
  return `${targetName}님이 ${actorName}님의 명치 공격을 피했습니다.`;
}

function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|SocialPunchResult):SocialPunchResult{return typeof value==="string"?JSON.parse(value) as SocialPunchResult:value;}

async function complete(transaction:DatabaseTransaction,input:{operationId:bigint;eventId:string;destinationId:string;actor:ActorRow;target?:TargetRow;resultCode:string;data:string;result:SocialPunchResult;summary:Record<string,unknown>}):Promise<SocialPunchResult>{
  const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data:input.data})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'SOCIAL_PUNCH_REACTION',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'social.punch.react',?,'Iris /명치한대',?,UTC_TIMESTAMP(3))",[input.operationId,input.actor.identity_id,input.target?.player_id??null,input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,data:input.data,outboxId:outbox.insertId.toString()};
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);
  return result;
}

// 고정 운영자 신원으로 대상 회원을 조회하고 두 RNG 결과를 원자 보존합니다.
export class SocialPunchReactionService{
  constructor(private readonly database:DatabaseClient,private readonly random:()=>number=Math.random){}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<SocialPunchResult|null>{
    const parsed=parseSocialPunchReactionCommand(input.message);if(parsed===null)return null;
    const actors=await this.database.query<ActorRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name actor_name FROM external_identities identity JOIN player_profiles profile ON profile.player_id=identity.player_id JOIN admin_operator_external_identities link ON link.external_identity_id=identity.id JOIN admin_operators operator_row ON operator_row.id=link.operator_id AND operator_row.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND profile.current_display_name IN ('호이 남','맹구 여') LIMIT 1`,[input.externalUserId]),actor=actors[0];if(actor===undefined)return null;
    return this.database.withTransaction(async transaction=>{
      const key=eventKey(input.eventId),prior=await transaction.query<Array<{result_json:string|SocialPunchResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='social.punch.reaction' AND idempotency_key=? FOR UPDATE",[key]);if(prior[0]?.result_json!=null)return stored(prior[0].result_json);
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'social.punch.reaction',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,actor.identity_id]);
      if(parsed.targetName.length===0)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,resultCode:"usage",data:"사용법: /명치한대 [닉네임]",result:{status:"usage"},summary:{targetName:"",rngDraws:0,mutation:false}});
      const targets=await transaction.query<TargetRow[]>("SELECT player_id,current_display_name target_name FROM player_profiles WHERE current_display_name=? LIMIT 1",[parsed.targetName]),target=targets[0];
      if(target===undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,resultCode:"not_found",data:"존재하지 않는 유저입니다.",result:{status:"not_found"},summary:{targetName:parsed.targetName,rngDraws:0,mutation:false}});
      if(target.player_id===actor.player_id)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,target,resultCode:"self",data:"자기 자신은 때릴 수 없습니다.",result:{status:"self",targetPlayerId:target.player_id.toString()},summary:{targetName:target.target_name,rngDraws:0,mutation:false}});
      const draw=drawSocialPunch(this.random),data=formatSocialPunchReply(actor.actor_name,target.target_name,draw);
      await transaction.execute("INSERT INTO rng_events(operation_id,draw_sequence,player_id,event_code,period_key,sample_value,threshold_value,outcome_code,created_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3)),(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))",[operation.insertId,1,target.player_id,"social_punch_tier","draw:1",draw.tierRoll,draw.tierThreshold,draw.tier,operation.insertId,2,target.player_id,"social_punch_reaction","draw:2",draw.reactionRoll,draw.reactionThreshold,draw.reaction]);
      return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,target,resultCode:draw.tier,data,result:{status:"hit",targetPlayerId:target.player_id.toString(),tier:draw.tier,reaction:draw.reaction,tierRoll:draw.tierRoll,reactionRoll:draw.reactionRoll},summary:{targetName:target.target_name,tier:draw.tier,reaction:draw.reaction,rngDraws:2,domainMutation:0}});
    });
  }
}
