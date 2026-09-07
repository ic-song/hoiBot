import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ProcessIrisEventService, type ChannelNameObservation, type EventProcessingResult } from "../integration/event-processing-service.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { isMariaTransactionRetryExhaustion } from "../shared/maria-database-error-policy.js";
import type { AppWiringAtomicReadOnlyEvaluation, AppWiringClaimInput, AppWiringReadOnlyTerminalStatus, AppWiringReadParticipant, AppWiringRouteDecision, MariaAppWiringOperationProvider } from "./app-wiring-operation-provider.js";

export type AppWiringDevContext = "DEFAULT" | "DEV_PREFIX";
export type AppWiringReadOnlyRecoveryResult<T> =
  | { readonly status:"completed";readonly replayed:false;readonly resultFingerprint:string;readonly terminalStatus:AppWiringReadOnlyTerminalStatus;readonly receiptProjection:unknown;readonly value:T;readonly processing:EventProcessingResult }
  | { readonly status:"completed";readonly replayed:true;readonly resultFingerprint:string;readonly terminalStatus:AppWiringReadOnlyTerminalStatus;readonly receiptProjection:unknown;readonly processing:EventProcessingResult };

export interface AppWiringReadOnlyRecoveryInput<T>{
  readonly event:NormalizedIrisEvent;
  readonly replyIdentity:NormalizedIrisEvent;
  readonly channelType:"open_group"|"open_direct";
  readonly identityProviderCode:"kakao";
  readonly devContext:AppWiringDevContext;
  readonly actor:string;
  readonly decision:AppWiringRouteDecision;
  readonly channelName?:ChannelNameObservation;
  readonly commandBinding?:unknown;
  readonly evaluateInSnapshot:(database:AppWiringReadParticipant)=>Promise<AppWiringAtomicReadOnlyEvaluation<T>>;
  readonly validateReceiptProjection?:(projection:unknown)=>void;
  readonly errorCode:(error:unknown)=>string;
}

function externalRequestId(value:string):string{
  return /^[A-Za-z0-9._:@/-]{1,172}$/.test(value)?value:`sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;
}

function claimInput<T>(input:AppWiringReadOnlyRecoveryInput<T>):AppWiringClaimInput{
  return{entrypointKind:"IRIS",externalRequestId:externalRequestId(input.event.eventId),actor:input.actor,normalizedPayload:{
    version:"APP_WIRING_READ_ONLY_RECOVERY_V1",devContext:input.devContext,channelType:input.channelType,
    channelName:input.channelName??null,identityProviderCode:input.identityProviderCode,
    ...(input.commandBinding===undefined?{}:{commandBinding:input.commandBinding}),
    event:{eventId:input.event.eventId,providerCode:input.event.providerCode,providerEventId:input.event.providerEventId??null,
      payloadHash:input.event.payloadHash,message:input.event.message??null,direction:input.event.direction,channelId:input.event.channelId??null,
      eventKind:input.event.eventKind,origin:input.event.origin??null,eventCode:input.event.eventCode,eventCategory:input.event.eventCategory,
      monitoringGroup:input.event.monitoringGroup,targetProviderEventId:input.event.targetProviderEventId??null,eventMetadata:input.event.eventMetadata},
    actor:{eventId:input.replyIdentity.eventId,providerCode:input.replyIdentity.providerCode,providerEventId:input.replyIdentity.providerEventId,
      payloadHash:input.replyIdentity.payloadHash,direction:input.replyIdentity.direction,channelId:input.replyIdentity.channelId??null,
      userId:input.replyIdentity.userId??null,displayName:input.replyIdentity.displayName??null,
      displayNameSource:input.replyIdentity.displayNameSource??null,displayNameTrust:input.replyIdentity.displayNameTrust??null}
  }};
}

async function assertInboxBinding(transaction:DatabaseTransaction,input:AppWiringReadOnlyRecoveryInput<unknown>,allowFailed=false):Promise<{channelId:bigint|null;externalIdentityId:bigint|null;errorCode:string|null}>{
  const rows=await transaction.query<Array<{provider_code:string;provider_event_id:string|null;external_channel_id:string|null;external_user_id:string|null;payload_hash:string;event_kind:string;event_origin:string|null;direction:string;processing_status:string;channel_id:bigint|null;external_identity_id:bigint|null;error_code:string|null}>>(
    "SELECT provider_code,provider_event_id,external_channel_id,external_user_id,payload_hash,event_kind,event_origin,direction,processing_status,channel_id,external_identity_id,error_code FROM event_inbox WHERE event_id=? FOR UPDATE",[input.event.eventId]);
  if(rows.length!==1)throw new Error("APP_WIRING_READ_ONLY_EVENT_INBOX_REQUIRED");
  const row=rows[0]!;
  if(row.provider_code!==input.event.providerCode||row.provider_event_id!==(input.event.providerEventId??null)
    ||row.external_channel_id!==(input.event.channelId??null)||row.external_user_id!==(input.replyIdentity.userId??null)
    ||row.payload_hash!==input.event.payloadHash||row.event_kind!==input.event.eventKind||row.event_origin!==(input.event.origin??null)
    ||row.direction!==input.event.direction||(row.processing_status!=="processed"&&!(allowFailed&&row.processing_status==="failed"))
    ||(input.event.channelId!==undefined&&row.channel_id===null)||(input.replyIdentity.userId!==undefined&&row.external_identity_id===null))throw new Error("APP_WIRING_READ_ONLY_EVENT_INBOX_DRIFT");
  return{channelId:row.channel_id,externalIdentityId:row.external_identity_id,errorCode:row.error_code};
}

async function assertIdentityUnique(transaction:DatabaseTransaction,input:AppWiringReadOnlyRecoveryInput<unknown>,binding:{channelId:bigint|null;externalIdentityId:bigint|null}):Promise<void>{
  if(input.replyIdentity.userId===undefined)return;
  const identities=await transaction.query<Array<{id:bigint}>>(
    "SELECT id FROM external_identities WHERE provider_code=? AND external_user_id=? ORDER BY id LIMIT 2 FOR UPDATE",[input.identityProviderCode,input.replyIdentity.userId]);
  if(identities.length>1)throw new Error("APP_WIRING_READ_ONLY_IDENTITY_DUPLICATE");
  if(identities.length!==1||binding.externalIdentityId!==identities[0]!.id)throw new Error("APP_WIRING_READ_ONLY_IDENTITY_BINDING_DRIFT");
  if(input.event.channelId!==undefined){
    const channels=await transaction.query<Array<{id:bigint}>>("SELECT id FROM channels WHERE provider_code=? AND external_channel_id=? ORDER BY id LIMIT 2 FOR UPDATE",[input.identityProviderCode,input.event.channelId]);
    if(channels.length!==1||binding.channelId!==channels[0]!.id)throw new Error("APP_WIRING_READ_ONLY_CHANNEL_BINDING_DRIFT");
  }
}

function safeErrorCode(input:AppWiringReadOnlyRecoveryInput<unknown>,error:unknown):string{
  if(isMariaTransactionRetryExhaustion(error,"APP_WIRING_READ_ONLY_RETRY_EXHAUSTED"))return"APP_WIRING_READ_ONLY_RETRY_EXHAUSTED";
  const code=input.errorCode(error);
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code)?code:"APP_WIRING_READ_ONLY_EVALUATION_FAILED";
}

class StoredAtomicFailure extends Error{constructor(readonly errorCode:string){super(`APP_WIRING_READ_ONLY_PREVIOUSLY_FAILED:${errorCode}`);}}

// event inbox와 SHADOW callback result hash를 한 root transaction으로 복구 가능하게 확정합니다.
export class MariaAppWiringReadOnlyRecoveryProvider{
  constructor(private readonly database:DatabaseClient,private readonly appWiring:MariaAppWiringOperationProvider){appWiring.assertRecoveryDatabase(database);}

  async execute<T>(input:AppWiringReadOnlyRecoveryInput<T>):Promise<AppWiringReadOnlyRecoveryResult<T>>{
    if(input.decision.route!=="SHADOW"||input.decision.effectMode!=="READ_ONLY")throw new Error("APP_WIRING_READ_ONLY_SHADOW_ROUTE_REQUIRED");
    const claim=claimInput(input);
    let lastAttemptNumber=0;
    try{
      return await this.appWiring.withAtomicReadOnlyRootRetry(async(transaction,attemptNumber)=>{
        lastAttemptNumber=attemptNumber;
        const processing=await new ProcessIrisEventService(this.database).executeAtomicCommandInTransaction(transaction,input.event,input.replyIdentity,input.channelType,{...(input.channelName===undefined?{}:{channelName:input.channelName}),retryFailedErrorCode:"APP_WIRING_READ_ONLY_RETRY_EXHAUSTED",retryAttemptNumber:attemptNumber});
        const binding=await assertInboxBinding(transaction,input,processing.duplicate);
        await assertIdentityUnique(transaction,input,binding);
        const result=await this.appWiring.executeAtomicReadOnlyShadowInTransaction(transaction,{claim,decision:input.decision,sourceEventId:input.event.eventId,attemptCount:attemptNumber,duplicateClaim:processing.duplicate,evaluate:database=>input.evaluateInSnapshot(database),...(input.validateReceiptProjection===undefined?{}:{validateReceiptProjection:input.validateReceiptProjection})});
        if(result.status==="failed"){
          if(binding.errorCode!==result.errorCode)throw new Error("APP_WIRING_READ_ONLY_FAILED_INBOX_ERROR_DRIFT");
          throw new StoredAtomicFailure(result.errorCode);
        }
        return result.replayed?{status:"completed",replayed:true,resultFingerprint:result.resultFingerprint,terminalStatus:result.terminalStatus,receiptProjection:result.receiptProjection,processing}
          :{status:"completed",replayed:false,resultFingerprint:result.resultFingerprint,terminalStatus:result.terminalStatus,receiptProjection:result.receiptProjection,value:result.value,processing};
      });
    }catch(error){
      if(error instanceof StoredAtomicFailure)throw error;
      const errorCode=safeErrorCode(input,error);
      const failureAttemptCount=errorCode==="APP_WIRING_READ_ONLY_RETRY_EXHAUSTED"?3:Math.max(1,lastAttemptNumber);
      const reconciled=await this.appWiring.withAtomicReadOnlyFailureRetry(async transaction=>{
        const processing=await new ProcessIrisEventService(this.database).executeAtomicCommandInTransaction(transaction,input.event,input.replyIdentity,input.channelType,{...(input.channelName===undefined?{}:{channelName:input.channelName}),retryFailedErrorCode:"APP_WIRING_READ_ONLY_RETRY_EXHAUSTED",retryAttemptNumber:failureAttemptCount});
        await assertInboxBinding(transaction,input,processing.duplicate);
        const result=await this.appWiring.recordAtomicReadOnlyShadowFailureInTransaction(transaction,{claim,decision:input.decision,sourceEventId:input.event.eventId,attemptCount:failureAttemptCount,errorCode,...(input.validateReceiptProjection===undefined?{}:{validateReceiptProjection:input.validateReceiptProjection})});
        if(result.status==="completed")return{status:"completed" as const,replayed:true as const,resultFingerprint:result.resultFingerprint,terminalStatus:result.terminalStatus,receiptProjection:result.receiptProjection,processing};
        await transaction.execute("UPDATE event_inbox SET processing_status='failed',attempt_count=GREATEST(attempt_count,?),error_code=?,processed_at=UTC_TIMESTAMP(3) WHERE event_id=?",[failureAttemptCount,errorCode,input.event.eventId]);
        return undefined;
      });
      if(reconciled!==undefined)return reconciled;
      throw error;
    }
  }
}
