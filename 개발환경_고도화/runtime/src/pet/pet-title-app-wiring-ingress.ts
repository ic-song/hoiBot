import { createHash } from "node:crypto";

import type { PlayerContext, PlayerContextPort } from "../account-platform/player-context-provider.js";
import type { CommandDispatcher, CommandDispatchDecision } from "../dispatch/command-dispatcher.js";
import { executeAppWiringEntrypoint, executeAppWiringReadOnlyReplyEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";
import type { AppWiringMutationParticipant, AppWiringReadParticipant, MariaAppWiringOperationProvider } from "../dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { PetTitleCanonicalReadProvider } from "./pet-title-canonical-read-provider.js";
import { formatPetTitleList, normalizePetTitleDispatchMessage, parsePetTitleCommand } from "./pet-title-lifecycle-service.js";

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
  readonly resultFingerprint: string;
  readonly canonicalPlayerId?: string;
  readonly reply?: string;
}

export type PetTitleAppWiringIngressResult =
  | { readonly status: "ignored" | "legacy_fallback" }
  | { readonly status: "modern"; readonly replayed: boolean; readonly resultFingerprint: string; readonly reply: { readonly outboxId: string; readonly room: string; readonly data: string } }
  | { readonly status: "shadow"; readonly replayed: boolean; readonly resultFingerprint: string }
  | { readonly status: "rejected"; readonly replayed: boolean; readonly reasonCode: string; readonly resultFingerprint?: string };

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function externalRequestId(value: string): string {
  return /^[A-Za-z0-9._:@/-]{1,172}$/.test(value) ? value : `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function forbiddenMutation(): Promise<never> {
  return Promise.reject(new Error("PET_TITLE_APP_WIRING_MUTATION_NOT_ADOPTED"));
}

export class PetTitleShadowEvaluator {
  constructor(
    private readonly contexts: PlayerContextPort,
    private readonly authority: PetTitleReadAuthorityPort,
    private readonly titles: Pick<PetTitleCanonicalReadProvider, "listOwned"> = new PetTitleCanonicalReadProvider(),
  ) {}

  async preview(database: AppWiringReadParticipant, event: NormalizedIrisEvent): Promise<PetTitleShadowPreview> {
    const command = parsePetTitleCommand(event.message);
    if ((command?.kind !== "list_self" && command?.kind !== "list_target") || event.userId === undefined || event.channelId === undefined) {
      throw new Error("PET_TITLE_SHADOW_INPUT_INVALID");
    }
    const actor = await this.contexts.resolveSelf(database, {
      identityProviderCode: "kakao",
      externalUserId: event.userId,
      externalContextId: event.channelId,
    });
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

// 목록 조회는 공용 READ_ONLY reply coordinator를 통해 snapshot 결과와 outbox를 원자적으로 저장합니다.
export class PetTitleAppWiringIngress {
  constructor(
    private readonly provider: MariaAppWiringOperationProvider,
    private readonly dispatcher: Pick<CommandDispatcher, "resolveReadOnly">,
    private readonly evaluator: Pick<PetTitleShadowEvaluator, "preview">,
  ) {}

  async handle(event: NormalizedIrisEvent): Promise<PetTitleAppWiringIngressResult> {
    const command = parsePetTitleCommand(event.message);
    if ((command?.kind !== "list_self" && command?.kind !== "list_target")
      || event.direction !== "incoming" || event.userId === undefined || event.channelId === undefined) return { status: "ignored" };
    const decision = await this.dispatcher.resolveReadOnly({
      eventId: event.eventId,
      message: normalizePetTitleDispatchMessage(event.message!),
      userId: event.userId,
      hasTrustedDisplayName: event.displayNameTrust === "trusted",
    });
    if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };
    if(command.kind==="list_target"&&decision.route==="MODERN")return {status:"legacy_fallback"};
    const route = { ...decision, effectMode: "READ_ONLY" as const } satisfies CommandDispatchDecision & { readonly effectMode: "READ_ONLY" };
    const claim = {
      entrypointKind: "IRIS" as const,
      externalRequestId: externalRequestId(event.eventId),
      normalizedPayload: {
        channelId: event.channelId,
        command: command.kind,
        message: event.message!,
        targetKey: command.kind === "list_target" ? command.targetName : null,
        trustedDisplayName: event.displayNameTrust === "trusted",
        userId: event.userId,
      },
      actor: "pet_title_app_wiring",
    };
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
