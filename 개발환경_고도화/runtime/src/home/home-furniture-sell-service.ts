import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export type HomeFurnitureSellCommand = { kind: "usage" } | { kind: "index"; index: bigint };
export interface HomeFurnitureSellResult { status: "sold" | "rejected"; reply: string; outboxId: string; furnitureInstanceId?: string; rewardPoint?: string; }

type Owner = { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null };
type Furniture = { id: bigint; display_name: string; charm_snapshot: bigint; grade_display_name: string; version: bigint };

// 레거시와 동일하게 정확한 사용법 또는 숫자 한 개 형식만 실행 후보로 봅니다.
export function isHomeFurnitureSellCandidate(message: string | undefined): boolean {
  return message === "/가구판매" || (message !== undefined && /^\/가구판매\s+\d+$/.test(message));
}

export function normalizeHomeFurnitureSellDispatchMessage(message: string): string {
  return isHomeFurnitureSellCandidate(message) ? "/가구판매" : message;
}

export function parseHomeFurnitureSellCommand(message: string): HomeFurnitureSellCommand {
  if (message === "/가구판매") return { kind: "usage" };
  const match = /^\/가구판매\s+(\d+)$/.exec(message);
  return match === null ? { kind: "usage" } : { kind: "index", index: BigInt(match[1]!) };
}

function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | HomeFurnitureSellResult): HomeFurnitureSellResult { return typeof value === "string" ? JSON.parse(value) as HomeFurnitureSellResult : value; }
function whole(value: string | bigint): bigint { const text=String(value); if(!/^\d+(?:\.0+)?$/.test(text))throw new Error(`정수 포인트 정책이 아닙니다: ${text}`); return BigInt(text.split(".")[0]!); }

// 레거시 단건 판매 완료 문구를 stable 인스턴스 값으로 투영합니다.
export function formatHomeFurnitureSellReply(nickname: string, furnitureName: string, charm: bigint, reward: bigint): string {
  return `🏡[${nickname}]님,\n${furnitureName}(+${commas(charm)}💕) 을(를)\n가구정리센터에 보냈습니다.\n\n🅟${commas(reward)} 를 획득합니다.`;
}

async function complete(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; identityId: bigint; playerId: bigint; furnitureInstanceId: bigint | null; resultCode: string; reply: string; result: Omit<HomeFurnitureSellResult,"reply"|"outboxId">; summary: Record<string,unknown> }): Promise<HomeFurnitureSellResult> {
  const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data:input.reply})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_FURNITURE_SELL',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'furniture_inventory',?,'home.furniture_sell',?,'Iris /가구판매',?,UTC_TIMESTAMP(3))",[input.operationId,input.identityId,input.furnitureInstanceId,input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,reply:input.reply,outboxId:outbox.insertId.toString()} as HomeFurnitureSellResult;
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);
  return result;
}

// stable 가방 번호의 가구 한 개를 판매하고 포인트와 양쪽 원장을 원자 기록합니다.
export class HomeFurnitureSellService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<HomeFurnitureSellResult>{
    const command=parseHomeFurnitureSellCommand(input.message);
    return this.database.withTransaction(async transaction=>{
      const owner=(await transaction.query<Owner[]>("SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE",[input.externalUserId]))[0];
      if(owner===undefined)throw new Error("가입된 사용자 정보를 찾을 수 없습니다.");
      const prior=(await transaction.query<Array<{result_json:string|HomeFurnitureSellResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='home.furniture_sell' AND idempotency_key=? FOR UPDATE",[eventKey(input.eventId)]))[0];
      if(prior?.result_json!=null)return stored(prior.result_json);
      const operationId=(await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.furniture_sell',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),eventKey(input.eventId),owner.identity_id])).insertId;
      const nickname=`${owner.rank_emoji??""}${owner.display_name}`;
      const reject=(code:string,reply:string,summary:Record<string,unknown>={})=>complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,identityId:owner.identity_id,playerId:owner.player_id,furnitureInstanceId:null,resultCode:code,reply,result:{status:"rejected"},summary:{mutation:false,...summary}});
      if(command.kind==="usage")return reject("usage","사용법: /가구판매 번호\n예) /가구판매 2");
      if(command.index<1n)return reject("invalid_index",`❌[${nickname}]님, 번호를 올바르게 입력해주세요.\n예) /가구판매 1`,{requestedIndex:command.index.toString()});
      const bag=await transaction.query<Furniture[]>("SELECT instance.id,definition.display_name,instance.charm_snapshot,instance.grade_display_name,instance.version FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE instance.player_id=? AND instance.status='bag' ORDER BY instance.charm_snapshot DESC,definition.display_name COLLATE utf8mb4_unicode_ci,instance.id FOR UPDATE",[owner.player_id]);
      if(bag.length===0)return reject("empty",`[${nickname}]님, 판매 가능한 가구가 없습니다.`);
      if(command.index>BigInt(bag.length))return reject("not_found",`❌[${nickname}]님, 해당 번호의 가구가 없습니다.`,{requestedIndex:command.index.toString(),bagCount:bag.length});
      const selected=bag[Number(command.index-1n)]!;
      const policy=(await transaction.query<Array<{point_per_item:string}>>("SELECT CAST(cleanup_point_per_item AS CHAR) point_per_item FROM home_furniture_bag_policy WHERE policy_key='default' FOR UPDATE"))[0];
      if(policy===undefined)throw new Error("가구 판매 포인트 정책을 찾을 수 없습니다.");
      const reward=whole(policy.point_per_item);
      await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)",[owner.player_id]);
      const account=(await transaction.query<Array<{balance:string;version:bigint}>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[owner.player_id]))[0]!;
      const before=whole(account.balance),after=before+reward;
      const changed=await transaction.execute("UPDATE furniture_inventory_instances SET status='sold',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND player_id=? AND status='bag' AND version=?",[selected.id,owner.player_id,selected.version]);
      if(changed.affectedRows!==1n)throw new Error("가구 가방이 먼저 변경되었습니다.");
      await transaction.execute("INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,1,?,?,'bag','sold','HOME_FURNITURE_SELL')",[operationId,owner.player_id,selected.id]);
      const pointWrite=await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[after.toString(),owner.player_id,account.version]);
      if(pointWrite.affectedRows!==1n)throw new Error("포인트 정보가 먼저 변경되었습니다.");
      await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'HOME_FURNITURE_SELL_REWARD')",[operationId,owner.player_id,reward.toString(),after.toString()]);
      await transaction.execute("INSERT INTO home_furniture_sell_operations(operation_id,player_id,furniture_instance_id,selected_bag_index,furniture_name_snapshot,charm_snapshot,grade_display_name_snapshot,reward_point,point_before,point_after) VALUES (?,?,?,?,?,?,?,?,?,?)",[operationId,owner.player_id,selected.id,command.index,selected.display_name,selected.charm_snapshot,selected.grade_display_name,reward.toString(),before.toString(),after.toString()]);
      const reply=formatHomeFurnitureSellReply(nickname,selected.display_name,BigInt(selected.charm_snapshot),reward);
      return complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,identityId:owner.identity_id,playerId:owner.player_id,furnitureInstanceId:selected.id,resultCode:"sold",reply,result:{status:"sold",furnitureInstanceId:selected.id.toString(),rewardPoint:reward.toString()},summary:{mutation:true,playerId:owner.player_id.toString(),selectedBagIndex:command.index.toString(),furnitureInstanceId:selected.id.toString(),statusBefore:"bag",statusAfter:"sold",rewardPoint:reward.toString(),pointBefore:before.toString(),pointAfter:after.toString()}});
    });
  }
}
