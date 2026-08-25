import{createHash,randomUUID}from"node:crypto";import type{DatabaseClient}from"../database.js";import{ApplicationError}from"../shared/application-error.js";
const GIFT_CODE="hoi_support_free_2",EXPECTED_ROOMS=[1,2,3,5,6,7,10,11,12,13,90]as const;
export interface GlobalGiftCommand{externalUserId:string;channelId:string;message:string;eventId:string;}
export interface GlobalGiftResult{status:"distributed";giftCode:string;itemCode:string;recipientCount:string;giftQuantity:string;outboxIds:string[];auditId:string;data:string;replayed?:boolean;}
// 전체회원 선물 지급은 정확한 인자 없는 명령만 인정합니다.
export function isGlobalGiftCommand(message:string|undefined):boolean{return message==="/선물전달";}
// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function keyOf(id:string):string{return id.length<=191?id:`sha256:${createHash("sha256").update(id).digest("hex")}`;}
// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(v:string|GlobalGiftResult):GlobalGiftResult{const r=typeof v==="string"?JSON.parse(v)as GlobalGiftResult:v;return{...r,replayed:true};}

// 활성 회원 snapshot 전체에 선물과 11개 공지를 원자적으로 적재합니다.
export class GlobalGiftDistributeService{
 constructor(private readonly database:DatabaseClient){}
 async execute(command:GlobalGiftCommand):Promise<GlobalGiftResult>{
  if(!isGlobalGiftCommand(command.message))throw new ApplicationError("INVALID_GLOBAL_GIFT_COMMAND","정확한 /선물전달을 입력해주세요.",422);
  return this.database.withTransaction(async tx=>{
   const operators=await tx.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity
    JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id
    JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
    WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active'
      AND permission.permission_code='inventory.global-gift.distribute' LIMIT 1 FOR UPDATE`,[command.externalUserId]);
   const operator=operators[0];if(operator===undefined)throw new ApplicationError("FORBIDDEN","전체 선물 지급 권한이 없습니다.",403);
   const scope=`admin.global-gift:${operator.operator_id}`,key=keyOf(command.eventId);
   const prior=await tx.query<Array<{result_json:string|GlobalGiftResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
   if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null)return stored(prior[0].result_json);
   const definitions=await tx.query<Array<{item_id:bigint;item_code:string;quantity:bigint;announcement_text:string}>>(`SELECT item.id item_id,item.code item_code,gift.quantity,gift.announcement_text
    FROM global_gift_definitions gift JOIN item_definitions item ON item.code=gift.item_code
    WHERE gift.code=? AND gift.active=TRUE AND item.active=TRUE AND item.stackable=TRUE`,[GIFT_CODE]);
   const gift=definitions[0];if(gift===undefined)throw new ApplicationError("GLOBAL_GIFT_DEFINITION_REQUIRED","전체 선물 설정을 찾을 수 없습니다.",409);
   const channels=await tx.query<Array<{legacy_room_code:number;delivery_order:number;external_channel_id:string}>>("SELECT legacy_room_code,delivery_order,external_channel_id FROM global_gift_broadcast_channels WHERE gift_code=? AND status='active' ORDER BY delivery_order FOR UPDATE",[GIFT_CODE]);
   if(channels.length!==EXPECTED_ROOMS.length||channels.some((c,i)=>c.legacy_room_code!==EXPECTED_ROOMS[i]||c.delivery_order!==i+1))throw new ApplicationError("GLOBAL_GIFT_CHANNELS_REQUIRED","전체 선물 공지 채널 11개 설정이 필요합니다.",409);
   const recipients=await tx.query<Array<{player_id:bigint}>>("SELECT id player_id FROM players WHERE status='active' ORDER BY id FOR UPDATE");
   if(recipients.length===0)throw new ApplicationError("GLOBAL_GIFT_RECIPIENT_REQUIRED","선물을 받을 활성 회원이 없습니다.",409);
   const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,operator.operator_id]);
   for(let i=0;i<recipients.length;i++){
    const playerId=recipients[i]!.player_id;await tx.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version)VALUES(?,?,0,1)",[playerId,gift.item_id]);
    const rows=await tx.query<Array<{quantity:bigint;version:bigint}>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",[playerId,gift.item_id]);const stack=rows[0]!,after=stack.quantity+gift.quantity;
    const changed=await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[after,playerId,gift.item_id,stack.version]);if(changed.affectedRows!==1n)throw new ApplicationError("GLOBAL_GIFT_CONFLICT","회원 가방 정보가 먼저 변경되었습니다.",409);
    await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code)VALUES(?,?,?,?,?,'admin_global_gift')",[operation.insertId,i+1,playerId,gift.item_id,gift.quantity]);
    await tx.execute("INSERT INTO global_gift_recipients(operation_id,recipient_ordinal,player_id,item_id,quantity_before,quantity_after)VALUES(?,?,?,?,?,?)",[operation.insertId,i+1,playerId,gift.item_id,stack.quantity,after]);
   }
   const outboxIds:string[]=[];for(const channel of channels){const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,channel.external_channel_id,JSON.stringify({data:gift.announcement_text,legacyRoomCode:channel.legacy_room_code})]);outboxIds.push(outbox.insertId.toString());}
   await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)VALUES(?,'admin_global_gift_distribute',?,'completed','broadcast_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[command.eventId,operation.insertId]);
   const data=`✅ 활성 회원 ${recipients.length}명에게 호이응원패키지(무료)🐹[2] ${gift.quantity}개를 지급하고 11개 방 공지를 예약했습니다.`;
   const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)VALUES(?,'admin_operator',?,'global_gift_operation',?,'inventory.global-gift.distribute','success','Iris /선물전달',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.operator_id,operation.insertId,JSON.stringify({giftCode:GIFT_CODE,recipientCount:recipients.length,itemCode:gift.item_code,giftQuantity:gift.quantity.toString(),channelCount:channels.length})]);
   const result:GlobalGiftResult={status:"distributed",giftCode:GIFT_CODE,itemCode:gift.item_code,recipientCount:String(recipients.length),giftQuantity:gift.quantity.toString(),outboxIds,auditId:audit.insertId.toString(),data};
   await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
  });
 }
}
