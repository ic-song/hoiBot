import { ApplicationError } from "../shared/application-error.js";
import type {
  GuildTerritoryRememberPreference,
  SetGuildTerritoryRememberPreference
} from "./guild-territory-read-model-repository.js";

export const TERRITORY_REMEMBER_ON_COMMAND = "/날기억해줘온";
export const TERRITORY_REMEMBER_OFF_COMMAND = "/날기억해줘오프";

// Gate 5에서 preference 변경과 command audit/outbox를 하나의 통합 경계로 묶어야 합니다.
export const TERRITORY_REMEMBER_AUDIT_OUTBOX_BOUNDARY = "gate5-integration-transaction";

export interface GuildTerritoryRememberIdentity {
  territoryScope: string;
  operatorPlayerId: string;
  playerId: string;
}

export interface GuildTerritoryRememberCommandInput {
  message: string;
  sender: string;
}

export interface GuildTerritoryRememberCommandDependencies {
  isMaster(sender: string): boolean;
  isAdmin(sender: string): boolean;
  resolveIdentity(sender: string): Promise<GuildTerritoryRememberIdentity | null>;
  setRememberPreference(command: SetGuildTerritoryRememberPreference): Promise<GuildTerritoryRememberPreference>;
}

export type GuildTerritoryRememberCommandResult =
  | { status: "ignored" }
  | { status: "forbidden"; reply: string }
  | {
      status: "updated";
      desiredState: boolean;
      preference: GuildTerritoryRememberPreference;
      reply: string;
      auditOutboxBoundary: typeof TERRITORY_REMEMBER_AUDIT_OUTBOX_BOUNDARY;
    };

// 레거시 exact ON/OFF 명령을 공용 영지 preference provider 계약으로 변환합니다.
export async function handleGuildTerritoryRememberCommand(
  input: GuildTerritoryRememberCommandInput,
  dependencies: GuildTerritoryRememberCommandDependencies
): Promise<GuildTerritoryRememberCommandResult> {
  const desiredState = readDesiredState(input.message);
  if (desiredState === null) return { status: "ignored" };

  const authorized = dependencies.isMaster(input.sender)
    || dependencies.isAdmin(input.sender)
    || input.sender === "오픈채팅봇";
  if (!authorized) {
    return { status: "forbidden", reply: "❌ 날 기억해줘 설정은 관리자만 변경할 수 있습니다." };
  }

  const identity = await dependencies.resolveIdentity(input.sender);
  if (identity === null) {
    throw new ApplicationError(
      "TERRITORY_REMEMBER_IDENTITY_UNAVAILABLE",
      "날 기억해줘 설정에 필요한 운영자 식별 정보를 확인할 수 없습니다.",
      409
    );
  }

  const preference = await dependencies.setRememberPreference({
    territoryScope: requireIdentityPart(identity.territoryScope, "territoryScope"),
    operatorPlayerId: requireIdentityPart(identity.operatorPlayerId, "operatorPlayerId"),
    playerId: requireIdentityPart(identity.playerId, "playerId"),
    desiredState
  });
  if (preference.desiredState !== desiredState) {
    throw new ApplicationError(
      "TERRITORY_REMEMBER_STATE_MISMATCH",
      "날 기억해줘 설정 결과가 요청 상태와 일치하지 않습니다.",
      409
    );
  }

  return {
    status: "updated",
    desiredState,
    preference,
    reply: "✅ 날 기억해줘😭 이벤트 영지가 " + (desiredState ? "ON" : "OFF") + " 상태로 변경되었습니다.",
    auditOutboxBoundary: TERRITORY_REMEMBER_AUDIT_OUTBOX_BOUNDARY
  };
}

// exact 레거시 명령만 provider desiredState로 변환합니다.
function readDesiredState(message: string): boolean | null {
  if (message === TERRITORY_REMEMBER_ON_COMMAND) return true;
  if (message === TERRITORY_REMEMBER_OFF_COMMAND) return false;
  return null;
}

// provider composite key에 사용할 식별자 공백과 누락을 차단합니다.
function requireIdentityPart(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ApplicationError(
      "TERRITORY_REMEMBER_IDENTITY_INVALID",
      "날 기억해줘 설정 식별자가 올바르지 않습니다: " + field,
      400
    );
  }
  return normalized;
}
