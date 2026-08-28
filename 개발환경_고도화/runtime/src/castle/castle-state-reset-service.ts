import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/캐슬초기화";
const COMMAND_CODE = "CASTLE_STATE_RESET";
const STATE_CODE = "HOI_CASTLE";
const FIXED_OPERATOR_NAME = "호이 남";
type Numeric = bigint | number | string;

interface OperatorRow { operator_id: Numeric; player_id: Numeric; display_name: string; }
interface StateRow {
  state_code: string; lord_player_id: Numeric | null; lord_guild_name: string | null;
  tax_rate_basis_points: number; earnings: Numeric; defense_count: Numeric; version: Numeric;
}

export interface CastleStateProjection {
  lordPlayerId: string; lordGuildName: null; taxRateBasisPoints: 1200;
  earnings: "0"; defenseCount: "0";
}

export interface CastleStateResetResult {
  status: "reset"; silent: true; stateCode: string; resetRunId: string;
  previousVersion: string; resetVersion: string; previousState: Record<string,string|null>;
  resetState: CastleStateProjection; replayed: boolean;
}

// 인자와 별칭이 없는 정확한 캐슬 초기화 명령만 현대화 경로로 전달합니다.
export function isCastleStateResetCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

// 레거시 고정 운영자 문자열을 다른 관리자 이름이나 부분 일치로 확장하지 않습니다.
export function isCastleStateResetActor(displayName: string | undefined): boolean {
  return displayName === FIXED_OPERATOR_NAME;
}

// 레거시 객체 교체의 네 기본값을 관계형 캐슬 상태 projection으로 변환합니다.
export function buildCastleStateResetProjection(lordPlayerId: string): CastleStateProjection {
  return {lordPlayerId,lordGuildName:null,taxRateBasisPoints:1200,earnings:"0",defenseCount:"0"};
}

// 캐슬 상태 한 행을 version lock으로 초기화하고 무응답 실행 증거를 원자 보존합니다.
export class CastleStateResetService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input:{eventId:string;externalUserId:string;message:string}):Promise<CastleStateResetResult|null>{
    if(!isCastleStateResetCommand(input.message))return null;
    return this.database.withTransaction(async transaction=>{
      const operator=(await transaction.query<OperatorRow[]>(
        `SELECT operator.id operator_id,identity.player_id,operator.display_name
           FROM external_identities identity
           JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
           JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
            AND identity.player_id IS NOT NULL AND operator.display_name=?
          ORDER BY operator.id LIMIT 2 FOR UPDATE`,[input.externalUserId,FIXED_OPERATOR_NAME]
      ))[0];
      if(operator===undefined||!isCastleStateResetActor(operator.display_name))return null;
      const key=eventKey(input.eventId),scope="castle.state.reset";
      const reservation=await transaction.execute(
        "INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,operator.operator_id]
      );
      if(reservation.affectedRows===0n){
        const prior=(await transaction.query<Array<{result_json:string|CastleStateResetResult|null}>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]
        ))[0];
        if(prior?.result_json!=null)return{...stored(prior.result_json),replayed:true};
        throw new ApplicationError("CASTLE_STATE_RESET_IN_PROGRESS","캐슬 초기화가 처리 중입니다.",409);
      }
      const operation=reservation.insertId;
      const state=(await transaction.query<StateRow[]>(
        "SELECT state_code,lord_player_id,lord_guild_name,tax_rate_basis_points,earnings,defense_count,version FROM castle_state WHERE state_code=? FOR UPDATE",
        [STATE_CODE]
      ))[0];
      if(state===undefined)throw new ApplicationError("CASTLE_STATE_REQUIRED","캐슬 상태가 준비되지 않았습니다.",409);
      const resetState=buildCastleStateResetProjection(String(operator.player_id));
      const updated=await transaction.execute(
        "UPDATE castle_state SET lord_player_id=?,lord_guild_name=NULL,tax_rate_basis_points=?,earnings=0,defense_count=0,version=version+1 WHERE state_code=? AND version=?",
        [operator.player_id,resetState.taxRateBasisPoints,STATE_CODE,state.version]
      );
      if(updated.affectedRows!==1n)throw new ApplicationError("CASTLE_STATE_VERSION_CONFLICT","캐슬 상태가 먼저 변경되었습니다.",409);
      const previousState={lordPlayerId:state.lord_player_id==null?null:String(state.lord_player_id),lordGuildName:state.lord_guild_name,taxRateBasisPoints:String(state.tax_rate_basis_points),earnings:String(state.earnings),defenseCount:String(state.defense_count)};
      const resetVersion=(BigInt(state.version)+1n).toString();
      const run=(await transaction.execute(
        `INSERT INTO castle_state_reset_runs(operation_id,actor_operator_id,state_code,previous_lord_player_id,previous_lord_guild_name,previous_tax_rate_basis_points,previous_earnings,previous_defense_count,previous_version,reset_lord_player_id,reset_tax_rate_basis_points,reset_earnings,reset_defense_count,reset_version)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [operation,operator.operator_id,STATE_CODE,state.lord_player_id,state.lord_guild_name,state.tax_rate_basis_points,state.earnings,state.defense_count,state.version,operator.player_id,resetState.taxRateBasisPoints,0,0,resetVersion]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,?,?,'completed','silent_reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId,COMMAND_CODE,operation]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'admin_operator',?,'castle_state',NULL,'castle.state.reset','reset','Iris /캐슬초기화',?,UTC_TIMESTAMP(3))",
        [operation,operator.operator_id,JSON.stringify({stateCode:STATE_CODE,previousState,resetState,previousVersion:String(state.version),resetVersion,silent:true,otherDomainsMutated:false})]
      );
      const result:CastleStateResetResult={status:"reset",silent:true,stateCode:STATE_CODE,resetRunId:run.toString(),previousVersion:String(state.version),resetVersion,previousState,resetState,replayed:false};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation]);
      return result;
    });
  }
}

function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|CastleStateResetResult):CastleStateResetResult{return typeof value==="string"?JSON.parse(value) as CastleStateResetResult:value;}
