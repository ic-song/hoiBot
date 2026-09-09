import type { DatabaseClient } from "../database.js";
import {
  AccountPlatformActorContextResolver,
  type ResolvedAccountPlatformActorContext
} from "./account-platform-actor-context-resolver.js";
import type { AccountPlatformCode, AccountPlatformContextType } from "./account-platform-service.js";

export interface AccountPlatformCommandContextInput {
  readonly eventId: string;
  readonly platformCode: AccountPlatformCode;
  readonly contextType: AccountPlatformContextType;
  readonly externalContextKey: string;
  readonly externalUserKey: string;
  readonly message: string;
}

export interface AccountPlatformCommandContext extends AccountPlatformCommandContextInput {
  readonly actor: Readonly<ResolvedAccountPlatformActorContext> | null;
}

// 플랫폼 명령 시작 시 방·서버별 활성 player를 한 번 고정합니다.
export class AccountPlatformCommandContextProvider {
  private readonly resolver: AccountPlatformActorContextResolver;

  constructor(database: DatabaseClient) {
    this.resolver = new AccountPlatformActorContextResolver(database);
  }

  async prepare(input: AccountPlatformCommandContextInput): Promise<Readonly<AccountPlatformCommandContext>> {
    const actor = await this.resolver.resolve({
      platformCode: input.platformCode,
      contextType: input.contextType,
      externalContextKey: input.externalContextKey,
      externalUserKey: input.externalUserKey
    });
    return Object.freeze({
      ...input,
      actor: actor === null ? null : Object.freeze({ ...actor })
    });
  }
}
