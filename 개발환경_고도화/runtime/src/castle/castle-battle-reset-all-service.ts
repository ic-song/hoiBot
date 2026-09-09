import { createHash,randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE="ADMIN_CASTLE_BATTLE_RESET_ALL",PERMISSION_CODE="game.castle_battle.manage",RESET_TICKET_CODE="legacy-castle-battle-reset-ticket";
export interface CastleBattleResetAllInput{eventId:string;externalUserId:string;channelId:string;message:string;}
export interface CastleBattleResetAllResult{status:"reset";seasonId:string;playerCount:string;stateRowsReset:string;dailyRowsReset:string;ticketStacksReset:string;ticketQuantityRemoved:string;beforeChecksum:string;afterChecksum:string;data:"";outboxId:string;auditId:string;}
interface OperatorRow{operator_id:bigint;}
interface StateRow{active_season_id:bigint|null;}
interface ReplayRow{operator_id:bigint;result_json:string|CastleBattleResetAllResult;}
interface CountsRow{player_count:bigint;daily_count:bigint;ticket_stack_count:bigint;ticket_quantity:bigint;}
interface TicketRow{player_id:bigint;item_id:bigint;quantity:bigint;}

// 캐슬 대전 전체 초기화는 인자 없는 정확 명령만 허용합니다.
export function isCastleBattleResetAllCommand(message:string|undefined):boolean{return message==="/캐슬대전초기화";}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|CastleBattleResetAllResult):CastleBattleResetAllResult{return typeof value==="string"?JSON.parse(value) as CastleBattleResetAllResult:value;}
function hashRows(rows:readonly unknown[]):string{return createHash("sha256").update(JSON.stringify(rows,(_key,value)=>typeof value==="bigint"?value.toString():value)).digest("hex");}

// 모든 회원의 현재 캐슬 대전 상태·오늘 횟수·리셋권을 한 트랜잭션으로 초기화합니다.
export class CastleBattleResetAllService{
  constructor(private readonly database:DatabaseClient){}
  async handleIris(input:CastleBattleResetAllInput):Promise<{status:"changed";data:"";outboxId:string}|{status:"shadow"}|{status:"legacy_fallback"}>{
    if(!isCastleBattleResetAllCommand(input.message))throw new ApplicationError("INVALID_CASTLE_BATTLE_RESET_ALL_COMMAND","캐슬대전 초기화 명령 형식이 올바르지 않습니다.",422);
    const rollout=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]))[0];
    if(rollout===undefined||rollout.enabled!==1||rollout.rollout_state==="LEGACY_ONLY")return{status:"legacy_fallback"};
    if(rollout.rollout_state!=="ACTIVE")return{status:"shadow"};
    const result=await this.reset(input);return{status:"changed",data:"",outboxId:result.outboxId};
  }
  async reset(input:CastleBattleResetAllInput):Promise<CastleBattleResetAllResult>{
    if(!isCastleBattleResetAllCommand(input.message))throw new ApplicationError("INVALID_CASTLE_BATTLE_RESET_ALL_COMMAND","캐슬대전 초기화 명령 형식이 올바르지 않습니다.",422);
    const operator=await this.findOperator(input.externalUserId),key=eventKey(input.eventId);
    const existing=(await this.database.query<ReplayRow[]>("SELECT operator_id,result_json FROM castle_battle_reset_all_runs WHERE request_key=?",[key]))[0];
    if(existing!==undefined){if(existing.operator_id!==operator.operator_id)throw new ApplicationError("CASTLE_BATTLE_RESET_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(existing.result_json);}
    return this.database.withTransaction(async tx=>{
      const state=(await tx.query<StateRow[]>("SELECT active_season_id FROM castle_battle_season_state WHERE scope_key='GLOBAL' FOR UPDATE"))[0];
      if(state===undefined||state.active_season_id===null)throw new ApplicationError("CASTLE_BATTLE_ACTIVE_SEASON_REQUIRED","진행 중인 캐슬대전 시즌이 필요합니다.",409);
      const seasonId=state.active_season_id;
      const replay=(await tx.query<ReplayRow[]>("SELECT operator_id,result_json FROM castle_battle_reset_all_runs WHERE request_key=? FOR UPDATE",[key]))[0];
      if(replay!==undefined){if(replay.operator_id!==operator.operator_id)throw new ApplicationError("CASTLE_BATTLE_RESET_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(replay.result_json);}
      await tx.query("SELECT player_id FROM castle_battle_player_states WHERE season_id=? ORDER BY player_id FOR UPDATE",[seasonId]);
      await tx.query("SELECT player_id FROM player_pet_daily_records WHERE record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) ORDER BY player_id FOR UPDATE");
      await tx.query("SELECT stack.player_id FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE item.code=? ORDER BY stack.player_id FOR UPDATE",[RESET_TICKET_CODE]);
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'admin.castle_battle_reset_all',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,operator.operator_id]);
      await tx.execute(`INSERT INTO castle_battle_reset_all_player_changes(operation_id,player_id,season_id,previous_score,previous_win_count,previous_loss_count,previous_tier_point,previous_last_battle_at,previous_daily_attempts,previous_daily_score,previous_rank_label,ticket_item_id,previous_ticket_quantity)
        SELECT ?,player.id,?,battle.score,battle.win_count,battle.loss_count,battle.tier_point,battle.last_battle_at,daily.castle_battle_attempts,daily.castle_battle_score,daily.castle_rank_label,item.id,COALESCE(stack.quantity,0)
        FROM players player LEFT JOIN castle_battle_player_states battle ON battle.season_id=? AND battle.player_id=player.id
        LEFT JOIN player_pet_daily_records daily ON daily.player_id=player.id AND daily.record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))
        LEFT JOIN item_definitions item ON item.code=? LEFT JOIN inventory_stacks stack ON stack.player_id=player.id AND stack.item_id=item.id ORDER BY player.id`,[operation.insertId,seasonId,seasonId,RESET_TICKET_CODE]);
      const beforeRows=await tx.query<unknown[]>("SELECT player_id,previous_score,previous_win_count,previous_loss_count,previous_tier_point,previous_last_battle_at,previous_daily_attempts,previous_daily_score,previous_rank_label,previous_ticket_quantity FROM castle_battle_reset_all_player_changes WHERE operation_id=? ORDER BY player_id",[operation.insertId]);
      const beforeChecksum=hashRows(beforeRows);
      await tx.execute(`INSERT INTO castle_battle_player_states(season_id,player_id,score,win_count,loss_count,tier_point,last_battle_at,version)
        SELECT ?,player.id,0,0,0,1,NULL,1 FROM players player LEFT JOIN castle_battle_player_states battle ON battle.season_id=? AND battle.player_id=player.id WHERE battle.player_id IS NULL`,[seasonId,seasonId]);
      await tx.execute("UPDATE castle_battle_player_states SET score=0,win_count=0,loss_count=0,tier_point=1,last_battle_at=NULL,version=version+1 WHERE season_id=?",[seasonId]);
      await tx.execute("UPDATE player_pet_daily_records SET castle_battle_attempts=0,castle_battle_score=0,castle_rank_label=NULL,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))",[]);
      const tickets=await tx.query<TicketRow[]>("SELECT player_id,ticket_item_id item_id,previous_ticket_quantity quantity FROM castle_battle_reset_all_player_changes WHERE operation_id=? AND previous_ticket_quantity>0 ORDER BY player_id",[operation.insertId]);
      for(let index=0;index<tickets.length;index++){const ticket=tickets[index]!;await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,?,?,?,NULL,?,'castle_battle_reset_all')",[operation.insertId,index+1,ticket.player_id,ticket.item_id,-ticket.quantity]);}
      await tx.execute("DELETE stack FROM inventory_stacks stack JOIN castle_battle_reset_all_player_changes change_row ON change_row.operation_id=? AND change_row.player_id=stack.player_id AND change_row.ticket_item_id=stack.item_id WHERE change_row.previous_ticket_quantity>0",[operation.insertId]);
      const counts=(await tx.query<CountsRow[]>(`SELECT COUNT(*) player_count,COALESCE(SUM(CASE WHEN previous_daily_attempts IS NOT NULL THEN 1 ELSE 0 END),0) daily_count,COALESCE(SUM(CASE WHEN previous_ticket_quantity>0 THEN 1 ELSE 0 END),0) ticket_stack_count,COALESCE(SUM(previous_ticket_quantity),0) ticket_quantity FROM castle_battle_reset_all_player_changes WHERE operation_id=?`,[operation.insertId]))[0]!;
      const afterRows=await tx.query<unknown[]>("SELECT battle.player_id,battle.score,battle.win_count,battle.loss_count,battle.tier_point,battle.last_battle_at,COALESCE(daily.castle_battle_attempts,0) daily_attempts,COALESCE(daily.castle_battle_score,0) daily_score,daily.castle_rank_label,COALESCE(stack.quantity,0) ticket_quantity FROM castle_battle_player_states battle LEFT JOIN player_pet_daily_records daily ON daily.player_id=battle.player_id AND daily.record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) LEFT JOIN item_definitions item ON item.code=? LEFT JOIN inventory_stacks stack ON stack.player_id=battle.player_id AND stack.item_id=item.id WHERE battle.season_id=? ORDER BY battle.player_id",[RESET_TICKET_CODE,seasonId]);
      const afterChecksum=hashRows(afterRows);
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,attempt_count,available_at,sent_at,created_at) VALUES (?,'iris',?,'silent',?,'sent',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({silent:true,command:"/캐슬대전초기화"})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,COMMAND_CODE,operation.insertId]);
      const summary={seasonId:seasonId.toString(),playerCount:counts.player_count.toString(),stateRowsReset:counts.player_count.toString(),dailyRowsReset:counts.daily_count.toString(),ticketStacksReset:counts.ticket_stack_count.toString(),ticketQuantityRemoved:counts.ticket_quantity.toString(),tierPointNormalizedTo:1,beforeChecksum,afterChecksum,silent:true};
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'castle_battle_season',?,'castle.battle.reset_all','reset','Iris 캐슬대전초기화',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.operator_id,seasonId,JSON.stringify(summary)]);
      const result:CastleBattleResetAllResult={status:"reset",seasonId:seasonId.toString(),playerCount:counts.player_count.toString(),stateRowsReset:counts.player_count.toString(),dailyRowsReset:counts.daily_count.toString(),ticketStacksReset:counts.ticket_stack_count.toString(),ticketQuantityRemoved:counts.ticket_quantity.toString(),beforeChecksum,afterChecksum,data:"",outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await tx.execute("INSERT INTO castle_battle_reset_all_runs(request_key,operation_id,operator_id,season_id,player_count,state_rows_reset,daily_rows_reset,ticket_stacks_reset,ticket_quantity_removed,before_checksum,after_checksum,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",[key,operation.insertId,operator.operator_id,seasonId,counts.player_count,counts.player_count,counts.daily_count,counts.ticket_stack_count,counts.ticket_quantity,beforeChecksum,afterChecksum,JSON.stringify(result)]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
  private async findOperator(externalUserId:string):Promise<OperatorRow>{const row=(await this.database.query<OperatorRow[]>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code=? WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1`,[PERMISSION_CODE,externalUserId]))[0];if(row===undefined)throw new ApplicationError("CASTLE_BATTLE_RESET_PERMISSION_REQUIRED","❌ 캐슬대전 관리 권한이 없습니다.",403);return row;}
}
