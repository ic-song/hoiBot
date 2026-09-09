import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALLSEE="\u200b".repeat(500);
export interface PlayerLevelRankRow{playerId:string;displayName:string;rankEmoji:string;level:string;}
export interface PlayerLevelRankReadResult{data:string;outboxId:string;rowCount:number;topPlayerId:string|null;topLevel:string|null;}

// 레거시와 동일하게 인자가 없는 정확한 레벨 순위 명령만 허용합니다.
export function isPlayerLevelRankReadCommand(message:string|undefined):boolean{return message==="/레벨순위";}

// 현재 레벨 순서를 레거시 레벨 순위 UI로 변환합니다.
export function formatPlayerLevelRanking(rows:readonly PlayerLevelRankRow[]):string{
  const header="🏆 레벨 순위 🏆\n\n";
  const lines=rows.map((row,index)=>`${index===10?ALLSEE:""}${rankLabel(index+1)}. ${row.rankEmoji}${row.displayName} - LV.${row.level}`);
  return `${header}${lines.join("\n")}`.trim();
}

// 활성 회원의 현재 레벨 순위와 stable 1위 snapshot을 감사·outbox와 원자 기록합니다.
export class PlayerLevelRankReadService{
  constructor(private readonly db:DatabaseClient){}
  async read(input:{eventId:string;externalUserId:string;destinationId:string}):Promise<PlayerLevelRankReadResult>{return this.db.withTransaction(async transaction=>{
    const key=input.eventId.length<=191?input.eventId:`sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    const prior=(await transaction.query<Array<{result_json:string|PlayerLevelRankReadResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='player.level_rank_read' AND idempotency_key=? FOR UPDATE",[key]))[0];
    if(prior?.result_json!=null)return typeof prior.result_json==="string"?JSON.parse(prior.result_json):prior.result_json;
    const rows=await transaction.query<Array<{player_id:bigint;current_display_name:string;rank_emoji:string|null;level:bigint}>>(`SELECT player.id player_id,profile.current_display_name,rank.rank_emoji,profile.level
      FROM players player JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
      WHERE player.status='active' AND player.deleted_at IS NULL
      ORDER BY profile.level DESC,(rank.source_order IS NULL),rank.source_order,player.id FOR UPDATE`);
    const mapped=rows.map(row=>({playerId:row.player_id.toString(),displayName:row.current_display_name,rankEmoji:row.rank_emoji??"",level:row.level.toString()})),top=mapped[0];
    const operationId=(await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.level_rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key])).insertId;
    if(top!==undefined)await transaction.execute("INSERT INTO player_level_rank_snapshots(singleton_key,top_player_id,top_level,source_event_id,updated_at) VALUES(1,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE top_player_id=VALUES(top_player_id),top_level=VALUES(top_level),source_event_id=VALUES(source_event_id),updated_at=VALUES(updated_at)",[top.playerId,top.level,input.eventId]);
    const data=formatPlayerLevelRanking(mapped),outboxId=(await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operationId,input.destinationId,JSON.stringify({data})])).insertId;
    await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PLAYER_LEVEL_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operationId]);
    await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'player.level_rank_read','success','Iris /레벨순위',?,UTC_TIMESTAMP(3))",[operationId,JSON.stringify({externalUserId:input.externalUserId,rowCount:mapped.length,stableIds:mapped.map(row=>row.playerId),topPlayerId:top?.playerId??null,topLevel:top?.level??null,projectionUpdated:top!==undefined})]);
    const result={data,outboxId:outboxId.toString(),rowCount:mapped.length,topPlayerId:top?.playerId??null,topLevel:top?.level??null};await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operationId]);return result;
  });}
}
function rankLabel(rank:number):string{return rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":`${rank}위`;}
