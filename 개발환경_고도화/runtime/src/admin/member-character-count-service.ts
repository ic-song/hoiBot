import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface MemberCharacterCountResult {
  status: "counted" | "missing";
  characterCount: string | null;
  data: string | null;
  outboxId: string | null;
  auditId: string;
}

// 회원 원문 글자 수 명령은 인자 없는 정확한 명령만 허용합니다.
export function isMemberCharacterCountCommand(message:string|undefined):boolean{return message==="/멤버글자수";}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function format(value:bigint):string{return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function stored(value:string|MemberCharacterCountResult):MemberCharacterCountResult{return typeof value==="string"?JSON.parse(value) as MemberCharacterCountResult:value;}

// 고정된 member 원문 snapshot의 Rhino UTF-16 글자 수와 응답 원장을 원자 기록합니다.
export class MemberCharacterCountService{
  constructor(private readonly database:DatabaseClient){}
  async count(input:{idempotencyKey:string;sourceEventId:string;destinationId:string;identityId:string}):Promise<MemberCharacterCountResult>{
    return this.database.withTransaction(async transaction=>{
      const scope=`admin.member_character_count:${input.identityId}`,key=eventKey(input.idempotencyKey);
      const prior=await transaction.query<Array<{result_json:string|MemberCharacterCountResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
      if(prior[0]?.result_json!=null)return stored(prior[0].result_json);
      const snapshots=await transaction.query<Array<{utf16_character_count:bigint;content_sha256:string;source_version:string}>>("SELECT utf16_character_count,content_sha256,source_version FROM pet_member_storage_snapshots WHERE snapshot_code='member' FOR UPDATE"),snapshot=snapshots[0];
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,input.identityId]);
      const characterCount=snapshot?.utf16_character_count??null,data=characterCount===null?null:`총 글자 수 : ${format(characterCount)}`;
      let outboxId:string|null=null;
      if(data!==null){const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);outboxId=outbox.insertId.toString();}
      const resultCode=data===null?"no_reply":"reply_queued";
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_MEMBER_CHARACTER_COUNT',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.sourceEventId,operation.insertId,resultCode]);
      const audit=await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'member_snapshot',NULL,'member.character_count',?,'Iris /멤버글자수',?,UTC_TIMESTAMP(3))",[operation.insertId,input.identityId,resultCode,JSON.stringify({characterCount:characterCount?.toString()??null,contentSha256:snapshot?.content_sha256??null,sourceVersion:snapshot?.source_version??null})]);
      const result:MemberCharacterCountResult={status:data===null?"missing":"counted",characterCount:characterCount?.toString()??null,data,outboxId,auditId:audit.insertId.toString()};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
