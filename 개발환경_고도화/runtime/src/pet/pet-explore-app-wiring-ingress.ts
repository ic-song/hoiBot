import { createHash } from "node:crypto";

import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import type { CommandDispatcher, CommandDispatchDecision } from "../dispatch/command-dispatcher.js";
import { executeAppWiringEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";
import type {
  AppWiringClaim,
  AppWiringMutationParticipant,
  AppWiringReadParticipant,
  MariaAppWiringOperationProvider,
} from "../dispatch/app-wiring-operation-provider.js";
import { ApplicationError } from "../shared/application-error.js";
import { isPetExploreEventControlCommand, parsePetExploreEventControlCommand } from "./pet-explore-event-control-command-service.js";
import { isPetExploreSettlementCommand } from "./pet-explore-settlement-command-consumer.js";
import { previewPetExploreSettlementInput } from "./pet-explore-settlement-input-snapshot-provider.js";
import { PetExploreEventControlAppWiringProvider } from "./pet-explore-event-control-app-wiring-provider.js";

export type PetExploreAppWiringFamily = "EVENT_CONTROL" | "SETTLEMENT";
export interface PetExploreShadowPreview {
  readonly family: PetExploreAppWiringFamily;
  readonly authorized: boolean;
  readonly resultFingerprint: string;
  readonly summary: Readonly<Record<string, string | boolean>>;
}
export type PetExploreAppWiringIngressResult =
  | { readonly status: "ignored" | "legacy_fallback" }
  | { readonly status: "modern"; readonly replayed: boolean; readonly operationId: string; readonly resultFingerprint: string }
  | { readonly status: "shadow"; readonly replayed: boolean; readonly resultFingerprint: string }
  | { readonly status: "rejected"; readonly replayed: boolean; readonly reasonCode: string };

export interface PetExploreShadowEvaluator {
  preview(database: AppWiringReadParticipant, family: PetExploreAppWiringFamily, event: NormalizedIrisEvent): Promise<PetExploreShadowPreview>;
}

function normalizedJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(normalizedJson).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(String(value));
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${normalizedJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(normalizedJson(value), "utf8").digest("hex");
}

function externalRequestId(value: string): string {
  return /^[A-Za-z0-9._:@/-]{1,172}$/.test(value) ? value : `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === "1";
}

// 기존 writer projection을 호출하지 않고 현재 상태와 예상 plan만 consistent read snapshot에서 계산합니다.
export class MariaPetExploreShadowEvaluator implements PetExploreShadowEvaluator {
  async preview(database: AppWiringReadParticipant, family: PetExploreAppWiringFamily, event: NormalizedIrisEvent): Promise<PetExploreShadowPreview> {
    return family === "EVENT_CONTROL"
      ? this.previewEventControl(database, event)
      : this.previewSettlement(database, event);
  }

  private async previewEventControl(database: AppWiringReadParticipant, event: NormalizedIrisEvent): Promise<PetExploreShadowPreview> {
    const command = parsePetExploreEventControlCommand(event.message);
    if (command === null || event.userId === undefined) throw new Error("PET_EXPLORE_SHADOW_EVENT_INPUT_INVALID");
    const authority = (await database.query<Array<{ operator_id: bigint | string }>>(
      `SELECT operator.id operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='pet_explore.event.control' AND denied.effect='deny')
       AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='pet_explore.event.control' AND allowed.effect='allow')
         OR EXISTS (SELECT 1 FROM admin_operator_roles assignment JOIN admin_roles role ON role.id=assignment.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='pet_explore.event.control' WHERE assignment.operator_id=operator.id))
       ORDER BY operator.id LIMIT 1`,
      [event.userId],
    ))[0];
    if (authority === undefined) {
      const projection = { family: "EVENT_CONTROL", authorized: false, eventCode: command.eventCode, requestedActive: command.active };
      return Object.freeze({
        family: "EVENT_CONTROL",
        authorized: false,
        resultFingerprint: fingerprint(projection),
        summary: Object.freeze({ eventCode: command.eventCode, requestedActive: command.active, authorized: false }),
      });
    }
    const config = (await database.query<Array<{ event_mine_active: number; guild_raid_active: number; version: bigint | string }>>(
      "SELECT event_mine_active,guild_raid_active,version FROM pet_explore_runtime_config WHERE config_id=1",
    ))[0];
    if (config === undefined) throw new Error("PET_EXPLORE_SHADOW_CONFIG_MISSING");
    const destinationCode = command.eventCode === "diamond_mine" ? "diamond_mine_event" : "guild_raid_event";
    const relocation = (await database.query<Array<{ participant_count: bigint | string }>>(
      `SELECT COUNT(*) participant_count FROM pet_explore_participations participation
       JOIN pet_explore_rounds round_state ON round_state.id=participation.round_id AND round_state.state_code='open'
       WHERE participation.destination_code=? AND participation.state_code='active'`,
      [destinationCode],
    ))[0];
    const previousActive = command.eventCode === "diamond_mine" ? truthy(config.event_mine_active) : truthy(config.guild_raid_active);
    const changed = previousActive !== command.active;
    const relocatedParticipantCount = changed && !command.active ? String(relocation?.participant_count ?? "0") : "0";
    const projection = {
      family: "EVENT_CONTROL",
      command: command.message,
      eventCode: command.eventCode,
      authorizedOperatorId: String(authority.operator_id),
      previousActive,
      requestedActive: command.active,
      changed,
      previousVersion: String(config.version),
      expectedVersion: changed ? (BigInt(config.version) + 1n).toString() : String(config.version),
      relocatedParticipantCount,
    };
    return Object.freeze({
      family: "EVENT_CONTROL",
      authorized: true,
      resultFingerprint: fingerprint(projection),
      summary: Object.freeze({ eventCode: command.eventCode, previousActive, requestedActive: command.active, changed, relocatedParticipantCount }),
    });
  }

  private async previewSettlement(database: AppWiringReadParticipant, event: NormalizedIrisEvent): Promise<PetExploreShadowPreview> {
    if (!isPetExploreSettlementCommand(event.message) || event.userId === undefined || event.channelId === undefined) throw new Error("PET_EXPLORE_SHADOW_SETTLEMENT_INPUT_INVALID");
    const authority = (await database.query<Array<{ operator_id: bigint | string; display_name: string; role_code: string; channel_allowed: number }>>(
      `SELECT mapping.operator_id,operator.display_name,role.code role_code,
       EXISTS(SELECT 1 FROM pet_explore_scheduler_allowed_channels channel WHERE channel.external_channel_id=? AND channel.active=TRUE) channel_allowed
       FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       ORDER BY CASE role.code WHEN 'super_admin' THEN 0 ELSE 1 END LIMIT 1`,
      [event.channelId, event.userId],
    ))[0];
    const authorized = authority !== undefined && (authority.role_code === "super_admin" || (authority.display_name === "오픈채팅봇" && truthy(authority.channel_allowed)));
    if (!authorized) {
      const projection = { family: "SETTLEMENT", authorized: false, authority: authority ?? null };
      return Object.freeze({
        family: "SETTLEMENT",
        authorized: false,
        resultFingerprint: fingerprint(projection),
        summary: Object.freeze({ authorized: false }),
      });
    }
    const preview = await previewPetExploreSettlementInput(database, {
      eventId: event.eventId,
      operatorId: String(authority.operator_id),
      destinationId: event.channelId,
    });
    return Object.freeze({
      family: "SETTLEMENT",
      authorized: true,
      resultFingerprint: preview.resultFingerprint,
      summary: Object.freeze({
        roundKey: preview.input.roundKey,
        participantCount: String(preview.input.plans.length),
        nextAutoCount: String(preview.input.nextAutoReservations.length),
        requestFingerprint: preview.requestFingerprint,
      }),
    });
  }
}

function familyOf(message: string | undefined): PetExploreAppWiringFamily | undefined {
  if (isPetExploreEventControlCommand(message)) return "EVENT_CONTROL";
  if (isPetExploreSettlementCommand(message)) return "SETTLEMENT";
  return undefined;
}

function forbiddenMutation(): Promise<never> {
  return Promise.reject(new Error("PET_EXPLORE_APP_WIRING_MUTATION_NOT_ADOPTED"));
}

// EVENT_CONTROL만 typed MODERN mutation을 허용하고, SETTLEMENT MODERN과 모든 Node legacy 실행은 닫습니다.
export class PetExploreAppWiringIngress {
  constructor(
    private readonly provider: MariaAppWiringOperationProvider,
    private readonly dispatcher: Pick<CommandDispatcher, "resolveReadOnly">,
    private readonly evaluator: PetExploreShadowEvaluator = new MariaPetExploreShadowEvaluator(),
    private readonly eventControlProvider: Pick<PetExploreEventControlAppWiringProvider, "execute"> = new PetExploreEventControlAppWiringProvider(),
  ) {}

  async handle(event: NormalizedIrisEvent): Promise<PetExploreAppWiringIngressResult> {
    const family = familyOf(event.message);
    if (family === undefined || event.direction !== "incoming" || event.userId === undefined || event.channelId === undefined) return { status: "ignored" };
    const decision = await this.dispatcher.resolveReadOnly({
      eventId: event.eventId,
      message: event.message!,
      userId: event.userId,
      hasTrustedDisplayName: event.displayNameTrust === "trusted",
    });
    if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };
    if (decision.route === "MODERN" && family !== "EVENT_CONTROL") throw new ApplicationError("PET_EXPLORE_MODERN_MUTATION_NOT_ADOPTED", "펫탐험 정산 modern mutation 경로는 아직 활성화할 수 없습니다.", 503);
    const route = { ...decision, effectMode: decision.route === "MODERN" ? "MUTATION" as const : "READ_ONLY" as const } satisfies CommandDispatchDecision & { readonly effectMode: "MUTATION" | "READ_ONLY" };
    return executeAppWiringEntrypoint<PetExploreAppWiringIngressResult>(this.provider, {
      claim: {
        entrypointKind: "IRIS",
        externalRequestId: externalRequestId(event.eventId),
        normalizedPayload: { family, message: event.message!, userId: event.userId, channelId: event.channelId, hasTrustedDisplayName: event.displayNameTrust === "trusted" },
        actor: "pet_explore_app_wiring",
      },
      resolveRoute: () => route,
      handlers: {
        MODERN: {
          READ_ONLY: forbiddenMutation,
          MUTATION: async (database, claim) => {
            if (family !== "EVENT_CONTROL") return forbiddenMutation();
            const result = await this.eventControlProvider.execute(database, event, claim);
            return {
              value: { status: "modern", replayed: false, operationId: result.operationId, resultFingerprint: result.resultFingerprint },
              receipt: { status: "MODERN_COMPLETED", referenceId: result.operationId, resultFingerprint: result.resultFingerprint },
              typedReceipt: { receiptKind: "PET_EXPLORE_EVENT_CONTROL", petExploreEventControlOperationId: result.operationId, resultFingerprint: result.resultFingerprint },
            };
          },
        },
        LEGACY_FALLBACK: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation as (database: AppWiringMutationParticipant, claim: AppWiringClaim) => Promise<never> },
        SHADOW: async (database) => {
          const preview = await this.evaluator.preview(database, family, event);
          return { value: { status: "shadow", replayed: false, resultFingerprint: preview.resultFingerprint }, receipt: { status: "SHADOW_EVALUATED", referenceId: family, resultFingerprint: preview.resultFingerprint } };
        },
        REJECT: async () => ({ value: { status: "rejected", replayed: false, reasonCode: decision.reasonCode }, receipt: { status: "REJECTED", referenceId: decision.reasonCode } }),
      },
      replayCompleted: async (claim) => claim.route === "REJECT"
        ? { status: "rejected", replayed: true, reasonCode: claim.reasonCode }
        : claim.route === "MODERN"
          ? { status: "modern", replayed: true, operationId: claim.result?.referenceId ?? "", resultFingerprint: claim.result?.resultFingerprint ?? "" }
          : { status: "shadow", replayed: true, resultFingerprint: claim.result?.resultFingerprint ?? "" },
      replayFailed: async () => { throw new Error("PET_EXPLORE_APP_WIRING_PREVIOUSLY_FAILED"); },
      errorCode: (error) => error instanceof ApplicationError
        ? error.code
        : decision.route === "MODERN"
          ? "PET_EXPLORE_MODERN_MUTATION_FAILED"
          : "PET_EXPLORE_SHADOW_EVALUATION_FAILED",
    });
  }
}
