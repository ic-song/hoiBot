import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";

export interface DataBackupSourceObject {
  id: bigint;
  file_name: string;
  payload_text: string;
  content_sha256: string;
  size_bytes: bigint;
  revision_version: bigint;
  modified_at: string;
}

export interface DataBackupResult {
  runId: string;
  sourceRevisionKey: string;
  copiedFiles: string[];
  copiedCount: number;
  data: string;
  outboxId: string;
}

// DEV 문맥의 정확한 데이터 백업 명령만 현대화 dispatch 후보로 허용합니다.
export function isDataBackupCommand(message: string | undefined): boolean {
  return message === "dev/데이터백업";
}

export function isTopLevelFileName(fileName: string): boolean {
  return fileName.length > 0 && !fileName.includes("/") && !fileName.includes("\\");
}

// source의 정렬된 object revision과 hash를 한 run revision으로 고정합니다.
export function buildSourceRevisionKey(objects: readonly Pick<DataBackupSourceObject,"file_name"|"content_sha256"|"revision_version">[]): string {
  const value=objects.map((object)=>`${object.file_name}:${object.revision_version.toString()}:${object.content_sha256}`).join("\n");
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function formatDataBackupResult(files: readonly string[]): string {
  const lines=["✅ DEV 데이터 백업 완료",`복사 파일: ${files.length}개`];
  if(files.length===0)lines.push("- 복사할 운영 파일 없음");else files.forEach((file)=>lines.push(`- ${file}`));
  return lines.join("\n");
}

// Master 권한 확인 후 운영 최상위 파일 전체를 한 source revision으로 DEV에 원자 publish합니다.
export class DataBackupService {
  constructor(private readonly database:DatabaseClient){}
  async handleIris(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"|"handled_no_reply"}>{
    const decision=await new CommandDispatcher(new MariaCommandDispatchRepository(this.database),{enabled:true,allowAllCanaries:false,canaryUserIds:new Set()}).resolve({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true});
    if(decision.route==="SHADOW")return{status:"shadow"};if(decision.route!=="MODERN")return{status:"legacy_fallback"};
    const result=await this.backup({eventId:input.eventId,externalUserId:input.externalUserId,destinationId:input.channelId});if(result===null)return{status:"handled_no_reply"};return{status:"changed",data:result.data,outboxId:result.outboxId};
  }
  async backup(input:{eventId:string;externalUserId:string;destinationId:string}):Promise<DataBackupResult|null>{
    const operator=(await this.database.query<Array<{id:bigint}>>(`SELECT operator.id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active' AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='data_backup.execute' AND denied.effect='deny') AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='data_backup.execute' AND allowed.effect='allow') OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='data_backup.execute' WHERE operator_role.operator_id=operator.id)) LIMIT 1`,[input.externalUserId]))[0];
    if(operator===undefined)return null;
    const key=input.eventId.length<=191?input.eventId:`sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    return withDeadlockRetry(()=>this.database.withTransaction(async transaction=>{
      const previous=(await transaction.query<Array<{result_json:string|DataBackupResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='data_backup.execute' AND idempotency_key=? FOR UPDATE",[key]))[0];if(previous?.result_json!=null)return typeof previous.result_json==="string"?JSON.parse(previous.result_json):previous.result_json;
      const source=await transaction.query<DataBackupSourceObject[]>("SELECT id,file_name,payload_text,content_sha256,size_bytes,revision_version,DATE_FORMAT(modified_at,'%Y-%m-%d %H:%i:%s') modified_at FROM managed_data_objects WHERE environment_code='prod' AND file_name NOT LIKE '%/%' AND LOCATE(CHAR(92),file_name)=0 ORDER BY file_name ASC FOR UPDATE");
      for(const object of source){if(!isTopLevelFileName(object.file_name))throw new Error(`Nested source object blocked: ${object.file_name}`);const hash=createHash("sha256").update(object.payload_text).digest("hex"),size=BigInt(Buffer.byteLength(object.payload_text,"utf8"));if(hash!==object.content_sha256||size!==BigInt(object.size_bytes))throw new Error(`Source object integrity mismatch: ${object.file_name}`);}
      await transaction.query("SELECT id FROM managed_data_objects WHERE environment_code='dev' ORDER BY file_name ASC FOR UPDATE");
      const sourceRevisionKey=buildSourceRevisionKey(source),operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'data_backup.execute',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,operator.id]);
      const run=await transaction.execute("INSERT INTO backup_runs(operation_id,source_environment,target_environment,source_revision_key,run_status,file_count,created_at) VALUES (?,'prod','dev',?,'processing',?,UTC_TIMESTAMP(3))",[operation.insertId,sourceRevisionKey,source.length]);
      const copiedFiles:string[]=[];
      for(const object of source){const before=(await transaction.query<Array<{content_sha256:string}>>("SELECT content_sha256 FROM managed_data_objects WHERE environment_code='dev' AND file_name=? LIMIT 1",[object.file_name]))[0];await transaction.execute("INSERT INTO backup_manifest(run_id,file_name,source_object_id,source_revision,content_sha256,size_bytes,modified_at) VALUES (?,?,?,?,?,?,?)",[run.insertId,object.file_name,object.id,object.revision_version,object.content_sha256,object.size_bytes,object.modified_at]);const target=await transaction.execute("INSERT INTO managed_data_objects(environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at) VALUES ('dev',?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),payload_text=VALUES(payload_text),content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)",[object.file_name,object.payload_text,object.content_sha256,object.size_bytes]);await transaction.execute("INSERT INTO backup_run_items(run_id,file_name,target_object_id,item_status,before_sha256,after_sha256,completed_at) VALUES (?,?,?,'copied',?,?,UTC_TIMESTAMP(3))",[run.insertId,object.file_name,target.insertId,before?.content_sha256??null,object.content_sha256]);copiedFiles.push(object.file_name);}
      await transaction.execute("UPDATE backup_runs SET run_status='complete',completed_at=UTC_TIMESTAMP(3) WHERE id=?",[run.insertId]);const data=formatDataBackupResult(copiedFiles),outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_DATA_BACKUP',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId]);await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'backup_run',?,'data_backup.execute','success','Iris dev/데이터백업',?,UTC_TIMESTAMP(3))",[operation.insertId,operator.id,run.insertId,JSON.stringify({sourceEnvironment:"prod",targetEnvironment:"dev",sourceRevisionKey,copiedCount:copiedFiles.length,copiedFiles})]);const result:DataBackupResult={runId:run.insertId.toString(),sourceRevisionKey,copiedFiles,copiedCount:copiedFiles.length,data,outboxId:outbox.insertId.toString()};await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    }));
  }
}
async function withDeadlockRetry<T>(work:()=>Promise<T>):Promise<T>{for(let attempt=0;attempt<3;attempt+=1){try{return await work();}catch(error){const e=error as{code?:unknown;errno?:unknown};if(attempt===2||(e.code!=="ER_LOCK_DEADLOCK"&&e.errno!==1213))throw error;}}throw new Error("Data backup deadlock retry exhausted.");}
