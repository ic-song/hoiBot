import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  AccountPlatformCommandContextProvider,
  type AccountPlatformCommandContext
} from "./account-platform-command-context-provider.js";
import {
  AccountSwitchCommandService,
  isAccountSwitchCommandCandidate,
  type AccountSwitchCommandResult
} from "./account-switch-command-service.js";
import type { ActivePlayerSnapshot } from "./account-platform-service.js";

export interface AccountPlatformKakaoEventContext {
  readonly eventId: string;
  readonly externalUserId: string;
  readonly channelId: string;
  readonly message: string;
  readonly actor: AccountPlatformCommandContext["actor"];
}

// Iris 명령 시작 시 방별 활성 player를 한 번 고정해 후속 consumer에 전달합니다.
export class AccountPlatformIrisContextProvider {
  private readonly contextProvider: AccountPlatformCommandContextProvider;
  private readonly switchCommand: AccountSwitchCommandService;

  constructor(database: DatabaseClient) {
    this.contextProvider = new AccountPlatformCommandContextProvider(database);
    this.switchCommand = new AccountSwitchCommandService(database);
  }

  async prepareKakao(event: NormalizedIrisEvent): Promise<AccountPlatformKakaoEventContext | null> {
    if (event.direction !== "incoming" || event.userId === undefined || event.channelId === undefined || event.message === undefined) {
      return null;
    }
    const prepared = await this.contextProvider.prepare({
      eventId: event.eventId,
      platformCode: "KAKAO",
      contextType: "ROOM",
      externalContextKey: event.channelId,
      externalUserKey: event.userId,
      message: event.message
    });
    return Object.freeze({
      eventId: prepared.eventId,
      externalUserId: event.userId,
      channelId: event.channelId,
      message: prepared.message,
      actor: prepared.actor
    });
  }

  async dispatchAccountSwitch(context: AccountPlatformKakaoEventContext): Promise<AccountSwitchCommandResult | null> {
    if (!isAccountSwitchCommandCandidate(context.message)) return null;
    const actor = context.actor;
    if (actor !== null && actor.source !== "ACCOUNT_PLATFORM_CONTEXT") {
      throw new ApplicationError("PLATFORM_CONTEXT_AUTH_REQUIRED", "이 방에서 먼저 계정 인증을 완료해 주세요.", 409);
    }
    let snapshot: ActivePlayerSnapshot | null = null;
    if (actor !== null) {
      const { portalAccountId, platformContextMembershipId, selectionVersion } = actor;
      if (portalAccountId === undefined || platformContextMembershipId === undefined || selectionVersion === undefined) {
        throw new ApplicationError("ACCOUNT_PLATFORM_SNAPSHOT_INVALID", "활성 게임계정 정보를 확인할 수 없습니다.", 500);
      }
      snapshot = { portalAccountId, playerId: actor.playerId, platformContextMembershipId, selectionVersion };
    }
    return this.switchCommand.handleKakaoFromSnapshot({
      eventId: context.eventId,
      externalUserId: context.externalUserId,
      channelId: context.channelId,
      message: context.message
    }, snapshot);
  }
}
