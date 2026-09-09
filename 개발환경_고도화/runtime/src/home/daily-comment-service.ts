import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseDailyCommentCommand } from "./daily-comment-command.js";

type Identity={player_id:bigint;display_name:string}; type Target=Identity;
type Result={kind:"guide"|"write"|"read";message:string;commentId:string|null;outboxId:string;auditId:string;replayed:boolean};
type Definition={badge_code:string;emoji:string;display_name:string;criteria_json:string|Record<string,number>|null;required_badge_codes_json:string|string[]|null;sort_order:number};
type Stats={followers:bigint;mutual:bigint;receivedComments:bigint;receivedHomeLikes:bigint;receivedReactions:bigint;totalVisits:bigint;feedActiveDays:bigint};
const CODE="HOME_COMMENT_ACTION",SCOPE="home.comment.action",ALLSEE="\u200b".repeat(500);
const key=(v:string)=>v.length<=191?v:`sha256:${createHash("sha256").update(v).digest("hex")}`;
const json=<T>(v:string|T):T=>typeof v==="string"?JSON.parse(v) as T:v;
const kstDate=()=>{const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),g=(t:string)=>p.find(x=>x.type===t)!.value;return `${g("year")}-${g("month")}-${g("day")}`;};
const activePassSql=`SELECT 1 present FROM player_passes WHERE player_id=? AND pass_code IN ('support','beginner') AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) LIMIT 1`;
const statKeys:{[key:string]:keyof Stats}={followers:"followers",mutual:"mutual",receivedComments:"receivedComments",receivedHomeLikes:"receivedHomeLikes",receivedReactions:"receivedReactions",totalVisits:"totalVisits",feedActiveDays:"feedActiveDays"};

function qualifies(definition:Definition,stats:Stats,owned:Set<string>):boolean{
 const required=definition.required_badge_codes_json===null?[]:json<string[]>(definition.required_badge_codes_json);
 if(required.length>0)return required.every(code=>owned.has(code));
 const criteria=definition.criteria_json===null?{}:json<Record<string,number>>(definition.criteria_json);
 return Object.entries(criteria).every(([name,threshold])=>{const field=statKeys[name],value=field?stats[field]:undefined;return value!==undefined&&value>=BigInt(threshold);});
}

export async function awardHomeActivityBadges(tx:DatabaseTransaction,playerId:bigint):Promise<string[]>{
 const stats=(await tx.query<Array<Stats>>(`SELECT followers,mutual,received_comments receivedComments,received_home_likes receivedHomeLikes,received_reactions receivedReactions,total_visits totalVisits,feed_active_days feedActiveDays FROM pet_home_badge_stats WHERE player_id=? FOR UPDATE`,[playerId]))[0];
 if(!stats)return[];
 const definitions=await tx.query<Definition[]>(`SELECT badge_code,emoji,display_name,criteria_json,required_badge_codes_json,sort_order FROM pet_home_badge_definitions WHERE active=TRUE AND badge_category='activity' ORDER BY sort_order,badge_code`);
 const assignments=await tx.query<Array<{badge_code:string;priority:number}>>("SELECT badge_code,priority FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE",[playerId]);
 const projections=await tx.query<Array<{badge_code:string;owned:number}>>("SELECT badge_code,owned FROM player_home_badges WHERE player_id=? FOR UPDATE",[playerId]);
 const exclusions=await tx.query<Array<{badge_code:string}>>("SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=?",[playerId]);
 const owned=new Set(assignments.map(row=>row.badge_code));for(const row of projections)if(row.owned===1)owned.add(row.badge_code);
 const excluded=new Set(exclusions.map(row=>row.badge_code));for(const row of projections)if(row.owned!==1)excluded.add(row.badge_code);
 let priority=assignments.reduce((v,row)=>Math.max(v,row.priority),0)+1;const awarded:string[]=[];
 for(const definition of definitions){if(owned.has(definition.badge_code)||excluded.has(definition.badge_code)||!qualifies(definition,stats,owned))continue;
  const display=`${definition.emoji} ${definition.display_name}`;await tx.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,?)",[playerId,definition.badge_code,display,priority++]);
  await tx.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version,updated_at) VALUES (?,?,TRUE,FALSE,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE owned=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3)",[playerId,definition.badge_code]);
  owned.add(definition.badge_code);awarded.push(definition.badge_code);
 }
 return awarded;
}

async function renderComments(tx:DatabaseTransaction,target:Target):Promise<string>{
 const comments=await tx.query<Array<{author_name:string;body:string}>>(`SELECT profile.current_display_name author_name,comment.body FROM home_comments comment JOIN player_profiles profile ON profile.player_id=comment.author_player_id WHERE comment.home_player_id=? AND comment.status='visible' AND comment.deleted_at IS NULL ORDER BY comment.created_at DESC,comment.id DESC LIMIT 50`,[target.player_id]);
 const pins=await tx.query<Array<{author_name:string;body:string}>>(`SELECT profile.current_display_name author_name,comment.body FROM home_comment_pins pin JOIN home_comments comment ON comment.id=pin.comment_id JOIN player_profiles profile ON profile.player_id=comment.author_player_id WHERE pin.home_player_id=? AND pin.deleted_at IS NULL AND comment.status='visible' AND comment.deleted_at IS NULL ORDER BY pin.display_order,pin.pin_id`,[target.player_id]);
 let out=`[${target.display_name}] 님의 방명록✍️[최대 50개]\n☆━친구들의 발도장 ${comments.length}개 꾹꾹🐾━☆\n\n❤️집주인이 좋아하는 댓글❤️\n`;
 if(pins.length===0)out+="현재 댓글핀이 없습니다.\n/댓글핀 [숫자] 로 지정하세요\n"+ALLSEE+"\n";else{pins.forEach((pin,i)=>{out+=`${i+1}. 📌 [${pin.author_name}]: ${pin.body}${i===0?ALLSEE:""}\n`;});out+="\n☆━━ 최근 방명록 댓글 ━━☆\n";}
 if(comments.length===0)return(out+"아직 등록된 댓글이 없습니다.").trim();comments.forEach((comment,i)=>{out+=`${i+1}. [${comment.author_name}]: ${comment.body}\n`;});return out.trim();
}

// 댓글 작성과 확인을 pass·home·activity·badge·원장 경계에서 처리합니다.
export class DailyCommentService{
 public constructor(private readonly database:DatabaseClient){}
 public async execute(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<Result>{
  const command=parseDailyCommentCommand(input.message);if(!command)throw new ApplicationError("HOME_COMMENT_COMMAND_INVALID","댓글 명령 형식을 확인해 주세요.",422);
  const actor=(await this.database.query<Identity[]>(`SELECT identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN player_profiles profile ON profile.player_id=identity.player_id JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,[input.externalUserId]))[0];
  if(!actor)throw new ApplicationError("HOME_COMMENT_IDENTITY_REQUIRED","사용자 식별 정보를 확인할 수 없습니다.",422);
  const hasPass=Boolean((await this.database.query<Array<{present:number}>>(activePassSql,[actor.player_id]))[0]);if(!hasPass)throw new ApplicationError("HOME_COMMENT_PASS_REQUIRED",`[${actor.display_name}] 님 ❌ 펫홈 댓글 기능은 호이패스 또는 초보패스 활성 가입자만 이용할 수 있습니다.`,403);
  let target:Target|undefined,body="";if(command.kind==="read"){target=command.targetName===null?actor:(await this.database.query<Target[]>(`SELECT player.id player_id,profile.current_display_name display_name FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' WHERE profile.current_display_name=? LIMIT 1`,[command.targetName]))[0];if(!target)throw new ApplicationError("HOME_COMMENT_TARGET_NOT_FOUND",`❌ [${actor.display_name}]님 대상 유저 [${command.targetName}]님이 존재하지 않습니다.`,404);}
  if(command.kind==="write"){const matches=await this.database.query<Target[]>(`SELECT player.id player_id,profile.current_display_name display_name FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' WHERE ?=profile.current_display_name OR ? LIKE CONCAT(profile.current_display_name,' %') ORDER BY CHAR_LENGTH(profile.current_display_name) DESC LIMIT 1`,[command.body,command.body]);target=matches[0];if(!target)throw new ApplicationError("HOME_COMMENT_TARGET_NOT_FOUND","❌ 닉네임을 찾을 수 없습니다.\n예) /댓글 호이 남 잘들렸다가요!",404);body=command.body.slice(target.display_name.length).trim();if(!body)throw new ApplicationError("HOME_COMMENT_BODY_REQUIRED",`❌ 댓글 내용을 입력해주세요.\n예) /댓글 ${target.display_name} 잘들렸다가요!`,422);if(body.length>30)throw new ApplicationError("HOME_COMMENT_BODY_TOO_LONG",`❌ 댓글은 최대 30자까지 가능합니다. (${body.length}자 입력됨)`,422);}
  const idKey=key(input.eventId);return this.database.withTransaction(async tx=>{const prior=(await tx.query<Array<{result_json:string|Result|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[SCOPE,idKey]))[0];if(prior?.result_json!=null)return{...json<Result>(prior.result_json),replayed:true};
   const operation=(await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),SCOPE,idKey,actor.player_id])).insertId;let message="",commentId:bigint|null=null;
   if(command.kind==="guide")message="방문 댓글💌\n🎙️ 최대 30자, 호이·초보패스 혜택으로 무료\n예) /댓글 호이 남 멋진 집이에요!🏡";
   else if(command.kind==="read")message=await renderComments(tx,target!);
   else{const targetPass=await tx.query<Array<{present:number}>>(activePassSql,[target!.player_id]);if(!targetPass[0])throw new ApplicationError("HOME_COMMENT_TARGET_PASS_REQUIRED",`[${actor.display_name}] 님 ❌ 호이패스 또는 초보패스 활성 가입자의 펫홈에만 댓글을 작성할 수 있습니다.`,403);
    const home=(await tx.query<Array<{version:bigint}>>("SELECT version FROM player_homes WHERE player_id=? FOR UPDATE",[target!.player_id]))[0];if(!home)throw new ApplicationError("HOME_COMMENT_HOME_NOT_FOUND","대상 펫홈을 찾을 수 없습니다.",404);
    const pet=(await tx.query<Array<{present:number}>>("SELECT 1 present FROM player_pets WHERE player_id=? AND display_name IS NOT NULL LIMIT 1",[target!.player_id]))[0];if(!pet)throw new ApplicationError("HOME_COMMENT_TARGET_PET_REQUIRED",`[${target!.display_name}] 님은 아직 펫을 생성하지 않았습니다.`,422);
    commentId=(await tx.execute("INSERT INTO home_comments(home_player_id,author_player_id,body,status,created_at) VALUES (?,?,?,'visible',UTC_TIMESTAMP(3))",[target!.player_id,actor.player_id,body])).insertId;
    await tx.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'pet_home_comment',?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE value=LEAST(value+1,1),updated_at=UTC_TIMESTAMP(3)",[actor.player_id,kstDate()]);
    await tx.execute(`INSERT INTO pet_home_badge_stats(player_id,followers,mutual,received_comments,received_home_likes,received_reactions,total_visits,feed_active_days,version,updated_at) VALUES (?,0,0,1,0,0,0,0,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE received_comments=received_comments+1,version=version+1,updated_at=UTC_TIMESTAMP(3)`,[target!.player_id]);
    const awarded=await awardHomeActivityBadges(tx,target!.player_id);await tx.execute("INSERT INTO home_activity_events(operation_id,home_player_id,actor_player_id,activity_code,reference_id,detail_json) VALUES (?,?,?,'comment',?,?)",[operation,target!.player_id,actor.player_id,commentId,JSON.stringify({preview:body.slice(0,30),awardedBadges:awarded})]);
    await tx.execute("UPDATE player_homes SET version=version+1 WHERE player_id=? AND version=?",[target!.player_id,home.version]);
    const excess=Number((await tx.query<Array<{count:bigint}>>("SELECT GREATEST(COUNT(*)-50,0) count FROM home_comments WHERE home_player_id=? AND status='visible' AND deleted_at IS NULL",[target!.player_id]))[0]?.count??0n);
    if(excess>0){const removable=await tx.query<Array<{id:bigint}>>(`SELECT comment.id FROM home_comments comment WHERE comment.home_player_id=? AND comment.status='visible' AND comment.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM home_comment_pins pin WHERE pin.home_player_id=comment.home_player_id AND pin.comment_id=comment.id AND pin.deleted_at IS NULL) ORDER BY comment.created_at,comment.id LIMIT ${excess} FOR UPDATE`,[target!.player_id]);for(const row of removable)await tx.execute("UPDATE home_comments SET status='deleted',deleted_at=UTC_TIMESTAMP(3) WHERE id=?",[row.id]);}
    message=`💌 [${actor.display_name}] 님이 [${target!.display_name}] 님의 집에 댓글을 남겼습니다!\n💬 "${body}"`;
   }
   await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,CODE,operation]);
   const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'player',?,'player',?,'home.comment.action','success',?,UTC_TIMESTAMP(3))",[operation,actor.player_id,target?.player_id??actor.player_id,JSON.stringify({kind:command.kind,commentId:commentId?.toString()??null,domainMutation:command.kind==="write"})]);
   const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation,input.destinationId,JSON.stringify({data:message})]);
   const result:Result={kind:command.kind,message,commentId:commentId?.toString()??null,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString(),replayed:false};await tx.execute("INSERT INTO home_comment_action_mutations(request_key,operation_id,player_id,action_kind,comment_id,result_json) VALUES (?,?,?,?,?,?)",[idKey,operation,actor.player_id,command.kind,commentId,JSON.stringify(result)]);await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation]);return result;
  });
 }
}
