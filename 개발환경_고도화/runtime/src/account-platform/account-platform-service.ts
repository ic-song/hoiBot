import { ApplicationError } from "../shared/application-error.js";

export type AccountPlatformCode = "KAKAO" | "DISCORD";
export type AccountPlatformContextType = "ROOM" | "SERVER";
export type AccountVerificationPurpose = "NEW_GAME_ACCOUNT" | "LEGACY_GAME_ACCOUNT_LINK";
export type PortalGameAccountRole = "REPRESENTATIVE" | "SUB";

export interface AccountPlatformContextInput {
  platformCode: AccountPlatformCode;
  contextType: AccountPlatformContextType;
  externalContextKey: string;
  externalUserKey: string;
}

export interface VerifyGameAccountInput extends AccountPlatformContextInput {
  requestKey: string;
  legacyUserAccountId: string;
  purpose: AccountVerificationPurpose;
  expectedDisplayName: string;
  observedDisplayName: string;
  targetPlayerId?: string;
  actor: string;
}

export interface VerifyGameAccountResult {
  portalAccountId: string;
  playerId: string;
  playerRole: PortalGameAccountRole;
  platformIdentityId: string;
  platformContextMembershipId: string;
  createdPlayer: boolean;
  replayed: boolean;
}

export interface SwitchActiveGameAccountInput extends AccountPlatformContextInput {
  requestKey: string;
  gameAccountSelector: string;
  expectedSelectionVersion?: number;
  actor: string;
}

export interface SwitchActiveGameAccountResult {
  portalAccountId: string;
  playerId: string;
  platformContextMembershipId: string;
  selectionVersion: number;
  replayed: boolean;
}

export interface ActivePlayerSnapshot {
  portalAccountId: string;
  playerId: string;
  platformContextMembershipId: string;
  selectionVersion: number;
}

export interface AccountPlatformRepository {
  linkVerifiedGameAccount(input: VerifyGameAccountInput & { identityScopeKey: string }): Promise<VerifyGameAccountResult>;
  switchActiveGameAccount(input: SwitchActiveGameAccountInput & { identityScopeKey: string }): Promise<SwitchActiveGameAccountResult>;
  observeNickname(input: AccountPlatformContextInput & { identityScopeKey: string; observedDisplayName: string; actor: string }): Promise<void>;
  resolveActivePlayer(input: AccountPlatformContextInput & { identityScopeKey: string }): Promise<ActivePlayerSnapshot | null>;
}

// 플랫폼별 식별 유효 범위를 안정적인 저장 key로 확정합니다.
export function deriveIdentityScopeKey(input: AccountPlatformContextInput): string {
  if (input.platformCode === "KAKAO" && input.contextType === "ROOM") return input.externalContextKey;
  if (input.platformCode === "DISCORD" && input.contextType === "SERVER") return "PLATFORM_ACCOUNT";
  throw new ApplicationError("PLATFORM_CONTEXT_INVALID", "플랫폼과 방·서버 범위가 올바르지 않습니다.", 422);
}

// /계정변경의 정확한 명령 형식에서 대상 게임계정만 추출합니다.
export function readAccountSwitchSelector(message: string): string | null {
  const match = /^\/계정변경\s+([^\s].*)$/.exec(message);
  if (match?.[1] === undefined || match[1].trim() !== match[1]) return null;
  return match[1];
}

// 계정·플랫폼 규칙 검증 후 원자적 repository 작업을 호출합니다.
export class AccountPlatformService {
  constructor(private readonly repository: AccountPlatformRepository) {}

  // 최초 인증 닉네임 일치 후 신규 또는 레거시 게임계정을 포털과 context에 연결합니다.
  async verifyGameAccount(input: VerifyGameAccountInput): Promise<VerifyGameAccountResult> {
    if (input.expectedDisplayName !== input.observedDisplayName) {
      throw new ApplicationError(
        "ACCOUNT_NAME_MISMATCH",
        `"${input.observedDisplayName}"님 플랫폼 닉네임을 "${input.expectedDisplayName}"(으)로 변경한 뒤 다시 인증해 주세요.`,
        409
      );
    }
    if (input.purpose === "LEGACY_GAME_ACCOUNT_LINK" && input.targetPlayerId === undefined) {
      throw new ApplicationError("LEGACY_PLAYER_REQUIRED", "연결할 기존 게임계정을 확인할 수 없습니다.", 422);
    }
    if (input.purpose === "NEW_GAME_ACCOUNT" && input.targetPlayerId !== undefined) {
      throw new ApplicationError("NEW_PLAYER_TARGET_FORBIDDEN", "신규 게임계정 인증에는 기존 player_id를 지정할 수 없습니다.", 422);
    }
    return this.repository.linkVerifiedGameAccount({ ...input, identityScopeKey: deriveIdentityScopeKey(input) });
  }

  // 현재 방·서버에서만 활성 게임계정을 변경합니다.
  async switchActiveGameAccount(input: Omit<SwitchActiveGameAccountInput, "gameAccountSelector"> & { message: string }): Promise<SwitchActiveGameAccountResult> {
    const gameAccountSelector = readAccountSwitchSelector(input.message);
    if (gameAccountSelector === null) {
      throw new ApplicationError("ACCOUNT_SWITCH_COMMAND_INVALID", "사용법: /계정변경 [게임계정]", 422);
    }
    return this.repository.switchActiveGameAccount({
      ...input, gameAccountSelector, identityScopeKey: deriveIdentityScopeKey(input)
    });
  }

  // 안정 사용자키의 소유권은 유지하고 최신 닉네임 관측 이력만 추가합니다.
  async observeNickname(input: AccountPlatformContextInput & { observedDisplayName: string; actor: string }): Promise<void> {
    await this.repository.observeNickname({ ...input, identityScopeKey: deriveIdentityScopeKey(input) });
  }

  // 명령 시작 시 사용할 방·서버별 활성 player snapshot을 한 번 조회합니다.
  async resolveActivePlayer(input: AccountPlatformContextInput): Promise<ActivePlayerSnapshot | null> {
    return this.repository.resolveActivePlayer({ ...input, identityScopeKey: deriveIdentityScopeKey(input) });
  }
}
