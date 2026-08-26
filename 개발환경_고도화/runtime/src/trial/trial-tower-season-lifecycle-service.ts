import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const START_NOTICE='[알림]\n시련의탑😈 시즌이 시작되었습니다.\n\n다른 차원과 이 세계를 이어주는 통로\n"게이트"가 열려 마물이 던전을 통하여\n오톡세계를 침입하였습니다.\n\n용사님들 오톡세계의 평화를 위해\n시련의 탑😈을 등반하여 주세요!!';
const END_NOTICE="시련의탑😈 시즌이 종료되었습니다\n용사님들의 시련의 탑😈 최정상을 정복하여\n오톡세계에 평화가 찾아옵니다 . . .\n고생하셨습니다. ( _ _)";

export interface TrialTowerSeasonReply { outboxId:string; room:string; data:string; }
export interface TrialTowerSeasonResult {
  status:"changed"; active:boolean; previousActive:boolean; data:string; outboxId:string; auditId:string; replies:TrialTowerSeasonReply[];
}

// 시즌 시작·종료 두 정확 명령만 lifecycle 후보로 허용합니다.
export function isTrialTowerSeasonLifecycleCommand(message:string|undefined):boolean {
  return message==="/시련의탑시즌시작"||message==="/시련의탑시즌종료";
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞춥니다.
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
// 저장된 JSON 결과를 replay 응답으로 복원합니다.
function stored(value:string|TrialTowerSeasonResult):TrialTowerSeasonResult{return typeof value==="string"?JSON.parse(value) as TrialTowerSeasonResult:value;}

// 현재 시즌 flag와 전이 snapshot·공지 outbox를 한 transaction으로 저장합니다.
export class TrialTowerSeasonLifecycleService {
  constructor(private readonly database:DatabaseClient,private readonly broadcastIds:string[]){}
  async change(input:{message:string;idempotencyKey:string;sourceEventId:string;operatorId:string}):Promise<TrialTowerSeasonResult>{
    const active=input.message==="/시련의탑시즌시작",data=active?START_NOTICE:END_NOTICE;
    return this.database.withTransaction(async transaction=>{
      const scope=`admin.trial_tower.season:${input.operatorId}`,key=eventKey(input.idempotencyKey);
      const prior=await transaction.query<Array<{result_json:string|TrialTowerSeasonResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
      if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null)return stored(prior[0].result_json);
      const season=(await transaction.query<Array<{active:number}>>("SELECT active FROM trial_tower_seasons WHERE season_key='current' FOR UPDATE"))[0];
      if(season===undefined)throw new Error("Current trial tower season is missing.");
      const operation=await transaction.execute(`INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,[randomUUID(),scope,key,input.operatorId]);
      await transaction.execute("INSERT INTO trial_tower_season_transitions(operation_id,season_key,previous_active,changed_active) VALUES (?,'current',?,?)",[operation.insertId,season.active===1,active]);
      await transaction.execute("UPDATE trial_tower_seasons SET active=?,version=version+1 WHERE season_key='current'",[active]);
      const rooms=[...new Set(this.broadcastIds)],replies:TrialTowerSeasonReply[]=[];
      for(const room of rooms){const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,room,JSON.stringify({data})]);replies.push({outboxId:outbox.insertId.toString(),room,data});}
      if(replies.length===0)throw new Error("Trial tower season notice requires at least one broadcast room.");
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'trial_tower_season_lifecycle',?,'completed','notice_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.sourceEventId,operation.insertId]);
      const audit=await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'trial_tower_season',NULL,'trial_tower.season.change','success',?, ?,UTC_TIMESTAMP(3))",[operation.insertId,input.operatorId,input.message,JSON.stringify({seasonKey:'current',previousActive:season.active===1,active,broadcastCount:replies.length})]);
      const result:TrialTowerSeasonResult={status:"changed",active,previousActive:season.active===1,data,outboxId:replies[0]!.outboxId,auditId:audit.insertId.toString(),replies};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}
