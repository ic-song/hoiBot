import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const BASE_COMMAND="/미니펫등급정리";
const COMMAND_PATTERN=/^\/미니펫등급정리\s+([^\s]+)$/;
type Numeric=bigint|number|string;
type StoredResult=string|MiniPetGradeCleanupResult;

export type MiniPetGradeCleanupCandidate={id:string;definitionId:string;displayName:string;gradeCode:string|null;gradeDisplayName:string|null;gradeOrder:number|null;salePrice:bigint|null;equipped:boolean;reserved:boolean;bagSequence:bigint|null;};
export type MiniPetGradeCleanupResult={status:"completed";playerId:string;targetGradeCode:string;targetGradeName:string;targetGradeOrder:number;removedCount:number;removedOwnedMiniPetIds:string[];pointDelta:string;balanceAfter:string;data:string;outboxId:string;replayed:boolean;};

export function isMiniPetGradeCleanupCommand(message:string|undefined):boolean{return message!==undefined&&(message===BASE_COMMAND||COMMAND_PATTERN.test(message));}
export function parseMiniPetGradeCleanup(message:string):string|null{return COMMAND_PATTERN.exec(message)?.[1]??null;}
export function planMiniPetGradeCleanup(rows:MiniPetGradeCleanupCandidate[],targetGradeOrder:number){
  const removed:MiniPetGradeCleanupCandidate[]=[],preserved:MiniPetGradeCleanupCandidate[]=[];
  for(const row of rows){if(!row.equipped&&!row.reserved&&row.gradeOrder!==null&&row.gradeOrder<=targetGradeOrder)removed.push(row);else preserved.push(row);}
  const pointDelta=removed.reduce((sum,row)=>sum+(row.salePrice===null||row.salePrice===0n?100_000n:row.salePrice),0n);
  return{removed,preserved,pointDelta};
}
function integer(value:Numeric|null):bigint{return value===null?0n:BigInt(String(value).split(".")[0]??"0");}
function stored(value:StoredResult):MiniPetGradeCleanupResult{return typeof value==="string"?JSON.parse(value) as MiniPetGradeCleanupResult:value;}
function commas(value:bigint):string{const negative=value<0n?"-":"",digits=(value<0n?-value:value).toString();return negative+digits.replace(/\B(?=(\d{3})+(?!\d))/g,",");}

// 등급 순서와 stable 보유 ID를 기준으로 미니펫 가방과 포인트를 원자 정리합니다.
export class MiniPetGradeCleanupService{
  constructor(private readonly database:DatabaseClient){}
  async handle(input:{eventId:string;externalUserId:string;message:string}):Promise<MiniPetGradeCleanupResult>{
    const targetName=parseMiniPetGradeCleanup(input.message);if(targetName===null)throw new ApplicationError("MINI_PET_GRADE_CLEAN_COMMAND_INVALID","사용 방법: /미니펫등급정리 [등급]",422);
    return this.database.withTransaction(async transaction=>{
      const actor=(await transaction.query<Array<{identity_id:Numeric;player_id:Numeric;destination_id:string}>>(`SELECT identity.id identity_id,identity.player_id,event.external_channel_id destination_id FROM external_identities identity JOIN event_inbox event ON event.event_id=? WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`,[input.eventId,input.externalUserId]))[0];
      if(actor===undefined)throw new ApplicationError("MINI_PET_GRADE_CLEAN_PLAYER_REQUIRED","가입된 회원 정보를 찾을 수 없습니다.",409);
      const grade=(await transaction.query<Array<{grade_code:string;display_name:string;grade_order:number}>>("SELECT grade_code,display_name,grade_order FROM mini_pet_grade_definitions WHERE display_name=? AND active=TRUE FOR UPDATE",[targetName]))[0];
      if(grade===undefined)throw new ApplicationError("MINI_PET_GRADE_CLEAN_GRADE_INVALID","정리할 미니펫 등급을 확인해 주세요.",422);
      const scope=`mini-pet.grade.cleanup:${actor.identity_id}`,key=input.eventId.trim();
      await transaction.execute("INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,actor.identity_id]);
      const operation=(await transaction.query<Array<{id:Numeric;result_json:StoredResult|null}>>("SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]))[0];if(operation===undefined)throw new Error("MINI_PET_GRADE_CLEAN_OPERATION_REQUIRED");if(operation.result_json!==null)return{...stored(operation.result_json),replayed:true};
      const raw=await transaction.query<Array<{id:Numeric;definition_id:Numeric;display_name:string;grade_code:string|null;grade_display_name:string|null;grade_order:number|null;sale_price:Numeric|null;equipped:number;reserved:number;bag_sequence:Numeric|null}>>(`SELECT pet.id,pet.mini_pet_definition_id definition_id,definition.display_name,definition.grade_code,definition.grade_display_name,grade.grade_order,pet.sale_price,pet.equipped,pet.bag_sequence,EXISTS(SELECT 1 FROM market_mini_pet_reservations reservation WHERE reservation.owned_mini_pet_id=pet.id) reserved FROM owned_mini_pets pet JOIN mini_pet_definitions definition ON definition.id=pet.mini_pet_definition_id LEFT JOIN mini_pet_grade_definitions grade ON grade.display_name=definition.grade_display_name AND grade.active=TRUE WHERE pet.player_id=? ORDER BY COALESCE(pet.bag_sequence,pet.id),pet.id FOR UPDATE`,[actor.player_id]);
      const rows=raw.map(row=>({id:String(row.id),definitionId:String(row.definition_id),displayName:row.display_name,gradeCode:row.grade_code,gradeDisplayName:row.grade_display_name,gradeOrder:row.grade_order===null?null:Number(row.grade_order),salePrice:row.sale_price===null?null:integer(row.sale_price),equipped:Number(row.equipped)===1,reserved:Number(row.reserved)===1,bagSequence:row.bag_sequence===null?null:integer(row.bag_sequence)}));
      const plan=planMiniPetGradeCleanup(rows,Number(grade.grade_order));
      await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)",[actor.player_id]);
      const currency=(await transaction.query<Array<{balance:Numeric;version:Numeric}>>("SELECT balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[actor.player_id]))[0];if(currency===undefined)throw new Error("MINI_PET_GRADE_CLEAN_CURRENCY_REQUIRED");
      const balanceBefore=integer(currency.balance),balanceAfter=balanceBefore+plan.pointDelta;
      const run=await transaction.execute("INSERT INTO mini_pet_grade_cleanup_runs(operation_id,player_id,target_grade_code,target_grade_order,removed_count,point_delta,balance_before,balance_after) VALUES (?,?,?,?,?,?,?,?)",[operation.id,actor.player_id,grade.grade_code,grade.grade_order,plan.removed.length,plan.pointDelta.toString(),balanceBefore.toString(),balanceAfter.toString()]);
      for(let index=0;index<plan.removed.length;index++){const pet=plan.removed[index]!,salePrice=pet.salePrice===null||pet.salePrice===0n?100_000n:pet.salePrice;await transaction.execute("INSERT INTO mini_pet_grade_cleanup_lines(cleanup_run_id,sequence_no,owned_mini_pet_id,mini_pet_definition_id,grade_code,grade_order,previous_bag_sequence,sale_price,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?)",[run.insertId,index+1,pet.id,pet.definitionId,pet.gradeCode??grade.grade_code,pet.gradeOrder,pet.bagSequence?.toString()??null,salePrice.toString(),JSON.stringify({ownedMiniPetId:pet.id,definitionId:pet.definitionId,displayName:pet.displayName,gradeCode:pet.gradeCode,gradeDisplayName:pet.gradeDisplayName,gradeOrder:pet.gradeOrder,salePrice:salePrice.toString(),bagSequence:pet.bagSequence?.toString()??null})]);}
      if(plan.removed.length>0){const placeholders=plan.removed.map(()=>"?").join(","),ids=plan.removed.map(row=>row.id);await transaction.execute(`DELETE FROM mini_pet_title_assignments WHERE owned_mini_pet_id IN (${placeholders})`,ids);const deleted=await transaction.execute(`DELETE FROM owned_mini_pets WHERE player_id=? AND id IN (${placeholders})`,[actor.player_id,...ids]);if(deleted.affectedRows!==BigInt(ids.length))throw new ApplicationError("MINI_PET_GRADE_CLEAN_CONFLICT","미니펫 가방이 먼저 변경되었습니다. 다시 시도해 주세요.",409);}
      const remaining=await transaction.query<Array<{id:Numeric}>>("SELECT id FROM owned_mini_pets WHERE player_id=? AND equipped=FALSE ORDER BY COALESCE(bag_sequence,id),id FOR UPDATE",[actor.player_id]);for(let index=0;index<remaining.length;index++)await transaction.execute("UPDATE owned_mini_pets SET bag_sequence=?,version=version+1 WHERE id=?",[index+1,remaining[index]!.id]);
      if(plan.removed.length>0){const changed=await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[balanceAfter.toString(),actor.player_id,currency.version]);if(changed.affectedRows!==1n)throw new ApplicationError("MINI_PET_GRADE_CLEAN_CURRENCY_CONFLICT","포인트가 먼저 변경되었습니다. 다시 시도해 주세요.",409);await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'mini_pet_grade_cleanup')",[operation.id,actor.player_id,plan.pointDelta.toString(),balanceAfter.toString()]);}
      const data=plan.removed.length===0?"정리할 미니펫이 없습니다.":`미니펫 등급 정리 완료\n기준 등급: ${grade.display_name}\n삭제: ${plan.removed.length}마리\n획득 포인트: 🅟${commas(plan.pointDelta)}`;
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.id,actor.destination_id,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MINI_PET_GRADE_CLEANUP',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.id]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'mini_pet.grade.cleanup','success','Iris /미니펫등급정리',?,UTC_TIMESTAMP(3))",[operation.id,actor.identity_id,actor.player_id,JSON.stringify({targetGradeCode:grade.grade_code,targetGradeOrder:grade.grade_order,removedCount:plan.removed.length,pointDelta:plan.pointDelta.toString(),removedOwnedMiniPetIds:plan.removed.map(row=>row.id)})]);
      const result:MiniPetGradeCleanupResult={status:"completed",playerId:String(actor.player_id),targetGradeCode:grade.grade_code,targetGradeName:grade.display_name,targetGradeOrder:Number(grade.grade_order),removedCount:plan.removed.length,removedOwnedMiniPetIds:plan.removed.map(row=>row.id),pointDelta:plan.pointDelta.toString(),balanceAfter:balanceAfter.toString(),data,outboxId:String(outbox.insertId),replayed:false};await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.id]);return result;
    });
  }
}
