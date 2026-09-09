import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export type HomeFurnitureAddDetails =
  | { kind: "usage" }
  | { kind: "format" }
  | { kind: "valid"; furnitureName: string; charmNumber: number; grade: string };

export interface HomeFurnitureAddResult {
  status: "added" | "rejected" | "ignored";
  reply?: string;
  outboxId?: string;
  targetPlayerId?: string;
  furnitureDefinitionId?: string;
  furnitureInstanceId?: string;
}

type Operator = { operator_id: bigint };
type Target = { player_id: bigint; display_name: string };

const USAGE = "사용법: /가구추가 닉네임 가구이름 매력 등급\n예) /가구추가 🏆호이 남 샤넬 컬렉션💎 56050 시그니엘";
const TARGET_PARSE = "대상 닉네임 또는 가구 정보 파싱에 실패했습니다.\n예) /가구추가 🏆호이 남 샤넬 컬렉션💎 56050 시그니엘";
const FORMAT = "가구이름 / 매력 / 등급 형식이 잘못되었습니다.\n예) /가구추가 🏆호이 남 호이의 마음💌 10000 쥬 엘";
const CHARM = "매력수치는 숫자로 입력해주세요.\n예) /가구추가 🏆호이 남 호이의 마음💌 10000 쥬 엘";

// 레거시와 동일하게 '/가구추가 ' 접두사가 있는 입력만 실행 후보로 봅니다.
export function isHomeFurnitureAddCandidate(message: string | undefined): boolean {
  return message !== undefined && message.startsWith("/가구추가 ");
}

export function normalizeHomeFurnitureAddDispatchMessage(message: string): string {
  return isHomeFurnitureAddCandidate(message) ? "/가구추가" : message;
}

// 대상 닉네임을 제외한 입력에서 첫 Number 토큰을 매력으로 해석합니다.
export function parseHomeFurnitureAddDetails(rest: string): HomeFurnitureAddDetails {
  const parts = rest.trim().split(/\s+/).filter(value => value.length > 0);
  if (parts.length < 3) return { kind: "usage" };
  let charmIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    if (!Number.isNaN(Number(parts[index]))) { charmIndex = index; break; }
  }
  if (charmIndex <= 0 || charmIndex >= parts.length - 1) return { kind: "format" };
  return { kind: "valid", furnitureName: parts.slice(0, charmIndex).join(" "), charmNumber: Number(parts[charmIndex]), grade: parts.slice(charmIndex + 1).join(" ") };
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | HomeFurnitureAddResult): HomeFurnitureAddResult { return typeof value === "string" ? JSON.parse(value) as HomeFurnitureAddResult : value; }
function definitionCode(name: string, charm: bigint): string { return `admin-${createHash("sha256").update(`${name}\u0000${charm}`).digest("hex")}`; }

async function complete(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; operatorId: bigint; targetPlayerId: bigint | null; resultCode: string; reply: string; result: Omit<HomeFurnitureAddResult,"reply"|"outboxId">; summary: Record<string,unknown> }): Promise<HomeFurnitureAddResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId,input.destinationId,JSON.stringify({data:input.reply})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_FURNITURE_ADD',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'home.furniture_add',?,'Iris /가구추가',?,UTC_TIMESTAMP(3))", [input.operationId,input.operatorId,input.targetPlayerId,input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,reply:input.reply,outboxId:outbox.insertId.toString()} as HomeFurnitureAddResult;
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);
  return result;
}

// 활성 관리자가 stable 가구 정의와 새 가방 인스턴스를 한 트랜잭션으로 지급합니다.
export class HomeFurnitureAddService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<HomeFurnitureAddResult>{
    const raw=input.message.substring("/가구추가".length).trim();
    return this.database.withTransaction(async transaction=>{
      const operator=(await transaction.query<Operator[]>("SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE",[input.externalUserId]))[0];
      if(operator===undefined)return{status:"ignored"};
      const prior=(await transaction.query<Array<{result_json:string|HomeFurnitureAddResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='home.furniture_add' AND idempotency_key=? FOR UPDATE",[eventKey(input.eventId)]))[0];
      if(prior?.result_json!=null)return stored(prior.result_json);
      const operationId=(await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.furniture_add',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),eventKey(input.eventId),operator.operator_id])).insertId;
      const reject=(code:string,reply:string,targetPlayerId:bigint|null=null,summary:Record<string,unknown>={})=>complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetPlayerId,resultCode:code,reply,result:{status:"rejected"},summary:{mutation:false,...summary}});
      if(raw.length===0)return reject("usage",USAGE);
      const target=(await transaction.query<Target[]>("SELECT player.id player_id,profile.current_display_name display_name FROM players player JOIN player_profiles profile ON profile.player_id=player.id WHERE player.status='active' AND player.deleted_at IS NULL AND BINARY LEFT(?,CHAR_LENGTH(profile.current_display_name))=BINARY profile.current_display_name AND (CHAR_LENGTH(?)=CHAR_LENGTH(profile.current_display_name) OR SUBSTRING(?,CHAR_LENGTH(profile.current_display_name)+1,1)=' ') ORDER BY CHAR_LENGTH(profile.current_display_name) DESC,player.id LIMIT 1 FOR UPDATE",[raw,raw,raw]))[0];
      if(target===undefined)return reject("target_parse_failed",TARGET_PARSE,null,{rawLength:raw.length});
      const rest=raw.substring(target.display_name.length).trim();
      if(rest.length===0)return reject("target_parse_failed",TARGET_PARSE,target.player_id);
      const details=parseHomeFurnitureAddDetails(rest);
      if(details.kind==="usage")return reject("usage",USAGE,target.player_id);
      if(details.kind==="format")return reject("format",FORMAT,target.player_id);
      if(!Number.isFinite(details.charmNumber)||!Number.isSafeInteger(details.charmNumber)||details.charmNumber<0)return reject("invalid_charm",CHARM,target.player_id,{charm:String(details.charmNumber)});
      const charm=BigInt(details.charmNumber);
      const code=definitionCode(details.furnitureName,charm);
      await transaction.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES (?,?,?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE",[code,details.furnitureName,charm]);
      const definition=(await transaction.query<Array<{id:bigint;display_name:string;charm_value:bigint}>>("SELECT id,display_name,charm_value FROM furniture_definitions WHERE code=? FOR UPDATE",[code]))[0]!;
      if(definition.display_name!==details.furnitureName||BigInt(definition.charm_value)!==charm)throw new Error("가구 정의 KEY 충돌이 발생했습니다.");
      const instance=await transaction.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,?,'bag',1)",[target.player_id,definition.id,charm,details.grade]);
      await transaction.execute("INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,1,?,?,'none','bag','HOME_FURNITURE_ADD')",[operationId,target.player_id,instance.insertId]);
      await transaction.execute("INSERT INTO home_furniture_add_operations(operation_id,operator_id,target_player_id,furniture_definition_id,furniture_instance_id,furniture_code,furniture_name_snapshot,charm_snapshot,grade_display_name_snapshot) VALUES (?,?,?,?,?,?,?,?,?)",[operationId,operator.operator_id,target.player_id,definition.id,instance.insertId,code,details.furnitureName,charm,details.grade]);
      const displayName=`${details.furnitureName}(+${details.charmNumber}💕)[${details.grade}]`;
      const reply=`🏡 가구 추가 완료!\n👤 대상: ${target.display_name}\n🎨 이름: ${details.furnitureName}\n💕 매력: ${details.charmNumber}\n🎖 등급: ${details.grade}\n📦 표시명: ${displayName}`;
      return complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetPlayerId:target.player_id,resultCode:"added",reply,result:{status:"added",targetPlayerId:target.player_id.toString(),furnitureDefinitionId:definition.id.toString(),furnitureInstanceId:instance.insertId.toString()},summary:{mutation:true,targetPlayerId:target.player_id.toString(),furnitureDefinitionId:definition.id.toString(),furnitureInstanceId:instance.insertId.toString(),furnitureCode:code,charm:charm.toString(),grade:details.grade,statusAfter:"bag"}});
    });
  }
}
