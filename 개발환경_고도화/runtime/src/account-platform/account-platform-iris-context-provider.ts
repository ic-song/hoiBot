import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  AccountPlatformActorContextResolver,
  type ResolvedAccountPlatformActorContext
} from "./account-platform-actor-context-resolver.js";
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
  readonly actor: Readonly<ResolvedAccountPlatformActorContext> | null;
}

// Iris 명령 시작 시 방별 활성 player를 한 번 고정해 후속 consumer에 전달합니다.
export class AccountPlatformIrisContextProvider {
  private readonly resolver: AccountPlatformActorContextResolver;
  private readonly switchCommand: AccountSwitchCommandService;

  constructor(database: DatabaseClient) {
    this.resolver = new AccountPlatformActorContextResolver(database);
    this.switchCommand = new AccountSwitchCommandService(database);
  }

  async prepareKakao(event: NormalizedIrisEvent): Promise<AccountPlatformKakaoEventContext | null> {
    if (event.direction !== "incoming" || event.userId === undefined || event.channelId === undefined || event.message === undefined) {
      return null;
    }
    const actor = await this.resolver.resolve({
      platformCode: "KAKAO",
      contextType: "ROOM",
      externalContextKey: event.channelId,
      externalUserKey: event.userId
    });
    return Object.freeze({
      eventId: event.eventId,
      externalUserId: event.userId,
      channelId: event.channelId,
      message: event.message,
      actor: actor === null ? null : Object.freeze({ ...actor })
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
