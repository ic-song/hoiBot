import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface MiniPetTitleSaleCommand {
  externalUserId: string; channelId: string; eventId: string; message: string; environmentCode: "prod" | "dev";
}
export interface MiniPetTitleSaleResult {
  status: "sold" | "ignored_missing_member" | "ignored_active_siege" | "snapshot_required" | "sale_blocked";
  data?: string; playerId?: string; titleId?: string; stableOwnedTitleId?: string;
  selectedStableOwnedTitleId?: string | null; pointDelta?: string; pointBalance?: string;
  outboxId?: string; replayed?: boolean;
}
interface OwnedTitleRow {
  title_id: bigint; stable_owned_title_id: string; display_order: number; display_name: string;
  sale_price: string; selected: number;
}

// 양수 번호 하나를 가진 완전한 판매 명령만 실행 후보로 인정합니다.
export function isMiniPetTitleSaleCommand(message: string | undefined): boolean {
  return /^\/미니펫타이틀판매\s+[1-9][0-9]*$/.test(message ?? "");
}
function saleIndex(message: string): number {
  const match=/^\/미니펫타이틀판매\s+([1-9][0-9]*)$/.exec(message);
  if(match===null) throw new ApplicationError("INVALID_MINIPET_TITLE_SALE_COMMAND","사용법: /미니펫타이틀판매 [번호]",422);
  return Number(match[1]);
}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|MiniPetTitleSaleResult):MiniPetTitleSaleResult{return typeof value==="string"?JSON.parse(value)as MiniPetTitleSaleResult:value;}
function pointValue(value:string):bigint{
  if(!/^[0-9]+(?:\.0{1,3})?$/.test(value)) throw new ApplicationError("MINIPET_TITLE_SALE_PRICE_INVALID","타이틀 판매 가격을 확인해 주세요.",409);
  return BigInt(value.split(".")[0]!);
}

export class MiniPetTitleSaleService {
  constructor(private readonly database:DatabaseClient){}

  // 안정 소유 타이틀 제거와 포인트 정산·원장·감사·outbox를 한 트랜잭션으로 저장합니다.
  async execute(command:MiniPetTitleSaleCommand):Promise<MiniPetTitleSaleResult>{
    const index=saleIndex(command.message);
    return this.database.withTransaction(async(tx)=>{
      const environments=await tx.query<Array<{environment_code:string}>>("SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id=1 FOR UPDATE");
      if(environments[0]?.environment_code!==command.environmentCode) throw new ApplicationError("MINIPET_TITLE_SALE_ENVIRONMENT_MISMATCH","요청 환경과 DB 환경이 일치하지 않습니다.",409);
      const siege=await tx.query<Array<{active:number}>>("SELECT 1 active FROM castle_battle_seasons WHERE status='active' LIMIT 1");
      if(siege[0]!==undefined) return {status:"ignored_active_siege"};
      const owners=await tx.query<Array<{identity_id:bigint;player_id:bigint}>>("SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL LIMIT 1 FOR UPDATE",[command.externalUserId]);
      const owner=owners[0]; if(owner===undefined)return{status:"ignored_missing_member"};
      const scope=`mini_pet.title_sale:${command.environmentCode}:${owner.player_id}`,key=eventKey(command.eventId);
      const prior=await tx.query<Array<{result_json:string|MiniPetTitleSaleResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
      if(prior[0]!==undefined){if(prior[0].result_json===null)throw new ApplicationError("MINIPET_TITLE_SALE_PROCESSING","타이틀 판매가 진행 중입니다.",409);return{...stored(prior[0].result_json),replayed:true};}
      const titles=await tx.query<OwnedTitleRow[]>(`SELECT state.title_id,state.stable_owned_title_id,state.display_order,state.sale_price,definition.display_name,
        (selection.stable_owned_title_id=state.stable_owned_title_id) selected
       FROM mini_pet_title_owned_states state
       JOIN player_titles owned ON owned.player_id=state.player_id AND owned.title_id=state.title_id
       JOIN title_definitions definition ON definition.id=state.title_id AND definition.scope_code='mini_pet' AND definition.active=TRUE
       LEFT JOIN mini_pet_title_selections selection ON selection.player_id=state.player_id
       WHERE state.player_id=? ORDER BY state.display_order,state.title_id FOR UPDATE`,[owner.player_id]);
      if(!titles.every((title,offset)=>title.display_order===offset+1))return{status:"snapshot_required",data:"미니펫 타이틀 목록을 다시 확인해 주세요."};
      const target=titles[index-1]; if(target===undefined)return{status:"snapshot_required",data:"미니펫 타이틀 목록을 다시 확인해 주세요."};
      if(Boolean(target.selected))return{status:"sale_blocked",data:"적용 중인 미니펫 타이틀은 판매할 수 없습니다."};
      const pointDelta=pointValue(target.sale_price);
      const accounts=await tx.query<Array<{balance:string;version:bigint}>>("SELECT balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[owner.player_id]);
      if(accounts[0]===undefined)await tx.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES(?,'point',0,1)",[owner.player_id]);
      const account=accounts[0]??{balance:"0",version:1n};
      const balance=BigInt(account.balance.split(".")[0]??"0")+pointDelta;
      const selectedStableOwnedTitleId=titles.find(title=>Boolean(title.selected))?.stable_owned_title_id??null;
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,owner.identity_id]);
      await tx.execute("DELETE FROM mini_pet_title_owned_states WHERE player_id=? AND stable_owned_title_id=?",[owner.player_id,target.stable_owned_title_id]);
      await tx.execute("DELETE FROM player_titles WHERE player_id=? AND title_id=?",[owner.player_id,target.title_id]);
      await tx.execute("UPDATE mini_pet_title_owned_states SET display_order=display_order-1,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND display_order>? ORDER BY display_order ASC",[owner.player_id,target.display_order]);
      const currency=await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[balance,owner.player_id,account.version]);
      if(currency.affectedRows!==1n)throw new ApplicationError("MINIPET_TITLE_SALE_POINT_CONFLICT","포인트가 먼저 변경되어 판매하지 않았습니다.",409);
      await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES(?,1,?,'point',?,?,'mini_pet_title_sale')",[operation.insertId,owner.player_id,pointDelta,balance]);
      await tx.execute("INSERT INTO mini_pet_title_sale_events(operation_id,player_id,title_id,stable_owned_title_id,title_name_snapshot,display_order,sale_price_snapshot,point_proceeds,selected_stable_owned_title_id) VALUES(?,?,?,?,?,?,?,?,?)",[operation.insertId,owner.player_id,target.title_id,target.stable_owned_title_id,target.display_name,target.display_order,target.sale_price,pointDelta,selectedStableOwnedTitleId]);
      const data=`[${target.display_name}] 미니펫 타이틀을 판매했습니다.\n획득 포인트: ${pointDelta.toLocaleString("ko-KR")}P`;
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,command.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'mini_pet_title_sale',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[command.eventId,operation.insertId]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',?,'player',?,'mini_pet.title_sale','success','Iris /미니펫타이틀판매',?,UTC_TIMESTAMP(3))",[operation.insertId,owner.identity_id,owner.player_id,JSON.stringify({titleId:target.title_id.toString(),stableOwnedTitleId:target.stable_owned_title_id,index,pointDelta:pointDelta.toString(),selectedStableOwnedTitleId})]);
      const result:MiniPetTitleSaleResult={status:"sold",data,playerId:owner.player_id.toString(),titleId:target.title_id.toString(),stableOwnedTitleId:target.stable_owned_title_id,selectedStableOwnedTitleId,pointDelta:pointDelta.toString(),pointBalance:balance.toString(),outboxId:outbox.insertId.toString(),replayed:false};
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
