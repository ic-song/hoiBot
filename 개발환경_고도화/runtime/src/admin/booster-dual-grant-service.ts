import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const MAX_COUNTER_GRANT = 1000000n;
const BOOSTER_COUNTER_CODE = "boostercnt";
const BOOSTER_PACKAGE_CODE = "tower_booster_package";

type BoosterGrantMode = "counter" | "package";
interface ParsedBoosterGrant { mode: BoosterGrantMode; targetName: string; quantity: bigint; }
export interface BoosterDualGrantCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface BoosterDualGrantResult {
  status: "granted"; mode: BoosterGrantMode; targetPlayerId: string; targetName: string; grantQuantity: string;
  counterValue?: string; itemQuantity?: string; outboxId: string; auditId: string; data: string; replayed?: boolean;
}

// 부스터 횟수 지급과 패키지 지급의 완전한 두 명령 형식만 인정합니다.
export function isBoosterDualGrantCommand(message: string | undefined): boolean {
  return message !== undefined && (/^\/부스터\s+\S(?:.*\S)?\s+\d+$/.test(message) || /^\/부스터,\s*\S(?:.*\S)?$/.test(message));
}

// 공백 모드와 쉼표 모드를 구분하고 안전한 수량·대상을 해석합니다.
function parseBoosterGrant(message: string): ParsedBoosterGrant {
  const packageMatch=/^\/부스터,\s*(\S(?:.*\S)?)$/.exec(message);
  if(packageMatch!==null)return{mode:"package",targetName:packageMatch[1]!,quantity:1n};
  const counterMatch=/^\/부스터\s+(\S(?:.*\S)?)\s+(\d+)$/.exec(message);
  if(counterMatch===null)throw new ApplicationError("INVALID_BOOSTER_GRANT_COMMAND","정확한 /부스터 [대상] [횟수] 또는 /부스터, [대상]을 입력해주세요.",422);
  const quantity=BigInt(counterMatch[2]!);
  if(quantity>MAX_COUNTER_GRANT)throw new ApplicationError("BOOSTER_GRANT_LIMIT","부스터 지급 횟수는 0~1,000,000회만 가능합니다.",422);
  return{mode:"counter",targetName:counterMatch[1]!,quantity};
}

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function eventKey(eventId:string):string{return eventId.length<=191?eventId:`sha256:${createHash("sha256").update(eventId).digest("hex")}`;}
// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value:string|BoosterDualGrantResult):BoosterDualGrantResult{const result=typeof value==="string"?JSON.parse(value)as BoosterDualGrantResult:value;return{...result,replayed:true};}

// mode별 operator 권한을 확인합니다.
async function authorize(tx:DatabaseTransaction,externalUserId:string,mode:BoosterGrantMode):Promise<bigint>{
  const permission=mode==="counter"?"booster.counter.grant":"booster.package.grant";
  const rows=await tx.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity
    JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
    JOIN admin_operators operator ON operator.id=mapping.operator_id
    JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
    JOIN admin_role_permissions role_permission ON role_permission.role_id=operator_role.role_id
    WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
      AND operator.status='active' AND role_permission.permission_code=? LIMIT 1 FOR UPDATE`,[externalUserId,permission]);
  if(rows[0]===undefined)throw new ApplicationError("FORBIDDEN","부스터 지급 권한이 없습니다.",403);return rows[0].operator_id;
}

// counter 또는 package 지급을 원장·감사·응답과 함께 원자적으로 저장합니다.
export class BoosterDualGrantService {
  constructor(private readonly database:DatabaseClient){}
  async execute(command:BoosterDualGrantCommand):Promise<BoosterDualGrantResult>{
    if(!isBoosterDualGrantCommand(command.message))throw new ApplicationError("INVALID_BOOSTER_GRANT_COMMAND","정확한 /부스터 [대상] [횟수] 또는 /부스터, [대상]을 입력해주세요.",422);
    const parsed=parseBoosterGrant(command.message);
    return this.database.withTransaction(async tx=>{
      const operatorId=await authorize(tx,command.externalUserId,parsed.mode),scope=`admin.booster-dual-grant:${operatorId}`,key=eventKey(command.eventId);
      const prior=await tx.query<Array<{result_json:string|BoosterDualGrantResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
      if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null)return stored(prior[0].result_json);
      const targets=await tx.query<Array<{player_id:bigint}>>("SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2 FOR UPDATE",[parsed.targetName]);
      if(targets.length===0)throw new ApplicationError("PLAYER_NOT_FOUND",`❌ [${parsed.targetName}] 님은 존재하지 않습니다.`,404);
      if(targets.length>1)throw new ApplicationError("PLAYER_NAME_AMBIGUOUS","동일 표시명의 회원이 여러 명이므로 player ID로 지급해야 합니다.",409);
      const playerId=targets[0]!.player_id;
      let counterValue:string|undefined,itemQuantity:string|undefined,itemId:bigint|undefined,version:bigint|undefined,current=0n;
      if(parsed.mode==="counter"){
        await tx.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value,version,updated_at) VALUES(?,'boostercnt','lifetime',0,1,UTC_TIMESTAMP(3))",[playerId]);
        const rows=await tx.query<Array<{value:bigint;version:bigint}>>("SELECT value,version FROM player_counters WHERE player_id=? AND counter_code='boostercnt' AND period_key='lifetime' FOR UPDATE",[playerId]);current=rows[0]!.value;version=rows[0]!.version;
      }else{
        const items=await tx.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code=? AND display_name='시탑부스터패키지' AND active=TRUE AND stackable=TRUE",[BOOSTER_PACKAGE_CODE]);
        if(items[0]===undefined)throw new ApplicationError("BOOSTER_PACKAGE_REQUIRED","시탑부스터패키지 설정을 찾을 수 없습니다.",409);itemId=items[0].id;
        await tx.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,0,1)",[playerId,itemId]);
        const rows=await tx.query<Array<{quantity:bigint;version:bigint}>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",[playerId,itemId]);current=rows[0]!.quantity;version=rows[0]!.version;
      }
      const operation=await tx.execute(`INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
        VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,[randomUUID(),scope,key,operatorId]);
      const after=current+parsed.quantity;
      if(parsed.mode==="counter"){
        if(parsed.quantity>0n){const changed=await tx.execute("UPDATE player_counters SET value=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code=? AND period_key='lifetime' AND version=?",[after,playerId,BOOSTER_COUNTER_CODE,version]);if(changed.affectedRows!==1n)throw new ApplicationError("BOOSTER_COUNTER_CONFLICT","부스터 횟수가 먼저 변경되었습니다.",409);await tx.execute("INSERT INTO player_counter_ledger(operation_id,sequence_no,player_id,counter_code,period_key,value_delta,reason_code) VALUES(?,1,?,'boostercnt','lifetime',?,'admin_booster_counter_grant')",[operation.insertId,playerId,parsed.quantity]);}counterValue=after.toString();
      }else{
        const changed=await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[after,playerId,itemId,version]);if(changed.affectedRows!==1n)throw new ApplicationError("BOOSTER_PACKAGE_CONFLICT","대상의 가방 정보가 먼저 변경되었습니다.",409);await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES(?,1,?,?,1,'admin_booster_package_grant')",[operation.insertId,playerId,itemId]);itemQuantity=after.toString();
      }
      const data=parsed.mode==="counter"?`✅ [${parsed.targetName}] 님에게 경험치 부스터 ${parsed.quantity}회를 지급했습니다.`:`✅ [${parsed.targetName}] 님에게 시탑부스터패키지 1개를 지급했습니다.`;
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,command.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'admin_booster_dual_grant',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[command.eventId,operation.insertId]);
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'admin_operator',?,'player',?,'booster.dual.grant','success','Iris /부스터',?,UTC_TIMESTAMP(3))",[operation.insertId,operatorId,playerId,JSON.stringify({mode:parsed.mode,grantQuantity:parsed.quantity.toString(),counterValue,itemQuantity})]);
      const result:BoosterDualGrantResult={status:"granted",mode:parsed.mode,targetPlayerId:playerId.toString(),targetName:parsed.targetName,grantQuantity:parsed.quantity.toString(),counterValue,itemQuantity,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString(),data};
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}
