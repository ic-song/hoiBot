import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type ForcedRiftKind = "rift" | "greatRift";
export interface ForcedRiftResult { status:"inactive"|"rift"|"great_rift"|"stable"; targetGuildId?:string; data:string; outboxId:string; }
interface Options { random?:()=>number; now?:()=>Date; }
interface Command { eventId:string; actorPlayerId:string; destinationId:string; warKey:string; kind:ForcedRiftKind; }
interface WarRow { id:bigint; active:number; turn_count:bigint; instability_adjust:string; rift_bias:string; rift_event_status:string|null; rift_event_count:bigint; rift_event_history_json:string|string[]; version:bigint; }

// 준비 길드 배열에서 기록 가능한 난수 표본으로 대균열 대상을 선택합니다.
export function selectGreatRiftTarget<T>(rows:T[],sample:number):{target:T;index:number}|undefined{
  if(rows.length===0)return undefined;
  if(!Number.isFinite(sample)||sample<0||sample>=1)throw new ApplicationError("INVALID_RNG_SAMPLE","대균열 확률 표본이 유효하지 않습니다.",500);
  const index=Math.floor(sample*rows.length);return{target:rows[index]!,index};
}

// 레거시 균열 발생 안내를 동일한 줄바꿈으로 생성합니다.
export function formatForcedRiftReply(eventCount:number,maxCount=3):string{
  const remain=Math.max(0,maxCount-eventCount);
  const limit=remain===0?`※ 균열 이벤트 발생 횟수: (${eventCount}/${maxCount})\n※ 이번 영지전에서는 더 이상 균열 이벤트가 발생하지 않습니다.`:`※ 균열 이벤트 발생 횟수: (${eventCount}/${maxCount})\n※ 이번 영지전에서는 균열 이벤트가 ${remain}회 더 발생할 수 있습니다.`;
  return "🌌 균열 발생!\n\n전장의 균형이 무너지며\n점령 중이던 길드영지에 균열이 발생했습니다.\n\n🏰 길드영지의 점령 상태가 초기화됩니다.\n해당 영지는 다시 쟁탈 가능한 중립 상태가 되었습니다.\n🌪️ 누적 전쟁불안정도는 0으로 초기화됩니다.\n\n"+limit;
}

// 레거시 대균열 발생 또는 참여 길드 부재 안내를 생성합니다.
export function formatForcedGreatRiftReply(guildName?:string,eventCount=0,maxCount=3):string{
  if(guildName===undefined)return "🌪️ 전쟁불안정도 안정화\n\n대균열이 발생하려 했으나,\n영향을 받을 참여 길드가 없어 전장이 안정화되었습니다.\n\n※ 이번 영지전에서는 더 이상 균열 이벤트가 발생하지 않습니다.";
  const remain=Math.max(0,maxCount-eventCount),limit=remain===0?`※ 균열 이벤트 발생 횟수: (${eventCount}/${maxCount})\n※ 이번 영지전에서는 더 이상 균열 이벤트가 발생하지 않습니다.`:`※ 균열 이벤트 발생 횟수: (${eventCount}/${maxCount})\n※ 이번 영지전에서는 균열 이벤트가 ${remain}회 더 발생할 수 있습니다.`;
  return `🌋 대균열 발생!\n\n전장의 균열이 걷잡을 수 없이 확산됩니다.\n\n거대한 균열이 전장을 집어삼키며,\n[${guildName}] 길드가 겁에 질려 영지전에서 후다닥 도망갑니다.\n\n해당 길드는 이번 길드영지전에서\n더 이상 공격 및 점령에 참여할 수 없습니다.\n\n🌪️ 누적 전쟁불안정도는 0으로 초기화됩니다.\n\n${limit}`;
}

// 강제 균열의 전쟁 상태, 점령, RNG, 감사와 응답을 하나의 트랜잭션으로 기록합니다.
export class GuildTerritoryWarProvider{
  private readonly random:()=>number; private readonly now:()=>Date;
  constructor(private readonly database:DatabaseClient,options:Options={}){this.random=options.random??Math.random;this.now=options.now??(()=>new Date());}
  async force(command:Command):Promise<ForcedRiftResult>{
    const scope=`guild.territory.force_rift:${command.warKey}:${command.kind}`;
    return this.database.withTransaction(async tx=>{
      const prior=await tx.query<Array<{result_json:string|ForcedRiftResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,command.eventId]);
      if(prior[0]?.result_json!=null)return typeof prior[0].result_json==="string"?JSON.parse(prior[0].result_json):prior[0].result_json;
      const wars=await tx.query<WarRow[]>("SELECT id,active,turn_count,CAST(instability_adjust AS CHAR) instability_adjust,CAST(rift_bias AS CHAR) rift_bias,rift_event_status,rift_event_count,rift_event_history_json,version FROM guild_territory_wars WHERE war_key=? FOR UPDATE",[command.warKey]);
      const war=wars[0];if(war===undefined)throw new ApplicationError("GUILD_TERRITORY_WAR_NOT_FOUND","길드 영지전 상태를 찾을 수 없습니다.",404);
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'developer',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,command.eventId,command.actorPlayerId]);
      let status:ForcedRiftResult["status"]="inactive",targetGuildId:string|undefined,data="현재 진행 중인 길드 영지전이 없습니다.";
      const before={turnCount:war.turn_count.toString(),instabilityAdjust:war.instability_adjust,riftStatus:war.rift_event_status,eventCount:war.rift_event_count.toString()};
      if(war.active===1){
        if(command.kind==="rift"){
          await tx.execute("UPDATE guild_territory_occupations SET owner_guild_id=NULL,owner_player_id=NULL,version=version+1 WHERE war_id=?",[war.id]);
          const count=Number(war.rift_event_count)+1;const history=parseHistory(war.rift_event_history_json);history.push("rift");
          await tx.execute("UPDATE guild_territory_wars SET turn_count=0,instability_adjust=0,rift_event_status='rift',rift_event_count=?,rift_event_history_json=?,rift_event_at=?,rift_event_guild_id=NULL,castle_lord_player_id=NULL,castle_earnings=0,castle_defense_count=0,version=version+1 WHERE id=? AND version=?",[count,JSON.stringify(history),this.now(),war.id,war.version]);
          status="rift";data=formatForcedRiftReply(count);
          await tx.execute("INSERT INTO guild_territory_rift_events(operation_id,war_id,event_type,event_count_after,state_before_json,state_after_json) VALUES (?,?,'rift',?,?,?)",[operation.insertId,war.id,count,JSON.stringify(before),JSON.stringify({turnCount:0,instabilityAdjust:0,riftStatus:"rift",eventCount:count})]);
        }else{
          const ready=await tx.query<Array<{guild_id:bigint;display_name:string}>>("SELECT ready.guild_id,guild.display_name FROM guild_territory_ready_guilds ready JOIN guilds guild ON guild.id=ready.guild_id WHERE ready.war_id=? AND ready.ready=TRUE AND ready.eliminated_at IS NULL ORDER BY ready.guild_id FOR UPDATE",[war.id]);
          const sample=this.random();const selected=selectGreatRiftTarget(ready,sample);
          if(selected===undefined){await tx.execute("UPDATE guild_territory_wars SET rift_event_status='stable',rift_event_at=?,version=version+1 WHERE id=? AND version=?",[this.now(),war.id,war.version]);status="stable";data=formatForcedGreatRiftReply();}
          else{const count=Number(war.rift_event_count)+1,target=selected.target;targetGuildId=target.guild_id.toString();const history=parseHistory(war.rift_event_history_json);history.push("greatRift");
            await tx.execute("UPDATE guild_territory_ready_guilds SET eliminated_reason='GREAT_RIFT',eliminated_at=? WHERE war_id=? AND guild_id=?",[this.now(),war.id,target.guild_id]);
            await tx.execute("UPDATE guild_territory_wars SET turn_count=0,instability_adjust=0,rift_event_status='greatRift',rift_event_count=?,rift_event_history_json=?,rift_event_at=?,rift_event_guild_id=?,version=version+1 WHERE id=? AND version=?",[count,JSON.stringify(history),this.now(),target.guild_id,war.id,war.version]);
            await tx.execute("INSERT INTO rng_events(operation_id,player_id,event_code,period_key,sample_value,threshold_value,outcome_code) VALUES (?,?,'guild_territory_great_rift',?,?,?,?)",[operation.insertId,command.actorPlayerId,command.warKey,sample.toFixed(17),(1/ready.length).toFixed(17),`guild:${targetGuildId}`]);
            await tx.execute("INSERT INTO guild_territory_rift_events(operation_id,war_id,event_type,target_guild_id,event_count_after,state_before_json,state_after_json) VALUES (?,?,'greatRift',?,?,?,?)",[operation.insertId,war.id,target.guild_id,count,JSON.stringify(before),JSON.stringify({turnCount:0,instabilityAdjust:0,riftStatus:"greatRift",eventCount:count,targetGuildId})]);status="great_rift";data=formatForcedGreatRiftReply(target.display_name,count);}
        }
      }
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json) VALUES (?,'developer',?,'guild_territory_war',?,'guild.territory.force_rift',?,'DEV forced rift',?)",[operation.insertId,command.actorPlayerId,war.id,status,JSON.stringify({kind:command.kind,status,targetGuildId:targetGuildId??null})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'guild_territory_force_rift_provider',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[command.eventId,operation.insertId]);
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status) VALUES (?,'iris',?,'text',?,'pending')",[operation.insertId,command.destinationId,JSON.stringify({data})]);
      const result:ForcedRiftResult={status,data,outboxId:outbox.insertId.toString(),...(targetGuildId===undefined?{}:{targetGuildId})};
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);void audit;return result;
    });
  }
}

function parseHistory(value:string|string[]):string[]{if(Array.isArray(value))return value.slice();const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}
