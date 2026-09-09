import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

interface ActorRow { identity_id: bigint; }
interface TargetRow { player_id: bigint; pet_id: bigint; image_value: string | null; version: bigint; }
export interface PetAppearanceInput { targetName: string; newImage: string; }
export interface PetAppearanceResult { status: "updated" | "not_found"; data?: string; outboxId?: string; targetPlayerId?: string; petId?: string; previousImage?: string | null; newImage?: string; }

// 레거시 탐욕 정규식의 마지막 공백 기준 외형 분리를 보존합니다.
export function parsePetAppearanceCommand(message: string): PetAppearanceInput | null {
  const match = /^\/외형 (.+) (.+)$/.exec(message);
  return match === null ? null : { targetName: match[1]!, newImage: match[2]! };
}

// 완전한 외형 변경 명령만 공용 dispatch 후보로 허용합니다.
export function isPetAppearanceCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && parsePetAppearanceCommand(message) !== null;
}

// 인자가 있는 외형 명령을 registry 대표 별칭으로 정규화합니다.
export function normalizePetAppearanceDispatchMessage(message: string): string {
  return isPetAppearanceCommandCandidate(message) ? "/외형" : message;
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | PetAppearanceResult): PetAppearanceResult { return typeof value === "string" ? JSON.parse(value) as PetAppearanceResult : value; }

async function complete(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: ActorRow; target?: TargetRow; resultCode: string; data: string; result: PetAppearanceResult; summary: Record<string, unknown>; }): Promise<PetAppearanceResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId,input.destinationId,JSON.stringify({data:input.data})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_PET_APPEARANCE_SET',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pet.appearance.set',?,'Iris /외형',?,UTC_TIMESTAMP(3))", [input.operationId,input.actor.identity_id,input.target?.player_id??null,input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,data:input.data,outboxId:outbox.insertId.toString()};
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);
  return result;
}

// 총괄 운영자 권한으로 안정 펫 ID의 외형 projection을 원자 변경합니다.
export class AdminPetAppearanceService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<PetAppearanceResult|null>{
    const parsed=parsePetAppearanceCommand(input.message);if(parsed===null)return null;
    const actors=await this.database.query<ActorRow[]>(`SELECT identity.id identity_id FROM external_identities identity JOIN admin_operator_external_identities link ON link.external_identity_id=identity.id JOIN admin_operators operator_row ON operator_row.id=link.operator_id AND operator_row.status='active' JOIN admin_operator_roles assignment ON assignment.operator_id=operator_row.id JOIN admin_roles role ON role.id=assignment.role_id AND role.code='super_admin' AND role.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,[input.externalUserId]);
    const actor=actors[0];if(actor===undefined)return null;
    return this.database.withTransaction(async transaction=>{
      const key=eventKey(input.eventId),prior=await transaction.query<Array<{result_json:string|PetAppearanceResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='pet.appearance.set' AND idempotency_key=? FOR UPDATE",[key]);if(prior[0]?.result_json!=null)return stored(prior[0].result_json);
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.appearance.set',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,actor.identity_id]);
      const targets=await transaction.query<TargetRow[]>(`SELECT profile.player_id,pet.id pet_id,pet.image_value,pet.version FROM player_profiles profile JOIN player_pets pet ON pet.player_id=profile.player_id WHERE profile.current_display_name=? LIMIT 1 FOR UPDATE`,[parsed.targetName]),target=targets[0];
      if(target===undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,resultCode:"not_found",data:"대상의 펫이 존재하지 않습니다.",result:{status:"not_found"},summary:{targetName:parsed.targetName,newImage:parsed.newImage,mutation:false}});
      const changed=await transaction.execute("UPDATE player_pets SET image_value=?,version=version+1 WHERE id=? AND player_id=? AND version=?",[parsed.newImage,target.pet_id,target.player_id,target.version]);if(changed.affectedRows!==1n)throw new Error("펫 외형 정보가 먼저 변경되었습니다.");
      return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,target,resultCode:"updated",data:`${parsed.targetName}님의 펫 외형을 ${parsed.newImage}(으)로 변경했습니다.`,result:{status:"updated",targetPlayerId:target.player_id.toString(),petId:target.pet_id.toString(),previousImage:target.image_value,newImage:parsed.newImage},summary:{targetName:parsed.targetName,petId:target.pet_id.toString(),previousImage:target.image_value,newImage:parsed.newImage,previousVersion:target.version.toString(),nextVersion:(target.version+1n).toString()}});
    });
  }
}
