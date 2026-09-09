import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const BASE_COMMAND="/미니펫가방정리";
const COMMAND_PATTERN=/^\/미니펫가방정리\s+(\d+)$/;
const MAX_UNSIGNED_BIGINT=18_446_744_073_709_551_615n;
const PROTECTED_GRADES=new Set(["창조","창세","태초+","태초"]);

type Numeric=bigint|number|string;
type StoredResult=string|MiniPetBagThresholdCleanResult;

export type MiniPetCleanupCandidate={
  id:string;
  definitionId:string;
  displayName:string;
  gradeDisplayName:string|null;
  battleExperience:bigint;
  salePrice:bigint|null;
  isElite:boolean;
  equipped:boolean;
  reserved:boolean;
  bagSequence:bigint|null;
};

export type MiniPetBagThresholdCleanResult={
  status:"completed";
  playerId:string;
  threshold:string;
  removedCount:number;
  removedOwnedMiniPetIds:string[];
  pointDelta:string;
  balanceAfter:string;
  data:string;
  outboxId:string;
  replayed:boolean;
};

export function isMiniPetBagThresholdCleanCommand(message:string|undefined):boolean{return message!==undefined&&(message===BASE_COMMAND||COMMAND_PATTERN.test(message));}

export function parseMiniPetBagThreshold(message:string):bigint|null{
  const match=COMMAND_PATTERN.exec(message);if(match===null)return null;
  const value=BigInt(match[1]!);return value<=MAX_UNSIGNED_BIGINT?value:null;
}

export function planMiniPetBagThresholdClean(rows:MiniPetCleanupCandidate[],threshold:bigint){
  const removed:MiniPetCleanupCandidate[]=[],preserved:MiniPetCleanupCandidate[]=[];
  for(const row of rows){
    const protectedRow=row.equipped||row.reserved||row.isElite||PROTECTED_GRADES.has(row.gradeDisplayName??"");
    if(!protectedRow&&row.battleExperience<=threshold)removed.push(row);else preserved.push(row);
  }
  const pointDelta=removed.reduce((sum,row)=>sum+(row.salePrice===null||row.salePrice===0n?100_000n:row.salePrice),0n);
  return{removed,preserved,pointDelta};
}

function stored(value:StoredResult):MiniPetBagThresholdCleanResult{return typeof value==="string"?JSON.parse(value) as MiniPetBagThresholdCleanResult:value;}
function integer(value:Numeric|null):bigint{return value===null?0n:BigInt(String(value).split(".")[0]??"0");}
function commas(value:bigint):string{const negative=value<0n?"-":"",digits=(value<0n?-value:value).toString();return negative+digits.replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function eventKey(value:string):string{return value.trim();}

// stable 보유 ID 기준 미니펫 삭제와 포인트 정산을 한 트랜잭션으로 처리합니다.
export class MiniPetBagThresholdCleanService{
  constructor(private readonly database:DatabaseClient){}
  async handle(input:{eventId:string;externalUserId:string;message:string}):Promise<MiniPetBagThresholdCleanResult>{
    const threshold=parseMiniPetBagThreshold(input.message);
    if(threshold===null)throw new ApplicationError("MINI_PET_BAG_CLEAN_COMMAND_INVALID","사용 방법: /미니펫가방정리 [정리 기준]",422);
    return this.database.withTransaction(async transaction=>{
      const actor=(await transaction.query<Array<{identity_id:Numeric;player_id:Numeric;destination_id:string}>>(
        `SELECT identity.id identity_id,identity.player_id,event.external_channel_id destination_id
         FROM external_identities identity JOIN event_inbox event ON event.event_id=?
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,[input.eventId,input.externalUserId]
      ))[0];
      if(actor===undefined)throw new ApplicationError("MINI_PET_BAG_CLEAN_PLAYER_REQUIRED","가입된 회원 정보를 찾을 수 없습니다.",409);
      const scope=`mini-pet.bag.threshold-clean:${actor.identity_id}`,key=eventKey(input.eventId);
      await transaction.execute(
        "INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,actor.identity_id]
      );
      const operation=(await transaction.query<Array<{id:Numeric;result_json:StoredResult|null}>>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]
      ))[0];
      if(operation===undefined)throw new Error("MINI_PET_BAG_CLEAN_OPERATION_REQUIRED");
      if(operation.result_json!==null)return{...stored(operation.result_json),replayed:true};
      const raw=await transaction.query<Array<{id:Numeric;definition_id:Numeric;display_name:string;grade_display_name:string|null;battle_experience:Numeric;sale_price:Numeric|null;is_elite:number;equipped:number;reserved:number;bag_sequence:Numeric|null}>>(
        `SELECT pet.id,pet.mini_pet_definition_id definition_id,definition.display_name,definition.grade_display_name,
                pet.battle_experience,pet.sale_price,pet.is_elite,pet.equipped,pet.bag_sequence,
                EXISTS(SELECT 1 FROM market_mini_pet_reservations reservation WHERE reservation.owned_mini_pet_id=pet.id) reserved
         FROM owned_mini_pets pet JOIN mini_pet_definitions definition ON definition.id=pet.mini_pet_definition_id
         WHERE pet.player_id=? ORDER BY COALESCE(pet.bag_sequence,pet.id),pet.id FOR UPDATE`,[actor.player_id]
      );
      const rows=raw.map(row=>({id:String(row.id),definitionId:String(row.definition_id),displayName:row.display_name,gradeDisplayName:row.grade_display_name,battleExperience:integer(row.battle_experience),salePrice:row.sale_price===null?null:integer(row.sale_price),isElite:Number(row.is_elite)===1,equipped:Number(row.equipped)===1,reserved:Number(row.reserved)===1,bagSequence:row.bag_sequence===null?null:integer(row.bag_sequence)}));
      const plan=planMiniPetBagThresholdClean(rows,threshold);
      await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)",[actor.player_id]);
      const currency=(await transaction.query<Array<{balance:Numeric;version:Numeric}>>("SELECT balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[actor.player_id]))[0];
      if(currency===undefined)throw new Error("MINI_PET_BAG_CLEAN_CURRENCY_REQUIRED");
      const balanceBefore=integer(currency.balance),balanceAfter=balanceBefore+plan.pointDelta;
      const run=await transaction.execute(
        "INSERT INTO mini_pet_bag_cleanup_runs(operation_id,player_id,threshold_value,removed_count,point_delta,balance_before,balance_after) VALUES (?,?,?,?,?,?,?)",
        [operation.id,actor.player_id,threshold.toString(),plan.removed.length,plan.pointDelta.toString(),balanceBefore.toString(),balanceAfter.toString()]
      );
      for(let index=0;index<plan.removed.length;index++){
        const pet=plan.removed[index]!,salePrice=pet.salePrice===null||pet.salePrice===0n?100_000n:pet.salePrice;
        await transaction.execute(
          "INSERT INTO mini_pet_bag_cleanup_lines(cleanup_run_id,sequence_no,owned_mini_pet_id,mini_pet_definition_id,previous_bag_sequence,sale_price,snapshot_json) VALUES (?,?,?,?,?,?,?)",
          [run.insertId,index+1,pet.id,pet.definitionId,pet.bagSequence?.toString()??null,salePrice.toString(),JSON.stringify({ownedMiniPetId:pet.id,definitionId:pet.definitionId,displayName:pet.displayName,gradeDisplayName:pet.gradeDisplayName,battleExperience:pet.battleExperience.toString(),salePrice:salePrice.toString(),isElite:pet.isElite,bagSequence:pet.bagSequence?.toString()??null})]
        );
      }
      if(plan.removed.length>0){
        const placeholders=plan.removed.map(()=>"?").join(","),ids=plan.removed.map(row=>row.id);
        await transaction.execute(`DELETE FROM mini_pet_title_assignments WHERE owned_mini_pet_id IN (${placeholders})`,ids);
        const deleted=await transaction.execute(`DELETE FROM owned_mini_pets WHERE player_id=? AND id IN (${placeholders})`,[actor.player_id,...ids]);
        if(deleted.affectedRows!==BigInt(ids.length))throw new ApplicationError("MINI_PET_BAG_CLEAN_CONFLICT","미니펫 가방이 먼저 변경되었습니다. 다시 시도해 주세요.",409);
      }
      const remaining=await transaction.query<Array<{id:Numeric}>>("SELECT id FROM owned_mini_pets WHERE player_id=? AND equipped=FALSE ORDER BY COALESCE(bag_sequence,id),id FOR UPDATE",[actor.player_id]);
      for(let index=0;index<remaining.length;index++)await transaction.execute("UPDATE owned_mini_pets SET bag_sequence=?,version=version+1 WHERE id=?",[index+1,remaining[index]!.id]);
      if(plan.removed.length>0){
        const changed=await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[balanceAfter.toString(),actor.player_id,currency.version]);
        if(changed.affectedRows!==1n)throw new ApplicationError("MINI_PET_BAG_CLEAN_CURRENCY_CONFLICT","포인트가 먼저 변경되었습니다. 다시 시도해 주세요.",409);
        await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'mini_pet_bag_threshold_clean')",[operation.id,actor.player_id,plan.pointDelta.toString(),balanceAfter.toString()]);
      }
      const data=plan.removed.length===0?"정리할 미니펫이 없습니다.":`미니펫 가방 정리 완료\n삭제: ${plan.removed.length}마리\n획득 포인트: 🅟${commas(plan.pointDelta)}`;
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.id,actor.destination_id,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MINI_PET_BAG_THRESHOLD_CLEAN',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.id]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'mini_pet.bag.threshold_clean','success','Iris /미니펫가방정리',?,UTC_TIMESTAMP(3))",[operation.id,actor.identity_id,actor.player_id,JSON.stringify({threshold:threshold.toString(),removedCount:plan.removed.length,pointDelta:plan.pointDelta.toString(),removedOwnedMiniPetIds:plan.removed.map(row=>row.id)})]);
      const result:MiniPetBagThresholdCleanResult={status:"completed",playerId:String(actor.player_id),threshold:threshold.toString(),removedCount:plan.removed.length,removedOwnedMiniPetIds:plan.removed.map(row=>row.id),pointDelta:plan.pointDelta.toString(),balanceAfter:balanceAfter.toString(),data,outboxId:String(outbox.insertId),replayed:false};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.id]);
      return result;
    });
  }
}
