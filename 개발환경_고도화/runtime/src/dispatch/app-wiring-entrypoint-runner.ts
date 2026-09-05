import type {
  AppWiringClaim,
  AppWiringClaimInput,
  AppWiringHandlerOutcome,
  AppWiringMutationHandlerOutcome,
  AppWiringMutationIrisOutcome,
  AppWiringMutationReplyOutcome,
  AppWiringMutationReplyContext,
  AppWiringMutationParticipant,
  AppWiringPersistedReply,
  AppWiringPersistedMutationIrisOutcome,
  AppWiringReadParticipant,
  AppWiringReadOnlyReplyOutcome,
  AppWiringReplayClaim,
  AppWiringRouteDecision,
  MariaAppWiringOperationProvider
} from "./app-wiring-operation-provider.js";

export type AppWiringEntrypointOutcome<T> = AppWiringHandlerOutcome<T>;

export interface AppWiringEntrypointHandlers<T> {
  readonly MODERN: {
    readonly READ_ONLY: (database: AppWiringReadParticipant, claim: AppWiringClaim) => Promise<AppWiringEntrypointOutcome<T>>;
    readonly MUTATION: (database: AppWiringMutationParticipant, claim: AppWiringClaim) => Promise<AppWiringMutationHandlerOutcome<T>>;
  };
  readonly LEGACY_FALLBACK: {
    readonly READ_ONLY: (database: AppWiringReadParticipant, claim: AppWiringClaim) => Promise<AppWiringEntrypointOutcome<T>>;
    readonly MUTATION: (database: AppWiringMutationParticipant, claim: AppWiringClaim) => Promise<AppWiringMutationHandlerOutcome<T>>;
  };
  readonly SHADOW: (database: AppWiringReadParticipant, claim: AppWiringClaim) => Promise<AppWiringEntrypointOutcome<T>>;
  readonly REJECT: (claim: AppWiringClaim) => Promise<AppWiringEntrypointOutcome<T>>;
}

export interface AppWiringEntrypointInput<T> {
  readonly claim: AppWiringClaimInput;
  readonly resolveRoute: () => AppWiringRouteDecision | Promise<AppWiringRouteDecision>;
  readonly handlers: AppWiringEntrypointHandlers<T>;
  readonly replayCompleted: (claim: AppWiringReplayClaim) => Promise<T>;
  readonly replayFailed: (claim: AppWiringReplayClaim) => Promise<T>;
  readonly errorCode: (error: unknown) => string;
}

export interface AppWiringReadOnlyReplyEntrypointInput<T> {
  readonly claim: AppWiringClaimInput;
  readonly resolveRoute: () => AppWiringRouteDecision | Promise<AppWiringRouteDecision>;
  readonly handler: (database: AppWiringReadParticipant, claim: AppWiringClaim) => Promise<AppWiringReadOnlyReplyOutcome<T>>;
  readonly replayCompleted: (claim: AppWiringReplayClaim) => Promise<T>;
  readonly replayFailed: (claim: AppWiringReplayClaim) => Promise<never>;
  readonly errorCode: (error: unknown) => string;
}

export interface AppWiringMutationReplyEntrypointInput<T> {
  readonly claim: AppWiringClaimInput;
  readonly resolveRoute: () => AppWiringRouteDecision | Promise<AppWiringRouteDecision>;
  readonly handler: (database: AppWiringMutationParticipant, claim: AppWiringClaim, context: AppWiringMutationReplyContext) => Promise<AppWiringMutationReplyOutcome<T>>;
  readonly replayCompleted: (claim: AppWiringReplayClaim) => Promise<T>;
  readonly replayFailed: (claim: AppWiringReplayClaim) => Promise<never>;
  readonly errorCode: (error: unknown) => string;
}

export interface AppWiringMutationIrisEntrypointInput<T> {
  readonly claim: AppWiringClaimInput;
  readonly resolveRoute: () => AppWiringRouteDecision | Promise<AppWiringRouteDecision>;
  readonly handler: (database: AppWiringMutationParticipant, claim: AppWiringClaim, context: AppWiringMutationReplyContext) => Promise<AppWiringMutationIrisOutcome<T>>;
  readonly replayCompleted: (claim: AppWiringReplayClaim) => Promise<T>;
  readonly replayFailed: (claim: AppWiringReplayClaim) => Promise<never>;
  readonly errorCode: (error: unknown) => string;
}

// READ_ONLY/REJECT도 저장된 reason/handler route audit를 재사용하지만 typed mutation receipt는 요구하지 않습니다.
// 저장된 route/effect만 실행하며 handler에는 해당 효과에 필요한 최소 DB capability만 제공합니다.
export async function executeAppWiringEntrypoint<T>(provider: MariaAppWiringOperationProvider, input: AppWiringEntrypointInput<T>): Promise<T> {
  const prepared = await provider.prepare(input.claim, input.resolveRoute);
  if (prepared.replayed) return prepared.claim.claimState === "COMPLETED" ? input.replayCompleted(prepared.claim) : input.replayFailed(prepared.claim);
  try {
    switch (prepared.claim.route) {
      case "REJECT": return await provider.runReject(prepared, input.handlers.REJECT);
      case "SHADOW": return await provider.runReadOnly(prepared, input.handlers.SHADOW);
      case "MODERN": return prepared.claim.effectMode === "MUTATION"
        ? await provider.runMutation(prepared, input.handlers.MODERN.MUTATION)
        : await provider.runReadOnly(prepared, input.handlers.MODERN.READ_ONLY);
      case "LEGACY_FALLBACK": return prepared.claim.effectMode === "MUTATION"
        ? await provider.runMutation(prepared, input.handlers.LEGACY_FALLBACK.MUTATION)
        : await provider.runReadOnly(prepared, input.handlers.LEGACY_FALLBACK.READ_ONLY);
    }
  } catch (error) {
    try { await provider.fail(prepared, input.errorCode(error)); }
    catch (transitionError) { throw new AggregateError([error, transitionError], "APP_WIRING_ENTRYPOINT_FAILURE_TRANSITION_FAILED"); }
    throw error;
  }
}

// IRIS MODERN 조회는 조회 결과와 전송 outbox, canonical claim 완료를 반드시 같은 트랜잭션으로 확정합니다.
export async function executeAppWiringReadOnlyReplyEntrypoint<T>(provider:MariaAppWiringOperationProvider,input:AppWiringReadOnlyReplyEntrypointInput<T>):Promise<AppWiringPersistedReply<T>>{
  const prepared=await provider.prepare(input.claim,input.resolveRoute);
  if(prepared.replayed){
    if(prepared.claim.claimState!=="COMPLETED")return input.replayFailed(prepared.claim);
    return {value:await input.replayCompleted(prepared.claim),reply:await provider.replayReadOnlyReply(prepared.claim)};
  }
  try{return await provider.runReadOnlyReply(prepared,input.handler);}
  catch(error){
    try{await provider.fail(prepared,input.errorCode(error));}
    catch(transitionError){throw new AggregateError([error,transitionError],"APP_WIRING_ENTRYPOINT_FAILURE_TRANSITION_FAILED");}
    throw error;
  }
}

// IRIS MODERN mutation은 도메인 typed receipt와 전송 outbox를 같은 claim transaction에서 확정합니다.
export async function executeAppWiringMutationReplyEntrypoint<T>(provider:MariaAppWiringOperationProvider,input:AppWiringMutationReplyEntrypointInput<T>):Promise<AppWiringPersistedReply<T>>{
  const prepared=await provider.prepare(input.claim,input.resolveRoute);
  if(prepared.replayed){
    if(prepared.claim.route!=="MODERN"||!("effectMode" in prepared.claim)||prepared.claim.effectMode!=="MUTATION")throw new Error("APP_WIRING_MUTATION_REPLY_ROUTE_INVALID");
    if(prepared.claim.claimState!=="COMPLETED")return input.replayFailed(prepared.claim);
    return {value:await input.replayCompleted(prepared.claim),reply:await provider.replayMutationReply(prepared.claim)};
  }
  try{
    if(prepared.claim.route!=="MODERN"||prepared.claim.effectMode!=="MUTATION")throw new Error("APP_WIRING_MUTATION_REPLY_ROUTE_INVALID");
    return await provider.runMutationReply(prepared,input.handler);
  }
  catch(error){
    try{await provider.fail(prepared,input.errorCode(error));}
    catch(transitionError){throw new AggregateError([error,transitionError],"APP_WIRING_ENTRYPOINT_FAILURE_TRANSITION_FAILED");}
    throw error;
  }
}

// 기존 reply 전용 API를 보존하면서 명시적 typed NO_REPLY 결과도 동일한 mutation 경계에서 재생합니다.
export async function executeAppWiringMutationIrisEntrypoint<T>(provider:MariaAppWiringOperationProvider,input:AppWiringMutationIrisEntrypointInput<T>):Promise<AppWiringPersistedMutationIrisOutcome<T>>{
  const prepared=await provider.prepare(input.claim,input.resolveRoute);
  if(prepared.replayed){
    if(prepared.claim.route!=="MODERN"||!("effectMode" in prepared.claim)||prepared.claim.effectMode!=="MUTATION")throw new Error("APP_WIRING_MUTATION_REPLY_ROUTE_INVALID");
    if(prepared.claim.claimState!=="COMPLETED")return input.replayFailed(prepared.claim);
    const value=await input.replayCompleted(prepared.claim);
    const delivery=await provider.replayMutationIrisOutcome(prepared.claim);
    return "reply" in delivery?{value,reply:delivery.reply}:{value,noReply:delivery.noReply};
  }
  try{
    if(prepared.claim.route!=="MODERN"||prepared.claim.effectMode!=="MUTATION")throw new Error("APP_WIRING_MUTATION_REPLY_ROUTE_INVALID");
    return await provider.runMutationIrisOutcome(prepared,input.handler);
  }
  catch(error){
    try{await provider.fail(prepared,input.errorCode(error));}
    catch(transitionError){throw new AggregateError([error,transitionError],"APP_WIRING_ENTRYPOINT_FAILURE_TRANSITION_FAILED");}
    throw error;
  }
}
