import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

interface IdentityPetRow { identity_id: bigint; player_id: bigint; player_pet_id: bigint; display_name: string; tier_code: string | null; }
interface PhraseRow { phrase_code: string; template_text: string; }
export interface PetSkillBoastReadResult { status: "boast" | "skill_required"; data: string; outboxId: string; playerId: string; playerPetId: string; phraseCode: string | null; roll: string | null; }
interface Options { random?: () => number; }

// exact /자랑만 롤렉스 자랑 조회 후보로 인정합니다.
export function isPetSkillBoastReadCommand(message: string | undefined): boolean { return message === "/자랑"; }

// 0 이상 1 미만 RNG 표본을 DB 문구 배열의 안정 인덱스로 변환합니다.
export function selectPetSkillBoastPhraseIndex(sample: number, phraseCount: number): number {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1 || !Number.isInteger(phraseCount) || phraseCount < 1) throw new Error("펫스킬 자랑 RNG 표본이 유효하지 않습니다.");
  return Math.floor(sample * phraseCount);
}

// DB 문구의 등급·사용자 자리표시자를 현재 projection으로 치환합니다.
export function formatPetSkillBoastPhrase(template: string, rank: string, name: string): string {
  return template.replace(/\{rank\}/g, rank).replace(/\{name\}/g, name);
}

function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|PetSkillBoastReadResult):PetSkillBoastReadResult{return typeof value==="string"?JSON.parse(value) as PetSkillBoastReadResult:value;}

// 장착 롤렉스·등급 snapshot과 선택 문구를 읽고 RNG·감사·outbox만 원자 기록합니다.
export class PetSkillBoastReadService {
  private readonly random:()=>number;
  constructor(private readonly database:DatabaseClient,options:Options={}){this.random=options.random??Math.random;}

  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<PetSkillBoastReadResult|null>{
    if(!isPetSkillBoastReadCommand(input.message))return null;
    return this.database.withTransaction(async transaction=>{
      const key=eventKey(input.eventId),prior=await transaction.query<Array<{result_json:string|PetSkillBoastReadResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='pet.skill_boast.read' AND idempotency_key=? FOR UPDATE",[key]);
      if(prior[0]?.result_json!=null)return stored(prior[0].result_json);
      const identities=await transaction.query<IdentityPetRow[]>(`SELECT identity.id identity_id,identity.player_id,pet.id player_pet_id,profile.current_display_name display_name,profile.tier_code
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
        JOIN player_profiles profile ON profile.player_id=player.id JOIN player_pets pet ON pet.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`,[input.externalUserId]),identity=identities[0];
      if(identity===undefined)return null;
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.skill_boast.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,identity.identity_id]);
      const equipped=(await transaction.query<Array<{equipped:number}>>(`SELECT 1 equipped FROM pet_skills skill JOIN skill_definitions definition ON definition.id=skill.skill_id AND definition.active=TRUE
        WHERE skill.player_pet_id=? AND skill.equipped=TRUE AND REPLACE(definition.display_name,' ','')='롤렉스' LIMIT 1`,[identity.player_pet_id]))[0];
      let status:PetSkillBoastReadResult["status"]="skill_required",phraseCode:string|null=null,roll:string|null=null;
      let data="롤렉스 펫스킬을 장착해야 자랑할 수 있습니다.";
      if(equipped!==undefined){
        const phrases=await transaction.query<PhraseRow[]>("SELECT phrase_code,template_text FROM pet_skill_boast_phrases WHERE active=TRUE ORDER BY display_order FOR UPDATE");
        if(phrases.length!==14)throw new Error("펫스킬 자랑 문구 14개가 필요합니다.");
        const sample=this.random(),index=selectPetSkillBoastPhraseIndex(sample,phrases.length),phrase=phrases[index]!;
        phraseCode=phrase.phrase_code;roll=sample.toFixed(17);status="boast";
        data=formatPetSkillBoastPhrase(phrase.template_text,identity.tier_code??"일반",identity.display_name);
        await transaction.execute("INSERT INTO rng_events(operation_id,player_id,event_code,period_key,sample_value,threshold_value,outcome_code,created_at) VALUES (?,?,'pet_skill_boast','event',?,?,?,UTC_TIMESTAMP(3))",[operation.insertId,identity.player_id,roll,(1/phrases.length).toFixed(17),phraseCode]);
      }
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_BOAST_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId,status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player_pet',?,'pet.skill_boast.read',?,'Iris /자랑',?,UTC_TIMESTAMP(3))",[operation.insertId,identity.identity_id,identity.player_pet_id,status,JSON.stringify({phraseCode,roll,rank:identity.tier_code??"일반",domainMutation:false})]);
      const result:PetSkillBoastReadResult={status,data,outboxId:outbox.insertId.toString(),playerId:identity.player_id.toString(),playerPetId:identity.player_pet_id.toString(),phraseCode,roll};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
