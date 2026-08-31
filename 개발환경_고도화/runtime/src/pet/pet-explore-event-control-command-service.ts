import { createHash } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import {
  PetExploreEventControlProvider,
  type PetExploreEventCode,
  type PetExploreEventControlResult,
} from "./pet-explore-event-control-provider.js";

const PERMISSION_CODE = "pet_explore.event.control";
const COMMAND_CODE = "PET_EXPLORE_EVENT_CONTROL";

export interface PetExploreEventControlCommand {
  message: "/펫탐험이벤트활성화" | "/펫탐험이벤트비활성화" | "/레이드이벤트활성화" | "/레이드이벤트비활성화";
  eventCode: PetExploreEventCode;
  active: boolean;
}

export interface PetExploreEventControlCommandResult {
  status: "changed";
  data: string;
  operationId: string;
  replayed: boolean;
}

interface ProviderPort {
  setActive(input: {
    eventCode: PetExploreEventCode;
    active: boolean;
    expectedVersion: string;
    idempotencyKey: string;
    operatorId: string;
    reason: string;
    sourceCode: "iris";
  }): Promise<PetExploreEventControlResult>;
}

const COMMANDS: Record<string, PetExploreEventControlCommand> = {
  "/펫탐험이벤트활성화": { message: "/펫탐험이벤트활성화", eventCode: "diamond_mine", active: true },
  "/펫탐험이벤트비활성화": { message: "/펫탐험이벤트비활성화", eventCode: "diamond_mine", active: false },
  "/레이드이벤트활성화": { message: "/레이드이벤트활성화", eventCode: "guild_raid", active: true },
  "/레이드이벤트비활성화": { message: "/레이드이벤트비활성화", eventCode: "guild_raid", active: false },
};

// 네 이벤트 제어 명령의 exact guard와 의미를 함께 해석합니다.
export function parsePetExploreEventControlCommand(message: string | undefined): PetExploreEventControlCommand | null {
  return message === undefined ? null : COMMANDS[message] ?? null;
}

export function isPetExploreEventControlCommand(message: string | undefined): boolean {
  return parsePetExploreEventControlCommand(message) !== null;
}

// provider 결과를 기존 네 명령의 안내 문구로 변환합니다.
export function formatPetExploreEventControlReply(
  command: PetExploreEventControlCommand,
  result: Pick<PetExploreEventControlResult, "relocatedParticipantCount">,
): string {
  if (command.eventCode === "diamond_mine") {
    if (command.active) {
      return "✅ 펫탐험 이벤트 광산이 활성화되었습니다.\n/지도에서 다이아 광산💎【/탐 0】을 확인할 수 있습니다.";
    }
    let data = "✅ 펫탐험 이벤트 광산이 비활성화되었습니다.\n/지도에서 다이아 광산💎【/탐 0】이 숨겨집니다.";
    if (BigInt(result.relocatedParticipantCount) > 0n) {
      data += `\n기존 다이아 광산 참가자 ${result.relocatedParticipantCount}명은 일반 광산 1~3번으로 이동했습니다.`;
    }
    return data;
  }
  if (command.active) {
    return "✅ 길드레이드던전👾 이벤트가 활성화되었습니다.\n/지도에서 길드레이드던전👾【/탐 10】을 확인할 수 있습니다.";
  }
  let data = "✅ 길드레이드던전👾 이벤트가 비활성화되었습니다.\n/지도에서 길드레이드던전👾【/탐 10】이 숨겨집니다.";
  if (BigInt(result.relocatedParticipantCount) > 0n) {
    data += `\n기존 길드레이드던전 참가자 ${result.relocatedParticipantCount}명은 일반 광산 1~3번으로 이동했습니다.`;
  }
  return data;
}

function normalizeEventKey(value: string): string {
  return value.length <= 128 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStoredProviderResult(value: string | { result: PetExploreEventControlResult }): PetExploreEventControlResult {
  const envelope = typeof value === "string" ? JSON.parse(value) as { result: PetExploreEventControlResult } : value;
  return envelope.result;
}

// 고정 관리자 권한과 CAS 버전을 확인한 뒤 공용 이벤트 제어 provider를 소비합니다.
export class PetExploreEventControlCommandService {
  private readonly provider: ProviderPort;

  constructor(private readonly database: DatabaseClient, provider?: ProviderPort) {
    this.provider = provider ?? new PetExploreEventControlProvider(database);
  }

  async handleDispatchedIris(input: {
    eventId: string;
    externalUserId: string;
    channelId: string;
    message: string;
  }): Promise<PetExploreEventControlCommandResult | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }> {
    const decision = await new CommandDispatcher(
      new MariaCommandDispatchRepository(this.database),
      { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() },
    ).resolve({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    return await this.execute(input) ?? { status: "handled_no_reply" };
  }

  async execute(input: {
    eventId: string;
    externalUserId: string;
    channelId: string;
    message: string;
  }): Promise<PetExploreEventControlCommandResult | null> {
    const command = parsePetExploreEventControlCommand(input.message);
    if (command === null) return null;
    const operator = (await this.database.query<Array<{ id: bigint }>>(
      `SELECT operator.id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code=? AND denied.effect='deny')
       AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code=? AND allowed.effect='allow')
         OR EXISTS (SELECT 1 FROM admin_operator_roles assignment JOIN admin_roles role ON role.id=assignment.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code=? WHERE assignment.operator_id=operator.id))
       ORDER BY operator.id LIMIT 1`,
      [input.externalUserId, PERMISSION_CODE, PERMISSION_CODE, PERMISSION_CODE],
    ))[0];
    if (operator === undefined) return null;

    const eventKey = normalizeEventKey(input.eventId);
    const scope = `admin.pet_explore_event_control:${operator.id.toString()}`;
    const stored = (await this.database.query<Array<{ result_json: string | { result: PetExploreEventControlResult } | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? LIMIT 1",
      [scope, eventKey],
    ))[0];
    let providerResult: PetExploreEventControlResult;
    if (stored?.result_json != null) {
      providerResult = { ...parseStoredProviderResult(stored.result_json), replayed: true };
    } else {
      const config = (await this.database.query<Array<{ version: bigint }>>(
        "SELECT version FROM pet_explore_runtime_config WHERE config_id=1",
      ))[0];
      if (config === undefined) throw new Error("Pet explore runtime config is missing.");
      providerResult = await this.provider.setActive({
        eventCode: command.eventCode,
        active: command.active,
        expectedVersion: config.version.toString(),
        idempotencyKey: eventKey,
        operatorId: operator.id.toString(),
        reason: `Iris ${command.message}`,
        sourceCode: "iris",
      });
    }
    await this.database.execute(
      `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
       VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE operation_id=VALUES(operation_id),execution_status='completed',result_code=VALUES(result_code),completed_at=UTC_TIMESTAMP(3)`,
      [eventKey, COMMAND_CODE, providerResult.operationId, providerResult.status],
    );
    return {
      status: "changed",
      data: formatPetExploreEventControlReply(command, providerResult),
      operationId: providerResult.operationId,
      replayed: providerResult.replayed,
    };
  }
}
