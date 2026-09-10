import { createHash, randomUUID } from "node:crypto";
import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { CanonicalItemInventoryRepository } from "../inventory/canonical-item-inventory-repository.js";
import { isMariaBusinessUniqueConflict } from "../shared/maria-database-error-policy.js";

export type AdminStackGrantCommand = { amount: bigint; targetLegacyKey: string } | null;
export type AdminStackGrantResult = { status: "granted" | "usage" | "invalid_amount" | "no_target"; data: string; outboxId: string; quantity?: string };
export interface AdminStackGrantDefinition {
  commandCode: string; itemCode: string; itemName: string; idempotencyScope: string;
  actionCode: string; reasonCode: string; auditReason: string;
  usageMessage: string; invalidAmountMessage: string; noTargetMessage: string;
  formatGranted(targetLegacyKey: string, amount: bigint): string;
}

export interface CanonicalAdminStackGrantDefinition extends AdminStackGrantDefinition {
  canonicalSourceSystems: readonly string[];
  canonicalReasonType: string;
}

type StoredResult = {
  payloadSha256: string;
  result: AdminStackGrantResult;
};

function payloadFingerprint(command: AdminStackGrantCommand, definition: AdminStackGrantDefinition): string {
  return createHash("sha256").update(JSON.stringify({
    command: command === null ? null : { amount: command.amount.toString(), targetLegacyKey: command.targetLegacyKey },
    definition: {
      commandCode: definition.commandCode,
      itemCode: definition.itemCode,
      itemName: definition.itemName,
      idempotencyScope: definition.idempotencyScope,
      actionCode: definition.actionCode,
      reasonCode: definition.reasonCode
    }
  })).digest("hex");
}

function replayStoredResult(value: string | StoredResult, expectedPayloadSha256: string): AdminStackGrantResult {
  const stored = typeof value === "string" ? JSON.parse(value) as StoredResult | AdminStackGrantResult : value;
  if (!("payloadSha256" in stored) || !("result" in stored) || stored.payloadSha256 !== expectedPayloadSha256) {
    throw new Error("ADMIN_STACK_GRANT_PAYLOAD_DRIFT");
  }
  return stored.result;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function complete(transaction: DatabaseTransaction, definition: AdminStackGrantDefinition, input: {
  operationId: bigint; eventId: string; destinationId: string; operatorId: string; targetId: bigint | null;
  resultCode: string; data: string; result: Omit<AdminStackGrantResult,"outboxId">; summary: Record<string,unknown>; payloadSha256: string;
}): Promise<AdminStackGrantResult> {
  const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data:input.data})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,definition.commandCode,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,?,?,?,?,UTC_TIMESTAMP(3))",[input.operationId,input.operatorId,input.targetId,definition.actionCode,input.resultCode,definition.auditReason,JSON.stringify(input.summary)]);
  const result={...input.result,data:input.data,outboxId:outbox.insertId.toString()};
  const stored:StoredResult={payloadSha256:input.payloadSha256,result};
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(stored),input.operationId]);
  return result;
}

// legacy 회원 키 기반 stack 지급과 원장·감사·실행·응답을 명령 정의에 따라 원자 처리합니다.
export class AdminStackGrantService {
  constructor(private readonly database: DatabaseClient) {}
  async grant(input:{eventId:string;destinationId:string;operatorId:string;command:AdminStackGrantCommand},definition:AdminStackGrantDefinition):Promise<AdminStackGrantResult>{
    const payloadSha256=payloadFingerprint(input.command,definition);
    const execute=()=>this.database.withTransaction(async transaction=>{
      const key=eventKey(input.eventId),prior=await transaction.query<Array<{result_json:string|StoredResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[definition.idempotencyScope,key]);
      if(prior[0]?.result_json!=null)return replayStoredResult(prior[0].result_json,payloadSha256);
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),definition.idempotencyScope,key,input.operatorId]);
      const finish=(args:Omit<Parameters<typeof complete>[2],"payloadSha256">):Promise<AdminStackGrantResult>=>complete(transaction,definition,{...args,payloadSha256});
      if(input.command===null)return finish({operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:null,resultCode:"usage",data:definition.usageMessage,result:{status:"usage",data:""},summary:{mutation:false}});
      if(input.command.amount===0n)return finish({operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:null,resultCode:"invalid_amount",data:definition.invalidAmountMessage,result:{status:"invalid_amount",data:""},summary:{mutation:false,amount:"0"}});
      const targets=await transaction.query<Array<{player_id:bigint}>>(`SELECT candidate.player_id FROM (SELECT map.player_id,0 priority FROM legacy_identity_map map WHERE map.legacy_key=? UNION ALL SELECT profile.player_id,1 priority FROM player_profiles profile WHERE profile.current_display_name=?) candidate JOIN players player ON player.id=candidate.player_id AND player.status='active' GROUP BY candidate.player_id ORDER BY MIN(candidate.priority),candidate.player_id LIMIT 2 FOR UPDATE`,[input.command.targetLegacyKey,input.command.targetLegacyKey]);
      if(targets.length!==1)return finish({operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:null,resultCode:"no_target",data:definition.noTargetMessage,result:{status:"no_target",data:""},summary:{mutation:false,targetLegacyKey:input.command.targetLegacyKey,matchCount:targets.length}});
      const target=targets[0]!,definitions=await transaction.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE LIMIT 1 FOR UPDATE",[definition.itemCode]),item=definitions[0];
      if(item===undefined)throw new Error(`${definition.itemName} DB 정의가 필요합니다.`);
      await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)",[target.player_id,item.id]);
      const stack=(await transaction.query<Array<{quantity:bigint}>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",[target.player_id,item.id]))[0]!,quantity=stack.quantity+input.command.amount;
      await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=?",[quantity,target.player_id,item.id]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,?)",[operation.insertId,target.player_id,item.id,input.command.amount,definition.reasonCode]);
      const data=definition.formatGranted(input.command.targetLegacyKey,input.command.amount);
      return finish({operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:target.player_id,resultCode:"granted",data,result:{status:"granted",data:"",quantity:quantity.toString()},summary:{targetLegacyKey:input.command.targetLegacyKey,itemCode:definition.itemCode,amount:input.command.amount.toString(),quantity:quantity.toString()}});
    });
    try{return await execute();}catch(error){if(!isMariaBusinessUniqueConflict(error,"uq_operations_idempotency"))throw error;return execute();}
  }

  // 공용 관리자 transaction owner 안에서 canonical item participant를 함께 커밋합니다.
  async grantCanonical(input:{eventId:string;destinationId:string;operatorId:string;command:AdminStackGrantCommand},definition:CanonicalAdminStackGrantDefinition):Promise<AdminStackGrantResult>{
    const command=input.command,payloadSha256=createHash("sha256").update(JSON.stringify({command:command===null?null:{amount:command.amount.toString(),targetLegacyKey:command.targetLegacyKey},itemCode:definition.itemCode,itemName:definition.itemName})).digest("hex");
    const execute=()=>this.database.withTransaction(async transaction=>{
      const key=eventKey(input.eventId),prior=await transaction.query<Array<{result_json:string|StoredResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[definition.idempotencyScope,key]);
      if(prior[0]?.result_json!=null){const stored=typeof prior[0].result_json==="string"?JSON.parse(prior[0].result_json) as StoredResult:prior[0].result_json;if(stored.payloadSha256!==payloadSha256)throw new Error("ADMIN_STACK_GRANT_PAYLOAD_DRIFT");return stored.result;}
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),definition.idempotencyScope,key,input.operatorId]);
      const finish=async(resultCode:string,data:string,result:Omit<AdminStackGrantResult,"outboxId"|"data">,summary:Record<string,unknown>,targetId:string|null):Promise<AdminStackGrantResult>=>{
        const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);
        await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,definition.commandCode,operation.insertId,resultCode]);
        await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'canonical_player',NULL,?,?,?,?,UTC_TIMESTAMP(3))",[operation.insertId,input.operatorId,definition.actionCode,resultCode,definition.auditReason,JSON.stringify({...summary,canonicalPlayerId:targetId})]);
        const publicResult={...result,data,outboxId:outbox.insertId.toString()};const stored:StoredResult={payloadSha256,result:publicResult};
        await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(stored),operation.insertId]);return publicResult;
      };
      if(command===null)return finish("usage",definition.usageMessage,{status:"usage"},{mutation:false},null);
      if(command.amount===0n)return finish("invalid_amount",definition.invalidAmountMessage,{status:"invalid_amount"},{mutation:false,amount:"0"},null);
      const placeholders=definition.canonicalSourceSystems.map(()=>"?").join(",");
      const targets=await transaction.query<Array<{player_id:string}>>(`SELECT player_id FROM canonical_players WHERE source_system IN (${placeholders}) AND BINARY source_identifier=BINARY ? ORDER BY player_id LIMIT 2 FOR UPDATE`,[...definition.canonicalSourceSystems,command.targetLegacyKey]);
      if(targets.length!==1)return finish("no_target",definition.noTargetMessage,{status:"no_target"},{mutation:false,targetLegacyKey:command.targetLegacyKey,matchCount:targets.length},null);
      const items=await transaction.query<Array<{item_id:string}>>("SELECT item_id FROM canonical_item_definitions WHERE BINARY item_name=BINARY ? AND active_flag=TRUE AND stackable_flag=TRUE ORDER BY item_id LIMIT 2 FOR UPDATE",[definition.itemName]);
      if(items.length!==1)throw new Error("CANONICAL_ADMIN_STACK_DEFINITION_REQUIRED");
      const changed=await new CanonicalItemInventoryRepository(createScopedDatabaseClient(transaction)).changeStackQuantity({actor:`admin_operator:${input.operatorId}`,playerId:targets[0]!.player_id,itemId:items[0]!.item_id,requestKey:key,quantityDelta:command.amount,reasonType:definition.canonicalReasonType});
      const data=definition.formatGranted(command.targetLegacyKey,command.amount);
      return finish("granted",data,{status:"granted",quantity:changed.quantity.toString()},{targetLegacyKey:command.targetLegacyKey,itemCode:definition.itemCode,amount:command.amount.toString(),quantity:changed.quantity.toString(),replayed:changed.replayed},targets[0]!.player_id);
    });
    try{return await execute();}catch(error){if(!isMariaBusinessUniqueConflict(error,"uq_operations_idempotency"))throw error;return execute();}
  }
}
