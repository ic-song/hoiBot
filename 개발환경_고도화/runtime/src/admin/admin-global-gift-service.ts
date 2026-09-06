import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createObjectAuditValues, createObjectIdentityCandidate } from "../identity/object-identity-audit-provider.js";
import { insertWithCuid8CollisionRetry, withMariaTransactionRetry } from "../shared/maria-database-error-policy.js";
import { createRequestReuseEnvelope, createRequestReuseTerminalReceipt, type RequestReuseInput, type RequestReuseValue } from "../shared/request-reuse-contract.js";
import { TransactionReceiptOutboxProvider, type TransactionReceiptOutboxStore, type TransactionReceiptOutboxTerminal } from "../shared/transaction-receipt-outbox-contract.js";
import { ApplicationError } from "../shared/application-error.js";

export const ADMIN_GLOBAL_GIFT_COMMAND="/선물전달";
export const ADMIN_GLOBAL_GIFT_ITEM_NAME="호이응원패키지(무료)🐹[2]";
export const ADMIN_GLOBAL_GIFT_SOURCE_OBJECT_KEY="item.direct_bag.8349df1a3be0b247";
export const ADMIN_GLOBAL_GIFT_MESSAGE="호이응원패키지(무료)🐹[2] 1개가 지급되었습니다.\n가방에 3개 소지시 잠수계정으로 인지하여 계정이 삭제 될수 있으니 오픈하여주세요!\n\n 사용 방법:\n1. /패키지가방\n/패키지사용 [가방번호] [오픈갯수]";
const SCOPE="admin.inventory.global_gift.v1",PERMISSION="game.inventory.global_gift";
const SOURCE_SYSTEM="LEGACY_JS",SOURCE_NAMESPACE="member.bag";

export interface AdminGlobalGiftReply { readonly [key:string]:RequestReuseValue; readonly outboxId:string; readonly room:string; readonly data:string; }
export interface AdminGlobalGiftResult { readonly [key:string]:RequestReuseValue; readonly status:"completed"; readonly affectedMemberCount:string; readonly itemId:string; readonly quantityDelta:"1"; readonly recipientFingerprint:string; readonly replies:readonly AdminGlobalGiftReply[]; }
interface Context { readonly tx:DatabaseTransaction; readonly operationId?:string; }
interface OperationRow { admin_global_gift_operation_id:string; item_id:string; operation_key:string; operation_status:string; terminal_json:string|null; recipient_count:bigint|string; channel_count:number; result_fingerprint:string|null; recipient_fingerprint:string|null; announcement_fingerprint:string; }
interface RecipientEvidence { sequence:number; playerId:string; itemId:string; stackId:string; quantityBefore:string; quantityAfter:string; }

export function isAdminGlobalGiftCommand(message:string|undefined):boolean{return message===ADMIN_GLOBAL_GIFT_COMMAND;}
export function normalizeAdminGlobalGiftDispatchMessage(message:string):string{return isAdminGlobalGiftCommand(message)?ADMIN_GLOBAL_GIFT_COMMAND:message;}
const sha256=(value:string):string=>createHash("sha256").update(value,"utf8").digest("hex");
const eventKey=(value:string):string=>value.length<=191?value:`sha256:${sha256(value)}`;

async function cuidInsert(insert:(id:string)=>Promise<void>):Promise<string>{
  return insertWithCuid8CollisionRetry(insert,{generate:createObjectIdentityCandidate,exhaustedErrorCode:"ADMIN_GLOBAL_GIFT_CUID_COLLISION_EXHAUSTED"});
}

class MariaGlobalGiftRfaStore implements TransactionReceiptOutboxStore<Context,AdminGlobalGiftResult>{
  constructor(private readonly database:DatabaseClient){}
  private async readVerifiedTerminal(queryer:Pick<DatabaseTransaction,"query">,requestKey:string,lock:boolean):Promise<{operationId:string;terminal:TransactionReceiptOutboxTerminal<AdminGlobalGiftResult>}|undefined>{
    const completed=lock?"":" AND operation_status='COMPLETED'",locked=lock?" FOR UPDATE":"";
    const row=(await queryer.query<OperationRow[]>(`SELECT admin_global_gift_operation_id,item_id,operation_key,operation_status,terminal_json,recipient_count,channel_count,result_fingerprint,recipient_fingerprint,announcement_fingerprint FROM canonical_admin_global_gift_operations WHERE request_key=?${completed}${locked}`,[requestKey]))[0];
    if(row===undefined)return undefined;
    if(row.operation_status!=="COMPLETED"||row.terminal_json===null)throw new Error("ADMIN_GLOBAL_GIFT_INCOMPLETE_RECEIPT");
    const operationId=row.admin_global_gift_operation_id,recipientRows=await queryer.query<Array<{recipient_sequence:number;player_id:string;stack_player_id:string;item_id:string;owned_item_stack_id:string;quantity_before:bigint|string;quantity_after:bigint|string}>>("SELECT recipient.recipient_sequence,recipient.player_id,stack.player_id AS stack_player_id,stack.item_id,recipient.owned_item_stack_id,recipient.quantity_before,recipient.quantity_after FROM canonical_admin_global_gift_recipients recipient JOIN canonical_owned_item_stacks stack ON stack.owned_item_stack_id=recipient.owned_item_stack_id WHERE recipient.admin_global_gift_operation_id=? ORDER BY recipient.recipient_sequence",[operationId]);
    const recipientEvidence:RecipientEvidence[]=recipientRows.map(value=>({sequence:Number(value.recipient_sequence),playerId:value.player_id,itemId:value.item_id,stackId:value.owned_item_stack_id,quantityBefore:BigInt(value.quantity_before).toString(),quantityAfter:BigInt(value.quantity_after).toString()})),recipientFingerprint=sha256(JSON.stringify(recipientEvidence));
    const channels=await queryer.query<Array<{channel_sequence:number;destination_id:string;payload_fingerprint:string}>>("SELECT channel_sequence,destination_id,payload_fingerprint FROM canonical_admin_global_gift_channel_snapshots WHERE admin_global_gift_operation_id=? ORDER BY channel_sequence",[operationId]);
    const outboxes=await queryer.query<Array<{outbox_message_id:bigint|string;destination_id:string;outbox_status:string;payload_json:string}>>("SELECT outbox.id AS outbox_message_id,outbox.destination_id,outbox.status AS outbox_status,CAST(outbox.payload_json AS CHAR) payload_json FROM operations legacy_operation JOIN outbox_messages outbox ON outbox.operation_id=legacy_operation.id WHERE legacy_operation.operation_key=? ORDER BY outbox.id",[row.operation_key]);
    if(BigInt(recipientRows.length)!==BigInt(row.recipient_count)||recipientRows.some((value,index)=>Number(value.recipient_sequence)!==index+1||value.player_id!==value.stack_player_id||value.item_id!==row.item_id)||row.recipient_fingerprint!==recipientFingerprint||channels.length!==11||outboxes.length!==11||row.channel_count!==11)throw new Error("ADMIN_GLOBAL_GIFT_REPLAY_EVIDENCE_DRIFT");
    for(let index=0;index<channels.length;index+=1){const channel=channels[index]!,outbox=outboxes[index]!,payload=JSON.parse(outbox.payload_json) as {data?:unknown};if(channel.channel_sequence!==index+1||channel.destination_id!==outbox.destination_id||!["pending","sending","sent","failed","dead_letter"].includes(outbox.outbox_status)||payload.data!==ADMIN_GLOBAL_GIFT_MESSAGE||channel.payload_fingerprint!==sha256(outbox.payload_json))throw new Error("ADMIN_GLOBAL_GIFT_REPLAY_OUTBOX_DRIFT");}
    const terminal=JSON.parse(row.terminal_json) as TransactionReceiptOutboxTerminal<AdminGlobalGiftResult>,aggregate=sha256(JSON.stringify(channels.map(channel=>({sequence:channel.channel_sequence,destinationId:channel.destination_id,data:ADMIN_GLOBAL_GIFT_MESSAGE}))));
    if(row.result_fingerprint!==terminal.typedReceipt.resultFingerprint||terminal.requestReceipt.result.recipientFingerprint!==recipientFingerprint||terminal.requestReceipt.result.itemId!==row.item_id||row.announcement_fingerprint!==sha256(ADMIN_GLOBAL_GIFT_MESSAGE)||terminal.typedReceipt.receiptId!==operationId||terminal.deliveryEvidence.deliveryKind!=="OUTBOX"||terminal.deliveryEvidence.outboxId!==BigInt(outboxes[0]!.outbox_message_id).toString()||terminal.deliveryEvidence.payloadFingerprint!==aggregate)throw new Error("ADMIN_GLOBAL_GIFT_REPLAY_TERMINAL_DRIFT");
    return {operationId,terminal};
  }
  withLockedTransaction<T>(requestKey:string,work:(session:{readonly context:Context;readTerminal():Promise<TransactionReceiptOutboxTerminal<AdminGlobalGiftResult>|undefined>;persistTerminal(terminal:TransactionReceiptOutboxTerminal<AdminGlobalGiftResult>):Promise<void>})=>Promise<T>):Promise<T>{
    return withMariaTransactionRetry(this.database,{maxAttempts:3,allowRetry:()=>true,exhaustedErrorCode:"ADMIN_GLOBAL_GIFT_TRANSACTION_RETRY_EXHAUSTED"},async tx=>{
      await tx.query("SELECT item_definition_import_id FROM canonical_item_definition_imports WHERE source_system='LEGACY_JS' AND source_namespace='member.bag' AND BINARY source_identifier=BINARY '호이응원패키지(무료)🐹[2]' FOR UPDATE");
      let operationId:string|undefined;
      const read=async():Promise<TransactionReceiptOutboxTerminal<AdminGlobalGiftResult>|undefined>=>{
        const verified=await this.readVerifiedTerminal(tx,requestKey,true);
        operationId=verified?.operationId;
        return verified?.terminal;
      };
      const persist=async(terminal:TransactionReceiptOutboxTerminal<AdminGlobalGiftResult>):Promise<void>=>{
        operationId??=terminal.typedReceipt.receiptId;
        if(terminal.typedReceipt.receiptKind!=="ADMIN_GLOBAL_GIFT"||terminal.typedReceipt.receiptId!==operationId)throw new Error("ADMIN_GLOBAL_GIFT_TYPED_RECEIPT_DRIFT");
        const audit=createObjectAuditValues("admin_global_gift_terminal");
        const updated=await tx.execute("UPDATE canonical_admin_global_gift_operations SET operation_status='COMPLETED',terminal_json=?,UPDATE_USER=?,UPDATE_TIME=? WHERE admin_global_gift_operation_id=? AND operation_status='STAGED' AND result_fingerprint=?",[JSON.stringify(terminal),audit.UPDATE_USER,audit.UPDATE_TIME,operationId,terminal.typedReceipt.resultFingerprint]);
        if(updated.affectedRows!==1n)throw new Error("ADMIN_GLOBAL_GIFT_TERMINAL_CONFLICT");
      };
      const context:Context={tx,get operationId(){return operationId;}};
      return work({context,readTerminal:read,persistTerminal:persist});
    });
  }
  async readCommitted(requestKey:string):Promise<TransactionReceiptOutboxTerminal<AdminGlobalGiftResult>|undefined>{
    return this.database.withTransaction(async tx=>(await this.readVerifiedTerminal(tx,requestKey,false))?.terminal);
  }
}

export class AdminGlobalGiftService{
  constructor(private readonly database:DatabaseClient,private readonly rfa02=new TransactionReceiptOutboxProvider()){}
  async handle(input:{eventId:string;externalUserId:string;channelId:string;message:string}):Promise<AdminGlobalGiftResult&{readonly replayed:boolean}>{
    if(!isAdminGlobalGiftCommand(input.message))throw new ApplicationError("ADMIN_GLOBAL_GIFT_COMMAND_INVALID","정확한 /선물전달 명령을 입력해주세요.",422);
    const request:RequestReuseInput={scope:SCOPE,requestKey:eventKey(input.eventId),sourceEventId:input.eventId,actor:{actorType:"admin_external_identity",actorId:input.externalUserId,playerId:null},operationKind:"ADMIN_GLOBAL_GIFT",targetType:"ACTIVE_MEMBER_SNAPSHOT",targetId:null,payload:{command:ADMIN_GLOBAL_GIFT_COMMAND,sourceChannelId:input.channelId,itemSource:{sourceSystem:SOURCE_SYSTEM,sourceNamespace:SOURCE_NAMESPACE,sourceIdentifier:ADMIN_GLOBAL_GIFT_ITEM_NAME,objectKey:ADMIN_GLOBAL_GIFT_SOURCE_OBJECT_KEY},quantityDelta:1n,announcement:ADMIN_GLOBAL_GIFT_MESSAGE,channelCount:11n}};
    const envelope=createRequestReuseEnvelope(request),store=new MariaGlobalGiftRfaStore(this.database);
    const executed=await this.rfa02.execute(request,store,async context=>{
      const tx=context.tx,operator=(await tx.query<Array<{operator_id:bigint|string}>>(`SELECT DISTINCT mapping.operator_id FROM external_identities identity_row JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity_row.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code=? WHERE identity_row.provider_code='kakao' AND identity_row.external_user_id=? AND identity_row.status='linked' ORDER BY mapping.operator_id LIMIT 2 FOR UPDATE`,[PERMISSION,input.externalUserId]));
      if(operator.length!==1)throw new ApplicationError("FORBIDDEN","선물 전달 권한이 없습니다.",403);
      const items=await tx.query<Array<{item_id:string;item_name:string;active_flag:number;stackable_flag:number;definition_options:string}>>(`SELECT item.item_id,item.item_name,item.active_flag,item.stackable_flag,CAST(item.definition_options AS CHAR) definition_options FROM canonical_item_definition_imports binding JOIN canonical_item_definitions item ON item.item_id=binding.item_id WHERE binding.source_system=? AND binding.source_namespace=? AND BINARY binding.source_identifier=BINARY ? FOR UPDATE`,[SOURCE_SYSTEM,SOURCE_NAMESPACE,ADMIN_GLOBAL_GIFT_ITEM_NAME]);
      if(items.length!==1||items[0]!.item_name!==ADMIN_GLOBAL_GIFT_ITEM_NAME||!items[0]!.active_flag||!items[0]!.stackable_flag||JSON.parse(items[0]!.definition_options).sourceObjectKey!==ADMIN_GLOBAL_GIFT_SOURCE_OBJECT_KEY)throw new ApplicationError("ADMIN_GLOBAL_GIFT_ITEM_BINDING_DRIFT","선물 canonical 정의 연결을 확인할 수 없습니다.",409);
      const channels=await tx.query<Array<{admin_global_gift_channel_config_id:string;channel_sequence:number;destination_id:string}>>("SELECT admin_global_gift_channel_config_id,channel_sequence,destination_id FROM canonical_admin_global_gift_channel_configs WHERE config_status='ACTIVE' ORDER BY channel_sequence FOR UPDATE");
      if(channels.length!==11||channels.some((row,index)=>row.channel_sequence!==index+1))throw new ApplicationError("ADMIN_GLOBAL_GIFT_CHANNEL_CONFIG_REQUIRED","선물 전달 채널 11개 설정이 필요합니다.",409);
      const activeLegacy=await tx.query<Array<{legacy_player_id:bigint|string}>>("SELECT id AS legacy_player_id FROM players WHERE status='active' AND deleted_at IS NULL ORDER BY id FOR UPDATE");
      const legacyIds=activeLegacy.map(row=>BigInt(row.legacy_player_id).toString()),players=legacyIds.length===0?[]:await tx.query<Array<{player_id:string;legacy_player_id:bigint|string}>>(`SELECT canonical_player.player_id,CAST(canonical_player.source_identifier AS UNSIGNED) AS legacy_player_id FROM canonical_players canonical_player WHERE canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier REGEXP '^(0|[1-9][0-9]{0,19})$' AND CAST(canonical_player.source_identifier AS UNSIGNED) IN (${legacyIds.map(()=>"?").join(",")}) ORDER BY canonical_player.player_id FOR UPDATE`,legacyIds);
      if(players.length!==activeLegacy.length||new Set(players.map(row=>row.player_id)).size!==players.length||new Set(players.map(row=>BigInt(row.legacy_player_id).toString())).size!==legacyIds.length)throw new ApplicationError("ADMIN_GLOBAL_GIFT_MEMBER_IMPORT_INCOMPLETE","활성 회원 canonical 연결이 완전하지 않습니다.",409);
      const audit=createObjectAuditValues(`admin_global_gift_operator_${BigInt(operator[0]!.operator_id)}`),itemId=items[0]!.item_id,announcementFingerprint=sha256(ADMIN_GLOBAL_GIFT_MESSAGE),operationKey=randomUUID();
      const legacyOperation=(await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[operationKey,SCOPE,request.requestKey,BigInt(operator[0]!.operator_id).toString()])).insertId;
      const operationId=await cuidInsert(id=>tx.execute("INSERT INTO canonical_admin_global_gift_operations(admin_global_gift_operation_id,item_id,operation_key,request_key,request_identity_fingerprint,payload_fingerprint,request_fingerprint,result_fingerprint,recipient_fingerprint,recipient_count,channel_count,announcement_fingerprint,operation_status,terminal_json,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,11,?,'PROCESSING',NULL,?,?,?,?)",[id,itemId,operationKey,request.requestKey,envelope.identityFingerprint,envelope.payloadFingerprint,envelope.requestFingerprint,players.length,announcementFingerprint,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]).then(()=>undefined)),recipientEvidence:RecipientEvidence[]=[];
      for(let index=0;index<players.length;index+=1){const player=players[index]!;let stack=(await tx.query<Array<{owned_item_stack_id:string;quantity:bigint|string}>>("SELECT owned_item_stack_id,quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=? FOR UPDATE",[player.player_id,itemId]))[0];if(stack===undefined){const stackId=await cuidInsert(id=>tx.execute("INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,0,?,?,?,?)",[id,player.player_id,itemId,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]).then(()=>undefined));stack={owned_item_stack_id:stackId,quantity:0n};}const before=BigInt(stack.quantity),after=before+1n;await tx.execute("UPDATE canonical_owned_item_stacks SET quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_item_stack_id=?",[after.toString(),audit.UPDATE_USER,audit.UPDATE_TIME,stack.owned_item_stack_id]);await cuidInsert(id=>tx.execute("INSERT INTO canonical_admin_global_gift_recipients(admin_global_gift_recipient_id,admin_global_gift_operation_id,player_id,owned_item_stack_id,recipient_sequence,quantity_before,quantity_after,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[id,operationId,player.player_id,stack!.owned_item_stack_id,index+1,before.toString(),after.toString(),audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]).then(()=>undefined));recipientEvidence.push({sequence:index+1,playerId:player.player_id,itemId,stackId:stack.owned_item_stack_id,quantityBefore:before.toString(),quantityAfter:after.toString()});}
      const recipientFingerprint=sha256(JSON.stringify(recipientEvidence));
      const replies:AdminGlobalGiftReply[]=[];
      for(const channel of channels){const payload=JSON.stringify({data:ADMIN_GLOBAL_GIFT_MESSAGE}),outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[legacyOperation,channel.destination_id,payload]);await cuidInsert(id=>tx.execute("INSERT INTO canonical_admin_global_gift_channel_snapshots(admin_global_gift_channel_snapshot_id,admin_global_gift_operation_id,admin_global_gift_channel_config_id,channel_sequence,destination_id,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)",[id,operationId,channel.admin_global_gift_channel_config_id,channel.channel_sequence,channel.destination_id,sha256(payload),audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]).then(()=>undefined));replies.push({outboxId:outbox.insertId.toString(),room:channel.destination_id,data:ADMIN_GLOBAL_GIFT_MESSAGE});}
      const result:AdminGlobalGiftResult={status:"completed",affectedMemberCount:players.length.toString(),itemId,quantityDelta:"1",recipientFingerprint,replies},fingerprint=createRequestReuseTerminalReceipt(request,result).resultFingerprint;
      await tx.execute("UPDATE canonical_admin_global_gift_operations SET operation_status='STAGED',result_fingerprint=?,recipient_fingerprint=?,UPDATE_USER=?,UPDATE_TIME=? WHERE admin_global_gift_operation_id=? AND operation_status='PROCESSING'",[fingerprint,recipientFingerprint,audit.UPDATE_USER,audit.UPDATE_TIME,operationId]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_GLOBAL_GIFT',?,'completed','outbox_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,legacyOperation]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),legacyOperation]);
      const payloadFingerprint=sha256(JSON.stringify(replies.map((reply,index)=>({sequence:index+1,destinationId:reply.room,data:reply.data}))));
      return {result,typedReceipt:{receiptKind:"ADMIN_GLOBAL_GIFT",receiptId:operationId,receiptStatus:"COMPLETED",resultFingerprint:fingerprint},deliveryEvidence:{deliveryKind:"OUTBOX",outboxId:replies[0]!.outboxId,payloadFingerprint,resultFingerprint:fingerprint}};
    });
    return {...executed.result,replayed:executed.replayed};
  }
}

export async function dispatchAdminGlobalGiftCommand(input:{database:DatabaseClient;isOperationalChannel:boolean;duplicate:boolean|undefined;route:string|undefined;handlerKey:string|undefined;eventId:string;externalUserId:string|undefined;channelId:string|undefined;message:string|undefined;queueError:(code:string,message:string)=>Promise<{outboxId:string;room:string;data:string}>}):Promise<readonly AdminGlobalGiftReply[]>{
  if(!input.isOperationalChannel||input.duplicate||input.route!=="MODERN"||input.handlerKey!=="admin_global_gift"||input.externalUserId===undefined||input.channelId===undefined||!isAdminGlobalGiftCommand(input.message))return [];
  const externalUserId=input.externalUserId,channelId=input.channelId,message=input.message!;
  try{return (await new AdminGlobalGiftService(input.database).handle({eventId:input.eventId,externalUserId,channelId,message})).replies;}
  catch(error){if(error instanceof ApplicationError&&[403,409,422].includes(error.statusCode)){const reply=await input.queueError("admin_global_gift_error",error.message);return [{outboxId:reply.outboxId,room:reply.room,data:reply.data}];}throw error;}
}
