import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALL_SEE="\u200b".repeat(500);
export interface SpiritRankRow { playerId:string; displayName:string; rankEmoji:string; gradeOrder:number; enhancementLevel:bigint; sourceOrder:bigint; }
export interface SpiritRankResult { data:string; outboxId:string; rowCount:number; }

// `/정령순위` 정확 일치만 현대화 후보로 허용합니다.
export function isSpiritRankCommand(message:string|undefined):boolean { return message==="/정령순위"; }

// 레거시 grade index 점수와 상위 10명 allsee 분할을 그대로 렌더링합니다.
export function formatSpiritRanking(rows:SpiritRankRow[]):string {
  const labels=(rank:number)=>rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":`${rank}위 `;
  const lines=rows.map((entry,index)=>`${labels(index+1)}${entry.rankEmoji}${entry.displayName} - 강화 레벨: ${(BigInt(entry.gradeOrder-1)*100n+entry.enhancementLevel).toString()}🔯\n`);
  return `🔯 정령 강화순위 🔯\n\n${lines.slice(0,10).join("")}${ALL_SEE}${lines.slice(10).join("")}`;
}

// 정령 순위를 일관된 DB 읽기·감사·outbox transaction으로 제공합니다.
export class SpiritRankService {
  constructor(private readonly database:DatabaseClient){}
  async read(input:{eventId:string;externalUserId:string;destinationId:string}):Promise<SpiritRankResult>{
    return this.database.withTransaction(async(transaction)=>{
      const key=input.eventId.length<=191?input.eventId:`sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior=await transaction.query<Array<{result_json:string|SpiritRankResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='spirit.rank_read' AND idempotency_key=? FOR UPDATE",[key]);
      if(prior[0]?.result_json!=null)return typeof prior[0].result_json==="string"?JSON.parse(prior[0].result_json) as SpiritRankResult:prior[0].result_json;
      const rows=await transaction.query<Array<{player_id:bigint;current_display_name:string;rank_emoji:string;grade_order:number;enhancement_level:bigint;source_order:bigint}>>(`SELECT profile.player_id,profile.current_display_name,rank_profile.rank_emoji,grade.grade_order,elemental.enhancement_level,rank_profile.source_order
        FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active'
        JOIN player_pets pet ON pet.player_id=profile.player_id JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
        JOIN elemental_enhancement_grades grade ON grade.grade_code=elemental.grade_code
        JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=profile.player_id
        ORDER BY (grade.grade_order*100+elemental.enhancement_level) DESC,rank_profile.source_order ASC,profile.player_id ASC FOR UPDATE`);
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'spirit.rank_read',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key]);
      const mapped=rows.map(r=>({playerId:r.player_id.toString(),displayName:r.current_display_name,rankEmoji:r.rank_emoji,gradeOrder:r.grade_order,enhancementLevel:BigInt(r.enhancement_level),sourceOrder:BigInt(r.source_order)}));
      const data=formatSpiritRanking(mapped);
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'SPIRIT_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'leaderboard',NULL,'spirit.rank_read','success','Iris /정령순위',?,UTC_TIMESTAMP(3))",[operation.insertId,JSON.stringify({externalUserId:input.externalUserId,rowCount:mapped.length})]);
      const result={data,outboxId:outbox.insertId.toString(),rowCount:mapped.length};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}
