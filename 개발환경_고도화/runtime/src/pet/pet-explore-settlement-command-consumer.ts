import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { PetExploreSettlementProvider, type PetExploreSettlementInput, type PetExploreSettlementResult } from "./pet-explore-settlement-provider.js";

export const PET_EXPLORE_SETTLEMENT_COMMAND = "/펫탐험정산";
const COMMAND_CODE = "ADMIN_PET_EXPLORE_SETTLEMENT";
export type PetExploreSettlementCommandStatus = "settled" | "noop" | "conflict" | "not_found" | "policy_blocked";
export interface PetExploreSettlementCommandResponse { status: PetExploreSettlementCommandStatus; message: string; room: string; replayed: boolean; outboxId: string | null }
export interface PetExploreSettlementCommandSnapshotSource { load(input: { eventId: string; operatorId: string; destinationId: string }): Promise<PetExploreSettlementInput> }
export interface PetExploreSettlementCommandProvider { settle(input: PetExploreSettlementInput): Promise<PetExploreSettlementResult> }
interface AuthorityRow { operator_id: bigint; display_name: string; role_code: string; channel_allowed: number }

// 레거시 정산 명령은 공백과 인자를 허용하지 않는 exact 경계만 사용합니다.
export function isPetExploreSettlementCommand(message: string | undefined): boolean { return message === PET_EXPLORE_SETTLEMENT_COMMAND; }

// provider 결과를 레거시 보고서 의미를 보존하는 단일 사용자 응답으로 투영합니다.
export function formatPetExploreSettlementCommandResult(result: PetExploreSettlementResult): string {
  if (result.status === "noop") return `📜펫탐험 결과 보고서📜\n정산할 펫탐험 참가자가 없습니다.${result.replayed ? "\n(재실행 결과)" : ""}`;
  const lines = result.participants.map((participant) => {
    const outcome = participant.resultCode === "success" ? "성공(✅)" : participant.resultCode === "failure" ? "실패(❌)" : "입장 실패(❌)";
    return `[${participant.playerId}]${participant.effectiveDestinationCode} ${outcome}${participant.fallbackApplied ? "\n입장권 없음: 광산 랜덤 이동" : ""}`;
  });
  return ["📜펫탐험 결과 보고서📜", "탐험자 형님덜 고생하셨습니다🙇", `탐험 성공✅[${result.successCount}명] 탐험 실패❌[${(BigInt(result.failureCount) + BigInt(result.ineligibleCount)).toString()}명]`, ...lines, ...(result.replayed ? ["(재실행 결과)"] : [])].join("\n");
}

// 총괄 운영자 또는 허용 채널의 오픈채팅봇만 immutable snapshot을 settlement provider에 전달합니다.
export class PetExploreSettlementCommandConsumer {
  public constructor(private readonly database: DatabaseClient, private readonly snapshots: PetExploreSettlementCommandSnapshotSource, private readonly provider: PetExploreSettlementCommandProvider = new PetExploreSettlementProvider(database)) {}

  public async execute(event: NormalizedIrisEvent): Promise<PetExploreSettlementCommandResponse> {
    if (!isPetExploreSettlementCommand(event.message)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_COMMAND_INVALID", "펫탐험정산 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_COMMAND_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const authority = (await this.database.query<AuthorityRow[]>(`SELECT mapping.operator_id,operator.display_name,role.code role_code,
      EXISTS(SELECT 1 FROM pet_explore_scheduler_allowed_channels channel WHERE channel.external_channel_id=? AND channel.active=TRUE) channel_allowed
      FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
      JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
      JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
      JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
      ORDER BY CASE role.code WHEN 'super_admin' THEN 0 ELSE 1 END LIMIT 1`, [event.channelId, event.userId]))[0];
    if (!authority || !(authority.role_code === "super_admin" || (authority.display_name === "오픈채팅봇" && authority.channel_allowed === 1))) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_COMMAND_FORBIDDEN", "펫탐험 정산 권한이 없습니다.", 403);
    try {
      const snapshot = await this.snapshots.load({ eventId: event.eventId, operatorId: authority.operator_id.toString(), destinationId: event.channelId });
      const result = await this.provider.settle(snapshot);
      return { status: result.status, message: formatPetExploreSettlementCommandResult(result), room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      if (error.code === "PET_EXPLORE_PREMIUM_POLICY_CONFLICT") return { status: "policy_blocked", message: "premium 탐험 보너스 정책이 확정되지 않아 정산을 중단했습니다.", room: event.channelId, replayed: false, outboxId: null };
      if (error.statusCode === 404) return { status: "not_found", message: "정산할 펫탐험 round를 찾을 수 없습니다.", room: event.channelId, replayed: false, outboxId: null };
      if (error.statusCode === 409) return { status: "conflict", message: "펫탐험 정산 상태가 먼저 변경되었습니다. 현재 상태를 확인해 주세요.", room: event.channelId, replayed: false, outboxId: null };
      throw error;
    }
  }

  // command registry rollout을 확인한 뒤 exact 명령만 modern consumer에 도달시킵니다.
  public async handleIris(event: NormalizedIrisEvent): Promise<PetExploreSettlementCommandResponse | { status: "shadow" | "legacy_fallback" }> {
    if (!isPetExploreSettlementCommand(event.message)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_COMMAND_INVALID", "펫탐험정산 명령 형식을 확인해 주세요.", 422);
    const definition = (await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    const dispatchEvent = { eventId: event.eventId, message: event.message!, userId: event.userId, hasTrustedDisplayName: event.displayNameTrust === "trusted" };
    if (!definition || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record(dispatchEvent, { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: "pet_explore_settlement" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record(dispatchEvent, { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: "pet_explore_settlement" });
      return { status: "shadow" };
    }
    await dispatch.record(dispatchEvent, { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: "pet_explore_settlement" });
    return this.execute(event);
  }
}

// partial dispatcher가 exact 후보만 consumer로 넘기도록 null 가능한 adapter 경계를 제공합니다.
export class PetExploreSettlementCommandDispatchAdapter {
  public constructor(private readonly consumer: PetExploreSettlementCommandConsumer) {}
  public dispatch(event: NormalizedIrisEvent): Promise<PetExploreSettlementCommandResponse | null> { return isPetExploreSettlementCommand(event.message) ? this.consumer.execute(event) : Promise.resolve(null); }
}
