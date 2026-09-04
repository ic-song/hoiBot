import { createHash } from "node:crypto";

import type { CommandDispatcher, CommandDispatchDecision } from "../dispatch/command-dispatcher.js";
import { executeAppWiringEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";
import type {
  AppWiringClaim,
  AppWiringMutationParticipant,
  MariaAppWiringOperationProvider,
} from "../dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isPetDataCompareCommand } from "./pet-data-compare-service.js";
import {
  MariaPetDataCompareShadowEvaluator,
  type PetDataCompareShadowEvaluator,
} from "./pet-data-compare-shadow-snapshot-provider.js";

export type PetDataCompareAppWiringIngressResult =
  | { readonly status: "ignored" | "legacy_fallback" }
  | { readonly status: "shadow"; readonly replayed: boolean; readonly resultFingerprint: string }
  | { readonly status: "rejected"; readonly replayed: boolean; readonly reasonCode: string; readonly resultFingerprint?: string };

function externalRequestId(value: string): string {
  return /^[A-Za-z0-9._:@/-]{1,172}$/.test(value)
    ? value
    : `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function forbiddenMutation(): Promise<never> {
  return Promise.reject(new Error("PET_DATA_COMPARE_APP_WIRING_MUTATION_NOT_ADOPTED"));
}

function isResultFingerprint(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{64}$/.test(value);
}

function invalidReplayReceipt(): never {
  throw new ApplicationError(
    "PET_DATA_COMPARE_APP_WIRING_REPLAY_RECEIPT_INVALID",
    "저장된 펫데이터비교 완료 receipt가 현재 계약과 일치하지 않습니다.",
    500,
  );
}

// 첫 ADMIN ingress는 exact incoming command의 SHADOW/REJECT만 claim하고 권한은 DB evaluator가 판정합니다.
export class PetDataCompareAppWiringIngress {
  constructor(
    private readonly provider: MariaAppWiringOperationProvider,
    private readonly dispatcher: Pick<CommandDispatcher, "resolveReadOnly">,
    private readonly evaluator: PetDataCompareShadowEvaluator = new MariaPetDataCompareShadowEvaluator(),
  ) {}

  async handle(event: NormalizedIrisEvent): Promise<PetDataCompareAppWiringIngressResult> {
    if (!isPetDataCompareCommand(event.message)
      || event.direction !== "incoming"
      || event.userId === undefined
      || event.channelId === undefined) return { status: "ignored" };

    const message = event.message!;
    const dispatchInput = {
      eventId: event.eventId,
      message,
      userId: event.userId,
      hasTrustedDisplayName: event.displayNameTrust === "trusted",
    } as const;
    const decision = await this.dispatcher.resolveReadOnly(dispatchInput);
    if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };
    if (decision.route === "MODERN") {
      throw new ApplicationError(
        "PET_DATA_COMPARE_MODERN_MUTATION_NOT_ADOPTED",
        "펫데이터비교 modern mutation 경로는 아직 활성화할 수 없습니다.",
        503,
      );
    }
    const route = { ...decision, effectMode: "READ_ONLY" as const } satisfies CommandDispatchDecision & { readonly effectMode: "READ_ONLY" };

    return executeAppWiringEntrypoint<PetDataCompareAppWiringIngressResult>(this.provider, {
      claim: {
        entrypointKind: "IRIS",
        externalRequestId: externalRequestId(event.eventId),
        normalizedPayload: {
          channelId: event.channelId,
          command: message,
          direction: "incoming",
          trustedDisplayName: event.displayNameTrust === "trusted",
          userId: event.userId,
        },
        actor: "pet_data_compare_app_wiring",
      },
      resolveRoute: () => route,
      handlers: {
        MODERN: {
          READ_ONLY: forbiddenMutation,
          MUTATION: forbiddenMutation as (database: AppWiringMutationParticipant, claim: AppWiringClaim) => Promise<never>,
        },
        LEGACY_FALLBACK: {
          READ_ONLY: forbiddenMutation,
          MUTATION: forbiddenMutation as (database: AppWiringMutationParticipant, claim: AppWiringClaim) => Promise<never>,
        },
        SHADOW: async (database) => {
          const preview = await this.evaluator.preview(database, event);
          if (!preview.authorized) {
            return {
              value: {
                status: "rejected",
                replayed: false,
                reasonCode: "ADMIN_PET_DATA_COMPARE_FORBIDDEN",
                resultFingerprint: preview.resultFingerprint,
              },
              receipt: {
                status: "SHADOW_REJECTED",
                referenceId: "ADMIN_PET_DATA_COMPARE_FORBIDDEN",
                resultFingerprint: preview.resultFingerprint,
              },
            };
          }
          return {
            value: { status: "shadow", replayed: false, resultFingerprint: preview.resultFingerprint },
            receipt: { status: "SHADOW_EVALUATED", referenceId: "PET_DATA_COMPARE", resultFingerprint: preview.resultFingerprint },
          };
        },
        REJECT: async () => ({
          value: { status: "rejected", replayed: false, reasonCode: decision.reasonCode },
          receipt: { status: "REJECTED", referenceId: decision.reasonCode },
        }),
      },
      replayCompleted: async (claim) => {
        if (claim.route === "REJECT") {
          if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(claim.reasonCode)
            || claim.result?.status !== "REJECTED"
            || claim.result.referenceId !== claim.reasonCode
            || claim.result.resultFingerprint !== undefined) return invalidReplayReceipt();
          return { status: "rejected", replayed: true, reasonCode: claim.reasonCode };
        }
        if (claim.route !== "SHADOW") return invalidReplayReceipt();
        if (claim.result?.status === "SHADOW_EVALUATED") {
          if (claim.result.referenceId !== "PET_DATA_COMPARE" || !isResultFingerprint(claim.result.resultFingerprint)) return invalidReplayReceipt();
          return { status: "shadow", replayed: true, resultFingerprint: claim.result.resultFingerprint };
        }
        if (claim.result?.status === "SHADOW_REJECTED") {
          if (claim.result.referenceId !== "ADMIN_PET_DATA_COMPARE_FORBIDDEN" || !isResultFingerprint(claim.result.resultFingerprint)) return invalidReplayReceipt();
          return {
            status: "rejected",
            replayed: true,
            reasonCode: "ADMIN_PET_DATA_COMPARE_FORBIDDEN",
            resultFingerprint: claim.result.resultFingerprint,
          };
        }
        return invalidReplayReceipt();
      },
      replayFailed: async () => { throw new Error("PET_DATA_COMPARE_APP_WIRING_PREVIOUSLY_FAILED"); },
      errorCode: (error) => error instanceof ApplicationError ? error.code : "PET_DATA_COMPARE_SHADOW_EVALUATION_FAILED",
    });
  }
}
