import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { compareLegacyBagItems } from "../inventory/legacy-bag-formatter.js";
import { ApplicationError } from "../shared/application-error.js";

const ALIAS = "/당근";
const UINT64_MAX = 18_446_744_073_709_551_615n;

interface PlayerRow { player_id: bigint; display_name: string; tier_code: string | null; rank_emoji: string | null }
interface IdentityRow { identity_id: bigint; player_id: bigint }
interface BagRow { item_id: bigint; item_code: string; display_name: string; quantity: bigint; version: bigint; legacy_bag_order: number | null }
interface PolicyRow { carrot_item_code: string; thermometer_item_code: string; carrot_fee_per_unit: bigint; thermometer_reward: bigint; sender_counter_increment: bigint; stack_slot_limit: bigint }
interface ItemRow { id: bigint; code: string }
interface StackRow { player_id: bigint; item_id: bigint; quantity: bigint; version: bigint }

export interface CarrotTradeCommand { targetName: string; sourceIndex: bigint; quantity: bigint }
export interface CarrotTradeResult {
  status: "traded" | "rejected" | "usage";
  data: string;
  outboxId: string;
  senderPlayerId?: string;
  recipientPlayerId?: string;
  itemId?: string;
  quantity?: string;
  carrotFee?: string;
  thermometerReward?: string;
  replayed: boolean;
}

// `/당근`과 공백 인자형만 후보로 허용해 인접 명령 충돌을 막습니다.
export function isCarrotTradeCandidate(message: string | undefined): boolean {
  return message === ALIAS || message?.startsWith(`${ALIAS} `) === true;
}

// 공백 포함 닉네임과 마지막 양의 uint64 가방번호·수량을 해석합니다.
export function parseCarrotTradeCommand(message: string): CarrotTradeCommand | undefined {
  const match = /^\/당근\s+(.+)\s+([1-9]\d*)\s+([1-9]\d*)$/.exec(message);
  if (match === null || match[1]!.trim() === "") return undefined;
  const sourceIndex = BigInt(match[2]!);
  const quantity = BigInt(match[3]!);
  if (sourceIndex > UINT64_MAX || quantity > UINT64_MAX) return undefined;
  return { targetName: match[1]!.trim(), sourceIndex, quantity };
}

// 당근 거래 후보를 대표 DB alias로 정규화합니다.
export function normalizeCarrotTradeDispatchMessage(message: string): string {
  return isCarrotTradeCandidate(message) ? ALIAS : message;
}

// 안정 가방 순번과 정책을 고정해 아이템·수수료·온도기·누적 카운터를 원자 이전합니다.
export class CarrotTradeService {
  constructor(private readonly db: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<CarrotTradeResult | null> {
    if (!isCarrotTradeCandidate(input.message)) return null;
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.withTransaction((transaction) => this.execute(transaction, input));
      } catch (error) {
        last = error;
        const code = (error as { code?: string }).code;
        if ((code !== "ER_LOCK_DEADLOCK" && code !== "ER_LOCK_WAIT_TIMEOUT") || attempt === 2) throw error;
      }
    }
    throw last;
  }

  private async execute(t: DatabaseTransaction, input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<CarrotTradeResult | null> {
    const identity = (await t.query<IdentityRow[]>(`SELECT identity.id identity_id,identity.player_id
      FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
    if (identity === undefined) return null;
    const key = eventKey(input.eventId);
    const prior = (await t.query<Array<{ result_json: string | CarrotTradeResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope='market.carrot.trade' AND idempotency_key=? FOR UPDATE", [key]
    ))[0];
    if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
    if (prior !== undefined) throw new ApplicationError("CARROT_TRADE_IN_PROGRESS", "당근 거래가 처리 중입니다.", 409);
    const operation = await t.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.carrot.trade',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(),key,identity.identity_id]);
    const command = parseCarrotTradeCommand(input.message);
    if (command === undefined) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:null,resultCode:"usage",actionCode:"market.carrot.trade.reject",data:"사용법: /당근 [받을유저닉] [가방번호] [수량]",result:{ status:"usage" },summary:{ mutation:false } });

    const targetId = (await t.query<Array<{ player_id: bigint }>>("SELECT player_id FROM player_profiles WHERE current_display_name=? LIMIT 1", [command.targetName]))[0]?.player_id;
    if (targetId === undefined) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:null,resultCode:"target_not_found",actionCode:"market.carrot.trade.reject",data:"거래 대상 유저를 찾을 수 없습니다.",result:{ status:"rejected" },summary:{ mutation:false,targetName:command.targetName } });
    const players = await t.query<PlayerRow[]>(`SELECT player.id player_id,profile.current_display_name display_name,profile.tier_code,rank.rank_emoji
      FROM players player JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
      WHERE player.id IN (?,?) AND player.status='active' AND player.deleted_at IS NULL ORDER BY player.id FOR UPDATE`, [identity.player_id,targetId]);
    const sender = players.find((row) => row.player_id === identity.player_id);
    const recipient = players.find((row) => row.player_id === targetId);
    if (sender === undefined || recipient === undefined) throw new ApplicationError("CARROT_TRADE_PLAYER_REQUIRED", "거래 회원 정보를 찾을 수 없습니다.", 409);
    if (sender.player_id === recipient.player_id) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"self_trade",actionCode:"market.carrot.trade.reject",data:"본인에게는 당근 거래를 할 수 없습니다.",result:{ status:"rejected" },summary:{ mutation:false } });
    if (!(await eligible(t,sender.tier_code))) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"sender_tier_required",actionCode:"market.carrot.trade.reject",data:`❌[${sender.rank_emoji ?? ""}${sender.display_name}]님 당근 거래는 티어 👑킹 이상부터 가능합니다.`,result:{ status:"rejected" },summary:{ mutation:false,tierCode:sender.tier_code } });
    if (!(await eligible(t,recipient.tier_code))) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"recipient_tier_required",actionCode:"market.carrot.trade.reject",data:`❌[${recipient.rank_emoji ?? ""}${recipient.display_name}]님은 티어 👑킹 미만이라 당근 거래 물품을 받을 수 없습니다.`,result:{ status:"rejected" },summary:{ mutation:false,targetTierCode:recipient.tier_code } });

    const policy = (await t.query<PolicyRow[]>("SELECT carrot_item_code,thermometer_item_code,carrot_fee_per_unit,thermometer_reward,sender_counter_increment,stack_slot_limit FROM market_carrot_trade_policy WHERE policy_key='default' FOR UPDATE"))[0];
    if (policy === undefined) throw new ApplicationError("CARROT_TRADE_POLICY_REQUIRED", "당근 거래 정책을 찾을 수 없습니다.", 409);
    if (policy.carrot_fee_per_unit <= 0n) throw new ApplicationError("CARROT_TRADE_POLICY_INVALID", "당근 거래 수수료 정책이 올바르지 않습니다.", 409);
    if (command.quantity > UINT64_MAX / policy.carrot_fee_per_unit) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"quantity_overflow",actionCode:"market.carrot.trade.reject",data:"거래 수량이 너무 큽니다.",result:{ status:"rejected" },summary:{ mutation:false } });
    const selected = await resolveBagItem(t,sender.player_id,command.sourceIndex);
    if (selected === undefined || selected.quantity < command.quantity) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"item_shortage",actionCode:"market.carrot.trade.reject",data:"가방번호 또는 거래 수량을 확인해 주세요.",result:{ status:"rejected" },summary:{ mutation:false,sourceIndex:command.sourceIndex.toString(),quantity:command.quantity.toString() } });
    const restricted = (await t.query<Array<{ blocked: bigint }>>("SELECT COUNT(*) blocked FROM item_restrictions WHERE restriction_kind='carrot_trade' AND active=TRUE AND ((item_code IS NOT NULL AND item_code=?) OR display_name=?)", [selected.item_code,selected.display_name]))[0]?.blocked ?? 0n;
    if (restricted > 0n) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"item_restricted",actionCode:"market.carrot.trade.reject",data:`${selected.display_name} 아이템은 당근 거래가 금지되어 있습니다.`,result:{ status:"rejected" },summary:{ mutation:false,itemId:selected.item_id.toString() } });
    const items = await t.query<ItemRow[]>("SELECT id,code FROM item_definitions WHERE code IN (?,?) AND active=TRUE AND stackable=TRUE ORDER BY id", [policy.carrot_item_code,policy.thermometer_item_code]);
    const carrotItem = items.find((row) => row.code === policy.carrot_item_code);
    const thermometerItem = items.find((row) => row.code === policy.thermometer_item_code);
    if (carrotItem === undefined || thermometerItem === undefined) throw new ApplicationError("CARROT_TRADE_ITEMS_REQUIRED", "당근 거래 아이템 설정을 찾을 수 없습니다.", 409);
    const recipientOwns = String((await t.query<Array<{ found: bigint | number }>>("SELECT EXISTS(SELECT 1 FROM inventory_stacks WHERE player_id=? AND item_id=? AND quantity>0) found", [recipient.player_id,selected.item_id]))[0]?.found ?? 0) === "1";
    const recipientSlots = (await t.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM inventory_stacks WHERE player_id=? AND quantity>0 FOR UPDATE", [recipient.player_id]))[0]?.count_value ?? 0n;
    if (!recipientOwns && recipientSlots >= policy.stack_slot_limit) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"recipient_bag_full",actionCode:"market.carrot.trade.reject",data:"상대 가방 공간이 부족합니다.",result:{ status:"rejected" },summary:{ mutation:false,recipientSlots:recipientSlots.toString(),limit:policy.stack_slot_limit.toString() } });

    await t.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0),(?,?,0,0)", [recipient.player_id,selected.item_id,recipient.player_id,thermometerItem.id]);
    const stacks = await t.query<StackRow[]>(`SELECT player_id,item_id,quantity,version FROM inventory_stacks
      WHERE (player_id=? AND item_id IN (?,?)) OR (player_id=? AND item_id IN (?,?)) ORDER BY player_id,item_id FOR UPDATE`,
      [sender.player_id,selected.item_id,carrotItem.id,recipient.player_id,selected.item_id,thermometerItem.id]);
    const carrotFee = command.quantity * policy.carrot_fee_per_unit;
    const deltas = new Map<string,{ playerId:bigint;itemId:bigint;delta:bigint }>();
    addDelta(deltas,sender.player_id,selected.item_id,-command.quantity);
    addDelta(deltas,sender.player_id,carrotItem.id,-carrotFee);
    addDelta(deltas,recipient.player_id,selected.item_id,command.quantity);
    addDelta(deltas,recipient.player_id,thermometerItem.id,policy.thermometer_reward);
    const orderedDeltas = [...deltas.values()].sort((left,right) => left.playerId===right.playerId ? (left.itemId<right.itemId?-1:left.itemId>right.itemId?1:0) : left.playerId<right.playerId?-1:1);
    for (const delta of orderedDeltas) {
      const stack = stacks.find((row) => row.player_id===delta.playerId && row.item_id===delta.itemId);
      if (stack === undefined || stack.quantity + delta.delta < 0n) return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"insufficient_carrot",actionCode:"market.carrot.trade.reject",data:`당근 거래 수수료 당근🥕 ${carrotFee}개가 부족합니다.`,result:{ status:"rejected" },summary:{ mutation:false,requiredCarrot:carrotFee.toString() } });
    }
    for (const delta of orderedDeltas) {
      const stack = stacks.find((row) => row.player_id===delta.playerId && row.item_id===delta.itemId);
      if (stack === undefined) throw new ApplicationError("CARROT_TRADE_STACK_REQUIRED", "거래 가방 정보를 찾을 수 없습니다.", 409);
      const changed = await t.execute("UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [delta.delta,delta.playerId,delta.itemId,stack.version]);
      if (changed.affectedRows !== 1n) throw new ApplicationError("CARROT_TRADE_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
    }
    await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'CARROT_TRADE_ITEM_DEBIT'),(?,2,?,?,?,'CARROT_TRADE_FEE'),(?,3,?,?,?,'CARROT_TRADE_ITEM_CREDIT'),(?,4,?,?,?,'CARROT_TRADE_THERMOMETER')", [operation.insertId,sender.player_id,selected.item_id,-command.quantity,operation.insertId,sender.player_id,carrotItem.id,-carrotFee,operation.insertId,recipient.player_id,selected.item_id,command.quantity,operation.insertId,recipient.player_id,thermometerItem.id,policy.thermometer_reward]);
    await t.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'carrot_given','lifetime',?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE value=value+VALUES(value),updated_at=UTC_TIMESTAMP(3)", [sender.player_id,policy.sender_counter_increment]);
    await t.execute("INSERT INTO market_carrot_trade_events(operation_id,sender_player_id,recipient_player_id,item_id,source_index,quantity,carrot_item_id,carrot_fee,thermometer_item_id,thermometer_reward,sender_counter_increment) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId,sender.player_id,recipient.player_id,selected.item_id,command.sourceIndex,command.quantity,carrotItem.id,carrotFee,thermometerItem.id,policy.thermometer_reward,policy.sender_counter_increment]);
    const data=`🥕 당근 거래 완료!\n[${sender.rank_emoji ?? ""}${sender.display_name}] 님 → [${recipient.rank_emoji ?? ""}${recipient.display_name}] 님\n${selected.display_name} ${commas(command.quantity)}개를 보냈습니다.\n수수료: 당근🥕 ${commas(carrotFee)}개\n지급: 당근온도기🌡️ ${commas(policy.thermometer_reward)}개`;
    return complete(t,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,identityId:identity.identity_id,targetId:recipient.player_id,resultCode:"traded",actionCode:"market.carrot.trade",data,result:{ status:"traded",senderPlayerId:sender.player_id.toString(),recipientPlayerId:recipient.player_id.toString(),itemId:selected.item_id.toString(),quantity:command.quantity.toString(),carrotFee:carrotFee.toString(),thermometerReward:policy.thermometer_reward.toString() },summary:{ sourceIndex:command.sourceIndex.toString(),itemId:selected.item_id.toString(),quantity:command.quantity.toString(),carrotFee:carrotFee.toString(),thermometerReward:policy.thermometer_reward.toString() } });
  }
}

// 현재 킹 이상 등록 정책을 거래 자격 기준으로 재사용합니다.
async function eligible(t: DatabaseTransaction,tierCode:string|null):Promise<boolean>{return ((await t.query<Array<{allowed:bigint}>>("SELECT COUNT(*) allowed FROM market_registration_tier_policies WHERE tier_code=? AND can_register=TRUE",[tierCode]))[0]?.allowed??0n)>0n;}

// 레거시 `/가방` 정렬 결과의 순번을 stable item row로 고정합니다.
async function resolveBagItem(t:DatabaseTransaction,playerId:bigint,index:bigint):Promise<BagRow|undefined>{const rows=await t.query<BagRow[]>(`SELECT stack.item_id,item.code item_code,item.display_name,stack.quantity,stack.version,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.legacyBagOrder')) AS SIGNED) legacy_bag_order
  FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id AND item.active=TRUE
  WHERE stack.player_id=? AND stack.quantity>0 FOR UPDATE`,[playerId]);const ordered=rows.sort((left,right)=>compareLegacyBagItems({displayName:left.display_name,quantity:left.quantity.toString(),legacyBagOrder:left.legacy_bag_order===null?null:Number(left.legacy_bag_order)},{displayName:right.display_name,quantity:right.quantity.toString(),legacyBagOrder:right.legacy_bag_order===null?null:Number(right.legacy_bag_order)}));return index>BigInt(ordered.length)?undefined:ordered[Number(index-1n)];}

// 같은 player/item 조합의 자산·수수료 delta를 합산합니다.
function addDelta(values:Map<string,{playerId:bigint;itemId:bigint;delta:bigint}>,playerId:bigint,itemId:bigint,delta:bigint):void{const key=`${playerId}:${itemId}`,current=values.get(key);values.set(key,{playerId,itemId,delta:(current?.delta??0n)+delta});}

// 응답·execution·감사·operation을 현재 transaction에서 완료합니다.
async function complete(t:DatabaseTransaction,input:{operationId:bigint;eventId:string;destinationId:string;identityId:bigint;targetId:bigint|null;resultCode:string;actionCode:string;data:string;result:Omit<CarrotTradeResult,"data"|"outboxId"|"replayed">;summary:Record<string,unknown>}):Promise<CarrotTradeResult>{const outbox=await t.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data:input.data})]);await t.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MARKET_CARROT_TRADE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.operationId,input.resultCode]);await t.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris /당근',?,UTC_TIMESTAMP(3))",[input.operationId,input.identityId,input.targetId,input.actionCode,input.resultCode,JSON.stringify(input.summary)]);const result={...input.result,data:input.data,outboxId:outbox.insertId.toString(),replayed:false} as CarrotTradeResult;await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);return result;}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|CarrotTradeResult):CarrotTradeResult{return typeof value==="string"?JSON.parse(value):value;}
function commas(value:bigint):string{return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");}
