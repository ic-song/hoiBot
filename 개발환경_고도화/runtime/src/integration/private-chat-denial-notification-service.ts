import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createObjectAuditValues, createObjectIdentityCandidate } from "../identity/object-identity-audit-provider.js";
import { parsePetSkillInfoPrivateDenialReceiptV2, parsePetSkillInfoPrivateDenialReceiptV3, type PetSkillInfoPrivateDenialReceiptV2, type PetSkillInfoPrivateDenialReceiptV3 } from "../pet/pet-skill-info-read-only-recovery-ingress.js";
import { assertVerifiedEnvironmentContext, type VerifiedEnvironmentContext } from "../runtime/environment-context.js";
import { insertWithCuid8CollisionRetry, withMariaTransactionRetry } from "../shared/maria-database-error-policy.js";

const COMMAND_CODE="PRIVATE_CHAT_DENIAL_NOTICE";
const OPERATION_SCOPE="private-chat-denial.notice";
const ACTOR="service:private-chat-denial-notice";
const V2="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V2";
const V3="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3";
type NotifiableReceipt=PetSkillInfoPrivateDenialReceiptV2|PetSkillInfoPrivateDenialReceiptV3;

type RootRow={
  app_wiring_operation_id:string;claim_state:string;effect_mode:string|null;route:string;environment_code:string;database_identity:string;
  claim_result_json:string|Record<string,unknown>;receipt_operation_id:bigint;operation_status:string;operation_result_json:string|Record<string,unknown>;
  execution_status:string;execution_result_code:string|null;external_identity_id:bigint|null;provider_code:string;external_user_id:string;
  root_outbox_count:bigint|string;
};
type AttemptRow={private_chat_denial_attempt_id:string;private_chat_denial_counter_id:string;environment_code:string;database_identity:string;event_id:string;app_wiring_operation_id:string;command_code:string;attempt_ordinal:bigint|string;denial_reason:string;display_name_snapshot:string;private_room_name_snapshot:string;message_preview_snapshot:string;notification_disposition:string;notification_destination_fingerprint:string|null;result_fingerprint:string};
type CounterRow={private_chat_denial_counter_id:string;attempt_count:bigint|string};
type ConfigRow={private_chat_denial_notification_channel_id:string;provider_code:string;external_channel_id:string;delivery_enabled:number|boolean;configuration_fingerprint:string};
type ReplayInfrastructureRow={notice_operation_id:bigint;operation_status:string;operation_result_json:string|Record<string,unknown>;execution_status:string|null;execution_result_code:string|null;audit_count:bigint|string;outbox_id:bigint|null;outbox_provider_code:string|null;destination_id:string|null;message_type:string|null;payload_json:string|Record<string,unknown>|null};

export interface PrivateChatDenialNotificationResult{
  readonly status:"ignored_v1"|"counted";
  readonly replayed:boolean;
  readonly attemptOrdinal?:string;
  readonly notificationDisposition?:"NOT_DUE"|"QUEUED"|"DISABLED";
}

function parseJson(value:string|Record<string,unknown>):Record<string,unknown>{
  const parsed=typeof value==="string"?JSON.parse(value) as unknown:value;
  if(typeof parsed!=="object"||parsed===null||Array.isArray(parsed))throw new Error("PRIVATE_CHAT_DENIAL_ROOT_RECEIPT_INVALID");
  return parsed as Record<string,unknown>;
}
function stableJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(stableJson).join(",")}]`;
  const record=value as Record<string,unknown>;
  return`{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
function sha(value:string):string{return createHash("sha256").update(value).digest("hex");}
function denialReason(receipt:NotifiableReceipt):"PRIVATE_HOI_PASS_REQUIRED"|"PRIVATE_CHAT_BLOCKED"{
  return receipt.authorization.reasonCode==="PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"?"PRIVATE_HOI_PASS_REQUIRED":"PRIVATE_CHAT_BLOCKED";
}
function disposition(ordinal:bigint,enabled:boolean):"NOT_DUE"|"QUEUED"|"DISABLED"{
  return ordinal%3n!==0n?"NOT_DUE":enabled?"QUEUED":"DISABLED";
}
function resultFingerprint(input:{environmentCode:string;databaseIdentity:string;appWiringOperationId:string;counterId:string;eventId:string;ordinal:string;reason:string;disposition:string;configurationFingerprint:string|null}):string{return sha(stableJson(input));}
function formatNotice(receipt:NotifiableReceipt,ordinal:bigint):string{
  return`[패스 미사용 1:1톡 감지]\n유저: ${receipt.notification.displayName}\n개인톡방: ${receipt.notification.privateRoomName}\n누적 횟수: ${ordinal.toString()}회\n최근 메시지: ${receipt.notification.messagePreview}`;
}

async function readRoot(tx:DatabaseTransaction,eventId:string):Promise<{row:RootRow;receipt:NotifiableReceipt}|undefined>{
  const rows=await tx.query<RootRow[]>(`SELECT claim.app_wiring_operation_id,claim.claim_state,claim.effect_mode,claim.route,claim.environment_code,claim.database_identity,claim.result_json claim_result_json,
    operation.id receipt_operation_id,operation.status operation_status,operation.result_json operation_result_json,
    execution.execution_status,execution.result_code execution_result_code,inbox.external_identity_id,inbox.provider_code,inbox.external_user_id,
    (SELECT COUNT(*) FROM outbox_messages root_outbox WHERE root_outbox.operation_id=operation.id) root_outbox_count
    FROM command_executions execution
    JOIN operations operation ON operation.id=execution.operation_id AND operation.idempotency_scope='app-wiring.read-only-no-reply'
    JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=operation.idempotency_key
    JOIN event_inbox inbox ON inbox.event_id=execution.event_id
    WHERE execution.event_id=? AND execution.command_code='PET_SKILL_INFO' ORDER BY execution.id LIMIT 2 FOR UPDATE`,[eventId]);
  if(rows.length!==1)throw new Error("PRIVATE_CHAT_DENIAL_ROOT_RECEIPT_CARDINALITY_INVALID");
  const row=rows[0]!;
  const operation=parseJson(row.operation_result_json),claim=parseJson(row.claim_result_json);
  const projection=operation.receiptProjection;
  const version=(projection as {version?:unknown}|undefined)?.version;
  if(version!==V2&&version!==V3)return undefined;
  const receipt=version===V3?parsePetSkillInfoPrivateDenialReceiptV3(projection):parsePetSkillInfoPrivateDenialReceiptV2(projection);
  const projectedFingerprint=sha(stableJson(projection));
  const expectedTerminal=row.route==="SHADOW"?"SHADOW_DENIED":row.route==="MODERN"?"MODERN_DENIED":undefined;
  if(row.claim_state!=="COMPLETED"||row.effect_mode!=="READ_ONLY"||expectedTerminal===undefined||row.operation_status!=="completed"||row.execution_status!=="completed"||row.execution_result_code!=="ignored"
    ||claim.status!==expectedTerminal||claim.referenceId!==row.receipt_operation_id.toString()||claim.resultFingerprint!==projectedFingerprint
    ||operation.status!==expectedTerminal||operation.route!==row.route||operation.delivery!=="NO_REPLY"||operation.resultFingerprint!==projectedFingerprint||row.root_outbox_count===undefined||BigInt(row.root_outbox_count)!==0n
    ||operation.appWiringOperationId!==row.app_wiring_operation_id||operation.eventId!==eventId||operation.commandCode!=="PET_SKILL_INFO"
    ||receipt.binding.eventId!==eventId||receipt.binding.eventProviderCode!==row.provider_code||receipt.notification.externalIdentityId!==String(row.external_identity_id)
    ||receipt.notification.externalUserId!==row.external_user_id)throw new Error("PRIVATE_CHAT_DENIAL_ROOT_RECEIPT_DRIFT");
  return{row,receipt};
}

async function readAttempt(tx:DatabaseTransaction,eventId:string):Promise<AttemptRow|undefined>{
  const rows=await tx.query<AttemptRow[]>("SELECT private_chat_denial_attempt_id,private_chat_denial_counter_id,environment_code,database_identity,event_id,app_wiring_operation_id,command_code,attempt_ordinal,denial_reason,display_name_snapshot,private_room_name_snapshot,message_preview_snapshot,notification_disposition,notification_destination_fingerprint,result_fingerprint FROM private_chat_denial_attempts WHERE event_id=? FOR UPDATE",[eventId]);
  if(rows.length>1)throw new Error("PRIVATE_CHAT_DENIAL_ATTEMPT_CARDINALITY_INVALID");
  return rows[0];
}

async function assertReplayInfrastructure(tx:DatabaseTransaction,attempt:AttemptRow,receipt:NotifiableReceipt):Promise<void>{
  const rows=await tx.query<ReplayInfrastructureRow[]>(`SELECT operation.id notice_operation_id,operation.status operation_status,operation.result_json operation_result_json,
    execution.execution_status,execution.result_code execution_result_code,
    (SELECT COUNT(*) FROM command_audit audit WHERE audit.operation_id=operation.id AND audit.action_code='private_chat.denial.notice') audit_count,
    outbox.id outbox_id,outbox.provider_code outbox_provider_code,outbox.destination_id,outbox.message_type,outbox.payload_json
    FROM operations operation
    LEFT JOIN command_executions execution ON execution.operation_id=operation.id AND execution.event_id=? AND execution.command_code=?
    LEFT JOIN outbox_messages outbox ON outbox.operation_id=operation.id
    WHERE operation.idempotency_scope=? AND operation.idempotency_key=? ORDER BY outbox.id LIMIT 2 FOR UPDATE`,[attempt.event_id,COMMAND_CODE,OPERATION_SCOPE,attempt.app_wiring_operation_id]);
  if(rows.length!==1)throw new Error("PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_CARDINALITY_INVALID");
  const row=rows[0]!,operationResult=parseJson(row.operation_result_json),ordinal=BigInt(attempt.attempt_ordinal),expectedDisposition=disposition(ordinal,receipt.notification.deliveryEnabled),queued=expectedDisposition==="QUEUED";
  if(attempt.notification_disposition!==expectedDisposition||row.operation_status!=="completed"||row.execution_status!=="completed"||row.execution_result_code!==expectedDisposition.toLowerCase()||BigInt(row.audit_count)!==1n
    ||operationResult.attemptId!==attempt.private_chat_denial_attempt_id||operationResult.counterId!==attempt.private_chat_denial_counter_id||operationResult.attemptOrdinal!==ordinal.toString()
    ||operationResult.notificationDisposition!==expectedDisposition||operationResult.outboxId!==(row.outbox_id===null?null:row.outbox_id.toString())||operationResult.resultFingerprint!==attempt.result_fingerprint)throw new Error("PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_DRIFT");
  if(!queued){if(row.outbox_id!==null)throw new Error("PRIVATE_CHAT_DENIAL_REPLAY_OUTBOX_DRIFT");return;}
  const payload=row.payload_json===null?undefined:parseJson(row.payload_json);
  if(row.outbox_id===null||row.outbox_provider_code!=="iris"||row.destination_id!==receipt.notification.destinationChannelId||row.message_type!=="text"||payload?.data!==formatNotice(receipt,ordinal))throw new Error("PRIVATE_CHAT_DENIAL_REPLAY_OUTBOX_DRIFT");
}

export class PrivateChatDenialNotificationService{
  constructor(private readonly database:DatabaseClient,private readonly environment:VerifiedEnvironmentContext,private readonly generate:()=>string=createObjectIdentityCandidate,private readonly now:()=>Date=()=>new Date()){
    assertVerifiedEnvironmentContext(environment);
  }
  async processEvent(eventId:string):Promise<PrivateChatDenialNotificationResult>{
    if(eventId.length===0||eventId.length>128)throw new Error("PRIVATE_CHAT_DENIAL_EVENT_ID_INVALID");
    return withMariaTransactionRetry(this.database,{maxAttempts:3,allowRetry:kind=>kind==="TRANSACTION_DEADLOCK"||kind==="TRANSACTION_LOCK_WAIT_TIMEOUT",exhaustedErrorCode:"PRIVATE_CHAT_DENIAL_TRANSACTION_RETRY_EXHAUSTED"},tx=>this.processInTransaction(tx,eventId));
  }
  private async processInTransaction(tx:DatabaseTransaction,eventId:string):Promise<PrivateChatDenialNotificationResult>{
    const root=await readRoot(tx,eventId);
    if(root===undefined)return{status:"ignored_v1",replayed:true};
    const {row,receipt}=root;
    if(row.environment_code!==this.environment.environmentCode||row.database_identity!==this.environment.databaseIdentity
      ||receipt.notification.environmentCode!==this.environment.environmentCode||receipt.notification.databaseIdentity!==this.environment.databaseIdentity)throw new Error("PRIVATE_CHAT_DENIAL_ENVIRONMENT_DRIFT");
    const existing=await readAttempt(tx,eventId);
    const identities=await tx.query<Array<{id:bigint}>>("SELECT id FROM external_identities WHERE provider_code=? AND external_user_id=? FOR UPDATE",[receipt.notification.providerCode,receipt.notification.externalUserId]);
    if(identities.length!==1||String(identities[0]!.id)!==receipt.notification.externalIdentityId)throw new Error("PRIVATE_CHAT_DENIAL_IDENTITY_DRIFT");
    if(existing!==undefined){
      if(existing.notification_disposition!=="NOT_DUE"&&existing.notification_disposition!=="QUEUED"&&existing.notification_disposition!=="DISABLED")throw new Error("PRIVATE_CHAT_DENIAL_ATTEMPT_REPLAY_DRIFT");
      const expectedReason=denialReason(receipt),expectedDestination=existing.notification_disposition==="QUEUED"?receipt.notification.configurationFingerprint:null;
      const expectedFingerprint=resultFingerprint({environmentCode:this.environment.environmentCode,databaseIdentity:this.environment.databaseIdentity,appWiringOperationId:row.app_wiring_operation_id,counterId:existing.private_chat_denial_counter_id,eventId,ordinal:String(existing.attempt_ordinal),reason:expectedReason,disposition:existing.notification_disposition,configurationFingerprint:expectedDestination});
      if(existing.environment_code!==this.environment.environmentCode||existing.database_identity!==this.environment.databaseIdentity||existing.app_wiring_operation_id!==row.app_wiring_operation_id||existing.command_code!=="PET_SKILL_INFO"||existing.denial_reason!==expectedReason
        ||existing.display_name_snapshot!==receipt.notification.displayName||existing.private_room_name_snapshot!==receipt.notification.privateRoomName||existing.message_preview_snapshot!==receipt.notification.messagePreview
        ||existing.notification_destination_fingerprint!==expectedDestination||existing.result_fingerprint!==expectedFingerprint)throw new Error("PRIVATE_CHAT_DENIAL_ATTEMPT_REPLAY_DRIFT");
      await assertReplayInfrastructure(tx,existing,receipt);
      return{status:"counted",replayed:true,attemptOrdinal:String(existing.attempt_ordinal),notificationDisposition:existing.notification_disposition};
    }
    const configs=await tx.query<ConfigRow[]>("SELECT private_chat_denial_notification_channel_id,provider_code,external_channel_id,delivery_enabled,configuration_fingerprint FROM private_chat_denial_notification_channels WHERE environment_code=? AND database_identity=? FOR UPDATE",[this.environment.environmentCode,this.environment.databaseIdentity]);
    if(configs.length!==1)throw new Error("PRIVATE_CHAT_DENIAL_NOTIFICATION_CONFIG_REQUIRED");
    const config=configs[0]!;
    if(config.provider_code!==receipt.notification.providerCode||config.external_channel_id!==receipt.notification.destinationChannelId||Boolean(config.delivery_enabled)!==receipt.notification.deliveryEnabled||config.configuration_fingerprint!==receipt.notification.configurationFingerprint)throw new Error("PRIVATE_CHAT_DENIAL_NOTIFICATION_CONFIG_DRIFT");
    let counter=(await tx.query<CounterRow[]>("SELECT private_chat_denial_counter_id,attempt_count FROM private_chat_denial_counters WHERE environment_code=? AND database_identity=? AND provider_code=? AND external_user_id=? FOR UPDATE",[this.environment.environmentCode,this.environment.databaseIdentity,receipt.notification.providerCode,receipt.notification.externalUserId]))[0];
    const audit=createObjectAuditValues(ACTOR,this.now());
    if(counter===undefined){
      const counterId=await insertWithCuid8CollisionRetry(candidate=>tx.execute("INSERT INTO private_chat_denial_counters(private_chat_denial_counter_id,environment_code,database_identity,provider_code,external_user_id,attempt_count,last_event_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,1,?,?,?,?,?)",[candidate,this.environment.environmentCode,this.environment.databaseIdentity,receipt.notification.providerCode,receipt.notification.externalUserId,eventId,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]).then(()=>undefined),{generate:this.generate,exhaustedErrorCode:"PRIVATE_CHAT_DENIAL_COUNTER_ID_COLLISION_EXHAUSTED"});
      counter={private_chat_denial_counter_id:counterId,attempt_count:1n};
    }else{
      const next=BigInt(counter.attempt_count)+1n;
      const updated=await tx.execute("UPDATE private_chat_denial_counters SET attempt_count=?,last_event_id=?,UPDATE_USER=?,UPDATE_TIME=? WHERE private_chat_denial_counter_id=? AND environment_code=? AND database_identity=? AND attempt_count=?",[next,eventId,audit.UPDATE_USER,audit.UPDATE_TIME,counter.private_chat_denial_counter_id,this.environment.environmentCode,this.environment.databaseIdentity,counter.attempt_count]);
      if(updated.affectedRows!==1n)throw new Error("PRIVATE_CHAT_DENIAL_COUNTER_UPDATE_CONFLICT");
      counter={...counter,attempt_count:next};
    }
    const ordinal=BigInt(counter.attempt_count),noticeDisposition=disposition(ordinal,Boolean(config.delivery_enabled));
    const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),OPERATION_SCOPE,row.app_wiring_operation_id,identities[0]!.id]);
    let outboxId:string|undefined;
    if(noticeDisposition==="QUEUED"){
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,config.external_channel_id,JSON.stringify({data:formatNotice(receipt,ordinal)})]);
      outboxId=outbox.insertId.toString();
    }
    const reason=denialReason(receipt),destinationFingerprint=noticeDisposition==="QUEUED"?config.configuration_fingerprint:null;
    const fingerprint=resultFingerprint({environmentCode:this.environment.environmentCode,databaseIdentity:this.environment.databaseIdentity,appWiringOperationId:row.app_wiring_operation_id,counterId:counter.private_chat_denial_counter_id,eventId,ordinal:ordinal.toString(),reason,disposition:noticeDisposition,configurationFingerprint:destinationFingerprint});
    const attemptId=await insertWithCuid8CollisionRetry(candidate=>tx.execute("INSERT INTO private_chat_denial_attempts(private_chat_denial_attempt_id,private_chat_denial_counter_id,environment_code,database_identity,event_id,app_wiring_operation_id,command_code,attempt_ordinal,denial_reason,display_name_snapshot,private_room_name_snapshot,message_preview_snapshot,notification_disposition,notification_destination_fingerprint,result_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[candidate,counter.private_chat_denial_counter_id,this.environment.environmentCode,this.environment.databaseIdentity,eventId,row.app_wiring_operation_id,"PET_SKILL_INFO",ordinal,reason,receipt.notification.displayName,receipt.notification.privateRoomName,receipt.notification.messagePreview,noticeDisposition,destinationFingerprint,fingerprint,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]).then(()=>undefined),{generate:this.generate,exhaustedErrorCode:"PRIVATE_CHAT_DENIAL_ATTEMPT_ID_COLLISION_EXHAUSTED"});
    await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[eventId,COMMAND_CODE,operation.insertId,noticeDisposition.toLowerCase()]);
    await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'private_chat_denial_attempt',NULL,'private_chat.denial.notice',?,'Iris 개인톡 차단 누적',?,UTC_TIMESTAMP(3))",[operation.insertId,identities[0]!.id,noticeDisposition.toLowerCase(),JSON.stringify({attemptId,counterId:counter.private_chat_denial_counter_id,attemptOrdinal:ordinal.toString(),denialReason:reason,notificationDisposition:noticeDisposition,outboxId:outboxId??null,resultFingerprint:fingerprint})]);
    const completed=await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'",[JSON.stringify({attemptId,counterId:counter.private_chat_denial_counter_id,attemptOrdinal:ordinal.toString(),notificationDisposition:noticeDisposition,outboxId:outboxId??null,resultFingerprint:fingerprint}),operation.insertId]);
    if(completed.affectedRows!==1n)throw new Error("PRIVATE_CHAT_DENIAL_OPERATION_COMPLETE_CONFLICT");
    return{status:"counted",replayed:false,attemptOrdinal:ordinal.toString(),notificationDisposition:noticeDisposition};
  }
  async reconcilePending(limit=100):Promise<number>{
    if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error("PRIVATE_CHAT_DENIAL_RECONCILE_LIMIT_INVALID");
    const rows=await this.database.query<Array<{event_id:string}>>(`SELECT execution.event_id FROM command_executions execution
      JOIN operations operation ON operation.id=execution.operation_id AND operation.idempotency_scope='app-wiring.read-only-no-reply'
      JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=operation.idempotency_key
      LEFT JOIN private_chat_denial_attempts attempt ON attempt.event_id=execution.event_id
      WHERE execution.command_code='PET_SKILL_INFO' AND execution.execution_status='completed' AND execution.result_code='ignored'
        AND claim.claim_state='COMPLETED' AND claim.environment_code=? AND claim.database_identity=? AND JSON_UNQUOTE(JSON_EXTRACT(operation.result_json,'$.receiptProjection.version')) IN (?,?)
        AND attempt.private_chat_denial_attempt_id IS NULL ORDER BY execution.id LIMIT ?`,[this.environment.environmentCode,this.environment.databaseIdentity,V2,V3,limit]);
    for(const row of rows)await this.processEvent(row.event_id);
    return rows.length;
  }
}
