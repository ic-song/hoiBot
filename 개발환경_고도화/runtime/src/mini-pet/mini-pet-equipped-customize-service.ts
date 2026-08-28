import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

type CustomizationKind = "appearance" | "name";
interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface EquippedRow { id: bigint; mini_pet_definition_id: bigint; custom_name: string | null; custom_emoji: string | null; version: bigint; definition_name: string; definition_emoji: string | null; }
interface TicketRow { item_id: bigint; quantity: bigint; version: bigint; }
export interface MiniPetEquippedCustomizeCommand { kind: CustomizationKind; value: string; }
export interface MiniPetEquippedCustomizeResult {
  status: "changed" | "usage" | "not_member" | "no_equipped" | "missing_ticket" | "unchanged" | "silent";
  data?: string; outboxId?: string; playerId?: string; ownedMiniPetId?: string;
  kind?: CustomizationKind; value?: string; ticketQuantity?: string;
}
const POLICIES = {
  appearance: { commandCode:"MINI_PET_APPEARANCE_CUSTOMIZE",commandText:"/미니펫외형",maxLength:5,ticketCode:"legacy-mini-pet-appearance-change-ticket",ticketName:"미니펫외형변경권😺(/미니펫외형)",field:"custom_emoji",label:"외형" },
  name: { commandCode:"MINI_PET_NAME_CUSTOMIZE",commandText:"/미니펫이름",maxLength:4,ticketCode:"legacy-mini-pet-name-change-ticket",ticketName:"미니펫이름변경권🙀(/미니펫이름)",field:"custom_name",label:"이름" }
} as const;

// 두 미니펫 customization 대표 명령과 인자형 후보만 분류합니다.
export function isMiniPetEquippedCustomizeCommand(message:string|undefined):boolean {
  return message!==undefined && (message==="/미니펫외형"||message==="/미니펫이름"||/^\/미니펫(?:외형|이름)\s+.+$/.test(message));
}
// 공백 없는 단일 값과 레거시 UTF-16 길이 상한을 비용 차감 전에 검증합니다.
export function parseMiniPetEquippedCustomizeCommand(message:string):MiniPetEquippedCustomizeCommand|undefined {
  const match=/^\/(미니펫외형|미니펫이름)\s+(\S+)$/.exec(message);if(match===null)return undefined;
  const kind:CustomizationKind=match[1]==="미니펫외형"?"appearance":"name",value=match[2]!;
  return value.length<=POLICIES[kind].maxLength?{kind,value}:undefined;
}
function key(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|MiniPetEquippedCustomizeResult):MiniPetEquippedCustomizeResult{return typeof value==="string"?JSON.parse(value)as MiniPetEquippedCustomizeResult:value;}
async function complete(t:DatabaseTransaction,input:{operationId:bigint;eventId:string;channelId:string;identityId:bigint;playerId:bigint;ownedId:string|null;commandCode:string;actionCode:string;resultCode:string;data:string;result:MiniPetEquippedCustomizeResult;summary:Record<string,unknown>}):Promise<MiniPetEquippedCustomizeResult>{
  const out=await t.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.channelId,JSON.stringify({data:input.data})]);
  await t.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.commandCode,input.operationId,input.resultCode]);
  await t.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'owned_mini_pet',?,?,?,'Iris 미니펫 customization',?,UTC_TIMESTAMP(3))",[input.operationId,input.identityId,input.ownedId,input.actionCode,input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,data:input.data,outboxId:out.insertId.toString(),playerId:input.playerId.toString()};
  await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);return result;
}

// 본인의 stable 장착 미니펫과 티켓을 잠가 외형 또는 이름을 한 트랜잭션으로 변경합니다.
export class MiniPetEquippedCustomizeService {
  constructor(private readonly database:DatabaseClient){}
  async handle(input:{eventId:string;externalUserId:string;channelId:string;message:string}):Promise<MiniPetEquippedCustomizeResult>{
    if(!isMiniPetEquippedCustomizeCommand(input.message))return{status:"silent"};
    return this.database.withTransaction(async t=>{
      const owner=(await t.query<OwnerRow[]>("SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL FOR UPDATE",[input.externalUserId]))[0];
      if(owner===undefined)return{status:"not_member"};
      const scope=`mini_pet.equipped.customize:${owner.identity_id.toString()}`;
      const operation=await t.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",[randomUUID(),scope,key(input.eventId),owner.identity_id]);
      const prior=(await t.query<Array<{result_json:string|MiniPetEquippedCustomizeResult|null}>>("SELECT result_json FROM operations WHERE id=? FOR UPDATE",[operation.insertId]))[0];
      if(prior?.result_json!=null)return stored(prior.result_json);
      const command=parseMiniPetEquippedCustomizeCommand(input.message);
      const guessedKind:CustomizationKind=input.message.startsWith("/미니펫외형")?"appearance":"name",policy=POLICIES[command?.kind??guessedKind];
      if(command===undefined)return complete(t,{operationId:operation.insertId,eventId:input.eventId,channelId:input.channelId,identityId:owner.identity_id,playerId:owner.player_id,ownedId:null,commandCode:policy.commandCode,actionCode:`mini_pet.${guessedKind}.customize`,resultCode:"usage",data:`사용법: ${policy.commandText} [공백 없는 ${policy.maxLength}자 이하 값]`,result:{status:"usage"},summary:{mutation:false}});
      const pet=(await t.query<EquippedRow[]>(`SELECT owned.id,owned.mini_pet_definition_id,owned.custom_name,owned.custom_emoji,owned.version,definition.display_name definition_name,definition.emoji_value definition_emoji FROM owned_mini_pets owned JOIN mini_pet_definitions definition ON definition.id=owned.mini_pet_definition_id WHERE owned.player_id=? AND owned.equipped=TRUE ORDER BY owned.id LIMIT 2 FOR UPDATE`,[owner.player_id]))[0];
      if(pet===undefined)return complete(t,{operationId:operation.insertId,eventId:input.eventId,channelId:input.channelId,identityId:owner.identity_id,playerId:owner.player_id,ownedId:null,commandCode:policy.commandCode,actionCode:`mini_pet.${command.kind}.customize`,resultCode:"no_equipped",data:"장착 중인 미니펫이 없습니다.",result:{status:"no_equipped",kind:command.kind,value:command.value},summary:{mutation:false}});
      const previous=command.kind==="appearance"?(pet.custom_emoji??pet.definition_emoji??""):(pet.custom_name??pet.definition_name);
      if(previous===command.value)return complete(t,{operationId:operation.insertId,eventId:input.eventId,channelId:input.channelId,identityId:owner.identity_id,playerId:owner.player_id,ownedId:pet.id.toString(),commandCode:policy.commandCode,actionCode:`mini_pet.${command.kind}.customize`,resultCode:"unchanged",data:`이미 같은 미니펫 ${policy.label}입니다. 변경권을 사용하지 않았습니다.`,result:{status:"unchanged",ownedMiniPetId:pet.id.toString(),kind:command.kind,value:command.value},summary:{mutation:false,previousValue:previous,nextValue:command.value}});
      const ticket=(await t.query<TicketRow[]>(`SELECT stack.item_id,stack.quantity,stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id AND item.active=TRUE AND item.stackable=TRUE WHERE stack.player_id=? AND (item.code=? OR item.display_name=?) ORDER BY item.code=? DESC,item.id LIMIT 1 FOR UPDATE`,[owner.player_id,policy.ticketCode,policy.ticketName,policy.ticketCode]))[0];
      if(ticket===undefined||ticket.quantity<1n)return complete(t,{operationId:operation.insertId,eventId:input.eventId,channelId:input.channelId,identityId:owner.identity_id,playerId:owner.player_id,ownedId:pet.id.toString(),commandCode:policy.commandCode,actionCode:`mini_pet.${command.kind}.customize`,resultCode:"missing_ticket",data:`${policy.ticketName}이 없습니다.`,result:{status:"missing_ticket",ownedMiniPetId:pet.id.toString(),kind:command.kind,value:command.value},summary:{mutation:false}});
      const petUpdate=await t.execute(`UPDATE owned_mini_pets SET ${policy.field}=?,version=version+1 WHERE id=? AND player_id=? AND equipped=TRUE AND version=?`,[command.value,pet.id,owner.player_id,pet.version]);
      if(petUpdate.affectedRows!==1n)throw new Error("MINI_PET_CUSTOMIZE_CONFLICT");
      const nextQuantity=ticket.quantity-1n,ticketUpdate=await t.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[nextQuantity,owner.player_id,ticket.item_id,ticket.version]);
      if(ticketUpdate.affectedRows!==1n)throw new Error("MINI_PET_CUSTOMIZE_INVENTORY_CONFLICT");
      await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,1,?,?,NULL,-1,?)",[operation.insertId,owner.player_id,ticket.item_id,`MINI_PET_${command.kind.toUpperCase()}_CUSTOMIZE`]);
      await t.execute("INSERT INTO mini_pet_customization_ledger(operation_id,player_id,owned_mini_pet_id,customization_type,previous_value,next_value,ticket_item_id,mini_pet_version_before,mini_pet_version_after) VALUES (?,?,?,?,?,?,?,?,?)",[operation.insertId,owner.player_id,pet.id,command.kind,previous,command.value,ticket.item_id,pet.version,pet.version+1n]);
      const data=`미니펫 ${policy.label} 변경이 완료되었습니다.\n변경값: ${command.value}`;
      return complete(t,{operationId:operation.insertId,eventId:input.eventId,channelId:input.channelId,identityId:owner.identity_id,playerId:owner.player_id,ownedId:pet.id.toString(),commandCode:policy.commandCode,actionCode:`mini_pet.${command.kind}.customize`,resultCode:"changed",data,result:{status:"changed",ownedMiniPetId:pet.id.toString(),kind:command.kind,value:command.value,ticketQuantity:nextQuantity.toString()},summary:{mutation:true,previousValue:previous,nextValue:command.value,ticketItemId:ticket.item_id.toString(),ticketQuantity:nextQuantity.toString(),versionBefore:pet.version.toString(),versionAfter:(pet.version+1n).toString()}});
    });
  }
}
