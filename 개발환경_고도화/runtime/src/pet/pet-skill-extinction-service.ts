import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export const PET_SKILL_EXTINCTION_TICKET_CODE = "pet_skill_extinction_ticket";
export interface PetSkillExtinctionResult { reply:string; outboxId:string; removedSkill:string|null; slotNo:number|null; ticketQuantity:string; mutated:boolean; }

// 펫스킬소멸 후보를 좁게 식별하고 실제 실행은 전체 숫자 패턴으로 제한합니다.
export function isPetSkillExtinctionCandidate(message:string|undefined):boolean {
  return message==="/펫스킬소멸" || message?.startsWith("/펫스킬소멸 ")===true;
}
export function parsePetSkillExtinction(message:string):number|null {
  const match=/^\/펫스킬소멸\s+([1-9]\d*)$/.exec(message);
  if(!match)return null;
  const value=Number(match[1]);
  return Number.isSafeInteger(value)&&value<=4294967295?value:null;
}
export function normalizePetSkillExtinctionDispatchMessage(message:string):string {
  return parsePetSkillExtinction(message)===null?message:"/펫스킬소멸 [번호]";
}

// 장착 스킬과 소멸권을 함께 잠그고 삭제·재정렬·재고 원장을 원자 처리합니다.
export class PetSkillExtinctionService {
  constructor(private readonly database:DatabaseClient){}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<PetSkillExtinctionResult>{
    return this.database.withTransaction(async tx=>{
      const key=input.eventId.length<=191?input.eventId:`sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior=await tx.query<Array<{result_json:string|PetSkillExtinctionResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='pet.skill_extinction' AND idempotency_key=? FOR UPDATE",[key]);
      if(prior[0]?.result_json!=null)return typeof prior[0].result_json==="string"?JSON.parse(prior[0].result_json) as PetSkillExtinctionResult:prior[0].result_json;
      const slot=parsePetSkillExtinction(input.message);
      const actor=(await tx.query<Array<{player_id:bigint;player_pet_id:bigint|null}>>(`SELECT player.id player_id,pet.id player_pet_id FROM external_identities identity_row JOIN players player ON player.id=identity_row.player_id LEFT JOIN player_pets pet ON pet.player_id=player.id WHERE identity_row.provider_code='kakao' AND identity_row.external_user_id=? AND identity_row.status='linked' AND player.status='active' AND player.deleted_at IS NULL ORDER BY pet.id LIMIT 1 FOR UPDATE`,[input.externalUserId]))[0];
      let reply="사용법: /펫스킬소멸 [장착스킬번호]\n번호는 /펫스킬의 장착 목록 기준입니다.";
      let removed:string|null=null,ticket=0n,mutated=false,skillId:bigint|null=null,itemId:bigint|null=null;
      if(slot!==null&&actor?.player_pet_id!=null){
        const skill=(await tx.query<Array<{skill_id:bigint;display_name:string}>>(`SELECT pet_skill.skill_id,definition.display_name FROM pet_skills pet_skill JOIN skill_definitions definition ON definition.id=pet_skill.skill_id WHERE pet_skill.player_pet_id=? AND pet_skill.slot_no=? AND pet_skill.equipped=TRUE FOR UPDATE`,[actor.player_pet_id,slot]))[0];
        if(skill){skillId=skill.skill_id;removed=skill.display_name;}
      }
      if(slot!==null&&actor&&skillId!==null){
        const stack=(await tx.query<Array<{item_id:bigint;quantity:bigint}>>(`SELECT item.id item_id,COALESCE(stack.quantity,0) quantity FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code=? AND item.active=TRUE FOR UPDATE`,[actor.player_id,PET_SKILL_EXTINCTION_TICKET_CODE]))[0];
        itemId=stack?.item_id??null;ticket=BigInt(stack?.quantity??0);
        if(ticket<1n)reply="❌ 펫스킬소멸권🧙‍♂️(/펫스킬소멸 번호) 아이템이 필요합니다.";
      }
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.skill_extinction',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key]);
      if(slot!==null&&actor?.player_pet_id!=null&&skillId!==null&&itemId!==null&&ticket>=1n){
        await tx.execute("DELETE FROM pet_skills WHERE player_pet_id=? AND slot_no=? AND skill_id=?",[actor.player_pet_id,slot,skillId]);
        await tx.execute("UPDATE pet_skills SET slot_no=slot_no-1 WHERE player_pet_id=? AND equipped=TRUE AND slot_no>? ORDER BY slot_no",[actor.player_pet_id,slot]);
        await tx.execute("UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND quantity>=1",[actor.player_id,itemId]);
        await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code,created_at) VALUES (?,1,?,?,NULL,-1,'pet_skill_extinction',UTC_TIMESTAMP(3))",[operation.insertId,actor.player_id,itemId]);
        ticket-=1n;mutated=true;reply=`✅ ${removed?.endsWith("📙")?removed:`${removed}📙`} 소멸 완료!`;
      }
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data:reply})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_EXTINCTION',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId,mutated?"extinguished":"guarded"]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',NULL,'player_pet',?,'pet.skill_extinction',?,'Iris /펫스킬소멸',?,UTC_TIMESTAMP(3))",[operation.insertId,actor?.player_pet_id??null,mutated?"success":"guarded",JSON.stringify({slotNo:slot,removedSkill:removed,ticketQuantity:ticket.toString(),domainMutation:mutated})]);
      const result:PetSkillExtinctionResult={reply,outboxId:outbox.insertId.toString(),removedSkill:removed,slotNo:slot,ticketQuantity:ticket.toString(),mutated};
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
