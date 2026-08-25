import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface PetTitleSaleCommand {
  externalUserId:string; channelId:string; eventId:string; message:string; environmentCode:"prod"|"dev";
}
export interface PetTitleSaleResult {
  status:"sold"|"ignored_missing_member"|"ignored_active_siege"|"snapshot_required";
  data?:string; playerId?:string; titleId?:string; stableAssignmentId?:string;
  pointDelta?:string; pointBalance?:string; wasEquipped?:boolean; outboxId?:string; replayed?:boolean;
}
interface AssignmentRow {
  assignment_id:bigint; stable_assignment_id:string; title_id:bigint; display_order:number;
  source_price:string; display_name:string; equipped:number; state_version:bigint|null;
}

// 양수 번호 하나를 가진 완전한 펫 타이틀 판매 명령만 실행 후보로 인정합니다.
export function isPetTitleSaleCommand(message:string|undefined):boolean {
  return /^\/펫타이틀판매\s+[1-9][0-9]*$/.test(message??"");
}
function titleIndex(message:string):number {
  const match=/^\/펫타이틀판매\s+([1-9][0-9]*)$/.exec(message);
  if(match===null)throw new ApplicationError("INVALID_PET_TITLE_SALE_COMMAND","사용법: /펫타이틀판매 [번호]",422);
  return Number(match[1]);
}
function key(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|PetTitleSaleResult):PetTitleSaleResult{return typeof value==="string"?JSON.parse(value)as PetTitleSaleResult:value;}

// 레거시 가격 규칙을 정수 연산으로 재현합니다.
export function calculatePetTitleSalePrice(sourcePrice:string):bigint {
  if(!/^[0-9]+(?:\.0{1,3})?$/.test(sourcePrice))throw new ApplicationError("PET_TITLE_SOURCE_PRICE_INVALID","펫 타이틀 가격을 확인해 주세요.",409);
  const price=BigInt(sourcePrice.split(".")[0]!);
  return price<10000n?1000000n:(price*30n)/100n;
}

export class PetTitleSaleService {
  constructor(private readonly database:DatabaseClient){}

  // 안정 assignment 제거·장착 해제·포인트 정산·감사·outbox를 한 트랜잭션으로 저장합니다.
  async execute(command:PetTitleSaleCommand):Promise<PetTitleSaleResult>{
    const index=titleIndex(command.message);
    return this.database.withTransaction(async(tx)=>{
      const environment=await tx.query<Array<{environment_code:string}>>("SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id=1 FOR UPDATE");
      if(environment[0]?.environment_code!==command.environmentCode)throw new ApplicationError("PET_TITLE_SALE_ENVIRONMENT_MISMATCH","요청 환경과 DB 환경이 일치하지 않습니다.",409);
      const siege=await tx.query<Array<{active:number}>>("SELECT 1 active FROM castle_battle_seasons WHERE status='active' LIMIT 1");
      if(siege[0]!==undefined)return{status:"ignored_active_siege"};
      const owners=await tx.query<Array<{identity_id:bigint;player_id:bigint}>>("SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL LIMIT 1 FOR UPDATE",[command.externalUserId]);
      const owner=owners[0];if(owner===undefined)return{status:"ignored_missing_member"};
      const scope=`pet.title_sale:${command.environmentCode}:${owner.player_id}`,eventKey=key(command.eventId);
      const prior=await tx.query<Array<{result_json:string|PetTitleSaleResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,eventKey]);
      if(prior[0]!==undefined){if(prior[0].result_json===null)throw new ApplicationError("PET_TITLE_SALE_PROCESSING","펫 타이틀 판매가 진행 중입니다.",409);return{...stored(prior[0].result_json),replayed:true};}
      const assignments=await tx.query<AssignmentRow[]>(`SELECT assignment.id assignment_id,assignment.stable_assignment_id,assignment.title_id,assignment.display_order,
        assignment.source_price,definition.display_name,(state.equipped_assignment_id=assignment.id) equipped,state.version state_version
       FROM player_title_assignments assignment
       JOIN title_definitions definition ON definition.id=assignment.title_id AND definition.scope_code='pet' AND definition.active=TRUE
       LEFT JOIN player_title_state state ON state.player_id=assignment.player_id
       WHERE assignment.player_id=? ORDER BY assignment.display_order,assignment.id FOR UPDATE`,[owner.player_id]);
      if(!assignments.every((row,offset)=>row.display_order===offset+1))return{status:"snapshot_required",data:"펫 타이틀 목록을 다시 확인한 뒤 판매해 주세요."};
      const target=assignments[index-1];if(target===undefined)return{status:"snapshot_required",data:"펫 타이틀 목록을 다시 확인한 뒤 판매해 주세요."};
      const pointDelta=calculatePetTitleSalePrice(target.source_price);
      const accounts=await tx.query<Array<{balance:string;version:bigint}>>("SELECT balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[owner.player_id]);
      if(accounts[0]===undefined)await tx.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES(?,'point',0,1)",[owner.player_id]);
      const account=accounts[0]??{balance:"0",version:1n},balance=BigInt(account.balance.split(".")[0]??"0")+pointDelta;
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,eventKey,owner.identity_id]);
      const wasEquipped=Boolean(target.equipped);
      if(wasEquipped){
        const state=await tx.execute("UPDATE player_title_state SET equipped_assignment_id=NULL,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND equipped_assignment_id=? AND version=?",[owner.player_id,target.assignment_id,target.state_version]);
        if(state.affectedRows!==1n)throw new ApplicationError("PET_TITLE_STATE_CONFLICT","장착 타이틀이 먼저 변경되어 판매하지 않았습니다.",409);
      }
      await tx.execute("DELETE FROM player_title_assignments WHERE id=? AND player_id=?",[target.assignment_id,owner.player_id]);
      await tx.execute("UPDATE player_title_assignments SET display_order=display_order-1,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND display_order>? ORDER BY display_order ASC",[owner.player_id,target.display_order]);
      const currency=await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[balance,owner.player_id,account.version]);
      if(currency.affectedRows!==1n)throw new ApplicationError("PET_TITLE_POINT_CONFLICT","포인트가 먼저 변경되어 판매하지 않았습니다.",409);
      await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES(?,1,?,'point',?,?,'pet_title_sale')",[operation.insertId,owner.player_id,pointDelta,balance]);
      await tx.execute("INSERT INTO pet_title_sale_events(operation_id,player_id,title_id,stable_assignment_id,title_name_snapshot,display_order,source_price_snapshot,point_proceeds,was_equipped) VALUES(?,?,?,?,?,?,?,?,?)",[operation.insertId,owner.player_id,target.title_id,target.stable_assignment_id,target.display_name,target.display_order,target.source_price,pointDelta,wasEquipped]);
      const data=`[${target.display_name}] 펫 타이틀을 판매했습니다.\n획득 포인트: ${pointDelta.toLocaleString("ko-KR")}P`;
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,command.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'pet_title_sale',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[command.eventId,operation.insertId]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',?,'player',?,'pet.title_sale','success','Iris /펫타이틀판매',?,UTC_TIMESTAMP(3))",[operation.insertId,owner.identity_id,owner.player_id,JSON.stringify({titleId:target.title_id.toString(),stableAssignmentId:target.stable_assignment_id,index,sourcePrice:target.source_price,pointDelta:pointDelta.toString(),wasEquipped})]);
      const result:PetTitleSaleResult={status:"sold",data,playerId:owner.player_id.toString(),titleId:target.title_id.toString(),stableAssignmentId:target.stable_assignment_id,pointDelta:pointDelta.toString(),pointBalance:balance.toString(),wasEquipped,outboxId:outbox.insertId.toString(),replayed:false};
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
