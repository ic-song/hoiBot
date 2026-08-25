import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const MANAGER_ROLE = "manager";
export interface AdminRoleDeleteCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface AdminRoleDeleteResult { status: "revoked"; targetPlayerId: string; targetOperatorId: string; targetName: string; roleCode: string; operatorDisabled: boolean; outboxId: string; auditId: string; data: string; replayed?: boolean; }

// 대상명이 포함된 관리자 삭제 명령만 실행 대상으로 인정합니다.
export function isAdminRoleDeleteCommand(message: string | undefined): boolean { return message !== undefined && /^\/관리자삭제\s+\S(?:.*\S)?$/.test(message); }

// 관리자 삭제 대상명을 정규화해 해석합니다.
function parseTargetName(message: string): string { const matched=/^\/관리자삭제\s+(\S(?:.*\S)?)$/.exec(message);if(matched===null)throw new ApplicationError("INVALID_ADMIN_ROLE_DELETE_COMMAND","정확한 /관리자삭제 [회원명]을 입력해주세요.",422);return matched[1]!; }

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId:string):string{return eventId.length<=191?eventId:`sha256:${createHash("sha256").update(eventId).digest("hex")}`;}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function parseStoredResult(value:string|AdminRoleDeleteResult):AdminRoleDeleteResult{const result=typeof value==="string"?JSON.parse(value)as AdminRoleDeleteResult:value;return{...result,replayed:true};}

// manager 역할 회수·operator/session 비활성화·이력·감사·응답을 한 트랜잭션으로 저장합니다.
export class AdminRoleDeleteService {
 constructor(private readonly database:DatabaseClient){}
 async execute(command:AdminRoleDeleteCommand):Promise<AdminRoleDeleteResult>{
  const targetName=parseTargetName(command.message);
  return this.database.withTransaction(async transaction=>{
   const actors=await transaction.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active' AND permission.permission_code='admin.role.revoke' LIMIT 1 FOR UPDATE`,[command.externalUserId]);const actor=actors[0];if(actor===undefined)throw new ApplicationError("FORBIDDEN","관리자 삭제 권한이 없습니다.",403);
   const scope=`admin.role-delete:${actor.operator_id}`,eventKey=normalizeEventKey(command.eventId);const prior=await transaction.query<Array<{result_json:string|AdminRoleDeleteResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,eventKey]);if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null){const replay=parseStoredResult(prior[0].result_json);if(replay.targetName!==targetName)throw new ApplicationError("ADMIN_ROLE_DELETE_REPLAY_MISMATCH","같은 이벤트의 관리자 대상이 이전 요청과 다릅니다.",409);return replay;}
   const targets=await transaction.query<Array<{player_id:bigint;external_identity_id:bigint}>>(`SELECT profile.player_id,identity.id external_identity_id FROM player_profiles profile JOIN external_identities identity ON identity.player_id=profile.player_id WHERE profile.current_display_name=? AND identity.provider_code='kakao' AND identity.status='linked' ORDER BY profile.player_id,identity.id LIMIT 3 FOR UPDATE`,[targetName]);if(targets.length===0)throw new ApplicationError("ADMIN_TARGET_NOT_FOUND",`❌ [${targetName}] 회원 또는 연결된 Kakao identity를 찾을 수 없습니다.`,404);if(targets.length>1)throw new ApplicationError("ADMIN_TARGET_AMBIGUOUS","동일 회원명 또는 Kakao identity가 여러 개라 관리자 삭제를 중단했습니다.",409);const target=targets[0]!;
   const roles=await transaction.query<Array<{id:bigint}>>("SELECT id FROM admin_roles WHERE code=? AND active=TRUE FOR UPDATE",[MANAGER_ROLE]);const role=roles[0];if(role===undefined)throw new ApplicationError("MANAGER_ROLE_REQUIRED","manager 역할 설정을 찾을 수 없습니다.",409);
   const mappings=await transaction.query<Array<{operator_id:bigint}>>("SELECT operator_id FROM admin_operator_external_identities WHERE external_identity_id=? FOR UPDATE",[target.external_identity_id]);const mapping=mappings[0];if(mapping===undefined)throw new ApplicationError("ADMIN_ROLE_NOT_ASSIGNED",`[${targetName}] 님은 관리자가 아닙니다.`,409);
   const assigned=await transaction.query<Array<{operator_id:bigint}>>("SELECT operator_id FROM admin_operator_roles WHERE operator_id=? AND role_id=? FOR UPDATE",[mapping.operator_id,role.id]);if(assigned[0]===undefined)throw new ApplicationError("ADMIN_ROLE_NOT_ASSIGNED",`[${targetName}] 님은 manager 관리자가 아닙니다.`,409);
   const operation=await transaction.execute(`INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,[randomUUID(),scope,eventKey,actor.operator_id]);
   await transaction.execute("DELETE FROM admin_operator_roles WHERE operator_id=? AND role_id=?",[mapping.operator_id,role.id]);
   const remaining=await transaction.query<Array<{role_count:bigint}>>("SELECT COUNT(*) role_count FROM admin_operator_roles WHERE operator_id=? FOR UPDATE",[mapping.operator_id]);const operatorDisabled=(remaining[0]?.role_count??0n)===0n;if(operatorDisabled){await transaction.execute("UPDATE admin_operators SET status='inactive',updated_at=UTC_TIMESTAMP(3) WHERE id=?",[mapping.operator_id]);await transaction.execute("UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE operator_id=?",[mapping.operator_id]);}
   await transaction.execute(`INSERT INTO admin_role_assignment_history(operation_id,actor_operator_id,target_operator_id,target_player_id,external_identity_id,role_id,action_code) VALUES(?,?,?,?,?,?,'revoked')`,[operation.insertId,actor.operator_id,mapping.operator_id,target.player_id,target.external_identity_id,role.id]);
   const data=`✅ [${targetName}] 님의 관리자 권한을 삭제했습니다.`;const outbox=await transaction.execute(`INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[operation.insertId,command.channelId,JSON.stringify({data})]);await transaction.execute(`INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'admin_role_delete',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[command.eventId,operation.insertId]);const audit=await transaction.execute(`INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'admin_operator',?,'admin_operator',?,'admin.role.revoke','success','Iris /관리자삭제',?,UTC_TIMESTAMP(3))`,[operation.insertId,actor.operator_id,mapping.operator_id,JSON.stringify({targetPlayerId:target.player_id.toString(),roleCode:MANAGER_ROLE,operatorDisabled})]);const result:AdminRoleDeleteResult={status:"revoked",targetPlayerId:target.player_id.toString(),targetOperatorId:mapping.operator_id.toString(),targetName,roleCode:MANAGER_ROLE,operatorDisabled,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString(),data};await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
  });
 }
}
