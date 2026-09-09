import { createHash,randomUUID } from "node:crypto";
import type { DatabaseClient,DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE="CASTLE_BATTLE_SEASON_CLOSE_REWARD",PERMISSION_CODE="game.castle_battle.manage";
export interface CastleBattleSeasonCloseInput{eventId:string;externalUserId:string;channelId:string;message:string;}
export interface CastleBattleSeasonCloseResult{status:"closed";seasonId:string;seasonKey:string;snapshotId:string;snapshotEntryCount:string;rewardedPlayerCount:string;grantCount:string;totalItemQuantity:string;data:string;outboxId:string;auditId:string;}
interface OperatorRow{operator_id:bigint;}
interface StateRow{active_season_id:bigint|null;version:bigint;}
interface SeasonRow{id:bigint;season_key:string;status:string;version:bigint;}
interface ReplayRow{operator_id:bigint;result_json:string|CastleBattleSeasonCloseResult;}
interface RankRow{player_id:bigint;display_name:string;score:bigint;last_battle_at:string|null;tier_point:number;tier_display:string;}
interface RuleRow{tier_point:bigint;sequence_no:bigint;item_id:bigint;quantity:bigint;}

// 캐슬 대전 시즌 종료는 인자 없는 정확 명령만 허용합니다.
export function isCastleBattleSeasonCloseCommand(message:string|undefined):boolean{return message==="/캐슬대전시즌종료";}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|CastleBattleSeasonCloseResult):CastleBattleSeasonCloseResult{return typeof value==="string"?JSON.parse(value) as CastleBattleSeasonCloseResult:value;}

// 활성 시즌의 불변 순위 snapshot과 단일 보상 지급을 원자 확정합니다.
export class CastleBattleSeasonCloseService{
  constructor(private readonly database:DatabaseClient){}
  async handleIris(input:CastleBattleSeasonCloseInput):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"}|{status:"legacy_fallback"}>{
    if(!isCastleBattleSeasonCloseCommand(input.message))throw new ApplicationError("INVALID_CASTLE_BATTLE_SEASON_CLOSE_COMMAND","캐슬대전 시즌 종료 명령 형식이 올바르지 않습니다.",422);
    const rollout=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]))[0];
    if(rollout===undefined||rollout.enabled!==1||rollout.rollout_state==="LEGACY_ONLY")return{status:"legacy_fallback"};
    if(rollout.rollout_state!=="ACTIVE")return{status:"shadow"};
    const result=await this.close(input);return{status:"changed",data:result.data,outboxId:result.outboxId};
  }
  async close(input:CastleBattleSeasonCloseInput):Promise<CastleBattleSeasonCloseResult>{
    if(!isCastleBattleSeasonCloseCommand(input.message))throw new ApplicationError("INVALID_CASTLE_BATTLE_SEASON_CLOSE_COMMAND","캐슬대전 시즌 종료 명령 형식이 올바르지 않습니다.",422);
    const operator=await this.findOperator(input.externalUserId),key=eventKey(input.eventId);
    const existing=(await this.database.query<ReplayRow[]>("SELECT operator_id,result_json FROM castle_battle_season_reward_runs WHERE request_key=?",[key]))[0];
    if(existing!==undefined){if(existing.operator_id!==operator.operator_id)throw new ApplicationError("CASTLE_SEASON_CLOSE_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(existing.result_json);}
    return this.database.withTransaction(async tx=>{
      const state=(await tx.query<StateRow[]>("SELECT active_season_id,version FROM castle_battle_season_state WHERE scope_key='GLOBAL' FOR UPDATE"))[0];
      if(state===undefined)throw new ApplicationError("CASTLE_SEASON_STATE_REQUIRED","캐슬대전 시즌 상태를 확인할 수 없습니다.",409);
      const replay=(await tx.query<ReplayRow[]>("SELECT operator_id,result_json FROM castle_battle_season_reward_runs WHERE request_key=? FOR UPDATE",[key]))[0];
      if(replay!==undefined){if(replay.operator_id!==operator.operator_id)throw new ApplicationError("CASTLE_SEASON_CLOSE_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(replay.result_json);}
      if(state.active_season_id===null)throw new ApplicationError("CASTLE_BATTLE_ACTIVE_SEASON_REQUIRED","진행 중인 캐슬대전 시즌이 필요합니다.",409);
      const season=(await tx.query<SeasonRow[]>("SELECT id,season_key,status,version FROM castle_battle_seasons WHERE id=? FOR UPDATE",[state.active_season_id]))[0];
      if(season===undefined||season.status!=="active")throw new ApplicationError("CASTLE_BATTLE_ACTIVE_SEASON_REQUIRED","진행 중인 캐슬대전 시즌이 필요합니다.",409);
      const already=(await tx.query<Array<{request_key:string}>>("SELECT request_key FROM castle_battle_season_reward_runs WHERE season_id=? FOR UPDATE",[season.id]))[0];
      if(already!==undefined)throw new ApplicationError("CASTLE_SEASON_REWARD_ALREADY_PAID","이미 종료 보상이 지급된 시즌입니다.",409);
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'castle.battle_season_close_reward',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,operator.operator_id]);
      const snapshot=await this.createSnapshot(tx,season,operation.insertId);
      const grants=await this.payRewards(tx,operation.insertId,snapshot.snapshotId,snapshot.rows);
      const seasonWrite=await tx.execute("UPDATE castle_battle_seasons SET status='closed',ends_at=UTC_TIMESTAMP(3),version=version+1 WHERE id=? AND status='active' AND version=?",[season.id,season.version]);
      if(seasonWrite.affectedRows!==1n)throw new ApplicationError("CASTLE_SEASON_CLOSE_VERSION_CONFLICT","캐슬대전 시즌이 먼저 변경되었습니다.",409);
      const stateWrite=await tx.execute("UPDATE castle_battle_season_state SET active_season_id=NULL,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE scope_key='GLOBAL' AND active_season_id=? AND version=?",[season.id,state.version]);
      if(stateWrite.affectedRows!==1n)throw new ApplicationError("CASTLE_SEASON_CLOSE_STATE_CONFLICT","캐슬대전 시즌 상태가 먼저 변경되었습니다.",409);
      await tx.execute("UPDATE castle_battle_scheduled_transitions SET status='completed',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE season_id=? AND transition_code='SEASON_CLOSE' AND status='pending_manual'",[season.id]);
      const data=`🏰 캐슬대전 시즌이 종료되었습니다.\n시즌: ${season.season_key}\n보상 지급: ${grants.rewardedPlayerCount}명`;
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','closed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,COMMAND_CODE,operation.insertId]);
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'castle_battle_season',?,'castle.battle.season.close_reward','closed','Iris 캐슬대전시즌종료',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.operator_id,season.id,JSON.stringify({seasonKey:season.season_key,snapshotId:snapshot.snapshotId.toString(),snapshotEntryCount:snapshot.rows.length,rewardedPlayerCount:grants.rewardedPlayerCount,grantCount:grants.grantCount,totalItemQuantity:grants.totalItemQuantity.toString()})]);
      const result:CastleBattleSeasonCloseResult={status:"closed",seasonId:season.id.toString(),seasonKey:season.season_key,snapshotId:snapshot.snapshotId.toString(),snapshotEntryCount:String(snapshot.rows.length),rewardedPlayerCount:String(grants.rewardedPlayerCount),grantCount:String(grants.grantCount),totalItemQuantity:grants.totalItemQuantity.toString(),data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await tx.execute("INSERT INTO castle_battle_season_reward_runs(request_key,operation_id,operator_id,season_id,snapshot_id,rewarded_player_count,grant_count,total_item_quantity,result_json) VALUES (?,?,?,?,?,?,?,?,?)",[key,operation.insertId,operator.operator_id,season.id,snapshot.snapshotId,grants.rewardedPlayerCount,grants.grantCount,grants.totalItemQuantity,JSON.stringify(result)]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
  private async findOperator(externalUserId:string):Promise<OperatorRow>{const row=(await this.database.query<OperatorRow[]>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code=? WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1`,[PERMISSION_CODE,externalUserId]))[0];if(row===undefined)throw new ApplicationError("CASTLE_SEASON_CLOSE_PERMISSION_REQUIRED","❌ 캐슬대전 시즌 관리 권한이 없습니다.",403);return row;}
  private async createSnapshot(tx:DatabaseTransaction,season:SeasonRow,operationId:bigint):Promise<{snapshotId:bigint;rows:RankRow[]}>{
    const next=(await tx.query<Array<{snapshot_version:bigint}>>("SELECT COALESCE(MAX(snapshot_version),0)+1 snapshot_version FROM castle_battle_rank_snapshots WHERE season_id=?",[season.id]))[0]!.snapshot_version;
    const snapshot=await tx.execute("INSERT INTO castle_battle_rank_snapshots(season_id,snapshot_version,source_version,status,snapshot_at,published_at,created_at) VALUES (?,?,?,'published',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[season.id,next,`season-close:${operationId}`]);
    const rows=await tx.query<RankRow[]>(`SELECT state.player_id,profile.current_display_name display_name,state.score,state.last_battle_at,COALESCE(rank.tier_point,1) tier_point,COALESCE(rank.rank_name,'👻루키♦️') tier_display FROM castle_battle_player_states state JOIN player_profiles profile ON profile.player_id=state.player_id LEFT JOIN castle_battle_rank_definitions rank ON rank.score_requirement=(SELECT MAX(candidate.score_requirement) FROM castle_battle_rank_definitions candidate WHERE candidate.score_requirement<=state.score) WHERE state.season_id=? ORDER BY state.score DESC,state.last_battle_at DESC,state.player_id`,[season.id]);
    for(let index=0;index<rows.length;index++){const row=rows[index]!;await tx.execute("INSERT INTO castle_battle_rank_snapshot_entries(snapshot_id,player_id,stable_tie_key,display_name,rank_display,tier_display,score,last_battle_at) VALUES (?,?,?,?,?,?,?,?)",[snapshot.insertId,row.player_id,row.player_id.toString(),row.display_name,index+1,row.tier_display,row.score,row.last_battle_at]);}
    return{snapshotId:snapshot.insertId,rows};
  }
  private async payRewards(tx:DatabaseTransaction,operationId:bigint,snapshotId:bigint,players:RankRow[]):Promise<{rewardedPlayerCount:number;grantCount:number;totalItemQuantity:bigint}>{
    const rules=await tx.query<RuleRow[]>("SELECT tier_point,sequence_no,item_id,quantity FROM castle_battle_season_reward_rule_items ORDER BY tier_point,sequence_no");const byTier=new Map<number,RuleRow[]>();for(const rule of rules){const tier=Number(rule.tier_point),list=byTier.get(tier)??[];list.push(rule);byTier.set(tier,list);}
    let grantCount=0,totalItemQuantity=0n,ledgerSequence=0;for(let playerIndex=0;playerIndex<players.length;playerIndex++){const player=players[playerIndex]!,playerTier=Number(player.tier_point),tierRules=byTier.get(playerTier);if(tierRules===undefined||tierRules.length===0)throw new ApplicationError("CASTLE_SEASON_REWARD_RULE_REQUIRED",`캐슬대전 tier ${playerTier} 보상 규칙이 없습니다.`,409);for(const rule of tierRules){await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1",[player.player_id,rule.item_id,rule.quantity]);const balance=(await tx.query<Array<{quantity:bigint}>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",[player.player_id,rule.item_id]))[0]!.quantity;ledgerSequence++;await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,?,?,?,NULL,?,'castle_battle_season_reward')",[operationId,ledgerSequence,player.player_id,rule.item_id,rule.quantity]);await tx.execute("INSERT INTO castle_battle_season_reward_grants(operation_id,player_id,rank_display,tier_point,sequence_no,item_id,quantity,balance_after,snapshot_id) VALUES (?,?,?,?,?,?,?,?,?)",[operationId,player.player_id,playerIndex+1,playerTier,rule.sequence_no,rule.item_id,rule.quantity,balance,snapshotId]);grantCount++;totalItemQuantity+=rule.quantity;}}
    return{rewardedPlayerCount:players.length,grantCount,totalItemQuantity};
  }
}
