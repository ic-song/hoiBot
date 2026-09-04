import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { AccountPlatformService, readAccountSwitchSelector } from "./account-platform-service.js";
import { MariaAccountPlatformRepository } from "./maria-account-platform-repository.js";

export interface KakaoAccountSwitchCommandInput {
  eventId: string;
  externalUserId: string;
  channelId: string;
  message: string;
}

export interface AccountSwitchCommandResult {
  status: "changed";
  data: string;
  playerId: string;
  selectionVersion: number;
  replayed: boolean;
}

// 정확한 /계정변경 명령과 비어 있지 않은 게임계정 선택자만 후보로 판정합니다.
export function isAccountSwitchCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && readAccountSwitchSelector(message) !== null;
}

// Kakao 방의 현재 selection을 잠금 버전으로 사용해 활성 게임계정을 변경합니다.
export class AccountSwitchCommandService {
  private readonly accountPlatform: AccountPlatformService;

  constructor(database: DatabaseClient) {
    this.accountPlatform = new AccountPlatformService(new MariaAccountPlatformRepository(database));
  }

  async handleKakao(input: KakaoAccountSwitchCommandInput): Promise<AccountSwitchCommandResult> {
    const context = {
      platformCode: "KAKAO" as const,
      contextType: "ROOM" as const,
      externalContextKey: input.channelId,
      externalUserKey: input.externalUserId
    };
    const current = await this.accountPlatform.resolveActivePlayer(context);
    if (current === null) {
      throw new ApplicationError(
        "PLATFORM_CONTEXT_AUTH_REQUIRED",
        "이 방에서 먼저 계정 인증을 완료해 주세요.",
        409
      );
    }
    const changed = await this.accountPlatform.switchActiveGameAccount({
      ...context,
      requestKey: input.eventId,
      message: input.message,
      expectedSelectionVersion: current.selectionVersion,
      actor: "사용자"
    });
    return {
      status: "changed",
      data: `✅ 이 방에서 사용할 게임계정을 ${changed.playerId}(으)로 변경했어요.`,
      playerId: changed.playerId,
      selectionVersion: changed.selectionVersion,
      replayed: changed.replayed
    };
  }
}
