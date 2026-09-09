import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

interface Actor { identity_id: bigint; player_id: bigint }
interface Listing { id: bigint; item_name: string; highest_bidder_player_id: bigint | null; highest_bid: string; version: bigint }
interface Reward { reward_code: string; display_name: string; reward_type_code: "STACK"|"TITLE"|"PET_TITLE"|"PET_EXPERIENCE"|"MINI_PET"|"POINT"; item_id: bigint|null; title_id: bigint|null; mini_pet_definition_id: bigint|null; quantity: bigint }
interface Active { id: bigint; item_name: string; bidder_name: string|null; highest_bid: string; remaining_seconds: bigint }
export interface HoiShopResult { status:"shown"|"empty"; data:string; activeListingIds:string[]; settledListingIds:string[]; cancelledListingIds:string[]; rewardCount:number; outboxId:string; replayed?:boolean }

// 호이상점은 인자 없는 정확 명령만 실행합니다.
export function isHoiShopCommand(message:string|undefined):boolean{return message==="/호이상점";}
function key(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function commas(value:string):string{const integer=value.replace(/\.0+$/,"").split(".")[0]!;return integer.replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function parsed<T>(value:string|T):T{return typeof value==="string"?JSON.parse(value) as T:value;}
function retryable(error:unknown):boolean{const code=(error as{code?:string}).code;return code==="ER_LOCK_DEADLOCK"||code==="ER_LOCK_WAIT_TIMEOUT";}

// 정산 알림과 남은 경매를 고정 순서로 표시합니다.
export function formatHoiShopResult(active:Active[],notices:string[]):string{
  const header="🏪 호이상점\n━━━━━━━━━━━━";
  const list=active.length===0?"등록된 경매 상품이 없습니다.":active.map((row,index)=>`[${index+1}] ${row.item_name}\n남은 시간: ${row.remaining_seconds}초\n현재 입찰자: ${row.bidder_name??"없음"}\n현재 입찰가: 🅟${commas(row.highest_bid)}`).join("\n\n");
  return notices.length===0?`${header}\n${list}`:`${notices.join("\n\n")}\n\n${header}\n${list}`;
}

// 만료 경매 보상을 코드형 규칙에 따라 실제 객체 저장소에 반영합니다.
async function grant(t:DatabaseTransaction,operationId:bigint,sequence:number,playerId:bigint,reward:Reward):Promise<Record<string,string>>{
  if(reward.reward_type_code==="STACK"){
    if(reward.item_id===null)throw new ApplicationError("HOI_SHOP_REWARD_INVALID","경매 가방 보상 정의가 올바르지 않습니다.",409);
    await t.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,0,1)",[playerId,reward.item_id]);
    const stack=(await t.query<Array<{quantity:bigint;version:bigint}>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",[playerId,reward.item_id]))[0]!;
    const after=stack.quantity+reward.quantity;
    if((await t.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[after,playerId,reward.item_id,stack.version])).affectedRows!==1n)throw new Error("HOI_SHOP_STACK_CONFLICT");
    await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES(?,?,?,?,?,'HOI_SHOP_SETTLEMENT')",[operationId,sequence,playerId,reward.item_id,reward.quantity]);
    return{itemId:reward.item_id.toString(),quantityAfter:after.toString()};
  }
  if(reward.reward_type_code==="POINT"){
    await t.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES(?,'point',0,1)",[playerId]);
    const account=(await t.query<Array<{balance:string;version:bigint}>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[playerId]))[0]!;
    const before=BigInt(account.balance.split(".")[0]!),after=before+reward.quantity;
    if((await t.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[after.toString(),playerId,account.version])).affectedRows!==1n)throw new Error("HOI_SHOP_POINT_CONFLICT");
    await t.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?, ?, ?,'point',?,?,'HOI_SHOP_SETTLEMENT')",[operationId,sequence,playerId,reward.quantity.toString(),after.toString()]);
    return{balanceBefore:before.toString(),balanceAfter:after.toString()};
  }
  if(reward.reward_type_code==="TITLE"){
    if(reward.title_id===null)throw new ApplicationError("HOI_SHOP_REWARD_INVALID","경매 타이틀 보상 정의가 올바르지 않습니다.",409);
    const write=await t.execute("INSERT IGNORE INTO player_titles(player_id,title_id,acquired_at,equipped,display_order) SELECT ?,?,UTC_TIMESTAMP(3),FALSE,COALESCE(MAX(display_order),0)+1 FROM player_titles WHERE player_id=?",[playerId,reward.title_id,playerId]);
    return{titleId:reward.title_id.toString(),inserted:(write.affectedRows===1n).toString()};
  }
  if(reward.reward_type_code==="PET_TITLE"){
    if(reward.title_id===null)throw new ApplicationError("HOI_SHOP_REWARD_INVALID","경매 펫타이틀 보상 정의가 올바르지 않습니다.",409);
    const pet=(await t.query<Array<{id:bigint}>>("SELECT id FROM player_pets WHERE player_id=? FOR UPDATE",[playerId]))[0];
    if(pet===undefined)throw new ApplicationError("HOI_SHOP_PET_REQUIRED","펫타이틀을 받을 펫이 없습니다.",409);
    const write=await t.execute("INSERT IGNORE INTO pet_titles(player_pet_id,title_id,acquired_at,equipped) VALUES(?,?,UTC_TIMESTAMP(3),FALSE)",[pet.id,reward.title_id]);
    return{petId:pet.id.toString(),titleId:reward.title_id.toString(),inserted:(write.affectedRows===1n).toString()};
  }
  if(reward.reward_type_code==="PET_EXPERIENCE"){
    const pet=(await t.query<Array<{id:bigint;experience:bigint;version:bigint}>>("SELECT id,experience,version FROM player_pets WHERE player_id=? FOR UPDATE",[playerId]))[0];
    if(pet===undefined)throw new ApplicationError("HOI_SHOP_PET_REQUIRED","펫 보상을 받을 펫이 없습니다.",409);
    const after=pet.experience+reward.quantity;
    if((await t.execute("UPDATE player_pets SET experience=?,version=version+1 WHERE id=? AND version=?",[after,pet.id,pet.version])).affectedRows!==1n)throw new Error("HOI_SHOP_PET_CONFLICT");
    return{petId:pet.id.toString(),experienceAfter:after.toString()};
  }
  if(reward.mini_pet_definition_id===null)throw new ApplicationError("HOI_SHOP_REWARD_INVALID","경매 미니펫 보상 정의가 올바르지 않습니다.",409);
  const next=(await t.query<Array<{value:bigint}>>("SELECT COALESCE(MAX(bag_sequence),0)+1 value FROM owned_mini_pets WHERE player_id=? FOR UPDATE",[playerId]))[0]?.value??1n;
  const write=await t.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,equipped,bag_sequence,version) VALUES(?,?,0,FALSE,?,1)",[playerId,reward.mini_pet_definition_id,next]);
  return{ownedMiniPetId:write.insertId.toString(),bagSequence:next.toString()};
}

// 조회 시점의 만료 경매 정산과 남은 목록 projection을 한 transaction으로 처리합니다.
export class HoiShopService{
  constructor(private readonly db:DatabaseClient){}
  async read(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<HoiShopResult|null>{
    if(!isHoiShopCommand(input.message))return null;
    let last:unknown;for(let attempt=0;attempt<3;attempt+=1){try{return await this.db.withTransaction(t=>this.execute(t,input));}catch(error){last=error;if(!retryable(error)||attempt===2)throw error;}}throw last;
  }
  private async execute(t:DatabaseTransaction,input:{eventId:string;externalUserId:string;destinationId:string}):Promise<HoiShopResult|null>{
    const actor=(await t.query<Actor[]>("SELECT identity.id identity_id,identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE",[input.externalUserId]))[0];
    if(actor===undefined)return null;
    const operation=await t.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'store.hoi_shop.read_settle',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",[randomUUID(),key(input.eventId),actor.identity_id]);
    const claimed=(await t.query<Array<{result_json:string|HoiShopResult|null}>>("SELECT result_json FROM operations WHERE id=? FOR UPDATE",[operation.insertId]))[0]!;
    if(claimed.result_json!==null)return{...parsed<HoiShopResult>(claimed.result_json),replayed:true};
    await t.query("SELECT lock_code FROM admin_global_locks WHERE lock_code='auction_settlement' FOR UPDATE");
    const expired=await t.query<Listing[]>("SELECT id,item_name,highest_bidder_player_id,CAST(highest_bid AS CHAR) highest_bid,version FROM auction_listings WHERE status='active' AND ends_at<=UTC_TIMESTAMP(3) ORDER BY id FOR UPDATE");
    const settled:string[]=[],cancelled:string[]=[],notices:string[]=[];let rewardCount=0,ledgerSequence=1;
    for(const listing of expired){
      if(listing.highest_bidder_player_id===null){
        if((await t.execute("UPDATE auction_listings SET status='cancelled',settlement_operation_id=?,version=version+1,closed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='active' AND version=?",[operation.insertId,listing.id,listing.version])).affectedRows!==1n)throw new Error("HOI_SHOP_LISTING_CONFLICT");
        await t.execute("INSERT INTO auction_settlements(operation_id,listing_id,winner_player_id,highest_bid,result_code,listing_version_before,listing_version_after) VALUES(?,?,NULL,?,'no_bid',?,?)",[operation.insertId,listing.id,listing.highest_bid,listing.version,listing.version+1n]);
        cancelled.push(listing.id.toString());notices.push(`⌛ ${listing.item_name} 경매가 유찰되었습니다.`);continue;
      }
      const rewards=await t.query<Reward[]>(`SELECT catalog.reward_code,catalog.display_name,catalog.reward_type_code,catalog.item_id,catalog.title_id,catalog.mini_pet_definition_id,COALESCE(rule.quantity,catalog.default_quantity) quantity FROM auction_listing_reward_rules rule JOIN auction_reward_catalog catalog ON catalog.reward_code=rule.reward_code AND catalog.active=TRUE WHERE rule.listing_id=? ORDER BY rule.sequence_no FOR UPDATE`,[listing.id]);
      if(rewards.length===0)throw new ApplicationError("HOI_SHOP_REWARD_MISSING",`경매 보상 정의를 찾을 수 없습니다: ${listing.item_name}`,409);
      const settlement=await t.execute("INSERT INTO auction_settlements(operation_id,listing_id,winner_player_id,highest_bid,result_code,listing_version_before,listing_version_after) VALUES(?,?,?,?, 'sold',?,?)",[operation.insertId,listing.id,listing.highest_bidder_player_id,listing.highest_bid,listing.version,listing.version+1n]);
      for(let index=0;index<rewards.length;index+=1){const reward=rewards[index]!,summary=await grant(t,operation.insertId,ledgerSequence++,listing.highest_bidder_player_id,reward);await t.execute("INSERT INTO auction_settlement_rewards(settlement_id,sequence_no,reward_code,reward_type_code,quantity,target_player_id,mutation_summary_json) VALUES(?,?,?,?,?,?,?)",[settlement.insertId,index+1,reward.reward_code,reward.reward_type_code,reward.quantity,listing.highest_bidder_player_id,JSON.stringify(summary)]);rewardCount+=1;}
      if((await t.execute("UPDATE auction_listings SET status='sold',settlement_operation_id=?,version=version+1,closed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='active' AND version=?",[operation.insertId,listing.id,listing.version])).affectedRows!==1n)throw new Error("HOI_SHOP_LISTING_CONFLICT");
      const winner=(await t.query<Array<{name:string}>>("SELECT current_display_name name FROM player_profiles WHERE player_id=?",[listing.highest_bidder_player_id]))[0]?.name??"알 수 없음";
      settled.push(listing.id.toString());notices.push(`✅ ${listing.item_name} 경매가 종료되었습니다.\n낙찰자: ${winner}\n낙찰가: 🅟${commas(listing.highest_bid)}`);
    }
    const active=await t.query<Active[]>(`SELECT listing.id,listing.item_name,profile.current_display_name bidder_name,CAST(listing.highest_bid AS CHAR) highest_bid,GREATEST(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(3),listing.ends_at),0) remaining_seconds FROM auction_listings listing LEFT JOIN player_profiles profile ON profile.player_id=listing.highest_bidder_player_id WHERE listing.status='active' AND listing.ends_at>UTC_TIMESTAMP(3) ORDER BY COALESCE(listing.legacy_original_index,listing.id),listing.id`);
    const data=formatHoiShopResult(active,notices),status=active.length===0?"empty":"shown",activeIds=active.map(row=>row.id.toString());
    const outbox=await t.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);
    await t.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'STORE_HOI_SHOP',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId,status]);
    await t.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',?,'auction_listing',NULL,'store.hoi_shop.read_settle',?,'Iris /호이상점',?,UTC_TIMESTAMP(3))",[operation.insertId,actor.identity_id,status,JSON.stringify({activeListingIds:activeIds,settledListingIds:settled,cancelledListingIds:cancelled,rewardCount})]);
    const result:HoiShopResult={status,data,activeListingIds:activeIds,settledListingIds:settled,cancelledListingIds:cancelled,rewardCount,outboxId:outbox.insertId.toString(),replayed:false};
    await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
  }
}
