import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { sortPendantBagEntries, type PendantBagEntry } from "./pendant-bag-service.js";

const RESTORE_STONE_CODE = "ITEM-PENDANT-RESTORE-STONE";
interface Actor { identity_id: bigint; player_id: bigint; current_display_name: string; rank_emoji: string | null; }
interface PendantRow { instance_id: bigint; item_id: bigint; pet_id: bigint; version: bigint; status: string; item_name: string; name_value: string | null; icon_value: string | null; grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null; }
interface Target { row: PendantRow; entry: PendantBagEntry; }
export interface PendantRestoreResult { status: "restored" | "rejected" | "usage" | "silent"; data?: string; outboxId?: string; instanceId?: string; beforeDurability?: number; afterDurability?: number; }

// 레거시 exact·인자 포함 outer guard를 보존합니다.
export function isPendantRestoreCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (message === "/펜던트복원" || /^\/펜던트복원\s+.+$/.test(message));
}

// 장착 0 또는 가방 순번을 해석합니다.
export function parsePendantRestoreCommand(message: string): { index: bigint } | undefined {
  const match = /^\/펜던트복원\s+(\d+)$/.exec(message);
  return match === null ? undefined : { index: BigInt(match[1]!) };
}

// 인자형 명령을 DB 대표 alias로 정규화합니다.
export function normalizePendantRestoreDispatchMessage(message: string): string {
  return isPendantRestoreCommandCandidate(message) ? "/펜던트복원" : message;
}

// 긴 event ID를 operation 멱등 키 길이에 맞춥니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

// 레거시 펜던트 표시 문자열을 생성합니다.
function display(target: Target, durability: number): string {
  const icon = target.entry.icon !== "" && target.entry.name.endsWith(target.entry.icon) ? "" : target.entry.icon;
  return `${target.entry.name}${icon}[${target.entry.grade}][⚒️${durability}/${target.entry.maxDurability}](+${target.entry.upgrade})`;
}

// 응답·execution·감사·operation을 현재 transaction에서 완료합니다.
async function complete(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; targetId: string | null; resultCode: string; actionCode: string; data: string; result: PendantRestoreResult; summary: Record<string, unknown>; }): Promise<PendantRestoreResult> {
  const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data:input.data})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_RESTORE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'inventory_instance',?,?,?,'Iris /펜던트복원',?,UTC_TIMESTAMP(3))",[input.operationId,input.actor.identity_id,input.targetId,input.actionCode,input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,data:input.data,outboxId:outbox.insertId.toString()};
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);
  return result;
}

// 복원석 1개와 펜던트 내구도·장착 projection을 원자 처리합니다.
export class PendantRestoreService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<PendantRestoreResult>{
    if(!isPendantRestoreCommandCandidate(input.message))return{status:"silent"};
    return this.database.withTransaction(async transaction=>{
      const actors=await transaction.query<Actor[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name,rank_profile.rank_emoji FROM external_identities identity
        JOIN players player ON player.id=identity.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id
        LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`,[input.externalUserId]);
      const actor=actors[0]; if(actor===undefined)return{status:"silent"};
      const key=eventKey(input.eventId);
      const prior=await transaction.query<Array<{result_json:string|PendantRestoreResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='pendant.restore' AND idempotency_key=? FOR UPDATE",[key]);
      if(prior[0]?.result_json!=null)return typeof prior[0].result_json==="string"?JSON.parse(prior[0].result_json):prior[0].result_json;
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.restore',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,actor.identity_id]);
      const command=parsePendantRestoreCommand(input.message);
      if(command===undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,targetId:null,resultCode:"usage",actionCode:"pendant.restore.reject",data:"예) /펜던트복원 [펜던트가방번호]\n혹은 장착 펜던트는 숫자 0을 입력해주세요.",result:{status:"usage"},summary:{mutation:false}});
      const target=await this.resolveTarget(transaction,actor.player_id,command.index);
      if(target===undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,targetId:null,resultCode:"pendant_not_found",actionCode:"pendant.restore.reject",data:"해당 번호의 펜던트가 존재하지 않습니다.",result:{status:"rejected"},summary:{mutation:false,sourceIndex:command.index.toString()}});
      const maximum=target.entry.maxDurability>BigInt(Number.MAX_SAFE_INTEGER)?Number.MAX_SAFE_INTEGER:Number(target.entry.maxDurability);
      const before=Math.max(0,Math.min(maximum,Number(target.entry.durability)));
      if(before>=maximum)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,targetId:target.row.instance_id.toString(),resultCode:"already_max",actionCode:"pendant.restore.reject",data:"이미 내구도가 최대치입니다.",result:{status:"rejected",instanceId:target.row.instance_id.toString()},summary:{mutation:false,beforeDurability:before,maxDurability:maximum}});
      const stones=await transaction.query<Array<{item_id:bigint;quantity:bigint|null;version:bigint|null}>>(`SELECT item.id item_id,stack.quantity,stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`,[actor.player_id,RESTORE_STONE_CODE]);
      const stone=stones[0];
      if(stone===undefined||(stone.quantity??0n)<1n)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,targetId:target.row.instance_id.toString(),resultCode:"stone_required",actionCode:"pendant.restore.reject",data:`[${actor.rank_emoji??""}${actor.current_display_name}] 님\n펜던트 복원석🔷이 부족합니다.\n━━━━━━━━━━━━━\n펜던트 복원석🔷은 미궁 콘텐츠에서 획득할 수 있습니다.`,result:{status:"rejected",instanceId:target.row.instance_id.toString()},summary:{mutation:false,requiredStone:"1"}});
      const instanceUpdate=await transaction.execute("UPDATE inventory_instances SET attributes_json=JSON_SET(COALESCE(attributes_json,JSON_OBJECT()),'$.durability',?),version=version+1 WHERE id=? AND player_id=? AND version=?",[maximum,target.row.instance_id,actor.player_id,target.row.version]);
      const stoneUpdate=await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[actor.player_id,stone.item_id,stone.version]);
      if(instanceUpdate.affectedRows!==1n||stoneUpdate.affectedRows!==1n)throw new Error("PENDANT_RESTORE_CONFLICT");
      if(target.row.status==="equipped")await transaction.execute("UPDATE player_pet_pendants SET durability=?,version=version+1 WHERE player_pet_id=? AND inventory_instance_id=?",[maximum,target.row.pet_id,target.row.instance_id]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?, -1,'PENDANT_RESTORE_STONE')",[operation.insertId,actor.player_id,stone.item_id]);
      await transaction.execute("INSERT INTO pendant_restorations(operation_id,player_id,inventory_instance_id,source_index,restore_stone_item_id,durability_before,durability_after,instance_version_before,instance_version_after) VALUES (?,?,?,?,?,?,?,?,?)",[operation.insertId,actor.player_id,target.row.instance_id,command.index,stone.item_id,before,maximum,target.row.version,target.row.version+1n]);
      const data=`펜던트 복원🔷\n━━━━━━━━━━━━━\n[${actor.rank_emoji??""}${actor.current_display_name}] 님\n${display(target,maximum)}\n의 내구도를 복원하였습니다.\n━━━━━━━━━━━━━\n기존 내구도: ${before}회\n복원된 내구도: ${maximum}회`;
      return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,targetId:target.row.instance_id.toString(),resultCode:"restored",actionCode:"pendant.restore",data,result:{status:"restored",instanceId:target.row.instance_id.toString(),beforeDurability:before,afterDurability:maximum},summary:{sourceIndex:command.index.toString(),beforeDurability:before,afterDurability:maximum,stoneCost:"1"}});
    });
  }

  // 장착 0 또는 정렬된 가방 순번의 stable instance를 잠급니다.
  private async resolveTarget(transaction:DatabaseTransaction,playerId:bigint,index:bigint):Promise<Target|undefined>{
    const rows=await transaction.query<PendantRow[]>(`SELECT instance.id instance_id,instance.item_id,pet.id pet_id,instance.version,instance.status,item.display_name item_name,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
      FROM player_pets pet JOIN inventory_instances instance ON instance.player_id=pet.player_id AND instance.status IN ('owned','equipped') JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE
      WHERE pet.player_id=? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant' FOR UPDATE`,[playerId]);
    const targets=rows.map(row=>({row,entry:{instanceId:row.instance_id.toString(),name:row.name_value??row.item_name,icon:row.icon_value??"",grade:row.grade_value??"",durability:BigInt(row.durability_value??"5"),maxDurability:BigInt(row.max_durability_value??"5"),upgrade:BigInt(row.upgrade_value??"0")}}));
    if(index===0n)return targets.filter(value=>value.row.status==="equipped").sort((a,b)=>a.row.instance_id<b.row.instance_id?-1:1)[0];
    const owned=sortPendantBagEntries(targets.filter(value=>value.row.status==="owned").map(value=>value.entry)); const selected=index>BigInt(owned.length)?undefined:owned[Number(index-1n)];
    return selected===undefined?undefined:targets.find(value=>value.entry.instanceId===selected.instanceId);
  }
}
