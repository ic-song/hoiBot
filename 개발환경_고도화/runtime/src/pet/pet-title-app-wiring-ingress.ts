import { createHash } from "node:crypto";

import type { PlayerContext, PlayerContextPort } from "../account-platform/player-context-provider.js";
import type { CommandDispatcher, CommandDispatchDecision } from "../dispatch/command-dispatcher.js";
import { executeAppWiringEntrypoint, executeAppWiringMutationIrisEntrypoint, executeAppWiringMutationReplyEntrypoint, executeAppWiringReadOnlyReplyEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";
import type { AppWiringMutationParticipant, AppWiringReadParticipant, MariaAppWiringOperationProvider } from "../dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { resolveGuildTerritoryWarAuthority } from "../guild/guild-territory-war-authority.js";
import { ApplicationError } from "../shared/application-error.js";
import { PetTitleCanonicalReadProvider } from "./pet-title-canonical-read-provider.js";
import { PetTitleCanonicalMutationProvider } from "./pet-title-canonical-mutation-provider.js";
import { formatPetTitleList, normalizePetTitleDispatchMessage, parsePetTitleCommand,parsePetTitleSaleCommand } from "./pet-title-lifecycle-service.js";

export interface PetTitleReadAuthorityPort {
  canReadAny(database: AppWiringReadParticipant, actor: PlayerContext): Promise<boolean>;
}

// Gate 3 shadow 비교용 현재 runtime 역할 projection입니다. 레거시 room/principal parity가 확정되기 전 target MODERN에는 사용하지 않습니다.
export class PetTitleShadowReadAuthorityProvider implements PetTitleReadAuthorityPort {
  async canReadAny(database:AppWiringReadParticipant,actor:PlayerContext):Promise<boolean>{
    const rows=await database.query<Array<{authorized_flag:number|bigint|string}>>(
      `SELECT EXISTS(
         SELECT 1 FROM admin_operator_external_identities mapping
         JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
        WHERE mapping.external_identity_id=? AND role.code IN ('super_admin','manager')
       ) AS authorized_flag`,
      [actor.externalIdentityId],
    );
    return BigInt(rows[0]?.authorized_flag??0)===1n;
  }
}

export interface PetTitleShadowPreview {
  readonly authorized: boolean;
  readonly outcomeCode?: "READY" | "INDEX_INVALID" | "NOT_FOUND" | "SILENT_CASTLE_ACTIVE";
  readonly resultFingerprint: string;
  readonly canonicalPlayerId?: string;
  readonly reply?: string;
}

export type PetTitleAppWiringIngressResult =
  | { readonly status: "ignored" | "legacy_fallback" }
  | { readonly status: "handled_no_reply"; readonly replayed: boolean; readonly resultFingerprint: string }
  | { readonly status: "modern"; readonly replayed: boolean; readonly resultFingerprint: string; readonly reply: { readonly outboxId: string; readonly room: string; readonly data: string } }
  | { readonly status: "shadow"; readonly replayed: boolean; readonly resultFingerprint: string }
  | { readonly status: "rejected"; readonly replayed: boolean; readonly reasonCode: string; readonly resultFingerprint?: string };

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function externalRequestId(value: string): string {
  return /^[A-Za-z0-9._:@/-]{1,172}$/.test(value) ? value : `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

// 레거시 판매 응답과 같은 세 자리 구분 포인트 문자열을 반환합니다.
function formatPoint(value:bigint):string{return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");}

function forbiddenMutation(): Promise<never> {
  return Promise.reject(new Error("PET_TITLE_APP_WIRING_MUTATION_NOT_ADOPTED"));
}

// 호출 방의 활성 게임계정 선택 한 건을 잠가 명령 도중 계정 전환을 차단합니다.
async function lockActivePlayerSelection(database:AppWiringMutationParticipant,event:NormalizedIrisEvent):Promise<void>{
  const rows=await database.query<Array<{active_player_selection_id:string}>>(
    `SELECT selection.active_player_selection_id
       FROM account_platform_identities platform_identity
       JOIN account_platform_context_memberships membership
         ON membership.platform_identity_id=platform_identity.platform_identity_id AND membership.membership_status='ACTIVE'
       JOIN account_platform_contexts context_row
         ON context_row.platform_context_id=membership.platform_context_id AND context_row.context_status='ACTIVE'
       JOIN account_platform_active_player_selections selection
         ON selection.platform_context_membership_id=membership.platform_context_membership_id AND selection.selection_status='ACTIVE'
      WHERE platform_identity.platform_code='KAKAO' AND platform_identity.identity_scope_key=?
        AND platform_identity.external_user_key=? AND platform_identity.identity_status='ACTIVE'
        AND context_row.context_type='ROOM' AND context_row.external_context_key=? FOR UPDATE`,
    [event.channelId!,event.userId!,event.channelId!],
  );
  if(rows.length!==1)throw new Error("PET_TITLE_ACTIVE_PLAYER_SELECTION_DRIFT");
}

// 관리자 batch와 동일한 PET_TITLE 전역 scope를 selection보다 먼저 잠급니다.
async function lockPetTitleGlobalScope(database:AppWiringMutationParticipant):Promise<void>{
  const rows=await database.query<Array<{lock_key:string}>>("SELECT lock_key FROM canonical_pet_title_global_locks WHERE lock_key='PET_TITLE' FOR UPDATE");
  if(rows.length!==1)throw new Error("PET_TITLE_GLOBAL_SCOPE_NOT_FOUND");
}

export class PetTitleShadowEvaluator {
  constructor(
    private readonly contexts: PlayerContextPort,
    private readonly authority: PetTitleReadAuthorityPort,
    private readonly titles: Pick<PetTitleCanonicalReadProvider, "listOwned"> = new PetTitleCanonicalReadProvider(),
  ) {}

  async preview(database: AppWiringReadParticipant, event: NormalizedIrisEvent): Promise<PetTitleShadowPreview> {
    const command = parsePetTitleCommand(event.message);
    if ((command?.kind !== "list_self" && command?.kind !== "list_target" && command?.kind !== "select") || event.userId === undefined || event.channelId === undefined) {
      throw new Error("PET_TITLE_SHADOW_INPUT_INVALID");
    }
    const actor = await this.contexts.resolveSelf(database, {
      identityProviderCode: "kakao",
      externalUserId: event.userId,
      externalContextId: event.channelId,
    });
    if (command.kind === "select") {
      if (command.index < 1) {
        return { authorized: true, outcomeCode: "INDEX_INVALID", resultFingerprint: fingerprint({ command: command.kind, index: command.index, outcome: "INDEX_INVALID", playerId: actor.canonicalPlayerId }) };
      }
      const wars = await database.query<Array<{ active: boolean | number; lifecycle_state: string }>>(
        `SELECT war.active,war.lifecycle_state
           FROM guild_territory_start_scopes scope_row
           JOIN guild_territory_wars war ON war.id=scope_row.war_id
          WHERE scope_row.scope_code=?`,
        ["world"],
      );
      if(wars[0]===undefined)throw new Error("GUILD_TERRITORY_WORLD_AUTHORITY_NOT_FOUND");
      if (resolveGuildTerritoryWarAuthority(wars[0].active,wars[0].lifecycle_state)) {
        return { authorized: true, outcomeCode: "SILENT_CASTLE_ACTIVE", resultFingerprint: fingerprint({ command: command.kind, index: command.index, outcome: "SILENT_CASTLE_ACTIVE", playerId: actor.canonicalPlayerId }) };
      }
      const rows = await this.titles.listOwned(database, actor.canonicalPlayerId);
      const selected = rows[command.index - 1];
      if (selected === undefined) {
        return { authorized: true, outcomeCode: "NOT_FOUND", resultFingerprint: fingerprint({ command: command.kind, index: command.index, outcome: "NOT_FOUND", playerId: actor.canonicalPlayerId }) };
      }
      const reply = `[${actor.rankEmoji ?? ""}${actor.displayName}] 님의 **펫 타이틀**이\n[${selected.displayName}] (으)로 적용되었습니다.`;
      return {
        authorized: true,
        outcomeCode: "READY",
        canonicalPlayerId: actor.canonicalPlayerId,
        reply,
        resultFingerprint: fingerprint({ command: command.kind, index: command.index, outcome: "READY", ownedPetTitleId: selected.instanceId, playerId: actor.canonicalPlayerId, reply }),
      };
    }
    if (command.kind === "list_target" && !await this.authority.canReadAny(database, actor)) {
      return { authorized: false, resultFingerprint: fingerprint({ command: command.kind, actor: actor.canonicalPlayerId, authorized: false }) };
    }
    const target = command.kind === "list_self"
      ? actor
      : await this.contexts.resolveUniqueLegacyDisplayTarget(database, { targetKey: command.targetName });
    const rows = await this.titles.listOwned(database, target.canonicalPlayerId);
    const reply = formatPetTitleList(`${target.rankEmoji ?? ""}${target.displayName}`, rows, command.kind === "list_target");
    return {
      authorized: true,
      canonicalPlayerId: target.canonicalPlayerId,
      reply,
      resultFingerprint: fingerprint({ command: command.kind, target: target.canonicalPlayerId, reply }),
    };
  }
}

// 목록 조회는 공용 READ_ONLY reply coordinator로 저장하고, 선택은 쓰기 전 SHADOW parity만 평가합니다.
export class PetTitleAppWiringIngress {
  constructor(
    private readonly provider: MariaAppWiringOperationProvider,
    private readonly dispatcher: Pick<CommandDispatcher, "resolveReadOnly">,
    private readonly evaluator: Pick<PetTitleShadowEvaluator, "preview">,
    private readonly contexts: PlayerContextPort,
    private readonly mutations: Pick<PetTitleCanonicalMutationProvider,"create"|"sell">,
  ) {}

  async handle(event: NormalizedIrisEvent): Promise<PetTitleAppWiringIngressResult> {
    const command = parsePetTitleCommand(event.message)??parsePetTitleSaleCommand(event.message);
    if ((command?.kind !== "list_self" && command?.kind !== "list_target" && command?.kind !== "select" && command?.kind !== "create"&&command?.kind!=="sell")
      || event.direction !== "incoming" || event.userId === undefined || event.channelId === undefined) return { status: "ignored" };
    // 레거시 String.length(UTF-16 code unit) 검증과 오류 문구를 그대로 유지합니다.
    if(command.kind==="create"&&(command.titleName===""||command.titleName.length>20))return {status:"legacy_fallback"};
    const decision = await this.dispatcher.resolveReadOnly({
      eventId: event.eventId,
      message: normalizePetTitleDispatchMessage(event.message!),
      userId: event.userId,
      hasTrustedDisplayName: event.displayNameTrust === "trusted",
    });
    if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };
    if(command.kind==="list_target"&&decision.route==="MODERN")return {status:"legacy_fallback"};
    if(command.kind==="select"&&decision.route==="MODERN")return {status:"legacy_fallback"};
    // CREATE SHADOW는 정식 아이템과 타이틀을 변경하지 않고 기존 명령만 실행합니다.
    if(command.kind==="create"&&decision.route==="SHADOW")return {status:"legacy_fallback"};
    // 판매 SHADOW는 정식 타이틀과 포인트를 변경하지 않고 기존 명령만 실행합니다.
    if(command.kind==="sell"&&decision.route==="SHADOW")return {status:"legacy_fallback"};
    const route = command.kind==="create"||command.kind==="sell"
      ? { ...decision, effectMode: "MUTATION" as const } satisfies CommandDispatchDecision & { readonly effectMode: "MUTATION" }
      : { ...decision, effectMode: "READ_ONLY" as const } satisfies CommandDispatchDecision & { readonly effectMode: "READ_ONLY" };
    const claim = {
      entrypointKind: "IRIS" as const,
      externalRequestId: externalRequestId(event.eventId),
      normalizedPayload: {
        channelId: event.channelId,
        command: command.kind,
        message: event.message!,
        targetKey: command.kind === "list_target" ? command.targetName : null,
        selectedIndex: command.kind === "select" ? command.index : command.kind==="sell" ? /^\/펫타이틀판매\s+(\d+)\s*$/.exec(event.message!)![1] : null,
        titleName: command.kind === "create" ? command.titleName : null,
        trustedDisplayName: event.displayNameTrust === "trusted",
        userId: event.userId,
      },
      actor: "pet_title_app_wiring",
    };
    if(command.kind==="create"&&decision.route==="MODERN"){
      const persisted=await executeAppWiringMutationReplyEntrypoint<{readonly status:"modern";readonly replayed:boolean;readonly resultFingerprint:string}>(this.provider,{
        claim,
        mutationRunOptions:{retryTransientRootTransaction:true},
        resolveRoute:()=>route,
        handler:async(database,activeClaim)=>{
          // PET_TITLE 전역 scope 뒤 /계정변경과 같은 selection 행을 잠가 하나의 활성 계정만 사용하게 합니다.
          await lockPetTitleGlobalScope(database);
          await lockActivePlayerSelection(database,event);
          const actor=await this.contexts.resolveSelf(database,{
            identityProviderCode:"kakao",externalUserId:event.userId!,externalContextId:event.channelId!,
          });
          const result=await this.mutations.create(database,activeClaim,{
            actor:"pet_title_app_wiring",playerId:actor.canonicalPlayerId,titleName:command.titleName,
          });
          const data=result.outcomeCode==="INSUFFICIENT_TICKET"
            ?"❌ 펫타이틀권🦊(/펫타이틀이름) 아이템이 부족합니다."
            :`[${actor.rankEmoji??""}${actor.displayName}] 님이 새로운 펫 타이틀을 생성완료!\n\n🎉 생성된 타이틀: [${command.titleName}]\n\n사용 아이템:\n 펫타이틀권🦊(/펫타이틀이름) -1 소모`;
          return {
            value:{status:"modern" as const,replayed:false,resultFingerprint:result.resultFingerprint},
            reply:{eventId:event.eventId,commandCode:"PET_TITLE_NAME_CREATE",destinationId:event.channelId!,data},
            receipt:{status:"REPLY_QUEUED",resultFingerprint:result.resultFingerprint},
            typedReceipt:{receiptKind:"PET_TITLE",petTitleOperationId:result.operationId,resultFingerprint:result.resultFingerprint},
          };
        },
        replayCompleted:async(stored)=>({status:"modern",replayed:true,resultFingerprint:stored.result?.resultFingerprint??""}),
        replayFailed:async()=>{throw new Error("PET_TITLE_APP_WIRING_PREVIOUSLY_FAILED");},
        errorCode:(error)=>error instanceof ApplicationError?error.code:"PET_TITLE_CREATE_FAILED",
      });
      return {...persisted.value,reply:persisted.reply};
    }
    if(command.kind==="sell"&&decision.route==="MODERN"){
      const persisted=await executeAppWiringMutationIrisEntrypoint<{readonly status:"modern"|"handled_no_reply";readonly replayed:boolean;readonly resultFingerprint:string}>(this.provider,{
        claim,
        mutationRunOptions:{retryTransientRootTransaction:true},
        resolveRoute:()=>route,
        handler:async(database,activeClaim)=>{
          // PET_TITLE 전역 scope 뒤 /계정변경과 같은 selection 행을 잠가 판매 전체가 하나의 활성 계정만 사용하게 합니다.
          await lockPetTitleGlobalScope(database);
          await lockActivePlayerSelection(database,event);
          const actor=await this.contexts.resolveSelf(database,{
            identityProviderCode:"kakao",externalUserId:event.userId!,externalContextId:event.channelId!,
          });
          const result=await this.mutations.sell(database,activeClaim,{
            actor:"pet_title_app_wiring",playerId:actor.canonicalPlayerId,index:command.index,
          });
          const typedReceipt={receiptKind:"PET_TITLE" as const,petTitleOperationId:result.operationId,resultFingerprint:result.resultFingerprint};
          if(result.outcomeCode==="SILENT_CASTLE_ACTIVE")return {
            value:{status:"handled_no_reply" as const,replayed:false,resultFingerprint:result.resultFingerprint},noReply:{kind:"NO_REPLY" as const,eventId:event.eventId,commandCode:"PET_TITLE_SELL"},
            receipt:{status:"NO_REPLY",resultFingerprint:result.resultFingerprint},typedReceipt,
          };
          const data=result.outcomeCode==="NOT_FOUND"
            ?"해당 번호의 펫 타이틀이 존재하지 않습니다."
            :`[${actor.rankEmoji??""}${actor.displayName}] 님의 펫 타이틀 [${result.titleName}] \n🅟${formatPoint(result.salePoint)} 포인트에 판매되었습니다.`;
          return {
            value:{status:"modern" as const,replayed:false,resultFingerprint:result.resultFingerprint},reply:{eventId:event.eventId,commandCode:"PET_TITLE_SELL",destinationId:event.channelId!,data},
            receipt:{status:"REPLY_QUEUED",resultFingerprint:result.resultFingerprint},typedReceipt,
          };
        },
        replayCompleted:async(stored)=>({status:stored.result?.status==="NO_REPLY"?"handled_no_reply":"modern",replayed:true,resultFingerprint:stored.result?.resultFingerprint??""}),
        replayFailed:async()=>{throw new Error("PET_TITLE_APP_WIRING_PREVIOUSLY_FAILED");},
        errorCode:(error)=>error instanceof ApplicationError?error.code:"PET_TITLE_SELL_FAILED",
      });
      return "reply" in persisted
        ?{status:"modern",replayed:persisted.value.replayed,resultFingerprint:persisted.value.resultFingerprint,reply:persisted.reply}
        :{status:"handled_no_reply",replayed:persisted.value.replayed,resultFingerprint:persisted.value.resultFingerprint};
    }
    if(decision.route==="MODERN"){
      const persisted=await executeAppWiringReadOnlyReplyEntrypoint<{readonly status:"modern";readonly replayed:boolean;readonly resultFingerprint:string}>(this.provider,{
        claim,
        resolveRoute:()=>route,
        handler:async(database)=>{
          const preview=await this.evaluator.preview(database,event);
          const data=preview.authorized?preview.reply!:"펫 타이틀 관리 권한이 없습니다.";
          return {
            value:{status:"modern" as const,replayed:false,resultFingerprint:preview.resultFingerprint},
            reply:{eventId:event.eventId,commandCode:"PET_TITLE_LIST_READ",destinationId:event.channelId!,data},
            receipt:{status:preview.authorized?"REPLY_QUEUED":"FORBIDDEN_REPLY_QUEUED",resultFingerprint:preview.resultFingerprint},
          };
        },
        replayCompleted:async(stored)=>({status:"modern",replayed:true,resultFingerprint:stored.result?.resultFingerprint??""}),
        replayFailed:async()=>{throw new Error("PET_TITLE_APP_WIRING_PREVIOUSLY_FAILED");},
        errorCode:(error)=>error instanceof ApplicationError?error.code:"PET_TITLE_MODERN_READ_FAILED",
      });
      return {...persisted.value,reply:persisted.reply};
    }
    return executeAppWiringEntrypoint<PetTitleAppWiringIngressResult>(this.provider, {
      claim,
      resolveRoute: () => route,
      handlers: {
        MODERN: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation as (database: AppWiringMutationParticipant) => Promise<never> },
        LEGACY_FALLBACK: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation as (database: AppWiringMutationParticipant) => Promise<never> },
        SHADOW: async (database) => {
          const preview = await this.evaluator.preview(database, event);
          if (!preview.authorized) return {
            value: { status: "rejected", replayed: false, reasonCode: "PET_TITLE_READ_ANY_FORBIDDEN", resultFingerprint: preview.resultFingerprint },
            receipt: { status: "SHADOW_REJECTED", referenceId: "PET_TITLE_READ_ANY_FORBIDDEN", resultFingerprint: preview.resultFingerprint },
          };
          return {
            value: { status: "shadow", replayed: false, resultFingerprint: preview.resultFingerprint },
            receipt: { status: "SHADOW_EVALUATED", referenceId: "PET_TITLE_LIST", resultFingerprint: preview.resultFingerprint },
          };
        },
        REJECT: async () => ({ value: { status: "rejected", replayed: false, reasonCode: decision.reasonCode }, receipt: { status: "REJECTED", referenceId: decision.reasonCode } }),
      },
      replayCompleted: async (claim) => claim.route === "REJECT"
        ? { status: "rejected", replayed: true, reasonCode: claim.reasonCode }
        : claim.result?.status === "SHADOW_REJECTED"
          ? { status: "rejected", replayed: true, reasonCode: "PET_TITLE_READ_ANY_FORBIDDEN", resultFingerprint: claim.result.resultFingerprint }
          : { status: "shadow", replayed: true, resultFingerprint: claim.result?.resultFingerprint ?? "" },
      replayFailed: async () => { throw new Error("PET_TITLE_APP_WIRING_PREVIOUSLY_FAILED"); },
      errorCode: (error) => error instanceof ApplicationError ? error.code : "PET_TITLE_SHADOW_EVALUATION_FAILED",
    });
  }
}
