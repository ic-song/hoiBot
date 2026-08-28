import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

interface OperatorRow { operator_id: bigint; }
interface PlayerRow { player_id: bigint; display_name: string; }
interface OwnedMiniPetRow {
  id: bigint; player_id: bigint; mini_pet_definition_id: bigint; custom_name: string | null;
  progress: bigint; enhancement_level: bigint; battle_experience: bigint; castle_experience: bigint;
  raid_experience: bigint; sale_price: bigint | null; is_elite: number; bag_sequence: bigint | null;
  version: bigint; equipped: number; display_name: string; grade_code: string | null;
  grade_display_name: string | null; emoji_value: string | null;
}
interface TitleAssignmentRow { title_id: bigint; title_code: string; display_name: string; acquired_at: Date | string | null; equipped: number; }

export interface MiniPetAdminOwnedDeleteResult {
  status: "deleted" | "usage" | "not_found" | "equipped" | "reserved" | "silent";
  data?: string; outboxId?: string; targetPlayerId?: string; ownedMiniPetId?: string;
  removedTitleCount?: string; reindexedCount?: string;
}
export interface MiniPetAdminOwnedDeleteCommand { targetName: string; bagSequence: bigint; }

// 미니펫 삭제 대표 명령과 인자형 후보만 dispatch 대상으로 제한합니다.
export function isMiniPetAdminOwnedDeleteCommand(message: string | undefined): boolean {
  return message !== undefined && (message === "/미니펫삭제" || /^\/미니펫삭제\s+.+$/.test(message));
}
// 마지막 양의 정수를 가방번호로 사용하고 앞부분 전체를 대상 표시명으로 보존합니다.
export function parseMiniPetAdminOwnedDeleteCommand(message: string): MiniPetAdminOwnedDeleteCommand | undefined {
  const match = /^\/미니펫삭제\s+(\S(?:.*\S)?)\s+([1-9]\d*)$/.exec(message);
  return match === null ? undefined : { targetName: match[1]!, bagSequence: BigInt(match[2]!) };
}
// 검증된 인자형 후보를 DB command alias로 정규화합니다.
export function normalizeMiniPetAdminOwnedDeleteDispatchMessage(message: string): string {
  return isMiniPetAdminOwnedDeleteCommand(message) ? "/미니펫삭제" : message;
}
function idempotencyKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function storedResult(value: string | MiniPetAdminOwnedDeleteResult): MiniPetAdminOwnedDeleteResult { return typeof value === "string" ? JSON.parse(value) as MiniPetAdminOwnedDeleteResult : value; }
function petLabel(row: OwnedMiniPetRow): string { const name=row.custom_name??row.display_name,emoji=row.emoji_value??"",grade=row.grade_display_name??row.grade_code??"등급 없음"; return `${name}${emoji} [${grade}]`; }
function petSnapshot(row: OwnedMiniPetRow): Record<string, unknown> {
  return { ownedMiniPetId:row.id.toString(),miniPetDefinitionId:row.mini_pet_definition_id.toString(),customName:row.custom_name,displayName:row.display_name,emoji:row.emoji_value,gradeCode:row.grade_code,gradeDisplayName:row.grade_display_name,progress:row.progress.toString(),enhancementLevel:row.enhancement_level.toString(),battleExperience:row.battle_experience.toString(),castleExperience:row.castle_experience.toString(),raidExperience:row.raid_experience.toString(),salePrice:row.sale_price?.toString()??null,elite:row.is_elite===1,bagSequence:row.bag_sequence?.toString()??null,version:row.version.toString() };
}
async function complete(transaction:DatabaseTransaction,input:{operationId:bigint;eventId:string;destinationId:string;operatorId:bigint;targetType:"player"|"owned_mini_pet";targetId:string|null;resultCode:string;data:string;result:MiniPetAdminOwnedDeleteResult;summary:Record<string,unknown>}):Promise<MiniPetAdminOwnedDeleteResult>{
  const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data:input.data})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MINI_PET_ADMIN_OWNED_DELETE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,?,?,?,?,'Iris 총괄 운영자 /미니펫삭제',?,UTC_TIMESTAMP(3))",[input.operationId,input.operatorId,input.targetType,input.targetId,"mini_pet.admin_owned.delete",input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,data:input.data,outboxId:outbox.insertId.toString()};
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);
  return result;
}

// 총괄 운영자가 대상 가방번호를 stable ID로 해석해 의존성을 검증한 뒤 한 마리만 삭제합니다.
export class MiniPetAdminOwnedDeleteService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<MiniPetAdminOwnedDeleteResult>{
    if(!isMiniPetAdminOwnedDeleteCommand(input.message))return{status:"silent"};
    return this.database.withTransaction(async transaction=>{
      const operator=(await transaction.query<OperatorRow[]>(`SELECT operator.id operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' AND operator.display_name='호이 남' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND permission.permission_code='mini_pet.admin_owned.delete' ORDER BY operator.id LIMIT 1 FOR UPDATE`,[input.externalUserId]))[0];
      if(operator===undefined)return{status:"silent"};
      const operation=await transaction.execute(`INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'mini_pet.admin_owned.delete',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,[randomUUID(),idempotencyKey(input.eventId),operator.operator_id]);
      const prior=(await transaction.query<Array<{result_json:string|MiniPetAdminOwnedDeleteResult|null}>>("SELECT result_json FROM operations WHERE id=? FOR UPDATE",[operation.insertId]))[0];
      if(prior?.result_json!=null)return storedResult(prior.result_json);
      const command=parseMiniPetAdminOwnedDeleteCommand(input.message);
      if(command===undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetType:"player",targetId:null,resultCode:"usage",data:"사용법: /미니펫삭제 [대상] [가방번호]",result:{status:"usage"},summary:{mutation:false}});
      const players=await transaction.query<PlayerRow[]>(`SELECT player.id player_id,profile.current_display_name display_name FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL WHERE profile.current_display_name=? ORDER BY player.id LIMIT 2 FOR UPDATE`,[command.targetName]);
      const player=players.length===1?players[0]:undefined;
      if(player===undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetType:"player",targetId:null,resultCode:"not_found",data:"대상 유저가 없거나 동일한 표시명이 여러 명입니다.",result:{status:"not_found"},summary:{mutation:false,targetName:command.targetName,sourceBagSequence:command.bagSequence.toString()}});
      const owned=await transaction.query<OwnedMiniPetRow[]>(`SELECT pet.id,pet.player_id,pet.mini_pet_definition_id,pet.custom_name,pet.progress,pet.enhancement_level,pet.battle_experience,pet.castle_experience,pet.raid_experience,pet.sale_price,pet.is_elite,pet.bag_sequence,pet.version,pet.equipped,definition.display_name,definition.grade_code,definition.grade_display_name,definition.emoji_value FROM owned_mini_pets pet JOIN mini_pet_definitions definition ON definition.id=pet.mini_pet_definition_id WHERE pet.player_id=? ORDER BY pet.bag_sequence IS NULL,pet.bag_sequence,pet.id FOR UPDATE`,[player.player_id]);
      const index=Number(command.bagSequence-1n),selected=index>=0&&index<owned.length?owned[index]:undefined;
      if(selected===undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetType:"player",targetId:player.player_id.toString(),resultCode:"not_found",data:"해당 가방번호의 미니펫을 찾을 수 없습니다.",result:{status:"not_found",targetPlayerId:player.player_id.toString()},summary:{mutation:false,targetName:command.targetName,sourceBagSequence:command.bagSequence.toString()}});
      if(selected.equipped===1)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetType:"owned_mini_pet",targetId:selected.id.toString(),resultCode:"equipped",data:"장착 중인 미니펫은 삭제할 수 없습니다. 먼저 장착을 해제해주세요.",result:{status:"equipped",targetPlayerId:player.player_id.toString(),ownedMiniPetId:selected.id.toString()},summary:{mutation:false,targetName:command.targetName,sourceBagSequence:command.bagSequence.toString(),ownedMiniPetId:selected.id.toString()}});
      const reservation=(await transaction.query<Array<{listing_id:bigint}>>("SELECT listing_id FROM market_mini_pet_reservations WHERE owned_mini_pet_id=? FOR UPDATE",[selected.id]))[0];
      if(reservation!==undefined)return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetType:"owned_mini_pet",targetId:selected.id.toString(),resultCode:"reserved",data:"거래 등록 또는 예약 중인 미니펫은 삭제할 수 없습니다. 거래를 먼저 취소해주세요.",result:{status:"reserved",targetPlayerId:player.player_id.toString(),ownedMiniPetId:selected.id.toString()},summary:{mutation:false,targetName:command.targetName,sourceBagSequence:command.bagSequence.toString(),ownedMiniPetId:selected.id.toString(),listingId:reservation.listing_id.toString()}});
      const titles=await transaction.query<TitleAssignmentRow[]>(`SELECT assignment.title_id,definition.code title_code,definition.display_name,assignment.acquired_at,assignment.equipped FROM mini_pet_title_assignments assignment JOIN title_definitions definition ON definition.id=assignment.title_id WHERE assignment.owned_mini_pet_id=? ORDER BY assignment.title_id FOR UPDATE`,[selected.id]);
      const titleSnapshot=titles.map(title=>({titleId:title.title_id.toString(),titleCode:title.title_code,displayName:title.display_name,acquiredAt:title.acquired_at instanceof Date?title.acquired_at.toISOString():title.acquired_at,equipped:title.equipped===1}));
      await transaction.execute("DELETE FROM mini_pet_title_assignments WHERE owned_mini_pet_id=?",[selected.id]);
      const deleted=await transaction.execute("DELETE FROM owned_mini_pets WHERE id=? AND player_id=? AND equipped=FALSE AND version=?",[selected.id,player.player_id,selected.version]);
      if(deleted.affectedRows!==1n)throw new Error("MINI_PET_ADMIN_OWNED_DELETE_CONFLICT");
      const remaining=owned.filter(row=>row.id!==selected.id);let reindexedCount=0;
      for(let i=0;i<remaining.length;i++){const row=remaining[i]!,sequence=BigInt(i+1);if(row.bag_sequence===sequence)continue;const updated=await transaction.execute("UPDATE owned_mini_pets SET bag_sequence=?,version=version+1 WHERE id=? AND player_id=? AND version=?",[sequence,row.id,player.player_id,row.version]);if(updated.affectedRows!==1n)throw new Error("MINI_PET_ADMIN_OWNED_DELETE_REINDEX_CONFLICT");reindexedCount++;}
      await transaction.execute(`INSERT INTO mini_pet_admin_deletions(operation_id,operator_id,target_player_id,owned_mini_pet_id,mini_pet_definition_id,source_bag_sequence,owned_version_before,removed_title_count,reindexed_count,deleted_snapshot_json,title_assignments_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[operation.insertId,operator.operator_id,player.player_id,selected.id,selected.mini_pet_definition_id,command.bagSequence,selected.version,titles.length,reindexedCount,JSON.stringify(petSnapshot(selected)),JSON.stringify(titleSnapshot)]);
      const data=`미니펫 삭제 완료\n대상: ${player.display_name}\n삭제: ${petLabel(selected)}\n안정 ID: ${selected.id.toString()}`;
      return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,targetType:"owned_mini_pet",targetId:selected.id.toString(),resultCode:"deleted",data,result:{status:"deleted",targetPlayerId:player.player_id.toString(),ownedMiniPetId:selected.id.toString(),removedTitleCount:String(titles.length),reindexedCount:String(reindexedCount)},summary:{mutation:true,targetName:command.targetName,sourceBagSequence:command.bagSequence.toString(),ownedMiniPetId:selected.id.toString(),miniPetDefinitionId:selected.mini_pet_definition_id.toString(),removedTitleCount:titles.length,reindexedCount}});
    });
  }
}
