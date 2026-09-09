import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

interface Actor { identity_id: bigint; player_id: bigint; }
interface Post { post_id: bigint; author_name: string; rank_emoji: string | null; body: string; legacy_date: string; }
export interface CarrotBoardReadResult { status:"shown"|"empty"; data:string; count:number; postIds:string[]; outboxId:string; }

// 당근게시판 명령은 공백이나 안내 문구가 없는 exact 형식만 허용합니다.
export function isCarrotBoardReadCommand(message:string|undefined):boolean { return message==="/당근게시판"; }
function key(value:string):string { return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`; }

// 레거시 순서와 여섯 번째 글 앞 500자 펼침 경계를 보존합니다.
export function formatCarrotBoard(posts:Post[]):string {
  const header="🥕 당근게시판\n━━━━━━━━━━━━";
  if(posts.length===0)return `${header}\n등록된 게시글이 없습니다.`;
  let out=header;
  posts.forEach((post,index)=>{
    if(index===5)out+=`\n${"\u200b".repeat(500)}`;
    out+=`\n\n${post.rank_emoji??""}${post.author_name}\n${post.body}\n${post.legacy_date}`;
  });
  return out;
}

async function finish(t:DatabaseTransaction,input:{operationId:bigint;eventId:string;destinationId:string;actor:Actor;posts:Post[]}):Promise<CarrotBoardReadResult>{
  const data=formatCarrotBoard(input.posts),postIds=input.posts.map(p=>p.post_id.toString()),status=input.posts.length===0?"empty":"shown";
  const outbox=await t.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data})]);
  await t.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MARKET_CARROT_BOARD_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.operationId,status]);
  await t.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'carrot_board',NULL,'market.carrot_board.read',?,'Iris carrot board read',?,UTC_TIMESTAMP(3))",[input.operationId,input.actor.identity_id,status,JSON.stringify({count:input.posts.length,postIds,mutation:false})]);
  const result={status,data,count:input.posts.length,postIds,outboxId:outbox.insertId.toString()} as CarrotBoardReadResult;
  await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]); return result;
}

// 동일 event의 동시 조회는 제한 재시도와 operation replay로 한 번만 기록합니다.
export class CarrotBoardReadService {
  constructor(private readonly database:DatabaseClient){}
  async read(input:{eventId:string;externalUserId:string;destinationId:string}):Promise<CarrotBoardReadResult|null>{
    let last:unknown;
    for(let attempt=0;attempt<3;attempt+=1){try{return await this.database.withTransaction(async t=>{
      const actors=await t.query<Actor[]>("SELECT identity.id identity_id,identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE",[input.externalUserId]); const actor=actors[0]; if(actor===undefined)return null;
      const eventKey=key(input.eventId),prior=await t.query<Array<{result_json:string|CarrotBoardReadResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='market.carrot_board.read' AND idempotency_key=? FOR UPDATE",[eventKey]);
      if(prior[0]?.result_json!=null)return typeof prior[0].result_json==="string"?JSON.parse(prior[0].result_json):prior[0].result_json;
      const operation=await t.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.carrot_board.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),eventKey,actor.identity_id]);
      const posts=await t.query<Post[]>(`SELECT post.id post_id,post.author_name_snapshot author_name,CASE WHEN player.status='active' THEN rank.rank_emoji ELSE NULL END rank_emoji,post.body,post.legacy_date FROM carrot_board_posts post LEFT JOIN players player ON player.id=post.author_player_id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE post.status='published' AND post.deleted_at IS NULL ORDER BY post.source_order ASC,post.id ASC`);
      return finish(t,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,posts});
    });}catch(error){last=error;const code=(error as {code?:string}).code;if(code!=="ER_LOCK_DEADLOCK"&&code!=="ER_LOCK_WAIT_TIMEOUT")throw error;}}
    throw last;
  }
}
