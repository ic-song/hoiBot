import { createHash,randomUUID } from "node:crypto";
import type { DatabaseClient,DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE="CASTLE_BATTLE_SEASON_START",PERMISSION_CODE="game.castle_battle.manage";
export interface CastleBattleSeasonStartInput{eventId:string;externalUserId:string;channelId:string;message:string;}
export interface CastleBattleSeasonStartResult{status:"started";seasonId:string;seasonKey:string;previousSeasonId:string|null;baselineSnapshotId:string|null;baselineEntryCount:string;initializedPlayerCount:string;resetTierCount:string;preservedStateChecksum:string;transitionKey:string;data:string;outboxId:string;auditId:string;}
interface OperatorRow{operator_id:bigint;}
interface StateRow{active_season_id:bigint|null;version:bigint;}
interface SeasonRow{id:bigint;season_key:string;status:string;version:bigint;}
interface ReplayRow{operator_id:bigint;result_json:string|CastleBattleSeasonStartResult;}
interface BaselineRow{player_id:bigint;display_name:string;score:bigint;tier_display:string;last_battle_at:string|null;}

// 캐슬 대전 시즌 시작은 인자 없는 정확 명령만 허용합니다.
export function isCastleBattleSeasonStartCommand(message:string|undefined):boolean{return message==="/캐슬대전시즌시작";}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|CastleBattleSeasonStartResult):CastleBattleSeasonStartResult{return typeof value==="string"?JSON.parse(value) as CastleBattleSeasonStartResult:value;}
function hashRows(rows:readonly unknown[]):string{return createHash("sha256").update(JSON.stringify(rows,(_key,value)=>typeof value==="bigint"?value.toString():value)).digest("hex");}

// 직전 순위 baseline과 비-tier 상태를 보존하며 활성 시즌 하나를 원자 시작합니다.
export class CastleBattleSeasonStartService{
  constructor(private readonly database:DatabaseClient){}
  async handleIris(input:CastleBattleSeasonStartInput):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"}|{status:"legacy_fallback"}>{
    if(!isCastleBattleSeasonStartCommand(input.message))throw new ApplicationError("INVALID_CASTLE_BATTLE_SEASON_START_COMMAND","캐슬대전 시즌 시작 명령 형식이 올바르지 않습니다.",422);
    const rollout=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]))[0];
    if(rollout===undefined||rollout.enabled!==1||rollout.rollout_state==="LEGACY_ONLY")return{status:"legacy_fallback"};
    if(rollout.rollout_state!=="ACTIVE")return{status:"shadow"};
    const result=await this.start(input);return{status:"changed",data:result.data,outboxId:result.outboxId};
  }
  async start(input:CastleBattleSeasonStartInput):Promise<CastleBattleSeasonStartResult>{
    if(!isCastleBattleSeasonStartCommand(input.message))throw new ApplicationError("INVALID_CASTLE_BATTLE_SEASON_START_COMMAND","캐슬대전 시즌 시작 명령 형식이 올바르지 않습니다.",422);
    const operator=await this.findOperator(input.externalUserId),key=eventKey(input.eventId);
    const existing=(await this.database.query<ReplayRow[]>("SELECT operator_id,result_json FROM castle_battle_season_start_runs WHERE request_key=?",[key]))[0];
    if(existing!==undefined){if(existing.operator_id!==operator.operator_id)throw new ApplicationError("CASTLE_SEASON_START_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(existing.result_json);}
    return this.database.withTransaction(async tx=>{
      const state=(await tx.query<StateRow[]>("SELECT active_season_id,version FROM castle_battle_season_state WHERE scope_key='GLOBAL' FOR UPDATE"))[0];
      if(state===undefined)throw new ApplicationError("CASTLE_SEASON_STATE_REQUIRED","캐슬대전 시즌 상태를 확인할 수 없습니다.",409);
      const replay=(await tx.query<ReplayRow[]>("SELECT operator_id,result_json FROM castle_battle_season_start_runs WHERE request_key=? FOR UPDATE",[key]))[0];
      if(replay!==undefined){if(replay.operator_id!==operator.operator_id)throw new ApplicationError("CASTLE_SEASON_START_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(replay.result_json);}
      const active=(await tx.query<SeasonRow[]>("SELECT id,season_key,status,version FROM castle_battle_seasons WHERE status='active' ORDER BY starts_at DESC,id DESC LIMIT 1 FOR UPDATE"))[0];
      if(active!==undefined)throw new ApplicationError("CASTLE_SEASON_ALREADY_ACTIVE",`이미 진행 중인 캐슬대전 시즌이 있습니다. (${active.season_key})`,409);
      const previous=(await tx.query<SeasonRow[]>("SELECT season.id,season.season_key,season.status,season.version FROM castle_battle_seasons season WHERE season.status<>'active' ORDER BY EXISTS(SELECT 1 FROM castle_battle_player_states state WHERE state.season_id=season.id) DESC,season.starts_at DESC,season.id DESC LIMIT 1 FOR UPDATE"))[0];
      const identity=(await tx.query<Array<{day_key:string;next_no:bigint}>>("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y%m%d') day_key,COALESCE(MAX(id),0)+1 next_no FROM castle_battle_seasons"))[0]!;
      const seasonKey=`castle-${identity.day_key}-${identity.next_no}`;
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'admin.castle_battle_season_start',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,operator.operator_id]);
      const baseline=await this.createBaseline(tx,previous,seasonKey);
      const seasonWrite=await tx.execute("INSERT INTO castle_battle_seasons(season_key,status,starts_at,ends_at,version) VALUES (?,'active',UTC_TIMESTAMP(3),NULL,1)",[seasonKey]);
      const seasonId=seasonWrite.insertId;
      await tx.execute(`INSERT INTO castle_battle_player_states(season_id,player_id,score,win_count,loss_count,tier_point,last_battle_at,version)
        SELECT ?,player.id,COALESCE(previous.score,0),COALESCE(previous.win_count,0),COALESCE(previous.loss_count,0),1,previous.last_battle_at,1
        FROM players player LEFT JOIN castle_battle_player_states previous ON previous.player_id=player.id AND previous.season_id=? WHERE player.status='active' ORDER BY player.id`,[seasonId,previous?.id??0]);
      await tx.execute(`INSERT INTO castle_battle_season_start_player_changes(operation_id,player_id,previous_season_id,season_id,previous_tier_point,tier_point)
        SELECT ?,player.id,?,?,previous.tier_point,1 FROM players player LEFT JOIN castle_battle_player_states previous ON previous.player_id=player.id AND previous.season_id=? WHERE player.status='active' ORDER BY player.id`,[operation.insertId,previous?.id??null,seasonId,previous?.id??0]);
      const counts=(await tx.query<Array<{initialized_count:bigint;reset_count:bigint}>>("SELECT COUNT(*) initialized_count,SUM(CASE WHEN change_row.previous_tier_point IS NOT NULL AND change_row.previous_tier_point<>1 THEN 1 ELSE 0 END) reset_count FROM castle_battle_season_start_player_changes change_row WHERE change_row.operation_id=?",[operation.insertId]))[0]!;
      const stateWrite=await tx.execute("UPDATE castle_battle_season_state SET active_season_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE scope_key='GLOBAL' AND version=?",[seasonId,state.version]);
      if(stateWrite.affectedRows!==1n)throw new ApplicationError("CASTLE_SEASON_START_VERSION_CONFLICT","캐슬대전 시즌 상태가 먼저 변경되었습니다.",409);
      const transitionKey=`castle-season-close:${seasonKey}`;
      await tx.execute("INSERT INTO castle_battle_scheduled_transitions(transition_key,season_id,transition_code,scheduled_for,status,operation_id,version) VALUES (?,?,'SEASON_CLOSE',NULL,'pending_manual',?,1)",[transitionKey,seasonId,operation.insertId]);
      const preservedRows=await tx.query<Array<{player_id:bigint;score:bigint;win_count:bigint;loss_count:bigint;last_battle_at:string|null}>>("SELECT player_id,score,win_count,loss_count,last_battle_at FROM castle_battle_player_states WHERE season_id=? ORDER BY player_id",[seasonId]);
      const preservedStateChecksum=hashRows(preservedRows);
      const data=`✅ 캐슬대전 시즌이 시작되었습니다.\n시즌: ${seasonKey}\n참여 상태: ${counts.initialized_count}명`;
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','started',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,COMMAND_CODE,operation.insertId]);
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'castle_battle_season',?,'castle.battle.season.start','started','Iris 캐슬대전시즌시작',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.operator_id,seasonId,JSON.stringify({seasonKey,previousSeasonId:previous?.id.toString()??null,baselineSnapshotId:baseline.snapshotId?.toString()??null,baselineEntryCount:baseline.entryCount.toString(),initializedPlayerCount:counts.initialized_count.toString(),resetTierCount:counts.reset_count.toString(),preservedStateChecksum,transitionKey})]);
      const result:CastleBattleSeasonStartResult={status:"started",seasonId:seasonId.toString(),seasonKey,previousSeasonId:previous?.id.toString()??null,baselineSnapshotId:baseline.snapshotId?.toString()??null,baselineEntryCount:baseline.entryCount.toString(),initializedPlayerCount:counts.initialized_count.toString(),resetTierCount:counts.reset_count.toString(),preservedStateChecksum,transitionKey,data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await tx.execute("INSERT INTO castle_battle_season_start_runs(request_key,operation_id,operator_id,season_id,baseline_snapshot_id,initialized_player_count,reset_tier_count,result_json) VALUES (?,?,?,?,?,?,?,?)",[key,operation.insertId,operator.operator_id,seasonId,baseline.snapshotId,counts.initialized_count,counts.reset_count,JSON.stringify(result)]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
  private async findOperator(externalUserId:string):Promise<OperatorRow>{const row=(await this.database.query<OperatorRow[]>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code=? WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1`,[PERMISSION_CODE,externalUserId]))[0];if(row===undefined)throw new ApplicationError("CASTLE_SEASON_START_PERMISSION_REQUIRED","❌ 캐슬대전 시즌 관리 권한이 없습니다.",403);return row;}
  private async createBaseline(tx:DatabaseTransaction,previous:SeasonRow|undefined,seasonKey:string):Promise<{snapshotId:bigint|null;entryCount:bigint}>{if(previous===undefined)return{snapshotId:null,entryCount:0n};const next=(await tx.query<Array<{snapshot_version:bigint}>>("SELECT COALESCE(MAX(snapshot_version),0)+1 snapshot_version FROM castle_battle_rank_snapshots WHERE season_id=?",[previous.id]))[0]!.snapshot_version;const snapshot=await tx.execute("INSERT INTO castle_battle_rank_snapshots(season_id,snapshot_version,source_version,status,snapshot_at,created_at) VALUES (?,?,?,'baseline',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[previous.id,next,`season-start:${seasonKey}`]);const rows=await tx.query<BaselineRow[]>(`SELECT state.player_id,profile.current_display_name display_name,state.score,COALESCE(rank.rank_name,CONCAT('tier-',state.tier_point)) tier_display,state.last_battle_at FROM castle_battle_player_states state JOIN player_profiles profile ON profile.player_id=state.player_id LEFT JOIN castle_battle_rank_definitions rank ON rank.tier_point=state.tier_point WHERE state.season_id=? ORDER BY state.score DESC,state.last_battle_at DESC,state.player_id`,[previous.id]);for(let index=0;index<rows.length;index++){const row=rows[index]!;await tx.execute("INSERT INTO castle_battle_rank_snapshot_entries(snapshot_id,player_id,stable_tie_key,display_name,rank_display,tier_display,score,last_battle_at) VALUES (?,?,?,?,?,?,?,?)",[snapshot.insertId,row.player_id,row.player_id.toString(),row.display_name,index+1,row.tier_display,row.score,row.last_battle_at]);}return{snapshotId:snapshot.insertId,entryCount:BigInt(rows.length)};}
}
